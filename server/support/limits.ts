/**
 * The support line's budgets (review S-10, S-11) — what a caller may cost us before they have proved anything.
 *
 *  Codes (S-10): the one-time-code budgets are keyed per (caller number, target), so a stranger who knows a customer's
 *  number uses up THEIR OWN allowance against that account, never the customer's: 2 codes an hour and 6 a day per pair,
 *  3 an hour per caller number whatever the target. On top, each target (an account — or a made-up identifier, which
 *  gets exactly the same work) may be sent codes from at most SUPPORT_CODE_CALLERS_PER_ACCOUNT_DAY distinct caller
 *  numbers a day; a new caller over that ceiling is refused silently (same words, nothing sent) and only that caller
 *  is locked — numbers already on the day's list, and the account's own phones on file, keep working. The line as a
 *  whole sends at most SUPPORT_CODES_PER_HOUR; that refusal is audible (identical for a hit and a miss) and raises an
 *  ops issue, as does a target hitting the distinct-caller ceiling (somebody is probing that account).
 *
 *  The keypad line (S-11): at most SUPPORT_IVR_MAX_CALLS keypad calls at once (default 10) and
 *  SUPPORT_IVR_MAX_CALLS_PER_CALLER per caller number (2), SUPPORT_IVR_CALLS_PER_CALLER_DAY a day per caller (10);
 *  over any of them the caller hears "busy, try again later" and the call ends. A keypad call ends at
 *  SUPPORT_IVR_MAX_CALL_SECONDS (360). The whole support line — keypad AND the engine's spoken calls — has a daily
 *  carrier-minute budget, SUPPORT_LINE_DAILY_MINUTES (600): every turn meters the seconds since the call's previous
 *  turn into it (the carrier's status callback settles the exact duration when it arrives), and once it is spent the
 *  line answers "call back tomorrow or email" instead of consuming more. Counters live in growth_budgets / support_calls
 *  (Postgres), so they survive restarts and are shared by every worker. Each cap raises an ops issue when it trips.
 *
 *  Pure wiring: every dependency (budget table, call store, the issue desk) is injectable, so limits.test.ts runs
 *  without a database or a carrier. The defaults are the real ones.
 */
import { createHash } from "crypto";
import { pool } from "../db";
import { budgetUsed, takeBudget } from "../growth-limits";
import { recordIssue } from "../ops/issues";

export const HOUR = 3_600_000, DAY = 24 * HOUR;

/** -1 = unlimited; 0 = closed; unset or garbage = the default. */
const envInt = (k: string, d: number) => { const v = process.env[k]; if (v === undefined || v === "") return d; const n = Number(v); return Number.isFinite(n) && n >= -1 ? Math.floor(n) : d; };
export const LIMITS = {
  codesPerCallerHour: 3, codesPerPairHour: 2, codesPerPairDay: 6,
  codesPerHour: () => envInt("SUPPORT_CODES_PER_HOUR", 300),
  codeCallersPerTargetDay: () => envInt("SUPPORT_CODE_CALLERS_PER_ACCOUNT_DAY", 4),
  ivrMaxCalls: () => envInt("SUPPORT_IVR_MAX_CALLS", 10),
  ivrMaxCallsPerCaller: () => envInt("SUPPORT_IVR_MAX_CALLS_PER_CALLER", 2),
  ivrCallsPerCallerDay: () => envInt("SUPPORT_IVR_CALLS_PER_CALLER_DAY", 10),
  ivrMaxCallSeconds: () => envInt("SUPPORT_IVR_MAX_CALL_SECONDS", 360),
  dailyMinutes: () => envInt("SUPPORT_LINE_DAILY_MINUTES", 600),
  /** The most one turn can meter (a 120 s recording + prompts + the carrier's timeouts); a stuck clock can't drain the day. */
  maxSecondsPerTurn: 200,
  /** A keypad call we haven't heard from for this long after its cap is over, whatever the carrier forgot to tell us. */
  graceSeconds: 150,
};
const MINUTES_KEY = "support:minutes:d";

export type Budget = { take(key: string, limit: number, amount: number, windowMs: number): Promise<boolean>; used(key: string, windowMs: number): Promise<number> };
export type IssueFn = (i: { key: string; title: string; detail?: Record<string, unknown>; severity?: "warning" | "error" }) => void;
export type CallStore = {
  /** Open keypad calls (not ended, heard from within the grace window), other than `exceptSid`; `caller` narrows to one number. */
  activeIvr(exceptSid: string, caller: string | null): Promise<number>;
  /** When the call started and how many seconds of it are already in the minutes budget. null = no such call. */
  clock(callSid: string): Promise<{ startedMs: number; meteredSeconds: number } | null>;
  addMetered(callSid: string, seconds: number): Promise<void>;
  end(callSid: string): Promise<void>;
};

export const realBudget: Budget = { take: (k, l, a, w) => takeBudget(k, l, a, w), used: (k, w) => budgetUsed(k, w) };
export const realIssue: IssueFn = (i) => { void recordIssue({ source: "server", severity: i.severity ?? "warning", key: `support-line|${i.key}`, title: i.title, detail: i.detail }); };
export const realStore: CallStore = {
  async activeIvr(exceptSid, caller) {
    const grace = LIMITS.ivrMaxCallSeconds() + LIMITS.graceSeconds;
    const { rows } = await pool.query(
      `SELECT count(*) AS n FROM support_calls WHERE line = 'ivr' AND ended_at IS NULL AND call_sid <> $1 AND updated_at > now() - make_interval(secs => $2) ${caller ? "AND caller_number = $3" : ""}`,
      caller ? [exceptSid, grace, caller] : [exceptSid, grace]);
    return Number(rows[0]?.n ?? 0);
  },
  async clock(callSid) {
    const r = (await pool.query(`SELECT created_at, metered_seconds FROM support_calls WHERE call_sid = $1`, [callSid])).rows[0];
    return r ? { startedMs: new Date(r.created_at).getTime(), meteredSeconds: Number(r.metered_seconds) || 0 } : null;
  },
  async addMetered(callSid, seconds) { await pool.query(`UPDATE support_calls SET metered_seconds = metered_seconds + $2 WHERE call_sid = $1`, [callSid, seconds]); },
  async end(callSid) { await pool.query(`UPDATE support_calls SET ended_at = COALESCE(ended_at, now()), updated_at = now() WHERE call_sid = $1`, [callSid]); },
};

const short = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 16);

// ---- S-10: one-time codes ---------------------------------------------------------------------------------------
/**
 * May this caller be sent a code for this target? "refuse" = say so (the caller's or the line's budget — identical for
 * a real and a made-up account); "silent" = the same words as a send, nothing sent; "send" = deliver. A null target
 * (no such account) does exactly the same budget work as a real one, under a key derived from what the caller gave.
 */
export async function codeSendGate(target: { userId: number; phones: string[] } | null, ref: string, caller: string, b: Budget = realBudget, issue: IssueFn = realIssue): Promise<"refuse" | "silent" | "send"> {
  if (!(await b.take(`support:code:caller:${caller}`, LIMITS.codesPerCallerHour, 1, HOUR))) return "refuse";
  if (!(await b.take("support:code:all", LIMITS.codesPerHour(), 1, HOUR))) {
    issue({ key: "codes-per-hour", title: "Support line: the hourly one-time-code cap is spent — codes are being refused", detail: { limit: LIMITS.codesPerHour() } });
    return "refuse";
  }
  const t = target ? `acct:${target.userId}` : `miss:${short(ref.toLowerCase())}`;
  const pair = `support:code:${t}:from:${short(caller)}`;
  // A caller new to this target today counts against the target's distinct-caller ceiling — unless they call from a
  // phone on the account. Refused, they take nothing from the pair budgets either, so the ceiling keeps refusing them.
  const firstToday = (await b.used(`${pair}:d`, DAY)) === 0;
  const onFile = !!target && target.phones.includes(caller);
  if (firstToday && !onFile && !(await b.take(`support:code:${t}:callers:d`, LIMITS.codeCallersPerTargetDay(), 1, DAY))) {
    if (target) issue({ key: `code-probe|${t}`, title: "Support line: one account is being sent codes from too many caller numbers today (probe?)", detail: { userId: target.userId, limit: LIMITS.codeCallersPerTargetDay() } });
    return "silent";
  }
  const okHour = await b.take(`${pair}:h`, LIMITS.codesPerPairHour, 1, HOUR), okDay = await b.take(`${pair}:d`, LIMITS.codesPerPairDay, 1, DAY);
  return target && okHour && okDay ? "send" : "silent";
}

// ---- S-11: the keypad line's seats and the whole line's minutes -------------------------------------------------
const minutesLimitSeconds = () => { const m = LIMITS.dailyMinutes(); return m < 0 ? -1 : m * 60; };
/** Add seconds to the day's minutes. false = they didn't fit: the day is then marked spent (the minutes were used regardless). */
async function spendMinutes(b: Budget, seconds: number): Promise<boolean> {
  const lim = minutesLimitSeconds();
  if (lim < 0) return true;
  if (lim > 0 && (await b.take(MINUTES_KEY, lim, Math.min(seconds, lim), DAY))) return true;
  const rem = lim - (await b.used(MINUTES_KEY, DAY));
  if (rem > 0) await b.take(MINUTES_KEY, lim, rem, DAY);
  return false;
}
/** The day's carrier-minute budget is spent (keypad and spoken calls together). */
export async function minutesExhausted(b: Budget = realBudget): Promise<boolean> {
  const lim = minutesLimitSeconds();
  return lim >= 0 && (await b.used(MINUTES_KEY, DAY)) >= lim;
}

export type Admission = { ok: true } | { ok: false; why: "minutes" | "busy" | "caller_busy" | "caller_day" };
/** Should the keypad line take this call? `fresh` = the first webhook for this CallSid (a re-sent one costs no daily call). */
export async function admitIvrCall(callSid: string, caller: string | null, fresh: boolean, deps: { store?: CallStore; budget?: Budget; issue?: IssueFn } = {}): Promise<Admission> {
  const store = deps.store ?? realStore, b = deps.budget ?? realBudget, issue = deps.issue ?? realIssue;
  if (await minutesExhausted(b)) {
    issue({ key: "daily-minutes", title: "Support line: the day's carrier-minute budget is spent — callers are told to call back", detail: { minutes: LIMITS.dailyMinutes() } });
    return { ok: false, why: "minutes" };
  }
  const max = LIMITS.ivrMaxCalls();
  if (max >= 0 && (await store.activeIvr(callSid, null)) >= max) {
    issue({ key: "ivr-busy", title: "Support line: the keypad line is at its concurrent-call cap — callers hear 'busy'", detail: { limit: max } });
    return { ok: false, why: "busy" };
  }
  const perCaller = LIMITS.ivrMaxCallsPerCaller();
  if (caller && perCaller >= 0 && (await store.activeIvr(callSid, caller)) >= perCaller) {
    issue({ key: "ivr-caller-busy", title: "Support line: one caller number holds too many keypad calls at once", detail: { limit: perCaller } });
    return { ok: false, why: "caller_busy" };
  }
  if (fresh && !(await b.take(`support:ivr:caller:${caller ?? "unknown"}:d`, LIMITS.ivrCallsPerCallerDay(), 1, DAY))) {
    issue({ key: "ivr-caller-day", title: "Support line: one caller number is over its keypad calls for the day", detail: { limit: LIMITS.ivrCallsPerCallerDay() } });
    return { ok: false, why: "caller_day" };
  }
  return { ok: true };
}

/**
 * Meter the call's time since its last turn into the day's minutes (bounded per turn). `ok: false` = the budget is
 * spent: end the call. `total` = the call's age in seconds (the keypad line's own cap is judged on it by the caller).
 */
export async function meterCall(callSid: string, nowMs: number, deps: { store?: CallStore; budget?: Budget; issue?: IssueFn } = {}): Promise<{ ok: boolean; total: number }> {
  const store = deps.store ?? realStore, b = deps.budget ?? realBudget, issue = deps.issue ?? realIssue;
  const c = await store.clock(callSid);
  if (!c) return { ok: true, total: 0 };
  const total = Math.max(0, Math.floor((nowMs - c.startedMs) / 1000));
  const delta = Math.min(Math.max(total - c.meteredSeconds, 0), LIMITS.maxSecondsPerTurn);
  const lim = minutesLimitSeconds();
  if (delta === 0) return { ok: lim < 0 || (await b.used(MINUTES_KEY, DAY)) < lim, total };
  await store.addMetered(callSid, delta);
  if (await spendMinutes(b, delta)) return { ok: true, total };
  issue({ key: "daily-minutes", title: "Support line: the day's carrier-minute budget is spent — callers are told to call back", detail: { minutes: LIMITS.dailyMinutes() } });
  return { ok: false, total };
}

/**
 * The carrier's own duration for a finished call (its status callback, relayed by the engine): meter whatever the
 * turns didn't, mark the call over. false = not a support call.
 */
export async function settleSupportCall(callSid: string, durationSeconds: number | undefined, deps: { store?: CallStore; budget?: Budget } = {}): Promise<boolean> {
  const store = deps.store ?? realStore, b = deps.budget ?? realBudget;
  const c = await store.clock(callSid);
  if (!c) return false;
  const dur = Math.max(0, Math.floor(durationSeconds ?? 0)), delta = Math.max(dur - c.meteredSeconds, 0);
  if (delta > 0) { await store.addMetered(callSid, delta); await spendMinutes(b, delta); }
  await store.end(callSid);
  return true;
}
