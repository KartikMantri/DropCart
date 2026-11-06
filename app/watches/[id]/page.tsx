import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { isDemoMode } from "@/lib/env";
import { formatUsd } from "@/lib/mandate";
import { SiteFooter, SiteHeader } from "@/components/SiteHeader";
import { StatusChip } from "@/components/StatusChip";
import { WatchActions } from "@/components/WatchActions";

export const metadata: Metadata = { title: "Price tracker — DropCart" };

const ACTION_LABEL: Record<string, string> = {
  MANDATE_CONFIRMED: "You confirmed the mandate",
  WATCH_CREATED: "Started tracking",
  MANDATE_EDITED: "You edited the mandate",
  VARIANT_CHANGED: "You changed the variant",
  GUARD_SKIP: "Guard: skipped",
  GUARD_ASK: "Guard: asked you first",
  PAYMENT_METHOD_MISSING: "Inside the mandate, but PayPal wasn't connected",
  APPROVED: "You approved",
  APPROVAL_DECLINED: "You said not now",
  BOUGHT: "Bought",
  PURCHASE_FAILED: "Payment failed",
  REFUNDED: "Refunded",
  EXPIRED: "Mandate expired",
  PAUSED: "Paused",
  RESUMED: "Resumed",
  CANCELLED: "Stopped tracking",
  RECOVERED: "Recovered an interrupted purchase",
};

const fmtDate = (d: Date) =>
  d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "UTC" }) + " UTC";

function detailText(details: unknown): string | null {
  if (!details || typeof details !== "object") return null;
  const d = details as Record<string, unknown>;
  if (typeof d.reason === "string") return d.reason;
  if (typeof d.message === "string") return d.message;
  if (Array.isArray(d.changed)) {
    const after = (d.after ?? {}) as Record<string, unknown>;
    return d.changed
      .map((f) =>
        f === "maxPrice"
          ? `limit ${formatUsd(Number(after.maxPrice))}`
          : f === "mode"
            ? `mode ${String(after.mode)}`
            : f === "variant"
              ? `variant ${String(after.variant ?? "default").replaceAll(";", ", ")}`
              : "new expiry",
      )
      .join(" · ");
  }
  if (typeof d.maxPrice === "number") {
    return [
      `limit ${formatUsd(d.maxPrice)}`,
      typeof d.mode === "string" ? (d.mode === "AUTO" ? "buys automatically" : "asks first") : null,
      typeof d.expiresInDays === "number" ? `${d.expiresInDays} days` : null,
    ]
      .filter(Boolean)
      .join(", ");
  }
  if (typeof d.priceAtStart === "number") return `price at start ${formatUsd(d.priceAtStart)}`;
  return null;
}

export default async function WatchPage({ params }: PageProps<"/watches/[id]">) {
  const user = await requireUser();
  const { id } = await params;

  const watch = await getDb().watch.findFirst({
    where: { id, userId: user.id },
    include: {
      mandate: true,
      likedItem: true,
      priceChecks: { orderBy: { checkedAt: "desc" }, take: 30 },
      purchases: { where: { status: { in: ["CAPTURED", "REFUNDED"] } }, orderBy: { createdAt: "desc" }, take: 1 },
      auditLogs: { orderBy: { createdAt: "desc" }, take: 40 },
    },
  });
  if (!watch?.mandate) notFound();

  const { mandate, likedItem: item } = watch;
  const purchase = watch.purchases[0];
  const lastCheck = watch.priceChecks[0];
  const lastPrice = lastCheck ? Number(lastCheck.price) : null;
  const pendingAsk = watch.status === "AWAITING_APPROVAL" ? watch.auditLogs.find((a) => a.action === "GUARD_ASK" || a.action === "PAYMENT_METHOD_MISSING") : null;
  const demoMode = isDemoMode();

  return (
    <>
      <SiteHeader email={user.email} userId={user.id} />
      <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-8 px-4 py-10">
        <section className="nb-card grid grid-cols-[96px_1fr] items-center gap-4 p-4 md:grid-cols-[120px_1fr_auto]">
          <div className="aspect-square border-[3px] border-ink bg-card">
            {item.imageUrl && (
              // eslint-disable-next-line @next/next/no-img-element -- merchant CDN images
              <img src={item.imageUrl} alt="" className="h-full w-full object-contain p-2" />
            )}
          </div>
          <div className="min-w-0">
            <p className="font-mono text-xs font-bold uppercase">
              {item.brand ?? "—"} · {item.merchantDomain ?? "unknown store"}
            </p>
            <h1 className="text-xl font-bold leading-snug md:text-2xl">{item.title}</h1>
            <p className="mt-2 flex flex-wrap items-center gap-2 font-mono text-sm">
              <StatusChip status={watch.status} />
              limit <b>{formatUsd(Number(mandate.maxPrice))}</b>
              {watch.variant && <span>· {watch.variant.replaceAll(";", ", ")}</span>}
              <span>· {mandate.mode === "AUTO" ? "buys automatically" : "asks first"}</span>
              <span>· until {mandate.expiresAt.toISOString().slice(0, 10)}</span>
            </p>
            <p className="mt-1 font-mono">
              Last price <span className="text-2xl font-extrabold">{formatUsd(lastPrice)}</span>
              {lastCheck?.isDemo && <span className="nb-chip ml-2 bg-red">Demo price</span>}
            </p>
          </div>
          <Link href="/wishlist" className="nb-btn nb-btn-white col-span-2 md:col-span-1">
            ← Wishlist
          </Link>
        </section>

        {pendingAsk && (
          <section className="nb-card bg-pink p-5">
            <h2 className="text-lg font-bold uppercase">Waiting for you</h2>
            <p className="mt-1 text-lg">
              {detailText(pendingAsk.details) ?? "This is inside your mandate. Buy it?"}
            </p>
          </section>
        )}

        {purchase && (
          <section className={`nb-card p-5 ${purchase.status === "REFUNDED" ? "bg-card" : "bg-green"}`}>
            <h2 className="text-lg font-bold uppercase">
              {purchase.status === "REFUNDED" ? "Receipt (refunded)" : "Receipt"}
            </h2>
            <p className="mt-1 text-lg">
              DropCart bought this for <b className="font-mono">{formatUsd(Number(purchase.amount))}</b> on{" "}
              {fmtDate(purchase.createdAt)}.
            </p>
            <p className="mt-1">
              <b>Why:</b> {purchase.reason}
            </p>
            <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 font-mono text-sm">
              <dt>PayPal order</dt>
              <dd className="break-all">{purchase.paypalOrderId}</dd>
              <dt>Capture</dt>
              <dd className="break-all">{purchase.captureId}</dd>
              {purchase.refundId && (
                <>
                  <dt>Refund</dt>
                  <dd className="break-all">{purchase.refundId}</dd>
                </>
              )}
              <dt>Request id</dt>
              <dd className="break-all">{purchase.requestId}</dd>
            </dl>
            {watch.merchantUrl && purchase.status === "CAPTURED" && (
              <p className="mt-3 text-sm">
                Fulfilment: DropCart is the merchant of record in this sandbox demo, so the order is placed at{" "}
                <a href={watch.merchantUrl} target="_blank" rel="noopener noreferrer" className="font-bold underline">
                  {item.merchantDomain ?? "the store"}
                </a>
                .
              </p>
            )}
          </section>
        )}

        <section className="nb-card p-5">
          <WatchActions
            watchId={watch.id}
            likedItemId={item.id}
            status={watch.status}
            demoMode={demoMode}
            refundable={purchase?.status === "CAPTURED" ? { id: purchase.id, amount: Number(purchase.amount) } : null}
            lastPrice={lastPrice}
          />
        </section>

        <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
          <section>
            <h2 className="nb-section-title">Prices recorded</h2>
            <p className="mb-3 text-sm">Only prices DropCart checked since this tracker began.</p>
            <div className="nb-card overflow-x-auto">
              <table className="w-full font-mono text-sm">
                <thead className="border-b-[3px] border-ink bg-yellow text-left uppercase">
                  <tr>
                    <th className="px-3 py-2">When</th>
                    <th className="px-3 py-2 text-right">Price</th>
                    <th className="px-3 py-2">Stock</th>
                  </tr>
                </thead>
                <tbody>
                  {watch.priceChecks.map((c) => (
                    <tr key={c.id} className="border-b border-ink/20">
                      <td className="px-3 py-2">{fmtDate(c.checkedAt)}</td>
                      <td className={`px-3 py-2 text-right font-bold ${Number(c.price) <= Number(mandate.maxPrice) ? "text-green-800" : ""}`}>
                        {formatUsd(Number(c.price))}
                        {c.isDemo && <span className="nb-chip ml-2 bg-red">Demo</span>}
                      </td>
                      <td className="px-3 py-2">{c.inStock ? "in stock" : "out"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section>
            <h2 className="nb-section-title">What happened</h2>
            <p className="mb-3 text-sm">Every decision, with the guard rule that made it.</p>
            <ol className="nb-card flex flex-col">
              {watch.auditLogs.map((a) => (
                <li key={a.id} className="border-b border-ink/20 px-4 py-3 last:border-b-0">
                  <p className="flex flex-wrap items-baseline gap-2">
                    <span className="font-bold">{ACTION_LABEL[a.action] ?? a.action}</span>
                    {a.rule && <span className="nb-chip bg-card">{a.rule.replaceAll("_", " ")}</span>}
                    <span className="ml-auto font-mono text-xs">
                      {a.actor.toLowerCase()} · {fmtDate(a.createdAt)}
                    </span>
                  </p>
                  {detailText(a.details) && <p className="text-sm">{detailText(a.details)}</p>}
                </li>
              ))}
            </ol>
          </section>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
