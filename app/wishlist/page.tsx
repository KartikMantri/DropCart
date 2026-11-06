import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { getBudget } from "@/lib/budget";
import { getDb } from "@/lib/db";
import { formatUsd } from "@/lib/mandate";
import { BudgetMeter } from "@/components/BudgetMeter";
import { ConnectPaypal } from "@/components/ConnectPaypal";
import { HeartButton } from "@/components/HeartButton";
import { SiteFooter, SiteHeader } from "@/components/SiteHeader";
import { StatusChip } from "@/components/StatusChip";

export const metadata: Metadata = { title: "Wishlist — DropCart" };

const OPEN = ["ACTIVE", "AWAITING_APPROVAL", "PURCHASING", "PAUSED"] as const;

const PAYPAL_NOTICE: Record<string, { text: string; tone: string }> = {
  connected: { text: "PayPal connected. DropCart can now buy inside your mandates.", tone: "bg-yellow" },
  cancelled: { text: "PayPal approval cancelled. Nothing was saved.", tone: "bg-card" },
  error: { text: "Couldn't connect PayPal. Try again.", tone: "bg-pink" },
};

export default async function WishlistPage({ searchParams }: PageProps<"/wishlist">) {
  const user = await requireUser();
  const { paypal } = await searchParams;
  const notice = typeof paypal === "string" ? PAYPAL_NOTICE[paypal] : undefined;
  const [account, budget] = await Promise.all([
    getDb().user.findUnique({ where: { id: user.id }, select: { paypalVaultToken: true } }),
    getBudget(user.id),
  ]);
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
      <SiteHeader email={user.email} userId={user.id} />
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-10">
        <h2 className="nb-section-title">Wishlist</h2>

        {notice && (
          <p className={`mb-6 border-[3px] border-ink px-3 py-2 font-bold ${notice.tone}`}>{notice.text}</p>
        )}
        <BudgetMeter summary={budget} />
        {!account?.paypalVaultToken && items.some((i) => i.watches.length > 0) && (
          <div className="nb-card mb-6 flex flex-wrap items-center justify-between gap-4 bg-pink p-4">
            <p className="font-bold">PayPal isn&apos;t connected, so DropCart can&apos;t buy anything yet.</p>
            <ConnectPaypal next="/wishlist" />
          </div>
        )}

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
                      <>
                        <Link href={`/watches/${watch.id}`} className="nb-btn">
                          {watch.status === "AWAITING_APPROVAL" ? "Approve" : "View tracker"}
                        </Link>
                        <Link href={`/chat/${item.id}`} className="nb-btn nb-btn-white">
                          Edit
                        </Link>
                      </>
                    ) : (
                      <Link href={`/chat/${item.id}`} className="nb-btn">
                        Track price
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
