import { describe, expect, it } from "vitest";
import { PLANS } from "@shared/plans";
import { CRM_PLANS } from "@shared/crm-plans";
import {
  HOLD_DAYS, annualRedeemable, blockReason, normalizeCode, qualify, rewardAmountCents, type CountedInvoice,
} from "./rules";

const DAY = 86_400_000;
const t0 = new Date("2026-11-01T12:00:00Z");
const inv = (o: Partial<CountedInvoice> & { day: number }): CountedInvoice => ({
  product: "platform", tier: "starter", interval: "month", amountPaid: 2900, amountRemaining: 0, refunded: false,
  paidAt: new Date(t0.getTime() + o.day * DAY), ...o,
});

describe("referrals — who can refer whom", () => {
  it("blocks a self-referral, by id or by the same address", () => {
    expect(blockReason({ id: 1, email: "a@x.com" }, { id: 1, email: "b@y.com" })).toBe("self");
    expect(blockReason({ id: 1, email: "Bob@Roofing.com" }, { id: 2, email: "bob@roofing.com " })).toBe("self");
  });
  it("blocks the same company domain, but not two strangers on free mail", () => {
    expect(blockReason({ id: 1, email: "owner@acmeroofing.com" }, { id: 2, email: "office@acmeroofing.com" })).toBe("same_company_domain");
    expect(blockReason({ id: 1, email: "a@gmail.com" }, { id: 2, email: "b@gmail.com" })).toBeNull();
    expect(blockReason({ id: 1, email: "a@acme.com" }, { id: 2, email: "b@other.com" })).toBeNull();
  });
  it("codes are 8 unambiguous characters; anything else is ignored", () => {
    expect(normalizeCode(" ab3d5f7h ")).toBe("AB3D5F7H");
    expect(normalizeCode("AB0D5F7H")).toBeNull();   // 0 is not in the alphabet
    expect(normalizeCode("ABC")).toBeNull();
    expect(normalizeCode("ABCDEFGH'; drop")).toBeNull();
  });
});

describe("referrals — qualification", () => {
  it("the third paid monthly invoice qualifies for a month, after the hold", () => {
    expect(qualify([inv({ day: 0 }), inv({ day: 30 })])).toBeNull();
    const q = qualify([inv({ day: 0 }), inv({ day: 30 }), inv({ day: 60, tier: "pro", amountPaid: 7900 })])!;
    expect(q.kind).toBe("month"); expect(q.tier).toBe("pro");
    expect(q.earnAt.getTime() - q.qualifiedAt.getTime()).toBe(HOLD_DAYS * DAY);
  });
  it("refunded and $0 (trial) invoices never count", () => {
    expect(qualify([inv({ day: -1, amountPaid: 0 }), inv({ day: 0 }), inv({ day: 30, refunded: true }), inv({ day: 60 })])).toBeNull();
  });
  it("an annual plan paid in full qualifies for the annual reward — one reward, annual wins", () => {
    const q = qualify([inv({ day: 0 }), inv({ day: 30 }), inv({ day: 60 }), inv({ day: 70, interval: "year", amountPaid: 29000 })])!;
    expect(q.kind).toBe("annual30");
  });
  it("an annual invoice not paid in full does not qualify", () => {
    expect(qualify([inv({ day: 0, interval: "year", amountPaid: 10000, amountRemaining: 19000 })])).toBeNull();
  });
});

describe("referrals — like for like amounts from the price book", () => {
  it("a month is the referred tier's month, capped at the referrer's own tier", () => {
    expect(rewardAmountCents("month", "platform", "starter", "agency")).toBe(PLANS.starter.monthlyCents);
    expect(rewardAmountCents("month", "platform", "agency", "starter")).toBe(PLANS.starter.monthlyCents);
    expect(rewardAmountCents("month", "crm", "crm_essentials", "crm_max")).toBe(CRM_PLANS.crm_essentials.monthlyCents);
  });
  it("annual30 is 30% of the lower annual price", () => {
    expect(rewardAmountCents("annual30", "platform", "pro", "pro")).toBe(Math.round(PLANS.pro.annualCents * 0.3));
    expect(rewardAmountCents("annual30", "crm", "crm_max", "crm_basic")).toBe(Math.round(CRM_PLANS.crm_basic.annualCents * 0.3));
  });
  it("no plan in that product line (or a wrong-line tier) → nothing to apply yet", () => {
    expect(rewardAmountCents("month", "platform", "pro", null)).toBeNull();
    expect(rewardAmountCents("month", "platform", "pro", "crm_basic")).toBeNull();
    expect(rewardAmountCents("month", "crm", "pro", "crm_basic")).toBeNull();
  });
  it("the annual reward is redeemable once every 365 days", () => {
    const now = new Date("2027-06-01T00:00:00Z");
    expect(annualRedeemable(null, now)).toBe(true);
    expect(annualRedeemable(new Date(now.getTime() - 200 * DAY), now)).toBe(false);
    expect(annualRedeemable(new Date(now.getTime() - 365 * DAY), now)).toBe(true);
  });
});
