import "server-only";
import { getSpent } from "./budget";
import { getLiveQuote, type LiveQuote } from "./channel3";
import { getDb } from "./db";
import { evaluate, type GuardInput, type GuardLive, type GuardResult } from "./guard";
import { chargeVaultedPayment, PaypalError, refundCapture } from "./paypal";

/**
 * The only path that moves money. Flow for one price check:
 *
 *   1. guard on the scheduled quote          — not BUY → record, stop
 *   2. PayPal connected?                     — no vault token → ask the user
 *   3. claim the watch  ACTIVE → PURCHASING  — atomic; a second run stops here
 *   4. fresh live quote + guard again        — not BUY → release, stop
 *   5. charge the vaulted wallet             — PayPal-Request-Id = watchId:priceCheckId
 *   6. record Purchase, BOUGHT, audit, notify (or FAILED and release)
 *
 * `approved` is set when the user tapped "Buy it" on an ASK: it turns an ASK
 * into a BUY, never a SKIP — price, stock, variant and expiry still apply.
 */

export type PurchaseOutcome =
  | { outcome: "BOUGHT"; purchaseId: string; amount: number; captureId: string }
  | { outcome: "ALREADY_BOUGHT"; purchaseId: string }
  | { outcome: "SKIPPED" | "ASKED" | "EXPIRED"; check: "scheduled" | "live"; guard: GuardResult }
  | { outcome: "NO_PAYMENT_METHOD" }
  | { outcome: "BUSY" }
  | { outcome: "FAILED"; error: string };

export const toGuardLive = (q: LiveQuote | null): GuardLive | null =>
  q && {
    productId: q.productId,
    variant: q.variant,
    price: q.price,
    currency: q.currency,
    inStock: q.inStock,
    merchantDomain: q.merchantDomain,
  };

/** PayPal-Request-Id for a purchase: one price check can capture at most once. */
export const purchaseRequestId = (watchId: string, priceCheckId: string) => `${watchId}:${priceCheckId}`;

/** ASK → BUY when the user approved; everything else is unchanged. */
export function applyApproval(result: GuardResult, approved: boolean): GuardResult {
  if (!approved || result.decision !== "ASK") return result;
  return { decision: "BUY", rule: result.rule, reason: `You approved: ${result.reason}` };
}

export async function attemptPurchase(opts: {
  watchId: string;
  priceCheckId: string;
  /** The quote the scheduled check saw (stored as priceCheckId). */
  scheduledQuote: LiveQuote | null;
  approved?: boolean;
  now?: Date;
}): Promise<PurchaseOutcome> {
  const db = getDb();
  const approved = opts.approved ?? false;
  const requestId = purchaseRequestId(opts.watchId, opts.priceCheckId);

  const existing = await db.purchase.findUnique({ where: { requestId } });
  if (existing?.status === "CAPTURED" || existing?.status === "REFUNDED") {
    return { outcome: "ALREADY_BOUGHT", purchaseId: existing.id };
  }

  const watch = await db.watch.findUniqueOrThrow({
    where: { id: opts.watchId },
    include: { mandate: true, user: true, likedItem: { select: { title: true } } },
  });
  if (!watch.mandate) throw new Error(`Watch ${watch.id} has no mandate.`);
  const { mandate, user } = watch;

  // Only an ACTIVE watch (or an AWAITING_APPROVAL one the user just approved)
  // may proceed; any other status is reported by guard rule 1 ("inactive").
  const startStatus = watch.status;
  const mayStart = startStatus === "ACTIVE" || (approved && startStatus === "AWAITING_APPROVAL");

  const guardInput = async (status: string, live: GuardLive | null, now: Date): Promise<GuardInput> => ({
    watch: {
      status,
      productId: watch.channel3ProductId,
      variant: watch.variant,
      limitJustRaised: watch.limitJustRaised,
    },
    mandate: {
      maxPrice: Number(mandate.maxPrice),
      currency: mandate.currency,
      expiresAt: mandate.expiresAt,
      mode: mandate.mode,
      allowedMerchants: mandate.allowedMerchants,
    },
    live,
    spent: await getSpent(user.id),
    budget: Number(user.budget),
    now,
  });

  // 1 — scheduled check
  const first = applyApproval(
    evaluate(
      await guardInput(mayStart ? "ACTIVE" : startStatus, toGuardLive(opts.scheduledQuote), opts.now ?? new Date()),
    ),
    approved,
  );
  if (first.decision !== "BUY") return stop(watch.id, user.id, "scheduled", first, watch.likedItem.title);

  // 2 — PayPal connected?
  if (!user.paypalVaultToken) {
    await db.$transaction([
      db.watch.update({ where: { id: watch.id }, data: { status: "AWAITING_APPROVAL" } }),
      db.auditLog.create({
        data: { watchId: watch.id, actor: "SYSTEM", action: "PAYMENT_METHOD_MISSING", details: { reason: first.reason } },
      }),
      db.notification.create({
        data: {
          userId: user.id,
          watchId: watch.id,
          kind: "APPROVAL_NEEDED",
          message: `${watch.likedItem.title} hit your price, but PayPal isn't connected yet. Connect PayPal to buy it.`,
        },
      }),
    ]);
    return { outcome: "NO_PAYMENT_METHOD" };
  }

  // 3 — claim
  const claimed = await db.watch.updateMany({
    where: { id: watch.id, status: startStatus },
    data: { status: "PURCHASING" },
  });
  if (claimed.count === 0) return { outcome: "BUSY" };

  try {
    // 4 — fresh live re-check, right before money moves
    const now = new Date();
    const fresh = await getLiveQuote(watch.channel3ProductId, watch.variant);
    const freshCheck = fresh
      ? await db.priceCheck.create({
          data: { watchId: watch.id, price: fresh.price ?? 0, inStock: fresh.inStock, variant: fresh.variant },
        })
      : null;
    const second = applyApproval(evaluate(await guardInput("ACTIVE", toGuardLive(fresh), now)), approved);
    if (second.decision !== "BUY" || !fresh || fresh.price == null) {
      return await stop(watch.id, user.id, "live", second, watch.likedItem.title, true);
    }

    // 5 — charge
    const charge = await chargeVaultedPayment({
      vaultId: user.paypalVaultToken,
      amount: fresh.price,
      maxAmount: Number(mandate.maxPrice),
      currency: mandate.currency,
      requestId,
      referenceId: watch.id,
      description: watch.likedItem.title,
    });

    // 6 — record
    const amount = Number(charge.amount);
    const purchase = await db.$transaction(async (tx) => {
      const p = await tx.purchase.upsert({
        where: { requestId },
        create: {
          watchId: watch.id,
          priceCheckId: opts.priceCheckId,
          requestId,
          paypalOrderId: charge.orderId,
          captureId: charge.captureId,
          amount,
          currency: charge.currency,
          status: "CAPTURED",
          reason: second.reason,
        },
        update: {
          paypalOrderId: charge.orderId,
          captureId: charge.captureId,
          amount,
          status: "CAPTURED",
          reason: second.reason,
        },
      });
      await tx.watch.update({ where: { id: watch.id }, data: { status: "BOUGHT", limitJustRaised: false } });
      await tx.auditLog.create({
        data: {
          watchId: watch.id,
          actor: approved ? "USER" : "AGENT",
          action: "BOUGHT",
          rule: second.rule,
          details: {
            reason: second.reason,
            amount,
            currency: charge.currency,
            paypalOrderId: charge.orderId,
            captureId: charge.captureId,
            captureStatus: charge.status,
            requestId,
            liveCheckId: freshCheck?.id ?? null,
          },
        },
      });
      await tx.notification.create({
        data: {
          userId: user.id,
          watchId: watch.id,
          kind: "BOUGHT",
          message: `Bought ${watch.likedItem.title} for $${amount.toFixed(2)} (limit $${Number(mandate.maxPrice).toFixed(2)}).`,
        },
      });
      return p;
    });
    return { outcome: "BOUGHT", purchaseId: purchase.id, amount, captureId: charge.captureId };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const paypal = err instanceof PaypalError ? { debugId: err.debugId, issue: err.issue, status: err.status } : null;
    await db.$transaction([
      db.purchase.upsert({
        where: { requestId },
        create: {
          watchId: watch.id,
          priceCheckId: opts.priceCheckId,
          requestId,
          paypalOrderId: "",
          amount: 0,
          currency: mandate.currency,
          status: "FAILED",
          reason: message,
        },
        update: { status: "FAILED", reason: message },
      }),
      db.watch.update({ where: { id: watch.id }, data: { status: startStatus } }),
      db.auditLog.create({
        data: { watchId: watch.id, actor: "SYSTEM", action: "PURCHASE_FAILED", details: { message, paypal } },
      }),
      db.notification.create({
        data: {
          userId: user.id,
          watchId: watch.id,
          kind: "SKIPPED",
          message: `Couldn't buy ${watch.likedItem.title}: payment failed. Nothing was charged; still watching.`,
        },
      }),
    ]);
    return { outcome: "FAILED", error: message };
  }
}

/** Record a non-BUY guard result and move the watch to its next status. */
async function stop(
  watchId: string,
  userId: string,
  check: "scheduled" | "live",
  guard: GuardResult,
  title: string,
  claimed = false,
): Promise<PurchaseOutcome> {
  const db = getDb();
  const next =
    guard.decision === "EXPIRE" ? "EXPIRED" : guard.decision === "ASK" ? "AWAITING_APPROVAL" : claimed ? "ACTIVE" : null;

  await db.$transaction([
    ...(next ? [db.watch.update({ where: { id: watchId }, data: { status: next } })] : []),
    db.auditLog.create({
      data: {
        watchId,
        actor: "GUARD",
        action: guard.decision === "ASK" ? "GUARD_ASK" : guard.decision === "EXPIRE" ? "EXPIRED" : "GUARD_SKIP",
        rule: guard.rule,
        details: { check, reason: guard.reason },
      },
    }),
    ...(guard.decision === "ASK"
      ? [db.notification.create({ data: { userId, watchId, kind: "APPROVAL_NEEDED", message: `${title}: ${guard.reason}` } })]
      : []),
  ]);

  const outcome = guard.decision === "ASK" ? "ASKED" : guard.decision === "EXPIRE" ? "EXPIRED" : "SKIPPED";
  return { outcome, check, guard };
}

export class RefundError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/** Full refund of a captured purchase, by its owner. Idempotent. */
export async function refundPurchase(userId: string, purchaseId: string, actor: "USER" | "SYSTEM" = "USER") {
  const db = getDb();
  const purchase = await db.purchase.findFirst({
    where: { id: purchaseId, watch: { userId } },
    include: { watch: { include: { likedItem: { select: { title: true } } } } },
  });
  if (!purchase) throw new RefundError("Purchase not found.", 404);
  if (purchase.status === "REFUNDED") return { refundId: purchase.refundId, status: "COMPLETED" };
  if (purchase.status !== "CAPTURED" || !purchase.captureId) {
    throw new RefundError("Only a captured purchase can be refunded.", 409);
  }

  const refund = await refundCapture(purchase.captureId, `refund:${purchase.id}`);

  await db.$transaction([
    db.purchase.update({ where: { id: purchase.id }, data: { status: "REFUNDED", refundId: refund.refundId } }),
    db.watch.update({ where: { id: purchase.watchId }, data: { status: "REFUNDED" } }),
    db.auditLog.create({
      data: {
        watchId: purchase.watchId,
        actor,
        action: "REFUNDED",
        details: { refundId: refund.refundId, refundStatus: refund.status, captureId: purchase.captureId },
      },
    }),
    db.notification.create({
      data: {
        userId,
        watchId: purchase.watchId,
        kind: "REFUNDED",
        message: `Refunded $${Number(purchase.amount).toFixed(2)} for ${purchase.watch.likedItem.title}.`,
      },
    }),
  ]);
  return refund;
}
