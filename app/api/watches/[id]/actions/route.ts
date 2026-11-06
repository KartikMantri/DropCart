import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getApiUser } from "@/lib/auth";
import { Channel3Unavailable } from "@/lib/channel3";
import { approveWatch, CheckError, checkNow, setWatchState } from "@/lib/checks";
import { isDemoMode } from "@/lib/env";

const bodySchema = z.object({ action: z.enum(["check", "approve", "decline", "pause", "resume", "cancel"]) });

/**
 * One endpoint for the buttons on a watch:
 *   approve  "Buy it" on an ASK (runs the guard again, then PayPal)
 *   decline  "Not now" (back to watching)
 *   pause / resume / cancel
 *   check    "Check now" (demo mode only)
 */
export async function POST(req: NextRequest, ctx: RouteContext<"/api/watches/[id]/actions">) {
  const user = await getApiUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { id } = await ctx.params;

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  const { action } = parsed.data;

  try {
    if (action === "check") {
      if (!isDemoMode()) return NextResponse.json({ error: "Check now is only available in demo mode." }, { status: 403 });
      const r = await checkNow(user.id, id);
      return NextResponse.json(r.result);
    }
    if (action === "approve") {
      const r = await approveWatch(user.id, id);
      return NextResponse.json(r.result);
    }
    return NextResponse.json(await setWatchState(user.id, id, action));
  } catch (err) {
    if (err instanceof CheckError) return NextResponse.json({ error: err.message }, { status: err.status });
    if (err instanceof Channel3Unavailable) {
      return NextResponse.json({ error: "Couldn't reach the catalogue for a live price. Try again." }, { status: 502 });
    }
    throw err;
  }
}
