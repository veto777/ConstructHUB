/**
 * Optional discounts: approval-time math, PM recipient resolution, and the
 * notification pref gate. Pure unit tests — no server, no queries.
 *
 * portal.ts pulls in entities → ../stripe, which throws without a key at
 * module scope. A dummy value is enough for import (no queries are run here).
 */
process.env.STRIPE_SECRET_KEY ||= "sk_test_dummy_for_module_import";
process.env.DATABASE_URL ||= "postgres://localhost:5432/unused_no_queries_run";

import { describe, it, expect, beforeAll } from "vitest";

let computeApprovalTotals: any;
let jobApprovedRecipients: any;
let crmNotificationEnabled: any;

beforeAll(async () => {
  ({ computeApprovalTotals } = await import("./discounts"));
  ({ jobApprovedRecipients } = await import("./portal"));
  ({ crmNotificationEnabled } = await import("@shared/schema"));
});

const line = (over: Partial<any> = {}) => ({
  kind: "labor", unitPriceCents: 100_00, quantityMilli: 1000, taxable: true, ...over,
});

describe("computeApprovalTotals", () => {
  it("no selections → same totals as the quoted estimate", () => {
    const t = computeApprovalTotals([line({ unitPriceCents: 123_45 })], 0, []);
    expect(t).toMatchObject({
      subtotalCents: 123_45, taxableBaseCents: 123_45,
      optionalDiscountBps: 0, optionalDiscountCents: 0,
      taxCents: 0, totalCents: 123_45,
    });
  });

  it("single offer applies its bps to the taxable base", () => {
    // $100.00 base, 10% tax, 5% offer: discount $5.00, tax on $95 → $9.50.
    const t = computeApprovalTotals([line()], 1000, [{ percentBps: 500 }]);
    expect(t.optionalDiscountCents).toBe(5_00);
    expect(t.taxCents).toBe(9_50);
    expect(t.totalCents).toBe(100_00 - 5_00 + 9_50);
  });

  it("combinations sum the bps (marketing 1% + military 2% = 3%)", () => {
    const t = computeApprovalTotals([line()], 0, [{ percentBps: 100 }, { percentBps: 200 }]);
    expect(t.optionalDiscountBps).toBe(300);
    expect(t.optionalDiscountCents).toBe(3_00);
    expect(t.totalCents).toBe(97_00);
  });

  it("all presets together: 1+2+5+5 = 13% off the taxable base", () => {
    const t = computeApprovalTotals([line()], 0,
      [{ percentBps: 100 }, { percentBps: 200 }, { percentBps: 500 }, { percentBps: 500 }, { percentBps: 0 }]);
    expect(t.optionalDiscountBps).toBe(1300);
    expect(t.optionalDiscountCents).toBe(13_00);
    expect(t.totalCents).toBe(87_00);
  });

  it("caps the combined concession at 100% of the taxable base", () => {
    const t = computeApprovalTotals([line()], 1000,
      [{ percentBps: 8000 }, { percentBps: 8000 }]);
    expect(t.optionalDiscountBps).toBe(10_000);
    expect(t.optionalDiscountCents).toBe(100_00);
    expect(t.taxCents).toBe(0);
    expect(t.totalCents).toBe(0);
  });

  it("non-taxable lines are discounted only via the base they don't join", () => {
    // $100 taxable + $50 non-taxable: a 10% offer takes $10 (of the taxable
    // base only), tax applies to the reduced taxable base.
    const t = computeApprovalTotals(
      [line(), line({ taxable: false, unitPriceCents: 50_00 })], 1000, [{ percentBps: 1000 }]);
    expect(t.taxableBaseCents).toBe(100_00);
    expect(t.optionalDiscountCents).toBe(10_00);
    expect(t.taxCents).toBe(9_00);
    expect(t.totalCents).toBe(150_00 - 10_00 + 9_00);
  });

  it("line-item discounts shrink the taxable base before the offer applies", () => {
    // $100 labor + $20 discount line, 10% offer, no tax: base $80 → $8 off.
    const t = computeApprovalTotals(
      [line(), line({ kind: "discount", unitPriceCents: 20_00 })], 0, [{ percentBps: 1000 }]);
    expect(t.taxableBaseCents).toBe(80_00);
    expect(t.lineDiscountCents).toBe(20_00);
    expect(t.optionalDiscountCents).toBe(8_00);
    expect(t.totalCents).toBe(72_00);
  });

  it("rounds half cents to the nearest cent", () => {
    // $123.45 base, 3% → 370.35¢ → 370¢.
    const t = computeApprovalTotals([line({ unitPriceCents: 123_45 })], 0, [{ percentBps: 300 }]);
    expect(t.optionalDiscountCents).toBe(370);
    expect(t.totalCents).toBe(123_45 - 370);
  });

  it("quantity in thousandths is priced before the percentage applies", () => {
    // 2.5 × $40 = $100 base; 5% offer → $5 off.
    const t = computeApprovalTotals(
      [line({ unitPriceCents: 40_00, quantityMilli: 2500 })], 0, [{ percentBps: 500 }]);
    expect(t.subtotalCents).toBe(100_00);
    expect(t.optionalDiscountCents).toBe(5_00);
    expect(t.totalCents).toBe(95_00);
  });
});

const member = (over: Partial<any> = {}) => ({
  id: "m1", email: "a@x.com", role: "field", status: "active", divisionId: null, ...over,
});

describe("jobApprovedRecipients", () => {
  it("division admins of the project's division are the TO line", () => {
    const { to, cc } = jobApprovedRecipients({
      divisionId: "div-fl",
      creatorMemberId: "m-est",
      members: [
        member({ id: "m-admin", email: "admin@fl.com", role: "admin", divisionId: "div-fl" }),
        member({ id: "m-owner", email: "owner@x.com", role: "owner" }),
        member({ id: "m-est", email: "est@x.com", role: "office" }),
      ],
    });
    expect(to).toEqual(["admin@fl.com"]);
    expect(cc).toEqual(["est@x.com"]); // the estimator is CC'd
  });

  it("admins of ANOTHER division don't count; falls back to the owner", () => {
    const { to } = jobApprovedRecipients({
      divisionId: "div-fl",
      creatorMemberId: null,
      members: [
        member({ id: "m-admin-wa", email: "admin@wa.com", role: "admin", divisionId: "div-wa" }),
        member({ id: "m-owner", email: "owner@x.com", role: "owner" }),
      ],
    });
    expect(to).toEqual(["owner@x.com"]);
  });

  it("no division on the project → owner fallback", () => {
    const { to } = jobApprovedRecipients({
      divisionId: null,
      creatorMemberId: null,
      members: [
        member({ id: "m-admin", email: "admin@x.com", role: "admin", divisionId: null }),
        member({ id: "m-owner", email: "owner@x.com", role: "owner" }),
      ],
    });
    expect(to).toEqual(["owner@x.com"]);
  });

  it("disabled admins are skipped (owner fallback), and a creator already TO isn't CC'd", () => {
    const { to, cc } = jobApprovedRecipients({
      divisionId: "div-fl",
      creatorMemberId: "m-owner",
      members: [
        member({ id: "m-admin", email: "admin@fl.com", role: "admin", divisionId: "div-fl", status: "disabled" }),
        member({ id: "m-owner", email: "owner@x.com", role: "owner" }),
      ],
    });
    expect(to).toEqual(["owner@x.com"]);
    expect(cc).toEqual([]); // creator is already on the TO line
  });
});

describe("jobApproved notification pref", () => {
  it("defaults ON (absent key) and an explicit false silences the send", () => {
    expect(crmNotificationEnabled(null, "jobApproved")).toBe(true);
    expect(crmNotificationEnabled({}, "jobApproved")).toBe(true);
    expect(crmNotificationEnabled({ notificationPrefs: {} }, "jobApproved")).toBe(true);
    expect(crmNotificationEnabled({ notificationPrefs: { jobApproved: true } }, "jobApproved")).toBe(true);
    expect(crmNotificationEnabled({ notificationPrefs: { jobApproved: false } }, "jobApproved")).toBe(false);
  });
});
