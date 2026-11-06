import type { Metadata } from "next";
import { hasSupabase } from "@/lib/supabase";
import { DEMO_EMAIL, DEMO_PASSWORD } from "@/lib/demo-account";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in — DropCart" };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const params = await searchParams;
  const rawNext = typeof params.next === "string" ? params.next : "/";
  const next = rawNext.startsWith("/") && !rawNext.startsWith("//") ? rawNext : "/";
  const configured = hasSupabase();

  return (
    <main className="flex flex-1 items-center justify-center px-4 py-12">
      <div className="grid w-full max-w-5xl grid-cols-1 gap-8 md:grid-cols-12">
        <section className="md:col-span-7 flex flex-col justify-center gap-6">
          <p className="nb-chip bg-yellow self-start">PayPal sandbox · no real money</p>
          <h1 className="text-5xl font-bold uppercase leading-[0.95] tracking-tight md:text-7xl">
            Drop<span className="bg-yellow px-2 border-[3px] border-ink">Cart</span>
          </h1>
          <p className="max-w-md text-xl font-medium">
            Like it now. Tell the agent your price. Approve PayPal once.
            DropCart buys it when the price drops — and never outside your mandate.
          </p>
          <ul className="flex flex-wrap gap-3 font-mono text-sm font-bold">
            <li className="nb-chip bg-pink">♥ Like</li>
            <li className="nb-chip bg-blue">Agent sets limit</li>
            <li className="nb-chip bg-yellow">Tracking</li>
            <li className="nb-chip bg-green">Bought</li>
          </ul>
        </section>

        <section className="nb-card md:col-span-5 p-6 md:p-8">
          <h2 className="mb-6 border-b-[3px] border-ink pb-3 text-2xl font-bold uppercase">
            Sign in
          </h2>
          {!configured && (
            <p className="mb-5 border-[3px] border-ink bg-red px-3 py-2 font-bold">
              Auth isn&apos;t configured. Set NEXT_PUBLIC_SUPABASE_URL and
              NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local.
            </p>
          )}
          <LoginForm next={next} demoEmail={DEMO_EMAIL} demoPassword={DEMO_PASSWORD} />
          <div className="mt-6 border-t-[3px] border-ink pt-4 font-mono text-sm">
            <p className="font-bold uppercase">Demo login</p>
            <p>{DEMO_EMAIL}</p>
            <p>{DEMO_PASSWORD}</p>
          </div>
        </section>
      </div>
    </main>
  );
}
