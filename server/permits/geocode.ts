/**
 * Geocoding for permit alerts, with the geocoder the repo already uses
 * (Google Geocoding, GOOGLE_PLACES_API_KEY — server/routes.ts /api/media/geocode,
 * server/competitor-provider.ts). Without the key every call answers null and
 * trade-area watches match by jurisdiction instead of by radius.
 */
export type GeoPoint = { lat: number; lng: number; formattedAddress: string | null };

export function geocoderConfigured(): boolean {
  return Boolean(process.env.GOOGLE_PLACES_API_KEY);
}

const cache = new Map<string, GeoPoint | null>();

export async function geocodeAddress(address: string, hint?: string | null): Promise<GeoPoint | null> {
  const key = process.env.GOOGLE_PLACES_API_KEY;
  const query = [address.trim(), hint?.trim()].filter(Boolean).join(", ");
  if (!key || !query) return null;
  if (cache.has(query)) return cache.get(query)!;
  try {
    const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(query)}&key=${key}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    const data: any = await res.json().catch(() => null);
    const loc = data?.status === "OK" ? data.results?.[0]?.geometry?.location : null;
    const out = loc && Number.isFinite(loc.lat) && Number.isFinite(loc.lng)
      ? { lat: loc.lat, lng: loc.lng, formattedAddress: data.results[0].formatted_address ?? null }
      : null;
    if (cache.size > 5000) cache.clear();
    cache.set(query, out);
    return out;
  } catch (e: any) {
    console.warn(`[permit-alerts] geocode failed for "${query}": ${e?.message ?? e}`);
    return null;
  }
}
