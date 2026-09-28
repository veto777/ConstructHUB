import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ constructEvent: vi.fn(), select: vi.fn(), update: vi.fn() }));
vi.mock("stripe", () => ({ default: class {
  webhooks = { constructEvent: mocks.constructEvent };
} }));
vi.mock("../db", () => ({ db: { select: mocks.select, update: mocks.update } }));
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
    mocks.select.mockImplementation(() => { throw new Error("ledger unavailable"); });
    const webhook = await handler(), res = response(), rawBody = Buffer.from('{ "exact": "bytes" }');
    await webhook({ headers: { "stripe-signature": "stub-signature" }, rawBody }, res);
    expect(mocks.constructEvent).toHaveBeenCalledWith(rawBody, "stub-signature", "whsec_audit_stub");
    expect(res.code).toBe(500);
  });
});

// These expected failures preserve verified open ledger defects without a
// Stripe request or a second listening port. Remove .fails with the ledger fix.
describe("known settlement defects (mocked ledger)", () => {
  async function ledger(initialStatus = "pending", externalId = "cs_test_audit") {
    const { getTableName } = await import("drizzle-orm");
    const { PgDialect } = await import("drizzle-orm/pg-core");
    const dialect = new PgDialect();
    const pay: any = { id: "pay-audit", orgId: "org-audit", customerId: "customer-audit", invoiceId: "invoice-audit", amountCents: 1000, status: initialStatus, externalId };
    const invoice: any = { id: "invoice-audit", totalCents: 1000, paidCents: initialStatus === "succeeded" ? 1000 : 0, status: initialStatus === "succeeded" ? "paid" : "sent" };
    mocks.select.mockImplementation(() => ({ from: (table: any) => ({ where: (where: any) => {
      const name = getTableName(table);
      const value = dialect.sqlToQuery(where).params[0];
      const rows = name === "crm_payments" && pay.externalId === value ? [{ ...pay }]
        : name === "crm_invoices" && invoice.id === value ? [{ ...invoice }] : [];
      return { limit: async () => rows, then: (resolve: any) => Promise.resolve(rows).then(resolve) };
    } }) }));
    mocks.update.mockImplementation((table: any) => ({ set: (patch: any) => ({ where: () => {
      const target = getTableName(table) === "crm_payments" ? pay : invoice;
      Object.assign(target, patch);
      return { returning: async () => [{ ...target }], then: (resolve: any) => Promise.resolve().then(resolve) };
    } }) }));
    const webhook = await handler();
    const send = async (type: string, object: any) => {
      mocks.constructEvent.mockReturnValue({ type, data: { object } });
      const res = response();
      await webhook({ headers: { "stripe-signature": "stub" }, rawBody: Buffer.from("{}") }, res);
      expect(res.code).toBe(200);
    };
    return { pay, invoice, send };
  }
  it.fails("settles ACH when the delayed success arrives by Checkout session ID", async () => {
    const { pay, send } = await ledger();
    await send("checkout.session.completed", { id: "cs_test_audit", payment_status: "unpaid", payment_intent: "pi_audit" });
    expect(pay.status).toBe("processing");
    await send("checkout.session.async_payment_succeeded", { id: "cs_test_audit", payment_status: "paid", payment_intent: "pi_audit" });
    expect(pay.status).toBe("succeeded");
  });
  it.fails("reverses invoice credit when a fully refunded charge arrives", async () => {
    const { pay, invoice, send } = await ledger("succeeded", "pi_audit");
    await send("charge.refunded", { payment_intent: "pi_audit", amount_refunded: 1000, refunded: true });
    expect(pay.status).toBe("refunded");
    expect(invoice.paidCents).toBe(0);
  });
});
