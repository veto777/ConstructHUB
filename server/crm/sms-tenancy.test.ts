import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { PLANS } from "@shared/plans";
const state = vi.hoisted(() => ({ rows: [] as any[], inserts: [] as any[], ent: {} as any,
  crm: { active: false }, authorize: vi.fn(async () => true) }));
vi.mock("../db", () => ({ pool: {}, db: {
  select: () => ({ from: () => ({ where: () => {
    const result = { limit: async () => state.rows.shift() ?? [], orderBy: () => result };
    return result;
  } }) }),
  insert: () => ({ values: (value: any) => ({ returning: async () => {
    state.inserts.push(value);
    return [{ id: "new", ...value }];
  } }) }),
} }));
vi.mock("../entitlements", async original => ({ ...await original<typeof import("../entitlements")>(), getEntitlements: vi.fn(async () => state.ent) }));
vi.mock("./entitlements", () => ({ getCrmEntitlements: vi.fn(async () => state.crm), crmPlanRequiredBody: () => ({ code: "crm_plan_required" }) }));
vi.mock("./object-access", () => ({ authorizeObjectRequest: state.authorize }));
import { requireOrg, requireSmsOrg, requirePermission } from "./tenancy";
import { getEntitlements } from "../entitlements";
const org = { id: "org", ownerUserId: 7 };
function membership(role = "owner") { state.rows.push([{ orgId: "org", role, permissions: null }], [org]); }
function response() { const res: any = { status: vi.fn(() => res), json: vi.fn(() => res) }; return res; }
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("CRM_REQUIRE_PLAN", "1");
  state.rows = []; state.inserts = [];
  state.crm = { active: false };
  state.ent = { allowances: null, addons: {} };
  state.authorize.mockResolvedValue(true);
});
afterEach(() => vi.unstubAllEnvs());
describe("platform SMS setup without CRM", () => {
  it.each(["growth", "agency", "starter"] as const)("allows %s and creates the normal owner org", async plan => {
    state.ent = { allowances: PLANS[plan].limits, addons: { texting_number: plan === "starter" ? 1 : 0 } };
    state.rows.push([], [{ email: "owner@example.test", companyName: "Builder" }]);
    const ctx = await requireSmsOrg({ path: "/api/crm/sms/sender" }, response(), 7);
    expect(ctx?.org.ownerUserId).toBe(7);
    expect(ctx?.member.role).toBe("owner");
    expect(state.inserts).toHaveLength(2);
    membership();
    const res = response();
    expect(await requireOrg({ path: "/api/crm/customers" }, res, 7)).toBeNull();
    expect(res.status).toHaveBeenCalledWith(402);
  });
  it("checks the org owner's entitlement and retains permissions for members", async () => {
    membership("field");
    state.ent = { allowances: PLANS.growth.limits, addons: {} };
    const res = response();
    const ctx = await requireSmsOrg({ session: { activeOrgId: "org" } }, res, 99);
    expect(getEntitlements).toHaveBeenCalledWith(7);
    expect(requirePermission(res, ctx!, "manageIntegrations")).toBe(false);
    expect(res.status).toHaveBeenCalledWith(403);
  });
  it("rejects object-access failure", async () => {
    membership(); state.authorize.mockResolvedValue(false);
    expect(await requireSmsOrg({}, response(), 7)).toBeNull();
    expect(getEntitlements).not.toHaveBeenCalled();
  });
  it("removes revoked pins and resolves only active memberships", async () => {
    state.rows.push([]); membership();
    state.crm.active = true;
    const req = { session: { activeOrgId: "revoked" } };
    expect((await requireSmsOrg(req, response(), 7))?.org.id).toBe("org");
    expect(req.session.activeOrgId).toBeUndefined();
  });
  it("denies accounts with neither subscription and retains CRM-only access", async () => {
    membership(); const res = response();
    expect(await requireSmsOrg({ path: "/api/crm/sms/sender" }, res, 7)).toBeNull();
    expect(res.status).toHaveBeenCalledWith(402);
    membership(); state.crm.active = true;
    expect(await requireSmsOrg({}, response(), 7)).not.toBeNull();
  });
});
