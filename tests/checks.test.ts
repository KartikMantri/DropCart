import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LiveQuote } from "@/lib/channel3";

const liveQuote = vi.fn();
const attempt = vi.fn();
vi.mock("@/lib/channel3", () => ({ getLiveQuote: liveQuote }));
vi.mock("@/lib/purchase", () => ({ attemptPurchase: attempt }));

type Row = Record<string, unknown>;
const state = { watch: {} as Row, checks: [] as Row[], audits: [] as Row[] };
const db = {
  watch: {
    findUniqueOrThrow: vi.fn(async () => ({ ...state.watch })),
    findFirst: vi.fn(async ({ where }: { where: { id: string; userId: string } }) =>
      where.id === state.watch.id && where.userId === state.watch.userId
        ? { ...state.watch, priceChecks: state.checks.slice(-1) }
        : null,
    ),
    update: vi.fn(async ({ data }: { data: Row }) => Object.assign(state.watch, data)),
    updateMany: vi.fn(async ({ where, data }: { where: { status: string }; data: Row }) => {
      if (state.watch.status !== where.status) return { count: 0 };
      Object.assign(state.watch, data);
      return { count: 1 };
    }),
  },
  priceCheck: {
    create: vi.fn(async ({ data }: { data: Row }) => {
      const row = { id: `pc${state.checks.length + 1}`, ...data };
      state.checks.push(row);
      return row;
    }),
  },
  auditLog: { create: vi.fn(async ({ data }: { data: Row }) => (state.audits.push(data), data)) },
};
vi.mock("@/lib/db", () => ({ getDb: () => db }));

const { approveWatch, checkNow, runCheck, setWatchState, withPrice } = await import("@/lib/checks");

const quote = (over: Partial<LiveQuote> = {}): LiveQuote => ({
  productId: "p",
  variant: "color=black",
  price: 189,
  currency: "USD",
  inStock: true,
  merchantUrl: null,
  merchantDomain: "shop.example",
  checkedAt: new Date(),
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  state.watch = { id: "w1", userId: "u1", status: "ACTIVE", channel3ProductId: "p", variant: "color=black", limitJustRaised: false };
  state.checks = [];
  state.audits = [];
  liveQuote.mockResolvedValue(quote());
  attempt.mockResolvedValue({ outcome: "SKIPPED", check: "scheduled", guard: { decision: "SKIP", rule: "price", reason: "r" } });
});

describe("withPrice", () => {
  it("replaces only the price", () => {
    expect(withPrice(quote(), 120)).toMatchObject({ price: 120, inStock: true, variant: "color=black" });
    expect(withPrice(quote(), undefined)?.price).toBe(189);
    expect(withPrice(null, 120)).toBeNull();
  });
});

describe("runCheck", () => {
  it("records a real check and passes it to the purchase flow", async () => {
    await runCheck("w1");
    expect(state.checks[0]).toMatchObject({ price: 189, isDemo: false });
    expect(attempt.mock.calls[0][0]).toMatchObject({ watchId: "w1", priceCheckId: "pc1", isDemo: false, liveQuote: undefined });
  });

  it("demo override applies to the scheduled check AND the pre-payment re-check", async () => {
    await runCheck("w1", { overridePrice: 120 });
    expect(state.checks[0]).toMatchObject({ price: 120, isDemo: true });
    const opts = attempt.mock.calls[0][0];
    expect(opts.scheduledQuote.price).toBe(120);
    expect(opts.isDemo).toBe(true);
    expect((await opts.liveQuote()).price).toBe(120);
    expect(liveQuote).toHaveBeenCalledTimes(2); // stock and variant still come from Channel3
  });

  it("clears 'would buy now' once the price is back above the limit", async () => {
    state.watch.limitJustRaised = true;
    await runCheck("w1");
    expect(state.watch.limitJustRaised).toBe(false);
  });

  it("keeps 'would buy now' when the guard asked", async () => {
    state.watch.limitJustRaised = true;
    attempt.mockResolvedValue({ outcome: "ASKED", check: "scheduled", guard: { decision: "ASK", rule: "would_buy_now", reason: "r" } });
    await runCheck("w1");
    expect(state.watch.limitJustRaised).toBe(true);
  });
});

describe("user actions", () => {
  it("checkNow only runs on the owner's active watch", async () => {
    await expect(checkNow("someone-else", "w1")).rejects.toMatchObject({ status: 404 });
    state.watch.status = "PAUSED";
    await expect(checkNow("u1", "w1")).rejects.toMatchObject({ status: 409 });
  });

  it("approve re-runs the check as approved, reusing a demo price", async () => {
    state.watch.status = "AWAITING_APPROVAL";
    state.checks.push({ id: "pc0", price: 120, isDemo: true });
    await approveWatch("u1", "w1");
    expect(state.audits[0]).toMatchObject({ action: "APPROVED", actor: "USER" });
    expect(attempt.mock.calls[0][0]).toMatchObject({ approved: true, isDemo: true });
    expect(attempt.mock.calls[0][0].scheduledQuote.price).toBe(120);
  });

  it("approve with a real last price uses the live price", async () => {
    state.watch.status = "AWAITING_APPROVAL";
    state.checks.push({ id: "pc0", price: 150, isDemo: false });
    await approveWatch("u1", "w1");
    expect(attempt.mock.calls[0][0]).toMatchObject({ approved: true, isDemo: false });
  });

  it("approve needs something waiting", async () => {
    await expect(approveWatch("u1", "w1")).rejects.toMatchObject({ status: 409 });
  });

  it("state transitions: decline, pause, resume, cancel", async () => {
    state.watch.status = "AWAITING_APPROVAL";
    expect(await setWatchState("u1", "w1", "decline")).toEqual({ status: "ACTIVE" });
    expect(await setWatchState("u1", "w1", "pause")).toEqual({ status: "PAUSED" });
    await expect(setWatchState("u1", "w1", "pause")).rejects.toMatchObject({ status: 409 });
    expect(await setWatchState("u1", "w1", "resume")).toEqual({ status: "ACTIVE" });
    expect(await setWatchState("u1", "w1", "cancel")).toEqual({ status: "CANCELLED" });
    expect(state.audits.map((a) => a.action)).toEqual(["APPROVAL_DECLINED", "PAUSED", "RESUMED", "CANCELLED"]);
  });

  it("a bought watch can't be cancelled", async () => {
    state.watch.status = "BOUGHT";
    await expect(setWatchState("u1", "w1", "cancel")).rejects.toMatchObject({ status: 409 });
  });

  it("loses the race to a concurrent purchase claim", async () => {
    db.watch.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(setWatchState("u1", "w1", "pause")).rejects.toMatchObject({ status: 409 });
  });
});
