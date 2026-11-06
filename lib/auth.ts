import "server-only";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { getDb, hasDatabase } from "./db";
import { getSupabase, hasSupabase } from "./supabase";

export type SessionUser = { id: string; email: string };

/** Current signed-in user, or null. Verifies the JWT with Supabase. */
export async function getSessionUser(): Promise<SessionUser | null> {
  // Always request-time: a session must never be baked into a static page.
  await connection();
  if (!hasSupabase()) return null;
  const supabase = await getSupabase();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user?.email) return null;
  return { id: data.user.id, email: data.user.email };
}

/**
 * Signed-in user for pages and route handlers; redirects to /login otherwise.
 * Ensures the matching app `User` row exists (Supabase id = User.id).
 */
export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (hasDatabase()) {
    await getDb().user.upsert({
      where: { id: user.id },
      create: { id: user.id, email: user.email },
      update: {},
    });
  }
  return user;
}

/** Same as requireUser but for API routes: returns null instead of redirecting. */
export async function getApiUser(): Promise<SessionUser | null> {
  const user = await getSessionUser();
  if (!user) return null;
  if (hasDatabase()) {
    await getDb().user.upsert({
      where: { id: user.id },
      create: { id: user.id, email: user.email },
      update: {},
    });
  }
  return user;
}
