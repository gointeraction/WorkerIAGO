/**
 * Persistent Memory — Agent remembers conversations across sessions
 * 
 * Stores long-term memory per user in D1:
 *   - Key facts extracted from conversations
 *   - User preferences
 *   - Interaction history summary
 *   - Sentiment trends
 */

export interface MemoryEnv {
  DB: D1Database;
  AI: Ai;
}

export interface UserMemory {
  id: string;
  user_id: string; // channel:chat_id
  memory_type: 'fact' | 'preference' | 'summary' | 'sentiment';
  content: string;
  source_conversation_id?: number;
  confidence: number;
  created_at: string;
  last_recalled_at: string;
  recall_count: number;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Extract key facts from conversation
// ═══════════════════════════════════════════════════════════════════════════════

export async function extractFacts(
  ai: any,
  message: string,
  response: string
): Promise<Array<{ fact: string; type: string; confidence: number }>> {
  const result = await ai.run('@cf/meta/llama-3.2-3b-instruct', {
    messages: [
      {
        role: 'system',
        content: `Extract key facts from this conversation exchange. Return JSON array.
Types: fact (name, phone, email, address, order), preference (likes, dislikes, interests), sentiment (mood, satisfaction).
Only extract clear, explicit information. Be conservative.
[{"fact": "...", "type": "fact|preference|sentiment", "confidence": 0.9}]
If nothing notable, return []`,
      },
      { role: 'user', content: `User: ${message}\nBot: ${response}` },
    ],
    max_tokens: 200,
  });

  try {
    const match = result.response.match(/\[[\s\S]*\]/);
    if (match) return JSON.parse(match[0]);
  } catch {}
  return [];
}

// ═══════════════════════════════════════════════════════════════════════════════
// Store memory
// ═══════════════════════════════════════════════════════════════════════════════

export async function storeMemory(
  env: MemoryEnv,
  userId: string,
  fact: string,
  type: string,
  confidence: number,
  conversationId?: number
): Promise<void> {
  // Check for duplicate
  const existing = await env.DB.prepare(
    `SELECT id FROM user_memories WHERE user_id = ? AND content = ?`
  ).bind(userId, fact).first();

  if (existing) return; // Already stored

  await env.DB.prepare(
    `INSERT INTO user_memories (id, user_id, memory_type, content, source_conversation_id, confidence)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(crypto.randomUUID(), userId, type, fact, conversationId || null, confidence).run();
}

// ═══════════════════════════════════════════════════════════════════════════════
// Recall memory
// ═══════════════════════════════════════════════════════════════════════════════

export async function recallMemory(
  env: MemoryEnv,
  userId: string,
  query: string,
  limit = 10
): Promise<UserMemory[]> {
  // Get all memories for this user
  const memories = await env.DB.prepare(
    `SELECT * FROM user_memories WHERE user_id = ? ORDER BY confidence DESC, created_at DESC LIMIT ?`
  ).bind(userId, limit).all<UserMemory>();

  const results = memories.results || [];

  // Update recall stats
  for (const mem of results) {
    await env.DB.prepare(
      `UPDATE user_memories SET last_recalled_at = datetime('now'), recall_count = recall_count + 1 WHERE id = ?`
    ).bind(mem.id).run();
  }

  return results;
}

/**
 * Get context string for LLM from user memories
 */
export async function getMemoryContext(
  env: MemoryEnv,
  userId: string
): Promise<string> {
  const memories = await recallMemory(env, userId, '', 5);
  if (memories.length === 0) return '';

  const facts = memories
    .filter(m => m.memory_type === 'fact')
    .map(m => `- ${m.content}`)
    .join('\n');
  const prefs = memories
    .filter(m => m.memory_type === 'preference')
    .map(m => `- ${m.content}`)
    .join('\n');

  let context = 'MEMORIA DEL USUARIO:\n';
  if (facts) context += `Datos conocidos:\n${facts}\n`;
  if (prefs) context += `Preferencias:\n${prefs}\n`;

  return context;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Conversation Summary
// ═══════════════════════════════════════════════════════════════════════════════

export async function summarizeConversation(
  ai: any,
  messages: Array<{ role: string; content: string }>
): Promise<string> {
  const result = await ai.run('@cf/meta/llama-3.1-8b-instruct-fp8', {
    messages: [
      {
        role: 'system',
        content: 'Summarize this conversation in 2-3 sentences. Focus on key topics, decisions, and action items.',
      },
      ...messages.slice(-20),
    ],
    temperature: 0.3,
    max_tokens: 200,
  });

  return result.response;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Auto-extract and store after each message
// ═══════════════════════════════════════════════════════════════════════════════

export async function processAndStoreMemory(
  env: MemoryEnv,
  userId: string,
  userMessage: string,
  botResponse: string,
  conversationId?: number
): Promise<void> {
  try {
    const facts = await extractFacts(env.AI, userMessage, botResponse);
    for (const item of facts) {
      await storeMemory(env, userId, item.fact, item.type, item.confidence, conversationId);
    }
  } catch (e) {
    console.error('Memory extraction error:', e);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Memory Management
// ═══════════════════════════════════════════════════════════════════════════════

export async function getUserMemories(
  env: MemoryEnv,
  userId: string
): Promise<UserMemory[]> {
  const result = await env.DB.prepare(
    `SELECT * FROM user_memories WHERE user_id = ? ORDER BY created_at DESC`
  ).bind(userId).all<UserMemory>();
  return result.results || [];
}

export async function deleteMemory(
  env: MemoryEnv,
  memoryId: string
): Promise<void> {
  await env.DB.prepare('DELETE FROM user_memories WHERE id = ?').bind(memoryId).run();
}

export async function clearUserMemories(
  env: MemoryEnv,
  userId: string
): Promise<void> {
  await env.DB.prepare('DELETE FROM user_memories WHERE user_id = ?').bind(userId).run();
}
