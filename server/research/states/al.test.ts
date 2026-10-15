import { describe, expect, it } from "vitest";
import { aecbBusiness, parseAecbText, parseAlDetail, parseAlList } from "./al";

// Snippets of licensesearch.alabama.gov pages saved 2026-10-15.
const LIST = `<table id="myDataTable"><thead><tr><th>NAME</th></tr></thead><tbody><tr><td>DUNN CONSTRUCTION CO INC</td><td>8</td><td>BIRMINGHAM</td><td>AL</td>
<td>BC: BUILDING CONSTRUCTION, MU: MUNICIPAL AND UTILITY</td><td>(205) 592-3866</td><td><a href="/genconbd/Details/1">Details</a></td></tr></tbody></table>`;
const DETAIL = `<input type="text" readonly class="form-control-plaintext" id="Address" value="P O  BOX 11967"><input type="text" readonly id="zip" value="35202">
<input type="text" readonly class="form-control-plaintext" id="bid" value="U UNLIMITED"><input type="text" readonly id="expire" value="9/30/2027">`;

describe("Alabama license lists", () => {
  it("reads list rows and detail links", () => {
    expect(parseAlList(LIST)).toEqual([{ cells: ["DUNN CONSTRUCTION CO INC", "8", "BIRMINGHAM", "AL", "BC: BUILDING CONSTRUCTION, MU: MUNICIPAL AND UTILITY", "(205) 592-3866", "Details"], person: "DUNN CONSTRUCTION CO INC", detail: "/genconbd/Details/1" }]);
  });
  it("reads detail fields", () => {
    expect(parseAlDetail(DETAIL)).toEqual({ Address: "P O BOX 11967", zip: "35202", bid: "U UNLIMITED", expire: "9/30/2027" });
  });
});

// Saved from aecb.alabama.gov ECB-2021-thru-2024-Disciplinary-Actions.pdf and 2015.pdf (pdftotext -layout), 2026-10-15.
const AECB_TABLE = "                                  FY 2021 through FY 2024\n                                 ECB DISCIPLINARY ACTIONS\n            CASE NO.                            RESPONDENT                     CITY & STATE   LICENSE NO.                                               VIOLATION(S)                                                   DATE OF ACTION                             DISPOSITION                                  FINE ASSESSED   PROBATION\n\nECB 2021-077           Boyce Allen Perry dba GES Enterprises                Jemison AL          04760       Pursuant to a complaint received by the Board, an investigation was conducted. The investigation             8/18/2021      Respondent issued Cease and Desist from using electrical license   $          500.00     None\n                                                                                                            revealed the Respondent allowed his license to be used by an unlicensed person to perform electrical                        for electrical work not performed by Respondent and/or\n                                                                                                            contracting work illegally in Alabama by selling an electrical permit. Ala. Code 1975 \u00a7\u00a7 34-36-6, 34-                       Respondent's W2 employees do not perform.\n                                                                                                            36-13, and 34-36-15 states: \"Knowingly combining or conspiring with any person by allowing one's\n                                 ECB DISCIPLINARY ACTIONS\n            CASE NO.                            RESPONDENT         CITY & STATE   LICENSE NO.                                                 VIOLATION(S)                                                   DATE OF ACTION                      DISPOSITION       FINE ASSESSED   PROBATION\n\nECB 2022-097           Lavell E. Brooks                         Montgomery AL        None       Pursuant to a complaint received by the Board, an investigation was conducted. The investigation               1/23/2023      Cease and Desist                 $        1,000.00     None\nECB 2023-082          Matthew Whitaker, Chief Executive Officer   Birmingham AL        None       Pursuant to a complaint received by the Board, an investigation was conducted. The investigation           7/17/2023      Cease and Desist                 $             -       None\n                      dba Evernest                                                                revealed the Respondent is practicing electrical contracting in the State of Alabama without being\n                                                                                                  properly licensed nor employs licensed Alabama electrical contractors to perform electrical\n                                                                                                  contracting. Ala. Code 1975 \u00a7\u00a7 34-36-13 and 34-36-15 states: \"No person shall engage in the\n                                                                                                  electrical contracting business or perform work as a master or journeyman electrician unless such\n                                                                                                  person shall have received a license from the board....\" \"Electrical contracting involves activities";
const AECB_2015 = "\nName: Bryan Bertona               Case #2015-038              Date: November 4, 2015\nDisposition: Respondent violated Ala. Code \u00a734-36-13 by performing electrical contracting in\nAlabama without being properly licensed. The Board issued a Cease and Desist letter to\nRespondent.\n\n\nName: Shane Payne                     Case #2015-037             Date: October 1, 2015\nDisposition: Respondent violated Ala. Code Code \u00a7\u00a734-36-13, 34-36-15 and 34-36-16(b) by\nperforming electrical contracting in Alabama without being properly licensed. The Board issued\na Cease and Desist letter to Respondent.\n\nName: Michael Royce Coggins         Case #2015-032               Date: October 1, 2015\ndba R & M Contractors\nDisposition: Respondent violated Ala. Code \u00a7\u00a734-36-13, 34-36-15 and 34-36-16(b) and Rule\n303-X-2-.10(2)(e) by performing electrical contracting in Alabama without being properly\nlicensed. The Board issued a Cease and Desist letter to Respondent.";

describe("Alabama Electrical Contractors Board discipline (PDF)", () => {
  it("reads the FY2021-FY2024 table: business, case, city, license, date, fine, wrapped respondent", () => {
    const rows = parseAecbText(AECB_TABLE);
    expect(rows.map((r) => r.business)).toEqual(["GES Enterprises", "Evernest"]);
    expect(rows[0]).toMatchObject({ caseNo: "ECB 2021-077", city: "Jemison AL", license: "04760", date: "2021-08-18", fine: 500 });
    expect(rows[0].disposition).toMatch(/^Respondent issued Cease and Desist from using electrical license for electrical work/);
    // "Matthew Whitaker, Chief Executive Officer" / "dba Evernest" on the next line: kept as the business, no fine.
    expect(rows[1]).toMatchObject({ caseNo: "ECB 2023-082", license: null, date: "2023-07-17", fine: null, disposition: "Cease and Desist" });
  });
  it("leaves out respondents named only as a person (Lavell E. Brooks), keeps dba businesses", () => {
    expect(parseAecbText(AECB_TABLE).some((r) => /Brooks/.test(r.business))).toBe(false);
    const y = parseAecbText(AECB_2015);
    expect(y.map((r) => r.business)).toContain("R & M Contractors");
    expect(y.some((r) => /Bertona|Payne/.test(r.business))).toBe(false);
    expect(y.find((r) => r.business === "R & M Contractors")).toMatchObject({ caseNo: "2015-032", date: "2015-10-01" });
  });
  it("finds the business in a dba name, and nothing in a person's name", () => {
    expect(aecbBusiness("Gregory T. Standberry dba Standberry Electric")).toBe("Standberry Electric");
    expect(aecbBusiness("Curtis Miller dbaC&M Home Improvement")).toBe("C&M Home Improvement");
    expect(aecbBusiness("JNB Services, LLC")).toBe("JNB Services, LLC");
    expect(aecbBusiness("DeShawn S. Goode c/o Goode Electric LLC")).toBeNull(); // c/o: a mailing address
    expect(aecbBusiness("Lavell E. Brooks")).toBeNull();
  });
});

describe("Alabama audit fixes (2026-10-15)", () => {
  it("a bare person's name with a surname that is also a trade word stays a person (audit example)", () => {
    expect(aecbBusiness("David Power")).toBeNull();
    expect(aecbBusiness("Joe Mason")).toBeNull();
    // Names from the PDFs above that are businesses.
    expect(aecbBusiness("Lovelady Electrical Contractors")).toBe("Lovelady Electrical Contractors");
    expect(aecbBusiness("Bunch Electrical Contractors LLC")).toBe("Bunch Electrical Contractors LLC");
  });
  it("searchBy says it can't search what the list doesn't carry (null, not an empty result)", async () => {
    const { searchAlGcBy, searchAlAowbBy } = await import("./al");
    expect(await searchAlGcBy({ type: "address", value: "100 Main St, Birmingham AL" })).toBeNull();
    expect(await searchAlAowbBy({ type: "phone", value: "(205) 592-3866" })).toBeNull();
    expect(await searchAlAowbBy({ type: "license", value: "AB-12" })).toBeNull();
  });
});

describe("Alabama names with case numbers glued on (the 2010-2020 lists, loaded 2026-10-15)", () => {
  it("strips the case number or date before deciding, so a person stays a person", () => {
    for (const n of ["Milton Bullock & 2020-021", "Dexter White Date: November13, 2019", "Danny Readout & 2019-063", "Larry Walker ; 2018-014; 2018-025; 2018-027; 2018-028", "Steven A. Pritchard & 046", "Jeffery Saffold and #2016-065"]) {
      expect(aecbBusiness(n)).toBeNull();
    }
    expect(aecbBusiness("Brad's Pool & Supply")).toBe("Brad's Pool & Supply");
  });
});

describe("Alabama round-2 audit (2026-10-16)", () => {
  it("each lookup declares the one kind of name it searches (decision 8)", async () => {
    const { pack } = await import("./al");
    expect(pack.liveLicenses!.map((l) => l.kinds)).toEqual([["company"], ["person"]]);
  });
  it("surname-like trade words and prefixes don't make a respondent a business (decision 3)", () => {
    expect(aecbBusiness("John Steel")).toBeNull();
    expect(aecbBusiness("Mark Roofner")).toBeNull();
    expect(aecbBusiness("Steel Roofing LLC")).toBe("Steel Roofing LLC");
  });
  it("a general contractor license is a business's; an installer license is the installer's own, whatever business it names (decision 2)", async () => {
    const { vi } = await import("vitest");
    const { resetHostState } = await import("../http");
    resetHostState();
    const rows = (n: number, cells: (i: number) => string[]) => `<table><tbody>${Array.from({ length: n }, (_, i) => `<tr>${cells(i).map((c) => `<td>${c}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
    const gc = rows(120, (i) => [i ? `OTHER ${i} INC` : "DUNN CONSTRUCTION CO INC", String(100 + i), "BIRMINGHAM", "AL", "BC", "(205) 592-3866"]);
    const aowb = rows(120, (i) => [i ? `DOE${i}, JOHN` : "SMITH, JANE Q", String(500 + i), "Basic", "1/1/2020", "Jefferson", ""]);
    vi.stubGlobal("fetch", vi.fn(async (u: string) => /robots\.txt$/.test(u) ? new Response("", { status: 404 }) : new Response(/AOWB/.test(u) ? aowb : gc, { status: 200 })));
    try {
      const { searchAlGc, searchAlAowb } = await import("./al");
      expect((await searchAlGc("Dunn Construction", "company"))[0]).toMatchObject({ businessName: "DUNN CONSTRUCTION CO INC", holder: "business" });
      expect((await searchAlAowb("Jane Smith", "person"))[0]).toMatchObject({ principal: "JANE Q SMITH", holder: "individual" });
    } finally { vi.unstubAllGlobals(); resetHostState(); }
  }, 20_000);
});
