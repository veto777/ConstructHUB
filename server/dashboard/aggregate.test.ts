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
import { AGENCY_SELF_SERVE_MAX_LOCATIONS, PLANS } from "@shared/plans";
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
      if (t.status === "ok" && !["guides", "reinstatement"].includes(t.key)) expect(t.metrics.length).toBeGreaterThan(0);
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
    expect(tile(p, "clickGuard")).toMatchObject({ status: "locked", requiredPlan: "pro" });
    expect(tile(p, "competitors")).toMatchObject({ status: "locked", requiredPlan: "pro" });
    expect(tile(p, "cloudflare")).toMatchObject({ status: "locked", requiredPlan: "agency", module: "cloudflareSearchConsole" });
    expect(tile(p, "agency")).toMatchObject({ status: "locked", requiredPlan: "agency", module: "agencyWorkspace" });
    // The CRM is included with every plan; no plan and no org → locked to the first plan.
    expect(tile(p, "crm")).toMatchObject({ status: "locked", requiredPlan: "starter" });
    expect(tile(p, "callAssistant").status).toBe("coming_soon");
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
    expect(p.account).toMatchObject({ plan: "starter", planName: "Starter", status: "active", firstName: "Sam" });
    expect(p.account.renewsAt).toMatch(/^\d{4}-/);
    expect(p.account.usage.map((u) => u.key)).toEqual(["searches", "rankings", "siteScans", "locations"]);
    expect(p.account.usage.find((u) => u.key === "searches")).toMatchObject({ used: 0, limit: l.permitSearches });
    expect(tile(p, "cloudflare")).toMatchObject({ status: "locked", requiredPlan: "agency" });
    expect(tile(p, "clickGuard")).toMatchObject({ status: "locked", requiredPlan: "pro" });
    expect(tile(p, "texting")).toMatchObject({ status: "locked", requiredPlan: "pro" });
    // Nothing set up: "empty" with a setup CTA, not zeros.
    expect(tile(p, "gbp")).toMatchObject({ status: "empty", cta: { label: "Connect Google", href: "/locations" } });
    expect(tile(p, "siteScan").status).toBe("empty");
    // The permit meter is meaningful from day one.
    expect(tile(p, "permits").status).toBe("ok");
    expect(tile(p, "permits").metrics[0]).toMatchObject({ key: "searches", value: 0, limit: l.permitSearches });
    expect(p.checklist.map((c) => c.key)).toEqual(["connectGoogle", "addLocation", "turnOnGuard", "runSiteScan", "requestReviews", "setUpCrm", "inviteTeammate"]);
  });

  it("Agency with data: every number is the account's own", async () => {
    const t0 = Date.now();
    const { payload: p, cacheable } = await buildDashboard(s.agency, { log: quiet });
    const ms = Date.now() - t0;
    expect(cacheable).toBe(true);
    expect(ms).toBeLessThan(1500);

    expect(p.account).toMatchObject({ plan: "agency", planName: "Agency", status: "active", firstName: "Dana", displayName: "Dana Agency", unreadNotifications: 1 });
    expect(p.account.usage.find((u) => u.key === "searches")).toMatchObject({ used: 7, limit: PLANS.agency.limits.permitSearches });
    expect(p.account.usage.find((u) => u.key === "crmSeats")).toMatchObject({ surface: "portal" });

    expect(value(p, "gbp", "locations")).toBe(2);
    expect(tile(p, "gbp").metrics[0].limit).toBe(AGENCY_SELF_SERVE_MAX_LOCATIONS);
    expect(value(p, "gbp", "googleAccounts")).toBe(1);
    // 5★, 4★, 3★ (the Google-deleted 1★ excluded): 4.0 average, one this week, one unanswered.
    expect(value(p, "reviews", "rating")).toBe(4);
    expect(value(p, "reviews", "newThisWeek")).toBe(1);
    expect(value(p, "reviews", "unanswered")).toBe(1);
    expect(value(p, "profileGuard", "guarded")).toBe(1);
    expect(value(p, "profileGuard", "pending")).toBe(1);
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
