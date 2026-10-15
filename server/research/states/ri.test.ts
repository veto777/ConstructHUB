import { describe, expect, it } from "vitest";
import { dltViolationHit, parseDltDetail, parseDltGrid, rosterColumns } from "./ri";

// Snippets of the DLT lookup's results grid and detail panel, 2026-10-15.
const GRID = `<table cellspacing="0" cellpadding="4" id="MainContent_gvLicenseSearchResults" style="color:#333333;">
<tr class="fixedHeader"><th scope="col">License #</th><th class="hidden-xs" scope="col">Status</th><th scope="col">First Name</th><th class="hidden-xs" scope="col">MI</th><th scope="col">Last Name</th></tr>
<tr><td><a id="x" href="javascript:__doPostBack(&#39;ctl00$MainContent$gvLicenseSearchResults$ctl02$lbLicenseDetails&#39;,&#39;&#39;)">A-003150</a></td><td class="hidden-xs">-</td><td>BENJAMIN </td><td class="hidden-xs">&nbsp;</td><td>BAPTISTA </td></tr>
</table>`;
const DETAIL = `<label id="MainContent_lblField1Hdr" for="lblField1" class="col-sm-3 control-label">Name</label><div><span id="MainContent_lblField1">BENJAMIN BAPTISTA</span></div>
<label id="MainContent_lblField2Hdr" for="lblField2">Address</label><div><span id="MainContent_lblField2">79 RALCO WAY, UNIT 4    <br />CUMBERLAND   , RI  02864</span></div>
<label id="MainContent_lblField3Hdr" for="lblField3">Telephone</label><div><span id="MainContent_lblField3">(401) 723-5800</span></div>
<label id="MainContent_lblField6Hdr" for="lblField6">Expiration Date</label><div><span id="MainContent_lblField6">2/28/2027</span></div>
<label id="MainContent_lblField13Hdr" for="lblField13">Cease &amp; Desist Date</label><div><span id="MainContent_lblField13">11/22/2013</span></div>`;

describe("RI DLT lookup", () => {
  it("reads the results grid", () => {
    expect(parseDltGrid(GRID, "MainContent_gvLicenseSearchResults")).toEqual([{
      license: "A-003150", target: "ctl00$MainContent$gvLicenseSearchResults$ctl02$lbLicenseDetails",
      cells: { "License #": "A-003150", Status: "-", "First Name": "BENJAMIN", MI: null, "Last Name": "BAPTISTA" },
    }]);
  });
  it("reads the detail panel by its labels", () => {
    expect(parseDltDetail(DETAIL)).toEqual({
      Name: "BENJAMIN BAPTISTA", Address: "79 RALCO WAY, UNIT 4 , CUMBERLAND , RI 02864", Telephone: "(401) 723-5800",
      "Expiration Date": "2/28/2027", "Cease & Desist Date": "11/22/2013",
    });
  });
});

describe("RI audit fixes (2026-10-15)", () => {
  it("marks a violation adverse from its hearing result or cease-and-desist date, never by default", () => {
    // Violation 7581 as the DLT lookup showed it on 2026-10-15 (no hearing result published).
    const row = { license: "7581", target: null, cells: { Company: "BERARDUCCI ELECTRIC" } };
    const d: Record<string, string | null> = { "Violation #": "7581", Company: "BERARDUCCI ELECTRIC", "Violation Status": "CA", "Violation Date": "07/24/2024",
      "Cease & Desist Date": "01/02/2025", "Violation Description": "Compliance with rules and requirements of city or town.", Address: "181 GRACE STREET , CRANSTON , RI 02910-3509" };
    expect(dltViolationHit("Violations History", row, d)).toMatchObject({ id: "7581", date: "2024-07-24", status: "Violation history, status code CA", adverse: true });
    expect(dltViolationHit("Violations", row, { ...d, "Cease & Desist Date": null }).adverse).toBeNull();
    expect(dltViolationHit("Violations", row, { ...d, "Hearing Result": "Dismissed" }).adverse).toBe(false);
  });

  it("finds the expiration column by its values and never takes the effective date for it", () => {
    // The landscape-architect roster as downloaded 2026-10-15: its header names the last three columns
    // Effective Date, Expiration Date, License Status, but the rows hold status, effective, expiration.
    const header = ["Name", "Roster", "License Type", "License No.", "Effective Date", "Expiration Date", "License Status", "Address 1", "Address 2", "City", "State", "Zip Code"];
    const rows = [
      ["ACTIVITAS, INC.", "Board of Examiners of Landscape Architects", "LA Certificate of Authorization", "LA.0023133-COA", "ACTIVE", "07-01-2026", "06-30-2028"],
      ["ANTHONY W. LACHOWICZ", "Board of Examiners of Landscape Architects", "LA Certificate of Authorization", "LA.0020049-COA", "PENDING FINAL APPROVAL", "", "06-30-2012"],
      ["Benjamin W. Gary Jr.", "Board of Examiners of Landscape Architects", "LA Certificate of Authorization", "LA-COA", "PENDING FINAL APPROVAL", "", ""],
    ];
    expect(rosterColumns(header, rows)).toEqual({ status: 4, expires: 6 });
    // The architects' roster names its columns in row order.
    const arch = ["Name", "Roster", "License Type", "License No.", "License Status", "Effective Date", "Expiration Date", "Address 1", "Address 2", "City", "State", "Zip Code"];
    expect(rosterColumns(arch, [["101 Architecture LLC", "Board of Examination & Registration of Architects", "ARC Certificate of Authorization", "ARC.0020713-COA", "ACTIVE", "01-01-2025", "12-31-2026"]]))
      .toEqual({ status: 4, expires: 6 });
  });
});
