/**
 * One app per recording slot — a dev server on port 8180+slot against that slot's recording
 * database, with every outbound channel shut:
 *
 *   · NODE_ENV=development + EMAIL_FORCE_SINK=1 and no SMTP_* in its environment → every email is
 *     appended to tmp/email-outbox.jsonl, never sent (server/email.ts `sinkToOutbox`);
 *   · no SIGNALWIRE_* → every text goes to the log provider, SMS_OUTBOX_PATH in the slot dir
 *     (server/crm/sms.ts);
 *   · no Stripe, Google, HOVER, OpenAI, R2 or voice-engine credentials at all: the environment is
 *     built from nothing (below), not inherited — a producer's shell cannot leak a key into it.
 *     Pages that need a connected account get a local stand-in instead (TUTORIAL_FIXTURES, below);
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
/** Recording slots are 1–8 (ports 8181–8188). Slot 0 is the template build's own boot. */
export const SLOT_MAX = 8;
export const isSlot = (slot: number) => Number.isInteger(slot) && slot >= 1 && slot <= SLOT_MAX;
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

/**
 * Compile the client before the camera rolls. The dev server (Vite) transforms a page's code the first
 * time a browser asks for it; cold, that is seconds of blank page after a click — on camera. Asking
 * for every page module once makes Vite transform it and what it imports, so the recording sees warm
 * pages. Read-only: these are GETs of source modules, nothing in the workspace is touched.
 */
export async function warmApp(port: number): Promise<number> {
  const pages: string[] = [];
  const walk = (dir: string) => { for (const d of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, d.name); if (d.isDirectory()) walk(p); else if (/\.tsx?$/.test(d.name) && !/\.test\./.test(d.name)) pages.push(p); } };
  walk(path.join(ROOT, "client/src/pages"));
  const urls = ["/crm", "/src/main.tsx", "/src/App.tsx", ...pages.map((p) => `/src/${path.relative(path.join(ROOT, "client/src"), p).split(path.sep).join("/")}`)];
  let ok = 0, next = 0;
  const worker = async () => {
    while (next < urls.length) {
      const url = urls[next++];
      const good = await fetch(`http://127.0.0.1:${port}${url}`, { signal: AbortSignal.timeout(120_000) }).then(async (r) => { await r.arrayBuffer(); return r.ok; }, () => false);
      if (good) ok++;
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
  // The transforms of what those modules import finish a moment after the responses.
  await sleep(3000);
  return ok;
}

/**
 * `fixtures` (default: on for slots 1–8, off for the template's slot 0) starts the app with the
 * tutorial fixtures: stand-ins for Stripe, HOVER, Google Calendar and texting, so their pages show
 * a connected account (docs/tutorials/FIXTURES.md). The two variables below are all it takes — and
 * the app REFUSES TO BOOT with them unless it is a non-production process on this slot's port
 * against a recording database (server/tutorials/fixtures/gate.ts). No key of any real service is
 * involved: the stand-ins answer on this machine.
 */
export async function startApp(o: { slot: number; database: string; bootTimeoutMs?: number; fixtures?: boolean }): Promise<RunningApp> {
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
  const fixtures = o.fixtures ?? isSlot(o.slot);
  if (fixtures) { env.TUTORIAL_FIXTURES = "1"; env.TUTORIAL_SLOT = String(o.slot); }
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
  if (fixtures) {
    // The stand-ins' boot hooks (HOVER's connection and first sync) run on this call; a slot that
    // was asked for fixtures and does not have them must not be recorded.
    const ready = await fetch(`http://127.0.0.1:${port}/__tutorial/ready`, { signal: AbortSignal.timeout(120_000) }).then(async (r) => ({ status: r.status, body: await r.text() }), (e) => ({ status: 0, body: String(e) }));
    if (ready.status !== 200) { await stopPort(port); throw new Error(`the tutorial fixtures of slot ${o.slot} are not ready (${ready.status}): ${ready.body.slice(0, 300)} — see ${log}`); }
  }
  const pid = (await listeningPid(port))!;
  return { port, pid, log, stop: async () => { await stopPort(port); try { process.kill(-child.pid!, "SIGTERM"); } catch { /* the wrapper left with its child */ } } };
}

/**
 * For operating a flow by hand before writing its script:
 *   tsx scripts/tutorials/app.ts up <slot> [--no-fixtures] [--no-warm]   fresh database + app; prints where to browse
 *   tsx scripts/tutorials/app.ts down <slot>   stop the app (by its listening pid) and drop the database
 */
async function main() {
  const [cmd, n] = process.argv.slice(2);
  const slot = Number(n);
  if (!["up", "down"].includes(cmd ?? "") || !isSlot(slot)) throw new Error(`Usage: tsx scripts/tutorials/app.ts <up|down> <slot 1-${SLOT_MAX}> [--no-fixtures] [--no-warm]`);
  const noFixtures = process.argv.includes("--no-fixtures");
  const { fresh, drop, seedDemo, seedFixtures } = await import("./db");
  const database = `constructhub_tut_slot${slot}`;
  if (cmd === "down") { await stopPort(SLOT_PORT(slot)); await drop(database); console.log(`slot ${slot}: stopped and dropped`); return; }
  await fresh(database);
  // The same two seeds produce.ts runs: today's dates, then (unless --no-fixtures) the connected-account rows.
  await seedDemo(database);
  if (!noFixtures) await seedFixtures(database);
  const app = await startApp({ slot, database, fixtures: !noFixtures });
  // --no-warm: for dry runs only (pages compile on first use, which a dry run does not mind).
  if (!process.argv.includes("--no-warm")) await warmApp(app.port);
  console.log(`slot ${slot}: http://portal.constructhub.us:${app.port}/crm  (Chromium: --host-resolver-rules="MAP portal.constructhub.us 127.0.0.1") · pid ${app.pid} · log ${app.log}`);
}
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) main().then(() => process.exit(0), (e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
