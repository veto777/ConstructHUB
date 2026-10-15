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
    expect(hits.map((h) => h.name)).toEqual(["360 Pro Carpentry LLC", "Affordable Patios & Sunrooms / dba Reno Patios & Fireplace"]);
    expect(hits[0]).toMatchObject({ city: "Las Vegas, NV", category: "debarment", adverse: true, status: "Disqualified from public works: Until the suspension is lifted" });
    expect(JSON.stringify(hits)).not.toContain("Hugo");
  });
});
