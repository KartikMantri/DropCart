import "server-only";
import { getProduct } from "./channel3";
import { getDb } from "./db";

/** IDs of products the user has liked — used to colour hearts on grids. */
export async function getLikedProductIds(userId: string): Promise<Set<string>> {
  const rows = await getDb().likedItem.findMany({
    where: { userId },
    select: { channel3ProductId: true },
  });
  return new Set(rows.map((r) => r.channel3ProductId));
}

export class LikeError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/**
 * Like a product. The client only sends the product id; title, image and
 * price are fetched from Channel3 server-side (free endpoint) so a client
 * can't plant a fake "price when liked".
 */
export async function likeProduct(userId: string, productId: string) {
  const db = getDb();
  const existing = await db.likedItem.findUnique({
    where: { userId_channel3ProductId: { userId, channel3ProductId: productId } },
  });
  if (existing) return existing;

  const product = await getProduct(productId);
  if (!product || product.price == null) {
    throw new LikeError("This product is no longer available on Channel3.", 404);
  }
  return db.likedItem.create({
    data: {
      userId,
      channel3ProductId: product.id,
      title: product.title,
      brand: product.brand,
      imageUrl: product.imageUrl,
      merchantUrl: product.merchantUrl,
      merchantDomain: product.merchantDomain,
      priceWhenLiked: product.price,
      currency: product.currency,
    },
  });
}

const OPEN_STATUSES = ["ACTIVE", "AWAITING_APPROVAL", "PURCHASING", "PAUSED"] as const;

/** Unlike. Refused while a watch on the item is still open — cancel it first. */
export async function unlikeProduct(userId: string, productId: string) {
  const db = getDb();
  const item = await db.likedItem.findUnique({
    where: { userId_channel3ProductId: { userId, channel3ProductId: productId } },
    include: { watches: { where: { status: { in: [...OPEN_STATUSES] } }, select: { id: true } } },
  });
  if (!item) return;
  if (item.watches.length > 0) {
    throw new LikeError("DropCart is watching this item. Cancel the watch before unliking.", 409);
  }
  await db.likedItem.delete({ where: { id: item.id } });
}
