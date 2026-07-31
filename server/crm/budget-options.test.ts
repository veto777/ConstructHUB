/**
 * Budget-line CRUD and estimate-option lifecycle guards, against the running
 * dev server (same setup as money-pipeline.test.ts — CRM_TEST_BASE_URL,
 * default http://127.0.0.1:8119 with DEV_AUTH_BYPASS_USER1=true).
 *
 * Pins three behaviours:
 *   1. Budget lines are writable through the API (create/patch/delete), and a
 *      line whose cost code already has committed/actual money is refused
 *      (409) rather than orphaning the ledger.
 *   2. Estimate options can't be added to or removed from an estimate that
 *      has been responded to (409), matching the line-item guard.
 *   3. Options can be deleted on an editable estimate.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { createHash, randomBytes } from "crypto";
import pg from "pg";

const BASE = process.env.CRM_TEST_BASE_URL ?? "http://127.0.0.1:8119";

// The public respond route is email-gated: approving needs a crm_client
// session covering the estimate's customer (minted here directly, same shape
// as a redeemed magic link).
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

/** Fresh customer + project per test, so reruns never collide. */
async function projectFixture(run: number, label: string) {
  const cust = await api("/api/crm/customers", {
    method: "POST",
    body: JSON.stringify({ displayName: `Vitest ${label} ${run}`, email: `vitest.${label}.${run}@example.com` }),
  }, cookie);
  expect(cust.status).toBe(201);
  const proj = await api("/api/crm/projects", {
    method: "POST",
    body: JSON.stringify({ customerId: cust.body.id, name: `Vitest ${label} proj ${run}` }),
  }, cookie);
  expect(proj.status).toBe(201);
  return { customerId: cust.body.id, projectId: proj.body.id };
}

/** Org-wide cost code unique to this run. */
async function costCodeFixture(run: number, label: string) {
  const cc = await api("/api/crm/cost-codes", {
    method: "POST",
    body: JSON.stringify({ code: `T-${run % 100000}-${label}`, name: `Vitest ${label} ${run}` }),
  }, cookie);
  expect(cc.status).toBe(201);
  return cc.body.id as string;
}

describe("budget-line CRUD", () => {
  it("creates, patches and deletes a line; bad refs are 400", async () => {
    const run = Date.now();
    const { projectId } = await projectFixture(run, "bl");
    const costCodeId = await costCodeFixture(run, "a");

    const badCc = await api(`/api/crm/projects/${projectId}/budget-lines`, {
      method: "POST", body: JSON.stringify({ costCodeId: "does-not-exist", budgetCents: 100 }),
    }, cookie);
    expect(badCc.status).toBe(400);

    const badPhase = await api(`/api/crm/projects/${projectId}/budget-lines`, {
      method: "POST", body: JSON.stringify({ costCodeId, budgetCents: 100, phaseId: "does-not-exist" }),
    }, cookie);
    expect(badPhase.status).toBe(400);

    const created = await api(`/api/crm/projects/${projectId}/budget-lines`, {
      method: "POST",
      body: JSON.stringify({ costCodeId, budgetCents: 150000, notes: "materials" }),
    }, cookie);
    expect(created.status).toBe(201);
    expect(created.body.budgetCents).toBe(150000);
    const lineId = created.body.id;

    const patched = await api(`/api/crm/budget-lines/${lineId}`, {
      method: "PATCH", body: JSON.stringify({ budgetCents: 175000, notes: "updated" }),
    }, cookie);
    expect(patched.status).toBe(200);
    expect(patched.body.budgetCents).toBe(175000);
    expect(patched.body.notes).toBe("updated");

    const del = await api(`/api/crm/budget-lines/${lineId}`, { method: "DELETE" }, cookie);
    expect(del.status).toBe(200);
    const delAgain = await api(`/api/crm/budget-lines/${lineId}`, { method: "DELETE" }, cookie);
    expect(delAgain.status).toBe(404);
  });

  it("refuses to delete or re-point a line whose cost code has committed/actual money (409)", async () => {
    const run = Date.now();
    const { projectId } = await projectFixture(run, "blc");
    const costCodeId = await costCodeFixture(run, "b");
    const otherCodeId = await costCodeFixture(run, "c");

    const created = await api(`/api/crm/projects/${projectId}/budget-lines`, {
      method: "POST", body: JSON.stringify({ costCodeId, budgetCents: 4200000 }),
    }, cookie);
    expect(created.status).toBe(201);
    const lineId = created.body.id;

    // Committed money on the same (project, cost code) pair.
    const po = await api(`/api/crm/projects/${projectId}/commitments`, {
      method: "POST", body: JSON.stringify({ costCodeId, vendorName: "ABC Supply", amountCents: 3950000 }),
    }, cookie);
    expect(po.status).toBe(201);

    const del = await api(`/api/crm/budget-lines/${lineId}`, { method: "DELETE" }, cookie);
    expect(del.status).toBe(409);

    const repoint = await api(`/api/crm/budget-lines/${lineId}`, {
      method: "PATCH", body: JSON.stringify({ costCodeId: otherCodeId }),
    }, cookie);
    expect(repoint.status).toBe(409);

    // …but changing the amount is always fine.
    const patchAmount = await api(`/api/crm/budget-lines/${lineId}`, {
      method: "PATCH", body: JSON.stringify({ budgetCents: 4300000 }),
    }, cookie);
    expect(patchAmount.status).toBe(200);
    expect(patchAmount.body.budgetCents).toBe(4300000);
  });
});

describe("estimate option guards", () => {
  it("POST and DELETE options 409 once the estimate is approved", async () => {
    const run = Date.now();
    const { customerId, projectId } = await projectFixture(run, "opt");
    const est = await api("/api/crm/estimates", {
      method: "POST",
      body: JSON.stringify({
        customerId, projectId, title: "Vitest options", taxRateBps: 0,
        items: [{ kind: "labor", name: "Work", quantityMilli: 1000, unitPriceCents: 100000 }],
      }),
    }, cookie);
    expect(est.status).toBe(201);

    // While editable: add and remove a tier freely.
    const opt = await api(`/api/crm/estimates/${est.body.id}/options`, {
      method: "POST", body: JSON.stringify({ name: "Good", tier: 1, totalCents: 100000 }),
    }, cookie);
    expect(opt.status).toBe(201);
    const del = await api(`/api/crm/estimates/${est.body.id}/options/${opt.body.id}`, { method: "DELETE" }, cookie);
    expect(del.status).toBe(200);
    const delAgain = await api(`/api/crm/estimates/${est.body.id}/options/${opt.body.id}`, { method: "DELETE" }, cookie);
    expect(delAgain.status).toBe(404);

    // Approve it through the public token (as the verified client).
    const send = await api(`/api/crm/estimates/${est.body.id}/send`, { method: "POST", body: "{}" }, cookie);
    const token = send.body.link.split("/e/")[1];
    const approve = await api(`/api/public/estimates/${token}/respond`, {
      method: "POST", body: JSON.stringify({ decision: "approve", signatureName: "Vitest Signer" }),
    }, await clientCookie(customerId));
    expect(approve.status).toBe(200);

    // Now the tier loop is closed: 409 on both write paths.
    const postAfter = await api(`/api/crm/estimates/${est.body.id}/options`, {
      method: "POST", body: JSON.stringify({ name: "Late tier", totalCents: 1 }),
    }, cookie);
    expect(postAfter.status).toBe(409);
    const delAfter = await api(`/api/crm/estimates/${est.body.id}/options/${opt.body.id}`, { method: "DELETE" }, cookie);
    expect(delAfter.status).toBe(409);
  });
});
