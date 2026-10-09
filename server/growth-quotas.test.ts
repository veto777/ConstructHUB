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

  it("reads each plan's flat allowances and competitor packs", async () => {
    mocks.row = plan("starter");
    const starter = await getEntitlements(1);
    expect(monthlyLimit(starter, "searches")).toBe(10);
    expect(monthlyLimit(starter, "rankings")).toBe(3);
    expect(monthlyLimit(starter, "siteScans")).toBe(2);
    expect(monthlyLimit(starter, "competitorScans")).toBe(1);
    expect(monthlyLimit(starter, "gabeQuestions")).toBe(100);
    expect(monthlyLimit(starter, "photos")).toBe(-1);

    mocks.row = plan("gold", { addons: { competitor_pack: 2 } });
    const growth = await getEntitlements(1);
    expect(monthlyLimit(growth, "searches")).toBe(200);
    expect(monthlyLimit(growth, "competitorScans")).toBe(40);

    mocks.row = plan("agency");
    const agency = await getEntitlements(1);
    // Unlimited: flat allowances, independent of the location count.
    expect(monthlyLimit(agency, "rankings", 3)).toBe(150);
    expect(monthlyLimit(agency, "siteScans", 3)).toBe(-1);
    expect(monthlyLimit(agency, "rankings", 25)).toBe(150);
    expect(monthlyLimit(agency, "siteScans", 25)).toBe(-1);
    expect(monthlyLimit(agency, "gabeQuestions")).toBe(-1);

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

    mocks.row = plan(null); // no plan at all: texts are included with every paid plan
    const none = await reserveQuotaFor(42, "texts", 1);
    expect(none.ok).toBe(false);
    expect(!none.ok && none.body).toMatchObject({ code: "plan_required", requiredPlan: "starter" });
    expect(mocks.take).not.toHaveBeenCalled();

    mocks.row = plan("pro");
    mocks.take.mockResolvedValue(false);
    mocks.used = 1000;
    const spent = await reserveQuotaFor(42, "texts", 2);
    expect(mocks.take.mock.calls[0].slice(0, 3)).toEqual([`quota:user:42:texts:${monthKey()}`, 1000, 2]);
    expect(!spent.ok && spent.status).toBe(403);
    expect(!spent.ok && spent.body).toMatchObject({
      code: "limit_reached", feature: "texts", limit: 1000, used: 1000, upgradePlan: "growth", addon: null,
      message: "You've used all 1,000 text segments your Pro plan includes this month. The count resets on the 1st (UTC). To raise it, move to Agency (2,000 text segments).",
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

    mocks.row = plan("standard"); // legacy key -> Solo, which now includes Competitor Intel (1/month)
    mocks.take.mockResolvedValue(true);
    const legacy = res();
    expect(await reserveMonthlyQuota(req(42), legacy, "competitorScans")).toBe(true);
    expect(mocks.take.mock.calls[0].slice(0, 3)).toEqual([`quota:user:42:competitorScans:${monthKey()}`, 1, 1]);
  });

  it("reserves the full amount atomically and explains an exhausted quota", async () => {
    mocks.row = plan("starter");
    mocks.take.mockResolvedValue(false);
    const r = res();
    expect(await reserveMonthlyQuota(req(42), r, "rankings", gridCreditCost(15))).toBe(false);
    expect(mocks.take.mock.calls[0].slice(0, 3)).toEqual([`quota:user:42:rankings:${monthKey()}`, 3, 9]);
    expect(r.status).toHaveBeenCalledWith(403);
    // Nothing used yet, but a 15x15 grid needs more credits than the plan has.
    expect(r.json.mock.calls[0][0]).toMatchObject({
      code: "limit_reached", feature: "rankings", limit: 3, used: 0, upgradePlan: "team",
      message: "This needs 9 ranking-grid credits, and 3 of the 3 ranking-grid credits your Solo plan includes this month are left. The count resets on the 1st (UTC). To raise it, move to Team (10 ranking-grid credits).",
    });
    mocks.used = 3;
    const spent = res();
    expect(await reserveMonthlyQuota(req(42), spent, "rankings", 1)).toBe(false);
    expect(spent.json.mock.calls[0][0].message).toBe("You've used all 3 ranking-grid credits your Solo plan includes this month. The count resets on the 1st (UTC). To raise it, move to Team (10 ranking-grid credits).");
    mocks.used = undefined;

    mocks.row = plan("growth");
    const pack = await reserveQuotaFor(42, "competitorScans");
    expect(pack.ok).toBe(false);
    expect(!pack.ok && pack.body.message).toContain("add the Competitor scan pack add-on or move to Unlimited (50 Competitor Intel scans)");
  });

  it("charges the agency owner's allowance for a member acting in the workspace, and refunds unused work", async () => {
    mocks.row = plan("growth"); // Agency: a flat 50 Site Scans a month (no per-location billing)
    mocks.locations = 30;
    mocks.take.mockResolvedValue(true);
    const r = res();
    r.locals.agencyOwner = 900;
    expect(await reserveMonthlyQuota(req(42), r, "siteScans", 4)).toBe(true);
    expect(mocks.take.mock.calls[0].slice(0, 3)).toEqual([quotaKey(900, "siteScans"), 50, 4]);
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

  it("never refuses a platform admin, on any meter, at any amount, and still counts the use", async () => {
    // A customer would be refused here: takeBudget says the month is spent.
    mocks.take.mockResolvedValue(false);
    mocks.used = 1_000_000;
    for (const row of [{ email: "alpinesidingcompany@gmail.com", plan: null }, plan("platinum", { email: "alpinesidingcompany@gmail.com", stripe_subscription_id: null }), plan("starter", { email: "support@constructhub.us" })]) {
      mocks.row = row;
      const ent = await getEntitlements(1);
      for (const feature of ["searches", "rankings", "siteScans", "competitorScans", "photos", "texts", "gabeQuestions"] as const) {
        expect(monthlyLimit(ent, feature, 50), feature).toBe(-1);
        const r = await reserveQuotaFor(1, feature, 9_999);
        expect(r.ok, feature).toBe(true);
        const http = res();
        expect(await reserveMonthlyQuota(req(1), http, feature, 25), feature).toBe(true);
        expect(http.status).not.toHaveBeenCalled();
      }
    }
    // The capped path (takeBudget) is never consulted for an admin.
    expect(mocks.take).not.toHaveBeenCalled();
    const { pool } = await import("./db");
    const counted = (pool.query as any).mock.calls.filter(([sql]: [string]) => /INSERT INTO growth_budgets/.test(sql));
    // Counted meters (not the fair-use photo optimizer) record the use for Limits & usage.
    expect(counted.some(([, v]: [string, any[]]) => v[0] === quotaKey(1, "competitorScans") && v[1] === 9_999)).toBe(true);
    expect(counted.some(([, v]: [string, any[]]) => v[0] === quotaKey(1, "photos"))).toBe(false);
  });

  it("an admin's counted use is refundable like any reservation", async () => {
    mocks.row = { email: "alpinesidingcompany@gmail.com", plan: null };
    const r = res();
    expect(await reserveMonthlyQuota(req(1), r, "siteScans", 3)).toBe(true);
    expect(r.locals.growthQuota).toMatchObject({ key: quotaKey(1, "siteScans"), remaining: 3 });
    await refundQuota(r, 2);
    expect(mocks.refunds.at(-1)).toEqual([quotaKey(1, "siteScans"), 2]);
  });

  it("a failed count never blocks an admin", async () => {
    mocks.row = { email: "alpinesidingcompany@gmail.com", plan: null };
    const { pool } = await import("./db");
    const base = (pool.query as any).getMockImplementation();
    (pool.query as any).mockImplementation(async (text: string, values: any[]) => {
      if (/INSERT INTO growth_budgets/.test(text)) throw new Error("db down");
      return base(text, values);
    });
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const r = await reserveQuotaFor(1, "searches", 1);
      expect(r).toMatchObject({ ok: true, limit: -1, reservation: { remaining: 0 } });
    } finally {
      (pool.query as any).mockImplementation(base);
      spy.mockRestore();
    }
  });

  it("customers are unchanged: a spent month is still refused", async () => {
    mocks.row = plan("agency");
    mocks.take.mockResolvedValue(false);
    mocks.used = 20;
    const r = await reserveQuotaFor(7, "competitorScans");
    expect(r).toMatchObject({ ok: false, status: 403 });
    expect(mocks.take.mock.calls[0][1]).toBe(50);
  });
});
