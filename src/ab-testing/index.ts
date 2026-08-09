/**
 * A/B Testing — Test different bot responses and measure conversion
 * 
 * Split traffic between response variants, track metrics.
 */

export interface AbTest {
  id: string;
  name: string;
  description: string;
  variants: AbVariant[];
  traffic_split: number[]; // percentages that sum to 100
  status: 'draft' | 'running' | 'paused' | 'completed';
  primary_metric: string; // 'conversion', 'satisfaction', 'response_time'
  start_date?: string;
  end_date?: string;
  created_at: string;
}

export interface AbVariant {
  id: string;
  name: string;
  system_prompt: string;
  weight: number;
  impressions: number;
  conversions: number;
  avg_response_time: number;
  satisfaction_score: number;
}

export interface AbEvent {
  test_id: string;
  variant_id: string;
  conversation_id: number;
  event_type: 'impression' | 'conversion' | 'click' | 'satisfaction';
  value?: number;
}

export class AbTestEngine {
  private db: D1Database;

  constructor(db: D1Database) {
    this.db = db;
  }

  /**
   * Create A/B test
   */
  async createTest(test: Omit<AbTest, 'id' | 'created_at'>): Promise<string> {
    const id = crypto.randomUUID();
    await this.db.prepare(
      `INSERT INTO ab_tests (id, name, description, variants, traffic_split, status, primary_metric, start_date, end_date)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      id, test.name, test.description,
      JSON.stringify(test.variants),
      JSON.stringify(test.traffic_split),
      test.status, test.primary_metric,
      test.start_date || null, test.end_date || null
    ).run();
    return id;
  }

  /**
   * Assign variant to a conversation (deterministic based on conversation_id)
   */
  async assignVariant(testId: string, conversationId: number): Promise<AbVariant | null> {
    const test = await this.db.prepare('SELECT * FROM ab_tests WHERE id = ?').bind(testId).first() as any;
    if (!test || test.status !== 'running') return null;

    const variants: AbVariant[] = JSON.parse(test.variants);
    const split: number[] = JSON.parse(test.traffic_split);

    // Deterministic assignment based on conversation ID
    const hash = conversationId % 100;
    let cumulative = 0;
    for (let i = 0; i < variants.length; i++) {
      cumulative += split[i];
      if (hash < cumulative) return variants[i];
    }

    return variants[0];
  }

  /**
   * Track event
   */
  async trackEvent(event: AbEvent): Promise<void> {
    // Update variant stats
    const test = await this.db.prepare('SELECT * FROM ab_tests WHERE id = ?').bind(event.test_id).first() as any;
    if (!test) return;

    const variants: AbVariant[] = JSON.parse(test.variants);
    const variant = variants.find(v => v.id === event.variant_id);
    if (!variant) return;

    if (event.event_type === 'impression') variant.impressions++;
    if (event.event_type === 'conversion') variant.conversions++;
    if (event.event_type === 'satisfaction' && event.value) {
      variant.satisfaction_score = (variant.satisfaction_score * (variant.impressions - 1) + event.value) / variant.impressions;
    }

    await this.db.prepare(
      `UPDATE ab_tests SET variants = ? WHERE id = ?`
    ).bind(JSON.stringify(variants), event.test_id).run();

    // Store event
    await this.db.prepare(
      `INSERT INTO ab_events (test_id, variant_id, conversation_id, event_type, value)
       VALUES (?, ?, ?, ?, ?)`
    ).bind(event.test_id, event.variant_id, event.conversation_id, event.event_type, event.value || null).run();
  }

  /**
   * Get test results
   */
  async getResults(testId: string): Promise<{
    test: AbTest;
    variants: Array<AbVariant & { conversionRate: number;ctr: number }>;
    winner?: string;
    confidence: number;
  }> {
    const test = await this.db.prepare('SELECT * FROM ab_tests WHERE id = ?').bind(testId).first() as any;
    const variants: AbVariant[] = JSON.parse(test.variants);

    const enriched = variants.map(v => ({
      ...v,
      conversionRate: v.impressions > 0 ? (v.conversions / v.impressions) * 100 : 0,
      ctr: v.impressions > 0 ? (v.conversions / v.impressions) * 100 : 0,
    }));

    // Simple winner detection (highest conversion rate with min 30 impressions)
    const viable = enriched.filter(v => v.impressions >= 30);
    const sorted = viable.sort((a, b) => b.conversionRate - a.conversionRate);
    const winner = sorted.length >= 2 && sorted[0].conversionRate > sorted[1].conversionRate * 1.1
      ? sorted[0].id
      : undefined;

    return {
      test,
      variants: enriched,
      winner,
      confidence: winner ? 95 : 0,
    };
  }

  /**
   * Get winning variant's system prompt
   */
  async getWinningPrompt(testId: string): Promise<string | null> {
    const { winner, variants } = await this.getResults(testId);
    if (!winner) return null;
    return variants.find(v => v.id === winner)?.system_prompt || null;
  }

  /**
   * List all tests
   */
  async listTests(): Promise<AbTest[]> {
    const result = await this.db.prepare('SELECT * FROM ab_tests ORDER BY created_at DESC').all();
    return (result.results || []).map((t: any) => ({
      ...t,
      variants: JSON.parse(t.variants),
      traffic_split: JSON.parse(t.traffic_split),
    }));
  }
}
