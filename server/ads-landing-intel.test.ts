import { describe, expect, it, vi, afterEach } from 'vitest';
import { cidrMatcher, boundedIntel, lookupIntel, refreshBans, banIp, isLandingBanned, refreshRanges, rangeHit } from './ads-landing-intel';
import { pool } from './db';
vi.mock('./db', () => ({ pool: { query: vi.fn(async () => ({ rows: [] })) } }));
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.useRealTimers(); });

describe('CIDR matching', () => {
  it('matches IPv4 boundaries and exact hosts, without leaking into adjacent networks', () => {
    const match = cidrMatcher(['10.0.0.0/24', '192.0.2.7/32']);
    for (const ip of ['10.0.0.0', '10.0.0.255', '192.0.2.7']) expect(match(ip)).toBe(true);
    for (const ip of ['10.0.1.0', '192.0.2.8', 'bad', '2001:db8::1']) expect(match(ip)).toBe(false);
  });
  it('matches compressed IPv6, exact hosts, and IPv4-mapped IPv6', () => {
    const match = cidrMatcher(['2001:db8:abcd::/48', '2001:db8::9/128', '192.0.2.0/24']);
    for (const ip of ['2001:db8:abcd::', '2001:0db8:abcd:ffff:ffff:ffff:ffff:ffff', '2001:db8::9', '::ffff:192.0.2.1']) expect(match(ip), ip).toBe(true);
    for (const ip of ['2001:db8:abce::', '2001:db8::8', '192.0.3.1']) expect(match(ip)).toBe(false);
  });
  it('supports /0 and ignores malformed prefixes', () => {
    expect(cidrMatcher(['0.0.0.0/0'])('8.8.8.8')).toBe(true);
    expect(cidrMatcher(['::/0'])('2001:db8::1')).toBe(true);
    const match = cidrMatcher(['nope/1', '1.2.3.4/33', '::/129', '::/-1', '::/x', '::/1/2']);
    expect(match('1.2.3.4')).toBe(false); expect(match('::')).toBe(false);
  });
});
describe('intelligence availability', () => {
  it('combines ipinfo privacy flags and optional IPQS, then caches the result', async () => {
    vi.stubEnv('IPQS_API_KEY', 'test-key');
    vi.mocked(pool.query).mockResolvedValue({ rows: [] } as any);
    vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(JSON.stringify(url.includes('ipinfo.io')
      ? { ip: '192.0.2.90', org: 'AS16509 Example', privacy: { hosting: true, tor: true } }
      : { success: true, vpn: true, proxy: true }))));
    expect(await lookupIntel('192.0.2.90')).toEqual({ proxy: true, vpn: true, hosting: true, tor: true, asn: 16509 });
    expect(vi.mocked(pool.query).mock.calls.some(([sql]) => String(sql).includes('INSERT INTO ip_intel_cache'))).toBe(true);
  });
  it('returns uncertain on upstream failures and never caches a false negative', async () => {
    vi.stubEnv('IPQS_API_KEY', '');
    vi.mocked(pool.query).mockResolvedValue({ rows: [] } as any);
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 429 })));
    const before = vi.mocked(pool.query).mock.calls.length;
    expect(await lookupIntel('192.0.2.91')).toBe(null);
    expect(vi.mocked(pool.query).mock.calls.slice(before).some(([sql]) => String(sql).includes('INSERT INTO ip_intel_cache'))).toBe(false);
  });
  it('uses the 30-day cache without a network request', async () => {
    const intel = { proxy: true, vpn: false, tor: false, hosting: false };
    vi.mocked(pool.query).mockImplementation(async (sql: any) => ({ rows: String(sql).startsWith('SELECT intel') ? [{ intel }] : [] }) as any);
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    expect(await lookupIntel('192.0.2.1')).toEqual(intel);
    expect(fetcher).not.toHaveBeenCalled();
    expect(vi.mocked(pool.query).mock.calls.some(([sql]) => String(sql).includes("interval '30 days'"))).toBe(true);
  });
  it('returns uncertain at 1.5 seconds without cancelling enrichment', async () => {
    vi.useFakeTimers();
    let resolve!: (v: any) => void;
    const work = new Promise<any>(r => { resolve = r; });
    const bounded = boundedIntel(work);
    await vi.advanceTimersByTimeAsync(1500);
    expect(await bounded).toBe(null);
    resolve({ proxy: true });
    expect(await work).toEqual({ proxy: true });
  });
  it('keeps previous ranges when a refresh fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('192.0.2.0/24\n2001:db8::/32')));
    await refreshRanges();
    expect(rangeHit('192.0.2.1')).toBe('datacenter');
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    await refreshRanges();
    expect(rangeHit('192.0.2.1')).toBe('datacenter');
    expect(rangeHit('2001:db8::1')).toBe('datacenter');
  });
  it('retains the ban set on DB failure and immediately adds new bans', async () => {
    vi.mocked(pool.query).mockResolvedValue({ rows: [{ ip: '192.0.2.33' }] } as any);
    await refreshBans(); expect(isLandingBanned('192.0.2.33')).toBe(true);
    vi.mocked(pool.query).mockRejectedValue(new Error('offline'));
    await refreshBans(); expect(isLandingBanned('192.0.2.33')).toBe(true);
    banIp('192.0.2.34'); expect(isLandingBanned('192.0.2.34')).toBe(true);
  });
});
