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