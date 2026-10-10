import * as cheerio from "cheerio";
import type { AdapterCtx, PermitRecord, PermitSearchType, PortalAdapter } from "./types";
import { politeFetch, PortalBlockedError } from "./polite-fetch";

export function sdlTenantUrl(input: string): string {
  let u = new URL(input);
  const validate = (url: URL) => {
    if (!["http:", "https:"].includes(url.protocol) || !["sdlportal.com", "www.sdlportal.com", "sync.sdlportal.com"].includes(url.hostname) || url.username || url.password || url.port) throw new Error("Not a supported SDL Portal URL");
  };
  validate(u);
  if (u.pathname === "/login") {
    const redirect = u.searchParams.get("redirect");
    if (!redirect) throw new Error("SDL login URL has no tenant");
    u = new URL(redirect, u); validate(u);
  }
  const match = /^\/towns\/([a-z]{2})\/([a-z0-9_-]+)\/([a-z0-9_-]+)(?:\/|$)/i.exec(u.pathname);
  if (!match) throw new Error("SDL URL has no recognized town identifier");
  u.protocol = "https:";
  u.pathname = `/towns/${match[1]}/${match[2]}/${match[3]}`;
  u.search = ""; u.hash = "";
  return u.href;
}

export function sdlSearchUrl(base: string, q: { type: PermitSearchType; value: string } | { since: string; until: string }): string {
  const url = new URL(`${base}/search2`);
  const p = new URLSearchParams({ st: "permits", as: "1", limit: "100", stps: "all", stpd: "all", psd: "0", ped: "0" });
  if ("type" in q) {
    const field = { address: "loc", permit: "pc", keyword: "kw" }[q.type as "address" | "permit" | "keyword"];
    if (!field) throw new Error(`SDL does not support ${q.type} search`);
    if (!q.value.trim()) throw new Error("SDL requires a nonempty query");
    p.set(field, q.value.trim());
  } else {
    // The public calendar sends Unix seconds, and SDL compares timestamps.
    // Recorded same-day midnight bounds missed real permits. Pad the native
    // range for timezone/day boundaries, then filter the returned issue dates.
    p.set("psd", String(Date.parse(`${q.since}T00:00:00Z`) / 1000 - 86400));
    p.set("ped", String(Date.parse(`${q.until}T00:00:00Z`) / 1000 + 2 * 86400));
  }
  url.search = p.toString();
  return url.href;
}

function date(value: string | null): string | null {
  const m = value && /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value);
  if (!m) return null;
  const iso = `${m[3]}-${m[1]}-${m[2]}`, d = new Date(`${iso}T00:00:00Z`);
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === iso ? iso : null;
}

export function parseSdlResults(html: string, ctx: Pick<AdapterCtx, "databaseId" | "jurisdiction">, base: string): { records: PermitRecord[]; truncated: boolean } {
  const $ = cheerio.load(html, { sourceCodeLocationInfo: true });
  if (/cf-chl-|captcha|verify you are human/i.test(html)) throw new PortalBlockedError(base, 403, "SDL challenge");
  if ($('input[type="password"]').length) throw new PortalBlockedError(base, 401, "SDL permit search requires login");
  const table = $("table").filter((_, e) => $(e).find("thead").text().includes("Control #") && $(e).find("thead").text().includes("Permit #")).first();
  if (!table.length) throw new Error("SDL returned no recognized permit results table");
  const headers = table.find("thead td, thead th").map((_, e) => $(e).text().trim()).get();
  const required = ["Control #", "Permit #", "Issue Date", "Location", "Work Type", "Work Description", "Status"];
  if (required.some(h => !headers.includes(h))) throw new Error("SDL result columns changed");
  const records: PermitRecord[] = [];
  const rows = table.find("tbody tr");
  if (table.text().includes("No results were found.")) {
    if (rows.length !== 1) throw new Error("Inconsistent SDL empty results");
    return { records: [], truncated: false };
  }
  if (!rows.length) throw new Error("SDL returned an empty table without a no-results marker");
  rows.each((_, row) => {
    const cells = $(row).children("td");
    if (cells.length !== headers.length) throw new Error("Unexpected SDL result row");
    const field = (name: string) => cells.eq(headers.indexOf(name)).text().replace(/\s+/g, " ").trim() || null;
    const permitNumber = field("Permit #");
    // Control numbers belong to applications and are retained in raw, never substituted for permit numbers.
    if (!permitNumber) return;
    const href = cells.eq(headers.indexOf("Control #")).find("a").attr("href");
    let sourceUrl: string | null = null;
    if (href) {
      const url = new URL(href, base);
      if (url.origin !== new URL(base).origin || !url.pathname.startsWith(new URL(base).pathname + "/building/permits/")) throw new Error("SDL returned an unexpected record link");
      sourceUrl = url.href;
    }
    records.push({ permitNumber, databaseId: ctx.databaseId, jurisdiction: ctx.jurisdiction, address: field("Location"), lat: null, lng: null, status: field("Status"), issuedAt: date(field("Issue Date")), appliedAt: null, expiresAt: null, permitType: headers.includes("Subcodes") ? field("Subcodes") : null, workClass: field("Work Type"), description: field("Work Description"), parcel: null, contractorName: null, contractorLicense: null, applicantName: null, ownerName: null, valuation: null, sourceUrl, raw: { html: html.slice(row.sourceCodeLocation!.startOffset, row.sourceCodeLocation!.endOffset) } });
  });
  return { records, truncated: /Only the first \d+ are displayed/i.test($.text()) };
}

async function fetchResults(ctx: AdapterCtx, base: string, url: string) {
  const response = await politeFetch(url, { redirect: "manual" }, { minDelayMs: Math.max(1000, ctx.politeness.minDelayMs) });
  if (response.status >= 300 && response.status < 400 && /(?:^|\/)login(?:[?\/]|$)/i.test(response.headers.get("location") ?? "")) throw new PortalBlockedError(url, 401, "SDL redirected to login");
  if (!response.ok) throw new Error(`SDL HTTP ${response.status}: ${url}`);
  if (new URL(response.url || url).pathname === "/login") throw new PortalBlockedError(url, 401, "SDL redirected to login");
  return parseSdlResults(await response.text(), ctx, base);
}

const adapter: PortalAdapter = {
  platform: "SDL Portal",
  aliases: [
    "SDL",
    "SDL Permit Portal",
    "SDL Portal (Building Inspection Portal)",
    "SDL Portal (Building Inspection)",
    "SDL Portal (Building Permits)",
    "SDL Portal (Citizen Login)",
    "SDL Portal (Citizen Portal)",
    "SDL Portal (Citizen/Contractor Portal)",
    "SDL Portal (Construction Permit)",
    "SDL Portal (Construction Permits)",
    "SDL Portal (Construction requests)",
    "SDL Portal (Construction work permit)",
    "SDL Portal (Inspection Request)",
    "SDL Portal (Inspection Requests)",
    "SDL Portal (Inspections)",
    "SDL Portal (My Permit Information)",
    "SDL Portal (Permit Tracking)",
    "SDL Portal (Permit and Inspection Portal)",
    "SDL Portal (Permit, Inspections & Property Information)",
    "SDL Portal (Permits and Inspections)",
    "SDL Portal (Permits)",
    "SDL Portal (Property/Permit Lookup)",
    "SDL Portal (Requests)",
    "SDL Portal (Schedule an Inspection)",
    "SDL Portal (Status of Building Permit)",
    "SDL Portal (borough construction permits)",
    "SDL Portal (city construction permits)",
    "SDL Portal (permit application)",
    "SDL Portal (permit search)",
    "SDL Portal (permit status search)"
],
  capabilities: { search: ["address", "permit", "keyword"], listRecent: true, detail: false },
  async search(ctx, q) {
    const base = sdlTenantUrl(ctx.searchUrl);
    const result = await fetchResults(ctx, base, sdlSearchUrl(base, q));
    if (result.truncated) throw new Error("SDL search exceeds its 100-result limit; narrow the query");
    return result.records;
  },
  async listRecent(ctx, since) {
    const base = sdlTenantUrl(ctx.searchUrl), d = new Date(since);
    if (!/^\d{4}-\d{2}-\d{2}(?:T|$)/.test(since) || !Number.isFinite(d.getTime())) throw new Error("Invalid since date");
    const start = d.toISOString().slice(0, 10), end = new Date().toISOString().slice(0, 10);
    if (start > end) return [];
    let requests = 0;
    async function range(from: string, to: string): Promise<PermitRecord[]> {
      if (++requests > 128) throw new Error("SDL recent listing exceeds safe date-partition limit");
      const result = await fetchResults(ctx, base, sdlSearchUrl(base, { since: from, until: to }));
      if (result.truncated) {
        if (from === to) throw new Error(`SDL has more than 100 results on ${from}; cannot retrieve a complete listing`);
        const mid = Math.floor((Date.parse(from) + Date.parse(to)) / 2 / 86400000) * 86400000;
        return [...await range(from, new Date(mid).toISOString().slice(0, 10)), ...await range(new Date(mid + 86400000).toISOString().slice(0, 10), to)];
      }
      const paddedStart = new Date(Date.parse(from) - 86400000).toISOString().slice(0, 10);
      const paddedEnd = new Date(Date.parse(to) + 2 * 86400000).toISOString().slice(0, 10);
      if (result.records.some(r => !r.issuedAt || r.issuedAt < paddedStart || r.issuedAt > paddedEnd)) throw new Error("SDL did not honor the issue-date filter");
      return result.records.filter(r => r.issuedAt! >= from && r.issuedAt! <= to);
    }
    return range(start, end);
  },
};
export default adapter;
