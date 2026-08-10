/**
 * MCP Server — Expose agents and tools as MCP endpoints
 * 
 * Implements the Model Context Protocol for tool discovery and execution.
 * Other agents or clients can call these endpoints to use registered tools.
 * 
 * Endpoints:
 *   GET  /mcp        → MCP manifest (tools/capabilities)
 *   POST /mcp/call    → Execute a tool
 *   GET  /mcp/tools   → List all available tools
 */

export interface McpServerEnv {
  DB: D1Database;
  AI: Ai;
  VECTORIZE?: VectorizeIndex;
}

// ═══════════════════════════════════════════════════════════════════════════════
// MCP Protocol: Tool Manifest
// ═══════════════════════════════════════════════════════════════════════════════
export async function getMcpManifest(env: McpServerEnv): Promise<any> {
  // Get all active agents
  const agents = await env.DB.prepare(
    `SELECT id, name, description, type FROM agents WHERE is_active = 1`
  ).all();

  // Get all active MCP tools
  const tools = await env.DB.prepare(
    `SELECT id, name, description, parameters_schema, category FROM mcp_tools WHERE is_active = 1`
  ).all();

  return {
    name: 'WorkerIAGO MCP Server',
    version: '1.0.0',
    description: 'MCP server exposing agents and custom tools for WorkerIAGO platform',
    capabilities: {
      tools: true,
      resources: false,
      prompts: false,
    },
    tools: [
      // Agent tools — each agent becomes a callable tool
      ...(agents.results || []).map((agent: any) => ({
        name: `agent_${agent.id.replace(/-/g, '_').slice(0, 8)}`,
        description: `[Agent] ${agent.name}: ${agent.description || agent.type}`,
        category: 'agent',
        parameters: {
          type: 'object',
          properties: {
            message: {
              type: 'string',
              description: 'Message to send to this agent',
            },
            conversation_id: {
              type: 'string',
              description: 'Optional conversation ID for context',
            },
          },
          required: ['message'],
        },
      })),
      // Custom MCP tools
      ...(tools.results || []).map((tool: any) => ({
        name: tool.name,
        description: tool.description,
        category: tool.category,
        parameters: typeof tool.parameters_schema === 'string'
          ? JSON.parse(tool.parameters_schema)
          : tool.parameters_schema,
      })),
    ],
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// MCP Protocol: Tool Execution
// ═══════════════════════════════════════════════════════════════════════════════
export async function executeMcpTool(
  env: McpServerEnv,
  toolName: string,
  params: Record<string, any>,
  callerAgentId?: string
): Promise<any> {
  // Check if it's an agent call
  if (toolName.startsWith('agent_')) {
    const agentIdShort = toolName.replace('agent_', '');
    // Find agent by short ID
    const agent: any = await env.DB.prepare(
      `SELECT * FROM agents WHERE REPLACE(id, '-', '') LIKE ? || '%'`
    ).bind(agentIdShort).first();

    if (!agent) {
      return { success: false, error: `Agent not found: ${toolName}` };
    }

    // Call the agent's LLM
    const systemPrompt = (agent as any).system_prompt || 'You are a helpful assistant.';
    const model = (agent as any).model || '@cf/meta/llama-3.1-8b-instruct-fp8';
    const temperature = (agent as any).temperature || 0.7;

    // Get conversation context if provided
    let context = '';
    if (params.conversation_id) {
      const messages = await env.DB.prepare(
        `SELECT role, content FROM messages WHERE conversation_id = ? ORDER BY id DESC LIMIT 10`
      ).bind(params.conversation_id).all();
      
      context = (messages.results || [])
        .map((m: any) => `${m.role}: ${m.content}`)
        .join('\n');
    }

    // Get RAG context
    let ragContext = '';
    if (env.VECTORIZE) {
      try {
        const { buildRagContext } = await import('../knowledge');
        ragContext = await buildRagContext(
          { DB: env.DB, VECTORIZE: env.VECTORIZE, AI: env.AI } as any,
          params.message,
          agent.id,
          3
        );
      } catch (e) {
        // No RAG context available
      }
    }

    const messages = [
      {
        role: 'system',
        content: systemPrompt
          + (ragContext ? `\n\nBASE DE CONOCIMIENTO:\n${ragContext}` : '')
          + (context ? `\n\nHISTORIAL:\n${context}` : ''),
      },
      { role: 'user', content: params.message },
    ] as any[];

    try {
      const result: any = await env.AI.run(model as any, {
        messages,
        temperature,
        max_tokens: 512,
      });

      // Log usage
      try {
        await env.DB.prepare(
          `INSERT INTO ai_logs (request_id, agent_id, model, tokens_input, tokens_output, latency_ms, status, action)
           VALUES (?, ?, ?, ?, ?, ?, 'success', 'mcp_call')`
        ).bind(
          crypto.randomUUID(),
          agent.id,
          model,
          params.message.length / 4,
          result.response?.length / 4 || 0,
          0
        ).run();
      } catch (e) {}

      return {
        success: true,
        agent_id: agent.id,
        agent_name: (agent as any).name,
        response: result.response as string,
      };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  }

  // Check if it's a registered MCP tool
  const tool = await env.DB.prepare(
    `SELECT * FROM mcp_tools WHERE name = ? AND is_active = 1`
  ).bind(toolName).first() as any;

  if (!tool) {
    return { success: false, error: `Tool not found: ${toolName}` };
  }

  // Execute via the MCP engine
  const { executeTool } = await import('../mcp');
  return await executeTool(env.DB, tool, params, callerAgentId);
}

// ═══════════════════════════════════════════════════════════════════════════════
// MCP Protocol: List Tools
// ═══════════════════════════════════════════════════════════════════════════════
export async function listMcpTools(env: McpServerEnv): Promise<any[]> {
  const manifest = await getMcpManifest(env);
  return manifest.tools;
}
