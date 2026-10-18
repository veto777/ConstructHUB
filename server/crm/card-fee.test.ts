/**
 * The card-fee pass-through, pure parts (server/crm/payments.ts):
 *   - the quote a payer is shown before choosing card,
 *   - which rails a Checkout session offers for a pinned / unpinned choice,
 *   - the fee line that rides on a card checkout,
 *   - the choice validation that turns a withheld rail into a 400.
 * No Stripe, no database.
 */
import { describe, it, expect } from "vitest";
import { cardFeeCents, cardFeeQuote, cardFeeLineItem, checkoutMethods, resolvePayChoice, paymentSettingsOf } from "./payments";

const org = (payments: Record<string, unknown> | undefined) => ({ customFields: payments ? { payments } : {} });
const alpine = org({ passFeeToClient: true, surchargeBps: 300, railMode: "both" });
const absorbs = org({ passFeeToClient: false, surchargeBps: 300 });
const unset = org(undefined);

describe("card fee quote", () => {
  it("is 3% of the amount, rounded to the cent, only when the org passes it through", () => {
    expect(cardFeeCents(alpine, 30_850_00)).toBe(925_50);
    expect(cardFeeCents(alpine, 1_01)).toBe(3); // 3.03¢ → 3¢
    expect(cardFeeCents(absorbs, 30_850_00)).toBe(0);
    expect(cardFeeCents(unset, 30_850_00)).toBe(0);
  });

  it("quotes rate, fee and card total for the payer, and nothing when card is off or absorbed", () => {
    expect(cardFeeQuote(alpine, { card: true }, 10_000_00)).toEqual({ bps: 300, feeCents: 300_00, totalCents: 10_300_00 });
    expect(cardFeeQuote(alpine, { card: false }, 10_000_00)).toBeNull();
    expect(cardFeeQuote(absorbs, { card: true }, 10_000_00)).toBeNull();
    expect(cardFeeQuote(unset, { card: true }, 10_000_00)).toBeNull();
  });

  it("caps the stored rate at 10% and ignores junk", () => {
    expect(paymentSettingsOf(org({ passFeeToClient: true, surchargeBps: 5000 })).surchargeBps).toBe(1000);
    expect(paymentSettingsOf(org({ passFeeToClient: true, surchargeBps: "abc" })).surchargeBps).toBeNull();
    expect(paymentSettingsOf(org({ passFeeToClient: true, surchargeBps: -5 })).surchargeBps).toBeNull();
  });
});

describe("checkout rails", () => {
  const both = { ach: true, card: true };
  it("pins an explicit choice to that one rail", () => {
    expect(checkoutMethods(both, "card", true)).toEqual(["card"]);
    expect(checkoutMethods(both, "ach", true)).toEqual(["us_bank_account"]);
  });
  it("an unpinned session with a card fee and ACH offers ACH only — the fee can never be skipped", () => {
    expect(checkoutMethods(both, undefined, true)).toEqual(["us_bank_account"]);
  });
  it("an unpinned session without a fee offers both, ACH first; card-only accounts still get card", () => {
    expect(checkoutMethods(both, undefined, false)).toEqual(["us_bank_account", "card"]);
    expect(checkoutMethods({ ach: false, card: true }, undefined, true)).toEqual(["card"]);
    expect(checkoutMethods({ ach: true, card: false }, undefined, false)).toEqual(["us_bank_account"]);
  });
});

describe("pay choice", () => {
  it("accepts an offered rail and refuses a withheld one with a reason", () => {
    expect(resolvePayChoice("card", { ach: true, card: true })).toEqual({ choice: "card" });
    expect(resolvePayChoice(undefined, { ach: true, card: true })).toEqual({ choice: undefined });
    expect(resolvePayChoice("card", { ach: true, card: false }).error).toMatch(/Card payment isn't available/);
    expect(resolvePayChoice("ach", { ach: false, card: true }).error).toMatch(/Bank transfer \(ACH\) isn't available/);
  });
  it("a method that is not card or ach is refused, never treated as unspecified", () => {
    expect(resolvePayChoice("nonsense", { ach: true, card: true }).error).toMatch(/method must be card or ach/);
  });
  it("with a card fee on and card the only rail, an unpinned checkout is a card checkout (the fee is never skippable)", () => {
    expect(resolvePayChoice(undefined, { ach: false, card: true }, true)).toEqual({ choice: "card" });
    expect(resolvePayChoice("", { ach: false, card: true }, true)).toEqual({ choice: "card" });
    // With ACH available the unpinned session offers ACH only (checkoutMethods), so no fee question arises.
    expect(resolvePayChoice(undefined, { ach: true, card: true }, true)).toEqual({ choice: undefined });
    expect(resolvePayChoice(undefined, { ach: false, card: true }, false)).toEqual({ choice: undefined });
  });
});

describe("fee line", () => {
  it("is a separate, labelled line for exactly the fee, in the account's currency", () => {
    const line = cardFeeLineItem(alpine, "usd", 925_50);
    expect(line.quantity).toBe(1);
    expect(line.price_data?.unit_amount).toBe(925_50);
    expect(line.price_data?.currency).toBe("usd");
    expect(line.price_data?.product_data?.name).toBe("Card processing fee (3.00%)");
    expect(line.price_data?.product_data?.description).toMatch(/bank transfer \(ACH\) to avoid this fee/i);
  });
});
