import { ActionEngine } from '../actions';
import { 
  classifyIntent, 
  detectActions, 
  generateAgentResponse, 
  generateEmbedding,
  type AIConfig,
  MODELS
} from '../ai';

interface Env {
  AI: any;
  DB: D1Database;
  VECTORIZE: VectorizeIndex;
  CACHE: KVNamespace;
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

  constructor(env: Env) {
    this.env = env;
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
    history: Message[] = []
  ): Promise<OrchestratorResult> {
    try {
      // 1. Obtener agente activo
      const agent = await this.getDefaultAgent();
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

      // 4. Detectar acciones a ejecutar
      let actions: any[] = [];
      try {
        actions = await detectActions(this.aiConfig, message, agent.tools || []);
      } catch (e) {
        console.error('Action detection failed:', e);
      }

      // 5. Ejecutar acciones
      let actionResults: any[] = [];
      if (actions.length > 0) {
        try {
          actionResults = await this.actionEngine.executeActions(actions, {
            chatId,
            channel,
            message,
            agentId: agent.id
          });
        } catch (e) {
          console.error('Action execution failed:', e);
        }
      }

      // 6. Generar respuesta
      let response: string;
      try {
        response = await generateAgentResponse(
          this.aiConfig,
          message,
          agent.system_prompt,
          this.buildContext(context, actionResults),
          history
        );
      } catch (e) {
        console.error('Response generation failed:', e);
        response = 'Disculpa, no pude procesar tu mensaje. Por favor, intenta de nuevo.';
      }

      // 7. Guardar conversación
      try {
        await this.saveConversation(message, response, agent, intent, chatId, channel);
      } catch (e) {
        console.error('Save conversation failed:', e);
      }

      return {
        response,
        agent: agent.id,
        intent,
        actions: actions.map(a => a.name),
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
      'SELECT * FROM agents WHERE is_active = 1 ORDER BY created_at ASC LIMIT 1'
    ).first<Agent>();
    return agent;
  }

  private async searchKnowledge(query: string, agentId: string): Promise<any[]> {
    try {
      // Generar embedding usando Workers AI
      const embedding = await generateEmbedding(this.aiConfig, query);

      // Buscar en Vectorize
      const results = await this.env.VECTORIZE.query(embedding, {
        topK: 3,
        namespace: agentId
      });

      return results.matches || [];
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
        'SELECT id FROM conversations WHERE chat_id = ? AND channel = ? AND status = "active"'
      ).bind(chatId, channel).first<{ id: number }>();

      if (!conversation) {
        const result = await this.env.DB.prepare(
          'INSERT INTO conversations (agent_id, channel, chat_id, intent) VALUES (?, ?, ?, ?)'
        ).bind(agent.id, channel, chatId, intent).run();
        conversation = { id: result.meta.last_row_id as number };
      }

      await this.env.DB.prepare(
        'INSERT INTO messages (conversation_id, role, content) VALUES (?, "user", ?)'
      ).bind(conversation.id, message).run();

      await this.env.DB.prepare(
        'INSERT INTO messages (conversation_id, role, content) VALUES (?, "assistant", ?)'
      ).bind(conversation.id, response).run();

      await this.env.DB.prepare(
        'UPDATE conversations SET intent = ?, updated_at = datetime("now") WHERE id = ?'
      ).bind(intent, conversation.id).run();

    } catch (error) {
      console.error('Save conversation error:', error);
    }
  }
}
