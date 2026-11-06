import "server-only";
import { resolveSelection } from "./agent-tools";
import { getLiveQuote, getProduct, sameVariant, variantKey } from "./channel3";
import { canReserve, getBudget, lockUserBudget, OPEN_STATUSES } from "./budget";
import { getDb } from "./db";
import type { ConfirmMandateInput } from "./mandate";

export class WatchError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

const OPEN = OPEN_STATUSES;
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
    throw new WatchError("DropCart is already watching this item.", 409);
  }

  const product = await getProduct(likedItem.channel3ProductId);
  if (!product) throw new WatchError("Channel3 no longer has an offer for this product.", 404);

  const { selection, problems } = resolveSelection(product.variants, input.variant);
  if (problems.length > 0) throw new WatchError(problems.join(" "), 400);

  const requestedKey = variantKey(selection);
  const quote = await getLiveQuote(likedItem.channel3ProductId, requestedKey);
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
