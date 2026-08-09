-- Migration v3.0: RAG + MCP + AI Gateway tables
-- Run with: wrangler d1 execute workeriago-db --file=./migrations/v3.sql

-- Knowledge chunks for RAG
CREATE TABLE IF NOT EXISTS knowledge_chunks (
  id TEXT PRIMARY KEY,
  kb_id TEXT NOT NULL,
  chunk_index INTEGER NOT NULL,
  content TEXT NOT NULL,
  token_count INTEGER,
  vector_id TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (kb_id) REFERENCES knowledge_base(id) ON DELETE CASCADE
);

-- Agent-Knowledge junction
CREATE TABLE IF NOT EXISTS agent_knowledge (
  agent_id TEXT NOT NULL,
  kb_id TEXT NOT NULL,
  priority INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (agent_id, kb_id)
);

-- MCP Tools registry
CREATE TABLE IF NOT EXISTS mcp_tools (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL,
  category TEXT DEFAULT 'custom',
  handler_type TEXT DEFAULT 'http',
  endpoint_url TEXT,
  method TEXT DEFAULT 'POST',
  headers JSON,
  parameters_schema JSON NOT NULL,
  response_schema JSON,
  auth_type TEXT DEFAULT 'none',
  auth_config JSON,
  timeout_ms INTEGER DEFAULT 10000,
  retry_count INTEGER DEFAULT 1,
  is_active INTEGER DEFAULT 1,
  usage_count INTEGER DEFAULT 0,
  avg_latency_ms INTEGER DEFAULT 0,
  last_used_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Agent-Tools junction
CREATE TABLE IF NOT EXISTS agent_tools (
  agent_id TEXT NOT NULL,
  tool_id TEXT NOT NULL,
  is_enabled INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (agent_id, tool_id)
);

-- Tool execution logs
CREATE TABLE IF NOT EXISTS tool_execution_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tool_id TEXT NOT NULL,
  agent_id TEXT,
  conversation_id INTEGER,
  input_params JSON,
  output_result JSON,
  status TEXT DEFAULT 'success',
  error_message TEXT,
  latency_ms INTEGER,
  tokens_used INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

-- AI Gateway logs
CREATE TABLE IF NOT EXISTS ai_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id TEXT,
  agent_id TEXT,
  conversation_id INTEGER,
  model TEXT NOT NULL,
  provider TEXT DEFAULT 'cloudflare',
  tokens_input INTEGER DEFAULT 0,
  tokens_output INTEGER DEFAULT 0,
  cost_usd REAL DEFAULT 0,
  latency_ms INTEGER DEFAULT 0,
  status TEXT DEFAULT 'success',
  error_message TEXT,
  cache_hit INTEGER DEFAULT 0,
  channel TEXT,
  action TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Indexes
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

-- Workflows
CREATE TABLE IF NOT EXISTS workflows (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  trigger_type TEXT DEFAULT 'manual',
  trigger_config JSON,
  steps JSON NOT NULL,
  is_active INTEGER DEFAULT 1,
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
  FOREIGN KEY (workflow_id) REFERENCES workflows(id)
);

-- Connectors (external services)
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
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_workflow_runs_workflow ON workflow_runs(workflow_id);
CREATE INDEX IF NOT EXISTS idx_workflow_runs_status ON workflow_runs(status);
CREATE INDEX IF NOT EXISTS idx_connectors_type ON connectors(type);

-- User memories (persistent memory)
CREATE TABLE IF NOT EXISTS user_memories (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  memory_type TEXT NOT NULL, -- fact, preference, summary, sentiment
  content TEXT NOT NULL,
  source_conversation_id INTEGER,
  confidence REAL DEFAULT 0.8,
  created_at TEXT DEFAULT (datetime('now')),
  last_recalled_at TEXT,
  recall_count INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_memories_user ON user_memories(user_id);
CREATE INDEX IF NOT EXISTS idx_memories_type ON user_memories(memory_type);

-- A/B Testing
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
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS ab_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  test_id TEXT NOT NULL,
  variant_id TEXT NOT NULL,
  conversation_id INTEGER,
  event_type TEXT NOT NULL,
  value REAL,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (test_id) REFERENCES ab_tests(id)
);

-- Webhooks
CREATE TABLE IF NOT EXISTS webhooks (
  id TEXT PRIMARY KEY,
  url TEXT NOT NULL,
  events JSON NOT NULL,
  secret TEXT NOT NULL,
  is_active INTEGER DEFAULT 1,
  last_triggered_at TEXT,
  fail_count INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Admin users (RBAC)
CREATE TABLE IF NOT EXISTS admin_users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'viewer',
  permissions JSON DEFAULT '[]',
  password_hash TEXT,
  last_login_at TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Audit logs
CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  user_email TEXT NOT NULL,
  action TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT,
  details JSON,
  ip_address TEXT,
  user_agent TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_resource ON audit_logs(resource_type);
CREATE INDEX IF NOT EXISTS idx_audit_date ON audit_logs(created_at);

-- Tenants (multi-tenant)
CREATE TABLE IF NOT EXISTS tenants (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  plan TEXT DEFAULT 'free',
  status TEXT DEFAULT 'active',
  config JSON DEFAULT '{}',
  limits JSON NOT NULL,
  owner_email TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_tenants_slug ON tenants(slug);

-- Add tenant_id to existing tables
-- ALTER TABLE agents ADD COLUMN tenant_id TEXT;
-- ALTER TABLE conversations ADD COLUMN tenant_id TEXT;
-- (SQLite doesn't support ADD COLUMN IF NOT EXISTS, handled in code)

-- Monitoring alerts
CREATE TABLE IF NOT EXISTS monitoring_alerts (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  severity TEXT NOT NULL,
  message TEXT NOT NULL,
  metadata JSON,
  acknowledged INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_alerts_severity ON monitoring_alerts(severity);
CREATE INDEX IF NOT EXISTS idx_alerts_date ON monitoring_alerts(created_at);

-- Backup logs
CREATE TABLE IF NOT EXISTS backup_logs (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  status TEXT NOT NULL,
  tables JSON,
  total_rows INTEGER DEFAULT 0,
  total_size_bytes INTEGER DEFAULT 0,
  error TEXT,
  started_at TEXT,
  completed_at TEXT
);

-- Channel configs
CREATE TABLE IF NOT EXISTS channel_configs (
  id TEXT PRIMARY KEY,
  channel_type TEXT NOT NULL,
  is_active INTEGER DEFAULT 0,
  config JSON NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
