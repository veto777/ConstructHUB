/**
 * Per-user dashboard preferences, stored server-side so they follow the
 * account across devices (shared/dashboard-prefs.ts holds the shapes and rules):
 *
 *   dashboard_prefs       one row per user: the layout (tile order, hidden
 *                         tiles, sections, grouped or one list)
 *   dashboard_dismissals  one row per cleared/snoozed "Needs you today" item:
 *                         the item key, the value it had, the snooze end
 *
 * Reads run on the dashboard's read-only pool; writes on the main pool. A read
 * that fails is "no preferences" (the default layout, nothing cleared): the
 * dashboard never breaks over them.
 */
import { pool } from "../db";
import {
  DASHBOARD_DISMISSALS_MAX, normalizeDashboardLayout, defaultDashboardLayout,
  type DashboardDismissal, type DashboardLayout,
} from "@shared/dashboard-prefs";
import { dq } from "./pool";

/** Idempotent DDL (boot runs it; so does scripts/apply-schema-migration.ts). */
export const DASHBOARD_PREFS_DDL: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS dashboard_prefs (
     user_id integer PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
     layout jsonb NOT NULL,
     updated_at timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE TABLE IF NOT EXISTS dashboard_dismissals (
     user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     item_key text NOT NULL,
     item_value text NOT NULL,
     snoozed_until timestamptz,
     created_at timestamptz NOT NULL DEFAULT now(),
     PRIMARY KEY (user_id, item_key)
   )`,
];

export async function ensureDashboardPrefsSchema(): Promise<void> {
  for (const sql of DASHBOARD_PREFS_DDL) await pool.query(sql);
}

type Log = (line: string) => void;
const errText = (err: unknown) => (err instanceof Error ? err.message : String(err)).slice(0, 200);

/** The user's layout, complete and valid (the default when none is saved or the read fails). */
export async function readDashboardLayout(userId: number, log: Log = (l) => console.error(l)): Promise<DashboardLayout> {
  try {
    const [row] = await dq<{ layout: unknown }>("SELECT layout FROM dashboard_prefs WHERE user_id=$1", [userId]);
    return row ? normalizeDashboardLayout(row.layout) : defaultDashboardLayout();
  } catch (err) {
    log(`[dashboard] layout read failed: ${errText(err)}`);
    return defaultDashboardLayout();
  }
}

export async function saveDashboardLayout(userId: number, layout: DashboardLayout): Promise<void> {
  await pool.query(
    `INSERT INTO dashboard_prefs(user_id, layout, updated_at) VALUES($1, $2::jsonb, now())
     ON CONFLICT (user_id) DO UPDATE SET layout = EXCLUDED.layout, updated_at = now()`,
    [userId, JSON.stringify(layout)],
  );
}

export async function resetDashboardLayout(userId: number): Promise<void> {
  await pool.query("DELETE FROM dashboard_prefs WHERE user_id=$1", [userId]);
}

/** This user's cleared/snoozed items (none when the read fails). */
export async function readDashboardDismissals(userId: number, log: Log = (l) => console.error(l)): Promise<DashboardDismissal[]> {
  try {
    const rows = await dq<{ item_key: string; item_value: string; snoozed_until: Date | null; created_at: Date }>(
      "SELECT item_key, item_value, snoozed_until, created_at FROM dashboard_dismissals WHERE user_id=$1", [userId]);
    return rows.map((r) => ({
      key: r.item_key, value: r.item_value,
      until: r.snoozed_until ? new Date(r.snoozed_until).toISOString() : null,
      at: new Date(r.created_at).toISOString(),
    }));
  } catch (err) {
    log(`[dashboard] dismissals read failed: ${errText(err)}`);
    return [];
  }
}

/**
 * Clear or snooze items (upsert by key: clearing again replaces the value and
 * snooze). Ended snoozes are dropped, and the user keeps at most
 * DASHBOARD_DISMISSALS_MAX rows (the oldest go).
 */
export async function saveDashboardDismissals(userId: number, items: { key: string; value: string; until: string | null }[]): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const it of items) {
      await client.query(
        `INSERT INTO dashboard_dismissals(user_id, item_key, item_value, snoozed_until, created_at) VALUES($1,$2,$3,$4, now())
         ON CONFLICT (user_id, item_key) DO UPDATE SET item_value = EXCLUDED.item_value, snoozed_until = EXCLUDED.snoozed_until, created_at = now()`,
        [userId, it.key, it.value, it.until],
      );
    }
    await client.query("DELETE FROM dashboard_dismissals WHERE user_id=$1 AND snoozed_until IS NOT NULL AND snoozed_until <= now()", [userId]);
    await client.query(
      `DELETE FROM dashboard_dismissals WHERE user_id=$1 AND item_key IN (
         SELECT item_key FROM dashboard_dismissals WHERE user_id=$1 ORDER BY created_at DESC, item_key OFFSET $2)`,
      [userId, DASHBOARD_DISMISSALS_MAX],
    );
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** Restore cleared items: these keys, or every one (`keys` null). Answers how many came back. */
export async function deleteDashboardDismissals(userId: number, keys: string[] | null): Promise<number> {
  const r = keys
    ? await pool.query("DELETE FROM dashboard_dismissals WHERE user_id=$1 AND item_key = ANY($2::text[])", [userId, keys])
    : await pool.query("DELETE FROM dashboard_dismissals WHERE user_id=$1", [userId]);
  return r.rowCount ?? 0;
}
