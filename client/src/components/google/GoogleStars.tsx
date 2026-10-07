import type { ReactNode } from "react";
import { Star } from "lucide-react";

/** 1234 → "1.2K", 12 → "12" (Google's review-count style). */
export function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}K`;
  return String(n);
}

/**
 * Google's rating row: "4.7 ★ (1.2K) · $5,000–20,000 · Roofing contractor". Every part is optional and
 * only what we really have is shown — a missing rating or count is left out, never guessed.
 */
export function GoogleStars({ rating, count, priceRange, category, testId }: {
  rating?: number | string | null;
  count?: number | null;
  priceRange?: string | null;
  category?: string | null;
  testId?: string;
}) {
  const r = rating == null || rating === "" ? null : Number(rating);
  const hasRating = r != null && Number.isFinite(r) && r > 0;
  const parts: ReactNode[] = [];
  if (hasRating) {
    parts.push(
      <span key="rating" className="inline-flex items-center gap-1">
        <span className="g-text">{r!.toFixed(1)}</span>
        <Star className="g-star h-[14px] w-[14px] fill-current" aria-hidden="true" />
        {count != null && count > 0 && <span>({formatCount(count)})</span>}
      </span>,
    );
  } else if (count != null && count > 0) {
    parts.push(<span key="count">{formatCount(count)} review{count === 1 ? "" : "s"}</span>);
  }
  if (priceRange) parts.push(<span key="price">{priceRange}</span>);
  if (category) parts.push(<span key="category">{category}</span>);
  if (!parts.length) return null;
  return (
    <p className="g-card__line" data-testid={testId}>
      {parts.map((p, i) => <span key={i}>{i > 0 && <span aria-hidden="true"> · </span>}{p}</span>)}
    </p>
  );
}

/** Five star icons, Google review style (filled #fbbc04, empty divider grey). */
export function GoogleStarRow({ rating, size = 14, label }: { rating: number; size?: number; label?: string }) {
  return (
    <span className="g-stars" role="img" aria-label={label ?? `${rating} out of 5 stars`}>
      {[1, 2, 3, 4, 5].map((s) => (
        <Star key={s} className={s <= rating ? "g-stars__on fill-current" : "g-stars__off fill-current"} style={{ width: size, height: size }} aria-hidden="true" />
      ))}
    </span>
  );
}
