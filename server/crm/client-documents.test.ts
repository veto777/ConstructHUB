/** server/crm/client-documents.ts — the printable per-payment receipt. */
import { describe, it, expect } from "vitest";
import { paymentReceiptPage } from "./client-documents";
import type { ReceiptData } from "./receipts";

const receipt: ReceiptData = {
  invoice: { id: "inv1", number: "INV-2001", title: "Siding", status: "partial", createdAt: null, dueAt: null, paidAt: null },
  customer: { displayName: "Jane Homeowner", email: "j@example.com", addressLine1: null, city: null, state: null, postalCode: null },
  items: [], subtotalCents: 10_000_00, discountCents: 0, taxCents: 0, totalCents: 10_000_00, retainageCents: 0,
  payments: [
    { id: "p2", amountCents: 3_000_00, method: "check", note: "Check #1042", paidAt: new Date("2026-10-10T12:00:00Z") },
    { id: "p1", amountCents: 2_000_00, method: "wire", note: null, paidAt: new Date("2026-10-01T12:00:00Z") },
  ],
  totalPaidCents: 5_000_00, balanceCents: 5_000_00, paidInFull: false,
  company: { name: "Alpine Exteriors", email: "office@example.com", phone: "(360) 555-0100" } as any,
  generatedAt: "2026-10-18T20:00:00.000Z",
};

describe("per-payment receipt", () => {
  it("shows the payment, how it was paid, and the balance after THAT payment (payments in date order)", () => {
    const html = paymentReceiptPage(receipt, "p1")!;
    expect(html).toContain("$2,000.00");
    expect(html).toContain("Wire transfer");
    expect(html).toContain("Paid to date (after this payment)</td><td>$2,000.00");
    expect(html).toContain("Balance after this payment</td><td>$8,000.00");
    const later = paymentReceiptPage(receipt, "p2")!;
    expect(later).toContain("Check #1042");
    expect(later).toContain("Paid to date (after this payment)</td><td>$5,000.00");
    expect(later).toContain("Balance after this payment</td><td>$5,000.00");
  });
  it("marks the receipt that settles the invoice PAID IN FULL and escapes text", () => {
    const paid = { ...receipt, payments: [...receipt.payments, { id: "p3", amountCents: 5_000_00, method: "cash", note: "<b>x</b>", paidAt: new Date("2026-10-12T12:00:00Z") }] };
    const html = paymentReceiptPage(paid, "p3")!;
    expect(html).toContain("PAID IN FULL");
    expect(html).toContain("&lt;b&gt;x&lt;/b&gt;");
    expect(html).not.toContain("<b>x</b>");
  });
  it("is null for a payment that is not on the invoice", () => {
    expect(paymentReceiptPage(receipt, "nope")).toBeNull();
  });
});
