/**
 * The CRM's plan refusals carry the codes the client turns into a next step
 * (client/src/lib/plan-errors.ts): a full seat pool answers limit_reached with
 * the Extra seat add-on or the next plan, and texting without a texting plan
 * answers plan_required. In-process routes on the lane Postgres; fresh accounts,
 * cleaned up afterwards; no email, SMS or Stripe calls.
 */
import { beforeAll, afterAll, describe, it, expect, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";
import { pool } from "../db";
import { PLANS } from "@shared/plans";
import { CRM_PLANS, CRM_EXTRA_SEAT_MONTHLY_CENTS } from "@shared/crm-plans";

vi.mock("../email", () => ({ sendWithFallback: vi.fn(async () => ({ accepted: ["fixture@example.invalid"] })) }));
vi.mock("./sms", async (original) => ({ ...(await original<typeof import("./sms")>()), sendSms: vi.fn(async () => ({ ok: true, provider: "log", sid: null })) }));

let base = "", server: ReturnType<express.Express["listen"]>;
const users: number[] = [];
const ip = `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
async function call(user: number, path: string, body: unknown, method = "POST") {
  const r = await fetch(base + path, { method, headers: { "content-type": "application/json", "x-fixture-user": String(user), "x-forwarded-for": ip }, body: JSON.stringify(body) });
  return { status: r.status, data: await r.json().catch(() => null) };
}
const account = async (plan?: string, crm?: { plan: string; status?: string; extraSeats?: number }) => {
  const id = (await pool.query("INSERT INTO users(email) VALUES($1) RETURNING id", [`i-crm-${randomUUID()}@example.invalid`])).rows[0].id as number;
  users.push(id);
  if (plan) await pool.query("INSERT INTO subscriptions(user_id,plan,status) VALUES($1,$2,'active')", [id, plan]);
  // The CRM is a separate product: CRM seats live on the CRM subscription.
  if (crm) await pool.query("INSERT INTO crm_subscriptions(user_id,plan,status,extra_seats) VALUES($1,$2,$3,$4)", [id, crm.plan, crm.status ?? "active", crm.extraSeats ?? 0]);
  return id;
};

beforeAll(async () => {
  const target = new URL(process.env.DATABASE_URL!);
  if (!/^\/constructhub_dev(?:_[a-z0-9]+)?$/.test(target.pathname) || !["localhost", "127.0.0.1"].includes(target.hostname)) throw Error("Local development DB required");
  const { registerCrmRoutes } = await import("./routes");
  const { registerAgencyRoutes } = await import("../agency/routes");
  const app = express();
  app.set("trust proxy", true);
  app.use(express.json());
  app.use((req: any, _res, next) => { req.user = { id: Number(req.headers["x-fixture-user"]) }; req.session = {}; next(); });
  registerCrmRoutes(app, (req: any) => req.user);
  registerAgencyRoutes(app);
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  await new Promise((resolve) => server?.close(resolve));
  const { rows } = await pool.query("SELECT id FROM crm_orgs WHERE owner_user_id=ANY($1::int[])", [users]);
  const orgs = rows.map((r) => r.id);
  await pool.query("DELETE FROM crm_customers WHERE org_id=ANY($1::varchar[])", [orgs]);
  await pool.query("DELETE FROM crm_invitations WHERE org_id=ANY($1::varchar[])", [orgs]);
  await pool.query("DELETE FROM crm_activity WHERE org_id=ANY($1::varchar[])", [orgs]).catch(() => {});
  await pool.query("DELETE FROM crm_members WHERE org_id=ANY($1::varchar[])", [orgs]);
  await pool.query("DELETE FROM crm_orgs WHERE id=ANY($1::varchar[])", [orgs]);
  await pool.query("DELETE FROM growth_budgets WHERE key=ANY($1::text[])", [users.map((u) => `agency-route:${u}`)]);
  await pool.query("DELETE FROM subscriptions WHERE user_id=ANY($1::int[])", [users]);
  await pool.query("DELETE FROM crm_subscriptions WHERE user_id=ANY($1::int[])", [users]);
  await pool.query("DELETE FROM users WHERE id=ANY($1::int[])", [users]);
  await pool.end();
});

describe("CRM seat refusals", () => {
  it("answer limit_reached with the CRM plan's seat count and how to raise it", async () => {
    // The CRM is a separate product: seats come from the CRM plan (CRM Basic: 1), not any platform plan.
    const owner = await account(undefined, { plan: "crm_basic" });
    const first = await call(owner, "/api/crm/invitations", { email: `i-invitee-${randomUUID()}@example.invalid`, role: "field" });
    const seats = CRM_PLANS.crm_basic.limits.seats;
    expect(first.status).toBe(402);
    expect(first.data).toMatchObject({
      code: "limit_reached", feature: "crmSeats", limit: seats, used: 1, addon: null, upgradePlan: null,
      message: `Your CRM Basic plan includes ${seats} CRM seat and 1 is in use. CRM Essentials includes ${CRM_PLANS.crm_essentials.limits.seats} seats, or add an extra seat for $${CRM_EXTRA_SEAT_MONTHLY_CENTS / 100}/mo.`,
    });
    expect(first.data.seats).toMatchObject({ limit: seats, used: 1, canAddSeat: false, upgradeCrmPlan: "crm_essentials" });
  });

  it("point an account with no CRM plan at the CRM plans", async () => {
    // No CRM subscription: every CRM route answers crm_plan_required before any seat check.
    const owner = await account("starter");
    const refused = await call(owner, "/api/crm/invitations", { email: `i-invitee-${randomUUID()}@example.invalid` });
    expect(refused.status).toBe(402);
    expect(refused.data).toMatchObject({
      code: "crm_plan_required",
      message: "The ConstructHUB CRM is its own subscription, separate from the ConstructHUB platform plans, from $39/mo. Choose a CRM plan to open it.",
      href: "/pricing#crm",
    });
  });
});

describe("One seat pool for the CRM team and the Agency team", () => {
  // The pool is CRM seats + the platform plan's agencySeats while the Agency workspace module is on:
  // CRM Basic (1) + Agency's agencySeats (10) = 11. Unlimited's agencySeats (-1) would leave it uncapped.
  const poolSize = CRM_PLANS.crm_basic.limits.seats + PLANS.growth.limits.agencySeats;

  it("lets only one of two simultaneous additions (a CRM invitation and an Agency member) take the last seat", async () => {
    const owner = await account("growth", { plan: "crm_basic" });
    // Owner + one pending invitation.
    expect((await call(owner, "/api/crm/invitations", { email: `i-invitee-${randomUUID()}@example.invalid` })).status).toBe(201);
    const member = async () => {
      const id = await account();
      return (await pool.query("SELECT email FROM users WHERE id=$1", [id])).rows[0].email as string;
    };
    for (let i = 0; i < poolSize - 3; i++) {
      const r = await call(owner, "/api/agency/team", { email: await member(), role: "viewer" }, "PUT");
      expect(r.status).toBe(200);
    }
    const [crm, agency] = await Promise.all([
      call(owner, "/api/crm/invitations", { email: `i-invitee-${randomUUID()}@example.invalid` }),
      call(owner, "/api/agency/team", { email: await member(), role: "viewer" }, "PUT"),
    ]);
    const outcomes = [crm, agency];
    expect(outcomes.filter((r) => r.status === 200 || r.status === 201)).toHaveLength(1);
    const refused = outcomes.find((r) => r.status === 402 || r.status === 403)!;
    // The Agency ($199) platform plan sells the Extra seat add-on: it raises agencySeats, so the refusal names it.
    expect(refused.data).toMatchObject({ code: "limit_reached", feature: "crmSeats", limit: poolSize, used: poolSize, addon: "extra_seat" });
    expect(refused.data.message).toContain("Add an extra seat for $17/mo.");
    await pool.query("DELETE FROM agency_members WHERE user_id=$1", [owner]);
    await pool.query("DELETE FROM agency_workspaces WHERE user_id=$1", [owner]);
  });

  it("answers every one of more simultaneous additions for one owner than the pg pool has connections", async () => {
    // A request waiting for the seat lock holds a pool connection (10 by default). Before the work under the lock
    // ran on the lock's own connection, 12 invitations at once wedged every query in the process.
    const owner = await account("growth", { plan: "crm_basic" });
    const emails = await Promise.all(Array.from({ length: 5 }, async () =>
      (await pool.query("SELECT email FROM users WHERE id=$1", [await account()])).rows[0].email as string));
    const all = Promise.all([
      ...Array.from({ length: 9 }, () => call(owner, "/api/crm/invitations", { email: `i-invitee-${randomUUID()}@example.invalid` })),
      ...emails.map((email) => call(owner, "/api/agency/team", { email, role: "viewer" }, "PUT")),
    ]);
    const outcome = await Promise.race([all, new Promise<"wedged">((resolve) => setTimeout(() => resolve("wedged"), 15_000))]);
    expect(outcome).not.toBe("wedged");
    const results = outcome as Awaited<typeof all>;
    // The owner holds one seat; the other seats go to exactly that many of the 14, and the rest are refused.
    expect(results.filter((r) => r.status === 200 || r.status === 201)).toHaveLength(poolSize - 1);
    for (const r of results.filter((r) => r.status !== 200 && r.status !== 201))
      expect(r.data).toMatchObject({ code: "limit_reached", feature: "crmSeats", limit: poolSize, used: poolSize, addon: "extra_seat" });
    const { getOwnerSeatUsage } = await import("./tenancy");
    expect((await getOwnerSeatUsage(owner)).used).toBe(poolSize);
    await pool.query("DELETE FROM agency_member_clients WHERE user_id=$1", [owner]);
    await pool.query("DELETE FROM agency_members WHERE user_id=$1", [owner]);
    await pool.query("DELETE FROM agency_workspaces WHERE user_id=$1", [owner]);
  }, 30_000);
});

describe("Texting a client without a texting plan", () => {
  it("answers plan_required naming the cheapest texting plan", async () => {
    // CRM Basic has no texting (Essentials and up do), and no platform plan grants any either.
    const owner = await account(undefined, { plan: "crm_basic" });
    // The owner's org exists after their first CRM request (the invitation itself is refused: the one seat is taken).
    await call(owner, "/api/crm/invitations", { email: `i-invitee-${randomUUID()}@example.invalid` });
    const org = (await pool.query("SELECT id FROM crm_orgs WHERE owner_user_id=$1", [owner])).rows[0].id;
    const customer = (await pool.query("INSERT INTO crm_customers(org_id,display_name,phone,portal_token) VALUES($1,'I- texting fixture','+15555550123',$2) RETURNING id", [org, randomUUID()])).rows[0].id;
    const refused = await call(owner, "/api/crm/messages", { customerId: customer, channel: "text", body: "On our way" });
    expect(refused.status).toBe(402);
    expect(refused.data).toEqual({
      code: "plan_required", requiredPlan: "starter", planAllowsSms: false,
      message: "Text messaging is included with the CRM Essentials and CRM Max plans. Change your CRM plan in Pricing to turn it on.",
    });
  });
});
