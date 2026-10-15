/** Codex round 5 (A10), decisions 3, 5 and 9: FL person forms, legacy reports and keys, totals from what is shown. */
import { describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({ rows: [] as { ctid: string; source: string; words: string[]; hit: any }[], jobs: new Set<string>(), updates: 0 }));
vi.mock("../db", () => ({
  pool: {
    query: vi.fn(async (sql: string, params: any[] = []) => {
      if (/FROM research_bulk_jobs/.test(sql)) return { rows: db.jobs.has(params[0]) ? [{ "?column?": 1 }] : [] };
      if (/INSERT INTO research_bulk_jobs/.test(sql)) { db.jobs.add(params[0]); return { rows: [] }; }
      if (/pg_relation_size/.test(sql)) return { rows: [{ pages: 1 + Math.max(...db.rows.map((r) => Number(r.ctid.slice(1).split(",")[0]))) }] };
      if (/SELECT ctid::text AS tid/.test(sql)) {
        const page = (t: string) => Number(t.slice(1).split(",")[0]);
        return { rows: db.rows.filter((r) => page(r.ctid) >= page(params[0]) && page(r.ctid) < page(params[1])).map((r) => ({ ...r, tid: r.ctid })) };
      }
      if (/UPDATE research_bulk_rows r SET words/.test(sql)) {
        for (const u of JSON.parse(params[0])) { const r = db.rows.find((x) => x.ctid === u.ctid); if (r) { r.words = u.words; db.updates++; } }
        return { rows: [] };
      }
      return { rows: [] };
    }),
  },
}));

import type { EnforcementHit, LicenseHit, ResearchReport, ResearchSubjectReport } from "@shared/research-reports";
import { REPORT_SNAPSHOT_VERSION, reportSummary } from "@shared/research-reports";
import { flLegacyComplaint, flRespondent, BULK_SOURCES } from "./bulk-sources";
import { purgeLegacyKeys, readStored, PAYLOAD_VERSION, HOLDER_VERSION, type BulkSource } from "./bulk";
import { personNameForm } from "./states/lib/business-name";
import { shownReport } from "./store";

const lic = (o: Partial<LicenseHit>): LicenseHit => ({
  state: "CA", source: "California CSLB contractor licenses", sourceUrl: "https://example.test", businessName: "JOHN SMITH", licenseNumber: "123",
  licenseType: "Contractor license (Sole Owner)", specialty: null, status: "Active", principal: "JOHN SMITH", city: "FRESNO", expires: null,
  matchedOn: "principal", holder: "business", address: "1 Elm St, Fresno CA 93701", phone: "5595550100", ...o,
});
const enf = (o: Partial<EnforcementHit>): EnforcementHit => ({
  state: "FL", source: "Florida DBPR complaints (construction and electrical)", sourceUrl: "https://example.test", category: "complaint", name: null, id: "1",
  date: null, endDate: null, status: null, city: "TAMPA", detail: null, amount: null, adverse: null, ...o,
});

describe("decision 3: FL personal name forms are never a business", () => {
  it("Codex's inputs: a personal suffix and a compound surname", () => {
    expect(flRespondent("GREEN, GENERAL H, JR.", [])).toBeNull();
    expect(flRespondent("VAN DYKE, GENERAL H", [])).toBeNull();
  });
  it("person and ambiguous forms; entity forms still decide a business", () => {
    for (const n of ["GREEN, GENERAL H, JR.", "VAN DYKE, GENERAL H", "DE LA CRUZ, MARIA", "SMITH JR, JOHN", "JOHN SMITH JR", "MC DONALD, JOHN", "ST JOHN, MARY A", "O'BRIEN, PAT"]) expect(personNameForm(n), n).toBe("person");
    expect(personNameForm("AIR CONDITIONING, JESSE")).toBe("ambiguous");
    expect(flRespondent("AIR CONDITIONING, JESSE", [])).toBeNull();
    expect(personNameForm("ACME ROOFING II")).toBe("ambiguous");
    for (const n of ["ACME ROOFING, LLC", "KREATIVE REMODELING SPECIALISTS, LL", "POOL PRO, LAKE NONA POOL SERVICE", "ABC ROOFING"]) expect(flRespondent(n, []), n).toMatchObject({ dbaOnly: false });
    // A person with a marked DBA: the record is the DBA's, never the person's.
    expect(flRespondent("VAN DYKE, GENERAL H", ["D/B/A DYKE ROOFING"])).toEqual({ name: "DYKE ROOFING", business: "DYKE ROOFING", dbaOnly: true });
  });
  it("a stored FL row under the old rule is read again; other sources' rows are not", () => {
    const fl = BULK_SOURCES.find((s) => s.id === "fl-dbpr-complaints")!;
    const old = { k: "enforcement" as const, h: enf({ name: "GREEN, GENERAL H, JR.", address: "1253 BALKAN ROAD, TALLAHASSEE FL 32305" }), v: 4 };
    expect(readStored(fl, old)).toBeNull();
    expect(flLegacyComplaint(old.h)).toBeNull();
    expect(readStored(fl, { ...old, v: PAYLOAD_VERSION })).not.toBeNull();
    // A version-4 DBA-only record (the DBA's name, locality only) was right under that rule and stands.
    expect(readStored(fl, { k: "enforcement", h: enf({ name: "HANDY MARIO", address: "TAMPA FL 33602" }), v: 4 })?.stored.hit.name).toBe("HANDY MARIO");
    // Another source's version-4 rows are current (its rule did not change).
    expect(readStored({}, { k: "enforcement", h: enf({ name: "JOHN SMITH" }), v: 4 })?.keysSafe).toBe(true);
  });
});

describe("decision 5: older report snapshots and stored keys", () => {
  const report = (licenses: LicenseHit[], extra: Partial<ResearchReport> = {}): ResearchReport => ({
    generatedAt: "2026-10-15", states: ["CA"], trades: [], sinceYear: null,
    subjects: [{ name: "John Smith", kind: "company", licenses, permits: [], licenseSources: [], portals: [] }],
    totals: { licenses: licenses.length, permits: 0, portalsSearched: 0, portalsNotSearched: 0 }, ...extra,
  });
  it("an older snapshot's unverifiable business holder is unknown: locality only, no phone", () => {
    const h = shownReport(report([lic({ source: "Some live board", licenseType: "Contractor" })]))!.subjects[0].licenses[0];
    expect(h).toMatchObject({ holder: null, phone: null });
    expect(h.address).not.toMatch(/Elm/);
  });
  it("recomputed where the source can: CSLB's Sole Owner is an individual, a Corporation stays a business", () => {
    const [sole, corp] = shownReport(report([lic({}), lic({ licenseNumber: "456", licenseType: "Contractor license (Corporation)", businessName: "ACME INC" })]))!.subjects[0].licenses;
    expect(sole).toMatchObject({ holder: "individual", phone: null });
    expect(corp).toMatchObject({ holder: "business", phone: "5595550100", address: "1 Elm St, Fresno CA 93701" });
  });
  it("a current snapshot keeps its holders", () => {
    const h = shownReport(report([lic({ source: "Some live board" })], { snapshotVersion: REPORT_SNAPSHOT_VERSION }))!.subjects[0].licenses[0];
    expect(h).toMatchObject({ holder: "business", phone: "5595550100" });
  });
  it("the purge removes unsafe phone and address keys once, in batches, and keeps the rows", async () => {
    const cslb = BULK_SOURCES.find((s) => s.id === "ca-cslb")!;
    db.rows = [
      { ctid: "(0,1)", source: "ca-cslb", words: ["b:JOHN", "l:123", "a:1 ELM", "t:5595550100", "z:93701"], hit: { k: "license", h: lic({}), v: HOLDER_VERSION - 1 } },
      { ctid: "(0,2)", source: "ca-cslb", words: ["b:ACME", "l:456", "a:1 ELM", "t:5595550100"], hit: { k: "license", h: lic({ licenseType: "Contractor license (Corporation)" }), v: HOLDER_VERSION - 1 } },
      { ctid: "(1,1)", source: "fl-dbpr-complaints", words: ["b:GREEN", "a:1253 BALKAN"], hit: { k: "enforcement", h: enf({ name: "GREEN, GENERAL H, JR." }), v: 4 } },
      { ctid: "(1,2)", source: "gone-source", words: ["b:X", "t:5595550100"], hit: { k: "license", h: lic({ holder: "business" }), v: 0 } },
    ];
    const sources: BulkSource[] = [cslb, BULK_SOURCES.find((s) => s.id === "fl-dbpr-complaints")!];
    const r = await purgeLegacyKeys(sources, () => undefined);
    expect(r).toMatchObject({ scanned: 4, purged: 3, bySource: { "ca-cslb": 1, "fl-dbpr-complaints": 1, "gone-source": 1 } });
    expect(db.rows.map((x) => x.words)).toEqual([["b:JOHN", "l:123", "z:93701"], ["b:ACME", "l:456", "a:1 ELM", "t:5595550100"], ["b:GREEN"], ["b:X"]]);
    // Once only.
    expect(await purgeLegacyKeys(sources, () => undefined)).toBeNull();
  });
});

describe("decision 9: totals counted from what is shown", () => {
  it("an older person report with an enforcement record no longer counts it", () => {
    const s: ResearchSubjectReport = {
      name: "John Smith", kind: "person", licenses: [], permits: [], licenseSources: [{ state: "FL", source: "x", searched: true, note: "0" }], portals: [],
      enforcement: [enf({ name: "ACME" })], recordSources: [{ source: "FL enforcement", scope: "FL", searched: true, note: "1 record(s)", category: "enforcement" }],
    };
    const r: ResearchReport = { generatedAt: "2026-10-15", states: ["FL"], trades: [], sinceYear: null, subjects: [s], totals: { licenses: 0, permits: 0, portalsSearched: 0, portalsNotSearched: 0, complaints: 0, courtCases: 0, osha: 0, enforcement: 1 } };
    const shown = shownReport(r)!;
    expect(shown.totals.enforcement).toBe(0);
    expect(shown.subjects[0].recordSources?.every((x) => !x.searched)).toBe(true);
    expect(reportSummary(shown)).not.toMatch(/1 state enforcement/);
  });
});
