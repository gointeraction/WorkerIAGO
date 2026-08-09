/**
 * Instagram DM Channel — Meta Graph API integration
 * 
 * Handles incoming messages from Instagram DMs and sends responses.
 * Requires: INSTAGRAM_ACCESS_TOKEN, INSTAGRAM_VERIFY_TOKEN
 */

export interface InstagramConfig {
  accessToken: string;
  verifyToken: string;
  appSecret?: string;
}

export interface InstagramMessage {
  sender: { id: string };
  recipient: { id: string };
  timestamp: number;
  message?: {
    mid?: string;
    text?: string;
    attachments?: Array<{
      type: string;
      payload?: { url?: string };
    }>;
  };
  read?: { mid: string };
  delivery?: { mids: string[] };
}

export class InstagramChannel {
  private config: InstagramConfig;
  private apiBase = 'https://graph.facebook.com/v18.0';

  constructor(config: InstagramConfig) {
    this.config = config;
  }

  /**
   * Verify webhook for Meta
   */
  verify(query: { 'hub.mode': string; 'hub.verify_token': string; 'hub.challenge': string }): string | null {
    if (query['hub.mode'] === 'subscribe' && query['hub.verify_token'] === this.config.verifyToken) {
      return query['hub.challenge'];
    }
    return null;
  }

  /**
   * Parse incoming webhook payload
   */
  parseWebhook(body: any): InstagramMessage[] {
    const messages: InstagramMessage[] = [];
    if (body.object !== 'instagram') return messages;

    for (const entry of body.entry || []) {
      for (const event of entry.messaging || []) {
        messages.push(event);
      }
    }
    return messages;
  }

  /**
   * Send text message to Instagram user
   */
  async sendText(recipientId: string, text: string): Promise<boolean> {
    try {
      const res = await fetch(`${this.apiBase}/me/messages`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.config.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          recipient: { id: recipientId },
          message: { text },
        }),
      });
      return res.ok;
    } catch (e) {
      console.error('Instagram send error:', e);
      return false;
    }
  }

  /**
   * Send image
   */
  async sendImage(recipientId: string, imageUrl: string): Promise<boolean> {
    try {
      const res = await fetch(`${this.apiBase}/me/messages`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.config.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          recipient: { id: recipientId },
          message: {
            attachment: { type: 'image', payload: { url: imageUrl } },
          },
        }),
      });
      return res.ok;
    } catch (e) {
      console.error('Instagram send image error:', e);
      return false;
    }
  }

  /**
   * Send quick replies
   */
  async sendQuickReplies(recipientId: string, text: string, replies: Array<{ title: string; payload: string }>): Promise<boolean> {
    try {
      const res = await fetch(`${this.apiBase}/me/messages`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.config.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          recipient: { id: recipientId },
          message: {
            text,
            quick_replies: replies.map(r => ({
              content_type: 'text',
              title: r.title,
              payload: r.payload,
            })),
          },
        }),
      });
      return res.ok;
    } catch (e) {
      console.error('Instagram quick replies error:', e);
      return false;
    }
  }

  /**
   * Mark message as seen
   */
  async markSeen(messageId: string): Promise<void> {
    try {
      await fetch(`${this.apiBase}/me/messages`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.config.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          recipient: { id: messageId },
          sender_action: 'mark_seen',
        }),
      });
    } catch (e) {}
  }

  /**
   * Typing indicator
   */
  async sendTyping(recipientId: string): Promise<void> {
    try {
      await fetch(`${this.apiBase}/me/messages`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.config.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          recipient: { id: recipientId },
          sender_action: 'typing_on',
        }),
      });
    } catch (e) {}
  }
}
