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
 * The reminder worker (every 30 min; ON by default on a production server,
 * VOICE_ESCALATION_WORKER_ENABLED=false turns it off, =true turns it on in a
 * lane — the same switch shape as the spam-report job) resends unconfirmed escalations every
 * `remind_every_minutes` between `remind_from_hour` and `remind_to_hour` in
 * the company's timezone until `max_days`; a reply from the recipient (inbound
 * SMS hook in server/crm/sms.ts, or the email link) confirms; 20 h after a
 * confirmation one next-day follow-up goes out ("was this taken care of?
 * Reply DONE"), then the row closes. The assistant never gives out a
 * recipient's number.
 */
import { createHash, createHmac, timingSafeEqual } from "crypto";
import { db } from "../db";
import {
  crmMembers, crmOrgs, crmNotifications, crmNotificationChannel, voiceEscalations, voiceCalls,
  type VoiceCallRow, type VoiceEscalationRow,
} from "@shared/schema";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { ESCALATION_KINDS, type EscalationKind, type EscalationRule } from "@shared/voice-profile";
import { normalizePhone, resolveSmsSender, sendSms } from "../crm/sms";
import { appForLink, pushSoon } from "../apns";
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

type SendOutcome = { ok: boolean; sid: string | null; error: string | null; ambiguous?: boolean };
const UNCERTAIN = "Delivery uncertain; verify with the carrier before resending.";
const DETAILS_PENDING = "Details update not sent: ";
const uncertain = (row: Pick<VoiceEscalationRow, "lastError" | "sentCount" | "lastSentAt">) =>
  // Only this row's own sends: an owner alert's uncertainty ("Owner alert: …") must not block the row or other owners.
  !!row.lastError?.startsWith(UNCERTAIN) || !!row.lastError?.startsWith(DETAILS_PENDING + UNCERTAIN) || (row.sentCount > 0 && !row.lastSentAt);

/** The shared log provider is a successful log write, never a carrier acceptance. */
export function escalationSmsOutcome(r: Awaited<ReturnType<typeof sendSms>>): SendOutcome {
  if (r.ambiguous) return { ok: false, sid: r.sid ?? null, ambiguous: true, error: UNCERTAIN };
  if (r.provider === "log") return { ok: false, sid: null, error: "Not sent: texting isn't set up." };
  if (r.ok && !r.sid) return { ok: false, sid: null, ambiguous: true, error: UNCERTAIN };
  return { ok: !!r.ok, sid: r.sid ?? null, error: r.ok ? null : (r.error ?? "send failed") };
}

async function sendEscalation(org: typeof crmOrgs.$inferSelect, row: Pick<VoiceEscalationRow, "id" | "orgId" | "channel" | "recipient" | "recipientName">, body: string, subject: string): Promise<SendOutcome> {
  if (row.channel === "sms") {
    const r = await sendSms(row.recipient, body, org.customFields, org.id).catch((e: any) => ({ ok: false, provider: "signalwire", sid: null, ambiguous: true, error: String(e?.message || e) } as const));
    return escalationSmsOutcome(r);
  }
  const path = row.id ? confirmPath(row.id, row.orgId) : null;
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
async function notifyOwnersImpl(ctx: OrgVoiceContext, call: VoiceCallRow, kind: string, facts: EscalationFacts, opts: { update?: boolean } = {}): Promise<void> {
  const who = facts.callerName === "unknown" ? facts.callback : facts.callerName;
  const base = kind === "human" ? `${who} asked for a person` : `${facts.kind} — call from ${who}`;
  const title = opts.update ? `Details added — ${base}` : base;
  const members = await db.select().from(crmMembers).where(and(eq(crmMembers.orgId, ctx.org.id), eq(crmMembers.status, "active")));
  const owners = members.filter((m) => m.role === "owner");
  const failures: string[] = [];
  const revision = opts.update ? [facts.callerName, facts.address] : "initial";
  if (crmNotificationChannel(ctx.org.customFields, "leadReceived", "inApp")) {
    for (const member of owners) {
      const key = createHash("sha256").update(JSON.stringify([call.id, kind, revision, member.id])).digest("hex");
      try {
        const link = `/call-assistant/calls?call=${call.id}`;
        const inserted = await db.insert(crmNotifications).values({
          id: `voice-owner:${key}`, orgId: ctx.org.id, memberId: member.id, type: `call.alert.${kind}`,
          title: title.slice(0, 300), body: facts.summary || null, link,
        }).onConflictDoNothing().returning({ id: crmNotifications.id });
        if (inserted.length && member.userId) pushSoon(member.userId, appForLink(link), { title: `${ctx.org.name}: ${title}`, body: facts.summary, link });
      } catch (error) {
        failures.push(`In-app alert: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }
  const deliver = async (channel: "sms" | "email", recipient: string) => {
    // Stable per recipient and details revision: a retry cannot resend successful/uncertain recipients.
    const key = createHash("sha256").update(JSON.stringify([kind, revision, channel, recipient])).digest("hex");
    const pending = JSON.stringify({ status: "uncertain", kind, channel, recipient, error: UNCERTAIN });
    const claim = await db.execute(sql`
      update voice_calls set flags = jsonb_set(coalesce(flags, '{}'::jsonb), '{ownerEscalationDelivery}',
        coalesce(flags->'ownerEscalationDelivery', '{}'::jsonb) || jsonb_build_object(${key}::text, ${pending}::jsonb))
      where id = ${call.id} and coalesce(flags->'ownerEscalationDelivery'->${key}::text->>'status', 'failed') = 'failed'
      returning id`);
    if (!claim.rows.length) {
      const saved = await db.execute(sql`select flags->'ownerEscalationDelivery'->${key}::text->>'status' as status from voice_calls where id = ${call.id}`);
      if (saved.rows[0]?.status !== "sent") failures.push(UNCERTAIN);
      return;
    }
    let outcome: SendOutcome;
    try {
      outcome = await sendEscalation(ctx.org, { id: 0, orgId: ctx.org.id, channel, recipient, recipientName: null },
        defaultEscalationBody(facts).replace(/\nReply OK.*$/, ""), title);
    } catch {
      outcome = { ok: false, sid: null, ambiguous: true, error: UNCERTAIN };
    }
    const result = JSON.stringify({ status: outcome.ok ? "sent" : outcome.ambiguous ? "uncertain" : "failed", kind, channel, recipient, sid: outcome.sid, error: outcome.error });
    await db.execute(sql`update voice_calls set flags = jsonb_set(flags, array['ownerEscalationDelivery', ${key}::text], ${result}::jsonb) where id = ${call.id}`);
    if (!outcome.ok) failures.push(outcome.error || "send failed");
  };
  if (crmNotificationChannel(ctx.org.customFields, "leadReceived", "sms")) {
    const numbers = new Set(owners.map((m) => normalizePhone(m.phone)).filter((p): p is string => !!p));
    if (!numbers.size && normalizePhone(ctx.org.phone)) numbers.add(normalizePhone(ctx.org.phone)!);
    for (const recipient of numbers) await deliver("sms", recipient);
  }
  if (crmNotificationChannel(ctx.org.customFields, "leadReceived", "email")) {
    for (const recipient of new Set(owners.map((m) => m.email).filter((p): p is string => !!p))) await deliver("email", recipient);
  }
  if (failures.length) throw new Error(failures.join("; "));
}

/** Keep owner failures visible on the escalation, without erasing an uncertain rule send. */
async function notifyOwners(ctx: OrgVoiceContext, call: VoiceCallRow, kind: string, facts: EscalationFacts, opts: { update?: boolean } = {}): Promise<void> {
  try {
    await notifyOwnersImpl(ctx, call, kind, facts, opts);
    await db.update(voiceEscalations).set({ lastError: sql`nullif(rtrim(split_part(coalesce(${voiceEscalations.lastError}, ''), 'Owner alert:', 1), '; '), '')` })
      .where(and(eq(voiceEscalations.callId, call.id), eq(voiceEscalations.kind, kind)));
  } catch (error) {
    const message = `Owner alert: ${error instanceof Error ? error.message : String(error)}`;
    await db.update(voiceEscalations).set({ lastError: sql`concat_ws('; ', nullif(rtrim(split_part(coalesce(${voiceEscalations.lastError}, ''), 'Owner alert:', 1), '; '), ''), ${message}::text)` })
      .where(and(eq(voiceEscalations.callId, call.id), eq(voiceEscalations.kind, kind)));
    throw error;
  }
}

export type RaiseResult = { escalationId: number | null; sent: boolean; fallback: boolean; recipientName: string | null; duplicate: boolean };

/** A strict raise (the end report's durable task, call-tasks.ts) could not finish: the task retries it. */
export class EscalationDeliveryError extends Error {
  constructor(message: string, readonly escalationId: number | null) { super(message); }
}

/** Whether the owners must hear about this kind: no usable rule row and the fallback is on, or urgent/human always. */
const ownersNeeded = (ctx: OrgVoiceContext, kind: string, hasRow: boolean) =>
  (!hasRow && ctx.profile.escalations.fallbackToOwner) || kind === "urgent" || kind === "human";

/** Postgres unique violation (voice_escalations_call_kind_uidx: one escalation per call and kind). */
const isUniqueViolation = (e: any) => e?.code === "23505" || e?.cause?.code === "23505";

/**
 * Raise one escalation for a call. Idempotent per (call, kind): a second
 * `alert` of the same kind during one call (or the end report repeating a
 * mid-call event) does not text anyone twice — one row per (call, kind), a
 * unique index where the data allows it (schema.ts).
 *
 * `strict` is the end report's durable task (call-tasks.ts): it finishes what an earlier attempt left undone —
 * a first text/email that never went out is sent now, an owners' alert that failed is sent now — and throws
 * EscalationDeliveryError while anything is still undelivered, so the task stays pending and is retried. The
 * mid-call path (not strict) stays best-effort: the end report's task completes whatever it missed.
 */
export async function raiseEscalation(args: {
  ctx: OrgVoiceContext; call: VoiceCallRow; kind: string; summary: string; slots?: Record<string, string> | null; strict?: boolean;
}): Promise<RaiseResult> {
  const { ctx, call, strict = false } = args;
  const kind = isEscalationKind(args.kind) ? args.kind : "other";
  const facts = escalationFacts(ctx, call, kind, args.summary, args.slots);
  const rule = matchRule(ctx.profile.escalations.rules, kind);
  const findExisting = async () => (await db.select().from(voiceEscalations)
    .where(and(eq(voiceEscalations.orgId, ctx.org.id), eq(voiceEscalations.callId, call.id), eq(voiceEscalations.kind, kind))).limit(1))[0];
  let existing = await findExisting();
  const callFlags = (call.flags ?? {}) as Record<string, unknown>;
  const alreadyFallback = Array.isArray(callFlags.alertedKinds) && (callFlags.alertedKinds as string[]).includes(kind);
  const ownersDone = () => !!((call.flags ?? {}) as { alertFacts?: Record<string, unknown> }).alertFacts?.[kind];
  if (existing || alreadyFallback) {
    // The same kind again (a mid-call update, or the end report repeating it): no second page — but when the
    // call has since given a name or an address the first message lacked, the stored body (what reminders
    // resend) is rebuilt and one "details added" message goes out.
    await addEscalationDetails(ctx, call, kind, facts, rule, existing ?? null)
      .catch((e: any) => {
        console.error("[voice] escalation details update failed:", e?.message || e);
        void recordFailure("call_assistant", "Call Assistant escalation details update", e, { callId: call.id, orgId: ctx.org.id, kind });
        if (strict) throw e;
      });
    existing = await findExisting();
    if (strict) {
      // Finish what the first attempt left: a first message that never went out, an owners' alert that failed.
      if (existing && uncertain(existing)) throw new EscalationDeliveryError(existing.lastError || "First message is still being sent; verify delivery before resending", existing.id);
      if (existing && existing.sentCount === 0 && !existing.lastSentAt && !existing.closedAt) {
        const sent = await sendFirstEscalation(ctx.org, existing, existing.body, `${facts.company}: ${facts.kind} — ${facts.callerName}`);
        if (!sent.ok) throw new EscalationDeliveryError(`escalation #${existing.id} not sent: ${sent.error ?? "send failed"}`, existing.id);
        existing = (await findExisting())!;
      }
      if (ownersNeeded(ctx, kind, !!existing) && !ownersDone()) {
        await notifyOwners(ctx, call, kind, facts);   // throws → the task retries
        await rememberOwnerFacts(call, kind, facts);
      }
      if (!alreadyFallback) await markAlerted(call, kind);
    }
    return existing
      ? { escalationId: existing.id, sent: !!(existing.lastSentAt && existing.sentCount > 0), fallback: false, recipientName: existing.recipientName, duplicate: true }
      : { escalationId: null, sent: ownersDone(), fallback: true, recipientName: null, duplicate: true };
  }
  recordActivity({
    orgId: ctx.org.id, actorLabel: `${ctx.assistantName} (Call Assistant)`, action: "call.alert",
    entityType: "voice_call", entityId: call.id, customerId: call.customerId ?? null,
    meta: { kind, label: facts.kind, summary: facts.summary, recipient: rule?.recipientName ?? null },
  });

  let result: RaiseResult = { escalationId: null, sent: false, fallback: false, recipientName: null, duplicate: false };
  let undelivered: string | null = null;
  if (rule) {
    const recipient = rule.channel === "sms" ? normalizePhone(rule.recipient) : rule.recipient.trim().toLowerCase();
    if (recipient) {
      const body = escalationBody(rule, facts);
      const r = rule.reminders;
      let row: VoiceEscalationRow | undefined;
      try {
        [row] = await db.insert(voiceEscalations).values({
          orgId: ctx.org.id, callId: call.id, kind, ruleId: rule.id, channel: rule.channel,
          recipient, recipientName: rule.recipientName, body,
          remindEveryMinutes: r.enabled ? r.everyMinutes : 0, remindFromHour: r.fromHour, remindToHour: r.toHour,
          maxDays: r.maxDays, followUpNextDay: r.followUpNextDay,
        }).returning();
      } catch (e) {
        // Another delivery of the same (call, kind) won the insert a moment ago: it owns the first message.
        if (!isUniqueViolation(e)) throw e;
        const winner = await findExisting();
        if (!winner) throw e;
        // strict: go through the existing-row path, which finishes whatever the winner has not delivered yet
        if (strict) return raiseEscalation(args);
        return { escalationId: winner.id, sent: !!(winner.lastSentAt && winner.sentCount > 0), fallback: false, recipientName: winner.recipientName, duplicate: true };
      }
      const sent = await sendFirstEscalation(ctx.org, row, body, `${facts.company}: ${facts.kind} — ${facts.callerName}`);
      result = { escalationId: row.id, sent: sent.ok, fallback: false, recipientName: rule.recipientName, duplicate: false };
      if (!sent.ok) undelivered = `escalation #${row.id} not sent: ${sent.error ?? "send failed"}`;
    }
  }
  // No rule (or an unusable recipient) → the owners; urgent/human always also reach the owners.
  if (ownersNeeded(ctx, kind, !!result.escalationId)) {
    let ownersOk = true;
    await notifyOwners(ctx, call, kind, facts).catch((e: any) => {
      ownersOk = false;
      console.error("[voice] owner alert failed:", e?.message || e);
      void recordFailure("call_assistant", "Call Assistant owner alert", e, { callId: call.id, orgId: ctx.org.id, kind });
      undelivered ??= `owners' alert failed: ${String(e?.message || e).slice(0, 200)}`;
    });
    result.fallback = true;
    result.sent = ownersOk || result.sent;
    // Only a delivered alert is remembered: a strict retry sends the owners' alert again until it lands.
    if (ownersOk) await rememberOwnerFacts(call, kind, facts);
  }
  await markAlerted(call, kind);
  if (strict && undelivered) throw new EscalationDeliveryError(undelivered, result.escalationId);
  return result;
}

/** Remember the kind on the call (merged in SQL, so a concurrent end report keeps its own keys). */
async function markAlerted(call: VoiceCallRow, kind: string): Promise<void> {
  await db.execute(sql`
    update voice_calls
       set flags = jsonb_set(coalesce(flags, '{}'::jsonb), '{alertedKinds}',
         (select coalesce(jsonb_agg(distinct k), '[]'::jsonb)
            from jsonb_array_elements_text(coalesce(flags->'alertedKinds', '[]'::jsonb) || to_jsonb(${kind}::text)) as k))
     where id = ${call.id}`);
  const flags = { ...((call.flags ?? {}) as Record<string, unknown>) };
  flags.alertedKinds = [...new Set([...(Array.isArray(flags.alertedKinds) ? flags.alertedKinds as string[] : []), kind])];
  call.flags = flags;
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
  if (row) await deliverEscalationDetails(ctx, call, facts, rule, row);
  const fuller = !!row && !!facts.address && !row.body.toLowerCase().includes(facts.address.toLowerCase());
  if (row && !row.closedAt && (factsAddDetail(facts, row.body) || fuller)) {
    // the reminders resend the stored body, so it always gets the fuller facts; a message goes out only
    // when a name or a street is new
    const body = escalationBody(rule, facts);
    await db.update(voiceEscalations).set({ body }).where(eq(voiceEscalations.id, row.id));
  }
  const sentToOwners = ((call.flags ?? {}) as { alertFacts?: Record<string, SentFacts> }).alertFacts?.[kind];
  if (sentToOwners && factsAddDetail(facts, sentToOwners)) {
    await notifyOwners(ctx, call, kind, facts, { update: true });
    await rememberOwnerFacts(call, kind, facts);
  }
}

type DetailsDelivery = {
  revision: string; body: string; subject: string;
  status: "pending" | "uncertain" | "sent"; error: string | null;
};

/** The reminder body is not a delivery receipt. Keep the exact update through retries. */
async function deliverEscalationDetails(ctx: OrgVoiceContext, call: VoiceCallRow, facts: EscalationFacts, rule: EscalationRule | null, row: VoiceEscalationRow): Promise<void> {
  const key = String(row.id);
  const saved = await db.execute(sql`select flags->'escalationDetailsDelivery'->${key}::text as delivery from voice_calls where id = ${call.id}`);
  const previous = saved.rows[0]?.delivery as DetailsDelivery | undefined;
  if ((!previous || previous.status === "sent") && (row.closedAt || row.sentCount === 0 || !factsAddDetail(facts, row.body))) return;

  // Lock the escalation while saving both its fuller reminder body and its revision claim.
  // A competing request sees uncertainty; a crash after this commit cannot resend the update.
  const claim = await db.transaction(async (tx) => {
    const [fresh] = await tx.select().from(voiceEscalations).where(eq(voiceEscalations.id, row.id)).for("update");
    const [currentCall] = await tx.select().from(voiceCalls).where(eq(voiceCalls.id, call.id));
    const deliveries = (currentCall?.flags as { escalationDetailsDelivery?: Record<string, DetailsDelivery> } | null)?.escalationDetailsDelivery;
    let delivery = deliveries?.[key];
    if (!fresh || !currentCall) throw new EscalationDeliveryError("Details update could not be loaded", row.id);
    const body = escalationBody(rule, facts);
    const revision = createHash("sha256").update(JSON.stringify([facts.callerName, facts.address, body])).digest("hex");
    if (!delivery || delivery.status === "sent") {
      if (fresh.closedAt || !factsAddDetail(facts, fresh.body) || delivery?.revision === revision) return null;
      delivery = { revision, body: `Details added:\n\n${body}`,
        subject: `${facts.company}: ${facts.kind} — details added for ${facts.callerName}`, status: "pending", error: null };
    }
    if (delivery.status === "uncertain" || uncertain(fresh)) throw new EscalationDeliveryError(UNCERTAIN, row.id);
    if (fresh.closedAt) throw new EscalationDeliveryError(`${DETAILS_PENDING}escalation is closed`, row.id);
    const claimed: DetailsDelivery = { ...delivery, status: "uncertain", error: UNCERTAIN };
    await tx.execute(sql`update voice_calls set flags = jsonb_set(coalesce(flags, '{}'::jsonb), '{escalationDetailsDelivery}',
      coalesce(flags->'escalationDetailsDelivery', '{}'::jsonb) || jsonb_build_object(${key}::text, ${JSON.stringify(claimed)}::jsonb)) where id = ${call.id}`);
    await tx.update(voiceEscalations).set({ body: delivery.body.replace(/^Details added:\n\n/, ""),
      lastError: sql`concat_ws('; ', ${DETAILS_PENDING + UNCERTAIN}::text,
        case when position('Owner alert:' in coalesce(${voiceEscalations.lastError}, '')) > 0
          then 'Owner alert:' || split_part(${voiceEscalations.lastError}, 'Owner alert:', 2) end)` }).where(eq(voiceEscalations.id, row.id));
    return { delivery: claimed, row: fresh };
  });
  if (!claim) return;
  const sent = await sendEscalation(ctx.org, claim.row, claim.delivery.body, claim.delivery.subject);
  const completed: DetailsDelivery = { ...claim.delivery, status: sent.ok ? "sent" : sent.ambiguous ? "uncertain" : "pending", error: sent.error };
  // Persist the outcome together: a failure saving acceptance leaves the pre-send uncertainty intact.
  await db.transaction(async (tx) => {
    await tx.execute(sql`update voice_calls set flags = jsonb_set(flags, array['escalationDetailsDelivery', ${key}::text], ${JSON.stringify(completed)}::jsonb) where id = ${call.id}`);
    await tx.update(voiceEscalations).set({ lastProviderSid: sent.sid,
      lastError: sql`nullif(concat_ws('; ', ${sent.ok ? null : DETAILS_PENDING + (sent.error || "send failed")}::text,
        case when position('Owner alert:' in coalesce(${voiceEscalations.lastError}, '')) > 0
          then 'Owner alert:' || split_part(${voiceEscalations.lastError}, 'Owner alert:', 2) end), '')` }).where(eq(voiceEscalations.id, row.id));
  });
  if (!sent.ok) throw new EscalationDeliveryError(DETAILS_PENDING + (sent.error || "send failed"), row.id);
  // There may be newer facts than the pending revision we just delivered. Re-read before considering them.
  const [fresh] = await db.select().from(voiceEscalations).where(eq(voiceEscalations.id, row.id)).limit(1);
  Object.assign(row, fresh);
  await deliverEscalationDetails(ctx, call, facts, rule, row);
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
      if (uncertain(row) || row.lastError?.startsWith(DETAILS_PENDING)) continue;
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
        if (row.sentCount > 0 && !row.lastSentAt) continue; // first send is claimed (or its outcome is unknown)
        const n = row.sentCount + 1;
        const body = row.sentCount === 0 ? row.body : `REMINDER #${n - 1} — still waiting on your OK:\n\n${row.body}`;
        const sent = await sendTrackedEscalation(org, row, body, `Reminder: ${row.recipientName ? `${row.recipientName}, ` : ""}still waiting on your OK`, row.sentCount === 0 ? "first" : "reminder", now);
        if (sent.ok) report.reminded++;
        else report.errors++;
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
        const sent = await sendTrackedEscalation(org, row, `Next-day follow-up: was this taken care of? Reply DONE when it is.\n\n${gist}`, "Next-day follow-up: was this taken care of?", "followup", now);
        if (sent.ok) report.followedUp++;
        else report.errors++;
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

/**
 * Why the reminder worker is off, or null when it runs. The landing page and the Escalations tab promise
 * "reminders until someone replies", so a production server runs it unless told not to (the same switch shape
 * as the weekly spam report, spam-report.ts): "false" → off, "true" → on (a lane), unset → on in production only.
 */
export function voiceEscalationWorkerOffReason(env: NodeJS.ProcessEnv = process.env): string | null {
  const flag = env.VOICE_ESCALATION_WORKER_ENABLED;
  if (flag === "false") return "VOICE_ESCALATION_WORKER_ENABLED is false";
  if (flag === "true") return null;
  if (env.NODE_ENV !== "production") return "this is not a production server (set VOICE_ESCALATION_WORKER_ENABLED=true to run it)";
  return null;
}

/** What the Escalations tab shows about the reminder loop (no env names, no internals beyond on/last run). */
export type EscalationWorkerStatus = {
  running: boolean;
  intervalMinutes: number;
  lastRunAt: string | null;
  lastOk: boolean | null;
  /** True when the last run is older than two intervals (the loop stalled). */
  stale: boolean;
};
const workerHealth: { lastRunAt: Date | null; lastOk: boolean | null } = { lastRunAt: null, lastOk: null };

export function voiceEscalationWorkerStatus(now = new Date()): EscalationWorkerStatus {
  const running = worker !== null;
  const last = workerHealth.lastRunAt;
  return {
    running, intervalMinutes: WORKER_INTERVAL_MS / 60_000,
    lastRunAt: last ? last.toISOString() : null, lastOk: workerHealth.lastOk,
    stale: running && !!last && now.getTime() - last.getTime() > 2 * WORKER_INTERVAL_MS,
  };
}

/** Test hook: record a run without the timer. */
export function noteEscalationWorkerRun(ok: boolean, at = new Date()): void {
  workerHealth.lastRunAt = at; workerHealth.lastOk = ok;
}

/** Start the 30-minute reminder loop (see voiceEscalationWorkerOffReason for when it runs). */
export function startVoiceEscalationWorker(): boolean {
  if (worker) return true;
  const off = voiceEscalationWorkerOffReason();
  if (off) {
    console.log(`[voice] escalation reminder worker off: ${off}`);
    return false;
  }
  const run = () => tickVoiceEscalations().then((r) => {
    noteEscalationWorkerRun(r.errors === 0);
    if (r.reminded || r.followedUp || r.closed || r.errors) console.log(`[voice] escalations: ${JSON.stringify(r)}`);
  }).catch((e: any) => {
    noteEscalationWorkerRun(false);
    console.error("[voice] escalation worker failed:", e?.message || e);
    void recordFailure("job", "Call escalation reminder worker", e);
  });
  worker = setInterval(run, WORKER_INTERVAL_MS);
  worker.unref();
  setTimeout(run, 15_000).unref();
  console.log("[voice] escalation reminder worker on (every 30 min)");
  return true;
}

/** Persist uncertainty before I/O. A crash or concurrent retry must never duplicate a send. */
async function sendTrackedEscalation(org: typeof crmOrgs.$inferSelect, row: VoiceEscalationRow, body: string, subject: string, stage: "first" | "reminder" | "followup", now = new Date()): Promise<SendOutcome> {
  if (uncertain(row)) return { ok: false, sid: null, ambiguous: true, error: row.lastError || UNCERTAIN };
  const [claimed] = await db.update(voiceEscalations).set({ lastError: sql`concat_ws('; ', ${UNCERTAIN}::text,
      case when position('Owner alert:' in coalesce(${voiceEscalations.lastError}, '')) > 0
        then 'Owner alert:' || split_part(${voiceEscalations.lastError}, 'Owner alert:', 2) end)` })
    .where(and(eq(voiceEscalations.id, row.id), isNull(voiceEscalations.closedAt),
      eq(voiceEscalations.sentCount, row.sentCount),
      sql`${voiceEscalations.lastError} is not distinct from ${row.lastError}`,
      sql`${voiceEscalations.lastSentAt} is not distinct from ${row.lastSentAt}`,
      sql`${voiceEscalations.followupSentAt} is not distinct from ${row.followupSentAt}`,
      stage === "first" ? eq(voiceEscalations.sentCount, 0) : undefined)).returning();
  if (!claimed) return { ok: false, sid: null, ambiguous: true, error: UNCERTAIN };
  const sent = await sendEscalation(org, row, body, subject);
  await db.update(voiceEscalations).set({
    lastProviderSid: sent.sid,
    lastError: sql`nullif(concat_ws('; ', ${sent.error}::text,
      case when position('Owner alert:' in coalesce(${voiceEscalations.lastError}, '')) > 0
        then 'Owner alert:' || split_part(${voiceEscalations.lastError}, 'Owner alert:', 2) end), '')`,
    ...(sent.ok && (stage === "first" || stage === "reminder") ? { sentCount: row.sentCount + 1, lastSentAt: now } : {}),
    ...(sent.ok && stage === "followup" ? { followupSentAt: now } : {}),
  }).where(eq(voiceEscalations.id, row.id));
  return sent;
}

export async function sendFirstEscalation(org: typeof crmOrgs.$inferSelect, row: VoiceEscalationRow, body: string, subject: string) {
  return sendTrackedEscalation(org, row, body, subject, "first");
}
