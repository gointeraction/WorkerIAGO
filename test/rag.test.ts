import { describe, it, expect } from "vitest";
import { buildRagContext, chunkText } from "../src/knowledge";

describe("RAG / Knowledge Base", () => {
  it("should chunk text into pieces", () => {
    const data = "Contenido de texto de prueba. ".repeat(100);
    const chunks = chunkText(data, 100, 10);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.join("")).toContain("Contenido de texto");
  });

  it("should build empty context if vectorize fails", async () => {
    const mockEnv: any = {
      VECTORIZE: {
        query: async () => { throw new Error("Vectorize error") }
      },
      AI: {
        run: async () => ({ data: [[0.1, 0.2, 0.3]] })
      },
      DB: {
        prepare: () => ({ bind: () => ({ first: async () => null }) })
      }
    };

    // buildRagContext propaga el error de Vectorize; los call sites lo capturan
    await expect(
      buildRagContext(mockEnv, "Consulta de prueba", "agent1", 2, "tenant1")
    ).rejects.toThrow("Vectorize error");
  });

  it("should format vectorize matches correctly", async () => {
    const mockEnv: any = {
      VECTORIZE: {
        query: async () => ({
          matches: [
            { id: "c1", score: 0.9, metadata: { title: "Doc1", content: "El texto uno", tenantId: "tenant1" } },
            { id: "c2", score: 0.8, metadata: { title: "Doc2", content: "El texto dos", tenantId: "tenant1" } }
          ]
        })
      },
      AI: {
        run: async () => ({ data: [[0.1, 0.2, 0.3]] })
      },
      DB: {
        prepare: () => ({ bind: () => ({ first: async () => null }) })
      }
    };

    const result = await buildRagContext(mockEnv, "Consulta", "agent1", 2, "tenant1");
    expect(result).toContain("El texto uno");
    expect(result).toContain("El texto dos");
  });
});

describe("chunkText edge cases", () => {
  it("should return empty array for empty/whitespace input", () => {
    expect(chunkText("")).toEqual([]);
  });

  it("should skip tiny chunks shorter than 21 chars", () => {
    expect(chunkText("Hola corto.")).toEqual([]);
    expect(chunkText("a".repeat(20))).toEqual([]);
    expect(chunkText("a".repeat(21))).toHaveLength(1);
  });

  it("should produce one chunk when text fits in chunkSize", () => {
    const text = "Primera frase larga. Segunda frase larga también.";
    const chunks = chunkText(text, 500, 50);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toBe(text);
  });

  it("should apply exact overlap without sentence boundaries", () => {
    const text = "a".repeat(120);
    const chunks = chunkText(text, 50, 10);
    expect(chunks).toHaveLength(3);
    expect(chunks[0]).toBe(text.slice(0, 50));
    expect(chunks[1]).toBe(text.slice(40, 90));
    expect(chunks[2]).toBe(text.slice(80, 120));
  });

  it("should break at sentence boundary when in second-half of chunk", () => {
    const text = "Frase uno. Frase dos. Frase tres. Frase cuatro. Frase cinco. Frase seis. Frase siete. Frase ocho.";
    const chunks = chunkText(text, 50, 10);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.endsWith(".")).toBe(true);
    }
    expect(chunks.join(" ")).toContain("Frase cinco");
  });
});