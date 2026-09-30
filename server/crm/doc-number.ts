import { sql } from "drizzle-orm";
import type { db } from "../db";

/** The document series that carry a human number ("INV-1042", "E-1043"). */
const SERIES = {
  INV: sql.raw("crm_invoices"),
  E: sql.raw("crm_estimates"),
} as const;

export type DocNumberPrefix = keyof typeof SERIES;

/** Anything that can run SQL in the caller's transaction (`db` or a `tx`). */
type Executor = Pick<typeof db, "execute">;

/**
 * The next document number for an org, allocated INSIDE the caller's
 * transaction — call it from the same `db.transaction` that inserts the row.
 *
 * The old scheme was `${prefix}-${1000 + count(*) + 1}`. After any delete the
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
 * duplicate. (A per-org counter column plus a UNIQUE (org_id, number) index
 * is the schema-level follow-up.)
 */
/** Take the (series, org) numbering lock for the rest of the transaction —
 *  for callers that must check something under it before allocating. The
 *  lock is re-entrant within a transaction, so nextDocNumber may follow. */
export async function lockDocNumbers(tx: Executor, prefix: DocNumberPrefix, orgId: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`crm-doc-number:${prefix}:${orgId}`}))`);
}

export async function nextDocNumber(tx: Executor, prefix: DocNumberPrefix, orgId: string): Promise<string> {
  await lockDocNumbers(tx, prefix, orgId);
  const pattern = `^${prefix}-([0-9]{1,15})$`;
  const result: any = await tx.execute(sql`
    select greatest(
      (select coalesce(max((substring(number from ${pattern}))::bigint), 0)
         from ${SERIES[prefix]} where org_id = ${orgId}),
      (select 1000 + count(*) from ${SERIES[prefix]} where org_id = ${orgId}),
      (select case when custom_fields->'docNumberHighWater'->>(${prefix}::text) ~ '^[0-9]{1,15}$'
                   then (custom_fields->'docNumberHighWater'->>(${prefix}::text))::bigint else 0 end
         from crm_orgs where id = ${orgId})
    )::bigint + 1 as next`);
  const next = Number(result.rows?.[0]?.next ?? 1001);
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
