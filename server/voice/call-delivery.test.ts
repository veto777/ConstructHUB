/**
 * Durable post-call CRM work (Codex score-4 lane A) against the real lane DB: the end report writes its lead and
 * escalation tasks in the same transaction that acknowledges it, the report never fails because the CRM did, and
 * the delivery worker finishes the work later — after injected failures and a simulated restart — without a
 * second client, project or escalation.
 *
 * Failures are injected for real, not mocked:
 *   - the CRM: a BEFORE INSERT trigger on crm_projects (and voice_escalations) raises for THIS test's org while a
 *     switch row exists (vitest_call_faults) — the client insert before it commits, the project insert fails;
 *   - the carrier: SignalWire env pointed at a closed port, so the escalation text really fails to send;
 *   - the process: a task leased by a "dead" runner, and a crash right after the acknowledgement (afterAck).
 * Sends never leave the box (EMAIL_FORCE_SINK=1; texts go to a per-run log outbox once the carrier is unset).
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import pg from "pg";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { cleanup, fakePhone, made, makeAccount, makeCall, makeNumber, setProfile, type Account } from "./calls-fixtures";

process.env.DATABASE_URL = process.env.CRM_TEST_DATABASE_URL ?? process.env.DATABASE_URL;
process.env.EMAIL_FORCE_SINK = "1";
process.env.VOICE_INTERNAL_SECRET = "vitest-call-delivery-secret-0123456789";
const CARRIER = ["SIGNALWIRE_SPACE_URL", "SIGNALWIRE_PROJECT_ID", "SIGNALWIRE_API_TOKEN", "SIGNALWIRE_FROM_NUMBER"] as const;
for (const k of CARRIER) delete process.env[k];
const SMS_OUTBOX = path.join(process.cwd(), "tmp", `voice-delivery-sms-${process.pid}.jsonl`);
process.env.SMS_OUTBOX_PATH = SMS_OUTBOX;

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const bag = made();
let ic: typeof import("./internal-calls");
let tasks: typeof import("./call-tasks");
let a: Account;
let numberId: string;
const leadTech = fakePhone();

const MIN = 60_000;
const later = (ms: number) => () => new Date(Date.now() + ms);

/** The carrier is down: every text fails (a real fetch to a closed port). */
function carrierDown() {
  process.env.SIGNALWIRE_SPACE_URL = "127.0.0.1:9";
  process.env.SIGNALWIRE_PROJECT_ID = "vitest-project";
  process.env.SIGNALWIRE_API_TOKEN = "vitest-token";
  process.env.SIGNALWIRE_FROM_NUMBER = "+15550100999";
}
function carrierBack() { for (const k of CARRIER) delete process.env[k]; }
async function crmFault(table: "crm_projects" | "voice_escalations", on: boolean) {
  if (on) await pool.query("insert into vitest_call_faults(key) values ($1) on conflict do nothing", [`${table}:${a.orgId}`]);
  else await pool.query("delete from vitest_call_faults where key = $1", [`${table}:${a.orgId}`]);
}

const count = async (sqlText: string, args: unknown[]) => Number((await pool.query(sqlText, args)).rows[0].n);
const customers = () => count("select count(*)::int n from crm_customers where org_id = $1", [a.orgId]);
const projects = () => count("select count(*)::int n from crm_projects where org_id = $1", [a.orgId]);
const escalationsFor = (callId: string) => count("select count(*)::int n from voice_escalations where call_id = $1", [callId]);
const callRow = async (id: string) => (await pool.query("select * from voice_calls where id = $1", [id])).rows[0];
const taskRows = async (callId: string) => (await pool.query("select * from voice_call_tasks where call_id = $1 order by id", [callId])).rows;
const smsTo = (to: string) => fs.existsSync(SMS_OUTBOX)
  ? fs.readFileSync(SMS_OUTBOX, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)).filter((m) => m.to === to)
  : [];

async function loadCall(id: string) {
  const { db } = await import("../db");
  return (await db.query.voiceCalls.findFirst({ where: (c, { eq }) => eq(c.id, id) }))!;
}

const leadReport = (over: Record<string, unknown> = {}) => ic.endReportSchema.parse({
  durationSeconds: 140, outcome: "lead_submitted", summary: "Hail damage on the north slope; wants an inspection.",
  slots: { first_name: "Rowan", need: "Hail damage inspection", address: "18 Example Way, Lakewood" },
  alerts: [{ kind: "urgent", summary: "Active leak into the living room." }],
  recordingPending: true,
  ...over,
});

beforeAll(async () => {
  if (!/^\/constructhub_dev(?:_a\d+|_fs)?$/.test(new URL(process.env.DATABASE_URL!).pathname)) throw new Error("Requires a ConstructHUB development lane DB");
  const { ensureVoiceSchema } = await import("./schema");
  await ensureVoiceSchema(pool);
  // The fault switch: a trigger that raises only while a row names its table and THIS run's org. It checks that the
  // switch table exists first, so a run that dies before afterAll can never break inserts for anyone else.
  await pool.query("create table if not exists vitest_call_faults (key text primary key)");
  await pool.query(`create or replace function vitest_call_fault() returns trigger language plpgsql as $fn$
    declare hit boolean;
    begin
      if to_regclass('public.vitest_call_faults') is null then return new; end if;
      execute 'select exists(select 1 from vitest_call_faults where key = $1)' into hit using tg_table_name || ':' || new.org_id;
      if hit then raise exception 'injected fault: % insert refused', tg_table_name; end if;
      return new;
    end $fn$`);
  for (const t of ["crm_projects", "voice_escalations"]) {
    await pool.query(`drop trigger if exists vitest_call_fault_trg on ${t}`);
    await pool.query(`create trigger vitest_call_fault_trg before insert on ${t} for each row execute function vitest_call_fault()`);
  }
  ic = await import("./internal-calls");
  tasks = await import("./call-tasks");
  a = await makeAccount(pool, bag, { orgName: "Delivery Test Roofing" });
  numberId = (await makeNumber(pool, a.orgId)).id;
  await setProfile(pool, a.orgId, {
    company: { name: "Delivery Test Roofing", timezone: "UTC" },
    persona: { presetId: "janice", assistantName: "Janice" },
    leadDelivery: { crm: { enabled: true, createProject: true } },
    escalations: {
      rules: [{ id: "lead-tech", kinds: ["urgent", "existing_customer"], channel: "sms", recipientName: "Lead Tech", recipient: leadTech,
        reminders: { enabled: false } }],
      fallbackToOwner: true,
    },
  });
});

afterEach(async () => {
  carrierBack();
  await pool.query("delete from vitest_call_faults where key like $1", [`%:${a?.orgId}`]).catch(() => {});
});

afterAll(async () => {
  for (const t of ["crm_projects", "voice_escalations"]) await pool.query(`drop trigger if exists vitest_call_fault_trg on ${t}`).catch(() => {});
  await pool.query("drop function if exists vitest_call_fault()").catch(() => {});
  await pool.query("drop table if exists vitest_call_faults").catch(() => {});
  await cleanup(pool, bag);
  await pool.end();
  fs.rmSync(SMS_OUTBOX, { force: true });
  const { pool: appPool } = await import("../db");
  await appPool.end();
});

describe("an acknowledged report never leaves CRM or escalation work undone", () => {
  it("CRM and carrier down during the report: acknowledged with pending tasks, then delivered after a restart — exactly once", async () => {
    // A caller with no caller id and no phone slot: the client can only be found again through the call itself.
    const c = await makeCall(pool, a.orgId, { numberId });
    await pool.query("update voice_calls set from_number = null where id = $1", [c.id]);
    const before = { customers: await customers(), projects: await projects() };
    await crmFault("crm_projects", true);
    carrierDown();

    const r1 = await ic.finishCall(await loadCall(c.id), leadReport());
    // Acknowledged (the engine stops resending) …
    expect(r1).toMatchObject({ callId: c.id, outcome: "lead_submitted" });
    expect(r1.delivery?.state).toBe("pending");
    const row1 = await callRow(c.id);
    expect(row1.flags.processedAt).toBeTruthy();
    // … and the work is on record, not lost: both tasks pending, each with its failure.
    const t1 = await taskRows(c.id);
    expect(t1.map((t: any) => [t.task_key, t.state, t.attempts])).toEqual([["lead", "pending", 1], ["escalation:urgent", "pending", 1]]);
    expect(t1[0].last_error).toMatch(/injected fault: crm_projects/);
    expect(t1[1].last_error).toMatch(/not sent/);
    // The client committed with its link to the call; the project did not.
    expect(await customers()).toBe(before.customers + 1);
    expect(await projects()).toBe(before.projects);
    expect(row1.customer_id).toBeTruthy();
    expect(row1.project_id).toBeNull();
    expect(row1.lead_delivered_at).toBeNull();
    expect(await escalationsFor(c.id)).toBe(1);
    const esc0 = (await pool.query("select * from voice_escalations where call_id = $1", [c.id])).rows[0];
    expect(esc0.sent_count).toBe(0);

    // The engine resends the report (its outbox retries): the stored result, nothing re-run before it is due.
    const r2 = await ic.finishCall(await loadCall(c.id), leadReport());
    expect(r2.delivery?.state).toBe("pending");
    expect(await customers()).toBe(before.customers + 1);

    // A retry that runs while the CRM is still down fails again and backs off (30 s → 60 s).
    const s1 = await tasks.runDueCallTasks({ now: later(31_000) });
    expect(s1.pending).toBeGreaterThanOrEqual(2);
    const t2 = await taskRows(c.id);
    expect(t2.map((t: any) => t.attempts)).toEqual([2, 2]);
    expect(new Date(t2[0].next_attempt_at).getTime() - Date.now()).toBeGreaterThan(80_000);

    // "Restart": a runner took the lead task and died holding its lease. Nobody else may run it until the lease ends.
    await pool.query("update voice_call_tasks set leased_until = $2, lease_token = $3, next_attempt_at = $4 where call_id = $1 and task_key = 'lead'",
      [c.id, new Date(Date.now() + 2 * MIN), randomUUID(), new Date(Date.now() - 1000)]);
    await crmFault("crm_projects", false);
    carrierBack();
    expect(await tasks.runCallTask(Number(t2[0].id), { now: later(0) })).toBeNull();

    // The new process's worker, once the lease has run out: everything lands.
    const s2 = await tasks.runDueCallTasks({ now: later(10 * MIN) });
    expect(s2.done).toBeGreaterThanOrEqual(2);
    await tasks.runDueCallTasks({ now: later(11 * MIN) }); // independent notification tasks from CRM delivery
    const t3 = await taskRows(c.id);
    expect(t3.every((t: any) => t.state === "done")).toBe(true);
    const row3 = await callRow(c.id);
    expect(row3.customer_id).toBe(row1.customer_id);            // the same client, found through the call
    expect(row3.project_id).toBeTruthy();
    expect(row3.lead_delivered_at).toBeTruthy();
    expect(await customers()).toBe(before.customers + 1);
    expect(await projects()).toBe(before.projects + 1);
    expect(await escalationsFor(c.id)).toBe(1);
    const esc1 = (await pool.query("select * from voice_escalations where call_id = $1", [c.id])).rows[0];
    expect(esc1.id).toBe(esc0.id);
    expect(esc1.sent_count).toBe(1);
    expect(smsTo(leadTech).length).toBe(1);
    // urgent always also reaches the owners: their bell, once
    expect(await count("select count(*)::int n from crm_notifications where org_id = $1 and type = 'call.alert.urgent'", [a.orgId])).toBe(1);

    // Everything again — the worker, a third report — changes nothing.
    await tasks.runDueCallTasks({ now: later(60 * MIN) });
    const r3 = await ic.finishCall(await loadCall(c.id), leadReport());
    expect(r3).toMatchObject({ customerId: row1.customer_id, projectId: row3.project_id, escalations: [Number(esc0.id)], delivery: { state: "done" } });
    expect(await customers()).toBe(before.customers + 1);
    expect(await projects()).toBe(before.projects + 1);
    expect(await escalationsFor(c.id)).toBe(1);
    expect(smsTo(leadTech).length).toBe(1);
  });

  it("the process dies right after acknowledging: the engine's resend (or the worker) runs the recorded work", async () => {
    const c = await makeCall(pool, a.orgId, { numberId });
    const before = { customers: await customers(), projects: await projects() };
    await expect(ic.finishCall(await loadCall(c.id), leadReport({ alerts: [{ kind: "existing_customer", summary: "Crew no-show this morning." }] }),
      { afterAck: () => { throw new Error("process killed"); } })).rejects.toThrow("process killed");
    expect((await callRow(c.id)).flags.processedAt).toBeTruthy();
    expect((await taskRows(c.id)).map((t: any) => [t.task_key, t.state, t.attempts])).toEqual([["lead", "pending", 0], ["escalation:existing_customer", "pending", 0]]);
    expect(await customers()).toBe(before.customers);

    const r = await ic.finishCall(await loadCall(c.id), leadReport());
    expect(r.delivery).toMatchObject({ state: "done" });
    expect(r.customerId).toBeTruthy();
    expect(await customers()).toBe(before.customers + 1);
    expect(await projects()).toBe(before.projects + 1);
    expect(await escalationsFor(c.id)).toBe(1);
    // the tasks are the ACKNOWLEDGED report's: a resend that differs adds nothing
    expect((await taskRows(c.id)).filter((t: any) => t.kind !== "notification").map((t: any) => t.task_key)).toEqual(["lead", "escalation:existing_customer"]);
  });

  it("an escalation insert the CRM refuses stays pending; a give-up is shown as failed and Retry now finishes it", async () => {
    const c = await makeCall(pool, a.orgId, { numberId });
    await crmFault("voice_escalations", true);
    const r = await ic.finishCall(await loadCall(c.id), leadReport({ outcome: "alerted", slots: {}, alerts: [{ kind: "existing_customer", summary: "Wants the PM." }] }));
    expect(r.outcome).toBe("alerted");
    expect(r.delivery?.state).toBe("pending");
    expect(await escalationsFor(c.id)).toBe(0);
    // Past its give-up time and still refused: failed, visibly — not silently done.
    expect(await tasks.runDueCallTasks({ now: later(3 * 24 * 60 * MIN + MIN) })).toMatchObject({ failed: 1 });
    const all = await tasks.listCallTasks(c.id);
    expect(all.map(tasks.presentCallTask)).toMatchObject([{ key: "escalation:existing_customer", state: "failed", label: "Escalation — Existing customer" }]);
    expect(tasks.deliveryStateOf(all)).toBe("failed");
    expect(await tasks.runDueCallTasks({ now: later(4 * 24 * 60 * MIN) })).toMatchObject({ due: 0 });   // failed is not retried by itself

    // The cause is fixed; someone presses Retry now.
    await crmFault("voice_escalations", false);
    expect(await tasks.rearmCallTasks(a.orgId, c.id)).toBe(1);
    const after = await tasks.runCallTasksFor(c.id);
    expect(after.map((t) => t.state)).toEqual(["done"]);
    expect(await escalationsFor(c.id)).toBe(1);
    expect(smsTo(leadTech).some((m) => /Wants the PM/.test(m.body))).toBe(true);
    // Another org cannot re-arm this call's tasks.
    expect(await tasks.rearmCallTasks("not-this-org", c.id)).toBe(0);
  });

  it("an injected exception inside lead delivery is retried with backoff and delivered once", async () => {
    const c = await makeCall(pool, a.orgId, { numberId });
    const before = await customers();
    let fail = 2;
    const deps = {
      ...tasks.realCallTaskDeps,
      deliverLead: async (args: any) => { if (fail-- > 0) throw new Error("injected: CRM unavailable"); return tasks.realCallTaskDeps.deliverLead(args); },
    };
    const r = await ic.finishCall(await loadCall(c.id), leadReport({ alerts: [] }), { deps });
    expect(r.delivery?.state).toBe("pending");
    await tasks.runDueCallTasks({ deps, now: later(31_000) });                       // second failure
    expect((await taskRows(c.id))[0]).toMatchObject({ state: "pending", attempts: 2, last_error: "injected: CRM unavailable" });
    await tasks.runDueCallTasks({ deps, now: later(5 * MIN) });                       // delivered
    expect((await taskRows(c.id))[0]).toMatchObject({ state: "done", attempts: 3, last_error: null });
    expect(await customers()).toBe(before + 1);
    await tasks.runCallTasksFor(c.id); // settle this test's independently queued notification tasks
  });

  it("two runners racing for the same due tasks: one wins each task, one client, one project, one escalation", async () => {
    const c = await makeCall(pool, a.orgId, { numberId });
    const before = { customers: await customers(), projects: await projects() };
    await expect(ic.finishCall(await loadCall(c.id), leadReport(), { afterAck: () => { throw new Error("killed"); } })).rejects.toThrow();
    const [x, y] = await Promise.all([tasks.runDueCallTasks(), tasks.runDueCallTasks()]);
    expect(x.done + y.done).toBe(2);
    expect(await customers()).toBe(before.customers + 1);
    expect(await projects()).toBe(before.projects + 1);
    expect(await escalationsFor(c.id)).toBe(1);
  });

  it("spam and quiet calls owe the CRM nothing: no tasks", async () => {
    const c = await makeCall(pool, a.orgId, { numberId });
    const r = await ic.finishCall(await loadCall(c.id), leadReport({ outcome: "spam", spam: { confidence: 0.99, reason: "robocall" }, alerts: [] }));
    expect(r.delivery).toMatchObject({ state: null, tasks: [] });
    expect(await taskRows(c.id)).toEqual([]);
  });
});

describe("the engine's explicit recording status", () => {
  it("pending from the report, then failed/missing by seq; an older status never wins; a stored recording always does", async () => {
    const { recordingInfoOf } = await import("./calls");
    const c = await makeCall(pool, a.orgId, { numberId });
    await ic.finishCall(await loadCall(c.id), leadReport({ alerts: [], outcome: "info", lead: null, slots: {} }));
    let row = await loadCall(c.id);
    expect(row.flags).toMatchObject({ recordingPending: true, recording: { state: "pending", seq: 0 } });
    expect(recordingInfoOf(row).state).toBe("pending");

    expect(await ic.applyRecordingStatus(c.id, { state: "failed", reason: "HTTP 413", seq: 2, attempts: 1 })).toBe(true);
    row = await loadCall(c.id);
    expect(recordingInfoOf(row)).toMatchObject({ state: "failed", reason: expect.stringMatching(/refused \(HTTP 413\)/) });
    expect((row.flags as any).recordingPending).toBeUndefined();
    // a late, older "pending" is ignored
    expect(await ic.applyRecordingStatus(c.id, { state: "pending", seq: 1 })).toBe(false);
    expect(recordingInfoOf(await loadCall(c.id)).state).toBe("failed");
    // a replay after the correction says pending again (newer seq) …
    expect(await ic.applyRecordingStatus(c.id, { state: "pending", reason: "replaying", seq: 3 })).toBe(true);
    expect(recordingInfoOf(await loadCall(c.id)).state).toBe("pending");
    // … and the upload lands: available, and no status can take it back
    await pool.query("update voice_calls set recording_key = 'voice/x/recordings/y.wav' where id = $1", [c.id]);
    expect(await ic.applyRecordingStatus(c.id, { state: "missing", seq: 9 })).toBe(false);
    expect(recordingInfoOf(await loadCall(c.id)).state).toBe("available");

    const lost = await makeCall(pool, a.orgId, { numberId });
    expect(await ic.applyRecordingStatus(lost.id, { state: "missing", reason: "wav gone", seq: 1 })).toBe(true);
    expect(recordingInfoOf(await loadCall(lost.id))).toMatchObject({ state: "failed", reason: expect.stringMatching(/lost/) });
  });
});

it("notification recovery never recreates CRM records or resends a successful recipient", async () => {
  const b = await makeAccount(pool, bag, { orgName: "Recipient Retry Test" });
  const first = fakePhone(), second = fakePhone();
  await setProfile(pool, b.orgId, {
    company: { name: "Recipient Retry Test" },
    leadDelivery: { crm: { enabled: true, createProject: true }, email: { enabled: true }, sms: { enabled: true, recipients: [first, second] } },
  });
  const { loadOrgVoiceContext } = await import("./org-profile");
  const { deliverLead } = await import("./leads");
  const ctx = (await loadOrgVoiceContext(b.orgId))!;
  const c = await makeCall(pool, b.orgId);
  const stale = await loadCall(c.id);
  const delivered = await deliverLead({ ctx, call: stale, slots: { first_name: "Retry test", need: "Roof inspection" } });
  const queued = await tasks.listCallTasks(c.id);
  const firstTask = queued.find(t => t.payload.recipient === first)!;
  expect(await tasks.runCallTask(firstTask.id)).toBe("done");
  carrierDown();
  await tasks.runCallTasksFor(c.id);
  const failed = (await tasks.listCallTasks(c.id)).find(t => t.payload.recipient === second)!;
  expect(failed.state).toBe("pending");
  expect(failed.lastError).toBeTruthy();
  // A stale mid-call request cannot enqueue a second plan or create another project.
  const repeated = await deliverLead({ ctx, call: stale });
  expect(repeated).toMatchObject({ customerId: delivered.customerId, projectId: delivered.projectId, alreadyDelivered: true });
  carrierBack();
  await tasks.rearmCallTasks(b.orgId, c.id);
  expect((await tasks.runCallTasksFor(c.id)).every(t => t.state === "done")).toBe(true);
  expect(smsTo(first)).toHaveLength(1);
  expect(smsTo(second)).toHaveLength(1);
  expect(await count("select count(*)::int n from crm_customers where org_id = $1", [b.orgId])).toBe(1);
  expect(await count("select count(*)::int n from crm_projects where org_id = $1", [b.orgId])).toBe(1);
});
