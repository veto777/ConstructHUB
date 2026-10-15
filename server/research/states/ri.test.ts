import { describe, expect, it } from "vitest";
import { parseDltDetail, parseDltGrid } from "./ri";

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
