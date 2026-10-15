import { describe, expect, it } from "vitest";
import { parseEdList } from "./ny";

// Saved from apps.labor.ny.gov/EDList/searchResults.do on 2026-10-15 (one DOL row, one WCB row).
const DOL = `<table id="ResultsTable" class="its"><thead><tr><th>Agency</th></tr></thead><tbody>
<tr class="odd">
<td style="text-transform: uppercase;">DOL</td>
<td style="text-transform: uppercase;">DOL</td>
<td>*****8654</td>
<td style="text-transform: uppercase;width:20%"><a href="/EDList/displayDebarrmentDetails.do?view=Public&agencyKey=487993089&agency=DOL ">AMERICAN PAVING, INC.</a></td>
<td style="text-transform: uppercase;"></td>
<td style="text-transform: uppercase;width:20%">8 FORREST AVE.<br>GLEN COVE, NY 11542</td>
<td>05/24/2024</td>
<td>05/24/2029</td></tr></tbody></table><span class="pagebanner">One item found.</span>`;

const WCB = `<table id="ResultsTable" class="its"><tbody>
<tr class="odd">
<td style="text-transform: uppercase;">WCB</td>
<td>*****9186</td>
<td style="text-transform: uppercase;width:20%"><a href="/EDList/displayDebarrmentDetails.do?ename=AMERICAN+A-1+AUTO+CENTER+INC&agency=WCB&tin=*****9186&agencyKey=831065 ">AMERICAN A-1 AUTO CENTER INC</a></td>
<td style="text-transform: uppercase;"></td>
<td style="text-transform: uppercase;width:20%">3000 MARCUS AVE # 2E4<br>NEW HYDE PARK, NY 11042</td>
<td>03/12/2026</td>
<td>07/09/2027</td></tr></tbody></table>`;

describe("NY DOL debarment list parser", () => {
  it("reads a DOL row", () => {
    const [h] = parseEdList(DOL, "DOL");
    expect(h.name).toBe("AMERICAN PAVING, INC.");
    expect(h.date).toBe("2024-05-24");
    expect(h.endDate).toBe("2029-05-24");
    expect(h.city).toBe("GLEN COVE, NY"); // the city line without its ZIP
    expect(h.detail).toMatch(/Article 8 or 9.*NYS Department of Labor/);
    expect(h.category).toBe("debarment");
  });
  it("reads a WCB row (no fiscal-officer column)", () => {
    const [h] = parseEdList(WCB, "WCB");
    expect(h.name).toBe("AMERICAN A-1 AUTO CENTER INC");
    expect(h.date).toBe("2026-03-12");
    expect(h.endDate).toBe("2027-07-09");
    expect(h.detail).toMatch(/141-b/);
    expect(h.city).toBe("NEW HYDE PARK, NY");
  });
  it("marks a current debarment adverse and an ended one not", () => {
    expect(parseEdList(DOL, "DOL")[0].adverse).toBe(true);
    const ended = parseEdList(DOL.replace("05/24/2029", "05/24/2025"), "DOL")[0];
    expect(ended).toMatchObject({ adverse: false, status: "Debarment period over" });
  });
});

describe("NYC DOB disciplinary actions", () => {
  it("takes adverse from DOB's own disposition, and unknown stays unknown", async () => {
    const { pack } = await import("./ny");
    const dob = pack.enforcement!.find((e) => /DOB disciplinary/.test(e.source))!;
    // Dispositions as published in ndq3-kuef (2026-10-15).
    const row = (disposition: string) => ({ company: "X", date: "01/02/24", year: "2024", disposition });
    expect(dob.toHit(row("Fine.")).adverse).toBe(true);
    expect(dob.toHit(row("Voluntary surrender.")).adverse).toBe(true);
    expect(dob.toHit(row("Revoked.")).adverse).toBe(true);
    expect(dob.toHit(row("Warning Letter.")).adverse).toBeNull();
    expect(dob.toHit(row("ACD.")).adverse).toBeNull();
    expect(dob.toHit({ company: "X" }).adverse).toBeNull();
  });
});

describe("NY license holders (audit round 2, decision 2)", () => {
  it("each dataset says who holds the license: a firm or contractor business, or a person", async () => {
    const { pack } = await import("./ny");
    const by = (label: RegExp) => pack.licenses!.find((l) => label.test(l.source))!;
    expect(pack.licenses!.every((l) => typeof l.holder === "function")).toBe(true);
    expect(by(/elevator contractor/).holder!({})).toBe("business");
    expect(by(/mold individual/).holder!({})).toBe("individual");
    expect(by(/home inspectors/).holder!({ hi_business_name: "ACME INSPECTIONS LLC" })).toBe("individual");
    const dob = by(/City DOB licenses/);
    expect(dob.holder!({ license_type: "GENERAL CONTRACTOR" })).toBe("business");
    expect(dob.holder!({ license_type: "MASTER PLUMBER", business_name: "ACME PLUMBING INC" })).toBe("individual");
    expect(dob.holder!({ license_type: "ELEVATOR AGENCY / INSPECTOR" })).toBeNull();
    const hic = by(/home improvement/);
    expect(hic.holder!({ license_type: "Premises" })).toBe("business");
    expect(hic.holder!({ license_type: "Individual" })).toBe("individual");
  });
});
