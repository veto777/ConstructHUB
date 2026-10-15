import { describe, expect, it } from "vitest";
import { parseLaDetail, parseLaResults, parseLaViolations } from "./la";

// Snippets of arlspublic.lslbc.louisiana.gov and lslbc.gov pages saved 2026-10-15.
const QP = `<tbody><tr><td><a onclick="ShowAccountDetails('Mo%2bzfYSMdrXn1CvaUSrFFg%3d%3d',  );" href="#void">Flower, Paul</a></td>
<td><a onclick="ShowAccountDetails('Mo%2bzfYSMdrXn1CvaUSrFFg%3d%3d', );" href="#void"> WOODWARD DESIGN + BUILD, LLC</a></td><td>New Orleans</td><td>LA</td></tr></tbody>`;
const DETAIL = `<fieldset><legend>Contractor Information</legend><div class="display-label">Name</div><div class="display-field">WOODWARD DESIGN + BUILD, LLC</div>
<div class="display-label">Mailing Address</div><div class="display-field">P O Box 13547<br />New Orleans, LA  70185</div>
<div class="display-label">Phone Number</div><div class="display-field">(504) 822-6443</div></fieldset>
<fieldset><legend>Licenses</legend><div id="ContactDiv"><div class="display-label">License</div><div class="display-field">CL.00424</div>
<div class="display-label">Type</div><div class="display-field">Commercial License Certificate</div>
<div class="display-label">Status</div><div class="display-field"><span style='color: Black;'>Active</span></div>
<div class="display-label">Expiration Date</div><div class="display-field">10/27/2027</div></div>
<table id="ClassificationListing"><thead><tr><th>Class</th><th>Qualifying Party</th></tr></thead><tr><td>BUILDING CONSTRUCTION</td><td>Paul H. Flower</td></tr></table>`;
const VIOLATIONS = `<table id="tablepress-1"><tr class="row-2"><td class="column-1">MPL Concrete Finishing LLC</td><td class="column-2">Hammond, Louisiana</td><td class="column-3">6/18/2026</td><td class="column-4">2025-0007-02</td><td class="column-5"> Bidding or conducting work without the proper license</td><td class="column-6">Found guilty, fines and assessed costs.</td></tr></table>`;

describe("Louisiana LSLBC parsers", () => {
  it("keeps the company of a qualifier row", () => {
    expect(parseLaResults(QP)).toEqual([{ key: "Mo%2bzfYSMdrXn1CvaUSrFFg%3d%3d", name: "WOODWARD DESIGN + BUILD, LLC" }]);
  });
  it("reads a detail page", () => {
    expect(parseLaDetail(DETAIL)).toEqual({
      name: "WOODWARD DESIGN + BUILD, LLC", city: "New Orleans, LA", address: "P O Box 13547, New Orleans, LA 70185", phone: "(504) 822-6443",
      licenses: [{ number: "CL.00424", type: "Commercial License Certificate", status: "Active", expires: "2027-10-27" }],
      classes: [{ cls: "BUILDING CONSTRUCTION", qualifier: "Paul H. Flower" }],
    });
  });
  it("reads the violations table", () => {
    expect(parseLaViolations(VIOLATIONS)[0]).toMatchObject({ name: "MPL Concrete Finishing LLC", id: "2025-0007-02", date: "2026-06-18", city: "Hammond, Louisiana", adverse: true });
  });
});
