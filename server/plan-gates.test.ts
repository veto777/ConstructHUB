import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { createWriteStream, mkdirSync } from "node:fs";
import { createHmac, randomUUID, randomInt } from "node:crypto";
import pg from "pg";

// Server-side plan enforcement over HTTP, with real separate accounts on the new
// price book (shared/plans.ts) and legacy plan keys: every refusal is a 402
// plan_required or a 403 limit_reached that names the limit. Same child-server
// pattern as growth-hardening.test.ts (no dev bypass, no Places key, no Stripe).
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const port = Number(new URL(process.env.CRM_TEST_BASE_URL!).port) + 5;
const base = `http://127.0.0.1:${port}`;
const secret = "plan-gates-session-secret";
const testIp = `198.18.${randomInt(256)}.${randomInt(1, 255)}`;
const users: number[] = [], sids: string[] = [], codes: number[] = [];
let child: ChildProcess;

type Account = { id: number; cookie: string };
async function account(plan?: string, stripe = true): Promise<Account> {
  const { rows: [user] } = await pool.query("insert into users(email,display_name,email_verified) values($1,'P-Plan gates',true) returning id", [`p-gates-${randomUUID()}@example.invalid`]);
  users.push(user.id);
  if (plan) await pool.query("insert into subscriptions(user_id,plan,status,stripe_subscription_id) values($1,$2,'active',$3)", [user.id, plan, stripe ? `sub_p_${randomUUID()}` : null]);
  const sid = randomUUID(); sids.push(sid);
  await pool.query("insert into session(sid,sess,expire) values($1,$2,now()+interval '1 hour')", [sid, JSON.stringify({ cookie: { maxAge: 3600000 }, passport: { user: user.id } })]);
  const sig = createHmac("sha256", secret).update(sid).digest("base64").replace(/=+$/, "");
  return { id: user.id, cookie: `connect.sid=${encodeURIComponent(`s:${sid}.${sig}`)}` };
}
async function api(path: string, who: Account | null, method = "GET", body?: any) {
  const r = await fetch(base + path, { method, headers: { cookie: who?.cookie ?? "", "content-type": "application/json", "x-forwarded-for": testIp }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const text = await r.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch {}
  return { status: r.status, body: json };
}
const month = () => new Date().toISOString().slice(0, 7);
const used = async (userId: number, feature: string) =>
  Number((await pool.query("select used from growth_budgets where key=$1 and period='0'", [`quota:user:${userId}:${feature}:${month()}`])).rows[0]?.used ?? 0);
async function eventually(check: () => Promise<boolean>) {
  for (let i = 0; i < 40; i++) { if (await check()) return true; await new Promise(r => setTimeout(r, 100)); }
  return false;
}

describe.skipIf(process.env.CRM_TEST_SINGLE_PORT === "true")("plan gates (auxiliary child server)", () => {
  let none: Account, starter: Account, pro: Account, gold: Account, platinum: Account;
  beforeAll(async () => {
    if (!/^\/constructhub_dev(?:_a\d+)?$/.test(new URL(process.env.DATABASE_URL!).pathname)) throw new Error("Requires a ConstructHUB development lane DB");
    child = spawn(process.execPath, ["--import", "tsx", "server/index.ts"], {
      env: { ...process.env, PORT: String(port), NODE_ENV: "development", DEV_AUTH_BYPASS_USER1: "false", CRM_DEMO_AUTOLOGIN: "false", SESSION_SECRET: secret, EMAIL_FORCE_SINK: "1", STRIPE_SECRET_KEY: "", GOOGLE_PLACES_API_KEY: "", DATAFORSEO_LOGIN: "", DATAFORSEO_PASSWORD: "", SCRAPE_SCHEDULER_DISABLED: "true", GBP_SYNC_DISABLED: "true" },
      stdio: ["ignore", "pipe", "pipe"], detached: true,
    });
    mkdirSync("tmp", { recursive: true });
    const log = createWriteStream(`tmp/plan-gates-${port}.log`);
    child.stdout!.pipe(log); child.stderr!.pipe(log);
    let ready = false;
    for (let i = 0; i < 120; i++) {
      if (child.exitCode !== null) throw new Error("Plan gates test server exited");
      try { if ((await fetch(base + "/api/auth/me")).ok) { ready = true; break; } } catch {}
      await new Promise(r => setTimeout(r, 500));
    }
    if (!ready) throw new Error("Plan gates test server did not start");
    none = await account();
    starter = await account("starter");
    pro = await account("pro");
    gold = await account("gold");                 // legacy -> Growth
    platinum = await account("platinum", false);  // legacy Stripe-less grant -> Agency
  }, 90_000);

  afterAll(async () => {
    if (child?.pid) { try { process.kill(-child.pid, "SIGTERM"); } catch {} }
    await pool.query("delete from competitor_listings where user_id=any($1::int[])", [users]);
    await pool.query("delete from competitor_scans where user_id=any($1::int[])", [users]);
    await pool.query("delete from ranking_grid_results where scan_id in (select id from ranking_grid_scans where user_id=any($1::int[]))", [users]);
    await pool.query("delete from ranking_grid_scans where user_id=any($1::int[])", [users]);
    await pool.query("delete from tracked_domains where user_id=any($1::int[])", [users]);
    await pool.query("delete from review_templates where user_id=any($1::int[])", [users]);
    await pool.query("delete from seo_contracts where user_id=any($1::int[])", [users]);
    await pool.query("delete from gbp_guard where user_id=any($1::int[])", [users]);
    await pool.query("delete from business_locations where user_id=any($1::int[])", [users]);
    await pool.query("delete from beta_access_codes where id=any($1::int[])", [codes]);
    await pool.query("delete from growth_budgets where key like any($1)", [users.map(u => `quota:user:${u}:%`)]);
    await pool.query("delete from subscriptions where user_id=any($1::int[])", [users]);
    await pool.query("delete from users where id=any($1::int[])", [users]);
    await pool.query("delete from session where sid=any($1::text[])", [sids]);
    await pool.end();
  });

  it("reports the account's plan, allowances and usage", async () => {
    expect((await api("/api/entitlements", null)).status).toBe(401);
    const mine = await api("/api/entitlements", gold);
    expect(mine.body).toMatchObject({ plan: "growth", storedPlan: "gold", accessPlan: "growth", planName: "Growth", isPlatformAdmin: false });
    expect(mine.body.usage.competitorScans).toEqual({ used: 0, limit: 8 });
    expect((await api("/api/entitlements", none)).body).toMatchObject({ plan: null, accessPlan: null, allowances: null });
    // The one Stripe-less Platinum row keeps Agency entitlements (modules included).
    expect((await api("/api/entitlements", platinum)).body).toMatchObject({ plan: "agency", modules: { agencyWorkspace: true, adsManager: true } });
  });

  it("Competitor Intel needs a plan with competitor scans and counts them monthly", async () => {
    for (const who of [none, starter]) {
      const r = await api("/api/competitors/scans", who);
      expect(r.status).toBe(402);
      expect(r.body).toMatchObject({ code: "plan_required", requiredPlan: "pro" });
    }
    expect((await api("/api/competitors/scans", gold)).status).toBe(200);
    // Pro includes 2 a month: with both used the next scan is refused and says how to get more.
    await pool.query("insert into growth_budgets(key,period,used) values($1,'0',2)", [`quota:user:${pro.id}:competitorScans:${month()}`]);
    const full = await api("/api/competitors/scans", pro, "POST", { industry: "Roofing", location: "Tampa, FL" });
    expect(full.status).toBe(403);
    expect(full.body).toMatchObject({ code: "limit_reached", feature: "competitorScans", limit: 2, upgradePlan: "growth", addon: "competitor_pack" });
    expect(full.body.message).toBe("You've used all 2 Competitor Intel scans your Pro plan includes this month. The count resets on the 1st (UTC). To raise it, add the Competitor scan pack add-on or move to Growth (8 Competitor Intel scans).");
    // A scan that fails (no Places key here) gives its scan back.
    const ok = await api("/api/competitors/scans", gold, "POST", { industry: "Roofing", location: "Tampa, FL" });
    expect(ok.status).toBe(200);
    expect(await eventually(async () => (await used(gold.id, "competitorScans")) === 0)).toBe(true);
  });

  it("Click Guard, IP Tracker and VPN Shield share the plan's protected websites", async () => {
    for (const who of [none, starter]) {
      const r = await api("/api/click-guard/domains", who, "POST", { domain: "p-gates.example" });
      expect(r.status).toBe(402);
      expect(r.body.requiredPlan).toBe("pro");
      expect(r.body.message).toBe("Click-fraud protection (Click Guard, IP Tracker and VPN Shield) is included with the Pro plan. Upgrade in Pricing to use it.");
    }
    expect((await api("/api/click-guard/domains", pro, "POST", { domain: "p-gates-one.example" })).status).toBe(200);
    const second = await api("/api/click-guard/domains", pro, "POST", { domain: "p-gates-two.example" });
    expect(second.status).toBe(403);
    expect(second.body).toMatchObject({ code: "limit_reached", feature: "protectedSites", limit: 1, used: 1, upgradePlan: "growth", addon: "protected_site" });
    expect(second.body.message).toBe("Your Pro plan protects 1 website with Click Guard, IP Tracker and VPN Shield, and 1 is in use. To raise it, add the Extra protected website add-on or move to Growth (3 websites).");
    // Growth (legacy Gold) protects 3: five concurrent adds, exactly three get through.
    const results = await Promise.all(["a", "b", "c", "d", "e"].map(x => api("/api/click-guard/domains", gold, "POST", { domain: `p-gates-race-${x}.example` })));
    expect(results.map(r => r.status).sort()).toEqual([200, 200, 200, 403, 403]);
  });

  it("counts Google Business Profile locations against the plan", async () => {
    expect((await api("/api/locations", none, "POST", { businessName: "P-Gates none" })).body).toMatchObject({ code: "plan_required", requiredPlan: "starter" });
    expect((await api("/api/locations", starter, "POST", { businessName: "P-Gates starter" })).status).toBe(200);
    const second = await api("/api/locations", starter, "POST", { businessName: "P-Gates starter two" });
    expect(second.status).toBe(403);
    expect(second.body).toMatchObject({ code: "limit_reached", feature: "locations", limit: 1, used: 1, addon: "extra_location", upgradePlan: "growth" });
    // A Business Profile import that would add a location is refused the same way, before the import runs.
    const imported = await api("/api/gbp/import", starter, "POST", { locations: [{ accountResource: "accounts/p-gates", gbpName: "locations/p-gates-new", grantSubject: "p-gates" }] });
    expect(imported.status).toBe(403);
    expect(imported.body.feature).toBe("locations");
    expect((await api("/api/gbp/import", none, "POST", { locations: [] })).status).toBe(402);
  });

  it("gates citations, review templates, photos, Profile Guard and the AI reply mode", async () => {
    expect((await api("/api/citations/campaigns", none, "POST", { campaignName: "P-Gates", businessName: "P-Gates" })).status).toBe(402);
    expect((await api("/api/citations/campaigns", starter, "POST", { campaignName: "P-Gates", businessName: "P-Gates" })).status).toBe(200);
    await pool.query("delete from citation_campaigns where user_id=$1", [starter.id]);

    const template = (i: number, who: Account) => api("/api/review-templates", who, "POST", { name: `P-Gates ${i}`, googleProfileUrl: `https://search.google.com/local/writereview?placeid=PGATES${i}` });
    expect((await template(0, none)).status).toBe(402);
    for (let i = 0; i < 5; i++) expect((await template(i, starter)).status).toBe(200);
    const sixth = await template(5, starter);
    expect(sixth.status).toBe(403);
    expect(sixth.body).toMatchObject({ code: "limit_reached", feature: "reviewTemplates", limit: 5, upgradePlan: "pro" });

    // Saves racing at the limit: counted and inserted under one lock, so exactly the allowance lands.
    const racer = await account("starter");
    const race = await Promise.all(Array.from({ length: 8 }, (_, i) => template(100 + i, racer)));
    expect(race.filter((r) => r.status === 200)).toHaveLength(5);
    expect(race.filter((r) => r.status === 403)).toHaveLength(3);
    expect(Number((await pool.query("select count(*) from review_templates where user_id=$1", [racer.id])).rows[0].count)).toBe(5);
    expect(Number((await pool.query("select count(*) from review_templates where user_id=$1 and is_default", [racer.id])).rows[0].count)).toBe(1);

    const guard = await api("/api/gbp/locations/2147483647/guard", none, "PUT", { mode: "notify", watched: [] });
    expect(guard.status).toBe(402);
    expect(guard.body.requiredPlan).toBe("starter");
    // Starter covers one location, so Profile Guard runs on one at a time; turning it off is always allowed.
    const { rows: [loc] } = await pool.query("select id from business_locations where user_id=$1 limit 1", [starter.id]);
    await pool.query("insert into gbp_guard(user_id,location_id,mode,watched) values($1,$2,'notify','{}')", [starter.id, loc.id]);
    const second = await api("/api/gbp/locations/2147483647/guard", starter, "PUT", { mode: "notify", watched: [] });
    expect(second.status).toBe(403);
    expect(second.body).toMatchObject({ code: "limit_reached", feature: "guardedLocations", limit: 1, used: 1 });
    // (The Guard route itself then asks for a fresh identity check before any mode change.)
    expect((await api(`/api/gbp/locations/2147483647/guard`, starter, "PUT", { mode: "off", watched: [] })).body).toMatchObject({ reauth: true });

    const auto = await api("/api/gbp/locations/2147483647/ai-replies", starter, "PUT", { mode: "auto" });
    expect(auto.status).toBe(402);
    expect(auto.body).toMatchObject({ code: "plan_required", requiredPlan: "pro" });
    expect(auto.body.message).toContain("Your Starter plan drafts AI replies for you to approve.");
    // Drafts pass the plan gate (the route itself then finds no such location).
    expect((await api("/api/gbp/locations/2147483647/ai-replies", starter, "PUT", { mode: "draft" })).status).not.toBe(402);
    expect((await api("/api/gbp/locations/2147483647/ai-replies", none, "PUT", { mode: "draft" })).status).toBe(402);
  });

  it("meters ranking grids in size-weighted credits", async () => {
    const grid = (gridSize: number, who: Account) => api("/api/ranking-grid/scans", who, "POST", { businessName: "P-Gates", placeId: "p-gates", lat: 27.95, lon: -82.46, keyword: "roofer", gridSize, gridDistance: 1 });
    expect((await grid(3, none)).status).toBe(402);
    // A 15x15 grid costs 9 credits; Starter has 5.
    const big = await grid(15, starter);
    expect(big.status).toBe(403);
    expect(big.body).toMatchObject({ code: "limit_reached", feature: "rankings", limit: 5 });
    expect((await grid(3, starter)).status).toBe(200);
    // No Places key here, so the grid fails and its credit comes back.
    expect(await eventually(async () => (await used(starter.id, "rankings")) === 0)).toBe(true);
  });

  it("limits the self-serve card trial to one grid, but not a trial-code grant", async () => {
    const grid = (who: Account) => api("/api/ranking-grid/scans", who, "POST", { businessName: "P-Gates", placeId: "p-gates", lat: 27.95, lon: -82.46, keyword: "roofer", gridSize: 3, gridDistance: 1 });
    const card = await account();
    await pool.query("insert into subscriptions(user_id,plan,status,stripe_subscription_id) values($1,'pro','trialing',$2)", [card.id, `sub_p_${randomUUID()}`]);
    expect((await grid(card)).status).toBe(200);
    const second = await grid(card);
    expect(second.status).toBe(403);
    expect(second.body).toMatchObject({ code: "limit_reached", feature: "rankings", limit: 1 });

    const coded = await account();
    await pool.query("insert into subscriptions(user_id,plan,status,current_period_end) values($1,'agency','trialing',now()+interval '2 days')", [coded.id]);
    expect((await grid(coded)).status).toBe(200);
    expect((await grid(coded)).status).toBe(200);
  });

  it("trial codes grant Agency for the trial, never overwrite a paid plan, and expire", async () => {
    const code = async () => {
      const { rows: [c] } = await pool.query("insert into beta_access_codes(code,created_by_user_id,trial_days,expires_at) values($1,$2,2,now()+interval '1 day') returning id,code", [`TRIAL-P${randomUUID().slice(0, 8).toUpperCase()}`, users[0]]);
      codes.push(c.id);
      return c.code as string;
    };
    const paid = await api("/api/beta-codes/redeem", pro, "POST", { code: await code() });
    expect(paid.status).toBe(409);
    expect((await api("/api/entitlements", pro)).body.plan).toBe("pro");

    const trial = await account();
    const redeemed = await api("/api/beta-codes/redeem", trial, "POST", { code: await code() });
    expect(redeemed.status).toBe(200);
    expect(redeemed.body.plan).toBe("agency");
    expect((await api("/api/beta-codes/status", trial)).body).toMatchObject({ active: true, plan: "agency" });
    const during = await api("/api/entitlements", trial);
    expect(during.body).toMatchObject({ plan: "agency", modules: { agencyWorkspace: true } });
    expect(new Date(during.body.grantEndsAt).getTime()).toBeGreaterThan(Date.now() + 86400_000);
    expect((await api("/api/competitors/scans", trial)).status).toBe(200);

    expect((await api("/api/stripe/subscription", trial)).body).toMatchObject({ plan: "agency", status: "trialing", effectivePlan: "agency", cancelAtPeriodEnd: null });

    // Past its end date the trial is inactive everywhere, the billing page included.
    await pool.query("update subscriptions set current_period_end=now()-interval '1 minute' where user_id=$1", [trial.id]);
    expect((await api("/api/entitlements", trial)).body).toMatchObject({ plan: null, accessPlan: null });
    expect((await api("/api/beta-codes/status", trial)).body.active).toBe(false);
    expect((await api("/api/competitors/scans", trial)).status).toBe(402);
    expect((await api("/api/stripe/subscription", trial)).body).toMatchObject({ plan: "agency", status: "inactive", effectivePlan: null });
  });

  it("$1,000 and up is talk-to-sales on the SEO contract flow too — no contract to sign online, no checkout", async () => {
    for (const packageId of ["dfy_seo_first_page", "dfy_seo_growth", "dfy_seo_domination", "dfy_seo_ads"]) {
      const res = await api("/api/contracts/create", starter, "POST", { packageId });
      expect(res.status, packageId).toBe(409);
      expect(res.body).toMatchObject({ code: "talk_to_sales" });
      expect(res.body.message).toMatch(/Talk to a sales rep/);
    }
    expect((await api("/api/contracts/create", starter, "POST", { packageId: "constructor" })).status).toBe(400);
    expect(Number((await pool.query("select count(*) from seo_contracts where user_id=$1", [starter.id])).rows[0].count)).toBe(0);

    // A contract signed before the price book changed isn't paid online either (the server has no Stripe key here,
    // so a 409 proves the refusal comes before any checkout is attempted).
    const token = `p-gates-${randomUUID()}`;
    await pool.query(
      `insert into seo_contracts(user_id,email,token,package_id,package_name,monthly_price,total_price,term_months,status,signed_at,expires_at)
       values($1,'p-gates@example.invalid',$2,'dfy_seo_growth','SEO Growth',600000,3600000,6,'signed',now(),now()+interval '1 day')`, [starter.id, token]);
    const pay = await api(`/api/contracts/${token}/checkout`, starter, "POST", {});
    expect(pay.status).toBe(409);
    expect(pay.body).toMatchObject({ code: "talk_to_sales", items: ["SEO Growth"] });
    // Someone else's contract is still a 403, not a sales answer.
    expect((await api(`/api/contracts/${token}/checkout`, pro, "POST", {})).status).toBe(403);
  });
});
