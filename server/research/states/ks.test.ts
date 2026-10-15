import { describe, expect, it } from "vitest";
import { parseKsbtpResults } from "./ks";

// Trimmed from the KSBTP facility search results, 2026-10-15.
const HTML = `<table cellspacing="0" rules="all" border="1" id="datagrid_results" style="border-collapse:collapse;"><caption>Results</caption><tr><th>Name</th></tr><tr>
<td><table role="presentation"><tr><td rowspan="0" colspan="1"><a id="datagrid_results__ctl3_name" href="Details.aspx?result=aacf79d4" target="_blank">BURNS &amp; MCDONNELL ENGINEERING COMPANY INC</a></td></tr><tr><td><span><table width="100%"><tr><td align='center'></td></tr></span><span></table></span></td></tr></table>
</td><td><span>E-65</span></td><td><span>Professional Engineer Facility</span></td><td><span>Active</span></td><td><span>Kansas City MO  64114</span></td><td><span>12/31/2026</span></td></tr></table>`;

describe("Kansas KSBTP results", () => {
  it("reads name, number, type, status, location and expiration", () => {
    expect(parseKsbtpResults(HTML)).toEqual([{ name: "BURNS & MCDONNELL ENGINEERING COMPANY INC", number: "E-65", type: "Professional Engineer Facility", status: "Active", location: "Kansas City MO 64114", expires: "2026-12-31" }]);
  });
});
