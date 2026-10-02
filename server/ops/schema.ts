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
  `CREATE INDEX IF NOT EXISTS ops_issues_status_idx ON ops_issues (status, last_seen DESC)`,
  `CREATE INDEX IF NOT EXISTS ops_issues_last_seen_idx ON ops_issues (last_seen DESC)`,
];

export type Queryable = { query: (text: string, values?: unknown[]) => Promise<{ rows: any[]; rowCount?: number | null }> };

export async function ensureOpsIssuesSchema(q?: Queryable): Promise<void> {
  const target = q ?? (await import("../db")).pool;
  for (const sql of OPS_ISSUES_DDL) await target.query(sql);
}
