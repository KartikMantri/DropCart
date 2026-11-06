import { NextResponse } from "next/server";
import { getApiUser } from "@/lib/auth";
import { Channel3Unavailable, getFeatured } from "@/lib/channel3";

/** ≤ 50 products from a few category searches, cached 24h in CatalogueCache. */
export async function GET() {
  const user = await getApiUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  try {
    const { products, fetchedAt, fromCache } = await getFeatured();
    return NextResponse.json({ products, fetchedAt, fromCache });
  } catch (err) {
    if (err instanceof Channel3Unavailable) {
      return NextResponse.json({ error: "Catalogue unavailable" }, { status: 502 });
    }
    throw err;
  }
}
