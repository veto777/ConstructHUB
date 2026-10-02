/**
 * Platform admins (the Alpine account) on the dashboard, against the lane's
 * development database: every meter is unlimited and "Needs you today" never
 * flags a plan-limit overage. A non-admin with the same rows on the same plan is
 * the control — it IS flagged, so the admin assertion is not vacuous.
 *
 * `../admin` is mocked so a throwaway account (example.invalid) counts as a
 * platform admin; the real ADMIN_EMAILS accounts are never touched. Every row
 * is created here and deleted afterwards.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import pg from "pg";
import { randomUUID } from "node:crypto";

const tag = randomUUID().slice(0, 8);
const ADMIN_EMAIL = `dash-admin-${tag}@example.invalid`;
vi.mock("../admin", () => ({
  ADMIN_EMAILS: [] as string[],
  isPlatformAdminEmail: (email?: string | null) => !!email && email.toLowerCase() === ADMIN_EMAIL,
  isPlatformAdmin: (user: any) => !!user && String(user.email ?? "").toLowerCase() === ADMIN_EMAIL,
}));

import { dashboardAttention } from "@shared/dashboard";
import { PLANS } from "@shared/plans";
import { buildDashboard } from "./aggregate";
import { endDashboardPool } from "./pool";
import { pool as appPool } from "../db";
import { assertDevDatabase } from "./test-seed";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const users: number[] = [];
let admin = 0;
let customer = 0;
const month = () => new Date().toISOString().slice(0, 7);
const quiet = () => {};

/** A Starter account (1 location, no protected sites, 100 searches) holding far more than Starter allows. */
async function overStarter(email: string, name: string): Promise<number> {
  const { rows: [u] } = await pool.query("INSERT INTO users(email, display_name, email_verified) VALUES($1,$2,true) RETURNING id", [email, name]);
  users.push(u.id);
  await pool.query("INSERT INTO subscriptions(user_id, plan, status, stripe_subscription_id, current_period_end) VALUES($1,'starter','active',$2, now() + interval '20 days')",
    [u.id, `sub_admin_${randomUUID()}`]);
  for (let i = 0; i < 3; i++) await pool.query("INSERT INTO business_locations(user_id, business_name) VALUES($1,$2)", [u.id, `Your Company ${tag} #${i}`]);
  await pool.query("INSERT INTO tracked_domains(user_id, domain, tracking_id) VALUES($1,$2,$3)", [u.id, `admin-${tag}-${u.id}.example.invalid`, `trk-${randomUUID()}`]);
  await pool.query("INSERT INTO growth_budgets(key, period, used) VALUES($1,'0',150)", [`quota:user:${u.id}:searches:${month()}`]);
  return u.id;
}

beforeAll(async () => {
  assertDevDatabase();
  admin = await overStarter(ADMIN_EMAIL, "Ada Admin");
  customer = await overStarter(`dash-customer-${tag}@example.invalid`, "Cal Customer");
}, 60_000);

afterAll(async () => {
  await pool.query("DELETE FROM tracked_domains WHERE user_id = ANY($1::int[])", [users]);
  await pool.query("DELETE FROM business_locations WHERE user_id = ANY($1::int[])", [users]);
  await pool.query("DELETE FROM subscriptions WHERE user_id = ANY($1::int[])", [users]);
  await pool.query("DELETE FROM growth_budgets WHERE key LIKE ANY($1)", [users.map((u) => `quota:user:${u}:%`)]);
  await pool.query("DELETE FROM users WHERE id = ANY($1::int[])", [users]);
  await pool.end();
  await endDashboardPool();
  await appPool.end();
});

describe("dashboard for a platform admin", () => {
  it("meters every limit as unlimited and flags no plan-limit overage", async () => {
    const { payload: p } = await buildDashboard(admin, { log: quiet });
    expect(p.account.isPlatformAdmin).toBe(true);
    const usage = Object.fromEntries(p.account.usage.map((u) => [u.key, u]));
    // Every meter the dashboard shows is unlimited: -1, never "3 of 1".
    expect(p.account.usage.length).toBeGreaterThan(0);
    for (const u of p.account.usage) expect(u.limit, u.key).toBe(-1);
    expect(usage.locations).toMatchObject({ used: 3, limit: -1 });
    expect(usage.searches).toMatchObject({ used: 150, limit: -1 });
    // Protected websites are not in Starter, but an admin has them (unlimited).
    expect(usage.protectedSites).toMatchObject({ used: 1, limit: -1 });
    const gbpLocations = p.tiles.find((t) => t.key === "gbp")?.metrics.find((m) => m.key === "locations");
    if (gbpLocations) expect(gbpLocations.limit).toBe(-1);

    const attention = dashboardAttention(p.tiles, p.account);
    expect(attention.filter((a) => a.key.startsWith("usage."))).toEqual([]);
    expect(attention.some((a) => a.hint === "Over your plan's limit" || a.hint === "Limit reached this month")).toBe(false);

    // Every feature is on: the AI Call Assistant tile opens the CRM's Call Assistant, never "coming soon".
    const ca = p.tiles.find((t) => t.key === "callAssistant")!;
    expect(ca.status).not.toBe("coming_soon");
    expect(ca).toMatchObject({ entitled: true, status: "ok", cta: { href: "/call-assistant", surface: "app" } });
  });

  it("control: a customer with the same rows on the same plan IS flagged (unchanged)", async () => {
    const { payload: p } = await buildDashboard(customer, { log: quiet });
    expect(p.account.isPlatformAdmin).toBe(false);
    const usage = Object.fromEntries(p.account.usage.map((u) => [u.key, u]));
    expect(usage.locations).toMatchObject({ used: 3, limit: PLANS.starter.limits.locations });
    expect(usage.searches).toMatchObject({ used: 150, limit: PLANS.starter.limits.permitSearches });
    expect(usage.protectedSites).toBeUndefined();
    const keys = dashboardAttention(p.tiles, p.account).map((a) => a.key);
    expect(keys).toEqual(expect.arrayContaining(["usage.locations", "usage.searches"]));
    // Not an admin and no add-on bought: the (launched) AI Call Assistant is locked like any tile — not "coming soon".
    expect(p.tiles.find((t) => t.key === "callAssistant")).toMatchObject({ status: "locked", entitled: false, requiredPlan: "pro", addon: "call_assistant", metrics: [] });
  });
});
