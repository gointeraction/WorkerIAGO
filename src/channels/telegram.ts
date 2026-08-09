import type { AgentOrchestrator } from '../orchestrator';

export class TelegramChannel {
  private token: string;
  private apiBase: string;

  constructor(token: string) {
    this.token = token;
    this.apiBase = `https://api.telegram.org/bot${token}`;
  }

  async handleUpdate(update: any, orchestrator: AgentOrchestrator): Promise<any> {
    const message = update.message;
    if (!message || !message.text) return { ok: true };

    const chatId = message.chat.id.toString();
    const text = message.text;
    const userName = message.from?.first_name || 'Usuario';

    // Handle /start command
    if (text === '/start') {
      return this.sendMessage(chatId, '¡Hola ' + userName + '! Soy tu asistente virtual. ¿En qué te puedo ayudar?');
    }

    // Handle /help command
    if (text === '/help') {
      return this.sendMessage(chatId, 'Puedo ayudarte con:\n- Información de productos\n- Reservar citas\n- Soporte técnico\n- Y mucho más. ¡Escríbeme!');
    }

    // Send typing action
    await this.sendChatAction(chatId, 'typing');

    // Process message with orchestrator
    const result = await orchestrator.processMessage(text, chatId, 'telegram');

    // Send response
    return this.sendMessage(chatId, result.response);
  }

  async sendMessage(chatId: string, text: string): Promise<any> {
    const response = await fetch(this.apiBase + '/sendMessage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: 'HTML'
      })
    });
    return response.json();
  }

  async sendChatAction(chatId: string, action: string): Promise<any> {
    const response = await fetch(this.apiBase + '/sendChatAction', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        action
      })
    });
    return response.json();
  }

  async setWebhook(url: string): Promise<any> {
    const response = await fetch(this.apiBase + '/setWebhook', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url })
    });
    return response.json();
  }
}
