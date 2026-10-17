/**
 * The API paywall (server/platform-access.ts).
 *
 *   1. Pure: the decision (hasPlatformAccess / ownPlatformAccess) and the allow-list (isOpenWithoutPlan).
 *   2. The real middleware in-process on a throwaway express app: stub handlers stand in for the feature and
 *      allow-listed routes, a header stands in for the session user, and the entitlements, CRM and agency lookups
 *      are mocked. No dev server or database: this proves the gate, not the routers behind it.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

const mocks = vi.hoisted(() => ({
  ent: new Map<number, any>(),
  crm: new Set<number>(),
  seats: new Map<number, number[]>(),
  teamOwners: new Set<number>(),
  entCalls: 0,
}));
vi.mock("./db", () => ({
  pool: { query: vi.fn(async (_text: string, params: unknown[]) => ({ rows: (mocks.seats.get(Number(params[0])) ?? []).map((user_id) => ({ user_id })) })) },
  db: {},
}));
vi.mock("./entitlements", () => ({
  getEntitlements: vi.fn(async (id: number) => { mocks.entCalls++; return mocks.ent.get(id) ?? noPlan(); }),
  sendPlanRequired: (res: any, requiredPlan: string, what: string, extra: Record<string, unknown> = {}) =>
    res.status(402).json({ code: "plan_required", requiredPlan, message: `${what} needs a plan.`, ...extra }),
}));
vi.mock("./crm/entitlements", () => ({ getCrmEntitlements: vi.fn(async (id: number) => ({ active: mocks.crm.has(id) })) }));
vi.mock("./agency/access", () => ({ teamEntitled: vi.fn(async (owner: number) => mocks.teamOwners.has(owner)) }));

import {
  hasPlatformAccess, ownPlatformAccess, isOpenWithoutPlan, platformAccessGate, requirePlatformAccess, forgetPlatformAccess,
  OPEN_WITHOUT_PLAN, type PlatformAccessEntitlements,
} from "./platform-access";

function noPlan(over: Partial<PlatformAccessEntitlements> = {}): PlatformAccessEntitlements {
  return {
    isPlatformAdmin: false, plan: null, accessPlan: null, subscriptionStatus: null,
    alacarte: { active: [], paused: [] } as any,
    addonModules: { callAssistant: false } as any, addonModulesPaused: { callAssistant: false } as any,
    ...over,
  };
}

// Feature routes a no-plan session must not reach (a sample across the app).
const FEATURE_PATHS = [
  "/api/search/results", "/api/search", "/api/search-results/recent", "/api/lsa/leads", "/api/lsa/status",
  "/api/directories/directories", "/api/yelp/search", "/api/yelp/businesses", "/api/locations", "/api/dashboard",
  "/api/social", "/api/seo/keywords", "/api/sitescan", "/api/sitescan/jobs/abc", "/api/press/outlets", "/api/press/overview",
  "/api/databases", "/api/databases/county/12", "/api/counties", "/api/permits/map", "/api/photos/business-search",
  "/api/media/geocode", "/api/gmb/review-response", "/api/ranking-grid/scans", "/api/competitors/scans", "/api/click-guard/domains",
  "/api/contracts/create", "/api/contracts/user/list", "/api/reviews/list", "/api/review-templates", "/api/agency/clients",
  "/api/social/native/upload/abc", "/api/social/native/instagram/callback", "/api/gbp/status", "/api/ads/status",
  "/api/property-records/3", "/api/research-reports/orders", "/api/beta-codes", "/api/admin/users",
  // Express routes ignore case and a trailing slash; so does the gate.
  "/api/SEARCH/results", "/api/search/results/", "/api/Locations",
];
// Paths a no-plan session keeps: signing in, buying, the account, help, public links.
const OPEN_PATHS = [
  "/api/entitlements", "/api/auth/me", "/api/auth/logout", "/api/auth/2fa/setup", "/api/Auth/Me", "/api/stripe/create-checkout",
  "/api/stripe/webhook", "/api/alacarte/me", "/api/call-assistant/billing/plans", "/api/billing/invoices", "/api/pricing/founding-offer",
  "/api/crm/billing/subscription", "/api/crm/me", "/api/agency/me", "/api/agency/workspace", "/api/beta-codes/redeem",
  "/api/account/delete", "/api/account/ui-prefs", "/api/notifications", "/api/hub/chat", "/api/issues/report", "/api/ops/client-error",
  "/api/databases/counts", "/api/review/abc123/click", "/api/contracts/abc123", "/api/contracts/abc123/sign", "/api/public/estimates/x",
  "/api/jc/tok", "/api/sitescan/public/start", "/api/sitescan/shared/tok", "/api/course-catalog", "/api/master-class/lessons/1",
  "/api/state-guides/FL", "/api/social/native/data-deletion/status", "/api/v1/me", "/api/click-guard/track",
];

describe("the decision", () => {
  it("no plan, no item, no CRM, no seat: no access", () => {
    expect(ownPlatformAccess(noPlan())).toBe(false);
    expect(hasPlatformAccess({ ent: noPlan(), crmActive: false, agencySeat: false })).toBe(false);
  });
  it("each thing the client counts gives access", () => {
    expect(ownPlatformAccess(noPlan({ isPlatformAdmin: true }))).toBe(true);
    expect(ownPlatformAccess(noPlan({ plan: "starter", accessPlan: "starter" }))).toBe(true);
    expect(ownPlatformAccess(noPlan({ subscriptionStatus: "past_due" }))).toBe(true);
    expect(ownPlatformAccess(noPlan({ alacarte: { active: [{ key: "siteScan" }], paused: [] } as any }))).toBe(true);
    expect(ownPlatformAccess(noPlan({ addonModules: { callAssistant: true } as any }))).toBe(true);
    expect(ownPlatformAccess(noPlan({ addonModulesPaused: { callAssistant: true } as any }))).toBe(true);
    expect(hasPlatformAccess({ ent: noPlan(), crmActive: true, agencySeat: false })).toBe(true);
    expect(hasPlatformAccess({ ent: noPlan(), crmActive: false, agencySeat: true })).toBe(true);
  });
  it("an ended subscription is no access", () => {
    expect(ownPlatformAccess(noPlan({ subscriptionStatus: "canceled" }))).toBe(false);
  });
});

describe("the allow-list", () => {
  it("keeps sign-in, buying, account, help and public links open", () => {
    for (const p of OPEN_PATHS) expect(isOpenWithoutPlan(p), p).toBe(true);
  });
  it("closes the tools", () => {
    for (const p of FEATURE_PATHS) expect(isOpenWithoutPlan(p), p).toBe(false);
  });
  it("matches whole segments only and leaves non-API paths alone", () => {
    expect(isOpenWithoutPlan("/api/reviews")).toBe(false);
    expect(isOpenWithoutPlan("/api/review-templates")).toBe(false);
    expect(isOpenWithoutPlan("/api/authx")).toBe(false);
    expect(isOpenWithoutPlan("/api/databases/countsx")).toBe(false);
    expect(isOpenWithoutPlan("/pricing")).toBe(true);
    for (const p of OPEN_WITHOUT_PLAN) expect(p, p).toMatch(/^\/api\/[a-z0-9./_-]+$/);
  });
});

describe("the middleware", () => {
  let server: Server;
  let base = "";
  beforeAll(async () => {
    const app = express();
    app.use((req, _res, next) => { const id = Number(req.get("x-test-user")); if (id) (req as any).user = { id }; next(); });
    app.use(platformAccessGate);
    app.use(["/api/photos", "/api/media/geocode"], requirePlatformAccess);
    app.use((req, res) => res.json({ ok: true, path: req.path }));
    server = app.listen(0);
    await new Promise((r) => server.once("listening", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));
  beforeEach(() => {
    mocks.ent.clear(); mocks.crm.clear(); mocks.seats.clear(); mocks.teamOwners.clear(); mocks.entCalls = 0;
    forgetPlatformAccess();
  });
  const get = (path: string, user?: number) => fetch(base + path, { headers: user ? { "x-test-user": String(user) } : {} });

  it("a no-plan session gets the plan_required 402 on feature routes", async () => {
    for (const p of ["/api/search/results", "/api/lsa/leads", "/api/directories/directories", "/api/yelp/search", "/api/databases"]) {
      const r = await get(p, 7);
      expect(r.status, p).toBe(402);
      const body = await r.json();
      expect(body.code).toBe("plan_required");
      expect(body.href).toBe("/pricing");
    }
  });
  it("a no-plan session keeps the allow-listed routes", async () => {
    for (const p of ["/api/entitlements", "/api/auth/me", "/api/stripe/create-checkout", "/api/crm/billing/subscription", "/api/agency/me", "/api/databases/counts"]) {
      expect((await get(p, 7)).status, p).toBe(200);
    }
  });
  it("a plan holder, a past-due owner, a CRM customer and a team seat pass", async () => {
    mocks.ent.set(8, noPlan({ plan: "pro", accessPlan: "pro", subscriptionStatus: "trialing" }));
    mocks.ent.set(9, noPlan({ subscriptionStatus: "past_due" }));
    mocks.crm.add(10);
    mocks.seats.set(11, [8]); mocks.teamOwners.add(8);
    for (const u of [8, 9, 10, 11]) expect((await get("/api/search/results", u)).status, String(u)).toBe(200);
    // A seat whose owner's plan no longer includes the team is no access.
    mocks.seats.set(12, [99]);
    expect((await get("/api/search/results", 12)).status).toBe(402);
  });
  it("leaves signed-out requests to the route, except the formerly public tools, which need a session", async () => {
    expect((await get("/api/search/results")).status).toBe(200);
    expect((await get("/api/photos/business-search")).status).toBe(401);
    expect((await get("/api/photos/business-search", 7)).status).toBe(402);
    mocks.ent.set(8, noPlan({ plan: "pro", accessPlan: "pro" }));
    expect((await get("/api/photos/business-search", 8)).status).toBe(200);
  });
  it("caches the answer and forgets it on request", async () => {
    await get("/api/search/results", 7);
    await get("/api/lsa/leads", 7);
    expect(mocks.entCalls).toBe(1);
    mocks.ent.set(7, noPlan({ plan: "starter", accessPlan: "starter" }));
    expect((await get("/api/search/results", 7)).status).toBe(402);
    forgetPlatformAccess(7);
    expect((await get("/api/search/results", 7)).status).toBe(200);
  });
});
