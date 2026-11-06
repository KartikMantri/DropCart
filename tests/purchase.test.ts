import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LiveQuote } from "@/lib/channel3";

/**
 * lib/purchase.ts with the database, PayPal and Channel3 replaced by fakes.
 * What matters: money moves only after two BUY decisions, with the
 * PayPal-Request-Id `${watchId}:${priceCheckId}`, and every other path
 * leaves the watch in a sensible status without charging.
 */

const charge = vi.fn();
const refund = vi.fn();
const liveQuote = vi.fn();

vi.mock("@/lib/paypal", async () => {
  class PaypalError extends Error {
    constructor(message: string, readonly status: number | null, readonly debugId: string | null, readonly issue: string | null) {
      super(message);
    }
  }
  return { chargeVaultedPayment: charge, refundCapture: refund, PaypalError };
});
vi.mock("@/lib/channel3", () => ({ getLiveQuote: liveQuote }));

// ── tiny in-memory db ─────────────────────────────────────────────────────
type Row = Record<string, unknown>;
const state = {
  watch: {} as Row,
  purchases: [] as Row[],
  audits: [] as Row[],
  notes: [] as Row[],
  checks: [] as Row[],
  spend: 0,
};

const db = {
  purchase: {
    findUnique: vi.fn(async ({ where }: { where: { requestId: string } }) =>
      state.purchases.find((p) => p.requestId === where.requestId) ?? null,
    ),
    findFirst: vi.fn(async ({ where }: { where: { id: string } }) => {
      const p = state.purchases.find((x) => x.id === where.id);
      return p ? { ...p, watch: { likedItem: { title: "Headphones" } } } : null;
    }),
    aggregate: vi.fn(async () => ({ _sum: { amount: state.spend } })),
    upsert: vi.fn(async ({ where, create, update }: { where: { requestId: string }; create: Row; update: Row }) => {
      const found = state.purchases.find((p) => p.requestId === where.requestId);
      if (found) return Object.assign(found, update);
      const row = { id: `p${state.purchases.length + 1}`, ...create };
      state.purchases.push(row);
      return row;
    }),
    update: vi.fn(async ({ where, data }: { where: { id: string }; data: Row }) =>
      Object.assign(state.purchases.find((p) => p.id === where.id)!, data),
    ),
  },
  watch: {
    findUniqueOrThrow: vi.fn(async () => structuredClone(state.watch)),
    updateMany: vi.fn(async ({ where, data }: { where: { status: string }; data: Row }) => {
      if (state.watch.status !== where.status) return { count: 0 };
      Object.assign(state.watch, data);
      return { count: 1 };
    }),
    update: vi.fn(async ({ data }: { data: Row }) => Object.assign(state.watch, data)),
  },
  priceCheck: { create: vi.fn(async ({ data }: { data: Row }) => (state.checks.push(data), { id: "pc-live", ...data })) },
  auditLog: { create: vi.fn(async ({ data }: { data: Row }) => (state.audits.push(data), data)) },
  notification: { create: vi.fn(async ({ data }: { data: Row }) => (state.notes.push(data), data)) },
  $transaction: vi.fn(async (arg: unknown) => (typeof arg === "function" ? arg(db) : Promise.all(arg as Promise<unknown>[]))),
};
vi.mock("@/lib/db", () => ({ getDb: () => db }));

const { attemptPurchase, applyApproval, purchaseRequestId, refundPurchase } = await import("@/lib/purchase");

// ── fixtures ──────────────────────────────────────────────────────────────
const NOW = new Date("2026-11-10T12:00:00Z");
const quote = (over: Partial<LiveQuote> = {}): LiveQuote => ({
  productId: "prod-1",
  variant: "color=black",
  price: 249,
  currency: "USD",
  inStock: true,
  merchantUrl: "https://shop.example/p",
  merchantDomain: "shop.example",
  checkedAt: NOW,
  ...over,
});

function reset(watch: Row = {}, user: Row = {}) {
  state.purchases = [];
  state.audits = [];
  state.notes = [];
  state.checks = [];
  state.spend = 0;
  state.watch = {
    id: "w1",
    status: "ACTIVE",
    channel3ProductId: "prod-1",
    variant: "color=black",
    limitJustRaised: false,
    likedItem: { title: "Headphones" },
    mandate: {
      maxPrice: 260,
      currency: "USD",
      expiresAt: new Date("2026-12-01T00:00:00Z"),
      mode: "AUTO",
      allowedMerchants: [],
    },
    user: { id: "u1", paypalVaultToken: "vault-tok", budget: 500, ...user },
    ...watch,
  };
}

const run = (over: Partial<Parameters<typeof attemptPurchase>[0]> = {}) =>
  attemptPurchase({ watchId: "w1", priceCheckId: "pc1", scheduledQuote: quote(), now: NOW, ...over });

beforeEach(() => {
  vi.clearAllMocks();
  reset();
  liveQuote.mockResolvedValue(quote({ price: 245 }));
  charge.mockResolvedValue({ orderId: "ORDER-1", captureId: "CAP-1", status: "COMPLETED", amount: "245.00", currency: "USD" });
});

// ── tests ─────────────────────────────────────────────────────────────────
describe("attemptPurchase", () => {
  it("buys at the fresh live price with PayPal-Request-Id watchId:priceCheckId", async () => {
    const r = await run();
    expect(r).toMatchObject({ outcome: "BOUGHT", amount: 245, captureId: "CAP-1" });
    expect(charge).toHaveBeenCalledOnce();
    expect(charge.mock.calls[0][0]).toMatchObject({ vaultId: "vault-tok", amount: 245, currency: "USD", requestId: "w1:pc1", maxAmount: 260 });
    expect(state.watch.status).toBe("BOUGHT");
    expect(state.purchases[0]).toMatchObject({ status: "CAPTURED", requestId: "w1:pc1", captureId: "CAP-1", amount: 245 });
    expect(state.audits.at(-1)).toMatchObject({ action: "BOUGHT", actor: "AGENT", rule: "within_mandate" });
    expect(state.notes.at(-1)).toMatchObject({ kind: "BOUGHT" });
  });

  it("does not charge again for a price check that already captured", async () => {
    state.purchases.push({ id: "p1", requestId: "w1:pc1", status: "CAPTURED" });
    expect(await run()).toEqual({ outcome: "ALREADY_BOUGHT", purchaseId: "p1" });
    expect(charge).not.toHaveBeenCalled();
  });

  it("skips on the scheduled check without touching Channel3 or PayPal", async () => {
    const r = await run({ scheduledQuote: quote({ price: 300 }) });
    expect(r).toMatchObject({ outcome: "SKIPPED", check: "scheduled", guard: { rule: "price" } });
    expect(liveQuote).not.toHaveBeenCalled();
    expect(charge).not.toHaveBeenCalled();
    expect(state.watch.status).toBe("ACTIVE");
    expect(state.audits.at(-1)).toMatchObject({ action: "GUARD_SKIP", rule: "price" });
  });

  it("asks instead of buying in ASK_FIRST mode", async () => {
    reset({ mandate: { ...(state.watch.mandate as Row), mode: "ASK_FIRST" } });
    const r = await run();
    expect(r).toMatchObject({ outcome: "ASKED", guard: { rule: "mode" } });
    expect(state.watch.status).toBe("AWAITING_APPROVAL");
    expect(state.notes.at(-1)).toMatchObject({ kind: "APPROVAL_NEEDED" });
    expect(charge).not.toHaveBeenCalled();
  });

  it("buys an AWAITING_APPROVAL watch once the user approves", async () => {
    reset({ status: "AWAITING_APPROVAL", mandate: { ...(state.watch.mandate as Row), mode: "ASK_FIRST" } });
    const r = await run({ approved: true });
    expect(r).toMatchObject({ outcome: "BOUGHT" });
    expect(state.audits.at(-1)).toMatchObject({ action: "BOUGHT", actor: "USER" });
  });

  it("approval never overrides a SKIP", async () => {
    reset({ status: "AWAITING_APPROVAL" });
    const r = await run({ approved: true, scheduledQuote: quote({ inStock: false }) });
    expect(r).toMatchObject({ outcome: "SKIPPED", guard: { rule: "stock" } });
    expect(charge).not.toHaveBeenCalled();
  });

  it("an AWAITING_APPROVAL watch without approval is inactive", async () => {
    reset({ status: "AWAITING_APPROVAL" });
    expect(await run()).toMatchObject({ outcome: "SKIPPED", guard: { rule: "inactive" } });
  });

  it("expires the watch when the mandate has run out", async () => {
    const r = await run({ now: new Date("2026-12-02T00:00:00Z") });
    expect(r).toMatchObject({ outcome: "EXPIRED" });
    expect(state.watch.status).toBe("EXPIRED");
  });

  it("waits for PayPal when no vault token is stored", async () => {
    reset({}, { paypalVaultToken: null });
    expect(await run()).toEqual({ outcome: "NO_PAYMENT_METHOD" });
    expect(state.watch.status).toBe("AWAITING_APPROVAL");
    expect(state.audits.at(-1)).toMatchObject({ action: "PAYMENT_METHOD_MISSING" });
    expect(charge).not.toHaveBeenCalled();
  });

  it("stops when another run already claimed the watch", async () => {
    db.watch.updateMany.mockResolvedValueOnce({ count: 0 });
    expect(await run()).toEqual({ outcome: "BUSY" });
    expect(liveQuote).not.toHaveBeenCalled();
    expect(charge).not.toHaveBeenCalled();
  });

  it("releases the watch when the live re-check says the price went back up", async () => {
    liveQuote.mockResolvedValue(quote({ price: 279 }));
    const r = await run();
    expect(r).toMatchObject({ outcome: "SKIPPED", check: "live", guard: { rule: "price" } });
    expect(state.watch.status).toBe("ACTIVE");
    expect(state.checks).toHaveLength(1);
    expect(charge).not.toHaveBeenCalled();
  });

  it("skips when the live re-check finds the variant gone", async () => {
    liveQuote.mockResolvedValue(quote({ variant: "color=white" }));
    expect(await run()).toMatchObject({ outcome: "SKIPPED", check: "live", guard: { rule: "variant" } });
    expect(charge).not.toHaveBeenCalled();
  });

  it("skips when Channel3 has no offer on the live re-check", async () => {
    liveQuote.mockResolvedValue(null);
    expect(await run()).toMatchObject({ outcome: "SKIPPED", check: "live", guard: { rule: "unavailable" } });
    expect(state.checks).toHaveLength(0);
    expect(state.watch.status).toBe("ACTIVE");
  });

  it("asks when this purchase would take total spend over the budget (safety net)", async () => {
    state.spend = 300;
    expect(await run()).toMatchObject({ outcome: "ASKED", guard: { rule: "budget" } });
    expect(charge).not.toHaveBeenCalled();
  });

  it("records a failed payment, releases the watch and keeps watching", async () => {
    charge.mockRejectedValueOnce(new Error("PayPal charge failed (422): INSTRUMENT_DECLINED"));
    const r = await run();
    expect(r).toMatchObject({ outcome: "FAILED" });
    expect(state.watch.status).toBe("ACTIVE");
    expect(state.purchases[0]).toMatchObject({ status: "FAILED", requestId: "w1:pc1" });
    expect(state.audits.at(-1)).toMatchObject({ action: "PURCHASE_FAILED" });
  });

  it("a retry after a failure reuses the same request id and can succeed", async () => {
    charge.mockRejectedValueOnce(new Error("timeout"));
    await run();
    const r = await run();
    expect(r).toMatchObject({ outcome: "BOUGHT" });
    expect(charge.mock.calls.map((c) => c[0].requestId)).toEqual(["w1:pc1", "w1:pc1"]);
    expect(state.purchases).toHaveLength(1);
    expect(state.purchases[0].status).toBe("CAPTURED");
  });
});

describe("refundPurchase", () => {
  beforeEach(() => {
    state.purchases.push({ id: "p1", watchId: "w1", requestId: "w1:pc1", status: "CAPTURED", captureId: "CAP-1", amount: 245 });
    refund.mockResolvedValue({ refundId: "REF-1", status: "COMPLETED" });
  });

  it("refunds the capture idempotently and marks everything refunded", async () => {
    expect(await refundPurchase("u1", "p1")).toEqual({ refundId: "REF-1", status: "COMPLETED" });
    expect(refund).toHaveBeenCalledWith("CAP-1", "refund:p1");
    expect(state.purchases[0]).toMatchObject({ status: "REFUNDED", refundId: "REF-1" });
    expect(state.watch.status).toBe("REFUNDED");
    expect(state.notes.at(-1)).toMatchObject({ kind: "REFUNDED" });
  });

  it("does not call PayPal again for an already refunded purchase", async () => {
    state.purchases[0].status = "REFUNDED";
    state.purchases[0].refundId = "REF-1";
    expect(await refundPurchase("u1", "p1")).toMatchObject({ refundId: "REF-1" });
    expect(refund).not.toHaveBeenCalled();
  });

  it("rejects unknown and uncaptured purchases", async () => {
    await expect(refundPurchase("u1", "nope")).rejects.toMatchObject({ status: 404 });
    state.purchases[0].status = "FAILED";
    await expect(refundPurchase("u1", "p1")).rejects.toMatchObject({ status: 409 });
  });
});

describe("helpers", () => {
  it("applyApproval turns only ASK into BUY", () => {
    expect(applyApproval({ decision: "ASK", rule: "mode", reason: "r" }, true).decision).toBe("BUY");
    expect(applyApproval({ decision: "ASK", rule: "mode", reason: "r" }, false).decision).toBe("ASK");
    expect(applyApproval({ decision: "SKIP", rule: "price", reason: "r" }, true).decision).toBe("SKIP");
  });
  it("purchaseRequestId", () => expect(purchaseRequestId("w", "c")).toBe("w:c"));
});
