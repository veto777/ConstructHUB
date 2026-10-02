/**
 * The weekly spam report (owner, 2026-10-02: "emphasize the spam filter that
 * they don't ever have to answer spam and our system blocks spam calls and
 * reports them"). OWNER: numbers+billing lane.
 *
 * Once a week, for the last COMPLETE week (Monday 00:00 → Monday 00:00, UTC),
 * every org whose AI Call Assistant screened at least one spam call gets:
 *   - an email to the org's account owner (crm_orgs.owner_user_id) — "We
 *     blocked N spam calls for you this week" — listing each call's number,
 *     time, reason and whether the number is now blocked, through the
 *     transactional outbox (server/account/billing-emails.ts
 *     deliverTransactionalEmail: claimed once per dedupe key, retried by the
 *     outbox drainer if the mail provider fails);
 *   - a bell notification for the org's owners (server/crm/notify.ts).
 * Both follow the org's "Weekly spam report" switch (notificationPrefs
 * `spamReport`, CRM → Settings → Notifications): email and in-app separately.
 *
 * "Spam calls" here are the calls the Calls tab's spam view lists: outcome
 * `spam` (screened by the assistant) and `blocked` (a blocked number, rejected
 * before answering).
 *
 * Exactly once per org per week: the voice_spam_reports row (UNIQUE org_id,
 * week_start) is claimed before anything is sent, so a second run, a second
 * process or a restart sends nothing again. A week with no spam claims nothing
 * and sends nothing. An org whose owner no longer has the Call Assistant (not
 * on, not paused for a payment) is skipped.
 *
 * Started at boot from server/voice/index.ts (startVoiceSpamReportWorker): on
 * in production unless VOICE_SPAM_REPORT_WORKER_ENABLED=false, off elsewhere
 * unless =true (dev mail goes to tmp/email-outbox.jsonl anyway).
 */
import { pool } from "../db";
import { getEntitlements } from "../entitlements";
import { notifyMembers } from "../crm/notify";
import { crmNotificationChannel } from "@shared/schema";
import { CALL_ASSISTANT_NAME } from "@shared/plans";
import { CALL_ASSISTANT_SPAM } from "@shared/plan-copy";
import { emailLayout, type EmailMessage } from "../account/billing-email-templates";
import { recordFailure } from "../ops/issues";

type Queryable = { query: (text: string, values?: unknown[]) => Promise<{ rows: any[]; rowCount?: number | null }> };

export const SPAM_REPORT_EMAIL_KIND = "voice.spam_report";
/** Rows listed in the email; the rest are counted and linked. */
export const SPAM_REPORT_MAX_ROWS = 50;
export const SPAM_REPORT_LINK = "/crm/call-assistant?tab=calls&view=spam";

export type SpamReportWeek = { start: Date; end: Date; key: string };

/** The last complete Monday-to-Monday week (UTC) before `now`. */
export function spamReportWeek(now = new Date()): SpamReportWeek {
  const day = now.getUTCDay(); // 0 = Sunday
  const sinceMonday = (day + 6) % 7;
  const thisMonday = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - sinceMonday);
  const start = new Date(thisMonday - 7 * 86_400_000);
  const end = new Date(thisMonday);
  return { start, end, key: start.toISOString().slice(0, 10) };
}

export type SpamReportCall = {
  callId: string;
  phoneNumber: string | null;
  at: Date;
  outcome: "spam" | "blocked";
  reason: string;
  /** The number is blocked now (the ledger, at report time). */
  nowBlocked: boolean;
};

/** The org's spam and blocked calls in the week, newest first, with each number's current ledger state. */
export async function weeklySpamCalls(orgId: string, week: SpamReportWeek, q: Queryable = pool): Promise<SpamReportCall[]> {
  const { rows } = await q.query(
    `SELECT c.id, c.from_number, c.started_at, c.created_at, c.outcome, c.spam_reason,
            (s.blocked_at IS NOT NULL AND (s.unblocked_at IS NULL OR s.unblocked_at < s.blocked_at)) AS now_blocked
       FROM voice_calls c
       LEFT JOIN voice_spam s ON s.org_id = c.org_id AND s.phone_number = c.from_number
      WHERE c.org_id = $1 AND c.outcome IN ('spam', 'blocked')
        AND COALESCE(c.started_at, c.created_at) >= $2 AND COALESCE(c.started_at, c.created_at) < $3
      ORDER BY COALESCE(c.started_at, c.created_at) DESC, c.id`,
    [orgId, week.start, week.end]);
  return rows.map((r) => ({
    callId: String(r.id),
    phoneNumber: r.from_number ?? null,
    at: new Date(r.started_at ?? r.created_at),
    outcome: r.outcome === "blocked" ? "blocked" : "spam",
    reason: r.outcome === "blocked"
      ? "Blocked number: rejected before it was answered"
      : String(r.spam_reason || "Flagged as spam by the assistant").slice(0, 160),
    nowBlocked: r.now_blocked === true,
  }));
}

const phoneText = (raw: string | null) => {
  const m = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(raw ?? "");
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : raw || "Unknown number";
};

function timeText(at: Date, timeZone: string | null | undefined): string {
  const opts: Intl.DateTimeFormatOptions = { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" };
  try {
    return at.toLocaleString("en-US", { ...opts, timeZone: timeZone || "UTC" });
  } catch {
    return at.toLocaleString("en-US", { ...opts, timeZone: "UTC" });
  }
}

const dayText = (d: Date) => d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });

/** "We stopped 3 spam calls for you this week" — screened by the assistant or rejected as a blocked number; only the latter are "blocked". */
export const spamReportTitle = (n: number) => `We stopped ${n.toLocaleString("en-US")} spam call${n === 1 ? "" : "s"} for you this week`;

/** The email (pure: facts in, message out). */
export function spamReportEmail(input: { orgName: string; week: SpamReportWeek; calls: SpamReportCall[]; timeZone?: string | null; baseUrl: string }): EmailMessage {
  const { calls, week } = input;
  const title = spamReportTitle(calls.length);
  const lastDay = new Date(week.end.getTime() - 86_400_000);
  const blockedNow = new Set(calls.filter((c) => c.nowBlocked).map((c) => c.phoneNumber)).size;
  const shown = calls.slice(0, SPAM_REPORT_MAX_ROWS);
  const more = calls.length - shown.length;
  const link = `${input.baseUrl.replace(/\/+$/, "")}${SPAM_REPORT_LINK}`;
  const { html, text } = emailLayout({
    title,
    intro: [
      `Your ${CALL_ASSISTANT_NAME} screened these calls for ${input.orgName} between ${dayText(week.start)} and ${dayText(lastDay)}, so nobody on your team had to answer them. None of them created a lead or sent a notification.`,
      blockedNow > 0
        ? `${blockedNow} of these numbers ${blockedNow === 1 ? "is" : "are"} now blocked: their calls are rejected before they're answered.`
        : CALL_ASSISTANT_SPAM.block,
    ],
    sections: [{
      heading: "Spam calls this week",
      lines: shown.map((c) => ({
        label: phoneText(c.phoneNumber),
        detail: `${timeText(c.at, input.timeZone)} · ${c.reason}`,
        amount: c.nowBlocked ? "Now blocked" : "Not blocked",
      })),
    }],
    note: `${more > 0 ? `${more} more spam call${more === 1 ? "" : "s"} are in your spam report. ` : ""}Not spam? Unblock a number in CRM → Call Assistant → Calls → Spam blocked. To stop this email, turn off "Weekly spam report" in CRM → Settings → Notifications.`,
    cta: { label: "Open your spam report", url: link },
    baseUrl: input.baseUrl,
  });
  return { subject: title, html, text };
}

export type SpamReportResult =
  | { sent: true; orgId: string; week: string; calls: number; email: string | null; bell: boolean }
  | { sent: false; orgId: string; week: string; reason: "no_spam" | "already_sent" | "opted_out" | "no_org" | "no_call_assistant" };

export type SpamReportDeps = {
  q?: Queryable;
  /** The transactional sender (default: server/account/billing-emails.ts deliverTransactionalEmail). */
  deliver?: (userId: number, kind: string, dedupeKey: string, msg: EmailMessage) => Promise<string>;
  /** The bell (default: server/crm/notify.ts notifyMembers). */
  bell?: typeof notifyMembers;
  /** Does the owner still have the Call Assistant (on, or paused for a payment)? Default: getEntitlements. */
  hasCallAssistant?: (ownerUserId: number) => Promise<boolean>;
  baseUrl?: string;
};

async function ownerHasCallAssistant(ownerUserId: number): Promise<boolean> {
  const ent = await getEntitlements(ownerUserId);
  return ent.addonModules.callAssistant || ent.addonModulesPaused.callAssistant;
}

/**
 * One org's report for one week. Idempotent: the claim row is taken first;
 * a week already claimed (or one with no spam) sends nothing.
 */
export async function sendWeeklySpamReport(orgId: string, week: SpamReportWeek, deps: SpamReportDeps = {}): Promise<SpamReportResult> {
  const q = deps.q ?? pool;
  const base = { orgId, week: week.key };
  const { rows: [org] } = await q.query("SELECT id, name, phone, owner_user_id, custom_fields, timezone FROM crm_orgs WHERE id = $1", [orgId]);
  if (!org) return { ...base, sent: false, reason: "no_org" };
  const calls = await weeklySpamCalls(orgId, week, q);
  if (!calls.length) return { ...base, sent: false, reason: "no_spam" };
  if (!(await (deps.hasCallAssistant ?? ownerHasCallAssistant)(Number(org.owner_user_id)))) return { ...base, sent: false, reason: "no_call_assistant" };

  const wantsEmail = crmNotificationChannel(org.custom_fields, "spamReport", "email");
  const wantsBell = crmNotificationChannel(org.custom_fields, "spamReport", "inApp");
  const wantsSms = crmNotificationChannel(org.custom_fields, "spamReport", "sms");
  const spam = calls.filter((c) => c.outcome === "spam").length;
  const blocked = calls.length - spam;
  const { rows: [claim] } = await q.query(
    `INSERT INTO voice_spam_reports (org_id, week_start, spam_calls, blocked_calls, email, bell)
     VALUES ($1, $2::date, $3, $4, $5, false) ON CONFLICT (org_id, week_start) DO NOTHING RETURNING id`,
    [orgId, week.key, spam, blocked, wantsEmail || wantsBell || wantsSms ? null : "opted_out"]);
  if (!claim) return { ...base, sent: false, reason: "already_sent" };
  if (!wantsEmail && !wantsBell && !wantsSms) return { ...base, sent: false, reason: "opted_out" };

  const title = spamReportTitle(calls.length);
  const numbers = new Set(calls.map((c) => c.phoneNumber)).size;
  if (wantsBell || wantsSms) {
    await (deps.bell ?? notifyMembers)({
      org: { id: org.id, name: org.name, phone: org.phone ?? null, customFields: org.custom_fields } as any,
      pref: "spamReport", type: "call.spam_report", title,
      body: `${numbers} number${numbers === 1 ? "" : "s"}, ${spam} screened by the assistant and ${blocked} rejected before answering. Nobody had to pick up.`,
      link: SPAM_REPORT_LINK,
    });
  }
  let email: string | null = null;
  if (wantsEmail) {
    const baseUrl = deps.baseUrl ?? (await import("../account/billing-emails")).accountBaseUrl();
    const msg = spamReportEmail({ orgName: String(org.name ?? "your company"), week, calls, timeZone: org.timezone, baseUrl });
    const deliver = deps.deliver ?? (await import("../account/billing-emails")).deliverTransactionalEmail;
    try {
      email = await deliver(Number(org.owner_user_id), SPAM_REPORT_EMAIL_KIND, `voice-spam-report:${orgId}:${week.key}`, msg);
    } catch (e: any) {
      email = "failed";
      console.error(`[voice-spam] report email for org ${orgId} ${week.key} failed:`, e?.message || e);
      void recordFailure("job", "Weekly spam report email", e, { orgId, week: week.key }, "warning");
    }
  } else {
    email = "opted_out";
  }
  await q.query("UPDATE voice_spam_reports SET email = $2, bell = $3 WHERE id = $1", [claim.id, email, wantsBell]);
  return { ...base, sent: true, calls: calls.length, email, bell: wantsBell };
}

/** Every org with spam in the week and no report yet (`orgIds` narrows it, for tests on a shared database). */
export async function runWeeklySpamReports(now = new Date(), deps: SpamReportDeps & { orgIds?: string[] } = {}): Promise<{ week: string; sent: number; skipped: Record<string, number> }> {
  const q = deps.q ?? pool;
  const week = spamReportWeek(now);
  const { rows } = await q.query(
    `SELECT DISTINCT c.org_id FROM voice_calls c
      WHERE c.outcome IN ('spam', 'blocked')
        AND COALESCE(c.started_at, c.created_at) >= $1 AND COALESCE(c.started_at, c.created_at) < $2
        AND NOT EXISTS (SELECT 1 FROM voice_spam_reports r WHERE r.org_id = c.org_id AND r.week_start = $3::date)
        ${deps.orgIds ? "AND c.org_id = ANY($4::varchar[])" : ""}`,
    deps.orgIds ? [week.start, week.end, week.key, deps.orgIds] : [week.start, week.end, week.key]);
  let sent = 0;
  const skipped: Record<string, number> = {};
  for (const r of rows) {
    try {
      const out = await sendWeeklySpamReport(String(r.org_id), week, deps);
      if (out.sent) sent += 1;
      else skipped[out.reason] = (skipped[out.reason] ?? 0) + 1;
    } catch (e: any) {
      skipped.error = (skipped.error ?? 0) + 1;
      console.error(`[voice-spam] weekly report for org ${r.org_id} failed:`, e?.message || e);
      void recordFailure("job", "Weekly spam report (one org)", e, { orgId: r.org_id, week: week.key });
    }
  }
  return { week: week.key, sent, skipped };
}

// ── The weekly job (started from registerVoiceRoutes in server/voice/index.ts) ──

const CHECK_EVERY_MS = 60 * 60_000;
const FIRST_DELAY_MS = 5 * 60_000;
let workerStarted = false;

/** Why the weekly report job is off, or null when it runs (same switch shape as the number-release sweep). */
export function voiceSpamReportWorkerOffReason(env: NodeJS.ProcessEnv = process.env): string | null {
  const flag = env.VOICE_SPAM_REPORT_WORKER_ENABLED;
  if (flag === "false") return "VOICE_SPAM_REPORT_WORKER_ENABLED is false";
  if (flag === "true") return null;
  if (env.NODE_ENV !== "production") return "this is not a production server (set VOICE_SPAM_REPORT_WORKER_ENABLED=true to run it)";
  return null;
}

/**
 * Every hour, send last week's reports that are not sent yet. Cheap when there
 * is nothing to do (one query); the claim row makes the repeats no-ops, so a
 * restart or an outage on Monday is caught up on the next run.
 */
export function startVoiceSpamReportWorker(): boolean {
  if (workerStarted || process.env.NODE_ENV === "test" || process.env.VITEST) return false;
  workerStarted = true;
  const off = voiceSpamReportWorkerOffReason();
  if (off) {
    console.log(`[voice-spam] weekly spam report is off: ${off}.`);
    return false;
  }
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      const out = await runWeeklySpamReports();
      if (out.sent || Object.keys(out.skipped).length) console.log(`[voice-spam] week ${out.week}: ${out.sent} report(s) sent; skipped ${JSON.stringify(out.skipped)}`);
    } catch (e: any) {
      console.error("[voice-spam] weekly report run failed:", e?.message || e);
      void recordFailure("job", "Weekly spam report run", e);
    } finally { running = false; }
  };
  setTimeout(run, FIRST_DELAY_MS).unref();
  setInterval(run, CHECK_EVERY_MS).unref();
  return true;
}
