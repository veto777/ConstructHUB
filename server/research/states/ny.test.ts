import { describe, expect, it } from "vitest";
import { parseEdList } from "./ny";

// Saved from apps.labor.ny.gov/EDList/searchResults.do on 2026-10-15 (one DOL row, one WCB row).
const DOL = `<table id="ResultsTable" class="its"><thead><tr><th>Agency</th></tr></thead><tbody>
<tr class="odd">
<td style="text-transform: uppercase;">DOL</td>
<td style="text-transform: uppercase;">DOL</td>
<td>*****8654</td>
<td style="text-transform: uppercase;width:20%"><a href="/EDList/displayDebarrmentDetails.do?view=Public&agencyKey=487993089&agency=DOL ">AMERICAN PAVING, INC.</a></td>
<td style="text-transform: uppercase;"></td>
<td style="text-transform: uppercase;width:20%">8 FORREST AVE.<br>GLEN COVE, NY 11542</td>
<td>05/24/2024</td>
<td>05/24/2029</td></tr></tbody></table><span class="pagebanner">One item found.</span>`;

const WCB = `<table id="ResultsTable" class="its"><tbody>
<tr class="odd">
<td style="text-transform: uppercase;">WCB</td>
<td>*****9186</td>
<td style="text-transform: uppercase;width:20%"><a href="/EDList/displayDebarrmentDetails.do?ename=AMERICAN+A-1+AUTO+CENTER+INC&agency=WCB&tin=*****9186&agencyKey=831065 ">AMERICAN A-1 AUTO CENTER INC</a></td>
<td style="text-transform: uppercase;"></td>
<td style="text-transform: uppercase;width:20%">3000 MARCUS AVE # 2E4<br>NEW HYDE PARK, NY 11042</td>
<td>03/12/2026</td>
<td>07/09/2027</td></tr></tbody></table>`;

describe("NY DOL debarment list parser", () => {
  it("reads a DOL row", () => {
    const [h] = parseEdList(DOL, "DOL");
    expect(h.name).toBe("AMERICAN PAVING, INC.");
    expect(h.date).toBe("2024-05-24");
    expect(h.endDate).toBe("2029-05-24");
    expect(h.city).toBe("GLEN COVE, NY 11542");
    expect(h.detail).toMatch(/Article 8 or 9.*NYS Department of Labor/);
    expect(h.category).toBe("debarment");
  });
  it("reads a WCB row (no fiscal-officer column)", () => {
    const [h] = parseEdList(WCB, "WCB");
    expect(h.name).toBe("AMERICAN A-1 AUTO CENTER INC");
    expect(h.date).toBe("2026-03-12");
    expect(h.endDate).toBe("2027-07-09");
    expect(h.detail).toMatch(/141-b/);
  });
});
