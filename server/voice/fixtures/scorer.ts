/**
 * Scores one scenario run against its rubric (the `expect.*` directives).
 * Python twin: voice/tests/harness/scoring.py — same checks, same names.
 */
import type { Scenario } from "./scenarios";
import { SCRIPT_END, type CallState } from "./call-policy";

export type Check = { name: string; pass: boolean; detail: string };
export type ScoreCard = { id: string; title: string; checks: Check[]; passed: number; total: number; pass: boolean; skipped?: string };

export type RunOutcome = {
  state: CallState;
  /** every assistant line after the greeting, in order */
  says: string[];
  callerLines: string[];
  /** webhook mode: what the pre-answer step returned */
  twiml?: string;
  errors: string[];
};

/** True when the call itself ended; a script that simply ran out of caller lines does not count. */
export function callEnded(s: CallState): boolean {
  return s.ended && s.endReason !== SCRIPT_END;
}

export function score(sc: Scenario, run: RunOutcome): ScoreCard {
  const e = sc.expect, s = run.state, checks: Check[] = [];
  const add = (name: string, pass: boolean, detail = "") => checks.push({ name, pass, detail });

  if (e.outcome) add("outcome", e.outcome.includes(s.outcome ?? ""), `got ${s.outcome} want ${e.outcome.join("|")}`);
  for (const a of e.actions) add(`action ${a}`, s.actions.includes(a), `actions: ${s.actions.join(",") || "-"}`);
  for (const a of e.never) add(`never ${a}`, !s.actions.includes(a), `actions: ${s.actions.join(",") || "-"}`);
  for (const c of e.slots) {
    const v = s.slots[c.key] ?? "";
    const pass = c.op === "?" ? v.trim().length > 0
      : c.op === "=" ? v.trim().toLowerCase() === c.value.toLowerCase()
      : c.op === "~" ? v.toLowerCase().includes(c.value.toLowerCase())
      : !v.toLowerCase().includes(c.value.toLowerCase());
    add(`slot ${c.key} ${c.op} ${c.value}`.trim(), pass, `got "${v}"`);
  }
  for (const m of e.sayNever) {
    const hit = run.says.find((x) => m.test(x));
    add(`say_never ${m.source}`, !hit, hit ? `said: "${hit}"` : "");
  }
  for (const m of e.sayAny) add(`say_any ${m.source}`, run.says.some((x) => m.test(x)), run.says.length ? `last: "${run.says[run.says.length - 1]}"` : "no assistant lines");
  for (const m of e.sayOnce) {
    const n = run.says.filter((x) => m.test(x)).length;
    add(`say_once ${m.source}`, n === 1, `matched ${n} assistant lines`);
  }
  if (e.sayLast) add(`say_last ${e.sayLast.source}`, run.says.length > 0 && e.sayLast.test(run.says[run.says.length - 1]), `last: "${run.says[run.says.length - 1] ?? ""}"`);
  for (const m of e.callerNever) {
    const hit = run.callerLines.find((x) => m.test(x));
    add(`caller_never ${m.source}`, !hit, hit ? `transcript has: "${hit}"` : "");
  }
  // "ended" = the CALL ended (goodbye, silence, spam, caller hang-up, caps) — not the script running out of lines.
  if (e.ended !== undefined) {
    const ended = callEnded(s);
    add("ended", ended === e.ended, `ended=${ended} (${s.endReason || "-"})`);
  }
  if (e.maxTurns !== undefined) add(`max_turns ${e.maxTurns}`, s.assistantTurns <= e.maxTurns, `assistant turns: ${s.assistantTurns}`);
  if (e.alert) for (const k of e.alert) add(`alert ${k}`, s.alerts.some((a) => a.kind === k), `alerts: ${s.alerts.map((a) => a.kind).join(",") || "-"}`);
  if (e.spamMin !== undefined) add(`spam_min ${e.spamMin}`, (s.spam?.confidence ?? 0) >= e.spamMin, `spam: ${s.spam ? `${s.spam.confidence} ${s.spam.reason}` : "-"}`);
  if (e.twiml) add(`twiml ${e.twiml}`, (run.twiml ?? "").includes(e.twiml), `twiml: ${run.twiml ?? "-"}`);
  if (e.notify) add(`notify ${e.notify}`, e.notify === "none" ? s.notifications === 0 : e.notify === "one" ? s.notifications === 1 : s.notifications > 0, `notifications: ${s.notifications}`);
  if (e.lead !== undefined) add(`lead ${e.lead}`, s.leadDelivered === e.lead, `leadDelivered=${s.leadDelivered}${s.forcedSubmit ? " (forced)" : ""}`);
  add("no protocol errors", run.errors.length === 0, run.errors.join(" | "));

  const passed = checks.filter((c) => c.pass).length;
  return { id: sc.id, title: sc.title, checks, passed, total: checks.length, pass: passed === checks.length };
}

export function skippedCard(sc: Scenario, why: string): ScoreCard {
  return { id: sc.id, title: sc.title, checks: [], passed: 0, total: 0, pass: true, skipped: why };
}

/** The scorecard table the runners print. */
export function formatScorecard(cards: ScoreCard[], label: string): string {
  const w = Math.max(10, ...cards.map((c) => c.id.length));
  const rows = cards.map((c) => {
    const mark = c.skipped ? "SKIP" : c.pass ? "PASS" : "FAIL";
    const fails = c.checks.filter((x) => !x.pass).map((x) => `${x.name}${x.detail ? ` (${x.detail})` : ""}`);
    return `  ${mark}  ${c.id.padEnd(w)}  ${c.skipped ? c.skipped : `${c.passed}/${c.total}`}${fails.length ? `\n        - ${fails.join("\n        - ")}` : ""}`;
  });
  const run = cards.filter((c) => !c.skipped);
  const ok = run.filter((c) => c.pass).length;
  return [`Break test — ${label}`, ...rows, `  ${ok}/${run.length} scenarios pass, ${cards.length - run.length} skipped`].join("\n");
}
