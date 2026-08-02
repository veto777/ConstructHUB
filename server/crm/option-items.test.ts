/**
 * Item-carrying estimate options — the endpoints the contractor's options
 * editor (crm-client.tsx EstimateOptionsDialog) drives, against the running
 * dev server (CRM_TEST_BASE_URL, default http://127.0.0.1:8119 with
 * DEV_AUTH_BYPASS_USER1=true).
 *
 * Pins the contract the UI relies on:
 *   1. POST options with items computes totals FROM THE LINES (never the
 *      body's totalCents), taxed at the estimate's own rate, and GET returns
 *      the option with its items — the round-trip the dialog's cart saves.
 *   2. DELETE removes an option while the estimate is editable.
 *   3. options/from-package expands a price-book package into an option that
 *      carries the expanded scope lines and computed totals.
 *   4. from-package is guarded like the other option writes: 409 after the
 *      client has responded.
 *
 * Throwaway rows only (unique run stamp), safe alongside other lanes.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { createHash, randomBytes } from "crypto";
import pg from "pg";

const BASE = process.env.CRM_TEST_BASE_URL ?? "http://127.0.0.1:8119";

const pool = new pg.Pool({
  connectionString:
    process.env.DATABASE_URL ??
    "postgres://constructhub_dev:crmdev_local_only@127.0.0.1:5432/constructhub_dev",
});
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
async function clientCookie(customerId: string): Promise<string> {
  const raw = randomBytes(32).toString("hex");
  await pool.query(
    `insert into crm_client_sessions (token_hash, customer_ids, expires_at, last_seen_at)
     values ($1, $2::jsonb, now() + interval '30 days', now())`,
    [sha256(raw), JSON.stringify([customerId])],
  );
  return `crm_client=${raw}`;
}

async function api(path: string, opts: RequestInit = {}, cookie?: string) {
  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: {
      "content-type": "application/json",
      ...(cookie ? { cookie } : {}),
      ...(opts.headers || {}),
    },
  });
  const setCookie = res.headers.get("set-cookie");
  const body = res.status === 204 ? null : await res.json().catch(() => null);
  return { status: res.status, body, cookie: setCookie?.split(";")[0] ?? cookie };
}

let cookie: string | undefined;

beforeAll(async () => {
  const me = await api("/api/crm/me");
  if (me.status !== 200) {
    throw new Error(`CRM dev server not reachable at ${BASE} (GET /api/crm/me → ${me.status}). Start it first.`);
  }
  cookie = me.cookie;
});

const line = (name: string, qtyMilli: number, cents: number, taxable = true) => ({
  kind: "labor", name, quantityMilli: qtyMilli, unitPriceCents: cents, taxable,
});

/** Throwaway customer + estimate (10% tax) with one base line. */
async function estimateFixture(run: string) {
  const cust = await api("/api/crm/customers", {
    method: "POST",
    body: JSON.stringify({ displayName: `Vitest optit ${run}`, email: `vitest.optit.${run}@example.com` }),
  }, cookie);
  expect(cust.status).toBe(201);
  const est = await api("/api/crm/estimates", {
    method: "POST",
    body: JSON.stringify({
      customerId: cust.body.id, title: "Vitest option items", taxRateBps: 1000,
      items: [line("Base work", 1000, 100_00)],
    }),
  }, cookie);
  expect(est.status).toBe(201);
  return { customerId: cust.body.id as string, estimateId: est.body.id as string };
}

describe("item-carrying estimate options", () => {
  it("create with items → server-computed totals (body total ignored) → GET round-trip → delete", async () => {
    const run = `${Date.now().toString(36)}a`;
    const { estimateId } = await estimateFixture(run);

    // The dialog never sends totalCents with lines; a hostile body total must
    // be ignored — 2×$150 + 1×$80 = $380 subtotal.
    const opt = await api(`/api/crm/estimates/${estimateId}/options`, {
      method: "POST",
      body: JSON.stringify({
        name: "Better", tier: 1, totalCents: 1, recommended: true,
        description: "Mid-tier scope",
        items: [
          { ...line("Tear off", 2000, 150_00), unit: "sq" },
          line("Underlayment", 1000, 80_00, false),
        ],
      }),
    }, cookie);
    expect(opt.status).toBe(201);
    expect(opt.body.subtotalCents).toBe(380_00);
    // Only the taxable lines feed the tax: $300 × 10% = $30 → $410.
    expect(opt.body.totalCents).toBe(410_00);
    expect(Array.isArray(opt.body.items)).toBe(true);
    expect(opt.body.items).toHaveLength(2);
    expect(opt.body.items[0].name).toBe("Tear off");
    expect(opt.body.items[0].unit).toBe("sq");

    // GET round-trip: same items, same totals, costs withheld only by
    // permission (owner sees them; either way the key fields ride along).
    const got = await api(`/api/crm/estimates/${estimateId}/options`, {}, cookie);
    expect(got.status).toBe(200);
    const found = got.body.find((o: any) => o.id === opt.body.id);
    expect(found).toBeTruthy();
    expect(found.items).toHaveLength(2);
    expect(found.subtotalCents).toBe(380_00);
    expect(found.totalCents).toBe(410_00);
    expect(found.recommended).toBe(true);

    // An itemless tier still coexists: display-only, body total stands.
    const tier = await api(`/api/crm/estimates/${estimateId}/options`, {
      method: "POST", body: JSON.stringify({ name: "Good", tier: 2, totalCents: 299_00 }),
    }, cookie);
    expect(tier.status).toBe(201);
    expect(tier.body.totalCents).toBe(299_00);
    expect(tier.body.items == null).toBe(true);

    // Removable while editable.
    const del = await api(`/api/crm/estimates/${estimateId}/options/${opt.body.id}`, { method: "DELETE" }, cookie);
    expect(del.status).toBe(200);
    const after = await api(`/api/crm/estimates/${estimateId}/options`, {}, cookie);
    expect(after.body.find((o: any) => o.id === opt.body.id)).toBeUndefined();
  });

  it("from-package expands the package into an item-carrying option with computed totals", async () => {
    const run = `${Date.now().toString(36)}b`;
    const { estimateId } = await estimateFixture(run);

    // Two flat-price price-book items in one package: 2×$100 + 1×$50 = $250,
    // tax on the taxable one only ($200 × 10% = $20) → $270.
    const mk = (name: string, cents: number, taxable: boolean) =>
      api("/api/crm/pricebook/items", {
        method: "POST",
        body: JSON.stringify({ name: `${name} ${run}`, pricingMode: "flat", flatPriceCents: cents, unit: "job", taxable }),
      }, cookie);
    const itemA = await mk("Vitest pkg item A", 100_00, true);
    const itemB = await mk("Vitest pkg item B", 50_00, false);
    expect(itemA.status).toBe(201);
    expect(itemB.status).toBe(201);

    const pkg = await api("/api/crm/pricebook/packages", {
      method: "POST",
      body: JSON.stringify({
        name: `Vitest package ${run}`, tier: 1, description: "Scope template",
        items: [
          { itemId: itemA.body.id, quantityMilli: 2000 },
          { itemId: itemB.body.id, quantityMilli: 1000 },
        ],
      }),
    }, cookie);
    expect(pkg.status).toBe(201);

    const opt = await api(`/api/crm/estimates/${estimateId}/options/from-package`, {
      method: "POST", body: JSON.stringify({ packageId: pkg.body.id, recommended: true }),
    }, cookie);
    expect(opt.status).toBe(201);
    expect(opt.body.option.name).toBe(`Vitest package ${run}`);
    expect(opt.body.option.subtotalCents).toBe(250_00);
    expect(opt.body.option.totalCents).toBe(270_00);
    expect(opt.body.option.items.length).toBe(2);
    expect(opt.body.option.items.map((i: any) => i.name)).toContain(`Vitest pkg item A ${run}`);
    expect(opt.body.warnings).toEqual([]);

    // The client-selectable path reads options through the same GET — the
    // package option must be there with its scope.
    const got = await api(`/api/crm/estimates/${estimateId}/options`, {}, cookie);
    const found = got.body.find((o: any) => o.id === opt.body.option.id);
    expect(found?.items?.length).toBe(2);
  });

  it("from-package 409s once the estimate has been responded to", async () => {
    const run = `${Date.now().toString(36)}c`;
    const { customerId, estimateId } = await estimateFixture(run);

    const item = await api("/api/crm/pricebook/items", {
      method: "POST",
      body: JSON.stringify({ name: `Vitest guard item ${run}`, pricingMode: "flat", flatPriceCents: 10_00, unit: "job" }),
    }, cookie);
    const pkg = await api("/api/crm/pricebook/packages", {
      method: "POST",
      body: JSON.stringify({ name: `Vitest guard pkg ${run}`, tier: 1, items: [{ itemId: item.body.id, quantityMilli: 1000 }] }),
    }, cookie);
    expect(pkg.status).toBe(201);

    // Approve the estimate as the verified client.
    const send = await api(`/api/crm/estimates/${estimateId}/send`, { method: "POST", body: "{}" }, cookie);
    const token = send.body.link.split("/e/")[1];
    const approve = await api(`/api/public/estimates/${token}/respond`, {
      method: "POST", body: JSON.stringify({ decision: "approve", signatureName: "Vitest Signer" }),
    }, await clientCookie(customerId));
    expect(approve.status).toBe(200);

    const late = await api(`/api/crm/estimates/${estimateId}/options/from-package`, {
      method: "POST", body: JSON.stringify({ packageId: pkg.body.id }),
    }, cookie);
    expect(late.status).toBe(409);
  });
});
