import "server-only";
import { resolveSelection } from "./agent-tools";
import { getLiveQuote, getProduct, sameVariant, variantKey } from "./channel3";
import { canReserve, getBudget, lockUserBudget, OPEN_STATUSES } from "./budget";
import { getDb } from "./db";
import { planEdit, type ConfirmMandateInput, type EditMandateInput } from "./mandate";

export class WatchError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

const OPEN = OPEN_STATUSES;

/**
 * Validate a variant selection against Channel3's real options and get a live
 * quote for exactly that variant (colour can be a separate product id).
 */
async function quoteForVariant(likedProductId: string, variant: Record<string, string>) {
  const product = await getProduct(likedProductId);
  if (!product) throw new WatchError("Channel3 no longer has an offer for this product.", 404);

  const { selection, problems } = resolveSelection(product.variants, variant);
  if (problems.length > 0) throw new WatchError(problems.join(" "), 400);

  const requestedKey = variantKey(selection);
  const quote = await getLiveQuote(likedProductId, requestedKey);
  if (!quote || quote.price == null) {
    throw new WatchError("Couldn't get a current price for that variant.", 404);
  }
  if (!sameVariant(quote.variant, requestedKey)) {
    throw new WatchError(
      `Channel3 doesn't currently offer ${requestedKey?.replaceAll(";", ", ")}. Pick another variant.`,
      409,
    );
  }
  const priceNow: number = quote.price;
  return { quote, priceNow };
}
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Turn a user-confirmed mandate into a Watch.
 *
 * - Validates the variant against Channel3's real options.
 * - Resolves the variant's own product id (colour can be a separate product)
 *   and records today's price as the first PriceCheck.
 * - If the limit is already ≥ today's price, sets limitJustRaised so the guard
 *   ASKs instead of buying on the first check ("This would buy now").
 *
 * - Reserves maxPrice from the DropCart Budget (lib/budget.ts); refuses with
 *   a plain-English message when it doesn't fit.
 *
 * Payment is separate: until the user connects PayPal (Vault, see
 * app/api/paypal/vault), lib/purchase.ts stops at NO_PAYMENT_METHOD and
 * charges nothing.
 */
export async function createWatch(userId: string, input: ConfirmMandateInput) {
  const db = getDb();

  const likedItem = await db.likedItem.findFirst({
    where: { id: input.likedItemId, userId },
    include: { watches: { where: { status: { in: [...OPEN] } }, select: { id: true } } },
  });
  if (!likedItem) throw new WatchError("Wishlist item not found.", 404);
  if (likedItem.watches.length > 0) {
    throw new WatchError("DropCart is already tracking this item.", 409);
  }

  const { quote, priceNow } = await quoteForVariant(likedItem.channel3ProductId, input.variant);
  const wouldBuyNow = input.maxPrice >= priceNow;
  const user = await db.user.findUniqueOrThrow({ where: { id: userId } });

  // Reserve the limit from the DropCart Budget, atomically per user.
  const watch = await db.$transaction(async (tx) => {
    await lockUserBudget(tx, userId);
    const check = canReserve(await getBudget(userId, tx), input.maxPrice);
    if (!check.ok) throw new WatchError(check.message, 409);

    return tx.watch.create({
      data: {
        userId,
        likedItemId: likedItem.id,
        channel3ProductId: quote.productId,
        variant: quote.variant,
        merchantUrl: quote.merchantUrl,
        status: "ACTIVE",
        limitJustRaised: wouldBuyNow,
        mandate: {
          create: {
            maxPrice: input.maxPrice,
            expiresAt: new Date(Date.now() + input.expiresInDays * DAY_MS),
            mode: input.mode,
            // Empty = any store: DropCart is merchant of record, so a drop at
            // any Channel3 store counts. The guard enforces a list when set.
            allowedMerchants: [],
          },
        },
        priceChecks: {
          create: { price: priceNow, inStock: quote.inStock, variant: quote.variant },
        },
        auditLogs: {
          create: [
            {
              actor: "USER",
              action: "MANDATE_CONFIRMED",
              details: {
                maxPrice: input.maxPrice,
                variant: quote.variant,
                expiresInDays: input.expiresInDays,
                mode: input.mode,
                agentFilledFields: input.agentFilled,
              },
            },
            {
              actor: "SYSTEM",
              action: "WATCH_CREATED",
              details: {
                productId: quote.productId,
                priceAtStart: priceNow,
                inStock: quote.inStock,
                wouldBuyNow,
              },
            },
          ],
        },
      },
    });
  });

  return {
    watchId: watch.id,
    priceNow,
    wouldBuyNow,
    paymentReady: Boolean(user.paypalVaultToken),
  };
}

const EDITABLE = ["ACTIVE", "AWAITING_APPROVAL", "PAUSED"] as const;

/**
 * Edit a watch's mandate (the user confirmed the form; the agent may have
 * filled it). A raised limit must fit the DropCart Budget; a limit raised to
 * or above today's price makes the next check ASK ("This would buy now").
 * An edit to a watch awaiting approval sends it back to ACTIVE so the guard
 * re-evaluates the new mandate.
 */
export async function editWatch(userId: string, watchId: string, input: EditMandateInput) {
  const db = getDb();
  const watch = await db.watch.findFirst({
    where: { id: watchId, userId },
    include: { mandate: true, likedItem: { select: { channel3ProductId: true } } },
  });
  if (!watch?.mandate) throw new WatchError("Tracker not found.", 404);
  if (!(EDITABLE as readonly string[]).includes(watch.status)) {
    throw new WatchError(`A ${watch.status.toLowerCase()} tracker can't be edited.`, 409);
  }
  const mandate = watch.mandate;

  const { quote, priceNow } = await quoteForVariant(watch.likedItem.channel3ProductId, input.variant);
  const plan = planEdit(
    {
      maxPrice: Number(mandate.maxPrice),
      mode: mandate.mode,
      expiresAt: mandate.expiresAt,
      variant: watch.variant,
      limitJustRaised: watch.limitJustRaised,
    },
    { maxPrice: input.maxPrice, mode: input.mode, expiresInDays: input.expiresInDays, variant: quote.variant },
    priceNow,
    new Date(),
  );
  if (plan.changed.length === 0) throw new WatchError("Nothing changed.", 400);

  await db.$transaction(async (tx) => {
    await lockUserBudget(tx, userId);
    if (plan.needsMoreBudget) {
      // Budget without this watch's current reservation, then the new limit.
      const check = canReserve(await getBudget(userId, tx, watch.id), input.maxPrice);
      if (!check.ok) throw new WatchError(check.message, 409);
    }
    const moved = await tx.watch.updateMany({
      where: { id: watch.id, status: watch.status },
      data: {
        status: watch.status === "AWAITING_APPROVAL" ? "ACTIVE" : watch.status,
        limitJustRaised: plan.limitJustRaised,
        channel3ProductId: quote.productId,
        variant: quote.variant,
        merchantUrl: quote.merchantUrl,
      },
    });
    if (moved.count === 0) throw new WatchError("The tracker changed just now (maybe it was bought). Refresh.", 409);
    await tx.mandate.update({
      where: { watchId: watch.id },
      data: {
        maxPrice: input.maxPrice,
        mode: input.mode,
        ...(plan.changed.includes("expiresAt") ? { expiresAt: plan.expiresAt } : {}),
      },
    });
    await tx.priceCheck.create({
      data: { watchId: watch.id, price: priceNow, inStock: quote.inStock, variant: quote.variant },
    });
    await tx.auditLog.create({
      data: {
        watchId: watch.id,
        actor: "USER",
        action: plan.changed.includes("variant") ? "VARIANT_CHANGED" : "MANDATE_EDITED",
        details: {
          changed: plan.changed,
          before: { maxPrice: Number(mandate.maxPrice), mode: mandate.mode, variant: watch.variant, expiresAt: mandate.expiresAt },
          after: { maxPrice: input.maxPrice, mode: input.mode, variant: quote.variant, expiresAt: plan.changed.includes("expiresAt") ? plan.expiresAt : mandate.expiresAt },
          priceNow,
          wouldBuyNow: plan.limitJustRaised,
          agentFilledFields: input.agentFilled,
        },
      },
    });
  });

  return { watchId: watch.id, priceNow, wouldBuyNow: plan.limitJustRaised, changed: plan.changed };
}
