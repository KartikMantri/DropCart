/**
 * Read-only: PayPal connection, budget and every watch with its latest price.
 *   npx tsx --conditions=react-server scripts/watch-report.ts
 */
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });
config({ quiet: true });

async function main() {
  const { getDb } = await import("../lib/db");
  const { getBudget } = await import("../lib/budget");
  const db = getDb();
  for (const u of await db.user.findMany()) {
    console.log(`\n${u.email.replace(/^(.).*@/, "$1***@")}  PayPal: ${u.paypalVaultToken ? "connected" : "not connected"}`);
    console.log("  budget", await getBudget(u.id));
    const watches = await db.watch.findMany({
      where: { userId: u.id },
      orderBy: { createdAt: "desc" },
      include: {
        mandate: true,
        likedItem: { select: { title: true } },
        priceChecks: { orderBy: { checkedAt: "desc" }, take: 1 },
        purchases: { orderBy: { createdAt: "desc" }, take: 1 },
      },
    });
    for (const w of watches) {
      const last = w.priceChecks[0];
      const purchase = w.purchases[0];
      console.log(
        `  ${w.id}  ${w.status.padEnd(17)} max $${w.mandate?.maxPrice} ${w.mandate?.mode}` +
          `  last $${last?.price ?? "?"} ${last?.inStock ? "in stock" : "out of stock"}` +
          (w.limitJustRaised ? "  (would buy now: asks first)" : "") +
          (purchase ? `  purchase ${purchase.status} $${purchase.amount}` : "") +
          `\n     ${w.likedItem.title.slice(0, 70)}`,
      );
    }
  }
  await db.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
