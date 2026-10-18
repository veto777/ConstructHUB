/**
 * The job stage moves on its own (server/crm/job-stage-auto.ts) and the punch list & final walkthrough
 * (server/crm/punch-list.ts), against the running dev server (DEV_AUTH_BYPASS_USER1=true):
 *
 *   bid sent → Bid Submitted (a client with no project gets one) · approved (portal signature) → Approved + the
 *   "call to schedule the start date" task · a visit on the calendar → Job Scheduled + task done · an invoice sent
 *   → In progress · never backward · punch routes (org isolation, permission, every walkthrough → Closed out).
 *
 * Fixtures live in TWO THROWAWAY orgs (user 1 owner of both) and are deleted in afterAll — the shared dev orgs are
 * never touched. The role flip hits only the scratch org's membership and is restored in a finally.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import { createHash, randomBytes } from "node:crypto";
import { deriveScopes, normalizePunchItems, openWalkthroughs, parsePunchPhotoName, punchPhotoName, scopeKeyOf } from "@shared/punch-list";

const BASE = process.env.CRM_TEST_BASE_URL ?? "http://127.0.0.1:8119";
const pool = new pg.Pool({
  connectionString: process.env.CRM_TEST_DATABASE_URL ?? "postgres://constructhub_dev:crmdev_local_only@127.0.0.1:5432/constructhub_dev",
});
const q = <T = any>(text: string, params: any[] = []) => pool.query(text, params).then((r) => r.rows as T[]);
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

async function api(path: string, opts: RequestInit = {}, cookie?: string) {
  const res = await fetch(`${BASE}${path}`, { redirect: "manual", ...opts, headers: { ...(cookie ? { cookie } : {}), ...(opts.headers || {}) } });
  const setCookie = res.headers.get("set-cookie");
  const ct = res.headers.get("content-type") ?? "";
  const body = ct.includes("json") ? await res.json().catch(() => null) : await res.text();
  return { status: res.status, body, cookie: setCookie?.split(";")[0] ?? cookie };
}
const json = (method: string, path: string, data: unknown, cookie?: string) =>
  api(path, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(data) }, cookie);

describe("punch-list helpers (pure)", () => {
  it("derives one scope per trade from the approved estimates, General for anything unmatched, in trade order", () => {
    expect(deriveScopes([{ title: "Windows & siding replacement", items: [{ name: "Tear-off and new architectural shingle roof" }] }]))
      .toEqual([{ scope: "siding", label: "Siding" }, { scope: "roofing", label: "Roofing" }, { scope: "windows", label: "Windows" }]);
    expect(deriveScopes([{ title: "Smith residence", items: [{ name: "Misc labor" }] }])).toEqual([{ scope: "general", label: "General" }]);
    expect(deriveScopes([])).toEqual([{ scope: "general", label: "General" }]);
    expect(deriveScopes([{ title: "Gutters", items: [] }, { title: "Bathroom remodel", items: [] }]).map((s) => s.scope)).toEqual(["gutters", "general"]);
  });
  it("normalizes items: trims, drops blanks, keeps good ids, mints bad ones, validates doneAt", () => {
    const got = normalizePunchItems([{ id: "abc", text: "  Caulk   window 3 ", doneAt: "2026-10-17T10:00:00.000Z" }, { text: "" }, { id: "bad id!", text: "Touch up paint", doneAt: "nope" }, null, "x"]);
    expect(got).toHaveLength(2);
    expect(got[0]).toEqual({ id: "abc", text: "Caulk window 3", doneAt: "2026-10-17T10:00:00.000Z" });
    expect(got[1].id).toMatch(/^[a-z0-9]+$/);
    expect(got[1]).toMatchObject({ text: "Touch up paint", doneAt: null });
    expect(normalizePunchItems("junk")).toEqual([]);
    // A repeated id is re-minted so two rows never share one.
    const dup = normalizePunchItems([{ id: "same", text: "a" }, { id: "same", text: "b" }]);
    expect(dup[0].id).not.toBe(dup[1].id);
  });
  it("keys scopes, counts open walkthroughs and tags photos", () => {
    expect(scopeKeyOf("Soffit & fascia")).toBe("soffit_fascia");
    expect(scopeKeyOf("Pool house!")).toBe("pool_house");
    expect(openWalkthroughs([{ walkthroughDoneAt: null }, { walkthroughDoneAt: "2026-01-01" }, {}])).toEqual({ open: 2, total: 3 });
    expect(punchPhotoName("siding", "IMG_1.jpg")).toBe("punchlist--siding--IMG_1.jpg");
    expect(parsePunchPhotoName("punchlist--siding--IMG_1.jpg")).toEqual({ scope: "siding", displayName: "IMG_1.jpg" });
    expect(parsePunchPhotoName("punchlist--IMG_1.jpg")).toEqual({ scope: "general", displayName: "IMG_1.jpg" });
    expect(parsePunchPhotoName("progress--IMG_1.jpg")).toBeNull();
  });
});

describe("job stage auto-advance + punch list (dev server)", () => {
  let cookieA: string | undefined, cookieB: string | undefined;
  let orgA = "", orgB = "", memberA = "", custA = "", estId = "", projId = "", clientSessionHash = "";
  const stamp = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

  const project = async () => (await q(`select * from crm_projects where org_id = $1 and customer_id = $2 order by created_at desc`, [orgA, custA]));
  const tasks = async () => q(`select * from crm_tasks where org_id = $1 and source = 'schedule_start' order by created_at`, [orgA]);
  const autoLog = async () => q(`select meta from crm_activity_log where org_id = $1 and action = 'project.stage_auto' order by created_at`, [orgA]);

  beforeAll(async () => {
    const me = await api("/api/crm/me");
    if (me.status !== 200) throw new Error(`CRM dev server not reachable at ${BASE} (GET /api/crm/me → ${me.status}). Start it first.`);
    const mkOrg = async (name: string) => (await q<{ id: string }>(`insert into crm_orgs (name, owner_user_id) values ($1, 1) returning id`, [name]))[0].id;
    orgA = await mkOrg(`Vitest Stage A ${stamp}`);
    orgB = await mkOrg(`Vitest Stage B ${stamp}`);
    for (const [orgId, tag] of [[orgA, "a"], [orgB, "b"]] as const) {
      const [{ id }] = await q<{ id: string }>(
        `insert into crm_members (org_id, user_id, email, role, status, display_name) values ($1, 1, $2, 'owner', 'active', 'Stage Owner') returning id`,
        [orgId, `vitest.stage.${tag}.${stamp}@example.com`]);
      if (orgId === orgA) memberA = id;
    }
    cookieA = (await json("POST", "/api/crm/org/switch", { orgId: orgA }, me.cookie)).cookie;
    cookieB = (await json("POST", "/api/crm/org/switch", { orgId: orgB }, me.cookie)).cookie;
    const [{ id }] = await q<{ id: string }>(
      `insert into crm_customers (org_id, display_name, first_name, email, phone, portal_token) values ($1, $2, 'Stagey', $3, '+15555550123', $4) returning id`,
      [orgA, `Stagey Client ${stamp}`, `stagey.${stamp}@example.invalid`, `ptok-${stamp}-stage`]);
    custA = id;
  });

  afterAll(async () => {
    if (clientSessionHash) await q(`delete from crm_client_sessions where token_hash = $1`, [clientSessionHash]);
    for (const orgId of [orgA, orgB]) {
      if (!orgId) continue;
      for (const t of ["crm_punch_scopes", "crm_tasks", "crm_notifications", "crm_activity_log", "crm_appointments", "crm_invoice_items", "crm_invoices",
        "crm_estimate_items", "crm_estimate_events", "crm_estimate_discounts", "crm_estimates", "crm_projects", "crm_team_activity", "crm_customers", "crm_members"]) {
        await q(`delete from ${t} where org_id = $1`, [orgId]);
      }
      await q(`delete from crm_orgs where id = $1`, [orgId]);
    }
    await pool.end();
  });

  it("a sent bid creates the client's project at Bid Submitted and logs the automatic move", async () => {
    const est = await json("POST", "/api/crm/estimates", {
      customerId: custA, title: "Siding and windows", items: [{ name: "James Hardie lap siding", unitPriceCents: 1_500_000 }, { name: "Replacement windows x6", unitPriceCents: 800_000 }],
    }, cookieA);
    expect(est.status).toBe(201);
    estId = est.body.id;
    expect((await project())).toHaveLength(0);
    const sent = await json("POST", `/api/crm/estimates/${estId}/send`, {}, cookieA);
    expect(sent.status).toBe(200);
    const [p] = await project();
    expect(p).toBeTruthy();
    expect(p.status).toBe("proposal_sent");
    expect(p.name).toBe("Siding and windows");
    projId = p.id;
    // The estimate now belongs to the project it created.
    expect((await q(`select project_id from crm_estimates where id = $1`, [estId]))[0].project_id).toBe(projId);
    const log = await autoLog();
    expect(log.at(-1)?.meta).toMatchObject({ trigger: "estimate.sent", to: "proposal_sent", created: true });
    // The client page's stage reads Bid Submitted.
    const detail = await api(`/api/crm/customers/${custA}`, {}, cookieA);
    expect(detail.body.projects[0].status).toBe("proposal_sent");
  });

  it("the client's signature moves the job to Approved and leaves a friendly call-to-schedule task for the PM", async () => {
    const det = await api(`/api/crm/estimates/${estId}`, {}, cookieA);
    const token = String(det.body.publicPath).split("/e/")[1];
    const raw = randomBytes(32).toString("hex");
    clientSessionHash = sha256(raw);
    await q(`insert into crm_client_sessions (token_hash, customer_ids, expires_at, last_seen_at) values ($1, $2::jsonb, now() + interval '1 day', now())`,
      [clientSessionHash, JSON.stringify([custA])]);
    const ok = await json("POST", `/api/public/estimates/${token}/respond`, { decision: "approve", signatureName: "Stagey Client" }, `crm_client=${raw}`);
    expect(ok.status).toBe(200);
    const [p] = await project();
    expect(p.status).toBe("approved");
    expect(p.contract_value_cents).toBe(2_300_000);
    expect((await autoLog()).at(-1)?.meta).toMatchObject({ trigger: "estimate.approved", from: "proposal_sent", to: "approved" });
    const t = await tasks();
    expect(t).toHaveLength(1);
    expect(t[0].title).toBe(`Call Stagey Client ${stamp} to schedule the start date`);
    expect(t[0].assigned_member_id).toBe(memberA); // no PM, no sales rep → the owner
    expect(t[0].customer_id).toBe(custA);
    expect(t[0].done_at).toBeNull();
    expect(t[0].meta).toMatchObject({ projectId: projId });
    expect(t[0].body).toContain("Stagey's Siding and windows is approved");
    // The in-app notification went to the owner the way a self-estimate task does.
    const notes = await q(`select * from crm_notifications where org_id = $1 and type = 'scheduleStart'`, [orgA]);
    expect(notes.length).toBeGreaterThanOrEqual(1);
    expect(notes[0].link).toBe(`/crm/clients/${custA}`);
    // The task is visible on the tasks list with its own text (not the self-estimate wording).
    const list = await api("/api/crm/tasks", {}, cookieA);
    const mine = list.body.tasks.find((x: any) => x.id === t[0].id);
    expect(mine.body).toContain("Give Stagey a call");
    expect(mine.projectId).toBe(projId);
  });

  it("moving a job to Approved by hand is idempotent for the reminder (one open task per project)", async () => {
    expect((await json("PATCH", `/api/crm/projects/${projId}`, { status: "estimating" }, cookieA)).status).toBe(200);
    expect((await json("PATCH", `/api/crm/projects/${projId}`, { status: "approved" }, cookieA)).status).toBe(200);
    expect(await tasks()).toHaveLength(1);
  });

  it("a visit on the calendar moves the job to Job Scheduled and marks the task done", async () => {
    const starts = new Date(Date.now() + 3 * 86400000).toISOString();
    const r = await json("POST", "/api/crm/appointments", { projectId: projId, customerId: custA, title: "Project start", startsAt: starts }, cookieA);
    expect(r.status).toBe(201);
    const [p] = await project();
    expect(p.status).toBe("scheduled");
    expect((await autoLog()).at(-1)?.meta).toMatchObject({ trigger: "appointment", to: "scheduled" });
    const [t] = await tasks();
    expect(t.done_at).not.toBeNull();
    expect(t.done_by_member_id).toBeNull(); // the system closed it
    // Another visit changes nothing (same stage, no new task).
    const again = await json("POST", "/api/crm/appointments", { customerId: custA, title: "Day two", startsAt: new Date(Date.now() + 4 * 86400000).toISOString() }, cookieA);
    expect(again.status).toBe(201);
    expect((await project())[0].status).toBe("scheduled");
    expect(await tasks()).toHaveLength(1);
  });

  it("a sent invoice moves the job to In progress", async () => {
    const inv = await json("POST", "/api/crm/invoices", { customerId: custA, projectId: projId, title: "Deposit", items: [{ name: "Deposit", unitPriceCents: 500_000 }] }, cookieA);
    expect(inv.status).toBe(201);
    const invId = inv.body.id ?? inv.body.invoice?.id;
    const sent = await json("POST", `/api/crm/invoices/${invId}/send`, {}, cookieA);
    expect(sent.status).toBe(200);
    expect((await project())[0].status).toBe("in_progress");
    expect((await autoLog()).at(-1)?.meta).toMatchObject({ trigger: "invoice.sent", from: "scheduled", to: "in_progress" });
  });

  it("never moves a job backward on its own", async () => {
    const before = (await autoLog()).length;
    // A second bid out the door, another visit and another invoice: In progress stays In progress.
    const est2 = await json("POST", "/api/crm/estimates", { customerId: custA, projectId: projId, title: "Change order: gutters", items: [{ name: "Gutters", unitPriceCents: 100_000 }] }, cookieA);
    expect((await json("POST", `/api/crm/estimates/${est2.body.id}/send`, {}, cookieA)).status).toBe(200);
    expect((await json("POST", "/api/crm/appointments", { projectId: projId, title: "Punch day", startsAt: new Date(Date.now() + 9 * 86400000).toISOString() }, cookieA)).status).toBe(201);
    expect((await project())[0].status).toBe("in_progress");
    expect((await autoLog()).length).toBe(before);
    // A cancelled project is never touched either.
    const [{ id: cancelled }] = await q<{ id: string }>(`insert into crm_projects (org_id, customer_id, name, status) values ($1, $2, 'Old job', 'cancelled') returning id`, [orgA, custA]);
    expect((await json("POST", "/api/crm/appointments", { projectId: cancelled, title: "Ghost", startsAt: new Date(Date.now() + 9 * 86400000).toISOString() }, cookieA)).status).toBe(201);
    expect((await q(`select status from crm_projects where id = $1`, [cancelled]))[0].status).toBe("cancelled");
    await q(`delete from crm_appointments where project_id = $1`, [cancelled]);
    await q(`delete from crm_projects where id = $1`, [cancelled]);
  });

  it("GET /punch seeds one scope per trade of the approved work; another org cannot see it", async () => {
    const r = await api(`/api/crm/projects/${projId}/punch`, {}, cookieA);
    expect(r.status).toBe(200);
    expect(r.body.scopes.map((s: any) => s.scope)).toEqual(["siding", "windows"]);
    expect(r.body.scopes[0]).toMatchObject({ label: "Siding", items: [], walkthroughDoneAt: null });
    expect((await api(`/api/crm/projects/${projId}/punch`, {}, cookieB)).status).toBe(404);
    expect((await json("PUT", `/api/crm/projects/${projId}/punch`, { scopes: [{ label: "Siding", walkthroughDone: true }] }, cookieB)).status).toBe(404);
  });

  it("PUT /punch needs manageJobs, keeps at least one scope, and stores items + walkthroughs with who/when", async () => {
    await q(`update crm_members set role = 'sales' where id = $1`, [memberA]); // sees every job, no manageJobs
    try {
      expect((await json("PUT", `/api/crm/projects/${projId}/punch`, { scopes: [{ label: "Siding" }] }, cookieA)).status).toBe(403);
    } finally {
      await q(`update crm_members set role = 'owner' where id = $1`, [memberA]);
    }
    expect((await json("PUT", `/api/crm/projects/${projId}/punch`, { scopes: [] }, cookieA)).status).toBe(400);
    const r = await json("PUT", `/api/crm/projects/${projId}/punch`, { scopes: [
      { scope: "siding", label: "Siding", items: [{ text: "Caulk the north corner" }, { text: "   " }], walkthroughDone: true },
      { scope: "windows", label: "Windows", items: [{ id: "w1", text: "Screen on bedroom window", doneAt: "2026-10-17T00:00:00.000Z" }] },
      { label: "Soffit & fascia", items: [] },
    ] }, cookieA);
    expect(r.status).toBe(200);
    expect(r.body.closedOut).toBe(false);
    expect(r.body.scopes.map((s: any) => s.scope)).toEqual(["siding", "windows", "soffit_fascia"]);
    expect(r.body.scopes[0].items).toHaveLength(1);
    expect(r.body.scopes[0].walkthroughDoneAt).toBeTruthy();
    expect(r.body.scopes[0].walkthroughDoneBy).toBe("Stage Owner");
    expect(r.body.scopes[1].items[0]).toMatchObject({ id: "w1", doneAt: "2026-10-17T00:00:00.000Z" });
    expect(r.body.scopes[1].walkthroughDoneAt).toBeNull();
    expect((await project())[0].status).toBe("in_progress");
    // Undo keeps the row, clears the sign-off; dropping a scope deletes it.
    const undo = await json("PUT", `/api/crm/projects/${projId}/punch`, { scopes: [
      { scope: "siding", label: "Siding", items: r.body.scopes[0].items, walkthroughDone: false },
      { scope: "windows", label: "Windows", items: r.body.scopes[1].items },
    ] }, cookieA);
    expect(undo.body.scopes.map((s: any) => s.scope)).toEqual(["siding", "windows"]);
    expect(undo.body.scopes[0].walkthroughDoneAt).toBeNull();
    expect((await q(`select count(*)::int n from crm_punch_scopes where project_id = $1`, [projId]))[0].n).toBe(2);
  });

  it("every walkthrough complete closes the job out through the stage path (log + Closed out)", async () => {
    const r = await json("PUT", `/api/crm/projects/${projId}/punch`, { scopes: [
      { scope: "siding", label: "Siding", walkthroughDone: true },
      { scope: "windows", label: "Windows", walkthroughDone: true },
    ] }, cookieA);
    expect(r.status).toBe(200);
    expect(r.body.closedOut).toBe(true);
    expect(r.body.projectStatus).toBe("complete");
    expect((await project())[0].status).toBe("complete");
    expect((await autoLog()).at(-1)?.meta).toMatchObject({ trigger: "punchlist", from: "in_progress", to: "complete", scopes: ["Siding", "Windows"] });
    // The tracker reads Closed out and the Google Reviews pipeline sees a finished won job.
    const detail = await api(`/api/crm/customers/${custA}`, {}, cookieA);
    expect(detail.body.projects.find((p: any) => p.id === projId).status).toBe("complete");
    // Saving again is a no-op for the stage (already closed, never "re-completed").
    const again = await json("PUT", `/api/crm/projects/${projId}/punch`, { scopes: r.body.scopes.map((s: any) => ({ ...s, walkthroughDone: true })) }, cookieA);
    expect(again.body.closedOut).toBe(false);
    expect((await autoLog()).filter((l) => l.meta.trigger === "punchlist")).toHaveLength(1);
  });
});
