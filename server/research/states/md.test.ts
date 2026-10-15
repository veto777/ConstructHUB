import { describe, expect, it } from "vitest";
import { bpwHit, parseBpwDebarments } from "./md";

// Saved 2026-10-15 from bpw.prod.maryland.gov/bpw-programs/procurement/debarments (first rows of both lists).
const BPW = "<h2>Barred from doing business with a public body&nbsp;</h2><table><tbody><tr><th scope=\"col\">Person/Company</th><th scope=\"col\">Term</th></tr><tr><td rowspan=\"1\">AB Medical, L\u200bLC.</td><td rowspan=\"1\">Indefinitely\u200b</td></tr><tr><td>George F. Alinsod</td><td>Indefinitely</td></tr><tr><td>Joseph D. Cheek</td><td>Indefinitely</td></tr><tr><td>Polar Bear Heating and Air Condition\u200bing Co. Inc.</td><td>Indefinitely</td></tr><tr><td>David J. Clemons</td><td>Indefinitely</td></tr></tbody></table><h2>Barred from doing business with the State</h2><table><tbody><tr><th scope=\"col\">Person/Company</th><th scope=\"col\">Term</th></tr><tr><td>Adler Services Group, Inc.\u200b<br>&nbsp;</td><td>Indefinitely</td></tr><tr><td>Harvey Adler\u200b\u200b<br>&nbsp;</td><td>Indefinitely</td></tr><tr><td>Belford Associates, Inc.</td><td>Indefinitely</td></tr><tr><td>Mary Patricia Bromwell</td><td>Indefinitely</td></tr><tr><td>Thomas L. Bromwell, Sr</td><td>Indefinitely</td></tr></tbody></table><h2>Other Debarments</h2>";

describe("Maryland BPW debarments", () => {
  it("keeps companies and drops individuals and officers", () => {
    const rows = parseBpwDebarments(BPW);
    const names = rows.map((r) => r.name);
    expect(names).toContain("AB Medical, LLC.");
    expect(names).toContain("Polar Bear Heating and Air Conditioning Co. Inc.");
    expect(names).toContain("Adler Services Group, Inc.");
    expect(names).not.toContain("George F. Alinsod");
    expect(names).not.toContain("Harvey Adler");
    expect(names.some((n) => /President/.test(n))).toBe(false);
    expect(rows.find((r) => r.name === "AB Medical, LLC.")).toMatchObject({ term: "Indefinitely" });
    expect(rows.find((r) => r.name === "Adler Services Group, Inc.")!.list).toMatch(/with the State/);
  });
  it("keeps the firm and drops the person from a mixed entry (live row, 2026-10-15)", () => {
    const html = "<h2>Barred from doing business with the State</h2><table><tbody><tr><th>Person/Company</th><th>Term</th></tr><tr><td>Montgomery Mechanical Services and Richard Stewart</td><td>Indefinitely</td></tr></tbody></table><h2>Other</h2>";
    expect(parseBpwDebarments(html).map((r) => r.name)).toEqual(["Montgomery Mechanical Services"]);
  });
  it("a debarment term that has ended is not adverse (audit 2026-10-15)", () => {
    const r = { list: "Barred from doing business with the State", name: "Belford Associates, Inc.", term: "Five Years (5/6/2026-5/5/2031)" };
    expect(bpwHit(r, "2026-10-15")).toMatchObject({ date: "2026-05-06", endDate: "2031-05-05", adverse: true, status: "Debarred: Five Years (5/6/2026-5/5/2031)" });
    expect(bpwHit(r, "2031-06-01")).toMatchObject({ adverse: false, status: "Debarment period over (Five Years (5/6/2026-5/5/2031))" });
  });
});
