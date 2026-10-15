/**
 * Codex round-4 audit (2026-10-15): the shared fixes, each with the failing input Codex gave. HTTP fixes (6, 12) are in
 * audit4-http.test.ts, the bulk loader's (3, 4, 11) in audit4-bulk.test.ts.
 */
import { describe, expect, it, vi } from "vitest";
import type { LicenseHit, ResearchReport, ResearchSubjectReport } from "@shared/research-reports";
import { previewRecordsLine, subjectLicensesSearched } from "@shared/research-reports";
import { addressMatch, addressQueryKey, parseAddress } from "@shared/identifiers";
import { adverseFrom } from "./adverse";
import { reportHit } from "./privacy";
import { onePersonField, personMatches } from "./licenses";
import { namesMatch, personParts } from "./runner";
import { crossReference, LicenseSet, searchById, searchCustomerIds, type LicenseFinder } from "./xref";
import { wcBusinessEntity } from "./states/or";
import { shownReport } from "./store";

vi.mock("../db", () => ({ pool: { query: vi.fn() } }));

const lic = (o: Partial<LicenseHit>): LicenseHit => ({
  state: "AZ", source: "Board A", sourceUrl: "https://example.test/a", businessName: "ACME ELECTRIC LLC", licenseNumber: "123",
  licenseType: "Electrical Contractor", specialty: null, status: "Active", principal: null, city: "PHOENIX", expires: null, matchedOn: "business", ...o,
});

describe("finding 1: a negation after the whole outcome word", () => {
  it("reads past a matched stem before checking for a negation", () => {
    expect(adverseFrom("Dismissal not granted")).toBeNull();
    expect(adverseFrom("Discipline not imposed")).toBeNull();
    expect(adverseFrom("Disciplinary action was never taken")).toBeNull();
    // Clean outcomes are unchanged.
    expect(adverseFrom("Dismissed")).toBe(false);
    expect(adverseFrom("License revoked")).toBe(true);
    expect(adverseFrom("Disciplined: fine paid")).toBe(true);
  });
});

describe("finding 2: status follows the report subject", () => {
  it("in a person's report a business-held license shows standing words only", () => {
    const h = lic({ holder: "business", principal: "John Smith", status: "Probation, Active", discipline: "Board order" });
    expect(reportHit(h, "person")).toMatchObject({ status: "Active" });
    expect(reportHit(h, "person").discipline).toBeUndefined();
    // A company's report keeps a business's status as published.
    expect(reportHit(h, "company").status).toBe("Probation, Active");
  });
  it("a stored person report is shown under today's rules, related licenses too", () => {
    const subject = (kind: "person" | "company"): ResearchSubjectReport => ({
      name: "John Smith", kind, licenses: [lic({ holder: "business", status: "Probation, Active" })], permits: [], licenseSources: [], portals: [],
      relatedLicenses: [lic({ holder: "business", status: "Suspended - Citation Pending", relatedVia: "x", relatedTie: "person" })],
      enforcement: [{ state: "AZ", source: "x", sourceUrl: "x", category: "discipline", name: "ACME", id: "1", date: null, endDate: null, status: null, city: null, detail: null, amount: null, adverse: null }],
    });
    const r: ResearchReport = { generatedAt: "2026-10-15", states: ["AZ"], trades: [], sinceYear: null, subjects: [subject("person"), subject("company")], totals: { licenses: 2, permits: 0, portalsSearched: 0, portalsNotSearched: 0 } };
    const shown = shownReport(r)!;
    expect(shown.subjects[0].licenses[0].status).toBe("Active");
    expect(shown.subjects[0].relatedLicenses![0].status).toBe("Suspended");
    expect(shown.subjects[0].enforcement).toEqual([]);
    expect(shown.subjects[1].licenses[0].status).toBe("Probation, Active");
    expect(shown.subjects[1].enforcement).toHaveLength(1);
  });
});

describe("finding 5: contacts follow their published role", () => {
  it("Oregon keeps contacts only for a documented business entity code", () => {
    for (const c of ["2", "3", "5", "6", "7", "8", "9", "A", "B", "C", "b"]) expect(wcBusinessEntity({ entity_code: c }), c).toBe(true);
    for (const c of ["0", "1", "4", "D", "", null, undefined, "Z"]) expect(wcBusinessEntity({ entity_code: c }), String(c)).toBe(false);
  });
});

describe("finding 7: a comma is one person only as LAST, FIRST", () => {
  it("two full names separated by a comma give no person match", () => {
    expect(onePersonField("Jane Smith, John Doe")).toBe(false);
    expect(personMatches("John Smith", "Jane Smith, John Doe")).toBe(false);
    expect(namesMatch("John Smith", { contractorName: "Jane Smith, John Doe" })).toBe(false);
    expect(personParts("Jane Smith, John Doe")).toEqual([]);
  });
  it("LAST, FIRST and a generational suffix still match", () => {
    expect(personMatches("John Smith", "SMITH, JOHN")).toBe(true);
    expect(personMatches("John A Smith", "SMITH, JOHN A")).toBe(true);
    expect(personMatches("John Smith", "John Smith, Jr.")).toBe(true);
    expect(personMatches("John Smith", "SMITH JR, JOHN")).toBe(true);
    expect(namesMatch("John Smith", { contractorName: "SMITH, JOHN" })).toBe(true);
    // Three parts are a list.
    expect(personMatches("John Smith", "SMITH, JOHN, DOE")).toBe(false);
  });
});

describe("finding 8: a fetched copy of an own license merges into it", () => {
  it("an identifier lookup's copy with discipline adds it to the subject's own record", async () => {
    const own = new LicenseSet();
    own.add(lic({ licenseNumber: "123", holder: "business" }));
    const finder: LicenseFinder = { state: "AZ", label: "Board A", byId: async () => ({ licenses: [lic({ licenseNumber: "123", holder: "business", discipline: "Fine" })], enforcement: [] }) };
    const r = await crossReference({ subject: { name: "Acme Electric", kind: "company" }, own, finders: [finder], searchedIds: new Set(), idSearchesUsed: 0, enforcementSearch: async () => ({ hits: [], sources: [] }) });
    expect(r.related).toHaveLength(0);
    expect(own.list).toHaveLength(1);
    expect(own.list[0].discipline).toBe("Fine");
  });
});

describe("finding 9: address queries keep their locality", () => {
  it("a suffixless street keeps its state; a PO box its city and state; FL before a ZIP is the state", () => {
    expect(addressQueryKey("123 Lake View TX")).not.toBe(addressQueryKey("123 Lake View CA"));
    expect(addressQueryKey("PO Box 77, Austin TX")).not.toBe(addressQueryKey("PO Box 77, Boston MA"));
    expect(addressQueryKey("PO Box 77, Austin TX")).toBe("a:POBOX 77|AUSTIN|TX|");
    expect(parseAddress("123 Main St, Tampa FL 33602")).toMatchObject({ city: "TAMPA", state: "FL", zip: "33602", unit: null });
    expect(parseAddress("123 Main St Fl 2, Tampa FL 33602")).toMatchObject({ unit: "2", state: "FL" });
    expect(addressMatch("PO Box 77, Austin TX 78701", "PO Box 77, Boston MA")).toBeNull();
    expect(addressMatch("PO Box 77, Austin TX 78701", "PO BOX 77 AUSTIN TX")).toBe("confirmed");
  });
  it("the second customer address in another state is searched, not skipped as the same", async () => {
    const calls: string[] = [];
    const f: LicenseFinder = { state: "TX", label: "Fake", byId: async (q) => { calls.push(q.value); return { licenses: [], enforcement: [] }; } };
    await searchCustomerIds([f], [{ type: "address", value: "PO Box 77, Austin TX" }, { type: "address", value: "PO Box 77, Boston MA" }], { name: "Acme", kind: "company" });
    expect(calls).toHaveLength(2);
  });
});

describe("finding 10: an enforcement file is not a license search; previews say what ran", () => {
  it("an identifier answered only by an enforcement file leaves licenses 'not searched'", async () => {
    const enf: LicenseFinder = { state: "FL", label: "Complaints", companiesOnly: true, byId: async () => ({ licenses: [], enforcement: [] }) };
    const r = await searchById([enf], { type: "phone", value: "8135550100" }, "company");
    expect(r).toMatchObject({ searched: 1, licenseSearched: 0 });
    const ids = await searchCustomerIds([enf], [{ type: "phone", value: "8135550100" }], { name: "Acme", kind: "company" });
    const s: ResearchSubjectReport = { name: "Acme", kind: "company", licenses: [], permits: [], licenseSources: [{ state: "FL", source: "x", searched: false, note: "down" }], portals: [], identifierSearches: ids.searches };
    expect(subjectLicensesSearched(s)).toBe(false);
    // An older report (no license count) reads as before.
    expect(subjectLicensesSearched({ ...s, identifierSearches: [{ query: "q", found: 0, note: "", sourcesSearched: 1 }] })).toBe(true);
  });
  it("a preview never prints a complaint count when no complaint source ran", () => {
    const line = previewRecordsLine({ complaints: 0, courtCases: 0, osha: 0, enforcement: 1, searched: ["x"], ran: { complaints: false, courtCases: false, osha: true, enforcement: true } });
    expect(line).not.toMatch(/consumer complaint\(s\)/);
    expect(line).toMatch(/1 state enforcement/);
    expect(line).toMatch(/Not searched in this preview: consumer complaints/);
    expect(previewRecordsLine({ complaints: 0, courtCases: 0, osha: 0, enforcement: 0, searched: [], ran: { complaints: true, courtCases: false, osha: true, enforcement: true } })).toBeNull();
    // An older preview without `ran`: only counts above zero.
    expect(previewRecordsLine({ complaints: 0, courtCases: 0, osha: 2, enforcement: 1, searched: [] })).toBe("Records on file: 1 state enforcement or standing record(s) and 2 OSHA inspection(s).");
  });
});

describe("follow-ups from the bulk fixes", () => {
  it("FL: a LAST, FIRST M respondent with a trade word is a person; an entity word at the end is a business", async () => {
    const { flRespondent } = await import("./bulk-sources");
    expect(flRespondent("GREEN, GENERAL H", [])).toBeNull();
    expect(flRespondent("CO, JOHN", [])).toBeNull();
    expect(flRespondent("ACME ROOFING, LLC", [])).toMatchObject({ dbaOnly: false });
  });
  it("CSLB's CLEAR is a standing word", async () => {
    const { standingStatus } = await import("./privacy");
    expect(standingStatus("CLEAR")).toEqual({ status: "CLEAR", moved: null });
  });
});
