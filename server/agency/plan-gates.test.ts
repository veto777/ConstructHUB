/**
 * The price book inside the agency module: Platform team seats and CRM seats have separate pools
 * (Unlimited's platform -1 is uncapped), queued Google syncs run only for owners with an active
 * plan, and bulk Site Scans spend the owner's monthly Site Scans. Real lane Postgres; no Google
 * or provider calls.
 */
import { beforeAll, afterAll, describe, it, expect, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { pool } from '../db';
import { ensureAgencySchema } from './schema';
import { registerAgencyRoutes } from './routes';
import { runAgencyJobs, scheduleSyncs, performJob } from './jobs';
import { gbpSyncPaused } from './access';
import { getOwnerSeatUsage, getSeatUsage } from '../crm/tenancy';
import { saveGrant } from '../gbp/grants';
import { GBP_SCOPE } from '../gbp/client';
import { takeBudget } from '../growth-limits';
import { quotaKey } from '../growth-quotas';
import { PLANS } from '@shared/plans';
import { CRM_PLANS } from '@shared/crm-plans';
vi.mock('../email', () => ({ sendWithFallback: vi.fn(async () => ({ accepted: ['fixture@example.invalid'] })) }));

const created: number[] = [];
const orgs: string[] = [];
const newUser = async (label: string, plan?: string, crm?: { plan: string; extraSeats?: number }) => {
  const id = (await pool.query('INSERT INTO users(email) VALUES($1) RETURNING id', [`i-agency-${label}-${randomUUID()}@example.invalid`])).rows[0].id as number;
  created.push(id);
  if (plan) await pool.query("INSERT INTO subscriptions(user_id,plan,status) VALUES($1,$2,'active')", [id, plan]);
  // The CRM is a separate product: CRM seats come from the account's own CRM subscription.
  if (crm) await pool.query("INSERT INTO crm_subscriptions(user_id,plan,status,extra_seats) VALUES($1,$2,'active',$3)", [id, crm.plan, crm.extraSeats ?? 0]);
  return id;
};
const emailOf = async (id: number) => (await pool.query('SELECT email FROM users WHERE id=$1', [id])).rows[0].email as string;
const handlers = new Map<string, Function>();
async function call(method: string, path: string, actor: number, body: any = {}, params: any = {}) {
  let status = 200, data: any;
  const req: any = { user: { id: actor }, session: {}, headers: {}, body, query: {}, params };
  const res: any = { locals: {}, setHeader() { return res; }, status(n: number) { status = n; return res; }, json(v: any) { data = v; return res; } };
  await handlers.get(`${method} ${path}`)!(req, res);
  return { status, data };
}

beforeAll(async () => {
  const target = new URL(process.env.DATABASE_URL!);
  if (!/^\/constructhub_dev(?:_[a-z0-9]+)?$/.test(target.pathname) || !['localhost', '127.0.0.1'].includes(target.hostname)) throw Error('Local development DB required');
  await ensureAgencySchema();
  const app: any = {};
  for (const m of ['get', 'post', 'put', 'delete']) app[m] = (p: string, ...h: Function[]) => handlers.set(`${m} ${p}`, h.at(-1)!);
  registerAgencyRoutes(app);
});
afterAll(async () => {
  await pool.query('DELETE FROM crm_members WHERE org_id=ANY($1::varchar[])', [orgs]);
  await pool.query('DELETE FROM crm_orgs WHERE id=ANY($1::varchar[])', [orgs]);
  await pool.query('DELETE FROM crm_subscriptions WHERE user_id=ANY($1::int[])', [created]);
  await pool.query('DELETE FROM agency_jobs WHERE user_id=ANY($1::int[])', [created]);
  await pool.query('DELETE FROM sitescan_jobs WHERE user_id=ANY($1::int[])', [created]);
  await pool.query('DELETE FROM growth_budgets WHERE key=ANY($1::text[])', [created.flatMap(u => [quotaKey(u, 'siteScans'), `sitescan:scan:${u}`, `agency-route:${u}`])]);
  await pool.query('DELETE FROM subscriptions WHERE user_id=ANY($1::int[])', [created]);
  await pool.query('DELETE FROM business_locations WHERE user_id=ANY($1::int[])', [created]);
  await pool.query('DELETE FROM users WHERE id=ANY($1::int[])', [created]);
  await pool.end();
});

describe('Platform team seats are separate from CRM seats', () => {
  const poolSize = PLANS.growth.limits.agencySeats;

  it('caps the platform team independently and never races past the cap', async () => {
    const owner = await newUser('seat-owner', 'growth', { plan: 'crm_essentials' });
    // The owner's CRM org already seats the owner and one office user.
    const office = await newUser('seat-office');
    const org = (await pool.query("INSERT INTO crm_orgs(name,owner_user_id) VALUES('I- seat fixture',$1) RETURNING *", [owner])).rows[0];
    orgs.push(org.id);
    await pool.query("INSERT INTO crm_members(org_id,user_id,email,role,status) VALUES($1,$2,$3,'owner','active'),($1,$4,$5,'office','active')", [org.id, owner, await emailOf(owner), office, await emailOf(office)]);
    // An invitation not yet accepted holds a seat too.
    await pool.query("INSERT INTO crm_members(org_id,user_id,email,role,status) VALUES($1,NULL,$2,'field','invited')", [org.id, `i-invited-${randomUUID()}@example.invalid`]);
    expect((await getOwnerSeatUsage(owner, { product: "platform" })).used).toBe(1);

    const add = async (user: number, role = 'viewer') => call('put', '/api/agency/team', owner, { email: await emailOf(user), role });
    const team: number[] = [];
    for (let i = 0; i < poolSize - 2; i++) { const u = await newUser(`seat-${i}`); team.push(u); expect((await add(u)).status).toBe(200); }
    expect((await getOwnerSeatUsage(owner, { product: "platform" })).used).toBe(poolSize - 1);
    // Two additions at once for the last seat: exactly one gets it.
    const [a, b] = [await newUser('race-a'), await newUser('race-b')];
    const race = await Promise.all([add(a), add(b)]);
    expect(race.map(r => r.status).sort()).toEqual([200, 403]);
    const refused = race.find(r => r.status === 403)!.data;
    expect(refused).toMatchObject({ code: 'limit_reached', feature: 'agencySeats', limit: poolSize, used: poolSize, addon: 'extra_seat' });
    expect(refused.message).toContain('team seats');
    const loser = race[0].status === 403 ? a : b;

    // CRM membership does not reserve a platform seat; an existing platform role change takes none.
    expect((await add(office, 'manager')).status).toBe(403);
    expect((await add(team[0], 'admin')).status).toBe(200);
    const pooled = await getSeatUsage({ ...org, ownerUserId: owner });
    expect(pooled).toMatchObject({ used: 3, limit: CRM_PLANS.crm_essentials.limits.seats, canAddSeat: true });
    expect(pooled.message).toContain('CRM seats');
    expect((await getSeatUsage({ ...org, ownerUserId: owner }, { email: await emailOf(office) })).canAdd).toBe(true);
    expect((await getSeatUsage({ ...org, ownerUserId: owner }, { email: await emailOf(loser) })).canAdd).toBe(true);

    // One Extra seat add-on makes room for one more person.
    await pool.query(`UPDATE subscriptions SET addons='{"extra_seat":1}'::jsonb WHERE user_id=$1`, [owner]);
    expect((await add(loser)).status).toBe(200);
    expect(await getOwnerSeatUsage(owner, { product: "platform" })).toMatchObject({ used: poolSize + 1, limit: poolSize + 1 });
    // Removing a member frees their seat.
    expect((await call('delete', '/api/agency/team/:id', owner, {}, { id: String(loser) })).status).toBe(200);
    expect((await getOwnerSeatUsage(owner, { product: "platform" })).used).toBe(poolSize);
    await pool.query('DELETE FROM agency_members WHERE user_id=$1', [owner]);
  });

  it('never caps the pool on Unlimited (agencySeats -1 is unlimited)', async () => {
    const owner = await newUser('seat-unlimited', 'agency', { plan: 'crm_basic' });
    const org = (await pool.query("INSERT INTO crm_orgs(name,owner_user_id) VALUES('I- unlimited seats',$1) RETURNING *", [owner])).rows[0];
    orgs.push(org.id);
    await pool.query("INSERT INTO crm_members(org_id,user_id,email,role,status) VALUES($1,$2,$3,'owner','active')", [org.id, owner, await emailOf(owner)]);
    const usage = await getSeatUsage({ ...org, ownerUserId: owner });
    expect(usage).toMatchObject({ used: 1, limit: 1, remaining: 0, canAddSeat: false });
    expect(await getOwnerSeatUsage(owner, { product: "platform" })).toMatchObject({ limit: -1, canAddSeat: true });
    // Far more additions than any capped plan allows: every one succeeds.
    for (let i = 0; i < 15; i++) {
      const u = await newUser(`unlimited-${i}`);
      expect((await call('put', '/api/agency/team', owner, { email: await emailOf(u), role: 'viewer' })).status).toBe(200);
    }
    expect((await getOwnerSeatUsage(owner, { product: "platform" })).used).toBe(16);
    await pool.query('DELETE FROM agency_members WHERE user_id=$1', [owner]);
    await pool.query('DELETE FROM agency_workspaces WHERE user_id=$1', [owner]);
  });

  it('keeps CRM-only accounts on their CRM seats (no agency team counted without the Agency plan)', async () => {
    const owner = await newUser('crm-only', 'pro', { plan: 'crm_essentials' });
    const org = (await pool.query("INSERT INTO crm_orgs(name,owner_user_id) VALUES('I- crm only',$1) RETURNING *", [owner])).rows[0];
    orgs.push(org.id);
    await pool.query("INSERT INTO crm_members(org_id,user_id,email,role,status) VALUES($1,$2,$3,'owner','active')", [org.id, owner, await emailOf(owner)]);
    // Platform membership never consumes CRM seats.
    const leftover = await newUser('leftover');
    await pool.query("INSERT INTO agency_members(user_id,member_id,role) VALUES($1,$2,'viewer')", [owner, leftover]);
    const usage = await getSeatUsage({ ...org, ownerUserId: owner });
    expect(usage).toMatchObject({ used: 1, limit: CRM_PLANS.crm_essentials.limits.seats, canAddSeat: true });
    expect(usage.message).toBe(`Your CRM Essentials plan includes ${CRM_PLANS.crm_essentials.limits.seats} CRM seats and 1 is in use.`);
    await pool.query('DELETE FROM agency_members WHERE user_id=$1', [owner]);
  });
});

describe('Queued Google syncs need an active plan', () => {
  it('schedules and runs syncs for an owner with a plan, and neither for an owner without one', async () => {
    const paid = await newUser('sync-paid', 'starter'), lapsed = await newUser('sync-lapsed');
    await pool.query("INSERT INTO subscriptions(user_id,plan,status) VALUES($1,'starter','canceled')", [lapsed]);
    for (const [user, sub] of [[paid, `i-sync-${paid}`], [lapsed, `i-sync-${lapsed}`]] as const) {
      await saveGrant(user, { sub, email: `${sub}@example.invalid`, email_verified: true }, { access_token: 'fixture-token', scope: GBP_SCOPE });
      await pool.query("INSERT INTO business_locations(user_id,business_name,gbp_account_name,gbp_location_name,gbp_google_subject) VALUES($1,'I- sync fixture','accounts/i-sync',$2,$3)", [user, `locations/i-sync-${user}`, sub]);
    }
    await scheduleSyncs(paid);
    await scheduleSyncs(lapsed);
    const queued = async (user: number) => (await pool.query("SELECT count(*)::int n FROM agency_jobs WHERE user_id=$1 AND action='sync'", [user])).rows[0].n;
    expect(await queued(paid)).toBe(1);
    expect(await queued(lapsed)).toBe(0);
    // A location attempted within the 6-hour cadence is not enqueued again.
    const paidLoc = (await pool.query('SELECT id FROM business_locations WHERE user_id=$1', [paid])).rows[0].id;
    await pool.query("INSERT INTO gbp_sync_status(location_id,kind,last_attempt) VALUES($1,'profile',now()) ON CONFLICT(location_id,kind) DO UPDATE SET last_attempt=now()", [paidLoc]);
    await pool.query("DELETE FROM agency_jobs WHERE user_id=$1", [paid]);
    await scheduleSyncs(paid);
    expect(await queued(paid)).toBe(0);
    // A sync queued another way (onboarding, a re-link) is not run for the owner without a plan.
    const loc = (await pool.query('SELECT id FROM business_locations WHERE user_id=$1', [lapsed])).rows[0].id;
    const job = randomUUID();
    await pool.query("INSERT INTO agency_jobs(id,user_id,actor_id,location_id,action,batch_id,priority) VALUES($1,$2,$2,$3,'sync',$1,-100)", [job, lapsed, loc]);
    const ran: string[] = [];
    await runAgencyJobs(async (j: any) => { ran.push(j.id); return {}; }, 5, lapsed);
    expect(ran).not.toContain(job);
    expect((await pool.query('SELECT status,error FROM agency_jobs WHERE id=$1', [job])).rows[0]).toEqual({ status: 'failed', error: gbpSyncPaused });
    await runAgencyJobs(async (j: any) => { ran.push(j.id); return {}; }, 5, paid);
    expect(ran).toHaveLength(0); // paid's only job was the due-cadence probe, never queued
  });
});

describe('Bulk Site Scans spend the owner\'s monthly Site Scans', () => {
  it('fails a scan when the month is used up and gives the scan back when the daily budget defers it', async () => {
    const owner = await newUser('scan', 'starter');
    const id = (await pool.query("INSERT INTO business_locations(user_id,business_name,gbp_account_name,gbp_location_name) VALUES($1,'I- scan fixture','accounts/i-scan','locations/i-scan') RETURNING id", [owner])).rows[0].id;
    await pool.query("INSERT INTO gbp_sync_status(location_id,kind,last_success,profile_snapshot) VALUES($1,'profile',now(),'{\"website\":\"https://example.invalid\"}')", [id]);
    const job = () => ({ id: randomUUID(), user_id: owner, actor_id: owner, location_id: id, action: 'scan', payload: {} });
    const used = async () => Number((await pool.query("SELECT used FROM growth_budgets WHERE key=$1 AND period='0'", [quotaKey(owner, 'siteScans')])).rows[0]?.used ?? 0);
    // Daily budget spent: deferred (retried later), and the monthly scan is given back.
    await takeBudget(`sitescan:scan:${owner}`, 5, 5, 86400_000);
    await expect(performJob(job())).rejects.toMatchObject({ kind: 'quota' });
    expect(await used()).toBe(0);
    await pool.query('DELETE FROM growth_budgets WHERE key=$1', [`sitescan:scan:${owner}`]);
    // Solo: 2 Site Scans a month.
    expect((await performJob(job()) as any).id).toBeTruthy();
    expect((await performJob(job()) as any).id).toBeTruthy();
    expect(await used()).toBe(2);
    const refused = performJob(job());
    await expect(refused).rejects.toMatchObject({ kind: 'invalid', status: 403 });
    await expect(refused).rejects.toThrow(/used all 2 Site Scans your Solo plan includes this month/);
    expect((await pool.query('SELECT count(*)::int n FROM sitescan_jobs WHERE user_id=$1', [owner])).rows[0].n).toBe(2);
  });
});
