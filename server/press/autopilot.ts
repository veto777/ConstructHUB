/**
 * Press autopilot (owner, 2026-10-17: "give it some automation"): an opt-in monthly draft for the customer to approve.
 *
 * On or after the chosen day of each month, the press worker (worker.ts startPressWorker, the "press autopilot pass")
 * takes the customer's top unused story idea (ideas.ts), fills the writer from the account (ideas.ts loadPrefill),
 * creates a release in "draft", lets the writer draft it through the same code path as the Write button (draft.ts,
 * so the same guideline checks run), and puts a notification in the bell (and email, per the user's settings).
 *
 * It NEVER approves, submits or spends a credit: the release stays a draft until the customer presses Approve.
 * It skips the month (and tries again on the next pass, which costs nothing) when there is no idea, no credit left,
 * or a release went out within PRESS_RECOMMENDED_GAP_DAYS. One draft per user per month: press_autopilot_runs is
 * keyed (user_id, month) and the claim is taken before the draft is written; a failed draft is retried at most
 * MAX_ATTEMPTS times that month.
 */
import { pool } from "../db";
import { notifyUser } from "../account-events";
import { PRESS_PATH, PRESS_RECOMMENDED_GAP_DAYS, PRESS_TIERS, type PressAutopilotView, type PressIdea, type PressReleaseInput, type PressTier } from "@shared/press";
import { pressInputSchema, writeDraft } from "./draft";
import { findIdeas, loadPrefill, markIdea } from "./ideas";
import * as store from "./store";
import { pressAiConfigured } from "./writer";

export const MAX_ATTEMPTS = 3;
export const autopilotDeps = { notify: notifyUser, writerReady: () => pressAiConfigured() };

type Settings = { enabled: boolean; dayOfMonth: number; lastCheckedAt: Date | null; lastResult: string | null };

const pad = (v: number) => String(v).padStart(2, "0");
/** "2026-10" in UTC. */
export const monthKey = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`;
const ymd = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const utcDay = (y: number, m: number, day: number) => new Date(Date.UTC(y, m, day));
const startOfDay = (d: Date) => utcDay(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
const shortDate = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

export async function getSettings(userId: number): Promise<Settings> {
  const { rows: [r] } = await pool.query(`SELECT enabled, day_of_month, last_checked_at, last_result FROM press_autopilot WHERE user_id=$1`, [userId]);
  return r ? { enabled: r.enabled, dayOfMonth: r.day_of_month, lastCheckedAt: r.last_checked_at, lastResult: r.last_result } : { enabled: false, dayOfMonth: 1, lastCheckedAt: null, lastResult: null };
}
export async function saveSettings(userId: number, s: { enabled: boolean; dayOfMonth: number }): Promise<void> {
  await pool.query(
    `INSERT INTO press_autopilot (user_id, enabled, day_of_month) VALUES ($1,$2,$3)
     ON CONFLICT (user_id) DO UPDATE SET enabled=EXCLUDED.enabled, day_of_month=EXCLUDED.day_of_month, updated_at=now()`,
    [userId, s.enabled, s.dayOfMonth],
  );
}
async function noteResult(userId: number, result: string): Promise<void> {
  await pool.query(`UPDATE press_autopilot SET last_checked_at=now(), last_result=$2 WHERE user_id=$1`, [userId, result]);
}
async function monthClaimed(userId: number, month: string): Promise<boolean> {
  const { rows } = await pool.query(`SELECT outcome, attempts FROM press_autopilot_runs WHERE user_id=$1 AND month=$2`, [userId, month]);
  const r = rows[0];
  return !!r && (r.outcome !== "failed" || r.attempts >= MAX_ATTEMPTS);
}

/**
 * The next day the worker will try to draft, as "YYYY-MM-DD" (UTC), or null when autopilot is off or there is no
 * credit. The worker tries on the chosen day, and on every later day of that month until it drafts; a release sent
 * within the gap pushes it to the first day the gap has passed.
 */
export function nextDraftOn(s: { enabled: boolean; dayOfMonth: number }, now: Date, o: { monthDone: boolean; hasCredit: boolean; lastSubmittedAt: Date | null; gapDays?: number }): string | null {
  if (!s.enabled || !o.hasCredit) return null;
  const today = startOfDay(now);
  const y = today.getUTCFullYear(), m = today.getUTCMonth();
  let c = o.monthDone ? utcDay(y, m + 1, s.dayOfMonth) : today.getUTCDate() <= s.dayOfMonth ? utcDay(y, m, s.dayOfMonth) : today;
  if (o.lastSubmittedAt) {
    const e = startOfDay(new Date(o.lastSubmittedAt.getTime() + (o.gapDays ?? PRESS_RECOMMENDED_GAP_DAYS) * 86_400_000));
    if (c < e) {
      const sameMonth = e.getUTCFullYear() === c.getUTCFullYear() && e.getUTCMonth() === c.getUTCMonth();
      if (sameMonth) c = e;
      else { const d = utcDay(e.getUTCFullYear(), e.getUTCMonth(), s.dayOfMonth); c = d < e ? e : d; }
    }
  }
  return ymd(c);
}

export async function autopilotView(userId: number, now = new Date()): Promise<PressAutopilotView> {
  const [s, credits, last, done] = await Promise.all([getSettings(userId), store.creditsLeft(userId), store.lastSubmittedAt(userId), monthClaimed(userId, monthKey(now))]);
  const hasCredit = PRESS_TIERS.some((t) => credits[t] > 0);
  return {
    enabled: s.enabled, dayOfMonth: s.dayOfMonth,
    nextDraftOn: nextDraftOn(s, now, { monthDone: done, hasCredit, lastSubmittedAt: last ? new Date(last) : null }),
    lastResult: s.lastResult, lastCheckedAt: s.lastCheckedAt ? new Date(s.lastCheckedAt).toISOString() : null,
  };
}

/** The tier to draft for: the one whose credit expires first. */
async function tierWithCredit(userId: number): Promise<PressTier | null> {
  const { rows: [r] } = await pool.query(
    `SELECT tier FROM press_orders WHERE user_id=$1 AND status='paid' AND credits_used < credits AND (expires_at IS NULL OR expires_at > now()) ORDER BY expires_at NULLS LAST, id LIMIT 1`,
    [userId],
  );
  return r?.tier ?? null;
}

/** The writer's input for an idea: the account's stored details plus the idea's own facts. */
export function inputFromIdea(idea: PressIdea, prefill: Awaited<ReturnType<typeof loadPrefill>>): PressReleaseInput {
  const v = prefill.values;
  return {
    newsType: idea.newsType, companyName: v.companyName ?? "", website: v.website ?? "", city: v.city ?? "", state: v.state ?? "",
    contactName: v.contactName ?? "", contactEmail: v.contactEmail ?? "", contactPhone: v.contactPhone ?? "",
    details: idea.detailsDraft, spokesperson: "", spokespersonTitle: "", quoteNotes: "", about: v.about ?? "", photos: [],
  };
}

export type AutopilotOutcome =
  | { outcome: "off" | "not_due" | "already" | "no_credit" | "too_recent" | "no_idea" | "missing_details" | "no_writer" }
  | { outcome: "drafted"; releaseId: number }
  | { outcome: "failed"; error: string };

/** One user's monthly check. Safe to call as often as you like: at most one draft per month. */
export async function runAutopilotFor(userId: number, now = new Date()): Promise<AutopilotOutcome> {
  const s = await getSettings(userId);
  if (!s.enabled) return { outcome: "off" };
  if (now.getUTCDate() < s.dayOfMonth) return { outcome: "not_due" };
  const month = monthKey(now);
  if (await monthClaimed(userId, month)) return { outcome: "already" };
  const day = shortDate(now);

  const tier = await tierWithCredit(userId);
  if (!tier) { await noteResult(userId, `Skipped ${day}: no release credit left.`); return { outcome: "no_credit" }; }
  const last = await store.lastSubmittedAt(userId);
  if (last && now.getTime() - new Date(last).getTime() < PRESS_RECOMMENDED_GAP_DAYS * 86_400_000) {
    await noteResult(userId, `Waiting: your last release went out on ${shortDate(new Date(last))}. Releases go about a month apart.`);
    return { outcome: "too_recent" };
  }
  const ideas = await findIdeas(userId, { now });
  if (!ideas.length) { await noteResult(userId, `Skipped ${day}: no story idea in your account data this month.`); return { outcome: "no_idea" }; }
  const prefill = await loadPrefill(userId);
  const pick = ideas.map((idea) => ({ idea, input: inputFromIdea(idea, prefill) })).find((x) => pressInputSchema.safeParse(x.input).success);
  if (!pick) { await noteResult(userId, `Skipped ${day}: add your company name, city, state and a media contact email (write one release by hand and they are kept).`); return { outcome: "missing_details" }; }

  if (!autopilotDeps.writerReady()) { await noteResult(userId, `Waiting: the writer is not available right now; it tries again later.`); return { outcome: "no_writer" }; }

  // The claim: one row per user per month. A second pass (or a second process) finds it and stops here.
  const { rows: claimed } = await pool.query(
    `INSERT INTO press_autopilot_runs (user_id, month, outcome, idea_key) VALUES ($1,$2,'drafting',$3)
     ON CONFLICT (user_id, month) DO UPDATE SET outcome='drafting', attempts=press_autopilot_runs.attempts+1, idea_key=EXCLUDED.idea_key, error=NULL, updated_at=now()
       WHERE press_autopilot_runs.outcome='failed' AND press_autopilot_runs.attempts < ${MAX_ATTEMPTS}
     RETURNING attempts`,
    [userId, month, pick.idea.key],
  );
  if (!claimed.length) return { outcome: "already" };

  const row = await store.createRelease(userId, tier, pick.input);
  try {
    const drafted = await writeDraft(row);
    await markIdea(userId, pick.idea.key, "used", row.id);
    await pool.query(`UPDATE press_autopilot_runs SET outcome='drafted', release_id=$3, updated_at=now() WHERE user_id=$1 AND month=$2`, [userId, month, row.id]);
    const headline = drafted.text?.headline ?? pick.idea.title;
    await noteResult(userId, `Drafted ${day}: "${headline}"`);
    await autopilotDeps.notify(userId, "press.autopilot_draft", {
      title: "Your monthly press release draft is ready",
      body: `"${headline}", written from: ${pick.idea.title}. Read it, change anything, then approve it. Nothing is sent and no credit is used until you do.`,
      link: `${PRESS_PATH}?release=${row.id}`, actionUrl: `${PRESS_PATH}?release=${row.id}`, actionLabel: "Review the draft",
    }).catch((e: any) => console.error(`[press] autopilot notify ${userId}: ${e?.message ?? e}`));
    return { outcome: "drafted", releaseId: row.id };
  } catch (e: any) {
    const error = String(e?.message ?? e).slice(0, 300);
    await pool.query(`DELETE FROM press_releases WHERE id=$1 AND status='draft' AND order_id IS NULL`, [row.id]);
    await pool.query(`UPDATE press_autopilot_runs SET outcome='failed', error=$3, updated_at=now() WHERE user_id=$1 AND month=$2`, [userId, month, error]);
    await noteResult(userId, `Could not draft on ${day}; it tries again later.`);
    console.error(`[press] autopilot draft for ${userId}: ${error}`);
    return { outcome: "failed", error };
  }
}

const LOCK = 7173;
/** Every opted-in account whose day has come. One process at a time (a Postgres advisory lock). */
export async function runAutopilot(now = new Date()): Promise<{ ok: boolean; skipped?: string; checked: number; drafted: number }> {
  const client = await pool.connect();
  try {
    const { rows } = await client.query<{ ok: boolean }>(`SELECT pg_try_advisory_lock($1) AS ok`, [LOCK]);
    if (!rows[0]?.ok) return { ok: false, skipped: "A pass is already running", checked: 0, drafted: 0 };
    try {
      const { rows: users } = await pool.query<{ user_id: number }>(`SELECT user_id FROM press_autopilot WHERE enabled AND day_of_month <= $1 ORDER BY user_id`, [now.getUTCDate()]);
      let drafted = 0;
      for (const u of users) {
        try { if ((await runAutopilotFor(u.user_id, now)).outcome === "drafted") drafted++; } catch (e: any) { console.error(`[press] autopilot ${u.user_id}: ${e?.message ?? e}`); }
      }
      return { ok: true, checked: users.length, drafted };
    } finally { await client.query(`SELECT pg_advisory_unlock($1)`, [LOCK]); }
  } finally { client.release(); }
}
