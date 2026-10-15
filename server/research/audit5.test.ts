/**
 * Codex round-5 audit (2026-10-15): shared fixes with Codex's failing inputs. HTTP (6, 7) is in audit5-http.test.ts,
 * stored data (3, 5, 9) in audit5-data.test.ts.
 */
import { describe, expect, it } from "vitest";
import type { LicenseHit, ResearchSubjectReport } from "@shared/research-reports";
import { previewLicenseLine, subjectLicensesSearched } from "@shared/research-reports";
import { runtimeRecordsPhrase } from "@shared/research-coverage";
import { adverseFrom } from "./adverse";
import { reportHit, standingStatus } from "./privacy";
import { onePersonField, personMatches, wholeWordMatch } from "./licenses";
import { namesMatch, personParts } from "./runner";
import { samePersonName } from "./states/az";
import { verifyEnforcement } from "./states/wa";
import { knowledgeBook, setKnowledgeFact } from "../hub/knowledge";

const lic = (o: Partial<LicenseHit>): LicenseHit => ({
  state: "AZ", source: "Board A", sourceUrl: "https://example.test/a", businessName: "ACME ELECTRIC LLC", licenseNumber: "123",
  licenseType: "Electrical Contractor", specialty: null, status: "Active", principal: null, city: "PHOENIX", expires: null, matchedOn: "business", ...o,
});

describe("decision 1: true/false only from a clean outcome; any other negation in the clause is unknown", () => {
  it("Codex's inputs are null", () => {
    expect(adverseFrom("Disciplinary action has still not been taken")).toBeNull();
    expect(adverseFrom("Not subject to any discipline")).toBeNull();
    expect(adverseFrom("Penalty imposed, not paid")).toBeNull();
  });
  it("recognized phrases keep their answer", () => {
    expect(adverseFrom("License revoked")).toBe(true);
    expect(adverseFrom("Fined $500. Appeal not filed")).toBe(true); // the negation is in another clause
    expect(adverseFrom("No probable cause found")).toBe(false);
    expect(adverseFrom("Case closed without action")).toBe(false);
    expect(adverseFrom("Dismissed")).toBe(false);
  });
});

describe("decision 2: a person report keeps recognized standing phrases only", () => {
  it("drops trailing text, keeps a published date", () => {
    expect(standingStatus("Active with civil penalty of $500")).toEqual({ status: "Active", moved: "with civil penalty of $500" });
    expect(standingStatus("Active after restitution")).toEqual({ status: "Active", moved: "after restitution" });
    expect(standingStatus("Active since 01/02/2020")).toEqual({ status: "Active since 01/02/2020", moved: null });
    expect(standingStatus("Expired 2024-05-01")).toEqual({ status: "Expired 2024-05-01", moved: null });
    expect(reportHit(lic({ holder: "business", status: "Active with civil penalty of $500" }), "person").status).toBe("Active");
  });
  it("the Applicant exception is only the one wording a source writes", () => {
    expect(standingStatus("Applicant: an application is on file with DBPR (not a license)").status).toBe("Applicant: an application is on file with DBPR (not a license)");
    expect(standingStatus("Applicant: disciplined twice")).toEqual({ status: null, moved: "Applicant: disciplined twice" });
  });
});

describe("decision 4: one single-person check everywhere", () => {
  it("Codex's inputs give no match", () => {
    expect(personMatches("John Smith", "J Smith, John Doe")).toBe(false);
    expect(personMatches("John Smith", "Jane Smith / John Doe")).toBe(false);
    expect(personParts("J Smith, John Doe")).toEqual([]);
    expect(namesMatch("John Smith", { contractorName: "Jane Smith / John Doe" })).toBe(false);
    expect(samePersonName("John Smith", "Jane Smith & John Doe")).toBe(false);
  });
  it("separators of any kind are a list; a single person in any common form still matches", () => {
    for (const f of ["Jane Smith and John Doe", "Jane Smith; John Doe", "Jane Smith\nJohn Doe", "SMITH, JOHN, DOE", "Smith & Sons"]) expect(onePersonField(f), f).toBe(false);
    for (const f of ["SMITH, JOHN", "SMITH, JOHN A", "John A Smith", "John Smith, Jr.", "SMITH JR, JOHN"]) expect(personMatches("John Smith", f), f).toBe(true);
  });
  it("structured people are matched one by one, even beside a joined principal", () => {
    const h = lic({ principal: "Jane Smith / John Doe", people: [{ name: "Jane Smith", role: "Qualifier" }, { name: "John Doe", role: "Qualifier" }] });
    expect(wholeWordMatch("John Smith", h)).toBe(false);
    expect(wholeWordMatch("John Doe", h)).toBe(true);
  });
});

describe("decision 8: WA warrants keep the shared parser's null; vacated is not adverse", () => {
  const details = (status: string | null) => ({ Contractor: { BusinessName: "ACME", Warrants: [{ TaxWarrantNumber: "1", StatusDescription: status, ComplaintDate: "2024-01-01T00:00:00" }] } });
  const warrant = (status: string | null) => verifyEnforcement(details(status), "ACME", "https://example.test").find((h) => h.category === "tax_lien")!;
  it("Vacated → false; no status or an unknown word → null; dismissed → false", () => {
    expect(warrant("Vacated").adverse).toBe(false);
    expect(warrant(null).adverse).toBeNull();
    expect(warrant("Open").adverse).toBeNull();
    expect(warrant("Dismissed").adverse).toBe(false);
    expect(warrant(null).detail).toMatch(/State tax warrant filed/);
  });
});

describe("decision 10: not searched is never zero", () => {
  const s = (o: Partial<ResearchSubjectReport>): ResearchSubjectReport => ({ name: "Acme", kind: "company", licenses: [], permits: [], licenseSources: [{ state: "FL", source: "x", searched: false, note: "down" }], portals: [], ...o });
  it("an old identifier search without its license count reads as not searched (and undefined is not 'searched')", () => {
    expect(subjectLicensesSearched(s({ identifierSearches: [{ query: "q", found: 0, note: "", sourcesSearched: 1 }] }))).toBe(false);
    expect(subjectLicensesSearched(s({ identifierSearches: [{ query: "q", found: 0, note: "" }] }))).toBe(false);
    expect(subjectLicensesSearched(s({ identifierSearches: [{ query: "q", found: 0, note: "", sourcesSearched: 2, licenseSourcesSearched: 1 }] }))).toBe(true);
  });
  it("a preview whose license searches all failed doesn't print a zero", () => {
    const line = previewLicenseLine({ licenseMatches: 0, licenseSourceStates: ["FL"], licenseSearchedStates: [] })!;
    expect(line).not.toMatch(/0 license record/);
    expect(line).toMatch(/FL could not be searched/);
    expect(previewLicenseLine({ licenseMatches: 2, licenseSourceStates: ["FL", "TX"], licenseSearchedStates: ["TX"] })).toBe("2 license record(s) match in TX state license data. State license records for FL could not be searched for this preview; the report tries again.");
  });
});

describe("decision 11: OSHA and SAM.gov only when the running server has them", () => {
  it("nothing on first render; each only when true", () => {
    expect(runtimeRecordsPhrase(undefined)).toBe("");
    expect(runtimeRecordsPhrase({ osha: false, samExclusions: false })).toBe("");
    expect(runtimeRecordsPhrase({ osha: true })).toBe(", and OSHA inspections (federal)");
    expect(runtimeRecordsPhrase({ osha: true, samExclusions: true })).toBe(", federal exclusions and debarments (SAM.gov), and OSHA inspections (federal)");
  });
  it("Hub names OSHA only with the key", () => {
    setKnowledgeFact("samExclusions", true); setKnowledgeFact("samExclusions", false); // re-render now
    const has = !!process.env.DOL_API_KEY;
    expect(knowledgeBook().pack.includes("OSHA inspections (federal)")).toBe(has);
  });
});
