/**
 * The bell + home-page numbers, against the running dev server:
 *  1. /api/crm/notifications lists my rows with an unread count; read-all
 *     zeroes it; rows from another member/org never leak in.
 *     The scratch-org block below pins the harder isolation cases: another
 *     member of the SAME org cannot list or mark my rows (asserted via DB),
 *     a second org's rows are invisible and un-markable, two concurrent
 *     read-all calls both succeed idempotently, ?limit clamps at 100 and a
 *     bogus limit falls back to the default, :id/read rejects an over-long
 *     id and no-ops on an unknown one, and a sales member can read their
 *     own notifications.
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

// Isolation probes need TWO members in one org and a SECOND org, so they run
// against two throwaway orgs (user 1 owns both, sessions pinned per cookie —
// the same pattern as stats.test.ts). The default org is never touched and
// everything is deleted in afterAll (which runs before the file-level
// pool.end).
describe("notifications isolation + input validation (scratch orgs)", () => {
  let orgA = "", orgB = "";
  let memberA = "", memberB = "", memberNoSession = "";
  let cookieA: string | undefined, cookieB: string | undefined;

  beforeAll(async () => {
    const me = await api("/api/crm/me");
    expect(me.status).toBe(200);
    const stamp = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

    const mkOrg = async (name: string) => {
      const [{ id }] = await q<{ id: string }>(
        `insert into crm_orgs (name, owner_user_id) values ($1, 1) returning id`, [name]);
      return id;
    };
    orgA = await mkOrg(`Vitest BellIso A ${stamp}`);
    orgB = await mkOrg(`Vitest BellIso B ${stamp}`);
    const mkMember = async (orgId: string, tag: string) => {
      const [{ id }] = await q<{ id: string }>(
        `insert into crm_members (org_id, user_id, email, role, status, display_name)
         values ($1, 1, $2, 'owner', 'active', $3) returning id`,
        [orgId, `vitest.belliso.${tag}.${stamp}@example.com`, `BellIso ${tag}`]);
      return id;
    };
    memberA = await mkMember(orgA, "a");
    memberB = await mkMember(orgB, "b");
    // A second active member of org A who has no session in this run — the
    // "other member" for the same-org isolation probes (user_id is null the
    // same way it is while an invitation is pending).
    const [{ id: nsId }] = await q<{ id: string }>(
      `insert into crm_members (org_id, user_id, email, role, status, display_name)
       values ($1, null, $2, 'sales', 'active', 'BellIso NoSession') returning id`,
      [orgA, `vitest.belliso.ns.${stamp}@example.com`]);
    memberNoSession = nsId;

    const swA = await api("/api/crm/org/switch", {
      method: "POST", body: JSON.stringify({ orgId: orgA }),
    }, me.cookie);
    expect(swA.status).toBe(200);
    cookieA = swA.cookie;
    const swB = await api("/api/crm/org/switch", {
      method: "POST", body: JSON.stringify({ orgId: orgB }),
    }, me.cookie);
    expect(swB.status).toBe(200);
    cookieB = swB.cookie;
  });

  afterAll(async () => {
    await q(`delete from crm_notifications where org_id = any($1)`, [[orgA, orgB]]);
    await q(`delete from crm_members where org_id = any($1)`, [[orgA, orgB]]);
    await q(`delete from crm_orgs where id = any($1)`, [[orgA, orgB]]);
  });

  const insertRow = async (orgId: string, memberId: string, read = false) => {
    const [row] = await q<{ id: string }>(
      `insert into crm_notifications (org_id, member_id, type, title, read_at)
       values ($1, $2, 'estimateViewed', 'vitest-belliso ' || gen_random_uuid(), $3)
       returning id`,
      [orgId, memberId, read ? new Date().toISOString() : null]);
    return row.id;
  };

  it("a same-org member's rows are invisible and un-markable by another member", async () => {
    const id = await insertRow(orgA, memberNoSession);

    const list = await api("/api/crm/notifications?limit=100", {}, cookieA);
    expect(list.status).toBe(200);
    expect(list.body.notifications.some((n: any) => n.id === id)).toBe(false);

    // B's session answers 200 (idempotent shape) but must not flip A's row.
    const read = await api(`/api/crm/notifications/${id}/read`, { method: "POST", body: "{}" }, cookieA);
    expect(read.status).toBe(200);
    const [{ read_at: readAt }] = await q<{ read_at: Date | null }>(
      `select read_at from crm_notifications where id = $1`, [id]);
    expect(readAt).toBeNull();
  });

  it("a second org's rows are invisible and un-markable from the first org", async () => {
    const id = await insertRow(orgB, memberB);

    const list = await api("/api/crm/notifications?limit=100", {}, cookieA);
    expect(list.body.notifications.some((n: any) => n.id === id)).toBe(false);
    const read = await api(`/api/crm/notifications/${id}/read`, { method: "POST", body: "{}" }, cookieA);
    expect(read.status).toBe(200);
    const [{ read_at: stillNull }] = await q<{ read_at: Date | null }>(
      `select read_at from crm_notifications where id = $1`, [id]);
    expect(stillNull).toBeNull();

    // …while the owning org sees and marks it normally.
    const listB = await api("/api/crm/notifications?limit=100", {}, cookieB);
    expect(listB.body.notifications.some((n: any) => n.id === id)).toBe(true);
    const readB = await api(`/api/crm/notifications/${id}/read`, { method: "POST", body: "{}" }, cookieB);
    expect(readB.status).toBe(200);
    const [{ read_at: flipped }] = await q<{ read_at: Date | null }>(
      `select read_at from crm_notifications where id = $1`, [id]);
    expect(flipped).not.toBeNull();
  });

  it("two concurrent read-all calls both succeed and leave everything read", async () => {
    const ids = [
      await insertRow(orgA, memberA),
      await insertRow(orgA, memberA),
      await insertRow(orgA, memberA),
    ];
    const [r1, r2] = await Promise.all([
      api("/api/crm/notifications/read-all", { method: "POST", body: "{}" }, cookieA),
      api("/api/crm/notifications/read-all", { method: "POST", body: "{}" }, cookieA),
    ]);
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    const rows = await q<{ read_at: Date | null }>(
      `select read_at from crm_notifications where id = any($1)`, [ids]);
    expect(rows.length).toBe(3);
    for (const r of rows) expect(r.read_at).not.toBeNull();
    const list = await api("/api/crm/notifications", {}, cookieA);
    expect(list.body.unread).toBe(0);
    // A third pass is a clean no-op, not an error.
    const again = await api("/api/crm/notifications/read-all", { method: "POST", body: "{}" }, cookieA);
    expect(again.status).toBe(200);
  });

  it("?limit clamps at 100 and a bogus limit falls back to the default", async () => {
    // 105 extra rows (already read, so they don't disturb the unread probes):
    // an unclamped limit would return them all.
    await q(
      `insert into crm_notifications (org_id, member_id, type, title, read_at)
       select $1, $2, 'estimateViewed', 'vitest-belliso clamp ' || g, now()
       from generate_series(1, 105) g`,
      [orgA, memberA]);
    const big = await api("/api/crm/notifications?limit=999999", {}, cookieA);
    expect(big.status).toBe(200);
    expect(big.body.notifications.length).toBe(100);
    const dflt = await api("/api/crm/notifications?limit=abc", {}, cookieA);
    expect(dflt.status).toBe(200);
    expect(dflt.body.notifications.length).toBe(30);
  });

  it(":id/read rejects an over-long id and no-ops on an unknown one", async () => {
    const long = await api(`/api/crm/notifications/${"x".repeat(65)}/read`, {
      method: "POST", body: "{}",
    }, cookieA);
    expect(long.status).toBe(400);
    // Past the zod min/max the id matches nothing — a silent no-op 200, and
    // (asserted above via DB) never another member's row.
    const unknown = await api("/api/crm/notifications/zzz/read", {
      method: "POST", body: "{}",
    }, cookieA);
    expect(unknown.status).toBe(200);
  });

  it("a sales member can list and mark their own notifications", async () => {
    await q(`update crm_members set role = 'sales' where id = $1`, [memberA]);
    try {
      const id = await insertRow(orgA, memberA);
      const list = await api("/api/crm/notifications?limit=100", {}, cookieA);
      expect(list.status).toBe(200);
      expect(list.body.notifications.some((n: any) => n.id === id)).toBe(true);
      const read = await api(`/api/crm/notifications/${id}/read`, { method: "POST", body: "{}" }, cookieA);
      expect(read.status).toBe(200);
      const [{ read_at: readAt }] = await q<{ read_at: Date | null }>(
        `select read_at from crm_notifications where id = $1`, [id]);
      expect(readAt).not.toBeNull();
    } finally {
      await q(`update crm_members set role = 'owner' where id = $1`, [memberA]);
    }
  });
});
