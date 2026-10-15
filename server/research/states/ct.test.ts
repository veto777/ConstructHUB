import { describe, expect, it } from "vitest";
import { newestDebarmentList, parseDebarmentText } from "./ct";

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
});
