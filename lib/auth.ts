import "server-only";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { getDb, hasDatabase } from "./db";
import { getSupabase, hasSupabase } from "./supabase";

export type SessionUser = { id: string; email: string };

/**
 * Current signed-in user, or null.
 * getClaims() verifies the access token's signature (locally, against the
 * project's published signing keys) and refreshes an expired session — so no
 * Auth-server round trip on every request.
 */
export async function getSessionUser(): Promise<SessionUser | null> {
  // Always request-time: a session must never be baked into a static page.
  await connection();
  if (!hasSupabase()) return null;
  const supabase = await getSupabase();
  const { data, error } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (error || !claims?.sub || typeof claims.email !== "string" || !claims.email) return null;
  return { id: claims.sub, email: claims.email };
}

// User ids whose app `User` row is known to exist in this server process.
const knownUsers = new Set<string>();

/** Ensure the app `User` row exists (Supabase id = User.id). Once per process per user. */
async function ensureUserRow(user: SessionUser): Promise<void> {
  if (!hasDatabase() || knownUsers.has(user.id)) return;
  await getDb().user.upsert({
    where: { id: user.id },
    create: { id: user.id, email: user.email },
    update: {},
  });
  knownUsers.add(user.id);
}

/** Signed-in user for pages; redirects to /login otherwise. */
export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  await ensureUserRow(user);
  return user;
}

/** Same as requireUser but for API routes: returns null instead of redirecting. */
export async function getApiUser(): Promise<SessionUser | null> {
  const user = await getSessionUser();
  if (!user) return null;
  await ensureUserRow(user);
  return user;
}
