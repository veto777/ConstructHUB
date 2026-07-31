/**
 * The money path, end to end, against the running dev server.
 *
 * Requires the local dev server (DEV_AUTH_BYPASS_USER1=true):
 *   DATABASE_URL=… DEV_AUTH_BYPASS_USER1=true PORT=8119 npx tsx --env-file=.env server/index.ts
 * Override the target with CRM_TEST_BASE_URL.
 *
 * Every number here is integer cents and must match hand-computed values
 * EXACTLY — these are the same figures §9 of analysis/CRM-BRAIN.md records
 * from the original curl verification.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { createHash, randomBytes } from "crypto";
import pg from "pg";

const BASE = process.env.CRM_TEST_BASE_URL ?? "http://127.0.0.1:8119";

// The public document routes are email-gated now: they serve only to a
// browser holding a crm_client session covering the document's customer.
// Tests mint that session directly (same shape as a redeemed magic link).
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

describe("money pipeline", () => {
  it("runs the full estimate → approve → progress-invoice → void flow with exact cents", async () => {
    const run = Date.now();

    // 1. Customer: portal token is minted but never serialised; only the path.
    const cust = await api("/api/crm/customers", {
      method: "POST",
      body: JSON.stringify({
        displayName: `Vitest Client ${run}`,
        email: `vitest.${run}@example.com`,
        phone: `(941) 555-${String(run % 10000).padStart(4, "0")}`,
        city: "Sarasota", state: "FL",
      }),
    }, cookie);
    expect(cust.status).toBe(201);
    expect(cust.body.portalPath).toMatch(/^\/portal\/[0-9a-f]{48}$/);
    expect(cust.body.portalToken).toBeUndefined();

    // 2. Project to hang the contract value on.
    const proj = await api("/api/crm/projects", {
      method: "POST",
      body: JSON.stringify({ customerId: cust.body.id, name: `Vitest roof ${run}` }),
    }, cookie);
    expect(proj.status).toBe(201);

    // 3. Estimate. Client-supplied totals are bogus on purpose — the server
    //    must ignore them and recompute from the line items.
    const est = await api("/api/crm/estimates", {
      method: "POST",
      body: JSON.stringify({
        customerId: cust.body.id, projectId: proj.body.id,
        title: "Vitest estimate", taxRateBps: 880,
        subtotalCents: 1, discountCents: 1, taxCents: 1, totalCents: 1,
        items: [
          { kind: "labor", name: "Tear-off", quantityMilli: 1000, unitPriceCents: 400000 },
          { kind: "material", name: "Shingles", quantityMilli: 1000, unitPriceCents: 512000 },
          { kind: "discount", name: "Loyalty", quantityMilli: 1000, unitPriceCents: 50000 },
        ],
      }),
    }, cookie);
    expect(est.status).toBe(201);
    expect(est.body.subtotalCents).toBe(912000);
    expect(est.body.discountCents).toBe(50000);
    expect(est.body.taxCents).toBe(75856);
    expect(est.body.totalCents).toBe(937856);

    // 4. Send: always returns a copyable link, even if SMTP is down.
    const send = await api(`/api/crm/estimates/${est.body.id}/send`, { method: "POST", body: "{}" }, cookie);
    expect(send.status).toBe(200);
    expect(send.body.link).toMatch(/\/e\/[0-9a-f]{48}$/);
    expect(send.body.estimate.status).toBe("sent");
    const token = send.body.link.split("/e/")[1];

    // 5. Public view (as the verified client — the route is email-gated):
    //    first open flips sent → viewed and counts ONE view; a refresh from
    //    the same IP inside the window must not inflate it.
    const client = await clientCookie(cust.body.id);
    const v1 = await api(`/api/public/estimates/${token}`, {}, client);
    expect(v1.status).toBe(200);
    expect(v1.body.estimate.status).toBe("viewed");
    expect(v1.body.estimate.totalCents).toBe(937856);
    const v2 = await api(`/api/public/estimates/${token}`, {}, client);
    expect(v2.status).toBe(200);
    const detail = await api(`/api/crm/estimates/${est.body.id}`, {}, cookie);
    expect(detail.body.estimate.viewCount).toBe(1);
    expect(detail.body.estimate.firstViewedAt).toBeTruthy();
    expect(detail.body.estimate.lastViewedAt).toBeTruthy();

    // 6. Guards: approve without a name → 400.
    const noName = await api(`/api/public/estimates/${token}/respond`, {
      method: "POST", body: JSON.stringify({ decision: "approve" }),
    }, client);
    expect(noName.status).toBe(400);

    // 7. Approve with a typed name → project advances and takes the total.
    const approve = await api(`/api/public/estimates/${token}/respond`, {
      method: "POST", body: JSON.stringify({ decision: "approve", signatureName: "Vitest Signer" }),
    }, client);
    expect(approve.status).toBe(200);
    const projAfter = await api(`/api/crm/projects?customerId=${cust.body.id}`, {}, cookie);
    const mine = projAfter.body.projects.find((p: any) => p.id === proj.body.id);
    expect(mine.status).toBe("approved");
    expect(mine.contractValueCents).toBe(937856);

    // 8. Double approve → 409.
    const again = await api(`/api/public/estimates/${token}/respond`, {
      method: "POST", body: JSON.stringify({ decision: "approve", signatureName: "Vitest Signer" }),
    }, client);
    expect(again.status).toBe(409);

    // 9. Progress invoice: 50% draw with 10% retainage.
    //    456000 - 25000 + 37928 tax = 468928; retainage round(468928*0.10) = 46893.
    const inv = await api(`/api/crm/estimates/${est.body.id}/invoice`, {
      method: "POST", body: JSON.stringify({ percentBps: 5000, retainageBps: 1000 }),
    }, cookie);
    expect(inv.status).toBe(201);
    expect(inv.body.subtotalCents).toBe(456000);
    expect(inv.body.discountCents).toBe(25000);
    expect(inv.body.taxCents).toBe(37928);
    expect(inv.body.totalCents).toBe(468928);
    expect(inv.body.retainageCents).toBe(46893);

    // 10. Void: works once, 409 on the second attempt.
    const void1 = await api(`/api/crm/invoices/${inv.body.id}/void`, { method: "POST" }, cookie);
    expect(void1.status).toBe(200);
    expect(void1.body.status).toBe("void");
    const void2 = await api(`/api/crm/invoices/${inv.body.id}/void`, { method: "POST" }, cookie);
    expect(void2.status).toBe(409);
  });

  it("counts an approved change order exactly once in the revised contract", async () => {
    const run = Date.now();
    const cust = await api("/api/crm/customers", {
      method: "POST",
      body: JSON.stringify({ displayName: `Vitest CO ${run}`, email: `vitest.co.${run}@example.com` }),
    }, cookie);
    const proj = await api("/api/crm/projects", {
      method: "POST",
      body: JSON.stringify({ customerId: cust.body.id, name: `Vitest CO proj ${run}`, contractValueCents: 100000 }),
    }, cookie);

    const co = await api(`/api/crm/projects/${proj.body.id}/change-orders`, {
      method: "POST", body: JSON.stringify({ title: "Extra vent", amountCents: 45000 }),
    }, cookie);
    expect(co.status).toBe(201);
    const sent = await api(`/api/crm/change-orders/${co.body.id}/send`, { method: "POST" }, cookie);
    const token = sent.body.link.split("/co/")[1];
    const approve = await api(`/api/public/change-orders/${token}/respond`, {
      method: "POST", body: JSON.stringify({ decision: "approve", signatureName: "Vitest Signer" }),
    });
    expect(approve.status).toBe(200);

    // Regression pin: the CO handler must not fold the amount into the base
    // contract AND the costing endpoint add it again (historical bug —
    // revised came out as base + 2×CO).
    const costing = await api(`/api/crm/projects/${proj.body.id}/costing`, {}, cookie);
    expect(costing.body.totals.contractValueCents).toBe(100000);
    expect(costing.body.totals.changeOrderCents).toBe(45000);
    expect(costing.body.totals.revisedContractCents).toBe(145000);
  });
});
