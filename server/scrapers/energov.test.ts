import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
vi.mock('../storage', () => ({ storage: {} }));
vi.mock('./polite-fetch', async importOriginal => ({
  ...await importOriginal<typeof import('./polite-fetch')>(), politeFetch: vi.fn(),
}));
import adapter, { applicationUrl, tenantHeaders, searchRequest, recentRequest, parseSearch, parseDetail, isoDate, portalLink } from './energov';
import { politeFetch, PortalBlockedError } from './polite-fetch';
import type { AdapterCtx } from './types';

const fixture = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/energov/${name}.json`, import.meta.url), 'utf8'));
const ctx: AdapterCtx = {
  databaseId: 17, databaseName: 'Bloomington, IN', jurisdiction: 'Bloomington, IN',
  searchUrl: 'https://energov.bloomington.in.gov/energov_prod/civic-access-public', portalUrl: null,
  browser: vi.fn(), log: vi.fn(), politeness: { minDelayMs: 1000 },
};
const criteria = () => fixture('bloomington-criteria').Result;

describe('EnerGov tenant and request scope', () => {
  it('derives both public application shapes without hardcoded tenants', () => {
    expect(applicationUrl(ctx.searchUrl)).toBe('https://energov.bloomington.in.gov/energov_prod/selfservice');
    expect(applicationUrl('https://compasskc.kcmo.org/EnerGov_Prod/SelfService#/home')).toBe('https://compasskc.kcmo.org/EnerGov_Prod/SelfService');
    expect(() => applicationUrl('https://secure.apexnc.org/eSuite.Permits/WelcomePage.aspx')).toThrow();
    expect(() => applicationUrl('ftp://example.org/selfservice')).toThrow();
  });
  it('uses the returned tenant ID, name, URL, and culture', () => {
    expect(tenantHeaders(ctx.searchUrl, fixture('bloomington-tenants').Result)).toMatchObject({ tenantid: '1', tenantname: 'BloomingtonINProd', 'tyler-tenanturl': 'BloomingtonINProd' });
    expect(tenantHeaders('https://compasskc.kcmo.org/EnerGov_Prod/SelfService', fixture('kansas-tenants').Result).tenantid).toBe('7');
  });
  it('rejects wrong or ambiguous tenants before search', () => {
    const tenants = [...fixture('bloomington-tenants').Result, ...fixture('kansas-tenants').Result];
    expect(() => tenantHeaders(ctx.searchUrl, tenants)).toThrow(/unambiguous/);
    expect(() => tenantHeaders('https://example.org/selfservice/wrong', tenants)).toThrow();
    expect(tenantHeaders('https://example.org/selfservice/BloomingtonINProd', tenants).tenantname).toBe('BloomingtonINProd');
  });
  it('reuses the complete observed criteria and separates address, permit, and keyword scopes', () => {
    const original = criteria();
    const address = searchRequest(original, '1004 S Madison', 'address');
    expect(address).toMatchObject({ SearchModule: 2, FilterModule: 1, Keyword: '', PermitCriteria: { Address: '1004 S Madison', PermitNumber: null, PageNumber: 1, PageSize: 50 } });
    expect(address.PlanCriteria).toEqual(original.PlanCriteria);
    expect(original.PermitCriteria.Address).toBeNull();
    expect(searchRequest(original, 'BHQA2025-0005', 'permit').PermitCriteria.PermitNumber).toBe('BHQA2025-0005');
    expect(searchRequest(original, 'Madison', 'keyword')).toMatchObject({ SearchModule: 1, FilterModule: 2, Keyword: 'Madison', PageNumber: 1 });
  });
  it('searches a keyword (a company or person name) as an exact phrase, like the form\'s Exact Match box', () => {
    // Without it Cape Coral matched 106,870 permits for "Able Construction" (any word), past the 100-page cap.
    const original = criteria();
    expect(original.ExactMatch).toBe(false);
    expect(searchRequest(original, 'Able Construction', 'keyword').ExactMatch).toBe(true);
    expect(original.ExactMatch).toBe(false);
    expect(searchRequest(original, '1004 S Madison', 'address').ExactMatch).toBe(false);
    const { ExactMatch: _, ...older } = original;
    expect('ExactMatch' in searchRequest(older, 'Able Construction', 'keyword')).toBe(false);
  });
  it('sets only the requested real date fields and refuses unavailable date criteria', () => {
    const q = recentRequest(criteria(), '2026-10-03T12:00:00Z', '2026-10-10T17:00:00Z', 'Issue');
    expect(q.PermitCriteria).toMatchObject({ IssueDateFrom: '2026-10-03T00:00:00', IssueDateTo: '2026-10-10T23:59:59', ApplyDateFrom: null, Address: null, PermitNumber: '' });
    expect(recentRequest(criteria(), '2026-10-03', '2026-10-10', 'Apply').PermitCriteria.ApplyDateFrom).toBe('2026-10-03T00:00:00');
    expect(() => recentRequest(criteria(), 'invalid', '2026-10-10', 'Issue')).toThrow();
    const missing = criteria(); delete missing.PermitCriteria.ApplyDateFrom;
    expect(() => recentRequest(missing, '2026-10-03', '2026-10-10', 'Apply')).toThrow(/does not expose/);
  });
});

describe('EnerGov recorded public responses', () => {
  it.each(['bloomington', 'kansas', 'taylorsville'])('normalizes %s rows while preserving untouched source JSON', city => {
    const data = fixture(`${city}-search`);
    const parsed = parseSearch(data, ctx);
    expect(parsed.records).toHaveLength(data.Result.EntityResults.length);
    expect(parsed.records[0].permitNumber).toBe(data.Result.EntityResults[0].CaseNumber);
    expect(parsed.records[0].raw).toBe(data.Result.EntityResults[0]);
    expect(parsed.records[0].contractorLicense).toBeNull();
    expect(parsed.records[0].sourceUrl).toContain('/civic-access-public/details/permit/');
    expect(parsed.records[0].databaseId).toBe(17);
  });
  it('preserves local dates without inventing a UTC offset', () => {
    expect(isoDate('2025-04-15T11:19:50')).toBe('2025-04-15');
    expect(isoDate('2025-04-15T15:19:50Z')).toBe('2025-04-15T15:19:50.000Z');
    expect(isoDate(null)).toBeNull();
    expect(isoDate('unknown')).toBeNull();
    expect(isoDate('2026-02-30')).toBeNull();
  });
  it('throws on the recorded Overland Park failure rather than returning no results', () => {
    expect(() => parseSearch(fixture('overland-ui-search-failure'), ctx)).toThrow(/search failed/);
  });
  it('rejects wrong-module and malformed pagination responses', () => {
    const bad = fixture('bloomington-search'); bad.Result.EntityResults[0].ModuleName = 9;
    expect(() => parseSearch(bad, ctx)).toThrow(/non-permit/);
    bad.Result.EntityResults[0].ModuleName = 2; bad.Result.TotalPages = -1;
    expect(() => parseSearch(bad, ctx)).toThrow(/pagination/);
  });
  it('verifies detail identity and contact ownership, keeps private valuation unknown', () => {
    const record = parseSearch(fixture('bloomington-search'), ctx).records[0];
    const data = fixture('bloomington-detail'), contacts = fixture('bloomington-contacts');
    const detail = parseDetail(data, contacts, record);
    expect(detail.permitNumber).toBe('BHQA2025-0005');
    expect(detail.applicantName).toBe('Granite Student Living');
    expect(detail.contractorName).toBeNull();
    expect(detail.valuation).toBeNull();
    expect(detail.issuedAt).toBe('2025-04-15T15:19:50.000Z');
    contacts.Result[0].EntityId = 'wrong-record';
    expect(() => parseDetail(data, contacts, record)).toThrow(/identity|contacts/);
  });
});

describe('EnerGov adapter failures', () => {
  it('propagates blocked portals and does not start a browser or write storage', async () => {
    vi.mocked(politeFetch).mockReset().mockRejectedValueOnce(new PortalBlockedError(ctx.searchUrl, 403));
    await expect(adapter.search(ctx, { type: 'address', value: '1004 S Madison' })).rejects.toBeInstanceOf(PortalBlockedError);
    expect(ctx.browser).not.toHaveBeenCalled();
  });
  it('does not advertise or emulate unsupported license search', async () => {
    await expect(adapter.search(ctx, { type: 'license', value: '123' })).rejects.toThrow(/does not support/);
  });
});

describe('EnerGov HTTP search and pagination with recorded fixtures', () => {
  function responses(...names: string[]) {
    const fetch = vi.mocked(politeFetch).mockReset();
    for (const name of names) fetch.mockResolvedValueOnce(new Response(JSON.stringify(fixture(name)), { status: 200 }));
    return fetch;
  }
  it('searches end to end using real tenant, criteria, and permit response envelopes', async () => {
    const fetch = responses('bloomington-tenants', 'bloomington-criteria', 'bloomington-permit');
    const records = await adapter.search(ctx, { type: 'permit', value: 'BHQA2025-0005' });
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ permitNumber: 'BHQA2025-0005', address: '1004 S Madison ST Bloomington IN 47403', issuedAt: '2025-04-15' });
    const [url, init, options] = fetch.mock.calls[2];
    expect(url).toBe('https://energov.bloomington.in.gov/energov_prod/selfservice/api/energov/search/search');
    expect(JSON.parse(String(init?.body))).toMatchObject({ SearchModule: 2, PermitCriteria: { PermitNumber: 'BHQA2025-0005', PageNumber: 1 } });
    expect(init?.headers).toMatchObject({ tenantid: '1', tenantname: 'BloomingtonINProd' });
    expect(options?.minDelayMs).toBe(1000);
    expect(ctx.browser).not.toHaveBeenCalled();
  });
  it('treats a successful empty public search as empty', async () => {
    responses('bloomington-tenants', 'bloomington-criteria', 'taylorsville-company-keyword-empty');
    expect(await adapter.search(ctx, { type: 'keyword', value: 'Precision Air Management' })).toEqual([]);
  });
  it('rejects repeated pages without returning partial permits', async () => {
    const fetch = responses('bloomington-tenants', 'bloomington-criteria', 'bloomington-search', 'bloomington-search');
    await expect(adapter.search(ctx, { type: 'address', value: '100' })).rejects.toThrow(/repeated a page/);
    expect(JSON.parse(String(fetch.mock.calls[3][1]?.body)).PermitCriteria.PageNumber).toBe(2);
  });
  it('propagates a later-page failure instead of returning the first page', async () => {
    const fetch = responses('bloomington-tenants', 'bloomington-criteria', 'bloomington-search');
    fetch.mockRejectedValueOnce(new PortalBlockedError(ctx.searchUrl, 429));
    await expect(adapter.search(ctx, { type: 'address', value: '100' })).rejects.toBeInstanceOf(PortalBlockedError);
  });
  it('does not mistake HTML challenges or API authorization failures for empty data', async () => {
    vi.mocked(politeFetch).mockReset().mockResolvedValueOnce(new Response('<html><title>Just a moment</title>Cloudflare challenge</html>', { status: 200 }));
    await expect(adapter.search(ctx, { type: 'permit', value: 'BHQA2025-0005' })).rejects.toBeInstanceOf(PortalBlockedError);
  });
  it('loads verified detail and contacts with the case ID found by an exact permit search', async () => {
    const fetch = responses('bloomington-tenants', 'bloomington-criteria', 'bloomington-permit', 'bloomington-detail', 'bloomington-contacts');
    const record = await adapter.detail!(ctx, 'BHQA2025-0005');
    expect(record?.applicantName).toBe('Granite Student Living');
    expect(record?.raw?.detail).toEqual(fixture('bloomington-detail'));
    expect(fetch.mock.calls[3][0]).toContain('/permits/permitdetail');
    expect(JSON.parse(String(fetch.mock.calls[3][1]?.body))).toEqual({ EntityId: 'd4cd98c1-2bb9-4c79-93ef-48883771183b', ModuleId: 1 });
  });
  it('does not return an approximate permit as detail', async () => {
    responses('bloomington-tenants', 'bloomington-criteria', 'bloomington-permit');
    expect(await adapter.detail!(ctx, 'BHQA2025')).toBeNull();
  });
  it.each(['company', 'license', 'name'] as const)('rejects unsupported %s rather than treating a public keyword miss as no permits', async type => {
    const fetch = vi.mocked(politeFetch).mockReset();
    await expect(adapter.search(ctx, { type, value: 'Precision Air Management' })).rejects.toThrow(/does not support/);
    expect(fetch).not.toHaveBeenCalled();
    expect(adapter.capabilities.search).not.toContain(type);
  });
});


describe('EnerGov date listing and landing discovery', () => {
  it('lists issue and application dates separately and deduplicates their real overlapping rows', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-10T18:00:00Z'));
    try {
      const fetch = vi.mocked(politeFetch).mockReset();
      for (const name of ['bloomington-tenants', 'bloomington-criteria', 'bloomington-recent', 'bloomington-applied-recent']) {
        fetch.mockResolvedValueOnce(new Response(JSON.stringify(fixture(name))));
      }
      const records = await adapter.listRecent(ctx, '2026-10-03');
      expect(records).toHaveLength(51);
      expect(new Set(records.map(r => r.permitNumber)).size).toBe(51);
      expect(JSON.parse(String(fetch.mock.calls[2][1]?.body)).PermitCriteria.IssueDateFrom).toBe('2026-10-03T00:00:00');
      expect(JSON.parse(String(fetch.mock.calls[3][1]?.body)).PermitCriteria.ApplyDateFrom).toBe('2026-10-03T00:00:00');
    } finally { vi.useRealTimers(); }
  });
  it('fails if the server ignores the requested date filter', async () => {
    const fetch = vi.mocked(politeFetch).mockReset();
    for (const name of ['bloomington-tenants', 'bloomington-criteria', 'bloomington-permit']) fetch.mockResolvedValueOnce(new Response(JSON.stringify(fixture(name))));
    await expect(adapter.listRecent(ctx, '2026-10-03')).rejects.toThrow(/ignored the Issue date filter/);
  });
  it('reads literal redirects from recorded municipal landing pages without executing JavaScript', () => {
    const html = (name: string) => readFileSync(new URL(`./fixtures/energov/${name}-landing.html`, import.meta.url), 'utf8');
    expect(portalLink(html('carlsbad'), 'https://eg.carlsbadca.gov/')).toBe('https://eg.carlsbadca.gov/EnerGov_Prod/selfservice#/home');
    expect(portalLink(html('seguin'), 'https://eportal.seguintexas.gov/')).toBe('https://eportal.seguintexas.gov/energov_prod/selfservice#/');
    expect(portalLink('<html>No portal here</html>', ctx.searchUrl)).toBeNull();
  });
  it('registers specific CSS labels without claiming other Tyler products', async () => {
    const { getAdapter } = await import('./registry');
    for (const label of [adapter.platform, ...adapter.aliases!]) expect(getAdapter(label.toUpperCase())).toBe(adapter);
    for (const label of ['Tyler New World CSS', 'Tyler Munis/EnerGov Citizen Self Service', 'Tyler eSuite', 'Tyler Eden Permits & Inspections']) expect(getAdapter(label)).toBeNull();
  });
});
