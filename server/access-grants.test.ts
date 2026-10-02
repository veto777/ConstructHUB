/**
 * Admin access grants (server/access-grants.ts, /admin/access).
 *
 *   1. Pure rules: request validation (plan, days 1–1000), whether a grant
 *      still holds its subscription row, its status, the notice email.
 *   2. The routes mounted in-process on the lane DB (dev bypass user 1 is the
 *      platform admin; throwaway accounts are inserted and deleted): 401/403,
 *      400s, a grant gives the plan through getEntitlements and clears the
 *      caches, a live Stripe subscription is refused, extend replaces the end,
 *      revoke ends access, never touches a Stripe row and is idempotent, the
 *      audit rows and the notice email are written, and a trial code's revoke
 *      leaves an admin grant alone.
 *   3. The real app on a child server from this checkout (ACCESS_GRANTS_TEST_PORT,
 *      default 8501): the routes are registered, a non-admin session gets 403,
 *      writes need our Origin, and the account's own /api/entitlements follows.
 *
 * Run with DATABASE_URL on a constructhub_dev* lane, DEV_AUTH_BYPASS_USER1=true and NODE_ENV=development.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express, { type Express } from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { spawn, type ChildProcess } from "node:child_process";
import { createWriteStream, mkdirSync, readFileSync, existsSync } from "node:fs";
import { createHmac, randomUUID, randomInt } from "node:crypto";
import pg from "pg";
import {
  accessGrantedEmail, ensureAccessGrantsSchema, grantHoldsRow, grantInputError, grantStatus, registerAccessGrantRoutes,
} from "./access-grants";
import { endRevokedTrial, getEntitlements } from "./entitlements";
import { dashboardCache } from "./dashboard/cache";
import { ownerHasPlan } from "./agency/access";
import { grantDaysLeft, grantEndsAt, trialCodeDays, validGrantDays, ACCESS_GRANT_DAY_MS } from "@shared/access-grants";

const DATABASE_URL = process.env.DATABASE_URL ?? "";
const pool = new pg.Pool({ connectionString: DATABASE_URL });
const q = (text: string, params: unknown[] = []) => pool.query(text, params);
const users: number[] = [];
const emails: string[] = [];
const sids: string[] = [];
const codes: number[] = [];
const DAY = ACCESS_GRANT_DAY_MS;

async function account(opts: { plan?: string; status?: string; stripe?: string | null; end?: Date | null; customer?: string } = {}) {
  const email = `ag-${randomUUID()}@example.invalid`;
  const { rows: [u] } = await q("insert into users(email, display_name, email_verified) values($1, 'Grant fixture', true) returning id", [email]);
  users.push(u.id); emails.push(email);
  if (opts.plan) {
    await q("insert into subscriptions(user_id, plan, status, stripe_subscription_id, stripe_customer_id, current_period_end) values($1,$2,$3,$4,$5,$6)",
      [u.id, opts.plan, opts.status ?? "active", opts.stripe ?? null, opts.customer ?? null, opts.end ?? null]);
  }
  return { id: u.id as number, email };
}
const subOf = async (userId: number) => (await q("select * from subscriptions where user_id=$1 order by id desc", [userId])).rows;
const grantsOf = async (userId: number) => (await q("select * from admin_access_grants where user_id=$1 order by id", [userId])).rows;
const near = (a: Date | string, b: Date | string, ms = 5_000) => Math.abs(new Date(a).getTime() - new Date(b).getTime()) < ms;

afterAll(async () => {
  if (users.length) {
    await q("delete from admin_audit_log where target_account_name = any($1::text[])", [emails]);
    await q("delete from email_log where user_id = any($1::int[])", [users]);
    await q("delete from beta_access_codes where id = any($1::int[])", [codes]);
    await q("delete from admin_access_grants where user_id = any($1::int[])", [users]);
    await q("delete from subscriptions where user_id = any($1::int[])", [users]);
    await q("delete from account_activity where user_id = any($1::int[])", [users]);
    await q("delete from session where sid = any($1::text[])", [sids]);
    await q("delete from users where id = any($1::int[])", [users]);
  }
  await pool.end();
});

// ── 1. Pure rules ───────────────────────────────────────────────────────────

describe("rules", () => {
  it("validates the request: an account, a price-book plan, whole days 1–1000, a short note", () => {
    const ok = { userId: 5, plan: "pro", days: 30 };
    expect(grantInputError(ok)).toBeNull();
    expect(grantInputError({ ...ok, days: 1 })).toBeNull();
    expect(grantInputError({ ...ok, days: 1000, note: "Dennis — GBP import" })).toBeNull();
    for (const days of [0, 1001, 2.5, -3, "30", null, undefined, Number.NaN]) {
      expect(grantInputError({ ...ok, days }), String(days)).toBe("Days must be a whole number from 1 to 1000.");
    }
    for (const plan of ["platinum", "free", "", "PRO", undefined, 3]) {
      expect(grantInputError({ ...ok, plan }), String(plan)).toBe("Choose a plan: Starter, Pro, Growth, Agency.");
    }
    for (const userId of [undefined, 0, -1, "5", 1.5, 2 ** 31]) {
      expect(grantInputError({ ...ok, userId }), String(userId)).toBe("Pick an account to give access to.");
    }
    expect(grantInputError({ ...ok, note: "x".repeat(501) })).toBe("Keep the note to 500 characters or fewer.");
    expect(grantInputError({ ...ok, note: 42 })).toBe("Keep the note to 500 characters or fewer.");
    expect(grantInputError(null)).toBe("Pick an account to give access to.");
    expect(validGrantDays(1000)).toBe(true);
    expect(validGrantDays(1001)).toBe(false);
  });

  it("trial codes run 1–1000 days too, or 0 for until-revoked (the old cap was 14)", () => {
    expect(trialCodeDays(undefined)).toBe(2);
    expect(trialCodeDays(0)).toBe(0);
    expect(trialCodeDays(1)).toBe(1);
    expect(trialCodeDays(15)).toBe(15);
    expect(trialCodeDays(1000)).toBe(1000);
    for (const bad of [1001, -1, 2.5, "30", Number.NaN]) expect(trialCodeDays(bad), String(bad)).toBeNull();
  });

  it("counts days and end dates", () => {
    const from = new Date("2026-10-02T12:00:00Z");
    expect(grantEndsAt(30, from).toISOString()).toBe("2026-11-01T12:00:00.000Z");
    expect(grantDaysLeft("2026-11-01T12:00:00Z", from)).toBe(30);
    expect(grantDaysLeft("2026-10-02T13:00:00Z", from)).toBe(1);
    expect(grantDaysLeft("2026-10-01T12:00:00Z", from)).toBe(0);
  });

  it("a grant holds its row only while the row is still that grant", () => {
    const ends = new Date("2026-11-01T12:00:00Z");
    const g = { id: 1, user_id: 1, subscription_id: 9, plan: "pro", days: 30, note: null, granted_by_user_id: 1, granted_by_email: "a@x",
      granted_at: new Date("2026-10-02T12:00:00Z"), ends_at: ends, revoked_at: null, revoked_by_user_id: null, revoked_by_email: null, replaced_at: null };
    const row = { id: 9, plan: "pro", status: "active", stripe_subscription_id: null, current_period_end: ends };
    const now = new Date("2026-10-10T00:00:00Z");
    expect(grantHoldsRow(g, row)).toBe(true);
    expect(grantStatus(g, row, now)).toEqual({ status: "active", endedAt: null, endedHow: null });
    expect(grantHoldsRow(g, { ...row, stripe_subscription_id: "sub_1" })).toBe(false);
    expect(grantStatus(g, { ...row, stripe_subscription_id: "sub_1" }, now).endedHow).toBe("Replaced by a paid plan");
    expect(grantStatus(g, { ...row, status: "trialing", plan: "agency" }, now).endedHow).toBe("Replaced by a trial code");
    expect(grantHoldsRow(g, { ...row, current_period_end: new Date(ends.getTime() + 86_400_000) })).toBe(false);
    expect(grantHoldsRow(g, { ...row, id: 10 })).toBe(false);
    expect(grantHoldsRow(g, null)).toBe(false);
    expect(grantStatus(g, row, new Date("2026-11-02T00:00:00Z")).status).toBe("expired");
    expect(grantStatus({ ...g, revoked_at: now, revoked_by_email: "owner@x" }, row, now)).toMatchObject({ status: "revoked", endedHow: "Revoked by owner@x" });
    expect(grantStatus({ ...g, replaced_at: now }, row, now)).toMatchObject({ status: "replaced", endedHow: "Replaced by a newer grant" });
  });

  it("the notice email says which plan and until when", () => {
    const msg = accessGrantedEmail({ plan: "pro", endsAt: new Date("2026-11-01T12:00:00Z"), baseUrl: "https://constructhub.us" });
    expect(msg.subject).toBe("You've been given Pro access on ConstructHUB until November 1, 2026");
    expect(msg.text).toContain("No card is needed and nothing will be charged.");
    expect(msg.html).toContain("Access until");
    expect(msg.text).toContain("https://constructhub.us/settings?tab=billing");
  });
});

// ── 2. The routes, in-process on the lane DB ────────────────────────────────

const ADMIN_ID = 1; // dev@constructhub.local: a platform admin under DEV_AUTH_BYPASS_USER1 in development
let server: Server;
let base = "";

function mountApp(): Express {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const as = Number(req.headers["x-test-user"]);
    if (as) (req as any).user = { id: as };
    next();
  });
  registerAccessGrantRoutes(app, (req: any, res: any) => req.user ?? (res.status(401).json({ message: "Not authenticated" }), null));
  return app;
}

async function call(path: string, opts: { as?: number | null; method?: string; body?: unknown; origin?: string | null } = {}) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (opts.as !== null) headers["x-test-user"] = String(opts.as ?? ADMIN_ID);
  if (opts.origin !== null && (opts.method ?? "GET") !== "GET") headers.origin = opts.origin ?? base;
  const r = await fetch(base + path, { method: opts.method ?? "GET", headers, ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}) });
  const text = await r.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch {}
  return { status: r.status, body: json };
}
const grant = (body: unknown, as?: number | null) => call("/api/admin/access-grants", { method: "POST", body, as });
const revoke = (id: number, as?: number | null) => call(`/api/admin/access-grants/${id}/revoke`, { method: "POST", as });

describe("routes (in-process, lane DB)", () => {
  beforeAll(async () => {
    if (!/^\/constructhub_dev(?:_a\d+)?$/.test(new URL(DATABASE_URL).pathname)) throw new Error("Requires a ConstructHUB development lane DB");
    if (process.env.DEV_AUTH_BYPASS_USER1 !== "true" || process.env.NODE_ENV === "production") throw new Error("Needs DEV_AUTH_BYPASS_USER1=true (user 1 is the platform admin)");
    delete process.env.ADMIN_GATE_USER;
    delete process.env.ADMIN_GATE_PASS;
    process.env.EMAIL_FORCE_SINK = "1";
    const { rows: [admin] } = await q("select email from users where id = $1", [ADMIN_ID]);
    expect(admin?.email, "user 1 is the dev bypass admin").toBe("dev@constructhub.local");
    await ensureAccessGrantsSchema();
    server = mountApp().listen(0);
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => { server?.close(); });

  it("platform admins only: 401 signed out, 403 for a non-admin, on every route", async () => {
    const member = await account();
    expect((await call("/api/admin/access-grants", { as: null })).status).toBe(401);
    expect((await grant({ userId: member.id, plan: "pro", days: 30 }, null)).status).toBe(401);
    expect((await revoke(1, null)).status).toBe(401);
    const get = await call("/api/admin/access-grants", { as: member.id });
    expect(get.status).toBe(403);
    expect(get.body.message).toBe("Platform admin access required");
    expect((await grant({ userId: member.id, plan: "pro", days: 30 }, member.id)).status).toBe(403);
    expect((await revoke(1, member.id)).status).toBe(403);
    expect(await subOf(member.id)).toEqual([]);
  });

  it("enforces the admin second factor where it is configured: 403 reauth (the client verifies identity and retries)", async () => {
    process.env.ADMIN_GATE_USER = "gate"; process.env.ADMIN_GATE_PASS = "pass";
    try {
      const target = await account();
      for (const r of [
        await call("/api/admin/access-grants"),
        await grant({ userId: target.id, plan: "pro", days: 30 }),
        await revoke(1),
      ]) {
        expect(r.status).toBe(403);
        expect(r.body).toMatchObject({ reauth: true, gateRequired: true, message: "Please verify your identity to continue." });
      }
      expect(await subOf(target.id)).toEqual([]);
    } finally {
      delete process.env.ADMIN_GATE_USER; delete process.env.ADMIN_GATE_PASS;
    }
  });

  it("writes need our Origin and JSON", async () => {
    const target = await account();
    expect((await call("/api/admin/access-grants", { method: "POST", body: { userId: target.id, plan: "pro", days: 30 }, origin: null })).status).toBe(403);
    expect((await call("/api/admin/access-grants", { method: "POST", body: { userId: target.id, plan: "pro", days: 30 }, origin: "https://evil.example" })).status).toBe(403);
    expect((await call("/api/admin/access-grants/1/revoke", { method: "POST", origin: "https://evil.example" })).status).toBe(403);
    expect(await subOf(target.id)).toEqual([]);
  });

  it("refuses bad days and plans with 400, an unknown account with 404, and changes nothing", async () => {
    const target = await account();
    for (const days of [0, 1001, 2.5, "30"]) {
      const r = await grant({ userId: target.id, plan: "pro", days });
      expect(r.status, String(days)).toBe(400);
      expect(r.body.message).toBe("Days must be a whole number from 1 to 1000.");
    }
    for (const plan of ["platinum", "free", "enterprise", undefined]) {
      const r = await grant({ userId: target.id, plan, days: 30 });
      expect(r.status, String(plan)).toBe(400);
      expect(r.body.message).toBe("Choose a plan: Starter, Pro, Growth, Agency.");
    }
    expect((await grant({ userId: 2147483000, plan: "pro", days: 30 })).status).toBe(404);
    expect((await q("select 1 from admin_audit_log where action = 'access_grant' and parameters->>'userId' = '2147483000'")).rows).toEqual([]);
    expect(await subOf(target.id)).toEqual([]);
    expect(await grantsOf(target.id)).toEqual([]);
  });

  it("a grant gives the plan until the end date, clears the caches, writes the audit rows and emails the account", async () => {
    const target = await account();
    expect((await getEntitlements(target.id)).plan).toBeNull();
    // Warm the caches a grant must clear: the dashboard and the agency sync's plan answer.
    dashboardCache.set(target.id, null, { generatedAt: new Date().toISOString() } as any);
    expect(dashboardCache.get(target.id, null)).not.toBeNull();
    expect(await ownerHasPlan(target.id)).toBe(false);

    const before = Date.now();
    const r = await grant({ userId: target.id, plan: "pro", days: 30, note: "  Dennis — GBP import  " });
    expect(r.status).toBe(201);
    expect(r.body.grant).toMatchObject({ userId: target.id, plan: "pro", planName: "Pro", days: 30, note: "Dennis — GBP import", status: "active", daysLeft: 30 });
    expect(r.body.grant.grantedBy).toEqual({ id: ADMIN_ID, email: "dev@constructhub.local" });
    expect(r.body.account.access).toMatchObject({ plan: "pro", source: "grant", grantId: r.body.grant.id, paidStripe: false });
    expect(r.body.email).toBe("sent");
    expect(r.body.message).toMatch(/^Pro access granted to ag-.*@example\.invalid until .+\. We emailed ag-/);
    const ends = new Date(r.body.grant.endsAt);
    expect(near(ends, before + 30 * DAY)).toBe(true);

    // Stored as a Stripe-less subscriptions row that ends at the grant's end.
    const [sub] = await subOf(target.id);
    expect(sub).toMatchObject({ plan: "pro", status: "active", stripe_subscription_id: null });
    expect(near(sub.current_period_end, ends, 1000)).toBe(true);
    const ent = await getEntitlements(target.id);
    expect(ent).toMatchObject({ plan: "pro", accessPlan: "pro", isPlatformAdmin: false });
    expect(near(ent.grantEndsAt!, ends, 1000)).toBe(true);
    // …and it stops counting at the end date (getEntitlements' own clock).
    expect((await getEntitlements(target.id, new Date(ends.getTime() + 1000))).plan).toBeNull();

    expect(dashboardCache.get(target.id, null)).toBeNull();
    expect(await ownerHasPlan(target.id)).toBe(true);

    const { rows: audit } = await q("select * from admin_audit_log where target_account_name = $1 order by id", [target.email]);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ actor_id: ADMIN_ID, actor_email: "dev@constructhub.local", action: "access_grant", result: "success" });
    expect(audit[0].parameters).toMatchObject({ userId: target.id, plan: "pro", days: 30, grantId: r.body.grant.id });
    const { rows: activity } = await q("select kind, detail, ip from account_activity where user_id = $1", [target.id]);
    expect(activity).toEqual([{ kind: "billing.access_granted", detail: expect.objectContaining({ plan: "pro", days: 30 }), ip: null }]);

    const { rows: mail } = await q("select kind, status from email_log where dedupe_key = $1", [`access_grant:${r.body.grant.id}`]);
    expect(mail).toEqual([{ kind: "access.granted", status: "sent" }]);
    const outbox = "tmp/email-outbox.jsonl";
    expect(existsSync(outbox)).toBe(true);
    const sent = readFileSync(outbox, "utf8").trim().split("\n").map((l) => JSON.parse(l)).filter((m) => m.to?.includes(target.email));
    expect(sent.at(-1).subject).toMatch(/^You've been given Pro access on ConstructHUB until /);

    // The list shows it as active, and the search finds the account with its access.
    const list = await call(`/api/admin/access-grants?q=${encodeURIComponent(target.email)}`);
    expect(list.status).toBe(200);
    expect(list.body.maxDays).toBe(1000);
    expect(list.body.accounts.map((a: any) => a.id)).toEqual([target.id]);
    expect(list.body.accounts[0].access).toMatchObject({ source: "grant", plan: "pro" });
    expect(list.body.active.find((g: any) => g.id === r.body.grant.id)).toMatchObject({ status: "active", email: target.email });
    expect((await call(`/api/admin/access-grants?q=%23${target.id}`)).body.accounts[0].id).toBe(target.id);
  });

  it("refuses an account with a live Stripe subscription (409) and leaves it exactly as it was", async () => {
    const end = new Date(Date.now() + 20 * DAY);
    for (const status of ["active", "past_due", "trialing", "unpaid"]) {
      const payer = await account({ plan: "growth", status, stripe: `sub_ag_${randomUUID()}`, end });
      const [before] = await subOf(payer.id);
      const r = await grant({ userId: payer.id, plan: "agency", days: 365 });
      expect(r.status, status).toBe(409);
      expect(r.body.message).toContain("pays for Growth through Stripe");
      expect(await subOf(payer.id)).toEqual([before]);
      expect(await grantsOf(payer.id)).toEqual([]);
      const { rows: audit } = await q("select result, error_message from admin_audit_log where target_account_name = $1", [payer.email]);
      expect(audit).toEqual([{ result: "error", error_message: r.body.message }]);
    }
  });

  it("an ended Stripe subscription's row is replaced in place (its customer id stays)", async () => {
    const lapsed = await account({ plan: "pro", status: "canceled", stripe: `sub_ag_${randomUUID()}`, customer: "cus_ag_keep", end: new Date(Date.now() - DAY) });
    const r = await grant({ userId: lapsed.id, plan: "starter", days: 7 });
    expect(r.status).toBe(201);
    const rows = await subOf(lapsed.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ plan: "starter", status: "active", stripe_subscription_id: null, stripe_customer_id: "cus_ag_keep" });
    expect((await grantsOf(lapsed.id))[0].previous).toMatchObject({ plan: "pro", status: "canceled" });
    expect((await getEntitlements(lapsed.id)).plan).toBe("starter");
  });

  it("extending is granting again: the end date (and plan) is replaced and the old grant marked replaced", async () => {
    const target = await account();
    const first = await grant({ userId: target.id, plan: "pro", days: 30 });
    const second = await grant({ userId: target.id, plan: "growth", days: 90 });
    expect(second.status).toBe(201);
    const [sub] = await subOf(target.id);
    expect(sub.plan).toBe("growth");
    expect(near(sub.current_period_end, Date.now() + 90 * DAY)).toBe(true);
    expect((await subOf(target.id))).toHaveLength(1);
    const ent = await getEntitlements(target.id);
    expect(ent.plan).toBe("growth");
    expect(near(ent.grantEndsAt!, Date.now() + 90 * DAY)).toBe(true);
    const [old, current] = await grantsOf(target.id);
    expect(old.replaced_by_grant_id).toBe(current.id);
    expect(old.replaced_at).not.toBeNull();
    const list = (await call(`/api/admin/access-grants?q=${encodeURIComponent(target.email)}`)).body;
    expect(list.active.filter((g: any) => g.userId === target.id).map((g: any) => g.id)).toEqual([second.body.grant.id]);
    expect(list.ended.find((g: any) => g.id === first.body.grant.id)).toMatchObject({ status: "replaced", endedHow: "Replaced by a newer grant" });
    // A shorter grant shortens it: the end date is always now + days.
    await grant({ userId: target.id, plan: "growth", days: 1 });
    expect(near((await subOf(target.id))[0].current_period_end, Date.now() + DAY)).toBe(true);
  });

  it("revoke ends access now, is idempotent, and audits once", async () => {
    const target = await account();
    const g = (await grant({ userId: target.id, plan: "pro", days: 30 })).body.grant;
    dashboardCache.set(target.id, null, { generatedAt: new Date().toISOString() } as any);
    expect(await ownerHasPlan(target.id)).toBe(true);

    const r = await revoke(g.id);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ changed: true, grant: { id: g.id, status: "revoked", endedHow: "Revoked by dev@constructhub.local", daysLeft: 0 } });
    const [sub] = await subOf(target.id);
    expect(sub).toMatchObject({ status: "canceled", plan: "pro", stripe_subscription_id: null });
    expect(new Date(sub.current_period_end).getTime()).toBeLessThanOrEqual(Date.now());
    expect((await getEntitlements(target.id)).plan).toBeNull();
    expect(dashboardCache.get(target.id, null)).toBeNull();
    expect(await ownerHasPlan(target.id)).toBe(false);

    const again = await revoke(g.id);
    expect(again.status).toBe(200);
    expect(again.body).toMatchObject({ changed: false, message: "This grant was already revoked.", grant: { status: "revoked" } });
    expect((await subOf(target.id))[0]).toEqual(sub);
    const { rows: audit } = await q("select action from admin_audit_log where target_account_name = $1 order by id", [target.email]);
    expect(audit.map((a: any) => a.action)).toEqual(["access_grant", "access_grant_revoke"]);
    const { rows: activity } = await q("select kind from account_activity where user_id = $1 order by id", [target.id]);
    expect(activity.map((a: any) => a.kind)).toEqual(["billing.access_granted", "billing.access_revoked"]);

    const list = (await call(`/api/admin/access-grants?q=${encodeURIComponent(target.email)}`)).body;
    expect(list.active.some((x: any) => x.id === g.id)).toBe(false);
    expect(list.ended.find((x: any) => x.id === g.id)).toMatchObject({ status: "revoked" });
    expect(list.accounts[0].access).toMatchObject({ source: "none", plan: null });
    expect((await revoke(2147483000)).status).toBe(404);
  });

  it("revoke never touches a Stripe-backed row (a paid plan that took over the grant's row)", async () => {
    const target = await account();
    const g = (await grant({ userId: target.id, plan: "pro", days: 30 })).body.grant;
    // The customer then checks out: the webhook writes their Stripe subscription onto the same row.
    const stripeEnd = new Date(Date.now() + 25 * DAY);
    await q("update subscriptions set stripe_subscription_id=$2, plan='growth', status='active', current_period_end=$3 where user_id=$1",
      [target.id, `sub_ag_${randomUUID()}`, stripeEnd]);
    const [paid] = await subOf(target.id);
    const r = await revoke(g.id);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ changed: false, grant: { status: "replaced", endedHow: "Replaced by a paid plan" } });
    expect(await subOf(target.id)).toEqual([paid]);
    expect((await getEntitlements(target.id)).plan).toBe("growth");
    expect((await grantsOf(target.id))[0].revoked_at).toBeNull();
    // …and the account now reads as a Stripe payer, so a new grant is refused.
    expect((await grant({ userId: target.id, plan: "agency", days: 30 })).status).toBe(409);
  });

  it("revoking a trial code leaves an admin grant on the same account alone", async () => {
    const target = await account();
    const { rows: [code] } = await q(
      `insert into beta_access_codes(code, created_by_user_id, redeemed_by_user_id, trial_days, expires_at, redeemed_at)
       values ($1, $2, $3, 14, now() + interval '14 days', now()) returning *`,
      [`TRIAL-AG${randomInt(1e6, 1e7)}`, ADMIN_ID, target.id]);
    codes.push(code.id);
    await q("insert into subscriptions(user_id, plan, status, current_period_end) values ($1, 'agency', 'trialing', now() + interval '14 days')", [target.id]);
    const g = (await grant({ userId: target.id, plan: "pro", days: 7 })).body.grant;
    expect(g.status).toBe("active");
    const outcome = await endRevokedTrial({ id: code.id, redeemedByUserId: target.id, redeemedAt: code.redeemed_at, trialDays: 14 });
    expect(outcome).toBe("unchanged");
    expect((await subOf(target.id))[0]).toMatchObject({ plan: "pro", status: "active" });
    expect((await getEntitlements(target.id)).plan).toBe("pro");
  });
});

// ── 3. The real app on a child server from this checkout ────────────────────

const childPort = Number(process.env.ACCESS_GRANTS_TEST_PORT ?? 8501);
const childBase = `http://127.0.0.1:${childPort}`;
const secret = "access-grants-session-secret";
const testIp = `198.18.${randomInt(256)}.${randomInt(1, 255)}`;
let child: ChildProcess;

async function session(userId: number): Promise<string> {
  const sid = randomUUID(); sids.push(sid);
  await q("insert into session(sid, sess, expire) values($1, $2, now() + interval '1 hour')", [sid, JSON.stringify({ cookie: { maxAge: 3600000 }, passport: { user: userId } })]);
  const sig = createHmac("sha256", secret).update(sid).digest("base64").replace(/=+$/, "");
  return `connect.sid=${encodeURIComponent(`s:${sid}.${sig}`)}`;
}
async function http(path: string, opts: { cookie?: string; method?: string; body?: unknown; origin?: string | null } = {}) {
  const headers: Record<string, string> = { "content-type": "application/json", "x-forwarded-for": testIp };
  if (opts.cookie) headers.cookie = opts.cookie;
  if (opts.origin) headers.origin = opts.origin;
  const r = await fetch(childBase + path, { method: opts.method ?? "GET", headers, ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}) });
  const text = await r.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch {}
  return { status: r.status, body: json };
}

describe.skipIf(process.env.CRM_TEST_SINGLE_PORT === "true")("routes on the real app (child server)", () => {
  beforeAll(async () => {
    child = spawn(process.execPath, ["--import", "tsx", "server/index.ts"], {
      env: {
        ...process.env, PORT: String(childPort), NODE_ENV: "development", DEV_AUTH_BYPASS_USER1: "true", CRM_DEMO_AUTOLOGIN: "false",
        SESSION_SECRET: secret, EMAIL_FORCE_SINK: "1", STRIPE_SECRET_KEY: "", GOOGLE_PLACES_API_KEY: "", ADMIN_GATE_USER: "", ADMIN_GATE_PASS: "",
        SCRAPE_SCHEDULER_DISABLED: "true", GBP_SYNC_DISABLED: "true",
      },
      stdio: ["ignore", "pipe", "pipe"], detached: true,
    });
    mkdirSync("tmp", { recursive: true });
    const log = createWriteStream(`tmp/access-grants-${childPort}.log`);
    child.stdout!.pipe(log); child.stderr!.pipe(log);
    for (let i = 0; i < 180; i++) {
      if (child.exitCode !== null) throw new Error(`Access grants test server exited (see tmp/access-grants-${childPort}.log)`);
      try { if ((await fetch(childBase + "/api/auth/me")).ok) return; } catch {}
      await new Promise((r) => setTimeout(r, 500));
    }
    throw new Error("Access grants test server did not start");
  }, 120_000);

  afterAll(() => {
    if (child?.pid) { try { process.kill(-child.pid, "SIGTERM"); } catch {} }
  });

  it("grant → the account's own entitlements → revoke, through the real routes", async () => {
    const target = await account();
    const cookie = await session(target.id);
    // A non-admin session: 403 on every route.
    expect((await http("/api/admin/access-grants", { cookie })).status).toBe(403);
    expect((await http("/api/admin/access-grants", { cookie, method: "POST", body: { userId: target.id, plan: "pro", days: 30 }, origin: childBase })).status).toBe(403);
    expect((await http("/api/entitlements", { cookie })).body).toMatchObject({ plan: null });

    // The dev bypass admin (no cookie): the search finds the account; a write without our Origin is refused.
    const found = await http(`/api/admin/access-grants?q=${encodeURIComponent(target.email)}`);
    expect(found.status).toBe(200);
    expect(found.body.accounts.map((a: any) => a.email)).toEqual([target.email]);
    expect((await http("/api/admin/access-grants", { method: "POST", body: { userId: target.id, plan: "pro", days: 30 } })).status).toBe(403);
    const made = await http("/api/admin/access-grants", { method: "POST", body: { userId: target.id, plan: "pro", days: 30 }, origin: childBase });
    expect(made.status).toBe(201);
    expect((await http("/api/entitlements", { cookie })).body).toMatchObject({ plan: "pro", planName: "Pro" });
    expect((await http(`/api/admin/access-grants/${made.body.grant.id}/revoke`, { cookie, method: "POST", origin: childBase })).status).toBe(403);
    const ended = await http(`/api/admin/access-grants/${made.body.grant.id}/revoke`, { method: "POST", origin: childBase });
    expect(ended.status).toBe(200);
    expect(ended.body.changed).toBe(true);
    expect((await http("/api/entitlements", { cookie })).body).toMatchObject({ plan: null });
  });

  it("the trial-code generator takes 1–1000 days (or unlimited) and refuses the rest", async () => {
    for (const trialDays of [1000, 15, 0]) {
      const r = await http("/api/beta-codes/generate", { method: "POST", body: { trialDays }, origin: childBase });
      expect(r.status, String(trialDays)).toBe(200);
      codes.push(r.body.id);
      expect(r.body.trialDays).toBe(trialDays);
      if (trialDays) expect(near(r.body.expiresAt, Date.now() + trialDays * DAY, 60_000)).toBe(true);
      else expect(new Date(r.body.expiresAt).getUTCFullYear()).toBe(2099);
    }
    for (const trialDays of [1001, 2.5, "30", -1]) {
      const r = await http("/api/beta-codes/generate", { method: "POST", body: { trialDays }, origin: childBase });
      expect(r.status, String(trialDays)).toBe(400);
      expect(r.body.message).toBe("Trial length must be a whole number of days from 1 to 1000, or unlimited.");
    }
    // A 1000-day code grants 1000 days when redeemed.
    const target = await account();
    const cookie = await session(target.id);
    const { rows: [c] } = await q("select code from beta_access_codes where id = $1", [codes.at(-3)]);
    const redeemed = await http("/api/beta-codes/redeem", { cookie, method: "POST", body: { code: c.code }, origin: childBase });
    expect(redeemed.status).toBe(200);
    expect(near(redeemed.body.expiresAt, Date.now() + 1000 * DAY, 60_000)).toBe(true);
    expect((await http("/api/entitlements", { cookie })).body).toMatchObject({ plan: "agency" });
  });
});
