/**
 * shared/payment-settings.ts — the reconciliation-prompt schedule and the
 * receipt switches, as the server and the Settings page read them.
 */
import { describe, it, expect } from "vitest";
import { parseDayList, reconcileSettingsOf, receiptSettingsOf, DEFAULT_RECONCILE, offlinePaymentInstructionsFor } from "@shared/payment-settings";

describe("day list", () => {
  it("parses '1, 3, 5' and tolerates spaces, semicolons, duplicates and order", () => {
    expect(parseDayList("1, 3, 5")).toEqual([1, 3, 5]);
    expect(parseDayList("5;1 3 3")).toEqual([1, 3, 5]);
    expect(parseDayList([2, 4])).toEqual([2, 4]);
  });
  it("drops junk, zero, negatives and anything past 60 days; keeps at most 10 steps", () => {
    expect(parseDayList("0, -1, abc, 7, 61")).toEqual([7]);
    expect(parseDayList("1,2,3,4,5,6,7,8,9,10,11,12")).toHaveLength(10);
    expect(parseDayList("")).toEqual([]);
  });
});

describe("reconcile settings", () => {
  it("defaults to on, day 1/3/5 for both series, optional photo, PM + sales, email on, text off", () => {
    expect(reconcileSettingsOf(null)).toEqual(DEFAULT_RECONCILE);
    expect(reconcileSettingsOf({ payments: {} })).toEqual(DEFAULT_RECONCILE);
  });
  it("reads a saved shape and falls back per field", () => {
    const s = reconcileSettingsOf({ payments: { reconcile: {
      enabled: false, approvalDays: "2, 4", closeoutDays: [], photo: "required", notify: "owners", channels: { email: false, sms: true },
    } } });
    expect(s.enabled).toBe(false);
    expect(s.approvalDays).toEqual([2, 4]);
    expect(s.closeoutDays).toEqual([1, 3, 5]); // empty → default
    expect(s.photo).toBe("required");
    expect(s.notify).toBe("owners");
    expect(s.channels).toEqual({ email: false, sms: true });
    expect(reconcileSettingsOf({ payments: { reconcile: { photo: "bogus", notify: "bogus" } } })).toMatchObject({ photo: "optional", notify: "pm_sales", enabled: true });
  });
});

describe("receipt settings", () => {
  it("defaults to email on, text off", () => {
    expect(receiptSettingsOf(null)).toEqual({ email: true, sms: false });
  });
  it("is the paymentReceipt notification pref's email / sms channels — one switch, not two", () => {
    expect(receiptSettingsOf({ notificationPrefs: { paymentReceipt: false } })).toEqual({ email: false, sms: false });
    expect(receiptSettingsOf({ notificationPrefs: { paymentReceipt: { email: true, sms: true } } })).toEqual({ email: true, sms: true });
    expect(receiptSettingsOf({ notificationPrefs: { paymentReceipt: { email: false, sms: false } } })).toEqual({ email: false, sms: false });
    // A stale payments.receipts key (never shipped) is ignored.
    expect(receiptSettingsOf({ payments: { receipts: { email: false, sms: true } } })).toEqual({ email: true, sms: false });
  });
});

describe("check / Zelle instructions per division", () => {
  const org = { payments: { offlineInstructions: "Company-wide: Zelle pay@acme.test" } };
  it("uses the division's own text when it has one", () => {
    expect(offlinePaymentInstructionsFor(org, { offlinePaymentInstructions: "  FL: Zelle fl@acme.test " })).toBe("FL: Zelle fl@acme.test");
  });
  it("falls back to the company-wide text when the division is blank or missing", () => {
    expect(offlinePaymentInstructionsFor(org, { offlinePaymentInstructions: "   " })).toBe("Company-wide: Zelle pay@acme.test");
    expect(offlinePaymentInstructionsFor(org, null)).toBe("Company-wide: Zelle pay@acme.test");
    expect(offlinePaymentInstructionsFor(org)).toBe("Company-wide: Zelle pay@acme.test");
  });
  it("is null when neither is set", () => {
    expect(offlinePaymentInstructionsFor({}, { taxRates: {} })).toBeNull();
  });
});
