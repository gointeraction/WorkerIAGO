import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createXai } from '@ai-sdk/xai';
import { generateText, streamText } from 'ai';

export type AIProvider = 'openai' | 'anthropic' | 'xai' | 'workers';

interface AIConfig {
  provider: AIProvider;
  apiKey?: string;
  model?: string;
}

export function getAIProvider(config: AIConfig) {
  switch (config.provider) {
    case 'anthropic':
      return createAnthropic({ apiKey: config.apiKey });
    case 'xai':
      return createXai({ apiKey: config.apiKey });
    case 'openai':
    default:
      return createOpenAI({ apiKey: config.apiKey });
  }
}

export function getModel(config: AIConfig) {
  const provider = getAIProvider(config);
  const models: Record<AIProvider, string> = {
    openai: config.model || 'gpt-4o-mini',
    anthropic: config.model || 'claude-3-haiku-20240307',
    xai: config.model || 'grok-2',
    workers: config.model || '@cf/meta/llama-3.1-8b-instruct'
  };
  return provider(models[config.provider]);
}

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export async function chat(
  config: AIConfig,
  messages: ChatMessage[],
  options?: { temperature?: number; maxTokens?: number }
): Promise<string> {
  const model = getModel(config);
  
  const result = await generateText({
    model,
    messages,
    temperature: options?.temperature ?? 0.7,
    maxTokens: options?.maxTokens ?? 512
  });

  return result.text;
}

export async function classifyIntent(
  config: AIConfig,
  message: string
): Promise<string> {
  const result = await chat(config, [
    {
      role: 'system',
      content: `Clasifica este mensaje en UNA sola categoría:
      - ventas: compra, precio, producto, cotización, servicio
      - soporte: problema, error, ayuda, no funciona, queja
      - reservas: cita, agendar, turno, reservar, disponibilidad
      - escalate: necesito hablar con alguien, humano, manager, queja grave
      - general: saludo, despedida, otra cosa
      
      Responde SOLO con la categoría, nada más.`
    },
    { role: 'user', content: message }
  ], { maxTokens: 10 });

  return result.trim().toLowerCase();
}

export async function detectActions(
  config: AIConfig,
  message: string,
  availableTools: string[]
): Promise<any[]> {
  const result = await chat(config, [
    {
      role: 'system',
      content: `Analiza el mensaje y determina qué acciones se deben ejecutar.
      
      Acciones disponibles: ${availableTools.join(', ')}
      
      Responde con un JSON array de objetos con "name" y "params".
      Si no hay acciones, responde con un array vacío: []
      
      Ejemplo:
      [{"name": "search_knowledge", "params": {"query": "precio"}}]
      [{"name": "book_appointment", "params": {"date": "2024-01-15", "time": "10:00"}}]
      []`
    },
    { role: 'user', content: message }
  ], { maxTokens: 200 });

  try {
    const parsed = JSON.parse(result);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function generateAgentResponse(
  config: AIConfig,
  message: string,
  systemPrompt: string,
  context?: string,
  history?: ChatMessage[]
): Promise<string> {
  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt + (context ? `\n\nCONTEXTO:\n${context}` : '') },
    ...(history?.slice(-10) || []),
    { role: 'user', content: message }
  ];

  return chat(config, messages, { temperature: 0.7, maxTokens: 512 });
}

export async function generateEmbedding(
  config: AIConfig,
  text: string
): Promise<number[]> {
  const provider = getAIProvider(config);
  const model = provider.embedding('text-embedding-3-small');
  
  const result = await model.doEmbed({ values: [text] });
  return result.embeddings[0];
}

export { streamText };
