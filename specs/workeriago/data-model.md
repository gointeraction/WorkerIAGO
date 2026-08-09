# Data Model: WorkerIAGO

## Overview

28 tables in D1 (SQLite). 27 created via `migrations/v3.sql`, 1 (`health_logs`) created manually.

## Entity Relationship Diagram

```
┌─────────┐     ┌──────────────────┐     ┌────────────────┐
│ agents  │────<│ agent_knowledge  │>────│ knowledge_base │
│         │     └──────────────────┘     └────────────────┘
│         │     ┌──────────────────┐     ┌────────────────┐
│         │────<│ agent_tools      │>────│ mcp_tools      │
│         │     └──────────────────┘     └────────────────┘
│         │     ┌──────────────────┐     ┌────────────────┐
│         │────<│ conversations    │────<│ messages       │
│         │     │                  │     └────────────────┘
│         │     │                  │     ┌────────────────┐
│         │     │                  │────<│ tickets        │
│         │     │                  │     └────────────────┘
│         │     │                  │     ┌────────────────┐
│         │     │                  │────<│ leads          │
│         │     └──────────────────┘     └────────────────┘
└─────────┘
│     ┌──────────────────┐     ┌────────────────┐
├────<│ workflows        │────<│ workflow_runs  │
│     └──────────────────┘     └────────────────┘
│
│     ┌──────────────────┐
├────<│ ab_tests         │────<│ ab_events      │
│     └──────────────────┘     └────────────────┘
│
│     ┌──────────────────┐
├────<│ channel_configs  │
│     └──────────────────┘
│
│     ┌──────────────────┐
└────<│ usage_logs       │
      └──────────────────┘

┌─────────┐     ┌──────────────────┐
│ tenants │────<│ admin_users      │ (standalone)
└─────────┘     └──────────────────┘
                ┌──────────────────┐
                │ audit_logs       │ (standalone)
                └──────────────────┘
                ┌──────────────────┐
                │ connectors       │ (standalone)
                └──────────────────┘
                ┌──────────────────┐
                │ campaigns        │ (standalone)
                └──────────────────┘
                ┌──────────────────┐
                │ webhooks         │ (standalone)
                └──────────────────┘
                ┌──────────────────┐
                │ user_memories    │ (standalone)
                └──────────────────┘
                ┌──────────────────┐
                │ monitoring_alerts│ (standalone)
                └──────────────────┘
                ┌──────────────────┐
                │ backup_logs      │ (standalone)
                └──────────────────┘
                ┌──────────────────┐
                │ health_logs      │ (standalone)
                └──────────────────┘
                ┌──────────────────┐
                │ ai_logs          │ (standalone)
                └──────────────────┘
                ┌──────────────────┐
                │ tool_exec_logs   │ (standalone)
                └──────────────────┘
                ┌──────────────────┐
                │ knowledge_chunks │ (standalone)
                └──────────────────┘
                ┌──────────────────┐
                │ config           │ (standalone)
                └──────────────────┘
```

## Table Schemas

### 1. agents

```sql
CREATE TABLE agents (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  type TEXT DEFAULT 'support',
  system_prompt TEXT NOT NULL,
  model TEXT DEFAULT '@cf/meta/llama-3.1-8b-instruct',
  temperature REAL DEFAULT 0.7,
  max_tokens INTEGER DEFAULT 2048,
  tools TEXT DEFAULT '[]',
  is_active INTEGER DEFAULT 1,
  tenant_id TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
```

### 2. conversations

```sql
CREATE TABLE conversations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_id TEXT,
  channel TEXT NOT NULL,
  chat_id TEXT NOT NULL,
  user_name TEXT,
  user_phone TEXT,
  status TEXT DEFAULT 'active',
  intent TEXT,
  language TEXT DEFAULT 'es',
  is_paused INTEGER DEFAULT 0,
  is_escalated INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
```

### 3. messages

```sql
CREATE TABLE messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  tokens_input INTEGER DEFAULT 0,
  tokens_output INTEGER DEFAULT 0,
  cost_usd REAL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (conversation_id) REFERENCES conversations(id)
);
```

### 4. tickets

```sql
CREATE TABLE tickets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER,
  agent_id TEXT,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT DEFAULT 'new',
  priority TEXT DEFAULT 'medium',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (conversation_id) REFERENCES conversations(id)
);
```

### 5. leads

```sql
CREATE TABLE leads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER,
  agent_id TEXT,
  name TEXT,
  email TEXT,
  phone TEXT,
  source TEXT,
  status TEXT DEFAULT 'new',
  score INTEGER DEFAULT 0,
  metadata TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (conversation_id) REFERENCES conversations(id)
);
```

### 6. knowledge_base

```sql
CREATE TABLE knowledge_base (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  category TEXT,
  tags TEXT DEFAULT '[]',
  source TEXT,
  vector_id TEXT,
  view_count INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
```

**Note**: `id` is `INTEGER PRIMARY KEY AUTOINCREMENT` (NOT TEXT). Must NOT insert string UUIDs.

### 7. knowledge_chunks

```sql
CREATE TABLE knowledge_chunks (
  id TEXT PRIMARY KEY,
  kb_id INTEGER NOT NULL,
  chunk_index INTEGER NOT NULL,
  content TEXT NOT NULL,
  vector_id TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (kb_id) REFERENCES knowledge_base(id)
);
```

### 8. agent_knowledge

```sql
CREATE TABLE agent_knowledge (
  agent_id TEXT NOT NULL,
  kb_id INTEGER NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (agent_id, kb_id)
);
```

### 9. mcp_tools

```sql
CREATE TABLE mcp_tools (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  endpoint_url TEXT NOT NULL,
  method TEXT DEFAULT 'POST',
  headers TEXT DEFAULT '{}',
  parameters_schema TEXT DEFAULT '{}',
  auth_type TEXT DEFAULT 'none',
  auth_config TEXT DEFAULT '{}',
  category TEXT,
  retry_count INTEGER DEFAULT 0,
  timeout_ms INTEGER DEFAULT 5000,
  rate_limit_per_min INTEGER DEFAULT 60,
  created_at TEXT DEFAULT (datetime('now'))
);
```

### 10. agent_tools

```sql
CREATE TABLE agent_tools (
  agent_id TEXT NOT NULL,
  tool_id TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (agent_id, tool_id)
);
```

### 11. tool_execution_logs

```sql
CREATE TABLE tool_execution_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tool_id TEXT NOT NULL,
  agent_id TEXT,
  conversation_id INTEGER,
  input TEXT,
  output TEXT,
  status TEXT,
  latency_ms INTEGER,
  error TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
```

### 12. ai_logs

```sql
CREATE TABLE ai_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  model TEXT NOT NULL,
  input_tokens INTEGER DEFAULT 0,
  output_tokens INTEGER DEFAULT 0,
  latency_ms INTEGER,
  cost_usd REAL DEFAULT 0,
  status TEXT DEFAULT 'success',
  cache_hit INTEGER DEFAULT 0,
  error TEXT,
  agent_id TEXT,
  conversation_id INTEGER,
  created_at TEXT DEFAULT (datetime('now'))
);
```

### 13. usage_logs

```sql
CREATE TABLE usage_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_id TEXT,
  date TEXT,
  input_tokens INTEGER DEFAULT 0,
  output_tokens INTEGER DEFAULT 0,
  cost_usd REAL DEFAULT 0,
  request_count INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);
```

### 14. config

```sql
CREATE TABLE config (
  key TEXT PRIMARY KEY,
  value TEXT,
  updated_at TEXT DEFAULT (datetime('now'))
);
```

### 15. workflows

```sql
CREATE TABLE workflows (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  steps TEXT DEFAULT '[]',
  trigger_type TEXT DEFAULT 'manual',
  is_active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);
```

### 16. workflow_runs

```sql
CREATE TABLE workflow_runs (
  id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL,
  status TEXT DEFAULT 'pending',
  current_step INTEGER DEFAULT 0,
  context TEXT DEFAULT '{}',
  result TEXT,
  error TEXT,
  started_at TEXT DEFAULT (datetime('now')),
  completed_at TEXT,
  FOREIGN KEY (workflow_id) REFERENCES workflows(id)
);
```

### 17. connectors

```sql
CREATE TABLE connectors (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  name TEXT NOT NULL,
  is_active INTEGER DEFAULT 1,
  config TEXT DEFAULT '{}',
  sync_status TEXT DEFAULT 'idle',
  last_sync_at TEXT,
  items_synced INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);
```

### 18. ab_tests

```sql
CREATE TABLE ab_tests (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  variants TEXT DEFAULT '{}',
  traffic_split TEXT DEFAULT '{}',
  status TEXT DEFAULT 'draft',
  started_at TEXT,
  ended_at TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
```

### 19. ab_events

```sql
CREATE TABLE ab_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  test_id TEXT NOT NULL,
  variant_id TEXT,
  event_type TEXT,
  user_id TEXT,
  metadata TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (test_id) REFERENCES ab_tests(id)
);
```

### 20. webhooks

```sql
CREATE TABLE webhooks (
  id TEXT PRIMARY KEY,
  url TEXT NOT NULL,
  events TEXT DEFAULT '[]',
  secret TEXT,
  is_active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);
```

### 21. admin_users

```sql
CREATE TABLE admin_users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  role TEXT DEFAULT 'viewer',
  permissions TEXT DEFAULT '[]',
  password_hash TEXT,
  last_login_at TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
```

### 22. audit_logs

```sql
CREATE TABLE audit_logs (
  id TEXT PRIMARY KEY,
  user_email TEXT,
  action TEXT NOT NULL,
  resource TEXT NOT NULL,
  resource_id TEXT,
  ip TEXT,
  metadata TEXT DEFAULT '{}',
  created_at TEXT DEFAULT (datetime('now'))
);
```

### 23. user_memories

```sql
CREATE TABLE user_memories (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT,
  type TEXT,
  confidence REAL DEFAULT 1.0,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE (user_id, key)
);
```

### 24. tenants

```sql
CREATE TABLE tenants (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  plan TEXT DEFAULT 'free',
  status TEXT DEFAULT 'active',
  config TEXT DEFAULT '{}',
  limits TEXT DEFAULT '{}',
  owner_email TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
```

### 25. monitoring_alerts

```sql
CREATE TABLE monitoring_alerts (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  severity TEXT DEFAULT 'info',
  message TEXT,
  acknowledged INTEGER DEFAULT 0,
  acknowledged_by TEXT,
  acknowledged_at TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
```

### 26. backup_logs

```sql
CREATE TABLE backup_logs (
  id TEXT PRIMARY KEY,
  type TEXT DEFAULT 'manual',
  status TEXT,
  tables_count INTEGER,
  total_rows INTEGER,
  size_bytes INTEGER,
  r2_key TEXT,
  error TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
```

### 27. channel_configs

```sql
CREATE TABLE channel_configs (
  id TEXT PRIMARY KEY,
  channel_type TEXT NOT NULL UNIQUE,
  is_active INTEGER DEFAULT 0,
  config TEXT DEFAULT '{}',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
```

### 28. health_logs

```sql
CREATE TABLE health_logs (
  id TEXT PRIMARY KEY,
  service TEXT NOT NULL,
  status TEXT NOT NULL,
  latency_ms INTEGER DEFAULT 0,
  message TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX idx_health_logs_created ON health_logs(created_at);
```

**Note**: This table was created manually via `wrangler d1 execute` and is NOT in `migrations/v3.sql`.

### 29. campaigns (added post-migration)

```sql
CREATE TABLE campaigns (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  channel TEXT,
  message TEXT,
  segment TEXT DEFAULT 'all',
  status TEXT DEFAULT 'draft',
  sent_count INTEGER DEFAULT 0,
  opened_count INTEGER DEFAULT 0,
  started_at TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
```

**Note**: Added as part of campaigns CRUD feature. Created via D1 execution.
