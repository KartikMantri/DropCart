import { describe, expect, it } from "vitest";
import { daysLeft, planEdit } from "@/lib/mandate";
import { isCronAuthorized } from "@/lib/cron";

const NOW = new Date("2026-11-10T12:00:00Z");
const DAY = 86_400_000;
const current = {
  maxPrice: 159,
  mode: "AUTO" as const,
  expiresAt: new Date(NOW.getTime() + 20 * DAY),
  variant: "color=black",
  limitJustRaised: false,
};
const same = { maxPrice: 159, mode: "AUTO" as const, expiresInDays: 20, variant: "color=black" };

describe("planEdit", () => {
  it("no change is no change (expiry recomputed from days left)", () => {
    expect(planEdit(current, same, 189, NOW).changed).toEqual([]);
  });

  it("raising above today's price asks before buying and needs budget", () => {
    const p = planEdit(current, { ...same, maxPrice: 199 }, 189, NOW);
    expect(p).toMatchObject({ changed: ["maxPrice"], limitJustRaised: true, needsMoreBudget: true });
  });

  it("raising but still under today's price buys automatically later", () => {
    expect(planEdit(current, { ...same, maxPrice: 179 }, 189, NOW)).toMatchObject({ limitJustRaised: false, needsMoreBudget: true });
  });

  it("lowering never needs budget and clears 'would buy now'", () => {
    const p = planEdit({ ...current, maxPrice: 199, limitJustRaised: true }, { ...same, maxPrice: 149 }, 189, NOW);
    expect(p).toMatchObject({ limitJustRaised: false, needsMoreBudget: false });
  });

  it("changing variant at or above the new price asks first", () => {
    const p = planEdit({ ...current, maxPrice: 199 }, { ...same, maxPrice: 199, variant: "color=white" }, 189, NOW);
    expect(p).toMatchObject({ changed: ["variant"], limitJustRaised: true });
  });

  it("mode and expiry changes are reported", () => {
    const p = planEdit(current, { ...same, mode: "ASK_FIRST", expiresInDays: 45 }, 189, NOW);
    expect(p.changed).toEqual(["mode", "expiresAt"]);
    expect(p.expiresAt.toISOString()).toBe(new Date(NOW.getTime() + 45 * DAY).toISOString());
  });

  it("keeps an existing 'would buy now' when only the mode changes", () => {
    const p = planEdit({ ...current, maxPrice: 199, limitJustRaised: true }, { ...same, maxPrice: 199, mode: "ASK_FIRST" }, 189, NOW);
    expect(p.limitJustRaised).toBe(true);
  });

  it("unknown price never sets 'would buy now'", () => {
    expect(planEdit(current, { ...same, maxPrice: 999 }, null, NOW).limitJustRaised).toBe(false);
  });

  it("daysLeft is clamped to 1–90", () => {
    expect(daysLeft(new Date(NOW.getTime() + 20 * DAY), NOW)).toBe(20);
    expect(daysLeft(new Date(NOW.getTime() - DAY), NOW)).toBe(1);
    expect(daysLeft(new Date(NOW.getTime() + 400 * DAY), NOW)).toBe(90);
  });
});

describe("isCronAuthorized", () => {
  const secret = "0123456789abcdef0123";
  it("accepts the exact bearer secret", () => {
    expect(isCronAuthorized(`Bearer ${secret}`, secret)).toBe(true);
  });
  it("rejects wrong, missing, short or unconfigured secrets", () => {
    expect(isCronAuthorized(`Bearer ${secret}x`, secret)).toBe(false);
    expect(isCronAuthorized(secret, secret)).toBe(false);
    expect(isCronAuthorized(null, secret)).toBe(false);
    expect(isCronAuthorized("Bearer short", "short")).toBe(false);
    expect(isCronAuthorized("Bearer ", undefined)).toBe(false);
  });
});
