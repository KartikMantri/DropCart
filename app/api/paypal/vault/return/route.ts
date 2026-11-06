import { NextResponse, type NextRequest } from "next/server";
import { getApiUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { exchangeSetupToken, PaypalError } from "@/lib/paypal";
import { decodePending, VAULT_COOKIE, withParam } from "@/lib/vault";

/**
 * PayPal redirects here after the user approves the setup token
 * (?approval_token_id=<setup token id>). Exchange it for a payment token and
 * store only that token id on the user.
 */
export async function GET(req: NextRequest) {
  const user = await getApiUser();
  if (!user) return NextResponse.redirect(new URL("/login", req.url), 303);

  const pending = decodePending(req.cookies.get(VAULT_COOKIE)?.value);
  const next = pending?.next ?? "/wishlist";
  const done = (status: string) => {
    const res = NextResponse.redirect(new URL(withParam(next, "paypal", status), req.url), 303);
    res.cookies.delete({ name: VAULT_COOKIE, path: "/api/paypal/vault" });
    return res;
  };

  const approved = req.nextUrl.searchParams.get("approval_token_id");
  if (!pending || !approved || approved !== pending.setupTokenId) return done("error");

  try {
    const token = await exchangeSetupToken(pending.setupTokenId);
    await getDb().user.update({
      where: { id: user.id },
      data: { paypalVaultToken: token.paymentTokenId, paypalCustomerId: token.customerId },
    });
    return done("connected");
  } catch (err) {
    if (err instanceof PaypalError) {
      console.error("[paypal] vault return", err.message, err.debugId);
      return done("error");
    }
    throw err;
  }
}
