import { NextResponse } from "next/server";
import { getDb, hasDatabase } from "@/lib/db";
import { isDemoMode } from "@/lib/env";

/** Public liveness check for the deploy: app up, database reachable. No secrets. */
export async function GET() {
  let database = "not configured";
  if (hasDatabase()) {
    try {
      await getDb().$queryRaw`SELECT 1`;
      database = "ok";
    } catch {
      database = "unreachable";
    }
  }
  const ok = database === "ok";
  return NextResponse.json(
    { ok, database, demoMode: isDemoMode(), paypal: "sandbox" },
    { status: ok ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}
