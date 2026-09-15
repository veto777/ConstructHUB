/**
 * /api/crm/appointments — the calendar CRUD (schedule.ts).
 *
 * Requires the local dev server (DEV_AUTH_BYPASS_USER1=true):
 *   DATABASE_URL=… DEV_AUTH_BYPASS_USER1=true PORT=8129 npx tsx --env-file=.env server/index.ts
 * Override the target with CRM_TEST_BASE_URL; the DB with CRM_TEST_DATABASE_URL.
 *
 * Fixtures live in TWO THROWAWAY orgs created here (user 1 made owner/member
 * of both) and are fully deleted in afterAll — the shared dev orgs are never
 * touched, so this file is safe against the other suites running in parallel.
 * Role flips hit only the scratch org's membership and are restored in a
 * finally anyway.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";

const BASE = process.env.CRM_TEST_BASE_URL ?? "http://127.0.0.1:8119";

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
    headers: { ...(cookie ? { cookie } : {}), ...(opts.headers || {}) },
  });
  const setCookie = res.headers.get("set-cookie");
  const ct = res.headers.get("content-type") ?? "";
  const body = ct.includes("json") ? await res.json().catch(() => null) : await res.text();
  return { status: res.status, body, cookie: setCookie?.split(";")[0] ?? cookie };
}

const post = (path: string, data: unknown, cookie?: string) =>
  api(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(data),
  }, cookie);
const patch = (path: string, data: unknown, cookie?: string) =>
  api(path, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(data),
  }, cookie);
const del = (path: string, cookie?: string) => api(path, { method: "DELETE" }, cookie);

describe("crm appointments CRUD (dev server)", () => {
  let cookieA: string | undefined;
  let cookieB: string | undefined;
  let orgA = "";
  let orgB = "";
  let memberA = "";
  let custA = "";
  let projA = "";
  let apptId = "";

  const T = Date.UTC(2030, 5, 15, 16, 0, 0); // fixed future window, well inside any range query
  const iso = (ms: number) => new Date(ms).toISOString();

  beforeAll(async () => {
    const me = await api("/api/crm/me");
    if (me.status !== 200) {
      throw new Error(`CRM dev server not reachable at ${BASE} (GET /api/crm/me → ${me.status}). Start it first.`);
    }
    const stamp = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

    const mkOrg = async (name: string) => {
      const [{ id }] = await q<{ id: string }>(
        `insert into crm_orgs (name, owner_user_id) values ($1, 1) returning id`,
        [name]);
      return id;
    };
    orgA = await mkOrg(`Vitest Appt A ${stamp}`);
    orgB = await mkOrg(`Vitest Appt B ${stamp}`);
    // User 1 is an active member of BOTH orgs so the session can pin either.
    for (const [orgId, tag] of [[orgA, "a"], [orgB, "b"]] as const) {
      const [{ id }] = await q<{ id: string }>(
        `insert into crm_members (org_id, user_id, email, role, status, display_name)
         values ($1, 1, $2, 'owner', 'active', 'Appt Owner') returning id`,
        [orgId, `vitest.appt.${tag}.${stamp}@example.com`]);
      if (orgId === orgA) memberA = id;
    }

    const swA = await post("/api/crm/org/switch", { orgId: orgA }, me.cookie);
    expect(swA.status).toBe(200);
    cookieA = swA.cookie;
    const swB = await post("/api/crm/org/switch", { orgId: orgB }, me.cookie);
    expect(swB.status).toBe(200);
    cookieB = swB.cookie;

    const [{ id: custId }] = await q<{ id: string }>(
      `insert into crm_customers (org_id, display_name, portal_token) values ($1, $2, $3) returning id`,
      [orgA, `Vitest Appt Cust ${stamp}`, `ptok-${stamp}-appt`]);
    custA = custId;
    const [{ id: projId }] = await q<{ id: string }>(
      `insert into crm_projects (org_id, customer_id, name, status) values ($1, $2, $3, 'lead') returning id`,
      [orgA, custA, `Vitest Appt Proj ${stamp}`]);
    projA = projId;
  });

  afterAll(async () => {
    for (const orgId of [orgA, orgB]) {
      if (!orgId) continue;
      await q(`delete from crm_appointments where org_id = $1`, [orgId]);
      await q(`delete from crm_projects where org_id = $1`, [orgId]);
      await q(`delete from crm_customers where org_id = $1`, [orgId]);
      await q(`delete from crm_team_activity where org_id = $1`, [orgId]);
      await q(`delete from crm_members where org_id = $1`, [orgId]);
      await q(`delete from crm_orgs where id = $1`, [orgId]);
    }
    await pool.end();
  });

  it("creates an appointment linked to project + customer + crew (201)", async () => {
    const r = await post("/api/crm/appointments", {
      title: "Vitest roof visit",
      startsAt: iso(T),
      endsAt: iso(T + 2 * 3600_000),
      projectId: projA,
      customerId: custA,
      dispatchedMemberIds: [memberA],
      notes: "bring the ladder",
    }, cookieA);
    expect(r.status).toBe(201);
    expect(r.body.appointment.id).toBeTruthy();
    expect(r.body.conflicts).toEqual([]);
    apptId = r.body.appointment.id;
  });

  it("lists it in range with resolved names and crew", async () => {
    const r = await api(
      `/api/crm/appointments?from=${encodeURIComponent(iso(T - 86400000))}&to=${encodeURIComponent(iso(T + 86400000))}`,
      {}, cookieA);
    expect(r.status).toBe(200);
    const row = r.body.appointments.find((a: any) => a.id === apptId);
    expect(row).toBeTruthy();
    expect(row.title).toBe("Vitest roof visit");
    expect(row.customerName).toContain("Vitest Appt Cust");
    expect(row.projectName).toContain("Vitest Appt Proj");
    expect(row.crew).toEqual(["Appt Owner"]);
    expect(row.dispatchedMemberIds).toEqual([memberA]);
    // The booker is stamped on create — "My calendar" filters on it.
    expect(row.createdByMemberId).toBe(memberA);
  });

  it("a restricted member still sees a visit they booked but are not dispatched to", async () => {
    // Booked by memberA (owner at this point) with NO crew.
    const c = await post("/api/crm/appointments", {
      title: "Vitest solo booking", startsAt: iso(T + 3 * 86400000), endsAt: iso(T + 3 * 86400000 + 3600_000),
    }, cookieA);
    expect(c.status).toBe(201);
    const soloId = c.body.appointment.id;
    const list = () => api(
      `/api/crm/appointments?from=${encodeURIComponent(iso(T + 2 * 86400000))}&to=${encodeURIComponent(iso(T + 4 * 86400000))}`,
      {}, cookieA);
    // Field role = no viewAllJobs: dispatched-or-booked visits only.
    await q(`update crm_members set role = 'field' where id = $1`, [memberA]);
    try {
      const seen = await list();
      expect(seen.status).toBe(200);
      expect(seen.body.appointments.some((a: any) => a.id === soloId)).toBe(true);
      // Strip the booker (as on pre-2026-09-15 rows) — now it's invisible to them.
      await q(`update crm_appointments set created_by_member_id = null where id = $1`, [soloId]);
      const hidden = await list();
      expect(hidden.body.appointments.some((a: any) => a.id === soloId)).toBe(false);
    } finally {
      await q(`update crm_members set role = 'owner' where id = $1`, [memberA]);
      await q(`delete from crm_appointments where id = $1`, [soloId]);
    }
  });

  it("logs the scheduling to team activity", async () => {
    const rows = await q<{ title: string }>(
      `select title from crm_team_activity where org_id = $1 and type = 'appointmentScheduled'`,
      [orgA]);
    expect(rows.some((r) => r.title.includes("Vitest roof visit"))).toBe(true);
  });

  it("rejects endsAt before startsAt (400)", async () => {
    const r = await post("/api/crm/appointments", {
      title: "backwards visit", startsAt: iso(T), endsAt: iso(T - 3600_000),
    }, cookieA);
    expect(r.status).toBe(400);
  });

  it("rejects a cross-org project link (400)", async () => {
    const r = await post("/api/crm/appointments", {
      title: "cross-org link", startsAt: iso(T), projectId: projA,
    }, cookieB);
    expect(r.status).toBe(400);
    expect(String(r.body.message)).toContain("Project not found");
  });

  it("rejects a cross-org crew member (400)", async () => {
    // memberA belongs to org A; org B may not dispatch them.
    const r = await post("/api/crm/appointments", {
      title: "cross-org crew", startsAt: iso(T), dispatchedMemberIds: [memberA],
    }, cookieB);
    expect(r.status).toBe(400);
  });

  it("flags a double-booking conflict instead of blocking", async () => {
    const r = await post("/api/crm/appointments", {
      title: "overlapping visit",
      startsAt: iso(T + 1800_000), endsAt: iso(T + 5400_000),
      dispatchedMemberIds: [memberA],
    }, cookieA);
    expect(r.status).toBe(201);
    expect(r.body.conflicts.length).toBe(1);
    expect(r.body.conflicts[0].appointmentId).toBe(apptId);
    // Clean up the overlapping fixture immediately.
    await del(`/api/crm/appointments/${r.body.appointment.id}`, cookieA);
  });

  it("reschedules via PATCH and logs it", async () => {
    const r = await patch(`/api/crm/appointments/${apptId}`, {
      startsAt: iso(T + 86400000), endsAt: iso(T + 86400000 + 3600_000),
    }, cookieA);
    expect(r.status).toBe(200);
    expect(new Date(r.body.startsAt).getTime()).toBe(T + 86400000);
    const rows = await q<{ title: string }>(
      `select title from crm_team_activity where org_id = $1 and type = 'appointmentRescheduled'`,
      [orgA]);
    expect(rows.some((x) => x.title.includes("Vitest roof visit"))).toBe(true);
  });

  it("rejects a patch that inverts the merged window (400)", async () => {
    // Appointment now starts at T+1d; ending it an hour BEFORE that is a 400.
    const r = await patch(`/api/crm/appointments/${apptId}`, {
      endsAt: iso(T + 86400000 - 3600_000),
    }, cookieA);
    expect(r.status).toBe(400);
  });

  it("org B cannot read, patch or delete org A's appointment", async () => {
    const list = await api(
      `/api/crm/appointments?from=${encodeURIComponent(iso(T - 86400000))}&to=${encodeURIComponent(iso(T + 2 * 86400000))}`,
      {}, cookieB);
    expect(list.status).toBe(200);
    expect(list.body.appointments.some((a: any) => a.id === apptId)).toBe(false);

    const p = await patch(`/api/crm/appointments/${apptId}`, { title: "hijacked" }, cookieB);
    expect(p.status).toBe(404);
    const d = await del(`/api/crm/appointments/${apptId}`, cookieB);
    expect(d.status).toBe(404);
  });

  it("a field (view-only) member cannot create or delete, but can progress a dispatched visit", async () => {
    await q(`update crm_members set role = 'field' where id = $1`, [memberA]);
    try {
      const c = await post("/api/crm/appointments", { title: "nope", startsAt: iso(T) }, cookieA);
      expect(c.status).toBe(403);
      const d = await del(`/api/crm/appointments/${apptId}`, cookieA);
      expect(d.status).toBe(403);
      // The member IS dispatched to apptId — status progression is allowed.
      const p = await patch(`/api/crm/appointments/${apptId}`, { status: "on_my_way" }, cookieA);
      expect(p.status).toBe(200);
      expect(p.body.onMyWayAt).toBeTruthy();
      // …but re-crewing is silently stripped for non-managers.
      const p2 = await patch(`/api/crm/appointments/${apptId}`, { dispatchedMemberIds: [] }, cookieA);
      expect(p2.status).toBe(200);
      expect(p2.body.dispatchedMemberIds).toEqual([memberA]);
    } finally {
      await q(`update crm_members set role = 'owner' where id = $1`, [memberA]);
    }
  });

  it("validates the range params (400 on garbage)", async () => {
    const r = await api(`/api/crm/appointments?from=not-a-date`, {}, cookieA);
    expect(r.status).toBe(400);
  });

  it("deletes the appointment (then 404s)", async () => {
    const r = await del(`/api/crm/appointments/${apptId}`, cookieA);
    expect(r.status).toBe(200);
    expect(r.body.deleted).toBe(apptId);
    const again = await del(`/api/crm/appointments/${apptId}`, cookieA);
    expect(again.status).toBe(404);
    const rows = await q(`select id from crm_appointments where id = $1`, [apptId]);
    expect(rows.length).toBe(0);
  });
});
