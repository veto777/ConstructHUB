import { fork, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const raw = process.env.DATABASE_URL;
describe.skipIf(!raw)('quota reservation across independent application processes', () => {
  const schema = `quota_r5_${randomUUID().replaceAll('-', '')}`;
  let db: pg.Pool;
  const children: ChildProcess[] = [];
  const bases: string[] = [];
  beforeAll(async () => {
    const url = new URL(raw!);
    if (url.pathname !== '/constructhub_dev_fs' || url.port === '5433' || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
      throw new Error('Quota DB tests require the local constructhub_dev_fs lane, never port 5433');
    }
    db = new pg.Pool({ connectionString: raw });
    // Isolated usage ledger: never touch sample accounts or their monthly usage.
    await db.query(`CREATE SCHEMA ${schema}`);
    await db.query(`CREATE TABLE ${schema}.account_api_usage (
      key_id text NOT NULL, user_id integer NOT NULL, day date NOT NULL,
      units integer NOT NULL, requests integer NOT NULL, PRIMARY KEY(key_id, day))`);
    url.searchParams.set('options', `-c search_path=${schema},public -c TimeZone=UTC`);
    for (let i = 0; i < 2; i++) {
      const child = fork(fileURLToPath(new URL('./quota-process-fixture.ts', import.meta.url)), [], {
        execArgv: ['--import', 'tsx'],
        env: { ...process.env, DATABASE_URL: url.href, QUOTA_TEST_CHILD: '1' },
        stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      });
      children.push(child);
      bases.push(await new Promise<string>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Quota child did not start')), 10_000);
        child.once('message', (message: any) => { clearTimeout(timeout); resolve(`http://127.0.0.1:${message.port}`); });
        child.once('error', error => { clearTimeout(timeout); reject(error); });
        child.once('exit', code => { clearTimeout(timeout); reject(new Error(`Quota child exited ${code}`)); });
      }));
    }
  });
  afterAll(async () => {
    await Promise.all(children.map(child => new Promise<void>(resolve => {
      if (child.exitCode !== null) return resolve();
      const timer = setTimeout(() => child.kill('SIGKILL'), 3000);
      child.once('exit', () => { clearTimeout(timer); resolve(); });
      child.kill('SIGTERM');
    })));
    if (db) { await db.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); await db.end(); }
  });
  const get = async (i: number, query: string) => {
    const res = await fetch(`${bases[i % 2]}/?${query}`);
    return { status: res.status, remaining: res.headers.get('X-Units-Remaining'), body: await res.json() };
  };
  it.each(['key', 'account'])('prevents overspending a one-unit %s cap across two processes', async scope => {
    const user = scope === 'key' ? 1900000001 : 1900000002;
    const results = await Promise.all(Array.from({ length: 12 }, (_, i) => get(i,
      `user=${user}&key=${scope === 'key' ? 'shared' : `key-${i}`}&cap=${scope === 'key' ? 1 : 100}&plan=${scope === 'account' ? 1 : 100}`)));
    expect(results.filter(r => r.status === 200)).toHaveLength(1);
    expect(results.filter(r => r.status === 429)).toHaveLength(11);
    const { rows: [usage] } = await db.query(`SELECT sum(units)::int AS units, sum(requests)::int AS requests FROM ${schema}.account_api_usage WHERE user_id=$1`, [user]);
    expect(usage).toEqual({ units: 1, requests: 1 });
  });
  it('rolls back failed and oversized responses, then commits the actual row cost', async () => {
    const query = 'user=1900000003&key=recovery&cap=3';
    expect((await get(0, `${query}&fail=1`)).status).toBe(400);
    expect((await get(1, `${query}&rows=300`)).status).toBe(429);
    const success = await get(0, `${query}&rows=200`);
    expect(success).toMatchObject({ status: 200, remaining: '0' });
    expect((await get(1, query)).status).toBe(429);
    const { rows: [usage] } = await db.query(`SELECT units, requests FROM ${schema}.account_api_usage WHERE key_id='recovery'`);
    expect(usage).toEqual({ units: 3, requests: 1 });
  });
});
