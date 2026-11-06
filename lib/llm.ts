import "server-only";
import { createGroq } from "@ai-sdk/groq";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import type {
  LanguageModelV4,
  LanguageModelV4CallOptions,
} from "@ai-sdk/provider";
import { APICallError } from "ai";
import { optionalEnv } from "./env";

/**
 * The ONLY entry point for LLM calls (non-negotiable rule 6).
 *
 * `getModel()` returns one AI SDK LanguageModel that tries Groq first and
 * transparently falls back to Gemini Flash on a rate limit (HTTP 429) or any
 * other error. Use it with `generateText` / `streamText` like any model:
 *
 *   const result = streamText({ model: getModel(), tools, messages });
 *
 * The fallback happens at request start (before any tokens stream), which is
 * where provider 429s and 5xx errors surface.
 *
 * The LLM never moves money: tools handed to it (lib/agent-tools.ts) can
 * search and draft/edit mandates only.
 */

export const GROQ_MODEL = optionalEnv("GROQ_MODEL") ?? "openai/gpt-oss-120b";
export const GEMINI_MODEL = optionalEnv("GEMINI_MODEL") ?? "gemini-2.5-flash";

export type ProviderName = "groq" | "gemini";

type Candidate = { name: ProviderName; model: LanguageModelV4 };

export type FallbackEvent = {
  from: ProviderName;
  to: ProviderName | null;
  reason: string;
  rateLimited: boolean;
};

function describe(err: unknown): { reason: string; rateLimited: boolean } {
  if (APICallError.isInstance(err)) {
    return {
      reason: `HTTP ${err.statusCode ?? "?"}: ${err.message}`,
      rateLimited: err.statusCode === 429,
    };
  }
  return { reason: err instanceof Error ? err.message : String(err), rateLimited: false };
}

/**
 * A LanguageModelV4 that delegates to the first candidate that succeeds.
 * Aborts (user cancelled) are re-thrown immediately rather than falling back.
 */
class FallbackModel implements LanguageModelV4 {
  readonly specificationVersion = "v4" as const;
  readonly provider = "dropcart-fallback";
  readonly modelId: string;
  /** Which provider served the most recent call — for logs/UI. */
  lastProvider: ProviderName | null = null;

  constructor(
    private readonly candidates: Candidate[],
    private readonly onFallback?: (e: FallbackEvent) => void,
  ) {
    if (candidates.length === 0) {
      throw new Error("No LLM configured: set GROQ_API_KEY and/or GEMINI_API_KEY.");
    }
    this.modelId = candidates.map((c) => `${c.name}:${c.model.modelId}`).join(" -> ");
  }

  // Only URL-passthrough media matters to the SDK; text/tool chat needs none.
  readonly supportedUrls: Record<string, RegExp[]> = {};

  private async run<T>(
    options: LanguageModelV4CallOptions,
    invoke: (m: LanguageModelV4) => PromiseLike<T>,
  ): Promise<T> {
    let lastError: unknown;
    for (let i = 0; i < this.candidates.length; i++) {
      const { name, model } = this.candidates[i];
      try {
        const result = await invoke(model);
        this.lastProvider = name;
        return result;
      } catch (err) {
        if (options.abortSignal?.aborted) throw err;
        lastError = err;
        const next = this.candidates[i + 1]?.name ?? null;
        const info = describe(err);
        console.warn(
          `[llm] ${name} failed (${info.reason})${next ? ` — falling back to ${next}` : ""}`,
        );
        this.onFallback?.({ from: name, to: next, ...info });
      }
    }
    throw lastError;
  }

  doGenerate(options: LanguageModelV4CallOptions) {
    return this.run(options, (m) => m.doGenerate(options));
  }

  doStream(options: LanguageModelV4CallOptions) {
    return this.run(options, (m) => m.doStream(options));
  }
}

function candidates(): Candidate[] {
  const list: Candidate[] = [];
  const groqKey = optionalEnv("GROQ_API_KEY");
  if (groqKey) {
    list.push({ name: "groq", model: createGroq({ apiKey: groqKey })(GROQ_MODEL) });
  }
  const geminiKey = optionalEnv("GEMINI_API_KEY");
  if (geminiKey) {
    list.push({
      name: "gemini",
      model: createGoogleGenerativeAI({ apiKey: geminiKey })(GEMINI_MODEL),
    });
  }
  return list;
}

/**
 * Groq → Gemini fallback model. Create one per request so `lastProvider`
 * reflects that request only.
 */
export function getModel(opts?: { onFallback?: (e: FallbackEvent) => void }): FallbackModel {
  return new FallbackModel(candidates(), opts?.onFallback);
}

/** Test hook: build a fallback model from arbitrary candidates. */
export function createFallbackModel(
  list: Candidate[],
  onFallback?: (e: FallbackEvent) => void,
): FallbackModel {
  return new FallbackModel(list, onFallback);
}

export const hasLlm = (): boolean =>
  Boolean(optionalEnv("GROQ_API_KEY") || optionalEnv("GEMINI_API_KEY"));
