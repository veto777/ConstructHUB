/**
 * Session endpoints for API keys + usage (contract lane l5). Lane 1's tables and
 * createApiKey are stood in for here with the contract's shapes: the DDL below
 * is IF NOT EXISTS and the mock hashes the secret like a verifier would.
 */
import { beforeAll, afterAll, describe, it, expect, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { pool } from "../db";
import { ensureGrowthSchema } from "../growth-schema";
import { ensureAccountEventsSchema } from "../account-events";
import { registerApiKeyRoutes, apiAllowance, apiUnitsForPlan, cheapestApiPlan, parseScopes, parseKeyName, parseUnitLimit, parseUsageDays, bearerFor, normalizeRow, MAX_API_KEYS, MAX_USAGE_DAYS, type ApiKeyDeps } from "./api-key-routes";
import { PLANS } from "@shared/plans";

vi.mock("../email", () => ({ sendWithFallback: vi.fn(async () => ({ accepted: ["fixture@example.invalid"], rejected: [], response: "mock" })) }));
import { sendWithFallback } from "../email";
const sent = sendWithFallback as unknown as ReturnType<typeof vi.fn>;
// notifyUser passes through to the real one, except where a test makes it fail on purpose.
vi.mock("../account-events", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../account-events")>();
  return { ...actual, notifyUser: vi.fn(actual.notifyUser) };
});
import { notifyUser } from "../account-events";
const notify = notifyUser as unknown as ReturnType<typeof vi.fn>;

const users = {} as Record<"pro" | "starter" | "none" | "other" | "member", number>;
let base = "", server: ReturnType<express.Express["listen"]>;
const sessions = new Map<number, any>();
const jsonBodies: any[] = [];
const ip = `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
const sha = (s: string) => createHash("sha256").update(s).digest("hex");

/** Stands in for server/account/api-keys.ts createApiKey: chub_<prefix>_<secret>, hash stored, secret returned once. */
const deps: ApiKeyDeps = {
  async createApiKey(userId, input) {
    const prefix = randomBytes(4).toString("hex"), body = randomBytes(24).toString("base64url");
    const secret = `chub_${prefix}_${body}`;
    const { rows: [row] } = await pool.query(
      `INSERT INTO account_api_keys(id,user_id,name,prefix,suffix,secret_hash,scopes,monthly_unit_limit,expires_at,created_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8, CASE WHEN $9::int IS NULL THEN NULL ELSE now()+($9::int * interval '1 day') END, now()) RETURNING *`,
      [`key_${randomBytes(8).toString("hex")}`, userId, input.name, prefix, body.slice(-4), sha(secret), input.scopes, input.monthlyUnitLimit, input.expiresInDays]);
    return { secret, row };
  },
};
/** The deps the app under test calls (swapped by the lane-1-shape test). */
let activeDeps: ApiKeyDeps = deps;

async function call(user: number | null, path: string, method = "GET", body?: unknown, extra: Record<string, string> = {}) {
  const r = await fetch(base + path, {
    method, redirect: "manual",
    headers: { "x-forwarded-for": ip, ...(user ? { "x-fixture-user": String(user) } : {}), ...(body ? { "content-type": "application/json" } : {}), ...extra },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let data: any = text; try { data = JSON.parse(text); } catch { /* not JSON */ }
  return { status: r.status, data, headers: r.headers };
}
const stepUp = (id: number) => { sessions.get(id)!.recentAuth = { userId: id, at: Date.now() }; };
const dropStepUp = (id: number) => { delete sessions.get(id)?.recentAuth; };
const activity = async (id: number, kind: string) => (await pool.query("SELECT detail FROM account_activity WHERE user_id=$1 AND kind=$2 ORDER BY id", [id, kind])).rows;
const notifications = async (id: number, kind: string) => (await pool.query("SELECT title, body, link FROM user_notifications WHERE user_id=$1 AND kind=$2 ORDER BY id", [id, kind])).rows;

beforeAll(async () => {
  const target = new URL(process.env.DATABASE_URL!);
  if (!/^\/constructhub_dev(?:_[a-z0-9]+)?$/.test(target.pathname) || !["localhost", "127.0.0.1"].includes(target.hostname)) throw Error("Local development DB required");
  await ensureGrowthSchema(); await ensureAccountEventsSchema();
  // The contract's tables (lane 1 owns the real ensureAccountSchema).
  await pool.query(`
    CREATE TABLE IF NOT EXISTS account_api_keys(id text PRIMARY KEY, user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE, name text NOT NULL,
      prefix text NOT NULL, suffix text NOT NULL, secret_hash text NOT NULL, scopes text[] NOT NULL, monthly_unit_limit integer, expires_at timestamptz,
      last_used_at timestamptz, revoked_at timestamptz, created_at timestamptz NOT NULL DEFAULT now());
    CREATE TABLE IF NOT EXISTS account_api_usage(key_id text NOT NULL, user_id integer NOT NULL, day date NOT NULL, units integer NOT NULL DEFAULT 0,
      requests integer NOT NULL DEFAULT 0, PRIMARY KEY(key_id, day));`);
  for (const key of Object.keys({ pro: 0, starter: 0, none: 0, other: 0, member: 0 }) as (keyof typeof users)[]) {
    users[key] = (await pool.query("INSERT INTO users(email) VALUES($1) RETURNING id", [`ACCT-l5-${key}-${randomUUID()}@example.invalid`])).rows[0].id;
    sessions.set(users[key], {});
  }
  for (const [user, plan] of [[users.pro, "pro"], [users.starter, "starter"], [users.other, "pro"]] as const)
    await pool.query("INSERT INTO subscriptions(user_id,plan,status) VALUES($1,$2,'active')", [user, plan]);

  const app = express();
  app.set("trust proxy", true);
  app.use(express.json());
  // Session stand-in: req.user from the fixture header, one persistent session per user; a member may act for an owner.
  app.use((req: any, res, next) => {
    const id = Number(req.headers["x-fixture-user"]);
    if (id) { req.user = { id }; req.session = sessions.get(id) ?? (sessions.set(id, {}), sessions.get(id)); } else req.session = {};
    const owner = Number(req.headers["x-fixture-acting-for"]);
    if (owner) res.locals.agencyOwner = owner;
    const json = res.json.bind(res);
    res.json = ((body: any) => { jsonBodies.push(body); return json(body); }) as any;
    next();
  });
  const auth = (req: any, res: any) => req.user ? (res.locals.agencyOwner ? { ...req.user, id: res.locals.agencyOwner } : req.user) : (res.status(401).json({ message: "Not authenticated" }), null);
  registerApiKeyRoutes(app, auth, { createApiKey: (userId, input) => activeDeps.createApiKey(userId, input) });
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  await new Promise((resolve) => server?.close(resolve));
  const ids = Object.values(users);
  await pool.query("DELETE FROM account_api_usage WHERE user_id=ANY($1::int[])", [ids]);
  // Lane 1's real DDL has no FK on user_id, so the keys do not cascade with the users.
  await pool.query("DELETE FROM account_api_keys WHERE user_id=ANY($1::int[])", [ids]);
  await pool.query("DELETE FROM subscriptions WHERE user_id=ANY($1::int[])", [ids]);
  await pool.query("DELETE FROM users WHERE id=ANY($1::int[])", [ids]);
  await pool.end();
});

describe("plan allowance", () => {
  it("follows the contract table until shared/plans.ts publishes apiUnitsPerMonth", () => {
    expect([apiUnitsForPlan("starter"), apiUnitsForPlan("team"), apiUnitsForPlan("pro"), apiUnitsForPlan("growth"), apiUnitsForPlan("agency")]).toEqual([0, 0, 50_000, 250_000, -1]);
    expect(apiUnitsForPlan("starter", { ...PLANS.starter.limits, apiUnitsPerMonth: 500 } as any)).toBe(500);
    expect(cheapestApiPlan()).toBe("pro");
    expect(apiAllowance({ accessPlan: null, allowances: null })).toEqual({ apiEnabled: false, unitsPerMonth: 0, ratePerMinute: 0 });
    expect(apiAllowance({ accessPlan: "pro", allowances: PLANS.pro.limits })).toEqual({ apiEnabled: true, unitsPerMonth: 50_000, ratePerMinute: 60 });
    expect(apiAllowance({ accessPlan: "agency", allowances: { ...PLANS.agency.limits, apiUnitsPerMonth: -1, apiRatePerMinute: 120 } as any })).toEqual({ apiEnabled: true, unitsPerMonth: -1, ratePerMinute: 120 });
  });
  it("parses names, scopes, limits and windows strictly", () => {
    expect(parseKeyName("  My\tkey  ")).toBe("My key");
    expect(parseKeyName("")).toBe(false); expect(parseKeyName("x".repeat(81))).toBe(false); expect(parseKeyName(5)).toBe(false);
    expect(parseScopes(["write", "read", "read"])).toEqual(["read", "write"]);
    expect(parseScopes([])).toBe(false); expect(parseScopes(["admin"])).toBe(false); expect(parseScopes("read")).toBe(false);
    expect(parseUnitLimit(undefined)).toBeNull(); expect(parseUnitLimit(null)).toBeNull(); expect(parseUnitLimit(250)).toBe(250);
    expect(parseUnitLimit(0)).toBe(false); expect(parseUnitLimit(1.5)).toBe(false); expect(parseUnitLimit("10")).toBe(false);
    expect(parseUsageDays(undefined)).toBe(30); expect(parseUsageDays("7")).toBe(7); expect(parseUsageDays("4000")).toBe(MAX_USAGE_DAYS); expect(parseUsageDays("0")).toBe(30);
    expect(bearerFor("chub_abcd_zzz", "abcd")).toBe("chub_abcd_zzz"); expect(bearerFor("zzz", "abcd")).toBe("chub_abcd_zzz");
  });
});

describe("GET /api/account/api-keys", () => {
  it("needs a session and reports the plan's API allowance", async () => {
    expect((await call(null, "/api/account/api-keys")).status).toBe(401);
    const pro = await call(users.pro, "/api/account/api-keys");
    expect(pro.status).toBe(200);
    expect(pro.data).toEqual({ keys: [], plan: { apiEnabled: true, unitsPerMonth: 50_000, usedThisMonth: 0, ratePerMinute: 60 } });
    expect(pro.headers.get("cache-control")).toBe("no-store");
    expect((await call(users.starter, "/api/account/api-keys")).data.plan).toEqual({ apiEnabled: false, unitsPerMonth: 0, usedThisMonth: 0, ratePerMinute: 60 });
    expect((await call(users.none, "/api/account/api-keys")).data.plan).toEqual({ apiEnabled: false, unitsPerMonth: 0, usedThisMonth: 0, ratePerMinute: 0 });
  });
});

describe("POST /api/account/api-keys", () => {
  it("asks for step-up auth first, then refuses plans without API access", async () => {
    dropStepUp(users.starter);
    const cold = await call(users.starter, "/api/account/api-keys", "POST", { name: "ACCT-l5 cold", scopes: ["read"] });
    expect(cold.status).toBe(403); expect(cold.data).toMatchObject({ reauth: true });
    stepUp(users.starter);
    const starter = await call(users.starter, "/api/account/api-keys", "POST", { name: "ACCT-l5 starter", scopes: ["read"] });
    expect(starter.status).toBe(402); expect(starter.data).toMatchObject({ code: "plan_required", requiredPlan: "pro" });
    stepUp(users.none);
    expect((await call(users.none, "/api/account/api-keys", "POST", { name: "ACCT-l5 none", scopes: ["read"] })).status).toBe(402);
    expect((await pool.query("SELECT count(*)::int n FROM account_api_keys WHERE user_id=ANY($1::int[])", [[users.starter, users.none]])).rows[0].n).toBe(0);
  });
  it("validates the body", async () => {
    stepUp(users.pro);
    for (const body of [{ scopes: ["read"] }, { name: "x".repeat(81), scopes: ["read"] }, { name: "k", scopes: [] }, { name: "k", scopes: ["admin"] }, { name: "k", scopes: ["read"], monthlyUnitLimit: 0 }, { name: "k", scopes: ["read"], monthlyUnitLimit: "10" }, { name: "k", scopes: ["read"], expiresInDays: 0 }, { name: "k", scopes: ["read"], expiresInDays: 99999 }]) {
      const r = await call(users.pro, "/api/account/api-keys", "POST", body);
      expect(r.status, JSON.stringify(body)).toBe(400);
    }
    expect((await pool.query("SELECT count(*)::int n FROM account_api_keys WHERE user_id=$1", [users.pro])).rows[0].n).toBe(0);
  });
  it("mints a key: the secret is returned once, outside res.json, and only its hash is stored; the event is logged, notified and emailed without the secret", async () => {
    stepUp(users.pro); sent.mockClear(); jsonBodies.length = 0;
    const r = await call(users.pro, "/api/account/api-keys", "POST", { name: "  ACCT-l5   zapier ", scopes: ["write", "read"], monthlyUnitLimit: 2500, expiresInDays: 30 });
    expect(r.status).toBe(201);
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect(r.headers.get("content-type")).toMatch(/application\/json/);
    const { key, item } = r.data;
    const secretPart = key.replace(/^chub_[0-9a-f]{8}_/, "");
    expect(key).toMatch(/^chub_[0-9a-f]{8}_[A-Za-z0-9_-]{32}$/);
    expect(item).toMatchObject({ name: "ACCT-l5 zapier", scopes: ["read", "write"], monthlyUnitLimit: 2500, unitsThisMonth: 0, lastUsedAt: null, prefix: key.split("_")[1] });
    expect(item.id).toMatch(/^key_/); expect(item.expiresAt).toBeTruthy(); expect(new Date(item.expiresAt).getTime()).toBeGreaterThan(Date.now() + 29 * 86400_000);
    expect(JSON.stringify(item)).not.toContain(secretPart);
    expect(jsonBodies.some((b) => b && typeof b === "object" && "key" in b)).toBe(false);
    const { rows: [stored] } = await pool.query("SELECT * FROM account_api_keys WHERE id=$1", [item.id]);
    expect(stored).toMatchObject({ user_id: users.pro, secret_hash: sha(key), suffix: key.slice(-4), revoked_at: null });
    expect(JSON.stringify(stored)).not.toContain(secretPart);
    const [created] = await activity(users.pro, "security.api_key_created");
    expect(created.detail).toMatchObject({ keyId: item.id, name: "ACCT-l5 zapier", prefix: item.prefix, suffix: item.suffix, scopes: ["read", "write"], monthlyUnitLimit: 2500 });
    expect(JSON.stringify(created.detail)).not.toContain(secretPart);
    const [note] = await notifications(users.pro, "security.api_key_created");
    expect(note).toMatchObject({ title: 'API key "ACCT-l5 zapier" was created', link: "/settings?tab=api-keys" });
    expect(note.body).toContain(`${item.prefix}…${item.suffix}`);
    expect(sent).toHaveBeenCalledTimes(1);
    const mail = sent.mock.calls[0][0];
    expect(mail.subject).toBe('ConstructHUB: API key "ACCT-l5 zapier" was created');
    expect(mail.to).toMatch(/^ACCT-l5-pro-/);
    expect(`${mail.text}${mail.html}`).toContain("revoke");
    expect(`${mail.text}${mail.html}`).not.toContain(secretPart);
    const list = await call(users.pro, "/api/account/api-keys");
    expect(list.data.keys).toEqual([{ ...item }]);
  });
  it("caps active keys per account", async () => {
    stepUp(users.other);
    // Prefixes are random: lane 1's DDL puts a unique index on account_api_keys.prefix.
    const filler = Array.from({ length: MAX_API_KEYS }, (_, i) => `('key_cap${randomBytes(6).toString("hex")}',${users.other},'ACCT-l5 cap ${i}','${randomBytes(4).toString("hex")}','0000','hash','{read}')`).join(",");
    await pool.query(`INSERT INTO account_api_keys(id,user_id,name,prefix,suffix,secret_hash,scopes) VALUES ${filler}`);
    const r = await call(users.other, "/api/account/api-keys", "POST", { name: "one too many", scopes: ["read"] });
    expect(r.status).toBe(403); expect(r.data).toMatchObject({ code: "limit_reached", feature: "api_keys", limit: MAX_API_KEYS, used: MAX_API_KEYS });
    await pool.query("UPDATE account_api_keys SET revoked_at=now() WHERE user_id=$1", [users.other]);
    const again = await call(users.other, "/api/account/api-keys", "POST", { name: "ACCT-l5 after revoke", scopes: ["read"] });
    expect(again.status).toBe(201);
  });
  it("refuses a member acting for the owner: keys belong to the account itself", async () => {
    stepUp(users.member);
    const r = await call(users.member, "/api/account/api-keys", "POST", { name: "ACCT-l5 member", scopes: ["read"] }, { "x-fixture-acting-for": String(users.pro) });
    expect(r.status).toBe(403); expect(r.data.message).toMatch(/account owner/);
    expect((await pool.query("SELECT count(*)::int n FROM account_api_keys WHERE user_id=$1", [users.pro])).rows[0].n).toBe(1);
  });
});

describe("PATCH / DELETE /api/account/api-keys/:id", () => {
  it("renames, sets and clears the key limit for the owner only", async () => {
    const [{ id }] = (await call(users.pro, "/api/account/api-keys")).data.keys;
    expect((await call(users.pro, `/api/account/api-keys/${id}`, "PATCH", {})).status).toBe(400);
    expect((await call(users.pro, `/api/account/api-keys/${id}`, "PATCH", { name: "" })).status).toBe(400);
    expect((await call(users.pro, `/api/account/api-keys/${id}`, "PATCH", { monthlyUnitLimit: -4 })).status).toBe(400);
    expect((await call(users.other, `/api/account/api-keys/${id}`, "PATCH", { name: "stolen" })).status).toBe(404);
    expect((await call(users.pro, "/api/account/api-keys/../etc", "PATCH", { name: "x" })).status).toBe(404);
    const renamed = await call(users.pro, `/api/account/api-keys/${id}`, "PATCH", { name: "ACCT-l5 zapier v2", monthlyUnitLimit: null });
    expect(renamed.status).toBe(200); expect(renamed.data.item).toMatchObject({ id, name: "ACCT-l5 zapier v2", monthlyUnitLimit: null });
    const limited = await call(users.pro, `/api/account/api-keys/${id}`, "PATCH", { monthlyUnitLimit: 100 });
    expect(limited.data.item).toMatchObject({ id, name: "ACCT-l5 zapier v2", monthlyUnitLimit: 100 });
    expect(await activity(users.pro, "security.api_key_updated")).toHaveLength(2);
    expect((await pool.query("SELECT name FROM account_api_keys WHERE id=$1", [id])).rows[0].name).toBe("ACCT-l5 zapier v2");
  });
  it("meters this month's units per key and serves a zero-filled daily series by key", async () => {
    const [{ id: a }] = (await call(users.pro, "/api/account/api-keys")).data.keys;
    stepUp(users.pro);
    const { id: b } = (await call(users.pro, "/api/account/api-keys", "POST", { name: "ACCT-l5 second", scopes: ["read"] })).data.item;
    const [{ id: theirs }] = (await call(users.other, "/api/account/api-keys")).data.keys;
    const add = (key: string, user: number, dayExpr: string, units: number, requests: number) => pool.query(
      `INSERT INTO account_api_usage(key_id,user_id,day,units,requests) VALUES($1,$2,${dayExpr},$3,$4)
       ON CONFLICT(key_id,day) DO UPDATE SET units=account_api_usage.units+EXCLUDED.units, requests=account_api_usage.requests+EXCLUDED.requests`, [key, user, units, requests]);
    await add(a, users.pro, "CURRENT_DATE", 120, 3);
    await add(a, users.pro, "CURRENT_DATE - 1", 30, 1);
    await add(b, users.pro, "CURRENT_DATE", 5, 1);
    await add(a, users.pro, "CURRENT_DATE - 40", 1000, 10);
    await add(theirs, users.other, "CURRENT_DATE", 999, 9);
    const { rows: [{ yesterday_in_month: yim, today }] } = await pool.query("SELECT (CURRENT_DATE - 1) >= date_trunc('month', CURRENT_DATE)::date AS yesterday_in_month, to_char(CURRENT_DATE,'YYYY-MM-DD') AS today");

    const list = await call(users.pro, "/api/account/api-keys");
    const byId = Object.fromEntries(list.data.keys.map((k: any) => [k.id, k.unitsThisMonth]));
    expect(byId[a]).toBe(120 + (yim ? 30 : 0)); expect(byId[b]).toBe(5);
    expect(list.data.plan.usedThisMonth).toBe(125 + (yim ? 30 : 0));

    const week = await call(users.pro, "/api/account/api-usage?days=7");
    expect(week.status).toBe(200);
    expect(week.data.days).toHaveLength(7);
    expect(week.data.days.at(-1)).toEqual({ date: today, units: 125, requests: 4, byKey: { [a]: 120, [b]: 5 } });
    expect(week.data.days.at(-2)).toMatchObject({ units: 30, requests: 1, byKey: { [a]: 30 } });
    expect(week.data.days[0]).toMatchObject({ units: 0, requests: 0, byKey: {} });
    expect(week.data.totals).toEqual({ units: 155, requests: 5 });
    expect(week.data.days.map((d: any) => d.date)).toEqual([...week.data.days.map((d: any) => d.date)].sort());

    const wide = await call(users.pro, "/api/account/api-usage?days=400");
    expect(wide.data.days).toHaveLength(MAX_USAGE_DAYS); expect(wide.data.totals).toEqual({ units: 1155, requests: 15 });
    expect((await call(users.pro, "/api/account/api-usage?days=abc")).data.days).toHaveLength(30);
    expect((await call(users.other, "/api/account/api-usage?days=1")).data.totals).toEqual({ units: 999, requests: 9 });
    expect((await call(null, "/api/account/api-usage")).status).toBe(401);
  });
  it("revokes in place (usage history keeps its key), hides the key, logs + notifies + emails; repeats and other owners are 404", async () => {
    const keys = (await call(users.pro, "/api/account/api-keys")).data.keys;
    const target = keys.find((k: any) => k.name === "ACCT-l5 second");
    sent.mockClear();
    expect((await call(users.other, `/api/account/api-keys/${target.id}`, "DELETE")).status).toBe(404);
    expect((await call(users.member, `/api/account/api-keys/${target.id}`, "DELETE", undefined, { "x-fixture-acting-for": String(users.pro) })).status).toBe(403);
    const r = await call(users.pro, `/api/account/api-keys/${target.id}`, "DELETE");
    expect(r.status).toBe(200); expect(r.data).toEqual({ ok: true });
    expect((await call(users.pro, `/api/account/api-keys/${target.id}`, "DELETE")).status).toBe(404);
    expect((await call(users.pro, `/api/account/api-keys/${target.id}`, "PATCH", { name: "ghost" })).status).toBe(404);
    const { rows: [row] } = await pool.query("SELECT revoked_at FROM account_api_keys WHERE id=$1", [target.id]);
    expect(row.revoked_at).toBeTruthy();
    expect((await pool.query("SELECT count(*)::int n FROM account_api_usage WHERE key_id=$1", [target.id])).rows[0].n).toBe(1);
    const after = await call(users.pro, "/api/account/api-keys");
    expect(after.data.keys.map((k: any) => k.id)).not.toContain(target.id);
    expect(after.data.plan.usedThisMonth).toBe((await call(users.pro, "/api/account/api-keys")).data.plan.usedThisMonth);
    expect((await activity(users.pro, "security.api_key_revoked"))[0].detail).toEqual({ keyId: target.id, name: "ACCT-l5 second", prefix: target.prefix, suffix: target.suffix });
    expect((await notifications(users.pro, "security.api_key_revoked"))[0]).toMatchObject({ title: 'API key "ACCT-l5 second" was revoked' });
    expect(sent).toHaveBeenCalledTimes(1);
    expect(sent.mock.calls[0][0].subject).toBe('ConstructHUB: API key "ACCT-l5 second" was revoked');
  });
});

describe("createApiKey integration", () => {
  it("normalizes either row spelling to the table's columns", () => {
    const at = new Date("2026-09-30T12:00:00Z");
    const camel = normalizeRow({ id: "key_a", userId: 7, name: "n", prefix: "p", suffix: "s", scopes: ["read"], monthlyUnitLimit: 50, expiresAt: at, lastUsedAt: null, revokedAt: null, createdAt: at });
    expect(camel).toEqual({ id: "key_a", user_id: 7, name: "n", prefix: "p", suffix: "s", scopes: ["read"], monthly_unit_limit: 50, expires_at: at, last_used_at: null, revoked_at: null, created_at: at });
    const snake = normalizeRow({ id: "key_b", user_id: 8, name: "n", prefix: "p", suffix: "s", scopes: ["write"], monthly_unit_limit: null, expires_at: null, last_used_at: at, revoked_at: null, created_at: at });
    expect(snake).toMatchObject({ user_id: 8, monthly_unit_limit: null, expires_at: null, last_used_at: at, created_at: at });
    expect(normalizeRow({ id: "key_c", name: "n", prefix: "p", suffix: "s", scopes: [] }, 9)).toMatchObject({ user_id: 9, monthly_unit_limit: null, expires_at: null });
  });
  it("accepts lane 1's camelCase row from createApiKey and still reports the limit and dates", async () => {
    // server/account/api-keys.ts returns { userId, monthlyUnitLimit, expiresAt, createdAt, … }, not the table's columns.
    activeDeps = {
      async createApiKey(userId, input) {
        const { secret, row: r } = await deps.createApiKey(userId, input);
        return { secret, row: { id: r.id, userId: r.user_id!, name: r.name, prefix: r.prefix, suffix: r.suffix, scopes: r.scopes, monthlyUnitLimit: r.monthly_unit_limit!, expiresAt: r.expires_at!, lastUsedAt: r.last_used_at!, revokedAt: r.revoked_at!, createdAt: r.created_at! } };
      },
    };
    try {
      stepUp(users.other);
      const r = await call(users.other, "/api/account/api-keys", "POST", { name: "ACCT-l5 camel", scopes: ["read"], monthlyUnitLimit: 777, expiresInDays: 10 });
      expect(r.status).toBe(201);
      expect(r.data.key).toMatch(/^chub_/);
      expect(r.data.item).toMatchObject({ name: "ACCT-l5 camel", monthlyUnitLimit: 777, lastUsedAt: null });
      expect(typeof r.data.item.createdAt).toBe("string");
      expect(new Date(r.data.item.expiresAt).getTime()).toBeGreaterThan(Date.now() + 9 * 86400_000);
      const listed = (await call(users.other, "/api/account/api-keys")).data.keys.find((k: any) => k.id === r.data.item.id);
      expect(listed).toEqual(r.data.item);
      const [created] = (await activity(users.other, "security.api_key_created")).slice(-1);
      expect(created.detail).toMatchObject({ keyId: r.data.item.id, monthlyUnitLimit: 777 });
      expect(created.detail.expiresAt).toBe(r.data.item.expiresAt);
    } finally { activeDeps = deps; }
  });
  it("still returns the one-time secret when the security event cannot be recorded", async () => {
    stepUp(users.other); sent.mockClear();
    notify.mockRejectedValueOnce(new Error("ACCT-l5 notification outage"));
    const r = await call(users.other, "/api/account/api-keys", "POST", { name: "ACCT-l5 outage", scopes: ["read"] });
    expect(r.status).toBe(201);
    expect(r.data.key).toMatch(/^chub_/);
    expect((await pool.query("SELECT secret_hash FROM account_api_keys WHERE id=$1", [r.data.item.id])).rows[0].secret_hash).toBe(sha(r.data.key));
    // The other steps still ran: the activity row and (the kind is not registered yet) the direct security email.
    expect((await activity(users.other, "security.api_key_created")).some((a) => a.detail.keyId === r.data.item.id)).toBe(true);
    expect(sent).toHaveBeenCalledTimes(1);
  });
});
