import { Hono } from 'hono';
import { html } from 'hono/html';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { Bindings, tId, renderPage, auditLog, getSessionSecret, signSession, verifySession, issueCsrfToken, verifyCsrf, tInfo, layout, SESSION_SECRET, AgentRow, ConversationRow, KnowledgeRow, LeadRow, MessageRow, TicketRow, UsageRow } from '../utils';

export function registerAgentsRoutes(admin: Hono<{ Bindings: Bindings }>) {
  

// Agents page
admin.get('/agents', async (c) => {
  let agents: AgentRow[] = [];
  let kbDocs: KnowledgeRow[] = [];
  try {
    const result = await c.env.DB.prepare(
      'SELECT * FROM agents WHERE tenant_id = ? ORDER BY created_at DESC'
    ).bind(tId(c)).all<AgentRow>();
    agents = result.results || [];
  } catch (e) { agents = []; }
  try {
    const result = await c.env.DB.prepare(
      'SELECT * FROM knowledge_base WHERE tenant_id = ? ORDER BY updated_at DESC'
    ).bind(tId(c)).all<KnowledgeRow>();
    kbDocs = result.results || [];
  } catch (e) { kbDocs = []; }
  
  return renderPage(c, 'Agentes', 'agents', `
    <div class="fade-in">
      <div class="flex justify-between items-center mb-8">
        <div>
          <h1 class="text-4xl font-extrabold mb-2">
            <span class="text-gradient-orange">Agentes</span>
          </h1>
          <p class="text-gim-neutral-500">${agents.length} agentes configurados</p>
        </div>
        <button onclick="showCreateAgent()" class="bg-gradient-orange rounded-xl px-6 py-3 font-semibold text-white hover:opacity-90 transition shadow-lg shadow-gim-orange-500/20">
          + Nuevo Agente
        </button>
      </div>
      
      <!-- Create/Edit Agent Form -->
      <div id="agent-form" class="hidden bg-white rounded-2xl p-8 border border-gim-neutral-200 mb-8 shadow-sm">
        <h3 id="agent-form-title" class="text-xl font-bold text-gim-neutral-900 mb-6">Nuevo Agente</h3>
        <form hx-post="/admin/agents/save" hx-target="#agent-list" hx-swap="innerHTML">
          <input type="hidden" id="agent-id" name="id" value="">
          
          <div class="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
            <div>
              <label class="block text-sm font-semibold text-gim-neutral-700 mb-2">Nombre</label>
              <input type="text" name="name" id="agent-name" required
                     class="w-full bg-gim-neutral-50 border-2 border-gim-neutral-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-gim-orange-400 transition-colors"
                     placeholder="Ej: Soporte General">
            </div>
            <div>
              <label class="block text-sm font-semibold text-gim-neutral-700 mb-2">Tipo</label>
              <select name="type" id="agent-type" class="w-full bg-gim-neutral-50 border-2 border-gim-neutral-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-gim-orange-400 transition-colors">
                <option value="general">General</option>
                <option value="ventas">Ventas</option>
                <option value="soporte">Soporte</option>
                <option value="reservas">Reservas</option>
              </select>
            </div>
            <div>
              <label class="block text-sm font-semibold text-gim-neutral-700 mb-2">Modelo</label>
              <select name="model" id="agent-model" class="w-full bg-gim-neutral-50 border-2 border-gim-neutral-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-gim-orange-400 transition-colors">
                <option value="@cf/meta/llama-3.1-8b-instruct-fp8">Llama 3.1 8B</option>
                <option value="@cf/meta/llama-3.2-3b-instruct">Llama 3.2 3B (R├ípido)</option>
                <option value="@cf/meta/llama-3.3-70b-instruct-fp8-fast">Llama 3.3 70B (Mejor)</option>
              </select>
            </div>
            <div>
              <label class="block text-sm font-semibold text-gim-neutral-700 mb-2">Temperatura</label>
              <input type="number" name="temperature" id="agent-temperature" step="0.1" min="0" max="1" value="0.7"
                     class="w-full bg-gim-neutral-50 border-2 border-gim-neutral-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-gim-orange-400 transition-colors">
            </div>
          </div>
          
          <div class="mb-6">
            <label class="block text-sm font-semibold text-gim-neutral-700 mb-2">Descripci├│n</label>
            <input type="text" name="description" id="agent-description"
                   class="w-full bg-gim-neutral-50 border-2 border-gim-neutral-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-gim-orange-400 transition-colors"
                   placeholder="Breve descripci├│n del agente">
          </div>
          
          <div class="mb-6">
            <label class="block text-sm font-semibold text-gim-neutral-700 mb-2">System Prompt</label>
            <textarea name="system_prompt" id="agent-system-prompt" rows="5" required
                      class="w-full bg-gim-neutral-50 border-2 border-gim-neutral-200 rounded-xl px-4 py-3 text-sm font-mono focus:outline-none focus:border-gim-orange-400 transition-colors"
                      placeholder="Instrucciones del agente..."></textarea>
          </div>
          
          <div class="flex gap-3">
            <button type="submit" class="bg-gradient-orange rounded-xl px-6 py-3 font-semibold text-white hover:opacity-90 transition shadow-lg shadow-gim-orange-500/20">
              Guardar
            </button>
            <button type="button" onclick="hideAgentForm()" class="bg-gim-neutral-100 rounded-xl px-6 py-3 font-semibold hover:bg-gim-neutral-200 transition text-gim-neutral-700">
              Cancelar
            </button>
          </div>
        </form>
      </div>
      
      <!-- Agent cards -->
      <div id="agent-list" class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        ${agents.map((a: AgentRow) => `
          <div class="bg-white rounded-2xl p-6 border border-gim-neutral-200 card-hover shadow-sm">
            <div class="flex justify-between items-start mb-4">
              <div class="w-14 h-14 bg-gradient-orange rounded-xl flex items-center justify-center shadow-lg shadow-gim-orange-500/15">
                <svg class="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"/></svg>
              </div>
              <span class="px-3 py-1 rounded-full text-xs font-medium ${a.is_active ? 'bg-green-100 text-green-600' : 'bg-red-100 text-red-600'}">
                ${a.is_active ? 'Activo' : 'Inactivo'}
              </span>
            </div>
            
            <div class="font-semibold text-lg text-gim-neutral-900 mb-2">${a.name}</div>
            <div class="text-gim-neutral-500 text-sm mb-4">${a.description || 'Sin descripci├│n'}</div>
            
            <div class="space-y-3 mb-6">
              <div class="flex justify-between text-sm">
                <span class="text-gim-neutral-500">Tipo</span>
                <span class="px-3 py-1 rounded-full text-xs bg-gim-neutral-100 text-gim-neutral-600">${a.type}</span>
              </div>
              <div class="flex justify-between text-sm">
                <span class="text-gim-neutral-500">Modelo</span>
                <span class="text-xs font-mono text-gim-neutral-700">${a.model.split('/').pop()}</span>
              </div>
              <div class="flex justify-between text-sm">
                <span class="text-gim-neutral-500">Temperatura</span>
                <span class="text-gim-neutral-700">${a.temperature}</span>
              </div>
            </div>
            
            <!-- KB Link -->
            <div class="mb-4">
              <button onclick="showKBModal('${a.id}', '${a.name}')" class="w-full bg-gim-cyan-50 hover:bg-gim-cyan-100 border border-gim-cyan-200 rounded-xl py-2 text-sm font-semibold text-gim-cyan-600 transition">
                Base de Conocimiento
              </button>
            </div>
            
            <div class="flex gap-3">
              <button onclick="editAgent('${a.id}', '${a.name}', '${a.type}', '${a.model}', ${a.temperature}, '${(a.description || '').replace(/'/g, "\\'")}', \`${(a.system_prompt || '').replace(/`/g, '\\`')}\`)" class="flex-1 bg-gim-neutral-100 hover:bg-gim-neutral-200 rounded-xl py-2 text-sm font-medium transition text-gim-neutral-700">Editar</button>
              <button hx-delete="/admin/agents/${a.id}" hx-confirm="┬┐Eliminar este agente?" hx-target="#agent-list" hx-swap="innerHTML" class="bg-gim-neutral-100 hover:bg-red-100 rounded-xl py-2 px-4 text-sm transition text-gim-neutral-500 hover:text-red-500"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg></button>
            </div>
          </div>
        `).join('') || '<div class="col-span-3 text-gim-neutral-400 text-center py-12">No hay agentes configurados</div>'}
      </div>
      
      <!-- KB Modal -->
      <div id="kb-modal" class="hidden fixed inset-0 z-50 flex items-center justify-center">
        <div class="absolute inset-0 bg-black/40 backdrop-blur-sm" onclick="hideKBModal()"></div>
        <div class="relative bg-white rounded-2xl p-8 w-full max-w-2xl mx-4 shadow-2xl border border-gim-neutral-200 max-h-[80vh] overflow-y-auto">
          <div class="flex justify-between items-center mb-6">
            <div>
              <h3 class="text-xl font-bold text-gim-neutral-900">Base de Conocimiento</h3>
              <p id="kb-agent-name" class="text-sm text-gim-neutral-500"></p>
            </div>
            <button onclick="hideKBModal()" class="w-8 h-8 bg-gim-neutral-100 rounded-lg flex items-center justify-center hover:bg-gim-neutral-200 transition text-gim-neutral-500"><svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg></button>
          </div>
          
          <div id="kb-linked-list" class="mb-6">
            <div class="text-sm text-gim-neutral-400">Cargando documentos vinculados...</div>
          </div>
          
          <div class="border-t border-gim-neutral-100 pt-6">
            <h4 class="text-sm font-semibold text-gim-neutral-700 mb-3">Vincular documento existente</h4>
            <div id="kb-available-list" class="space-y-2">
              <div class="text-sm text-gim-neutral-400">Cargando documentos...</div>
            </div>
          </div>
          
          <div class="border-t border-gim-neutral-100 pt-6 mt-6">
            <h4 class="text-sm font-semibold text-gim-neutral-700 mb-3">Crear nuevo documento</h4>
            <form hx-post="/admin/agents/kb/link" hx-target="#kb-linked-list" hx-swap="innerHTML">
              <input type="hidden" name="agent_id" id="kb-modal-agent-id">
              <div class="grid grid-cols-2 gap-4 mb-4">
                <input type="text" name="title" placeholder="T├¡tulo" required
                       class="bg-gim-neutral-50 border-2 border-gim-neutral-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-gim-cyan-400 transition-colors">
                <input type="text" name="category" placeholder="Categor├¡a"
                       class="bg-gim-neutral-50 border-2 border-gim-neutral-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-gim-cyan-400 transition-colors">
              </div>
              <textarea name="content" rows="3" placeholder="Contenido del documento..." required
                        class="w-full bg-gim-neutral-50 border-2 border-gim-neutral-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-gim-cyan-400 transition-colors mb-4"></textarea>
              <button type="submit" class="bg-gradient-cyan rounded-xl px-5 py-2.5 font-semibold text-white text-sm hover:opacity-90 transition shadow-lg shadow-gim-cyan-500/20">
                Crear y Vincular
              </button>
            </form>
          </div>
        </div>
      </div>
      
      <script>
        function showCreateAgent() {
          document.getElementById('agent-form').classList.remove('hidden');
          document.getElementById('agent-form-title').textContent = 'Nuevo Agente';
          document.getElementById('agent-id').value = '';
          document.getElementById('agent-name').value = '';
          document.getElementById('agent-type').value = 'general';
          document.getElementById('agent-model').value = '@cf/meta/llama-3.1-8b-instruct-fp8';
          document.getElementById('agent-temperature').value = '0.7';
          document.getElementById('agent-description').value = '';
          document.getElementById('agent-system-prompt').value = '';
          document.getElementById('agent-form').scrollIntoView({ behavior: 'smooth' });
        }
        
        function editAgent(id, name, type, model, temperature, description, systemPrompt) {
          document.getElementById('agent-form').classList.remove('hidden');
          document.getElementById('agent-form-title').textContent = 'Editar Agente';
          document.getElementById('agent-id').value = id;
          document.getElementById('agent-name').value = name;
          document.getElementById('agent-type').value = type;
          document.getElementById('agent-model').value = model;
          document.getElementById('agent-temperature').value = temperature;
          document.getElementById('agent-description').value = description;
          document.getElementById('agent-system-prompt').value = systemPrompt;
          document.getElementById('agent-form').scrollIntoView({ behavior: 'smooth' });
        }
        
        function hideAgentForm() {
          document.getElementById('agent-form').classList.add('hidden');
        }
        
        async function showKBModal(agentId, agentName) {
          document.getElementById('kb-modal').classList.remove('hidden');
          document.getElementById('kb-modal-agent-id').value = agentId;
          document.getElementById('kb-agent-name').textContent = 'Agente: ' + agentName;
          
          // Load linked docs
          try {
            const res = await fetch('/admin/api/agents/' + agentId + '/kb');
            const linked = await res.json();
            const linkedHtml = linked.length > 0 ? linked.map(d =>
              '<div class="flex items-center justify-between p-3 bg-gim-cyan-50 rounded-xl border border-gim-cyan-200">' +
                '<div>' +
                  '<div class="font-semibold text-sm text-gim-neutral-900">' + d.title + '</div>' +
                  '<div class="text-xs text-gim-neutral-500">' + (d.category || 'Sin categor├¡a') + '</div>' +
                '</div>' +
                '<button hx-delete="/admin/agents/' + agentId + '/kb/' + d.id + '" hx-target="#kb-linked-list" hx-swap="innerHTML" hx-confirm="┬┐Desvincular documento?" class="text-red-500 hover:text-red-600 text-sm font-medium"><svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg></button>' +
              '</div>'
            ).join('') : '<div class="text-sm text-gim-neutral-400 text-center py-4">No hay documentos vinculados</div>';
            document.getElementById('kb-linked-list').innerHTML = linkedHtml;
            htmx.process(document.getElementById('kb-linked-list'));
          } catch (e) {
            document.getElementById('kb-linked-list').innerHTML = '<div class="text-sm text-gim-neutral-400">No hay documentos vinculados</div>';
          }
          
          // Load available docs
          try {
            const res = await fetch('/admin/api/kb');
            const allDocs = await res.json();
            const availHtml = allDocs.length > 0 ? allDocs.map(d =>
              '<div class="flex items-center justify-between p-3 bg-gim-neutral-50 rounded-xl border border-gim-neutral-200">' +
                '<div>' +
                  '<div class="font-semibold text-sm text-gim-neutral-900">' + d.title + '</div>' +
                  '<div class="text-xs text-gim-neutral-500">' + (d.category || 'Sin categor├¡a') + '</div>' +
                '</div>' +
                '<button hx-post="/admin/agents/' + agentId + '/kb/attach/' + d.id + '" hx-target="#kb-linked-list" hx-swap="innerHTML" class="bg-gim-cyan-500 hover:bg-gim-cyan-600 text-white text-xs font-semibold px-3 py-1.5 rounded-lg transition">Vincular</button>' +
              '</div>'
            ).join('') : '<div class="text-sm text-gim-neutral-400 text-center py-4">No hay documentos disponibles</div>';
            document.getElementById('kb-available-list').innerHTML = availHtml;
            htmx.process(document.getElementById('kb-available-list'));
          } catch (e) {
            document.getElementById('kb-available-list').innerHTML = '<div class="text-sm text-gim-neutral-400">No hay documentos disponibles</div>';
          }
        }
        
        function hideKBModal() {
          document.getElementById('kb-modal').classList.add('hidden');
        }
      </script>
    </div>
  `);
});

  

admin.get('/api/agents', async (c) => {
  try {
    const { results } = await c.env.DB.prepare(
      'SELECT * FROM agents WHERE tenant_id = ? ORDER BY created_at DESC'
    ).bind(tId(c)).all();
    return c.json(results || []);
  } catch (e) { return c.json([]); }
});

  

// --- Agent CRUD + KB Linking ---

admin.post('/agents/save', async (c) => {
  const form = await c.req.formData();
  const id = form.get('id') as string;
  const name = form.get('name') as string;
  const type = form.get('type') as string;
  const model = form.get('model') as string;
  const temperature = parseFloat(form.get('temperature') as string) || 0.7;
  const description = form.get('description') as string;
  const systemPrompt = form.get('system_prompt') as string;

  try {
    if (id) {
      await c.env.DB.prepare(
        `UPDATE agents SET name=?, type=?, model=?, temperature=?, description=?, system_prompt=?, updated_at=datetime('now') WHERE id=? AND tenant_id = ?`
      ).bind(name, type, model, temperature, description, systemPrompt, id, tId(c)).run();
    } else {
      const newId = crypto.randomUUID();
      await c.env.DB.prepare(
        `INSERT INTO agents (id, name, type, model, temperature, description, system_prompt, is_active, tenant_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)`
      ).bind(newId, name, type, model, temperature, description, systemPrompt, tId(c)).run();
    }
  } catch (e) {
    console.error('Error saving agent:', e);
  }

  const agents = (await c.env.DB.prepare('SELECT * FROM agents WHERE tenant_id = ? ORDER BY created_at DESC').bind(tId(c)).all<AgentRow>()).results || [];
  let html = agents.map((a: AgentRow) => `
    <div class="bg-white rounded-2xl p-6 border border-gim-neutral-200 card-hover shadow-sm">
      <div class="flex justify-between items-start mb-4">
        <div class="w-14 h-14 bg-gradient-orange rounded-xl flex items-center justify-center shadow-lg shadow-gim-orange-500/15">
          <svg class="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"/></svg>
        </div>
        <span class="px-3 py-1 rounded-full text-xs font-medium ${a.is_active ? 'bg-green-100 text-green-600' : 'bg-red-100 text-red-600'}">
          ${a.is_active ? 'Activo' : 'Inactivo'}
        </span>
      </div>
      <div class="font-semibold text-lg text-gim-neutral-900 mb-2">${a.name}</div>
      <div class="text-gim-neutral-500 text-sm mb-4">${a.description || 'Sin descripci├│n'}</div>
      <div class="space-y-3 mb-6">
        <div class="flex justify-between text-sm">
          <span class="text-gim-neutral-500">Tipo</span>
          <span class="px-3 py-1 rounded-full text-xs bg-gim-neutral-100 text-gim-neutral-600">${a.type}</span>
        </div>
        <div class="flex justify-between text-sm">
          <span class="text-gim-neutral-500">Modelo</span>
          <span class="text-xs font-mono text-gim-neutral-700">${a.model.split('/').pop()}</span>
        </div>
        <div class="flex justify-between text-sm">
          <span class="text-gim-neutral-500">Temperatura</span>
          <span class="text-gim-neutral-700">${a.temperature}</span>
        </div>
      </div>
      <div class="mb-4">
        <button onclick="showKBModal('${a.id}', '${a.name}')" class="w-full bg-gim-cyan-50 hover:bg-gim-cyan-100 border border-gim-cyan-200 rounded-xl py-2 text-sm font-semibold text-gim-cyan-600 transition">
          Base de Conocimiento
        </button>
      </div>
      <div class="flex gap-3">
        <button onclick="editAgent('${a.id}', '${a.name}', '${a.type}', '${a.model}', ${a.temperature}, '${(a.description || '').replace(/'/g, "\\'")}', \`${(a.system_prompt || '').replace(/`/g, '\\`')}\`)" class="flex-1 bg-gim-neutral-100 hover:bg-gim-neutral-200 rounded-xl py-2 text-sm font-medium transition text-gim-neutral-700">Editar</button>
        <button hx-delete="/admin/agents/${a.id}" hx-confirm="┬┐Eliminar este agente?" hx-target="#agent-list" hx-swap="innerHTML" class="bg-gim-neutral-100 hover:bg-red-100 rounded-xl py-2 px-4 text-sm transition text-gim-neutral-500 hover:text-red-500"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg></button>
      </div>
    </div>
  `).join('');
  if (!html) html = '<div class="col-span-3 text-gim-neutral-400 text-center py-12">No hay agentes configurados</div>';

  c.header('Content-Type', 'text/html');
  return c.body(html);
});

  

admin.delete('/agents/:id', async (c) => {
  const id = c.req.param('id');
  try {
    await c.env.DB.prepare('DELETE FROM agents WHERE id=? AND tenant_id = ?').bind(id, tId(c)).run();
  } catch (e) { /* ignore */ }
  
  const agents = (await c.env.DB.prepare('SELECT * FROM agents WHERE tenant_id = ? ORDER BY created_at DESC').bind(tId(c)).all<AgentRow>()).results || [];
  let html = agents.map((a: AgentRow) => `
    <div class="bg-white rounded-2xl p-6 border border-gim-neutral-200 card-hover shadow-sm">
      <div class="flex justify-between items-start mb-4">
        <div class="w-14 h-14 bg-gradient-orange rounded-xl flex items-center justify-center shadow-lg shadow-gim-orange-500/15">
          <svg class="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"/></svg>
        </div>
        <span class="px-3 py-1 rounded-full text-xs font-medium ${a.is_active ? 'bg-green-100 text-green-600' : 'bg-red-100 text-red-600'}">
          ${a.is_active ? 'Activo' : 'Inactivo'}
        </span>
      </div>
      <div class="font-semibold text-lg text-gim-neutral-900 mb-2">${a.name}</div>
      <div class="text-gim-neutral-500 text-sm mb-4">${a.description || 'Sin descripci├│n'}</div>
      <div class="space-y-3 mb-6">
        <div class="flex justify-between text-sm">
          <span class="text-gim-neutral-500">Tipo</span>
          <span class="px-3 py-1 rounded-full text-xs bg-gim-neutral-100 text-gim-neutral-600">${a.type}</span>
        </div>
        <div class="flex justify-between text-sm">
          <span class="text-gim-neutral-500">Modelo</span>
          <span class="text-xs font-mono text-gim-neutral-700">${a.model.split('/').pop()}</span>
        </div>
        <div class="flex justify-between text-sm">
          <span class="text-gim-neutral-500">Temperatura</span>
          <span class="text-gim-neutral-700">${a.temperature}</span>
        </div>
      </div>
      <div class="mb-4">
        <button onclick="showKBModal('${a.id}', '${a.name}')" class="w-full bg-gim-cyan-50 hover:bg-gim-cyan-100 border border-gim-cyan-200 rounded-xl py-2 text-sm font-semibold text-gim-cyan-600 transition">
          Base de Conocimiento
        </button>
      </div>
      <div class="flex gap-3">
        <button onclick="editAgent('${a.id}', '${a.name}', '${a.type}', '${a.model}', ${a.temperature}, '${(a.description || '').replace(/'/g, "\\'")}', \`${(a.system_prompt || '').replace(/`/g, '\\`')}\`)" class="flex-1 bg-gim-neutral-100 hover:bg-gim-neutral-200 rounded-xl py-2 text-sm font-medium transition text-gim-neutral-700">Editar</button>
        <button hx-delete="/admin/agents/${a.id}" hx-confirm="┬┐Eliminar este agente?" hx-target="#agent-list" hx-swap="innerHTML" class="bg-gim-neutral-100 hover:bg-red-100 rounded-xl py-2 px-4 text-sm transition text-gim-neutral-500 hover:text-red-500"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg></button>
      </div>
    </div>
  `).join('');
  if (!html) html = '<div class="col-span-3 text-gim-neutral-400 text-center py-12">No hay agentes configurados</div>';

  c.header('Content-Type', 'text/html');
  return c.body(html);
});

  

admin.get('/api/agents/:id/kb', async (c) => {
  const agentId = c.req.param('id');
  try {
    const result = await c.env.DB.prepare(`
      SELECT kb.* FROM knowledge_base kb
      JOIN agent_knowledge ak ON kb.id = ak.kb_id
      WHERE ak.agent_id = ? AND kb.tenant_id = ?
    `).bind(agentId, tId(c)).all<KnowledgeRow>();
    return c.json(result.results || []);
  } catch (e) {
    return c.json([]);
  }
});

  

admin.post('/agents/:id/kb/attach/:kbId', async (c) => {
  const agentId = c.req.param('id');
  const kbId = c.req.param('kbId');
  // Verify the agent belongs to the current tenant before linking
  const agent = await c.env.DB.prepare('SELECT id FROM agents WHERE id = ? AND tenant_id = ?').bind(agentId, tId(c)).first();
  if (!agent) {
    c.header('Content-Type', 'text/html');
    return c.body('<div class="text-sm text-red-500 text-center py-4">Acceso denegado: el agente no pertenece a este tenant.</div>', 403);
  }
  try {
    await c.env.DB.prepare(
      `INSERT OR IGNORE INTO agent_knowledge (agent_id, kb_id) VALUES (?, ?)`
    ).bind(agentId, kbId).run();
  } catch (e) {
    // Table may not exist yet ÔÇö create it
    try {
      await c.env.DB.prepare(`CREATE TABLE IF NOT EXISTS agent_knowledge (
        agent_id TEXT NOT NULL, kb_id TEXT NOT NULL,
        PRIMARY KEY (agent_id, kb_id)
      )`).run();
      await c.env.DB.prepare(
        `INSERT OR IGNORE INTO agent_knowledge (agent_id, kb_id) VALUES (?, ?)`
      ).bind(agentId, kbId).run();
    } catch (e2) { console.error('KB attach error:', e2); }
  }

  // Return updated linked list
  try {
    const result = await c.env.DB.prepare(`
      SELECT kb.* FROM knowledge_base kb
      JOIN agent_knowledge ak ON kb.id = ak.kb_id
      WHERE ak.agent_id = ? AND kb.tenant_id = ?
    `).bind(agentId, tId(c)).all<KnowledgeRow>();
    const linked = result.results || [];
    const html = linked.length > 0 ? linked.map((d: KnowledgeRow) =>
      `<div class="flex items-center justify-between p-3 bg-gim-cyan-50 rounded-xl border border-gim-cyan-200">
        <div><div class="font-semibold text-sm text-gim-neutral-900">${d.title}</div><div class="text-xs text-gim-neutral-500">${d.category || 'Sin categor├¡a'}</div></div>
        <button hx-delete="/admin/agents/${agentId}/kb/${d.id}" hx-target="#kb-linked-list" hx-swap="innerHTML" hx-confirm="┬┐Desvincular?" class="text-red-500 hover:text-red-600 text-sm font-medium"><svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg></button>
      </div>`
    ).join('') : '<div class="text-sm text-gim-neutral-400 text-center py-4">No hay documentos vinculados</div>';
    c.header('Content-Type', 'text/html');
    return c.body(html);
  } catch (e) {
    c.header('Content-Type', 'text/html');
    return c.body('<div class="text-sm text-gim-neutral-400 text-center py-4">No hay documentos vinculados</div>');
  }
});

  

admin.delete('/agents/:agentId/kb/:kbId', async (c) => {
  const agentId = c.req.param('agentId');
  const kbId = c.req.param('kbId');
  // Verify the agent belongs to the current tenant before unlinking
  const agent = await c.env.DB.prepare('SELECT id FROM agents WHERE id = ? AND tenant_id = ?').bind(agentId, tId(c)).first();
  if (!agent) {
    c.header('Content-Type', 'text/html');
    return c.body('<div class="text-sm text-red-500 text-center py-4">Acceso denegado: el agente no pertenece a este tenant.</div>', 403);
  }
  try {
    await c.env.DB.prepare('DELETE FROM agent_knowledge WHERE agent_id=? AND kb_id=?').bind(agentId, kbId).run();
  } catch (e) { /* ignore */ }

  try {
    const result = await c.env.DB.prepare(`
      SELECT kb.* FROM knowledge_base kb
      JOIN agent_knowledge ak ON kb.id = ak.kb_id
      WHERE ak.agent_id = ? AND kb.tenant_id = ?
    `).bind(agentId, tId(c)).all<KnowledgeRow>();
    const linked = result.results || [];
    const html = linked.length > 0 ? linked.map((d: KnowledgeRow) =>
      `<div class="flex items-center justify-between p-3 bg-gim-cyan-50 rounded-xl border border-gim-cyan-200">
        <div><div class="font-semibold text-sm text-gim-neutral-900">${d.title}</div><div class="text-xs text-gim-neutral-500">${d.category || 'Sin categor├¡a'}</div></div>
        <button hx-delete="/admin/agents/${agentId}/kb/${d.id}" hx-target="#kb-linked-list" hx-swap="innerHTML" hx-confirm="┬┐Desvincular?" class="text-red-500 hover:text-red-600 text-sm font-medium"><svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg></button>
      </div>`
    ).join('') : '<div class="text-sm text-gim-neutral-400 text-center py-4">No hay documentos vinculados</div>';
    c.header('Content-Type', 'text/html');
    return c.body(html);
  } catch (e) {
    c.header('Content-Type', 'text/html');
    return c.body('<div class="text-sm text-gim-neutral-400 text-center py-4">No hay documentos vinculados</div>');
  }
});

  

admin.post('/agents/kb/link', async (c) => {
  const form = await c.req.formData();
  const agentId = form.get('agent_id') as string;
  const title = form.get('title') as string;
  const category = form.get('category') as string;
  const content = form.get('content') as string;

  // Verify the agent belongs to the current tenant before linking
  const agent = await c.env.DB.prepare('SELECT id FROM agents WHERE id = ? AND tenant_id = ?').bind(agentId, tId(c)).first();
  if (!agent) {
    c.header('Content-Type', 'text/html');
    return c.body('<div class="text-sm text-red-500 text-center py-4">Acceso denegado: el agente no pertenece a este tenant.</div>', 403);
  }

  try {
    const kbId = crypto.randomUUID();
    await c.env.DB.prepare(
      `INSERT INTO knowledge_base (id, title, content, category, tenant_id) VALUES (?, ?, ?, ?, ?)`
    ).bind(kbId, title, content, category || null, tId(c)).run();

    try {
      await c.env.DB.prepare(
        `INSERT OR IGNORE INTO agent_knowledge (agent_id, kb_id) VALUES (?, ?)`
      ).bind(agentId, kbId).run();
    } catch (e) {
      await c.env.DB.prepare(`CREATE TABLE IF NOT EXISTS agent_knowledge (
        agent_id TEXT NOT NULL, kb_id TEXT NOT NULL,
        PRIMARY KEY (agent_id, kb_id)
      )`).run();
      await c.env.DB.prepare(
        `INSERT OR IGNORE INTO agent_knowledge (agent_id, kb_id) VALUES (?, ?)`
      ).bind(agentId, kbId).run();
    }
  } catch (e) {
    console.error('KB link error:', e);
  }

  // Return updated linked list
  try {
    const result = await c.env.DB.prepare(`
      SELECT kb.* FROM knowledge_base kb
      JOIN agent_knowledge ak ON kb.id = ak.kb_id
      WHERE ak.agent_id = ? AND kb.tenant_id = ?
    `).bind(agentId, tId(c)).all<KnowledgeRow>();
    const linked = result.results || [];
    const html = linked.length > 0 ? linked.map((d: KnowledgeRow) =>
      `<div class="flex items-center justify-between p-3 bg-gim-cyan-50 rounded-xl border border-gim-cyan-200">
        <div><div class="font-semibold text-sm text-gim-neutral-900">${d.title}</div><div class="text-xs text-gim-neutral-500">${d.category || 'Sin categor├¡a'}</div></div>
        <button hx-delete="/admin/agents/${agentId}/kb/${d.id}" hx-target="#kb-linked-list" hx-swap="innerHTML" hx-confirm="┬┐Desvincular?" class="text-red-500 hover:text-red-600 text-sm font-medium"><svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg></button>
      </div>`
    ).join('') : '<div class="text-sm text-gim-neutral-400 text-center py-4">No hay documentos vinculados</div>';
    c.header('Content-Type', 'text/html');
    return c.body(html);
  } catch (e) {
    c.header('Content-Type', 'text/html');
    return c.body('<div class="text-sm text-gim-neutral-400 text-center py-4">Error al cargar</div>');
  }
});
}
