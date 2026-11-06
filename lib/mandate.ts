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
