import { describe, expect, it } from "vitest";
import { mnDebarHit, mnLicense, mnOrderAdverse, parseMnDebarred, parseMnOrders } from "./mn";

// Saved from DLI's rbc_2026actions.pdf (pdftotext -layout), 2026-10-15.
const ORDERS = "Residential Building Contractor Enforcement Actions\n2026 Year to Date\nAny violation of an Order of the Commissioner is a gross misdemeanor pursuant to Minn. Stat. \u00a7326B.845, subd. 1.\n\nA Consent Order is not a finding of fact or admission of guilt.\n\nFor more information about specific orders, please call 651-284-5069 or email dli.contractor@state.mn.us.\n\n\n365 Exteriors LLC (BC807216), and Gina Louis Delmedico, Individually and Richard\nAnthony Vasquez (QB806019)\n\n    \u2022   West St. Paul, MN; South St. Paul, MN\n    \u2022   Consent Order: The residential building contractor license of Respondent 365 Exteriors LLC, license No.\n        BC807216, is revoked; Respondent Richard Anthony Vasquez, who holds qualifying builder registration\n        No. QB806019, is censured; Respondent 365 Exteriors LLC shall cease and desist from acting or holding\n        itself out as a residential building contractor, residential remodeler, or residential roofer in the state of\n        Minnesota; $10,000 monetary penalty, $7,000 stayed with conditions\u2013 04/17/2026\n    \u2022   RBC2603-0038/ALF\n\n\nA-1 NXterior Restorations L.L.C. and Cindy Lee \u2013 BC753468 and QB747420\n\n    \u2022   St. Paul, MN; Sheboygan, WI\n    \u2022   Licensing Order with Penalty: The Commissioner revokes the residential building contractor license of\n        Respondent A-1 NXterior Restoration L.L.C., No. BC753468 and the qualifying builder registration of\n        Respondent Cindy Lee, registration No. QB747420; Respondents shall cease and desist from acting or\n        holding themselves out as a residential building contractor, residential remodeler, or residential roofer\n        in the state of Minnesota.; $5,000 monetary penalty \u2013 04/14/2026\n    \u2022   RBC2512-0036/ALF\n\n\n\n\nResidential Building Contractor Enforcement Actions                                                                     1\n\fAce Restoration LLC, and Aaron Christian Loth, Individually\n\n   \u2022   Champlin, MN\n   \u2022   Consent Cease and Desist Order; Respondents shall cease and desist from acting or holding themselves\n       out as a residential building contractor, residential remodeler, or residential roofer in the state of\n       Minnesota without the requisite licensure; $5,000 monetary penalty, stayed with conditions \u2013\n       02/12/2026\n   \u2022   MLT2512-0013/ALF\n\n\nAdamant Painting and Renovations, LLC, and Adam Sherman, Individually\n\n   \u2022   Farmington, MN\n   \u2022   Consent Cease and Desist Order: Respondents shall cease and desist from acting or holding themselves\n       out as a residential building contractor, residential remodeler, or residential roofer in the state of\n       Minnesota without the requisite licensure; $8,000 monetary penalty, stayed with conditions -\n       09/22/2026\n   \u2022   MLT2606-003/RNW\n\n\nAdkins, Aaron Matthew \u2013 see Inspire Renovation LLC\n\nAdvanced Building Co LLC \u2013 see Labrocca, James John\n\nAguilar, Denis\n";
// Saved from mn.gov/admin/osp/government/suspended-debarred/, 2026-10-15 (one business, one individual).
const DEBARRED = "<div class=\"results\">\n<div class=\"row\">\n<div class=\"column wide\">\n<div class=\"result-link\">\n<a id=\"92Anchor\" href=\"javascript:toggleDiv('92')\">3G Contracting Inc.</a>\n</div>\n</div>\n</div>\n<div id=\"92\" style=\"display:none;\">\n<table>\n<tr>\n<td colspan=\"2\">640 Railroad Drive Ste 600</td>\n</tr>\n<tr>\n<td colspan=\"2\">Norwood, MN 55368</td>\n</tr>\n<tr>\n<td colspan=\"2\" class=\"bottom-space\">Owner/Officer: Jennifer Rath</td>\n</tr>\n<tr>\n<td class=\"col1\">Suspension Date:</td><td>3/25/2025</td>\n</tr>\n<tr>\n<td class=\"col1\">Suspension End Date:</td><td>9/25/2025</td>\n</tr>\n<tr>\n<td class=\"col1\">Debarment Date:</td><td>9/26/2025</td>\n</tr>\n<tr>\n<td class=\"col1\">Debarment End Date:</td><td>9/26/2026</td>\n</tr>\n<tr>\n<td class=\"col1\">Cause of Suspension or Debarment:</td><td>Failure to provide certified payroll reports to prime contractor on State Contract 250-103-002</td>\n</tr>\n</table>\n</div>\n</div>\n<div class=\"results\">\n<div class=\"row\">\n<div class=\"column wide\">\n<div class=\"result-link\">\n<a id=\"111Anchor\" href=\"javascript:toggleDiv('111')\">Abdifitah Mohamud Mohamed, an individual</a>\n</div>\n</div>\n</div>\n<div id=\"111\" style=\"display:none;\">\n<table>\n<tr>\n<td colspan=\"2\"></td>\n</tr>\n<tr>\n<td colspan=\"2\">,  </td>\n</tr>\n<tr>\n<td colspan=\"2\" class=\"bottom-space\">Owner/Officer: </td>\n</tr>\n<tr>\n<td class=\"col1\">Suspension Date:</td><td>10/17/2025</td>\n</tr>\n<tr>\n<td class=\"col1\">Suspension End Date:</td><td>10/17/2026</td>\n</tr>\n<tr>\n<td class=\"col1\">Cause of Suspension or Debarment:</td><td>Suspended as an individual under Minnesota Statute, 16 B.97, subdivision 3 (6) while it is determined whether there is cause for debarment.</td>\n</tr>\n</table>\n</div>\n</div>\n";

describe("Minnesota DLI", () => {
  it("parses enforcement-action entries, keeps businesses, joins wrapped captions and reads the penalty and date", () => {
    const o = parseMnOrders(ORDERS);
    expect(o[0]).toMatchObject({ name: "365 Exteriors LLC, and Gina Louis Delmedico, Individually and Richard Anthony Vasquez", location: "West St. Paul, MN; South St. Paul, MN",
      date: "2026-04-17", amount: 10000, cases: "RBC2603-0038/ALF", licenses: ["BC807216", "QB806019"] });
    expect(o[1]).toMatchObject({ name: "A-1 NXterior Restorations L.L.C. and Cindy Lee", date: "2026-04-14", amount: 5000, licenses: ["BC753468", "QB747420"] });
    expect(o[2]).toMatchObject({ name: "Ace Restoration LLC, and Aaron Christian Loth, Individually", date: "2026-02-12", cases: "MLT2512-0013/ALF" });
    expect(o.some((x) => /^Aguilar/.test(x.name))).toBe(false); // an individual alone: not kept
  });

  it("reads the debarment list and skips individuals", () => {
    const d = parseMnDebarred(DEBARRED);
    expect(d).toHaveLength(1);
    expect(d[0]).toMatchObject({ name: "3G Contracting Inc.", owner: "Jennifer Rath", city: "Norwood, MN", address: "640 Railroad Drive Ste 600, Norwood, MN 55368" });
    expect(d[0].fields["Debarment Date"]).toBe("9/26/2025");
  });

  it("marks a debarment adverse only while it runs (audit 2026-10-15)", () => {
    const [v] = parseMnDebarred(DEBARRED); // debarred 9/26/2025 to 9/26/2026
    expect(mnDebarHit(v, "2026-05-01")!.hit).toMatchObject({ status: "Debarred", adverse: true });
    expect(mnDebarHit(v, "2026-10-15")!.hit).toMatchObject({ status: "Debarred; period ended 2026-09-26", adverse: false });
  });

  it("leaves out a listed name that reads as a person even without \", an individual\"", () => {
    // "Jacob Roy" is listed that way on the page (2026-10-15); the entry's fields here are the business's above.
    expect(parseMnDebarred(DEBARRED.replace(">3G Contracting Inc.<", ">Jacob Roy<"))).toHaveLength(0);
  });

  it("derives adverse from each order's own words", () => {
    const o = parseMnOrders(ORDERS);
    expect(o.map((x) => mnOrderAdverse(x.order))).toEqual([true, true, true, true]);
    // A caption whose business word is only "Homes" (a surname too) is not taken for a business.
    expect(parseMnOrders(ORDERS.replace("Adamant Painting and Renovations, LLC, and Adam Sherman, Individually", "Adam Homes"))
      .some((x) => x.name === "Adam Homes")).toBe(false);
  });

  it("maps a license export row with its address, phone and keys", () => {
    const h = mnLicense({ Bus_Pers: "Business", License_Type: "Plumbing", License_Subtype: "Plumbing Contractor", Name: "RIPPLINGER PLUMBING INC", DBA_Name: "",
      Addr1: "43794 CNTY RD 9", Addr2: "", City: "HOLDINGFORD", St: "MN", Zip: "56340", Phone_No: "3202902217", Lic_Number: "PC675877", Status: "Issued", Exp_Date: "12/31/2027" })!;
    expect(h.hit).toMatchObject({ businessName: "RIPPLINGER PLUMBING INC", address: "43794 CNTY RD 9, HOLDINGFORD, MN 56340", phone: "3202902217", expires: "2027-12-31", status: "Issued" });
    expect(h.keys?.licenses).toEqual(["PC675877"]);
  });
});
