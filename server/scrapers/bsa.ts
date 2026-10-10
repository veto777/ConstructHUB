import { load } from "cheerio";
import { politeFetch, PortalBlockedError } from "./polite-fetch";
import type { AdapterCtx, PermitRecord, PermitSearchType, PortalAdapter } from "./types";

export function bsaTenant(input: string): { origin: string; uid: string } {
  const url = new URL(input);
  if (!/^https?:$/.test(url.protocol) || !/^(www\.)?bsaonline\.com$/i.test(url.hostname) || url.username || url.password || url.port) {
    throw new Error(`Not a BS&A Online portal URL: ${input}`);
  }
  const ids = [...url.searchParams].filter(([key]) => key.toLowerCase() === "uid").map(([, value]) => value);
  if (ids.length !== 1 || !/^[1-9]\d*$/.test(ids[0])) throw new Error("BS&A Online URL must contain one numeric municipality uid");
  return { origin: "https://bsaonline.com", uid: ids[0] };
}

const clean = (s: string) => s.replace(/\s+/g, " ").trim();

export function assertBsaPage(html: string, url: string): void {
  const $ = load(html);
  $("script,style,noscript").remove();
  const text = clean($.text());
  // Normal pages include a global CAPTCHA script; only an actual challenge is a block.
  if (/just a moment|verify (?:that )?you are human|unusual traffic|complete (?:the |this )?captcha|access denied|checking your browser/i.test(text) || $(".g-recaptcha, .h-captcha, #challenge-form").length) {
    throw new PortalBlockedError(url, 403, "BS&A Online CAPTCHA or access challenge; automation stopped");
  }
  if (/building department.{0,100}(?:not available|not enabled|not supported)|(?:not available|not enabled).{0,100}building department/i.test(text)) {
    throw new Error("BS&A Online Building Department not available for this municipality");
  }
  if (/an error has occurred|more detailed search term is required|session (?:has )?expired|unable to (?:process|complete)/i.test(text)) {
    throw new Error(`BS&A Online portal error: ${text.slice(0, 400)}`);
  }
  if (/\/(?:Account\/(?:Login|LogOn)|Login)(?:[/?]|$)/i.test(new URL(url).pathname)) throw new Error("BS&A Online requires login; only public records are supported");
}

/** A new cookie jar per search. Redirects are rate limited and confined to this tenant. */
export class BsaSession {
  readonly tenant;
  private cookies = new Map<string, string>();
  constructor(private ctx: AdapterCtx) { this.tenant = bsaTenant(ctx.searchUrl); }
  url(path: string, params: Record<string, string> = {}): string {
    const u = new URL(path, this.tenant.origin);
    if (!/^https:$/.test(u.protocol) || !/^(www\.)?bsaonline\.com$/i.test(u.hostname) || u.port || u.username || u.password) throw new Error("BS&A Online redirected outside its public portal");
    const uid = u.searchParams.get("uid");
    if (uid && uid !== this.tenant.uid) throw new Error("BS&A Online changed municipality unexpectedly");
    u.hostname = "bsaonline.com";
    u.searchParams.set("uid", this.tenant.uid);
    for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
    return u.href;
  }
  async request(path: string, params: Record<string, string> = {}, form?: Record<string, string>): Promise<{ html: string; url: string }> {
    let url = this.url(path, params);
    for (let redirects = 0; redirects < 8; redirects++) {
      const headers: Record<string, string> = { cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; ") };
      if (/Get.*PartialView|PropertyAndParcelDetails|SelectBinding|UpdateAdvancedRecordSearch/.test(new URL(url).pathname)) headers["x-requested-with"] = "XMLHttpRequest";
      if (form) headers["content-type"] = "application/x-www-form-urlencoded";
      const res = await politeFetch(url, { method: form ? "POST" : "GET", body: form ? new URLSearchParams(form).toString() : undefined, headers, redirect: "manual" }, { minDelayMs: Math.max(1000, this.ctx.politeness.minDelayMs) });
      for (const cookie of res.headers.getSetCookie()) {
        const first = cookie.split(";")[0]; const i = first.indexOf("=");
        if (i > 0) this.cookies.set(first.slice(0, i), first.slice(i + 1));
      }
      const html = await res.text();
      if ([301, 302, 303, 307, 308].includes(res.status)) {
        const location = res.headers.get("location");
        if (!location) throw new Error("BS&A Online redirect without a location");
        url = this.url(new URL(location, url).href);
        if ([301, 302, 303].includes(res.status)) form = undefined;
        continue;
      }
      if (!res.ok) throw new Error(`BS&A Online HTTP ${res.status} at ${url}`);
      assertBsaPage(html, url);
      return { html, url };
    }
    throw new Error("BS&A Online redirect loop or expired search session");
  }
}

export function parseBsaSearchForm(html: string): Map<string, string> {
  const $ = load(html), types = new Map<string, string>();
  $("#record-search-tab-container li[value]").each((_, e) => {
    types.set(clean($(e).text()).toLowerCase(), $(e).attr("value")!);
  });
  if (!types.size) throw new Error("BS&A Online search form unavailable or unsupported");
  return types;
}

export type BsaHit = { recordKey: string; recordKeyType: string; referenceKey: string; referenceKeyType: string; html: string };
export function parseBsaSearchResults(html: string): { hits: BsaHit[]; total: number; nextPage: number | null } {
  assertBsaPage(html, "https://bsaonline.com/");
  const $ = load(html), count = clean($(".find-record-record-count-container").text()).match(/^([\d,]+) results?$/i);
  if (!count) throw new Error("BS&A Online search results missing an explicit result count");
  const total = Number(count[1].replace(/,/g, "")), hits: BsaHit[] = [];
  $(".find-record-search-result-wrapper").each((_, e) => {
    const action = $(e).find("[onclick]").attr("onclick") ?? "";
    const m = action.match(/gotToRecord\('([^']*)',\s*(\d+),\s*'([^']*)',\s*(\d+)\)/);
    if (!m) throw new Error("BS&A Online result navigation is unsupported");
    hits.push({ recordKey: m[1], recordKeyType: m[2], referenceKey: m[3], referenceKeyType: m[4], html: $.html(e) });
  });
  if ((total > 0 && !hits.length) || (total === 0 && hits.length)) throw new Error("BS&A Online result count does not match rows");
  const next = $(".page-link").filter((_, e) => clean($(e).text()) === "Next" && $(e).attr("aria-disabled") === "false").attr("value");
  return { hits, total, nextPage: next ? Number(next) : null };
}

export async function beginBsaSearch(session: BsaSession, type: PermitSearchType): Promise<{ guid: string; searchType: string }> {
  const home = await session.request("/Home/MunicipalityHome");
  const $ = load(home.html);
  if (!$("a[href]").toArray().some(e => /\/SiteSearch\/BuildingDepartmentRecordSearch/i.test($(e).attr("href") ?? ""))) {
    throw new Error("BS&A Online Building Department record search not available for this municipality");
  }
  const entry = await session.request("/SiteSearch/BuildingDepartmentRecordSearch");
  const guid = load(entry.html)("#AdvancedRecordSearchSessionGuid").val();
  if (typeof guid !== "string" || !guid) throw new Error("BS&A Online search session unavailable");
  const form = await session.request("/SiteSearch/GetAdvancedRecordSearchFindRecordStepPartialView", { advancedRecordSearchSessionGuid: guid });
  const types = parseBsaSearchForm(form.html);
  const label = ({ address: "address", permit: "record number", name: "name" } as Partial<Record<PermitSearchType, string>>)[type];
  const searchType = label ? types.get(label) : undefined;
  if (!searchType) throw new Error(`BS&A Online does not support ${type} search for this municipality`);
  return { guid, searchType };
}

export function bsaDate(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const ms = value.match(/^\/Date\((-?\d+)(?:[+-]\d{4})?\)\/$/);
  if (ms) {
    const date = new Date(Number(ms[1]));
    return Number.isFinite(date.getTime()) && date.getUTCFullYear() > 1900 ? date.toISOString().slice(0, 10) : null;
  }
  const us = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s.*)?$/);
  const iso = value.match(/^(\d{4})-(\d{2})-(\d{2})(?:T.*)?$/);
  const parts = us ? [Number(us[3]), Number(us[1]), Number(us[2])] : iso ? [Number(iso[1]), Number(iso[2]), Number(iso[3])] : null;
  if (!parts) return null;
  const [y, m, d] = parts, date = new Date(Date.UTC(y, m - 1, d));
  return y > 1900 && date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d ? date.toISOString().slice(0, 10) : null;
}

export function bsaPermitGridUrl(html: string): string {
  const m = html.match(/"selectUrl":("[^"\r\n]*\/GridPermitsSelectBinding[^"\r\n]*")/);
  if (!m) throw new Error("BS&A Online public permit grid unavailable for this property or municipality");
  return JSON.parse(m[1]);
}

const nullableText = (value: unknown): string | null => typeof value === "string" && clean(value) ? clean(value) : null;
export function parseBsaPermitGrid(payload: unknown, ctx: Pick<AdapterCtx, "databaseId" | "jurisdiction">, property: { address: string | null; parcel: string | null }, baseUrl: string): { records: PermitRecord[]; total: number } {
  if (!payload || typeof payload !== "object") throw new Error("BS&A Online invalid permit grid response");
  const data = payload as { data?: unknown; total?: unknown; modelState?: unknown };
  if (!Array.isArray(data.data) || !Number.isInteger(data.total) || Number(data.total) < 0) throw new Error("BS&A Online permit grid missing data/total");
  const records = data.data.map((value): PermitRecord => {
    if (!value || typeof value !== "object") throw new Error("BS&A Online invalid permit row");
    const r = value as Record<string, unknown>;
    const permitNumber = nullableText(r.PermitNumber);
    if (!permitNumber) throw new Error("BS&A Online permit row missing permit number");
    const link = typeof r.DetailLink === "string" ? load(r.DetailLink)("a[href]").attr("href") : null;
    let sourceUrl: string | null = null;
    if (link) {
      const u = new URL(link, baseUrl), b = new URL(baseUrl);
      if (u.origin !== b.origin || !/^\/CD_PropertySearchDetails\/PropertyRecordDetails$/i.test(u.pathname)) throw new Error("BS&A Online unexpected permit detail link");
      if (u.searchParams.get("uid") !== b.searchParams.get("uid")) throw new Error("BS&A Online permit link changed municipality");
      sourceUrl = u.href;
    }
    return {
      permitNumber, databaseId: ctx.databaseId, jurisdiction: ctx.jurisdiction,
      address: property.address, parcel: property.parcel, lat: null, lng: null,
      permitType: nullableText(r.PermitType), workClass: nullableText(r.Category), description: nullableText(r.WorkDescription), status: nullableText(r.Status),
      issuedAt: bsaDate(r.IssuedDate), appliedAt: bsaDate(r.AppliedDate), expiresAt: bsaDate(r.ExpiresDate),
      // Summary grids send unpopulated person summaries and a default construction value of 0.
      valuation: null, contractorName: null, contractorLicense: null, applicantName: null, ownerName: null,
      sourceUrl, raw: r,
    };
  });
  if (records.length > Number(data.total) || (Number(data.total) > 0 && !records.length)) throw new Error("BS&A Online permit grid count does not match rows");
  return { records, total: Number(data.total) };
}

async function propertyPermits(session: BsaSession, ctx: AdapterCtx, detail: { html: string; url: string }, hit: BsaHit): Promise<PermitRecord[]> {
  const $ = load(detail.html);
  const recordKey = $("#PropertyRecordKey").val(), token = $("#SubPageAuthToken").val(), reference = $("#SubPageAuthReferenceKey").val();
  if (typeof recordKey !== "string" || typeof token !== "string" || typeof reference !== "string") throw new Error("BS&A Online property detail is unavailable");
  if (recordKey !== `7=${hit.recordKey}`) throw new Error("BS&A Online returned a different associated property; public property selection is required");
  const property = await session.request("/CD_PropertySearchV3/PropertyAndParcelDetails", { recordKey, SubPageAuthToken: token, ReferenceKey: reference });
  const gridUrl = bsaPermitGridUrl(property.html), p = load(property.html);
  const address = nullableText(p("#Property_Address_DisplayAddress").val()) ?? nullableText($("#HiddenAddress").val());
  const parcel = nullableText($("#ParcelNumber").val());
  const records: PermitRecord[] = [], seen = new Set<string>();
  let expectedTotal: number | undefined;
  for (let page = 1; page <= 100; page++) {
    const response = await session.request(gridUrl, {}, { page: String(page), size: "10" });
    let payload: unknown;
    try { payload = JSON.parse(response.html); } catch { throw new Error("BS&A Online permit grid did not return JSON"); }
    const parsed = parseBsaPermitGrid(payload, ctx, { address, parcel }, session.url("/"));
    if (expectedTotal !== undefined && expectedTotal !== parsed.total) throw new Error("BS&A Online permit count changed during paging; retry search");
    expectedTotal = parsed.total;
    for (const r of parsed.records) {
      const key = r.sourceUrl ?? r.permitNumber;
      if (seen.has(key)) throw new Error("BS&A Online repeated permit grid page");
      seen.add(key); records.push(r);
    }
    if (records.length === parsed.total) return records;
  }
  throw new Error("BS&A Online permit grid exceeded 100 pages; narrow the search");
}

async function search(ctx: AdapterCtx, q: { type: PermitSearchType; value: string }): Promise<PermitRecord[]> {
  const session = new BsaSession(ctx);
  if (!["address", "permit", "name"].includes(q.type)) throw new Error(`BS&A Online does not support ${q.type} search`);
  if (!q.value?.trim()) throw new Error("BS&A Online requires a nonempty search term");
  const { guid, searchType } = await beginBsaSearch(session, q.type);
  const hits: BsaHit[] = [], seen = new Set<string>();
  let currentPage = 1, total: number | undefined;
  for (let count = 0; count < 100; count++) {
    const result = await session.request("/SiteSearch/GetPageOfFindRecordSearchResultsPartialView", { advancedRecordSearchSessionGuid: guid, currentPage: String(currentPage), searchText: q.value.trim(), bsaOnlineSiteSearchType: searchType });
    const parsed = parseBsaSearchResults(result.html);
    if (total !== undefined && total !== parsed.total) throw new Error("BS&A Online result count changed during paging; retry search");
    total = parsed.total;
    if (total > 100) throw new Error(`BS&A Online search matched ${total} records; narrow the search to 100 or fewer`);
    for (const hit of parsed.hits) {
      const key = `${hit.recordKeyType}:${hit.recordKey}:${hit.referenceKey}`;
      if (seen.has(key)) throw new Error("BS&A Online repeated search results page");
      seen.add(key); hits.push(hit);
    }
    if (!parsed.nextPage) break;
    if (parsed.nextPage <= currentPage) throw new Error("BS&A Online invalid next page");
    currentPage = parsed.nextPage;
  }
  if (hits.length !== total) throw new Error("BS&A Online incomplete search pagination");
  const records = new Map<string, PermitRecord>();
  for (const hit of hits) {
    const selected = await session.request("/SiteSearch/UpdateAdvancedRecordSearchFindRecordStep", {}, {
      advancedRecordSearchSessionGuid: guid, currentPage: "1", searchText: q.value.trim(), bsaOnlineSiteSearchType: searchType,
      recordKey: hit.recordKey, recordKeyType: hit.recordKeyType, referenceKey: hit.referenceKey, referenceKeyType: hit.referenceKeyType,
    });
    if (JSON.parse(selected.html).success !== true) throw new Error("BS&A Online could not select public search result");
    const detail = await session.request("/SiteSearch/GoToRecord", { advancedRecordSearchSessionGuid: guid });
    const found = load(detail.html)("#PropertyRecordKey").length ? await propertyPermits(session, ctx, detail, hit) : [parseBsaPermitDetail(detail.html, ctx, detail.url)];
    for (const record of found) records.set(record.sourceUrl ?? record.permitNumber, record);
  }
  return [...records.values()];
}

export function parseBsaPermitDetail(html: string, ctx: Pick<AdapterCtx, "databaseId" | "jurisdiction">, sourceUrl: string): PermitRecord {
  assertBsaPage(html, sourceUrl);
  const $ = load(html);
  const section = (heading: string) => $(".accordion-item").filter((_, e) => clean($(e).children(".accordion-header").text()) === heading).first();
  const values = (element: ReturnType<typeof section>) => {
    const map = new Map<string, string>();
    element.find(".label-value-row").each((_, e) => { map.set(clean($(e).find(".label-value-row-label").text()), clean($(e).find(".label-value-row-value").text())); });
    return map;
  };
  const info = values(section("Permit Information"));
  const permitNumber = nullableText(info.get("Permit Number"));
  if (!permitNumber) throw new Error("BS&A Online response is not a public permit detail page");
  const person = (heading: string, field = "Name") => {
    const text = nullableText(values(section(heading)).get(field));
    return text && !/^no data to display$/i.test(text) ? text : null;
  };
  const header = clean($(".record-details-header2").text());
  const address = nullableText(header.match(/Property Address:\s*(.*?)(?:\||Parcel:|$)/i)?.[1]);
  const parcel = nullableText($(".record-details-header2 a").filter((_, e) => ($(e).attr("href") ?? "").includes("ReferenceKey=")).first().text());
  const value = info.get("Construction Value") ?? info.get("Valuation");
  const valuation = value && /^\$?[\d,]+(?:\.\d+)?$/.test(value) ? Number(value.replace(/[$,]/g, "")) : null;
  return {
    permitNumber, databaseId: ctx.databaseId, jurisdiction: ctx.jurisdiction, address, parcel, lat: null, lng: null,
    permitType: nullableText(info.get("Permit Type")), workClass: nullableText(info.get("Category")), description: nullableText(info.get("Work Description")),
    status: nullableText(info.get("Status")), issuedAt: bsaDate(info.get("Issued Date")), appliedAt: bsaDate(info.get("Applied Date")), expiresAt: bsaDate(info.get("Expires Date")),
    valuation, contractorName: person("Contractor Information"), contractorLicense: person("Contractor Information", "License Number"),
    applicantName: person("Applicant Information"), ownerName: person("Owner Information"), sourceUrl,
    raw: { html: html.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i)?.[1] ?? html },
  };
}

const adapter: PortalAdapter = {
  platform: "BS&A Online",
  aliases: ["BS&A", "BS&A Online permit application", "BS&A Online (Harrison Charter Township)", "BS&A Online e-permitting", "BS&A Online permit portal", "BS&A Online (myNixa)", "BS&A Online (Building Permit Inquiry)", "BS&A Online (building permit search/payment)", "BS&A Online (City of Hot Springs)"],
  capabilities: { search: ["address", "permit", "name"], listRecent: false, detail: true },
  search,
  async listRecent(ctx, since) {
    bsaTenant(ctx.searchUrl);
    if (!Number.isFinite(Date.parse(since))) throw new Error("BS&A Online listRecent requires an ISO date");
    ctx.log("BS&A Online has no verified public issue/application-date listing; listRecent is unsupported");
    return [];
  },
  async detail(ctx, permitNumber) {
    const records = await search(ctx, { type: "permit", value: permitNumber });
    const matches = records.filter(r => r.permitNumber.toLowerCase() === permitNumber.trim().toLowerCase());
    if (matches.length > 1) throw new Error("BS&A Online permit number is ambiguous");
    return matches[0] ?? null;
  },
};
export default adapter;
