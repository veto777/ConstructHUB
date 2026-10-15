import { describe, expect, it } from "vitest";
import { parseMoDetail } from "./mo";

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
