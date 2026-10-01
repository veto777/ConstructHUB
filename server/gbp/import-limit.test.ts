import { beforeEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ rows: [] as any[], tail: Promise.resolve(), limit: 1, plan: true }));
vi.mock('../entitlements', () => ({
  getEntitlements: async () => ({ accessPlan: state.plan ? 'starter' : null, allowances: state.plan ? { locations: state.limit } : null }),
  locationCount: async (id: number, c: any) => (await c.query('SELECT count(*)::int n FROM business_locations WHERE user_id=$1', [id])).rows[0].n,
  sendLocationLimit: (res: any, _ent: any, used: number) => res.status(403).json({ code: 'limit_reached', feature: 'locations', used }),
  sendPlanRequired: (res: any) => res.status(402).json({ code: 'plan_required' }),
}));
vi.mock('../account-events', () => ({ logActivity: vi.fn(), notifyUser: vi.fn() }));
vi.mock('./grants', () => ({ accessToken: vi.fn(), grantUsable: vi.fn(), invalidate: vi.fn(), soleSubject: vi.fn() }));
vi.mock('./reply', () => ({ clientFor: vi.fn(), ownedLocation: vi.fn(), publicError: vi.fn(), reply: vi.fn(), withLocationLock: vi.fn() }));
vi.mock('../db', () => {
  function connection() {
    let unlock: (() => void) | undefined, snapshot: any[] | undefined;
    return {
      release: () => unlock?.(),
      query: async (sql: string, args: any[] = []) => {
        if (sql.includes('pg_advisory_xact_lock')) {
          const previous = state.tail;
          state.tail = new Promise<void>(r => { unlock = r; });
          await previous; snapshot = structuredClone(state.rows);
        } else if (sql === 'ROLLBACK') { if (snapshot) state.rows = snapshot; unlock?.(); }
        else if (sql === 'COMMIT') unlock?.();
        else if (sql.includes('count(*)')) return { rows: [{ n: state.rows.length }] };
        else if (sql.startsWith('SELECT id')) return { rows: state.rows.filter(r => r.name === args[1]) };
        else if (sql.startsWith('INSERT INTO business_locations')) {
          const row = { id: state.rows.length + 1, name: args[3] }; state.rows.push(row); return { rows: [row] };
        }
        return { rows: [] };
      },
    };
  }
  return { pool: { query: (sql: string, args: any[]) => connection().query(sql, args), connect: async () => connection() } };
});
import { importVerifiedLocations } from './service';
const listing = (name: string) => ({ gbpName: name, accountResource: 'accounts/CODEX', businessName: 'CODEX import' });
beforeEach(() => { state.rows = []; state.tail = Promise.resolve(); state.limit = 1; state.plan = true; });
it('serializes two imports competing for the last location', async () => {
  const outcomes = await Promise.allSettled(['locations/CODEX1', 'locations/CODEX2'].map(name => importVerifiedLocations(123, [listing(name)])));
  expect(outcomes.filter(r => r.status === 'fulfilled')).toHaveLength(1);
  expect(state.rows).toHaveLength(1);
  const refusal = outcomes.find(r => r.status === 'rejected') as PromiseRejectedResult;
  expect(refusal.reason).toMatchObject({ status: 403, body: { code: 'limit_reached' } });
});
it('rolls back an oversized batch instead of partially importing it', async () => {
  await expect(importVerifiedLocations(123, [listing('locations/CODEX1'), listing('locations/CODEX2')])).rejects.toMatchObject({ status: 403 });
  expect(state.rows).toHaveLength(0);
});
it('permits reimporting an existing location at the limit', async () => {
  await importVerifiedLocations(123, [listing('locations/CODEX1')]);
  expect(await importVerifiedLocations(123, [listing('locations/CODEX1')])).toMatchObject({ imported: 1 });
  expect(state.rows).toHaveLength(1);
});
it('refuses an import without an active plan', async () => {
  state.plan = false;
  await expect(importVerifiedLocations(123, [listing('locations/CODEX1')])).rejects.toMatchObject({ status: 402, body: { code: 'plan_required' } });
  expect(state.rows).toHaveLength(0);
});
