import { describe, expect, it, vi } from "vitest";
import { BillingEventBus } from "./events";

const invoice = { id: "in_1", userId: 7, number: "A-1", status: "paid", amountPaid: 7900, amountDue: 0, currency: "usd",
  periodStart: null, periodEnd: null, description: null, hostedInvoiceUrl: null, invoicePdf: null, created: new Date(0) };

describe("billingEvents bus", () => {
  it("delivers a typed payload to every listener of that kind only", async () => {
    const bus = new BillingEventBus();
    const paid = vi.fn();
    const failed = vi.fn();
    bus.on("invoice.paid", paid);
    bus.on("invoice.payment_failed", failed);
    await bus.emit("invoice.paid", { userId: 7, invoice, stripeInvoice: {} as any });
    expect(paid).toHaveBeenCalledWith({ userId: 7, invoice, stripeInvoice: {} });
    expect(failed).not.toHaveBeenCalled();
  });

  it("a listener that throws or rejects is logged and never stops the others or the emitter", async () => {
    const bus = new BillingEventBus();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const after = vi.fn();
    bus.on("purchase.completed", () => { throw new Error("sync boom"); });
    bus.on("purchase.completed", async () => { throw new Error("async boom"); });
    bus.on("purchase.completed", after);
    await expect(bus.emit("purchase.completed", { userId: 1, purchase: {} as any })).resolves.toBeUndefined();
    expect(after).toHaveBeenCalledTimes(1);
    expect(error.mock.calls.map((c) => c[0])).toEqual([
      "[billing-events] purchase.completed listener threw:",
      "[billing-events] purchase.completed listener failed:",
    ]);
    error.mockRestore();
  });

  it("emit resolves after async listeners settle; once/off/unsubscribe stop delivery", async () => {
    const bus = new BillingEventBus();
    const order: string[] = [];
    bus.on("subscription.canceled", async () => { await new Promise((r) => setTimeout(r, 5)); order.push("slow"); });
    const onceFn = vi.fn();
    bus.once("subscription.canceled", onceFn);
    const off = bus.on("subscription.canceled", () => order.push("unsubscribed later"));
    const payload = { userId: 1, subscriptionId: "sub_1", plan: "pro", status: "canceled" };
    await bus.emit("subscription.canceled", payload);
    expect(order).toEqual(["unsubscribed later", "slow"]);
    off();
    await bus.emit("subscription.canceled", payload);
    expect(onceFn).toHaveBeenCalledTimes(1);
    expect(order).toEqual(["unsubscribed later", "slow", "slow"]);
    expect(bus.listenerCount("subscription.canceled")).toBe(1);
    bus.removeAllListeners();
    expect(bus.listenerCount("subscription.canceled")).toBe(0);
  });

  it("emitting with no listener is a resolved no-op", async () => {
    await expect(new BillingEventBus().emit("invoice.finalized", { userId: 1, invoice, stripeInvoice: {} as any })).resolves.toBeUndefined();
  });
});
