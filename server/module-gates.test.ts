/**
 * The four Agency-only modules answer 402 plan_required (server/entitlements.ts) unless the plan includes
 * them; platform admins keep access; a non-Agency owner's everyday pages keep working through the agency
 * middleware; and the modules' background workers skip owners whose plan no longer includes them.
 */
import { beforeAll, afterAll, describe, it, expect, vi } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';
import { pool } from './db';
import { ensureGrowthSchema } from './growth-schema';
import { ensureAccountEventsSchema } from './account-events';
import { ensureAgencySchema } from './agency/schema';
import { ensureAdsSchema } from './ads/schema';
import { ensureCloudflareSearchSchema } from './cloudflare/schema';
import { ensureDomainsSchema } from './domains/schema';
import { ensureMailAlertsSchema } from './mail-alerts/schema';
import { registerAgencyAccess } from './agency/middleware';
import { registerAgencyRoutes } from './agency/routes';
import { runAgencyJobs } from './agency/jobs';
import { runOnboardingWorker, hash } from './agency/onboarding';
import { agencyPlanPaused } from './agency/access';
import { registerAdsRoutes } from './ads/routes';
import { runAdsWorker, scheduleLinkPolls, ADS_PLAN_PAUSED } from './ads/worker';
import { registerCloudflareRoutes } from './cloudflare/routes';
import { registerGscRoutes } from './gsc/routes';
import { runEdgeJob, EDGE_PLAN_PAUSED } from './cloudflare/worker';
import { registerDomainRoutes } from './domains/routes';
import { runDomainWorker, scheduleMonitors, DOMAINS_PLAN_PAUSED, DOMAINS_VERIFY_PAUSED } from './domains/service';
import { registerMailAlertRoutes } from './mail-alerts/routes';
import { registerGmailOAuth, runMailWorker } from './mail-alerts/gmail';
import { registerInboundMail } from './mail-alerts/inbound';
import { ingest, hash as mailHash } from './mail-alerts/service';
import { encryptToken } from './gbp/token-crypto';
import { MODULE_NAMES, PLANS, planForModule, type ModuleKey } from '@shared/plans';
// Fixture platform admins are recognised by email prefix, so no real admin address is written to the DB.
vi.mock('./admin', async (original) => ({ ...(await original<typeof import('./admin')>()), isPlatformAdminEmail: (email?: string | null) => !!email && email.startsWith('p3-admin-') }));
vi.mock('./email', () => ({ sendWithFallback: vi.fn(async () => ({ accepted: ['fixture@example.invalid'] })) }));

const users: Record<'pro' | 'agency' | 'admin' | 'legacy' | 'canceled' | 'member' | 'lapsed' | 'lapsedMember', number> = {} as any;
let base = '', server: ReturnType<express.Express['listen']>, agencyLoc: number, proLocs: number[] = [];
const sessions = new Map<number, any>();
// A private address per run keeps the per-IP request budgets of these routes away from other suites.
const ip = `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
async function call(user: number | null, path: string, method = 'GET', body?: unknown) {
  const r = await fetch(base + path, { method, redirect: 'manual', headers: { 'x-forwarded-for': ip, ...(user ? { 'x-fixture-user': String(user) } : {}), ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  let data: any = text; try { data = JSON.parse(text); } catch { /* not JSON */ }
  return { status: r.status, data };
}

beforeAll(async () => {
  const target = new URL(process.env.DATABASE_URL!);
  if (!/^\/constructhub_dev(?:_[a-z0-9]+)?$/.test(target.pathname) || !['localhost', '127.0.0.1'].includes(target.hostname)) throw Error('Local development DB required');
  await ensureGrowthSchema(); await ensureAccountEventsSchema(); await ensureAgencySchema(); await ensureAdsSchema();
  await ensureCloudflareSearchSchema(); await ensureDomainsSchema(); await ensureMailAlertsSchema();
  for (const key of Object.keys({ pro: 0, agency: 0, admin: 0, legacy: 0, canceled: 0, member: 0, lapsed: 0, lapsedMember: 0 }) as (keyof typeof users)[])
    users[key] = (await pool.query('INSERT INTO users(email) VALUES($1) RETURNING id', [`${key === 'admin' ? 'p3-admin' : `p3-gate-${key}`}-${randomUUID()}@example.invalid`])).rows[0].id;
  const agencyPlan = planForModule('agencyWorkspace');
  for (const [user, plan, status] of [[users.pro, PLANS.pro.key, 'active'], [users.agency, agencyPlan, 'active'], [users.legacy, 'platinum', 'active'], [users.canceled, agencyPlan, 'canceled'], [users.lapsed, PLANS.pro.key, 'active']] as const)
    await pool.query('INSERT INTO subscriptions(user_id,plan,status) VALUES($1,$2,$3)', [user, plan, status]);
  // An Agency workspace with a member (no plan of their own), and a workspace whose owner dropped to Pro.
  await pool.query("INSERT INTO agency_workspaces(user_id,name) VALUES($1,'P- gate agency'),($2,'P- lapsed agency')", [users.agency, users.lapsed]);
  await pool.query("INSERT INTO agency_members(user_id,member_id,role,all_clients) VALUES($1,$2,'manager',true),($3,$4,'manager',true)", [users.agency, users.member, users.lapsed, users.lapsedMember]);
  agencyLoc = (await pool.query("INSERT INTO business_locations(user_id,business_name) VALUES($1,'P- agency client location') RETURNING id", [users.agency])).rows[0].id;
  await pool.query("INSERT INTO business_locations(user_id,business_name) VALUES($1,'P- lapsed agency location')", [users.lapsed]);
  proLocs = (await pool.query("INSERT INTO business_locations(user_id,business_name) VALUES($1,'P- pro location one'),($1,'P- pro location two') RETURNING id", [users.pro])).rows.map(r => r.id);

  const app = express();
  app.set('trust proxy', true);
  registerInboundMail(app);
  app.use(express.json());
  // Stands in for the session: req.user from the fixture header, one persistent session object per user.
  app.use((req: any, _res, next) => {
    const id = Number(req.headers['x-fixture-user']);
    if (id) { req.user = { id }; if (!sessions.has(id)) sessions.set(id, {}); req.session = sessions.get(id); } else req.session = {};
    next();
  });
  const auth = (req: any, res: any) => req.user ? (res.locals.agencyOwner ? { ...req.user, id: res.locals.agencyOwner } : req.user) : (res.status(401).json({ message: 'Not authenticated' }), null);
  registerAgencyAccess(app);
  registerAgencyRoutes(app);
  // The owner's everyday routes behind the agency middleware answer with the account they act for.
  app.get('/api/locations/:id', (req: any, res) => res.json({ actingFor: res.locals.agencyOwner ?? req.user.id }));
  app.get('/api/social', (req: any, res) => res.json({ actingFor: res.locals.agencyOwner ?? req.user.id }));
  registerAdsRoutes(app, auth);
  registerCloudflareRoutes(app, auth);
  registerGscRoutes(app, auth);
  registerDomainRoutes(app, auth);
  registerMailAlertRoutes(app, auth);
  registerGmailOAuth(app, auth);
  await new Promise<void>(resolve => { server = app.listen(0, '127.0.0.1', () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  await new Promise(resolve => server?.close(resolve));
  const ids = Object.values(users);
  await pool.query('DELETE FROM subscriptions WHERE user_id=ANY($1::int[])', [ids]);
  await pool.query('DELETE FROM agency_jobs WHERE user_id=ANY($1::int[])', [ids]);
  await pool.query('DELETE FROM business_locations WHERE user_id=ANY($1::int[])', [ids]);
  await pool.query('DELETE FROM users WHERE id=ANY($1::int[])', [ids]);
  await pool.end();
});

const MODULE_ROUTES: Record<ModuleKey, string[]> = {
  agencyWorkspace: ['/api/agency/locations', '/api/agency/clients', '/api/agency/dashboard', '/api/agency/jobs'],
  adsManager: ['/api/ads/status', '/api/ads/accounts'],
  cloudflareSearchConsole: ['/api/cloudflare/connections?limit=1', '/api/cloudflare/assets', '/api/gsc/connections?limit=1', '/api/gsc/assets'],
  domainsMailAlerts: ['/api/domains/guides', '/api/domains', '/api/mail-alerts/settings', '/api/mail-alerts'],
};

describe('Agency-only module routes', () => {
  for (const [module, paths] of Object.entries(MODULE_ROUTES) as [ModuleKey, string[]][]) {
    it(`${MODULE_NAMES[module]}: 402 plan_required for Pro, 200 for Agency, a legacy Platinum row and a platform admin`, async () => {
      for (const path of paths) {
        const pro = await call(users.pro, path);
        expect(pro.status, path).toBe(402);
        expect(pro.data, path).toEqual({ code: 'plan_required', requiredPlan: planForModule(module), message: expect.stringContaining(MODULE_NAMES[module]) });
        for (const user of [users.canceled]) expect((await call(user, path)).status, `${path} canceled`).toBe(402);
        for (const user of [users.agency, users.legacy, users.admin]) expect((await call(user, path)).status, `${path} as ${user}`).toBe(200);
        expect((await call(null, path)).status, `${path} signed out`).toBe(401);
      }
    });
  }
  it('also gates writes and the Gmail OAuth routes, but never the secret-authenticated inbound mail webhook', async () => {
    expect((await call(users.pro, '/api/agency/clients', 'POST', { name: 'P- blocked client' })).status).toBe(402);
    expect((await call(users.pro, '/api/domains/connections', 'POST', {})).status).toBe(402);
    expect((await call(users.pro, '/api/ads/sync', 'POST', {})).status).toBe(402);
    expect((await call(users.pro, '/api/mail-alerts/oauth/connect')).status).toBe(402);
    // Entitled: the route itself answers (Gmail OAuth is not configured in tests).
    expect((await call(users.agency, '/api/mail-alerts/oauth/connect')).status).toBe(404);
    const previous = process.env.INBOUND_MAIL_SECRET;
    process.env.INBOUND_MAIL_SECRET = 'p3-inbound-secret';
    try {
      const inbound = (secret: string) => fetch(base + '/api/inbound-mail', { method: 'POST', headers: { 'x-forwarded-for': ip, 'x-inbound-mail-secret': secret, 'content-type': 'application/json' }, body: JSON.stringify({ from: 'x@example.invalid', to: 'nobody@example.invalid', subject: 'Fixture', text: 'Fixture' }) });
      expect((await inbound('wrong')).status).toBe(401);
      expect((await inbound('p3-inbound-secret')).status).toBe(202);
    } finally { if (previous === undefined) delete process.env.INBOUND_MAIL_SECRET; else process.env.INBOUND_MAIL_SECRET = previous; }
  });
});

describe('Saved credentials stay removable without the plan', () => {
  it('lets an account without the module list and disconnect what it connected earlier, behind re-auth, and nothing more', async () => {
    const user = users.pro;
    await pool.query("INSERT INTO ads_grants(user_id,manager_id,refresh_token,verified) VALUES($1,'1112223334',$2,true)", [user, encryptToken('fixture-refresh')]);
    // A pasted Cloudflare token (not one ConstructHUB created), so disconnecting makes no provider call.
    const [cf, gsc] = (await pool.query("INSERT INTO edge_connections(user_id,provider,subject,email,token,method) VALUES($1,'cloudflare','p3-saved-cf','cf@example.invalid',$2,'paste'),($1,'gsc','p3-saved-gsc','gsc@example.invalid',$2,'oauth') RETURNING id", [user, encryptToken('fixture-token')])).rows.map(r => r.id);
    await pool.query("INSERT INTO mail_alert_grants(user_id,google_subject,email,access_token,refresh_token,expires_at) VALUES($1,'p3-saved-gmail','gmail@example.invalid',$2,$3,now()+interval '1 hour')", [user, encryptToken('fixture-access'), encryptToken('fixture-refresh')]);
    expect((await call(user, '/api/ads/saved-connection')).data).toEqual({ saved: true, managerId: '1112223334' });
    expect((await call(user, '/api/cloudflare/saved-connections')).data).toEqual({ items: [{ id: cf, label: 'cf@example.invalid' }] });
    expect((await call(user, '/api/gsc/saved-connections')).data).toEqual({ items: [{ id: gsc, label: 'gsc@example.invalid' }] });
    expect((await call(user, '/api/mail-alerts/oauth/saved-connections')).data).toEqual({ items: [{ subject: 'p3-saved-gmail', email: 'gmail@example.invalid' }] });
    // The module itself stays closed, and a signed-out caller gets nothing.
    for (const path of ['/api/ads/status', '/api/cloudflare/connections?limit=1', '/api/gsc/assets', '/api/mail-alerts/settings'])
      expect((await call(user, path)).status, path).toBe(402);
    for (const path of ['/api/ads/saved-connection', '/api/cloudflare/saved-connections', '/api/mail-alerts/oauth/saved-connections'])
      expect((await call(null, path)).status, path).toBe(401);
    // Disconnecting still needs a recent sign-in.
    expect((await call(user, '/api/ads/disconnect', 'POST', { confirm: true })).data).toMatchObject({ reauth: true });
    sessions.get(user).recentAuth = { userId: user, at: Date.now() };
    expect((await call(user, '/api/ads/disconnect', 'POST', { confirm: true })).status).toBe(200);
    expect((await call(user, '/api/cloudflare/disconnect', 'POST', { ids: [cf] })).status).toBe(200);
    expect((await call(user, '/api/gsc/disconnect', 'POST', { ids: [gsc] })).status).toBe(200);
    expect((await call(user, '/api/mail-alerts/oauth/disconnect', 'POST', { subject: 'p3-saved-gmail' })).status).toBe(200);
    const left = (await pool.query('SELECT (SELECT count(*) FROM ads_grants WHERE user_id=$1)+(SELECT count(*) FROM edge_connections WHERE user_id=$1)+(SELECT count(*) FROM mail_alert_grants WHERE user_id=$1) n', [user])).rows[0].n;
    expect(Number(left)).toBe(0);
    expect((await call(user, '/api/ads/saved-connection')).data).toEqual({ saved: false, managerId: null });
    delete sessions.get(user).recentAuth;
    await pool.query('DELETE FROM growth_budgets WHERE key=ANY($1)', [[`edge:disconnect:${user}`]]);
  });
});

describe('Agency workspace for owners and members', () => {
  it('keeps a non-Agency owner\'s own locations, location pages and social workbench working through the agency middleware', async () => {
    const list = await call(users.pro, '/api/locations?paged=true');
    expect(list.status).toBe(200);
    expect(list.data.items.map((l: any) => l.id).sort()).toEqual([...proLocs].sort());
    expect((await call(users.pro, '/api/locations')).data).toHaveLength(2);
    expect((await call(users.pro, `/api/locations/${proLocs[0]}`)).data).toEqual({ actingFor: users.pro });
    expect((await call(users.pro, `/api/social?businessId=${proLocs[0]}`)).data).toEqual({ actingFor: users.pro });
    const sitescan = await call(users.pro, '/api/sitescan');
    expect(sitescan.status).toBe(200);
    expect(sitescan.data.locations).toEqual([]);
    // /me answers so pages can pick the personal view; it names the plan that adds the workspace.
    const me = await call(users.pro, '/api/agency/me');
    expect(me.status).toBe(200);
    expect(me.data).toMatchObject({ owner: users.pro, actor: users.pro, entitled: false, requiredPlan: planForModule('agencyWorkspace'), workspaces: [] });
  });
  it('lets a member with no plan of their own open and use an Agency owner\'s workspace', async () => {
    const me = await call(users.member, '/api/agency/me');
    expect(me.data.entitled).toBe(false);
    expect(me.data.workspaces.map((w: any) => w.user_id)).toEqual([users.agency]);
    expect((await call(users.member, '/api/agency/locations')).status).toBe(402);
    expect((await call(users.member, '/api/agency/workspace', 'POST', { owner: users.agency })).status).toBe(200);
    expect((await call(users.member, '/api/agency/me')).data).toMatchObject({ owner: users.agency, entitled: true });
    const locations = await call(users.member, '/api/agency/locations');
    expect(locations.status).toBe(200);
    expect(locations.data.items.map((l: any) => l.id)).toEqual([agencyLoc]);
    expect((await call(users.member, `/api/locations/${agencyLoc}`)).data).toEqual({ actingFor: users.agency });
    // Back to their own account at any time.
    expect((await call(users.member, '/api/agency/workspace', 'POST', { owner: users.member })).status).toBe(200);
    expect((await call(users.member, '/api/agency/me')).data.owner).toBe(users.member);
  });
  it('ends a member\'s delegation when the owner\'s plan no longer includes the workspace, without locking them out', async () => {
    sessions.set(users.lapsedMember, { agencyOwner: users.lapsed });
    const list = await call(users.lapsedMember, '/api/locations?paged=true');
    expect(list.status).toBe(200);
    expect(list.data.total).toBe(0); // their own account, not the lapsed workspace
    expect(sessions.get(users.lapsedMember).agencyOwner).toBeUndefined();
    const me = await call(users.lapsedMember, '/api/agency/me');
    expect(me.data).toMatchObject({ owner: users.lapsedMember, entitled: false, workspaces: [] });
    const reopen = await call(users.lapsedMember, '/api/agency/workspace', 'POST', { owner: users.lapsed });
    expect(reopen.status).toBe(402);
    expect(reopen.data.code).toBe('plan_required');
    // The lapsed owner keeps their own locations but not the workspace.
    expect((await call(users.lapsed, '/api/agency/clients')).status).toBe(402);
    expect((await call(users.lapsed, '/api/locations?paged=true')).data.total).toBe(1);
  });
});

describe('Background workers skip owners whose plan no longer includes the module', () => {
  it('agency: fails queued bulk actions for a lapsed owner without running them, while plain syncs still run', async () => {
    const [loc] = (await pool.query('SELECT id FROM business_locations WHERE user_id=$1', [users.lapsed])).rows.map(r => r.id);
    const bulk = randomUUID(), sync = randomUUID();
    await pool.query("INSERT INTO agency_jobs(id,user_id,actor_id,location_id,action,payload,batch_id,priority) VALUES($1,$3,$3,$4,'assign','{\"clientId\":1}',gen_random_uuid(),-100),($2,$3,$3,$4,'sync','{}',$2,-100)", [bulk, sync, users.lapsed, loc]);
    const ran: string[] = [];
    await runAgencyJobs(async (j: any) => { ran.push(j.id); return {}; }, 10, users.lapsed);
    const rows = Object.fromEntries((await pool.query('SELECT id,status,error FROM agency_jobs WHERE id=ANY($1::uuid[])', [[bulk, sync]])).rows.map(r => [r.id, r]));
    expect(rows[bulk]).toMatchObject({ status: 'failed', error: agencyPlanPaused });
    expect(ran).not.toContain(bulk);
    expect(rows[sync].status).toBe('done');
    expect(ran).toContain(sync);
  });
  it('agency: does not email onboarding instructions for a lapsed owner', async () => {
    const client = (await pool.query("INSERT INTO agency_clients(user_id,name,contact_email) VALUES($1,'P- lapsed client','client@example.invalid') RETURNING id", [users.lapsed])).rows[0].id;
    const token = randomUUID().replace(/-/g, '').padEnd(64, '0'), id = randomUUID();
    await pool.query("INSERT INTO agency_onboarding(id,user_id,client_id,subject,agency_email,contact_email,business_name,token_hash,token_enc) VALUES($1,$2,$3,'agency','agency@example.invalid','client@example.invalid','P- onboarding',$4,$5)", [id, users.lapsed, client, hash(token), encryptToken(token)]);
    const send = vi.fn(async () => ({}));
    await runOnboardingWorker((() => { throw Error('No Google calls expected'); }) as any, send as any, users.lapsed);
    expect(send).not.toHaveBeenCalled();
    expect((await pool.query('SELECT sent_at,error FROM agency_onboarding WHERE id=$1', [id])).rows[0]).toEqual({ sent_at: null, error: agencyPlanPaused });
  });
  it('ads: never contacts Google for a lapsed owner and does not schedule link polls for them', async () => {
    const connection = (await pool.query("INSERT INTO ads_grants(user_id,manager_id,refresh_token,verified) VALUES($1,'9876543210',$2,true) RETURNING connection_id", [users.lapsed, encryptToken('fixture-refresh')])).rows[0].connection_id;
    const job = (await pool.query("INSERT INTO ads_jobs(user_id,connection_id,batch_id,kind,dedupe) VALUES($1,$2,gen_random_uuid(),'discover',gen_random_uuid()::text) RETURNING id", [users.lapsed, connection])).rows[0].id;
    const make = vi.fn();
    await runAdsWorker({ onlyUser: users.lapsed, make });
    expect(make).not.toHaveBeenCalled();
    expect((await pool.query('SELECT status,error FROM ads_jobs WHERE id=$1', [job])).rows[0]).toEqual({ status: 'failed', error: ADS_PLAN_PAUSED });
    await scheduleLinkPolls(users.lapsed);
    expect((await pool.query("SELECT count(*)::int n FROM ads_jobs WHERE user_id=$1 AND kind='poll'", [users.lapsed])).rows[0].n).toBe(0);
  });
  it('cloudflare/search console: closes a lapsed owner\'s job without calling the provider and returns a confirmed change to preview', async () => {
    const c = (await pool.query("INSERT INTO edge_connections(user_id,provider,subject,token,method) VALUES($1,'cloudflare','p3-fixture',$2,'paste') RETURNING id", [users.lapsed, encryptToken('fixture-scoped')])).rows[0];
    const asset = (await pool.query("INSERT INTO edge_assets(user_id,connection_id,provider,external_id,name,domain,status) VALUES($1,$2,'cloudflare','p3zone','p3.example.invalid','p3.example.invalid','active') RETURNING id", [users.lapsed, c.id])).rows[0];
    const action = (await pool.query("INSERT INTO edge_actions(user_id,asset_id,kind,preview,state) VALUES($1,$2,'block','{}','queued') RETURNING id", [users.lapsed, asset.id])).rows[0].id;
    const job = (await pool.query("INSERT INTO edge_jobs(user_id,connection_id,asset_id,kind,payload) VALUES($1,$2,$3,'apply',$4) RETURNING id", [users.lapsed, c.id, asset.id, JSON.stringify({ actionId: action })])).rows[0].id;
    const http = vi.fn();
    await runEdgeJob(http as any, users.lapsed);
    expect(http).not.toHaveBeenCalled();
    expect((await pool.query('SELECT state,error FROM edge_jobs WHERE id=$1', [job])).rows[0]).toEqual({ state: 'failed', error: EDGE_PLAN_PAUSED });
    expect((await pool.query('SELECT state FROM edge_actions WHERE id=$1', [action])).rows[0].state).toBe('preview');
  });
  it('domains: does not monitor or change a lapsed owner\'s domains', async () => {
    const domain = (await pool.query("INSERT INTO managed_domains(user_id,domain,next_check) VALUES($1,'p3-lapsed.example.invalid',now()-interval '1 minute') RETURNING id", [users.lapsed])).rows[0].id;
    await scheduleMonitors(users.lapsed);
    expect((await pool.query("SELECT count(*)::int n FROM domain_jobs WHERE domain_id=$1 AND kind='monitor'", [domain])).rows[0].n).toBe(0);
    expect((await pool.query("SELECT next_check>now()+interval '23 hours' later FROM managed_domains WHERE id=$1", [domain])).rows[0].later).toBe(true);
    const job = randomUUID();
    await pool.query("INSERT INTO domain_jobs(id,user_id,domain_id,kind,status,run_at) VALUES($1,$2,$3,'change','queued','2000-01-01')", [job, users.lapsed, domain]);
    const adapter = vi.fn();
    await runDomainWorker({ adapter, onlyUser: users.lapsed });
    expect(adapter).not.toHaveBeenCalled();
    expect((await pool.query('SELECT status,error FROM domain_jobs WHERE id=$1', [job])).rows[0]).toEqual({ status: 'failed', error: DOMAINS_PLAN_PAUSED });
    // A change already applied at the registrar says so; only its verification stopped.
    const applied = randomUUID();
    await pool.query("INSERT INTO domain_jobs(id,user_id,domain_id,kind,status,run_at) VALUES($1,$2,$3,'change','verifying','2000-01-01')", [applied, users.lapsed, domain]);
    await runDomainWorker({ adapter, onlyUser: users.lapsed });
    expect((await pool.query('SELECT status,error FROM domain_jobs WHERE id=$1', [applied])).rows[0]).toEqual({ status: 'verification_failed', error: DOMAINS_VERIFY_PAUSED });
  });
  it('mail alerts: keeps no forwarded mail and runs no Gmail sync for a lapsed owner', async () => {
    const previousDomain = process.env.INBOUND_MAIL_DOMAIN, previousOauth = process.env.GMAIL_OAUTH_ENABLED;
    process.env.INBOUND_MAIL_DOMAIN = 'alerts.constructhub.test';
    process.env.GMAIL_OAUTH_ENABLED = 'true';
    try {
      // The same recognised provider alert is kept for an Agency owner and dropped for the lapsed one.
      for (const user of [users.lapsed, users.agency]) {
        const token = randomUUID().replace(/-/g, '').padEnd(48, 'a');
        await pool.query('INSERT INTO mail_alert_addresses(user_id,token_hash,token_cipher) VALUES($1,$2,$3)', [user, mailHash(token), encryptToken(token)]);
        await ingest(`From: forwarding-noreply@google.com\r\nTo: alerts+${token}@alerts.constructhub.test\r\nSubject: Gmail Forwarding Confirmation\r\n\r\nConfirmation code: 123456789\nhttps://mail.google.com/mail/vf-fixture`);
      }
      expect((await pool.query('SELECT count(*)::int n FROM mail_alert_messages WHERE user_id=$1', [users.lapsed])).rows[0].n).toBe(0);
      expect((await pool.query('SELECT count(*)::int n FROM mail_alert_messages WHERE user_id=$1', [users.agency])).rows[0].n).toBe(1);
      await pool.query("INSERT INTO mail_alert_grants(user_id,google_subject,email,access_token,refresh_token,expires_at,next_sync) VALUES($1,'p3-sub','p3@example.invalid',$2,$3,now()+interval '1 hour',now()-interval '1 minute')", [users.lapsed, encryptToken('fixture-access'), encryptToken('fixture-refresh')]);
      const http = vi.fn(async () => { throw Error('No Gmail calls expected for this owner'); });
      await runMailWorker(http as any, users.lapsed);
      const grant = (await pool.query("SELECT next_sync>now()+interval '50 minutes' later,last_error FROM mail_alert_grants WHERE user_id=$1", [users.lapsed])).rows[0];
      expect(grant).toEqual({ later: true, last_error: null });
    } finally {
      if (previousDomain === undefined) delete process.env.INBOUND_MAIL_DOMAIN; else process.env.INBOUND_MAIL_DOMAIN = previousDomain;
      if (previousOauth === undefined) delete process.env.GMAIL_OAUTH_ENABLED; else process.env.GMAIL_OAUTH_ENABLED = previousOauth;
    }
  });
});
