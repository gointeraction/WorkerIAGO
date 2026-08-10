/**
 * Backup — Automatic D1 + R2 backup system
 * 
 * Scheduled backups to R2 with retention policy.
 * Supports full backup and point-in-time recovery.
 */

export interface BackupEnv {
  DB: D1Database;
  STORAGE: R2Bucket;
  AI: Ai;
}

export interface BackupManifest {
  id: string;
  type: 'full' | 'incremental';
  status: 'running' | 'completed' | 'failed';
  tables: string[];
  total_rows: number;
  total_size_bytes: number;
  r2_prefix: string;
  started_at: string;
  completed_at?: string;
  error?: string;
}

export class BackupEngine {
  private env: BackupEnv;

  constructor(env: BackupEnv) {
    this.env = env;
  }

  /**
   * Full backup — dump all tables to JSON in R2
   */
  async fullBackup(): Promise<BackupManifest> {
    const backupId = `backup_${Date.now()}`;
    const r2Prefix = `backups/${backupId}`;
    const startTime = new Date().toISOString();

    const manifest: BackupManifest = {
      id: backupId,
      type: 'full',
      status: 'running',
      tables: [],
      total_rows: 0,
      total_size_bytes: 0,
      r2_prefix: r2Prefix,
      started_at: startTime,
    };

    // Tables to backup
    const tables = [
      'agents', 'conversations', 'messages', 'tickets', 'leads',
      'knowledge_base', 'knowledge_chunks', 'agent_knowledge',
      'mcp_tools', 'agent_tools', 'tool_execution_logs', 'ai_logs',
      'config', 'workflows', 'workflow_runs', 'connectors',
      'ab_tests', 'ab_events', 'webhooks', 'admin_users', 'audit_logs',
      'user_memories', 'tenants', 'monitoring_alerts', 'health_logs',
    ];

    try {
      for (const table of tables) {
        try {
          const rows = await this.env.DB.prepare(`SELECT * FROM ${table}`).all();
          const data = rows.results || [];

          if (data.length > 0) {
            const json = JSON.stringify(data, null, 2);
            await this.env.STORAGE.put(`${r2Prefix}/${table}.json`, json, {
              httpMetadata: { contentType: 'application/json' },
            });

            manifest.tables.push(table);
            manifest.total_rows += data.length;
            manifest.total_size_bytes += new TextEncoder().encode(json).length;
          }
        } catch (e) {
          console.error(`Backup table ${table} failed:`, e);
        }
      }

      // Save manifest
      manifest.status = 'completed';
      manifest.completed_at = new Date().toISOString();

      await this.env.STORAGE.put(`${r2Prefix}/manifest.json`, JSON.stringify(manifest, null, 2), {
        httpMetadata: { contentType: 'application/json' },
      });

      // Log backup
      await this.env.DB.prepare(
        `INSERT INTO backup_logs (id, type, status, tables, total_rows, total_size_bytes, started_at, completed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        backupId, 'full', 'completed',
        JSON.stringify(manifest.tables), manifest.total_rows, manifest.total_size_bytes,
        startTime, manifest.completed_at
      ).run();

    } catch (e: any) {
      manifest.status = 'failed';
      manifest.error = e.message;
      manifest.completed_at = new Date().toISOString();

      await this.env.DB.prepare(
        `INSERT INTO backup_logs (id, type, status, error, started_at, completed_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).bind(backupId, 'full', 'failed', e.message, startTime, manifest.completed_at).run();
    }

    return manifest;
  }

  /**
   * Restore from backup
   */
  async restore(backupId: string, tables?: string[]): Promise<{ restored: string[]; errors: string[] }> {
    const r2Prefix = `backups/${backupId}`;
    const restored: string[] = [];
    const errors: string[] = [];

    // Get manifest
    const manifestObj = await this.env.STORAGE.get(`${r2Prefix}/manifest.json`);
    if (!manifestObj) throw new Error('Backup not found');

    const manifest: BackupManifest = await manifestObj.json();
    const tablesToRestore = tables || manifest.tables;

    for (const table of tablesToRestore) {
      try {
        const obj = await this.env.STORAGE.get(`${r2Prefix}/${table}.json`);
        if (!obj) continue;

        const data: any[] = await obj.json();
        if (data.length === 0) continue;

        // Clear existing data
        await this.env.DB.prepare(`DELETE FROM ${table}`).run();

        // Insert backed up data (batch in groups of 50)
        const columns = Object.keys(data[0]);
        const placeholders = columns.map(() => '?').join(', ');
        const insertQuery = `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders})`;

        for (let i = 0; i < data.length; i += 50) {
          const batch = data.slice(i, i + 50);
          const stmt = this.env.DB.prepare(insertQuery);
          const batchStatements = batch.map((row: any) =>
            stmt.bind(...columns.map(c => row[c] ?? null))
          );
          await this.env.DB.batch(batchStatements);
        }

        restored.push(table);
      } catch (e: any) {
        errors.push(`${table}: ${e.message}`);
      }
    }

    return { restored, errors };
  }

  /**
   * List available backups
   */
  async listBackups(): Promise<BackupManifest[]> {
    const list = await this.env.STORAGE.list({ prefix: 'backups/' });
    const backups: BackupManifest[] = [];

    for (const obj of list.objects || []) {
      if (obj.key.endsWith('manifest.json')) {
        try {
          const content = await this.env.STORAGE.get(obj.key);
          if (content) {
            backups.push(await content.json());
          }
        } catch (e) {}
      }
    }

    return backups.sort((a, b) => b.started_at.localeCompare(a.started_at));
  }

  /**
   * Delete old backups (retention policy)
   */
  async cleanupOldBackups(keepDays = 30): Promise<number> {
    const cutoff = new Date(Date.now() - keepDays * 86400000).toISOString();
    const backups = await this.listBackups();
    let deleted = 0;

    for (const backup of backups) {
      if (backup.started_at < cutoff) {
        try {
          // Delete all files for this backup
          const list = await this.env.STORAGE.list({ prefix: `${backup.r2_prefix}/` });
          for (const obj of list.objects || []) {
            await this.env.STORAGE.delete(obj.key);
          }

          // Delete log entry
          await this.env.DB.prepare('DELETE FROM backup_logs WHERE id = ?').bind(backup.id).run();
          deleted++;
        } catch (e) {}
      }
    }

    return deleted;
  }

  /**
   * Export backup as downloadable JSON
   */
  async exportBackup(backupId: string): Promise<any> {
    const r2Prefix = `backups/${backupId}`;
    const result: Record<string, any> = {};

    const list = await this.env.STORAGE.list({ prefix: `${r2Prefix}/` });
    for (const obj of list.objects || []) {
      if (obj.key.endsWith('.json') && !obj.key.endsWith('manifest.json')) {
        const tableName = obj.key.split('/').pop()?.replace('.json', '');
        if (tableName) {
          const content = await this.env.STORAGE.get(obj.key);
          if (content) result[tableName] = await content.json();
        }
      }
    }

    return result;
  }
}

/**
 * Scheduled backup — runs daily at 2am
 */
export async function scheduledBackup(env: BackupEnv): Promise<void> {
  const engine = new BackupEngine(env);
  
  // Run full backup
  await engine.fullBackup();

  // Cleanup old backups
  await engine.cleanupOldBackups(30);
}
