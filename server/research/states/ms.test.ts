import { describe, expect, it } from "vitest";
import { msShortDate, parseMsDetail, parseMsExport, parseMsResults, parseMsViolations } from "./ms";

// Snippets of search.msboc.us pages saved 2026-10-15 (whitespace trimmed).
const RESULTS = `<tr class="TR1Red "><td nowarp><table><tr><td class="tight" ><a href="Detail.cfm?ContractorID=10433&ContractorType=Commercial&varDataSource=BOC" class="btn">View</a></td></tr></table></td>
<td style="background-color:#8FC1E3">Commercial </td><td nowrap>BRASFIELD & GORRIE , L.L.C.</td><td nowrap ><table style="width:100%"><tr><td align="left" style="color:black">11098-MC</td><td align="right"> Licensed </td></tr></table></td>
<td nowrap>3021 7th AVE SOUTH </td><td>BIRMINGHAM</td><td>AL</td><td nowrap>35233</td><td nowrap>205-328-4000</td></tr>`;

const DETAIL = `<td style="text-align:center"><h4>MAGNOLIA CONSTRUCTORS, INC</h4></td><td style="width:10%">11223
<div id="contractorID" style="display: none;">14505</div><div id="contractorType" style="display: none;">Commercial</div></td>
<tr><td align="right" nowrap class="TDHead"><div class="right">Address</div></td><td nowrap="nowrap">POST OFFICE BOX 564<br> AMORY, MS  38821 <br /> MONROE County</tr></td></tr>
<tr><td align="right" class="TDHead" nowrap>Phone</td><td>(662)236-7656</td></tr>
<tr><td align="right" class="TDHead" nowrap>Expiration</td><td>04/11/2001</td></tr>
<tr><td align="right" class="TDHead" nowrap>Status</td><td class="TRInactive">Licensed                       Expired</td></tr>
<b>Class(es)</b><table><tr class="TDHead"><td>Classification</td><td>Qualifying Name</td></tr><tr class="TR1"><td>CONCRETE</td><td>DENNIS BRASFIELD</td></tr></table>
<b>Officers</b><table><tr class="TDHead"><td>Name</td><td>Title</td></tr><tr class="TR1"><td>M JAMES GORRIE</td><td>PRESIDENT</td></tr></table>`;

const VIOLATION = `<tr><td></td><td><b>Resolved - Public</b></td><td nowrap class="TD">Miss Code Ann. §31-3-21</td><td width="300"><b><cfif Len(dba_name)><cfelse>RIDGE PEAK ROOFING, LLC</cfif></b></td><td align="center">04/02/24</td><td align="center">01/08/25</td></tr>
<tr><td colspan="3" align="right" class="TD">Complaint:&nbsp;</td><td colspan="3" class="TD">submitting a bid without a certificate of responsibility</td></tr>
<tr><td colspan="3" align="right" class="TD">Resolution:&nbsp;</td><td colspan="3" class="TD"><b>SETTLED</b> SETTLED FOR A CIVIL PENALTY IN THE AMOUNT OF $2,797.29</td></tr>`;

const EXPORT = `<table><tr align="center"><td>Type</td><td>Company Name</td><td>License Number</td><td Address</td><td>City</td><td>State</td><td>Zip</td><td>Phone</td></tr>
<tr><td> Residential </td><td>ACADIANA CUSTOM HOMES, LLC</td><td>17337 Suspended                       Expired</td><td nowrap>402 GARTH FARM RD. </td><td>BRANDON</td><td>MS</td><td nowrap>39042</td><td nowrap>601-376-8279</td></tr></table>`;

describe("Mississippi MSBOC parsers", () => {
  it("reads result rows with their address", () => {
    expect(parseMsResults(RESULTS)).toEqual([{
      detail: "http://search.msboc.us/Detail.cfm?ContractorID=10433&ContractorType=Commercial&varDataSource=BOC",
      type: "Commercial", name: "BRASFIELD & GORRIE , L.L.C.", address: "3021 7th AVE SOUTH, BIRMINGHAM, AL 35233",
    }]);
  });
  it("reads a detail page", () => {
    const d = parseMsDetail(DETAIL);
    expect(d).toMatchObject({ name: "MAGNOLIA CONSTRUCTORS, INC", licenseNumber: "11223", type: "Commercial", city: "AMORY, MS", address: "POST OFFICE BOX 564, AMORY, MS 38821", phone: "(662)236-7656", expires: "2001-04-11", status: "Licensed Expired" });
    expect(d.classes).toEqual([{ cls: "CONCRETE", qualifier: "DENNIS BRASFIELD" }]);
    expect(d.officers).toEqual([{ name: "M JAMES GORRIE", title: "PRESIDENT" }]);
  });
  it("reads a violation with its penalty", () => {
    const [v] = parseMsViolations(VIOLATION, "Commercial", "x");
    expect(v).toMatchObject({ name: "RIDGE PEAK ROOFING, LLC", date: "2024-04-02", endDate: "2025-01-08", status: "Resolved - Public", amount: 2797.29, adverse: true });
  });
  it("reads the suspended-license export", () => {
    const [h] = parseMsExport(EXPORT, "S");
    expect(h).toMatchObject({ name: "ACADIANA CUSTOM HOMES, LLC", id: "17337", licenseNumber: "17337", status: "License suspended (and expired)", phone: "601-376-8279", address: "402 GARTH FARM RD., BRANDON, MS 39042" });
  });
  it("reads two-digit years", () => {
    expect(msShortDate("04/02/24")).toBe("2024-04-02");
    expect(msShortDate("12/31/98")).toBe("1998-12-31");
  });
});
