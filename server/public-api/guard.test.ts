/**
 * An account API key (chub_…) authenticates ONLY /api/v1: on every other route
 * — session data, GBP, account settings, the CRM — it is refused with 401
 * before a handler runs. And the per-account request ceiling: minting more
 * keys never multiplies an account's requests per minute. No DB needed.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import { rejectApiKeysOutsidePublicApi } from "./guard";
import { ACCOUNT_RATE_PER_MINUTE, DEFAULT_RATE_PER_MINUTE, rateLimitByKey, resetRateLimits } from "./rate-limit";

let server: ReturnType<express.Express["listen"]>, base = "";

beforeAll(async () => {
  const app = express();
  app.use(rejectApiKeysOutsidePublicApi);
  for (const path of ["/api/locations", "/api/gbp/content", "/api/account/api-keys", "/api/crm/me", "/api/v1/locations", "/api/v1"]) {
    app.all(path, (req, res) => res.json({ reached: path, auth: req.headers.authorization ?? null }));
  }
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", () => r()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => { await new Promise<void>((r) => server.close(() => r())); });

const call = (path: string, auth?: string, method = "GET") =>
  fetch(base + path, { method, headers: auth ? { authorization: auth } : {} });

describe("rejectApiKeysOutsidePublicApi", () => {
  it("answers 401 unauthorized (JSON) to a chub_ key on /api/locations, /api/gbp/*, /api/account/*, /api/crm/*", async () => {
    for (const path of ["/api/locations", "/api/gbp/content", "/api/account/api-keys", "/api/crm/me"]) {
      for (const method of ["GET", "POST"]) {
        const r = await call(path, "Bearer chub_abcdefgh_" + "0".repeat(64), method);
        expect(r.status, `${method} ${path}`).toBe(401);
        expect(r.headers.get("content-type")).toMatch(/json/);
        const body = await r.json();
        expect(body.error).toMatchObject({ code: "unauthorized" });
        expect(body.reached).toBeUndefined();
      }
    }
  });

  it("lets a chub_ key through to /api/v1 and never touches requests without one (sessions, chk_ keys)", async () => {
    expect((await (await call("/api/v1/locations", "Bearer chub_abcdefgh_x")).json()).reached).toBe("/api/v1/locations");
    expect((await (await call("/api/v1", "bearer chub_lowercase")).json()).reached).toBe("/api/v1");
    expect((await (await call("/api/locations")).json()).reached).toBe("/api/locations");
    expect((await (await call("/api/crm/me", "Bearer chk_crmkey")).json()).reached).toBe("/api/crm/me");
    expect((await (await call("/api/account/api-keys", "Basic abc")).json()).reached).toBe("/api/account/api-keys");
  });
});

describe("rate ceilings", () => {
  const ctx = (keyId: string, userId: number) => ({ publicApi: { userId, key: { id: keyId }, scopes: ["read"], plan: { ratePerMinute: DEFAULT_RATE_PER_MINUTE } } }) as any;
  const run = (req: any) => new Promise<{ status: number; body: any; headers: Record<string, string> }>((resolve) => {
    const headers: Record<string, string> = {};
    const res: any = {
      setHeader: (k: string, v: string) => { headers[k.toLowerCase()] = v; },
      status(code: number) { this._status = code; return this; },
      json(body: unknown) { resolve({ status: this._status ?? 200, body, headers }); return this; },
    };
    rateLimitByKey(req, res, () => resolve({ status: 200, body: null, headers }));
  });

  it("caps one key at the plan rate (60/min) with X-RateLimit headers", async () => {
    resetRateLimits();
    for (let i = 0; i < DEFAULT_RATE_PER_MINUTE; i++) expect((await run(ctx("key_one", 1))).status).toBe(200);
    const blocked = await run(ctx("key_one", 1));
    expect(blocked.status).toBe(429);
    expect(blocked.body.error).toMatchObject({ code: "rate_limited", scope: "key", limit: DEFAULT_RATE_PER_MINUTE });
    expect(blocked.headers["retry-after"]).toBeTruthy();
    // A second key of the same account still has its own 60.
    expect((await run(ctx("key_two", 1))).status).toBe(200);
  });

  it("caps the whole account at ACCOUNT_RATE_PER_MINUTE across every key, so minting keys cannot multiply the rate", async () => {
    resetRateLimits();
    expect(ACCOUNT_RATE_PER_MINUTE).toBeGreaterThan(DEFAULT_RATE_PER_MINUTE);
    const keys = Math.ceil(ACCOUNT_RATE_PER_MINUTE / DEFAULT_RATE_PER_MINUTE) + 1; // more keys than the ceiling allows in full
    let allowed = 0, blockedByAccount = 0;
    for (let k = 0; k < keys; k++) {
      for (let i = 0; i < DEFAULT_RATE_PER_MINUTE; i++) {
        const r = await run(ctx(`key_${k}`, 7));
        if (r.status === 200) allowed++;
        else { expect(r.body.error).toMatchObject({ code: "rate_limited", scope: "account", limit: ACCOUNT_RATE_PER_MINUTE }); blockedByAccount++; }
      }
    }
    expect(allowed).toBe(ACCOUNT_RATE_PER_MINUTE);
    expect(blockedByAccount).toBe(keys * DEFAULT_RATE_PER_MINUTE - ACCOUNT_RATE_PER_MINUTE);
    // Another account is unaffected.
    expect((await run(ctx("key_other", 8))).status).toBe(200);
  });
});
