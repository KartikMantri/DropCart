/**
 * Day-1 smoke test for lib/channel3.ts.
 *   npm run test:channel3 -- "noise cancelling headphones"
 * Uses 1 search from the monthly quota (+ 1 free retrieve). The second
 * search call must be served from cache.
 */
import { config } from "dotenv";
config({ path: ".env.local" });
config();

async function main() {
  // Imported after env is loaded. Run with --conditions=react-server so the
  // "server-only" guard in lib/* resolves to its no-op build.
  const { searchProducts, getProduct, getLiveQuote, variantKey } = await import(
    "../lib/channel3"
  );
  // Keep this smoke test off the database even if DATABASE_URL is set.
  delete process.env.DATABASE_URL;

  const query = process.argv[2] ?? "noise cancelling headphones";
  console.log(`\n▶ search("${query}")`);
  const first = await searchProducts(query, 5);
  console.log(`  ${first.products.length} products (fromCache=${first.fromCache})`);
  for (const p of first.products) {
    console.log(
      `  • ${p.id.padEnd(10)} $${String(p.price ?? "—").padStart(8)} ${p.inStock ? "IN " : "OUT"} ${p.merchantDomain ?? "?"}  ${p.title.slice(0, 60)}`,
    );
  }

  const again = await searchProducts(query, 5);
  console.log(`\n▶ same search again → fromCache=${again.fromCache} (expected true)`);
  if (!again.fromCache) throw new Error("cache miss on identical query");

  const top = first.products[0];
  if (!top) return;
  console.log(`\n▶ getProduct("${top.id}")  [free endpoint]`);
  const detail = await getProduct(top.id);
  console.log(`  price $${detail?.price}  inStock=${detail?.inStock}  offers=${detail?.offerCount}`);
  console.log(`  selected: ${JSON.stringify(detail?.selected)}`);
  for (const d of detail?.variants ?? []) {
    console.log(
      `  variant ${d.name}: ${d.values
        .slice(0, 8)
        .map((v) => `${v.label}${v.available === false ? "(oos)" : ""}`)
        .join(", ")}`,
    );
  }

  const firstDim = detail?.variants[0];
  const firstVal = firstDim?.values.find((v) => v.exists);
  const wanted = firstDim && firstVal ? variantKey({ [firstDim.name]: firstVal.label }) : null;
  console.log(`\n▶ getLiveQuote("${top.id}", ${JSON.stringify(wanted)})`);
  const quote = await getLiveQuote(top.id, wanted);
  console.log(`  ${JSON.stringify(quote)}`);
  console.log("\n✔ Channel3 OK");
}

main().catch((err) => {
  console.error("\n✖", err);
  process.exit(1);
});
