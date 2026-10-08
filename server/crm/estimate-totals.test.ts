/**
 * shared/estimate-totals.ts — the ONE money function behind the public
 * estimate page's live preview AND the server's approve-time recompute.
 * Pure unit tests, no server.
 *
 * The defect these pin: with scopes ticked, the "Your new total" line under
 * Optional discounts quoted the discount applied to the ORIGINAL estimate
 * (e.g. 95% of the full document) instead of to the ticked scope.
 *
 * Optional discounts are percent-only. A FIXED concession is a kind="discount"
 * line item, so "fixed" below is exercised that way.
 */
import { describe, it, expect } from "vitest";
import {
  amountDueCents, computeApprovalTotals, lineBases, previewEstimatePage, sumLineBases, totalsFromBases,
} from "@shared/estimate-totals";

const line = (unitPriceCents: number, over: Partial<any> = {}) => ({
  kind: "labor", unitPriceCents, quantityMilli: 1000, taxable: true, ...over,
});

// The document as written, and two alternative scopes.
const DOC = [line(20_000_00)];
const SCOPE_A = { id: "a", name: "Good", items: [line(8_000_00)] };
const SCOPE_B = { id: "b", name: "Best", items: [line(12_000_00), line(500_00, { taxable: false })] };
const FIXED = line(300_00, { kind: "discount" }); // a fixed $300 off, as a line

/** What the server puts in the public payload for one estimate + scopes. */
function payload(docItems: any[], taxRateBps: number) {
  const b = lineBases(docItems);
  return {
    subtotalCents: b.subtotalCents, discountCents: b.lineDiscountCents,
    taxableBaseCents: Math.max(0, b.taxableCents - b.lineDiscountCents), taxRateBps,
  };
}
const scopePayload = (s: { id: string; items: any[] }) => ({ id: s.id, ...lineBases(s.items) });

describe("previewEstimatePage — option A/B × discount none/percent/fixed × tax", () => {
  const cases: {
    name: string; scope: typeof SCOPE_A | null; fixed: boolean; offerBps: number[]; taxBps: number;
    doc: number; note: number;
  }[] = [
    // No scope ticked: the note quotes the document.
    { name: "no scope, no discount, no tax", scope: null, fixed: false, offerBps: [], taxBps: 0, doc: 20_000_00, note: 20_000_00 },
    { name: "no scope, 5%, no tax", scope: null, fixed: false, offerBps: [500], taxBps: 0, doc: 19_000_00, note: 19_000_00 },
    { name: "no scope, 5%, 7% tax", scope: null, fixed: false, offerBps: [500], taxBps: 700, doc: 20_330_00, note: 20_330_00 },
    { name: "no scope, fixed $300, 7% tax", scope: null, fixed: true, offerBps: [], taxBps: 700, doc: 21_079_00, note: 21_079_00 },
    { name: "no scope, fixed $300 + 5%, 7% tax", scope: null, fixed: true, offerBps: [500], taxBps: 700, doc: 20_025_05, note: 20_025_05 },
    // Scope A ticked ($8,000): the note quotes A — NOT 95% of $20,000.
    { name: "A, no discount, no tax", scope: SCOPE_A, fixed: false, offerBps: [], taxBps: 0, doc: 20_000_00, note: 8_000_00 },
    { name: "A, 5%, no tax", scope: SCOPE_A, fixed: false, offerBps: [500], taxBps: 0, doc: 19_000_00, note: 7_600_00 },
    { name: "A, 5%, 7% tax", scope: SCOPE_A, fixed: false, offerBps: [500], taxBps: 700, doc: 20_330_00, note: 8_132_00 },
    { name: "A, 1%+2%, 7% tax", scope: SCOPE_A, fixed: false, offerBps: [100, 200], taxBps: 700, doc: 20_758_00, note: 8_303_20 },
    // Scope B ticked ($12,000 taxable + $500 not): discount and tax touch only the taxable part.
    { name: "B, no discount, 7% tax", scope: SCOPE_B, fixed: false, offerBps: [], taxBps: 700, doc: 21_400_00, note: 13_340_00 },
    { name: "B, 5%, no tax", scope: SCOPE_B, fixed: false, offerBps: [500], taxBps: 0, doc: 19_000_00, note: 11_900_00 },
    { name: "B, 5%, 7% tax", scope: SCOPE_B, fixed: false, offerBps: [500], taxBps: 700, doc: 20_330_00, note: 12_698_00 },
    // The document's own fixed line discount does not travel into a scope.
    { name: "B, 5%, 7% tax, doc has fixed $300", scope: SCOPE_B, fixed: true, offerBps: [500], taxBps: 700, doc: 20_025_05, note: 12_698_00 },
  ];

  it.each(cases)("$name", (c) => {
    const docItems = c.fixed ? [...DOC, FIXED] : DOC;
    const offers = c.offerBps.map((percentBps) => ({ percentBps }));
    const p = previewEstimatePage(payload(docItems, c.taxBps), c.scope ? [scopePayload(c.scope)] : [], offers);

    expect(p.document.totalCents).toBe(c.doc);
    expect(p.noteTotalCents).toBe(c.note);
    expect(p.noteBasis).toBe(c.scope ? "scopes" : "document");

    // The preview is the server's number: "Approve this estimate" signs the
    // document's items; "Generate my estimate" + approve signs the scope's.
    expect(p.document.totalCents).toBe(computeApprovalTotals(docItems, c.taxBps, offers).totalCents);
    if (c.scope) {
      expect(p.scopes!.totalCents).toBe(computeApprovalTotals(c.scope.items, c.taxBps, offers).totalCents);
    } else {
      expect(p.scopes).toBeNull();
    }
  });

  it("the reported defect: A ticked + 5% is 95% of A, never 95% of the original", () => {
    const p = previewEstimatePage(payload(DOC, 0), [scopePayload(SCOPE_A)], [{ percentBps: 500 }]);
    expect(p.noteTotalCents).toBe(7_600_00);
    expect(p.noteTotalCents).not.toBe(19_000_00);
  });

  it("A and B ticked together are one document: bases add before discount and tax", () => {
    const offers = [{ percentBps: 500 }];
    const p = previewEstimatePage(payload(DOC, 700), [scopePayload(SCOPE_A), scopePayload(SCOPE_B)], offers);
    expect(p.scopes!.totalCents)
      .toBe(computeApprovalTotals([...SCOPE_A.items, ...SCOPE_B.items], 700, offers).totalCents);
    expect(p.scopes!.totalCents).toBe(20_830_00); // 20,500 − 1,000 + 7% of 19,000
  });

  it("a scope carrying its own fixed discount line totals like the regenerated estimate", () => {
    const scope = { id: "c", items: [line(1_000_00), line(100_00, { kind: "discount" })] };
    const offers = [{ percentBps: 1000 }];
    const p = previewEstimatePage(payload(DOC, 1000), [scopePayload(scope)], offers);
    // base 900, −10% = 810, tax 81 → 1000 − 100 − 90 + 81
    expect(p.scopes!.totalCents).toBe(891_00);
    expect(p.scopes!.totalCents).toBe(computeApprovalTotals(scope.items, 1000, offers).totalCents);
  });

  it("offers are capped at 100% and negative offers are ignored", () => {
    const p = previewEstimatePage(payload(DOC, 700), [scopePayload(SCOPE_B)],
      [{ percentBps: 9000 }, { percentBps: 5000 }, { percentBps: -400 }]);
    expect(p.scopes!.optionalDiscountBps).toBe(10_000);
    expect(p.scopes!.totalCents).toBe(500_00); // only the non-taxable line is left
    expect(p.document.totalCents).toBe(0);
  });

  it("sumLineBases + totalsFromBases agree with computeApprovalTotals on odd cents", () => {
    const items = [line(33_33, { quantityMilli: 2333 }), line(19_99, { taxable: false }), line(7_77, { kind: "discount" })];
    const split = sumLineBases([lineBases(items.slice(0, 1)), lineBases(items.slice(1))]);
    expect(totalsFromBases(split, 825, [{ percentBps: 300 }]))
      .toEqual(computeApprovalTotals(items, 825, [{ percentBps: 300 }]));
  });
});

describe("amountDueCents — deposit vs the signed total", () => {
  const quoted = 10_000_00;
  const cases: { name: string; depositPct: number | null; approved: number | null; due: number }[] = [
    { name: "no deposit, not discounted → the quoted total", depositPct: null, approved: null, due: 10_000_00 },
    { name: "no deposit, 5% off → the approved total", depositPct: null, approved: 9_500_00, due: 9_500_00 },
    { name: "30% deposit, not discounted", depositPct: 30, approved: null, due: 3_000_00 },
    { name: "30% deposit, 5% off → the deposit as written", depositPct: 30, approved: 9_500_00, due: 3_000_00 },
    { name: "50% deposit, 13% off", depositPct: 50, approved: 8_700_00, due: 5_000_00 },
    // The money bug: a deposit valid against the QUOTE but above the signed total.
    { name: "100% deposit, 5% off → capped at the approved total", depositPct: 100, approved: 9_500_00, due: 9_500_00 },
    { name: "97% deposit, 5% off → capped at the approved total", depositPct: 97, approved: 9_500_00, due: 9_500_00 },
    { name: "100% deposit, 100% off → nothing due", depositPct: 100, approved: 0, due: 0 },
    { name: "a zero deposit means no deposit", depositPct: 0, approved: 9_500_00, due: 9_500_00 },
  ];
  it.each(cases)("$name", (c) => {
    const depositCents = c.depositPct == null ? null : Math.round((quoted * c.depositPct) / 100);
    expect(amountDueCents({ depositCents, approvedTotalCents: c.approved, totalCents: quoted })).toBe(c.due);
  });
});
