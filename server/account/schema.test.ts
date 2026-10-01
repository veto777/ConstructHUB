/** ensureAccountSchema is idempotent and creates the contract's six tables with their keys. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pool } from "../db";
import { ACCOUNT_SCHEMA_DDL, ACCOUNT_TABLES, ensureAccountSchema } from "./schema";

beforeAll(async () => {
  const url = new URL(process.env.DATABASE_URL!);
  if (!["localhost", "127.0.0.1"].includes(url.hostname) || !/^\/constructhub_dev(?:_a\d+)?$/.test(url.pathname)) throw new Error("Local lane development database required");
});
afterAll(async () => { await pool.end(); });

describe("ensureAccountSchema", () => {
  it("only ever creates what is missing, sets a column default or drops a duplicate index (never rewrites rows)", () => {
    for (const s of ACCOUNT_SCHEMA_DDL) {
      expect(s).toMatch(/^\s*(CREATE (TABLE|INDEX|UNIQUE INDEX) IF NOT EXISTS|ALTER TABLE \w+ ALTER COLUMN \w+ SET DEFAULT|ALTER TABLE IF EXISTS \w+ ADD COLUMN IF NOT EXISTS|DROP INDEX IF EXISTS billing_\w+)/);
      expect(s).not.toMatch(/\b(UPDATE|DELETE|TRUNCATE|DROP TABLE|DROP COLUMN)\b/i);
    }
  });

  it("gives the bare contract shape the same defaults (another lane may create the tables first)", async () => {
    await ensureAccountSchema();
    const { rows } = await pool.query(
      `SELECT table_name, column_name, column_default FROM information_schema.columns
        WHERE table_schema=current_schema() AND (table_name, column_name) IN (('billing_events','received_at'), ('email_log','sent_at'), ('account_api_keys','created_at'))`);
    expect(rows.map((r) => [r.table_name, r.column_default]).sort()).toEqual([["account_api_keys", "now()"], ["billing_events", "now()"], ["email_log", "now()"]]);
  });

  it("creates the six tables and runs again without error", async () => {
    await ensureAccountSchema();
    await ensureAccountSchema(pool);
    const { rows } = await pool.query("SELECT table_name FROM information_schema.tables WHERE table_schema=current_schema() AND table_name=ANY($1::text[])", [ACCOUNT_TABLES]);
    expect(rows.map((r) => r.table_name).sort()).toEqual([...ACCOUNT_TABLES].sort());
  });

  it("has the contract's keys: event id PK, dedupe UNIQUE, (key_id, day) PK, unique prefix", async () => {
    const constraints = async (table: string) => (await pool.query(
      `SELECT c.conname AS name, c.contype AS type, array_agg(a.attname::text ORDER BY a.attnum) AS cols
         FROM pg_constraint c JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=ANY(c.conkey)
        WHERE c.conrelid=$1::regclass GROUP BY c.conname, c.contype`, [table])).rows;
    expect((await constraints("billing_events")).find((c) => c.type === "p")?.cols).toEqual(["stripe_event_id"]);
    expect((await constraints("email_log")).find((c) => c.type === "u")?.cols).toEqual(["dedupe_key"]);
    expect((await constraints("account_api_usage")).find((c) => c.type === "p")?.cols).toEqual(["key_id", "day"]);
    expect((await constraints("account_api_keys")).find((c) => c.type === "p")?.cols).toEqual(["id"]);
    const { rows: [idx] } = await pool.query("SELECT indexdef FROM pg_indexes WHERE indexname='account_api_keys_prefix_idx'");
    expect(idx.indexdef).toMatch(/UNIQUE INDEX .* \(prefix\)/);
  });
});
