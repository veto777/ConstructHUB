import { describe, expect, it } from "vitest";
import { parseCbrDetails, parseCbrRows, parseDoplEntity, parseDoplList } from "./ut";

// Snippets trimmed from live DOPL pages, 2026-10-15.
const CBR_ROWS = `<table id="tblEntities"><tbody><tr><td class="text-left">Dennis Sheridan Johnson<td class="text-left d-none d-sm-table-cell"></td><td class="text-left d-none d-sm-table-cell"><a href="mailto:"></a></td><td class="text-left d-none d-sm-table-cell"><td><button type="button" class="button" data-eid="29700" data-pid="4001" data-bs-toggle="modal">Details</button></td></td></tr><tr><td class="text-left">AMCO American Roofing Co.<br>DBA:  &nbsp;WESLEY GREEN ROOFING AMCO ET AL &nbsp;| &nbsp;AMERICAN RAIN GUTTERS<td class="text-left d-none d-sm-table-cell"><a href="tel:8012691276">(801) 269-1276</a></td><td class="text-left d-none d-sm-table-cell"><a href="mailto:x@example.com">x@example.com</a></td><td class="text-left d-none d-sm-table-cell">Salt Lake City UT<td><button data-eid="5000" data-pid="4000">Details</button></td></td></tr></tbody></table>`;

const CBR_DETAILS = `<div class="modal-body"><p>Profession: <i>Contractor</i></br>License Type: <i>Contractor</i></br>License Number: <i>11848910-5501</i></br>Expiration Date: <i>11/30/2027</i></br></p><b>Contact Information</b></br>Phone: <i>(801) 781-9600</i></br>Address: <i>Ogden UT  84401</i></br></br><b>Qualifier Information</b><p>Name: <i>Wilfrido Vazquez</i></br>License Type: <i>S280 - Roofing Qualifier</i></p></div>`;

const ENTITY = `<div id="areaResults" class="col-sm-12 mb-5">
<h2 class="mb-0"><b>Barrios Construction, LLC</b></h2><hr><div id="lic1" class="h3 bg-silver tog-col"><span id="lic1Icon" class="material-symbols md-30">expand_more</span> <b>12485881-5501</b> &#8212; Contractor &nbsp; <span class="text-danger font-weight-bold"><b>(Revoked)</b></span></div><div id="lic1Data" class="collapse show"><h4>ACTIONS</h4><div id="lic1Actions" class="ml-5"><div id="lic1act1" class="tog-col"><span id="lic1act1Icon" class="material-symbols md-26">expand_more</span> <b>Case 2022-369</b></div><div id="lic1act1Data" class="collapse show ml-3"><ul class="ml-3"><li><a href="2022-369_AA_2023-01-04.pdf" target="_blank"><img src="/assets/img/acrologo.gif" alt=""> Agency Action</a> &#8212; 1/4/2023</li><li><a href="2022-369_FF_2023-02-22.pdf" target="_blank"><img src="/assets/img/acrologo.gif" alt=""> Finding of Fact</a> &#8212; 2/22/2023</li></ul></div></div><h4>CITATIONS</h4><div id="lic1Citations" class="ml-5"><div id="lic1cit1" class="tog-col"><span id="lic1cit1Icon" class="material-symbols md-26">expand_more</span> <b>Citation 102633</b></div><div id="lic1cit1Data" class="collapse show ml-3"><ul class="ml-3 list-unstyled"><li>Violation: Insurance Cancellation</li><li>Issued: 2023-05-03</li><li>Status: Collections</li><li>Amount: $1,000</li></li></ul></div></div></div></div>`;

const LIST = `<table id="tblEntities"><tbody><tr><td><form action="/dopl-disciplinary-actions/index.php" method="POST"><input type="hidden" name="f" value="V"><input type="hidden" name="v" value="11707096"><button type="submit">View</button></form></td><td class="text-left"><b>Rudy's Construction LLC</b></td><td class="text-left"><ul><li>Contractor &#8211; <b>Active</b></li></ul></tr></tbody></table>`;

describe("Utah DOPL", () => {
  it("reads registry rows and details", () => {
    const rows = parseCbrRows(CBR_ROWS);
    expect(rows).toEqual([
      { name: "Dennis Sheridan Johnson", dba: null, city: null, phone: null, eid: "29700", pid: "4001" },
      { name: "AMCO American Roofing Co.", dba: "WESLEY GREEN ROOFING AMCO ET AL / AMERICAN RAIN GUTTERS", city: "Salt Lake City UT", phone: "(801) 269-1276", eid: "5000", pid: "4000" },
    ]);
    expect(parseCbrDetails(CBR_DETAILS)).toEqual({ profession: "Contractor", type: "Contractor", number: "11848910-5501", expires: "2027-11-30", qualifier: "Wilfrido Vazquez", qualifierType: "S280 - Roofing Qualifier", phone: "(801) 781-9600", address: "Ogden UT 84401" });
  });
  it("reads cases with their documents and citations with their amounts", () => {
    const hits = parseDoplEntity(ENTITY);
    expect(hits).toHaveLength(2);
    expect(hits[0]).toMatchObject({
      name: "Barrios Construction, LLC", id: "Case 2022-369", date: "2023-01-04", endDate: "2023-02-22",
      sourceUrl: "https://services.commerce.utah.gov/dopl-disciplinary-actions/2022-369_AA_2023-01-04.pdf",
      detail: "License 12485881-5501 (Contractor, Revoked)", licenseNumber: "12485881-5501",
    });
    expect(hits[1]).toMatchObject({ id: "Citation 102633", date: "2023-05-03", status: "Citation: Collections", amount: 1000, adverse: true });
    expect(hits[1].detail).toContain("Violation: Insurance Cancellation");
  });
  it("reads the entity list", () => {
    expect(parseDoplList(LIST)).toEqual([{ id: "11707096", name: "Rudy's Construction LLC" }]);
  });
});
