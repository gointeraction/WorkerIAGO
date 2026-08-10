import { env } from "cloudflare:test";
import { describe, it, expect, vi } from "vitest";
import { AgentOrchestrator } from "../src/orchestrator";
import { aiWithFallback } from "../src/gateway";

describe("Orchestrator", () => {
  it("should return error if no agent found", async () => {
    // Create mock environment
    const mockEnv: any = {
      DB: {
        prepare: () => ({
          bind: () => ({
            first: async () => null,
            all: async () => ({ results: [] })
          })
        })
      },
      AI: {},
      VECTORIZE: {},
      CACHE: {},
      STORAGE: {},
      AGENT_STATE: {}
    };

    const orchestrator = new AgentOrchestrator(mockEnv, "tenant1");
    const result = await orchestrator.processMessage("Hola", "123", "whatsapp");

    expect(result.intent).toBe("error");
    expect(result.response).toBe("No hay agentes configurados.");
  });

  it("should process message successfully", async () => {
    // Setup simple mock for LLM returning a normal text
    const mockEnv: any = {
      DB: {
        prepare: (query: string) => ({
          bind: () => ({
            first: async () => {
              if (query.includes('agents')) return { id: "agent1", system_prompt: "You are a bot" };
              return null;
            },
            all: async () => ({ results: [] }),
            run: async () => ({ success: true })
          })
        })
      },
      AI: {
        run: async () => ({ response: "Hola, ¿en qué te puedo ayudar?" })
      },
      VECTORIZE: {
        query: async () => ({ matches: [] })
      }
    };

    const orchestrator = new AgentOrchestrator(mockEnv, "tenant1");
    const result = await orchestrator.processMessage("Hola", "123", "whatsapp", [], "agent1");
    
    expect(result.response).toContain("Hola");
  });
});
