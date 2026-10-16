import { describe, expect, it } from "vitest";
import { pack } from "./nh";

describe("New Hampshire pack", () => {
  it("searches nothing it could not open, and says why", () => {
    expect(pack.state).toBe("NH");
    expect(pack.licenses ?? []).toHaveLength(0);
    expect(pack.liveLicenses ?? []).toHaveLength(0);
    expect(pack.bulk ?? []).toHaveLength(0);
    expect(pack.liveEnforcement ?? []).toHaveLength(0);
    expect(pack.blocked!.some((b) => /oplc\.nh\.gov/.test(b) && /403/.test(b))).toBe(true);
    expect(pack.noStatewideGcLicense).toMatch(/does not license general/);
  });
});
