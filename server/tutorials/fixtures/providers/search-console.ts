/**
 * SEARCH CONSOLE — the worked SKELETON of a platform provider fixture. NOT WIRED IN YET.
 *
 * It shows the shape every platform provider (Google Business Profile, Google Ads, Cloudflare, SEO
 * data, Site Scan) takes — see "Adding a provider" in docs/tutorials/FIXTURES.md:
 *
 *   1. an adapter with a `fetch` that answers the provider's hosts with fictional data;
 *   2. ONE line at the feature's seam. For Search Console that seam already exists:
 *      `new SearchConsoleClient(token, http)` (server/gsc/client.ts) and `gscToken(c, http)`
 *      (server/gsc/service.ts) both take the fetch to use —
 *          const http = providerFixture<SearchConsoleFixture>("search-console")?.fetch ?? fetch;
 *   3. connection state: an `edge_connections` row for the demo owner (encrypted with the slot's
 *      own key, so written in `onBoot`, like HOVER's);
 *   4. a step script, operated first.
 *
 * Steps 2–4 are left for the platform videos; nothing in server/gsc reads this file today. The
 * data below is complete and tested, so wiring it is those three small steps.
 *
 * Everything is invented: the property is a reserved example name, the queries are generic, and
 * the numbers come from a fixed formula (no randomness — a re-record shows the same chart).
 */
import { defineProviderFixture, requireTutorialFixtures } from "../registry";

export type SearchConsoleFixture = { property: string; fetch: typeof fetch };

/** `.example` is reserved (RFC 2606): it can never be a real site. */
export const FIXTURE_GSC_PROPERTY = "sc-domain:gatorbuilders-demo.example";
const SITE = "https://gatorbuilders-demo.example";

const QUERIES = ["flooring contractor near me", "hardwood floor installation", "luxury vinyl plank installers", "kitchen backsplash tile", "cabinet refinishing cost", "bathroom tile contractor", "floor refinishing", "lvp flooring company"];
const PAGES = ["/", "/hardwood-flooring", "/luxury-vinyl-plank", "/tile", "/cabinet-refinishing", "/contact"];

const ymd = (d: Date) => d.toISOString().slice(0, 10);
/** 28 days ending yesterday: a weekly rhythm (quieter weekends) on a slow upward trend. */
export function fixtureGscDays(today: Date = new Date()): { date: string; clicks: number; impressions: number; ctr: number; position: number }[] {
  const out = [];
  for (let i = 28; i >= 1; i--) {
    const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - i));
    const n = 28 - i, weekend = d.getUTCDay() === 0 || d.getUTCDay() === 6;
    const impressions = Math.round((640 + n * 9 + ((n * 37) % 53)) * (weekend ? 0.62 : 1));
    const clicks = Math.round(impressions * (0.031 + ((n * 7) % 5) * 0.002));
    out.push({ date: ymd(d), clicks, impressions, ctr: clicks / impressions, position: Number((14.8 - n * 0.11 + ((n * 3) % 4) * 0.2).toFixed(1)) });
  }
  return out;
}
const share = (i: number, n: number) => (n - i) / ((n * (n + 1)) / 2);

const gscFetch: typeof fetch = async (input, init = {}) => {
  requireTutorialFixtures("the Search Console stand-in");
  const url = new URL(String(input));
  const method = String(init.method || "GET").toUpperCase();
  if (url.hostname === "oauth2.googleapis.com" && url.pathname === "/token")
    return Response.json({ access_token: "tutfx-gsc-access", expires_in: 3600, scope: "https://www.googleapis.com/auth/webmasters", token_type: "Bearer" });
  if (url.hostname === "www.googleapis.com" && url.pathname === "/webmasters/v3/sites" && method === "GET")
    return Response.json({ siteEntry: [{ siteUrl: FIXTURE_GSC_PROPERTY, permissionLevel: "siteOwner" }] });
  const m = /^\/webmasters\/v3\/sites\/([^/]+)\/searchAnalytics\/query$/.exec(url.pathname);
  if (url.hostname === "www.googleapis.com" && m && method === "POST") {
    if (decodeURIComponent(m[1]) !== FIXTURE_GSC_PROPERTY) return Response.json({ error: { message: "not a property of the stand-in" } }, { status: 403 });
    let body: any = {};
    try { body = JSON.parse(String(init.body || "{}")); } catch { /* an empty query */ }
    const days = fixtureGscDays();
    const dims: string[] = Array.isArray(body.dimensions) ? body.dimensions : [];
    const total = days.reduce((a, d) => ({ clicks: a.clicks + d.clicks, impressions: a.impressions + d.impressions }), { clicks: 0, impressions: 0 });
    const by = (keys: string[]) => keys.map((k, i) => {
      const s = share(i, keys.length), impressions = Math.round(total.impressions * s), clicks = Math.round(total.clicks * s);
      return { keys: [k], clicks, impressions, ctr: impressions ? clicks / impressions : 0, position: Number((4.2 + i * 2.3).toFixed(1)) };
    });
    const rows = dims[0] === "date" ? days.map((d) => ({ keys: [d.date], clicks: d.clicks, impressions: d.impressions, ctr: d.ctr, position: d.position }))
      : dims[0] === "query" ? by(QUERIES)
      : dims[0] === "page" ? by(PAGES.map((p) => `${SITE}${p}`))
      : [{ keys: [], ...total, ctr: total.clicks / total.impressions, position: 12.1 }];
    return Response.json({ rows: rows.slice(0, Number(body.rowLimit) || 1000), responseAggregationType: "byProperty" });
  }
  return Response.json({ error: { message: `The Search Console stand-in does not implement ${method} ${url.hostname}${url.pathname}` } }, { status: 400 });
};

export const searchConsoleFixture = defineProviderFixture<SearchConsoleFixture>({
  id: "search-console",
  simulates: "SKELETON, not wired: a verified Search Console property (gatorbuilders-demo.example) with 28 days of performance by date, query and page.",
  seam: "server/gsc/client.ts SearchConsoleClient(token, http) and server/gsc/service.ts gscToken(c, http) — pass this adapter's fetch (not done yet)",
  adapter: () => ({ property: FIXTURE_GSC_PROPERTY, fetch: gscFetch }),
});
