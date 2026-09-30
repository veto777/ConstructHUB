import { beforeAll, describe, expect, it, vi } from "vitest";
// Kimi QA: with no STRIPE_SECRET_KEY, "Get Started" on /pricing surfaced the
// SDK's raw "Neither apiKey nor config.authenticator provided". Checkout routes
// now answer 503 in plain words, before any Stripe call, and nothing is charged.
const mocks = vi.hoisted(() => ({ constructed: 0, verify: vi.fn(), rows: [] as any[][] }));
vi.mock("stripe", () => ({ default: class {
  constructor() { mocks.constructed++; }
  checkout = { sessions: { create: vi.fn() } };
  customers = { create: vi.fn() };
  webhooks = { constructEvent: mocks.verify };
} }));
vi.mock("./db", () => ({
  db: { select: () => ({ from: () => ({ where: () => ({ limit: async () => mocks.rows.shift() || [] }) }) }) },
  // The billing-column ensure step reads the catalog; all three columns "exist".
  pool: { query: async () => ({ rows: [{}, {}, {}] }) },
}));
vi.mock("./auth", () => ({ getBaseUrl: () => "http://127.0.0.1:8149" }));
vi.mock("./crm/beta", () => ({ isBetaUser: async () => false }));
import { registerStripeRoutes, PaymentsNotConfiguredError } from "./stripe";

const routes = new Map<string, Function>();
registerStripeRoutes({ get: () => {}, post: (path: string, handler: Function) => routes.set(path, handler) } as any);
async function request(path: string, body: any, headers: any = {}, rawBody?: Buffer) {
  const res: any = { code: 200, status(n: number) { this.code = n; return this; }, json(data: any) { this.body = data; return this; }, send(data: any) { this.body = data; return this; } };
  await routes.get(path)!({ user: { id: 42, email: "payments@example.invalid" }, body, headers, rawBody }, res);
  return res;
}

beforeAll(() => { delete process.env.STRIPE_SECRET_KEY; });

describe("Stripe routes without a secret key", () => {
  const human = new PaymentsNotConfiguredError().message;

  it("plan checkout answers 503 with a plain message, not the SDK's", async () => {
    mocks.rows.push([{ stripeCustomerId: "cus_test" }]);
    const res = await request("/api/stripe/create-checkout", { plan: "pro" });
    expect(res.code).toBe(503);
    expect(res.body.message).toBe(human);
    expect(res.body.message).not.toMatch(/apiKey|authenticator/);
    expect(mocks.constructed).toBe(0); // never reached the SDK
  });

  it("cart checkout does the same", async () => {
    // A module under the $1,000 sales threshold (at or above it is "talk to sales", not a checkout).
    mocks.rows.push([{ id: 7, title: "Fixture module", price: 14900 }], [{ stripeCustomerId: "cus_test" }]);
    const res = await request("/api/stripe/create-cart-checkout", { items: [{ type: "course_module", moduleId: 7 }] });
    expect(res.code).toBe(503);
    expect(res.body.message).toBe(human);
  });

  it("validation still runs first (an unknown plan is a 400, not a 503)", async () => {
    const res = await request("/api/stripe/create-checkout", { plan: "nope" });
    expect(res.code).toBe(400);
    // A retired plan key is refused the same way, before any Stripe call.
    expect((await request("/api/stripe/create-checkout", { plan: "standard" })).code).toBe(400);
    expect(mocks.constructed).toBe(0);
  });

  it("the webhook still fails closed", async () => {
    const prior = process.env.STRIPE_WEBHOOK_SECRET;
    try {
      process.env.STRIPE_WEBHOOK_SECRET = "whsec_local_mock";
      const res = await request("/api/stripe/webhook", { id: "x" }, { "stripe-signature": "t=1,v1=x" }, Buffer.from('{"id":"x"}'));
      expect(res.code).toBe(400);
      expect(mocks.verify).not.toHaveBeenCalled();
    } finally {
      if (prior === undefined) delete process.env.STRIPE_WEBHOOK_SECRET; else process.env.STRIPE_WEBHOOK_SECRET = prior;
    }
  });
});
