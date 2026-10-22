/**
 * server/crm/invoice-math.ts squareDrawToTotal — "Request $5,000" bills $5,000
 * including tax, not $5,000 plus tax.
 */
import { describe, it, expect } from "vitest";
import { invoiceLinesTotalCents, squareDrawToTotal, progressInvoiceItems } from "./invoice-math";

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
