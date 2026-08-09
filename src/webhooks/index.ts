/**
 * Webhooks — Event notification system
 * 
 * Register webhooks, send events to external systems.
 */

export interface Webhook {
  id: string;
  url: string;
  events: string[]; // 'conversation.created', 'message.received', 'lead.captured', etc.
  secret: string;
  is_active: boolean;
  last_triggered_at?: string;
  fail_count: number;
}

export class WebhookEngine {
  private db: D1Database;

  constructor(db: D1Database) {
    this.db = db;
  }

  async register(url: string, events: string[]): Promise<string> {
    const id = crypto.randomUUID();
    const secret = crypto.randomUUID();
    await this.db.prepare(
      `INSERT INTO webhooks (id, url, events, secret, is_active) VALUES (?, ?, ?, ?, 1)`
    ).bind(id, url, JSON.stringify(events), secret).run();
    return id;
  }

  async trigger(eventName: string, payload: any): Promise<void> {
    const hooks = await this.db.prepare(
      `SELECT * FROM webhooks WHERE is_active = 1`
    ).all();

    for (const hook of hooks.results || []) {
      const events = JSON.parse(hook.events as string);
      if (!events.includes(eventName) && !events.includes('*')) continue;

      try {
        const signature = await this.signPayload(hook.secret as string, JSON.stringify(payload));
        const res = await fetch(hook.url as string, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Webhook-Signature': signature,
            'X-Webhook-Event': eventName,
          },
          body: JSON.stringify({ event: eventName, payload, timestamp: new Date().toISOString() }),
        });

        if (res.ok) {
          await this.db.prepare(
            `UPDATE webhooks SET last_triggered_at = datetime('now'), fail_count = 0 WHERE id = ?`
          ).bind(hook.id).run();
        } else {
          await this.db.prepare(
            `UPDATE webhooks SET fail_count = fail_count + 1 WHERE id = ?`
          ).bind(hook.id).run();
        }
      } catch (e) {
        await this.db.prepare(
          `UPDATE webhooks SET fail_count = fail_count + 1 WHERE id = ?`
        ).bind(hook.id).run();
      }
    }
  }

  async list(): Promise<Webhook[]> {
    const result = await this.db.prepare('SELECT * FROM webhooks ORDER BY created_at DESC').all();
    return (result.results || []).map((w: any) => ({
      ...w,
      events: JSON.parse(w.events),
    }));
  }

  async delete(id: string): Promise<void> {
    await this.db.prepare('DELETE FROM webhooks WHERE id = ?').bind(id).run();
  }

  private async signPayload(secret: string, payload: string): Promise<string> {
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw', encoder.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false, ['sign']
    );
    const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(payload));
    return Array.from(new Uint8Array(signature)).map(b => b.toString(16).padStart(2, '0')).join('');
  }
}

export const WEBHOOK_EVENTS = [
  'conversation.created',
  'conversation.escalated',
  'message.received',
  'message.sent',
  'lead.captured',
  'lead.converted',
  'ticket.created',
  'ticket.resolved',
  'agent.response',
  'payment.completed',
  'booking.created',
];

/**
 * Public API — REST endpoints for external integration
 */
export const API_ENDPOINTS = {
  // Conversations
  'GET /api/v1/conversations': 'List conversations',
  'GET /api/v1/conversations/:id': 'Get conversation',
  'POST /api/v1/conversations/:id/messages': 'Send message',

  // Contacts
  'GET /api/v1/contacts': 'List contacts',
  'GET /api/v1/contacts/:id': 'Get contact',

  // Knowledge
  'GET /api/v1/knowledge': 'List knowledge docs',
  'POST /api/v1/knowledge/search': 'Semantic search',

  // Agents
  'GET /api/v1/agents': 'List agents',
  'POST /api/v1/agents/:id/chat': 'Chat with agent',

  // Analytics
  'GET /api/v1/analytics/overview': 'Dashboard overview',
  'GET /api/v1/analytics/conversations': 'Conversation stats',

  // MCP
  'GET /mcp': 'MCP manifest',
  'POST /mcp/call': 'Execute MCP tool',
};
