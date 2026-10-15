/**
 * Regression tests for the core fixes of the 2026-10-15 Codex + Kimi audit (each would have caught its finding).
 * Pack-specific fixes are tested in states/<st>.test.ts.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LicenseHit } from "@shared/research-reports";
import { adverseFrom, hasEnded } from "./adverse";
import { csvRows, rowKeys, usDate } from "./bulk";
import { addressKeys, addressMatches, localityOf, streetKey } from "./identifiers";
import { companyNamed, nameClause, personMatches, wholeWordMatch } from "./licenses";
import { capNote, escapeRegExp, noteOf, safeDecode, withNote } from "./notes";
import { privateHit } from "./privacy";
import { parseRobots, retryAfterMs, robotsAllows } from "./http";
import { parseTdlrOrders } from "./state-records";
import { hasStateCourtSearch } from "./registry";
import { namesMatch } from "./runner";

const lic = (o: Partial<LicenseHit>): LicenseHit => ({
  state: "VT", source: "Test", sourceUrl: "https://example.test", businessName: null, licenseNumber: "EM-1234", licenseType: null,
  specialty: null, status: null, principal: null, city: null, expires: null, matchedOn: "principal", ...o,
});

describe("adverse comes only from the outcome text (decision 2)", () => {
  it("unknown is null, dismissals are false before any adverse word, ended sanctions are false", () => {
    expect(adverseFrom(null)).toBeNull();
    expect(adverseFrom("")).toBeNull();
    expect(adverseFrom("Hearing held")).toBeNull();
    // Round 2, decision 4: a negated sanction is not a clean answer.
    expect(adverseFrom("Dismissed, no penalty imposed")).toBeNull();
    expect(adverseFrom("No civil penalty")).toBeNull();
    expect(adverseFrom("Dismissed")).toBe(false);
    expect(adverseFrom("Withdrawn by the department")).toBe(false);
    expect(adverseFrom("Vacated on appeal")).toBe(false);
    expect(adverseFrom("License revoked")).toBe(true);
    expect(adverseFrom("Administrative penalty of $500")).toBe(true);
    expect(adverseFrom("Debarred", { ended: true })).toBe(false);
    expect(hasEnded("2015-06-30", "2026-10-15")).toBe(true);
    expect(hasEnded("2027-06-30", "2026-10-15")).toBe(false);
    expect(hasEnded(null, "2026-10-15")).toBe(false);
  });
  it("TDLR orders: adverse from the order's own words, the amount only when the text calls it a penalty", () => {
    const row = (order: string) => `<p>1 records found.</p><table><tr style="background:#dedede;"> <td> <span class="default_text">Company:</span> <span class="results_text">ACME AIR LLC</span><br /></td> <td><span class="default_text">Date:</span> <span class="results_text">7/24/2025</span><br /><br />${order}</td> <td>Basis.</td></tr></table>`;
    expect(parseTdlrOrders(row("Respondent is assessed an administrative penalty in the amount of $4,000."))[0]).toMatchObject({ adverse: true, amount: 4000 });
    expect(parseTdlrOrders(row("The case is dismissed."))[0]).toMatchObject({ adverse: false, amount: null });
    expect(parseTdlrOrders(row("Respondent shall pay restitution of $1,200 to the consumer."))[0]).toMatchObject({ amount: null });
    expect(parseTdlrOrders(row("Agreed order."))[0].adverse).toBeNull();
  });
});

describe("matching keeps single letters and one person per name (decision 6)", () => {
  it("D & S is not A & B; John A Smith is not John B Smith", () => {
    expect(companyNamed("D & S Electric", "A & B ELECTRIC INC")).toBe(false);
    expect(companyNamed("D & S Electric", "D&S ELECTRIC INC")).toBe(true);
    expect(personMatches("John A Smith", "SMITH, JOHN B")).toBe(false);
    expect(personMatches("John A Smith", "JOHN ALAN SMITH")).toBe(true);
    expect(personMatches("John A Smith", "JOHN SMITH")).toBe(true); // only one side gives an initial
    expect(personMatches("John Smith", "JOHN SMITH JR")).toBe(true);
  });
  it("a person must match one name, not words of the business and the RMI together (OR CCB)", () => {
    expect(wholeWordMatch("John Smith", { businessName: "SMITH CONSTRUCTION LLC", principal: "JOHN JONES" })).toBe(false);
    expect(wholeWordMatch("John Smith", { businessName: null, principal: "JANE DOE", people: [{ name: "JOHN SMITH", role: null }] })).toBe(true);
    // OR CCB's name search: all words in full_name, or all in rmi_name, never split between them.
    expect(nameClause({ anyOf: ["full_name", "rmi_name"] }, "John Smith")).toBe("((upper(full_name) like '%JOHN%' AND upper(full_name) like '%SMITH%') OR (upper(rmi_name) like '%JOHN%' AND upper(rmi_name) like '%SMITH%'))");
  });
  it("addresses: whole street, suffix, direction, city and ZIP must agree", () => {
    expect(addressMatches("123 N Main Street", "123 S Main Avenue")).toBe(false);
    expect(addressMatches("123 Lake View Road", "123 Lake Forest Drive")).toBe(false);
    expect(addressMatches("123 Palm Ave", "123 Palm Ct")).toBe(false);
    expect(addressMatches("123 Main St, Seattle", "123 MAIN ST TACOMA WA")).toBe(false);
    expect(addressMatches("123 Main Street 98101", "123 N MAIN ST SEATTLE WA 98101-2222")).toBe(true);
    expect(addressMatches("123 Main St", "123 MAIN STREET STE 200")).toBe(true);
    expect(streetKey("123 N. Main St., Ste 4, Seattle WA 98101")).toBe("123 N MAIN ST");
    expect(localityOf("123 N. Main St., Ste 4, Seattle WA 98101")).toBe("SEATTLE WA 98101");
    // The index key stays house number + first street word (old rows keep working); addressMatches decides.
    expect(addressKeys("123 Lake View Road")).toEqual(["a:123 LAKE"]);
    // A full state name is the state, not part of the city (NE files write "OSHKOSH, Nebraska 69154").
    expect(addressMatches("17998 Rd 52, Oshkosh NE 69154", "17998 RD 52, OSHKOSH, Nebraska 69154")).toBe(true);
  });
});

describe("home addresses (decision 4)", () => {
  it("an individual's license keeps city, state and ZIP only", () => {
    const h = privateHit(lic({ principal: "JANE DOE", address: "12 Elm St, Burlington VT 05401", phone: "802-555-0100", city: "BURLINGTON" }));
    expect(h.address).toBe("BURLINGTON VT 05401");
    expect(h.phone).toBeNull();
    const biz = privateHit(lic({ businessName: "ACME ELECTRIC LLC", holder: "business", address: "12 Elm St, Burlington VT 05401", phone: "802-555-0100" }));
    expect(biz.address).toBe("12 Elm St, Burlington VT 05401");
  });
  it("an individual's bulk row is never indexed by home phone or street; a business row gets its own keys even without `keys`", () => {
    const person = rowKeys({ kind: "license", hit: lic({ principal: "JANE DOE", address: "12 Elm St 05401", phone: "8025550100" }), business: null, person: "JANE DOE", keys: { phones: ["8025550100"], addresses: ["12 Elm St"] } });
    expect(person.keys).toEqual({ licenses: ["EM-1234"] });
    expect(person.hit.phone).toBeNull();
    const biz = rowKeys({ kind: "license", hit: lic({ businessName: "ACME LLC", holder: "business", licenseNumber: "CGC1512345", phone: "8135550101" }), business: "ACME LLC", person: null });
    expect(biz.keys?.licenses).toContain("CGC1512345");
    expect(biz.keys?.phones).toContain("8135550101");
  });
});

describe("business or person (decision 5)", () => {
  it("a bare two- or three-word name is a person unless it has a suffix, a dba or a trade word that isn't a surname", async () => {
    const { looksLikeBusiness } = await import("./states/lib/business-name");
    for (const p of ["David Power", "Joe Mason", "John Wells", "Mary Homes", "WELLS, JOHN", "Milton Bullock 2020-021", "Daryl Kitchen"]) expect([p, looksLikeBusiness(p)]).toEqual([p, false]);
    for (const b of ["Power Electric LLC", "Smith & Sons", "John Doe dba Doe Roofing", "Bright Solar", "Acme", "D & S Electric", "SURE BET PAINTING", "PAUL DAVIS OF RENO LAKE TAHOE", "R & R BACKHOE"]) expect([b, looksLikeBusiness(b)]).toEqual([b, true]);
  });
});

describe("one field for business and person (MD applicants)", () => {
  it("an individual applicant is not put in businessName", async () => {
    const { searchLicensesBy } = await import("./licenses");
    const src = { state: "MD", source: "T", datasetUrl: "https://x.test", url: "https://x.test/r.json", personField: "applicant",
      fields: { businessName: "applicant", licenseNumber: "lic", licenseType: null, specialty: null, status: null, principal: "applicant", city: null, expires: null } };
    const rows = [{ applicant: "JOHN Q PUBLIC", lic: "B-100" }, { applicant: "ACME BUILDERS LLC", lic: "B-100" }];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (u) => String(u).includes("robots.txt") ? new Response("", { status: 404 }) : new Response(JSON.stringify(rows), { status: 200 }));
    const hits = (await searchLicensesBy(src as any, { type: "license", value: "B-100" }))!;
    expect(hits.map((h) => [h.businessName, h.principal])).toEqual([[null, "JOHN Q PUBLIC"], ["ACME BUILDERS LLC", "ACME BUILDERS LLC"]]);
  });
});

describe("NY officers: one split mechanism (people[].split)", () => {
  it("each officer is a person of their own, and the principal is the first one listed", async () => {
    const { LICENSE_SOURCES, searchLicensesBy } = await import("./licenses");
    const ny = LICENSE_SOURCES.NY.find((s) => /DOL contractor registry/.test(s.source))!;
    // A live row of i4jv-zkey (checked 2026-10-15), trimmed to the fields used.
    const rows = [{ business_name: "Ameresco, Inc.", certificate_number: "AB-1234", business_officers: "David J Corrsin, George P Sakelalris, Mark A Chiplock" }];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (u) => String(u).includes("robots.txt") ? new Response("", { status: 404 }) : new Response(JSON.stringify(rows), { status: 200 }));
    const [h] = (await searchLicensesBy(ny, { type: "license", value: "AB-1234" }))!;
    expect(h.principal).toBe("David J Corrsin");
    expect(h.people?.map((p) => p.name)).toEqual(["David J Corrsin", "George P Sakelalris", "Mark A Chiplock"]);
    // "David Chiplock" takes words from two officers: no match.
    expect(wholeWordMatch("David Chiplock", h)).toBe(false);
    expect(wholeWordMatch("Mark A Chiplock", h)).toBe(true);
  });
});

describe("caps say so (decision 9)", () => {
  it("withNote / noteOf / capNote", () => {
    const l = withNote([1, 2], capNote(2, 34));
    expect(noteOf(l)).toBe("showing the first 2 of 34 matches");
    expect(noteOf([1])).toBeNull();
    expect(capNote(10)).toBe("showing the first 10 matches; there are more");
  });
});

describe("robustness (decision 10)", () => {
  it("Retry-After in seconds or as an HTTP date", () => {
    expect(retryAfterMs("120")).toBe(120_000);
    const now = Date.parse("Wed, 15 Oct 2026 07:00:00 GMT");
    expect(retryAfterMs("Wed, 15 Oct 2026 08:00:00 GMT", now)).toBe(3600_000);
    expect(retryAfterMs("soon")).toBeNull();
  });
  it("robots.txt: our group, else *; longest rule wins", () => {
    const rules = parseRobots("User-agent: *\nDisallow: /search\nAllow: /search/public\n\nUser-agent: Googlebot\nDisallow: /");
    expect(robotsAllows(rules, "/search?q=x")).toBe(false);
    expect(robotsAllows(rules, "/search/public?q=x")).toBe(true);
    expect(robotsAllows(rules, "/data.csv")).toBe(true);
    const ours = parseRobots("User-agent: ConstructHUB-PermitBot\nDisallow: /api/\n\nUser-agent: *\nDisallow:");
    expect(robotsAllows(ours, "/api/x")).toBe(false);
    expect(robotsAllows(parseRobots("User-agent: *\nDisallow: /*.csv$"), "/files/a.csv")).toBe(false);
  });
  it("usDate range-checks the month and day", () => {
    expect(usDate("13/40/2018")).toBeNull();
    expect(usDate("02/30/2024")).toBeNull();
    expect(usDate("02/29/2024")).toBe("2024-02-29");
  });
  it("a CSV that ends inside a quote throws instead of yielding a malformed row", async () => {
    const p = join(tmpdir(), `audit-${Date.now()}.csv`);
    await fs.writeFile(p, 'a,b\n1,"open quote\n2,3\n');
    const rows: string[][] = [];
    await expect((async () => { for await (const r of csvRows(p)) rows.push(r); })()).rejects.toThrow(/ends inside a quoted field/);
    await fs.rm(p, { force: true });
  });
  it("escapeRegExp and safeDecode", () => {
    expect(new RegExp(`^${escapeRegExp("A+ (B)")}$`).test("A+ (B)")).toBe(true);
    expect(safeDecode("100% done %41")).toBe("100% done A");
  });
});

describe("coverage claims (decision 11)", () => {
  it("WA's bond-recovery suits name a court but are not a state court search", () => {
    expect(hasStateCourtSearch("WA")).toBe(false);
  });
});

describe("robots.txt switches CourtListener off (HARD RULE 2)", () => {
  it("the federal docket search is reported as not searched by ConstructHUB and makes no request", async () => {
    const { searchCompanyRecords, COURTLISTENER_ALLOWED } = await import("./records");
    expect(COURTLISTENER_ALLOWED).toBe(false);
    const calls: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (u) => { calls.push(String(u)); throw new Error("offline"); });
    const r = await searchCompanyRecords("Acme Builders", []);
    expect(r.sources.find((x) => /CourtListener/.test(x.source))).toMatchObject({ searched: false, note: expect.stringMatching(/^Not searched by ConstructHUB: courtlistener\.com's robots\.txt/) });
    expect(calls.some((u) => /courtlistener/.test(u))).toBe(false);
  });
});

describe("permit name match (kimi 16)", () => {
  it("never joins words of two people from a result's HTML or description", () => {
    const row = { rawData: { raw: { html: "<td>Applicant: Jane Smith</td><td>Owner: John Doe</td>" } }, description: "Applicant: Jane Smith; Owner: John Doe" };
    expect(namesMatch("John Smith", row)).toBe(false);
    // Round 2, decision 12: names come from name fields only; HTML and descriptions are never read for them.
    expect(namesMatch("John Doe", row)).toBe(false);
    expect(namesMatch("John Doe", { ...row, applicantName: "John Doe" })).toBe(true);
  });
});

afterEach(() => vi.restoreAllMocks());
