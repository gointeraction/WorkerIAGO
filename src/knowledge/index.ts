/**
 * Knowledge Module — RAG pipeline with R2 + Vectorize
 * 
 * Upload → Chunk → Embed → Store → Search
 */

export interface KnowledgeEnv {
  DB: D1Database;
  VECTORIZE: VectorizeIndex;
  STORAGE?: R2Bucket;
  AI: Ai;
}

export interface KbDocument {
  id: string;
  title: string;
  description?: string;
  category: string;
  source_type: string;
  source_url?: string;
  r2_key?: string;
  mime_type?: string;
  file_size?: number;
  content_preview?: string;
  chunk_count: number;
  is_published: number;
  created_at: string;
  updated_at: string;
}

export interface KbChunk {
  id: string;
  kb_id: string;
  chunk_index: number;
  content: string;
  token_count: number;
  vector_id?: string;
}

const CHUNK_SIZE = 800; // chars per chunk
const CHUNK_OVERLAP = 100; // overlap between chunks

// ═══════════════════════════════════════════════════════════════════════════════
// Text Chunking
// ═══════════════════════════════════════════════════════════════════════════════
export function chunkText(text: string, chunkSize = CHUNK_SIZE, overlap = CHUNK_OVERLAP): string[] {
  const chunks: string[] = [];
  let start = 0;

  while (start < text.length) {
    let end = start + chunkSize;
    
    // Try to break at sentence boundary
    if (end < text.length) {
      const lastSentence = text.lastIndexOf('.', end);
      const lastNewline = text.lastIndexOf('\n', end);
      const breakPoint = Math.max(lastSentence, lastNewline);
      if (breakPoint > start + chunkSize * 0.5) {
        end = breakPoint + 1;
      }
    }

    const chunk = text.slice(start, end).trim();
    if (chunk.length > 20) { // skip tiny chunks
      chunks.push(chunk);
    }
    start = end - overlap;
  }

  return chunks;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Embeddings — generate vector for text using Workers AI
// ═══════════════════════════════════════════════════════════════════════════════
export async function generateEmbedding(
  ai: any,
  text: string
): Promise<number[]> {
  const result = await ai.run('@cf/baai/bge-base-en-v1.5', {
    text: [text],
  });
  return result.data[0];
}

// ═══════════════════════════════════════════════════════════════════════════════
// Document Processing Pipeline
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Process a text document: chunk → embed → store in Vectorize + D1
 */
export async function processDocument(
  env: KnowledgeEnv,
  kbId: string,
  content: string,
  tenantId: string = 'default'
): Promise<{ chunkCount: number; errors: string[] }> {
  const errors: string[] = [];
  let chunkCount = 0;

  const chunks = chunkText(content);

  for (let i = 0; i < chunks.length; i++) {
    const chunkContent = chunks[i];
    const chunkId = `${kbId}_chunk_${i}`;

    try {
      // 1. Generate embedding
      const vector = await generateEmbedding(env.AI, chunkContent);

      // 2. Store in Vectorize with tenant metadata
      await env.VECTORIZE.upsert([{
        id: chunkId,
        values: vector,
        namespace: kbId,
        metadata: {
          kb_id: kbId,
          chunk_index: i,
          content_preview: chunkContent.slice(0, 200),
          tenantId,
        },
      }]);

      // 3. Store chunk in D1
      await env.DB.prepare(
        `INSERT OR REPLACE INTO knowledge_chunks (id, kb_id, chunk_index, content, token_count, vector_id)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).bind(chunkId, kbId, i, chunkContent, Math.ceil(chunkContent.length / 4), chunkId).run();

      chunkCount++;
    } catch (e: any) {
      errors.push(`Chunk ${i}: ${e.message}`);
    }
  }

  // Update chunk count in knowledge_base
  await env.DB.prepare(
    `UPDATE knowledge_base SET chunk_count=?, last_indexed_at=datetime('now'), updated_at=datetime('now') WHERE id=?`
  ).bind(chunkCount, kbId).run();

  return { chunkCount, errors };
}

/**
 * Process a URL: fetch → extract text → process
 */
export async function processUrl(
  env: KnowledgeEnv,
  kbId: string,
  url: string,
  tenantId: string = 'default'
): Promise<{ chunkCount: number; errors: string[] }> {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    
    const contentType = res.headers.get('content-type') || '';
    let text: string;

    if (contentType.includes('text/html')) {
      const html = await res.text();
      // Simple HTML to text extraction
      text = html
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    } else {
      text = await res.text();
    }

    // Store raw content in R2
    const r2Key = `knowledge/${kbId}/source.txt`;
    if (!env.STORAGE) throw new Error("STORAGE not configured");
    await env.STORAGE.put(r2Key, text, {
      httpMetadata: { contentType: 'text/plain' },
    });

    // Update D1
    await env.DB.prepare(
      `UPDATE knowledge_base SET r2_key=?, mime_type='text/plain', file_size=?, 
       content_preview=?, source_url=?, updated_at=datetime('now') WHERE id=?`
    ).bind(r2Key, text.length, text.slice(0, 500), url, kbId).run();

    return await processDocument(env, kbId, text, tenantId);
  } catch (e: any) {
    return { chunkCount: 0, errors: [e.message] };
  }
}

/**
 * Process uploaded file: read from R2 → extract text → process
 */
export async function processUploadedFile(
  env: KnowledgeEnv,
  kbId: string,
  r2Key: string,
  tenantId: string = 'default'
): Promise<{ chunkCount: number; errors: string[] }> {
  try {
    if (!env.STORAGE) throw new Error('STORAGE not configured');
    const obj = await env.STORAGE.get(r2Key);
    if (!obj) throw new Error('File not found in R2');

    const text = await obj.text();
    
    // Update D1 with preview and size
    await env.DB.prepare(
      `UPDATE knowledge_base SET content_preview=?, file_size=?, updated_at=datetime('now') WHERE id=?`
    ).bind(text.slice(0, 500), text.length, kbId).run();

    return await processDocument(env, kbId, text, tenantId);
  } catch (e: any) {
    return { chunkCount: 0, errors: [e.message] };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Semantic Search — find relevant chunks
// ═══════════════════════════════════════════════════════════════════════════════
export interface SearchResult {
  chunk_id: string;
  kb_id: string;
  content: string;
  score: number;
  title?: string;
  category?: string;
}

export async function semanticSearch(
  env: KnowledgeEnv,
  query: string,
  agentId?: string,
  topK = 5,
  tenantId: string = 'default'
): Promise<SearchResult[]> {
  // 1. Generate query embedding
  const queryVector = await generateEmbedding(env.AI, query);

  // 2. Query Vectorize with tenant filter
  const filter: any = { tenantId: { $eq: tenantId } };
  if (agentId) {
    filter.agentId = { $eq: agentId };
  }
  
  const options: any = {
    topK: topK * 3,
    returnMetadata: true,
    filter,
  };

  // 3. Query Vectorize
  const results = await env.VECTORIZE.query(queryVector, options);

  // 4. Enrich with D1 data + filter by agent
  const enriched: SearchResult[] = [];
  for (const match of results.matches || []) {
    const meta = match.metadata as any;

    // Tenant isolation (belt + suspenders — also checked via Vectorize filter)
    if (meta?.tenantId && meta.tenantId !== tenantId) continue;

    // Get document title from D1 if available
    let docTitle: string | undefined = meta?.title;
    let docCategory: string | undefined = meta?.category;
    if (meta?.kb_id) {
      try {
        const doc = await env.DB.prepare(
          `SELECT title, category FROM knowledge_base WHERE id = ?`
        ).bind(meta.kb_id).first<{ title: string; category: string }>();
        if (doc) { docTitle = doc.title; docCategory = doc.category; }
      } catch (e) {}
    }

    enriched.push({
      chunk_id: match.id,
      kb_id: meta?.kb_id || '',
      content: meta?.content_preview || meta?.content || '',
      score: match.score || 0,
      title: docTitle,
      category: docCategory,
    });

    if (enriched.length >= topK) break;
  }

  return enriched;
}

// ═══════════════════════════════════════════════════════════════════════════════
// RAG Context Builder — assemble context for LLM
// ═══════════════════════════════════════════════════════════════════════════════
export async function buildRagContext(
  env: KnowledgeEnv,
  query: string,
  agentId: string,
  maxChunks = 5,
  tenantId: string = 'default'
): Promise<string> {
  const results = await semanticSearch(env, query, agentId, maxChunks, tenantId);
  
  if (results.length === 0) return '';

  const contextParts = results.map((r, i) => 
    `[Fuente ${i + 1}: ${r.title || 'Document'} | Score: ${(r.score * 100).toFixed(0)}%]\n${r.content}`
  );

  return contextParts.join('\n\n---\n\n');
}

// ═══════════════════════════════════════════════════════════════════════════════
// Cleanup — delete chunks + vectors when doc is removed
// ═══════════════════════════════════════════════════════════════════════════════
export async function deleteDocument(
  env: KnowledgeEnv,
  kbId: string
): Promise<void> {
  // Get all chunk IDs
  const chunks = await env.DB.prepare(
    `SELECT id FROM knowledge_chunks WHERE kb_id = ?`
  ).bind(kbId).all<{ id: string }>();

  const chunkIds = chunks.results?.map(c => c.id) || [];

  // Delete from Vectorize
  if (chunkIds.length > 0) {
    await env.VECTORIZE.deleteByIds(chunkIds);
  }

  // Delete chunks from D1
  await env.DB.prepare(`DELETE FROM knowledge_chunks WHERE kb_id = ?`).bind(kbId).run();

  // Delete from R2 if exists
  const doc = await env.DB.prepare(
    `SELECT r2_key FROM knowledge_base WHERE id = ?`
  ).bind(kbId).first<{ r2_key: string }>();
  if (doc?.r2_key) {
    if (!env.STORAGE) throw new Error("STORAGE not configured");
      await env.STORAGE.delete(doc.r2_key);
  }

  // Delete from knowledge_base
  await env.DB.prepare(`DELETE FROM knowledge_base WHERE id = ?`).bind(kbId).run();
  await env.DB.prepare(`DELETE FROM agent_knowledge WHERE kb_id = ?`).bind(kbId).run();
}
