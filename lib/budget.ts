import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { getDb } from "./db";

/**
 * DropCart Budget: a running pot, not a wallet. No money is held — topping
 * up only raises the number. PayPal is still charged per purchase.
 *
 *   spent     = captured purchases (a refund takes its amount back out)
 *   reserved  = max price of every open watch (each watch reserves its limit)
 *   available = budget − spent − reserved
 *
 * A new watch (or a raised limit) must fit in `available`. When a watch buys
 * below its limit, the difference flows back to available automatically,
 * because the reservation is replaced by the smaller spent amount.
 */

export const OPEN_STATUSES = ["ACTIVE", "AWAITING_APPROVAL", "PURCHASING", "PAUSED"] as const;
export const MAX_BUDGET = 10_000;

export type BudgetSummary = {
  budget: number;
  spent: number;
  reserved: number;
  available: number;
};

const cents = (n: number) => Math.round(n * 100);
const fromCents = (c: number) => c / 100;

/** Pure: the four numbers, in cents-safe arithmetic. */
export function summarize(budget: number, spent: number, reserved: number): BudgetSummary {
  return {
    budget: fromCents(cents(budget)),
    spent: fromCents(cents(spent)),
    reserved: fromCents(cents(reserved)),
    available: fromCents(cents(budget) - cents(spent) - cents(reserved)),
  };
}

export type ReserveCheck = { ok: true } | { ok: false; shortBy: number; message: string };

const usd = (n: number) => `$${n.toFixed(2)}`;

/** Pure: can `amount` more be reserved? Message is shown to the user as-is. */
export function canReserve(summary: BudgetSummary, amount: number): ReserveCheck {
  if (cents(amount) <= cents(summary.available)) return { ok: true };
  const free = Math.max(0, summary.available);
  return {
    ok: false,
    shortBy: fromCents(cents(amount) - cents(free)),
    message:
      `Only ${usd(free)} of your ${usd(summary.budget)} DropCart Budget is free ` +
      `(${usd(summary.spent)} spent, ${usd(summary.reserved)} reserved by other trackers). ` +
      `Lower the limit to ${usd(free)} or less, top up your budget, or stop a tracker.`,
  };
}

/** Pure: is `next` a valid new budget, given what is already spent and reserved? */
export function checkNewBudget(summary: BudgetSummary, next: number): { ok: true } | { ok: false; message: string } {
  if (!Number.isFinite(next) || next <= 0) return { ok: false, message: "Budget must be more than $0." };
  if (next > MAX_BUDGET) return { ok: false, message: `Budget can be at most ${usd(MAX_BUDGET)} in the sandbox.` };
  const floor = summary.spent + summary.reserved;
  if (cents(next) < cents(floor)) {
    return {
      ok: false,
      message: `Budget can't go below ${usd(floor)}: ${usd(summary.spent)} is spent and ${usd(summary.reserved)} is reserved by open trackers.`,
    };
  }
  return { ok: true };
}

type Db = ReturnType<typeof getDb> | Prisma.TransactionClient;

/** Captured, not refunded, all time. */
export async function getSpent(userId: string, db: Db = getDb()): Promise<number> {
  const agg = await db.purchase.aggregate({
    _sum: { amount: true },
    where: { status: "CAPTURED", watch: { userId } },
  });
  return Number(agg._sum.amount ?? 0);
}

export async function getReserved(userId: string, db: Db = getDb(), excludeWatchId?: string): Promise<number> {
  const agg = await db.mandate.aggregate({
    _sum: { maxPrice: true },
    where: {
      watch: {
        userId,
        status: { in: [...OPEN_STATUSES] },
        ...(excludeWatchId ? { id: { not: excludeWatchId } } : {}),
      },
    },
  });
  return Number(agg._sum.maxPrice ?? 0);
}

export async function getBudget(userId: string, db: Db = getDb(), excludeWatchId?: string): Promise<BudgetSummary> {
  const [user, spent, reserved] = await Promise.all([
    db.user.findUniqueOrThrow({ where: { id: userId }, select: { budget: true } }),
    getSpent(userId, db),
    getReserved(userId, db, excludeWatchId),
  ]);
  return summarize(Number(user.budget), spent, reserved);
}

/**
 * Serialize budget changes per user inside a transaction (row lock on User),
 * so two watches created at the same moment can't both take the last $100.
 */
export async function lockUserBudget(tx: Prisma.TransactionClient, userId: string): Promise<void> {
  await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;
}

export class BudgetError extends Error {
  constructor(
    message: string,
    readonly status = 409,
  ) {
    super(message);
  }
}

/** Set a new budget (top up or lower). Refuses to go below spent + reserved. */
export async function setBudget(userId: string, next: number): Promise<BudgetSummary> {
  return getDb().$transaction(async (tx) => {
    await lockUserBudget(tx, userId);
    const summary = await getBudget(userId, tx);
    const check = checkNewBudget(summary, next);
    if (!check.ok) throw new BudgetError(check.message, 400);
    await tx.user.update({ where: { id: userId }, data: { budget: next } });
    return summarize(next, summary.spent, summary.reserved);
  });
}
