import { describe, it, expect, vi, beforeEach } from "vitest";

const runModelMock = vi.fn();

vi.mock("../src/ai", () => ({
  runModel: (ai: any, model: string, inputs: any) => runModelMock(ai, model, inputs),
}));

import {
  transcribeAudio,
  transcribeFromUrl,
  generateSpeech,
  generateSpeechBase64,
  processVoiceMessage,
  summarizeTranscription,
  transcribeLongAudio,
} from "../src/voice";

function makeAi(over: Record<string, any> = {}) {
  return {
    run: vi.fn((model: string, inputs: any) => {
      if (model.includes("whisper")) {
        return Promise.resolve({ text: "Hola mundo", language: "es", duration: 3 });
      }
      if (model.includes("pi-tts")) {
        return Promise.resolve({ audio: "AQID" }); // base64 of [0,1,2]
      }
      if (model.includes("llama")) {
        return Promise.resolve({ response: "respuesta generada" });
      }
      return Promise.resolve({});
    }),
    ...over,
  } as any;
}

describe("voice module", () => {
  beforeEach(() => {
    runModelMock.mockReset();
    runModelMock.mockResolvedValue({ response: "respuesta del modelo" });
  });

  it("should transcribe audio to text", async () => {
    const ai = makeAi();
    const result = await transcribeAudio(ai, new Uint8Array([1, 2, 3]).buffer, "es");
    expect(result.text).toBe("Hola mundo");
    expect(result.language).toBe("es");
    expect(result.duration).toBe(3);
    expect(ai.run).toHaveBeenCalledWith("@cf/openai/whisper-tiny-en", expect.objectContaining({ language: "es" }));
  });

  it("should fall back to default values when result is sparse", async () => {
    const ai = makeAi({
      run: async () => ({}),
    });
    const result = await transcribeAudio(ai, new Uint8Array([1]).buffer);
    expect(result).toEqual({ text: "", language: "es", duration: 0 });
  });

  it("should transcribe from URL", async () => {
    const ai = makeAi();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => new Uint8Array([1, 2]).buffer,
    });
    vi.stubGlobal("fetch", fetchMock);
    const result = await transcribeFromUrl(ai, "https://example.com/a.mp3", "es");
    expect(result.text).toBe("Hola mundo");
    expect(fetchMock).toHaveBeenCalledWith("https://example.com/a.mp3");
    vi.unstubAllGlobals();
  });

  it("should throw when URL fetch fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 404 }));
    await expect(transcribeFromUrl(makeAi(), "https://x.com/a.mp3")).rejects.toThrow("Failed to fetch audio: 404");
    vi.unstubAllGlobals();
  });

  it("should generate speech and decode base64 to ArrayBuffer", async () => {
    const ai = makeAi();
    const buffer = await generateSpeech(ai, "Hola");
    const bytes = new Uint8Array(buffer);
    expect(Array.from(bytes)).toEqual([1, 2, 3]);
  });

  it("should throw when no audio generated", async () => {
    const ai = makeAi({ run: async () => ({}) });
    await expect(generateSpeech(ai, "Hola")).rejects.toThrow("No audio generated");
  });

  it("should return base64 audio directly", async () => {
    const ai = makeAi();
    expect(await generateSpeechBase64(ai, "Hola")).toBe("AQID");
  });

  it("should summarize a transcription", async () => {
    const ai = makeAi();
    const summary = await summarizeTranscription(ai, "Mucho texto...", "es");
    expect(summary).toBe("respuesta generada");
    expect(ai.run.mock.calls[0][1].messages[0].content).toContain("es");
  });

  it("should transcribe long audio via transcribeAudio", async () => {
    const ai = makeAi();
    const text = await transcribeLongAudio(ai, new Uint8Array([1]).buffer, "es");
    expect(text).toBe("Hola mundo");
  });

  it("should run full voice pipeline: transcribe -> model -> TTS", async () => {
    const ai = makeAi();
    const env: any = { AI: ai, DB: {} };
    const result = await processVoiceMessage(env, new Uint8Array([1]).buffer, "Eres un agente");

    expect(result.transcription).toBe("Hola mundo");
    expect(result.language).toBe("es");
    expect(result.responseText).toBe("respuesta del modelo");
    expect(runModelMock).toHaveBeenCalledTimes(1);
    const bytes = new Uint8Array(result.responseAudio);
    expect(Array.from(bytes)).toEqual([1, 2, 3]);
  });
});