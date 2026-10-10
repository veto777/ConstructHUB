import { readFileSync } from 'node:fs';
import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('./polite-fetch', async importOriginal => ({ ...await importOriginal<typeof import('./polite-fetch')>(), politeFetch: vi.fn() }));
import adapter, { citizenserveSearchUrl, inspectCitizenserveSearch } from './citizenserve';
import { politeFetch, PortalBlockedError } from './polite-fetch';
import type { AdapterCtx } from './types';

const fixture = (name: string) => readFileSync(new URL(`./fixtures/citizenserve/${name}-search.html`, import.meta.url), 'utf8');
const ctx: AdapterCtx = {
  databaseId: 1, databaseName: 'Pottawattamie County, IA', jurisdiction: 'Pottawattamie County, IA',
  searchUrl: 'https://www.citizenserve.com/Portal/PortalController?Action=showHomePage&installationID=220',
  portalUrl: null, browser: vi.fn(), log: vi.fn(), politeness: { minDelayMs: 100 },
};
beforeEach(() => vi.clearAllMocks());
describe('CitizenServe verified access constraints', () => {
  it.each(['pottawattamie', 'richfield', 'merriam'])('recognizes the real %s CAPTCHA without posting', name => {
    expect(() => inspectCitizenserveSearch(fixture(name), ctx.searchUrl)).toThrow(PortalBlockedError);
    expect(() => inspectCitizenserveSearch(fixture(name), ctx.searchUrl)).toThrow(/CAPTCHA/);
  });
  it('derives the installation from lowercase query keys and preserves the tenant host', () => {
    const url = new URL(citizenserveSearchUrl('https://www7.citizenserve.com/Portal/?installationid=386'));
    expect(url.hostname).toBe('www7.citizenserve.com');
    expect(url.searchParams.get('installationID')).toBe('386');
    expect(url.searchParams.get('Action')).toBe('showSearchPage');
  });
  it.each(['https://citizenserve.com.evil.test/Portal/?installationid=1', 'https://www.oconeesc.com/Departments/', 'https://www.citizenserve.com/Portal/', 'https://www.citizenserve.com/bedford'])('rejects unsupported URL %s', url => {
    expect(() => citizenserveSearchUrl(url)).toThrow();
  });
  it('search propagates a typed block and uses only one rate-limited GET', async () => {
    vi.mocked(politeFetch).mockResolvedValue(new Response(fixture('pottawattamie')));
    await expect(adapter.search(ctx, { type: 'permit', value: '2026' })).rejects.toBeInstanceOf(PortalBlockedError);
    expect(politeFetch).toHaveBeenCalledTimes(1);
    expect(politeFetch).toHaveBeenCalledWith(expect.stringContaining('installationID=220'), { redirect: 'manual' }, { minDelayMs: 1000 });
  });
  it('never treats an unknown layout as no results', () => {
    expect(() => inspectCitizenserveSearch('', ctx.searchUrl)).toThrow(/not verified/);
  });
  it('has no advertised unsupported searches, detail or date polling', async () => {
    expect(adapter.capabilities).toEqual({ search: [], detail: false, listRecent: false });
    expect(await adapter.listRecent(ctx, '2026-10-03')).toEqual([]);
    expect(politeFetch).not.toHaveBeenCalled();
  });
});
