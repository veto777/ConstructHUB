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
