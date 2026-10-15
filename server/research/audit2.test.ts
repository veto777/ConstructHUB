/**
 * Regression tests for the core fixes of the round-2 Codex audit (2026-10-15, decisions 1–13). Each would have caught
 * its finding. Pack-specific fixes are tested in states/<st>.test.ts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LicenseHit } from "@shared/research-reports";
import { adverseFrom } from "./adverse";
import { looksLikeBusiness } from "./states/lib/business-name";
import { addressMatch, addressMatches } from "./identifiers";
import { csvRows, rowKeys, shortfall } from "./bulk";
import { disciplineRecord, privateHit, reportHit } from "./privacy";
import { PortalBlockedError, fetchWithDeadline, politeFetch, resetHostState, rethrowIfBlocked, robotsAllowed, withRun } from "./http";
import { politeFetch as permitFetch, retryAfterMs as permitRetryAfter } from "../scrapers/polite-fetch";
import { LicenseSet, crossReference, licenseKey, searchById, searchCustomerIds, type LicenseFinder } from "./xref";
import { liveFinder, namesMatch } from "./runner";
import { dateOf, entityHolder } from "./licenses";

const lic = (o: Partial<LicenseHit>): LicenseHit => ({
  state: "SD", source: "Test board", sourceUrl: "https://example.test", businessName: null, licenseNumber: null, licenseType: "Plumber",
  specialty: null, status: null, principal: null, city: null, expires: null, matchedOn: "principal", ...o,
});

afterEach(() => { vi.restoreAllMocks(); resetHostState(); });

describe("decision 4: adverse only from a clean match", () => {
  it("mixed or negated wording is null; a clean match is true or false", () => {
    expect(adverseFrom("License revoked; hearing waived")).toBeNull();
    expect(adverseFrom("License not revoked")).toBeNull();
    expect(adverseFrom("No suspension")).toBeNull();
    expect(adverseFrom("Closed without penalty")).toBeNull();
    expect(adverseFrom("Dismissed, penalty paid")).toBeNull();
    expect(adverseFrom("Not guilty")).toBe(false); // "guilty" is part of the not-adverse phrase
    expect(adverseFrom("Dismissed")).toBe(false);
    expect(adverseFrom("License revoked")).toBe(true);
    expect(adverseFrom("Civil penalty $2,500")).toBe(true);
    expect(adverseFrom("Debarred", { ended: true })).toBe(false);
    expect(adverseFrom("Debarred; reversed on appeal", { ended: true })).toBeNull();
    // A pack's own words follow the same rules.
    expect(adverseFrom("Citation upheld", { adverse: /\bupheld\b/i })).toBe(true);
    expect(adverseFrom("Citation not upheld", { adverse: /\bupheld\b/i })).toBeNull();
  });
});

describe("decision 3: the business-name classifier", () => {
  it("whole words only, and surname-like trade words are not business words", () => {
    expect(looksLikeBusiness("John Steel")).toBe(false);
    expect(looksLikeBusiness("Mary Sales")).toBe(false);
    expect(looksLikeBusiness("Ann Towers")).toBe(false);
    expect(looksLikeBusiness("Peter Roofner")).toBe(false); // no "Roof*" prefix
    expect(looksLikeBusiness("Ray Electra")).toBe(false); // no "electr*" prefix
    expect(looksLikeBusiness("Acme Roofing")).toBe(true);
    expect(looksLikeBusiness("Smith HVAC")).toBe(true);
    expect(looksLikeBusiness("Jones Steel LLC")).toBe(true); // the suffix still says so
  });
  it("a publisher's entity type decides when there is one", () => {
    // Round 3, decision 3: only the listed values decide; anything else is unknown.
    const lists = { business: /^(?:corporation|limited liability company)$/i, individual: /^individual$/i };
    expect(entityHolder("Individual", lists)).toBe("individual");
    expect(entityHolder("Limited Liability Company", lists)).toBe("business");
    expect(entityHolder("Joint Venture", lists)).toBeNull();
    expect(entityHolder("", lists)).toBeNull();
  });
});

describe("decision 5: addresses", () => {
  it("compares state and unit when both give one", () => {
    expect(addressMatches("123 Main St, Springfield IL 62701", "123 Main St, Springfield MA 01101")).toBe(false);
    expect(addressMatches("123 Main St, Springfield, IL", "123 Main St, Springfield, MA")).toBe(false);
    expect(addressMatches("123 Main St Ste 4, Seattle WA 98101", "123 Main St Suite 9, Seattle WA 98101")).toBe(false);
    expect(addressMatch("123 Main St Ste 4, Seattle WA 98101", "123 Main Street, Suite 4, Seattle WA 98101")).toBe("confirmed");
    expect(addressMatch("123 Main St, Seattle WA 98101", "123 Main St Ste 4, Seattle WA 98101")).toBe("confirmed"); // one side gives no unit
  });
  it("a street without a suffix must be the whole name, not a prefix", () => {
    expect(addressMatches("123 Lake View", "123 Lake Forest Road")).toBe(false);
    expect(addressMatches("123 Lake View, Reno NV", "123 Lake Forest Rd, Reno NV")).toBe(false);
    expect(addressMatch("123 Lake View, Reno NV", "123 Lake View, Reno NV")).toBe("possible");
  });
  it("a PO box needs the same ZIP or city", () => {
    expect(addressMatches("PO Box 77", "P.O. Box 77")).toBe(false);
    expect(addressMatches("PO Box 77, 98101", "PO Box 77 Seattle WA 98101")).toBe(true);
    expect(addressMatches("PO Box 77, 98101", "PO Box 77, 10001")).toBe(false);
  });
  it("candidate-level agreement is only a possible match", () => {
    expect(addressMatch("123 Main St", "123 Main St, Seattle WA 98101")).toBe("possible");
    expect(addressMatch("123 Main St, Seattle WA 98101", "123 Main St, Seattle WA 98101")).toBe("confirmed");
  });
  it("the cross-reference labels a possible address tie", async () => {
    const own = new LicenseSet();
    own.add(lic({ businessName: "ACME LLC", holder: "business", licenseNumber: null, licenseType: null, address: "123 Main St", matchedOn: "business" }));
    const finder: LicenseFinder = {
      state: "WA", label: "Fake",
      byId: async (q) => ({ licenses: q.type === "address" ? [lic({ state: "WA", businessName: "OTHER CO", holder: "business", licenseNumber: "X123", address: "123 Main St, Seattle WA 98101" })] : [], enforcement: [] }),
    };
    const r = await crossReference({ subject: { name: "Acme LLC", kind: "company" }, own, finders: [finder], searchedIds: new Set(), idSearchesUsed: 0, enforcementSearch: async () => ({ hits: [], sources: [] }) });
    expect(r.related[0].relatedVia).toMatch(/^possible match \(address\): same address as/);
  });
});

describe("decisions 1 and 2: holder privacy and no discipline on a license", () => {
  it("an individual's or unknown holder's contacts go, even with an employer or DBA on the record", () => {
    const withEmployer = privateHit(lic({ businessName: "SPARKS ELECTRIC INC", principal: "JANE DOE", holder: "individual", address: "12 Elm St, Providence RI 02903", phone: "401-555-0100" }));
    expect(withEmployer).toMatchObject({ address: "PROVIDENCE RI 02903", phone: null });
    const unknown = privateHit(lic({ businessName: "DOE ROOFING", holder: null, address: "12 Elm St, Tampa FL 33601", phone: "813-555-0100" }));
    expect(unknown.phone).toBeNull();
    expect(privateHit(lic({ businessName: "ACME LLC", holder: "business", address: "1 Main St, Tampa FL 33601" })).address).toBe("1 Main St, Tampa FL 33601");
  });
  it("bulk keys follow the holder, not the business field", () => {
    const qualifier = rowKeys({ kind: "license", hit: lic({ businessName: "DOE ROOFING", principal: "JOHN DOE", holder: "individual", licenseNumber: "CCC1234", phone: "8135550100", address: "12 Elm St, Tampa FL 33601" }), business: "DOE ROOFING", person: "JOHN DOE" });
    expect(qualifier.keys).toEqual({ licenses: ["CCC1234"] });
    expect(qualifier.hit.phone).toBeNull();
  });
  it("discipline never shows on a license; a business's becomes an enforcement record", () => {
    const person = lic({ principal: "JOHN DOE", holder: "individual", licenseNumber: "E-1", status: "Active", discipline: "Previous disciplinary actions: probation 2019" });
    expect("discipline" in reportHit(person)).toBe(false);
    expect(disciplineRecord(person)).toBeNull();
    const biz = lic({ businessName: "ACME LLC", holder: "business", licenseNumber: "C-9", discipline: "Probation 2019" });
    expect(disciplineRecord(biz)).toMatchObject({ category: "discipline", name: "ACME LLC", licenseNumber: "C-9", adverse: null, detail: expect.stringContaining("Probation 2019") });
  });
});

describe("decision 6: robots.txt and access", () => {
  const robots = (status: number, body = "", type = "text/plain") => new Response(body, { status, headers: { "content-type": type } });
  it("2xx parses; 404/410 and a plain app page allow; 401, 403, 5xx, a network failure or a challenge page disallow", async () => {
    const answers: Record<string, () => Response> = {
      "a.test": () => robots(200, "User-agent: *\nDisallow: /private"),
      "b.test": () => robots(404), "c.test": () => robots(410),
      "d.test": () => robots(403), "e.test": () => robots(401), "f.test": () => robots(503),
      "g.test": () => robots(200, "<!doctype html><html><body>Checking your browser</body></html>", "text/html"),
      "i.test": () => robots(200, "<!doctype html><html><head><title>CIB Verify</title></head><body><div id=\"root\"></div></body></html>", "text/html"),
    };
    vi.spyOn(globalThis, "fetch").mockImplementation(async (u) => {
      const host = new URL(String(u)).host;
      if (host === "h.test") throw new Error("connect ETIMEDOUT");
      return answers[host]();
    });
    expect(await robotsAllowed("https://a.test/public")).toBe(true);
    expect(await robotsAllowed("https://a.test/private/x")).toBe(false);
    expect(await robotsAllowed("https://b.test/x")).toBe(true);
    expect(await robotsAllowed("https://c.test/x")).toBe(true);
    for (const h of ["d", "e", "f", "g", "h"]) expect(await robotsAllowed(`https://${h}.test/x`), h).toBe(false);
    // An app page served for every path (no robots file at all) is not a refusal.
    expect(await robotsAllowed("https://i.test/x")).toBe(true);
  });
  it("follows redirects by hand and checks robots.txt on every hop", async () => {
    const seen: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (u, init) => {
      const url = String(u); seen.push(url);
      if (url.endsWith("/robots.txt")) return robots(200, "User-agent: *\nDisallow: /private");
      expect((init as RequestInit).redirect).toBe("manual");
      return new Response(null, { status: 302, headers: { location: "/private/file.csv" } });
    });
    await expect(fetchWithDeadline("https://r.test/download", {}, 10_000, 0)).rejects.toBeInstanceOf(PortalBlockedError);
    expect(seen.some((u) => u.includes("/private/file.csv"))).toBe(false);
  });
  it("caps redirect hops", async () => {
    let n = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (u) => String(u).endsWith("/robots.txt") ? robots(404) : new Response(null, { status: 301, headers: { location: `/hop${++n}` } }));
    await expect(fetchWithDeadline("https://loop.test/start", {}, 10_000, 0)).rejects.toThrow(/more than 8 redirects/);
  });
  it("a 403 blocks the host for every caller for the rest of the run", async () => {
    let dataCalls = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (u) => {
      if (String(u).endsWith("/robots.txt")) return robots(404);
      dataCalls++;
      return new Response("denied", { status: 403 });
    });
    await withRun(async () => {
      await expect(politeFetch("https://deny.test/a", {}, { minDelayMs: 0 })).rejects.toBeInstanceOf(PortalBlockedError);
      await expect(politeFetch("https://deny.test/b", {}, { minDelayMs: 0 })).rejects.toThrow(/denied access earlier/);
      await expect(fetchWithDeadline("https://deny.test/c", {}, 10_000, 0)).rejects.toThrow(/denied access earlier/);
    });
    expect(dataCalls).toBe(1); // no retry, no second request
  });
  it("Retry-After sets a cooldown every caller honors", async () => {
    let dataCalls = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (u) => {
      if (String(u).endsWith("/robots.txt")) return robots(404);
      dataCalls++;
      return new Response("slow down", { status: 429, headers: { "retry-after": "600" } });
    });
    await expect(politeFetch("https://busy.test/a", {}, { minDelayMs: 0 })).rejects.toThrow(/wait 10 minute/);
    await expect(fetchWithDeadline("https://busy.test/b", {}, 10_000, 0)).rejects.toThrow(/asked us to wait/);
    expect(dataCalls).toBe(1);
  });
  it("rethrowIfBlocked rethrows only access denials", () => {
    expect(() => rethrowIfBlocked(new PortalBlockedError("https://x.test", 403))).toThrow(PortalBlockedError);
    expect(() => rethrowIfBlocked(new Error("HTTP 404 for https://x.test"))).not.toThrow();
  });
  it("the permit sweeps' polite-fetch: 403 is terminal, Retry-After may be an HTTP date", async () => {
    let calls = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => { calls++; return new Response("no", { status: 403 }); });
    await expect(permitFetch("https://permit.test/x", {}, { minDelayMs: 0 })).rejects.toBeInstanceOf(PortalBlockedError);
    expect(calls).toBe(1);
    expect(permitRetryAfter(new Date(Date.UTC(2026, 9, 15, 12, 1, 0)).toUTCString(), Date.UTC(2026, 9, 15, 12, 0, 0))).toBe(60_000);
  });
});

describe("decision 7: dedupe", () => {
  it("unnumbered licenses keep initials and city", () => {
    expect(licenseKey(lic({ principal: "John A Smith", city: "Sioux Falls" }))).not.toBe(licenseKey(lic({ principal: "John B Smith", city: "Sioux Falls" })));
    expect(licenseKey(lic({ principal: "John Smith", city: "Sioux Falls" }))).not.toBe(licenseKey(lic({ principal: "John Smith", city: "Rapid City" })));
    const set = new LicenseSet();
    set.add(lic({ principal: "John A Smith", city: "Sioux Falls" }));
    expect(set.add(lic({ principal: "John B Smith", city: "Sioux Falls" }))).toBe(true);
    expect(set.list).toHaveLength(2);
  });
  it("people merge only on the exact full name in the same role", () => {
    const set = new LicenseSet();
    set.add(lic({ businessName: "ACME LLC", licenseNumber: "C-1", people: [{ name: "John A Smith", role: "Officer" }] }));
    set.add(lic({ businessName: "ACME LLC", licenseNumber: "C-1", source: "Test board", people: [{ name: "John B Smith", role: "Officer" }, { name: "John A Smith", role: "Qualifier" }, { name: "JOHN A SMITH", role: "Officer" }] }));
    expect(set.list[0].people).toEqual([{ name: "John A Smith", role: "Officer" }, { name: "John B Smith", role: "Officer" }, { name: "John A Smith", role: "Qualifier" }]);
  });
});

describe("decision 8: searched means searched", () => {
  it("a lookup that can't search a company name reports not searched", async () => {
    const f = liveFinder("NE", { source: "Individual-only roster", sourceUrl: "https://x.test", kinds: ["person"], search: async () => { throw new Error("must not run"); } });
    expect(await f.byName!("Acme Electric", "company")).toMatchObject({ searched: false, hits: [] });
  });
  it("a finder with no identifier search is listed as not searched, and 0 sources searched is said", async () => {
    const r = await searchById([{ state: "NE", label: "Name-only lookup" }], { type: "phone", value: "4025550100" }, "company");
    expect(r.searched).toBe(0);
    expect(r.skipped).toEqual(["Name-only lookup (can't search by phone)"]);
    const ids = await searchCustomerIds([{ state: "NE", label: "Name-only lookup" }], [{ type: "phone", value: "4025550100" }], { name: "Acme", kind: "company" });
    expect(ids.searches[0]).toMatchObject({ found: 0, sourcesSearched: 0 });
  });
});

describe("decision 9: notes survive", () => {
  it("a name hop's cap note reaches the cross-reference notes", async () => {
    const own = new LicenseSet();
    own.add(lic({ businessName: "ACME LLC", holder: "business", licenseNumber: "C-1", people: [{ name: "Jane Roe", role: "Officer" }] }));
    const finder: LicenseFinder = { state: "SD", label: "Capped file", byName: async () => ({ hits: [], searched: true, note: "0 match(es)", capped: "showing the first 500 index matches; there are more" }) };
    const r = await crossReference({ subject: { name: "Acme LLC", kind: "company" }, own, finders: [finder], searchedIds: new Set(["l:C1"]), idSearchesUsed: 0, enforcementSearch: async () => ({ hits: [], sources: [] }) });
    expect(r.notes.some((n) => /"Jane Roe" in Capped file: showing the first 500/.test(n))).toBe(true);
  });
});

describe("decision 10: bulk completeness", () => {
  it("a load under 70% of the previous, overall or per component, is kept out", () => {
    expect(shortfall(100, {}, null)).toBeNull();
    expect(shortfall(69, {}, { rows: 100 })).toBe("69 rows, baseline 100");
    expect(shortfall(90, { a: 89, b: 1 }, { rows: 100, components: { a: 60, b: 40 } })).toBe("b: 1 rows, baseline 40");
    expect(shortfall(90, { a: 90 }, { rows: 100, components: { a: 60, b: 40 } })).toBe("b: 0 rows, baseline 40");
    expect(shortfall(95, { a: 60, b: 35 }, { rows: 100, components: { a: 60, b: 40 } })).toBeNull();
  });
});

describe("decision 11: CSV bounds", () => {
  const file = async (body: string) => { const p = join(tmpdir(), `csv-${Date.now()}-${Math.random()}`); await fs.writeFile(p, body); return p; };
  const read = async (p: string) => { const out: string[][] = []; for await (const r of csvRows(p)) out.push(r); return out; };
  it("escaped quotes count toward the field limit", async () => {
    const p = await file(`a\n"${'""'.repeat((1 << 20) + 10)}"\n`);
    await expect(read(p)).rejects.toThrow(/quoted field runs past/);
    await fs.rm(p);
  });
  it("a record over 2,000 columns or 4 MB throws", async () => {
    const p = await file(`a\n${",".repeat(2001)}\n`);
    await expect(read(p)).rejects.toThrow(/more than 2000 columns/);
    const q = await file(`a\n${Array.from({ length: 5 }, () => "x".repeat(1_000_000)).join(",")}\n`);
    await expect(read(q)).rejects.toThrow(/record runs past/);
    await fs.rm(p); await fs.rm(q);
  });
});

describe("decision 12: permit names", () => {
  it("only name fields, with initials and companies checked like licenses", () => {
    expect(namesMatch("John Smith", { description: "Jane Smith and John Doe", contractorName: "Doe Builders" })).toBe(false);
    expect(namesMatch("John A Smith", { applicantName: "John B Smith" })).toBe(false);
    expect(namesMatch("John A Smith", { applicantName: "Smith, John A" })).toBe(true);
    expect(namesMatch("Acme Roofing", { contacts: [{ name: "Jane Roe", company: "Acme Roofing LLC" }] }, "company")).toBe(true);
    expect(namesMatch("Acme Roofing", { description: "Acme Roofing reroof" }, "company")).toBe(false);
    expect(namesMatch("Acme", { rawData: { raw: { listedNames: ["ACME INC"] } } }, "company")).toBe(true);
  });
});

describe("decision 14: IL roofing expiration dates", () => {
  it("reads the publisher's MM/DD/YYYY text and ISO timestamps; anything else is null", () => {
    expect(dateOf("12/31/2027")).toBe("2027-12-31");
    expect(dateOf("2027-12-31T00:00:00.000")).toBe("2027-12-31");
    expect(dateOf("13/40/2027")).toBeNull();
    expect(dateOf("unknown")).toBeNull();
  });
});
