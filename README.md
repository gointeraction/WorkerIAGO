# 🔨 WorkerIAGO

### Tu plataforma de agentes de IA para WhatsApp, Instagram y Telegram — en **tu propia nube**, gratis y open source.

**Atiende a tus clientes 24/7, responde desde tu base de conocimiento, y ejecuta acciones reales.** Vive en tu cuenta de Cloudflare, con tu llave de IA. Tus datos son tuyos. Sin mensualidades de SaaS.

*Self-hosted, open-source AI agent platform. Lives in **your** Cloudflare, uses **your** AI key. Spanish-first. Deploy in minutes.*

[![License: MIT](https://img.shields.io/badge/License-MIT-f59e0b.svg)](LICENSE) [![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-f6821f.svg)](https://workers.cloudflare.com/)

[**Instalar**](#-instalar-en-5-minutos) · [**Cómo funciona**](#-cómo-funciona) · [**Features**](#-features) · [**Stack**](#-stack)

---

## ¿Qué es WorkerIAGO?

Un asistente de soporte con IA que montas **en tu propia infraestructura de Cloudflare** en una tarde — sin saber programar. En lugar de pagar una mensualidad a un SaaS que se queda con tus conversaciones, WorkerIAGO vive en tu cuenta, con tu llave de IA, y **todo es tuyo**.

- 💬 **Multicanal** — WhatsApp, Instagram, Telegram y Web desde un mismo cerebro.
- 📚 **Aprende de tus documentos** — subes tus FAQ, políticas y guías; el bot busca ahí antes de responder (RAG con Vectorize).
- 🎯 **Multi-agente** — Crea agentes especializados: ventas, soporte, reservas, etc.
- ⚡ **Acciones reales** — Los agentes pueden reservar, cotizar, crear tickets, y más.
- 🙋 **Sabe cuándo pedir ayuda** — si algo es delicado o no está seguro, te hace *handoff* a ti.
- 📊 **Panel de administración** — conversaciones, leads, base de conocimiento y métricas.
- ☁️ **Vive en tu Cloudflare** — rápido, barato y sin servidores que mantener.
- 🧠 **Tu cerebro, tu llave** — Llama 3.1/3.2/3.3; tú eliges y pagas solo lo que piensa.

> **No necesitas saber programar.** Se instala con un solo comando.

---

## 🚀 Instalar en 5 minutos

### Opción A — Deploy automático (recomendado)

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/gointeraction/WorkerIAGO)

Haz clic en el botón y sigue las instrucciones.

### Opción B — Manual

```bash
# 1. Clonar el repositorio
git clone https://github.com/gointeraction/WorkerIAGO mi-agente
cd mi-agente

# 2. Instalar dependencias
pnpm install

# 3. Configurar
# Copia .dev.vars.example a .dev.vars y completa tus API keys
cp .dev.vars.example .dev.vars

# 4. Crear recursos en Cloudflare
wrangler login
wrangler d1 create workeriago-db
# Copia el database_id a wrangler.toml

# 5. Desplegar
bash deploy.sh
```

### Opción C — Sin programar (con IA)

Abre [Claude Code](https://claude.com/claude-code) o [Cursor](https://cursor.com) en tu terminal y dile:

```
ármame un chatbot con WorkerIAGO
```

La IA te guiará paso a paso.

---

## 💸 Cuánto cuesta

WorkerIAGO es **gratis y open source**. Lo único que pagas es tu propia infraestructura, y arranca casi en cero:

| Pieza | Costo | Notas |
|-------|-------|-------|
| **Cloudflare** (la casa del bot) | **$0** para empezar | D1, Vectorize y R2 tienen capa gratis generosa |
| **Cerebro de IA** (tu llave) | ~**$1–2/mes** para un negocio normal | Pagas solo lo que el bot piensa |

**Total: ~$1-3/mes** para un negocio pequeño-mediano.

---

## 🧠 Cómo funciona

```
Cliente (WhatsApp / IG / Telegram / Web)
    │
    ▼
┌─────────────────────────────────────────┐
│         WorkerIAGO (Cloudflare)         │
│                                         │
│  ┌─────────────────────────────────┐   │
│  │      Orquestador de Agentes      │   │
│  │  • Clasifica intención           │   │
│  │  • Selecciona agente adecuado    │   │
│  │  • Ejecuta acciones              │   │
│  └─────────────────────────────────┘   │
│           │              │              │
│           ▼              ▼              │
│    ┌──────────┐    ┌──────────┐        │
│    │Vectorize │    │Workers AI│        │
│    │ (RAG)    │    │ (LLMs)   │        │
│    └──────────┘    └──────────┘        │
│                                         │
│  ┌─────────────────────────────────┐   │
│  │        D1 (Base de datos)        │   │
│  │  Conversaciones, leads, config   │   │
│  └─────────────────────────────────┘   │
│                                         │
│  ┌─────────────────────────────────┐   │
│  │      Panel /admin                │   │
│  │  Conversaciones · Leads · KB     │   │
│  └─────────────────────────────────┘   │
└─────────────────────────────────────────┘
```

---

## 🧩 Stack

| Componente | Servicio Cloudflare | Descripción |
|------------|---------------------|-------------|
| **Runtime** | Workers (Hono) | Edge computing, ejecución global |
| **IA** | Workers AI | Llama 3.1/3.2/3.3, embeddings |
| **Base de conocimiento** | Vectorize (bge-m3) | RAG con embeddings semánticos |
| **Base de datos** | D1 (SQLite) | Conversaciones, leads, configuración |
| **Archivos** | R2 | Imágenes, audios, documentos (S3-compatible) |
| **Estado** | Durable Objects | Memoria persistente de conversaciones |
| **Cache** | KV | Respuestas cacheadas, sesiones |
| **Admin** | HTML + Tailwind + HTMX | Dashboard en tiempo real |
| **Deploy** | Cloudflare Pages | Auto-deploy desde GitHub |

### Modelos de IA Disponibles

| Modelo | Velocidad | Costo aprox. | Mejor para |
|--------|-----------|--------------|------------|
| **Llama 3.2 3B** | ⚡ Muy rápido | ~$0.001/1K tokens | Respuestas simples |
| **Llama 3.1 8B** | ⚡ Rápido | ~$0.005/1K tokens | Uso general |
| **Llama 3.3 70B** | 🐢 Lento | ~$0.05/1K tokens | Conversaciones complejas |

---

## ⭐ Features

### Multi-Canal
- **WhatsApp** — Business API con webhooks
- **Telegram** — Bot API con comandos
- **Web** — Widget de chat embeddable
- **Instagram** — Messenger API (próximamente)

### Multi-Agente
```js
// Crear agentes especializados
const agentes = {
  ventas: { prompt: 'Eres un vendedor...', tools: ['cotizar', 'reservar'] },
  soporte: { prompt: 'Eres un técnico...', tools: ['crear_ticket', 'buscar_docs'] },
  reservas: { prompt: 'Eres un asistente...', tools: ['verificar_disponibilidad'] }
};
```

### Actions Engine
Los agentes pueden **ejecutar acciones reales**, no solo responder:

| Acción | Descripción |
|--------|-------------|
| `search_knowledge` | Busca en la base de conocimiento |
| `create_ticket` | Crea tickets de soporte |
| `escalate_to_human` | Escala a un humano |
| `book_appointment` | Reserva citas |
| `create_quote` | Genera cotizaciones |
| `qualify_lead` | Califica leads |

### RAG (Retrieval-Augmented Generation)
- Sube documentos (FAQ, políticas, catálogos)
- El agente busca automáticamente antes de responder
- Responde con fuentes citadas

### Admin Dashboard (v2.0)

Panel de administración completo con HTMX para actualizaciones en tiempo real:

| Página | Descripción |
|--------|-------------|
| 📊 **Resumen** | Dashboard principal con métricas |
| 💬 **Conversaciones** | Inbox con thread panel lateral |
| 🎫 **Tickets** | Sistema de soporte con prioridades |
| 👥 **Leads** | Gestión con scoring y estados |
| 📚 **Base de Conocimiento** | Editor de documentos RAG |
| 🤖 **Agentes** | Gestión de agentes IA |
| 💡 **Insights** | Analytics y métricas |
| 📢 **Campañas** | Envío masivo (próximamente) |
| 💰 **Costos** | Tracking de uso y costos |
| ⚙️ **Configuración** | Ajustes del bot |

### Sistema de Tickets
- Creación automática al escalar conversaciones
- Estados: nuevo → en progreso → esperando → resuelto → cerrado
- Prioridades: baja, media, alta, urgente
- Asignación y seguimiento

### Knowledge Base con Editor
- Crear y editar documentos directamente desde el admin
- Categorías y tags para organización
- Contador de vistas y utilidad
- Indexación automática en Vectorize

### Insights y Analytics
- Satisfacción promedio de clientes
- Tiempo de respuesta del bot
- Tasa de resolución sin escalar
- Tendencias y gráficos (próximamente)

### Cost Tracking
- Tokens por conversación
- Costo USD estimado por uso
- Proyección mensual
- Historial de uso diario

### Tareas Automatizadas (Cron)
- **Purge de mensajes**: Elimina mensajes mayores a 90 días
- **Follow-ups**: Seguimiento automático a leads pendientes
- **Health Check**: Monitoreo de salud del bot

### Watchdog
- Monitoreo de errores en tiempo real
- Tasa de éxito por período
- Alertas automáticas de degradación
- Logs de salud históricos

---

## 📁 Estructura del proyecto

```
workeriago/
├── src/
│   ├── index.ts                    # Worker principal + scheduled functions
│   ├── ai.ts                       # Integración con Workers AI
│   ├── durable-object.ts           # Estado de conversaciones (Durable Objects)
│   ├── orchestrator/
│   │   └── index.ts                # Orquestador de agentes
│   ├── channels/
│   │   ├── telegram.ts             # Integración con Telegram Bot API
│   │   ├── whatsapp.ts             # Integración con WhatsApp Business API
│   │   └── web.ts                  # Widget de chat web
│   ├── actions/
│   │   └── index.ts                # Engine de acciones (11 acciones)
│   └── admin/
│       └── index.ts                # Panel de administración (HTMX)
├── scripts/
│   ├── setup-resources.sh          # Setup de recursos Cloudflare
│   └── setup.sh                    # Script de instalación
├── schema.sql                      # Esquema de base de datos (12 tablas)
├── seed.sql                        # Datos iniciales (3 agentes, 11 acciones)
├── wrangler.toml                   # Configuración de Cloudflare Workers
├── package.json                    # Dependencias y scripts
├── tsconfig.json                   # Configuración de TypeScript
├── deploy.sh                       # Script de deploy automático
├── .dev.vars.example               # Variables de entorno (ejemplo)
└── README.md                       # Esta documentación
```

---

## 🗄️ Base de Datos

### Tablas Principales

| Tabla | Descripción |
|-------|-------------|
| `agents` | Agentes configurados con prompts y herramientas |
| `conversations` | Conversaciones por canal con estado |
| `messages` | Historial de mensajes por conversación |
| `tickets` | Tickets de soporte con prioridades |
| `knowledge_base` | Documentos para RAG |
| `leads` | Leads capturados con scoring |
| `actions` | Acciones disponibles para agentes |
| `usage_logs` | Logs de uso y costos |
| `insights` | Analytics y métricas |
| `campaigns` | Campañas de mensajería |
| `followups` | Seguimientos programados |
| `health_logs` | Logs de salud del bot |

---

## 🔒 Privacidad

**Nadie más que tú.** WorkerIAGO corre en TU cuenta de Cloudflare con TUS llaves:

- Las conversaciones viven en tu D1
- El bot no envía telemetría a nadie
- El texto viaje al proveedor de IA que tú elegiste (con tu llave)
- Si preguntan si es un bot, **lo admite**
- Los mensajes se borran automáticamente después de 90 días

Como dueño del negocio, **tú eres el responsable** de esos datos.

---

## 🛠️ Desarrollo

```bash
# Instalar dependencias
pnpm install

# Desarrollo local
pnpm run dev

# Type check
pnpm run typecheck

# Test
pnpm test

# Deploy
pnpm run deploy
```

---

## 📊 Endpoints API

| Endpoint | Método | Descripción |
|----------|--------|-------------|
| `/` | GET | Health check |
| `/api/test-ai` | GET | Probar conexión AI |
| `/api/stats` | GET | Estadísticas generales |
| `/api/conversations` | GET | Lista de conversaciones |
| `/api/leads` | GET | Lista de leads |
| `/api/kb` | GET | Base de conocimiento |
| `/api/agents` | GET | Lista de agentes |
| `/webhook/telegram` | POST | Webhook de Telegram |
| `/webhook/whatsapp` | POST | Webhook de WhatsApp |
| `/admin` | GET | Panel de administración |

---

## 🤝 Contribuir

Los PRs son bienvenidos. Abre un issue si tienes una idea o encuentras un bug.

---

## 📄 Licencia

[MIT](LICENSE) © WorkerIAGO

**Hecho con 🔨 para la comunidad de habla hispana**
