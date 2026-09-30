import { beforeEach, describe, expect, it, vi } from "vitest";
// The Stripe SDK is mocked, but server/stripe.ts refuses to build a client
// without a key (PaymentsNotConfiguredError → 503). Any value will do here.
process.env.STRIPE_SECRET_KEY ||= "sk_test_dummy_for_mocked_stripe";
const mocks = vi.hoisted(() => ({ checkout: vi.fn(), verify: vi.fn(), rows: [] as any[][], created: [] as any[] }));
vi.mock("stripe", () => ({ default: class {
  checkout = { sessions: { create: mocks.checkout, list: async () => ({ data: [] }), expire: async () => ({}) } };
  webhooks = { constructEvent: mocks.verify };
  // Plan prices are Stripe Prices found by lookup key, created on first use.
  prices = {
    list: async () => ({ data: [] }),
    create: async (params: any) => { mocks.created.push(params); return { id: `price_${params.lookup_key}` }; },
  };
} }));
vi.mock("./db", () => ({
  db: { select: () => ({ from: () => ({ where: () => ({ limit: async () => mocks.rows.shift() || [] }) }) }) },
  pool: { query: async () => ({ rows: [{}, {}, {}] }) },
}));
vi.mock("./auth", () => ({ getBaseUrl: () => "http://127.0.0.1:8149" }));
vi.mock("./crm/beta", () => ({ isBetaUser: async () => false }));
import { registerStripeRoutes } from "./stripe";
import { DFY_CATALOG } from "./catalog";
import { PLANS } from "@shared/plans";
import { resetPriceCache } from "./billing/prices";
const routes = new Map<string, Function>();
registerStripeRoutes({ get: () => {}, post: (path: string, handler: Function) => routes.set(path, handler) } as any);
async function request(path: string, body: any, headers: any = {}, rawBody?: Buffer) {
  const res: any = { code: 200, status(n: number) { this.code = n; return this; }, json(data: any) { this.body = data; return this; }, send(data: any) { this.body = data; return this; } };
  await routes.get(path)!({ user: { id: 42, email: "payments@example.invalid" }, body, headers, rawBody }, res);
  return res;
}
beforeEach(() => { mocks.rows.length = 0; mocks.created.length = 0; resetPriceCache(); mocks.checkout.mockReset().mockResolvedValue({ url: "https://checkout.example.invalid/test" }); mocks.verify.mockReset(); });
describe("growth checkout uses server pricing with mocked Stripe", () => {
  it("ignores forged prices/names/quantities for cart items", async () => {
    mocks.rows.push([{ id: 7, title: "Fixture module", price: 14900 }], [{ stripeCustomerId: "cus_test" }]);
    const res = await request("/api/stripe/create-cart-checkout", { items: [
      { type: "course_module", moduleId: 7, name: "Free", price: 1, quantity: -100 },
    ] });
    expect(res.code).toBe(200);
    const args = mocks.checkout.mock.calls[0][0];
    expect(args.line_items.map((x: any) => x.price_data.unit_amount)).toEqual([14900]);
    expect(args.line_items.every((x: any) => x.quantity === 1)).toBe(true);
    expect(args.line_items[0].price_data.product_data.name).toBe("Master Class — Fixture module");
  });
  it("a forged low price can't bring a $1,000+ service under the sales threshold", async () => {
    const res = await request("/api/stripe/create-cart-checkout", { items: [
      { id: "dfy_formation", type: "dfy_service", name: "Free", price: 1 },
    ] });
    expect(res.code).toBe(409);
    expect(res.body.code).toBe("talk_to_sales");
    expect(res.body.message).toContain(DFY_CATALOG.dfy_formation.name);
    expect(mocks.checkout).not.toHaveBeenCalled();
  });
  it("prices individual modules from the database", async () => {
    mocks.rows.push([{ id: 7, title: "Fixture module", price: 12345 }], [{ stripeCustomerId: "cus_test" }]);
    expect((await request("/api/stripe/create-cart-checkout", { items: [{ type: "course_module", moduleId: 7, price: 1 }] })).code).toBe(200);
    expect(mocks.checkout.mock.calls[0][0].line_items[0].price_data.unit_amount).toBe(12345);
  });
  it.each([
    [{ id: "unknown", type: "dfy_service" }, 400],
    [{ type: "subscription" }, 400],
    // SEO packages are $1,000+: talk to sales (not even the contract flow checks them out).
    [{ id: "dfy_seo_ads", type: "dfy_service" }, 409],
  ])("rejects unknown and sales-only items before contacting Stripe", async (item, code) => {
    expect((await request("/api/stripe/create-cart-checkout", { items: [item] })).code).toBe(code);
    expect(mocks.checkout).not.toHaveBeenCalled();
  });
  it("uses the plan catalog despite a client price override", async () => {
    mocks.rows.push([{ stripeCustomerId: "cus_test" }]);
    expect((await request("/api/stripe/create-checkout", { plan: "pro", price: 1, unit_amount: 1 })).code).toBe(200);
    const [line] = mocks.checkout.mock.calls[0][0].line_items;
    expect(line.price_data).toBeUndefined();
    expect(mocks.created.find((p) => `price_${p.lookup_key}` === line.price).unit_amount).toBe(PLANS.pro.monthlyCents);
  });
  it("fails closed on unsigned webhooks and verifies the original raw bytes", async () => {
    const prior = process.env.STRIPE_WEBHOOK_SECRET;
    try {
      process.env.STRIPE_WEBHOOK_SECRET = "whsec_local_mock";
      expect((await request("/api/stripe/webhook", {})).code).toBe(400);
      mocks.verify.mockImplementation(() => { throw new Error("Invalid signature"); });
      const raw = Buffer.from('{ "id": "test" }');
      expect((await request("/api/stripe/webhook", { id: "test" }, { "stripe-signature": "invalid" }, raw)).code).toBe(400);
      expect(mocks.verify).toHaveBeenCalledWith(raw, "invalid", "whsec_local_mock");
    } finally {
      if (prior === undefined) delete process.env.STRIPE_WEBHOOK_SECRET; else process.env.STRIPE_WEBHOOK_SECRET = prior;
    }
  });
});
