import { describe, expect, it } from "vitest";
import { expandEndorsements, parseOdolList, roofingHit, unwrapAscii85 } from "./ok";
import { deflateSync } from "node:zlib";

// One record of verify.cib.hbesystems.com/api/roofing/search, saved 2026-10-15 (insurance fields left out).
const REG = {
  id: 47591, tradeName: "Roofing Contractor Registration", statusName: "In Good Standing", licenseNumber: 80000002,
  renewalDate: "2027-12-01T05:59:59.000Z", commercialEndorsement: true, company_name: "S & CM, LLC", company_trade: "MCROOF.US",
  company_telephone: "405-877-7663", company_address1: "722 ENTERPRISE DR #150", company_address2: "", company_city: "EDMOND",
  company_state: "OK", company_zipcode: "73013", person_firstName: "SCOTT", person_lastName: "MCCOLLUM,SR", person_middleName: "A",
};

describe("Oklahoma CIB roofing registrations", () => {
  it("maps a registration", () => {
    const h = roofingHit(REG)!;
    expect(h.hit).toMatchObject({ businessName: "S & CM, LLC DBA MCROOF.US", licenseNumber: "80000002", status: "In Good Standing", expires: "2027-12-01", specialty: "Commercial endorsement", principal: "SCOTT A MCCOLLUM,SR", address: "722 ENTERPRISE DR #150, EDMOND, OK 73013" });
    expect(h.keys).toEqual({ licenses: ["80000002"], phones: ["405-877-7663"], addresses: ["722 ENTERPRISE DR #150, EDMOND, OK 73013"] });
  });
  it("takes the holder from CIB's own company_type, not from the company name (round 2, decisions 2 and 3)", () => {
    expect(roofingHit({ ...REG, company_type: "LLC" })!.hit.holder).toBe("business");
    expect(roofingHit({ ...REG, company_type: "Sole Proprietorship" })!.hit.holder).toBe("individual");
    expect(roofingHit({ ...REG, company_type: "" })!.hit.holder).toBeNull();
  });
});

// Excerpts of the ODOL lists of 2026-10-08 (oklahoma.gov/labor, Active_Alarm_Licenses_Companies_100826.pdf and
// _Individuals_100826.pdf): `pdftotext -layout` output, and the JS reader's layout (./lib/a3-pdf.ts jsLayoutText).
const COMPANIES_PDFTOTEXT = " Active Alarm Licenses - Companies\n Oklahoma Department of Labor, Licensing Division\n List current as of October 8, 2026 | 749 active company licenses\n CCTV = Closed Circuit Television. Companies may hold licenses in more than one industry.\n\n\n License #        Company                                Industries Served                                 Expiration Date\n\n AC441167         1Vision USA Security LLC               Burglar Alarm; Residential Fire Alarm             08-31-2027\n\n AC388            22nd Century Environments              Access Control; CCTV; Commercial Fire Alarm;      05-31-2027\n                                                         Locksmith; Nurse Call; Residential Fire Burglar\n                                                         Alarm\n AC2              Alert 360                           Access Control; Burglar Alarm; CCTV;                 02-28-2027\n AC441221         YEPCOM A/V & Home Automation,    Burglar Alarm; CCTV; Monitoring Facility;          06-30-2027\n                  LLC                              Residential Fire Alarm\n\n\n\nOklahoma Department of Labor, Licensing Division                                                                        Page 1\n\f License #        Company                               Industries Served                                Expiration Date\n\n AC743            Access Security Systems LLP           Access Control; CCTV; Commercial Fire Burglar    11-30-2026\n AC1438           Clark Kristi Enterprises Inc dba Pop A   Locksmith                                          09-30-2027\n                  Lock Locksmith\n";
const INDIVIDUALS_PDFTOTEXT = "   Active Alarm Licenses - Individuals\n   Oklahoma Department of Labor, Licensing Division\n   List current as of October 8, 2026 | 4,772 active licenses\n\n\n\n             License Types                                         Suffixes\n             AC = Electronic Access Control                        -T = Technician\n             BA = Burglar Alarm                                    -S = Salesperson\n             CCTV = Closed Circuit Television                      -M = Manager\n             CCTV RSA = CCTV Residential Stand Alone               -I = Inspector\n             CFA = Commercial Fire Alarm                           TRAINEE = Trainee\n             CFB = Commercial Fire/Burglar (combined)              90 Day TRAINEE = 90-Day Temporary Trainee\n             FS = Fire Sprinkler                                   DOD = Department of Defense\n             LS = Locksmith\n             MF = Monitoring Facility\n             NC = Nurse Call\n             RFA = Residential Fire Alarm\n             RFB = Residential Fire/Burglar (combined)\n\n\n\n\n   License #       Licensee                         Endorsements                                      Expiration Date\n\n   A3606           Aadahl, Arvid L                  FS-M                                              08/31/2027\n\n   A475974         Aadahl, Avrie                    FS-TRAINEE                                        09/30/2027\n\n   A475160         Abbott, Colton Trayce            AC-T; CCTV-T; CFA-T                               05/31/2027\n\n   A475945         Allen, Jacob                     90 Day TRAINEE                           12/21/2026\n   A475173         Burgess, Charles Christopher     CCTV-RSA                          07/31/2027\n";
const COMPANIES_JS = "              License #     Company                            Industries Served                            Expiration Date\n              AC743          Access Security Systems LLP           Access Control; CCTV; Commercial Fire Burglar  11-30-2026\n                                                                   Alarm\n              AC441114       Accolade Fence LLC d/b/a Accolade     Access Control                                 10-31-2026\n                             Access Control\n              AC440701       Accurate Controls Inc                 Access Control; CCTV                           07-31-2027\n              AC440575       Accurate Fire Equipment Co            Access Control; Burglar Alarm; CCTV;           11-30-2026\n                                                                   Commercial Fire Alarm; Fire Sprinkler;\n                                                                   Locksmith; Nurse Call\n              AC1210         Ace Unlocking Service                 Locksmith                                      02-28-2027\n              AC440938       Acme Key Co. LLC                      Locksmith                                      10-31-2026\n              AC1735         Acoustic Designs Inc                  Access Control; CCTV; Residential Fire Burglar 02-28-2027\n                                                                   Alarm\n              AC1069         Acquire CCTV Inc                      Access Control; CCTV                           10-31-2026\n              AC440587       Action Fire Protection LLC            Access Control; Burglar Alarm; CCTV;           01-31-2027\n                                                                   Commercial Fire Alarm; Fire Sprinkler;\n                                                                   Locksmith; Monitoring Facility; Nurse Call\n              AC440793       Acuitycam Survelliance Services       CCTV                                           02-28-2027\n              AC1341         Admiral Inc d/b/a Admiral Safe Co     Access Control; Locksmith                      06-30-2027\n              AC1995         ADT LLC d/b/a ADT Security Services   Access Control; CCTV; Commercial Fire Burglar  06-30-2027\n                                                                   Alarm; Locksmith; Monitoring Facility; Nurse\n                                                                   Call; Residential Fire Burglar Alarm\n              AC1438         Clark Kristi Enterprises Inc dba Pop A Locksmith                                     09-30-2027\n                             Lock Locksmith\n              AC440688       Strategic Initial Outfitting TransitionAccess Control; CCTV; Commercial Fire Alarm;  05-31-2027\n                             Solutions LLC                         Commercial Fire Burglar Alarm; Locksmith;\n                                                                   Monitoring Facility; Nurse Call; Residential Fire\n                                                                   Burglar Alarm\n";

describe("ODOL alarm, locksmith and fire sprinkler lists", () => {
  it("reads company rows, wrapped names and industries, one-digit license numbers and the list's own count", () => {
    const { rows, stated } = parseOdolList(COMPANIES_PDFTOTEXT);
    expect(stated).toBe(749);
    const by = Object.fromEntries(rows.map((r) => [r.license, r]));
    expect(by.AC441167).toEqual({ license: "AC441167", name: "1Vision USA Security LLC", served: "Burglar Alarm; Residential Fire Alarm", expires: "2027-08-31" });
    expect(by.AC388.served).toBe("Access Control; CCTV; Commercial Fire Alarm; Locksmith; Nurse Call; Residential Fire Burglar Alarm");
    expect(by.AC2.name).toBe("Alert 360");
    expect(by.AC441221).toMatchObject({ name: "YEPCOM A/V & Home Automation, LLC", served: "Burglar Alarm; CCTV; Monitoring Facility; Residential Fire Alarm", expires: "2027-06-30" });
    expect(by.AC1438).toMatchObject({ name: "Clark Kristi Enterprises Inc dba Pop A Lock Locksmith", served: "Locksmith" });
    // Page footers and repeated headers are not rows.
    expect(rows.map((r) => r.license)).toEqual(["AC441167", "AC388", "AC2", "AC441221", "AC743", "AC1438"]);
  });

  it("reads individuals and expands their endorsement codes with the legend printed in the same PDF", () => {
    const { rows, stated, legend } = parseOdolList(INDIVIDUALS_PDFTOTEXT);
    expect(stated).toBe(4772);
    const by = Object.fromEntries(rows.map((r) => [r.license, r]));
    expect(by.A3606).toEqual({ license: "A3606", name: "Aadahl, Arvid L", served: "FS-M", expires: "2027-08-31" });
    expect(expandEndorsements(by.A3606.served, legend)).toBe("Fire Sprinkler (Manager)");
    expect(expandEndorsements(by.A475160.served, legend)).toBe("Electronic Access Control (Technician); Closed Circuit Television (Technician); Commercial Fire Alarm (Technician)");
    expect(expandEndorsements(by.A475945.served, legend)).toBe("90-Day Temporary Trainee");
    expect(expandEndorsements(by.A475173.served, legend)).toBe("CCTV Residential Stand Alone");
    expect(expandEndorsements("FS-TRAINEE", legend)).toBe("Fire Sprinkler (Trainee)");
    // Round 2, decision 13: a code the legend doesn't print is "code X", never shown bare.
    expect(expandEndorsements("XYZ-T", legend)).toBe("code XYZ-T");
    expect(expandEndorsements("FS-Q", legend)).toBe("Fire Sprinkler (code Q)");
    expect(expandEndorsements("ZZ", legend)).toBe("code ZZ");
  });

  it("reads the JS reader's layout the same way, including names that run into the industries column", () => {
    const { rows } = parseOdolList(COMPANIES_JS);
    const by = Object.fromEntries(rows.map((r) => [r.license, r]));
    expect(by.AC441114).toMatchObject({ name: "Accolade Fence LLC d/b/a Accolade Access Control", served: "Access Control" });
    expect(by.AC1438).toMatchObject({ name: "Clark Kristi Enterprises Inc dba Pop A Lock Locksmith", served: "Locksmith", expires: "2027-09-30" });
    expect(by.AC440688).toMatchObject({
      name: "Strategic Initial Outfitting Transition Solutions LLC",
      served: "Access Control; CCTV; Commercial Fire Alarm; Commercial Fire Burglar Alarm; Locksmith; Monitoring Facility; Nurse Call; Residential Fire Burglar Alarm",
    });
  });

  it("rewrites ASCII85-over-Flate streams as Flate streams for the JS reader", () => {
    const content = Buffer.from("BT /F1 10 Tf 72 700 Td (AC1) Tj ET");
    const z = deflateSync(content);
    let a85 = "";
    for (let i = 0; i < z.length; i += 4) {
      const chunk = [z[i], z[i + 1] ?? 0, z[i + 2] ?? 0, z[i + 3] ?? 0];
      let v = ((chunk[0] << 24) >>> 0) + (chunk[1] << 16) + (chunk[2] << 8) + chunk[3];
      const digits: string[] = [];
      for (let k = 0; k < 5; k++) { digits.unshift(String.fromCharCode((v % 85) + 33)); v = Math.floor(v / 85); }
      a85 += digits.slice(0, Math.min(5, z.length - i + 1)).join("");
    }
    const pdf = Buffer.from(`%PDF-1.4\n2 0 obj\n<</Filter[/ASCII85Decode/FlateDecode]/Length 99>>stream\r\n${a85}~>endstream\nendobj\n`, "latin1");
    const out = Buffer.from(unwrapAscii85(pdf)).toString("latin1");
    expect(out).toContain("/Filter/FlateDecode");
    expect(out).toContain(`/Length ${z.length}`);
    expect(out).toContain(z.toString("latin1"));
  });
});

describe("OK CIB roofing count", () => {
  it("reads the /count answer as a whole number (the live answer on 2026-10-15)", async () => {
    const { roofingTotal } = await import("./ok");
    expect(roofingTotal("6069")).toBe(6069);
  });
  it("throws on a count that isn't a number, so the paging guard can't pass with nothing read", async () => {
    const { roofingTotal } = await import("./ok");
    expect(() => roofingTotal('{"error":"Internal Server Error"}')).toThrow(/unexpected answer/);
    expect(() => roofingTotal("")).toThrow(/unexpected answer/);
  });
});
