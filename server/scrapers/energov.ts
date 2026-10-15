import {
  enerGovApplicationUrl, enerGovSearchRequest, enerGovPageRequest,
  parseEnerGovResponse, assertEnerGovTenant, parseEnerGovDetail,
} from '../scraper';
import { load } from 'cheerio';
import { politeFetch, PortalBlockedError } from './polite-fetch';
import type { AdapterCtx, PermitRecord, PermitSearchType, PortalAdapter } from './types';

type Json = Record<string, any>;
type Session = { app: string; headers: Record<string, string>; template: Json; ctx: AdapterCtx };

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
  if (/captcha|challenge|access denied/i.test(String(data?.ErrorMessage || ''))) throw new PortalBlockedError(url, 403, data.ErrorMessage);
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

/** Follow only published redirects/links, never infer a jurisdiction's hostname or app path. */
export function portalLink(html: string, landingUrl: string): string | null {
  const $ = load(html);
  const refresh = $('meta[http-equiv]').filter((_, el) => $(el).attr('http-equiv')?.toLowerCase() === 'refresh').attr('content');
  const metaTarget = refresh?.match(/(?:^|;)\s*url\s*=\s*['"]?([^'";]+)/i)?.[1]?.trim();
  const scriptTarget = html.match(/(?:window\.)?location(?:\.href)?\s*=\s*["']([^"']+)["']/i)?.[1];
  const targets = metaTarget || scriptTarget ? [metaTarget || scriptTarget!] : $('a[href]').map((_, el) => $(el).attr('href')!).get();
  const portals = new Set<string>();
  for (const target of targets) {
    try {
      const url = new URL(target, landingUrl);
      applicationUrl(url.href);
      portals.add(url.href);
    } catch { /* Not an EnerGov application link. */ }
  }
  if (portals.size > 1) throw new Error('Landing page links to multiple EnerGov portals; configure a tenant URL');
  return [...portals][0] || null;
}

async function resolvePortal(ctx: AdapterCtx): Promise<string> {
  let url = ctx.searchUrl;
  for (let hop = 0; hop < 6; hop++) {
    const parsed = new URL(url);
    if (!/^https?:$/.test(parsed.protocol) || parsed.username || parsed.password) throw new Error('Invalid EnerGov portal URL');
    try { applicationUrl(url); return url; } catch { /* Read a published redirect or application link. */ }
    const res = await politeFetch(url, { redirect: 'manual' }, { minDelayMs: Math.max(1000, ctx.politeness.minDelayMs) });
    if ([301, 302, 303, 307, 308].includes(res.status)) {
      const location = res.headers.get('location');
      if (!location) throw new Error('EnerGov landing redirect has no location');
      url = new URL(location, url).href;
      continue;
    }
    if (!res.ok) throw new Error(`EnerGov landing HTTP ${res.status}: ${url}`);
    const html = await res.text();
    if (/captcha|cf-chl-|just a moment|access denied/i.test(html)) throw new PortalBlockedError(url, 403, 'EnerGov landing challenge');
    const target = portalLink(html, url);
    if (!target) throw new Error('Configured URL does not expose an EnerGov Self Service application');
    url = target;
  }
  throw new Error('EnerGov landing redirects exceeded six hops');
}

async function session(ctx: AdapterCtx): Promise<Session> {
  const portal = await resolvePortal(ctx);
  const app = applicationUrl(portal);
  const tenants = await json(ctx, `${app}/api/Home/GetTenants`, {});
  if (tenants.Success !== true || !Array.isArray(tenants.Result) || !tenants.Result.length) throw new Error('Invalid EnerGov tenant list');
  const headers = tenantHeaders(portal, tenants.Result);
  const criteria = await json(ctx, `${app}/api/energov/search/criteria`, headers);
  if (criteria.Success !== true || !criteria.Result?.PermitCriteria) throw new Error('Invalid EnerGov search criteria');
  return { app, headers, template: criteria.Result, ctx: { ...ctx, searchUrl: portal } };
}

/** Apply the same default permit selections as the live CSS search form. */
export function searchRequest(template: Json, value: string, type: PermitSearchType): Json {
  const payload = enerGovSearchRequest(template, value, type);
  const criteria = payload.PermitCriteria;
  // The keyword box matches ANY word unless the form's "Exact Match" box is ticked: "Able Construction" hit
  // 106,870 Cape Coral permits (every "construction"), past the 100-page cap, and Sunrise's 3,161 OR-hits cost
  // 64 page requests for zero real matches. A name is a phrase; search it as one.
  if (type === 'keyword' && 'ExactMatch' in payload) payload.ExactMatch = true;
  criteria.PermitTypeId ??= 'none';
  criteria.PermitStatusId ??= 'none';
  const sort = template.PermitSortList?.find((s: Json) => ['PermitNumber.keyword', 'PermitNumber'].includes(s.Key))?.Key;
  if (!sort) throw new Error('EnerGov did not advertise a permit-number sort');
  criteria.SortBy = sort;
  payload.SortBy = sort;
  payload.SortAscending = true;
  criteria.SortAscending = true;
  return payload;
}

export function isoDate(value: unknown): string | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}(?:T|$)/.test(value) || !Number.isFinite(Date.parse(value))) return null;
  const calendar = value.slice(0, 10);
  if (new Date(calendar + 'T00:00:00Z').toISOString().slice(0, 10) !== calendar) return null;
  // Search dates without an offset are jurisdiction-local. Preserve the calendar date.
  return /(?:Z|[+-]\d{2}:\d{2})$/.test(value) ? new Date(value).toISOString() : value.slice(0, 10);
}

const nullableText = (value: unknown): string | null => typeof value === 'string' && value.trim() ? value.trim() : null;

export function parseSearch(data: Json, ctx: Pick<AdapterCtx, 'databaseId' | 'jurisdiction' | 'searchUrl'>): { records: PermitRecord[]; totalPages: number } {
  const parsed = parseEnerGovResponse(data);
  if (data.Success !== true) throw new Error('Invalid EnerGov search success flag');
  const records = parsed.results.map((record, index): PermitRecord => {
    const row = data.Result.EntityResults[index];
    const source = new URL(ctx.searchUrl);
    if (/\/civic-access-public(?:\/|$)/i.test(source.pathname)) {
      source.pathname = source.pathname.replace(/\/civic-access-public(?:\/.*)?$/i, `/civic-access-public/details/permit/${encodeURIComponent(row.CaseId || row.EntityId || '')}`);
      source.hash = '';
      source.search = '';
    } else source.hash = `/permit/${encodeURIComponent(row.CaseId || row.EntityId || '')}`;
    return {
      permitNumber: record.permitNumber!, databaseId: ctx.databaseId, jurisdiction: ctx.jurisdiction,
      address: nullableText(record.address), parcel: nullableText(record.parcelNumber),
      lat: null, lng: null, permitType: nullableText(record.permitType), workClass: nullableText(row.CaseWorkclass),
      description: nullableText(record.description), status: nullableText(record.status),
      issuedAt: isoDate(row.IssueDate ?? row.IssuedDate), appliedAt: isoDate(row.ApplyDate),
      expiresAt: isoDate(row.ExpireDate ?? row.ExpirationDate), valuation: null,
      contractorName: nullableText(record.contractorName), contractorLicense: null,
      applicantName: nullableText(record.applicantName), ownerName: null,
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
    s.ctx.log(`EnerGov page ${page}/${parsed.totalPages}: ${parsed.records.length} permits`);
    expectedPages ??= parsed.totalPages;
    if (expectedPages > 100) throw new Error('EnerGov search exceeds 100 pages; narrow the query');
    if (expectedPages !== parsed.totalPages) throw new Error('EnerGov pagination changed during search; retry');
    const fresh = parsed.records.filter(r => !seen.has(String(r.raw?.CaseId || r.raw?.EntityId || r.permitNumber).toLowerCase()));
    if (parsed.records.length && !fresh.length) throw new Error('EnerGov pagination repeated a page');
    for (const r of fresh) { seen.add(String(r.raw?.CaseId || r.raw?.EntityId || r.permitNumber).toLowerCase()); records.push(r); }
    if (page >= parsed.totalPages) return records;
    if (!parsed.records.length) throw new Error('EnerGov pagination ended early');
  }
  throw new Error('EnerGov search exceeds 100 pages; narrow the query');
}

export function recentRequest(template: Json, since: string, until: string, field: 'Issue' | 'Apply'): Json {
  const from = isoDate(since), to = isoDate(until);
  if (!from || !to || Date.parse(since) > Date.parse(until)) throw new Error('Invalid EnerGov date range');
  const payload = searchRequest(template, '', 'permit');
  const criteria = payload.PermitCriteria;
  if (!(field + 'DateFrom' in criteria) || !(field + 'DateTo' in criteria)) throw new Error(`EnerGov does not expose ${field} date search`);
  criteria[field + 'DateFrom'] = since.slice(0, 10) + 'T00:00:00';
  criteria[field + 'DateTo'] = until.slice(0, 10) + 'T23:59:59';
  return payload;
}

export function parseDetail(data: Json, contacts: Json, record: PermitRecord): PermitRecord {
  const caseId = String(record.raw?.CaseId || record.raw?.EntityId || '');
  const parsed = parseEnerGovDetail(data, contacts, record.permitNumber, caseId);
  if (!parsed) throw new Error('EnerGov detail identity or contacts did not match the permit');
  const row = data.Result;
  return {
    ...record, address: row.MainAddress || record.address, parcel: row.MainParcelNumber || record.parcel,
    permitType: row.PermitType || record.permitType, workClass: row.WorkClassName || record.workClass,
    description: row.Description || record.description, status: row.PermitStatus || record.status,
    issuedAt: isoDate(row.IssueDate), appliedAt: isoDate(row.ApplyDate), expiresAt: isoDate(row.ExpireDate),
    valuation: row.ShowValue === true && typeof row.Value === 'number' && Number.isFinite(row.Value) ? row.Value : null,
    contractorName: parsed.Contractor || null, applicantName: parsed.Applicant || null, ownerName: parsed.Owner || null,
    raw: { search: record.raw, detail: data, contacts },
  };
}

async function contactBatches(s: Session, caseId: string, moduleId: number): Promise<Json[]> {
  const batches: Json[] = [];
  const seen = new Set<string>();
  for (let page = 1; page <= 100; page++) {
    const batch = await json(s.ctx, `${s.app}/api/energov/entity/contacts/search/search`, s.headers, {
      PageNumber: page, PageSize: 100, SortField: '', IsSortedInAscendingOrder: true, ModuleId: moduleId, EntityId: caseId,
    });
    if (batch.Success !== true || !Array.isArray(batch.Result)) throw new Error('Invalid EnerGov contacts response');
    const pageCount = Number(batch.PageCount);
    if (!Number.isInteger(pageCount) || pageCount < 0) throw new Error('Invalid EnerGov contacts pagination');
    for (const contact of batch.Result) {
      if (contact.ModuleId !== moduleId || typeof contact.EntityId !== 'string' || contact.EntityId.toLowerCase() !== caseId.toLowerCase()) {
        throw new Error('EnerGov contacts belong to another record');
      }
    }
    const fingerprint = JSON.stringify(batch.Result);
    if (batch.Result.length && seen.has(fingerprint)) throw new Error('EnerGov repeated contacts page');
    seen.add(fingerprint);
    batches.push(batch);
    if (page >= pageCount) return batches;
    if (!batch.Result.length) throw new Error('EnerGov contacts pagination ended early');
  }
  throw new Error('EnerGov contacts exceed 100 pages');
}

function recordId(record: PermitRecord): string {
  const caseId = record.raw?.CaseId || record.raw?.EntityId;
  if (typeof caseId !== 'string' || !/^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(caseId)) throw new Error('EnerGov permit has no valid case ID');
  return caseId;
}

async function detailRecord(s: Session, record: PermitRecord): Promise<PermitRecord> {
  const caseId = recordId(record);
  const data = await json(s.ctx, `${s.app}/api/energov/permits/permitdetail`, s.headers, { EntityId: caseId, ModuleId: 1 });
  if (!parseEnerGovDetail(data, null, record.permitNumber, caseId)) throw new Error('EnerGov detail did not match the requested permit');
  const batches = await contactBatches(s, caseId, 1);
  const result = parseDetail(data, { Success: true, Result: batches.flatMap(b => b.Result) }, record);
  result.raw = { search: record.raw, detail: data, contacts: batches };
  return result;
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
    "Tyler EnerGov Customer Self Service",
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
    "Tyler EnerGov self-service"
],
  capabilities: { search: ['address', 'permit', 'keyword'], listRecent: true, detail: true },
  async search(ctx, q) {
    if (!adapter.capabilities.search.includes(q.type)) throw new Error(`EnerGov does not support ${q.type} search`);
    if (!q.value?.trim()) throw new Error('Search value is empty');
    const s = await session(ctx);
    return pages(s, searchRequest(s.template, q.value.trim(), q.type));
  },
  async listRecent(ctx, since) {
    const until = new Date().toISOString();
    if (!isoDate(since) || Date.parse(since) > Date.parse(until)) throw new Error('Invalid EnerGov since date');
    const s = await session(ctx);
    const records = new Map<string, PermitRecord>();
    for (const field of ['Issue', 'Apply'] as const) {
      const batch = await pages(s, recentRequest(s.template, since, until, field));
      for (const record of batch) {
        const date = field === 'Issue' ? record.issuedAt : record.appliedAt;
        if (!date || date.slice(0, 10) < since.slice(0, 10) || date.slice(0, 10) > until.slice(0, 10)) {
          throw new Error(`EnerGov ignored the ${field} date filter`);
        }
        records.set(String(record.raw?.CaseId || record.raw?.EntityId || record.permitNumber).toLowerCase(), record);
      }
    }
    return [...records.values()];
  },
  async detail(ctx, permitNumber) {
    if (!permitNumber.trim()) throw new Error('Permit number is empty');
    const s = await session(ctx);
    const records = await pages(s, searchRequest(s.template, permitNumber.trim(), 'permit'));
    const matches = records.filter(r => r.permitNumber.toLowerCase() === permitNumber.trim().toLowerCase());
    if (!matches.length) return null;
    if (matches.length !== 1) throw new Error('EnerGov permit number is ambiguous');
    return detailRecord(s, matches[0]);
  },
};
export default adapter;
