import { describe, expect, it } from "vitest";
import { conregHit, parseConregDetail, srcHit } from "./ne";

// Trimmed from dol.nebraska.gov/conreg/Contractor/Details/2636526, 2026-10-15.
const DETAIL = `<h2>Contractor Details</h2><dl><dt>Contractor/Subcontractor Name</dt><dd>KIEWIT BUILDING GROUP INC.</dd><dt>Corporation Name</dt><dd>KIEWIT BUILDING GROUP INC.</dd><dt>Business Contact Email</dt><dd></dd><dt>Business Entity</dt><dd>Corporation</dd><dt>Address</dt><dd>1550 Mike Fahey Street<br/>OMAHA, NE 68102</dd><dt>City</dt><dd>OMAHA</dd><dt>State</dt><dd>NE</dd><dt>Zip</dt><dd>68102</dd><dt>Telephone</dt><dd>4023422052</dd><dt>Registration Number</dt><dd>26365-26</dd><dt>Registration Expiration</dt><dd>9/1/2027</dd><dt>Sales Tax Option</dt><dd>2</dd><dt>Number of Employees</dt><dd>600</dd><dt>Worker's Compensation Status</dt><dd>Certificate on File (does not cover owners/corporate officials)</dd></dl> Print `;

describe("Nebraska DOL contractor registration", () => {
  it("reads the details page", () => {
    const h = conregHit("2636526", parseConregDetail(DETAIL), "business")!;
    expect(h.businessName).toBe("KIEWIT BUILDING GROUP INC.");
    expect(h.licenseNumber).toBe("26365-26");
    expect(h.expires).toBe("2027-09-01");
    expect(h.address).toBe("1550 Mike Fahey Street OMAHA NE 68102");
    expect(h.phone).toBe("4023422052");
    expect(h.status).toContain("Certificate on File");
  });
});

describe("Nebraska State Electrical Division search", () => {
  it("reads a credential result", () => {
    const h = srcHit({ id: "C24216", title: "MILANUK, MARCUS J", subtitle: "Individual", details: [
      { label: "Credential Details", values: ["Electrical Contractor", "EC 03136", "Active", "12/31/2026"] },
      { label: "Primary Contact Information", values: ["", "17998 RD 52", "", "OSHKOSH, Nebraska 69154-6048", "United States"] },
    ] }, "principal")!;
    expect(h).toMatchObject({ principal: "MARCUS J MILANUK", licenseNumber: "EC 03136", status: "Active", expires: "2026-12-31", city: "OSHKOSH, Nebraska", address: "17998 RD 52 OSHKOSH, Nebraska 69154-6048" });
  });
  it("keeps a pending application without a number", () => {
    const h = srcHit({ id: "C186984", title: "MILANUK, MARSHALL M", subtitle: "Individual", details: [{ label: "Credential Details", values: ["Electrical Contractor", "Pending", "Denied by Agency"] }] }, "principal")!;
    expect(h.licenseNumber).toBeNull();
    expect(h.status).toBe("Application pending; Denied by Agency");
  });
});
