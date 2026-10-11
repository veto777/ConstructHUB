/**
 * engine → app: call lifecycle, mid-call events and recordings
 * (SPEC.md § Internal API → calls / events / recordings). OWNER: calls+crm lane.
 *
 * Everything the engine reports lands here; THIS side runs lead delivery
 * (leads.ts), escalations (escalations.ts), the spam ledger (spam.ts) and
 * usage (usage.ts) — the engine never touches Postgres. Idempotent on
 * callSid: SignalWire and the engine may both report an ending, and a retried
 * end report never delivers a lead or texts a person twice. The latch is
 * atomic: `flags.processingAt` is claimed with one conditional UPDATE (a
 * concurrent duplicate answers 409 call_in_progress and the engine retries),
 * `flags.processedAt` + `flags.result` are written at the end, and a retry
 * after that just gets the stored result back.
 *
 * The CRM work a report asks for (the lead → client + project, each escalation) is not run before the
 * acknowledgement any more: it becomes durable tasks (call-tasks.ts) written in the SAME transaction as
 * `processedAt`, then runs; a failure stays pending and the delivery worker retries it, so an acknowledged
 * report can never leave a lead or an escalation undone (Codex score-4 lane A). A repeated report answers the
 * stored result with the tasks' current state and nudges whatever is still due.
 *
 * Every write to the JSON columns merges in SQL (`flags || patch`,
 * `events || [event]`, `slots || patch`) so a status callback, a mid-call
 * event and the end report never overwrite each other's keys.
 */
import type { Express, Request, Response } from "express";
import express from "express";
import { z } from "zod";
import { db, pool } from "../db";
import { voiceCalls, type VoiceCallRow, type VoiceTranscriptTurn, type VoiceCallEvent } from "@shared/schema";
import { and, eq, sql } from "drizzle-orm";
import { CALL_OUTCOMES, ESCALATION_KINDS, type CallOutcome } from "@shared/voice-profile";
import { requireVoiceInternal, VOICE_INTERNAL_PATH } from "./internal-auth";
import { loadOrgVoiceContext, findVoiceNumber } from "./org-profile";
import { deliverLead, callSummaryTaskSpecs } from "./leads";
import { raiseEscalation } from "./escalations";
import {
  insertCallTasks, leadTaskSpec, escalationTaskSpec, runCallTasksFor, listCallTasks, deliveryStateOf, startVoiceCallTaskWorker,
  type CallTaskSpec, type CallTaskOpts, type CallTask, type DeliveryState,
} from "./call-tasks";
import { recordSpamVerdict, recordBlockedCall, callerSpamStatus, spamConfidenceWithFloor } from "./spam";
import { meterCallUsage, billedMinutesFor } from "./usage";
import { putRecording, recordingsConfigured } from "./recordings";
import { recordingStateOf } from "./calls";
import { recordActivity } from "../crm/activity";
import { recordFailure } from "../ops/issues";
import { recordCallReportIssues } from "../ops/call-assistant";
import { settleSupportCall } from "../support/limits";

/** A 15-minute 8 kHz mono WAV is ~14 MB; cap recordings well under the app's 50 MB JSON limit. */
export const RECORDING_MAX_BYTES = 40 * 1024 * 1024;
/** A hang-up / voicemail shorter than this never notifies anyone (SPEC § 10). */
export const QUIET_CALL_SECONDS = 8;

const e164 = z.string().regex(/^\+[1-9]\d{6,14}$/);
/** SignalWire/Twilio call sids are `CA` + 32 hex; the simulator and tests use other word-ish ids. */
export const CALL_SID_RE = /^[A-Za-z0-9_-]{4,64}$/;
const sid = z.string().regex(CALL_SID_RE);
const slots = z.record(z.string().max(60), z.string().max(500));
const isoDate = z.string().datetime({ offset: true }).or(z.string().regex(/^\d{4}-\d{2}-\d{2}T/));

const startSchema = z.object({
  callSid: sid,
  to: e164.optional(),
  from: e164.or(z.literal("")).or(z.string().max(40)).optional(),
  numberId: z.string().max(64).optional(),
  startedAt: isoDate.optional(),
  engine: z.string().max(40).optional(),
  model: z.string().max(120).optional(),
  persona: z.string().max(40).optional(),
  profileVersion: z.number().int().nullable().optional(),
});

const transcriptTurn = z.object({ role: z.enum(["caller", "assistant", "system"]), text: z.string().max(4000), t: z.string().max(40).optional() });
const callEvent = z.object({ t: z.string().max(40).optional(), type: z.string().max(40) }).passthrough();

export const endReportSchema = startSchema.omit({ callSid: true }).extend({
  endedAt: isoDate.optional(),
  answeredAt: isoDate.optional(),
  durationSeconds: z.number().min(0).max(24 * 3600).default(0),
  outcome: z.enum(CALL_OUTCOMES).default("hangup"),
  summary: z.string().max(4000).nullable().optional(),
  transcript: z.array(transcriptTurn).max(2000).default([]),
  slots: slots.default({}),
  events: z.array(callEvent).max(500).default([]),
  caller: z.object({
    name: z.string().max(200).nullable().optional(), email: z.string().max(200).nullable().optional(),
    address: z.string().max(300).nullable().optional(), city: z.string().max(120).nullable().optional(),
  }).optional(),
  serviceNeeded: z.string().max(300).nullable().optional(),
  spam: z.object({ confidence: z.number().min(0).max(1), reason: z.string().max(300).default("") }).nullable().optional(),
  lead: z.object({ requested: z.boolean().default(true) }).nullable().optional(),
  alerts: z.array(z.object({ kind: z.string().max(40), summary: z.string().max(600).default("") })).max(20).default([]),
  /** The engine has a recording for this call and will upload it (its outbox retries until it lands): the call
   *  shows "Recording pending" until POST /recordings/:sid clears the flag (voice/outbox.py). */
  recordingPending: z.boolean().optional(),
});
export type EndReport = z.infer<typeof endReportSchema>;

const eventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("alert"), kind: z.enum(ESCALATION_KINDS).or(z.string().max(40)), summary: z.string().max(600).default(""), slots: slots.optional() }),
  z.object({ type: z.literal("lead"), slots: slots.default({}), summary: z.string().max(4000).optional() }),
]);

const statusSchema = z.object({ callSid: sid, callStatus: z.string().max(40), duration: z.coerce.number().min(0).optional(), from: z.string().max(40).optional(), to: z.string().max(40).optional() });

const bad = (res: Response, issues: unknown) => res.status(400).json({ code: "invalid", issues });
const asDate = (s?: string | null) => (s ? new Date(s) : null);

export type FinishResult = {
  callId: string; outcome: CallOutcome; customerId: string | null; projectId: string | null; blocked: boolean; escalations: number[];
  /** The post-call CRM work (call-tasks.ts): null when the call asked for none. */
  delivery?: { state: DeliveryState | null; tasks: { key: string; state: CallTask["state"]; attempts: number }[] };
};

/** Test seams for finishCall: the task effects and clock, and a hook right after the acknowledgement commits
 *  (a test throws there to simulate the process dying between acknowledging and running the work). */
export type FinishOpts = CallTaskOpts & { afterAck?: () => unknown };

async function loadCall(callSid: string): Promise<VoiceCallRow | null> {
  const [row] = await db.select().from(voiceCalls).where(eq(voiceCalls.callSid, callSid)).limit(1);
  return row ?? null;
}

/** Create-or-touch the row at call start. `null` when the `to` number is nobody's. */
export async function upsertCallStart(body: z.infer<typeof startSchema>): Promise<VoiceCallRow | null> {
  const number = await findVoiceNumber({ numberId: body.numberId, to: body.to });
  const existing = await loadCall(body.callSid);
  if (!number && !existing) return null;
  const orgId = existing?.orgId ?? number!.orgId;
  const [row] = await db.insert(voiceCalls).values({
    orgId, numberId: number?.id ?? null, callSid: body.callSid,
    fromNumber: body.from || null, toNumber: body.to ?? number?.phoneNumber ?? null,
    engine: body.engine ?? null, model: body.model ?? null, persona: body.persona ?? null,
    profileVersion: body.profileVersion ?? null,
    startedAt: asDate(body.startedAt) ?? new Date(), answeredAt: new Date(),
  }).onConflictDoUpdate({
    target: voiceCalls.callSid,
    set: {
      // A second start report (engine retry) fills gaps; it never blanks what the first one said.
      fromNumber: sql`coalesce(${body.from || null}, ${voiceCalls.fromNumber})`,
      engine: sql`coalesce(${body.engine ?? null}, ${voiceCalls.engine})`,
      model: sql`coalesce(${body.model ?? null}, ${voiceCalls.model})`,
      persona: sql`coalesce(${body.persona ?? null}, ${voiceCalls.persona})`,
      profileVersion: sql`coalesce(${body.profileVersion ?? null}::integer, ${voiceCalls.profileVersion})`,
      answeredAt: sql`coalesce(${voiceCalls.answeredAt}, now())`,
    },
  }).returning();
  return row;
}

/** A duplicate end report while the first is still being processed: the engine retries later. */
export class CallInProgressError extends Error {
  readonly code = "call_in_progress";
  constructor() { super("This call's end report is already being processed."); }
}

/** A claim older than this is a crashed run; the next report may take over. */
const CLAIM_STALE_MS = 2 * 60 * 1000;

/** One conditional UPDATE: exactly one end report gets to run the post-call work. */
async function claimCall(callId: string): Promise<"claimed" | "processed" | "busy"> {
  const now = new Date();
  const claimed = await db.execute(sql`
    update voice_calls
       set flags = coalesce(flags, '{}'::jsonb) || jsonb_build_object('processingAt', ${now.toISOString()}::text)
     where id = ${callId}
       and coalesce(flags->>'processedAt', '') = ''
       and (flags->>'processingAt' is null or (flags->>'processingAt')::timestamptz < ${new Date(now.getTime() - CLAIM_STALE_MS).toISOString()}::timestamptz)
     returning id`);
  if (claimed.rows.length) return "claimed";
  const [row] = await db.select({ flags: voiceCalls.flags }).from(voiceCalls).where(eq(voiceCalls.id, callId)).limit(1);
  return (row?.flags as Record<string, unknown> | null)?.processedAt ? "processed" : "busy";
}

/** What acknowledging a call needs of a pool: a client for its transaction (a test hands in a failing one). */
export type AckPool = { connect(): Promise<{ query: (text: string, values?: unknown[]) => Promise<{ rows: any[] }>; release(err?: Error): void }> };

/**
 * Acknowledge a processed call: its durable CRM tasks (voice_call_tasks: the lead, each escalation; a repeat is a
 * no-op), its durable meter task (a `voice_call_meter` row, pending; a repeat is a no-op), the outcome and minutes
 * on the call row (what the retry worker recovers from), and the processed flag — in ONE transaction, so the flag
 * never exists without the tasks. Throws when the write fails: the call stays unprocessed and the engine retries.
 */
export async function acknowledgeCall(a: { callId: string; orgId: string; accountUserId: number; outcome: string | null; billedMinutes: number; at: Date; patch: Record<string, unknown>; tasks?: CallTaskSpec[]; now?: Date }, p: AckPool = pool): Promise<void> {
  const client = await p.connect();
  try {
    await client.query("BEGIN");
    // The CRM work first: the processed flag below never exists without every task it promises.
    if (a.tasks?.length) await insertCallTasks(client, a.callId, a.orgId, a.tasks, a.now ?? new Date());
    await client.query(
      `INSERT INTO voice_call_meter (call_id, org_id, account_user_id, outcome, billed_minutes, started_at, state)
       VALUES ($1, $2, $3, $4, $5, $6, 'pending') ON CONFLICT (call_id) DO NOTHING`,
      [a.callId, a.orgId, a.accountUserId, a.outcome, a.billedMinutes, a.at]);
    await client.query(
      `UPDATE voice_calls SET outcome = $2, billed_minutes = $3, flags = (coalesce(flags, '{}'::jsonb) - 'processingAt') || $4::jsonb WHERE id = $1`,
      [a.callId, a.outcome, a.billedMinutes, JSON.stringify(a.patch)]);
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

/** Merge keys into voice_calls.flags in SQL (never a read-modify-write of the whole object). */
export async function mergeCallFlags(callId: string, patch: Record<string, unknown>, opts: { dropKeys?: string[] } = {}): Promise<void> {
  let base = sql`coalesce(flags, '{}'::jsonb)`;
  for (const k of opts.dropKeys ?? []) base = sql`(${base} - ${k}::text)`;
  await db.execute(sql`update voice_calls set flags = ${base} || ${JSON.stringify(patch)}::jsonb where id = ${callId}`);
}

/** Append one event to voice_calls.events in SQL. App-side events carry detail.source = "app". */
export async function appendCallEvent(callId: string, type: string, detail: Record<string, unknown>): Promise<VoiceCallEvent> {
  const ev: VoiceCallEvent = { t: new Date().toISOString(), type, detail: { ...detail, source: "app" } };
  await db.execute(sql`update voice_calls set events = coalesce(events, '[]'::jsonb) || ${JSON.stringify([ev])}::jsonb where id = ${callId}`);
  return ev;
}

const isAppEvent = (e: VoiceCallEvent) => (e.detail as Record<string, unknown> | undefined)?.source === "app";

/**
 * The end-of-call report: store it, then run everything that happens after a
 * call (SPEC § 10–12). Exported so tests drive it without HTTP. Throws
 * CallInProgressError when another report for the same call is mid-flight.
 */
export async function finishCall(callIn: VoiceCallRow, report: EndReport, opts: FinishOpts = {}): Promise<FinishResult> {
  const claim = await claimCall(callIn.id);
  if (claim === "busy") throw new CallInProgressError();
  if (claim === "processed") {
    // Acknowledged before: whatever CRM work is still due runs now (the worker would get to it anyway).
    await runCallTasksFor(callIn.id, opts).catch((e: any) => console.error("[voice] call tasks on a repeated report failed:", e?.message || e));
    return currentFinishResult(callIn.id);
  }
  let acknowledged = false;
  try {
    return await processFinishedCall(callIn.id, report, opts, () => { acknowledged = true; });
  } catch (e) {
    // Let the engine's retry run the work again instead of waiting out the stale window. (After the
    // acknowledgement there is nothing to drop: the tasks are durable and the worker finishes them.)
    if (!acknowledged) await mergeCallFlags(callIn.id, {}, { dropKeys: ["processingAt"] }).catch(() => {});
    throw e;
  }
}

/** The stored result of an acknowledged call, brought up to date with its client/project and its tasks' states. */
export async function currentFinishResult(callId: string): Promise<FinishResult> {
  const [row] = await db.select().from(voiceCalls).where(eq(voiceCalls.id, callId)).limit(1);
  const stored = ((row?.flags as Record<string, unknown> | null)?.result ?? {}) as FinishResult;
  const tasks = await listCallTasks(callId);
  return withDelivery({ ...stored, callId, customerId: row?.customerId ?? stored.customerId ?? null, projectId: row?.projectId ?? stored.projectId ?? null }, tasks);
}

function withDelivery(result: FinishResult, tasks: CallTask[]): FinishResult {
  const escalations = new Set(result.escalations ?? []);
  for (const t of tasks) {
    const id = (t.result as { escalationId?: number | null } | null)?.escalationId;
    if (t.kind === "escalation" && typeof id === "number") escalations.add(id);
  }
  const lead = tasks.find((t) => t.kind === "lead" && t.state === "done")?.result as { customerId?: string; projectId?: string | null } | undefined;
  return {
    ...result,
    customerId: lead?.customerId ?? result.customerId ?? null,
    projectId: lead?.projectId ?? result.projectId ?? null,
    escalations: [...escalations],
    delivery: { state: deliveryStateOf(tasks), tasks: tasks.map((t) => ({ key: t.key, state: t.state, attempts: t.attempts })) },
  };
}

async function processFinishedCall(callId: string, report: EndReport, opts: FinishOpts, onAck: () => void): Promise<FinishResult> {
  // Re-read after the claim: a mid-call event may have delivered the lead in the meantime.
  const [call] = await db.select().from(voiceCalls).where(eq(voiceCalls.id, callId)).limit(1);
  if (!call) throw new Error("call gone");
  const ctx = await loadOrgVoiceContext(call.orgId);
  if (!ctx) throw new Error("org gone");
  const { profile } = ctx;
  const patch: Record<string, unknown> = {};
  const tasks: CallTaskSpec[] = [];

  // Spam decides everything else: a spam call notifies nobody and files nothing.
  let outcome: CallOutcome = report.outcome;
  const spam = report.spam ?? null;
  const isSpam = outcome !== "blocked" && (outcome === "spam" || (!!spam && spam.confidence >= ctx.spam.flagAt));
  if (isSpam) outcome = "spam";
  const durationSeconds = Math.round(report.durationSeconds);
  const billedMinutes = outcome === "blocked" ? 0 : billedMinutesFor(durationSeconds);
  // The engine's event list is the record; the app's own entries (status callbacks, mid-call deliveries) are kept.
  const events = [...(report.events as VoiceCallEvent[]), ...((call.events ?? []) as VoiceCallEvent[]).filter(isAppEvent)];

  const [row] = await db.update(voiceCalls).set({
    fromNumber: report.from || call.fromNumber, toNumber: report.to ?? call.toNumber,
    engine: report.engine ?? call.engine, model: report.model ?? call.model, persona: report.persona ?? call.persona,
    profileVersion: report.profileVersion ?? call.profileVersion ?? ctx.version,
    answeredAt: asDate(report.answeredAt) ?? call.answeredAt,
    endedAt: asDate(report.endedAt) ?? new Date(),
    durationSeconds, billedMinutes, outcome,
    callerName: report.caller?.name ?? report.slots.first_name ?? call.callerName ?? null,
    callerEmail: report.caller?.email ?? report.slots.email ?? call.callerEmail ?? null,
    callerAddress: report.caller?.address ?? report.slots.address ?? call.callerAddress ?? null,
    callerCity: report.caller?.city ?? report.slots.city ?? call.callerCity ?? null,
    serviceNeeded: report.serviceNeeded ?? report.slots.need ?? call.serviceNeeded ?? null,
    summary: report.summary ?? call.summary ?? null,
    transcript: report.transcript as VoiceTranscriptTurn[],
    slots: { ...(call.slots ?? {}), ...report.slots },
    events,
    spamConfidence: spam ? spam.confidence.toFixed(2) : call.spamConfidence,
    spamReason: spam?.reason || call.spamReason || null,
  }).where(eq(voiceCalls.id, call.id)).returning();

  const result: FinishResult = { callId: row.id, outcome, customerId: row.customerId ?? null, projectId: row.projectId ?? null, blocked: false, escalations: [] };
  const actor = `${ctx.assistantName} (Call Assistant)`;

  if (outcome === "blocked") {
    await recordBlockedCall(ctx.org.id, row.fromNumber, row.id);
    result.blocked = true;
  } else if (isSpam) {
    // No confidence from the engine = flagged, not "near-certain": a strike needs the number.
    const callerSaid = (report.transcript as VoiceTranscriptTurn[]).filter((t) => t.role === "caller").map((t) => t.text).join(" ");
    const confidence = spamConfidenceWithFloor(spam?.confidence ?? ctx.spam.flagAt, ctx.spam.strikeAt, spam?.reason, callerSaid);
    const verdict = await recordSpamVerdict({ orgId: ctx.org.id, from: row.fromNumber, confidence, reason: spam?.reason || "flagged by the assistant", callId: row.id, strikeAt: ctx.spam.strikeAt });
    result.blocked = verdict?.blocked ?? false;
    patch.spam = verdict;
    recordActivity({ orgId: ctx.org.id, actorLabel: actor, action: "call.spam", entityType: "voice_call", entityId: row.id, meta: { reason: spam?.reason, confidence, strikes: verdict?.strikes, blocked: verdict?.blocked } });
  } else {
    // What this call owes the CRM, as durable tasks (call-tasks.ts) — decided here, run after the acknowledgement.
    const submittedInEvents = report.events.some((e) => e.type === "submit_lead" || e.type === "lead");
    const wantsLead = report.lead?.requested === true || outcome === "lead_submitted" || outcome === "booked" || submittedInEvents || !!row.leadDeliveredAt;
    const leadTask = wantsLead && profile.leadDelivery.crm.enabled;
    if (leadTask) {
      tasks.push(leadTaskSpec());
      if (outcome !== "booked") outcome = "lead_submitted";
    }
    const alertKinds = new Map<string, string>();   // normalized kind (the task key) → summary
    const addAlert = (kind: string, summary: string) => {
      const spec = escalationTaskSpec(kind, summary);
      if (!alertKinds.has(spec.key)) { alertKinds.set(spec.key, summary); tasks.push(spec); }
    };
    for (const a of report.alerts) addAlert(a.kind, a.summary || report.summary || "");
    for (const e of report.events) if (e.type === "alert" && typeof (e as any).kind === "string") addAlert((e as any).kind, report.alerts.find((a) => a.kind === (e as any).kind)?.summary || report.summary || "");
    if (alertKinds.size && !leadTask) outcome = "alerted";
    const quiet = (outcome === "hangup" || outcome === "voicemail") && durationSeconds < QUIET_CALL_SECONDS;
    if (!leadTask && !alertKinds.size && !quiet) {
      if (profile.leadDelivery.notifyOnEveryCall) {
        tasks.push(...await callSummaryTaskSpecs(ctx, { ...row, outcome }));
      }
      recordActivity({ orgId: ctx.org.id, actorLabel: actor, action: "call.answered", entityType: "voice_call", entityId: row.id, customerId: row.customerId ?? null, meta: { outcome, durationSeconds, summary: row.summary, recording: !!row.recordingKey } });
    }
  }
  result.outcome = outcome;

  // ACKNOWLEDGE: the CRM tasks, the meter task and the processed flag commit together (acknowledgeCall). If that
  // write fails the call stays unprocessed, finishCall drops the claim and the engine's retry runs this again.
  // Minutes: exactly once per call. The count itself follows; a failure there leaves the record pending
  // (flags.meterPending stays true) for the retry worker (billing-usage.ts retryPendingVoiceMeters), which also
  // recovers from the call rows themselves, so a failed meter is never acknowledged as done.
  const at = row.startedAt ?? row.endedAt ?? new Date();
  if (report.recordingPending && !row.recordingKey) {
    patch.recordingPending = true;
    // The explicit recording state (POST /calls/:sid/artifacts moves it on); an earlier status is never overwritten.
    if (!(call.flags as Record<string, unknown> | null)?.recording) patch.recording = { state: "pending", seq: 0, at: new Date().toISOString() };
  }
  patch.processedAt = new Date().toISOString();
  patch.result = result;
  patch.meterPending = true;
  await acknowledgeCall({ callId: row.id, orgId: ctx.org.id, accountUserId: ctx.org.ownerUserId, outcome, billedMinutes, at, patch, tasks, now: opts.now?.() });
  onAck();
  await opts.afterAck?.();
  try {
    // The month a call belongs to is its start (billing-usage.ts).
    await meterCallUsage({ callId: row.id, orgId: ctx.org.id, accountUserId: ctx.org.ownerUserId, billedMinutes, outcome, at });
    await mergeCallFlags(row.id, { metered: billedMinutes, meterPending: false });
  } catch (e: any) {
    console.error("[voice] usage metering failed (the meter record stays pending for the retry):", e?.message || e);
    void recordFailure("call_assistant", "Call Assistant usage metering", e, { callId: row.id, orgId: ctx.org.id, billedMinutes });
    await mergeCallFlags(row.id, { meterError: String(e?.message || e).slice(0, 300) }).catch(() => {});
  }
  // The issue desk: one-way audio suspicion, engine errors, an `error` outcome (ops/call-assistant.ts).
  recordCallReportIssues({ id: row.id, orgId: ctx.org.id }, {
    durationSeconds, outcome, transcript: report.transcript, events: report.events as any,
    startedAt: report.startedAt ?? row.startedAt?.toISOString() ?? null, answeredAt: report.answeredAt ?? row.answeredAt?.toISOString() ?? null,
    endedAt: report.endedAt ?? row.endedAt?.toISOString() ?? null, engine: row.engine, model: row.model,
  });
  // The CRM work, now that it is durable. A failure here never fails the report: the task stays pending.
  const done = tasks.length ? await runCallTasksFor(row.id, opts).catch((e: any) => {
    console.error("[voice] running the call's tasks failed (the worker retries them):", e?.message || e);
    return listCallTasks(row.id).catch(() => [] as CallTask[]);
  }) : [];
  return withDelivery(result, done);
}

/** Something that must not wait for the end of the call. */
export async function handleCallEvent(call: VoiceCallRow, ev: z.infer<typeof eventSchema>): Promise<{ delivered: boolean; escalationId?: number | null; customerId?: string | null; projectId?: string | null; fallback?: boolean }> {
  const ctx = await loadOrgVoiceContext(call.orgId);
  if (!ctx) throw new Error("org gone");
  const evSlots = ev.slots ?? {};
  const [fresh] = await db.update(voiceCalls)
    .set({ slots: sql`coalesce(${voiceCalls.slots}, '{}'::jsonb) || ${JSON.stringify(evSlots)}::jsonb` })
    .where(eq(voiceCalls.id, call.id)).returning();
  const { slots: _omit, ...detail } = ev as Record<string, unknown>;
  await appendCallEvent(call.id, ev.type, detail);
  const mergedSlots = (fresh?.slots ?? { ...(call.slots ?? {}), ...evSlots }) as Record<string, string>;
  const current: VoiceCallRow = { ...(fresh ?? call), slots: mergedSlots };
  if (ev.type === "lead") {
    if (!ctx.profile.leadDelivery.crm.enabled) return { delivered: false };
    const number = current.numberId ? await findVoiceNumber({ numberId: current.numberId }) : null;
    if (ev.summary && !current.summary) {
      await db.update(voiceCalls).set({ summary: ev.summary }).where(eq(voiceCalls.id, call.id));
      current.summary = ev.summary;
    }
    const d = await deliverLead({ ctx, call: current, slots: mergedSlots, numberLabel: number?.label ?? null });
    return { delivered: true, customerId: d.customerId, projectId: d.projectId };
  }
  const r = await raiseEscalation({ ctx, call: current, kind: ev.kind, summary: ev.summary, slots: mergedSlots });
  return { delivered: r.sent, escalationId: r.escalationId, fallback: r.fallback };
}

export const artifactStatusSchema = z.object({
  recording: z.object({
    state: z.enum(["pending", "failed", "missing"]),
    reason: z.string().max(300).optional(),
    seq: z.number().int().min(0).max(1_000_000),
    attempts: z.number().int().min(0).max(100_000).optional(),
  }),
});
export type RecordingStatus = z.infer<typeof artifactStatusSchema>["recording"];

/**
 * Store the engine's recording status on the call (flags.recording) unless the call already has its recording or a
 * status with this seq or newer. pending also (re)sets the recordingPending flag; failed/missing clear it.
 */
export async function applyRecordingStatus(callId: string, status: RecordingStatus, now = new Date()): Promise<boolean> {
  const rec = { state: status.state, reason: status.reason ?? null, seq: status.seq, attempts: status.attempts ?? null, at: now.toISOString() };
  const pending = status.state === "pending";
  const r = await db.execute(sql`
    update voice_calls
       set flags = (coalesce(flags, '{}'::jsonb) - 'recordingPending')
                   || jsonb_build_object('recording', ${JSON.stringify(rec)}::jsonb)
                   || (case when ${pending}::boolean then '{"recordingPending": true}'::jsonb else '{}'::jsonb end)
     where id = ${callId}
       and recording_key is null
       and coalesce((flags->'recording'->>'seq')::int, -1) < ${status.seq}
     returning id`);
  return ((r as any).rows ?? []).length > 0;
}

export function registerVoiceInternalCallRoutes(app: Express): void {
  // Retries the post-call CRM work every minute (call-tasks.ts; on unless VOICE_CALL_TASK_WORKER_ENABLED=false).
  startVoiceCallTaskWorker();

  /** POST { callSid, to, from, numberId?, startedAt, engine, model, persona, profileVersion } → 201 { callId } */
  app.post(`${VOICE_INTERNAL_PATH}/calls`, requireVoiceInternal, async (req: Request, res: Response) => {
    const parsed = startSchema.safeParse(req.body);
    if (!parsed.success) return bad(res, parsed.error.issues);
    try {
      const row = await upsertCallStart(parsed.data);
      if (!row) return res.status(404).json({ code: "unknown_number", message: "No active Call Assistant number matches `to`." });
      res.status(201).json({ callId: row.id, orgId: row.orgId });
    } catch (e: any) {
      console.error("[voice] call start failed:", e?.message || e);
      void recordFailure("call_assistant", "Call Assistant call start", e);
      res.status(500).json({ code: "call_start_failed", message: "Could not record the call." });
    }
  });

  /**
   * PUT /calls/:callSid — the end-of-call report (also what a `blocked` or
   * `voicemail` call sends with an empty transcript). A call that never
   * POSTed /calls (a pre-answer reject) may be created here with `to`.
   * → { callId, outcome, customerId, projectId, blocked }
   */
  app.put(`${VOICE_INTERNAL_PATH}/calls/:callSid`, requireVoiceInternal, async (req: Request, res: Response) => {
    const parsed = endReportSchema.safeParse(req.body);
    if (!parsed.success) return bad(res, parsed.error.issues);
    const callSid = String(req.params.callSid);
    if (!CALL_SID_RE.test(callSid)) return res.status(400).json({ code: "invalid", message: "Bad callSid" });
    try {
      let call = await loadCall(callSid);
      if (!call) {
        call = await upsertCallStart({ callSid, to: parsed.data.to, from: parsed.data.from, numberId: parsed.data.numberId, startedAt: parsed.data.startedAt, engine: parsed.data.engine, model: parsed.data.model, persona: parsed.data.persona, profileVersion: parsed.data.profileVersion });
        if (!call) return res.status(404).json({ code: "unknown_call", message: "No such call and no number to file it under." });
      }
      const result = await finishCall(call, parsed.data);
      res.json(result);
    } catch (e: any) {
      if (e instanceof CallInProgressError) return res.status(409).json({ code: e.code, message: e.message });
      console.error("[voice] call finish failed:", e?.message || e);
      void recordFailure("call_assistant", "Call Assistant end-of-call processing", e, { callSid });
      res.status(500).json({ code: "call_finish_failed", message: "Could not finish the call." });
    }
  });

  /**
   * POST /calls/:callSid/events — { type: "alert", kind, summary, slots } or
   * { type: "lead", slots } → { delivered, escalationId?, customerId? }
   */
  app.post(`${VOICE_INTERNAL_PATH}/calls/:callSid/events`, requireVoiceInternal, async (req: Request, res: Response) => {
    const parsed = eventSchema.safeParse(req.body);
    if (!parsed.success) return bad(res, parsed.error.issues);
    if (!CALL_SID_RE.test(String(req.params.callSid))) return res.status(400).json({ code: "invalid", message: "Bad callSid" });
    try {
      const call = await loadCall(String(req.params.callSid));
      if (!call) return res.status(404).json({ code: "unknown_call" });
      if (call.outcome === "spam" || call.outcome === "blocked") return res.json({ delivered: false, reason: "spam" });
      res.json(await handleCallEvent(call, parsed.data));
    } catch (e: any) {
      console.error("[voice] call event failed:", e?.message || e);
      void recordFailure("call_assistant", "Call Assistant mid-call event", e, { type: parsed.data.type });
      res.status(500).json({ code: "call_event_failed", message: "Could not deliver the event." });
    }
  });

  /** POST /recordings/:callSid — body audio/wav (raw, ≤ 40 MB) → { recordingKey, seconds }; stored in R2 under voice/<orgId>/recordings/<callSid>.wav (recordings.ts says why four segments) */
  app.post(`${VOICE_INTERNAL_PATH}/recordings/:callSid`, requireVoiceInternal,
    express.raw({ type: ["audio/wav", "audio/x-wav", "application/octet-stream"], limit: RECORDING_MAX_BYTES }),
    async (req: Request, res: Response) => {
      const wav = req.body as unknown;
      if (!Buffer.isBuffer(wav) || wav.length < 44) return res.status(400).json({ code: "invalid", message: "Send the WAV as the raw body (audio/wav)." });
      if (!CALL_SID_RE.test(String(req.params.callSid))) return res.status(400).json({ code: "invalid", message: "Bad callSid" });
      try {
        const call = await loadCall(String(req.params.callSid));
        if (!call) return res.status(404).json({ code: "unknown_call" });
        if (!recordingsConfigured()) return res.status(503).json({ code: "r2_unconfigured", message: "R2 is not configured on this app; the recording was not stored." });
        const { recordingKey, seconds } = await putRecording(call.orgId, call.callSid, wav);
        await db.update(voiceCalls).set({ recordingKey, recordingSeconds: seconds }).where(eq(voiceCalls.id, call.id));
        await mergeCallFlags(call.id, { recording: { state: "available", at: new Date().toISOString() } }, { dropKeys: ["recordingPending"] });
        res.json({ recordingKey, seconds });
      } catch (e: any) {
        console.error("[voice] recording upload failed:", e?.message || e);
        void recordFailure("call_assistant", "Call Assistant recording upload", e);
        res.status(502).json({ code: "recording_failed", message: "Could not store the recording." });
      }
    });

  /**
   * POST /calls/:callSid/artifacts — the engine's explicit word on a call's recording (voice/outbox.py), so the
   * console never has to guess from the call's age:
   *   { recording: { state: "pending" | "failed" | "missing", reason?, seq, attempts? } } → { ok, applied, recordingState }
   * pending = (re)queued for upload (a replay after a correction says this again); failed = the app refused the
   * upload for good (the engine keeps the WAV in its failed queue for a replay); missing = the WAV the engine expected
   * is gone (nothing left to upload). `seq` is the engine job's counter: an older or repeated status never overwrites
   * a newer one, and a stored recording (recording_key) always wins. Unknown call → 404 (the engine stops sending).
   */
  app.post(`${VOICE_INTERNAL_PATH}/calls/:callSid/artifacts`, requireVoiceInternal, async (req: Request, res: Response) => {
    const parsed = artifactStatusSchema.safeParse(req.body);
    if (!parsed.success) return bad(res, parsed.error.issues);
    const callSid = String(req.params.callSid);
    if (!CALL_SID_RE.test(callSid)) return res.status(400).json({ code: "invalid", message: "Bad callSid" });
    try {
      const call = await loadCall(callSid);
      if (!call) return res.status(404).json({ code: "unknown_call" });
      const applied = await applyRecordingStatus(call.id, parsed.data.recording);
      const [fresh] = await db.select().from(voiceCalls).where(eq(voiceCalls.id, call.id)).limit(1);
      res.json({ ok: true, applied, recordingState: fresh ? recordingStateOf(fresh) : null });
    } catch (e: any) {
      console.error("[voice] artifact status failed:", e?.message || e);
      void recordFailure("call_assistant", "Call Assistant artifact status", e, { callSid });
      res.status(500).json({ code: "artifact_status_failed" });
    }
  });

  /** POST /status — SignalWire status callbacks relayed by the engine: { callSid, callStatus, duration } → { ok } */
  app.post(`${VOICE_INTERNAL_PATH}/status`, requireVoiceInternal, async (req: Request, res: Response) => {
    const parsed = statusSchema.safeParse(req.body);
    if (!parsed.success) return bad(res, parsed.error.issues);
    const { callSid, callStatus, duration } = parsed.data;
    try {
      const call = await loadCall(callSid);
      // Not a Call Assistant call: a support-line call (spoken or keypad) settles its carrier minutes here (review S-11).
      if (!call) return res.json({ ok: true, known: await settleSupportCall(callSid, duration) });
      const status = callStatus.toLowerCase();
      // A call that never opened a stream gets its outcome from the carrier; a reported call keeps the engine's.
      const outcomeFor: Record<string, CallOutcome> = { failed: "error", busy: "hangup", "no-answer": "hangup", canceled: "hangup" };
      if (!call.endedAt && outcomeFor[status]) {
        await db.update(voiceCalls).set({ endedAt: new Date(), outcome: call.outcome ?? outcomeFor[status], durationSeconds: call.durationSeconds ?? Math.round(duration ?? 0), billedMinutes: call.billedMinutes ?? 0 })
          .where(and(eq(voiceCalls.id, call.id), sql`${voiceCalls.endedAt} is null`));
      }
      await appendCallEvent(call.id, "status", { callStatus: status, duration: duration ?? null });
      res.json({ ok: true, known: true });
    } catch (e: any) {
      console.error("[voice] status callback failed:", e?.message || e);
      void recordFailure("call_assistant", "Call Assistant carrier status callback", e);
      res.status(500).json({ code: "status_failed" });
    }
  });

  /**
   * GET /blocklist?to=+1…&from=+1… → { blocked, strikes, calls } — the
   * pre-answer check for an engine that has not fetched the profile yet
   * (calls+crm extension; GET /profile carries the same `caller.blocked`).
   */
  app.get(`${VOICE_INTERNAL_PATH}/blocklist`, requireVoiceInternal, async (req: Request, res: Response) => {
    const to = String(req.query.to ?? ""), from = String(req.query.from ?? "");
    const orgId = String(req.query.orgId ?? "");
    try {
      const number = to ? await findVoiceNumber({ to }) : null;
      const org = number?.orgId ?? orgId;
      if (!org) return res.status(404).json({ code: "unknown_number" });
      res.json({ orgId: org, ...(await callerSpamStatus(org, from)) });
    } catch (e: any) {
      console.error("[voice] blocklist failed:", e?.message || e);
      void recordFailure("call_assistant", "Call Assistant blocklist check", e);
      res.status(500).json({ code: "blocklist_failed" });
    }
  });
}
