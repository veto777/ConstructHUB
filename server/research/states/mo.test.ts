import { describe, expect, it } from "vitest";
import { moHolder, moIsBusiness, moStatus, parseMoDetail } from "./mo";

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

describe("MO PRO discipline and holder (audit round 2, decisions 1 and 2)", () => {
  it("keeps discipline out of the status: the status word alone, the discipline apart", () => {
    const r = moStatus("Non Active", { "Current Discipline Status": "Probation", "Previous Disciplinary Actions": "Yes" });
    expect(r.status).toBe("Not active");
    expect(r.status).not.toMatch(/disciplin|probation/i);
    expect(r.discipline).toBe("current discipline: Probation; previous disciplinary actions: Yes");
    expect(moStatus("Active", { "Current Discipline Status": "None", "Previous Disciplinary Actions": "No" })).toEqual({ status: "Active", discipline: null });
    // As the live page printed it for a Professional Engineer on 2026-10-16.
    expect(moStatus("Active", { "Current Discipline Status": "None Current/Previous", "Previous Disciplinary Actions": "Yes" })).toEqual({ status: "Active", discipline: "previous disciplinary actions: Yes" });
    expect(moStatus("Active", { "Current Discipline Status": "None Current/Previous", "Previous Disciplinary Actions": "No" })).toEqual({ status: "Active", discipline: null });
  });
  it("the holder comes from the license class", () => {
    expect(moHolder("Engineering Corporation", "Amptron Electric Company")).toBe("business");
    expect(moHolder("Professional Engineer", "Mark E Davis")).toBe("individual");
    expect(moHolder("Electrical Contractor", "Precision Electric LLC")).toBe("business");
    expect(moHolder("Electrical Contractor", "Mark E Davis")).toBeNull();
  });
});
