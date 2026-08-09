import type { AgentOrchestrator } from '../orchestrator';

export class WhatsAppChannel {
  private token: string;
  private phoneId: string;
  private apiBase: string;

  constructor(token: string, phoneId: string) {
    this.token = token;
    this.phoneId = phoneId;
    this.apiBase = 'https://graph.facebook.com/v18.0/' + phoneId;
  }

  async handleWebhook(body: any, orchestrator: AgentOrchestrator): Promise<any> {
    const entry = body.entry?.[0];
    const changes = entry?.changes?.[0];
    const value = changes?.value;

    if (!value?.messages?.length) return { ok: true };

    const message = value.messages[0];
    const chatId = message.from;
    const text = message.text?.body || '';

    if (!text) return { ok: true };

    // Process message with orchestrator
    const result = await orchestrator.processMessage(text, chatId, 'whatsapp');

    // Send response
    return this.sendMessage(chatId, result.response);
  }

  async sendMessage(to: string, text: string): Promise<any> {
    const response = await fetch(this.apiBase + '/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + this.token
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to,
        type: 'text',
        text: { body: text }
      })
    });
    return response.json();
  }

  async sendTemplate(to: string, templateName: string, language: string = 'es'): Promise<any> {
    const response = await fetch(this.apiBase + '/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + this.token
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to,
        type: 'template',
        template: {
          name: templateName,
          language: { code: language }
        }
      })
    });
    return response.json();
  }

  async setWebhook(url: string): Promise<any> {
    const response = await fetch('https://graph.facebook.com/v18.0/' + this.phoneId + '/subscribed_apps', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + this.token
      },
      body: JSON.stringify({ subscribed_fields: ['messages'] })
    });
    return response.json();
  }
}
