import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { signOut } from "./login/actions";

// Day 1 shell. Day 2 adds the FEATURED grid; Day 4 adds the WATCHING row.
export default async function Home() {
  const user = await requireUser();

  return (
    <>
      <header className="border-b-[3px] border-ink bg-card">
        <div className="mx-auto flex max-w-7xl items-center gap-6 px-4 py-4">
          <Link href="/" className="text-2xl font-bold uppercase tracking-tight">
            Drop<span className="bg-yellow px-1 border-[3px] border-ink">Cart</span>
          </Link>
          <form action="/search" className="flex flex-1 gap-3" role="search">
            <input
              name="q"
              className="nb-input"
              placeholder="Search the Channel3 catalogue…"
              aria-label="Search products"
            />
            <button className="nb-btn" type="submit">
              Search
            </button>
          </form>
          <form action={signOut} className="flex items-center gap-3">
            <span className="hidden font-mono text-sm md:inline">{user.email}</span>
            <button className="nb-btn nb-btn-white" type="submit">
              Sign out
            </button>
          </form>
        </div>
      </header>

      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-10">
        <h2 className="nb-section-title">Featured</h2>
        <div className="nb-card p-8">
          <p className="text-lg font-medium">
            Catalogue grid lands on Day 2. Signed in as{" "}
            <span className="font-mono font-bold">{user.email}</span>.
          </p>
        </div>
      </main>

      <footer className="border-t-[3px] border-ink bg-yellow">
        <p className="mx-auto max-w-7xl px-4 py-3 font-mono text-sm font-bold uppercase">
          Sandbox only — no real money
        </p>
      </footer>
    </>
  );
}
