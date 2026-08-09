/**
 * Multi-tenant — Multiple businesses on one WorkerIAGO instance
 * 
 * Each tenant has isolated data, agents, and configuration.
 * Data isolation via tenant_id column on all tables.
 */

export interface Tenant {
  id: string;
  name: string;
  slug: string; // URL-friendly identifier
  plan: 'free' | 'starter' | 'pro' | 'enterprise';
  status: 'active' | 'suspended' | 'cancelled';
  config: Record<string, any>;
  limits: {
    max_agents: number;
    max_messages_month: number;
    max_knowledge_docs: number;
    max_channels: number;
    max_storage_mb: number;
  };
  owner_email: string;
  created_at: string;
  updated_at: string;
}

export const TENANT_PLANS = {
  free: {
    label: 'Free',
    limits: {
      max_agents: 2,
      max_messages_month: 1000,
      max_knowledge_docs: 10,
      max_channels: 1,
      max_storage_mb: 100,
    },
  },
  starter: {
    label: 'Starter',
    limits: {
      max_agents: 5,
      max_messages_month: 10000,
      max_knowledge_docs: 50,
      max_channels: 3,
      max_storage_mb: 1000,
    },
  },
  pro: {
    label: 'Pro',
    limits: {
      max_agents: 20,
      max_messages_month: 100000,
      max_knowledge_docs: 500,
      max_channels: 10,
      max_storage_mb: 10000,
    },
  },
  enterprise: {
    label: 'Enterprise',
    limits: {
      max_agents: -1, // unlimited
      max_messages_month: -1,
      max_knowledge_docs: -1,
      max_channels: -1,
      max_storage_mb: -1,
    },
  },
};

export class TenantManager {
  private db: D1Database;

  constructor(db: D1Database) {
    this.db = db;
  }

  /**
   * Create new tenant
   */
  async createTenant(data: {
    name: string;
    slug: string;
    ownerEmail: string;
    plan?: keyof typeof TENANT_PLANS;
  }): Promise<Tenant> {
    const id = crypto.randomUUID();
    const plan = data.plan || 'free';
    const limits = TENANT_PLANS[plan].limits;

    await this.db.prepare(
      `INSERT INTO tenants (id, name, slug, plan, status, config, limits, owner_email)
       VALUES (?, ?, ?, ?, 'active', '{}', ?, ?)`
    ).bind(id, data.name, data.slug, plan, JSON.stringify(limits), data.ownerEmail).run();

    // Create default agent for tenant
    await this.db.prepare(
      `INSERT INTO agents (id, name, type, system_prompt, model, tenant_id)
       VALUES (?, ?, 'general', ?, '@cf/meta/llama-3.1-8b-instruct-fp8', ?)`
    ).bind(crypto.randomUUID(), `${data.name} Bot`, `Eres ${data.name}, un asistente virtual profesional.`, id).run();

    return this.getTenant(id) as Promise<Tenant>;
  }

  /**
   * Get tenant by ID
   */
  async getTenant(id: string): Promise<Tenant | null> {
    const result = await this.db.prepare('SELECT * FROM tenants WHERE id = ?').bind(id).first();
    if (!result) return null;
    return {
      ...result,
      config: JSON.parse(result.config as string || '{}'),
      limits: JSON.parse(result.limits as string || '{}'),
    } as Tenant;
  }

  /**
   * Get tenant by slug
   */
  async getTenantBySlug(slug: string): Promise<Tenant | null> {
    const result = await this.db.prepare('SELECT * FROM tenants WHERE slug = ?').bind(slug).first();
    if (!result) return null;
    return {
      ...result,
      config: JSON.parse(result.config as string || '{}'),
      limits: JSON.parse(result.limits as string || '{}'),
    } as Tenant;
  }

  /**
   * Check tenant limits
   */
  async checkLimit(
    tenantId: string,
    resource: keyof Tenant['limits']
  ): Promise<{ allowed: boolean; current: number; limit: number }> {
    const tenant = await this.getTenant(tenantId);
    if (!tenant) return { allowed: false, current: 0, limit: 0 };

    const limit = tenant.limits[resource];
    if (limit === -1) return { allowed: true, current: 0, limit: -1 }; // unlimited

    let current = 0;
    switch (resource) {
      case 'max_agents':
        current = ((await this.db.prepare('SELECT COUNT(*) as c FROM agents WHERE tenant_id = ?').bind(tenantId).first()) as any)?.c || 0;
        break;
      case 'max_knowledge_docs':
        current = ((await this.db.prepare('SELECT COUNT(*) as c FROM knowledge_base WHERE tenant_id = ?').bind(tenantId).first()) as any)?.c || 0;
        break;
      case 'max_messages_month':
        current = ((await this.db.prepare(
          `SELECT COUNT(*) as c FROM messages m
           JOIN conversations c ON m.conversation_id = c.id
           WHERE c.tenant_id = ? AND m.created_at > datetime('now', '-30 days')`
        ).bind(tenantId).first()) as any)?.c || 0;
        break;
    }

    return { allowed: current < limit, current, limit };
  }

  /**
   * Update tenant plan
   */
  async updatePlan(tenantId: string, plan: keyof typeof TENANT_PLANS): Promise<void> {
    const limits = TENANT_PLANS[plan].limits;
    await this.db.prepare(
      `UPDATE tenants SET plan = ?, limits = ?, updated_at = datetime('now') WHERE id = ?`
    ).bind(plan, JSON.stringify(limits), tenantId).run();
  }

  /**
   * Suspend tenant
   */
  async suspend(tenantId: string): Promise<void> {
    await this.db.prepare(
      `UPDATE tenants SET status = 'suspended', updated_at = datetime('now') WHERE id = ?`
    ).bind(tenantId).run();
  }

  /**
   * Get tenant stats
   */
  async getStats(tenantId: string): Promise<{
    agents: number;
    conversations: number;
    messages_month: number;
    knowledge_docs: number;
    storage_mb: number;
  }> {
    const agents = ((await this.db.prepare('SELECT COUNT(*) as c FROM agents WHERE tenant_id = ?').bind(tenantId).first()) as any)?.c || 0;
    const conversations = ((await this.db.prepare('SELECT COUNT(*) as c FROM conversations WHERE tenant_id = ?').bind(tenantId).first()) as any)?.c || 0;
    const messages_month = ((await this.db.prepare(
      `SELECT COUNT(*) as c FROM messages m JOIN conversations c ON m.conversation_id = c.id WHERE c.tenant_id = ? AND m.created_at > datetime('now', '-30 days')`
    ).bind(tenantId).first()) as any)?.c || 0;
    const knowledge_docs = ((await this.db.prepare('SELECT COUNT(*) as c FROM knowledge_base WHERE tenant_id = ?').bind(tenantId).first()) as any)?.c || 0;

    return { agents, conversations, messages_month, knowledge_docs, storage_mb: 0 };
  }

  /**
   * List all tenants
   */
  async listTenants(): Promise<Tenant[]> {
    const result = await this.db.prepare('SELECT * FROM tenants ORDER BY created_at DESC').all();
    return (result.results || []).map((r: any) => ({
      ...r,
      config: JSON.parse(r.config || '{}'),
      limits: JSON.parse(r.limits || '{}'),
    }));
  }

  /**
   * Resolve tenant from request (by custom domain or header)
   */
  async resolveTenant(request: Request): Promise<Tenant | null> {
    // Check X-Tenant-ID header
    const tenantId = request.headers.get('X-Tenant-ID');
    if (tenantId) return this.getTenant(tenantId);

    // Check custom domain
    const host = new URL(request.url).hostname;
    const tenant = await this.db.prepare('SELECT * FROM tenants WHERE slug = ?').bind(host.split('.')[0]).first();
    if (tenant) {
      return {
        ...tenant,
        config: JSON.parse(tenant.config as string || '{}'),
        limits: JSON.parse(tenant.limits as string || '{}'),
      } as Tenant;
    }

    return null;
  }
}

/**
 * Tenant-scoped query builder — safe parameterized tenant filtering
 * 
 * Usage:
 *   const { sql, binds } = tenantQuery(tenantId, 'SELECT * FROM agents WHERE is_active = 1', [agentId]);
 *   const result = await db.prepare(sql).bind(...binds).all();
 */
export function tenantQuery(
  tenantId: string,
  query: string,
  existingBinds: (string | number | null)[] = []
): { sql: string; binds: (string | number | null)[] } {
  if (query.includes('WHERE')) {
    return {
      sql: query.replace('WHERE', 'WHERE tenant_id = ? AND'),
      binds: [tenantId, ...existingBinds],
    };
  }
  if (query.includes('ORDER BY') || query.includes('GROUP BY') || query.includes('LIMIT')) {
    return {
      sql: query.replace(/(ORDER BY|GROUP BY|LIMIT)/, 'WHERE tenant_id = ? $1'),
      binds: [...existingBinds, tenantId],
    };
  }
  return {
    sql: query + ' WHERE tenant_id = ?',
    binds: [...existingBinds, tenantId],
  };
}

/**
 * Legacy alias — use tenantQuery() instead for new code.
 * This wrapper calls tenantQuery and returns just the SQL string
 * (binds must be prepended by caller).
 */
export function withTenant(tenantId: string, query: string): string {
  const { sql } = tenantQuery(tenantId, query);
  return sql;
}

/**
 * Get tenant ID from Hono context (set by tenantMiddleware)
 */
export function getTenantId(c: any): string {
  return c.get('tenantId') || c.req.header('X-Tenant-ID') || 'default';
}
