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

export const GOVWELL_DASHBOARDS_QUERY = `query($slug:String!){organizationBySlug(slug:$slug){id slug publishedViewDashboards{id uuid name recordType{id} views{id viewType columns{columnTemplateGeneratedId displayLabel} filters{columnTemplateGeneratedId}}}}}`;
export const GOVWELL_ROWS_QUERY = `query($dashboardId:Int!,$inputs:[GetViewDashboardViewDataInput!]!){getViewsDataForViewDashboard(dashboardId:$dashboardId,inputs:$inputs){totalCount rows{id record{id uuid identifier issuedIdentifier isDraft isTest submittedAt expirationDate displayStatus{name} recordTemplate{name recordType{isContact isViolationsModule}} mainBackwardsCompatibleLocationInformation{address{str} parcelDisplayName propertyOwner}} columns{__typename ... on ViewDataElementDate{date} ... on ViewDataElementDateTime{dateTime} ... on ViewDataElementString{string} ... on ViewDataElementFieldType{field{label type str num date contact{firstName lastName companyName} record{recordTemplate{name} applicantCompanyOrRequestedToJoinCompany{name} applicantUser{firstName lastName}}}}}}}}`;

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
  return s && /^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(s) && Number.isFinite(Date.parse(s)) ? s : null;
}

/** columns are positional and tenant-defined; never reuse another tenant's field IDs. */
export function parseGovwellRow(row: Json, view: GovWellView, ctx: AdapterCtx): PermitRecord | null {
  const r = row.record;
  if (!r) throw new Error('GovWell record dashboard returned a row without a record');
  if (r.isDraft || r.isTest || r.recordTemplate?.recordType?.isContact || r.recordTemplate?.recordType?.isViolationsModule) return null;
  const permitNumber = str(r.issuedIdentifier) ?? str(r.identifier);
  if (!permitNumber) throw new Error('GovWell record missing its identifier');
  if (!Array.isArray(row.columns) || row.columns.length !== view.columns.length) throw new Error('GovWell dashboard columns changed');
  const byId = (id: string): Json[] => row.columns[view.columns.findIndex(c => c.columnTemplateGeneratedId === id)] ?? [];
  const fields: Json[] = row.columns.flat().flatMap((v: Json) => v?.field ? [v.field] : []);
  const contactName = (f: Json) => str(f.contact?.companyName) ?? str([f.contact?.firstName, f.contact?.lastName].filter(Boolean).join(' ')) ?? (f.type === 'Record' ? null : str(f.str));
  const contractor = fields.filter(f => /contractor/i.test(f.label)).map(f => contactName(f) ?? (/contractor/i.test(f.record?.recordTemplate?.name ?? '') ? str(f.record?.applicantCompanyOrRequestedToJoinCompany?.name) ?? str([f.record?.applicantUser?.firstName, f.record?.applicantUser?.lastName].filter(Boolean).join(' ')) : null)).filter(Boolean);
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
    applicantName: fields.find(f => /^applicant$/i.test(f.label)) ? contactName(fields.find(f => /^applicant$/i.test(f.label))!) : null,
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
  return org.publishedViewDashboards.map((dashboard: Dashboard) => {
    const view = dashboard.views.find(v => v.viewType === 'RecordsForPublicInModule' && v.filters.length === 0);
    if (!view) throw new Error(`GovWell dashboard ${dashboard.name} has no supported unfiltered public record view`);
    return { dashboard, view };
  });
}
async function collect(ctx: AdapterCtx, dashboard: Dashboard, view: GovWellView, value: string, filters: unknown[] = []): Promise<PermitRecord[]> {
  const out: PermitRecord[] = [];
  const ids = new Set<unknown>();
  for (let offset = 0; offset < 10000; offset += 50) {
    const data = await graphql(ctx, GOVWELL_ROWS_QUERY, govwellSearchRequest(dashboard.id, view.id, value, offset, filters));
    const result = data.getViewsDataForViewDashboard?.[0];
    if (!result || !Number.isInteger(result.totalCount) || result.totalCount < 0 || !Array.isArray(result.rows)) throw new Error('Malformed GovWell record page');
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
  capabilities: { search: ['address', 'permit'], listRecent: false, detail: false },
  async search(ctx, q) {
    govwellTenant(ctx.searchUrl);
    if (!adapter.capabilities.search.includes(q.type)) throw new Error(`GovWell does not support ${q.type} search`);
    const value = q.value.trim();
    if (!value) throw new Error('GovWell search requires a nonempty value');
    const out = new Map<string, PermitRecord>();
    for (const { dashboard, view } of await dashboards(ctx)) {
      for (const record of await collect(ctx, dashboard, view, value)) {
        const field = q.type === 'permit' ? record.permitNumber : record.address;
        if (field?.toLowerCase().includes(value.toLowerCase())) out.set(record.sourceUrl ?? record.permitNumber, record);
      }
    }
    return [...out.values()];
  },
  async listRecent(ctx) { govwellTenant(ctx.searchUrl); return []; },
};
export default adapter;
