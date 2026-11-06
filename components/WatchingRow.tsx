import Link from "next/link";
import { getDb } from "@/lib/db";
import { formatUsd } from "@/lib/mandate";
import { StatusChip } from "./StatusChip";

/**
 * Home page WATCHING row: the user's open watches (approvals first), plus
 * anything bought in the last week. Hidden when there is nothing to show.
 */
export async function WatchingRow({ userId }: { userId: string }) {
  const watches = await loadWatching(userId, new Date());
  if (watches.length === 0) return null;

  const rank: Record<string, number> = { AWAITING_APPROVAL: 0, BOUGHT: 1, PURCHASING: 2, ACTIVE: 3, PAUSED: 4, REFUNDED: 5 };
  watches.sort((a, b) => (rank[a.status] ?? 9) - (rank[b.status] ?? 9));

  return (
    <section className="mb-10">
      <h2 className="nb-section-title">Watching</h2>
      <ul className="-mx-4 flex snap-x gap-4 overflow-x-auto px-4 pb-3">
        {watches.map((w) => {
          const last = w.priceChecks[0] ? Number(w.priceChecks[0].price) : null;
          const max = w.mandate ? Number(w.mandate.maxPrice) : null;
          const gap = last != null && max != null ? last - max : null;
          return (
            <li key={w.id} className="w-64 shrink-0 snap-start">
              <Link
                href={`/watches/${w.id}`}
                className={`nb-card flex h-full flex-col gap-2 p-3 ${w.status === "AWAITING_APPROVAL" ? "bg-pink" : ""}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <StatusChip status={w.status} />
                  {w.priceChecks[0]?.isDemo && <span className="nb-chip bg-red">Demo</span>}
                </div>
                <div className="flex gap-3">
                  <div className="h-16 w-16 shrink-0 border-[3px] border-ink bg-card">
                    {w.likedItem.imageUrl && (
                      // eslint-disable-next-line @next/next/no-img-element -- merchant CDN images
                      <img src={w.likedItem.imageUrl} alt="" className="h-full w-full object-contain p-1" />
                    )}
                  </div>
                  <p className="line-clamp-3 text-sm font-bold leading-snug">{w.likedItem.title}</p>
                </div>
                <p className="mt-auto font-mono text-sm">
                  {w.purchases[0] ? (
                    <>
                      Bought <b>{formatUsd(Number(w.purchases[0].amount))}</b>
                    </>
                  ) : (
                    <>
                      Now <b>{formatUsd(last)}</b> · limit <b>{formatUsd(max)}</b>
                    </>
                  )}
                </p>
                {!w.purchases[0] && gap != null && w.status === "ACTIVE" && (
                  <p className="font-mono text-xs uppercase">
                    {gap > 0 ? `${formatUsd(gap)} to go` : "At or under your limit"}
                  </p>
                )}
                {w.status === "AWAITING_APPROVAL" && <p className="text-sm font-bold">Tap to approve →</p>}
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

async function loadWatching(userId: string, now: Date) {
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  return getDb().watch.findMany({
    where: {
      userId,
      OR: [
        { status: { in: ["AWAITING_APPROVAL", "ACTIVE", "PURCHASING", "PAUSED"] } },
        { status: { in: ["BOUGHT", "REFUNDED"] }, updatedAt: { gte: weekAgo } },
      ],
    },
    include: {
      mandate: true,
      likedItem: { select: { title: true, imageUrl: true, brand: true } },
      priceChecks: { orderBy: { checkedAt: "desc" }, take: 1 },
      purchases: { where: { status: "CAPTURED" }, take: 1 },
    },
    orderBy: { updatedAt: "desc" },
    take: 12,
  });
}
