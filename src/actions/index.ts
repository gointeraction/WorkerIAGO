interface Env {
  DB: D1Database;
  VECTORIZE: VectorizeIndex;
}

interface ActionResult {
  action: string;
  success: boolean;
  result?: any;
  error?: string;
}

export class ActionEngine {
  private env: Env;
  private handlers: Map<string, (params: any, context: any) => Promise<any>>;

  constructor(env: Env) {
    this.env = env;
    this.handlers = new Map();
    this.registerDefaultHandlers();
  }

  private registerDefaultHandlers(): void {
    this.handlers.set('search_knowledge', async (params, context) => {
      const { query } = params;
      const { agentId } = context;
      const { results } = await this.env.DB.prepare(
        'SELECT * FROM knowledge_base WHERE agent_id = ? AND (content LIKE ? OR title LIKE ?)'
      ).bind(agentId, '%' + query + '%', '%' + query + '%').all();
      return { results, count: results.length };
    });

    this.handlers.set('create_ticket', async (params, context) => {
      const { title, description, priority } = params;
      const { chatId, channel, agentId, tenantId } = context;
      const result = await this.env.DB.prepare(
        'INSERT INTO tickets (agent_id, title, description, priority, category, status, tenant_id) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).bind(agentId, title || 'New Ticket', description || '', priority || 'medium', 'support', 'new', tenantId || 'default').run();
      return { ticketId: result.meta.last_row_id, priority: priority || 'medium' };
    });

    this.handlers.set('escalate_to_human', async (params, context) => {
      const { reason, urgency } = params;
      const { chatId, channel } = context;
      await this.env.DB.prepare(
        'UPDATE conversations SET status = ?, updated_at = datetime("now") WHERE chat_id = ? AND channel = ? AND status = ?'
      ).bind('escalated', chatId, channel, 'active').run();
      return { escalated: true, reason, urgency: urgency || 'normal' };
    });

    this.handlers.set('search_products', async (params, context) => {
      const { query, category } = params;
      const { agentId } = context;
      let sql = 'SELECT * FROM knowledge_base WHERE agent_id = ?';
      const bindings = [agentId];
      if (category) {
        sql += ' AND category = ?';
        bindings.push(category);
      }
      if (query) {
        sql += ' AND (content LIKE ? OR title LIKE ?)';
        bindings.push('%' + query + '%', '%' + query + '%');
      }
      const { results } = await this.env.DB.prepare(sql).bind(...bindings).all();
      return { products: results, count: results.length };
    });

    this.handlers.set('create_quote', async (params, context) => {
      const { items, notes } = params;
      return { quoteId: 'quote-' + Date.now(), items, notes, total: items?.length || 0 };
    });

    this.handlers.set('book_appointment', async (params, context) => {
      const { date, time, type } = params;
      const { chatId, channel, agentId, tenantId } = context;
      const result = await this.env.DB.prepare(
        'INSERT INTO leads (agent_id, name, interest, notes, status, tenant_id) VALUES (?, ?, ?, ?, ?, ?)'
      ).bind(agentId, chatId, type || 'appointment', JSON.stringify({ date, time }), 'qualified', tenantId || 'default').run();
      return { bookingId: result.meta.last_row_id, date, time, confirmed: true };
    });

    this.handlers.set('check_availability', async (params, context) => {
      const { date, time } = params;
      return { available: true, date, time, slots: ['09:00', '10:00', '11:00', '14:00', '15:00'] };
    });

    this.handlers.set('create_booking', async (params, context) => {
      const { date, time, client_name, client_phone } = params;
      return { bookingId: 'booking-' + Date.now(), date, time, client_name, confirmed: true };
    });

    this.handlers.set('cancel_booking', async (params, context) => {
      const { booking_id, reason } = params;
      return { cancelled: true, booking_id, reason };
    });

    this.handlers.set('send_confirmation', async (params, context) => {
      const { message, channel } = params;
      return { sent: true, message, channel: channel || context.channel };
    });

    this.handlers.set('qualify_lead', async (params, context) => {
      const { name, phone, interest, score } = params;
      const { agentId, tenantId } = context;
      const result = await this.env.DB.prepare(
        'INSERT INTO leads (agent_id, name, phone, interest, score, status, tenant_id) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).bind(agentId, name, phone, interest, score || 50, 'qualified', tenantId || 'default').run();
      return { leadId: result.meta.last_row_id, score: score || 50 };
    });
  }

  async executeActions(actions: any[], context: any): Promise<ActionResult[]> {
    const results: ActionResult[] = [];
    for (const action of actions) {
      const handler = this.handlers.get(action.name);
      if (!handler) {
        results.push({ action: action.name, success: false, error: 'Unknown action' });
        continue;
      }
      try {
        const result = await handler(action.params || {}, context);
        results.push({ action: action.name, success: true, result });
      } catch (error) {
        results.push({ action: action.name, success: false, error: String(error) });
      }
    }
    return results;
  }

  registerAction(name: string, handler: (params: any, context: any) => Promise<any>): void {
    this.handlers.set(name, handler);
  }
}
