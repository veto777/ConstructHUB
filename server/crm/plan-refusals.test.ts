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

vi.mock("../email", () => ({ sendWithFallback: vi.fn(async () => ({ accepted: ["fixture@example.invalid"] })) }));
vi.mock("./sms", async (original) => ({ ...(await original<typeof import("./sms")>()), sendSms: vi.fn(async () => ({ ok: true, provider: "log", sid: null })) }));

let base = "", server: ReturnType<express.Express["listen"]>;
const users: number[] = [];
const ip = `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
async function call(user: number, path: string, body: unknown, method = "POST") {
  const r = await fetch(base + path, { method, headers: { "content-type": "application/json", "x-fixture-user": String(user), "x-forwarded-for": ip }, body: JSON.stringify(body) });
  return { status: r.status, data: await r.json().catch(() => null) };
}
const account = async (plan?: string) => {
  const id = (await pool.query("INSERT INTO users(email) VALUES($1) RETURNING id", [`i-crm-${randomUUID()}@example.invalid`])).rows[0].id as number;
  users.push(id);
  if (plan) await pool.query("INSERT INTO subscriptions(user_id,plan,status) VALUES($1,$2,'active')", [id, plan]);
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
  await pool.query("DELETE FROM users WHERE id=ANY($1::int[])", [users]);
  await pool.end();
});

describe("CRM seat refusals", () => {
  it("answer limit_reached with the plan's seat count and the Extra seat add-on", async () => {
    const owner = await account("starter");
    const first = await call(owner, "/api/crm/invitations", { email: `i-invitee-${randomUUID()}@example.invalid`, role: "field" });
    const seats = PLANS.starter.limits.crmSeats;
    expect(first.status).toBe(402);
    expect(first.data).toMatchObject({
      code: "limit_reached", feature: "crmSeats", limit: seats, used: 1, addon: "extra_seat", upgradePlan: "pro",
      message: `Your Starter plan includes ${seats} CRM seat and 1 is in use. To raise it, add the Extra seat add-on or move to Pro (${PLANS.pro.limits.crmSeats} seats).`,
    });
    expect(first.data.seats).toMatchObject({ limit: seats, used: 1, canAddSeat: false });
  });

  it("point an account with no plan at the cheapest plan with more seats", async () => {
    const owner = await account();
    const refused = await call(owner, "/api/crm/invitations", { email: `i-invitee-${randomUUID()}@example.invalid` });
    expect(refused.status).toBe(402);
    expect(refused.data).toMatchObject({ code: "limit_reached", feature: "crmSeats", limit: 1, used: 1, addon: null, upgradePlan: "pro" });
    expect(refused.data.message).toContain("The CRM is included with every paid plan, and Pro includes 3 seats.");
  });
});

describe("One seat pool for the CRM team and the Agency team", () => {
  it("lets only one of two simultaneous additions (a CRM invitation and an Agency member) take the last seat", async () => {
    const seats = PLANS.agency.limits.crmSeats;
    const owner = await account("agency");
    // Owner + one pending invitation.
    expect((await call(owner, "/api/crm/invitations", { email: `i-invitee-${randomUUID()}@example.invalid` })).status).toBe(201);
    const member = async () => {
      const id = await account();
      return (await pool.query("SELECT email FROM users WHERE id=$1", [id])).rows[0].email as string;
    };
    for (let i = 0; i < seats - 3; i++) {
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
    expect(refused.data).toMatchObject({ code: "limit_reached", feature: "crmSeats", limit: seats, used: seats, addon: "extra_seat" });
    await pool.query("DELETE FROM agency_members WHERE user_id=$1", [owner]);
    await pool.query("DELETE FROM agency_workspaces WHERE user_id=$1", [owner]);
  });
});

describe("Texting a client without a texting plan", () => {
  it("answers plan_required naming the cheapest texting plan", async () => {
    const owner = await account("starter");
    // The owner's org exists after their first CRM request.
    await call(owner, "/api/crm/invitations", { email: `i-invitee-${randomUUID()}@example.invalid` });
    const org = (await pool.query("SELECT id FROM crm_orgs WHERE owner_user_id=$1", [owner])).rows[0].id;
    const customer = (await pool.query("INSERT INTO crm_customers(org_id,display_name,phone,portal_token) VALUES($1,'I- texting fixture','+15555550123',$2) RETURNING id", [org, randomUUID()])).rows[0].id;
    const refused = await call(owner, "/api/crm/messages", { customerId: customer, channel: "text", body: "On our way" });
    expect(refused.status).toBe(402);
    expect(refused.data).toEqual({
      code: "plan_required", requiredPlan: "pro", planAllowsSms: false,
      message: "Text messaging is included with the Pro, Growth and Agency plans. Upgrade in Pricing to turn it on.",
    });
  });
});
