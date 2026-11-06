import "server-only";
import { Channel3, Channel3Error, type Channel3Api } from "@channel3/sdk";
import { getDb, hasDatabase } from "./db";
import { requireEnv } from "./env";

/**
 * The ONLY module that talks to Channel3 (non-negotiable rule 5).
 *
 * Quota strategy (free tier: 1,000 searches/month):
 *  - `products.search` counts against the quota → every search is cached in
 *    CatalogueCache: featured grid 24h, user queries 1h. Identical in-flight
 *    requests are de-duplicated. Search is only called on submit, never per
 *    keystroke.
 *  - `products.retrieve` (GET /v1/products/{id}) is free → used for live price
 *    and stock re-checks, variant listing, and fresh merchant links. Never
 *    cached for long, because prices and offer URLs are volatile.
 */

// ---------------------------------------------------------------------------
// Public types — the rest of the app never sees raw SDK shapes.
// ---------------------------------------------------------------------------

export type VariantValue = {
  label: string;
  /** Exists on this product family (vs. only on a sibling variant). */
  exists: boolean;
  /** Only hydrated by getProduct; null on search results. */
  available: boolean | null;
  /** Set when choosing this value swaps to a different Channel3 product. */
  productId: string | null;
  thumbnailUrl: string | null;
};

export type VariantDimension = { name: string; values: VariantValue[] };

export type CatalogueProduct = {
  id: string;
  title: string;
  brand: string | null;
  imageUrl: string | null;
  /** Price of the best USD offer (cheapest in-stock, else cheapest). */
  price: number | null;
  compareAtPrice: number | null;
  currency: string;
  inStock: boolean;
  merchantDomain: string | null;
  merchantUrl: string | null;
  offerCount: number;
  variants: VariantDimension[];
  /** Variant options Channel3 resolved for this response, e.g. {Color: "Black"}. */
  selected: Record<string, string>;
};

/** What the guard needs from a live re-check. */
export type LiveQuote = {
  productId: string;
  /** Canonical key of the variant Channel3 actually resolved (see variantKey). */
  variant: string | null;
  price: number | null;
  currency: string;
  inStock: boolean;
  merchantUrl: string | null;
  merchantDomain: string | null;
  checkedAt: Date;
};

export class Channel3Unavailable extends Error {
  constructor(
    message: string,
    readonly statusCode?: number,
  ) {
    super(message);
    this.name = "Channel3Unavailable";
  }
}

// ---------------------------------------------------------------------------
// Variant keys
// ---------------------------------------------------------------------------

/**
 * Canonical, order-independent string for a variant selection:
 * {Size: "M", Color: "Black"} → "Color=Black;Size=M". Null for no selection.
 * Stored on Watch.variant and compared case-insensitively.
 */
export function variantKey(
  selection: Record<string, string> | null | undefined,
): string | null {
  if (!selection) return null;
  const entries = Object.entries(selection)
    .map(([k, v]) => [k.trim(), v.trim()] as const)
    .filter(([k, v]) => k && v)
    .sort(([a], [b]) => a.toLowerCase().localeCompare(b.toLowerCase()));
  if (entries.length === 0) return null;
  return entries.map(([k, v]) => `${k}=${v}`).join(";");
}

export function parseVariantKey(key: string | null | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!key) return out;
  for (const part of key.split(";")) {
    const idx = part.indexOf("=");
    if (idx > 0) out[part.slice(0, idx)] = part.slice(idx + 1);
  }
  return out;
}

export function sameVariant(a: string | null, b: string | null): boolean {
  return (a ?? "").toLowerCase() === (b ?? "").toLowerCase();
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

let client: Channel3 | null = null;

function c3(): Channel3 {
  if (!client) {
    client = new Channel3({
      apiKey: requireEnv("CHANNEL3_API_KEY"),
      country: "US",
      currency: "USD",
      language: "en",
      timeoutInSeconds: 15,
      maxRetries: 1,
    });
  }
  return client;
}

async function call<T>(label: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof Channel3Error) {
      throw new Channel3Unavailable(
        `Channel3 ${label} failed (${err.statusCode ?? "network"}): ${err.message}`,
        err.statusCode,
      );
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Normalisation
// ---------------------------------------------------------------------------

function pickOffer(offers: Channel3Api.ProductOffer[] | undefined) {
  const usd = (offers ?? []).filter((o) => o.price?.currency === "USD");
  const pool = usd.length > 0 ? usd : (offers ?? []);
  const byPrice = (a: Channel3Api.ProductOffer, b: Channel3Api.ProductOffer) =>
    a.price.price - b.price.price;
  const inStock = pool.filter((o) => o.availability === "InStock").sort(byPrice);
  return inStock[0] ?? [...pool].sort(byPrice)[0] ?? null;
}

function pickImage(images: Channel3Api.ProductImage[] | undefined): string | null {
  if (!images || images.length === 0) return null;
  const main = images.find((i) => i.is_main_image) ?? images[0];
  return main.cleaned_url ?? main.url ?? null;
}

export function normalizeProduct(p: Channel3Api.Product): CatalogueProduct {
  const offer = pickOffer(p.offers);
  const selected: Record<string, string> = {};
  for (const s of p.variants?.selected ?? []) selected[s.name] = s.label;

  return {
    id: p.id,
    title: p.title,
    brand: p.brands?.[0]?.name ?? null,
    imageUrl: pickImage(p.images),
    price: offer ? round2(offer.price.price) : null,
    compareAtPrice:
      offer?.price.compare_at_price != null ? round2(offer.price.compare_at_price) : null,
    currency: offer?.price.currency ?? "USD",
    inStock: offer?.availability === "InStock",
    merchantDomain: offer?.domain ?? null,
    merchantUrl: offer?.url ?? null,
    offerCount: p.offers?.length ?? 0,
    variants: (p.variants?.options ?? []).map((o) => ({
      name: o.name,
      values: o.values.map((v) => ({
        label: v.label,
        exists: v.exists,
        available: v.available == null ? null : v.available === "InStock",
        productId: v.product_id ?? null,
        thumbnailUrl: v.thumbnail_url ?? null,
      })),
    })),
    selected,
  };
}

const round2 = (n: number) => Math.round(n * 100) / 100;

// ---------------------------------------------------------------------------
// Cache (CatalogueCache table, with an in-memory fallback when no DB is set)
// ---------------------------------------------------------------------------

type CacheEntry = { products: CatalogueProduct[]; fetchedAt: Date };

const memoryCache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<CatalogueProduct[]>>();

async function readCache(key: string, ttlMs: number): Promise<CacheEntry | null> {
  // Fresh entry already in this server process → skip the database round trip.
  const local = memoryCache.get(key);
  if (local && Date.now() - local.fetchedAt.getTime() < ttlMs) return local;

  if (hasDatabase()) {
    try {
      const row = await getDb().catalogueCache.findUnique({ where: { query: key } });
      if (row) {
        const entry = {
          products: row.products as unknown as CatalogueProduct[],
          fetchedAt: row.fetchedAt,
        };
        memoryCache.set(key, entry);
        return entry;
      }
      return null;
    } catch (err) {
      console.warn("[channel3] cache read failed, using memory cache", err);
    }
  }
  return memoryCache.get(key) ?? null;
}

async function writeCache(key: string, products: CatalogueProduct[]): Promise<void> {
  const fetchedAt = new Date();
  memoryCache.set(key, { products, fetchedAt });
  if (!hasDatabase()) return;
  try {
    const json = products as unknown as object;
    await getDb().catalogueCache.upsert({
      where: { query: key },
      create: { query: key, products: json, fetchedAt },
      update: { products: json, fetchedAt },
    });
  } catch (err) {
    console.warn("[channel3] cache write failed", err);
  }
}

/**
 * Serve from cache when fresh; otherwise fetch once (de-duplicating concurrent
 * callers). If Channel3 fails and a stale entry exists, serve the stale entry
 * rather than an error — the grid is presentational; live checks use getProduct.
 */
async function cached(
  key: string,
  ttlMs: number,
  fetcher: () => Promise<CatalogueProduct[]>,
): Promise<{ products: CatalogueProduct[]; fetchedAt: Date; fromCache: boolean }> {
  const hit = await readCache(key, ttlMs);
  if (hit && Date.now() - hit.fetchedAt.getTime() < ttlMs) {
    return { ...hit, fromCache: true };
  }

  let pending = inFlight.get(key);
  if (!pending) {
    pending = fetcher().finally(() => inFlight.delete(key));
    inFlight.set(key, pending);
  }

  try {
    const products = await pending;
    await writeCache(key, products);
    return { products, fetchedAt: new Date(), fromCache: false };
  } catch (err) {
    if (hit) {
      console.warn(`[channel3] ${key} refresh failed; serving stale cache`, err);
      return { ...hit, fromCache: true };
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

const HOUR = 60 * 60 * 1000;
export const SEARCH_TTL_MS = 1 * HOUR;
export const FEATURED_TTL_MS = 24 * HOUR;

/** Category searches that make up the home FEATURED grid (~3 searches/day). */
export const FEATURED_QUERIES = [
  "noise cancelling headphones",
  "running shoes",
  "smart watch",
] as const;
export const FEATURED_MAX = 50;

const normalizeQuery = (q: string) => q.trim().toLowerCase().replace(/\s+/g, " ");

/** Full-catalogue search. Call on submit only. Cached 1h per normalised query. */
export async function searchProducts(query: string, limit = 24) {
  const q = normalizeQuery(query);
  if (q.length < 2) return { products: [], fetchedAt: new Date(), fromCache: true };
  const capped = Math.min(Math.max(limit, 1), 30); // API max is 30
  return cached(`search:${capped}:${q}`, SEARCH_TTL_MS, async () => {
    const page = await call("search", () =>
      c3().products.search({ query: q, limit: capped }),
    );
    return page.data.map(normalizeProduct);
  });
}

/** Home grid: ≤ 50 products from a few category searches, cached 24h. */
export async function getFeatured() {
  return cached("featured:v1", FEATURED_TTL_MS, async () => {
    const perQuery = Math.ceil(FEATURED_MAX / FEATURED_QUERIES.length) + 1;
    const results = await Promise.allSettled(
      FEATURED_QUERIES.map((q) =>
        call("featured search", () => c3().products.search({ query: q, limit: perQuery })),
      ),
    );
    const ok = results.filter(
      (r): r is PromiseFulfilledResult<Awaited<ReturnType<Channel3["products"]["search"]>>> =>
        r.status === "fulfilled",
    );
    if (ok.length === 0) {
      const first = results[0];
      throw first.status === "rejected" ? first.reason : new Error("featured fetch failed");
    }
    // Interleave categories so the grid isn't three blocks of one kind.
    const lists = ok.map((r) => r.value.data.map(normalizeProduct));
    const seen = new Set<string>();
    const out: CatalogueProduct[] = [];
    for (let i = 0; out.length < FEATURED_MAX; i++) {
      let added = false;
      for (const list of lists) {
        const p = list[i];
        if (!p) continue;
        added = true;
        if (p.price != null && !seen.has(p.id)) {
          seen.add(p.id);
          out.push(p);
          if (out.length >= FEATURED_MAX) break;
        }
      }
      if (!added) break;
    }
    return out;
  });
}

/**
 * Full product detail with hydrated variant availability. Free endpoint, not
 * cached — always current price, stock and merchant link.
 * Returns null when Channel3 no longer has a US offer for the product (404).
 */
export async function getProduct(
  productId: string,
  selection?: Record<string, string> | null,
): Promise<CatalogueProduct | null> {
  try {
    const p = await call("retrieve", () =>
      c3().products.retrieve({
        product_id: productId,
        ...(selection && Object.keys(selection).length > 0
          ? { selected_options: selection }
          : {}),
      }),
    );
    return normalizeProduct(p);
  } catch (err) {
    if (err instanceof Channel3Unavailable && err.statusCode === 404) return null;
    throw err;
  }
}

export async function listVariants(productId: string): Promise<VariantDimension[]> {
  const p = await getProduct(productId);
  return p?.variants ?? [];
}

/**
 * NOTE: some product families model a variant (often Color) as a separate
 * Channel3 product — selecting it returns a different `id`
 * (VariantValue.productId). A Watch must therefore store the *resolved*
 * product id of its variant, otherwise the guard's product-mismatch rule
 * would skip every check. Verified on Day 1: oUZqBOZ + Color=Cypress Green
 * resolves to product LvunXAD.
 *
 * Live quote for the guard. Requests the watched variant and reports the
 * variant Channel3 actually resolved — if Channel3 relaxed the selection (e.g.
 * black is gone), `variant` differs from the request and the guard skips.
 */
export async function getLiveQuote(
  productId: string,
  watchedVariant: string | null,
): Promise<LiveQuote | null> {
  const requested = parseVariantKey(watchedVariant);
  const p = await getProduct(productId, requested);
  if (!p) return null;

  // Only compare the dimensions the user asked for; Channel3 may also report
  // dimensions the user never constrained.
  const resolved: Record<string, string> = {};
  const lowerSelected = new Map(
    Object.entries(p.selected).map(([k, v]) => [k.toLowerCase(), v] as const),
  );
  for (const name of Object.keys(requested)) {
    const v = lowerSelected.get(name.toLowerCase());
    if (v) resolved[name] = v;
  }

  return {
    productId: p.id,
    variant: watchedVariant ? variantKey(resolved) : null,
    price: p.price,
    currency: p.currency,
    inStock: p.inStock,
    merchantUrl: p.merchantUrl,
    merchantDomain: p.merchantDomain,
    checkedAt: new Date(),
  };
}
