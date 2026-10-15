import { describe, expect, it } from "vitest";
import { moIsBusiness, parseMoDetail } from "./mo";

describe("MO PRO licensee detail", () => {
  it("reads license fields, the address and the people named", () => {
    const d = parseMoDetail([
      { headingName: "License", records: [{ headingFieldValue: [{ label: "License Number", value: "2019028878" }, { label: "Expiration Date", value: "9/30/2029" }, { label: "Current Discipline Status", value: "None" }] }] },
      { headingName: "Address", records: [{ headingFieldValue: [{ label: "Street", value: "5950 Old State Rd" }, { label: "City", value: "Imperial" }, { label: "State", value: "Missouri" }, { label: "PostalCode", value: "63052" }] }] },
      { headingName: "Individual Licensee Employers", records: [{ headingFieldValue: [{ label: "License Number", value: "" }, { label: "Licensee Name", value: "" }, { label: "Role", value: "Employer" }] }] },
    ]);
    expect(d.fields["License Number"]).toBe("2019028878");
    expect(d.address).toBe("5950 Old State Rd Imperial Missouri 63052");
    expect(d.people).toEqual([]);
  });
});

describe("MO PRO licensee kind (audit 2026-10-15)", () => {
  it("an electrical contractor license held by a person is the person's; a corporation's certificate is the business's", () => {
    // Names from the live MO PRO electrical download and search, 2026-10-15.
    expect(moIsBusiness("Electrical Contractor", "Mark E Davis")).toBe(false);
    expect(moIsBusiness("Electrical Contractor", "Precision Electric LLC")).toBe(true);
    expect(moIsBusiness("Engineering Corporation", "Amptron Electric Company")).toBe(true);
    expect(moIsBusiness("Professional Engineer", "Mark E Davis")).toBe(false);
  });
});
