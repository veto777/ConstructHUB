import { describe, expect, it } from "vitest";
import { pdfTable } from "./lib/g6-pdf";

/** A one-page PDF around a content stream (uncompressed, WinAnsi), like the SD Plumbing Commission's lists. */
function pdf(content: string): Uint8Array {
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /TrueType /BaseFont /Calibri /Encoding /WinAnsiEncoding >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
  ];
  return new TextEncoder().encode("%PDF-1.7\n" + objs.map((o, i) => `${i + 1} 0 obj\n${o}\nendobj\n`).join("") + "trailer << /Root 1 0 R >>\n%%EOF");
}

// Runs as Excel prints them (positions and kerned TJ arrays from sd list_of_small_wastewater.pdf, 2026-10-15).
const CONTENT = [
  "BT /F1 9.96 Tf 1 0 0 1 44.4 722.04 Tm [(C)-1.9 (it)-5.4 (y)]TJ ET",
  "BT /F1 9.96 Tf 1 0 0 1 173.76 722.04 Tm [(L)-5.5 (icense T)-17.5 (ype)]TJ ET",
  "BT /F1 9.96 Tf 1 0 0 1 274.6 722.04 Tm [(Name)]TJ ET",
  "BT /F1 9.96 Tf 1 0 0 1 390.4 722.04 Tm [(Employer Name)]TJ ET",
  "BT /F1 12 Tf 1 0 0 1 44.64 707.52 Tm [(A)30 (BERDEEN)]TJ ET",
  "BT /F1 9.96 Tf 1 0 0 1 174 696 Tm (SEPTIC INSTALLER) Tj ET",
  "BT /F1 9.96 Tf 1 0 0 1 274 684 Tm (BIEBER, LINCOLN) Tj ET",
  "BT /F1 9.96 Tf 1 0 0 1 390 684 Tm (WALLY'S SKID STEER) Tj ET",
  "BT /F1 9.96 Tf 1 0 0 1 361 672 Tm (68107) Tj ET",
].join("\n");

describe("g6 PDF table reader", () => {
  it("reads header columns and assigns runs to them", () => {
    const rows = pdfTable(pdf(CONTENT), ["City", "License Type", "Name", "Employer Name"]).map((r) => r.cells);
    expect(rows[0]).toEqual({ city: "ABERDEEN", "license type": "", name: "", "employer name": "" });
    expect(rows[1]).toEqual({ city: "", "license type": "SEPTIC INSTALLER", name: "", "employer name": "" });
    expect(rows[2]).toEqual({ city: "", "license type": "", name: "BIEBER, LINCOLN", "employer name": "WALLY'S SKID STEER" });
    // A run starting left of a header (right-aligned) still goes to the nearer column.
    expect(rows[3]["employer name"]).toBe("68107");
  });
});

describe("SD plumbers (audit round 2)", () => {
  it("two unnumbered plumbers of one type, John A and John B Smith, stay two licenses (decision 7)", async () => {
    const { LicenseSet } = await import("../xref");
    const base = { state: "SD", source: "South Dakota Plumbing Commission licensed plumbers", sourceUrl: "https://dlr.sd.gov/plumbing/consumer_info.aspx", businessName: null,
      licenseNumber: null, licenseType: "Journeyman Plumber", specialty: null, status: "Listed as licensed", city: "SIOUX FALLS", expires: null, matchedOn: "principal" as const, holder: "individual" as const };
    const set = new LicenseSet();
    set.add({ ...base, principal: "JOHN A SMITH", people: [{ name: "JOHN A SMITH", role: "Journeyman Plumber" }] });
    set.add({ ...base, principal: "JOHN B SMITH", people: [{ name: "JOHN B SMITH", role: "Journeyman Plumber" }] });
    set.add({ ...base, principal: "JOHN A SMITH", city: "RAPID CITY", people: [{ name: "JOHN A SMITH", role: "Journeyman Plumber" }] });
    expect(set.list.map((h) => `${h.principal}|${h.city}`)).toEqual(["JOHN A SMITH|SIOUX FALLS", "JOHN B SMITH|SIOUX FALLS", "JOHN A SMITH|RAPID CITY"]);
  });
});

// dor.sd.gov/businesses/taxes/, 2026-10-15: the report's link.
const DOR_LINK = `<a href="#delinquent">Top 100 Delinquent Report</a>
<a href="/media/05oddt20/9-15-2026-100-top-delinquent-report.pdf" title="Top 100 Delinquent Report" class="btn btn-primary">Click Here</a>`;

// 9-15-2026-100-top-delinquent-report.pdf through pdftotext -layout (trimmed). The person's street is replaced here.
const DELINQUENT = `SOUTH DAKOTA BUSINESS TAX DELINQUENT REPORT
                               REPORT DATE: 09/15/2026
     Owner Name
     DBA Name                              Address                         City            State     Tax Due     Interest Due   Penalty Due          Total Due

     IPIPELINE INC                         222 VALLEY CREEK BLVD STE 300   EXTON           PA      $336,254.00    $220,659.52    $33,611.40         $590,524.92

     IPIPELINE

Page 12 of 13                                                                                                                               09/15/2026
     Owner Name
     DBA Name                           Address         City            State         Tax Due         Interest Due   Penalty Due          Total Due

     VANCE GOODMANSON                   [street]        BELLE FOURCHE   SD            $4,423.34         $32,680.39         $0.00          $37,103.73

     GOODMANSON PLUMBING & HEATING

     DAKOTA PALLETS-WOOD PRODUCTS INC   PO BOX 46       BERESFORD       SD            $4,545.85         $32,515.82         $0.00          $37,061.67

     DAKOTA PALLETS-WOOD PRODUCTS INC



                                                                                $7,660,199.37     $11,523,576.23     $632,979.11      $19,816,754.71
`;

describe("SD Department of Revenue business tax delinquent report", async () => {
  const { delinquentPdfUrl, parseDelinquent, delinquentHits } = await import("./sd");

  it("finds the report's PDF by its link title", () => {
    expect(delinquentPdfUrl(DOR_LINK)).toBe("https://dor.sd.gov/media/05oddt20/9-15-2026-100-top-delinquent-report.pdf");
  });

  it("reads owner, DBA, address and amounts; skips headers, footers and the total line", () => {
    const { reportDate, rows } = parseDelinquent(DELINQUENT);
    expect(reportDate).toBe("2026-09-15");
    expect(rows.map((r) => [r.owner, r.dba, r.city, r.st, r.total])).toEqual([
      ["IPIPELINE INC", "IPIPELINE", "EXTON", "PA", 590524.92],
      ["VANCE GOODMANSON", "GOODMANSON PLUMBING & HEATING", "BELLE FOURCHE", "SD", 37103.73],
      ["DAKOTA PALLETS-WOOD PRODUCTS INC", "DAKOTA PALLETS-WOOD PRODUCTS INC", "BERESFORD", "SD", 37061.67],
    ]);
    expect(rows[2]).toMatchObject({ address: "PO BOX 46", tax: 4545.85, interest: 32515.82, penalty: 0 });
  });

  it("companies only: a person's row (and its DBA) is left out; a business is indexed by its name and a different DBA", () => {
    const { reportDate, rows } = parseDelinquent(DELINQUENT);
    expect(delinquentHits(rows[1], reportDate)).toEqual([]);
    const ip = delinquentHits(rows[0], reportDate);
    expect(ip.map((h) => h.business)).toEqual(["IPIPELINE INC", "IPIPELINE"]);
    expect(ip.every((h) => h.person === null)).toBe(true);
    expect(ip[0].hit).toMatchObject({ category: "tax_lien", name: "IPIPELINE INC dba IPIPELINE", date: "2026-09-15", amount: 590524.92, adverse: true, city: "EXTON, PA", address: "222 VALLEY CREEK BLVD STE 300, EXTON, PA" });
    expect((ip[0].hit as any).status).toBe("On the business tax delinquent report of 09/15/2026: a lien has been filed");
    expect(delinquentHits(rows[2], reportDate).map((h) => h.business)).toEqual(["DAKOTA PALLETS-WOOD PRODUCTS INC"]);
  });
});
