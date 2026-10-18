/**
 * The custom job flow (shared/job-flow.ts, server/crm/job-flow.ts): the pure normalizer, the org PATCH that stores
 * it (anchors can't be removed, max phases, bad shapes are 400s), moving a project to a custom phase and back
 * (crm_projects.stage_key), the phase alerts (once per project per phase, placeholders filled, a STOP'd client is
 * skipped with a reason, every send/skip logged under "System"), and the automatic moves never leaving a custom phase
 * behind unless the anchor is ahead of it.
 *
 * Fixtures live in ONE THROWAWAY org (user 1 owner) and are deleted in afterAll — the shared dev orgs are never
 * touched. Needs the dev server (DEV_AUTH_BYPASS_USER1=true); emails sink to tmp/email-outbox.jsonl.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "fs";
import { fileURLToPath } from "url";
import pg from "pg";
import {
  DEFAULT_JOB_FLOW, FLOW_SUGGESTIONS, MAX_FLOW_PHASES, anchorBefore, anchorPassesPhase, currentPhaseKey, defaultAlertTemplate,
  isDefaultJobFlow, missingAnchors, normalizeJobFlow, phaseKeyOf, renderPhaseTemplate,
} from "@shared/job-flow";
import { JOB_STAGES } from "@shared/job-stage";

const BASE = process.env.CRM_TEST_BASE_URL ?? "http://127.0.0.1:8119";
const pool = new pg.Pool({
  connectionString: process.env.CRM_TEST_DATABASE_URL ?? "postgres://constructhub_dev:crmdev_local_only@127.0.0.1:5432/constructhub_dev",
});
const q = <T = any>(text: string, params: any[] = []) => pool.query(text, params).then((r) => r.rows as T[]);
const OUTBOX = process.env.CRM_TEST_OUTBOX ?? fileURLToPath(new URL("../../tmp/email-outbox.jsonl", import.meta.url));
const outbox = (): { at: string; to: string[] | string; subject: string | null; html: string | null }[] =>
  fs.existsSync(OUTBOX) ? fs.readFileSync(OUTBOX, "utf8").split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean) : [];

async function api(path: string, opts: RequestInit = {}, cookie?: string) {
  const res = await fetch(`${BASE}${path}`, { redirect: "manual", ...opts, headers: { ...(cookie ? { cookie } : {}), ...(opts.headers || {}) } });
  const setCookie = res.headers.get("set-cookie");
  const ct = res.headers.get("content-type") ?? "";
  const body = ct.includes("json") ? await res.json().catch(() => null) : await res.text();
  return { status: res.status, body, cookie: setCookie?.split(";")[0] ?? cookie };
}
const json = (method: string, path: string, data: unknown, cookie?: string) =>
  api(path, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(data) }, cookie);

const KEYS = JOB_STAGES.map((s) => s.key);

describe("normalizeJobFlow (pure)", () => {
  it("defaults to the six built-in phases, in order, with no alerts", () => {
    expect(normalizeJobFlow(undefined)).toEqual(DEFAULT_JOB_FLOW);
    expect(normalizeJobFlow("junk")).toEqual(DEFAULT_JOB_FLOW);
    expect(normalizeJobFlow({ phases: "nope" })).toEqual(DEFAULT_JOB_FLOW);
    expect(DEFAULT_JOB_FLOW.phases.map((p) => p.key)).toEqual(KEYS);
    expect(isDefaultJobFlow(normalizeJobFlow({ phases: [] }))).toBe(true);
  });
  it("keeps custom phases where they were, anchors always present and in order, unknown keys and repeats dropped", () => {
    const got = normalizeJobFlow({ phases: [
      { key: "bid", label: "  Lead  " }, { key: "deposit_received", label: "Deposit received" }, { key: "approved" },
      { key: "Bad Key!", label: "x" }, { key: "deposit_received", label: "dupe" }, { key: "bid_submitted", label: "" },
      { key: "closed_out", label: "Done" }, { key: "warranty", label: "Warranty follow-up" }, 42, null,
    ] });
    expect(got.phases.map((p) => p.key)).toEqual(["bid", "deposit_received", "bid_submitted", "approved", "job_scheduled", "in_progress", "closed_out", "warranty"]);
    expect(got.phases[0]).toEqual({ key: "bid", label: "Lead", builtin: "bid", alerts: [] });
    expect(got.phases[1]).toEqual({ key: "deposit_received", label: "Deposit received", alerts: [] });
    expect(got.phases[2].label).toBe("Bid Submitted"); // a blank label falls back to the built-in one
    expect(got.phases[6].label).toBe("Done");
  });
  it("normalizes alerts: bad recipients/channels dropped, staff defaults to the PM, blank templates get the default", () => {
    const got = normalizeJobFlow({ phases: [{ key: "approved", alerts: [
      { to: "client", channel: "sms", template: "  Hi {first}  " },
      { to: "staff", channel: "email", template: "" },
      { to: "staff", staff: "owner", channel: "sms", template: "x" },
      { to: "staff", staff: "member-id_1", channel: "email", template: "y" },
      { to: "everyone", channel: "email", template: "z" }, { to: "client", channel: "fax", template: "z" }, "junk",
    ] }] });
    expect(got.phases.find((p) => p.key === "approved")!.alerts).toEqual([
      { to: "client", channel: "sms", template: "Hi {first}" },
      { to: "staff", staff: "pm", channel: "email", template: defaultAlertTemplate("staff", "email") },
      { to: "staff", staff: "owner", channel: "sms", template: "x" },
      { to: "staff", staff: "member-id_1", channel: "email", template: "y" },
    ]);
  });
  it("caps the flow at MAX_FLOW_PHASES by dropping custom phases from the end, never an anchor", () => {
    const many = Array.from({ length: MAX_FLOW_PHASES + 10 }, (_, i) => ({ key: `c${i}`, label: `C${i}` }));
    const got = normalizeJobFlow({ phases: [...KEYS.map((key) => ({ key })), ...many] });
    expect(got.phases).toHaveLength(MAX_FLOW_PHASES);
    expect(got.phases.filter((p) => p.builtin)).toHaveLength(6);
    expect(got.phases.at(-1)!.key).toBe(`c${MAX_FLOW_PHASES - 7}`);
  });
  it("names the missing anchors, mints keys that never collide with a built-in one, and offers the suggestions", () => {
    expect(missingAnchors({ phases: [{ key: "bid" }, { key: "closed_out" }] })).toEqual(["bid_submitted", "approved", "job_scheduled", "in_progress"]);
    expect(missingAnchors({ phases: KEYS.map((key) => ({ key })) })).toEqual([]);
    expect(phaseKeyOf("Materials ordered")).toBe("materials_ordered");
    expect(phaseKeyOf("Approved")).toBe("approved_custom");
    expect(phaseKeyOf("Crew & gear!!", ["crew_and_gear"])).toBe("crew_and_gear_2");
    expect(FLOW_SUGGESTIONS.map((s) => s.label)).toEqual(["Deposit received", "Materials ordered", "Permit approved", "Crew assigned", "Inspection passed", "Final payment", "Warranty follow-up", "Review requested"]);
  });
  it("picks the current phase, the anchor before a custom phase, and whether an anchor passes it", () => {
    const flow = normalizeJobFlow({ phases: [{ key: "bid" }, { key: "bid_submitted" }, { key: "approved" }, { key: "deposit" }, { key: "job_scheduled" }, { key: "materials" }, { key: "in_progress" }, { key: "closed_out" }] });
    expect(currentPhaseKey(flow, "approved", null)).toBe("approved");
    expect(currentPhaseKey(flow, "approved", "materials")).toBe("materials");
    expect(currentPhaseKey(flow, "approved", "gone")).toBe("approved"); // a phase the flow no longer has
    expect(currentPhaseKey(flow, "approved", "in_progress")).toBe("approved"); // never a built-in key as a stageKey
    expect(currentPhaseKey(flow, null, "materials")).toBe("materials");
    expect(anchorBefore(flow, "deposit")).toBe("approved");
    expect(anchorBefore(flow, "materials")).toBe("job_scheduled");
    expect(anchorPassesPhase(flow, "job_scheduled", "materials")).toBe(false); // behind: the custom phase stays
    expect(anchorPassesPhase(flow, "in_progress", "materials")).toBe(true);
    expect(anchorPassesPhase(flow, "approved", "gone")).toBe(true);
    expect(anchorPassesPhase(flow, "closed_out", null)).toBe(false);
  });
  it("fills the placeholders and leaves anything else alone", () => {
    expect(renderPhaseTemplate("Hi {first} ({client}): {job} → {phase} by {company} on {date}. {nope}", { client: "Stagey Client", first: "Stagey", job: "Siding", phase: "Materials ordered", company: "Acme", date: "Oct 18, 2026" }))
      .toBe("Hi Stagey (Stagey Client): Siding → Materials ordered by Acme on Oct 18, 2026. {nope}");
  });
});

describe("job flow over the API (dev server)", () => {
  let cookie: string | undefined;
  let orgId = "", memberId = "", custId = "", projId = "";
  const stamp = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const custEmail = `flowy.${stamp}@example.invalid`;
  const custPhone = "+15555550177";
  const ownerEmail = `vitest.flow.${stamp}@example.com`;

  const project = async () => (await q(`select * from crm_projects where id = $1`, [projId]))[0];
  const alertLog = async (pid = projId) => q(`select actor_label, actor_member_id, customer_id, meta from crm_activity_log where org_id = $1 and action = 'project.phase_alert' and entity_id = $2 order by created_at`, [orgId, pid]);
  const claims = async () => q(`select project_id, phase_key from crm_stage_alerts where org_id = $1 order by created_at`, [orgId]);

  const FLOW = { phases: [
    { key: "bid", label: "Lead" }, { key: "bid_submitted" }, { key: "approved" }, { key: "job_scheduled" },
    { key: "materials_ordered", label: "Materials ordered", alerts: [
      { to: "client", channel: "email", template: "Hi {first}, {company} here: your {job} is now at {phase} ({date})." },
      { to: "client", channel: "sms", template: "Hi {first}, your {job}: {phase}." },
      { to: "staff", staff: "pm", channel: "email", template: "{client}'s {job} → {phase}." },
      { to: "staff", staff: "owner", channel: "sms", template: "{client}: {phase}" },
    ] },
    { key: "in_progress" },
    { key: "closed_out", alerts: [{ to: "staff", staff: "owner", channel: "email", template: "{client}'s {job} closed out on {date}." }] },
  ] };

  beforeAll(async () => {
    const me = await api("/api/crm/me");
    if (me.status !== 200) throw new Error(`CRM dev server not reachable at ${BASE} (GET /api/crm/me → ${me.status}). Start it first.`);
    orgId = (await q<{ id: string }>(`insert into crm_orgs (name, owner_user_id, timezone) values ($1, 1, 'America/Los_Angeles') returning id`, [`Vitest Flow ${stamp}`]))[0].id;
    memberId = (await q<{ id: string }>(
      `insert into crm_members (org_id, user_id, email, role, status, display_name, phone) values ($1, 1, $2, 'owner', 'active', 'Flow Owner', '+15555550199') returning id`,
      [orgId, ownerEmail]))[0].id;
    cookie = (await json("POST", "/api/crm/org/switch", { orgId }, me.cookie)).cookie;
    custId = (await q<{ id: string }>(
      `insert into crm_customers (org_id, display_name, first_name, email, phone, portal_token) values ($1, $2, 'Flowy', $3, $4, $5) returning id`,
      [orgId, `Flowy Client ${stamp}`, custEmail, custPhone, `ptok-${stamp}-flow`]))[0].id;
    // The client replied STOP to this org: a text alert must be skipped, never sent.
    await q(`insert into crm_sms_optouts (org_id, phone, reason) values ($1, $2, 'STOP') on conflict do nothing`, [orgId, custPhone]);
  });

  afterAll(async () => {
    if (orgId) {
      await q(`delete from crm_sms_optouts where org_id = $1`, [orgId]);
      for (const t of ["crm_stage_alerts", "crm_punch_scopes", "crm_tasks", "crm_notifications", "crm_activity_log", "crm_appointments", "crm_customer_notes",
        "crm_projects", "crm_team_activity", "crm_customers", "crm_members"]) {
        await q(`delete from ${t} where org_id = $1`, [orgId]);
      }
      await q(`delete from crm_orgs where id = $1`, [orgId]);
    }
    await pool.end();
  });

  it("PATCH /api/crm/org stores the flow normalized; bad shapes, removed anchors and too many phases are 400s", async () => {
    const saved = await json("PATCH", "/api/crm/org", { jobFlow: { ...FLOW, phases: [...FLOW.phases, { key: "Bad Key", label: "nope" }] } }, cookie);
    expect(saved.status).toBe(200);
    const me = await api("/api/crm/me", {}, cookie);
    const flow = me.body.org.customFields.jobFlow;
    expect(flow.phases.map((p: any) => p.key)).toEqual(["bid", "bid_submitted", "approved", "job_scheduled", "materials_ordered", "in_progress", "closed_out"]);
    expect(flow.phases[0]).toMatchObject({ label: "Lead", builtin: "bid" });
    expect(flow.phases[4].alerts).toHaveLength(4);
    expect(flow.phases[4].alerts[2]).toEqual({ to: "staff", staff: "pm", channel: "email", template: "{client}'s {job} → {phase}." });

    expect((await json("PATCH", "/api/crm/org", { jobFlow: { phases: "estimating" } }, cookie)).status).toBe(400);
    expect((await json("PATCH", "/api/crm/org", { jobFlow: { phases: [{ key: "bid", alerts: [{ to: "client", channel: "pigeon", template: "x" }] }] } }, cookie)).status).toBe(400);
    const noAnchor = await json("PATCH", "/api/crm/org", { jobFlow: { phases: FLOW.phases.filter((p) => p.key !== "approved") } }, cookie);
    expect(noAnchor.status).toBe(400);
    expect(noAnchor.body.message).toMatch(/built-in phases/i);
    const tooMany = await json("PATCH", "/api/crm/org", { jobFlow: { phases: [...FLOW.phases, ...Array.from({ length: MAX_FLOW_PHASES }, (_, i) => ({ key: `extra_${i}` }))] } }, cookie);
    expect(tooMany.status).toBe(400);
    // Nothing above touched the stored flow.
    expect((await api("/api/crm/me", {}, cookie)).body.org.customFields.jobFlow.phases).toHaveLength(7);
  });

  it("moving a job to a custom phase keeps its status, logs the move, and fires that phase's alerts once with the placeholders filled", async () => {
    const created = await json("POST", "/api/crm/projects", { customerId: custId, name: "Siding and windows", status: "approved" }, cookie);
    expect(created.status).toBe(201);
    projId = created.body.id;
    expect((await json("PATCH", `/api/crm/projects/${projId}`, { stageKey: "nope" }, cookie)).status).toBe(400);
    expect((await json("PATCH", `/api/crm/projects/${projId}`, { stageKey: "in_progress" }, cookie)).status).toBe(400); // a built-in phase is a status, never a stageKey
    const sinceIdx = outbox().length;

    const moved = await json("PATCH", `/api/crm/projects/${projId}`, { stageKey: "materials_ordered" }, cookie);
    expect(moved.status).toBe(200);
    expect(moved.body.stageKey).toBe("materials_ordered");
    expect(moved.body.status).toBe("approved");
    const p = await project();
    expect(p.stage_key).toBe("materials_ordered");
    expect(p.status).toBe("approved");
    const manual = await q(`select meta from crm_activity_log where org_id = $1 and action = 'project.phase' and entity_id = $2`, [orgId, projId]);
    expect(manual).toHaveLength(1);
    expect(manual[0].meta).toMatchObject({ phase: "materials_ordered", phaseLabel: "Materials ordered", from: "approved" });

    const log = await alertLog();
    expect(log).toHaveLength(4);
    for (const row of log) { expect(row.actor_label).toBe("System"); expect(row.actor_member_id).toBeNull(); expect(row.customer_id).toBe(custId); }
    const by = (to: string, channel: string) => log.find((r) => r.meta.to === to && r.meta.channel === channel)!.meta;
    // Client email: sent through the org's sender, placeholders filled, noted on the client timeline.
    const ce = by("client", "email");
    expect(ce).toMatchObject({ phase: "materials_ordered", phaseLabel: "Materials ordered", result: "sent", recipient: custEmail, provider: "email", trigger: "manual" });
    expect(ce.preview).toMatch(new RegExp(`^Hi Flowy, Vitest Flow ${stamp} here: your Siding and windows is now at Materials ordered \\([A-Z][a-z]{2} \\d{1,2}, \\d{4}\\)\\.$`));
    const mails = outbox().slice(sinceIdx);
    const clientMail = mails.find((m) => [m.to].flat().join(",").includes(custEmail));
    expect(clientMail?.subject).toBe(`Message from Vitest Flow ${stamp}`);
    expect(clientMail?.html).toContain("your Siding and windows is now at Materials ordered");
    const notes = await q(`select author_member_id, body from crm_customer_notes where org_id = $1 and customer_id = $2`, [orgId, custId]);
    expect(notes).toHaveLength(1);
    expect(notes[0].author_member_id).toBeNull();
    expect(notes[0].body).toMatch(/^Message sent via email to /);
    // Client text: the client replied STOP → skipped with that reason, never sent, nothing on the timeline.
    const cs = by("client", "sms");
    expect(cs).toMatchObject({ result: "skipped", recipient: custPhone });
    expect(cs.reason).toMatch(/STOP/);
    expect(cs.preview).toBe("Hi Flowy, your Siding and windows: Materials ordered.");
    // Staff email to the PM: nobody in that seat → the owner, said so in the log.
    const se = by("staff", "email");
    expect(se).toMatchObject({ staff: "pm", result: "sent", recipient: ownerEmail });
    expect(se.reason).toMatch(/no project manager on the job — sent to the owner/);
    const staffMail = mails.find((m) => [m.to].flat().join(",").includes(ownerEmail));
    expect(staffMail?.subject).toBe(`Vitest Flow ${stamp}: Flowy Client ${stamp}'s Siding and windows — Materials ordered`);
    expect(staffMail?.html).toContain(`Flowy Client ${stamp}&#39;s Siding and windows → Materials ordered.`);
    // Staff text to the owner: texting is not set up on the dev server → skipped with the reason (never a pretend send).
    const ss = by("staff", "sms");
    expect(ss).toMatchObject({ staff: "owner", result: "skipped", recipient: "+15555550199" });
    expect(ss.reason).toMatch(/texting isn't set up/);
    // The bell got the staff alerts.
    const bell = await q(`select title, body, link from crm_notifications where org_id = $1 and member_id = $2 and type = 'jobPhase'`, [orgId, memberId]);
    expect(bell).toHaveLength(2);
    expect(bell[0].link).toBe(`/crm/clients/${custId}`);
    expect(await claims()).toEqual([{ project_id: projId, phase_key: "materials_ordered" }]);
  });

  it("back to a built-in phase clears the custom one; re-entering the custom phase never alerts twice", async () => {
    const back = await json("PATCH", `/api/crm/projects/${projId}`, { status: "in_progress" }, cookie);
    expect(back.status).toBe(200);
    expect(back.body.stageKey).toBeNull();
    expect(back.body.status).toBe("in_progress");
    const again = await json("PATCH", `/api/crm/projects/${projId}`, { stageKey: "materials_ordered" }, cookie);
    expect(again.status).toBe(200);
    expect(again.body.stageKey).toBe("materials_ordered");
    expect(again.body.status).toBe("in_progress"); // a custom phase never changes the status
    expect(await alertLog()).toHaveLength(4);
    expect(await claims()).toHaveLength(1);
    // Same status, explicit stageKey: null → back to the built-in phase.
    const clear = await json("PATCH", `/api/crm/projects/${projId}`, { stageKey: null }, cookie);
    expect(clear.body.stageKey).toBeNull();
  });

  it("an automatic move keeps a custom phase that is AHEAD of its anchor and clears one it passes", async () => {
    await q(`update crm_projects set status = 'approved', stage_key = 'materials_ordered' where id = $1`, [projId]);
    // A visit on the calendar → Job Scheduled, which sits BEFORE Materials ordered: the status moves, the phase stays.
    const visit = await json("POST", "/api/crm/appointments", { projectId: projId, customerId: custId, title: "Start", startsAt: new Date(Date.now() + 3 * 86400000).toISOString() }, cookie);
    expect(visit.status).toBe(201);
    let p = await project();
    expect(p.status).toBe("scheduled");
    expect(p.stage_key).toBe("materials_ordered");
    // Every walkthrough complete → Closed out, which is past Materials ordered: the custom phase is left behind.
    const punch = await json("PUT", `/api/crm/projects/${projId}/punch`, { scopes: [{ label: "General", walkthroughDone: true }] }, cookie);
    expect(punch.status).toBe(200);
    expect(punch.body.closedOut).toBe(true);
    p = await project();
    expect(p.status).toBe("complete");
    expect(p.stage_key).toBeNull();
    // The built-in phase's own alert fired from the automatic move, under "System", naming the trigger.
    const closed = (await alertLog()).filter((r) => r.meta.phase === "closed_out");
    expect(closed).toHaveLength(1);
    expect(closed[0].meta).toMatchObject({ to: "staff", staff: "owner", channel: "email", result: "sent", recipient: ownerEmail, trigger: "punchlist" });
    expect(closed[0].meta.preview).toMatch(new RegExp(`^Flowy Client ${stamp}'s Siding and windows closed out on `));
    expect((await claims()).map((c) => c.phase_key)).toEqual(["materials_ordered", "closed_out"]);
  });

  it("a job born at a custom phase gets the status of the built-in phase before it; the review pipeline still reads the built-in stage", async () => {
    const other = (await q<{ id: string }>(
      `insert into crm_customers (org_id, display_name, first_name, portal_token) values ($1, $2, 'Second', $3) returning id`,
      [orgId, `Second Client ${stamp}`, `ptok-${stamp}-flow2`]))[0].id;
    const born = await json("POST", "/api/crm/projects", { customerId: other, name: "Gutters", stageKey: "materials_ordered" }, cookie);
    expect(born.status).toBe(201);
    expect(born.body).toMatchObject({ status: "scheduled", stageKey: "materials_ordered" });
    expect((await json("POST", "/api/crm/projects", { customerId: other, name: "Nope", stageKey: "bogus" }, cookie)).status).toBe(400);
    // No email / phone on this client: both client alerts are skipped and say why; the alerts still counted as processed.
    const log = await alertLog(born.body.id);
    expect(log.filter((r) => r.meta.to === "client").map((r) => [r.meta.result, r.meta.reason])).toEqual([
      ["skipped", "the client has no email address"], ["skipped", "the client has no phone number"],
    ]);
    // The client page's data carries stageKey for the tracker.
    const detail = await api(`/api/crm/customers/${other}`, {}, cookie);
    expect(detail.body.projects[0].stageKey).toBe("materials_ordered");
  });

  it("jobFlow: null resets to the default (the key comes off custom_fields)", async () => {
    expect((await json("PATCH", "/api/crm/org", { jobFlow: null }, cookie)).status).toBe(200);
    expect((await api("/api/crm/me", {}, cookie)).body.org.customFields.jobFlow).toBeUndefined();
    // Saving the default flow explicitly stores nothing either.
    expect((await json("PATCH", "/api/crm/org", { jobFlow: DEFAULT_JOB_FLOW }, cookie)).status).toBe(200);
    expect((await api("/api/crm/me", {}, cookie)).body.org.customFields.jobFlow).toBeUndefined();
  });
});
