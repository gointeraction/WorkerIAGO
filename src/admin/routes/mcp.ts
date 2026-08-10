import { Hono } from 'hono';
import { html } from 'hono/html';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { Bindings, tId, renderPage, auditLog, getSessionSecret, signSession, verifySession, issueCsrfToken, verifyCsrf, tInfo, layout, SESSION_SECRET, AgentRow, ConversationRow, KnowledgeRow, LeadRow, MessageRow, TicketRow, UsageRow } from '../utils';

export function registerMcpRoutes(admin: Hono<{ Bindings: Bindings }>) {
  

// ÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉ
// MCP TOOLS ÔÇö Tool Registry & Management
// ÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉ

admin.get('/mcp-tools', async (c) => {
  let tools: any[] = [];
  try {
    tools = (await c.env.DB.prepare('SELECT * FROM mcp_tools WHERE tenant_id = ? ORDER BY created_at DESC').bind(tId(c)).all()).results || [];
  } catch (e) { tools = []; }

  const categories = [...new Set(tools.map(t => t.category))];

  return renderPage(c, 'MCP Tools', 'mcp-tools', `
    <div class="fade-in">
      <div class="flex justify-between items-center mb-8">
        <div>
          <h1 class="text-4xl font-extrabold mb-2"><span class="text-gradient-purple">MCP Tools</span></h1>
          <p class="text-gim-neutral-500">${tools.length} herramientas registradas</p>
        </div>
        <button onclick="showCreateTool()" class="bg-gradient-purple rounded-xl px-6 py-3 font-semibold text-white hover:opacity-90 transition shadow-lg shadow-gim-purple-500/20">
          + Nuevo Tool
        </button>
      </div>

      <!-- Tool Form -->
      <div id="tool-form" class="hidden bg-white rounded-2xl p-8 border border-gim-neutral-200 mb-8 shadow-sm">
        <h3 id="tool-form-title" class="text-xl font-bold text-gim-neutral-900 mb-6">Nuevo Tool MCP</h3>
        <form hx-post="/admin/mcp-tools/save" hx-target="#tools-grid" hx-swap="innerHTML">
          <input type="hidden" id="tool-id" name="id" value="">
          <div class="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
            <div>
              <label class="block text-sm font-semibold text-gim-neutral-700 mb-2">Nombre</label>
              <input type="text" name="name" id="tool-name" required class="w-full bg-gim-neutral-50 border-2 border-gim-neutral-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-gim-purple-400 transition-colors" placeholder="send_email">
            </div>
            <div>
              <label class="block text-sm font-semibold text-gim-neutral-700 mb-2">Categor├¡a</label>
              <select name="category" id="tool-category" class="w-full bg-gim-neutral-50 border-2 border-gim-neutral-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-gim-purple-400 transition-colors">
                <option value="custom">Custom</option>
                <option value="email">Email</option>
                <option value="calendar">Calendar</option>
                <option value="crm">CRM</option>
                <option value="payment">Payment</option>
                <option value="social">Social</option>
                <option value="external">External API</option>
              </select>
            </div>
            <div>
              <label class="block text-sm font-semibold text-gim-neutral-700 mb-2">Endpoint URL</label>
              <input type="url" name="endpoint_url" id="tool-endpoint" required class="w-full bg-gim-neutral-50 border-2 border-gim-neutral-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-gim-purple-400 transition-colors" placeholder="https://api.example.com/tool">
            </div>
            <div>
              <label class="block text-sm font-semibold text-gim-neutral-700 mb-2">M├®todo</label>
              <select name="method" id="tool-method" class="w-full bg-gim-neutral-50 border-2 border-gim-neutral-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-gim-purple-400 transition-colors">
                <option value="POST">POST</option>
                <option value="GET">GET</option>
                <option value="PUT">PUT</option>
                <option value="DELETE">DELETE</option>
              </select>
            </div>
            <div>
              <label class="block text-sm font-semibold text-gim-neutral-700 mb-2">Auth Type</label>
              <select name="auth_type" id="tool-auth" class="w-full bg-gim-neutral-50 border-2 border-gim-neutral-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-gim-purple-400 transition-colors">
                <option value="none">Ninguna</option>
                <option value="api_key">API Key</option>
                <option value="bearer">Bearer Token</option>
              </select>
            </div>
            <div>
              <label class="block text-sm font-semibold text-gim-neutral-700 mb-2">Timeout (ms)</label>
              <input type="number" name="timeout_ms" id="tool-timeout" value="10000" class="w-full bg-gim-neutral-50 border-2 border-gim-neutral-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-gim-purple-400 transition-colors">
            </div>
          </div>
          <div class="mb-6">
            <label class="block text-sm font-semibold text-gim-neutral-700 mb-2">Descripci├│n</label>
            <input type="text" name="description" id="tool-description" required class="w-full bg-gim-neutral-50 border-2 border-gim-neutral-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-gim-purple-400 transition-colors" placeholder="Env├¡a un email al destinatario especificado">
          </div>
          <div class="mb-6">
            <label class="block text-sm font-semibold text-gim-neutral-700 mb-2">Par├ímetros (JSON Schema)</label>
            <textarea name="parameters_schema" id="tool-params" rows="4" required class="w-full bg-gim-neutral-50 border-2 border-gim-neutral-200 rounded-xl px-4 py-3 text-sm font-mono focus:outline-none focus:border-gim-purple-400 transition-colors" placeholder='{"type":"object","properties":{"to":{"type":"string"},"subject":{"type":"string"},"body":{"type":"string"}},"required":["to","subject","body"]}'></textarea>
          </div>
          <div class="flex gap-3">
            <button type="submit" class="bg-gradient-purple rounded-xl px-6 py-3 font-semibold text-white hover:opacity-90 transition shadow-lg shadow-gim-purple-500/20">Guardar</button>
            <button type="button" onclick="hideToolForm()" class="bg-gim-neutral-100 rounded-xl px-6 py-3 font-semibold hover:bg-gim-neutral-200 transition text-gim-neutral-700">Cancelar</button>
          </div>
        </form>
      </div>

      <!-- Tools Grid -->
      <div id="tools-grid" class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        ${tools.map((t: any) => `
          <div class="bg-white rounded-2xl p-6 border border-gim-neutral-200 card-hover shadow-sm">
            <div class="flex justify-between items-start mb-4">
              <div class="w-12 h-12 bg-gradient-purple rounded-xl flex items-center justify-center shadow-lg shadow-gim-purple-500/15">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/></svg>
              </div>
              <span class="px-3 py-1 rounded-full text-xs font-medium ${t.is_active ? 'bg-green-100 text-green-600' : 'bg-red-100 text-red-600'}">
                ${t.is_active ? 'Activo' : 'Inactivo'}
              </span>
            </div>
            <div class="font-semibold text-gim-neutral-900 mb-1">${t.name}</div>
            <div class="text-gim-neutral-500 text-sm mb-3">${t.description}</div>
            <div class="space-y-2 mb-4">
              <div class="flex justify-between text-sm">
                <span class="text-gim-neutral-500">Categor├¡a</span>
                <span class="px-2 py-0.5 rounded-full text-xs bg-gim-purple-50 text-gim-purple-600">${t.category}</span>
              </div>
              <div class="flex justify-between text-sm">
                <span class="text-gim-neutral-500">M├®todo</span>
                <span class="text-xs font-mono text-gim-neutral-700">${t.method}</span>
              </div>
              <div class="flex justify-between text-sm">
                <span class="text-gim-neutral-500">Usos</span>
                <span class="text-gim-neutral-700">${t.usage_count}</span>
              </div>
              <div class="flex justify-between text-sm">
                <span class="text-gim-neutral-500">Latencia</span>
                <span class="text-gim-neutral-700">${t.avg_latency_ms || 0}ms</span>
              </div>
            </div>
            <div class="flex gap-2">
              <button onclick="editTool('${t.id}', '${t.name}', '${t.description}', '${t.category}', '${t.endpoint_url || ''}', '${t.method}', '${t.auth_type}', ${t.timeout_ms}, '${btoa(JSON.stringify(t.parameters_schema || {}))}')" class="flex-1 bg-gim-neutral-100 hover:bg-gim-neutral-200 rounded-xl py-2 text-sm font-medium transition text-gim-neutral-700">Editar</button>
              <button onclick="testTool('${t.id}', '${t.name}')" class="bg-gim-purple-50 hover:bg-gim-purple-100 rounded-xl py-2 px-3 text-sm transition text-gim-purple-600" title="Test"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 014.5 0m0 0v5.714a2.25 2.25 0 00.659 1.591L19.8 15.3M14.25 3.104c.251.023.501.05.75.082M19.8 15.3l-1.57.393A9.065 9.065 0 0112 15a9.065 9.065 0 00-6.23-.693L5 14.5"/></svg></button>
              <button hx-delete="/admin/mcp-tools/${t.id}" hx-target="#tools-grid" hx-swap="innerHTML" hx-confirm="┬┐Eliminar tool?" class="bg-gim-neutral-100 hover:bg-red-100 rounded-xl py-2 px-3 text-sm transition text-gim-neutral-500 hover:text-red-500"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg></button>
            </div>
          </div>
        `).join('') || '<div class="col-span-3 text-gim-neutral-400 text-center py-12">No hay tools configurados. Crea tu primer tool MCP.</div>'}
      </div>

      <!-- Test Modal -->
      <div id="test-modal" class="hidden fixed inset-0 z-50 flex items-center justify-center">
        <div class="absolute inset-0 bg-black/40 backdrop-blur-sm" onclick="hideTestModal()"></div>
        <div class="relative bg-white rounded-2xl p-8 w-full max-w-lg mx-4 shadow-2xl border border-gim-neutral-200">
          <div class="flex justify-between items-center mb-6">
            <h3 id="test-modal-title" class="text-xl font-bold text-gim-neutral-900">Test Tool</h3>
            <button onclick="hideTestModal()" class="w-8 h-8 bg-gim-neutral-100 rounded-lg flex items-center justify-center hover:bg-gim-neutral-200 transition text-gim-neutral-500"><svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg></button>
          </div>
          <div class="mb-4">
            <label class="block text-sm font-semibold text-gim-neutral-700 mb-2">Par├ímetros (JSON)</label>
            <textarea id="test-params" rows="6" class="w-full bg-gim-neutral-50 border-2 border-gim-neutral-200 rounded-xl px-4 py-3 text-sm font-mono focus:outline-none focus:border-gim-purple-400 transition-colors" placeholder='{"to":"test@example.com","subject":"Test","body":"Hello"}'></textarea>
          </div>
          <button onclick="runTest()" class="w-full bg-gradient-purple rounded-xl py-3 font-semibold text-white hover:opacity-90 transition">Ejecutar Test</button>
          <div id="test-result" class="mt-4 hidden bg-gim-neutral-50 rounded-xl p-4 text-sm font-mono text-gim-neutral-700 max-h-60 overflow-y-auto"></div>
        </div>
      </div>

      <script>
        function showCreateTool() { document.getElementById('tool-form').classList.remove('hidden'); document.getElementById('tool-form-title').textContent = 'Nuevo Tool MCP'; }
        function hideToolForm() { document.getElementById('tool-form').classList.add('hidden'); }
        function hideTestModal() { document.getElementById('test-modal').classList.add('hidden'); }

        function editTool(id, name, desc, cat, endpoint, method, auth, timeout, paramsB64) {
          document.getElementById('tool-form').classList.remove('hidden');
          document.getElementById('tool-form-title').textContent = 'Editar Tool';
          document.getElementById('tool-id').value = id;
          document.getElementById('tool-name').value = name;
          document.getElementById('tool-description').value = desc;
          document.getElementById('tool-category').value = cat;
          document.getElementById('tool-endpoint').value = endpoint;
          document.getElementById('tool-method').value = method;
          document.getElementById('tool-auth').value = auth;
          document.getElementById('tool-timeout').value = timeout;
          try { document.getElementById('tool-params').value = JSON.stringify(JSON.parse(atob(paramsB64)), null, 2); } catch(e) {}
          document.getElementById('tool-form').scrollIntoView({ behavior: 'smooth' });
        }

        function testTool(id, name) {
          document.getElementById('test-modal').classList.remove('hidden');
          document.getElementById('test-modal-title').textContent = 'Test: ' + name;
          document.getElementById('test-params').value = '{}';
          document.getElementById('test-result').classList.add('hidden');
          document.getElementById('test-result').dataset.toolId = id;
        }

        async function runTest() {
          const id = document.getElementById('test-result').dataset.toolId;
          const params = JSON.parse(document.getElementById('test-params').value || '{}');
          const res = await fetch('/admin/api/mcp-tools/' + id + '/test', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(params),
          });
          const result = await res.json();
          const el = document.getElementById('test-result');
          el.classList.remove('hidden');
          el.innerHTML = '<div class="mb-2 ' + (result.success ? 'text-green-600' : 'text-red-600') + '">' + (result.success ? 'Exito' : 'Error: ' + result.error) + '</div><div class="text-xs text-gim-neutral-500 mb-2">Latencia: ' + result.latency_ms + 'ms</div><pre class="text-xs whitespace-pre-wrap">' + JSON.stringify(result.data, null, 2) + '</pre>';
        }
      </script>
    </div>
  `);
});

  

// MCP Tools API
admin.post('/mcp-tools/save', async (c) => {
  const form = await c.req.formData();
  const id = form.get('id') as string;
  const name = form.get('name') as string;
  const description = form.get('description') as string;
  const category = form.get('category') as string;
  const endpointUrl = form.get('endpoint_url') as string;
  const method = form.get('method') as string;
  const authType = form.get('auth_type') as string;
  const timeoutMs = parseInt(form.get('timeout_ms') as string) || 10000;
  let parametersSchema: any = {};
  try { parametersSchema = JSON.parse(form.get('parameters_schema') as string || '{}'); } catch (e) {}

  try {
    if (id) {
      await c.env.DB.prepare(
        `UPDATE mcp_tools SET name=?, description=?, category=?, endpoint_url=?, method=?, auth_type=?, parameters_schema=?, timeout_ms=?, updated_at=datetime('now') WHERE id=? AND tenant_id = ?`
      ).bind(name, description, category, endpointUrl, method, authType, JSON.stringify(parametersSchema), timeoutMs, id, tId(c)).run();
    } else {
      const newId = crypto.randomUUID();
      await c.env.DB.prepare(
        `INSERT INTO mcp_tools (id, name, description, category, endpoint_url, method, auth_type, parameters_schema, timeout_ms, tenant_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(newId, name, description, category, endpointUrl, method, authType, JSON.stringify(parametersSchema), timeoutMs, tId(c)).run();
    }
  } catch (e) { console.error('Tool save error:', e); }

  return c.redirect('/admin/mcp-tools');
});

  

admin.delete('/mcp-tools/:id', async (c) => {
  const id = c.req.param('id');
  try { await c.env.DB.prepare('DELETE FROM mcp_tools WHERE id=? AND tenant_id = ?').bind(id, tId(c)).run(); } catch (e) {}
  return c.redirect('/admin/mcp-tools');
});

  

admin.post('/api/mcp-tools/:id/test', async (c) => {
  const id = c.req.param('id');
  const params = await c.req.json();
  try {
    const tool = await c.env.DB.prepare('SELECT * FROM mcp_tools WHERE id=? AND tenant_id=?').bind(id, tId(c)).first() as any;
    if (!tool) return c.json({ success: false, error: 'Tool not found' });

    const { executeTool } = await import('../../mcp');
    const result = await executeTool(c.env.DB, tool, params);
    return c.json(result);
  } catch (e: any) {
    return c.json({ success: false, error: e.message, latency_ms: 0 });
  }
});
}
