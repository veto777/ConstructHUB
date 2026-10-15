import { describe, expect, it } from "vitest";
import { idfprDisciplineHit, licenseForms, parseIdolDebarred } from "./il";

// The IDOL debarred-contractors page, 2026-10-15 (excerpt).
const IDOL = `<p>Pursuant to section 11a of the Prevailing Wage Act , 820 ILCS 130/0.01-12 (2000), the Director of the Illinois Department of Labor gives notice that the following contractors and subcontractors have been found to have disregarded their obligations to employees under the Prevailing Wage Act on two (2) separate occasions and that they are prohibited from being awarded any contract or subcontract for a public works project.</p>
<p>The below listed are included in this category (this is not an exhaustive list):</p>
<p>Seven Brothers Painting, Inc. has been debarred from any public works project for a period of four years effective May 5, 2025</p>`;

describe("Illinois (audit 2026-10-15)", () => {
  it("IDOL debarments carry only the row's own sentence, with the end date the period gives", () => {
    const [h] = parseIdolDebarred(IDOL, "2026-10-15");
    expect(h).toMatchObject({ name: "Seven Brothers Painting, Inc.", date: "2025-05-05", endDate: "2029-05-05", adverse: true, status: "Debarred from public works for four years" });
    expect(h.detail).toBe("Seven Brothers Painting, Inc. has been debarred from any public works project for a period of four years effective May 5, 2025");
    expect(h.detail).not.toMatch(/two separate occasions|disregarded/);
    expect(parseIdolDebarred(IDOL, "2029-06-01")[0]).toMatchObject({ adverse: false, status: "Debarment period over (2029-05-05)" });
  });
  it("license lookups send the number as typed and without punctuation", () => {
    expect(licenseForms("062-012345")).toEqual(["'062-012345'", "'062012345'"]);
    expect(licenseForms("198000154")).toEqual(["'198000154'"]);
  });
  it("IDFPR discipline: adverse unless the action says otherwise", () => {
    // Live row of pzzh-kp68 (ever_disciplined = Y), 2026-10-15.
    const row = { license_number: "104007039", business_name: "HOLTHAUS COMPANIES INC", businessdba: "", action: "Fine", discipline_start_date: "12/22/2016", license_status: "ACTIVE", case_number: "2016004240" };
    expect(idfprDisciplineHit(row)).toMatchObject({ name: "HOLTHAUS COMPANIES INC", adverse: true, date: "2016-12-22", status: "Fine" });
    expect(idfprDisciplineHit({ ...row, action: "Dismissed" }).adverse).toBe(false);
  });
  it("IDFPR discipline drops a sole proprietor listed under their own name (business = Y)", () => {
    const row = { license_number: "", business_name: "JOHN R KING", action: "Probation", discipline_start_date: "11/25/2013", license_status: "DECEASED", case_number: "2013003732" };
    expect(idfprDisciplineHit(row).name).toBeNull();
  });
});
