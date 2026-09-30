import { beforeEach, describe, expect, it, vi } from "vitest";
// The daily Agency location sync: bills (linked GBP locations − 10) on the
// graduated band item of the SAME subscription, idempotently, capped at the
// self-serve maximum, and never without a Stripe key. Stripe and the DB are
// mocked.
const mocks = vi.hoisted(() => ({ queries: [] as { sql: string; values: any[] }[], subs: [] as any[], linked: new Map<number, number>() }));
vi.mock("../db", () => ({
  pool: {
    query: async (sql: string, values: any[] = []) => {
      mocks.queries.push({ sql, values });
      if (/information_schema\.columns/.test(sql)) return { rows: [{}, {}, {}] };
      if (/FROM subscriptions/.test(sql)) return { rows: mocks.subs };
      if (/FROM business_locations/.test(sql)) return { rows: [{ n: mocks.linked.get(values[0]) ?? 0 }] };
      return { rows: [], rowCount: 1 };
    },
  },
}));
import { syncAgencyLocations, agencySyncOffReason } from "./agency-sync";
import { resetPriceCache } from "./prices";

const planItem = { id: "si_plan", quantity: 1, price: { id: "price_agency", metadata: { chub_kind: "plan", chub_key: "agency" }, recurring: { interval: "month" } } };
const bandItem = (quantity: number) => ({ id: "si_band", quantity, price: { id: "price_band", metadata: { chub_kind: "agency_locations" }, recurring: { interval: "month" } } });

function fakeStripe(items: any[], status = "active") {
  return {
    subscriptions: {
      retrieve: vi.fn(async (id: string) => ({ id, status, items: { data: items } })),
      update: vi.fn(async () => ({})),
    },
    prices: {
      list: vi.fn(async () => ({ data: [] })),
      create: vi.fn(async (params: any) => ({ id: `price_${params.lookup_key}` })),
    },
  } as any;
}
const lines: string[] = [];
const log = (line: string) => lines.push(line);
const writes = () => mocks.queries.filter((q) => /^UPDATE subscriptions/.test(q.sql));

beforeEach(() => {
  mocks.queries.length = 0;
  mocks.subs = [{ id: 7, user_id: 42, stripe_subscription_id: "sub_agency" }];
  mocks.linked.clear();
  lines.length = 0;
  resetPriceCache();
});

describe("Agency location sync", () => {
  it("never runs without a Stripe key", async () => {
    const prior = process.env.STRIPE_SECRET_KEY;
    delete process.env.STRIPE_SECRET_KEY;
    try {
      expect(await syncAgencyLocations({ log })).toBeNull();
      expect(mocks.queries).toHaveLength(0);
      expect(lines[0]).toMatch(/skipped: STRIPE_SECRET_KEY is not set/);
    } finally {
      if (prior !== undefined) process.env.STRIPE_SECRET_KEY = prior;
    }
  });

  it("adds the band item for locations above 10 (proration) and records the billed count", async () => {
    mocks.linked.set(42, 25);
    const stripe = fakeStripe([planItem]);
    expect(await syncAgencyLocations({ stripe, log })).toEqual({ checked: 1, changed: 1, failed: 0 });
    const [id, params] = stripe.subscriptions.update.mock.calls[0];
    expect(id).toBe("sub_agency");
    expect(params.proration_behavior).toBe("create_prorations");
    expect(params.items).toEqual([{ price: expect.stringMatching(/^price_chub_v1_agencyloc_month_/), quantity: 15 }]);
    expect(writes().at(-1)!.values).toEqual([7, 25]);
    expect(lines.join("\n")).toMatch(/user 42 now billed for 25 locations \(was 10; 25 linked\)/);
  });

  it("is idempotent: a matching quantity is left alone", async () => {
    mocks.linked.set(42, 25);
    const stripe = fakeStripe([planItem, bandItem(15)]);
    expect(await syncAgencyLocations({ stripe, log })).toEqual({ checked: 1, changed: 0, failed: 0 });
    expect(stripe.subscriptions.update).not.toHaveBeenCalled();
    // Only a no-op-safe write of the billed count (IS DISTINCT FROM).
    expect(writes().every((q) => /IS DISTINCT FROM/.test(q.sql))).toBe(true);
  });

  it("requantifies, and removes the item when back at 10 or fewer", async () => {
    mocks.linked.set(42, 60);
    const up = fakeStripe([planItem, bandItem(15)]);
    await syncAgencyLocations({ stripe: up, log });
    expect(up.subscriptions.update.mock.calls[0][1].items).toEqual([{ id: "si_band", quantity: 50 }]);

    mocks.linked.set(42, 6);
    const down = fakeStripe([planItem, bandItem(15)]);
    await syncAgencyLocations({ stripe: down, log });
    expect(down.subscriptions.update.mock.calls[0][1].items).toEqual([{ id: "si_band", deleted: true }]);
    expect(writes().at(-1)!.values).toEqual([7, 10]);
  });

  it("caps at 500 and logs that the rest needs a sales quote", async () => {
    mocks.linked.set(42, 640);
    const stripe = fakeStripe([planItem, bandItem(15)]);
    await syncAgencyLocations({ stripe, log });
    expect(stripe.subscriptions.update.mock.calls[0][1].items).toEqual([{ id: "si_band", quantity: 490 }]);
    expect(lines.join("\n")).toMatch(/640 linked locations — above 500, needs a sales quote/);
  });

  it("skips a subscription with no Agency plan item and keeps going after a failure", async () => {
    mocks.subs = [{ id: 7, user_id: 42, stripe_subscription_id: "sub_a" }, { id: 8, user_id: 43, stripe_subscription_id: "sub_b" }];
    const stripe = fakeStripe([]);
    stripe.subscriptions.retrieve.mockRejectedValueOnce(new Error("network down"));
    expect(await syncAgencyLocations({ stripe, log })).toEqual({ checked: 2, changed: 0, failed: 1 });
    expect(lines.join("\n")).toMatch(/user 42 failed — network down/);
    expect(lines.join("\n")).toMatch(/user 43 subscription sub_b has no Agency plan item — skipped/);
    expect(stripe.subscriptions.update).not.toHaveBeenCalled();
  });

  it("reads only live Agency subscriptions and counts each linked location once", async () => {
    await syncAgencyLocations({ stripe: fakeStripe([planItem]), log });
    const select = mocks.queries.find((q) => /FROM subscriptions/.test(q.sql))!;
    expect(select.sql).toMatch(/plan = 'agency'/);
    expect(select.values[0]).toEqual(expect.arrayContaining(["active", "trialing", "past_due"]));
    expect(select.values[0]).not.toContain("canceled");
    expect(mocks.queries.find((q) => /FROM business_locations/.test(q.sql))!.sql).toMatch(/count\(DISTINCT gbp_location_name\)/);
  });

  it("the daily schedule runs only in production with a Stripe key (a dev server with the .env key never re-bills)", () => {
    expect(agencySyncOffReason({ NODE_ENV: "production" })).toMatch(/STRIPE_SECRET_KEY is not set/);
    expect(agencySyncOffReason({ NODE_ENV: "development", STRIPE_SECRET_KEY: "sk_x" })).toMatch(/not a production server/);
    expect(agencySyncOffReason({ STRIPE_SECRET_KEY: "sk_x" })).toMatch(/not a production server/);
    expect(agencySyncOffReason({ NODE_ENV: "development", STRIPE_SECRET_KEY: "sk_x", AGENCY_SYNC_ALLOW_NONPROD: "1" })).toBeNull();
    expect(agencySyncOffReason({ NODE_ENV: "production", STRIPE_SECRET_KEY: "sk_x" })).toBeNull();
  });
});
