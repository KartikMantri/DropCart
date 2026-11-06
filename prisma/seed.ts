/**
 * Seed: demo user (Supabase Auth + app User row), a few liked items from the
 * real Channel3 catalogue, and one ACTIVE watch with a mandate.
 *
 *   npx prisma db seed
 *
 * Idempotent — safe to re-run. Uses 1 Channel3 search (cached in
 * CatalogueCache afterwards) plus free product retrieves.
 */
import { config } from "dotenv";
config({ path: ".env.local" });
config();

async function main() {
  const { getDb } = await import("../lib/db");
  const { getSupabaseAdmin } = await import("../lib/supabase");
  const { searchProducts, getLiveQuote, variantKey } = await import("../lib/channel3");
  const { DEMO_EMAIL, DEMO_PASSWORD } = await import("../lib/demo-account");

  const db = getDb();

  // 1. Demo auth user (email pre-confirmed so judges can sign in immediately).
  const admin = getSupabaseAdmin();
  let userId: string | undefined;
  const created = await admin.auth.admin.createUser({
    email: DEMO_EMAIL,
    password: DEMO_PASSWORD,
    email_confirm: true,
  });
  if (created.data.user) {
    userId = created.data.user.id;
    console.log(`✔ created auth user ${DEMO_EMAIL}`);
  } else {
    // Already exists — find it and reset the password to the published one.
    for (let page = 1; !userId && page <= 20; page++) {
      const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 100 });
      if (error) throw error;
      userId = data.users.find((u) => u.email === DEMO_EMAIL)?.id;
      if (data.users.length < 100) break;
    }
    if (!userId) throw created.error ?? new Error("could not create or find demo user");
    await admin.auth.admin.updateUserById(userId, { password: DEMO_PASSWORD });
    console.log(`✔ demo auth user exists (${userId})`);
  }

  await db.user.upsert({
    where: { id: userId },
    create: { id: userId, email: DEMO_EMAIL, monthlyBudget: 500 },
    update: { email: DEMO_EMAIL },
  });

  // 2. Liked items from a real catalogue search.
  const { products } = await searchProducts("noise cancelling headphones", 12);
  const likeable = products.filter((p) => p.price != null).slice(0, 4);
  if (likeable.length === 0) throw new Error("Channel3 returned no priced products");

  const liked = [];
  for (const p of likeable) {
    liked.push(
      await db.likedItem.upsert({
        where: { userId_channel3ProductId: { userId, channel3ProductId: p.id } },
        create: {
          userId,
          channel3ProductId: p.id,
          title: p.title,
          brand: p.brand,
          imageUrl: p.imageUrl,
          merchantUrl: p.merchantUrl,
          merchantDomain: p.merchantDomain,
          priceWhenLiked: p.price!,
          currency: p.currency,
        },
        update: {},
      }),
    );
  }
  console.log(`✔ ${liked.length} liked items`);

  // 3. One active watch on the first liked item, limit ~15% under today's price.
  const item = liked[0];
  const existing = await db.watch.findFirst({
    where: { userId, likedItemId: item.id, status: { in: ["ACTIVE", "PAUSED"] } },
  });
  if (existing) {
    console.log(`✔ active watch already exists (${existing.id})`);
  } else {
    const product = likeable[0];
    const variant = variantKey(product.selected);
    // Resolve the variant's own product id (colour can be a separate product).
    const quote = await getLiveQuote(product.id, variant);
    const price = quote?.price ?? product.price!;
    const maxPrice = Math.floor(price * 0.85);

    const watch = await db.watch.create({
      data: {
        userId,
        likedItemId: item.id,
        channel3ProductId: quote?.productId ?? product.id,
        variant: quote?.variant ?? variant,
        merchantUrl: quote?.merchantUrl ?? product.merchantUrl,
        status: "ACTIVE",
        mandate: {
          create: {
            maxPrice,
            expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
            mode: "AUTO",
            allowedMerchants: quote?.merchantDomain ? [quote.merchantDomain] : [],
          },
        },
        priceChecks: {
          create: { price, inStock: quote?.inStock ?? product.inStock, variant: quote?.variant },
        },
        auditLogs: {
          create: {
            actor: "SYSTEM",
            action: "WATCH_CREATED",
            details: { seeded: true, maxPrice, priceAtStart: price },
          },
        },
      },
    });
    console.log(`✔ watch ${watch.id}: ${item.title} — limit $${maxPrice} (now $${price})`);
  }

  await db.$disconnect();
}

main().catch((err) => {
  console.error("✖ seed failed:", err);
  process.exit(1);
});
