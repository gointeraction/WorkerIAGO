import type { AgentOrchestrator } from '../orchestrator';

export class WebChannel {
  async handleMessage(
    message: string,
    chatId: string,
    agentId: string | undefined,
    orchestrator: AgentOrchestrator
  ): Promise<any> {
    // Process message with orchestrator
    const result = await orchestrator.processMessage(message, chatId, 'web', [], agentId);

    return {
      response: result.response,
      agent: result.agent,
      intent: result.intent,
      actions: result.actions,
      sources: result.sources
    };
  }
}
