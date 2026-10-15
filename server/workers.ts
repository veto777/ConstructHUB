/**
 * The worker registry (reliability, 2026-10-15).
 *
 * Every background worker the process starts at boot — the 1 s queue tickers (ads, edge search, domains, competitors,
 * site scans), the minute sweeps (GBP, agency, mail, LSA, voice) and the daily jobs (account erase, backups, billing
 * sync) — registers its timer here. Shutdown (server/shutdown.ts) calls `stopWorkers()` right after the listener
 * closes and BEFORE the Postgres pool ends, so no tick starts on a pool that is going away.
 *
 * Why: on every deploy the journal filled with "Competitor worker tick failed", "[ads] worker tick failed",
 * "[edge-search] worker failed" and "[issues] could not record … Cannot use a pool after calling end on the pool".
 * `pool.end()` waits for checked-out clients, and during that wait the 1 s workers kept ticking into the ended pool —
 * and the issue desk tried to record each failure through the same dead pool.
 *
 * Two ways in:
 *   - `workerInterval(name, tick, everyMs, opts)` — the common case: a guarded setInterval (a tick never overlaps the
 *     previous one; an optional first run after `firstAfterMs`). `stop()` clears the timers and returns the tick in
 *     flight, if any, so shutdown can wait for it (bounded).
 *   - `registerWorker(name, stop, inflight?)` — for a worker that owns its own timer: `stop` clears it; `inflight`
 *     (optional) returns the promise of the tick running right now, or null.
 *
 * Stop order is registration order (boot order). A worker registered after `stopWorkers()` ran is stopped at once.
 */

export type WorkerHandle = {
  readonly name: string;
  /** The interval timer (null once stopped). */
  readonly timer: NodeJS.Timeout | null;
  /** True once stopped: no tick starts again. */
  readonly stopped: boolean;
  /** Clears the timers; resolves when the tick in flight (if any) has ended. Idempotent. */
  stop: () => Promise<void>;
};

type Entry = { name: string; stop: () => unknown; inflight: () => Promise<unknown> | null };

const entries: Entry[] = [];
let stopping = false;

/** True once shutdown asked the workers to stop (a tick that still runs should not start new work). */
export const workersStopping = (): boolean => stopping;
/** Names of the registered workers, in boot order (the admin page and tests). */
export const registeredWorkers = (): string[] => entries.map((e) => e.name);

/**
 * Register a worker that owns its own timer. Returns the unregister. Stop is called once, at shutdown, in registration
 * order; a worker registered after shutdown began is stopped immediately.
 */
export function registerWorker(name: string, stop: () => unknown, inflight?: () => Promise<unknown> | null): () => void {
  const entry: Entry = { name, stop, inflight: inflight ?? (() => null) };
  if (stopping) { try { void stop(); } catch { /* already stopping */ } return () => {}; }
  entries.push(entry);
  return () => { const i = entries.indexOf(entry); if (i >= 0) entries.splice(i, 1); };
}

export type WorkerIntervalOptions = {
  /** Also run once after this many ms (a worker's "first run" setTimeout); cleared by stop. */
  firstAfterMs?: number;
  /** unref the timers so they never keep the process alive (default true, as every worker did before). */
  unref?: boolean;
  /** Called when a tick throws or rejects. Default: one console.error line (the tick's own catch usually handles it). */
  onError?: (e: unknown) => void;
};

/**
 * A guarded periodic worker: `tick` runs every `everyMs` (and once after `firstAfterMs` when given), never while a
 * previous run is still in flight, and never again once stopped. Registered for shutdown under `name`.
 */
export function workerInterval(name: string, tick: () => unknown, everyMs: number, opts: WorkerIntervalOptions = {}): WorkerHandle {
  let running: Promise<unknown> | null = null;
  let stopped = false;
  let timer: NodeJS.Timeout | null = null;
  let first: NodeJS.Timeout | null = null;
  let unregister: () => void = () => {};
  const onError = opts.onError ?? ((e: unknown) => console.error(`[workers] ${name} tick failed: ${(e as Error)?.message ?? e}`));

  const run = () => {
    if (stopped || running) return;
    let p: Promise<unknown>;
    try { p = Promise.resolve(tick()); } catch (e) { onError(e); return; }
    running = p.then(() => undefined, (e) => { try { onError(e); } catch { /* nothing */ } }).finally(() => { running = null; });
  };
  const stop = async () => {
    if (!stopped) {
      stopped = true;
      if (timer) clearInterval(timer);
      if (first) clearTimeout(first);
      timer = null; first = null;
      unregister();
    }
    if (running) await running;
  };
  unregister = registerWorker(name, stop, () => running); // stops at once when shutdown already began
  if (!stopped) {
    timer = setInterval(run, everyMs);
    if (opts.unref !== false) timer.unref?.();
    if (opts.firstAfterMs != null) {
      first = setTimeout(run, opts.firstAfterMs);
      if (opts.unref !== false) first.unref?.();
    }
  }
  return {
    name,
    get timer() { return timer; },
    get stopped() { return stopped; },
    stop,
  };
}

export type StopWorkersResult = {
  /** Names stopped, in order. */
  stopped: string[];
  /** Names whose tick was still in flight when the wait ended. */
  unfinished: string[];
  /** Names whose stop() threw. */
  failed: string[];
  waitedMs: number;
};

/**
 * Shutdown: stop every registered worker in registration order (each stop bounded to `stopMs`), then wait up to
 * `waitMs` for the ticks in flight. Logs one line. Safe to call twice (the second call stops nothing).
 */
export async function stopWorkers(opts: { log?: (line: string) => void; waitMs?: number; stopMs?: number; now?: () => number } = {}): Promise<StopWorkersResult> {
  const log = opts.log ?? ((l: string) => console.log(l));
  const now = opts.now ?? Date.now;
  const waitMs = opts.waitMs ?? 5_000;
  const stopMs = opts.stopMs ?? 1_000;
  stopping = true;
  const started = now();
  const list = entries.splice(0, entries.length);
  const stopped: string[] = []; const failed: string[] = []; const inflight: { name: string; p: Promise<unknown> }[] = [];
  for (const e of list) {
    try {
      const p = e.inflight();
      if (p) inflight.push({ name: e.name, p: p.then(() => undefined, () => undefined) });
      const r = await Promise.race([Promise.resolve().then(e.stop).then(() => "ok" as const), sleep(stopMs).then(() => "timeout" as const)]);
      if (r === "timeout") log(`[shutdown] worker "${e.name}" stop() did not return in ${stopMs}ms`);
      stopped.push(e.name);
    } catch (err: any) {
      failed.push(e.name);
      log(`[shutdown] worker "${e.name}" stop failed: ${err?.message ?? err}`);
    }
  }
  // The ticks in flight: a 1 s queue worker is usually mid-query; give them a bounded moment before the pool ends.
  const pending = new Set(inflight.map((i) => i.name));
  if (pending.size) {
    const deadline = started + waitMs;
    await Promise.race([
      Promise.all(inflight.map((i) => i.p.then(() => { pending.delete(i.name); }))),
      sleep(Math.max(0, deadline - now())),
    ]);
  }
  const unfinished = [...pending];
  const waitedMs = now() - started;
  log(`[shutdown] workers: ${stopped.length} stopped in ${waitedMs}ms${failed.length ? `, ${failed.length} failed (${failed.join(", ")})` : ""}${unfinished.length ? `; still running: ${unfinished.join(", ")}` : ""}`);
  return { stopped, unfinished, failed, waitedMs };
}

const sleep = (ms: number) => new Promise<void>((r) => { const t = setTimeout(r, ms); t.unref?.(); });

/** Test seam: forget every registration and the stopping flag. */
export function resetWorkersForTests(): void {
  entries.length = 0; stopping = false;
}
