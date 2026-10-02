/**
 * Dashboard preferences: the layout rules and the "Needs you today" clearing
 * rules (shared/dashboard-prefs.ts, pure), then the stored layout applied by
 * the real aggregator against the lane's development database (throwaway
 * accounts from test-seed.ts; their prefs rows go with them, ON DELETE CASCADE).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { DASHBOARD_TILE_KEYS, type DashboardAttentionItem, type DashboardTileKey } from "@shared/dashboard";
import {
  DASHBOARD_DISMISS_BATCH_MAX, DASHBOARD_LAYOUT_MAX_KEYS, DASHBOARD_SECTION_KEYS, DASHBOARD_SNOOZE_MAX_DAYS,
  attentionSignature, defaultDashboardLayout, dashboardGroupsInOrder, isDefaultDashboardLayout, normalizeDashboardLayout,
  parseDashboardLayoutInput, parseDismissInput, splitAttention, snoozeUntil, type DashboardDismissal,
} from "@shared/dashboard-prefs";
import { buildDashboard } from "./aggregate";
import { endDashboardPool } from "./pool";
import {
  deleteDashboardDismissals, ensureDashboardPrefsSchema, readDashboardDismissals, readDashboardLayout,
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
});

// ── Clearing "Needs you today" (pure) ──────────────────────────────────────

const item = (key: string, value: number | string | null, extra: Partial<DashboardAttentionItem> = {}): DashboardAttentionItem => ({
  key, source: "Test", label: key, value, format: "count", tone: "warn", href: "/", surface: "app", ...extra,
});
const dismissal = (key: string, value: string, until: string | null = null): DashboardDismissal => ({ key, value, until, at: new Date(0).toISOString() });

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
    expect(changed.stale).toEqual(["reviews.unanswered"]);

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
    expect(ended.stale).toEqual(["clickGuard.suspicious30d"]);
    // A snooze ends early when the number changes.
    expect(splitAttention([item("clickGuard.suspicious30d", 18)], [dismissal("clickGuard.suspicious30d", "17", until)], now).attention).toHaveLength(1);
  });

  it("an ended snooze for an item that is gone is stale; a Done for a gone item is kept", () => {
    const past = new Date(now.getTime() - 1).toISOString();
    const r = splitAttention([], [dismissal("a.b", "1", past), dismissal("c.d", "2")], now);
    expect(r.stale).toEqual(["a.b"]);
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

  it("applies the saved order and visibility, and never computes a hidden tile", async () => {
    const layout = normalizeDashboardLayout({
      order: ["siteScan", ...DASHBOARD_TILE_KEYS.filter((k) => k !== "siteScan")],
      hidden: ["reviews", "cloudflare", "callAssistant"],
      keepGroups: false,
      sections: { recent: false },
    });
    await saveDashboardLayout(s.agency, layout);
    expect(await readDashboardLayout(s.agency)).toEqual(layout);

    const called: DashboardTileKey[] = [];
    const spy = (key: DashboardTileKey): TileSources => ({ [key]: async () => { called.push(key); return { status: "ok", metrics: [] }; } });
    const { payload: p } = await buildDashboard(s.agency, { log: quiet, sources: { ...spy("reviews"), ...spy("siteScan") } });
    expect(p.layout).toEqual(layout);
    expect(p.tiles.map((t) => t.key)).toEqual(layout.order.filter((k) => !layout.hidden.includes(k)));
    expect(p.tiles[0].key).toBe("siteScan");
    expect(called).toEqual(["siteScan"]); // the hidden Google Reviews source never ran
    // Hidden tiles: access only. The agency plan includes Cloudflare and Reviews; the Call Assistant is not sold yet.
    expect(p.hiddenTiles).toEqual(expect.arrayContaining([
      { key: "reviews", entitled: true },
      { key: "cloudflare", entitled: true },
      expect.objectContaining({ key: "callAssistant", comingSoon: true }),
    ]));
    // Their alerts leave Needs you today; a hidden section is not read.
    expect(p.attention.some((i) => i.key.startsWith("reviews."))).toBe(false);
    expect(p.recent).toEqual([]);
  });

  it("a locked tile stays locked whether it is shown or hidden", async () => {
    await saveDashboardLayout(s.starter, normalizeDashboardLayout({ hidden: ["cloudflare"] }));
    const hidden = (await buildDashboard(s.starter, { log: quiet })).payload;
    expect(hidden.hiddenTiles).toEqual([{ key: "cloudflare", entitled: false, requiredPlan: "agency" }]);
    await resetDashboardLayout(s.starter);
    const shown = (await buildDashboard(s.starter, { log: quiet })).payload;
    expect(shown.tiles.find((t) => t.key === "cloudflare")).toMatchObject({ status: "locked", entitled: false, metrics: [] });
    expect(shown.hiddenTiles).toEqual([]);
    expect(isDefaultDashboardLayout(shown.layout)).toBe(true);
  });

  it("one user's layout and cleared items never apply to another", async () => {
    await saveDashboardLayout(s.other, normalizeDashboardLayout({ hidden: ["gbp", "reviews"], keepGroups: false }));
    await saveDashboardDismissals(s.other, [{ key: "notifications", value: "1", until: null }]);
    const mine = (await buildDashboard(s.none, { log: quiet })).payload;
    expect(isDefaultDashboardLayout(mine.layout)).toBe(true);
    expect(mine.tiles.map((t) => t.key)).toEqual([...DASHBOARD_TILE_KEYS]);
    expect(await readDashboardDismissals(s.none)).toEqual([]);
    expect((await readDashboardDismissals(s.other)).map((d) => d.key)).toEqual(["notifications"]);
  });

  it("stores dismissals per key (upsert), drops ended snoozes, restores one or all", async () => {
    const u = s.teammate;
    const soon = new Date(Date.now() + 3_600_000).toISOString();
    await saveDashboardDismissals(u, [{ key: "a.one", value: "1", until: null }, { key: "b.two", value: "2", until: soon }]);
    await saveDashboardDismissals(u, [{ key: "a.one", value: "5", until: null }]);
    const rows = await readDashboardDismissals(u);
    expect(rows.find((d) => d.key === "a.one")).toMatchObject({ value: "5", until: null });
    expect(rows.find((d) => d.key === "b.two")?.until).toBe(soon);
    await pool.query("UPDATE dashboard_dismissals SET snoozed_until = now() - interval '1 minute' WHERE user_id=$1 AND item_key='b.two'", [u]);
    await saveDashboardDismissals(u, [{ key: "c.three", value: "3", until: null }]);
    expect((await readDashboardDismissals(u)).map((d) => d.key).sort()).toEqual(["a.one", "c.three"]);
    expect(await deleteDashboardDismissals(u, ["a.one"])).toBe(1);
    expect(await deleteDashboardDismissals(u, null)).toBe(1);
    expect(await readDashboardDismissals(u)).toEqual([]);
  });

  it("keeps at most 100 cleared items per user (the oldest go)", async () => {
    const u = s.teammate;
    for (let batch = 0; batch < 3; batch++) {
      await saveDashboardDismissals(u, Array.from({ length: 40 }, (_, i) => ({ key: `k${batch}.${i}`, value: "1", until: null })));
    }
    const rows = await readDashboardDismissals(u);
    expect(rows).toHaveLength(100);
    expect(rows.some((d) => d.key === "k2.39")).toBe(true);
    await deleteDashboardDismissals(u, null);
  });
});
