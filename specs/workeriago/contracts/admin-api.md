# Admin API Contract

All admin routes are mounted at `/admin` prefix. Auth via cookie `admin_session` (HMAC-signed) or `Authorization: Bearer <password>`.

## Authentication

### POST /admin/api/login

Login with password. Sets HMAC-signed cookie.

**Request**: `multipart/form-data` with `password` field

**Response**: 302 redirect to `/admin` with `Set-Cookie: admin_session=<signed>; HttpOnly; Secure; SameSite=Lax`

**Demo mode**: If `ADMIN_PASSWORD` not set, any password works. Cookie is still signed.

### GET /admin/logout

Clears session cookie. Redirects to `/admin/login`.

---

## Pages (GET) — 22 total

| Route | Description |
|-------|-------------|
| `/admin` | Dashboard with stats, recent conversations, tickets |
| `/admin/conversations` | Conversation list with pagination |
| `/admin/conversations/:id/thread` | Conversation thread with messages |
| `/admin/tickets` | Tickets with status filter (parameterized query) |
| `/admin/leads` | Leads with status filter + CSV export link |
| `/admin/leads/export` | CSV download (Content-Type: text/csv) |
| `/admin/knowledge` | Knowledge base documents grid |
| `/admin/agents` | Agents list with create form |
| `/admin/mcp-tools` | MCP tools registry |
| `/admin/ai-gateway` | AI gateway stats + logs with model/status filters |
| `/admin/workflows` | Workflows list + recent runs |
| `/admin/connectors` | Connectors with configure/sync/delete |
| `/admin/insights` | Real D1 analytics (resolution rate, latency, conversion) |
| `/admin/campaigns` | Campaigns CRUD with start/stop |
| `/admin/costs` | Cost tracking from usage_logs |
| `/admin/channels` | 9 channel cards with activate/deactivate |
| `/admin/voice` | Voice config + Web Speech API TTS test |
| `/admin/ab-testing` | A/B tests with start/stop/delete |
| `/admin/monitoring` | Health checks + alerts |
| `/admin/backups` | Backup history with restore/delete |
| `/admin/tenants` | Tenants with create/edit modal |
| `/admin/users` | Admin users with create/edit modal |
| `/admin/audit` | Audit log table |
| `/admin/config` | Global config key-value editor |

---

## POST/DELETE Routes — 48 total

### Knowledge Base

| Route | Method | Description |
|-------|--------|-------------|
| `/admin/kb/save` | POST | Create/update KB document |
| `/admin/kb/:id` | DELETE | Delete KB document + Vectorize vector |
| `/admin/knowledge/upload` | POST | Upload file (PDF/txt) to R2 + embed |
| `/admin/knowledge/import-url` | POST | Fetch URL → extract text → embed |
| `/admin/knowledge/save-text` | POST | Save pasted text → chunk → embed |
| `/admin/api/knowledge/:id/reindex` | POST | Regenerate embeddings |

### Tickets & Leads

| Route | Method | Description |
|-------|--------|-------------|
| `/admin/tickets/:id/status` | POST | Update ticket status |
| `/admin/leads/:id/status` | POST | Update lead status |

### Conversations

| Route | Method | Description |
|-------|--------|-------------|
| `/admin/conversations/:id/reply` | POST | Manual reply to conversation |
| `/admin/conversations/:id/pause` | POST | Pause bot responses |
| `/admin/conversations/:id/escalate` | POST | Escalate to human |

### Agents

| Route | Method | Description |
|-------|--------|-------------|
| `/admin/agents/save` | POST | Create/update agent |
| `/admin/agents/:id` | DELETE | Delete agent |
| `/admin/agents/:id/kb/attach/:kbId` | POST | Link KB document to agent |
| `/admin/agents/:agentId/kb/:kbId` | DELETE | Unlink KB document |
| `/admin/agents/kb/link` | POST | Link KB document (alternative) |

### MCP Tools

| Route | Method | Description |
|-------|--------|-------------|
| `/admin/mcp-tools/save` | POST | Create/update MCP tool |
| `/admin/mcp-tools/:id` | DELETE | Delete MCP tool |
| `/admin/api/mcp-tools/:id/test` | POST | Test execute MCP tool |

### AI Gateway

| Route | Method | Description |
|-------|--------|-------------|
| `/admin/ai-gateway/purge` | POST | Delete all AI logs |

### Workflows

| Route | Method | Description |
|-------|--------|-------------|
| `/admin/workflows/save` | POST | Create workflow |
| `/admin/api/workflows/:id/run` | POST | Execute workflow |

### Connectors

| Route | Method | Description |
|-------|--------|-------------|
| `/admin/connectors/save` | POST | Configure connector |
| `/admin/connectors/:id/sync` | POST | Sync connector |
| `/admin/connectors/:id` | DELETE | Delete connector |

### Campaigns

| Route | Method | Description |
|-------|--------|-------------|
| `/admin/campaigns/save` | POST | Create campaign |
| `/admin/campaigns/:id/start` | POST | Start campaign |
| `/admin/campaigns/:id/stop` | POST | Stop campaign |
| `/admin/campaigns/:id/delete` | POST | Delete campaign |

### Channels

| Route | Method | Description |
|-------|--------|-------------|
| `/admin/channels/save` | POST | Save channel config |
| `/admin/channels/:type/deactivate` | POST | Deactivate channel |

### Voice

| Route | Method | Description |
|-------|--------|-------------|
| `/admin/voice/save` | POST | Save voice config |

### A/B Testing

| Route | Method | Description |
|-------|--------|-------------|
| `/admin/ab-testing/save` | POST | Create A/B test |
| `/admin/ab-testing/:id/start` | POST | Start test |
| `/admin/ab-testing/:id/stop` | POST | Stop test |
| `/admin/ab-testing/:id/delete` | POST | Delete test |

### Monitoring

| Route | Method | Description |
|-------|--------|-------------|
| `/admin/api/health-check` | POST | Run 5 service health checks |
| `/admin/monitoring/:id/ack` | POST | Acknowledge alert |

### Backups

| Route | Method | Description |
|-------|--------|-------------|
| `/admin/api/backup` | POST | Create backup to R2 |
| `/admin/api/backup/:id/restore` | POST | Restore from R2 |
| `/admin/api/backup/:id/delete` | POST | Delete backup from R2 |

### Tenants

| Route | Method | Description |
|-------|--------|-------------|
| `/admin/tenants/save` | POST | Create or update tenant (supports `id` for edit) |
| `/admin/tenants/:id/delete` | POST | Delete tenant |

### Users

| Route | Method | Description |
|-------|--------|-------------|
| `/admin/users/save` | POST | Create or update user (supports `id` for edit) |
| `/admin/users/:id/delete` | POST | Delete user |

### Config

| Route | Method | Description |
|-------|--------|-------------|
| `/admin/config/save` | POST | Save config key-value pairs |

---

## API JSON Endpoints (GET)

| Route | Description |
|-------|-------------|
| `/admin/api/stats` | Dashboard statistics |
| `/admin/api/conversations` | Recent conversations (query: `limit`) |
| `/admin/api/conversations/:id/messages` | Messages in conversation |
| `/admin/api/tickets` | Tickets (query: `status`, parameterized) |
| `/admin/api/leads` | Leads (query: `limit`) |
| `/admin/api/kb` | Knowledge base documents |
| `/admin/api/agents/:id/kb` | KB documents linked to agent |

---

## Security

- **Cookie**: `admin_session` HMAC-signed with `getSessionSecret()` (derived from `ADMIN_PASSWORD`)
- **CSRF**: `admin_csrf` cookie + `X-CSRF-Token` header or `_csrf` form field. Active only when `ADMIN_PASSWORD` is set.
- **SQL Injection**: All status filters use `.bind(status)` parameterized queries
- **Audit**: `auditLog()` called from 10+ POST routes (tenants, users, channels, campaigns, workflows, config, KB, AI gateway purge)
