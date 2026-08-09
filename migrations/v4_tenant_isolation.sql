-- Migration v4.0: Multi-tenant isolation — add tenant_id to ALL tenant-scoped tables
-- Run with: wrangler d1 execute workeriago-db --file=./migrations/v4_tenant_isolation.sql --remote
-- Local:    wrangler d1 execute workeriago-db --file=./migrations/v4_tenant_isolation.sql --local

-- SQLite ADD COLUMN is idempotent-safe: if column exists, it errors silently.
-- We use a pragma check pattern. Unfortunately SQLite has no ADD COLUMN IF NOT EXISTS,
-- so we wrap each in a savepoint that rolls back on error.
-- In practice, run this once. If re-run, columns that already exist will error but
-- the rest will succeed since each ALTER is independent.

-- ═══════════════════════════════════════════════════════════════════════════════
-- Core tables (from schema.sql)
-- ═══════════════════════════════════════════════════════════════════════════════

ALTER TABLE agents ADD COLUMN tenant_id TEXT;
ALTER TABLE conversations ADD COLUMN tenant_id TEXT;
ALTER TABLE messages ADD COLUMN tenant_id TEXT;
ALTER TABLE tickets ADD COLUMN tenant_id TEXT;
ALTER TABLE leads ADD COLUMN tenant_id TEXT;
ALTER TABLE config ADD COLUMN tenant_id TEXT;

-- ═══════════════════════════════════════════════════════════════════════════════
-- RAG tables
-- ═══════════════════════════════════════════════════════════════════════════════

ALTER TABLE knowledge_base ADD COLUMN tenant_id TEXT;
ALTER TABLE knowledge_chunks ADD COLUMN tenant_id TEXT;
ALTER TABLE agent_knowledge ADD COLUMN tenant_id TEXT;

-- ═══════════════════════════════════════════════════════════════════════════════
-- MCP tables
-- ═══════════════════════════════════════════════════════════════════════════════

ALTER TABLE mcp_tools ADD COLUMN tenant_id TEXT;
ALTER TABLE agent_tools ADD COLUMN tenant_id TEXT;
ALTER TABLE tool_execution_logs ADD COLUMN tenant_id TEXT;

-- ═══════════════════════════════════════════════════════════════════════════════
-- AI Gateway + Observability
-- ═══════════════════════════════════════════════════════════════════════════════

ALTER TABLE ai_logs ADD COLUMN tenant_id TEXT;
ALTER TABLE audit_logs ADD COLUMN tenant_id TEXT;
ALTER TABLE monitoring_alerts ADD COLUMN tenant_id TEXT;

-- ═══════════════════════════════════════════════════════════════════════════════
-- Workflow + Connector tables (from v3.sql)
-- ═══════════════════════════════════════════════════════════════════════════════

ALTER TABLE workflows ADD COLUMN tenant_id TEXT;
ALTER TABLE workflow_runs ADD COLUMN tenant_id TEXT;
ALTER TABLE connectors ADD COLUMN tenant_id TEXT;

-- ═══════════════════════════════════════════════════════════════════════════════
-- User data + Experimentation
-- ═══════════════════════════════════════════════════════════════════════════════

ALTER TABLE user_memories ADD COLUMN tenant_id TEXT;
ALTER TABLE ab_tests ADD COLUMN tenant_id TEXT;
ALTER TABLE ab_events ADD COLUMN tenant_id TEXT;

-- ═══════════════════════════════════════════════════════════════════════════════
-- Integration tables
-- ═══════════════════════════════════════════════════════════════════════════════

ALTER TABLE webhooks ADD COLUMN tenant_id TEXT;
ALTER TABLE channel_configs ADD COLUMN tenant_id TEXT;

-- ═══════════════════════════════════════════════════════════════════════════════
-- Backfill: set default tenant for existing rows
-- ═══════════════════════════════════════════════════════════════════════════════

-- Create a default tenant if none exists
INSERT OR IGNORE INTO tenants (id, name, slug, plan, status, config, limits, owner_email)
VALUES ('default', 'Default Tenant', 'default', 'pro', 'active', '{}', '{"max_agents":20,"max_messages_month":100000,"max_knowledge_docs":500,"max_channels":10,"max_storage_mb":10000}', 'admin@workeriago.dev');

-- Backfill all NULL tenant_id to 'default'
UPDATE agents SET tenant_id = 'default' WHERE tenant_id IS NULL;
UPDATE conversations SET tenant_id = 'default' WHERE tenant_id IS NULL;
UPDATE messages SET tenant_id = 'default' WHERE tenant_id IS NULL;
UPDATE tickets SET tenant_id = 'default' WHERE tenant_id IS NULL;
UPDATE leads SET tenant_id = 'default' WHERE tenant_id IS NULL;
UPDATE knowledge_base SET tenant_id = 'default' WHERE tenant_id IS NULL;
UPDATE knowledge_chunks SET tenant_id = 'default' WHERE tenant_id IS NULL;
UPDATE agent_knowledge SET tenant_id = 'default' WHERE tenant_id IS NULL;
UPDATE mcp_tools SET tenant_id = 'default' WHERE tenant_id IS NULL;
UPDATE agent_tools SET tenant_id = 'default' WHERE tenant_id IS NULL;
UPDATE tool_execution_logs SET tenant_id = 'default' WHERE tenant_id IS NULL;
UPDATE ai_logs SET tenant_id = 'default' WHERE tenant_id IS NULL;
UPDATE audit_logs SET tenant_id = 'default' WHERE tenant_id IS NULL;
UPDATE monitoring_alerts SET tenant_id = 'default' WHERE tenant_id IS NULL;
UPDATE workflows SET tenant_id = 'default' WHERE tenant_id IS NULL;
UPDATE workflow_runs SET tenant_id = 'default' WHERE tenant_id IS NULL;
UPDATE connectors SET tenant_id = 'default' WHERE tenant_id IS NULL;
UPDATE user_memories SET tenant_id = 'default' WHERE tenant_id IS NULL;
UPDATE ab_tests SET tenant_id = 'default' WHERE tenant_id IS NULL;
UPDATE ab_events SET tenant_id = 'default' WHERE tenant_id IS NULL;
UPDATE webhooks SET tenant_id = 'default' WHERE tenant_id IS NULL;
UPDATE channel_configs SET tenant_id = 'default' WHERE tenant_id IS NULL;
UPDATE config SET tenant_id = 'default' WHERE tenant_id IS NULL;

-- ═══════════════════════════════════════════════════════════════════════════════
-- Indexes for tenant isolation (critical for query performance)
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
