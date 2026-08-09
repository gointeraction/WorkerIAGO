# WorkerIAGO

### Plataforma de agentes de IA multicanal — open source, self-hosted en Cloudflare.

**Atiende clientes 24/7 en WhatsApp, Instagram, Facebook, Telegram, email, SMS, Discord y Slack. RAG con tus documentos, MCP tools, workflows multi-agente, voice, multi-modal, y más.**

*Self-hosted, open-source AI agent platform. Lives in **your** Cloudflare, uses **your** AI key. Deploy in minutes.*

[![License: MIT](https://img.shields.io/badge/License-MIT-f59e0b.svg)](LICENSE) [![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-f6821f.svg)](https://workers.cloudflare.com/)

[**Deploy**](#-instalar) · [**Features**](#-features) · [**Stack**](#-stack) · [**API**](#-api)

---

## Arquitectura

```
┌─────────────────────────────────────────────────────────┐
│                  Cloudflare AI Gateway                   │
├─────────────────────────────────────────────────────────┤
│                    Workers AI (LLMs)                     │
├─────────────────────────────────────────────────────────┤
│            Hono Worker (Principal + Admin)               │
│  ┌──────────┬──────────┬───────────┬─────────────────┐  │
│  │  Canales │  MCP Srv │ Workflows │  Admin Panel    │  │
│  │  8 canales│  Tools  │  Multi-ag │  HTMX + Tailwind│  │
│  └──────────┴──────────┴───────────┴─────────────────┘  │
├─────────────────────────────────────────────────────────┤
│  Durable Objects │  Queues  │  R2 (Archivos)           │
│  (Sesiones)      │ (Async)  │  (PDFs, imágenes)        │
├─────────────────────────────────────────────────────────┤
│         D1 (27 tablas) + Vectorize (RAG)               │
└─────────────────────────────────────────────────────────┘
```

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
wrangler vectorize create workeriago-vectors --dimensions=1024 --metric=cosine
wrangler r2 bucket create workeriago-storage

# Aplicar schema
wrangler d1 execute workeriago-db --file=./schema.sql
wrangler d1 execute workeriago-db --remote --file=./migrations/v3.sql

# Deploy
wrangler deploy
```

### Opción C — Con IA

Abre Claude Code o Cursor y dile: `ármame un chatbot con WorkerIAGO`

---

## Features

### 8 Canales de Comunicación
| Canal | Estado | Descripción |
|-------|--------|-------------|
| WhatsApp | ✅ | Business API con webhooks |
| Telegram | ✅ | Bot API con comandos |
| Web | ✅ | Widget de chat embeddable |
| Instagram DM | ✅ | Meta Graph API |
| Facebook Messenger | ✅ | Meta Graph API |
| Email | ✅ | SendGrid SMTP |
| SMS | ✅ | Twilio |
| Discord | ✅ | Bot con slash commands |
| Slack | ✅ | Bot con interactividad |

### Multi-Agente
- Agentes especializados (ventas, soporte, reservas)
- Editar, activar, duplicar, eliminar desde admin
- System prompt, modelo, temperatura configurables
- Vinculación a base de conocimiento por agente

### RAG (Retrieval-Augmented Generation)
- Subir documentos (archivo, URL, texto)
- Chunking automático + embeddings con Workers AI (`bge-m3`)
- Búsqueda semántica en Vectorize
- Agentes buscan contexto automáticamente antes de responder
- Storage de archivos en R2

### MCP Tools (Model Context Protocol)
- CRUD de tools con JSON Schema
- Ejecución con retry + rate limiting
- Test de tools desde admin
- **MCP Server** en `/mcp` — expone agentes y tools como endpoints
- Auth: API key, Bearer token, OAuth2

### Voice Agent
- **STT**: Whisper (speech-to-text)
- **TTS**: Piper (text-to-speech)
- Procesamiento de mensajes de voz en WhatsApp/Telegram
- Pipeline completo: audio → transcripción → respuesta → audio

### Multi-Modal
- OCR de imágenes (documentos, facturas, recibos)
- Análisis de productos para e-commerce
- Clasificación de imágenes
- Búsqueda visual con embeddings

### Memoria Persistente
- El agente recuerda datos del usuario entre sesiones
- Extracción automática de hechos y preferencias
- Contexto inyectado en cada conversación

### E-commerce
- Integración con Shopify y WooCommerce
- Buscar productos, verificar stock, crear pedidos
- Formateo de catálogo para chat

### Calendario
- Google Calendar — verificar disponibilidad
- Crear/cancelar eventos
- Reservas desde el chat

### Pagos
- Stripe y MercadoPago
- Crear links de pago desde chat
- Verificar estado de pagos
- Generar facturas

### Multi-Idioma
- Detección automática de idioma
- Traducción de respuestas
- Responder en el mismo idioma del usuario

### A/B Testing
- Crear variantes de respuesta
- Split de tráfico determinístico
- Métricas de conversión por variante
- Detección automática de ganador

### Workflows Multi-Agente
- Flujos de múltiples pasos
- Tipos: agent, tool, condition, parallel, transform
- Templates predefinidos
- Ejecución con retry + estado persistente

### Webhooks + API Pública
- Webhooks para eventos (conversation.created, lead.captured, etc.)
- API REST para integración externa
- Verificación HMAC de payloads

### AI Gateway (Observabilidad)
- Logging de cada request (modelo, tokens, latencia, costo)
- Cache de respuestas por prompt hash
- Rate limiting por agente
- Fallback chain entre modelos
- Dashboard de métricas 30 días

### Multi-Tenant
- Varias empresas en una instancia
- Planes: Free, Starter, Pro, Enterprise
- Límites por recurso (agentes, mensajes, docs, canales)
- Resolución por custom domain o header

### RBAC (Roles y Permisos)
- Super Admin, Admin, Editor, Viewer
- Permisos granulares por recurso
- Gestión de usuarios desde admin

### Audit Logs
- Track de todas las acciones admin
- Quién hizo qué, cuándo, desde dónde
- Filtros por usuario, recurso, fecha

### GDPR
- Exportar datos de usuario (right to portability)
- Borrar datos de usuario (right to erasure)
- Reporte de retención de datos

### Monitoring + Alertas
- Health checks: D1, KV, Vectorize, AI, R2
- Alertas automáticas (error rate, downtime)
- Métricas: requests/día, top models, peak hours
- Scheduled health checks cada 5 minutos

### Backup Automático
- Full backup de todas las tablas → JSON en R2
- Restore desde cualquier backup
- Retention policy (30 días)
- Export como JSON descargable

### Admin Dashboard (GIM Design)
- 📊 Resumen — métricas principales
- 💬 Conversaciones — inbox con thread panel
- 🎫 Tickets — sistema de soporte
- 👥 Leads — scoring y seguimiento
- 📚 Knowledge Base — upload, search, RAG
- 🤖 Agentes — CRUD + KB linking
- 🔧 MCP Tools — CRUD + test
- 📊 AI Gateway — analytics y costs
- ⚡ Workflows — multi-agent flows
- 🔌 Conectores — Google Drive, Notion, RSS
- 💰 Costos — tracking de uso
- ⚙️ Configuración — settings

---

## Stack

| Componente | Servicio Cloudflare | Descripción |
|------------|---------------------|-------------|
| **Runtime** | Workers (Hono) | Edge computing, ejecución global |
| **IA** | Workers AI | Llama, Mistral, Whisper, Piper, embeddings |
| **RAG** | Vectorize (bge-m3) | Búsqueda semántica |
| **Database** | D1 (SQLite) | 27 tablas, datos estructurados |
| **Storage** | R2 | Archivos, backups, documentos |
| **Cache** | KV | Respuestas cacheadas, rate limiting |
| **Estado** | Durable Objects | Memoria de conversaciones |
| **Observabilidad** | AI Gateway | Logging, cache, rate limiting |
| **Admin** | HTML + Tailwind + HTMX | Dashboard en tiempo real |

### Modelos de IA

| Modelo | Velocidad | Costo aprox. | Uso |
|--------|-----------|--------------|-----|
| Llama 3.2 3B | ⚡ Muy rápido | ~$0.001/1K tokens | Clasificación, routing |
| Llama 3.1 8B | ⚡ Rápido | ~$0.05/1K tokens | Uso general |
| Llama 3.3 70B | 🐢 Lento | ~$0.59/1K tokens | Conversaciones complejas |
| Whisper | ⚡ Rápido | Gratis | Speech-to-Text |
| bge-m3 | ⚡ Rápido | Gratis | Embeddings |

---

## API

### REST API

| Endpoint | Método | Descripción |
|----------|--------|-------------|
| `/` | GET | Health check |
| `/admin` | GET | Panel de administración |
| `/admin/api/stats` | GET | Estadísticas |
| `/admin/api/knowledge/search` | GET | Búsqueda semántica |
| `/admin/api/mcp-tools/:id/test` | POST | Test de tool |

### MCP Server

| Endpoint | Método | Descripción |
|----------|--------|-------------|
| `/mcp` | GET | Manifest de tools |
| `/mcp/tools` | GET | Lista de tools |
| `/mcp/call` | POST | Ejecutar tool |

### Webhooks

| Endpoint | Método | Descripción |
|----------|--------|-------------|
| `/webhook/telegram` | POST | Webhook de Telegram |
| `/webhook/whatsapp` | POST | Webhook de WhatsApp |
| `/webhook/instagram` | POST | Webhook de Instagram |
| `/webhook/facebook` | POST | Webhook de Facebook |

---

## Base de Datos (27 tablas)

| Tabla | Descripción |
|-------|-------------|
| `agents` | Agentes configurados |
| `conversations` | Conversaciones por canal |
| `messages` | Historial de mensajes |
| `tickets` | Tickets de soporte |
| `knowledge_base` | Documentos para RAG |
| `knowledge_chunks` | Fragmentos indexados |
| `agent_knowledge` | Agente ↔ Knowledge |
| `mcp_tools` | Herramientas MCP |
| `agent_tools` | Agente ↔ Tools |
| `tool_execution_logs` | Logs de ejecución |
| `ai_logs` | Observabilidad AI |
| `leads` | Leads capturados |
| `config` | Configuración |
| `workflows` | Flujos multi-agente |
| `workflow_runs` | Ejecuciones |
| `connectors` | Conectores externos |
| `ab_tests` | A/B testing |
| `ab_events` | Eventos de testing |
| `webhooks` | Webhooks registrados |
| `admin_users` | Usuarios RBAC |
| `audit_logs` | Audit trail |
| `user_memories` | Memoria persistente |
| `tenants` | Multi-tenant |
| `monitoring_alerts` | Alertas |
| `backup_logs` | Logs de backup |
| `channel_configs` | Config de canales |
| `health_logs` | Health checks |

---

## Variables de Entorno

```bash
# Seguridad
ADMIN_PASSWORD=tu-contraseña

# Canales
TELEGRAM_BOT_TOKEN=token-de-telegram
WHATSAPP_TOKEN=token-de-whatsapp
WHATSAPP_PHONE_ID=phone-id

# AI Gateway (opcional)
WARMUP_SECRET=secreto-de-warmup
```

---

## Privacidad

**Nadie más que tú.** WorkerIAGO corre en TU cuenta de Cloudflare:

- Conversaciones en tu D1
- Documentos en tu R2
- Embeddings en tu Vectorize
- IA usa TU llave (pagas solo lo que piensa)
- No envía telemetría a nadie
- Si preguntan si es un bot, **lo admite**

---

## Costos

| Servicio | Gratis hasta | Costo después |
|----------|-------------|---------------|
| D1 | 5GB + 10M lecturas/día | $0.75/GB |
| Vectorize | 10M vectores | $0.01/mes/millón |
| R2 | 10GB + 1M requests | $0.015/GB |
| KV | 100K lecturas/día | $0.50/millón |
| Workers AI | 10K requests/día | Variable |

**Total: ~$1-5/mes** para un negocio pequeño-mediano.

---

## Desarrollo

```bash
pnpm install
pnpm run dev          # Desarrollo local
pnpm run typecheck    # Type check
pnpm test             # Tests
wrangler deploy       # Deploy a Cloudflare
```

---

## Licencia

[MIT](LICENSE) © WorkerIAGO

**Hecho para la comunidad de habla hispana**
