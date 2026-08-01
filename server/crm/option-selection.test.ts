/**
 * Client-selectable estimate options — the client ticks scopes on the gated
 * public page, reviews, and a NEW estimate is generated containing only the
 * chosen scopes' items (POST /api/public/estimates/:token/select-options).
 *
 * Model: crm_estimate_options.items jsonb — an option carrying its own line
 * items is a selectable scope; a legacy option without items stays a
 * display-only tier card (and 400s if selected).
 *
 * Pins, against the running dev server (same pattern as budget-options.test.ts):
 *   1. The contractor endpoint computes option totals from items (never
 *      trusts body totals) at the estimate's own tax rate.
 *   2. Selecting 2 of 3 scopes + a discount regenerates the estimate with
 *      EXACTLY the chosen items, tax recomputed to the cent; the optional
 *      discount lands only at approve time (server recompute).
 *   3. The original is untouched and carries the trail (event + audit row +
 *      customFields.clientSelection).
 *   4. Bogus option id → 400; itemless option → 400; another customer's
 *      session → 401; an answered estimate → 409.
 *   5. Re-selection supersedes the previous generated estimate (cancelled,
 *      with a pointer) — no zombie duplicates.
 *
 *   DATABASE_URL=… CRM_TEST_BASE_URL=http://127.0.0.1:8159 npx vitest run server/crm/option-selection.test.ts
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
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

afterAll(async () => {
  await pool.end();
});

async function makeCustomer(tag: string) {
  const r = await api("/api/crm/customers", {
    method: "POST",
    body: JSON.stringify({ displayName: `Vitest optsel ${tag}`, email: `vitest.optsel.${tag}@example.com` }),
  }, cookie);
  expect(r.status).toBe(201);
  return r.body.id as string;
}

const scope = (name: string, cents: number, taxable = true) => ({
  kind: "labor", name, quantityMilli: 1000, unitPriceCents: cents, taxable,
});

describe("client-selectable estimate options (dev server)", () => {
  it("select 2 of 3 scopes + discount → regenerated estimate, cent-exact tax, trail, guards", async () => {
    const run = Date.now().toString(36);
    const customerA = await makeCustomer(`a${run}`);
    const customerB = await makeCustomer(`b${run}`);

    const est = await api("/api/crm/estimates", {
      method: "POST",
      body: JSON.stringify({
        customerId: customerA, title: `Vitest optsel ${run}`, taxRateBps: 1000, // 10%
        items: [scope("Base line", 100_00)],
      }),
    }, cookie);
    expect(est.status).toBe(201);
    const estId = est.body.id as string;
    const originalTotal = est.body.totalCents;

    // Three scopes. o3 mixes a taxable and a non-taxable line so the tax
    // assertion actually discriminates.
    const mk = (name: string, tier: number, items: any[]) =>
      api(`/api/crm/estimates/${estId}/options`, {
        method: "POST", body: JSON.stringify({ name, tier, items }),
      }, cookie);
    const o1 = await mk("ColorPlus siding", 1, [scope("ColorPlus siding", 5000_00)]);
    expect(o1.status).toBe(201);
    // Totals are COMPUTED from the items at the estimate's own tax rate.
    expect(o1.body.subtotalCents).toBe(5000_00);
    expect(o1.body.totalCents).toBe(5500_00);
    const o2 = await mk("Primed siding + paint", 2, [scope("Primed siding + paint", 4200_00)]);
    expect(o2.status).toBe(201);
    const o3 = await mk("Shingle upgrade", 3, [
      scope("Shingle upgrade", 1000_00),
      scope("Dump fees", 800_00, false),
    ]);
    expect(o3.status).toBe(201);
    // A legacy option with no items is display-only — selecting it must 400.
    const legacy = await api(`/api/crm/estimates/${estId}/options`, {
      method: "POST", body: JSON.stringify({ name: "Talk to us", tier: 4, totalCents: 1 }),
    }, cookie);
    expect(legacy.status).toBe(201);

    const offers = await api(`/api/crm/estimates/${estId}/discounts`, {
      method: "PUT",
      body: JSON.stringify({
        offers: [{ code: "marketing", label: "Marketing discount", percentBps: 100, enabled: true }],
      }),
    }, cookie);
    expect(offers.status).toBe(200);
    const offerId = offers.body.offers[0].id as string;

    const [{ public_token: token }] = await pool.query(
      `select public_token from crm_estimates where id = $1`, [estId]).then((r) => r.rows);

    const cookieA = await clientCookie(customerA);

    // ── Guards first ──
    const bogus = await api(`/api/public/estimates/${token}/select-options`, {
      method: "POST", body: JSON.stringify({ optionIds: [o1.body.id, "not-a-real-option"] }),
    }, cookieA);
    expect(bogus.status).toBe(400);

    const itemless = await api(`/api/public/estimates/${token}/select-options`, {
      method: "POST", body: JSON.stringify({ optionIds: [legacy.body.id] }),
    }, cookieA);
    expect(itemless.status).toBe(400);

    const stranger = await api(`/api/public/estimates/${token}/select-options`, {
      method: "POST", body: JSON.stringify({ optionIds: [o1.body.id] }),
    }, await clientCookie(customerB));
    expect(stranger.status).toBe(401);

    // ── The real selection: o1 + o3, marketing discount ticked ──
    const sel = await api(`/api/public/estimates/${token}/select-options`, {
      method: "POST",
      body: JSON.stringify({ optionIds: [o1.body.id, o3.body.id], selectedDiscounts: [offerId] }),
    }, cookieA);
    expect(sel.status).toBe(200);
    expect(sel.body.token).toBeTruthy();
    // Subtotal 6800.00, taxable base 6000.00, tax 600.00 — the optional
    // discount is NOT baked into the quote (it lands at approve time).
    expect(sel.body.totalCents).toBe(7400_00);

    const gen = await api(`/api/crm/estimates/${sel.body.estimateId}`, {}, cookie);
    expect(gen.status).toBe(200);
    expect(gen.body.estimate.customerId).toBe(customerA);
    expect(gen.body.estimate.title).toContain("your selections");
    expect(gen.body.estimate.taxCents).toBe(600_00);
    expect(gen.body.estimate.totalCents).toBe(7400_00);
    // EXACTLY the chosen scopes' items — o1's one line + o3's two, never o2.
    const names = gen.body.items.map((i: any) => i.name);
    expect(names).toEqual(["ColorPlus siding", "Shingle upgrade", "Dump fees"]);

    // The new document's public payload carries the copied offer, pre-ticked.
    const pub = await api(`/api/public/estimates/${sel.body.token}`, {}, cookieA);
    expect(pub.status).toBe(200);
    expect(pub.body.options).toEqual([]);
    expect(pub.body.discountOffers).toHaveLength(1);
    expect(pub.body.preselectedDiscounts).toEqual([pub.body.discountOffers[0].id]);

    // ── The original is untouched, but carries the trail ──
    const orig = await api(`/api/crm/estimates/${estId}`, {}, cookie);
    expect(orig.body.estimate.totalCents).toBe(originalTotal);
    expect(orig.body.estimate.approvedAt).toBeNull();
    const [origRow] = await pool.query(
      `select custom_fields from crm_estimates where id = $1`, [estId]).then((r) => r.rows);
    expect(origRow.custom_fields.clientSelection.newEstimateNumber).toBe(sel.body.number);
    const events = await pool.query(
      `select type, estimate_id from crm_estimate_events where estimate_id in ($1, $2) order by created_at`,
      [estId, sel.body.estimateId]).then((r) => r.rows);
    expect(events.some((e: any) => e.estimate_id === estId && e.type === "options_selected")).toBe(true);
    expect(events.some((e: any) => e.estimate_id === sel.body.estimateId && e.type === "created")).toBe(true);
    const audit = await pool.query(
      `select action, meta from crm_activity_log where entity_id = $1 and action = 'estimate_options_selected'`,
      [estId]).then((r) => r.rows);
    expect(audit).toHaveLength(1);
    expect(audit[0].meta.newEstimateNumber).toBe(sel.body.number);

    // ── Approve the regenerated estimate: the pre-ticked discount recomputes ──
    // taxableBase 6000.00 − 1% (60.00) → tax 594.00; total 6800 − 60 + 594 = 7334.00.
    const approve = await api(`/api/public/estimates/${sel.body.token}/respond`, {
      method: "POST",
      body: JSON.stringify({
        decision: "approve", signatureName: "Vitest Signer",
        selectedDiscounts: [pub.body.discountOffers[0].id],
      }),
    }, cookieA);
    expect(approve.status).toBe(200);
    const [approvedRow] = await pool.query(
      `select approved_total_cents from crm_estimates where id = $1`, [sel.body.estimateId]).then((r) => r.rows);
    expect(approvedRow.approved_total_cents).toBe(7334_00);

    // Selecting from an answered original is closed.
    const oOrig = await api(`/api/public/estimates/${token}/respond`, {
      method: "POST", body: JSON.stringify({ decision: "approve", signatureName: "Vitest Signer" }),
    }, cookieA);
    expect(oOrig.status).toBe(200);
    const tooLate = await api(`/api/public/estimates/${token}/select-options`, {
      method: "POST", body: JSON.stringify({ optionIds: [o1.body.id] }),
    }, cookieA);
    expect(tooLate.status).toBe(409);
  });

  it("re-selection supersedes the previous generated estimate — no zombie duplicates", async () => {
    const run = Date.now().toString(36);
    const customerId = await makeCustomer(`re${run}`);
    const est = await api("/api/crm/estimates", {
      method: "POST",
      body: JSON.stringify({
        customerId, title: `Vitest optsel re ${run}`, taxRateBps: 0,
        items: [scope("Base line", 100_00)],
      }),
    }, cookie);
    expect(est.status).toBe(201);
    const estId = est.body.id as string;
    const o1 = await api(`/api/crm/estimates/${estId}/options`, {
      method: "POST", body: JSON.stringify({ name: "Scope one", tier: 1, items: [scope("Scope one", 1000_00)] }),
    }, cookie);
    const o2 = await api(`/api/crm/estimates/${estId}/options`, {
      method: "POST", body: JSON.stringify({ name: "Scope two", tier: 2, items: [scope("Scope two", 2000_00)] }),
    }, cookie);
    expect(o1.status).toBe(201);
    expect(o2.status).toBe(201);
    const [{ public_token: token }] = await pool.query(
      `select public_token from crm_estimates where id = $1`, [estId]).then((r) => r.rows);
    const cc = await clientCookie(customerId);

    const first = await api(`/api/public/estimates/${token}/select-options`, {
      method: "POST", body: JSON.stringify({ optionIds: [o1.body.id] }),
    }, cc);
    expect(first.status).toBe(200);
    const second = await api(`/api/public/estimates/${token}/select-options`, {
      method: "POST", body: JSON.stringify({ optionIds: [o2.body.id] }),
    }, cc);
    expect(second.status).toBe(200);
    expect(second.body.estimateId).not.toBe(first.body.estimateId);

    // The first generated estimate is cancelled with a pointer to the second.
    const [gen1] = await pool.query(
      `select status, custom_fields from crm_estimates where id = $1`, [first.body.estimateId]).then((r) => r.rows);
    expect(gen1.status).toBe("cancelled");
    expect(gen1.custom_fields.supersededByEstimateId).toBe(second.body.estimateId);
    // …and exactly one live selection estimate remains for the original.
    const live = await pool.query(
      `select id from crm_estimates
       where custom_fields->>'selectedFromEstimateId' = $1
         and approved_at is null and declined_at is null and status <> 'cancelled'`,
      [estId]).then((r) => r.rows);
    expect(live.map((r: any) => r.id)).toEqual([second.body.estimateId]);
  });
});
