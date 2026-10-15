import { describe, expect, it } from "vitest";
import { verifyEnforcement, verifyLicenseHit } from "./wa";

// Trimmed from L&I Verify GetBusinessDetails responses, 2026-10-15 (UBI 605320678, 602673413, 604984542).
const details = {
  Contractor: {
    LicenseNumber: "ABSOLR*779PR", UbiNumber: "605320678", LicenseType: "Construction Contractor", BusinessName: "ABSOLUTE ROOFING",
    PhoneNumber: "2082155090", Address1: "621 N GLENN RD", City: "SPOKANE VALLEY", State: "WA", Zip: "99206", StatusDescription: "EXPIRED",
    ExpirationDate: "11/16/2025", SpecialtyName1: "GENERAL", SpecialtyName2: "UNUSED",
    BusinesOwners: [{ Name: "NORTON, CARISSA EVE", RoleDescription: "PARTNER/MEMBER" }],
    Violations: [{ InfractionId: "NTHRM01754", IssueDate: "12/05/2025", StatusDescription: "Not Satisfied", ViolationAmount: 5000.0, ViolationAmountDue: 5440.0,
      ItemTypeDescription: "CONSTRUCTION INFRACTION", RcwCode: "18.27.200(1)(b) RCW", ViolatorName: "ABSOLUTE ROOFING AND MAINTENANCE LLC", CityName: "SPOKANE VALLEY",
      Description: "Advertising, offering to do work, submitting a bid or performing work when the contractors registration is suspended or revoked." }],
    Summons: [{ CauseNumber: "26-2-23916-9SEA", PlaintiffName: "STATE OF WASHINGTON", ComplaintDate: "08/03/2026", ComplaintAmt: 15000.0, JudgmentDate: "", JudgmentAmount: 0.0,
      DismissalDate: "", ComplaintStatus: "Closed/Satisfied", PaymentAmt: 15000.0, PaymentDate: "10/05/2026", PaidBy: "Bond", LienTableName: "bond", CountyName: "KING" }],
    Warrants: [{ CauseNumber: "26-2-05729-0", PlaintiffName: "Department of Labor and Industries", ComplaintDate: "02/19/2026", ComplaintAmount: 10491.28,
      JudgmentDate: "02/13/2026", TaxWarrantNumber: "380725", PaymentAmount: 0, PaymentDate: "", StatusDescription: "Unpaid", CountyName: "KING", DismissalDate: "" }],
    Lapses: [{ LapseDate: "07/17/2024", LapseDesccription: "INSURANCE CANCELED/EXPIRED (I)", ReInstatementDate: "09/27/2024" }],
  },
  Employer: { EmployerGoverningPerson: [{ FirstName: "CARISSA", LastName: "NORTON" }] },
};

describe("WA L&I Verify", () => {
  it("turns a business record into enforcement facts with the license, address and phone", () => {
    const hits = verifyEnforcement(details, "ABSOLUTE ROOFING", "https://secure.lni.wa.gov/verify/Detail.aspx?UBI=605320678");
    expect(hits.map((h) => h.category)).toEqual(["discipline", "court_case", "tax_lien", "business_status"]);
    expect(hits[0]).toMatchObject({ id: "NTHRM01754", date: "2025-12-05", amount: 5000, adverse: true, licenseNumber: "ABSOLR*779PR", phone: "2082155090" });
    expect(hits[0].address).toBe("621 N GLENN RD SPOKANE VALLEY WA 99206");
    expect(hits[1]).toMatchObject({ id: "26-2-23916-9SEA", adverse: true, city: "KING County Superior Court" });
    expect(hits[1].detail).not.toContain("STATE OF WASHINGTON"); // plaintiffs are never named
    expect(hits[2]).toMatchObject({ id: "380725", status: "Tax warrant: Unpaid", amount: 10491.28 });
    expect(hits[3].endDate).toBe("2024-09-27");
  });
  it("carries the owners on a license record and keeps no tradesperson home address", () => {
    const h = verifyLicenseHit(details, null, "license");
    expect(h.people).toEqual([{ name: "CARISSA EVE NORTON", role: "PARTNER/MEMBER" }]);
    expect(h).toMatchObject({ businessName: "ABSOLUTE ROOFING", specialty: "GENERAL", expires: "2025-11-16", phone: "2082155090" });
    const t = verifyLicenseHit({ Contractor: { LicenseNumber: "BEARDJS867P8", UbiNumber: "", BusinessName: "BEARD, JOSEPH S", Address1: "1 X ST", City: "RENTON", State: "WA" } }, null, "principal");
    expect(t).toMatchObject({ principal: "JOSEPH S BEARD", businessName: null, address: null });
  });
});
