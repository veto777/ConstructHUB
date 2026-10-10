import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
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
    expect(record.raw?.html).toContain('zenvalue=');
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
});
