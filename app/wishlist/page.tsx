import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { formatUsd } from "@/lib/mandate";
import { HeartButton } from "@/components/HeartButton";
import { SiteFooter, SiteHeader } from "@/components/SiteHeader";
import { StatusChip } from "@/components/StatusChip";

export const metadata: Metadata = { title: "Wishlist — DropCart" };

const OPEN = ["ACTIVE", "AWAITING_APPROVAL", "PURCHASING", "PAUSED"] as const;

export default async function WishlistPage() {
  const user = await requireUser();
  const items = await getDb().likedItem.findMany({
    where: { userId: user.id },
    orderBy: { likedAt: "desc" },
    include: {
      watches: {
        where: { status: { in: [...OPEN] } },
        include: { mandate: true },
        orderBy: { createdAt: "desc" },
        take: 1,
      },
    },
  });

  return (
    <>
      <SiteHeader email={user.email} />
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-10">
        <h2 className="nb-section-title">Wishlist</h2>

        {items.length === 0 ? (
          <div className="nb-card flex flex-col items-start gap-4 p-8">
            <p className="text-lg font-bold">Nothing here yet.</p>
            <p>Heart a product on the home page or in search, then come back to set a price.</p>
            <Link href="/" className="nb-btn">
              Browse featured
            </Link>
          </div>
        ) : (
          <ul className="flex flex-col gap-6">
            {items.map((item) => {
              const watch = item.watches[0];
              return (
                <li key={item.id} className="nb-card grid grid-cols-[96px_1fr] gap-4 p-4 md:grid-cols-[120px_1fr_auto] md:items-center">
                  <div className="aspect-square border-[3px] border-ink bg-card">
                    {item.imageUrl && (
                      // eslint-disable-next-line @next/next/no-img-element -- merchant CDN images
                      <img src={item.imageUrl} alt="" className="h-full w-full object-contain p-2" />
                    )}
                  </div>

                  <div className="flex min-w-0 flex-col gap-1">
                    <p className="font-mono text-xs font-bold uppercase">
                      {item.brand ?? "—"} · {item.merchantDomain ?? "unknown store"}
                    </p>
                    <h3 className="font-bold leading-snug">{item.title}</h3>
                    <p className="font-mono text-sm">
                      Liked at <span className="font-extrabold">{formatUsd(item.priceWhenLiked.toNumber())}</span>
                    </p>
                    {watch?.mandate && (
                      <p className="mt-1 flex flex-wrap items-center gap-2 font-mono text-sm">
                        <StatusChip status={watch.status} />
                        limit <span className="font-extrabold">{formatUsd(watch.mandate.maxPrice.toNumber())}</span>
                        {watch.variant && <span>· {watch.variant.replaceAll(";", ", ")}</span>}
                      </p>
                    )}
                  </div>

                  <div className="col-span-2 flex items-center gap-3 md:col-span-1 md:justify-end">
                    {watch ? (
                      <Link href={`/chat/${item.id}`} className="nb-btn nb-btn-white">
                        Talk to agent
                      </Link>
                    ) : (
                      <Link href={`/chat/${item.id}`} className="nb-btn">
                        Watch this
                      </Link>
                    )}
                    <HeartButton
                      productId={item.channel3ProductId}
                      initialLiked
                      title={item.title}
                      refreshOnChange
                    />
                  </div>
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
