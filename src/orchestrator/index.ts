import { ActionEngine } from '../actions';
import { 
  classifyIntent, 
  detectActions, 
  generateAgentResponse, 
  generateEmbedding,
  type AIProvider,
  type AIConfig
} from '../ai';

interface Env {
  DB: D1Database;
  VECTORIZE: VectorizeIndex;
  CACHE: KVNamespace;
  AGENT_STATE: DurableObjectNamespace;
  AI_PROVIDER: AIProvider;
  AI_API_KEY?: string;
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
  media?: { type: string; url: string }[];
}

export class AgentOrchestrator {
  private env: Env;
  private actionEngine: ActionEngine;
  private aiConfig: AIConfig;

  constructor(env: Env) {
    this.env = env;
    this.actionEngine = new ActionEngine(env);
    this.aiConfig = {
      provider: env.AI_PROVIDER || 'openai',
      apiKey: env.AI_API_KEY
    };
  }

  async processMessage(
    message: string,
    chatId: string,
    channel: string,
    history: Message[] = []
  ): Promise<OrchestratorResult> {
    // 1. Obtener agente activo
    const agent = await this.getDefaultAgent();
    if (!agent) {
      return { response: 'No hay agentes configurados.', agent: 'none', intent: 'error' };
    }

    // 2. Clasificar intención
    const intent = await classifyIntent(this.aiConfig, message);

    // 3. Buscar contexto en Vectorize (RAG)
    const context = await this.searchKnowledge(message, agent.id);

    // 4. Detectar acciones a ejecutar
    const actions = await detectActions(this.aiConfig, message, agent.tools || []);

    // 5. Ejecutar acciones
    let actionResults: any[] = [];
    if (actions.length > 0) {
      actionResults = await this.actionEngine.executeActions(actions, {
        chatId,
        channel,
        message,
        agentId: agent.id
      });
    }

    // 6. Generar respuesta
    const response = await generateAgentResponse(
      this.aiConfig,
      message,
      agent.system_prompt,
      this.buildContext(context, actionResults),
      history
    );

    // 7. Buscar media relevante si existe
    const media = await this.searchMedia(message, agent.id);

    // 8. Guardar conversación
    await this.saveConversation(message, response, agent, intent, chatId, channel);

    return {
      response,
      agent: agent.id,
      intent,
      actions: actions.map(a => a.name),
      sources: context.map(c => c.metadata?.title || ''),
      escalate: intent === 'escalate',
      media
    };
  }

  private async getDefaultAgent(): Promise<Agent | null> {
    const agent = await this.env.DB.prepare(
      'SELECT * FROM agents WHERE is_active = 1 ORDER BY created_at ASC LIMIT 1'
    ).first<Agent>();
    return agent;
  }

  private async searchKnowledge(query: string, agentId: string): Promise<any[]> {
    try {
      // Generar embedding usando AI SDK
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

  private async searchMedia(query: string, agentId: string): Promise<{ type: string; url: string }[]> {
    try {
      // Buscar imágenes/audios relacionados en R2
      const objects = await this.env.STORAGE.list({ prefix: `media/${agentId}/` });
      const media: { type: string; url: string }[] = [];
      
      for (const obj of objects.objects.slice(0, 3)) {
        const type = obj.key.endsWith('.jpg') || obj.key.endsWith('.png') ? 'image' :
                     obj.key.endsWith('.mp3') || obj.key.endsWith('.ogg') ? 'audio' : 'file';
        media.push({ type, url: `/media/${obj.key}` });
      }
      
      return media;
    } catch (error) {
      console.error('Media search error:', error);
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

  private async generateResponse(
    message: string,
    agent: Agent,
    context: any[],
    actionResults: any[],
    history: Message[]
  ): Promise<string> {
    const contextText = this.buildContext(context, actionResults);
    
    const systemPrompt = `${agent.system_prompt}${contextText ? `\n\n${contextText}` : ''}

IMPORTANTE: Responde en el mismo idioma del usuario. Sé conciso y útil.`;

    const messages: Message[] = [
      { role: 'system', content: systemPrompt },
      ...history.slice(-10),
      { role: 'user', content: message }
    ];

    try {
      return await generateAgentResponse(this.aiConfig, message, agent.system_prompt, contextText, history);
    } catch (error) {
      console.error('Response generation error:', error);
      return 'Disculpa, tuve un problema al procesar tu mensaje. Por favor, intenta de nuevo.';
    }
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
