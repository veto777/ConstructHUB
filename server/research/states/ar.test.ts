import { describe, expect, it } from "vitest";
import { clbAdverse, clbBusiness, clbHit, clbLinks, electricalHit, firePerson, firstSentence, hvacHit, monthDate, parseClbDoc, parseFireRoster, scannedText } from "./ar";

// Rows of labor.arkansas.gov/wp-json/metl/v1/all saved 2026-10-15.
describe("Arkansas rosters", () => {
  it("maps a person row and skips a business row with no name", () => {
    expect(hvacHit({ Last_Name: "Smith", First_Name: "David", physicalCity: "", physicalState: "", License_Number: "1509340", License_Status: "Inactive", Submitter_Type: "Individual", License_Expiration_Date: "03/31/2020 23:59:59" })?.hit)
      .toMatchObject({ principal: "David Smith", licenseNumber: "1509340", status: "Inactive", expires: "2020-03-31" });
    expect(electricalHit({ Last_Name: "", First_Name: "", License_Number: "EC-0653", License_Status: "Expired", License_Type_Display_Name: "Electrician - Electrical Contractor" })).toBeNull();
  });
  it("drops the 2999 no-expiration placeholder", () => {
    expect(hvacHit({ First_Name: "A", Last_Name: "B", License_Expiration_Date: "06/30/2999 23:59:59" })?.hit.expires).toBeNull();
  });
});

// Excerpts of the Fire Protection Licensing Board PDFs (labor.arkansas.gov/wp-content/uploads/Sprinkler-Roster-26-27.pdf
// and 2025-2026-PORTABLE-FIXED-SYSTEMS-COMPANIES-4-1-26.pdf), saved 2026-10-15: `pdftotext -layout` and the JS reader.
const SPRINKLER = `                 ARKANSAS FIRE PROTECTION LICENSING BOARD
                                           2026/2027
                                      Updated 7/10/26
                         LICENSED SPRINKLER COMPANIES

A & A FIRE AND SAFETY COMPANY FSS-235                                   501-834-5353
4380 S 1ST ST CABOT, AR 72023                           april.broderick@aaservices.us
SHERWOOD AR 72124
RME-4798 AUSTIN WHITE
OWNER: APRIL BRODERICK

BRANCH OFFICE FSS-235A                                                  501-834-5353
295 W KIEHL AVE                                         april.broderick@aaservices.us
SHERWOOD, AR 72120

RYAN COLE, INC FSS-272                                              918-830-0211
16140 S ELWOOD AVE                                           RYAN@COLEFIRE.COM
GLENPOOL OK 74033
OWNER RYAN COLE / RME-024 JESSE MOORE

                                                                                           11 | P a g e
Revised: 7/10/26
Note: RME- Responsible Managing Employee
SHAMBAUGH & SON, L.P. FSS-115                                              260-487-7777
7614 OPPORTUNITY DRIVE                                                 FAX 260-487-7701
FORT WAYNE IN 46801
PAUL MEYERS CEO
RME-3603 JOUSHUA MACKE

BRANCH OFFICE FSS-115BR                                                  901-350-0499
`;
const SPRINKLER_JS = `                     ARKANSAS   FIRE  PROTECTION   LICENSING   BOARD
                                         2026/2027
                                       Updated 7/10 /26
                            LICENSED   SPRINKLER   COMPANIES
       315 FIRE PROTECTION SERVICES, LLC    FSS- 248                          480- 788-0045
       29525 N 144TH WAY                                   CSARRETT@315FPS.COM
       SCOTTSDALEAZ 85262
       OWNER CRAIG SARRETT
       RME -MICHAEL LaBELLE
       A & A FIRE AND SAFETY COMPANYFSS-      235                             501- 834- 5353
       4380 S 1ST ST CABOT, AR 72023                             april.broderick@aaservices.us
       SHERWOODAR 72124`;
const PORTABLE = `A & A FIRE AND SAFETY COMPANY (PF-062) (B)                         501-834-5353
4380 South 1st Street                                        (Fax) 501-843-7297
Cabot, Arkansas 72023                      april.broderick@aafiresuppression.com
Mailing Address:
P. O. Box 6960
Sherwood, AR 72124 Alan Ford, Owner

CINTAS FIRE PROTECTION (PF-014) (A-B)                                           417-865-6185
1711 N. Barnes                                                            (Fax) 417-832-8538
Springfield, MO 65803                                                   kimbrellT@cintas.com

KELLER FIRE & SAFETY COMPANY (F-152)                                              913-371-8494
1138 Kansas Avenue                                                          (Fax) 913-321-3457
Kansas City, Kansas 66105                                          craig.schraad@kellerfire.com
Logan Wilson, Secretary/Treasurer

                                                    1
Note: P= portable license      F= fixed system license A= class A hydrostatic license
B= class B hydrostatic license H=Halon        CA= clean agent CO2

Revised 4/1/2026
`;

describe("Arkansas Fire Protection Licensing Board rosters (PDF)", () => {
  it("reads companies, branch offices, owners and RMEs from the sprinkler roster", () => {
    const hits = parseFireRoster(SPRINKLER, "sprinkler");
    expect(hits.map((h) => h.licenseNumber)).toEqual(["FSS-235", "FSS-235A", "FSS-272", "FSS-115", "FSS-115BR"]);
    expect(hits[0]).toMatchObject({
      businessName: "A & A FIRE AND SAFETY COMPANY", phone: "501-834-5353", address: "4380 S 1ST ST CABOT, AR 72023", city: null,
      status: "On the board's roster of 2026-07-10", principal: "AUSTIN WHITE",
      people: [{ name: "AUSTIN WHITE", role: "Responsible managing employee (RME)" }, { name: "APRIL BRODERICK", role: "Owner" }],
    });
    expect(hits[1]).toMatchObject({ businessName: "A & A FIRE AND SAFETY COMPANY", specialty: "Branch office", address: "295 W KIEHL AVE SHERWOOD, AR 72120", city: "SHERWOOD", people: [] });
    expect(hits[2].people).toEqual([{ name: "RYAN COLE", role: "Owner" }, { name: "JESSE MOORE", role: "Responsible managing employee (RME)" }]);
    // A fax number is never the phone; a role after the name without a comma still counts.
    expect(hits[3]).toMatchObject({ phone: "260-487-7777", people: [{ name: "PAUL MEYERS", role: "CEO" }, { name: "JOUSHUA MACKE", role: "Responsible managing employee (RME)" }] });
  });

  it("reads the JS reader's layout the same way (glued words, spaced dashes)", () => {
    const hits = parseFireRoster(SPRINKLER_JS, "sprinkler");
    expect(hits.map((h) => [h.licenseNumber, h.phone])).toEqual([["FSS-248", "480-788-0045"], ["FSS-235", "501-834-5353"]]);
    // A five-digit house number is not a ZIP code.
    expect(hits[0].address).toBe("29525 N 144TH WAY SCOTTSDALEAZ 85262");
    expect(hits[0].people).toEqual([{ name: "CRAIG SARRETT", role: "Owner" }, { name: "MICHAEL LaBELLE", role: "Responsible managing employee (RME)" }]);
  });

  it("reads the portable/fixed list with the class codes its legend defines", () => {
    const hits = parseFireRoster(PORTABLE, "portable");
    expect(hits.map((h) => [h.businessName, h.licenseNumber, h.specialty])).toEqual([
      ["A & A FIRE AND SAFETY COMPANY", "PF-062", "Portable, Fixed system, Class B hydrostatic"],
      ["CINTAS FIRE PROTECTION", "PF-014", "Portable, Fixed system, Class A hydrostatic, Class B hydrostatic"],
      ["KELLER FIRE & SAFETY COMPANY", "F-152", "Fixed system"],
    ]);
    // The physical address, not the mailing address; the person on the mailing address's last line.
    expect(hits[0]).toMatchObject({ address: "4380 South 1st Street Cabot, Arkansas 72023", city: "Cabot", people: [{ name: "Alan Ford", role: "Owner" }], status: "On the board's roster of 2026-04-01" });
    expect(hits[2].people).toEqual([{ name: "Logan Wilson", role: "Secretary/Treasurer" }]);
  });

  it("knows people from companies", () => {
    expect(firePerson("OWNER SPF HOLDING, INC.")).toBeNull();
    expect(firePerson("VP NICK PICKENS")).toEqual({ name: "NICK PICKENS", role: "Vice President" });
    expect(firePerson("KARL LIMBERG, III, PRESIDENT")).toEqual({ name: "KARL LIMBERG, III", role: "President" });
  });
});

describe("AR roster endpoint payload", () => {
  it("reads rows and the table total", async () => {
    const { metlBody } = await import("./ar");
    expect(metlBody({ recordsTotal: 0, recordsFiltered: 0, data: [] })).toEqual({ total: 0, rows: [] });
  });
  it("throws when the total is missing, so the paging check can't pass on an empty answer", async () => {
    const { metlBody } = await import("./ar");
    expect(() => metlBody({ data: [] })).toThrow(/unexpected payload/);
    expect(() => metlBody({ code: "rest_no_route", message: "No route was found matching the URL and request method." })).toThrow(/unexpected payload/);
  });
});

describe("Arkansas round-2 audit (2026-10-16)", () => {
  it("roster people hold their own licenses; each electrical license type is a component (decisions 2 and 10)", () => {
    const e = electricalHit({ First_Name: "Jane", Last_Name: "Doe", License_Number: "J-1", License_Status: "Active", License_Type_Display_Name: "Electrician - Journeyman" })!;
    expect(e.hit.holder).toBe("individual");
    expect(e.component).toBe("Electrician - Journeyman");
    expect(hvacHit({ First_Name: "A", Last_Name: "B", License_Number: "1" })!.hit.holder).toBe("individual");
  });
  it("fire roster companies are businesses", () => {
    const text = `ARKANSAS FIRE PROTECTION LICENSING BOARD\nACME FIRE SPRINKLER CO FSS-248   501-555-0100\n100 MAIN ST\nLITTLE ROCK, AR 72201\nOWNER: JOHN SMITH\n`;
    const [h] = parseFireRoster(text, "sprinkler");
    expect(h).toMatchObject({ businessName: "ACME FIRE SPRINKLER CO", holder: "business" });
  });
});

// Trimmed `pdftotext -layout` text of the Contractors Licensing Board findings-of-fact PDFs, saved 2026-10-15
// (labor.arkansas.gov/wp-content/uploads/<file>).
const RESIDENTIAL_2023 = `                            JUNE 21, 2023 HEARINGS



ARKANSAS RESIDENTIAL CONTRACTORS COMMITTEE

vs

NITRO LAWN LLC
                                           ORDER
       The Committee voted unanimously that NITRO LAWN LLC shall pay a civil
penalty of $400 for violation of Section 17-25-505 payable to the Committee within
twenty (20) days. The Committee further ordered that a cease and desist order be
issued against NITRO LAWN LLC to prevent them from performing work in violation.


ARKANSAS RESIDENTIAL CONTRACTORS COMMITTEE

vs
SVR, LLC
                                           ORDER
      The Committee voted unanimously that the license of SVR, LLC is revoked for
misconduct. The Committee further ordered that a cease and desist order be issued
against SVR, LLC to prevent them from performing work in violation but does not
prevent them from completing or correcting defective work on projects that they have
ongoing, allowing them to comply with an agreed order with the Arkansas Attorney
General.




ARKANSAS RESIDENTIAL CONTRACTORS COMMITTEE

vs

KRISTERPHER WILKERSON

                                         ORDER
       The Committee voted unanimously that the license of KRISTERPHER
WILKERSON is revoked for misconduct.




                            SETTLEMENT AGREEMENTS



53374 PEPE PROPERTIES, LLC $3,800.00
53242 PATRICK MURPHY $12,000.00 reduced to $500.00 if no further violations for 3
years, pay any judgment, pay this penalty as agreed
52997 DOVETAIL CABINETS LLC                $4,800 reduced to $200 on the condition that
there be no further violations for three years, pay any judgement obtained by the
complainant, if any, and pay this penalty within 20 days
`; // 06_21_23-Residential-Hearings.pdf

const COMMERCIAL_2010 = `                     AUGUST 13, 2010 HEARINGS

ARKANSAS CONTRACTORS LICENSING BOARD

vs.

CAMPUS CREST CONSTRUCTION, LLC

                                          ORDER
        The Board voted 5 to 1 that Campus Crest Construction, LLC shall pay a
civil penalty of $183,178.00 for using and aiding and abetting unlicensed
subcontractors to the Board payable within twenty (20) days of receipt of this
Order. Further the license of Campus Crest Construction, LLC is hereby revoked
for misconduct.


                        SETTLEMENT AGREEMENTS

Michael Rushing DBA - Quality Flooring $1,300.00
Delta Utilities, Inc. $200.00
Noah Loyd DBA - Superior Metal Companies, LLC and Superior Metal, Inc.
       $3,500.00 reduced to $2,000.00 if no further violations for 2 years
Eddie Long 500.00
Michelle Laws DBA - Laws, Inc. $500.00
Mark Hardy LLC        $2,500.00
`; // Commercial-Hearings_081310.pdf

const AGREED_2022 = `                          NOVEMBER 18, 2022 HEARINGS



ARKANSAS CONTRACTORS LICENSING BOARD

vs

CRG CONSTRUCTION & RESTORATION L.L.C.

The Contractor entered into an agreed order with the following terms: License is
revoked for misconduct. However, that revocation is reduced to a 30 day suspension
effective November 18, 2022, contingent upon the following conditions:

5.    CRG Construction & Restoration L.L.C. pay a civil penalty in the amount of $500
to the Contractors Licensing Board on or before December 19, 2022
`; // 11_18_22-Commercial-Hearings.pdf

const NO_PENALTY_2004 = `                       JUNE 25, 2004 HEARINGS
                         FINDINGS OF FACT



ARKANSAS CONTRACTORS LICENSING BOARD

vs.

DYNAMIC ENERGY CONCEPTS, INC.

                                      ORDER
        The Board voted unanimously that Dynamic Energy Concepts, Inc. was in
violation of Act 150 but assessed no penalty. Dynamic Energy Concepts, Inc.
shall refrain from bidding on or performing work on any projects in excess of
$20,000.00 prior to being licensed with the Contractors Licensing Board.
`; // Commercial-Hearings_062504.pdf

const DISMISSAL_2023 = `                            NOVEMBER 15, 2023 HEARINGS

ARKANSAS RESIDENTIAL CONTRACTORS COMMITTEE

vs

MARK BAKER CUSTOM HOMES, INC.
                                        ORDER
       After hearing testimony the Committee ordered that this matter be dismissed until
the issues are resolved in civil court.
`; // 11_15_23-Residential-Hearings.pdf

const NO_VIOLATION_2013 = `                         JULY 24, 2013 HEARINGS

ARKANSAS RESIDENTIAL BUILDING CONTRACTORS COMMITTEE

VS

THE LOWRY COMPANY OF NORTHWEST ARKANSAS, INC.

                                      ORDER

       The Committee found no violation.
`; // Residential-Hearings_072413.pdf

const RECOMMENDED_2024 = `                            JANUARY 24, 2024 HEARINGS

ARKANSAS RESIDENTIAL CONTRACTORS COMMITTEE

vs

TRI-STATE INTERNATIONAL BUILDING SYSTEMS, INC.

                                 RECOMMENDED ORDER
The Committee voted unanimously to recommended that the license of TRI-STATE
INTERNATIONAL BUILDING SYSTEMS, INC. be revoked for misconduct. You have
the right to appeal this decision pursuant to the provisions of Ark. Code Ann. 17-25-511.
`; // 01_24_24-Residential-Hearings.pdf

const REPRIMAND_2024 = `                                JANUARY 26, 2024 HEARINGS



ARKANSAS CONTRACTORS LICENSING BOARD

vs

TRI-STATE INTERNATIONAL BUILDING SYSTEMS, INC.

                                               ORDER

        The Board voted unanimously that TRI-STATE INTERNATIONAL BUILDING SYSTEMS, INC.
is guilty of misconduct and ordered that a letter of reprimand be issued. You have the right to appeal
this decision pursuant to the provisions of Ark. Code Ann. 25-15-212.




                                   SETTLEMENT AGREEMENTS

54140 ALCU CONTRACTING LLC      $5,000.00
54139 FAYETTEVILLE GARAGE DOOR COMPANY, INC $900.00 reduced to $500.00 if no further
violations for 3 years
52504 NWA CREATIVE SPACES LLC $1,000.00
51100 WILLIAMS CONSULTING & SERVICES LLC DBA - JUSTIN WILLIAMS CONSTRUCTION
        $3,000.00
`; // 01_26_24-Commercial-Hearings.pdf

const SURRENDER_2011 = `                      January 26, 2011 HEARINGS

                         SETTLEMENT AGREEMENTS

Kathleen Inmon DBA - Kathleen Inmon Builders       $2,400.00 reduced to
$1,200.00 if no further violations for 2 years
Sisco Homes, LLC Surrendered license in lieu of hearing
`; // Residential-Hearings_012611.pdf

const URL_2023 = "https://labor.arkansas.gov/wp-content/uploads/06_21_23-Residential-Hearings.pdf";
const hitsOf = (text: string, url = URL_2023) => {
  const doc = parseClbDoc(text);
  if ("unreadable" in doc) throw new Error(doc.unreadable);
  return doc.records.map((r) => clbHit(r, doc.date!, url));
};

describe("Arkansas Contractors Licensing Board findings of fact", () => {
  it("reads orders and numbered settlements; individuals are left out", () => {
    const hits = hitsOf(RESIDENTIAL_2023);
    expect(hits.map((h) => h?.name ?? null)).toEqual(["NITRO LAWN LLC", "SVR, LLC", null, "PEPE PROPERTIES, LLC", null, "DOVETAIL CABINETS LLC"]);
    expect(hits[0]).toMatchObject({
      state: "AR", sourceUrl: URL_2023, category: "discipline", date: "2023-06-21", amount: 400, adverse: true, licenseNumber: null,
      status: "The Committee voted unanimously that NITRO LAWN LLC shall pay a civil penalty of $400 for violation of Section 17-25-505 payable to the Committee within twenty (20) days.",
    });
    expect(hits[1]).toMatchObject({ amount: null, adverse: true, status: "The Committee voted unanimously that the license of SVR, LLC is revoked for misconduct." });
    // The number before a settlement's name is unlabeled in the PDF: the record's id, not a license number.
    expect(hits[3]).toMatchObject({ id: "53374", licenseNumber: null, amount: 3800, adverse: null, status: "Settlement agreement: $3,800.00" });
    // The conditions (which name homeowners in other entries) stay in the PDF.
    expect(hits[5]).toMatchObject({ id: "52997", amount: 4800, adverse: true, status: "Settlement agreement: $4,800 reduced to $200 (conditions in the PDF)" });
    expect(JSON.stringify(hits)).not.toMatch(/WILKERSON|MURPHY/);
  });

  it("reads unnumbered settlements; a person d/b/a a business (a sole proprietor) is left out", () => {
    const hits = hitsOf(COMMERCIAL_2010);
    expect(hits.map((h) => h?.name ?? null)).toEqual(["CAMPUS CREST CONSTRUCTION, LLC", null, "Delta Utilities, Inc.", null, null, null, "Mark Hardy LLC"]);
    expect(hits[0]).toMatchObject({ amount: 183178, adverse: true, date: "2010-08-13", detail: "Arkansas Contractors Licensing Board hearing of 2010-08-13: order (the full order is in the PDF)" });
    expect(hits[2]).toMatchObject({ amount: 200, status: "Settlement agreement: $200.00" });
    expect(JSON.stringify(hits)).not.toMatch(/Noah Loyd|Superior Metal|Michelle Laws|Laws, Inc|Eddie Long/);
  });

  it("reads an agreed order with no ORDER line, and a violation found without a penalty", () => {
    const [crg] = hitsOf(AGREED_2022);
    expect(crg).toMatchObject({ name: "CRG CONSTRUCTION & RESTORATION L.L.C.", adverse: true, amount: 500, date: "2022-11-18" });
    expect(crg!.status).toBe("The Contractor entered into an agreed order with the following terms: License is revoked for misconduct.");
    const [dyn] = hitsOf(NO_PENALTY_2004);
    expect(dyn).toMatchObject({ name: "DYNAMIC ENERGY CONCEPTS, INC.", adverse: true, amount: null, date: "2004-06-25" });
  });

  it("knows businesses only from entity words", () => {
    expect(clbBusiness("JEREMY TERRELL DBA - IAT, LLC")).toBeNull();
    expect(clbBusiness("JOHNNY & ROBERT ESTRADA, D/B/A ESTRADA'S PAINTING & SERVICES, INC.")).toBeNull();
    expect(clbBusiness("T.J. KELLEY & ASSOCIATES, INC. & MIKE DUGAN, D/B/A MD HEAT & AIR, A JOINT VENTURE")).toBeNull();
    expect(clbBusiness("Utility Service Co., Inc. DBA - USC, Inc.")).toBe("Utility Service Co., Inc. DBA - USC, Inc.");
    expect(clbBusiness("JAIME LARA, INC., D/B/A ARKANSAS CUSTOM POLE BARNS")).toBe("JAIME LARA, INC., D/B/A ARKANSAS CUSTOM POLE BARNS");
    expect(clbBusiness("A-TEAM REMODELING & CONSTRUCTION")).toBeNull();
    expect(clbBusiness("S S FENCE & IRON")).toBeNull();
    expect(clbBusiness("MARK CURTIS, D/B/A MAC MC CONSTRUCTION")).toBeNull();
  });

  it("a dismissal and a finding of no violation are not adverse; a recommendation is unknown", () => {
    const [baker] = hitsOf(DISMISSAL_2023, "https://labor.arkansas.gov/wp-content/uploads/11_15_23-Residential-Hearings.pdf");
    expect(baker).toMatchObject({
      name: "MARK BAKER CUSTOM HOMES, INC.", adverse: false, amount: null, date: "2023-11-15",
      status: "After hearing testimony the Committee ordered that this matter be dismissed until the issues are resolved in civil court.",
    });
    const [lowry] = hitsOf(NO_VIOLATION_2013);
    expect(lowry).toMatchObject({ name: "THE LOWRY COMPANY OF NORTHWEST ARKANSAS, INC.", adverse: false, status: "The Committee found no violation." });
    const [tri] = hitsOf(RECOMMENDED_2024);
    expect(tri).toMatchObject({ name: "TRI-STATE INTERNATIONAL BUILDING SYSTEMS, INC.", adverse: null });
    expect(tri!.status).toBe("The Committee voted unanimously to recommended that the license of TRI-STATE INTERNATIONAL BUILDING SYSTEMS, INC. be revoked for misconduct.");
  });

  it("reads settlement outcomes in words, and a reprimand", () => {
    const hits = hitsOf(REPRIMAND_2024);
    expect(hits[0]).toMatchObject({ name: "TRI-STATE INTERNATIONAL BUILDING SYSTEMS, INC.", adverse: true });
    expect(hits[2]).toMatchObject({ name: "FAYETTEVILLE GARAGE DOOR COMPANY, INC", amount: 900, status: "Settlement agreement: $900.00 reduced to $500.00 (conditions in the PDF)" });
    expect(hits[1]).toMatchObject({ name: "ALCU CONTRACTING LLC", id: "54140", amount: 5000 });
    expect(hits[4]).toMatchObject({ name: "WILLIAMS CONSULTING & SERVICES LLC DBA - JUSTIN WILLIAMS CONSTRUCTION", id: "51100", amount: 3000 });
    expect(hits[1].detail).toBe("Arkansas Contractors Licensing Board, settlement agreements listed with the hearings of 2024-01-26 (number printed before the name: 54140)");
    const surrender = hitsOf(SURRENDER_2011);
    expect(surrender.map((h) => h?.name ?? null)).toEqual([null, "Sisco Homes, LLC"]);
    expect(surrender[1]).toMatchObject({ amount: null, adverse: true, status: "Settlement agreement: Surrendered license in lieu of hearing" });
  });

  it("does not end the decision sentence at an abbreviation", () => {
    expect(firstSentence("The Board voted unanimously that T.J. Kelley & Associates, Inc. shall pay a civil penalty of $1,474.00. The Board further")).toBe("The Board voted unanimously that T.J. Kelley & Associates, Inc. shall pay a civil penalty of $1,474.00.");
    expect(firstSentence("The Board voted unanimously that Roy Lee Jones, Jr., d/b/a Roy Lee Jones, Jr. Construction Co. shall pay. Then")).toBe("The Board voted unanimously that Roy Lee Jones, Jr., d/b/a Roy Lee Jones, Jr. Construction Co. shall pay.");
  });

  it("skips a scan and a document it can't read", () => {
    // 101324.pdf (Hearings – Finding of FACT – November 13, 2024): twelve scanned pages, pdftotext gives form feeds only.
    expect(scannedText("\f\f\f\f\f\f\f\f\f\f\f\f")).toBe(true);
    expect(scannedText(RESIDENTIAL_2023)).toBe(false);
    // A respondent with no order after it: the whole document is skipped, never half-read.
    expect(parseClbDoc(RESIDENTIAL_2023.replace(/ORDER\n\s+The Committee voted unanimously that the license of KRISTERPHER\nWILKERSON is revoked for misconduct\./, ""))).toHaveProperty("unreadable");
    // No date in the header and no link text to fall back on.
    expect(parseClbDoc(NO_PENALTY_2004.replace("JUNE 25, 2004 HEARINGS", ""))).toEqual({ unreadable: "no hearing date" });
    expect(parseClbDoc(NO_PENALTY_2004.replace("JUNE 25, 2004 HEARINGS", ""), "Hearings – Findings of FACT June 25, 2004")).toMatchObject({ date: "2004-06-25" });
  });

  it("finds the PDFs in the page's WordPress content", () => {
    const html = `<p><a href="https://labor.arkansas.gov/wp-content/uploads/12126.pdf"><mark>Hearings- Finding of FACT &#8211; January 21, 2026</mark></a></p>`;
    expect(clbLinks(html)).toEqual([{ url: "https://labor.arkansas.gov/wp-content/uploads/12126.pdf", title: "Hearings- Finding of FACT – January 21, 2026" }]);
    expect(monthDate("Hearings- Finding of FACT – January 21, 2026")).toBe("2026-01-21");
  });
});
