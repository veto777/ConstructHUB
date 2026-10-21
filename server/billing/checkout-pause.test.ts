/** server/billing/checkout-pause.ts + retry-cap.ts — the paused-checkout switch, its item label, and the retry cap. */
process.env.STRIPE_SECRET_KEY ||= "sk_test_dummy_for_module_import";
process.env.DATABASE_URL ||= "postgres://localhost:5432/unused_no_queries_run";
import { describe, it, expect } from "vitest";
import { checkoutPauseOverride, describeCheckout } from "./checkout-pause";
import { shouldStopRetries } from "./retry-cap";

describe("checkout pause override", () => {
  it("forces on/off from CHECKOUT_PAUSED and follows Stripe when unset", () => {
    expect(checkoutPauseOverride({ CHECKOUT_PAUSED: "1" } as any)).toBe(true);
    expect(checkoutPauseOverride({ CHECKOUT_PAUSED: "off" } as any)).toBe(false);
    expect(checkoutPauseOverride({} as any)).toBeNull();
    expect(checkoutPauseOverride({ CHECKOUT_PAUSED: "maybe" } as any)).toBeNull();
  });
});

describe("what the visitor was buying", () => {
  it("names the area and the choice", () => {
    expect(describeCheckout("/api/stripe/create-checkout", { plan: "pro", interval: "month" })).toBe("Plan: pro · month");
    expect(describeCheckout("/api/alacarte/checkout", { key: "permits", interval: "year", quantity: 3 })).toBe("Single tool: permits · year · x3");
    expect(describeCheckout("/api/seo/credits/checkout", { cents: 5000 })).toBe("SEO credits: $50");
    expect(describeCheckout("/api/contracts/abc/checkout", undefined)).toBe("SEO contract payment");
    expect(describeCheckout("/api/stripe/create-cart-checkout", { items: [{ name: "Local SEO" }, { key: "gbp" }] })).toBe("Cart: Local SEO, gbp");
  });
});

describe("card retry cap", () => {
  const inv = (attempt_count: number, extra: Record<string, unknown> = {}) =>
    ({ status: "open", collection_method: "charge_automatically", auto_advance: true, attempt_count, ...extra }) as any;
  it("lets the first failure retry once, stops after the second", () => {
    expect(shouldStopRetries(inv(1))).toBe(false);
    expect(shouldStopRetries(inv(2))).toBe(true);
    expect(shouldStopRetries(inv(9))).toBe(true);
  });
  it("leaves paid, already-stopped and send-invoice bills alone", () => {
    expect(shouldStopRetries(inv(3, { status: "paid" }))).toBe(false);
    expect(shouldStopRetries(inv(3, { auto_advance: false }))).toBe(false);
    expect(shouldStopRetries(inv(3, { collection_method: "send_invoice" }))).toBe(false);
  });
});
