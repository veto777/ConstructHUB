import { describe, expect, it } from "vitest";
import { parseKyGrid } from "./ky";

// A snippet of the dhbc.ky.gov licensee grid saved 2026-10-15.
const GRID = `<table class="Grid" id="MainContent_grdData"><tr><th scope="col">&nbsp;</th><th scope="col">License Type</th></tr><tr>
<td style="width:150px;"><a href="HBC_Lic_Details.aspx?id=576689">Smith, Louis C </a></td><td>Master Plumber</td><td>L C Smith Plumbing &amp; Heating Co Inc</td><td>M5846</td><td>Active</td><td>3/23/2011</td><td>3/31/2027</td></tr></table>`;

describe("Kentucky HBC grid", () => {
  it("reads a licensee row", () => {
    expect(parseKyGrid(GRID)).toEqual([{ id: "576689", name: "Smith, Louis C", type: "Master Plumber", dba: "L C Smith Plumbing & Heating Co Inc", number: "M5846", status: "Active", issued: "2011-03-23", expires: "2027-03-31" }]);
  });
});
