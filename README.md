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
- 🧠 **Tu cerebro, tu llave** — Claude, ChatGPT, Llama o Mistral; tú eliges y pagas solo lo que piensa.

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
wrangler d1 create agentforge-db
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
| **IA** | AI SDK + Workers AI | OpenAI, Anthropic, xAI, Llama, Mistral |
| **Base de conocimiento** | Vectorize (bge-m3) | RAG con embeddings semánticos |
| **Base de datos** | D1 (SQLite) | Conversaciones, leads, configuración |
| **Archivos** | R2 | Imágenes, audios, documentos (S3-compatible) |
| **Estado** | Durable Objects | Memoria persistente de conversaciones |
| **Cache** | KV | Respuestas cacheadas, sesiones |
| **Admin** | HTML + Tailwind | Dashboard en tiempo real |
| **Deploy** | Wrangler | CLI de Cloudflare |

### Proveedor de IA (elige uno)

| Proveedor | Modelo | Costo aprox. |
|-----------|--------|--------------|
| **Workers AI** | Llama 3.1, Mistral, Phi | ~$0.011/1K neurons |
| **OpenAI** | GPT-4o, GPT-4o-mini | ~$0.005/1K tokens |
| **Anthropic** | Claude 3 Haiku, Sonnet | ~$0.001/1K tokens |
| **xAI** | Grok-2 | ~$0.01/1K tokens |

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

### Admin Dashboard
- Conversaciones en tiempo real
- Leads con scoring
- Métricas de uso
- Gestión de agentes
- Base de conocimiento

---

## 📁 Estructura del proyecto

```
agentforge/
├── src/
│   ├── index.ts              # Worker principal
│   ├── orchestrator/         # Orquestador de agentes
│   ├── channels/             # Integración con canales
│   │   ├── telegram.ts
│   │   ├── whatsapp.ts
│   │   └── web.ts
│   ├── actions/              # Engine de acciones
│   ├── admin/                # Panel de administración
│   └── durable-object.ts     # Estado de conversaciones
├── schema.sql                # Esquema de base de datos
├── seed.sql                  # Datos iniciales
├── wrangler.toml             # Configuración de Cloudflare
├── deploy.sh                 # Script de instalación
└── package.json
```

---

## 🔒 Privacidad

**Nadie más que tú.** WorkerIAGO corre en TU cuenta de Cloudflare con TUS llaves:

- Las conversaciones viven en tu D1
- El bot no envía telemetría a nadie
- El texto viaje al proveedor de IA que tú elegiste (con tu llave)
- Si preguntan si es un bot, **lo admite**

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
```

---

## 🤝 Contribuir

Los PRs son bienvenidos. Abre un issue si tienes una idea o encuentras un bug.

---

## 📄 Licencia

[MIT](LICENSE) © WorkerIAGO

**Hecho con 🔨 para la comunidad de habla hispana**
