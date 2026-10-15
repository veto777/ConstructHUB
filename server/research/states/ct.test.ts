import { describe, expect, it } from "vitest";
import { debarmentHits, newestDebarmentList, parseDebarmentText, pack } from "./ct";

// pdftotext -layout of the DOL list of September 23, 2025 (excerpt).
const TEXT = `                                        DEBARMENT LIST
     Name of Person or Firm                                                 Expiration Date

-Canterbury Communications, Canterbury                                      Indefinite
     Marion T. Mershon, an individual                                       Indefinite

-Gatollari Enterprises Inc., Rochelle Park, NJ                              Indefinite
     Robert Gatollari, an individual                                        Indefinite

-SCD Services, LLC, Somers                                                  Indefinite
`;

describe("CT DOL debarment list", () => {
  it("reads firms and leaves individuals out", () => {
    expect(parseDebarmentText(TEXT)).toEqual([
      { name: "Canterbury Communications", city: "Canterbury", expires: "Indefinite" },
      { name: "Gatollari Enterprises Inc.", city: "Rochelle Park, NJ", expires: "Indefinite" },
      { name: "SCD Services, LLC", city: "Somers", expires: "Indefinite" },
    ]);
  });
  it("picks the newest list on the page", () => {
    const html = `<a href="/dol/-/media/x/debarment_march_2024.pdf?rev=1&amp;hash=2">Debarment List - March 12, 2024</a>
      <a href="/dol/-/media/x/september2025_final_debarment.pdf?rev=3">Debarment List - September 23, 2025</a>`;
    expect(newestDebarmentList(html)).toEqual({ url: "https://portal.ct.gov/dol/-/media/x/september2025_final_debarment.pdf?rev=3", date: "2025-09-23" });
  });
  it("checks the list's heading and keeps the publisher's status (audit 2026-10-15)", () => {
    const hits = debarmentHits(TEXT.replace("Name of Person", "Expiration Date x Name of Person"), { url: "u", date: "2025-09-23" });
    expect(hits).toHaveLength(3);
    expect(hits[0]).toMatchObject({ status: "Debarred indefinitely", adverse: true, detail: "On the debarment list of 2025-09-23 (CGS 31-53a)" });
    expect(() => debarmentHits("Some other PDF", { url: "u", date: "2025-09-23" })).toThrow(/heading/);
    expect(pack.bulk![0].minRows).toBeGreaterThan(5);
  });
  it("DEEP orders: no invented status, adverse from the penalty or the order's words, people left out", () => {
    const [, recent, older] = pack.enforcement!;
    // Live rows of t2bf-45ba and tvbr-6b6t, 2026-10-15.
    const pfizer = recent.toHit({ respondent: "Pfizer, Inc.", order_number: "COAR8382.pdf", type_of_enforcement: "Consent Order", town: "Groton", deep_program: "Air" });
    expect(pfizer).toMatchObject({ name: "Pfizer, Inc.", status: "Consent Order", adverse: null, amount: null });
    expect(recent.toHit({ respondent: "Pfizer, Inc.", town: "Groton" }).status).toBeNull();
    expect(recent.toHit({ respondent: "Steve Defrancesco and Jacyln Defrancesco", type_of_enforcement: "Consent Order", penalty_amount: "1750", town: "Clinton" })).toMatchObject({ name: null, adverse: true, amount: 1750 });
    expect(older.toHit({ respondent: "East Norwalk Citgo, LLC", enforcement_action: "The consent order requires East Norwalk Citgo, LLC to pay a civil penalty of $1,600 for the violation." })).toMatchObject({ adverse: true, amount: 1600 });
  });
});
