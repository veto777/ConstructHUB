import { readFileSync } from 'node:fs';
import { describe, expect, it, vi, beforeEach } from 'vitest';
vi.mock('./polite-fetch', async importOriginal => ({ ...await importOriginal<typeof import('./polite-fetch')>(), politeJson: vi.fn() }));
import { politeJson, PortalBlockedError } from './polite-fetch';
import adapter, { govwellTenant, govwellSearchRequest, parseGovwellRow } from './govwell';
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
});
