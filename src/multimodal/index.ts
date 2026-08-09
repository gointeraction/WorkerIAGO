/**
 * Multi-modal — Image processing, OCR, visual understanding
 * 
 * Workers AI models for multi-modal:
 *   - @cf/unum/gemma-2-9b-it — multimodal understanding
 *   - @cf/microsoft/resnet-50 — image classification
 *   - @cf/baai/bge-m3 — text embeddings (for image+text RAG)
 */

export interface MultiModalEnv {
  AI: any;
  DB: D1Database;
  STORAGE?: R2Bucket;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Image Understanding — analyze images with AI
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Describe an image using multimodal AI
 */
export async function describeImage(
  ai: any,
  imageBuffer: ArrayBuffer,
  prompt = 'Describe this image in detail'
): Promise<string> {
  const imageArray = [...new Uint8Array(imageBuffer)];

  const result = await ai.run('@cf/unum/gemma-2-9b-it', {
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image', image: imageArray },
          { type: 'text', text: prompt },
        ],
      },
    ],
    max_tokens: 1024,
  });

  return result.response || '';
}

/**
 * Analyze product image (for e-commerce)
 */
export async function analyzeProduct(
  ai: any,
  imageBuffer: ArrayBuffer
): Promise<{
  name: string;
  description: string;
  category: string;
  colors: string[];
  features: string[];
}> {
  const response = await describeImage(
    ai,
    imageBuffer,
    `Analyze this product image. Respond in JSON format:
{
  "name": "product name",
  "description": "brief description",
  "category": "category (electronics, clothing, food, etc)",
  "colors": ["dominant colors"],
  "features": ["visible features"]
}`
  );

  try {
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (jsonMatch) return JSON.parse(jsonMatch[0]);
  } catch {}

  return {
    name: 'Producto',
    description: response.slice(0, 200),
    category: 'general',
    colors: [],
    features: [],
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// OCR — Extract text from images
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Extract text from image (OCR)
 */
export async function extractTextFromImage(
  ai: any,
  imageBuffer: ArrayBuffer
): Promise<string> {
  return describeImage(
    ai,
    imageBuffer,
    'Extract all visible text from this image. Return only the text, no descriptions.'
  );
}

/**
 * Extract structured data from document image (invoice, receipt, ID)
 */
export async function extractDocumentData(
  ai: any,
  imageBuffer: ArrayBuffer,
  documentType: 'invoice' | 'receipt' | 'id' | 'general' = 'general'
): Promise<Record<string, any>> {
  const prompts: Record<string, string> = {
    invoice: `Extract from this invoice: invoice number, date, vendor, items (name, quantity, price), total, tax. JSON format.`,
    receipt: `Extract from this receipt: store name, date, items, total, payment method. JSON format.`,
    id: `Extract from this ID: full name, document number, date of birth, expiry date. JSON format.`,
    general: `Extract all visible fields and values from this document. JSON format.`,
  };

  const response = await describeImage(ai, imageBuffer, prompts[documentType]);

  try {
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (jsonMatch) return JSON.parse(jsonMatch[0]);
  } catch {}

  return { raw_text: response };
}

// ═══════════════════════════════════════════════════════════════════════════════
// Image Classification
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Classify image into categories
 */
export async function classifyImage(
  ai: any,
  imageBuffer: ArrayBuffer,
  categories: string[]
): Promise<{ label: string; score: number }> {
  const imageArray = [...new Uint8Array(imageBuffer)];

  const result = await ai.run('@cf/microsoft/resnet-50', {
    image: imageArray,
  });

  return {
    label: result.label || 'unknown',
    score: result.score || 0,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// Visual Search — find similar products/images
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Generate visual embedding for image search
 */
export async function generateImageEmbedding(
  ai: any,
  imageBuffer: ArrayBuffer
): Promise<number[]> {
  // Use multimodal model to generate description, then embed
  const description = await describeImage(ai, imageBuffer, 'Describe this image for search purposes');
  
  const result = await ai.run('@cf/baai/bge-m3', {
    text: [description],
  });

  return result.data[0];
}

// ═══════════════════════════════════════════════════════════════════════════════
// Image Processing Pipeline
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Process incoming image from chat (WhatsApp/Telegram)
 */
export async function processChatImage(
  env: MultiModalEnv,
  imageBuffer: ArrayBuffer,
  context: string
): Promise<{
  description: string;
  extractedText?: string;
  category?: string;
}> {
  // 1. Describe image
  const description = await describeImage(
    env.AI,
    imageBuffer,
    `A user sent this image in a chat. Context: "${context}". Describe what you see.`
  );

  // 2. Try OCR if it looks like a document
  let extractedText: string | undefined;
  if (description.toLowerCase().includes('document') ||
      description.toLowerCase().includes('text') ||
      description.toLowerCase().includes('receipt') ||
      description.toLowerCase().includes('invoice')) {
    extractedText = await extractTextFromImage(env.AI, imageBuffer);
  }

  // 3. Classify
  const classification = await classifyImage(env.AI, imageBuffer, []);

  return {
    description,
    extractedText,
    category: classification.label,
  };
}

/**
 * Process product image for e-commerce
 */
export async function processProductImage(
  env: MultiModalEnv,
  imageBuffer: ArrayBuffer,
  storeInR2 = false
): Promise<{
  product: any;
  r2Key?: string;
}> {
  // 1. Analyze product
  const product = await analyzeProduct(env.AI, imageBuffer);

  // 2. Store in R2 if requested
  let r2Key: string | undefined;
  if (storeInR2 && env.STORAGE) {
    r2Key = `products/${crypto.randomUUID()}.jpg`;
    await env.STORAGE.put(r2Key, imageBuffer, {
      httpMetadata: { contentType: 'image/jpeg' },
    });
  }

  return { product, r2Key };
}
