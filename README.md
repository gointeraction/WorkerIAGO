# WorkerIAGO

### Plataforma de agentes de IA multicanal — open source, self-hosted en Cloudflare.

**Atiende clientes 24/7 en WhatsApp, Telegram, Web, Instagram, Facebook, Email, SMS, Discord y Slack. RAG con tus documentos, MCP tools, workflows multi-agente, voice, multi-modal, A/B testing, multi-tenant, y más.**

*Self-hosted, open-source AI agent platform. Lives in **your** Cloudflare, uses **your** Workers AI key. Deploy in minutes.*

[![License: MIT](https://img.shields.io/badge/License-MIT-f59e0b.svg)](LICENSE) [![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-f6821f.svg)](https://workers.cloudflare.com/)

[**Instalar**](#-instalar) · [**Arquitectura**](#-arquitectura) · [**Features**](#-features) · [**Stack**](#-stack) · [**API**](#-api) · [**DB**](#-base-de-datos)

---

## Arquitectura

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
                             │   │   20 GET + 30 POST routes           │  │
                             │   ├─────────────────────────────────────┤  │
                             │   │   Channel Handlers (8 channels)     │  │
                             │   │   telegram/whatsapp/web/instagram/  │  │
                             │   │   facebook/email/sms/discord/slack   │  │
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
        ┌───────────┐   │ ab_tests     │   ┌────────────┐  ┌──────────────┐
        │     KV     │   │ tenants      │   │ Durable    │  │  Scheduled   │
        │  CACHE     │   │ admin_users  │   │ Objects    │  │  (cron 3am)  │
        │ responses  │   │ audit_logs   │   │ AGENT_STATE│  │  backup      │
        │ rate limit │   │ health_logs  │   │ sessions   │  │  cleanup     │
        └───────────┘   └─────────────┘   └────────────┘  └──────────────┘
```

### Flujo end-to-end de un mensaje

1. **Usuario** envía mensaje por WhatsApp/Telegram/Web → webhook HTTP a `/webhook/<channel>`
2. **Channel handler** (ej: `src/channels/whatsapp.ts`) recibe el payload, lo normaliza
3. **AgentOrchestrator** (`src/orchestrator/index.ts`) recibe (`message, chatId, channel, agentId`)
4. **getAgentById(agentId)** → busca agente en D1 ( falls back a `getDefaultAgent`)
5. **classifyIntent()** → Llama 3 8B clasifica intención (soporte/ventas/reservas/escalado)
6. **searchKnowledge()** → embedding del mensaje con `bge-base-en-v1.5` (768d) → query Vectorize → filtra por `metadata.agentId` → `buildRagContext()` arma contexto textual
7. **loadAgentMCPTools()** → consulta `agent_tools` JOIN `mcp_tools` → arma system prompt with tool definitions
8. **generateAgentResponse()** → Llama 3.1 8B con system_prompt + RAG context + tool list → AI Gateway cachea en KV
9. **Si respuesta es `TOOL_CALL: <tool> {params}`** → `executeTool()` hace fetch HTTP al endpoint del tool, re-genera respuesta final con resultado inyectado
10. **saveConversation()** → guarda mensaje en `messages`, actualiza `conversations` en D1
11. **Channel handler** envía respuesta al usuario

---

## Instalar

### Opción A — Deploy automático

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/gointeraction/WorkerIAGO)

### Opción B — Manual

```bash
git clone https://github.com/gointeraction/WorkerIAGO mi-agente
cd mi-agente
pnpm install

# Configurar variables de entorno
cp .dev.vars.example .dev.vars
# Editar .dev.vars con tus API keys

# Crear recursos Cloudflare
wrangler login
wrangler d1 create workeriago-db
wrangler vectorize create workeriago-vectors --dimensions=768 --metric=cosine
wrangler r2 bucket create workeriago-storage

# Aplicar schema (28 tablas)
wrangler d1 execute workeriago-db --file=./schema.sql
wrangler d1 execute workeriago-db --remote --file=./migrations/v3.sql

# Crear tabla health_logs (no está en migrations)
wrangler d1 execute workeriago-db --remote --command "CREATE TABLE IF NOT EXISTS health_logs (id TEXT PRIMARY KEY, service TEXT NOT NULL, status TEXT NOT NULL, latency_ms INTEGER DEFAULT 0, message TEXT, created_at TEXT DEFAULT (datetime('now'))); CREATE INDEX IF NOT EXISTS idx_health_logs_created ON health_logs(created_at);"

# Configurar secrets
wrangler secret put ADMIN_PASSWORD
wrangler secret put TELEGRAM_BOT_TOKEN

# Deploy
wrangler deploy
```

### Opción C — Con IA

Abre Claude Code o Cursor y dile: `ármame un chatbot con WorkerIAGO`

---

## Features

### 9 Canales de Comunicación

| Canal | Archivo | Estado | Descripción |
|-------|---------|--------|-------------|
| WhatsApp | `src/channels/whatsapp.ts` | ✅ | Business API con webhooks |
| Telegram | `src/channels/telegram.ts` | ✅ | Bot API con comandos |
| Web | `src/channels/web.ts` | ✅ | Widget de chat embeddable |
| Instagram DM | `src/channels/instagram.ts` | ✅ | Meta Graph API |
| Facebook Messenger | `src/channels/facebook.ts` | ✅ | Meta Graph API |
| Email | `src/channels/email.ts` | ✅ | SendGrid SMTP |
| SMS | `src/channels/sms.ts` | ✅ | Twilio |
| Discord | `src/channels/discord.ts` | ✅ | Bot con slash commands |
| Slack | `src/channels/slack.ts` | ✅ | Bot con interactividad |

**Activación:** Desde `/admin/channels` → botón "Activar" → modal con campos por canal → POST `/admin/channels/save` → guardado en tabla `channel_configs`.

### Multi-Agente

- Agentes especializados (ventas, soporte, reservas)
- CRUD desde `/admin/agents` (crear, editar, activar, desactivar)
- Configurables: nombre, system prompt, modelo, temperatura, max tokens, tools
- Vinculación a base de conocimiento vía tabla `agent_knowledge`
- Vinculación a MCP tools vía tabla `agent_tools`
- Routing de chat por `agentId` ( si no se pasa, usa el primero activo)

### RAG (Retrieval-Augmented Generation)

**Operativo end-to-end verificado:**

1. **Ingesta de documents**:
   - Upload de archivo (PDF/txt) → guardado en R2 → chunking
   - Importar URL → fetch HTML → extracción de texto → chunking
   - Texto pegado directamente → chunking
2. **Chunking**: divide texto en fragmentos de ~512 chars con overlap
3. **Embeddings**: `@cf/baai/bge-base-en-v1.5` (768 dimensiones, inglés-compatible)
4. **Vectorize**: index `workeriago-vectors` (768d, cosine similarity)
5. **Búsqueda semántica**: query → embedding → `VECTORIZE.query()` → filtrado por `metadata.agentId` → top 5 results
6. **Context builder**: `buildRagContext()` arma texto formateado con `[Fuente N: Título | Score: XX%]\n<content>`
7. **Inyección en LLM**: el contexto se concatena al system_prompt antes de la generación

**Endpoints**:
- `POST /api/knowledge/:agentId` — crear documento + embedding + link al agente
- `GET /api/knowledge/:agentId` — listar documentos del agente
- `POST /admin/knowledge/upload` — upload de archivo
- `POST /admin/knowledge/import-url` — importar desde URL
- `POST /admin/knowledge/save-text` — guardar texto pegado
- `POST /admin/api/knowledge/:id/reindex` — regenerar embeddings

### MCP Tools (Model Context Protocol)

**Integrados en el orchestrator — operativos:**

1. **Crear tools** desde `/admin/mcp-tools` con JSON Schema para parámetros
2. **Tipos de handler**: HTTP ( endpoint URL + método)
3. **Auth**: none, API key ( Bearer ), Bearer token, OAuth2
4. **Retry + rate limiting + timeout** configurables por tool
5. **Test desde admin**: `POST /admin/api/mcp-tools/:id/test` ejecuta el tool con parámetros de prueba
6. **Link al agente** vía tabla `agent_tools` ( un agente puede tener N tools)
7. **Integración en chat**:
   - El orchestrator carga los tool definitions al generar respuesta
   - El system prompt incluye el formato `TOOL_CALL: <tool_id> <json_params>`
   - Llama 3 intenta responder con `TOOL_CALL: echo {"message":"hola"}`
   - El orchestrator intercepta, ejecuta el tool ( HTTP fetch ), re-genera respuesta con resultado
8. **MCP Server público**:
   - `GET /mcp` — manifest de servidor
   - `GET /mcp/tools` — lista tools disponibles
   - `POST /mcp/call` — ejecutar tool por ID

**Tablas**: `mcp_tools`, `agent_tools`, `tool_execution_logs`

### AI Gateway (Observabilidad)

**Módulo `src/gateway/index.ts`:**

- **Logging**: cada request a Workers AI se loguea en `ai_logs` (modelo, tokens input/output, latencia, costo estimado, éxito/error)
- **Cache**: respuestas cacheadas en KV por hash del prompt ( ahorra invocaciones a LLM)
- **Rate limiting**: por agente, con límites configurables
- **Fallback chain**: si un modelo falla, intenta con el siguiente ( e.g. Llama 3.3 70B → Llama 3.1 8B → Llama 3.2 3B)
- **Dashboard** en `/admin/ai-gateway` con métricas de 30 días

### Voice Agent

**Módulo `src/voice/index.ts` — configuración desde `/admin/voice`:**

- **STT (Speech-to-Text)**: Whisper Tiny / Whisper Large
- **TTS (Text-to-Speech)**: Piper TTS con voces ( default, female-ES, male-ES, female-EN)
- **Configuración persistente** guardada en tabla `config` key `voice_config`
- **POST `/admin/voice/save`** — guarda config de STT y TTS
- **POST `/admin/voice/test-tts`** — prueba síntesis de texto
- Pipeline: audio → Whisper → transcripción → AI response → Piper → audio playback

### Multi-Modal

**Módulo `src/multimodal/index.ts`:**

- **OCR** de imágenes ( documentos, facturas, recibos ) con Workers AI vision
- **Análisis de productos** para e-commerce ( descripción, categoría, precio)
- **Clasificación de imágenes** con `distilbert-sst-2`
- **Búsqueda visual** con embeddings de imágenes

### Memoria Persistente

**Módulo `src/memory/index.ts`:**

- Extracción automática de hechos, preferencias y datos del usuario
- Tabla `user_memories` ( `user_id`, `key`, `value`, `type`, `confidence`)
- Contexto inyectado en cada conversación ( el agente "recuerda" al usuario)
- Actualización incremental vía LLM después de cada interacción

### Integraciones Externas

**Módulo `src/integrations/`:**

- **E-commerce** (`ecommerce.ts`): Shopify y WooCommerce — buscar productos, verificar stock, crear pedidos, formatear catálogo para chat
- **Calendario** (`calendar.ts`): Google Calendar — verificar disponibilidad, crear/cancelar eventos, reservas desde el chat
- **Pagos** (`payments.ts`): Stripe y MercadoPago — crear links de pago, verificar estado, generar facturas
- **Multi-Idioma** (`multilang.ts`): detección automática + traducción de respuestas, responder en el mismo idioma

### A/B Testing

**Módulo `src/ab-testing/index.ts` + admin `/admin/ab-testing`:**

- Crear tests con 2 variantes ( A y B ) cada una con su prompt
- Split de tráfico determinístico ( porcentaje configurable para variante B)
- Métricas por variante ( impresiones, conversiones, score)
- Estados: `draft` → `running` → `completed`
- **POST routes**:
  - `/admin/ab-testing/save` — crear test
  - `/admin/ab-testing/:id/start` — iniciar test
  - `/admin/ab-testing/:id/stop` — parar test
  - `/admin/ab-testing/:id/delete` — eliminar test
- Registro de eventos en tabla `ab_events`

### Workflows Multi-Agente

**Módulo `src/workflows/index.ts`:**

- Flujos de múltiples pasos con state persistente
- Tipos de step: `agent` ( invoca agente), `tool` ( ejecuta MCP ), `condition` ( branching ), `parallel` ( ramas simultáneas ), `transform` ( mutating context)
- Templates predefinidos
- Ejecución con retry y estado persistente en tabla `workflow_runs`
- **POST `/admin/api/workflows/:id/run`** — ejecutar workflow manualmente
- Dashboard en `/admin/workflows`

### Conectores

**Módulo `src/mcp/connectors.ts` + admin `/admin/connectors`:**

- **Google Drive**: sincronizar documentos desde Drive → Knowledge Base
- **Notion**: importar páginas como documentos
- **RSS**: feed → documentos recurrentes
- Tabla `connectors` con `sync_status`, `last_sync_at`, `items_synced`

### Webhooks + API Pública

**Módulo `src/webhooks/index.ts`:**

- Webhooks para eventos: `conversation.created`, `lead.captured`, `ticket.closed`, `tool.executed`
- API REST pública para integración externa
- Verificación HMAC de payloads entrantes
- Tabla `webhooks` con `url`, `events`, `secret`, `is_active`

### Multi-Tenant

**Módulo `src/tenant/index.ts` + admin `/admin/tenants`:**

- Varias empresas en una sola instancia
- Planes: `free`, `starter`, `pro`, `enterprise`
- Límites por plan ( `max_agents`, `max_messages_month`, `max_knowledge`) en JSON `limits`
- Resolución por custom domain o header `X-Tenant-Slug`
- **POST routes**:
  - `/admin/tenants/save` — crear tenant
  - `/admin/tenants/:id/delete` — eliminar tenant
- Tabla `tenants` con `id`, `name`, `slug`, `plan`, `status`, `config`, `limits`, `owner_email`

### RBAC (Roles y Permisos)

**Módulo `src/auth/rbac.ts` + admin `/admin/users`:**

- **Roles**: Super Admin, Admin, Editor, Viewer
- Permisos granulares por recurso ( agents, kb, tools, tenants, users, audit)
- Gestión de usuarios desde admin con `email`, `name`, `role`, `permissions`
- **POST routes**:
  - `/admin/users/save` — invitar usuario
  - `/admin/users/:id/delete` — eliminar usuario
- Auth del admin: cookie-based (`admin_session`) con fallback a Bearer token para API

### Audit Logs

**Módulo `src/compliance/index.ts` + admin `/admin/audit`:**

- Track de todas las acciones admin ( quien, que, cuando, IP)
- Tabla `audit_logs` con `user_email`, `action`, `resource`, `resource_id`, `ip`, `metadata`
- Filtros por usuario, recurso, fecha

### GDPR (Cumplimiento)

**Módulo `src/compliance/index.ts`:**

- **Export** de datos de usuario ( right to portability) — genera JSON con todas las conversaciones, mensajes, memories
- **Delete** de datos de usuario ( right to erasure) — borra todas las references
- Reporte de retención de datos por tipo

### Monitoring + Alertas

**Módulo `src/monitoring/index.ts` + admin `/admin/monitoring`:**

- **Health checks** reales de 5 servicios:
  - **D1**: `SELECT 1`
  - **KV**: `CACHE.put()` + `CACHE.get()`
  - **Vectorize**: `VECTORIZE.query()` con vector dummy
  - **AI**: `AI.run()` con 1 token
  - **R2**: `STORAGE.head()` de objeto probe
- **POST `/admin/api/health-check`** — ejecuta todos los checks, retorna JSON `{d1, kv, vec, ai, r2}` con status y latencia
- Alertas automáticas: si un servicio cae, se inserta alerta `critical` en `monitoring_alerts`
- **POST `/admin/monitoring/:id/ack`** — acknowledge de alerta
- Tabla `health_logs` ( creada manualmente) registra cada health check con status overall

### Backup Automático

**Módulo `src/backup/index.ts` + admin `/admin/backups`:**

- **POST `/admin/api/backup`** — backup completo de las 28 tablas:
  - SELECT * de cada tabla
  - Ensambla JSON con todos los datos
  - Sube a R2 bucket en `backups/<id>.json`
  - Registra metadata en `backup_logs` ( tablas, filas, tamaño, status)
- **POST `/admin/api/backup/:id/restore`** — restaurar desde R2
- **POST `/admin/api/backup/:id/delete`** — eliminar backup
- Retención: 30 días ( backup_logs viejos se purgan)
- Cron scheduled a las 3am UTC ejecuta backup automático
- Dashboard con historial de backups + botones restaurar/eliminar

### Scheduled (Cron)

```toml
[scheduled]
cron = "0 3 * * *"
```

Tareas automáticas diarias:
- Backup completo → R2
- Cleanup de logs viejos (>30 días)
- Recálculo de métricas agregadas
- Health check programado

### Admin Dashboard (GIM Design Extendido)

**20 páginas operativas** en `/admin/<page>`:

| # | Página | URL | POST routes |
|---|--------|-----|-------------|
| 1 | 📊 Resumen | `/admin` | — |
| 2 | 💬 Conversaciones | `/admin/conversations` | `/admin/conversations/:id/reply`, `/pause`, `/escalate` |
| 3 | 🎫 Tickets | `/admin/tickets` | `/admin/tickets/:id/status` |
| 4 | 👥 Leads | `/admin/leads` | `/admin/leads/:id/status` |
| 5 | 📚 Knowledge Base | `/admin/knowledge` | `/admin/knowledge/upload`, `/import-url`, `/save-text` |
| 6 | 🤖 Agentes | `/admin/agents` | `/admin/agents/save`, `/admin/agents/:id/kb/attach/:kbId`, `/admin/agents/kb/link` |
| 7 | 🔧 MCP Tools | `/admin/mcp-tools` | `/admin/mcp-tools/save`, `/admin/api/mcp-tools/:id/test` |
| 8 | 📊 AI Gateway | `/admin/ai-gateway` | — |
| 9 | ⚡ Workflows | `/admin/workflows` | `/admin/api/workflows/:id/run` |
| 10 | 🔌 Conectores | `/admin/connectors` | — |
| 11 | 💡 Insights | `/admin/insights` | — |
| 12 | 📢 Campañas | `/admin/campaigns` | — |
| 13 | 💰 Costos | `/admin/costs` | — |
| 14 | 📡 Canales | `/admin/channels` | `/admin/channels/save`, `/admin/channels/:type/deactivate` |
| 15 | 🎙️ Voz | `/admin/voice` | `/admin/voice/save`, `/admin/voice/test-tts` |
| 16 | 🧪 A/B Testing | `/admin/ab-testing` | `/admin/ab-testing/save`, `/:id/start`, `/:id/stop`, `/:id/delete` |
| 17 | 🩺 Monitoring | `/admin/monitoring` | `/admin/api/health-check`, `/admin/monitoring/:id/ack` |
| 18 | 💾 Backups | `/admin/backups` | `/admin/api/backup`, `/api/backup/:id/restore`, `/api/backup/:id/delete` |
| 19 | 🏢 Tenants | `/admin/tenants` | `/admin/tenants/save`, `/admin/tenants/:id/delete` |
| 20 | 👤 Usuarios | `/admin/users` | `/admin/users/save`, `/admin/users/:id/delete` |
| 21 | 📋 Audit Log | `/admin/audit` | — |
| 22 | ⚙️ Configuración | `/admin/config` | `/admin/config/save` |

**Stack visual**: Tailwind CSS via CDN, HTMX para reactividad, paleta GIM ( orange `#f97316`, cyan `#06b6d4`, purple `#a855f7`), gradientes y cards con sombras suaves.

---

## Stack

| Componente | Servicio Cloudflare | Binding | Descripción |
|------------|---------------------|---------|-------------|
| **Runtime** | Workers | — | Edge computing, ejecución global |
| **Framework** | Hono | — | Router minimalista TypeScript-first |
| **IA** | Workers AI | `AI` | Llama 3.1 8B, Llama 3.2 3B, Llama 3.3 70B, Whisper, bge-base-en-v1.5 |
| **RAG** | Vectorize | `VECTORIZE` | `workeriago-vectors` 768-d cosine |
| **Database** | D1 | `DB` | `workeriago-db` — 28 tablas SQLite |
| **Storage** | R2 | `STORAGE` | `workeriago-storage` — archivos, backups JSON |
| **Cache** | KV | `CACHE` | respuestas AI cacheadas, rate limiting |
| **Estado** | Durable Objects | `AGENT_STATE` | `AgentState` class — sesiones con SQLite embebido |
| **Scheduled** | Cron Triggers | — | `0 3 * * *` — backup diario, cleanup |
| **Admin** | HTML + Tailwind + HTMX | — | Dashboard, no SPA, server-rendered con Hono |

### Modelos de IA

| Modelo | Uso | Dim/Ctx | Costo aprox. |
|--------|-----|---------|--------------|
| `@cf/meta/llama-3.1-8b-instruct-fp8` | Chat principal | 8K | ~$0.05/1M tokens |
| `@cf/meta/llama-3.2-3b-instruct` | Clasificación, routing | 2K | ~$0.01/1M tokens |
| `@cf/meta/llama-3.3-70b-instruct-fp8-fast` | Conversaciones complejas | 128K | ~$0.59/1M tokens |
| `@cf/openai/whisper-tiny-en` | STT | — | Gratis ( 10K/día) |
| `@cf/baai/bge-base-en-v1.5` | Embeddings RAG | 768 dim | Gratis |
| `@cf/baai/bge-large-en-v1.5` | Embeddings grandes | 1024 dim | Gratis |
| `@cf/stabilityai/stable-diffusion-xl-base-1.0` | Generación de imágenes | — | ~$0.03 imagen |
| `@cf/huggingface/distilbert-sst-2-integer-quantized` | Clasificación | — | Gratis |

### Estructura del Código (35 módulos)

```
src/
├── index.ts              # Hono router principal, endpoints API
├── ai.ts                 # Wrappers de Workers AI
├── durable-object.ts     # AgentState (sesiones stateful)
├── admin/index.ts        # Admin panel (20+ páginas, 30+ POST routes)
├── orchestrator/         # Lógica central: classify → RAG → MCP → response
├── channels/             # 9 handlers de canal
├── knowledge/            # RAG pipeline: chunk → embed → Vectorize → search
├── mcp/                  # MCP tools engine + server + connectors
├── gateway/              # AI Gateway: cache + log + fallback
├── voice/                # STT + TTS pipeline
├── multimodal/           # OCR + image analysis
├── memory/               # Memoria persistente de usuario
├── ab-testing/           # A/B testing engine
├── workflows/            # Multi-agent flow engine
├── auth/rbac.ts          # Roles y permisos
├── compliance/           # Audit logs + GDPR
├── tenant/               # Multi-tenant management
├── monitoring/           # Health checks + alertas
├── backup/               # Backup D1 → R2
├── webhooks/             # Webhooks salientes
├── actions/              # Action engine (detect + execute)
└── integrations/         # e-commerce, calendario, pagos, multilang
```

---

## API

### REST API pública

| Endpoint | Método | Body / Query | Descripción |
|----------|--------|-----------|-------------|
| `/` | GET | — | Health check |
| `/api/test-ai` | GET | — | Test que AI binding funciona |
| `/api/test-rag` | POST | `{agentId, query}` | Test RAG end-to-end ( debug) |
| `/api/chat` | POST | `{message, chatId, agentId}` | Chat con agente ( returns response, agent, intent, sources) |
| `/api/agents` | GET | — | Lista todos los agentes |
| `/api/agents` | POST | `{name, type, system_prompt, model, tools}` | Crear agente |
| `/api/agents/:id` | GET | — | Detalle de un agente |
| `/api/agents/:id` | PUT | `{name, system_prompt, ...}` | Actualizar agente |
| `/api/knowledge/:agentId` | GET | — | Lista documentos KB del agente |
| `/api/knowledge/:agentId` | POST | `{title, content, category, source}` | Crear documento + embedding + link |
| `/api/conversations` | GET | — | Lista conversaciones recientes |
| `/api/conversations/:id/messages` | GET | — | Historial de mensajes |
| `/api/leads` | GET | — | Lista leads |
| `/api/stats` | GET | — | Stats del dashboard |

### MCP Server ( público)

| Endpoint | Método | Descripción |
|----------|--------|-------------|
| `/mcp` | GET | Manifest del servidor MCP |
| `/mcp/tools` | GET | Lista de tools disponibles |
| `/mcp/call` | POST | Ejecutar tool por ID |

### Webhooks ( entrantes)

| Endpoint | Método | Descripción |
|----------|--------|-------------|
| `/webhook/telegram` | POST | Webhook de Telegram Bot |
| `/webhook/whatsapp` | POST | Webhook de WhatsApp Business |
| `/webhook/instagram` | POST | Webhook de Instagram DM |
| `/webhook/facebook` | POST | Webhook de Facebook Messenger |

### Admin Panel API ( requiere cookie auth o Bearer token)

Ver tabla "Admin Dashboard" ( más arriba) para todos los endpoints de admin.

Auth middleware ( `src/admin/index.ts`):
- Cookie `admin_session=authenticated` — si `ADMIN_PASSWORD` configurada
- Header `Authorization: Bearer <password>` — para API clients
- Sin auth si `ADMIN_PASSWORD` no configurada ( modo demo)

---

## Base de Datos (28 tablas)

| # | Tabla | Descripción | Schema key |
|---|-------|-------------|------------|
| 1 | `agents` | Agentes IA | `id TEXT PK, system_prompt, model, tools JSON` |
| 2 | `conversations` | Conversaciones por canal | `id INTEGER PK, agent_id, channel, chat_id, status, intent` |
| 3 | `messages` | Mensajes de conversaciones | `id INTEGER PK, conversation_id, role, content` |
| 4 | `tickets` | Tickets de soporte | `id INTEGER PK, conversation_id, agent_id, title, status` |
| 5 | `leads` | Leads capturados del chat | `id INTEGER PK, conversation_id, name, phone, score` |
| 6 | `knowledge_base` | Documentos para RAG | `id INTEGER PK AUTOINC, agent_id, title, content, vector_id` |
| 7 | `knowledge_chunks` | Fragmentos de documentos | `id TEXT PK, kb_id, chunk_index, content, vector_id` |
| 8 | `agent_knowledge` | Link agente ↔ KB | `agent_id, kb_id` ( composite PK) |
| 9 | `mcp_tools` | Herramientas MCP | `id TEXT PK, name, endpoint_url, parameters_schema JSON` |
| 10 | `agent_tools` | Link agente ↔ tools | `agent_id, tool_id` |
| 11 | `tool_execution_logs` | Logs de ejecución de tools | `id INTEGER PK, tool_id, status, latency_ms` |
| 12 | `ai_logs` | Observabilidad AI | `id INTEGER PK, model, input_tokens, output_tokens, cost` |
| 13 | `usage_logs` | Uso agregado | `id INTEGER PK, agent_id, date, input_tokens, cost` |
| 14 | `config` | Configuración global | `key TEXT PK, value TEXT` |
| 15 | `workflows` | Flujos multi-agente | `id TEXT PK, name, steps JSON, trigger_type` |
| 16 | `workflow_runs` | Ejecuciones de workflow | `id TEXT PK, workflow_id, status, current_step` |
| 17 | `connectors` | Conectores externos | `id TEXT PK, name, type, is_active, config JSON` |
| 18 | `ab_tests` | Tests A/B | `id TEXT PK, name, variants JSON, traffic_split JSON` |
| 19 | `ab_events` | Eventos de A/B | `id INTEGER PK, test_id, variant_id, event_type` |
| 20 | `webhooks` | Webhooks registrados | `id TEXT PK, url, events JSON, secret, is_active` |
| 21 | `admin_users` | Usuarios admin | `id TEXT PK, email, name, role, password_hash` |
| 22 | `audit_logs` | Audit trail | `id TEXT PK, user_email, action, resource, ip` |
| 23 | `user_memories` | Memoria persistente | `id TEXT PK, user_id, key, value, type` |
| 24 | `tenants` | Multi-tenant | `id TEXT PK, name, slug, plan, limits JSON` |
| 25 | `monitoring_alerts` | Alertas de monitoring | `id TEXT PK, type, severity, message, acknowledged` |
| 26 | `backup_logs` | Logs de backup | `id TEXT PK, type, status, tables JSON, total_rows` |
| 27 | `channel_configs` | Config de canales | `id TEXT PK, channel_type, is_active, config JSON` |
| 28 | `health_logs` | Health checks | `id TEXT PK, service, status, latency_ms` |

---

## Variables de Entorno

Configurar con `wrangler secret put <NOMBRE>`:

```bash
# Seguridad
ADMIN_PASSWORD=tu-contraseña       # Contraseña del admin ( si no set, no auth)

# Canales ( opcionales - solo los que uses)
TELEGRAM_BOT_TOKEN=token-de-telegram
WHATSAPP_TOKEN=token-de-whatsapp
WHATSAPP_PHONE_ID=phone-id
WHATSAPP_VERIFY_TOKEN=verify-token
INSTAGRAM_ACCESS_TOKEN=token
FACEBOOK_PAGE_TOKEN=token
SENDGRID_API_KEY=sg.xxx
SENDGRID_FROM_EMAIL=bot@tudominio.com
TWILIO_ACCOUNT_SID=ACxxx
TWILIO_AUTH_TOKEN=xxx
TWILIO_PHONE_NUMBER=+1234567890
DISCORD_BOT_TOKEN=xxx
SLACK_BOT_TOKEN=xoxb-xxx

# Integraciones ( opcionales)
SHOPIFY_API_KEY=xxx
STRIPE_SECRET_KEY=sk_xxx
MERCADOPAGO_ACCESS_TOKEN=APP_USR-xxx
GOOGLE_CALENDAR_CLIENT_ID=xxx

# Operación ( opcionales)
WARMUP_SECRET=secreto-de-warmup
```

Las **vars estáticas** ( en `wrangler.toml`): `ENVIRONMENT`, `BOT_NAME`, `BUSINESS_NAME`, `BOT_LANGUAGE`, `BUFFER_SECONDS`, `DASHBOARD_BASE_URL`.

---

## Privacidad

**Nadie más que tú.** WorkerIAGO corre en TU cuenta de Cloudflare:

- Conversaciones en tu D1
- Documentos en tu R2
- Embeddings en tu Vectorize
- IA usa TU llave ( pagas solo lo que piensa)
- **No envía telemetría a nadie**
- Logs solo van a Cloudflare ( tu cuenta)
- Si preguntan si es un bot, **lo admite**

---

## Costos

| Servicio | Gratis hasta | Costo después |
|----------|-------------|---------------|
| Workers | 100K requests/día | $5/10M requests |
| D1 | 5GB + 5M lecturas/día | $0.75/GB + $0.001/1K writes |
| Vectorize | 10M vectors query/día | $0.01/mes/millón vectores |
| R2 | 10GB + 1M Class A | $0.015/GB |
| KV | 100K lecturas/día | $0.50/millón |
| Workers AI | 10K requests/día | Llama 3 8B: $0.05/1M tokens |

**Total típico: ~$1-5/mes** para un negocio pequeño-mediano con ~1000 conversaciones/día.

---

## Desarrollo

```bash
pnpm install
pnpm run dev          # wrangler dev local con emuladores
pnpm run typecheck    # tsc --noEmit
pnpm test             # tests ( si existen)
wrangler deploy       # Deploy a Cloudflare production
wrangler tail         # Ver logs en tiempo real
wrangler d1 execute workeriago-db --remote --command "SELECT * FROM agents"
wrangler vectorize list
wrangler r2 bucket list
```

### Recursos Cloudflare

| Recurso | Nombre | ID |
|---------|--------|-----|
| D1 Database | workeriago-db | `98d488d9-41ed-48b8-b972-593379718782` |
| Vectorize Index | workeriago-vectors | 768d, cosine |
| R2 Bucket | workeriago-storage | — |
| KV Namespace | CACHE | `d6e50404a6ab4ddaabcecc323acaaa40` |
| Durable Object | AgentState | SQLite embebido |

---

## Estado Actual ( verificado)

| Componente | Estado | Notas |
|-----------|--------|-------|
| Chat IA end-to-end | ✅ Operativo | Llama 3.1 8B + RAG + MCP |
| RAG con Vectorize | ✅ Operativo | bge-base-en-v1.5, 768d, cosine |
| MCP Tools en chat | ✅ Operativo | TOOL_CALL detection + execute |
| Admin Panel | ✅ Operativo | 22 páginas, todos POST routes |
| Health checks | ✅ Operativo | D1/KV/Vectorize/AI/R2 reales |
| Backup D1 → R2 | ✅ Operativo | 28 tablas, JSON en R2 |
| Worker live | ✅ Deploy | `https://workeriago.ibohorquez.workers.dev` |

### Commits recientes

- `fa290dc` — Integrate MCP tools in orchestrator
- `2a20d37` — Fix RAG: agentId routing + 768-dim embedding match
- `003a3a8` — Add POST routes for all 5 new pages
- `f5ed172` — Add tenant/user create+delete routes
- `3c71f3b` — Add 8 admin pages

---

## Licencia

[MIT](LICENSE) © WorkerIAGO

**Hecho para la comunidad de habla hispana** · [gointeraction](https://github.com/gointeraction)
