/**
 * Rail policy — pure-function coverage for allowedRails/paymentSettingsOf.
 * The org decides the rails; the payer only picks among what's allowed.
 */
import { describe, it, expect } from "vitest";

// payments.ts transitively constructs a Stripe client at import time; a dummy
// key keeps this suite runnable with no env (no API call is ever made here).
process.env.STRIPE_SECRET_KEY ||= "sk_test_dummy";
const { allowedRails, paymentSettingsOf } = await import("./payments");

const acct = { chargesEnabled: true, achEnabled: true, cardEnabled: true };
const org = (payments: Record<string, unknown>) => ({ customFields: { payments } });

describe("paymentSettingsOf rail fields", () => {
  it("defaults to both / no threshold", () => {
    const s = paymentSettingsOf({ customFields: null });
    expect(s.railMode).toBe("both");
    expect(s.achOnlyOverCents).toBeNull();
  });

  it("rejects junk railMode and non-positive thresholds", () => {
    expect(paymentSettingsOf(org({ railMode: "cash" })).railMode).toBe("both");
    expect(paymentSettingsOf(org({ achOnlyOverCents: 0 })).achOnlyOverCents).toBeNull();
    expect(paymentSettingsOf(org({ achOnlyOverCents: -5 })).achOnlyOverCents).toBeNull();
    expect(paymentSettingsOf(org({ achOnlyOverCents: "nope" })).achOnlyOverCents).toBeNull();
  });
});

describe("allowedRails", () => {
  it("offers both by default when the account supports both", () => {
    expect(allowedRails(org({}), acct, 10_000)).toEqual({ ach: true, card: true });
  });

  it("ach_only withholds card even when the account supports it", () => {
    expect(allowedRails(org({ railMode: "ach_only" }), acct, 10_000)).toEqual({ ach: true, card: false });
  });

  it("card_only withholds ach", () => {
    expect(allowedRails(org({ railMode: "card_only" }), acct, 10_000)).toEqual({ ach: false, card: true });
  });

  it("threshold drops card at/above the amount, keeps it below", () => {
    const o = org({ achOnlyOverCents: 500_000 }); // $5,000
    expect(allowedRails(o, acct, 499_999)).toEqual({ ach: true, card: true });
    expect(allowedRails(o, acct, 500_000)).toEqual({ ach: true, card: false });
    expect(allowedRails(o, acct, 2_500_000)).toEqual({ ach: true, card: false });
  });

  it("threshold never strands a payment when ACH capability is missing", () => {
    const noAch = { chargesEnabled: true, achEnabled: false, cardEnabled: true };
    expect(allowedRails(org({ achOnlyOverCents: 500_000 }), noAch, 2_500_000))
      .toEqual({ ach: false, card: true });
  });

  it("policy narrows but never widens account capability", () => {
    const noCard = { chargesEnabled: true, achEnabled: true, cardEnabled: false };
    expect(allowedRails(org({ railMode: "card_only" }), noCard, 10_000)).toEqual({ ach: false, card: false });
    const off = { chargesEnabled: false, achEnabled: true, cardEnabled: true };
    expect(allowedRails(org({}), off, 10_000)).toEqual({ ach: false, card: false });
  });

  it("no connected account → no rails", () => {
    expect(allowedRails(org({}), null, 10_000)).toEqual({ ach: false, card: false });
  });
});
