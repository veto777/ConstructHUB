/**
 * Per-user dashboard preferences, stored server-side so they follow the
 * account across devices (shared/dashboard-prefs.ts holds the shapes and rules):
 *
 *   dashboard_prefs       one row per user: the layout (tile order, hidden
 *                         tiles, sections, grouped or one list)
 *   dashboard_dismissals  one row per cleared/snoozed "Needs you today" item:
 *                         the item key, the scope (the CRM org for a CRM
 *                         item, "" otherwise), the value it had, the snooze end
 *
 * Reads run on the dashboard's read-only pool; writes on the main pool. A read
 * that fails is "no preferences" (the default layout, nothing cleared): the
 * dashboard never breaks over them.
 */
import { pool } from "../db";
import {
  DASHBOARD_DISMISSALS_MAX, normalizeDashboardLayout, defaultDashboardLayout, dismissalScope,
  type DashboardDismissal, type DashboardDismissRow, type DashboardLayout,
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
     scope text NOT NULL DEFAULT '',
     item_value text NOT NULL,
     snoozed_until timestamptz,
     created_at timestamptz NOT NULL DEFAULT now(),
     PRIMARY KEY (user_id, scope, item_key)
   )`,
  // A table made before clears were per CRM org: add the scope and widen the key (once).
  `DO $$ BEGIN
     IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_schema = current_schema() AND table_name = 'dashboard_dismissals' AND column_name = 'scope') THEN
       ALTER TABLE dashboard_dismissals ADD COLUMN scope text NOT NULL DEFAULT '';
       ALTER TABLE dashboard_dismissals DROP CONSTRAINT IF EXISTS dashboard_dismissals_pkey;
       ALTER TABLE dashboard_dismissals ADD PRIMARY KEY (user_id, scope, item_key);
     END IF;
   END $$`,
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
    const rows = await dq<{ item_key: string; scope: string; item_value: string; snoozed_until: Date | null; created_at: Date }>(
      "SELECT item_key, scope, item_value, snoozed_until, created_at FROM dashboard_dismissals WHERE user_id=$1", [userId]);
    return rows.map((r) => ({
      key: r.item_key, scope: r.scope, value: r.item_value,
      until: r.snoozed_until ? new Date(r.snoozed_until).toISOString() : null,
      at: new Date(r.created_at).toISOString(),
    }));
  } catch (err) {
    log(`[dashboard] dismissals read failed: ${errText(err)}`);
    return [];
  }
}

/**
 * Clear or snooze items (upsert by scope + key: clearing again replaces the
 * value and snooze). Ended snoozes are dropped, and the user keeps at most
 * DASHBOARD_DISMISSALS_MAX rows (the oldest go).
 */
export async function saveDashboardDismissals(userId: number, items: DashboardDismissRow[]): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const it of items) {
      await client.query(
        `INSERT INTO dashboard_dismissals(user_id, item_key, scope, item_value, snoozed_until, created_at) VALUES($1,$2,$3,$4,$5, now())
         ON CONFLICT (user_id, scope, item_key) DO UPDATE SET item_value = EXCLUDED.item_value, snoozed_until = EXCLUDED.snoozed_until, created_at = now()`,
        [userId, it.key, it.scope, it.value, it.until],
      );
    }
    await client.query("DELETE FROM dashboard_dismissals WHERE user_id=$1 AND snoozed_until IS NOT NULL AND snoozed_until <= now()", [userId]);
    await client.query(
      `DELETE FROM dashboard_dismissals WHERE user_id=$1 AND (scope, item_key) IN (
         SELECT scope, item_key FROM dashboard_dismissals WHERE user_id=$1 ORDER BY created_at DESC, scope, item_key OFFSET $2)`,
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

/**
 * Restore cleared items as the user sees them in `scope` (the payload's CRM
 * org): these keys, or every one (`keys` null) — CRM items cleared in another
 * org stay cleared there. `scope` undefined: every row the user has.
 * Answers how many came back.
 */
export async function deleteDashboardDismissals(userId: number, keys: string[] | null, scope?: string): Promise<number> {
  if (scope === undefined) {
    const r = keys
      ? await pool.query("DELETE FROM dashboard_dismissals WHERE user_id=$1 AND item_key = ANY($2::text[])", [userId, keys])
      : await pool.query("DELETE FROM dashboard_dismissals WHERE user_id=$1", [userId]);
    return r.rowCount ?? 0;
  }
  if (keys) {
    let n = 0;
    for (const key of keys) {
      const r = await pool.query("DELETE FROM dashboard_dismissals WHERE user_id=$1 AND item_key=$2 AND scope=$3", [userId, key, dismissalScope(key, scope)]);
      n += r.rowCount ?? 0;
    }
    return n;
  }
  // Non-CRM rows are stored under "", a CRM item's under its org.
  const r = await pool.query("DELETE FROM dashboard_dismissals WHERE user_id=$1 AND (scope = '' OR scope = $2)", [userId, scope]);
  return r.rowCount ?? 0;
}

/**
 * Forget dismissals splitAttention judged stale: only those exact rows (same
 * scope, key, value and snooze end), so a clear saved again since — with a new
 * value or snooze — is never removed by an older read.
 */
export async function forgetStaleDismissals(userId: number, stale: readonly DashboardDismissal[]): Promise<number> {
  let n = 0;
  for (const d of stale) {
    const r = await pool.query(
      `DELETE FROM dashboard_dismissals WHERE user_id=$1 AND scope=$2 AND item_key=$3 AND item_value=$4
         AND snoozed_until IS NOT DISTINCT FROM $5::timestamptz`,
      [userId, d.scope, d.key, d.value, d.until]);
    n += r.rowCount ?? 0;
  }
  return n;
}
