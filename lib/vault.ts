import "server-only";

/**
 * Helpers for the PayPal Vault consent round trip
 * (app/api/paypal/vault/start → PayPal → app/api/paypal/vault/return).
 *
 * The pending setup token id is kept in a short-lived httpOnly cookie, so the
 * return route only accepts the token *this browser* started — someone else's
 * approved setup token can't be attached to your account.
 */

export const VAULT_COOKIE = "dc_vault";
export const VAULT_COOKIE_MAX_AGE = 30 * 60; // seconds; PayPal approval is quick

/** Only same-site relative paths, so `next` can't become an open redirect. */
export function safeNext(next: unknown, fallback = "/wishlist"): string {
  if (typeof next !== "string" || !next.startsWith("/") || next.startsWith("//") || next.includes("\\")) {
    return fallback;
  }
  return next;
}

export function withParam(path: string, key: string, value: string): string {
  const url = new URL(path, "http://x");
  url.searchParams.set(key, value);
  return url.pathname + url.search;
}

export const encodePending = (setupTokenId: string, next: string) =>
  JSON.stringify({ t: setupTokenId, n: next });

export function decodePending(raw: string | undefined): { setupTokenId: string; next: string } | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as { t?: unknown; n?: unknown };
    if (typeof v.t !== "string" || !v.t) return null;
    return { setupTokenId: v.t, next: safeNext(v.n) };
  } catch {
    return null;
  }
}
