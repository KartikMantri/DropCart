import { describe, expect, it } from "vitest";
import { canReserve, checkNewBudget, summarize } from "@/lib/budget";

describe("DropCart Budget", () => {
  it("available = budget − spent − reserved, cents-safe", () => {
    expect(summarize(500, 26, 350)).toEqual({ budget: 500, spent: 26, reserved: 350, available: 124 });
    expect(summarize(0.3, 0.1, 0.2).available).toBe(0);
  });

  it("the user's example: $29 and $350 fit in $500, then $200 doesn't", () => {
    const after29 = summarize(500, 0, 29);
    expect(canReserve(summarize(500, 0, 0), 29)).toEqual({ ok: true });
    expect(canReserve(after29, 350)).toEqual({ ok: true });
    const res = canReserve(summarize(500, 0, 379), 200);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.shortBy).toBe(79);
      expect(res.message).toContain("Only $121.00 of your $500.00 DropCart Budget is free");
      expect(res.message).toContain("top up");
    }
  });

  it("exactly the available amount fits", () => {
    expect(canReserve(summarize(500, 0, 379), 121)).toEqual({ ok: true });
  });

  it("buying under the limit returns the difference to available", () => {
    // Watch reserved $29, bought for $26: reservation gone, $26 spent.
    expect(summarize(500, 26, 350).available - summarize(500, 0, 379).available).toBe(3);
  });

  it("a refund frees its amount again", () => {
    expect(summarize(500, 0, 350).available).toBe(150);
  });

  it("never reports negative free money in the message", () => {
    const res = canReserve(summarize(100, 80, 50), 10);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.message).toContain("Only $0.00");
  });

  it("budget can be topped up, or lowered down to spent + reserved but not below", () => {
    const s = summarize(500, 26, 350);
    expect(checkNewBudget(s, 1000)).toEqual({ ok: true });
    expect(checkNewBudget(s, 376)).toEqual({ ok: true });
    const low = checkNewBudget(s, 375.99);
    expect(low.ok).toBe(false);
    if (!low.ok) expect(low.message).toContain("can't go below $376.00");
  });

  it("rejects zero, negative, NaN and over-max budgets", () => {
    const s = summarize(500, 0, 0);
    for (const v of [0, -5, Number.NaN, 10_001]) expect(checkNewBudget(s, v).ok).toBe(false);
  });
});
