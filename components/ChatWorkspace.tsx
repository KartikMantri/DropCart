"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type InferUITools, type UIDataTypes, type UIMessage } from "ai";
import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import type { AgentTools, DraftMandateOutput } from "@/lib/agent-tools";
import type { VariantDimension } from "@/lib/channel3";
import { emptyDraft, formatUsd, type MandateDraft, type MandateField } from "@/lib/mandate";
import { ChatPanel } from "./ChatPanel";
import { ConnectPaypal } from "./ConnectPaypal";
import { MandateForm } from "./MandateForm";

export type AgentUIMessage = UIMessage<unknown, UIDataTypes, InferUITools<AgentTools>>;

type Created = { watchId: string; priceNow: number; wouldBuyNow: boolean; paymentReady: boolean; edited?: boolean };

/** An existing watch being edited: the form starts from its mandate. */
export type EditingWatch = { watchId: string; draft: MandateDraft };

/** Agent chat + mandate form side by side. */
export function ChatWorkspace({
  likedItemId,
  variants,
  initialVariant,
  priceNow,
  available,
  llmReady,
  editing,
}: {
  likedItemId: string;
  variants: VariantDimension[];
  initialVariant: Record<string, string>;
  priceNow: number | null;
  available: number | null;
  llmReady: boolean;
  editing?: EditingWatch;
}) {
  const [draft, setDraft] = useState<MandateDraft>(() =>
    editing ? editing.draft : { ...emptyDraft(), variant: initialVariant },
  );
  const [agentFields, setAgentFields] = useState<Set<MandateField>>(new Set());
  const [notes, setNotes] = useState<string[]>([]);
  const [draftPrice, setDraftPrice] = useState<number | null>(priceNow);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [created, setCreated] = useState<Created | null>(null);
  const applied = useRef(new Set<string>());

  const transport = useMemo(
    () => new DefaultChatTransport<AgentUIMessage>({ api: "/api/agent/chat", body: { likedItemId } }),
    [likedItemId],
  );
  // Apply each completed draft_mandate tool result to the form exactly once,
  // when the agent's reply finishes.
  const applyDrafts = (message: AgentUIMessage) => {
    for (const part of message.parts) {
      if (part.type !== "tool-draft_mandate" || part.state !== "output-available") continue;
      if (applied.current.has(part.toolCallId)) continue;
      applied.current.add(part.toolCallId);
      const out = part.output as DraftMandateOutput;
      if (out.status !== "drafted") continue;
      setDraft(out.draft);
      setAgentFields(
        new Set<MandateField>([
          "maxPrice",
          "expiresInDays",
          "mode",
          ...(Object.keys(out.draft.variant).length > 0 ? (["variant"] as const) : []),
        ]),
      );
      setNotes(out.notes);
      if (out.priceNow != null) setDraftPrice(out.priceNow);
      setSubmitError(null);
    }
  };

  const { messages, sendMessage, status, error, stop } = useChat<AgentUIMessage>({
    transport,
    onFinish: ({ message }) => applyDrafts(message),
  });

  const onChange = <F extends MandateField>(field: F, value: MandateDraft[F]) => {
    setDraft((d) => ({ ...d, [field]: value }));
    setAgentFields((s) => {
      if (!s.has(field)) return s;
      const next = new Set(s);
      next.delete(field);
      return next;
    });
    setSubmitError(null);
  };

  const onConfirm = async () => {
    if (draft.maxPrice == null || draft.expiresInDays == null) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const res = await fetch(editing ? `/api/watches/${editing.watchId}` : "/api/watches", {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(editing ? {} : { likedItemId }),
          maxPrice: draft.maxPrice,
          variant: draft.variant,
          expiresInDays: draft.expiresInDays,
          mode: draft.mode,
          agentFilled: [...agentFields],
        }),
      });
      const body = (await res.json().catch(() => ({}))) as Partial<Created> & { error?: string };
      if (!res.ok) {
        setSubmitError(body.error ?? (editing ? "Couldn't update the mandate." : "Couldn't create the watch."));
        return;
      }
      setCreated(editing ? { ...(body as Created), paymentReady: true, edited: true } : (body as Created));
    } catch {
      setSubmitError("Network error. Try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const base = priceNow != null ? Math.floor(priceNow * 0.85) : 100;
  const suggestions = editing
    ? [
        `Raise my limit to $${Math.max(base, Math.round((editing.draft.maxPrice ?? base) * 1.1))}`,
        "Ask me before buying",
        "Keep watching for 30 more days",
      ]
    : [
        `Get it under $${base}, for 30 days`,
        `Watch it for 2 weeks, max $${base}, ask me first`,
        "What variants does it come in?",
      ];

  if (created) {
    return (
      <div className="nb-card flex flex-col items-start gap-4 p-8">
        <span className="nb-chip bg-yellow">Watching</span>
        <h2 className="text-3xl font-bold uppercase">{created.edited ? "Mandate updated" : "Mandate confirmed"}</h2>
        <p className="text-lg">
          DropCart is watching this at a limit of{" "}
          <span className="font-mono font-extrabold">{formatUsd(draft.maxPrice)}</span> (today{" "}
          <span className="font-mono font-extrabold">{formatUsd(created.priceNow)}</span>).
          {created.wouldBuyNow && " Your limit is above today's price, so it will ask you before buying."}
        </p>
        {!created.paymentReady && (
          <div className="flex flex-col items-start gap-3 border-[3px] border-ink bg-pink px-3 py-3">
            <p className="font-bold">
              Next: approve PayPal once (sandbox). Until then nothing can be charged.
            </p>
            <ConnectPaypal next="/wishlist" />
          </div>
        )}
        <div className="flex gap-3">
          <Link href={`/watches/${created.watchId}`} className="nb-btn">
            View watch
          </Link>
          <Link href="/wishlist" className="nb-btn nb-btn-white">
            Wishlist
          </Link>
          <Link href="/" className="nb-btn nb-btn-white">
            Home
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
      <div className="lg:col-span-7">
        <ChatPanel
          messages={messages}
          status={status}
          error={error}
          disabled={llmReady ? null : "Agent offline — fill the form yourself"}
          suggestions={suggestions}
          onSend={(text) => sendMessage({ text })}
          onStop={stop}
        />
      </div>
      <div className="lg:col-span-5">
        <MandateForm
          draft={draft}
          agentFields={agentFields}
          variants={variants}
          priceNow={draftPrice}
          available={available}
          notes={notes}
          submitting={submitting}
          error={submitError}
          onChange={onChange}
          onConfirm={onConfirm}
          editing={Boolean(editing)}
        />
      </div>
    </div>
  );
}
