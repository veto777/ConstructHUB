import { describe, expect, it } from "vitest";
import { effectiveVpnMode, savedVpnMode, VPN_DEFAULT_MODE, vpnTrackFields, vpnTrackLimiter } from "./vpn-mode";

// Reviewers (2026-10-11): the page promised Log-first while the server blocked VPN visitors of any
// site that had never saved a mode — every site added through IP Tracker's "Add site".
describe("VPN Shield response mode (Log-first)", () => {
  it("logs, and never blocks, a site that has not saved a mode", () => {
    expect(VPN_DEFAULT_MODE).toBe("log");
    for (const settings of [null, undefined, {}, { vpnRedirectUrl: "" }, { vpnBlockMode: "" }, { vpnBlockMode: "BLOCK" }, { vpnBlockMode: 1 }, "block"]) {
      expect(savedVpnMode(settings), JSON.stringify(settings)).toBeNull();
      expect(effectiveVpnMode(settings), JSON.stringify(settings)).toBe("log");
    }
  });

  it("enforces exactly the mode the owner saved", () => {
    for (const mode of ["block", "log", "redirect"] as const) {
      expect(savedVpnMode({ vpnBlockMode: mode })).toBe(mode);
      expect(effectiveVpnMode({ vpnBlockMode: mode, vpnWhitelistedIps: "", vpnRedirectUrl: "" })).toBe(mode);
    }
  });
});

// Audit 08 #1: the anonymous tracking endpoint stored whatever length it was sent and had no throttle.
describe("VPN Shield tracking bounds", () => {
  it("keeps the tracking script's own payload unchanged", () => {
    const body = {
      trackingId: "abc", fingerprint: "1x2y3z", deviceType: "desktop", browser: "Chrome", os: "Windows",
      referrer: "", landingPage: "https://example.com/roofing?utm=1",
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
      vpnSignals: { vpnExtension: false, webrtcIps: [] },
    };
    expect(vpnTrackFields(body)).toEqual({
      fingerprint: "1x2y3z", deviceType: "desktop", browser: "Chrome", os: "Windows",
      referrer: null, landingPage: body.landingPage, userAgent: body.userAgent,
    });
  });

  it("cuts oversized strings and drops non-strings", () => {
    const f = vpnTrackFields({ userAgent: "u".repeat(100_000), landingPage: "l".repeat(9000), fingerprint: { a: 1 }, browser: 7, os: ["x"] });
    expect(f.userAgent).toHaveLength(500);
    expect(f.landingPage).toHaveLength(2000);
    expect([f.fingerprint, f.browser, f.os, f.deviceType, f.referrer]).toEqual([null, null, null, null, null]);
    expect(vpnTrackFields(null).userAgent).toBeNull();
  });

  it("allows max calls per key per window, then again after the window", () => {
    const limit = vpnTrackLimiter(3, 1000);
    expect([1, 2, 3, 4].map(() => limit.allow("a", 0))).toEqual([true, true, true, false]);
    expect(limit.allow("b", 0)).toBe(true);
    expect(limit.allow("a", 999)).toBe(false);
    expect(limit.allow("a", 1000)).toBe(true);
  });
});
