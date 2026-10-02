/**
 * engine → app: call lifecycle, mid-call events and recordings
 * (SPEC.md § Internal API → calls / events / recordings). OWNER: calls+crm lane.
 *
 * Everything the engine reports lands here; THIS side runs lead delivery
 * (leads.ts), escalations (escalations.ts), the spam ledger (spam.ts) and
 * usage (voice_usage) — the engine never touches Postgres. Idempotent on
 * callSid: SignalWire and the engine may both report an ending.
 */
import type { Express } from "express";
import express from "express";
import { requireVoiceInternal, VOICE_INTERNAL_PATH } from "./internal-auth";
import { notImplemented } from "./context";

const LANE = "calls+crm";
/** A 15-minute 8 kHz mono WAV is ~14 MB; cap recordings well under the app's 50 MB JSON limit. */
export const RECORDING_MAX_BYTES = 40 * 1024 * 1024;

export function registerVoiceInternalCallRoutes(app: Express): void {
  /** POST { callSid, to, from, numberId?, startedAt, engine, model, persona, profileVersion } → 201 { callId } */
  app.post(`${VOICE_INTERNAL_PATH}/calls`, requireVoiceInternal, (_req, res) => {
    return notImplemented(res, LANE, "upsert voice_calls by callSid at call start");
  });

  /**
   * PUT /calls/:callSid — the end-of-call report (also what a `blocked` or
   * `voicemail` call sends with an empty transcript):
   *   { endedAt, durationSeconds, outcome, summary, transcript, slots, events,
   *     caller: { name, email, address, city }, serviceNeeded,
   *     spam?: { confidence, reason }, lead?: { requested: true }, alerts?: [{ kind, summary }] }
   * → { callId, outcome, customerId, projectId, blocked: boolean }
   */
  app.put(`${VOICE_INTERNAL_PATH}/calls/:callSid`, requireVoiceInternal, (_req, res) => {
    return notImplemented(res, LANE, "finish the call: lead delivery, escalations, spam ledger, usage");
  });

  /**
   * POST /calls/:callSid/events — something that must not wait for the end of
   * the call: { type: "alert", kind, summary, slots } (urgent / human) or
   * { type: "lead", slots } (submit_lead mid-call). → { delivered: true, escalationId? }
   */
  app.post(`${VOICE_INTERNAL_PATH}/calls/:callSid/events`, requireVoiceInternal, (_req, res) => {
    return notImplemented(res, LANE, "immediate escalation / lead delivery during the call");
  });

  /** POST /recordings/:callSid — body audio/wav (raw) → { recordingKey, seconds }; stored in R2 under voice/<orgId>/<callSid>.wav */
  app.post(`${VOICE_INTERNAL_PATH}/recordings/:callSid`, requireVoiceInternal,
    express.raw({ type: ["audio/wav", "audio/x-wav", "application/octet-stream"], limit: RECORDING_MAX_BYTES }),
    (_req, res) => {
      return notImplemented(res, LANE, "upload to R2 and set voice_calls.recording_key");
    });

  /** POST /status — SignalWire status callbacks relayed by the engine: { callSid, callStatus, duration } → { ok } */
  app.post(`${VOICE_INTERNAL_PATH}/status`, requireVoiceInternal, (_req, res) => {
    return notImplemented(res, LANE, "mark calls that never opened a stream (busy, no-answer, failed)");
  });
}
