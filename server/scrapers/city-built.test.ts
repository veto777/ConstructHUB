import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import type { AdapterCtx } from './types';
import adapter, { supportedHosts, watsAdapter, eugeneAdapter, capabilitiesFor } from './city-built';
import { parseResults } from './city-built/webapp.sjcfl.us';
import { isoDate, assertPublicPage } from './city-built/http';
import { PortalBlockedError } from './polite-fetch';
vi.mock('../storage', () => ({ storage: {} }));
vi.mock('./polite-fetch', async (importOriginal) => ({ ...await importOriginal<typeof import('./polite-fetch')>(), politeFetch: vi.fn(), politeJson: vi.fn() }));
import { politeFetch } from './polite-fetch';
const ctx = { databaseId: 286, jurisdiction: 'St. Johns County, FL', searchUrl: 'https://webapp.sjcfl.us/watswebx/Permit/SearchPermit.aspx' } as AdapterCtx;
const fixture = (name: string) => readFileSync(new URL(`./fixtures/city-built/${name}`, import.meta.url), 'utf8');
describe('city-built', () => {
    it('parses real St. Johns results without losing records', () => { const rows = parseResults(fixture('sjc-main2.html'), ctx); expect(rows).toHaveLength(537); expect(rows[0]).toMatchObject({ permitNumber: '12611699', address: '224 N MAIN ST STE B', issuedAt: '2026-10-09', status: 'Open', contractorName: 'EXEMPT', databaseId: 286 }); expect(rows[0].sourceUrl).toBe('https://webapp.sjcfl.us/watswebx/Permit/BLPermit.aspx?PermitNo=12611699&PopUp=1'); expect(rows[0].raw?.html).toContain('12611699'); });
    it('throws on the recorded server error instead of false no-results', () => expect(() => parseResults(fixture('sjc-main.html'), ctx)).toThrow());
    it('rejects unknown hosts', async () => { expect(supportedHosts).toContain('webapp.sjcfl.us'); await expect(async () => adapter.search({ ...ctx, searchUrl: 'https://example.com/' }, { type: 'permit', value: '12611699' })).rejects.toThrow('no site adapter for example.com'); });
    it('recognizes CAPTCHA in the real Alamance response', () => expect(() => assertPublicPage(fixture('alamance-search.html'), 'http://apps.alamance-nc.com/')).toThrow(PortalBlockedError));
    it('normalizes dates strictly', () => { expect(isoDate('10/9/2026 4:32:25 PM')).toBe('2026-10-09'); expect(isoDate('2/30/2026')).toBeNull(); expect(isoDate('')).toBeNull(); });
});
import { parseResults as parseJohnston } from './city-built/www.johnstonnc.gov';
import { parsePage as parseRegional, buildRequest } from './city-built/www.milamcountypermits.com';
import { parseResults as parseEugene, buildSearch, parseReport } from './city-built/pdd.eugene-or.gov';
import { parseResults as parseGarden } from './city-built/ggcity.org';
import { parseResults as parseCoconut } from './city-built/www3.coconutcreek.gov';
import { parseAddress, parseDetail } from './city-built/permitsearch.summitoh.net';
import { gunzipSync } from 'node:zlib';
describe('recorded site layouts', () => {
    it('deduplicates Johnston applicants while retaining both source rows', () => { const rows = parseJohnston(fixture('johnston-102-main.html'), ctx); expect(rows).toHaveLength(3); expect(rows[0]).toMatchObject({ permitNumber: '174579', address: '102 MAIN ST, PINE LEVEL', valuation: 132365, applicantName: null, issuedAt: null, contractorName: 'CAROLINA BUILDING SYSTEMS' }); expect(rows[0].raw?.rows).toHaveLength(2); expect(parseJohnston(fixture('johnston-main.html'), ctx)).toEqual([]); expect(parseJohnston(fixture('johnston-174579.html'), ctx)).toHaveLength(1); });
    it('does not mistake regional status dates for issue dates', () => { const p = parseRegional(JSON.parse(fixture('milam-data.json')), ctx); expect(p.count).toBe(35); expect(p.records).toHaveLength(15); expect(p.records[0]).toMatchObject({ permitNumber: '2026-0044', address: '9140 N US HIGHWAY 77', status: 'Approved', issuedAt: null, appliedAt: null }); expect(p.records[0].raw?.statusDate).toBe('9/5/2026'); expect(() => parseRegional(JSON.parse(fixture('milam-list.json')), ctx)).toThrow(); expect(buildRequest('9140', 30).get('start')).toBe('30'); expect(buildRequest('9140').get('columns[6][data]')).toBe('statusDate'); });
    it('parses the entire Eugene received-date listing', () => { const r = parseEugene(fixture('eugene-recent-all.html'), ctx); expect(r).toHaveLength(139); expect(r[0]).toMatchObject({ permitNumber: '26-06513-01', appliedAt: '2026-10-05', issuedAt: null, address: '1047 W 18TH PL', workClass: 'Addition' }); const html = gunzipSync(readFileSync(new URL('./fixtures/city-built/419.html.gz', import.meta.url))).toString(); const request = buildSearch(html, { type: 'address', value: '1047 W 18TH PL' }); expect(request.fields.get('address.AddressStreet')).toBe('18TH'); expect(request.fields.get('address.PermitStatus')).toBe(''); expect(buildSearch(html, { type: 'permit', value: '26-06513-01' }).fields.get('LogNumber')).toBe('06513'); });
    it('parses Garden Grove historical detail and search rows', () => { const rows = parseGarden(fixture('garden-year.html'), ctx); expect(rows[0]).toMatchObject({ permitNumber: '2026', address: '10871 FORBES AVE', issuedAt: '1990-05-16', contractorName: 'JEFF C SMITH PLUMBING' }); const list = parseGarden(fixture('garden-forbes.html'), ctx); expect(list.length).toBeGreaterThan(20); expect(list[0]).toMatchObject({ permitNumber: '13-1510', issuedAt: '2013-07-16', address: null }); expect(parseGarden(fixture('garden-main.html'), ctx)).toEqual([]); });
    it('reads Coconut Creek permit numbers from submit controls', () => { const r = parseCoconut(fixture('coconut-copans.html'), ctx); expect(r).toHaveLength(651); expect(r[0]).toMatchObject({ permitNumber: '26002855', address: '4800 W COPANS RD', status: 'OPEN', ownerName: 'CITY OF COCONUT CREEK' }); expect(parseCoconut(fixture('coconut-permit.html'), ctx)).toHaveLength(1); expect(parseCoconut(fixture('coconut-main.html'), ctx)).toEqual([]); });
    it('parses Summit public address and permit views', () => { expect(parseAddress(fixture('summit-address.html'), ctx)[0]).toMatchObject({ permitNumber: 'CPR210041', status: 'CLOSED', address: '445 S MAIN ST, AKRON 44311', issuedAt: null }); expect(parseDetail(fixture('summit-permit.html'), ctx)).toMatchObject({ permitNumber: 'CPR210041', applicantName: 'Katie Veasey Gillette', status: 'CLOSED', expiresAt: '2120-01-19' }); });
});
describe('offline search contract', () => {
    beforeEach(() => vi.mocked(politeFetch).mockReset());
    it('submits only the public St. Johns search form and parses its detail response', async () => {
        const html = gunzipSync(readFileSync(new URL('./fixtures/city-built/286.html.gz', import.meta.url))).toString();
        vi.mocked(politeFetch).mockResolvedValueOnce(new Response(html)).mockResolvedValueOnce(new Response(fixture('sjc-permit.html')));
        const result = await adapter.search({ ...ctx, politeness: { minDelayMs: 10 } }, { type: 'permit', value: '12611699' });
        expect(result[0]).toMatchObject({ permitNumber: '12611699', address: '224 N MAIN ST STE B', issuedAt: '2026-10-09' });
        const call = vi.mocked(politeFetch).mock.calls[1];
        const body = new URLSearchParams(call[1]?.body as string);
        expect(body.get('ctl00$cphBody$txtPermitNo')).toBe('12611699');
        expect(body.get('ctl00$cphBody$btnSearch')).toBe('Search');
        expect(body.has('ctl00$cphBody$btnLogin')).toBe(false);
        expect(call[2]?.minDelayMs).toBe(1000);
    });
    it('rejects a recorded CAPTCHA response instead of returning an empty array', async () => { vi.mocked(politeFetch).mockResolvedValue(new Response(fixture('alamance-search.html'))); let failure: unknown; try {
        await adapter.search({ ...ctx, politeness: { minDelayMs: 1000 } }, { type: 'permit', value: '12611699' });
    }
    catch (e) {
        failure = e;
    } expect((failure as PortalBlockedError)?.status).toBe(403); expect((failure as Error)?.name).toBe('PortalBlockedError'); });
});
describe('capabilities and detail variations', () => {
    it('exposes alerts only for exact labels with verified feeds', () => { expect(adapter.capabilities.listRecent).toBe(false); expect(watsAdapter.capabilities.listRecent).toBe(true); expect(eugeneAdapter.capabilities.listRecent).toBe(true); expect(capabilitiesFor({ searchUrl: 'https://www.milamcountypermits.com/' }).listRecent).toBe(false); expect(() => watsAdapter.search({ ...ctx, searchUrl: 'https://example.com/' }, { type: 'permit', value: '12611699' })).toThrow('expected host'); });
    it('parses Eugene contractor columns and embedded reports', () => { const rows = parseEugene(fixture('eugene-company.html'), ctx); expect(rows).toHaveLength(462); expect(rows[0]).toMatchObject({ permitNumber: '07-02489-01', contractorName: 'B & C SMITH CONTRACTING LLC', issuedAt: '2007-05-21', status: 'Finished' }); expect(parseReport(fixture('eugene-report.html'), ctx)).toMatchObject({ permitNumber: '26-06513-01', address: '1047 W 18TH PL', appliedAt: '2026-10-05', status: 'Review', workClass: 'Addition' }); });
});


it('registers case-insensitive aliases and enables only the verified alert labels',async()=>{
 const {getAdapter,supportsAlerts}=await import('./registry');
 expect(getAdapter('CITY-SITE')?.platform).toBe('City-built');
 expect(getAdapter('City permit portal')).toBe(adapter);
 expect(supportsAlerts('WATS (county-specific)')).toBe(true);
 expect(supportsAlerts('City of Eugene custom (Planning and Development permit search)')).toBe(true);
 expect(supportsAlerts('County portal')).toBe(false);
 expect(getAdapter(null)).toBeNull();
});

import { parseResults as parseLyon } from './city-built/comdev.lyon-county.org';
import { parseResults as parsePalm, validatePage as validatePalm } from './city-built/www.palmcoast.gov';
describe('additional verified public feeds', () => {
    it('parses Lyon submission dates without inventing an issued date', () => {
        const rows = parseLyon(fixture('lyon-main.html'), ctx);
        expect(rows).toHaveLength(86);
        expect(rows[0]).toMatchObject({ permitNumber: '26-0668', address: '1290 W MAIN ST', appliedAt: '2026-06-18', issuedAt: null, expiresAt: '2027-02-07', status: 'Issued' });
        expect(parseLyon(fixture('lyon-recent.html'), ctx)).toHaveLength(25);
    });
    it('parses Palm Coast singular results and issued-date listings', () => {
        const palmCtx = { ...ctx, searchUrl: 'https://www.palmcoast.gov/building/search' };
        expect(parsePalm(fixture('palm-permit.html'), palmCtx)).toHaveLength(1);
        expect(parsePalm(fixture('palm-permit.html'), palmCtx)[0]).toMatchObject({ permitNumber: '2026100278', address: '515 PALM COAST PKWY SW UNIT 13', issuedAt: '2026-10-09', applicantName: 'GARY L SMITH', contractorName: null, valuation: 3000 });
        expect(parsePalm(fixture('palm-recent.html'), palmCtx)).toHaveLength(187);
        expect(() => parsePalm(fixture('palm-main.html'), palmCtx)).toThrow('capped');
        expect(() => validatePalm(fixture('palm-search.html'), palmCtx.searchUrl)).not.toThrow();
        expect(() => validatePalm(fixture('alamance-search.html'), palmCtx.searchUrl)).toThrow(PortalBlockedError);
    });
});

import { parseDataset } from './city-built/apps.indepmo.org';
import { parsePage as parseOcean, searchWhere } from './city-built/oceancitymd.gov';
describe('city-owned open datasets', () => {
    it('keeps the Independence active-dataset scope and untouched rows', () => {
        const data = JSON.parse(fixture('independence-rendered-1791656954760.json'));
        const rows = parseDataset(data, ctx);
        expect(rows).toHaveLength(1581);
        expect(rows[0]).toMatchObject({ permitNumber: '2016-02063', address: '523 E LINWOOD AVE', valuation: 3000, issuedAt: null, status: null });
        expect(rows[0].raw?.row).toEqual(data.dataSetData[0]);
        expect(() => parseDataset({}, ctx)).toThrow();
    });
    it('recognizes an Ocean City transfer limit and preserves dates and coordinates', () => {
        const page = parseOcean(JSON.parse(fixture('ocean-coastal.json')), ctx);
        expect(page.more).toBe(true);
        expect(page.records).toHaveLength(2000);
        expect(page.records[0]).toMatchObject({ permitNumber: '21-0004', address: '3505 COASTAL HIGHWAY - UNIT 1', status: 'Closed', appliedAt: '2021-01-07T05:00:00.000Z', issuedAt: null, lat: 38.363929749199606, lng: -75.0728607178025 });
        expect(searchWhere('permit', "O'NEIL")).toBe("UPPER(App_) = 'O''NEIL'");
        expect(() => parseOcean({ error: { code: 499, message: 'Token required' } }, ctx)).toThrow(PortalBlockedError);
    });
});

import { parseResults as parseHouston, stringTable } from './city-built/www.houstonpermittingcenter.org';
describe('Houston WebFOCUS data', () => {
    it('reads complete narrow reports and retains repeated source rows', () => {
        const records = parseHouston(fixture('houston-narrow.html'), ctx);
        expect(records).toHaveLength(2);
        expect(records[0]).toMatchObject({ permitNumber: '49003840', address: '1000 MAIN ST 116 77002', permitType: 'ELEV RENEWAL', issuedAt: null, valuation: 0 });
        expect(records.reduce((n, r) => n + (r.raw!.rows as unknown[]).length, 0)).toBe(6);
        expect(() => parseHouston(fixture('houston-http.html'), ctx)).toThrow('only part');
    });
    it('does not execute JavaScript while decoding report literals', () => {
        expect(() => stringTable('ARstrings=[process.exit()]')).toThrow('nonliteral');
        expect(stringTable("ARstrings=['O\\'NEIL', 0, '\\u0041'];")).toEqual(["O'NEIL", 0, 'A']);
    });
    it('resolves every implemented non-null catalog label', async () => {
        const { getAdapter } = await import('./registry');
        const rows = JSON.parse(fixture('classification.json'));
        for (const row of rows.filter((r: any) => supportedHosts.includes(new URL(r.url).host))) {
            expect(() => capabilitiesFor({ searchUrl: row.url })).not.toThrow();
            if (row.platform !== null) expect(getAdapter(row.platform)?.platform).toBeTruthy();
        }
    });
});

import { politeJson } from './polite-fetch';
it('rejects repeated GIS pages rather than returning duplicated partial records', async () => {
    const data = JSON.parse(fixture('ocean-coastal.json'));
    vi.mocked(politeJson).mockResolvedValue(data);
    const oceanCtx = { ...ctx, searchUrl: 'https://oceancitymd.gov/oc/departments/planning-community-development/online-permitting/', politeness: { minDelayMs: 1000 } };
    await expect(adapter.search(oceanCtx, { type: 'address', value: 'COASTAL' })).rejects.toThrow('repeated page');
});

import { parsePage as parsePprbd, jurisdictionFilter } from './city-built/www.pprbd.org';
it('scopes PPRBD regional records to the catalog jurisdiction and keeps ambiguous dates raw', () => {
    const data = JSON.parse(fixture('pprbd-recent-building.json'));
    const regionalCtx = { ...ctx, jurisdiction: 'El Paso County, CO', searchUrl: 'https://www.pprbd.org/Search/Permit' };
    const scope = jurisdictionFilter(regionalCtx);
    expect(scope).toBe('EL PASO COUNTY');
    const scoped = { ...data, features: data.features.filter((f: any) => f.attributes.Jurisdiction === scope) };
    const records = parsePprbd(scoped, regionalCtx, scope).records;
    expect(records[0]).toMatchObject({ permitNumber: 'Q63333', address: '4364 LASHELLE AVE', contractorName: 'FOUNDATION PROFESSIONALS OF COLORADO, LLC', issuedAt: null, appliedAt: null, permitType: 'Building' });
    expect(records[0].raw?.attributes).toEqual(scoped.features[0].attributes);
    expect(() => parsePprbd(data, regionalCtx, scope)).toThrow('jurisdiction mismatch');
    expect(() => jurisdictionFilter({ ...regionalCtx, jurisdiction: 'Unknown city, CO' })).toThrow('unverified');
});
