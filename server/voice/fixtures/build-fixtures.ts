/**
 * Regenerates the shared fixtures every server lane's tests import:
 *
 *   compiled.v1.json            compileVoiceProfile(profile.alpine-like.json, version 1, fixed clock)
 *   call-report.<kind>.json     {scenario, callSid, start, events, report} — SPEC.md § 5 bodies from
 *                               canned break-test runs (lead, alert, declined, spam, blocked, forced)
 *
 *   npx tsx server/voice/fixtures/build-fixtures.ts [--compiler <path to prompt-compiler.ts>] [--check]
 *
 * `--compiler` lets the harness build compiled.v1.json with another lane's compiler before it merges
 * (the integrator re-runs this after studio-backend lands). `--check` exits 1 when a file would change.
 */
import fs from "fs";
import path from "path";
import { parseVoiceProfile, type CompiledProfile, type VoiceProfile } from "@shared/voice-profile";
import { loadScenarios, scenarioById } from "./scenarios";
import { runAll, cannedProvider } from "./break-test-runner";
import { callFixture, blockedFixture } from "./call-report";

const DIR = path.resolve(import.meta.dirname);
export const FIXED_NOW = new Date("2026-10-02T00:00:00Z");

export function loadProfileFixture(): VoiceProfile {
  return parseVoiceProfile(JSON.parse(fs.readFileSync(path.join(DIR, "profile.alpine-like.json"), "utf8")));
}

type Compile = (p: VoiceProfile, v: number, now?: Date) => CompiledProfile;

async function main() {
  const args = process.argv.slice(2);
  const ci = args.indexOf("--compiler");
  const check = args.includes("--check");
  const mod = ci >= 0 ? await import(path.resolve(args[ci + 1])) : await import("../prompt-compiler");
  const compile: Compile = mod.compileVoiceProfile;
  const compiled = compile(loadProfileFixture(), 1, FIXED_NOW);

  const out: Record<string, unknown> = { "compiled.v1.json": compiled };
  const scenarios = loadScenarios();
  const want: Record<string, string> = {
    lead: "routine_lead", alert: "existing_customer", urgent: "emergency_after_hours", declined: "repair_request",
    spam: "spam_google_listing", forced: "caller_hangs_up_mid_call",
  };
  const results = await runAll(scenarios, compiled, (sc) => cannedProvider(sc), { only: (sc) => Object.values(want).includes(sc.id) });
  for (const [kind, id] of Object.entries(want)) {
    const r = results.find((x) => x.card.id === id);
    if (!r) throw new Error(`no run for ${id}`);
    if (!r.card.pass) throw new Error(`${id} fails its own rubric — fix the scenario before building fixtures`);
    out[`call-report.${kind}.json`] = callFixture(scenarioById(scenarios, id), r.run.state, compiled);
  }
  out["call-report.blocked.json"] = blockedFixture(scenarioById(scenarios, "blocked_second_call"), compiled);

  let changed = 0;
  for (const [name, data] of Object.entries(out)) {
    const file = path.join(DIR, name);
    const text = JSON.stringify(data, null, 2) + "\n";
    const prev = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
    if (prev === text) continue;
    changed++;
    if (check) console.log(`would change: ${name}`);
    else { fs.writeFileSync(file, text); console.log(`wrote ${name}`); }
  }
  console.log(`${changed} fixture file(s) ${check ? "out of date" : "written"}; compiler: ${ci >= 0 ? args[ci + 1] : "server/voice/prompt-compiler.ts"}`);
  if (check && changed) process.exit(1);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename ?? "");
if (isMain) main().catch((e) => { console.error(e); process.exit(1); });
