import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { PortalBlockedError } from './polite-fetch';
import adapter, { parsePermitlinkTable, permitlinkDate, permitlinkFilters, permitlinkUrl } from './permitlink';
import type { AdapterCtx } from './types';
const ctx: AdapterCtx = { databaseId: 7, databaseName: 'Thompson', jurisdiction: 'Thompson, CT', searchUrl: 'https://permitlinkusa-online.com/csp/thompsonct/DocumentLink.PublicLogin.cls', portalUrl: null, browser: vi.fn(), log: vi.fn(), politeness: { minDelayMs: 1000 } };
const fixture = (name: string) => readFileSync(new URL(`./fixtures/permitlink/${name}`, import.meta.url), 'utf8');
describe('PermitLink guest permits', () => {
  it('derives the public guest route without hardcoding a tenant', () => {
    expect(permitlinkUrl(ctx.searchUrl)).toBe('https://permitlinkusa-online.com/csp/thompsonct/DocumentLink.GuestPermitListCenter.cls');
    expect(permitlinkUrl('http://www.permitlinkonline.com/csp/morris/DocumentLink.PublicWelcome.cls')).toContain('/csp/morris/DocumentLink.GuestPermitListCenter.cls');
    expect(() => permitlinkUrl('https://evil.test/csp/morris/DocumentLink.PublicLogin.cls')).toThrow();
    expect(() => permitlinkUrl('https://permitlinkonline.com/')).toThrow();
  });
  it('splits address filters and keeps permit numbers intact', () => {
    expect(permitlinkFilters('address', '363 QUADDICK TOWN FARM RD')).toEqual({ HouseNumber: '363', Location: 'QUADDICK TOWN FARM RD' });
    expect(permitlinkFilters('permit', '26-35IWA')).toEqual({ PermitID: '26-35IWA' });
    expect(() => permitlinkFilters('company', 'builder')).toThrow();
  });
  it('parses a real guest table, skips draft placeholders, and retains raw rows', () => {
    const out = parsePermitlinkTable(fixture('thompson-guest.html'), ctx);
    expect(out.rowIds).toHaveLength(30);
    expect(out.records.some(r => r.permitNumber === 'Draft')).toBe(false);
    const record = out.records.find(r => r.permitNumber === '26-35IWA')!;
    expect(record).toMatchObject({ address: '0 WEST THOMPSON RD', status: 'Closed', issuedAt: null, contractorName: null, sourceUrl: null });
    expect(record.raw?.html).toContain('zenValue=');
  });
  it('parses a captured filtered DOM without returning stale initial rows', () => {
    const out = parsePermitlinkTable(fixture('thompson-filtered-dom.html'), ctx);
    expect(out.records).toHaveLength(1);
    expect(out.records[0].permitNumber).toBe('26-35IWA');
  });
  it('rejects broken pages and normalizes real issue dates', () => {
    expect(() => parsePermitlinkTable('<html>Login</html>', ctx)).toThrow();
    expect(permitlinkDate('10/07/2026')).toBe('2026-10-07');
    expect(permitlinkDate('02/31/2026')).toBeNull();
    expect(permitlinkDate('')).toBeNull();
  });
  it('does not emulate recent listing through searches', async () => {
    expect(adapter.capabilities.listRecent).toBe(false);
    expect(await adapter.listRecent(ctx, '2026-10-03')).toEqual([]);
    expect(ctx.browser).not.toHaveBeenCalled();
  });
  it('normalizes real Deep River and Middlefield issue dates', () => {
    const deep = parsePermitlinkTable(fixture('deepriver-guest.html'), { ...ctx, jurisdiction: 'Deep River, CT' });
    const middle = parsePermitlinkTable(fixture('middlefield-guest.html'), { ...ctx, jurisdiction: 'Middlefield, CT' });
    expect(deep.records.find(r => r.permitNumber === '26-2D')).toMatchObject({ address: '103 UNION ST', status: 'Approved', issuedAt: '2026-10-07', contractorName: null });
    expect(middle.records.find(r => r.permitNumber === '26-24P')).toMatchObject({ address: '11 CIDER MILL RD', status: 'Approved', issuedAt: '2026-10-07' });
  });
  it('returns no records only when a real empty table is present', () => {
    const out = parsePermitlinkTable(fixture('thompson-empty-dom.html'), ctx);
    expect(out).toEqual({ records: [], rowIds: [] });
  });
  it('keeps the original response row byte-for-byte', () => {
    const html = fixture('thompson-guest.html');
    const out = parsePermitlinkTable(html, ctx);
    expect(html).toContain(out.records[0].raw!.html);
  });

  it('throws a typed block and closes its browser context on HTTP 403', async () => {
    const listeners: Record<string, (...args: any[]) => void> = {};
    const page = {
      setDefaultTimeout: vi.fn(), on: vi.fn((event, callback) => { listeners[event] = callback; }),
      goto: vi.fn(async () => listeners.response({ status: () => 403, url: () => ctx.searchUrl, request: () => ({ resourceType: () => 'document' }) })),
    };
    const browser = { route: vi.fn(), newPage: vi.fn(async () => page), close: vi.fn() };
    await expect(adapter.search({ ...ctx, browser: vi.fn(async () => browser as any) }, { type: 'permit', value: '26-35IWA' })).rejects.toBeInstanceOf(PortalBlockedError);
    expect(browser.close).toHaveBeenCalledOnce();
  });
  it('closes the browser on a navigation failure instead of reporting no matches', async () => {
    const page = { setDefaultTimeout: vi.fn(), on: vi.fn(), goto: vi.fn().mockRejectedValue(new Error('Connection failed')) };
    const browser = { route: vi.fn(), newPage: vi.fn(async () => page), close: vi.fn() };
    await expect(adapter.search({ ...ctx, browser: vi.fn(async () => browser as any) }, { type: 'address', value: 'Main' })).rejects.toThrow('Connection failed');
    expect(browser.close).toHaveBeenCalledOnce();
  });

});
