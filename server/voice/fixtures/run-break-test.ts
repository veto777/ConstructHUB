/**
 * The break-test scorecard from the command line (TypeScript side).
 *
 *   npx tsx server/voice/fixtures/run-break-test.ts                       canned decisions (no network)
 *   VOICE_LIVE_AI=1 npx tsx server/voice/fixtures/run-break-test.ts --live   the app's real AI provider
 *   npx tsx server/voice/fixtures/run-break-test.ts --endpoint http://127.0.0.1:8200   the app's /api/crm/voice/simulator/*
 *        (a dev server with DEV_AUTH_BYPASS_USER1=true and the callAssistant add-on on user 1's org)
 *   options: --only id[,id] · --tag injection · -v (print transcripts) · --compiler <prompt-compiler.ts>
 *
 * Exit code 0 when every scenario that ran passed. The Python twin (voice/tests/run_break_test.py) runs the
 * same scenarios through the engine's own brain and through fake_signalwire.py.
 */
import path from "path";
import type { CompiledProfile } from "@shared/voice-profile";
import { loadScenarios } from "./scenarios";
import { runAll, cannedProvider, liveProvider, endpointSession } from "./break-test-runner";
import { formatScorecard } from "./scorer";
import { loadProfileFixture, FIXED_NOW } from "./build-fixtures";

async function main() {
  const args = process.argv.slice(2);
  const opt = (k: string) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
  const live = args.includes("--live");
  const endpoint = opt("--endpoint");
  const verbose = args.includes("-v");
  const only = opt("--only")?.split(",");
  const tag = opt("--tag");
  const compilerPath = opt("--compiler");
  const mod = compilerPath ? await import(path.resolve(compilerPath)) : await import("../prompt-compiler");
  const compiled: CompiledProfile = mod.compileVoiceProfile(loadProfileFixture(), 1, live ? new Date() : FIXED_NOW);

  if (live && process.env.VOICE_LIVE_AI !== "1") throw new Error("--live needs VOICE_LIVE_AI=1 (it calls the real provider)");
  const provider = live ? liveProvider({ temperature: compiled.style.temperature }) : null;
  const scenarios = loadScenarios();
  const label = endpoint ? `endpoint ${endpoint}` : live ? provider!.name : "canned decisions";
  const results = await runAll(scenarios, compiled, (sc) => provider ?? cannedProvider(sc), {
    only: (sc) => (!only || only.includes(sc.id)) && (!tag || sc.tags.includes(tag)) && (!endpoint || sc.mode === "sim"),
    session: endpoint ? () => endpointSession(endpoint, { "X-Requested-With": "break-test" }) : undefined,
    onResult: (r) => {
      if (verbose || !r.card.pass) console.log(`\n── ${r.card.id} ──\n${r.transcript.join("\n")}`);
    },
  });
  console.log("\n" + formatScorecard(results.map((r) => r.card), label));
  process.exit(results.every((r) => r.card.pass) ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(2); });
