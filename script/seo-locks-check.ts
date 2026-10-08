/**
 * Real-Postgres check of the SEO one-at-a-time sections across server processes (server/seo/locks.ts): two separate
 * pg Pools, each with its own locks and queues, stand in for two processes (the old and the new one during a deploy
 * restart). THROWAWAY database (users 1 and 2 must exist).
 *   DATABASE_URL=postgres://.../seotest npx tsx script/seo-locks-check.ts
 */
import pg from "pg";
import { pool } from "../server/db";
import { ensureSeoSchema } from "../server/seo/schema";
import { createSeoLocks, lockKey, requestQueues } from "../server/seo/locks";
import { cached, saveCached } from "../server/seo/reports";
import { seoErrorResponse, SeoRetryableError } from "../server/seo/public-errors";
let n = 0; const ok = (c: unknown, m: string) => { if (!c) { console.error("FAIL", m); process.exitCode = 1; } else { n++; console.log("PASS ", m); } };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
type Span = { name: string; enter: number; exit: number };
const overlap = (a: Span, b: Span) => a.enter < b.exit && b.enter < a.exit;
(async () => {
  await ensureSeoSchema();
  // Two "processes": each its own pool, locks and queues. (The app's own pool, `pool`, is the database they share.)
  const A = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 4 }), B = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 4 });
  const locksA = createSeoLocks({ connect: () => A.connect(), slots: 2 }), locksB = createSeoLocks({ connect: () => B.connect(), slots: 2 });
  const qa = requestQueues(locksA.withLock), qb = requestQueues(locksB.withLock);
  const spans: Span[] = [];
  const section = (name: string, ms: number) => async () => { const s: Span = { name, enter: Date.now(), exit: 0 }; spans.push(s); await sleep(ms); s.exit = Date.now(); return name; };
  // The key's lock as Postgres lists it (the bigint form: its high and low halves, objsubid 1).
  const heldInPg = async (key: string) => (await pool.query(
    "SELECT count(*)::int AS n FROM pg_locks WHERE locktype='advisory' AND objsubid=1 AND granted AND classid=(($1::bigint >> 32) & 4294967295)::bigint::oid AND objid=($1::bigint & 4294967295)::bigint::oid", [lockKey(key)])).rows[0].n as number;

  // 1. Two serial sections for one key, one per process, never overlap — nor do three (two in A, one in B).
  await Promise.all([qa.serial("k", section("A1", 250)), sleep(30).then(() => qb.serial("k", section("B1", 250))), sleep(60).then(() => qa.serial("k", section("A2", 100)))]);
  const same = spans.splice(0);
  ok(same.length === 3 && same.every((s) => s.exit > s.enter) && !overlap(same[0], same[1]) && !overlap(same[1], same[2]) && !overlap(same[0], same[2]),
    `serial sections for one key from two processes never overlap: ${same.map((s) => `${s.name} ${s.enter % 100000}-${s.exit % 100000}`).join(", ")}`);
  ok(same.map((s) => s.name).join() === "A1,B1,A2" && same[1].enter >= same[0].exit, "the one that arrived while the first held the key waited for it");

  // 2. Different keys do not block each other: B's short section ends while A's long one is still running.
  await Promise.all([qa.serial("k1", section("A-long", 400)), sleep(30).then(() => qb.serial("k2", section("B-short", 50)))]);
  const diff = spans.splice(0);
  ok(diff.length === 2 && overlap(diff[0], diff[1]) && diff[1].exit < diff[0].exit, `different keys run side by side: ${diff.map((s) => `${s.name} ${s.enter % 100000}-${s.exit % 100000}`).join(", ")}`);

  // 3. buyOnce-style (as server/seo/routes.ts buyOnce does it): the saved copy is read again under the lock, so the
  // second process's caller buys nothing; a joiner in the same process shares the result and is reported `reused`.
  await pool.query("DELETE FROM seo_report_cache WHERE kind='locks-check'");
  const key = `locks-check:${Date.now()}`;
  let fetches = 0;
  const buy = async (q: typeof qa, who: string) => {
    const flight = `buy:1:${key}`;
    const waiting = q.inflight.has(flight);
    const out = await q.once(flight, async () => {
      const again = await cached<{ by: string }>(1, key, 1);
      if (again) return { data: again, bought: false };
      fetches++;
      await sleep(300);   // the purchase takes a while: the other process's request arrives meanwhile
      const data = { by: who };
      await saveCached(1, key, "locks-check", data, 0);
      return { data, bought: true };
    });
    return { data: out.data, reused: waiting || !out.bought };
  };
  const [first, second, third] = await Promise.all([buy(qa, "A"), sleep(50).then(() => buy(qb, "B")), sleep(60).then(() => buy(qa, "A-again"))]);
  ok(fetches === 1 && !first.reused && second.reused && second.data.by === "A", `the second process's caller waited for the lock and found the saved copy — one fetch, not two: fetches=${fetches}, B got ${JSON.stringify(second)}`);
  ok(third.reused && third.data.by === "A", `a second request in the first process joined the one in flight: ${JSON.stringify(third)}`);
  ok((await buy(qb, "B-later")).reused && fetches === 1, "a request after the purchase finished reads the saved copy");
  await pool.query("DELETE FROM seo_report_cache WHERE kind='locks-check'");

  // 4. The lock is the key's advisory lock in Postgres, held for the section and gone afterwards — also after a throw.
  let during = -1;
  await locksA.withLock("seen", async () => { during = await heldInPg("seen"); });
  ok(during === 1 && (await heldInPg("seen")) === 0, `the section holds the key's advisory lock (${during} during, ${await heldInPg("seen")} after)`);
  await locksA.withLock("thrown", async () => { throw new Error("section failed"); }).catch(() => {});
  ok((await heldInPg("thrown")) === 0 && locksA.holding() === 0 && A.idleCount === A.totalCount, "a section that threw released its lock and its connection");

  // 5. A wait that runs out is told "busy" (a retryable 503), the connection is clean after, and the key is free once the holder ends.
  const quickB = createSeoLocks({ connect: () => B.connect(), slots: 2, waitMs: 300 });
  let release!: () => void;
  const holder = locksA.withLock("slow", () => new Promise<void>((r) => { release = r; }));
  await sleep(30);
  const t0 = Date.now();
  const err = await quickB.withLock("slow", async () => "never").catch((e) => e);
  const waited = Date.now() - t0;
  ok(err instanceof SeoRetryableError && err.code === "seo_busy" && waited >= 250 && waited < 2000, `a waiter past its deadline is told busy after ~300ms (waited ${waited}ms): ${err?.message}`);
  const out = seoErrorResponse(err);
  ok(out.status === 503 && out.unexpected === false && out.body.code === "seo_busy" && out.body.retryable === true && typeof out.body.message === "string", `…which a route answers 503 with its own copy: ${JSON.stringify(out.body)}`);
  ok(quickB.holding() === 0 && (await heldInPg("slow")) === 1, "the holder still holds the key; the waiter holds nothing");
  release!(); await holder;
  ok((await quickB.withLock("slow", async () => "mine")) === "mine" && (await heldInPg("slow")) === 0, "once the holder ends, the same waiter's pool takes the key at once (its connection was left usable)");

  // 6. A section inside a locked section (serial → buyOnce) takes its lock in the same transaction: one connection, both keys held.
  const before = A.totalCount;
  let both = -1;
  await locksA.withLock("outer", () => locksA.withLock("inner", async () => { both = (await heldInPg("outer")) + (await heldInPg("inner")); }));
  ok(both === 2 && A.totalCount === before && (await heldInPg("outer")) + (await heldInPg("inner")) === 0, `nested: both keys held on one connection, both released after (${both} held during, ${A.totalCount - before} connections added)`);
  // …and an inner lock held by the other process times out without losing the outer one.
  const innerHold = locksB.withLock("inner", () => new Promise<void>((r) => { release = r; }));
  await sleep(30);
  let outerStillHeld = -1;
  const nested = await quickB.withLock("outer2", async () => {
    const e = await quickB.withLock("inner", async () => "no").catch((x) => x);
    outerStillHeld = await heldInPg("outer2");
    return e;
  });
  ok(nested instanceof SeoRetryableError && nested.code === "seo_busy" && outerStillHeld === 1 && (await heldInPg("outer2")) === 0, "an inner lock that times out leaves the outer one held, and both are gone after");
  release!(); await innerHold;

  // 7. Slots: no more sections than slots hold a connection at once; the next one waits its turn (and gives up at the deadline).
  const oneSlot = createSeoLocks({ connect: () => A.connect(), slots: 1, waitMs: 300 });
  const gate = oneSlot.withLock("s1", () => new Promise<void>((r) => { release = r; }));
  await sleep(30);
  const t1 = Date.now();
  const slotErr = await oneSlot.withLock("s2", async () => "no").catch((e) => e);
  ok(slotErr instanceof SeoRetryableError && Date.now() - t1 >= 250 && oneSlot.holding() === 1, `with every slot held, the next section waits and is told busy at the deadline (${Date.now() - t1}ms)`);
  const queued = oneSlot.withLock("s3", async () => "s3");
  await sleep(30); release!(); await gate;
  ok((await queued) === "s3" && oneSlot.holding() === 0, "the freed slot goes to the waiting section");

  // 8. The lock number: stable across processes (pure), and accepted by Postgres as a bigint.
  const { rows: [k] } = await pool.query("SELECT $1::bigint AS k", [lockKey("keywords:1")]);
  ok(String(k.k) === lockKey("keywords:1") && lockKey("keywords:1") !== lockKey("keywords:2"), `the key's lock number is a bigint Postgres takes as given: ${lockKey("keywords:1")}`);

  console.log(`lock checks passed: ${n}`);
  await Promise.all([A.end(), B.end(), pool.end()]);
})().catch((e) => { console.error("FAILED", e); process.exit(1); });
