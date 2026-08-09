# Feature Specification: WorkerIAGO Platform

**Feature Branch**: `main`

**Created**: 2026-08-09

**Status**: Implemented (Brownfield Documentation)

**Input**: User description: "Documentar toda la plataforma WorkerIAGO existente"

## User Scenarios & Testing

### User Story 1 - Chat con agente IA (Priority: P1)

Un usuario final envía un mensaje por WhatsApp/Telegram/Web y recibe una respuesta inteligente del agente, basada en la base de conocimiento (RAG) y herramientas MCP configuradas.

**Why this priority**: Es el core del producto — sin chat funcional, no hay plataforma.

**Independent Test**: Enviar `POST /api/chat` con `{message, chatId, agentId}` y verificar respuesta con `sources` y `intent`.

**Acceptance Scenarios**:

1. **Given** un agente activo con KB vinculada, **When** el usuario pregunta "¿cuánto cuesta el plan premium?", **Then** el agente responde con información de la KB y muestra las fuentes
2. **Given** un agente con MCP tools configuradas, **When** el usuario hace una petición que requiere un tool, **Then** el agente responde `TOOL_CALL:`, el orchestrator ejecuta el tool, y re-genera la respuesta con el resultado
3. **Given** un usuario nuevo sin `agentId`, **When** envía un mensaje, **Then** el sistema usa el primer agente activo (fallback a `getDefaultAgent`)
4. **Given** un canal webhook (Telegram), **When** llega un update de Telegram, **Then** el channel handler normaliza el mensaje y lo pasa al orchestrator

---

### User Story 2 - Admin gestiona agentes y conocimiento (Priority: P1)

Un administrador entra al panel web (`/admin`), crea agentes, sube documentos a la base de conocimiento, vincula herramientas MCP, y configura canales.

**Why this priority**: Sin admin funcional, no se puede configurar el sistema.

**Independent Test**: Abrir `/admin/agents`, crear un agente, subir un documento a `/admin/knowledge`, vincularlo, y verificar que el chat usa el conocimiento.

**Acceptance Scenarios**:

1. **Given** el admin en `/admin/agents`, **When** completa el form de crear agente y hace submit, **Then** el agente se guarda en D1 y aparece en la lista
2. **Given** el admin en `/admin/knowledge`, **When** pega texto y guarda, **Then** el documento se chunkifica, se embeddea con bge-base-en-v1.5 (768d), se guarda en Vectorize, y aparece en la lista
3. **Given** el admin en `/admin/agents` con un agente creado, **When** hace clic en "Base de Conocimiento", **Then** ve un modal para vincular/desvincular documentos de la KB
4. **Given** el admin en `/admin/channels`, **When** activa un canal y configura los campos, **Then** la config se guarda en `channel_configs` y el canal aparece como "Activo"

---

### User Story 3 - Insights y observabilidad (Priority: P2)

Un administrador revisa métricas de rendimiento: tasa de resolución de tickets, latencia de IA, conversión de leads, conversaciones por día, costos de IA.

**Why this priority**: Permite optimizar el sistema, pero no es blocking para el funcionamiento.

**Independent Test**: Abrir `/admin/insights` y verificar que los números provienen de queries reales a D1 (no hardcoded).

**Acceptance Scenarios**:

1. **Given** datos en D1 (conversaciones, tickets, leads, ai_logs), **When** el admin abre `/admin/insights`, **Then** ve tasa de resolución, latencia promedio (7d), conversión de leads, y gráfico de barras de conversaciones por día
2. **Given** el admin en `/admin/ai-gateway`, **When** filtra por modelo o status, **Then** la tabla de logs se filtra correctamente
3. **Given** el admin en `/admin/costs`, **When** ve el dashboard, **Then** ve costo total (30 días), tokens totales, y proyección mensual desde `usage_logs`

---

### User Story 4 - Multi-tenant con RBAC (Priority: P2)

Múltiples empresas usan la misma instancia, cada una con sus agentes, límites por plan, y usuarios con roles (Super Admin, Admin, Editor, Viewer).

**Why this priority**: Habilita SaaS, pero no es necesario para single-tenant.

**Independent Test**: Crear un tenant en `/admin/tenants`, invitar un usuario en `/admin/users`, y verificar que el audit log registra las acciones.

**Acceptance Scenarios**:

1. **Given** el admin en `/admin/tenants`, **When** crea un tenant con plan "pro", **Then** se guardan los límites (max_agents: 20, max_messages_month: 100000) en JSON
2. **Given** el admin en `/admin/users`, **When** edita un usuario existente, **Then** el modal se pre-puebla con sus datos y el UPDATE modifica el registro
3. **Given** cualquier POST route mutativo, **When** se ejecuta, **Then** `auditLog()` escribe en `audit_logs` con user_email, action, resource, ip

---

### User Story 5 - Backup y monitoring (Priority: P3)

El sistema hace backup automático diario de todas las 28 tablas a R2, y monitorea la salud de 5 servicios (D1, KV, Vectorize, AI, R2).

**Why this priority**: Operacional pero no blocking para el core.

**Independent Test**: Ejecutar `POST /admin/api/backup` y verificar que se sube un JSON a R2. Ejecutar `POST /admin/api/health-check` y verificar el JSON de respuesta.

**Acceptance Scenarios**:

1. **Given** el sistema con datos, **When** se ejecuta el cron `0 3 * * *`, **Then** se crea un backup JSON en R2 con todas las tablas y se registra en `backup_logs`
2. **Given** el admin en `/admin/monitoring`, **When** hace clic en "Health Check", **Then** se ejecutan 5 checks reales y se muestra `{d1:"ok", kv:"ok", vec:"down", ai:"down", r2:"ok"}`
3. **Given** una alerta crítica, **When** el admin hace ack, **Then** la alerta se marca como acknowledged

---

### Edge Cases

- **Sin `ADMIN_PASSWORD`**: El sistema funciona en modo demo (sin auth, CSRF desactivado)
- **Vectorize sin datos**: `semanticSearch()` retorna array vacío, el agente responde sin RAG context
- **AI binding caído**: El health check reporta `ai:"down"`, el chat retorna error 500
- **Canal no configurado**: El webhook del canal retorna 404
- **Agente sin tools**: El orchestrator omite el paso de MCP tools y genera respuesta directa
- **KB sin documentos vinculados**: El agente responde sin contexto RAG (solo system prompt)
- **FormData parseado por CSRF**: En modo demo, `csrfCheck` se salta completamente para no consumir el body

## Requirements

### Functional Requirements

- **FR-001**: El sistema MUST recibir mensajes por 9 canales (WhatsApp, Telegram, Web, Instagram, Facebook, Email, SMS, Discord, Slack) vía webhooks HTTP
- **FR-002**: El sistema MUST clasificar la intención del mensaje usando Llama 3.2 3B (soporte, ventas, reservas, escalado)
- **FR-003**: El sistema MUST buscar conocimiento relevante en Vectorize usando embeddings de bge-base-en-v1.5 (768d, cosine)
- **FR-004**: El sistema MUST filtrar resultados de Vectorize por `metadata.agentId` para que cada agente solo use su KB
- **FR-005**: El sistema MUST cargar herramientas MCP vinculadas al agente y permitir `TOOL_CALL:` detection en respuestas del LLM
- **FR-006**: El sistema MUST guardar conversaciones y mensajes en D1 (tablas `conversations`, `messages`)
- **FR-007**: El admin panel MUST tener 22 páginas server-rendered con HTML + Tailwind + HTMX
- **FR-008**: Todas las POST routes MUST usar parameterized queries (`.bind()`) — nunca string interpolation en SQL
- **FR-009**: El sistema MUST firmar cookies de sesión con HMAC-SHA256
- **FR-010**: El sistema MUST registrar acciones mutativas en `audit_logs` con IP, user, action, resource
- **FR-011**: El sistema MUST hacer backup diario de las 28 tablas a R2 en formato JSON
- **FR-012**: El sistema MUST ejecutar health checks de D1, KV, Vectorize, AI, y R2 con mediciones reales
- **FR-013**: El sistema MUST soportar multi-tenant con planes (free, starter, pro, enterprise) y límites por plan
- **FR-014**: El sistema MUST soportar 4 roles de usuario (super_admin, admin, editor, viewer)
- **FR-015**: El sistema MUST exportar leads en formato CSV
- **FR-016**: El sistema MUST permitir crear, iniciar, detener y eliminar campañas masivas
- **FR-017**: El sistema MUST permitir configurar conectores externos (Google Drive, Notion, RSS, Webhook) con sync
- **FR-018**: El sistema MUST permitir crear y ejecutar workflows multi-agente con pasos secuenciales
- **FR-019**: El sistema MUST permitir A/B testing con 2 variantes y split de tráfico
- **FR-020**: El sistema MUST cachear respuestas de IA en KV para reducir costos

### Key Entities

- **Agent**: Agente IA con system_prompt, modelo, temperatura, tools vinculados, KB vinculada
- **Conversation**: Sesión de chat por canal (chat_id, channel, agent_id, status, intent)
- **Message**: Mensaje individual dentro de una conversación (role: user/assistant, content)
- **KnowledgeBase**: Documento para RAG (title, content, category, vector_id en Vectorize)
- **MCPTool**: Herramienta externa con endpoint URL, JSON schema de parámetros, auth config
- **Ticket**: Ticket de soporte con prioridad y status (new, in_progress, resolved)
- **Lead**: Lead capturado del chat con score y status (new, contacted, converted)
- **Tenant**: Empresa multi-tenant con plan, límites, slug
- **AdminUser**: Usuario del panel con rol y permisos
- **Workflow**: Flujo multi-agente con steps (agent, tool, condition, parallel, transform)
- **Campaign**: Campaña masiva con canal, mensaje, segmento, status
- **Connector**: Conector externo con tipo, config, sync_status
- **AuditLog**: Registro de acción admin (user_email, action, resource, ip)
- **ABTest**: Test A/B con 2 variantes y traffic_split

## Success Criteria

### Measurable Outcomes

- **SC-001**: Chat end-to-end responde en <500ms p50 con RAG + MCP
- **SC-002**: Admin panel carga en <200ms (server-rendered, 22 páginas)
- **SC-003**: 48 POST/DELETE routes funcionales sin errores 500
- **SC-004**: Backup de 28 tablas se completa en <5 segundos
- **SC-005**: Costo total < $5/mes para ~1000 conversaciones/día
- **SC-006**: 0 vulnerabilidades de SQL injection en queries con input de usuario
- **SC-007**: Audit log registra 100% de acciones mutativas en admin

## Assumptions

- El usuario tiene una cuenta de Cloudflare con Workers, D1, Vectorize, R2, KV habilitados
- Workers AI está disponible en la región del usuario
- El usuario configurará los secrets necesarios (TELEGRAM_BOT_TOKEN, ADMIN_PASSWORD, etc.)
- El modo demo (sin ADMIN_PASSWORD) es aceptable para desarrollo y testing
- El admin panel se accede vía navegador web (no mobile app)
- Los canales se configuran individualmente según las necesidades del usuario
