/**
 * Calls log for the CRM (SPEC.md § CRM API → Calls). OWNER: calls+crm lane.
 * Sibling files for that lane: leads.ts (CRM delivery), escalations.ts (rules
 * + reminder worker), spam.ts (ledger), internal-calls.ts (engine → app),
 * recordings.ts (R2), usage.ts (minutes).
 *
 * Fixed by the architect:
 *   - list/filter is org-scoped through voiceContext; every member may read calls;
 *   - recordings stream from R2 through the app (never a public bucket URL);
 *   - the spam view is ?spam=1 (outcome spam|blocked) plus the ledger, with
 *     unblock needing manageSettings.
 *
 * Also here: the public "Got it" link an escalation email carries (signed,
 * org-less) and the reminder worker's start (VOICE_ESCALATION_WORKER_ENABLED).
 */
import type { Express, Request, Response } from "express";
import { z } from "zod";
import { db } from "../db";
import { voiceCalls, voiceEscalations, crmCustomers, crmProjects, voiceNumbers } from "@shared/schema";
import { and, desc, eq, gte, inArray, lte, notInArray, or, sql, type SQL } from "drizzle-orm";
import { CALL_OUTCOMES } from "@shared/voice-profile";
import { voiceContext, type GetUser } from "./context";
import { openRecording, parseRange } from "./recordings";
import { listSpamLedger, presentSpamRow, unblockNumber, blockNumber, spamNumber } from "./spam";
import { getVoiceUsageRow, summarizeVoiceUsage, voiceMonthKey } from "./billing-usage";
import { closeEscalation, listEscalations, confirmEscalationByToken, startVoiceEscalationWorker, kindLabel } from "./escalations";
import { logActivity } from "../crm/activity";

export const SPAM_OUTCOMES = ["spam", "blocked"] as const;

const listQuery = z.object({
  outcome: z.enum(CALL_OUTCOMES).optional(),
  spam: z.enum(["1", "0", "true", "false"]).optional(),
  numberId: z.string().max(64).optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}/).optional(),
  q: z.string().trim().max(120).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

/** The list shape: everything but the heavy JSON columns. */
const listColumns = {
  id: voiceCalls.id, callNo: voiceCalls.callNo, numberId: voiceCalls.numberId, callSid: voiceCalls.callSid, direction: voiceCalls.direction,
  fromNumber: voiceCalls.fromNumber, toNumber: voiceCalls.toNumber, persona: voiceCalls.persona,
  startedAt: voiceCalls.startedAt, endedAt: voiceCalls.endedAt, durationSeconds: voiceCalls.durationSeconds, billedMinutes: voiceCalls.billedMinutes,
  outcome: voiceCalls.outcome, callerName: voiceCalls.callerName, callerCity: voiceCalls.callerCity, serviceNeeded: voiceCalls.serviceNeeded,
  summary: voiceCalls.summary, recordingKey: voiceCalls.recordingKey, recordingSeconds: voiceCalls.recordingSeconds,
  customerId: voiceCalls.customerId, projectId: voiceCalls.projectId, leadDeliveredAt: voiceCalls.leadDeliveredAt,
  spamConfidence: voiceCalls.spamConfidence, spamReason: voiceCalls.spamReason,
};

/**
 * Answer JSON without going through res.json: the request logger in
 * server/index.ts copies every res.json body into the log line, and call
 * transcripts, summaries and escalation texts are recorded conversations —
 * they stay out of the logs (SPEC § 17). Same bytes on the wire.
 */
function sendUnlogged(res: Response, body: unknown) {
  res.setHeader("Cache-Control", "no-store");
  res.type("application/json").send(JSON.stringify(body));
}

/** An IANA zone name we can hand to Postgres (anything else → the CRM's default, America/New_York). */
export function summaryTimezone(raw: unknown): string {
  const tz = typeof raw === "string" ? raw.trim() : "";
  if (!tz || !/^[A-Za-z]+(?:\/[A-Za-z0-9_+-]+){0,2}$/.test(tz)) return "America/New_York";
  try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); return tz; } catch { return "America/New_York"; }
}

/** Spam an outside receptionist screened out this calendar month (org time zone); never on the minute meter.
 *  engine 'external' = server/voice/ingest.ts INGEST_ENGINE (not imported: ingest.ts imports this file). */
export async function outsideSpamThisMonth(orgId: string, timezone: unknown): Promise<number> {
  const tz = summaryTimezone(timezone);
  const r = await db.execute(sql`
    SELECT count(*)::int AS n FROM voice_calls
     WHERE org_id = ${orgId} AND engine = 'external'
       AND outcome IN (${sql.join(SPAM_OUTCOMES.map((o) => sql`${o}`), sql`, `)})
       AND started_at >= (date_trunc('month', now() AT TIME ZONE ${tz}) AT TIME ZONE ${tz}) AT TIME ZONE 'UTC'`);
  return Number((r as any).rows?.[0]?.n ?? 0);
}

export type CallResultsRange = "7d" | "30d" | "month" | "all";

/** The Results panel's numbers for one org, counted from voice_calls (see the /calls/summary route). */
export async function callResultsSummary(orgId: string, range: CallResultsRange, timezone: unknown) {
  const tz = summaryTimezone(timezone);
  const since =
    range === "7d" ? sql`now() AT TIME ZONE 'UTC' - interval '7 days'`
    : range === "30d" ? sql`now() AT TIME ZONE 'UTC' - interval '30 days'`
    : range === "month" ? sql`(date_trunc('month', now() AT TIME ZONE ${tz}) AT TIME ZONE ${tz}) AT TIME ZONE 'UTC'`
    : null;
  const where = since ? sql`c.org_id = ${orgId} AND c.started_at >= ${since}` : sql`c.org_id = ${orgId}`;
  const totals = await db.execute(sql`
    SELECT count(*)::int AS total,
           coalesce(round(sum(coalesce(c.duration_seconds, 0)) / 60.0), 0)::int AS minutes,
           count(c.recording_key)::int AS recordings,
           min(c.started_at) AS first_call
      FROM voice_calls c WHERE ${where}`);
  const outcomes = await db.execute(sql`
    SELECT coalesce(c.outcome, 'in_progress') AS outcome, count(*)::int AS n
      FROM voice_calls c WHERE ${where} GROUP BY 1`);
  const lines = await db.execute(sql`
    SELECT coalesce(nullif(c.flags->'ingest'->>'market', '') || ' line', n.label, n.phone_number, c.to_number, 'Unknown line') AS label,
           count(*)::int AS n,
           count(*) FILTER (WHERE c.outcome IN ('lead_submitted', 'booked'))::int AS leads
      FROM voice_calls c LEFT JOIN voice_numbers n ON n.id = c.number_id AND n.org_id = c.org_id
     WHERE ${where} GROUP BY 1 ORDER BY 2 DESC LIMIT 20`);
  const t = (totals as any).rows?.[0] ?? {};
  return {
    range,
    timezone: tz,
    total: Number(t.total ?? 0),
    minutes: Number(t.minutes ?? 0),
    recordings: Number(t.recordings ?? 0),
    firstCallAt: t.first_call ?? null,
    outcomes: Object.fromEntries(((outcomes as any).rows ?? []).map((r: any) => [String(r.outcome), Number(r.n)])) as Record<string, number>,
    lines: ((lines as any).rows ?? []).map((r: any) => ({ label: String(r.label), calls: Number(r.n), leads: Number(r.leads) })),
  };
}

export function presentEscalation(row: typeof voiceEscalations.$inferSelect) {
  const state = row.closedAt ? "closed" : row.followupSentAt ? "followed_up" : row.confirmedAt ? "confirmed" : "waiting";
  return { ...row, state, kindLabel: kindLabel(row.kind) };
}

export function registerVoiceCallRoutes(app: Express, getDevUser: GetUser): void {
  // The reminder loop (production only: VOICE_ESCALATION_WORKER_ENABLED=true).
  startVoiceEscalationWorker();

  /** GET ?outcome=&spam=1&numberId=&from=&to=&q=&page=&limit= → { calls: [...], total, page, limit }.
   *  No outcome and no spam flag = the non-spam log the Overview's "Recent calls" and the Calls tab show;
   *  ?spam=1 narrows the same list to spam outcomes. */
  app.get("/api/crm/voice/calls", async (req: any, res) => {
    const v = await voiceContext(req, res, getDevUser);
    if (!v) return;
    const parsed = listQuery.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ code: "invalid", issues: parsed.error.issues });
    const q = parsed.data;
    const spamView = q.spam === "1" || q.spam === "true";
    const where: SQL[] = [eq(voiceCalls.orgId, v.ctx.org.id)];
    if (q.outcome) where.push(eq(voiceCalls.outcome, q.outcome));
    else if (spamView) where.push(inArray(voiceCalls.outcome, [...SPAM_OUTCOMES]));
    else where.push(or(sql`${voiceCalls.outcome} is null`, notInArray(voiceCalls.outcome, [...SPAM_OUTCOMES]))!);
    if (q.numberId) where.push(eq(voiceCalls.numberId, q.numberId));
    if (q.from) where.push(gte(voiceCalls.startedAt, new Date(q.from)));
    if (q.to) where.push(lte(voiceCalls.startedAt, new Date(`${q.to.slice(0, 10)}T23:59:59.999Z`)));
    if (q.q && /^#?\d{1,9}$/.test(q.q)) {
      // "#57" / "57": the call number (a bare number also still matches phone digits)
      const n = Number(q.q.replace("#", ""));
      const like = `%${q.q.replace("#", "")}%`;
      where.push(or(eq(voiceCalls.callNo, n), sql`${voiceCalls.fromNumber} ilike ${like}`)!);
    } else if (q.q) {
      const like = `%${q.q.replace(/[%_]/g, "")}%`;
      where.push(or(
        sql`${voiceCalls.callerName} ilike ${like}`, sql`${voiceCalls.fromNumber} ilike ${like}`,
        sql`${voiceCalls.summary} ilike ${like}`, sql`${voiceCalls.serviceNeeded} ilike ${like}`,
        sql`${voiceCalls.callerCity} ilike ${like}`,
      )!);
    }
    const cond = and(...where);
    const [{ n: total }] = await db.select({ n: sql<number>`count(*)::int` }).from(voiceCalls).where(cond);
    const calls = await db.select(listColumns).from(voiceCalls).where(cond)
      .orderBy(desc(voiceCalls.startedAt)).limit(q.limit).offset((q.page - 1) * q.limit);
    sendUnlogged(res, { calls: calls.map((c) => ({ ...c, spamConfidence: c.spamConfidence == null ? null : Number(c.spamConfidence), hasRecording: !!c.recordingKey })), total, page: q.page, limit: q.limit });
  });

  /**
   * GET ?range=7d|30d|month|all → the Results panel (owner, 2026-10-02: "The clients want to see this data when
   * using this service"): calls by outcome, by line, minutes talked and recordings, counted from the call log itself
   * (so calls another receptionist pushed in through ingest.ts count too, though they are never metered).
   * "month" is the calendar month in the org's timezone. Registered before /calls/:id so "summary" isn't an id.
   */
  app.get("/api/crm/voice/calls/summary", async (req: any, res) => {
    const v = await voiceContext(req, res, getDevUser);
    if (!v) return;
    const range = (["7d", "30d", "month", "all"] as const).find((r) => r === req.query.range) ?? "30d";
    try {
      sendUnlogged(res, await callResultsSummary(v.ctx.org.id, range, (v.ctx.org as any).timezone));
    } catch (e: any) {
      console.error("[voice] calls summary failed:", e?.message || e);
      res.status(500).json({ message: "Could not load the call results." });
    }
  });

  /** GET → VoiceCallRow + { customer, project, number, escalations }. Powers the Call
   *  Assistant call detail sheet (data-testid sheet-call-detail — every row and button in calls-detail.tsx). */
  app.get("/api/crm/voice/calls/:id", async (req: any, res) => {
    const v = await voiceContext(req, res, getDevUser);
    if (!v) return;
    const [call] = await db.select().from(voiceCalls)
      .where(and(eq(voiceCalls.orgId, v.ctx.org.id), eq(voiceCalls.id, String(req.params.id)))).limit(1);
    if (!call) return res.status(404).json({ message: "Call not found" });
    const [customer] = call.customerId
      ? await db.select({ id: crmCustomers.id, displayName: crmCustomers.displayName, phone: crmCustomers.phone, email: crmCustomers.email, city: crmCustomers.city })
        .from(crmCustomers).where(and(eq(crmCustomers.orgId, v.ctx.org.id), eq(crmCustomers.id, call.customerId))).limit(1)
      : [];
    const [project] = call.projectId
      ? await db.select({ id: crmProjects.id, name: crmProjects.name, status: crmProjects.status }).from(crmProjects)
        .where(and(eq(crmProjects.orgId, v.ctx.org.id), eq(crmProjects.id, call.projectId))).limit(1)
      : [];
    const [number] = call.numberId
      ? await db.select({ id: voiceNumbers.id, label: voiceNumbers.label, phoneNumber: voiceNumbers.phoneNumber, location: voiceNumbers.location }).from(voiceNumbers)
        .where(and(eq(voiceNumbers.orgId, v.ctx.org.id), eq(voiceNumbers.id, call.numberId))).limit(1)
      : [];
    const escalations = (await listEscalations(v.ctx.org.id, { callId: call.id })).map(presentEscalation);
    sendUnlogged(res, {
      ...call,
      spamConfidence: call.spamConfidence == null ? null : Number(call.spamConfidence),
      hasRecording: !!call.recordingKey,
      recordingUrl: call.recordingKey ? `/api/crm/voice/calls/${call.id}/recording` : null,
      customer: customer ?? null, project: project ?? null, number: number ?? null, escalations,
    });
  });

  /** GET → audio/wav streamed from R2 (recording_key); 404 when none. */
  app.get("/api/crm/voice/calls/:id/recording", async (req: any, res) => {
    const v = await voiceContext(req, res, getDevUser);
    if (!v) return;
    const [call] = await db.select({ id: voiceCalls.id, recordingKey: voiceCalls.recordingKey, callSid: voiceCalls.callSid }).from(voiceCalls)
      .where(and(eq(voiceCalls.orgId, v.ctx.org.id), eq(voiceCalls.id, String(req.params.id)))).limit(1);
    if (!call?.recordingKey) return res.status(404).json({ message: "No recording for this call" });
    try {
      // Range + Content-Length so the browser's player knows the length and can seek (a chunked stream
      // with no length reads as an endless recording).
      const range = parseRange(req.headers.range);
      const { body, contentType, contentLength, contentRange } = await openRecording(call.recordingKey, range);
      if (!body) return res.status(404).json({ message: "Recording not found" });
      if (range && contentRange) { res.status(206); res.setHeader("Content-Range", contentRange); }
      if (contentLength != null) res.setHeader("Content-Length", String(contentLength));
      res.setHeader("Accept-Ranges", "bytes");
      res.setHeader("Content-Type", contentType || "audio/wav");
      res.setHeader("Cache-Control", "private, no-store");
      res.setHeader("Content-Disposition", `inline; filename="${call.callSid}.wav"`);
      const stream = body as any;
      if (typeof stream.pipe === "function") stream.pipe(res);
      else if (typeof stream[Symbol.asyncIterator] === "function") { for await (const chunk of stream) res.write(chunk); res.end(); }
      else res.end(Buffer.from(await new Response(stream).arrayBuffer()));
    } catch (e: any) {
      if (e?.name === "InvalidRange" || e?.$metadata?.httpStatusCode === 416) {
        if (!res.headersSent) return res.status(416).json({ message: "Requested range not satisfiable" });
      }
      console.error("[voice] recording stream failed:", e?.message || e);
      if (!res.headersSent) res.status(502).json({ message: "Could not fetch the recording" });
      else res.end();
    }
  });

  /**
   * GET → { entries: VoiceSpamRow[], blocked, thisMonth } — `thisMonth` is the
   * month's spam count from the meter (spam + blocked calls, and how many of
   * the free spam calls are used: billing-usage.ts).
   * Feeds the Calls → Spam tab (badge-spam-this-month, the thisMonth summary stats, table-spam-ledger).
   */
  app.get("/api/crm/voice/spam", async (req: any, res) => {
    const v = await voiceContext(req, res, getDevUser);
    if (!v) return;
    const month = voiceMonthKey();
    const [ledger, usage, outside] = await Promise.all([
      listSpamLedger(v.ctx.org.id), getVoiceUsageRow(v.ctx.org.id, month),
      outsideSpamThisMonth(v.ctx.org.id, (v.ctx.org as any).timezone),
    ]);
    const entries = ledger.map(presentSpamRow);
    const u = summarizeVoiceUsage(usage, month, v.allowance.minutes, v.allowance.overageCentsPerMinute);
    sendUnlogged(res, {
      entries,
      blocked: entries.filter((e) => e.blocked).length,
      thisMonth: {
        // The meter only counts calls ConstructHUB's engine answered; an outside receptionist's (Alpine's Janice)
        // screened calls are added from her pushed calls (owner 2026-10-04: "why are the stats not updated").
        month, spamCalls: u.spamCallsThisMonth + outside, screened: u.spamCalls + outside, rejected: u.blockedCalls,
        freeSpamCalls: u.freeSpamCalls, freeSpamMinutes: u.freeSpamMinutes, freeSpamCallsLimit: u.freeSpamCallsLimit,
      },
    });
  });
  /** POST /:id/unblock → { unblocked: true, entry } */
  app.post("/api/crm/voice/spam/:id/unblock", async (req: any, res) => {
    const v = await voiceContext(req, res, getDevUser, { perm: "manageSettings" });
    if (!v) return;
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ message: "Bad id" });
    const row = await unblockNumber(v.ctx.org.id, id);
    if (!row) return res.status(404).json({ message: "Not in the ledger" });
    logActivity(v.ctx, "call.unblocked", { entityType: "voice_spam", entityId: String(row.id), meta: { phone: row.phoneNumber } });
    res.json({ unblocked: true, entry: presentSpamRow(row) });
  });
  /** POST /block { phoneNumber, reason? } → { blocked: true, entry } */
  app.post("/api/crm/voice/spam/block", async (req: any, res) => {
    const v = await voiceContext(req, res, getDevUser, { perm: "manageSettings" });
    if (!v) return;
    const parsed = z.object({ phoneNumber: z.string().trim().min(7).max(40), reason: z.string().trim().max(200).optional() }).safeParse(req.body);
    if (!parsed.success || !spamNumber(parsed.data.phoneNumber)) return res.status(400).json({ message: "Enter a phone number like +18135550100" });
    const row = await blockNumber(v.ctx.org.id, parsed.data.phoneNumber, v.ctx.member.id, parsed.data.reason || "Blocked by hand");
    if (!row) return res.status(400).json({ message: "Enter a phone number like +18135550100" });
    logActivity(v.ctx, "call.blocked", { entityType: "voice_spam", entityId: String(row.id), meta: { phone: row.phoneNumber } });
    res.status(201).json({ blocked: true, entry: presentSpamRow(row) });
  });

  /** GET ?open=1 → { escalations: [...] }. Feeds the Calls → Escalations tab
   *  and its open-count badge (which queries ?open=1). */
  app.get("/api/crm/voice/escalations", async (req: any, res) => {
    const v = await voiceContext(req, res, getDevUser);
    if (!v) return;
    const open = req.query.open === "1" || req.query.open === "true";
    const rows = await listEscalations(v.ctx.org.id, { open, limit: 200 });
    sendUnlogged(res, { escalations: rows.map(presentEscalation) });
  });
  /** POST /:id/close { reason? } → { closed: true, escalation } */
  app.post("/api/crm/voice/escalations/:id/close", async (req: any, res) => {
    const v = await voiceContext(req, res, getDevUser);
    if (!v) return;
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ message: "Bad id" });
    const reason = `closed by ${v.ctx.member.displayName || v.ctx.member.email}${req.body?.reason ? `: ${String(req.body.reason).slice(0, 120)}` : ""}`;
    const row = await closeEscalation(v.ctx.org.id, id, reason);
    if (!row) return res.status(404).json({ message: "No open escalation with that id" });
    logActivity(v.ctx, "call.escalation_closed", { entityType: "voice_escalation", entityId: String(row.id), customerId: null, meta: { kind: row.kind, recipient: row.recipientName } });
    sendUnlogged(res, { closed: true, escalation: presentEscalation(row) });
  });

  /**
   * PUBLIC: the "Got it" link in an escalation email. Signed per row, no
   * session. Answers a tiny HTML page either way; never reveals the call.
   */
  app.get("/api/public/voice/escalations/:id/confirm", async (req: Request, res: Response) => {
    const id = Number(req.params.id);
    const state = Number.isInteger(id) ? await confirmEscalationByToken(id, req.query.t).catch(() => "invalid" as const) : "invalid";
    const text = state === "confirmed" ? "Got it — reminders stopped. You'll get one follow-up tomorrow asking whether it was taken care of."
      : state === "closed" ? "Thanks — marked done."
      : state === "already" ? "This one is already confirmed."
      : "This link is not valid.";
    res.status(state === "invalid" ? 404 : 200).type("html")
      .send(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>ConstructHUB</title><body style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;padding:32px;max-width:480px"><h2 style="margin:0 0 8px">${text}</h2><p style="color:#666">ConstructHUB Call Assistant</p></body>`);
  });
}
