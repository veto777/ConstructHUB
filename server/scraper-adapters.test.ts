import { describe, expect, it, vi } from 'vitest';
vi.mock('./storage', () => ({ storage: {} }));
import { accelaSearchUrl, assertEnerGovTenant, enerGovApplicationUrl, enerGovPageRequest, enerGovSearchRequest, enerGovReplayHeaders, parseAccelaResults, parseEnerGovResponse, scrapeEnerGov, getScrapeProgress } from './scraper';

describe('EnerGov request scope and paging', () => {
  it.each([
    ['https://county.tylerhost.net/Apps/SelfService#/home', 'https://county.tylerhost.net/Apps/SelfService'],
    ['https://county.gov/EnerGov_Prod/SelfService/#/home', 'https://county.gov/EnerGov_Prod/SelfService'],
    ['https://county.gov/apps/selfservice/TenantA#/search', 'https://county.gov/apps/selfservice'],
  ])('preserves the application path in %s', (url, expected) => {
    expect(enerGovApplicationUrl(url)).toBe(expected);
  });
  it.each(['bad URL', 'https://county.gov/web/'])('rejects invalid applications instead of using a different county', url => {
    expect(() => enerGovApplicationUrl(url)).toThrow();
  });
  it('pages advanced criteria without modifying the UI request or losing version-specific fields', () => {
    const template = { SearchModule: 2, FilterModule: 1, PageNumber: 0, PermitCriteria: { Address: '123 Main', PageNumber: 1, PageSize: 10 }, PlanCriteria: { FutureField: true } };
    const next = enerGovPageRequest(template, 3);
    expect(next).toEqual({ ...template, PermitCriteria: { ...template.PermitCriteria, PageNumber: 3 } });
    expect(template.PermitCriteria.PageNumber).toBe(1);
    next.PlanCriteria.FutureField = false;
    expect(template.PlanCriteria.FutureField).toBe(true);
  });
  it('pages basic keyword searches at the root while retaining permit filter', () => {
    expect(enerGovPageRequest({ SearchModule: 1, FilterModule: 2, Keyword: 'Smith', PageNumber: 1 }, 2)).toEqual({ SearchModule: 1, FilterModule: 2, Keyword: 'Smith', PageNumber: 2 });
  });
  it('rejects all-module and plan searches', () => {
    expect(() => enerGovPageRequest({ SearchModule: 1, FilterModule: 1 }, 1)).toThrow(/scoped to permits/);
    expect(() => enerGovPageRequest({ SearchModule: 3, FilterModule: 3 }, 1)).toThrow();
  });
  const tenants = [{ TenantID: 1, TenantName: 'CountyA', TenantUrl: 'CountyA' }, { TenantID: 2, TenantName: 'CountyB', TenantUrl: 'CountyB' }];
  const headers = { tenantId: '1', tenantName: 'CountyA' };
  it('accepts the sole tenant and case-insensitive header names', () => {
    expect(() => assertEnerGovTenant('https://host/apps/selfservice', tenants.slice(0, 1), headers)).not.toThrow();
  });
  it('accepts an explicitly configured tenant on a shared host', () => {
    expect(() => assertEnerGovTenant('https://host/apps/selfservice/CountyA', tenants, headers)).not.toThrow();
  });
  it('rejects ambiguous tenants and silent default selection', () => {
    expect(() => assertEnerGovTenant('https://host/apps/selfservice', tenants, headers)).toThrow(/multiple tenants/);
    expect(() => assertEnerGovTenant('https://host/apps/selfservice/CountyB', tenants, headers)).toThrow(/different tenant/);
    expect(() => assertEnerGovTenant('https://host/apps/selfservice/CountyA', tenants, {})).toThrow(/headers/);
  });
  it('requires a portal URL even for direct adapter callers', async () => {
    expect(await scrapeEnerGov('Main', 'address', 1, 'Test', 1, 'missing-url')).toEqual([]);
    expect(getScrapeProgress('missing-url')).toMatchObject({ status: 'error', message: expect.stringContaining('jurisdiction-specific') });
  });
});

describe('EnerGov response parsing', () => {
  const record = { CaseId: 'case-a', CaseNumber: 'BLD-2026-1', ModuleName: 2, CaseStatus: 'Issued', Address: { FullAddress: '123 MAIN ST' }, ApplyDate: '2026-01-01', IssueDate: '2026-02-01', MainParcel: 'parcel-a' };
  const response = (items: any[]) => ({ Success: true, Result: { EntityResults: items, TotalPages: 2 } });
  it('parses permit fields and uses issue date rather than application date', () => {
    expect(parseEnerGovResponse(response([record]))).toMatchObject({ totalPages: 2, results: [{ permitNumber: 'BLD-2026-1', address: '123 MAIN ST', issuedDate: '2026-02-01', parcelNumber: 'parcel-a', caseId: 'case-a' }] });
  });
  it('does not manufacture issuance or applicant data from application date or project name', () => {
    expect(parseEnerGovResponse(response([{ ...record, IssueDate: null, ProjectName: 'New house' }])).results[0]).toMatchObject({ issuedDate: null, applicantName: null });
  });
  it('accepts explicit empty results', () => {
    expect(parseEnerGovResponse({ Success: true, Result: { EntityResults: [], TotalPages: 0 } })).toEqual({ results: [], totalPages: 0 });
  });
  it.each([{ Success: false }, {}, { Result: { EntityResults: [] } }])('rejects failed or malformed response %j', data => {
    expect(() => parseEnerGovResponse(data)).toThrow();
  });
  it('rejects non-permit entities and missing record numbers', () => {
    expect(() => parseEnerGovResponse(response([{ ...record, ModuleName: 11 }]))).toThrow(/non-permit/);
    expect(() => parseEnerGovResponse(response([{ ...record, CaseNumber: null }]))).toThrow(/number/);
  });
});

describe('Accela module discovery', () => {
  const source = 'https://aca-prod.accela.com/COUNTY/Default.aspx';
  it('uses the agency advertised module and removes inspection-only mode', () => {
    expect(accelaSearchUrl(source, '<a href="/COUNTY/Cap/CapHome.aspx?module=DevServices&IsToShowInspection=yes">Development Services</a>')).toBe('https://aca-prod.accela.com/COUNTY/Cap/CapHome.aspx?module=DevServices');
  });
  it('does not follow links to another agency or host', () => {
    expect(accelaSearchUrl(source, '<a href="/OTHER/Cap/CapHome.aspx?module=Building">Building</a><a href="https://other/COUNTY/Cap/CapHome.aspx">Permits</a>')).toContain('/COUNTY/Cap/CapHome.aspx?module=Building');
  });
  it('preserves configured search modules', () => {
    const url = 'https://aca-prod.accela.com/COUNTY/Cap/CapHome.aspx?module=Permits';
    expect(accelaSearchUrl(url, '')).toBe(url);
  });
});

describe('Accela grid parsing', () => {
  const grid = `<table id="ctl00_gdvPermitList"><tbody>
    <tr><td colspan="6"><table><tr><td>Showing 1-1 of 1</td></tr></table></td></tr>
    <tr><th>Application Date</th><th>Record Number</th><th>Record Type</th><th>Status</th><th>Address</th><th>Description</th></tr>
    <tr><td>10/05/2026</td><td><a>BLD-2026-12</a></td><td>Building</td><td>Payment Received</td><td>123 Main St</td><td>New roof</td></tr>
    <tr><td colspan="6"><a>Next &gt;</a></td></tr>
  </tbody></table>`;
  it('parses the actual gdvPermitList with nested layout and pager rows excluded', () => {
    const records = parseAccelaResults(grid);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ permitNumber: 'BLD-2026-12', status: 'Payment Received', address: '123 Main St', issuedDate: null, description: 'New roof' });
  });
  it('uses headers instead of mistaking the first date or address for a record number', () => {
    expect(parseAccelaResults(grid.replace('Record Number', 'Permit Number'))[0].permitNumber).toBe('BLD-2026-12');
  });
  it('ignores unrelated tables and error/login pages', () => {
    expect(parseAccelaResults('<table><tr><td>12345</td><td>123 Main St</td><td>Error</td></tr></table>')).toEqual([]);
  });
  it('deduplicates repeated records', () => {
    expect(parseAccelaResults(grid + grid)).toHaveLength(1);
  });
});


describe('EnerGov request reconstruction', () => {
  const template = { SearchModule: 1, FilterModule: 2, Keyword: 'old', PermitCriteria: { Address: null, PageNumber: 0, PageSize: 0, PermitTypeId: 'none' }, PlanCriteria: { NewVersionField: true } };
  it.each([['address', 'Address'], ['permit', 'PermitNumber'], ['parcel', 'ParcelNumber']])('builds the observed advanced %s payload', (type, field) => {
    const payload = enerGovSearchRequest(template, 'requested value', type);
    expect(payload).toMatchObject({ SearchModule: 2, FilterModule: 1, Keyword: '', PageNumber: 0, PageSize: 0, PermitCriteria: { [field]: 'requested value', PageNumber: 1, PageSize: 50, PermitTypeId: 'none' }, PlanCriteria: { NewVersionField: true } });
    expect(template.PermitCriteria.Address).toBeNull();
  });
  it('builds keyword requests scoped to permits', () => {
    expect(enerGovSearchRequest(template, 'Smith', 'company_name')).toMatchObject({ SearchModule: 1, FilterModule: 2, Keyword: 'Smith', PageNumber: 1, PageSize: 50, PermitCriteria: { Address: null, PageNumber: 0, PageSize: 0 } });
  });
  it('does not replay HTTP/2 pseudoheaders or stale content lengths/cookies', () => {
    expect(enerGovReplayHeaders({ ':authority': 'portal', ':method': 'POST', 'Content-Length': '1234', cookie: 'old-session', tenantid: '1', tenantname: 'CountyA', 'tyler-tenanturl': 'CountyA', 'tyler-tenant-culture': 'en-US', 'content-type': 'application/json' })).toEqual({ tenantid: '1', tenantname: 'CountyA', 'tyler-tenanturl': 'CountyA', 'tyler-tenant-culture': 'en-US', 'content-type': 'application/json' });
  });
});

it('parses a single-match Accela CapDetail page without confusing related-record empty states', () => {
  expect(parseAccelaResults(`<span id="ctl00_PlaceHolderMain_lblPermitNumber">B2026-04199</span><span id="ctl00_PlaceHolderMain_lblPermitType">Minor Permit</span><span id="ctl00_PlaceHolderMain_lblRecordStatus">Issued</span><div id="ctl00_PlaceHolderMain_workLocation_updatePanel">1187 UNIVERSITY Ave 94702 * </div><p>No records found.</p>`)).toMatchObject([{ permitNumber: 'B2026-04199', permitType: 'Minor Permit', status: 'Issued', address: '1187 UNIVERSITY Ave 94702' }]);
});

it('fails a stalled Click2Gov result page explicitly and closes its browser context', async () => {
  const { chromium } = await import('playwright-core');
  const { scrapeClick2Gov, closeBrowser } = await import('./scraper');
  const locator: any = {
    first: () => locator, locator: () => locator,
    isVisible: async () => true, waitFor: async () => {}, selectOption: async () => {},
    fill: async () => {}, click: async () => {},
  };
  const page = {
    setDefaultTimeout: vi.fn(), goto: async () => {}, waitForTimeout: async () => {},
    locator: () => locator,
    waitForFunction: vi.fn().mockRejectedValue(new Error('simulated result timeout')),
    close: vi.fn().mockResolvedValue(undefined),
  };
  const context = {
    setDefaultTimeout: vi.fn(), setDefaultNavigationTimeout: vi.fn(),
    newPage: async () => page, close: vi.fn().mockResolvedValue(undefined),
  };
  const browser = { newContext: async () => context, on: vi.fn(), isConnected: () => true, close: vi.fn().mockResolvedValue(undefined) };
  const launch = vi.spyOn(chromium, 'launch').mockResolvedValue(browser as any);
  try {
    expect(await scrapeClick2Gov('https://portal.example/Click2GovBP', 'Fowler', 'address', 1, 'Test', 1, 'stalled-click2gov')).toEqual([]);
    expect(getScrapeProgress('stalled-click2gov')).toMatchObject({ status: 'error', message: expect.stringContaining('within 15 seconds') });
    expect(page.waitForFunction).toHaveBeenCalledWith(expect.any(Function), undefined, { timeout: 15_000 });
    expect(context.close).toHaveBeenCalled();
  } finally {
    await closeBrowser();
    launch.mockRestore();
  }
});
