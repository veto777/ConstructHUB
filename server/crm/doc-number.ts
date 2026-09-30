import { sql } from "drizzle-orm";
import type { db } from "../db";

/**
 * The document series that carry a human number ("INV-1042", "E-1043",
 * "CO-104"), the table each lives in, and the floor its numbers start above
 * (the first document is base+1). Every series is numbered per org.
 */
const SERIES = {
  INV: { table: "crm_invoices", base: 1000 },
  E: { table: "crm_estimates", base: 1000 },
  P: { table: "crm_projects", base: 1000 },
  PO: { table: "crm_commitments", base: 1000 },
  CO: { table: "crm_change_orders", base: 100 },
} as const;

export type DocNumberPrefix = keyof typeof SERIES;

/** Anything that can run SQL in the caller's transaction (`db` or a `tx`). */
type Executor = Pick<typeof db, "execute">;

/**
 * Take the (series, org) numbering lock for the rest of the transaction —
 * for callers that must check something under it before allocating. The
 * lock is re-entrant within a transaction, so nextDocNumber may follow.
 */
export async function lockDocNumbers(tx: Executor, prefix: DocNumberPrefix, orgId: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`crm-doc-number:${prefix}:${orgId}`}))`);
}

/**
 * The next document number for an org, allocated INSIDE the caller's
 * transaction — call it from the same `db.transaction` that inserts the row.
 * This is the ONE allocator for every series (entities.ts nextDocNumber is a
 * thin wrapper over it), so every create path for a series serialises on the
 * same lock.
 *
 * The old scheme was `${prefix}-${base + count(*) + 1}`. After any delete the
 * count drops, so the next document reused a number that still existed (QA
 * found INV-2234..2236 twice each in one org). Now:
 *   - a transaction-scoped advisory lock per (series, org) makes a concurrent
 *     allocation wait until this insert commits, so two requests can never
 *     read the same state;
 *   - the number is one past the highest of: every number this series still
 *     has, the legacy count-based value, and the org's high-water mark
 *     (crm_orgs.custom_fields.docNumberHighWater), which is advanced here so
 *     a hard-deleted last document's number is not handed out again.
 * The high-water mark only ever adds safety: if a wholesale custom_fields
 * write drops or rewinds it, the max over live numbers still rules out a
 * duplicate. The (org_id, number) unique indexes (ensureDocNumberUniqueIndexes
 * below) are the schema-level backstop.
 */
export async function nextDocNumber(tx: Executor, prefix: DocNumberPrefix, orgId: string): Promise<string> {
  await lockDocNumbers(tx, prefix, orgId);
  const { table, base } = SERIES[prefix];
  const from = sql.raw(table);
  const pattern = `^${prefix}-([0-9]{1,15})$`;
  const result: any = await tx.execute(sql`
    select greatest(
      (select coalesce(max((substring(number from ${pattern}))::bigint), 0)
         from ${from} where org_id = ${orgId}),
      (select ${base}::bigint + count(*) from ${from} where org_id = ${orgId}),
      (select case when custom_fields->'docNumberHighWater'->>(${prefix}::text) ~ '^[0-9]{1,15}$'
                   then (custom_fields->'docNumberHighWater'->>(${prefix}::text))::bigint else 0 end
         from crm_orgs where id = ${orgId})
    )::bigint + 1 as next`);
  const next = Number(result.rows?.[0]?.next ?? base + 1);
  await tx.execute(sql`
    update crm_orgs set custom_fields = jsonb_set(
      case when jsonb_typeof(custom_fields) = 'object' then custom_fields else '{}'::jsonb end,
      '{docNumberHighWater}',
      (case when jsonb_typeof(custom_fields->'docNumberHighWater') = 'object'
            then custom_fields->'docNumberHighWater' else '{}'::jsonb end)
        || jsonb_build_object(${prefix}::text, ${next}::bigint))
    where id = ${orgId}`);
  return `${prefix}-${next}`;
}

// ── Schema backstop: UNIQUE (org_id, number) per series ─────────────────────

/** The numbered tables, in the order the unique-index step visits them. */
export const DOC_NUMBER_TABLES: readonly string[] = Object.values(SERIES).map((s) => s.table);

/** The unique index that guards one table's (org_id, number). */
export const docNumberIndexName = (table: string) => `${table}_org_number_uniq`;

type Queryable = { query: (text: string, values?: unknown[]) => Promise<{ rows: any[] }> };
export type DocNumberIndexOutcome = "exists" | "created" | "skipped-duplicates" | "failed";

/**
 * Add a UNIQUE (org_id, number) index to every numbered table — ONLY where the
 * table has no repeated number yet. Idempotent and safe to run on every boot
 * or from scripts/apply-schema-migration.ts:
 *   - an index that already exists is left alone;
 *   - a table that still has a repeated (org_id, number) is SKIPPED with a log
 *     line naming a few of the repeats. Existing customer documents are never
 *     renumbered or rewritten here — resolving a repeat is an owner decision
 *     (the number is on documents clients already hold), and the index is
 *     added on the first run after it is resolved;
 *   - a create that loses a race to a new duplicate fails that table only.
 * Once the index exists, any path that writes a repeated number fails loudly
 * with 23505 instead of silently issuing a second "INV-2234".
 */
export async function ensureDocNumberUniqueIndexes(
  q: Queryable,
  tables: readonly string[] = DOC_NUMBER_TABLES,
  log: (line: string) => void = (line) => console.log(line),
): Promise<Record<string, DocNumberIndexOutcome>> {
  const out: Record<string, DocNumberIndexOutcome> = {};
  for (const table of tables) {
    if (!/^[a-z_][a-z0-9_]*$/.test(table)) throw new Error(`Not a plain table name: ${table}`);
    const index = docNumberIndexName(table);
    try {
      const { rows: [found] } = await q.query(`select to_regclass($1) is not null as present`, [index]);
      if (found?.present) { out[table] = "exists"; continue; }
      const { rows: repeats } = await q.query(
        `select org_id, number, count(*)::int as copies from ${table}
          where number is not null group by org_id, number having count(*) > 1
          order by copies desc, number limit 5`);
      if (repeats.length) {
        const { rows: [total] } = await q.query(
          `select count(*)::int as n from (select 1 from ${table} where number is not null
             group by org_id, number having count(*) > 1) d`);
        const sample = repeats.map((r) => `${r.number} ×${r.copies} (org ${r.org_id})`).join(", ");
        log(`[doc-numbers] ${table}: unique index ${index} NOT added — ${total?.n ?? repeats.length} ` +
          `(org_id, number) pair(s) repeat, e.g. ${sample}. Existing documents are never renumbered ` +
          `automatically; resolve the repeats with the owner, then re-run to add the index.`);
        out[table] = "skipped-duplicates";
        continue;
      }
      await q.query(`create unique index if not exists ${index} on ${table} (org_id, number) where number is not null`);
      log(`[doc-numbers] ${table}: unique index ${index} added`);
      out[table] = "created";
    } catch (e: any) {
      log(`[doc-numbers] ${table}: unique index ${index} not added — ${e?.message || e}`);
      out[table] = "failed";
    }
  }
  return out;
}
