import { describe, it, expect } from "vitest";
import { phoneKey } from "./hover";

// A capture ordered by staff carries "+13607397583" while the member's profile says
// "3607397583": both must compare equal, or the staff phone lands on the new client.
describe("phoneKey", () => {
  it("drops a leading US country code and every non-digit", () => {
    expect(phoneKey("+1 (360) 739-7583")).toBe("3607397583");
    expect(phoneKey("3607397583")).toBe("3607397583");
    expect(phoneKey("13607397583")).toBe("3607397583");
  });
  it("keeps other lengths as plain digits", () => {
    expect(phoneKey("555-0142")).toBe("5550142");
    expect(phoneKey(null)).toBe("");
  });
});
