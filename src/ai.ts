// Cloudflare Workers AI Integration
// Modelos: https://developers.cloudflare.com/workers-ai/models/

export type AIProvider = 'workers';

interface AIConfig {
  provider: AIProvider;
  ai: any; // Cloudflare AI binding
}

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

// Modelos disponibles en Workers AI
export const MODELS = {
  chat: '@cf/meta/llama-3.1-8b-instruct',
  chatSmall: '@cf/meta/llama-3.1-8b-instruct',
  chatLarge: '@cf/meta/llama-3.1-70b-instruct',
  embedding: '@cf/baai/bge-base-en-v1.5',
  embeddingLarge: '@cf/baai/bge-large-en-v1.5',
  image: '@cf/stabilityai/stable-diffusion-xl-base-1.0',
  audio: '@cf/openai/whisper-tiny-en',
  classification: '@cf/huggingface/distilbert-sst-2-integer-quantized'
};

export async function chat(
  config: AIConfig,
  messages: ChatMessage[],
  options?: { temperature?: number; maxTokens?: number; model?: string }
): Promise<string> {
  const model = options?.model || MODELS.chat;
  
  const result = await config.ai.run(model, {
    messages,
    temperature: options?.temperature ?? 0.7,
    max_tokens: options?.maxTokens ?? 512
  });

  return result.response;
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
  const result = await config.ai.run(MODELS.embedding, {
    text: [text]
  });

  return result.data[0];
}

export async function generateImage(
  config: AIConfig,
  prompt: string
): Promise<string> {
  const result = await config.ai.run(MODELS.image, {
    prompt
  });

  return result.images[0];
}

export async function transcribeAudio(
  config: AIConfig,
  audio: ArrayBuffer
): Promise<string> {
  const result = await config.ai.run(MODELS.audio, {
    audio: [...new Uint8Array(audio)]
  });

  return result.text;
}

export async function classifyText(
  config: AIConfig,
  text: string,
  classes: string[]
): Promise<{ label: string; score: number }> {
  const result = await config.ai.run(MODELS.classification, {
    text
  });

  return result;
}
