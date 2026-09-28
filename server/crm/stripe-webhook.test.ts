import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ constructEvent: vi.fn(), select: vi.fn(), update: vi.fn(), reconcile: vi.fn() }));
vi.mock("stripe", () => ({ default: class {
  webhooks = { constructEvent: mocks.constructEvent };
} }));
vi.mock("../db", () => ({ db: { select: mocks.select, update: mocks.update } }));
vi.mock("./payment-ledger", () => ({ reconcileStripeEvent: mocks.reconcile }));
vi.mock("../email", () => ({ sendWithFallback: vi.fn() }));
vi.mock("./receipts", () => ({ autoSendPaymentReceipt: vi.fn() }));
vi.mock("./sms", () => ({ textOrgOwners: vi.fn() }));
vi.mock("./notify", () => ({ notifyMembers: vi.fn() }));

async function handler(key = "sk_test_audit_stub", secret = "whsec_audit_stub") {
  vi.resetModules();
  vi.stubEnv("STRIPE_SECRET_KEY", key);
  vi.stubEnv("STRIPE_CONNECT_WEBHOOK_SECRET", secret);
  const { registerCrmIntegrationRoutes } = await import("./integrations");
  let webhook: any;
  registerCrmIntegrationRoutes({
    post(path: string, fn: any) { if (path.endsWith("connect-webhook")) webhook = fn; },
    get() {},
  } as any);
  return webhook;
}
function response() {
  return { code: 200, payload: null as any,
    status(n: number) { this.code = n; return this; },
    send(v: any) { this.payload = v; return this; },
    json(v: any) { this.payload = v; return this; },
  };
}
beforeEach(() => { vi.clearAllMocks(); vi.unstubAllEnvs(); });
afterEach(() => vi.unstubAllEnvs());
describe("Stripe Connect webhook with mocked Stripe and database", () => {
  it("fails closed when Stripe is disabled or the webhook secret is absent", async () => {
    for (const [key, secret] of [["", ""], ["sk_test_audit_stub", ""]]) {
      const webhook = await handler(key, secret), res = response();
      await webhook({ headers: {}, rawBody: Buffer.from("{}") }, res);
      expect(res.code).toBe(503);
    }
    expect(mocks.select).not.toHaveBeenCalled();
  });
  it("requires both a signature and raw bytes", async () => {
    const webhook = await handler();
    for (const req of [{ headers: {}, rawBody: Buffer.from("{}") }, { headers: { "stripe-signature": "sig" } }]) {
      const res = response(); await webhook(req, res); expect(res.code).toBe(400);
    }
    expect(mocks.constructEvent).not.toHaveBeenCalled();
    expect(mocks.select).not.toHaveBeenCalled();
  });
  it("rejects forged events before touching the ledger", async () => {
    mocks.constructEvent.mockImplementation(() => { throw new Error("invalid signature"); });
    const webhook = await handler(), res = response();
    await webhook({ headers: { "stripe-signature": "forged" }, rawBody: Buffer.from("{}") }, res);
    expect(res.code).toBe(400);
    expect(mocks.select).not.toHaveBeenCalled();
  });
  it("verifies the original bytes and asks Stripe to retry ledger failures", async () => {
    mocks.constructEvent.mockReturnValue({ type: "checkout.session.async_payment_succeeded", data: { object: { id: "cs_test_audit", payment_status: "paid" } } });
    mocks.reconcile.mockRejectedValue(new Error("ledger unavailable"));
    const webhook = await handler(), res = response(), rawBody = Buffer.from('{ "exact": "bytes" }');
    await webhook({ headers: { "stripe-signature": "stub-signature" }, rawBody }, res);
    expect(mocks.constructEvent).toHaveBeenCalledWith(rawBody, "stub-signature", "whsec_audit_stub");
    expect(res.code).toBe(500);
  });
});

