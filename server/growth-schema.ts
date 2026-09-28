import { pool } from "./db";

// Additive migration: legacy rows deliberately remain unowned.
export async function ensureGrowthSchema() {
  await pool.query(`
    ALTER TABLE ranking_grid_scans ADD COLUMN IF NOT EXISTS user_id integer;
    CREATE INDEX IF NOT EXISTS ranking_grid_owner_idx ON ranking_grid_scans(user_id);
    ALTER TABLE search_queries ADD COLUMN IF NOT EXISTS user_id integer;
    CREATE INDEX IF NOT EXISTS search_queries_owner_idx ON search_queries(user_id);
  `);
}
