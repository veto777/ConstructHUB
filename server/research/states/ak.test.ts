import { describe, expect, it } from "vitest";
import { pack } from "./ak";

describe("AK pack", () => {
  it("searches nothing behind the DataDome challenge (www.commerce / maps.commerce.alaska.gov, rechecked 2026-10-15)", () => {
    const sources = [...(pack.licenses ?? []), ...(pack.liveLicenses ?? []), ...(pack.bulk ?? []), ...(pack.liveEnforcement ?? []), ...(pack.enforcement ?? [])];
    expect(sources).toEqual([]);
    expect(JSON.stringify(pack)).not.toMatch(/https:\/\/(?:www\.|maps\.)?commerce\.alaska\.gov\/[^"]*\?/);
    expect(pack.blocked?.some((b) => /maps\.commerce\.alaska\.gov.*DataDome/.test(b))).toBe(true);
  });
});
