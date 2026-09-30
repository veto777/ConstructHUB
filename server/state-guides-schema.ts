/**
 * Idempotent ALTERs for the state-guide link-check columns (shared/schema.ts
 * stateGuides: sos_url_status … links_checked_at) and for sos_url becoming
 * nullable, so a dead Secretary of State link can be cleared instead of served.
 *
 * Every statement is additive and safe to re-run. The columns must exist
 * before anything selects or inserts state_guides through drizzle (the select
 * lists every schema column), so run this first: from the reference-data
 * seeder at boot, and from scripts/apply-schema-migration.ts.
 *
 * No imports on purpose — the migration script uses the statements with its
 * own pg pool.
 */
export const STATE_GUIDES_LINK_STATUS_DDL: readonly string[] = [
  `ALTER TABLE state_guides ALTER COLUMN sos_url DROP NOT NULL`,
  `ALTER TABLE state_guides ADD COLUMN IF NOT EXISTS sos_url_status text`,
  `ALTER TABLE state_guides ADD COLUMN IF NOT EXISTS licensing_board_url_status text`,
  `ALTER TABLE state_guides ADD COLUMN IF NOT EXISTS workers_comp_url_status text`,
  `ALTER TABLE state_guides ADD COLUMN IF NOT EXISTS tax_board_url_status text`,
  `ALTER TABLE state_guides ADD COLUMN IF NOT EXISTS links_checked_at text`,
];

export async function ensureStateGuidesSchema(
  q: { query: (text: string) => Promise<unknown> },
): Promise<void> {
  for (const statement of STATE_GUIDES_LINK_STATUS_DDL) await q.query(statement);
}
