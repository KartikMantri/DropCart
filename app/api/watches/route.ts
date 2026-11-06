import { NextResponse } from "next/server";
import { getApiUser } from "@/lib/auth";
import { Channel3Unavailable } from "@/lib/channel3";
import { confirmMandateSchema } from "@/lib/mandate";
import { createWatch, WatchError } from "@/lib/watches";

/** Create a watch from a mandate the user confirmed in the form. */
export async function POST(req: Request) {
  const user = await getApiUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const parsed = confirmMandateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Check the form: max price, expiry (1–90 days) and mode are required." },
      { status: 400 },
    );
  }

  try {
    const result = await createWatch(user.id, parsed.data);
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    if (err instanceof WatchError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    if (err instanceof Channel3Unavailable) {
      return NextResponse.json(
        { error: "Couldn't reach the catalogue to confirm today's price. Try again." },
        { status: 502 },
      );
    }
    throw err;
  }
}
