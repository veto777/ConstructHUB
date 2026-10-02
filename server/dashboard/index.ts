/**
 * GET /api/dashboard — the signed-in home dashboard (docs/dashboard/SPEC.md).
 *
 *   auth (session; 401 when signed out) → 60 s per-user cache → buildDashboard → json
 *
 * The route is registered before the agency access middleware and is not on
 * its delegation list, so the numbers are always the signed-in actor's own —
 * an agency teammate never sees the workspace owner's dashboard.
 *
 * ?fresh=1 (the Refresh button) skips the cache at most once every 10 s per
 * user. ?fixture=full|new|noplan answers the skeleton's SAMPLE payload
 * (`fixture: true`) for client-shape tests — development only, never in
 * production.
 */
import type { Express, Request, Response } from "express";
import type { DashboardPayload } from "@shared/dashboard";
import { buildDashboardFixture, DASHBOARD_FIXTURE_SCENARIOS, type DashboardFixtureScenario } from "./fixture";
import { buildDashboard, type BuiltDashboard } from "./aggregate";
import { createDashboardCache } from "./cache";

type GetUser = (req: Request, res: Response) => { id: number; displayName?: string | null } | null;

export const dashboardCache = createDashboardCache();
/** One build per cache key at a time: concurrent loads share it. */
const inflight = new Map<string, Promise<BuiltDashboard>>();

export function registerDashboardRoutes(app: Express, getUser: GetUser): void {
  app.get("/api/dashboard", async (req, res) => {
    const user = getUser(req, res);
    if (!user) return;
    // Per-account numbers: never stored by a shared cache or the browser.
    res.setHeader("Cache-Control", "private, no-store");

    const asked = req.query.fixture;
    if (asked !== undefined && process.env.NODE_ENV !== "production") {
      const scenario = DASHBOARD_FIXTURE_SCENARIOS.includes(String(asked) as DashboardFixtureScenario) ? String(asked) as DashboardFixtureScenario : "full";
      return void res.json(buildDashboardFixture(scenario, { displayName: user.displayName }));
    }

    const activeOrgId: string | null = (req as any).session?.activeOrgId ?? null;
    const fresh = req.query.fresh === "1" || req.query.fresh === "true";
    if (!fresh || !dashboardCache.allowFresh(user.id)) {
      const hit = dashboardCache.get(user.id, activeOrgId);
      if (hit) return void res.json({ ...hit, cached: true } satisfies DashboardPayload);
    }

    const key = dashboardCache.keyOf(user.id, activeOrgId);
    try {
      let build = inflight.get(key);
      if (!build) {
        build = buildDashboard(user.id, { activeOrgId }).finally(() => inflight.delete(key));
        inflight.set(key, build);
      }
      const built = await build;
      if (built.cacheable) dashboardCache.set(user.id, activeOrgId, built.payload);
      res.json(built.payload);
    } catch (err) {
      console.error("[dashboard] build failed:", err instanceof Error ? err.message : err);
      if (!res.headersSent) res.status(500).json({ message: "Could not load your dashboard. Please try again." });
    }
  });
}
