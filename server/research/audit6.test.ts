/**
 * Codex round-6 audit (2026-10-15): each finding with Codex's failing input. Name fields across the packs (#3) are
 * also covered in audit6-names.test.ts.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { EnforcementHit, LicenseHit, ResearchReport, ResearchSubjectReport } from "@shared/research-reports";
import { identifierSearchLine, previewLicenseLine } from "@shared/research-reports";
import { adverseFrom, outcomeClauses } from "./adverse";
import { personNameForm, looksLikeBusinessTrailingSuffix } from "./states/lib/business-name";
import { flLegacyComplaint, flRespondent } from "./bulk-sources";
import { readStored } from "./bulk";
import { licenseSourcesFor, personMatches, withPeople } from "./licenses";
import { contactName, samePersonName } from "./states/az";
import { verifyEnforcement, warrantVacated } from "./states/wa";
import { standingStatus, reportHit } from "./privacy";
import { shownReport, shownVia, scrubNote } from "./store";
import {
  PortalBlockedError, SOCRATA_HOSTS, errorChallenge, fetchWithDeadline, hostBlocked, politeFetch, resetHostState, robotsAllowed, robotsAllows,
  robotsFor, socrataAppToken, withRun,
} from "./http";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); resetHostState(); });

const lic = (o: Partial<LicenseHit>): LicenseHit => ({
  state: "FL", source: "Board A", sourceUrl: "https://example.test/a", businessName: "ACME ELECTRIC LLC", licenseNumber: "123",
  licenseType: "Electrical Contractor", specialty: null, status: "Active", principal: null, city: "TAMPA", expires: null, matchedOn: "business", ...o,
});
const enf = (o: Partial<EnforcementHit>): EnforcementHit => ({
  state: "FL", source: "Florida DBPR complaints and discipline (construction and electrical)", sourceUrl: "https://example.test/c", category: "complaint",
  name: "ACME ROOFING LLC", id: "1", date: null, endDate: null, status: null, city: "Tampa", detail: null, amount: null, adverse: null, ...o,
});

describe("#1 adverse: an abbreviation doesn't end a clause", () => {
  it("Codex's input is null", () => {
    expect(adverseFrom("No finding under Sec. 12 of disciplinary action")).toBeNull();
    expect(outcomeClauses("No finding under Sec. 12 of disciplinary action")).toHaveLength(1);
  });
  it("other abbreviations stay in the clause; a real sentence end still splits", () => {
    expect(adverseFrom("Not found in violation of Lic. Rule 4. Disc. action taken")).toBeNull();
    expect(adverseFrom("Order No. 12 under Admin. Code. License revoked")).toBe(true); // "No. 12" is a number
    expect(adverseFrom("Fined $500. Appeal not filed")).toBe(true);
    expect(adverseFrom("License revoked. Respondent did not appeal")).toBe(true);
    // "No." before a number or license ID is "number", not a negation.
    expect(adverseFrom("License No. BC753468 revoked")).toBe(true);
  });
});

describe("#2 FL: an ambiguous personal form is never a business", () => {
  it("Codex's input: SMITH JONES, GENERAL H", () => {
    expect(personNameForm("SMITH JONES, GENERAL H")).toBe("ambiguous");
    expect(looksLikeBusinessTrailingSuffix("SMITH JONES, GENERAL H")).toBe(true); // a trade word…
    expect(flRespondent("SMITH JONES, GENERAL H", [])).toBeNull(); // …doesn't make it a business
    expect(flRespondent("SMITH JONES, GENERAL H D/B/A JONES ROOFING", [])).toMatchObject({ name: "JONES ROOFING", dbaOnly: true });
    expect(flRespondent("ACME ROOFING, INC", [])).toMatchObject({ dbaOnly: false });
    // An entity word no surname is, before the comma, is a business (seen in the stored FL file, 2026-10-15).
    expect(personNameForm("AIR TODAY LLC, AIR TODAY")).toBeNull();
    expect(flRespondent("AIR TODAY LLC, AIR TODAY", [])).toMatchObject({ dbaOnly: false });
    expect(personNameForm("SMITH CO, JOHN")).toBe("ambiguous"); // "Co" is a surname too
    expect(personNameForm("GREEN, GENERAL H, JR.")).toBe("person");
  });
  it("stored version-5 rows are re-read: the record goes and so do its street keys", () => {
    const src = { legacyEnforcement: flLegacyComplaint, enforcementRuleVersion: 6 };
    const row = { k: "enforcement" as const, h: enf({ name: "SMITH JONES, GENERAL H", address: "1 Elm St, Tampa FL 33602" }), v: 5 };
    expect(readStored(src, row)).toBeNull();
    expect(readStored(src, { ...row, v: 6 })).not.toBeNull();
    expect(readStored(src, { ...row, h: enf({ name: "JONES ROOFING" }) })!.keysSafe).toBe(true);
  });
});

describe("#3 names: the single-person check sees the field as published", () => {
  it("WA's people list: 'J Smith, John Doe' is not flipped into one person", async () => {
    const wa = licenseSourcesFor("WA").find((s) => s.peopleFrom?.length)!;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input: any) => {
      const u = new URL(String(input));
      if (u.pathname === "/robots.txt") return new Response("", { status: 404 });
      const body = u.pathname.includes("4xk5-x9j6") ? [{ contractorlicensenumber: "ACMEEL*123", principalname: "J Smith, John Doe" }] : [];
      return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    });
    const [h] = (await withPeople(wa, [lic({ state: "WA", licenseNumber: "ACMEEL*123" })])) as LicenseHit[];
    expect(h.people!.map((p) => p.name)).toContain("J Smith, John Doe");
    expect(h.people!.some((p) => personMatches("John Smith", p.name))).toBe(false);
  });
  it("AZ's contact: 'Jane Smith\\nJohn Doe' stays a list", () => {
    expect(contactName("Jane Smith\nJohn Doe (Member)")).toBe("Jane Smith / John Doe");
    expect(samePersonName("John Smith", contactName("Jane Smith\nJohn Doe"))).toBe(false);
    expect(contactName("Douglas Guy Mack (President) ")).toBe("Douglas Guy Mack");
  });
});

describe("#4 stored reports: enforcement and relationship prose follow today's rules", () => {
  const company = (o: Partial<ResearchSubjectReport>): ResearchSubjectReport => ({ name: "Green Roofing", kind: "company", licenses: [], permits: [], licenseSources: [], portals: [], ...o });
  const report = (s: ResearchSubjectReport, snapshotVersion?: number): ResearchReport =>
    ({ ...(snapshotVersion ? { snapshotVersion } : {}), generatedAt: "2026-10-15", states: ["FL"], trades: [], sinceYear: null, subjects: [s], totals: { licenses: 0, permits: 0, portalsSearched: 0, portalsNotSearched: 0, enforcement: 1 } });

  it("an old company report's FL respondent 'GREEN, GENERAL H, JR.' and its home address are gone; totals recounted", () => {
    const s = company({ enforcement: [enf({ name: "GREEN, GENERAL H, JR.", address: "9 Oak Ln, Tampa FL 33602" }), enf({ name: "GREEN ROOFING LLC", address: "1 Main St, Tampa FL 33602", phone: "8135550100" })] });
    const shown = shownReport(report(s, 2))!;
    expect(shown.subjects[0].enforcement).toHaveLength(1);
    expect(shown.subjects[0].enforcement![0]).toMatchObject({ name: "GREEN ROOFING LLC", address: "TAMPA FL 33602", phone: null });
    expect(JSON.stringify(shown)).not.toMatch(/Oak Ln|GENERAL H/);
    expect(shown.totals.enforcement).toBe(1);
  });
  it("relationship prose names only a phone or street the report shows", () => {
    // The individual's license shows its locality only, so the street in the prose goes too (Codex's input).
    const s = company({
      licenses: [lic({ holder: null, address: "123 Main St, Tampa FL 33602" })],
      relatedLicenses: [lic({ licenseNumber: "999", relatedTie: "address", relatedVia: "same address as license 123, 123 Main St, Tampa FL 33602" })],
    });
    const shown = shownReport(report(s, 3))!;
    expect(shown.subjects[0].relatedLicenses![0].relatedVia).toBe("same address as license 123");
    // A business's street the report shows may be named.
    const biz = company({
      licenses: [lic({ holder: "business", address: "123 Main St, Tampa FL 33602" })],
      relatedLicenses: [lic({ licenseNumber: "999", relatedTie: "address", relatedVia: "same address as license 123, 123 Main St, Tampa FL 33602" })],
    });
    expect(shownReport(report(biz, 3))!.subjects[0].relatedLicenses![0].relatedVia).toBe("same address as license 123, 123 Main St, Tampa FL 33602");
  });
  it("a person's report never names a phone or street in prose or notes; what the customer gave stays", () => {
    const shown = new Set(["8135550100"]);
    expect(shownVia("same phone as license 123, (813) 555-0100; possible match (address): same address as license 5, 1 Elm St", shown, true))
      .toBe("same phone as license 123; possible match (address): same address as license 5");
    expect(shownVia("matched by the phone you gave (813-555-0100)", shown, true)).toBe("matched by the phone you gave (813-555-0100)");
    expect(scrubNote("address 1 Elm St, Tampa FL (on license 5) is shared by 9 businesses, so it doesn't tie any one of them to this name; they are left out."))
      .toBe("an address (on license 5) is shared by 9 businesses, so it doesn't tie any one of them to this name; they are left out.");
    expect(scrubNote("Could not search phone (813) 555-0100 in WA L&I")).toBe("Could not search a phone in WA L&I");
  });
});

const html = (body: string, status = 200) => new Response(body, { status, headers: { "content-type": "text/html; charset=utf-8" } });
function mockNet(pages: Record<string, () => Response>, robots: Record<string, () => Response> = {}) {
  const sent: string[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input: any, init?: any) => {
    const u = new URL(String(input));
    if (u.pathname === "/robots.txt") { sent.push(u.toString()); return robots[u.host]?.() ?? new Response("", { status: 404 }); }
    sent.push(u.toString() + (new Headers(init?.headers).get("x-app-token") ? " [token]" : ""));
    const p = pages[u.toString()];
    if (!p) throw new Error(`unexpected fetch ${u}`);
    return p();
  });
  return sent;
}

describe("#5 a challenge on any status, and on robots.txt, blocks the host for the run", () => {
  it("Codex's input: a 503 'Checking your browser' is not retried; the host is blocked", async () => {
    const sent = mockNet({ "https://data.test/q": () => html("<h1>Checking your browser</h1>", 503) });
    await expect(politeFetch("https://data.test/q", {}, { minDelayMs: 0 })).rejects.toBeInstanceOf(PortalBlockedError);
    expect(sent.filter((u) => u.startsWith("https://data.test/q"))).toHaveLength(1);
    expect(hostBlocked("https://data.test/")).not.toBeNull();
  });
  it("a plain 404 'Access denied' page and a plain 503 are no challenge", () => {
    expect(errorChallenge("<h1>Access denied</h1>")).toBe(false);
    expect(errorChallenge("<h1>Service Unavailable</h1>")).toBe(false);
    expect(errorChallenge('<script src="/cdn-cgi/challenge-platform/x"></script>')).toBe(true);
  });
  it("a 200 robots.txt challenge blocks the host for the whole run, after the robots cache expires too", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      mockNet({}, { "r.test": () => html("<html><title>Just a moment...</title></html>") });
      await withRun(async () => {
        expect((await robotsFor("https://r.test")).denied).toBeTruthy();
        expect(hostBlocked("https://r.test/")).not.toBeNull();
        vi.setSystemTime(Date.now() + 26 * 3600_000); // past the robots cache and the block's own time
        expect(hostBlocked("https://r.test/")).not.toBeNull(); // the run is still going
        expect(await robotsAllowed("https://r.test/x")).toBe(false);
      });
    } finally { vi.useRealTimers(); }
  });
  it("a 503 robots.txt challenge blocks the host; a plain 404 robots.txt is still 'no rules'", async () => {
    mockNet({}, { "c.test": () => html("<h1>Checking your browser</h1>", 503), "n.test": () => html("<h1>Not Found</h1>", 404) });
    expect((await robotsFor("https://c.test")).denied).toBeTruthy();
    expect(hostBlocked("https://c.test/")).not.toBeNull();
    expect(await robotsFor("https://n.test")).toEqual({ rules: [] });
    expect(hostBlocked("https://n.test/")).toBeNull();
  });
  it("a redirect to a challenge on a 4xx blocks the host that answered", async () => {
    mockNet({
      "https://a.test/s": () => new Response("", { status: 302, headers: { location: "https://waf.test/p" } }),
      "https://waf.test/p": () => html('<div id="px-captcha"></div>', 429),
    });
    await expect(fetchWithDeadline("https://a.test/s", {}, 10_000, 0)).rejects.toBeInstanceOf(PortalBlockedError);
    expect(hostBlocked("https://waf.test/")).not.toBeNull();
  });
});

describe("#6 robots precedence uses normalized lengths", () => {
  it("Codex's input: Allow /%70%72%69 doesn't beat Disallow /private", () => {
    expect(robotsAllows([{ allow: true, path: "/%70%72%69" }, { allow: false, path: "/private" }], "/private")).toBe(false);
    // A genuine tie still goes to Allow.
    expect(robotsAllows([{ allow: true, path: "/%70rivate" }, { allow: false, path: "/private" }], "/private")).toBe(true);
  });
});

describe("#7 WA warrants: only a plain 'vacated' clears", () => {
  const warrant = (status: string) => verifyEnforcement({ Contractor: { BusinessName: "ACME", Warrants: [{ TaxWarrantNumber: "1", StatusDescription: status }] } }, "ACME", "https://example.test")
    .find((h) => h.category === "tax_lien")!;
  it("Codex's inputs are null", () => {
    expect(warrant("Not vacated").adverse).toBeNull();
    expect(warrant("Motion to vacate denied").adverse).toBeNull();
    expect(warrant("Vacate requested").adverse).toBeNull();
  });
  it("a completed vacation is false", () => {
    expect(warrant("Vacated").adverse).toBe(false);
    expect(warrantVacated("Warrant vacated 2024-03-01")).toBe(true);
    expect(warrantVacated("Not vacated")).toBe(false);
  });
});

describe("#8 a conditioned standing shows none", () => {
  it("Codex's input and the decision's examples", () => {
    expect(standingStatus("Active - not yet approved").status).toBeNull();
    expect(standingStatus("Active pending review").status).toBeNull();
    expect(standingStatus("Active subject to conditions").status).toBeNull();
    expect(standingStatus("Active on condition of bond").status).toBeNull();
    expect(reportHit(lic({ holder: "business", status: "Active - not yet approved" }), "person").status).toBeNull();
  });
  it("unconditional standing stays", () => {
    expect(standingStatus("Active").status).toBe("Active");
    expect(standingStatus("Active since 01/02/2020").status).toBe("Active since 01/02/2020");
    expect(standingStatus("Probation, Active").status).toBe("Active");
  });
});

describe("#9 an older preview or identifier search never shows zero", () => {
  it("Codex's inputs", () => {
    const line = previewLicenseLine({ licenseMatches: 0, licenseSourceStates: ["WA"] })!;
    expect(line).not.toMatch(/\b0 license/);
    expect(line).toMatch(/didn't record whether state license records for WA could be searched/);
    expect(identifierSearchLine({ query: "phone (206) 555-0100", found: 0, note: "WA L&I could not be searched" })).toBe("phone (206) 555-0100 (not searched; WA L&I could not be searched)");
  });
  it("known searches still count", () => {
    expect(previewLicenseLine({ licenseMatches: 2, licenseSourceStates: ["WA"] })).toMatch(/^2 license record\(s\) found/);
    expect(identifierSearchLine({ query: "q", found: 0, note: "", sourcesSearched: 2 })).toBe("q (0 found; )");
    expect(identifierSearchLine({ query: "q", found: 3, note: "" })).toBe("q (3 found; )");
  });
});

describe("#10 the Socrata token goes only to approved hosts, hop by hop", () => {
  it("Codex's input: a redirect to untrusted.example/resource/… gets no token", async () => {
    vi.stubEnv("SOCRATA_APP_TOKEN", "test-token-value");
    const sent = mockNet({
      "https://data.wa.gov/resource/abcd-1234.json": () => new Response("", { status: 302, headers: { location: "https://untrusted.example/resource/abcd-1234.json" } }),
      "https://untrusted.example/resource/abcd-1234.json": () => new Response("[]", { status: 200, headers: { "content-type": "application/json" } }),
    });
    await politeFetch("https://data.wa.gov/resource/abcd-1234.json", {}, { minDelayMs: 0 });
    expect(sent.filter((u) => !u.endsWith("/robots.txt"))).toEqual(["https://data.wa.gov/resource/abcd-1234.json [token]", "https://untrusted.example/resource/abcd-1234.json"]);
    expect(socrataAppToken("http://data.wa.gov/resource/abcd-1234.json")).toBeNull();
  });
  it("every Socrata host in our sources is on the list", async () => {
    const { readFileSync, readdirSync, statSync } = await import("node:fs");
    const { join } = await import("node:path");
    const files: string[] = [];
    const walk = (d: string) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else if (/\.(?:ts|json)$/.test(f) && !/\.test\.ts$/.test(f)) files.push(p); } };
    for (const d of ["server/research", "server/scrapers", "server/data"]) walk(d);
    const hosts = new Set<string>();
    for (const f of files) {
      const t = readFileSync(f, "utf8");
      for (const m of Array.from(t.matchAll(/https:\/\/([a-z0-9.-]+)\/(?:resource|api\/views|api\/id|api\/odata)\//g))) hosts.add(m[1]);
      for (const m of Array.from(t.matchAll(/soda\("([a-z0-9-]+\.[a-z0-9.-]+)"/g))) hosts.add(m[1]);
      for (const m of Array.from(t.matchAll(/const (?:NY|NYC|MC) = "([a-z0-9.-]+)"/g))) hosts.add(m[1]);
    }
    for (const h of Array.from(hosts)) if (/\.(?:test|example)$/.test(h)) hosts.delete(h);
    expect(Array.from(hosts).filter((h) => !SOCRATA_HOSTS.has(h))).toEqual([]);
  });
});

describe("#11 the legacy key purge runs whatever the worker and bulk settings", () => {
  it("startResearchWorker schedules the purge before the RESEARCH_WORKER and RESEARCH_BULK checks", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("server/research/runner.ts", "utf8");
    const body = src.slice(src.indexOf("export function startResearchWorker"));
    expect(body.indexOf("startLegacyKeyPurge()")).toBeGreaterThan(-1);
    expect(body.indexOf("startLegacyKeyPurge()")).toBeLessThan(body.indexOf('RESEARCH_WORKER === "off"'));
    expect(body.slice(body.indexOf("RESEARCH_BULK"))).not.toMatch(/purgeLegacyKeys/);
  });
});
