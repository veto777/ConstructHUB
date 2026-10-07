/**
 * ops_issues — the issue desk's one table (docs/ops/ISSUE-DESK.md). Idempotent
 * DDL: boot runs it (server/routes.ts), so does scripts/apply-schema-migration.ts,
 * and recordIssue runs it once lazily (a failure during boot can be recorded
 * before routes registered). shared/schema.ts `opsIssues` mirrors it.
 */
import { ISSUE_SOURCES, ISSUE_STATUSES, ISSUE_SEVERITIES } from "@shared/ops-issues";

const list = (xs: readonly string[]) => xs.map((x) => `'${x}'`).join(", ");

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
  // user reports (/report-issue): the "user" source, who reported, and the reply the reporter reads
  `DO $$ BEGIN
     IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'ops_issues'::regclass AND contype = 'c'
                    AND pg_get_constraintdef(oid) LIKE '%source%' AND pg_get_constraintdef(oid) LIKE '%''user''%') THEN
       ALTER TABLE ops_issues DROP CONSTRAINT IF EXISTS ops_issues_source_check;
       ALTER TABLE ops_issues ADD CONSTRAINT ops_issues_source_check CHECK (source IN (${list(ISSUE_SOURCES)}));
     END IF;
   END $$`,
  `ALTER TABLE ops_issues ADD COLUMN IF NOT EXISTS reporter_user_id integer`,
  `ALTER TABLE ops_issues ADD COLUMN IF NOT EXISTS reporter_email text`,
  `ALTER TABLE ops_issues ADD COLUMN IF NOT EXISTS public_reply text`,
  `ALTER TABLE ops_issues ADD COLUMN IF NOT EXISTS public_reply_at timestamptz`,
  `CREATE INDEX IF NOT EXISTS ops_issues_reporter_idx ON ops_issues (reporter_user_id, id DESC) WHERE reporter_user_id IS NOT NULL`,
  `CREATE INDEX IF NOT EXISTS ops_issues_status_idx ON ops_issues (status, last_seen DESC)`,
  `CREATE INDEX IF NOT EXISTS ops_issues_last_seen_idx ON ops_issues (last_seen DESC)`,
];

export type Queryable = { query: (text: string, values?: unknown[]) => Promise<{ rows: any[]; rowCount?: number | null }> };

export async function ensureOpsIssuesSchema(q?: Queryable): Promise<void> {
  const target = q ?? (await import("../db")).pool;
  for (const sql of OPS_ISSUES_DDL) await target.query(sql);
}
