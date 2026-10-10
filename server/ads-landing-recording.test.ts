import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import { pool } from './db';
import { registerAdsLandingRecording, recordingInput, MAX_RECORDING_BYTES, pruneRecordings } from './ads-landing-recording';

vi.mock('./db', () => ({ pool: { query: vi.fn(async () => ({ rows: [] })), connect: vi.fn() } }));
vi.mock('./crm/admin', () => ({ requirePlatformAdmin: vi.fn(async (req, res) => {
  if (req.headers['x-test-admin'] === 'yes') return { id: 1 };
  res.status(403).json({ message: 'Platform admin access required' }); return null;
}) }));
vi.mock('./route-guards', () => ({ visitorIp: (req: any) => String(req.headers['x-test-ip'] || '192.0.2.1') }));

const sessionId = '00000000-0000-4000-8000-000000000001';
const snapshot = { type: 2, timestamp: Date.now(), data: { node: { type: 0, id: 1, childNodes: [] }, initialOffset: { left: 0, top: 0 } } };
const delta = { type: 3, timestamp: Date.now(), data: { source: 3, x: 2, y: 3 } };
const body = (events: any[] = [snapshot]) => ({ sessionId, door: '/googleads-features', events });
let server: ReturnType<ReturnType<typeof express>['listen']>, base: string;
beforeAll(async () => {
  const app = express(); registerAdsLandingRecording(app);
  server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  base = `http://127.0.0.1:${(server.address() as any).port}`;
});
afterAll(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); });
beforeEach(() => { vi.mocked(pool.query).mockReset(); vi.mocked(pool.query).mockResolvedValue({ rows: [] } as any); });
async function post(payload: any, ip = '192.0.2.1') {
  return fetch(`${base}/api/ads-lp/rr`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-test-ip': ip }, body: JSON.stringify(payload) });
}

describe('recording endpoint', () => {
  it.each([null, {}, { ...body(), door: '/pricing' }, { ...body(), sessionId: 'bad' }, body([]), body([{ type: 3 }]), { ...body(), sequence: -1 }])('rejects invalid input %j', async input => {
    expect(recordingInput(input)).toBe(false);
    expect((await post(input)).status).toBe(400);
    expect(pool.query).not.toHaveBeenCalled();
  });
  it('accepts a full snapshot larger than keepalive permits', async () => {
    vi.mocked(pool.query).mockResolvedValue({ rows: [{ session_id: sessionId }] } as any);
    const large = { ...snapshot, data: { ...snapshot.data, text: 'x'.repeat(100000) } };
    expect((await post(body([large]))).status).toBe(204);
    const [sql, values] = vi.mocked(pool.query).mock.calls[0];
    expect(String(sql)).toContain("interval '5 minutes'");
    expect((values as any[])[5]).toBe(true);
    expect((values as any[])[4]).toBeGreaterThan(64 * 1024);
  });
  it('rejects a delta for an unknown session', async () => {
    expect((await post(body([delta]))).status).toBe(409);
    const [sql, values] = vi.mocked(pool.query).mock.calls[0];
    expect((values as any[])[5]).toBe(false);
    expect(String(sql)).toContain('OR EXISTS(SELECT 1 FROM ads_lp_rr WHERE session_id=$1)');
  });
  it('appends a delta to an existing session under atomic caps and identity checks', async () => {
    vi.mocked(pool.query).mockResolvedValue({ rows: [{ session_id: sessionId }] } as any);
    expect((await post({ ...body([delta]), sequence: 1 })).status).toBe(204);
    const sql = String(vi.mocked(pool.query).mock.calls[0][0]);
    for (const guard of ['ads_lp_rr.ip=excluded.ip', 'ads_lp_rr.door=excluded.door', 'ads_lp_rr.bytes+excluded.bytes <= $8', "interval '30 minutes'", 'ads_lp_rr.next_sequence=$7']) expect(sql).toContain(guard);
  });
  it('rejects an over-cap session batch before touching storage', async () => {
    expect((await post(body([{ ...snapshot, data: { text: 'x'.repeat(MAX_RECORDING_BYTES) } }]))).status).toBe(413);
    expect(pool.query).not.toHaveBeenCalled();
  });
  it('acknowledges an already stored sequence without appending it twice', async () => {
    vi.mocked(pool.query).mockResolvedValueOnce({ rows: [] } as any).mockResolvedValueOnce({ rows: [{ exists: 1 }] } as any);
    expect((await post({ ...body(), sequence: 0 })).status).toBe(204);
    expect(String(vi.mocked(pool.query).mock.calls[1][0])).toContain('next_sequence>$4');
  });
  it('fails gracefully when storage is unavailable', async () => {
    vi.mocked(pool.query).mockRejectedValue(new Error('offline'));
    expect((await post(body())).status).toBe(503);
  });
  it('rate-limits per IP', async () => {
    for (let i = 0; i < 120; i++) await post({}, '192.0.2.250');
    expect((await post({}, '192.0.2.250')).status).toBe(429);
    expect((await post({}, '192.0.2.251')).status).toBe(400);
  });
  it('protects both replay and hit-list reads with platform admin authentication', async () => {
    for (const path of ['/api/ads-lp/hits', `/api/ads-lp/rr/${sessionId}`]) {
      expect((await fetch(base + path)).status).toBe(403);
    }
    expect(pool.query).not.toHaveBeenCalled();
  });
  it('lists at most 200 hits and returns replay events to an admin', async () => {
    vi.mocked(pool.query).mockResolvedValueOnce({ rows: [{ id: 1 }] } as any);
    const list = await fetch(base + '/api/ads-lp/hits', { headers: { 'x-test-admin': 'yes' } });
    expect(list.status).toBe(200); expect(await list.json()).toEqual({ items: [{ id: 1 }] });
    expect(String(vi.mocked(pool.query).mock.calls[0][0])).toContain('LIMIT 200');
    vi.mocked(pool.query).mockResolvedValueOnce({ rows: [{ session_id: sessionId, events: [snapshot] }] } as any);
    const replay = await fetch(base + `/api/ads-lp/rr/${sessionId}`, { headers: { 'x-test-admin': 'yes' } });
    expect((await replay.json()).events).toEqual([snapshot]);
    expect(replay.headers.get('cache-control')).toBe('private, no-store');
  });
  it('prunes only under the Ads worker lock and always releases the client', async () => {
    const db = { query: vi.fn().mockResolvedValue({ rows: [{ locked: true }] }), release: vi.fn() };
    vi.mocked(pool.connect).mockResolvedValue(db as any);
    await pruneRecordings();
    expect(db.query.mock.calls.map(c => c[0])).toEqual([
      'SELECT pg_try_advisory_lock(8249,0) locked',
      "DELETE FROM ads_lp_rr WHERE started_at < now()-interval '60 days'",
      'SELECT pg_advisory_unlock(8249,0)',
    ]);
    expect(db.release).toHaveBeenCalled();
  });
});

const recorder = vi.hoisted(() => ({ emit: undefined as ((event: any) => void) | undefined, stop: vi.fn() }));
vi.mock('rrweb', () => ({ record: (options: any) => { recorder.emit = options.emit; return recorder.stop; } }));

describe('browser recording transport', () => {
  async function browser(path = '/googleads-features', google = false) {
    vi.resetModules(); vi.useFakeTimers();
    recorder.emit = undefined; recorder.stop.mockClear();
    const listeners = new Map<string, () => void>();
    vi.stubGlobal('window', { location: { pathname: path }, addEventListener: (key: string, fn: () => void) => listeners.set(key, fn), removeEventListener: vi.fn() });
    vi.stubGlobal('document', { visibilityState: 'hidden', querySelector: () => google ? {} : null,
      addEventListener: (key: string, fn: () => void) => listeners.set(key, fn), removeEventListener: vi.fn() });
    const fetcher = vi.fn(async () => ({ ok: true, status: 204 }));
    vi.stubGlobal('fetch', fetcher);
    const { startAdsDoorRecorder } = await import('../client/src/lib/ads-door-recorder');
    await startAdsDoorRecorder();
    return { fetcher, listeners };
  }
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
  it.each(['/googleads-features', '/googleads-crm', '/googleads-pricing'])('sends %s full snapshot immediately without keepalive', async path => {
    const { fetcher, listeners } = await browser(path);
    recorder.emit!({ type: 4, timestamp: 1, data: { width: 1200, height: 800 } });
    expect(fetcher).not.toHaveBeenCalled();
    recorder.emit!({ ...snapshot, data: { ...snapshot.data, text: 'x'.repeat(100000) } });
    expect(fetcher).toHaveBeenCalledTimes(1);
    const first = (fetcher.mock.calls as any)[0][1];
    expect(first.keepalive).toBe(false);
    expect(JSON.parse(first.body).events[0].type).toBe(2);
    expect(first.body.length).toBeGreaterThan(64 * 1024);
    await vi.advanceTimersByTimeAsync(1);
    recorder.emit!(delta); listeners.get('pagehide')!();
    expect((fetcher.mock.calls as any)[1][1].keepalive).toBe(true);
    expect(JSON.parse((fetcher.mock.calls as any)[1][1].body).sequence).toBe(1);
  });
  it('does not start on a public page or a server-verified Google visit', async () => {
    await browser('/pricing'); expect(recorder.emit).toBeUndefined();
    await browser('/googleads-crm', true); expect(recorder.emit).toBeUndefined();
  });
  it('retries a failed snapshot before subsequent deltas', async () => {
    const { fetcher } = await browser();
    fetcher.mockRejectedValueOnce(new Error('offline'));
    recorder.emit!(snapshot);
    await vi.advanceTimersByTimeAsync(1);
    recorder.emit!(delta);
    await vi.advanceTimersByTimeAsync(5000);
    const retry = JSON.parse((fetcher.mock.calls as any)[1][1].body);
    expect(retry.sequence).toBe(0); expect(retry.events[0].type).toBe(2);
    expect(retry.events).toHaveLength(1);
    expect((fetcher.mock.calls as any)[1][1].keepalive).toBe(false);
    await vi.advanceTimersByTimeAsync(5000);
    const next = JSON.parse((fetcher.mock.calls as any)[2][1].body);
    expect(next.sequence).toBe(1); expect(next.events).toEqual([delta]);
  });
  it('stops after 30 minutes', async () => {
    await browser(); recorder.emit!(snapshot);
    await vi.advanceTimersByTimeAsync(30 * 60 * 1000);
    expect(recorder.stop).toHaveBeenCalled();
  });
  it('stops before exceeding 10 MB', async () => {
    const { fetcher } = await browser();
    recorder.emit!({ ...snapshot, data: { text: 'x'.repeat(MAX_RECORDING_BYTES) } });
    expect(recorder.stop).toHaveBeenCalled(); expect(fetcher).not.toHaveBeenCalled();
  });
});
