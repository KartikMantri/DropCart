"use client";

import Link from "next/link";
import type { VariantDimension } from "@/lib/channel3";
import {
  formatUsd,
  MAX_EXPIRY_DAYS,
  type MandateDraft,
  type MandateField,
  type MandateModeValue,
} from "@/lib/mandate";

function AgentTag({ show }: { show: boolean }) {
  if (!show) return null;
  return <span className="nb-chip ml-2 bg-blue align-middle text-[0.65rem]">Filled by agent</span>;
}

/**
 * Large inputs for max price, variant, expiry and mode. Fields the agent set
 * carry a "Filled by agent" tag until the user edits them. Nothing happens
 * until the user presses Confirm.
 */
export function MandateForm({
  draft,
  agentFields,
  variants,
  priceNow,
  available,
  notes,
  submitting,
  error,
  onChange,
  onConfirm,
  editing = false,
}: {
  draft: MandateDraft;
  agentFields: Set<MandateField>;
  variants: VariantDimension[];
  priceNow: number | null;
  /** DropCart Budget still free; null when unknown. */
  available: number | null;
  notes: string[];
  submitting: boolean;
  error: string | null;
  onChange: <F extends MandateField>(field: F, value: MandateDraft[F]) => void;
  onConfirm: () => void;
  editing?: boolean;
}) {
  const choosable = variants.filter((d) => d.values.filter((v) => v.exists).length > 0);
  const wouldBuyNow = draft.maxPrice != null && priceNow != null && draft.maxPrice >= priceNow;
  const overBudget = draft.maxPrice != null && available != null && draft.maxPrice > available;
  const canConfirm =
    draft.maxPrice != null &&
    draft.maxPrice > 0 &&
    draft.expiresInDays != null &&
    !overBudget &&
    !submitting;

  return (
    <form
      className="nb-card flex flex-col gap-5 p-5"
      onSubmit={(e) => {
        e.preventDefault();
        if (canConfirm) onConfirm();
      }}
    >
      <div className="-mx-5 -mt-5 border-b-[3px] border-ink bg-yellow px-5 py-3">
        <h2 className="text-xl font-bold uppercase">{editing ? "Edit mandate" : "Mandate"}</h2>
        <p className="text-sm font-medium">DropCart can only buy inside these limits.</p>
      </div>

      <div>
        <label htmlFor="maxPrice" className="nb-label">
          Max price (USD)
          <AgentTag show={agentFields.has("maxPrice")} />
        </label>
        <input
          id="maxPrice"
          type="number"
          inputMode="decimal"
          min={1}
          step="0.01"
          required
          className="nb-input font-mono text-2xl font-extrabold"
          value={draft.maxPrice ?? ""}
          placeholder={priceNow != null ? String(Math.floor(priceNow * 0.85)) : "250"}
          onChange={(e) =>
            onChange("maxPrice", e.target.value === "" ? null : Number(e.target.value))
          }
        />
        <p className="mt-1 font-mono text-sm">
          Today: {formatUsd(priceNow)}
          {available != null && <> · Budget free: {formatUsd(Math.max(0, available))}</>}
        </p>
        {overBudget && (
          <p role="alert" className="mt-2 border-[3px] border-ink bg-red px-3 py-2 text-sm font-bold">
            Only {formatUsd(Math.max(0, available ?? 0))} of your DropCart Budget is free. Lower the
            limit, <Link href="/wishlist#budget" className="underline">top up your budget</Link>, or cancel a watch.
          </p>
        )}
      </div>

      {choosable.map((dim) => (
        <div key={dim.name}>
          <label htmlFor={`variant-${dim.name}`} className="nb-label">
            {dim.name}
            <AgentTag show={agentFields.has("variant") && Boolean(draft.variant[dim.name])} />
          </label>
          <select
            id={`variant-${dim.name}`}
            className="nb-input"
            value={draft.variant[dim.name] ?? ""}
            onChange={(e) => {
              const next = { ...draft.variant };
              if (e.target.value) next[dim.name] = e.target.value;
              else delete next[dim.name];
              onChange("variant", next);
            }}
          >
            <option value="">Any / default</option>
            {dim.values
              .filter((v) => v.exists)
              .map((v) => (
                <option key={v.label} value={v.label}>
                  {v.label}
                  {v.available === false ? " (out of stock)" : ""}
                </option>
              ))}
          </select>
        </div>
      ))}

      <div>
        <label htmlFor="expiry" className="nb-label">
          Watch for (days)
          <AgentTag show={agentFields.has("expiresInDays")} />
        </label>
        <input
          id="expiry"
          type="number"
          min={1}
          max={MAX_EXPIRY_DAYS}
          step={1}
          required
          className="nb-input font-mono"
          value={draft.expiresInDays ?? ""}
          onChange={(e) =>
            onChange("expiresInDays", e.target.value === "" ? null : Number(e.target.value))
          }
        />
      </div>

      <fieldset>
        <legend className="nb-label">
          Mode
          <AgentTag show={agentFields.has("mode")} />
        </legend>
        <div className="grid grid-cols-2 gap-3">
          {(
            [
              ["AUTO", "Auto-buy", "Buy as soon as it's inside the mandate"],
              ["ASK_FIRST", "Ask first", "Send me an approval request"],
            ] as [MandateModeValue, string, string][]
          ).map(([value, label, hint]) => (
            <label
              key={value}
              className={`cursor-pointer border-[3px] border-ink p-3 ${
                draft.mode === value ? "bg-yellow shadow-brutal-sm" : "bg-card"
              }`}
            >
              <input
                type="radio"
                name="mode"
                value={value}
                checked={draft.mode === value}
                onChange={() => onChange("mode", value)}
                className="sr-only"
              />
              <span className="block font-bold uppercase">{label}</span>
              <span className="block text-sm">{hint}</span>
            </label>
          ))}
        </div>
      </fieldset>

      {wouldBuyNow && (
        <p className="border-[3px] border-ink bg-pink px-3 py-2 text-sm font-bold">
          This limit is already above today&apos;s price ({formatUsd(priceNow)}). DropCart will ask
          you before buying.
        </p>
      )}
      {notes.length > 0 && (
        <ul className="flex flex-col gap-1 border-[3px] border-ink bg-bg px-3 py-2 text-sm">
          {notes.map((n) => (
            <li key={n}>• {n}</li>
          ))}
        </ul>
      )}
      {error && (
        <p role="alert" className="border-[3px] border-ink bg-red px-3 py-2 font-bold">
          {error}
        </p>
      )}

      <button type="submit" className="nb-btn w-full text-lg" disabled={!canConfirm}>
        {submitting ? "Saving…" : editing ? "Save changes" : "Confirm mandate"}
      </button>
      <p className="text-center font-mono text-xs uppercase">
        {editing ? "A higher limit must fit your DropCart Budget" : "Reserves this limit from your DropCart Budget"}
      </p>
    </form>
  );
}
