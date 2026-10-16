import { sql, asc, type SQL } from "drizzle-orm";
import { competitorListings } from "@shared/schema";

/**
 * Listing order for an expanded competitor scan (GET /api/competitors/scans/:id): best-rated first,
 * most-reviewed among equals, then id for a stable page. `rating` is stored as text (Google Places
 * numbers written with String()/toString()), so it is compared as a number, never alphabetically —
 * and only when it looks like one. A blank, NULL or non-numeric value ("N/A", "—") sorts last instead
 * of making `::numeric` throw and 500 the whole scan page (DB review w3-r8, 2026-10-15).
 */
export const RATING_NUMERIC_PATTERN = String.raw`^[0-9]+(\.[0-9]+)?$`;

export function ratingAsNumber(): SQL {
  return sql`CASE WHEN ${competitorListings.rating} ~ ${RATING_NUMERIC_PATTERN} THEN ${competitorListings.rating}::numeric END`;
}

export function listingOrder(): SQL[] {
  return [
    sql`${ratingAsNumber()} DESC NULLS LAST`,
    sql`${competitorListings.reviewCount} DESC NULLS LAST`,
    asc(competitorListings.id),
  ];
}
