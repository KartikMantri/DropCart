"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

/** Heart toggle: pink when liked. Optimistic, reverts if the API refuses. */
export function HeartButton({
  productId,
  initialLiked,
  title,
  refreshOnChange = false,
}: {
  productId: string;
  initialLiked: boolean;
  title: string;
  /** Re-render the server page after a change (e.g. wishlist removes the row). */
  refreshOnChange?: boolean;
}) {
  const router = useRouter();
  const [liked, setLiked] = useState(initialLiked);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const toggle = () => {
    const next = !liked;
    setLiked(next);
    setError(null);
    startTransition(async () => {
      const res = await fetch("/api/likes", {
        method: next ? "POST" : "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId }),
      }).catch(() => null);
      if (!res || !res.ok) {
        setLiked(!next);
        const body = res ? ((await res.json().catch(() => ({}))) as { error?: string }) : {};
        setError(body.error ?? "Couldn't save. Try again.");
      } else if (refreshOnChange) {
        router.refresh();
      }
    });
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={toggle}
        disabled={pending}
        aria-pressed={liked}
        aria-label={liked ? `Remove ${title} from wishlist` : `Add ${title} to wishlist`}
        className={`flex h-11 w-11 items-center justify-center border-[3px] border-ink text-2xl leading-none shadow-brutal-sm transition-transform duration-[80ms] hover:-translate-x-0.5 hover:-translate-y-0.5 active:translate-x-1 active:translate-y-1 active:shadow-none ${
          liked ? "bg-pink" : "bg-card"
        }`}
      >
        <span aria-hidden>{liked ? "♥" : "♡"}</span>
      </button>
      {error && (
        <p
          role="alert"
          className="absolute right-0 top-12 z-10 w-56 border-[3px] border-ink bg-red px-2 py-1 text-sm font-bold"
        >
          {error}
        </p>
      )}
    </div>
  );
}
