/**
 * Google's Custom Search JSON API as a rank source: official, keyed, 100 searches a day free then $5 per 1,000
 * (10,000 a day at most). It searches Google's web index for a Programmable Search Engine set to "the entire web":
 * close to, but not the same as, the real results page — no map pack, no "people also ask", no city targeting (`gl`
 * is a country), and the order can differ.
 *
 *   GOOGLE_CSE_CX    the search engine's id (programmablesearchengine.google.com)
 *   GOOGLE_CSE_KEY   an API key of a project with the Custom Search API enabled (GOOGLE_PLACES_API_KEY when unset)
 */
import { hostOf, ownIn, type RankObservation, type RankQuery, type RankSource, type SerpResult } from "./types";

export const CSE_USD_PER_QUERY = 0.005;
export const cseConfigured = (env: NodeJS.ProcessEnv = process.env) => !!(env.GOOGLE_CSE_CX?.trim() && (env.GOOGLE_CSE_KEY || env.GOOGLE_PLACES_API_KEY)?.trim());

/** The organic list of a Custom Search answer. Pure. */
export function parseCse(json: any): SerpResult[] {
  const items = Array.isArray(json?.items) ? json.items : [];
  const out: SerpResult[] = [];
  for (const it of items) {
    const url = typeof it?.link === "string" ? it.link : null;
    const domain = url ? hostOf(url) : null;
    if (!url || !domain) continue;
    out.push({ position: out.length + 1, domain, url, title: typeof it?.title === "string" ? it.title : null });
    if (out.length >= 10) break;
  }
  return out;
}

export const cseDeps = { http: fetch as typeof fetch, env: () => process.env };

export const cseSource: RankSource = {
  name: "cse",
  label: "Google Custom Search API",
  async available() {
    return cseConfigured(cseDeps.env()) ? { ok: true } : { ok: false, why: "GOOGLE_CSE_CX (and an API key with the Custom Search API enabled) are not set." };
  },
  async check(q) {
    const t0 = Date.now();
    const base: RankObservation = { source: "cse", keyword: q.keyword, device: q.device, place: q.place ? { code: q.place.code, label: q.place.label } : null, position: null, url: null, top: [], mapPack: null, localPosition: null, features: [], costUsd: CSE_USD_PER_QUERY, ms: 0 };
    const env = cseDeps.env();
    const key = (env.GOOGLE_CSE_KEY || env.GOOGLE_PLACES_API_KEY || "").trim();
    const u = new URL("https://www.googleapis.com/customsearch/v1");
    u.search = new URLSearchParams({ key, cx: env.GOOGLE_CSE_CX!.trim(), q: q.keyword, gl: "us", hl: q.languageCode, num: "10", safe: "off" }).toString();
    let json: any;
    try {
      const r = await cseDeps.http(u, { signal: AbortSignal.timeout(20_000) });
      json = await r.json().catch(() => ({}));
      if (!r.ok) return { ...base, ms: Date.now() - t0, error: `HTTP ${r.status}: ${String(json?.error?.message ?? "").slice(0, 120)}` };
    } catch (e: any) { return { ...base, ms: Date.now() - t0, error: e?.name === "TimeoutError" ? "timeout" : String(e?.message ?? e) }; }
    const top = parseCse(json);
    return { ...base, ms: Date.now() - t0, top, ...ownIn(top, q.domain), note: q.place ? "country-wide: the API has no city targeting" : undefined };
  },
};
