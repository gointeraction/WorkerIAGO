# Chat API Contract

## POST /api/chat

Chat with an AI agent. Returns response with RAG sources and classified intent.

### Request

```json
{
  "message": "string (required) — user message",
  "chatId": "string (required) — unique chat identifier from channel",
  "agentId": "string (optional) — specific agent ID, falls back to first active agent",
  "channel": "string (optional, default 'api') — origin channel"
}
```

### Response (200)

```json
{
  "response": "string — agent's reply text",
  "agent": {
    "id": "string",
    "name": "string",
    "model": "string"
  },
  "intent": "string — classified intent (support|sales|booking|escalation)",
  "sources": [
    {
      "id": "number",
      "title": "string",
      "score": "number (0-1)",
      "content": "string (truncated)"
    }
  ],
  "conversationId": "number"
}
```

### Response (500)

```json
{
  "error": "string — error message"
}
```

### Orchestrator Pipeline

1. `getAgentById(agentId)` — fetch agent from D1 (fallback to `getDefaultAgent`)
2. `classifyIntent(message)` — Llama 3.2 3B classifies: support/sales/booking/escalation
3. `searchKnowledge(message, agentId)` — embed query (768d) → Vectorize query with `metadata.agentId` filter → top 5 results
4. `loadAgentMCPTools(agentId)` — query `agent_tools` JOIN `mcp_tools` → build tool definitions for system prompt
5. `generateAgentResponse(systemPrompt + ragContext + tools + message)` — Llama 3.1 8B via AI Gateway (KV cache)
6. If response contains `TOOL_CALL: <toolId> {params}`:
   - `executeTool(toolId, params)` — HTTP fetch to tool endpoint
   - Re-generate response with tool result injected
7. `saveConversation()` — insert message into `messages`, update `conversations`

---

## POST /api/test-rag

Test RAG pipeline independently. Returns search results without generating a response.

### Request

```json
{
  "agentId": "string (required)",
  "query": "string (required)"
}
```

### Response (200)

```json
{
  "query": "string",
  "agentId": "string",
  "results": [
    {
      "id": "number",
      "title": "string",
      "content": "string",
      "score": "number"
    }
  ],
  "context": "string — formatted RAG context text"
}
```

---

## GET /api/agents

List all agents.

### Response (200)

```json
[
  {
    "id": "string",
    "name": "string",
    "description": "string",
    "type": "string",
    "model": "string",
    "is_active": "number (0|1)",
    "created_at": "string"
  }
]
```

---

## GET /api/agents/:id

Get agent details.

### Response (200)

```json
{
  "id": "string",
  "name": "string",
  "system_prompt": "string",
  "model": "string",
  "temperature": "number",
  "max_tokens": "number",
  "tools": "string (JSON array)",
  "is_active": "number"
}
```

---

## POST /api/agents

Create a new agent.

### Request

```json
{
  "name": "string (required)",
  "type": "string (default 'support')",
  "system_prompt": "string (required)",
  "model": "string (default '@cf/meta/llama-3.1-8b-instruct')",
  "temperature": "number (default 0.7)",
  "tools": "array (optional)"
}
```

### Response (201)

```json
{
  "id": "string (UUID)",
  "name": "string",
  "status": "created"
}
```

---

## GET /api/knowledge/:agentId

List knowledge base documents linked to an agent.

### Response (200)

```json
[
  {
    "id": "number",
    "title": "string",
    "content": "string",
    "category": "string",
    "vector_id": "string",
    "view_count": "number"
  }
]
```

---

## POST /api/knowledge/:agentId

Create a knowledge document, embed it, and link it to an agent.

### Request

```json
{
  "title": "string (required)",
  "content": "string (required)",
  "category": "string (optional)",
  "source": "string (optional)"
}
```

### Response (201)

```json
{
  "id": "number (auto-increment)",
  "vector_id": "string (Vectorize ID)",
  "status": "created"
}
```

---

## GET /api/stats

Dashboard statistics.

### Response (200)

```json
{
  "conversations": "number",
  "messages": "number",
  "tickets": "number",
  "leads": "number",
  "agents": "number",
  "activeAgents": "number"
}
```
