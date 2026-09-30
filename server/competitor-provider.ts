type Point = { lat: number; lng: number };
export function distanceMiles(a: Point, b: Point): number {
  const rad = (n: number) => n * Math.PI / 180;
  const dlat = rad(b.lat - a.lat), dlon = rad(b.lng - a.lng);
  const h = Math.sin(dlat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dlon / 2) ** 2;
  return 3958.8 * 2 * Math.asin(Math.sqrt(Math.min(1, h)));
}
/** A Google response whose `status` was not OK; `status` is the sanitized provider status. */
export class PlacesStatusError extends Error {
  constructor(message: string, readonly status: string) { super(message); }
}
export async function placesResponse(url: string, label: string, allowEmpty = false): Promise<any> {
  let response: Response;
  try { response = await fetch(url, { signal: AbortSignal.timeout(15000) }); }
  catch { throw new Error(`${label} could not be reached. Please try again later.`); }
  if (!response.ok) throw new Error(`${label} failed (HTTP ${response.status}).`);
  const data = await response.json();
  if (data.status !== "OK" && !(allowEmpty && data.status === "ZERO_RESULTS")) {
    const status = /^[A-Z_]+$/.test(data.status) ? data.status : "INVALID_RESPONSE";
    throw new PlacesStatusError(`${label} failed (${status}). Check provider access and quota.`, status);
  }
  return data;
}
// Google issues next_page_token a moment before it becomes valid; until then the
// same token answers INVALID_REQUEST. Wait before each attempt and retry only that.
export const PAGE_TOKEN_ATTEMPTS = 4;
export const PAGE_TOKEN_DELAY_MS = 2000;
// The token is sent with the original search parameters: a bare `pagetoken=` request
// answered INVALID_REQUEST indefinitely (still after 30s, 2026-09-30), while the same
// token alongside the original query returned the true next page (no overlapping place_ids).
async function nextPage(searchUrl: string, token: string): Promise<any | null> {
  const url = `${searchUrl}&pagetoken=${encodeURIComponent(token)}`;
  for (let attempt = 1; attempt <= PAGE_TOKEN_ATTEMPTS; attempt++) {
    await new Promise(r => setTimeout(r, PAGE_TOKEN_DELAY_MS));
    try { return await placesResponse(url, "Competitor search", true); }
    catch (err) {
      const retryable = err instanceof PlacesStatusError && err.status === "INVALID_REQUEST";
      if (!retryable || attempt === PAGE_TOKEN_ATTEMPTS) {
        console.warn(`Competitor search paging stopped after attempt ${attempt}: ${(err as Error).message}`);
        return null;
      }
    }
  }
  return null;
}
/**
 * `complete` is false when a later results page could not be loaded; the places from the
 * pages that did load are still real and are returned rather than discarded.
 */
export async function competitorPlaces(industry: string, location: string, radius: number, key: string) {
  // allowEmpty: an unknown place answers ZERO_RESULTS, which gets the friendly message below.
  const geo = await placesResponse(`https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(location)}&key=${key}`, "Location geocoding", true);
  const center: Point = geo.results?.[0]?.geometry?.location;
  if (!center || !Number.isFinite(center.lat) || !Number.isFinite(center.lng)) throw new Error("Location could not be geocoded. Use a city and state or a full address.");
  const places = new Map<string, any>();
  const searchUrl = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(`${industry} in ${location}`)}&location=${center.lat},${center.lng}&radius=${Math.round(radius * 1609.344)}&key=${key}`;
  let token: string | undefined;
  let complete = true;
  for (let page = 0; page < 3; page++) {
    const data = token
      ? await nextPage(searchUrl, token)
      : await placesResponse(searchUrl, "Competitor search", true);
    if (!data) { complete = false; break; }
    for (const place of data.results || []) {
      const point = place.geometry?.location;
      if (point && Number.isFinite(point.lat) && Number.isFinite(point.lng) && distanceMiles(center, point) <= radius) places.set(place.place_id, place);
    }
    token = data.next_page_token;
    if (!token) break;
  }
  return { center, places: [...places.values()], complete };
}
