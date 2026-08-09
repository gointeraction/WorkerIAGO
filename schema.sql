-- AgentForge Database Schema

-- Agentes configurados
CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  type TEXT NOT NULL DEFAULT 'general', -- ventas, soporte, reservas, general
  system_prompt TEXT NOT NULL,
  model TEXT NOT NULL DEFAULT '@cf/meta/llama-3.1-8b-instruct',
  temperature REAL DEFAULT 0.7,
  max_tokens INTEGER DEFAULT 512,
  tools JSON, -- JSON array of tool names
  channel_config JSON, -- which channels this agent handles
  is_active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Conversaciones
CREATE TABLE IF NOT EXISTS conversations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_id TEXT NOT NULL,
  channel TEXT NOT NULL, -- telegram, whatsapp, web
  chat_id TEXT NOT NULL, -- channel-specific chat identifier
  user_name TEXT,
  user_phone TEXT,
  status TEXT DEFAULT 'active', -- active, closed, escalated
  intent TEXT, -- classified intent
  sentiment TEXT, -- positive, neutral, negative
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (agent_id) REFERENCES agents(id)
);

-- Mensajes
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER NOT NULL,
  role TEXT NOT NULL, -- user, assistant, system
  content TEXT NOT NULL,
  metadata JSON, -- tokens used, model, latency, etc.
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (conversation_id) REFERENCES conversations(id)
);

-- Base de conocimiento (documentos para RAG)
CREATE TABLE IF NOT EXISTS knowledge_base (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_id TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  category TEXT,
  tags JSON, -- JSON array of tags
  vector_id TEXT, -- reference to Vectorize
  source TEXT, -- url, file, manual
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (agent_id) REFERENCES agents(id)
);

-- Leads capturados
CREATE TABLE IF NOT EXISTS leads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER,
  agent_id TEXT NOT NULL,
  name TEXT,
  phone TEXT,
  email TEXT,
  interest TEXT, -- what they're interested in
  score INTEGER DEFAULT 0, -- lead score 0-100
  status TEXT DEFAULT 'new', -- new, qualified, converted, lost
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (conversation_id) REFERENCES conversations(id),
  FOREIGN KEY (agent_id) REFERENCES agents(id)
);

-- Acciones/disponibles
CREATE TABLE IF NOT EXISTS actions (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  handler TEXT NOT NULL, -- function name to execute
  parameters JSON, -- JSON schema of parameters
  is_active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Logs de usage
CREATE TABLE IF NOT EXISTS usage_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_id TEXT,
  model TEXT,
  tokens_input INTEGER,
  tokens_output INTEGER,
  latency_ms INTEGER,
  channel TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Configuración general
CREATE TABLE IF NOT EXISTS config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Índices
CREATE INDEX IF NOT EXISTS idx_conversations_chat ON conversations(channel, chat_id);
CREATE INDEX IF NOT EXISTS idx_conversations_agent ON conversations(agent_id);
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_agent ON knowledge_base(agent_id);
CREATE INDEX IF NOT EXISTS idx_leads_agent ON leads(agent_id);
CREATE INDEX IF NOT EXISTS idx_usage_agent ON usage_logs(agent_id);
