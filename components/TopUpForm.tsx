"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { formatUsd } from "@/lib/mandate";

const QUICK = [100, 250, 500];

/** Top up (or set) the DropCart Budget. Changes the cap only; no money moves. */
export function TopUpForm({ current, floor }: { current: number; floor: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [custom, setCustom] = useState("");

  const save = async (next: number) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/budget", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ budget: next }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? "Couldn't update the budget.");
        return;
      }
      setCustom("");
      router.refresh();
    } catch {
      setError("Network error. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {QUICK.map((n) => (
          <button key={n} type="button" className="nb-btn nb-btn-white" disabled={busy} onClick={() => save(current + n)}>
            +{formatUsd(n)}
          </button>
        ))}
        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const n = Number(custom);
            if (custom !== "" && Number.isFinite(n)) save(n);
          }}
        >
          <label htmlFor="budget" className="sr-only">
            Set budget (USD)
          </label>
          <input
            id="budget"
            type="number"
            inputMode="decimal"
            min={Math.max(1, Math.ceil(floor))}
            step="1"
            placeholder={String(current)}
            className="nb-input w-28 font-mono"
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
          />
          <button type="submit" className="nb-btn" disabled={busy || custom === ""}>
            Set
          </button>
        </form>
      </div>
      {error && (
        <p role="alert" className="border-[3px] border-ink bg-red px-3 py-1 text-sm font-bold">
          {error}
        </p>
      )}
    </div>
  );
}
