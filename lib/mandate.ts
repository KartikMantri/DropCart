import { z } from "zod";

/**
 * Mandate shape shared by the agent tool, the MandateForm and POST /api/watches.
 * Safe to import from client components (no server-only deps).
 */

export const MANDATE_MODES = ["AUTO", "ASK_FIRST"] as const;
export type MandateModeValue = (typeof MANDATE_MODES)[number];

export const MAX_EXPIRY_DAYS = 90;

export type MandateDraft = {
  maxPrice: number | null;
  /** Variant selection, e.g. { Color: "Black" }. Empty = product has no variants / any. */
  variant: Record<string, string>;
  expiresInDays: number | null;
  mode: MandateModeValue;
};

export type MandateField = "maxPrice" | "variant" | "expiresInDays" | "mode";

export const emptyDraft = (): MandateDraft => ({
  maxPrice: null,
  variant: {},
  expiresInDays: 30,
  mode: "AUTO",
});

/** What the user submits when confirming a mandate (creates a Watch). */
export const confirmMandateSchema = z.object({
  likedItemId: z.string().min(1),
  maxPrice: z.number().positive().max(100_000),
  variant: z.record(z.string(), z.string()).default({}),
  expiresInDays: z.number().int().min(1).max(MAX_EXPIRY_DAYS),
  mode: z.enum(MANDATE_MODES),
  /** Fields the agent filled that the user kept, for the audit log. */
  agentFilled: z.array(z.enum(["maxPrice", "variant", "expiresInDays", "mode"])).default([]),
});
export type ConfirmMandateInput = z.infer<typeof confirmMandateSchema>;

export const formatUsd = (n: number | null | undefined): string =>
  n == null
    ? "—"
    : n.toLocaleString("en-US", { style: "currency", currency: "USD" });

/** What the user submits when editing a watch's mandate (full replacement). */
export const editMandateSchema = confirmMandateSchema.omit({ likedItemId: true });
export type EditMandateInput = z.infer<typeof editMandateSchema>;

const DAY_MS = 24 * 60 * 60 * 1000;
const cents = (n: number) => Math.round(n * 100);

export type EditPlan = {
  /** Which mandate fields actually changed. */
  changed: ("maxPrice" | "variant" | "expiresAt" | "mode")[];
  expiresAt: Date;
  /** Raised limit (or new variant) at or above today's price: ask before buying. */
  limitJustRaised: boolean;
  /** True when the new limit needs more of the DropCart Budget. */
  needsMoreBudget: boolean;
};

/**
 * Pure: what an edit does. Safe for the client (shows "This would buy now")
 * and used by the server (lib/watches.ts editWatch).
 */
export function planEdit(
  current: { maxPrice: number; mode: MandateModeValue; expiresAt: Date; variant: string | null; limitJustRaised: boolean },
  next: { maxPrice: number; mode: MandateModeValue; expiresInDays: number; variant: string | null },
  priceNow: number | null,
  now: Date,
): EditPlan {
  const expiresAt = new Date(now.getTime() + next.expiresInDays * DAY_MS);
  const changed: EditPlan["changed"] = [];
  if (cents(next.maxPrice) !== cents(current.maxPrice)) changed.push("maxPrice");
  if ((next.variant ?? "").toLowerCase() !== (current.variant ?? "").toLowerCase()) changed.push("variant");
  if (next.mode !== current.mode) changed.push("mode");
  // Expiry is "days from now", so it always moves a little; only count real changes.
  if (Math.abs(expiresAt.getTime() - current.expiresAt.getTime()) >= DAY_MS / 2) changed.push("expiresAt");

  const raised = cents(next.maxPrice) > cents(current.maxPrice);
  const atOrAbovePrice = priceNow != null && cents(next.maxPrice) >= cents(priceNow);
  let limitJustRaised = current.limitJustRaised;
  if (!atOrAbovePrice) limitJustRaised = false;
  else if (raised || changed.includes("variant")) limitJustRaised = true;

  return { changed, expiresAt, limitJustRaised, needsMoreBudget: raised };
}

/** Whole days until `expiresAt` (1–90), for prefilling the edit form. */
export const daysLeft = (expiresAt: Date, now: Date): number =>
  Math.min(MAX_EXPIRY_DAYS, Math.max(1, Math.ceil((expiresAt.getTime() - now.getTime()) / DAY_MS)));
