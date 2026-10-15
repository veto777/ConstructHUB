/**
 * The support line's calls in the brand's own Call Assistant (owner, 2026-10-15: "we have a call center setup for
 * construct hub so all data should be here!"). Every call Gabe takes on SUPPORT_LINE_NUMBER (spoken or keypad line)
 * is mirrored into voice_calls under the brand's CRM org — the org owned by the first platform admin account
 * (support@constructhub.us, "the brand account that controls it"), or SUPPORT_CALL_LOG_ORG_ID when set — so
 * Call Assistant → Calls, the Overview and Results show them like any other call.
 *
 * A mirrored call is a RECORD ONLY, like an ingested one (voice/ingest.ts): engine = 'external', persona 'gabe',
 * never metered (voice_usage), never a lead, alert or escalation. support_calls rows are purged after 30 days;
 * the mirror is the lasting copy. Re-mirrored at every change (turn end, ticket, transcription), so the row
 * follows the call; backfilled on boot for calls taken before this existed.
 */
import { pool } from "../db";
import { ADMIN_EMAILS } from "../admin";
import { INGEST_ENGINE } from "../voice/ingest";
import { normalizeE164 } from "../voice/profile-store";

export const SUPPORT_CALL_OUTCOME_TICKET = "support_ticket";
const STALE_MS = 2 * 3_600_000;
const CATEGORY_LABEL: Record<string, string> = { payment: "Payment or billing", login: "Login", technical: "Something in the app", data: "Missing data", other: "Other" };

let cachedOrg: { id: string | null; at: number } | null = null;
/** The brand org's id (5-minute cache); null when no admin account owns a CRM org yet. */
export async function supportCallLogOrgId(): Promise<string | null> {
  const env = process.env.SUPPORT_CALL_LOG_ORG_ID?.trim();
  if (env) return env;
  if (cachedOrg && Date.now() - cachedOrg.at < 5 * 60_000) return cachedOrg.id;
  const { rows } = await pool.query(
    `SELECT o.id FROM crm_orgs o JOIN users u ON u.id = o.owner_user_id
      WHERE lower(u.email) = $1 ORDER BY o.created_at ASC LIMIT 1`, [ADMIN_EMAILS[0]]);
  cachedOrg = { id: rows[0]?.id ?? null, at: Date.now() };
  return cachedOrg.id;
}

type SupportCallRow = {
  call_sid: string; caller_number: string | null; state: any; user_id: number | null; verified_at: Date | null;
  ticket_id: number | null; created_at: Date; updated_at: Date; line: string; metered_seconds: number; ended_at: Date | null;
  ticket_number: string | null; ticket_title: string | null; ticket_category: string | null; ticket_severity: string | null;
  ticket_status: string | null; account_email: string | null;
};

/** Pure: the voice_calls row a support call becomes. */
export function supportCallToRow(c: SupportCallRow, orgId: string, lineNumber: string | null) {
  const s = c.state && typeof c.state === "object" ? c.state : {};
  const verified = !!c.verified_at || s.verified === true;
  const started = new Date(c.created_at);
  // Calls before the ended_at column (2026-10-09) never got an end: a row untouched for two hours is over, its
  // last update the best end time we have (a live call is updated every turn).
  const stale = !c.ended_at && Date.now() - new Date(c.updated_at).getTime() > STALE_MS;
  const ended = c.ended_at ? new Date(c.ended_at) : stale ? new Date(c.updated_at) : null;
  const duration = ended ? Math.max(0, Math.round((ended.getTime() - started.getTime()) / 1000)) : (c.metered_seconds || null);
  const turns: { role: string; text: string }[] = Array.isArray(s.aiTurns) ? s.aiTurns : [];
  const transcript = turns
    .filter((t) => t && typeof t.text === "string" && t.text.trim())
    .map((t) => ({ role: t.role === "caller" ? "caller" : "assistant", text: String(t.text).slice(0, 4000) }));
  const lineLabel = c.line === "ivr" ? "keypad line" : "spoken line";
  const parts = [`Support line (Gabe, ${lineLabel})`, verified ? "caller verified" : "caller not verified"];
  if (c.ticket_number) parts.push(`ticket ${c.ticket_number}${c.ticket_status ? ` (${c.ticket_status.replace(/_/g, " ")})` : ""}: ${c.ticket_title || "Support request"}`);
  else if (verified) parts.push(s.step === "done" && turns.length ? "no ticket opened" : "no ticket");
  else if (!ended) parts.push("in progress");
  const summary = parts.join(" · ");
  return {
    orgId, callSid: c.call_sid, fromNumber: c.caller_number || null, toNumber: lineNumber,
    startedAt: started, endedAt: ended, durationSeconds: duration,
    outcome: c.ticket_number ? SUPPORT_CALL_OUTCOME_TICKET : ended ? "info" : null,
    callerName: verified ? c.account_email : null,
    serviceNeeded: c.ticket_category ? `${CATEGORY_LABEL[c.ticket_category] ?? c.ticket_category}${c.ticket_severity ? ` · ${c.ticket_severity}` : ""}` : null,
    summary, transcript,
    flags: { support: { line: c.line, verified, userId: verified ? c.user_id : null, ticketId: c.ticket_id, ticketNumber: c.ticket_number }, ingest: { source: "constructhub-support" } },
  };
}

async function loadSupportCall(callSid: string): Promise<SupportCallRow | null> {
  const { rows } = await pool.query(
    `SELECT c.*, t.number AS ticket_number, t.title AS ticket_title, t.category AS ticket_category, t.severity AS ticket_severity,
            t.status AS ticket_status, u.email AS account_email
       FROM support_calls c LEFT JOIN support_tickets t ON t.id = c.ticket_id LEFT JOIN users u ON u.id = c.user_id
      WHERE c.call_sid = $1`, [callSid]);
  return rows[0] ?? null;
}

/** Upsert the call's mirror row. Never throws (the line must not fail over its log). */
export async function mirrorSupportCall(callSid: string): Promise<boolean> {
  try {
    const orgId = await supportCallLogOrgId();
    if (!orgId) return false;
    const c = await loadSupportCall(callSid);
    if (!c) return false;
    const r = supportCallToRow(c, orgId, normalizeE164(process.env.SUPPORT_LINE_NUMBER || "") || null);
    await pool.query(
      `INSERT INTO voice_calls (org_id, call_sid, direction, from_number, to_number, engine, persona, started_at, answered_at, ended_at,
                                duration_seconds, outcome, caller_name, service_needed, summary, transcript, flags)
       VALUES ($1,$2,'inbound',$3,$4,$5,'gabe',$6,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14::jsonb)
       ON CONFLICT (call_sid) DO UPDATE SET
         from_number = EXCLUDED.from_number, to_number = EXCLUDED.to_number, ended_at = EXCLUDED.ended_at,
         duration_seconds = EXCLUDED.duration_seconds, outcome = EXCLUDED.outcome, caller_name = EXCLUDED.caller_name,
         service_needed = EXCLUDED.service_needed, summary = EXCLUDED.summary, transcript = EXCLUDED.transcript,
         flags = coalesce(voice_calls.flags, '{}'::jsonb) || EXCLUDED.flags
       WHERE voice_calls.org_id = EXCLUDED.org_id AND voice_calls.engine = $5`,
      [r.orgId, r.callSid, r.fromNumber, r.toNumber, INGEST_ENGINE, r.startedAt, r.endedAt, r.durationSeconds, r.outcome,
        r.callerName, r.serviceNeeded, r.summary, JSON.stringify(r.transcript), JSON.stringify(r.flags)]);
    return true;
  } catch (e: any) {
    console.error("[support] call log mirror failed:", callSid, e?.message || e);
    return false;
  }
}

/** Fire-and-forget from the line's hot path. */
export function mirrorSupportCallSoon(callSid: string): void {
  void mirrorSupportCall(callSid);
}

/** On boot: every support call not yet in the brand's log, and every mirrored call still "in progress" after two quiet hours. */
export async function backfillSupportCallLog(): Promise<number> {
  const orgId = await supportCallLogOrgId();
  if (!orgId) return 0;
  const { rows } = await pool.query(
    `SELECT c.call_sid FROM support_calls c LEFT JOIN voice_calls v ON v.call_sid = c.call_sid
      WHERE v.id IS NULL OR (v.ended_at IS NULL AND c.updated_at < now() - interval '2 hours') ORDER BY c.created_at`);
  let n = 0;
  for (const r of rows) if (await mirrorSupportCall(r.call_sid)) n++;
  if (n) console.log(`[support] call log: mirrored ${n} earlier call(s) into the brand's Call Assistant`);
  return n;
}
