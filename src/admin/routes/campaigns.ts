import { Hono } from 'hono';
import { html } from 'hono/html';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { Bindings, tId, renderPage, auditLog, getSessionSecret, signSession, verifySession, issueCsrfToken, verifyCsrf, tInfo, layout, SESSION_SECRET, AgentRow, ConversationRow, KnowledgeRow, LeadRow, MessageRow, TicketRow, UsageRow } from '../utils';

export function registerCampaignsRoutes(admin: Hono<{ Bindings: Bindings }>) {
  

// Campaigns page
admin.get('/campaigns', async (c) => {
  let campaigns: any[] = [];
  try {
    campaigns = (await c.env.DB.prepare('SELECT * FROM campaigns WHERE tenant_id = ? ORDER BY created_at DESC').bind(tId(c)).all()).results || [];
  } catch (e) { campaigns = []; }

  return renderPage(c, 'Campañas', 'campaigns', `
    <div class="fade-in">
      <div class="flex justify-between items-center mb-8">
        <div>
          <h1 class="text-4xl font-extrabold mb-2">
            <span class="text-gradient-orange">Campañas</span>
          </h1>
          <p class="text-gim-neutral-500">${campaigns.length} campañas creadas</p>
        </div>
        <button onclick="document.getElementById('modal-campaign').classList.remove('hidden')" class="bg-gradient-orange rounded-xl px-6 py-3 font-semibold text-white hover:opacity-90 transition shadow-lg shadow-gim-orange-500/20">
          + Nueva Campaña
        </button>
      </div>

      <div id="modal-campaign" class="hidden fixed inset-0 bg-black/50 flex items-center justify-center z-50">
        <form method="POST" action="/admin/campaigns/save" class="bg-white rounded-2xl p-8 w-full max-w-lg shadow-2xl border border-gim-neutral-200">
          <h2 class="text-2xl font-bold mb-6"><span class="text-gradient-orange">Nueva Campaña</span></h2>
          <div class="space-y-4">
            <div>
              <label class="block text-sm font-medium text-gim-neutral-700 mb-1">Nombre</label>
              <input name="name" required class="w-full border border-gim-neutral-300 rounded-xl px-4 py-2.5 focus:ring-2 focus:ring-gim-orange-400 focus:border-gim-orange-400 outline-none" placeholder="Promo de Verano">
            </div>
            <div>
              <label class="block text-sm font-medium text-gim-neutral-700 mb-1">Canal</label>
              <select name="channel" class="w-full border border-gim-neutral-300 rounded-xl px-4 py-2.5 focus:ring-2 focus:ring-gim-orange-400 focus:border-gim-orange-400 outline-none">
                <option value="whatsapp">WhatsApp</option>
                <option value="telegram">Telegram</option>
                <option value="email">Email</option>
                <option value="sms">SMS</option>
              </select>
            </div>
            <div>
              <label class="block text-sm font-medium text-gim-neutral-700 mb-1">Mensaje</label>
              <textarea name="message" rows="4" required class="w-full border border-gim-neutral-300 rounded-xl px-4 py-2.5 focus:ring-2 focus:ring-gim-orange-400 focus:border-gim-orange-400 outline-none" placeholder="Hola {nombre}, tenemos una oferta especial para ti..."></textarea>
            </div>
            <div>
              <label class="block text-sm font-medium text-gim-neutral-700 mb-1">Segmento (opcional)</label>
              <input name="segment" class="w-full border border-gim-neutral-300 rounded-xl px-4 py-2.5 focus:ring-2 focus:ring-gim-orange-400 focus:border-gim-orange-400 outline-none" placeholder="all, new_leads, converted">
            </div>
          </div>
          <div class="flex gap-3 mt-6">
            <button type="submit" class="flex-1 bg-gradient-orange rounded-xl py-3 font-semibold text-white hover:opacity-90 transition">Crear Campaña</button>
            <button type="button" onclick="document.getElementById('modal-campaign').classList.add('hidden')" class="px-6 py-3 rounded-xl border border-gim-neutral-300 text-gim-neutral-600 hover:bg-gim-neutral-50 transition">Cancelar</button>
          </div>
        </form>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
        ${campaigns.map((cmp: any) => `
          <div class="bg-white rounded-2xl p-6 border border-gim-neutral-200 card-hover shadow-sm">
            <div class="flex justify-between items-start mb-4">
              <div class="w-12 h-12 bg-gradient-orange rounded-xl flex items-center justify-center shadow-lg shadow-gim-orange-500/15">
                <svg class="w-5 h-5 text-gim-neutral-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M11 5.882V19.118a1 1 0 01-1.707.707L4.414 15H2a1 1 0 01-1-1v-4a1 1 0 011-1h2.414l4.879-4.825A1 1 0 0111 5.882zM15 9a3 3 0 010 6"/></svg>
              </div>
              <span class="px-3 py-1 rounded-full text-xs font-medium ${cmp.status === 'active' ? 'bg-green-100 text-green-600' : cmp.status === 'draft' ? 'bg-gim-neutral-100 text-gim-neutral-500' : 'bg-blue-100 text-blue-600'}">
                ${cmp.status || 'draft'}
              </span>
            </div>
            <div class="font-semibold text-lg text-gim-neutral-900 mb-1">${cmp.name}</div>
            <div class="text-gim-neutral-500 text-sm mb-3">${(cmp.message || '').substring(0, 100)}${cmp.message?.length > 100 ? '...' : ''}</div>
            <div class="space-y-2 mb-4">
              <div class="flex justify-between text-sm">
                <span class="text-gim-neutral-500">Canal</span>
                <span class="text-gim-neutral-700">${cmp.channel || '—'}</span>
              </div>
              <div class="flex justify-between text-sm">
                <span class="text-gim-neutral-500">Enviados</span>
                <span class="text-gim-neutral-700">${cmp.sent_count || 0}</span>
              </div>
              <div class="flex justify-between text-sm">
                <span class="text-gim-neutral-500">Abiertos</span>
                <span class="text-gim-neutral-700">${cmp.opened_count || 0}</span>
              </div>
            </div>
            <div class="flex gap-2">
              ${cmp.status === 'draft' ? `<form method="POST" action="/admin/campaigns/${cmp.id}/start" class="inline"><button class="flex-1 bg-green-50 hover:bg-green-100 rounded-xl py-2 text-sm font-semibold text-green-600 transition">▶ Iniciar</button></form>` : ''}
              ${cmp.status === 'active' ? `<form method="POST" action="/admin/campaigns/${cmp.id}/stop" class="inline"><button class="flex-1 bg-red-50 hover:bg-red-100 rounded-xl py-2 text-sm font-semibold text-red-600 transition">⏹ Detener</button></form>` : ''}
              <form method="POST" action="/admin/campaigns/${cmp.id}/delete" onsubmit="return confirm('¿Eliminar campaña?')" class="inline">
                <button class="bg-gim-neutral-100 hover:bg-red-100 rounded-xl py-2 px-4 text-sm transition text-gim-neutral-500 hover:text-red-500"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg></button>
              </form>
            </div>
          </div>
        `).join('') || '<div class="col-span-2 bg-white rounded-2xl p-12 border border-gim-neutral-200 text-center shadow-sm"><div class="mb-4"><svg class="w-12 h-12 text-gim-neutral-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg></div><h2 class="text-xl font-bold text-gim-neutral-900 mb-2">Sin campañas</h2><p class="text-gim-neutral-500">Crea tu primera campaña masiva.</p></div>'}
      </div>
    </div>
  `);
});

  

admin.post('/campaigns/save', async (c) => {
  const form = await c.req.formData();
  const name = String(form.get('name') || '').trim();
  const channel = String(form.get('channel') || 'whatsapp');
  const message = String(form.get('message') || '').trim();
  const segment = String(form.get('segment') || 'all').trim();
  if (!name || !message) return c.redirect('/admin/campaigns');
  try {
    await c.env.DB.prepare(
      'INSERT INTO campaigns (id, name, channel, message, segment, status, sent_count, opened_count, tenant_id, created_at) VALUES (?, ?, ?, ?, ?, ?, 0, 0, ?, datetime(\'now\'))'
    ).bind(crypto.randomUUID(), name, channel, message, segment, 'draft', tId(c)).run();
  } catch (e: any) {}
  await auditLog(c, 'create', 'campaign', undefined, { name, channel });
  return c.redirect('/admin/campaigns');
});

  

admin.post('/campaigns/:id/start', async (c) => {
  const id = c.req.param('id');
  try { await c.env.DB.prepare('UPDATE campaigns SET status = ?, started_at = datetime(\'now\') WHERE id = ? AND tenant_id = ?').bind('active', id, tId(c)).run(); } catch (e) {}
  return c.redirect('/admin/campaigns');
});

  

admin.post('/campaigns/:id/stop', async (c) => {
  const id = c.req.param('id');
  try { await c.env.DB.prepare('UPDATE campaigns SET status = ? WHERE id = ? AND tenant_id = ?').bind('completed', id, tId(c)).run(); } catch (e) {}
  return c.redirect('/admin/campaigns');
});

  

admin.post('/campaigns/:id/delete', async (c) => {
  const id = c.req.param('id');
  try { await c.env.DB.prepare('DELETE FROM campaigns WHERE id = ? AND tenant_id = ?').bind(id, tId(c)).run(); } catch (e) {}
  return c.redirect('/admin/campaigns');
});
}
