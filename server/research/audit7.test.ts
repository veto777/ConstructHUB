/**
 * Codex round-7 audit (2026-10-15): each finding with Codex's failing input.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { PortalBlockedError, hostBlocked, resetHostState, robotsAllowed, robotsFor, setRobotsRetryMs } from "./http";
import { failureNote } from "./notes";
import { kyQuery } from "./states/ky";
import { nscbCompanyNames, nscbPersonFields } from "./states/nv";
import { RETIRED_BULK_SOURCES } from "./bulk";
import { ALL_BULK_SOURCES } from "./registry";
import type { EnforcementHit, LicenseHit, ResearchReport, ResearchSubjectReport } from "@shared/research-reports";
import { htmlLines } from "./person-name";
import { onePersonField, personMatches, wholeWordMatch } from "./licenses";
import { htmlPerson as g2Person } from "./states/lib/g2-aspnet";
import { htmlPerson as g3Person } from "./states/lib/g3-common";
import { htmlPerson as g4Person } from "./states/lib/g4-html";
import { htmlPerson as g6Person } from "./states/lib/g6-common";
import { parseMsDetail } from "./states/ms";
import { parseCbrDetails } from "./states/ut";
import { reportHit, standingStatus } from "./privacy";
import { shownReport, shownVia } from "./store";
import { licenseRef } from "./xref";

const lic = (o: Partial<LicenseHit>): LicenseHit => ({
  state: "NE", source: "Nebraska State Electrical Division", sourceUrl: "https://example.test/a", businessName: null, licenseNumber: "EC 03136",
  licenseType: "Electrical Contractor", specialty: null, status: "Active", principal: "JOHN SMITH", city: "OMAHA", expires: null, matchedOn: "principal", ...o,
});
const enf = (o: Partial<EnforcementHit>): EnforcementHit => ({
  state: "AZ", source: "x", sourceUrl: "https://example.test/c", category: "discipline", name: "ACME ROOFING LLC", id: "1", date: null, endDate: null,
  status: null, city: "Phoenix", detail: null, amount: null, adverse: null, ...o,
});
const subject = (kind: "person" | "company", o: Partial<ResearchSubjectReport>): ResearchSubjectReport =>
  ({ name: kind === "person" ? "John Smith" : "Acme Roofing", kind, licenses: [], permits: [], licenseSources: [], portals: [], ...o });
const report = (s: ResearchSubjectReport, snapshotVersion = 2): ResearchReport =>
  ({ snapshotVersion, generatedAt: "2026-10-15", states: ["NE"], trades: [], sinceYear: null, subjects: [s], totals: { licenses: 1, permits: 0, portalsSearched: 0, portalsNotSearched: 0 } });

describe("#1 HTML name cells keep block boundaries", () => {
  const cells = [
    "<div>Jane Smith</div><div>John Doe</div>",
    "<p>Jane Smith</p><p>John Doe</p>",
    "<ul><li>Jane Smith</li><li>John Doe</li></ul>",
    "<table><tr><td>Jane Smith</td></tr><tr><td>John Doe</td></tr></table>",
    "<span>Jane Smith</span><br/><span>John Doe</span>",
  ];
  it("Codex's input is a list in every g*-html helper, and gives no match", () => {
    for (const helper of [g2Person, g3Person, g4Person, g6Person]) {
      for (const c of cells) {
        const v = helper(c)!;
        expect(v, c).toBe("Jane Smith / John Doe");
        expect(onePersonField(v), c).toBe(false);
        expect(personMatches("John Smith", v), c).toBe(false);
      }
    }
  });
  it("one person in inline markup or blocks is still one person", () => {
    expect(g4Person("<div><b>John</b> <i>Smith</i></div>")).toBe("John Smith");
    expect(g4Person("<td>\n  <div>  SMITH, JOHN  </div>\n</td>")).toBe("SMITH, JOHN");
    expect(personMatches("John Smith", g4Person("<div><span>John</span> Smith</div>"))).toBe(true);
    expect(htmlLines("a<DIV class='x'>b</DIV>c")).toBe("a\nb\nc");
  });
  it("MS officers and qualifiers: a cell with two people matches neither as one person", () => {
    const html = `<b>Class(es)</b><table><tr><td>Classification</td><td>Qualifier</td></tr><tr><td>Building</td><td><div>Jane Smith</div><div>John Doe</div></td></tr></table>`
      + `<b>Officers</b><table><tr><td>Name</td><td>Title</td></tr><tr><td><div>Jane Smith</div><div>John Doe</div></td><td>Officer</td></tr></table>`;
    const d = parseMsDetail(html);
    expect(d.officers[0].name).toBe("Jane Smith / John Doe");
    expect(d.classes[0].qualifier).toBe("Jane Smith / John Doe");
    const h = lic({ principal: d.classes[0].qualifier, people: d.officers.map((o) => ({ name: o.name, role: o.title })) });
    expect(wholeWordMatch("John Smith", h)).toBe(false);
  });
  it("UT's qualifier with block-separated names stays a list", () => {
    const d = parseCbrDetails(`<div>Qualifier Information</div>Name: <i><div>Jane Smith</div><div>John Doe</div></i>`);
    expect(d.qualifier).toBe("Jane Smith / John Doe");
  });
});

describe("#2 relationship prose is rebuilt from the subject's records", () => {
  const via = "same address as license EC 03136, 123 Main St, Omaha NE 68102";
  it("Codex's input: a license number with a space, a person subject → no street", () => {
    const own = lic({ holder: "individual", address: "123 Main St, Omaha NE 68102" });
    const s = subject("person", { licenses: [own], relatedLicenses: [lic({ licenseNumber: "EC 9", relatedTie: "address", relatedVia: via })] });
    const shown = shownReport(report(s))!;
    expect(shown.subjects[0].relatedLicenses![0].relatedVia).toBe("same address as license EC 03136");
    expect(JSON.stringify(shown)).not.toMatch(/Main St/);
    expect(shownVia(via, [{ ref: "license EC 03136", shown: new Set() }], true)).toBe("same address as license EC 03136");
  });
  it("AZ's ROC 128499 phone, also inside an enforcement record's explanation", () => {
    const own = lic({ state: "AZ", licenseNumber: "ROC 128499", holder: null, businessName: "ACME ROOFING LLC", principal: null, phone: "(602) 555-0100" });
    const tied = `a record of ACME HOLDINGS LLC, which is tied to this name: same phone as license ROC 128499, (602) 555-0100`;
    const s = subject("company", { licenses: [own], relatedEnforcement: [enf({ relatedTie: "phone", relatedVia: tied })] });
    const shown = shownReport(report(s, 3))!;
    // The holder is unknown, so the license shows no phone and the prose names none.
    expect(shown.subjects[0].relatedEnforcement![0].relatedVia).toBe("a record of ACME HOLDINGS LLC, which is tied to this name: same phone as license ROC 128499");
  });
  it("a business's own phone or street the report shows may be named, on that record only", () => {
    const own = lic({ holder: "business", businessName: "ACME ELECTRIC LLC", address: "123 Main St, Omaha NE 68102" });
    const other = lic({ holder: "business", licenseNumber: "EC 1", businessName: "ACME ELECTRIC LLC", address: "9 Elm St, Omaha NE 68102" });
    const s = subject("company", { licenses: [own, other], relatedLicenses: [lic({ licenseNumber: "EC 9", relatedTie: "address", relatedVia: `${via}; same address as license EC 1, 123 Main St, Omaha NE 68102` })] });
    expect(shownReport(report(s, 3))!.subjects[0].relatedLicenses![0].relatedVia).toBe(`${via}; same address as license EC 1`);
  });
  it("a reference that isn't one of the subject's records names no record or value; the customer's own stays", () => {
    const refs = [{ ref: licenseRef(lic({})), shown: new Set(["123MAINSTOMAHANE68102"]) }];
    expect(shownVia("same address as license XY 1, 123 Main St, Omaha NE", refs, false)).toBe("same address as another of the subject's records");
    expect(shownVia("same phone as license EC 03136", refs, true)).toBe("same phone as license EC 03136");
    expect(shownVia("matched by the address you gave (123 Main St)", refs, true)).toBe("matched by the address you gave (123 Main St)");
    expect(shownVia("JOHN SMITH (qualifier) is named on both this license and license EC 03136", refs, true)).toBe("JOHN SMITH (qualifier) is named on both this license and license EC 03136");
  });
});

describe("#3 standing: complete recognized expressions only", () => {
  it("Codex's input is null and shows as not stated", () => {
    expect(standingStatus("Active - contingent upon board approval")).toEqual({ status: null, moved: "Active - contingent upon board approval" });
    expect(reportHit(lic({ holder: "individual", status: "Active - contingent upon board approval" }), "person").status).toBeNull();
  });
  it("any unrecognized qualification is null; recognized expressions and dates stay", () => {
    for (const t of ["Active, contingent", "Active (awaiting bond)", "Active - Probation", "Expired - Enforcement", "CLEAR; 7073E Probation", "Active w/ restrictions", "Active per board"])
      expect(standingStatus(t).status, t).toBeNull();
    expect(standingStatus("Active").status).toBe("Active");
    expect(standingStatus("Expired 2024-05-01").status).toBe("Expired 2024-05-01");
    expect(standingStatus("Active until 01/31/2027").status).toBe("Active until 01/31/2027");
    expect(standingStatus("Current, Inactive").status).toBe("Current, Inactive");
    expect(standingStatus("Active (on the Secretary of State's list of active entities)").status).toBe("Active");
    expect(standingStatus("C - Current, Valid & In Good Standing (current-license report of 2026-04-06)").status).toBe("Current, Valid & In Good Standing");
    expect(standingStatus("License status: Revoked").status).toBe("Revoked");
  });
});

describe("acceptance: a robots.txt that fails once is read again before the host is refused", () => {
  afterEach(() => { vi.restoreAllMocks(); resetHostState(); });
  const robotsSeq = (answers: (() => Response)[]) => {
    let n = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input: any) => {
      const u = new URL(String(input));
      if (u.pathname !== "/robots.txt") throw new Error(`unexpected fetch ${u}`);
      const a = answers[Math.min(n++, answers.length - 1)];
      return a();
    });
    return () => n;
  };
  it("a network failure, then 200: allowed (data.mo.gov in the acceptance run)", async () => {
    setRobotsRetryMs([0, 0]);
    const count = robotsSeq([() => { throw new TypeError("fetch failed"); }, () => new Response("User-agent: *\nDisallow: /private\n", { status: 200 })]);
    expect(await robotsAllowed("https://data.test/resource/x.json")).toBe(true);
    expect(await robotsAllowed("https://data.test/private/x")).toBe(false);
    expect(count()).toBe(2);
    expect(hostBlocked("https://data.test/")).toBeNull();
  }, 15_000);
  it("a 5xx on every try still refuses (RFC 9309), after the retries", async () => {
    setRobotsRetryMs([0, 0]);
    const count = robotsSeq([() => new Response("oops", { status: 500 })]);
    const r = await robotsFor("https://down.test");
    expect(r.denied).toBe("robots.txt answered HTTP 500");
    expect(count()).toBe(3);
  }, 15_000);
  it("a challenge or a 4xx is not retried", async () => {
    setRobotsRetryMs([0, 0]);
    const count = robotsSeq([() => new Response("<html><title>Just a moment...</title>cf-chl</html>", { status: 503, headers: { "content-type": "text/html" } })]);
    expect((await robotsFor("https://cf.test")).denied).toBeTruthy();
    expect(count()).toBe(1);
    const four = robotsSeq([() => new Response("", { status: 404 })]);
    expect((await robotsFor("https://none.test")).denied).toBeUndefined();
    expect(four()).toBe(1);
  }, 15_000);
});

describe("acceptance: the customer's wording for a refused site, and the query forms the lookups take", () => {
  it("AL and WV (robots.txt 500), MS (a challenge) read 'the site refused automated access'", () => {
    expect(failureNote(new PortalBlockedError("https://licensesearch.alabama.gov/x", 0, "licensesearch.alabama.gov: robots.txt answered HTTP 500; no automated requests until it can be read")))
      .toBe("Not searched: the site refused automated access");
    expect(failureNote(new PortalBlockedError("https://search.msboc.us/x", 200, "search.msboc.us answered with a bot challenge page; no automated requests to it for this run")))
      .toBe("Not searched: the site refused automated access");
    expect(failureNote(new PortalBlockedError("https://x.test/a", 0, "robots.txt disallows x.test/a for automated requests"))).toBe("Not searched: the site's robots.txt does not allow automated searches");
    expect(failureNote(new Error("HBC search returned HTTP 500"))).toBe("Could not search: HBC search returned HTTP 500");
  });
  it("KY: a person's query leaves out the middle initial and suffix; a company's is as typed", () => {
    expect(kyQuery("Harrison E Durham-Smith", "person")).toBe("Harrison Durham-Smith");
    expect(kyQuery("John A. Smith Jr.", "person")).toBe("John Smith");
    expect(kyQuery("A B C Electric LLC", "company")).toBe("A B C Electric LLC");
  });
  it("NV: a dba name is searched as each of its names; the person fields skip initials and suffixes", () => {
    expect(nscbCompanyNames("CONSTRUCTION DEVELOPMENT SERVICES INC dba SILVER STATE MASONRY")).toEqual(["CONSTRUCTION DEVELOPMENT SERVICES INC", "SILVER STATE MASONRY"]);
    expect(nscbCompanyNames("ACME LLC")).toEqual(["ACME LLC"]);
    expect(nscbPersonFields("Kimberly A Hill")).toEqual({ first: "Kimberly", last: "Hill" });
    expect(nscbPersonFields("John Smith Jr")).toEqual({ first: "John", last: "Smith" });
  });
  it("retired sources are not registered (their rows are deleted at boot)", () => {
    const ids = new Set(ALL_BULK_SOURCES.map((s) => s.id));
    for (const id of RETIRED_BULK_SOURCES) expect(ids.has(id), id).toBe(false);
  });
});
