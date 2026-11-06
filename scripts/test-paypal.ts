/**
 * Day-3 sandbox smoke test for lib/paypal.ts. Never touches the database.
 *
 *   npm run test:paypal                  create a setup token, print approve link
 *   npm run test:paypal -- --saved       charge + refund the payment token the
 *                                        app saved via "Connect PayPal"
 *   npm run test:paypal -- <setupToken>  after approving: vault it, charge
 *                                        $1.00 twice with the same
 *                                        PayPal-Request-Id (must be one
 *                                        capture), then refund it
 *
 * Approve the link with a sandbox *personal* account
 * (developer.paypal.com → Testing tools → Sandbox accounts).
 */
import { config } from "dotenv";
config({ path: ".env.local" });
config();

async function main() {
  const paypal = await import("../lib/paypal");
  const setupTokenId = process.argv[2];

  if (!setupTokenId) {
    const t = await paypal.createVaultSetupToken({
      returnUrl: "http://localhost:3000/api/paypal/vault/return",
      cancelUrl: "http://localhost:3000/wishlist?paypal=cancelled",
      requestId: `smoke:${Date.now()}`,
    });
    console.log("setup token:", t.setupTokenId);
    console.log("approve at: ", t.approveUrl);
    console.log(`\nThen run: npm run test:paypal -- ${t.setupTokenId}`);
    return;
  }

  let token: { paymentTokenId: string; customerId: string | null };
  if (setupTokenId === "--saved") {
    const { getDb } = await import("../lib/db");
    const user = await getDb().user.findFirst({
      where: { paypalVaultToken: { not: null } },
      select: { paypalVaultToken: true, paypalCustomerId: true },
    });
    await getDb().$disconnect();
    if (!user?.paypalVaultToken) throw new Error('No saved PayPal token yet. Use "Connect PayPal" in the app first.');
    token = { paymentTokenId: user.paypalVaultToken, customerId: user.paypalCustomerId };
    console.log("using the token saved by the app");
  } else {
    token = await paypal.exchangeSetupToken(setupTokenId);
  }
  console.log("payment token:", token.paymentTokenId, "customer:", token.customerId);

  const requestId = `smoke:${setupTokenId}:${Date.now()}`;
  const charge = { vaultId: token.paymentTokenId, amount: 1, maxAmount: 1, currency: "USD", requestId, description: "DropCart smoke test", referenceId: "smoke" };
  const first = await paypal.chargeVaultedPayment(charge);
  console.log("charge #1:", first);
  const retry = await paypal.chargeVaultedPayment(charge);
  console.log("charge #2 (same request id):", retry);
  console.log(retry.captureId === first.captureId ? "✓ idempotent: one capture" : "✗ DOUBLE CHARGE");

  const refund = await paypal.refundCapture(first.captureId, `refund:${requestId}`);
  console.log("refund:", refund);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
