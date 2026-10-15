/**
 * Parsers of ./bulk-sources.ts against small snippets of the real published files (rows copied from the downloads
 * of 2026-10-14/15; the Sunbiz record's FEI number is blanked).
 */
import { describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BulkHit } from "./bulk";
import { indexWords } from "./bulk";
import {
  cslbRows, flApplicantRows, flComplaintRows, flDisciplineCases, flLicenseIndex, flLicenseRows, flQualifiers, sunbizCorporation,
} from "./bulk-sources";

async function file(text: string): Promise<string> {
  const p = join(tmpdir(), `bulk-sources-test-${Date.now()}-${Math.random().toString(36).slice(2)}.csv`);
  await fs.writeFile(p, text);
  return p;
}
async function all(it: AsyncIterable<BulkHit>): Promise<BulkHit[]> { const out: BulkHit[] = []; for await (const h of it) out.push(h); return out; }
const words = (h: BulkHit) => indexWords(h.business, h.person, h.people, h.keys);

const FL_LICENSEES = [
  `"06","QB","TIDEWATER HOMES, LLC","","","3621 HENDRICKS AVE","","","JACKSONVILLE","FL","32207","26","","C","","10/13/2014","10/13/2014","","","","",""`,
  `"06","CBC","FOSHEE, JOHN PATE","TIDEWATER HOMES, LLC","","7660 PHILIPS HWY","STE 5","","JACKSONVILLE","FL","32256","26","0027065","C","A","10/31/1983","09/01/2000","08/31/2028","","","CBC027065",""`,
  `"06","FRO","MCDADE, JAMES A IV","TIDEWATER HOMES, LLC","","3621 HENDRICKS AVE","","","JACKSONVILLE","FL","32207","26","0007804","C","","02/02/2017","02/02/2017","","","","FRO7804",""`,
  `"06","CBC","ALLEN, JOHN DOUGLAS","GULF SHORE BUILDERS LLC","","500 VERA CRUZ DR","","","DESTIN","FL","32541","56","1250703","C","A","01/14/2003","09/30/2026","08/31/2028","","","CBC1250703",""`,
].join("\n") + "\n";

describe("Florida DBPR licensees", () => {
  it("puts every qualifier and the financial responsible officer on the business, and each licensee on their own license", async () => {
    const p = await file(FL_LICENSEES);
    const hits = await all(flLicenseRows(p, "Florida DBPR construction licenses (CILB)", "https://example.invalid", await flQualifiers([p])));
    await fs.rm(p);
    const qb = hits[0] as Extract<BulkHit, { kind: "license" }>;
    expect(qb.hit.businessName).toBe("TIDEWATER HOMES, LLC");
    expect(qb.hit.licenseType).toBe("Construction Business Information");
    expect(qb.hit.address).toBe("3621 HENDRICKS AVE, JACKSONVILLE FL 32207");
    expect(qb.hit.people).toEqual([
      { name: "JOHN PATE FOSHEE", role: "Qualifier, Certified Building Contractor CBC027065" },
      { name: "JAMES A IV MCDADE", role: "Financial Responsible Officer (FRO7804)" },
    ]);
    expect(words(qb)).toEqual(expect.arrayContaining(["b:TIDEWATER", "p:FOSHEE", "p:MCDADE", "a:3621 HENDRICKS", "z:32207"]));
    const cbc = hits[1] as Extract<BulkHit, { kind: "license" }>;
    expect(cbc.hit.licenseNumber).toBe("CBC027065");
    expect(cbc.hit.address).toBe("7660 PHILIPS HWY STE 5, JACKSONVILLE FL 32256");
    expect(cbc.hit.people).toEqual([{ name: "JOHN PATE FOSHEE", role: "Qualifier, Certified Building Contractor CBC027065" }]);
    expect(words(cbc)).toEqual(expect.arrayContaining(["l:CBC027065", "a:7660 PHILIPS", "z:32256"]));
    expect(words(cbc)).not.toContain("a:5 JACKSONVILLE");
  });

  it("reads the applicant list with its phone", async () => {
    const p = await file(`"0605","Certified General Contractor","JOHN","BRIAN","HUDSON","","11 FAIRCHILD LANE","","","PALM COAST","FL","32137","28","904-955-5431",""\n`);
    const [h] = await all(flApplicantRows(p, "https://example.invalid"));
    await fs.rm(p);
    expect(h.kind === "license" && h.hit).toMatchObject({ principal: "JOHN BRIAN HUDSON", licenseNumber: null, phone: "904-955-5431", address: "11 FAIRCHILD LANE, PALM COAST FL 32137" });
    expect(words(h)).toEqual(expect.arrayContaining(["p:HUDSON", "t:9049555431", "a:11 FAIRCHILD", "z:32137"]));
  });

  it("merges CILB discipline into the complaints and finds the full license number in the licensee extract", async () => {
    const disc = await file(`"License Type","License Nbr","Respondent Name","Address Line 1","Address Line 2","Address Line 3","City","State","ZIP Code","County","Complaint Nbr","Classification","Entered Date","Disposition","Disposition Date","Discipline Date - Description","Violation Code"
"Certified Building Contractor","1250703","ALLEN, JOHN DOUGLAS","500 VERA CRUZ DR",,,"DESTIN","FL","32541","OKALOOSA","2025069408","Licensed Activity","09/23/2025","Citation filed","01/23/2026","10/31/2025 - Citation","CB15"
`);
    const lic = await file(FL_LICENSEES);
    const complaints = await file(`"0603","COSTELLO, VINCENT ELIJAH","Broward","616 SW 8TH AVE.","DBA: RRR AFFORDABLE REPAIRS","","FORT LAUDERDALE","FL","33315-1069","Certified Roofing Contractor","2020031678","Unlicensed Activity","","Closed after legal review","11/23/2020",""\n`);
    const hits = await all(flComplaintRows([complaints], await flDisciplineCases([disc]), await flLicenseIndex([lic])));
    await Promise.all([disc, lic, complaints].map((p) => fs.rm(p)));
    const [c, d] = hits.map((h) => h.hit) as any[];
    expect(c).toMatchObject({ category: "complaint", name: "COSTELLO, VINCENT ELIJAH / RRR AFFORDABLE REPAIRS", address: "616 SW 8TH AVE., FORT LAUDERDALE FL 33315-1069", licenseNumber: null });
    expect(d).toMatchObject({
      category: "discipline", name: "ALLEN, JOHN DOUGLAS", id: "2025069408", licenseNumber: "CBC1250703", status: "Citation filed", adverse: true,
      address: "500 VERA CRUZ DR, DESTIN FL 32541", date: "2025-09-23", endDate: "2026-01-23",
    });
    expect(d.detail).toContain("Citation on 2025-10-31");
    expect(words(hits[1])).toEqual(expect.arrayContaining(["l:CBC1250703", "a:500 VERA", "b:ALLEN"]));
    expect(hits[1].person).toBeNull();
  });
});

describe("Sunbiz corporate record", () => {
  const line = "P98000103820BULLDOG CONSTRUCTION, INC. OF JACKSONVILLE                                                                                                                                                      IDOMP           142 SOLANO CR.                                                                      PONTE VEDRA BEACH           FL32082       142 SOLANO CR.                                                                      PONTE VEDRA BEACH           FL32082       12141998              N09192003FL2002 050220022002 050220022001 07062001PAULSEN             ALLEN                 P142 SOLANO CAY CIRCLE                     PONTE VEDRA BEACH           FL32082    D   PPAULSEN             ALLEN         S       13743 EVERGREEN DRIVE                     JACKSONVILLE                FL32207    D   PALCORN              JAMES         C       43 EVERGREEN DR.                          JACKSONVILLE                FL32207                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        ";
  it("reads the name, status, addresses, registered agent and officers at the published positions", () => {
    const c = sunbizCorporation(line)!;
    expect(c.name).toBe("BULLDOG CONSTRUCTION, INC. OF JACKSONVILLE");
    expect(c.hit.status).toBe("Inactive");
    expect(c.hit.licenseType).toBe("Business entity filing, not a license (Domestic Profit; document P98000103820)");
    expect(c.hit.address).toBe("142 SOLANO CR., PONTE VEDRA BEACH FL 32082");
    expect(c.people).toEqual([
      { name: "PAULSEN ALLEN", role: "Registered agent" },
      { name: "PAULSEN ALLEN S", role: "Director" },
      { name: "ALCORN JAMES C", role: "Director" },
    ]);
    expect(c.hit.specialty).toBe("Filed 1998-12-14");
  });
});

describe("California CSLB master + personnel", () => {
  it("puts everyone on the license with grouped roles, and keeps business address, phone and keys", async () => {
    const master = await file(`LicenseNo,LastUpdate,BusinessName,BUS-NAME-2,FullBusinessName,MailingAddress,City,State,County,ZIPCode,country,BusinessPhone,BusinessType,IssueDate,ReissueDate,ExpirationDate,InactivationDate,ReactivationDate,PendingSuspension,PendingClassRemoval,PendingClassReplace,PrimaryStatus,SecondaryStatus,Classifications(s),AsbestosReg,WorkersCompCoverageType,WCInsuranceCompany,WCPolicyNumber,WCEffectiveDate,WCExpirationDate,WCCancellationDate,WCSuspendDate,CBSuretyCompany,CBNumber,CBEffectiveDate,CBCancellationDate,CBAmount,WBSuretyCompany,WBNumber,WBEffectiveDate,WBCancellationDate,WBAmount,DBSuretyCompany,DBNumber,DBEffectiveDate,DBCancellationDate,DBAmount,DateRequired,DiscpCaseRegion,DBBondReason,DBCaseNo,NAME-TP-2
141212,08/04/2026,SPRINKMANN SONS CORPORATION,,,12100 WEST SILVER SPRING ROAD,MILWAUKEE,WI,,53225,,(414) 462 7750,Corporation,10/01/1953,,01/31/2027,,,,,,Work Comp Susp,,C-2,,License does not have current W/C,TRAVELERS PROPERTY CASUALTY COMPANY OF AMERICA, UB6K86221, 06/01/2024, 06/01/2026,, 06/01/2026,AMERICAN CONTRACTORS INDEMNITY COMPANY,SC930966,01/01/2023,,25000,,,,,,,,,,,,,,,
`);
    const personnel = await file(`LIC-NO,LastUpdated,REC-TP,SEQ-NO,Name-TP,Name,EMP-Titl-CDE,CL-CDE,CL-CDE-STAT,ASSN-DT,DIS-ASSN-DT,SURETY-TP,SuretyCompany,BOND-NO,BOND-AMT,EffectiveDate,CancellationDate,JointVentureLicenseType,JointVentureLicenseNumber
141212,03/30/2007,Class/Title,833456, Principal, SPRINKMANN                         PETER          WILLIAM, Officer, , , 03/30/2007, ,,,,,,,,
141212,06/27/2004,Class/Title,343388, Principal, SPRINKMANN                         WILLIAM        E           JR, Chief Executive Officer/President| Responsible Managing Officer/Chief Executive Officer/President, | C-2, | Y, 11/26/1979| 10/03/1985, 10/03/1985| ,Percentage Statement,,,,10/03/1985,,,
141212,06/27/2004,Class/Title,422524, Principal, WAHNER                             CLARENCE       Q, Responsible Managing Employee, C-2, N, 10/01/1953, 03/29/1982,Qualifiers Bond,UNITED STATES FIDELITY AND GUARANTY COMPANY,46011073472,5000,01/01/1980,07/01/1995,,
88,06/27/2004,Class/Title,15972, Principal| AKA, BRUNS                              LYNN           LUYET| KETTERING                          LYNN           LAVON, Responsible Managing Employee, C-8, N, 11/29/1990, 12/18/1990,,,,,,,,
`);
    const hits = await all(cslbRows(master, personnel));
    await Promise.all([master, personnel].map((p) => fs.rm(p)));
    const [lic, ...rest] = hits;
    expect(lic.kind === "license" && lic.hit).toMatchObject({
      businessName: "SPRINKMANN SONS CORPORATION", licenseNumber: "141212", phone: "(414) 462 7750",
      address: "12100 WEST SILVER SPRING ROAD, MILWAUKEE WI 53225",
      people: [
        { name: "PETER WILLIAM SPRINKMANN", role: "Officer" },
        { name: "WILLIAM E JR SPRINKMANN", role: "Responsible Managing Officer/Chief Executive Officer/President (C-2); Former Chief Executive Officer/President until 1985-10-03" },
        { name: "CLARENCE Q WAHNER", role: "Former Responsible Managing Employee (C-2) until 1982-03-29" },
      ],
    });
    expect(words(lic)).toEqual(expect.arrayContaining(["l:141212", "t:4144627750", "a:12100 SILVER", "z:53225", "p:WAHNER", "b:SPRINKMANN"]));
    // One row per person (found by a principal-name check), the Work Comp suspension as enforcement, and a
    // personnel-only license (88 is not in this master sample) with the AKA name indexed too.
    expect(rest.filter((h) => h.kind === "license" && h.hit.source.endsWith("(personnel)")).map((h) => (h.hit as any).principal))
      .toEqual(["PETER WILLIAM SPRINKMANN", "WILLIAM E JR SPRINKMANN", "CLARENCE Q WAHNER", "LYNN LUYET BRUNS"]);
    const enf = rest.find((h) => h.kind === "enforcement")!;
    expect(enf.hit).toMatchObject({ category: "discipline", status: "Work Comp Susp", licenseNumber: "141212", adverse: true });
    const bruns = rest[rest.length - 1];
    expect(words(bruns)).toEqual(expect.arrayContaining(["p:KETTERING", "p:LAVON", "p:BRUNS"]));
  });
});
