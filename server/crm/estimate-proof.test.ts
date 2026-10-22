/**
 * "Send me a proof" (server/crm/estimate-proof.ts):
 *   1. the proof is the client's email (same builder), subject "[PROOF] …",
 *      mailed ONLY to the logged-in member — never the client;
 *   2. nothing about the estimate changes: status, sent_at, expiry, no client
 *      sign-in pass, no SMS — and a proof of a SENT estimate leaves its
 *      sent_at alone;
 *   3. the link is a contractor preview grant: it opens the page without a
 *      client session, is not counted as a view and cannot approve;
 *   4. the history row is "proof_sent" with the recipient; approved → 409;
 *      a member with no email falls back to the org owner's.
 *
 * In-process CRM routes on the lane Postgres (constructhub_dev[_x] on
 * localhost only) with a throwaway user/org deleted afterwards. The mailer and
 * SMS are stubbed exactly like doc-defaults.test.ts.
 */
import { beforeAll, afterAll, beforeEach, describe, it, expect, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";

process.env.SESSION_SECRET ||= "vitest-estimate-proof-secret";

const mail = vi.hoisted(() => vi.fn(async (_m: any) => ({ accepted: ["fixture@example.invalid"] })));
const sms = vi.hoisted(() => vi.fn(async () => ({ ok: true, provider: "log", sid: null })));
vi.mock("../email", () => ({ sendWithFallback: mail }));
vi.mock("./sms", async (original) => ({
  ...(await original<typeof import("./sms")>()),
  sendSms: sms,
  textOrgOwners: vi.fn(async () => {}),
}));

const lane = (() => {
  try {
    const u = new URL(process.env.DATABASE_URL ?? "");
    return /^\/constructhub_dev(?:_[a-z0-9]+)?$/.test(u.pathname) && ["localhost", "127.0.0.1"].includes(u.hostname);
  } catch { return false; }
})();

describe.skipIf(!lane)("send me a proof (lane Postgres)", () => {
  let pool: typeof import("../db").pool;
  let base = "", server: ReturnType<express.Express["listen"]>;
  let userId = 0, orgId = "", customerId = "";
  const memberEmail = `i-proof-${randomUUID()}@example.invalid`;
  const clientEmail = `proof-client-${randomUUID()}@example.invalid`;

  async function call(path: string, body?: unknown, method = body === undefined ? "GET" : "POST") {
    const r = await fetch(base + path, {
      method,
      headers: { "content-type": "application/json", "x-fixture-user": String(userId) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: r.status, data: await r.json().catch(() => null) };
  }
  const line = (cents: number) => ({ kind: "labor", name: "Work", quantityMilli: 1000, unitPriceCents: cents, taxable: false });
  const row = async (id: string) => (await pool.query(
    "SELECT status, sent_at, expires_at, sent_to_email, view_count, first_viewed_at, public_token FROM crm_estimates WHERE id=$1", [id])).rows[0];
  const passes = async () => Number((await pool.query(
    "SELECT count(*) FROM crm_client_tokens WHERE customer_ids @> $1::jsonb", [JSON.stringify([customerId])])).rows[0].count);

  beforeAll(async () => {
    ({ pool } = await import("../db"));
    const { ensureCrmSchema } = await import("./schema-ensure");
    await ensureCrmSchema();
    userId = (await pool.query("INSERT INTO users(email) VALUES($1) RETURNING id", [memberEmail])).rows[0].id;
    await pool.query("INSERT INTO crm_subscriptions(user_id,plan,status) VALUES($1,'crm_essentials','active')", [userId]);
    const { registerCrmRoutes } = await import("./routes");
    const app = express();
    app.set("trust proxy", true);
    app.use(express.json());
    app.use((req: any, _res, next) => { req.user = { id: Number(req.headers["x-fixture-user"]) }; req.session = {}; next(); });
    registerCrmRoutes(app, (req: any) => req.user);
    await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    expect((await call("/api/crm/me")).status).toBe(200);
    orgId = (await pool.query("SELECT id FROM crm_orgs WHERE owner_user_id=$1", [userId])).rows[0].id;
    const c = await call("/api/crm/customers", { addressLine1: "100 Test St", displayName: "Proof Client", email: clientEmail, phone: "+15555550100" });
    expect(c.status).toBe(201);
    customerId = c.data.id;
  });

  afterAll(async () => {
    await new Promise((resolve) => server?.close(resolve));
    if (orgId) {
      const { rows } = await pool.query(
        `SELECT table_name FROM information_schema.columns
         WHERE table_schema='public' AND column_name='org_id' AND table_name LIKE 'crm\\_%' AND table_name <> 'crm_orgs'`);
      for (const { table_name } of rows) await pool.query(`DELETE FROM ${table_name} WHERE org_id=$1`, [orgId]).catch(() => {});
      await pool.query("DELETE FROM crm_orgs WHERE id=$1", [orgId]);
    }
    await pool.query("DELETE FROM crm_client_tokens WHERE customer_ids @> $1::jsonb", [JSON.stringify([customerId])]).catch(() => {});
    await pool.query("DELETE FROM crm_subscriptions WHERE user_id=$1", [userId]);
    await pool.query("DELETE FROM users WHERE id=$1", [userId]);
    await pool.end();
  });

  beforeEach(() => { mail.mockClear(); sms.mockClear(); });

  it("mails the client's email, prefixed [PROOF], to the member only — and changes nothing", async () => {
    const e = await call("/api/crm/estimates", { customerId, title: "Proof draft", items: [line(4789490)] });
    expect(e.status).toBe(201);
    const before = await row(e.data.id);
    const passesBefore = await passes();

    const r = await call(`/api/crm/estimates/${e.data.id}/send-proof`, {});
    expect(r.status).toBe(200);
    expect(r.data).toEqual({ ok: true, to: memberEmail });

    expect(mail).toHaveBeenCalledTimes(1);
    const m = mail.mock.calls[0][0];
    expect(m.to).toBe(memberEmail);
    expect(m.cc ?? m.bcc ?? null).toBeNull();
    expect(m.subject).toMatch(/^\[PROOF\] Estimate from /);
    expect(m.html).toContain("Approve Estimate");
    expect(m.html).toContain("Hi Proof Client,");
    expect(m.html).toMatch(new RegExp(`/e/${before.public_token}\\?preview=\\d+\\.[0-9a-f]{32}`));
    expect(m.html).not.toContain("?k=");
    expect(sms).not.toHaveBeenCalled();

    const after = await row(e.data.id);
    expect(after.status).toBe("draft");
    expect(after.sent_at).toBeNull();
    expect(after.sent_to_email).toBe(before.sent_to_email);
    expect(after.expires_at).toEqual(before.expires_at);
    expect(await passes()).toBe(passesBefore);

    const ev = (await pool.query("SELECT type, meta FROM crm_estimate_events WHERE estimate_id=$1 AND type='proof_sent'", [e.data.id])).rows;
    expect(ev).toHaveLength(1);
    expect(ev[0].meta).toEqual({ to: memberEmail });

    // The proof's link: opens without a client session, is not a view, cannot approve.
    const grant = /\?preview=(\d+\.[0-9a-f]{32})/.exec(m.html)![1];
    const view = await call(`/api/public/estimates/${before.public_token}?preview=${grant}`);
    expect(view.status).toBe(200);
    const respond = await call(`/api/public/estimates/${before.public_token}/respond?preview=${grant}`, { decision: "approve", signatureName: "X" });
    expect(respond.status).toBeGreaterThanOrEqual(400);
    const viewed = await row(e.data.id);
    expect(viewed.view_count ?? 0).toBe(0);
    expect(viewed.first_viewed_at).toBeNull();
    expect(viewed.status).toBe("draft");
  });

  it("leaves a sent estimate's status and sent_at untouched", async () => {
    const e = await call("/api/crm/estimates", { customerId, title: "Proof sent", items: [line(10000)] });
    expect((await call(`/api/crm/estimates/${e.data.id}/send`, { sms: false })).status).toBe(200);
    const before = await row(e.data.id);
    expect(before.status).toBe("sent");
    mail.mockClear();

    const r = await call(`/api/crm/estimates/${e.data.id}/send-proof`, {});
    expect(r.status).toBe(200);
    expect(mail).toHaveBeenCalledTimes(1);
    expect(mail.mock.calls[0][0].to).toBe(memberEmail);
    expect(mail.mock.calls[0][0].subject.startsWith("[PROOF] ")).toBe(true);

    const after = await row(e.data.id);
    expect(after.status).toBe("sent");
    expect(after.sent_at).toEqual(before.sent_at);
    expect(after.expires_at).toEqual(before.expires_at);
  });

  it("refuses an approved estimate and an unknown one", async () => {
    const e = await call("/api/crm/estimates", { customerId, title: "Proof approved", items: [line(10000)] });
    await pool.query("UPDATE crm_estimates SET status='approved', approved_at=now() WHERE id=$1", [e.data.id]);
    expect((await call(`/api/crm/estimates/${e.data.id}/send-proof`, {})).status).toBe(409);
    expect((await call(`/api/crm/estimates/${randomUUID()}/send-proof`, {})).status).toBe(404);
    expect(mail).not.toHaveBeenCalled();
  });

  it("a member with no email gets it at the org owner's address", async () => {
    const e = await call("/api/crm/estimates", { customerId, title: "Proof fallback", items: [line(10000)] });
    await pool.query("UPDATE crm_members SET email='' WHERE org_id=$1 AND user_id=$2", [orgId, userId]);
    try {
      const r = await call(`/api/crm/estimates/${e.data.id}/send-proof`, {});
      expect(r.status).toBe(200);
      expect(r.data.to).toBe(memberEmail); // the owner account's own (users.email)
      expect(mail.mock.calls[0][0].to).toBe(memberEmail);
    } finally {
      await pool.query("UPDATE crm_members SET email=$3 WHERE org_id=$1 AND user_id=$2", [orgId, userId, memberEmail]);
    }
  });
});
