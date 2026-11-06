import { NextResponse, type NextRequest } from "next/server";
import { getApiUser } from "@/lib/auth";
import { createVaultSetupToken, PaypalError } from "@/lib/paypal";
import { encodePending, safeNext, VAULT_COOKIE, VAULT_COOKIE_MAX_AGE, withParam } from "@/lib/vault";

/**
 * "Connect PayPal" button (a plain form POST). Creates a Vault setup token and
 * sends the browser to PayPal to approve it. Nothing is charged here.
 */
export async function POST(req: NextRequest) {
  const form = await req.formData().catch(() => null);
  const next = safeNext(form?.get("next"));
  const user = await getApiUser();
  if (!user) return NextResponse.redirect(new URL("/login", req.url), 303);

  const origin = req.nextUrl.origin;
  try {
    const { setupTokenId, approveUrl } = await createVaultSetupToken({
      returnUrl: `${origin}/api/paypal/vault/return`,
      cancelUrl: `${origin}${withParam(next, "paypal", "cancelled")}`,
      requestId: `vault-start:${user.id}:${crypto.randomUUID()}`,
    });
    const res = NextResponse.redirect(approveUrl, 303);
    res.cookies.set(VAULT_COOKIE, encodePending(setupTokenId, next), {
      httpOnly: true,
      secure: req.nextUrl.protocol === "https:",
      sameSite: "lax", // sent on PayPal's top-level redirect back
      path: "/api/paypal/vault",
      maxAge: VAULT_COOKIE_MAX_AGE,
    });
    return res;
  } catch (err) {
    if (err instanceof PaypalError) {
      console.error("[paypal] vault start", err.message, err.debugId);
      return NextResponse.redirect(new URL(withParam(next, "paypal", "error"), req.url), 303);
    }
    throw err;
  }
}
