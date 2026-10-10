/**
 * OpenGov / ViewPoint Cloud's public storefront API.
 * See opengov.REPORT.md: live reads currently encounter Turnstile. No challenge
 * tokens, logins, alternative protected endpoints, or browser fallback are used.
 * Request/record shapes below come from the storefront's published JS, not from
 * successful permit fixtures. Keep alerts disabled until date filtering is proven.
 */
import { load } from "cheerio";
import { politeFetch, PortalBlockedError } from "./polite-fetch";
import type { AdapterCtx, PermitRecord, PermitSearchType, PortalAdapter } from "./types";

type Obj = Record<string, unknown>;
const object = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown): string | null => typeof v === "string" && v.trim() ? v.trim() : null;
const id = (v: unknown): string => {
  if ((typeof v === "string" || typeof v === "number") && /^\d+$/.test(String(v))) return String(v);
  throw new Error("OpenGov returned an invalid resource ID");
};

export function portalIdentity(input: string): { tenant: string; origin: string } {
  const url = new URL(input);
  const match = /^([a-z0-9](?:[a-z0-9-]*[a-z0-9])?)\.(?:portal\.opengov\.com|viewpointcloud\.com)$/.exec(url.hostname);
  if (!match || !["https:", "http:"].includes(url.protocol) || url.port || url.username || url.password || /^(api|api-east|api-west|accounts|search|records)$/.test(match[1])) {
    throw new Error("Not an OpenGov Permitting / ViewPoint Cloud tenant portal");
  }
  return { tenant: match[1], origin: `https://${url.hostname}` };
}

export function apiFromHtml(html: string): string {
  const encoded = load(html)('meta[name="store3/config/environment"]').attr("content");
  if (!encoded) throw new Error("OpenGov storefront configuration missing");
  const config: unknown = JSON.parse(decodeURIComponent(encoded));
  if (!object(config) || typeof config.defaultApiUrl !== "string") throw new Error("OpenGov API URL missing");
  const api = new URL(config.defaultApiUrl);
  if (api.protocol !== "https:" || !/^api(?:-[a-z0-9-]+)?\.viewpointcloud\.com$/.test(api.hostname) || api.pathname.replace(/\/$/, "") !== "/v2" || api.port || api.username || api.password || api.search || api.hash) {
    throw new Error("Unexpected OpenGov API URL");
  }
  return api.href.replace(/\/$/, "");
}

export function searchRequest(base: string, type: PermitSearchType, value: string, fetchNumber = 100): string {
  if (type !== "address" && type !== "permit") throw new Error(`OpenGov does not support verified ${type} search`);
  const key = value.trim();
  if (key.length < 2 || key.length > (type === "address" ? 200 : 50)) throw new Error("OpenGov query length is outside the public search limits");
  const url = new URL(`${base}/search_results`);
  url.search = new URLSearchParams({ criteria: type === "address" ? "location" : "record", key, ignoreCommunity: "true", fetchNumber: String(fetchNumber) }).toString();
  return url.href;
}

export function parseJson(body: string, url: string): unknown {
  if (/cf-chl-|cf-turnstile|challenges\.cloudflare\.com|verify you are human|captcha/i.test(body) && /^\s*</.test(body)) {
    throw new PortalBlockedError(url, 403, "OpenGov returned an anti-bot challenge");
  }
  let json: unknown;
  try { json = JSON.parse(body); } catch { throw new Error("OpenGov returned a non-JSON API response"); }
  if (object(json) && (json.errors !== undefined || json.error !== undefined)) {
    if (/forbidden|unauthorized|captcha|turnstile/i.test(JSON.stringify(json))) throw new PortalBlockedError(url, 403, "OpenGov API denied public access");
    throw new Error("OpenGov API returned an error document");
  }
  return json;
}

async function get(ctx: AdapterCtx, url: string, json = true): Promise<unknown> {
  // Reject redirects instead of following a login or a different service.
  const res = await politeFetch(url, { redirect: "manual", headers: { accept: json ? "application/json" : "text/html", sourceApp: "storefront" } }, { minDelayMs: Math.max(1000, ctx.politeness.minDelayMs), retries: 1 });
  if ([401, 403, 429, 503].includes(res.status)) throw new PortalBlockedError(url, res.status);
  if (!res.ok) throw new Error(`OpenGov HTTP ${res.status}: ${url}`);
  const body = await res.text();
  return json ? parseJson(body, url) : body;
}

function iso(v: unknown): string | null {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}(?:T|$)/.test(v) || !Number.isFinite(Date.parse(v))) return null;
  return v.length === 10 ? v : new Date(v).toISOString();
}

/** JSON:API record attributes are camelCase in the published serializer. */
export function parseRecord(row: unknown, ctx: Pick<AdapterCtx, "databaseId" | "jurisdiction">, origin: string): PermitRecord {
  if (!object(row) || row.type !== "records" || !object(row.attributes)) throw new Error("Unexpected OpenGov record shape");
  const a = row.attributes;
  const number = str(a.recordNo);
  if (!number) throw new Error("OpenGov record has no permit/record number");
  return {
    permitNumber: number, jurisdiction: ctx.jurisdiction, databaseId: ctx.databaseId,
    address: str(a.fullAddress), parcel: null, lat: null, lng: null,
    permitType: str(a.recordTypeName), workClass: null, description: str(a.description),
    status: str(a.statusName), issuedAt: null, appliedAt: iso(a.dateSubmitted), expiresAt: iso(a.expirationDate),
    valuation: null, contractorName: null, contractorLicense: null,
    applicantName: str(a.applicantFullName) ?? (str(a.applicantFirstName) || str(a.applicantLastName) ? [str(a.applicantFirstName), str(a.applicantLastName)].filter(Boolean).join(" ") : null),
    ownerName: null, sourceUrl: `${origin}/records/${id(row.id)}`, raw: row,
  };
}

export function searchIds(payload: unknown, type: "address" | "permit"): string[] {
  if (!Array.isArray(payload)) throw new Error("Unexpected OpenGov search response; expected an array");
  const expected = type === "address" ? "location" : "record";
  return payload.map(row => {
    if (!object(row) || row.entityType !== expected) throw new Error("Unexpected OpenGov search entity");
    return id(row.entityID);
  });
}

async function recordPages(ctx: AdapterCtx, first: string, origin: string): Promise<PermitRecord[]> {
  const out: PermitRecord[] = [];
  const seen = new Set<string>();
  let next: string | null = first;
  while (next) {
    if (seen.has(next) || seen.size >= 100) throw new Error("OpenGov record pagination did not terminate");
    seen.add(next);
    const doc = await get(ctx, next);
    if (!object(doc) || !(Array.isArray(doc.data) || object(doc.data))) throw new Error("Unexpected OpenGov JSON:API record document");
    const rows = Array.isArray(doc.data) ? doc.data : [doc.data];
    out.push(...rows.map(row => parseRecord(row, ctx, origin)));
    const link = object(doc.links) ? doc.links.next : null;
    if (link == null) next = null;
    else {
      const href = typeof link === "string" ? link : object(link) && typeof link.href === "string" ? link.href : null;
      if (!href) throw new Error("Invalid OpenGov pagination link");
      const candidate = new URL(href, next);
      const initial = new URL(first);
      if (candidate.origin !== initial.origin || candidate.pathname !== initial.pathname || candidate.username || candidate.password || candidate.hash) throw new Error("Unsafe OpenGov pagination link");
      next = candidate.href;
    }
  }
  return out;
}

async function search(ctx: AdapterCtx, q: { type: PermitSearchType; value: string }): Promise<PermitRecord[]> {
  const { tenant, origin } = portalIdentity(ctx.searchUrl);
  // Validate before any network I/O.
  searchRequest(origin, q.type, q.value);
  const type = q.type as "address" | "permit";
  const base = `${apiFromHtml(await get(ctx, origin, false) as string)}/${tenant}`;
  const settingsUrl = `${base}/general_settings/1`;
  const settings = await get(ctx, settingsUrl);
  if (!object(settings) || !object(settings.data) || !object(settings.data.attributes)) throw new Error("Invalid OpenGov public-search settings");
  const enabled = settings.data.attributes[type === "address" ? "allowPublicLocationSearch" : "allowPublicRecordSearch"];
  if (enabled !== true) {
    if (enabled !== false) throw new Error("OpenGov public-search permission is unknown");
    throw new PortalBlockedError(settingsUrl, 403, `OpenGov tenant has disabled public ${type} search`);
  }
  // The published search-bar uses cumulative fetchNumber, rather than offsets.
  let ids: string[] = [];
  for (let limit = 100; ; limit += 100) {
    const payload = await get(ctx, searchRequest(base, type, q.value, limit));
    ids = searchIds(payload, type);
    if (ids.length < limit) break;
    if (limit >= 1000) throw new Error("OpenGov search is too broad; narrow the query");
  }
  const records: PermitRecord[] = [];
  for (const resultID of new Set(ids)) {
    const url = type === "address" ? `${base}/records?locationID=${resultID}` : `${base}/records/${resultID}`;
    records.push(...await recordPages(ctx, url, origin));
  }
  return [...new Map(records.map(record => [record.sourceUrl, record])).values()];
}

const adapter: PortalAdapter = {
  platform: "OpenGov",
  aliases: [
    "OpenGov Permitting & Licensing",
    "OpenGov Permits (major building permit)",
    "ViewPoint Cloud e-permitting (OpenGov)",
    "OpenGov permitting portal",
    "OpenGov permit portal",
    "OpenGov permit center",
    "OpenGov ViewPoint Cloud permits",
    "OpenGov permit portal (ViewPoint Cloud)",
    "OpenGov Permits portal",
    "OpenGov Permitting & Licensing portal",
    "OpenGov ViewPoint Cloud",
    "OpenGov ViewPoint",
    "OpenGov Permitting",
    "OpenGov (ViewpointCloud) permits portal",
    "PermitSF (OpenGov)",
    "OpenGov Online Permits",
    "OpenGov (ViewPoint Cloud) Permit Portal",
    "OpenGov (ViewPoint Cloud)",
    "OpenGov permit portal (Residential & Commercial Building Permits)",
    "OpenGov Online Permitting",
    "OpenGov Online Permit Center",
    "OpenGov (Benicia Permit Center)",
    "OpenGov Permit System",
    "OpenGov (ViewPoint Cloud) permit portal",
    "OpenGov (Building / Zoning Permit Portal)",
    "OpenGov Permitting (independent city)",
    "OpenGov (ViewPoint Cloud) Online Permitting",
    "OpenGov (Building Permit)",
    "OpenGov Permits",
    "ViewPoint",
    "OpenGov Permitting & Licensing (EZ Permit Hub)",
    "OpenGov License & Permit Portal",
    "OpenGov (Building Permit Application)",
    "OpenGov Online Permit Applications",
    "ViewPoint Cloud / OpenGov (Building Permit Application)",
    "OpenGov Online Permitting Portal",
    "ViewPoint Cloud (OpenGov)",
    "OpenGov Permitting and Licenses Portal",
    "OpenGov Online Permit System",
    "OpenGov Permit Applications",
    "OpenGov Permitting & Licensing Portal",
    "OpenGov (Building Permit Applications)",
    "OpenGov ViewPoint Cloud (Building Department)",
    "OpenGov/ViewPoint",
    "OpenGov (Building Permits)",
    "ViewPoint Cloud / OpenGov",
    "OpenGov (PermitSF)",
    "OpenGov Permitting (Building)",
    "OpenGov Permits & Licensing",
    "OpenGov (Building permits)",
    "ViewPoint Cloud"
],
  capabilities: { search: ["address", "permit"], listRecent: false, detail: false },
  search,
  async listRecent(ctx) {
    portalIdentity(ctx.searchUrl);
    ctx.log("OpenGov date-filtered listing is unverified and unavailable; alerts disabled");
    return [];
  },
};
export default adapter;
