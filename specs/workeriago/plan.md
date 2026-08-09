# Implementation Plan: WorkerIAGO Platform

**Branch**: `main` | **Date**: 2026-08-09 | **Spec**: [spec.md](./spec.md)

## Summary

WorkerIAGO es una plataforma de agentes de IA multicanal que corre 100% en Cloudflare Workers. Usa Hono como framework web, D1 (SQLite) para 28 tablas, Vectorize (768d cosine) para RAG, R2 para backups y archivos, KV para cache, y Workers AI (Llama 3.1 8B + bge-base-en-v1.5) para chat y embeddings. El admin panel es server-rendered con Tailwind CDN + HTMX (22 páginas, 48 POST/DELETE routes).

## Technical Context

**Language/Version**: TypeScript (esbuild via Wrangler 3.72, sin type-check en build)

**Primary Dependencies**: Hono 4.x, `@cloudflare/workers-types`, wrangler 3.72

**Storage**: D1 (`workeriago-db`, 28 tablas SQLite), Vectorize (`workeriago-vectors`, 768d cosine), R2 (`workeriago-storage`), KV (`CACHE`)

**Testing**: Manual — `wrangler dev` + curl/Invoke-WebRequest, `tsc --noEmit` para type checking

**Target Platform**: Cloudflare Workers (edge global, 300+ locations)

**Project Type**: Web service (Worker) + Admin panel (HTML server-rendered) + Webhook handlers + MCP server + Scheduled cron

**Performance Goals**: <50ms p50 admin reads, <500ms p50 AI chat, <5s backup completo

**Constraints**: Sin build step para admin (Tailwind CDN), sin SPA, 128MB memory limit per Worker, 6 CPU seconds per request

**Scale/Scope**: 37 módulos en `src/`, 4800+ líneas en admin/index.ts, 28 tablas D1

## Constitution Check

- ✅ Edge-First: Todo corre en Workers
- ✅ Self-Hosted Privacy: Datos en cuenta del usuario, no telemetry
- ✅ Multi-Channel by Default: 9 channel handlers con interface común
- ✅ RAG-Driven: Orchestrator pipeline con searchKnowledge() obligatorio
- ✅ Admin = Server-Rendered: HTML + Tailwind CDN + HTMX, sin SPA
- ✅ Security Hardening: HMAC cookies, CSRF, SQLi fixed, auditLog
- ✅ Cost Consciousness: 768d embeddings, KV cache, modelos gratuitos

## Project Structure

### Documentation (this feature)

```text
specs/workeriago/
├── plan.md              # This file
├── research.md          # Technical research
├── data-model.md        # 28 D1 tables schema
├── quickstart.md        # Quick start guide
├── contracts/           # API contracts
│   ├── chat-api.md      # POST /api/chat
│   ├── admin-api.md     # Admin POST/DELETE routes
│   ├── webhook-api.md   # Channel webhooks
│   └── mcp-api.md       # MCP server endpoints
└── tasks.md             # Implementation tasks
```

### Source Code (repository root)

```text
agentforge/
├── src/
│   ├── index.ts              # Hono router principal, API endpoints
│   ├── ai.ts                 # Workers AI wrappers (MODELS config)
│   ├── durable-object.ts     # AgentState (session state DO)
│   ├── admin/index.ts        # Admin panel (22 pages, 48 routes, 4800+ lines)
│   ├── orchestrator/         # Agent orchestrator: classify → RAG → MCP → respond
│   ├── channels/             # 9 channel handlers
│   │   ├── telegram.ts       #   Telegram Bot API
│   │   ├── whatsapp.ts       #   WhatsApp Business API
│   │   ├── web.ts            #   Web chat widget
│   │   ├── instagram.ts      #   Meta Graph API
│   │   ├── facebook.ts       #   Messenger API
│   │   ├── email.ts          #   SendGrid SMTP
│   │   ├── sms.ts            #   Twilio
│   │   ├── discord.ts        #   Discord Bot
│   │   └── slack.ts          #   Slack Bot
│   ├── knowledge/            # RAG pipeline: chunk → embed → Vectorize → search
│   ├── mcp/                  # MCP tools engine + server + connectors
│   ├── gateway/              # AI Gateway: cache + log + fallback
│   ├── voice/                # STT + TTS pipeline
│   ├── multimodal/           # OCR + image analysis
│   ├── memory/               # Persistent user memory
│   ├── ab-testing/           # A/B testing engine
│   ├── workflows/            # Multi-agent flow engine
│   ├── auth/rbac.ts          # Roles & permissions
│   ├── compliance/           # Audit logs + GDPR
│   ├── tenant/               # Multi-tenant management
│   ├── monitoring/           # Health checks + alerts
│   ├── backup/               # Backup D1 → R2
│   ├── webhooks/             # Outgoing webhooks
│   ├── actions/              # Action engine (detect + execute)
│   └── integrations/         # e-commerce, calendar, payments, multilang
├── migrations/v3.sql         # 27 tables (health_logs created manually)
├── schema.sql                # Full schema
├── wrangler.toml             # Cloudflare config (bindings)
├── package.json              # Dependencies (Hono, wrangler, types)
├── tsconfig.json             # TypeScript config
└── README.md                 # Full documentation
```

**Structure Decision**: Single Worker project with modular `src/` directories. Each module is a TypeScript file or directory with its own exports. The admin panel (`src/admin/index.ts`) is a Hono sub-app mounted at `/admin`. Channel handlers are mounted at `/webhook/<channel>`. The MCP server is mounted at `/mcp`.

## Architecture Diagram

```
                              ┌──────────────────────────────────────────┐
                              │         CLIENTES (End users)              │
                              │ 📱 WhatsApp · ✈️ Telegram · 🌐 Web       │
                              │ 📸 Instagram · 👥 Facebook · 📧 Email    │
                              │ 📱 SMS · 🎮 Discord · 💼 Slack            │
                              └───────────────┬──────────────────────────┘
                                              │ HTTPS webhooks
                              ┌───────────────┴──────────────────────────┐
                              │         Cloudflare Edge (Workers)         │
                              │                                           │
   Admin Panel ◀──HTTP──┐    │   ┌─────────────────────────────────────┐  │
   (Tailwind+HTMX)      │    │   │     Hono Router (src/index.ts)      │  │
                        │    │   ├─────────────────────────────────────┤  │
                        └────┼──▶│   AdminPanel (src/admin/index.ts)   │  │
                             │   │   22 GET + 48 POST/DELETE routes    │  │
                             │   │   CSRF + HMAC sessions + auditLog   │  │
                             │   ├─────────────────────────────────────┤  │
                             │   │   Channel Handlers (9 channels)     │  │
                             │   ├─────────────────────────────────────┤  │
                             │   │   AgentOrchestrator                  │  │
                             │   │   1. getAgentById(id)               │  │
                             │   │   2. classifyIntent()               │  │
                             │   │   3. searchKnowledge() ───▶ RAG     │  │
                             │   │   4. loadAgentMCPTools() ──▶ MCP    │  │
                             │   │   5. generateAgentResponse()        │  │
                             │   │   6. tool_call execute ───▶ AI      │  │
                             │   │   7. saveConversation() ───▶ D1     │  │
                             │   ├─────────────────────────────────────┤  │
                             │   │   MCP Server (/mcp)                 │  │
                             │   │   AI Gateway (cache+log+fallback)   │  │
                             │   └─────────────────────────────────────┘  │
                              └───────────────┬─────────────────────────┘
                                              │ bindings
              ┌───────────────────────────────┼────────────────────────┐
              │                               │                        │
        ┌─────┴─────┐   ┌─────────────┐  ┌─────┴─────┐   ┌─────────────┴──┐
        │  Workers  │   │   D1 (28    │  │ Vectorize │   │   R2 Bucket    │
        │     AI    │   │   tablas)   │  │  (768-d)  │   │   workeriago   │
        │  Llama 3  │   │ conversations│ │  bge-base │   │   -storage     │
        │  Whisper  │   │ agents       │ │  -en-v1.5 │   │  backups JSON  │
        │  bge-base │   │ knowledge    │ │  (cosine) │   │  media files   │
        └───────────┘   │ mcp_tools    │  └──────────┘   └────────────────┘
                        │ ai_logs      │
        ┌───────────┐   │ tenants      │   ┌────────────┐  ┌──────────────┐
        │     KV     │   │ admin_users  │   │ Durable    │  │  Scheduled   │
        │  CACHE     │   │ audit_logs   │   │ Objects    │  │  (cron 3am)  │
        │ responses  │   │ campaigns    │   │ AGENT_STATE│  │  backup      │
        │ rate limit │   │ connectors   │   │ sessions   │  │  cleanup     │
        └───────────┘   └─────────────┘   └────────────┘  └──────────────┘
```

## Complexity Tracking

No constitution violations. All features comply with stated principles.
