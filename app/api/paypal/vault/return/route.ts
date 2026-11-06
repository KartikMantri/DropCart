import { NextResponse, type NextRequest } from "next/server";
import { getApiUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { exchangeSetupToken, PaypalError } from "@/lib/paypal";
import { decodePending, VAULT_COOKIE, withParam } from "@/lib/vault";

/**
 * PayPal redirects here after the user approves the setup token
 * (?approval_token_id=<setup token id>). Exchange it for a payment token and
 * store only that token id on the user.
 *
 * Safe to load twice (PayPal or the browser can repeat the redirect, and
 * users reload): the pending cookie is kept after success, and the exchange
 * is idempotent per setup token (PayPal-Request-Id vault:<id>), so a repeat
 * returns the same payment token instead of an error. The cookie expires on
 * its own after 30 minutes.
 */
export async function GET(req: NextRequest) {
  const user = await getApiUser();
  if (!user) return NextResponse.redirect(new URL("/login", req.url), 303);

  const pending = decodePending(req.cookies.get(VAULT_COOKIE)?.value);
  const next = pending?.next ?? "/wishlist";
  const go = (status: string, clearCookie: boolean) => {
    const res = NextResponse.redirect(new URL(withParam(next, "paypal", status), req.url), 303);
    if (clearCookie) res.cookies.delete({ name: VAULT_COOKIE, path: "/api/paypal/vault" });
    return res;
  };

  const approved = req.nextUrl.searchParams.get("approval_token_id");
  if (!pending || !approved || approved !== pending.setupTokenId) {
    // A repeat after the cookie is gone: if this user is already connected,
    // say so rather than showing an error for a connection that worked.
    if (approved) {
      const u = await getDb().user.findUnique({ where: { id: user.id }, select: { paypalVaultToken: true } });
      if (u?.paypalVaultToken) return go("connected", false);
    }
    return go("error", true);
  }

  try {
    const token = await exchangeSetupToken(pending.setupTokenId);
    await getDb().user.update({
      where: { id: user.id },
      data: { paypalVaultToken: token.paymentTokenId, paypalCustomerId: token.customerId },
    });
    return go("connected", false);
  } catch (err) {
    if (err instanceof PaypalError) {
      console.error("[paypal] vault return", err.message, err.debugId);
      return go("error", true);
    }
    throw err;
  }
}
