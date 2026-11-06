/**
 * Run one real price check + purchase attempt now (what the Day-4 cron will do).
 *
 *   npx tsx --conditions=react-server scripts/check-watch.ts --all
 *   npx tsx --conditions=react-server scripts/check-watch.ts <watchId>
 *   npx tsx --conditions=react-server scripts/check-watch.ts <watchId> --approve
 *
 * --approve = the user tapped "Buy it" on an ASK (turns ASK into BUY, never
 * overrides a SKIP). Charges the saved PayPal sandbox account if both guard
 * checks say BUY. Sandbox only (lib/env.ts refuses anything else).
 */
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });
config({ quiet: true });

async function main() {
  const args = process.argv.slice(2);
  const approved = args.includes("--approve");
  const target = args.find((a) => !a.startsWith("--"));
  if (!target && !args.includes("--all")) throw new Error("Pass a watch id or --all.");

  const { getDb } = await import("../lib/db");
  const { getLiveQuote } = await import("../lib/channel3");
  const { attemptPurchase } = await import("../lib/purchase");
  const db = getDb();

  const watches = await db.watch.findMany({
    where: target ? { id: target } : { status: { in: ["ACTIVE", "AWAITING_APPROVAL"] } },
    include: { likedItem: { select: { title: true } }, mandate: true },
  });
  if (watches.length === 0) console.log("No matching watches.");

  for (const w of watches) {
    console.log(`\n▶ ${w.likedItem.title.slice(0, 60)}  (${w.status}, limit $${w.mandate?.maxPrice})`);
    const quote = await getLiveQuote(w.channel3ProductId, w.variant);
    console.log(`  live: ${quote ? `$${quote.price} ${quote.inStock ? "in stock" : "out of stock"} ${quote.variant ?? ""} at ${quote.merchantDomain}` : "no offer"}`);
    const check = await db.priceCheck.create({
      data: { watchId: w.id, price: quote?.price ?? 0, inStock: quote?.inStock ?? false, variant: quote?.variant ?? null },
    });
    const result = await attemptPurchase({ watchId: w.id, priceCheckId: check.id, scheduledQuote: quote, approved });
    console.log("  →", JSON.stringify(result));
  }
  await db.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
