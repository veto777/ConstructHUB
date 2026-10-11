/**
 * Who the scan overview names as "top-rated". Rating alone is not enough: a
 * keyword-stuffed listing with a suspicious review profile can hold a 5.0, and
 * naming it a top pick would repeat the manipulation. Picks are rated listings
 * whose signal score stays below the "More signals" band; ties break toward the
 * cleaner profile, then the larger review count.
 */
export type RatedListing = {
  rating?: string | number | null;
  reviewCount?: number | null;
  bsScore?: number | null;
};

export const TOP_RATED_SIGNAL_CUTOFF = 60;

export function topRatedPicks<T extends RatedListing>(listings: T[]): T[] {
  return listings
    .filter(l => Number(l.rating) > 0 && (l.bsScore || 0) < TOP_RATED_SIGNAL_CUTOFF)
    .sort((a, b) =>
      Number(b.rating) - Number(a.rating)
      || (a.bsScore || 0) - (b.bsScore || 0)
      || (b.reviewCount || 0) - (a.reviewCount || 0))
    .slice(0, 3);
}
