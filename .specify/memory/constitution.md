# WorkerIAGO Constitution

## Core Principles

### I. Edge-First Architecture

WorkerIAGO runs entirely on Cloudflare's edge network. Every feature must be deployable as a Worker. No server-side processes, no long-running containers. State goes to D1 (SQLite), KV (cache), Vectorize (embeddings), R2 (files), or Durable Objects (sessions). Latency budget: <50ms p50 for admin reads, <500ms p50 for AI chat responses.

### II. Self-Hosted Privacy (NON-NEGOTIABLE)

All data stays in the user's Cloudflare account. Conversations in their D1, documents in their R2, embeddings in their Vectorize. No telemetry sent to anyone. No third-party analytics. If the bot is asked if it's a bot, it admits it. This principle overrides any feature request that would require external data sharing.

### III. Multi-Channel by Default

Every agent must be reachable from any configured channel. Channel handlers normalize input to a common format (`message, chatId, channel, agentId`) and normalize output back. New channels must implement the channel handler interface — no agent logic in channel code, no channel logic in agent code.

### IV. RAG-Driven Intelligence

Agent responses must be grounded in the user's knowledge base when available. The orchestrator pipeline is: classify intent → search knowledge (Vectorize) → load MCP tools → generate response. If knowledge exists for the agent, it MUST be injected into the context. Hallucination prevention through grounded context is a hard requirement.

### V. Admin Panel = Server-Rendered HTML

The admin panel uses Hono + Tailwind CDN + HTMX. No SPA, no build step, no React. Pages are server-rendered HTML strings. Interactivity via HTMX attributes (`hx-get`, `hx-post`, `hx-swap`). The `layout()` function returns raw strings (NOT `html` tagged templates) to avoid HTML escaping. This keeps the admin panel fast, simple, and deployable as part of the Worker.

### VI. Security Hardening

- Cookie sessions are HMAC-signed (not plaintext)
- CSRF protection active when `ADMIN_PASSWORD` is set
- All SQL queries with user input use parameterized bindings (never string interpolation)
- Audit logging on all mutating admin actions via `auditLog()` helper
- Secrets stored via `wrangler secret put`, never in code or config files

### VII. Cost Consciousness

Workers AI is free up to 10K requests/day. Default models (Llama 3.1 8B, bge-base-en-v1.5) are chosen for cost-efficiency. AI Gateway caches responses in KV to avoid redundant LLM calls. Embedding model is 768 dimensions (not 1024) to reduce Vectorize storage costs. Target: <$5/month for a small business with ~1000 conversations/day.

## Technology Stack Constraints

- **Runtime**: Cloudflare Workers (TypeScript, Hono framework)
- **AI**: Workers AI binding (`AI`) — Llama 3.1 8B (chat), Llama 3.2 3B (classification), bge-base-en-v1.5 (embeddings 768d)
- **Database**: D1 binding (`DB`) — 28 SQLite tables
- **Vector Search**: Vectorize binding (`VECTORIZE`) — 768 dimensions, cosine similarity
- **Storage**: R2 binding (`STORAGE`) — file uploads, backups
- **Cache**: KV binding (`CACHE`) — AI response cache, rate limiting
- **Stateful**: Durable Object `AGENT_STATE` — session state
- **Scheduled**: Cron trigger `0 3 * * *` — daily backup, cleanup
- **Admin UI**: Tailwind CSS via CDN, HTMX, no build step
- **Deploy**: `wrangler deploy` — single command, no CI/CD required

## Development Workflow

1. **Local dev**: `wrangler dev` with local D1/KV/R2 emulators
2. **Type checking**: `npx tsc --noEmit` — must pass before deploy (wrangler uses esbuild, ignores type errors, so manual check required)
3. **Deploy**: `npx wrangler deploy` — single command
4. **Verify**: Check `/admin` loads (200), test a POST route, check `/admin/api/health-check`
5. **Git**: Commit with descriptive message, push to `main`

## Governance

This constitution supersedes all other practices. Amendments require:
1. Documentation of the change and rationale
2. Verification that existing features still comply
3. Update to README.md if architecture changes

All code changes must verify compliance with these principles. Complexity beyond what's described here must be justified in the PR description.

**Version**: 1.0.0 | **Ratified**: 2026-08-09 | **Last Amended**: 2026-08-09
