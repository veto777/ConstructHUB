import { describe, expect, it } from "vitest";
import { buildExclusionList, exclusionListCap, parseIpEntries } from "./click-guard-exclusions";

describe("Click Guard exclusion list", () => {
  it("parses one entry per line or comma and skips invalid entries", () => {
    expect(parseIpEntries("198.51.100.7\n  203.0.113.0/24 ,not-an-ip\n2001:db8::1\n\n10.0.0.0/8\n192.0.2.*"))
      .toEqual(["198.51.100.7", "203.0.113.0/24", "2001:db8::1", "192.0.2.*"]);
    expect(parseIpEntries(undefined)).toEqual([]);
    expect(parseIpEntries(42)).toEqual([]);
  });

  it("caps at clamp(exclusionListRate, 50, 500), 500 when unset", () => {
    expect(exclusionListCap(undefined)).toBe(500);
    expect(exclusionListCap(10)).toBe(50);
    expect(exclusionListCap(120)).toBe(120);
    expect(exclusionListCap("75")).toBe(75);
    expect(exclusionListCap(9000)).toBe(500);
    expect(exclusionListCap("abc")).toBe(500);
  });

  it("adds manual exclusions first, dedupes, and drops whitelisted IPs", () => {
    const list = buildExclusionList(
      ["203.0.113.9", "198.51.100.7", "198.51.100.200", "192.0.2.0/24", "garbage"],
      {
        manualExcludeIps: "203.0.113.9\n2001:db8::5\n198.51.100.44",
        whitelistIps: "198.51.100.0/25, 2001:db8::5\n192.0.2.0/24",
      },
    );
    // 198.51.100.44 and .7 fall inside the whitelisted /25; .200 does not.
    // 2001:db8::5 and the identical 192.0.2.0/24 range are whitelisted exactly.
    expect(list).toEqual(["203.0.113.9", "198.51.100.200"]);
  });

  it("keeps a range when only one address inside it is whitelisted", () => {
    expect(buildExclusionList(["203.0.113.0/24"], { whitelistIps: "203.0.113.5" })).toEqual(["203.0.113.0/24"]);
  });

  it("whitelists by last-octet wildcard", () => {
    expect(buildExclusionList(["192.0.2.17", "192.0.3.17"], { whitelistIps: "192.0.2.*" })).toEqual(["192.0.3.17"]);
  });

  it("applies the list length", () => {
    const blocked = Array.from({ length: 80 }, (_, i) => `198.18.0.${i + 1}`);
    expect(buildExclusionList(blocked, { exclusionListRate: 60 })).toHaveLength(60);
    expect(buildExclusionList(blocked, null)).toHaveLength(80);
    expect(buildExclusionList(blocked, { manualExcludeIps: "203.0.113.1", exclusionListRate: 50 })[0]).toBe("203.0.113.1");
  });
});
