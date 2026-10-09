/**
 * DDL for the account pricing terms (server/billing/pricing-terms.ts):
 * account_pricing_terms (what an account keeps that the price book no longer
 * sells) and pricing_settings (the owner's switches and the cutover marker).
 * Idempotent CREATE … IF NOT EXISTS, run at boot (server/billing/sync.ts
 * billingSchemaReady) and from scripts/apply-schema-migration.ts. No imports on
 * purpose — the migration script uses the statements with its own pg pool.
 */
export const PRICING_TERMS_DDL: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS account_pricing_terms (
     user_id integer PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
     seo_grandfathered_at timestamptz,
     seo_grandfathered_plan text,
     founding_member_at timestamptz,
     founding_prices jsonb,
     updated_at timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE TABLE IF NOT EXISTS pricing_settings (
     key text PRIMARY KEY,
     value jsonb NOT NULL,
     updated_at timestamptz NOT NULL DEFAULT now(),
     updated_by integer
   )`,
];
export const PRICING_TERMS_TABLES: readonly string[] = ["account_pricing_terms", "pricing_settings"];
