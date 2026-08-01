import { describe, expect, it } from "vitest";
import {
  cartSubtotalCents, lineTotalCents, milliToQty, money, priceToCents, qtyToMilli,
} from "../../client/src/lib/estimate-math";

// The mobile estimate builder's client-side math. The server recomputes on
// create — these tests pin the UI to the same rounding so the running total
// never disagrees with the saved estimate.
describe("estimate-math (mobile builder)", () => {
  it("line totals round like the server (price × qty/1000)", () => {
    expect(lineTotalCents({ quantityMilli: 1000, unitPriceCents: 10000 })).toBe(10000);
    expect(lineTotalCents({ quantityMilli: 2000, unitPriceCents: 10000 })).toBe(20000);
    expect(lineTotalCents({ quantityMilli: 1500, unitPriceCents: 333 })).toBe(500);
    expect(lineTotalCents({ quantityMilli: 0, unitPriceCents: 10000 })).toBe(0);
  });

  it("subtotal sums the lines", () => {
    expect(cartSubtotalCents([
      { quantityMilli: 2000, unitPriceCents: 10000 },
      { quantityMilli: 1000, unitPriceCents: 25050 },
    ])).toBe(45050);
    expect(cartSubtotalCents([])).toBe(0);
  });

  it("parses quantity input into milli, tolerating junk", () => {
    expect(qtyToMilli("1")).toBe(1000);
    expect(qtyToMilli("2.5")).toBe(2500);
    expect(qtyToMilli("")).toBe(0);
    expect(qtyToMilli("abc")).toBe(0);
    expect(qtyToMilli("-3")).toBe(0);
    expect(qtyToMilli("999999999")).toBe(100_000_000);
  });

  it("parses price input into cents, tolerating junk", () => {
    expect(priceToCents("100")).toBe(10000);
    expect(priceToCents("250.50")).toBe(25050);
    expect(priceToCents("0.01")).toBe(1);
    expect(priceToCents("")).toBe(0);
    expect(priceToCents("nope")).toBe(0);
    expect(priceToCents("-5")).toBe(0);
  });

  it("formats for display", () => {
    expect(money(45050)).toBe("$450.50");
    expect(money(0)).toBe("$0.00");
    expect(money(null)).toBe("—");
    expect(milliToQty(1500)).toBe("1.5");
  });
});
