/**
 * Owner order 2026-10-22 — everything is infinite for a platform admin. The
 * central bypasses: per-account budgets (takeAccountBudget), rateLimit(), fixed
 * per-account count caps (countCap / atCap / overCap), the CRM's admin limits
 * and the JobCam storage gate. Each case has a normal-user control that must
 * behave exactly as before. No database: ./db is a fake that knows two users.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const ADMIN_ID = 7, USER_ID = 8;
const queries: string[] = [];
vi.mock("./db", () => ({
  pool: {
    query: vi.fn(async (text: string, values: unknown[] = []) => {
      queries.push(text);
      if (/SELECT email FROM users/.test(text)) {
        const id = Number(values[0]);
        return { rows: id === ADMIN_ID ? [{ email: "support@constructhub.us" }] : id === USER_ID ? [{ email: "someone@example.invalid" }] : [] };
      }
      if (/INSERT INTO growth_budgets/.test(text)) {
        // A window that is already spent: every capped take is refused.
        return { rowCount: 0, rows: [] };
      }
      return { rows: [], rowCount: 0 };
    }),
  },
}));

import { atCap, countCap, forgetPlatformAdminIds, isPlatformAdminUserId, overCap } from "./admin-unlimited";
import { rateLimit, takeAccountBudget } from "./growth-limits";
import { adminCrmLimits, crmEntitlementsFromRow } from "./crm/entitlements";
import { jobcamStorageRefusal } from "./jobcam/usage";
import { CRM_PLANS } from "@shared/crm-plans";
import { JOBCAM_BYTES_PER_GB, JOBCAM_STORAGE_TIERS_GB } from "@shared/jobcam-storage";

beforeEach(() => { queries.length = 0; forgetPlatformAdminIds(); });

describe("who is a platform admin", () => {
  it("is decided by the account's email, and is false for no id or an unknown user", async () => {
    expect(await isPlatformAdminUserId(ADMIN_ID)).toBe(true);
    expect(await isPlatformAdminUserId(USER_ID)).toBe(false);
    expect(await isPlatformAdminUserId(999)).toBe(false);
    expect(await isPlatformAdminUserId(null)).toBe(false);
    expect(await isPlatformAdminUserId(0)).toBe(false);
  });
});

describe("takeAccountBudget", () => {
  it("never refuses a platform admin and never touches the budget table", async () => {
    expect(await takeAccountBudget(ADMIN_ID, "x:7", 1, 1, 60_000)).toBe(true);
    expect(queries.some((q) => /growth_budgets/.test(q))).toBe(false);
  });
  it("is takeBudget for everyone else (a spent window is refused)", async () => {
    expect(await takeAccountBudget(USER_ID, "x:8", 1, 1, 60_000)).toBe(false);
    expect(queries.some((q) => /INSERT INTO growth_budgets/.test(q))).toBe(true);
  });
});

describe("rateLimit", () => {
  const run = async (mw: ReturnType<typeof rateLimit>, user: unknown) => {
    const res: any = { statusCode: 200, headers: {} as Record<string, string>, setHeader(k: string, v: string) { this.headers[k] = v; }, status(c: number) { this.statusCode = c; return this; }, json() { return this; } };
    let passed = false;
    await mw({ user, ip: "203.0.113.9", socket: {} } as any, res, () => { passed = true; });
    return { passed, status: res.statusCode };
  };
  const admin = { id: ADMIN_ID, email: "support@constructhub.us" };
  const user = { id: USER_ID, email: "someone@example.invalid" };
  it("lets a signed-in platform admin through without counting", async () => {
    expect(await run(rateLimit("t", 1, 1), admin)).toEqual({ passed: true, status: 200 });
    expect(queries.some((q) => /growth_budgets/.test(q))).toBe(false);
  });
  it("still limits a normal user", async () => {
    expect(await run(rateLimit("t", 1, 1), user)).toEqual({ passed: false, status: 429 });
  });
  it("keeps a security window ({ admins: \"limited\" }) for admins too", async () => {
    expect(await run(rateLimit("t", 1, 1, 60_000, { admins: "limited" }), admin)).toEqual({ passed: false, status: 429 });
  });
});

describe("fixed per-account count caps", () => {
  it("are -1 (none) for a platform admin and the cap for everyone else", async () => {
    expect(await countCap(ADMIN_ID, 50)).toBe(-1);
    expect(await countCap(USER_ID, 50)).toBe(50);
  });
  it("atCap / overCap never trip on -1 and keep the old comparisons otherwise", () => {
    expect(atCap(-1, 1_000_000)).toBe(false);
    expect(overCap(-1, 1_000_000)).toBe(false);
    expect(atCap(5, 4)).toBe(false);
    expect(atCap(5, 5)).toBe(true);
    expect(overCap(1000, 1000)).toBe(false);
    expect(overCap(1000, 1001)).toBe(true);
  });
});

describe("CRM limits", () => {
  it("an admin's CRM has every numeric allowance unlimited and JobCam at the largest size", () => {
    const ent = crmEntitlementsFromRow({}, true);
    expect(ent).toMatchObject({ active: true, via: "admin", seats: -1, jobcam: true });
    expect(ent.limits).toEqual(adminCrmLimits());
    for (const [k, v] of Object.entries(ent.limits!)) {
      if (typeof v !== "number") continue;
      expect(v, k).toBe(k === "jobcamStorageGb" ? JOBCAM_STORAGE_TIERS_GB[JOBCAM_STORAGE_TIERS_GB.length - 1] : -1);
    }
  });
  it("a paying customer's CRM limits are the plan's own, unchanged", () => {
    const ent = crmEntitlementsFromRow({ plan: "crm_elite", status: "active", extra_seats: 0 }, false);
    expect(ent.via).toBe("plan");
    expect(ent.limits).toEqual(CRM_PLANS.crm_elite.limits);
    expect(ent.seats).toBe(CRM_PLANS.crm_elite.limits.seats);
    const beta = crmEntitlementsFromRow({ beta_at: new Date() }, false);
    expect(beta.limits).toEqual(CRM_PLANS.crm_elite.limits);
  });
});

describe("JobCam storage gate", () => {
  const full = { usedBytes: 5 * JOBCAM_BYTES_PER_GB, pendingBytes: 0, tierGb: 5 as const };
  it("never refuses an admin's org", () => {
    expect(jobcamStorageRefusal({ ...full, unlimited: true }, JOBCAM_BYTES_PER_GB)).toBeNull();
  });
  it("still refuses a full org that is not an admin's", () => {
    expect(jobcamStorageRefusal(full, JOBCAM_BYTES_PER_GB)).not.toBeNull();
  });
});
