import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('./storage', () => ({ storage: {} }));
import { chromium } from 'playwright-core';
import { assertAccelaAgency, assertEnerGovApplication, assertEnerGovTenant, closeBrowser, parseAccelaDetail, parseEnerGovDetail, scrapePermitDetail } from './scraper';

const fixture = (name: string) => readFileSync(new URL(`./fixtures/permit-details/${name}`, import.meta.url), 'utf8');
const json = (id: number, kind: string) => JSON.parse(fixture(`energov-${id}-${kind}.json`)).data;
const source = 'https://aca-prod.accela.com/AACO/Default.aspx';
const record = 'https://aca-prod.accela.com/AACO/Cap/CapDetail.aspx?agencyCode=AACO';
const accela = (id: number, agency: string, permit: string) => parseAccelaDetail(fixture(`accela-${id}.html`), permit, `https://aca-prod.accela.com/${agency}/Default.aspx`, `https://aca-prod.accela.com/${agency}/Cap/CapDetail.aspx?agencyCode=${agency}`);
const energov = (id: number, contacts = json(id, 'contacts')) => {
  const data = json(id, 'detail');
  return parseEnerGovDetail(data, contacts, data.Result.PermitNumber, data.Result.PermitId);
};

describe('Accela public CapDetail fixtures', () => {
  it('reads applicant, licensed professional, license and phone; omits the redacted owner', () => {
    expect(accela(118, 'AACO', 'F00005377')).toMatchObject({
      Permit: 'F00005377', Type: 'Fire Alarm /Mag Lock', Status: 'Closed', Applicant: 'Leslie Ferrara',
      Contractor: 'Leslie Ferrara / JML INC', 'Contractor license': 'ELECTRICIAN 001124', 'Contractor phone': '5403704353',
      Description: 'INSTALL FIRE ALARM',
    });
    expect(accela(118, 'AACO', 'F00005377')).not.toHaveProperty('Owner');
    expect(accela(118, 'AACO', 'F00005377')).not.toHaveProperty('Issued');
  });
  it.each([
    [4701, 'CHANDLER', 'BLDREV23-0382', 'ARIZONA AVENUE LP', 'ALSTON CONSTRUCTION COMPANY INC'],
    [4863, 'BERKELEY', 'B2006-03950', 'U C STUDIOS LLC', undefined],
    [32967, 'BERNCO', 'ELCO2014-0020', 'CASTILLO JOE', 'STEVEN B CHAVEZ / INTRAWORKS'],
    [28073, 'brownsville', '2026-04324', 'BESTWELL LLC', undefined],
  ])('parses public roles for portal %s without treating addresses as names', (id, agency, permit, owner, contractor) => {
    const details = accela(id as number, agency as string, permit as string);
    expect(details?.Owner).toBe(owner);
    expect(details?.Contractor).toBe(contractor);
  });
  it('preserves company punctuation and does not mislabel a city/ZIP as a license', () => {
    const html = fixture('accela-118.html').replace('JML INC', 'JML, INC').replace('ELECTRICIAN  001124', 'FREDERICKSBURG VA 22406');
    const details = parseAccelaDetail(html, 'F00005377', source, record);
    expect(details?.Contractor).toBe('Leslie Ferrara / JML, INC');
    expect(details).not.toHaveProperty('Contractor license');
  });
  it.each(['F0000537', 'F000053770', 'f00005377', ''])('rejects non-exact permit %s', permit => {
    expect(parseAccelaDetail(fixture('accela-118.html'), permit, source, record)).toBeNull();
  });
  it('rejects search/login pages even if they contain a permit-looking string', () => {
    expect(parseAccelaDetail(fixture('accela-118.html'), 'F00005377', source, source)).toBeNull();
    expect(parseAccelaDetail('<h1>Login F00005377</h1>', 'F00005377', source, record)).toBeNull();
  });
  it.each([
    'https://aca-prod.accela.com/OTHER/Cap/CapDetail.aspx',
    'https://other.gov/AACO/Cap/CapDetail.aspx',
    'https://aca-prod.accela.com/AACO/Cap/CapDetail.aspx?agencyCode=OTHER',
    'https://aca-prod.accela.com/AACO/Cap/CapDetail.aspx?AgencyCode=AACO&agencyCode=OTHER',
  ])('rejects another jurisdiction at %s', url => {
    expect(() => parseAccelaDetail(fixture('accela-118.html'), 'F00005377', source, url)).toThrow(/agency/);
  });
  it('accepts case-insensitive agency path spelling', () => {
    expect(() => assertAccelaAgency(source, record.replaceAll('AACO', 'aaco'))).not.toThrow();
  });
});

describe('EnerGov anonymous detail and contacts JSON fixtures', () => {
  it('reads detail fields and public contractor while omitting masked names and ambiguous Title', () => {
    const details = energov(5001);
    expect(details).toMatchObject({ Permit: 'RERF-001928-2012', Contractor: 'Allstate Roofing Specialist Inc dba Allstate Roofing', 'Job value': '14700', Parcel: '43042311', Finaled: '2013-02-12T19:04:58.35Z' });
    expect(details).not.toHaveProperty('Applicant');
    expect(details).not.toHaveProperty('Owner');
    expect(details).not.toHaveProperty('Contractor license');
  });
  it('aggregates multiple contacts in each role, deduplicating identical business/person names', () => {
    expect(energov(6146)).toMatchObject({
      Applicant: 'DENNIS SOUTHWARD / SOUTHWARD CONTRACTING INC; CAFE SOLE',
      Contractor: 'DENNIS SOUTHWARD / SOUTHWARD CONTRACTING INC; NORTHSTAR MECHANICAL INC; BOULDER ELECTRIC, INC.',
    });
  });
  it('preserves agent versus applicant and respects hidden valuation', () => {
    expect(energov(2871)).toMatchObject({ Agent: 'Radek Juran / Perpetual Marine LLC', Applicant: 'Fred Smith SR / Smith SR' });
    expect(energov(2871)).not.toHaveProperty('Job value');
  });
  it('reads property owner and contractor role variants', () => {
    expect(energov(5475)).toMatchObject({ Applicant: 'ANDREW RAMIREZ', Owner: 'COSTA MESA DENTAL PROPERTIES INC' });
    expect(energov(79)?.Contractor).toBe('CORELL CONTRACTOR INC');
  });
  it('omits anonymous-access-denied contacts but retains permit details', () => {
    expect(json(78, 'contacts').Success).toBe(false);
    expect(energov(78)).toMatchObject({ Permit: 'ELEC015550CR', Status: 'Closed' });
    expect(energov(78)).not.toHaveProperty('Contractor');
    expect(energov(78)).not.toHaveProperty('Applicant');
  });
  it('rejects mismatched number, case ID, module and failed detail envelopes', () => {
    const d = json(5001, 'detail');
    for (const number of ['', 'RERF-001928-201', 'rerf-001928-2012']) {
      expect(parseEnerGovDetail(d, null, number, d.Result.PermitId)).toBeNull();
    }
    expect(parseEnerGovDetail(d, null, d.Result.PermitNumber, 'another-case')).toBeNull();
    expect(parseEnerGovDetail({ ...d, Success: false }, null, d.Result.PermitNumber, d.Result.PermitId)).toBeNull();
    expect(energov(5001, json(6146, 'contacts'))).toBeNull();
    const c = json(5001, 'contacts'); c.Result[0].ModuleId = 2;
    expect(energov(5001, c)).toBeNull();
  });
  it('retains a real zero valuation when public', () => {
    const d = json(5001, 'detail'); d.Result.Value = 0;
    expect(parseEnerGovDetail(d, null, d.Result.PermitNumber, d.Result.PermitId)?.['Job value']).toBe('0');
  });
  it('requires the configured tenant on shared applications', () => {
    const tenants = [...json(5001, 'tenants').Result, ...json(78, 'tenants').Result.map((t: any) => ({ ...t, TenantID: 2 }))];
    const selected = tenants[0];
    const headers = { TenantID: String(selected.TenantID), TenantName: selected.TenantName };
    const app = 'https://shared.gov/apps/selfservice';
    expect(() => assertEnerGovTenant(`${app}/${selected.TenantUrl}`, tenants, headers)).not.toThrow();
    expect(() => assertEnerGovTenant(`${app}/${tenants[1].TenantUrl}`, tenants, headers)).toThrow(/different tenant/);
    expect(() => assertEnerGovTenant(app, tenants, headers)).toThrow(/multiple tenants/);
    expect(() => assertEnerGovTenant(app, tenants, {})).toThrow(/headers/);
  });
  it.each(['https://other.gov/apps/selfservice/api/energov/permits/permitdetail', 'https://host.gov/other/selfservice/api/energov/permits/permitdetail', 'https://host.gov/apps/selfservice-OTHER/api/energov/permits/permitdetail'])('rejects detail API outside the application: %s', target => {
    expect(() => assertEnerGovApplication('https://host.gov/apps/selfservice#/home', target)).toThrow(/application/);
  });
});

describe('detail dispatch, deadline and session cleanup (no network)', () => {
  afterEach(async () => { await closeBrowser(); vi.restoreAllMocks(); vi.useRealTimers(); });
  function browserWith(page: any) {
    const context = { setDefaultTimeout: vi.fn(), setDefaultNavigationTimeout: vi.fn(), newPage: vi.fn().mockResolvedValue(page), close: vi.fn().mockResolvedValue(undefined) };
    vi.spyOn(chromium, 'launch').mockResolvedValue({ on: vi.fn(), isConnected: () => true, newContext: vi.fn().mockResolvedValue(context), close: vi.fn().mockResolvedValue(undefined) } as any);
    return context;
  }
  it.each(['Accela', 'Tyler EnerGov'])('dispatches %s, returns null on failures and closes its context', async platform => {
    const context = browserWith({ on: vi.fn(), goto: vi.fn().mockRejectedValue(new Error('offline')), waitForResponse: vi.fn().mockResolvedValue({}) });
    expect(await scrapePermitDetail(platform, platform === 'Accela' ? source : 'https://county.gov/apps/selfservice', 'P-1', { caseId: '107330a1-cdee-484e-92f6-ad2e58c98e22' })).toBeNull();
    expect(context.close).toHaveBeenCalled();
  });
  it('ignores analytics URLs containing CapHome and returns the exact public record', async () => {
    let currentUrl = source;
    const locator: any = { first: () => locator, fill: vi.fn(), waitFor: vi.fn(), click: async () => { currentUrl = record; } };
    const page = {
      goto: async (url: string) => { currentUrl = url; return { ok: () => true, status: () => 200 }; },
      url: () => currentUrl, content: async () => fixture('accela-118.html'), locator: () => locator,
      waitForFunction: vi.fn(),
      waitForResponse: async (predicate: (response: any) => boolean) => {
        const response = (url: string) => ({ url: () => url, request: () => ({ method: () => 'POST' }), ok: () => true, finished: vi.fn() });
        expect(predicate(response('https://www.google-analytics.com/g/collect?dl=https://aca-prod.accela.com/AACO/Cap/CapHome.aspx'))).toBe(false);
        const search = response('https://aca-prod.accela.com/AACO/Cap/CapHome.aspx?module=Permits');
        expect(predicate(search)).toBe(true);
        return search;
      },
    };
    const context = browserWith(page);
    expect(await scrapePermitDetail('Accela', source, 'F00005377', null)).toMatchObject({ Applicant: 'Leslie Ferrara' });
    expect(context.close).toHaveBeenCalled();
  });
  it('stops a hung operation at 60 seconds and closes the context', async () => {
    vi.useFakeTimers();
    const context = browserWith({ goto: vi.fn(() => new Promise(() => {})) });
    const pending = scrapePermitDetail('Accela', source, 'P-1', null);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(await pending).toBeNull();
    expect(context.close).toHaveBeenCalled();
  });
  it('closes a context that finishes creating after the deadline', async () => {
    vi.useFakeTimers();
    let finish!: (context: any) => void;
    const context = { close: vi.fn().mockResolvedValue(undefined) };
    vi.spyOn(chromium, 'launch').mockResolvedValue({ on: vi.fn(), isConnected: () => true, close: vi.fn().mockResolvedValue(undefined), newContext: () => new Promise(resolve => { finish = resolve; }) } as any);
    const pending = scrapePermitDetail('Accela', source, 'P-1', null);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(await pending).toBeNull();
    finish(context);
    await vi.advanceTimersByTimeAsync(0);
    expect(context.close).toHaveBeenCalled();
  });
});
