import { describe, expect, it } from "vitest";
import { effectiveVpnMode, savedVpnMode, VPN_DEFAULT_MODE } from "./vpn-mode";

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
