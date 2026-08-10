import { Hono } from 'hono';
import { html } from 'hono/html';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { Bindings, tId, renderPage, auditLog, getSessionSecret, signSession, verifySession, issueCsrfToken, verifyCsrf, tInfo, layout, SESSION_SECRET, AgentRow, ConversationRow, KnowledgeRow, LeadRow, MessageRow, TicketRow, UsageRow } from '../utils';

export function registerSystemRoutes(admin: Hono<{ Bindings: Bindings }>) {
  

// Auth middleware - cookie-based session (HMAC-signed) + Bearer fallback
const auth = async (c: any, next: any) => {
  const path = new URL(c.req.url).pathname;

  // Skip auth for login page and login API
  if (path === '/admin/login' || path === '/admin/api/login') {
    return next();
  }

  const password = c.env.ADMIN_PASSWORD;
  if (!password) {
    // No password set = demo mode. Still issue CSRF token for forms.
    issueCsrfToken(c);
    return next();
  }

  const session = getCookie(c, 'admin_session');
  const secret = getSessionSecret(c.env);
  if (verifySession(session, secret)) {
    // Refresh CSRF token if missing
    issueCsrfToken(c);
    return next();
  }

  // Also check Bearer token for API clients
  const authHeader = c.req.header('Authorization');
  if (authHeader && authHeader === 'Bearer ' + password) {
    issueCsrfToken(c);
    return next();
  }

  return c.redirect('/admin/login');
};

  

// CSRF middleware ÔÇö verify on POSTs
const csrfCheck = async (c: any, next: any) => {
  if (c.req.method !== 'POST') return next();
  // No CSRF requirement in demo mode (ADMIN_PASSWORD not set) ÔÇö skip entirely to avoid consuming formData
  if (!c.env.ADMIN_PASSWORD) return next();
  const cookieToken = getCookie(c, 'admin_csrf');
  // JSON APIs check header; form check formData field
  const headerToken = c.req.header('X-CSRF-Token');
  let formToken: string | null = null;
  const ct = c.req.header('content-type') || '';
  if (ct.includes('multipart/form-data') || ct.includes('application/x-www-form-urlencoded')) {
    try {
      const form = await c.req.formData();
      formToken = String(form.get('_csrf') || '');
      c.var._parsedForm = form;
    } catch (e) {}
  }
  const token = headerToken || formToken;
  if (cookieToken && token && cookieToken === token) {
    return next();
  }
  return c.json({ error: 'CSRF token inv├ílido o faltante' }, 403);
};

  

// Apply auth to all routes
admin.use('*', auth);

  
admin.use('*', csrfCheck);

  

// Config page
admin.get('/config', async (c) => {
  let settings: any[] = [];
  try {
    const result = await c.env.DB.prepare(
      'SELECT * FROM config WHERE tenant_id = ? ORDER BY category, key'
    ).bind(tId(c)).all();
    settings = result.results || [];
  } catch (e) { settings = []; }
  
  return renderPage(c, 'Configuraci├│n', 'config', `
    <div class="fade-in">
      <div class="mb-8">
        <h1 class="text-4xl font-extrabold mb-2">
          <span class="text-gradient-orange">Configuraci├│n</span>
        </h1>
        <p class="text-gim-neutral-500">Ajustes generales del bot</p>
      </div>
      
      <div class="bg-white rounded-2xl p-8 border border-gim-neutral-200 shadow-sm">
        <h2 class="text-xl font-bold text-gim-neutral-900 mb-6">Configuraci├│n General</h2>
        
        <form hx-post="/admin/config/save" hx-swap="none">
          <div class="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
            <div>
              <label class="block text-sm font-semibold text-gim-neutral-700 mb-2">Nombre del Bot</label>
              <input type="text" name="bot_name" value="${settings.find((s: any) => s.key === 'bot_name')?.value || 'WorkerIAGO'}"
                     class="w-full bg-gim-neutral-50 border-2 border-gim-neutral-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-gim-orange-400 transition-colors">
            </div>
            <div>
              <label class="block text-sm font-semibold text-gim-neutral-700 mb-2">Idioma</label>
              <select name="language" class="w-full bg-gim-neutral-50 border-2 border-gim-neutral-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-gim-orange-400 transition-colors">
                <option value="es" selected>Espa├▒ol</option>
                <option value="en">English</option>
                <option value="pt">Portugu├¬s</option>
              </select>
            </div>
            <div>
              <label class="block text-sm font-semibold text-gim-neutral-700 mb-2">Modelo por Defecto</label>
              <select name="default_model" class="w-full bg-gim-neutral-50 border-2 border-gim-neutral-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-gim-orange-400 transition-colors">
                <option value="@cf/meta/llama-3.1-8b-instruct-fp8" selected>Llama 3.1 8B</option>
                <option value="@cf/meta/llama-3.2-3b-instruct">Llama 3.2 3B (R├ípido)</option>
                <option value="@cf/meta/llama-3.3-70b-instruct-fp8-fast">Llama 3.3 70B (Mejor)</option>
              </select>
            </div>
            <div>
              <label class="block text-sm font-semibold text-gim-neutral-700 mb-2">Temperatura</label>
              <input type="number" name="temperature" step="0.1" min="0" max="1"
                     value="${settings.find((s: any) => s.key === 'temperature')?.value || '0.7'}"
                     class="w-full bg-gim-neutral-50 border-2 border-gim-neutral-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-gim-orange-400 transition-colors">
            </div>
          </div>
          
          <div class="mb-6">
            <label class="block text-sm font-semibold text-gim-neutral-700 mb-2">System Prompt por Defecto</label>
            <textarea name="system_prompt" rows="4"
                      class="w-full bg-gim-neutral-50 border-2 border-gim-neutral-200 rounded-xl px-4 py-3 text-sm font-mono focus:outline-none focus:border-gim-orange-400 transition-colors">${settings.find((s: any) => s.key === 'system_prompt')?.value || 'Eres un asistente ├║til y amigable.'}</textarea>
          </div>
          
          <button type="submit" class="bg-gradient-orange rounded-xl px-6 py-3 font-semibold text-white hover:opacity-90 transition shadow-lg shadow-gim-orange-500/20">
            Guardar Configuraci├│n
          </button>
        </form>
      </div>
    </div>
  `);
});

  

admin.post('/config/save', async (c) => {
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
      `INSERT OR REPLACE INTO config (key, value, tenant_id, updated_at) VALUES (?, ?, ?, datetime('now'))`
    ).bind(update.key, update.value, tId(c)).run();
  }
  
  await auditLog(c, 'update', 'config', undefined, { keys: updates.map(u => u.key) });
  return c.redirect('/admin/config?saved=1');
});

  

// ÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉ
// A/B TESTING
// ÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉ

admin.get('/ab-testing', async (c) => {
  let tests: any[] = [];
  try {
    tests = (await c.env.DB.prepare('SELECT * FROM ab_tests WHERE tenant_id = ? ORDER BY created_at DESC').bind(tId(c)).all()).results || [];
  } catch (e) { tests = []; }

  return renderPage(c, 'A/B Testing', 'ab-testing', `
    <div class="fade-in">
      <div class="flex justify-between items-center mb-8">
        <div>
          <h1 class="text-4xl font-extrabold mb-2"><span class="text-gradient-purple">A/B Testing</span></h1>
          <p class="text-gim-neutral-500">${tests.length} tests configurados</p>
        </div>
        <button onclick="document.getElementById('modal-abtest').classList.remove('hidden')" class="bg-gradient-purple rounded-xl px-6 py-3 font-semibold text-white hover:opacity-90 transition shadow-lg shadow-gim-purple-500/20">
          + Nuevo Test
        </button>
      </div>

      <!-- Modal Nuevo A/B Test -->
      <div id="modal-abtest" class="hidden fixed inset-0 bg-black/50 flex items-center justify-center z-50">
        <form method="POST" action="/admin/ab-testing/save" class="bg-white rounded-2xl p-8 w-full max-w-lg shadow-2xl border border-gim-neutral-200">
          <h2 class="text-2xl font-bold mb-6"><span class="text-gradient-purple">Nuevo A/B Test</span></h2>
          <div class="space-y-4">
            <div>
              <label class="block text-sm font-medium text-gim-neutral-700 mb-1">Nombre</label>
              <input name="name" required class="w-full border border-gim-neutral-300 rounded-xl px-4 py-2.5 focus:ring-2 focus:ring-gim-purple-400 outline-none" placeholder="Test de bienvenida">
            </div>
            <div>
              <label class="block text-sm font-medium text-gim-neutral-700 mb-1">Descripci├│n</label>
              <textarea name="description" rows="2" class="w-full border border-gim-neutral-300 rounded-xl px-4 py-2.5 focus:ring-2 focus:ring-gim-purple-400 outline-none" placeholder="Comparar respuesta formal vs informal"></textarea>
            </div>
            <div class="grid grid-cols-2 gap-3">
              <div>
                <label class="block text-sm font-medium text-gim-neutral-700 mb-1">Variante A (prompt)</label>
                <input name="variant_a" required class="w-full border border-gim-neutral-300 rounded-xl px-4 py-2.5 focus:ring-2 focus:ring-gim-purple-400 outline-none" placeholder="Eres un asistente formal">
              </div>
              <div>
                <label class="block text-sm font-medium text-gim-neutral-700 mb-1">Variante B (prompt)</label>
                <input name="variant_b" required class="w-full border border-gim-neutral-300 rounded-xl px-4 py-2.5 focus:ring-2 focus:ring-gim-purple-400 outline-none" placeholder="Eres un asistente amigable">
              </div>
            </div>
            <div>
              <label class="block text-sm font-medium text-gim-neutral-700 mb-1">Split (% a variante B)</label>
              <input name="split" type="number" min="1" max="99" value="50" class="w-full border border-gim-neutral-300 rounded-xl px-4 py-2.5 focus:ring-2 focus:ring-gim-purple-400 outline-none">
            </div>
          </div>
          <div class="flex gap-3 mt-6">
            <button type="submit" class="flex-1 bg-gradient-purple rounded-xl py-3 font-semibold text-white hover:opacity-90 transition">Crear Test</button>
            <button type="button" onclick="document.getElementById('modal-abtest').classList.add('hidden')" class="px-6 py-3 rounded-xl border border-gim-neutral-300 text-gim-neutral-600 hover:bg-gim-neutral-50 transition">Cancelar</button>
          </div>
        </form>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
        ${tests.map((t: any) => {
          const variants = JSON.parse(t.variants || '[]');
          return `
            <div class="bg-white rounded-2xl p-6 border border-gim-neutral-200 card-hover shadow-sm">
              <div class="flex justify-between items-start mb-4">
                <div class="font-semibold text-lg text-gim-neutral-900">${t.name}</div>
                <span class="px-3 py-1 rounded-full text-xs font-medium ${t.status === 'running' ? 'bg-green-100 text-green-600' : t.status === 'completed' ? 'bg-blue-100 text-blue-600' : 'bg-gim-neutral-100 text-gim-neutral-500'}">
                  ${t.status}
                </span>
              </div>
              <div class="text-gim-neutral-500 text-sm mb-4">${t.description || 'Sin descripci├│n'}</div>
              <div class="space-y-2 mb-4">
                ${variants.map((v: any) => `
                  <div class="flex justify-between text-sm bg-gim-neutral-50 rounded-lg px-3 py-2">
                    <span class="text-gim-neutral-700">${v.name}</span>
                    <span class="text-gim-neutral-500">${v.impressions || 0} imp ┬À ${v.conversions || 0} conv</span>
                  </div>
                `).join('')}
              </div>
              <div class="flex gap-2">
                ${t.status === 'draft' ? `<form method="POST" action="/admin/ab-testing/${t.id}/start" class="flex-1"><button class="w-full bg-green-100 hover:bg-green-200 rounded-xl py-2 text-sm font-medium transition text-green-600">ÔûÂ´©Å Iniciar</button></form>` : ''}
                ${t.status === 'running' ? `<form method="POST" action="/admin/ab-testing/${t.id}/stop" class="flex-1"><button class="w-full bg-yellow-100 hover:bg-yellow-200 rounded-xl py-2 text-sm font-medium transition text-yellow-600">ÔÅ╣´©Å Parar</button></form>` : ''}
                <form method="POST" action="/admin/ab-testing/${t.id}/delete" onsubmit="return confirm('┬┐Eliminar este test?')">
                  <button class="bg-gim-neutral-100 hover:bg-red-100 rounded-xl py-2 px-4 text-sm transition text-gim-neutral-500 hover:text-red-500"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg></button>
                </form>
              </div>
            </div>
          `;
        }).join('') || '<div class="col-span-2 text-gim-neutral-400 text-center py-12">No hay tests. Crea tu primer A/B test para optimizar respuestas.</div>'}
      </div>
    </div>
  `);
});

  

admin.post('/ab-testing/save', async (c) => {
  const form = await c.req.formData();
  const name = String(form.get('name') || '').trim();
  const description = String(form.get('description') || '').trim();
  const variant_a = String(form.get('variant_a') || '').trim();
  const variant_b = String(form.get('variant_b') || '').trim();
  const split = parseInt(String(form.get('split') || '50'));

  if (!name || !variant_a || !variant_b) {
    return c.html(layout('Error', 'ab-testing', `<div class="p-8 text-center text-red-500">Faltan campos obligatorios.</div>`), 400);
  }

  const variants = [
    { id: 'a', name: 'Variante A', prompt: variant_a, impressions: 0, conversions: 0 },
    { id: 'b', name: 'Variante B', prompt: variant_b, impressions: 0, conversions: 0 },
  ];
  const traffic_split = { a: 100 - split, b: split };

  try {
    await c.env.DB.prepare(
      'INSERT INTO ab_tests (id, name, description, variants, traffic_split, status, primary_metric, tenant_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).bind(
      crypto.randomUUID(), name, description,
      JSON.stringify(variants), JSON.stringify(traffic_split),
      'draft', 'conversion', tId(c)
    ).run();
  } catch (e: any) {
    return c.html(layout('Error', 'ab-testing', `<div class="p-8 text-center text-red-500">Error: ${e.message}</div>`), 500);
  }

  return c.redirect('/admin/ab-testing');
});

  

admin.post('/ab-testing/:id/start', async (c) => {
  const id = c.req.param('id');
  try {
    await c.env.DB.prepare("UPDATE ab_tests SET status = 'running', start_date = datetime('now') WHERE id = ? AND tenant_id = ?").bind(id, tId(c)).run();
  } catch (e) {}
  return c.redirect('/admin/ab-testing');
});

  

admin.post('/ab-testing/:id/stop', async (c) => {
  const id = c.req.param('id');
  try {
    await c.env.DB.prepare("UPDATE ab_tests SET status = 'completed', end_date = datetime('now') WHERE id = ? AND tenant_id = ?").bind(id, tId(c)).run();
  } catch (e) {}
  return c.redirect('/admin/ab-testing');
});

  

admin.post('/ab-testing/:id/delete', async (c) => {
  const id = c.req.param('id');
  try {
    await c.env.DB.prepare('DELETE FROM ab_events WHERE test_id = ? AND tenant_id = ?').bind(id, tId(c)).run();
    await c.env.DB.prepare('DELETE FROM ab_tests WHERE id = ? AND tenant_id = ?').bind(id, tId(c)).run();
  } catch (e) {}
  return c.redirect('/admin/ab-testing');
});

  

// ÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉ
// MONITORING ÔÇö Health checks + alertas
// ÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉ

admin.get('/monitoring', async (c) => {
  let alerts: any[] = [];
  let healthLogs: any[] = [];
  try {
    alerts = (await c.env.DB.prepare('SELECT * FROM monitoring_alerts WHERE tenant_id = ? ORDER BY created_at DESC LIMIT 20').bind(tId(c)).all()).results || [];
  } catch (e) { alerts = []; }
  try {
    healthLogs = (await c.env.DB.prepare('SELECT * FROM health_logs ORDER BY created_at DESC LIMIT 10').all()).results || [];
  } catch (e) { healthLogs = []; }

  return renderPage(c, 'Monitoring', 'monitoring', `
    <div class="fade-in">
      <div class="flex justify-between items-center mb-8">
        <div>
          <h1 class="text-4xl font-extrabold mb-2"><span class="text-gradient-orange">Monitoring</span></h1>
          <p class="text-gim-neutral-500">Health checks, alertas y m├®tricas del sistema</p>
        </div>
        <button onclick="runHealthCheck()" class="bg-gradient-orange rounded-xl px-6 py-3 font-semibold text-white hover:opacity-90 transition shadow-lg shadow-gim-orange-500/20">
          ­ƒ®║ Health Check
        </button>
      </div>

      <!-- Health Status -->
      <div id="health-status" class="grid grid-cols-2 md:grid-cols-5 gap-4 mb-8">
        <div class="bg-white rounded-xl p-4 border border-gim-neutral-200 shadow-sm text-center">
          <div class="text-sm text-gim-neutral-500 mb-1">D1</div>
          <div id="h-d1" class="text-2xl font-bold text-green-500">ÔùÅ</div>
        </div>
        <div class="bg-white rounded-xl p-4 border border-gim-neutral-200 shadow-sm text-center">
          <div class="text-sm text-gim-neutral-500 mb-1">KV</div>
          <div id="h-kv" class="text-2xl font-bold text-green-500">ÔùÅ</div>
        </div>
        <div class="bg-white rounded-xl p-4 border border-gim-neutral-200 shadow-sm text-center">
          <div class="text-sm text-gim-neutral-500 mb-1">Vectorize</div>
          <div id="h-vec" class="text-2xl font-bold text-green-500">ÔùÅ</div>
        </div>
        <div class="bg-white rounded-xl p-4 border border-gim-neutral-200 shadow-sm text-center">
          <div class="text-sm text-gim-neutral-500 mb-1">AI</div>
          <div id="h-ai" class="text-2xl font-bold text-green-500">ÔùÅ</div>
        </div>
        <div class="bg-white rounded-xl p-4 border border-gim-neutral-200 shadow-sm text-center">
          <div class="text-sm text-gim-neutral-500 mb-1">R2</div>
          <div id="h-r2" class="text-2xl font-bold text-green-500">ÔùÅ</div>
        </div>
      </div>

      <!-- Recent Alerts -->
      <div class="bg-white rounded-2xl p-6 border border-gim-neutral-200 shadow-sm mb-8">
        <h3 class="font-bold text-gim-neutral-900 mb-4">Alertas Recientes</h3>
        <div class="overflow-x-auto">
          <table class="w-full text-sm">
            <thead>
              <tr class="border-b border-gim-neutral-100">
                <th class="text-left py-3 text-gim-neutral-500 font-medium">Fecha</th>
                <th class="text-left py-3 text-gim-neutral-500 font-medium">Tipo</th>
                <th class="text-left py-3 text-gim-neutral-500 font-medium">Severidad</th>
                <th class="text-left py-3 text-gim-neutral-500 font-medium">Mensaje</th>
                <th class="text-left py-3 text-gim-neutral-500 font-medium">Estado</th>
              </tr>
            </thead>
            <tbody>
              ${alerts.map((a: any) => `
                <tr class="border-b border-gim-neutral-50 hover:bg-gim-neutral-50">
                  <td class="py-3 text-gim-neutral-700 text-xs">${a.created_at}</td>
                  <td class="py-3"><span class="px-2 py-0.5 rounded-full text-xs bg-gim-neutral-100 text-gim-neutral-600">${a.type}</span></td>
                  <td class="py-3">
                    <span class="px-2 py-0.5 rounded-full text-xs ${a.severity === 'critical' ? 'bg-red-100 text-red-600' : a.severity === 'warning' ? 'bg-yellow-100 text-yellow-600' : 'bg-blue-100 text-blue-600'}">${a.severity}</span>
                  </td>
                  <td class="py-3 text-gim-neutral-700 max-w-xs truncate">${a.message}</td>
                  <td class="py-3">
                    ${a.acknowledged
                      ? '<span class="text-xs text-gim-neutral-400">Ô£ô Ack</span>'
                      : `<form method="POST" action="/admin/monitoring/${a.id}/ack" class="inline"><button class="text-xs text-gim-orange-500 hover:text-gim-orange-600 font-medium">Ack</button></form>`
                    }
                  </td>
                </tr>
              `).join('') || '<tr><td colspan="5" class="py-8 text-center text-gim-neutral-400">Sin alertas</td></tr>'}
            </tbody>
          </table>
        </div>
      </div>

      <!-- Health Logs -->
      <div class="bg-white rounded-2xl p-6 border border-gim-neutral-200 shadow-sm">
        <h3 class="font-bold text-gim-neutral-900 mb-4">Historial de Health Checks</h3>
        <div class="space-y-2">
          ${healthLogs.map((h: any) => `
            <div class="flex items-center justify-between p-3 bg-gim-neutral-50 rounded-xl">
              <div class="flex items-center gap-3">
                <span class="w-3 h-3 rounded-full ${h.status === 'ok' ? 'bg-green-500' : h.status === 'degraded' ? 'bg-yellow-500' : 'bg-red-500'}"></span>
                <span class="text-sm font-medium text-gim-neutral-900">${h.status}</span>
              </div>
              <span class="text-xs text-gim-neutral-500">${h.created_at}</span>
            </div>
          `).join('') || '<div class="text-gim-neutral-400 text-center py-4">Sin historial</div>'}
        </div>
      </div>

      <script>
        async function runHealthCheck() {
          document.querySelectorAll('#health-status .text-2xl').forEach(el => { el.textContent = 'Ôùï'; el.className = 'text-2xl font-bold text-gim-neutral-300'; });
          try {
            const res = await fetch('/admin/api/health-check', { method: 'POST' });
            const data = await res.json();
            ['d1','kv','vec','ai','r2'].forEach(s => {
              const el = document.getElementById('h-' + s);
              const ok = data[s] === 'ok' || data[s] === true;
              el.textContent = ok ? 'ÔùÅ' : 'Ôùï';
              el.className = 'text-2xl font-bold ' + (ok ? 'text-green-500' : 'text-red-500');
            });
            alert('Health check completado: ' + JSON.stringify(data));
          } catch (e) {
            alert('Error ejecutando health check: ' + e.message);
          }
        }
      </script>
    </div>
  `);
});

  

admin.post('/api/health-check', async (c) => {
  const results: Record<string, string> = {};
  const resultsArr: { service: string; status: string; latency_ms: number }[] = [];

  // D1
  const t0 = Date.now();
  try { await c.env.DB.prepare('SELECT 1').first(); results.d1 = 'ok'; } catch { results.d1 = 'down'; }
  resultsArr.push({ service: 'd1', status: results.d1, latency_ms: Date.now() - t0 });

  // KV
  const t1 = Date.now();
  try { if (c.env.CACHE) { await c.env.CACHE.put('health-check', String(Date.now())); await c.env.CACHE.get('health-check'); results.kv = 'ok'; } else { results.kv = 'ok'; } } catch { results.kv = 'down'; }
  resultsArr.push({ service: 'kv', status: results.kv, latency_ms: Date.now() - t1 });

  // Vectorize
  const t2 = Date.now();
  try { if (c.env.VECTORIZE) { await c.env.VECTORIZE.query([0.01], { topK: 1 }); } results.vec = 'ok'; } catch { results.vec = 'down'; }
  resultsArr.push({ service: 'vectorize', status: results.vec, latency_ms: Date.now() - t2 });

  // AI
  const t3 = Date.now();
  try { if (c.env.AI) { await c.env.AI.run('@cf/meta/llama-3.1-8b-instruct', { messages: [{ role: 'user', content: 'hi' }], max_tokens: 1 }); } results.ai = 'ok'; } catch { results.ai = 'down'; }
  resultsArr.push({ service: 'ai', status: results.ai, latency_ms: Date.now() - t3 });

  // R2
  const t4 = Date.now();
  try { if (c.env.STORAGE) { await c.env.STORAGE.head('health-check-probe'); } results.r2 = 'ok'; } catch { results.r2 = 'down'; }
  resultsArr.push({ service: 'r2', status: results.r2, latency_ms: Date.now() - t4 });

  // Log to health_logs
  const overall = Object.values(results).every(v => v === 'ok') ? 'ok' : 'degraded';
  try {
    await c.env.DB.prepare(
      'INSERT INTO health_logs (id, service, status, message) VALUES (?, ?, ?, ?)'
    ).bind(crypto.randomUUID(), 'all', overall, JSON.stringify(resultsArr)).run();

    // Create alert if any service down
    const downServices = Object.entries(results).filter(([, v]) => v === 'down').map(([k]) => k);
    if (downServices.length > 0) {
      await c.env.DB.prepare(
        'INSERT INTO monitoring_alerts (id, type, severity, message) VALUES (?, ?, ?, ?)'
      ).bind(crypto.randomUUID(), 'health_check', 'critical', `Servicios ca├¡dos: ${downServices.join(', ')}`).run();
    }
  } catch (e) {}

  return c.json(results);
});

  

admin.post('/monitoring/:id/ack', async (c) => {
  const id = c.req.param('id');
  try {
    await c.env.DB.prepare('UPDATE monitoring_alerts SET acknowledged = 1 WHERE id = ?').bind(id).run();
  } catch (e) {}
  return c.redirect('/admin/monitoring');
});

  

// ÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉ
// BACKUPS
// ÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉ

admin.get('/backups', async (c) => {
  let backups: any[] = [];
  try {
    backups = (await c.env.DB.prepare('SELECT * FROM backup_logs ORDER BY started_at DESC LIMIT 20').all()).results || [];
  } catch (e) { backups = []; }

  return renderPage(c, 'Backups', 'backups', `
    <div class="fade-in">
      <div class="flex justify-between items-center mb-8">
        <div>
          <h1 class="text-4xl font-extrabold mb-2"><span class="text-gradient-cyan">Backups</span></h1>
          <p class="text-gim-neutral-500">Backup autom├ítico de D1 ÔåÆ R2</p>
        </div>
        <div class="flex gap-3">
          <button onclick="createBackup()" class="bg-gradient-cyan rounded-xl px-6 py-3 font-semibold text-white hover:opacity-90 transition shadow-lg shadow-gim-cyan-500/20">
            Crear Backup
          </button>
        </div>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <div class="bg-white rounded-2xl p-6 border border-gim-neutral-200 shadow-sm">
          <div class="text-gim-neutral-500 text-sm mb-2">├Ültimo Backup</div>
          <div class="text-2xl font-extrabold text-gim-cyan-500">${backups[0]?.completed_at || 'Nunca'}</div>
        </div>
        <div class="bg-white rounded-2xl p-6 border border-gim-neutral-200 shadow-sm">
          <div class="text-gim-neutral-500 text-sm mb-2">Total Backups</div>
          <div class="text-2xl font-extrabold text-gim-orange-500">${backups.length}</div>
        </div>
        <div class="bg-white rounded-2xl p-6 border border-gim-neutral-200 shadow-sm">
          <div class="text-gim-neutral-500 text-sm mb-2">Retention</div>
          <div class="text-2xl font-extrabold text-gim-purple-500">30 d├¡as</div>
        </div>
      </div>

      <div class="bg-white rounded-2xl p-6 border border-gim-neutral-200 shadow-sm">
        <h3 class="font-bold text-gim-neutral-900 mb-4">Historial de Backups</h3>
        <div class="overflow-x-auto">
          <table class="w-full text-sm">
            <thead>
              <tr class="border-b border-gim-neutral-100">
                <th class="text-left py-3 text-gim-neutral-500 font-medium">ID</th>
                <th class="text-left py-3 text-gim-neutral-500 font-medium">Tipo</th>
                <th class="text-left py-3 text-gim-neutral-500 font-medium">Status</th>
                <th class="text-left py-3 text-gim-neutral-500 font-medium">Tablas</th>
                <th class="text-left py-3 text-gim-neutral-500 font-medium">Filas</th>
                <th class="text-left py-3 text-gim-neutral-500 font-medium">Tama├▒o</th>
                <th class="text-left py-3 text-gim-neutral-500 font-medium">Inicio</th>
              </tr>
            </thead>
            <tbody>
              ${backups.map((b: any) => `
                 <tr class="border-b border-gim-neutral-50 hover:bg-gim-neutral-50">
                  <td class="py-3 font-mono text-xs text-gim-neutral-600">${b.id?.slice(0, 20)}...</td>
                  <td class="py-3"><span class="px-2 py-0.5 rounded-full text-xs bg-gim-neutral-100 text-gim-neutral-600">${b.type}</span></td>
                  <td class="py-3">
                    <span class="px-2 py-0.5 rounded-full text-xs ${b.status === 'completed' ? 'bg-green-100 text-green-600' : b.status === 'running' ? 'bg-blue-100 text-blue-600' : 'bg-red-100 text-red-600'}">${b.status}</span>
                  </td>
                  <td class="py-3 text-gim-neutral-700">${JSON.parse(b.tables || '[]').length}</td>
                  <td class="py-3 text-gim-neutral-700">${(b.total_rows || 0).toLocaleString()}</td>
                  <td class="py-3 text-gim-neutral-700">${((b.total_size_bytes || 0) / 1024).toFixed(1)} KB</td>
                  <td class="py-3 text-gim-neutral-700 text-xs">${b.started_at}</td>
                  <td class="py-3">
                    <div class="flex gap-1">
                      <form method="POST" action="/admin/api/backup/${b.id}/restore" onsubmit="return confirm('┬┐Restaurar este backup? Esto sobrescribir├í los datos actuales.')">
                        <button class="text-xs text-gim-cyan-500 hover:text-gim-cyan-600 font-medium">Ôå║ Restaurar</button>
                      </form>
                      <form method="POST" action="/admin/api/backup/${b.id}/delete" onsubmit="return confirm('┬┐Eliminar este backup?')">
                        <button class="text-xs text-red-500 hover:text-red-600 font-medium ml-2"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg></button>
                      </form>
                    </div>
                  </td>
                </tr>
              `).join('') || '<tr><td colspan="7" class="py-8 text-center text-gim-neutral-400">Sin backups a├║n</td></tr>'}
            </tbody>
          </table>
        </div>
      </div>

      <script>
        async function createBackup() {
          if (!confirm('┬┐Crear backup completo de todas las tablas?')) return;
          const btn = event.target;
          btn.disabled = true;
          btn.textContent = 'ÔÅ│ Creando...';
          try {
            const res = await fetch('/admin/api/backup', { method: 'POST' });
            const data = await res.json();
            alert('Backup completado: ' + data.tables + ' tablas, ' + data.rows + ' filas, ' + (data.size / 1024).toFixed(1) + ' KB');
            location.reload();
          } catch (e) {
            alert('Error: ' + e.message);
            btn.disabled = false;
            btn.textContent = 'Crear Backup';
          }
        }
      </script>
    </div>
  `);
});

  

admin.post('/api/backup', async (c) => {
  const backupId = crypto.randomUUID();
  const tables = ['agents', 'conversations', 'messages', 'knowledge_base', 'knowledge_chunks',
    'mcp_tools', 'ai_logs', 'ab_tests', 'ab_events', 'webhooks', 'admin_users', 'audit_logs',
    'user_memories', 'tenants', 'monitoring_alerts', 'backup_logs', 'channel_configs',
    'connectors', 'workflows', 'workflow_runs', 'agent_knowledge', 'agent_tools',
    'tool_execution_logs', 'usage_logs', 'config', 'leads', 'tickets', 'health_logs'];
  let totalRows = 0;
  const backupData: Record<string, any[]> = {};

  for (const table of tables) {
    try {
      const result = await c.env.DB.prepare(`SELECT * FROM ${table}`).all();
      backupData[table] = result.results || [];
      totalRows += backupData[table].length;
    } catch (e) {
      backupData[table] = [];
    }
  }

  const backupJson = JSON.stringify({ backup_id: backupId, created_at: new Date().toISOString(), tables: Object.keys(backupData), data: backupData });
  const sizeBytes = new TextEncoder().encode(backupJson).length;

  // Save to R2
  if (c.env.STORAGE) {
    try {
      await c.env.STORAGE.put(`backups/${backupId}.json`, backupJson);
    } catch (e) {}
  }

  // Log to backup_logs
  try {
    await c.env.DB.prepare(
      'INSERT INTO backup_logs (id, type, status, tables, total_rows, total_size_bytes, started_at, completed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).bind(
      backupId, 'manual', 'completed',
      JSON.stringify(Object.keys(backupData)), totalRows, sizeBytes,
      new Date().toISOString(), new Date().toISOString()
    ).run();
  } catch (e: any) {
    return c.json({ error: e.message }, 500);
  }

  return c.json({ id: backupId, tables: tables.length, rows: totalRows, size: sizeBytes });
});

  

admin.post('/api/backup/:id/restore', async (c) => {
  const id = c.req.param('id');
  if (!c.env.STORAGE) return c.json({ error: 'R2 no disponible' }, 500);

  try {
    const obj = await c.env.STORAGE.get(`backups/${id}.json`);
    if (!obj) return c.json({ error: 'Backup no encontrado' }, 404);
    const text = await obj.text();
    const backup = JSON.parse(text);
    let restoredTables = 0;

    for (const [table, rows] of Object.entries(backup.data || {})) {
      if (!Array.isArray(rows) || rows.length === 0) continue;
      try {
        const cols = Object.keys(rows[0]);
        const placeholders = cols.map(() => '?').join(',');
        const colNames = cols.join(',');
        for (const row of rows) {
          await c.env.DB.prepare(`INSERT OR REPLACE INTO ${table} (${colNames}) VALUES (${placeholders})`).bind(...cols.map(k => row[k])).run();
        }
        restoredTables++;
      } catch (e) {}
    }

    return c.json({ restored: restoredTables, rows: backup.tables?.length || 0 });
  } catch (e: any) {
    return c.json({ error: e.message }, 500);
  }
});

  

admin.post('/api/backup/:id/delete', async (c) => {
  const id = c.req.param('id');
  if (c.env.STORAGE) {
    try { await c.env.STORAGE.delete(`backups/${id}.json`); } catch (e) {}
  }
  try {
    await c.env.DB.prepare('DELETE FROM backup_logs WHERE id = ?').bind(id).run();
  } catch (e) {}
  return c.redirect('/admin/backups');
});

  

// ÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉ
// TENANTS ÔÇö Multi-tenant management
// ÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉ

admin.get('/tenants', async (c) => {
  let tenants: any[] = [];
  try {
    tenants = (await c.env.DB.prepare('SELECT * FROM tenants ORDER BY created_at DESC').all()).results || [];
  } catch (e) { tenants = []; }

  const plans = { free: 'Free', starter: 'Starter', pro: 'Pro', enterprise: 'Enterprise' };
  const planLabel = (p: any) => (plans as Record<string, string>)[p] || p;

  return renderPage(c, 'Tenants', 'tenants', `
    <div class="fade-in">
      <div class="flex justify-between items-center mb-8">
        <div>
          <h1 class="text-4xl font-extrabold mb-2"><span class="text-gradient-orange">Tenants</span></h1>
          <p class="text-gim-neutral-500">${tenants.length} empresas configuradas</p>
        </div>
        <button onclick="document.getElementById('modal-tenant').classList.remove('hidden')" class="bg-gradient-orange rounded-xl px-6 py-3 font-semibold text-white hover:opacity-90 transition shadow-lg shadow-gim-orange-500/20">
          + Nuevo Tenant
        </button>
      </div>

      <!-- Modal Nuevo Tenant -->
      <div id="modal-tenant" class="hidden fixed inset-0 bg-black/50 flex items-center justify-center z-50">
        <form method="POST" action="/admin/tenants/save" class="bg-white rounded-2xl p-8 w-full max-w-lg shadow-2xl border border-gim-neutral-200">
          <input type="hidden" id="tenant-id" name="id" value="">
          <h2 id="modal-tenant-title" class="text-2xl font-bold mb-6"><span class="text-gradient-orange">Nuevo Tenant</span></h2>
          <div class="space-y-4">
            <div>
              <label class="block text-sm font-medium text-gim-neutral-700 mb-1">Nombre</label>
              <input name="name" required class="w-full border border-gim-neutral-300 rounded-xl px-4 py-2.5 focus:ring-2 focus:ring-gim-orange-400 focus:border-gim-orange-400 outline-none" placeholder="Mi Empresa">
            </div>
            <div>
              <label class="block text-sm font-medium text-gim-neutral-700 mb-1">Email del propietario</label>
              <input name="owner_email" type="email" required class="w-full border border-gim-neutral-300 rounded-xl px-4 py-2.5 focus:ring-2 focus:ring-gim-orange-400 focus:border-gim-orange-400 outline-none" placeholder="admin@empresa.com">
            </div>
            <div>
              <label class="block text-sm font-medium text-gim-neutral-700 mb-1">Slug (identificador ├║nico)</label>
              <input name="slug" required pattern="[a-z0-9-]+" class="w-full border border-gim-neutral-300 rounded-xl px-4 py-2.5 focus:ring-2 focus:ring-gim-orange-400 focus:border-gim-orange-400 outline-none font-mono" placeholder="mi-empresa">
            </div>
            <div>
              <label class="block text-sm font-medium text-gim-neutral-700 mb-1">Plan</label>
              <select name="plan" class="w-full border border-gim-neutral-300 rounded-xl px-4 py-2.5 focus:ring-2 focus:ring-gim-orange-400 focus:border-gim-orange-400 outline-none">
                <option value="free">Free</option>
                <option value="starter">Starter</option>
                <option value="pro" selected>Pro</option>
                <option value="enterprise">Enterprise</option>
              </select>
            </div>
          </div>
          <div class="flex gap-3 mt-6">
            <button type="submit" class="flex-1 bg-gradient-orange rounded-xl py-3 font-semibold text-white hover:opacity-90 transition">Crear Tenant</button>
            <button type="button" onclick="document.getElementById('modal-tenant').classList.add('hidden')" class="px-6 py-3 rounded-xl border border-gim-neutral-300 text-gim-neutral-600 hover:bg-gim-neutral-50 transition">Cancelar</button>
          </div>
        </form>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        ${tenants.map((t: any) => {
          const limits = JSON.parse(t.limits || '{}');
          return `
            <div class="bg-white rounded-2xl p-6 border border-gim-neutral-200 card-hover shadow-sm">
              <div class="flex justify-between items-start mb-4">
                <div class="w-14 h-14 bg-gradient-orange rounded-xl flex items-center justify-center shadow-lg shadow-gim-orange-500/15">
                  <svg class="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-4m-6 0H6m0 0H4m2 0V9h12v12"/></svg>
                </div>
                <span class="px-3 py-1 rounded-full text-xs font-medium ${t.status === 'active' ? 'bg-green-100 text-green-600' : 'bg-red-100 text-red-600'}">
                  ${t.status}
                </span>
              </div>
              <div class="font-semibold text-lg text-gim-neutral-900 mb-1">${t.name}</div>
              <div class="text-gim-neutral-500 text-sm mb-3">${t.owner_email}</div>
              <div class="space-y-2 mb-4">
                <div class="flex justify-between text-sm">
                  <span class="text-gim-neutral-500">Plan</span>
                  <span class="px-2 py-0.5 rounded-full text-xs bg-gim-orange-50 text-gim-orange-600 font-medium">${planLabel(t.plan)}</span>
                </div>
                <div class="flex justify-between text-sm">
                  <span class="text-gim-neutral-500">Slug</span>
                  <span class="text-xs font-mono text-gim-neutral-700">${t.slug}</span>
                </div>
                <div class="flex justify-between text-sm">
                  <span class="text-gim-neutral-500">Max Agentes</span>
                  <span class="text-gim-neutral-700">${limits.max_agents === -1 ? 'Ôê×' : limits.max_agents}</span>
                </div>
              </div>
              <div class="flex gap-2">
                <button onclick="editTenant('${t.id}', '${t.name}', '${t.owner_email}', '${t.slug}', '${t.plan}')" class="flex-1 bg-gim-neutral-100 hover:bg-gim-neutral-200 rounded-xl py-2 text-sm font-medium transition text-gim-neutral-700">Editar</button>
                <form method="POST" action="/admin/tenants/${t.id}/delete" onsubmit="return confirm('┬┐Eliminar este tenant?')">
                  <button class="bg-gim-neutral-100 hover:bg-red-100 rounded-xl py-2 px-4 text-sm transition text-gim-neutral-500 hover:text-red-500"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg></button>
                </form>
              </div>
            </div>
          `;
        }).join('') || '<div class="col-span-3 text-gim-neutral-400 text-center py-12">No hay tenants. La instancia est├í en modo single-tenant.</div>'}
      </div>

      <script>
        function editTenant(id, name, email, slug, plan) {
          document.getElementById('tenant-id').value = id;
          document.getElementById('modal-tenant-title').textContent = 'Editar Tenant';
          document.querySelector('#modal-tenant input[name="name"]').value = name;
          document.querySelector('#modal-tenant input[name="owner_email"]').value = email;
          document.querySelector('#modal-tenant input[name="slug"]').value = slug;
          document.querySelector('#modal-tenant select[name="plan"]').value = plan;
          document.getElementById('modal-tenant').classList.remove('hidden');
        }
      </script>
    </div>
  `);
});

  

admin.post('/tenants/save', async (c) => {
  const form = await c.req.formData();
  const id = String(form.get('id') || '');
  const name = String(form.get('name') || '').trim();
  const owner_email = String(form.get('owner_email') || '').trim();
  const slug = String(form.get('slug') || '').trim().toLowerCase().replace(/[^a-z0-9-]/g, '-');
  const plan = String(form.get('plan') || 'free');

  if (!name || !owner_email || !slug) {
    return c.html(layout('Error', 'tenants', `<div class="p-8 text-center text-red-500">Faltan campos obligatorios.</div>`), 400);
  }

  const planLimits: Record<string, any> = {
    free: { max_agents: 2, max_messages_month: 1000, max_knowledge: 50 },
    starter: { max_agents: 5, max_messages_month: 10000, max_knowledge: 500 },
    pro: { max_agents: 20, max_messages_month: 100000, max_knowledge: 5000 },
    enterprise: { max_agents: -1, max_messages_month: -1, max_knowledge: -1 },
  };

  try {
    if (id) {
      await c.env.DB.prepare(
        'UPDATE tenants SET name = ?, slug = ?, plan = ?, owner_email = ?, limits = ? WHERE id = ?'
      ).bind(name, slug, plan, owner_email, JSON.stringify(planLimits[plan] || planLimits.free), id).run();
    } else {
      await c.env.DB.prepare(
        'INSERT INTO tenants (id, name, slug, plan, status, config, limits, owner_email) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
      ).bind(
        crypto.randomUUID(), name, slug, plan, 'active', '{}',
        JSON.stringify(planLimits[plan] || planLimits.free), owner_email
      ).run();
    }
  } catch (e: any) {
    return c.html(layout('Error', 'tenants', `<div class="p-8 text-center text-red-500">Error: ${e.message}</div>`), 500);
  }

  await auditLog(c, id ? 'update' : 'create', 'tenant', id || undefined, { name, plan });
  return c.redirect('/admin/tenants');
});

  

admin.post('/tenants/:id/delete', async (c) => {
  const id = c.req.param('id');
  try {
    await c.env.DB.prepare('DELETE FROM agents WHERE tenant_id = ?').bind(id).run();
    await c.env.DB.prepare('DELETE FROM conversations WHERE tenant_id = ?').bind(id).run();
    await c.env.DB.prepare('DELETE FROM messages WHERE tenant_id = ?').bind(id).run();
    await c.env.DB.prepare('DELETE FROM tickets WHERE tenant_id = ?').bind(id).run();
    await c.env.DB.prepare('DELETE FROM leads WHERE tenant_id = ?').bind(id).run();
    await c.env.DB.prepare('DELETE FROM knowledge_base WHERE tenant_id = ?').bind(id).run();
    await c.env.DB.prepare('DELETE FROM knowledge_chunks WHERE tenant_id = ?').bind(id).run();
    await c.env.DB.prepare('DELETE FROM mcp_tools WHERE tenant_id = ?').bind(id).run();
    await c.env.DB.prepare('DELETE FROM workflows WHERE tenant_id = ?').bind(id).run();
    await c.env.DB.prepare('DELETE FROM connectors WHERE tenant_id = ?').bind(id).run();
    await c.env.DB.prepare('DELETE FROM channel_configs WHERE tenant_id = ?').bind(id).run();
    await c.env.DB.prepare('DELETE FROM ai_logs WHERE tenant_id = ?').bind(id).run();
    await c.env.DB.prepare('DELETE FROM audit_logs WHERE tenant_id = ?').bind(id).run();
    await c.env.DB.prepare('DELETE FROM tenants WHERE id = ?').bind(id).run();
  } catch (e) {}
  return c.redirect('/admin/tenants');
});

  

// ÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉ
// USERS ÔÇö RBAC management
// ÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉ

admin.get('/users', async (c) => {
  let users: any[] = [];
  try {
    users = (await c.env.DB.prepare('SELECT * FROM admin_users ORDER BY created_at DESC').all()).results || [];
  } catch (e) { users = []; }

  const roleLabels: Record<string, string> = {
    super_admin: 'Super Admin',
    admin: 'Admin',
    editor: 'Editor',
    viewer: 'Viewer',
  };
  const roleColors: Record<string, string> = {
    super_admin: 'bg-red-100 text-red-600',
    admin: 'bg-orange-100 text-orange-600',
    editor: 'bg-blue-100 text-blue-600',
    viewer: 'bg-gim-neutral-100 text-gim-neutral-600',
  };

  return renderPage(c, 'Usuarios', 'users', `
    <div class="fade-in">
      <div class="flex justify-between items-center mb-8">
        <div>
          <h1 class="text-4xl font-extrabold mb-2"><span class="text-gradient-orange">Usuarios</span></h1>
          <p class="text-gim-neutral-500">${users.length} usuarios con acceso al admin</p>
        </div>
        <button onclick="document.getElementById('modal-user').classList.remove('hidden')" class="bg-gradient-orange rounded-xl px-6 py-3 font-semibold text-white hover:opacity-90 transition shadow-lg shadow-gim-orange-500/20">
          + Invitar Usuario
        </button>
      </div>

      <!-- Modal Nuevo Usuario -->
      <div id="modal-user" class="hidden fixed inset-0 bg-black/50 flex items-center justify-center z-50">
        <form method="POST" action="/admin/users/save" class="bg-white rounded-2xl p-8 w-full max-w-lg shadow-2xl border border-gim-neutral-200">
          <input type="hidden" id="user-id" name="id" value="">
          <h2 id="modal-user-title" class="text-2xl font-bold mb-6"><span class="text-gradient-orange">Invitar Usuario</span></h2>
          <div class="space-y-4">
            <div>
              <label class="block text-sm font-medium text-gim-neutral-700 mb-1">Nombre</label>
              <input name="name" required class="w-full border border-gim-neutral-300 rounded-xl px-4 py-2.5 focus:ring-2 focus:ring-gim-orange-400 focus:border-gim-orange-400 outline-none" placeholder="Juan P├®rez">
            </div>
            <div>
              <label class="block text-sm font-medium text-gim-neutral-700 mb-1">Email</label>
              <input name="email" type="email" required class="w-full border border-gim-neutral-300 rounded-xl px-4 py-2.5 focus:ring-2 focus:ring-gim-orange-400 focus:border-gim-orange-400 outline-none" placeholder="juan@empresa.com">
            </div>
            <div>
              <label class="block text-sm font-medium text-gim-neutral-700 mb-1">Rol</label>
              <select name="role" class="w-full border border-gim-neutral-300 rounded-xl px-4 py-2.5 focus:ring-2 focus:ring-gim-orange-400 focus:border-gim-orange-400 outline-none">
                <option value="viewer">Viewer</option>
                <option value="editor">Editor</option>
                <option value="admin">Admin</option>
                <option value="super_admin">Super Admin</option>
              </select>
            </div>
          </div>
          <div class="flex gap-3 mt-6">
            <button type="submit" class="flex-1 bg-gradient-orange rounded-xl py-3 font-semibold text-white hover:opacity-90 transition">Invitar</button>
            <button type="button" onclick="document.getElementById('modal-user').classList.add('hidden')" class="px-6 py-3 rounded-xl border border-gim-neutral-300 text-gim-neutral-600 hover:bg-gim-neutral-50 transition">Cancelar</button>
          </div>
        </form>
      </div>

      <div class="bg-white rounded-2xl p-6 border border-gim-neutral-200 shadow-sm mb-8">
        <h3 class="font-bold text-gim-neutral-900 mb-4">Roles Disponibles</h3>
        <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div class="p-4 bg-gim-neutral-50 rounded-xl">
            <div class="font-semibold text-sm text-gim-neutral-900">Super Admin</div>
            <div class="text-xs text-gim-neutral-500 mt-1">Acceso total al sistema</div>
          </div>
          <div class="p-4 bg-gim-neutral-50 rounded-xl">
            <div class="font-semibold text-sm text-gim-neutral-900">Admin</div>
            <div class="text-xs text-gim-neutral-500 mt-1">Gesti├│n completa excepto usuarios</div>
          </div>
          <div class="p-4 bg-gim-neutral-50 rounded-xl">
            <div class="font-semibold text-sm text-gim-neutral-900">Editor</div>
            <div class="text-xs text-gim-neutral-500 mt-1">Crear/editar contenido</div>
          </div>
          <div class="p-4 bg-gim-neutral-50 rounded-xl">
            <div class="font-semibold text-sm text-gim-neutral-900">Viewer</div>
            <div class="text-xs text-gim-neutral-500 mt-1">Solo lectura</div>
          </div>
        </div>
      </div>

      <div class="bg-white rounded-2xl p-6 border border-gim-neutral-200 shadow-sm">
        <h3 class="font-bold text-gim-neutral-900 mb-4">Usuarios</h3>
        <div class="overflow-x-auto">
          <table class="w-full text-sm">
            <thead>
              <tr class="border-b border-gim-neutral-100">
                <th class="text-left py-3 text-gim-neutral-500 font-medium">Nombre</th>
                <th class="text-left py-3 text-gim-neutral-500 font-medium">Email</th>
                <th class="text-left py-3 text-gim-neutral-500 font-medium">Rol</th>
                <th class="text-left py-3 text-gim-neutral-500 font-medium">├Ültimo Login</th>
                <th class="text-left py-3 text-gim-neutral-500 font-medium">Acciones</th>
              </tr>
            </thead>
            <tbody>
              ${users.map((u: any) => `
                <tr class="border-b border-gim-neutral-50 hover:bg-gim-neutral-50">
                  <td class="py-3 font-medium text-gim-neutral-900">${u.name}</td>
                  <td class="py-3 text-gim-neutral-700">${u.email}</td>
                  <td class="py-3"><span class="px-2 py-0.5 rounded-full text-xs ${roleColors[u.role] || ''}">${roleLabels[u.role] || u.role}</span></td>
                  <td class="py-3 text-gim-neutral-700 text-xs">${u.last_login_at || 'Nunca'}</td>
                  <td class="py-3">
                    <div class="flex gap-2">
                      <button onclick="editUser('${u.id}', '${u.name}', '${u.email}', '${u.role}')" class="text-gim-orange-500 hover:text-gim-orange-600 text-sm font-medium">Editar</button>
                      <form method="POST" action="/admin/users/${u.id}/delete" onsubmit="return confirm('┬┐Eliminar este usuario?')" class="inline">
                        <button class="text-red-500 hover:text-red-600 text-sm font-medium">Eliminar</button>
                      </form>
                    </div>
                  </td>
                </tr>
              `).join('') || '<tr><td colspan="5" class="py-8 text-center text-gim-neutral-400">No hay usuarios. Crea el primer admin.</td></tr>'}
            </tbody>
          </table>
        </div>
      </div>

      <script>
        function editUser(id, name, email, role) {
          document.getElementById('user-id').value = id;
          document.getElementById('modal-user-title').textContent = 'Editar Usuario';
          document.querySelector('#modal-user input[name="name"]').value = name;
          document.querySelector('#modal-user input[name="email"]').value = email;
          document.querySelector('#modal-user select[name="role"]').value = role;
          document.getElementById('modal-user').classList.remove('hidden');
        }
        document.querySelector('button[onclick*="modal-user"]')?.addEventListener('click', () => {
          document.getElementById('user-id').value = '';
          document.getElementById('modal-user-title').textContent = 'Invitar Usuario';
        });
      </script>
    </div>
  `);
});

  

admin.post('/users/save', async (c) => {
  const form = await c.req.formData();
  const id = String(form.get('id') || '');
  const name = String(form.get('name') || '').trim();
  const email = String(form.get('email') || '').trim().toLowerCase();
  const role = String(form.get('role') || 'viewer');

  if (!name || !email) {
    return c.html(layout('Error', 'users', `<div class="p-8 text-center text-red-500">Faltan campos obligatorios.</div>`), 400);
  }

  try {
    if (id) {
      await c.env.DB.prepare(
        'UPDATE admin_users SET name = ?, email = ?, role = ? WHERE id = ?'
      ).bind(name, email, role, id).run();
    } else {
      await c.env.DB.prepare(
        'INSERT INTO admin_users (id, email, name, role, permissions) VALUES (?, ?, ?, ?, ?)'
      ).bind(crypto.randomUUID(), email, name, role, JSON.stringify([])).run();
    }
  } catch (e: any) {
    return c.html(layout('Error', 'users', `<div class="p-8 text-center text-red-500">Error: ${e.message}</div>`), 500);
  }

  await auditLog(c, id ? 'update' : 'create', 'user', id || undefined, { name, email, role });
  return c.redirect('/admin/users');
});

  

admin.post('/users/:id/delete', async (c) => {
  const id = c.req.param('id');
  try {
    await c.env.DB.prepare('DELETE FROM admin_users WHERE id = ?').bind(id).run();
  } catch (e) {}
  return c.redirect('/admin/users');
});

  

// ÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉ
// AUDIT LOG
// ÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉ

admin.get('/audit', async (c) => {
  let logs: any[] = [];
  try {
    logs = (await c.env.DB.prepare('SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 100').all()).results || [];
  } catch (e) { logs = []; }

  const actionLabels: Record<string, string> = {
    create: 'Crear',
    update: 'Actualizar',
    delete: 'Eliminar',
    login: 'Login',
  };
  const actionColors: Record<string, string> = {
    create: 'bg-green-100 text-green-600',
    update: 'bg-blue-100 text-blue-600',
    delete: 'bg-red-100 text-red-600',
    login: 'bg-purple-100 text-purple-600',
  };

  return renderPage(c, 'Audit Log', 'audit', `
    <div class="fade-in">
      <div class="mb-8">
        <h1 class="text-4xl font-extrabold mb-2"><span class="text-gradient-orange">Audit Log</span></h1>
        <p class="text-gim-neutral-500">Historial de acciones en el admin</p>
      </div>

      <div class="bg-white rounded-2xl p-6 border border-gim-neutral-200 shadow-sm">
        <div class="overflow-x-auto">
          <table class="w-full text-sm">
            <thead>
              <tr class="border-b border-gim-neutral-100">
                <th class="text-left py-3 text-gim-neutral-500 font-medium">Fecha</th>
                <th class="text-left py-3 text-gim-neutral-500 font-medium">Usuario</th>
                <th class="text-left py-3 text-gim-neutral-500 font-medium">Acci├│n</th>
                <th class="text-left py-3 text-gim-neutral-500 font-medium">Recurso</th>
                <th class="text-left py-3 text-gim-neutral-500 font-medium">ID</th>
                <th class="text-left py-3 text-gim-neutral-500 font-medium">IP</th>
              </tr>
            </thead>
            <tbody>
              ${logs.map((l: any) => `
                <tr class="border-b border-gim-neutral-50 hover:bg-gim-neutral-50">
                  <td class="py-3 text-gim-neutral-700 text-xs">${l.created_at}</td>
                  <td class="py-3 text-gim-neutral-900">${l.user_email}</td>
                  <td class="py-3"><span class="px-2 py-0.5 rounded-full text-xs ${actionColors[l.action] || ''}">${actionLabels[l.action] || l.action}</span></td>
                  <td class="py-3 text-gim-neutral-700">${l.resource_type}</td>
                  <td class="py-3 font-mono text-xs text-gim-neutral-500">${l.resource_id?.slice(0, 8) || 'ÔÇö'}</td>
                  <td class="py-3 text-gim-neutral-500 text-xs">${l.ip_address || 'ÔÇö'}</td>
                </tr>
              `).join('') || '<tr><td colspan="6" class="py-8 text-center text-gim-neutral-400">Sin logs de auditor├¡a</td></tr>'}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `);
});
}
