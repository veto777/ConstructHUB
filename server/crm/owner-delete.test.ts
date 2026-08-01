/**
 * Owner-only hard deletes (test-document cleanup), against the running dev
 * server plus pure unit tests for the refusal rules.
 *
 * Requires the local dev server (DEV_AUTH_BYPASS_USER1=true):
 *   DATABASE_URL=… DEV_AUTH_BYPASS_USER1=true PORT=8119 npx tsx --env-file=.env server/index.ts
 * Override the target with CRM_TEST_BASE_URL.
 *
 * The gate is the ROLE itself (ctx.member.role === 'owner'), never a
 * permission flag — so admin and pm seats get 403, approved estimates and
 * paid/payment-bearing invoices get 409, and a client with documents needs
 * ?force=1 to take the whole tree down transactionally.
 *
 * Role-flip probes run in the ASPIRE org (nothing else in the suite touches
 * it) so they never race the parallel vitest files sharing the default org —
 * same trick as client-360.test.ts.
 */
process.env.STRIPE_SECRET_KEY ||= "sk_test_dummy_for_module_import";
process.env.DATABASE_URL ||= "postgres://localhost:5432/unused_no_queries_run";

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";

const BASE = process.env.CRM_TEST_BASE_URL ?? "http://127.0.0.1:8119";
const ASPIRE = "b839980a-ad26-44d4-9e83-df427bd60fe8";

const pool = new pg.Pool({
  connectionString:
    process.env.CRM_TEST_DATABASE_URL ??
    "postgres://constructhub_dev:crmdev_local_only@127.0.0.1:5432/constructhub_dev",
});
const q = <T = any>(text: string, params: any[] = []) =>
  pool.query(text, params).then((r) => r.rows as T[]);

async function api(path: string, opts: RequestInit = {}, cookie?: string) {
  const res = await fetch(`${BASE}${path}`, {
    redirect: "manual",
    ...opts,
    headers: {
      "content-type": "application/json",
      ...(cookie ? { cookie } : {}),
      ...(opts.headers || {}),
    },
  });
  const setCookie = res.headers.get("set-cookie");
  const ct = res.headers.get("content-type") ?? "";
  const body = ct.includes("json") ? await res.json().catch(() => null) : await res.text();
  return { status: res.status, body, cookie: setCookie?.split(";")[0] ?? cookie };
}

const post = (path: string, data: unknown, cookie?: string) =>
  api(path, { method: "POST", body: JSON.stringify(data) }, cookie);
const del = (path: string, cookie?: string) => api(path, { method: "DELETE" }, cookie);

const stamp = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

async function makeCustomer(cookie: string | undefined, name: string) {
  const r = await post("/api/crm/customers", {
    displayName: name, email: `vitest.del.${stamp}.${name.replace(/\W+/g, "").toLowerCase()}@example.com`,
  }, cookie);
  expect(r.status).toBe(201);
  return r.body.id as string;
}

async function makeEstimate(cookie: string | undefined, customerId: string, title = "Delete fixture estimate") {
  const r = await post("/api/crm/estimates", {
    customerId, title, introText: null, taxRateBps: 0,
    items: [{ kind: "labor", name: "Delete line", description: null, unit: null,
      quantityMilli: 1000, unitPriceCents: 100_00, taxable: true, hiddenFromClient: false, sortOrder: 0 }],
  }, cookie);
  expect(r.status).toBe(201);
  return r.body.id as string;
}

async function makeInvoice(cookie: string | undefined, customerId: string) {
  const r = await post("/api/crm/invoices", {
    customerId, title: "Delete fixture invoice", taxRateBps: 0,
    items: [{ kind: "labor", name: "Delete line", description: null, quantityMilli: 1000,
      unit: null, unitPriceCents: 200_00, costCodeId: null, taxable: true }],
  }, cookie);
  expect(r.status).toBe(201);
  return r.body.id as string;
}

// Every fixture customer, force-deleted in afterAll whatever happened.
const fixtureCustomers: { id: string; cookie: string | undefined }[] = [];
const track = (id: string, cookie: string | undefined) => (fixtureCustomers.push({ id, cookie }), id);

// ── Pure refusal rules ──────────────────────────────────────────────────────

describe("delete refusal rules (pure)", () => {
  it("estimateDeleteRefusal: approved (signed) is refused, every other state is deletable", async () => {
    const { estimateDeleteRefusal } = await import("./entities");
    expect(estimateDeleteRefusal({ status: "approved", approvedAt: new Date() })).toMatch(/signed/);
    expect(estimateDeleteRefusal({ status: "sent", approvedAt: new Date() })).toMatch(/signed/);
    for (const status of ["draft", "sent", "viewed", "declined", "expired", "cancelled"]) {
      expect(estimateDeleteRefusal({ status, approvedAt: null })).toBeNull();
    }
  });

  it("invoiceDeleteRefusal: paid or any payment row is refused, clean invoices are deletable", async () => {
    const { invoiceDeleteRefusal } = await import("./ops");
    const clean = { status: "sent", paidCents: 0, paidAt: null };
    expect(invoiceDeleteRefusal(clean, 0)).toBeNull();
    expect(invoiceDeleteRefusal({ ...clean, status: "paid" }, 0)).toMatch(/money trail/);
    expect(invoiceDeleteRefusal({ ...clean, paidCents: 50_00 }, 0)).toMatch(/money trail/);
    expect(invoiceDeleteRefusal({ ...clean, paidAt: new Date() }, 0)).toMatch(/money trail/);
    expect(invoiceDeleteRefusal(clean, 1)).toMatch(/[Pp]ayments/);
  });
});

// ── The routes, end to end ──────────────────────────────────────────────────

describe("owner-only deletes (dev server)", () => {
  let cookie: string | undefined;

  beforeAll(async () => {
    const me = await api("/api/crm/me");
    if (me.status !== 200) {
      throw new Error(`CRM dev server not reachable at ${BASE} (GET /api/crm/me → ${me.status}). Start it first.`);
    }
    expect(me.body.member.role).toBe("owner");
    cookie = me.cookie;
  });

  afterAll(async () => {
    for (const f of fixtureCustomers) {
      await del(`/api/crm/customers/${f.id}?force=1`, f.cookie).catch(() => {});
    }
    // Defensive: the role-flip probe always restores, even on a crash.
    await q(`update crm_members set role = 'owner' where org_id = $1 and user_id = 1`, [ASPIRE]);
    await pool.end();
  });

  it("owner deletes a draft estimate — the estimate and its children are gone", async () => {
    const custId = track(await makeCustomer(cookie, "Owner Del Est"), cookie);
    const estId = await makeEstimate(cookie, custId);

    // A discount offer row too, so the cascade covers every child table.
    const [{ org_id: orgId }] = await q<{ org_id: string }>(
      `select org_id from crm_estimates where id = $1`, [estId]);
    await q(
      `insert into crm_estimate_discounts (org_id, estimate_id, code, label, percent_bps)
       values ($1, $2, 'marketing', 'Fixture offer', 100)`, [orgId, estId]);

    const r = await del(`/api/crm/estimates/${estId}`, cookie);
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);

    for (const table of ["crm_estimates", "crm_estimate_items", "crm_estimate_events", "crm_estimate_discounts"]) {
      const col = table === "crm_estimates" ? "id" : "estimate_id";
      const [{ n }] = await q<{ n: number }>(
        `select count(*)::int as n from ${table} where ${col} = $1`, [estId]);
      expect(n, `${table} rows for ${estId}`).toBe(0);
    }

    // The deletion note landed on the client's activity.
    const notes = await q<{ body: string }>(
      `select body from crm_customer_notes where customer_id = $1`, [custId]);
    expect(notes.some((n) => n.body.includes("permanently deleted"))).toBe(true);
  });

  it("admin and pm get 403 — the estimate survives both probes (Aspire org)", async () => {
    const sw = await post("/api/crm/org/switch", { orgId: ASPIRE }, cookie);
    expect(sw.status).toBe(200);
    const ac = sw.cookie;

    const custId = track(await makeCustomer(ac, "Owner Del Gate"), ac);
    const estId = await makeEstimate(ac, custId);
    const [{ id: aspireMemberId }] = await q<{ id: string }>(
      `select id from crm_members where org_id = $1 and user_id = 1`, [ASPIRE]);

    try {
      for (const role of ["admin", "pm"]) {
        await q(`update crm_members set role = $1 where id = $2`, [role, aspireMemberId]);
        const r = await del(`/api/crm/estimates/${estId}`, ac);
        expect(r.status, `${role} must be 403`).toBe(403);
      }
      const [{ n }] = await q<{ n: number }>(
        `select count(*)::int as n from crm_estimates where id = $1`, [estId]);
      expect(n, "estimate must survive the admin/pm probes").toBe(1);
    } finally {
      await q(`update crm_members set role = 'owner' where id = $1`, [aspireMemberId]);
    }

    // Owner again: the same delete now succeeds (also proves the restore).
    const ok = await del(`/api/crm/estimates/${estId}`, ac);
    expect(ok.status).toBe(200);
  });

  it("an approved (signed) estimate is 409 — a contract is never deletable", async () => {
    const custId = track(await makeCustomer(cookie, "Owner Del Approved"), cookie);
    const estId = await makeEstimate(cookie, custId);
    await q(`update crm_estimates set status = 'approved', approved_at = now(),
             signature_name = 'Fixture Signer' where id = $1`, [estId]);

    const r = await del(`/api/crm/estimates/${estId}`, cookie);
    expect(r.status).toBe(409);
    const [{ n }] = await q<{ n: number }>(
      `select count(*)::int as n from crm_estimates where id = $1`, [estId]);
    expect(n).toBe(1);
  });

  it("a paid invoice is 409, and so is one with any payment recorded", async () => {
    const custId = track(await makeCustomer(cookie, "Owner Del Paid"), cookie);

    // Fully paid.
    const paidId = await makeInvoice(cookie, custId);
    const pay1 = await post(`/api/crm/invoices/${paidId}/payments`, {
      amountCents: 200_00, method: "check", note: null,
    }, cookie);
    expect(pay1.status).toBe(201);
    expect(pay1.body.invoice.status).toBe("paid");
    const r1 = await del(`/api/crm/invoices/${paidId}`, cookie);
    expect(r1.status, "paid invoice").toBe(409);

    // Partial payment — money recorded but not fully paid.
    const partialId = await makeInvoice(cookie, custId);
    const pay2 = await post(`/api/crm/invoices/${partialId}/payments`, {
      amountCents: 50_00, method: "cash", note: null,
    }, cookie);
    expect(pay2.status).toBe(201);
    const r2 = await del(`/api/crm/invoices/${partialId}`, cookie);
    expect(r2.status, "invoice with a payment recorded").toBe(409);

    // A clean invoice deletes fine, items and all.
    const cleanId = await makeInvoice(cookie, custId);
    const r3 = await del(`/api/crm/invoices/${cleanId}`, cookie);
    expect(r3.status).toBe(200);
    for (const table of ["crm_invoices", "crm_invoice_items"]) {
      const col = table === "crm_invoices" ? "id" : "invoice_id";
      const [{ n }] = await q<{ n: number }>(
        `select count(*)::int as n from ${table} where ${col} = $1`, [cleanId]);
      expect(n, `${table} rows for ${cleanId}`).toBe(0);
    }
  });

  it("a client with documents is 409 without force, and the whole tree goes with ?force=1", async () => {
    const custId = track(await makeCustomer(cookie, "Owner Del Tree"), cookie);
    const estId = await makeEstimate(cookie, custId);
    const invId = await makeInvoice(cookie, custId);
    const proj = await post("/api/crm/projects", { customerId: custId, name: "Delete fixture project" }, cookie);
    expect(proj.status).toBe(201);
    const projId = proj.body.id as string;

    const refused = await del(`/api/crm/customers/${custId}`, cookie);
    expect(refused.status).toBe(409);
    expect(refused.body.estimates).toBe(1);
    expect(refused.body.invoices).toBe(1);
    expect(refused.body.projects).toBe(1);

    const gone = await del(`/api/crm/customers/${custId}?force=1`, cookie);
    expect(gone.status).toBe(200);
    expect(gone.body.force).toBe(true);

    const checks: [string, string, string][] = [
      ["crm_customers", "id", custId],
      ["crm_estimates", "id", estId],
      ["crm_estimate_items", "estimate_id", estId],
      ["crm_estimate_events", "estimate_id", estId],
      ["crm_invoices", "id", invId],
      ["crm_invoice_items", "invoice_id", invId],
      ["crm_projects", "id", projId],
      ["crm_payments", "customer_id", custId],
    ];
    for (const [table, col, id] of checks) {
      const [{ n }] = await q<{ n: number }>(
        `select count(*)::int as n from ${table} where ${col} = $1`, [id]);
      expect(n, `${table} where ${col}=${id}`).toBe(0);
    }
  });
});
