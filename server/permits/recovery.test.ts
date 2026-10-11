import { describe, expect, it, vi } from 'vitest';
import { readSearchUpdate } from '../../client/src/pages/permit-search-poll';
import { hitPage, hitPageInput } from './hit-pagination';
import { propertyOfficeForDisplay, resolvePropertyScope } from '../../client/src/pages/property-display';

describe('interrupted search recovery', () => {
  it.each([401, 402, 404])('stops polling for terminal %s, preserving the caller’s last result', async status => {
    const stop = vi.fn();
    await expect(readSearchUpdate('fresh-or-restored', new AbortController().signal, stop, vi.fn().mockResolvedValue(new Response('{}', { status })))).rejects.toThrow(`${status}:`);
    expect(stop).toHaveBeenCalledOnce();
  });
  it('allows a failed connection to recover on the next update', async () => {
    const stop = vi.fn();
    const fetcher = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(new Response('{}', { status: 503 })).mockResolvedValueOnce(Response.json({ status: 'completed', results: [{ id: 1 }] }));
    const read = () => readSearchUpdate('job', new AbortController().signal, stop, fetcher);
    await expect(read()).rejects.toThrow('offline');
    await expect(read()).rejects.toThrow('503:');
    await expect(read()).resolves.toMatchObject({ status: 'completed', results: [{ id: 1 }] });
    expect(stop).not.toHaveBeenCalled();
  });
});

describe('retained match pagination', () => {
  it('reaches every retained match despite new arrivals between pages', () => {
    const rows = Array.from({ length: 237 }, (_, i) => ({ id: 237 - i }));
    let before: number | null = null;
    const seen: number[] = [];
    do {
      const page = hitPage(rows.filter(r => before === null || r.id < before).slice(0, 51), 50);
      seen.push(...page.hits.map(r => r.id));
      before = page.nextCursor;
      rows.unshift({ id: rows[0].id + 1 });
    } while (before !== null);
    expect(seen).toEqual(Array.from({ length: 237 }, (_, i) => 237 - i));
  });
  it('validates cursor and page size and ends at an exact page boundary', () => {
    expect(hitPageInput.parse({})).toEqual({ limit: 50 });
    for (const input of [{ before: '-1' }, { before: 'NaN' }, { before: ['1','2'] }, { limit: '201' }, { limit: '0' }]) expect(hitPageInput.safeParse(input).success).toBe(false);
    expect(hitPage([{ id: 2 }, { id: 1 }], 2).nextCursor).toBeNull();
    expect(hitPage([], 50)).toEqual({ hits: [], nextCursor: null });
  });
});

describe('property link display safeguards', () => {
  const office = { name: 'Example Assessor', portalUrl: 'https://example.gov/records', searchUrl: null, linkStatus: 'verified' };
  it('flags source-listed challenge URLs without inventing replacements', () => {
    const row = { ...office, portalUrl: 'https://www.perfdrive.com/?id=123' };
    expect(propertyOfficeForDisplay(row)).toEqual({ ...row, linkStatus: 'unconfirmed' });
    expect(row.linkStatus).toBe('verified');
  });
  it('rejects unsafe or malformed URLs and labels missing office names', () => {
    expect(propertyOfficeForDisplay({ ...office, name: 'Aleutian property records', portalUrl: 'javascript:alert(1)', searchUrl: 'not a URL' })).toMatchObject({ name: 'Aleutian Assessor', portalUrl: null, searchUrl: null });
    expect(propertyOfficeForDisplay(office)).toEqual(office);
  });
});

it('explains invalid deep links and keeps the nearest valid property scope', () => {
  const rows = [{ countyId: 12, county: { stateCode: 'WA' } }];
  expect(resolvePropertyScope(rows, 'ZZ', '12')).toEqual({ state: 'WA', county: '12', notice: '' });
  expect(resolvePropertyScope(rows, 'WA', 'bad')).toMatchObject({ state: 'WA', county: 'all', notice: expect.stringContaining('unavailable') });
  expect(resolvePropertyScope(rows, 'ZZ', '999')).toMatchObject({ state: 'all', county: 'all', notice: expect.stringContaining('unavailable') });
});
