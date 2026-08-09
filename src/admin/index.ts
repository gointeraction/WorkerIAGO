import { Hono } from 'hono';
import { html } from 'hono/html';

type Bindings = {
  DB: D1Database;
  ADMIN_PASSWORD?: string;
  ENVIRONMENT?: string;
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

// Apply auth to all routes
admin.use('*', auth);

// Layout helper
const layout = (title: string, activeTab: string, body: string) => html`<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} - WorkerIAGO Admin</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <script src="https://unpkg.com/htmx.org@1.9.10"></script>
  <style>
    .htmx-indicator { display: none; }
    .htmx-request .htmx-indicator { display: inline-block; }
    .htmx-request.htmx-indicator { display: inline-block; }
    .tab-active { background: #1f2937; border-color: #3b82f6; }
    .pulse { animation: pulse 2s infinite; }
    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.5; }
    }
  </style>
</head>
<body class="bg-gray-950 text-white min-h-screen">
  <div class="flex">
    <!-- Sidebar -->
    <aside class="w-64 bg-gray-900 min-h-screen p-4 fixed">
      <div class="mb-8">
        <h1 class="text-xl font-bold text-blue-400">🔨 WorkerIAGO</h1>
        <p class="text-xs text-gray-500">Admin Panel v2.0</p>
      </div>
      
      <nav class="space-y-1">
        <a href="/admin" class="block px-3 py-2 rounded ${activeTab === 'overview' ? 'bg-gray-700 text-white' : 'text-gray-400 hover:bg-gray-800'}">
          📊 Resumen
        </a>
        <a href="/admin/conversations" class="block px-3 py-2 rounded ${activeTab === 'conversations' ? 'bg-gray-700 text-white' : 'text-gray-400 hover:bg-gray-800'}">
          💬 Conversaciones
        </a>
        <a href="/admin/tickets" class="block px-3 py-2 rounded ${activeTab === 'tickets' ? 'bg-gray-700 text-white' : 'text-gray-400 hover:bg-gray-800'}">
          🎫 Tickets
        </a>
        <a href="/admin/leads" class="block px-3 py-2 rounded ${activeTab === 'leads' ? 'bg-gray-700 text-white' : 'text-gray-400 hover:bg-gray-800'}">
          👥 Leads
        </a>
        <a href="/admin/knowledge" class="block px-3 py-2 rounded ${activeTab === 'knowledge' ? 'bg-gray-700 text-white' : 'text-gray-400 hover:bg-gray-800'}">
          📚 Base de Conocimiento
        </a>
        <a href="/admin/agents" class="block px-3 py-2 rounded ${activeTab === 'agents' ? 'bg-gray-700 text-white' : 'text-gray-400 hover:bg-gray-800'}">
          🤖 Agentes
        </a>
        <a href="/admin/insights" class="block px-3 py-2 rounded ${activeTab === 'insights' ? 'bg-gray-700 text-white' : 'text-gray-400 hover:bg-gray-800'}">
          💡 Insights
        </a>
        <a href="/admin/campaigns" class="block px-3 py-2 rounded ${activeTab === 'campaigns' ? 'bg-gray-700 text-white' : 'text-gray-400 hover:bg-gray-800'}">
          📢 Campañas
        </a>
        <a href="/admin/costs" class="block px-3 py-2 rounded ${activeTab === 'costs' ? 'bg-gray-700 text-white' : 'text-gray-400 hover:bg-gray-800'}">
          💰 Costos
        </a>
        <a href="/admin/config" class="block px-3 py-2 rounded ${activeTab === 'config' ? 'bg-gray-700 text-white' : 'text-gray-400 hover:bg-gray-800'}">
          ⚙️ Configuración
        </a>
      </nav>
      
      <div class="mt-8 pt-4 border-t border-gray-700">
        <div class="text-xs text-gray-500">
          <div>Estado: <span class="text-green-400">●</span> Activo</div>
          <div class="mt-1">Última actualización: <span id="last-update">--</span></div>
        </div>
      </div>
    </aside>
    
    <!-- Main content -->
    <main class="ml-64 flex-1 p-8">
      ${body}
    </main>
    
    <script>
      // Auto-refresh last update time
      function updateLastUpdate() {
        document.getElementById('last-update').textContent = new Date().toLocaleTimeString();
      }
      updateLastUpdate();
      setInterval(updateLastUpdate, 30000);
      
      // HTMX configuration
      document.body.addEventListener('htmx:beforeRequest', function(e) {
        console.log('HTMX Request:', e.detail);
      });
    </script>
  </div>
</body>
</html>`;

// Main dashboard
admin.get('/', async (c) => {
  return c.html(layout('Resumen', 'overview', `
    <h2 class="text-2xl font-bold mb-6">📊 Resumen</h2>
    
    <!-- Stats Cards -->
    <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
      <div class="bg-gray-800 rounded-lg p-4 border border-gray-700">
        <div class="text-gray-400 text-sm">Conversaciones (24h)</div>
        <div class="text-3xl font-bold text-blue-400" id="stats-conversations">-</div>
        <div class="text-xs text-gray-500 mt-1">↑ 12% vs ayer</div>
      </div>
      <div class="bg-gray-800 rounded-lg p-4 border border-gray-700">
        <div class="text-gray-400 text-sm">Leads Nuevos (24h)</div>
        <div class="text-3xl font-bold text-green-400" id="stats-leads">-</div>
        <div class="text-xs text-gray-500 mt-1">↑ 8% vs ayer</div>
      </div>
      <div class="bg-gray-800 rounded-lg p-4 border border-gray-700">
        <div class="text-gray-400 text-sm">Tickets Abiertos</div>
        <div class="text-3xl font-bold text-yellow-400" id="stats-tickets">-</div>
        <div class="text-xs text-gray-500 mt-1">3 urgentes</div>
      </div>
      <div class="bg-gray-800 rounded-lg p-4 border border-gray-700">
        <div class="text-gray-400 text-sm">Costo IA (24h)</div>
        <div class="text-3xl font-bold text-purple-400" id="stats-cost">$0.00</div>
        <div class="text-xs text-gray-500 mt-1">~$2/mes proyectado</div>
      </div>
    </div>
    
    <!-- Recent Activity -->
    <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <div class="bg-gray-800 rounded-lg p-4 border border-gray-700">
        <h3 class="font-semibold mb-4">💬 Conversaciones Recientes</h3>
        <div id="recent-conversations" class="space-y-3">
          <div class="text-gray-500 text-sm">Cargando...</div>
        </div>
      </div>
      
      <div class="bg-gray-800 rounded-lg p-4 border border-gray-700">
        <h3 class="font-semibold mb-4">🎫 Tickets Activos</h3>
        <div id="active-tickets" class="space-y-3">
          <div class="text-gray-500 text-sm">Cargando...</div>
        </div>
      </div>
    </div>
    
    <!-- Quick Actions -->
    <div class="mt-6 bg-gray-800 rounded-lg p-4 border border-gray-700">
      <h3 class="font-semibold mb-4">⚡ Acciones Rápidas</h3>
      <div class="flex gap-3">
        <button class="bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded text-sm">
          + Nuevo Agente
        </button>
        <button class="bg-green-600 hover:bg-green-700 px-4 py-2 rounded text-sm">
          + Agregar Documento KB
        </button>
        <button class="bg-purple-600 hover:bg-purple-700 px-4 py-2 rounded text-sm">
          📢 Nueva Campaña
        </button>
      </div>
    </div>
    
    <script>
      // Load stats
      async function loadStats() {
        try {
          const res = await fetch('/admin/api/stats');
          const data = await res.json();
          document.getElementById('stats-conversations').textContent = data.conversations_24h || 0;
          document.getElementById('stats-leads').textContent = data.leads_24h || 0;
          document.getElementById('stats-tickets').textContent = data.open_tickets || 0;
          document.getElementById('stats-cost').textContent = '$' + (data.cost_24h || 0).toFixed(2);
        } catch (e) {
          console.error('Error loading stats:', e);
        }
      }
      
      // Load recent conversations
      async function loadRecentConversations() {
        try {
          const res = await fetch('/admin/api/conversations?limit=5');
          const data = await res.json();
          const container = document.getElementById('recent-conversations');
          if (data.length === 0) {
            container.innerHTML = '<div class="text-gray-500 text-sm">No hay conversaciones recientes</div>';
            return;
          }
          container.innerHTML = data.map(c => 
            '<div class="flex items-center justify-between p-2 bg-gray-700 rounded">' +
              '<div class="flex items-center gap-2">' +
                '<span class="text-lg">' + (c.channel === 'telegram' ? '📱' : c.channel === 'whatsapp' ? '💬' : '🌐') + '</span>' +
                '<div>' +
                  '<div class="text-sm font-medium">' + (c.user_name || 'Anónimo') + '</div>' +
                  '<div class="text-xs text-gray-400">' + c.channel + ' · ' + c.intent + '</div>' +
                '</div>' +
              '</div>' +
              '<span class="text-xs px-2 py-1 rounded ' + 
                (c.status === 'active' ? 'bg-green-900 text-green-300' : 
                 c.status === 'escalated' ? 'bg-yellow-900 text-yellow-300' : 'bg-gray-600 text-gray-300') + 
              '">' + c.status + '</span>' +
            '</div>'
          ).join('');
        } catch (e) {
          console.error('Error loading conversations:', e);
        }
      }
      
      // Load active tickets
      async function loadActiveTickets() {
        try {
          const res = await fetch('/admin/api/tickets?status=open');
          const data = await res.json();
          const container = document.getElementById('active-tickets');
          if (data.length === 0) {
            container.innerHTML = '<div class="text-gray-500 text-sm">No hay tickets activos</div>';
            return;
          }
          container.innerHTML = data.map(t => 
            '<div class="flex items-center justify-between p-2 bg-gray-700 rounded">' +
              '<div>' +
                '<div class="text-sm font-medium">' + t.title + '</div>' +
                '<div class="text-xs text-gray-400">' + t.category + ' · ' + t.priority + '</div>' +
              '</div>' +
              '<span class="text-xs px-2 py-1 rounded ' + 
                (t.priority === 3 ? 'bg-red-900 text-red-300' : 
                 t.priority === 2 ? 'bg-orange-900 text-orange-300' : 'bg-gray-600 text-gray-300') + 
              '">' + ['Baja', 'Media', 'Alta', 'Urgente'][t.priority] + '</span>' +
            '</div>'
          ).join('');
        } catch (e) {
          console.error('Error loading tickets:', e);
        }
      }
      
      // Initial load
      loadStats();
      loadRecentConversations();
      loadActiveTickets();
      
      // Auto-refresh
      setInterval(loadStats, 30000);
      setInterval(loadRecentConversations, 10000);
    </script>
  `));
});

// Conversations page
admin.get('/conversations', async (c) => {
  const page = parseInt(c.req.query('page') || '1');
  const limit = 20;
  const offset = (page - 1) * limit;
  
  const { results: conversations } = await c.env.DB.prepare(
    `SELECT c.*, a.name as agent_name,
     (SELECT COUNT(*) FROM messages WHERE conversation_id = c.id) as message_count
     FROM conversations c 
     LEFT JOIN agents a ON c.agent_id = a.id 
     ORDER BY c.updated_at DESC 
     LIMIT ? OFFSET ?`
  ).bind(limit, offset).all();
  
  const { count: total } = await c.env.DB.prepare(
    'SELECT COUNT(*) as count FROM conversations'
  ).first() as any;
  
  return c.html(layout('Conversaciones', 'conversations', `
    <div class="flex justify-between items-center mb-6">
      <h2 class="text-2xl font-bold">💬 Conversaciones</h2>
      <div class="flex gap-2">
        <input type="text" 
               placeholder="Buscar..." 
               class="bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm"
               hx-get="/admin/conversations/search"
               hx-trigger="keyup changed delay:300ms"
               hx-target="#conversations-list"
               name="q">
        <select class="bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm">
          <option value="">Todos los canales</option>
          <option value="telegram">Telegram</option>
          <option value="whatsapp">WhatsApp</option>
          <option value="web">Web</option>
        </select>
      </div>
    </div>
    
    <div id="conversations-list" class="space-y-3">
      ${conversations.map(c => `
        <div class="bg-gray-800 rounded-lg p-4 border border-gray-700 hover:border-gray-600 cursor-pointer"
             hx-get="/admin/conversations/${c.id}/thread"
             hx-target="#thread-panel"
             hx-swap="innerHTML">
          <div class="flex justify-between items-start">
            <div class="flex items-center gap-3">
              <span class="text-2xl">${c.channel === 'telegram' ? '📱' : c.channel === 'whatsapp' ? '💬' : '🌐'}</span>
              <div>
                <div class="font-medium">${c.user_name || 'Anónimo'}</div>
                <div class="text-sm text-gray-400">${c.channel} · ${c.intent || 'sin clasificar'}</div>
                <div class="text-xs text-gray-500 mt-1">${c.message_count} mensajes · ${new Date(c.updated_at).toLocaleString()}</div>
              </div>
            </div>
            <div class="flex items-center gap-2">
              <span class="px-2 py-1 rounded text-xs ${
                c.status === 'active' ? 'bg-green-900 text-green-300' :
                c.status === 'escalated' ? 'bg-yellow-900 text-yellow-300' :
                'bg-gray-700 text-gray-300'
              }">${c.status}</span>
              ${c.priority > 0 ? `<span class="px-2 py-1 rounded text-xs bg-red-900 text-red-300">P${c.priority}</span>` : ''}
            </div>
          </div>
        </div>
      `).join('') || '<div class="text-gray-500 text-center py-8">No hay conversaciones</div>'}
    </div>
    
    <!-- Pagination -->
    <div class="flex justify-center gap-2 mt-6">
      ${page > 1 ? `<a href="/admin/conversations?page=${page - 1}" class="px-3 py-1 bg-gray-800 rounded hover:bg-gray-700">← Anterior</a>` : ''}
      <span class="px-3 py-1 text-gray-400">Página ${page} de ${Math.ceil(total / limit)}</span>
      ${page < Math.ceil(total / limit) ? `<a href="/admin/conversations?page=${page + 1}" class="px-3 py-1 bg-gray-800 rounded hover:bg-gray-700">Siguiente →</a>` : ''}
    </div>
    
    <!-- Thread Panel (right side) -->
    <div id="thread-panel" class="fixed right-0 top-0 w-96 h-full bg-gray-900 border-l border-gray-700 hidden overflow-y-auto">
    </div>
  `));
});

// Conversation thread
admin.get('/conversations/:id/thread', async (c) => {
  const id = c.req.param('id');
  
  const conversation = await c.env.DB.prepare(
    'SELECT * FROM conversations WHERE id = ?'
  ).bind(id).first();
  
  if (!conversation) {
    return c.html('<div class="p-4 text-red-400">Conversación no encontrada</div>');
  }
  
  const { results: messages } = await c.env.DB.prepare(
    'SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC'
  ).bind(id).all();
  
  return c.html(`
    <div class="p-4">
      <div class="flex justify-between items-center mb-4 pb-4 border-b border-gray-700">
        <div>
          <h3 class="font-semibold">${conversation.user_name || 'Anónimo'}</h3>
          <div class="text-sm text-gray-400">${conversation.channel} · ${conversation.intent}</div>
        </div>
        <button onclick="document.getElementById('thread-panel').classList.add('hidden')" 
                class="text-gray-400 hover:text-white">✕</button>
      </div>
      
      <!-- Actions -->
      <div class="flex gap-2 mb-4">
        <button class="flex-1 bg-blue-600 hover:bg-blue-700 px-3 py-2 rounded text-sm"
                hx-post="/admin/conversations/${id}/reply"
                hx-target="#reply-status"
                hx-vals='js:{"text": document.getElementById("reply-input").value}'>
          📤 Responder
        </button>
        <button class="bg-yellow-600 hover:bg-yellow-700 px-3 py-2 rounded text-sm"
                hx-post="/admin/conversations/${id}/pause">
          ⏸️ Pausar
        </button>
        <button class="bg-red-600 hover:bg-red-700 px-3 py-2 rounded text-sm"
                hx-post="/admin/conversations/${id}/escalate">
          🚨 Escalar
        </button>
      </div>
      
      <!-- Reply input -->
      <div class="mb-4">
        <textarea id="reply-input" 
                  class="w-full bg-gray-800 border border-gray-700 rounded p-2 text-sm"
                  rows="3"
                  placeholder="Escribe tu respuesta..."></textarea>
        <div id="reply-status" class="text-sm mt-1"></div>
      </div>
      
      <!-- Messages -->
      <div class="space-y-3 max-h-96 overflow-y-auto">
        ${messages.map(m => `
          <div class="flex ${m.role === 'user' ? 'justify-start' : 'justify-end'}">
            <div class="max-w-[80%] rounded-lg p-3 ${
              m.role === 'user' ? 'bg-gray-700' :
              m.role === 'owner' ? 'bg-blue-600' :
              'bg-gray-600'
            }">
              <div class="text-xs text-gray-400 mb-1">${m.role} · ${new Date(m.created_at).toLocaleTimeString()}</div>
              <div class="text-sm">${m.content}</div>
            </div>
          </div>
        `).join('')}
      </div>
    </div>
  `);
});

// Tickets page
admin.get('/tickets', async (c) => {
  const status = c.req.query('status') || 'all';
  
  let query = `SELECT t.*, a.name as agent_name, c.user_name 
               FROM tickets t 
               LEFT JOIN agents a ON t.agent_id = a.id 
               LEFT JOIN conversations c ON t.conversation_id = c.id`;
  
  if (status !== 'all') {
    query += ` WHERE t.status = '${status}'`;
  }
  
  query += ' ORDER BY t.priority DESC, t.created_at DESC';
  
  const { results: tickets } = await c.env.DB.prepare(query).all();
  
  return c.html(layout('Tickets', 'tickets', `
    <div class="flex justify-between items-center mb-6">
      <h2 class="text-2xl font-bold">🎫 Tickets</h2>
      <div class="flex gap-2">
        <a href="/admin/tickets?status=all" class="px-3 py-1 rounded text-sm ${status === 'all' ? 'bg-blue-600' : 'bg-gray-700'}">Todos</a>
        <a href="/admin/tickets?status=new" class="px-3 py-1 rounded text-sm ${status === 'new' ? 'bg-blue-600' : 'bg-gray-700'}">Nuevos</a>
        <a href="/admin/tickets?status=in_progress" class="px-3 py-1 rounded text-sm ${status === 'in_progress' ? 'bg-blue-600' : 'bg-gray-700'}">En Progreso</a>
        <a href="/admin/tickets?status=resolved" class="px-3 py-1 rounded text-sm ${status === 'resolved' ? 'bg-blue-600' : 'bg-gray-700'}">Resueltos</a>
      </div>
    </div>
    
    <div class="space-y-3">
      ${tickets.map(t => `
        <div class="bg-gray-800 rounded-lg p-4 border border-gray-700">
          <div class="flex justify-between items-start">
            <div>
              <div class="font-medium">${t.title}</div>
              <div class="text-sm text-gray-400 mt-1">${t.description || 'Sin descripción'}</div>
              <div class="flex gap-2 mt-2">
                <span class="text-xs px-2 py-1 rounded bg-gray-700">${t.category || 'general'}</span>
                <span class="text-xs px-2 py-1 rounded bg-gray-700">${t.agent_name || 'N/A'}</span>
                <span class="text-xs text-gray-500">${new Date(t.created_at).toLocaleString()}</span>
              </div>
            </div>
            <div class="flex items-center gap-2">
              <span class="px-2 py-1 rounded text-xs ${
                t.priority === 3 ? 'bg-red-900 text-red-300' :
                t.priority === 2 ? 'bg-orange-900 text-orange-300' :
                t.priority === 1 ? 'bg-yellow-900 text-yellow-300' :
                'bg-gray-700 text-gray-300'
              }">${['Baja', 'Media', 'Alta', 'Urgente'][t.priority]}</span>
              <select class="bg-gray-700 border border-gray-600 rounded px-2 py-1 text-xs"
                      hx-post="/admin/tickets/${t.id}/status"
                      hx-vals='js:{"status": event.target.value}'>
                <option value="new" ${t.status === 'new' ? 'selected' : ''}>Nuevo</option>
                <option value="in_progress" ${t.status === 'in_progress' ? 'selected' : ''}>En Progreso</option>
                <option value="waiting" ${t.status === 'waiting' ? 'selected' : ''}>Esperando</option>
                <option value="resolved" ${t.status === 'resolved' ? 'selected' : ''}>Resuelto</option>
                <option value="closed" ${t.status === 'closed' ? 'selected' : ''}>Cerrado</option>
              </select>
            </div>
          </div>
        </div>
      `).join('') || '<div class="text-gray-500 text-center py-8">No hay tickets</div>'}
    </div>
  `));
});

// Knowledge Base page
admin.get('/knowledge', async (c) => {
  const { results: documents } = await c.env.DB.prepare(
    'SELECT * FROM knowledge_base ORDER BY updated_at DESC'
  ).all();
  
  return c.html(layout('Base de Conocimiento', 'knowledge', `
    <div class="flex justify-between items-center mb-6">
      <h2 class="text-2xl font-bold">📚 Base de Conocimiento</h2>
      <button onclick="showCreateDocument()" class="bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded">
        + Nuevo Documento
      </button>
    </div>
    
    <!-- Create/Edit Form (hidden by default) -->
    <div id="kb-form" class="hidden bg-gray-800 rounded-lg p-4 mb-6 border border-gray-700">
      <h3 class="font-semibold mb-4">Nuevo Documento</h3>
      <form hx-post="/admin/kb/save" hx-target="#kb-list" hx-swap="innerHTML">
        <input type="hidden" id="doc-id" name="id" value="">
        
        <div class="grid grid-cols-2 gap-4 mb-4">
          <div>
            <label class="block text-sm text-gray-400 mb-1">Título</label>
            <input type="text" name="title" id="doc-title" required
                   class="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 text-sm">
          </div>
          <div>
            <label class="block text-sm text-gray-400 mb-1">Categoría</label>
            <input type="text" name="category" id="doc-category"
                   class="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 text-sm"
                   placeholder="ej: FAQ, Productos, Políticas">
          </div>
        </div>
        
        <div class="mb-4">
          <label class="block text-sm text-gray-400 mb-1">Contenido</label>
          <textarea name="content" id="doc-content" required rows="8"
                    class="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 text-sm font-mono"></textarea>
        </div>
        
        <div class="mb-4">
          <label class="block text-sm text-gray-400 mb-1">Tags (separados por coma)</label>
          <input type="text" name="tags" id="doc-tags"
                 class="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 text-sm"
                 placeholder="precio, envío, garantía">
        </div>
        
        <div class="flex gap-2">
          <button type="submit" class="bg-green-600 hover:bg-green-700 px-4 py-2 rounded text-sm">
            💾 Guardar
          </button>
          <button type="button" onclick="hideCreateDocument()" class="bg-gray-600 hover:bg-gray-700 px-4 py-2 rounded text-sm">
            Cancelar
          </button>
        </div>
      </form>
    </div>
    
    <!-- Documents list -->
    <div id="kb-list" class="space-y-3">
      ${documents.map(d => `
        <div class="bg-gray-800 rounded-lg p-4 border border-gray-700">
          <div class="flex justify-between items-start">
            <div>
              <div class="font-medium">${d.title}</div>
              <div class="text-sm text-gray-400 mt-1 line-clamp-2">${d.content.substring(0, 200)}...</div>
              <div class="flex gap-2 mt-2">
                <span class="text-xs px-2 py-1 rounded bg-gray-700">${d.category || 'Sin categoría'}</span>
                <span class="text-xs text-gray-500">${d.view_count || 0} vistas</span>
                <span class="text-xs text-gray-500">${new Date(d.updated_at).toLocaleString()}</span>
              </div>
            </div>
            <div class="flex gap-2">
              <button onclick="editDocument('${d.id}', '${d.title}', '${d.category}', '${d.content.replace(/'/g, "\\'")}')"
                      class="text-blue-400 hover:text-blue-300 text-sm">✏️</button>
              <button hx-delete="/admin/kb/${d.id}" 
                      hx-confirm="¿Eliminar este documento?"
                      hx-target="#kb-list"
                      class="text-red-400 hover:text-red-300 text-sm">🗑️</button>
            </div>
          </div>
        </div>
      `).join('') || '<div class="text-gray-500 text-center py-8">No hay documentos. ¡Crea el primero!</div>'}
    </div>
    
    <script>
      function showCreateDocument() {
        document.getElementById('kb-form').classList.remove('hidden');
        document.getElementById('doc-id').value = '';
        document.getElementById('doc-title').value = '';
        document.getElementById('doc-category').value = '';
        document.getElementById('doc-content').value = '';
        document.getElementById('doc-tags').value = '';
      }
      
      function hideCreateDocument() {
        document.getElementById('kb-form').classList.add('hidden');
      }
      
      function editDocument(id, title, category, content) {
        document.getElementById('kb-form').classList.remove('hidden');
        document.getElementById('doc-id').value = id;
        document.getElementById('doc-title').value = title;
        document.getElementById('doc-category').value = category || '';
        document.getElementById('doc-content').value = content;
      }
    </script>
  `));
});

// Leads page
admin.get('/leads', async (c) => {
  const status = c.req.query('status') || 'all';
  
  let query = `SELECT l.*, a.name as agent_name 
               FROM leads l 
               LEFT JOIN agents a ON l.agent_id = a.id`;
  
  if (status !== 'all') {
    query += ` WHERE l.status = '${status}'`;
  }
  
  query += ' ORDER BY l.score DESC, l.created_at DESC';
  
  const { results: leads } = await c.env.DB.prepare(query).all();
  
  return c.html(layout('Leads', 'leads', `
    <div class="flex justify-between items-center mb-6">
      <h2 class="text-2xl font-bold">👥 Leads</h2>
      <div class="flex gap-2">
        <a href="/admin/leads?status=all" class="px-3 py-1 rounded text-sm ${status === 'all' ? 'bg-blue-600' : 'bg-gray-700'}">Todos</a>
        <a href="/admin/leads?status=new" class="px-3 py-1 rounded text-sm ${status === 'new' ? 'bg-blue-600' : 'bg-gray-700'}">Nuevos</a>
        <a href="/admin/leads?status=contacted" class="px-3 py-1 rounded text-sm ${status === 'contacted' ? 'bg-blue-600' : 'bg-gray-700'}">Contactados</a>
        <a href="/admin/leads?status=converted" class="px-3 py-1 rounded text-sm ${status === 'converted' ? 'bg-blue-600' : 'bg-gray-700'}">Convertidos</a>
        <button class="bg-green-600 hover:bg-green-700 px-4 py-2 rounded text-sm ml-4">
          📥 Exportar CSV
        </button>
      </div>
    </div>
    
    <div class="space-y-3">
      ${leads.map(l => `
        <div class="bg-gray-800 rounded-lg p-4 border border-gray-700">
          <div class="flex justify-between items-start">
            <div>
              <div class="font-medium">${l.name || 'Anónimo'}</div>
              <div class="text-sm text-gray-400 mt-1">${l.interest || 'Sin interés definido'}</div>
              <div class="flex gap-2 mt-2">
                ${l.phone ? `<span class="text-xs px-2 py-1 rounded bg-gray-700">📱 ${l.phone}</span>` : ''}
                ${l.email ? `<span class="text-xs px-2 py-1 rounded bg-gray-700">📧 ${l.email}</span>` : ''}
                <span class="text-xs text-gray-500">${new Date(l.created_at).toLocaleString()}</span>
              </div>
            </div>
            <div class="flex items-center gap-4">
              <div class="text-right">
                <div class="text-2xl font-bold text-blue-400">${l.score}</div>
                <div class="text-xs text-gray-500">Score</div>
              </div>
              <select class="bg-gray-700 border border-gray-600 rounded px-2 py-1 text-xs"
                      hx-post="/admin/leads/${l.id}/status"
                      hx-vals='js:{"status": event.target.value}'>
                <option value="new" ${l.status === 'new' ? 'selected' : ''}>Nuevo</option>
                <option value="contacted" ${l.status === 'contacted' ? 'selected' : ''}>Contactado</option>
                <option value="qualified" ${l.status === 'qualified' ? 'selected' : ''}>Calificado</option>
                <option value="converted" ${l.status === 'converted' ? 'selected' : ''}>Convertido</option>
                <option value="lost" ${l.status === 'lost' ? 'selected' : ''}>Perdido</option>
              </select>
            </div>
          </div>
        </div>
      `).join('') || '<div class="text-gray-500 text-center py-8">No hay leads</div>'}
    </div>
  `));
});

// Agents page
admin.get('/agents', async (c) => {
  const { results: agents } = await c.env.DB.prepare(
    'SELECT * FROM agents ORDER BY created_at DESC'
  ).all();
  
  return c.html(layout('Agentes', 'agents', `
    <div class="flex justify-between items-center mb-6">
      <h2 class="text-2xl font-bold">🤖 Agentes</h2>
      <button class="bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded">
        + Nuevo Agente
      </button>
    </div>
    
    <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      ${agents.map(a => `
        <div class="bg-gray-800 rounded-lg p-4 border border-gray-700">
          <div class="flex justify-between items-start mb-3">
            <div>
              <div class="font-medium text-lg">${a.name}</div>
              <div class="text-sm text-gray-400">${a.description || 'Sin descripción'}</div>
            </div>
            <span class="px-2 py-1 rounded text-xs ${a.is_active ? 'bg-green-900 text-green-300' : 'bg-red-900 text-red-300'}">
              ${a.is_active ? 'Activo' : 'Inactivo'}
            </span>
          </div>
          
          <div class="space-y-2 text-sm">
            <div class="flex justify-between">
              <span class="text-gray-400">Tipo:</span>
              <span>${a.type}</span>
            </div>
            <div class="flex justify-between">
              <span class="text-gray-400">Modelo:</span>
              <span class="text-xs font-mono">${a.model.split('/').pop()}</span>
            </div>
            <div class="flex justify-between">
              <span class="text-gray-400">Temperatura:</span>
              <span>${a.temperature}</span>
            </div>
          </div>
          
          <div class="mt-4 pt-3 border-t border-gray-700 flex gap-2">
            <button class="flex-1 bg-gray-700 hover:bg-gray-600 px-3 py-1 rounded text-sm">✏️ Editar</button>
            <button class="bg-red-600 hover:bg-red-700 px-3 py-1 rounded text-sm">🗑️</button>
          </div>
        </div>
      `).join('') || '<div class="col-span-3 text-gray-500 text-center py-8">No hay agentes configurados</div>'}
    </div>
  `));
});

// Insights page
admin.get('/insights', async (c) => {
  return c.html(layout('Insights', 'insights', `
    <h2 class="text-2xl font-bold mb-6">💡 Insights y Analytics</h2>
    
    <div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
      <div class="bg-gray-800 rounded-lg p-4 border border-gray-700">
        <div class="text-gray-400 text-sm">Satisfacción Promedio</div>
        <div class="text-3xl font-bold text-green-400">85%</div>
      </div>
      <div class="bg-gray-800 rounded-lg p-4 border border-gray-700">
        <div class="text-gray-400 text-sm">Tiempo Promedio de Respuesta</div>
        <div class="text-3xl font-bold text-blue-400">2.3s</div>
      </div>
      <div class="bg-gray-800 rounded-lg p-4 border border-gray-700">
        <div class="text-gray-400 text-sm">Resolución sin Escalar</div>
        <div class="text-3xl font-bold text-purple-400">78%</div>
      </div>
    </div>
    
    <div class="bg-gray-800 rounded-lg p-4 border border-gray-700">
      <h3 class="font-semibold mb-4">📈 Tendencias (Últimos 7 días)</h3>
      <div class="h-64 flex items-center justify-center text-gray-500">
        Gráfico de tendencias (próximamente)
      </div>
    </div>
  `));
});

// Campaigns page
admin.get('/campaigns', async (c) => {
  return c.html(layout('Campañas', 'campaigns', `
    <div class="flex justify-between items-center mb-6">
      <h2 class="text-2xl font-bold">📢 Campañas</h2>
      <button class="bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded">
        + Nueva Campaña
      </button>
    </div>
    
    <div class="bg-gray-800 rounded-lg p-8 border border-gray-700 text-center">
      <div class="text-4xl mb-4">🚧</div>
      <h3 class="text-xl font-semibold mb-2">Próximamente</h3>
      <p class="text-gray-400">El sistema de campañas estará disponible en la próxima versión.</p>
    </div>
  `));
});

// Costs page
admin.get('/costs', async (c) => {
  const { results: usage } = await c.env.DB.prepare(
    `SELECT date(created_at) as date, 
     SUM(tokens_input) as input_tokens,
     SUM(tokens_output) as output_tokens,
     SUM(cost_usd) as cost
     FROM usage_logs 
     WHERE created_at > datetime('now', '-30 days')
     GROUP BY date(created_at)
     ORDER BY date DESC`
  ).all();
  
  const totalCost = usage.reduce((sum: number, u: any) => sum + (u.cost || 0), 0);
  const totalTokens = usage.reduce((sum: number, u: any) => sum + (u.input_tokens || 0) + (u.output_tokens || 0), 0);
  
  return c.html(layout('Costos', 'costs', `
    <h2 class="text-2xl font-bold mb-6">💰 Costos</h2>
    
    <div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
      <div class="bg-gray-800 rounded-lg p-4 border border-gray-700">
        <div class="text-gray-400 text-sm">Costo Total (30 días)</div>
        <div class="text-3xl font-bold text-green-400">$${totalCost.toFixed(4)}</div>
      </div>
      <div class="bg-gray-800 rounded-lg p-4 border border-gray-700">
        <div class="text-gray-400 text-sm">Tokens Totales</div>
        <div class="text-3xl font-bold text-blue-400">${(totalTokens / 1000).toFixed(1)}K</div>
      </div>
      <div class="bg-gray-800 rounded-lg p-4 border border-gray-700">
        <div class="text-gray-400 text-sm">Proyección Mensual</div>
        <div class="text-3xl font-bold text-purple-400">$${((totalCost / 30) * 30).toFixed(2)}</div>
      </div>
    </div>
    
    <div class="bg-gray-800 rounded-lg p-4 border border-gray-700">
      <h3 class="font-semibold mb-4">📊 Uso Diario</h3>
      <div class="space-y-2">
        ${usage.slice(0, 10).map(u => `
          <div class="flex justify-between items-center py-2 border-b border-gray-700">
            <span class="text-sm">${u.date}</span>
            <div class="flex gap-4 text-sm">
              <span class="text-gray-400">${((u.input_tokens || 0) / 1000).toFixed(1)}K in</span>
              <span class="text-gray-400">${((u.output_tokens || 0) / 1000).toFixed(1)}K out</span>
              <span class="text-green-400">$${(u.cost || 0).toFixed(4)}</span>
            </div>
          </div>
        `).join('') || '<div class="text-gray-500 text-center py-4">No hay datos de uso</div>'}
      </div>
    </div>
  `));
});

// Config page
admin.get('/config', async (c) => {
  const { results: settings } = await c.env.DB.prepare(
    'SELECT * FROM config ORDER BY category, key'
  ).all();
  
  return c.html(layout('Configuración', 'config', `
    <h2 class="text-2xl font-bold mb-6">⚙️ Configuración</h2>
    
    <div class="bg-gray-800 rounded-lg p-4 border border-gray-700">
      <h3 class="font-semibold mb-4">Configuración General</h3>
      
      <form hx-post="/admin/config/save" hx-swap="none">
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label class="block text-sm text-gray-400 mb-1">Nombre del Bot</label>
            <input type="text" name="bot_name" value="${settings.find((s: any) => s.key === 'bot_name')?.value || 'WorkerIAGO'}"
                   class="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 text-sm">
          </div>
          <div>
            <label class="block text-sm text-gray-400 mb-1">Idioma</label>
            <select name="language" class="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 text-sm">
              <option value="es" selected>Español</option>
              <option value="en">English</option>
              <option value="pt">Português</option>
            </select>
          </div>
          <div>
            <label class="block text-sm text-gray-400 mb-1">Modelo por Defecto</label>
            <select name="default_model" class="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 text-sm">
              <option value="@cf/meta/llama-3.1-8b-instruct-fp8" selected>Llama 3.1 8B</option>
              <option value="@cf/meta/llama-3.2-3b-instruct">Llama 3.2 3B (Rápido)</option>
              <option value="@cf/meta/llama-3.3-70b-instruct-fp8-fast">Llama 3.3 70B (Mejor)</option>
            </select>
          </div>
          <div>
            <label class="block text-sm text-gray-400 mb-1">Temperatura</label>
            <input type="number" name="temperature" step="0.1" min="0" max="1"
                   value="${settings.find((s: any) => s.key === 'temperature')?.value || '0.7'}"
                   class="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 text-sm">
          </div>
        </div>
        
        <div class="mt-4">
          <label class="block text-sm text-gray-400 mb-1">System Prompt por Defecto</label>
          <textarea name="system_prompt" rows="4"
                    class="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 text-sm font-mono">${settings.find((s: any) => s.key === 'system_prompt')?.value || 'Eres un asistente útil y amigable.'}</textarea>
        </div>
        
        <div class="mt-4 flex gap-2">
          <button type="submit" class="bg-green-600 hover:bg-green-700 px-4 py-2 rounded text-sm">
            💾 Guardar Configuración
          </button>
        </div>
      </form>
    </div>
  `));
});

// API Routes

// Stats API
admin.get('/api/stats', async (c) => {
  const [conversations, leads, messages, agents, tickets, usage] = await Promise.all([
    c.env.DB.prepare('SELECT COUNT(*) as count FROM conversations WHERE created_at > datetime("now", "-24 hours")').first(),
    c.env.DB.prepare('SELECT COUNT(*) as count FROM leads WHERE created_at > datetime("now", "-24 hours")').first(),
    c.env.DB.prepare('SELECT COUNT(*) as count FROM messages WHERE created_at > datetime("now", "-24 hours")').first(),
    c.env.DB.prepare('SELECT COUNT(*) as count FROM agents WHERE is_active = 1').first(),
    c.env.DB.prepare('SELECT COUNT(*) as count FROM tickets WHERE status IN ("new", "in_progress")').first(),
    c.env.DB.prepare('SELECT SUM(cost_usd) as cost FROM usage_logs WHERE created_at > datetime("now", "-24 hours")').first(),
  ]);

  return c.json({
    conversations_24h: (conversations as any)?.count || 0,
    leads_24h: (leads as any)?.count || 0,
    messages_24h: (messages as any)?.count || 0,
    active_agents: (agents as any)?.count || 0,
    open_tickets: (tickets as any)?.count || 0,
    cost_24h: (usage as any)?.cost || 0,
  });
});

// Conversations API
admin.get('/api/conversations', async (c) => {
  const limit = parseInt(c.req.query('limit') || '50');
  const { results } = await c.env.DB.prepare(
    `SELECT c.*, a.name as agent_name,
     (SELECT COUNT(*) FROM messages WHERE conversation_id = c.id) as message_count
     FROM conversations c 
     LEFT JOIN agents a ON c.agent_id = a.id 
     ORDER BY c.updated_at DESC 
     LIMIT ?`
  ).bind(limit).all();
  return c.json(results);
});

// Tickets API
admin.get('/api/tickets', async (c) => {
  const status = c.req.query('status');
  let query = 'SELECT * FROM tickets';
  if (status && status !== 'all') {
    query += ` WHERE status = '${status}'`;
  }
  query += ' ORDER BY priority DESC, created_at DESC';
  
  const { results } = await c.env.DB.prepare(query).all();
  return c.json(results);
});

// Leads API
admin.get('/api/leads', async (c) => {
  const limit = parseInt(c.req.query('limit') || '50');
  const { results } = await c.env.DB.prepare(
    'SELECT * FROM leads ORDER BY score DESC LIMIT ?'
  ).bind(limit).all();
  return c.json(results);
});

// Knowledge Base API
admin.get('/api/kb', async (c) => {
  const { results } = await c.env.DB.prepare(
    'SELECT * FROM knowledge_base ORDER BY updated_at DESC'
  ).all();
  return c.json(results);
});

// Agents API
admin.get('/api/agents', async (c) => {
  const { results } = await c.env.DB.prepare(
    'SELECT * FROM agents ORDER BY created_at DESC'
  ).all();
  return c.json(results);
});

// Save knowledge base document
admin.post('/admin/kb/save', async (c) => {
  const form = await c.req.formData();
  const id = String(form.get('id') || crypto.randomUUID());
  const title = String(form.get('title') || '').trim();
  const content = String(form.get('content') || '').trim();
  const category = String(form.get('category') || '').trim();
  const tags = String(form.get('tags') || '').split(',').map(t => t.trim()).filter(Boolean);
  
  if (!title || !content) {
    return c.json({ error: 'Title and content required' }, 400);
  }
  
  await c.env.DB.prepare(
    `INSERT OR REPLACE INTO knowledge_base (id, title, content, category, tags, updated_at)
     VALUES (?, ?, ?, ?, ?, datetime('now'))`
  ).bind(id, title, content, category, JSON.stringify(tags)).run();
  
  return c.redirect('/admin/kb');
});

// Update ticket status
admin.post('/admin/tickets/:id/status', async (c) => {
  const id = c.req.param('id');
  const form = await c.req.formData();
  const status = String(form.get('status') || 'new');
  
  await c.env.DB.prepare(
    'UPDATE tickets SET status = ?, updated_at = datetime("now") WHERE id = ?'
  ).bind(status, id).run();
  
  return c.json({ ok: true });
});

// Update lead status
admin.post('/admin/leads/:id/status', async (c) => {
  const id = c.req.param('id');
  const form = await c.req.formData();
  const status = String(form.get('status') || 'new');
  
  await c.env.DB.prepare(
    'UPDATE leads SET status = ?, updated_at = datetime("now") WHERE id = ?'
  ).bind(status, id).run();
  
  return c.json({ ok: true });
});

// Reply to conversation
admin.post('/admin/conversations/:id/reply', async (c) => {
  const id = c.req.param('id');
  const form = await c.req.formData();
  const text = String(form.get('text') || '').trim();
  
  if (!text) {
    return c.html('<span class="text-red-400">Escribe un mensaje</span>');
  }
  
  // Get conversation details
  const conversation = await c.env.DB.prepare(
    'SELECT * FROM conversations WHERE id = ?'
  ).bind(id).first() as any;
  
  if (!conversation) {
    return c.html('<span class="text-red-400">Conversación no encontrada</span>');
  }
  
  // Save message
  await c.env.DB.prepare(
    'INSERT INTO messages (conversation_id, role, content) VALUES (?, "owner", ?)'
  ).bind(id, text).run();
  
  // Update conversation
  await c.env.DB.prepare(
    'UPDATE conversations SET updated_at = datetime("now") WHERE id = ?'
  ).bind(id).run();
  
  // TODO: Send message through channel adapter (Telegram/WhatsApp)
  
  return c.html('<span class="text-green-400">✓ Mensaje enviado</span>');
});

// Pause conversation
admin.post('/admin/conversations/:id/pause', async (c) => {
  const id = c.req.param('id');
  
  await c.env.DB.prepare(
    `UPDATE conversations SET status = 'paused', paused_until = datetime('now', '+1 hour') WHERE id = ?`
  ).bind(id).run();
  
  return c.json({ ok: true });
});

// Escalate conversation
admin.post('/admin/conversations/:id/escalate', async (c) => {
  const id = c.req.param('id');
  
  await c.env.DB.prepare(
    `UPDATE conversations SET status = 'escalated', priority = 2 WHERE id = ?`
  ).bind(id).run();
  
  // Create ticket
  const conversation = await c.env.DB.prepare(
    'SELECT * FROM conversations WHERE id = ?'
  ).bind(id).first() as any;
  
  if (conversation) {
    await c.env.DB.prepare(
      `INSERT INTO tickets (conversation_id, agent_id, title, description, priority, category)
       VALUES (?, ?, ?, ?, 2, 'escalation')`
    ).bind(id, conversation.agent_id, `Escalación de ${conversation.user_name || 'Anónimo'}`, 
           'Conversación escalada por el sistema').run();
  }
  
  return c.json({ ok: true });
});

// Save config
admin.post('/admin/config/save', async (c) => {
  const form = await c.req.formData();
  
  const updates = [
    { key: 'bot_name', value: String(form.get('bot_name') || 'WorkerIAGO') },
    { key: 'language', value: String(form.get('language') || 'es') },
    { key: 'default_model', value: String(form.get('default_model') || '@cf/meta/llama-3.1-8b-instruct-fp8') },
    { key: 'temperature', value: String(form.get('temperature') || '0.7') },
    { key: 'system_prompt', value: String(form.get('system_prompt') || '') },
  ];
  
  for (const update of updates) {
    await c.env.DB.prepare(
      `INSERT OR REPLACE INTO config (key, value, updated_at) VALUES (?, ?, datetime('now'))`
    ).bind(update.key, update.value).run();
  }
  
  return c.redirect('/admin/config?saved=1');
});

export { admin as AdminPanel };
