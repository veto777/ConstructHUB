import { describe, expect, it } from "vitest";
import { asbestosHit, asbestosRows, parsePumpers, pumperHit, pumperPdfUrl } from "./mt";
import { rowKeys } from "../bulk";

// svc.mt.gov/deq/asbestosaccred/api/query_results (accred=ALL), 2026-10-15: the header and one row. The person's
// street and phone are replaced here (the repo keeps no home address); the code drops them either way.
const ASB_HTML = `<table width="100%" margin="1px auto" cellpadding="25" border="1" style="border-color:Black;border-width:1px;border-style:solid;border-collapse:collapse;"><tr style="color:#FFFFFF;background-color:#004a97;font-size:Small;font-weight:bold;position:sticky;top:0;z-index:1;"><th>Permittee</th><th>Address</th><th>City</th><th>County</th><th>State</th><th>Zip</th><th>Phone</th><th>Expire Date</th><th>Type</th><th>Permit</th></tr><tr style="font-size:Smaller"><td style="font-weight:bold;">ABBOTT, JORDAN</td><td style="font-weight:bold;">[street removed]</td><td style="font-weight:bold;">COLUMBUS</td><td style="font-weight:bold;">STILLWATER</td><td style="font-weight:bold;">MT</td><td style="font-weight:bold;">59019</td><td style="font-weight:bold;">[phone removed]</td><td style="font-weight:bold;">04/16/2027</td><td style="font-weight:bold;">CS</td><td style="font-weight:bold;">MTA-6633-CS</td></tr></table>`;

describe("MT DEQ asbestos accreditations", () => {
  it("reads the table by its header and makes an individual's license with no street or phone", () => {
    const rows = asbestosRows(ASB_HTML);
    expect(rows).toHaveLength(1);
    const h = asbestosHit(rows[0])!;
    expect(h.kind).toBe("license");
    expect(h.person).toBe("JORDAN ABBOTT");
    expect(h.business).toBeNull();
    expect(h.hit).toMatchObject({ status: "Current", licenseNumber: "MTA-6633-CS", licenseType: "Asbestos Contractor/Supervisor", expires: "2027-04-16", city: "COLUMBUS, MT 59019", holder: "individual", matchedOn: "principal" });
    expect(h.hit).not.toHaveProperty("address");
    expect(h.hit).not.toHaveProperty("phone");
    const { keys } = rowKeys(h);
    expect(keys?.phones ?? []).toEqual([]);
    expect(keys?.addresses ?? []).toEqual([]);
  });

  it("an accreditation code the page doesn't list shows as the code", () => {
    const rows = asbestosRows(ASB_HTML.replace(">CS<", ">ZZ<"));
    expect((asbestosHit(rows[0])!.hit as any).licenseType).toBe("code ZZ");
  });

  it("a changed table layout fails loudly", () => {
    expect(() => asbestosRows("<table><tr><th>Name</th></tr></table>")).toThrow(/changed layout/);
  });
});

// deq.mt.gov/twr/Programs/septic-tank, 2026-10-15: the link to the list.
const PUMPER_LINK = `<p><span style="font-size: 12pt;"><strong><a href="https://deq.mt.gov/files/Land/SolidWaste/Documents/pumpers/2026 licensed pumpers - remediated.pdf" rel="noopener" target="_blank">Licensed Pumpers</a></strong></span></p>
<a href="https://deq.mt.gov/files/Land/SolidWaste/Documents/pumpers/CountyGuideforApprovingSeptageLandApplicationSites.pdf" rel="noopener" target="_blank">Download PDF</a>`;

// "2026 licensed pumpers - remediated.pdf" through pdftotext -layout, 2026-10-15 (trimmed; S-1181 is printed twice).
const PUMPERS = `         2026 Licensed Montana Septic Pumpers As of May 20, 2026


            County Business
LIC #                            Company
S-1185      Beaverhead           BADGER PASS SEPTIC LLC
S-1205      Big Horn             BCL ENTERPRISES LLC
         County Business
LIC #                      Company
S-1181   Lewis And Clark   ROCKY MOUNTAIN SEPTIC SERVICES LLC
S-1181   Lewis And Clark   ROCKY MOUNTAIN SEPTIC SERVICES LLC
`;

describe("MT DEQ licensed septic pumpers", () => {
  it("finds the list's PDF from the program page", () => {
    expect(pumperPdfUrl(PUMPER_LINK)).toBe("https://deq.mt.gov/files/Land/SolidWaste/Documents/pumpers/2026%20licensed%20pumpers%20-%20remediated.pdf");
    expect(pumperPdfUrl("<a href=\"x.pdf\">Download PDF</a>")).toBeNull();
  });

  it("reads license, county (two-word counties too) and company; a repeated line counts once", () => {
    const { asOf, rows } = parsePumpers(PUMPERS);
    expect(asOf).toBe("2026 Licensed Montana Septic Pumpers As of May 20, 2026");
    expect(rows).toEqual([
      { license: "S-1185", county: "Beaverhead", company: "BADGER PASS SEPTIC LLC" },
      { license: "S-1205", county: "Big Horn", company: "BCL ENTERPRISES LLC" },
      { license: "S-1181", county: "Lewis And Clark", company: "ROCKY MOUNTAIN SEPTIC SERVICES LLC" },
    ]);
    const h = pumperHit(rows[0], asOf);
    expect(h).toMatchObject({ kind: "license", business: "BADGER PASS SEPTIC LLC", person: null });
    expect(h.hit).toMatchObject({ licenseNumber: "S-1185", licenseType: "Septic Tank Pumper", holder: "business", matchedOn: "business", expires: null });
  });
});
