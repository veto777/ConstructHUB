import { describe, expect, it } from "vitest";
import { itToHit, parseIaElectricalDetail, parseIaElectricalRows } from "./ia";

// Trimmed from the Iowa electrical lookup's license-number search and detail page, 2026-10-15.
const ROWS = `<tr><th class="thBottom">Number</th><th class="thBottom">Display Name (Business or Name)</th><th class="thBottom">License Type</th><th class="thBottom">Address Street</th><th class="thBottom">Address City</th><th class="thBottom">Address State</th><th class="thBottom">Address County</th></tr>
<tr class="trRecord"> <td class="tdBottom"><a id="x:licensefieldId" href="/LicenseSearchDetailPage?licenseId=a0w8y000000ApHzAAK">EL003820EC</a> &nbsp;&nbsp; </td> <td class="tdBottom"><span id="x:1:licensefield">BAKER ELECTRIC INC.</span></td> <td class="tdBottom"><span id="x:2:licensefield">Electrical Contractor</span></td> <td class="tdBottom"><span id="x:3:licensefield">111 JACKSON</span></td> <td class="tdBottom"><span id="x:4:licensefield">DES MOINES</span></td> <td class="tdBottom"><span id="x:5:licensefield">IA</span></td> <td class="tdBottom"><span id="x:6:licensefield">POLK</span></td> </tr>`;
const DETAIL = `<h1>BAKER ELECTRIC OF FT DODGE</h1><h2>Contact Information</h2><label>Contact Full Name</label><p>TODD M BAKER</p><label>Business Phone Number</label><p>(515) 576-5429</p><label>Address City</label><p>STORY CITY</p><h2>Licensee Information</h2><label>License Status</label><p>Active</p><h2 class="heading">Disciplines</h2>`;

describe("Iowa electrical lookup", () => {
  it("reads rows by their headers", () => {
    expect(parseIaElectricalRows(ROWS)).toEqual([{ id: "a0w8y000000ApHzAAK", number: "EL003820EC", name: "BAKER ELECTRIC INC.", street: "111 JACKSON", city: "DES MOINES", state: "IA", expires: null, type: "Electrical Contractor", status: null }]);
  });
  it("reads the contact, phone and status of a detail page", () => {
    expect(parseIaElectricalDetail(DETAIL)).toEqual({ contact: "TODD M BAKER", phone: "(515) 576-5429", status: "Active" });
  });
});

describe("Iowa DIAL ImageTrend lookup", () => {
  const row = { classification: "Fire Protection", address_line_1: "P.O. Box 998", city: "Cedar Falls", postal_code: "50613", abbrev: "IA", primary_license_expiration_date: "2027-03-31T00:00:00", primary_license_number: "FES-2069", phone: "800-232-7721", primary_license_level: "Automatic sprinkler system installation (layout)", primary_license_status: "Current", service_name: "Blackhawk Automatic Sprinklers, Inc. - Fire Protection" };
  it("keeps fire protection and alarm contractors, strips the classification suffix", () => {
    const h = itToHit(row, "business")!;
    expect(h.businessName).toBe("Blackhawk Automatic Sprinklers, Inc.");
    expect(h.licenseType).toBe("Fire protection system contractor");
    expect(h.expires).toBe("2027-03-31");
    expect(h.phone).toBe("800-232-7721");
  });
  it("drops the other classifications", () => {
    expect(itToHit({ ...row, classification: "Tanks (registration)" }, "business")).toBeNull();
  });
});
