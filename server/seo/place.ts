/**
 * Narrowing an SEO lookup to a US state, county, city, ZIP code or metro area (owner, 2026-10-10:
 * "all the searches should be per city or state as well as per county searches. For all features in SEO").
 *
 * What exists below country level (checked 2026-10-10):
 *   Google's own keyword numbers (./google-planner.ts, free)   every US place → local volume, cost per click, bids, months, ideas
 *   Google results (paid search-results source)                every US place → "who ranks", results-page features, rank checks
 *   The keyword database (paid)                                countries only → difficulty, intent, traffic potential and
 *                                                              Site explorer traffic stay country-wide, labelled so
 *   Backlinks, content, AI, audit                              no location at all
 *
 * The places are the rank tracker's list (./locations.ts), whose codes are Google's own geo target ids, so a code
 * picked anywhere in the SEO Suite means the same place everywhere. Customer copy never names a vendor.
 */
import { z } from "zod";
import { SeoCustomerError } from "./public-errors";
import { locationByCode } from "./locations";

export type SeoPlace = { code: number; label: string; kind: string };
/** The optional place on a request body: a code from GET /api/seo/locations. */
export const placeCodeInput = z.number().int().positive().nullable().optional();

/** The place a lookup is narrowed to, or null for the whole country. A bad code is the customer's to fix (400). */
export async function resolvePlace(code: number | null | undefined, market: { locationCode: number }): Promise<SeoPlace | null> {
  if (!code || code === market.locationCode) return null;
  if (market.locationCode !== 2840) throw new SeoCustomerError("Cities, counties and states can be picked for the United States only.");
  const p = await locationByCode(code);
  if (!p || p.kind === "Country") throw new SeoCustomerError("That place isn't on the list. Pick one from the suggestions.");
  return p;
}
