/**
 * The dashboard's own small, READ-ONLY connection pool.
 *
 * Every tile query the dashboard writes itself runs here, so three rules hold
 * by construction rather than by care:
 *   - read-only: default_transaction_read_only=on makes any write on these
 *     connections fail (the dashboard has no side effects; SPEC §0.3);
 *   - bounded: statement_timeout = the per-tile budget, so a slow query is
 *     cancelled by Postgres instead of holding a connection after the response
 *     (SPEC §3.2);
 *   - small: at most DASHBOARD_POOL_MAX connections, so a burst of dashboard
 *     loads can never starve the app's main pool.
 * Same clock as server/db.ts (TimeZone=UTC; `timestamp` columns hold UTC wall time).
 *
 * Reused service functions (getEntitlements, monthlyUsage, the CRM rollups)
 * keep running on the main pool: they are the same bounded, indexed reads the
 * pages already make.
 */
import pg from "pg";
import "../db"; // the shared pg type parsers and parseInputDatesAsUTC
import { DASHBOARD_TILE_TIMEOUT_MS } from "@shared/dashboard";

export const DASHBOARD_POOL_MAX = 5;

let pool: pg.Pool | null = null;

export function dashboardPool(): pg.Pool {
  pool ??= new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    max: DASHBOARD_POOL_MAX,
    idleTimeoutMillis: 30_000,
    application_name: "constructhub-dashboard",
    options: `-c TimeZone=UTC -c default_transaction_read_only=on -c statement_timeout=${DASHBOARD_TILE_TIMEOUT_MS}`,
  });
  return pool;
}

/** Run one parameterised read on the dashboard pool. */
export async function dq<T = any>(text: string, values: unknown[] = []): Promise<T[]> {
  const { rows } = await dashboardPool().query(text, values);
  return rows as T[];
}

/** Tests: close the pool so the process can exit. */
export async function endDashboardPool(): Promise<void> {
  const p = pool;
  pool = null;
  if (p) await p.end();
}
