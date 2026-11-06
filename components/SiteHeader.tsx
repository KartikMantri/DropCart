import Link from "next/link";
import { signOut } from "@/app/login/actions";

/**
 * Header: logo, catalogue search (submits to /search — Channel3 is only
 * called on submit, never per keystroke), wishlist link, sign out.
 */
export function SiteHeader({ email, query = "" }: { email: string; query?: string }) {
  return (
    <header className="border-b-[3px] border-ink bg-card">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-4 px-4 py-4 md:flex-nowrap md:gap-6">
        <Link href="/" className="shrink-0 text-2xl font-bold uppercase tracking-tight">
          Drop<span className="border-[3px] border-ink bg-yellow px-1">Cart</span>
        </Link>

        <form action="/search" className="order-3 flex w-full gap-3 md:order-none md:flex-1" role="search">
          <input
            name="q"
            defaultValue={query}
            minLength={2}
            required
            className="nb-input"
            placeholder="Search the Channel3 catalogue…"
            aria-label="Search products"
          />
          <button className="nb-btn" type="submit">
            Search
          </button>
        </form>

        <nav className="ml-auto flex items-center gap-3">
          <Link href="/wishlist" className="nb-btn nb-btn-white">
            <span aria-hidden className="text-pink">♥</span> Wishlist
          </Link>
          <form action={signOut}>
            <button className="nb-btn nb-btn-white" type="submit" title={`Signed in as ${email}`}>
              Sign out
            </button>
          </form>
        </nav>
      </div>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="mt-auto border-t-[3px] border-ink bg-yellow">
      <p className="mx-auto max-w-7xl px-4 py-3 font-mono text-sm font-bold uppercase">
        Sandbox only — no real money
      </p>
    </footer>
  );
}
