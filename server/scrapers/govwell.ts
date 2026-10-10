import { politeJson, PortalBlockedError } from "./polite-fetch";
import type { AdapterCtx, PermitRecord, PortalAdapter } from "./types";

export type GovWellView = { id: number; viewType: string; filters: unknown[]; columns: { columnTemplateGeneratedId: string; displayLabel: string }[] };
type Dashboard = { id: number; uuid: string; name: string; views: GovWellView[] };
type Json = Record<string, any>;

/** Only the two portal hosts observed in the supplied targets, never marketing/city pages. */
export function govwellTenant(input: string): { origin: string; slug: string } {
  const u = new URL(input);
  if (!['http:', 'https:'].includes(u.protocol) || !['app.govwell.com', 'app.govwelltech.com'].includes(u.hostname) || u.port || u.username || u.password) throw new Error('Not a supported GovWell portal URL');
  const slug = u.pathname.split('/')[1];
  if (!slug || !/^[a-z0-9-]+$/i.test(slug) || ['api', 'sign-in', 'sign-up'].includes(slug)) throw new Error('GovWell tenant slug missing or invalid');
  // govwelltech is the vendor's old portal host; its canonical redirect is verified in REPORT.
  return { origin: 'https://app.govwell.com', slug };
}

export const GOVWELL_DASHBOARDS_QUERY = `query($slug:String!){organizationBySlug(slug:$slug){id slug publishedViewDashboards{id uuid name recordType{id} views{id viewType columns{columnTemplateGeneratedId displayLabel} filters{columnTemplateGeneratedId bool isNull date{type exactStart exactEnd exactStartDateTime exactEndDateTime shouldIncludeTime relativeToTodayCount relativeToTodayDelayType relativeToTodayDirection} number{comparison number} membership{type optionsSelected}}}}}}`;
export const GOVWELL_ROWS_QUERY = `query($dashboardId:Int!,$inputs:[GetViewDashboardViewDataInput!]!){getViewsDataForViewDashboard(dashboardId:$dashboardId,inputs:$inputs){totalCount rows{id record{id uuid identifier issuedIdentifier isDraft isTest submittedAt expirationDate displayStatus{name} recordTemplate{name recordType{isContact isViolationsModule}} mainBackwardsCompatibleLocationInformation{address{str} parcelDisplayName propertyOwner}} columns{__typename ... on ViewDataElementDate{date} ... on ViewDataElementDateTime{dateTime} ... on ViewDataElementString{string} ... on ViewDataElementCompany{company{name}} ... on ViewDataElementUser{user{firstName lastName}} ... on ViewDataElementFieldType{field{label type str num date contact{firstName lastName companyName} record{recordTemplate{name} applicantCompanyOrRequestedToJoinCompany{name} applicantUser{firstName lastName}}}}}}}}`;

async function graphql(ctx: AdapterCtx, query: string, variables: Json): Promise<Json> {
  const { origin } = govwellTenant(ctx.searchUrl);
  const url = `${origin}/api/graphql`;
  const result = await politeJson<Json>(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query, variables }) }, { minDelayMs: Math.max(1000, ctx.politeness.minDelayMs) });
  if (result.errors?.length) {
    const message = result.errors.map((e: Json) => e.message).join('; ');
    if (/unauth|forbidden|permission|captcha/i.test(message)) throw new PortalBlockedError(url, 403, message);
    throw new Error(`GovWell GraphQL: ${message}`);
  }
  if (!result.data || typeof result.data !== 'object') throw new Error('Malformed GovWell GraphQL response');
  return result.data;
}
const str = (v: unknown): string | null => typeof v === 'string' && v.trim() ? v.trim() : null;
export function govwellDate(v: unknown): string | null {
  const s = str(v);
  if (!s || !/^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(s) || !Number.isFinite(Date.parse(s))) return null;
  const calendarDay = new Date(s.slice(0, 10));
  return Number.isFinite(calendarDay.getTime()) && calendarDay.toISOString().slice(0, 10) === s.slice(0, 10) ? s : null;
}

/** Public record-reference labels explicitly separate number, contact, company and submission date. */
export function govwellContractor(field: Json): string | null {
  if (!/contractor/i.test(field.record?.recordTemplate?.name ?? '')) return null;
  const structured = str(field.record?.applicantCompanyOrRequestedToJoinCompany?.name)
    ?? str([field.record?.applicantUser?.firstName, field.record?.applicantUser?.lastName].filter(Boolean).join(' '));
  if (structured) return structured;
  const parts = str(field.str)?.split(' | ');
  if (!parts || !/^#/.test(parts[0]) || !/^Submitted \d{1,2}\/\d{1,2}\/\d{2,4}$/.test(parts[parts.length - 1])) return null;
  return parts.length === 4 ? str(parts[2]) : parts.length === 3 ? str(parts[1]) : null;
}

export function govwellDateFilter(column: 'RecordIssuedDate' | 'RecordSubmittedDate', since: string) {
  if (!govwellDate(since)) throw new Error('GovWell recent listing requires an ISO date');
  return [{ columnTemplateGeneratedId: column, date: { type: 'Exact', exactStart: since.slice(0, 10) } }];
}

/** columns are positional and tenant-defined; never reuse another tenant's field IDs. */
export function parseGovwellRow(row: Json, view: GovWellView, ctx: AdapterCtx): PermitRecord | null {
  const r = row.record;
  if (!r) throw new Error('GovWell record dashboard returned a row without a record');
  if (r.isDraft || r.isTest || r.recordTemplate?.recordType?.isViolationsModule) return null;
  const permitNumber = str(r.issuedIdentifier) ?? str(r.identifier);
  if (!permitNumber) throw new Error('GovWell record missing its identifier');
  if (!Array.isArray(row.columns) || row.columns.length !== view.columns.length) throw new Error('GovWell dashboard columns changed');
  const byId = (id: string): Json[] => row.columns[view.columns.findIndex(c => c.columnTemplateGeneratedId === id)] ?? [];
  const fields: Json[] = row.columns.flat().flatMap((v: Json) => v?.field ? [v.field] : []);
  const contactName = (f: Json) => str(f.contact?.companyName) ?? str([f.contact?.firstName, f.contact?.lastName].filter(Boolean).join(' ')) ?? (f.type === 'Record' ? null : str(f.str));
  const contractor = fields.filter(f => /contractor/i.test(f.label) && !/license/i.test(f.label)).map(f => contactName(f) ?? govwellContractor(f)).filter(Boolean);
  view.columns.forEach((column, index) => {
    if (/contractor/i.test(column.displayLabel) && !/license/i.test(column.displayLabel)) {
      for (const element of row.columns[index] ?? []) {
        const name = str(element.string) ?? str(element.company?.name) ?? (element.field ? contactName(element.field) ?? govwellContractor(element.field) : null);
        if (name) contractor.push(name);
      }
    }
  });
  const location = r.mainBackwardsCompatibleLocationInformation;
  const { origin, slug } = govwellTenant(ctx.searchUrl);
  const valuation = fields.find(f => /(?:estimated.*cost|cost.*construction|valuation)/i.test(f.label) && f.type === 'Currency');
  return {
    permitNumber, jurisdiction: ctx.jurisdiction, databaseId: ctx.databaseId,
    address: str(location?.address?.str) ?? str(byId('RecordAddress')[0]?.string),
    parcel: str(location?.parcelDisplayName), lat: null, lng: null,
    permitType: str(r.recordTemplate?.name), workClass: null,
    description: str(fields.find(f => /(?:project|work).*description|description.*(?:project|work)/i.test(f.label))?.str),
    status: str(r.displayStatus?.name),
    issuedAt: govwellDate(byId('RecordIssuedDate')[0]?.date ?? byId('RecordIssuedDate')[0]?.dateTime),
    appliedAt: govwellDate(r.submittedAt), expiresAt: govwellDate(r.expirationDate),
    valuation: typeof valuation?.num === 'number' && Number.isFinite(valuation.num) ? valuation.num : null,
    contractorName: contractor.length ? [...new Set(contractor)].join('; ') : null,
    contractorLicense: str(fields.find(f => /contractor.*license|license.*number/i.test(f.label))?.str),
    applicantName: (fields.find(f => /^applicant$/i.test(f.label)) ? contactName(fields.find(f => /^applicant$/i.test(f.label))!) : null) ?? str(byId('RecordApplicant')[0]?.string) ?? str([byId('RecordApplicant')[0]?.user?.firstName, byId('RecordApplicant')[0]?.user?.lastName].filter(Boolean).join(' ')),
    ownerName: str(location?.propertyOwner) ?? (fields.find(f => /property owner/i.test(f.label)) ? contactName(fields.find(f => /property owner/i.test(f.label))!) : null),
    sourceUrl: str(r.uuid) ? `${origin}/${slug}/public-record/${encodeURIComponent(r.uuid)}` : null,
    raw: row,
  };
}

export function govwellSearchRequest(dashboardId: number, viewId: number, searchQuery: string, offset = 0, filters: unknown[] = []) {
  return { dashboardId, inputs: [{ viewId, searchQuery, limit: 50, offset, sorts: [], filters }] };
}
async function dashboards(ctx: AdapterCtx): Promise<{ dashboard: Dashboard; view: GovWellView }[]> {
  const { slug } = govwellTenant(ctx.searchUrl);
  const data = await graphql(ctx, GOVWELL_DASHBOARDS_QUERY, { slug });
  const org = data.organizationBySlug;
  if (!org || org.slug !== slug || !Array.isArray(org.publishedViewDashboards)) throw new Error('GovWell tenant not found or invalid dashboard response');
  if (!org.publishedViewDashboards.length) throw new Error('GovWell tenant has no published public record dashboards');
  const selected: { dashboard: Dashboard; view: GovWellView }[] = [];
  for (const dashboard of org.publishedViewDashboards as Dashboard[]) {
    const publicViews = dashboard.views.filter(v => v.viewType === 'RecordsForPublicInModule');
    if (!publicViews.length) throw new Error(`GovWell dashboard ${dashboard.name} has no supported public record view`);
    const all = publicViews.find(v => v.filters.length === 0);
    for (const view of all ? [all] : publicViews) selected.push({ dashboard, view });
  }
  return selected;
}
async function collect(ctx: AdapterCtx, dashboard: Dashboard, view: GovWellView, value: string, filters: unknown[] = []): Promise<PermitRecord[]> {
  const out: PermitRecord[] = [];
  const ids = new Set<unknown>();
  for (let offset = 0; offset < 10000; offset += 50) {
    const data = await graphql(ctx, GOVWELL_ROWS_QUERY, govwellSearchRequest(dashboard.id, view.id, value, offset, [...view.filters, ...filters]));
    const result = data.getViewsDataForViewDashboard?.[0];
    if (!result || !Number.isInteger(result.totalCount) || result.totalCount < 0 || !Array.isArray(result.rows)) throw new Error('Malformed GovWell record page');
    if (offset === 0) ctx.log(`Public dashboard ${dashboard.name}, view ${view.id}: ${result.totalCount} matching rows`);
    for (const row of result.rows) {
      if (ids.has(row.id)) throw new Error('GovWell repeated a row during pagination; retry search');
      ids.add(row.id);
      const record = parseGovwellRow(row, view, ctx);
      if (record) out.push(record);
    }
    if (offset + result.rows.length >= result.totalCount) return out;
    if (result.rows.length !== 50) throw new Error('GovWell returned an incomplete record page');
  }
  throw new Error('GovWell search exceeds 10000 rows; narrow the query');
}
const adapter: PortalAdapter = {
  platform: 'GovWell',
  aliases: ['GovWell permit portal', 'GovWell Permit Portal', 'GovWell online permitting', 'GovWell online building permit applications', 'GovWell building permit application', 'GovWell (Butte-Silver Bow permitting portal)', 'GovWell (Bellevue Permits Portal)', 'GovWell (town zoning permits)', 'GovWell online permits'],
  capabilities: { search: ['address', 'permit', 'company', 'name', 'keyword'], listRecent: true, detail: true },
  async search(ctx, q) {
    govwellTenant(ctx.searchUrl);
    if (!adapter.capabilities.search.includes(q.type)) throw new Error(`GovWell does not support ${q.type} search`);
    const value = q.value.trim();
    if (!value) throw new Error('GovWell search requires a nonempty value');
    const out = new Map<string, PermitRecord>();
    for (const { dashboard, view } of await dashboards(ctx)) {
      for (const record of await collect(ctx, dashboard, view, value)) {
        const companyIndex = view.columns.findIndex(c => c.columnTemplateGeneratedId === 'RecordApplicantCompany');
        const companies = ((record.raw?.columns as Json[][])[companyIndex] ?? []).map(e => e.company?.name ?? e.string).filter(Boolean);
        const field = q.type === 'permit' ? record.permitNumber : q.type === 'address' ? record.address : q.type === 'company' ? [record.contractorName, ...companies].filter(Boolean).join(' ') : [record.applicantName, record.ownerName, record.contractorName].filter(Boolean).join(' ');
        if (q.type === 'keyword' || field?.toLowerCase().includes(value.toLowerCase())) out.set(record.sourceUrl ?? record.permitNumber, record);
      }
    }
    return [...out.values()];
  },
  async listRecent(ctx, since) {
    govwellTenant(ctx.searchUrl);
    // Two server-side date queries implement issued OR submitted, never a text-search scan.
    const filters = [govwellDateFilter('RecordIssuedDate', since), govwellDateFilter('RecordSubmittedDate', since)];
    const out = new Map<string, PermitRecord>();
    for (const { dashboard, view } of await dashboards(ctx)) {
      for (let i = 0; i < filters.length; i++) {
        for (const record of await collect(ctx, dashboard, view, '', filters[i])) {
          if (i === 0 && record.issuedAt?.includes('T') && Date.parse(record.issuedAt) < Date.parse(since)) continue;
          if (i === 1 && (!record.appliedAt || Date.parse(record.appliedAt) < Date.parse(since))) continue;
          out.set(record.sourceUrl ?? record.permitNumber, record);
        }
      }
    }
    return [...out.values()];
  },
  async detail(ctx, permitNumber) {
    const matches = (await adapter.search(ctx, { type: 'permit', value: permitNumber }))
      .filter(r => r.permitNumber.toLowerCase() === permitNumber.trim().toLowerCase());
    if (matches.length > 1) throw new Error('GovWell permit number is ambiguous across public dashboards');
    return matches[0] ?? null;
  },
};
export default adapter;
