/**
 * The dashboard aggregator against the real development database
 * (DATABASE_URL, a constructhub_dev lane): every tile from real rows,
 * entitlement gates, per-tile isolation and timeouts, scoping, the checklist
 * and the recent feed. Plus the cache, which is pure.
 *
 * Accounts are throwaway (test-seed.ts) and deleted afterwards.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { PLANS, UNLIMITED } from "@shared/plans";
import { DASHBOARD_TILE_KEYS, type DashboardPayload, type DashboardTile, type DashboardTileKey } from "@shared/dashboard";
import { buildDashboard, withTimeout, DashboardTimeout } from "./aggregate";
import { createDashboardCache } from "./cache";
import { dq, endDashboardPool } from "./pool";
import { pool as appPool } from "../db";
import { assertDevDatabase, cleanupDashboardAccounts, seedDashboardAccounts, type Seeded } from "./test-seed";
import type { TileSource, TileSources } from "./tiles";

// ── Pure: cache and timeout ────────────────────────────────────────────────

const payload = (tag: string) => ({ generatedAt: tag } as unknown as DashboardPayload);

describe("dashboard cache", () => {
  it("answers within the TTL, keyed by user and pinned org", () => {
    let t = 0;
    const c = createDashboardCache({ ttlMs: 60_000, clock: () => t });
    c.set(1, null, payload("a"));
    expect(c.get(1, null)?.generatedAt).toBe("a");
    expect(c.get(1, "org-2")).toBeNull();          // another pinned org is another entry
    c.set(1, "org-2", payload("b"));
    expect(c.get(1, "org-2")?.generatedAt).toBe("b");
    expect(c.get(2, null)).toBeNull();              // another user never shares it
    t = 59_999;
    expect(c.get(1, null)?.generatedAt).toBe("a");
    t = 60_000;
    expect(c.get(1, null)).toBeNull();              // expired
  });

  it("evicts the oldest entry past the cap", () => {
    const c = createDashboardCache({ max: 2, clock: () => 0 });
    c.set(1, null, payload("1")); c.set(2, null, payload("2")); c.set(3, null, payload("3"));
    expect(c.size).toBe(2);
    expect(c.get(1, null)).toBeNull();
    expect(c.get(3, null)?.generatedAt).toBe("3");
  });

  it("lets ?fresh through at most once per throttle window per user", () => {
    let t = 0;
    const c = createDashboardCache({ freshThrottleMs: 10_000, clock: () => t });
    expect(c.allowFresh(1)).toBe(true);
    expect(c.allowFresh(1)).toBe(false);
    expect(c.allowFresh(2)).toBe(true);             // per user
    t = 9_999;
    expect(c.allowFresh(1)).toBe(false);
    t = 10_000;
    expect(c.allowFresh(1)).toBe(true);
  });
});

describe("dashboard cache: forgetting a user", () => {
  const at = (ms: number) => ({ generatedAt: new Date(ms).toISOString() } as unknown as DashboardPayload);

  it("drops every entry of that user (every pinned org) and nobody else's", () => {
    let t = 1_000;
    const c = createDashboardCache({ clock: () => t });
    c.set(1, null, at(1_000)); c.set(1, "org-2", at(1_000)); c.set(2, null, at(1_000));
    t = 2_000;
    c.clearUser(1);
    expect(c.get(1, null)).toBeNull();
    expect(c.get(1, "org-2")).toBeNull();
    expect(c.get(2, null)).not.toBeNull();
  });

  it("never stores a build that started before the forget (a plan change mid-build)", () => {
    let t = 2_000;
    const c = createDashboardCache({ clock: () => t });
    c.clearUser(1);
    c.set(1, null, at(1_500));
    expect(c.get(1, null)).toBeNull();
    t = 2_500;
    c.set(1, null, at(2_500));
    expect(c.get(1, null)?.generatedAt).toBe(new Date(2_500).toISOString());
  });
});

describe("withTimeout", () => {
  it("rejects a promise that never settles with DashboardTimeout", async () => {
    await expect(withTimeout(new Promise(() => {}), 20, "x")).rejects.toBeInstanceOf(DashboardTimeout);
    await expect(withTimeout(Promise.resolve(3), 20)).resolves.toBe(3);
  });
});

// ── Real database ──────────────────────────────────────────────────────────

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
let s: Seeded;
const quiet = () => {};

const tile = (p: DashboardPayload, key: DashboardTileKey): DashboardTile => p.tiles.find((t) => t.key === key)!;
const value = (p: DashboardPayload, key: DashboardTileKey, metric: string) =>
  tile(p, key).metrics.find((m) => m.key === metric)?.value;

describe("buildDashboard (development database)", () => {
  beforeAll(async () => {
    assertDevDatabase();
    s = await seedDashboardAccounts(pool);
  }, 60_000);

  afterAll(async () => {
    await cleanupDashboardAccounts(pool, s);
    await pool.end();
    await endDashboardPool();
    await appPool.end();
  });

  it("reads through a read-only pool whose statements stop at the tile budget", async () => {
    await expect(dq("UPDATE users SET display_name = display_name WHERE id=$1", [s.none])).rejects.toThrow(/read-only transaction/);
    const t0 = Date.now();
    await expect(dq("SELECT pg_sleep(10)")).rejects.toThrow(/statement timeout/);
    expect(Date.now() - t0).toBeLessThan(4000);
  }, 10_000);

  it("answers every tile, in catalogue order, never as sample data", async () => {
    const { payload: p } = await buildDashboard(s.agency, { log: quiet });
    expect(p.fixture).toBe(false);
    expect(p.cached).toBe(false);
    expect(p.tiles.map((t) => t.key)).toEqual([...DASHBOARD_TILE_KEYS]);
    for (const t of p.tiles) {
      if (t.status === "ok" && !["guides", "reinstatement", "property"].includes(t.key)) expect(t.metrics.length).toBeGreaterThan(0);
      if (t.status !== "ok") expect(t.metrics).toEqual([]);
      expect(t.cta?.href ?? t.href).toMatch(/^\//);
    }
  });

  it("no plan: plan-gated tiles are locked with the plan that includes them, and the checklist is open", async () => {
    const { payload: p } = await buildDashboard(s.none, { log: quiet });
    expect(p.account).toMatchObject({ plan: null, planName: null, status: "none", firstName: "Nora", usage: [] });
    for (const key of ["gbp", "reviews", "profileGuard", "rankingGrid", "gbpContent", "siteScan", "media", "permits"] as const) {
      expect(tile(p, key)).toMatchObject({ status: "locked", entitled: false, requiredPlan: "starter", metrics: [], cta: { href: "/pricing" } });
    }
    expect(tile(p, "clickGuard")).toMatchObject({ status: "locked", requiredPlan: "starter" });
    expect(tile(p, "competitors")).toMatchObject({ status: "locked", requiredPlan: "starter" });
    expect(tile(p, "cloudflare")).toMatchObject({ status: "locked", requiredPlan: "pro", module: "cloudflareSearchConsole" });
    expect(tile(p, "agency")).toMatchObject({ status: "locked", requiredPlan: "growth", module: "agencyWorkspace" });
    // The CRM is included with every plan; no plan and no org → locked to the first plan.
    expect(tile(p, "crm")).toMatchObject({ status: "locked", requiredPlan: "starter" });
    // The AI Call Assistant is a separate service on its own subscription: locked, and no plan is "required".
    expect(tile(p, "callAssistant")).toMatchObject({ status: "locked", entitled: false, addon: "call_assistant", metrics: [] });
    expect(tile(p, "callAssistant").requiredPlan).toBeUndefined();
    // Ungated tiles still work.
    expect(tile(p, "property").status).toBe("ok");
    expect(tile(p, "social").status).toBe("empty");
    expect(tile(p, "lsaLeads").status).toBe("empty");
    expect(p.checklist.map((c) => c.key)).toEqual(["connectGoogle", "addLocation", "requestReviews", "setUpCrm", "inviteTeammate"]);
    expect(p.checklist.every((c) => !c.done)).toBe(true);
    expect(p.checklist.find((c) => c.key === "setUpCrm")).toMatchObject({ href: "/crm-app", surface: "app" });
  });

  it("a locked tile reads no feature data", async () => {
    const called = new Set<string>();
    const spies: TileSources = Object.fromEntries(DASHBOARD_TILE_KEYS.map((k) => [k, (async () => { called.add(k); return { status: "empty" as const }; }) satisfies TileSource]));
    const { payload: p } = await buildDashboard(s.none, { sources: spies, log: quiet });
    const locked = p.tiles.filter((t) => t.status === "locked" || t.status === "coming_soon").map((t) => t.key);
    expect(locked.length).toBeGreaterThan(10);
    for (const key of locked) expect(called.has(key)).toBe(false);
    for (const t of p.tiles.filter((t) => t.entitled)) expect(called.has(t.key)).toBe(true);
  });

  it("never creates a CRM org", async () => {
    const count = async () => Number((await pool.query("SELECT count(*) n FROM crm_orgs")).rows[0].n);
    const before = await count();
    const { payload: p } = await buildDashboard(s.starter, { log: quiet });
    expect(await count()).toBe(before);
    expect((await pool.query("SELECT 1 FROM crm_members WHERE user_id=$1", [s.starter])).rowCount).toBe(0);
    // Entitled (Starter includes the CRM) but no org yet: set it up through the gateway.
    for (const key of ["crm", "crmSchedule", "crmLeads"] as const) {
      expect(tile(p, key)).toMatchObject({ status: "empty", entitled: true, cta: { label: "Set up the CRM", href: "/crm-app", surface: "app" } });
    }
  });

  it("Starter: its own meters, and the Pro and Agency features locked", async () => {
    const { payload: p } = await buildDashboard(s.starter, { log: quiet });
    const l = PLANS.starter.limits;
    expect(p.account).toMatchObject({ plan: "starter", planName: "Solo", status: "active", firstName: "Sam" });
    expect(p.account.renewsAt).toMatch(/^\d{4}-/);
    // Solo includes every one of these (limit 0 meters are left out): searches, grid credits,
    // Site Scans, Competitor Intel scans, team texts, locations and protected websites.
    expect(p.account.usage.map((u) => u.key)).toEqual(["searches", "rankings", "siteScans", "competitorScans", "texts", "locations", "protectedSites"]);
    expect(p.account.usage.find((u) => u.key === "searches")).toMatchObject({ used: 0, limit: l.permitSearches });
    expect(tile(p, "cloudflare")).toMatchObject({ status: "locked", requiredPlan: "pro" });
    // Solo includes 1 protected website and 200 team text segments: both tiles open (nothing set up yet).
    expect(tile(p, "clickGuard")).toMatchObject({ status: "empty", entitled: true });
    expect(tile(p, "texting")).toMatchObject({ status: "empty", entitled: true, cta: { label: "Set up the CRM", href: "/crm-app", surface: "app" } });
    // Nothing set up: "empty" with a setup CTA, not zeros.
    expect(tile(p, "gbp")).toMatchObject({ status: "empty", cta: { label: "Connect Google", href: "/locations" } });
    expect(tile(p, "siteScan").status).toBe("empty");
    // The permit meter is meaningful from day one.
    expect(tile(p, "permits").status).toBe("ok");
    // Activity leads; the month's quota (also the header's meter) comes last.
    expect(tile(p, "permits").metrics.map((m) => m.key)).toEqual(["searches7d", "lastSearch", "searches"]);
    expect(tile(p, "permits").metrics[2]).toMatchObject({ key: "searches", value: 0, limit: l.permitSearches });
    // Solo includes a protected website and client texting (BYO/add-on), so both are on the checklist.
    expect(p.checklist.map((c) => c.key)).toEqual(["connectGoogle", "addLocation", "turnOnGuard", "runSiteScan", "requestReviews", "protectWebsite", "setUpCrm", "inviteTeammate", "addTextingNumber"]);
  });

  it("Agency with data: every number is the account's own", async () => {
    const t0 = Date.now();
    const { payload: p, cacheable } = await buildDashboard(s.agency, { log: quiet });
    const ms = Date.now() - t0;
    expect(cacheable).toBe(true);
    expect(ms).toBeLessThan(1500);

    expect(p.account).toMatchObject({ plan: "agency", planName: "Unlimited", status: "active", firstName: "Dana", displayName: "Dana Agency", unreadNotifications: 1 });
    expect(p.account.usage.find((u) => u.key === "searches")).toMatchObject({ used: 7, limit: PLANS.agency.limits.permitSearches });
    expect(p.account.usage.find((u) => u.key === "crmSeats")).toMatchObject({ surface: "portal" });

    expect(value(p, "gbp", "locations")).toBe(2);
    expect(tile(p, "gbp").metrics.find((m) => m.key === "locations")?.limit).toBe(UNLIMITED);
    // Results lead the tiles; quotas the header already meters come last.
    expect(tile(p, "gbp").metrics[0].key).toBe("googleAccounts");
    expect(tile(p, "clickGuard").metrics.map((m) => m.key)).toEqual(["suspicious30d", "blockedIps", "sites"]);
    expect(tile(p, "rankingGrid").metrics[0].key).toBe("averageRank");
    expect(p.account.usage.find((u) => u.key === "texts")?.label).toBe("Texts");
    expect(value(p, "gbp", "googleAccounts")).toBe(1);
    // 5★, 4★, 3★ (the Google-deleted 1★ excluded): 4.0 average, one this week, one unanswered.
    expect(value(p, "reviews", "rating")).toBe(4);
    expect(value(p, "reviews", "newThisWeek")).toBe(1);
    expect(value(p, "reviews", "unanswered")).toBe(1);
    expect(value(p, "profileGuard", "guarded")).toBe(1);
    expect(value(p, "profileGuard", "pending")).toBe(1);
    // Profile Guard lives on the location's page, not the older GMB Edit Monitor.
    expect(tile(p, "profileGuard").cta).toMatchObject({ label: "Review edits", href: expect.stringMatching(/^\/locations\?location=\d+&tab=guard$/) });
    expect(p.checklist.find((c) => c.key === "turnOnGuard")?.href).toBe("/locations");
    // Property Records is a link, never a platform-wide count shown as the account's.
    expect(tile(p, "property")).toMatchObject({ status: "ok", metrics: [], cta: { label: "Look up a property", href: "/property" } });
    expect(tile(p, "texting")).toMatchObject({ status: "ok", entitled: true });
    expect(tile(p, "texting").metrics[0].key).toBe("clientTexting");
    expect(value(p, "rankingGrid", "averageRank")).toBe("3.4");
    expect(tile(p, "siteScan").metrics[0]).toMatchObject({ key: "score", value: 72, tone: "warn" });
    expect(value(p, "clickGuard", "sites")).toBe(1);
    expect(value(p, "clickGuard", "suspicious30d")).toBe(2);
    expect(value(p, "ipTracker", "visits7d")).toBe(3);
    expect(value(p, "ipTracker", "unique7d")).toBe(2);
    expect(value(p, "permits", "searches")).toBe(7);
    expect(value(p, "permits", "searches7d")).toBe(2);
    expect(value(p, "agency", "clients")).toBe(1);
    expect(value(p, "agency", "teammates")).toBe(1);
    // Entitled but never connected.
    expect(tile(p, "cloudflare")).toMatchObject({ status: "empty", entitled: true, cta: { label: "Connect Cloudflare" } });
    expect(tile(p, "adsManager").status).toBe("empty");

    // CRM: the agency user's own (oldest) org, not the other org they also belong to.
    expect(value(p, "crm", "openEstimates")).toBe(1);
    expect(tile(p, "crm").metrics.find((m) => m.key === "openEstimates")?.hint).toBe("$1,200 quoted");
    expect(value(p, "crm", "jobsWon")).toBe(1);
    expect(value(p, "crm", "unscheduled")).toBe(1);
    expect(value(p, "crm", "pipeline")).toBe(500_000);
    expect(value(p, "crm", "clients")).toBe(1);
    expect(tile(p, "crm").cta).toMatchObject({ label: "Open the CRM", href: "/crm", surface: "portal" });
    expect(value(p, "crmSchedule", "today")).toBe(1);   // the cancelled visit is not counted
    expect(value(p, "crmSchedule", "week")).toBe(2);
    expect(value(p, "crmLeads", "newLeads7d")).toBe(1);

    const done = Object.fromEntries(p.checklist.map((c) => [c.key, c.done]));
    expect(done).toEqual({
      connectGoogle: true, addLocation: true, turnOnGuard: true, runSiteScan: true, requestReviews: false,
      protectWebsite: true, setUpCrm: true, inviteTeammate: true, addTextingNumber: false,
    });

    // Recent: two notifications from the last 30 days plus the org's team activity, newest first.
    expect(p.recent.map((r) => r.title)).toEqual(["Owner sent estimate 1001", "New Google review", "Business Profile change detected"]);
    expect(p.recent[0]).toMatchObject({ source: "crm", surface: "portal", href: "/crm/clients/x" });
    expect(p.recent[1]).toMatchObject({ source: "notification", unread: true, href: "/google-reviews", surface: "app" });
    expect(p.recent[2]).toMatchObject({ unread: false, severity: "warning" });
  });

  it("a pinned org changes only the CRM numbers", async () => {
    const { payload: p } = await buildDashboard(s.agency, { activeOrgId: s.otherOrg, log: quiet });
    expect(value(p, "crm", "openEstimates")).toBe(4);
    expect(value(p, "crm", "clients")).toBe(4);
    expect(value(p, "gbp", "locations")).toBe(2);
    // A pin the user has no membership in is ignored (and nothing is written).
    const { payload: q } = await buildDashboard(s.starter, { activeOrgId: s.otherOrg, log: quiet });
    expect(tile(q, "crm").status).toBe("empty");
  });

  it("another account's rows never reach this dashboard", async () => {
    const { payload: mine } = await buildDashboard(s.agency, { log: quiet });
    const { payload: theirs } = await buildDashboard(s.other, { log: quiet });
    expect(value(theirs, "gbp", "locations")).toBe(3);
    expect(value(theirs, "reviews", "unanswered")).toBe(2);
    expect(value(theirs, "clickGuard", "suspicious30d")).toBe(5);
    expect(value(theirs, "crm", "clients")).toBe(4);
    expect(value(mine, "gbp", "locations")).toBe(2);
    expect(value(mine, "reviews", "unanswered")).toBe(1);
    expect(value(mine, "clickGuard", "suspicious30d")).toBe(2);
    expect(value(mine, "agency", "clients")).toBe(1);
    expect(mine.recent.some((r) => r.title === "Other user notification")).toBe(false);
    // The teammate (on the agency user's Agency team, no plan of their own) sees their own, empty account.
    const { payload: tm } = await buildDashboard(s.teammate, { log: quiet });
    expect(tm.account.plan).toBeNull();
    expect(tile(tm, "gbp").status).toBe("locked");
    expect(tm.recent).toEqual([]);
  });

  it("Reviews: requests sent but no review imported yet lead the tile, and say how reviews get here", async () => {
    await pool.query(
      `INSERT INTO review_requests(user_id, client_name, client_email, google_profile_url, token, created_at)
       VALUES ($1,'A','a@example.invalid','https://g.page/x',$2, now() - interval '2 days'),
              ($1,'B','b@example.invalid','https://g.page/x',$3, now() - interval '60 days')`,
      [s.starter, `rr-${Date.now()}-1`, `rr-${Date.now()}-2`]);
    try {
      const { payload: p } = await buildDashboard(s.starter, { log: quiet });
      expect(tile(p, "reviews")).toMatchObject({ status: "ok", cta: { label: "Connect Google to import reviews", href: "/locations" } });
      expect(tile(p, "reviews").metrics.map((m) => [m.key, m.value])).toEqual([["requestsSent", 2], ["requests30d", 1]]);
    } finally {
      await pool.query("DELETE FROM review_requests WHERE user_id=$1", [s.starter]);
    }
  });

  it("Texting follows the CRM org owner's plan: a crew seat without a plan of its own is in", async () => {
    await pool.query(
      `INSERT INTO crm_members(org_id, user_id, email, role, status) VALUES($1,$2,$3,'field','active')`,
      [s.agencyOrg, s.teammate, `crew-${Date.now()}@example.invalid`]);
    try {
      const { payload: p } = await buildDashboard(s.teammate, { log: quiet });
      expect(p.account.plan).toBeNull();
      expect(tile(p, "texting")).toMatchObject({ status: "ok", entitled: true });
      // The texts are metered on the owner's allowance: a crew seat sees on/off, not the count.
      expect(tile(p, "texting").metrics.map((m) => m.key)).toEqual(["clientTexting"]);
    } finally {
      await pool.query("DELETE FROM crm_members WHERE org_id=$1 AND user_id=$2", [s.agencyOrg, s.teammate]);
    }
  });

  it("an agency teammate in the owner's workspace gets 'Open' for the shared pages, never a plan upsell or the owner's numbers", async () => {
    const { payload: p } = await buildDashboard(s.teammate, { workspace: { ownerId: s.agency, ownerName: "Dana Agency" }, log: quiet });
    for (const key of ["gbp", "reviews", "profileGuard", "siteScan"] as const) {
      const t = tile(p, key);
      expect(t).toMatchObject({ status: "empty", entitled: false, metrics: [], cta: { label: "Open", href: t.href } });
      expect(t.requiredPlan).toBeUndefined();
      expect(t.message).toContain("Dana Agency's workspace");
    }
    // Pages the workspace doesn't share stay locked.
    expect(tile(p, "cloudflare").status).toBe("locked");
    expect(tile(p, "rankingGrid").status).toBe("locked");
  });

  it("leads without an estimate: every covering estimate counts, past 2,000 estimates in the org", async () => {
    const q = (text: string, params: unknown[] = []) => pool.query(text, params).then((r) => r.rows);
    const [u] = await q("INSERT INTO users(email, display_name, email_verified) VALUES($1,'Lee Leads',true) RETURNING id", [`dash-leads-${Date.now()}@example.invalid`]);
    s.users.push(u.id);
    const [org] = await q("INSERT INTO crm_orgs(name, owner_user_id) VALUES('Dash leads co',$1) RETURNING id", [u.id]);
    await q("INSERT INTO crm_members(org_id, user_id, email, role, status) VALUES($1,$2,$3,'owner','active')", [org.id, u.id, `owner-leads-${u.id}@example.invalid`]);
    const customer = async (name: string) =>
      (await q("INSERT INTO crm_customers(org_id, display_name, portal_token) VALUES($1,$2,$3) RETURNING id", [org.id, name, `pt-${name}-${u.id}-${Date.now()}`]))[0].id as string;
    const busy = await customer("Busy"), byCustomer = await customer("ByCustomer"), byProject = await customer("ByProject"), bare = await customer("Bare");
    // 2,100 estimates for an unrelated client first, then the two that cover leads.
    await q(`INSERT INTO crm_estimates(org_id, customer_id, status, total_cents, public_token)
             SELECT $1, $2, 'sent', 100, 'pt-bulk-' || $3 || '-' || g FROM generate_series(1, 2100) g`, [org.id, busy, u.id]);
    const lead = async (customerId: string) =>
      (await q("INSERT INTO crm_projects(org_id, customer_id, name, status) VALUES($1,$2,'Lead','lead') RETURNING id", [org.id, customerId]))[0].id as string;
    await lead(byCustomer);
    const projectLead = await lead(byProject);
    await lead(bare);
    await q("INSERT INTO crm_estimates(org_id, customer_id, status, total_cents, public_token) VALUES($1,$2,'draft',100,$3)", [org.id, byCustomer, `pt-c-${u.id}`]);
    // Points at the lead's project (the client on it is another one).
    await q("INSERT INTO crm_estimates(org_id, customer_id, project_id, status, total_cents, public_token) VALUES($1,$2,$3,'draft',100,$4)", [org.id, busy, projectLead, `pt-p-${u.id}`]);

    const { payload: p } = await buildDashboard(u.id, { log: quiet });
    expect(value(p, "crmLeads", "needEstimate")).toBe(1);
    expect(tile(p, "crmLeads").metrics.find((m) => m.key === "needEstimate")?.tone).toBe("warn");
  }, 30_000);

  it("a source that throws is one error tile; the rest still answer", async () => {
    const baseline = (await buildDashboard(s.agency, { log: quiet })).payload;
    const lines: string[] = [];
    const { payload: p } = await buildDashboard(s.agency, {
      sources: { social: async () => { throw new Error("boom"); } },
      log: (l) => lines.push(l),
    });
    expect(tile(p, "social")).toMatchObject({ status: "error", metrics: [], cta: { label: "Open Social Media", href: "/social-media" } });
    expect(tile(p, "social").message).toMatch(/^Social Media couldn't load/);
    for (const t of p.tiles) if (t.key !== "social") expect(t.status).toBe(tile(baseline, t.key).status);
    expect(lines).toEqual(["[dashboard] tile social failed: boom"]);
  });

  it("a source that never answers times out on the 3 s budget; the rest still answer", async () => {
    const t0 = Date.now();
    const { payload: p } = await buildDashboard(s.agency, { sources: { reviews: () => new Promise(() => {}) }, log: quiet });
    const ms = Date.now() - t0;
    expect(ms).toBeLessThan(3500);
    expect(ms).toBeGreaterThanOrEqual(2900);
    expect(tile(p, "reviews")).toMatchObject({ status: "error", message: "Google Reviews didn't answer in time. Open the page for live numbers." });
    expect(tile(p, "gbp").status).toBe("ok");
    expect(tile(p, "crm").status).toBe("ok");
  }, 10_000);
});
