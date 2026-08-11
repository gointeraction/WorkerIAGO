import { describe, it, expect, vi } from "vitest";
import { WorkflowEngine, WORKFLOW_TEMPLATES } from "../src/workflows";

function mockDb(workflowRows: Record<string, any>[] = []) {
  const calls: string[] = [];
  const db = {
    prepare: (query: string) => {
      calls.push(query);
      return {
        bind: (...args: any[]) => ({
          first: async () => (workflowRows.length ? workflowRows[0] : null),
          run: async () => ({ meta: { last_row_id: 1 }, success: true }),
        }),
      };
    },
  };
  return { db, calls };
}

function makeWorkflow(steps: any[]) {
  return {
    id: "wf1",
    name: "Test flow",
    description: "d",
    trigger: "manual",
    is_active: 1,
    created_at: "2025-01-01",
    updated_at: "2025-01-01",
    steps: JSON.stringify(steps),
  };
}

describe("WorkflowEngine", () => {
  it("should throw if workflow not found", async () => {
    const { db } = mockDb([]);
    const engine = new WorkflowEngine(db as any, {} as any);
    await expect(engine.run("missing")).rejects.toThrow("Workflow not found");
  });

  it("should run a transform step and interpolate context vars", async () => {
    const { db } = mockDb([makeWorkflow([
      { id: "s1", type: "transform", name: "build", config: { template: "Hola {{user.name}}, agente {{agent}}" } },
    ])]);
    const engine = new WorkflowEngine(db as any, {} as any);
    const run = await engine.run("wf1", { user: { name: "Ana" }, agent: "Bot" });
    expect(run.status).toBe("completed");
    expect(run.context.step_s1).toBe("Hola Ana, agente Bot");
  });

  it("should preserve template var when value is missing", async () => {
    const { db } = mockDb([makeWorkflow([
      { id: "s1", type: "transform", name: "t", config: { template: "Hola {{desconocido}}" } },
    ])]);
    const engine = new WorkflowEngine(db as any, {} as any);
    const run = await engine.run("wf1", {});
    expect(run.context.step_s1).toBe("Hola {{desconocido}}");
  });

  it("should chain steps via next and call the AI model for agent steps", async () => {
    const aiRun = vi.fn()
      .mockResolvedValueOnce({ response: "respuesta A" })
      .mockResolvedValueOnce({ response: "respuesta B" });
    const { db } = mockDb([makeWorkflow([
      { id: "a1", type: "agent", name: "first", config: { message: "Llamo a {{var}}" }, next: "a2" },
      { id: "a2", type: "agent", name: "second", config: { message: "uso {{step_a1}}" } },
    ])]);
    const engine = new WorkflowEngine(db as any, { run: aiRun } as any);
    const run = await engine.run("wf1", { var: "X" });

    expect(run.status).toBe("completed");
    expect(run.context.step_a1).toBe("respuesta A");
    expect(run.context.step_a2).toBe("respuesta B");
    expect(aiRun).toHaveBeenCalledTimes(2);
    const firstArgs = aiRun.mock.calls[0];
    expect(firstArgs[1].messages[1].content).toBe("Llamo a X");
    const secondArgs = aiRun.mock.calls[1];
    expect(secondArgs[1].messages[1].content).toBe("uso respuesta A");
  });

  it("should follow next_on_true / next_on_false for condition steps", async () => {
    const aiRun = vi.fn()
      .mockResolvedValueOnce({ response: "false" })
      .mockResolvedValueOnce({ response: "falling" });
    const { db } = mockDb([makeWorkflow([
      { id: "c1", type: "condition", name: "check", config: { condition: "x>1" }, next_on_true: "yes", next_on_false: "no" },
      { id: "yes", type: "agent", name: "y", config: { message: "true path" } },
      { id: "no", type: "agent", name: "n", config: { message: "false path" } },
    ])]);
    const engine = new WorkflowEngine(db as any, { run: aiRun } as any);
    const run = await engine.run("wf1", {});

    expect(run.status).toBe("completed");
    expect(run.context.step_no).toBe("falling");
    expect(run.context.step_yes).toBeUndefined();
  });

  it("should mark run as failed with error message when a step throws", async () => {
    const { db } = mockDb([makeWorkflow([
      { id: "b1", type: "transform", name: "boom", config: { template: "x" } },
    ])]);
    const engine = new WorkflowEngine(db as any, {} as any);
    (engine as any).executeStepInternal = async () => {
      throw new Error("explosion");
    };
    const run = await engine.run("wf1", {});
    expect(run.status).toBe("failed");
    expect(run.error).toBe("explosion");
  });

  it("should expose the two pre-built workflow templates", () => {
    expect(WORKFLOW_TEMPLATES).toHaveLength(2);
    const names = WORKFLOW_TEMPLATES.map((t) => t.name);
    expect(names).toContain("Atención al Cliente");
    expect(names).toContain("Generador de Contenido");
    for (const tpl of WORKFLOW_TEMPLATES) {
      expect(tpl.steps.length).toBeGreaterThan(0);
      for (const step of tpl.steps) {
        expect(step.id).toBeTruthy();
        expect(["agent", "tool", "condition", "parallel", "transform"]).toContain(step.type);
      }
    }
  });
});