import { beforeEach, describe, expect, it, vi } from "vitest";
// The Stripe SDK is mocked, but server/stripe.ts refuses to build a client
// without a key (PaymentsNotConfiguredError → 503). Any value will do here.
process.env.STRIPE_SECRET_KEY ||= "sk_test_dummy_for_mocked_stripe";
// Server-side guard for cart checkout: a crafted or stale cart must not pay
// twice for the same service (a duplicate item, or a bundle plus one of the
// parts it already includes). Stripe and the database are mocked.
const mocks = vi.hoisted(() => ({ checkout: vi.fn(), rows: [] as any[][] }));
vi.mock("stripe", () => ({ default: class {
  checkout = { sessions: { create: mocks.checkout } };
  webhooks = { constructEvent: vi.fn() };
} }));
vi.mock("./db", () => {
  const next = () => mocks.rows.shift() || [];
  // .where() is awaited directly (course bundle) or through .limit(1).
  const where = () => ({ limit: async () => next(), then: (ok: any, fail: any) => Promise.resolve(next()).then(ok, fail) });
  return { db: { select: () => ({ from: () => ({ where }) }) } };
});
vi.mock("./auth", () => ({ getBaseUrl: () => "http://127.0.0.1:8225" }));
vi.mock("./crm/beta", () => ({ isBetaUser: async () => false }));
import { registerStripeRoutes } from "./stripe";
import { COURSE_BUNDLE, DFY_CATALOG } from "./catalog";

const routes = new Map<string, Function>();
registerStripeRoutes({ get: () => {}, post: (path: string, handler: Function) => routes.set(path, handler) } as any);
async function request(path: string, body: any) {
  const res: any = { code: 200, status(n: number) { this.code = n; return this; }, json(data: any) { this.body = data; return this; } };
  await routes.get(path)!({ user: { id: 42, email: "payments@example.invalid" }, body, headers: {} }, res);
  return res;
}
const customer = () => mocks.rows.push([{ stripeCustomerId: "cus_test" }]);
const moduleRow = (id: number) => mocks.rows.push([{ id, title: `Fixture module ${id}`, price: 150000 }]);
const cart = (items: any[]) => request("/api/stripe/create-cart-checkout", { items });

beforeEach(() => {
  mocks.rows.length = 0;
  mocks.checkout.mockReset().mockResolvedValue({ url: "https://checkout.example.invalid/test" });
});

describe("cart checkout charges each thing once", () => {
  it("rejects the Complete Business Build together with a part it includes", async () => {
    const res = await cart([
      { id: "dfy_bundle", type: "dfy_bundle" },
      { id: "dfy_formation", type: "dfy_service" },
    ]);
    expect(res.code).toBe(400);
    expect(res.body.message).toContain("Complete Business Build");
    expect(res.body.message).toContain(DFY_CATALOG.dfy_formation.name);
    expect(mocks.checkout).not.toHaveBeenCalled();
  });

  it("rejects the Master Class bundle together with a module, whatever id the client sends", async () => {
    moduleRow(7);
    const res = await cart([
      { id: "anything", type: "course_bundle" },
      { id: "renamed", type: "course_module", moduleId: 7 },
    ]);
    expect(res.code).toBe(400);
    expect(res.body.message).toContain("Master Class Complete Bundle");
    expect(mocks.checkout).not.toHaveBeenCalled();
  });

  it("rejects the same service twice", async () => {
    const res = await cart([
      { id: "dfy_formation", type: "dfy_service" },
      { id: "dfy_formation", type: "dfy_service" },
    ]);
    expect(res.code).toBe(400);
    expect(res.body.message).toMatch(/more than once/);
    expect(mocks.checkout).not.toHaveBeenCalled();
  });

  it("rejects the same module twice under different client ids", async () => {
    moduleRow(7);
    moduleRow(7);
    const res = await cart([
      { id: "a", type: "course_module", moduleId: 7 },
      { id: "b", type: "course_module", moduleId: 7 },
    ]);
    expect(res.code).toBe(400);
    expect(mocks.checkout).not.toHaveBeenCalled();
  });

  it("still checks out a bundle alongside unrelated items", async () => {
    moduleRow(7);
    customer();
    const res = await cart([
      { id: "dfy_bundle", type: "dfy_bundle" },
      { id: "course_module_7", type: "course_module", moduleId: 7 },
    ]);
    expect(res.code).toBe(200);
    const amounts = mocks.checkout.mock.calls[0][0].line_items.map((x: any) => x.price_data.unit_amount);
    expect(amounts).toEqual([DFY_CATALOG.dfy_bundle.priceCents, 150000]);
  });
});

describe("Master Class bundle naming", () => {
  it("names the bundle without a sale claim in both checkout paths", async () => {
    expect(COURSE_BUNDLE.name).toBe("Master Class — Complete Bundle");
    customer();
    expect((await cart([{ id: "course_bundle", type: "course_bundle" }])).code).toBe(200);
    mocks.rows.push([{ id: 1, title: "Formation" }]);
    customer();
    expect((await request("/api/stripe/create-course-checkout", { bundle: true })).code).toBe(200);
    const names = mocks.checkout.mock.calls.map((c) => c[0].line_items[0].price_data.product_data.name);
    expect(names).toEqual(["Master Class — Complete Bundle", "ConstructHUB Master Class — Complete Bundle"]);
    expect(names.join(" ")).not.toMatch(/%/);
    expect(mocks.checkout.mock.calls[1][0].line_items[0].price_data.unit_amount).toBe(COURSE_BUNDLE.priceCents);
  });
});
