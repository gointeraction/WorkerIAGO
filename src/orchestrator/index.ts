import { ActionEngine } from '../actions';
import { 
  classifyIntent, 
  detectActions, 
  generateAgentResponse, 
  generateEmbedding,
  type AIConfig,
  MODELS
} from '../ai';
import { buildRagContext, type KnowledgeEnv } from '../knowledge';
import { executeTool, getAgentToolDefinitions, type McpTool } from '../mcp';
import { aiWithFallback, logAiRequest, type AiGatewayEnv } from '../gateway';

interface Env {
  AI: Ai;
  DB: D1Database;
  VECTORIZE: VectorizeIndex;
  CACHE: KVNamespace;
  STORAGE?: R2Bucket;
  AGENT_STATE: DurableObjectNamespace;
}

interface Message {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface Agent {
  id: string;
  name: string;
  type: string;
  system_prompt: string;
  model: string;
  tools: string[];
  temperature: number;
  max_tokens: number;
}

interface OrchestratorResult {
  response: string;
  agent: string;
  intent: string;
  actions?: string[];
  sources?: string[];
  escalate?: boolean;
}

export class AgentOrchestrator {
  private env: Env;
  private actionEngine: ActionEngine;
  private aiConfig: AIConfig;
  private tenantId: string;

  constructor(env: Env, tenantId: string = 'default') {
    this.env = env;
    this.tenantId = tenantId;
    this.actionEngine = new ActionEngine(env);
    this.aiConfig = {
      provider: 'workers',
      ai: env.AI
    };
  }

  async processMessage(
    message: string,
    chatId: string,
    channel: string,
    history: Message[] = [],
    agentId?: string
  ): Promise<OrchestratorResult> {
    try {
      // 1. Obtener agente activo
      const agent = agentId ? await this.getAgentById(agentId) : await this.getDefaultAgent();
      if (!agent) {
        return { response: 'No hay agentes configurados.', agent: 'none', intent: 'error' };
      }

      // 2. Clasificar intención
      let intent = 'general';
      try {
        intent = await classifyIntent(this.aiConfig, message);
      } catch (e) {
        console.error('Intent classification failed:', e);
      }

      // 3. Buscar contexto en Vectorize (RAG)
      let context: any[] = [];
      try {
        context = await this.searchKnowledge(message, agent.id);
      } catch (e) {
        console.error('Knowledge search failed:', e);
      }

      // 4. Cargar MCP tools del agente
      let mcpTools: any[] = [];
      let toolDefs: any[] = [];
      try {
        const linked = await this.env.DB.prepare(
          'SELECT t.* FROM mcp_tools t INNER JOIN agent_tools at ON t.id = at.tool_id WHERE at.agent_id = ? AND t.is_active = 1 AND t.tenant_id = ?'
        ).bind(agent.id, this.tenantId).all();
        mcpTools = linked.results || [];
        toolDefs = mcpTools.map(t => ({
          id: t.id, name: t.name, description: t.description,
          parameters_schema: JSON.parse(t.parameters_schema || '{}')
        }));
      } catch (e) {
        console.error('MCP tools load failed:', e);
      }

      // 5. Generar respuesta (con tools como contexto)
      let response: string;
      try {
        const toolsPrompt = toolDefs.length > 0
          ? `\n\nHERRAMIENTAS DISPONIBLES:\n${toolDefs.map(t => `- ${t.name}: ${t.description}. Parámetros: ${JSON.stringify(t.parameters_schema)}`).join('\n')}\n\nSi necesitas usar una herramienta, DEBES responder ÚNICAMENTE con un JSON en este formato:\n{"tool_call": {"name": "<nombre_herramienta>", "params": {<json_params>}}}\nEjemplo:\n{"tool_call": {"name": "echo", "params": {"message":"hola"}}}`
          : '';
        response = await generateAgentResponse(
          this.aiConfig,
          message,
          agent.system_prompt + toolsPrompt,
          this.buildContext(context, []),
          history
        );

        // Si el LLM decide llamar un tool, ejecutar y generar respuesta final
        let toolCallAttempt: { name: string, params: any } | null = null;
        try {
          const cleanResponse = response.replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
          const parsed = JSON.parse(cleanResponse);
          if (parsed && parsed.tool_call && parsed.tool_call.name) {
            toolCallAttempt = parsed.tool_call;
          }
        } catch (e) {
          // No es un JSON estructurado de tool call, continuar como respuesta normal
        }

        if (toolCallAttempt) {
          console.log('TOOL_CALL detected (JSON):', toolCallAttempt, 'mcpTools:', mcpTools.map(t => ({ id: t.id, name: t.name })));
          const toolIdent = toolCallAttempt.name.toLowerCase();
          const tool = mcpTools.find(t =>
            t.id?.toLowerCase() === toolIdent ||
            t.name?.toLowerCase() === toolIdent ||
            t.id?.toLowerCase().includes(toolIdent) ||
            toolIdent.includes(t.id?.toLowerCase() || '###')
          );
          if (tool) {
            let params: any = toolCallAttempt.params || {};
              const { executeTool } = await import('../mcp');
              const toolResult = await executeTool(this.env.DB, tool as any, params, agent.id, parseInt(chatId) || undefined);
              // Re-generar respuesta con el resultado del tool
              const toolContext = `\nRESULTADO DE HERRAMIENTA ${tool.name}:\n${JSON.stringify(toolResult.data || toolResult.error)}`;
              response = await generateAgentResponse(
                this.aiConfig,
                message,
                agent.system_prompt,
                this.buildContext(context, []) + toolContext,
                history
              );
          }
        }
      } catch (e) {
        console.error('Response generation failed:', e);
        response = 'Disculpa, no pude procesar tu mensaje. Por favor, intenta de nuevo.';
      }

      // 6. Guardar conversación
      try {
        await this.saveConversation(message, response, agent, intent, chatId, channel);
      } catch (e) {
        console.error('Save conversation failed:', e);
      }

      return {
        response,
        agent: agent.id,
        intent,
        actions: [],
        sources: context.map(c => c.metadata?.title || ''),
        escalate: intent === 'escalate'
      };
    } catch (error: any) {
      console.error('Orchestrator fatal error:', error);
      return { 
        response: 'Disculpa, estoy teniendo problemas técnicos. Intenta de nuevo.',
        agent: 'none',
        intent: 'error'
      };
    }
  }

  private async getDefaultAgent(): Promise<Agent | null> {
    const agent = await this.env.DB.prepare(
      'SELECT * FROM agents WHERE is_active = 1 AND tenant_id = ? ORDER BY created_at ASC LIMIT 1'
    ).bind(this.tenantId).first<Agent>();
    return agent;
  }

  private async getAgentById(id: string): Promise<Agent | null> {
    const agent = await this.env.DB.prepare(
      'SELECT * FROM agents WHERE id = ? AND tenant_id = ?'
    ).bind(id, this.tenantId).first<Agent>();
    return agent;
  }

  private async searchKnowledge(query: string, agentId: string): Promise<any[]> {
    try {
      const knowledgeEnv: KnowledgeEnv = {
        DB: this.env.DB,
        VECTORIZE: this.env.VECTORIZE,
        STORAGE: this.env.STORAGE,
        AI: this.env.AI,
      };
      const context = await buildRagContext(knowledgeEnv, query, agentId, 5, this.tenantId);
      console.log('RAG context:', context ? `[${context.length} chars]` : '[empty]', 'for agent:', agentId, 'tenant:', this.tenantId, 'query:', query);
      return context ? [{ metadata: { content: context } }] : [];
    } catch (error) {
      console.error('Knowledge search error:', error);
      return [];
    }
  }

  private buildContext(context: any[], actionResults: any[]): string {
    const parts: string[] = [];
    
    if (context.length > 0) {
      parts.push('BASE DE CONOCIMIENTO:');
      context.forEach(c => {
        parts.push(`- ${c.metadata?.title}: ${c.metadata?.content}`);
      });
    }
    
    if (actionResults.length > 0) {
      parts.push('RESULTADOS DE ACCIONES:');
      actionResults.forEach(r => {
        parts.push(`- ${r.action}: ${JSON.stringify(r.result)}`);
      });
    }
    
    return parts.join('\n');
  }

  private async saveConversation(
    message: string,
    response: string,
    agent: Agent,
    intent: string,
    chatId: string,
    channel: string
  ): Promise<void> {
    try {
      let conversation = await this.env.DB.prepare(
        'SELECT id FROM conversations WHERE chat_id = ? AND channel = ? AND status = "active" AND tenant_id = ?'
      ).bind(chatId, channel, this.tenantId).first<{ id: number }>();

      if (!conversation) {
        const result = await this.env.DB.prepare(
          'INSERT INTO conversations (agent_id, channel, chat_id, intent, tenant_id) VALUES (?, ?, ?, ?, ?)'
        ).bind(agent.id, channel, chatId, intent, this.tenantId).run();
        conversation = { id: result.meta.last_row_id as number };
      }

      await this.env.DB.prepare(
        'INSERT INTO messages (conversation_id, role, content, tenant_id) VALUES (?, "user", ?, ?)'
      ).bind(conversation.id, message, this.tenantId).run();

      await this.env.DB.prepare(
        'INSERT INTO messages (conversation_id, role, content, tenant_id) VALUES (?, "assistant", ?, ?)'
      ).bind(conversation.id, response, this.tenantId).run();

      await this.env.DB.prepare(
        'UPDATE conversations SET intent = ?, updated_at = datetime("now") WHERE id = ?'
      ).bind(intent, conversation.id).run();

    } catch (error) {
      console.error('Save conversation error:', error);
    }
  }
}
