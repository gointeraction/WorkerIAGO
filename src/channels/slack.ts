/**
 * Slack Channel — Slack Bot integration
 * 
 * Requires: SLACK_BOT_TOKEN, SLACK_SIGNING_SECRET
 */

export interface SlackConfig {
  botToken: string;
  signingSecret: string;
  appToken?: string; // for Socket Mode
}

export class SlackChannel {
  private config: SlackConfig;
  private apiBase = 'https://slack.com/api';

  constructor(config: SlackConfig) {
    this.config = config;
  }

  /**
   * Send message to Slack channel
   */
  async sendMessage(channel: string, text: string, blocks?: any[]): Promise<boolean> {
    try {
      const body: any = { channel, text };
      if (blocks) body.blocks = blocks;

      const res = await fetch(`${this.apiBase}/chat.postMessage`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.config.botToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });
      const data: any = await res.json();
      return data.ok;
    } catch (e) {
      console.error('Slack send error:', e);
      return false;
    }
  }

  /**
   * Send DM to user
   */
  async sendDM(userId: string, text: string): Promise<boolean> {
    try {
      // Open DM channel
      const openRes = await fetch(`${this.apiBase}/conversations.open`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.config.botToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ users: userId }),
      });
      const openData: any = await openRes.json();
      if (!openData.ok) return false;

      return this.sendMessage(openData.channel.id, text);
    } catch (e) {
      console.error('Slack DM error:', e);
      return false;
    }
  }

  /**
   * Send rich message with blocks
   */
  async sendRichMessage(channel: string, message: {
    text: string;
    blocks?: any[];
    attachments?: any[];
  }): Promise<boolean> {
    try {
      const res = await fetch(`${this.apiBase}/chat.postMessage`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.config.botToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ channel, ...message }),
      });
      const data: any = await res.json();
      return data.ok;
    } catch (e) {
      return false;
    }
  }

  /**
   * Add reaction to message
   */
  async addReaction(channel: string, timestamp: string, name: string): Promise<boolean> {
    try {
      const res = await fetch(`${this.apiBase}/reactions.add`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.config.botToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ channel, timestamp, name }),
      });
      const data: any = await res.json();
      return data.ok;
    } catch (e) {
      return false;
    }
  }

  /**
   * Update message
   */
  async updateMessage(channel: string, timestamp: string, text: string): Promise<boolean> {
    try {
      const res = await fetch(`${this.apiBase}/chat.update`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.config.botToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ channel, ts: timestamp, text }),
      });
      const data: any = await res.json();
      return data.ok;
    } catch (e) {
      return false;
    }
  }

  /**
   * Verify Slack request signature
   */
  verifySignature(timestamp: string, body: string, signature: string): boolean {
    // HMAC-SHA256 verification
    // In Workers, use Web Crypto API
    return true; // placeholder — implement with crypto.subtle
  }

  /**
   * Parse Slack event
   */
  parseEvent(body: any): any {
    if (body.type === 'url_verification') {
      return { type: 'challenge', challenge: body.challenge };
    }

    if (body.type === 'event_callback') {
      const event = body.event;
      if (event.type === 'message') {
        return {
          type: 'message',
          text: event.text,
          user: event.user,
          channel: event.channel,
          ts: event.ts,
          thread_ts: event.thread_ts,
        };
      }
      if (event.type === 'app_mention') {
        return {
          type: 'mention',
          text: event.text?.replace(/<@[^>]+>/g, '').trim(),
          user: event.user,
          channel: event.channel,
          ts: event.ts,
        };
      }
    }

    if (body.type === 'interactive') {
      const action = body.actions?.[0];
      return {
        type: 'interaction',
        action_id: action?.action_id,
        value: action?.value,
        user: body.user,
        channel: body.channel,
        response_url: body.response_url,
      };
    }

    return null;
  }

  /**
   * Respond to slash command
   */
  async respondSlashCommand(responseUrl: string, text: string): Promise<boolean> {
    try {
      const res = await fetch(responseUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ response_type: 'in_channel', text }),
      });
      return res.ok;
    } catch (e) {
      return false;
    }
  }
}
