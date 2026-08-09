import { Hono } from 'hono';
import { html } from 'hono/html';

type Bindings = {
  DB: D1Database;
  ADMIN_PASSWORD?: string;
};

const admin = new Hono<{ Bindings: Bindings }>();

// Simple auth middleware
const auth = async (c: any, next: any) => {
  const password = c.env.ADMIN_PASSWORD;
  if (!password) {
    return next();
  }

  const authHeader = c.req.header('Authorization');
  if (!authHeader || authHeader !== 'Bearer ' + password) {
    return c.json({ error: 'Unauthorized' }, 401);
  }
  return next();
};

// Admin dashboard HTML
admin.get('/', async (c) => {
  return c.html(html`<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>AgentForge - Admin</title>
  <script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="bg-gray-900 text-white min-h-screen">
  <div class="container mx-auto px-4 py-8">
    <h1 class="text-3xl font-bold mb-8">🔨 AgentForge Admin</h1>
    
    <!-- Stats -->
    <div class="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
      <div class="bg-gray-800 rounded-lg p-4">
        <div class="text-gray-400 text-sm">Agentes Activos</div>
        <div class="text-2xl font-bold" id="active-agents">-</div>
      </div>
      <div class="bg-gray-800 rounded-lg p-4">
        <div class="text-gray-400 text-sm">Conversaciones (24h)</div>
        <div class="text-2xl font-bold" id="conversations-24h">-</div>
      </div>
      <div class="bg-gray-800 rounded-lg p-4">
        <div class="text-gray-400 text-sm">Leads (24h)</div>
        <div class="text-2xl font-bold" id="leads-24h">-</div>
      </div>
      <div class="bg-gray-800 rounded-lg p-4">
        <div class="text-gray-400 text-sm">Mensajes (24h)</div>
        <div class="text-2xl font-bold" id="messages-24h">-</div>
      </div>
    </div>

    <!-- Tabs -->
    <div class="flex gap-4 mb-6 border-b border-gray-700 pb-2">
      <button onclick="showTab('agents')" class="tab-btn px-4 py-2 rounded hover:bg-gray-700" data-tab="agents">Agentes</button>
      <button onclick="showTab('conversations')" class="tab-btn px-4 py-2 rounded hover:bg-gray-700" data-tab="conversations">Conversaciones</button>
      <button onclick="showTab('knowledge')" class="tab-btn px-4 py-2 rounded hover:bg-gray-700" data-tab="knowledge">Base de Conocimiento</button>
      <button onclick="showTab('leads')" class="tab-btn px-4 py-2 rounded hover:bg-gray-700" data-tab="leads">Leads</button>
    </div>

    <!-- Agents Tab -->
    <div id="tab-agents" class="tab-content">
      <div class="flex justify-between items-center mb-4">
        <h2 class="text-xl font-semibold">Agentes</h2>
        <button onclick="showCreateAgent()" class="bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded">+ Nuevo Agente</button>
      </div>
      <div id="agents-list" class="space-y-4"></div>
    </div>

    <!-- Conversations Tab -->
    <div id="tab-conversations" class="tab-content hidden">
      <h2 class="text-xl font-semibold mb-4">Conversaciones Recientes</h2>
      <div id="conversations-list" class="space-y-4"></div>
    </div>

    <!-- Knowledge Base Tab -->
    <div id="tab-knowledge" class="tab-content hidden">
      <div class="flex justify-between items-center mb-4">
        <h2 class="text-xl font-semibold">Base de Conocimiento</h2>
        <button onclick="showAddDocument()" class="bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded">+ Agregar Documento</button>
      </div>
      <div id="knowledge-list" class="space-y-4"></div>
    </div>

    <!-- Leads Tab -->
    <div id="tab-leads" class="tab-content hidden">
      <h2 class="text-xl font-semibold mb-4">Leads</h2>
      <div id="leads-list" class="space-y-4"></div>
    </div>
  </div>

  <script>
    // Load stats
    async function loadStats() {
      const res = await fetch('/admin/api/stats');
      const data = await res.json();
      document.getElementById('active-agents').textContent = data.active_agents;
      document.getElementById('conversations-24h').textContent = data.conversations_24h;
      document.getElementById('leads-24h').textContent = data.leads_24h;
      document.getElementById('messages-24h').textContent = data.messages_24h;
    }

    // Load agents
    async function loadAgents() {
      const res = await fetch('/admin/api/agents');
      const agents = await res.json();
      const container = document.getElementById('agents-list');
      container.innerHTML = agents.map(a => 
        '<div class="bg-gray-800 rounded-lg p-4">' +
          '<div class="flex justify-between items-start">' +
            '<div>' +
              '<h3 class="font-semibold">' + a.name + '</h3>' +
              '<p class="text-gray-400 text-sm">' + (a.description || '') + '</p>' +
              '<span class="inline-block bg-gray-700 text-xs px-2 py-1 rounded mt-2">' + a.type + '</span>' +
            '</div>' +
            '<div class="text-right">' +
              '<span class="' + (a.is_active ? 'text-green-400' : 'text-red-400') + '">' + (a.is_active ? 'Activo' : 'Inactivo') + '</span>' +
            '</div>' +
          '</div>' +
        '</div>'
      ).join('');
    }

    // Load conversations
    async function loadConversations() {
      const res = await fetch('/admin/api/conversations');
      const convs = await res.json();
      const container = document.getElementById('conversations-list');
      container.innerHTML = convs.map(c =>
        '<div class="bg-gray-800 rounded-lg p-4">' +
          '<div class="flex justify-between">' +
            '<div>' +
              '<span class="font-mono text-sm text-gray-400">' + c.channel + ' / ' + c.chat_id + '</span>' +
              '<p class="text-sm mt-1">Agente: ' + (c.agent_name || 'N/A') + '</p>' +
            '</div>' +
            '<div class="text-right text-sm text-gray-400">' +
              '<div>' + c.status + '</div>' +
              '<div>' + c.intent + '</div>' +
            '</div>' +
          '</div>' +
        '</div>'
      ).join('') || '<p class="text-gray-500">No hay conversaciones aún</p>';
    }

    // Load leads
    async function loadLeads() {
      const res = await fetch('/admin/api/leads');
      const leads = await res.json();
      const container = document.getElementById('leads-list');
      container.innerHTML = leads.map(l =>
        '<div class="bg-gray-800 rounded-lg p-4">' +
          '<div class="flex justify-between">' +
            '<div>' +
              '<h3 class="font-semibold">' + (l.name || 'Anónimo') + '</h3>' +
              '<p class="text-gray-400 text-sm">' + (l.interest || '') + '</p>' +
            '</div>' +
            '<div class="text-right">' +
              '<div class="text-2xl font-bold text-blue-400">' + l.score + '</div>' +
              '<div class="text-xs text-gray-400">' + l.status + '</div>' +
            '</div>' +
          '</div>' +
        '</div>'
      ).join('') || '<p class="text-gray-500">No hay leads aún</p>';
    }

    // Tab switching
    function showTab(tab) {
      document.querySelectorAll('.tab-content').forEach(el => el.classList.add('hidden'));
      document.querySelectorAll('.tab-btn').forEach(el => el.classList.remove('bg-gray-700'));
      document.getElementById('tab-' + tab).classList.remove('hidden');
      document.querySelector('[data-tab="' + tab + '"]').classList.add('bg-gray-700');
    }

    // Initial load
    loadStats();
    loadAgents();
    loadConversations();
    loadLeads();

    // Refresh every 30 seconds
    setInterval(loadStats, 30000);
  </script>
</body>
</html>`);
});

// API routes
admin.get('/api/stats', async (c) => {
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

admin.get('/api/agents', async (c) => {
  const { results } = await c.env.DB.prepare('SELECT * FROM agents ORDER BY created_at DESC').all();
  return c.json(results);
});

admin.get('/api/conversations', async (c) => {
  const { results } = await c.env.DB.prepare(
    'SELECT c.*, a.name as agent_name FROM conversations c LEFT JOIN agents a ON c.agent_id = a.id ORDER BY c.updated_at DESC LIMIT 50'
  ).all();
  return c.json(results);
});

admin.get('/api/leads', async (c) => {
  const { results } = await c.env.DB.prepare(
    'SELECT l.*, a.name as agent_name FROM leads l LEFT JOIN agents a ON l.agent_id = a.id ORDER BY l.score DESC LIMIT 50'
  ).all();
  return c.json(results);
});

export { admin as AdminPanel };
