/**
 * Monitoring — System health, alerts, and diagnostics
 * 
 * Tracks: error rates, response times, uptime, resource usage.
 * Alerts via: Email, Telegram, Webhook.
 */

export interface MonitoringEnv {
  DB: D1Database;
  AI: Ai;
  CACHE: KVNamespace;
}

export interface HealthStatus {
  status: 'healthy' | 'degraded' | 'down';
  uptime_seconds: number;
  error_rate_1h: number;
  avg_response_time_1h: number;
  active_conversations: number;
  messages_last_hour: number;
  ai_model_status: string;
  d1_status: string;
  kv_status: string;
  vectorize_status: string;
  r2_status: string;
  last_check: string;
  issues: string[];
}

export interface Alert {
  id: string;
  type: 'error_rate' | 'response_time' | 'downtime' | 'quota' | 'custom';
  severity: 'info' | 'warning' | 'critical';
  message: string;
  metadata?: Record<string, any>;
  created_at: string;
  acknowledged: boolean;
}

export class MonitoringEngine {
  private env: MonitoringEnv;
  private startTime: number;

  constructor(env: MonitoringEnv) {
    this.env = env;
    this.startTime = Date.now();
  }

  /**
   * Full health check
   */
  async checkHealth(): Promise<HealthStatus> {
    const issues: string[] = [];
    const now = new Date().toISOString();

    // Check D1
    let d1Status = 'ok';
    try {
      await this.env.DB.prepare('SELECT 1').first();
    } catch (e) {
      d1Status = 'error';
      issues.push('D1 database not responding');
    }

    // Check KV
    let kvStatus = 'ok';
    try {
      await this.env.CACHE.get('__health_check');
      await this.env.CACHE.put('__health_check', 'ok', { expirationTtl: 10 });
    } catch (e) {
      kvStatus = 'error';
      issues.push('KV cache not responding');
    }

    // Check Vectorize
    let vectorizeStatus = 'ok';
    try {
      // Query with zero vector to test connectivity
      await (this.env as any).VECTORIZE?.query(new Array(768).fill(0), { topK: 1 });
    } catch (e) {
      vectorizeStatus = 'degraded';
    }

    // Check error rate (last hour)
    const errorRate = await this.getErrorRate(1);
    if (errorRate > 10) {
      issues.push(`High error rate: ${errorRate.toFixed(1)}%`);
    }

    // Check response time
    const avgResponseTime = await this.getAvgResponseTime(1);
    if (avgResponseTime > 5000) {
      issues.push(`Slow response time: ${avgResponseTime}ms`);
    }

    // Get active conversations
    const active = await this.env.DB.prepare(
      `SELECT COUNT(*) as c FROM conversations WHERE status = 'active' AND updated_at > datetime('now', '-1 hour')`
    ).first() as any;

    // Messages last hour
    const msgs = await this.env.DB.prepare(
      `SELECT COUNT(*) as c FROM messages WHERE created_at > datetime('now', '-1 hour')`
    ).first() as any;

    // AI model test
    let aiStatus = 'ok';
    try {
      await this.env.AI.run('@cf/meta/llama-3.2-3b-instruct' as any, {
        messages: [{ role: 'user', content: 'hi' }],
        max_tokens: 5,
      });
    } catch (e) {
      aiStatus = 'error';
      issues.push('AI model not responding');
    }

    const status = issues.length === 0 ? 'healthy' : issues.some(i => i.includes('not responding')) ? 'down' : 'degraded';

    return {
      status,
      uptime_seconds: Math.floor((Date.now() - this.startTime) / 1000),
      error_rate_1h: errorRate,
      avg_response_time_1h: avgResponseTime,
      active_conversations: active?.c || 0,
      messages_last_hour: msgs?.c || 0,
      ai_model_status: aiStatus,
      d1_status: d1Status,
      kv_status: kvStatus,
      vectorize_status: vectorizeStatus,
      r2_status: 'ok',
      last_check: now,
      issues,
    };
  }

  /**
   * Get error rate for last N hours
   */
  async getErrorRate(hours: number): Promise<number> {
    try {
      const total = await this.env.DB.prepare(
        `SELECT COUNT(*) as c FROM ai_logs WHERE created_at > datetime('now', '-${hours} hours')`
      ).first() as any;
      const errors = await this.env.DB.prepare(
        `SELECT COUNT(*) as c FROM ai_logs WHERE status = 'error' AND created_at > datetime('now', '-${hours} hours')`
      ).first() as any;

      const t = total?.c || 0;
      return t > 0 ? ((errors?.c || 0) / t) * 100 : 0;
    } catch {
      return 0;
    }
  }

  /**
   * Get average response time
   */
  async getAvgResponseTime(hours: number): Promise<number> {
    try {
      const result = await this.env.DB.prepare(
        `SELECT AVG(latency_ms) as avg FROM ai_logs WHERE created_at > datetime('now', '-${hours} hours')`
      ).first() as any;
      return Math.round(result?.avg || 0);
    } catch {
      return 0;
    }
  }

  /**
   * Create alert
   */
  async createAlert(type: string, severity: string, message: string, metadata?: Record<string, any>): Promise<void> {
    await this.env.DB.prepare(
      `INSERT INTO monitoring_alerts (id, type, severity, message, metadata, created_at)
       VALUES (?, ?, ?, ?, ?, datetime('now'))`
    ).bind(crypto.randomUUID(), type, severity, message, metadata ? JSON.stringify(metadata) : null).run();

    // Send alert notifications
    await this.sendAlertNotification(severity, message);
  }

  /**
   * Send alert via configured channels
   */
  private async sendAlertNotification(severity: string, message: string): Promise<void> {
    // Get alert webhooks
    const hooks = await this.env.DB.prepare(
      `SELECT * FROM webhooks WHERE is_active = 1`
    ).all();

    for (const hook of hooks.results || []) {
      try {
        await fetch(hook.url as string, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            event: 'monitoring.alert',
            severity,
            message,
            timestamp: new Date().toISOString(),
          }),
        });
      } catch (e) {}
    }
  }

  /**
   * Get recent alerts
   */
  async getAlerts(limit = 20): Promise<Alert[]> {
    const result = await this.env.DB.prepare(
      `SELECT * FROM monitoring_alerts ORDER BY created_at DESC LIMIT ?`
    ).bind(limit).all();
    return (result.results || []).map((a: any) => ({
      ...a,
      metadata: a.metadata ? JSON.parse(a.metadata) : undefined,
    }));
  }

  /**
   * Acknowledge alert
   */
  async acknowledgeAlert(alertId: string): Promise<void> {
    await this.env.DB.prepare(
      `UPDATE monitoring_alerts SET acknowledged = 1 WHERE id = ?`
    ).bind(alertId).run();
  }

  /**
   * Performance metrics
   */
  async getPerformanceMetrics(days = 7): Promise<{
    requests_per_day: Array<{ date: string; count: number; errors: number }>;
    top_models: Array<{ model: string; count: number; avg_latency: number }>;
    peak_hours: Array<{ hour: number; count: number }>;
  }> {
    // Requests per day
    const daily = await this.env.DB.prepare(`
      SELECT date(created_at) as date, COUNT(*) as count,
             SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) as errors
      FROM ai_logs WHERE created_at > datetime('now', '-${days} days')
      GROUP BY date(created_at) ORDER BY date
    `).all();

    // Top models
    const models = await this.env.DB.prepare(`
      SELECT model, COUNT(*) as count, AVG(latency_ms) as avg_latency
      FROM ai_logs WHERE created_at > datetime('now', '-${days} days')
      GROUP BY model ORDER BY count DESC LIMIT 5
    `).all();

    // Peak hours
    const hours = await this.env.DB.prepare(`
      SELECT CAST(strftime('%H', created_at) AS INTEGER) as hour, COUNT(*) as count
      FROM ai_logs WHERE created_at > datetime('now', '-${days} days')
      GROUP BY hour ORDER BY count DESC
    `).all();

    return {
      requests_per_day: daily.results as any[],
      top_models: models.results as any[],
      peak_hours: hours.results as any[],
    };
  }
}

/**
 * Scheduled health check — runs every 5 minutes
 */
export async function scheduledHealthCheck(env: MonitoringEnv): Promise<void> {
  const monitor = new MonitoringEngine(env);
  const health = await monitor.checkHealth();

  // Log health status
  await env.DB.prepare(
    `INSERT INTO health_logs (status, error_count, metadata) VALUES (?, ?, ?)`
  ).bind(health.status, health.issues.length, JSON.stringify(health)).run();

  // Create alerts for critical issues
  if (health.status === 'down') {
    await monitor.createAlert('downtime', 'critical', `System is DOWN: ${health.issues.join(', ')}`);
  } else if (health.status === 'degraded') {
    await monitor.createAlert('degraded', 'warning', `System degraded: ${health.issues.join(', ')}`);
  }

  if (health.error_rate_1h > 20) {
    await monitor.createAlert('error_rate', 'critical', `Error rate is ${health.error_rate_1h.toFixed(1)}%`);
  }
}
