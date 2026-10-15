import { describe, expect, it } from "vitest";
import { darBusiness, darHit, parseTnDar, tdecHit, tdecIsOrganization } from "./tn";

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

// Excerpts of the Department of Commerce & Insurance Disciplinary Action Reports, downloaded 2026-10-15:
// DAR-02-2024.pdf and DAR-04-2026.pdf through `pdftotext -layout`, DAR-09-2026.pdf through the JS reader (lib/a3-pdf.ts).
const DAR_2024_02 = "Limited Licensed Electricians, Limited\nLicensed Plumbers\nContractors & Home Improvement,          1 of 1 Creation               MURFREESBORO, TN Unlicensed activity                                                    $500 civil penalty                                          2/12/2024\nLimited Licensed Electricians, Limited\nLicensed Plumbers\nContractors & Home Improvement,          CT Install America, LLC       Mohnton, PA        Unlicensed activity                                                  $3,000 civil penalty                                        2/29/2024\nLimited Licensed Electricians, Limited\nLicensed Plumbers\nContractors & Home Improvement,          Caldwell Plumbing Co., Inc.                 Wheaton, IL         Willfully failed to provide the board with audited financial statements and continued to contract $100,000 civil penalty, $2,693.75 costs, and revocation of    2/9/2024\nLimited Licensed Electricians, Limited                                                                   in amounts that exceeded their license monetary limitations and classifications.                  license\nLicensed Plumbers\nContractors & Home Improvement,          Custom Concept Solutions                    Clarksville, TN     Unlicensed activity                                                                               $10,000 civil penalty and $982.50 costs                       2/9/2024\nLimited Licensed Electricians, Limited\nLicensed Plumbers\nContractors & Home Improvement,          McGuire Roofing & Construction, LLC         Knoxville, TN       Unlicensed activity                                                                               $25,000 civil penalty                                        2/20/2024\nLimited Licensed Electricians, Limited\nLicensed Plumbers\nContractors & Home Improvement,          Smoky Mountain Enterprises & Construction   Newport, TN         Unlicensed activity                                                                               $15,000 civil penalty and $1,080.75 costs                    2/20/2024\nLimited Licensed Electricians, Limited   Services, Inc.\nLicensed Plumbers\nContractors & Home Improvement,          Blue Collar Construction                    Ring Gold, GA       Unlicensed activity                                                                               $10,000 civil penalty and $2,083.25 costs                     2/8/2024\nLimited Licensed Electricians, Limited\n";
const DAR_2026_04 = "Limited Licensed Electricians, Limited\n i     d l & bHome Improvement,\nContractors                              Clear Intentions Contracting, LLC      Nashville, TN         Unlicensed activity                                                                                                      $1,000 civil penalty                                    4/24/2026\nLimited Licensed Electricians, Limited\nLicensed Plumbers\n";
const DAR_2026_09_JS = "                         Collections                         NO ACTION TAKEN\n                         Contractors & Home Improvement,     101 Contractor                              Knoxville, TN      Unlicensed activity                                                                                       $750 civil penalty                                      9/28/2026\n                         Limited Licensed Electricians, Limited\n                         Licensed Plumbers\n                         Contractors & Home Improvement,     Memphis Rev, GP                             Memphis, TN        Unlicensed activity                                                                                       $750 civil penalty                                      9/23/2026\n                         Limited Licensed Electricians, Limited\n                         Licensed Plumbers\n                         Contractors & Home Improvement,     Reza Contracting Group, LLC                 Nashville, TN      Unlicensed activity                                                                                       $1,500 civil penalty                                    9/14/2026\n                         Limited Licensed Electricians, Limited";

describe("TN Board for Licensing Contractors disciplinary action reports", () => {
  it("reads rows with wrapped names, glued columns and multi-line actions", () => {
    const rows = parseTnDar(DAR_2024_02);
    const by = (n: string) => rows.find((r) => r.respondent.startsWith(n))!;
    expect(by("1 of 1 Creation")).toMatchObject({ location: "MURFREESBORO, TN", violation: "Unlicensed activity", action: "$500 civil penalty", date: "2/12/2024" });
    expect(by("Caldwell Plumbing")).toMatchObject({
      location: "Wheaton, IL", date: "2/9/2024",
      violation: "Willfully failed to provide the board with audited financial statements and continued to contract in amounts that exceeded their license monetary limitations and classifications.",
      action: "$100,000 civil penalty, $2,693.75 costs, and revocation of license",
    });
    expect(by("Smoky Mountain").respondent).toBe("Smoky Mountain Enterprises & Construction Services, Inc.");
    expect(rows.every((r) => !/Limited Licensed|Licensed Plumbers/.test(r.respondent))).toBe(true);
  });

  it("reads a row whose program label pdftotext split onto the line above", () => {
    expect(parseTnDar(DAR_2026_04).map((r) => r.respondent)).toContain("Clear Intentions Contracting, LLC");
  });

  it("reads the JS reader's layout (indented by the page margin) the same way", () => {
    expect(parseTnDar(DAR_2026_09_JS).map((r) => [r.respondent, r.location, r.date])).toEqual([
      ["101 Contractor", "Knoxville, TN", "9/28/2026"], ["Memphis Rev, GP", "Memphis, TN", "9/23/2026"], ["Reza Contracting Group, LLC", "Nashville, TN", "9/14/2026"],
    ]);
  });

  it("makes a companies-only discipline record with the fine", () => {
    const [caldwell] = parseTnDar(DAR_2024_02).filter((r) => r.respondent.startsWith("Caldwell"));
    expect(darHit(caldwell, "https://www.tn.gov/x.pdf")).toMatchObject({
      name: "Caldwell Plumbing Co., Inc.", category: "discipline", date: "2024-02-09", amount: 100000, adverse: true, city: "Wheaton, IL", id: null,
    });
  });

  it("leaves individuals out and keeps the business of a dba", () => {
    expect(darBusiness("James, Ian M.")).toBeNull();
    expect(darBusiness("Roman D. Pauta")).toBeNull();
    expect(darBusiness("Curtis Lee Quakenbush")).toBeNull();
    expect(darBusiness("Sturdivant Group dba Empire Reality & Construction")).toBe("Sturdivant Group dba Empire Reality & Construction");
    expect(darBusiness("John Smith dba Smith Roofing")).toBe("Smith Roofing");
    expect(darBusiness("Nextroof, LLC")).toBe("Nextroof, LLC");
    expect(darBusiness("101 Contractor")).toBe("101 Contractor");
  });
});
