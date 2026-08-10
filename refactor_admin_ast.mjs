import fs from 'fs';
import ts from 'typescript';

const sourceFile = fs.readFileSync('src/admin/index_original_clean.ts', 'utf-8');
const sf = ts.createSourceFile(
  'index_original_clean.ts',
  sourceFile,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TS
);

function routeModule(route) {
  if (route === '/login' || route === '/api/login' || route === '/logout') return 'auth';
  if (route === '/' || route === '/insights' || route === '/costs' || route === '/api/stats') return 'dashboard';
  if (route.startsWith('/conversations') || route.startsWith('/tickets') || route.startsWith('/leads')) return 'conversations';
  if (route === '/api/conversations' || route === '/api/tickets' || route === '/api/leads') return 'conversations';
  if (route === '/agents' || route.startsWith('/agents/') || route === '/api/agents' || route.startsWith('/api/agents/')) return 'agents';
  if (route === '/knowledge' || route.startsWith('/knowledge') || route.startsWith('/api/knowledge') || route === '/kb/save' || route === '/kb/:id' || route === '/api/kb') return 'knowledge';
  if (route.startsWith('/mcp-tools') || route.startsWith('/api/mcp-tools')) return 'mcp';
  if (route.startsWith('/campaigns')) return 'campaigns';
  if (route === '/workflows' || route.startsWith('/workflows') || route.startsWith('/api/workflows')) return 'workflows';
  if (route === '/ai-gateway' || route.startsWith('/ai-gateway') || route.startsWith('/connectors') || route.startsWith('/channels') || route === '/voice' || route.startsWith('/voice')) return 'integrations';
  if (route === '/config' || route === '/config/save') return 'system';
  if (route.startsWith('/ab-testing') || route.startsWith('/monitoring') || route.startsWith('/api/health-check') || route.startsWith('/backups') || route.startsWith('/api/backup') || route.startsWith('/tenants') || route.startsWith('/users') || route === '/audit') return 'system';
  return 'system';
}

const modules = {
  auth: [], dashboard: [], conversations: [], agents: [], knowledge: [],
  mcp: [], campaigns: [], workflows: [], integrations: [], system: [],
};

// Names already defined in utils (skip when attached as loose statements)
const utilExports = [
  'Bindings', 'tId', 'renderPage', 'auditLog', 'getSessionSecret', 'signSession',
  'verifySession', 'issueCsrfToken', 'verifyCsrf', 'tInfo', 'layout', 'SESSION_SECRET',
  'AgentRow', 'ConversationRow', 'KnowledgeRow', 'LeadRow', 'MessageRow', 'TicketRow', 'UsageRow',
];
const utilNameSet = new Set(utilExports);

function statementNames(text) {
  const names = new Set();
  let m = text.match(/^(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/);
  if (m) names.add(m[1]);
  m = text.match(/^(?:export\s+)?interface\s+([A-Za-z_$][\w$]*)/);
  if (m) names.add(m[1]);
  m = text.match(/^(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)/);
  if (m) names.add(m[1]);
  m = text.match(/^(?:export\s+)?const\s*\{\s*([^}]+)\}/);
  if (m) names.add(m[1].trim());
  return names;
}

// Track the module that the most recent admin.* statement belongs to,
// so loose helper declarations (loginPage, etc.) attach to the right module.
let currentModule = 'system';

for (const stmt of sf.statements) {
  const fullText = sourceFile.slice(stmt.pos, stmt.end);

  // Is this an `admin.<method>('...', ...)` call at top level?
  let matches = null;
  const txt = stmt.getText(sf);
  const m = txt.match(/^admin\.(get|post|put|patch|delete)\(\s*'([^']+)'/);
  if (m) {
    const route = m[2];
    const mod = routeModule(route);
    currentModule = mod;
    modules[mod].push(fullText.trimEnd());
    continue;
  }

  // Loose top-level helper/const declarations attach to current module
  if (
    (ts.isExpressionStatement(stmt) || ts.isFunctionDeclaration(stmt) ||
     ts.isVariableStatement(stmt) || ts.isInterfaceDeclaration(stmt))
  ) {
    // Skip imports
    if (ts.isExpressionStatement(stmt)) {
      const expr = stmt.expression;
      if (ts.isCallExpression(expr) && ts.isIdentifier(expr.expression) && expr.expression.text === 'import') continue;
    }
    // Skip anything already exported from utils, or `const admin = new Hono`
    const stmtText = stmt.getText(sf);
    const names = statementNames(stmtText);
    if (names.has('admin') && stmtText.includes('new Hono')) continue;
    let dup = false;
    for (const n of names) { if (utilNameSet.has(n)) { dup = true; break; } }
    if (dup) continue;
    modules[currentModule].push(fullText.trimEnd());
  }
}

const routeNames = {
  auth: 'Auth', dashboard: 'Dashboard', conversations: 'Conversations', agents: 'Agents',
  knowledge: 'Knowledge', mcp: 'Mcp', campaigns: 'Campaigns', workflows: 'Workflows',
  integrations: 'Integrations', system: 'System',
};

for (const [mod, body] of Object.entries(modules)) {
  const name = routeNames[mod];
  let imports = `import { Hono } from 'hono';\nimport { html } from 'hono/html';\nimport { getCookie, setCookie, deleteCookie } from 'hono/cookie';\nimport { ${utilExports.join(', ')} } from '../utils';\n`;

  const content = body.map(l => '  ' + l).join('\n\n');
  // Fix relative dynamic imports that broke when code moved one dir deeper
  const fixed = content
    .replace(/from '\.\.\/(knowledge|mcp|gateway|workflows|actions|ai|voice|backup|memory|monitoring|multimodal|webhooks|tenant|compliance|channels|integrations|auth)'/g, "from '../../$1'")
    .replace(/import\('\.\.\/(knowledge|mcp|gateway|workflows|actions|ai|voice|backup|memory|monitoring|multimodal|webhooks|tenant|compliance|channels|integrations|auth)'\)/g, "import('../../$1')");

  const file = `${imports}\nexport function register${name}Routes(admin: Hono<{ Bindings: Bindings }>) {\n${fixed}\n}\n`;
  fs.writeFileSync(`src/admin/routes/${mod}.ts`, file);
  console.log(`${mod}.ts: ${body.length} statements`);
}

console.log('AST refactor complete.');