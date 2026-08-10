import { Hono } from 'hono';
import { html } from 'hono/html';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { Bindings, tId, renderPage, auditLog, getSessionSecret, signSession, verifySession, issueCsrfToken, verifyCsrf, tInfo, layout, SESSION_SECRET, AgentRow, ConversationRow, KnowledgeRow, LeadRow, MessageRow, TicketRow, UsageRow } from '../utils';

export function registerConversationsRoutes(admin: Hono<{ Bindings: Bindings }>) {
  

// Conversations page
admin.get('/conversations', async (c) => {
  const page = parseInt(c.req.query('page') || '1');
  const limit = 20;
  const offset = (page - 1) * limit;
  
  let conversations: ConversationRow[] = [];
  let total = 0;
  try {
    const result = await c.env.DB.prepare(
      `SELECT c.*, a.name as agent_name,
       (SELECT COUNT(*) FROM messages WHERE conversation_id = c.id) as message_count
       FROM conversations c 
       LEFT JOIN agents a ON c.agent_id = a.id 
       WHERE c.tenant_id = ?
       ORDER BY c.updated_at DESC 
       LIMIT ? OFFSET ?`
    ).bind(tId(c), limit, offset).all<ConversationRow>();
    conversations = result.results || [];
    
    const totalResult = await c.env.DB.prepare(
      'SELECT COUNT(*) as count FROM conversations WHERE tenant_id = ?'
    ).bind(tId(c)).first<{ count: number }>();
    total = totalResult?.count || 0;
  } catch (e) { conversations = []; total = 0; }
  
  return renderPage(c, 'Conversaciones', 'conversations', `
    <div class="fade-in">
      <div class="flex justify-between items-center mb-8">
        <div>
          <h1 class="text-4xl font-extrabold mb-2">
            <span class="text-gradient-orange">Conversaciones</span>
          </h1>
          <p class="text-gim-neutral-500">${total || 0} conversaciones totales</p>
        </div>
        <div class="flex gap-3">
          <input type="text" 
                 placeholder="Buscar..." 
                 class="bg-white border-2 border-gim-neutral-200 rounded-xl px-4 py-2 text-sm focus:outline-none focus:border-gim-orange-400 transition-colors"
                 hx-get="/admin/conversations/search"
                 hx-trigger="keyup changed delay:300ms"
                 hx-target="#conversations-list"
                 name="q">
          <select class="bg-white border-2 border-gim-neutral-200 rounded-xl px-4 py-2 text-sm focus:outline-none focus:border-gim-orange-400 transition-colors">
            <option value="">Todos los canales</option>
            <option value="telegram">Telegram</option>
            <option value="whatsapp">WhatsApp</option>
            <option value="web">Web</option>
          </select>
        </div>
      </div>
      
      <div id="conversations-list" class="space-y-4">
        ${conversations.map((c: ConversationRow) => `
          <div class="bg-white rounded-2xl p-6 border border-gim-neutral-200 card-hover cursor-pointer shadow-sm"
               hx-get="/admin/conversations/${c.id}/thread"
               hx-target="#thread-panel"
               hx-swap="innerHTML">
            <div class="flex justify-between items-start">
              <div class="flex items-center gap-4">
                <div class="w-12 h-12 bg-gradient-orange rounded-xl flex items-center justify-center shadow-lg shadow-gim-orange-500/15">
                  <span class="text-sm font-bold text-white">${c.channel === 'telegram' ? 'TG' : c.channel === 'whatsapp' ? 'WA' : 'WEB'}</span>
                </div>
                <div>
                  <div class="font-semibold text-lg text-gim-neutral-900">${c.user_name || 'An├│nimo'}</div>
                  <div class="text-gim-neutral-500">${c.channel} ┬À ${c.intent || 'sin clasificar'}</div>
                  <div class="text-sm text-gim-neutral-400 mt-1">${c.message_count} mensajes ┬À ${new Date(c.updated_at).toLocaleString()}</div>
                </div>
              </div>
              <div class="flex items-center gap-3">
                <span class="px-4 py-2 rounded-full text-sm font-medium ${
                  c.status === 'active' ? 'bg-green-100 text-green-600' :
                  c.status === 'escalated' ? 'bg-gim-orange-100 text-gim-orange-600' :
                  'bg-gim-neutral-100 text-gim-neutral-600'
                }">${c.status}</span>
                ${(c.priority || 0) > 0 ? `<span class="px-4 py-2 rounded-full text-sm font-medium bg-red-100 text-red-600">P${c.priority}</span>` : ''}
              </div>
            </div>
          </div>
        `).join('') || '<div class="text-gim-neutral-400 text-center py-12">No hay conversaciones</div>'}
      </div>
      
      <!-- Pagination -->
      <div class="flex justify-center gap-2 mt-8">
        ${page > 1 ? `<a href="/admin/conversations?page=${page - 1}" class="px-4 py-2 bg-white border border-gim-neutral-200 rounded-xl hover:bg-gim-neutral-50 transition font-medium text-sm">ÔåÉ Anterior</a>` : ''}
        <span class="px-4 py-2 text-gim-neutral-500 text-sm">P├ígina ${page} de ${Math.ceil((total || 0) / limit)}</span>
        ${page < Math.ceil((total || 0) / limit) ? `<a href="/admin/conversations?page=${page + 1}" class="px-4 py-2 bg-white border border-gim-neutral-200 rounded-xl hover:bg-gim-neutral-50 transition font-medium text-sm">Siguiente ÔåÆ</a>` : ''}
      </div>
      
      <!-- Thread Panel -->
      <div id="thread-panel" class="fixed right-0 top-0 w-[450px] h-full bg-white border-l border-gim-neutral-200 hidden overflow-y-auto shadow-2xl">
      </div>
    </div>
  `);
});

  

// Conversation thread
admin.get('/conversations/:id/thread', async (c) => {
  const id = c.req.param('id');
  
  let conversation: any = null;
  let messages: MessageRow[] = [];
  try {
    conversation = await c.env.DB.prepare(
      'SELECT * FROM conversations WHERE id = ? AND tenant_id = ?'
    ).bind(id, tId(c)).first();
    
    if (!conversation) {
      return c.html('<div class="p-6 text-red-500">Conversaci├│n no encontrada</div>');
    }
    
    const result = await c.env.DB.prepare(
      'SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC'
    ).bind(id).all<MessageRow>();
    messages = result.results || [];
  } catch (e) {
    return c.html('<div class="p-6 text-red-500">Error al cargar conversaci├│n</div>');
  }
  
  return c.html(`
    <div class="p-6">
      <div class="flex justify-between items-center mb-6 pb-6 border-b border-gim-neutral-100">
        <div class="flex items-center gap-4">
          <div class="w-12 h-12 bg-gradient-orange rounded-xl flex items-center justify-center shadow-lg shadow-gim-orange-500/15">
            <span class="text-sm font-bold text-white">${conversation.channel === 'telegram' ? 'TG' : 'WA'}</span>
          </div>
          <div>
            <div class="font-semibold text-lg text-gim-neutral-900">${conversation.user_name || 'An├│nimo'}</div>
            <div class="text-sm text-gim-neutral-500">${conversation.channel} ┬À ${conversation.intent}</div>
          </div>
        </div>
        <button onclick="document.getElementById('thread-panel').classList.add('hidden')" 
                class="w-8 h-8 bg-gim-neutral-100 rounded-lg flex items-center justify-center hover:bg-gim-neutral-200 transition text-gim-neutral-500">
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>
        </button>
      </div>
      
      <!-- Actions -->
      <div class="grid grid-cols-3 gap-3 mb-6">
        <button class="bg-gradient-orange rounded-xl py-3 px-4 font-semibold text-white hover:opacity-90 transition shadow-lg shadow-gim-orange-500/20"
                hx-post="/admin/conversations/${id}/reply"
                hx-target="#reply-status"
                hx-vals='js:{"text": document.getElementById("reply-input").value}'>
          Responder
        </button>
        <button class="bg-gim-neutral-100 rounded-xl py-3 px-4 font-semibold hover:bg-gim-neutral-200 transition text-gim-neutral-700"
                hx-post="/admin/conversations/${id}/pause">
          ÔÅ©´©Å Pausar
        </button>
        <button class="bg-red-50 rounded-xl py-3 px-4 font-semibold hover:bg-red-100 transition border border-red-200 text-red-600"
                hx-post="/admin/conversations/${id}/escalate">
          Escalar
        </button>
      </div>
      
      <!-- Reply input -->
      <div class="mb-6">
        <textarea id="reply-input" 
                  class="w-full bg-gim-neutral-50 border-2 border-gim-neutral-200 rounded-xl p-4 text-sm focus:outline-none focus:border-gim-orange-400 resize-none transition-colors"
                  rows="3"
                  placeholder="Escribe tu respuesta..."></textarea>
        <div id="reply-status" class="text-sm mt-2"></div>
      </div>
      
      <!-- Messages -->
      <div class="space-y-4 max-h-96 overflow-y-auto">
        ${messages.map(m => `
          <div class="flex ${m.role === 'user' ? 'justify-start' : 'justify-end'}">
            <div class="max-w-[85%] rounded-2xl p-4 ${
              m.role === 'user' ? 'bg-gim-neutral-100 text-gim-neutral-900' :
              m.role === 'owner' ? 'bg-gradient-orange text-white' :
              'bg-gim-neutral-200 text-gim-neutral-900'
            }">
              <div class="text-xs ${m.role === 'owner' ? 'text-white/70' : 'text-gim-neutral-500'} mb-2">${m.role} ┬À ${new Date(m.created_at).toLocaleTimeString()}</div>
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
  
  let tickets: TicketRow[] = [];
  try {
    let query = `SELECT t.*, a.name as agent_name, c.user_name 
                 FROM tickets t 
                 LEFT JOIN agents a ON t.agent_id = a.id 
                 LEFT JOIN conversations c ON t.conversation_id = c.id
                 WHERE t.tenant_id = ?`;
    const params: string[] = [tId(c)];
    
    if (status !== 'all') {
      query += ` AND t.status = ?`;
      params.push(status);
    }
    
    query += ' ORDER BY t.priority DESC, t.created_at DESC';
    
    const result = await c.env.DB.prepare(query).bind(...params).all<TicketRow>();
    tickets = result.results || [];
  } catch (e) { tickets = []; }
  
  return renderPage(c, 'Tickets', 'tickets', `
    <div class="fade-in">
      <div class="flex justify-between items-center mb-8">
        <div>
          <h1 class="text-4xl font-extrabold mb-2">
            <span class="text-gradient-orange">Tickets</span>
          </h1>
          <p class="text-gim-neutral-500">Sistema de soporte con prioridades</p>
        </div>
        <div class="flex gap-2">
          <a href="/admin/tickets?status=all" class="px-4 py-2 rounded-xl text-sm font-medium ${status === 'all' ? 'bg-gradient-orange text-white shadow-lg shadow-gim-orange-500/20' : 'bg-white border border-gim-neutral-200 text-gim-neutral-700 hover:bg-gim-neutral-50'} transition">Todos</a>
          <a href="/admin/tickets?status=new" class="px-4 py-2 rounded-xl text-sm font-medium ${status === 'new' ? 'bg-gradient-orange text-white shadow-lg shadow-gim-orange-500/20' : 'bg-white border border-gim-neutral-200 text-gim-neutral-700 hover:bg-gim-neutral-50'} transition">Nuevos</a>
          <a href="/admin/tickets?status=in_progress" class="px-4 py-2 rounded-xl text-sm font-medium ${status === 'in_progress' ? 'bg-gradient-orange text-white shadow-lg shadow-gim-orange-500/20' : 'bg-white border border-gim-neutral-200 text-gim-neutral-700 hover:bg-gim-neutral-50'} transition">En Progreso</a>
          <a href="/admin/tickets?status=resolved" class="px-4 py-2 rounded-xl text-sm font-medium ${status === 'resolved' ? 'bg-gradient-orange text-white shadow-lg shadow-gim-orange-500/20' : 'bg-white border border-gim-neutral-200 text-gim-neutral-700 hover:bg-gim-neutral-50'} transition">Resueltos</a>
        </div>
      </div>
      
      <div class="space-y-4">
        ${tickets.map((t: TicketRow) => `
          <div class="bg-white rounded-2xl p-6 border border-gim-neutral-200 card-hover shadow-sm">
            <div class="flex justify-between items-start">
              <div class="flex-1">
                <div class="font-semibold text-lg text-gim-neutral-900 mb-2">${t.title}</div>
                <div class="text-gim-neutral-500 mb-4">${t.description || 'Sin descripci├│n'}</div>
                <div class="flex gap-3">
                  <span class="px-3 py-1 rounded-full text-xs bg-gim-neutral-100 text-gim-neutral-600">${t.category || 'general'}</span>
                  <span class="px-3 py-1 rounded-full text-xs bg-gim-neutral-100 text-gim-neutral-600">${t.agent_name || 'N/A'}</span>
                  <span class="text-xs text-gim-neutral-400">${new Date(t.created_at).toLocaleString()}</span>
                </div>
              </div>
              <div class="flex items-center gap-4">
                <span class="px-4 py-2 rounded-full text-sm font-medium ${
                  t.priority === 3 ? 'bg-red-100 text-red-600' :
                  t.priority === 2 ? 'bg-gim-orange-100 text-gim-orange-600' :
                  t.priority === 1 ? 'bg-yellow-100 text-yellow-600' :
                  'bg-gim-neutral-100 text-gim-neutral-600'
                }">${['Baja', 'Media', 'Alta', 'Urgente'][t.priority] || 'Baja'}</span>
                <select class="bg-white border-2 border-gim-neutral-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-gim-orange-400 transition-colors"
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
        `).join('') || '<div class="text-gim-neutral-400 text-center py-12">No hay tickets</div>'}
      </div>
    </div>
  `);
});

  

// Leads page
admin.get('/leads', async (c) => {
  const status = c.req.query('status') || 'all';
  
  let leads: LeadRow[] = [];
  try {
    let query = `SELECT l.*, a.name as agent_name 
                 FROM leads l 
                 LEFT JOIN agents a ON l.agent_id = a.id
                 WHERE l.tenant_id = ?`;
    const params: string[] = [tId(c)];
    
    if (status !== 'all') {
      query += ` AND l.status = ?`;
      params.push(status);
    }
    
    query += ' ORDER BY l.score DESC, l.created_at DESC';
    
    const result = await c.env.DB.prepare(query).bind(...params).all<LeadRow>();
    leads = result.results || [];
  } catch (e) { leads = []; }
  
  return renderPage(c, 'Leads', 'leads', `
    <div class="fade-in">
      <div class="flex justify-between items-center mb-8">
        <div>
          <h1 class="text-4xl font-extrabold mb-2">
            <span class="text-gradient-orange">Leads</span>
          </h1>
          <p class="text-gim-neutral-500">${leads.length} leads totales</p>
        </div>
        <div class="flex gap-2">
          <a href="/admin/leads?status=all" class="px-4 py-2 rounded-xl text-sm font-medium ${status === 'all' ? 'bg-gradient-orange text-white shadow-lg shadow-gim-orange-500/20' : 'bg-white border border-gim-neutral-200 text-gim-neutral-700 hover:bg-gim-neutral-50'} transition">Todos</a>
          <a href="/admin/leads?status=new" class="px-4 py-2 rounded-xl text-sm font-medium ${status === 'new' ? 'bg-gradient-orange text-white shadow-lg shadow-gim-orange-500/20' : 'bg-white border border-gim-neutral-200 text-gim-neutral-700 hover:bg-gim-neutral-50'} transition">Nuevos</a>
          <a href="/admin/leads?status=contacted" class="px-4 py-2 rounded-xl text-sm font-medium ${status === 'contacted' ? 'bg-gradient-orange text-white shadow-lg shadow-gim-orange-500/20' : 'bg-white border border-gim-neutral-200 text-gim-neutral-700 hover:bg-gim-neutral-50'} transition">Contactados</a>
          <a href="/admin/leads?status=converted" class="px-4 py-2 rounded-xl text-sm font-medium ${status === 'converted' ? 'bg-gradient-orange text-white shadow-lg shadow-gim-orange-500/20' : 'bg-white border border-gim-neutral-200 text-gim-neutral-700 hover:bg-gim-neutral-50'} transition">Convertidos</a>
          <a href="/admin/leads/export" class="bg-gradient-cyan rounded-xl px-4 py-2 text-sm font-semibold text-white hover:opacity-90 transition shadow-lg shadow-gim-cyan-500/20 ml-4">
            Exportar CSV
          </a>
        </div>
      </div>
      
      <div class="space-y-4">
        ${leads.map((l: LeadRow) => `
          <div class="bg-white rounded-2xl p-6 border border-gim-neutral-200 card-hover shadow-sm">
            <div class="flex justify-between items-start">
              <div class="flex items-center gap-4">
                <div class="w-12 h-12 bg-gradient-orange rounded-xl flex items-center justify-center shadow-lg shadow-gim-orange-500/15">
                  <svg class="w-5 h-5 text-gim-neutral-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"/></svg>
                </div>
                <div>
                  <div class="font-semibold text-lg text-gim-neutral-900">${l.name || 'An├│nimo'}</div>
                  <div class="text-gim-neutral-500">${l.interest || 'Sin inter├®s definido'}</div>
                  <div class="flex gap-2 mt-2">
                    ${l.phone ? `<span class="px-3 py-1 rounded-full text-xs bg-gim-neutral-100 text-gim-neutral-600"><svg class="w-3 h-3 inline" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z"/></svg> ${l.phone}</span>` : ''}
                    ${l.email ? `<span class="px-3 py-1 rounded-full text-xs bg-gim-neutral-100 text-gim-neutral-600"><svg class="w-3 h-3 inline" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"/></svg> ${l.email}</span>` : ''}
                    <span class="text-xs text-gim-neutral-400">${new Date(l.created_at).toLocaleString()}</span>
                  </div>
                </div>
              </div>
              <div class="flex items-center gap-6">
                <div class="text-right">
                  <div class="text-3xl font-extrabold text-gradient-orange">${l.score}</div>
                  <div class="text-xs text-gim-neutral-400">Score</div>
                </div>
                <select class="bg-white border-2 border-gim-neutral-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-gim-orange-400 transition-colors"
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
        `).join('') || '<div class="text-gim-neutral-400 text-center py-12">No hay leads</div>'}
      </div>
    </div>
  `);
});

  

admin.get('/leads/export', async (c) => {
  try {
    const { results } = await c.env.DB.prepare(
      'SELECT l.*, a.name as agent_name FROM leads l LEFT JOIN agents a ON l.agent_id = a.id WHERE l.tenant_id = ? ORDER BY l.score DESC'
    ).bind(tId(c)).all<LeadRow>();
    const rows = results || [];
    const header = 'ID,Nombre,Email,Phone,Status,Score,Agent,Source,Created At\n';
    const csv = header + rows.map((r: LeadRow) =>
      [r.id, r.name || '', r.email || '', r.phone || '', r.status, r.score, r.agent_name || '', r.source || '', r.created_at]
        .map((v: any) => `"${String(v).replace(/"/g, '""')}"`).join(',')
    ).join('\n');
    return new Response(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="leads.csv"',
      },
    });
  } catch (e) {
    return c.redirect('/admin/leads');
  }
});

  

admin.get('/api/conversations', async (c) => {
  try {
    const limit = parseInt(c.req.query('limit') || '50');
    const { results } = await c.env.DB.prepare(
      `SELECT c.*, a.name as agent_name,
       (SELECT COUNT(*) FROM messages WHERE conversation_id = c.id) as message_count
       FROM conversations c 
       LEFT JOIN agents a ON c.agent_id = a.id 
       WHERE c.tenant_id = ?
       ORDER BY c.updated_at DESC 
       LIMIT ?`
    ).bind(tId(c), limit).all();
    return c.json(results || []);
  } catch (e) { return c.json([]); }
});

  

admin.get('/api/tickets', async (c) => {
  try {
    const status = c.req.query('status');
    let query = 'SELECT * FROM tickets WHERE tenant_id = ?';
    const params: string[] = [tId(c)];
    if (status && status !== 'all') {
      query += ` AND status = ?`;
      params.push(status);
    }
    query += ' ORDER BY priority DESC, created_at DESC';
    const { results } = await c.env.DB.prepare(query).bind(...params).all();
    return c.json(results || []);
  } catch (e) { return c.json([]); }
});

  

admin.get('/api/leads', async (c) => {
  try {
    const limit = parseInt(c.req.query('limit') || '50');
    const { results } = await c.env.DB.prepare(
      'SELECT * FROM leads WHERE tenant_id = ? ORDER BY score DESC LIMIT ?'
    ).bind(tId(c), limit).all();
    return c.json(results || []);
  } catch (e) { return c.json([]); }
});

  

admin.post('/tickets/:id/status', async (c) => {
  const id = c.req.param('id');
  const form = await c.req.formData();
  const status = String(form.get('status') || 'new');
  
  await c.env.DB.prepare(
    'UPDATE tickets SET status = ?, updated_at = datetime("now") WHERE id = ? AND tenant_id = ?'
  ).bind(status, id, tId(c)).run();
  
  return c.json({ ok: true });
});

  

admin.post('/leads/:id/status', async (c) => {
  const id = c.req.param('id');
  const form = await c.req.formData();
  const status = String(form.get('status') || 'new');
  
  await c.env.DB.prepare(
    'UPDATE leads SET status = ?, updated_at = datetime("now") WHERE id = ? AND tenant_id = ?'
  ).bind(status, id, tId(c)).run();
  
  return c.json({ ok: true });
});

  

admin.post('/conversations/:id/reply', async (c) => {
  const id = c.req.param('id');
  const form = await c.req.formData();
  const text = String(form.get('text') || '').trim();
  
  if (!text) {
    return c.html('<span class="text-red-500">Escribe un mensaje</span>');
  }
  
  const conversation = await c.env.DB.prepare(
    'SELECT * FROM conversations WHERE id = ? AND tenant_id = ?'
  ).bind(id, tId(c)).first() as any;
  
  if (!conversation) {
    return c.html('<span class="text-red-500">Conversaci├│n no encontrada</span>');
  }
  
  await c.env.DB.prepare(
    'INSERT INTO messages (conversation_id, role, content) VALUES (?, "owner", ?)'
  ).bind(id, text).run();
  
  await c.env.DB.prepare(
    'UPDATE conversations SET updated_at = datetime("now") WHERE id = ? AND tenant_id = ?'
  ).bind(id, tId(c)).run();
  
  return c.html('<span class="text-green-500 font-medium">Ô£ô Mensaje enviado</span>');
});

  

admin.post('/conversations/:id/pause', async (c) => {
  const id = c.req.param('id');
  
  await c.env.DB.prepare(
    `UPDATE conversations SET status = 'paused', paused_until = datetime('now', '+1 hour') WHERE id = ? AND tenant_id = ?`
  ).bind(id, tId(c)).run();
  
  return c.json({ ok: true });
});

  

admin.post('/conversations/:id/escalate', async (c) => {
  const id = c.req.param('id');
  
  await c.env.DB.prepare(
    `UPDATE conversations SET status = 'escalated', priority = 2 WHERE id = ? AND tenant_id = ?`
  ).bind(id, tId(c)).run();
  
  const conversation = await c.env.DB.prepare(
    'SELECT * FROM conversations WHERE id = ? AND tenant_id = ?'
  ).bind(id, tId(c)).first() as any;
  
  if (conversation) {
    await c.env.DB.prepare(
      `INSERT INTO tickets (conversation_id, agent_id, title, description, priority, category, tenant_id)
       VALUES (?, ?, ?, ?, 2, 'escalation', ?)`
    ).bind(id, conversation.agent_id, `Escalaci├│n de ${conversation.user_name || 'An├│nimo'}`, 
           'Conversaci├│n escalada por el sistema', tId(c)).run();
  }
  
  return c.json({ ok: true });
});
}
