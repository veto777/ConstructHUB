/**
 * The /api/v1 public API end to end on an ephemeral express server against
 * the local lane DB: key auth, CRM chk_ coexistence, scopes, rate limit,
 * plan + per-key quota, metering, headers, the registry and openapi.json.
 * Fixtures carry the ACCT- prefix and are removed in afterAll.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import express, { Router } from "express";
import { pool } from "../db";
import { ensureAccountSchema } from "../account/schema";
import { createApiKey, recordUnits, revokeApiKey, unitsThisMonth } from "../account/api-keys";
import { registerPublicApi, registerResource, resetRateLimits, listResources, READ_UNITS, WRITE_UNITS, unitsFor } from "./index";
import { inferRows } from "./quota";

const users: number[] = [];
async function account(plan?: "starter" | "pro" | "growth" | "agency") {
  const { rows: [u] } = await pool.query("INSERT INTO users(email) VALUES($1) RETURNING id", [`acct-l1-api-${randomUUID()}@example.invalid`]);
  users.push(u.id);
  if (plan) await pool.query(
    "INSERT INTO subscriptions(user_id, plan, status, stripe_subscription_id) VALUES($1, $2, 'active', $3)", [u.id, plan, `sub_ACCT_${randomUUID()}`]);
  return u.id as number;
}
async function key(userId: number, scopes: string[] = ["read", "write"], extra: { monthlyUnitLimit?: number; expiresInDays?: number } = {}) {
  const { secret, row } = await createApiKey(userId, { name: `ACCT-${scopes.join("+")}`, scopes, ...extra });
  return { token: secret, id: row.id };
}

let base = "";
let server: ReturnType<express.Express["listen"]>;
const call = (path: string, init: RequestInit & { token?: string } = {}) => {
  const headers: Record<string, string> = { ...(init.headers as Record<string, string> ?? {}) };
  if (init.token) headers.Authorization = `Bearer ${init.token}`;
  if (init.body) headers["Content-Type"] = "application/json";
  return fetch(`${base}${path}`, { ...init, headers });
};

beforeAll(async () => {
  const url = new URL(process.env.DATABASE_URL!);
  if (!["localhost", "127.0.0.1"].includes(url.hostname) || !/^\/constructhub_dev(?:_a\d+)?$/.test(url.pathname)) throw new Error("Local lane development database required");
  await ensureAccountSchema();

  const app = express();
  app.use(express.json());
  registerPublicApi(app);
  // The CRM's chk_-key routes, registered AFTER the public API exactly as server/routes.ts does.
  app.get("/api/v1", (_req, res) => res.json({ crm: "index" }));
  app.get("/api/v1/customers", (req, res) => res.json({ crm: "customers", auth: req.headers.authorization ?? null }));
  app.get("/api/v1/ping", (req, res) => res.json({ crm: "ping", auth: req.headers.authorization ?? null }));

  const widgets = Router();
  widgets.get("/", (req, res) => {
    const n = Math.max(0, parseInt(String(req.query.n ?? "3")) || 0);
    res.json({ data: Array.from({ length: n }, (_, i) => ({ i })), hasMore: false, who: req.publicApi?.userId });
  });
  widgets.get("/explicit", (_req, res) => { res.locals.apiRows = 1000; res.json({ ok: true }); });
  widgets.get("/missing", (_req, res) => res.status(404).json({ error: { code: "not_found", message: "no such widget" } }));
  widgets.get("/boom", () => { throw new Error("secret stack details"); });
  widgets.post("/", (req, res) => res.status(201).json({ id: "w_1", echo: req.body, source: "api" }));
  widgets.delete("/:id", (_req, res) => res.status(204).end());
  registerResource("acct-widgets", widgets, {
    paths: { "/": { get: { summary: "List widgets" }, post: { summary: "Create a widget" } }, "/{id}": { delete: { summary: "Delete" } } },
    components: { schemas: { Widget: { type: "object" } } },
    tags: [{ name: "widgets" }],
  });
  registerResource("acct-nested/items", Router().get("/", (_req, res) => res.json([1, 2])), { paths: { "": { get: {} } } });

  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", () => r()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  await pool.query("DELETE FROM account_api_usage WHERE user_id=ANY($1::int[])", [users]);
  await pool.query("DELETE FROM account_api_keys WHERE user_id=ANY($1::int[])", [users]);
  await pool.query("DELETE FROM subscriptions WHERE user_id=ANY($1::int[])", [users]);
  await pool.query("DELETE FROM users WHERE id=ANY($1::int[])", [users]);
  await pool.end();
});
beforeEach(() => resetRateLimits());

describe("openapi.json", () => {
  it("is public and assembles the registered resources under their prefixes", async () => {
    const r = await call("/api/v1/openapi.json");
    expect(r.status).toBe(200);
    const doc = await r.json();
    expect(doc.openapi).toBe("3.0.3");
    expect(Object.keys(doc.paths)).toEqual(expect.arrayContaining(["/me", "/acct-widgets", "/acct-widgets/{id}", "/acct-nested/items"]));
    expect(doc.paths["/acct-widgets"].post.summary).toBe("Create a widget");
    expect(doc.components.schemas).toHaveProperty("Widget");
    expect(doc.components.schemas).toHaveProperty("Error");
    expect(doc.components.securitySchemes.apiKey.scheme).toBe("bearer");
    expect(doc.tags.map((t: any) => t.name)).toContain("widgets");
    expect(doc["x-limits"].unitsPerMonth).toEqual({ starter: 0, pro: 10_000, growth: 50_000, agency: 250_000 });
    expect(doc.info.description).toMatch(/never runs TruthCoder AI/);
  });
});

describe("coexistence with the CRM's chk_ keys", () => {
  it("leaves CRM paths to the CRM when no chub_ token is present", async () => {
    expect(await (await call("/api/v1")).json()).toEqual({ crm: "index" });
    expect(await (await call("/api/v1/customers")).json()).toEqual({ crm: "customers", auth: null });
    const chk = await call("/api/v1/customers", { token: "chk_abc123" });
    expect(await chk.json()).toEqual({ crm: "customers", auth: "Bearer chk_abc123" });
    expect(await (await call("/api/v1/ping", { token: "chk_abc123" })).json()).toMatchObject({ crm: "ping" });
  });

  it("never lets a chub_ key reach a CRM route", async () => {
    const uid = await account("pro");
    const k = await key(uid);
    const r = await call("/api/v1/customers", { token: k.token });
    expect(r.status).toBe(404);
    const body = await r.json();
    expect(body.error.code).toBe("not_found");
    expect(body.error.message).toMatch(/chk_ keys/);
  });
});

describe("authentication", () => {
  it("answers a public resource without a key with a JSON 401 (never the SPA)", async () => {
    const r = await call("/api/v1/acct-widgets");
    expect(r.status).toBe(401);
    expect(r.headers.get("content-type")).toMatch(/json/);
    expect((await r.json()).error).toMatchObject({ code: "unauthorized" });
    expect((await (await call("/api/v1/acct-widgets", { token: "chk_notours" })).json()).error.code).toBe("unauthorized");
  });

  it("rejects malformed, unknown, tampered, revoked and expired keys with 401", async () => {
    const uid = await account("pro");
    const k = await key(uid);
    for (const token of ["chub_x", `chub_zzzzzzzz_${"0".repeat(64)}`, k.token.slice(0, -1) + (k.token.endsWith("0") ? "1" : "0")]) {
      const r = await call("/api/v1/me", { token });
      expect(r.status, token).toBe(401);
      expect((await r.json()).error.code).toBe("invalid_api_key");
    }
    expect((await call("/api/v1/me", { token: k.token })).status).toBe(200);
    await revokeApiKey(uid, k.id);
    expect((await call("/api/v1/me", { token: k.token })).status).toBe(401);
    const expired = await key(uid, ["read"], { expiresInDays: 1 });
    await pool.query("UPDATE account_api_keys SET expires_at=now()-interval '1 minute' WHERE id=$1", [expired.id]);
    expect((await call("/api/v1/me", { token: expired.token })).status).toBe(401);
  });

  it("/me describes the key, the plan and this month's usage", async () => {
    const uid = await account("growth");
    const k = await key(uid, ["read"], { monthlyUnitLimit: 900 });
    const r = await call("/api/v1/me", { token: k.token });
    expect(r.status).toBe(200);
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect(r.headers.get("x-ratelimit-limit")).toBe("60");
    expect(r.headers.get("x-ratelimit-remaining")).toBe("59");
    expect(r.headers.get("x-units-remaining")).toBe("899");
    const me = await r.json();
    expect(me).toMatchObject({
      userId: uid,
      key: { id: k.id, scopes: ["read"], monthlyUnitLimit: 900, usedThisMonth: 0 },
      plan: { key: "growth", unitsPerMonth: 50_000, usedThisMonth: 0, ratePerMinute: 60 },
    });
    expect(me.resources).toEqual(expect.arrayContaining(["acct-widgets", "acct-nested/items"]));
    expect(JSON.stringify(me)).not.toContain(k.token.split("_")[2]);
    expect(await unitsThisMonth(k.id)).toBe(READ_UNITS);
  });
});

describe("scopes", () => {
  it("GET needs read, writes need write", async () => {
    const uid = await account("pro");
    const ro = await key(uid, ["read"]), wo = await key(uid, ["write"]);
    const denied = await call("/api/v1/acct-widgets", { method: "POST", token: ro.token, body: JSON.stringify({ a: 1 }) });
    expect(denied.status).toBe(403);
    expect((await denied.json()).error).toMatchObject({ code: "insufficient_scope", required: "write", scopes: ["read"] });
    const deniedRead = await call("/api/v1/acct-widgets", { token: wo.token });
    expect(deniedRead.status).toBe(403);
    expect((await deniedRead.json()).error.required).toBe("read");
    const created = await call("/api/v1/acct-widgets", { method: "POST", token: wo.token, body: JSON.stringify({ title: "as supplied" }) });
    expect(created.status).toBe(201);
    expect(await created.json()).toEqual({ id: "w_1", echo: { title: "as supplied" }, source: "api" });
    expect(await unitsThisMonth(ro.id)).toBe(0);
    expect(await unitsThisMonth(wo.id)).toBe(WRITE_UNITS);
  });
});

describe("plan and quota", () => {
  it("Starter and plan-less accounts get 402 plan_required naming Pro", async () => {
    for (const plan of ["starter", undefined] as const) {
      const uid = await account(plan);
      const k = await key(uid);
      const r = await call("/api/v1/acct-widgets", { token: k.token });
      expect(r.status, String(plan)).toBe(402);
      expect((await r.json()).error).toMatchObject({ code: "plan_required", requiredPlan: "pro" });
      expect(r.headers.get("x-units-remaining")).toBe("0");
      expect(await unitsThisMonth(k.id)).toBe(0);
    }
  });

  it("meters reads by rows, writes flat, honours res.locals.apiRows and skips failures", async () => {
    const uid = await account("pro");
    const k = await key(uid);
    const list = await call("/api/v1/acct-widgets?n=250", { token: k.token });
    expect(list.status).toBe(200);
    expect((await list.json()).data).toHaveLength(250);
    expect(await unitsThisMonth(k.id)).toBe(unitsFor("GET", 250)); // 1 + 2
    expect(unitsFor("GET", 250)).toBe(3);
    expect(unitsFor("GET", 99)).toBe(1);
    expect(unitsFor("POST", 5000)).toBe(5);
    expect(inferRows({ items: [1, 2] })).toBe(2);
    expect(inferRows([1])).toBe(1);
    expect(inferRows({ ok: true })).toBe(0);
    await call("/api/v1/acct-widgets/explicit", { token: k.token });
    expect(await unitsThisMonth(k.id)).toBe(3 + 11);
    await call("/api/v1/acct-nested/items", { token: k.token });
    expect(await unitsThisMonth(k.id)).toBe(14 + 1);
    const del = await call("/api/v1/acct-widgets/w_1", { method: "DELETE", token: k.token });
    expect(del.status).toBe(204);
    for (let i = 0; i < 20 && (await unitsThisMonth(k.id)) < 20; i++) await new Promise((r) => setTimeout(r, 25));
    expect(await unitsThisMonth(k.id)).toBe(15 + WRITE_UNITS);
    expect((await call("/api/v1/acct-widgets/missing", { token: k.token })).status).toBe(404);
    const boom = await call("/api/v1/acct-widgets/boom", { token: k.token });
    expect(boom.status).toBe(500);
    const body = await boom.json();
    expect(body.error.code).toBe("internal_error");
    expect(JSON.stringify(body)).not.toContain("secret stack");
    expect((await call("/api/v1/nothing-here", { token: k.token })).status).toBe(404);
    await new Promise((r) => setTimeout(r, 50));
    expect(await unitsThisMonth(k.id)).toBe(20);
    const remaining = await call("/api/v1/me", { token: k.token });
    expect(remaining.headers.get("x-units-remaining")).toBe(String(10_000 - 20 - 1));
  });

  it("stops a key at its own monthly limit (429 quota_exceeded, scope key)", async () => {
    const uid = await account("pro");
    const k = await key(uid, ["read", "write"], { monthlyUnitLimit: 7 });
    expect((await call("/api/v1/me", { token: k.token })).status).toBe(200); // 1
    const w = await call("/api/v1/acct-widgets", { method: "POST", token: k.token, body: "{}" }); // 5 → 6 used
    expect(w.status).toBe(201);
    const blocked = await call("/api/v1/acct-widgets", { method: "POST", token: k.token, body: "{}" }); // needs 5, 1 left
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("retry-after")).toMatch(/^\d+$/);
    expect(blocked.headers.get("x-units-remaining")).toBe("0");
    expect((await blocked.json()).error).toMatchObject({ code: "quota_exceeded", scope: "key", limit: 7, used: 6 });
    expect((await call("/api/v1/me", { token: k.token })).status).toBe(200); // a read still fits (7)
    const out = await call("/api/v1/me", { token: k.token });
    expect(out.status).toBe(429);
    expect((await out.json()).error.resetsAt).toMatch(/^\d{4}-\d{2}-01T00:00:00\.000Z$/);
    expect(await unitsThisMonth(k.id)).toBe(7);
    // Another key on the same account is unaffected by the first key's cap.
    const other = await key(uid, ["read"]);
    expect((await call("/api/v1/me", { token: other.token })).status).toBe(200);
  });

  it("stops the whole account at the plan's units (scope plan), across keys", async () => {
    const uid = await account("pro");
    const a = await key(uid, ["read"]), b = await key(uid, ["read"]);
    await recordUnits(a.id, uid, 9_998);
    expect((await call("/api/v1/me", { token: b.token })).status).toBe(200); // 9_999
    const last = await call("/api/v1/me", { token: b.token }); // 10_000
    expect(last.status).toBe(200);
    expect(last.headers.get("x-units-remaining")).toBe("0");
    const over = await call("/api/v1/me", { token: a.token });
    expect(over.status).toBe(429);
    expect((await over.json()).error).toMatchObject({ code: "quota_exceeded", scope: "plan", limit: 10_000, used: 10_000 });
  });
});

describe("rate limit", () => {
  it("allows 60 requests a minute per key, then 429 rate_limited with Retry-After", async () => {
    const uid = await account("agency");
    const k = await key(uid, ["read"]);
    let last: Response | null = null;
    for (let i = 0; i < 60; i++) {
      last = await call("/api/v1/acct-widgets?n=0", { token: k.token });
      expect(last.status, `request ${i + 1}`).toBe(200);
    }
    expect(last!.headers.get("x-ratelimit-remaining")).toBe("0");
    const blocked = await call("/api/v1/acct-widgets?n=0", { token: k.token });
    expect(blocked.status).toBe(429);
    expect((await blocked.json()).error).toMatchObject({ code: "rate_limited", limit: 60 });
    expect(Number(blocked.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(Number(blocked.headers.get("retry-after"))).toBeLessThanOrEqual(60);
    expect(await unitsThisMonth(k.id)).toBe(60);
    // A second key on the same account has its own window.
    const k2 = await key(uid, ["read"]);
    expect((await call("/api/v1/acct-widgets?n=0", { token: k2.token })).status).toBe(200);
    resetRateLimits();
    expect((await call("/api/v1/acct-widgets?n=0", { token: k.token })).status).toBe(200);
  });
});

describe("registry", () => {
  it("refuses CRM names, built-ins, duplicates and bad names", () => {
    const r = Router();
    for (const name of ["customers", "invoices/paid", "ping", "openapi.json", "me", "acct-widgets", "Bad", "has space", "/leading", "trailing/", "1digit"]) {
      expect(() => registerResource(name, r), name).toThrow();
    }
    expect(() => registerResource("acct-ok", null as any)).toThrow(/Router/);
    expect(listResources().map((x) => x.name)).toEqual(expect.arrayContaining(["acct-widgets", "acct-nested/items"]));
    expect(listResources().map((x) => x.name)).not.toContain("acct-ok");
  });
});
