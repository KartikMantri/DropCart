import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { readNotifications } from "@/lib/notifications";
import { SiteFooter, SiteHeader } from "@/components/SiteHeader";

export const metadata: Metadata = { title: "Inbox — DropCart" };

const KIND: Record<string, { label: string; bg: string }> = {
  BOUGHT: { label: "Bought", bg: "bg-green" },
  APPROVAL_NEEDED: { label: "Needs you", bg: "bg-pink" },
  SKIPPED: { label: "Update", bg: "bg-grey" },
  REFUNDED: { label: "Refunded", bg: "bg-card" },
};

export default async function NotificationsPage() {
  const user = await requireUser();
  // Read before rendering the header, so the unread badge is already cleared.
  const items = await readNotifications(user.id);

  return (
    <>
      <SiteHeader email={user.email} userId={user.id} />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-10">
        <h2 className="nb-section-title">Inbox</h2>
        {items.length === 0 ? (
          <div className="nb-card p-8 font-bold">Nothing yet. DropCart writes here when it buys, skips or needs you.</div>
        ) : (
          <ul className="flex flex-col gap-3">
            {items.map((n) => {
              const k = KIND[n.kind] ?? { label: n.kind, bg: "bg-card" };
              const body = (
                <>
                  <p className="flex items-center gap-2">
                    <span className={`nb-chip ${k.bg}`}>{k.label}</span>
                    {!n.read && <span className="font-mono text-xs font-bold uppercase">new</span>}
                    <span className="ml-auto font-mono text-xs">{n.createdAt.toISOString().slice(0, 16).replace("T", " ")} UTC</span>
                  </p>
                  <p className="mt-1">{n.message}</p>
                </>
              );
              return (
                <li key={n.id}>
                  {n.watchId ? (
                    <Link href={`/watches/${n.watchId}`} className="nb-card block p-4">
                      {body}
                    </Link>
                  ) : (
                    <div className="nb-card p-4">{body}</div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </main>
      <SiteFooter />
    </>
  );
}
