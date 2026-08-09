# Quickstart: WorkerIAGO

## Prerequisites

- Node.js 18+
- Cloudflare account with Workers, D1, Vectorize, R2, KV enabled
- `npm` or `pnpm`
- `uv` (for spec-kit, optional)

## 1. Clone & Install

```bash
git clone https://github.com/gointeraction/WorkerIAGO mi-agente
cd mi-agente
npm install
```

## 2. Create Cloudflare Resources

```bash
wrangler login

# D1 Database
wrangler d1 create workeriago-db
# Copy the database_id to wrangler.toml

# Vectorize Index (768 dimensions, cosine)
wrangler vectorize create workeriago-vectors --dimensions=768 --metric=cosine

# R2 Bucket
wrangler r2 bucket create workeriago-storage

# KV Namespace
wrangler kv namespace create CACHE
# Copy the namespace_id to wrangler.toml
```

## 3. Apply Database Schema

```bash
# Main schema (27 tables)
wrangler d1 execute workeriago-db --remote --file=./migrations/v3.sql

# Health logs table (not in migrations)
wrangler d1 execute workeriago-db --remote --command "CREATE TABLE IF NOT EXISTS health_logs (id TEXT PRIMARY KEY, service TEXT NOT NULL, status TEXT NOT NULL, latency_ms INTEGER DEFAULT 0, message TEXT, created_at TEXT DEFAULT (datetime('now'))); CREATE INDEX IF NOT EXISTS idx_health_logs_created ON health_logs(created_at);"

# Campaigns table (added later)
wrangler d1 execute workeriago-db --remote --command "CREATE TABLE IF NOT EXISTS campaigns (id TEXT PRIMARY KEY, name TEXT NOT NULL, channel TEXT, message TEXT, segment TEXT DEFAULT 'all', status TEXT DEFAULT 'draft', sent_count INTEGER DEFAULT 0, opened_count INTEGER DEFAULT 0, started_at TEXT, created_at TEXT DEFAULT (datetime('now')));"
```

## 4. Configure Secrets

```bash
# Admin password (set to enable auth + CSRF)
wrangler secret put ADMIN_PASSWORD

# Telegram bot token (if using Telegram)
wrangler secret put TELEGRAM_BOT_TOKEN

# Other channel tokens as needed:
# WHATSAPP_TOKEN, WHATSAPP_PHONE_ID, WHATSAPP_VERIFY_TOKEN
# INSTAGRAM_ACCESS_TOKEN, FACEBOOK_PAGE_TOKEN
# SENDGRID_API_KEY, SENDGRID_FROM_EMAIL
# TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER
# DISCORD_BOT_TOKEN, SLACK_BOT_TOKEN
```

## 5. Deploy

```bash
npx wrangler deploy
```

Your Worker is now live at `https://<your-worker-name>.<your-subdomain>.workers.dev`.

## 6. Verify

```bash
# Admin panel loads
curl https://your-worker.workers.dev/admin

# Health check
curl -X POST https://your-worker.workers.dev/admin/api/health-check
# Expected: {"d1":"ok","kv":"ok","vec":"down","ai":"down","r2":"ok"}

# Chat API
curl -X POST https://your-worker.workers.dev/api/chat \
  -H "Content-Type: application/json" \
  -d '{"message":"hola","chatId":"test"}'
```

## 7. Set Up Your First Agent

1. Open `https://your-worker.workers.dev/admin` in your browser
2. Go to **Agentes** → click "+ Nuevo Agente"
3. Fill in: name, system prompt, model (Llama 3.1 8B), temperature
4. Go to **Knowledge Base** → paste text → save
5. Back in **Agentes** → click "Base de Conocimiento" → link the document
6. Go to **Canales** → activate Telegram (or Web) → configure
7. Test: send a message to your bot

## Local Development

```bash
# Run with local emulators
wrangler dev

# Type checking (wrangler doesn't check types)
npx tsc --noEmit

# View real-time logs
wrangler tail

# Query D1 directly
wrangler d1 execute workeriago-db --remote --command "SELECT * FROM agents"
```

## Spec-Kit Commands

This project includes Spec-Kit for spec-driven development:

```bash
# Install spec-kit CLI (requires uv)
uv tool install specify-cli

# Available slash commands (in your AI coding agent):
# /speckit.constitution - View/update project principles
# /speckit.specify - Create new feature specs
# /speckit.plan - Create implementation plans
# /speckit.tasks - Generate task lists
# /speckit.implement - Execute implementation
```
