import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ row: undefined as any, locations: 0, used: undefined as number | undefined, take: vi.fn(), refunds: [] as any[] }));
vi.mock("./db", () => ({
  pool: {
    query: vi.fn(async (text: string, values: any[]) => {
      if (/FROM users u/.test(text)) return { rows: mocks.row ? [mocks.row] : [] };
      if (/FROM business_locations/.test(text)) return { rows: [{ n: mocks.locations }] };
      if (/UPDATE growth_budgets/.test(text)) { mocks.refunds.push(values); return { rows: [] }; }
      if (/SELECT used FROM growth_budgets/.test(text)) return { rows: mocks.used === undefined ? [] : [{ used: mocks.used }] };
      return { rows: [] };
    }),
  },
  db: {},
}));
vi.mock("./growth-limits", () => ({ takeBudget: mocks.take }));
import { gridCreditCost, monthlyLimit, reserveMonthlyQuota, reserveQuotaFor, refundQuota, quotaKey, monthKey } from "./growth-quotas";
import { getEntitlements } from "./entitlements";
import { PLANS, PLAN_KEYS } from "@shared/plans";

const plan = (key: string | null, extra: Record<string, unknown> = {}) =>
  ({ email: "owner@example.invalid", plan: key, status: key ? "active" : null, stripe_subscription_id: key ? "sub_fixture" : null, ...extra });
const res = () => { const r: any = { locals: {}, status: vi.fn(() => r), json: vi.fn(() => r) }; return r; };
const req = (id?: number) => ({ user: id ? { id } : undefined }) as any;

beforeEach(() => { mocks.row = undefined; mocks.locations = 0; mocks.used = undefined; mocks.take.mockReset(); mocks.refunds = []; });

describe("monthly allowances come from shared/plans.ts", () => {
  it("weights ranking-grid credits by grid size", () => {
    expect([3, 5, 7, 9, 11, 13, 15].map(gridCreditCost)).toEqual([1, 1, 2, 4, 5, 7, 9]);
  });

  it("reads each plan's limits, per-location Agency allowances and competitor packs", async () => {
    mocks.row = plan("starter");
    const starter = await getEntitlements(1);
    expect(monthlyLimit(starter, "searches")).toBe(100);
    expect(monthlyLimit(starter, "rankings")).toBe(5);
    expect(monthlyLimit(starter, "siteScans")).toBe(2);
    expect(monthlyLimit(starter, "competitorScans")).toBe(0);
    expect(monthlyLimit(starter, "photos")).toBe(-1);

    mocks.row = plan("gold", { addons: { competitor_pack: 2 } });
    const growth = await getEntitlements(1);
    expect(monthlyLimit(growth, "searches")).toBe(5000);
    expect(monthlyLimit(growth, "competitorScans")).toBe(28);

    mocks.row = plan("agency");
    const agency = await getEntitlements(1);
    // Agency is billed for at least its 10 included locations.
    expect(monthlyLimit(agency, "rankings", 3)).toBe(20);
    expect(monthlyLimit(agency, "siteScans", 3)).toBe(10);
    expect(monthlyLimit(agency, "rankings", 25)).toBe(50);
    expect(monthlyLimit(agency, "siteScans", 25)).toBe(25);

    mocks.row = undefined;
    expect(monthlyLimit(await getEntitlements(1), "searches")).toBe(0);
  });

  it("meters texts by the plan's teamTextSegments; the texting number add-on raises nothing", async () => {
    for (const key of PLAN_KEYS) {
      mocks.row = plan(key, { addons: { texting_number: 1 } });
      expect(monthlyLimit(await getEntitlements(1), "texts")).toBe(PLANS[key].limits.teamTextSegments);
    }
    mocks.row = plan("premium"); // legacy -> Pro
    expect(monthlyLimit(await getEntitlements(1), "texts")).toBe(PLANS.pro.limits.teamTextSegments);

    mocks.row = plan("starter");
    const none = await reserveQuotaFor(42, "texts", 1);
    expect(none.ok).toBe(false);
    expect(!none.ok && none.body).toMatchObject({ code: "plan_required", requiredPlan: "pro" });
    expect(mocks.take).not.toHaveBeenCalled();

    mocks.row = plan("pro");
    mocks.take.mockResolvedValue(false);
    mocks.used = 500;
    const spent = await reserveQuotaFor(42, "texts", 2);
    expect(mocks.take.mock.calls[0].slice(0, 3)).toEqual([`quota:user:42:texts:${monthKey()}`, 500, 2]);
    expect(!spent.ok && spent.status).toBe(403);
    expect(!spent.ok && spent.body).toMatchObject({
      code: "limit_reached", feature: "texts", limit: 500, used: 500, upgradePlan: "growth", addon: null,
      message: "You've used all 500 text segments your Pro plan includes this month. The count resets on the 1st (UTC). To raise it, move to Growth (1,500 text segments).",
    });
  });
});

describe("reserving quota", () => {
  it("refuses without an account (401) or a plan (402 plan_required, never a fallback plan)", async () => {
    const anon = res();
    expect(await reserveMonthlyQuota(req(), anon, "photos")).toBe(false);
    expect(anon.status).toHaveBeenCalledWith(401);

    const none = res();
    expect(await reserveMonthlyQuota(req(42), none, "searches")).toBe(false);
    expect(none.status).toHaveBeenCalledWith(402);
    expect(none.json.mock.calls[0][0]).toMatchObject({ code: "plan_required", requiredPlan: "starter" });
    expect(mocks.take).not.toHaveBeenCalled();

    mocks.row = plan("standard");
    const starter = res();
    expect(await reserveMonthlyQuota(req(42), starter, "competitorScans")).toBe(false);
    expect(starter.json.mock.calls[0][0]).toMatchObject({ code: "plan_required", requiredPlan: "pro", message: "Competitor Intel is included with the Pro plan. Upgrade in Pricing to use it." });
  });

  it("reserves the full amount atomically and explains an exhausted quota", async () => {
    mocks.row = plan("starter");
    mocks.take.mockResolvedValue(false);
    const r = res();
    expect(await reserveMonthlyQuota(req(42), r, "rankings", gridCreditCost(15))).toBe(false);
    expect(mocks.take.mock.calls[0].slice(0, 3)).toEqual([`quota:user:42:rankings:${monthKey()}`, 5, 9]);
    expect(r.status).toHaveBeenCalledWith(403);
    // Nothing used yet, but a 15x15 grid needs more credits than the plan has.
    expect(r.json.mock.calls[0][0]).toMatchObject({
      code: "limit_reached", feature: "rankings", limit: 5, used: 0, upgradePlan: "pro",
      message: "This needs 9 ranking-grid credits, and 5 of the 5 ranking-grid credits your Starter plan includes this month are left. The count resets on the 1st (UTC). To raise it, move to Pro (15 ranking-grid credits).",
    });
    mocks.used = 5;
    const spent = res();
    expect(await reserveMonthlyQuota(req(42), spent, "rankings", 1)).toBe(false);
    expect(spent.json.mock.calls[0][0].message).toBe("You've used all 5 ranking-grid credits your Starter plan includes this month. The count resets on the 1st (UTC). To raise it, move to Pro (15 ranking-grid credits).");
    mocks.used = undefined;

    mocks.row = plan("growth");
    const pack = await reserveQuotaFor(42, "competitorScans");
    expect(pack.ok).toBe(false);
    expect(!pack.ok && pack.body.message).toContain("add the Competitor scan pack add-on or move to Agency (20 Competitor Intel scans)");
  });

  it("charges the agency owner's allowance for a member acting in the workspace, and refunds unused work", async () => {
    mocks.row = plan("agency");
    mocks.locations = 30;
    mocks.take.mockResolvedValue(true);
    const r = res();
    r.locals.agencyOwner = 900;
    expect(await reserveMonthlyQuota(req(42), r, "siteScans", 4)).toBe(true);
    expect(mocks.take.mock.calls[0].slice(0, 3)).toEqual([quotaKey(900, "siteScans"), 30, 4]);
    await refundQuota(r, 3);
    await refundQuota(r, 3);
    expect(mocks.refunds).toEqual([[quotaKey(900, "siteScans"), 3], [quotaKey(900, "siteScans"), 1]]);
    await refundQuota(r, 1);
    expect(mocks.refunds).toHaveLength(2);
  });

  it("treats the photo optimizer as fair use on any paid plan", async () => {
    mocks.row = plan("starter");
    const r = res();
    expect(await reserveMonthlyQuota(req(42), r, "photos", 10)).toBe(true);
    expect(mocks.take).not.toHaveBeenCalled();
    await refundQuota(r, 10);
    expect(mocks.refunds).toHaveLength(0);
  });

  it("gives platform admins the top plan's quotas", async () => {
    mocks.row = { email: "alpinesidingcompany@gmail.com", plan: null };
    mocks.take.mockResolvedValue(true);
    expect((await reserveQuotaFor(1, "competitorScans")).ok).toBe(true);
    expect(mocks.take.mock.calls[0][1]).toBe(20);
  });
});
