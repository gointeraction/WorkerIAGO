import { Hono } from 'hono';
import { html } from 'hono/html';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { Bindings, tId, renderPage, auditLog, getSessionSecret, signSession, verifySession, issueCsrfToken, verifyCsrf, tInfo, layout, SESSION_SECRET, AgentRow, ConversationRow, KnowledgeRow, LeadRow, MessageRow, TicketRow, UsageRow } from '../utils';

export function registerWorkflowsRoutes(admin: Hono<{ Bindings: Bindings }>) {
  

// ÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉ
// WORKFLOWS ÔÇö Multi-agent flow engine
// ÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉ

admin.get('/workflows', async (c) => {
  let workflows: any[] = [];
  try {
    workflows = (await c.env.DB.prepare('SELECT * FROM workflows WHERE tenant_id = ? ORDER BY created_at DESC').bind(tId(c)).all()).results || [];
  } catch (e) { workflows = []; }

  let runs: any[] = [];
  try {
    runs = (await c.env.DB.prepare('SELECT * FROM workflow_runs WHERE tenant_id = ? ORDER BY started_at DESC LIMIT 20').bind(tId(c)).all()).results || [];
  } catch (e) { runs = []; }

  const templates = [
    { name: 'Atenci├│n al Cliente', description: 'Clasificar ÔåÆ Buscar KB ÔåÆ Responder ÔåÆ Escalar', icon: 'CS' },
    { name: 'Generador de Contenido', description: 'Investigar ÔåÆ Escribir ÔåÆ Revisar ÔåÆ Publicar', icon: 'CW' },
    { name: 'Lead Qualification', description: 'Capture ÔåÆ Score ÔåÆ Route ÔåÆ Follow-up', icon: 'LQ' },
  ];

  return renderPage(c, 'Workflows', 'workflows', `
    <div class="fade-in">
      <div class="flex justify-between items-center mb-8">
        <div>
          <h1 class="text-4xl font-extrabold mb-2"><span class="text-gradient-orange">Workflows</span></h1>
          <p class="text-gim-neutral-500">${workflows.length} flujos configurados</p>
        </div>
        <button onclick="showCreateWorkflow()" class="bg-gradient-orange rounded-xl px-6 py-3 font-semibold text-white hover:opacity-90 transition shadow-lg shadow-gim-orange-500/20">
          + Nuevo Workflow
        </button>
      </div>

      <!-- Templates -->
      <div class="mb-8">
        <h3 class="text-sm font-semibold text-gim-neutral-700 mb-3">Plantillas</h3>
        <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
          ${templates.map(t => `
            <button class="bg-white rounded-xl p-4 border border-gim-neutral-200 text-left hover:border-gim-orange-300 hover:shadow-md transition">
              <div class="text-2xl mb-2">${t.icon}</div>
              <div class="font-semibold text-sm text-gim-neutral-900">${t.name}</div>
              <div class="text-xs text-gim-neutral-500">${t.description}</div>
            </button>
          `).join('')}
        </div>
      </div>

      <!-- Workflows List -->
      <div class="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
        ${workflows.map((w: any) => {
          const steps = JSON.parse(w.steps || '[]');
          const wfRuns = runs.filter((r: any) => r.workflow_id === w.id);
          const lastRun = wfRuns[0];
          return `
            <div class="bg-white rounded-2xl p-6 border border-gim-neutral-200 card-hover shadow-sm">
              <div class="flex justify-between items-start mb-4">
                <div class="w-12 h-12 bg-gradient-orange rounded-xl flex items-center justify-center shadow-lg shadow-gim-orange-500/15">
                  <svg class="w-5 h-5 text-gim-neutral-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M13 10V3L4 14h7v7l9-11h-7z"/></svg>
                </div>
                <span class="px-3 py-1 rounded-full text-xs font-medium ${w.is_active ? 'bg-green-100 text-green-600' : 'bg-gim-neutral-100 text-gim-neutral-500'}">
                  ${w.is_active ? 'Activo' : 'Inactivo'}
                </span>
              </div>
              <div class="font-semibold text-gim-neutral-900 mb-1">${w.name}</div>
              <div class="text-gim-neutral-500 text-sm mb-3">${w.description || 'Sin descripci├│n'}</div>
              <div class="flex items-center gap-4 mb-4 text-xs text-gim-neutral-500">
                <span>${steps.length} pasos</span>
                <span>${wfRuns.length} ejecuciones</span>
                ${lastRun ? `<span>├Ültima: ${lastRun.status}</span>` : ''}
              </div>
              <div class="flex gap-2">
                <button onclick="runWorkflow('${w.id}')" class="flex-1 bg-green-50 hover:bg-green-100 rounded-xl py-2 text-sm font-semibold text-green-600 transition">ÔûÂ Ejecutar</button>
                <button class="bg-gim-neutral-100 hover:bg-gim-neutral-200 rounded-xl py-2 px-4 text-sm transition text-gim-neutral-700"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg></button>
              </div>
            </div>
          `;
        }).join('') || '<div class="col-span-2 text-gim-neutral-400 text-center py-12">No hay workflows. Crea uno desde una plantilla o desde cero.</div>'}
      </div>

      <!-- Recent Runs -->
      <div class="bg-white rounded-2xl p-6 border border-gim-neutral-200 shadow-sm">
        <h3 class="font-bold text-gim-neutral-900 mb-4">Ejecuciones Recientes</h3>
        <div class="overflow-x-auto">
          <table class="w-full text-sm">
            <thead>
              <tr class="border-b border-gim-neutral-100">
                <th class="text-left py-3 text-gim-neutral-500 font-medium">ID</th>
                <th class="text-left py-3 text-gim-neutral-500 font-medium">Workflow</th>
                <th class="text-left py-3 text-gim-neutral-500 font-medium">Status</th>
                <th class="text-left py-3 text-gim-neutral-500 font-medium">Inicio</th>
                <th class="text-left py-3 text-gim-neutral-500 font-medium">Fin</th>
              </tr>
            </thead>
            <tbody>
              ${runs.map((r: any) => `
                <tr class="border-b border-gim-neutral-50 hover:bg-gim-neutral-50">
                  <td class="py-3 font-mono text-xs text-gim-neutral-600">${r.id?.slice(0, 8)}...</td>
                  <td class="py-3 text-gim-neutral-700">${r.workflow_id?.slice(0, 8)}...</td>
                  <td class="py-3">
                    <span class="px-2 py-0.5 rounded-full text-xs ${r.status === 'completed' ? 'bg-green-100 text-green-600' : r.status === 'running' ? 'bg-blue-100 text-blue-600' : 'bg-red-100 text-red-600'}">${r.status}</span>
                  </td>
                  <td class="py-3 text-gim-neutral-700">${r.started_at}</td>
                  <td class="py-3 text-gim-neutral-700">${r.completed_at || 'ÔÇö'}</td>
                </tr>
              `).join('') || '<tr><td colspan="5" class="py-8 text-center text-gim-neutral-400">Sin ejecuciones</td></tr>'}
            </tbody>
          </table>
        </div>
      </div>

      <div id="workflow-modal" class="hidden fixed inset-0 bg-black/50 flex items-center justify-center z-50">
        <form method="POST" action="/admin/workflows/save" class="bg-white rounded-2xl p-8 w-full max-w-lg shadow-2xl border border-gim-neutral-200">
          <h2 class="text-2xl font-bold mb-6"><span class="text-gradient-orange">Nuevo Workflow</span></h2>
          <div class="space-y-4">
            <div>
              <label class="block text-sm font-medium text-gim-neutral-700 mb-1">Nombre</label>
              <input name="name" required class="w-full border border-gim-neutral-300 rounded-xl px-4 py-2.5 focus:ring-2 focus:ring-gim-orange-400 focus:border-gim-orange-400 outline-none" placeholder="Atenci├│n al Cliente">
            </div>
            <div>
              <label class="block text-sm font-medium text-gim-neutral-700 mb-1">Descripci├│n</label>
              <input name="description" class="w-full border border-gim-neutral-300 rounded-xl px-4 py-2.5 focus:ring-2 focus:ring-gim-orange-400 focus:border-gim-orange-400 outline-none" placeholder="Clasificar ÔåÆ Responder ÔåÆ Escalar">
            </div>
            <div>
              <label class="block text-sm font-medium text-gim-neutral-700 mb-1">Pasos (uno por l├¡nea)</label>
              <textarea name="steps" rows="5" required class="w-full border border-gim-neutral-300 rounded-xl px-4 py-2.5 focus:ring-2 focus:ring-gim-orange-400 focus:border-gim-orange-400 outline-none font-mono text-sm" placeholder="Clasificar intencion&#10;Buscar en KB&#10;Responder&#10;Escalar si necesario"></textarea>
            </div>
          </div>
          <div class="flex gap-3 mt-6">
            <button type="submit" class="flex-1 bg-gradient-orange rounded-xl py-3 font-semibold text-white hover:opacity-90 transition">Crear Workflow</button>
            <button type="button" onclick="document.getElementById('workflow-modal').classList.add('hidden')" class="px-6 py-3 rounded-xl border border-gim-neutral-300 text-gim-neutral-600 hover:bg-gim-neutral-50 transition">Cancelar</button>
          </div>
        </form>
      </div>

      <script>
        function showCreateWorkflow() { document.getElementById('workflow-modal').classList.remove('hidden'); }
        async function runWorkflow(id) {
          if (!confirm('┬┐Ejecutar este workflow?')) return;
          const res = await fetch('/admin/api/workflows/' + id + '/run', { method: 'POST' });
          const result = await res.json();
          alert(result.id ? 'Workflow iniciado: ' + result.id : 'Error: ' + (result.error || 'Unknown'));
          location.reload();
        }
      </script>
    </div>
  `);
});

  

admin.post('/api/workflows/:id/run', async (c) => {
  const id = c.req.param('id');
  try {
    const { WorkflowEngine } = await import('../../workflows');
    const engine = new WorkflowEngine(c.env.DB, c.env.AI);
    const run = await engine.run(id);
    return c.json(run);
  } catch (e: any) {
    return c.json({ error: e.message }, 500);
  }
});

  

admin.post('/workflows/save', async (c) => {
  const form = await c.req.formData();
  const name = String(form.get('name') || '').trim();
  const description = String(form.get('description') || '').trim();
  const stepsText = String(form.get('steps') || '').trim();
  if (!name) return c.html(layout('Error', 'workflows', '<div class="p-8 text-center text-red-500">Nombre requerido</div>'), 400);

  const steps = stepsText.split('\n').map((s: string) => s.trim()).filter(Boolean).map((label: string, i: number) => ({
    id: `step_${i + 1}`,
    label,
    agent_role: 'default',
  }));

  try {
    await c.env.DB.prepare(
      'INSERT INTO workflows (id, name, description, steps, is_active, created_at, tenant_id) VALUES (?, ?, ?, ?, 1, datetime(\'now\'), ?)'
    ).bind(crypto.randomUUID(), name, description, JSON.stringify(steps), tId(c)).run();
  } catch (e: any) {
    return c.html(layout('Error', 'workflows', `<div class="p-8 text-center text-red-500">Error: ${e.message}</div>`), 500);
  }
  await auditLog(c, 'create', 'workflow', undefined, { name });
  return c.redirect('/admin/workflows');
});
}
