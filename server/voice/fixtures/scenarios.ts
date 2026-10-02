/**
 * Break-test scenarios — the ONE source of truth is `voice/tests/scenarios/*.txt`
 * (harness lane). This file is the TypeScript reader of that format; the
 * Python twin is `voice/tests/harness/scenarios.py`. Keep the grammar identical.
 *
 * File grammar (one caller line per row, Alpine's `tests/*.txt` style, plus
 * directives):
 *
 *   #! key: value          directive (see Scenario below)
 *   # anything             comment
 *   Hi, I need new siding  a caller line
 *   => {"say": …}          the CANNED decision for the caller line above
 *                          (the mocked provider replays it; live mode ignores it)
 *   <silence>              the caller says nothing for silencePromptSeconds
 *   <hangup>               the caller hangs up (no goodbye, no decision)
 *   <whisper> text         a CallRail-style whisper heard in the first seconds
 *                          (audio mode only — the media loop must drop it)
 *
 * Expectations (`expect.*`) are the scoring rubric; `scorer.ts` evaluates them.
 */
import fs from "fs";
import path from "path";

export const SCENARIO_DIR = path.resolve(import.meta.dirname, "../../../voice/tests/scenarios");

export type ScenarioMode = "sim" | "audio" | "webhook";
export type SlotCheck = { key: string; op: "~" | "=" | "!~" | "?"; value: string };
export type SayMatcher = { source: string; test: (s: string) => boolean };
export type CallerLine =
  | { kind: "text"; text: string; canned?: string }
  | { kind: "silence"; canned?: string }
  | { kind: "hangup" }
  | { kind: "whisper"; text: string };

export type Scenario = {
  id: string;
  file: string;
  title: string;
  tags: string[];
  caller: string;
  /** ISO local wall time the engine should assume ("now"); empty = real now. */
  clock: string;
  mode: ScenarioMode;
  /** Scenarios to run first with the same caller number (webhook mode: feeds the spam ledger). */
  prelude: { id: string; times: number }[];
  lines: CallerLine[];
  expect: {
    outcome?: string[];
    actions: string[];
    never: string[];
    slots: SlotCheck[];
    sayNever: SayMatcher[];
    sayAny: SayMatcher[];
    sayOnce: SayMatcher[];
    sayLast?: SayMatcher;
    callerNever: SayMatcher[];
    ended?: boolean;
    maxTurns?: number;
    alert?: string[];
    spamMin?: number;
    twiml?: string;
    notify?: "none" | "one" | "some";
    lead?: boolean;
  };
};

/** `/regex/flags` → RegExp test; anything else → case-insensitive substring. */
export function sayMatcher(source: string): SayMatcher {
  const src = source.trim();
  const m = src.match(/^\/(.+)\/([a-z]*)$/);
  if (m) {
    const re = new RegExp(m[1], m[2].includes("i") ? m[2] : m[2] + "i");
    return { source: src, test: (s) => re.test(s) };
  }
  const needle = src.toLowerCase();
  return { source: src, test: (s) => s.toLowerCase().includes(needle) };
}

export function parseSlotCheck(spec: string): SlotCheck {
  const m = spec.trim().match(/^([a-z][a-z0-9_]*)\s*(!~|~|=|\?)\s*(.*)$/);
  if (!m) throw new Error(`bad expect.slot "${spec}" (use key ~ text | key = text | key !~ text | key ?)`);
  return { key: m[1], op: m[2] as SlotCheck["op"], value: m[3].trim() };
}

function words(v: string): string[] {
  return v.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);
}

export function parseScenario(text: string, file = "<inline>"): Scenario {
  const sc: Scenario = {
    id: path.basename(file).replace(/^\d+-/, "").replace(/\.txt$/, ""),
    file, title: "", tags: [], caller: "+13605550123", clock: "", mode: "sim", prelude: [], lines: [],
    expect: { actions: [], never: [], slots: [], sayNever: [], sayAny: [], sayOnce: [], callerNever: [] },
  };
  let last: CallerLine | null = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith("#!")) {
      const m = line.slice(2).match(/^\s*([a-z_.]+)\s*:\s*(.*)$/i);
      if (!m) throw new Error(`${file}: bad directive "${line}"`);
      const key = m[1].toLowerCase(), value = m[2].trim();
      switch (key) {
        case "id": sc.id = value; break;
        case "title": sc.title = value; break;
        case "tags": sc.tags = words(value); break;
        case "caller": sc.caller = value; break;
        case "clock": sc.clock = value; break;
        case "mode": sc.mode = value as ScenarioMode; break;
        case "prelude":
          sc.prelude = value.split(",").map((p) => {
            const pm = p.trim().match(/^([a-z0-9_-]+)(?:\s*x\s*(\d+))?$/i);
            if (!pm) throw new Error(`${file}: bad prelude "${p}"`);
            return { id: pm[1], times: Number(pm[2] || 1) };
          });
          break;
        case "expect.outcome": sc.expect.outcome = value.split("|").map((s) => s.trim()).filter(Boolean); break;
        case "expect.actions": sc.expect.actions.push(...words(value)); break;
        case "expect.never": sc.expect.never.push(...words(value)); break;
        case "expect.slot": sc.expect.slots.push(parseSlotCheck(value)); break;
        case "expect.say_never": sc.expect.sayNever.push(sayMatcher(value)); break;
        case "expect.say_any": sc.expect.sayAny.push(sayMatcher(value)); break;
        case "expect.say_once": sc.expect.sayOnce.push(sayMatcher(value)); break;
        case "expect.say_last": sc.expect.sayLast = sayMatcher(value); break;
        case "expect.caller_never": sc.expect.callerNever.push(sayMatcher(value)); break;
        case "expect.ended": sc.expect.ended = value === "true"; break;
        case "expect.max_turns": sc.expect.maxTurns = Number(value); break;
        case "expect.alert": sc.expect.alert = words(value); break;
        case "expect.spam_min": sc.expect.spamMin = Number(value); break;
        case "expect.twiml": sc.expect.twiml = value; break;
        case "expect.notify": sc.expect.notify = value as "none" | "one" | "some"; break;
        case "expect.lead": sc.expect.lead = value === "true"; break;
        default: throw new Error(`${file}: unknown directive "${key}"`);
      }
      continue;
    }
    if (line.startsWith("#")) continue;
    if (line.startsWith("=>")) {
      if (!last || (last.kind !== "text" && last.kind !== "silence")) throw new Error(`${file}: canned decision without a caller line: ${line}`);
      if (last.canned) throw new Error(`${file}: two canned decisions for one caller line: ${line}`);
      const json = line.slice(2).trim();
      JSON.parse(json); // must be valid JSON; the schema check happens in the test
      (last as { canned?: string }).canned = json;
      continue;
    }
    if (line === "<silence>") last = { kind: "silence" };
    else if (line === "<hangup>") last = { kind: "hangup" };
    else if (line.startsWith("<whisper>")) last = { kind: "whisper", text: line.slice(9).trim() };
    else last = { kind: "text", text: line };
    sc.lines.push(last);
  }
  if (!sc.lines.length && sc.mode !== "webhook") throw new Error(`${file}: no caller lines`);
  if (!sc.title) sc.title = sc.id;
  return sc;
}

export function loadScenarios(dir = SCENARIO_DIR): Scenario[] {
  return fs.readdirSync(dir).filter((f) => f.endsWith(".txt")).sort()
    .map((f) => parseScenario(fs.readFileSync(path.join(dir, f), "utf8"), path.join(dir, f)));
}

export function scenarioById(all: Scenario[], id: string): Scenario {
  const sc = all.find((s) => s.id === id);
  if (!sc) throw new Error(`unknown scenario "${id}"`);
  return sc;
}
