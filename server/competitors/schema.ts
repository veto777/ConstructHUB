import { pool } from "../db";
/**
 * Durable Competitor Intel execution (COMP-1). The scan row is the job: the
 * worker leases it (lease_token/lease_until), heartbeats while it runs, and
 * a lapsed lease is taken over or failed by the next process. The monthly
 * quota reservation is persisted on the row (quota_key/quota_amount) so a
 * refund survives a process restart and settles exactly once
 * (quota_refunded compare-and-swap), and retries never re-reserve.
 *
 * All changes are additive `IF NOT EXISTS`: safe on every database that
 * already has the round-1 table, mirroring server/sitescan/schema.ts.
 */
export async function ensureCompetitorWorkerSchema() {
  await pool.query(`
    ALTER TABLE competitor_scans ADD COLUMN IF NOT EXISTS lease_token uuid;
    ALTER TABLE competitor_scans ADD COLUMN IF NOT EXISTS lease_until timestamptz;
    ALTER TABLE competitor_scans ADD COLUMN IF NOT EXISTS run_at timestamptz NOT NULL DEFAULT now();
    ALTER TABLE competitor_scans ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 0;
    ALTER TABLE competitor_scans ADD COLUMN IF NOT EXISTS abandoned integer NOT NULL DEFAULT 0;
    ALTER TABLE competitor_scans ADD COLUMN IF NOT EXISTS quota_key text;
    ALTER TABLE competitor_scans ADD COLUMN IF NOT EXISTS quota_amount integer NOT NULL DEFAULT 0;
    ALTER TABLE competitor_scans ADD COLUMN IF NOT EXISTS quota_refunded boolean NOT NULL DEFAULT false;
    ALTER TABLE competitor_scans ADD COLUMN IF NOT EXISTS started_at timestamptz;
    ALTER TABLE competitor_scans ADD COLUMN IF NOT EXISTS finished_at timestamptz;
    CREATE INDEX IF NOT EXISTS competitor_scans_claim ON competitor_scans(status, run_at);
  `);
}
