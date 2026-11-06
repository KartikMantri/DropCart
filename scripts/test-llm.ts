/**
 * Live smoke test for lib/llm.ts.   npm run test:llm
 * Calls Groq (or Gemini if Groq fails), then forces the Gemini path by
 * disabling Groq, so both providers are exercised.
 */
import { config } from "dotenv";
config({ path: ".env.local" });
config();

async function main() {
  const { generateText } = await import("ai");
  const { getModel, GROQ_MODEL, GEMINI_MODEL } = await import("../lib/llm");

  const prompt = "Reply with exactly: DropCart online";

  const model = getModel();
  const a = await generateText({ model, prompt, maxRetries: 0 });
  console.log(`✔ primary path → ${model.lastProvider}: "${a.text.trim()}"  [${GROQ_MODEL}]`);

  if (process.env.GEMINI_API_KEY) {
    const groqKey = process.env.GROQ_API_KEY;
    delete process.env.GROQ_API_KEY;
    const geminiOnly = getModel();
    const b = await generateText({ model: geminiOnly, prompt, maxRetries: 0 });
    console.log(`✔ fallback path → ${geminiOnly.lastProvider}: "${b.text.trim()}"  [${GEMINI_MODEL}]`);
    if (groqKey) process.env.GROQ_API_KEY = groqKey;
  } else {
    console.log("… GEMINI_API_KEY not set — fallback path not exercised live");
  }
}

main().catch((err) => {
  console.error("✖", err);
  process.exit(1);
});
