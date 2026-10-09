/**
 * The request log line (server/request-log.ts): no response body in production — the 2026-10-09 reliability
 * review found CRM customer names, addresses, emails and phone numbers in the systemd journal (M7) — only method,
 * path, status, duration and a request id; a 5xx adds one short scrubbed message. Development echoes a body only
 * with LOG_RESPONSE_BODIES=1, and the body exclusions hold whatever case the path is written in (red-team round 2,
 * F3: "POST /api/Hub/chat" reached the Hub router, which is case-insensitive, and its reply was written to stdout).
 */
import { describe, expect, it } from "vitest";
import { BODY_ECHO_MAX, bodyEchoEnabled, formatRequestLogLine, isSiteScanPath, loggedPath, requestIdFor, responseBodyLoggable, scrubForLog } from "./request-log";

const CUSTOMER = { id: 7, name: "Dana Whitfield", email: "dana.whitfield@example.com", phone: "(360) 555-0142", address: "12 Harbor Ln, Bellingham WA" };
const PROD = { NODE_ENV: "production" } as NodeJS.ProcessEnv;
const DEV = { NODE_ENV: "development" } as NodeJS.ProcessEnv;
const DEV_ECHO = { NODE_ENV: "development", LOG_RESPONSE_BODIES: "1" } as NodeJS.ProcessEnv;

describe("the request log line", () => {
  it("in production carries method, path, status, duration and id — and no part of a JSON body", () => {
    const line = formatRequestLogLine({ method: "GET", path: "/api/crm/customers", status: 200, durationMs: 12, requestId: "3f9a1c2b", body: { items: [CUSTOMER] }, env: PROD });
    expect(line).toBe("GET /api/crm/customers 200 in 12ms id=3f9a1c2b");
    for (const v of Object.values(CUSTOMER)) expect(line).not.toContain(String(v));
    expect(line).not.toContain("{");
  });

  it("drops the query string (tokens, emails) from the path", () => {
    const line = formatRequestLogLine({ method: "GET", path: "/api/permits/search?token=abc123&email=x@y.com", status: 200, durationMs: 3, requestId: "r1", env: PROD });
    expect(line).toBe("GET /api/permits/search 200 in 3ms id=r1");
    expect(loggedPath("/api/sitescan/report/" + "a".repeat(64) + "?x=1")).toBe("/api/sitescan/report/:token");
  });

  it("by default development logs no body either; LOG_RESPONSE_BODIES=1 opts in, truncated, exclusions kept", () => {
    const body = { items: [CUSTOMER] };
    expect(formatRequestLogLine({ method: "GET", path: "/api/crm/customers", status: 200, durationMs: 1, requestId: "r", body, env: DEV })).not.toContain("Dana");
    expect(bodyEchoEnabled(DEV)).toBe(false);
    expect(bodyEchoEnabled(PROD)).toBe(false);
    expect(bodyEchoEnabled({ NODE_ENV: "production", LOG_RESPONSE_BODIES: "1" } as NodeJS.ProcessEnv)).toBe(false);
    expect(bodyEchoEnabled(DEV_ECHO)).toBe(true);
    const echoed = formatRequestLogLine({ method: "GET", path: "/api/crm/customers", status: 200, durationMs: 1, requestId: "r", body, env: DEV_ECHO });
    expect(echoed).toContain(":: {\"items\"");
    const big = formatRequestLogLine({ method: "GET", path: "/api/x", status: 200, durationMs: 1, requestId: "r", body: { s: "x".repeat(5000) }, env: DEV_ECHO });
    expect(big.length).toBeLessThan(BODY_ECHO_MAX + 120);
    expect(big).toMatch(/…\(\d+ chars\)$/);
    // Even opted in, a Hub reply or an auth body is never echoed.
    expect(formatRequestLogLine({ method: "POST", path: "/api/Hub/chat", status: 200, durationMs: 1, requestId: "r", body: { reply: "SECRET-REPLY" }, env: DEV_ECHO })).not.toContain("SECRET-REPLY");
    expect(formatRequestLogLine({ method: "GET", path: "/api/auth/2fa/setup", status: 200, durationMs: 1, requestId: "r", body: { seed: "SEED" }, env: DEV_ECHO })).not.toContain("SEED");
  });

  it("a 5xx adds one short message — without addresses or long numbers, cut at the limit — and nothing else of the body", () => {
    const line = formatRequestLogLine({ method: "POST", path: "/api/crm/invoices", status: 500, durationMs: 40, requestId: "r9",
      body: { message: `Could not email dana.whitfield@example.com at (360) 555-0142: ${"x".repeat(400)}`, customer: CUSTOMER }, env: PROD });
    expect(line.startsWith("POST /api/crm/invoices 500 in 40ms id=r9 :: Could not email [email] at [number]:")).toBe(true);
    expect(line).not.toContain("Dana");
    expect(line).not.toContain("example.com");
    expect(line.length).toBeLessThan(300);
    // A 5xx without a string message stays bare.
    expect(formatRequestLogLine({ method: "GET", path: "/api/x", status: 503, durationMs: 1, requestId: "r", body: { configured: false }, env: PROD })).toBe("GET /api/x 503 in 1ms id=r");
  });

  it("scrubs emails and long numbers, keeps short numbers (status codes, counts)", () => {
    expect(scrubForLog("row 42 failed for a@b.co; call +1 360-555-0142")).toBe("row 42 failed for [email]; call [number]");
  });

  it("takes the edge's request id when it is well-formed, else makes one", () => {
    expect(requestIdFor({ "cf-ray": "8d3f1a2b3c4d5e6f-SEA" })).toBe("8d3f1a2b3c4d5e6f-SEA");
    expect(requestIdFor({ "x-request-id": "abc 123" })).toMatch(/^[0-9a-f]{8}$/);
    expect(requestIdFor({})).toMatch(/^[0-9a-f]{8}$/);
  });
});

describe("responseBodyLoggable", () => {
  it.each(["/api/hub/chat", "/api/Hub/chat", "/api/HUB/preset", "/API/HUB/PRESETS", "/api/hUb/chat"])("never logs a Hub reply: %s", (path) => {
    expect(responseBodyLoggable(path)).toBe(false);
  });

  it.each(["/api/Auth/2fa/setup", "/api/SOCIAL/upload", "/api/GBP/connect", "/api/Ads/campaigns", "/api/CloudFlare/zones", "/api/GSC/sites", "/api/Domains/x", "/api/Mail-Alerts/x", "/api/SiteScan/abc",
    "/api/v1/customers", "/api/account/api-keys", "/api/crm/voice/calls", "/api/voice-internal/x", "/api/admin/issues", "/api/ops-internal/x", "/api/ops/x"])(
    "keeps every secret-bearing exclusion case-insensitive: %s", (path) => {
      expect(responseBodyLoggable(path)).toBe(false);
    });

  it("would allow ordinary API bodies (only when echoes are switched on)", () => {
    expect(responseBodyLoggable("/api/permits/search")).toBe(true);
    expect(responseBodyLoggable("/api/crm/clients")).toBe(true);
  });

  it("site-scan token paths are recognised in any case", () => {
    expect(isSiteScanPath("/api/SiteScan/report/abc")).toBe(true);
    expect(isSiteScanPath("/api/Agency/x")).toBe(true);
    expect(isSiteScanPath("/api/crm/clients")).toBe(false);
  });
});
