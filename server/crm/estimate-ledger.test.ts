/**
 * shared/estimate-ledger.ts — the balance card, the payment-request limits and
 * the receipt's "balance after this payment". Pure unit tests, no server.
 */
import { describe, it, expect } from "vitest";
import { estimateLedger, depositCreditFor, balanceAfterPayment, invoiceDueNowCents } from "@shared/estimate-ledger";

const pay = (id: string, amountCents: number, extra: Record<string, unknown> = {}) =>
  ({ id, amountCents, status: "succeeded", paidAt: `2026-10-0${id.length}T12:00:00Z`, ...extra });

describe("estimateLedger", () => {
  it("nothing paid, nothing billed: the whole contract is owed and billable", () => {
    const l = estimateLedger(45_500_16, [], []);
    expect(l).toMatchObject({ contractCents: 45_500_16, paidCents: 0, billedCents: 0, openRequestsCents: 0,
      remainingToBillCents: 45_500_16, balanceCents: 45_500_16, paidInFull: false });
  });

  it("deposit on the estimate, a progress request part paid", () => {
    const l = estimateLedger(40_000_00,
      [pay("d", 10_000_00), pay("pp", 5_000_00, { invoiceId: "i1" })],
      [{ id: "i1", totalCents: 15_000_00, paidCents: 5_000_00 }]);
    expect(l.paidCents).toBe(15_000_00);
    expect(l.billedCents).toBe(15_000_00);
    expect(l.openRequestsCents).toBe(10_000_00);
    expect(l.remainingToBillCents).toBe(25_000_00);
    expect(l.balanceCents).toBe(25_000_00);
  });

  it("refunds come off what was paid; voided requests are not billed; a payment listed twice counts once", () => {
    const p = pay("a", 10_000_00, { refundedCents: 2_000_00, status: "partially_refunded" });
    const l = estimateLedger(20_000_00, [p, p, pay("b", 999, { status: "pending" })],
      [{ id: "v", totalCents: 20_000_00, voidedAt: "2026-10-01" }]);
    expect(l.paidCents).toBe(8_000_00);
    expect(l.refundedCents).toBe(2_000_00);
    expect(l.billedCents).toBe(0);
    expect(l.balanceCents).toBe(12_000_00);
  });

  it("paid in full only when the balance is zero", () => {
    expect(estimateLedger(1_000_00, [pay("a", 1_000_00)], []).paidInFull).toBe(true);
    expect(estimateLedger(1_000_00, [pay("a", 999_99)], []).paidInFull).toBe(false);
    expect(estimateLedger(0, [], []).paidInFull).toBe(false);
  });

  it("bank transfers still settling are shown apart, not as paid", () => {
    const l = estimateLedger(1_000_00, [pay("a", 500_00, { status: "processing" })], []);
    expect(l.paidCents).toBe(0);
    expect(l.processingCents).toBe(500_00);
  });

  it("retainage is not due now", () => {
    expect(invoiceDueNowCents({ id: "i", totalCents: 10_000_00, retainageCents: 1_000_00, paidCents: 2_000_00 })).toBe(7_000_00);
  });
});

describe("depositCreditFor", () => {
  it("credits whole deposits, oldest first, never past what the request asks", () => {
    const deps = [pay("bb", 3_000_00), pay("a", 5_000_00), pay("ccc", 4_000_00)];
    // a (5k) then bb (3k) fit in 9k; ccc (4k) would overshoot.
    expect(depositCreditFor(deps, 9_000_00)).toBe(8_000_00);
    expect(depositCreditFor(deps, 2_000_00)).toBe(0);
  });

  it("skips deposits already on an invoice and payments not received", () => {
    expect(depositCreditFor([pay("a", 1_000_00, { invoiceId: "i" }), pay("b", 1_000_00, { status: "pending" })], 5_000_00)).toBe(0);
  });
});

describe("balanceAfterPayment", () => {
  const list = [pay("a", 10_000_00), pay("bb", 15_000_00), pay("ccc", 15_000_00)];

  it("walks the payments in date order", () => {
    expect(balanceAfterPayment(40_000_00, list, "a")).toMatchObject({ paidThroughCents: 10_000_00, balanceAfterCents: 30_000_00, paidInFull: false });
    expect(balanceAfterPayment(40_000_00, list, "ccc")).toMatchObject({ paidThroughCents: 40_000_00, balanceAfterCents: 0, paidInFull: true });
  });

  it("never stamps PAID IN FULL when money went back", () => {
    const r = balanceAfterPayment(40_000_00, [...list.slice(0, 2), { ...list[2], refundedCents: 1_00, status: "partially_refunded" }], "ccc");
    expect(r?.balanceAfterCents).toBe(0);
    expect(r?.refundedSinceCents).toBe(1_00);
    expect(r?.paidInFull).toBe(false);
  });

  it("unknown or unpaid payment → null", () => {
    expect(balanceAfterPayment(1, list, "zzz")).toBeNull();
    expect(balanceAfterPayment(1, [pay("p", 5, { status: "pending" })], "p")).toBeNull();
  });
});
