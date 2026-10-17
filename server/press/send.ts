/**
 * "Send it for me" (owner, 2026-10-17: "needs automation"). A draft the customer marks "send for me" (or an autopilot
 * draft when the setting is on) that has NO blocking guideline issue is scheduled to go out 2 business days later at
 * 10:00 in the customer's time zone (their CRM company's, else America/New_York). The bell and email say exactly
 * when, with a one-click "Hold it" link (a signed token that expires at the send time; GET shows a confirm page,
 * POST holds). Editing the release or pressing Hold clears the time.
 *
 * At the time, the press pass (worker.ts runPressPass → sendDue) runs approve.ts approveRelease, the Approve
 * button's own path, in one transaction on the locked row (SELECT … FOR UPDATE): send_at must still be the time the
 * pass found, the text must hash to the scheduled version, then the guideline check, the credit and status 'ready'
 * with approved_hash. So it is sent at most once however many passes run, and an edit either lands first (and stops
 * it) or is refused. A blocking issue, no credit, or an
 * edit after scheduling means it is not sent, and the customer is told why.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { pool } from "../db";
import { notifyUser } from "../account-events";
import { PRESS_PATH, type PressGuidelineIssue } from "@shared/press";
import { checkRelease, hasBlockingIssue } from "./guidelines";
import { approveRelease } from "./approve";
import * as store from "./store";

export const SEND_HOUR = 10;
export const SEND_BUSINESS_DAYS = 2;
export const DEFAULT_TZ = "America/New_York";
export const sendDeps = { notify: notifyUser };

const validTz = (tz: unknown): tz is string => {
  if (typeof tz !== "string" || !tz) return false;
  try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); return true; } catch { return false; }
};
/** The wall clock in `tz` at `d`. */
function wall(d: Date, tz: string) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(d).map((x) => [x.type, x.value]));
  return { y: Number(p.year), m: Number(p.month), d: Number(p.day), h: Number(p.hour) % 24, min: Number(p.minute), s: Number(p.second) };
}
/** The instant when the wall clock in `tz` reads y-m-d h:00 (DST-safe for whole hours outside the gap). */
export function zonedTime(y: number, m: number, d: number, h: number, tz: string): Date {
  const guess = Date.UTC(y, m - 1, d, h);
  const offsetAt = (t: number) => { const w = wall(new Date(t), tz); return Date.UTC(w.y, w.m - 1, w.d, w.h, w.min, w.s) - t; };
  let t = guess - offsetAt(guess);
  t = guess - offsetAt(t);
  return new Date(t);
}
/** 2 business days (Mon–Fri) after `from`'s date in `tz`, at 10:00 there. */
export function sendAtFor(from: Date, tz: string = DEFAULT_TZ): Date {
  const zone = validTz(tz) ? tz : DEFAULT_TZ;
  const w = wall(from, zone);
  const day = new Date(Date.UTC(w.y, w.m - 1, w.d));
  let counted = 0;
  while (counted < SEND_BUSINESS_DAYS) {
    day.setUTCDate(day.getUTCDate() + 1);
    const dow = day.getUTCDay();
    if (dow !== 0 && dow !== 6) counted++;
  }
  return zonedTime(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate(), SEND_HOUR, zone);
}
/** "Thu, Oct 23 at 10:00 AM EDT" in the customer's zone. */
export function sendWords(at: Date, tz: string): string {
  const zone = validTz(tz) ? tz : DEFAULT_TZ;
  const date = at.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: zone });
  const time = at.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: zone, timeZoneName: "short" });
  return `${date} at ${time}`;
}
/** The customer's time zone: their CRM company's, else America/New_York. */
export async function userTimeZone(userId: number): Promise<string> {
  const { rows: [r] } = await pool.query(`SELECT timezone FROM crm_orgs WHERE owner_user_id=$1 ORDER BY created_at ASC NULLS LAST, id LIMIT 1`, [userId]);
  return validTz(r?.timezone) ? r.timezone : DEFAULT_TZ;
}

// ---- the Hold link ---------------------------------------------------------------------------------------------

const holdKey = () => {
  const secret = process.env.PRESS_HOLD_SECRET || process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET is not set");
  return createHmac("sha256", secret).update("press-hold-link").digest();
};
const sign = (payload: string) => createHmac("sha256", holdKey()).update(payload).digest("base64url");
/** "<release>.<send time in seconds>.<signature>": good until the send time. */
export function holdToken(releaseId: number, sendAt: Date): string {
  const payload = `${releaseId}.${Math.floor(sendAt.getTime() / 1000)}`;
  return `${payload}.${sign(payload)}`;
}
export function verifyHoldToken(token: string, now = new Date()): { releaseId: number; sendAt: Date } | null {
  const m = /^(\d{1,10})\.(\d{1,12})\.([A-Za-z0-9_-]{43})$/.exec(String(token ?? ""));
  if (!m) return null;
  const want = Buffer.from(sign(`${m[1]}.${m[2]}`)), got = Buffer.from(m[3]);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  const sendAt = new Date(Number(m[2]) * 1000);
  if (sendAt.getTime() <= now.getTime()) return null;
  return { releaseId: Number(m[1]), sendAt };
}
export const holdPath = (token: string) => `/api/public/press-hold?t=${encodeURIComponent(token)}`;
const base = () => process.env.APP_URL || "https://constructhub.us";

// ---- scheduling ------------------------------------------------------------------------------------------------

/** What was scheduled: the text and the facts (store.ts). A release edited since no longer matches. */
export const releaseHash = store.releaseHash;

const issueWords = (issues: PressGuidelineIssue[]) => issues.filter((i) => i.blocking).map((i) => `${i.rule}: ${i.detail}`).join(" ");

export type ScheduleResult = { scheduled: true; sendAt: Date; row: store.ReleaseRow } | { scheduled: false; why: "state" | "no_text" | "guidelines" | "no_credit"; message: string; issues?: PressGuidelineIssue[] };

/** Turns "send for me" on for a draft and schedules it, or says why it cannot be (and tells the customer). */
export async function scheduleSend(row: store.ReleaseRow, opts: { now?: Date; notify?: boolean } = {}): Promise<ScheduleResult> {
  const now = opts.now ?? new Date();
  const link = `${PRESS_PATH}?release=${row.id}`;
  if (row.status !== "draft") return { scheduled: false, why: "state", message: "Only a draft can be sent for you." };
  if (!row.text) return { scheduled: false, why: "no_text", message: "Write the release first." };
  const issues = checkRelease(row.text, row.input);
  if (hasBlockingIssue(issues)) {
    const message = "It has guideline problems the wire's editors would refuse, so it will not go out on its own. Fix them, then turn on Send it for me again.";
    await store.updateRelease(row.id, { issues, send_for_me: false, send_at: null, send_note: message });
    if (opts.notify !== false) await sendDeps.notify(row.user_id, "press.needs_fix", { title: "Your press release needs a fix before it can go out", body: issueWords(issues), link, actionUrl: link, actionLabel: "Fix the draft", severity: "warning" }).catch(() => undefined);
    return { scheduled: false, why: "guidelines", message, issues };
  }
  const credits = await store.creditsLeft(row.user_id);
  if (!row.order_id && credits[row.tier] < 1) return { scheduled: false, why: "no_credit", message: "Sending it needs a release credit. Pick a package first." };
  const tz = await userTimeZone(row.user_id);
  const sendAt = sendAtFor(now, tz);
  // Guarded: a release approved meanwhile is not scheduled. An edit after this is caught by the hash at send time.
  const upd = await store.updateEditable(row.id, { issues, send_for_me: true, send_at: sendAt, send_hash: releaseHash(row), send_note: null });
  if (!upd) return { scheduled: false, why: "state", message: "This release was already approved" };
  if (opts.notify !== false) {
    const when = sendWords(sendAt, tz);
    const hold = holdPath(holdToken(row.id, sendAt));
    await sendDeps.notify(row.user_id, "press.send_scheduled", {
      title: `Your press release goes out ${when}`,
      body: `"${row.text.headline}" goes to the wire ${when} and uses one credit. To stop it, hold it before then: ${base()}${hold}. Editing the draft also stops it.`,
      link, actionUrl: hold, actionLabel: "Hold it",
    }).catch(() => undefined);
  }
  return { scheduled: true, sendAt, row: upd };
}

/** Hold: the release stays a draft and nothing goes out. False when there was nothing scheduled. */
export async function holdSend(releaseId: number, opts: { userId?: number; sendAt?: Date; note?: string } = {}): Promise<boolean> {
  const vals: unknown[] = [releaseId, opts.note ?? "Held. It will not go out until you approve it."];
  let where = "id=$1 AND send_at IS NOT NULL AND status='draft'";
  if (opts.userId != null) { vals.push(opts.userId); where += ` AND user_id=$${vals.length}`; }
  if (opts.sendAt) { vals.push(opts.sendAt); where += ` AND date_trunc('second', send_at)=date_trunc('second', $${vals.length}::timestamptz)`; }
  const { rowCount } = await pool.query(`UPDATE press_releases SET send_at=NULL, send_for_me=false, send_note=$2, updated_at=now() WHERE ${where}`, vals);
  return (rowCount ?? 0) > 0;
}

// ---- sending at the time ---------------------------------------------------------------------------------------

export type SendOutcome = { id: number; outcome: "sent" | "lost_race" | "edited" | "guidelines" | "no_credit" | "error"; message?: string };

async function tell(row: store.ReleaseRow, note: string): Promise<void> {
  const link = `${PRESS_PATH}?release=${row.id}`;
  await sendDeps.notify(row.user_id, "press.needs_fix", { title: "Your press release did not go out", body: note, link, actionUrl: link, actionLabel: "Open the draft", severity: "warning" }).catch(() => undefined);
}

/**
 * One release whose time has come. The claim, the hash check on the locked row, the guideline check, the credit and
 * the 'ready' status are one transaction (approve.ts), so many passes at once send it once, and an edit or a rewrite
 * either lands first (and stops the send) or finds it approved (and is refused with 409).
 */
export async function sendOne(id: number, sendAt: Date): Promise<SendOutcome> {
  try {
    const out = await approveRelease(id, { kick: false, auto: { sendAt, note: (why) => why.startsWith("It ") ? why : `It was not sent: ${why}` } });
    if (out.ok) {
      await store.updateRelease(id, { send_note: "Sent for you." });
      return { id, outcome: "sent" };
    }
    if (out.code === "lost_race" || out.code === "not_found") return { id, outcome: "lost_race" };
    const outcome: SendOutcome["outcome"] = out.code === "edited" ? "edited" : out.code === "guidelines" ? "guidelines" : out.code === "no_credit" ? "no_credit" : "error";
    const note = out.code === "guidelines" ? `It was not sent: ${issueWords(out.issues ?? [])}` : out.code === "no_credit" ? "It was not sent: no release credit is left. Pick a package, then approve it." : out.code === "edited" ? out.message : `It was not sent: ${out.message}`;
    if (out.row) { if (note !== out.message) await store.updateRelease(id, { send_note: note }); await tell(out.row, note); }
    return { id, outcome, message: note };
  } catch (e: any) {
    // Rolled back: the schedule is untouched and the next pass tries again.
    console.error(`[press] auto-send ${id}: ${e?.message ?? e}`);
    return { id, outcome: "error", message: String(e?.message ?? e) };
  }
}

/** Every release whose send time has passed. Called by the press pass before it submits. */
export async function sendDue(now = new Date()): Promise<SendOutcome[]> {
  const { rows } = await pool.query<{ id: number; send_at: Date }>(`SELECT id, send_at FROM press_releases WHERE send_at IS NOT NULL AND send_at <= $1 AND status='draft' ORDER BY send_at LIMIT 200`, [now]);
  const out: SendOutcome[] = [];
  for (const r of rows) out.push(await sendOne(r.id, r.send_at));
  return out;
}
