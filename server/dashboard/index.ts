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
 * ?fresh=1 (the Refresh button) skips the cache at most once every 10 s per
 * user. ?fixture=full|new|noplan answers the skeleton's SAMPLE payload
 * (`fixture: true`) for client-shape tests — development only, never in
 * production.
 */
import type { Express, Request, Response } from "express";
import type { DashboardPayload } from "@shared/dashboard";
import { buildDashboardFixture, DASHBOARD_FIXTURE_SCENARIOS, type DashboardFixtureScenario } from "./fixture";
import { buildDashboard, type BuiltDashboard } from "./aggregate";
import { dashboardCache } from "./cache";
import { requestAccess } from "../agency/routes";
import { dq } from "./pool";

type GetUser = (req: Request, res: Response) => { id: number; displayName?: string | null } | null;

export { dashboardCache };
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
    const workspace = await agencyWorkspace(req, user.id);
    // The pinned org and the agency workspace both change the answer: each is its own entry.
    const scope = workspace ? `${activeOrgId ?? "-"}@${workspace.ownerId}` : activeOrgId;
    const fresh = req.query.fresh === "1" || req.query.fresh === "true";
    if (!fresh || !dashboardCache.allowFresh(user.id)) {
      const hit = dashboardCache.get(user.id, scope);
      if (hit) return void res.json({ ...hit, cached: true } satisfies DashboardPayload);
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
      res.json(built.payload);
    } catch (err) {
      console.error("[dashboard] build failed:", err instanceof Error ? err.message : err);
      if (!res.headersSent) res.status(500).json({ message: "Could not load your dashboard. Please try again." });
    }
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
