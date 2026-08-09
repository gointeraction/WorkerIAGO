import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { AgentOrchestrator } from './orchestrator';
import { TelegramChannel } from './channels/telegram';
import { WhatsAppChannel } from './channels/whatsapp';
import { WebChannel } from './channels/web';
import { AdminPanel } from './admin';
import { AgentState } from './durable-object';
import { generateEmbedding } from './ai';
import { tenantMiddleware } from './tenant/middleware';

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
  
  // R2 - Storage de archivos (opcional, crea bucket: wrangler r2 bucket create workeriago-storage)
  STORAGE?: R2Bucket;
  
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

// Tenant resolution middleware — applies to all routes
app.use('*', tenantMiddleware());

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
    
    const result = await ai.run('@cf/meta/llama-3.1-8b-instruct-fp8', {
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

  const tenantId = c.get('tenantId') || 'default';
  const env = c.env;
  const orchestrator = new AgentOrchestrator({
    AI: env.AI,
    DB: env.DB,
    VECTORIZE: env.VECTORIZE,
    CACHE: env.CACHE,
    AGENT_STATE: env.AGENT_STATE
  }, tenantId);

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
  const tenantId = c.get('tenantId') || 'default';
  const orchestrator = new AgentOrchestrator(c.env, tenantId);

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
  const tenantId = c.get('tenantId') || 'default';
  const orchestrator = new AgentOrchestrator(c.env, tenantId);

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
  const tenantId = c.get('tenantId') || 'default';
  const { results } = await c.env.DB.prepare('SELECT * FROM agents WHERE tenant_id = ? ORDER BY created_at DESC').bind(tenantId).all();
  return c.json(results);
});

app.post('/api/agents', async (c) => {
  const tenantId = c.get('tenantId') || 'default';
  const agent = await c.req.json();
  const id = agent.id || `agent-${Date.now()}`;
  
  await c.env.DB.prepare(
    'INSERT INTO agents (id, name, description, type, system_prompt, model, tools, tenant_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(id, agent.name, agent.description, agent.type, agent.system_prompt, agent.model || '@cf/meta/llama-3.1-8b-instruct', JSON.stringify(agent.tools || []), tenantId)
    .run();

  return c.json({ id, ...agent }, 201);
});

app.get('/api/agents/:id', async (c) => {
  const tenantId = c.get('tenantId') || 'default';
  const id = c.req.param('id');
  const agent = await c.env.DB.prepare('SELECT * FROM agents WHERE id = ? AND tenant_id = ?').bind(id, tenantId).first();
  if (!agent) return c.json({ error: 'Agent not found' }, 404);
  return c.json(agent);
});

app.put('/api/agents/:id', async (c) => {
  const tenantId = c.get('tenantId') || 'default';
  const id = c.req.param('id');
  const updates = await c.req.json();
  
  await c.env.DB.prepare(
    'UPDATE agents SET name = ?, description = ?, system_prompt = ?, model = ?, tools = ?, updated_at = datetime("now") WHERE id = ? AND tenant_id = ?'
  ).bind(updates.name, updates.description, updates.system_prompt, updates.model, JSON.stringify(updates.tools || []), id, tenantId)
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

app.post('/api/test-rag', async (c) => {
  try {
    const body = await c.req.json();
    const agentId = body.agentId || 'test-agent';
    const query = body.query || 'Cuanto cuesta el plan Premium?';
    const { buildRagContext } = await import('./knowledge');
    const knowledgeEnv = {
      DB: c.env.DB, VECTORIZE: c.env.VECTORIZE, STORAGE: c.env.STORAGE, AI: c.env.AI,
    };
    const context = await buildRagContext(knowledgeEnv, query, agentId, 5);
    return c.json({ agentId, query, contextLength: context.length, contextPreview: context.slice(0, 500) });
  } catch (e: any) {
    return c.json({ error: e.message, stack: e.stack?.split('\n').slice(0, 3) }, 500);
  }
});

app.post('/api/knowledge/:agentId', async (c) => {
  try {
    const agentId = c.req.param('agentId');
    const doc = await c.req.json();

    // Generar embedding usando Cloudflare Workers AI
    const aiConfig = { provider: 'workers' as const, ai: c.env.AI };
    const embedding = await generateEmbedding(aiConfig, doc.content);

    const vectorId = `kb-${Date.now()}`;
    const kbId = `kb-doc-${Date.now()}`;
    await c.env.VECTORIZE.insert([{
      id: vectorId,
      values: embedding,
      metadata: { agentId, kb_id: kbId, title: doc.title, content_preview: (doc.content || '').slice(0, 200), category: doc.category, content: doc.content }
    }]);

    // Guardar en D1 (id is INTEGER autoincrement, so we let DB generate it)
    const insertResult = await c.env.DB.prepare(
      'INSERT INTO knowledge_base (agent_id, title, content, category, vector_id, source) VALUES (?, ?, ?, ?, ?, ?)'
    ).bind(agentId, doc.title, doc.content, doc.category, vectorId, doc.source || 'manual')
      .run();
    const generatedId = String(insertResult.meta?.last_row_id || '');

    // Link KB to agent (required for RAG search)
    try {
      await c.env.DB.prepare(
        'INSERT OR IGNORE INTO agent_knowledge (agent_id, kb_id) VALUES (?, ?)'
      ).bind(agentId, generatedId).run();
    } catch (e) {}

    return c.json({ id: vectorId, kbId: generatedId, ...doc }, 201);
  } catch (e: any) {
    return c.json({ error: e.message, stack: e.stack?.split('\n').slice(0, 3) }, 500);
  }
});

// API para conversations
app.get('/api/conversations', async (c) => {
  const tenantId = c.get('tenantId') || 'default';
  const { results } = await c.env.DB.prepare(
    'SELECT c.*, a.name as agent_name FROM conversations c LEFT JOIN agents a ON c.agent_id = a.id WHERE c.tenant_id = ? ORDER BY c.updated_at DESC LIMIT 100'
  ).bind(tenantId).all();
  return c.json(results);
});

app.get('/api/conversations/:id/messages', async (c) => {
  const tenantId = c.get('tenantId') || 'default';
  const id = c.req.param('id');
  const { results } = await c.env.DB.prepare(
    'SELECT m.* FROM messages m INNER JOIN conversations c ON m.conversation_id = c.id WHERE m.conversation_id = ? AND c.tenant_id = ? ORDER BY m.created_at ASC'
  ).bind(id, tenantId).all();
  return c.json(results);
});

// API para leads
app.get('/api/leads', async (c) => {
  const tenantId = c.get('tenantId') || 'default';
  const { results } = await c.env.DB.prepare(
    'SELECT l.*, a.name as agent_name FROM leads l LEFT JOIN agents a ON l.agent_id = a.id WHERE l.tenant_id = ? ORDER BY l.score DESC LIMIT 100'
  ).bind(tenantId).all();
  return c.json(results);
});

// API para stats
app.get('/api/stats', async (c) => {
  const tenantId = c.get('tenantId') || 'default';
  const [conversations, leads, messages, agents] = await Promise.all([
    c.env.DB.prepare('SELECT COUNT(*) as count FROM conversations WHERE tenant_id = ? AND created_at > datetime("now", "-24 hours")').bind(tenantId).first(),
    c.env.DB.prepare('SELECT COUNT(*) as count FROM leads WHERE tenant_id = ? AND created_at > datetime("now", "-24 hours")').bind(tenantId).first(),
    c.env.DB.prepare('SELECT COUNT(*) as count FROM messages WHERE tenant_id = ? AND created_at > datetime("now", "-24 hours")').bind(tenantId).first(),
    c.env.DB.prepare('SELECT COUNT(*) as count FROM agents WHERE tenant_id = ? AND is_active = 1').bind(tenantId).first(),
  ]);

  return c.json({
    conversations_24h: conversations?.count || 0,
    leads_24h: leads?.count || 0,
    messages_24h: messages?.count || 0,
    active_agents: agents?.count || 0
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// MCP Server — Tool Discovery & Execution
// ═══════════════════════════════════════════════════════════════════════════════

app.get('/mcp', async (c) => {
  const { getMcpManifest } = await import('./mcp/server');
  const manifest = await getMcpManifest({ DB: c.env.DB, AI: c.env.AI, VECTORIZE: c.env.VECTORIZE });
  return c.json(manifest);
});

app.get('/mcp/tools', async (c) => {
  const { listMcpTools } = await import('./mcp/server');
  const tools = await listMcpTools({ DB: c.env.DB, AI: c.env.AI, VECTORIZE: c.env.VECTORIZE });
  return c.json({ tools });
});

app.post('/mcp/call', async (c) => {
  const body = await c.req.json();
  const { tool, parameters, agent_id } = body;

  if (!tool) return c.json({ success: false, error: 'Missing "tool" field' }, 400);

  const { executeMcpTool } = await import('./mcp/server');
  const result = await executeMcpTool(
    { DB: c.env.DB, AI: c.env.AI, VECTORIZE: c.env.VECTORIZE },
    tool,
    parameters || {},
    agent_id
  );

  return c.json(result);
});

export { AgentState };
export default {
  fetch: app.fetch,
  async scheduled(event: ScheduledController, env: Bindings): Promise<void> {
    console.log('Running scheduled task:', event.cron);
    
    // Purge old messages (90 days)
    try {
      await purgeOldMessages(env);
    } catch (e) {
      console.error('Purge error:', e);
    }
    
    // Run follow-ups for leads
    try {
      await runFollowups(env);
    } catch (e) {
      console.error('Followup error:', e);
    }
    
    // Check bot health
    try {
      await checkBotHealth(env);
    } catch (e) {
      console.error('Health check error:', e);
    }
  }
};

// Purge messages older than 90 days
async function purgeOldMessages(env: Bindings) {
  const result = await env.DB.prepare(
    'DELETE FROM messages WHERE created_at < datetime("now", "-90 days")'
  ).run();
  console.log(`Purged ${result.meta?.changes || 0} old messages`);
}

// Run follow-ups for leads that are due
async function runFollowups(env: Bindings) {
  const { results: dueFollowups } = await env.DB.prepare(
    `SELECT f.*, l.name, l.phone, l.email, l.interest
     FROM followups f
     JOIN leads l ON f.lead_id = l.id
     WHERE f.status = 'pending' 
     AND f.scheduled_at <= datetime('now')
     LIMIT 10`
  ).all();
  
  for (const followup of dueFollowups) {
    try {
      // TODO: Send followup message through appropriate channel
      await env.DB.prepare(
        `UPDATE followups SET status = 'sent', sent_at = datetime('now') WHERE id = ?`
      ).bind(followup.id).run();
      
      // Update lead's last contact
      await env.DB.prepare(
        `UPDATE leads SET last_contact_at = datetime('now'), followup_count = followup_count + 1 WHERE id = ?`
      ).bind(followup.lead_id).run();
      
      console.log(`Followup sent to lead ${followup.lead_id}`);
    } catch (e) {
      await env.DB.prepare(
        `UPDATE followups SET status = 'failed' WHERE id = ?`
      ).bind(followup.id).run();
      console.error(`Followup failed for lead ${followup.lead_id}:`, e);
    }
  }
}

// Check bot health and log issues
async function checkBotHealth(env: Bindings) {
  try {
    // Check for recent errors
    const { count: recentErrors } = await env.DB.prepare(
      `SELECT COUNT(*) as count FROM health_logs 
       WHERE status = 'error' 
       AND created_at > datetime('now', '-1 hour')`
    ).first() as any;
    
    // Check conversation success rate
    const { count: totalConversations } = await env.DB.prepare(
      `SELECT COUNT(*) as count FROM conversations 
       WHERE created_at > datetime('now', '-24 hours')`
    ).first() as any;
    
    const { count: failedConversations } = await env.DB.prepare(
      `SELECT COUNT(*) as count FROM conversations 
       WHERE status = 'escalated' 
       AND created_at > datetime('now', '-24 hours')`
    ).first() as any;
    
    const successRate = totalConversations > 0 
      ? ((totalConversations - failedConversations) / totalConversations * 100)
      : 100;
    
    // Log health status
    const status = recentErrors > 5 || successRate < 70 ? 'degraded' : 'ok';
    
    await env.DB.prepare(
      `INSERT INTO health_logs (status, error_count, metadata)
       VALUES (?, ?, ?)`
    ).bind(status, recentErrors, JSON.stringify({
      success_rate: successRate,
      total_conversations: totalConversations,
      failed_conversations: failedConversations
    })).run();
    
    // Alert if degraded
    if (status === 'degraded') {
      console.warn(`Bot health degraded: ${recentErrors} errors, ${successRate.toFixed(1)}% success rate`);
      // TODO: Send alert to owner via Telegram/email
    }
    
    console.log(`Health check: ${status} (${successRate.toFixed(1)}% success rate)`);
  } catch (e) {
    console.error('Health check failed:', e);
  }
}
