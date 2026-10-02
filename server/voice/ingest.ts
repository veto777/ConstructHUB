/**
 * External call log ingest: another receptionist pushes its finished calls into ConstructHUB's call log.
 *
 * Owner, 2026-10-02: "So I don't want you logging all the useless calls. You can track these on the constructhub
 * this should all be setup under the alpine admin account". Alpine's own receptionist (Janice, a separate tower
 * project) stopped posting every call to Telegram and pushes each finished call here instead. The call lands in
 * voice_calls under one CRM org (VOICE_INGEST_ORG_ID) and shows on Call Assistant → Calls like any other call.
 *
 *   POST /api/voice-ingest/calls                     one call, or { calls: [...] } (≤ 100, for a backfill) → upsert by call_sid
 *   PUT  /api/voice-ingest/calls/:callSid/recording  raw audio/wav (≤ 40 MB) → stored in R2 like the engine's recordings
 *
 * Auth: `Authorization: Bearer $VOICE_INGEST_SECRET`, constant-time. No secret (or one too short) → 503, never open.
 * Tailnet only: a request through the Cloudflare edge carries cf-connecting-ip and is answered 404.
 *
 * An ingested call is a RECORD ONLY: it never meters minutes (voice_usage), files a lead, sends an alert or an
 * escalation, or touches the spam ledger. Rows are marked engine = 'external'; an upsert can only overwrite an
 * external row of the same org, never a call ConstructHUB's own engine answered.
 */
import express, { type Express, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import { sql } from "drizzle-orm";
import { db } from "../db";
import { bearerMatches } from "../ops/internal-auth";
import { CALL_SID_RE, RECORDING_MAX_BYTES } from "./internal-calls";
import { putRecording, recordingsConfigured } from "./recordings";

export const VOICE_INGEST_PATH = "/api/voice-ingest";
export const INGEST_ENGINE = "external";
export const INGEST_BATCH_MAX = 100;

export function ingestConfig(): { secret: string; orgId: string } | null {
  const secret = process.env.VOICE_INGEST_SECRET?.trim();
  const orgId = process.env.VOICE_INGEST_ORG_ID?.trim();
  // A `chub_` prefix would collide with the public-API key guard (server/public-api/guard.ts).
  if (!secret || secret.length < 24 || secret.startsWith("chub_") || !orgId || !/^[A-Za-z0-9_-]{1,80}$/.test(orgId)) return null;
  return { secret, orgId };
}

export function requireVoiceIngest(req: Request, res: Response, next: NextFunction) {
  res.setHeader("Cache-Control", "no-store");
  if (req.headers["cf-connecting-ip"]) return res.status(404).json({ message: "Not found" });
  const cfg = ingestConfig();
  if (!cfg) return res.status(503).json({ code: "ingest_unconfigured", message: "VOICE_INGEST_SECRET / VOICE_INGEST_ORG_ID are not set on this app." });
  if (!bearerMatches(req.headers.authorization, cfg.secret)) return res.status(401).json({ code: "unauthorized", message: "Bad ingest bearer." });
  (res.locals as any).ingestOrgId = cfg.orgId;
  return next();
}

/** The sender's outcome words → ConstructHUB's CALL_OUTCOMES (the original is kept in flags.ingest.outcome). */
export const INGEST_OUTCOME_MAP: Record<string, string> = {
  request_submitted: "lead_submitted", lead_submitted: "lead_submitted", booked: "booked",
  alerted: "alerted",
  declined: "declined", declined_repair: "declined", declined_service: "declined", not_estimate: "declined",
  out_of_area: "out_of_area",
  spam: "spam", blocked: "blocked",
  hangup: "hangup", voicemail: "voicemail", info: "info", error: "error",
};

const turn = z.object({ role: z.string().trim().max(40), text: z.string().max(4000), t: z.string().max(40).optional() });
const optText = (max: number) => z.string().trim().max(max).nullish();

export const ingestCallSchema = z.object({
  call_sid: z.string().regex(CALL_SID_RE, "call_sid: 4–64 letters, digits, '-' or '_'"),
  site: optText(40),
  from: optText(40),
  to: optText(40),
  started_at: z.string().datetime({ offset: true }),
  duration_s: z.number().int().min(0).max(86_400).nullish(),
  outcome: z.string().trim().min(1).max(40),
  caller_name: optText(200),
  caller_address: optText(300),
  caller_city: optText(120),
  service_needed: optText(300),
  summary: optText(4000),
  transcript: z.array(turn).max(2000).default([]),
  lead_id: z.union([z.string().trim().max(100), z.number().int()]).nullish(),
  escalation: z.object({
    kind: optText(60), to: optText(200), text: optText(2000),
  }).nullish(),
  persona: optText(40),
});
export type IngestCall = z.infer<typeof ingestCallSchema>;

/** Role words from another system → caller / assistant / system (the call log renders those three). */
export function normalizeTurn(t: { role: string; text: string; t?: string }): { role: "caller" | "assistant" | "system"; text: string; t?: string } {
  const r = t.role.toLowerCase();
  const text = t.text.trim();
  let role: "caller" | "assistant" | "system";
  if (/^\s*\[not answered/i.test(text)) role = "system";
  else if (r === "caller" || r === "customer" || r === "user") role = "caller";
  else if (r === "system" || r === "note" || r === "event") role = "system";
  else role = "assistant";   // "janice", "assistant", "ai", "agent", "JANICE (AI receptionist)"
  return t.t ? { role, text, t: t.t } : { role, text };
}

export function toRow(orgId: string, c: IngestCall) {
  const outcome = INGEST_OUTCOME_MAP[c.outcome.toLowerCase()] ?? "info";
  const started = new Date(c.started_at);
  const duration = c.duration_s ?? null;
  return {
    orgId,
    callSid: c.call_sid,
    fromNumber: c.from || null,
    toNumber: c.to || null,
    persona: (c.persona || "janice").toLowerCase(),
    startedAt: started,
    endedAt: duration == null ? null : new Date(started.getTime() + duration * 1000),
    durationSeconds: duration,
    outcome,
    callerName: c.caller_name || null,
    callerAddress: c.caller_address || null,
    callerCity: c.caller_city || null,
    serviceNeeded: c.service_needed || null,
    summary: c.summary || null,
    transcript: c.transcript.map(normalizeTurn),
    flags: {
      ingest: {
        source: "alpine-janice",
        market: c.site || null,
        outcome: c.outcome,
        leadId: c.lead_id == null ? null : String(c.lead_id),
        escalation: c.escalation ?? null,
      },
    },
  };
}

/** Upsert one call; null when the call_sid belongs to a call this org didn't push (another org, or our own engine's). */
export async function upsertIngestedCall(orgId: string, c: IngestCall): Promise<{ id: string; created: boolean } | null> {
  const r = toRow(orgId, c);
  const res = await db.execute(sql`
    INSERT INTO voice_calls (org_id, call_sid, direction, from_number, to_number, engine, persona, started_at, answered_at,
                             ended_at, duration_seconds, outcome, caller_name, caller_address, caller_city, service_needed,
                             summary, transcript, flags)
    VALUES (${r.orgId}, ${r.callSid}, 'inbound', ${r.fromNumber}, ${r.toNumber}, ${INGEST_ENGINE}, ${r.persona}, ${r.startedAt},
            ${r.startedAt}, ${r.endedAt}, ${r.durationSeconds}, ${r.outcome}, ${r.callerName}, ${r.callerAddress}, ${r.callerCity},
            ${r.serviceNeeded}, ${r.summary}, ${JSON.stringify(r.transcript)}::jsonb, ${JSON.stringify(r.flags)}::jsonb)
    ON CONFLICT (call_sid) DO UPDATE SET
      from_number = EXCLUDED.from_number, to_number = EXCLUDED.to_number, persona = EXCLUDED.persona,
      started_at = EXCLUDED.started_at, answered_at = EXCLUDED.answered_at, ended_at = EXCLUDED.ended_at,
      duration_seconds = EXCLUDED.duration_seconds, outcome = EXCLUDED.outcome, caller_name = EXCLUDED.caller_name,
      caller_address = EXCLUDED.caller_address, caller_city = EXCLUDED.caller_city, service_needed = EXCLUDED.service_needed,
      summary = EXCLUDED.summary, transcript = EXCLUDED.transcript,
      flags = coalesce(voice_calls.flags, '{}'::jsonb) || EXCLUDED.flags
    WHERE voice_calls.org_id = EXCLUDED.org_id AND voice_calls.engine = ${INGEST_ENGINE}
    RETURNING id, (xmax = 0) AS created`);
  const row = (res as any).rows?.[0];
  return row ? { id: String(row.id), created: !!row.created } : null;
}

export function registerVoiceIngestRoutes(app: Express): void {
  app.post(`${VOICE_INGEST_PATH}/calls`, requireVoiceIngest, async (req: Request, res: Response) => {
    const orgId = (res.locals as any).ingestOrgId as string;
    const body = req.body;
    const items: unknown[] = Array.isArray(body?.calls) ? body.calls : [body];
    if (!items.length || items.length > INGEST_BATCH_MAX) {
      return res.status(400).json({ code: "invalid", message: `Send one call, or { calls: [...] } with 1–${INGEST_BATCH_MAX} calls.` });
    }
    const results: { callSid: string | null; id?: string; created?: boolean; error?: string }[] = [];
    for (const item of items) {
      const parsed = ingestCallSchema.safeParse(item);
      if (!parsed.success) {
        const sid = typeof (item as any)?.call_sid === "string" ? String((item as any).call_sid).slice(0, 64) : null;
        results.push({ callSid: sid, error: parsed.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; ").slice(0, 400) });
        continue;
      }
      try {
        const out = await upsertIngestedCall(orgId, parsed.data);
        results.push(out ? { callSid: parsed.data.call_sid, ...out } : { callSid: parsed.data.call_sid, error: "call_sid belongs to a call this sender did not push" });
      } catch (e: any) {
        console.error("[voice-ingest] store failed:", e?.message || e);
        results.push({ callSid: parsed.data.call_sid, error: "could not store the call" });
      }
    }
    const stored = results.filter((r) => r.id).length;
    // a single call answers with its own status; a batch is 200 with per-call results
    if (!Array.isArray(body?.calls)) {
      const r = results[0];
      if (r.id) return res.status(r.created ? 201 : 200).json({ id: r.id, created: r.created });
      return res.status(r.error === "call_sid belongs to a call this sender did not push" ? 409 : r.error === "could not store the call" ? 500 : 400)
        .json({ code: "rejected", message: r.error });
    }
    res.json({ stored, failed: results.length - stored, results });
  });

  app.put(`${VOICE_INGEST_PATH}/calls/:callSid/recording`, requireVoiceIngest,
    express.raw({ type: ["audio/wav", "audio/x-wav", "application/octet-stream"], limit: RECORDING_MAX_BYTES }),
    async (req: Request, res: Response) => {
      const orgId = (res.locals as any).ingestOrgId as string;
      const callSid = String(req.params.callSid);
      const wav = req.body as unknown;
      if (!CALL_SID_RE.test(callSid)) return res.status(400).json({ code: "invalid", message: "Bad callSid" });
      if (!Buffer.isBuffer(wav) || wav.length < 44 || wav.toString("ascii", 0, 4) !== "RIFF" || wav.toString("ascii", 8, 12) !== "WAVE") {
        return res.status(415).json({ code: "invalid", message: "Send the recording as a WAV file in the raw body (Content-Type: audio/wav)." });
      }
      const found = await db.execute(sql`SELECT id FROM voice_calls WHERE call_sid = ${callSid} AND org_id = ${orgId} AND engine = ${INGEST_ENGINE} LIMIT 1`);
      const call = (found as any).rows?.[0];
      if (!call) return res.status(404).json({ code: "unknown_call", message: "POST the call first, then its recording." });
      if (!recordingsConfigured()) return res.status(503).json({ code: "r2_unconfigured", message: "R2 is not configured on this app; the recording was not stored." });
      try {
        const { recordingKey, seconds } = await putRecording(orgId, callSid, wav);
        await db.execute(sql`UPDATE voice_calls SET recording_key = ${recordingKey}, recording_seconds = ${seconds} WHERE id = ${call.id}`);
        res.json({ stored: true, seconds });
      } catch (e: any) {
        console.error("[voice-ingest] recording upload failed:", e?.message || e);
        res.status(502).json({ code: "recording_failed", message: "Could not store the recording." });
      }
    });
}
