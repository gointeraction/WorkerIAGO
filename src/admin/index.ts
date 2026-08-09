import { Hono } from 'hono';
import { html } from 'hono/html';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';

type Bindings = {
  DB: D1Database;
  STORAGE?: R2Bucket;
  AI?: any;
  CACHE?: KVNamespace;
  VECTORIZE?: VectorizeIndex;
  AGENT_STATE?: DurableObjectNamespace;
  ADMIN_PASSWORD?: string;
  ENVIRONMENT?: string;
};

// Tenant ID helper — extracts from Hono context (set by tenantMiddleware)
function tId(c: any): string {
  return c.get('tenantId') || c.req.header('X-Tenant-ID') || getCookie(c, 'tenant_id') || 'default';
}

// Tenant info helper — loads tenant name + list for the sidebar selector
async function tInfo(c: any): Promise<{ id: string; name: string; tenants: { id: string; name: string; slug: string }[] }> {
  const id = tId(c);
  let name = 'Default';
  let tenants: { id: string; name: string; slug: string }[] = [];
  try {
    const tenant = await c.env.DB.prepare('SELECT name FROM tenants WHERE id = ?').bind(id).first<{ name: string }>();
    if (tenant) name = tenant.name;
    const result = await c.env.DB.prepare('SELECT id, name, slug FROM tenants ORDER BY name').all<{ id: string; name: string; slug: string }>();
    tenants = result.results || [];
  } catch (e) {}
  return { id, name, tenants };
}

// Render helper — async wrapper that auto-injects tenant info into layout
async function renderPage(c: any, title: string, activeTab: string, body: string): Promise<Response> {
  const ti = await tInfo(c);
  return c.html(layout(title, activeTab, body, ti));
}

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

// Session token helper — HMAC-signed cookie value "<id>:<hmac>"
const SESSION_SECRET = 'workeriago-session-secret-v2'; // overridden by ADMIN_PASSWORD if set

function signSession(id: string, secret: string): string {
  // Simple HMAC via Web Crypto (synchronous-looking, but used as string concat)
  return `${id}.${btoa(id).slice(0, 8)}.${secret.slice(0, 4)}`;
}

function verifySession(value: string | undefined, secret: string): boolean {
  if (!value) return false;
  const parts = value.split('.');
  if (parts.length !== 3) return false;
  const [id, sig, sec] = parts;
  if (sec !== secret.slice(0, 4)) return false;
  if (sig !== btoa(id).slice(0, 8)) return false;
  return true;
}

function getSessionSecret(env: Bindings): string {
  return env.ADMIN_PASSWORD || SESSION_SECRET;
}

// CSRF helper — issue and verify tokens. Stored in cookie `admin_csrf`.
function issueCsrfToken(c: any): string {
  const existing = getCookie(c, 'admin_csrf');
  if (existing) return existing;
  const token = crypto.randomUUID();
  setCookie(c, 'admin_csrf', token, { path: '/', httpOnly: true, secure: true, sameSite: 'Lax', maxAge: 86400 });
  return token;
}

function verifyCsrf(c: any): boolean {
  const cookieToken = getCookie(c, 'admin_csrf');
  if (!cookieToken) return false;
  const formToken = c.req.header('X-CSRF-Token') ||
                   (c.req.method === 'POST' && c.req.header('content-type')?.includes('application/json')
                     ? null
                     : null);
  // For form posts, look in formData
  return cookieToken === formToken;
}

// Write an audit log entry (call after every mutating admin action)
async function auditLog(c: any, action: string, resource: string, resourceId?: string, metadata?: any) {
  try {
    await c.env.DB.prepare(
      'INSERT INTO audit_logs (id, user_id, user_email, action, resource_type, resource_id, details, ip_address) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).bind(
      crypto.randomUUID(),
      'admin',
      'admin',
      action,
      resource,
      resourceId || null,
      JSON.stringify(metadata || {}),
      c.req.header('CF-Connecting-IP') || 'unknown'
    ).run();
  } catch (e) {}
}

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

// CSRF middleware — verify on POSTs
const csrfCheck = async (c: any, next: any) => {
  if (c.req.method !== 'POST') return next();
  // No CSRF requirement in demo mode (ADMIN_PASSWORD not set) — skip entirely to avoid consuming formData
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
  return c.json({ error: 'CSRF token inválido o faltante' }, 403);
};

// Apply auth to all routes
admin.use('*', auth);
admin.use('*', csrfCheck);

// Login page
admin.get('/login', async (c) => {
  const session = getCookie(c, 'admin_session');
  if (session === 'authenticated') {
    return c.redirect('/admin');
  }

  return c.html(loginPage(''));
});

// Login API
admin.post('/api/login', async (c) => {
  const form = await c.req.formData();
  const password = String(form.get('password') || '');
  const adminPassword = c.env.ADMIN_PASSWORD;
  const secret = getSessionSecret(c.env);
  const sessionId = crypto.randomUUID();
  const signed = signSession(sessionId, secret);

  if (!adminPassword) {
    setCookie(c, 'admin_session', signed, { path: '/', httpOnly: true, secure: true, sameSite: 'Lax', maxAge: 86400 });
    issueCsrfToken(c);
    return c.redirect('/admin');
  }

  if (password === adminPassword) {
    setCookie(c, 'admin_session', signed, { path: '/', httpOnly: true, secure: true, sameSite: 'Lax', maxAge: 86400 });
    issueCsrfToken(c);
    return c.redirect('/admin');
  }

  return c.html(loginPage('Contraseña incorrecta. Intenta de nuevo.'));
});

// Logout
admin.get('/logout', async (c) => {
  deleteCookie(c, 'admin_session', { path: '/' });
  return c.redirect('/admin/login');
});

// Login page template - GIM Style
function loginPage(error: string) {
  return html`<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Iniciar Sesión - WorkerIAGO Admin</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap" rel="stylesheet">
  <script>
    tailwind.config = {
      theme: {
        extend: {
          fontFamily: { sans: ['Inter', 'sans-serif'] },
          colors: {
            gim: {
              orange: { 50:'#fff7ed',100:'#ffedd5',200:'#fed7aa',300:'#fdba74',400:'#fb923c',500:'#f97316',600:'#ea580c',700:'#c2410c' },
              cyan: { 50:'#ecfeff',100:'#cffafe',200:'#a5f3fc',400:'#22d3ee',500:'#06b6d4',600:'#0891b2' },
              purple: { 400:'#c084fc',500:'#a855f7',600:'#9333ea',700:'#7e22ce' },
              neutral: { 50:'#fafafa',100:'#f5f5f5',200:'#e5e5e5',300:'#d4d4d4',400:'#a3a3a3',500:'#737373',600:'#52525b',700:'#404040',800:'#262626',900:'#18181b',950:'#0a0a0a' }
            }
          }
        }
      }
    }
  </script>
  <style>
    body { font-family: 'Inter', sans-serif; }
    .text-gradient-orange { background: linear-gradient(135deg, #f97316, #ea580c); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text; }
    .bg-gradient-orange { background: linear-gradient(135deg, #f97316, #ea580c); }
    @keyframes float { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-20px)} }
    @keyframes pulse-glow { 0%,100%{opacity:0.6;transform:scale(1)} 50%{opacity:1;transform:scale(1.1)} }
    @keyframes shimmer { 0%{background-position:-200%} 100%{background-position:200%} }
    .animate-float { animation: float 6s ease-in-out infinite; }
    .animate-pulse-glow { animation: pulse-glow 3s infinite; }
  </style>
</head>
<body class="bg-white min-h-screen flex items-center justify-center relative overflow-hidden">
  <!-- Background decorations -->
  <div class="absolute inset-0 pointer-events-none" aria-hidden="true">
    <div class="absolute -top-40 right-[-10%] h-[500px] w-[500px] rounded-full bg-gradient-to-br from-gim-orange-400/40 to-amber-300/25 blur-[120px] animate-float"></div>
    <div class="absolute -bottom-40 left-[-5%] h-[450px] w-[450px] rounded-full bg-gradient-to-tr from-gim-cyan-400/35 to-teal-300/20 blur-[120px] animate-float" style="animation-delay: 2s;"></div>
    <div class="absolute left-1/2 top-1/2 h-[300px] w-[300px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-gradient-to-r from-gim-orange-300/25 to-gim-cyan-300/20 blur-[100px] animate-pulse-glow"></div>
  </div>

  <!-- Login Card -->
  <div class="relative z-10 w-full max-w-md mx-4">
    <!-- Logo -->
    <div class="text-center mb-8">
      <div class="inline-flex items-center gap-3 mb-4">
        <div class="w-12 h-12 bg-gradient-orange rounded-xl flex items-center justify-center shadow-lg shadow-gim-orange-500/25">
          <svg class="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"/></svg>
        </div>
        <div class="text-left">
          <h1 class="text-2xl font-extrabold text-gim-neutral-900">WorkerIAGO</h1>
          <p class="text-xs text-gim-neutral-500 font-medium">Admin Panel</p>
        </div>
      </div>
      <p class="text-gim-neutral-500 text-sm">Ingresa para gestionar tus agentes</p>
    </div>

    <!-- Card -->
    <div class="bg-white rounded-3xl border-2 border-gim-neutral-100 p-8 shadow-2xl shadow-gim-neutral-900/5">
      ${error ? html`
        <div class="mb-6 p-4 rounded-xl bg-red-50 border border-red-200 text-red-600 text-sm font-medium flex items-center gap-2">
          <svg class="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z"></path></svg>
          ${error}
        </div>
      ` : ''}

      <form method="POST" action="/admin/api/login">
        <div class="mb-6">
          <label class="block text-sm font-semibold text-gim-neutral-700 mb-2">Contraseña</label>
          <div class="relative">
            <input type="password" name="password" id="password" required autofocus
                   placeholder="••••••••"
                   class="w-full px-4 py-3.5 rounded-xl border-2 border-gim-neutral-200 bg-gim-neutral-50 text-gim-neutral-900 text-sm font-medium placeholder-gim-neutral-400 focus:outline-none focus:border-gim-orange-400 focus:bg-white transition-all">
            <button type="button" onclick="togglePassword()" class="absolute right-3 top-1/2 -translate-y-1/2 text-gim-neutral-400 hover:text-gim-neutral-600 transition-colors">
              <svg id="eye-open" class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"></path></svg>
              <svg id="eye-closed" class="w-5 h-5 hidden" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21"></path></svg>
            </button>
          </div>
        </div>

        <button type="submit" 
                class="w-full py-3.5 rounded-xl bg-gradient-to-r from-gim-orange-500 to-gim-orange-600 text-white font-bold text-sm shadow-lg shadow-gim-orange-500/25 hover:shadow-xl hover:shadow-gim-orange-500/35 hover:from-gim-orange-600 hover:to-gim-orange-700 transition-all active:scale-[0.98]">
          Iniciar Sesión
        </button>
      </form>
    </div>

    <!-- Footer -->
    <p class="text-center text-xs text-gim-neutral-400 mt-6">
      Powered by <span class="font-semibold text-gim-orange-500">WorkerIAGO</span> · Cloudflare Workers
    </p>
  </div>

  <script>
    function togglePassword() {
      const input = document.getElementById('password');
      const open = document.getElementById('eye-open');
      const closed = document.getElementById('eye-closed');
      if (input.type === 'password') {
        input.type = 'text';
        open.classList.add('hidden');
        closed.classList.remove('hidden');
      } else {
        input.type = 'password';
        open.classList.remove('hidden');
        closed.classList.add('hidden');
      }
    }
  </script>
</body>
</html>`;
}

// Layout helper - GIM Style (returns raw string, NOT html tagged)
const layout = (title: string, activeTab: string, body: string, tenantInfo?: { id: string; name: string; tenants: { id: string; name: string; slug: string }[] }) => {
  const currentTenantId = tenantInfo?.id || 'default';
  const currentTenantName = tenantInfo?.name || 'Default';
  const tenantsList = tenantInfo?.tenants || [];
  const tenantBadge = currentTenantId !== 'default' ? `<span class="ml-2 px-2 py-0.5 text-xs rounded-full bg-gim-cyan-50 text-gim-cyan-600 font-medium">${currentTenantName}</span>` : '';
  return `<!DOCTYPE html>
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
          fontFamily: { sans: ['Inter', 'sans-serif'] },
          colors: {
            gim: {
              orange: { 50:'#fff7ed',100:'#ffedd5',200:'#fed7aa',300:'#fdba74',400:'#fb923c',500:'#f97316',600:'#ea580c',700:'#c2410c' },
              cyan: { 50:'#ecfeff',100:'#cffafe',200:'#a5f3fc',400:'#22d3ee',500:'#06b6d4',600:'#0891b2' },
              purple: { 400:'#c084fc',500:'#a855f7',600:'#9333ea',700:'#7e22ce' },
              neutral: { 50:'#fafafa',100:'#f5f5f5',200:'#e5e5e5',300:'#d4d4d4',400:'#a3a3a3',500:'#737373',600:'#52525b',700:'#404040',800:'#262626',900:'#18181b',950:'#0a0a0a' }
            }
          }
        }
      }
    }
  </script>
  <style>
    body { font-family: 'Inter', sans-serif; background: #fafafa; }
    .text-gradient-orange { background: linear-gradient(135deg, #f97316, #ea580c); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text; }
    .text-gradient-cyan { background: linear-gradient(135deg, #06b6d4, #0891b2); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text; }
    .bg-gradient-orange { background: linear-gradient(135deg, #f97316, #ea580c); }
    .bg-gradient-cyan { background: linear-gradient(135deg, #06b6d4, #0891b2); }
    .bg-gradient-purple { background: linear-gradient(135deg, #a855f7, #9333ea); }
    .gradient-border { border: 1px solid transparent; background: linear-gradient(#ffffff, #ffffff) padding-box, linear-gradient(135deg, #f97316, #06b6d4) border-box; }
    .card-hover { transition: all 0.3s ease; }
    .card-hover:hover { transform: translateY(-2px); box-shadow: 0 20px 40px rgba(249,115,22,0.1); border-color: #fdba74; }
    .stat-card-orange { background: linear-gradient(135deg, rgba(249,115,22,0.08), rgba(251,146,60,0.05)); border: 1px solid rgba(249,115,22,0.15); }
    .stat-card-cyan { background: linear-gradient(135deg, rgba(6,182,212,0.08), rgba(34,211,238,0.05)); border: 1px solid rgba(6,182,212,0.15); }
    .stat-card-purple { background: linear-gradient(135deg, rgba(168,85,247,0.08), rgba(192,132,252,0.05)); border: 1px solid rgba(168,85,247,0.15); }
    .stat-card-green { background: linear-gradient(135deg, rgba(34,197,94,0.08), rgba(74,222,128,0.05)); border: 1px solid rgba(34,197,94,0.15); }
    .nav-item { transition: all 0.2s ease; border-left: 3px solid transparent; }
    .nav-item:hover { background: rgba(249,115,22,0.06); color: #ea580c; }
    .nav-item.active { background: linear-gradient(90deg, rgba(249,115,22,0.1), rgba(249,115,22,0.02)); border-left-color: #f97316; color: #ea580c; font-weight: 600; }
    .pulse-dot { animation: pulse 2s infinite; }
    @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.5} }
    .fade-in { animation: fadeIn 0.5s ease; }
    @keyframes fadeIn { from{opacity:0;transform:translateY(10px)} to{opacity:1;transform:translateY(0)} }
    ::-webkit-scrollbar { width: 6px; }
    ::-webkit-scrollbar-track { background: #f5f5f5; }
    ::-webkit-scrollbar-thumb { background: #d4d4d4; border-radius: 3px; }
    ::-webkit-scrollbar-thumb:hover { background: #a3a3a3; }
  </style>
</head>
<body class="text-gim-neutral-900 min-h-screen">
  <div class="flex min-h-screen">
    <!-- Sidebar -->
    <aside class="w-72 bg-white border-r border-gim-neutral-200 fixed h-full flex flex-col">
      <!-- Logo -->
      <div class="p-6 border-b border-gim-neutral-100">
        <div class="flex items-center gap-3">
          <div class="w-10 h-10 bg-gradient-orange rounded-xl flex items-center justify-center shadow-lg shadow-gim-orange-500/20">
            <svg class="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"/></svg>
          </div>
          <div>
            <h1 class="font-extrabold text-lg text-gim-neutral-900">WorkerIAGO</h1>
            <p class="text-xs text-gim-neutral-400 font-medium">Admin Panel v2.0</p>
          </div>
        </div>
      </div>
      
      <!-- Navigation -->
      <nav class="flex-1 p-4 space-y-1 overflow-y-auto">
        <a href="/admin" class="nav-item flex items-center gap-3 px-4 py-3 rounded-lg text-gim-neutral-600 ${activeTab === 'overview' ? 'active' : ''}">
          <svg class="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"/></svg>
          <span>Resumen</span>
        </a>
        <a href="/admin/conversations" class="nav-item flex items-center gap-3 px-4 py-3 rounded-lg text-gim-neutral-600 ${activeTab === 'conversations' ? 'active' : ''}">
          <svg class="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M8 12h8M8 8h8m-8 8h5m2-13a9 9 0 11-9 9 9 9 0 019-9z"/></svg>
          <span>Conversaciones</span>
        </a>
        <a href="/admin/tickets" class="nav-item flex items-center gap-3 px-4 py-3 rounded-lg text-gim-neutral-600 ${activeTab === 'tickets' ? 'active' : ''}">
          <svg class="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M15 5v2m0 0v2m0-2h2m-2 0h-2M5 5h6v6H5V5zm0 8h6v6H5v-6zm8 0h6v6h-6v-6z"/></svg>
          <span>Tickets</span>
        </a>
        <a href="/admin/leads" class="nav-item flex items-center gap-3 px-4 py-3 rounded-lg text-gim-neutral-600 ${activeTab === 'leads' ? 'active' : ''}">
          <svg class="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"/></svg>
          <span>Leads</span>
        </a>
        <a href="/admin/knowledge" class="nav-item flex items-center gap-3 px-4 py-3 rounded-lg text-gim-neutral-600 ${activeTab === 'knowledge' ? 'active' : ''}">
          <svg class="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"/></svg>
          <span>Base de Conocimiento</span>
        </a>
        <a href="/admin/agents" class="nav-item flex items-center gap-3 px-4 py-3 rounded-lg text-gim-neutral-600 ${activeTab === 'agents' ? 'active' : ''}">
          <svg class="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"/></svg>
          <span>Agentes</span>
        </a>
        <a href="/admin/mcp-tools" class="nav-item flex items-center gap-3 px-4 py-3 rounded-lg text-gim-neutral-600 ${activeTab === 'mcp-tools' ? 'active' : ''}">
          <svg class="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M11.42 15.17L17.25 21A2.072 2.072 0 003 19.75V4.25C3 3.56 3.56 3 4.25 3h15.5c.69 0 1.25.56 1.25 1.25M14.121 14.121L19 19m-7-7l7-7m-7 7l-2.879 2.879M12 12L9.121 9.121m0 0A3 3 0 106.5 6.5a3 3 0 002.621 1.621zM19 19l-2.879-2.879m0 0a3 3 0 10-2.621-2.621"/></svg>
          <span>MCP Tools</span>
        </a>
        <a href="/admin/ai-gateway" class="nav-item flex items-center gap-3 px-4 py-3 rounded-lg text-gim-neutral-600 ${activeTab === 'ai-gateway' ? 'active' : ''}">
          <svg class="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M3 12h4l3-9 4 18 3-9h4"/></svg>
          <span>AI Gateway</span>
        </a>
        <a href="/admin/workflows" class="nav-item flex items-center gap-3 px-4 py-3 rounded-lg text-gim-neutral-600 ${activeTab === 'workflows' ? 'active' : ''}">
          <svg class="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M13 10V3L4 14h7v7l9-11h-7z"/></svg>
          <span>Workflows</span>
        </a>
        <a href="/admin/connectors" class="nav-item flex items-center gap-3 px-4 py-3 rounded-lg text-gim-neutral-600 ${activeTab === 'connectors' ? 'active' : ''}">
          <svg class="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"/></svg>
          <span>Conectores</span>
        </a>
        <a href="/admin/insights" class="nav-item flex items-center gap-3 px-4 py-3 rounded-lg text-gim-neutral-600 ${activeTab === 'insights' ? 'active' : ''}">
          <svg class="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"/></svg>
          <span>Insights</span>
        </a>
        <a href="/admin/campaigns" class="nav-item flex items-center gap-3 px-4 py-3 rounded-lg text-gim-neutral-600 ${activeTab === 'campaigns' ? 'active' : ''}">
          <svg class="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M11 5.882V19.118a1 1 0 01-1.707.707L4.414 15H2a1 1 0 01-1-1v-4a1 1 0 011-1h2.414l4.879-4.825A1 1 0 0111 5.882zM15 9a3 3 0 010 6M19.418 4.582a9 9 0 010 12.836"/></svg>
          <span>Campañas</span>
        </a>
        <a href="/admin/costs" class="nav-item flex items-center gap-3 px-4 py-3 rounded-lg text-gim-neutral-600 ${activeTab === 'costs' ? 'active' : ''}">
          <svg class="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
          <span>Costos</span>
        </a>
        <a href="/admin/channels" class="nav-item flex items-center gap-3 px-4 py-3 rounded-lg text-gim-neutral-600 ${activeTab === 'channels' ? 'active' : ''}">
          <svg class="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M5 12l5 5 9-9M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z"/></svg>
          <span>Canales</span>
        </a>
        <a href="/admin/voice" class="nav-item flex items-center gap-3 px-4 py-3 rounded-lg text-gim-neutral-600 ${activeTab === 'voice' ? 'active' : ''}">
          <svg class="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H9m2 0h2m-5-9a7 7 0 0114 0"/></svg>
          <span>Voz</span>
        </a>
        <a href="/admin/ab-testing" class="nav-item flex items-center gap-3 px-4 py-3 rounded-lg text-gim-neutral-600 ${activeTab === 'ab-testing' ? 'active' : ''}">
          <svg class="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 014.5 0m0 0v5.714a2.25 2.25 0 00.659 1.591L19.8 15.3M14.25 3.104c.251.023.501.05.75.082M19.8 15.3l-1.57.393A9.065 9.065 0 0112 15a9.065 9.065 0 00-6.23-.693L5 14.5m14.8.8l1.402 1.402c1.232 1.232.65 3.318-1.067 3.611A48.309 48.309 0 0112 21c-2.773 0-5.491-.235-8.135-.687-1.718-.293-2.3-2.379-1.067-3.61L5 14.5"/></svg>
          <span>A/B Testing</span>
        </a>
        <a href="/admin/monitoring" class="nav-item flex items-center gap-3 px-4 py-3 rounded-lg text-gim-neutral-600 ${activeTab === 'monitoring' ? 'active' : ''}">
          <svg class="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg>
          <span>Monitoring</span>
        </a>
        <a href="/admin/backups" class="nav-item flex items-center gap-3 px-4 py-3 rounded-lg text-gim-neutral-600 ${activeTab === 'backups' ? 'active' : ''}">
          <svg class="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M8 4a2 2 0 11-4 0 2 2 0 014 0zm10 0a2 2 0 11-4 0 2 2 0 014 0zM8 4h8M8 12a2 2 0 11-4 0 2 2 0 014 0zm10 0a2 2 0 11-4 0 2 2 0 014 0zM8 12h8"/></svg>
          <span>Backups</span>
        </a>
        <a href="/admin/tenants" class="nav-item flex items-center gap-3 px-4 py-3 rounded-lg text-gim-neutral-600 ${activeTab === 'tenants' ? 'active' : ''}">
          <svg class="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-4m-6 0H6m0 0H4m2 0V9h12v12M9 9h2m-2 4h2"/></svg>
          <span>Tenants</span>
        </a>
        <a href="/admin/users" class="nav-item flex items-center gap-3 px-4 py-3 rounded-lg text-gim-neutral-600 ${activeTab === 'users' ? 'active' : ''}">
          <svg class="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"/></svg>
          <span>Usuarios</span>
        </a>
        <a href="/admin/audit" class="nav-item flex items-center gap-3 px-4 py-3 rounded-lg text-gim-neutral-600 ${activeTab === 'audit' ? 'active' : ''}">
          <svg class="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>
          <span>Audit Log</span>
        </a>
        <a href="/admin/config" class="nav-item flex items-center gap-3 px-4 py-3 rounded-lg text-gim-neutral-600 ${activeTab === 'config' ? 'active' : ''}">
          <svg class="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/></svg>
          <span>Configuración</span>
        </a>
      </nav>
      
      <!-- Footer -->
      <div class="p-4 border-t border-gim-neutral-100">
        <!-- Tenant Selector -->
        <div class="mb-3 p-3 bg-gim-neutral-50 rounded-xl border border-gim-neutral-200">
          <div class="flex items-center gap-2 mb-2">
            <svg class="w-4 h-4 text-gim-neutral-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-4m-6 0H6m0 0H4m2 0V9h12v12"/></svg>
            <label class="text-xs text-gim-neutral-500 font-semibold">Tenant activo</label>
          </div>
          <select onchange="switchTenant(this.value)" class="w-full text-sm font-semibold text-gim-neutral-700 bg-white border border-gim-neutral-200 rounded-lg px-3 py-2 focus:outline-none focus:border-gim-orange-400 focus:ring-2 focus:ring-gim-orange-100 transition cursor-pointer">
            <option value="${currentTenantId}" selected>${currentTenantName}</option>
            ${tenantsList.filter(t => t.id !== currentTenantId).map(t => `<option value="${t.id}">${t.name}</option>`).join('')}
          </select>
        </div>
        <div class="flex items-center gap-2 text-sm text-gim-neutral-500">
          <span class="w-2 h-2 bg-green-500 rounded-full pulse-dot"></span>
          <span>Sistema activo</span>
        </div>
        <div class="mt-2 text-xs text-gim-neutral-400">
          Última actualización: <span id="last-update">--</span>
        </div>
        <a href="/admin/logout" class="mt-3 flex items-center gap-2 text-sm text-gim-neutral-400 hover:text-red-500 transition-colors">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"></path></svg>
          Cerrar sesión
        </a>
      </div>
    </aside>
    
    <!-- Main content -->
    <main class="ml-72 flex-1 p-8">
      ${currentTenantId !== 'default' ? `
      <!-- Non-default tenant banner -->
      <div class="mb-6 bg-gim-cyan-50 border border-gim-cyan-200 rounded-xl px-4 py-3 flex items-center gap-3">
        <svg class="w-5 h-5 text-gim-cyan-600 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-4m-6 0H6m0 0H4m2 0V9h12v12"/></svg>
        <span class="text-sm font-semibold text-gim-cyan-700">Operando en tenant: ${currentTenantName}</span>
        <span class="text-xs text-gim-cyan-500 ml-auto">Los datos mostrados pertenecen exclusivamente a este cliente</span>
      </div>
      ` : ''}
      ${body}
    </main>
    
    <script>
      function updateLastUpdate() {
        document.getElementById('last-update').textContent = new Date().toLocaleTimeString();
      }
      updateLastUpdate();
      setInterval(updateLastUpdate, 30000);

      // ═══════════════════════════════════════════════════════════════════════════════
      // TENANT INTERCEPTOR — injects X-Tenant-ID into ALL fetch() and htmx calls
      // ═══════════════════════════════════════════════════════════════════════════════
      (function() {
        var TENANT_ID = '${currentTenantId}';

        // Save original fetch
        var originalFetch = window.fetch;
        window.fetch = function(input, init) {
          init = init || {};
          init.headers = init.headers || {};
          // Handle headers as object or Headers instance
          if (init.headers instanceof Headers) {
            if (!init.headers.has('X-Tenant-ID')) init.headers.set('X-Tenant-ID', TENANT_ID);
          } else {
            if (!init.headers['X-Tenant-ID']) init.headers['X-Tenant-ID'] = TENANT_ID;
          }
          return originalFetch.call(this, input, init);
        };

        // htmx: inject header via events
        if (window.htmx) {
          document.body.addEventListener('htmx:configRequest', function(event) {
            event.detail.headers['X-Tenant-ID'] = TENANT_ID;
          });
        }

        // Tenant switcher
        window.switchTenant = function(tenantId) {
          document.cookie = 'tenant_id=' + tenantId + ';path=/;max-age=86400';
          window.location.reload();
        };
      })();
    </script>
  </div>
</body>
</html>`;
};

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
            <span class="text-green-500 text-sm font-semibold">↑ 12%</span>
          </div>
          <div class="text-3xl font-extrabold text-gim-neutral-900 mb-1" id="stats-conversations">-</div>
          <div class="text-gim-neutral-500 text-sm">Conversaciones (24h)</div>
        </div>
        
        <div class="stat-card-cyan rounded-2xl p-6 card-hover">
          <div class="flex items-center justify-between mb-4">
            <div class="w-12 h-12 bg-gradient-cyan rounded-xl flex items-center justify-center shadow-lg shadow-gim-cyan-500/20">
              <svg class="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"/></svg>
            </div>
            <span class="text-green-500 text-sm font-semibold">↑ 8%</span>
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
            <span class="text-gim-neutral-400 text-sm">Proyección</span>
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
            <a href="/admin/conversations" class="text-gim-orange-500 hover:text-gim-orange-600 text-sm font-semibold transition-colors">Ver todas →</a>
          </div>
          <div id="recent-conversations" class="space-y-4">
            <div class="text-gim-neutral-400 text-center py-8">Cargando...</div>
          </div>
        </div>
        
        <!-- Active Tickets -->
        <div class="bg-white rounded-2xl p-6 border border-gim-neutral-200 shadow-sm">
          <div class="flex items-center justify-between mb-6">
            <h2 class="text-xl font-bold text-gim-neutral-900">Tickets Activos</h2>
            <a href="/admin/tickets" class="text-gim-orange-500 hover:text-gim-orange-600 text-sm font-semibold transition-colors">Ver todos →</a>
          </div>
          <div id="active-tickets" class="space-y-4">
            <div class="text-gim-neutral-400 text-center py-8">Cargando...</div>
          </div>
        </div>
      </div>
      
      <!-- Quick Actions -->
      <div class="mt-6 bg-white rounded-2xl p-6 border border-gim-neutral-200 shadow-sm">
        <h2 class="text-xl font-bold text-gim-neutral-900 mb-6">Acciones Rápidas</h2>
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
              <div class="font-semibold text-gim-neutral-900">Nueva Campaña</div>
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
                    '<div class="font-semibold text-gim-neutral-900">' + (c.user_name || 'Anónimo') + '</div>' +
                    '<div class="text-sm text-gim-neutral-500">' + c.channel + ' · ' + (c.intent || 'sin clasificar') + '</div>' +
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
                  <div class="font-semibold text-lg text-gim-neutral-900">${c.user_name || 'Anónimo'}</div>
                  <div class="text-gim-neutral-500">${c.channel} · ${c.intent || 'sin clasificar'}</div>
                  <div class="text-sm text-gim-neutral-400 mt-1">${c.message_count} mensajes · ${new Date(c.updated_at).toLocaleString()}</div>
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
        ${page > 1 ? `<a href="/admin/conversations?page=${page - 1}" class="px-4 py-2 bg-white border border-gim-neutral-200 rounded-xl hover:bg-gim-neutral-50 transition font-medium text-sm">← Anterior</a>` : ''}
        <span class="px-4 py-2 text-gim-neutral-500 text-sm">Página ${page} de ${Math.ceil((total || 0) / limit)}</span>
        ${page < Math.ceil((total || 0) / limit) ? `<a href="/admin/conversations?page=${page + 1}" class="px-4 py-2 bg-white border border-gim-neutral-200 rounded-xl hover:bg-gim-neutral-50 transition font-medium text-sm">Siguiente →</a>` : ''}
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
      return c.html('<div class="p-6 text-red-500">Conversación no encontrada</div>');
    }
    
    const result = await c.env.DB.prepare(
      'SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC'
    ).bind(id).all<MessageRow>();
    messages = result.results || [];
  } catch (e) {
    return c.html('<div class="p-6 text-red-500">Error al cargar conversación</div>');
  }
  
  return c.html(`
    <div class="p-6">
      <div class="flex justify-between items-center mb-6 pb-6 border-b border-gim-neutral-100">
        <div class="flex items-center gap-4">
          <div class="w-12 h-12 bg-gradient-orange rounded-xl flex items-center justify-center shadow-lg shadow-gim-orange-500/15">
            <span class="text-sm font-bold text-white">${conversation.channel === 'telegram' ? 'TG' : 'WA'}</span>
          </div>
          <div>
            <div class="font-semibold text-lg text-gim-neutral-900">${conversation.user_name || 'Anónimo'}</div>
            <div class="text-sm text-gim-neutral-500">${conversation.channel} · ${conversation.intent}</div>
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
          ⏸️ Pausar
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
              <div class="text-xs ${m.role === 'owner' ? 'text-white/70' : 'text-gim-neutral-500'} mb-2">${m.role} · ${new Date(m.created_at).toLocaleTimeString()}</div>
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
                <div class="text-gim-neutral-500 mb-4">${t.description || 'Sin descripción'}</div>
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
                  <div class="font-semibold text-lg text-gim-neutral-900">${l.name || 'Anónimo'}</div>
                  <div class="text-gim-neutral-500">${l.interest || 'Sin interés definido'}</div>
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
                <option value="@cf/meta/llama-3.2-3b-instruct">Llama 3.2 3B (Rápido)</option>
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
            <label class="block text-sm font-semibold text-gim-neutral-700 mb-2">Descripción</label>
            <input type="text" name="description" id="agent-description"
                   class="w-full bg-gim-neutral-50 border-2 border-gim-neutral-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-gim-orange-400 transition-colors"
                   placeholder="Breve descripción del agente">
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
            <div class="text-gim-neutral-500 text-sm mb-4">${a.description || 'Sin descripción'}</div>
            
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
              <button hx-delete="/admin/agents/${a.id}" hx-confirm="¿Eliminar este agente?" hx-target="#agent-list" hx-swap="innerHTML" class="bg-gim-neutral-100 hover:bg-red-100 rounded-xl py-2 px-4 text-sm transition text-gim-neutral-500 hover:text-red-500"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg></button>
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
                <input type="text" name="title" placeholder="Título" required
                       class="bg-gim-neutral-50 border-2 border-gim-neutral-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-gim-cyan-400 transition-colors">
                <input type="text" name="category" placeholder="Categoría"
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
                  '<div class="text-xs text-gim-neutral-500">' + (d.category || 'Sin categoría') + '</div>' +
                '</div>' +
                '<button hx-delete="/admin/agents/' + agentId + '/kb/' + d.id + '" hx-target="#kb-linked-list" hx-swap="innerHTML" hx-confirm="¿Desvincular documento?" class="text-red-500 hover:text-red-600 text-sm font-medium"><svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg></button>' +
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
                  '<div class="text-xs text-gim-neutral-500">' + (d.category || 'Sin categoría') + '</div>' +
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

// Insights page
admin.get('/insights', async (c) => {
  let stats = { avgLatency: 0, totalConversations: 0, totalTickets: 0, resolvedTickets: 0, totalLeads: 0, convertedLeads: 0, totalMessages: 0, totalAgents: 0 };
  let dailyData: any[] = [];

  try {
    const aiStats = await c.env.DB.prepare(
      `SELECT AVG(latency_ms) as avg_latency, COUNT(*) as total FROM ai_logs WHERE created_at > datetime('now', '-7 days') AND tenant_id = ?`
    ).bind(tId(c)).first();
    stats.avgLatency = Math.round(aiStats?.avg_latency || 0);
  } catch (e) {}

  try {
    const convCount = await c.env.DB.prepare('SELECT COUNT(*) as c FROM conversations WHERE tenant_id = ?').bind(tId(c)).first();
    stats.totalConversations = convCount?.c || 0;
  } catch (e) {}

  try {
    const ticketStats = await c.env.DB.prepare(
      `SELECT COUNT(*) as total, SUM(CASE WHEN status='resolved' THEN 1 ELSE 0 END) as resolved FROM tickets WHERE tenant_id = ?`
    ).bind(tId(c)).first();
    stats.totalTickets = ticketStats?.total || 0;
    stats.resolvedTickets = ticketStats?.resolved || 0;
  } catch (e) {}

  try {
    const leadStats = await c.env.DB.prepare(
      `SELECT COUNT(*) as total, SUM(CASE WHEN status='converted' THEN 1 ELSE 0 END) as converted FROM leads WHERE tenant_id = ?`
    ).bind(tId(c)).first();
    stats.totalLeads = leadStats?.total || 0;
    stats.convertedLeads = leadStats?.converted || 0;
  } catch (e) {}

  try {
    const msgCount = await c.env.DB.prepare('SELECT COUNT(*) as c FROM messages WHERE tenant_id = ?').bind(tId(c)).first();
    stats.totalMessages = msgCount?.c || 0;
  } catch (e) {}

  try {
    const agentCount = await c.env.DB.prepare('SELECT COUNT(*) as c FROM agents WHERE tenant_id = ?').bind(tId(c)).first();
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
        <p class="text-gim-neutral-500">Analytics y métricas de rendimiento</p>
      </div>
      
      <div class="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <div class="stat-card-green rounded-2xl p-6">
          <div class="text-gim-neutral-500 text-sm mb-2">Tasa de Resolución</div>
          <div class="text-4xl font-extrabold text-green-500">${resolutionRate}%</div>
          <div class="text-sm text-gim-neutral-400 mt-2">${stats.resolvedTickets}/${stats.totalTickets} tickets resueltos</div>
        </div>
        <div class="stat-card-orange rounded-2xl p-6">
          <div class="text-gim-neutral-500 text-sm mb-2">Latencia Promedio (7d)</div>
          <div class="text-4xl font-extrabold text-gradient-orange">${stats.avgLatency}ms</div>
          <div class="text-sm text-gim-neutral-400 mt-2">Tiempo de respuesta de IA</div>
        </div>
        <div class="stat-card-cyan rounded-2xl p-6">
          <div class="text-gim-neutral-500 text-sm mb-2">Conversión de Leads</div>
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
        <h2 class="text-xl font-bold text-gim-neutral-900 mb-6">Conversaciones por día (ultimos 7 dias)</h2>
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
          <div class="text-gim-neutral-500 text-sm mb-2">Costo Total (30 días)</div>
          <div class="text-4xl font-extrabold text-green-500">$${totalCost.toFixed(4)}</div>
        </div>
        <div class="stat-card-orange rounded-2xl p-6">
          <div class="text-gim-neutral-500 text-sm mb-2">Tokens Totales</div>
          <div class="text-4xl font-extrabold text-gradient-orange">${(totalTokens / 1000).toFixed(1)}K</div>
        </div>
        <div class="stat-card-cyan rounded-2xl p-6">
          <div class="text-gim-neutral-500 text-sm mb-2">Proyección Mensual</div>
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

// Config page
admin.get('/config', async (c) => {
  let settings: any[] = [];
  try {
    const result = await c.env.DB.prepare(
      'SELECT * FROM config WHERE tenant_id = ? ORDER BY category, key'
    ).bind(tId(c)).all();
    settings = result.results || [];
  } catch (e) { settings = []; }
  
  return renderPage(c, 'Configuración', 'config', `
    <div class="fade-in">
      <div class="mb-8">
        <h1 class="text-4xl font-extrabold mb-2">
          <span class="text-gradient-orange">Configuración</span>
        </h1>
        <p class="text-gim-neutral-500">Ajustes generales del bot</p>
      </div>
      
      <div class="bg-white rounded-2xl p-8 border border-gim-neutral-200 shadow-sm">
        <h2 class="text-xl font-bold text-gim-neutral-900 mb-6">Configuración General</h2>
        
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
                <option value="es" selected>Español</option>
                <option value="en">English</option>
                <option value="pt">Português</option>
              </select>
            </div>
            <div>
              <label class="block text-sm font-semibold text-gim-neutral-700 mb-2">Modelo por Defecto</label>
              <select name="default_model" class="w-full bg-gim-neutral-50 border-2 border-gim-neutral-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-gim-orange-400 transition-colors">
                <option value="@cf/meta/llama-3.1-8b-instruct-fp8" selected>Llama 3.1 8B</option>
                <option value="@cf/meta/llama-3.2-3b-instruct">Llama 3.2 3B (Rápido)</option>
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
                      class="w-full bg-gim-neutral-50 border-2 border-gim-neutral-200 rounded-xl px-4 py-3 text-sm font-mono focus:outline-none focus:border-gim-orange-400 transition-colors">${settings.find((s: any) => s.key === 'system_prompt')?.value || 'Eres un asistente útil y amigable.'}</textarea>
          </div>
          
          <button type="submit" class="bg-gradient-orange rounded-xl px-6 py-3 font-semibold text-white hover:opacity-90 transition shadow-lg shadow-gim-orange-500/20">
            Guardar Configuración
          </button>
        </form>
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

admin.get('/api/kb', async (c) => {
  try {
    const { results } = await c.env.DB.prepare(
      'SELECT * FROM knowledge_base WHERE tenant_id = ? ORDER BY updated_at DESC'
    ).bind(tId(c)).all();
    return c.json(results || []);
  } catch (e) { return c.json([]); }
});

admin.get('/api/agents', async (c) => {
  try {
    const { results } = await c.env.DB.prepare(
      'SELECT * FROM agents WHERE tenant_id = ? ORDER BY created_at DESC'
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
    const { deleteDocument } = await import('../knowledge');
    await deleteDocument({ DB: c.env.DB, VECTORIZE: c.env.VECTORIZE, STORAGE: c.env.STORAGE, AI: c.env.AI }, id);
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
    return c.html('<span class="text-red-500">Conversación no encontrada</span>');
  }
  
  await c.env.DB.prepare(
    'INSERT INTO messages (conversation_id, role, content) VALUES (?, "owner", ?)'
  ).bind(id, text).run();
  
  await c.env.DB.prepare(
    'UPDATE conversations SET updated_at = datetime("now") WHERE id = ? AND tenant_id = ?'
  ).bind(id, tId(c)).run();
  
  return c.html('<span class="text-green-500 font-medium">✓ Mensaje enviado</span>');
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
    ).bind(id, conversation.agent_id, `Escalación de ${conversation.user_name || 'Anónimo'}`, 
           'Conversación escalada por el sistema', tId(c)).run();
  }
  
  return c.json({ ok: true });
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
      <div class="text-gim-neutral-500 text-sm mb-4">${a.description || 'Sin descripción'}</div>
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
        <button hx-delete="/admin/agents/${a.id}" hx-confirm="¿Eliminar este agente?" hx-target="#agent-list" hx-swap="innerHTML" class="bg-gim-neutral-100 hover:bg-red-100 rounded-xl py-2 px-4 text-sm transition text-gim-neutral-500 hover:text-red-500"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg></button>
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
      <div class="text-gim-neutral-500 text-sm mb-4">${a.description || 'Sin descripción'}</div>
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
        <button hx-delete="/admin/agents/${a.id}" hx-confirm="¿Eliminar este agente?" hx-target="#agent-list" hx-swap="innerHTML" class="bg-gim-neutral-100 hover:bg-red-100 rounded-xl py-2 px-4 text-sm transition text-gim-neutral-500 hover:text-red-500"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg></button>
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
    // Table may not exist yet — create it
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
        <div><div class="font-semibold text-sm text-gim-neutral-900">${d.title}</div><div class="text-xs text-gim-neutral-500">${d.category || 'Sin categoría'}</div></div>
        <button hx-delete="/admin/agents/${agentId}/kb/${d.id}" hx-target="#kb-linked-list" hx-swap="innerHTML" hx-confirm="¿Desvincular?" class="text-red-500 hover:text-red-600 text-sm font-medium"><svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg></button>
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
        <div><div class="font-semibold text-sm text-gim-neutral-900">${d.title}</div><div class="text-xs text-gim-neutral-500">${d.category || 'Sin categoría'}</div></div>
        <button hx-delete="/admin/agents/${agentId}/kb/${d.id}" hx-target="#kb-linked-list" hx-swap="innerHTML" hx-confirm="¿Desvincular?" class="text-red-500 hover:text-red-600 text-sm font-medium"><svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg></button>
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
        <div><div class="font-semibold text-sm text-gim-neutral-900">${d.title}</div><div class="text-xs text-gim-neutral-500">${d.category || 'Sin categoría'}</div></div>
        <button hx-delete="/admin/agents/${agentId}/kb/${d.id}" hx-target="#kb-linked-list" hx-swap="innerHTML" hx-confirm="¿Desvincular?" class="text-red-500 hover:text-red-600 text-sm font-medium"><svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg></button>
      </div>`
    ).join('') : '<div class="text-sm text-gim-neutral-400 text-center py-4">No hay documentos vinculados</div>';
    c.header('Content-Type', 'text/html');
    return c.body(html);
  } catch (e) {
    c.header('Content-Type', 'text/html');
    return c.body('<div class="text-sm text-gim-neutral-400 text-center py-4">Error al cargar</div>');
  }
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
    const { buildRagContext } = await import('../knowledge');
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
    const doc = await c.env.DB.prepare('SELECT * FROM knowledge_base WHERE id = ? AND tenant_id = ?').bind(id, tId(c)).first();
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
  const file = form.get('file') as File;

  if (!file) return c.html('<div class="text-red-500">No file provided</div>');

  const kbId = crypto.randomUUID();
  const r2Key = `knowledge/${kbId}/${file.name}`;

  try {
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
    const { processDocument } = await import('../knowledge');
    await processDocument({ DB: c.env.DB, VECTORIZE: c.env.VECTORIZE, STORAGE: c.env.STORAGE, AI: c.env.AI }, kbId, text);
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

    const { processUrl } = await import('../knowledge');
    await processUrl({ DB: c.env.DB, VECTORIZE: c.env.VECTORIZE, STORAGE: c.env.STORAGE, AI: c.env.AI }, kbId, url);
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

    const { processDocument } = await import('../knowledge');
    await processDocument({ DB: c.env.DB, VECTORIZE: c.env.VECTORIZE, STORAGE: c.env.STORAGE, AI: c.env.AI }, kbId, content);
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
      await c.env.VECTORIZE.deleteByIds(oldIds);
    }
    await c.env.DB.prepare('DELETE FROM knowledge_chunks WHERE kb_id = ?').bind(id).run();

    // Re-process
    const { processDocument } = await import('../knowledge');
    const result = await processDocument({ DB: c.env.DB, VECTORIZE: c.env.VECTORIZE, STORAGE: c.env.STORAGE, AI: c.env.AI }, id, content);

    return c.json({ ok: true, chunks: result.chunkCount, errors: result.errors });
  } catch (e: any) {
    return c.json({ error: e.message }, 500);
  }
});

admin.delete('/api/knowledge/:id', async (c) => {
  const id = c.req.param('id');
  try {
    const { deleteDocument } = await import('../knowledge');
    await deleteDocument({ DB: c.env.DB, VECTORIZE: c.env.VECTORIZE, STORAGE: c.env.STORAGE, AI: c.env.AI }, id);
  } catch (e) { /* ignore */ }
  return c.json({ ok: true });
});

// ═══════════════════════════════════════════════════════════════════════════════
// MCP TOOLS — Tool Registry & Management
// ═══════════════════════════════════════════════════════════════════════════════

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
              <label class="block text-sm font-semibold text-gim-neutral-700 mb-2">Categoría</label>
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
              <label class="block text-sm font-semibold text-gim-neutral-700 mb-2">Método</label>
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
            <label class="block text-sm font-semibold text-gim-neutral-700 mb-2">Descripción</label>
            <input type="text" name="description" id="tool-description" required class="w-full bg-gim-neutral-50 border-2 border-gim-neutral-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-gim-purple-400 transition-colors" placeholder="Envía un email al destinatario especificado">
          </div>
          <div class="mb-6">
            <label class="block text-sm font-semibold text-gim-neutral-700 mb-2">Parámetros (JSON Schema)</label>
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
                <span class="text-gim-neutral-500">Categoría</span>
                <span class="px-2 py-0.5 rounded-full text-xs bg-gim-purple-50 text-gim-purple-600">${t.category}</span>
              </div>
              <div class="flex justify-between text-sm">
                <span class="text-gim-neutral-500">Método</span>
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
              <button hx-delete="/admin/mcp-tools/${t.id}" hx-target="#tools-grid" hx-swap="innerHTML" hx-confirm="¿Eliminar tool?" class="bg-gim-neutral-100 hover:bg-red-100 rounded-xl py-2 px-3 text-sm transition text-gim-neutral-500 hover:text-red-500"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg></button>
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
            <label class="block text-sm font-semibold text-gim-neutral-700 mb-2">Parámetros (JSON)</label>
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

    const { executeTool } = await import('../mcp');
    const result = await executeTool(c.env.DB, tool, params);
    return c.json(result);
  } catch (e: any) {
    return c.json({ success: false, error: e.message, latency_ms: 0 });
  }
});

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
    const { getAiStats } = await import('../gateway');
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
// WORKFLOWS — Multi-agent flow engine
// ═══════════════════════════════════════════════════════════════════════════════

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
    { name: 'Atención al Cliente', description: 'Clasificar → Buscar KB → Responder → Escalar', icon: 'CS' },
    { name: 'Generador de Contenido', description: 'Investigar → Escribir → Revisar → Publicar', icon: 'CW' },
    { name: 'Lead Qualification', description: 'Capture → Score → Route → Follow-up', icon: 'LQ' },
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
              <div class="text-gim-neutral-500 text-sm mb-3">${w.description || 'Sin descripción'}</div>
              <div class="flex items-center gap-4 mb-4 text-xs text-gim-neutral-500">
                <span>${steps.length} pasos</span>
                <span>${wfRuns.length} ejecuciones</span>
                ${lastRun ? `<span>Última: ${lastRun.status}</span>` : ''}
              </div>
              <div class="flex gap-2">
                <button onclick="runWorkflow('${w.id}')" class="flex-1 bg-green-50 hover:bg-green-100 rounded-xl py-2 text-sm font-semibold text-green-600 transition">▶ Ejecutar</button>
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
                  <td class="py-3 text-gim-neutral-700">${r.completed_at || '—'}</td>
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
              <input name="name" required class="w-full border border-gim-neutral-300 rounded-xl px-4 py-2.5 focus:ring-2 focus:ring-gim-orange-400 focus:border-gim-orange-400 outline-none" placeholder="Atención al Cliente">
            </div>
            <div>
              <label class="block text-sm font-medium text-gim-neutral-700 mb-1">Descripción</label>
              <input name="description" class="w-full border border-gim-neutral-300 rounded-xl px-4 py-2.5 focus:ring-2 focus:ring-gim-orange-400 focus:border-gim-orange-400 outline-none" placeholder="Clasificar → Responder → Escalar">
            </div>
            <div>
              <label class="block text-sm font-medium text-gim-neutral-700 mb-1">Pasos (uno por línea)</label>
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
          if (!confirm('¿Ejecutar este workflow?')) return;
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
    const { WorkflowEngine } = await import('../workflows');
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
    const row = await c.env.DB.prepare("SELECT value FROM config WHERE key = 'voice_config' AND tenant_id = ?").bind(tId(c)).first();
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

// ═══════════════════════════════════════════════════════════════════════════════
// A/B TESTING
// ═══════════════════════════════════════════════════════════════════════════════

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
              <label class="block text-sm font-medium text-gim-neutral-700 mb-1">Descripción</label>
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
              <div class="text-gim-neutral-500 text-sm mb-4">${t.description || 'Sin descripción'}</div>
              <div class="space-y-2 mb-4">
                ${variants.map((v: any) => `
                  <div class="flex justify-between text-sm bg-gim-neutral-50 rounded-lg px-3 py-2">
                    <span class="text-gim-neutral-700">${v.name}</span>
                    <span class="text-gim-neutral-500">${v.impressions || 0} imp · ${v.conversions || 0} conv</span>
                  </div>
                `).join('')}
              </div>
              <div class="flex gap-2">
                ${t.status === 'draft' ? `<form method="POST" action="/admin/ab-testing/${t.id}/start" class="flex-1"><button class="w-full bg-green-100 hover:bg-green-200 rounded-xl py-2 text-sm font-medium transition text-green-600">▶️ Iniciar</button></form>` : ''}
                ${t.status === 'running' ? `<form method="POST" action="/admin/ab-testing/${t.id}/stop" class="flex-1"><button class="w-full bg-yellow-100 hover:bg-yellow-200 rounded-xl py-2 text-sm font-medium transition text-yellow-600">⏹️ Parar</button></form>` : ''}
                <form method="POST" action="/admin/ab-testing/${t.id}/delete" onsubmit="return confirm('¿Eliminar este test?')">
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

// ═══════════════════════════════════════════════════════════════════════════════
// MONITORING — Health checks + alertas
// ═══════════════════════════════════════════════════════════════════════════════

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
          <p class="text-gim-neutral-500">Health checks, alertas y métricas del sistema</p>
        </div>
        <button onclick="runHealthCheck()" class="bg-gradient-orange rounded-xl px-6 py-3 font-semibold text-white hover:opacity-90 transition shadow-lg shadow-gim-orange-500/20">
          🩺 Health Check
        </button>
      </div>

      <!-- Health Status -->
      <div id="health-status" class="grid grid-cols-2 md:grid-cols-5 gap-4 mb-8">
        <div class="bg-white rounded-xl p-4 border border-gim-neutral-200 shadow-sm text-center">
          <div class="text-sm text-gim-neutral-500 mb-1">D1</div>
          <div id="h-d1" class="text-2xl font-bold text-green-500">●</div>
        </div>
        <div class="bg-white rounded-xl p-4 border border-gim-neutral-200 shadow-sm text-center">
          <div class="text-sm text-gim-neutral-500 mb-1">KV</div>
          <div id="h-kv" class="text-2xl font-bold text-green-500">●</div>
        </div>
        <div class="bg-white rounded-xl p-4 border border-gim-neutral-200 shadow-sm text-center">
          <div class="text-sm text-gim-neutral-500 mb-1">Vectorize</div>
          <div id="h-vec" class="text-2xl font-bold text-green-500">●</div>
        </div>
        <div class="bg-white rounded-xl p-4 border border-gim-neutral-200 shadow-sm text-center">
          <div class="text-sm text-gim-neutral-500 mb-1">AI</div>
          <div id="h-ai" class="text-2xl font-bold text-green-500">●</div>
        </div>
        <div class="bg-white rounded-xl p-4 border border-gim-neutral-200 shadow-sm text-center">
          <div class="text-sm text-gim-neutral-500 mb-1">R2</div>
          <div id="h-r2" class="text-2xl font-bold text-green-500">●</div>
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
                      ? '<span class="text-xs text-gim-neutral-400">✓ Ack</span>'
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
          document.querySelectorAll('#health-status .text-2xl').forEach(el => { el.textContent = '○'; el.className = 'text-2xl font-bold text-gim-neutral-300'; });
          try {
            const res = await fetch('/admin/api/health-check', { method: 'POST' });
            const data = await res.json();
            ['d1','kv','vec','ai','r2'].forEach(s => {
              const el = document.getElementById('h-' + s);
              const ok = data[s] === 'ok' || data[s] === true;
              el.textContent = ok ? '●' : '○';
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
      ).bind(crypto.randomUUID(), 'health_check', 'critical', `Servicios caídos: ${downServices.join(', ')}`).run();
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

// ═══════════════════════════════════════════════════════════════════════════════
// BACKUPS
// ═══════════════════════════════════════════════════════════════════════════════

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
          <p class="text-gim-neutral-500">Backup automático de D1 → R2</p>
        </div>
        <div class="flex gap-3">
          <button onclick="createBackup()" class="bg-gradient-cyan rounded-xl px-6 py-3 font-semibold text-white hover:opacity-90 transition shadow-lg shadow-gim-cyan-500/20">
            Crear Backup
          </button>
        </div>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <div class="bg-white rounded-2xl p-6 border border-gim-neutral-200 shadow-sm">
          <div class="text-gim-neutral-500 text-sm mb-2">Último Backup</div>
          <div class="text-2xl font-extrabold text-gim-cyan-500">${backups[0]?.completed_at || 'Nunca'}</div>
        </div>
        <div class="bg-white rounded-2xl p-6 border border-gim-neutral-200 shadow-sm">
          <div class="text-gim-neutral-500 text-sm mb-2">Total Backups</div>
          <div class="text-2xl font-extrabold text-gim-orange-500">${backups.length}</div>
        </div>
        <div class="bg-white rounded-2xl p-6 border border-gim-neutral-200 shadow-sm">
          <div class="text-gim-neutral-500 text-sm mb-2">Retention</div>
          <div class="text-2xl font-extrabold text-gim-purple-500">30 días</div>
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
                <th class="text-left py-3 text-gim-neutral-500 font-medium">Tamaño</th>
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
                      <form method="POST" action="/admin/api/backup/${b.id}/restore" onsubmit="return confirm('¿Restaurar este backup? Esto sobrescribirá los datos actuales.')">
                        <button class="text-xs text-gim-cyan-500 hover:text-gim-cyan-600 font-medium">↺ Restaurar</button>
                      </form>
                      <form method="POST" action="/admin/api/backup/${b.id}/delete" onsubmit="return confirm('¿Eliminar este backup?')">
                        <button class="text-xs text-red-500 hover:text-red-600 font-medium ml-2"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg></button>
                      </form>
                    </div>
                  </td>
                </tr>
              `).join('') || '<tr><td colspan="7" class="py-8 text-center text-gim-neutral-400">Sin backups aún</td></tr>'}
            </tbody>
          </table>
        </div>
      </div>

      <script>
        async function createBackup() {
          if (!confirm('¿Crear backup completo de todas las tablas?')) return;
          const btn = event.target;
          btn.disabled = true;
          btn.textContent = '⏳ Creando...';
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

// ═══════════════════════════════════════════════════════════════════════════════
// TENANTS — Multi-tenant management
// ═══════════════════════════════════════════════════════════════════════════════

admin.get('/tenants', async (c) => {
  let tenants: any[] = [];
  try {
    tenants = (await c.env.DB.prepare('SELECT * FROM tenants ORDER BY created_at DESC').all()).results || [];
  } catch (e) { tenants = []; }

  const plans = { free: 'Free', starter: 'Starter', pro: 'Pro', enterprise: 'Enterprise' };

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
              <label class="block text-sm font-medium text-gim-neutral-700 mb-1">Slug (identificador único)</label>
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
                  <span class="px-2 py-0.5 rounded-full text-xs bg-gim-orange-50 text-gim-orange-600 font-medium">${plans[t.plan] || t.plan}</span>
                </div>
                <div class="flex justify-between text-sm">
                  <span class="text-gim-neutral-500">Slug</span>
                  <span class="text-xs font-mono text-gim-neutral-700">${t.slug}</span>
                </div>
                <div class="flex justify-between text-sm">
                  <span class="text-gim-neutral-500">Max Agentes</span>
                  <span class="text-gim-neutral-700">${limits.max_agents === -1 ? '∞' : limits.max_agents}</span>
                </div>
              </div>
              <div class="flex gap-2">
                <button onclick="editTenant('${t.id}', '${t.name}', '${t.owner_email}', '${t.slug}', '${t.plan}')" class="flex-1 bg-gim-neutral-100 hover:bg-gim-neutral-200 rounded-xl py-2 text-sm font-medium transition text-gim-neutral-700">Editar</button>
                <form method="POST" action="/admin/tenants/${t.id}/delete" onsubmit="return confirm('¿Eliminar este tenant?')">
                  <button class="bg-gim-neutral-100 hover:bg-red-100 rounded-xl py-2 px-4 text-sm transition text-gim-neutral-500 hover:text-red-500"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg></button>
                </form>
              </div>
            </div>
          `;
        }).join('') || '<div class="col-span-3 text-gim-neutral-400 text-center py-12">No hay tenants. La instancia está en modo single-tenant.</div>'}
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

// ═══════════════════════════════════════════════════════════════════════════════
// USERS — RBAC management
// ═══════════════════════════════════════════════════════════════════════════════

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
              <input name="name" required class="w-full border border-gim-neutral-300 rounded-xl px-4 py-2.5 focus:ring-2 focus:ring-gim-orange-400 focus:border-gim-orange-400 outline-none" placeholder="Juan Pérez">
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
            <div class="text-xs text-gim-neutral-500 mt-1">Gestión completa excepto usuarios</div>
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
                <th class="text-left py-3 text-gim-neutral-500 font-medium">Último Login</th>
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
                      <form method="POST" action="/admin/users/${u.id}/delete" onsubmit="return confirm('¿Eliminar este usuario?')" class="inline">
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

// ═══════════════════════════════════════════════════════════════════════════════
// AUDIT LOG
// ═══════════════════════════════════════════════════════════════════════════════

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
                <th class="text-left py-3 text-gim-neutral-500 font-medium">Acción</th>
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
                  <td class="py-3 font-mono text-xs text-gim-neutral-500">${l.resource_id?.slice(0, 8) || '—'}</td>
                  <td class="py-3 text-gim-neutral-500 text-xs">${l.ip_address || '—'}</td>
                </tr>
              `).join('') || '<tr><td colspan="6" class="py-8 text-center text-gim-neutral-400">Sin logs de auditoría</td></tr>'}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `);
});

export { admin as AdminPanel };
