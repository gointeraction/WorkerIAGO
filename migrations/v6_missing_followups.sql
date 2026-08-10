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
