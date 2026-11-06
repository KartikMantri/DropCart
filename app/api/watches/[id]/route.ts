import { NextResponse, type NextRequest } from "next/server";
import { getApiUser } from "@/lib/auth";
import { Channel3Unavailable } from "@/lib/channel3";
import { editMandateSchema } from "@/lib/mandate";
import { editWatch, WatchError } from "@/lib/watches";

/** Edit a watch's mandate (the user confirmed the form, possibly agent-filled). */
export async function PATCH(req: NextRequest, ctx: RouteContext<"/api/watches/[id]">) {
  const user = await getApiUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { id } = await ctx.params;

  const parsed = editMandateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Check the form: max price, expiry (1–90 days) and mode are required." },
      { status: 400 },
    );
  }
  try {
    return NextResponse.json(await editWatch(user.id, id, parsed.data));
  } catch (err) {
    if (err instanceof WatchError) return NextResponse.json({ error: err.message }, { status: err.status });
    if (err instanceof Channel3Unavailable) {
      return NextResponse.json({ error: "Couldn't reach the catalogue to confirm today's price. Try again." }, { status: 502 });
    }
    throw err;
  }
}
