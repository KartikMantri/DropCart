import { describe, expect, it } from "vitest";
import { evaluate, type GuardInput, type GuardRule } from "@/lib/guard";

const NOW = new Date("2026-11-08T12:00:00Z");

/** The demo scenario: Sony XM5, black, limit $280, live price $269 in stock. */
function base(): GuardInput {
  return {
    watch: { status: "ACTIVE", productId: "xm5", variant: "Color=Black", limitJustRaised: false },
    mandate: {
      maxPrice: 280,
      currency: "USD",
      expiresAt: new Date("2026-12-08T12:00:00Z"),
      mode: "AUTO",
      allowedMerchants: [],
    },
    live: {
      productId: "xm5",
      variant: "Color=Black",
      price: 269,
      currency: "USD",
      inStock: true,
      merchantDomain: "bestbuy.com",
    },
    monthSpend: 0,
    monthlyBudget: 500,
    now: NOW,
  };
}

type Patch = {
  watch?: Partial<GuardInput["watch"]>;
  mandate?: Partial<GuardInput["mandate"]>;
  live?: Partial<NonNullable<GuardInput["live"]>> | null;
  monthSpend?: number;
  monthlyBudget?: number;
  now?: Date;
};

function run(patch: Patch = {}) {
  const b = base();
  return evaluate({
    watch: { ...b.watch, ...patch.watch },
    mandate: { ...b.mandate, ...patch.mandate },
    live: patch.live === null ? null : { ...b.live!, ...patch.live },
    monthSpend: patch.monthSpend ?? b.monthSpend,
    monthlyBudget: patch.monthlyBudget ?? b.monthlyBudget,
    now: patch.now ?? b.now,
  });
}

const expectRule = (patch: Patch, decision: string, rule: GuardRule) => {
  const res = run(patch);
  expect(res.decision).toBe(decision);
  expect(res.rule).toBe(rule);
  expect(res.reason.length).toBeGreaterThan(0);
};

describe("guard: BUY", () => {
  it("main demo: $269 in stock, black, limit $280 → BUY", () => {
    expectRule({}, "BUY", "within_mandate");
  });
  it("price exactly at the limit is allowed", () => {
    expectRule({ live: { price: 280 } }, "BUY", "within_mandate");
  });
  it("spend exactly reaching the budget is allowed", () => {
    expectRule({ monthSpend: 231 }, "BUY", "within_mandate");
  });
  it("variant comparison is case-insensitive", () => {
    expectRule({ live: { variant: "color=black" } }, "BUY", "within_mandate");
  });
  it("no-variant products match when both are null", () => {
    expectRule({ watch: { variant: null }, live: { variant: null } }, "BUY", "within_mandate");
  });
  it("allowed merchant list matches case-insensitively", () => {
    expectRule({ mandate: { allowedMerchants: ["BestBuy.com"] } }, "BUY", "within_mandate");
  });
  it("expiry exactly now is still valid", () => {
    expectRule({ mandate: { expiresAt: NOW } }, "BUY", "within_mandate");
  });
});

describe("guard: SKIP / EXPIRE / ASK rules", () => {
  it.each(["PAUSED", "AWAITING_APPROVAL", "PURCHASING", "BOUGHT", "REFUNDED", "EXPIRED", "CANCELLED"])(
    "status %s → SKIP inactive",
    (status) => expectRule({ watch: { status } }, "SKIP", "inactive"),
  );

  it("A9: expiry passed → EXPIRE", () => {
    expectRule({ mandate: { expiresAt: new Date(NOW.getTime() - 1) } }, "EXPIRE", "expired");
  });

  it("product no longer on Channel3 → SKIP unavailable", () => {
    expectRule({ live: null }, "SKIP", "unavailable");
  });

  it("different product id → SKIP mismatch", () => {
    expectRule({ live: { productId: "other" } }, "SKIP", "mismatch");
  });

  it("A2: only another variant is on sale → SKIP variant", () => {
    expectRule({ live: { variant: "Color=White" } }, "SKIP", "variant");
  });
  it("watched variant but Channel3 resolved none → SKIP variant", () => {
    expectRule({ live: { variant: null } }, "SKIP", "variant");
  });
  it("no watched variant but Channel3 now resolves one → SKIP variant", () => {
    expectRule({ watch: { variant: null } }, "SKIP", "variant");
  });

  it("non-USD price → SKIP currency", () => {
    expectRule({ live: { currency: "EUR" } }, "SKIP", "currency");
  });

  it("store outside allowed merchants → SKIP merchant", () => {
    expectRule({ mandate: { allowedMerchants: ["amazon.com"] } }, "SKIP", "merchant");
  });
  it("unknown store with a merchant list → SKIP merchant", () => {
    expectRule(
      { mandate: { allowedMerchants: ["amazon.com"] }, live: { merchantDomain: null } },
      "SKIP",
      "merchant",
    );
  });

  it("A3: price right but out of stock → SKIP stock", () => {
    expectRule({ live: { inStock: false } }, "SKIP", "stock");
  });

  it("A1: $285 above limit → SKIP price", () => {
    expectRule({ live: { price: 285 } }, "SKIP", "price");
  });
  it("one cent over the limit → SKIP price", () => {
    expectRule({ live: { price: 280.01 } }, "SKIP", "price");
  });
  it("no price → SKIP price", () => {
    expectRule({ live: { price: null } }, "SKIP", "price");
  });

  it("A4: inside mandate but over monthly budget → ASK budget", () => {
    expectRule({ monthSpend: 300 }, "ASK", "budget");
  });

  it("ASK_FIRST mode → ASK mode", () => {
    expectRule({ mandate: { mode: "ASK_FIRST" } }, "ASK", "mode");
  });

  it("A5: limit just raised above today's price → ASK would_buy_now", () => {
    expectRule({ watch: { limitJustRaised: true } }, "ASK", "would_buy_now");
  });
});

describe("guard: rule order (first match wins)", () => {
  it("inactive beats expired", () => {
    expectRule(
      { watch: { status: "PAUSED" }, mandate: { expiresAt: new Date(0) } },
      "SKIP",
      "inactive",
    );
  });
  it("expired beats everything about the live offer", () => {
    expectRule({ mandate: { expiresAt: new Date(0) }, live: null }, "EXPIRE", "expired");
  });
  it("variant beats stock and price", () => {
    expectRule(
      { live: { variant: "Color=White", inStock: false, price: 999 } },
      "SKIP",
      "variant",
    );
  });
  it("stock beats price", () => {
    expectRule({ live: { inStock: false, price: 999 } }, "SKIP", "stock");
  });
  it("price beats budget: never ASK about something over the limit", () => {
    expectRule({ live: { price: 300 }, monthSpend: 1000 }, "SKIP", "price");
  });
  it("budget beats mode and limitJustRaised", () => {
    expectRule(
      { monthSpend: 400, mandate: { mode: "ASK_FIRST" }, watch: { limitJustRaised: true } },
      "ASK",
      "budget",
    );
  });
  it("mode beats limitJustRaised", () => {
    expectRule({ mandate: { mode: "ASK_FIRST" }, watch: { limitJustRaised: true } }, "ASK", "mode");
  });
});

describe("guard: A10 re-check before charge", () => {
  it("BUY on the scheduled check, but the re-check sees a higher price → SKIP", () => {
    expect(run({}).decision).toBe("BUY");
    expect(run({ live: { price: 289 } }).decision).toBe("SKIP");
  });
});

describe("guard: purity", () => {
  it("returns identical results for identical input and does not mutate it", () => {
    const input = base();
    const snapshot = JSON.stringify(input);
    expect(evaluate(input)).toEqual(evaluate(input));
    expect(JSON.stringify(input)).toBe(snapshot);
  });
});
