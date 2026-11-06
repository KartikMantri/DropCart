import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { getBudget } from "@/lib/budget";
import { getProduct } from "@/lib/channel3";
import { getDb } from "@/lib/db";
import { hasLlm } from "@/lib/llm";
import { formatUsd } from "@/lib/mandate";
import { ChatWorkspace } from "@/components/ChatWorkspace";
import { SiteFooter, SiteHeader } from "@/components/SiteHeader";
import { StatusChip } from "@/components/StatusChip";

export const metadata: Metadata = { title: "Watch this — DropCart" };

const OPEN = ["ACTIVE", "AWAITING_APPROVAL", "PURCHASING", "PAUSED"] as const;

export default async function ChatPage({ params }: PageProps<"/chat/[likedItemId]">) {
  const user = await requireUser();
  const { likedItemId } = await params;

  const item = await getDb().likedItem.findFirst({
    where: { id: likedItemId, userId: user.id },
    include: {
      watches: {
        where: { status: { in: [...OPEN] } },
        include: { mandate: true },
        take: 1,
      },
    },
  });
  if (!item) notFound();

  // Free Channel3 endpoint: always show today's price and real variant options.
  const [product, budget] = await Promise.all([
    getProduct(item.channel3ProductId).catch(() => null),
    getBudget(user.id),
  ]);
  const watch = item.watches[0];

  return (
    <>
      <SiteHeader email={user.email} />
      <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-8 px-4 py-10">
        <section className="nb-card grid grid-cols-[96px_1fr] items-center gap-4 p-4 md:grid-cols-[120px_1fr_auto]">
          <div className="aspect-square border-[3px] border-ink bg-card">
            {(product?.imageUrl ?? item.imageUrl) && (
              // eslint-disable-next-line @next/next/no-img-element -- merchant CDN images
              <img
                src={(product?.imageUrl ?? item.imageUrl)!}
                alt=""
                className="h-full w-full object-contain p-2"
              />
            )}
          </div>
          <div className="min-w-0">
            <p className="font-mono text-xs font-bold uppercase">
              {item.brand ?? "—"} · {product?.merchantDomain ?? item.merchantDomain ?? "unknown store"}
            </p>
            <h1 className="text-xl font-bold leading-snug md:text-2xl">{item.title}</h1>
            <p className="mt-1 font-mono">
              Today{" "}
              <span className="text-2xl font-extrabold">{formatUsd(product?.price ?? null)}</span>
              <span className="ml-3 text-sm">liked at {formatUsd(item.priceWhenLiked.toNumber())}</span>
              {product && !product.inStock && <span className="nb-chip ml-3 bg-grey">Out of stock</span>}
            </p>
          </div>
          <Link href="/wishlist" className="nb-btn nb-btn-white col-span-2 md:col-span-1">
            ← Wishlist
          </Link>
        </section>

        {!product ? (
          <div className="nb-card bg-red p-8 font-bold">
            Channel3 doesn&apos;t currently have an offer for this product, so it can&apos;t be
            watched right now.
          </div>
        ) : watch?.mandate ? (
          <div className="nb-card flex flex-col items-start gap-3 p-8">
            <StatusChip status={watch.status} />
            <p className="text-lg">
              DropCart is already watching this at a limit of{" "}
              <span className="font-mono font-extrabold">{formatUsd(watch.mandate.maxPrice.toNumber())}</span>
              {watch.variant && <> for {watch.variant.replaceAll(";", ", ")}</>}, until{" "}
              {watch.mandate.expiresAt.toISOString().slice(0, 10)}.
            </p>
            <p className="font-mono text-sm">Editing the mandate from chat arrives on Day 4.</p>
          </div>
        ) : (
          <ChatWorkspace
            likedItemId={item.id}
            variants={product.variants}
            initialVariant={product.selected}
            priceNow={product.price}
            available={budget.available}
            llmReady={hasLlm()}
          />
        )}
      </main>
      <SiteFooter />
    </>
  );
}
