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
 *  Pure wiring: every dependency (budget table, call store, the issue desk) is injectable, so limits.test.ts runs
 *  without a database or a carrier. The defaults are the real ones.
 */
import { createHash } from "crypto";
import { budgetUsed, takeBudget } from "../growth-limits";
import { recordIssue } from "../ops/issues";

export const HOUR = 3_600_000, DAY = 24 * HOUR;

/** -1 = unlimited; 0 = closed; unset or garbage = the default. */
const envInt = (k: string, d: number) => { const v = process.env[k]; if (v === undefined || v === "") return d; const n = Number(v); return Number.isFinite(n) && n >= -1 ? Math.floor(n) : d; };
export const LIMITS = {
  codesPerCallerHour: 3, codesPerPairHour: 2, codesPerPairDay: 6,
  codesPerHour: () => envInt("SUPPORT_CODES_PER_HOUR", 300),
  codeCallersPerTargetDay: () => envInt("SUPPORT_CODE_CALLERS_PER_ACCOUNT_DAY", 4),
};

export type Budget = { take(key: string, limit: number, amount: number, windowMs: number): Promise<boolean>; used(key: string, windowMs: number): Promise<number> };
export type IssueFn = (i: { key: string; title: string; detail?: Record<string, unknown>; severity?: "warning" | "error" }) => void;
export const realBudget: Budget = { take: (k, l, a, w) => takeBudget(k, l, a, w), used: (k, w) => budgetUsed(k, w) };
export const realIssue: IssueFn = (i) => { void recordIssue({ source: "server", severity: i.severity ?? "warning", key: `support-line|${i.key}`, title: i.title, detail: i.detail }); };
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
