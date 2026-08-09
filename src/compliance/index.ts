/**
 * Audit Logs — Track all admin actions
 */

export interface AuditEntry {
  id: string;
  user_id: string;
  user_email: string;
  action: string;
  resource_type: string;
  resource_id?: string;
  details?: Record<string, any>;
  ip_address?: string;
  user_agent?: string;
  created_at: string;
}

export class AuditLogger {
  private db: D1Database;

  constructor(db: D1Database) {
    this.db = db;
  }

  async log(entry: Omit<AuditEntry, 'id' | 'created_at'>): Promise<void> {
    await this.db.prepare(
      `INSERT INTO audit_logs (id, user_id, user_email, action, resource_type, resource_id, details, ip_address, user_agent)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      crypto.randomUUID(), entry.user_id, entry.user_email, entry.action,
      entry.resource_type, entry.resource_id || null,
      entry.details ? JSON.stringify(entry.details) : null,
      entry.ip_address || null, entry.user_agent || null
    ).run();
  }

  async getLogs(filters: {
    user_id?: string;
    resource_type?: string;
    action?: string;
    limit?: number;
    offset?: number;
  }): Promise<AuditEntry[]> {
    let query = 'SELECT * FROM audit_logs WHERE 1=1';
    const params: any[] = [];

    if (filters.user_id) { query += ' AND user_id = ?'; params.push(filters.user_id); }
    if (filters.resource_type) { query += ' AND resource_type = ?'; params.push(filters.resource_type); }
    if (filters.action) { query += ' AND action = ?'; params.push(filters.action); }

    query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    params.push(filters.limit || 50, filters.offset || 0);

    const result = await this.db.prepare(query).bind(...params).all();
    return (result.results || []).map((r: any) => ({
      ...r,
      details: r.details ? JSON.parse(r.details) : undefined,
    }));
  }

  /**
   * Convenience methods for common actions
   */
  async logCreate(userId: string, email: string, resource: string, id: string, details?: any) {
    return this.log({ user_id: userId, user_email: email, action: 'create', resource_type: resource, resource_id: id, details });
  }
  async logUpdate(userId: string, email: string, resource: string, id: string, details?: any) {
    return this.log({ user_id: userId, user_email: email, action: 'update', resource_type: resource, resource_id: id, details });
  }
  async logDelete(userId: string, email: string, resource: string, id: string, details?: any) {
    return this.log({ user_id: userId, user_email: email, action: 'delete', resource_type: resource, resource_id: id, details });
  }
  async logLogin(userId: string, email: string, ip?: string) {
    return this.log({ user_id: userId, user_email: email, action: 'login', resource_type: 'auth', ip_address: ip });
  }
}

/**
 * GDPR — Data export and deletion
 */
export class GdprManager {
  private db: D1Database;

  constructor(db: D1Database) {
    this.db = db;
  }

  /**
   * Export all user data (Right to portability)
   */
  async exportUserData(userId: string): Promise<Record<string, any>> {
    const conversations = await this.db.prepare(
      'SELECT * FROM conversations WHERE chat_id = ?'
    ).bind(userId).all();

    const messages = await this.db.prepare(`
      SELECT m.* FROM messages m
      JOIN conversations c ON m.conversation_id = c.id
      WHERE c.chat_id = ?
    `).bind(userId).all();

    const memories = await this.db.prepare(
      'SELECT * FROM user_memories WHERE user_id = ?'
    ).bind(userId).all();

    const leads = await this.db.prepare(
      'SELECT * FROM leads WHERE phone = ? OR email = ?'
    ).bind(userId, userId).all();

    return {
      export_date: new Date().toISOString(),
      user_id: userId,
      conversations: conversations.results,
      messages: messages.results,
      memories: memories.results,
      leads: leads.results,
    };
  }

  /**
   * Delete all user data (Right to erasure)
   */
  async deleteUserData(userId: string): Promise<{ deleted: Record<string, number> }> {
    const deleted: Record<string, number> = {};

    // Delete memories
    const memResult = await this.db.prepare('DELETE FROM user_memories WHERE user_id = ?').bind(userId).run();
    deleted.memories = memResult.meta?.changes || 0;

    // Anonymize conversations (keep structure, remove personal data)
    const convResult = await this.db.prepare(`
      UPDATE conversations SET user_name = 'Deleted', user_phone = NULL, user_email = NULL
      WHERE chat_id = ?
    `).bind(userId).run();
    deleted.conversations_anonymized = convResult.meta?.changes || 0;

    // Anonymize messages
    const msgResult = await this.db.prepare(`
      UPDATE messages SET content = '[Deleted]' 
      WHERE conversation_id IN (SELECT id FROM conversations WHERE chat_id = ?)
    `).bind(userId).run();
    deleted.messages_anonymized = msgResult.meta?.changes || 0;

    // Anonymize leads
    const leadResult = await this.db.prepare(`
      UPDATE leads SET name = 'Deleted', phone = NULL, email = NULL, notes = NULL
      WHERE phone = ? OR email = ?
    `).bind(userId, userId).run();
    deleted.leads_anonymized = leadResult.meta?.changes || 0;

    return { deleted };
  }

  /**
   * Get data retention report
   */
  async getRetentionReport(): Promise<{
    total_users: number;
    total_conversations: number;
    total_messages: number;
    total_memories: number;
    oldest_data: string;
  }> {
    const users = await this.db.prepare('SELECT COUNT(DISTINCT chat_id) as c FROM conversations').first() as any;
    const convs = await this.db.prepare('SELECT COUNT(*) as c FROM conversations').first() as any;
    const msgs = await this.db.prepare('SELECT COUNT(*) as c FROM messages').first() as any;
    const mems = await this.db.prepare('SELECT COUNT(*) as c FROM user_memories').first() as any;
    const oldest = await this.db.prepare('SELECT MIN(created_at) as c FROM conversations').first() as any;

    return {
      total_users: users?.c || 0,
      total_conversations: convs?.c || 0,
      total_messages: msgs?.c || 0,
      total_memories: mems?.c || 0,
      oldest_data: oldest?.c || 'N/A',
    };
  }
}
