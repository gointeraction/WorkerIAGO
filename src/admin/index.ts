import { Hono } from 'hono';
import { html } from 'hono/html';

type Bindings = {
  DB: D1Database;
  ADMIN_PASSWORD?: string;
  ENVIRONMENT?: string;
};

// Database row types
interface ConversationRow {
  id: number;
  agent_id: string;
  channel: string;
  chat_id: string;
  user_name: string | null;
  user_phone: string | null;
  status: string;
  intent: string | null;
  sentiment: string | null;
  priority: number;
  message_count: number;
  agent_name: string | null;
  created_at: string;
  updated_at: string;
}

interface TicketRow {
  id: number;
  conversation_id: number | null;
  agent_id: string;
  title: string;
  description: string | null;
  status: string;
  priority: number;
  category: string | null;
  agent_name: string | null;
  user_name: string | null;
  created_at: string;
  updated_at: string;
}

interface LeadRow {
  id: number;
  conversation_id: number | null;
  agent_id: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  interest: string | null;
  score: number;
  status: string;
  agent_name: string | null;
  created_at: string;
  updated_at: string;
}

interface KnowledgeRow {
  id: string;
  agent_id: string;
  title: string;
  content: string;
  category: string | null;
  tags: string | null;
  view_count: number;
  created_at: string;
  updated_at: string;
}

interface AgentRow {
  id: string;
  name: string;
  description: string | null;
  type: string;
  system_prompt: string;
  model: string;
  temperature: number;
  max_tokens: number;
  is_active: number;
  created_at: string;
  updated_at: string;
}

interface MessageRow {
  id: number;
  conversation_id: number;
  role: string;
  content: string;
  created_at: string;
}

interface UsageRow {
  date: string;
  input_tokens: number;
  output_tokens: number;
  cost: number;
}

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

// Layout helper - GoInteraction style
const layout = (title: string, activeTab: string, body: string) => html`<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} - WorkerIAGO Admin</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <script src="https://unpkg.com/htmx.org@1.9.10"></script>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap" rel="stylesheet">
  <script>
    tailwind.config = {
      theme: {
        extend: {
          fontFamily: {
            sans: ['Inter', 'sans-serif'],
          },
          colors: {
            dark: {
              900: '#0a0a0f',
              800: '#12121a',
              700: '#1a1a25',
              600: '#252530',
            },
            accent: {
              from: '#3b82f6',
              to: '#8b5cf6',
            }
          }
        }
      }
    }
  </script>
  <style>
    body {
      font-family: 'Inter', sans-serif;
      background: #0a0a0f;
    }
    
    .gradient-text {
      background: linear-gradient(135deg, #3b82f6, #8b5cf6);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
    }
    
    .gradient-bg {
      background: linear-gradient(135deg, #3b82f6, #8b5cf6);
    }
    
    .gradient-border {
      border: 1px solid transparent;
      background: linear-gradient(#12121a, #12121a) padding-box,
                  linear-gradient(135deg, #3b82f6, #8b5cf6) border-box;
    }
    
    .card-hover {
      transition: all 0.3s ease;
    }
    
    .card-hover:hover {
      transform: translateY(-2px);
      box-shadow: 0 20px 40px rgba(59, 130, 246, 0.1);
    }
    
    .glow {
      box-shadow: 0 0 60px rgba(59, 130, 246, 0.15);
    }
    
    .stat-card {
      background: linear-gradient(135deg, rgba(59, 130, 246, 0.1), rgba(139, 92, 246, 0.1));
      border: 1px solid rgba(59, 130, 246, 0.2);
    }
    
    .nav-item {
      transition: all 0.2s ease;
    }
    
    .nav-item:hover {
      background: rgba(59, 130, 246, 0.1);
    }
    
    .nav-item.active {
      background: linear-gradient(135deg, rgba(59, 130, 246, 0.2), rgba(139, 92, 246, 0.2));
      border-left: 3px solid #3b82f6;
    }
    
    .pulse-dot {
      animation: pulse 2s infinite;
    }
    
    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.5; }
    }
    
    .fade-in {
      animation: fadeIn 0.5s ease;
    }
    
    @keyframes fadeIn {
      from { opacity: 0; transform: translateY(10px); }
      to { opacity: 1; transform: translateY(0); }
    }
    
    ::-webkit-scrollbar {
      width: 8px;
    }
    
    ::-webkit-scrollbar-track {
      background: #12121a;
    }
    
    ::-webkit-scrollbar-thumb {
      background: #3b82f6;
      border-radius: 4px;
    }
  </style>
</head>
<body class="text-white min-h-screen">
  <div class="flex min-h-screen">
    <!-- Sidebar -->
    <aside class="w-72 bg-dark-800 border-r border-dark-600 fixed h-full flex flex-col">
      <!-- Logo -->
      <div class="p-6 border-b border-dark-600">
        <div class="flex items-center gap-3">
          <div class="w-10 h-10 gradient-bg rounded-xl flex items-center justify-center">
            <span class="text-xl">🔨</span>
          </div>
          <div>
            <h1 class="font-bold text-lg">WorkerIAGO</h1>
            <p class="text-xs text-gray-500">Admin Panel v2.0</p>
          </div>
        </div>
      </div>
      
      <!-- Navigation -->
      <nav class="flex-1 p-4 space-y-1 overflow-y-auto">
        <a href="/admin" class="nav-item flex items-center gap-3 px-4 py-3 rounded-lg text-gray-300 ${activeTab === 'overview' ? 'active' : ''}">
          <span class="text-lg">📊</span>
          <span>Resumen</span>
        </a>
        <a href="/admin/conversations" class="nav-item flex items-center gap-3 px-4 py-3 rounded-lg text-gray-300 ${activeTab === 'conversations' ? 'active' : ''}">
          <span class="text-lg">💬</span>
          <span>Conversaciones</span>
        </a>
        <a href="/admin/tickets" class="nav-item flex items-center gap-3 px-4 py-3 rounded-lg text-gray-300 ${activeTab === 'tickets' ? 'active' : ''}">
          <span class="text-lg">🎫</span>
          <span>Tickets</span>
        </a>
        <a href="/admin/leads" class="nav-item flex items-center gap-3 px-4 py-3 rounded-lg text-gray-300 ${activeTab === 'leads' ? 'active' : ''}">
          <span class="text-lg">👥</span>
          <span>Leads</span>
        </a>
        <a href="/admin/knowledge" class="nav-item flex items-center gap-3 px-4 py-3 rounded-lg text-gray-300 ${activeTab === 'knowledge' ? 'active' : ''}">
          <span class="text-lg">📚</span>
          <span>Base de Conocimiento</span>
        </a>
        <a href="/admin/agents" class="nav-item flex items-center gap-3 px-4 py-3 rounded-lg text-gray-300 ${activeTab === 'agents' ? 'active' : ''}">
          <span class="text-lg">🤖</span>
          <span>Agentes</span>
        </a>
        <a href="/admin/insights" class="nav-item flex items-center gap-3 px-4 py-3 rounded-lg text-gray-300 ${activeTab === 'insights' ? 'active' : ''}">
          <span class="text-lg">💡</span>
          <span>Insights</span>
        </a>
        <a href="/admin/campaigns" class="nav-item flex items-center gap-3 px-4 py-3 rounded-lg text-gray-300 ${activeTab === 'campaigns' ? 'active' : ''}">
          <span class="text-lg">📢</span>
          <span>Campañas</span>
        </a>
        <a href="/admin/costs" class="nav-item flex items-center gap-3 px-4 py-3 rounded-lg text-gray-300 ${activeTab === 'costs' ? 'active' : ''}">
          <span class="text-lg">💰</span>
          <span>Costos</span>
        </a>
        <a href="/admin/config" class="nav-item flex items-center gap-3 px-4 py-3 rounded-lg text-gray-300 ${activeTab === 'config' ? 'active' : ''}">
          <span class="text-lg">⚙️</span>
          <span>Configuración</span>
        </a>
      </nav>
      
      <!-- Footer -->
      <div class="p-4 border-t border-dark-600">
        <div class="flex items-center gap-2 text-sm text-gray-500">
          <span class="w-2 h-2 bg-green-500 rounded-full pulse-dot"></span>
          <span>Sistema activo</span>
        </div>
        <div class="mt-2 text-xs text-gray-600">
          Última actualización: <span id="last-update">--</span>
        </div>
      </div>
    </aside>
    
    <!-- Main content -->
    <main class="ml-72 flex-1 p-8">
      ${body}
    </main>
    
    <script>
      function updateLastUpdate() {
        document.getElementById('last-update').textContent = new Date().toLocaleTimeString();
      }
      updateLastUpdate();
      setInterval(updateLastUpdate, 30000);
    </script>
  </div>
</body>
</html>`;

// Main dashboard
admin.get('/', async (c) => {
  return c.html(layout('Resumen', 'overview', `
    <div class="fade-in">
      <!-- Header -->
      <div class="mb-8">
        <h1 class="text-4xl font-bold mb-2">
          <span class="gradient-text">Resumen</span>
        </h1>
        <p class="text-gray-400">Monitorea el rendimiento de tus agentes en tiempo real</p>
      </div>
      
      <!-- Stats Cards -->
      <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        <div class="stat-card rounded-2xl p-6 card-hover">
          <div class="flex items-center justify-between mb-4">
            <div class="w-12 h-12 gradient-bg rounded-xl flex items-center justify-center">
              <span class="text-2xl">💬</span>
            </div>
            <span class="text-green-400 text-sm">↑ 12%</span>
          </div>
          <div class="text-3xl font-bold mb-1" id="stats-conversations">-</div>
          <div class="text-gray-400 text-sm">Conversaciones (24h)</div>
        </div>
        
        <div class="stat-card rounded-2xl p-6 card-hover">
          <div class="flex items-center justify-between mb-4">
            <div class="w-12 h-12 gradient-bg rounded-xl flex items-center justify-center">
              <span class="text-2xl">👥</span>
            </div>
            <span class="text-green-400 text-sm">↑ 8%</span>
          </div>
          <div class="text-3xl font-bold mb-1" id="stats-leads">-</div>
          <div class="text-gray-400 text-sm">Leads Nuevos (24h)</div>
        </div>
        
        <div class="stat-card rounded-2xl p-6 card-hover">
          <div class="flex items-center justify-between mb-4">
            <div class="w-12 h-12 gradient-bg rounded-xl flex items-center justify-center">
              <span class="text-2xl">🎫</span>
            </div>
            <span class="text-yellow-400 text-sm">3 urgentes</span>
          </div>
          <div class="text-3xl font-bold mb-1" id="stats-tickets">-</div>
          <div class="text-gray-400 text-sm">Tickets Abiertos</div>
        </div>
        
        <div class="stat-card rounded-2xl p-6 card-hover">
          <div class="flex items-center justify-between mb-4">
            <div class="w-12 h-12 gradient-bg rounded-xl flex items-center justify-center">
              <span class="text-2xl">💰</span>
            </div>
            <span class="text-gray-400 text-sm">Proyección</span>
          </div>
          <div class="text-3xl font-bold mb-1" id="stats-cost">$0.00</div>
          <div class="text-gray-400 text-sm">Costo IA (24h)</div>
        </div>
      </div>
      
      <!-- Main Content Grid -->
      <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <!-- Recent Conversations -->
        <div class="lg:col-span-2 bg-dark-800 rounded-2xl p-6 border border-dark-600">
          <div class="flex items-center justify-between mb-6">
            <h2 class="text-xl font-semibold">💬 Conversaciones Recientes</h2>
            <a href="/admin/conversations" class="text-blue-400 hover:text-blue-300 text-sm">Ver todas →</a>
          </div>
          <div id="recent-conversations" class="space-y-4">
            <div class="text-gray-500 text-center py-8">Cargando...</div>
          </div>
        </div>
        
        <!-- Active Tickets -->
        <div class="bg-dark-800 rounded-2xl p-6 border border-dark-600">
          <div class="flex items-center justify-between mb-6">
            <h2 class="text-xl font-semibold">🎫 Tickets Activos</h2>
            <a href="/admin/tickets" class="text-blue-400 hover:text-blue-300 text-sm">Ver todos →</a>
          </div>
          <div id="active-tickets" class="space-y-4">
            <div class="text-gray-500 text-center py-8">Cargando...</div>
          </div>
        </div>
      </div>
      
      <!-- Quick Actions -->
      <div class="mt-6 bg-dark-800 rounded-2xl p-6 border border-dark-600">
        <h2 class="text-xl font-semibold mb-6">⚡ Acciones Rápidas</h2>
        <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
          <a href="/admin/agents" class="gradient-border rounded-xl p-4 flex items-center gap-4 card-hover">
            <div class="w-12 h-12 gradient-bg rounded-xl flex items-center justify-center">
              <span class="text-2xl">🤖</span>
            </div>
            <div>
              <div class="font-medium">Nuevo Agente</div>
              <div class="text-sm text-gray-400">Crear agente IA</div>
            </div>
          </a>
          
          <a href="/admin/knowledge" class="gradient-border rounded-xl p-4 flex items-center gap-4 card-hover">
            <div class="w-12 h-12 gradient-bg rounded-xl flex items-center justify-center">
              <span class="text-2xl">📚</span>
            </div>
            <div>
              <div class="font-medium">Agregar Documento</div>
              <div class="text-sm text-gray-400">Base de conocimiento</div>
            </div>
          </a>
          
          <a href="/admin/campaigns" class="gradient-border rounded-xl p-4 flex items-center gap-4 card-hover">
            <div class="w-12 h-12 gradient-bg rounded-xl flex items-center justify-center">
              <span class="text-2xl">📢</span>
            </div>
            <div>
              <div class="font-medium">Nueva Campaña</div>
              <div class="text-sm text-gray-400">Enviar mensajes</div>
            </div>
          </a>
        </div>
      </div>
      
      <!-- System Status -->
      <div class="mt-6 grid grid-cols-1 md:grid-cols-3 gap-6">
        <div class="bg-dark-800 rounded-2xl p-6 border border-dark-600">
          <div class="flex items-center gap-3 mb-4">
            <span class="w-3 h-3 bg-green-500 rounded-full pulse-dot"></span>
            <h3 class="font-medium">Sistema</h3>
          </div>
          <div class="text-2xl font-bold text-green-400">Operativo</div>
          <div class="text-sm text-gray-400 mt-1">99.9% uptime</div>
        </div>
        
        <div class="bg-dark-800 rounded-2xl p-6 border border-dark-600">
          <div class="flex items-center gap-3 mb-4">
            <span class="w-3 h-3 bg-blue-500 rounded-full pulse-dot"></span>
            <h3 class="font-medium">Modelo IA</h3>
          </div>
          <div class="text-2xl font-bold gradient-text">Llama 3.1 8B</div>
          <div class="text-sm text-gray-400 mt-1">Cloudflare Workers AI</div>
        </div>
        
        <div class="bg-dark-800 rounded-2xl p-6 border border-dark-600">
          <div class="flex items-center gap-3 mb-4">
            <span class="w-3 h-3 bg-purple-500 rounded-full pulse-dot"></span>
            <h3 class="font-medium">Base de Datos</h3>
          </div>
          <div class="text-2xl font-bold text-purple-400">D1</div>
          <div class="text-sm text-gray-400 mt-1">SQLite en edge</div>
        </div>
      </div>
      
      <script>
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
        
        async function loadRecentConversations() {
          try {
            const res = await fetch('/admin/api/conversations?limit=5');
            const data = await res.json();
            const container = document.getElementById('recent-conversations');
            if (data.length === 0) {
              container.innerHTML = '<div class="text-gray-500 text-center py-8">No hay conversaciones recientes</div>';
              return;
            }
            container.innerHTML = data.map(c => 
              '<div class="flex items-center justify-between p-4 bg-dark-700 rounded-xl card-hover">' +
                '<div class="flex items-center gap-4">' +
                  '<div class="w-10 h-10 gradient-bg rounded-lg flex items-center justify-center">' +
                    '<span class="text-lg">' + (c.channel === 'telegram' ? '📱' : c.channel === 'whatsapp' ? '💬' : '🌐') + '</span>' +
                  '</div>' +
                  '<div>' +
                    '<div class="font-medium">' + (c.user_name || 'Anónimo') + '</div>' +
                    '<div class="text-sm text-gray-400">' + c.channel + ' · ' + (c.intent || 'sin clasificar') + '</div>' +
                  '</div>' +
                '</div>' +
                '<span class="px-3 py-1 rounded-full text-xs ' + 
                  (c.status === 'active' ? 'bg-green-900/50 text-green-300' : 
                   c.status === 'escalated' ? 'bg-yellow-900/50 text-yellow-300' : 'bg-gray-700 text-gray-300') + 
                '">' + c.status + '</span>' +
              '</div>'
            ).join('');
          } catch (e) {
            console.error('Error loading conversations:', e);
          }
        }
        
        async function loadActiveTickets() {
          try {
            const res = await fetch('/admin/api/tickets?status=open');
            const data = await res.json();
            const container = document.getElementById('active-tickets');
            if (data.length === 0) {
              container.innerHTML = '<div class="text-gray-500 text-center py-8">No hay tickets activos 🎉</div>';
              return;
            }
            container.innerHTML = data.map(t => 
              '<div class="p-4 bg-dark-700 rounded-xl card-hover">' +
                '<div class="font-medium mb-2">' + t.title + '</div>' +
                '<div class="flex items-center justify-between">' +
                  '<span class="text-sm text-gray-400">' + t.category + '</span>' +
                  '<span class="px-3 py-1 rounded-full text-xs ' + 
                    (t.priority === 3 ? 'bg-red-900/50 text-red-300' : 
                     t.priority === 2 ? 'bg-orange-900/50 text-orange-300' : 'bg-gray-700 text-gray-300') + 
                  '">' + ['Baja', 'Media', 'Alta', 'Urgente'][t.priority] + '</span>' +
                '</div>' +
              '</div>'
            ).join('');
          } catch (e) {
            console.error('Error loading tickets:', e);
          }
        }
        
        loadStats();
        loadRecentConversations();
        loadActiveTickets();
        
        setInterval(loadStats, 30000);
        setInterval(loadRecentConversations, 10000);
      </script>
    </div>
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
  ).bind(limit, offset).all<ConversationRow>();
  
  const totalResult = await c.env.DB.prepare(
    'SELECT COUNT(*) as count FROM conversations'
  ).first<{ count: number }>();
  const total = totalResult?.count || 0;
  
  return c.html(layout('Conversaciones', 'conversations', `
    <div class="fade-in">
      <div class="flex justify-between items-center mb-8">
        <div>
          <h1 class="text-4xl font-bold mb-2">
            <span class="gradient-text">Conversaciones</span>
          </h1>
          <p class="text-gray-400">${total || 0} conversaciones totales</p>
        </div>
        <div class="flex gap-3">
          <input type="text" 
                 placeholder="Buscar..." 
                 class="bg-dark-700 border border-dark-600 rounded-xl px-4 py-2 text-sm focus:outline-none focus:border-blue-500"
                 hx-get="/admin/conversations/search"
                 hx-trigger="keyup changed delay:300ms"
                 hx-target="#conversations-list"
                 name="q">
          <select class="bg-dark-700 border border-dark-600 rounded-xl px-4 py-2 text-sm focus:outline-none focus:border-blue-500">
            <option value="">Todos los canales</option>
            <option value="telegram">Telegram</option>
            <option value="whatsapp">WhatsApp</option>
            <option value="web">Web</option>
          </select>
        </div>
      </div>
      
      <div id="conversations-list" class="space-y-4">
        ${conversations.map((c: ConversationRow) => `
          <div class="bg-dark-800 rounded-2xl p-6 border border-dark-600 card-hover cursor-pointer"
               hx-get="/admin/conversations/${c.id}/thread"
               hx-target="#thread-panel"
               hx-swap="innerHTML">
            <div class="flex justify-between items-start">
              <div class="flex items-center gap-4">
                <div class="w-12 h-12 gradient-bg rounded-xl flex items-center justify-center">
                  <span class="text-xl">${c.channel === 'telegram' ? '📱' : c.channel === 'whatsapp' ? '💬' : '🌐'}</span>
                </div>
                <div>
                  <div class="font-medium text-lg">${c.user_name || 'Anónimo'}</div>
                  <div class="text-gray-400">${c.channel} · ${c.intent || 'sin clasificar'}</div>
                  <div class="text-sm text-gray-500 mt-1">${c.message_count} mensajes · ${new Date(c.updated_at).toLocaleString()}</div>
                </div>
              </div>
              <div class="flex items-center gap-3">
                <span class="px-4 py-2 rounded-full text-sm ${
                  c.status === 'active' ? 'bg-green-900/50 text-green-300' :
                  c.status === 'escalated' ? 'bg-yellow-900/50 text-yellow-300' :
                  'bg-gray-700 text-gray-300'
                }">${c.status}</span>
                ${(c.priority || 0) > 0 ? `<span class="px-4 py-2 rounded-full text-sm bg-red-900/50 text-red-300">P${c.priority}</span>` : ''}
              </div>
            </div>
          </div>
        `).join('') || '<div class="text-gray-500 text-center py-12">No hay conversaciones</div>'}
      </div>
      
      <!-- Pagination -->
      <div class="flex justify-center gap-2 mt-8">
        ${page > 1 ? `<a href="/admin/conversations?page=${page - 1}" class="px-4 py-2 bg-dark-700 rounded-xl hover:bg-dark-600 transition">← Anterior</a>` : ''}
        <span class="px-4 py-2 text-gray-400">Página ${page} de ${Math.ceil((total || 0) / limit)}</span>
        ${page < Math.ceil((total || 0) / limit) ? `<a href="/admin/conversations?page=${page + 1}" class="px-4 py-2 bg-dark-700 rounded-xl hover:bg-dark-600 transition">Siguiente →</a>` : ''}
      </div>
      
      <!-- Thread Panel -->
      <div id="thread-panel" class="fixed right-0 top-0 w-[450px] h-full bg-dark-800 border-l border-dark-600 hidden overflow-y-auto">
      </div>
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
    return c.html('<div class="p-6 text-red-400">Conversación no encontrada</div>');
  }
  
  const { results: messages } = await c.env.DB.prepare(
    'SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC'
  ).bind(id).all<MessageRow>();
  
  return c.html(`
    <div class="p-6">
      <div class="flex justify-between items-center mb-6 pb-6 border-b border-dark-600">
        <div class="flex items-center gap-4">
          <div class="w-12 h-12 gradient-bg rounded-xl flex items-center justify-center">
            <span class="text-xl">${conversation.channel === 'telegram' ? '📱' : '💬'}</span>
          </div>
          <div>
            <div class="font-semibold text-lg">${conversation.user_name || 'Anónimo'}</div>
            <div class="text-sm text-gray-400">${conversation.channel} · ${conversation.intent}</div>
          </div>
        </div>
        <button onclick="document.getElementById('thread-panel').classList.add('hidden')" 
                class="w-8 h-8 bg-dark-700 rounded-lg flex items-center justify-center hover:bg-dark-600 transition">
          ✕
        </button>
      </div>
      
      <!-- Actions -->
      <div class="grid grid-cols-3 gap-3 mb-6">
        <button class="gradient-bg rounded-xl py-3 px-4 font-medium hover:opacity-90 transition"
                hx-post="/admin/conversations/${id}/reply"
                hx-target="#reply-status"
                hx-vals='js:{"text": document.getElementById("reply-input").value}'>
          📤 Responder
        </button>
        <button class="bg-dark-700 rounded-xl py-3 px-4 font-medium hover:bg-dark-600 transition border border-dark-600"
                hx-post="/admin/conversations/${id}/pause">
          ⏸️ Pausar
        </button>
        <button class="bg-red-600/20 rounded-xl py-3 px-4 font-medium hover:bg-red-600/30 transition border border-red-500/30 text-red-300"
                hx-post="/admin/conversations/${id}/escalate">
          🚨 Escalar
        </button>
      </div>
      
      <!-- Reply input -->
      <div class="mb-6">
        <textarea id="reply-input" 
                  class="w-full bg-dark-700 border border-dark-600 rounded-xl p-4 text-sm focus:outline-none focus:border-blue-500 resize-none"
                  rows="3"
                  placeholder="Escribe tu respuesta..."></textarea>
        <div id="reply-status" class="text-sm mt-2"></div>
      </div>
      
      <!-- Messages -->
      <div class="space-y-4 max-h-96 overflow-y-auto">
        ${messages.map(m => `
          <div class="flex ${m.role === 'user' ? 'justify-start' : 'justify-end'}">
            <div class="max-w-[85%] rounded-2xl p-4 ${
              m.role === 'user' ? 'bg-dark-700' :
              m.role === 'owner' ? 'gradient-bg' :
              'bg-dark-600'
            }">
              <div class="text-xs text-gray-400 mb-2">${m.role} · ${new Date(m.created_at).toLocaleTimeString()}</div>
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
  
  const { results: tickets } = await c.env.DB.prepare(query).all<TicketRow>();
  
  return c.html(layout('Tickets', 'tickets', `
    <div class="fade-in">
      <div class="flex justify-between items-center mb-8">
        <div>
          <h1 class="text-4xl font-bold mb-2">
            <span class="gradient-text">Tickets</span>
          </h1>
          <p class="text-gray-400">Sistema de soporte con prioridades</p>
        </div>
        <div class="flex gap-2">
          <a href="/admin/tickets?status=all" class="px-4 py-2 rounded-xl text-sm ${status === 'all' ? 'gradient-bg' : 'bg-dark-700 hover:bg-dark-600'} transition">Todos</a>
          <a href="/admin/tickets?status=new" class="px-4 py-2 rounded-xl text-sm ${status === 'new' ? 'gradient-bg' : 'bg-dark-700 hover:bg-dark-600'} transition">Nuevos</a>
          <a href="/admin/tickets?status=in_progress" class="px-4 py-2 rounded-xl text-sm ${status === 'in_progress' ? 'gradient-bg' : 'bg-dark-700 hover:bg-dark-600'} transition">En Progreso</a>
          <a href="/admin/tickets?status=resolved" class="px-4 py-2 rounded-xl text-sm ${status === 'resolved' ? 'gradient-bg' : 'bg-dark-700 hover:bg-dark-600'} transition">Resueltos</a>
        </div>
      </div>
      
      <div class="space-y-4">
        ${tickets.map((t: TicketRow) => `
          <div class="bg-dark-800 rounded-2xl p-6 border border-dark-600 card-hover">
            <div class="flex justify-between items-start">
              <div class="flex-1">
                <div class="font-semibold text-lg mb-2">${t.title}</div>
                <div class="text-gray-400 mb-4">${t.description || 'Sin descripción'}</div>
                <div class="flex gap-3">
                  <span class="px-3 py-1 rounded-full text-xs bg-dark-700">${t.category || 'general'}</span>
                  <span class="px-3 py-1 rounded-full text-xs bg-dark-700">${t.agent_name || 'N/A'}</span>
                  <span class="text-xs text-gray-500">${new Date(t.created_at).toLocaleString()}</span>
                </div>
              </div>
              <div class="flex items-center gap-4">
                <span class="px-4 py-2 rounded-full text-sm ${
                  t.priority === 3 ? 'bg-red-900/50 text-red-300' :
                  t.priority === 2 ? 'bg-orange-900/50 text-orange-300' :
                  t.priority === 1 ? 'bg-yellow-900/50 text-yellow-300' :
                  'bg-dark-700 text-gray-300'
                }">${['Baja', 'Media', 'Alta', 'Urgente'][t.priority] || 'Baja'}</span>
                <select class="bg-dark-700 border border-dark-600 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
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
        `).join('') || '<div class="text-gray-500 text-center py-12">No hay tickets</div>'}
      </div>
    </div>
  `));
});

// Knowledge Base page
admin.get('/knowledge', async (c) => {
  const { results: documents } = await c.env.DB.prepare(
    'SELECT * FROM knowledge_base ORDER BY updated_at DESC'
  ).all<KnowledgeRow>();
  
  return c.html(layout('Base de Conocimiento', 'knowledge', `
    <div class="fade-in">
      <div class="flex justify-between items-center mb-8">
        <div>
          <h1 class="text-4xl font-bold mb-2">
            <span class="gradient-text">Base de Conocimiento</span>
          </h1>
          <p class="text-gray-400">${documents.length} documentos indexados</p>
        </div>
        <button onclick="showCreateDocument()" class="gradient-bg rounded-xl px-6 py-3 font-medium hover:opacity-90 transition">
          + Nuevo Documento
        </button>
      </div>
      
      <!-- Create/Edit Form -->
      <div id="kb-form" class="hidden bg-dark-800 rounded-2xl p-6 border border-dark-600 mb-8">
        <h3 class="text-xl font-semibold mb-6">Nuevo Documento</h3>
        <form hx-post="/admin/kb/save" hx-target="#kb-list" hx-swap="innerHTML">
          <input type="hidden" id="doc-id" name="id" value="">
          
          <div class="grid grid-cols-2 gap-6 mb-6">
            <div>
              <label class="block text-sm text-gray-400 mb-2">Título</label>
              <input type="text" name="title" id="doc-title" required
                     class="w-full bg-dark-700 border border-dark-600 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-blue-500">
            </div>
            <div>
              <label class="block text-sm text-gray-400 mb-2">Categoría</label>
              <input type="text" name="category" id="doc-category"
                     class="w-full bg-dark-700 border border-dark-600 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-blue-500"
                     placeholder="ej: FAQ, Productos, Políticas">
            </div>
          </div>
          
          <div class="mb-6">
            <label class="block text-sm text-gray-400 mb-2">Contenido</label>
            <textarea name="content" id="doc-content" required rows="8"
                      class="w-full bg-dark-700 border border-dark-600 rounded-xl px-4 py-3 text-sm font-mono focus:outline-none focus:border-blue-500"></textarea>
          </div>
          
          <div class="mb-6">
            <label class="block text-sm text-gray-400 mb-2">Tags (separados por coma)</label>
            <input type="text" name="tags" id="doc-tags"
                   class="w-full bg-dark-700 border border-dark-600 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-blue-500"
                   placeholder="precio, envío, garantía">
          </div>
          
          <div class="flex gap-3">
            <button type="submit" class="gradient-bg rounded-xl px-6 py-3 font-medium hover:opacity-90 transition">
              💾 Guardar
            </button>
            <button type="button" onclick="hideCreateDocument()" class="bg-dark-700 rounded-xl px-6 py-3 font-medium hover:bg-dark-600 transition border border-dark-600">
              Cancelar
            </button>
          </div>
        </form>
      </div>
      
      <!-- Documents list -->
      <div id="kb-list" class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        ${documents.map((d: KnowledgeRow) => `
          <div class="bg-dark-800 rounded-2xl p-6 border border-dark-600 card-hover">
            <div class="flex justify-between items-start mb-4">
              <div class="w-10 h-10 gradient-bg rounded-lg flex items-center justify-center">
                <span class="text-lg">📄</span>
              </div>
              <div class="flex gap-2">
                <button onclick="editDocument('${d.id}', '${d.title}', '${d.category || ''}', '${d.content.replace(/'/g, "\\'")}')"
                        class="w-8 h-8 bg-dark-700 rounded-lg flex items-center justify-center hover:bg-dark-600 transition">✏️</button>
                <button hx-delete="/admin/kb/${d.id}" 
                        hx-confirm="¿Eliminar este documento?"
                        hx-target="#kb-list"
                        class="w-8 h-8 bg-dark-700 rounded-lg flex items-center justify-center hover:bg-red-600/20 transition">🗑️</button>
              </div>
            </div>
            <div class="font-medium mb-2">${d.title}</div>
            <div class="text-sm text-gray-400 mb-4 line-clamp-2">${d.content.substring(0, 150)}...</div>
            <div class="flex gap-2">
              <span class="px-3 py-1 rounded-full text-xs bg-dark-700">${d.category || 'Sin categoría'}</span>
              <span class="text-xs text-gray-500">${d.view_count || 0} vistas</span>
            </div>
          </div>
        `).join('') || '<div class="col-span-3 text-gray-500 text-center py-12">No hay documentos. ¡Crea el primero!</div>'}
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
        
        function editDocument(id: string, title: string, category: string, content: string) {
          document.getElementById('kb-form').classList.remove('hidden');
          (document.getElementById('doc-id') as HTMLInputElement).value = id;
          (document.getElementById('doc-title') as HTMLInputElement).value = title;
          (document.getElementById('doc-category') as HTMLInputElement).value = category;
          (document.getElementById('doc-content') as HTMLTextAreaElement).value = content;
        }
      </script>
    </div>
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
  
  const { results: leads } = await c.env.DB.prepare(query).all<LeadRow>();
  
  return c.html(layout('Leads', 'leads', `
    <div class="fade-in">
      <div class="flex justify-between items-center mb-8">
        <div>
          <h1 class="text-4xl font-bold mb-2">
            <span class="gradient-text">Leads</span>
          </h1>
          <p class="text-gray-400">${leads.length} leads totales</p>
        </div>
        <div class="flex gap-2">
          <a href="/admin/leads?status=all" class="px-4 py-2 rounded-xl text-sm ${status === 'all' ? 'gradient-bg' : 'bg-dark-700 hover:bg-dark-600'} transition">Todos</a>
          <a href="/admin/leads?status=new" class="px-4 py-2 rounded-xl text-sm ${status === 'new' ? 'gradient-bg' : 'bg-dark-700 hover:bg-dark-600'} transition">Nuevos</a>
          <a href="/admin/leads?status=contacted" class="px-4 py-2 rounded-xl text-sm ${status === 'contacted' ? 'gradient-bg' : 'bg-dark-700 hover:bg-dark-600'} transition">Contactados</a>
          <a href="/admin/leads?status=converted" class="px-4 py-2 rounded-xl text-sm ${status === 'converted' ? 'gradient-bg' : 'bg-dark-700 hover:bg-dark-600'} transition">Convertidos</a>
          <button class="gradient-bg rounded-xl px-4 py-2 text-sm font-medium hover:opacity-90 transition ml-4">
            📥 Exportar CSV
          </button>
        </div>
      </div>
      
      <div class="space-y-4">
        ${leads.map((l: LeadRow) => `
          <div class="bg-dark-800 rounded-2xl p-6 border border-dark-600 card-hover">
            <div class="flex justify-between items-start">
              <div class="flex items-center gap-4">
                <div class="w-12 h-12 gradient-bg rounded-xl flex items-center justify-center">
                  <span class="text-xl">👤</span>
                </div>
                <div>
                  <div class="font-medium text-lg">${l.name || 'Anónimo'}</div>
                  <div class="text-gray-400">${l.interest || 'Sin interés definido'}</div>
                  <div class="flex gap-2 mt-2">
                    ${l.phone ? `<span class="px-3 py-1 rounded-full text-xs bg-dark-700">📱 ${l.phone}</span>` : ''}
                    ${l.email ? `<span class="px-3 py-1 rounded-full text-xs bg-dark-700">📧 ${l.email}</span>` : ''}
                    <span class="text-xs text-gray-500">${new Date(l.created_at).toLocaleString()}</span>
                  </div>
                </div>
              </div>
              <div class="flex items-center gap-6">
                <div class="text-right">
                  <div class="text-3xl font-bold gradient-text">${l.score}</div>
                  <div class="text-xs text-gray-500">Score</div>
                </div>
                <select class="bg-dark-700 border border-dark-600 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
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
        `).join('') || '<div class="text-gray-500 text-center py-12">No hay leads</div>'}
      </div>
    </div>
  `));
});

// Agents page
admin.get('/agents', async (c) => {
  const { results: agents } = await c.env.DB.prepare(
    'SELECT * FROM agents ORDER BY created_at DESC'
  ).all<AgentRow>();
  
  return c.html(layout('Agentes', 'agents', `
    <div class="fade-in">
      <div class="flex justify-between items-center mb-8">
        <div>
          <h1 class="text-4xl font-bold mb-2">
            <span class="gradient-text">Agentes</span>
          </h1>
          <p class="text-gray-400">${agents.length} agentes configurados</p>
        </div>
        <button class="gradient-bg rounded-xl px-6 py-3 font-medium hover:opacity-90 transition">
          + Nuevo Agente
        </button>
      </div>
      
      <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        ${agents.map((a: AgentRow) => `
          <div class="bg-dark-800 rounded-2xl p-6 border border-dark-600 card-hover">
            <div class="flex justify-between items-start mb-4">
              <div class="w-14 h-14 gradient-bg rounded-xl flex items-center justify-center">
                <span class="text-2xl">🤖</span>
              </div>
              <span class="px-3 py-1 rounded-full text-xs ${a.is_active ? 'bg-green-900/50 text-green-300' : 'bg-red-900/50 text-red-300'}">
                ${a.is_active ? 'Activo' : 'Inactivo'}
              </span>
            </div>
            
            <div class="font-semibold text-lg mb-2">${a.name}</div>
            <div class="text-gray-400 text-sm mb-4">${a.description || 'Sin descripción'}</div>
            
            <div class="space-y-3 mb-6">
              <div class="flex justify-between text-sm">
                <span class="text-gray-500">Tipo</span>
                <span class="px-3 py-1 rounded-full text-xs bg-dark-700">${a.type}</span>
              </div>
              <div class="flex justify-between text-sm">
                <span class="text-gray-500">Modelo</span>
                <span class="text-xs font-mono">${a.model.split('/').pop()}</span>
              </div>
              <div class="flex justify-between text-sm">
                <span class="text-gray-500">Temperatura</span>
                <span>${a.temperature}</span>
              </div>
            </div>
            
            <div class="flex gap-3">
              <button class="flex-1 bg-dark-700 hover:bg-dark-600 rounded-xl py-2 text-sm transition border border-dark-600">✏️ Editar</button>
              <button class="bg-dark-700 hover:bg-red-600/20 rounded-xl py-2 px-4 text-sm transition border border-dark-600">🗑️</button>
            </div>
          </div>
        `).join('') || '<div class="col-span-3 text-gray-500 text-center py-12">No hay agentes configurados</div>'}
      </div>
    </div>
  `));
});

// Insights page
admin.get('/insights', async (c) => {
  return c.html(layout('Insights', 'insights', `
    <div class="fade-in">
      <div class="mb-8">
        <h1 class="text-4xl font-bold mb-2">
          <span class="gradient-text">Insights</span>
        </h1>
        <p class="text-gray-400">Analytics y métricas de rendimiento</p>
      </div>
      
      <div class="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <div class="stat-card rounded-2xl p-6">
          <div class="text-gray-400 text-sm mb-2">Satisfacción Promedio</div>
          <div class="text-4xl font-bold text-green-400">85%</div>
          <div class="text-sm text-gray-500 mt-2">↑ 3% vs mes anterior</div>
        </div>
        <div class="stat-card rounded-2xl p-6">
          <div class="text-gray-400 text-sm mb-2">Tiempo Promedio de Respuesta</div>
          <div class="text-4xl font-bold gradient-text">2.3s</div>
          <div class="text-sm text-gray-500 mt-2">↓ 0.5s vs mes anterior</div>
        </div>
        <div class="stat-card rounded-2xl p-6">
          <div class="text-gray-400 text-sm mb-2">Resolución sin Escalar</div>
          <div class="text-4xl font-bold text-purple-400">78%</div>
          <div class="text-sm text-gray-500 mt-2">↑ 5% vs mes anterior</div>
        </div>
      </div>
      
      <div class="bg-dark-800 rounded-2xl p-8 border border-dark-600">
        <h2 class="text-xl font-semibold mb-6">📈 Tendencias (Últimos 7 días)</h2>
        <div class="h-64 flex items-center justify-center text-gray-500">
          <div class="text-center">
            <div class="text-4xl mb-4">📊</div>
            <div>Gráfico de tendencias (próximamente)</div>
          </div>
        </div>
      </div>
    </div>
  `));
});

// Campaigns page
admin.get('/campaigns', async (c) => {
  return c.html(layout('Campañas', 'campaigns', `
    <div class="fade-in">
      <div class="flex justify-between items-center mb-8">
        <div>
          <h1 class="text-4xl font-bold mb-2">
            <span class="gradient-text">Campañas</span>
          </h1>
          <p class="text-gray-400">Envío masivo de mensajes</p>
        </div>
        <button class="gradient-bg rounded-xl px-6 py-3 font-medium hover:opacity-90 transition">
          + Nueva Campaña
        </button>
      </div>
      
      <div class="bg-dark-800 rounded-2xl p-12 border border-dark-600 text-center">
        <div class="text-6xl mb-6">🚧</div>
        <h2 class="text-2xl font-semibold mb-4">Próximamente</h2>
        <p class="text-gray-400 max-w-md mx-auto">El sistema de campañas estará disponible en la próxima versión. Permite enviar mensajes masivos por WhatsApp y Telegram.</p>
      </div>
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
  ).all<UsageRow>();
  
  const totalCost = usage.reduce((sum: number, u: UsageRow) => sum + (u.cost || 0), 0);
  const totalTokens = usage.reduce((sum: number, u: UsageRow) => sum + (u.input_tokens || 0) + (u.output_tokens || 0), 0);
  
  return c.html(layout('Costos', 'costs', `
    <div class="fade-in">
      <div class="mb-8">
        <h1 class="text-4xl font-bold mb-2">
          <span class="gradient-text">Costos</span>
        </h1>
        <p class="text-gray-400">Tracking de uso y costos de IA</p>
      </div>
      
      <div class="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <div class="stat-card rounded-2xl p-6">
          <div class="text-gray-400 text-sm mb-2">Costo Total (30 días)</div>
          <div class="text-4xl font-bold text-green-400">$${totalCost.toFixed(4)}</div>
        </div>
        <div class="stat-card rounded-2xl p-6">
          <div class="text-gray-400 text-sm mb-2">Tokens Totales</div>
          <div class="text-4xl font-bold gradient-text">${(totalTokens / 1000).toFixed(1)}K</div>
        </div>
        <div class="stat-card rounded-2xl p-6">
          <div class="text-gray-400 text-sm mb-2">Proyección Mensual</div>
          <div class="text-4xl font-bold text-purple-400">$${((totalCost / 30) * 30).toFixed(2)}</div>
        </div>
      </div>
      
      <div class="bg-dark-800 rounded-2xl p-6 border border-dark-600">
        <h2 class="text-xl font-semibold mb-6">📊 Uso Diario</h2>
        <div class="space-y-3">
          ${usage.slice(0, 10).map((u: UsageRow) => `
            <div class="flex justify-between items-center py-4 px-4 bg-dark-700 rounded-xl">
              <span class="font-medium">${u.date}</span>
              <div class="flex gap-6 text-sm">
                <span class="text-gray-400">${((u.input_tokens || 0) / 1000).toFixed(1)}K in</span>
                <span class="text-gray-400">${((u.output_tokens || 0) / 1000).toFixed(1)}K out</span>
                <span class="text-green-400 font-medium">$${(u.cost || 0).toFixed(4)}</span>
              </div>
            </div>
          `).join('') || '<div class="text-gray-500 text-center py-8">No hay datos de uso</div>'}
        </div>
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
    <div class="fade-in">
      <div class="mb-8">
        <h1 class="text-4xl font-bold mb-2">
          <span class="gradient-text">Configuración</span>
        </h1>
        <p class="text-gray-400">Ajustes generales del bot</p>
      </div>
      
      <div class="bg-dark-800 rounded-2xl p-8 border border-dark-600">
        <h2 class="text-xl font-semibold mb-6">Configuración General</h2>
        
        <form hx-post="/admin/config/save" hx-swap="none">
          <div class="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
            <div>
              <label class="block text-sm text-gray-400 mb-2">Nombre del Bot</label>
              <input type="text" name="bot_name" value="${settings.find((s: any) => s.key === 'bot_name')?.value || 'WorkerIAGO'}"
                     class="w-full bg-dark-700 border border-dark-600 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-blue-500">
            </div>
            <div>
              <label class="block text-sm text-gray-400 mb-2">Idioma</label>
              <select name="language" class="w-full bg-dark-700 border border-dark-600 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-blue-500">
                <option value="es" selected>Español</option>
                <option value="en">English</option>
                <option value="pt">Português</option>
              </select>
            </div>
            <div>
              <label class="block text-sm text-gray-400 mb-2">Modelo por Defecto</label>
              <select name="default_model" class="w-full bg-dark-700 border border-dark-600 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-blue-500">
                <option value="@cf/meta/llama-3.1-8b-instruct-fp8" selected>Llama 3.1 8B</option>
                <option value="@cf/meta/llama-3.2-3b-instruct">Llama 3.2 3B (Rápido)</option>
                <option value="@cf/meta/llama-3.3-70b-instruct-fp8-fast">Llama 3.3 70B (Mejor)</option>
              </select>
            </div>
            <div>
              <label class="block text-sm text-gray-400 mb-2">Temperatura</label>
              <input type="number" name="temperature" step="0.1" min="0" max="1"
                     value="${settings.find((s: any) => s.key === 'temperature')?.value || '0.7'}"
                     class="w-full bg-dark-700 border border-dark-600 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-blue-500">
            </div>
          </div>
          
          <div class="mb-6">
            <label class="block text-sm text-gray-400 mb-2">System Prompt por Defecto</label>
            <textarea name="system_prompt" rows="4"
                      class="w-full bg-dark-700 border border-dark-600 rounded-xl px-4 py-3 text-sm font-mono focus:outline-none focus:border-blue-500">${settings.find((s: any) => s.key === 'system_prompt')?.value || 'Eres un asistente útil y amigable.'}</textarea>
          </div>
          
          <button type="submit" class="gradient-bg rounded-xl px-6 py-3 font-medium hover:opacity-90 transition">
            💾 Guardar Configuración
          </button>
        </form>
      </div>
    </div>
  `));
});

// API Routes

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

admin.get('/api/leads', async (c) => {
  const limit = parseInt(c.req.query('limit') || '50');
  const { results } = await c.env.DB.prepare(
    'SELECT * FROM leads ORDER BY score DESC LIMIT ?'
  ).bind(limit).all();
  return c.json(results);
});

admin.get('/api/kb', async (c) => {
  const { results } = await c.env.DB.prepare(
    'SELECT * FROM knowledge_base ORDER BY updated_at DESC'
  ).all();
  return c.json(results);
});

admin.get('/api/agents', async (c) => {
  const { results } = await c.env.DB.prepare(
    'SELECT * FROM agents ORDER BY created_at DESC'
  ).all();
  return c.json(results);
});

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

admin.post('/admin/tickets/:id/status', async (c) => {
  const id = c.req.param('id');
  const form = await c.req.formData();
  const status = String(form.get('status') || 'new');
  
  await c.env.DB.prepare(
    'UPDATE tickets SET status = ?, updated_at = datetime("now") WHERE id = ?'
  ).bind(status, id).run();
  
  return c.json({ ok: true });
});

admin.post('/admin/leads/:id/status', async (c) => {
  const id = c.req.param('id');
  const form = await c.req.formData();
  const status = String(form.get('status') || 'new');
  
  await c.env.DB.prepare(
    'UPDATE leads SET status = ?, updated_at = datetime("now") WHERE id = ?'
  ).bind(status, id).run();
  
  return c.json({ ok: true });
});

admin.post('/admin/conversations/:id/reply', async (c) => {
  const id = c.req.param('id');
  const form = await c.req.formData();
  const text = String(form.get('text') || '').trim();
  
  if (!text) {
    return c.html('<span class="text-red-400">Escribe un mensaje</span>');
  }
  
  const conversation = await c.env.DB.prepare(
    'SELECT * FROM conversations WHERE id = ?'
  ).bind(id).first() as any;
  
  if (!conversation) {
    return c.html('<span class="text-red-400">Conversación no encontrada</span>');
  }
  
  await c.env.DB.prepare(
    'INSERT INTO messages (conversation_id, role, content) VALUES (?, "owner", ?)'
  ).bind(id, text).run();
  
  await c.env.DB.prepare(
    'UPDATE conversations SET updated_at = datetime("now") WHERE id = ?'
  ).bind(id).run();
  
  return c.html('<span class="text-green-400">✓ Mensaje enviado</span>');
});

admin.post('/admin/conversations/:id/pause', async (c) => {
  const id = c.req.param('id');
  
  await c.env.DB.prepare(
    `UPDATE conversations SET status = 'paused', paused_until = datetime('now', '+1 hour') WHERE id = ?`
  ).bind(id).run();
  
  return c.json({ ok: true });
});

admin.post('/admin/conversations/:id/escalate', async (c) => {
  const id = c.req.param('id');
  
  await c.env.DB.prepare(
    `UPDATE conversations SET status = 'escalated', priority = 2 WHERE id = ?`
  ).bind(id).run();
  
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
