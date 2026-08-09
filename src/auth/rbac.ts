/**
 * RBAC — Role-Based Access Control for admin panel
 * 
 * Roles: super_admin, admin, editor, viewer
 * Permissions: granular per resource
 */

export interface RbacUser {
  id: string;
  email: string;
  name: string;
  role: 'super_admin' | 'admin' | 'editor' | 'viewer';
  permissions: string[];
  created_at: string;
  last_login_at?: string;
}

export const ROLES = {
  super_admin: {
    label: 'Super Admin',
    permissions: ['*'], // all permissions
  },
  admin: {
    label: 'Admin',
    permissions: [
      'agents.read', 'agents.write', 'agents.delete',
      'knowledge.read', 'knowledge.write', 'knowledge.delete',
      'conversations.read', 'conversations.write', 'conversations.escalate',
      'leads.read', 'leads.write', 'leads.delete',
      'tickets.read', 'tickets.write', 'tickets.assign',
      'mcp_tools.read', 'mcp_tools.write', 'mcp_tools.delete', 'mcp_tools.execute',
      'workflows.read', 'workflows.write', 'workflows.execute',
      'analytics.read',
      'settings.read', 'settings.write',
      'users.read', 'users.invite',
    ],
  },
  editor: {
    label: 'Editor',
    permissions: [
      'agents.read', 'agents.write',
      'knowledge.read', 'knowledge.write',
      'conversations.read', 'conversations.write',
      'leads.read', 'leads.write',
      'tickets.read', 'tickets.write',
      'analytics.read',
    ],
  },
  viewer: {
    label: 'Viewer',
    permissions: [
      'agents.read',
      'knowledge.read',
      'conversations.read',
      'leads.read',
      'tickets.read',
      'analytics.read',
    ],
  },
};

export class RbacEngine {
  private db: D1Database;

  constructor(db: D1Database) {
    this.db = db;
  }

  /**
   * Check if user has permission
   */
  async hasPermission(userId: string, permission: string): Promise<boolean> {
    const user = await this.db.prepare('SELECT * FROM admin_users WHERE id = ?').bind(userId).first() as any;
    if (!user) return false;

    const role = ROLES[user.role as keyof typeof ROLES];
    if (!role) return false;

    // Super admin has all
    if (role.permissions.includes('*')) return true;

    // Check explicit permission
    const userPerms = JSON.parse(user.permissions || '[]');
    if (userPerms.includes(permission)) return true;

    // Check role permission
    return role.permissions.includes(permission);
  }

  /**
   * Get user's effective permissions
   */
  async getUserPermissions(userId: string): Promise<string[]> {
    const user = await this.db.prepare('SELECT * FROM admin_users WHERE id = ?').bind(userId).first() as any;
    if (!user) return [];

    const role = ROLES[user.role as keyof typeof ROLES];
    const rolePerms = role?.permissions || [];
    const userPerms = JSON.parse(user.permissions || '[]');

    return [...new Set([...rolePerms, ...userPerms])];
  }

  /**
   * Create user
   */
  async createUser(email: string, name: string, role: keyof typeof ROLES): Promise<string> {
    const id = crypto.randomUUID();
    await this.db.prepare(
      `INSERT INTO admin_users (id, email, name, role, permissions) VALUES (?, ?, ?, ?, '[]')`
    ).bind(id, email, name, role).run();
    return id;
  }

  /**
   * Update user role
   */
  async updateRole(userId: string, role: keyof typeof ROLES): Promise<void> {
    await this.db.prepare('UPDATE admin_users SET role = ? WHERE id = ?').bind(role, userId).run();
  }

  /**
   * Grant additional permission
   */
  async grantPermission(userId: string, permission: string): Promise<void> {
    const user = await this.db.prepare('SELECT permissions FROM admin_users WHERE id = ?').bind(userId).first() as any;
    const perms = JSON.parse(user?.permissions || '[]');
    if (!perms.includes(permission)) {
      perms.push(permission);
      await this.db.prepare('UPDATE admin_users SET permissions = ? WHERE id = ?')
        .bind(JSON.stringify(perms), userId).run();
    }
  }

  /**
   * Revoke permission
   */
  async revokePermission(userId: string, permission: string): Promise<void> {
    const user = await this.db.prepare('SELECT permissions FROM admin_users WHERE id = ?').bind(userId).first() as any;
    const perms = JSON.parse(user?.permissions || '[]');
    const filtered = perms.filter((p: string) => p !== permission);
    await this.db.prepare('UPDATE admin_users SET permissions = ? WHERE id = ?')
      .bind(JSON.stringify(filtered), userId).run();
  }

  /**
   * List users
   */
  async listUsers(): Promise<RbacUser[]> {
    const result = await this.db.prepare('SELECT * FROM admin_users ORDER BY created_at DESC').all();
    return (result.results || []).map((u: any) => ({
      ...u,
      permissions: JSON.parse(u.permissions || '[]'),
    }));
  }

  /**
   * Delete user
   */
  async deleteUser(userId: string): Promise<void> {
    await this.db.prepare('DELETE FROM admin_users WHERE id = ?').bind(userId).run();
  }
}

/**
 * Middleware: check permission for admin route
 */
export function requirePermission(permission: string) {
  return async (userId: string, rbac: RbacEngine): Promise<boolean> => {
    return rbac.hasPermission(userId, permission);
  };
}
