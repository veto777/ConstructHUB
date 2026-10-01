/**
 * The request log's body exclusions hold whatever case the path is written in
 * (red-team round 2, F3: "POST /api/Hub/chat" reached the Hub router, which is
 * case-insensitive, and its reply was written to stdout).
 */
import { describe, expect, it } from "vitest";
import { isSiteScanPath, responseBodyLoggable } from "./request-log";

describe("responseBodyLoggable", () => {
  it.each(["/api/hub/chat", "/api/Hub/chat", "/api/HUB/preset", "/API/HUB/PRESETS", "/api/hUb/chat"])("never logs a Hub reply: %s", (path) => {
    expect(responseBodyLoggable(path)).toBe(false);
  });

  it.each(["/api/Auth/2fa/setup", "/api/SOCIAL/upload", "/api/GBP/connect", "/api/Ads/campaigns", "/api/CloudFlare/zones", "/api/GSC/sites", "/api/Domains/x", "/api/Mail-Alerts/x", "/api/SiteScan/abc"])(
    "keeps every other secret-bearing exclusion case-insensitive: %s", (path) => {
      expect(responseBodyLoggable(path)).toBe(false);
    });

  it("still logs ordinary API bodies", () => {
    expect(responseBodyLoggable("/api/permits/search")).toBe(true);
    expect(responseBodyLoggable("/api/crm/clients")).toBe(true);
  });

  it("site-scan token paths are recognised in any case", () => {
    expect(isSiteScanPath("/api/SiteScan/report/abc")).toBe(true);
    expect(isSiteScanPath("/api/Agency/x")).toBe(true);
    expect(isSiteScanPath("/api/crm/clients")).toBe(false);
  });
});
