import { NextResponse, type NextRequest } from "next/server";
import { getApiUser } from "@/lib/auth";
import { PaypalError } from "@/lib/paypal";
import { RefundError, refundPurchase } from "@/lib/purchase";

/** "Undo": full PayPal refund of a purchase. Idempotent per purchase. */
export async function POST(_req: NextRequest, ctx: RouteContext<"/api/purchases/[id]/refund">) {
  const user = await getApiUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { id } = await ctx.params;
  try {
    return NextResponse.json(await refundPurchase(user.id, id));
  } catch (err) {
    if (err instanceof RefundError) return NextResponse.json({ error: err.message }, { status: err.status });
    if (err instanceof PaypalError) {
      console.error("[paypal] refund", err.message, err.debugId);
      return NextResponse.json({ error: "PayPal couldn't process the refund. Try again." }, { status: 502 });
    }
    throw err;
  }
}
