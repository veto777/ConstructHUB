import { PlacesStatusError, competitorPlaces, placesResponse } from "../competitor-provider";
import { analyzeReviews, analyzeBsScore } from "../competitor-analysis";
import type { ScanRow } from "./store";

/**
 * The Google Places half of a market scan, lifted out of server/routes.ts
 * (runCompetitorScan) so it runs under a lease. The execution loop asks
 * `ctl.isLive()` before every listing write: a scan cancelled or deleted
 * mid-run stops instead of orphaning listings, and a lost lease stops the
 * old holder after a takeover.
 */
export class ScanFailedError extends Error {
  constructor(message: string, readonly retryable: boolean) { super(message); }
}

const NO_KEY = "Google Places is not configured.";
const INCOMPLETE = "Google's later results pages could not be loaded, so this list may be incomplete. Run the scan again for the full list.";
export const INCOMPLETE_NOTE = INCOMPLETE;

export type ExecuteDeps = {
  apiKey: string | null;
  places: typeof competitorPlaces;
  /** One place's details call (reviews, phone, website). Throws like the provider. */
  getDetails: (placeId: string) => Promise<{ reviews: any[]; phone: string | null; website: string | null }>;
  analyzeReviews: typeof analyzeReviews;
  analyzeBsScore: typeof analyzeBsScore;
  sleep: (ms: number) => Promise<void>;
};

export type ScanControl = {
  isLive: () => Promise<boolean>;
  note: (fields: { lat: string | null; lon: string | null; note: string | null }) => Promise<void>;
  insert: (listing: import("./store").ListingInsert) => Promise<void>;
  /** Original firstSeenAt when this run resumes an earlier attempt, else null. */
  firstSeenFor: (placeId: string) => Date | null;
};

/** Provider/key problems worth another try vs. ones that cannot fix themselves. */
function classify(e: unknown): ScanFailedError {
  if (e instanceof ScanFailedError) return e;
  if (e instanceof PlacesStatusError) {
    const retryable = e.status === "OVER_QUERY_LIMIT" || e.status === "UNKNOWN_ERROR";
    return new ScanFailedError(e.message, retryable);
  }
  const message = e instanceof Error ? e.message : String(e);
  if (/could not be geocoded/i.test(message)) return new ScanFailedError(message, false);
  return new ScanFailedError(message || "Provider request failed.", true);
}

/** Stops the run quietly when the scan was cancelled, deleted, or re-leased. */
export class ScanLostError extends Error {
  constructor() { super("The scan is no longer ours to run (cancelled, deleted, or taken over)."); }
}

export async function executeCompetitorScan(job: ScanRow, deps: ExecuteDeps, ctl: ScanControl): Promise<{ totalFound: number }> {
  if (!deps.apiKey) throw new ScanFailedError(NO_KEY, false);
  let found: Awaited<ReturnType<typeof competitorPlaces>>;
  try {
    found = await deps.places(job.industry, job.location, job.radius, deps.apiKey);
  } catch (e) {
    throw classify(e);
  }
  // A partly paged result is still real data; say it may be incomplete (shown as a note on the completed scan).
  await ctl.note({ lat: String(found.center.lat), lon: String(found.center.lng), note: found.complete ? null : INCOMPLETE });

  let rank = 0;
  for (const place of found.places) {
    if (!(await ctl.isLive())) throw new ScanLostError();
    rank++;
    let detailReviews: any[] = [];
    let phone: string | null = null;
    let website: string | null = null;
    try {
      const detail = await deps.getDetails(place.place_id);
      detailReviews = detail.reviews;
      phone = detail.phone;
      website = detail.website;
      await deps.sleep(200);
    } catch (e) {
      throw classify(e);
    }
    const reviewAnalysis = deps.analyzeReviews(detailReviews, place, job.industry);
    const bsAnalysis = deps.analyzeBsScore(place, reviewAnalysis);
    // Inserted through the control so the worker owns the row shape and tests
    // can record what a run wrote.
    await ctl.insert({
      placeId: place.place_id,
      businessName: place.name || "Unknown",
      address: place.formatted_address || null,
      phone,
      website,
      rating: place.rating ? String(place.rating) : null,
      reviewCount: place.user_ratings_total || 0,
      category: (place.types || []).filter((t: string) => !["point_of_interest", "establishment"].includes(t)).map((t: string) => t.replace(/_/g, " ")).slice(0, 2).join(", "),
      bsScore: bsAnalysis.score,
      bsReasons: bsAnalysis.reasons,
      reviewAnalysis,
      rank,
      firstSeenAt: ctl.firstSeenFor(place.place_id),
    });
  }
  return { totalFound: found.places.length };
}

export const defaultGetDetails = async (placeId: string): Promise<{ reviews: any[]; phone: string | null; website: string | null }> => {
  const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&fields=reviews,formatted_phone_number,website&key=${process.env.GOOGLE_PLACES_API_KEY}`;
  const data = await placesResponse(url, "Competitor details");
  return {
    reviews: data.result?.reviews || [],
    phone: data.result?.formatted_phone_number || null,
    website: data.result?.website || null,
  };
};

export function defaultExecuteDeps(): ExecuteDeps {
  return {
    apiKey: process.env.GOOGLE_PLACES_API_KEY ?? null,
    places: competitorPlaces,
    getDetails: defaultGetDetails,
    analyzeReviews,
    analyzeBsScore,
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  };
}
