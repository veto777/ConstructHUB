/**
 * The billing copy of the one-at-a-time sections (server/billing/locks.ts) against a stand-in connection: what is
 * sent to Postgres, in what order, and what a request is told when it cannot have the lock. The real lock, against
 * a throwaway Postgres, is exercised by server/voice/subscription-lock.test.ts and server/voice/billing.test.ts.
 */
import { describe, expect, it } from "vitest";
import { createLocks, lockKey, callAssistantLockKey, type LockClient } from "./locks";
import { BillingBusyError } from "./locks";
import { BillingRequestError } from "./order";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const lockTimeout = () => Object.assign(new Error("canceling statement due to lock timeout"), { code: "55P03" });

/** A connection that answers every statement at once; `onLock` can make the lock wait or fail. */
function fakePool(onLock?: (key: string) => Promise<void>) {
  const log: string[] = [];
  let connects = 0;
  const connect = async (): Promise<LockClient> => {
    const n = ++connects;
    return {
      query: async (sql: string, params?: unknown[]) => {
        log.push(`${n}:${sql.replace(/\s+/g, " ").trim()}${params ? ` ${JSON.stringify(params)}` : ""}`);
        if (/pg_advisory_xact_lock/.test(sql) && onLock) await onLock(String(params?.[0]));
        return { rows: [] };
      },
      release: (err?: Error) => { log.push(`${n}:release${err ? ` (${err.message})` : ""}`); },
    };
  };
  return { log, connect, connects: () => connects };
}
const statements = (log: string[]) => log.map((l) => l.replace(/^\d+:/, "").replace(/ \[.*$/, ""));

describe("the lock number", () => {
  it("is the same for one key everywhere, differs between keys and fits pg's bigint", () => {
    expect(lockKey("keywords:1")).toBe(lockKey("keywords:1"));
    expect(lockKey("keywords:1")).not.toBe(lockKey("keywords:2"));
    expect(lockKey("keywords:1")).not.toBe(lockKey("once:keywords:1"));
    expect(callAssistantLockKey(42)).toBe("call-assistant:42");
    for (const k of ["keywords:1", "volumes:1:1", "x"]) {
      expect(lockKey(k)).toMatch(/^-?\d+$/);
      const n = BigInt(lockKey(k));
      expect(n >= -(2n ** 63n) && n < 2n ** 63n).toBe(true);
    }
  });
});

describe("a section", () => {
  it("holds its lock in a transaction of its own and ends it in finally — also when the section throws", async () => {
    const p = fakePool();
    const locks = createLocks({ connect: p.connect, slots: 2 });
    expect(await locks.withLock("k", async () => "done")).toBe("done");
    expect(statements(p.log)).toEqual(["BEGIN", "SELECT set_config('lock_timeout', $1, true)", "SELECT pg_advisory_xact_lock($1::bigint)", "ROLLBACK", "release"]);
    expect(p.log[2]).toContain(JSON.stringify([lockKey("k")]));
    p.log.length = 0;
    await expect(locks.withLock("k", async () => { throw new TypeError("inside"); })).rejects.toThrow("inside");
    expect(statements(p.log).slice(-2)).toEqual(["ROLLBACK", "release"]);
    expect(locks.holding()).toBe(0);
  });

  it("told to wait no longer by Postgres (lock_timeout): a retryable 503 'busy', the connection ended and handed back clean", async () => {
    const p = fakePool(async () => { throw lockTimeout(); });
    const locks = createLocks({ connect: p.connect, slots: 2, waitMs: 50 });
    const err = await locks.withLock("k", async () => "never").catch((e) => e);
    expect(err).toBeInstanceOf(BillingBusyError);
    expect(err).toBeInstanceOf(BillingRequestError);
    expect([err.status, err.code]).toEqual([503, "billing_busy"]);
    expect(statements(p.log).slice(-2)).toEqual(["ROLLBACK", "release"]);
    // The wait given to Postgres is the deadline, never 0 (which would mean "no limit").
    expect(p.log[1]).toMatch(/\["\d+ms"\]$/);
    expect(locks.holding()).toBe(0);
  });

  it("a deadlock Postgres broke (two processes, two keys, opposite orders): the cancelled side is told busy, like a timeout", async () => {
    const p = fakePool(async () => { throw Object.assign(new Error("deadlock detected"), { code: "40P01" }); });
    const locks = createLocks({ connect: p.connect, slots: 2, waitMs: 50 });
    const err = await locks.withLock("k", async () => "never").catch((e) => e);
    expect([err instanceof BillingBusyError, err.code]).toEqual([true, "billing_busy"]);
    expect(statements(p.log).slice(-2)).toEqual(["ROLLBACK", "release"]);
    expect(locks.holding()).toBe(0);
  });
  it("another error from the lock statement is not dressed up as busy; a connection that cannot roll back is handed back as broken", async () => {
    const p = fakePool(async () => { throw Object.assign(new Error("terminating connection"), { code: "57P01" }); });
    const locks = createLocks({ connect: p.connect, slots: 2 });
    await expect(locks.withLock("k", async () => 1)).rejects.toThrow("terminating connection");
    const broken = fakePool();
    const locks2 = createLocks({ connect: async () => { const c = await broken.connect(); return { ...c, query: async (sql: string) => { if (/ROLLBACK/.test(sql)) throw new Error("connection lost"); return { rows: [] }; } }; }, slots: 2 });
    await expect(locks2.withLock("k", async () => 1)).resolves.toBe(1);
    expect(broken.log.at(-1)).toBe("1:release (connection lost)");
  });

  it("slots: at most that many sections hold a connection; the next waits in order, and gives up at the deadline", async () => {
    const p = fakePool();
    const locks = createLocks({ connect: p.connect, slots: 2, waitMs: 80 });
    const gates: (() => void)[] = [];
    const hold = (key: string) => locks.withLock(key, () => new Promise<string>((r) => gates.push(() => r(key))));
    const a = hold("a"), b = hold("b");
    await sleep(5);
    expect(locks.holding()).toBe(2);
    expect(p.connects()).toBe(2);
    const third = await locks.withLock("c", async () => "c").catch((e) => e);
    expect(third).toBeInstanceOf(BillingBusyError);
    expect(p.connects(), "no connection was taken for the section that never got a slot").toBe(2);
    const fourth = locks.withLock("d", async () => "d");
    await sleep(5);
    gates[0]();
    expect(await a).toBe("a");
    expect(await fourth, "the freed slot goes to the next waiter").toBe("d");
    gates[1]();
    expect(await b).toBe("b");
    expect(locks.holding()).toBe(0);
  });

  it("a connection that does not come by the deadline: busy, and the late connection goes straight back", async () => {
    let give: ((c: LockClient) => void) | null = null;
    const released: string[] = [];
    const locks = createLocks({ connect: () => new Promise<LockClient>((r) => { give = r; }), slots: 2, waitMs: 30 });
    const err = await locks.withLock("k", async () => 1).catch((e) => e);
    expect(err).toBeInstanceOf(BillingBusyError);
    expect(locks.holding()).toBe(0);
    give!({ query: async () => ({ rows: [] }), release: () => { released.push("late"); } });
    await sleep(1);
    expect(released).toEqual(["late"]);
  });

  it("a section inside a locked section takes its lock in the same transaction (a savepoint), on no second connection", async () => {
    const p = fakePool();
    const locks = createLocks({ connect: p.connect, slots: 1 });
    const out = await locks.withLock("outer", () => locks.withLock("inner", async () => "both"));
    expect(out).toBe("both");
    expect(p.connects()).toBe(1);
    expect(statements(p.log)).toEqual([
      "BEGIN", "SELECT set_config('lock_timeout', $1, true)", "SELECT pg_advisory_xact_lock($1::bigint)",
      "SAVEPOINT billing_lock", "SELECT set_config('lock_timeout', $1, true)", "SELECT pg_advisory_xact_lock($1::bigint)",
      "ROLLBACK", "release",
    ]);
    expect(p.log[5]).toContain(JSON.stringify([lockKey("inner")]));
  });

  it("an inner lock that times out is rolled back to its savepoint; the outer section ends as any other", async () => {
    const p = fakePool(async (key) => { if (key === lockKey("inner")) throw lockTimeout(); });
    const locks = createLocks({ connect: p.connect, slots: 1, waitMs: 50 });
    const seen: string[] = [];
    const err = await locks.withLock("outer", async () => {
      const e = await locks.withLock("inner", async () => "no").catch((x) => x);
      seen.push(e?.code);
      throw e;
    }).catch((e) => e);
    expect(seen).toEqual(["billing_busy"]);
    expect(err).toBeInstanceOf(BillingBusyError);
    expect(statements(p.log).slice(3)).toEqual(["SAVEPOINT billing_lock", "SELECT set_config('lock_timeout', $1, true)", "SELECT pg_advisory_xact_lock($1::bigint)", "ROLLBACK TO SAVEPOINT billing_lock", "ROLLBACK", "release"]);
  });

  it("work a section started that runs on after it (a scan in the background) takes a lock of its own", async () => {
    const p = fakePool();
    const locks = createLocks({ connect: p.connect, slots: 2 });
    let later: Promise<string> | null = null;
    await locks.withLock("outer", async () => { later = sleep(5).then(() => locks.withLock("inner", async () => "own")); });
    expect(await later!).toBe("own");
    expect(p.connects()).toBe(2);
    expect(statements(p.log).filter((s) => s === "BEGIN")).toHaveLength(2);
  });
});
