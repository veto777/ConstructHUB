import { describe, expect, it } from "vitest";
import { parseNscbDiscipline, parseNscbLicenses, parseNvDisqualified } from "./nv";

// Snippets trimmed from live NSCB and Labor Commissioner pages, 2026-10-15.
const LICENSES = `<table class="table table-bordered table-responsive" cellspacing="0" id="ContentPlaceHolder1_dtgResults" style="border-collapse:collapse;">
<tbody><tr class="h6"><td>Principal Name</td><td>Legal Business Name</td><td>DBA Name</td><td>License Number</td><td>NV Business ID</td><td>Classification</td><td>Status</td><td>City</td><td>State</td></tr>
<tr><td>&nbsp;</td><td>
  <a id="ContentPlaceHolder1_dtgResults_btnDetails_0" href="javascript:__doPostBack('ctl00$ContentPlaceHolder1$dtgResults$ctl02$btnDetails','')">JOHNSON PACIFIC INC</a>
  </td><td>SIERRA NEVADA SPAS</td><td>0020861</td><td>&nbsp;</td><td>A-10D Pools and Spas of Fiberglass<br>A-22 Unclassified<br><br>A22 IS DESIGNATED FOR SPAS &amp; SAUNAS ONLY ONLY</td><td>Voluntary Surrender</td><td>RENO</td><td>NV</td></tr>
<tr><td>&nbsp;</td><td><a>SIERRA NEVADA CONSTRUCTION INC</a></td><td>&nbsp;</td><td>0025565</td><td>NV19881009372</td><td>A General Engineering</td><td>Active</td><td>SPARKS</td><td>NV</td></tr>
</tbody></table>`;

const DISCIPLINE = `<table cellspacing="0" rules="all" class="table" border="1" id="ContentPlaceHolder1_dtgSearchResults">
<tr style="background-color:Yellow;"><td style="font-weight:bold;">Date</td><td>Licensee(s)</td><td>License Number</td><td>Type</td></tr>
<tr><td><span OnClick="btn_Click">2026-09-08T00:00:00</span></td><td>PAUL DAVIS OF RENO LAKE TAHOE</td><td><a href="javascript:__doPostBack(&#39;x&#39;,&#39;&#39;)">0091752</a></td><td><span style="color:#FF0000;">Administrative Citation</span></td></tr>
<tr><td><span OnClick="btn_Click">1900-01-01T00:00:00</span></td><td>PAUL DAVIS OF RENO LAKE TAHOE</td><td><a>0091754</a></td><td><span></span></td></tr>
<tr><td><span OnClick="btn_Click">2026-09-23T00:00:00</span></td><td>SIERRA NEVADA BUILDERS LLC</td><td><a>0081941</a></td><td><span>Disciplinary Hearing</span></td></tr>
</table>`;

const DISQUALIFIED = `<table border="0"><tbody>
<tr><td class="xl77">Contractor</td><td class="xl77">Corporate
  Officers</td><td class="xl77">Suspension
  Period</td></tr>
<tr><td> </td><td> </td><td> </td></tr>
<tr><td colspan="1">360 Pro Carpentry LLC</td><td colspan="1">Hugo Alejandro Sanabria Lopez,</td><td colspan="1">Until the suspension is lifted</td></tr>
<tr><td colspan="1">3140 Polaris Ave., Suite 17 - 18</td><td colspan="1">Managing Member</td><td colspan="1"> </td></tr>
<tr><td colspan="1">Las Vegas, NV 89102</td><td colspan="1"> </td><td colspan="1"> </td></tr>
<tr><td colspan="1"> </td><td colspan="1"> </td><td colspan="1"> </td></tr>
<tr><td>Affordable Patios &amp;
  Sunrooms</td><td>Richard Garriga Taylor</td><td>Until the suspension is lifted</td></tr>
<tr><td>DBA Reno Patios &amp; Fireplace</td><td>President</td><td> </td></tr>
<tr><td>910 Glendale Avenue</td><td> </td><td> </td></tr>
<tr><td>Sparks, NV 89431</td><td> </td><td> </td></tr>
<tr><td> </td><td> </td><td> </td></tr>
<tr><td colspan="1">Stuart Spear</td><td colspan="1">Stuart Spear, Owner</td><td colspan="1">Until the suspension is lifted</td></tr>
<tr><td colspan="1">dba Stuart Spear Construction</td><td colspan="1"> </td><td colspan="1"> </td></tr>
<tr><td colspan="1">P.O. Box 18827</td><td colspan="1"> </td><td colspan="1"> </td></tr>
<tr><td colspan="1">Reno, NV 89511</td><td colspan="1"> </td><td colspan="1"> </td></tr>
<tr><td colspan="1"> </td><td colspan="1"> </td><td colspan="1"> </td></tr>
<tr><td colspan="1">H2O Transportation LLC</td><td colspan="1">Araceli Espitia</td><td colspan="1">July 18, 2025 to July 18, 2028</td></tr>
<tr><td colspan="1">681 Tarn Way</td><td colspan="1"> </td><td colspan="1"> </td></tr>
<tr><td colspan="1">Reno, NV 89503</td><td colspan="1"> </td><td colspan="1"> </td></tr>
</tbody></table>`;

describe("Nevada sources", () => {
  it("reads NSCB license rows, classifications apart from limitations", () => {
    const hits = parseNscbLicenses(LICENSES, "company");
    expect(hits).toHaveLength(2);
    expect(hits[0]).toMatchObject({ businessName: "JOHNSON PACIFIC INC dba SIERRA NEVADA SPAS", licenseNumber: "0020861", licenseType: "A-10D Pools and Spas of Fiberglass; A-22 Unclassified", status: "Voluntary Surrender", city: "RENO, NV" });
    expect(hits[0].specialty).toBe("A22 IS DESIGNATED FOR SPAS & SAUNAS ONLY ONLY");
    expect(hits[1]).toMatchObject({ licenseType: "A General Engineering", specialty: "NV business id NV19881009372", principal: null });
  });
  it("reads NSCB board actions and folds the undated license rows into the action before them", () => {
    const hits = parseNscbDiscipline(DISCIPLINE);
    expect(hits).toHaveLength(2);
    expect(hits[0]).toMatchObject({ name: "PAUL DAVIS OF RENO LAKE TAHOE", date: "2026-09-08", status: "Administrative Citation", adverse: true, detail: "License 0091752; also lists license 0091754" });
    expect(hits[1]).toMatchObject({ date: "2026-09-23", status: "Disciplinary Hearing", adverse: null });
  });
  it("reads the disqualified-contractor blocks without the officers", () => {
    const hits = parseNvDisqualified(DISQUALIFIED);
    // Both of the second block's names are businesses (patios, sunrooms), so both are kept.
    expect(hits.map((h) => h.name).slice(0, 2)).toEqual(["360 Pro Carpentry LLC", "Affordable Patios & Sunrooms / Reno Patios & Fireplace"]);
    expect(hits[0]).toMatchObject({ city: "Las Vegas, NV", category: "debarment", adverse: true, status: "Disqualified from public works: Until the suspension is lifted" });
    expect(JSON.stringify(hits)).not.toContain("Hugo");
  });
});

const DETAILS = `<span id="ContentPlaceHolder1_lblLicNum">0091752</span><span id="ContentPlaceHolder1_lblMonetaryLimit1">Unlimited</span>
<span id="ContentPlaceHolder1_lblMailStrt1">106 S 1250 W</span><span id="ContentPlaceHolder1_lblMailStrt2"></span>
<span id="ContentPlaceHolder1_lblMailCityOne">CENTERVILLE</span>, <span id="ContentPlaceHolder1_lblMailStateOne">UT</span> <span id="ContentPlaceHolder1_lblMailZipOne">84014</span>
<span id="ContentPlaceHolder1_lblMailPhoneOne">(801) 561-4911</span>
<span id="ContentPlaceHolder1_lblStrt1">650 INNOVATION DR</span><span id="ContentPlaceHolder1_lblStrt2">STE A</span>
<span id="ContentPlaceHolder1_lblCityOne">RENO</span>, <span id="ContentPlaceHolder1_lblStateOne">NV</span> <span id="ContentPlaceHolder1_lblZipOne">89511</span>
<span id="ContentPlaceHolder1_lblPhoneOne">(775) 825-7856</span><span id="ContentPlaceHolder1_lblExpireDate">02/28/2028</span>
<span id="ContentPlaceHolder1_dtgPrincipalBroker_lblPrincipalName_0"> RADMALL, BRANDON  VAL </span></td><td><span id="ContentPlaceHolder1_dtgPrincipalBroker_lblPrincipalRelation_0">President</span>
<span id="ContentPlaceHolder1_dtgQualInd_lblQualIndName_1">BLASER, ERIC DANIEL</span></td><td><span id="ContentPlaceHolder1_dtgQualInd_lblQaulType_1">Trade</span>`;

describe("NSCB license details", () => {
  it("reads addresses, phones, expiry and people", async () => {
    const { parseNscbDetails } = await import("./nv");
    expect(parseNscbDetails(DETAILS)).toEqual({
      address: "650 INNOVATION DR STE A, RENO, NV 89511", mailing: "106 S 1250 W, CENTERVILLE, UT 84014",
      phone: "(775) 825-7856", mailPhone: "(801) 561-4911", expires: "2028-02-28", limit: "Unlimited",
      people: [{ name: "BRANDON VAL RADMALL", role: "President" }, { name: "ERIC DANIEL BLASER", role: "Qualified individual (Trade)" }],
    });
  });
});

describe("Nevada (audit 2026-10-15)", () => {
  it("disqualified list: a person's own name is left out, the dba kept; a dated period ends", () => {
    const hits = parseNvDisqualified(DISQUALIFIED, "2026-10-15");
    const names = hits.map((h) => h.name);
    expect(names).toContain("Stuart Spear Construction");
    expect(names.some((n) => /^Stuart Spear( \/|$)/.test(n ?? ""))).toBe(false);
    expect(hits.find((h) => h.name === "H2O Transportation LLC")).toMatchObject({ date: "2025-07-18", endDate: "2028-07-18", adverse: true });
    expect(parseNvDisqualified(DISQUALIFIED, "2028-08-01").find((h) => h.name === "H2O Transportation LLC")).toMatchObject({ adverse: false, status: "Disqualification period over: July 18, 2025 to July 18, 2028" });
    expect(hits.every((h) => !/NRS 338.017\)$/.test(h.detail ?? "") || h.detail!.startsWith("On the Labor Commissioner"))).toBe(true);
  });
});
