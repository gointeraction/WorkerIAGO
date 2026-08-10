import { Hono } from 'hono';
import { html } from 'hono/html';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { Bindings, tId, renderPage, auditLog, getSessionSecret, signSession, verifySession, issueCsrfToken, verifyCsrf, tInfo, layout, SESSION_SECRET, AgentRow, ConversationRow, KnowledgeRow, LeadRow, MessageRow, TicketRow, UsageRow } from '../utils';

export function registerKnowledgeRoutes(admin: Hono<{ Bindings: Bindings }>) {
  

admin.get('/api/kb', async (c) => {
  try {
    const { results } = await c.env.DB.prepare(
      'SELECT * FROM knowledge_base WHERE tenant_id = ? ORDER BY updated_at DESC'
    ).bind(tId(c)).all();
    return c.json(results || []);
  } catch (e) { return c.json([]); }
});

  

admin.post('/kb/save', async (c) => {
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
    `INSERT OR REPLACE INTO knowledge_base (id, title, content, category, tags, tenant_id, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`
  ).bind(id, title, content, category, JSON.stringify(tags), tId(c)).run();
  
  await auditLog(c, 'create', 'knowledge_base', id, { title });
  return c.redirect('/admin/kb');
});

  

admin.delete('/kb/:id', async (c) => {
  const id = c.req.param('id');
  try {
    const { deleteDocument } = await import('../../knowledge');
    await deleteDocument({ DB: c.env.DB, VECTORIZE: c.env.VECTORIZE!, STORAGE: c.env.STORAGE, AI: c.env.AI }, id);
  } catch (e) { /* ignore */ }

  const docs = (await c.env.DB.prepare('SELECT * FROM knowledge_base WHERE tenant_id = ? ORDER BY updated_at DESC').bind(tId(c)).all<KnowledgeRow>()).results || [];
  const html = docs.map((d: KnowledgeRow) => `
    <div class="bg-white rounded-2xl p-6 border border-gim-neutral-200 card-hover shadow-sm">
      <div class="flex justify-between items-start mb-4">
        <div class="w-10 h-10 bg-gradient-cyan rounded-lg flex items-center justify-center">
          <svg class="w-5 h-5 text-gim-neutral-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>
        </div>
        <div class="flex gap-2">
          <button onclick="editDocument('${d.id}', '${d.title}', '${d.category || ''}', '${(d.content || '').replace(/'/g, "\\'")}')"
                  class="w-8 h-8 bg-gim-neutral-100 rounded-lg flex items-center justify-center hover:bg-gim-neutral-200 transition text-gim-neutral-500"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg></button>
          <button hx-delete="/admin/kb/${d.id}"
                  hx-confirm="¿Eliminar este documento?"
                  hx-target="#kb-list"
                  class="w-8 h-8 bg-gim-neutral-100 rounded-lg flex items-center justify-center hover:bg-red-100 transition text-gim-neutral-500 hover:text-red-500"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg></button>
        </div>
      </div>
      <div class="font-semibold text-gim-neutral-900 mb-2">${d.title}</div>
      <div class="text-sm text-gim-neutral-500 mb-4 line-clamp-2">${(d.content || '').substring(0, 150)}...</div>
      <div class="flex gap-2">
        <span class="px-3 py-1 rounded-full text-xs bg-gim-neutral-100 text-gim-neutral-600">${d.category || 'Sin categoría'}</span>
        <span class="text-xs text-gim-neutral-400">${d.view_count || 0} vistas</span>
      </div>
    </div>
  `).join('') || '<div class="col-span-3 text-gim-neutral-400 text-center py-12">No hay documentos. ¡Crea el primero!</div>';

  return c.html(html);
});

  

// ═══════════════════════════════════════════════════════════════════════════════
// KNOWLEDGE BASE — RAG Management
// ═══════════════════════════════════════════════════════════════════════════════

admin.get('/knowledge', async (c) => {
  let docs: any[] = [];
  let agents: any[] = [];
  try {
    docs = (await c.env.DB.prepare('SELECT * FROM knowledge_base WHERE tenant_id = ? ORDER BY updated_at DESC').bind(tId(c)).all()).results || [];
  } catch (e) { docs = []; }
  try {
    agents = (await c.env.DB.prepare('SELECT id, name FROM agents WHERE tenant_id = ? ORDER BY name').bind(tId(c)).all()).results || [];
  } catch (e) { agents = []; }

  return renderPage(c, 'Knowledge Base', 'knowledge', `
    <div class="fade-in">
      <div class="flex justify-between items-center mb-8">
        <div>
          <h1 class="text-4xl font-extrabold mb-2"><span class="text-gradient-cyan">Knowledge Base</span></h1>
          <p class="text-gim-neutral-500">${docs.length} documentos indexados para RAG</p>
        </div>
        <button onclick="showUploadModal()" class="bg-gradient-cyan rounded-xl px-6 py-3 font-semibold text-white hover:opacity-90 transition shadow-lg shadow-gim-cyan-500/20">
          + Subir Documento
        </button>
      </div>

      <!-- Search -->
      <div class="mb-8">
        <div class="flex gap-4">
          <input type="text" id="kb-search-input" placeholder="Buscar en la base de conocimiento..."
                 class="flex-1 bg-white border-2 border-gim-neutral-200 rounded-xl px-5 py-3 text-sm focus:outline-none focus:border-gim-cyan-400 transition-colors"
                 onkeyup="if(event.key==='Enter')searchKB()">
          <button onclick="searchKB()" class="bg-gim-cyan-500 hover:bg-gim-cyan-600 text-white rounded-xl px-6 py-3 font-semibold transition">Buscar</button>
        </div>
        <div id="kb-search-results" class="hidden mt-4 bg-white rounded-2xl border border-gim-neutral-200 p-6 shadow-sm">
          <h3 class="text-sm font-semibold text-gim-neutral-700 mb-3">Resultados de búsqueda semántica</h3>
          <div id="kb-search-list"></div>
        </div>
      </div>

      <!-- Documents Grid -->
      <div id="kb-docs-grid" class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        ${docs.map((d: any) => `
          <div class="bg-white rounded-2xl p-6 border border-gim-neutral-200 card-hover shadow-sm">
            <div class="flex justify-between items-start mb-4">
              <div class="w-12 h-12 bg-gradient-cyan rounded-xl flex items-center justify-center shadow-lg shadow-gim-cyan-500/15">
                <svg class="w-5 h-5 text-gim-neutral-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>
              </div>
              <span class="px-3 py-1 rounded-full text-xs font-medium ${d.is_published ? 'bg-green-100 text-green-600' : 'bg-gim-neutral-100 text-gim-neutral-500'}">
                ${d.is_published ? 'Publicado' : 'Borrador'}
              </span>
            </div>
            <div class="font-semibold text-gim-neutral-900 mb-1">${d.title}</div>
            <div class="text-gim-neutral-500 text-sm mb-3">${d.description || d.content_preview?.slice(0, 100) || 'Sin contenido'}</div>
            <div class="flex items-center gap-2 mb-4">
              <span class="px-2 py-0.5 rounded-full text-xs bg-gim-cyan-50 text-gim-cyan-600">${d.category || 'general'}</span>
              <span class="text-xs text-gim-neutral-400">${d.chunk_count || 0} chunks</span>
              ${d.source_type === 'file' ? '<span class="text-xs text-gim-neutral-400"><svg class="w-4 h-4 inline" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"/></svg> Archivo</span>' : ''}
              ${d.source_type === 'url' ? '<span class="text-xs text-gim-neutral-400"><svg class="w-4 h-4 inline" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"/></svg> URL</span>' : ''}
            </div>
            <div class="flex gap-2">
              <button onclick="viewKBDoc('${d.id}')" class="flex-1 bg-gim-neutral-100 hover:bg-gim-neutral-200 rounded-xl py-2 text-sm font-medium transition text-gim-neutral-700"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/></svg> Ver</button>
              <button onclick="reindexKBDoc('${d.id}')" class="bg-gim-cyan-50 hover:bg-gim-cyan-100 rounded-xl py-2 px-3 text-sm transition text-gim-cyan-600" title="Re-indexar"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M4 4v5h-.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg></button>
              <button onclick="deleteKBDoc('${d.id}')" class="bg-gim-neutral-100 hover:bg-red-100 rounded-xl py-2 px-3 text-sm transition text-gim-neutral-500 hover:text-red-500" title="Eliminar"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg></button>
            </div>
          </div>
        `).join('') || '<div class="col-span-3 text-gim-neutral-400 text-center py-12">No hay documentos. Sube tu primer documento para empezar con RAG.</div>'}
      </div>

      <!-- Upload Modal -->
      <div id="upload-modal" class="hidden fixed inset-0 z-50 flex items-center justify-center">
        <div class="absolute inset-0 bg-black/40 backdrop-blur-sm" onclick="hideUploadModal()"></div>
        <div class="relative bg-white rounded-2xl p-8 w-full max-w-xl mx-4 shadow-2xl border border-gim-neutral-200">
          <div class="flex justify-between items-center mb-6">
            <h3 class="text-xl font-bold text-gim-neutral-900">Subir Documento</h3>
            <button onclick="hideUploadModal()" class="w-8 h-8 bg-gim-neutral-100 rounded-lg flex items-center justify-center hover:bg-gim-neutral-200 transition text-gim-neutral-500"><svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg></button>
          </div>

          <div class="flex gap-2 mb-6">
            <button onclick="showTab('upload-file')" id="tab-file" class="flex-1 py-2 text-sm font-semibold rounded-xl bg-gim-cyan-500 text-white transition"><svg class="w-4 h-4 inline" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"/></svg> Archivo</button>
            <button onclick="showTab('upload-url')" id="tab-url" class="flex-1 py-2 text-sm font-semibold rounded-xl bg-gim-neutral-100 text-gim-neutral-600 transition"><svg class="w-4 h-4 inline" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"/></svg> URL</button>
            <button onclick="showTab('upload-text')" id="tab-text" class="flex-1 py-2 text-sm font-semibold rounded-xl bg-gim-neutral-100 text-gim-neutral-600 transition"><svg class="w-4 h-4 inline" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg> Texto</button>
          </div>

          <!-- File Upload -->
          <div id="upload-file" class="upload-tab">
            <form hx-post="/admin/knowledge/upload" hx-target="#kb-docs-grid" hx-swap="innerHTML" enctype="multipart/form-data">
              <div class="mb-4">
                <label class="block text-sm font-semibold text-gim-neutral-700 mb-2">Título</label>
                <input type="text" name="title" required class="w-full bg-gim-neutral-50 border-2 border-gim-neutral-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-gim-cyan-400 transition-colors" placeholder="Nombre del documento">
              </div>
              <div class="mb-4">
                <label class="block text-sm font-semibold text-gim-neutral-700 mb-2">Categoría</label>
                <input type="text" name="category" class="w-full bg-gim-neutral-50 border-2 border-gim-neutral-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-gim-cyan-400 transition-colors" placeholder="ej: productos, FAQ, políticas">
              </div>
              <div class="mb-4">
                <label class="block text-sm font-semibold text-gim-neutral-700 mb-2">Archivo</label>
                <input type="file" name="file" accept=".txt,.md,.html,.csv,.json" required
                       class="w-full bg-gim-neutral-50 border-2 border-dashed border-gim-neutral-300 rounded-xl px-4 py-6 text-sm text-center cursor-pointer hover:border-gim-cyan-400 transition-colors">
                <p class="text-xs text-gim-neutral-400 mt-2">TXT, MD, HTML, CSV, JSON (max 5MB)</p>
              </div>
              <button type="submit" class="w-full bg-gradient-cyan rounded-xl py-3 font-semibold text-white hover:opacity-90 transition">Subir y Procesar</button>
            </form>
          </div>

          <!-- URL Import -->
          <div id="upload-url" class="upload-tab hidden">
            <form hx-post="/admin/knowledge/import-url" hx-target="#kb-docs-grid" hx-swap="innerHTML">
              <div class="mb-4">
                <label class="block text-sm font-semibold text-gim-neutral-700 mb-2">Título</label>
                <input type="text" name="title" required class="w-full bg-gim-neutral-50 border-2 border-gim-neutral-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-gim-cyan-400 transition-colors">
              </div>
              <div class="mb-4">
                <label class="block text-sm font-semibold text-gim-neutral-700 mb-2">URL</label>
                <input type="url" name="url" required class="w-full bg-gim-neutral-50 border-2 border-gim-neutral-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-gim-cyan-400 transition-colors" placeholder="https://...">
              </div>
              <div class="mb-4">
                <label class="block text-sm font-semibold text-gim-neutral-700 mb-2">Categoría</label>
                <input type="text" name="category" class="w-full bg-gim-neutral-50 border-2 border-gim-neutral-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-gim-cyan-400 transition-colors">
              </div>
              <button type="submit" class="w-full bg-gradient-cyan rounded-xl py-3 font-semibold text-white hover:opacity-90 transition">Importar y Procesar</button>
            </form>
          </div>

          <!-- Text Input -->
          <div id="upload-text" class="upload-tab hidden">
            <form hx-post="/admin/knowledge/save-text" hx-target="#kb-docs-grid" hx-swap="innerHTML">
              <div class="mb-4">
                <label class="block text-sm font-semibold text-gim-neutral-700 mb-2">Título</label>
                <input type="text" name="title" required class="w-full bg-gim-neutral-50 border-2 border-gim-neutral-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-gim-cyan-400 transition-colors">
              </div>
              <div class="mb-4">
                <label class="block text-sm font-semibold text-gim-neutral-700 mb-2">Categoría</label>
                <input type="text" name="category" class="w-full bg-gim-neutral-50 border-2 border-gim-neutral-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-gim-cyan-400 transition-colors">
              </div>
              <div class="mb-4">
                <label class="block text-sm font-semibold text-gim-neutral-700 mb-2">Contenido</label>
                <textarea name="content" rows="8" required class="w-full bg-gim-neutral-50 border-2 border-gim-neutral-200 rounded-xl px-4 py-3 text-sm font-mono focus:outline-none focus:border-gim-cyan-400 transition-colors" placeholder="Pega o escribe el contenido aquí..."></textarea>
              </div>
              <button type="submit" class="w-full bg-gradient-cyan rounded-xl py-3 font-semibold text-white hover:opacity-90 transition">Guardar y Procesar</button>
            </form>
          </div>
        </div>
      </div>

      <!-- View Doc Modal -->
      <div id="view-doc-modal" class="hidden fixed inset-0 z-50 flex items-center justify-center">
        <div class="absolute inset-0 bg-black/40 backdrop-blur-sm" onclick="hideViewDocModal()"></div>
        <div class="relative bg-white rounded-2xl p-8 w-full max-w-2xl mx-4 shadow-2xl border border-gim-neutral-200 max-h-[80vh] overflow-y-auto">
          <div class="flex justify-between items-center mb-6">
            <h3 id="view-doc-title" class="text-xl font-bold text-gim-neutral-900"></h3>
            <button onclick="hideViewDocModal()" class="w-8 h-8 bg-gim-neutral-100 rounded-lg flex items-center justify-center hover:bg-gim-neutral-200 transition text-gim-neutral-500"><svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg></button>
          </div>
          <div id="view-doc-content" class="text-sm text-gim-neutral-700 whitespace-pre-wrap font-mono bg-gim-neutral-50 rounded-xl p-6"></div>
        </div>
      </div>

      <script>
        function showUploadModal() { document.getElementById('upload-modal').classList.remove('hidden'); }
        function hideUploadModal() { document.getElementById('upload-modal').classList.add('hidden'); }
        function hideViewDocModal() { document.getElementById('view-doc-modal').classList.add('hidden'); }

        function showTab(tab) {
          document.querySelectorAll('.upload-tab').forEach(el => el.classList.add('hidden'));
          document.getElementById(tab).classList.remove('hidden');
          ['upload-file','upload-url','upload-text'].forEach(t => {
            const btn = document.getElementById('tab-' + t.split('-')[1]);
            if (t === tab) { btn.className = 'flex-1 py-2 text-sm font-semibold rounded-xl bg-gim-cyan-500 text-white transition'; }
            else { btn.className = 'flex-1 py-2 text-sm font-semibold rounded-xl bg-gim-neutral-100 text-gim-neutral-600 transition'; }
          });
        }

        async function searchKB() {
          const q = document.getElementById('kb-search-input').value.trim();
          if (!q) return;
          const res = await fetch('/admin/api/knowledge/search?q=' + encodeURIComponent(q));
          const results = await res.json();
          document.getElementById('kb-search-results').classList.remove('hidden');
          document.getElementById('kb-search-list').innerHTML = results.length > 0
            ? results.map(r => '<div class="p-3 bg-gim-neutral-50 rounded-xl border border-gim-neutral-200 mb-2"><div class="flex justify-between mb-1"><span class="font-semibold text-sm text-gim-neutral-900">' + (r.title || 'Doc') + '</span><span class="text-xs text-gim-cyan-600">' + (r.score * 100).toFixed(0) + '% match</span></div><div class="text-xs text-gim-neutral-500">' + r.content.slice(0, 200) + '</div></div>').join('')
            : '<div class="text-sm text-gim-neutral-400 text-center py-4">No se encontraron resultados</div>';
        }

        async function viewKBDoc(id) {
          const res = await fetch('/admin/api/knowledge/' + id);
          const doc = await res.json();
          document.getElementById('view-doc-title').textContent = doc.title;
          document.getElementById('view-doc-content').textContent = doc.content_preview || doc.content || 'Sin contenido';
          document.getElementById('view-doc-modal').classList.remove('hidden');
        }

        async function reindexKBDoc(id) {
          if (!confirm('Re-indexar este documento?')) return;
          await fetch('/admin/api/knowledge/' + id + '/reindex', { method: 'POST' });
          location.reload();
        }

        async function deleteKBDoc(id) {
          if (!confirm('Eliminar este documento y todos sus chunks?')) return;
          await fetch('/admin/api/knowledge/' + id, { method: 'DELETE' });
          location.reload();
        }
      </script>
    </div>
  `);
});

  

// Knowledge API endpoints
admin.get('/api/knowledge/search', async (c) => {
  const q = c.req.query('q') || '';
  try {
    const { buildRagContext } = await import('../../knowledge');
    const results = [];
    // Simple search: find matching docs by title/content
    const docs = await c.env.DB.prepare(
      `SELECT id, title, category, content_preview FROM knowledge_base 
       WHERE (title LIKE ? OR content_preview LIKE ? OR category LIKE ?) AND tenant_id = ? LIMIT 10`
    ).bind(`%${q}%`, `%${q}%`, `%${q}%`, tId(c)).all();
    
    for (const doc of (docs.results || [])) {
      results.push({
        title: doc.title,
        content: doc.content_preview || '',
        score: 0.8,
        category: doc.category,
        id: doc.id,
      });
    }
    return c.json(results);
  } catch (e) {
    return c.json([]);
  }
});

  

admin.get('/api/knowledge/:id', async (c) => {
  const id = c.req.param('id');
  try {
    const doc = await c.env.DB.prepare('SELECT * FROM knowledge_base WHERE id = ? AND tenant_id = ?').bind(id, tId(c)).first<{ r2_key?: string; content?: string; content_preview?: string }>();
    if (doc?.r2_key && c.env.STORAGE) {
      const obj = await c.env.STORAGE.get(doc.r2_key);
      if (obj) {
        return c.json({ ...doc, content: await obj.text() });
      }
    }
    return c.json(doc || {});
  } catch (e) {
    return c.json({});
  }
});

  

admin.post('/knowledge/upload', async (c) => {
  const form = await c.req.formData();
  const title = form.get('title') as string;
  const category = form.get('category') as string || 'general';
  const file = form.get('file') as unknown as File;

  if (!file) return c.html('<div class="text-red-500">No file provided</div>');

  const kbId = crypto.randomUUID();
  const r2Key = `knowledge/${kbId}/${file.name}`;

  try {
    if (!c.env.STORAGE) throw new Error('STORAGE not configured');
    // Upload to R2
    await c.env.STORAGE.put(r2Key, file, {
      httpMetadata: { contentType: file.type },
    });

    // Create D1 record
    await c.env.DB.prepare(
      `INSERT INTO knowledge_base (id, title, category, source_type, r2_key, mime_type, file_size, tenant_id)
       VALUES (?, ?, ?, 'file', ?, ?, ?, ?)`
    ).bind(kbId, title, category, r2Key, file.type, file.size, tId(c)).run();

    // Process: extract text and generate embeddings
    const text = await file.text();
    const { processDocument } = await import('../../knowledge');
    await processDocument({ DB: c.env.DB, VECTORIZE: c.env.VECTORIZE!, STORAGE: c.env.STORAGE, AI: c.env.AI }, kbId, text);
  } catch (e: any) {
    console.error('Upload error:', e);
  }

  return c.redirect('/admin/knowledge');
});

  

admin.post('/knowledge/import-url', async (c) => {
  const form = await c.req.formData();
  const title = form.get('title') as string;
  const url = form.get('url') as string;
  const category = form.get('category') as string || 'general';

  const kbId = crypto.randomUUID();
  try {
    await c.env.DB.prepare(
      `INSERT INTO knowledge_base (id, title, category, source_type, source_url, tenant_id) VALUES (?, ?, ?, 'url', ?, ?)`
    ).bind(kbId, title, category, url, tId(c)).run();

    const { processUrl } = await import('../../knowledge');
    await processUrl({ DB: c.env.DB, VECTORIZE: c.env.VECTORIZE!, STORAGE: c.env.STORAGE, AI: c.env.AI }, kbId, url);
  } catch (e: any) {
    console.error('URL import error:', e);
  }

  return c.redirect('/admin/knowledge');
});

  

admin.post('/knowledge/save-text', async (c) => {
  const form = await c.req.formData();
  const title = form.get('title') as string;
  const category = form.get('category') as string || 'general';
  const content = form.get('content') as string;

  const kbId = crypto.randomUUID();
  try {
    await c.env.DB.prepare(
      `INSERT INTO knowledge_base (id, title, category, source_type, content_preview, tenant_id) VALUES (?, ?, ?, 'manual', ?, ?)`
    ).bind(kbId, title, category, content.slice(0, 500), tId(c)).run();

    const { processDocument } = await import('../../knowledge');
    await processDocument({ DB: c.env.DB, VECTORIZE: c.env.VECTORIZE!, STORAGE: c.env.STORAGE, AI: c.env.AI }, kbId, content);
  } catch (e: any) {
    console.error('Text save error:', e);
  }

  return c.redirect('/admin/knowledge');
});

  

admin.post('/api/knowledge/:id/reindex', async (c) => {
  const id = c.req.param('id');
  try {
    const doc = await c.env.DB.prepare('SELECT * FROM knowledge_base WHERE id = ? AND tenant_id = ?').bind(id, tId(c)).first() as any;
    if (!doc) return c.json({ error: 'Not found' }, 404);

    // Get content from R2 or preview
    let content = doc.content_preview || '';
    if (doc.r2_key && c.env.STORAGE) {
      const obj = await c.env.STORAGE.get(doc.r2_key);
      if (obj) content = await obj.text();
    }

    // Delete old chunks
    const oldChunks = await c.env.DB.prepare('SELECT id FROM knowledge_chunks WHERE kb_id = ?').bind(id).all();
    const oldIds = (oldChunks.results || []).map((c: any) => c.id);
    if (oldIds.length > 0) {
      await c.env.VECTORIZE!.deleteByIds(oldIds);
    }
    await c.env.DB.prepare('DELETE FROM knowledge_chunks WHERE kb_id = ?').bind(id).run();

    // Re-process
    const { processDocument } = await import('../../knowledge');
    const result = await processDocument({ DB: c.env.DB, VECTORIZE: c.env.VECTORIZE!, STORAGE: c.env.STORAGE, AI: c.env.AI }, id, content);

    return c.json({ ok: true, chunks: result.chunkCount, errors: result.errors });
  } catch (e: any) {
    return c.json({ error: e.message }, 500);
  }
});

  

admin.delete('/api/knowledge/:id', async (c) => {
  const id = c.req.param('id');
  try {
    const { deleteDocument } = await import('../../knowledge');
    await deleteDocument({ DB: c.env.DB, VECTORIZE: c.env.VECTORIZE!, STORAGE: c.env.STORAGE, AI: c.env.AI }, id);
  } catch (e) { /* ignore */ }
  return c.json({ ok: true });
});
}
