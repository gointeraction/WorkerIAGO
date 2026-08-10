-- Migration v5.0: Create missing tables + complete tenant coverage
-- Run: wrangler d1 execute workeriago-db --file=./migrations/v5_missing_tables.sql --remote

-- ═══════════════════════════════════════════════════════════════════════════════
-- campaigns — referenced by src/admin/index.ts but never created
-- Silent try/catch blocks were hiding the "no such table" error
-- ═══════════════════════════════════════════════════════════════════════════════

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
CREATE INDEX IF NOT EXISTS idx_campaigns_tenant ON campaigns(tenant_id);
CREATE INDEX IF NOT EXISTS idx_campaigns_status ON campaigns(status);

-- ═══════════════════════════════════════════════════════════════════════════════
-- usage_logs — exists but has no tenant_id (costs page had to JOIN agents)
-- ═══════════════════════════════════════════════════════════════════════════════

ALTER TABLE usage_logs ADD COLUMN tenant_id TEXT;
UPDATE usage_logs SET tenant_id = 'default' WHERE tenant_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_usage_logs_tenant ON usage_logs(tenant_id);

-- ═══════════════════════════════════════════════════════════════════════════════
-- health_logs — system health per tenant
-- ═══════════════════════════════════════════════════════════════════════════════

ALTER TABLE health_logs ADD COLUMN tenant_id TEXT;
UPDATE health_logs SET tenant_id = 'default' WHERE tenant_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_health_logs_tenant ON health_logs(tenant_id);

-- ═══════════════════════════════════════════════════════════════════════════════
-- actions — orphaned table (seed.sql inserts into it, no CREATE TABLE existed)
-- ═══════════════════════════════════════════════════════════════════════════════

ALTER TABLE actions ADD COLUMN tenant_id TEXT;
UPDATE actions SET tenant_id = 'default' WHERE tenant_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_actions_tenant ON actions(tenant_id);
