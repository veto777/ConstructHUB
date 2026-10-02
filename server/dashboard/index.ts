/**
 * GET /api/dashboard — the signed-in home dashboard (docs/dashboard/SPEC.md).
 *
 *   auth (session; 401 when signed out) → 60 s per-user cache → buildDashboard → json
 *
 * The route is registered before the agency access middleware and is not on
 * its delegation list, so the numbers are always the signed-in actor's own —
 * an agency teammate never sees the workspace owner's dashboard. A verified
 * delegation (requestAccess) only turns the pages the owner shares with them
 * from "locked" into an "Open" link (aggregate.ts → DELEGATED_TILES).
 *
 * Per-user preferences (prefs.ts, shared/dashboard-prefs.ts), all session
 * routes scoped to the signed-in user; the writes need JSON and an Origin that
 * is one of our hosts (the same rule as the Hub's POSTs):
 *   PUT    /api/dashboard/layout                 save tile order/visibility, sections, grouping
 *   DELETE /api/dashboard/layout                 back to the default
 *   PUT    /api/dashboard/dismissals             clear or snooze "Needs you today" items
 *   DELETE /api/dashboard/dismissals[/:key]      restore one, or every cleared item
 * A layout change forgets the user's cached dashboard (hidden tiles are not
 * computed, so the build itself changes). Cleared items are applied to every
 * answer, cached or not, from a fresh read: clearing never waits on the cache.
 *
 * ?fresh=1 (the Refresh button) skips the cache at most once every 10 s per
 * user. ?fixture=full|new|noplan answers the skeleton's SAMPLE payload
 * (`fixture: true`) for client-shape tests — development only, never in
 * production.
 */
import type { Express, Request, Response } from "express";
import type { DashboardPayload } from "@shared/dashboard";
import {
  DASHBOARD_DISMISS_KEY_RE, defaultDashboardLayout, isDefaultDashboardLayout,
  parseDashboardLayoutInput, parseDismissInput, splitAttention,
} from "@shared/dashboard-prefs";
import { applyLayoutToFixture, buildDashboardFixture, DASHBOARD_FIXTURE_SCENARIOS, type DashboardFixtureScenario } from "./fixture";
import { buildDashboard, type BuiltDashboard } from "./aggregate";
import { dashboardCache, forgetDashboard } from "./cache";
import { requestAccess } from "../agency/routes";
import { originOk } from "../hub/access";
import { dq } from "./pool";
import {
  deleteDashboardDismissals, readDashboardDismissals, readDashboardLayout, resetDashboardLayout,
  saveDashboardDismissals, saveDashboardLayout,
} from "./prefs";

type GetUser = (req: Request, res: Response) => { id: number; displayName?: string | null } | null;

export { dashboardCache };
/** One build per cache key at a time: concurrent loads share it. */
const inflight = new Map<string, Promise<BuiltDashboard>>();

/** A saved layout: drop the cached answers and any build that started under the old one. */
function forgetLayout(userId: number): void {
  forgetDashboard(userId);
  const prefix = `${userId}:`;
  for (const key of Array.from(inflight.keys())) if (key.startsWith(prefix)) inflight.delete(key);
}

/**
 * The answer as this user sees it now: the cleared/snoozed items taken out of
 * "Needs you today" (read fresh, so the cache never shows a cleared item).
 * Dismissals that no longer hold (the value changed, the snooze ended) are forgotten.
 */
async function withDismissals(userId: number, payload: DashboardPayload): Promise<DashboardPayload> {
  const now = new Date();
  const { attention, cleared, stale } = splitAttention(payload.attention, await readDashboardDismissals(userId), now);
  if (stale.length) {
    deleteDashboardDismissals(userId, stale).catch((err) => console.error("[dashboard] dismissal cleanup failed:", err instanceof Error ? err.message : err));
  }
  return { ...payload, attention, cleared };
}

/** State-changing requests: our own pages only (Origin), JSON bodies where there is one. */
function writeGuard(req: Request, res: Response, body: boolean): boolean {
  if (body && !req.is("application/json")) { res.status(415).json({ message: "Send JSON." }); return false; }
  if (!originOk(req)) { res.status(403).json({ message: "Forbidden" }); return false; }
  return true;
}

const failed = (res: Response, what: string) => (err: unknown) => {
  console.error(`[dashboard] ${what} failed:`, err instanceof Error ? err.message : err);
  if (!res.headersSent) res.status(500).json({ message: "Could not save that. Please try again." });
};

export function registerDashboardRoutes(app: Express, getUser: GetUser): void {
  app.get("/api/dashboard", async (req, res) => {
    const user = getUser(req, res);
    if (!user) return;
    // Per-account numbers: never stored by a shared cache or the browser.
    res.setHeader("Cache-Control", "private, no-store");

    const asked = req.query.fixture;
    if (asked !== undefined && process.env.NODE_ENV !== "production") {
      const scenario = DASHBOARD_FIXTURE_SCENARIOS.includes(String(asked) as DashboardFixtureScenario) ? String(asked) as DashboardFixtureScenario : "full";
      const sample = applyLayoutToFixture(buildDashboardFixture(scenario, { displayName: user.displayName }), await readDashboardLayout(user.id));
      return void res.json(await withDismissals(user.id, sample));
    }

    const activeOrgId: string | null = (req as any).session?.activeOrgId ?? null;
    const workspace = await agencyWorkspace(req, user.id);
    // The pinned org and the agency workspace both change the answer: each is its own entry.
    const scope = workspace ? `${activeOrgId ?? "-"}@${workspace.ownerId}` : activeOrgId;
    const fresh = req.query.fresh === "1" || req.query.fresh === "true";
    if (!fresh || !dashboardCache.allowFresh(user.id)) {
      const hit = dashboardCache.get(user.id, scope);
      if (hit) return void res.json(await withDismissals(user.id, { ...hit, cached: true } satisfies DashboardPayload));
    }

    const key = dashboardCache.keyOf(user.id, scope);
    try {
      let build = inflight.get(key);
      if (!build) {
        build = buildDashboard(user.id, { activeOrgId, workspace }).finally(() => inflight.delete(key));
        inflight.set(key, build);
      }
      const built = await build;
      if (built.cacheable) dashboardCache.set(user.id, scope, built.payload);
      res.json(await withDismissals(user.id, built.payload));
    } catch (err) {
      console.error("[dashboard] build failed:", err instanceof Error ? err.message : err);
      if (!res.headersSent) res.status(500).json({ message: "Could not load your dashboard. Please try again." });
    }
  });

  // ── Layout ──────────────────────────────────────────────────────────────
  app.put("/api/dashboard/layout", async (req, res) => {
    const user = getUser(req, res);
    if (!user) return;
    if (!writeGuard(req, res, true)) return;
    const parsed = parseDashboardLayoutInput(req.body?.layout);
    if (!parsed.ok) return void res.status(400).json({ message: parsed.message });
    try {
      // The default layout is stored as no row at all.
      if (isDefaultDashboardLayout(parsed.layout)) await resetDashboardLayout(user.id);
      else await saveDashboardLayout(user.id, parsed.layout);
      forgetLayout(user.id);
      res.json({ layout: parsed.layout });
    } catch (err) { failed(res, "layout save")(err); }
  });

  app.delete("/api/dashboard/layout", async (req, res) => {
    const user = getUser(req, res);
    if (!user) return;
    if (!writeGuard(req, res, false)) return;
    try {
      await resetDashboardLayout(user.id);
      forgetLayout(user.id);
      res.json({ layout: defaultDashboardLayout() });
    } catch (err) { failed(res, "layout reset")(err); }
  });

  // ── Cleared / snoozed "Needs you today" items ───────────────────────────
  app.put("/api/dashboard/dismissals", async (req, res) => {
    const user = getUser(req, res);
    if (!user) return;
    if (!writeGuard(req, res, true)) return;
    const parsed = parseDismissInput(req.body, new Date());
    if (!parsed.ok) return void res.status(400).json({ message: parsed.message });
    try {
      await saveDashboardDismissals(user.id, parsed.items);
      res.json({ ok: true, cleared: parsed.items.length });
    } catch (err) { failed(res, "dismissal save")(err); }
  });

  app.delete("/api/dashboard/dismissals", async (req, res) => {
    const user = getUser(req, res);
    if (!user) return;
    if (!writeGuard(req, res, false)) return;
    try {
      res.json({ ok: true, restored: await deleteDashboardDismissals(user.id, null) });
    } catch (err) { failed(res, "dismissal restore")(err); }
  });

  app.delete("/api/dashboard/dismissals/:key", async (req, res) => {
    const user = getUser(req, res);
    if (!user) return;
    if (!writeGuard(req, res, false)) return;
    const key = String(req.params.key);
    if (!DASHBOARD_DISMISS_KEY_RE.test(key)) return void res.status(400).json({ message: "Unknown item." });
    try {
      res.json({ ok: true, restored: await deleteDashboardDismissals(user.id, [key]) });
    } catch (err) { failed(res, "dismissal restore")(err); }
  });
}

/**
 * The agency workspace this session works in, only when the agency access
 * rules still grant it (requestAccess drops a stale delegation). Never throws:
 * a failed check is "no workspace", the teammate's plain dashboard.
 */
async function agencyWorkspace(req: Request, userId: number): Promise<{ ownerId: number; ownerName: string | null } | null> {
  const owner = (req as any).session?.agencyOwner;
  if (!owner || owner === userId) return null;
  try {
    const a = await requestAccess(req);
    if (a.owner === a.actor) return null;
    const [u] = await dq<{ display_name: string | null }>("SELECT display_name FROM users WHERE id=$1", [a.owner]);
    return { ownerId: a.owner, ownerName: u?.display_name?.trim() || null };
  } catch {
    return null;
  }
}
