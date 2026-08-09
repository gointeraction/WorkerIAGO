/**
 * Facebook Messenger Channel — Meta Graph API integration
 * 
 * Handles incoming messages from Facebook Messenger and sends responses.
 * Requires: FACEBOOK_PAGE_ACCESS_TOKEN, FACEBOOK_VERIFY_TOKEN
 */

export interface FacebookConfig {
  pageAccessToken: string;
  verifyToken: string;
  appSecret?: string;
}

export interface FacebookMessage {
  sender: { id: string };
  recipient: { id: string };
  timestamp: number;
  message?: {
    mid?: string;
    text?: string;
    quick_reply?: { payload: string };
    attachments?: Array<{
      type: string;
      payload?: { url?: string; coordinates?: { lat: number; long: number } };
    }>;
    is_echo?: boolean;
  };
  postback?: {
    title: string;
    payload: string;
  };
  read?: { mid: string };
  delivery?: { mids: string[] };
  referral?: {
    ref: string;
    source: string;
    type: string;
  };
}

export class FacebookChannel {
  private config: FacebookConfig;
  private apiBase = 'https://graph.facebook.com/v18.0';

  constructor(config: FacebookConfig) {
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
  parseWebhook(body: any): FacebookMessage[] {
    const messages: FacebookMessage[] = [];
    if (body.object !== 'page') return messages;

    for (const entry of body.entry || []) {
      for (const event of entry.messaging || []) {
        messages.push(event);
      }
    }
    return messages;
  }

  /**
   * Send text message
   */
  async sendText(recipientId: string, text: string): Promise<boolean> {
    try {
      const res = await fetch(`${this.apiBase}/me/messages`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.config.pageAccessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          recipient: { id: recipientId },
          message: { text },
        }),
      });
      return res.ok;
    } catch (e) {
      console.error('Facebook send error:', e);
      return false;
    }
  }

  /**
   * Send template (generic, button, etc.)
   */
  async sendTemplate(recipientId: string, template: any): Promise<boolean> {
    try {
      const res = await fetch(`${this.apiBase}/me/messages`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.config.pageAccessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          recipient: { id: recipientId },
          message: { attachment: { type: 'template', payload: template } },
        }),
      });
      return res.ok;
    } catch (e) {
      console.error('Facebook template error:', e);
      return false;
    }
  }

  /**
   * Send quick replies
   */
  async sendQuickReplies(recipientId: string, text: string, replies: Array<{ title: string; payload: string; image_url?: string }>): Promise<boolean> {
    try {
      const res = await fetch(`${this.apiBase}/me/messages`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.config.pageAccessToken}`,
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
              image_url: r.image_url,
            })),
          },
        }),
      });
      return res.ok;
    } catch (e) {
      console.error('Facebook quick replies error:', e);
      return false;
    }
  }

  /**
   * Send sender action (typing_on, mark_seen, etc.)
   */
  async sendAction(recipientId: string, action: 'typing_on' | 'typing_off' | 'mark_seen'): Promise<void> {
    try {
      await fetch(`${this.apiBase}/me/messages`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.config.pageAccessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          recipient: { id: recipientId },
          sender_action: action,
        }),
      });
    } catch (e) {}
  }

  /**
   * Set Get Started button
   */
  async setGetStarted(payload: string): Promise<boolean> {
    try {
      const res = await fetch(`${this.apiBase}/me/messenger_profile`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.config.pageAccessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          get_started: { payload },
        }),
      });
      return res.ok;
    } catch (e) {
      return false;
    }
  }

  /**
   * Set greeting text
   */
  async setGreeting(greeting: string): Promise<boolean> {
    try {
      const res = await fetch(`${this.apiBase}/me/messenger_profile`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.config.pageAccessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          greeting: [{ locale: 'default', text: greeting }],
        }),
      });
      return res.ok;
    } catch (e) {
      return false;
    }
  }
}
