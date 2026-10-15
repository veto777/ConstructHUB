import { describe, expect, it } from "vitest";
import { pack } from "./de";

describe("Delaware round-2 audit (2026-10-16)", () => {
  const by = (src: string) => pack.licenses!.find((l) => l.source.includes(src))!;
  it("the holder comes from the license class (decision 2)", () => {
    expect(by("Division of Revenue").holder!({})).toBe("business");
    expect(by("Professional Regulation").holder!({})).toBe("individual");
    expect(by("water well").holder!({ licensesubtype: "Water Well Contractor" })).toBe("business");
    expect(by("on-site wastewater").holder!({ licensesubtype: "Class E (System Contractor)" })).toBe("business");
    expect(by("on-site wastewater").holder!({ licensesubtype: "Class H (Systems Inspector)" })).toBe("individual");
    expect(by("on-site wastewater").holder!({})).toBeNull();
    expect(by("asbestos").holder!({})).toBe("business");
  });
});
