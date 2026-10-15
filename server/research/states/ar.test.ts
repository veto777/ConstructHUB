import { describe, expect, it } from "vitest";
import { electricalHit, firePerson, hvacHit, parseFireRoster } from "./ar";

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
