import { describe, expect, it } from "vitest";
import { decodePending, encodePending, safeNext, withParam } from "@/lib/vault";

describe("vault helpers", () => {
  it("safeNext only allows same-site relative paths", () => {
    expect(safeNext("/chat/abc")).toBe("/chat/abc");
    expect(safeNext("//evil.com")).toBe("/wishlist");
    expect(safeNext("https://evil.com")).toBe("/wishlist");
    expect(safeNext("/\\evil.com")).toBe("/wishlist");
    expect(safeNext(null)).toBe("/wishlist");
  });

  it("withParam adds or replaces a query parameter", () => {
    expect(withParam("/wishlist", "paypal", "connected")).toBe("/wishlist?paypal=connected");
    expect(withParam("/wishlist?paypal=error&x=1", "paypal", "connected")).toBe("/wishlist?paypal=connected&x=1");
  });

  it("round-trips the pending cookie and rejects junk", () => {
    expect(decodePending(encodePending("TOK", "/chat/1"))).toEqual({ setupTokenId: "TOK", next: "/chat/1" });
    expect(decodePending(encodePending("TOK", "//evil"))).toEqual({ setupTokenId: "TOK", next: "/wishlist" });
    expect(decodePending(undefined)).toBeNull();
    expect(decodePending("not json")).toBeNull();
    expect(decodePending(JSON.stringify({ n: "/x" }))).toBeNull();
  });
});
