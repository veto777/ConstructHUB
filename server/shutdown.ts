/**
 * Graceful shutdown (reliability review H5, 2026-10-09).
 *
 * There was no SIGTERM handler: `systemctl restart` (49 deploys in 24 h) killed the process mid-request — the
 * tunnel answered 502, a paid SEO lookup in flight was lost (its reservation closed 30 minutes later by the
 * reconciler), manual grid scans ended as "interrupted".
 *
 * On SIGTERM / SIGINT the process now
 *   1. stops accepting: the listener closes, idle keep-alive connections are closed, new responses carry
 *      `Connection: close`, and `isShuttingDown()` is true (health answers 503 so a balancer would move on);
 *   2. runs the registered hooks (`onShutdown`: stop a worker's timer, flush a queue) — each bounded;
 *   3. waits for in-flight requests (`trackRequests` counts them) and tracked background work (`trackWork`: a paid
 *      lookup kicked off outside a request) to finish, up to SHUTDOWN_DRAIN_MS (default 20 s);
 *   4. closes whatever connections remain, closes the database pool(s), logs what was left behind, and exits 0 —
 *      a hard stop at drain + 10 s exits 1 so a stuck process never outlives systemd's TimeoutStopSec.
 * A second signal exits at once.
 *
 * What is NOT waited for: work that holds a database lease (rank runs, snapshots, grid watches) — those are taken
 * over by the next process when the lease lapses; and open SEO reservations past the drain are left to
 * reconcileReservations (customer charged nothing). The log line "left behind" counts both.
 */
import type { Server } from "node:http";
import type { RequestHandler } from "express";

type Hook = { name: string; run: () => unknown };
const hooks: Hook[] = [];
let shuttingDown = false;
let inflight = 0;
const work = new Map<Promise<unknown>, string>();

export const isShuttingDown = () => shuttingDown;
export const inflightCount = () => inflight;
export const trackedWorkCount = () => work.size;

/** Register something to do when the process is told to stop (a worker's timer to clear). Returns the unregister. */
export function onShutdown(name: string, run: () => unknown): () => void {
  const hook = { name, run };
  hooks.push(hook);
  return () => { const i = hooks.indexOf(hook); if (i >= 0) hooks.splice(i, 1); };
}

/** Count a fire-and-forget promise (a paid lookup started outside a request) so shutdown waits for it, bounded. */
export function trackWork<T>(label: string, p: Promise<T>): Promise<T> {
  work.set(p, label);
  p.then(() => work.delete(p), () => work.delete(p));
  return p;
}

/** Express middleware: counts in-flight requests and, once stopping, asks clients to close the connection. */
export const trackRequests: RequestHandler = (req, res, next) => {
  inflight++;
  let done = false;
  const finish = () => { if (!done) { done = true; inflight--; } };
  res.on("finish", finish);
  res.on("close", finish);
  if (shuttingDown) res.setHeader("Connection", "close");
  next();
};

const envMs = (name: string, fallback: number) => { const n = Number(process.env[name]); return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback; };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const bounded = <T>(p: Promise<T>, ms: number): Promise<T | "timeout"> => Promise.race([p, sleep(ms).then(() => "timeout" as const)]);

export type ShutdownOptions = {
  server: Server;
  /** Close the database pool(s); called after the drain. */
  closePools: () => Promise<unknown>;
  /** Longest wait for in-flight requests and tracked work (SHUTDOWN_DRAIN_MS, default 20 000). */
  drainMs?: number;
  log?: (line: string) => void;
  exit?: (code: number) => void;
  now?: () => number;
};

/**
 * The shutdown sequence, for a signal. Exported so a test can run it on a listening server without signals;
 * `installGracefulShutdown` wires it to SIGTERM/SIGINT.
 */
export async function shutdown(signal: string, opts: ShutdownOptions): Promise<void> {
  const log = opts.log ?? ((l: string) => console.log(l));
  const exit = opts.exit ?? ((code: number) => process.exit(code));
  const now = opts.now ?? Date.now;
  const drainMs = opts.drainMs ?? envMs("SHUTDOWN_DRAIN_MS", 20_000);
  if (shuttingDown) { log(`[shutdown] ${signal} again: exiting now`); exit(1); return; }
  shuttingDown = true;
  const started = now();
  log(`[shutdown] ${signal}: closing the listener; ${inflight} request(s) and ${work.size} background task(s) in flight; draining up to ${drainMs}ms`);
  // The hard stop: never outlive systemd's patience (TimeoutStopSec), whatever is stuck.
  const hardStop = setTimeout(() => { log(`[shutdown] hard stop after ${now() - started}ms: ${inflight} request(s), ${work.size} task(s) still open`); exit(1); }, drainMs + 10_000);
  hardStop.unref();

  // 1. Stop accepting. close() also closes idle keep-alive connections (Node ≥ 19); active ones finish their request.
  const closed = new Promise<void>((resolve) => opts.server.close(() => resolve()));
  // 2. Hooks (timers off, queues flushed), each bounded to 5 s.
  for (const h of [...hooks]) {
    try { const r = await bounded(Promise.resolve().then(h.run), 5_000); if (r === "timeout") log(`[shutdown] hook "${h.name}" did not finish in 5s`); }
    catch (e: any) { log(`[shutdown] hook "${h.name}" failed: ${e?.message ?? e}`); }
  }
  // 3. Drain.
  const deadline = started + drainMs;
  while ((inflight > 0 || work.size > 0) && now() < deadline) await sleep(50);
  const left = inflight + work.size;
  if (left) log(`[shutdown] drain ended after ${now() - started}ms with ${inflight} request(s) and ${work.size} task(s) left behind: ${[...work.values()].join(", ") || "requests only"}`);
  // 4. Cut what remains, close the pools, go.
  opts.server.closeAllConnections?.();
  await bounded(closed, 2_000);
  try { const r = await bounded(Promise.resolve(opts.closePools()), 5_000); if (r === "timeout") log("[shutdown] pool close did not finish in 5s"); }
  catch (e: any) { log(`[shutdown] pool close failed: ${e?.message ?? e}`); }
  clearTimeout(hardStop);
  log(`[shutdown] done in ${now() - started}ms${left ? ` (${left} left behind)` : ""}`);
  exit(0);
}

/** Wire SIGTERM and SIGINT to `shutdown`. */
export function installGracefulShutdown(opts: ShutdownOptions): void {
  for (const signal of ["SIGTERM", "SIGINT"] as const) {
    process.on(signal, () => { void shutdown(signal, opts); });
  }
}

/** Test seam: forget hooks, counters and the stopping flag. */
export function resetShutdownStateForTests(): void {
  hooks.length = 0; shuttingDown = false; inflight = 0; work.clear();
}
