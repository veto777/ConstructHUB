/**
 * A13 (2026-10-15): the coordinator's terms decisions, the AZ holder gap, CO DORA contractor discipline and the Ohio
 * AG Public Inspection File. The OPIF pages are trimmed from the live site (2026-10-15).
 */
import { describe, expect, it } from "vitest";
import { ALL_BULK_SOURCES } from "./registry";
import { RETIRED_BULK_SOURCES } from "./bulk";
import { pack as sc } from "./states/sc";
import { pack as wv } from "./states/wv";
import { pack as wi } from "./states/wi";
import { pack as nc } from "./states/nc";
import { pack as inPack } from "./states/in";
import { coDisciplineHit, pack as co } from "./states/co";
import { opifHit, opifSuppliers, parseOpifDetail, parseOpifResults, pack as oh } from "./states/oh";
import { debarCompany, parseDeDebar, parseWpfa, wpfaHit, pack as de } from "./states/de";

const OPIF_RESULTS = "<p>108 record(s) match the search criteria</p><table><tbody><tr> <td> <input aria-label=\"Checkbox\" autocomplete=\"off\" data-ago-issueId=\"656\" data-val=\"true\" data-val-required=\"The Selected field is required.\" id=\"SearchResultsPages_5__Selected\" name=\"SearchResultsPages[5].Selected\" type=\"checkbox\" value=\"true\" /><input name=\"SearchResultsPages[5].Selected\" type=\"hidden\" value=\"false\" /> <input data-val=\"true\" data-val-number=\"The field IssueId must be a number.\" data-val-required=\"The IssueId field is required.\" id=\"SearchResultsPages_5__IssueId\" name=\"SearchResultsPages[5].IssueId\" type=\"hidden\" value=\"656\" /> </td> <td><a aria-label=\"PIF\" class=\"action-link\" href=\"/Case/Detail/656\">10000657</a></td> <td>In Re: Tom Jones; Jones Paving; Jones Construction</td> <td>Jones Paving; Jones Construction</td> <td>668390018 </td> <td><a class=\"action-link\" href=\"/Case/Documents/10000657\">View Images</a></td> </tr><tr> <td> <input aria-label=\"Checkbox\" autocomplete=\"off\" data-ago-issueId=\"1076\" data-val=\"true\" data-val-required=\"The Selected field is required.\" id=\"SearchResultsPages_8__Selected\" name=\"SearchResultsPages[8].Selected\" type=\"checkbox\" value=\"true\" /><input name=\"SearchResultsPages[8].Selected\" type=\"hidden\" value=\"false\" /> <input data-val=\"true\" data-val-number=\"The field IssueId must be a number.\" data-val-required=\"The IssueId field is required.\" id=\"SearchResultsPages_8__IssueId\" name=\"SearchResultsPages[8].IssueId\" type=\"hidden\" value=\"1076\" /> </td> <td><a aria-label=\"PIF\" class=\"action-link\" href=\"/Case/Detail/1076\">10001077</a></td> <td>State ex rel. Celebrezze v. Smith; Howard Smith Construction</td> <td>Howard Smith Construction</td> <td>A8906328 </td> <td><a class=\"action-link\" href=\"/Case/Documents/10001077\">View Images</a></td> </tr><tr> <td> <input aria-label=\"Checkbox\" autocomplete=\"off\" data-ago-issueId=\"1170\" data-val=\"true\" data-val-required=\"The Selected field is required.\" id=\"SearchResultsPages_9__Selected\" name=\"SearchResultsPages[9].Selected\" type=\"checkbox\" value=\"true\" /><input name=\"SearchResultsPages[9].Selected\" type=\"hidden\" value=\"false\" /> <input data-val=\"true\" data-val-number=\"The field IssueId must be a number.\" data-val-required=\"The IssueId field is required.\" id=\"SearchResultsPages_9__IssueId\" name=\"SearchResultsPages[9].IssueId\" type=\"hidden\" value=\"1170\" /> </td> <td><a aria-label=\"PIF\" class=\"action-link\" href=\"/Case/Detail/1170\">10001171</a></td> <td>Daniels v. True; Acme Heating and Construction</td> <td>Acme Heating and Construction, et al</td> <td>86 CV 39690 </td> <td><a class=\"action-link\" href=\"/Case/Documents/10001171\">View Images</a></td> </tr><tr> <td> <input aria-label=\"Checkbox\" autocomplete=\"off\" data-ago-issueId=\"2328\" data-val=\"true\" data-val-required=\"The Selected field is required.\" id=\"SearchResultsPages_10__Selected\" name=\"SearchResultsPages[10].Selected\" type=\"checkbox\" value=\"true\" /><input name=\"SearchResultsPages[10].Selected\" type=\"hidden\" value=\"false\" /> <input data-val=\"true\" data-val-number=\"The field IssueId must be a number.\" data-val-required=\"The IssueId field is required.\" id=\"SearchResultsPages_10__IssueId\" name=\"SearchResultsPages[10].IssueId\" type=\"hidden\" value=\"2328\" /> </td> <td><a aria-label=\"PIF\" class=\"action-link\" href=\"/Case/Detail/2328\">10001171</a></td> <td>Daniels v. True; Acme Heating and Construction</td> <td>Acme Heating and Construction</td> <td>86 CV 39690 </td> <td><a class=\"action-link\" href=\"/Case/Documents/10001171\">View Images</a></td> </tr></tbody></table>";
// pdftotext -layout of the DIA PDFs (2026-10-15), trimmed: page 1's first rows, two wrapped rows of page 2 and one of page 3.
const WPFA_TEXT = "             WORKPLACE FRAUD ACT VIOLATORS\nThe following employers have violated 19 Del. Chapter 35 of Delaware\u2019s Workplace\nFraud Act. The name of an employer who violates this chapter shall remain on the\nDepartment's website for a period of 3 years from the date the final determination or\ndecision was issued.\n\n\n\n                                                                  Date of Final\n       Contractor                   Headquarters Address         Determination\n                                                                  ///Decisionn\n       AJ Construction               268 Golden Plover Dr       September 21, 2023\n                                      Smyrna, DE 19977\n\n\n\nTop Quality Flooring & Design          752 Bowne Road            November 11, 2022\n            LLC                      Ocean City, NJ 07712\n\n\n\n F&N Vasquez Concrete LLC             18679 Sherman Ave          November 17, 2022\n                                       Lincoln, DE 19960\n\n\n     Hidalgo Stone LLC                7561 Sundays Lane          December 28, 2022\n                                      Fredrick, MD 21707\n\n  Perez Contracting Services          7918 15th Ave #102           May 23, 2023\n                                     Hyattsville, MD 20783\n\n\n\n      HZ Drywall LLC                     508 Elm Drive             August 2, 2023\n                                       Seaford, DE 19973\n\f Leo M Construction LLC      33502 Sassafras Caldwell     October 10, 2023\n                                      Road\n                                Galena, MD 21635\n\n Lopez Remodeling LLC           25661 Eldert Street       October 12, 2023\n                                Seaford, DE 19973\n\n                                10715 Scott Drive\n Precision Contractors Inc      Fairfax, VA 22030         October 30, 2023\n\fG & E Rodriguez Construction    4921 Old Capitol Trail     November 6, 2024\n           LLC                  Wilmington, DE 19808\n";
const DEBAR_TEXT = "                 PREVAILING WAGE DEBARMENT LIST\n    The following contractors have been debarred for violations of the prevailing wage law\n    29Del.C. \u00a76960 or other applicable State statutes.\n\n    Therefore, no public construction contract in this State shall be bid on, awarded to, or\n    received by contractors and individuals on this list for a period of (3) three years from the\n    date of the judgment or as deemed by a court of competent jurisdiction.\n\n\n\n\n                                                                             Date of\n            Contractor                           Address                    Debarment\n\n      Mullen Brothers, Inc.                3375 Garnett Road,               Indefinite/\n               and                        Boothwyn, PA 19060              Civil Contempt\n    Daniel Mullen, individually\n\n        State Contractors                13004 Hathaway Drive              Indefinite/ 19\n      Corporation, and Jose             Silver Spring, MD 20906            Del.C. 2374(f)\n    Oscar Rivera, individually\n\n          Green Granite                 604 Heatherbrooke Court             Indefinite/\n               and                        Avondale, PA 19311              Civil Contempt\n     Jason Green, individually\n\n   Pro Image Landscaping, Inc.            23 Commerce Street               Indefinite/19\n              and                     Wilmington, DE 19801 and/or         Del.C. \u00a7108 &\n      Owner(s) individually                  2 Cameo Road                10 Del.C. 542(c)\n                                         Claymont, DE 19703\n     Liberty Mechanical, LLC               2032 Duncan Road                Indefinite/ 19\n               and                       Wilmington, DE 19801              Del.C. 2374(f)\n      Owner(s), individually\n\n    Integrated Mechanical and       4601 Governor Printz Boulevard         Indefinite/19\n   Fire Systems Inc. and Allison        Wilmington, DE 19809              Del.C. \u00a7108 &\n       Sheldon, individually                                             10 Del.C. 542(c)\n           ACH 1, INC.                   873 Salem Church Road             Indefinite/19\n                                           Newark, DE 19702                 Del.C.6960\n\n\n\n\nUpdated: July 6, 2022\n\f";
const OPIF_DETAIL = "<div class=\"mb-3 row\"> <span class=\"form-label-display col-sm-4\">PIF Number:</span> <div class=\"col-sm-8\"> 10001077 </div> </div> <div class=\"mb-3 row\"> <span class=\"form-label-display col-sm-4\">Case Name:</span> <div class=\"col-sm-8\"> State ex rel. Celebrezze v. Smith; Howard Smith Construction </div> </div> <div class=\"mb-3 row\"> <span class=\"form-label-display col-sm-4\">Supplier:</span> <div class=\"col-sm-8\">Howard Smith Construction</div> </div> <div class=\"mb-3 row\"> <span class=\"form-label-display col-sm-4\">Case Number:</span> <div class=\"col-sm-8\">A8906328</div> </div> <div class=\"mb-3 row\"> <span class=\"form-label-display col-sm-4\">Date in Pif:</span> <div class=\"col-sm-8\">1/24/1990</div> </div> <div class=\"mb-3 row\"> <span class=\"form-label-display col-sm-4\">Court:</span> <div class=\"col-sm-8\">C.P.</div> </div> <div class=\"mb-3 row\"> <span class=\"form-label-display col-sm-4\">County:</span> <div class=\"col-sm-8\">Hamilton</div> </div> <div class=\"mb-3 row\"> <span class=\"form-label-display col-sm-4\">Keywords:</span> <div class=\"col-sm-8\">Failure to Deliver; Deposits</div> </div> <div class=\"mb-3 row\"> <span class=\"form-label-display col-sm-4\">Statute Cites:</span> <div class=\"col-sm-8\">&#167; 1345.02(B)(2), &#167; 1345.01</div> </div> <div class=\"mb-3 row\"> <span class=\"form-label-display col-sm-4\">Rules & Regulations:</span> <div class=\"col-sm-8\">&#167; 109:4-3-09(A)(2), &#167; 109:4-3-09(B)(2)</div> </div> <div class=\"mb-3 row\"> <span class=\"form-label-display col-sm-4\">Subject Matter:</span> <div class=\"col-sm-8\">Home Improvements</div> </div> <div class=\"mb-3 row\"> <span class=\"form-label-display col-sm-4\">Category:</span> <div class=\"col-sm-8\"></div> </div> <div class=\"mb-3 row\"> <span class=\"form-label-display col-sm-4\">Sub-Category:</span> <div class=\"col-sm-8\"></div> </div> <div class=\"mb-3 row\"> <span class=\"form-label-display col-sm-4\">Issue Summary:</span> <div class=\"col-sm-8\">Supplier permanently enjoined from accepting money from consumer for home improvement goods and services and then permitting eight weeks to elapse without delivering the goods and services ordered or making a full refund to the consumer. Supplier to pay: $3,650 in restitution, $25,000 in civil penalties. </div> </div> </div> <br/> </div> <br/> </div> <footer> <div class=\"container footer-container\"> <div class=\"container copyright\"> ";

describe("terms decisions: removed sources, blocked notes and the boot cleanup", () => {
  it("SC DES, WV Purchasing and the WI DNR/DHS files are not registered, and their rows are deleted at boot", () => {
    const ids = new Set(ALL_BULK_SOURCES.map((s) => s.id));
    for (const id of ["sc-des-enforcement", "wv-purchasing-debarred", "wi-dnr-wells", "wi-dhs-abatement"]) {
      expect(ids.has(id), id).toBe(false);
      expect(RETIRED_BULK_SOURCES, id).toContain(id);
    }
    expect(sc.bulk ?? []).toEqual([]);
    expect(wi.bulk ?? []).toEqual([]);
  });
  it("each blocked note quotes the clause or names the refusal", () => {
    const has = (p: { blocked?: string[] }, re: RegExp) => (p.blocked ?? []).some((b) => re.test(b));
    expect(has(sc, /You may not: \(1\) reproduce.*except as specifically permitted by SCDES in writing/)).toBe(true);
    expect(has(wv, /purchasing\.wv\.gov.*Disallow: \/.*side door/)).toBe(true);
    expect(has(wi, /DNR.*noncommercial use of the general public/)).toBe(true);
    expect(has(wi, /DHS.*Wisconsin\.gov.*noncommercial use of the general public/)).toBe(true);
    expect(has(wi, /WisDOT.*noncommercial use of the general public/)).toBe(true);
    expect(has(nc, /debarred vendors.*for non-commercial use/)).toBe(true);
    expect(has(inPack, /IN\.gov Terms of Use.*not for resale or redistribution/)).toBe(true);
  });
});

describe("CO DORA contractor discipline (data.colorado.gov 7s5z-vewr)", () => {
  const row = {
    entityname: "Eagle Electric Co.", city: "Denver", state: "CO", licensetype: "EC", licensenumber: "1750", licensestatusdescription: "Active",
    casenumber: "1999-3999000360", programaction: "CLS Citation Issued", disciplineeffectivedate: "06/28/1999",
  };
  it("only contractor licenses' case rows, as published", () => {
    const src = co.enforcement!.find((s) => /discipline/i.test(s.source))!;
    expect(src.filter).toBe("casenumber IS NOT NULL AND licensetype in ('EC','PC','WC')");
    expect(coDisciplineHit(row)).toMatchObject({
      category: "discipline", name: "Eagle Electric Co.", id: "1999-3999000360", date: "1999-06-28", endDate: null, city: "Denver, CO",
      status: "DORA action: CLS Citation Issued", licenseNumber: "1750", adverse: null,
    });
  });
  it("adverse only from the action word; a completed date as published", () => {
    expect(coDisciplineHit({ ...row, programaction: "CLS Revocation" }).adverse).toBe(true);
    expect(coDisciplineHit({ ...row, programaction: "CLS Cease & Desist Order" }).adverse).toBe(true);
    expect(coDisciplineHit({ ...row, programaction: "CLS Stipulation" }).adverse).toBeNull();
    expect(coDisciplineHit({ ...row, disciplinecompletedate: "01/13/2009" }).endDate).toBe("2009-01-13");
  });
  it("a contractor license under a person's own name is not a company's record (FCRA)", () => {
    expect(coDisciplineHit({ ...row, entityname: "Abe Copp" }).name).toBeNull();
    expect(coDisciplineHit({ ...row, entityname: "SMITH, JOHN" }).name).toBeNull();
  });
});

describe("Ohio AG Public Inspection File", () => {
  it("reads the results table and the case page", () => {
    const r = parseOpifResults(OPIF_RESULTS);
    expect(r.total).toBe(108);
    expect(r.rows.map((x) => x.pif)).toEqual(["10000657", "10001077", "10001171", "10001171"]);
    expect(r.rows[1]).toEqual({ issueId: "1076", pif: "10001077", caseName: "State ex rel. Celebrezze v. Smith; Howard Smith Construction", supplier: "Howard Smith Construction", caseNumber: "A8906328" });
    const d = parseOpifDetail(OPIF_DETAIL);
    expect(d).toMatchObject({ "Date in Pif": "1/24/1990", Court: "C.P.", County: "Hamilton", "Subject Matter": "Home Improvements" });
    expect(d["Issue Summary"]).toMatch(/^Supplier permanently enjoined/);
  });
  it("one record per business supplier; a case name with a person is never shown", () => {
    expect(opifSuppliers("Jones Paving; Jones Construction")).toEqual(["Jones Paving", "Jones Construction"]);
    expect(opifSuppliers("Acme Heating and Construction, et al")).toEqual(["Acme Heating and Construction"]);
    expect(opifSuppliers("SMITH, JOHN")).toEqual([]);
    const [, row] = parseOpifResults(OPIF_RESULTS).rows;
    const h = opifHit(row, "Howard Smith Construction", parseOpifDetail(OPIF_DETAIL));
    expect(h).toMatchObject({ state: "OH", category: "court_case", name: "Howard Smith Construction", id: "10001077", date: "1990-01-24", city: "Hamilton County, OH", adverse: true });
    expect(h.sourceUrl).toBe("https://opif.ohioattorneygeneral.gov/Case/Detail/1076");
    expect(JSON.stringify(h)).not.toMatch(/Celebrezze v\. Smith/);
  });
  it("adverse from the court's summary: a judgment for the supplier is not adverse; no page read is unknown", () => {
    const [, row] = parseOpifResults(OPIF_RESULTS).rows;
    expect(opifHit(row, "Krumroy Construction Co.", { "Issue Summary": "Appellate court affirms lower court decision to grant judgment for supplier. No violation of CSPA where consumer exercised right to amend the work performed." }).adverse).toBe(false);
    expect(opifHit(row, "Howard Smith Construction", null).adverse).toBeNull();
    expect(oh.liveEnforcement?.[0]).toMatchObject({ category: "court_case" });
  });
});

describe("Delaware DOL: Workplace Fraud Act violators and prevailing wage debarments", () => {
  it("reads every violator row: names and addresses that wrap, columns that move from page to page", () => {
    const rows = parseWpfa(WPFA_TEXT);
    expect(rows.slice(0, 3)).toEqual([
      { name: "AJ Construction", city: "Smyrna, DE", date: "2023-09-21" },
      { name: "Top Quality Flooring & Design LLC", city: "Ocean City, NJ", date: "2022-11-11" },
      { name: "F&N Vasquez Concrete LLC", city: "Lincoln, DE", date: "2022-11-17" },
    ]);
    const by = Object.fromEntries(rows.map((r) => [r.name, r]));
    expect(by["Leo M Construction LLC"]).toEqual({ name: "Leo M Construction LLC", city: "Galena, MD", date: "2023-10-10" });
    expect(by["Precision Contractors Inc"]).toEqual({ name: "Precision Contractors Inc", city: "Fairfax, VA", date: "2023-10-30" });
    expect(by["G & E Rodriguez Construction LLC"]).toMatchObject({ city: "Wilmington, DE", date: "2024-11-06" });
    expect(rows.every((r) => r.date && !/\d{3,}/.test(r.name))).toBe(true);
    expect(wpfaHit(rows[0], "https://x.test/a.pdf")).toMatchObject({ category: "wage", adverse: true, name: "AJ Construction", city: "Smyrna, DE" });
  });
  it("debarments: the company only, never the people debarred individually", () => {
    const { updated, rows } = parseDeDebar(DEBAR_TEXT);
    expect(updated).toBe("2022-07-06");
    expect(rows.map((r) => r.company)).toEqual(["Mullen Brothers, Inc.", "State Contractors Corporation", "Green Granite", "Pro Image Landscaping, Inc.", "Liberty Mechanical, LLC", "Integrated Mechanical and Fire Systems Inc.", "ACH 1, INC."]);
    expect(rows[0]).toMatchObject({ city: "Boothwyn, PA", terms: "Indefinite: Civil Contempt" });
    expect(debarCompany("Integrated Mechanical and Fire Systems Inc. and Allison Sheldon, individually")).toBe("Integrated Mechanical and Fire Systems Inc.");
    expect(de.bulk!.map((b) => b.id)).toEqual(["de-dol-wpfa-violators", "de-dol-pw-debarment"]);
    expect(de.bulk!.every((b) => b.companiesOnly)).toBe(true);
  });
});
