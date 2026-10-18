/**
 * crm_leads DDL — idempotent, run at boot by server/crm/schema-ensure.ts. Kept apart from leads.ts so a script can
 * load it without the server. Mirror: shared/schema.ts crmLeads.
 */
export const LEADS_DDL: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS crm_leads (
     id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
     org_id varchar NOT NULL,
     source text NOT NULL,
     source_label text,
     name text,
     email text,
     phone text,
     address_line1 text,
     city text,
     state text,
     postal_code text,
     service text,
     message text,
     page_url text,
     fields jsonb,
     status text NOT NULL DEFAULT 'new',
     customer_id varchar,
     external_id text,
     received_at timestamp NOT NULL DEFAULT now(),
     created_at timestamp DEFAULT now(),
     updated_at timestamp DEFAULT now()
   )`,
  `CREATE INDEX IF NOT EXISTS crm_leads_org_received_idx ON crm_leads (org_id, received_at DESC)`,
  // 2026-10-18: a label set by hand in the lead's details, over the derived Open / Pending / Complete / Dead lead.
  `ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS bid_state_override text`,
  `ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS bid_state_note text`,
  `ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS bid_state_at timestamp`,
  `ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS bid_state_by varchar`,
  `CREATE UNIQUE INDEX IF NOT EXISTS crm_leads_org_source_external_uq ON crm_leads (org_id, source, external_id) WHERE external_id IS NOT NULL`,
];
