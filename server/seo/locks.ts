/**
 * One-at-a-time sections that hold across server processes.
 *
 * The SEO routes keep some work to one request at a time per key: an identical purchase already in flight is shared
 * rather than bought twice (`once`, and `buyOnce` on top of it), and requests that count a plan limit and then insert
 * run one after another (`serial`). That state used to live in in-process Maps alone, so two server processes — or
 * the old and the new one overlapping during a deploy restart — could both buy the same data, or both pass a limit's
 * count. The Maps stay (one process still funnels to one waiter per key, and in-process waiters share the result),
 * AND the section holds a Postgres advisory lock on the key, so a request in another process waits for it too — and
 * a purchase, once it has the lock, reads the saved copy again before buying.
 *
 * How the lock is held, and why this way:
 *   - A transaction-scoped lock (pg_advisory_xact_lock) on a pooled connection of its own, in a transaction that does
 *     nothing but hold it. ROLLBACK in `finally` releases it, and a process that dies releases it by losing the
 *     connection. (A session lock on a pooled connection could outlive a section that failed to unlock.)
 *   - The wait is bounded by lock_timeout, set for that transaction alone: a holder stuck in a long call cannot hang
 *     every later request for the key. A wait that runs out is answered "busy, try again" (SeoRetryableError
 *     "seo_busy", a 503 through server/seo/public-errors.ts), never a generic 500. Polling pg_try_advisory_lock would
 *     do the same with more round trips and no order; with lock_timeout Postgres queues the waiters and grants in turn.
 *   - A section holds its connection for as long as it runs, so sections may hold at most half the pool at once
 *     (`slots`): the sections' own queries, and everything else, always have connections left. (Otherwise holders
 *     waiting for the pool, while the pool waits for the holders, would stop the process.) Waiting for a slot, for a
 *     connection and for the lock all count against one deadline, LOCK_WAIT_MS from the start.
 *   - A section inside a locked section of the same request (serial → buyOnce) takes its lock in the outer transaction,
 *     in a savepoint, rather than on a second connection: no second slot, and a timed-out inner lock leaves the outer
 *     one held. That lock is then released with the outer one, a moment later than the inner section ends.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";
import { pool } from "../db";
import { SeoRetryableError } from "./public-errors";

/**
 * How long a request may wait for a section, in all. Longer than one call to the data source (dataforseo.ts
 * REQUEST_TIMEOUT_MS, 60s), so a request that queued as a purchase began still gets the saved copy; well under the
 * 100 seconds the Cloudflare edge gives the origin to answer, so the customer reads "try again", not a dropped page.
 */
export const LOCK_WAIT_MS = 75_000;

/**
 * The lock number for a key — the same in every process: the first 8 bytes of a SHA-256 of the key, as the signed
 * bigint pg_advisory_xact_lock(bigint) takes (sent as text: it does not fit a JS number). Two keys with one number
 * would only wait for each other, never do the wrong thing. The bigint form is its own key space in Postgres, apart
 * from the (int, int) locks the rest of the platform takes (server/entitlements.ts, server/social/*).
 */
export function lockKey(key: string): string {
  return createHash("sha256").update("constructhub-seo\n").update(key).digest().readBigInt64BE(0).toString();
}

/** What a lock needs of a connection: the pool's PoolClient, or a stand-in in a test. */
export type LockClient = { query: (sql: string, params?: unknown[]) => Promise<unknown>; release: (err?: Error) => void };
export type WithLock = <T>(key: string, run: () => Promise<T>) => Promise<T>;
export type SeoLocks = { withLock: WithLock; /** Sections holding a connection right now (the slots in use). */ holding: () => number };

/**
 * Locks for one process. `connect` hands out a pooled connection; `slots` is how many sections may hold one at once;
 * `waitMs` is the deadline (LOCK_WAIT_MS). A real-Postgres check builds one per pool to stand in for two processes.
 */
export function createSeoLocks(opts: { connect: () => Promise<LockClient>; slots?: number; waitMs?: number }): SeoLocks {
  const slots = Math.max(1, opts.slots ?? 1), waitMs = opts.waitMs ?? LOCK_WAIT_MS;
  type Held = { client: LockClient; deadline: number; /** false once the section ended: work it started that outlives it takes its own lock. */ live: boolean };
  const current = new AsyncLocalStorage<Held>();
  const busy = () => new SeoRetryableError("seo_busy");

  // Slots: a short in-process queue in front of the pool, in arrival order, each waiter giving up at the deadline.
  let holding = 0;
  const waiters: { wake: () => void; timer: NodeJS.Timeout }[] = [];
  const takeSlot = (deadline: number) => new Promise<void>((resolve, reject) => {
    if (holding < slots) { holding++; return resolve(); }
    const w = {
      wake: () => { clearTimeout(w.timer); holding++; resolve(); },
      timer: setTimeout(() => { const i = waiters.indexOf(w); if (i >= 0) waiters.splice(i, 1); reject(busy()); }, Math.max(0, deadline - Date.now())),
    };
    waiters.push(w);
  });
  const freeSlot = () => { holding--; waiters.shift()?.wake(); };

  // The pool's own queue has no limit: past the deadline the request is told busy, and a connection arriving later goes straight back.
  const connectBy = (deadline: number) => new Promise<LockClient>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => { settled = true; reject(busy()); }, Math.max(0, deadline - Date.now()));
    opts.connect().then(
      (c) => { if (settled) c.release(); else { settled = true; clearTimeout(timer); resolve(c); } },
      (e) => { if (!settled) { settled = true; clearTimeout(timer); reject(e); } });
  });

  /** Take the key's lock in the client's open transaction, waiting until the deadline at most. */
  const lock = async (client: LockClient, key: string, deadline: number) => {
    // lock_timeout 0 means no limit, so a deadline already passed still waits 1ms (an uncontended lock is granted at once).
    await client.query("SELECT set_config('lock_timeout', $1, true)", [`${Math.max(1, deadline - Date.now())}ms`]);
    try { await client.query("SELECT pg_advisory_xact_lock($1::bigint)", [lockKey(key)]); }
    // 55P03: the wait ran out. 40P01: two processes each held one key and waited for the other's (a section inside a
    // section, in opposite orders) — Postgres cancels one of them; that one is told "busy, try again" too.
    catch (e) { const code = (e as { code?: unknown } | null)?.code; if (code === "55P03" || code === "40P01") throw busy(); throw e; }
  };

  const withLock: WithLock = async (key, run) => {
    const outer = current.getStore();
    if (outer?.live) {
      await outer.client.query("SAVEPOINT seo_lock");
      try { await lock(outer.client, key, outer.deadline); }
      catch (e) { await outer.client.query("ROLLBACK TO SAVEPOINT seo_lock").catch(() => {}); throw e; }
      return run();
    }
    const deadline = Date.now() + waitMs;
    await takeSlot(deadline);
    let client: LockClient;
    try { client = await connectBy(deadline); } catch (e) { freeSlot(); throw e; }
    const held: Held = { client, deadline, live: true };
    try {
      await client.query("BEGIN");
      await lock(client, key, deadline);
      return await current.run(held, run);
    } finally {
      held.live = false;
      // Ending the transaction releases the lock. A connection that cannot even roll back is handed back as broken, so
      // the pool drops it rather than reuse it with the lock still held.
      try { await client.query("ROLLBACK"); client.release(); }
      catch (e) { client.release(e instanceof Error ? e : new Error(String(e))); }
      freeSlot();
    }
  };
  return { withLock, holding: () => holding };
}

/** This process's locks on the app's pool: half of it at most may be held by sections (pg's default pool is 10). */
const poolMax = (pool as unknown as { options?: { max?: number } }).options?.max ?? 10;
export const seoLocks = createSeoLocks({ connect: () => pool.connect(), slots: Math.max(1, Math.floor(poolMax / 2)) });

/**
 * The routes' one-at-a-time helpers, on a lock. `once`: an identical request already in flight is joined, in this
 * process through `inflight`, in another through the lock (the section itself then re-reads what was saved).
 * `serial`: requests for one key run one after another — in this process in arrival order, across processes in the
 * lock's order.
 */
export function requestQueues(withLock: WithLock) {
  const inflight = new Map<string, Promise<any>>();
  const once = <T>(key: string, run: () => Promise<T>): Promise<T> => {
    const running = inflight.get(key);
    if (running) return running;
    const p = withLock(key, run).finally(() => inflight.delete(key));
    inflight.set(key, p);
    return p;
  };
  const queues = new Map<string, Promise<unknown>>();
  const serial = <T>(key: string, run: () => Promise<T>): Promise<T> => {
    const next = (queues.get(key) ?? Promise.resolve()).catch(() => {}).then(() => withLock(key, run));
    const tail = next.catch(() => {}).finally(() => { if (queues.get(key) === tail) queues.delete(key); });
    queues.set(key, tail);
    return next;
  };
  return { inflight, once, serial };
}
