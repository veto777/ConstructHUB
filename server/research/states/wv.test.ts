import { describe, expect, it } from "vitest";
import { parseEvs, parseWvDol, sfmHits } from "./wv";

// Saved from the live sources on 2026-10-15.
const HVAC_PAGE = `<p>Records 1 to 24 of 6112 Records<br /><table><tr>
            <td class="style3"><div align="center">HVAC00002</div></td>
            <td class="style3"><div align="center">JAMES E KING JR</div></td>
            <td class="style3"><div align="center">SAINT ALBANS</div></td>
            <td class="style3"><div align="center">WV</div></td>
\t    <td class="style3"><div align="center">KANAWHA</div></td>

            <td class="style3"><div align="center">TECHNICIAN   </div></td>
\t\t\t<td class="style3"><div align="center">4/1/2027</div></td>

          </tr></table>`;

const SFM_ROWS = [
  { FirstName: "BRADLEY", LastName: "SHAFFER", State: "WV", Suffix: null, LicenseNumber: "J92921915580211", LicenseType: "JOURNEYMAN,ELECTRICIAN", CertificationExpirationDate: "30-06-2024", City: "EGLON" },
  { FirstName: "BRADLEY", LastName: "SHAFFER", State: "WV", Suffix: null, LicenseNumber: "J92921915580211", LicenseType: "JOURNEYMAN,ELECTRICIAN", CertificationExpirationDate: "30-06-2027", City: "EGLON" },
];

const EVS_PAGE = `<TABLE class="table table-bordered">
\t<tr style="background-color:lightgoldenrodyellow;color:blue !important;font-weight:bolder;">
\t\t<td>Business Name</td>
\t\t<td>Owner Name</td>
\t\t<td>City</td>
\t\t<td>State</td>
\t\t<td>FEIN</td>
\t</tr>
<tr>
\t<td valign="top"> A & A SANDS CONSTRUCTION INC&nbsp;</td>
\t<td valign="top"> , &nbsp;</td>
\t<td valign="top"> WILLIAMSTOWN&nbsp;</td>
\t<td valign="top"> WV&nbsp;</td>
\t<td valign="top"> *****4532&nbsp;</td>
</tr>
</TABLE>`;

describe("West Virginia sources", () => {
  it("reads a Division of Labor results page", () => {
    const { total, hits } = parseWvDol(HVAC_PAGE, { results: "HVAC_RESULTS.cfm", label: "HVAC", type: (c) => `HVAC ${c}` }, "principal");
    expect(total).toBe(6112);
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ licenseNumber: "HVAC00002", principal: "JAMES E KING JR", city: "SAINT ALBANS, WV", licenseType: "HVAC TECHNICIAN", expires: "2027-04-01" });
  });

  it("keeps the latest certification period of each electrician license", () => {
    const hits = sfmHits(SFM_ROWS, "principal");
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ licenseNumber: "J92921915580211", licenseType: "JOURNEYMAN ELECTRICIAN", expires: "2027-06-30", city: "EGLON, WV", principal: "BRADLEY SHAFFER" });
  });

  it("reads Employer Violator System rows without the owner", () => {
    expect(parseEvs(EVS_PAGE)).toEqual([{ name: "A & A SANDS CONSTRUCTION INC", city: "WILLIAMSTOWN", state: "WV", fein: "*****4532" }]);
  });
});
