import { beforeEach, describe, expect, it, vi } from "vitest";
import type Stripe from "stripe";
import type { Express } from "express";

const mocks = vi.hoisted(() => ({ row: vi.fn(), retrieve: vi.fn(), update: vi.fn(), query: vi.fn() }));
vi.mock("../db", () => ({ pool: { query: mocks.query } }));
vi.mock("../billing/client", () => ({ stripe: { subscriptions: { retrieve: mocks.retrieve, update: mocks.update } } }));
vi.mock("../billing/sync", () => ({
  LIVE_STATUSES: new Set(["active", "trialing", "past_due"]),
  subscriptionPeriodEnd: vi.fn(), withBillingLock: vi.fn(),
}));
vi.mock("./entitlements", () => ({
  crmBillingSchemaReady: vi.fn().mockResolvedValue(undefined), crmSubscriptionRow: mocks.row,
  forgetCrmEntitlements: vi.fn(), getCrmEntitlements: vi.fn(),
}));
vi.mock("@/components/recent-auth", () => ({ VerificationCancelled: class extends Error {} }));

import { crmChangePreview, crmChangeItems, describeCrmSubscription, registerCrmBillingRoutes } from "./billing";
import { crmPurchaseReview } from "../../client/src/components/crm-plans";

function subscription(jobcam = true, seats = 0): Stripe.Subscription {
  const item = (id: string, kind: string, key: string, quantity = 1) => ({
    id, quantity, price: { id: `price_${id}`, metadata: { chub_kind: kind, chub_key: key }, recurring: { interval: "month" } },
  });
  return {
    id: "sub_crm", status: "active", items: { data: [
      item("plan", "crm_plan", "crm_basic"),
      ...(jobcam ? [item("jobcam", "crm_addon", "jobcam")] : []),
      ...(seats ? [item("seats", "crm_seat", "", seats)] : []),
    ] },
  } as unknown as Stripe.Subscription;
}
const annualBasic = { plan: "crm_basic", interval: "year", extraSeats: 0 } as const;

beforeEach(() => vi.clearAllMocks());

describe("CRM recurring change preview and purchase confirmation", () => {
  it("quotes Basic plus retained JobCam at $1,007/year, matching the billed item amounts", async () => {
    const sub = subscription();
    const preview = crmChangePreview(sub, annualBasic);
    expect(preview.order.jobcam).toBe(true);
    expect(preview.recurringCents).toBe(100700);
    let billedCents = 0;
    await crmChangeItems(describeCrmSubscription(sub), preview.order, async (spec) => {
      billedCents += spec.params.unit_amount!;
      return spec.lookupKey;
    });
    expect(billedCents).toBe(preview.recurringCents);
    const review = crmPurchaseReview(annualBasic, preview);
    expect(review.price).toBe("$1,007/yr");
    expect(review.included).toContain("JobCam add-on retained — included in the total");
    expect(review.notIncluded.join(" ")).not.toContain("JobCam");
    expect(review.note).toContain("prorated");
  });

  it("retains and includes extra seats in the full annual recurring order", () => {
    const preview = crmChangePreview(subscription(true, 2), { interval: "year" });
    expect(preview.recurringCents).toBe(134700);
    expect(preview.order.extraSeats).toBe(2);
    const review = crmPurchaseReview(annualBasic, preview);
    expect(review.price).toBe("$1,347/yr");
    expect(review.included).toContain("2 extra seats (3 seats in all)");
    expect(review.notIncluded.join(" ")).not.toContain("Extra seats");
  });

  it("drops the paid JobCam line when Max includes it", async () => {
    const sub = subscription();
    const preview = crmChangePreview(sub, { plan: "crm_max", interval: "year" });
    expect(preview.order.jobcam).toBe(false);
    expect(preview.recurringCents).toBe(218900);
    const items = await crmChangeItems(describeCrmSubscription(sub), preview.order, async (spec) => spec.lookupKey);
    expect(items).toContainEqual({ id: "jobcam", deleted: true });
    const review = crmPurchaseReview(annualBasic, preview);
    expect(review.included.join(" ")).toContain("JobCam");
    expect(review.included.join(" ")).not.toContain("add-on retained");
  });

  it("does not invent an add-on for Basic without JobCam or a fresh checkout", () => {
    const preview = crmChangePreview(subscription(false), annualBasic);
    expect(preview.recurringCents).toBe(53900);
    for (const review of [crmPurchaseReview(annualBasic, preview), crmPurchaseReview(annualBasic)]) {
      expect(review.price).toBe("$539/yr");
      expect(review.notIncluded.join(" ")).toContain("JobCam");
    }
  });

  it("honors explicit removal and rejects invalid intervals", () => {
    expect(crmChangePreview(subscription(), { ...annualBasic, jobcam: false }).recurringCents).toBe(53900);
    expect(() => crmChangePreview(subscription(), { interval: "week" })).toThrow("monthly or yearly");
  });
});

describe("an existing CRM subscriber on an older price (repricing 2026-10-10: Basic $39 -> $49)", () => {
  // Sold at $39/mo before the repricing: the Stripe line still carries that price.
  function soldAt39(): Stripe.Subscription {
    return {
      id: "sub_old", status: "active", items: { data: [{
        id: "plan", quantity: 1,
        price: { id: "price_crm_basic_month_3900", unit_amount: 3900, metadata: { chub_kind: "crm_plan", chub_key: "crm_basic" }, recurring: { interval: "month" } },
      }] },
    } as unknown as Stripe.Subscription;
  }

  it("keeps the plan line and its price when only seats change", async () => {
    const sub = soldAt39();
    const preview = crmChangePreview(sub, { extraSeats: 2 });
    expect(preview.recurringCents).toBe(3900 + 2 * 1700);
    const items = await crmChangeItems(describeCrmSubscription(sub), preview.order, async (spec) => spec.lookupKey);
    expect(items).toEqual([{ price: "chub_v1_crmseat_month_1700", quantity: 2 }]);
  });

  it("moves to the current book only when the customer changes plan or interval", async () => {
    const sub = soldAt39();
    const yearly = crmChangePreview(sub, { interval: "year" });
    expect(yearly.recurringCents).toBe(53900);
    expect(await crmChangeItems(describeCrmSubscription(sub), yearly.order, async (spec) => spec.lookupKey))
      .toEqual([{ id: "plan", price: "chub_v1_crmplan_crm_basic_year_53900", quantity: 1 }]);
    const up = crmChangePreview(sub, { plan: "crm_essentials" });
    expect(up.recurringCents).toBe(9900);
  });
});

describe("CRM change-preview route", () => {
  function route() {
    const routes = new Map<string, Function>();
    const app = { get: vi.fn(), post: (path: string, handler: Function) => routes.set(path, handler) };
    registerCrmBillingRoutes(app as unknown as Express, {
      getOrCreateCustomer: vi.fn(), recentAuthOk: vi.fn(),
      sendStripeError: (res, err) => res.status(err.status ?? 500).json({ message: err.message }),
    });
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    return { handle: routes.get("/api/crm/billing/change-preview")!, res };
  }

  it("requires login before looking up a subscription", async () => {
    const { handle, res } = route();
    await handle({ body: annualBasic }, res);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(mocks.row).not.toHaveBeenCalled();
  });

  it("reads the logged-in account's Stripe subscription, ignoring client price and add-on claims", async () => {
    mocks.row.mockResolvedValue({ stripe_subscription_id: "sub_crm", status: "active", jobcam_addon: false });
    mocks.retrieve.mockResolvedValue(subscription());
    const { handle, res } = route();
    await handle({ user: { id: 42 }, body: { ...annualBasic, recurringCents: 1, userId: 999 } }, res);
    expect(mocks.row).toHaveBeenCalledWith(42);
    expect(mocks.retrieve).toHaveBeenCalledWith("sub_crm");
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ recurringCents: 100700 }));
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it("refuses an absent subscription", async () => {
    mocks.row.mockResolvedValue(undefined);
    const { handle, res } = route();
    await handle({ user: { id: 42 }, body: annualBasic }, res);
    expect(res.status).toHaveBeenCalledWith(409);
    expect(mocks.retrieve).not.toHaveBeenCalled();
  });

  it("refuses a subscription that ended at Stripe before the local row updated", async () => {
    mocks.row.mockResolvedValue({ stripe_subscription_id: "sub_crm", status: "active" });
    mocks.retrieve.mockResolvedValue({ ...subscription(), status: "canceled" });
    const { handle, res } = route();
    await handle({ user: { id: 42 }, body: annualBasic }, res);
    expect(res.status).toHaveBeenCalledWith(409);
    expect(mocks.update).not.toHaveBeenCalled();
  });
});
