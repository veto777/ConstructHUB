import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "@shared/schema";

// Every `timestamp` (WITHOUT time zone) column holds UTC wall-clock time.
// Drizzle already reads and writes those columns as UTC, but `defaultNow()`
// runs now() in the SESSION time zone — on a server whose Postgres default is
// America/New_York that stored local time, and the rows came back 4h early
// ("4h ago" on a reply sent a minute ago). Pin every pooled session to UTC so
// now(), drizzle and the raw pg paths below all agree on one clock.
//   - parseInputDatesAsUTC: a JS Date bound as a raw query parameter is sent
//     as UTC, not the Node process's local time.
//   - the TIMESTAMP parser: raw pool.query() reads (drizzle overrides this
//     for its own queries) parse the stored UTC wall time as UTC. A value
//     with no offset gets "+00"; "infinity" and friends pass straight through.
pg.defaults.parseInputDatesAsUTC = true;
const parseTimestamptz = pg.types.getTypeParser(pg.types.builtins.TIMESTAMPTZ);
pg.types.setTypeParser(pg.types.builtins.TIMESTAMP, (v: string) =>
  parseTimestamptz(/^\d/.test(v) ? `${v}+00` : v));

const envInt = (name: string, fallback: number, min = 1) => { const n = Number(process.env[name]); return Number.isFinite(n) && n >= min ? Math.floor(n) : fallback; };

/**
 * Pool limits (reliability review H4, 2026-10-09). Before: pg's defaults — 10 connections, no wait limit, no
 * statement limit — shared by the CRM, sessions, ~35 workers and the SEO sections, so a slow query or a stuck
 * vendor call could hold the whole site.
 *   PG_POOL_MAX              connections in the main pool (10)
 *   PG_CONNECT_TIMEOUT_MS    how long a caller waits for a free connection before an error (10 000) — a wait
 *                            queue without a limit turned every slow path into a site-wide stall
 *   PG_STATEMENT_TIMEOUT_MS  server-side statement_timeout for every session (120 000; above the 75 s advisory
 *                            lock wait in server/seo/locks.ts and any seeding statement). Boot DDL sets its own.
 */
export const POOL_MAX = envInt("PG_POOL_MAX", 10);
export const CONNECT_TIMEOUT_MS = envInt("PG_CONNECT_TIMEOUT_MS", 10_000, 1_000);
export const STATEMENT_TIMEOUT_MS = envInt("PG_STATEMENT_TIMEOUT_MS", 120_000, 1_000);

/** Every pool this process opened (closed together on shutdown). */
export const pools: pg.Pool[] = [];

/** A pool with the platform's session settings and limits. `name` is for the log; `max` defaults to POOL_MAX. */
export function createPool(name: string, max = POOL_MAX): pg.Pool {
  const p = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    options: `-c TimeZone=UTC -c statement_timeout=${STATEMENT_TIMEOUT_MS}`,
    max,
    connectionTimeoutMillis: CONNECT_TIMEOUT_MS,
  });
  // An idle client's error (Postgres restarted — 28 uncaughtExceptions on 2026-10-09 05:41) is a log line, not a crash (M8).
  p.on("error", (err) => { console.error(`[db] idle connection error on pool "${name}": ${err?.message ?? err}`); });
  pools.push(p);
  return p;
}

export const pool = createPool("app");

/** Close every pool (shutdown). */
export async function closeAllPools(): Promise<void> {
  await Promise.all(pools.map((p) => p.end().catch((e) => console.error(`[db] pool close failed: ${e?.message ?? e}`))));
}

export const db = drizzle(pool, { schema });
