import { beforeEach, expect, it, vi } from 'vitest';
import { PLANS, type PlanKey } from '@shared/plans';
const state = vi.hoisted(() => ({ plan: 'team' as PlanKey, members: [] as number[], extras: 0 }));
const query = vi.hoisted(() => vi.fn(async (sql: string, args?: any[]) => {
  if (sql.includes('SELECT member_id FROM agency_members')) return { rows: state.members.map(member_id => ({ member_id })) };
  if (sql.includes('SELECT role,all_clients')) return { rows: [{ role: 'admin', all_clients: true }] };
  if (sql.includes('SELECT id FROM users')) return { rows: [{ id: 2 }] };
  if (sql.includes('count(*)::int n FROM agency_clients')) return { rows: [{ n: 0 }] };
  if (sql.includes('INSERT INTO agency_members')) state.members.push(args![1]);
  return { rows: [] };
}));
vi.mock('../db', () => ({ db: {}, pool: { query, connect: async () => ({ query, release: vi.fn() }) } }));
vi.mock('../entitlements', async original => {
  const actual = await original<any>();
  return { ...actual, getEntitlements: async () => ({ accessPlan: state.plan, modules: PLANS[state.plan].modules, allowances: actual.allowancesFor(state.plan, { extra_seat: state.extras }) }) };
});
vi.mock('../growth-limits', () => ({ takeBudget: async () => true, rateLimit: vi.fn() }));
vi.mock('../account-events', () => ({ logActivity: vi.fn() }));
vi.mock('../email', () => ({ sendWithFallback: vi.fn() }));
import { registerAgencyRoutes, requestAccess } from './routes';
const handlers = new Map<string, Function>();
const app: any = {};
for (const method of ['get', 'put', 'post', 'delete']) app[method] = (path: string, fn: Function) => handlers.set(`${method} ${path}`, fn);
registerAgencyRoutes(app);
async function call(method: string, path: string, body: any = {}) {
  let status = 200, data: any;
  const res: any = { setHeader() {}, status(n: number) { status = n; return this; }, json(v: any) { data = v; return this; } };
  await handlers.get(`${method} /api/agency${path}`)!({ user: { id: 1 }, session: {}, query: {}, body, params: { id: '2' } }, res);
  return { status, data };
}
beforeEach(() => { state.plan = 'team'; state.members = []; state.extras = 0; query.mockClear(); });
it.each(['team', 'pro'] as const)('%s can manage members while client workspaces stay gated', async plan => {
  state.plan = plan;
  expect((await call('get', '/team')).status).toBe(200);
  expect((await call('get', '/clients')).status).toBe(402);
  expect((await call('put', '/team', { email: 'member@example.invalid', role: 'viewer' })).status).toBe(200);
  expect(query.mock.calls.find(([sql]) => sql.includes('INSERT INTO agency_members'))?.[1]?.[3]).toBe(true);
  expect((await call('delete', '/team/:id')).status).toBe(200);
});
it('Solo cannot add members, and Team at capacity can buy an extra platform seat', async () => {
  state.plan = 'starter';
  expect((await call('put', '/team', { email: 'member@example.invalid', role: 'viewer' })).status).toBe(402);
  state.plan = 'team'; state.members = [3, 4];
  expect(await call('put', '/team', { email: 'member@example.invalid', role: 'viewer' })).toMatchObject({ status: 403, data: { feature: 'agencySeats', limit: 3 } });
  state.extras = 1;
  expect((await call('put', '/team', { email: 'member@example.invalid', role: 'viewer' })).status).toBe(200);
});
it('Team delegation survives session resolution but cannot assign client workspaces', async () => {
  expect(await requestAccess({ user: { id: 2 }, session: { agencyOwner: 1 } } as any)).toMatchObject({ owner: 1, actor: 2 });
  expect((await call('put', '/team', { email: 'member@example.invalid', role: 'viewer', clientIds: [7] })).status).toBe(402);
  expect(query.mock.calls.some(([sql]) => sql.includes('INSERT INTO agency_members'))).toBe(false);
});
