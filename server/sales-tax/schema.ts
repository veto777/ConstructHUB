/**
 * sales_tax_rates / sales_tax_rate_loads DDL (shared/schema.ts salesTaxRates,
 * salesTaxRateLoads). Idempotent, run before anything reads or writes the
 * tables: by the boot seeder (server/sales-tax/store.ts), by ensureCrmSchema,
 * and by the refresh CLI. No imports on purpose — callers pass their own pool.
 */
export const SALES_TAX_DDL: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS sales_tax_rates (
    id serial PRIMARY KEY,
    state varchar(2) NOT NULL,
    city text,
    city_key text,
    county text,
    location_code text,
    zip varchar(5),
    kind text NOT NULL,
    rate_pct numeric(7,4) NOT NULL,
    rate_bps integer NOT NULL,
    effective_date date NOT NULL,
    source text NOT NULL,
    source_url text NOT NULL,
    period_label text NOT NULL
  )`,
  // Correct the cached reference rate from the published percent, including unchanged seed loads.
  `DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema()
      AND table_name = 'sales_tax_rates' AND column_name = 'rate_bps' AND data_type = 'integer') THEN
      ALTER TABLE sales_tax_rates ALTER COLUMN rate_bps TYPE numeric(8,2);
      UPDATE sales_tax_rates SET rate_bps = rate_pct * 100;
    END IF;
  END $$`,
  `CREATE INDEX IF NOT EXISTS sales_tax_rates_state_city_idx ON sales_tax_rates (state, city_key)`,
  `CREATE TABLE IF NOT EXISTS sales_tax_rate_loads (
    state varchar(2) PRIMARY KEY,
    source text NOT NULL,
    source_url text NOT NULL,
    effective_date date NOT NULL,
    period_label text NOT NULL,
    row_count integer NOT NULL,
    content_hash text NOT NULL,
    origin text NOT NULL,
    loaded_at timestamp NOT NULL DEFAULT now()
  )`,
];

export async function ensureSalesTaxSchema(q: { query: (text: string) => Promise<unknown> }): Promise<void> {
  for (const statement of SALES_TAX_DDL) await q.query(statement);
}
