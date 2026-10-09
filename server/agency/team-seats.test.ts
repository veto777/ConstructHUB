import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PLANS, effectivePlanKey, type PlanKey } from '@shared/plans';
const state = vi.hoisted(() => ({ ent: null as any, crm: null as any, platform: [] as number[], members: [] as string[] }));
vi.mock('../db', () => ({ db: {}, pool: { query: vi.fn(async (sql: string) => {
  if (sql.includes('SELECT member_id FROM agency_members')) return { rows: state.platform.map(member_id => ({ member_id })) };
  if (sql.includes('FROM crm_members')) return { rows: state.members.map(who => ({ who })) };
  if (sql.includes('SELECT id FROM users')) return { rows: [{ id: 2 }] };
  throw Error(`Unexpected SQL: ${sql}`);
}) } }));
vi.mock('../entitlements', async importOriginal => ({ ...await importOriginal<any>(), getEntitlements: vi.fn(async () => state.ent) }));
vi.mock('../crm/entitlements', () => ({ getCrmEntitlements: vi.fn(async () => state.crm), crmPlanRequiredBody: vi.fn() }));
import { allowancesFor } from '../entitlements';
import { getOwnerSeatUsage, getSeatUsage, seatLimitBody } from '../crm/tenancy';
import { teamEntitled, workspaceEntitled } from './access';
function platform(plan: PlanKey, extras = 0) {
  state.ent = { accessPlan: plan, modules: PLANS[plan].modules, allowances: allowancesFor(plan, { extra_seat: extras }) };
}
beforeEach(() => {
  platform('team');
  state.platform = [];
  state.members = ['u:1'];
  state.crm = { active: true, plan: 'crm_basic', seats: 1, via: 'plan' };
});
describe('independent platform team and CRM seats', () => {
  it.each(['starter', 'team', 'pro', 'growth', 'agency'] as const)('uses %s platform seats without a CRM subscription', async plan => {
    platform(plan); state.crm = { active: false, plan: null, seats: 0 };
    const usage = await getOwnerSeatUsage(1, { product: 'platform' });
    expect(usage).toMatchObject({ limit: PLANS[plan].limits.agencySeats, used: 1 });
    expect(await teamEntitled(1)).toBe(plan !== 'starter');
    expect(await workspaceEntitled(1)).toBe(PLANS[plan].modules.agencyWorkspace);
  });
  it.each(['team', 'pro', 'growth'] as const)('extra_seat increases only the %s platform pool', async plan => {
    platform(plan, 2);
    expect((await getOwnerSeatUsage(1, { product: 'platform' })).limit).toBe(PLANS[plan].limits.agencySeats + 2);
    expect(await getSeatUsage({ ownerUserId: 1 } as any)).toMatchObject({ limit: 1, canAddSeat: false, addon: null });
  });
  it.each(['growth', 'agency'] as const)('%s never enlarges CRM Basic or consumes CRM seats', async plan => {
    platform(plan); state.platform = [2, 3, 4];
    expect(await getOwnerSeatUsage(1)).toMatchObject({ limit: 1, used: 1, canAdd: false });
    state.crm.seats = 3;
    expect(await getOwnerSeatUsage(1)).toMatchObject({ limit: 3, used: 1, canAdd: true });
  });
  it('counts people in both products separately, and deduplicates CRM invitations within the CRM', async () => {
    state.platform = [2, 3]; state.members = ['u:1', 'u:2', 'u:2', 'e:pending@example.invalid'];
    const team = await getOwnerSeatUsage(1, { product: 'platform', adding: { userId: 4 } });
    expect(team).toMatchObject({ used: 3, limit: 3, canAdd: false, addon: 'extra_seat' });
    expect(seatLimitBody(team).feature).toBe('agencySeats');
    expect((await getOwnerSeatUsage(1, { product: 'platform', adding: { email: 'existing@example.invalid' } })).canAdd).toBe(true);
    expect(await getOwnerSeatUsage(1, { adding: { userId: 3 } })).toMatchObject({ used: 3, canAdd: false });
    expect((await getOwnerSeatUsage(1, { adding: { userId: 2 } })).canAdd).toBe(true);
  });
  it('retains unlimited CRM beta seats without granting unlimited platform seats', async () => {
    state.crm = { active: true, plan: 'crm_max', seats: -1, via: 'beta' };
    expect(await getOwnerSeatUsage(1)).toMatchObject({ plan: 'beta', limit: -1, canAdd: true });
    expect((await getOwnerSeatUsage(1, { product: 'platform' })).limit).toBe(3);
  });
  it.each(['pro', 'growth', 'agency', 'gold', 'platinum'])('accepts effective allowances for legacy stored key %s', async stored => {
    const plan = effectivePlanKey({ plan: stored, status: "active" })!; platform(plan);
    state.ent.storedPlan = stored;
    expect((await getOwnerSeatUsage(1, { product: 'platform' })).limit).toBe(state.ent.allowances.agencySeats);
  });
});
