import { describe, it, expect } from "vitest";
import { ActionEngine } from "../src/actions";

function mockDb() {
  return {
    prepare: (query: string) => ({
      bind: (...args: any[]) => ({
        all: async () => ({ results: [{ id: 1, title: "KB doc" }] }),
        run: async () => ({ meta: { last_row_id: 42 } }),
      }),
    }),
  };
}

describe("ActionEngine", () => {
  it("should execute pure actions (no DB) with params", async () => {
    const engine = new ActionEngine({ DB: mockDb(), VECTORIZE: {} } as any);
    const results = await engine.executeActions(
      [{ name: "create_quote", params: { items: ["A", "B"], notes: "hola" } }],
      { chatId: "c1", channel: "web" }
    );
    expect(results).toHaveLength(1);
    expect(results[0].success).toBe(true);
    expect(results[0].result.total).toBe(2);
    expect(results[0].result.quoteId).toMatch(/^quote-/);
  });

  it("should return Unknown action for unregistered action", async () => {
    const engine = new ActionEngine({ DB: mockDb(), VECTORIZE: {} } as any);
    const results = await engine.executeActions([{ name: "nope", params: {} }], {});
    expect(results[0].success).toBe(false);
    expect(results[0].error).toBe("Unknown action");
  });

  it("should pass context to DB-backed handlers (create_ticket)", async () => {
    const engine = new ActionEngine({ DB: mockDb(), VECTORIZE: {} } as any);
    const results = await engine.executeActions(
      [{ name: "create_ticket", params: { title: "Bug", description: "x", priority: "high" } }],
      { chatId: "c1", channel: "whatsapp", agentId: "a1", tenantId: "t1" }
    );
    expect(results[0].success).toBe(true);
    expect(results[0].result.ticketId).toBe(42);
    expect(results[0].result.priority).toBe("high");
  });

  it("should catch handler errors and mark action failed", async () => {
    const engine = new ActionEngine({ DB: mockDb(), VECTORIZE: {} } as any);
    engine.registerAction("boom", async () => { throw new Error("kaboom"); });
    const results = await engine.executeActions([{ name: "boom", params: {} }], {});
    expect(results[0].success).toBe(false);
    expect(String(results[0].error)).toContain("kaboom");
  });

  it("should support registering a custom action", async () => {
    const engine = new ActionEngine({ DB: mockDb(), VECTORIZE: {} } as any);
    engine.registerAction("double", async (p: any) => p.n * 2);
    const results = await engine.executeActions([{ name: "double", params: { n: 21 } }], {});
    expect(results[0].success).toBe(true);
    expect(results[0].result).toBe(42);
  });
});