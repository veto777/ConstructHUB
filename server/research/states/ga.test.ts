import { describe, expect, it } from "vitest";
import { asbestosHit, epdDate, epdHit, pack, parseAsbestosFirms, parseEpdDetails, parseEpdSearch, parseEscRows } from "./ga";
import { privateHit } from "../privacy";

// Saved from enfo.gaepd.org on 2026-10-15: the search for "construction" (first row) and order EPD-WP-9566.
const SEARCH = "ination-count\">\n    Total results: 300\n        <br />\n<tbody>\n                    <tr>\n                        <th scope=\"row\" data-label=\"Facility\">\n                            MRJ Construction, Inc <br />\n                            <em>Pike County</em>\n                        </th>\n                        <td data-label=\"Order\">\n                            EPD-WP-9566<br />\n                            <em>Erosion and Sedimentation Act</em>\n                        </td>\n                        <td data-label=\"Status/Date\">\n                                <strong>Executed&nbsp;On</strong>\n                                <br />\n12&#x2011;Aug&#x2011;2024                        </td>\n                        <td class=\"gaepd-tablecell-nolabel\">\n                            <a href=\"/Details/74923\">View</a>\n                        </td>\n                    </tr>\n</tbody>";
const DETAILS = "<table class=\"gaepd-table-compact gaepd-table-rowheadings gaepd-table-autowidth\" aria-label=\"Enforcement order details\">\n    <tbody>\n    <tr>\n        <th scope=\"row\">Facility</th>\n        <td>MRJ Construction, Inc</td>\n    </tr>\n    <tr>\n        <th scope=\"row\">County</th>\n        <td>Pike County</td>\n    </tr>\n    <tr>\n        <th scope=\"row\">Cause of Order</th>\n        <td>Failed to obtain coverage for the Site under the Permit</td>\n    </tr>\n    <tr>\n        <th scope=\"row\">Requirements of Order</th>\n        <td>Immediately stop work on Site with the exception of installation and maintenance of erosion and sediment controls; submit an ESPCP created by a certified Design Professional for EPD; fully implement and properly maintain all BMPs outlined in ESPCP</td>\n    </tr>\n    <tr>\n        <th scope=\"row\">Settlement Amount</th>\n        <td>$5,000.00</td>\n    </tr>\n    <tr>\n        <th scope=\"row\">Legal Authority</th>\n        <td>Erosion and Sedimentation Act</td>\n    </tr>\n        <tr>\n            <th scope=\"row\">Date Executed</th>\n            <td>12&#x2011;Aug&#x2011;2024</td>\n        </tr>\n        <tr>\n            <th scope=\"row\">Publication Date For Executed Order</th>\n            <td>2&#x2011;Sep&#x2011;2024</td>\n        </tr>\n    <tr>\n        <th scope=\"row\">File Attachments</th>\n        <td>\n                <em>None</em>\n        </td>\n    </tr>\n    </tbody>\n</table>";

describe("Georgia EPD enforcement orders", () => {
  it("reads search rows and order details", () => {
    const { total, rows } = parseEpdSearch(SEARCH);
    expect(total).toBe(300);
    expect(rows[0]).toEqual({ facility: "MRJ Construction, Inc", county: "Pike County", order: "EPD-WP-9566", authority: "Erosion and Sedimentation Act", status: "Executed", date: "2024-08-12", details: "/Details/74923" });
    const hit = epdHit(rows[0], parseEpdDetails(DETAILS), "https://enfo.gaepd.org/Details/74923");
    expect(hit).toMatchObject({ name: "MRJ Construction, Inc", id: "EPD-WP-9566", date: "2024-08-12", amount: 5000, adverse: true, status: "Executed order", city: "Pike County" });
    expect(hit.detail).toContain("Cause: Failed to obtain coverage for the Site under the Permit");
  });

  it("reads EPD dates", () => {
    expect(epdDate("4\u2011Jun\u20112024")).toBe("2024-06-04");
    expect(epdDate("pending")).toBeNull();
  });
});

// Saved from www.gaswcc.org/esc-search.php on 2026-10-15: the header and three rows of the search for John Smith (the
// form matches part of the last name, so "Highsmith" comes back too), and one row of the search for Williams.
const ESC = "<table style=\"font:Arial, Helvetica, sans-serif; font-size: .8em\" cellpadding=\"2px\" cellspacing=\"3px\" border=\"1\">\n<tr>\n<td>Cert. ID</td><td>Trainer ID</td><td>First Name</td><td>MI</td><td>Last Name</td><td>City</td><td>State</td><td align=\"center\">PW<br>Rcvd</td><td>Level AW<br>Expiration</td><td>Level 1A<br>Expiration</td><td>Level 1B<br>Expiration</td><td>Level II<br>Expiration</td><td>Level II<br>Cert</td><td>Trainer 1<br>Expiration</td><td>Trainer 2<br>Expiration</td>\n</tr>\n<tr>\n<td>0000045599</td><td>&nbsp;</td><td>John</td><td>A</td><td>Highsmith</td><td>Waynesboro</td><td>GA</td><td align=\"center\">Y</td><td>&nbsp;</td><td>07-16-2026</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td>\n</tr>\n<tr>\n<td>0000098985</td><td>&nbsp;</td><td>John</td><td>B</td><td>Smith</td><td>Griffin</td><td>GA</td><td align=\"center\">Y</td><td>&nbsp;</td><td>07-14-2028</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td>\n</tr>\n<tr>\n<td>0000015859</td><td>&nbsp;</td><td>John</td><td>F</td><td>Smith</td><td>Marietta</td><td>GA</td><td align=\"center\">Y</td><td>&nbsp;</td><td>10-16-2024</td><td>10-09-2023</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td>\n</tr>\n<tr>\n<td>0000042572</td><td>&nbsp;</td><td>Daryl</td><td>L</td><td>Williams</td><td>McDonough</td><td>GA</td><td align=\"center\">Y</td><td>&nbsp;</td><td>10-16-2028</td><td>05-16-2010</td><td>10-29-2028</td><td>Design Pro</td><td>&nbsp;</td><td>&nbsp;</td>\n</tr>\n</table>";

describe("GSWCC erosion and sedimentation control certifications", () => {
  it("reads each person's levels and expirations, people only, with no street or phone", () => {
    const rows = parseEscRows(ESC);
    expect(rows).toHaveLength(4);
    expect(rows[1]).toMatchObject({
      licenseNumber: "0000098985", principal: "John B Smith", city: "Griffin, GA", expires: "2028-07-14",
      specialty: "Level 1A expires 2028-07-14", holder: "individual", businessName: null, address: null, phone: null, status: null,
    });
    expect(rows[2]).toMatchObject({ specialty: "Level 1A expires 2024-10-16; Level 1B expires 2023-10-09", expires: "2024-10-16" });
    expect(rows[3]).toMatchObject({ specialty: "Level 1A expires 2028-10-16; Level 1B expires 2010-05-16; Level II (Design Pro) expires 2028-10-29", expires: "2028-10-29" });
    expect(rows.every((h) => !h.discipline)).toBe(true);
  });

  it("is a person-only lookup, and searches by certification ID only", async () => {
    const esc = pack.liveLicenses!.find((s) => /Soil and Water/.test(s.source))!;
    expect(esc.kinds).toEqual(["person"]);
    expect(await esc.searchBy!({ type: "phone", value: "404 555 0100" })).toBeNull();
    expect(await esc.searchBy!({ type: "license", value: "CR-12" })).toBeNull();
  });
});

// Saved from EPD's "Georgia Licensed Asbestos Abatement Firms as of August 2026" (pdftotext -layout) on 2026-10-15.
const ASB = "Company Name                         Full Company Address               Firm City           State       Firm Zip     Company Phone           Expiration Date\n\n1Priority Environmental Services     4028 Daley Avenue                  Fort Worth          TX          76180        (817) 595-0790          3/19/2028\n1st Rate Construction Inc.           801 Industrial Boulevard, #8       Ellijay             GA          30540        (706) 889-4370          7/17/2028\nA & M Contracting LLC                1458 Grist Mill Drive              Acworth             GA          30101        (770) 974-8759          6/9/2027\nAbatement Contractors Unlimited,\nLLC                                  4355 Cobb Parkway, Ste J-202       Atlanta             GA          30339        (404) 909-7479          11/28/2026\n\nBest-Tec Asbestos Abatement, Inc. 630 Industrial Avenue, #8             Boynton Beach       FL          33426        (561) 844-6684          7/14/2028\nBLU Asbestos L.L.C.                  510 Glover Abels Rd.               Leesville           SC          29070        (1803) 315-7321         2/12/2028\n                                  1310 Seaboard Industrial Avenue,\nBioRestore Inc.                   Suite H                               Atlanta             GA          30318        (404) 791-1151          10/10/2027\n\f                                       Georgia Licensed Asbestos Abatement Firms as of August 2026\n\nVulcan Industrial Contractors Co., 3755 Corporate Woods Drive, Suite\nLLC                                200                               Vestavia Hills   AL   35242   (770) 606-6856   4/29/2027\nWarrior Restoration &\nEnvironmental, LLC                 3054 Highway 154                  Newnan           GA   30265   (770) 683-5555   4/16/2029\n\n\nWilpro Enterprises, Inc DBA\nServpro of Douglasville/Carrollton,\nPaulding/Polk,\nGordon,Murray,S.Whitfield,Macon\nEast/West,Gwinnett SE/SW            14861 Veterans Memorial Hwy       Villa Rica      GA   30180   (678) 796-5462   8/25/2028\n";

describe("Georgia EPD licensed asbestos abatement firms", () => {
  it("joins wrapped names, splits an address that runs into the name, and skips page headers", () => {
    const firms = parseAsbestosFirms(ASB);
    expect(firms.map((f) => f.name)).toEqual([
      "1Priority Environmental Services", "1st Rate Construction Inc.", "A & M Contracting LLC", "Abatement Contractors Unlimited, LLC",
      "Best-Tec Asbestos Abatement, Inc.", "BLU Asbestos L.L.C.", "BioRestore Inc.", "Vulcan Industrial Contractors Co., LLC",
      "Warrior Restoration & Environmental, LLC",
      "Wilpro Enterprises, Inc DBA Servpro of Douglasville/Carrollton, Paulding/Polk, Gordon,Murray,S.Whitfield,Macon East/West,Gwinnett SE/SW",
    ]);
    expect(firms[3]).toEqual({ name: "Abatement Contractors Unlimited, LLC", city: "Atlanta", state: "GA", zip: "30339", expires: "2026-11-28" });
    expect(firms[7]).toMatchObject({ city: "Vestavia Hills", state: "AL", zip: "35242", expires: "2027-04-29" });
  });

  it("cuts addresses that run into the name or the city (same list)", () => {
    expect(parseAsbestosFirms("                                  5438 56th Commerce Park\nEnvironmental Construction, Inc. Boulevard                             Tampa               FL   33610   (813) 621-5400   11/13/2027\nCapital Restoration LLC            819 Pickens Industrial Drive, Ste 7 Marietta            GA   30062   (770) 973-1666   8/18/2026\nCarolina Asbestos Services         445 Moose Track Trail               Lexington           SC   29073   (803) 518-8214   8/13/2028\nGeorgia Environmental Group, Inc. 425 3rd Street, Ste 300            Macon            GA   31201   (478) 257-6812   8/6/2028\nSoutheast Environmental Solutions 1189 Brown Street                      Covington       GA   30014   (770) 788-1133    12/19/2026\n")).toEqual([
      { name: "Environmental Construction, Inc.", city: "Tampa", state: "FL", zip: "33610", expires: "2027-11-13" },
      { name: "Capital Restoration LLC", city: "Marietta", state: "GA", zip: "30062", expires: "2026-08-18" },
      { name: "Carolina Asbestos Services", city: "Lexington", state: "SC", zip: "29073", expires: "2028-08-13" },
      { name: "Georgia Environmental Group, Inc.", city: "Macon", state: "GA", zip: "31201", expires: "2028-08-06" },
      { name: "Southeast Environmental Solutions", city: "Covington", state: "GA", zip: "30014", expires: "2026-12-19" },
    ]);
  });

  it("leaves the holder unknown (EPD lists 'firms and/or individuals'): city, state and ZIP only", () => {
    const hit = asbestosHit(parseAsbestosFirms(ASB)[2]);
    expect(hit).toMatchObject({ businessName: "A & M Contracting LLC", licenseNumber: null, holder: null, address: null, phone: null, city: "Acworth, GA 30101", expires: "2027-06-09" });
    expect(privateHit(hit)).toMatchObject({ address: null, phone: null });
  });
});
