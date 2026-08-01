/**
 * The signed-contract PDF builder (server/crm/contract-pdf.ts) — pure tests.
 *
 * The builder is exercised with compress:false so the page content streams
 * are plain text: assertions grep the raw PDF bytes for the number, totals,
 * signature, terms and the per-page footer instead of trusting a side-channel.
 */
import { describe, it, expect } from "vitest";
import {
  buildContractPdf,
  contractAdminRecipients,
  contractFileName,
  selectedDiscountDetails,
  type ContractPdfInput,
} from "./contract-pdf";

const INPUT: ContractPdfInput = {
  branding: {
    name: "Aspire Test Co",
    email: "office@aspire.example.com",
    phone: "555-0300",
    website: "https://aspire.example.com",
    addressLine1: "100 Palm Ave",
    addressLine2: null,
    city: "Tampa",
    state: "FL",
    postalCode: "33602",
    licenseNumber: "CBC1264418",
    licenseState: "FL",
  },
  orgName: "Aspire Test Co",
  customer: {
    displayName: "Mary Homeowner",
    email: "mary@example.com",
    phone: "555-0199",
    addressLine1: "42 Oak St",
    addressLine2: null,
    city: "Tampa",
    state: "FL",
    postalCode: "33603",
  },
  estimate: {
    number: "E-9001",
    title: "Whole-house re siding",
    createdAt: new Date("2026-07-01T12:00:00Z"),
    expiresAt: new Date("2026-08-01T12:00:00Z"),
    approvedAt: new Date("2026-07-15T12:00:00Z"),
    subtotalCents: 11_000_00,
    discountCents: 0,
    taxCents: 1_100_00,
    totalCents: 12_100_00,
    approvedTotalCents: 10_670_00,
    depositCents: null,
    signatureName: "Mary Homeowner",
    signatureIp: "203.0.113.10",
    termsText: "Estimate-specific terms apply here.",
    selectedDiscounts: [
      { id: "d1", code: "marketing", label: "Marketing discount", percentBps: 100 },
      { id: "d2", code: "military", label: "Military discount", percentBps: 200 },
    ],
  },
  items: [
    {
      name: "Remove existing siding", description: "Full tear-off and disposal",
      quantityMilli: 1000, unit: null, unitPriceCents: 5_000_00, lineTotalCents: 5_000_00,
    },
    {
      name: "Install fiber-cement siding", description: null,
      quantityMilli: 2200, unit: "sq", unitPriceCents: 2_500_00, lineTotalCents: 6_000_00,
    },
  ],
  options: [
    { name: "Good", description: "Vinyl siding, standard profile.", recommended: false, totalCents: 9_000_00 },
    { name: "Best", description: "Fiber-cement, 30-year finish warranty.", recommended: true, totalCents: 12_100_00 },
  ],
  terms: "Standing terms: payment is due on completion.",
};

/**
 * pdfkit subsets its fonts, so even with compress:false the page text rides
 * as hex glyph chunks inside `[…] TJ` arrays (`[<5072> 20 <6f626520436f>]`
 * is "Probe Co" with a kerning nudge). Decoding those arrays in order
 * reconstructs the document text exactly.
 */
function extractText(pdf: Buffer): string {
  const s = pdf.toString("latin1");
  let out = "";
  for (const m of s.matchAll(/\[([^\]]*)\]\s*TJ/g)) {
    for (const h of m[1].matchAll(/<([0-9a-fA-F]+)>/g)) {
      out += Buffer.from(h[1], "hex").toString("latin1");
    }
    out += "\n";
  }
  return out;
}

const text = extractText;
/** Wrap-tolerant view: pdfkit breaks long labels across lines. */
const flat = (pdf: Buffer) => extractText(pdf).replace(/\s+/g, " ");

describe("buildContractPdf", () => {
  it("carries the number, totals, options, items, terms and the signature", async () => {
    const pdf = await buildContractPdf(INPUT, { compress: false });
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    const t = flat(pdf);

    // Letterhead + document facts.
    expect(t).toContain("Aspire Test Co");
    expect(t).toContain("ESTIMATE");
    expect(t).toContain("E-9001");
    expect(t).toContain("CBC1264418");
    expect(t).toContain("https://aspire.example.com");

    // Prepared-for block.
    expect(t).toContain("PREPARED FOR");
    expect(t).toContain("42 Oak St");

    // Options with FULL descriptions and prices.
    expect(t).toContain("Vinyl siding, standard profile.");
    expect(t).toContain("Fiber-cement, 30-year finish warranty.");

    // Line items.
    expect(t).toContain("Remove existing siding");
    expect(t).toContain("Full tear-off and disposal");

    // Selected optional discounts with their labels.
    expect(t).toContain("Marketing discount");
    expect(t).toContain("Military discount");

    // Totals — the APPROVED total is the headline number.
    expect(t).toContain("$11,000.00"); // subtotal
    expect(t).toContain("$1,100.00");  // tax
    expect(t).toContain("Approved total");
    expect(t).toContain("$10,670.00");

    // Terms + signature block.
    expect(t).toContain("Estimate-specific terms apply here.");
    expect(t).toContain("Standing terms: payment is due on completion.");
    expect(t).toContain("Signed by");
    expect(t).toContain("Mary Homeowner");
    // The IP is recorded in the DB for dispute evidence but must NEVER print
    // on a client-facing document (owner directive 2026-08-01).
    expect(t).not.toContain("203.0.113.10");
    expect(t).not.toMatch(/\bIP\b/);

    // Footer band on the page (the full fixture may spill to a second page).
    expect(t).toMatch(/Page 1 of \d+/);
  });

  it("long terms flow to multiple pages — footer + page numbers on EVERY page", async () => {
    const longTerms = Array.from({ length: 120 }, (_, i) => `${i + 1}. The contractor shall perform the work in a workmanlike manner.`).join(" ");
    const pdf = await buildContractPdf({ ...INPUT, terms: longTerms }, { compress: false });
    const t = text(pdf);

    const pageMarks = t.match(/Page \d+ of \d+/g) ?? [];
    expect(pageMarks.length).toBeGreaterThanOrEqual(2);
    expect(t).toMatch(/Page 2 of \d+/);
    // The company · license · website band rides every page too.
    const bands = t.match(/Aspire Test Co/g) ?? [];
    expect(bands.length).toBeGreaterThanOrEqual(2);
    // And the last clause really made it onto a later page (word-wrap keeps
    // the token intact; the full phrase may straddle a line break).
    expect(t).toContain("120.");
  });

  it("never crashes with missing license/terms/items/options — minimal input still gets a footer", async () => {
    const minimal: ContractPdfInput = {
      branding: { name: "Bare Bones LLC" },
      orgName: "Bare Bones LLC",
      customer: { displayName: "Sam Client" },
      estimate: {
        number: null, title: "Small job",
        subtotalCents: 100_00, discountCents: 0, taxCents: 0, totalCents: 100_00,
        signatureName: "Sam Client", signatureIp: null, termsText: null, selectedDiscounts: null,
      },
      items: [],
      options: [],
      terms: null,
    };
    const pdf = await buildContractPdf(minimal, { compress: false });
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    const t = text(pdf);
    expect(t).toContain("Bare Bones LLC");
    expect(t).toContain("$100.00");
    expect(t).toContain("Signed by");
    expect(t).toContain("Page 1 of 1");
  });
});

describe("contractFileName", () => {
  it("sanitizes the estimate number", () => {
    expect(contractFileName("E-2001")).toBe("contract-E-2001.pdf");
    expect(contractFileName("EST 12/34 #5")).toBe("contract-EST_12_34_5.pdf");
    expect(contractFileName(null)).toBe("signed-contract.pdf");
  });
});

describe("contractAdminRecipients", () => {
  const members = [
    { email: "owner@co.com", role: "owner", status: "active" },
    { email: "admin@co.com", role: "admin", status: "active" },
    { email: "gone@co.com", role: "owner", status: "invited" },
  ];

  it("goes to active owners (fallback: the org email) when the pref is ON", () => {
    expect(contractAdminRecipients({ prefEnabled: true, members, orgEmail: "office@co.com" }))
      .toEqual(["owner@co.com"]);
    expect(contractAdminRecipients({ prefEnabled: true, members: [], orgEmail: "office@co.com" }))
      .toEqual(["office@co.com"]);
    expect(contractAdminRecipients({ prefEnabled: true, members: [], orgEmail: null })).toEqual([]);
  });

  it("is silenced when the org turns contractSigned off — the client copy is unaffected (handled by the caller)", () => {
    expect(contractAdminRecipients({ prefEnabled: false, members, orgEmail: "office@co.com" })).toEqual([]);
  });
});

describe("selectedDiscountDetails", () => {
  it("reads labels + percents from the stored selection records", () => {
    expect(selectedDiscountDetails(INPUT.estimate.selectedDiscounts)).toEqual([
      { label: "Marketing discount", percentBps: 100 },
      { label: "Military discount", percentBps: 200 },
    ]);
    expect(selectedDiscountDetails(null)).toEqual([]);
    expect(selectedDiscountDetails("junk")).toEqual([]);
    expect(selectedDiscountDetails([{ code: "x" }])).toEqual([]);
  });
});
