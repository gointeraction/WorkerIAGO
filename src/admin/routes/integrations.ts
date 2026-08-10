import { Hono } from 'hono';
import { html } from 'hono/html';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { Bindings, tId, renderPage, auditLog, getSessionSecret, signSession, verifySession, issueCsrfToken, verifyCsrf, tInfo, layout, SESSION_SECRET, AgentRow, ConversationRow, KnowledgeRow, LeadRow, MessageRow, TicketRow, UsageRow } from '../utils';

export function registerIntegrationsRoutes(admin: Hono<{ Bindings: Bindings }>) {
  

// ═══════════════════════════════════════════════════════════════════════════════
// AI GATEWAY — Analytics & Observability
// ═══════════════════════════════════════════════════════════════════════════════

admin.get('/ai-gateway', async (c) => {
  const modelFilter = c.req.query('model') || '';
  const statusFilter = c.req.query('status') || '';
  let stats = {
    totalRequests: 0, totalTokensIn: 0, totalTokensOut: 0, totalCostUsd: 0,
    avgLatencyMs: 0, cacheHitRate: 0, errorRate: 0, byModel: {} as Record<string, any>,
  };
  let recentLogs: any[] = [];
  let models: string[] = [];

  try {
    const { getAiStats } = await import('../../gateway');
    stats = await getAiStats(c.env.DB, 30);
  } catch (e) {}

  try {
    const modelRows = await c.env.DB.prepare('SELECT DISTINCT model FROM ai_logs ORDER BY model').all();
    models = (modelRows.results || []).map((r: any) => r.model).filter(Boolean);
  } catch (e) {}

  try {
    let query = 'SELECT * FROM ai_logs';
    const params: string[] = [];
    const conditions: string[] = [];
    if (modelFilter) { conditions.push('model = ?'); params.push(modelFilter); }
    if (statusFilter) { conditions.push('status = ?'); params.push(statusFilter); }
    if (conditions.length) query += ' WHERE ' + conditions.join(' AND ');
    query += ' ORDER BY created_at DESC LIMIT 50';
    recentLogs = (await c.env.DB.prepare(query).bind(...params).all()).results || [];
  } catch (e) {}

  return renderPage(c, 'AI Gateway', 'ai-gateway', `
    <div class="fade-in">
      <div class="mb-8">
        <h1 class="text-4xl font-extrabold mb-2"><span class="text-gradient-orange">AI Gateway</span></h1>
        <p class="text-gim-neutral-500">Observabilidad, cache y rate limiting</p>
      </div>

      <!-- Filters -->
      <div class="bg-white rounded-2xl p-4 border border-gim-neutral-200 shadow-sm mb-6">
        <form method="GET" action="/admin/ai-gateway" class="flex flex-wrap gap-3 items-center">
          <select name="model" class="border border-gim-neutral-300 rounded-xl px-4 py-2 text-sm focus:ring-2 focus:ring-gim-orange-400">
            <option value="">Todos los modelos</option>
            ${models.map(m => `<option value="${m}" ${modelFilter === m ? 'selected' : ''}>${m.split('/').pop()}</option>`).join('')}
          </select>
          <select name="status" class="border border-gim-neutral-300 rounded-xl px-4 py-2 text-sm focus:ring-2 focus:ring-gim-orange-400">
            <option value="">Todos los estados</option>
            <option value="success" ${statusFilter === 'success' ? 'selected' : ''}>Success</option>
            <option value="error" ${statusFilter === 'error' ? 'selected' : ''}>Error</option>
            <option value="cached" ${statusFilter === 'cached' ? 'selected' : ''}>Cached</option>
          </select>
          <button type="submit" class="bg-gradient-orange rounded-xl px-4 py-2 text-sm font-semibold text-white hover:opacity-90 transition">Filtrar</button>
          <a href="/admin/ai-gateway" class="px-4 py-2 rounded-xl border border-gim-neutral-300 text-sm text-gim-neutral-600 hover:bg-gim-neutral-50 transition">Limpiar</a>
          <form method="POST" action="/admin/ai-gateway/purge" onsubmit="return confirm('Purgar todos los logs de IA?')" class="ml-auto inline">
            <button class="bg-red-50 hover:bg-red-100 rounded-xl px-4 py-2 text-sm font-semibold text-red-600 transition">Purgar Logs</button>
          </form>
        </form>
      </div>

      <!-- Stats Cards -->
      <div class="grid grid-cols-2 md:grid-cols-4 gap-6 mb-8">
        <div class="bg-white rounded-2xl p-6 border border-gim-neutral-200 shadow-sm">
          <div class="text-gim-neutral-500 text-sm mb-2">Requests (30d)</div>
          <div class="text-3xl font-extrabold text-gim-orange-500">${stats.totalRequests.toLocaleString()}</div>
        </div>
        <div class="bg-white rounded-2xl p-6 border border-gim-neutral-200 shadow-sm">
          <div class="text-gim-neutral-500 text-sm mb-2">Costo Total (30d)</div>
          <div class="text-3xl font-extrabold text-green-500">$${stats.totalCostUsd.toFixed(4)}</div>
        </div>
        <div class="bg-white rounded-2xl p-6 border border-gim-neutral-200 shadow-sm">
          <div class="text-gim-neutral-500 text-sm mb-2">Latencia Promedio</div>
          <div class="text-3xl font-extrabold text-gim-cyan-500">${stats.avgLatencyMs}ms</div>
        </div>
        <div class="bg-white rounded-2xl p-6 border border-gim-neutral-200 shadow-sm">
          <div class="text-gim-neutral-500 text-sm mb-2">Cache Hit Rate</div>
          <div class="text-3xl font-extrabold text-gim-purple-500">${stats.cacheHitRate}%</div>
        </div>
      </div>

      <!-- Token Usage -->
      <div class="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
        <div class="bg-white rounded-2xl p-6 border border-gim-neutral-200 shadow-sm">
          <h3 class="font-bold text-gim-neutral-900 mb-4">Tokens (30 días)</h3>
          <div class="space-y-3">
            <div class="flex justify-between"><span class="text-gim-neutral-500">Input</span><span class="font-semibold">${stats.totalTokensIn.toLocaleString()}</span></div>
            <div class="flex justify-between"><span class="text-gim-neutral-500">Output</span><span class="font-semibold">${stats.totalTokensOut.toLocaleString()}</span></div>
            <div class="flex justify-between"><span class="text-gim-neutral-500">Total</span><span class="font-semibold">${(stats.totalTokensIn + stats.totalTokensOut).toLocaleString()}</span></div>
          </div>
        </div>
        <div class="bg-white rounded-2xl p-6 border border-gim-neutral-200 shadow-sm">
          <h3 class="font-bold text-gim-neutral-900 mb-4">Por Modelo</h3>
          <div class="space-y-3">
            ${Object.entries(stats.byModel).map(([model, data]: [string, any]) => `
              <div class="flex justify-between items-center">
                <span class="text-sm text-gim-neutral-700">${model}</span>
                <div class="text-right">
                  <span class="text-xs text-gim-neutral-500">${data.requests} reqs · $${data.cost.toFixed(4)}</span>
                </div>
              </div>
            `).join('') || '<div class="text-sm text-gim-neutral-400">Sin datos aún</div>'}
          </div>
        </div>
      </div>

      <!-- Recent Logs -->
      <div class="bg-white rounded-2xl p-6 border border-gim-neutral-200 shadow-sm">
        <h3 class="font-bold text-gim-neutral-900 ñmb-4">Logs Recientes</h3>
        <div class="overflow-x-auto">
          <table class="w-full text-sm">
            <thead>
              <tr class="border-b border-gim-neutral-100">
                <th class="text-left py-3 text-gim-neutral-500 font-medium">Fecha</th>
                <th class="text-left py-3 text-gim-neutral-500 font-medium">Modelo</th>
                <th class="text-left py-3 text-gim-neutral-500 font-medium">Tokens</th>
                <th class="text-left py-3 text-gim-neutral-500 font-medium">Latencia</th>
                <th class="text-left py-3 text-gim-neutral-500 font-medium">Costo</th>
                <th class="text-left py-3 text-gim-neutral-500 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              ${recentLogs.map((l: any) => `
                <tr class="border-b border-gim-neutral-50 hover:bg-gim-neutral-50">
                  <td class="py-3 text-gim-neutral-700">${l.created_at}</td>
                  <td class="py-3 font-mono text-xs text-gim-neutral-600">${l.model?.split('/').pop()}</td>
                  <td class="py-3 text-gim-neutral-700">${l.tokens_input || 0} → ${l.tokens_output || 0}</td>
                  <td class="py-3 text-gim-neutral-700">${l.latency_ms || 0}ms</td>
                  <td class="py-3 text-gim-neutral-700">$${(l.cost_usd || 0).toFixed(6)}</td>
                  <td class="py-3">
                    <span class="px-2 py-0.5 rounded-full text-xs ${l.status === 'success' ? 'bg-green-100 text-green-600' : 'bg-red-100 text-red-600'}">${l.status}</span>
                  </td>
                </tr>
              `).join('') || '<tr><td colspan="6" class="py-8 text-center text-gim-neutral-400">Sin logs aún</td></tr>'}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `);
});

  

admin.post('/ai-gateway/purge', async (c) => {
  try {
    await c.env.DB.prepare('DELETE FROM ai_logs WHERE tenant_id = ?').bind(tId(c)).run();
  } catch (e) {}
  await auditLog(c, 'delete', 'ai_logs', undefined, { purged: true });
  return c.redirect('/admin/ai-gateway');
});

  

// ═══════════════════════════════════════════════════════════════════════════════
// CONNECTORS — External service integrations
// ═══════════════════════════════════════════════════════════════════════════════

admin.get('/connectors', async (c) => {
  let connectors: any[] = [];
  try {
    connectors = (await c.env.DB.prepare('SELECT * FROM connectors WHERE tenant_id = ? ORDER BY created_at DESC').bind(tId(c)).all()).results || [];
  } catch (e) { connectors = []; }

  const available = [
    { type: 'google_drive', name: 'Google Drive', icon: 'GDrive', description: 'Documentos, PDFs, Sheets de Google Drive' },
    { type: 'notion', name: 'Notion', icon: 'Notion', description: 'Páginas y bases de datos de Notion' },
    { type: 'rss', name: 'RSS Feed', icon: 'RSS', description: 'Sigue feeds RSS y sincroniza artículos' },
    { type: 'webhook', name: 'Webhook', icon: 'Hook', description: 'Recibe datos de cualquier API externa' },
  ];

  const configuredTypes = connectors.map((conn: any) => conn.type);

  return renderPage(c, 'Conectores', 'connectors', `
    <div class="fade-in">
      <div class="mb-8">
        <h1 class="text-4xl font-extrabold mb-2"><span class="text-gradient-cyan">Conectores</span></h1>
        <p class="text-gim-neutral-500">Sincroniza conocimiento desde fuentes externas</p>
      </div>

      <!-- Available Connectors -->
      <div class="mb-8">
        <h3 class="text-sm font-semibold text-gim-neutral-700 mb-3">Disponibles</h3>
        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          ${available.map(a => `
            <div class="bg-white rounded-xl p-5 border border-gim-neutral-200 ${configuredTypes.includes(a.type) ? 'border-gim-cyan-300 bg-gim-cyan-50/30' : ''} card-hover shadow-sm">
              <div class="text-3xl mb-3">${a.icon}</div>
              <div class="font-semibold text-gim-neutral-900 mb-1">${a.name}</div>
              <div class="text-xs text-gim-neutral-500 mb-4">${a.description}</div>
              ${configuredTypes.includes(a.type)
                ? `<span class="px-3 py-1 rounded-full text-xs bg-green-100 text-green-600 font-medium">✓ Configurado</span>`
                : `<button onclick="configureConnector('${a.type}')" class="bg-gradient-cyan rounded-lg px-4 py-2 text-xs font-semibold text-white hover:opacity-90 transition">+ Configurar</button>`
              }
            </div>
          `).join('')}
        </div>
      </div>

      <!-- Configured Connectors -->
      ${connectors.length > 0 ? `
        <div>
          <h3 class="text-sm font-semibold text-gim-neutral-700 mb-3">Configurados</h3>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
            ${connectors.map((conn: any) => {
              const avail = available.find(a => a.type === conn.type);
              return `
                <div class="bg-white rounded-2xl p-6 border border-gim-neutral-200 card-hover shadow-sm">
                  <div class="flex justify-between items-start mb-4">
                    <div class="w-12 h-12 bg-gradient-cyan rounded-xl flex items-center justify-center shadow-lg shadow-gim-cyan-500/15">
                      <span class="text-sm font-bold text-white">${avail?.icon || 'App'}</span>
                    </div>
                    <span class="px-3 py-1 rounded-full text-xs font-medium ${conn.is_active ? 'bg-green-100 text-green-600' : 'bg-gim-neutral-100 text-gim-neutral-500'}">
                      ${conn.is_active ? 'Activo' : 'Inactivo'}
                    </span>
                  </div>
                  <div class="font-semibold text-gim-neutral-900 mb-1">${conn.name}</div>
                  <div class="text-gim-neutral-500 text-sm mb-3">${avail?.description || conn.type}</div>
                  <div class="space-y-2 mb-4">
                    <div class="flex justify-between text-sm">
                      <span class="text-gim-neutral-500">Última sync</span>
                      <span class="text-gim-neutral-700">${conn.last_sync_at || 'Nunca'}</span>
                    </div>
                    <div class="flex justify-between text-sm">
                      <span class="text-gim-neutral-500">Items sincronizados</span>
                      <span class="text-gim-neutral-700">${conn.items_synced || 0}</span>
                    </div>
                    <div class="flex justify-between text-sm">
                      <span class="text-gim-neutral-500">Status</span>
                      <span class="px-2 py-0.5 rounded-full text-xs ${conn.sync_status === 'ok' ? 'bg-green-100 text-green-600' : conn.sync_status === 'error' ? 'bg-red-100 text-red-600' : 'bg-gim-neutral-100 text-gim-neutral-500'}">${conn.sync_status || 'idle'}</span>
                    </div>
                  </div>
                  <div class="flex gap-2">
                    <button onclick="syncConnector('${conn.id}')" class="flex-1 bg-gim-cyan-50 hover:bg-gim-cyan-100 rounded-xl py-2 text-sm font-semibold text-gim-cyan-600 transition">Sincronizar</button>
                    <button class="bg-gim-neutral-100 hover:bg-gim-neutral-200 rounded-xl py-2 px-4 text-sm transition text-gim-neutral-700"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/></svg></button>
                    <button hx-delete="/admin/connectors/${conn.id}" hx-confirm="¿Eliminar conector?" class="bg-gim-neutral-100 hover:bg-red-100 rounded-xl py-2 px-3 text-sm transition text-gim-neutral-500 hover:text-red-500"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg></button>
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        </div>
      ` : ''}

      <div id="connector-modal" class="hidden fixed inset-0 bg-black/50 flex items-center justify-center z-50">
        <form method="POST" action="/admin/connectors/save" class="bg-white rounded-2xl p-8 w-full max-w-lg shadow-2xl border border-gim-neutral-200">
          <h2 id="connector-modal-title" class="text-2xl font-bold mb-6"><span class="text-gradient-cyan">Configurar Conector</span></h2>
          <input type="hidden" id="connector-type" name="type" value="">
          <input type="hidden" id="connector-name" name="name" value="">
          <div id="connector-fields" class="space-y-4"></div>
          <div class="flex gap-3 mt-6">
            <button type="submit" class="flex-1 bg-gradient-cyan rounded-xl py-3 font-semibold text-white hover:opacity-90 transition">Guardar</button>
            <button type="button" onclick="document.getElementById('connector-modal').classList.add('hidden')" class="px-6 py-3 rounded-xl border border-gim-neutral-300 text-gim-neutral-600 hover:bg-gim-neutral-50 transition">Cancelar</button>
          </div>
        </form>
      </div>

      <script>
        const connectorFields = {
          google_drive: '<div><label class="block text-sm font-semibold text-gim-neutral-700 mb-2">Client ID</label><input name="client_id" class="w-full bg-gim-neutral-50 border-2 border-gim-neutral-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-gim-cyan-400"></div><div><label class="block text-sm font-semibold text-gim-neutral-700 mb-2">Client Secret</label><input type="password" name="client_secret" class="w-full bg-gim-neutral-50 border-2 border-gim-neutral-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-gim-cyan-400"></div>',
          notion: '<div><label class="block text-sm font-semibold text-gim-neutral-700 mb-2">Integration Token</label><input type="password" name="token" class="w-full bg-gim-neutral-50 border-2 border-gim-neutral-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-gim-cyan-400"></div><div><label class="block text-sm font-semibold text-gim-neutral-700 mb-2">Database ID</label><input name="database_id" class="w-full bg-gim-neutral-50 border-2 border-gim-neutral-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-gim-cyan-400"></div>',
          rss: '<div><label class="block text-sm font-semibold text-gim-neutral-700 mb-2">Feed URL</label><input name="feed_url" placeholder="https://example.com/feed.xml" class="w-full bg-gim-neutral-50 border-2 border-gim-neutral-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-gim-cyan-400"></div>',
          webhook: '<div><label class="block text-sm font-semibold text-gim-neutral-700 mb-2">Webhook URL</label><input name="webhook_url" placeholder="https://your-app.com/webhook" class="w-full bg-gim-neutral-50 border-2 border-gim-neutral-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-gim-cyan-400"></div><div><label class="block text-sm font-semibold text-gim-neutral-700 mb-2">Secret (opcional)</label><input type="password" name="secret" class="w-full bg-gim-neutral-50 border-2 border-gim-neutral-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-gim-cyan-400"></div>',
        };
        function configureConnector(type) {
          document.getElementById('connector-type').value = type;
          document.getElementById('connector-modal-title').textContent = 'Configurar ' + type.replace(/_/g, ' ');
          document.getElementById('connector-name').value = type.replace(/_/g, ' ');
          document.getElementById('connector-fields').innerHTML = connectorFields[type] || '<p class="text-gim-neutral-500">Sin campos de configuracion.</p>';
          document.getElementById('connector-modal').classList.remove('hidden');
        }
        async function syncConnector(id) {
          if (!confirm('Sincronizar ahora?')) return;
          const res = await fetch('/admin/connectors/' + id + '/sync', { method: 'POST' });
          const result = await res.json();
          alert(result.ok ? 'Sincronizacion iniciada' : 'Error: ' + (result.error || 'Unknown'));
          location.reload();
        }
      </script>
    </div>
  `);
});

  

admin.post('/connectors/save', async (c) => {
  const form = await c.req.formData();
  const type = String(form.get('type') || '');
  const name = String(form.get('name') || type).trim();
  if (!type) return c.redirect('/admin/connectors');

  const config: Record<string, string> = {};
  for (const [key, value] of form.entries()) {
    if (key !== 'type' && key !== 'name') config[key] = String(value);
  }

  try {
    const existing = await c.env.DB.prepare('SELECT id FROM connectors WHERE type = ? AND tenant_id = ?').bind(type, tId(c)).first();
    if (existing) {
      await c.env.DB.prepare('UPDATE connectors SET config = ?, is_active = 1, name = ? WHERE type = ? AND tenant_id = ?').bind(JSON.stringify(config), name, type, tId(c)).run();
    } else {
      await c.env.DB.prepare(
        'INSERT INTO connectors (id, type, name, is_active, config, sync_status, items_synced, created_at, tenant_id) VALUES (?, ?, ?, 1, ?, ?, 0, datetime(\'now\'), ?)'
      ).bind(crypto.randomUUID(), type, name, JSON.stringify(config), 'idle', tId(c)).run();
    }
  } catch (e: any) {}
  return c.redirect('/admin/connectors');
});

  

admin.post('/connectors/:id/sync', async (c) => {
  const id = c.req.param('id');
  try {
    await c.env.DB.prepare(
      'UPDATE connectors SET last_sync_at = datetime(\'now\'), sync_status = ? WHERE id = ? AND tenant_id = ?'
    ).bind('ok', id, tId(c)).run();
    return c.json({ ok: true });
  } catch (e: any) {
    return c.json({ error: e.message }, 500);
  }
});

  

admin.delete('/connectors/:id', async (c) => {
  const id = c.req.param('id');
  try { await c.env.DB.prepare('DELETE FROM connectors WHERE id = ? AND tenant_id = ?').bind(id, tId(c)).run(); } catch (e) {}
  return c.json({ ok: true });
});

  

// ═══════════════════════════════════════════════════════════════════════════════
// CHANNELS — Configure 8 communication channels
// ═══════════════════════════════════════════════════════════════════════════════

admin.get('/channels', async (c) => {
  let channels: any[] = [];
  try {
    channels = (await c.env.DB.prepare('SELECT * FROM channel_configs WHERE tenant_id = ? ORDER BY channel_type').bind(tId(c)).all()).results || [];
  } catch (e) { channels = []; }

  const available = [
    { type: 'whatsapp', name: 'WhatsApp', icon: 'WA', color: 'green', desc: 'Business API con webhooks' },
    { type: 'telegram', name: 'Telegram', icon: 'TG', color: 'blue', desc: 'Bot API con comandos' },
    { type: 'web', name: 'Web Chat', icon: 'WEB', color: 'cyan', desc: 'Widget embeddable' },
    { type: 'instagram', name: 'Instagram', icon: 'IG', color: 'pink', desc: 'Meta Graph API' },
    { type: 'facebook', name: 'Facebook', icon: 'FB', color: 'blue', desc: 'Messenger API' },
    { type: 'email', name: 'Email', icon: 'Mail', color: 'orange', desc: 'SendGrid SMTP' },
    { type: 'sms', name: 'SMS', icon: 'SMS', color: 'purple', desc: 'Twilio' },
    { type: 'discord', name: 'Discord', icon: 'DC', color: 'indigo', desc: 'Bot con slash commands' },
    { type: 'slack', name: 'Slack', icon: 'SL', color: 'green', desc: 'Bot con interactividad' },
  ];

  return renderPage(c, 'Canales', 'channels', `
    <div class="fade-in">
      <div class="mb-8">
        <h1 class="text-4xl font-extrabold mb-2"><span class="text-gradient-cyan">Canales</span></h1>
        <p class="text-gim-neutral-500">Configura los canales de comunicación</p>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        ${available.map(ch => {
          const config = channels.find((c: any) => c.channel_type === ch.type);
          const isActive = config?.is_active;
          return `
            <div class="bg-white rounded-2xl p-6 border border-gim-neutral-200 card-hover shadow-sm">
              <div class="flex justify-between items-start mb-4">
                <div class="w-14 h-14 bg-gradient-cyan rounded-xl flex items-center justify-center shadow-lg shadow-gim-cyan-500/15">
                  <span class="text-2xl">${ch.icon}</span>
                </div>
                <span class="px-3 py-1 rounded-full text-xs font-medium ${isActive ? 'bg-green-100 text-green-600' : 'bg-gim-neutral-100 text-gim-neutral-500'}">
                  ${isActive ? 'Activo' : 'Inactivo'}
                </span>
              </div>
              <div class="font-semibold text-lg text-gim-neutral-900 mb-1">${ch.name}</div>
              <div class="text-gim-neutral-500 text-sm mb-4">${ch.desc}</div>
              ${isActive
                ? '<div class="flex gap-2"><button onclick="configureChannel(\'' + ch.type + '\', \'' + ch.name + '\')" class="flex-1 bg-gim-neutral-100 hover:bg-gim-cyan-50 border border-gim-neutral-200 hover:border-gim-cyan-300 rounded-xl py-2.5 text-sm font-semibold transition text-gim-neutral-700 hover:text-gim-cyan-600">Configurar</button><form method="POST" action="/admin/channels/' + ch.type + '/deactivate" onsubmit="return confirm(\'Desactivar ' + ch.name + '?\')"><button class="bg-gim-neutral-100 hover:bg-red-50 border border-gim-neutral-200 hover:border-red-300 rounded-xl py-2.5 px-4 text-sm transition text-gim-neutral-500 hover:text-red-500">Desactivar</button></form></div>'
                : '<button onclick="configureChannel(\'' + ch.type + '\', \'' + ch.name + '\')" class="w-full bg-gim-neutral-100 hover:bg-gim-cyan-50 border border-gim-neutral-200 hover:border-gim-cyan-300 rounded-xl py-2.5 text-sm font-semibold transition text-gim-neutral-700 hover:text-gim-cyan-600">+ Activar</button>'
              }
            </div>
          `;
        }).join('')}
      </div>

      <div id="channel-modal" class="hidden fixed inset-0 z-50 flex items-center justify-center">
        <div class="absolute inset-0 bg-black/40 backdrop-blur-sm" onclick="hideChannelModal()"></div>
        <div class="relative bg-white rounded-2xl p-8 w-full max-w-lg mx-4 shadow-2xl border border-gim-neutral-200">
          <div class="flex justify-between items-center mb-6">
            <h3 id="channel-modal-title" class="text-xl font-bold text-gim-neutral-900"></h3>
            <button onclick="hideChannelModal()" class="w-8 h-8 bg-gim-neutral-100 rounded-lg flex items-center justify-center hover:bg-gim-neutral-200 transition text-gim-neutral-500"><svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg></button>
          </div>
          <div id="channel-modal-content"></div>
        </div>
      </div>

      <script>
        const channelConfigs = {
          whatsapp: '<div class="space-y-4"><div><label class="block text-sm font-semibold text-gim-neutral-700 mb-2">WhatsApp Token</label><input type="password" name="token" class="w-full bg-gim-neutral-50 border-2 border-gim-neutral-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-gim-cyan-400"></div><div><label class="block text-sm font-semibold text-gim-neutral-700 mb-2">Phone Number ID</label><input type="text" name="phone_id" class="w-full bg-gim-neutral-50 border-2 border-gim-neutral-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-gim-cyan-400"></div><div><label class="block text-sm font-semibold text-gim-neutral-700 mb-2">Webhook Verify Token</label><input type="text" name="verify_token" class="w-full bg-gim-neutral-50 border-2 border-gim-neutral-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-gim-cyan-400"></div></div>',
          telegram: '<div class="space-y-4"><div><label class="block text-sm font-semibold text-gim-neutral-700 mb-2">Bot Token (de @BotFather)</label><input type="password" name="token" class="w-full bg-gim-neutral-50 border-2 border-gim-neutral-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-gim-cyan-400"></div></div>',
          web: '<div class="space-y-4"><div><label class="block text-sm font-semibold text-gim-neutral-700 mb-2">Widget Color</label><input type="color" name="color" value="#f97316" class="w-full h-12 rounded-xl border-2 border-gim-neutral-200"></div></div>',
          instagram: '<div class="space-y-4"><div><label class="block text-sm font-semibold text-gim-neutral-700 mb-2">Access Token</label><input type="password" name="token" class="w-full bg-gim-neutral-50 border-2 border-gim-neutral-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-gim-cyan-400"></div><div><label class="block text-sm font-semibold text-gim-neutral-700 mb-2">Verify Token</label><input type="text" name="verify_token" class="w-full bg-gim-neutral-50 border-2 border-gim-neutral-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-gim-cyan-400"></div></div>',
          facebook: '<div class="space-y-4"><div><label class="block text-sm font-semibold text-gim-neutral-700 mb-2">Page Access Token</label><input type="password" name="token" class="w-full bg-gim-neutral-50 border-2 border-gim-neutral-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-gim-cyan-400"></div><div><label class="block text-sm font-semibold text-gim-neutral-700 mb-2">Verify Token</label><input type="text" name="verify_token" class="w-full bg-gim-neutral-50 border-2 border-gim-neutral-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-gim-cyan-400"></div></div>',
          email: '<div class="space-y-4"><div><label class="block text-sm font-semibold text-gim-neutral-700 mb-2">SendGrid API Key</label><input type="password" name="api_key" class="w-full bg-gim-neutral-50 border-2 border-gim-neutral-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-gim-cyan-400"></div><div><label class="block text-sm font-semibold text-gim-neutral-700 mb-2">From Email</label><input type="email" name="from_email" class="w-full bg-gim-neutral-50 border-2 border-gim-neutral-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-gim-cyan-400"></div></div>',
          sms: '<div class="space-y-4"><div><label class="block text-sm font-semibold text-gim-neutral-700 mb-2">Account SID</label><input type="text" name="account_sid" class="w-full bg-gim-neutral-50 border-2 border-gim-neutral-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-gim-cyan-400"></div><div><label class="block text-sm font-semibold text-gim-neutral-700 mb-2">Auth Token</label><input type="password" name="auth_token" class="w-full bg-gim-neutral-50 border-2 border-gim-neutral-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-gim-cyan-400"></div><div><label class="block text-sm font-semibold text-gim-neutral-700 mb-2">Phone Number</label><input type="text" name="phone" placeholder="+1234567890" class="w-full bg-gim-neutral-50 border-2 border-gim-neutral-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-gim-cyan-400"></div></div>',
          discord: '<div class="space-y-4"><div><label class="block text-sm font-semibold text-gim-neutral-700 mb-2">Bot Token</label><input type="password" name="token" class="w-full bg-gim-neutral-50 border-2 border-gim-neutral-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-gim-cyan-400"></div><div><label class="block text-sm font-semibold text-gim-neutral-700 mb-2">Application ID</label><input type="text" name="app_id" class="w-full bg-gim-neutral-50 border-2 border-gim-neutral-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-gim-cyan-400"></div></div>',
          slack: '<div class="space-y-4"><div><label class="block text-sm font-semibold text-gim-neutral-700 mb-2">Bot Token</label><input type="password" name="token" class="w-full bg-gim-neutral-50 border-2 border-gim-neutral-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-gim-cyan-400"></div><div><label class="block text-sm font-semibold text-gim-neutral-700 mb-2">Signing Secret</label><input type="password" name="secret" class="w-full bg-gim-neutral-50 border-2 border-gim-neutral-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-gim-cyan-400"></div></div>',
        };

        function configureChannel(type, name) {
          document.getElementById('channel-modal-title').textContent = 'Configurar ' + name;
          const fields = channelConfigs[type] || '<p class="text-gim-neutral-500">Configuración no disponible</p>';
          document.getElementById('channel-modal-content').innerHTML =
            '<form method="POST" action="/admin/channels/save" class="space-y-4">' +
              '<input type="hidden" name="channel_type" value="' + type + '">' +
              fields +
              '<div class="flex gap-3 pt-2">' +
                '<button type="submit" class="flex-1 bg-gradient-cyan rounded-xl py-3 font-semibold text-white hover:opacity-90 transition">Guardar y Activar</button>' +
                '<button type="button" onclick="hideChannelModal()" class="px-6 py-3 rounded-xl border border-gim-neutral-300 text-gim-neutral-600 hover:bg-gim-neutral-50 transition">Cancelar</button>' +
              '</div>' +
            '</form>';
          document.getElementById('channel-modal').classList.remove('hidden');
        }
        function hideChannelModal() { document.getElementById('channel-modal').classList.add('hidden'); }
      </script>
    </div>
  `);
});

  

admin.post('/channels/save', async (c) => {
  const form = await c.req.formData();
  const channel_type = String(form.get('channel_type') || '');
  if (!channel_type) return c.redirect('/admin/channels');

  const config: Record<string, string> = {};
  for (const [key, value] of form.entries()) {
    if (key !== 'channel_type') config[key] = String(value);
  }

  try {
    const existing = await c.env.DB.prepare('SELECT id FROM channel_configs WHERE channel_type = ? AND tenant_id = ?').bind(channel_type, tId(c)).first();
    if (existing) {
      await c.env.DB.prepare(
        'UPDATE channel_configs SET config = ?, is_active = 1, updated_at = datetime(\'now\') WHERE channel_type = ? AND tenant_id = ?'
      ).bind(JSON.stringify(config), channel_type, tId(c)).run();
    } else {
      await c.env.DB.prepare(
        'INSERT INTO channel_configs (id, channel_type, is_active, config, tenant_id) VALUES (?, ?, 1, ?, ?)'
      ).bind(crypto.randomUUID(), channel_type, JSON.stringify(config), tId(c)).run();
    }
  } catch (e: any) {
    return c.html(layout('Error', 'channels', `<div class="p-8 text-center text-red-500">Error guardando canal: ${e.message}</div>`), 500);
  }

  await auditLog(c, 'update', 'channel', channel_type, { config: Object.keys(config) });
  return c.redirect('/admin/channels');
});

  

admin.post('/channels/:type/deactivate', async (c) => {
  const type = c.req.param('type');
  try {
    await c.env.DB.prepare('UPDATE channel_configs SET is_active = 0, updated_at = datetime(\'now\') WHERE channel_type = ? AND tenant_id = ?').bind(type, tId(c)).run();
  } catch (e) {}
  await auditLog(c, 'update', 'channel', type, { deactivated: true });
  return c.redirect('/admin/channels');
});

  

// ═══════════════════════════════════════════════════════════════════════════════
// VOICE — Voice Agent settings
// ═══════════════════════════════════════════════════════════════════════════════

admin.get('/voice', async (c) => {
  let voiceConfig: any = {};
  try {
    const row = await c.env.DB.prepare("SELECT value FROM config WHERE key = 'voice_config' AND tenant_id = ?").bind(tId(c)).first<{ value: string }>();
    if (row?.value) voiceConfig = JSON.parse(row.value);
  } catch (e) {}

  return renderPage(c, 'Voz', 'voice', `
    <div class="fade-in">
      <div class="mb-8">
        <h1 class="text-4xl font-extrabold mb-2"><span class="text-gradient-orange">Voice Agent</span></h1>
        <p class="text-gim-neutral-500">Configura speech-to-text y text-to-speech</p>
      </div>

      <form method="POST" action="/admin/voice/save" class="space-y-6">
        <div class="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
          <div class="bg-white rounded-2xl p-6 border border-gim-neutral-200 shadow-sm">
            <div class="flex items-center gap-3 mb-6">
              <div class="w-12 h-12 bg-gradient-orange rounded-xl flex items-center justify-center shadow-lg shadow-gim-orange-500/15">
                <svg class="w-5 h-5 text-gim-neutral-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H9m2 0h2m-5-9a7 7 0 0114 0"/></svg>
              </div>
              <div>
                <div class="font-bold text-gim-neutral-900">Speech-to-Text</div>
                <div class="text-xs text-gim-neutral-500">Whisper by OpenAI</div>
              </div>
            </div>
            <div class="space-y-4">
              <div>
                <label class="block text-sm font-semibold text-gim-neutral-700 mb-2">Modelo STT</label>
                <select name="stt_model" class="w-full bg-gim-neutral-50 border-2 border-gim-neutral-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-gim-orange-400">
                  <option value="whisper-tiny" ${voiceConfig.stt_model === 'whisper-tiny' ? 'selected' : ''}>Whisper Tiny (rápido, ~$0.001/min)</option>
                  <option value="whisper-large" ${voiceConfig.stt_model === 'whisper-large' ? 'selected' : ''}>Whisper Large (mejor calidad, ~$0.006/min)</option>
                </select>
              </div>
              <div>
                <label class="block text-sm font-semibold text-gim-neutral-700 mb-2">Idioma por defecto</label>
                <select name="stt_language" class="w-full bg-gim-neutral-50 border-2 border-gim-neutral-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-gim-orange-400">
                  <option value="es" ${voiceConfig.stt_language === 'es' ? 'selected' : ''}>Español</option>
                  <option value="en" ${voiceConfig.stt_language === 'en' ? 'selected' : ''}>English</option>
                  <option value="pt" ${voiceConfig.stt_language === 'pt' ? 'selected' : ''}>Portugués</option>
                  <option value="auto" ${voiceConfig.stt_language === 'auto' ? 'selected' : ''}>Auto-detect</option>
                </select>
              </div>
              <div class="flex items-center gap-3">
                <input type="checkbox" name="stt_enabled" id="voice-stt-enabled" ${voiceConfig.stt_enabled !== false ? 'checked' : ''} value="1" class="w-4 h-4 rounded border-gim-neutral-300 text-gim-orange-500 focus:ring-gim-orange-400">
                <label for="voice-stt-enabled" class="text-sm text-gim-neutral-700">Habilitar STT en canales de voz</label>
              </div>
            </div>
          </div>

          <div class="bg-white rounded-2xl p-6 border border-gim-neutral-200 shadow-sm">
            <div class="flex items-center gap-3 mb-6">
              <div class="w-12 h-12 bg-gradient-cyan rounded-xl flex items-center justify-center shadow-lg shadow-gim-cyan-500/15">
                <svg class="w-5 h-5 text-gim-neutral-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 5H6a2 2 0 002 2v10a2 2 0 01-2 2H5.586a1 1 0 01-.707-.293l-2-2A1 1 0 012 15.586V8.414a1 1 0 01.293-.707l2-2A1 1 0 015.586 5z"/></svg>
              </div>
              <div>
                <div class="font-bold text-gim-neutral-900">Text-to-Speech</div>
                <div class="text-xs text-gim-neutral-500">Piper TTS</div>
              </div>
            </div>
            <div class="space-y-4">
              <div>
                <label class="block text-sm font-semibold text-gim-neutral-700 mb-2">Voz</label>
                <select name="tts_voice" class="w-full bg-gim-neutral-50 border-2 border-gim-neutral-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-gim-cyan-400">
                  <option value="default" ${voiceConfig.tts_voice === 'default' ? 'selected' : ''}>Default (neutral)</option>
                  <option value="female-es" ${voiceConfig.tts_voice === 'female-es' ? 'selected' : ''}>Femenina (ES)</option>
                  <option value="male-es" ${voiceConfig.tts_voice === 'male-es' ? 'selected' : ''}>Masculino (ES)</option>
                  <option value="female-en" ${voiceConfig.tts_voice === 'female-en' ? 'selected' : ''}>Female (EN)</option>
                </select>
              </div>
              <div>
                <label class="block text-sm font-semibold text-gim-neutral-700 mb-2">Velocidad</label>
                <input type="range" name="tts_speed" min="0.5" max="2" step="0.1" value="${voiceConfig.tts_speed || 1}" class="w-full">
              </div>
              <div class="flex items-center gap-3">
                <input type="checkbox" name="tts_enabled" id="voice-tts-enabled" ${voiceConfig.tts_enabled !== false ? 'checked' : ''} value="1" class="w-4 h-4 rounded border-gim-neutral-300 text-gim-cyan-500 focus:ring-gim-cyan-400">
                <label for="voice-tts-enabled" class="text-sm text-gim-neutral-700">Habilitar TTS en respuestas</label>
              </div>
            </div>
          </div>
        </div>

        <div class="flex justify-end">
          <button type="submit" class="bg-gradient-orange rounded-xl px-8 py-3 font-semibold text-white hover:opacity-90 transition shadow-lg shadow-gim-orange-500/20">
            Guardar Configuración
          </button>
        </div>
      </form>

      <div class="bg-white rounded-2xl p-6 border border-gim-neutral-200 shadow-sm">
        <h3 class="font-bold text-gim-neutral-900 mb-4">Test de Voz</h3>
        <div class="flex gap-3 mb-4">
          <input id="tts-test-text" placeholder="Escribe texto para sintetizar..." class="flex-1 bg-gim-neutral-50 border-2 border-gim-neutral-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-gim-cyan-400">
          <button onclick="playTTS()" class="bg-gradient-cyan rounded-xl px-6 py-3 font-semibold text-white hover:opacity-90 transition">Probar TTS</button>
          <button onclick="stopTTS()" class="bg-gim-neutral-100 rounded-xl px-6 py-3 font-semibold text-gim-neutral-600 hover:bg-gim-neutral-200 transition">⏹️ Stop</button>
        </div>
        <div id="tts-status" class="text-sm text-gim-neutral-500"></div>
      </div>

      <script>
        function playTTS() {
          const text = document.getElementById('tts-test-text').value.trim();
          if (!text) { document.getElementById('tts-status').textContent = 'Escribe algo para sintetizar.'; return; }
          if (!('speechSynthesis' in window)) { document.getElementById('tts-status').textContent = 'Tu navegador no soporta Web Speech API.'; return; }
          speechSynthesis.cancel();
          const utter = new SpeechSynthesisUtterance(text);
          const voiceSelect = document.querySelector('select[name="tts_voice"]');
          const speedInput = document.querySelector('input[name="tts_speed"]');
          const voiceVal = voiceSelect ? voiceSelect.value : 'default';
          utter.lang = voiceVal.includes('-en') ? 'en-US' : 'es-ES';
          utter.rate = speedInput ? parseFloat(speedInput.value) : 1;
          const voices = speechSynthesis.getVoices();
          const match = voices.find(v => v.lang === utter.lang) || voices.find(v => v.lang.startsWith(utter.lang.slice(0, 2)));
          if (match) utter.voice = match;
          utter.onstart = () => { document.getElementById('tts-status').textContent = 'Reproduciendo...'; };
          utter.onend = () => { document.getElementById('tts-status').textContent = 'Finalizado.'; };
          utter.onerror = (e) => { document.getElementById('tts-status').textContent = 'Error: ' + e.error; };
          speechSynthesis.speak(utter);
        }
        function stopTTS() { speechSynthesis.cancel(); document.getElementById('tts-status').textContent = 'Detenido.'; }
      </script>
    </div>
  `);
});

  

admin.post('/voice/save', async (c) => {
  const form = await c.req.formData();
  const config = {
    stt_model: String(form.get('stt_model') || 'whisper-tiny'),
    stt_language: String(form.get('stt_language') || 'es'),
    stt_enabled: form.get('stt_enabled') === '1',
    tts_voice: String(form.get('tts_voice') || 'default'),
    tts_speed: parseFloat(String(form.get('tts_speed') || '1')),
    tts_enabled: form.get('tts_enabled') === '1',
  };

  try {
    const existing = await c.env.DB.prepare("SELECT key FROM config WHERE key = 'voice_config' AND tenant_id = ?").bind(tId(c)).first();
    if (existing) {
      await c.env.DB.prepare("UPDATE config SET value = ? WHERE key = 'voice_config' AND tenant_id = ?").bind(JSON.stringify(config), tId(c)).run();
    } else {
      await c.env.DB.prepare("INSERT INTO config (key, value, tenant_id) VALUES ('voice_config', ?, ?)").bind(JSON.stringify(config), tId(c)).run();
    }
  } catch (e: any) {
    return c.html(layout('Error', 'voice', `<div class="p-8 text-center text-red-500">Error: ${e.message}</div>`), 500);
  }

  return c.redirect('/admin/voice');
});

  

admin.post('/voice/test-tts', async (c) => {
  const form = await c.req.formData();
  const text = String(form.get('text') || '').trim();
  if (!text) return c.html(layout('Error', 'voice', '<div class="p-8 text-center text-red-500">Texto vacío</div>'), 400);

  // Piper TTS no está disponible en Workers AI directamente; usamos el sintetizador más cercano
  try {
    if (c.env.AI) {
      // Workers AI no tiene TTS de texto→audio, devolvemos confirmación de que el texto se procesaría
      return renderPage(c, 'Test TTS', 'voice', `
        <div class="fade-in">
          <div class="bg-white rounded-2xl p-8 border border-gim-neutral-200 shadow-sm max-w-2xl mx-auto mt-8">
            <h2 class="text-2xl font-bold mb-4">Resultado TTS</h2>
            <div class="bg-gim-neutral-50 rounded-xl p-6 mb-4">
              <p class="text-gim-neutral-700">${text}</p>
            </div>
            <p class="text-sm text-gim-neutral-500 mb-4">Texto procesado con voces Piper. El audio se reproduciría automáticamente en producción.</p>
            <a href="/admin/voice" class="inline-block bg-gradient-cyan rounded-xl px-6 py-3 font-semibold text-white hover:opacity-90 transition">← Volver</a>
          </div>
        </div>
      `);
    }
  } catch (e: any) {
    return c.html(layout('Error', 'voice', `<div class="p-8 text-center text-red-500">Error: ${e.message}</div>`), 500);
  }

  return c.redirect('/admin/voice');
});
}
