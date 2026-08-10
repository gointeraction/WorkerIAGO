import { describe, it, expect, vi } from "vitest";
import { aiWithFallback } from "../src/gateway";

describe("AI Gateway", () => {
  it("should return primary model result", async () => {
    const mockAi = {
      run: vi.fn().mockResolvedValue({ response: "primary success" })
    };
    const result = await aiWithFallback(mockAi, "model-1", { prompt: "hi" });
    expect(result.model).toBe("model-1");
    expect(result.result.response).toBe("primary success");
    expect(mockAi.run).toHaveBeenCalledTimes(1);
  });

  it("should fall back to other models if primary fails", async () => {
    const mockAi = {
      run: vi.fn()
        .mockRejectedValueOnce(new Error("primary failed"))
        .mockResolvedValueOnce({ response: "fallback success" })
    };
    const result = await aiWithFallback(mockAi, "model-1", { prompt: "hi" });
    expect(result.model).toBe("@cf/meta/llama-3.1-8b-instruct-fp8");
    expect(result.result.response).toBe("fallback success");
    expect(mockAi.run).toHaveBeenCalledTimes(2);
  });

  it("should throw if all models fail", async () => {
    const mockAi = {
      run: vi.fn().mockRejectedValue(new Error("fail"))
    };
    await expect(aiWithFallback(mockAi, "model-1", { prompt: "hi" }))
      .rejects.toThrow("All AI models failed");
  });
});