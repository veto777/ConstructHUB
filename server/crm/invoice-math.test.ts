import { describe, expect, it } from "vitest";
import { progressInvoiceItems, invoiceLinesTotalCents, squareDrawToTotal } from "./invoice-math";
const line = { kind: "labor", name: "Work", description: null, unit: "job", unitPriceCents: 100000, quantityMilli: 1000, taxable: true };
describe("progress invoice cents", () => {
  it("preserves original quantity and unit price for a full draw", () => {
    expect(progressInvoiceItems([line], 10000, 0)).toEqual([line]);
  });
  it("does not round a 33.33% draw down to 33.3% of an expensive unit", () => {
    const [draw] = progressInvoiceItems([line], 3333, 0);
    expect(draw.unitPriceCents * draw.quantityMilli / 1000).toBe(33330);
    expect(draw.description).toContain("33.33% progress billing");
  });
  it("rounds each line in cents and includes the accepted concession", () => {
    const rows = progressInvoiceItems([{ ...line, unitPriceCents: 101 }], 5000, 11);
    expect(rows[0].unitPriceCents).toBe(51);
    expect(rows[1]).toMatchObject({ kind: "discount", unitPriceCents: 6 });
  });
});

it("uses fractional basis points for invoices and exact draws", () => {
  const lines = [{ ...line, unitPriceCents: 1_000_000 }];
  expect(invoiceLinesTotalCents(lines, 662.5)).toBe(1066250);
  expect(invoiceLinesTotalCents(lines, 663)).toBe(1066300);
  squareDrawToTotal(lines, 662.5, 500000);
  expect(invoiceLinesTotalCents(lines, 662.5)).toBe(500000);
});
