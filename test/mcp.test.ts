import { describe, it, expect, vi } from "vitest";
import { executeTool, toAiToolDefinition, getAgentToolDefinitions } from "../src/mcp";
import { CONNECTORS, getConnector, listConnectors } from "../src/mcp/connectors";

function makeTool(over: any = {}): any {
  return {
    id: "t1",
    name: "fetch_weather",
    description: "Obtiene el clima",
    category: "data",
    handler_type: "http",
    endpoint_url: "https://api.example.com/weather",
    method: "POST",
    parameters_schema: { type: "object", required: ["city"] },
    auth_type: "none",
    timeout_ms: 5000,
    retry_count: 0,
    is_active: 1,
    usage_count: 0,
    avg_latency_ms: 0,
    ...over,
  };
}

function makeDb() {
  const runs: string[] = [];
  const db = {
    prepare: (query: string) => ({
      bind: (..._args: any[]) => ({
        all: async () => ({
          results: [makeTool(), { ...makeTool(), id: "t2", name: "other_tool" }],
        }),
        run: async () => { runs.push(query); return { success: true }; },
      }),
    }),
  };
  return { db, runs };
}

describe("MCP module", () => {
  it("should validate required params and fail without them", async () => {
    const { db } = makeDb();
    const res = await executeTool(db as any, makeTool(), {}, "a1", 1);
    expect(res.success).toBe(false);
    expect(res.error).toContain("Missing required field: city");
  });

  it("should call the endpoint with auth header and return data", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ temp: 25 }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const { db, runs } = makeDb();
    const tool = makeTool({
      auth_type: "api_key",
      auth_config: { api_key: "secret123" },
    });
    const res = await executeTool(db as any, tool, { city: "Caracas" }, "a1", 1);

    expect(res.success).toBe(true);
    expect(res.data).toEqual({ temp: 25 });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.example.com/weather");
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe("Bearer secret123");
    expect(JSON.parse(init.body)).toEqual({ city: "Caracas" });

    // Logging: INSERT + UPDATE
    expect(runs.length).toBe(2);
    vi.unstubAllGlobals();
  });

  it("should use GET method without body", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: 1 }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const { db } = makeDb();
    const res = await executeTool(db as any, makeTool({ method: "GET" }), { city: "X" }, "a1");
    expect(res.success).toBe(true);
    const [, init] = fetchMock.mock.calls[0];
    expect(init.body).toBeUndefined();
    vi.unstubAllGlobals();
  });

  it("should report HTTP error status", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => "server error",
    });
    vi.stubGlobal("fetch", fetchMock);
    const { db } = makeDb();
    const res = await executeTool(db as any, makeTool(), { city: "X" }, "a1");
    expect(res.success).toBe(false);
    expect(res.error).toContain("HTTP 500");
    vi.unstubAllGlobals();
  });

  it("should retry on failure when retry_count > 0", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 502, text: async () => "bad" })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: 1 }) });
    vi.stubGlobal("fetch", fetchMock);
    const { db } = makeDb();
    const res = await executeTool(db as any, makeTool({ retry_count: 1 }), { city: "X" }, "a1");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(res.success).toBe(true);
    vi.unstubAllGlobals();
  });

  it("should convert tool to AI function-calling definition", () => {
    const def = toAiToolDefinition(makeTool());
    expect(def).toEqual({
      name: "fetch_weather",
      description: "Obtiene el clima",
      parameters: { type: "object", required: ["city"] },
    });
  });

  it("should get agent tool definitions via DB join", async () => {
    const { db } = makeDb();
    const defs = await getAgentToolDefinitions(db as any, "a1");
    expect(defs).toHaveLength(2);
    expect(defs[0].name).toBe("fetch_weather");
    expect(defs[1].name).toBe("other_tool");
  });

  it("should list connectors and resolve by type", () => {
    const connectors = listConnectors();
    expect(connectors.length).toBeGreaterThanOrEqual(3);
    const names = connectors.map((c) => c.name);
    expect(names).toContain("Google Drive");
    expect(names).toContain("Notion");
    expect(names).toContain("RSS Feed");

    const drive = getConnector("google_drive");
    expect(drive).toBeDefined();
    expect(drive!.name).toBe("Google Drive");
    expect(getConnector("unknown")).toBeNull();
    expect(CONNECTORS).toBeDefined();
  });
});