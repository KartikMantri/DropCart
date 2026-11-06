import { NextResponse } from "next/server";
import { runScheduledChecks } from "@/lib/checks";
import { isCronAuthorized } from "@/lib/cron";

// Each watch is a Channel3 quote plus, rarely, a PayPal capture.
export const maxDuration = 60;

/**
 * The scheduler (GitHub Actions, every 6 hours) calls this with
 * `Authorization: Bearer $CRON_SECRET`. Public in proxy.ts; the secret is the
 * only gate, so it's compared in constant time and must be ≥16 characters.
 */
export async function POST(req: Request) {
  if (!isCronAuthorized(req.headers.get("authorization"), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const started = Date.now();
  const summary = await runScheduledChecks();
  console.log("[cron] checks", { ...summary, ms: Date.now() - started });
  return NextResponse.json({ ...summary, ms: Date.now() - started });
}
