import { describe, expect, it } from "vitest";
import { businessParts, desHit, desReportLinks, parseDesReport } from "./sc";

// Excerpts of `pdftotext -layout` output of SC DES monthly enforcement reports, saved 2026-10-15
// (des.sc.gov/about-scdes/programs-divisions/environmental-enforcement-actions).
const SEPT_2026 = `                                Underground Storage Tank Enforcement

1.     Order Type and Number: Consent Order AF-0001689-UST
       Order Date: August 4, 2026
       Individual/Entity/Facility: Easley Combined Utilities
       County: Pickens
       Previous Orders: N/A
       Permit/ID Number: 11857

Violations Cited: The State Underground Petroleum Environmental Response Bank Act of 1988 (SUPERB
Act), S.C. code Ann. § 44-2-10 et seq.; and South Carolina Underground Storage Tank Control Regulation, 7
S.C. Code Ann., Regs 61-92, 280.20 (c) (1) (ii) (2012 & Supp 2025).

Summary: The Individual/Entity owns underground storage tanks in Pickens County, South Carolina. On
May 26, 2026, the Department conducted a routine compliance inspection of the Facility and issued a
Notice of Alleged Violation. Easley Combined Utilities has violated the SUPERB Act and the South Carolina
Underground Storage Tank Regulations, as follows: failed to maintain overfill prevention equipment.

Action: The Individual/Entity/Facility has corrected all violations. The Individual/Entity/Facility shall pay a
civil penalty in the amount of three thousand, six hundred dollars ($3,600.00).
`;
// March 2026 report: the "Order Type/Order Number: CO …" variant, and a person doing business under a name.
const MARCH_2026 = `16.    Order Type/Order Number:                    CO 26-002-A
       Order Date:                                 February 13, 2026
       Individual/Entity/Facility:                 Craig Banks, individually and
                                                   d/b/a Banks Brothers Asphalt Paving
       County:                                     Greenville
       Previous Orders:                            10-013-A, 15-042-A
       Permit/ID Number:                           9900-0454

Violations Cited: U.S. EPA 40 CFR Part 60 and S.C. Code Ann. Regs. 61-62.60, Standards of Performance for
Hot Mix Asphalt Facilities (collectively, “Subpart I”) and S.C. Code Ann. Regs. 61-62.1, Section II, Permit
Requirements.

Summary: Mr. Craig Banks owns and operates Banks Brothers Asphalt Paving (collectively
“Individual/Entity/Facility”), a drum mix asphalt plant located in Greenville County, South Carolina. On
March 19, 2025, the Department received the results of a Department-approved source test conducted on
February 18, 2025, for PM emissions from the dryer burner. The Individual/Entity has violated U.S. EPA and
                                                      10
South Carolina Air Pollution Control Regulations as follows: Failed to limit PM emissions from the dryer
burner to 0.04 gr/dscf on February 18, 2025.

Action: Upon execution of this order, limit PM emissions in accordance with emissions limitations as
specified in Subpart I. The Individual/Entity/Facility shall pay a civil penalty in the amount of eight thousand
dollars ($8,000.00).`;
// September 2024 report (the older layout): the entity is a couple; the facility is their store.
const SEPT_2024 = `1)      Order Type and Number:                  Administrative Order 24-0095-UST
        Order Date:                             September 30, 2024
        Individual/Entity:                      Chetan and Manisha Patel
        Facility:                               AK’s Mart
        Location:                               4020 Black Highway
                                                York, SC 29754
        Mailing Address:                        1005 North Congress Street
                                                York, SC 29754
        County:                                 York
        Previous Orders:                        None
        Permit/ID Number:                       09378
        Violations Cited:                       The     State     Underground         Petroleum
        Environmental Response Bank Act of 1988 (SUPERB Act), S.C. code Ann. § 44-2-10 et
        seq.; and South Carolina Underground Storage Tank Control Regulation, 7 S.C. Code
        Ann., Regs 61-92, 280.31(c), 280.34(c), 280.40(a), 280.40(a)(2), 280.40(a)(3), 280.43(d),
        280.45(b)(1), and 280.70(a) (2012 & Supp 2023) and § 44-2-60(A) (2018).

        Summary: Chetan and Manisha Patel (Individual/Entity) own underground storage
tanks (USTs) in York County, South Carolina. On February 27, 2024, the Department
conducted a file review of the Facility and issued a Notice of Alleged Violation. The
Individual/Entity has violated the SUPERB Act and the South Carolina Underground Storage
Tank Regulation, as follows: failed to inspect and impressed current system every sixty (60)
days; failed to provide records to the Department upon request; failed to provide an
adequate release detection method; failed to properly maintain release detection
equipment; failed to test tank release detection equipment annually; failed to conduct
proper release detection using an automatic tank gauge; failed to maintain records for at
least one (1) year; and failed to maintain corrosion protection on a temporarily closed UST.

         Action: The Individual/Entity is required to submit: either ten (10) of twelve (12) of
the most recent automatic tank gauge records with the most recent two (2) months passing
for all currently-in-use USTs at the Facility or passing current tank tightness test results and
current passing automatic tank gauge results for all currently-in-use USTs at the Facility;
proof the automatic tank gauge has been repaired and/or replaced and passing follow-up
release detection equipment operability rest results; and proof a rectifier log has been
initiated and is being properly maintained. The Department has assessed a total civil penalty
in the amount of fifteen thousand, five hundred twenty dollars ($15,520.00). The
Individual/Entity shall pay a civil penalty in the amount of fifteen thousand, five hundred
twenty dollars ($15,520.00).`;

describe("SC DES enforcement reports", () => {
  it("reads an order: number, type, date, business, county, program, violations, penalty", () => {
    const [o] = parseDesReport(SEPT_2026);
    expect(desHit(o, "https://des.sc.gov/x.pdf")).toEqual({
      state: "SC", source: "South Carolina DES environmental enforcement orders", sourceUrl: "https://des.sc.gov/x.pdf", category: "environmental",
      name: "Easley Combined Utilities", id: "AF-0001689-UST", date: "2026-08-04", endDate: null, status: "Consent Order",
      city: "Pickens County", detail: "Underground Storage Tank Enforcement. Violations: failed to maintain overfill prevention equipment.",
      amount: 3600, adverse: true,
    });
  });

  it("keeps only the business of a person doing business under a name, and reads 'CO' as a consent order", () => {
    const [o] = parseDesReport(MARCH_2026);
    const h = desHit(o, "u")!;
    expect(h.name).toBe("Banks Brothers Asphalt Paving");
    expect(h.id).toBe("26-002-A");
    expect(h.status).toBe("Consent Order");
    expect(h.date).toBe("2026-02-13");
    expect(h.amount).toBe(8000);
    expect(JSON.stringify(h)).not.toMatch(/Craig/);
  });

  it("skips an order whose individual/entity is a person, whatever the facility is called (FCRA)", () => {
    const [o] = parseDesReport(SEPT_2024);
    expect(o.orderNumber).toBe("24-0095-UST");
    expect(o.penalty).toBe(15520);
    expect(desHit(o, "u")).toBeNull();
  });

  it("tells businesses from people", () => {
    expect(businessParts("Cox Family LLC c/o John Loveless/Yea Yea Reclamation Mine")).toEqual(["Cox Family LLC", "Yea Yea Reclamation Mine"]);
    expect(businessParts("Heritage Woodcraft Inc. D.B.A HWC Custom Cabinetry")).toEqual(["Heritage Woodcraft Inc.", "HWC Custom Cabinetry"]);
    expect(businessParts("Roman and Rebecca Rodriguez, d.b.a. Smith Circle Homeowners Association")).toEqual(["Smith Circle Homeowners Association"]);
    expect(businessParts("Boeing South Carolina")).toEqual(["Boeing South Carolina"]);
    expect(businessParts("Eric Potter and Friendly Feller, LLC")).toEqual(["Friendly Feller, LLC"]);
    expect(businessParts("Saluda County Water and Sewer Authority")).toEqual(["Saluda County Water and Sewer Authority"]);
    for (const person of ["Andrew J. Mills and William Edward Shepard, Jr.", "Allyson Brown & Donna Carpin", "Teodosio Estrada 667 Gooseneck Road, Aiken, SC",
      "Estate of Debra McSwain and Heirs of Debra McSwain", "Robert Small", "7328 Middle Street", "Patricia A. Turner, AKA Patricia Young",
      "William S. Urbalejo and Barbara S. Urbalejo, as trustees of the William S. Urbalejo and Barbara S. Urbalejo Living Trust"]) {
      expect(businessParts(person), person).toEqual([]);
    }
  });

  it("finds the monthly reports on the index page, newest first, without the summary sheets", () => {
    const html = '<a href="/sites/des/files/EA_SummarySheetBoardEnforcement_May2024.pdf">Summary</a>' +
      '<a href="https://des.sc.gov/sites/des/files/2025-08/August%202025%20Enforcement%20Report.pdf">August 2025 Enforcement Report</a>' +
      '<a href="/sites/des/files/Library/EnforcementReport_September2026.pdf">September 2026 Enforcement Report</a>';
    expect(desReportLinks(html)).toEqual([
      { url: "https://des.sc.gov/sites/des/files/Library/EnforcementReport_September2026.pdf", month: "2026-09" },
      { url: "https://des.sc.gov/sites/des/files/2025-08/August%202025%20Enforcement%20Report.pdf", month: "2025-08" },
    ]);
  });
});
