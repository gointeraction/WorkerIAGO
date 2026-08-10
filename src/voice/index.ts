/**
 * Voice Agent — TTS + STT with Workers AI
 * 
 * Speech-to-Text: @cf/openai/whisper-tiny-en (or large-v3 for better quality)
 * Text-to-Speech: @cf/mylesmueller/pi-tts (or ElevenLabs API)
 * 
 * Handles voice messages from WhatsApp/Telegram and responds with audio.
 */

import { runModel } from '../ai';

export interface VoiceEnv {
  AI: Ai;
  DB: D1Database;
}

export interface VoiceMessage {
  audioUrl: string;
  mimeType: string;
  duration?: number;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Speech-to-Text (STT)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Transcribe audio to text using Whisper
 */
export async function transcribeAudio(
  ai: any,
  audioBuffer: ArrayBuffer,
  language = 'es'
): Promise<{ text: string; language: string; duration: number }> {
  // Convert ArrayBuffer to array of numbers for Workers AI
  const audioArray = [...new Uint8Array(audioBuffer)];

  const result = await ai.run('@cf/openai/whisper-tiny-en', {
    audio: audioArray,
    language,
  });

  return {
    text: result.text || '',
    language: result.language || language,
    duration: result.duration || 0,
  };
}

/**
 * Transcribe audio from URL
 */
export async function transcribeFromUrl(
  ai: any,
  url: string,
  language = 'es'
): Promise<{ text: string; language: string; duration: number }> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch audio: ${res.status}`);
  
  const buffer = await res.arrayBuffer();
  return transcribeAudio(ai, buffer, language);
}

// ═══════════════════════════════════════════════════════════════════════════════
// Text-to-Speech (TTS)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Generate speech from text using Workers AI
 * Returns audio buffer in WAV format
 */
export async function generateSpeech(
  ai: any,
  text: string,
  voice = 'default'
): Promise<ArrayBuffer> {
  // Using Piper TTS via Workers AI
  const result = await ai.run('@cf/mylesmueller/pi-tts', {
    text,
    voice,
  });

  // Workers AI returns base64 audio
  if (result.audio) {
    const binaryStr = atob(result.audio);
    const bytes = new Uint8Array(binaryStr.length);
    for (let i = 0; i < binaryStr.length; i++) {
      bytes[i] = binaryStr.charCodeAt(i);
    }
    return bytes.buffer;
  }

  throw new Error('No audio generated');
}

/**
 * Generate speech and return as base64
 */
export async function generateSpeechBase64(
  ai: any,
  text: string,
  voice = 'default'
): Promise<string> {
  const result = await ai.run('@cf/mylesmueller/pi-tts', {
    text,
    voice,
  });
  return result.audio || '';
}

// ═══════════════════════════════════════════════════════════════════════════════
// Voice Message Processing Pipeline
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Full voice pipeline: receive audio → transcribe → process → generate response → TTS
 */
export async function processVoiceMessage(
  env: VoiceEnv,
  audioBuffer: ArrayBuffer,
  agentSystemPrompt: string,
  conversationHistory: Array<{ role: string; content: string }> = []
): Promise<{
  transcription: string;
  responseText: string;
  responseAudio: ArrayBuffer;
  language: string;
}> {
  // 1. Transcribe
  const { text: transcription, language } = await transcribeAudio(env.AI, audioBuffer);

  // 2. Generate text response
  const messages = [
    { role: 'system', content: agentSystemPrompt },
    ...conversationHistory.slice(-10),
    { role: 'user', content: transcription },
  ];

  const aiResult: any = await runModel(env.AI, '@cf/meta/llama-3.1-8b-instruct-fp8', {
    messages,
    temperature: 0.7,
    max_tokens: 512,
  });

  const responseText = aiResult.response as string;

  // 3. Generate audio response
  const responseAudio = await generateSpeech(env.AI, responseText);

  return {
    transcription,
    responseText,
    responseAudio,
    language,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// Voice Channel Adapters
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Process WhatsApp voice message
 */
export async function processWhatsAppVoice(
  env: VoiceEnv,
  audioUrl: string,
  agentSystemPrompt: string
): Promise<{ text: string; audioBase64: string }> {
  const { text: transcription } = await transcribeFromUrl(env.AI, audioUrl, 'es');

  const messages = [
    { role: 'system', content: agentSystemPrompt },
    { role: 'user', content: transcription },
  ];

  const aiResult: any = await runModel(env.AI, '@cf/meta/llama-3.1-8b-instruct-fp8', {
    messages,
    temperature: 0.7,
    max_tokens: 512,
  });

  const audioBase64 = await generateSpeechBase64(env.AI, aiResult.response as string);

  return {
    text: aiResult.response as string,
    audioBase64,
  };
}

/**
 * Process Telegram voice message
 */
export async function processTelegramVoice(
  env: VoiceEnv,
  audioBuffer: ArrayBuffer,
  agentSystemPrompt: string
): Promise<{ text: string; audioBuffer: ArrayBuffer }> {
  const { text: transcription } = await transcribeAudio(env.AI, audioBuffer);

  const messages = [
    { role: 'system', content: agentSystemPrompt },
    { role: 'user', content: transcription },
  ];

  const aiResult: any = await runModel(env.AI, '@cf/meta/llama-3.1-8b-instruct-fp8', {
    messages,
    temperature: 0.7,
    max_tokens: 512,
  });

  const audio = await generateSpeech(env.AI, aiResult.response as string);

  return {
    text: aiResult.response as string,
    audioBuffer: audio,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// Voice Notes — Audio transcription for meeting notes, calls, etc.
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Transcribe long audio (chunked for large files)
 */
export async function transcribeLongAudio(
  ai: any,
  audioBuffer: ArrayBuffer,
  language = 'es'
): Promise<string> {
  // Whisper handles up to ~25MB audio
  // For longer audio, we'd chunk — for now, transcribe directly
  const result = await transcribeAudio(ai, audioBuffer, language);
  return result.text;
}

/**
 * Summarize transcribed audio
 */
export async function summarizeTranscription(
  ai: any,
  transcription: string,
  language = 'es'
): Promise<string> {
  const result = await ai.run('@cf/meta/llama-3.1-8b-instruct-fp8', {
    messages: [
      {
        role: 'system',
        content: `Resume this transcription in ${language}. Be concise but capture key points.`,
      },
      { role: 'user', content: transcription },
    ],
    temperature: 0.3,
    max_tokens: 1024,
  });

  return result.response;
}
