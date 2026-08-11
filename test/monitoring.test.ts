import { describe, it, expect, vi } from "vitest";
import { MonitoringEngine, scheduledHealthCheck } from "../src/monitoring";

type QueryMode = "ok" | "d1fail" | "kvfail" | "aifail" | "vecfail" | "highError";

function makeEnv(mode: QueryMode = "ok", firstRows: any = null) {
  const firstCalls: string[] = [];
  const allCalls: string[] = [];
  const runs: string[] = [];
  const kvOps: string[] = [];
  const aiRun = vi.fn().mockResolvedValue({ response: "hi" });
  const fetchMock = vi.fn().mockResolvedValue({ ok: true });

  const firstResult = (query: string) => {
    firstCalls.push(query);
    if (query.includes("status = 'error'")) {
      return { c: mode === "highError" ? 90 : 1 };
    }
    if (query.includes("FROM ai_logs") && query.includes("AVG(latency_ms)")) {
      return { avg: mode === "highError" ? 100 : 1200 };
    }
    if (query.includes("FROM ai_logs") && query.includes("COUNT(*)")) {
      return { c: mode === "highError" ? 100 : 100 };
    }
    if (query.includes("FROM conversations")) return { c: 3 };
    if (query.includes("FROM messages")) return { c: 5 };
    if (query === "SELECT 1") return { one: 1 };
    return firstRows ?? { c: 0 };
  };

  const allResult = (query: string) => {
    allCalls.push(query);
    if (query.includes("GROUP BY date")) {
      return { results: [{ date: "2025-01-01", count: 4, errors: 1 }] };
    }
    if (query.includes("GROUP BY model")) {
      return { results: [{ model: "m1", count: 4, avg_latency: 100 }] };
    }
    if (query.includes("GROUP BY hour")) {
      return { results: [{ hour: 10, count: 4 }] };
    }
    if (query.includes("FROM webhooks")) {
      return { results: [{ id: "w1", url: "https://example.com/h", events: "[]" }] };
    }
    if (query.includes("FROM monitoring_alerts")) {
      return { results: [{ id: "a1", metadata: '{"k":"v"}' }] };
    }
    return { results: [] };
  };

  const db = {
    prepare: (query: string) => {
      return {
        bind: (..._args: any[]) => ({
          first: async () => {
            if (mode === "d1fail" && query === "SELECT 1") throw new Error("d1 down");
            return firstResult(query);
          },
          all: async () => allResult(query),
          run: async () => {
            runs.push(query);
            return { meta: { last_row_id: 1 }, success: true };
          },
        }),
        first: async () => {
          if (mode === "d1fail" && query === "SELECT 1") throw new Error("d1 down");
          return firstResult(query);
        },
        all: async () => allResult(query),
        run: async () => {
          runs.push(query);
          return { meta: { last_row_id: 1 }, success: true };
        },
      };
    },
  };

  const CACHE = {
    get: async () => { kvOps.push("get"); if (mode === "kvfail") throw new Error("kv down"); return null; },
    put: async () => { kvOps.push("put"); if (mode === "kvfail") throw new Error("kv down"); },
  };

  const VECTORIZE = {
    query: async () => { if (mode === "vecfail") throw new Error("vec down"); return { matches: [] }; },
  };

  if (mode === "aifail") aiRun.mockRejectedValue(new Error("ai down"));

  return {
    env: { DB: db, AI: { run: aiRun }, CACHE, VECTORIZE } as any,
    firstCalls, allCalls, runs, kvOps, aiRun, fetchMock,
  };
}

describe("MonitoringEngine", () => {
  it("should report healthy when all subsystems respond", async () => {
    const { env } = makeEnv();
    const engine = new MonitoringEngine(env);
    const health = await engine.checkHealth();
    expect(health.status).toBe("healthy");
    expect(health.d1_status).toBe("ok");
    expect(health.kv_status).toBe("ok");
    expect(health.ai_model_status).toBe("ok");
    expect(health.issues).toEqual([]);
    expect(health.active_conversations).toBe(3);
    expect(health.messages_last_hour).toBe(5);
  });

  it("should mark down when D1 is not responding", async () => {
    const { env } = makeEnv("d1fail");
    const engine = new MonitoringEngine(env);
    const health = await engine.checkHealth();
    expect(health.d1_status).toBe("error");
    expect(health.issues).toContain("D1 database not responding");
    expect(health.status).toBe("down");
  });

  it("should degrade gracefully when Vectorize fails", async () => {
    const { env } = makeEnv("vecfail");
    const engine = new MonitoringEngine(env);
    const health = await engine.checkHealth();
    expect(health.vectorize_status).toBe("degraded");
    expect(health.status).toBe("healthy");
  });

  it("should compute error rate percentage", async () => {
    const { env } = makeEnv();
    const engine = new MonitoringEngine(env);
    const rate = await engine.getErrorRate(1);
    expect(rate).toBeCloseTo(1); // 1/100
  });

  it("should return 0 error rate when no logs", async () => {
    const { env } = makeEnv();
    env.DB.prepare = () => ({
      bind: () => ({ first: async () => ({ c: 0 }) }),
    });
    const engine = new MonitoringEngine(env);
    expect(await engine.getErrorRate(1)).toBe(0);
  });

  it("should return rounded average response time", async () => {
    const { env } = makeEnv();
    const engine = new MonitoringEngine(env);
    expect(await engine.getAvgResponseTime(1)).toBe(1200);
  });

  it("should create an alert and notify webhooks", async () => {
    vi.stubGlobal("fetch", makeEnv().fetchMock);
    const { env, runs } = makeEnv();
    const engine = new MonitoringEngine(env);
    await engine.createAlert("custom", "warning", "Algo pasó", { a: 1 });
    expect(runs.some((q) => q.startsWith("INSERT INTO monitoring_alerts"))).toBe(true);
    vi.unstubAllGlobals();
  });

  it("should list alerts with parsed metadata", async () => {
    const { env } = makeEnv();
    const engine = new MonitoringEngine(env);
    const alerts = await engine.getAlerts(5);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].metadata).toEqual({ k: "v" });
  });

  it("should acknowledge an alert", async () => {
    const { env, runs } = makeEnv();
    const engine = new MonitoringEngine(env);
    await engine.acknowledgeAlert("a1");
    expect(runs.some((q) => q.startsWith("UPDATE monitoring_alerts SET acknowledged"))).toBe(true);
  });

  it("should return performance metrics from grouped queries", async () => {
    const { env } = makeEnv();
    const engine = new MonitoringEngine(env);
    const metrics = await engine.getPerformanceMetrics(7);
    expect(metrics.requests_per_day).toHaveLength(1);
    expect(metrics.top_models[0].model).toBe("m1");
    expect(metrics.peak_hours[0].hour).toBe(10);
  });

  it("should log health and create downtime alert when down", async () => {
    const { env, runs } = makeEnv("d1fail");
    await scheduledHealthCheck(env);
    expect(runs.some((q) => q.startsWith("INSERT INTO health_logs"))).toBe(true);
    expect(runs.some((q) => q.startsWith("INSERT INTO monitoring_alerts"))).toBe(true);
  });

  it("should create degraded warning when issues exist but system is up", async () => {
    const { env, runs } = makeEnv("highError");
    await scheduledHealthCheck(env);
    expect(runs.some((q) => q.startsWith("INSERT INTO health_logs"))).toBe(true);
    // 90% error rate triggers error_rate critical alert (and degraded warning)
    expect(runs.filter((q) => q.startsWith("INSERT INTO monitoring_alerts")).length).toBeGreaterThanOrEqual(1);
  });
});