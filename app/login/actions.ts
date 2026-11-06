"use server";

import { redirect } from "next/navigation";
import { getSupabase, hasSupabase } from "@/lib/supabase";

export type LoginState = { error: string | null; email: string };

/** Only allow same-site relative redirects after login. */
function safeNext(next: FormDataEntryValue | null): string {
  const value = typeof next === "string" ? next : "";
  return value.startsWith("/") && !value.startsWith("//") ? value : "/";
}

export async function signIn(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (!hasSupabase()) {
    return { email, error: "Supabase isn't configured yet — see .env.example." };
  }
  if (!email || !password) {
    return { email, error: "Enter your email and password." };
  }

  const supabase = await getSupabase();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    return { email, error: error.message };
  }
  redirect(safeNext(formData.get("next")));
}

export async function signOut(): Promise<void> {
  if (hasSupabase()) {
    const supabase = await getSupabase();
    await supabase.auth.signOut();
  }
  redirect("/login");
}
