import Link from "next/link";
import { signOut } from "@/app/login/actions";
import { isDemoMode } from "@/lib/env";
import { unreadCount } from "@/lib/notifications";

/**
 * Header: logo, catalogue search (submits to /search — Channel3 is only
 * called on submit, never per keystroke), wishlist and notifications links,
 * sign out, and the red DEMO MODE badge when price overrides are enabled.
 */
export async function SiteHeader({ email, userId, query = "" }: { email: string; userId: string; query?: string }) {
  const unread = await unreadCount(userId).catch(() => 0);
  return (
    <header className="border-b-[3px] border-ink bg-card">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-4 px-4 py-4 md:flex-nowrap md:gap-6">
        <Link href="/" className="shrink-0 text-2xl font-bold uppercase tracking-tight">
          Drop<span className="border-[3px] border-ink bg-yellow px-1">Cart</span>
        </Link>
        {isDemoMode() && (
          <span className="nb-chip bg-red" title="Check now and price overrides are on. Demo price checks are marked in the history.">
            Demo mode
          </span>
        )}

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
          <Link
            href="/notifications"
            className="nb-btn nb-btn-white"
            aria-label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"}
          >
            Inbox
            {unread > 0 && <span className="ml-2 border-2 border-ink bg-pink px-1 font-mono text-xs">{unread}</span>}
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
