/**
 * AI Gateway — Observability, caching, rate limiting, fallback
 */

export interface AiGatewayEnv {
  DB: D1Database;
  CACHE: KVNamespace;
}

export interface LogEntry {
  request_id: string;
  agent_id?: string;
  conversation_id?: number;
  model: string;
  provider: string;
  tokens_input: number;
  tokens_output: number;
  cost_usd: number;
  latency_ms: number;
  status: string;
  error_message?: string;
  cache_hit: boolean;
  channel?: string;
  action?: string;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Model Pricing (per 1M tokens, USD)
// ═══════════════════════════════════════════════════════════════════════════════
const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  '@cf/meta/llama-3.1-8b-instruct-fp8': { input: 0.10, output: 0.10 },
  '@cf/meta/llama-3.2-3b-instruct': { input: 0.05, output: 0.05 },
  '@cf/meta/llama-3.3-70b-instruct-fp8-fast': { input: 0.59, output: 0.59 },
  '@cf/mistralai/mistral-7b-instruct-v0.2': { input: 0.10, output: 0.10 },
  '@cf/qwen/qwen1.5-14b-chat-awq': { input: 0.10, output: 0.10 },
};

function calculateCost(model: string, tokensIn: number, tokensOut: number): number {
  const pricing = MODEL_PRICING[model] || { input: 0.10, output: 0.10 };
  return ((tokensIn * pricing.input) + (tokensOut * pricing.output)) / 1_000_000;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Logging
// ═══════════════════════════════════════════════════════════════════════════════
export async function logAiRequest(
  env: AiGatewayEnv,
  entry: Omit<LogEntry, 'request_id' | 'cost_usd'>
): Promise<void> {
  const requestId = crypto.randomUUID();
  const cost = calculateCost(entry.model, entry.tokens_input, entry.tokens_output);

  try {
    await env.DB.prepare(
      `INSERT INTO ai_logs 
       (request_id, agent_id, conversation_id, model, provider, tokens_input, tokens_output,
        cost_usd, latency_ms, status, error_message, cache_hit, channel, action)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      requestId, entry.agent_id || null, entry.conversation_id || null,
      entry.model, entry.provider, entry.tokens_input, entry.tokens_output,
      cost, entry.latency_ms, entry.status, entry.error_message || null,
      entry.cache_hit ? 1 : 0, entry.channel || null, entry.action || null
    ).run();
  } catch (e) {
    console.error('Failed to log AI request:', e);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Response Cache
// ═══════════════════════════════════════════════════════════════════════════════
function getCacheKey(model: string, messages: any[]): string {
  const hash = messages.map(m => `${m.role}:${m.content}`).join('|');
  return `ai_cache:${model}:${hash.slice(0, 200)}`;
}

export async function getCachedResponse(
  env: AiGatewayEnv,
  model: string,
  messages: any[]
): Promise<{ response: string; tokens: number } | null> {
  try {
    const key = getCacheKey(model, messages);
    const cached = await env.CACHE.get(key, 'json');
    return cached;
  } catch {
    return null;
  }
}

export async function setCachedResponse(
  env: AiGatewayEnv,
  model: string,
  messages: any[],
  response: string,
  tokens: number,
  ttlSeconds = 3600
): Promise<void> {
  try {
    const key = getCacheKey(model, messages);
    await env.CACHE.put(key, JSON.stringify({ response, tokens }), {
      expirationTtl: ttlSeconds,
    });
  } catch (e) {
    console.error('Cache write failed:', e);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Rate Limiting (per agent, using KV)
// ═══════════════════════════════════════════════════════════════════════════════
export async function checkRateLimit(
  env: AiGatewayEnv,
  agentId: string,
  maxRequests = 60,
  windowSeconds = 60
): Promise<{ allowed: boolean; remaining: number }> {
  const key = `ratelimit:${agentId}:${Math.floor(Date.now() / (windowSeconds * 1000))}`;
  
  try {
    const current = parseInt((await env.CACHE.get(key)) || '0');
    if (current >= maxRequests) {
      return { allowed: false, remaining: 0 };
    }
    await env.CACHE.put(key, String(current + 1), {
      expirationTtl: windowSeconds * 2,
    });
    return { allowed: true, remaining: maxRequests - current - 1 };
  } catch {
    return { allowed: true, remaining: maxRequests };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Fallback Chain
// ═══════════════════════════════════════════════════════════════════════════════
const FALLBACK_MODELS = [
  '@cf/meta/llama-3.1-8b-instruct-fp8',
  '@cf/meta/llama-3.2-3b-instruct',
  '@cf/mistralai/mistral-7b-instruct-v0.2',
];

export async function aiWithFallback(
  ai: any,
  primaryModel: string,
  params: any,
  env?: AiGatewayEnv,
  agentId?: string
): Promise<{ result: any; model: string; fromCache: boolean }> {
  // Check cache first
  if (env && params.messages) {
    const cached = await getCachedResponse(env, primaryModel, params.messages);
    if (cached) {
      return { result: { response: cached.response }, model: primaryModel, fromCache: true };
    }
  }

  // Try primary model
  const models = [primaryModel, ...FALLBACK_MODELS.filter(m => m !== primaryModel)];

  for (const model of models) {
    try {
      const result = await ai.run(model, params);
      
      // Cache the response
      if (env && params.messages && result.response) {
        const tokens = (result.response?.split(/\s+/) || []).length;
        await setCachedResponse(env, model, params.messages, result.response, tokens);
      }

      return { result, model, fromCache: false };
    } catch (e: any) {
      console.error(`Model ${model} failed:`, e.message);
      continue;
    }
  }

  throw new Error('All AI models failed');
}

// ═══════════════════════════════════════════════════════════════════════════════
// Dashboard Stats
// ═══════════════════════════════════════════════════════════════════════════════
export async function getAiStats(
  db: D1Database,
  days = 30
): Promise<{
  totalRequests: number;
  totalTokensIn: number;
  totalTokensOut: number;
  totalCostUsd: number;
  avgLatencyMs: number;
  cacheHitRate: number;
  errorRate: number;
  byModel: Record<string, { requests: number; tokens: number; cost: number }>;
}> {
  const cutoff = new Date(Date.now() - days * 86400000).toISOString();

  const all = await db.prepare(
    `SELECT * FROM ai_logs WHERE created_at >= ?`
  ).bind(cutoff).all<LogEntry>();

  const logs = all.results || [];
  const total = logs.length || 1;

  const byModel: Record<string, { requests: number; tokens: number; cost: number }> = {};

  let totalTokensIn = 0, totalTokensOut = 0, totalCost = 0, totalLatency = 0;
  let cacheHits = 0, errors = 0;

  for (const log of logs) {
    totalTokensIn += log.tokens_input || 0;
    totalTokensOut += log.tokens_output || 0;
    totalCost += log.cost_usd || 0;
    totalLatency += log.latency_ms || 0;
    if (log.cache_hit) cacheHits++;
    if (log.status === 'error') errors++;

    const model = log.model?.split('/').pop() || 'unknown';
    if (!byModel[model]) byModel[model] = { requests: 0, tokens: 0, cost: 0 };
    byModel[model].requests++;
    byModel[model].tokens += (log.tokens_input || 0) + (log.tokens_output || 0);
    byModel[model].cost += log.cost_usd || 0;
  }

  return {
    totalRequests: logs.length,
    totalTokensIn,
    totalTokensOut,
    totalCostUsd: totalCost,
    avgLatencyMs: Math.round(totalLatency / total),
    cacheHitRate: Math.round((cacheHits / total) * 100),
    errorRate: Math.round((errors / total) * 100),
    byModel,
  };
}
