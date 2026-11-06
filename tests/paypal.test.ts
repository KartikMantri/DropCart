import { describe, expect, it } from "vitest";
import { chargeVaultedPayment } from "@/lib/paypal";

const base = { vaultId: "v", currency: "USD", requestId: "r", description: "d", referenceId: "w" };

describe("chargeVaultedPayment hard cap", () => {
  // Rejected before any PayPal client is created, so no credentials needed.
  it("refuses an amount over the mandate limit", async () => {
    await expect(chargeVaultedPayment({ ...base, amount: 29.01, maxAmount: 29 })).rejects.toMatchObject({ issue: "OVER_MANDATE" });
  });
  it("refuses zero and negative amounts", async () => {
    await expect(chargeVaultedPayment({ ...base, amount: 0, maxAmount: 29 })).rejects.toMatchObject({ issue: "OVER_MANDATE" });
    await expect(chargeVaultedPayment({ ...base, amount: -1, maxAmount: 29 })).rejects.toMatchObject({ issue: "OVER_MANDATE" });
  });
});
