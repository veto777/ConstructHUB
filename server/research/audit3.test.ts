/**
 * Regression tests for the core fixes of the round-3 Codex audit (2026-10-15, decisions 1–13). Each would have caught
 * its finding. Cross-reference fixes are in audit3-xref.test.ts; pack-specific fixes in states/<st>.test.ts.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { EnforcementHit, LicenseHit, ResearchReport } from "@shared/research-reports";
import { reportSummary } from "@shared/research-reports";
import { adverseFrom } from "./adverse";
import { baselineOf, nextBaseline, readRow, shortfall, PAYLOAD_VERSION } from "./bulk";
import { flLegacyComplaint, flRespondent, parseCaDebarments } from "./bulk-sources";
import { privateHit, reportHit, standingStatus } from "./privacy";
import { PortalBlockedError, blockHost, guard, releaseHost, resetHostState, robotsFor } from "./http";
import { deniedMessage, namesMatch, personParts } from "./runner";

const lic = (o: Partial<LicenseHit>): LicenseHit => ({
  state: "FL", source: "Test board", sourceUrl: "https://example.test", businessName: null, licenseNumber: "CGC1", licenseType: "Certified General Contractor",
  specialty: null, status: null, principal: "JOHN SMITH", city: "TAMPA", expires: null, matchedOn: "principal", ...o,
});
const enf = (o: Partial<EnforcementHit>): EnforcementHit => ({
  state: "FL", source: "Test complaints", sourceUrl: "https://example.test", category: "complaint", name: null, id: "1", date: null, endDate: null,
  status: null, city: "TAMPA", detail: null, amount: null, adverse: null, ...o,
});

afterEach(() => { vi.restoreAllMocks(); resetHostState(); });

describe("decision 1: an individual's status keeps standing words only", () => {
  it("probation, 'disciplined' and pending cases come off the status and go to discipline", () => {
    // Round 7, finding 3: a qualified standing is no standing ("Status not stated").
    expect(standingStatus("Probation, Active")).toEqual({ status: null, moved: "Probation, Active" });
    expect(standingStatus("Disciplined")).toEqual({ status: null, moved: "Disciplined" });
    // Round 6, decision 8: a conditioned standing has none ("Status not stated").
    expect(standingStatus("Active - Pending Case")).toEqual({ status: null, moved: "Active - Pending Case" });
    expect(standingStatus("Active with Conditions")).toEqual({ status: null, moved: "Active with Conditions" });
    // Round 7, finding 3: only a complete recognized expression (and a date) stays.
    expect(standingStatus("Inactive per Request")).toEqual({ status: null, moved: "Inactive per Request" });
    expect(standingStatus("Null and Void")).toEqual({ status: "Null and Void", moved: null });
    expect(standingStatus("Revoked")).toEqual({ status: "Revoked", moved: null });
  });
  it("FL's primary status P on a qualifier's license: the report shows no status (round 7, finding 3) and no discipline", () => {
    const h = privateHit(lic({ status: "Probation, Active", holder: "individual" }));
    expect(h).toMatchObject({ status: null, discipline: "Probation, Active" });
    expect(reportHit(lic({ status: "Probation, Active", holder: "individual" }), "person")).toMatchObject({ status: null });
    expect(reportHit(lic({ status: "Probation, Active", holder: "individual" }), "person").discipline).toBeUndefined();
    // An unknown holder counts as an individual; a business's status stays as published.
    expect(privateHit(lic({ status: "Probation, Active", holder: null })).status).toBeNull();
    expect(privateHit(lic({ status: "Probation, Active", holder: "business" })).status).toBe("Probation, Active");
  });
});

describe("decision 2: FL respondents with a DBA", () => {
  it("an individual's DBA makes the record the DBA's; no DBA (or a placeholder, or their own name) leaves it out", () => {
    expect(flRespondent("SMITH, JOHN", ["D/B/A ACME ROOFING"])).toEqual({ name: "ACME ROOFING", business: "ACME ROOFING", dbaOnly: true });
    expect(flRespondent("SMITH, JOHN", ["N/A"])).toBeNull();
    expect(flRespondent("SMITH, JOHN", ["JOHN SMITH"])).toBeNull();
    expect(flRespondent("SMITH, JOHN", [])).toBeNull();
    expect(flRespondent("ACME ROOFING LLC", ["N/A"])).toEqual({ name: "ACME ROOFING LLC", business: "ACME ROOFING LLC", dbaOnly: false });
  });
});

describe("decision 4: every generation is sanitized at read time", () => {
  it("an old license row loses an individual's street, phone, disciplinary status and discipline", () => {
    const old = { k: "license" as const, h: lic({ status: "Disciplined", address: "1 Elm St, Tampa FL 33602", phone: "8135550100", discipline: "Board order 2020" }) };
    const r = readRow({}, old)!;
    expect(r.kind).toBe("license");
    expect(r.hit).toMatchObject({ status: null, address: "TAMPA FL 33602", phone: null });
    expect((r.hit as LicenseHit).discipline).toBeUndefined();
    // A business's row keeps its street and its discipline (the runner turns that into an enforcement record).
    const biz = readRow({}, { k: "license", h: lic({ holder: "business", address: "1 Elm St, Tampa FL 33602", discipline: "Fined" }), v: PAYLOAD_VERSION })!;
    expect(biz.hit).toMatchObject({ address: "1 Elm St, Tampa FL 33602", discipline: "Fined" });
  });
  it("an old enforcement row about an individual is dropped by the current rule; a current one is kept", () => {
    expect(readRow({}, { k: "enforcement", h: enf({ name: "JOHN SMITH" }) })).toBeNull();
    expect(readRow({}, { k: "enforcement", h: enf({ name: "ACME ROOFING LLC" }) })).not.toBeNull();
    expect(readRow({}, { k: "enforcement", h: enf({ name: "JOHN SMITH" }), v: PAYLOAD_VERSION })).not.toBeNull();
  });
  it("an old FL complaint is re-read by the respondent rule", () => {
    const src = { legacyEnforcement: flLegacyComplaint };
    // Round 4, decision 4: the stored DBA lost its marker, so an individual's old row is dropped until the file reloads.
    expect(readRow(src, { k: "enforcement", h: enf({ name: "SMITH, JOHN / ACME ROOFING", address: "1 Elm St, Tampa FL 33602" }) })).toBeNull();
    expect(readRow(src, { k: "enforcement", h: enf({ name: "RUSH, JOHN / N/A", address: "2 Oak St, Tampa FL 33602" }) })).toBeNull();
    expect(readRow(src, { k: "enforcement", h: enf({ name: "ACME LLC / N/A", address: "2 Oak St, Tampa FL 33602" }) })!.hit)
      .toMatchObject({ name: "ACME LLC", address: "2 Oak St, Tampa FL 33602" });
  });
});

describe("decision 5: HTTP", () => {
  it("a request waiting its turn is refused when the host denies access in the meantime", async () => {
    const url = "https://queue.example.test/a";
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response("", { status: 404 })); // robots.txt: none
    await guard(url, 50); // first request: its turn is held until released
    const second = guard("https://queue.example.test/b", 50);
    await new Promise((r) => setTimeout(r, 20));
    blockHost(url, 403, "HTTP 403"); // the first request's answer
    releaseHost(url);
    await expect(second).rejects.toBeInstanceOf(PortalBlockedError);
  });
  it("robots.txt redirects are followed by hand, each hop checked; a 403 is recorded against the host that answered", async () => {
    const calls: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input: any, init?: any) => {
      const u = String(input);
      calls.push(u);
      expect(init?.redirect).toBe("manual");
      if (u === "https://a.example.test/robots.txt") return new Response("", { status: 301, headers: { location: "https://b.example.test/robots.txt" } });
      if (u === "https://b.example.test/robots.txt") return new Response("<html><title>Attention Required! | Cloudflare</title></html>", { status: 403 });
      return new Response("", { status: 404 });
    });
    const r = await robotsFor("https://a.example.test");
    expect(r.denied).toBeTruthy();
    expect(calls).toEqual(["https://a.example.test/robots.txt", "https://b.example.test/robots.txt"]);
    // B answered 403: B is blocked, not A.
    await expect(guard("https://b.example.test/x", 10)).rejects.toBeInstanceOf(PortalBlockedError);
  });
  it("a plain 403 on robots.txt is no robots file and blocks nothing (RFC 9309)", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input: any) => String(input).endsWith("/robots.txt") ? new Response("Invalid URL", { status: 403 }) : new Response("ok"));
    const r = await robotsFor("https://arcgis.example.test");
    expect(r.denied).toBeUndefined();
    await expect(guard("https://arcgis.example.test/x", 10)).resolves.toBeTruthy();
  });
  it("a robots.txt redirect to an already blocked host is not sent", async () => {
    blockHost("https://c.example.test/", 403, "HTTP 403");
    const calls: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input: any) => {
      calls.push(String(input));
      return new Response("", { status: 302, headers: { location: "https://c.example.test/robots.txt" } });
    });
    const r = await robotsFor("https://d.example.test");
    expect(r.denied).toBeTruthy();
    expect(calls).toEqual(["https://d.example.test/robots.txt"]);
  });
  it("a robots.txt that redirects to another path on its own host is read there (mopro.mo.gov, 2026-10-15)", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input: any) => String(input) === "https://e.example.test/robots.txt"
      ? new Response("", { status: 301, headers: { location: "https://e.example.test/license/robots.txt" } })
      : new Response("User-agent: *\nDisallow: /private/\n", { status: 200, headers: { "content-type": "text/plain" } }));
    const r = await robotsFor("https://e.example.test");
    expect(r.denied).toBeUndefined();
    expect(r.rules).toEqual([{ allow: false, path: "/private/" }]);
  });
  it("a portal refused by robots.txt or an access denial is reported as not searched", () => {
    expect(deniedMessage("Error: robots.txt disallows x.gov/search for automated requests")).toMatch(/robots\.txt/);
    expect(deniedMessage("net::ERR_BLOCKED_BY_CLIENT at https://x.gov/")).toMatch(/refused/);
    expect(deniedMessage("Timed out after 75s")).toBeNull();
  });
});

describe("decision 6: adverse is null on negation or reversal on either side", () => {
  it("the audit's three examples", () => {
    expect(adverseFrom("Fine not imposed")).toBeNull();
    expect(adverseFrom("Case not dismissed")).toBeNull();
    expect(adverseFrom("Suspension lifted")).toBeNull();
  });
  it("other reversals and holds", () => {
    for (const t of ["Revocation rescinded", "Order reversed on appeal", "Penalty set aside", "Suspension stayed", "Citation vacated", "Penalty was never assessed"]) {
      expect([t, adverseFrom(t)]).toEqual([t, null]);
    }
    expect(adverseFrom("License revoked")).toBe(true);
    expect(adverseFrom("Complaint dismissed")).toBe(false);
  });
});

describe("decision 7: permit name fields are split into people", () => {
  it("two people in one field are never one match", () => {
    // Round 5, decision 4: a field that lists people gives no person match at all (no splitting).
    expect(personParts("Jane Smith and John Doe")).toEqual([]);
    expect(namesMatch("John Smith", { contractorName: "Jane Smith and John Doe" })).toBe(false);
    expect(namesMatch("John Smith", { applicantName: "Jane Smith & John Doe" })).toBe(false);
    expect(namesMatch("John Smith", { contractorName: "Jane Smith; John Doe" })).toBe(false);
    expect(namesMatch("John Smith", { contractorName: "Jane Smith / John Doe" })).toBe(false);
    expect(namesMatch("John Smith", { contractorName: "Jane Smith\nJohn Doe" })).toBe(false);
    // A field that still holds more than one name gives no match.
    expect(namesMatch("John Smith", { contractorName: "SMITH, JANE, DOE, JOHN" })).toBe(false);
    expect(namesMatch("John Smith", { contractorName: "Jane Smith John Doe Mary Roe" })).toBe(false);
    // One person per field still matches; a list of people does not, even when one of them is the subject.
    expect(namesMatch("John Smith", { contractorName: "John Smith and Jane Doe" })).toBe(false);
    expect(namesMatch("John Smith", { contractorName: "SMITH, JOHN" })).toBe(true);
  });
});

describe("decision 9: every count says when nothing behind it ran", () => {
  const report = (o: Partial<ResearchReport["subjects"][0]>, totals: Partial<ResearchReport["totals"]> = {}): ResearchReport => ({
    generatedAt: "2026-10-16", states: ["PA"], trades: [], sinceYear: null,
    subjects: [{ name: "Acme LLC", kind: "company", licenses: [], permits: [], licenseSources: [], portals: [], ...o }],
    totals: { licenses: 0, permits: 0, portalsSearched: 0, portalsNotSearched: 0, ...totals },
  });
  it("a person-only report doesn't say 0 consumer complaints", () => {
    const r = report({ kind: "person", recordSources: [{ source: "Complaints, lawsuits, enforcement and OSHA records", scope: "", searched: false, note: "companies only" }] },
      { complaints: 0, enforcement: 0, courtCases: 0, osha: 0 });
    expect(reportSummary(r)).toBe("Not searched: license records, permit portals, consumer complaints, state enforcement records, federal court cases and OSHA inspections.");
  });
  it("a state court source that ran doesn't stand in for federal courts", () => {
    const r = report({
      licenseSources: [{ state: "PA", source: "PA licenses", searched: true, note: "0" }],
      recordSources: [
        { source: "PA court cases (UJS portal)", scope: "PA", searched: true, note: "0 found", category: "state_court" },
        { source: "Federal court dockets (CourtListener)", scope: "All", searched: false, note: "off", category: "federal_court" },
      ],
    }, { complaints: 0, enforcement: 0, courtCases: 0, osha: 0 });
    expect(reportSummary(r)).toMatch(/^Found 0 license record\(s\) and 0 state enforcement or standing record\(s\)\. Not searched: .*federal court cases/);
  });
});

describe("decision 12: the 70% rule across a key-version change", () => {
  it("passing needs strictly more than 70%, overall and per component", () => {
    expect(shortfall(70, {}, { rows: 100 })).toBe("70 rows, baseline 100");
    expect(shortfall(71, {}, { rows: 100 })).toBeNull();
    expect(shortfall(100, { a: 93, b: 7 }, { rows: 100, components: { a: 90, b: 10 } })).toBe("b: 7 rows, baseline 10");
  });
  it("the baseline is the last full load: a key-format change doesn't reset it, a reduced load doesn't lower it", () => {
    const prev = { rows: 1000, loadedAt: "2026-10-14T10:00:00Z", facets: { components: { a: 900, b: 100 } } };
    expect(baselineOf(prev)).toEqual({ rows: 1000, components: { a: 900, b: 100 } });
    // A source whose row shape changed on purpose isn't compared with a load made under the older shape (round 4, decision 11).
    expect(baselineOf(prev, 1)).toBeNull();
    expect(baselineOf({ ...prev, rowShape: 1 }, 1)).not.toBeNull();
    const after = nextBaseline(750, { a: 700, b: 50 }, baselineOf(prev));
    expect(after).toEqual({ rows: 1000, components: { a: 900, b: 100 } });
    expect(baselineOf({ rows: 750, loadedAt: "2026-10-15T10:00:00Z", facets: { components: { a: 700, b: 50 }, baseline: after } })).toEqual(after);
    expect(nextBaseline(1200, { a: 1100, b: 100 }, after)).toEqual({ rows: 1200, components: { a: 1100, b: 100 } });
  });
});

describe("decision 13: two-digit years are not guessed", () => {
  it("a CA debarment written 9/13/24 keeps its text and has no normalized dates or outcome", () => {
    const html = `<table><tr><td>ACME CONSTRUCTION INC</td><td><strong>9/13/24 through 9/13/27</strong></td></tr></table>`;
    const [h] = parseCaDebarments(html, "2026-10-16");
    expect(h.hit).toMatchObject({ date: null, endDate: null, detail: "9/13/24 through 9/13/27", status: "Debarment (period as published)", adverse: null });
  });
});
