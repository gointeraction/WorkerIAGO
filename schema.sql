-- WorkerIAGO Database Schema v2.0
-- Enhanced with Tickets, Insights, Campaigns, and improved KB

-- Agentes configurados
CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  type TEXT NOT NULL DEFAULT 'general', -- ventas, soporte, reservas, general
  system_prompt TEXT NOT NULL,
  model TEXT NOT NULL DEFAULT '@cf/meta/llama-3.1-8b-instruct-fp8',
  temperature REAL DEFAULT 0.7,
  max_tokens INTEGER DEFAULT 512,
  tools JSON, -- JSON array of tool names
  channel_config JSON, -- which channels this agent handles
  is_active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Conversaciones (enhanced)
CREATE TABLE IF NOT EXISTS conversations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_id TEXT NOT NULL,
  channel TEXT NOT NULL, -- telegram, whatsapp, web
  chat_id TEXT NOT NULL, -- channel-specific chat identifier
  user_name TEXT,
  user_phone TEXT,
  user_email TEXT,
  status TEXT DEFAULT 'active', -- active, closed, escalated, paused
  intent TEXT, -- classified intent
  sentiment TEXT, -- positive, neutral, negative
  priority INTEGER DEFAULT 0, -- 0=normal, 1=high, 2=urgent
  paused_until TEXT, -- ISO timestamp when bot should resume
  last_message_at TEXT,
  message_count INTEGER DEFAULT 0,
  tags JSON, -- JSON array of tags
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (agent_id) REFERENCES agents(id)
);

-- Mensajes (enhanced)
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER NOT NULL,
  role TEXT NOT NULL, -- user, assistant, system, owner, tool
  content TEXT NOT NULL,
  metadata JSON, -- tokens used, model, latency, etc.
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
  status TEXT DEFAULT 'new', -- new, in_progress, waiting, resolved, closed
  priority INTEGER DEFAULT 0, -- 0=low, 1=medium, 2=high, 3=urgent
  assigned_to TEXT, -- email or name of assignee
  category TEXT, -- bug, question, feature_request, complaint
  resolution TEXT, -- how it was resolved
  resolved_at TEXT,
  closed_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (conversation_id) REFERENCES conversations(id),
  FOREIGN KEY (agent_id) REFERENCES agents(id)
);

-- Base de conocimiento (documentos para RAG) - enhanced
CREATE TABLE IF NOT EXISTS knowledge_base (
  id TEXT PRIMARY KEY, -- UUID
  agent_id TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  category TEXT,
  tags JSON, -- JSON array of tags
  vector_id TEXT, -- reference to Vectorize
  source TEXT, -- url, file, manual
  version INTEGER DEFAULT 1,
  is_published INTEGER DEFAULT 1,
  view_count INTEGER DEFAULT 0,
  helpful_count INTEGER DEFAULT 0,
  not_helpful_count INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (agent_id) REFERENCES agents(id)
);

-- Leads capturados (enhanced)
CREATE TABLE IF NOT EXISTS leads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER,
  agent_id TEXT NOT NULL,
  name TEXT,
  phone TEXT,
  email TEXT,
  company TEXT,
  interest TEXT, -- what they're interested in
  score INTEGER DEFAULT 0, -- lead score 0-100
  status TEXT DEFAULT 'new', -- new, contacted, qualified, converted, lost
  source TEXT, -- where the lead came from
  notes TEXT,
  last_contact_at TEXT,
  next_followup_at TEXT,
  followup_count INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (conversation_id) REFERENCES conversations(id),
  FOREIGN KEY (agent_id) REFERENCES agents(id)
);

-- Acciones disponibles
CREATE TABLE IF NOT EXISTS actions (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  handler TEXT NOT NULL, -- function name to execute
  parameters JSON, -- JSON schema of parameters
  is_active INTEGER DEFAULT 1,
  usage_count INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Logs de usage (enhanced with cost tracking)
CREATE TABLE IF NOT EXISTS usage_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_id TEXT,
  conversation_id INTEGER,
  model TEXT,
  tokens_input INTEGER,
  tokens_output INTEGER,
  cost_usd REAL, -- calculated cost in USD
  latency_ms INTEGER,
  channel TEXT,
  action TEXT, -- what triggered this usage
  created_at TEXT DEFAULT (datetime('now'))
);

-- Insights y analytics
CREATE TABLE IF NOT EXISTS insights (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER,
  agent_id TEXT,
  insight_type TEXT NOT NULL, -- sentiment, topic, resolution, quality
  insight_value TEXT NOT NULL, -- the actual insight
  confidence REAL, -- 0-1 confidence score
  metadata JSON,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (conversation_id) REFERENCES conversations(id),
  FOREIGN KEY (agent_id) REFERENCES agents(id)
);

-- Campañas de mensajería
CREATE TABLE IF NOT EXISTS campaigns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT,
  channel TEXT NOT NULL, -- whatsapp, telegram
  template_sid TEXT, -- WhatsApp template SID
  content TEXT, -- freeform message content
  status TEXT DEFAULT 'draft', -- draft, scheduled, sending, sent, failed
  scheduled_at TEXT,
  sent_at TEXT,
  segment_id TEXT, -- which segment to target
  stats_sent INTEGER DEFAULT 0,
  stats_delivered INTEGER DEFAULT 0,
  stats_read INTEGER DEFAULT 0,
  stats_failed INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Segmentos de leads para campañas
CREATE TABLE IF NOT EXISTS segments (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  filters JSON, -- filter criteria
  lead_count INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Configuración general (enhanced)
CREATE TABLE IF NOT EXISTS config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  category TEXT DEFAULT 'general', -- general, llm, channels, notifications
  description TEXT,
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Handoff logs (when bot escalates to human)
CREATE TABLE IF NOT EXISTS handoff_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER NOT NULL,
  agent_id TEXT NOT NULL,
  reason TEXT NOT NULL, -- why escalation happened
  assigned_to TEXT, -- who it was assigned to
  status TEXT DEFAULT 'pending', -- pending, accepted, completed
  created_at TEXT DEFAULT (datetime('now')),
  resolved_at TEXT,
  FOREIGN KEY (conversation_id) REFERENCES conversations(id),
  FOREIGN KEY (agent_id) REFERENCES agents(id)
);

-- Scheduled follow-ups
CREATE TABLE IF NOT EXISTS followups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id INTEGER NOT NULL,
  conversation_id INTEGER,
  agent_id TEXT NOT NULL,
  channel TEXT NOT NULL,
  chat_id TEXT NOT NULL,
  message TEXT NOT NULL,
  status TEXT DEFAULT 'pending', -- pending, sent, failed, cancelled
  scheduled_at TEXT NOT NULL,
  sent_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (lead_id) REFERENCES leads(id),
  FOREIGN KEY (conversation_id) REFERENCES conversations(id),
  FOREIGN KEY (agent_id) REFERENCES agents(id)
);

-- Bot health logs (for watchdog)
CREATE TABLE IF NOT EXISTS health_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  status TEXT NOT NULL, -- ok, degraded, error
  error_count INTEGER DEFAULT 0,
  last_error TEXT,
  metadata JSON,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Índices mejorados
CREATE INDEX IF NOT EXISTS idx_conversations_chat ON conversations(channel, chat_id);
CREATE INDEX IF NOT EXISTS idx_conversations_agent ON conversations(agent_id);
CREATE INDEX IF NOT EXISTS idx_conversations_status ON conversations(status);
CREATE INDEX IF NOT EXISTS idx_conversations_updated ON conversations(updated_at);
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_messages_role ON messages(role);
CREATE INDEX IF NOT EXISTS idx_knowledge_agent ON knowledge_base(agent_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_published ON knowledge_base(is_published);
CREATE INDEX IF NOT EXISTS idx_leads_agent ON leads(agent_id);
CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status);
CREATE INDEX IF NOT EXISTS idx_leads_followup ON leads(next_followup_at);
CREATE INDEX IF NOT EXISTS idx_tickets_status ON tickets(status);
CREATE INDEX IF NOT EXISTS idx_tickets_priority ON tickets(priority);
CREATE INDEX IF NOT EXISTS idx_tickets_agent ON tickets(agent_id);
CREATE INDEX IF NOT EXISTS idx_usage_agent ON usage_logs(agent_id);
CREATE INDEX IF NOT EXISTS idx_usage_date ON usage_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_insights_conversation ON insights(conversation_id);
CREATE INDEX IF NOT EXISTS idx_campaigns_status ON campaigns(status);
CREATE INDEX IF NOT EXISTS idx_followups_status ON followups(status);
CREATE INDEX IF NOT EXISTS idx_followups_scheduled ON followups(scheduled_at);
CREATE INDEX IF NOT EXISTS idx_health_logs_date ON health_logs(created_at);
