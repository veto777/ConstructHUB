import { describe, expect, it } from "vitest";
import { parseDisciplinaryRelease, parsePvlReport } from "./hi";
import { businessParts } from "./lib/g8-common";

// Trimmed from cca.hawaii.gov/oah/dcca-disciplinary-actions-through-january-2026/ (2026-10-15).
const release = `<main><p>HAWAIʻI BOARD OF OPTOMETRY</p>
<p>Respondent: Khoa Dang Nguyen, O.D. (Hawaiʻi)<br>Case Number: OPT 2025-7-L<br>Sanction: $800 fine<br>Effective Date: 11-13-25</p>
<p>CONTRACTORS LICENSE BOARD</p>
<p>Respondents: Meade Electric LLC dba Maui Electricians and Zachariah J. Meade (Maui)<br>Case Number: CLB 2025-50-L<br>Sanction: $2,500 fine<br>Effective Date: 1-23-26</p>
<p>RICO alleges that Respondents failed to provide homeowners with a fully signed, written contract. (Board approved Settlement Agreement.)</p>
<p>Respondent: Kurt W. Williams<br>Case Number: CLB 2024-81-L<br>Sanction: $2,000 fine<br>Effective Date: 10-21-25</p>
<p>Copies of the decisions are available online</p></main>`;

describe("HI DCCA", () => {
  it("keeps construction-board cases with a business respondent, never a person", () => {
    const hits = parseDisciplinaryRelease(release, "https://cca.hawaii.gov/oah/x/");
    expect(hits).toHaveLength(1);
    // "Effective Date: 1-23-26": a two-digit year is not given a guessed century (round 2, decision 13), so no date.
    expect(hits[0]).toMatchObject({ name: "Meade Electric LLC / Maui Electricians", id: "CLB 2025-50-L", date: null, amount: 2500, category: "discipline" });
    expect(hits[0].status).toBe("Contractors License Board: $2,500 fine");
    expect(hits[0].detail).toMatch(/^RICO alleges/);
  });
  it("reads a PVL contractor report: classes of one license merged, address and license keys set", () => {
    const rows = [
      ["", "CT Current Licenses by Class"], ["", "As of 2026-04-06 11:22:16 Hawaii-Aleutian Standard Time/HST"],
      ["", "Licensee  ↑", "License: License Number  ↑", "", "Class Prefix", "Classification: Classification Name", "Classification: Description", "Trade/Professional Name", "Status", "Effective Expire Date", "Business Street", "Business City", "Business State", "Business Zip Code"],
      ["", "22&W CONSTRUCTION INC", "CT-39093-0", "", "BC", "B General Building", "General Building", "", "C - Current, Valid & In Good Standing", "9/30/2026", "91-1188 ILIAHIALOE LP", "EWA BEACH", "Hawaii", "96706"],
      ["", "", "", "", "BC", "C-31a", "Cement concrete contractor", "", "C - Current, Valid & In Good Standing", "9/30/2026", "91-1188 ILIAHIALOE LP", "EWA BEACH", "Hawaii", "96706"],
      ["", "ZU WEN HE", "CT-33278-0", "", "BC", "B General Building", "", "", "C - Current, Valid & In Good Standing", "9/30/2026", "3054 Lanikaula", "HONOLULU", "Hawaii", "96822"],
    ];
    const hits = parsePvlReport(rows, "Hawaii Contractors License Board licenses", "contractors");
    expect(hits).toHaveLength(2);
    expect(hits[0].hit).toMatchObject({ businessName: "22&W CONSTRUCTION INC", specialty: "Classes: B General Building, C-31a", expires: "2026-09-30", address: "EWA BEACH Hawaii 96706" }); // round 3, decision 3: no entity type, no street
    expect(hits[0].hit.status).toContain("2026-04-06");
    expect(hits[0].keys).toEqual({ licenses: ["CT-39093-0"] });
    expect(hits[1]).toMatchObject({ person: "ZU WEN HE", hit: { principal: "ZU WEN HE", businessName: null } });
    // A person alone: no street address (a home address) and no address key, city/state/ZIP only; not a business word.
    expect(hits[1].hit.address).toBe("HONOLULU Hawaii 96822");
    expect(hits[1].keys).toEqual({ licenses: ["CT-33278-0"] });
    expect(hits[1].business).toBeNull();
  });
  it("splits respondents into businesses and drops people", () => {
    expect(businessParts("RI-NO LLC, dba Oahu Flooring and Kyri S. Pehau")).toEqual(["RI-NO LLC", "Oahu Flooring"]);
    expect(businessParts("Arthur S. Kim dba IVIEW Security")).toEqual(["IVIEW Security"]);
    expect(businessParts("Lisa Hoang aka Kim Lien Hoang")).toEqual([]);
    expect(businessParts("ROOFING AND CONSTRUCTION LLC")).toEqual(["ROOFING AND CONSTRUCTION LLC"]);
  });
});

describe("HI audit fixes (2026-10-15)", () => {
  const rows = (name: string, trade: string) => [
    ["", "Licensee  ↑", "License: License Number  ↑", "", "Class Prefix", "Classification: Classification Name", "Classification: Description", "Trade/Professional Name", "Status", "Effective Expire Date", "Business Street", "Business City", "Business State", "Business Zip Code"],
    ["", name, "CT-33278-0", "", "BC", "B General Building", "", trade, "C - Current, Valid & In Good Standing", "9/30/2026", "3054 Lanikaula", "HONOLULU", "Hawaii", "96822"],
  ];
  it("a sole proprietor with a trade name: the trade name is the business, the person's name is not indexed as one", () => {
    const [h] = parsePvlReport(rows("ZU WEN HE", "HE CONSTRUCTION"), "Hawaii Contractors License Board licenses", "contractors");
    expect(h).toMatchObject({ business: "HE CONSTRUCTION", person: "ZU WEN HE", hit: { businessName: "HE CONSTRUCTION", principal: "ZU WEN HE" } });
  });
  it("a sanction text decides adverse; a bare person's name as respondent is dropped", () => {
    // The release above with its sanction changed to "Dismissed" to exercise the not-adverse path.
    const html = `<main><p>Respondents: Meade Electric LLC dba Maui Electricians and Zachariah J. Meade (Maui)<br>Case Number: CLB 2025-50-L<br>Sanction: Dismissed<br>Effective Date: 1-23-26</p>
<p>Respondent: Kurt W. Williams<br>Case Number: CLB 2024-81-L<br>Sanction: $2,000 fine<br>Effective Date: 10-21-25</p><p>Copies of the decisions are available online</p></main>`;
    const hits = parseDisciplinaryRelease(html, "https://cca.hawaii.gov/oah/x/");
    expect(hits.map((h) => h.name)).toEqual(["Meade Electric LLC / Maui Electricians"]);
    expect(hits[0].adverse).toBe(false);
    expect(parseDisciplinaryRelease(release, "u")[0].adverse).toBe(true); // "$2,500 fine"
  });
});

describe("HI round-2 audit (2026-10-16)", () => {
  const rows = (name: string, trade: string) => [
    ["", "Licensee  ↑", "License: License Number  ↑", "", "Class Prefix", "Classification: Classification Name", "Classification: Description", "Trade/Professional Name", "Status", "Effective Expire Date", "Business Street", "Business City", "Business State", "Business Zip Code"],
    ["", name, "CT-33278-0", "", "BC", "B General Building", "", trade, "C - Current, Valid & In Good Standing", "9/30/2026", "3054 Lanikaula", "HONOLULU", "Hawaii", "96822"],
  ];
  it("a trade name doesn't make a sole proprietor's record a business's: holder individual, no street, no address key (decision 2)", () => {
    const [h] = parsePvlReport(rows("ZU WEN HE", "HE CONSTRUCTION"), "Hawaii Contractors License Board licenses", "contractors");
    expect(h.hit).toMatchObject({ businessName: "HE CONSTRUCTION", holder: "individual", address: "HONOLULU Hawaii 96822" });
    expect(h.keys).toEqual({ licenses: ["CT-33278-0"] });
    const [b] = parsePvlReport(rows("22&W CONSTRUCTION INC", ""), "Hawaii Contractors License Board licenses", "contractors");
    // Round 3, decision 3: no entity type is published, so a company-like name leaves the holder unknown (no street).
    expect(b.hit).toMatchObject({ businessName: "22&W CONSTRUCTION INC", holder: null, address: "HONOLULU Hawaii 96822" });
    expect(b.keys).toEqual({ licenses: ["CT-33278-0"] });
    expect(b.component).toBe("Hawaii Contractors License Board licenses");
  });
});
