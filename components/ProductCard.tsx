import type { CatalogueProduct } from "@/lib/channel3";
import { formatUsd } from "@/lib/mandate";
import { HeartButton } from "./HeartButton";

/** Bordered image box, title, store, big mono price, heart toggle. */
export function ProductCard({ product, liked }: { product: CatalogueProduct; liked: boolean }) {
  const onSale =
    product.compareAtPrice != null && product.price != null && product.compareAtPrice > product.price;

  return (
    <article className="nb-card flex h-full flex-col">
      <div className="relative aspect-square border-b-[3px] border-ink bg-card">
        {product.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- images come from many merchant CDNs
          <img
            src={product.imageUrl}
            alt={product.title}
            loading="lazy"
            className="h-full w-full object-contain p-4"
          />
        ) : (
          <div className="flex h-full items-center justify-center font-mono text-sm">NO IMAGE</div>
        )}
        <div className="absolute right-3 top-3">
          <HeartButton productId={product.id} initialLiked={liked} title={product.title} />
        </div>
        {onSale && <span className="nb-chip absolute left-3 top-3 bg-green">Sale</span>}
        {!product.inStock && (
          <span className="nb-chip absolute bottom-3 left-3 bg-grey">Out of stock</span>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-2 p-4">
        <p className="font-mono text-xs font-bold uppercase">
          {product.brand ?? "—"} · {product.merchantDomain ?? "unknown store"}
        </p>
        <h3 className="line-clamp-2 font-bold leading-snug">{product.title}</h3>
        <div className="mt-auto flex items-baseline gap-2 pt-2">
          <span className="font-mono text-2xl font-extrabold">{formatUsd(product.price)}</span>
          {onSale && (
            <span className="font-mono text-sm line-through">{formatUsd(product.compareAtPrice)}</span>
          )}
        </div>
      </div>
    </article>
  );
}

export function ProductGrid({
  products,
  likedIds,
}: {
  products: CatalogueProduct[];
  likedIds: Set<string>;
}) {
  return (
    <ul className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {products.map((p) => (
        <li key={p.id}>
          <ProductCard product={p} liked={likedIds.has(p.id)} />
        </li>
      ))}
    </ul>
  );
}
