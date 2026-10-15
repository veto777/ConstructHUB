import { describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { csvRows, indexWords, usDate } from "./bulk";
import { parseTdlrOrders } from "./state-records";

describe("bulk helpers", () => {
  it("parses quoted CSV with doubled quotes, delimiters and newlines inside fields", async () => {
    const p = join(tmpdir(), `bulk-test-${Date.now()}.csv`);
    await fs.writeFile(p, `"06","CBC","WALTERS, DENNIS D","BUILDING ""BC"" LLC",""\r\n"a","line\none",x\r\n`);
    const rows: string[][] = [];
    for await (const r of csvRows(p)) rows.push(r);
    await fs.rm(p);
    expect(rows).toEqual([["06", "CBC", "WALTERS, DENNIS D", 'BUILDING "BC" LLC', ""], ["a", "line\none", "x"]]);
  });

  it("reads US dates and rejects placeholders", () => {
    expect(usDate("7/6/2018")).toBe("2018-07-06");
    expect(usDate(" 08/31/2028")).toBe("2028-08-31");
    expect(usDate("00/00/0000")).toBeNull();
    expect(usDate("not reinstated")).toBeNull();
  });

  it("keeps business and person words apart", () => {
    expect(indexWords("Sawyer Plumbing Service", "Larry D Sawyer").sort()).toEqual(["b:PLUMBING", "b:SAWYER", "b:SERVICE", "p:LARRY", "p:SAWYER"]);
  });
});

describe("TDLR administrative orders", () => {
  it("reads every company name, the license, the penalty and the basis", () => {
    const html = `<p>&nbsp;&nbsp;1 records found.</p><table><tr><th>Name and Location</th></tr><tr style="background:#dedede;"> <td> <span class="default_text">Company:</span> <span class="results_text">AIR PRO ELITE</span><br /> <span class="default_text">City:</span> <span class="results_text">TYLER</span><br /> <span class="default_text">County:</span> <span class="results_text">SMITH</span><br /> <span class="default_text">Company:</span> <span class="results_text">AIR PRO ELITE A/C &amp; HEATING LLC</span><br /><br /><span class="default_text"> License:</span> <span class="results_text">Not Licensed</span><br /><br /><span class="default_text">Complaint #</span> <span class="results_text">ACR20240013230</span></td> <td><span class="default_text">Date:</span> <span class="results_text">7/24/2025</span><br /><br />Respondent is assessed an administrative penalty in the amount of $4,000.</td> <td>Respondent performed air conditioning contracting without a license.</td></tr></table>`;
    const [h] = parseTdlrOrders(html);
    expect(h.name).toBe("AIR PRO ELITE / AIR PRO ELITE A/C & HEATING LLC");
    expect(h.id).toBe("ACR20240013230");
    expect(h.date).toBe("2025-07-24");
    expect(h.amount).toBe(4000);
    expect(h.status).toBe("Order against an unlicensed respondent");
    expect(h.city).toBe("TYLER, SMITH County");
    expect(h.detail).toContain("Basis: Respondent performed");
  });
});
