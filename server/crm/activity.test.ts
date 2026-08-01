/**
 * Accountability log — crm_activity_log and its three surfaces + export gate.
 *
 * Requires the local dev server (DEV_AUTH_BYPASS_USER1=true):
 *   DATABASE_URL=… DEV_AUTH_BYPASS_USER1=true PORT=8119 npx tsx --env-file=.env server/index.ts
 * Override the target with CRM_TEST_BASE_URL; the DB with DATABASE_URL.
 *
 * Writes are fire-and-forget by design (recordActivity never blocks the
 * mutation it describes), so every assertion polls the table briefly.
 * Fixtures are throwaway customers/invoices/price-book items created through
 * the real API and cleaned up afterwards; the audit rows this suite produces
 * (org-scoped, created after suite start) are deleted too. The permission
 * tests flip the dev member's role directly in the DB and restore it, same
 * pattern as client-360.test.ts.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomBytes } from "crypto";
import pg from "pg";
import bcrypt from "bcryptjs";

// activity.ts → tenancy.ts → ../stripe throws at module scope without a key;
// a dummy is enough (no Stripe calls are made here).
process.env.STRIPE_SECRET_KEY ||= "sk_test_dummy_for_module_import";
const { activityText } = await import("./activity");

const BASE = process.env.CRM_TEST_BASE_URL ?? "http://127.0.0.1:8119";

const pool = new pg.Pool({
  connectionString:
    process.env.DATABASE_URL ??
    "postgres://constructhub_dev:crmdev_local_only@127.0.0.1:5432/constructhub_dev",
});
const q = <T = any>(text: string, params: any[] = []) =>
  pool.query(text, params).then((r) => r.rows as T[]);

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
  const ct = res.headers.get("content-type") ?? "";
  const body = ct.includes("json") ? await res.json().catch(() => null) : await res.text();
  return { status: res.status, body, cookie: setCookie?.split(";")[0] ?? cookie, headers: res.headers };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Poll the audit table until one matching row exists (writes are fire-and-forget). */
async function waitForAudit(
  where: string,
  params: any[],
  timeoutMs = 5000,
): Promise<any | null> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const rows = await q(`select * from crm_activity_log where ${where} order by created_at desc limit 1`, params);
    if (rows.length) return rows[0];
    if (Date.now() > deadline) return null;
    await sleep(150);
  }
}

describe("activityText (pure)", () => {
  it("renders who-did-what sentences", () => {
    expect(activityText({ actorLabel: "Dave", action: "estimate.updated", meta: { number: "E-1847" } }))
      .toBe("Dave updated estimate E-1847");
    expect(activityText({ actorLabel: "Sarah", action: "payment.recorded", meta: { amountCents: 200000, method: "check", number: "INV-1001" } }))
      .toBe("Sarah recorded payment $2,000.00 via check on invoice INV-1001");
    expect(activityText({ actorLabel: "Dave", action: "login" })).toBe("Dave signed in");
    expect(activityText({ actorLabel: "Dave", action: "data.exported", meta: { rows: 42 } }))
      .toBe("Dave exported the client list (42 rows)");
  });
});

describe("accountability log (dev server)", () => {
  const stamp = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const memberEmail = `vitest.activity.member.${stamp}@example.com`;
  const memberName = `Vitest Actor ${stamp}`;
  const MEMBER_PW = `Vitest-pw-${stamp}!`;

  let cookie: string | undefined;
  let orgId: string;
  let devMemberId: string;
  let devMemberRole: string;
  let devMemberPermissions: unknown;
  let suiteStart: string;
  let custA: string;
  let custB: string;
  let estimateId: string;
  let invoiceId: string;
  let pbItemId: string;
  let memberId: string;
  let memberUserId: number;

  beforeAll(async () => {
    const me = await api("/api/crm/me");
    if (me.status !== 200) {
      throw new Error(`CRM dev server not reachable at ${BASE} (GET /api/crm/me → ${me.status}). Start it first.`);
    }
    cookie = me.cookie;
    orgId = me.body.org.id;
    devMemberId = me.body.member.id;
    const [dm] = await q<{ role: string; permissions: unknown }>(
      `select role, permissions from crm_members where id = $1`, [devMemberId]);
    devMemberRole = dm.role;
    devMemberPermissions = dm.permissions ?? null;
    const [{ now }] = await q<{ now: Date }>(`select now()`);
    suiteStart = now.toISOString();

    const mk = async (label: string) => {
      const r = await api("/api/crm/customers", {
        method: "POST",
        body: JSON.stringify({ displayName: `Vitest Activity ${stamp} ${label}`, email: `vitest.activity.${stamp}.${label}@example.com` }),
      }, cookie);
      expect(r.status).toBe(201);
      return r.body.id as string;
    };
    custA = await mk("a");
    custB = await mk("b");

    // A team member for the login/logout rows.
    const hash = bcrypt.hashSync(MEMBER_PW, 10);
    const [{ id: uid }] = await q<{ id: number }>(
      `insert into users (email, password_hash, display_name, email_verified, account_id)
       values ($1, $2, $3, true, $4) returning id`,
      [memberEmail, hash, memberName, `VIT${randomBytes(6).toString("hex").toUpperCase()}`],
    );
    memberUserId = uid;
    const [{ id: mid }] = await q<{ id: string }>(
      `insert into crm_members (org_id, user_id, email, role, status, display_name)
       values ($1, $2, $3, 'field', 'active', $4) returning id`,
      [orgId, uid, memberEmail, memberName],
    );
    memberId = mid;
  });

  afterAll(async () => {
    try {
      // Restore the dev member's role first — the force-delete below is owner-only.
      await q(`update crm_members set role = $2, permissions = $3 where id = $1`,
        [devMemberId, devMemberRole, devMemberPermissions === null ? null : JSON.stringify(devMemberPermissions)]);
      // Owner hard-delete takes the whole tree (estimates, invoices, payments).
      for (const c of [custA, custB]) {
        await api(`/api/crm/customers/${c}?force=1`, { method: "DELETE" }, cookie);
      }
      await q(`delete from crm_pb_item_parts where item_id = $1`, [pbItemId]).catch(() => {});
      await q(`delete from crm_pb_items where id = $1`, [pbItemId]).catch(() => {});
      // Every audit row this suite wrote (the force-deletes above add a few).
      await q(`delete from crm_activity_log where org_id = $1 and created_at >= $2`, [orgId, suiteStart]);
      await q(`delete from crm_members where id = $1`, [memberId]);
      await q(`delete from users where id = $1`, [memberUserId]);
    } finally {
      await pool.end();
    }
  });

  it("mutations write audit rows with the right actor, action and customer", async () => {
    // customer.created fired in beforeAll.
    const created = await waitForAudit(
      `org_id = $1 and action = 'customer.created' and customer_id = $2`, [orgId, custA]);
    expect(created).toBeTruthy();
    expect(created.actor_member_id).toBe(devMemberId);
    expect(created.actor_label.length).toBeGreaterThan(0);

    // customer.updated — field names in meta, never values.
    const patch = await api(`/api/crm/customers/${custA}`, {
      method: "PATCH", body: JSON.stringify({ phone: "555-0999" }),
    }, cookie);
    expect(patch.status).toBe(200);
    const updated = await waitForAudit(
      `org_id = $1 and action = 'customer.updated' and customer_id = $2`, [orgId, custA]);
    expect(updated).toBeTruthy();
    expect(updated.meta.fields).toContain("phone");
    expect(JSON.stringify(updated.meta)).not.toContain("555-0999");

    // estimate.created + estimate.updated (items replace).
    const est = await api("/api/crm/estimates", {
      method: "POST",
      body: JSON.stringify({
        customerId: custA,
        title: "Vitest activity estimate",
        items: [{ kind: "labor", name: "line", quantityMilli: 1000, unitPriceCents: 50000, taxable: false, hiddenFromClient: false, sortOrder: 0 }],
      }),
    }, cookie);
    expect(est.status).toBe(201);
    estimateId = est.body.id;
    const estCreated = await waitForAudit(
      `org_id = $1 and action = 'estimate.created' and customer_id = $2`, [orgId, custA]);
    expect(estCreated).toBeTruthy();
    expect(estCreated.meta.number).toBe(est.body.number);
    expect(estCreated.actor_member_id).toBe(devMemberId);

    const putItems = await api(`/api/crm/estimates/${estimateId}/items`, {
      method: "PUT",
      body: JSON.stringify({
        items: [{ kind: "labor", name: "line v2", quantityMilli: 2000, unitPriceCents: 50000, taxable: false, hiddenFromClient: false, sortOrder: 0 }],
      }),
    }, cookie);
    expect(putItems.status).toBe(200);
    expect(await waitForAudit(
      `org_id = $1 and action = 'estimate.updated' and entity_id = $2`, [orgId, estimateId])).toBeTruthy();

    // discount.updated.
    const disc = await api(`/api/crm/estimates/${estimateId}/discounts`, {
      method: "PUT",
      body: JSON.stringify({ offers: [{ code: "VIP10", label: "VIP 10%", percentBps: 1000, enabled: true }] }),
    }, cookie);
    expect(disc.status).toBe(200);
    const discRow = await waitForAudit(
      `org_id = $1 and action = 'discount.updated' and entity_id = $2`, [orgId, estimateId]);
    expect(discRow).toBeTruthy();
    expect(discRow.customer_id).toBe(custA);

    // invoice.created + payment.recorded.
    const inv = await api("/api/crm/invoices", {
      method: "POST",
      body: JSON.stringify({
        customerId: custA,
        title: "Vitest activity invoice",
        items: [{ kind: "labor", name: "line", quantityMilli: 1000, unitPriceCents: 100000, taxable: false }],
      }),
    }, cookie);
    expect(inv.status).toBe(201);
    invoiceId = inv.body.id;
    expect(await waitForAudit(
      `org_id = $1 and action = 'invoice.created' and customer_id = $2`, [orgId, custA])).toBeTruthy();

    const pay = await api(`/api/crm/invoices/${invoiceId}/payments`, {
      method: "POST", body: JSON.stringify({ amountCents: 40000, method: "check" }),
    }, cookie);
    expect(pay.status).toBe(201);
    const payRow = await waitForAudit(
      `org_id = $1 and action = 'payment.recorded' and customer_id = $2`, [orgId, custA]);
    expect(payRow).toBeTruthy();
    expect(payRow.meta.amountCents).toBe(40000);
    expect(payRow.meta.method).toBe("check");

    // pricebook.updated — created, updated, deleted (soft).
    const item = await api("/api/crm/pricebook/items", {
      method: "POST", body: JSON.stringify({ name: `Vitest activity item ${stamp}`, unit: "ea", pricingMode: "flat", flatPriceCents: 12300 }),
    }, cookie);
    expect(item.status).toBe(201);
    pbItemId = item.body.id;
    expect(await waitForAudit(
      `org_id = $1 and action = 'pricebook.updated' and entity_id = $2 and meta->>'change' = 'created'`,
      [orgId, pbItemId])).toBeTruthy();
    const pbPatch = await api(`/api/crm/pricebook/items/${pbItemId}`, {
      method: "PATCH", body: JSON.stringify({ flatPriceCents: 12400 }),
    }, cookie);
    expect(pbPatch.status).toBe(200);
    expect(await waitForAudit(
      `org_id = $1 and action = 'pricebook.updated' and entity_id = $2 and meta->>'change' = 'updated'`,
      [orgId, pbItemId])).toBeTruthy();
    const pbDel = await api(`/api/crm/pricebook/items/${pbItemId}`, { method: "DELETE" }, cookie);
    expect(pbDel.status).toBe(200);
    expect(await waitForAudit(
      `org_id = $1 and action = 'pricebook.updated' and entity_id = $2 and meta->>'change' = 'deleted'`,
      [orgId, pbItemId])).toBeTruthy();
  });

  it("login and logout write rows for the member who signed in", async () => {
    const login = await api("/api/auth/login", {
      method: "POST", body: JSON.stringify({ email: memberEmail, password: MEMBER_PW }),
    });
    expect(login.status).toBe(200);
    const loginRow = await waitForAudit(
      `org_id = $1 and action = 'login' and actor_member_id = $2`, [orgId, memberId]);
    expect(loginRow).toBeTruthy();
    expect(loginRow.actor_label).toBe(memberName);

    const logout = await api("/api/auth/logout", { method: "POST", body: "{}" }, login.cookie);
    expect(logout.status).toBe(200);
    expect(await waitForAudit(
      `org_id = $1 and action = 'logout' and actor_member_id = $2`, [orgId, memberId])).toBeTruthy();
  });

  it("per-customer activity returns exactly that customer's rows", async () => {
    const res = await api(`/api/crm/customers/${custA}/activity`, {}, cookie);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    const actions = res.body.map((r: any) => r.action);
    expect(actions).toContain("estimate.created");
    expect(actions).toContain("payment.recorded");
    // Exact match with the table — nothing from custB (or anywhere else) leaks in.
    const dbIds = (await q<{ id: string }>(
      `select id from crm_activity_log where org_id = $1 and customer_id = $2`, [orgId, custA]))
      .map((r) => `act-${r.id}`).sort();
    expect(res.body.map((r: any) => r.id).sort()).toEqual(dbIds);

    const resB = await api(`/api/crm/customers/${custB}/activity`, {}, cookie);
    expect(resB.status).toBe(200);
    const actionsB = resB.body.map((r: any) => r.action);
    expect(actionsB).toContain("customer.created");
    expect(actionsB).not.toContain("estimate.created");
  });

  it("member activity is owner-only: 200 for the owner, 403 after a role flip", async () => {
    const ok = await api(`/api/crm/members/${devMemberId}/activity`, {}, cookie);
    expect(ok.status).toBe(200);
    expect(ok.body.some((r: any) => r.action === "estimate.created")).toBe(true);
    // Newest first.
    const ats = ok.body.map((r: any) => new Date(r.at).getTime());
    expect([...ats].sort((a, b) => b - a)).toEqual(ats);

    try {
      await q(`update crm_members set role = 'field' where id = $1`, [devMemberId]);
      const denied = await api(`/api/crm/members/${devMemberId}/activity`, {}, cookie);
      expect(denied.status).toBe(403);
    } finally {
      await q(`update crm_members set role = $2 where id = $1`, [devMemberId, devMemberRole]);
    }
  });

  it("client export: CSV with permission, 403 without, and a data.exported row", async () => {
    const ok = await api("/api/crm/customers/export.csv", {}, cookie);
    expect(ok.status).toBe(200);
    expect(ok.headers.get("content-type")).toContain("text/csv");
    expect(typeof ok.body).toBe("string");
    expect(ok.body).toContain("id,name,email,phone");
    expect(ok.body).toContain(`Vitest Activity ${stamp} a`);

    const exportRow = await waitForAudit(
      `org_id = $1 and action = 'data.exported' and actor_member_id = $2`, [orgId, devMemberId]);
    expect(exportRow).toBeTruthy();
    expect(exportRow.meta.rows).toBeGreaterThanOrEqual(2);

    try {
      // A plain field seat (role default: no exportData) is refused…
      await q(`update crm_members set role = 'field', permissions = null where id = $1`, [devMemberId]);
      const denied = await api("/api/crm/customers/export.csv", {}, cookie);
      expect(denied.status).toBe(403);
      // …and an explicit per-seat grant of exportData re-opens it — the same
      // grant the owner flips on the team page's switch-exportData-* control.
      await q(`update crm_members set permissions = '{"exportData": true}' where id = $1`, [devMemberId]);
      const granted = await api("/api/crm/customers/export.csv", {}, cookie);
      expect(granted.status).toBe(200);
    } finally {
      await q(`update crm_members set role = $2, permissions = $3 where id = $1`,
        [devMemberId, devMemberRole, devMemberPermissions === null ? null : JSON.stringify(devMemberPermissions)]);
    }
  });
});
