interface Env {
  AI: Ai;
  DB: D1Database;
}

interface ConversationState {
  chatId: string;
  channel: string;
  agentId: string;
  history: Array<{ role: string; content: string }>;
  context: Record<string, any>;
  lastActivity: number;
}

export class AgentState {
  private state: DurableObjectState;
  private env: Env;
  private conversation: ConversationState | null = null;

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const action = url.pathname.split('/').pop();

    switch (action) {
      case 'get':
        return this.getState();
      case 'update':
        return this.updateState(await request.json());
      case 'add-message':
        return this.addMessage(await request.json());
      case 'clear':
        return this.clearState();
      default:
        return new Response('Unknown action', { status: 400 });
    }
  }

  private async getState(): Promise<Response> {
    if (!this.conversation) {
      this.conversation = await this.state.storage.get<ConversationState>('conversation') || null;
    }
    return Response.json(this.conversation || { history: [], context: {} });
  }

  private async updateState(data: Partial<ConversationState>): Promise<Response> {
    if (!this.conversation) {
      this.conversation = await this.state.storage.get<ConversationState>('conversation') || {
        chatId: '',
        channel: '',
        agentId: '',
        history: [],
        context: {},
        lastActivity: Date.now()
      };
    }

    this.conversation = { ...this.conversation, ...data, lastActivity: Date.now() };
    await this.state.storage.put('conversation', this.conversation);

    return Response.json({ ok: true });
  }

  private async addMessage(data: { role: string; content: string }): Promise<Response> {
    if (!this.conversation) {
      await this.getState();
      if (!this.conversation) {
        this.conversation = {
          chatId: '',
          channel: '',
          agentId: '',
          history: [],
          context: {},
          lastActivity: Date.now()
        };
      }
    }

    this.conversation.history.push({ role: data.role, content: data.content });

    // Keep only last 20 messages
    if (this.conversation.history.length > 20) {
      this.conversation.history = this.conversation.history.slice(-20);
    }

    this.conversation.lastActivity = Date.now();
    await this.state.storage.put('conversation', this.conversation);

    return Response.json({ ok: true, historyLength: this.conversation.history.length });
  }

  private async clearState(): Promise<Response> {
    this.conversation = null;
    await this.state.storage.delete('conversation');
    return Response.json({ ok: true });
  }
}
