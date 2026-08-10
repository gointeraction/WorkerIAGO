import { Hono } from 'hono';
import { html } from 'hono/html';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { Bindings, tId, renderPage, auditLog, getSessionSecret, signSession, verifySession, issueCsrfToken, verifyCsrf, tInfo, layout, SESSION_SECRET, AgentRow, ConversationRow, KnowledgeRow, LeadRow, MessageRow, TicketRow, UsageRow } from '../utils';

export function registerDashboardRoutes(admin: Hono<{ Bindings: Bindings }>) {
  

// Main dashboard
admin.get('/', async (c) => {
  return renderPage(c, 'Resumen', 'overview', `
    <div class="fade-in">
      <!-- Header -->
      <div class="mb-8">
        <h1 class="text-4xl font-extrabold mb-2">
          <span class="text-gradient-orange">Resumen</span>
        </h1>
        <p class="text-gim-neutral-500">Monitorea el rendimiento de tus agentes en tiempo real</p>
      </div>
      
      <!-- Stats Cards -->
      <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        <div class="stat-card-orange rounded-2xl p-6 card-hover">
          <div class="flex items-center justify-between mb-4">
            <div class="w-12 h-12 bg-gradient-orange rounded-xl flex items-center justify-center shadow-lg shadow-gim-orange-500/20">
              <svg class="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M8 12h8M8 8h8m-8 8h5m2-13a9 9 0 11-9 9 9 9 0 019-9z"/></svg>
            </div>
            <span class="text-green-500 text-sm font-semibold">Ôåæ 12%</span>
          </div>
          <div class="text-3xl font-extrabold text-gim-neutral-900 mb-1" id="stats-conversations">-</div>
          <div class="text-gim-neutral-500 text-sm">Conversaciones (24h)</div>
        </div>
        
        <div class="stat-card-cyan rounded-2xl p-6 card-hover">
          <div class="flex items-center justify-between mb-4">
            <div class="w-12 h-12 bg-gradient-cyan rounded-xl flex items-center justify-center shadow-lg shadow-gim-cyan-500/20">
              <svg class="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"/></svg>
            </div>
            <span class="text-green-500 text-sm font-semibold">Ôåæ 8%</span>
          </div>
          <div class="text-3xl font-extrabold text-gim-neutral-900 mb-1" id="stats-leads">-</div>
          <div class="text-gim-neutral-500 text-sm">Leads Nuevos (24h)</div>
        </div>
        
        <div class="stat-card-purple rounded-2xl p-6 card-hover">
          <div class="flex items-center justify-between mb-4">
            <div class="w-12 h-12 bg-gradient-purple rounded-xl flex items-center justify-center shadow-lg shadow-gim-purple-500/20">
              <svg class="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M15 5v2m0 0v2m0-2h2m-2 0h-2M5 5h6v6H5V5zm0 8h6v6H5v-6zm8 0h6v6h-6v-6z"/></svg>
            </div>
            <span class="text-gim-orange-500 text-sm font-semibold">3 urgentes</span>
          </div>
          <div class="text-3xl font-extrabold text-gim-neutral-900 mb-1" id="stats-tickets">-</div>
          <div class="text-gim-neutral-500 text-sm">Tickets Abiertos</div>
        </div>
        
        <div class="stat-card-green rounded-2xl p-6 card-hover">
          <div class="flex items-center justify-between mb-4">
            <div class="w-12 h-12 bg-green-500 rounded-xl flex items-center justify-center shadow-lg shadow-green-500/20">
              <svg class="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
            </div>
            <span class="text-gim-neutral-400 text-sm">Proyecci├│n</span>
          </div>
          <div class="text-3xl font-extrabold text-gim-neutral-900 mb-1" id="stats-cost">$0.00</div>
          <div class="text-gim-neutral-500 text-sm">Costo IA (24h)</div>
        </div>
      </div>
      
      <!-- Main Content Grid -->
      <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <!-- Recent Conversations -->
        <div class="lg:col-span-2 bg-white rounded-2xl p-6 border border-gim-neutral-200 shadow-sm">
          <div class="flex items-center justify-between mb-6">
            <h2 class="text-xl font-bold text-gim-neutral-900">Conversaciones Recientes</h2>
            <a href="/admin/conversations" class="text-gim-orange-500 hover:text-gim-orange-600 text-sm font-semibold transition-colors">Ver todas ÔåÆ</a>
          </div>
          <div id="recent-conversations" class="space-y-4">
            <div class="text-gim-neutral-400 text-center py-8">Cargando...</div>
          </div>
        </div>
        
        <!-- Active Tickets -->
        <div class="bg-white rounded-2xl p-6 border border-gim-neutral-200 shadow-sm">
          <div class="flex items-center justify-between mb-6">
            <h2 class="text-xl font-bold text-gim-neutral-900">Tickets Activos</h2>
            <a href="/admin/tickets" class="text-gim-orange-500 hover:text-gim-orange-600 text-sm font-semibold transition-colors">Ver todos ÔåÆ</a>
          </div>
          <div id="active-tickets" class="space-y-4">
            <div class="text-gim-neutral-400 text-center py-8">Cargando...</div>
          </div>
        </div>
      </div>
      
      <!-- Quick Actions -->
      <div class="mt-6 bg-white rounded-2xl p-6 border border-gim-neutral-200 shadow-sm">
        <h2 class="text-xl font-bold text-gim-neutral-900 mb-6">Acciones R├ípidas</h2>
        <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
          <a href="/admin/agents" class="gradient-border rounded-xl p-4 flex items-center gap-4 card-hover">
            <div class="w-12 h-12 bg-gradient-orange rounded-xl flex items-center justify-center shadow-lg shadow-gim-orange-500/15">
              <svg class="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"/></svg>
            </div>
            <div>
              <div class="font-semibold text-gim-neutral-900">Nuevo Agente</div>
              <div class="text-sm text-gim-neutral-500">Crear agente IA</div>
            </div>
          </a>
          
          <a href="/admin/knowledge" class="gradient-border rounded-xl p-4 flex items-center gap-4 card-hover">
            <div class="w-12 h-12 bg-gradient-cyan rounded-xl flex items-center justify-center shadow-lg shadow-gim-cyan-500/15">
              <svg class="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"/></svg>
            </div>
            <div>
              <div class="font-semibold text-gim-neutral-900">Agregar Documento</div>
              <div class="text-sm text-gim-neutral-500">Base de conocimiento</div>
            </div>
          </a>
          
          <a href="/admin/campaigns" class="gradient-border rounded-xl p-4 flex items-center gap-4 card-hover">
            <div class="w-12 h-12 bg-gradient-purple rounded-xl flex items-center justify-center shadow-lg shadow-gim-purple-500/15">
              <svg class="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M11 5.882V19.118a1 1 0 01-1.707.707L4.414 15H2a1 1 0 01-1-1v-4a1 1 0 011-1h2.414l4.879-4.825A1 1 0 0111 5.882zM15 9a3 3 0 010 6"/></svg>
            </div>
            <div>
              <div class="font-semibold text-gim-neutral-900">Nueva Campa├▒a</div>
              <div class="text-sm text-gim-neutral-500">Enviar mensajes</div>
            </div>
          </a>
        </div>
      </div>
      
      <!-- System Status -->
      <div class="mt-6 grid grid-cols-1 md:grid-cols-3 gap-6">
        <div class="bg-white rounded-2xl p-6 border border-gim-neutral-200 shadow-sm">
          <div class="flex items-center gap-3 mb-4">
            <span class="w-3 h-3 bg-green-500 rounded-full pulse-dot"></span>
            <h3 class="font-semibold text-gim-neutral-900">Sistema</h3>
          </div>
          <div class="text-2xl font-extrabold text-green-500">Operativo</div>
          <div class="text-sm text-gim-neutral-500 mt-1">99.9% uptime</div>
        </div>
        
        <div class="bg-white rounded-2xl p-6 border border-gim-neutral-200 shadow-sm">
          <div class="flex items-center gap-3 mb-4">
            <span class="w-3 h-3 bg-gim-orange-500 rounded-full pulse-dot"></span>
            <h3 class="font-semibold text-gim-neutral-900">Modelo IA</h3>
          </div>
          <div class="text-2xl font-extrabold text-gradient-orange">Llama 3.1 8B</div>
          <div class="text-sm text-gim-neutral-500 mt-1">Cloudflare Workers AI</div>
        </div>
        
        <div class="bg-white rounded-2xl p-6 border border-gim-neutral-200 shadow-sm">
          <div class="flex items-center gap-3 mb-4">
            <span class="w-3 h-3 bg-gim-cyan-500 rounded-full pulse-dot"></span>
            <h3 class="font-semibold text-gim-neutral-900">Base de Datos</h3>
          </div>
          <div class="text-2xl font-extrabold text-gradient-cyan">D1</div>
          <div class="text-sm text-gim-neutral-500 mt-1">SQLite en edge</div>
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
              container.innerHTML = '<div class="text-gim-neutral-400 text-center py-8">No hay conversaciones recientes</div>';
              return;
            }
            container.innerHTML = data.map(c => 
              '<div class="flex items-center justify-between p-4 bg-gim-neutral-50 rounded-xl card-hover border border-gim-neutral-100">' +
                '<div class="flex items-center gap-4">' +
                  '<div class="w-10 h-10 bg-gradient-orange rounded-lg flex items-center justify-center">' +
                    '<span class="text-lg">' + (c.channel === 'telegram' ? 'TG' : c.channel === 'whatsapp' ? 'WA' : 'WEB') + '</span>' +
                  '</div>' +
                  '<div>' +
                    '<div class="font-semibold text-gim-neutral-900">' + (c.user_name || 'An├│nimo') + '</div>' +
                    '<div class="text-sm text-gim-neutral-500">' + c.channel + ' ┬À ' + (c.intent || 'sin clasificar') + '</div>' +
                  '</div>' +
                '</div>' +
                '<span class="px-3 py-1 rounded-full text-xs font-medium ' + 
                  (c.status === 'active' ? 'bg-green-100 text-green-600' : 
                   c.status === 'escalated' ? 'bg-gim-orange-100 text-gim-orange-600' : 'bg-gim-neutral-100 text-gim-neutral-600') + 
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
              container.innerHTML = '<div class="text-gim-neutral-400 text-center py-8">No hay tickets activos</div>';
              return;
            }
            container.innerHTML = data.map(t => 
              '<div class="p-4 bg-gim-neutral-50 rounded-xl card-hover border border-gim-neutral-100">' +
                '<div class="font-semibold text-gim-neutral-900 mb-2">' + t.title + '</div>' +
                '<div class="flex items-center justify-between">' +
                  '<span class="text-sm text-gim-neutral-500">' + t.category + '</span>' +
                  '<span class="px-3 py-1 rounded-full text-xs font-medium ' + 
                    (t.priority === 3 ? 'bg-red-100 text-red-600' : 
                     t.priority === 2 ? 'bg-gim-orange-100 text-gim-orange-600' : 'bg-gim-neutral-100 text-gim-neutral-600') + 
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
  `);
});

  

// Insights page
admin.get('/insights', async (c) => {
  let stats = { avgLatency: 0, totalConversations: 0, totalTickets: 0, resolvedTickets: 0, totalLeads: 0, convertedLeads: 0, totalMessages: 0, totalAgents: 0 };
  let dailyData: any[] = [];

  try {
    const aiStats = await c.env.DB.prepare(
      `SELECT AVG(latency_ms) as avg_latency, COUNT(*) as total FROM ai_logs WHERE created_at > datetime('now', '-7 days') AND tenant_id = ?`
    ).bind(tId(c)).first<{ avg_latency: number | null; total: number }>();
    stats.avgLatency = Math.round(aiStats?.avg_latency || 0);
  } catch (e) {}

  try {
    const convCount = await c.env.DB.prepare('SELECT COUNT(*) as c FROM conversations WHERE tenant_id = ?').bind(tId(c)).first<{ c: number }>();
    stats.totalConversations = convCount?.c || 0;
  } catch (e) {}

  try {
    const ticketStats = await c.env.DB.prepare(
      `SELECT COUNT(*) as total, SUM(CASE WHEN status='resolved' THEN 1 ELSE 0 END) as resolved FROM tickets WHERE tenant_id = ?`
    ).bind(tId(c)).first<{ total: number; resolved: number | null }>();
    stats.totalTickets = ticketStats?.total || 0;
    stats.resolvedTickets = ticketStats?.resolved || 0;
  } catch (e) {}

  try {
    const leadStats = await c.env.DB.prepare(
      `SELECT COUNT(*) as total, SUM(CASE WHEN status='converted' THEN 1 ELSE 0 END) as converted FROM leads WHERE tenant_id = ?`
    ).bind(tId(c)).first<{ total: number; converted: number | null }>();
    stats.totalLeads = leadStats?.total || 0;
    stats.convertedLeads = leadStats?.converted || 0;
  } catch (e) {}

  try {
    const msgCount = await c.env.DB.prepare('SELECT COUNT(*) as c FROM messages WHERE tenant_id = ?').bind(tId(c)).first<{ c: number }>();
    stats.totalMessages = msgCount?.c || 0;
  } catch (e) {}

  try {
    const agentCount = await c.env.DB.prepare('SELECT COUNT(*) as c FROM agents WHERE tenant_id = ?').bind(tId(c)).first<{ c: number }>();
    stats.totalAgents = agentCount?.c || 0;
  } catch (e) {}

  try {
    const daily = await c.env.DB.prepare(
      `SELECT date(created_at) as date, COUNT(*) as conversations 
       FROM conversations WHERE created_at > datetime('now', '-7 days') AND tenant_id = ?
       GROUP BY date(created_at) ORDER BY date DESC`
    ).bind(tId(c)).all();
    dailyData = daily.results || [];
  } catch (e) {}

  const resolutionRate = stats.totalTickets > 0 ? Math.round((stats.resolvedTickets / stats.totalTickets) * 100) : 0;
  const conversionRate = stats.totalLeads > 0 ? Math.round((stats.convertedLeads / stats.totalLeads) * 100) : 0;

  return renderPage(c, 'Insights', 'insights', `
    <div class="fade-in">
      <div class="mb-8">
        <h1 class="text-4xl font-extrabold mb-2">
          <span class="text-gradient-orange">Insights</span>
        </h1>
        <p class="text-gim-neutral-500">Analytics y m├®tricas de rendimiento</p>
      </div>
      
      <div class="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <div class="stat-card-green rounded-2xl p-6">
          <div class="text-gim-neutral-500 text-sm mb-2">Tasa de Resoluci├│n</div>
          <div class="text-4xl font-extrabold text-green-500">${resolutionRate}%</div>
          <div class="text-sm text-gim-neutral-400 mt-2">${stats.resolvedTickets}/${stats.totalTickets} tickets resueltos</div>
        </div>
        <div class="stat-card-orange rounded-2xl p-6">
          <div class="text-gim-neutral-500 text-sm mb-2">Latencia Promedio (7d)</div>
          <div class="text-4xl font-extrabold text-gradient-orange">${stats.avgLatency}ms</div>
          <div class="text-sm text-gim-neutral-400 mt-2">Tiempo de respuesta de IA</div>
        </div>
        <div class="stat-card-cyan rounded-2xl p-6">
          <div class="text-gim-neutral-500 text-sm mb-2">Conversi├│n de Leads</div>
          <div class="text-4xl font-extrabold text-gradient-cyan">${conversionRate}%</div>
          <div class="text-sm text-gim-neutral-400 mt-2">${stats.convertedLeads}/${stats.totalLeads} leads convertidos</div>
        </div>
      </div>

      <div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <div class="bg-white rounded-xl p-4 border border-gim-neutral-200 shadow-sm">
          <div class="text-gim-neutral-500 text-xs mb-1">Conversaciones</div>
          <div class="text-2xl font-bold text-gim-neutral-900">${stats.totalConversations}</div>
        </div>
        <div class="bg-white rounded-xl p-4 border border-gim-neutral-200 shadow-sm">
          <div class="text-gim-neutral-500 text-xs mb-1">Mensajes</div>
          <div class="text-2xl font-bold text-gim-neutral-900">${stats.totalMessages}</div>
        </div>
        <div class="bg-white rounded-xl p-4 border border-gim-neutral-200 shadow-sm">
          <div class="text-gim-neutral-500 text-xs mb-1">Tickets</div>
          <div class="text-2xl font-bold text-gim-neutral-900">${stats.totalTickets}</div>
        </div>
        <div class="bg-white rounded-xl p-4 border border-gim-neutral-200 shadow-sm">
          <div class="text-gim-neutral-500 text-xs mb-1">Agentes</div>
          <div class="text-2xl font-bold text-gim-neutral-900">${stats.totalAgents}</div>
        </div>
      </div>
      
      <div class="bg-white rounded-2xl p-8 border border-gim-neutral-200 shadow-sm">
        <h2 class="text-xl font-bold text-gim-neutral-900 mb-6">Conversaciones por d├¡a (ultimos 7 dias)</h2>
        <div class="space-y-3">
          ${dailyData.map((d: any) => {
            const maxVal = Math.max(...dailyData.map((x: any) => x.conversations), 1);
            const pct = Math.round((d.conversations / maxVal) * 100);
            return `
              <div class="flex items-center gap-4">
                <span class="text-sm font-medium text-gim-neutral-700 w-24">${d.date}</span>
                <div class="flex-1 bg-gim-neutral-100 rounded-full h-6 overflow-hidden">
                  <div class="bg-gradient-orange h-full rounded-full flex items-center justify-end px-2" style="width: ${pct}%">
                    <span class="text-xs font-semibold text-white">${d.conversations}</span>
                  </div>
                </div>
              </div>
            `;
          }).join('') || '<div class="text-gim-neutral-400 text-center py-8">Sin datos suficientes</div>'}
        </div>
      </div>
    </div>
  `);
});

  

// Costs page
admin.get('/costs', async (c) => {
  let usage: UsageRow[] = [];
  try {
    const result = await c.env.DB.prepare(
      `SELECT date(u.created_at) as date, 
       SUM(u.tokens_input) as input_tokens,
       SUM(u.tokens_output) as output_tokens,
       SUM(u.cost_usd) as cost
       FROM usage_logs u
       JOIN agents a ON u.agent_id = a.id
       WHERE u.created_at > datetime('now', '-30 days') AND a.tenant_id = ?
       GROUP BY date(u.created_at)
       ORDER BY date DESC`
    ).bind(tId(c)).all<UsageRow>();
    usage = result.results || [];
  } catch (e) { usage = []; }
  
  const totalCost = usage.reduce((sum: number, u: UsageRow) => sum + (u.cost || 0), 0);
  const totalTokens = usage.reduce((sum: number, u: UsageRow) => sum + (u.input_tokens || 0) + (u.output_tokens || 0), 0);
  
  return renderPage(c, 'Costos', 'costs', `
    <div class="fade-in">
      <div class="mb-8">
        <h1 class="text-4xl font-extrabold mb-2">
          <span class="text-gradient-orange">Costos</span>
        </h1>
        <p class="text-gim-neutral-500">Tracking de uso y costos de IA</p>
      </div>
      
      <div class="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <div class="stat-card-green rounded-2xl p-6">
          <div class="text-gim-neutral-500 text-sm mb-2">Costo Total (30 d├¡as)</div>
          <div class="text-4xl font-extrabold text-green-500">$${totalCost.toFixed(4)}</div>
        </div>
        <div class="stat-card-orange rounded-2xl p-6">
          <div class="text-gim-neutral-500 text-sm mb-2">Tokens Totales</div>
          <div class="text-4xl font-extrabold text-gradient-orange">${(totalTokens / 1000).toFixed(1)}K</div>
        </div>
        <div class="stat-card-cyan rounded-2xl p-6">
          <div class="text-gim-neutral-500 text-sm mb-2">Proyecci├│n Mensual</div>
          <div class="text-4xl font-extrabold text-gradient-cyan">$${((totalCost / 30) * 30).toFixed(2)}</div>
        </div>
      </div>
      
      <div class="bg-white rounded-2xl p-6 border border-gim-neutral-200 shadow-sm">
        <h2 class="text-xl font-bold text-gim-neutral-900 mb-6">Uso Diario</h2>
        <div class="space-y-3">
          ${usage.slice(0, 10).map((u: UsageRow) => `
            <div class="flex justify-between items-center py-4 px-4 bg-gim-neutral-50 rounded-xl border border-gim-neutral-100">
              <span class="font-semibold text-gim-neutral-900">${u.date}</span>
              <div class="flex gap-6 text-sm">
                <span class="text-gim-neutral-500">${((u.input_tokens || 0) / 1000).toFixed(1)}K in</span>
                <span class="text-gim-neutral-500">${((u.output_tokens || 0) / 1000).toFixed(1)}K out</span>
                <span class="text-green-500 font-semibold">$${(u.cost || 0).toFixed(4)}</span>
              </div>
            </div>
          `).join('') || '<div class="text-gim-neutral-400 text-center py-8">No hay datos de uso</div>'}
        </div>
      </div>
    </div>
  `);
});

  

// API Routes

admin.get('/api/stats', async (c) => {
  try {
    const [conversations, leads, messages, agents, tickets, usage] = await Promise.all([
      c.env.DB.prepare('SELECT COUNT(*) as count FROM conversations WHERE created_at > datetime("now", "-24 hours") AND tenant_id = ?').bind(tId(c)).first(),
      c.env.DB.prepare('SELECT COUNT(*) as count FROM leads WHERE created_at > datetime("now", "-24 hours") AND tenant_id = ?').bind(tId(c)).first(),
      c.env.DB.prepare('SELECT COUNT(*) as count FROM messages WHERE created_at > datetime("now", "-24 hours") AND tenant_id = ?').bind(tId(c)).first(),
      c.env.DB.prepare('SELECT COUNT(*) as count FROM agents WHERE is_active = 1 AND tenant_id = ?').bind(tId(c)).first(),
      c.env.DB.prepare('SELECT COUNT(*) as count FROM tickets WHERE status IN ("new", "in_progress") AND tenant_id = ?').bind(tId(c)).first(),
      c.env.DB.prepare('SELECT SUM(u.cost_usd) as cost FROM usage_logs u JOIN agents a ON u.agent_id = a.id WHERE u.created_at > datetime("now", "-24 hours") AND a.tenant_id = ?').bind(tId(c)).first(),
    ]);

    return c.json({
      conversations_24h: (conversations as any)?.count || 0,
      leads_24h: (leads as any)?.count || 0,
      messages_24h: (messages as any)?.count || 0,
      active_agents: (agents as any)?.count || 0,
      open_tickets: (tickets as any)?.count || 0,
      cost_24h: (usage as any)?.cost || 0,
    });
  } catch (e) {
    return c.json({ conversations_24h: 0, leads_24h: 0, messages_24h: 0, active_agents: 0, open_tickets: 0, cost_24h: 0 });
  }
});
}
