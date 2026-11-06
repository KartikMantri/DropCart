import type { Metadata } from "next";
import { Suspense } from "react";
import { requireUser } from "@/lib/auth";
import { Channel3Unavailable, searchProducts } from "@/lib/channel3";
import { getLikedProductIds } from "@/lib/likes";
import { ProductGrid } from "@/components/ProductCard";
import { SiteFooter, SiteHeader } from "@/components/SiteHeader";
import { GridSkeleton } from "@/components/GridSkeleton";

export const metadata: Metadata = { title: "Search — DropCart" };

export default async function SearchPage({ searchParams }: PageProps<"/search">) {
  const user = await requireUser();
  const params = await searchParams;
  const q = (typeof params.q === "string" ? params.q : "").trim().slice(0, 200);

  return (
    <>
      <SiteHeader email={user.email} query={q} />
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-10">
        {q.length < 2 ? (
          <div className="nb-card p-8 font-bold">
            Type at least two characters and press Search.
          </div>
        ) : (
          <>
            <h2 className="nb-section-title">
              Results for <span className="bg-yellow px-1">“{q}”</span>
            </h2>
            <Suspense key={q} fallback={<GridSkeleton />}>
              <Results q={q} userId={user.id} />
            </Suspense>
          </>
        )}
      </main>
      <SiteFooter />
    </>
  );
}

async function Results({ q, userId }: { q: string; userId: string }) {
  // Fetch inside try/catch; render outside it (render errors go to error boundaries).
  let data: Awaited<ReturnType<typeof load>> | null = null;
  try {
    data = await load(q, userId);
  } catch (err) {
    if (!(err instanceof Channel3Unavailable)) throw err;
  }
  if (!data) {
    return (
      <div className="nb-card bg-red p-8 font-bold">
        Search is unavailable right now. Try again in a minute.
      </div>
    );
  }
  if (data.products.length === 0) {
    return (
      <div className="nb-card p-8 font-bold">
        Nothing in the catalogue matched “{q}”. Try fewer or different words.
      </div>
    );
  }
  return <ProductGrid products={data.products} likedIds={data.likedIds} />;
}

async function load(q: string, userId: string) {
  const [{ products }, likedIds] = await Promise.all([searchProducts(q), getLikedProductIds(userId)]);
  return { products, likedIds };
}
