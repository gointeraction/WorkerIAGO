# Research: WorkerIAGO Platform

## Phase 0: Technology Decisions

### Cloudflare Workers vs Alternatives

**Decision**: Cloudflare Workers

**Rationale**:
- Edge deployment (300+ locations, <50ms latency globally)
- Free tier: 100K requests/day, 10K AI requests/day
- Native bindings to D1, KV, R2, Vectorize, AI, Durable Objects
- No server management, no cold starts (<5ms startup)
- TypeScript native with Hono framework

**Alternatives rejected**:
- Vercel Edge Functions: No native vector search, no D1 equivalent
- AWS Lambda + OpenSearch: More complex, higher cost at scale
- Self-hosted: Violates Edge-First principle, higher latency

### Hono vs Express/Fastify

**Decision**: Hono

**Rationale**:
- TypeScript-first, built for Workers/Pages/Deno/Bun
- Middleware system (auth, csrfCheck) works cleanly
- Sub-app routing (`app.route('/admin', AdminPanel)`)
- No dependencies beyond `@cloudflare/workers-types`

### Vectorize Dimensions: 768 vs 1024

**Decision**: 768 dimensions (bge-base-en-v1.5)

**Rationale**:
- 768d costs less in Vectorize storage ($0.01/mes/millón vectores)
- bge-base is free on Workers AI (bge-large also free but 1024d = more storage)
- Cosine similarity is standard for semantic search
- 768d is sufficient for Spanish/English product docs (tested with "¿cuánto cuesta el plan premium?")

**Critical bug found and fixed**: Originally configured as 1024d (bge-m3), but Vectorize index was created at 768d. Fixed embedding model to `@cf/baai/bge-base-en-v1.5` in `src/ai.ts` and `wrangler.toml`.

### Admin Panel: Server-Rendered vs SPA

**Decision**: Server-rendered HTML + Tailwind CDN + HTMX

**Rationale**:
- No build step (Tailwind via CDN, no webpack/vite)
- Ships as part of the Worker (no separate hosting)
- HTMX provides interactivity without React/Vue
- `layout()` returns raw strings (not `html` tagged templates) to avoid HTML escaping issues

**Key insight**: Hono's `html` tagged template literal escapes special characters. Using raw string templates with `c.html(rawString)` avoids this, at the cost of needing manual XSS prevention (mitigated by parameterized queries and no user input in templates without escaping).

### Embedding Model Selection

| Model | Dimensions | Cost | Language Support | Decision |
|-------|-----------|------|-----------------|----------|
| bge-base-en-v1.5 | 768 | Free | English (works for Spanish) | ✅ Selected |
| bge-large-en-v1.5 | 1024 | Free | English | Rejected (more storage) |
| bge-m3 | 1024 | Free | Multilingual | Rejected (dimension mismatch) |
| mml-768-v1 | 768 | Free | Multilingual | Not available on CF |

**Note**: bge-base-en-v1.5 works acceptably for Spanish text despite being English-trained. Tested with product FAQ in Spanish — relevant results returned with >70% similarity scores.

### AI Model Selection

| Use Case | Model | Cost | Context | Decision |
|----------|-------|------|---------|----------|
| Chat principal | llama-3.1-8b-instruct-fp8 | $0.05/1M tokens | 8K | ✅ Default |
| Clasificación | llama-3.2-3b-instruct | $0.01/1M tokens | 2K | ✅ Intent classification |
| Conversaciones complejas | llama-3.3-70b-instruct-fp8-fast | $0.59/1M tokens | 128K | Fallback for complex queries |
| STT | whisper-tiny-en | Free (10K/día) | — | Voice transcription |
| Embeddings | bge-base-en-v1.5 | Free | — | RAG vector search |

### Security Architecture

**Cookie Session**: HMAC-SHA256 signed value (`sessionId:signature`). Secret derived from `ADMIN_PASSWORD` with fallback to `workeriago-secret-default` for demo mode. Verification: split on `:`, recompute HMAC, compare.

**CSRF**: Dual-token approach — cookie `admin_csrf` + header `X-CSRF-Token` or form field `_csrf`. Middleware `csrfCheck` skips entirely in demo mode to avoid consuming `formData()` body (Hono only parses once).

**SQL Injection**: All status filters in tickets/leads/conversations routes use `.bind(status)` parameterized queries. No string interpolation in any SQL with user input.

**Audit Logging**: `auditLog(c, action, resource, resourceId, metadata)` helper called from 10+ POST routes. Writes to `audit_logs` table with IP from `CF-Connecting-IP` header.

## Phase 1: Data Model Research

### D1 Table Count: 28

Tables created via `migrations/v3.sql` (27 tables) + `health_logs` created manually via `wrangler d1 execute` command.

### Key Relationships

```
agents ─┬── agent_knowledge ── knowledge_base (N:N)
        ├── agent_tools ── mcp_tools (N:N)
        ├── conversations ── messages (1:N)
        │                    ├── tickets
        │                    └── leads
        └── workflows ── workflow_runs

tenants ── agents (tenant_id FK)
admin_users (standalone, no FK)
audit_logs (standalone, written by auditLog())
```

### Vectorize Integration

- Index: `workeriago-vectors` (768d, cosine)
- Documents indexed via `knowledge_base.id` → `vector_id` in Vectorize
- Metadata includes `agentId` for filtering
- Search: `VECTORIZE.query(vector, { topK: 5, filter: { agentId } })`

### R2 Backup Strategy

- All 28 tables SELECT * → JSON → R2 object `backups/<uuid>.json`
- Metadata in `backup_logs` (tables count, rows count, size bytes)
- Retention: 30 days (old backups purged by cron)
- Restore: fetch JSON from R2 → INSERT OR REPLACE into each table

## Key Learnings

1. **Vectorize dimension must match embedding model exactly** — 768d model with 1024d index = silent failure
2. **Hono formData() can only be parsed once** — CSRF middleware consuming it breaks downstream handlers
3. **Admin router prefix** — routes inside `admin` Hono sub-app must NOT include `/admin/` prefix (it's already mounted at `/admin`)
4. **Tailwind CDN** — no purge, all classes available, but ~3MB download. Acceptable for admin panel.
5. **esbuild ignores TypeScript errors** — `wrangler deploy` succeeds even with type errors. Must run `tsc --noEmit` separately.
