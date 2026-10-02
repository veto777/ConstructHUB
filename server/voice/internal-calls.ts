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
 * Every write to the JSON columns merges in SQL (`flags || patch`,
 * `events || [event]`, `slots || patch`) so a status callback, a mid-call
 * event and the end report never overwrite each other's keys.
 */
import type { Express, Request, Response } from "express";
import express from "express";
import { z } from "zod";
import { db } from "../db";
import { voiceCalls, type VoiceCallRow, type VoiceTranscriptTurn, type VoiceCallEvent } from "@shared/schema";
import { and, eq, sql } from "drizzle-orm";
import { CALL_OUTCOMES, ESCALATION_KINDS, type CallOutcome } from "@shared/voice-profile";
import { requireVoiceInternal, VOICE_INTERNAL_PATH } from "./internal-auth";
import { loadOrgVoiceContext, findVoiceNumber } from "./org-profile";
import { deliverLead, notifyCallSummary } from "./leads";
import { raiseEscalation } from "./escalations";
import { recordSpamVerdict, recordBlockedCall, callerSpamStatus } from "./spam";
import { meterCallUsage, billedMinutesFor } from "./usage";
import { putRecording, recordingsConfigured } from "./recordings";
import { recordActivity } from "../crm/activity";

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
});
export type EndReport = z.infer<typeof endReportSchema>;

const eventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("alert"), kind: z.enum(ESCALATION_KINDS).or(z.string().max(40)), summary: z.string().max(600).default(""), slots: slots.optional() }),
  z.object({ type: z.literal("lead"), slots: slots.default({}), summary: z.string().max(4000).optional() }),
]);

const statusSchema = z.object({ callSid: sid, callStatus: z.string().max(40), duration: z.coerce.number().min(0).optional(), from: z.string().max(40).optional(), to: z.string().max(40).optional() });

const bad = (res: Response, issues: unknown) => res.status(400).json({ code: "invalid", issues });
const asDate = (s?: string | null) => (s ? new Date(s) : null);

export type FinishResult = { callId: string; outcome: CallOutcome; customerId: string | null; projectId: string | null; blocked: boolean; escalations: number[] };

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
export async function finishCall(callIn: VoiceCallRow, report: EndReport): Promise<FinishResult> {
  const claim = await claimCall(callIn.id);
  if (claim === "busy") throw new CallInProgressError();
  if (claim === "processed") {
    const [done] = await db.select({ flags: voiceCalls.flags }).from(voiceCalls).where(eq(voiceCalls.id, callIn.id)).limit(1);
    return (done?.flags as Record<string, unknown>).result as FinishResult;
  }
  try {
    return await processFinishedCall(callIn.id, report);
  } catch (e) {
    // Let the engine's retry run the work again instead of waiting out the stale window.
    await mergeCallFlags(callIn.id, {}, { dropKeys: ["processingAt"] }).catch(() => {});
    throw e;
  }
}

async function processFinishedCall(callId: string, report: EndReport): Promise<FinishResult> {
  // Re-read after the claim: a mid-call event may have delivered the lead in the meantime.
  const [call] = await db.select().from(voiceCalls).where(eq(voiceCalls.id, callId)).limit(1);
  if (!call) throw new Error("call gone");
  const ctx = await loadOrgVoiceContext(call.orgId);
  if (!ctx) throw new Error("org gone");
  const number = call.numberId ? await findVoiceNumber({ numberId: call.numberId }) : null;
  const { profile } = ctx;
  const patch: Record<string, unknown> = {};

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
    const confidence = spam?.confidence ?? ctx.spam.flagAt;
    const verdict = await recordSpamVerdict({ orgId: ctx.org.id, from: row.fromNumber, confidence, reason: spam?.reason || "flagged by the assistant", callId: row.id, strikeAt: ctx.spam.strikeAt });
    result.blocked = verdict?.blocked ?? false;
    patch.spam = verdict;
    recordActivity({ orgId: ctx.org.id, actorLabel: actor, action: "call.spam", entityType: "voice_call", entityId: row.id, meta: { reason: spam?.reason, confidence, strikes: verdict?.strikes, blocked: verdict?.blocked } });
  } else {
    const submittedInEvents = report.events.some((e) => e.type === "submit_lead" || e.type === "lead");
    const wantsLead = report.lead?.requested === true || outcome === "lead_submitted" || outcome === "booked" || submittedInEvents || !!row.leadDeliveredAt;
    let delivered = false;
    if (wantsLead && profile.leadDelivery.crm.enabled) {
      try {
        const d = await deliverLead({ ctx, call: row, slots: row.slots, numberLabel: number?.label ?? null });
        const deliveredAt = row.leadDeliveredAt ?? new Date();
        await db.update(voiceCalls).set({ customerId: d.customerId, projectId: d.projectId, leadDeliveredAt: deliveredAt }).where(eq(voiceCalls.id, row.id));
        row.customerId = d.customerId; row.projectId = d.projectId; row.leadDeliveredAt = deliveredAt;
        result.customerId = d.customerId; result.projectId = d.projectId;
        patch.lead = row.slots ?? {};
        if (!d.alreadyDelivered) patch.notified = d.notified;
        delivered = true;
        if (outcome !== "booked") outcome = "lead_submitted";
      } catch (e: any) {
        console.error("[voice] lead delivery failed:", e?.message || e);
        patch.leadError = String(e?.message || e).slice(0, 300);
      }
    }
    const alertKinds = new Set<string>();
    for (const a of report.alerts) alertKinds.add(a.kind);
    for (const e of report.events) if (e.type === "alert" && typeof (e as any).kind === "string") alertKinds.add((e as any).kind);
    for (const kind of alertKinds) {
      const summary = report.alerts.find((a) => a.kind === kind)?.summary || report.summary || "";
      try {
        const r = await raiseEscalation({ ctx, call: row, kind, summary, slots: row.slots });
        if (r.escalationId) result.escalations.push(r.escalationId);
      } catch (e: any) {
        console.error("[voice] escalation failed:", e?.message || e);
      }
    }
    if (alertKinds.size && !delivered) outcome = "alerted";
    const quiet = (outcome === "hangup" || outcome === "voicemail") && durationSeconds < QUIET_CALL_SECONDS;
    if (!delivered && !alertKinds.size && !quiet) {
      if (profile.leadDelivery.notifyOnEveryCall) {
        await notifyCallSummary(ctx, { ...row, outcome }).catch((e: any) => console.error("[voice] summary notify failed:", e?.message || e));
      }
      recordActivity({ orgId: ctx.org.id, actorLabel: actor, action: "call.answered", entityType: "voice_call", entityId: row.id, customerId: row.customerId ?? null, meta: { outcome, durationSeconds, summary: row.summary, recording: !!row.recordingKey } });
    }
  }
  result.outcome = outcome;

  // Minutes: exactly once per call (this function runs once per call — see the claim).
  try {
    // The month a call belongs to is its start (billing-usage.ts).
    await meterCallUsage({ orgId: ctx.org.id, accountUserId: ctx.org.ownerUserId, billedMinutes, outcome, at: row.startedAt ?? row.endedAt ?? new Date() });
    patch.metered = billedMinutes;
  } catch (e: any) {
    console.error("[voice] usage metering failed:", e?.message || e);
    patch.meterError = String(e?.message || e).slice(0, 300);
  }

  patch.processedAt = new Date().toISOString();
  patch.result = result;
  await db.update(voiceCalls).set({ outcome }).where(eq(voiceCalls.id, row.id));
  await mergeCallFlags(row.id, patch, { dropKeys: ["processingAt"] });
  return result;
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
    await db.update(voiceCalls).set({ customerId: d.customerId, projectId: d.projectId, leadDeliveredAt: current.leadDeliveredAt ?? new Date() }).where(eq(voiceCalls.id, call.id));
    return { delivered: true, customerId: d.customerId, projectId: d.projectId };
  }
  const r = await raiseEscalation({ ctx, call: current, kind: ev.kind, summary: ev.summary, slots: mergedSlots });
  return { delivered: r.sent, escalationId: r.escalationId, fallback: r.fallback };
}

export function registerVoiceInternalCallRoutes(app: Express): void {
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
        res.json({ recordingKey, seconds });
      } catch (e: any) {
        console.error("[voice] recording upload failed:", e?.message || e);
        res.status(502).json({ code: "recording_failed", message: "Could not store the recording." });
      }
    });

  /** POST /status — SignalWire status callbacks relayed by the engine: { callSid, callStatus, duration } → { ok } */
  app.post(`${VOICE_INTERNAL_PATH}/status`, requireVoiceInternal, async (req: Request, res: Response) => {
    const parsed = statusSchema.safeParse(req.body);
    if (!parsed.success) return bad(res, parsed.error.issues);
    const { callSid, callStatus, duration } = parsed.data;
    try {
      const call = await loadCall(callSid);
      if (!call) return res.json({ ok: true, known: false });
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
      res.status(500).json({ code: "blocklist_failed" });
    }
  });
}
