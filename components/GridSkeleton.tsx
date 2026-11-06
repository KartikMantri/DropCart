/** Flat placeholder boxes while Channel3 results load (no shimmer/blur). */
export function GridSkeleton({ count = 8 }: { count?: number }) {
  return (
    <ul
      aria-busy
      aria-label="Loading products"
      className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
    >
      {Array.from({ length: count }, (_, i) => (
        <li key={i} className="nb-card">
          <div className="aspect-square border-b-[3px] border-ink bg-grey" />
          <div className="flex flex-col gap-3 p-4">
            <div className="h-3 w-1/2 bg-grey" />
            <div className="h-4 w-full bg-grey" />
            <div className="h-6 w-1/3 bg-grey" />
          </div>
        </li>
      ))}
    </ul>
  );
}
