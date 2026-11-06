import "server-only";
import { getLiveQuote, type LiveQuote } from "./channel3";
import { getDb } from "./db";
import { attemptPurchase, type PurchaseOutcome } from "./purchase";

/**
 * Every price check goes through here: the scheduled cron run, "Check now",
 * the demo price override and the user's "Buy it" on an ASK. Each one
 * records a PriceCheck and hands it to lib/purchase.ts, which runs the
 * guard twice before any money moves.
 */

export class CheckError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/** Apply a demo price to a real quote. Stock and variant stay real. */
export function withPrice(quote: LiveQuote | null, price: number | undefined): LiveQuote | null {
  if (price == null || !quote) return quote;
  return { ...quote, price };
}

export type CheckResult = { watchId: string; price: number | null; isDemo: boolean; result: PurchaseOutcome };

export async function runCheck(
  watchId: string,
  opts: { overridePrice?: number; approved?: boolean } = {},
): Promise<CheckResult> {
  const db = getDb();
  const watch = await db.watch.findUniqueOrThrow({ where: { id: watchId } });
  const isDemo = opts.overridePrice != null;
  const fetchQuote = async () =>
    withPrice(await getLiveQuote(watch.channel3ProductId, watch.variant), opts.overridePrice);

  const quote = await fetchQuote();
  const check = await db.priceCheck.create({
    data: {
      watchId,
      price: quote?.price ?? 0,
      inStock: quote?.inStock ?? false,
      variant: quote?.variant ?? null,
      isDemo,
    },
  });

  const result = await attemptPurchase({
    watchId,
    priceCheckId: check.id,
    scheduledQuote: quote,
    approved: opts.approved,
    liveQuote: isDemo ? fetchQuote : undefined,
    isDemo,
  });

  // "Would buy now" only applies while the limit is above the price. Once a
  // check sees the price back above the limit, a later genuine drop should
  // buy automatically again.
  if (watch.limitJustRaised && result.outcome === "SKIPPED" && result.guard.rule === "price") {
    await db.watch.update({ where: { id: watchId }, data: { limitJustRaised: false } });
  }

  return { watchId, price: quote?.price ?? null, isDemo, result };
}

const STUCK_MS = 10 * 60 * 1000;

export type SweepSummary = {
  checked: number;
  bought: number;
  asked: number;
  skipped: number;
  expired: number;
  failed: number;
  recovered: number;
  errors: { watchId: string; error: string }[];
};

/**
 * The scheduled job (POST /api/cron/check, every 6 hours):
 *   1. recover watches stuck in PURCHASING (a crashed run)
 *   2. expire open watches past their mandate's expiry
 *   3. run a check on every ACTIVE watch, one at a time
 */
export async function runScheduledChecks(now = new Date()): Promise<SweepSummary> {
  const db = getDb();
  const summary: SweepSummary = { checked: 0, bought: 0, asked: 0, skipped: 0, expired: 0, failed: 0, recovered: 0, errors: [] };

  // 1 — a PURCHASING watch older than 10 minutes was interrupted. If the
  // Purchase row says CAPTURED, it was bought. Otherwise PayPal may or may not
  // have charged before the crash, and retrying with a new PayPal-Request-Id
  // could charge twice — so pause it and ask the user to check, never retry.
  const stuck = await db.watch.findMany({
    where: { status: "PURCHASING", updatedAt: { lt: new Date(now.getTime() - STUCK_MS) } },
    include: { purchases: { where: { status: "CAPTURED" }, take: 1 }, likedItem: { select: { title: true } } },
  });
  for (const w of stuck) {
    const status = w.purchases.length > 0 ? "BOUGHT" : "PAUSED";
    await db.$transaction([
      db.watch.update({ where: { id: w.id }, data: { status } }),
      db.auditLog.create({ data: { watchId: w.id, actor: "SYSTEM", action: "RECOVERED", details: { to: status } } }),
      ...(status === "PAUSED"
        ? [
            db.notification.create({
              data: {
                userId: w.userId,
                watchId: w.id,
                kind: "APPROVAL_NEEDED",
                message: `A purchase of ${w.likedItem.title} was interrupted. Check your PayPal activity, then resume the watch.`,
              },
            }),
          ]
        : []),
    ]);
    summary.recovered++;
  }

  // 2 — expiry for watches the guard won't see (paused, awaiting approval).
  const expiring = await db.watch.findMany({
    where: { status: { in: ["AWAITING_APPROVAL", "PAUSED"] }, mandate: { expiresAt: { lt: now } } },
    include: { likedItem: { select: { title: true } } },
  });
  for (const w of expiring) {
    await expireWatch(w.id, w.userId, w.likedItem.title);
    summary.expired++;
  }

  // 3 — the checks themselves.
  const active = await db.watch.findMany({ where: { status: "ACTIVE" }, select: { id: true }, orderBy: { updatedAt: "asc" } });
  for (const { id } of active) {
    try {
      const { result } = await runCheck(id);
      summary.checked++;
      if (result.outcome === "BOUGHT") summary.bought++;
      else if (result.outcome === "ASKED" || result.outcome === "NO_PAYMENT_METHOD") summary.asked++;
      else if (result.outcome === "EXPIRED") summary.expired++;
      else if (result.outcome === "FAILED") summary.failed++;
      else summary.skipped++;
    } catch (err) {
      summary.errors.push({ watchId: id, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return summary;
}

async function expireWatch(watchId: string, userId: string, title: string) {
  const db = getDb();
  await db.$transaction([
    db.watch.update({ where: { id: watchId }, data: { status: "EXPIRED" } }),
    db.auditLog.create({ data: { watchId, actor: "SYSTEM", action: "EXPIRED", details: { reason: "The mandate has expired." } } }),
    db.notification.create({
      data: { userId, watchId, kind: "SKIPPED", message: `Stopped watching ${title}: the mandate expired. Its budget is free again.` },
    }),
  ]);
}

// ── user actions on one watch ───────────────────────────────────────────

export type WatchAction = "check" | "approve" | "decline" | "pause" | "resume" | "cancel";

async function ownWatch(userId: string, watchId: string) {
  const watch = await getDb().watch.findFirst({
    where: { id: watchId, userId },
    include: { priceChecks: { orderBy: { checkedAt: "desc" }, take: 1 } },
  });
  if (!watch) throw new CheckError("Watch not found.", 404);
  return watch;
}

/**
 * "Buy it" on an ASK. If the ASK came from a demo price, approving uses the
 * same demo price, so the demo shows the purchase the user was asked about.
 */
export async function approveWatch(userId: string, watchId: string) {
  const watch = await ownWatch(userId, watchId);
  if (watch.status !== "AWAITING_APPROVAL") throw new CheckError("Nothing is waiting for your approval.", 409);
  const last = watch.priceChecks[0];
  await getDb().auditLog.create({ data: { watchId, actor: "USER", action: "APPROVED" } });
  return runCheck(watchId, { approved: true, overridePrice: last?.isDemo ? Number(last.price) : undefined });
}

/** Status changes that move no money. */
export async function setWatchState(userId: string, watchId: string, action: Exclude<WatchAction, "check" | "approve">) {
  const db = getDb();
  const watch = await ownWatch(userId, watchId);
  const transitions: Record<typeof action, { from: string[]; to: "ACTIVE" | "PAUSED" | "CANCELLED"; audit: string }> = {
    decline: { from: ["AWAITING_APPROVAL"], to: "ACTIVE", audit: "APPROVAL_DECLINED" },
    pause: { from: ["ACTIVE", "AWAITING_APPROVAL"], to: "PAUSED", audit: "PAUSED" },
    resume: { from: ["PAUSED"], to: "ACTIVE", audit: "RESUMED" },
    cancel: { from: ["ACTIVE", "AWAITING_APPROVAL", "PAUSED"], to: "CANCELLED", audit: "CANCELLED" },
  };
  const t = transitions[action];
  if (!t.from.includes(watch.status)) {
    throw new CheckError(`Can't ${action} a watch that is ${watch.status.toLowerCase().replace("_", " ")}.`, 409);
  }
  // Conditional update: a cron run that just claimed the watch wins.
  const res = await db.watch.updateMany({ where: { id: watchId, status: watch.status }, data: { status: t.to } });
  if (res.count === 0) throw new CheckError("The watch changed just now. Refresh and try again.", 409);
  await db.auditLog.create({ data: { watchId, actor: "USER", action: t.audit } });
  return { status: t.to };
}

/** "Check now" for one of the user's own watches. */
export async function checkNow(userId: string, watchId: string, overridePrice?: number) {
  const watch = await ownWatch(userId, watchId);
  if (watch.status !== "ACTIVE") {
    throw new CheckError(`Only an active watch can be checked (this one is ${watch.status.toLowerCase().replace("_", " ")}).`, 409);
  }
  return runCheck(watchId, { overridePrice });
}
