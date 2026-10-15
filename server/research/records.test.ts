import { describe, expect, it } from "vitest";
import { courtState, namedIn } from "./records";
import { retryPlan } from "./runner";

describe("research records", () => {
  it("matches whole words only", () => {
    expect(namedIn("DaBella", "Reve Exteriors, LLC dba DaBella Exteriors, LLC")).toBe(true);
    expect(namedIn("DaBella", "DABELLA EXTERIORS*")).toBe(true);
    expect(namedIn("Bella", "DaBella Exteriors")).toBe(false);
    expect(namedIn("Smith Roofing", "Roofing by Smith LLC")).toBe(true);
    expect(namedIn("Smith Roofing", "Locksmith Roofing")).toBe(false);
    expect(namedIn("D & S Electric Inc", "B & J ELECTRIC INC")).toBe(false);
    expect(namedIn("D & S Electric Inc", "D&S ELECTRIC, INC.")).toBe(true);
    expect(namedIn("D & S Electric Inc", "D & S ELECTRIC INC.")).toBe(true);
  });
  it("maps federal district and bankruptcy courts to their state, never appellate courts", () => {
    expect(courtState("wawd")).toBe("WA");
    expect(courtState("txwd")).toBe("TX");
    expect(courtState("ord")).toBe("OR");
    expect(courtState("dcd")).toBe("DC");
    expect(courtState("wawb")).toBe("WA");
    expect(courtState("ca9")).toBeNull();
    expect(courtState("cafc")).toBeNull();
    expect(courtState(null)).toBeNull();
  });
  it("retries a slow portal once and a missing search field with the next type", () => {
    expect(retryPlan("Not searched: This operation was aborted")).toBe("same");
    expect(retryPlan("Timed out after 75s — slow portal")).toBe("same");
    expect(retryPlan("Not searched: SmartGov search field unavailable: PrimaryContractor.Contact.DisplayName")).toBe("next");
    expect(retryPlan("Not searched: eTRAKiT tenant does not expose company in public permit search")).toBe("next");
    expect(retryPlan("Not searched: Portal returned HTTP 403 for https://x")).toBeNull();
    expect(retryPlan("Not searched: eTRAKiT requires login; no public permit search")).toBeNull();
  });
});
