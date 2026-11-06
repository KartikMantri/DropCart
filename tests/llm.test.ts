import { describe, expect, it } from "vitest";
import { APICallError, generateText } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import type { LanguageModelV4GenerateResult } from "@ai-sdk/provider";
import { createFallbackModel, type FallbackEvent } from "@/lib/llm";

const ok = (text: string): LanguageModelV4GenerateResult => ({
  content: [{ type: "text", text }],
  finishReason: { unified: "stop", raw: "stop" },
  usage: {
    inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
    outputTokens: { total: 1, text: 1, reasoning: 0 },
  },
  warnings: [],
});

const httpError = (statusCode: number) =>
  new APICallError({
    message: statusCode === 429 ? "Rate limit reached" : "Server error",
    url: "https://example.test",
    requestBodyValues: {},
    statusCode,
    isRetryable: false,
  });

describe("lib/llm fallback model", () => {
  it("uses Groq when it succeeds", async () => {
    const groq = new MockLanguageModelV4({ modelId: "groq-m", doGenerate: ok("from groq") });
    const gemini = new MockLanguageModelV4({ modelId: "gemini-m", doGenerate: ok("from gemini") });
    const model = createFallbackModel([
      { name: "groq", model: groq },
      { name: "gemini", model: gemini },
    ]);

    const { text } = await generateText({ model, prompt: "hi", maxRetries: 0 });
    expect(text).toBe("from groq");
    expect(model.lastProvider).toBe("groq");
    expect(gemini.doGenerateCalls).toHaveLength(0);
  });

  it("falls back to Gemini on HTTP 429 and reports it as a rate limit", async () => {
    const events: FallbackEvent[] = [];
    const groq = new MockLanguageModelV4({
      doGenerate: async () => {
        throw httpError(429);
      },
    });
    const gemini = new MockLanguageModelV4({ doGenerate: ok("from gemini") });
    const model = createFallbackModel(
      [
        { name: "groq", model: groq },
        { name: "gemini", model: gemini },
      ],
      (e) => events.push(e),
    );

    const { text } = await generateText({ model, prompt: "hi", maxRetries: 0 });
    expect(text).toBe("from gemini");
    expect(model.lastProvider).toBe("gemini");
    expect(events).toEqual([
      expect.objectContaining({ from: "groq", to: "gemini", rateLimited: true }),
    ]);
  });

  it("falls back on non-429 errors too", async () => {
    const groq = new MockLanguageModelV4({
      doGenerate: async () => {
        throw httpError(503);
      },
    });
    const gemini = new MockLanguageModelV4({ doGenerate: ok("from gemini") });
    const model = createFallbackModel([
      { name: "groq", model: groq },
      { name: "gemini", model: gemini },
    ]);
    const { text } = await generateText({ model, prompt: "hi", maxRetries: 0 });
    expect(text).toBe("from gemini");
  });

  it("throws the last error when every provider fails", async () => {
    const fail = (code: number) =>
      new MockLanguageModelV4({
        doGenerate: async () => {
          throw httpError(code);
        },
      });
    const model = createFallbackModel([
      { name: "groq", model: fail(429) },
      { name: "gemini", model: fail(500) },
    ]);
    await expect(generateText({ model, prompt: "hi", maxRetries: 0 })).rejects.toThrow();
  });

  it("refuses to build with no providers configured", () => {
    expect(() => createFallbackModel([])).toThrow(/No LLM configured/);
  });
});
