import { describe, expect, it } from "vitest";
import { bblActivity, bblHit, longDate, ocpHit, parseOcpExcluded } from "./dc";

// Saved 2026-10-15 from ocp.dc.gov/page/excluded-parties-list: the header and first row of each of its four tables.
const OCP = "<p>EXCLUDED PARTIES LIST BY INDIVIDUAL</p><table><tbody><tr><th style=\"border-color:#898989;border-width:1pt;\"><p style=\"margin:0in;padding:0.75pt;\"><span style=\"font-family:Calibri, sans-serif;font-size:12pt;\"><strong>Name of Individual</strong></span></p></th><th style=\"border-bottom:1pt solid #898989;border-left-style:none;border-right:1pt solid #898989;border-top:1pt solid #898989;\"><p style=\"margin:0in;padding:0.75pt;\"><span style=\"font-family:Calibri, sans-serif;font-size:12pt;\"><strong>Principal Address</strong></span></p></th><th style=\"border-bottom:1pt solid #898989;border-left-style:none;border-right:1pt solid #898989;border-top:1pt solid #898989;\"><p style=\"margin:0in;padding:0.75pt;\"><span style=\"font-family:Calibri, sans-serif;font-size:12pt;\"><strong>Action Date</strong></span></p></th><th style=\"border-bottom:1pt solid #898989;border-left-style:none;border-right:1pt solid #898989;border-top:1pt solid #898989;\"><p style=\"margin:0in;padding:0.75pt;\"><span style=\"font-family:Calibri, sans-serif;font-size:12pt;\"><strong>Expiration Date</strong></span></p></th><th style=\"border-bottom:1pt solid #898989;border-left-style:none;border-right:1pt solid #898989;border-top:1pt solid #898989;\"><p style=\"margin:0in;padding:0.75pt;\"><span style=\"font-family:Calibri, sans-serif;font-size:12pt;\"><strong>Agency Instituting the Action</strong></span></p></th><th style=\"border-bottom:1pt solid #898989;border-left-style:none;border-right:1pt solid #898989;border-top:1pt solid #898989;\"><p style=\"margin:0in;padding:0.75pt;\"><span style=\"font-family:Calibri, sans-serif;font-size:12pt;\"><strong>Reason for the Action</strong></span></p></th></tr><tr><td>Robert Terrell</td><td>2585 Rhode Island Ave., NE, Washington, DC 20018</td><td>May 8, 2026</td><td>May 7, 2031</td><td>OCP</td><td>Indictment under 18 U.S.C. \u00a7 1343 and 18 U.S.C. \u00a7 1957</td></tr></tbody></table><p>EXCLUDED PARTIES LIST BY COMPANY</p><table><tbody><tr><th style=\"border-color:#898989;border-width:1pt;\"><p style=\"margin:0in;padding:0.75pt;\"><span style=\"font-family:Calibri, sans-serif;font-size:12pt;\"><strong>Name of Company</strong></span></p></th><th style=\"border-bottom:1pt solid #898989;border-left-style:none;border-right:1pt solid #898989;border-top:1pt solid #898989;\"><p style=\"margin:0in;padding:0.75pt;\"><span style=\"font-family:Calibri, sans-serif;font-size:12pt;\"><strong>Principal Address</strong></span></p></th><th style=\"border-bottom:1pt solid #898989;border-left-style:none;border-right:1pt solid #898989;border-top:1pt solid #898989;\"><p style=\"margin:0in;padding:0.75pt;\"><span style=\"font-family:Calibri, sans-serif;font-size:12pt;\"><strong>Action Date</strong></span></p></th><th style=\"border-bottom:1pt solid #898989;border-left-style:none;border-right:1pt solid #898989;border-top:1pt solid #898989;\"><p style=\"margin:0in;padding:0.75pt;\"><span style=\"font-family:Calibri, sans-serif;font-size:12pt;\"><strong>Expiration Date</strong></span></p></th><th style=\"border-bottom:1pt solid #898989;border-left-style:none;border-right:1pt solid #898989;border-top:1pt solid #898989;\"><p style=\"margin:0in;padding:0.75pt;\"><span style=\"font-family:Calibri, sans-serif;font-size:12pt;\"><strong>Agency Instituting the Action</strong></span></p></th><th style=\"border-bottom:1pt solid #898989;border-left-style:none;border-right:1pt solid #898989;border-top:1pt solid #898989;\"><p style=\"margin:0in;padding:0.75pt;\"><span style=\"font-family:Calibri, sans-serif;font-size:12pt;\"><strong>Reason for the Action</strong></span></p></th></tr><tr><th style=\"border-color:#898989;border-width:1pt;\">District Logistics, LLC</th><th style=\"border-bottom:1pt solid #898989;border-left-style:none;border-right:1pt solid #898989;border-top:1pt solid #898989;\">2585 Rhode Island Ave., NE, Washington, DC 20018</th><th style=\"border-bottom:1pt solid #898989;border-left-style:none;border-right:1pt solid #898989;border-top:1pt solid #898989;\">May 8, 2026</th><th style=\"border-bottom:1pt solid #898989;border-left-style:none;border-right:1pt solid #898989;border-top:1pt solid #898989;\">May 7, 2031</th><th style=\"border-bottom:1pt solid #898989;border-left-style:none;border-right:1pt solid #898989;border-top:1pt solid #898989;\">OCP</th><th style=\"border-bottom:1pt solid #898989;border-left-style:none;border-right:1pt solid #898989;border-top:1pt solid #898989;\">Indictment under 18 U.S.C. \u00a7 1343 and 18 U.S.C. \u00a7 1957</th></tr></tbody></table><p>PAST EXCLUDED PARTIES LIST</p><p>PAST EXCLUDED PARTIES LIST BY INDIVIDUAL</p><table><tbody><tr><th style=\"border-color:#898989;border-width:1pt;\"><p style=\"margin:0in;padding:0.75pt;\"><span style=\"font-family:Calibri, sans-serif;font-size:12pt;\"><strong>Name of Individual</strong></span></p></th><th style=\"border-bottom:1pt solid #898989;border-left-style:none;border-right:1pt solid #898989;border-top:1pt solid #898989;\"><p style=\"margin:0in;padding:0.75pt;\"><span style=\"font-family:Calibri, sans-serif;font-size:12pt;\"><strong>Principal Address</strong></span></p></th><th style=\"border-bottom:1pt solid #898989;border-left-style:none;border-right:1pt solid #898989;border-top:1pt solid #898989;\"><p style=\"margin:0in;padding:0.75pt;\"><span style=\"font-family:Calibri, sans-serif;font-size:12pt;\"><strong>Action Date</strong></span></p></th><th style=\"border-bottom:1pt solid #898989;border-left-style:none;border-right:1pt solid #898989;border-top:1pt solid #898989;\"><p style=\"margin:0in;padding:0.75pt;\"><span style=\"font-family:Calibri, sans-serif;font-size:12pt;\"><strong>Termination Date\ufeff\ufeff</strong></span></p></th></tr><tr><td>Acar, Yusuf</td><td>4550 Broad Branch Road, NW Washington, DC 20008-1005</td><td>May 28, 2009 and June 14, 2010</td><td>May 27, 2012</td></tr></tbody></table><p>PAST EXCLUDED PARTIES LIST BY COMPANY</p><table><tbody><tr><th style=\"border-color:#898989;border-width:1pt;\"><p style=\"margin:0in;padding:0.75pt;\"><span style=\"font-family:Calibri, sans-serif;font-size:12pt;\"><strong>Name of Company</strong></span></p></th><th style=\"border-bottom:1pt solid #898989;border-left-style:none;border-right:1pt solid #898989;border-top:1pt solid #898989;\"><p style=\"margin:0in;padding:0.75pt;\"><span style=\"font-family:Calibri, sans-serif;font-size:12pt;\"><strong>Principal Address</strong></span></p></th><th style=\"border-bottom:1pt solid #898989;border-left-style:none;border-right:1pt solid #898989;border-top:1pt solid #898989;\"><p style=\"margin:0in;padding:0.75pt;\"><span style=\"font-family:Calibri, sans-serif;font-size:12pt;\"><strong>Principals</strong></span></p></th><th style=\"border-bottom:1pt solid #898989;border-left-style:none;border-right:1pt solid #898989;border-top:1pt solid #898989;\"><p style=\"margin:0in;padding:0.75pt;\"><span style=\"font-family:Calibri, sans-serif;font-size:12pt;\"><strong>Action Date</strong></span></p></th><th style=\"border-bottom:1pt solid #898989;border-left-style:none;border-right:1pt solid #898989;border-top:1pt solid #898989;\"><p style=\"margin:0in;padding:0.75pt;\"><span style=\"font-family:Calibri, sans-serif;font-size:12pt;\"><strong>Termination Date\ufeff\ufeff</strong></span></p></th></tr><tr><td>52nd Street Development, Inc.&nbsp;</td><td>6500 Chillum Place NW, Washington, DC 20012</td><td>Mohammad Sidker</td><td>August 4, 2021</td><td>August 4, 2026</td></tr></tbody></table>";

describe("DC OCP excluded parties", () => {
  it("reads the company tables only, current and past", () => {
    const rows = parseOcpExcluded(OCP);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ past: false, name: "District Logistics, LLC", from: "2026-05-08", to: "2031-05-07", agency: "OCP" });
    expect(rows[0].address).toBe("2585 Rhode Island Ave., NE, Washington, DC 20018");
    expect(rows[1]).toMatchObject({ past: true, name: "52nd Street Development, Inc.", from: "2021-08-04", to: "2026-08-04" });
    expect(longDate("May 28, 2009 and June 14, 2010")).toBe("2009-05-28");
  });
  it("tells past tables by their Termination Date column too, and fails on a changed layout (audit 2026-10-15)", () => {
    const reworded = OCP.replace(/PAST EXCLUDED PARTIES LIST/g, "FORMER LISTINGS");
    expect(parseOcpExcluded(reworded)[1]).toMatchObject({ past: true, name: "52nd Street Development, Inc." });
    expect(() => parseOcpExcluded("<table><tr><th>Name of Individual</th></tr></table>")).toThrow(/layout changed/);
  });
  it("an exclusion that is past or over is not adverse", () => {
    const [current, past] = parseOcpExcluded(OCP);
    expect(ocpHit(current, "2026-10-15")).toMatchObject({ adverse: true, status: "Excluded from District contracts" });
    expect(ocpHit(past, "2026-10-15")).toMatchObject({ adverse: false, status: "Past exclusion (no longer excluded)" });
    expect(ocpHit(current, "2031-06-01")).toMatchObject({ adverse: false, status: "Exclusion period over (2031-05-07)" });
  });
});

describe("DC basic business licenses", () => {
  it("maps a feature with its owner, addresses and license keys", () => {
    const h = bblHit({ CUSTOMERNUMBER: "410524000728", LICENSESTATUS: "Active", LICENSEENDDATE: 1840766400000, BUSINESSACTIVITY: "General Contractor/Construction Manager (A, B, C,",
      PREMISEADDRESS: "810 NEW JERSEY AVE NW, WASHINGTON, DC, 20001, USA", BILLINGADDRESS: "5710 Furnace Ave, Suite H, Elkridge, MD, 21075, USA",
      ENTITYNAME: "Hamel Builders of Washington, LLC", ENTITYTRADENAME: null, ENTITYTYPE: "Domestic Limited Liability Company",
      BUSINESSOWNERFIRSTNAME: "Beth", BUSINESSOWNERMIDDLENAME: null, BUSINESSOWNERLASTNAME: "Dodson", AGENTFIRSTNAME: null, AGENTMIDDLENAME: null, AGENTLASTNAME: null, AGENTENTITY: null })!;
    expect(h.kind).toBe("license");
    if (h.kind !== "license") return;
    expect(h.hit).toMatchObject({ businessName: "Hamel Builders of Washington, LLC", licenseNumber: "410524000728", status: "Active", principal: "Beth Dodson",
      address: "810 NEW JERSEY AVE NW, WASHINGTON, DC 20001", people: [{ name: "Beth Dodson", role: "Business owner" }] });
    expect(h.keys?.addresses).toEqual(["810 NEW JERSEY AVE NW, WASHINGTON, DC 20001", "5710 Furnace Ave, Suite H, Elkridge, MD 21075"]);
    // The published value is cut off mid-list: shown as it is, never completed (audit 2026-10-15).
    expect(h.hit.licenseType).toBe("General Contractor/Construction Manager (A, B, C, (list cut off in the source)");
    expect(bblActivity("Home Improvement Contractor")).toBe("Home Improvement Contractor");
  });
  it("a sole proprietor's own name is the person, not a business name (live rows, 2026-10-15)", () => {
    const base = { LICENSESTATUS: "Cancelled", BUSINESSACTIVITY: "Home Improvement Contractor", ENTITYTYPE: "Sole Proprietorship", PREMISEADDRESS: "1219 KENYON ST NW, WASHINGTON, DC, 20010, USA" };
    const a = bblHit({ ...base, CUSTOMERNUMBER: "39900493", ENTITYNAME: "JAMES A BENJAMIN", ENTITYTRADENAME: "H.T.W.T.", BUSINESSOWNERFIRSTNAME: "JAMES", BUSINESSOWNERLASTNAME: "BENJAMIN" })!;
    expect(a.hit).toMatchObject({ businessName: "H.T.W.T.", principal: "JAMES BENJAMIN" });
    const b = bblHit({ ...base, CUSTOMERNUMBER: "39900493", ENTITYNAME: "JAMES A BENJAMIN", ENTITYTRADENAME: null, BUSINESSOWNERFIRSTNAME: "JAMES", BUSINESSOWNERLASTNAME: "BENJAMIN" })!;
    expect(b.hit.businessName).toBeNull();
    expect(b.business).toBeNull();
    const c = bblHit({ ...base, CUSTOMERNUMBER: "50003289", ENTITYNAME: "IMAGE PAINTING & DRYWALL", ENTITYTRADENAME: "IMAGE PAINTING & DRYWALL", BUSINESSOWNERFIRSTNAME: "ANDREW", BUSINESSOWNERLASTNAME: "MCBRIDE" })!;
    expect(c.hit.businessName).toBe("IMAGE PAINTING & DRYWALL");
  });
});

describe("DC round-2 audit (2026-10-16)", () => {
  it("the holder comes from ENTITYTYPE and the endorsement, never from a trade name (decision 2)", async () => {
    const { bblHolder } = await import("./dc");
    expect(bblHolder("Domestic Limited Liability Company", "General Contractor/Construction Manager (A, B, C,")).toBe("business");
    expect(bblHolder("Sole Proprietorship", "Home Improvement Contractor")).toBe("individual");
    expect(bblHolder("Foreign Sole Proprietor", "Home Improvement Contractor")).toBe("individual");
    expect(bblHolder("Corporation (For Profit)", "Home Improvement Salesperson")).toBe("individual");
    expect(bblHolder("Trade Name", "Home Improvement Contractor")).toBeNull();
    expect(bblHolder(null, "Home Improvement Contractor")).toBeNull();
    const h = bblHit({ CUSTOMERNUMBER: "39900493", LICENSESTATUS: "Active", BUSINESSACTIVITY: "Home Improvement Contractor", ENTITYTYPE: "Sole Proprietorship",
      PREMISEADDRESS: "1219 KENYON ST NW, WASHINGTON, DC, 20010, USA", ENTITYNAME: "JAMES A BENJAMIN", ENTITYTRADENAME: "H.T.W.T." })!;
    expect(h.hit).toMatchObject({ businessName: "H.T.W.T.", holder: "individual" });
  });
});
