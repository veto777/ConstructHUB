import { load } from "cheerio";
import { politeFetch, PortalBlockedError } from "./polite-fetch";
import type { AdapterCtx, PermitRecord, PortalAdapter } from "./types";

type Row = Record<string, unknown>;
const text = (value: unknown): string | null => typeof value === "string" && value.trim() ? value.trim() : null;

/** Verified CivicGov 4 installation path; unrelated department landing pages are rejected. */
export function civicgovPortalUrl(value: string): URL {
  const url = new URL(value);
  if (!/^https?:$/.test(url.protocol) || !/^(?:www\.)?civicgov4\.com$/i.test(url.hostname) ||
      !/^\/[a-z0-9_]+\/portal(?:\/index\.php|\/)?$/i.test(url.pathname)) {
    throw new Error("Unsupported CivicGov portal URL");
  }
  url.protocol = "https:";
  url.pathname = url.pathname.replace(/\/portal.*$/, "/portal/index.php");
  url.hash = "";
  return url;
}

function checkPage(html: string, url: string): void {
  const $ = load(html);
  if (/grecaptcha\s*\.\s*execute|verify you are human|cf-chl-|challenge-platform/i.test(html) ||
      $('.g-recaptcha, .h-captcha, iframe[src*="recaptcha"]').length) {
    throw new PortalBlockedError(url, 403, "CivicGov CAPTCHA/challenge; no search was submitted");
  }
  if ($('input[type="password"]').length) throw new PortalBlockedError(url, 401, "CivicGov login required");
}

/** Only follow the advertised public read-only routes, within the same tenant. */
export function civicgovPublicSearchLink(html: string, base: string): string {
  checkPage(html, base);
  const $ = load(html);
  for (const node of $('a[href]').toArray()) {
    const candidate = new URL($(node).attr('href')!, base);
    const tenant = civicgovPortalUrl(base);
    if (candidate.origin === tenant.origin && candidate.pathname === tenant.pathname &&
        candidate.searchParams.get('r') === 'publicRecordsSearch/index') return candidate.href;
  }
  throw new Error("CivicGov tenant does not advertise Public Records Search; public permit access unavailable");
}

export function civicgovCsrf(html: string, url: string): string {
  checkPage(html, url);
  const token = load(html)('#csrf_token').attr('value');
  if (!token) throw new Error("CivicGov public search missing CSRF token or unexpected layout");
  return token;
}

/** Validate pagination so broken responses never become false empty results or partial success. */
export function parseCivicgovPage(value: unknown, field: 'parcels' | 'permits', expectedPage: number): { rows: Row[]; pages: number } {
  if (!value || typeof value !== 'object') throw new Error("Invalid CivicGov JSON response");
  const data = value as Row;
  const page = Number(data.page), pages = Number(data.pages);
  if (!Array.isArray(data[field]) || !Number.isInteger(page) || page !== expectedPage ||
      !Number.isInteger(pages) || pages < 0 || (pages < page && !(page === 1 && pages === 0 && data[field].length === 0))) {
    throw new Error("Invalid CivicGov pagination/schema");
  }
  const rows = data[field] as unknown[];
  if (rows.some(row => !row || typeof row !== 'object' || Array.isArray(row))) throw new Error("Invalid CivicGov row");
  if (rows.length === 0 && pages > page) throw new Error("CivicGov empty intermediate page");
  return { rows: rows as Row[], pages };
}

export function civicgovDate(value: unknown): string | null {
  const date = text(value);
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const parsed = new Date(date + 'T00:00:00Z');
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date ? date : null;
}

export function parseCivicgovPermit(row: Row, parcel: Row, ctx: Pick<AdapterCtx, 'databaseId' | 'jurisdiction' | 'searchUrl'>): PermitRecord {
  const number = text(row.permit_number_display);
  if (!number || !text(row.id)) throw new Error("CivicGov permit row lacks display number or ID");
  const url = civicgovPortalUrl(ctx.searchUrl);
  url.search = new URLSearchParams({ r: 'permits/view', id: String(row.id), from_parcel_search: String(parcel.parcel_number) }).toString();
  return {
    permitNumber: number, jurisdiction: ctx.jurisdiction, databaseId: ctx.databaseId,
    address: text(parcel.location), parcel: text(parcel.parcel_number),
    lat: null, lng: null, permitType: text(row.permit_type), workClass: text(row.permit_use),
    description: null, status: text(row.display_status),
    appliedAt: civicgovDate(row.file_date), issuedAt: null, expiresAt: null, valuation: null,
    contractorName: null, contractorLicense: null, applicantName: text(row.applicant_name), ownerName: null,
    sourceUrl: url.href, raw: { permit: row, parcel },
  };
}

// An isolated, in-memory cookie jar per search. Cookies/tokens are never logged or returned.
function session(ctx: AdapterCtx, base: URL) {
  const cookies = new Map<string, string>();
  let requests = 0;
  return async (url: string, csrf?: string): Promise<string> => {
    if (++requests > 250) throw new Error("CivicGov search exceeds 250 requests; narrow the address (no partial results returned)");
    const target = new URL(url);
    if (target.origin !== base.origin || target.pathname !== base.pathname) throw new Error("CivicGov cross-tenant request refused");
    const response = await politeFetch(url, {
      redirect: 'manual',
      headers: { ...(cookies.size ? { Cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join('; ') } : {}), ...(csrf ? { 'X-CSRF-Token': csrf } : {}) },
    }, { minDelayMs: Math.max(1000, ctx.politeness.minDelayMs) });
    if ([401, 403, 429].includes(response.status)) throw new PortalBlockedError(url, response.status);
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location') ?? '';
      if (/login/i.test(location)) throw new PortalBlockedError(url, 401, "CivicGov login required");
      throw new Error(`CivicGov unexpected redirect: ${response.status}`);
    }
    if (!response.ok) throw new Error(`CivicGov HTTP ${response.status}`);
    for (const cookie of response.headers.getSetCookie()) {
      const pair = cookie.split(';')[0], equal = pair.indexOf('=');
      if (equal > 0) cookies.set(pair.slice(0, equal), pair.slice(equal + 1));
    }
    const body = await response.text();
    if (body.trimStart().startsWith('<')) checkPage(body, url);
    return body;
  };
}

const adapter: PortalAdapter = {
  platform: 'CivicGov',
  aliases: ['CivicGov portal', 'CivicGov citizen permit portal', 'CivicGov Permit Portal', 'CivicGov permit/project portal', 'CivicGov permits portal', 'CivicGov (Online Licenses and Permits)', 'CivicGov Citizens Portal'],
  capabilities: { search: ['address'], listRecent: false, detail: false },
  async search(ctx, q) {
    const base = civicgovPortalUrl(ctx.searchUrl);
    if (q.type !== 'address') throw new Error(`CivicGov public records search supports address only, not ${q.type}`);
    if (q.value.trim().length < 3) throw new Error("CivicGov address must contain at least three characters");
    const get = session(ctx, base);
    // Preserve the stored landing page query, then follow its public-search link.
    const home = await get(base.href);
    const searchUrl = civicgovPublicSearchLink(home, base.href);
    const searchPage = await get(searchUrl);
    const csrf = civicgovCsrf(searchPage, searchUrl);
    if (!searchPage.includes('publicRecordsSearch/search')) throw new Error("Unrecognized CivicGov search layout");
    const route = (name: string, params: Record<string, string> = {}) => {
      const url = new URL(base);
      url.search = new URLSearchParams({ r: name, ...params }).toString();
      return url.href;
    };
    const parcels: Row[] = [];
    const seenParcels = new Set<string>();
    for (let page = 1, pages = 1; page <= pages; page++) {
      const result = parseCivicgovPage(JSON.parse(await get(route('publicRecordsSearch/search', { query: q.value.trim(), page: String(page) }), csrf)), 'parcels', page);
      pages = result.pages;
      if (pages > 20) throw new Error("CivicGov address is too broad (>20 parcel pages); narrow the address");
      for (const parcel of result.rows) {
        const number = text(parcel.parcel_number);
        if (!number) throw new Error("CivicGov parcel number missing");
        if (!seenParcels.has(number)) { seenParcels.add(number); parcels.push(parcel); }
      }
      if (parcels.length > 100) throw new Error("CivicGov address is too broad (>100 parcels); narrow the address");
    }
    const records = new Map<string, PermitRecord>();
    for (const parcel of parcels) {
      const parcelNumber = String(parcel.parcel_number);
      const detailUrl = route('publicRecordsSearch/parcelDetails', { parcel_number: parcelNumber });
      const detail = await get(detailUrl);
      const detailToken = civicgovCsrf(detail, detailUrl);
      if (!detail.includes('publicRecordsSearch/getPermits')) throw new Error("CivicGov tenant does not expose permits on parcel details");
      for (let page = 1, pages = 1; page <= pages; page++) {
        const result = parseCivicgovPage(JSON.parse(await get(route('publicRecordsSearch/getPermits', { parcel_number: parcelNumber, page: String(page) }), detailToken)), 'permits', page);
        pages = result.pages;
        if (pages > 100) throw new Error("CivicGov parcel exceeds 100 permit pages; refusing partial results");
        for (const row of result.rows) {
          const record = parseCivicgovPermit(row, parcel, ctx);
          records.set(`${row.id}:${parcelNumber}`, record);
        }
      }
    }
    return [...records.values()];
  },
  async listRecent(ctx) {
    civicgovPortalUrl(ctx.searchUrl);
    ctx.log("CivicGov public records search has no global issue/application date listing");
    return [];
  },
};
export default adapter;
