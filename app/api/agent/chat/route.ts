import {
  convertToModelMessages,
  createUIMessageStreamResponse,
  isStepCount,
  streamText,
  toUIMessageStream,
  type UIMessage,
} from "ai";
import { NextResponse } from "next/server";
import { z } from "zod";
import { buildAgentTools, systemPrompt } from "@/lib/agent-tools";
import { getBudget } from "@/lib/budget";
import { getApiUser } from "@/lib/auth";
import { getProduct } from "@/lib/channel3";
import { getDb } from "@/lib/db";
import { getModel, hasLlm } from "@/lib/llm";

// Keep each invocation short for Vercel Hobby.
export const maxDuration = 30;

const bodySchema = z.object({
  likedItemId: z.string().min(1),
  messages: z.array(z.unknown()).min(1).max(60),
});

export async function POST(req: Request) {
  const user = await getApiUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (!hasLlm()) {
    return NextResponse.json(
      { error: "The agent isn't configured: set GROQ_API_KEY or GEMINI_API_KEY." },
      { status: 503 },
    );
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Bad request" }, { status: 400 });

  const likedItem = await getDb().likedItem.findFirst({
    where: { id: parsed.data.likedItemId, userId: user.id },
    select: {
      id: true,
      channel3ProductId: true,
      title: true,
      watches: {
        where: { status: { in: ["ACTIVE", "AWAITING_APPROVAL", "PAUSED"] } },
        include: { mandate: true },
        take: 1,
      },
    },
  });
  if (!likedItem) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const watch = likedItem.watches[0];
  const [product, budget] = await Promise.all([
    getProduct(likedItem.channel3ProductId).catch(() => null),
    getBudget(user.id, undefined, watch?.id).catch(() => null),
  ]);
  const ctx = {
    likedItem,
    product,
    budgetFree: budget?.available,
    currentMandate: watch?.mandate
      ? {
          maxPrice: watch.mandate.maxPrice.toNumber(),
          variant: watch.variant,
          mode: watch.mandate.mode,
          expiresAt: watch.mandate.expiresAt,
          status: watch.status,
        }
      : undefined,
  };

  const result = streamText({
    model: getModel(),
    system: systemPrompt(ctx),
    messages: await convertToModelMessages(parsed.data.messages as UIMessage[]),
    tools: buildAgentTools(ctx),
    stopWhen: isStepCount(5),
    temperature: 0.2,
  });

  return createUIMessageStreamResponse({
    stream: toUIMessageStream({
      stream: result.stream,
      onError: (err) => {
        console.error("[agent] stream error", err);
        return "The agent hit an error. Try again in a moment.";
      },
    }),
  });
}
