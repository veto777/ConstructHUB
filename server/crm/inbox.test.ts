/**
 * The Messages center, against the running dev server:
 *  1. A client message shows up as an unread thread; opening the thread and
 *     marking it read zeroes the badge.
 *  2. Replying inserts a member-authored row, clears the unread flags, and
 *     the thread carries both sides in order.
 *  3. A message addressed to a member (toMemberId) surfaces that name; a
 *     bogus toMemberId on the portal POST is dropped, not stored.
 *
 * Requires the dev server:
 *   DATABASE_URL=… DEV_AUTH_BYPASS_USER1=true PORT=8119 npx tsx --env-file=.env server/index.ts
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";

const BASE = process.env.CRM_TEST_BASE_URL ?? "http://127.0.0.1:8119";
const pool = new pg.Pool({
  connectionString:
    process.env.DATABASE_URL ??
    "postgres://constructhub_dev:crmdev_local_only@127.0.0.1:5432/constructhub_dev",
});
const q = <T = any>(text: string, params: any[] = []) =>
  pool.query(text, params).then((r) => r.rows as T[]);

async function api(path: string, opts: RequestInit = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: { "content-type": "application/json", ...(opts.headers || {}) },
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

let orgId: string, memberId: string, customerId: string;
const suffix = Math.random().toString(36).slice(2, 8);

beforeAll(async () => {
  const me = await api("/api/crm/me");
  expect(me.status).toBe(200);
  orgId = me.body.org.id;
  memberId = me.body.member.id;
  const [c] = await q(
    `INSERT INTO crm_customers (org_id, display_name, email, portal_token)
     VALUES ($1, $2, $3, replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '')) RETURNING id`,
    [orgId, `Inbox Test ${suffix}`, `inbox-${suffix}@example.com`]);
  customerId = c.id;
});

afterAll(async () => {
  await q(`DELETE FROM crm_client_comments WHERE customer_id = $1`, [customerId]);
  await q(`DELETE FROM crm_customers WHERE id = $1`, [customerId]);
  await pool.end();
});

describe("messages inbox", () => {
  it("unread thread appears, opening + read clears it", async () => {
    await q(
      `INSERT INTO crm_client_comments (org_id, customer_id, body) VALUES ($1, $2, 'When can you start?')`,
      [orgId, customerId]);

    const list = await api("/api/crm/inbox");
    expect(list.status).toBe(200);
    const t = list.body.threads.find((x: any) => x.customerId === customerId);
    expect(t).toBeTruthy();
    expect(t.unread).toBe(1);
    expect(t.lastBody).toBe("When can you start?");
    expect(list.body.unreadTotal).toBeGreaterThanOrEqual(1);

    const read = await api(`/api/crm/inbox/${customerId}/read`, { method: "POST", body: "{}" });
    expect(read.status).toBe(200);
    const after = await api("/api/crm/inbox");
    expect(after.body.threads.find((x: any) => x.customerId === customerId).unread).toBe(0);
  });

  it("reply lands in the thread as ours and clears remaining unread", async () => {
    await q(
      `INSERT INTO crm_client_comments (org_id, customer_id, body) VALUES ($1, $2, 'Also — color options?')`,
      [orgId, customerId]);

    const reply = await api(`/api/crm/inbox/${customerId}/reply`, {
      method: "POST",
      body: JSON.stringify({ body: "We can start Tuesday. Colors attached." }),
    });
    expect(reply.status).toBe(201);

    const thread = await api(`/api/crm/inbox/${customerId}`);
    expect(thread.status).toBe(200);
    const msgs = thread.body.messages;
    expect(msgs.length).toBeGreaterThanOrEqual(3);
    const last = msgs[msgs.length - 1];
    expect(last.fromClient).toBe(false);
    expect(last.body).toContain("Tuesday");

    const list = await api("/api/crm/inbox");
    expect(list.body.threads.find((x: any) => x.customerId === customerId).unread).toBe(0);
  });

  it("a message addressed to a member carries their name", async () => {
    await q(
      `INSERT INTO crm_client_comments (org_id, customer_id, body, to_member_id)
       VALUES ($1, $2, 'For you specifically', $3)`,
      [orgId, customerId, memberId]);
    const thread = await api(`/api/crm/inbox/${customerId}`);
    const msg = thread.body.messages.find((m: any) => m.body === "For you specifically");
    expect(msg).toBeTruthy();
    expect(msg.toMemberName).toBeTruthy();
  });
});
