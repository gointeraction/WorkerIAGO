import { Hono } from 'hono';
import { html } from 'hono/html';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { Bindings, tId, renderPage, auditLog, getSessionSecret, signSession, verifySession, issueCsrfToken, verifyCsrf, tInfo, layout, SESSION_SECRET, AgentRow, ConversationRow, KnowledgeRow, LeadRow, MessageRow, TicketRow, UsageRow } from '../utils';

export function registerAuthRoutes(admin: Hono<{ Bindings: Bindings }>) {
  

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

  return c.html(loginPage('Contrase├▒a incorrecta. Intenta de nuevo.'));
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
  <title>Iniciar Sesi├│n - WorkerIAGO Admin</title>
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
          <label class="block text-sm font-semibold text-gim-neutral-700 mb-2">Contrase├▒a</label>
          <div class="relative">
            <input type="password" name="password" id="password" required autofocus
                   placeholder="ÔÇóÔÇóÔÇóÔÇóÔÇóÔÇóÔÇóÔÇó"
                   class="w-full px-4 py-3.5 rounded-xl border-2 border-gim-neutral-200 bg-gim-neutral-50 text-gim-neutral-900 text-sm font-medium placeholder-gim-neutral-400 focus:outline-none focus:border-gim-orange-400 focus:bg-white transition-all">
            <button type="button" onclick="togglePassword()" class="absolute right-3 top-1/2 -translate-y-1/2 text-gim-neutral-400 hover:text-gim-neutral-600 transition-colors">
              <svg id="eye-open" class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"></path></svg>
              <svg id="eye-closed" class="w-5 h-5 hidden" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21"></path></svg>
            </button>
          </div>
        </div>

        <button type="submit" 
                class="w-full py-3.5 rounded-xl bg-gradient-to-r from-gim-orange-500 to-gim-orange-600 text-white font-bold text-sm shadow-lg shadow-gim-orange-500/25 hover:shadow-xl hover:shadow-gim-orange-500/35 hover:from-gim-orange-600 hover:to-gim-orange-700 transition-all active:scale-[0.98]">
          Iniciar Sesi├│n
        </button>
      </form>
    </div>

    <!-- Footer -->
    <p class="text-center text-xs text-gim-neutral-400 mt-6">
      Powered by <span class="font-semibold text-gim-orange-500">WorkerIAGO</span> ┬À Cloudflare Workers
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
}
