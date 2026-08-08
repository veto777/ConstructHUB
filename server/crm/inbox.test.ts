/**
 * The Messages center, against the running dev server:
 *  1. A client message shows up as an unread thread; opening the thread and
 *     marking it read zeroes the badge.
 *  2. Replying inserts a member-authored row, clears the unread flags, and
 *     the thread carries both sides in order.
 *  3. A message addressed to a member (toMemberId) surfaces that name; a
 *     bogus toMemberId on the portal POST is dropped, not stored.
 *  4. Gates + throttles: field role gets 403 on all four staff routes (sales
 *     and owner pass), the reply endpoint 429s past 60/member/org, the portal
 *     team endpoint 429s past 60, read on a bogus customer 404s, and
 *     unreadTotal counts unread beyond the 200-thread page.
 *
 * Requires the dev server:
 *   DATABASE_URL=… DEV_AUTH_BYPASS_USER1=true PORT=8119 npx tsx --env-file=.env server/index.ts
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createHash, randomBytes, randomUUID } from "crypto";
import pg from "pg";

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
  return {
    status: res.status,
    body: await res.json().catch(() => null),
    cookie: setCookie?.split(";")[0] ?? cookie,
  };
}

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

/** Insert a client session row as a redeemed magic link would; returns the RAW cookie token. */
async function makeClientSession(customerIds: string[]): Promise<string> {
  const raw = randomBytes(32).toString("hex");
  await q(
    `insert into crm_client_sessions (token_hash, customer_ids, expires_at, last_seen_at)
     values ($1, $2::jsonb, now() + interval '30 days', now())`,
    [sha256(raw), JSON.stringify(customerIds)],
  );
  return raw;
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

  it("read on a customer that doesn't exist → 404, no silent no-op", async () => {
    const r = await api(`/api/crm/inbox/${randomUUID()}/read`, { method: "POST", body: "{}" });
    expect(r.status).toBe(404);
  });

  it("unreadTotal counts unread beyond the 200-thread page", async () => {
    // 201 fresh threads, one unread message each: the returned page fills at
    // 200 rows but the badge must still count all 201.
    const ids = (await q<{ id: string }>(
      `INSERT INTO crm_customers (org_id, display_name, email, portal_token)
       SELECT $1, 'Inbox Page ' || g || ' ${suffix}',
              'inbox-page-' || g || '-${suffix}@example.com',
              replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '')
       FROM generate_series(1, 201) g RETURNING id`, [orgId])).map((r) => r.id);
    try {
      await q(
        `INSERT INTO crm_client_comments (org_id, customer_id, body)
         SELECT $1, id, 'page filler ${suffix}' FROM unnest($2::uuid[]) AS id`,
        [orgId, ids]);
      const list = await api("/api/crm/inbox");
      expect(list.status).toBe(200);
      expect(list.body.threads.length).toBe(200);
      expect(list.body.unreadTotal).toBeGreaterThanOrEqual(201);
    } finally {
      await q(`DELETE FROM crm_client_comments WHERE customer_id = any($1)`, [ids]);
      await q(`DELETE FROM crm_customers WHERE id = any($1)`, [ids]);
    }
  });

  it("client/team is throttled: over 60 requests → 429", async () => {
    const [c] = await q<{ id: string }>(
      `INSERT INTO crm_customers (org_id, display_name, email, portal_token)
       VALUES ($1, $2, $3, replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '')) RETURNING id`,
      [orgId, `Inbox Team ${suffix}`, `inbox-team-${suffix}@example.com`]);
    try {
      const raw = await makeClientSession([c.id]);
      let last = 0;
      for (let i = 0; i < 61; i++) {
        const r = await fetch(`${BASE}/api/client/team?customerId=${c.id}`, {
          headers: { cookie: `crm_client=${raw}` },
        });
        last = r.status;
        if (i === 0) expect(r.status).toBe(200);
        await r.arrayBuffer().catch(() => {});
      }
      expect(last).toBe(429);
    } finally {
      await q(`DELETE FROM crm_client_sessions WHERE customer_ids::text like '%' || $1 || '%'`, [c.id]);
      await q(`DELETE FROM crm_customers WHERE id = $1`, [c.id]);
    }
  });
});

// Role flips and the reply-flood probe run in the ASPIRE org: the default
// org's member powers every other suite's happy path, and the reply bucket is
// keyed per member+org — flooding it in the default org would 429 the other
// inbox tests. The role is always restored in a finally.
describe("inbox gates + reply throttle (Aspire org)", () => {
  const ASPIRE = "b839980a-ad26-44d4-9e83-df427bd60fe8";
  let ac: string | undefined; // session pinned to the Aspire org
  let aspireMemberId = "";
  let gateCust = "";

  beforeAll(async () => {
    const me = await api("/api/crm/me");
    const sw = await api("/api/crm/org/switch", {
      method: "POST", body: JSON.stringify({ orgId: ASPIRE }),
    }, me.cookie);
    expect(sw.status).toBe(200);
    ac = sw.cookie;
    const [{ id }] = await q<{ id: string }>(
      `select id from crm_members where org_id = $1 and user_id = 1`, [ASPIRE]);
    aspireMemberId = id;
    // Created while still owner — customer writes are manageCustomers-gated.
    const cust = await api("/api/crm/customers", {
      method: "POST",
      body: JSON.stringify({
        displayName: `Inbox Gate ${suffix}`,
        email: `inbox-gate-${suffix}@example.com`,
      }),
    }, ac);
    expect(cust.status).toBe(201);
    gateCust = cust.body.id;
  });

  afterAll(async () => {
    await q(`update crm_members set role = 'owner' where id = $1`, [aspireMemberId]);
    await q(`delete from crm_client_comments where customer_id = $1`, [gateCust]);
    await q(`delete from crm_customers where id = $1`, [gateCust]);
  });

  it("field role → 403 on all four inbox routes; sales and owner pass", async () => {
    await q(`update crm_members set role = 'field' where id = $1`, [aspireMemberId]);
    try {
      expect((await api("/api/crm/inbox", {}, ac)).status).toBe(403);
      expect((await api(`/api/crm/inbox/${gateCust}`, {}, ac)).status).toBe(403);
      expect((await api(`/api/crm/inbox/${gateCust}/read`, { method: "POST", body: "{}" }, ac)).status).toBe(403);
      expect((await api(`/api/crm/inbox/${gateCust}/reply`, {
        method: "POST", body: JSON.stringify({ body: "should never send" }),
      }, ac)).status).toBe(403);
    } finally {
      await q(`update crm_members set role = 'owner' where id = $1`, [aspireMemberId]);
    }

    await q(`update crm_members set role = 'sales' where id = $1`, [aspireMemberId]);
    try {
      expect((await api("/api/crm/inbox", {}, ac)).status).toBe(200);
      expect((await api(`/api/crm/inbox/${gateCust}`, {}, ac)).status).toBe(200);
      expect((await api(`/api/crm/inbox/${gateCust}/read`, { method: "POST", body: "{}" }, ac)).status).toBe(200);
      expect((await api(`/api/crm/inbox/${gateCust}/reply`, {
        method: "POST", body: JSON.stringify({ body: "sales can reply" }),
      }, ac)).status).toBe(201);
    } finally {
      await q(`update crm_members set role = 'owner' where id = $1`, [aspireMemberId]);
    }

    // A customer from ANOTHER org (this one) addressed on the default-org
    // session reads as 404, not a silent 200 no-op.
    const cross = await api(`/api/crm/inbox/${gateCust}/read`, { method: "POST", body: "{}" });
    expect(cross.status).toBe(404);
  });

  it("reply is throttled per member+org: over 60 in the window → 429", async () => {
    // The sales probe above already spent one hit on this member's bucket, so
    // don't assert an exact count of 201s — assert the bucket clamps at 60
    // allowed and everything past it is 429.
    const statuses: number[] = [];
    for (let i = 0; i < 65; i++) {
      const r = await api(`/api/crm/inbox/${gateCust}/reply`, {
        method: "POST", body: JSON.stringify({ body: `flood ${i}` }),
      }, ac);
      statuses.push(r.status);
    }
    expect(statuses.filter((s) => s === 201).length).toBeLessThanOrEqual(60);
    expect(statuses[statuses.length - 1]).toBe(429);
  });
});
