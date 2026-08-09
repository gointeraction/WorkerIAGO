/**
 * Multi-language — Auto-detect and respond in the user's language
 * 
 * Uses Workers AI for language detection and translation.
 */

export interface MultiLangEnv {
  AI: any;
}

/**
 * Detect language of text
 */
export async function detectLanguage(
  ai: any,
  text: string
): Promise<{ language: string; confidence: number }> {
  // Use classification model
  const result = await ai.run('@cf/mistralai/mistral-7b-instruct-v0.2', {
    messages: [
      {
        role: 'system',
        content: `Detect the language of this text. Respond with JSON: {"language": "xx", "confidence": 0.95}
Common languages: es (Spanish), en (English), pt (Portuguese), fr (French), de (German), it (Italian), zh (Chinese), ja (Japanese), ko (Korean), ar (Arabic)`,
      },
      { role: 'user', content: text.slice(0, 500) },
    ],
    max_tokens: 50,
  });

  try {
    const match = result.response.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
  } catch {}

  // Fallback: simple heuristic
  if (/[áéíóúñ¿¡]/.test(text)) return { language: 'es', confidence: 0.7 };
  if (/[àâçéèêëîïôùûüÿœæ]/.test(text)) return { language: 'fr', confidence: 0.7 };
  if (/[äöüß]/.test(text)) return { language: 'de', confidence: 0.7 };
  
  return { language: 'en', confidence: 0.5 };
}

/**
 * Translate text to target language
 */
export async function translateText(
  ai: any,
  text: string,
  targetLanguage: string
): Promise<string> {
  const langNames: Record<string, string> = {
    es: 'Spanish', en: 'English', pt: 'Portuguese', fr: 'French',
    de: 'German', it: 'Italian', zh: 'Chinese', ja: 'Japanese',
    ko: 'Korean', ar: 'Arabic',
  };

  const result = await ai.run('@cf/meta/llama-3.1-8b-instruct-fp8', {
    messages: [
      {
        role: 'system',
        content: `Translate the following text to ${langNames[targetLanguage] || targetLanguage}. Output ONLY the translation, nothing else.`,
      },
      { role: 'user', content: text },
    ],
    temperature: 0.1,
    max_tokens: 2048,
  });

  return result.response;
}

/**
 * Auto-reply in user's language
 */
export async function autoReplyInLanguage(
  ai: any,
  userMessage: string,
  botResponse: string
): Promise<string> {
  const { language } = await detectLanguage(ai, userMessage);
  
  // If response is already in the right language, return as-is
  const { language: responseLang } = await detectLanguage(ai, botResponse);
  if (responseLang === language) return botResponse;

  // Translate
  return translateText(ai, botResponse, language);
}

/**
 * Multi-language system prompt generator
 */
export function getMultilingualSystemPrompt(basePrompt: string): string {
  return `${basePrompt}

IMPORTANT: Always respond in the SAME language the user writes in.
- If they write in Spanish → respond in Spanish
- If they write in English → respond in English
- If they write in Portuguese → respond in Portuguese
- If they write in French → respond in French
- If unsure, default to Spanish.`;
}

/**
 * Language stats for analytics
 */
export async function getLanguageStats(
  db: D1Database,
  days = 30
): Promise<Record<string, number>> {
  // Analyze recent messages for language distribution
  const messages = await db.prepare(`
    SELECT content FROM messages 
    WHERE role = 'user' AND created_at > datetime('now', '-${days} days')
    LIMIT 1000
  `).all();

  const stats: Record<string, number> = {};
  for (const msg of messages.results || []) {
    const content = msg.content as string;
    if (/[áéíóúñ¿¡]/.test(content)) stats['es'] = (stats['es'] || 0) + 1;
    else if (/[àâçéèêëîïôùûüÿœæ]/.test(content)) stats['fr'] = (stats['fr'] || 0) + 1;
    else stats['en'] = (stats['en'] || 0) + 1;
  }

  return stats;
}
