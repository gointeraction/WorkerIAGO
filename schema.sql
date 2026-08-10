-- WorkerIAGO Database Schema v3.0
-- RAG-ready with R2 + Vectorize integration

-- Agentes configurados
CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  type TEXT NOT NULL DEFAULT 'general',
  system_prompt TEXT NOT NULL,
  model TEXT NOT NULL DEFAULT '@cf/meta/llama-3.1-8b-instruct-fp8',
  temperature REAL DEFAULT 0.7,
  max_tokens INTEGER DEFAULT 512,
  tools JSON,
  channel_config JSON,
  is_active INTEGER DEFAULT 1,
  tenant_id TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Conversaciones
CREATE TABLE IF NOT EXISTS conversations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_id TEXT NOT NULL,
  channel TEXT NOT NULL,
  chat_id TEXT NOT NULL,
  user_name TEXT,
  user_phone TEXT,
  user_email TEXT,
  status TEXT DEFAULT 'active',
  intent TEXT,
  sentiment TEXT,
  priority INTEGER DEFAULT 0,
  paused_until TEXT,
  last_message_at TEXT,
  message_count INTEGER DEFAULT 0,
  tags JSON,
  tenant_id TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (agent_id) REFERENCES agents(id)
);

-- Mensajes
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  metadata JSON,
  tenant_id TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (conversation_id) REFERENCES conversations(id)
);

-- Tickets de soporte
CREATE TABLE IF NOT EXISTS tickets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER,
  agent_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT DEFAULT 'new',
  priority INTEGER DEFAULT 0,
  assigned_to TEXT,
  category TEXT,
  resolution TEXT,
  resolved_at TEXT,
  closed_at TEXT,
  tenant_id TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (conversation_id) REFERENCES conversations(id),
  FOREIGN KEY (agent_id) REFERENCES agents(id)
);

-- ═══════════════════════════════════════════════════════════════════════════════
-- RAG: Knowledge Base — documentos maestros
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS knowledge_base (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  category TEXT DEFAULT 'general',
  source_type TEXT DEFAULT 'manual', -- manual, url, file
  source_url TEXT, -- URL de origen si aplica
  r2_key TEXT, -- key del archivo en R2
  mime_type TEXT, -- text/plain, text/html, application/pdf, etc.
  file_size INTEGER, -- bytes
  content_preview TEXT, -- primeros 500 chars del contenido
  chunk_count INTEGER DEFAULT 0, -- número de chunks generados
  is_published INTEGER DEFAULT 1,
  view_count INTEGER DEFAULT 0,
  helpful_count INTEGER DEFAULT 0,
  not_helpful_count INTEGER DEFAULT 0,
  last_indexed_at TEXT, -- último embedding generado
  tenant_id TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- ═══════════════════════════════════════════════════════════════════════════════
-- RAG: Chunks — fragmentos de documentos para retrieval
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS knowledge_chunks (
  id TEXT PRIMARY KEY,
  kb_id TEXT NOT NULL,
  chunk_index INTEGER NOT NULL, -- orden dentro del documento
  content TEXT NOT NULL, -- texto del chunk
  token_count INTEGER, -- tokens estimados
  vector_id TEXT, -- ID en VectorizeIndex
  tenant_id TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (kb_id) REFERENCES knowledge_base(id) ON DELETE CASCADE
);

-- Junction: Agentes ↔ Knowledge Base
CREATE TABLE IF NOT EXISTS agent_knowledge (
  agent_id TEXT NOT NULL,
  kb_id TEXT NOT NULL,
  priority INTEGER DEFAULT 0, -- orden de relevancia
  tenant_id TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (agent_id, kb_id),
  FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE,
  FOREIGN KEY (kb_id) REFERENCES knowledge_base(id) ON DELETE CASCADE
);

-- ═══════════════════════════════════════════════════════════════════════════════
-- MCP: Tools Registry — herramientas que los agentes pueden usar
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS mcp_tools (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL,
  category TEXT DEFAULT 'custom', -- custom, email, calendar, crm, payment, social, external
  handler_type TEXT DEFAULT 'http', -- http, webhook, worker
  endpoint_url TEXT, -- URL del endpoint del tool
  method TEXT DEFAULT 'POST', -- GET, POST, PUT, DELETE
  headers JSON, -- headers HTTP personalizados
  parameters_schema JSON NOT NULL, -- JSON Schema de los parámetros
  response_schema JSON, -- JSON Schema de la respuesta esperada
  auth_type TEXT DEFAULT 'none', -- none, api_key, bearer, oauth2
  auth_config JSON, -- configuración de autenticación (encrypted in prod)
  timeout_ms INTEGER DEFAULT 10000,
  retry_count INTEGER DEFAULT 1,
  is_active INTEGER DEFAULT 1,
  usage_count INTEGER DEFAULT 0,
  avg_latency_ms INTEGER DEFAULT 0,
  last_used_at TEXT,
  tenant_id TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Junction: Agentes ↔ MCP Tools
CREATE TABLE IF NOT EXISTS agent_tools (
  agent_id TEXT NOT NULL,
  tool_id TEXT NOT NULL,
  is_enabled INTEGER DEFAULT 1,
  tenant_id TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (agent_id, tool_id),
  FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE,
  FOREIGN KEY (tool_id) REFERENCES mcp_tools(id) ON DELETE CASCADE
);

-- Logs de ejecución de tools
CREATE TABLE IF NOT EXISTS tool_execution_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tool_id TEXT NOT NULL,
  agent_id TEXT,
  conversation_id INTEGER,
  input_params JSON,
  output_result JSON,
  status TEXT DEFAULT 'success', -- success, error, timeout
  error_message TEXT,
  latency_ms INTEGER,
  tokens_used INTEGER DEFAULT 0,
  tenant_id TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (tool_id) REFERENCES mcp_tools(id),
  FOREIGN KEY (agent_id) REFERENCES agents(id)
);

-- ═══════════════════════════════════════════════════════════════════════════════
-- AI Gateway: Observabilidad
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS ai_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id TEXT, -- ID único del request
  agent_id TEXT,
  conversation_id INTEGER,
  model TEXT NOT NULL,
  provider TEXT DEFAULT 'cloudflare', -- cloudflare, openai, anthropic
  tokens_input INTEGER DEFAULT 0,
  tokens_output INTEGER DEFAULT 0,
  cost_usd REAL DEFAULT 0,
  latency_ms INTEGER DEFAULT 0,
  status TEXT DEFAULT 'success', -- success, error, timeout, fallback
  error_message TEXT,
  cache_hit INTEGER DEFAULT 0, -- 1 if response was cached
  channel TEXT,
  action TEXT,
  tenant_id TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Leads
CREATE TABLE IF NOT EXISTS leads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER,
  agent_id TEXT NOT NULL,
  name TEXT,
  phone TEXT,
  email TEXT,
  company TEXT,
  interest TEXT,
  score INTEGER DEFAULT 0,
  status TEXT DEFAULT 'new',
  source TEXT,
  notes TEXT,
  last_contact_at TEXT,
  next_followup_at TEXT,
  followup_count INTEGER DEFAULT 0,
  tenant_id TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (conversation_id) REFERENCES conversations(id),
  FOREIGN KEY (agent_id) REFERENCES agents(id)
);

-- Configuración general
CREATE TABLE IF NOT EXISTS config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  category TEXT DEFAULT 'general',
  description TEXT,
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Índices
CREATE INDEX IF NOT EXISTS idx_conversations_chat ON conversations(channel, chat_id);
CREATE INDEX IF NOT EXISTS idx_conversations_agent ON conversations(agent_id);
CREATE INDEX IF NOT EXISTS idx_conversations_status ON conversations(status);
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_kb ON knowledge_chunks(kb_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_vector ON knowledge_chunks(vector_id);
CREATE INDEX IF NOT EXISTS idx_agent_knowledge_agent ON agent_knowledge(agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_knowledge_kb ON agent_knowledge(kb_id);
CREATE INDEX IF NOT EXISTS idx_mcp_tools_name ON mcp_tools(name);
CREATE INDEX IF NOT EXISTS idx_mcp_tools_category ON mcp_tools(category);
CREATE INDEX IF NOT EXISTS idx_agent_tools_agent ON agent_tools(agent_id);
CREATE INDEX IF NOT EXISTS idx_tool_logs_tool ON tool_execution_logs(tool_id);
CREATE INDEX IF NOT EXISTS idx_tool_logs_agent ON tool_execution_logs(agent_id);
CREATE INDEX IF NOT EXISTS idx_ai_logs_agent ON ai_logs(agent_id);
CREATE INDEX IF NOT EXISTS idx_ai_logs_date ON ai_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_ai_logs_model ON ai_logs(model);
CREATE INDEX IF NOT EXISTS idx_leads_agent ON leads(agent_id);
CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status);


-- ═══════════════════════════════════════════════════════════════════════════════
-- Workflows & Connectors
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS workflows (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  trigger_type TEXT DEFAULT 'manual',
  trigger_config JSON,
  steps JSON NOT NULL,
  is_active INTEGER DEFAULT 1,
  tenant_id TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS workflow_runs (
  id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL,
  status TEXT DEFAULT 'running',
  current_step TEXT,
  context JSON,
  started_at TEXT,
  completed_at TEXT,
  error TEXT,
  tenant_id TEXT,
  FOREIGN KEY (workflow_id) REFERENCES workflows(id)
);

CREATE TABLE IF NOT EXISTS connectors (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  is_active INTEGER DEFAULT 0,
  config JSON,
  auth_token TEXT,
  last_sync_at TEXT,
  sync_status TEXT,
  items_synced INTEGER DEFAULT 0,
  tenant_id TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_workflow_runs_workflow ON workflow_runs(workflow_id);
CREATE INDEX IF NOT EXISTS idx_workflow_runs_status ON workflow_runs(status);
CREATE INDEX IF NOT EXISTS idx_connectors_type ON connectors(type);

-- ═══════════════════════════════════════════════════════════════════════════════
-- User Memories (persistent memory)
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS user_memories (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  memory_type TEXT NOT NULL, -- fact, preference, summary, sentiment
  content TEXT NOT NULL,
  source_conversation_id INTEGER,
  confidence REAL DEFAULT 0.8,
  tenant_id TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  last_recalled_at TEXT,
  recall_count INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_memories_user ON user_memories(user_id);
CREATE INDEX IF NOT EXISTS idx_memories_type ON user_memories(memory_type);

-- ═══════════════════════════════════════════════════════════════════════════════
-- A/B Testing
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS ab_tests (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  variants JSON NOT NULL,
  traffic_split JSON NOT NULL,
  status TEXT DEFAULT 'draft',
  primary_metric TEXT DEFAULT 'conversion',
  start_date TEXT,
  end_date TEXT,
  tenant_id TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS ab_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  test_id TEXT NOT NULL,
  variant_id TEXT NOT NULL,
  conversation_id INTEGER,
  event_type TEXT NOT NULL,
  value REAL,
  tenant_id TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (test_id) REFERENCES ab_tests(id)
);

-- ═══════════════════════════════════════════════════════════════════════════════
-- Webhooks
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS webhooks (
  id TEXT PRIMARY KEY,
  url TEXT NOT NULL,
  events JSON NOT NULL,
  secret TEXT NOT NULL,
  is_active INTEGER DEFAULT 1,
  last_triggered_at TEXT,
  fail_count INTEGER DEFAULT 0,
  tenant_id TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- ═══════════════════════════════════════════════════════════════════════════════
-- Channels Configuration
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS channel_configs (
  id TEXT PRIMARY KEY,
  channel_type TEXT NOT NULL,
  config JSON NOT NULL,
  is_active INTEGER DEFAULT 1,
  tenant_id TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- ═══════════════════════════════════════════════════════════════════════════════
-- Usage & Health (v5 missing tables)
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS usage_logs (
  id TEXT PRIMARY KEY,
  date TEXT NOT NULL,
  input_tokens INTEGER DEFAULT 0,
  output_tokens INTEGER DEFAULT 0,
  cost REAL DEFAULT 0,
  tenant_id TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS health_logs (
  id TEXT PRIMARY KEY,
  service TEXT NOT NULL,
  status TEXT NOT NULL,
  latency_ms INTEGER,
  message TEXT,
  tenant_id TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS actions (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  payload JSON,
  status TEXT DEFAULT 'pending',
  tenant_id TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS campaigns (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  channel TEXT NOT NULL,
  message TEXT NOT NULL,
  segment TEXT,
  status TEXT DEFAULT 'draft',
  sent_count INTEGER DEFAULT 0,
  opened_count INTEGER DEFAULT 0,
  tenant_id TEXT,
  started_at TEXT,
  completed_at TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_campaigns_status ON campaigns(status);

-- ═══════════════════════════════════════════════════════════════════════════════
-- Tenants & Users (admin core)
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS tenants (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  plan TEXT DEFAULT 'free',
  status TEXT DEFAULT 'active',
  config JSON,
  limits JSON,
  owner_email TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS admin_users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  password_hash TEXT,
  role TEXT DEFAULT 'viewer',
  permissions JSON,
  last_login_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  user_email TEXT,
  action TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT,
  details JSON,
  ip_address TEXT,
  tenant_id TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS monitoring_alerts (
  id TEXT PRIMARY KEY,
  service TEXT NOT NULL,
  alert_type TEXT NOT NULL,
  message TEXT NOT NULL,
  status TEXT DEFAULT 'active',
  resolved_at TEXT,
  tenant_id TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- ═══════════════════════════════════════════════════════════════════════════════
-- Additional Tenant Indexes
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE INDEX IF NOT EXISTS idx_agents_tenant ON agents(tenant_id);
CREATE INDEX IF NOT EXISTS idx_conversations_tenant ON conversations(tenant_id);
CREATE INDEX IF NOT EXISTS idx_messages_tenant ON messages(tenant_id);
CREATE INDEX IF NOT EXISTS idx_tickets_tenant ON tickets(tenant_id);
CREATE INDEX IF NOT EXISTS idx_leads_tenant ON leads(tenant_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_base_tenant ON knowledge_base(tenant_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_tenant ON knowledge_chunks(tenant_id);
CREATE INDEX IF NOT EXISTS idx_agent_knowledge_tenant ON agent_knowledge(tenant_id);
CREATE INDEX IF NOT EXISTS idx_mcp_tools_tenant ON mcp_tools(tenant_id);
CREATE INDEX IF NOT EXISTS idx_agent_tools_tenant ON agent_tools(tenant_id);
CREATE INDEX IF NOT EXISTS idx_tool_logs_tenant ON tool_execution_logs(tenant_id);
CREATE INDEX IF NOT EXISTS idx_ai_logs_tenant ON ai_logs(tenant_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_tenant ON audit_logs(tenant_id);
CREATE INDEX IF NOT EXISTS idx_alerts_tenant ON monitoring_alerts(tenant_id);
CREATE INDEX IF NOT EXISTS idx_workflows_tenant ON workflows(tenant_id);
CREATE INDEX IF NOT EXISTS idx_workflow_runs_tenant ON workflow_runs(tenant_id);
CREATE INDEX IF NOT EXISTS idx_connectors_tenant ON connectors(tenant_id);
CREATE INDEX IF NOT EXISTS idx_user_memories_tenant ON user_memories(tenant_id);
CREATE INDEX IF NOT EXISTS idx_ab_tests_tenant ON ab_tests(tenant_id);
CREATE INDEX IF NOT EXISTS idx_ab_events_tenant ON ab_events(tenant_id);
CREATE INDEX IF NOT EXISTS idx_webhooks_tenant ON webhooks(tenant_id);
CREATE INDEX IF NOT EXISTS idx_channel_configs_tenant ON channel_configs(tenant_id);
CREATE INDEX IF NOT EXISTS idx_config_tenant ON config(tenant_id);
CREATE INDEX IF NOT EXISTS idx_usage_logs_tenant ON usage_logs(tenant_id);
CREATE INDEX IF NOT EXISTS idx_health_logs_tenant ON health_logs(tenant_id);
CREATE INDEX IF NOT EXISTS idx_actions_tenant ON actions(tenant_id);
CREATE INDEX IF NOT EXISTS idx_campaigns_tenant ON campaigns(tenant_id);
-- v6_missing_followups.sql

CREATE TABLE IF NOT EXISTS followups (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  conversation_id INTEGER NOT NULL,
  agent_id TEXT NOT NULL,
  message TEXT NOT NULL,
  status TEXT DEFAULT 'pending', -- pending, sent, failed
  scheduled_for DATETIME,
  sent_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_followups_status ON followups(status);
CREATE INDEX IF NOT EXISTS idx_followups_tenant ON followups(tenant_id);

CREATE TABLE IF NOT EXISTS backup_logs (
  id TEXT PRIMARY KEY,
  tenant_id TEXT DEFAULT 'default',
  type TEXT NOT NULL,
  status TEXT NOT NULL,
  tables TEXT,
  total_rows INTEGER,
  total_size_bytes INTEGER,
  error TEXT,
  started_at DATETIME,
  completed_at DATETIME
);

CREATE INDEX IF NOT EXISTS idx_backup_logs_tenant ON backup_logs(tenant_id);
