/**
 * ONE COMMAND PER VIDEO — the production line (docs/tutorials/PRODUCER-GUIDE.md).
 *
 *   npx tsx scripts/tutorials/produce.ts <helpKey> [--slot N] [--no-upload] [--keep-raw]
 *
 * fresh recording database `constructhub_tut_slot<N>` (a copy of the demo workspace, its dates moved
 * to today) → the app for that slot on port 8180+N (dev server; signed in as the demo owner; no
 * outbound email, texts, payments or background workers — app.ts) → narrate → record → mux →
 * thumbnail → check → upload to R2 and write the manifest (unless --no-upload) → stop the app by its
 * listening pid → drop the database → delete the raw capture and the per-step clips.
 *
 * Slots 1–4 are four independent producers. What they share is guarded machine-wide:
 *   tts.lock     one request to the voice engine at a time (it answers live customer calls)
 *   encode.lock  one ffmpeg at a time, niced, 4 threads (this box serves production)
 *   slot<N>.lock one producer per slot
 * Everything a producer writes is its own: analysis/video-out/<helpKey>/, shared/help/videos/<helpKey>.json.
 */
import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import { ROOT, WORK_DIR, flagNum, loadScript, parseArgs, withLock } from "./lib";
import { drop, fresh, seedDemo, dbMode } from "./db";
import { SLOT_PORT, startApp, stopPort, type RunningApp } from "./app";
import { isCrmRoute, helpEntry } from "../../shared/help/registry";

const TSX = path.join(ROOT, "node_modules/.bin/tsx");
function tool(name: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(TSX, [path.join(ROOT, "scripts/tutorials", `${name}.ts`), ...args], { cwd: ROOT, stdio: "inherit", env: process.env });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve() : reject(new Error(`${name}.ts failed (exit ${code})`)));
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2), ["no-upload", "keep-raw"]);
  const helpKey = args._[0];
  if (!helpKey) throw new Error("Usage: npx tsx scripts/tutorials/produce.ts <helpKey> [--slot 1-4] [--no-upload] [--keep-raw]");
  const slot = flagNum(args, "slot", 1);
  if (!Number.isInteger(slot) || slot < 1 || slot > 4) throw new Error("--slot is 1, 2, 3 or 4");
  const scriptFile = path.join(ROOT, "docs/tutorials/scripts", `${helpKey}.json`);
  if (!fs.existsSync(scriptFile)) throw new Error(`${path.relative(ROOT, scriptFile)} does not exist — write the step script first`);
  const { script } = loadScript(scriptFile);
  const entry = helpEntry(helpKey)!;
  const out = path.join(ROOT, "analysis", "video-out", helpKey);
  fs.mkdirSync(out, { recursive: true });
  const database = `constructhub_tut_slot${slot}`, port = SLOT_PORT(slot);
  // The CRM renders only on its own host name; record.ts points that name at this machine for its browser.
  const base = isCrmRoute(entry.route) ? `http://portal.constructhub.us:${port}` : `http://127.0.0.1:${port}`;
  const started = Date.now();
  const marks: [string, number][] = [];
  const stage = async <T>(name: string, fn: () => Promise<T>): Promise<T> => {
    const t = Date.now();
    console.log(`\n── ${name} ${"─".repeat(Math.max(4, 60 - name.length))}`);
    try { return await fn(); } finally { marks.push([name, Date.now() - t]); }
  };

  await withLock(path.join(WORK_DIR, `slot${slot}.lock`), async () => {
    let app: RunningApp | null = null;
    let cleaned = false;
    const cleanup = async () => {
      if (cleaned) return; cleaned = true;
      if (app) await app.stop().catch(() => {}); else await stopPort(port).catch(() => {});
      await drop(database).catch((e) => console.warn(`could not drop ${database}: ${e instanceof Error ? e.message : e}`));
    };
    const onSignal = () => { void cleanup().finally(() => process.exit(130)); };
    process.once("SIGINT", onSignal); process.once("SIGTERM", onSignal);
    try {
      console.log(`${helpKey} · slot ${slot} · ${database} (${await dbMode()} mode) · ${base}`);
      // The voice does not need the app: narrate while the database is copied and the app boots.
      const narrated = stage("narrate", () => tool("narrate", [scriptFile, "--out", out]));
      narrated.catch(() => {});
      await stage("fresh database", async () => { await fresh(database); console.log(`  ${await seedDemo(database)}`); });
      app = await stage("start the app", () => startApp({ slot, database }));
      console.log(`  listening on :${app.port} (pid ${app.pid}) · log ${app.log}`);
      await narrated;
      await stage("record", () => tool("record", [scriptFile, "--out", out, "--base", base]));
      await stage("stop the app", async () => { await app!.stop(); app = null; });
      await stage("mux", () => tool("mux", [scriptFile, "--out", out]));
      if (script.thumbnail) await stage("thumbnail", () => tool("thumbnail", [scriptFile, "--out", out]));
      await stage("check", () => tool("check", [scriptFile, "--out", out]));
      if (!args.flags["no-upload"]) await stage("upload", () => tool("upload", [helpKey, "--out", out]));
      if (!args.flags["keep-raw"]) {
        // The capture and the per-step clips are scratch (the disk is nearly full); the voice clips stay in the shared cache.
        for (const f of ["raw.webm", "narration.wav", "narration", "steps", "_capture"]) fs.rmSync(path.join(out, f), { recursive: true, force: true });
      }
    } finally {
      process.off("SIGINT", onSignal); process.off("SIGTERM", onSignal);
      await stage("drop the database", cleanup);
    }
  }, { wait: false });

  const video = JSON.parse(fs.readFileSync(path.join(out, "video.json"), "utf8"));
  console.log(`\n${helpKey}: ${video.width}x${video.height} · ${video.durationSec}s · ${(video.files.video.bytes / 1e6).toFixed(2)} MB · ${video.loudness.lufs} LUFS · ${path.relative(ROOT, out)}/walkthrough.mp4`);
  console.log(`time: ${((Date.now() - started) / 1000).toFixed(0)}s total — ${marks.map(([n, ms]) => `${n} ${(ms / 1000).toFixed(0)}s`).join(" · ")}`);
  console.log(args.flags["no-upload"]
    ? "NOT uploaded and no manifest written (--no-upload). Look at the contact sheets, then run without --no-upload."
    : `Uploaded. Commit docs/tutorials/scripts/${helpKey}.json + shared/help/videos/${helpKey}.json (+ index.ts). Look at the contact sheets first.`);
}

main().then(() => process.exit(0), (e) => { console.error(`\n✗ ${e instanceof Error ? e.message : e}`); process.exit(1); });
