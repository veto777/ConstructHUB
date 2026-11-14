/**
 * server/crm/invoice-math.ts squareDrawToTotal — "Request $5,000" bills $5,000
 * including tax, not $5,000 plus tax.
 */
import { describe, it, expect } from "vitest";
import { invoiceLinesTotalCents, squareDrawToTotal, progressInvoiceItems, depositNetCents, dollarDrawShare } from "./invoice-math";

const line = (name: string, cents: number, taxable = true) =>
  ({ kind: "labor", name, description: null, unit: null, quantityMilli: 1000, unitPriceCents: cents, taxable }) as any;

describe("squareDrawToTotal", () => {
  it("lands a taxed progress invoice on the dollars requested", () => {
    // The server derives the share from the dollars: pct = amount / signed total (tax included).
    const signedTotal = invoiceLinesTotalCents([line("Siding", 30_000_00), line("Windows", 10_000_00)], 910);
    for (const target of [5_000_00, 12_345_67, 250_00, 23_947_45, signedTotal - 1]) {
      const pct = Math.max(1, Math.min(10000, Math.round((target * 10000) / signedTotal)));
      const lines = progressInvoiceItems([line("Siding", 30_000_00), line("Windows", 10_000_00)], pct, 0);
      squareDrawToTotal(lines, 910, target);
      expect(Math.abs(invoiceLinesTotalCents(lines, 910) - target)).toBeLessThanOrEqual(1);
    }
  });

  it("exact when the largest line isn't taxed, and with no tax", () => {
    const a = [line("Permit", 9_000_00, false), line("Paint", 1_000_00)];
    squareDrawToTotal(a, 910, 8_000_00);
    expect(invoiceLinesTotalCents(a, 910)).toBe(8_000_00);
    const b = [line("Siding", 4_000_00)];
    squareDrawToTotal(b, 0, 5_000_00);
    expect(invoiceLinesTotalCents(b, 0)).toBe(5_000_00);
  });

  it("counts discounts before tax, like recalcInvoice", () => {
    const lines = [line("Siding", 10_000_00), { ...line("Accepted estimate discounts", 500_00), kind: "discount" }];
    expect(invoiceLinesTotalCents(lines, 1000)).toBe(10_450_00);
  });
});

// Audit 2026-11-14 H3: a typed dollar draw is before tax, so its cap and recorded share are too.
describe("dollarDrawShare", () => {
  const approval = { subtotalCents: 10_000_00, lineDiscountCents: 0, optionalDiscountCents: 0 };

  it("measures the share against the signed amount before tax", () => {
    // $10,000 of lines at 10% tax is $11,000 signed. $5,500 before tax is 55% of the job, not 50%.
    expect(dollarDrawShare(5_500_00, approval)).toEqual({ preTaxCents: 10_000_00, bps: 5500 });
    // Two such draws would be 110%: the 100% guard now refuses the second.
    expect(5500 + 5500).toBeGreaterThan(10000);
  });

  it("refuses more than the signed amount before tax", () => {
    // $10,500 is under the $11,000 signed total but would invoice $11,550 with tax.
    expect(dollarDrawShare(10_500_00, approval)).toEqual({ preTaxCents: 10_000_00, over: true });
    expect(dollarDrawShare(10_000_00, approval)).toEqual({ preTaxCents: 10_000_00, bps: 10000 });
  });

  it("takes line and accepted optional discounts off the base, and refuses a zero base", () => {
    expect(dollarDrawShare(4_000_00, { subtotalCents: 10_000_00, lineDiscountCents: 1_000_00, optionalDiscountCents: 1_000_00 }))
      .toEqual({ preTaxCents: 8_000_00, bps: 5000 });
    expect(dollarDrawShare(100, { subtotalCents: 0, lineDiscountCents: 0, optionalDiscountCents: 0 })).toEqual({ preTaxCents: 0, over: true });
  });

  it("a taxed dollar draw invoices its share of the signed total, never more", () => {
    const items = [line("Siding", 10_000_00)];
    const share = dollarDrawShare(5_500_00, approval) as { bps: number };
    const lines = progressInvoiceItems(items, share.bps, 0);
    expect(invoiceLinesTotalCents(lines, 1000)).toBe(6_050_00); // 55% of the $11,000 signed
  });
});

// Audit 2026-11-14 H4: a partly refunded deposit is credited at what is still held.
describe("depositNetCents", () => {
  it("takes the refund off the deposit", () => {
    expect(depositNetCents({ amountCents: 5_000_00, refundedCents: 2_000_00 })).toBe(3_000_00);
    expect(depositNetCents({ amountCents: 5_000_00, refundedCents: 0 })).toBe(5_000_00);
    expect(depositNetCents({ amountCents: 5_000_00 })).toBe(5_000_00);
    expect(depositNetCents({ amountCents: 5_000_00, refundedCents: 6_000_00 })).toBe(0);
  });
});
