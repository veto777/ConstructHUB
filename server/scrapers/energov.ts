import {
  enerGovApplicationUrl, enerGovSearchRequest, enerGovPageRequest,
  parseEnerGovResponse, assertEnerGovTenant,
} from '../scraper';
import { politeFetch, PortalBlockedError } from './polite-fetch';
import type { AdapterCtx, PermitRecord, PermitSearchType, PortalAdapter } from './types';

type Json = Record<string, any>;
type Session = { app: string; portal: string; headers: Record<string, string>; template: Json; ctx: AdapterCtx };

/** Civic Access deployments retain the public CSS API at the sibling SelfService path. */
export function applicationUrl(url: string): string {
  const parsed = new URL(url);
  if (!/^https?:$/.test(parsed.protocol) || parsed.username || parsed.password) throw new Error('Invalid EnerGov portal URL');
  parsed.pathname = parsed.pathname.replace(/\/civic-access-public(?:\/.*)?$/i, '/selfservice');
  return enerGovApplicationUrl(parsed.href);
}

async function json(ctx: AdapterCtx, url: string, headers: Record<string, string>, body?: Json): Promise<Json> {
  const res = await politeFetch(url, {
    method: body ? 'POST' : 'GET', headers,
    ...(body ? { body: JSON.stringify(body) } : {}), redirect: 'error',
  }, { minDelayMs: Math.max(1000, ctx.politeness.minDelayMs) });
  if (!res.ok) throw new Error(`EnerGov HTTP ${res.status}: ${url}`);
  const text = await res.text();
  if (/<!doctype html|<html/i.test(text)) {
    if (/captcha|cloudflare|access denied|just a moment/i.test(text)) throw new PortalBlockedError(url, 403, 'EnerGov challenge page');
    throw new Error(`EnerGov returned HTML instead of JSON: ${url}`);
  }
  const data = JSON.parse(text);
  if ([401, 403, 429].includes(Number(data?.StatusCode))) throw new PortalBlockedError(url, Number(data.StatusCode), data.ErrorMessage);
  if (data?.Success === false) throw new Error(`EnerGov API failure: ${data.ErrorMessage || data.ValidationErrorMessage || data.StatusCode}`);
  return data;
}

export function tenantHeaders(portal: string, tenants: Json[]): Record<string, string> {
  const app = applicationUrl(portal);
  const normalized = new URL(portal);
  // Civic Access's /home is a client route, not a tenant suffix.
  if (/\/civic-access-public(?:\/|$)/i.test(normalized.pathname)) normalized.pathname = new URL(app).pathname;
  const suffix = decodeURIComponent(normalized.pathname.slice(new URL(app).pathname.length)).replace(/^\/|\/$/g, '');
  const selected = suffix
    ? tenants.find(t => [t.TenantUrl, t.TenantName].some(v => typeof v === 'string' && v.toLowerCase() === suffix.toLowerCase()))
    : tenants.length === 1 ? tenants[0] : null;
  if (!selected || selected.TenantID == null || !selected.TenantName || !selected.TenantUrl) {
    throw new Error('EnerGov requires an unambiguous jurisdiction-specific tenant');
  }
  const culture = selected.Cultures?.find((c: Json) => c.IsDefault)?.CultureName;
  const headers = {
    'content-type': 'application/json', tenantid: String(selected.TenantID), tenantname: selected.TenantName,
    'tyler-tenanturl': selected.TenantUrl, 'tyler-tenant-culture': culture || 'en-US',
  };
  assertEnerGovTenant(normalized.href, tenants, headers);
  return headers;
}

async function session(ctx: AdapterCtx): Promise<Session> {
  const app = applicationUrl(ctx.searchUrl);
  const tenants = await json(ctx, `${app}/api/Home/GetTenants`, {});
  if (tenants.Success !== true || !Array.isArray(tenants.Result) || !tenants.Result.length) throw new Error('Invalid EnerGov tenant list');
  const headers = tenantHeaders(ctx.searchUrl, tenants.Result);
  const criteria = await json(ctx, `${app}/api/energov/search/criteria`, headers);
  if (criteria.Success !== true || !criteria.Result?.PermitCriteria) throw new Error('Invalid EnerGov search criteria');
  return { app, portal: ctx.searchUrl, headers, template: criteria.Result, ctx };
}

/** Apply the same default permit selections as the live CSS search form. */
export function searchRequest(template: Json, value: string, type: PermitSearchType): Json {
  const payload = enerGovSearchRequest(template, value, type);
  const criteria = payload.PermitCriteria;
  criteria.PermitTypeId ??= 'none';
  criteria.PermitStatusId ??= 'none';
  const sort = template.PermitSortList?.find((s: Json) => s.Key === 'PermitNumber.keyword')?.Key;
  if (!sort) throw new Error('EnerGov did not advertise a permit-number sort');
  criteria.SortBy = sort;
  payload.SortBy = sort;
  payload.SortAscending = true;
  criteria.SortAscending = true;
  return payload;
}

export function isoDate(value: unknown): string | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}(?:T|$)/.test(value) || !Number.isFinite(Date.parse(value))) return null;
  // Search dates without an offset are jurisdiction-local. Preserve the calendar date.
  return /(?:Z|[+-]\d{2}:\d{2})$/.test(value) ? new Date(value).toISOString() : value.slice(0, 10);
}

export function parseSearch(data: Json, ctx: Pick<AdapterCtx, 'databaseId' | 'jurisdiction' | 'searchUrl'>): { records: PermitRecord[]; totalPages: number } {
  const parsed = parseEnerGovResponse(data);
  const records = parsed.results.map((record, index): PermitRecord => {
    const row = data.Result.EntityResults[index];
    const source = new URL(ctx.searchUrl);
    if (/\/civic-access-public(?:\/|$)/i.test(source.pathname)) {
      source.pathname = new URL(applicationUrl(ctx.searchUrl)).pathname;
    }
    source.hash = `/permit/${encodeURIComponent(row.CaseId || row.EntityId || '')}`;
    return {
      permitNumber: record.permitNumber!, databaseId: ctx.databaseId, jurisdiction: ctx.jurisdiction,
      address: record.address ?? null, parcel: record.parcelNumber ?? null,
      lat: null, lng: null, permitType: record.permitType ?? null, workClass: row.CaseWorkclass || null,
      description: record.description ?? null, status: record.status ?? null,
      issuedAt: isoDate(row.IssueDate ?? row.IssuedDate), appliedAt: isoDate(row.ApplyDate),
      expiresAt: isoDate(row.ExpireDate ?? row.ExpirationDate), valuation: null,
      contractorName: record.contractorName ?? null, contractorLicense: null,
      applicantName: record.applicantName ?? null, ownerName: null,
      sourceUrl: row.CaseId || row.EntityId ? source.href : null, raw: row,
    };
  });
  return { records, totalPages: parsed.totalPages };
}

async function pages(s: Session, request: Json): Promise<PermitRecord[]> {
  const records: PermitRecord[] = [];
  const seen = new Set<string>();
  let expectedPages: number | undefined;
  for (let page = 1; page <= 100; page++) {
    const data = await json(s.ctx, `${s.app}/api/energov/search/search`, s.headers, enerGovPageRequest(request, page));
    const parsed = parseSearch(data, s.ctx);
    expectedPages ??= parsed.totalPages;
    if (expectedPages !== parsed.totalPages) throw new Error('EnerGov pagination changed during search; retry');
    const fresh = parsed.records.filter(r => !seen.has(String(r.raw?.CaseId || r.permitNumber)));
    if (parsed.records.length && !fresh.length) throw new Error('EnerGov pagination repeated a page');
    for (const r of fresh) { seen.add(String(r.raw?.CaseId || r.permitNumber)); records.push(r); }
    if (page >= parsed.totalPages) return records;
    if (!parsed.records.length) throw new Error('EnerGov pagination ended early');
  }
  throw new Error('EnerGov search exceeds 100 pages; narrow the query');
}

const adapter: PortalAdapter = {
  platform: 'Tyler EnerGov',
  aliases: [
    "Civic Access (Tyler EnerGov Self Service)",
    "EnerGov",
    "EnerGov (CompassKC)",
    "EnerGov (Tyler CSS)",
    "EnerGov (Tyler Civic Access)",
    "EnerGov (Wake County)",
    "EnerGov (eTrac Savannah)",
    "EnerGov CSS",
    "EnerGov CSS (APEX) (independent city)",
    "EnerGov CSS (PORT)",
    "EnerGov CSS (independent city)",
    "EnerGov Self Service",
    "PermitSLO (Tyler EnerGov Self Service)",
    "Tyler Civic Access (EnerGov)",
    "Tyler EnerGov (APEX)",
    "Tyler EnerGov (Citizen Access Portal)",
    "Tyler EnerGov (Citizen Self Service)",
    "Tyler EnerGov (Citizen Self-Service)",
    "Tyler EnerGov (Civic Access / CSS)",
    "Tyler EnerGov (Civic Access / Citizens Self Service)",
    "Tyler EnerGov (Civic Access / Fairfield BUILD)",
    "Tyler EnerGov (Civic Access)",
    "Tyler EnerGov (Customer Self Service)",
    "Tyler EnerGov (Development Hub / Self Service)",
    "Tyler EnerGov (EPIC)",
    "Tyler EnerGov (LCAP)",
    "Tyler EnerGov (LPP portal)",
    "Tyler EnerGov (LandMARC)",
    "Tyler EnerGov (MAPPS)",
    "Tyler EnerGov (New Hanover County COAST; county issues building permits within the city)",
    "Tyler EnerGov (OneStop Shop)",
    "Tyler EnerGov (PLUS)",
    "Tyler EnerGov (Park City Portal)",
    "Tyler EnerGov (PermitMidland CSS)",
    "Tyler EnerGov (Scottsdale SPUR)",
    "Tyler EnerGov (Self Service)",
    "Tyler EnerGov (ePermit Center)",
    "Tyler EnerGov (ePlace)",
    "Tyler EnerGov (ePortal)",
    "Tyler EnerGov (eServices)",
    "Tyler EnerGov / Civic Access (Citizen Self Service)",
    "Tyler EnerGov CSS",
    "Tyler EnerGov Citizen Self Service",
    "Tyler EnerGov Citizen Self Service (Civic Access)",
    "Tyler EnerGov Citizen Self-Service",
    "Tyler EnerGov Civic Access",
    "Tyler EnerGov Civic Access (E-OneStop)",
    "Tyler EnerGov Civic Access (Self Service)",
    "Tyler EnerGov Client Self Service",
    "Tyler EnerGov Online Permitting Center",
    "Tyler EnerGov Self Service",
    "Tyler EnerGov Self Service (Citizen Self Service)",
    "Tyler EnerGov Self Service (City Access Portal)",
    "Tyler EnerGov Self Service (Civic Access Portal)",
    "Tyler EnerGov Self Service (Civic Access)",
    "Tyler EnerGov Self Service (EDGE)",
    "Tyler EnerGov Self Service (GO Permit)",
    "Tyler EnerGov Self Service (HV Works)",
    "Tyler EnerGov Self Service (Oakley Civic Access Portal)",
    "Tyler EnerGov Self Service (Oroville Civic Access)",
    "Tyler EnerGov Self Service (PACO)",
    "Tyler EnerGov Self Service (Palm Springs Online)",
    "Tyler EnerGov Self Service (Rancho Cordova Online)",
    "Tyler EnerGov Self Service (SHOP)",
    "Tyler EnerGov Self Service (SJ Connect Online)",
    "Tyler EnerGov Self Service (The HUB)",
    "Tyler EnerGov Self Service (Ventura OPS)",
    "Tyler EnerGov Self Service (Virtual Development Services)",
    "Tyler EnerGov Self Service (Westminster Build)",
    "Tyler EnerGov Self Service (hosted)",
    "Tyler EnerGov Self Service (iPermit)",
    "Tyler EnerGov Self Service (independent city)",
    "Tyler EnerGov SelfService",
    "Tyler EnerGov SelfService (Civic Access)",
    "Tyler EnerGov ePLACE",
    "Tyler EnerGov self-service",
    "Tyler Munis/EnerGov Citizen Self Service",
    "Tyler New World CSS"
],
  capabilities: { search: ['address', 'permit', 'keyword'], listRecent: false, detail: false },
  async search(ctx, q) {
    if (!adapter.capabilities.search.includes(q.type)) throw new Error(`EnerGov does not support ${q.type} search`);
    if (!q.value?.trim()) throw new Error('Search value is empty');
    const s = await session(ctx);
    return pages(s, searchRequest(s.template, q.value.trim(), q.type));
  },
  async listRecent() { return []; },
};
export default adapter;
