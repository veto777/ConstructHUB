// Security audit w3-r1 (agency): contact-email changes need an admin, single-line onboarding fields, a per-member
// daily send budget that also counts worker reminders, /team scoped to the requester's visibility, no capability
// link for viewers, a strict social-destinations body and a daily cap on PUT /team misses.
import { beforeAll, afterAll, describe, it, expect, vi } from 'vitest';
import { pool } from '../db';
import { ensureAgencySchema } from './schema';
import { onboardingInput, memberSendAllowed, MEMBER_DAILY_SENDS, runOnboardingWorker, hash } from './onboarding';
import { registerAgencyRoutes, TEAM_DAILY_MISSES } from './routes';
import { encryptToken } from '../gbp/token-crypto';
import { takeBudget } from '../growth-limits';
import { planForModule } from '@shared/plans';
vi.mock('../email', () => ({ sendWithFallback: vi.fn(async () => ({})) }));
let owner: number, manager: number, admin: number, viewer: number, outsider: number, visible: number, secret: number;
const handlers = new Map<string, Function>();
const call = async (method: string, path: string, actor: number, body: any = {}, query: any = {}, params: any = {}) => {
  let status = 200, data: any;
  const req: any = { user: { id: actor }, session: { agencyOwner: owner }, headers: {}, body, query, params };
  const res: any = { locals: {}, setHeader() { return res; }, status(n: number) { status = n; return res; }, json(v: any) { data = v; return res; } };
  await handlers.get(`${method} /api/agency${path}`)!(req, res); return { status, data };
};
const onboardingRow = async (actor: number | null, name: string, sentDaysAgo: number | null) => {
  const id = crypto.randomUUID(), token = crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '');
  await pool.query(`INSERT INTO agency_onboarding(id,user_id,client_id,subject,agency_email,contact_email,business_name,place_id,token_hash,token_enc,actor_id,sent_at,reminder_at)
    VALUES($1,$2,$3,'agency-sub','agency@example.invalid','client@example.invalid',$4,'place',$5,$6,$7,$8,$8)`,
    [id, owner, visible, name, hash(token), encryptToken(token), actor, sentDaysAgo === null ? null : new Date(Date.now() - sentDaysAgo * 86400000)]);
  return id;
};
beforeAll(async () => {
  const target = new URL(process.env.DATABASE_URL!); if (!/^\/constructhub_dev(?:_[a-z0-9]+)?$/.test(target.pathname) || !['localhost', '127.0.0.1'].includes(target.hostname)) throw Error('Local dev DB required');
  await ensureAgencySchema();
  const ids: number[] = [];
  for (const key of ['owner', 'manager', 'admin', 'viewer', 'outsider']) ids.push((await pool.query('INSERT INTO users(email) VALUES($1) RETURNING id', [`sec-${key}-${crypto.randomUUID()}@example.invalid`])).rows[0].id);
  [owner, manager, admin, viewer, outsider] = ids;
  await pool.query("INSERT INTO subscriptions(user_id,plan,status) VALUES($1,$2,'active')", [owner, planForModule('agencyWorkspace')]);
  await pool.query('INSERT INTO agency_workspaces(user_id,name) VALUES($1,$2)', [owner, 'Security fixture']);
  visible = (await pool.query("INSERT INTO agency_clients(user_id,name,contact_email) VALUES($1,'Visible Co','client@example.invalid') RETURNING id", [owner])).rows[0].id;
  secret = (await pool.query("INSERT INTO agency_clients(user_id,name) VALUES($1,'Secret Co') RETURNING id", [owner])).rows[0].id;
  for (const [m, role, c] of [[manager, 'manager', visible], [admin, 'admin', visible], [viewer, 'viewer', visible], [outsider, 'manager', secret]] as const) {
    await pool.query('INSERT INTO agency_members(user_id,member_id,role,all_clients) VALUES($1,$2,$3,false)', [owner, m, role]);
    await pool.query('INSERT INTO agency_member_clients VALUES($1,$2,$3)', [owner, m, c]);
  }
  const app: any = {}; for (const m of ['get', 'post', 'put', 'delete']) app[m] = (p: string, ...h: Function[]) => handlers.set(`${m} ${p}`, h.at(-1)!);
  registerAgencyRoutes(app);
});
afterAll(async () => {
  const all = [owner, manager, admin, viewer, outsider];
  await pool.query("DELETE FROM growth_budgets WHERE key LIKE ANY($1::text[])", [[`agency-invite:${owner}%`, `agency-team-miss:${owner}`, ...all.map(id => `agency-route:${id}`)]]);
  await pool.query('DELETE FROM agency_onboarding WHERE user_id=$1', [owner]);
  await pool.query('DELETE FROM subscriptions WHERE user_id=ANY($1::int[])', [all]);
  await pool.query('DELETE FROM users WHERE id=ANY($1::int[])', [all]);
  await pool.end();
});
describe('agency security (audit w3-r1)', () => {
  it('lets only the owner or an admin change a client contact email; a manager keeps the other fields', async () => {
    const base = { name: 'Visible Co', contactEmail: 'client@example.invalid', notes: '', tags: [], folder: null };
    expect((await call('put', '/clients/:id', manager, { ...base, contactEmail: 'victim@example.invalid' }, {}, { id: String(visible) })).status).toBe(403);
    expect((await call('put', '/clients/:id', manager, { ...base, contactEmail: null }, {}, { id: String(visible) })).status).toBe(403);
    expect((await call('put', '/clients/:id', manager, { ...base, notes: 'manager note' }, {}, { id: String(visible) })).status).toBe(200);
    expect((await pool.query('SELECT contact_email,notes FROM agency_clients WHERE id=$1', [visible])).rows[0]).toEqual({ contact_email: 'client@example.invalid', notes: 'manager note' });
    expect((await call('put', '/clients/:id', admin, { ...base, contactEmail: 'new@example.invalid' }, {}, { id: String(visible) })).status).toBe(200);
    expect((await call('put', '/clients/:id', owner, base, {}, { id: String(visible) })).status).toBe(200);
    expect((await pool.query('SELECT contact_email FROM agency_clients WHERE id=$1', [visible])).rows[0].contact_email).toBe('client@example.invalid');
  });
  it('keeps the business name and address on one line (they go into the email subject and body)', async () => {
    const ok = { clientId: 1, subject: 's', businessName: 'Acme Roofing', address: '1 Main St' };
    expect(onboardingInput.safeParse(ok).success).toBe(true);
    for (const bad of [{ businessName: 'Acme\n\nYour invoice is overdue' }, { businessName: 'Acme\r\nPay' }, { address: '1 Main\tSt' }, { address: 'x\u0000' }, { placeId: 'p\nq' }])
      expect(onboardingInput.safeParse({ ...ok, ...bad }).success).toBe(false);
    const r = await call('post', '/onboarding', manager, { clientId: visible, subject: 'agency-sub', businessName: 'Acme\nPay now', address: '1 Main St' });
    expect(r.status).toBe(400); expect(r.data.message).toMatch(/one line/);
  });
  it('charges each member a daily send budget; the owner keeps the workspace budget alone', async () => {
    for (let i = 0; i < MEMBER_DAILY_SENDS; i++) expect(await memberSendAllowed(owner, manager)).toBe(true);
    expect(await memberSendAllowed(owner, manager)).toBe(false);
    expect(await memberSendAllowed(owner, admin)).toBe(true);
    for (let i = 0; i < MEMBER_DAILY_SENDS + 5; i++) expect(await memberSendAllowed(owner, owner)).toBe(true);
    expect(await memberSendAllowed(owner, null)).toBe(true);
  });
  it('counts worker reminders against the member who made the request', async () => {
    const held = await onboardingRow(manager, 'Over budget reminder', 4); // manager's budget is spent above
    const sent = await onboardingRow(owner, 'Owner reminder', 4);
    const send = vi.fn(async () => ({}));
    await runOnboardingWorker((() => { throw Error('no Google calls expected'); }) as any, send as any, owner);
    expect(send.mock.calls.map((c: any) => c[0].subject)).toEqual(['ConstructHUB: Google Business Profile access for Owner reminder']);
    const rows = (await pool.query('SELECT id,reminders,reminder_at>now()-interval \'1 minute\' fresh FROM agency_onboarding WHERE id=ANY($1::uuid[])', [[held, sent]])).rows;
    expect(rows.find(r => r.id === held)).toMatchObject({ reminders: 0, fresh: true }); // waits for the next window
    expect(rows.find(r => r.id === sent)).toMatchObject({ reminders: 1 });
  });
  it('shows a scoped admin only the clients they can see on /team, and matches q literally', async () => {
    const scoped = await call('get', '/team', admin);
    expect(scoped.status).toBe(200);
    expect(scoped.data.items.flatMap((m: any) => m.client_names)).not.toContain('Secret Co');
    expect(scoped.data.items.flatMap((m: any) => m.client_ids)).not.toContain(secret);
    expect(scoped.data.items.find((m: any) => m.member_id === outsider)).toMatchObject({ client_ids: [], client_names: [] });
    const full = await call('get', '/team', owner);
    expect(full.data.items.find((m: any) => m.member_id === outsider)).toMatchObject({ client_ids: [secret], client_names: ['Secret Co'] });
    expect((await call('get', '/team', owner, {}, { q: '%' })).data.items).toEqual([]);
    expect((await call('get', '/team', owner, {}, { q: '_' })).data.items).toEqual([]);
  });
  it('gives the onboarding link only to roles that can send, and never the token, subject or invitation', async () => {
    await onboardingRow(manager, 'Link fixture', null);
    const forViewer = await call('get', '/onboarding', viewer, {}, { q: 'Link fixture' });
    const forManager = await call('get', '/onboarding', manager, {}, { q: 'Link fixture' });
    expect(forViewer.status).toBe(200); expect(forViewer.data.items).toHaveLength(1);
    expect(forViewer.data.items[0]).toMatchObject({ business_name: 'Link fixture', link: null, agency_email: null });
    expect(forManager.data.items[0].link).toContain('/api/agency-onboarding/');
    for (const item of [forViewer.data.items[0], forManager.data.items[0]])
      for (const key of ['token_hash', 'token_enc', 'subject', 'invitation', 'actor_id', 'user_id', 'total']) expect(item).not.toHaveProperty(key);
    expect((await call('get', '/onboarding', owner, {}, { q: '%' })).data.items).toEqual([]);
  });
  it('answers 400 for a missing or loose social-destinations body', async () => {
    for (const body of [undefined, {}, { destinations: [], extra: 1 }, { destinations: 'x' }])
      expect((await call('put', '/clients/:id/social-destinations', owner, body, {}, { id: String(visible) })).status).toBe(400);
  });
  it('caps PUT /team misses per workspace per day', async () => {
    const unknown = { email: `nobody-${crypto.randomUUID()}@example.invalid`, role: 'viewer' };
    expect((await call('put', '/team', owner, unknown)).status).toBe(400);
    expect(await takeBudget(`agency-team-miss:${owner}`, TEAM_DAILY_MISSES, TEAM_DAILY_MISSES - 1, 86400000)).toBe(true);
    const r = await call('put', '/team', owner, unknown);
    expect(r.status).toBe(429); expect(r.data.message).toMatch(/unrecognised/);
  });
});
