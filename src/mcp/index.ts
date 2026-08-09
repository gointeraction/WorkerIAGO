/**
 * MCP Tools — Model Context Protocol tool execution engine
 */

export interface McpTool {
  id: string;
  name: string;
  description: string;
  category: string;
  handler_type: string;
  endpoint_url?: string;
  method: string;
  headers?: Record<string, string>;
  parameters_schema: Record<string, any>;
  response_schema?: Record<string, any>;
  auth_type: string;
  auth_config?: Record<string, string>;
  timeout_ms: number;
  retry_count: number;
  is_active: number;
  usage_count: number;
  avg_latency_ms: number;
}

export interface ToolCall {
  tool_id: string;
  agent_id?: string;
  conversation_id?: number;
  input_params: Record<string, any>;
}

export interface ToolResult {
  success: boolean;
  data?: any;
  error?: string;
  latency_ms: number;
  tokens_used?: number;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Tool Execution
// ═══════════════════════════════════════════════════════════════════════════════
export async function executeTool(
  db: D1Database,
  tool: McpTool,
  params: Record<string, any>,
  agentId?: string,
  conversationId?: number
): Promise<ToolResult> {
  const startTime = Date.now();
  let status = 'success';
  let data: any = undefined;
  let errorMsg: string | undefined;

  try {
    // 1. Validate parameters against schema
    const validation = validateParams(params, tool.parameters_schema);
    if (!validation.valid) {
      throw new Error(`Invalid parameters: ${validation.errors.join(', ')}`);
    }

    // 2. Build request
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(tool.headers || {}),
    };

    // Add auth
    if (tool.auth_type === 'api_key' && tool.auth_config?.api_key) {
      headers['Authorization'] = `Bearer ${tool.auth_config.api_key}`;
    } else if (tool.auth_type === 'bearer' && tool.auth_config?.token) {
      headers['Authorization'] = `Bearer ${tool.auth_config.token}`;
    }

    // 3. Execute with retries
    let lastError: string = '';
    for (let attempt = 0; attempt <= tool.retry_count; attempt++) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), tool.timeout_ms);

        const res = await fetch(tool.endpoint_url!, {
          method: tool.method,
          headers,
          body: tool.method !== 'GET' ? JSON.stringify(params) : undefined,
          signal: controller.signal,
        });
        clearTimeout(timeout);

        if (!res.ok) {
          throw new Error(`HTTP ${res.status}: ${await res.text()}`);
        }

        data = await res.json();
        lastError = '';
        break;
      } catch (e: any) {
        lastError = e.message;
        if (attempt < tool.retry_count) {
          await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
        }
      }
    }

    if (lastError) throw new Error(lastError);
  } catch (e: any) {
    status = 'error';
    errorMsg = e.message;
  }

  const latencyMs = Date.now() - startTime;

  // 4. Log execution
  try {
    await db.prepare(
      `INSERT INTO tool_execution_logs 
       (tool_id, agent_id, conversation_id, input_params, output_result, status, error_message, latency_ms)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      tool.id, agentId || null, conversationId || null,
      JSON.stringify(params), status === 'success' ? JSON.stringify(data) : null,
      status, errorMsg || null, latencyMs
    ).run();

    // Update tool stats
    await db.prepare(
      `UPDATE mcp_tools SET 
        usage_count = usage_count + 1,
        avg_latency_ms = (avg_latency_ms * usage_count + ?) / (usage_count + 1),
        last_used_at = datetime('now'),
        updated_at = datetime('now')
       WHERE id = ?`
    ).bind(latencyMs, tool.id).run();
  } catch (e) {
    console.error('Failed to log tool execution:', e);
  }

  return {
    success: status === 'success',
    data,
    error: errorMsg,
    latency_ms: latencyMs,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// Parameter Validation
// ═══════════════════════════════════════════════════════════════════════════════
function validateParams(
  params: Record<string, any>,
  schema: Record<string, any>
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  const required = schema.required || [];

  for (const field of required) {
    if (params[field] === undefined || params[field] === null || params[field] === '') {
      errors.push(`Missing required field: ${field}`);
    }
  }

  return { valid: errors.length === 0, errors };
}

// ═══════════════════════════════════════════════════════════════════════════════
// Get tool definitions for AI function calling format
// ═══════════════════════════════════════════════════════════════════════════════
export function toAiToolDefinition(tool: McpTool): Record<string, any> {
  return {
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters_schema,
  };
}

export async function getAgentToolDefinitions(
  db: D1Database,
  agentId: string
): Promise<Record<string, any>[]> {
  const tools = await db.prepare(`
    SELECT t.* FROM mcp_tools t
    JOIN agent_tools at ON t.id = at.tool_id
    WHERE at.agent_id = ? AND at.is_enabled = 1 AND t.is_active = 1
  `).bind(agentId).all<McpTool>();

  return (tools.results || []).map(toAiToolDefinition);
}
