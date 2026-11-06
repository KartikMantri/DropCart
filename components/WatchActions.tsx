"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { WatchStatus } from "@/generated/prisma/enums";
import type { PurchaseOutcome } from "@/lib/purchase";
import { formatUsd } from "@/lib/mandate";

/** Plain-English line for what a check or approval did. */
export function describeOutcome(r: PurchaseOutcome): string {
  switch (r.outcome) {
    case "BOUGHT":
      return `Bought for ${formatUsd(r.amount)}. PayPal capture ${r.captureId}.`;
    case "ALREADY_BOUGHT":
      return "Already bought for this price check. No second charge.";
    case "SKIPPED":
      return `Skipped${r.check === "live" ? " on the live re-check" : ""}: ${r.guard.reason}`;
    case "ASKED":
      return `Needs your approval: ${r.guard.reason}`;
    case "EXPIRED":
      return "The mandate has expired, so DropCart stopped watching.";
    case "NO_PAYMENT_METHOD":
      return "It's inside your mandate, but PayPal isn't connected. Connect PayPal, then approve.";
    case "BUSY":
      return "A check is already running for this watch. Refresh in a moment.";
    case "FAILED":
      return `Payment failed, nothing was charged: ${r.error}`;
  }
}

type Props = {
  watchId: string;
  likedItemId: string;
  status: WatchStatus;
  demoMode: boolean;
  /** Captured purchase that can be refunded ("Undo"). */
  refundable: { id: string; amount: number } | null;
  lastPrice: number | null;
};

export function WatchActions({ watchId, likedItemId, status, demoMode, refundable, lastPrice }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ text: string; tone: string } | null>(null);
  const [override, setOverride] = useState("");
  const [confirmUndo, setConfirmUndo] = useState(false);

  const call = async (key: string, url: string, body: unknown) => {
    setBusy(key);
    setMessage(null);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string } & Partial<PurchaseOutcome>;
      if (!res.ok) {
        setMessage({ text: data.error ?? "Something went wrong.", tone: "bg-red" });
      } else if (data.outcome) {
        const r = data as PurchaseOutcome;
        setMessage({
          text: describeOutcome(r),
          tone: r.outcome === "BOUGHT" ? "bg-green" : r.outcome === "FAILED" ? "bg-red" : "bg-yellow",
        });
      } else if (key === "undo") {
        setMessage({ text: "Refunded through PayPal.", tone: "bg-green" });
      } else {
        setMessage(null);
      }
      router.refresh();
    } catch {
      setMessage({ text: "Network error. Try again.", tone: "bg-red" });
    } finally {
      setBusy(null);
      setConfirmUndo(false);
    }
  };
  const act = (action: string) => call(action, `/api/watches/${watchId}/actions`, { action });

  const editable = status === "ACTIVE" || status === "AWAITING_APPROVAL" || status === "PAUSED";

  return (
    <div className="flex flex-col gap-4">
      {status === "AWAITING_APPROVAL" && (
        <div className="flex flex-wrap gap-3">
          <button className="nb-btn" disabled={busy != null} onClick={() => act("approve")}>
            {busy === "approve" ? "Buying…" : "Buy it"}
          </button>
          <button className="nb-btn nb-btn-white" disabled={busy != null} onClick={() => act("decline")}>
            Not now
          </button>
        </div>
      )}

      {refundable && (
        <div className="flex flex-wrap items-center gap-3">
          {!confirmUndo ? (
            <button className="nb-btn nb-btn-white" disabled={busy != null} onClick={() => setConfirmUndo(true)}>
              Undo (refund {formatUsd(refundable.amount)})
            </button>
          ) : (
            <>
              <span className="font-bold">Refund {formatUsd(refundable.amount)} to PayPal?</span>
              <button
                className="nb-btn"
                disabled={busy != null}
                onClick={() => call("undo", `/api/purchases/${refundable.id}/refund`, {})}
              >
                {busy === "undo" ? "Refunding…" : "Yes, refund"}
              </button>
              <button className="nb-btn nb-btn-white" disabled={busy != null} onClick={() => setConfirmUndo(false)}>
                Keep it
              </button>
            </>
          )}
        </div>
      )}

      {editable && (
        <div className="flex flex-wrap gap-3">
          <Link href={`/chat/${likedItemId}`} className="nb-btn nb-btn-white">
            Edit mandate
          </Link>
          {status === "PAUSED" ? (
            <button className="nb-btn nb-btn-white" disabled={busy != null} onClick={() => act("resume")}>
              Resume
            </button>
          ) : (
            <button className="nb-btn nb-btn-white" disabled={busy != null} onClick={() => act("pause")}>
              Pause
            </button>
          )}
          <button className="nb-btn nb-btn-white" disabled={busy != null} onClick={() => act("cancel")}>
            Stop watching
          </button>
        </div>
      )}

      {demoMode && status === "ACTIVE" && (
        <div className="flex flex-col gap-3 border-[3px] border-dashed border-ink p-3">
          <p className="font-mono text-xs font-bold uppercase">
            <span className="nb-chip bg-red mr-2">Demo mode</span>
            Runs the real guard and a real PayPal sandbox capture
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <button className="nb-btn nb-btn-white" disabled={busy != null} onClick={() => act("check")}>
              {busy === "check" ? "Checking…" : "Check now"}
            </button>
            <form
              className="flex flex-wrap items-center gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                const price = Number(override);
                if (override !== "" && price > 0) call("override", "/api/demo/price-override", { watchId, price });
              }}
            >
              <label htmlFor="override" className="font-bold">
                Pretend the price is $
              </label>
              <input
                id="override"
                type="number"
                min={0.01}
                step="0.01"
                inputMode="decimal"
                className="nb-input w-28 font-mono"
                placeholder={lastPrice != null ? String(Math.floor(lastPrice * 0.8)) : "99"}
                value={override}
                onChange={(e) => setOverride(e.target.value)}
              />
              <button className="nb-btn" type="submit" disabled={busy != null || override === ""}>
                {busy === "override" ? "Checking…" : "Drop & check"}
              </button>
            </form>
          </div>
        </div>
      )}

      {message && (
        <p role="status" className={`border-[3px] border-ink px-3 py-2 font-bold ${message.tone}`}>
          {message.text}
        </p>
      )}
    </div>
  );
}
