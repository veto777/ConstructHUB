/**
 * GET /api/dashboard — the signed-in home dashboard (docs/dashboard/SPEC.md).
 *
 * SKELETON: answers a SAMPLE payload (`fixture: true`) so the frontend lane can
 * build against the contract in shared/dashboard.ts today. The backend lane
 * replaces `answer` with the real per-user aggregator (Promise.allSettled,
 * 3 s per tile, 60 s per-user cache) and drops the ?fixture= switch.
 */
import type { Express, Request, Response } from "express";
import { buildDashboardFixture, DASHBOARD_FIXTURE_SCENARIOS, type DashboardFixtureScenario } from "./fixture";

type GetUser = (req: Request, res: Response) => { id: number; displayName?: string | null } | null;

export function registerDashboardRoutes(app: Express, getUser: GetUser): void {
  app.get("/api/dashboard", (req, res) => {
    // Session auth: 401 "Not authenticated" when signed out.
    const user = getUser(req, res);
    if (!user) return;
    const asked = String(req.query.fixture ?? "full") as DashboardFixtureScenario;
    const scenario = DASHBOARD_FIXTURE_SCENARIOS.includes(asked) ? asked : "full";
    // Per-account numbers: never stored by a shared cache or the browser.
    res.setHeader("Cache-Control", "private, no-store");
    res.json(buildDashboardFixture(scenario, { displayName: user.displayName }));
  });
}
