/**
 * ops_issues — the issue desk's one table (docs/ops/ISSUE-DESK.md). Idempotent
 * DDL: boot runs it (server/routes.ts), so does scripts/apply-schema-migration.ts,
 * and recordIssue runs it once lazily (a failure during boot can be recorded
 * before routes registered). shared/schema.ts `opsIssues` mirrors it.
 */
import { ISSUE_SOURCES, ISSUE_STATUSES, ISSUE_SEVERITIES } from "@shared/ops-issues";

const list = (xs: readonly string[]) => xs.map((x) => `'${x}'`).join(", ");

/**
 * What a digest tells the admins about one issue, as one comparable string:
 * its status, its fix branch, and when it last came back (reopened after
 * "fixed", or sent back by an admin — the time of the last such event and how
 * many the timeline holds). A run notifies about an issue only when
 * this differs from ops_issues.notified_sig.
 */
export const NOTIFY_SIG_SQL = `(status || '|' || coalesce(branch, '') || '|' || coalesce(
  (SELECT max(e->>'at') || '#' || count(*) FROM jsonb_array_elements(history) e WHERE e->>'event' IN ('reopened', 'reinspect')), ''))`;

export const OPS_ISSUES_DDL: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS ops_issues (
     id bigserial PRIMARY KEY,
     fingerprint text NOT NULL UNIQUE,
     source text NOT NULL CHECK (source IN (${list(ISSUE_SOURCES)})),
     severity text NOT NULL DEFAULT 'error' CHECK (severity IN (${list(ISSUE_SEVERITIES)})),
     title text NOT NULL,
     detail jsonb NOT NULL DEFAULT '{}'::jsonb,
     count integer NOT NULL DEFAULT 1,
     first_seen timestamptz NOT NULL DEFAULT now(),
     last_seen timestamptz NOT NULL DEFAULT now(),
     status text NOT NULL DEFAULT 'new' CHECK (status IN (${list(ISSUE_STATUSES)})),
     report text,
     branch text,
     inspected_at timestamptz,
     claimed_at timestamptz,
     history jsonb NOT NULL DEFAULT '[]'::jsonb,
     updated_at timestamptz NOT NULL DEFAULT now()
   )`,
  // a table made before "triage" existed gets the current status list (idempotent: only when it is missing)
  `DO $$ BEGIN
     IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'ops_issues'::regclass AND contype = 'c'
                    AND pg_get_constraintdef(oid) LIKE '%status%' AND pg_get_constraintdef(oid) LIKE '%triage%') THEN
       ALTER TABLE ops_issues DROP CONSTRAINT IF EXISTS ops_issues_status_check;
       ALTER TABLE ops_issues ADD CONSTRAINT ops_issues_status_check CHECK (status IN (${list(ISSUE_STATUSES)}));
     END IF;
   END $$`,
  // What the admins were last told about this issue (digest.ts): "<status>|<branch>|<last reopen/re-inspect>".
  // Added once; issues Claude had already reported on by then count as told, so the first run after
  // this ships does not announce old news.
  `DO $$ BEGIN
     IF NOT EXISTS (SELECT 1 FROM pg_attribute
                     WHERE attrelid = 'ops_issues'::regclass AND attname = 'notified_sig' AND NOT attisdropped) THEN
       ALTER TABLE ops_issues ADD COLUMN notified_sig text;
       UPDATE ops_issues SET notified_sig = ${NOTIFY_SIG_SQL} WHERE inspected_at IS NOT NULL;
     END IF;
   END $$`,
  `CREATE INDEX IF NOT EXISTS ops_issues_status_idx ON ops_issues (status, last_seen DESC)`,
  `CREATE INDEX IF NOT EXISTS ops_issues_last_seen_idx ON ops_issues (last_seen DESC)`,
];

export type Queryable = { query: (text: string, values?: unknown[]) => Promise<{ rows: any[]; rowCount?: number | null }> };

export async function ensureOpsIssuesSchema(q?: Queryable): Promise<void> {
  const target = q ?? (await import("../db")).pool;
  for (const sql of OPS_ISSUES_DDL) await target.query(sql);
}
