import { describe, expect, it } from "vitest";
import { tdecHit, tdecIsOrganization } from "./tn";

// Respondent rows of the TDEC Enforcement Dataviewer CSV (page 700) as downloaded on 2026-10-15.
const VALMONT = { Division: "APC", "Order Number": "APC26-0132", Respondent: "Valmont Industries, Inc.", "Case Type": "Technical Secretary Order", "Case Status": "Final", Site: "Valmont Industries, Inc.", County: "Marion", "EFO Name": "Chattanooga", "Signed Date": "9/12/2026" };

describe("TDEC enforcement", () => {
  it("reads a respondent row with the case's violation type", () => {
    expect(tdecHit(VALMONT, "Failure to update application or renew operating permit")).toMatchObject({
      name: "Valmont Industries, Inc.", id: "APC26-0132", date: "2026-09-12", status: "Technical Secretary Order, case final", city: "Marion County",
      detail: "TDEC division code APC; violation: Failure to update application or renew operating permit; site: Valmont Industries, Inc.; Chattanooga field office",
      adverse: true, category: "environmental",
    });
  });

  it("keeps organizations and leaves people out", () => {
    expect(tdecIsOrganization("SCHUBERT ENTERPRISES")).toBe(true);
    expect(tdecIsOrganization("LOUDON UTILITIES BOARD")).toBe(true);
    expect(tdecIsOrganization("Jackie Schubert")).toBe(false);
    expect(tdecIsOrganization("Debbie Sullivan")).toBe(false);
  });
});
