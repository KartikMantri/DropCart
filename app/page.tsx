import { Suspense } from "react";
import { requireUser } from "@/lib/auth";
import { Channel3Unavailable, getFeatured } from "@/lib/channel3";
import { getLikedProductIds } from "@/lib/likes";
import { ProductGrid } from "@/components/ProductCard";
import { SiteFooter, SiteHeader } from "@/components/SiteHeader";
import { GridSkeleton } from "@/components/GridSkeleton";

// The WATCHING row (shown first when the user has watches) lands on Day 4.
export default async function Home() {
  const user = await requireUser();

  return (
    <>
      <SiteHeader email={user.email} />
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-10">
        <h2 className="nb-section-title">Featured</h2>
        <Suspense fallback={<GridSkeleton />}>
          <FeaturedGrid userId={user.id} />
        </Suspense>
      </main>
      <SiteFooter />
    </>
  );
}

async function FeaturedGrid({ userId }: { userId: string }) {
  // Fetch inside try/catch; render outside it (render errors go to error boundaries).
  let data: Awaited<ReturnType<typeof load>> | null = null;
  try {
    data = await load(userId);
  } catch (err) {
    if (!(err instanceof Channel3Unavailable)) throw err;
  }
  if (!data) {
    return (
      <div className="nb-card bg-red p-8 font-bold">
        Couldn&apos;t load the catalogue right now. Refresh in a minute, or try a search.
      </div>
    );
  }
  if (data.products.length === 0) {
    return (
      <div className="nb-card p-8 font-bold">
        The catalogue came back empty. Try a search above.
      </div>
    );
  }
  return <ProductGrid products={data.products} likedIds={data.likedIds} />;
}

async function load(userId: string) {
  const [{ products }, likedIds] = await Promise.all([getFeatured(), getLikedProductIds(userId)]);
  return { products, likedIds };
}
