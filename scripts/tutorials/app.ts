/**
 * One app per recording slot — a dev server on port 8180+slot against that slot's recording
 * database, with every outbound channel shut:
 *
 *   · NODE_ENV=development + EMAIL_FORCE_SINK=1 and no SMTP_* in its environment → every email is
 *     appended to tmp/email-outbox.jsonl, never sent (server/email.ts `sinkToOutbox`);
 *   · no SIGNALWIRE_* → every text goes to the log provider, SMS_OUTBOX_PATH in the slot dir
 *     (server/crm/sms.ts);
 *   · no Stripe, Google, HOVER, OpenAI, R2 or voice-engine credentials at all: the environment is
 *     built from nothing (below), not inherited — a producer's shell cannot leak a key into it;
 *   · SEO_JOBS_DISABLED=true, and neither EDGE_SEARCH_WORKER_ENABLED nor GBP_CONTENT_WORKER_ENABLED.
 *
 * DEV_AUTH_BYPASS_USER1=true signs every request in as user 1 — in a recording database that is
 * the demo owner ("Demo Account", Aspire Interiors). The app is stopped by the pid that is
 * LISTENING on the slot's port (tsx starts node as a child; killing the wrapper would orphan it).
 */
import { spawn } from "child_process";
import { randomBytes } from "crypto";
import fs from "fs";
import path from "path";
import { ROOT, WORK_DIR, run, sleep } from "./lib";
import { databaseUrl } from "./db";

export const SLOT_PORT = (slot: number) => 8180 + slot;
export const slotDir = (slot: number) => { const d = path.join(WORK_DIR, `slot${slot}`); fs.mkdirSync(d, { recursive: true }); return d; };

/** The pid listening on a TCP port of this machine, or null. */
export async function listeningPid(port: number): Promise<number | null> {
  const out = (await run("ss", ["-ltnpH", `sport = :${port}`]).catch(() => ({ stdout: "" }))).stdout;
  const m = /pid=(\d+)/.exec(out);
  return m ? Number(m[1]) : null;
}

export type RunningApp = { port: number; pid: number; log: string; stop: () => Promise<void> };

export async function stopPort(port: number): Promise<void> {
  const pid = await listeningPid(port);
  if (!pid) return;
  try { process.kill(pid, "SIGTERM"); } catch { /* already gone */ }
  for (let i = 0; i < 50 && (await listeningPid(port)) === pid; i++) await sleep(200);
  if ((await listeningPid(port)) === pid) { try { process.kill(pid, "SIGKILL"); } catch { /* gone */ } await sleep(500); }
}

export async function startApp(o: { slot: number; database: string; bootTimeoutMs?: number }): Promise<RunningApp> {
  const port = SLOT_PORT(o.slot), dir = slotDir(o.slot);
  const busy = await listeningPid(port);
  if (busy) throw new Error(`port ${port} is already in use by pid ${busy} — slot ${o.slot} is taken (or a producer died: kill that pid)`);
  const log = path.join(dir, "app.log");
  // Built from nothing: only what a recording needs. No key of any outside service is passed on.
  const env: NodeJS.ProcessEnv = {
    PATH: process.env.PATH, HOME: process.env.HOME, LANG: "C.UTF-8", TZ: "UTC",
    NODE_ENV: "development", PORT: String(port),
    DATABASE_URL: await databaseUrl(o.database),
    SESSION_SECRET: randomBytes(32).toString("hex"),
    DEV_AUTH_BYPASS_USER1: "true",
    SEO_JOBS_DISABLED: "true",
    EMAIL_FORCE_SINK: "1",
    SMS_OUTBOX_PATH: path.join(dir, "sms-outbox.jsonl"),
    VITE_CACHE_DIR: path.join(ROOT, ".cache", `vite-tut-slot${o.slot}`),
    TUTORIALS_LOCAL_DIR: path.join(ROOT, "tmp", "tutorials"),
    // The AI client is constructed at import; a placeholder keeps boot alive and can reach nothing.
    AI_INTEGRATIONS_OPENAI_API_KEY: "tutorial-recording-no-key", AI_INTEGRATIONS_OPENAI_BASE_URL: "http://127.0.0.1:9/v1",
  };
  const fd = fs.openSync(log, "w");
  // cwd stays the repo root (the app resolves client/ and reference data from it); the email outbox it
  // appends to (tmp/email-outbox.jsonl) is therefore shared by the slots — append-only, never sent.
  const child = spawn(path.join(ROOT, "node_modules/.bin/tsx"), [path.join(ROOT, "server/index.ts")], { cwd: ROOT, env, detached: true, stdio: ["ignore", fd, fd] });
  child.unref();
  fs.closeSync(fd);
  let exited: number | null = null;
  child.on("exit", (c) => { exited = c ?? 1; });
  const deadline = Date.now() + (o.bootTimeoutMs ?? 240_000);
  for (;;) {
    if (exited !== null) throw new Error(`the app for slot ${o.slot} exited (${exited}) while starting — see ${log}\n${fs.readFileSync(log, "utf8").slice(-1500)}`);
    const ok = await fetch(`http://127.0.0.1:${port}/api/auth/me`, { signal: AbortSignal.timeout(4000) }).then((r) => r.status < 500, () => false);
    if (ok) break;
    if (Date.now() > deadline) { await stopPort(port); try { process.kill(-child.pid!, "SIGKILL"); } catch { /* gone */ } throw new Error(`the app for slot ${o.slot} did not answer on :${port} in time — see ${log}`); }
    await sleep(1000);
  }
  const pid = (await listeningPid(port))!;
  return { port, pid, log, stop: async () => { await stopPort(port); try { process.kill(-child.pid!, "SIGTERM"); } catch { /* the wrapper left with its child */ } } };
}

/**
 * For operating a flow by hand before writing its script:
 *   tsx scripts/tutorials/app.ts up <slot>     fresh database + app; prints where to browse
 *   tsx scripts/tutorials/app.ts down <slot>   stop the app (by its listening pid) and drop the database
 */
async function main() {
  const [cmd, n] = process.argv.slice(2);
  const slot = Number(n);
  if (!["up", "down"].includes(cmd ?? "") || !Number.isInteger(slot) || slot < 1 || slot > 4) throw new Error("Usage: tsx scripts/tutorials/app.ts <up|down> <slot 1-4>");
  const { fresh, drop } = await import("./db");
  const database = `constructhub_tut_slot${slot}`;
  if (cmd === "down") { await stopPort(SLOT_PORT(slot)); await drop(database); console.log(`slot ${slot}: stopped and dropped`); return; }
  await fresh(database);
  const app = await startApp({ slot, database });
  console.log(`slot ${slot}: http://portal.constructhub.us:${app.port}/crm  (Chromium: --host-resolver-rules="MAP portal.constructhub.us 127.0.0.1") · pid ${app.pid} · log ${app.log}`);
}
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) main().then(() => process.exit(0), (e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
