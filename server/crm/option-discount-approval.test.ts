/**
 * Options × optional discounts × deposit, end to end — the number the public
 * estimate page SHOWS is the number the server STORES on approval.
 *
 * The page previews with shared/estimate-totals.ts previewEstimatePage; the
 * server signs with the same module (discounts.ts recomputeApprovalTotals).
 * This suite feeds the real public payload into the page's preview function
 * and then approves for real:
 *
 *   1. Scope B ticked + a 5% offer: the "Your new total" the page quotes is
 *      B's total with 5% off — not 95% of the original estimate — and the
 *      generated estimate is approved for exactly that amount.
 *   2. No scope ticked: approving the document as written stores the
 *      document preview's total.
 *   3. Deposit: the pay route never asks for more than the signed total (a
 *      100% deposit + a 100% offer leaves nothing to pay — before the fix it
 *      went on to charge the full deposit).
 *
 * Against the running dev server, like option-selection.test.ts:
 *   CRM_TEST_BASE_URL=http://127.0.0.1:8131 npx vitest run server/crm/option-discount-approval.test.ts
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createHash, randomBytes } from "crypto";
import pg from "pg";
import { amountDueCents, previewEstimatePage } from "@shared/estimate-totals";

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
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}), ...(opts.headers || {}) },
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
afterAll(async () => { await pool.end(); });

const scope = (name: string, cents: number, taxable = true) => ({
  kind: "labor", name, quantityMilli: 1000, unitPriceCents: cents, taxable,
});
const post = (path: string, body: unknown, c = cookie) => api(path, { method: "POST", body: JSON.stringify(body) }, c);

/** One sent estimate ($20,000 at 7%) with scopes A/B and the given offer. */
async function setUp(tag: string, opts: { offerBps: number; depositCents?: number | null; withScopes?: boolean }) {
  const run = `${tag}${Date.now().toString(36)}`;
  const cust = await post("/api/crm/customers", { displayName: `Vitest optdisc ${run}`, email: `vitest.optdisc.${run}@example.com` });
  expect(cust.status).toBe(201);
  const customerId = cust.body.id as string;
  const est = await post("/api/crm/estimates", {
    customerId, title: `Vitest optdisc ${run}`, taxRateBps: 700,
    depositCents: opts.depositCents ?? null,
    items: [scope("Whole house as written", 20_000_00)],
  });
  expect(est.status).toBe(201);
  const estId = est.body.id as string;
  expect(est.body.totalCents).toBe(21_400_00);
  expect((await api(`/api/crm/estimates/${estId}`, { method: "PATCH", body: JSON.stringify({ status: "sent" }) }, cookie)).status).toBe(200);

  let a: any = null, b: any = null;
  if (opts.withScopes !== false) {
    a = (await post(`/api/crm/estimates/${estId}/options`, { name: "Good", tier: 1, items: [scope("Good siding", 8_000_00)] })).body;
    b = (await post(`/api/crm/estimates/${estId}/options`, {
      name: "Best", tier: 2, items: [scope("Best siding", 12_000_00), scope("Dump fees", 500_00, false)],
    })).body;
    expect(a?.id && b?.id).toBeTruthy();
  }
  const offers = await api(`/api/crm/estimates/${estId}/discounts`, {
    method: "PUT",
    body: JSON.stringify({ offers: [{ code: "pay_in_full", label: "Pay-in-full discount", percentBps: opts.offerBps, enabled: true }] }),
  }, cookie);
  expect(offers.status).toBe(200);
  const [{ public_token: token }] = (await pool.query(`select public_token from crm_estimates where id = $1`, [estId])).rows;
  return { customerId, estId, token: token as string, a, b, client: await clientCookie(customerId) };
}

const stored = async (estimateId: string) =>
  (await pool.query(
    `select total_cents, approved_total_cents, deposit_cents, selected_discounts from crm_estimates where id = $1`,
    [estimateId])).rows[0];

describe("options × optional discounts × deposit (dev server)", () => {
  it("scope B + 5%: the page's new total is B with 5% off, and that is what gets signed", async () => {
    const s = await setUp("b", { offerBps: 500 });
    const pub = await api(`/api/public/estimates/${s.token}`, {}, s.client);
    expect(pub.status).toBe(200);
    const offer = pub.body.discountOffers[0];
    const B = pub.body.options.find((o: any) => o.id === s.b.id);
    expect(B).toMatchObject({ selectable: true, subtotalCents: 12_500_00, taxableCents: 12_000_00, lineDiscountCents: 0 });

    // Exactly what the page computes from this payload with B and the offer ticked.
    const page = previewEstimatePage(pub.body.estimate, [B], [offer]);
    expect(page.noteBasis).toBe("scopes");
    expect(page.noteTotalCents).toBe(12_698_00);        // 12,500 − 600 + 7% of 11,400
    expect(page.document.totalCents).toBe(20_330_00);   // the ORIGINAL with 5% off — the number the page used to quote

    const sel = await post(`/api/public/estimates/${s.token}/select-options`,
      { optionIds: [s.b.id], selectedDiscounts: [offer.id] }, s.client);
    expect(sel.status).toBe(200);
    const gen = await api(`/api/public/estimates/${sel.body.token}`, {}, s.client);
    expect(gen.status).toBe(200);
    // The regenerated document, opened fresh, previews the same number…
    const genPage = previewEstimatePage(gen.body.estimate, [],
      gen.body.discountOffers.filter((o: any) => gen.body.preselectedDiscounts.includes(o.id)));
    expect(genPage.noteTotalCents).toBe(page.noteTotalCents);

    // …and the server signs it.
    const approve = await post(`/api/public/estimates/${sel.body.token}/respond`,
      { decision: "approve", signatureName: "Vitest Signer", selectedDiscounts: gen.body.preselectedDiscounts }, s.client);
    expect(approve.status).toBe(200);
    const row = await stored(sel.body.estimateId);
    expect(row.approved_total_cents).toBe(page.noteTotalCents);
    expect(row.selected_discounts.map((d: any) => d.code)).toEqual(["pay_in_full"]);
    // The original was never approved and still quotes its own total.
    const orig = await stored(s.estId);
    expect(orig.approved_total_cents).toBeNull();
    expect(orig.total_cents).toBe(21_400_00);
  });

  it("scope A + 5%, then no discount at signing: each stored total matches its preview", async () => {
    const s = await setUp("a", { offerBps: 500 });
    const pub = await api(`/api/public/estimates/${s.token}`, {}, s.client);
    const offer = pub.body.discountOffers[0];
    const A = pub.body.options.find((o: any) => o.id === s.a.id);
    expect(previewEstimatePage(pub.body.estimate, [A], [offer]).noteTotalCents).toBe(8_132_00);
    const undiscounted = previewEstimatePage(pub.body.estimate, [A], []);
    expect(undiscounted.noteTotalCents).toBe(8_560_00);

    const sel = await post(`/api/public/estimates/${s.token}/select-options`, { optionIds: [s.a.id] }, s.client);
    expect(sel.status).toBe(200);
    expect(sel.body.totalCents).toBe(undiscounted.noteTotalCents);
    const approve = await post(`/api/public/estimates/${sel.body.token}/respond`,
      { decision: "approve", signatureName: "Vitest Signer" }, s.client);
    expect(approve.status).toBe(200);
    expect((await stored(sel.body.estimateId)).approved_total_cents).toBe(8_560_00);
  });

  it("no scope ticked: approving the document as written stores the document preview", async () => {
    const s = await setUp("d", { offerBps: 500, depositCents: 21_400_00 }); // a 100% deposit on the quote
    const pub = await api(`/api/public/estimates/${s.token}`, {}, s.client);
    const offer = pub.body.discountOffers[0];
    const page = previewEstimatePage(pub.body.estimate, [], [offer]);
    expect(page.noteBasis).toBe("document");
    expect(page.noteTotalCents).toBe(20_330_00);

    const approve = await post(`/api/public/estimates/${s.token}/respond`,
      { decision: "approve", signatureName: "Vitest Signer", selectedDiscounts: [offer.id] }, s.client);
    expect(approve.status).toBe(200);
    const row = await stored(s.estId);
    expect(row.approved_total_cents).toBe(20_330_00);
    // The deposit on file is above the signed total; what is DUE is capped.
    expect(row.deposit_cents).toBe(21_400_00);
    const after = await api(`/api/public/estimates/${s.token}`, {}, s.client);
    expect(amountDueCents(after.body.estimate)).toBe(20_330_00);
  });

  it("the pay route never asks for more than the signed total", async () => {
    // A 100% deposit, then a 100% concession at signing: the job is $0.
    const s = await setUp("p", { offerBps: 10_000, depositCents: 21_400_00, withScopes: false });
    const pub = await api(`/api/public/estimates/${s.token}`, {}, s.client);
    const approve = await post(`/api/public/estimates/${s.token}/respond`,
      { decision: "approve", signatureName: "Vitest Signer", selectedDiscounts: [pub.body.discountOffers[0].id] }, s.client);
    expect(approve.status).toBe(200);
    expect((await stored(s.estId)).approved_total_cents).toBe(0);
    // Before the cap this went past the amount check with the full $21,400
    // deposit (and answered 503/checkout); now there is nothing to pay.
    const pay = await post(`/api/public/estimates/${s.token}/pay`, {}, s.client);
    expect(pay.status).toBe(400);
    expect(pay.body.message).toBe("Nothing to pay.");
  });
});
