import { describe, expect, it } from "vitest";
import { maskEmail } from "./account-security";

describe("maskEmail", () => {
  it("keeps the first letter and the domain", () => {
    expect(maskEmail("veto@gmail.com")).toBe("v***@gmail.com");
    expect(maskEmail("a@example.com")).toBe("a***@example.com");
  });
  it("returns null for anything that is not an address", () => {
    expect(maskEmail(null)).toBeNull();
    expect(maskEmail("")).toBeNull();
    expect(maskEmail("no-at-sign")).toBeNull();
  });
});
