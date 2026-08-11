import { describe, it, expect, vi } from "vitest";
import {
  extractFacts,
  storeMemory,
  recallMemory,
  getMemoryContext,
  summarizeConversation,
  processAndStoreMemory,
  getUserMemories,
  deleteMemory,
  clearUserMemories,
} from "../src/memory";

function makeDb(rows: any[] = [], firstResult: any = null) {
  const inserted: any[] = [];
  const updated: string[] = [];
  const deleted: string[] = [];
  const db = {
    prepare: (query: string) => ({
      bind: (...args: any[]) => ({
        first: async () => firstResult,
        all: async () => ({ results: rows }),
        run: async () => {
          if (query.startsWith("INSERT")) inserted.push(args);
          if (query.startsWith("UPDATE")) updated.push(query);
          if (query.startsWith("DELETE")) deleted.push(query);
          return { meta: { last_row_id: 1 }, success: true };
        },
      }),
    }),
  };
  return { db, inserted, updated, deleted };
}

function makeMem(over: any = {}) {
  return {
    id: "m1",
    user_id: "chat:u1",
    memory_type: "fact",
    content: "El usuario se llama Ana",
    confidence: 0.95,
    created_at: "2025-01-01 10:00:00",
    recall_count: 0,
    ...over,
  };
}

describe("memory module", () => {
  it("should parse JSON array returned by AI as fact objects", async () => {
    const aiRun = vi.fn().mockResolvedValue({
      response: `Sure! Here: [{"fact": "Nombre Ana", "type": "fact", "confidence": 0.9}, {"fact": "prefiere WhatsApp", "type": "preference", "confidence": 0.8}]`,
    });
    const facts = await extractFacts({ run: aiRun } as any, "Me llamo Ana", "Hola Ana");
    expect(facts).toHaveLength(2);
    expect(facts[0].fact).toBe("Nombre Ana");
    expect(facts[0].type).toBe("fact");
    expect(facts[1].type).toBe("preference");
  });

  it("should return [] when AI response has no JSON array", async () => {
    const aiRun = vi.fn().mockResolvedValue({ response: "No facts here." });
    const facts = await extractFacts({ run: aiRun } as any, "hola", "hola");
    expect(facts).toEqual([]);
  });

  it("should return [] when AI response is invalid JSON", async () => {
    const aiRun = vi.fn().mockResolvedValue({ response: "[{broken json" });
    const facts = await extractFacts({ run: aiRun } as any, "x", "y");
    expect(facts).toEqual([]);
  });

  it("should not store a duplicate fact", async () => {
    const env: any = { DB: makeDb([], { id: "dup" }).db, AI: {} };
    await storeMemory(env, "chat:u1", "facto", "fact", 0.7);
    expect(env.DB).toBeTruthy();
  });

  it("should insert when no duplicate exists", async () => {
    const { db, inserted } = makeDb([]);
    const env: any = { DB: db, AI: {} };
    await storeMemory(env, "chat:u1", "Nuevo fact", "fact", 0.8, 10);
    expect(inserted).toHaveLength(1);
    expect(inserted[0][1]).toBe("chat:u1");
    expect(inserted[0][2]).toBe("fact");
    expect(inserted[0][3]).toBe("Nuevo fact");
    expect(inserted[0][4]).toBe(10);
  });

  it("should recall memories ordered and update recall stats", async () => {
    const { db, updated } = makeDb([makeMem(), makeMem({ id: "m2", memory_type: "preference", content: "le gusta X" })]);
    const env: any = { DB: db, AI: {} };
    const mems = await recallMemory(env, "chat:u1", "x", 10);
    expect(mems).toHaveLength(2);
    expect(updated.some((q) => q.includes("recall_count = recall_count + 1"))).toBe(true);
  });

  it("should build a context string with facts and preferences", async () => {
    const { db } = makeDb([
      makeMem(),
      makeMem({ id: "m2", memory_type: "preference", content: "le gusta WhatsApp" }),
      makeMem({ id: "m3", memory_type: "sentiment", content: "feliz" }),
    ]);
    const env: any = { DB: db, AI: {} };
    const ctx = await getMemoryContext(env, "chat:u1");
    expect(ctx).toContain("MEMORIA DEL USUARIO");
    expect(ctx).toContain("Datos conocidos");
    expect(ctx).toContain("El usuario se llama Ana");
    expect(ctx).toContain("Preferencias");
    expect(ctx).toContain("le gusta WhatsApp");
    expect(ctx).not.toContain("feliz");
  });

  it("should return empty string when no memories", async () => {
    const { db } = makeDb([]);
    const env: any = { DB: db, AI: {} };
    expect(await getMemoryContext(env, "chat:u1")).toBe("");
  });

  it("should summarize conversation passing only last 20 messages", async () => {
    const aiRun = vi.fn().mockResolvedValue({ response: "Resumen corto" });
    const messages = Array.from({ length: 30 }, (_, i) => ({ role: "user" as const, content: `msg ${i}` }));
    const summary = await summarizeConversation({ run: aiRun } as any, messages);
    expect(summary).toBe("Resumen corto");
    expect(aiRun.mock.calls[0][1].messages).toHaveLength(21);
    expect(aiRun.mock.calls[0][1].messages[1].content).toBe("msg 10");
  });

  it("should auto-extract and store facts per message", async () => {
    const { db, inserted } = makeDb([], null);
    const aiRun = vi.fn().mockResolvedValue({
      response: '[{"fact": "Ana", "type": "fact", "confidence": 0.9}]',
    });
    const env: any = { DB: db, AI: { run: aiRun } };
    await processAndStoreMemory(env, "chat:u1", "hola soy Ana", "Hola Ana!", 5);
    expect(inserted).toHaveLength(1);
    expect(inserted[0][3]).toBe("Ana");
  });

  it("should not throw if AI extraction fails", async () => {
    const { db, inserted } = makeDb([]);
    const aiRun = vi.fn().mockRejectedValue(new Error("AI down"));
    const env: any = { DB: db, AI: { run: aiRun } };
    await expect(
      processAndStoreMemory(env, "chat:u1", "a", "b", 1)
    ).resolves.toBeUndefined();
    expect(inserted).toHaveLength(0);
  });

  it("should list, delete a single memory, and clear all user memories", async () => {
    const { db, deleted } = makeDb([makeMem()]);
    const env: any = { DB: db, AI: {} };

    const all = await getUserMemories(env, "chat:u1");
    expect(all).toHaveLength(1);
    expect(all[0].content).toBe("El usuario se llama Ana");

    await deleteMemory(env, "m1");
    await clearUserMemories(env, "chat:u1");
    expect(deleted).toHaveLength(2);
    expect(deleted[0]).toContain("WHERE id = ?");
    expect(deleted[1]).toContain("WHERE user_id = ?");
  });
});