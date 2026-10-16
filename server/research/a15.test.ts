/**
 * Codex round-8 audit (2026-10-16): each finding with Codex's failing input.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import type { EnforcementHit, LicenseHit, ResearchReport, ResearchSubjectReport } from "@shared/research-reports";
import { looksLikeBusiness } from "./states/lib/business-name";
import { delinquentHits, sdLegacyLien } from "./states/sd";
import { headedTable, ustHits } from "./states/me";
import { asbestosHit, asbestosRows } from "./states/mt";
import { personMatches } from "./licenses";
import { liveFinder } from "./runner";
import { WITHDRAWN_REPORT_SOURCES } from "./bulk";
import { WITHDRAWN_NOTE, shownReport } from "./store";
import { standingStatus } from "./privacy";
import { opifPicks, type OpifRow } from "./states/oh";
import { verifyPage } from "./states/tn";
import { failureNote } from "./notes";
import { recall } from "../../script/research-acceptance/recall";
import type { Golden } from "../../script/research-acceptance/pick";

const lic = (o: Partial<LicenseHit>): LicenseHit => ({
  state: "CO", source: "Colorado DORA licenses (electrical, plumbing, water well)", sourceUrl: "https://example.test/a", businessName: "EAGLE ELECTRIC CO.",
  licenseNumber: "1750", licenseType: "EC", specialty: null, status: "Active", principal: null, city: "DENVER", expires: null, matchedOn: "business", ...o,
});
const enf = (o: Partial<EnforcementHit>): EnforcementHit => ({
  state: "SD", source: "South Dakota Department of Revenue business tax delinquent report", sourceUrl: "https://example.test/c", category: "tax_lien",
  name: "ACME ROOFING INC", id: null, date: null, endDate: null, status: null, city: "Pierre, SD", detail: null, amount: 1, adverse: true, ...o,
});
const subject = (o: Partial<ResearchSubjectReport>): ResearchSubjectReport => ({ name: "Acme", kind: "company", licenses: [], permits: [], licenseSources: [], portals: [], ...o });
const report = (s: ResearchSubjectReport, snapshotVersion = 3): ResearchReport =>
  ({ snapshotVersion, generatedAt: "2026-10-15", states: ["SD"], trades: [], sinceYear: null, subjects: [s], totals: { licenses: 0, permits: 0, portalsSearched: 0, portalsNotSearched: 0, enforcement: 1 } });

describe("#1 SD: a person's lien stays a person's, whatever the DBA", () => {
  it("Codex's input: JOHN BROTHERS dba BROTHERS PLUMBING gives no row", () => {
    expect(looksLikeBusiness("JOHN BROTHERS")).toBe(false);
    expect(looksLikeBusiness("SMITH & BROTHERS")).toBe(true);
    expect(looksLikeBusiness("BROTHERS PLUMBING")).toBe(true); // a trade word, still a business name
    const row = { owner: "JOHN BROTHERS", dba: "BROTHERS PLUMBING", address: "12 Elm St", city: "Pierre", st: "SD", tax: 100, interest: 0, penalty: 0, total: 100 };
    expect(delinquentHits(row, "2026-09-15")).toEqual([]);
    expect(delinquentHits({ ...row, owner: "BROTHERS PLUMBING INC" }, "2026-09-15").length).toBeGreaterThan(0);
  });
  it("stored rows and saved reports are checked again", () => {
    expect(sdLegacyLien(enf({ name: "JOHN BROTHERS dba BROTHERS PLUMBING" }))).toBeNull();
    expect(sdLegacyLien(enf({ name: "ACME ROOFING INC" }))).not.toBeNull();
    const shown = shownReport(report(subject({ enforcement: [enf({ name: "JOHN BROTHERS dba BROTHERS PLUMBING" }), enf({})] }), 3))!;
    expect(shown.subjects[0].enforcement!.map((e) => e.name)).toEqual(["ACME ROOFING INC"]);
  });
});

describe("#2 ME and MT person cells keep block boundaries", () => {
  const cell = "<div>Jane Smith</div><div>John Doe</div>";
  it("Maine: a tank-installer Name cell with two people is a list and matches neither", () => {
    const html = `<table><tr><th>Name</th><th>Company</th><th>Town</th><th>Phone</th></tr><tr><td>${cell}</td><td>Acme Oil</td><td>Bangor</td><td>(207) 555-0100</td></tr></table>`;
    expect(headedTable(html, ["Name", "Company", "Town", "Phone"], { person: ["Name"] })[0].Name).toBe("Jane Smith / John Doe");
    const [h] = ustHits(html);
    expect(personMatches("John Smith", h.principal)).toBe(false);
  });
  it("Montana: a permittee cell with two people is a list and matches neither", () => {
    const html = `<table><tr><th>Permittee</th><th>City</th><th>State</th><th>Zip</th><th>Expire Date</th><th>Type</th><th>Permit</th></tr>`
      + `<tr><td>${cell}</td><td>Helena</td><td>MT</td><td>59601</td><td>01/01/2027</td><td>WK</td><td>123</td></tr></table>`;
    const [r] = asbestosRows(html);
    expect(r.permittee).toBe("Jane Smith / John Doe");
    const hit = asbestosHit(r)!.hit as LicenseHit;
    expect(personMatches("John Smith", hit.principal)).toBe(false);
  });
});

describe("#3 NV: the runner keeps each searched dba name's results", () => {
  const name = "CONSTRUCTION DEVELOPMENT SERVICES INC dba SILVER STATE MASONRY";
  const hits = [
    lic({ state: "NV", source: "Nevada State Contractors Board licenses", businessName: "CONSTRUCTION DEVELOPMENT SERVICES INC", licenseNumber: "0067979" }),
    lic({ state: "NV", source: "Nevada State Contractors Board licenses", businessName: "SILVER STATE MASONRY", licenseNumber: "0022791" }),
    lic({ state: "NV", source: "Nevada State Contractors Board licenses", businessName: "GOLDEN STATE MASONRY LLC", licenseNumber: "1" }),
  ];
  it("Codex's input through liveFinder: both names kept, an unrelated business not", async () => {
    const finder = liveFinder("NV", { source: "Nevada State Contractors Board licenses", sourceUrl: "https://example.test", search: async () => hits });
    const r = await finder.byName!(name, "company");
    expect(r.hits.map((h) => h.licenseNumber)).toEqual(["0067979", "0022791"]);
  });
});

describe("#4 saved reports drop withdrawn sources' records", () => {
  it("an old report's WI DHS licenses and SC DES orders are gone, with the line; totals recounted", () => {
    const s = subject({
      licenses: [lic({ state: "WI", source: "Wisconsin DHS certified asbestos companies" }), lic({})],
      licenseSources: [{ state: "WI", source: "Wisconsin DHS certified lead and asbestos companies", searched: true, note: "1 match(es)" }, { state: "CO", source: "Colorado DORA licenses (electrical, plumbing, water well)", searched: true, note: "1 match(es)" }],
      enforcement: [enf({ state: "SC", source: "South Carolina DES environmental enforcement orders", category: "environmental", name: "ACME LLC" })],
      recordSources: [{ source: "South Carolina DES environmental enforcement orders", scope: "SC", searched: true, note: "1 record(s)", category: "enforcement" }],
    });
    const shown = shownReport(report(s, 4))!;
    const out = shown.subjects[0];
    expect(out.licenses.map((h) => h.source)).toEqual(["Colorado DORA licenses (electrical, plumbing, water well)"]);
    expect(out.licenseSources.map((x) => x.source)).toEqual(["Colorado DORA licenses (electrical, plumbing, water well)"]);
    expect(out.enforcement).toEqual([]);
    expect(out.recordSources).toEqual([]);
    expect(out.withdrawnNote).toBe(WITHDRAWN_NOTE);
    expect(shown.totals.licenses).toBe(1);
    expect(shown.totals.enforcement).toBe(0);
    expect(shownReport(report(subject({ licenses: [lic({})] }), 4))!.subjects[0].withdrawnNote).toBeUndefined();
    for (const l of ["Alaska DCCED business licenses", "WV Purchasing Division debarred vendors", "Pittsburgh PLI trade licenses"]) expect(WITHDRAWN_REPORT_SOURCES.has(l), l).toBe(true);
  });
});

describe("#5 standing: no broad attribution exception", () => {
  it("Codex's input is null; our own exact attributions still drop out", () => {
    expect(standingStatus("Active (on the board's list pending disciplinary review)")).toEqual({ status: null, moved: "Active (on the board's list pending disciplinary review)" });
    expect(standingStatus("Active (on the Secretary of State's list of active entities)").status).toBe("Active");
    expect(standingStatus("Current (on DPOR's regulant list)").status).toBe("Current");
    expect(standingStatus("Active (on the list of revoked licenses)").status).toBeNull();
  });
});

describe("#6 OH: each issue of a case is kept", () => {
  it("Codex's fixture: PIF 10001171 with issues 1170 and 2328 gives two records", () => {
    const row = (issueId: string): OpifRow => ({ issueId, pif: "10001171", caseName: "Daniels v. True; Acme Heating and Construction", supplier: "Acme Heating and Construction", caseNumber: "86 CV 39690" });
    expect(opifPicks([row("1170"), row("2328"), row("2328")], "Acme Heating and Construction").map((p) => p.row.issueId)).toEqual(["1170", "2328"]);
  });
});

describe("#7 an unreadable answer is not searched, never 0", () => {
  it("TN: an error body or a missing count is unreadable; a real zero is zero", () => {
    expect(() => verifyPage({ error: "Search unavailable" }, 0)).toThrow(/unreadable page/);
    expect(() => verifyPage({ resultCount: 5, results: [] }, 0)).toThrow(/unreadable page/);
    expect(() => verifyPage({ results: [] }, 0)).toThrow(/unreadable page/);
    expect(verifyPage({ resultCount: 0, results: null }, 0)).toEqual([]);
    expect(verifyPage({ resultCount: 0, results: [] }, 0)).toEqual([]);
    expect(failureNote(new Error("TN Commerce & Insurance license search: the source answered with an unreadable page"))).toBe("Not searched: the source answered with an unreadable page");
  });
  it("ME: a header-only table, a row with an extra cell, or a near-empty list is an error", () => {
    const head = "<table><tr><th>Name</th><th>Company</th><th>Town</th><th>Phone</th></tr>";
    expect(() => headedTable(`${head}</table>`, ["Name", "Company", "Town", "Phone"])).toThrow(/only 0 rows/);
    expect(() => headedTable(`${head}<tr><td>a</td><td>b</td><td>c</td><td>d</td><td>e</td></tr></table>`, ["Name", "Company", "Town", "Phone"])).toThrow(/5 cells/);
    expect(() => headedTable(`${head}<tr><td>a</td><td>b</td><td>c</td><td>d</td></tr></table>`, ["Name", "Company", "Town", "Phone"], { minRows: 45 })).toThrow(/at least 45/);
  });
});

describe("#8 acceptance recall matches the golden record's own source and id", () => {
  const golden: Golden = {
    role: "company", name: "Eagle Electric Co.", kind: "company", source: "Colorado DORA licenses (electrical, plumbing, water well)", sourceId: "x", from: "test",
    recordId: "1750", picked: "2026-10-16",
    expected: { kind: "license", source: "Colorado DORA licenses (electrical, plumbing, water well)", licenseNumber: "1750", businessName: "EAGLE ELECTRIC CO.", matchedOn: "business" },
  } as Golden;
  it("Codex's input: another board's license 1750 is not the golden record", () => {
    const other = lic({ source: "Colorado DORA licenses (architects, engineers, surveyors, landscape architects, radon; trade work permits)" });
    expect(recall(golden, subject({ licenses: [other] })).found).toBe(false);
    expect(recall(golden, subject({ licenses: [lic({ businessName: "SOMEONE ELSE LLC" })] })).found).toBe(false);
    expect(recall(golden, subject({ licenses: [lic({})] })).found).toBe(true);
  });
  it("enforcement: the same source and id", () => {
    const g = { ...golden, role: "enforcement", expected: { kind: "enforcement", source: "Colorado DORA discipline of electrical, plumbing and water well contractors", id: "1999-1", name: "Eagle Electric Co.", category: "discipline" } } as Golden;
    const e = (o: Partial<EnforcementHit>) => enf({ state: "CO", source: "Colorado DORA discipline of electrical, plumbing and water well contractors", category: "discipline", name: "Eagle Electric Co.", id: "1999-1", ...o });
    expect(recall(g, subject({ enforcement: [e({ source: "Another source" })] })).found).toBe(false);
    expect(recall(g, subject({ enforcement: [e({ id: "2000-2" })] })).found).toBe(false);
    expect(recall(g, subject({ enforcement: [e({})] })).found).toBe(true);
  });
});

describe("appraisers: the Roseau County, MN link is the office page, not a challenge redirect", () => {
  it("no stored link points at a bot-challenge host", () => {
    const text = readFileSync("server/data/appraisers.json", "utf8");
    expect(text).not.toMatch(/perfdrive|shieldsquare/i);
    const rows = JSON.parse(text) as { stateCode: string; county: string; portalUrl: string | null }[];
    expect(rows.find((r) => r.stateCode === "MN" && r.county === "Roseau")!.portalUrl).toBe("https://roseaucountymn.gov/offices/assessor/index.php");
  });
});

describe("acceptance: PA UJS sends the latest filing date the portal itself accepts", () => {
  it("the form's own FiledEndDate maximum, not today's UTC date (refused after 8 p.m. Eastern)", async () => {
    const { ujsEndDate } = await import("./states/pa");
    const form = `<input data-aopc-custom-validity="Date Filed End Date must be less than 10/15/2026 12:00:00 AM" data-aopc-defaultMax="2026-10-15" data-aopc-defaultMin="1899-01-01" name="FiledEndDate" type="text">`;
    expect(ujsEndDate(form, new Date("2026-10-16T01:30:00Z"))).toBe("2026-10-15");
    expect(ujsEndDate("<form></form>", new Date("2026-10-16T01:30:00Z"))).toBe("2026-10-15"); // fallback: yesterday UTC
  });
});
