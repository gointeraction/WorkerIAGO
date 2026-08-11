import { describe, it, expect, vi } from "vitest";
import { WebhookEngine, WEBHOOK_EVENTS, API_ENDPOINTS } from "../src/webhooks";

function mockDb(initialHooks: any[] = []) {
  const updates: string[] = [];
  const prepared: string[] = [];
  const handler = {
    all: async () => ({ results: initialHooks }),
    run: async () => {
      updates.push(prepared[prepared.length - 1]);
      return { meta: { last_row_id: 1 }, success: true };
    },
  };
  const db = {
    prepare: (query: string) => {
      prepared.push(query);
      return {
        bind: (..._args: any[]) => handler,
        all: handler.all,
        run: handler.run,
      };
    },
  };
  return { db, updates, prepared };
}

function makeHook(over: any = {}) {
  return {
    id: "h1",
    url: "https://example.com/hook",
    events: JSON.stringify(["message.received"]),
    secret: "sec",
    is_active: 1,
    fail_count: 0,
    ...over,
  };
}

describe("WebhookEngine", () => {
  it("should register a webhook and return its id", async () => {
    const { db, prepared } = mockDb();
    const engine = new WebhookEngine(db as any);
    const id = await engine.register("https://x.com/h", ["message.received"]);
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(prepared.some((q) => q.includes("INSERT INTO webhooks"))).toBe(true);
  });

  it("should skip hooks that do not subscribe to the event", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { db } = mockDb([makeHook()]);
    const engine = new WebhookEngine(db as any);
    await engine.trigger("lead.captured", { id: 1 });
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("should call hooks subscribed to the event with signature header", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);
    const { db } = mockDb([makeHook()]);
    const engine = new WebhookEngine(db as any);
    await engine.trigger("message.received", { text: "hola" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://example.com/hook");
    expect(init.headers["X-Webhook-Event"]).toBe("message.received");
    expect(init.headers["X-Webhook-Signature"]).toMatch(/^[0-9a-f]{64}$/);
    const body = JSON.parse(init.body);
    expect(body.event).toBe("message.received");
    expect(body.payload.text).toBe("hola");
    vi.unstubAllGlobals();
  });

  it("should honor wildcard * subscription", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);
    const { db } = mockDb([makeHook({ events: JSON.stringify(["*"]) })]);
    const engine = new WebhookEngine(db as any);
    await engine.trigger("payment.completed", { total: 5 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });

  it("should increment fail_count when fetch fails or returns non-ok", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false });
    vi.stubGlobal("fetch", fetchMock);
    const { db, updates } = mockDb([makeHook()]);
    const engine = new WebhookEngine(db as any);
    await engine.trigger("message.received", {});
    expect(updates.some((q) => q.includes("fail_count = fail_count + 1"))).toBe(true);
    vi.unstubAllGlobals();
  });

  it("should list hooks with parsed events array", async () => {
    const { db } = mockDb([makeHook()]);
    const engine = new WebhookEngine(db as any);
    const hooks = await engine.list();
    expect(hooks).toHaveLength(1);
    expect(Array.isArray(hooks[0].events)).toBe(true);
    expect(hooks[0].events).toEqual(["message.received"]);
  });

  it("should delete a webhook", async () => {
    const { db, prepared } = mockDb();
    const engine = new WebhookEngine(db as any);
    await engine.delete("h1");
    expect(prepared.some((q) => q.startsWith("DELETE FROM webhooks"))).toBe(true);
  });

  it("should produce a deterministic HMAC signature", async () => {
    const { db } = mockDb();
    const engine = new WebhookEngine(db as any);
    const a = await (engine as any).signPayload("secret", "payload");
    const b = await (engine as any).signPayload("secret", "payload");
    const c = await (engine as any).signPayload("secret", "payload2");
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it("should expose webhook event list and public API endpoints", () => {
    expect(WEBHOOK_EVENTS).toContain("message.received");
    expect(WEBHOOK_EVENTS).toContain("payment.completed");
    expect(Object.keys(API_ENDPOINTS).length).toBeGreaterThan(8);
    expect(API_ENDPOINTS["POST /api/v1/knowledge/search"]).toBeTruthy();
  });
});