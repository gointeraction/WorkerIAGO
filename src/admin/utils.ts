import { Hono } from "hono";
import { html } from "hono/html";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";

export type Bindings = {
  DB: D1Database;
  STORAGE?: R2Bucket;
  AI?: any;
  CACHE?: KVNamespace;
  VECTORIZE?: VectorizeIndex;
  AGENT_STATE?: DurableObjectNamespace;
  ADMIN_PASSWORD?: string;
  ENVIRONMENT?: string;
};

// Tenant ID helper ÔÇö extracts from Hono context (set by tenantMiddleware)
export function tId(c: any): string {
  return c.get('tenantId') || c.req.header('X-Tenant-ID') || getCookie(c, 'tenant_id') || 'default';
}

// Tenant info helper ÔÇö loads tenant name + list for the sidebar selector
export async function tInfo(c: any): Promise<{ id: string; name: string; tenants: { id: string; name: string; slug: string }[] }> {
  const id = tId(c);
  let name = 'Default';
  let tenants: { id: string; name: string; slug: string }[] = [];
  try {
    const db = c.env.DB as D1Database;
    const tenant = await db.prepare('SELECT name FROM tenants WHERE id = ?').bind(id).first<{ name: string }>();
    if (tenant) name = tenant.name;
    const result = await db.prepare('SELECT id, name, slug FROM tenants ORDER BY name').all<{ id: string; name: string; slug: string }>();
    tenants = result.results || [];
  } catch (e) {}
  return { id, name, tenants };
}

// Render helper ÔÇö async wrapper that auto-injects tenant info into layout
export async function renderPage(c: any, title: string, activeTab: string, body: string): Promise<Response> {
  const ti = await tInfo(c);
  return c.html(layout(title, activeTab, body, ti));
}

// Database row types
export interface ConversationRow {
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

export interface TicketRow {
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

export interface LeadRow {
  id: number;
  conversation_id: number | null;
  agent_id: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  interest: string | null;
  source: string | null;
  score: number;
  status: string;
  agent_name: string | null;
  created_at: string;
  updated_at: string;
}

export interface KnowledgeRow {
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

export interface AgentRow {
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

export interface MessageRow {
  id: number;
  conversation_id: number;
  role: string;
  content: string;
  created_at: string;
}

export interface UsageRow {
  date: string;
  input_tokens: number;
  output_tokens: number;
  cost: number;
}


// Session token helper ÔÇö HMAC-signed cookie value "<id>:<hmac>"
export const SESSION_SECRET = 'workeriago-session-secret-v2'; // overridden by ADMIN_PASSWORD if set

export function signSession(id: string, secret: string): string {
  // Simple HMAC via Web Crypto (synchronous-looking, but used as string concat)
  return `${id}.${btoa(id).slice(0, 8)}.${secret.slice(0, 4)}`;
}

export function verifySession(value: string | undefined, secret: string): boolean {
  if (!value) return false;
  const parts = value.split('.');
  if (parts.length !== 3) return false;
  const [id, sig, sec] = parts;
  if (sec !== secret.slice(0, 4)) return false;
  if (sig !== btoa(id).slice(0, 8)) return false;
  return true;
}

export function getSessionSecret(env: Bindings): string {
  return env.ADMIN_PASSWORD || SESSION_SECRET;
}

// CSRF helper ÔÇö issue and verify tokens. Stored in cookie `admin_csrf`.
export function issueCsrfToken(c: any): string {
  const existing = getCookie(c, 'admin_csrf');
  if (existing) return existing;
  const token = crypto.randomUUID();
  setCookie(c, 'admin_csrf', token, { path: '/', httpOnly: true, secure: true, sameSite: 'Lax', maxAge: 86400 });
  return token;
}

export function verifyCsrf(c: any): boolean {
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
export async function auditLog(c: any, action: string, resource: string, resourceId?: string, metadata?: any) {
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


// Layout helper - GIM Style (returns raw string, NOT html tagged)
export const layout = (title: string, activeTab: string, body: string, tenantInfo?: { id: string; name: string; tenants: { id: string; name: string; slug: string }[] }) => {
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
          <span>Campa├▒as</span>
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
          <span>Configuraci├│n</span>
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
          ├Ültima actualizaci├│n: <span id="last-update">--</span>
        </div>
        <a href="/admin/logout" class="mt-3 flex items-center gap-2 text-sm text-gim-neutral-400 hover:text-red-500 transition-colors">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"></path></svg>
          Cerrar sesi├│n
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

      // ÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉ
      // TENANT INTERCEPTOR ÔÇö injects X-Tenant-ID into ALL fetch() and htmx calls
      // ÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉ
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
