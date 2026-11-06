/**
 * The guard: the ONLY thing that can say "buy".
 *
 * A pure function — no I/O, no clock reads, no randomness — so every branch
 * is unit-tested (tests/guard.test.ts). lib/purchase.ts calls it twice: once
 * on the scheduled price check, and again on a fresh live re-check right
 * before capturing. Payment happens only if both return BUY.
 *
 * Rules are applied in order; the first match decides.
 *
 *   1 watch not ACTIVE                     → SKIP  inactive
 *   2 now > mandate.expiresAt              → EXPIRE expired
 *   3 no live offer at all                 → SKIP  unavailable
 *   4 live product ≠ watched product       → SKIP  mismatch
 *   5 live variant ≠ watched variant       → SKIP  variant
 *   6 currency ≠ mandate currency          → SKIP  currency
 *   7 store not in allowed merchants       → SKIP  merchant   (empty list = any store)
 *   8 out of stock                         → SKIP  stock
 *   9 no price / price > max price         → SKIP  price
 *  10 month spend + price > monthly budget → ASK   budget
 *  11 mandate mode is ASK_FIRST            → ASK   mode
 *  12 limit was just raised ≥ price        → ASK   would_buy_now
 *     otherwise                            → BUY   within_mandate
 */

export type GuardDecision = "BUY" | "SKIP" | "ASK" | "EXPIRE";

export type GuardRule =
  | "inactive"
  | "expired"
  | "unavailable"
  | "mismatch"
  | "variant"
  | "currency"
  | "merchant"
  | "stock"
  | "price"
  | "budget"
  | "mode"
  | "would_buy_now"
  | "within_mandate";

export type GuardWatch = {
  status: string;
  productId: string;
  /** Canonical variant key (lib/channel3 variantKey), null = no variant. */
  variant: string | null;
  limitJustRaised: boolean;
};

export type GuardMandate = {
  maxPrice: number;
  currency: string;
  expiresAt: Date;
  mode: "AUTO" | "ASK_FIRST";
  /** Merchant domains allowed to fulfil. Empty = any store. */
  allowedMerchants: string[];
};

export type GuardLive = {
  productId: string;
  variant: string | null;
  price: number | null;
  currency: string;
  inStock: boolean;
  merchantDomain: string | null;
};

export type GuardInput = {
  watch: GuardWatch;
  mandate: GuardMandate;
  /** null when Channel3 has no offer for the product any more. */
  live: GuardLive | null;
  /** Amount already captured this calendar month (USD). */
  monthSpend: number;
  monthlyBudget: number;
  now: Date;
};

export type GuardResult = {
  decision: GuardDecision;
  rule: GuardRule;
  /** Plain-English reason, shown in the audit log and notifications. */
  reason: string;
};

const sameKey = (a: string | null, b: string | null) =>
  (a ?? "").toLowerCase() === (b ?? "").toLowerCase();

const usd = (n: number) => `$${n.toFixed(2)}`;

// Compare money in cents to avoid floating-point surprises (269.1 + 0.2 …).
const cents = (n: number) => Math.round(n * 100);

export function evaluate(input: GuardInput): GuardResult {
  const { watch, mandate, live, monthSpend, monthlyBudget, now } = input;
  const r = (decision: GuardDecision, rule: GuardRule, reason: string): GuardResult => ({
    decision,
    rule,
    reason,
  });

  if (watch.status !== "ACTIVE") {
    return r("SKIP", "inactive", `Watch is ${watch.status.toLowerCase()}, not active.`);
  }
  if (now.getTime() > mandate.expiresAt.getTime()) {
    return r("EXPIRE", "expired", "The mandate has expired.");
  }
  if (!live) {
    return r("SKIP", "unavailable", "Channel3 has no offer for this product right now.");
  }
  if (live.productId !== watch.productId) {
    return r("SKIP", "mismatch", "The live listing is a different product.");
  }
  if (!sameKey(live.variant, watch.variant)) {
    return r(
      "SKIP",
      "variant",
      `Only ${live.variant ?? "a different variant"} is offered, not ${watch.variant ?? "the watched variant"}.`,
    );
  }
  if (live.currency.toUpperCase() !== mandate.currency.toUpperCase()) {
    return r("SKIP", "currency", `Price is in ${live.currency}, mandate is in ${mandate.currency}.`);
  }
  if (
    mandate.allowedMerchants.length > 0 &&
    !mandate.allowedMerchants.some(
      (m) => m.toLowerCase() === (live.merchantDomain ?? "").toLowerCase(),
    )
  ) {
    return r("SKIP", "merchant", `${live.merchantDomain ?? "This store"} isn't an allowed store.`);
  }
  if (!live.inStock) {
    return r("SKIP", "stock", "Out of stock.");
  }
  if (live.price == null) {
    return r("SKIP", "price", "No price available.");
  }
  if (cents(live.price) > cents(mandate.maxPrice)) {
    return r("SKIP", "price", `${usd(live.price)} is above the ${usd(mandate.maxPrice)} limit.`);
  }
  if (cents(monthSpend) + cents(live.price) > cents(monthlyBudget)) {
    return r(
      "ASK",
      "budget",
      `Buying at ${usd(live.price)} would take this month's spend over the ${usd(monthlyBudget)} budget.`,
    );
  }
  if (mandate.mode === "ASK_FIRST") {
    return r("ASK", "mode", `Price is ${usd(live.price)}, inside the mandate. You asked to approve first.`);
  }
  if (watch.limitJustRaised) {
    return r("ASK", "would_buy_now", `This would buy now at ${usd(live.price)}. Confirm?`);
  }
  return r(
    "BUY",
    "within_mandate",
    `${usd(live.price)} is within the ${usd(mandate.maxPrice)} limit, in stock, right variant.`,
  );
}
