import "server-only";
import { tool } from "ai";
import { z } from "zod";
import {
  getProduct,
  listVariants,
  searchProducts,
  type CatalogueProduct,
  type VariantDimension,
} from "./channel3";
import { MAX_EXPIRY_DAYS, MANDATE_MODES, type MandateDraft } from "./mandate";

/**
 * Tools exposed to the LLM. NONE of them can move money: they search, read
 * products and *draft* a mandate. A draft only fills the form in the UI; the
 * user must confirm it there, and payments happen only in lib/purchase.ts
 * after lib/guard.ts says BUY.
 *
 * Tool outputs are kept compact to save tokens on free-tier LLMs.
 */

export type AgentContext = {
  likedItem: { id: string; channel3ProductId: string; title: string };
  /** Live product for the liked item (null if Channel3 no longer has it). */
  product: CatalogueProduct | null;
  /** DropCart Budget still free for this mandate (USD); undefined if unknown. */
  budgetFree?: number;
  /** Set when the user is editing an existing watch. */
  currentMandate?: { maxPrice: number; variant: string | null; mode: string; expiresAt: Date; status: string };
};

const variantInput = z
  .array(z.object({ name: z.string().describe("Option name, e.g. Color"), value: z.string() }))
  .describe("Variant selection using option names/values from list_variants. Empty if none.");

const toSelection = (pairs: { name: string; value: string }[] | undefined) =>
  Object.fromEntries((pairs ?? []).map((p) => [p.name, p.value]));

function compact(p: CatalogueProduct) {
  return {
    id: p.id,
    title: p.title,
    brand: p.brand,
    price: p.price,
    currency: p.currency,
    inStock: p.inStock,
    store: p.merchantDomain,
    selected: p.selected,
  };
}

function compactVariants(dims: VariantDimension[]) {
  return dims.map((d) => ({
    name: d.name,
    values: d.values
      .filter((v) => v.exists)
      .map((v) => ({
        value: v.label,
        available: v.available,
      })),
  }));
}

/**
 * Match a requested selection against the product's real options
 * (case-insensitive) and return canonical labels plus any problems.
 */
export function resolveSelection(
  dims: VariantDimension[],
  requested: Record<string, string>,
): { selection: Record<string, string>; problems: string[] } {
  const selection: Record<string, string> = {};
  const problems: string[] = [];
  for (const [rawName, rawValue] of Object.entries(requested)) {
    const dim = dims.find((d) => d.name.toLowerCase() === rawName.trim().toLowerCase());
    if (!dim) {
      problems.push(`"${rawName}" isn't an option for this product.`);
      continue;
    }
    const value = dim.values.find(
      (v) => v.exists && v.label.toLowerCase() === rawValue.trim().toLowerCase(),
    );
    if (!value) {
      const valid = dim.values.filter((v) => v.exists).map((v) => v.label);
      problems.push(`"${rawValue}" isn't a ${dim.name}. Options: ${valid.join(", ")}.`);
      continue;
    }
    selection[dim.name] = value.label;
  }
  return { selection, problems };
}

export type DraftMandateOutput =
  | {
      status: "drafted";
      draft: MandateDraft;
      /** Today's price for the drafted variant. */
      priceNow: number | null;
      inStockNow: boolean;
      /** True when the limit is already ≥ today's price. */
      wouldBuyNow: boolean;
      notes: string[];
    }
  | { status: "needs_info"; problems: string[] };

export function buildAgentTools(ctx: AgentContext) {
  const watchedId = ctx.likedItem.channel3ProductId;

  return {
    search_products: tool({
      description:
        "Search the Channel3 catalogue. Uses limited quota — only call when the user asks for alternatives or a different product.",
      inputSchema: z.object({ query: z.string().min(2).max(120) }),
      execute: async ({ query }) => {
        const { products } = await searchProducts(query, 8);
        return { results: products.slice(0, 6).map(compact) };
      },
    }),

    get_product: tool({
      description:
        "Get current price, stock and store for a product, optionally for a specific variant.",
      inputSchema: z.object({
        productId: z.string().describe(`Channel3 product id. The watched item is ${watchedId}.`),
        variant: variantInput.optional(),
      }),
      execute: async ({ productId, variant }) => {
        const p = await getProduct(productId, toSelection(variant));
        if (!p) return { found: false as const };
        return { found: true as const, product: compact(p) };
      },
    }),

    list_variants: tool({
      description: "List variant options (e.g. Color, Size) and which values are available.",
      inputSchema: z.object({ productId: z.string() }),
      execute: async ({ productId }) => ({ variants: compactVariants(await listVariants(productId)) }),
    }),

    draft_mandate: tool({
      description:
        "Fill the mandate form shown next to the chat for the watched item. This does NOT start watching or charge anything — the user reviews, edits and confirms the form themselves. Only call once you know the max price; ask for a variant if the product has variants and the user hasn't picked one.",
      inputSchema: z.object({
        maxPrice: z.number().positive().describe("Max price in USD the user will pay."),
        variant: variantInput,
        expiresInDays: z
          .number()
          .int()
          .min(1)
          .max(MAX_EXPIRY_DAYS)
          .describe("How long to watch, in days. Default 30 if the user didn't say."),
        mode: z
          .enum(MANDATE_MODES)
          .describe(
            "AUTO (default) = buy automatically inside the mandate. ASK_FIRST only if the user asked to approve before buying.",
          ),
      }),
      execute: async ({ maxPrice, variant, expiresInDays, mode }): Promise<DraftMandateOutput> => {
        const dims = ctx.product?.variants ?? (await listVariants(watchedId));
        const { selection, problems } = resolveSelection(dims, toSelection(variant));
        if (problems.length > 0) return { status: "needs_info", problems };

        const notes: string[] = [];
        const missing = dims
          .filter((d) => d.values.filter((v) => v.exists).length > 1)
          .filter((d) => !selection[d.name])
          .map((d) => d.name);
        if (missing.length > 0) {
          notes.push(
            `No ${missing.join("/")} chosen — DropCart will watch the default variant unless the user picks one.`,
          );
        }

        const live = await getProduct(watchedId, selection);
        const priceNow = live?.price ?? null;
        const wouldBuyNow = priceNow != null && maxPrice >= priceNow;
        if (wouldBuyNow) {
          notes.push(
            `The limit is at or above today's price ($${priceNow}). DropCart will ask before buying instead of buying immediately.`,
          );
        }
        if (live && !live.inStock) notes.push("That variant is out of stock right now.");

        return {
          status: "drafted",
          draft: { maxPrice: Math.round(maxPrice * 100) / 100, variant: selection, expiresInDays, mode },
          priceNow,
          inStockNow: live?.inStock ?? false,
          wouldBuyNow,
          notes,
        };
      },
    }),

    // Editing reuses draft_mandate: the form PATCHes the watch instead of
    // creating one (see components/ChatWorkspace.tsx, editing mode).
  };
}

export type AgentTools = ReturnType<typeof buildAgentTools>;

export function systemPrompt(ctx: AgentContext): string {
  const p = ctx.product;
  const variants = p ? compactVariants(p.variants) : [];
  return [
    "You are DropCart's shopping agent. You help the user set up a price watch (a 'mandate') for one product.",
    "",
    "HARD RULES",
    "- You never buy, pay, charge, refund or approve anything. You cannot. Payments only happen on the server, inside a mandate the user confirmed, after a price check passes the guard.",
    "- Never say a purchase happened or will definitely happen. Say DropCart will buy only if the price drops to the limit, the variant matches and it's in stock.",
    "- Don't guess. If the product has variants and the user hasn't picked one, ask. If they haven't given a max price, ask.",
    "- When you know the max price (and the variant, if needed), call draft_mandate. Then tell the user, in one or two sentences, to check the form and press Confirm.",
    "- Variant values must come from the product's options below or from list_variants.",
    "- mode is AUTO unless the user says they want to approve each purchase first (then ASK_FIRST). expiresInDays is 30 unless the user says otherwise.",
    "- Each watch reserves its max price from the user's DropCart Budget. If the max price the user wants is more than the free budget, still draft it, but tell them only the free amount fits and they can lower the limit or top up their budget on the wishlist page.",
    "- Prices are USD. Reply in plain text: one to three short sentences, no markdown, no bullet lists, no tables.",
    "",
    "THE PRODUCT BEING WATCHED",
    `- id: ${ctx.likedItem.channel3ProductId}`,
    `- title: ${ctx.likedItem.title}`,
    p
      ? `- price today: $${p.price} (${p.inStock ? "in stock" : "out of stock"}) at ${p.merchantDomain ?? "unknown store"}`
      : "- Channel3 currently has no offer for this product.",
    p && Object.keys(p.selected).length > 0
      ? `- currently shown variant: ${JSON.stringify(p.selected)}`
      : "",
    variants.length > 0 ? `- variant options: ${JSON.stringify(variants)}` : "- no variants",
    `- today is ${new Date().toISOString().slice(0, 10)}`,
    ctx.budgetFree != null ? `- DropCart Budget free for this mandate: $${Math.max(0, ctx.budgetFree).toFixed(2)}` : "",
    ...(ctx.currentMandate
      ? [
          "",
          "EDITING AN EXISTING WATCH",
          `- current mandate: max $${ctx.currentMandate.maxPrice}, variant ${ctx.currentMandate.variant ?? "default"}, mode ${ctx.currentMandate.mode}, expires ${ctx.currentMandate.expiresAt.toISOString().slice(0, 10)}, status ${ctx.currentMandate.status}`,
          "- The user is changing this watch. Call draft_mandate with the FULL updated mandate: copy every field they didn't mention from the current mandate (expiresInDays = days left until the current expiry unless they change it).",
          "- Then tell them to check the form and press Save changes. Raising the limit to or above today's price means DropCart will ask before buying.",
        ]
      : []),
  ]
    .filter(Boolean)
    .join("\n");
}
