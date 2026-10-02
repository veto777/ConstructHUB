/**
 * Escalations with reminders (docs/call-assistant/SPEC.md § 11) — OWNER:
 * calls+crm lane. A port of Alpine's voice/escalations.py onto the CRM's own
 * channels.
 *
 * An `alert` decision names a kind (human, urgent, existing_customer, …). The
 * first enabled rule in the profile that lists the kind gets a text (through
 * server/crm/sms.ts, metered like every other text the org sends) or an email
 * (with a signed "Got it" link), and a voice_escalations row. No rule →
 * `fallbackToOwner`: the org's CRM notification channels. `urgent` and
 * `human` always also reach the owners.
 *
 * The reminder worker (every 30 min, VOICE_ESCALATION_WORKER_ENABLED=true on
 * production only) resends unconfirmed escalations every
 * `remind_every_minutes` between `remind_from_hour` and `remind_to_hour` in
 * the company's timezone until `max_days`; a reply from the recipient (inbound
 * SMS hook in server/crm/sms.ts, or the email link) confirms; 20 h after a
 * confirmation one next-day follow-up goes out ("was this taken care of?
 * Reply DONE"), then the row closes. The assistant never gives out a
 * recipient's number.
 */
import { createHmac, timingSafeEqual } from "crypto";
import { db } from "../db";
import {
  crmMembers, crmOrgs, crmNotificationChannel, voiceEscalations,
  type VoiceCallRow, type VoiceEscalationRow,
} from "@shared/schema";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { ESCALATION_KINDS, type EscalationKind, type EscalationRule } from "@shared/voice-profile";
import { normalizePhone, resolveSmsSender, sendSms } from "../crm/sms";
import { notifyMembers } from "../crm/notify";
import { recordActivity } from "../crm/activity";
import { sendWithFallback } from "../email";
import { prettyPhone, leadFactsFrom } from "./leads";
import { loadOrgVoiceContext, type OrgVoiceContext } from "./org-profile";
import { recordFailure } from "../ops/issues";

export const KIND_LABELS: Record<EscalationKind, string> = {
  human: "Asked for a person",
  urgent: "Emergency",
  existing_customer: "Existing customer",
  estimate_missing: "Estimate not received",
  scheduling: "Job scheduling",
  contract: "Signed contract",
  payment: "Payment",
  complaint: "Complaint",
  vendor: "Vendor / supplier",
  other: "Needs a person",
};
export const kindLabel = (kind: string): string => (KIND_LABELS as Record<string, string>)[kind] ?? kind;
export const isEscalationKind = (k: unknown): k is EscalationKind =>
  typeof k === "string" && (ESCALATION_KINDS as readonly string[]).includes(k);

/** Hours after a confirmation before the next-day follow-up (Alpine: 20 h). */
export const FOLLOW_UP_AFTER_HOURS = 20;
/** Days after the follow-up with no reply before the row closes itself. */
export const CLOSE_AFTER_FOLLOW_UP_DAYS = 3;
export const WORKER_INTERVAL_MS = 30 * 60 * 1000;

const esc = (s?: string | null) =>
  String(s ?? "").replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]!));

// ── Body rendering ───────────────────────────────────────────────────────────

export type EscalationFacts = {
  callerName: string; callback: string; address: string; summary: string; assistant: string; company: string; kind: string;
};

export function escalationFacts(ctx: Pick<OrgVoiceContext, "assistantName" | "companyName">, call: VoiceCallRow, kind: string, summary: string, slots?: Record<string, string> | null): EscalationFacts {
  const f = leadFactsFrom(call, slots ?? call.slots ?? {});
  return {
    callerName: f.name || "unknown",
    callback: f.phone ? prettyPhone(f.phone) : "unknown",
    address: [f.address, f.city && !(f.address ?? "").toLowerCase().includes(f.city.toLowerCase()) ? f.city : null].filter(Boolean).join(", "),
    summary: (summary || call.summary || "").trim(),
    assistant: ctx.assistantName,
    company: ctx.companyName,
    kind: kindLabel(kind),
  };
}

/** Mustache-light: {{callerName}} {{callback}} {{address}} {{summary}} {{assistant}} {{company}} {{kind}}. */
export function renderTemplate(template: string, facts: EscalationFacts): string {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key: string) => (facts as Record<string, string>)[key] ?? "");
}

/** Alpine's default text: company · kind · caller · callback · address · gist · "Reply OK to confirm". */
export function defaultEscalationBody(facts: EscalationFacts): string {
  const lines = [
    `${facts.company.toUpperCase()} — ${facts.assistant} (virtual assistant)`,
    facts.kind,
    `Caller: ${facts.callerName} · ${facts.callback}`,
  ];
  if (facts.address) lines.push(facts.address);
  if (facts.summary) lines.push(facts.summary);
  lines.push("Reply OK to confirm you have it. (Reminders continue until confirmed.)");
  return lines.join("\n");
}

export function escalationBody(rule: Pick<EscalationRule, "template"> | null, facts: EscalationFacts): string {
  const custom = rule?.template?.trim();
  const body = custom ? renderTemplate(custom, facts) : defaultEscalationBody(facts);
  return body.slice(0, 1200);
}

/** The first enabled rule that lists the kind. */
export function matchRule(rules: EscalationRule[], kind: string): EscalationRule | null {
  return rules.find((r) => r.enabled && (r.kinds as string[]).includes(kind)) ?? null;
}

// ── Email confirmation link ──────────────────────────────────────────────────

/**
 * The HMAC key for the email "Got it" link: derived from VOICE_INTERNAL_SECRET
 * (else SESSION_SECRET). Neither set → no link is offered and every token is
 * refused; there is no built-in fallback key.
 */
function confirmSecret(): string | null {
  const base = process.env.VOICE_INTERNAL_SECRET?.trim() || process.env.SESSION_SECRET?.trim();
  return base ? `voice-escalation-confirm:${base}` : null;
}
export function confirmToken(id: number, orgId: string): string | null {
  const key = confirmSecret();
  return key ? createHmac("sha256", key).update(`${id}:${orgId}`).digest("hex").slice(0, 40) : null;
}
export function confirmTokenOk(id: number, orgId: string, token: unknown): boolean {
  const expected = confirmToken(id, orgId);
  if (!expected || typeof token !== "string") return false;
  const a = Buffer.from(expected), b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}
export function confirmPath(id: number, orgId: string): string | null {
  const t = confirmToken(id, orgId);
  return t ? `/api/public/voice/escalations/${id}/confirm?t=${t}` : null;
}

/** Absolute origin for links in emails. Only an http(s) URL counts (Vite/Vitest set BASE_URL="/"). */
export function publicBase(): string {
  const candidate = [process.env.APP_URL, process.env.BASE_URL].find((v) => !!v && /^https?:\/\/[^/]/.test(v.trim()));
  return (candidate?.trim() || "https://constructhub.us").replace(/\/+$/, "");
}

// ── Sending ──────────────────────────────────────────────────────────────────

type SendOutcome = { ok: boolean; sid: string | null; error: string | null };

async function sendEscalation(org: typeof crmOrgs.$inferSelect, row: Pick<VoiceEscalationRow, "id" | "orgId" | "channel" | "recipient" | "recipientName">, body: string, subject: string): Promise<SendOutcome> {
  if (row.channel === "sms") {
    const r = await sendSms(row.recipient, body, org.customFields, org.id).catch((e: any) => ({ ok: false, sid: null, error: String(e?.message || e) } as any));
    return { ok: !!r?.ok, sid: r?.sid ?? null, error: r?.ok ? null : (r?.error ?? "send failed") };
  }
  const path = confirmPath(row.id, row.orgId);
  const link = path ? `${publicBase()}${path}` : null;
  try {
    await sendWithFallback({
      to: row.recipient,
      subject,
      text: link ? `${body}\n\nGot it? Confirm here: ${link}` : body,
      html: `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif"><p style="white-space:pre-wrap">${esc(body)}</p>` +
        (link ? `<p><a href="${esc(link)}" style="display:inline-block;padding:10px 16px;background:#F97316;color:#fff;border-radius:6px;text-decoration:none">Got it — stop the reminders</a></p>` : "") +
        `</div>`,
    } as any);
    return { ok: true, sid: null, error: null };
  } catch (e: any) {
    return { ok: false, sid: null, error: String(e?.message || e).slice(0, 300) };
  }
}

/** Owners through the CRM's channels (bell/email/sms per the leadReceived matrix). */
async function notifyOwners(ctx: OrgVoiceContext, call: VoiceCallRow, kind: string, facts: EscalationFacts, opts: { update?: boolean } = {}): Promise<void> {
  const who = facts.callerName === "unknown" ? facts.callback : facts.callerName;
  const base = kind === "human" ? `${who} asked for a person` : `${facts.kind} — call from ${who}`;
  const title = opts.update ? `Details added — ${base}` : base;
  await notifyMembers({
    org: ctx.org, pref: "leadReceived", type: `call.alert.${kind}`, title,
    body: facts.summary || null, link: `/crm/call-assistant?tab=calls&call=${call.id}`,
  });
  if (!crmNotificationChannel(ctx.org.customFields, "leadReceived", "email")) return;
  const members = await db.select().from(crmMembers).where(and(eq(crmMembers.orgId, ctx.org.id), eq(crmMembers.status, "active")));
  const to = members.filter((m) => m.role === "owner" && m.email).map((m) => m.email);
  if (!to.length) return;
  await sendWithFallback({
    to: to.join(","),
    subject: `🚨 ${title}`,
    html: `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif"><p style="white-space:pre-wrap">${esc(defaultEscalationBody(facts).replace(/\nReply OK.*$/, ""))}</p>` +
      `<p>The call, transcript and recording are under Call Assistant → Calls.</p></div>`,
  } as any).catch((e: any) => {
    console.error("[voice] owner alert email failed:", e?.message || e);
    void recordFailure("call_assistant", "Call Assistant owner alert email", e, { callId: call.id, orgId: ctx.org.id });
  });
}

export type RaiseResult = { escalationId: number | null; sent: boolean; fallback: boolean; recipientName: string | null; duplicate: boolean };

/**
 * Raise one escalation for a call. Idempotent per (call, kind): a second
 * `alert` of the same kind during one call (or the end report repeating a
 * mid-call event) does not text anyone twice.
 */
export async function raiseEscalation(args: {
  ctx: OrgVoiceContext; call: VoiceCallRow; kind: string; summary: string; slots?: Record<string, string> | null;
}): Promise<RaiseResult> {
  const { ctx, call } = args;
  const kind = isEscalationKind(args.kind) ? args.kind : "other";
  const facts = escalationFacts(ctx, call, kind, args.summary, args.slots);
  const rule = matchRule(ctx.profile.escalations.rules, kind);
  const [existing] = await db.select().from(voiceEscalations)
    .where(and(eq(voiceEscalations.orgId, ctx.org.id), eq(voiceEscalations.callId, call.id), eq(voiceEscalations.kind, kind))).limit(1);
  const callFlags = (call.flags ?? {}) as Record<string, unknown>;
  const alreadyFallback = Array.isArray(callFlags.alertedKinds) && (callFlags.alertedKinds as string[]).includes(kind);
  if (existing || alreadyFallback) {
    // The same kind again (a mid-call update, or the end report repeating it): no second page — but when the
    // call has since given a name or an address the first message lacked, the stored body (what reminders
    // resend) is rebuilt and one "details added" message goes out.
    await addEscalationDetails(ctx, call, kind, facts, rule, existing ?? null)
      .catch((e: any) => {
        console.error("[voice] escalation details update failed:", e?.message || e);
        void recordFailure("call_assistant", "Call Assistant escalation details update", e, { callId: call.id, orgId: ctx.org.id, kind });
      });
    return existing
      ? { escalationId: existing.id, sent: true, fallback: false, recipientName: existing.recipientName, duplicate: true }
      : { escalationId: null, sent: true, fallback: true, recipientName: null, duplicate: true };
  }
  recordActivity({
    orgId: ctx.org.id, actorLabel: `${ctx.assistantName} (Call Assistant)`, action: "call.alert",
    entityType: "voice_call", entityId: call.id, customerId: call.customerId ?? null,
    meta: { kind, label: facts.kind, summary: facts.summary, recipient: rule?.recipientName ?? null },
  });

  let result: RaiseResult = { escalationId: null, sent: false, fallback: false, recipientName: null, duplicate: false };
  if (rule) {
    const recipient = rule.channel === "sms" ? normalizePhone(rule.recipient) : rule.recipient.trim().toLowerCase();
    if (recipient) {
      const body = escalationBody(rule, facts);
      const r = rule.reminders;
      const [row] = await db.insert(voiceEscalations).values({
        orgId: ctx.org.id, callId: call.id, kind, ruleId: rule.id, channel: rule.channel,
        recipient, recipientName: rule.recipientName, body,
        remindEveryMinutes: r.enabled ? r.everyMinutes : 0, remindFromHour: r.fromHour, remindToHour: r.toHour,
        maxDays: r.maxDays, followUpNextDay: r.followUpNextDay,
      }).returning();
      const sent = await sendEscalation(ctx.org, row, body, `${facts.company}: ${facts.kind} — ${facts.callerName}`);
      await db.update(voiceEscalations).set({
        sentCount: sent.ok ? 1 : 0, lastSentAt: sent.ok ? new Date() : null, lastProviderSid: sent.sid, lastError: sent.error,
      }).where(eq(voiceEscalations.id, row.id));
      result = { escalationId: row.id, sent: sent.ok, fallback: false, recipientName: rule.recipientName, duplicate: false };
    }
  }
  // No rule (or an unusable recipient) → the owners; urgent/human always also reach the owners.
  let ownersNotified = false;
  if ((!result.escalationId && ctx.profile.escalations.fallbackToOwner) || kind === "urgent" || kind === "human") {
    await notifyOwners(ctx, call, kind, facts).catch((e: any) => {
      console.error("[voice] owner alert failed:", e?.message || e);
      void recordFailure("call_assistant", "Call Assistant owner alert", e, { callId: call.id, orgId: ctx.org.id, kind });
    });
    result.fallback = true;
    result.sent = true;
    ownersNotified = true;
  }
  if (ownersNotified) await rememberOwnerFacts(call, kind, facts);
  // Remember the kind on the call (merged in SQL, so a concurrent end report keeps its own keys).
  await db.execute(sql`
    update voice_calls
       set flags = jsonb_set(coalesce(flags, '{}'::jsonb), '{alertedKinds}',
         (select coalesce(jsonb_agg(distinct k), '[]'::jsonb)
            from jsonb_array_elements_text(coalesce(flags->'alertedKinds', '[]'::jsonb) || to_jsonb(${kind}::text)) as k))
     where id = ${call.id}`);
  const flags = { ...((call.flags ?? {}) as Record<string, unknown>) };
  flags.alertedKinds = [...new Set([...(Array.isArray(flags.alertedKinds) ? flags.alertedKinds as string[] : []), kind])];
  call.flags = flags;
  return result;
}

/** What the owners' alert carried, per kind (voice_calls.flags.alertFacts), so a later update can tell what's new. */
type SentFacts = { callerName: string; address: string };

async function rememberOwnerFacts(call: VoiceCallRow, kind: string, facts: EscalationFacts): Promise<void> {
  const entry: SentFacts = { callerName: facts.callerName, address: facts.address };
  await db.execute(sql`
    update voice_calls
       set flags = coalesce(flags, '{}'::jsonb) || jsonb_build_object('alertFacts',
         coalesce(flags->'alertFacts', '{}'::jsonb) || jsonb_build_object(${kind}::text, ${JSON.stringify(entry)}::jsonb))
     where id = ${call.id}`);
  const flags = { ...((call.flags ?? {}) as Record<string, unknown>) };
  flags.alertFacts = { ...((flags.alertFacts ?? {}) as Record<string, SentFacts>), [kind]: entry };
  call.flags = flags;
}

/**
 * True when `facts` has a caller name or a street address that `had` (a body, or the facts sent before)
 * lacks — worth a "details added" message. A city added to a street that was already there is not.
 */
export function factsAddDetail(facts: Pick<EscalationFacts, "callerName" | "address">, had: string | SentFacts): boolean {
  const text = typeof had === "string" ? had.toLowerCase() : `${had.callerName === "unknown" ? "" : had.callerName}\n${had.address}`.toLowerCase();
  const name = facts.callerName !== "unknown" && !!facts.callerName && !text.includes(facts.callerName.toLowerCase());
  const street = facts.address.split(",")[0].trim().toLowerCase();
  return name || (!!street && !text.includes(street));
}

async function addEscalationDetails(ctx: OrgVoiceContext, call: VoiceCallRow, kind: string, facts: EscalationFacts, rule: EscalationRule | null, row: VoiceEscalationRow | null): Promise<void> {
  const fuller = !!row && !!facts.address && !row.body.toLowerCase().includes(facts.address.toLowerCase());
  if (row && !row.closedAt && (factsAddDetail(facts, row.body) || fuller)) {
    // the reminders resend the stored body, so it always gets the fuller facts; a message goes out only
    // when a name or a street is new
    const body = escalationBody(rule, facts);
    await db.update(voiceEscalations).set({ body }).where(eq(voiceEscalations.id, row.id));
    if (row.sentCount > 0 && factsAddDetail(facts, row.body)) {
      const sent = await sendEscalation(ctx.org, row, `Details added:\n\n${body}`, `${facts.company}: ${facts.kind} — details added for ${facts.callerName}`);
      await db.update(voiceEscalations).set({ lastProviderSid: sent.sid, lastError: sent.error }).where(eq(voiceEscalations.id, row.id));
    }
  }
  const sentToOwners = ((call.flags ?? {}) as { alertFacts?: Record<string, SentFacts> }).alertFacts?.[kind];
  if (sentToOwners && factsAddDetail(facts, sentToOwners)) {
    await notifyOwners(ctx, call, kind, facts, { update: true });
    await rememberOwnerFacts(call, kind, facts);
  }
}

// ── Confirmation ─────────────────────────────────────────────────────────────

/**
 * A text from an open escalation's recipient confirms it (first reply) or,
 * after the next-day follow-up, closes it (any reply, typically "DONE").
 * Called from the inbound SMS webhook (server/crm/sms.ts, after STOP/START/
 * HELP). `to` is the number the text was sent to: only escalations whose org
 * sends from that number are touched, so one person on two orgs' escalation
 * lists confirms only the org they answered. Without `to` nothing is touched
 * (no cross-org match). The SMS hook calls this only for a verified webhook.
 * Returns how many rows the reply touched.
 */
export async function confirmEscalationByReply(from: string | null | undefined, text: string, to?: string | null, now = new Date()): Promise<number> {
  const phone = normalizePhone(from);
  if (!phone || !normalizePhone(to)) return 0;
  const rows = await db.select().from(voiceEscalations)
    .where(and(eq(voiceEscalations.channel, "sms"), eq(voiceEscalations.recipient, phone), isNull(voiceEscalations.closedAt)))
    .orderBy(asc(voiceEscalations.id));
  if (!rows.length) return 0;
  const inbound = normalizePhone(to)!;
  const senderOf = new Map<string, string | null>();
  {
    const orgIds = [...new Set(rows.map((r) => r.orgId))];
    const orgRows = await db.select({ id: crmOrgs.id, customFields: crmOrgs.customFields }).from(crmOrgs).where(inArray(crmOrgs.id, orgIds));
    for (const o of orgRows) senderOf.set(o.id, normalizePhone(resolveSmsSender(o.customFields)?.from ?? null));
  }
  let touched = 0;
  const reply = String(text ?? "").trim().slice(0, 300);
  for (const row of rows) {
    // Skip only an org whose sender is known and is not the number that received the reply.
    const sender = senderOf.get(row.orgId);
    if (sender && sender !== inbound) continue;
    if (!row.confirmedAt) {
      await db.update(voiceEscalations).set({ confirmedAt: now, replyText: reply }).where(eq(voiceEscalations.id, row.id));
      touched++;
    } else if (row.followupSentAt) {
      await db.update(voiceEscalations).set({ closedAt: now, closeReason: `done: ${reply}`.slice(0, 200) }).where(eq(voiceEscalations.id, row.id));
      touched++;
    }
  }
  return touched;
}

/** The email link: confirms once; a second click after the follow-up closes. */
export async function confirmEscalationByToken(id: number, token: unknown, now = new Date()): Promise<"confirmed" | "closed" | "already" | "invalid"> {
  const [row] = await db.select().from(voiceEscalations).where(eq(voiceEscalations.id, id)).limit(1);
  if (!row || !confirmTokenOk(id, row.orgId, token)) return "invalid";
  if (row.closedAt) return "already";
  if (!row.confirmedAt) {
    await db.update(voiceEscalations).set({ confirmedAt: now, replyText: "Confirmed by email link" }).where(eq(voiceEscalations.id, id));
    return "confirmed";
  }
  if (row.followupSentAt) {
    await db.update(voiceEscalations).set({ closedAt: now, closeReason: "done: email link" }).where(eq(voiceEscalations.id, id));
    return "closed";
  }
  return "already";
}

export async function closeEscalation(orgId: string, id: number, reason: string, now = new Date()): Promise<VoiceEscalationRow | null> {
  const [row] = await db.update(voiceEscalations).set({ closedAt: now, closeReason: reason.slice(0, 200) })
    .where(and(eq(voiceEscalations.orgId, orgId), eq(voiceEscalations.id, id), isNull(voiceEscalations.closedAt))).returning();
  return row ?? null;
}

export async function listEscalations(orgId: string, opts: { open?: boolean; callId?: string; limit?: number } = {}): Promise<VoiceEscalationRow[]> {
  const where = [eq(voiceEscalations.orgId, orgId)];
  if (opts.open) where.push(isNull(voiceEscalations.closedAt));
  if (opts.callId) where.push(eq(voiceEscalations.callId, opts.callId));
  return db.select().from(voiceEscalations).where(and(...where))
    .orderBy(sql`${voiceEscalations.createdAt} desc`).limit(Math.min(500, Math.max(1, opts.limit ?? 100)));
}

// ── The reminder worker ──────────────────────────────────────────────────────

/** Hour of the day (0–23) in an IANA zone; falls back to UTC on a bad zone. */
export function localHour(now: Date, timezone: string | null | undefined): number {
  try {
    const h = new Intl.DateTimeFormat("en-US", { hour: "numeric", hourCycle: "h23", timeZone: timezone || "UTC" }).formatToParts(now).find((p) => p.type === "hour")?.value;
    const n = Number(h);
    return Number.isFinite(n) ? n % 24 : now.getUTCHours();
  } catch {
    return now.getUTCHours();
  }
}

export const inWindow = (hour: number, from: number, to: number) => from <= hour && hour < to;

export type TickReport = { reminded: number; followedUp: number; closed: number; errors: number };

/**
 * One pass over every open escalation. `now` is injectable so tests can walk
 * the clock. Sends go through the same seams as the first text/email.
 */
export async function tickVoiceEscalations(now = new Date()): Promise<TickReport> {
  const report: TickReport = { reminded: 0, followedUp: 0, closed: 0, errors: 0 };
  const rows = await db.select().from(voiceEscalations).where(isNull(voiceEscalations.closedAt)).orderBy(asc(voiceEscalations.id));
  // The reminder window is the company's local time (Studio timezone, else the CRM org's).
  const orgs = new Map<string, { org: typeof crmOrgs.$inferSelect; timezone: string | null } | null>();
  const orgOf = async (id: string) => {
    if (!orgs.has(id)) {
      const ctx = await loadOrgVoiceContext(id);
      orgs.set(id, ctx ? { org: ctx.org, timezone: ctx.profile.company.timezone || ctx.org.timezone || null } : null);
    }
    return orgs.get(id)!;
  };
  const MIN = 60_000, HOUR = 60 * MIN, DAY = 24 * HOUR;
  for (const row of rows) {
    try {
      const found = await orgOf(row.orgId);
      if (!found) { await db.update(voiceEscalations).set({ closedAt: now, closeReason: "org gone" }).where(eq(voiceEscalations.id, row.id)); report.closed++; continue; }
      const { org } = found;
      const hour = localHour(now, found.timezone);
      const open = inWindow(hour, row.remindFromHour, row.remindToHour);
      const created = row.createdAt ?? now;
      if (!row.confirmedAt) {
        if (now.getTime() - created.getTime() > row.maxDays * DAY) {
          await db.update(voiceEscalations).set({ closedAt: now, closeReason: `no response after ${row.maxDays} days` }).where(eq(voiceEscalations.id, row.id));
          report.closed++; continue;
        }
        if (row.remindEveryMinutes <= 0) continue;
        const due = !row.lastSentAt || now.getTime() - row.lastSentAt.getTime() >= row.remindEveryMinutes * MIN;
        if (!due || !open) continue;
        const n = row.sentCount + 1;
        const body = row.sentCount === 0 ? row.body : `REMINDER #${n - 1} — still waiting on your OK:\n\n${row.body}`;
        const sent = await sendEscalation(org, row, body, `Reminder: ${row.recipientName ? `${row.recipientName}, ` : ""}still waiting on your OK`);
        if (sent.ok) {
          await db.update(voiceEscalations).set({ sentCount: n, lastSentAt: now, lastProviderSid: sent.sid, lastError: null }).where(eq(voiceEscalations.id, row.id));
          report.reminded++;
        } else {
          await db.update(voiceEscalations).set({ lastError: sent.error }).where(eq(voiceEscalations.id, row.id));
          report.errors++;
        }
        continue;
      }
      // Confirmed: one next-day follow-up, then close.
      if (!row.followUpNextDay) {
        await db.update(voiceEscalations).set({ closedAt: now, closeReason: "confirmed" }).where(eq(voiceEscalations.id, row.id));
        report.closed++; continue;
      }
      if (!row.followupSentAt) {
        if (now.getTime() - row.confirmedAt.getTime() < FOLLOW_UP_AFTER_HOURS * HOUR || !open) continue;
        const gist = row.body.split("\nReply OK")[0];
        const sent = await sendEscalation(org, row, `Next-day follow-up: was this taken care of? Reply DONE when it is.\n\n${gist}`, "Next-day follow-up: was this taken care of?");
        if (sent.ok) { await db.update(voiceEscalations).set({ followupSentAt: now, lastProviderSid: sent.sid, lastError: null }).where(eq(voiceEscalations.id, row.id)); report.followedUp++; }
        else { await db.update(voiceEscalations).set({ lastError: sent.error }).where(eq(voiceEscalations.id, row.id)); report.errors++; }
        continue;
      }
      if (now.getTime() - row.followupSentAt.getTime() > CLOSE_AFTER_FOLLOW_UP_DAYS * DAY) {
        await db.update(voiceEscalations).set({ closedAt: now, closeReason: `follow-up sent; no reply in ${CLOSE_AFTER_FOLLOW_UP_DAYS} days` }).where(eq(voiceEscalations.id, row.id));
        report.closed++;
      }
    } catch (e: any) {
      report.errors++;
      console.error(`[voice] escalation #${row.id} tick failed:`, e?.message || e);
      void recordFailure("job", "Call escalation reminder", e, { escalationId: row.id, orgId: row.orgId });
    }
  }
  return report;
}

let worker: NodeJS.Timeout | null = null;

/** Start the 30-minute reminder loop when VOICE_ESCALATION_WORKER_ENABLED=true (production only). */
export function startVoiceEscalationWorker(): boolean {
  if (worker) return true;
  if (process.env.VOICE_ESCALATION_WORKER_ENABLED !== "true") return false;
  const run = () => tickVoiceEscalations().then((r) => {
    if (r.reminded || r.followedUp || r.closed || r.errors) console.log(`[voice] escalations: ${JSON.stringify(r)}`);
  }).catch((e: any) => {
    console.error("[voice] escalation worker failed:", e?.message || e);
    void recordFailure("job", "Call escalation reminder worker", e);
  });
  worker = setInterval(run, WORKER_INTERVAL_MS);
  worker.unref();
  setTimeout(run, 15_000).unref();
  console.log("[voice] escalation reminder worker on (every 30 min)");
  return true;
}
