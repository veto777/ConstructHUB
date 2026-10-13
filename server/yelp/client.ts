/**
 * Yelp Fusion API (read-only). ConstructHUB's own app key reads a business's rating, reviews, and details for the
 * reputation page. Yelp offers no write/response API, so this is read-only; replying is done on Yelp (deep link).
 *   YELP_API_KEY  the Fusion API key (Bearer). Unset = Yelp off.
 * Plan (2026-10): Places 5,000/month, reviews 500/day — so callers cache and refresh sparingly (service.ts).
 */
const BASE = "https://api.yelp.com/v3";

export class YelpError extends Error {
  constructor(public readonly status: number, message: string, public readonly code?: string) { super(message); this.name = "YelpError"; }
}
export const yelpDeps = { http: fetch as typeof fetch, env: () => process.env };

export const yelpConfigured = (env: NodeJS.ProcessEnv = process.env): boolean => /^\S{20,}$/.test((env.YELP_API_KEY ?? "").trim());

async function call(path: string, params: Record<string, string | number | undefined> = {}): Promise<any> {
  const env = yelpDeps.env();
  const key = (env.YELP_API_KEY ?? "").trim();
  if (!key) throw new YelpError(503, "Yelp isn't configured on the server");
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") qs.set(k, String(v));
  const url = `${BASE}${path}${qs.toString() ? `?${qs}` : ""}`;
  let r: Response;
  try { r = await yelpDeps.http(url, { headers: { Authorization: `Bearer ${key}`, Accept: "application/json" }, redirect: "error", signal: AbortSignal.timeout(20_000) }); }
  catch { throw new YelpError(502, "Yelp didn't answer; try again"); }
  const d: any = await r.json().catch(() => null);
  if (!r.ok) {
    const code = String(d?.error?.code ?? "");
    if (r.status === 401 || code === "TOKEN_MISSING" || code === "VALIDATION_ERROR" && /token/i.test(String(d?.error?.description))) throw new YelpError(401, "Yelp rejected the API key", code);
    if (r.status === 429 || code === "ACCESS_LIMIT_REACHED" || code === "TOO_MANY_REQUESTS_PER_SECOND") throw new YelpError(429, "Yelp is rate-limiting us; try again shortly", code);
    if (r.status === 404 || code === "BUSINESS_NOT_FOUND") throw new YelpError(404, "That Yelp business wasn't found", code);
    throw new YelpError(r.status >= 500 ? 502 : 400, String(d?.error?.description || "Yelp refused the request").slice(0, 200), code);
  }
  if (!d || typeof d !== "object") throw new YelpError(502, "Yelp sent an unreadable answer");
  return d;
}

export type YelpBiz = {
  yelpId: string; name: string; url: string | null; imageUrl: string | null; rating: number | null; reviewCount: number;
  location: string | null; phone: string | null; categories: string[]; photos: string[]; price: string | null;
  isOpenNow: boolean | null; coordinates: { latitude: number; longitude: number } | null; distanceMi: number | null;
};
export type YelpReview = { id: string; rating: number; text: string; timeCreated: string | null; url: string | null; user: { name: string; imageUrl: string | null } };

/** The marketing/UTM junk Yelp appends to URLs — stripped so links are clean. */
export function cleanUrl(u: unknown): string | null {
  if (typeof u !== "string" || !/^https?:\/\//.test(u)) return null;
  try { const url = new URL(u); for (const k of [...url.searchParams.keys()]) if (/^(adjust_creative|utm_|hrid$)/i.test(k)) url.searchParams.delete(k); return url.toString().replace(/\?$/, ""); }
  catch { return u; }
}
const oneLine = (parts: (string | undefined)[]) => parts.filter(Boolean).join(", ") || null;
export function mapBusiness(b: any): YelpBiz {
  const loc = b?.location || {};
  const coord = b?.coordinates && Number.isFinite(b.coordinates.latitude) ? { latitude: Number(b.coordinates.latitude), longitude: Number(b.coordinates.longitude) } : null;
  return {
    yelpId: String(b?.id ?? b?.alias ?? ""), name: String(b?.name ?? "Business"), url: cleanUrl(b?.url),
    imageUrl: typeof b?.image_url === "string" && b.image_url ? b.image_url : null,
    rating: Number.isFinite(b?.rating) ? Number(b.rating) : null, reviewCount: Number(b?.review_count) || 0,
    location: oneLine([Array.isArray(loc.display_address) ? loc.display_address.join(", ") : loc.address1, loc.city, loc.state]),
    phone: typeof b?.display_phone === "string" && b.display_phone ? b.display_phone : null,
    categories: Array.isArray(b?.categories) ? b.categories.map((c: any) => String(c?.title ?? "")).filter(Boolean).slice(0, 6) : [],
    photos: Array.isArray(b?.photos) ? b.photos.filter((p: any) => typeof p === "string").slice(0, 3) : [],
    price: typeof b?.price === "string" && b.price ? b.price : null,
    isOpenNow: Array.isArray(b?.hours) && typeof b.hours[0]?.is_open_now === "boolean" ? b.hours[0].is_open_now : null,
    coordinates: coord, distanceMi: Number.isFinite(b?.distance) ? Number(b.distance) / 1609.34 : null,
  };
}
export function mapReview(r: any): YelpReview {
  const u = r?.user || {};
  return {
    id: String(r?.id ?? ""), rating: Number(r?.rating) || 0, text: String(r?.text ?? "").slice(0, 400),
    timeCreated: typeof r?.time_created === "string" ? r.time_created.replace(" ", "T") + "Z" : null, url: cleanUrl(r?.url),
    user: { name: String(u?.name ?? "Yelp user"), imageUrl: typeof u?.image_url === "string" && u.image_url ? u.image_url : null },
  };
}

/** Find a business by name + where (city/address/zip). Up to `limit` matches, best first. */
export async function yelpSearch(term: string, location: string, limit = 6): Promise<YelpBiz[]> {
  const t = term.trim(), l = location.trim();
  if (t.length < 2) throw new YelpError(400, "Enter the business name to search");
  if (l.length < 2) throw new YelpError(400, "Enter a city, address or ZIP to search near");
  const d = await call("/businesses/search", { term: t, location: l, limit: Math.min(Math.max(limit, 1), 20) });
  return (Array.isArray(d.businesses) ? d.businesses : []).map(mapBusiness).filter((b: YelpBiz) => b.yelpId);
}
/** Competitors: businesses in the same category near a point, best-rated first (for the Competitors panel). */
export async function yelpNearby(categoriesAlias: string, latitude: number, longitude: number, limit = 8): Promise<YelpBiz[]> {
  const d = await call("/businesses/search", { ...(categoriesAlias ? { categories: categoriesAlias } : { term: "contractor" }), latitude, longitude, radius: 24000, limit: Math.min(limit, 20), sort_by: "rating" });
  return (Array.isArray(d.businesses) ? d.businesses : []).map(mapBusiness).filter((b: YelpBiz) => b.yelpId);
}
/** One business's current rating + details (categories, photos, hours). */
export async function yelpBusiness(yelpId: string): Promise<YelpBiz & { categoryAliases: string[] }> {
  if (!/^[\w-]{1,128}$/.test(yelpId)) throw new YelpError(400, "Invalid Yelp business id");
  const b = await call(`/businesses/${encodeURIComponent(yelpId)}`);
  return { ...mapBusiness(b), categoryAliases: Array.isArray(b?.categories) ? b.categories.map((c: any) => String(c?.alias ?? "")).filter(Boolean) : [] };
}
/** Up to 3 recent reviews (Yelp Fusion caps this and truncates each text). */
export async function yelpReviews(yelpId: string): Promise<{ reviews: YelpReview[]; total: number }> {
  if (!/^[\w-]{1,128}$/.test(yelpId)) throw new YelpError(400, "Invalid Yelp business id");
  const d = await call(`/businesses/${encodeURIComponent(yelpId)}/reviews`, { limit: 3, sort_by: "newest" });
  return { reviews: (Array.isArray(d.reviews) ? d.reviews : []).map(mapReview).filter((r: YelpReview) => r.id), total: Number(d.total) || 0 };
}
