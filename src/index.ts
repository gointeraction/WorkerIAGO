import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { AgentOrchestrator } from './orchestrator';
import { TelegramChannel } from './channels/telegram';
import { WhatsAppChannel } from './channels/whatsapp';
import { WebChannel } from './channels/web';
import { AdminPanel } from './admin';
import { AgentState } from './durable-object';
import { generateEmbedding } from './ai';

// =============================================================================
// BINDINGS - Cloudflare AI, D1, Vectorize, KV, Durable Objects
// =============================================================================
type Bindings = {
  // Cloudflare AI - Workers AI
  AI: any;
  
  // D1 - Conversaciones, leads, configuración
  DB: D1Database;
  
  // Vectorize - Base de conocimiento RAG (bge-m3)
  VECTORIZE: VectorizeIndex;
  
  // KV - Cache de respuestas
  CACHE: KVNamespace;
  
  // Durable Objects - Estado de conversaciones
  AGENT_STATE: DurableObjectNamespace;
  
  // Variables de entorno
  ENVIRONMENT: string;
  TELEGRAM_BOT_TOKEN?: string;
  WHATSAPP_TOKEN?: string;
  WHATSAPP_PHONE_ID?: string;
  ADMIN_PASSWORD?: string;
};

const app = new Hono<{ Bindings: Bindings }>();

// CORS for admin panel
app.use('/admin/*', cors());

// Health check
app.get('/', (c) => {
  return c.json({
    name: 'WorkerIAGO',
    version: '1.0.0',
    status: 'running',
    docs: '/admin'
  });
});

// Test AI endpoint
app.get('/api/test-ai', async (c) => {
  try {
    const ai = c.env.AI;
    if (!ai) {
      return c.json({ error: 'AI binding not available' }, 500);
    }
    
    const result = await ai.run('@cf/meta/llama-3.1-8b-instruct', {
      messages: [{ role: 'user', content: 'Responde solo: Hola mundo' }],
      max_tokens: 10
    });
    
    return c.json({ 
      success: true, 
      response: result.response,
      model: '@cf/meta/llama-3.1-8b-instruct'
    });
  } catch (error: any) {
    return c.json({ error: error?.message || 'Unknown error' }, 500);
  }
});

// Webhook de Telegram
app.post('/webhook/telegram', async (c) => {
  const token = c.env.TELEGRAM_BOT_TOKEN;
  if (!token) return c.json({ error: 'Telegram not configured' }, 503);

  const update = await c.req.json();
  const channel = new TelegramChannel(token);

  // Crear orchestrator con manejo de errores
  const env = c.env;
  const orchestrator = new AgentOrchestrator({
    AI: env.AI,
    DB: env.DB,
    VECTORIZE: env.VECTORIZE,
    CACHE: env.CACHE,
    AGENT_STATE: env.AGENT_STATE
  });

  try {
    const result = await channel.handleUpdate(update, orchestrator);
    return c.json(result);
  } catch (error: any) {
    console.error('Telegram webhook error:', error?.message || error);
    
    // Intentar enviar un mensaje de error al usuario
    try {
      const message = update.message;
      if (message?.chat?.id) {
        await channel.sendMessage(
          message.chat.id.toString(),
          'Disculpa, estoy teniendo problemas técnicos. Por favor, intenta de nuevo en unos segundos.'
        );
      }
    } catch (e) {
      console.error('Error sending error message:', e);
    }
    
    return c.json({ error: 'Internal error', details: error?.message }, 500);
  }
});

// Webhook de WhatsApp
app.post('/webhook/whatsapp', async (c) => {
  const token = c.env.WHATSAPP_TOKEN;
  const phoneId = c.env.WHATSAPP_PHONE_ID;
  if (!token || !phoneId) return c.json({ error: 'WhatsApp not configured' }, 503);

  const body = await c.req.json();
  const channel = new WhatsAppChannel(token, phoneId);
  const orchestrator = new AgentOrchestrator(c.env);

  try {
    const result = await channel.handleWebhook(body, orchestrator);
    return c.json(result);
  } catch (error) {
    console.error('WhatsApp webhook error:', error);
    return c.json({ error: 'Internal error' }, 500);
  }
});

// API para canal Web (chat widget)
app.post('/api/chat', async (c) => {
  const { message, chatId, agentId } = await c.req.json();
  const channel = new WebChannel();
  const orchestrator = new AgentOrchestrator(c.env);

  try {
    const result = await channel.handleMessage(message, chatId, agentId, orchestrator);
    return c.json(result);
  } catch (error) {
    console.error('Web chat error:', error);
    return c.json({ error: 'Internal error' }, 500);
  }
});

// Admin API
app.route('/admin', AdminPanel);

// API para gestión de agentes
app.get('/api/agents', async (c) => {
  const { results } = await c.env.DB.prepare('SELECT * FROM agents ORDER BY created_at DESC').all();
  return c.json(results);
});

app.post('/api/agents', async (c) => {
  const agent = await c.req.json();
  const id = agent.id || `agent-${Date.now()}`;
  
  await c.env.DB.prepare(
    'INSERT INTO agents (id, name, description, type, system_prompt, model, tools) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).bind(id, agent.name, agent.description, agent.type, agent.system_prompt, agent.model || '@cf/meta/llama-3.1-8b-instruct', JSON.stringify(agent.tools || []))
    .run();

  return c.json({ id, ...agent }, 201);
});

app.get('/api/agents/:id', async (c) => {
  const id = c.req.param('id');
  const agent = await c.env.DB.prepare('SELECT * FROM agents WHERE id = ?').bind(id).first();
  if (!agent) return c.json({ error: 'Agent not found' }, 404);
  return c.json(agent);
});

app.put('/api/agents/:id', async (c) => {
  const id = c.req.param('id');
  const updates = await c.req.json();
  
  await c.env.DB.prepare(
    'UPDATE agents SET name = ?, description = ?, system_prompt = ?, model = ?, tools = ?, updated_at = datetime("now") WHERE id = ?'
  ).bind(updates.name, updates.description, updates.system_prompt, updates.model, JSON.stringify(updates.tools || []), id)
    .run();

  return c.json({ id, ...updates });
});

// API para knowledge base
app.get('/api/knowledge/:agentId', async (c) => {
  const agentId = c.req.param('agentId');
  const { results } = await c.env.DB.prepare(
    'SELECT * FROM knowledge_base WHERE agent_id = ? ORDER BY created_at DESC'
  ).bind(agentId).all();
  return c.json(results);
});

app.post('/api/knowledge/:agentId', async (c) => {
  const agentId = c.req.param('agentId');
  const doc = await c.req.json();
  
  // Generar embedding usando Cloudflare Workers AI
  const aiConfig = { provider: 'workers' as const, ai: c.env.AI };
  const embedding = await generateEmbedding(aiConfig, doc.content);

  const vectorId = `kb-${Date.now()}`;
  await c.env.VECTORIZE.insert([{
    id: vectorId,
    values: embedding,
    metadata: { agentId, title: doc.title, content: doc.content, category: doc.category }
  }]);

  // Guardar en D1
  await c.env.DB.prepare(
    'INSERT INTO knowledge_base (agent_id, title, content, category, vector_id, source) VALUES (?, ?, ?, ?, ?, ?)'
  ).bind(agentId, doc.title, doc.content, doc.category, vectorId, doc.source || 'manual')
    .run();

  return c.json({ id: vectorId, ...doc }, 201);
});

// API para conversations
app.get('/api/conversations', async (c) => {
  const { results } = await c.env.DB.prepare(
    'SELECT c.*, a.name as agent_name FROM conversations c LEFT JOIN agents a ON c.agent_id = a.id ORDER BY c.updated_at DESC LIMIT 100'
  ).all();
  return c.json(results);
});

app.get('/api/conversations/:id/messages', async (c) => {
  const id = c.req.param('id');
  const { results } = await c.env.DB.prepare(
    'SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC'
  ).bind(id).all();
  return c.json(results);
});

// API para leads
app.get('/api/leads', async (c) => {
  const { results } = await c.env.DB.prepare(
    'SELECT l.*, a.name as agent_name FROM leads l LEFT JOIN agents a ON l.agent_id = a.id ORDER BY l.score DESC LIMIT 100'
  ).all();
  return c.json(results);
});

// API para stats
app.get('/api/stats', async (c) => {
  const [conversations, leads, messages, agents] = await Promise.all([
    c.env.DB.prepare('SELECT COUNT(*) as count FROM conversations WHERE created_at > datetime("now", "-24 hours")').first(),
    c.env.DB.prepare('SELECT COUNT(*) as count FROM leads WHERE created_at > datetime("now", "-24 hours")').first(),
    c.env.DB.prepare('SELECT COUNT(*) as count FROM messages WHERE created_at > datetime("now", "-24 hours")').first(),
    c.env.DB.prepare('SELECT COUNT(*) as count FROM agents WHERE is_active = 1').first(),
  ]);

  return c.json({
    conversations_24h: conversations?.count || 0,
    leads_24h: leads?.count || 0,
    messages_24h: messages?.count || 0,
    active_agents: agents?.count || 0
  });
});

export { AgentState };
export default app;
