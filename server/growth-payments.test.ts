import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ checkout: vi.fn(), verify: vi.fn(), rows: [] as any[][] }));
vi.mock("stripe", () => ({ default: class {
  checkout = { sessions: { create: mocks.checkout } };
  webhooks = { constructEvent: mocks.verify };
} }));
vi.mock("./db", () => ({ db: { select: () => ({ from: () => ({ where: () => ({ limit: async () => mocks.rows.shift() || [] }) }) }) } }));
vi.mock("./auth", () => ({ getBaseUrl: () => "http://127.0.0.1:8149" }));
vi.mock("./crm/beta", () => ({ isBetaUser: async () => false }));
import { registerStripeRoutes, PLANS } from "./stripe";
import { COURSE_BUNDLE, DFY_CATALOG } from "./catalog";
const routes = new Map<string, Function>();
registerStripeRoutes({ get: () => {}, post: (path: string, handler: Function) => routes.set(path, handler) } as any);
async function request(path: string, body: any, headers: any = {}, rawBody?: Buffer) {
  const res: any = { code: 200, status(n: number) { this.code = n; return this; }, json(data: any) { this.body = data; return this; }, send(data: any) { this.body = data; return this; } };
  await routes.get(path)!({ user: { id: 42, email: "payments@example.invalid" }, body, headers, rawBody }, res);
  return res;
}
beforeEach(() => { mocks.rows.length = 0; mocks.checkout.mockReset().mockResolvedValue({ url: "https://checkout.example.invalid/test" }); mocks.verify.mockReset(); });
describe("growth checkout uses server pricing with mocked Stripe", () => {
  it("ignores forged prices/names/quantities for services and bundles", async () => {
    mocks.rows.push([{ stripeCustomerId: "cus_test" }]);
    const res = await request("/api/stripe/create-cart-checkout", { items: [
      { id: "dfy_formation", type: "dfy_service", name: "Free", price: 1, quantity: -100 },
      { id: "forged", type: "course_bundle", price: 1 },
    ] });
    expect(res.code).toBe(200);
    const args = mocks.checkout.mock.calls[0][0];
    expect(args.line_items.map((x: any) => x.price_data.unit_amount)).toEqual([DFY_CATALOG.dfy_formation.priceCents, COURSE_BUNDLE.priceCents]);
    expect(args.line_items.every((x: any) => x.quantity === 1)).toBe(true);
    expect(args.line_items[0].price_data.product_data.name).toBe(DFY_CATALOG.dfy_formation.name);
  });
  it("prices individual modules from the database", async () => {
    mocks.rows.push([{ id: 7, title: "Fixture module", price: 12345 }], [{ stripeCustomerId: "cus_test" }]);
    expect((await request("/api/stripe/create-cart-checkout", { items: [{ type: "course_module", moduleId: 7, price: 1 }] })).code).toBe(200);
    expect(mocks.checkout.mock.calls[0][0].line_items[0].price_data.unit_amount).toBe(12345);
  });
  it.each([{ id: "unknown", type: "dfy_service" }, { id: "dfy_seo_ads", type: "dfy_service" }, { type: "subscription" }])("rejects unknown/contract-required items before contacting Stripe", async item => {
    expect((await request("/api/stripe/create-cart-checkout", { items: [item] })).code).toBe(400);
    expect(mocks.checkout).not.toHaveBeenCalled();
  });
  it("uses the plan catalog despite a client price override", async () => {
    mocks.rows.push([{ stripeCustomerId: "cus_test" }]);
    expect((await request("/api/stripe/create-checkout", { plan: "platinum", price: 1 })).code).toBe(200);
    expect(mocks.checkout.mock.calls[0][0].line_items[0].price_data.unit_amount).toBe(PLANS.platinum.price);
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
