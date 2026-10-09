/**
 * Monthly text allowance (audit A1-3): every outbound text an org sends is
 * metered by segment against the owner's plan (shared/plans.ts
 * teamTextSegments) through the growth_budgets meter — reserve, send, refund
 * when the carrier refuses.
 *
 * Part 1 drives the sendSms seam against the real test DB (the module is
 * imported AFTER the env shims, like sms-compliance.test.ts). Part 2 boots a
 * child server from THIS checkout on its own port (plan-gates.test.ts
 * pattern) for the HTTP answers: 403 limit_reached on a manual send, 402
 * plan_required for an owner with no texting plan, and `usage.texts` on
 * /api/entitlements. Every fixture owner holds a CRM plan — the CRM is a
 * separate product and its staff routes refuse 402 crm_plan_required
 * without one (server/crm/tenancy.ts). CRM Basic adds no texts, so the Pro
 * fixture's cap stays the platform plan's teamTextSegments.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { createWriteStream, mkdirSync, rmSync } from "node:fs";
import { createHmac, randomUUID, randomInt } from "node:crypto";
import path from "node:path";
import pg from "pg";
import { PLANS, PLAN_KEYS } from "@shared/plans";

process.env.STRIPE_SECRET_KEY ||= "sk_test_dummy_for_module_import";
process.env.DATABASE_URL =
  process.env.CRM_TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  "postgres://constructhub_dev:crmdev_local_only@127.0.0.1:5432/constructhub_dev";
// The seam's log-provider sends go to their own outbox (read at call time).
const OUTBOX = path.join(process.cwd(), "tmp", "sms-meter-outbox.jsonl");
process.env.SMS_OUTBOX_PATH = OUTBOX;

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

let sendSms: any, textOrgOwners: any, recordSmsOptout: any, clearSmsLimitWarnings: any, SMS_NEEDS_PLAN: string;
let quotaKey: any;

const SW_KEYS = ["SIGNALWIRE_SPACE_URL", "SIGNALWIRE_PROJECT_ID", "SIGNALWIRE_API_TOKEN", "SIGNALWIRE_FROM_NUMBER"] as const;
const SW_ENV = {
  SIGNALWIRE_SPACE_URL: "x.signalwire.com",
  SIGNALWIRE_PROJECT_ID: "proj-1",
  SIGNALWIRE_API_TOKEN: "tok-1",
  SIGNALWIRE_FROM_NUMBER: "+15550001111",
};
/** Run fn with the SignalWire env set to `vals` (undefined = unset); always restores. */
async function withSwEnv<T>(vals: Record<string, string | undefined>, fn: () => Promise<T> | T): Promise<T> {
  const saved = Object.fromEntries(SW_KEYS.map((k) => [k, process.env[k]]));
  for (const k of SW_KEYS) {
    const v = vals[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    return await fn();
  } finally {
    for (const k of SW_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
}

const PRO_LIMIT = PLANS.pro.limits.teamTextSegments;
/** The cheapest plan with texting — what the 402 names (sms.ts SMS_REQUIRED_PLAN). */
const TEXTING_PLAN = PLAN_KEYS.find((k) => PLANS[k].limits.teamTextSegments !== 0 || PLANS[k].limits.clientTexting !== "none");
const month = () => new Date().toISOString().slice(0, 7);
const keyOf = (owner: number) => `quota:user:${owner}:texts:${month()}`;
const fill = (owner: number, used: number) =>
  pool.query("insert into growth_budgets(key,period,used) values($1,'0',$2) on conflict(key,period) do update set used=excluded.used", [keyOf(owner), used]);
const usedOf = async (owner: number) =>
  Number((await pool.query("select used from growth_budgets where key=$1 and period='0'", [keyOf(owner)])).rows[0]?.used ?? 0);
const spentMessage = (plan: "pro") =>
  `You've used all ${PLANS[plan].limits.teamTextSegments.toLocaleString("en-US")} text segments your ${PLANS[plan].name} plan includes this month. The count resets on the 1st (UTC). ` +
  `To raise it, move to ${PLANS.growth.name} (${PLANS.growth.limits.teamTextSegments.toLocaleString("en-US")} text segments).`;

afterEach(() => vi.unstubAllGlobals());
// Both parts share the pool: closed once, after the last describe.
afterAll(() => pool.end());

// ── Part 1: the sendSms seam ────────────────────────────────────────────────

describe("monthly text allowance seam (real test DB)", () => {
  const owners: number[] = [];
  let proOwner = 0, noPlanOwner = 0;
  let proOrg: any, noPlanOrgId = "";
  const phone = "+15550199777", optedOut = "+15550199778";

  beforeAll(async () => {
    ({ sendSms, textOrgOwners, recordSmsOptout, clearSmsLimitWarnings, SMS_NEEDS_PLAN } = await import("./sms"));
    ({ quotaKey } = await import("../growth-quotas"));
    await pool.query(`
      CREATE TABLE IF NOT EXISTS crm_sms_optouts (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        org_id varchar NOT NULL, phone text NOT NULL, reason text, created_at timestamp DEFAULT now()
      );
      CREATE UNIQUE INDEX IF NOT EXISTS crm_sms_optouts_org_phone_idx ON crm_sms_optouts (org_id, phone);
    `);
    const mk = async (plan: string | null) => {
      const { rows: [u] } = await pool.query("insert into users(email) values ('sms-meter-'||gen_random_uuid()||'@example.invalid') returning id");
      owners.push(u.id);
      if (plan) await pool.query("insert into subscriptions(user_id, plan, status) values ($1, $2, 'active')", [u.id, plan]);
      return u.id as number;
    };
    proOwner = await mk("pro");
    // Every platform plan includes texting on the 2026-10-09 ladder, so the
    // "no texting plan" case is an owner with no plan at all.
    noPlanOwner = await mk(null);
    // An owner member with a mobile and the legacy smsAlerts toggle on: what textOrgOwners texts.
    const { rows: [org] } = await pool.query(
      "insert into crm_orgs(name, owner_user_id, custom_fields) values ('vitest-sms-meter-pro', $1, $2) returning *",
      [proOwner, JSON.stringify({ smsAlerts: true })]);
    proOrg = { ...org, customFields: org.custom_fields };
    await pool.query("insert into crm_members(org_id, user_id, email, role, status, phone) values ($1, $2, 'sms-meter-owner@example.invalid', 'owner', 'active', $3)", [org.id, proOwner, phone]);
    noPlanOrgId = (await pool.query("insert into crm_orgs(name, owner_user_id) values ('vitest-sms-meter-noplan', $1) returning id", [noPlanOwner])).rows[0].id;
  });

  afterAll(async () => {
    await pool.query("delete from crm_sms_optouts where org_id = any($1)", [[proOrg?.id, noPlanOrgId].filter(Boolean)]);
    await pool.query("delete from crm_members where org_id = any($1)", [[proOrg?.id, noPlanOrgId].filter(Boolean)]);
    await pool.query("delete from crm_orgs where owner_user_id = any($1)", [owners]);
    await pool.query("delete from growth_budgets where key like any($1)", [owners.map((u) => `quota:user:${u}:%`)]);
    await pool.query("delete from subscriptions where user_id = any($1)", [owners]);
    await pool.query("delete from users where id = any($1)", [owners]);
    rmSync(OUTBOX, { force: true });
  });

  beforeEach(async () => {
    clearSmsLimitWarnings();
    await pool.query("delete from growth_budgets where key = $1", [keyOf(proOwner)]);
  });

  it("keys the meter like every other monthly count", () => {
    expect(quotaKey(proOwner, "texts")).toBe(keyOf(proOwner));
  });

  it("charges each send by segment, and a send the carrier refuses charges nothing", async () => {
    await withSwEnv({}, async () => {
      const one = await sendSms(phone, "hi", undefined, proOrg.id);
      expect(one).toMatchObject({ ok: true, provider: "log", segments: 1 });
      expect(await usedOf(proOwner)).toBe(1);
      const two = await sendSms(phone, "a".repeat(161), undefined, proOrg.id);
      expect(two.segments).toBe(2);
      expect(await usedOf(proOwner)).toBe(3);
    });
    await withSwEnv(SW_ENV, async () => {
      vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ message: "Invalid To number" }), { status: 400 })));
      const refused = await sendSms(phone, "hi", undefined, proOrg.id);
      expect(refused).toMatchObject({ ok: false, provider: "signalwire", error: "Invalid To number" });
      expect(refused.segments).toBeUndefined();
      expect(await usedOf(proOwner)).toBe(3);
    });
  });

  it("parallel sends never overshoot the cap", async () => {
    const left = 5;
    await fill(proOwner, PRO_LIMIT - left);
    const results = await withSwEnv({}, () => Promise.all(Array.from({ length: 20 }, () => sendSms(phone, "hi", undefined, proOrg.id))));
    expect(results.filter((r: any) => r.ok)).toHaveLength(left);
    const refused = results.filter((r: any) => !r.ok);
    expect(refused).toHaveLength(20 - left);
    for (const r of refused) expect(r.limit).toMatchObject({ code: "limit_reached", feature: "texts", limit: PRO_LIMIT, used: PRO_LIMIT });
    expect(await usedOf(proOwner)).toBe(PRO_LIMIT);
  });

  it("a spent month skips automated texts, logs once per org per month and never throws", async () => {
    await fill(proOwner, PRO_LIMIT);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const skipped = await withSwEnv({}, () => sendSms(phone, "hi", undefined, proOrg.id));
      expect(skipped.ok).toBe(false);
      expect(skipped.limit).toMatchObject({ code: "limit_reached", feature: "texts", limit: PRO_LIMIT, used: PRO_LIMIT, upgradePlan: "growth", addon: null, message: spentMessage("pro") });
      expect(skipped.error).toBe(spentMessage("pro"));
      expect(typeof skipped.limit.resetsAt).toBe("string");

      // The owner alert: the carrier is configured but must never be called.
      const fetchSpy = vi.fn(async () => { throw new Error("carrier must not be called"); });
      vi.stubGlobal("fetch", fetchSpy);
      const outcome = await withSwEnv(SW_ENV, () => textOrgOwners(proOrg, "Alpine: $1,000.00 received.", "invoicePaid"));
      expect(outcome).toMatchObject({ sent: 0, limit: { code: "limit_reached", feature: "texts" } });
      expect(fetchSpy).not.toHaveBeenCalled();

      const lines = warn.mock.calls.map((c) => String(c[0])).filter((l) => l.includes("monthly text allowance spent"));
      expect(lines).toHaveLength(1);
      expect(lines[0]).toContain(proOrg.id);
    } finally {
      warn.mockRestore();
    }
    expect(await usedOf(proOwner)).toBe(PRO_LIMIT);
  });

  it("an opted-out number costs nothing, and an owner with no plan is still refused 402-style", async () => {
    await recordSmsOptout(proOrg.id, optedOut, "STOP");
    const stop = await withSwEnv({}, () => sendSms(optedOut, "hi", undefined, proOrg.id));
    expect(stop.ok).toBe(false);
    expect(stop.error).toContain("STOP");
    expect(await usedOf(proOwner)).toBe(0);

    const refused = await withSwEnv({}, () => sendSms(phone, "hi", undefined, noPlanOrgId));
    expect(refused).toMatchObject({ ok: false, error: SMS_NEEDS_PLAN });
    expect(refused.limit).toBeUndefined();
    expect(await usedOf(noPlanOwner)).toBe(0);
  });
});

// ── Part 2: the routes, on a child server from this checkout ────────────────

const port = Number(process.env.SMS_METER_TEST_PORT || Number(new URL(process.env.CRM_TEST_BASE_URL!).port) + 9);
const base = `http://127.0.0.1:${port}`;
const secret = "sms-meter-session-secret";
const testIp = `198.18.${randomInt(256)}.${randomInt(1, 255)}`;

type Account = { id: number; cookie: string; org?: string; customer?: string };
async function api(path: string, who: Account | null, method = "GET", body?: any) {
  const r = await fetch(base + path, { method, headers: { cookie: who?.cookie ?? "", "content-type": "application/json", "x-forwarded-for": testIp }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const text = await r.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch {}
  return { status: r.status, body: json };
}

describe.skipIf(process.env.CRM_TEST_SINGLE_PORT === "true")("monthly text allowance over HTTP (auxiliary child server)", () => {
  const db = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const users: number[] = [], sids: string[] = [], orgs: string[] = [];
  let child: ChildProcess;
  let noTextPlan: Account, pro: Account;

  // Every fixture owner holds a CRM plan: CRM staff routes refuse 402
  // crm_plan_required without one (server/crm/tenancy.ts). CRM Basic adds no
  // text allowance, so the Pro owner's monthly cap stays the platform plan's
  // teamTextSegments. `plan` null = no platform plan (no texting entitlement).
  async function account(plan: string | null, crmPlan = "crm_basic"): Promise<Account> {
    const { rows: [user] } = await db.query("insert into users(email,display_name,email_verified) values($1,'P-Text meter',true) returning id", [`p-sms-meter-${randomUUID()}@example.invalid`]);
    users.push(user.id);
    if (plan) await db.query("insert into subscriptions(user_id,plan,status,stripe_subscription_id) values($1,$2,'active',$3)", [user.id, plan, `sub_p_${randomUUID()}`]);
    await db.query("insert into crm_subscriptions(user_id,plan,status) values($1,$2,'active')", [user.id, crmPlan]);
    const sid = randomUUID(); sids.push(sid);
    await db.query("insert into session(sid,sess,expire) values($1,$2,now()+interval '1 hour')", [sid, JSON.stringify({ cookie: { maxAge: 3600000 }, passport: { user: user.id } })]);
    const sig = createHmac("sha256", secret).update(sid).digest("base64").replace(/=+$/, "");
    const who: Account = { id: user.id, cookie: `connect.sid=${encodeURIComponent(`s:${sid}.${sig}`)}` };
    // The first CRM call creates the account's workspace (tenancy ensureOrgForUser).
    expect((await api("/api/crm/me", who)).status).toBe(200);
    who.org = (await db.query("select id from crm_orgs where owner_user_id=$1", [user.id])).rows[0].id;
    orgs.push(who.org!);
    who.customer = (await db.query("insert into crm_customers(org_id,display_name,phone,email,portal_token) values($1,'P-meter client','+15550107777','p-meter-client@example.invalid',gen_random_uuid()) returning id", [who.org])).rows[0].id;
    return who;
  }
  const notes = async (who: Account) => Number((await db.query("select count(*)::int n from crm_customer_notes where org_id=$1", [who.org])).rows[0].n);

  beforeAll(async () => {
    if (!/^\/constructhub_dev(?:_a\d+)?$/.test(new URL(process.env.DATABASE_URL!).pathname)) throw new Error("Requires a ConstructHUB development lane DB");
    child = spawn(process.execPath, ["--import", "tsx", "server/index.ts"], {
      env: {
        ...process.env, PORT: String(port), NODE_ENV: "development", DEV_AUTH_BYPASS_USER1: "false", CRM_DEMO_AUTOLOGIN: "false", SESSION_SECRET: secret,
        EMAIL_FORCE_SINK: "1", STRIPE_SECRET_KEY: "", GOOGLE_PLACES_API_KEY: "", SCRAPE_SCHEDULER_DISABLED: "true", GBP_SYNC_DISABLED: "true",
        // A "configured" carrier that refuses every connection: sends fail fast and honestly, never leave the box.
        SIGNALWIRE_SPACE_URL: "127.0.0.1:9", SIGNALWIRE_PROJECT_ID: "p-meter", SIGNALWIRE_API_TOKEN: "p-meter", SIGNALWIRE_FROM_NUMBER: "+15550100000",
        SMS_OUTBOX_PATH: path.join(process.cwd(), "tmp", `sms-meter-child-${port}.jsonl`),
      },
      stdio: ["ignore", "pipe", "pipe"], detached: true,
    });
    mkdirSync("tmp", { recursive: true });
    const log = createWriteStream(`tmp/sms-meter-${port}.log`);
    child.stdout!.pipe(log); child.stderr!.pipe(log);
    let ready = false;
    for (let i = 0; i < 120; i++) {
      if (child.exitCode !== null) throw new Error("Text meter test server exited");
      try { if ((await fetch(base + "/api/auth/me")).ok) { ready = true; break; } } catch {}
      await new Promise((r) => setTimeout(r, 500));
    }
    if (!ready) throw new Error("Text meter test server did not start");
    // CRM Basic only (no platform plan): the owner has no texting plan.
    noTextPlan = await account(null);
    pro = await account("pro");
    // The Pro org texts clients from its own (unreachable) SignalWire account.
    const sender = await api("/api/crm/sms/sender", pro, "PUT", { mode: "byo", fromNumber: "+15550106666", spaceUrl: "127.0.0.1:9", projectId: "p-meter-byo", apiToken: "tok-p-meter" });
    expect(sender.status).toBe(200);
    expect(sender.body).toMatchObject({ mode: "byo", canTextClients: true, planAllowsSms: true });
  }, 90_000);

  afterAll(async () => {
    if (child?.pid) { try { process.kill(-child.pid, "SIGTERM"); } catch {} }
    await db.query("delete from crm_customer_notes where org_id=any($1::text[])", [orgs]);
    await db.query("delete from crm_customers where org_id=any($1::text[])", [orgs]);
    await db.query("delete from crm_members where org_id=any($1::text[])", [orgs]);
    await db.query("delete from crm_orgs where id=any($1::text[])", [orgs]);
    await db.query("delete from growth_budgets where key like any($1)", [users.map((u) => `quota:user:${u}:%`)]);
    await db.query("delete from subscriptions where user_id=any($1::int[])", [users]);
    await db.query("delete from crm_subscriptions where user_id=any($1::int[])", [users]);
    await db.query("delete from users where id=any($1::int[])", [users]);
    await db.query("delete from session where sid=any($1::text[])", [sids]);
    await db.end();
  });

  it("a manual client text the carrier refuses is reported and charges nothing", async () => {
    const r = await api("/api/crm/messages", pro, "POST", { customerId: pro.customer, channel: "text", body: "On my way" });
    expect(r.status).toBe(502);
    expect(r.body.message).toContain("could not be sent");
    expect(await usedOf(pro.id)).toBe(0);
    expect(await notes(pro)).toBe(0);
  });

  it("at the cap a manual text answers the standard 403 limit_reached and records nothing", async () => {
    await fill(pro.id, PRO_LIMIT);
    const r = await api("/api/crm/messages", pro, "POST", { customerId: pro.customer, channel: "text", body: "On my way" });
    expect(r.status).toBe(403);
    expect(r.body).toMatchObject({ code: "limit_reached", feature: "texts", limit: PRO_LIMIT, used: PRO_LIMIT, upgradePlan: "growth", addon: null, message: spentMessage("pro") });
    expect(typeof r.body.resetsAt).toBe("string");
    expect(await notes(pro)).toBe(0);
    // Settings' test send is a manual send too.
    const test = await api("/api/crm/sms/test", pro, "POST", { to: "+15550107777" });
    expect(test.status).toBe(403);
    expect(test.body).toMatchObject({ code: "limit_reached", feature: "texts" });
    // Email is not metered.
    const email = await api("/api/crm/messages", pro, "POST", { customerId: pro.customer, channel: "email", body: "On my way" });
    expect(email.status).toBe(201);
    expect(await usedOf(pro.id)).toBe(PRO_LIMIT);
  });

  it("Limits & usage reports the month's segments", async () => {
    const r = await api("/api/entitlements", pro);
    expect(r.status).toBe(200);
    expect(r.body.allowances.teamTextSegments).toBe(PRO_LIMIT);
    expect(r.body.usage.texts).toEqual({ used: PRO_LIMIT, limit: PRO_LIMIT });
    // No platform plan: no platform text allowance either.
    expect((await api("/api/entitlements", noTextPlan)).body.usage.texts).toEqual({ used: 0, limit: 0 });
  });

  it("an org whose owner has no texting plan still gets 402 plan_required", async () => {
    const r = await api("/api/crm/messages", noTextPlan, "POST", { customerId: noTextPlan.customer, channel: "text", body: "On my way" });
    expect(r.status).toBe(402);
    expect(r.body).toMatchObject({ code: "plan_required", requiredPlan: TEXTING_PLAN, planAllowsSms: false });
    expect(await usedOf(noTextPlan.id)).toBe(0);
  });
});
