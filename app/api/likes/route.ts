import { NextResponse } from "next/server";
import { z } from "zod";
import { getApiUser } from "@/lib/auth";
import { Channel3Unavailable } from "@/lib/channel3";
import { LikeError, likeProduct, unlikeProduct } from "@/lib/likes";

const bodySchema = z.object({ productId: z.string().min(1).max(64) });

async function handle(req: Request, action: "like" | "unlike") {
  const user = await getApiUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "productId is required" }, { status: 400 });
  }

  try {
    if (action === "like") {
      const item = await likeProduct(user.id, parsed.data.productId);
      return NextResponse.json({ liked: true, likedItemId: item.id });
    }
    await unlikeProduct(user.id, parsed.data.productId);
    return NextResponse.json({ liked: false });
  } catch (err) {
    if (err instanceof LikeError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    if (err instanceof Channel3Unavailable) {
      return NextResponse.json(
        { error: "Couldn't reach the catalogue. Try again in a moment." },
        { status: 502 },
      );
    }
    throw err;
  }
}

export const POST = (req: Request) => handle(req, "like");
export const DELETE = (req: Request) => handle(req, "unlike");
