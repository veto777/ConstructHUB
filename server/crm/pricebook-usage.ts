/**
 * Price-book memory per org (shared/pricebook-usage.ts has the rules and the picker ordering).
 *
 *   crm_estimate_items.pricebook_item_id   the price-book item a line was picked from (new; older lines have none,
 *                                          so there is nothing to backfill — counts start with this release)
 *   crm_pricebook_usage                    one row per org + item: use_count, last_used_at, last price/scope/unit
 *   crm_pricebook_usage_estimates          (org, item, estimate) — makes the count once per estimate per item
 *
 * recordPricebookUsage runs after every estimate create / items PATCH (autosave included): a new (item, estimate)
 * pair adds 1 to use_count; every save refreshes the last price, scope and unit to what the line now says.
 * Items of another org are ignored. Best-effort: a failure here never fails the estimate save.
 */
import { pool } from "../db";
import type { PricebookUsage } from "@shared/pricebook-usage";

export const PRICEBOOK_USAGE_DDL: readonly string[] = [
  `ALTER TABLE crm_estimate_items ADD COLUMN IF NOT EXISTS pricebook_item_id varchar`,
  // Line scope category (shared/scope-category.ts) and the tiered bundle rule copied onto an estimate's offer.
  `ALTER TABLE crm_estimate_items ADD COLUMN IF NOT EXISTS scope_category text`,
  `ALTER TABLE crm_estimate_discounts ADD COLUMN IF NOT EXISTS rule jsonb`,
  `CREATE TABLE IF NOT EXISTS crm_pricebook_usage (
    org_id varchar NOT NULL,
    item_id varchar NOT NULL,
    use_count integer NOT NULL DEFAULT 0,
    last_used_at timestamp,
    last_price_cents integer,
    last_description text,
    last_unit text,
    last_estimate_id varchar,
    PRIMARY KEY (org_id, item_id)
  )`,
  `CREATE TABLE IF NOT EXISTS crm_pricebook_usage_estimates (
    org_id varchar NOT NULL,
    item_id varchar NOT NULL,
    estimate_id varchar NOT NULL,
    created_at timestamp NOT NULL DEFAULT now(),
    PRIMARY KEY (org_id, item_id, estimate_id)
  )`,
];

type UsedLine = {
  pricebookItemId?: string | null;
  unitPriceCents?: number | null;
  description?: string | null;
  unit?: string | null;
  kind?: string | null;
};

export async function recordPricebookUsage(orgId: string, estimateId: string, lines: UsedLine[]): Promise<void> {
  // The last line wins for an item used twice on one estimate.
  const byItem = new Map<string, UsedLine>();
  for (const l of lines) {
    if (l.pricebookItemId && l.kind !== "discount") byItem.set(l.pricebookItemId, l);
  }
  if (!byItem.size) return;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const ids = [...byItem.keys()];
    const own = await client.query(`SELECT id FROM crm_pb_items WHERE org_id = $1 AND id = ANY($2::varchar[])`, [orgId, ids]);
    for (const { id } of own.rows as { id: string }[]) {
      const l = byItem.get(id)!;
      const fresh = await client.query(
        `INSERT INTO crm_pricebook_usage_estimates (org_id, item_id, estimate_id) VALUES ($1, $2, $3)
         ON CONFLICT DO NOTHING`, [orgId, id, estimateId]);
      await client.query(
        `INSERT INTO crm_pricebook_usage (org_id, item_id, use_count, last_used_at, last_price_cents, last_description, last_unit, last_estimate_id)
         VALUES ($1, $2, $3, now(), $4, $5, $6, $7)
         ON CONFLICT (org_id, item_id) DO UPDATE SET
           use_count = crm_pricebook_usage.use_count + $3,
           last_used_at = now(), last_price_cents = $4, last_description = $5, last_unit = $6, last_estimate_id = $7`,
        [orgId, id, fresh.rowCount ? 1 : 0, l.unitPriceCents ?? null, l.description?.trim() ? l.description : null,
          l.unit?.trim() ? l.unit.trim() : null, estimateId],
      );
    }
    await client.query("COMMIT");
  } catch (e: any) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("[crm] price-book usage not recorded:", e?.message ?? e);
  } finally {
    client.release();
  }
}

/** Usage for every used item of an org, by item id. */
export async function loadPricebookUsage(orgId: string): Promise<Map<string, PricebookUsage>> {
  const r = await pool.query(
    `SELECT item_id, use_count, last_used_at, last_price_cents, last_description, last_unit
     FROM crm_pricebook_usage WHERE org_id = $1`, [orgId]);
  const out = new Map<string, PricebookUsage>();
  for (const row of r.rows) {
    out.set(row.item_id, {
      useCount: row.use_count,
      lastUsedAt: row.last_used_at ? new Date(row.last_used_at).toISOString() : null,
      lastPriceCents: row.last_price_cents,
      lastDescription: row.last_description,
      lastUnit: row.last_unit,
    });
  }
  return out;
}
