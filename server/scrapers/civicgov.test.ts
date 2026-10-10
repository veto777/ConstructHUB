import { readFileSync } from 'node:fs';
import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('../storage', () => ({ storage: {} }));
vi.mock('./polite-fetch', async importOriginal => ({ ...await importOriginal<typeof import('./polite-fetch')>(), politeFetch: vi.fn() }));
import adapter, { civicgovPortalUrl, civicgovPublicSearchLink, civicgovCsrf, civicgovDate, parseCivicgovPage, parseCivicgovPermit } from './civicgov';
import { politeFetch, PortalBlockedError } from './polite-fetch';
import type { AdapterCtx } from './types';
const fixture = (file: string) => readFileSync(new URL(`./fixtures/civicgov/${file}`, import.meta.url), 'utf8');
const ctx: AdapterCtx = { databaseId: 9, databaseName: 'Parkville', jurisdiction: 'Parkville, MO', searchUrl: 'https://www.civicgov4.com/mo_parkville/portal/', portalUrl: null, browser: vi.fn(), log: vi.fn(), politeness: { minDelayMs: 100 } };
const parcels = JSON.parse(fixture('parkville-main-parcels.json'));
const permits = JSON.parse(fixture('parkville-permits.json'));
const parcel = parcels.parcels.find((p: { location: string }) => p.location === '405 MAIN ST');
beforeEach(() => vi.clearAllMocks());

describe('CivicGov recorded public responses', () => {
  it('derives the tenant path and discovers only the advertised public search', () => {
    expect(civicgovPortalUrl(ctx.searchUrl).pathname).toBe('/mo_parkville/portal/index.php');
    expect(civicgovPublicSearchLink(fixture('parkville-home.html'), ctx.searchUrl)).toContain('publicRecordsSearch/index');
    expect(civicgovCsrf(fixture('parkville-search.html'), ctx.searchUrl)).toBe('REDACTED');
  });
  it.each(['culpeper-home.html', 'spring-lake-home.html', 'culpeper-application-catalog.html'])('does not mistake %s for public permit records', file => {
    expect(() => civicgovPublicSearchLink(fixture(file), ctx.searchUrl)).toThrow(/does not advertise/);
  });
  it('maps actual permit data without inventing contractor names or issue dates', () => {
    const result = parseCivicgovPermit(permits.permits[0], parcel, ctx);
    expect(result).toMatchObject({ permitNumber: 'SPA25-04', address: '405 MAIN ST', status: 'Expired', appliedAt: '2025-01-13', issuedAt: null, contractorName: null, applicantName: 'KC Custom Signs', databaseId: 9 });
    expect(new URL(result.sourceUrl!).searchParams.get('id')).toBe('5179');
    expect(result.raw).toEqual({ permit: permits.permits[0], parcel });
    expect(parseCivicgovPermit(permits.permits[1], parcel, ctx)).toMatchObject({ permitNumber: 'A26-1449', status: 'Portal Submitted', appliedAt: '2026-09-22' });
  });
  it('validates observed pagination and refuses malformed or truncated data', () => {
    expect(parseCivicgovPage(parcels, 'parcels', 1)).toMatchObject({ pages: 5 });
    expect(parseCivicgovPage(permits, 'permits', 1).rows).toHaveLength(2);
    expect(() => parseCivicgovPage({}, 'permits', 1)).toThrow();
    expect(() => parseCivicgovPage(parcels, 'parcels', 2)).toThrow();
    expect(() => parseCivicgovPage({ ...parcels, parcels: [] }, 'parcels', 1)).toThrow();
    expect(() => parseCivicgovPermit({}, parcel, ctx)).toThrow();
  });
  it('rejects unsupported hosts and paths', () => {
    for (const url of ['https://emporiaks.gov/emporiacivicgovportal', 'https://www.civicgov4.com.evil.test/mo_parkville/portal/', 'https://www.civicgov4.com/mo_parkville/automated/portalHtml']) expect(() => civicgovPortalUrl(url)).toThrow();
  });
  it('keeps invalid and unknown dates null', () => {
    expect(civicgovDate('2026-09-22')).toBe('2026-09-22');
    for (const value of ['', null, '0000-00-00', '2026-02-30', '09/22/2026']) expect(civicgovDate(value)).toBeNull();
  });
  it('refuses unsupported queries without fetching or emulating them', async () => {
    for (const type of ['permit', 'company', 'license', 'name', 'keyword'] as const) await expect(adapter.search(ctx, { type, value: 'SPA25-04' })).rejects.toThrow(/address only/);
    await expect(adapter.search(ctx, { type: 'address', value: 'a' })).rejects.toThrow(/three/);
    expect(await adapter.listRecent(ctx, '2026-10-03')).toEqual([]);
    expect(politeFetch).not.toHaveBeenCalled();
    expect(adapter.capabilities).toEqual({ search: ['address'], listRecent: false, detail: false });
  });
  it('propagates 403, login redirects and transport failures as errors', async () => {
    vi.mocked(politeFetch).mockResolvedValueOnce(new Response('', { status: 403 }));
    await expect(adapter.search(ctx, { type: 'address', value: '405 Main St' })).rejects.toBeInstanceOf(PortalBlockedError);
    vi.mocked(politeFetch).mockResolvedValueOnce(new Response('', { status: 302, headers: { location: 'index.php?r=site/login' } }));
    await expect(adapter.search(ctx, { type: 'address', value: '405 Main St' })).rejects.toBeInstanceOf(PortalBlockedError);
    vi.mocked(politeFetch).mockRejectedValueOnce(new Error('network failure'));
    await expect(adapter.search(ctx, { type: 'address', value: '405 Main St' })).rejects.toThrow('network failure');
  });
});

describe('CivicGov search with real responses and no network', () => {
  const respond = (files: string[]) => {
    for (const file of files) vi.mocked(politeFetch).mockResolvedValueOnce(new Response(fixture(file), { headers: { 'Set-Cookie': 'test_session=offline; Path=/; HttpOnly' } }));
  };
  const sequence = (prefix: string) => ['home.html', 'index.html', 'search.json', 'parcelDetails.html', 'getPermits.json'].map(suffix => `${prefix}-${suffix}`);
  it('retrieves Parkville records with tenant-isolated cookies, CSRF headers and a rate limit', async () => {
    respond(sequence('parkville-exact'));
    const result = await adapter.search(ctx, { type: 'address', value: '405 Main St' });
    expect(result.map(r => r.permitNumber)).toEqual(['SPA25-04', 'A26-1449']);
    expect(politeFetch).toHaveBeenCalledTimes(5);
    const calls = vi.mocked(politeFetch).mock.calls;
    expect(new URL(calls[2][0]).searchParams.get('query')).toBe('405 Main St');
    expect(calls[2][1]?.headers).toMatchObject({ Cookie: 'test_session=offline', 'X-CSRF-Token': 'REDACTED' });
    for (const call of calls) {
      expect(new URL(call[0]).pathname).toBe('/mo_parkville/portal/index.php');
      expect(call[2]?.minDelayMs).toBe(1000);
    }
    expect(JSON.stringify(result)).not.toContain('test_session');
  });
  it('returns a genuine empty permit collection for Jefferson, not a parcel posing as a permit', async () => {
    respond(sequence('jefferson'));
    const result = await adapter.search({ ...ctx, searchUrl: 'https://www.civicgov4.com/mo_jeffersoncounty/portal/' }, { type: 'address', value: '100 Main St' });
    expect(result).toEqual([]);
    expect(politeFetch).toHaveBeenCalledTimes(5);
  });
  it('parses another live tenant without hardcoded agency values', async () => {
    respond(sequence('south-portland'));
    const result = await adapter.search({ ...ctx, jurisdiction: 'South Portland, ME', searchUrl: 'https://www.civicgov4.com/me_southportland/portal/index.php' }, { type: 'address', value: '100 Main St' });
    expect(result).toHaveLength(3);
    expect(result[0]).toMatchObject({ permitNumber: 'B20100478', address: '100 MAIN ST', status: 'Closed', appliedAt: '2010-05-03', jurisdiction: 'South Portland, ME' });
    expect(result[0].sourceUrl).toContain('/me_southportland/portal/');
  });
  it('refuses malformed JSON instead of reporting zero results', async () => {
    respond(['parkville-exact-home.html', 'parkville-exact-index.html']);
    vi.mocked(politeFetch).mockResolvedValueOnce(new Response('{}'));
    await expect(adapter.search(ctx, { type: 'address', value: '405 Main St' })).rejects.toThrow(/pagination/);
  });
  it('never returns partial success if a later request fails', async () => {
    respond(['parkville-exact-home.html', 'parkville-exact-index.html', 'parkville-exact-search.json', 'parkville-exact-parcelDetails.html']);
    vi.mocked(politeFetch).mockRejectedValueOnce(new PortalBlockedError(ctx.searchUrl, 429));
    await expect(adapter.search(ctx, { type: 'address', value: '405 Main St' })).rejects.toBeInstanceOf(PortalBlockedError);
  });
});


it('registers all assigned platform labels under the correct vendor', async () => {
  const { getAdapter } = await import('./registry');
  const citizenserve = (await import('./citizenserve')).default;
  for (const vendor of [adapter, citizenserve]) {
    for (const label of [vendor.platform, ...(vendor.aliases ?? [])]) expect(getAdapter(label)).toBe(vendor);
  }
});
