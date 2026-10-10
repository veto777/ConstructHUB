import { readFileSync } from 'node:fs';
import { describe, expect, it, vi, beforeEach } from 'vitest';
vi.mock('../scraper', () => ({ scrapeByPlatform: vi.fn() }));
vi.mock('./polite-fetch', async importOriginal => ({ ...await importOriginal<typeof import('./polite-fetch')>(), politeJson: vi.fn() }));
import { politeJson, PortalBlockedError } from './polite-fetch';
import adapter, { govwellTenant, govwellSearchRequest, parseGovwellRow, govwellDateFilter, govwellDate } from './govwell';
import { getAdapter } from './registry';
import permitlink from './permitlink';
import type { AdapterCtx } from './types';
const fixture = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/govwell/${name}.json`, import.meta.url), 'utf8'));
const org = fixture('macon-dashboards');
const response = fixture('macon-address');
const view = org.data.organizationBySlug.publishedViewDashboards[0].views[0];
const ctx: AdapterCtx = { databaseId: 7, databaseName: 'Macon', jurisdiction: 'Macon County, NC', searchUrl: 'https://app.govwell.com/macon-county-nc', portalUrl: null, browser: vi.fn(), log: vi.fn(), politeness: { minDelayMs: 1000 } };
beforeEach(() => vi.mocked(politeJson).mockReset());
describe('GovWell public dashboards', () => {
  it('derives tenants and rejects unrelated URLs', () => {
    expect(govwellTenant('http://app.govwell.com/fairview/125/pick').slug).toBe('fairview');
    expect(() => govwellTenant('https://app.govwell.com.evil.test/macon')).toThrow();
    expect(() => govwellTenant('https://www.plymouthin.com/egov/apps/services/index.egov')).toThrow();
    expect(() => govwellTenant('https://app.govwell.com/')).toThrow();
  });
  it('preserves tenant-specific request values without interpolation', () => {
    expect(govwellSearchRequest(166, 536831, '120 LAURELWOOD', 50).inputs[0]).toEqual({ viewId: 536831, searchQuery: '120 LAURELWOOD', offset: 50, limit: 50, sorts: [], filters: [] });
  });
  it('maps recorded public rows and does not mistake an owner exemption for a contractor', () => {
    const row = response.data.getViewsDataForViewDashboard[0].rows[0];
    const record = parseGovwellRow(row, view, ctx)!;
    expect(record).toMatchObject({ permitNumber: 'R-ADD-26-0085', address: '120 LAURELWOOD DR, HIGHLANDS, NC 28741', status: 'Submitted', issuedAt: null, appliedAt: '2026-10-09T20:32:57.828Z', contractorName: null, valuation: 19999, applicantName: 'Vance Bailey', databaseId: 7 });
    expect(record.sourceUrl).toBe('https://app.govwell.com/macon-county-nc/public-record/e123239e-509e-4931-b0bd-9ee279cc789c');
    expect(record.raw).toBe(row);
  });
  it('searches the public API offline using recorded responses', async () => {
    vi.mocked(politeJson).mockResolvedValueOnce(org).mockResolvedValueOnce(response);
    const records = await adapter.search(ctx, { type: 'address', value: '120 LAURELWOOD' });
    expect(records).toHaveLength(7);
    expect(politeJson).toHaveBeenCalledTimes(2);
  });
  it('does not turn unpublished dashboards, GraphQL errors, or blocks into no results', async () => {
    vi.mocked(politeJson).mockResolvedValueOnce(fixture('belle-glade-no-dashboards'));
    await expect(adapter.search({ ...ctx, searchUrl: 'https://app.govwell.com/belle-glade-fl' }, { type: 'permit', value: '100' })).rejects.toThrow('no published');
    vi.mocked(politeJson).mockResolvedValueOnce({ errors: [{ message: 'Forbidden' }] });
    await expect(adapter.search(ctx, { type: 'permit', value: '100' })).rejects.toBeInstanceOf(PortalBlockedError);
    vi.mocked(politeJson).mockRejectedValueOnce(new PortalBlockedError(ctx.searchUrl, 429));
    await expect(adapter.search(ctx, { type: 'permit', value: '100' })).rejects.toBeInstanceOf(PortalBlockedError);
  });
  it('paginates both recent date queries and deduplicates their overlap', async () => {
    vi.mocked(politeJson).mockResolvedValueOnce(org)
      .mockResolvedValueOnce(fixture('macon-RecordIssuedDate-0'))
      .mockResolvedValueOnce(fixture('macon-RecordIssuedDate-50'))
      .mockResolvedValueOnce(fixture('macon-RecordSubmittedDate-0'))
      .mockResolvedValueOnce(fixture('macon-RecordSubmittedDate-50'));
    const records = await adapter.listRecent(ctx, '2026-10-03');
    expect(records).toHaveLength(94);
    expect(new Set(records.map(r => r.sourceUrl)).size).toBe(94);
    expect(records[0]).toMatchObject({ permitNumber: 'ELC-26-0199', contractorName: 'Bumgarner Electric Company', issuedAt: '2026-10-09T15:34:14.570Z' });
    const requests = vi.mocked(politeJson).mock.calls.slice(1).map(c => JSON.parse(c[1]!.body as string).variables.inputs[0]);
    expect(requests.map(r => r.offset)).toEqual([0, 50, 0, 50]);
    expect(requests.map(r => r.filters[0].columnTemplateGeneratedId)).toEqual(['RecordIssuedDate', 'RecordIssuedDate', 'RecordSubmittedDate', 'RecordSubmittedDate']);
    expect(requests.every(r => r.searchQuery === '')).toBe(true);
  });
  it('rejects repeated pages rather than returning partial data', async () => {
    vi.mocked(politeJson).mockResolvedValueOnce(org)
      .mockResolvedValueOnce(fixture('macon-RecordIssuedDate-0'))
      .mockResolvedValueOnce(fixture('macon-RecordIssuedDate-0'));
    await expect(adapter.listRecent(ctx, '2026-10-03')).rejects.toThrow('repeated');
  });
  it('recognizes a real empty API result and does not call a browser', async () => {
    vi.mocked(politeJson).mockResolvedValueOnce(org).mockResolvedValueOnce(fixture('macon-no-results'));
    expect(await adapter.search(ctx, { type: 'permit', value: 'CONSTRUCTHUB-NO-MATCH-20261010' })).toEqual([]);
    expect(ctx.browser).not.toHaveBeenCalled();
  });
  it('keeps Cape Elizabeth permits even when GovWell marks their module isContact', () => {
    const rows = fixture('cape-two-records').data.getViewsDataForViewDashboard[0].rows;
    const view = fixture('cape-dashboards').data.organizationBySlug.publishedViewDashboards[0].views[0];
    const capeCtx = { ...ctx, searchUrl: 'https://app.govwell.com/cape-elizabeth', jurisdiction: 'Cape Elizabeth, ME' };
    expect(rows.map((row: any) => parseGovwellRow(row, view, capeCtx)?.permitNumber)).toEqual(['ELEC-26-0280', 'BLD-26-0205']);
  });
  it('preserves the public filters on every Cape Elizabeth view', async () => {
    const cape = fixture('cape-dashboards');
    vi.mocked(politeJson).mockResolvedValue(fixture('macon-no-results')).mockResolvedValueOnce(cape);
    const records = await adapter.search({ ...ctx, searchUrl: 'https://app.govwell.com/cape-elizabeth' }, { type: 'permit', value: 'CONSTRUCTHUB-NO-MATCH-20261010' });
    expect(records).toEqual([]);
    const views = cape.data.organizationBySlug.publishedViewDashboards[0].views;
    expect(politeJson).toHaveBeenCalledTimes(views.length + 1);
    vi.mocked(politeJson).mock.calls.slice(1).forEach((call, i) => {
      expect(JSON.parse(call[1]!.body as string).variables.inputs[0].filters).toEqual(views[i].filters);
    });
  });
  it('reads Raynham applicant companies as public string columns without inventing contractor names', () => {
    const org = fixture('raynham-dashboards');
    const view = org.data.organizationBySlug.publishedViewDashboards[0].views[0];
    const rows = fixture('raynham-company').data.getViewsDataForViewDashboard[0].rows;
    const row = rows.find((r: any) => r.record.issuedIdentifier === 'R-ROOF-26-0073');
    expect(row).toBeDefined();
    const record = parseGovwellRow(row, view, { ...ctx, searchUrl: 'https://app.govwell.com/raynham-ma' });
    expect(record).toMatchObject({ permitNumber: 'R-ROOF-26-0073', contractorName: null });
    expect(row.columns[3][0].string).toBe('Southern New England Windows');
  });
  it('validates dates and refuses unsupported search types before making requests', async () => {
    expect(govwellDateFilter('RecordIssuedDate', '2026-10-03T12:00:00Z')).toEqual([{ columnTemplateGeneratedId: 'RecordIssuedDate', date: { type: 'Exact', exactStart: '2026-10-03' } }]);
    expect(govwellDate('2026-02-31')).toBeNull();
    await expect(adapter.listRecent(ctx, 'not a date')).rejects.toThrow('ISO date');
    await expect(adapter.search(ctx, { type: 'license', value: '123' })).rejects.toThrow('does not support');
    expect(politeJson).not.toHaveBeenCalled();
  });

  it('registers every supported label without claiming the Plymouth city-link label', () => {
    for (const label of [adapter.platform, ...adapter.aliases!]) expect(getAdapter(`  ${label.toUpperCase()}  `)).toBe(adapter);
    for (const label of [permitlink.platform, ...permitlink.aliases!]) expect(getAdapter(label)).toBe(permitlink);
    expect(getAdapter('GovWell (via city link)')).toBeNull();
  });

});
