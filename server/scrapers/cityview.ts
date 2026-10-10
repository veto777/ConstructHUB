import { load } from "cheerio";
import { politeFetch, PortalBlockedError } from "./polite-fetch";
import type { AdapterCtx, PermitRecord, PortalAdapter } from "./types";

type Identity = Pick<AdapterCtx, "databaseId" | "jurisdiction">;
const text = (v: unknown): string | null => typeof v === "string" && v.trim() ? v.trim() : null;

/** The application root is tenant-specific, including on shared Harris hosts. */
export function cityviewRoot(input: string): string {
  const url = new URL(input);
  if (!/^https?:$/.test(url.protocol) || url.username || url.password || /blueprinceportal|dmcityview\.com/i.test(url.hostname)) {
    throw new Error("Not a supported CityView portal URL");
  }
  const segments = url.pathname.split("/").filter(Boolean);
  const controller = segments.findIndex(s => /^(permit|account|property|planning|codeenforcement|payment)$/i.test(s));
  const root = controller < 0 ? segments : segments.slice(0, controller);
  if (root.length > 1) throw new Error("Unrecognized CityView application root");
  return url.origin + (root.length ? "/" + root.join("/") : "");
}

export function cityviewSearchUrl(root: string, value: string, page: number, category = ""): string {
  const url = new URL(root + "/Permit/LocatorResults");
  url.search = new URLSearchParams({ searchValue: value, category, appealPeriodStatusesOnly: "False", isInspectionSearch: "False", pageNumber: String(page) }).toString();
  return url.href;
}

function publicRecordUrl(input: string, root: string): string {
  const url = new URL(input, root + "/");
  const base = new URL(root);
  const expected = base.pathname.replace(/\/$/, "").toLowerCase() + "/permit/";
  if (url.origin !== base.origin || !url.pathname.toLowerCase().startsWith(expected) || !/\/(?:Status|StatusReference)$/i.test(url.pathname)) {
    throw new Error("CityView returned a record link outside the tenant's public permit pages");
  }
  return url.href;
}

function checkPage(html: string, url: string): void {
  if (/captcha|cf-chl-|verify you are human|access denied/i.test(html)) throw new PortalBlockedError(url, 403, "CityView challenge/access denial");
  if (/type=["']password["']/i.test(html) || /\/Account\/Logon(?:\?|$)/i.test(url)) throw new PortalBlockedError(url, 401, "CityView requires sign-in");
  if (/Session Expired|An unexpected error|Internal Server Error/i.test(html)) throw new Error("CityView session expired or portal error");
}

export function parseCityviewResults(payload: unknown, ctx: Identity, root: string): { records: PermitRecord[]; next: boolean } {
  if (!payload || typeof payload !== "object" || !("View" in payload)) throw new Error("Invalid CityView results response");
  const p = payload as { View: unknown; RedirectUrl?: unknown; LocationMarkers?: unknown };
  if (p.RedirectUrl) {
    if (/captcha/i.test(String(p.RedirectUrl))) throw new PortalBlockedError(root, 403, "CityView redirected to CAPTCHA");
    if (/Logon/i.test(String(p.RedirectUrl))) throw new PortalBlockedError(root, 401, "CityView redirected to sign-in");
    throw new Error(`CityView redirected results: ${String(p.RedirectUrl)}`);
  }
  if (typeof p.View !== "string") throw new Error("CityView results have no HTML view");
  const view = p.View;
  checkPage(view, root);
  const $ = load(view, { sourceCodeLocationInfo: true });
  const markers = Array.isArray(p.LocationMarkers) ? p.LocationMarkers as Record<string, unknown>[] : [];
  const rows = $(".cv-searchresults > ul > li");
  const records: PermitRecord[] = [];
  rows.each((_, row) => {
    const r = $(row);
    const field = (name: string) => text(r.find(`[id^="${name}"]`).filter((_, e) => new RegExp(`^${name}\\d+$`).test($(e).attr("id") ?? "")).first().text());
    const permitNumber = field("permitNumber");
    if (!permitNumber) throw new Error("CityView result missing permit number");
    const marker = markers.find(m => m.ReferenceNumber === permitNumber);
    const locations = r.find(".displayField").filter((_, e) => /^(Locations?|Address):?$/i.test($(e).find("label").first().text().trim())).find(".right1 .basicText").toArray().map(e => $(e).text().trim()).filter(Boolean);
    const href = r.find('a[href*="/Permit/Status?"]').first().attr("href");
    const link = href ?? text(marker?.LinkUri);
    const source = link ? publicRecordUrl(link, root) : null;
    const point = marker?.MapPoint as Record<string, unknown> | undefined;
    const relation = marker?.MapRelationValue as Record<string, unknown> | undefined;
    const loc = (row as unknown as { sourceCodeLocation?: { startOffset: number; endOffset: number } }).sourceCodeLocation;
    records.push({
      permitNumber, ...ctx,
      address: text(marker?.PrimaryLocation) ?? (locations.find(l => /[a-z]/i.test(l)) ?? null),
      parcel: relation?.LayerName === "Parcels" ? text(relation.AttributeValue) : null,
      lat: point?.WKID === 4326 && typeof point.Y === "number" ? point.Y : null,
      lng: point?.WKID === 4326 && typeof point.X === "number" ? point.X : null,
      permitType: field("permitType") ?? text(marker?.ApplicationTypeDescription),
      status: field("permitStatus") ?? text(marker?.StatusDescription),
      description: text(marker?.Description), workClass: null,
      issuedAt: null, appliedAt: null, expiresAt: null, valuation: null,
      contractorName: null, contractorLicense: null, applicantName: null, ownerName: null,
      sourceUrl: source, raw: { html: loc ? view.slice(loc.startOffset, loc.endOffset) : $.html(row), ...(marker ? { marker } : {}) },
    });
  });
  // A changed/error page is not an empty search result.
  if (!records.length && !/no (?:matching |permit |application |search )?(?:results|records|applications|permits|matches)|no records (?:were )?found|did not (?:find|return)/i.test($.text())) {
    throw new Error("Unrecognized CityView empty-results page");
  }
  const next = $("#bnext").length > 0 && !$("#bnext").is("[disabled]");
  if (next && !records.length) throw new Error("CityView empty page has a next link");
  return { records, next };
}

export function cityviewDate(value: string | null): string | null {
  if (!value) return null;
  const m = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  const iso = `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  const d = new Date(iso + "T00:00:00Z");
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === iso ? iso : null;
}

export function parseCityviewDetail(html: string, ctx: Identity, url: string): PermitRecord {
  checkPage(html, url);
  const $ = load(html);
  const field = (id: string) => text($("#" + id).text());
  const permitNumber = field("permitNumber");
  if (!permitNumber || !$("#applicationStatus").length) throw new Error("Unrecognized CityView permit detail page");
  const locations = $("#locations .basicText").toArray().map(e => $(e).text().trim());
  const location = (label: string) => { const at = locations.indexOf(label); return at >= 0 ? locations[at + 1] || null : null; };
  return {
    permitNumber, ...ctx, address: location("Address"), parcel: location("Property"),
    lat: null, lng: null, permitType: field("applicationType"), status: field("applicationStatus"),
    workClass: field("workclass"), description: field("description"),
    appliedAt: cityviewDate(field("dateApplication")), issuedAt: cityviewDate(field("dateIssued")), expiresAt: cityviewDate(field("dateExpiration")),
    valuation: null, contractorName: null, contractorLicense: null, applicantName: null, ownerName: null,
    sourceUrl: url, raw: { html },
  };
}

/** Isolated public HTTP session; no authentication or browser required. */
async function session(ctx: AdapterCtx) {
  const root = cityviewRoot(ctx.searchUrl);
  const cookies = new Map<string, string>();
  async function get(url: string): Promise<{ body: string; url: string }> {
    for (let redirect = 0; redirect < 6; redirect++) {
      if (new URL(url).origin !== new URL(root).origin) throw new Error("CityView redirected outside the portal host");
      const response = await politeFetch(url, { redirect: "manual", headers: { Cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join("; "), "X-Requested-With": "XMLHttpRequest" } }, { minDelayMs: Math.max(1000, ctx.politeness.minDelayMs) });
      for (const cookie of response.headers.getSetCookie()) {
        const pair = cookie.split(";", 1)[0]; const at = pair.indexOf("=");
        if (at > 0) cookies.set(pair.slice(0, at), pair.slice(at + 1));
      }
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get("location");
        if (!location) throw new Error("CityView redirect missing location");
        url = new URL(location, url).href; continue;
      }
      if (!response.ok) throw new Error(`CityView HTTP ${response.status}: ${url}`);
      const body = await response.text(); checkPage(body, url); return { body, url };
    }
    throw new Error("Too many CityView redirects");
  }
  const page = await get(root + "/Permit/Locator");
  const $ = load(page.body);
  if (!$("#permitLocatorForm #searchValue").length || !/\/Permit\/LocatorResults/i.test(page.body)) throw new Error("Not a supported public CityView permit locator");
  return { root, get, category: $("#category").val()?.toString() ?? "" };
}

const adapter: PortalAdapter = {
  platform: "CityView",
  aliases: ["CityView Portal", "CityView Portal (Harris/Granicus)", "CityView Online Portal", "CityView (CentralSquare)"],
  capabilities: { search: ["address", "permit"], listRecent: false, detail: true },
  async search(ctx, q) {
    if (!["address", "permit"].includes(q.type)) throw new Error(`CityView does not support ${q.type} search`);
    if (!q.value?.trim()) throw new Error("CityView search requires a value");
    const s = await session(ctx); const records: PermitRecord[] = []; const seen = new Set<string>();
    for (let page = 0; page < 500; page++) {
      const response = await s.get(cityviewSearchUrl(s.root, q.value.trim(), page, s.category));
      let payload: unknown;
      try { payload = JSON.parse(response.body); } catch { throw new Error("CityView returned non-JSON results"); }
      const redirect = (payload as { RedirectUrl?: unknown })?.RedirectUrl;
      if (typeof redirect === "string" && /\/Permit\/Status\?/i.test(redirect)) {
        const detail = await s.get(publicRecordUrl(redirect, s.root));
        return [parseCityviewDetail(detail.body, { databaseId: ctx.databaseId, jurisdiction: ctx.jurisdiction }, detail.url)];
      }
      const parsed = parseCityviewResults(payload, { databaseId: ctx.databaseId, jurisdiction: ctx.jurisdiction }, s.root);
      let added = 0;
      for (const record of parsed.records) {
        const key = record.sourceUrl ?? record.permitNumber;
        if (!seen.has(key)) { seen.add(key); records.push(record); added++; }
      }
      if (!parsed.next) return records;
      if (!added) throw new Error("CityView repeated a results page");
    }
    throw new Error("CityView search exceeded 500 pages; narrow the query");
  },
  async detail(ctx, permitNumber) {
    const records = await adapter.search(ctx, { type: "permit", value: permitNumber });
    const record = records.find(r => r.permitNumber.toLowerCase() === permitNumber.trim().toLowerCase());
    if (!record) return null;
    if (!record.sourceUrl) throw new Error("CityView permit has no public detail link");
    if (record.raw?.html && typeof record.raw.html === "string" && /id="applicationStatus"/.test(record.raw.html)) return record;
    const s = await session(ctx);
    const page = await s.get(record.sourceUrl);
    return parseCityviewDetail(page.body, { databaseId: ctx.databaseId, jurisdiction: ctx.jurisdiction }, page.url);
  },
  async listRecent(ctx) { cityviewRoot(ctx.searchUrl); ctx.log("CityView public locator has no issued/applied date listing"); return []; },
};
export default adapter;
