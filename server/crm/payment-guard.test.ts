/**
 * server/crm/payment-guard.ts — the payments firewall: budgets, JSON-only
 * bodies on money writes, and idempotent replays. No server, no database.
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  paymentWriteLimit, paymentSettingsLimit, publicPayLimit, replayIdempotent, rememberIdempotent, _resetIdempotency, PAYMENT_LIMITS,
  claimIdempotent, releaseIdempotent,
} from "./payment-guard";

function req(over: Partial<any> = {}) {
  const headers: Record<string, string> = { "content-type": "application/json", "content-length": "12", ...(over.headers ?? {}) };
  return {
    method: "POST", path: "/api/crm/invoices/x/payments", ip: over.ip ?? "203.0.113.9", socket: {}, params: over.params ?? {},
    user: over.user, headers,
    is: (type: string) => (headers["content-type"] || "").includes(type.replace("application/", "")) ? type : false,
    ...over,
  };
}
function res() {
  const r: any = { statusCode: 200, body: null };
  r.status = (s: number) => { r.statusCode = s; return r; };
  r.json = (b: unknown) => { r.body = b; return r; };
  return r;
}

describe("payments guard budgets", () => {
  it("lets ordinary traffic through and refuses a burst with a 429 that names the wait", () => {
    const ip = `198.51.100.${Math.floor(Math.random() * 250)}`;
    let passed = 0, refused = 0, last: any = null;
    for (let i = 0; i < PAYMENT_LIMITS.write + 5; i++) {
      const r = res();
      paymentWriteLimit(req({ ip, user: { id: 9000 + Number(ip.split(".")[3]) } }) as any, r, () => { passed++; });
      if (r.statusCode === 429) { refused++; last = r.body; }
    }
    expect(passed).toBe(PAYMENT_LIMITS.write);
    expect(refused).toBe(5);
    expect(last.message).toMatch(/wait a few minutes/i);
  });

  it("refuses a form-encoded body on a money write (CSRF defence in depth) with 415", () => {
    const r = res();
    let next = false;
    paymentWriteLimit(req({ headers: { "content-type": "application/x-www-form-urlencoded", "content-length": "20" }, user: { id: 1 } }) as any, r, () => { next = true; });
    expect(next).toBe(false);
    expect(r.statusCode).toBe(415);
  });

  it("settings writes have their own, smaller budget", () => {
    const user = { id: 77001 + Math.floor(Math.random() * 1000) };
    let passed = 0;
    for (let i = 0; i < PAYMENT_LIMITS.settings + 3; i++) paymentSettingsLimit(req({ user, path: "/api/crm/payments/settings" }) as any, res(), () => { passed++; });
    expect(passed).toBe(PAYMENT_LIMITS.settings);
  });

  it("public pay routes are limited per IP and per document token", () => {
    const token = `tok${Math.random().toString(16).slice(2)}`;
    let passed = 0;
    for (let i = 0; i < PAYMENT_LIMITS.publicPay + 4; i++) {
      publicPayLimit(req({ method: "GET", ip: `192.0.2.${i % 3}`, params: { token }, headers: {} , path: `/api/public/invoices/${token}/pay-info` }) as any, res(), () => { passed++; });
    }
    // Three IPs × 20 would allow 60; the token budget (40) is the binding one here.
    expect(passed).toBeLessThanOrEqual(PAYMENT_LIMITS.publicPay * 2);
    expect(passed).toBeGreaterThan(0);
  });
});

describe("idempotent payment writes", () => {
  beforeEach(() => _resetIdempotency());
  it("replays the first answer for the same org + route + key, and nothing without a key", () => {
    const r1 = req({ headers: { "idempotency-key": "form-abc-12345678" } });
    expect(replayIdempotent(r1 as any, "org1")).toBeNull();
    rememberIdempotent(r1 as any, "org1", 201, { payment: { id: "p1" } });
    expect(replayIdempotent(r1 as any, "org1")).toEqual({ status: 201, body: { payment: { id: "p1" } } });
    // Another org, another route, or no key: never a replay.
    expect(replayIdempotent(r1 as any, "org2")).toBeNull();
    expect(replayIdempotent(req({ path: "/api/crm/estimates/x/payments", headers: { "idempotency-key": "form-abc-12345678" } }) as any, "org1")).toBeNull();
    expect(replayIdempotent(req() as any, "org1")).toBeNull();
  });
  it("claims a key before the work: a second request in flight is 'inflight', a retry after success replays, a failure frees it", () => {
    const r = req({ headers: { "idempotency-key": "form-claim-12345678" } });
    expect(claimIdempotent(r as any, "org1")).toEqual({ kind: "claimed" });
    expect(claimIdempotent(r as any, "org1")).toEqual({ kind: "inflight" });
    rememberIdempotent(r as any, "org1", 201, { payment: { id: "p2" } });
    expect(claimIdempotent(r as any, "org1")).toEqual({ kind: "replay", status: 201, body: { payment: { id: "p2" } } });
    const r2 = req({ headers: { "idempotency-key": "form-fail-12345678" } });
    expect(claimIdempotent(r2 as any, "org1").kind).toBe("claimed");
    releaseIdempotent(r2 as any, "org1");
    expect(claimIdempotent(r2 as any, "org1").kind).toBe("claimed");
    expect(claimIdempotent(req() as any, "org1")).toEqual({ kind: "none" });
  });
  it("refuses a chunked non-JSON body even without a content-length", () => {
    const r = res();
    let next = false;
    paymentWriteLimit(req({ headers: { "content-type": "application/x-www-form-urlencoded", "transfer-encoding": "chunked" }, user: { id: 2 } }) as any, r, () => { next = true; });
    expect(next).toBe(false);
    expect(r.statusCode).toBe(415);
  });
  it("ignores keys that are too short to be a real form key", () => {
    const r = req({ headers: { "idempotency-key": "short" } });
    rememberIdempotent(r as any, "org1", 201, { ok: true });
    expect(replayIdempotent(r as any, "org1")).toBeNull();
  });
});
