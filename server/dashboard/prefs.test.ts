/**
 * Dashboard preferences: the layout rules and the "Needs you today" clearing
 * rules (shared/dashboard-prefs.ts, pure), then the stored layout applied by
 * the real aggregator against the lane's development database (throwaway
 * accounts from test-seed.ts; their prefs rows go with them, ON DELETE CASCADE).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { DASHBOARD_TILE_KEYS, type DashboardAttentionItem, type DashboardTile, type DashboardTileKey } from "@shared/dashboard";
import {
  DASHBOARD_DISMISS_BATCH_MAX, DASHBOARD_LAYOUT_MAX_KEYS, DASHBOARD_SECTION_KEYS, DASHBOARD_SNOOZE_MAX_DAYS,
  attentionSignature, defaultDashboardLayout, dashboardGroupsInOrder, isDefaultDashboardLayout, normalizeDashboardLayout,
  parseDashboardLayoutInput, parseDismissInput, splitAttention, splitDashboardTiles, snoozeUntil, type DashboardDismissal,
} from "@shared/dashboard-prefs";
import { buildDashboard } from "./aggregate";
import { endDashboardPool } from "./pool";
import {
  deleteDashboardDismissals, ensureDashboardPrefsSchema, forgetStaleDismissals, readDashboardDismissals, readDashboardLayout,
  resetDashboardLayout, saveDashboardDismissals, saveDashboardLayout,
} from "./prefs";
import { pool as appPool } from "../db";
import { assertDevDatabase, cleanupDashboardAccounts, seedDashboardAccounts, type Seeded } from "./test-seed";
import type { TileSources } from "./tiles";

// ── Layout (pure) ──────────────────────────────────────────────────────────

describe("dashboard layout: validation and normalising", () => {
  it("the default lists every catalogue tile once, every section on, grouped", () => {
    const d = defaultDashboardLayout();
    expect(d.order).toEqual([...DASHBOARD_TILE_KEYS]);
    expect(d.hidden).toEqual([]);
    expect(d.keepGroups).toBe(true);
    for (const k of DASHBOARD_SECTION_KEYS) expect(d.sections[k]).toBe(true);
    expect(isDefaultDashboardLayout(d)).toBe(true);
    expect(isDefaultDashboardLayout(normalizeDashboardLayout(null))).toBe(true);
  });

  it("ignores unknown tile and section keys and duplicates; missing tiles go last; unnamed sections stay on", () => {
    const l = normalizeDashboardLayout({
      order: ["siteScan", "nope", "siteScan", 42, "permits"],
      hidden: ["reviews", "ghost", "reviews"],
      sections: { recent: false, bogus: false },
      keepGroups: false,
    });
    expect(l.order.slice(0, 2)).toEqual(["siteScan", "permits"]);
    expect(l.order).toHaveLength(DASHBOARD_TILE_KEYS.length);
    expect(new Set(l.order).size).toBe(DASHBOARD_TILE_KEYS.length);
    expect(l.order).not.toContain("nope");
    expect(l.hidden).toEqual(["reviews"]);
    expect(l.sections.recent).toBe(false);
    expect(l.sections.needs).toBe(true);
    expect((l.sections as Record<string, boolean>).bogus).toBeUndefined();
    expect(l.keepGroups).toBe(false);
  });

  it("grouped layouts keep each group's tiles together, groups in the order their first tile comes", () => {
    const l = normalizeDashboardLayout({ order: ["permits", "siteScan", "property", "gbp"], keepGroups: true });
    const groups = dashboardGroupsInOrder(l.order);
    expect(groups.map((g) => g.key).slice(0, 2)).toEqual(["win", "grow"]);
    expect(groups[0].tiles.slice(0, 2)).toEqual(["permits", "property"]);
    expect(groups[1].tiles.slice(0, 2)).toEqual(["siteScan", "gbp"]);
  });

  it("PUT body: shape and size caps are errors, unknown keys are not", () => {
    expect(parseDashboardLayoutInput(undefined).ok).toBe(false);
    expect(parseDashboardLayoutInput([]).ok).toBe(false);
    expect(parseDashboardLayoutInput({ order: "gbp" }).ok).toBe(false);
    expect(parseDashboardLayoutInput({ order: Array(DASHBOARD_LAYOUT_MAX_KEYS + 1).fill("gbp") }).ok).toBe(false);
    expect(parseDashboardLayoutInput({ hidden: ["x".repeat(61)] }).ok).toBe(false);
    expect(parseDashboardLayoutInput({ sections: { needs: "no" } }).ok).toBe(false);
    expect(parseDashboardLayoutInput({ sections: Object.fromEntries(Array.from({ length: 21 }, (_, i) => [`s${i}`, true])) }).ok).toBe(false);
    expect(parseDashboardLayoutInput({ keepGroups: "yes" }).ok).toBe(false);
    const ok = parseDashboardLayoutInput({ order: ["fromTheFuture", "siteScan"], hidden: ["alsoUnknown"], sections: { someNewSection: true } });
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.layout.order[0]).toBe("siteScan");
      expect(ok.layout.order).toHaveLength(DASHBOARD_TILE_KEYS.length);
      expect(ok.layout.hidden).toEqual([]);
    }
  });

  it("the CRM card's tiles are never hidden one by one (the CRM section turns the card off)", () => {
    const l = normalizeDashboardLayout({ hidden: ["crm", "crmLeads", "crmSchedule", "reviews"] });
    expect(l.hidden).toEqual(["reviews"]);
    const put = parseDashboardLayoutInput({ hidden: ["crm", "crmLeads"] });
    expect(put.ok && put.layout.hidden).toEqual([]);
  });

  it("a hidden tile is locked in Customize exactly when it would show as locked (a delegated page opens)", () => {
    const t = (key: DashboardTileKey, status: DashboardTile["status"], extra: Partial<DashboardTile> = {}) =>
      ({ key, status, entitled: false, metrics: [], ...extra }) as unknown as DashboardTile;
    const all = [
      t("reviews", "empty"),                                   // a teammate's delegated page: not entitled, but it opens
      t("cloudflare", "locked", { requiredPlan: "agency" }),
      t("callAssistant", "locked", { addon: "call_assistant" }), // on sale, not bought: locked like any tile (a separate service: no plan named)
      t("siteScan", "ok", { entitled: true }),
    ];
    const { tiles, hiddenTiles } = splitDashboardTiles(all, normalizeDashboardLayout({ hidden: ["reviews", "cloudflare", "callAssistant"] }));
    expect(tiles.map((x) => x.key)).toEqual(["siteScan"]);
    expect(hiddenTiles).toEqual([
      { key: "reviews", entitled: true },
      { key: "cloudflare", entitled: false, requiredPlan: "agency" },
      { key: "callAssistant", entitled: false },
    ]);
    // A tile whose add-on is still `preview` ("coming_soon") isn't locked: Customize says "Coming soon" instead.
    expect(splitDashboardTiles([t("callAssistant", "coming_soon", { addon: "call_assistant" })], normalizeDashboardLayout({ hidden: ["callAssistant"] })).hiddenTiles)
      .toEqual([{ key: "callAssistant", entitled: true, comingSoon: true }]);
  });
});

// ── Clearing "Needs you today" (pure) ──────────────────────────────────────

const item = (key: string, value: number | string | null, extra: Partial<DashboardAttentionItem> = {}): DashboardAttentionItem => ({
  key, source: "Test", label: key, value, format: "count", tone: "warn", href: "/", surface: "app", ...extra,
});
const dismissal = (key: string, value: string, until: string | null = null, scope = ""): DashboardDismissal => ({ key, scope, value, until, at: new Date(0).toISOString() });
const keys = (ds: DashboardDismissal[]) => ds.map((d) => d.key);

describe("dashboard dismissals: what stays hidden", () => {
  const now = new Date("2026-10-02T12:00:00Z");

  it("the signature is the value, plus the limit for a meter", () => {
    expect(attentionSignature(item("reviews.unanswered", 3))).toBe("3");
    expect(attentionSignature(item("usage.searches", 12, { limit: 10 }))).toBe("12/10");
    expect(attentionSignature(item("billing", "Growth", { format: "text" }))).toBe("Growth");
    expect(attentionSignature(item("x", null))).toBe("");
  });

  it("the same value stays hidden; a changed value comes back and its dismissal is stale", () => {
    const items = [item("reviews.unanswered", 3), item("notifications", 2)];
    const same = splitAttention(items, [dismissal("reviews.unanswered", "3")], now);
    expect(same.attention.map((i) => i.key)).toEqual(["notifications"]);
    expect(same.cleared).toMatchObject([{ key: "reviews.unanswered", signature: "3", until: null }]);
    expect(same.stale).toEqual([]);

    const changed = splitAttention([item("reviews.unanswered", 4), item("notifications", 2)], [dismissal("reviews.unanswered", "3")], now);
    expect(changed.attention.map((i) => i.key)).toEqual(["reviews.unanswered", "notifications"]);
    expect(changed.cleared).toEqual([]);
    expect(keys(changed.stale)).toEqual(["reviews.unanswered"]);

    // A meter whose limit changed (a plan change) is a new situation too.
    const meter = splitAttention([item("usage.searches", 12, { limit: 20 })], [dismissal("usage.searches", "12/10")], now);
    expect(meter.attention).toHaveLength(1);
  });

  it("a snooze holds until its end, then the item comes back", () => {
    const items = [item("clickGuard.suspicious30d", 17)];
    const until = new Date(now.getTime() + 60_000).toISOString();
    expect(splitAttention(items, [dismissal("clickGuard.suspicious30d", "17", until)], now).attention).toEqual([]);
    const later = new Date(now.getTime() + 60_000);
    const ended = splitAttention(items, [dismissal("clickGuard.suspicious30d", "17", until)], later);
    expect(ended.attention).toHaveLength(1);
    expect(keys(ended.stale)).toEqual(["clickGuard.suspicious30d"]);
    // A snooze ends early when the number changes.
    expect(splitAttention([item("clickGuard.suspicious30d", 18)], [dismissal("clickGuard.suspicious30d", "17", until)], now).attention).toHaveLength(1);
  });

  it("an ended snooze for an item that is gone is stale; a Done for a gone item is kept while its source didn't answer", () => {
    const past = new Date(now.getTime() - 1).toISOString();
    const r = splitAttention([], [dismissal("a.b", "1", past), dismissal("c.d", "2")], now);
    expect(keys(r.stale)).toEqual(["a.b"]);
    // The tile failed or timed out (not in `answered`): the clear is kept.
    expect(splitAttention([], [dismissal("crmLeads.followUpsDue", "2")], now, { answered: ["clickGuard", "usage"] }).stale).toEqual([]);
  });

  it("a cleared item that goes away and later comes back with the same number shows again", () => {
    const d = dismissal("crmLeads.followUpsDue", "2");
    const day1 = splitAttention([item("crmLeads.followUpsDue", 2)], [d], now, { answered: ["crmLeads"] });
    expect(day1.cleared).toHaveLength(1);
    // Day 2: the follow-ups were done, the tile answered with no such item: the clear is forgotten.
    const day2 = splitAttention([], [d], now, { answered: ["crmLeads", "usage", "notifications", "billing"] });
    expect(day2.stale).toEqual([d]);
    // (The server deletes that row; day 9 sees two new follow-ups with no clear left.)
    const day9 = splitAttention([item("crmLeads.followUpsDue", 2)], [], now, { answered: ["crmLeads"] });
    expect(day9.attention.map((i) => i.key)).toEqual(["crmLeads.followUpsDue"]);
    // Alerts, meters and billing go by their own sources; snoozes too.
    const until = new Date(now.getTime() + 86_400_000).toISOString();
    const gone = splitAttention([], [dismissal("notifications", "1"), dismissal("usage.searches", "10/10"), dismissal("reviews.unanswered", "3", until)], now,
      { answered: ["notifications", "usage", "reviews"] });
    expect(keys(gone.stale).sort()).toEqual(["notifications", "reviews.unanswered", "usage.searches"]);
  });

  it("a payload built before a clear was saved never judges it", () => {
    const d = { ...dismissal("reviews.unanswered", "4"), at: new Date(now.getTime() - 1000).toISOString() };
    const older = new Date(now.getTime() - 30_000);
    // An older cached answer still shows 3, and one without the item: neither forgets the new clear.
    expect(splitAttention([item("reviews.unanswered", 3)], [d], now, { builtAt: older }).stale).toEqual([]);
    expect(splitAttention([], [d], now, { builtAt: older, answered: ["reviews"] }).stale).toEqual([]);
    // A newer one does.
    expect(splitAttention([item("reviews.unanswered", 3)], [d], now, { builtAt: now }).stale).toEqual([d]);
  });

  it("a CRM item's clear holds in the CRM org it was cleared in; other items' clears hold everywhere", () => {
    const crm = dismissal("crmLeads.needEstimate", "324", null, "org-a");
    const other = dismissal("clickGuard.suspicious30d", "13");
    const items = [item("crmLeads.needEstimate", 640), item("clickGuard.suspicious30d", 13)];
    // In org B (another number): the org-A clear neither applies nor goes stale.
    const inB = splitAttention(items, [crm, other], now, { scope: "org-b", answered: ["crmLeads", "clickGuard"] });
    expect(inB.attention.map((i) => i.key)).toEqual(["crmLeads.needEstimate"]);
    expect(inB.cleared.map((i) => i.key)).toEqual(["clickGuard.suspicious30d"]);
    expect(inB.stale).toEqual([]);
    // Back in org A it is still cleared.
    const inA = splitAttention([item("crmLeads.needEstimate", 324)], [crm], now, { scope: "org-a", answered: ["crmLeads"] });
    expect(inA.cleared.map((i) => i.key)).toEqual(["crmLeads.needEstimate"]);
  });

  it("PUT body: keys, values, snooze window and batch size are checked", () => {
    const ok = parseDismissInput({ items: [{ key: "reviews.unanswered", value: "3" }, { key: "notifications", value: "2", until: new Date(now.getTime() + 3_600_000).toISOString() }] }, now);
    expect(ok).toMatchObject({ ok: true, items: [{ key: "reviews.unanswered", value: "3", until: null }, { key: "notifications", value: "2" }] });
    expect(parseDismissInput({}, now).ok).toBe(false);
    expect(parseDismissInput({ items: [] }, now).ok).toBe(false);
    expect(parseDismissInput({ items: Array.from({ length: DASHBOARD_DISMISS_BATCH_MAX + 1 }, (_, i) => ({ key: `k${i}`, value: "1" })) }, now).ok).toBe(false);
    expect(parseDismissInput({ items: [{ key: "bad key!", value: "1" }] }, now).ok).toBe(false);
    expect(parseDismissInput({ items: [{ key: "k".repeat(81), value: "1" }] }, now).ok).toBe(false);
    expect(parseDismissInput({ items: [{ key: "k", value: 3 }] }, now).ok).toBe(false);
    expect(parseDismissInput({ items: [{ key: "k", value: "x".repeat(201) }] }, now).ok).toBe(false);
    expect(parseDismissInput({ items: [{ key: "k", value: "1", until: "soon" }] }, now).ok).toBe(false);
    expect(parseDismissInput({ items: [{ key: "k", value: "1", until: new Date(now.getTime() - 1000).toISOString() }] }, now).ok).toBe(false);
    expect(parseDismissInput({ items: [{ key: "k", value: "1", until: new Date(now.getTime() + (DASHBOARD_SNOOZE_MAX_DAYS + 1) * 86_400_000).toISOString() }] }, now).ok).toBe(false);
    expect(parseDismissInput({ items: [{ key: "k", value: "1" }], scope: "bad scope!" }, now).ok).toBe(false);
  });

  it("PUT body: the scope applies to CRM items only", () => {
    const r = parseDismissInput({ items: [{ key: "crmLeads.needEstimate", value: "3" }, { key: "texting.failed", value: "1" }, { key: "notifications", value: "2" }], scope: "org-a" }, now);
    expect(r).toMatchObject({ ok: true, items: [
      { key: "crmLeads.needEstimate", scope: "org-a" }, { key: "texting.failed", scope: "org-a" }, { key: "notifications", scope: "" },
    ] });
    expect(parseDismissInput({ items: [{ key: "crm.unscheduled", value: "1" }] }, now)).toMatchObject({ ok: true, items: [{ scope: "" }] });
  });

  it("'Payment past due' can be snoozed, never marked Done", () => {
    expect(parseDismissInput({ items: [{ key: "billing", value: "Growth" }] }, now).ok).toBe(false);
    expect(parseDismissInput({ items: [{ key: "billing", value: "Growth", until: new Date(now.getTime() + 3_600_000).toISOString() }] }, now).ok).toBe(true);
  });

  it("snooze ends: tomorrow or a week out, at 8 am on the viewer's clock", () => {
    const base = new Date(2026, 9, 2, 15, 30);
    expect(snoozeUntil("tomorrow", base)).toEqual(new Date(2026, 9, 3, 8, 0));
    expect(snoozeUntil("week", base)).toEqual(new Date(2026, 9, 9, 8, 0));
  });
});

// ── Stored prefs + the real aggregator ─────────────────────────────────────

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
let s: Seeded;
const quiet = () => {};

describe("dashboard prefs (development database)", () => {
  beforeAll(async () => {
    assertDevDatabase();
    await ensureDashboardPrefsSchema();
    await ensureDashboardPrefsSchema(); // idempotent
    s = await seedDashboardAccounts(pool);
  }, 60_000);

  afterAll(async () => {
    await cleanupDashboardAccounts(pool, s);
    const left = await pool.query("SELECT count(*)::int n FROM dashboard_prefs WHERE user_id = ANY($1::int[])", [s.users]);
    expect(left.rows[0].n).toBe(0);
    await pool.end();
    await endDashboardPool();
    await appPool.end();
  });

  it("applies the saved order and visibility; a hidden tile leaves the grid but its alerts stay", async () => {
    const layout = normalizeDashboardLayout({
      order: ["siteScan", ...DASHBOARD_TILE_KEYS.filter((k) => k !== "siteScan")],
      hidden: ["reviews", "cloudflare", "callAssistant"],
      keepGroups: false,
      sections: { recent: false },
    });
    await saveDashboardLayout(s.agency, layout);
    expect(await readDashboardLayout(s.agency)).toEqual(layout);

    const called: DashboardTileKey[] = [];
    const spy = (key: DashboardTileKey): TileSources => ({ [key]: async () => {
      called.push(key);
      return { status: "ok", metrics: key === "reviews" ? [{ key: "unanswered", label: "Awaiting a reply", value: 3, format: "count", tone: "warn" }] : [] };
    } });
    const { payload: p } = await buildDashboard(s.agency, { log: quiet, sources: { ...spy("reviews"), ...spy("siteScan") } });
    expect(p.layout).toEqual(layout);
    expect(p.tiles.map((t) => t.key)).toEqual(layout.order.filter((k) => !layout.hidden.includes(k)));
    expect(p.tiles[0].key).toBe("siteScan");
    expect(called.sort()).toEqual(["reviews", "siteScan"]); // the hidden Google Reviews tile is still computed…
    expect(p.tiles.some((t) => t.key === "reviews")).toBe(false); // …but not shown
    // Hidden tiles: access only. The agency plan includes Cloudflare and Reviews; the Call Assistant is a
    // separate service this account hasn't bought (on sale since the launch): locked, not "coming soon", no plan named.
    expect(p.hiddenTiles).toEqual(expect.arrayContaining([
      { key: "reviews", entitled: true },
      { key: "cloudflare", entitled: true },
      { key: "callAssistant", entitled: false },
    ]));
    // Its alerts stay in Needs you today (until cleared); the source counts as answered. A hidden section is not read.
    expect(p.attention.map((i) => i.key)).toContain("reviews.unanswered");
    expect(p.answered).toEqual(expect.arrayContaining(["reviews", "siteScan", "usage", "notifications", "billing"]));
    expect(p.recent).toEqual([]);
  });

  it("a locked tile stays locked whether it is shown or hidden", async () => {
    await saveDashboardLayout(s.starter, normalizeDashboardLayout({ hidden: ["cloudflare"] }));
    const hidden = (await buildDashboard(s.starter, { log: quiet })).payload;
    expect(hidden.hiddenTiles).toEqual([{ key: "cloudflare", entitled: false, requiredPlan: "pro" }]);
    await resetDashboardLayout(s.starter);
    const shown = (await buildDashboard(s.starter, { log: quiet })).payload;
    expect(shown.tiles.find((t) => t.key === "cloudflare")).toMatchObject({ status: "locked", entitled: false, metrics: [] });
    expect(shown.hiddenTiles).toEqual([]);
    expect(isDefaultDashboardLayout(shown.layout)).toBe(true);
  });

  it("one user's layout and cleared items never apply to another", async () => {
    await saveDashboardLayout(s.other, normalizeDashboardLayout({ hidden: ["gbp", "reviews"], keepGroups: false }));
    await saveDashboardDismissals(s.other, [{ key: "notifications", scope: "", value: "1", until: null }]);
    const mine = (await buildDashboard(s.none, { log: quiet })).payload;
    expect(isDefaultDashboardLayout(mine.layout)).toBe(true);
    expect(mine.tiles.map((t) => t.key)).toEqual([...DASHBOARD_TILE_KEYS]);
    expect(await readDashboardDismissals(s.none)).toEqual([]);
    expect((await readDashboardDismissals(s.other)).map((d) => d.key)).toEqual(["notifications"]);
  });

  it("stores dismissals per key (upsert), drops ended snoozes, restores one or all", async () => {
    const u = s.teammate;
    const soon = new Date(Date.now() + 3_600_000).toISOString();
    await saveDashboardDismissals(u, [{ key: "a.one", scope: "", value: "1", until: null }, { key: "b.two", scope: "", value: "2", until: soon }]);
    await saveDashboardDismissals(u, [{ key: "a.one", scope: "", value: "5", until: null }]);
    const rows = await readDashboardDismissals(u);
    expect(rows.find((d) => d.key === "a.one")).toMatchObject({ value: "5", until: null });
    expect(rows.find((d) => d.key === "b.two")?.until).toBe(soon);
    await pool.query("UPDATE dashboard_dismissals SET snoozed_until = now() - interval '1 minute' WHERE user_id=$1 AND item_key='b.two'", [u]);
    await saveDashboardDismissals(u, [{ key: "c.three", scope: "", value: "3", until: null }]);
    expect((await readDashboardDismissals(u)).map((d) => d.key).sort()).toEqual(["a.one", "c.three"]);
    expect(await deleteDashboardDismissals(u, ["a.one"])).toBe(1);
    expect(await deleteDashboardDismissals(u, null)).toBe(1);
    expect(await readDashboardDismissals(u)).toEqual([]);
  });

  it("keeps at most 100 cleared items per user (the oldest go)", async () => {
    const u = s.teammate;
    for (let batch = 0; batch < 3; batch++) {
      await saveDashboardDismissals(u, Array.from({ length: 40 }, (_, i) => ({ key: `k${batch}.${i}`, scope: "", value: "1", until: null })));
    }
    const rows = await readDashboardDismissals(u);
    expect(rows).toHaveLength(100);
    expect(rows.some((d) => d.key === "k2.39")).toBe(true);
    await deleteDashboardDismissals(u, null);
  });

  it("CRM clears are kept per org; restoring in one org leaves the other's; stale cleanup removes only the exact row", async () => {
    const u = s.teammate;
    await saveDashboardDismissals(u, [
      { key: "crmLeads.needEstimate", scope: "org-a", value: "324", until: null },
      { key: "crmLeads.needEstimate", scope: "org-b", value: "640", until: null },
      { key: "notifications", scope: "", value: "2", until: null },
    ]);
    expect((await readDashboardDismissals(u)).map((d) => `${d.scope}:${d.key}`).sort()).toEqual([":notifications", "org-a:crmLeads.needEstimate", "org-b:crmLeads.needEstimate"]);
    // Restore all, as seen in org B: org A's CRM clear stays.
    expect(await deleteDashboardDismissals(u, null, "org-b")).toBe(2);
    expect((await readDashboardDismissals(u)).map((d) => `${d.scope}:${d.key}`)).toEqual(["org-a:crmLeads.needEstimate"]);
    // Restore one, as seen in org B: nothing of org A's goes.
    expect(await deleteDashboardDismissals(u, ["crmLeads.needEstimate"], "org-b")).toBe(0);
    // A stale judgement on the old value can't remove a clear saved again with a new one.
    const [old] = await readDashboardDismissals(u);
    await saveDashboardDismissals(u, [{ key: "crmLeads.needEstimate", scope: "org-a", value: "325", until: null }]);
    expect(await forgetStaleDismissals(u, [old])).toBe(0);
    const [now] = await readDashboardDismissals(u);
    expect(now).toMatchObject({ value: "325", scope: "org-a" });
    expect(await forgetStaleDismissals(u, [now])).toBe(1);
    expect(await readDashboardDismissals(u)).toEqual([]);
  });

  it("the payload names the CRM org its CRM items came from", async () => {
    const own = (await buildDashboard(s.agency, { log: quiet })).payload;
    expect(own.scope).toBe(s.agencyOrg);
    const pinned = (await buildDashboard(s.agency, { activeOrgId: s.otherOrg, log: quiet })).payload;
    expect(pinned.scope).toBe(s.otherOrg);
    expect((await buildDashboard(s.none, { log: quiet })).payload.scope).toBeUndefined();
  });
});
