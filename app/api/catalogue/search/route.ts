import { NextResponse, type NextRequest } from "next/server";
import { getApiUser } from "@/lib/auth";
import { Channel3Unavailable, searchProducts } from "@/lib/channel3";

/** Channel3 search, called on submit only. Cached 1h per normalised query. */
export async function GET(req: NextRequest) {
  const user = await getApiUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const q = (req.nextUrl.searchParams.get("q") ?? "").slice(0, 200);
  if (q.trim().length < 2) {
    return NextResponse.json({ error: "Query must be at least 2 characters" }, { status: 400 });
  }
  try {
    const { products, fetchedAt, fromCache } = await searchProducts(q);
    return NextResponse.json({ query: q, products, fetchedAt, fromCache });
  } catch (err) {
    if (err instanceof Channel3Unavailable) {
      return NextResponse.json({ error: "Catalogue unavailable" }, { status: 502 });
    }
    throw err;
  }
}
