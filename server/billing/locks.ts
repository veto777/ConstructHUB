/**
 * One-at-a-time sections that hold across server processes — the billing copy of server/seo/locks.ts
 * (the same mechanics, lifted so billing code does not import the SEO lane; its own key space and its
 * own "busy" error).
 *
 * Everything that reads and then writes one account's Call Assistant subscription or overage runs in
 * `withCallAssistantLock(userId, …)`: the checkout route, the webhook handlers for that subscription,
 * the duplicate reconciliation, and every overage claim (monthly report, sweep, settle-on-end). An
 * in-process queue (server/billing/sync.ts withBillingLock) is not enough: a webhook and a route, or
 * two server processes during a deploy restart, could each read "no subscription" and both write.
 *
 * How the lock is held, and why this way:
 *   - A transaction-scoped lock (pg_advisory_xact_lock) on a pooled connection of its own, in a transaction that does
 *     nothing but hold it. ROLLBACK in `finally` releases it, and a process that dies releases it by losing the
 *     connection. (A session lock on a pooled connection could outlive a section that failed to unlock.)
 *   - The wait is bounded by lock_timeout, set for that transaction alone: a holder stuck in a long call cannot hang
 *     every later request for the key. A wait that runs out is answered "busy, try again" (BillingBusyError, a 503
 *     through sendStripeError; a webhook that hits it fails and Stripe retries), never a generic 500. Polling pg_try_advisory_lock would
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
import { BillingRequestError } from "./order";

/** The wait for a section ran out (lock_timeout) or Postgres broke a deadlock: a 503 the route sends as "try again". */
export class BillingBusyError extends BillingRequestError {
  constructor() {
    super(503, "Billing is busy with another change to this account. Try again in a moment.", "billing_busy");
    this.name = "BillingBusyError";
  }
}

/**
 * How long a request may wait for a section, in all: a few Stripe calls' worth, well under the 100 seconds the
 * Cloudflare edge gives the origin to answer (the customer reads "try again", not a dropped page) and under Stripe's
 * own webhook timeout, so a webhook that waited this long is retried rather than lost.
 */
export const LOCK_WAIT_MS = 25_000;

/**
 * The lock number for a key — the same in every process: the first 8 bytes of a SHA-256 of the key, as the signed
 * bigint pg_advisory_xact_lock(bigint) takes (sent as text: it does not fit a JS number). Two keys with one number
 * would only wait for each other, never do the wrong thing. The bigint form is its own key space in Postgres, apart
 * from the (int, int) locks the rest of the platform takes (server/entitlements.ts, server/social/*).
 */
export function lockKey(key: string): string {
  return createHash("sha256").update("constructhub-billing\n").update(key).digest().readBigInt64BE(0).toString();
}

/** What a lock needs of a connection: the pool's PoolClient, or a stand-in in a test. */
export type LockClient = { query: (sql: string, params?: unknown[]) => Promise<unknown>; release: (err?: Error) => void };
export type WithLock = <T>(key: string, run: () => Promise<T>) => Promise<T>;
export type Locks = { withLock: WithLock; /** Sections holding a connection right now (the slots in use). */ holding: () => number };

/**
 * Locks for one process. `connect` hands out a pooled connection; `slots` is how many sections may hold one at once;
 * `waitMs` is the deadline (LOCK_WAIT_MS). A real-Postgres check builds one per pool to stand in for two processes.
 */
export function createLocks(opts: { connect: () => Promise<LockClient>; slots?: number; waitMs?: number }): Locks {
  const slots = Math.max(1, opts.slots ?? 1), waitMs = opts.waitMs ?? LOCK_WAIT_MS;
  type Held = { client: LockClient; deadline: number; /** false once the section ended: work it started that outlives it takes its own lock. */ live: boolean };
  const current = new AsyncLocalStorage<Held>();
  const busy = () => new BillingBusyError();

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
      await outer.client.query("SAVEPOINT billing_lock");
      try { await lock(outer.client, key, outer.deadline); }
      catch (e) { await outer.client.query("ROLLBACK TO SAVEPOINT billing_lock").catch(() => {}); throw e; }
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
export const billingLocks = createLocks({ connect: () => pool.connect(), slots: Math.max(1, Math.floor(poolMax / 2)) });

/** The key every section that touches one account's Call Assistant subscription or overage takes. */
export const callAssistantLockKey = (userId: number) => `call-assistant:${userId}`;
export const withCallAssistantLock = <T>(userId: number, run: () => Promise<T>): Promise<T> => billingLocks.withLock(callAssistantLockKey(userId), run);
