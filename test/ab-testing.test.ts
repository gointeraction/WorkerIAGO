import { describe, it, expect } from "vitest";
import { AbTestEngine } from "../src/ab-testing";

function makeDb(over: any = {}, opts: { knownTest?: boolean; allRows?: any[] | null } = {}) {
  const runs: string[] = [];
  const inserts: string[] = [];
  const row = {
    id: "t1",
    name: "Test saludo",
    description: "d",
    variants: JSON.stringify([
      { id: "v1", name: "Formal", system_prompt: "Formal prompt", weight: 50, impressions: 100, conversions: 60, avg_response_time: 1, satisfaction_score: 0 },
      { id: "v2", name: "Amistoso", system_prompt: "Amistoso prompt", weight: 50, impressions: 40, conversions: 10, avg_response_time: 1, satisfaction_score: 0 },
    ]),
    traffic_split: JSON.stringify([50, 50]),
    status: "running",
    primary_metric: "conversion",
    created_at: "2025-01-01",
    ...over,
  };
  const db = {
    prepare: (query: string) => {
      const handler = {
        first: async () => {
          const known = opts.knownTest !== false;
          if (!known) return null;
          return row;
        },
        all: async () => ({ results: opts.allRows !== undefined && opts.allRows !== null ? opts.allRows : [row] }),
        run: async () => {
          runs.push(query);
          return { meta: { last_row_id: 1 }, success: true };
        },
      };
      return {
        bind: (...args: any[]) => ({ ...handler, bind: () => handler }),
        first: handler.first,
        all: handler.all,
        run: handler.run,
      };
    },
  };
  return { db, runs, inserts };
}

describe("AbTestEngine", () => {
  it("should create a test and return a UUID", async () => {
    const { db } = makeDb();
    const engine = new AbTestEngine(db as any);
    const id = await engine.createTest({
      name: "Nuevo", description: "", variants: [], traffic_split: [100],
      status: "draft", primary_metric: "conversion",
    });
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("should return null when test is not running", async () => {
    const { db } = makeDb({ status: "paused" });
    const engine = new AbTestEngine(db as any);
    expect(await engine.assignVariant("t1", 1)).toBeNull();
  });

  it("should assign deterministically based on conversation id", async () => {
    const { db } = makeDb();
    const engine = new AbTestEngine(db as any);
    // conversationId 1 -> hash 1 -> first variant (split 50)
    const v1 = await engine.assignVariant("t1", 1);
    const v1again = await engine.assignVariant("t1", 1);
    // conversationId 60 -> hash 60 -> second variant
    const v2 = await engine.assignVariant("t1", 60);
    expect(v1).toBeDefined();
    expect(v1!.id).toBe("v1");
    expect(v1again!.id).toBe("v1");
    expect(v2!.id).toBe("v2");
  });

  it("should fall back to first variant when hash exceeds splits", async () => {
    const { db } = makeDb({ traffic_split: JSON.stringify([30, 30]) });
    const engine = new AbTestEngine(db as any);
    const v = await engine.assignVariant("t1", 99);
    expect(v!.id).toBe("v1");
  });

  it("should increment impressions/conversions via trackEvent", async () => {
    const { db, runs } = makeDb();
    const engine = new AbTestEngine(db as any);
    await engine.trackEvent({ test_id: "t1", variant_id: "v1", conversation_id: 5, event_type: "impression" });
    await engine.trackEvent({ test_id: "t1", variant_id: "v1", conversation_id: 5, event_type: "conversion" });
    // 1 UPDATE variants + 1 INSERT ab_events per event
    expect(runs.filter((q) => q.startsWith("UPDATE ab_tests"))).toHaveLength(2);
    expect(runs.filter((q) => q.startsWith("INSERT INTO ab_events"))).toHaveLength(2);
  });

  it("should ignore trackEvent for unknown test", async () => {
    const { db, runs } = makeDb({}, { knownTest: false });
    const engine = new AbTestEngine(db as any);
    await engine.trackEvent({ test_id: "nope", variant_id: "v1", conversation_id: 1, event_type: "impression" });
    expect(runs).toHaveLength(0);
  });

  it("should compute conversion rates and pick a winner over threshold", async () => {
    const { db } = makeDb();
    const engine = new AbTestEngine(db as any);
    const res = await engine.getResults("t1");
    expect(res.variants).toHaveLength(2);
    // v1: 60/100 = 60%, v2: 10/40 = 25% -> v1 wins by >1.1x
    expect(res.variants[0].conversionRate).toBeCloseTo(60);
    expect(res.winner).toBe("v1");
    expect(res.confidence).toBe(95);
  });

  it("should not pick a winner when no clear lead", async () => {
    const { db } = makeDb({
      variants: JSON.stringify([
        { id: "v1", name: "A", system_prompt: "p1", weight: 50, impressions: 40, conversions: 20, avg_response_time: 1, satisfaction_score: 0 },
        { id: "v2", name: "B", system_prompt: "p2", weight: 50, impressions: 40, conversions: 21, avg_response_time: 1, satisfaction_score: 0 },
      ]),
    });
    const engine = new AbTestEngine(db as any);
    const res = await engine.getResults("t1");
    expect(res.winner).toBeUndefined();
    expect(res.confidence).toBe(0);
  });

  it("should not consider variants with less than 30 impressions", async () => {
    const { db } = makeDb({
      variants: JSON.stringify([
        { id: "v1", name: "A", system_prompt: "p1", weight: 50, impressions: 29, conversions: 29, avg_response_time: 1, satisfaction_score: 0 },
        { id: "v2", name: "B", system_prompt: "p2", weight: 50, impressions: 29, conversions: 0, avg_response_time: 1, satisfaction_score: 0 },
      ]),
    });
    const engine = new AbTestEngine(db as any);
    const res = await engine.getResults("t1");
    expect(res.winner).toBeUndefined();
  });

  it("should return winning system prompt or null", async () => {
    const { db } = makeDb();
    const engine = new AbTestEngine(db as any);
    expect(await engine.getWinningPrompt("t1")).toBe("Formal prompt");
  });

  it("should return null prompt when no winner", async () => {
    const { db } = makeDb({
      variants: JSON.stringify([
        { id: "v1", name: "A", system_prompt: "p1", weight: 50, impressions: 40, conversions: 20, avg_response_time: 1, satisfaction_score: 0 },
        { id: "v2", name: "B", system_prompt: "p2", weight: 50, impressions: 40, conversions: 21, avg_response_time: 1, satisfaction_score: 0 },
      ]),
    });
    const engine = new AbTestEngine(db as any);
    expect(await engine.getWinningPrompt("t1")).toBeNull();
  });

  it("should list tests with parsed variants and split", async () => {
    const { db } = makeDb();
    const engine = new AbTestEngine(db as any);
    const list = await engine.listTests();
    expect(list).toHaveLength(1);
    expect(Array.isArray(list[0].variants)).toBe(true);
    expect(list[0].variants).toHaveLength(2);
    expect(list[0].traffic_split).toEqual([50, 50]);
  });
});