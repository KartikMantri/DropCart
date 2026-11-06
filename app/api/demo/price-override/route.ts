import { NextResponse } from "next/server";
import { z } from "zod";
import { getApiUser } from "@/lib/auth";
import { Channel3Unavailable } from "@/lib/channel3";
import { CheckError, checkNow } from "@/lib/checks";
import { isDemoMode } from "@/lib/env";

const bodySchema = z.object({ watchId: z.string().min(1), price: z.number().positive().max(100_000) });

/**
 * Demo mode only: pretend the live price is `price` and run a check now, so
 * the drop → guard → PayPal capture → receipt flow can be shown on demand.
 * Stock and variant stay real; the check is stored with isDemo = true and the
 * guard still applies every rule.
 */
export async function POST(req: Request) {
  if (!isDemoMode()) return NextResponse.json({ error: "Demo mode is off." }, { status: 403 });
  const user = await getApiUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Enter a price in dollars." }, { status: 400 });

  try {
    const r = await checkNow(user.id, parsed.data.watchId, parsed.data.price);
    return NextResponse.json(r.result);
  } catch (err) {
    if (err instanceof CheckError) return NextResponse.json({ error: err.message }, { status: err.status });
    if (err instanceof Channel3Unavailable) {
      return NextResponse.json({ error: "Couldn't reach the catalogue. Try again." }, { status: 502 });
    }
    throw err;
  }
}
