/**
 * The bell + home-page numbers, against the running dev server:
 *  1. /api/crm/notifications lists my rows with an unread count; read-all
 *     zeroes it; rows from another member/org never leak in.
 *  2. /api/crm/stats returns the four headline cards with sane shapes.
 *  3. /api/crm/team-activity merges the estimate-event trail into
 *     actor + text items.
 *  4. /api/crm/customers carries bidStatus (won/undecided/declined/none).
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

let orgId: string;
let memberId: string;
const mine: string[] = [];

beforeAll(async () => {
  const me = await api("/api/crm/me");
  expect(me.status).toBe(200);
  orgId = me.body.org.id;
  memberId = me.body.member.id;
});

afterAll(async () => {
  if (mine.length) await q(`DELETE FROM crm_notifications WHERE id = ANY($1)`, [mine]);
  await q(`DELETE FROM crm_notifications WHERE title LIKE 'vitest-bell %'`);
  await pool.end();
});

describe("in-app notifications", () => {
  it("lists my rows with an unread count and marks them read", async () => {
    const [row] = await q(
      `INSERT INTO crm_notifications (org_id, member_id, type, title, link)
       VALUES ($1, $2, 'estimateViewed', 'vitest-bell ' || gen_random_uuid(), '/crm/clients')
       RETURNING id`, [orgId, memberId]);
    mine.push(row.id);

    const list = await api("/api/crm/notifications");
    expect(list.status).toBe(200);
    expect(list.body.unread).toBeGreaterThanOrEqual(1);
    const found = list.body.notifications.find((n: any) => n.id === row.id);
    expect(found).toBeTruthy();
    expect(found.readAt).toBeNull();

    const one = await api(`/api/crm/notifications/${row.id}/read`, { method: "POST", body: "{}" });
    expect(one.status).toBe(200);
    const after = await api("/api/crm/notifications");
    expect(after.body.notifications.find((n: any) => n.id === row.id).readAt).toBeTruthy();

    const [row2] = await q(
      `INSERT INTO crm_notifications (org_id, member_id, type, title)
       VALUES ($1, $2, 'invoicePaid', 'vitest-bell ' || gen_random_uuid()) RETURNING id`,
      [orgId, memberId]);
    mine.push(row2.id);
    const all = await api("/api/crm/notifications/read-all", { method: "POST", body: "{}" });
    expect(all.status).toBe(200);
    const zero = await api("/api/crm/notifications");
    expect(zero.body.unread).toBe(0);
  });

  it("never returns another member's rows", async () => {
    const [row] = await q(
      `INSERT INTO crm_notifications (org_id, member_id, type, title)
       VALUES ($1, 'not-my-member-id', 'estimateViewed', 'vitest-bell ' || gen_random_uuid())
       RETURNING id`, [orgId]);
    mine.push(row.id);
    const list = await api("/api/crm/notifications?limit=100");
    expect(list.body.notifications.some((n: any) => n.id === row.id)).toBe(false);
  });
});

describe("home-page stats", () => {
  it("returns the four headline cards with count + totalCents", async () => {
    const r = await api("/api/crm/stats");
    expect(r.status).toBe(200);
    for (const k of ["openEstimates", "jobsWon", "unscheduledJobs", "openInvoices"]) {
      expect(typeof r.body[k].count).toBe("number");
      expect(typeof r.body[k].totalCents).toBe("number");
      expect(r.body[k].count).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("team activity feed", () => {
  it("returns actor + text items sorted newest-first", async () => {
    const r = await api("/api/crm/team-activity?limit=10");
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body.activity)).toBe(true);
    for (const item of r.body.activity) {
      expect(typeof item.actor).toBe("string");
      expect(typeof item.text).toBe("string");
      expect(typeof item.at).toBe("string");
    }
    const ats = r.body.activity.map((a: any) => a.at);
    expect([...ats].sort().reverse()).toEqual(ats);
  });
});

describe("clients bid status", () => {
  it("carries bidStatus on every customer row", async () => {
    const r = await api("/api/crm/customers");
    expect(r.status).toBe(200);
    expect(r.body.length).toBeGreaterThan(0);
    for (const c of r.body.slice(0, 20)) {
      expect(["won", "undecided", "declined", "none"]).toContain(c.bidStatus);
    }
  });
});
