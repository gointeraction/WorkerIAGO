# MCP Server API Contract

## Overview

WorkerIAGO exposes an MCP (Model Context Protocol) server at `/mcp` for external AI agents to discover and call tools.

## Endpoints

### GET /mcp

Server manifest.

**Response (200)**:

```json
{
  "name": "WorkerIAGO MCP Server",
  "version": "1.0.0",
  "description": "AI agent platform tools",
  "capabilities": {
    "tools": true,
    "resources": false,
    "prompts": false
  }
}
```

---

### GET /mcp/tools

List all available MCP tools.

**Response (200)**:

```json
{
  "tools": [
    {
      "id": "string (UUID)",
      "name": "string",
      "description": "string",
      "parameters": {
        "type": "object",
        "properties": {
          "param1": {
            "type": "string",
            "description": "string"
          }
        },
        "required": ["param1"]
      },
      "category": "string"
    }
  ]
}
```

---

### POST /mcp/call

Execute a tool by ID.

**Request**:

```json
{
  "toolId": "string (required) — UUID of the tool",
  "params": {
    "param1": "value1"
  }
}
```

**Response (200)**:

```json
{
  "toolId": "string",
  "status": "success",
  "result": {
    "output": "string or object — tool response"
  },
  "latency_ms": 123
}
```

**Response (500)**:

```json
{
  "toolId": "string",
  "status": "error",
  "error": "string — error message",
  "latency_ms": 123
}
```

---

## Tool Execution Pipeline

1. **Validate**: Check `toolId` exists in `mcp_tools` table
2. **Validate params**: Compare against `parameters_schema` (JSON Schema)
3. **Check rate limit**: `rate_limit_per_min` per tool
4. **Build request**: 
   - URL from `endpoint_url`
   - Method from `method` (default POST)
   - Headers from `headers` + auth headers based on `auth_type`
   - Body: `params` as JSON
5. **Execute**: `fetch()` with `timeout_ms` (AbortController)
6. **Retry**: Up to `retry_count` on failure
7. **Log**: Insert into `tool_execution_logs`
8. **Return**: Parsed response

## Auth Types

| Type | Header Added |
|------|-------------|
| `none` | (none) |
| `api_key` | `Authorization: Bearer <key>` |
| `bearer` | `Authorization: Bearer <token>` |
| `oauth2` | `Authorization: Bearer <access_token>` (refresh logic TBD) |

## Orchestrator Integration

When an agent has MCP tools linked (via `agent_tools` table):

1. Orchestrator loads tool definitions via `agent_tools` JOIN `mcp_tools`
2. Tool definitions are formatted into the system prompt:
   ```
   You have access to the following tools:
   - echo: Echo a message. Params: {"message": "string"}
   
   To call a tool, respond with: TOOL_CALL: <tool_name> <json_params>
   ```
3. If LLM response matches `TOOL_CALL: <name> {params}`:
   - Orchestrator parses the tool name and params
   - Calls `executeTool(toolId, params)` (same as `/mcp/call`)
   - Injects tool result into context
   - Re-generates response with tool output
4. Final response (without `TOOL_CALL:`) is sent to user
