import { describe, expect, it } from "vitest";
import { parseKyGrid } from "./ky";

// A snippet of the dhbc.ky.gov licensee grid saved 2026-10-15.
const GRID = `<table class="Grid" id="MainContent_grdData"><tr><th scope="col">&nbsp;</th><th scope="col">License Type</th></tr><tr>
<td style="width:150px;"><a href="HBC_Lic_Details.aspx?id=576689">Smith, Louis C </a></td><td>Master Plumber</td><td>L C Smith Plumbing &amp; Heating Co Inc</td><td>M5846</td><td>Active</td><td>3/23/2011</td><td>3/31/2027</td></tr></table>`;

describe("Kentucky HBC grid", () => {
  it("reads a licensee row", () => {
    expect(parseKyGrid(GRID)).toEqual([{ id: "576689", name: "Smith, Louis C", person: "Smith, Louis C", type: "Master Plumber", dba: "L C Smith Plumbing & Heating Co Inc", number: "M5846", status: "Active", issued: "2011-03-23", expires: "2027-03-31" }]);
  });
});

describe("KY capped searches (audit 2026-10-15)", () => {
  it("a division still at the 50-row cap after the active-only search is reported, not silently dropped", async () => {
    const { kyRows } = await import("./ky");
    const row = (i: number) => ({ id: String(i), name: `ROW ${i}`, type: "T", dba: null, number: String(i), status: "Active", issued: null, expires: null });
    const fifty = (o: number) => Array.from({ length: 50 }, (_, i) => row(o + i));
    const r = await kyRows("SMITH", async (_n, d = "0", status = "") => (d === "0" ? fifty(0) : d === "49" ? fifty(status ? 2000 : 1000) : []));
    expect(r.note).toMatch(/division 49: even its active licenses reach/);
    const ok = await kyRows("SMITH", async () => [row(1)]);
    expect(ok.note).toBeNull();
  });
  it("searchBy is null for a phone or address", async () => {
    const { searchKyHbcBy } = await import("./ky");
    expect(await searchKyHbcBy({ type: "phone", value: "(502) 573-0365" })).toBeNull();
  });
});

describe("Kentucky round-2 audit (2026-10-16)", () => {
  it("the license type decides the holder (decision 2)", async () => {
    const { kyHolder } = await import("./ky");
    expect(kyHolder("Master Plumber")).toBe("individual");
    expect(kyHolder("Electrical Contractor - Business")).toBe("business");
    expect(kyHolder("HVAC Master Contractor")).toBe("individual");
    expect(kyHolder("Fire Sprinkler Contractor")).toBe("business");
    expect(kyHolder(null)).toBeNull();
  });
});

// KOSHRC decisions (koshrc.ky.gov/Pages/Decisions.aspx and its PDFs), saved and trimmed 2026-10-15. PDF text is
// pdftotext -layout output of the published files (their text layer is the agency's OCR).
describe("KOSHRC decisions list", () => {
  const LIST = `<tr class=""><td class="ms-vb2">5656-20</td><td class="ms-vb2"><a href="/KOSHRC%20DECISIONS/5656-20 Bailey's Masonry DEC.pdf">Bailey's Masonry Inc</a></td><td class="ms-vb2"><nobr>3/5/2024</nobr></td></tr><tr class=""><td class="ms-vb2">5534-18</td><td class="ms-vb2"><a href="http://koshrc-edit.ky.gov/KOSHRC%20DECISIONS/5534-18 Kalkreuth Roofing and Sheet Metal DECISION.pdf">Kalkreuth Roofing and Sheet Metal</a></td><td class="ms-vb2"><nobr>2/2/2022</nobr></td></tr><tr class=""><td class="ms-vb2">0854</td><td class="ms-vb2"><a href="https://koshrc.ky.gov/KOSHRC%20DECISIONS/854%20American%20Saw%20and%20Tool.pdf">American Saw &amp; Tool - Division of Vermont American Corporation</a></td><td class="ms-vb2"><nobr>6/2/1983</nobr></td></tr><tr class="ms-alternatingstrong"><td class="ms-vb2">0851</td><td class="ms-vb2"><a href="https://koshrc.ky.gov/KOSHRC%20DECISIONS/854%20American%20Saw%20and%20Tool.pdf">Central Kentucky Tool &amp; Engineering Corporation</a></td><td class="ms-vb2"><nobr>5/24/1983</nobr></td></tr>`;
  it("reads case #, case name, date and the absolute PDF link; a PDF two rows share goes to the row its file name numbers", async () => {
    const { parseKoshrcList } = await import("./ky");
    const rows = parseKoshrcList(LIST);
    expect(rows.map((r) => r.caseNo)).toEqual(["5656-20", "5534-18", "0854"]);
    expect(rows[0]).toEqual({ caseNo: "5656-20", url: "https://koshrc.ky.gov/KOSHRC%20DECISIONS/5656-20%20Bailey's%20Masonry%20DEC.pdf", title: "Bailey's Masonry Inc", date: "2024-03-05" });
    expect(rows[2].title).toBe("American Saw & Tool - Division of Vermont American Corporation");
    // The off-site link is kept as published; the loader skips it (koshrc-edit.ky.gov answers 401).
    expect(rows[1].url.startsWith("http://koshrc-edit.ky.gov/")).toBe(true);
  });
});

const BAILEY = `                      COMMONWEALTH OF KENTUCKY
                    OCCUPATIONAL SAFETY AND HEALTH
                          REVIEW COMMISSION
                                                                  KO$HRC #5656-20
COMMISSIONER OF WORKPLACE STANDARDS
COMMONWEALTH OF KENTUCKY                                          COMPLAINANT

V.


BAILEY’S MASONRY INC.                                             RESPONDENT
        DECISION AND ORDER OF THE REVIEW COMMISSION

working on the scaffolding’s top level at a time when the red extension ladder did not extend at

least three feet above the upper platform’s surface. We affirm Citation 1 Item 5, its classification,

and the associated penalty.

       For the foregoing reasons, we AFFIRM our hearing officer’s evidentiary rulings, findings

of fact, and conclusions of law and adopt the order as the final order of this Commission.


It is so ORDERED.
March 5, 2024.
                            CERTIFICATE OF SERVICE`;

const UPS = `                           COMMONWEALTH OF KENTUCKY
                         OCCUPATIONAL SAFETY AND HEALTH
                               REVIEW COMMISSION

                                                                               KOSHRC 4869· 11

SECRETARY OF LABOR                                                              COMPLAINANT

V


UNITED PARCEL SERVICE, INC                                                        RESPONDENT

   For the reasons given, we reverse our hearing officer and dismiss citation 1.

   It is so ordered.

   April 7, 2014.`;

const LEWIS = `                        COMMONWEALTH OF KENTUCKY
                     OCCUPATIONAL SAFETY AND HEALTH
                          · REVIEW COMMISSION
                                                        KOSHRC 111439
    SECRETARY OF LABOR
    COMMONWEALTH OF KENTUCK~                            COMPLAINANT
    vs.
    RICHARD LEWIS                                       RESPONDENT
                            DECISION AND ORDER
    the Hearing Officer that the cited worker was the employee
    of the Resportdent. Based upon this finding, IT IS HEREBY
    ORDERED that the penalty and citation charging the serious
    violation o~ 29 CFR 1926.300 (b)(l) are VACATED.
              Copy of the foregoing Order has been served upon the following`;

const KAUFMAN = `                             COMMONWEALTH OF KENTUCKY
                          OCCUPATIONAL SAFETY AND HEALTH
                                 REVIEW COMMISSION
                            KOSHRC DOCKET NO. 2402-93

 SECRETARY OF LABOR                                              COMPLAINANT
 COMMONWEALTH OF K~NTUCKY

 v.
 BUTCH KAUFMAN CARPET CLEANING                                    RESPONDENT

                                * * * * * * * * * *
                                 DECISION AND ORDER
      We therefore sustain citation 1, items 1 (a) and 1 (b) and the

penalty of $600.

      We affirm that portion of our hearing officer's recommended

order which is consistent with this decision.

      It is so ordered.`;

const KENTON = `SECRETARY OF LABOR                                                              COMPLAINANT
COMMONWEALTH OF KENTUCKY
vs.
KENTON COUNTY JAIL                                                              RESPONDENT

                                * * * * * * * * * *
                                DECISION AND ORDER
       We conclude the secretary of labor did not prove Kenton County
Jail had notice 1910.134 applied to it.              we therefore reverse our

hearing officer and dismiss both citations                  and their proposed
·penal ties. It is so ordered`;

const WILBURN = `SECRETARY OF THE LABOR CABINET
COMMONWEALTH OF KENTUCKY                                             COMPLAINANT

V


D. W. WILBURN, INC                                                     RESPONDENT

                                   **********
                          DECISION AND ORDER OF THIS
                             REVIEW COMMISSION
   We affirm our hearing officer's recommended order to dismiss the citation for

lack of proof about the nature of the fall. We adopt our hearing officer's order.

   It is so ordered.`;

const MMI = `SECRETARY OF LABOR                                  COMPLAINANT

                         DECISION AND ORDER
VS.                            OF THE
                         REVIEW COMMISSION
MASTER MECHANICAL INSULATION                        RESPONDENT
     We sustain citation 1, citation 4 and the penalties (deter-

mined by the hearing officer to be $420 and $560 respectively)

and dismiss citations 2, 3, 8 and 9. It is so ordered.`;

const BARKER_NOTICE = `               vs.

               K. A. BARKER CONSTRUCTION CO., INC.                        RESPONDENT

                                 ORDER OF REVIEW COMMISSION
                           Pursuant to Section 47 of our Rules of Procedure, juris-
                diction in this matter now rests solely in this Commission and it
                is hereby ordered that unless this Decision, Findings of Fact,
                Conclusions of LJw, and Reco1nmended Order is called for review and
                further consideration by a member of this Commission within 40 days
                of the .date of this order, on its own order, or the granting of a
                petition for discretionary review, it is adopted and affirmed ns
                the Decision, Findings of Fact, Conclusions of Law and Final Order
                of this Co~nission in the above-styled matter.
     Copy of this Notice and Order has been served by mailing`;

describe("KOSHRC decisions: who and what", () => {
  const row = (caseNo: string, title: string) => ({ caseNo, url: `https://koshrc.ky.gov/KOSHRC%20DECISIONS/${caseNo}.pdf`, title, date: "2024-03-05" });

  it("an affirmed citation and penalty is adverse; the hit links its decision", async () => {
    const { koshrcHit } = await import("./ky");
    const h = koshrcHit(row("5656-20", "Bailey's Masonry Inc"), BAILEY)!;
    expect(h).toMatchObject({ state: "KY", category: "discipline", name: "Bailey's Masonry Inc", id: "5656-20", date: "2024-03-05", adverse: true, amount: null, status: "Review Commission: Affirmed (citation, violation or penalty)", sourceUrl: "https://koshrc.ky.gov/KOSHRC%20DECISIONS/5656-20.pdf" });
    expect(h.detail).toMatch(/We affirm Citation 1 Item 5/);
  });

  it("a citation the Commission dismisses (reversing its hearing officer) is not adverse", async () => {
    const { koshrcHit } = await import("./ky");
    expect(koshrcHit(row("4869-11", "United Parcel Service, Inc."), UPS)).toMatchObject({ name: "United Parcel Service, Inc.", adverse: false, status: "Review Commission: Vacated or dismissed" });
    // "affirm our hearing officer's recommended order to dismiss the citation": dismissed, not affirmed.
    expect(koshrcHit(row("4660-09", "D.W. Wilburn, Inc."), WILBURN)).toMatchObject({ adverse: false });
  });

  it("an individual respondent and a public body are left out", async () => {
    const { koshrcHit, koshrcOutcome } = await import("./ky");
    expect(koshrcOutcome(LEWIS).adverse).toBe(false); // the order is read, but the respondent is a person
    expect(koshrcHit(row("1439", "Richard Lewis"), LEWIS)).toBeNull();
    expect(koshrcHit(row("2700-95", "Kenton County Jail"), KENTON)).toBeNull();
  });

  it("the caption decides a business the list names by its owner; one stated penalty is the amount", async () => {
    const { koshrcHit, koshrcCaption } = await import("./ky");
    expect(koshrcCaption(KAUFMAN)).toBe("BUTCH KAUFMAN CARPET CLEANING");
    expect(koshrcCaption(MMI)).toBe("MASTER MECHANICAL INSULATION");
    expect(koshrcHit(row("2402-93", "Butch Kaufman"), KAUFMAN)).toMatchObject({ name: "BUTCH KAUFMAN CARPET CLEANING", adverse: true, amount: 600 });
  });

  it("affirmed in part is adverse with no single amount; a conditional notice decides nothing", async () => {
    const { koshrcOutcome } = await import("./ky");
    expect(koshrcOutcome(MMI)).toMatchObject({ adverse: true, amount: null, status: "Review Commission: Affirmed in part, vacated or dismissed in part" });
    expect(koshrcOutcome(BARKER_NOTICE)).toMatchObject({ adverse: null, status: null, amount: null });
  });
});

describe("KOSHRC respondent names (case names on the list, 2026-10-15)", () => {
  it("leaves out the individuals a case name joins to a business", async () => {
    const { koshrcBusinessName } = await import("./ky");
    expect(koshrcBusinessName("Ross Brothers Construction and Stephen K. Bentley")).toBe("Ross Brothers Construction");
    // A person d/b/a a trade name is a sole proprietorship: an individual, left out (FCRA).
    expect(koshrcBusinessName("D.W. Wilburn and Denzel Belcher dba Masonry Men")).toBe("D.W. Wilburn");
    expect(koshrcBusinessName("Denzel Belcher dba Masonry Men")).toBe("");
    expect(koshrcBusinessName("Barmet of Kentucky Inc. and Edith Darlene Sallee, Administratix of the Estate of James Roland Sallee")).toBe("Barmet of Kentucky Inc.");
    expect(koshrcBusinessName("John Cleary and Son")).toBe("John Cleary and Son");
    expect(koshrcBusinessName("C and S Erectors")).toBe("C and S Erectors");
    expect(koshrcBusinessName("LOUISVILLE LUMBER AND MILLWORK, CO.")).toBe("LOUISVILLE LUMBER AND MILLWORK, CO.");
  });
});
