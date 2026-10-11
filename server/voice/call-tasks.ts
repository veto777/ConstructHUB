/**
 * The post-call CRM work of one call, as durable tasks (Codex score-4, lane A). OWNER: calls+crm lane.
 *
 * Before: the end report ran lead delivery and escalations inline, caught their failures, and then marked the call
 * processed — a retried report got the stored result back, so a failed lead or escalation stayed undone for good.
 * Now the report decides WHAT must happen (one task per effect) and writes those tasks in the same transaction that
 * acknowledges it (internal-calls.ts acknowledgeCall). Only then does anything run:
 *
 *   lead                 → deliverLead (leads.ts): client/project and the durable notification plan
 *   notification:<channel>:<recipient> → one independent recipient delivery
 *   escalation:<kind>    → raiseEscalation(strict) (escalations.ts): the rule's text/email and/or the owners' alert
 *
 * Idempotency: (call_id, task_key) is unique, so a repeated report never adds a task twice. Each effect is safe to
 * run again: the client and the call's link to it commit together, as do the project and its link (leads.ts), and
 * an escalation is one row per (call, kind) with a unique index (schema.ts) — a retry finishes what is missing and
 * never files a second client, project or escalation.
 *
 * Execution: the report's own request runs its tasks right after acknowledging (the happy path stays synchronous);
 * whatever fails stays `pending` with backoff (30 s doubling to 30 min) and the worker below retries it every
 * minute, also after a restart (a task leased by a process that died is taken over once its lease runs out). A
 * task still failing at its give-up time (3 days) becomes `failed` — shown in the console with "Retry now"
 * (POST /api/crm/voice/calls/:id/delivery/retry), which re-arms it for another day and returns; the worker sends it. A call or org that no longer
 * exists fails the task at once.
 */
import { randomUUID } from "crypto";
import { db, pool } from "../db";
import { voiceCalls, type VoiceCallRow } from "@shared/schema";
import { eq, sql } from "drizzle-orm";
import { loadOrgVoiceContext, findVoiceNumber } from "./org-profile";
import { deliverLead, deliverLeadNotification } from "./leads";
import { raiseEscalation, isEscalationKind, kindLabel } from "./escalations";
import { recordFailure } from "../ops/issues";

export type CallTaskKind = "lead" | "escalation" | "notification";
export type CallTaskState = "pending" | "done" | "failed";
export type CallTaskSpec = { key: string; kind: CallTaskKind; payload: Record<string, unknown> };
export type CallTask = {
  id: number; callId: string; orgId: string; kind: CallTaskKind; key: string; payload: Record<string, unknown>;
  state: CallTaskState; attempts: number; lastError: string | null; result: Record<string, unknown> | null;
  nextAttemptAt: Date; giveUpAt: Date | null; leasedUntil: Date | null; createdAt: Date; doneAt: Date | null;
};

/** The effects a task runs — the real ones by default; a test wraps them to inject failures. */
export type CallTaskDeps = { deliverLead: typeof deliverLead; raiseEscalation: typeof raiseEscalation };
export const realCallTaskDeps: CallTaskDeps = { deliverLead, raiseEscalation };
export type CallTaskOpts = { deps?: CallTaskDeps; now?: () => Date };

export const LEAD_TASK_KEY = "lead";
export const TASK_BASE_DELAY_MS = 30_000;
export const TASK_MAX_DELAY_MS = 30 * 60_000;
export const TASK_GIVE_UP_MS = 3 * 24 * 3600_000;
/** "Retry now" on a failed task re-arms it for this long before it gives up again. */
export const TASK_MANUAL_RETRY_MS = 24 * 3600_000;
export const TASK_LEASE_MS = 2 * 60_000;
export const TASK_WORKER_EVERY_MS = 60_000;

export const leadTaskSpec = (): CallTaskSpec => ({ key: LEAD_TASK_KEY, kind: "lead", payload: {} });
export function escalationTaskSpec(kind: string, summary: string): CallTaskSpec {
  const k = isEscalationKind(kind) ? kind : "other";   // the key raiseEscalation dedupes on
  return { key: `escalation:${k}`, kind: "escalation", payload: { kind: k, summary: String(summary ?? "").slice(0, 600) } };
}

/** Wait before attempt `attempts + 1`: 30 s, 60 s, 2 min … capped at 30 min. */
export function nextDelayMs(attempts: number): number {
  return Math.min(TASK_MAX_DELAY_MS, TASK_BASE_DELAY_MS * 2 ** Math.max(0, attempts - 1));
}

/** A task that can never succeed (its call or org is gone): failed at once, not retried. */
export class PermanentTaskError extends Error {}

type Queryable = { query: (text: string, values?: unknown[]) => Promise<{ rows: any[] }> };

/** Insert the call's tasks (inside the acknowledging transaction); a task that already exists is left alone. */
export async function insertCallTasks(q: Queryable, callId: string, orgId: string, specs: CallTaskSpec[], now = new Date()): Promise<void> {
  const giveUp = new Date(now.getTime() + TASK_GIVE_UP_MS);
  for (const s of specs) {
    await q.query(
      `INSERT INTO voice_call_tasks (call_id, org_id, kind, task_key, payload, next_attempt_at, give_up_at, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $6, $6) ON CONFLICT (call_id, task_key) DO NOTHING`,
      [callId, orgId, s.kind, s.key, JSON.stringify(s.payload), now, giveUp]);
  }
}

const asDate = (v: unknown): Date | null => (v == null ? null : v instanceof Date ? v : new Date(String(v)));
function fromRow(r: any): CallTask {
  return {
    id: Number(r.id), callId: r.call_id, orgId: r.org_id, kind: r.kind, key: r.task_key, payload: r.payload ?? {},
    state: r.state, attempts: Number(r.attempts ?? 0), lastError: r.last_error ?? null, result: r.result ?? null,
    nextAttemptAt: asDate(r.next_attempt_at)!, giveUpAt: asDate(r.give_up_at), leasedUntil: asDate(r.leased_until),
    createdAt: asDate(r.created_at)!, doneAt: asDate(r.done_at),
  };
}

export async function listCallTasks(callId: string, q: Queryable = pool): Promise<CallTask[]> {
  const { rows } = await q.query("SELECT * FROM voice_call_tasks WHERE call_id = $1 ORDER BY id", [callId]);
  return rows.map(fromRow);
}

/** Take one due task under a lease (one runner per task, across processes); null when it is not ours to run. */
async function claimTask(id: number, now: Date): Promise<{ task: CallTask; token: string } | null> {
  const token = randomUUID();
  const { rows } = await pool.query(
    `UPDATE voice_call_tasks SET leased_until = $3, lease_token = $2, attempts = attempts + 1, updated_at = $4
      WHERE id = $1 AND state = 'pending' AND next_attempt_at <= $4 AND (leased_until IS NULL OR leased_until < $4)
      RETURNING *`,
    [id, token, new Date(now.getTime() + TASK_LEASE_MS), now]);
  return rows[0] ? { task: fromRow(rows[0]), token } : null;
}

async function completeTask(id: number, token: string, result: Record<string, unknown>, now: Date): Promise<void> {
  await pool.query(
    `UPDATE voice_call_tasks SET state = 'done', result = $3::jsonb, last_error = NULL, done_at = $4, leased_until = NULL, lease_token = NULL, updated_at = $4
      WHERE id = $1 AND lease_token = $2`,
    [id, token, JSON.stringify(result), now]);
}

async function failAttempt(task: CallTask, token: string, err: unknown, now: Date): Promise<CallTaskState> {
  const message = String((err as any)?.message || err).slice(0, 500);
  const giveUp = err instanceof PermanentTaskError || (task.giveUpAt != null && now.getTime() >= task.giveUpAt.getTime());
  const state: CallTaskState = giveUp ? "failed" : "pending";
  await pool.query(
    `UPDATE voice_call_tasks SET state = $3, last_error = $4, result = NULL, next_attempt_at = $5, leased_until = NULL, lease_token = NULL, updated_at = $6
      WHERE id = $1 AND lease_token = $2`,
    [task.id, token, state, message, new Date(now.getTime() + nextDelayMs(task.attempts)), now]);
  return state;
}

async function mergeFlags(callId: string, patch: Record<string, unknown>): Promise<void> {
  await db.execute(sql`update voice_calls set flags = coalesce(flags, '{}'::jsonb) || ${JSON.stringify(patch)}::jsonb where id = ${callId}`);
}

/** Run one claimed task's effect against the call as it is NOW (fresh row: an earlier attempt may have linked a client). */
async function perform(task: CallTask, deps: CallTaskDeps, now: Date): Promise<Record<string, unknown>> {
  const [call] = await db.select().from(voiceCalls).where(eq(voiceCalls.id, task.callId)).limit(1);
  if (!call) throw new PermanentTaskError("the call no longer exists");
  const ctx = await loadOrgVoiceContext(call.orgId);
  if (!ctx) throw new PermanentTaskError("the CRM organization no longer exists");
  if (task.kind === "notification") {
    try { await deliverLeadNotification(ctx, call.id, task.payload); }
    catch (e: any) {
      if (e?.ambiguous) throw new PermanentTaskError(`Delivery outcome unknown: ${e.message}. Check with the recipient before retrying.`);
      throw e;
    }
    return { channel: task.payload.channel, recipient: task.payload.recipient };
  }
  if (task.kind === "lead") {
    const number = call.numberId ? await findVoiceNumber({ numberId: call.numberId }) : null;
    const d = await deps.deliverLead({ ctx, call: call as VoiceCallRow, slots: call.slots ?? {}, numberLabel: number?.label ?? null });
    await mergeFlags(call.id, d.alreadyDelivered ? { lead: call.slots ?? {} } : { lead: call.slots ?? {}, notified: d.notified });
    return { customerId: d.customerId, projectId: d.projectId, created: d.created };
  }
  const kind = String(task.payload.kind ?? "other");
  const r = await deps.raiseEscalation({ ctx, call: call as VoiceCallRow, kind, summary: String(task.payload.summary ?? ""), slots: call.slots, strict: true });
  return { escalationId: r.escalationId, fallback: r.fallback };
}

/** Claim and run one task. Returns its state afterwards, or null when another runner holds it / it is not due. */
export async function runCallTask(id: number, opts: CallTaskOpts = {}): Promise<CallTaskState | null> {
  const deps = opts.deps ?? realCallTaskDeps;
  const now = opts.now ?? (() => new Date());
  const claimed = await claimTask(id, now());
  if (!claimed) return null;
  const { task, token } = claimed;
  try {
    if (task.kind === "notification" && task.payload.channel !== "inApp") {
      if (task.result?.sending) throw new PermanentTaskError("Delivery outcome unknown after interrupted send; check with the recipient before retrying.");
      // This marker survives a crash and a lease expiry, including retries that already have lastError.
      // Never automatically resend an external message whose acceptance could not be recorded.
      const marked = await pool.query("UPDATE voice_call_tasks SET result = '{\"sending\":true}'::jsonb WHERE id = $1 AND lease_token = $2 RETURNING id", [task.id, token]);
      if (!marked.rows.length) return null;
    }
    const result = await perform(task, deps, now());
    try { await completeTask(task.id, token, result, now()); }
    catch (e) {
      if (task.kind === "notification") throw new PermanentTaskError("Message sent but confirmation could not be saved. Check with recipient before retrying.");
      throw e;
    }
    return "done";
  } catch (e: any) {
    const state = await failAttempt(task, token, e, now());
    console.error(`[voice] call task ${task.key} for call ${task.callId} failed (attempt ${task.attempts}, now ${state}):`, e?.message || e);
    if (state === "failed" || task.attempts === 1) {
      void recordFailure("call_assistant", task.kind === "lead" ? "Call Assistant lead delivery" : task.kind === "notification" ? "Call Assistant notification" : "Call Assistant escalation", e,
        { callId: task.callId, orgId: task.orgId, task: task.key, attempts: task.attempts, state });
    }
    return state;
  }
}

/** Run every due task of one call (the report's own request, a repeated report); returns all its tasks. */
export async function runCallTasksFor(callId: string, opts: CallTaskOpts = {}): Promise<CallTask[]> {
  const now = opts.now ?? (() => new Date());
  const { rows } = await pool.query(
    "SELECT id FROM voice_call_tasks WHERE call_id = $1 AND state = 'pending' AND next_attempt_at <= $2 ORDER BY id", [callId, now()]);
  for (const r of rows) await runCallTask(Number(r.id), opts);
  // CRM delivery can add recipient tasks. Run those new tasks once on this report's happy path.
  const seen = new Set(rows.map(r => Number(r.id)));
  for (const task of await listCallTasks(callId)) if (!seen.has(task.id) && task.kind === "notification") await runCallTask(task.id, opts);
  return listCallTasks(callId);
}

export type CallTaskSweep = { due: number; done: number; pending: number; failed: number; skipped: number };

/** The worker's pass: every due task of every call (a leased one only once its lease ran out, e.g. after a crash). */
export async function runDueCallTasks(opts: CallTaskOpts & { limit?: number } = {}): Promise<CallTaskSweep> {
  const now = opts.now ?? (() => new Date());
  const t = now();
  const { rows } = await pool.query(
    `SELECT id FROM voice_call_tasks WHERE state = 'pending' AND next_attempt_at <= $1 AND (leased_until IS NULL OR leased_until < $1)
      ORDER BY next_attempt_at, id LIMIT $2`, [t, opts.limit ?? 200]);
  const out: CallTaskSweep = { due: rows.length, done: 0, pending: 0, failed: 0, skipped: 0 };
  for (const r of rows) {
    const s = await runCallTask(Number(r.id), opts);
    if (s === null) out.skipped++; else out[s]++;
  }
  return out;
}

/** "Retry now" from the console: failed and waiting tasks of one call become due immediately (failed ones re-armed for a day). */
export async function rearmCallTasks(orgId: string, callId: string, now = new Date()): Promise<number> {
  const { rows } = await pool.query(
    `UPDATE voice_call_tasks
        SET state = 'pending', next_attempt_at = $3, updated_at = $3,
            give_up_at = CASE WHEN state = 'failed' OR give_up_at IS NULL OR give_up_at < $4 THEN $4 ELSE give_up_at END
      WHERE org_id = $1 AND call_id = $2 AND state IN ('pending', 'failed') RETURNING id`,
    [orgId, callId, now, new Date(now.getTime() + TASK_MANUAL_RETRY_MS)]);
  return rows.length;
}

// ── presentation ─────────────────────────────────────────────────────────────

export type DeliveryState = "pending" | "failed" | "done";
export type CallTaskView = {
  id: number; key: string; kind: CallTaskKind; label: string;
  /** retrying = pending after at least one failed attempt. */
  state: "pending" | "retrying" | "failed" | "done";
  attempts: number; lastError: string | null; nextAttemptAt: string | null; giveUpAt: string | null; doneAt: string | null;
};

export function presentCallTask(t: CallTask): CallTaskView {
  const label = t.kind === "notification" ? `${t.payload.channel === "inApp" ? "In-app" : String(t.payload.channel).toUpperCase()} — ${t.payload.recipient}` : t.kind === "lead" ? "Client and project in your CRM" : `Escalation — ${kindLabel(String(t.payload.kind ?? "other"))}`;
  const state = t.state === "pending" && t.attempts > 0 && t.lastError ? "retrying" : t.state;
  return {
    id: t.id, key: t.key, kind: t.kind, label, state, attempts: t.attempts, lastError: t.lastError,
    nextAttemptAt: t.state === "pending" ? t.nextAttemptAt.toISOString() : null,
    giveUpAt: t.giveUpAt ? t.giveUpAt.toISOString() : null, doneAt: t.doneAt ? t.doneAt.toISOString() : null,
  };
}

/** One state for a call's whole delivery: failed beats pending beats done; null when the call had nothing to deliver. */
export function deliveryStateOf(tasks: Pick<CallTask, "state">[]): DeliveryState | null {
  if (!tasks.length) return null;
  if (tasks.some((t) => t.state === "failed")) return "failed";
  if (tasks.some((t) => t.state === "pending")) return "pending";
  return "done";
}

// ── the worker ───────────────────────────────────────────────────────────────

let worker: NodeJS.Timeout | null = null;
const health: { lastRunAt: Date | null; lastOk: boolean | null } = { lastRunAt: null, lastOk: null };

/**
 * Why the delivery worker is off, or null when it runs. Unlike the reminder loop this is correctness, not a
 * feature: it runs on every server (a lane too) unless VOICE_CALL_TASK_WORKER_ENABLED=false, and never in tests.
 */
export function callTaskWorkerOffReason(env: NodeJS.ProcessEnv = process.env): string | null {
  if (env.VOICE_CALL_TASK_WORKER_ENABLED === "false") return "VOICE_CALL_TASK_WORKER_ENABLED is false";
  if (env.NODE_ENV === "test" || env.VITEST) return "tests drive the worker themselves";
  return null;
}

export type CallTaskWorkerStatus = { running: boolean; intervalSeconds: number; lastRunAt: string | null; lastOk: boolean | null };
export function callTaskWorkerStatus(): CallTaskWorkerStatus {
  return { running: worker !== null, intervalSeconds: TASK_WORKER_EVERY_MS / 1000, lastRunAt: health.lastRunAt?.toISOString() ?? null, lastOk: health.lastOk };
}

export function startVoiceCallTaskWorker(): boolean {
  if (worker) return true;
  const off = callTaskWorkerOffReason();
  if (off) {
    console.log(`[voice] call delivery worker off: ${off}`);
    return false;
  }
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      const r = await runDueCallTasks();
      health.lastRunAt = new Date(); health.lastOk = r.failed === 0;
      if (r.due) console.log(`[voice] call delivery: ${JSON.stringify(r)}`);
    } catch (e: any) {
      health.lastRunAt = new Date(); health.lastOk = false;
      console.error("[voice] call delivery worker failed:", e?.message || e);
      void recordFailure("job", "Call Assistant delivery worker", e);
    } finally { running = false; }
  };
  worker = setInterval(run, TASK_WORKER_EVERY_MS);
  worker.unref();
  setTimeout(run, 20_000).unref();
  console.log("[voice] call delivery worker on (every 60 s)");
  return true;
}
