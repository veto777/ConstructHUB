/** DDL for estimate options as tabs + estimate templates (estimate-options.ts). No imports: run by ensureCrmSchema. */
export const ESTIMATE_OPTIONS_DDL: readonly string[] = [
  `ALTER TABLE crm_estimate_options ADD COLUMN IF NOT EXISTS is_main boolean NOT NULL DEFAULT false`,
  `ALTER TABLE crm_estimate_options ADD COLUMN IF NOT EXISTS cancelled_at timestamp`,
  `CREATE TABLE IF NOT EXISTS crm_estimate_templates (
    id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id varchar NOT NULL,
    name text NOT NULL,
    title text,
    intro_text text,
    items jsonb NOT NULL DEFAULT '[]'::jsonb,
    offers jsonb,
    contractor_discount jsonb,
    created_by_member_id varchar,
    created_at timestamp NOT NULL DEFAULT now(),
    updated_at timestamp NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS crm_estimate_templates_org_idx ON crm_estimate_templates (org_id)`,
];
