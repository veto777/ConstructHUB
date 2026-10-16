/**
 * Parsers of ./bulk-sources.ts against small snippets of the real published files (rows copied from the downloads
 * of 2026-10-14/15; the Sunbiz record's FEI number is blanked).
 */
import { personNamed } from "./xref";
import { describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BulkHit } from "./bulk";
import { indexWords } from "./bulk";
import {
  UNZIP_TIMEOUT_MS, cslbHolder, flDispositionAdverse, flRespondentIsBusiness,
  cslbRows, parseCaDebarments, flApplicantRows, flComplaintRows, flDisciplineCases, flLicenseIndex, flLicenseRows, flQualifiers, sunbizCorporation,
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
"Certified Building Contractor","1250703","ALLEN, JOHN DOUGLAS","500 VERA CRUZ DR","DBA GULF SHORE BUILDERS LLC",,"DESTIN","FL","32541","OKALOOSA","2025069408","Licensed Activity","09/23/2025","Citation filed","01/23/2026","10/31/2025 - Citation","CB15"
`);
    const lic = await file(FL_LICENSEES);
    const complaints = await file(`"0603","COSTELLO, VINCENT ELIJAH","Broward","616 SW 8TH AVE.","DBA: RRR AFFORDABLE REPAIRS","","FORT LAUDERDALE","FL","33315-1069","Certified Roofing Contractor","2020031678","Unlicensed Activity","","Closed after legal review","11/23/2020",""\n`);
    const hits = await all(flComplaintRows([complaints], await flDisciplineCases([disc]), await flLicenseIndex([lic])));
    await Promise.all([disc, lic, complaints].map((p) => fs.rm(p)));
    const [c, d] = hits.map((h) => h.hit) as any[];
    // An individual doing business under a DBA: the record is the DBA's, with city, state and ZIP only (round 3, decision 2).
    expect(c).toMatchObject({ category: "complaint", name: "RRR AFFORDABLE REPAIRS", address: "FORT LAUDERDALE FL 33315-1069", licenseNumber: null });
    expect(d).toMatchObject({
      category: "discipline", name: "GULF SHORE BUILDERS LLC", id: "2025069408", licenseNumber: "CBC1250703", status: "Citation filed", adverse: true,
      address: "DESTIN FL 32541", date: "2025-09-23", endDate: "2026-01-23",
    });
    expect(d.detail).toContain("Citation on 2025-10-31");
    expect(words(hits[1])).toEqual(expect.arrayContaining(["l:CBC1250703", "b:GULF", "b:SHORE"]));
    expect(words(hits[1]).some((w) => w.startsWith("a:") || w === "b:ALLEN" || w.startsWith("p:"))).toBe(false);
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
    // One hit per license (audit 2026-10-15): no second hit per person. A person is found through the license's own
    // people (the runner's re-check takes one person at a time). The personnel-only license (88 is not in this master
    // sample) is one hit too, with its AKA name indexed.
    expect(rest.filter((h) => h.kind === "license" && (h.hit as any).licenseNumber === "141212")).toEqual([]);
    expect(personNamed("Clarence Q Wahner", lic.hit as any)).toBe(true);
    expect(personNamed("Peter Wahner", lic.hit as any)).toBe(false);
    expect(rest.filter((h) => h.kind === "license").map((h) => [(h.hit as any).licenseNumber, (h.hit as any).principal])).toEqual([["88", "LYNN LUYET BRUNS"]]);
    const enf = rest.find((h) => h.kind === "enforcement")!;
    expect(enf.hit).toMatchObject({ category: "discipline", status: "Work Comp Susp", licenseNumber: "141212", adverse: true });
    const bruns = rest[rest.length - 1];
    expect(words(bruns)).toEqual(expect.arrayContaining(["p:KETTERING", "p:LAVON", "p:BRUNS"]));
  });
});

describe("audit follow-ups (A5)", () => {
  it("FL: a status code DBPR's codebook doesn't list is shown as 'code X', never raw or guessed", async () => {
    // The second sample row with its primary status changed to a letter the codebook doesn't define.
    const p = await file(FL_LICENSEES.split("\n")[1].replace(`"C","A","10/31/1983"`, `"Z","A","10/31/1983"`) + "\n");
    const hits = await all(flLicenseRows(p, "Florida DBPR construction licenses (CILB)", "https://example.invalid", await flQualifiers([p])));
    await fs.rm(p);
    expect((hits[0].hit as any).status).toBe("code Z, Active");
  });

  // Rows of https://www.dir.ca.gov/dlse/debar.html as served on 2026-10-15 (the last one is the page's contact table).
  const DLSE = `<table><tr>
  <td style="text-align:left"><p><strong>MILES CONSTRUCTION GROUP, INC., a <br />California Corporation</strong><br /><br />CSLB License Number: 976339.</p></td>
  <td><p><strong>7/23/2025 through 7/23/2028</strong><br /><a class="pdf_link" href="/DLSE/Decision/40-63204.pdf">Decision 40-63204 </a></p></td>
</tr><tr>
  <td style="text-align:left"><p><strong>MICHAEL FLOORING, INC.;<br> BENNY MICHAEL</strong><br /><br />CSLB License Number: 874947</p></td>
  <td><p><strong>9/13/24 through 9/13/27</strong><br /><a class="pdf_link" href="/DLSE/Decision/SC-7278.pdf">Decision SC 7278 </a></p>
  <p>The debarment order is currently stayed by order of the Kern County Superior Court</p></td>
</tr><tr>
  <td>Division of Workers' Compensation</td>
  <td>Benefits for work-related injuries and illnesses</td>
  <td>1-800-736-7401</td>
</tr></table>`;
  it("CA debarments: adverse from the status (running true, over false, stayed unknown); the contact table is not a debarment", () => {
    const now = parseCaDebarments(DLSE, "2026-10-15").map((h) => h.hit as any);
    expect(now.map((h) => [h.id, h.status, h.adverse])).toEqual([
      ["976339", "Debarred", true],
      ["874947", "Stayed by a court (see decision)", null],
    ]);
    const later = parseCaDebarments(DLSE, "2028-08-01").map((h) => h.hit as any);
    expect(later[0]).toMatchObject({ status: "Debarment period over", adverse: false, endDate: "2028-07-23" });
  });
});

describe("round 2 (A6)", () => {
  it("decision 2: an FL qualifier's own license is an individual's even with a DBA; the business record is the business's", async () => {
    const p = await file(FL_LICENSEES);
    const hits = await all(flLicenseRows(p, "Florida DBPR construction licenses (CILB)", "https://example.invalid", await flQualifiers([p])));
    await fs.rm(p);
    expect(hits.map((h) => [(h.hit as any).licenseNumber ?? (h.hit as any).businessName, (h.hit as any).holder])).toEqual([
      ["TIDEWATER HOMES, LLC", "business"], ["CBC027065", "individual"], ["FRO7804", "individual"], ["CBC1250703", "individual"],
    ]);
  });

  it("decision 2: CSLB holder from BusinessType; TX plumbers and applicants are individuals", async () => {
    expect(cslbHolder("Corporation")).toBe("business");
    expect(cslbHolder("Sole Owner")).toBe("individual");
    expect(cslbHolder("")).toBeNull();
    const p = await file(`"0605","Certified General Contractor","JOHN","BRIAN","HUDSON","","11 FAIRCHILD LANE","","","PALM COAST","FL","32137","28","904-955-5431",""\n`);
    const [h] = await all(flApplicantRows(p, "https://example.invalid", "constr_app.csv"));
    await fs.rm(p);
    expect((h.hit as any).holder).toBe("individual");
    expect(h.component).toBe("constr_app.csv");
  });

  it("decision 3: an FL complaint against an individual (no DBA, no entity form) is left out; a business is kept", async () => {
    expect(flRespondentIsBusiness("SMITH, JOHN", [])).toBe(false);
    expect(flRespondentIsBusiness("JOHN STEEL", [])).toBe(false);
    expect(flRespondentIsBusiness("SMITH, JOHN", ["DBA: SMITH ROOFING"])).toBe(true); // a DBA needs its marker (round 4, decision 4)
    expect(flRespondentIsBusiness("ACME HOLDINGS CO", [])).toBe(true);
    const complaints = await file([
      `"0603","DOE, JANE","Broward","616 SW 8TH AVE.","","","FORT LAUDERDALE","FL","33315","Certified Roofing Contractor","2020031679","Unlicensed Activity","","Closed after legal review","11/23/2020",""`,
      `"0603","COSTELLO, VINCENT ELIJAH","Broward","616 SW 8TH AVE.","DBA: RRR AFFORDABLE REPAIRS","","FORT LAUDERDALE","FL","33315-1069","Certified Roofing Contractor","2020031678","Unlicensed Activity","","Closed after legal review","11/23/2020",""`,
    ].join("\n") + "\n");
    const disc = await file(`"License Type","License Nbr","Respondent Name","Address Line 1","Address Line 2","Address Line 3","City","State","ZIP Code","County","Complaint Nbr","Classification","Entered Date","Disposition","Disposition Date","Discipline Date - Description","Violation Code"
"Certified Building Contractor","1250703","ALLEN, JOHN DOUGLAS","500 VERA CRUZ DR",,,"DESTIN","FL","32541","OKALOOSA","2025069408","Licensed Activity","09/23/2025","Citation filed","01/23/2026","10/31/2025 - Citation","CB15"
`);
    const hits = await all(flComplaintRows([complaints], await flDisciplineCases([disc]), new Map()));
    await Promise.all([complaints, disc].map((p) => fs.rm(p)));
    expect(hits.map((h) => (h.hit as any).name)).toEqual(["RRR AFFORDABLE REPAIRS"]);
    expect(hits[0].component).toBe("complaints");
  });

  it("decision 4: FL dispositions follow the clean-match rule", () => {
    expect(flDispositionAdverse("Final Order")).toBe(true);
    expect(flDispositionAdverse("No probable cause")).toBe(false);
    expect(flDispositionAdverse("Closed after legal review")).toBeNull();
    expect(flDispositionAdverse("Final order; withdrawn")).toBeNull(); // both kinds of words
    expect(flDispositionAdverse(null)).toBeNull();
  });

  it("decision 4: a CSLB pending case is not an outcome; a suspension is", async () => {
    const head = `LicenseNo,LastUpdate,BusinessName,BUS-NAME-2,FullBusinessName,MailingAddress,City,State,County,ZIPCode,country,BusinessPhone,BusinessType,IssueDate,ReissueDate,ExpirationDate,InactivationDate,ReactivationDate,PendingSuspension,PendingClassRemoval,PendingClassReplace,PrimaryStatus,SecondaryStatus,Classifications(s),AsbestosReg,WorkersCompCoverageType,WCInsuranceCompany,WCPolicyNumber,WCEffectiveDate,WCExpirationDate,WCCancellationDate,WCSuspendDate,CBSuretyCompany,CBNumber,CBEffectiveDate,CBCancellationDate,CBAmount,WBSuretyCompany,WBNumber,WBEffectiveDate,WBCancellationDate,WBAmount,DBSuretyCompany,DBNumber,DBEffectiveDate,DBCancellationDate,DBAmount,DateRequired,DiscpCaseRegion,DBBondReason,DBCaseNo,NAME-TP-2`;
    const row = (no: string, type: string, primary: string) => `${no},08/04/2026,ACME BUILDERS,,JOHN Q DOE,1 MAIN ST,FRESNO,CA,,93701,,(559) 555 0100,${type},10/01/2010,,01/31/2027,,,,,,${primary},,B,,,,,,,,,,,,,,,,,,,,,,,,,,,,`;
    const master = await file(`${head}\n${row("900001", "Corporation", "Pending Case")}\n${row("900002", "Sole Owner", "Suspended")}\n`);
    const personnel = await file(`LIC-NO,LastUpdated,REC-TP,SEQ-NO,Name-TP,Name,EMP-Titl-CDE,CL-CDE,CL-CDE-STAT,ASSN-DT,DIS-ASSN-DT,SURETY-TP,SuretyCompany,BOND-NO,BOND-AMT,EffectiveDate,CancellationDate,JointVentureLicenseType,JointVentureLicenseNumber\n`);
    const hits = await all(cslbRows(master, personnel));
    await Promise.all([master, personnel].map((p) => fs.rm(p)));
    const lic = hits.filter((h) => h.kind === "license").map((h) => [(h.hit as any).licenseNumber, (h.hit as any).holder]);
    expect(lic).toEqual([["900001", "business"], ["900002", "individual"]]);
    const enf = hits.filter((h) => h.kind === "enforcement").map((h) => h.hit as any);
    expect(enf.map((e) => [e.licenseNumber, e.adverse])).toEqual([["900001", null], ["900002", true]]);
    // A sole owner's enforcement record carries no street or phone, and no phone or address key.
    expect(enf[1]).toMatchObject({ address: null, phone: null });
    expect(hits.find((h) => h.kind === "enforcement" && (h.hit as any).licenseNumber === "900002")!.keys).toEqual({ licenses: ["900002"] });
  });

  it("decision 3: a CA debarment naming only a person is left out", () => {
    const html = `<table><tr><td><p><strong>JOHN DOE</strong><br />CSLB License Number: 123456</p></td><td><p><strong>7/23/2025 through 7/23/2028</strong></p></td></tr>
<tr><td><p><strong>MICHAEL FLOORING, INC.;<br> BENNY MICHAEL</strong><br />CSLB License Number: 874947</p></td><td><p><strong>9/13/2024 through 9/13/2027</strong></p></td></tr></table>`;
    expect(parseCaDebarments(html, "2026-10-15").map((h) => (h.hit as any).id)).toEqual(["874947"]);
  });

  it("decision 13: unzip runs under a time limit", () => {
    expect(UNZIP_TIMEOUT_MS).toBeGreaterThan(0);
    expect(UNZIP_TIMEOUT_MS).toBeLessThanOrEqual(30 * 60_000);
  });
});

describe("FL complaint respondents: a placeholder DBA is no DBA (live 2026-10-15)", () => {
  it("RUSH, JOHN / N/A is an individual; a real DBA still makes a business", () => {
    expect(flRespondentIsBusiness("RUSH, JOHN", ["N/A"])).toBe(false);
    expect(flRespondentIsBusiness("UNKNOWN, STEVEN", ["UNKNOWN"])).toBe(false);
    expect(flRespondentIsBusiness("MUNCY, WILLIAM", ["D/B/A MUNCY ROOFING, LLC"])).toBe(true);
    expect(flRespondentIsBusiness("MUNCY, WILLIAM", ["MUNCY ROOFING, LLC"])).toBe(false); // no DBA marker: an address line (round 4, decision 4)
  });
});

describe("California CSLB files without header rows (CSLB, 2026-10-16)", () => {
  const MASTER = `LicenseNo,LastUpdate,BusinessName,BUS-NAME-2,FullBusinessName,MailingAddress,City,State,County,ZIPCode,country,BusinessPhone,BusinessType,IssueDate,ReissueDate,ExpirationDate,InactivationDate,ReactivationDate,PendingSuspension,PendingClassRemoval,PendingClassReplace,PrimaryStatus,SecondaryStatus,Classifications(s),AsbestosReg,WorkersCompCoverageType,WCInsuranceCompany,WCPolicyNumber,WCEffectiveDate,WCExpirationDate,WCCancellationDate,WCSuspendDate,CBSuretyCompany,CBNumber,CBEffectiveDate,CBCancellationDate,CBAmount,WBSuretyCompany,WBNumber,WBEffectiveDate,WBCancellationDate,WBAmount,DBSuretyCompany,DBNumber,DBEffectiveDate,DBCancellationDate,DBAmount,DateRequired,DiscpCaseRegion,DBBondReason,DBCaseNo,NAME-TP-2
141212,08/04/2026,SPRINKMANN SONS CORPORATION,,,12100 WEST SILVER SPRING ROAD,MILWAUKEE,WI,,53225,,(414) 462 7750,Corporation,10/01/1953,,01/31/2027,,,,,,Work Comp Susp,,C-2,,License does not have current W/C,TRAVELERS PROPERTY CASUALTY COMPANY OF AMERICA, UB6K86221, 06/01/2024, 06/01/2026,, 06/01/2026,AMERICAN CONTRACTORS INDEMNITY COMPANY,SC930966,01/01/2023,,25000,,,,,,,,,,,,,,,
`;
  const PERSONNEL = `LIC-NO,LastUpdated,REC-TP,SEQ-NO,Name-TP,Name,EMP-Titl-CDE,CL-CDE,CL-CDE-STAT,ASSN-DT,DIS-ASSN-DT,SURETY-TP,SuretyCompany,BOND-NO,BOND-AMT,EffectiveDate,CancellationDate,JointVentureLicenseType,JointVentureLicenseNumber
141212,03/30/2007,Class/Title,833456, Principal, SPRINKMANN                         PETER          WILLIAM, Officer, , , 03/30/2007, ,,,,,,,,
141212,06/27/2004,Class/Title,343388, Principal, SPRINKMANN                         WILLIAM        E           JR, Chief Executive Officer/President| Responsible Managing Officer/Chief Executive Officer/President, | C-2, | Y, 11/26/1979| 10/03/1985, 10/03/1985| ,Percentage Statement,,,,10/03/1985,,,
141212,06/27/2004,Class/Title,422524, Principal, WAHNER                             CLARENCE       Q, Responsible Managing Employee, C-2, N, 10/01/1953, 03/29/1982,Qualifiers Bond,UNITED STATES FIDELITY AND GUARANTY COMPANY,46011073472,5000,01/01/1980,07/01/1995,,
88,06/27/2004,Class/Title,15972, Principal| AKA, BRUNS                              LYNN           LUYET| KETTERING                          LYNN           LAVON, Responsible Managing Employee, C-8, N, 11/29/1990, 12/18/1990,,,,,,,,
`;
  const headless = (t: string) => t.slice(t.indexOf("\n") + 1);

  it("reads them with the known columns, exactly as with the headers", async () => {
    const withHeaders = [await file(MASTER), await file(PERSONNEL)];
    const without = [await file(headless(MASTER)), await file(headless(PERSONNEL))];
    const a = await all(cslbRows(withHeaders[0], withHeaders[1]));
    const b = await all(cslbRows(without[0], without[1]));
    await Promise.all([...withHeaders, ...without].map((p) => fs.rm(p)));
    expect(a.length).toBeGreaterThan(0);
    expect(b).toEqual(a);
  });

  it("fails the load when a headerless file has another number of columns", async () => {
    const master = await file(headless(MASTER).replace(/,\n/, "\n"));
    const personnel = await file(PERSONNEL);
    await expect(all(cslbRows(master, personnel))).rejects.toThrow(/no header row, and 51 columns where the known layout has 52/);
    await Promise.all([master, personnel].map((p) => fs.rm(p)));
  });

  it("fails the load when a file is cut off mid-row", async () => {
    const master = await file(MASTER);
    const personnel = await file(headless(PERSONNEL).replace(/\n[^\n]*\n$/, "\n88,06/27/2004,Class/Title,15972, Principal| AKA, BRUNS\n"));
    await expect(all(cslbRows(master, personnel))).rejects.toThrow(/a row of 6 columns where the layout has 19 \(file cut off\?\)/);
    await Promise.all([master, personnel].map((p) => fs.rm(p)));
  });
});
