import { pool } from "../db";

// Idempotent schema setup for the CRM tenancy layer. Run on boot instead of
// db:push (the live DB has pre-existing drift that trips drizzle-kit). Every
// statement is IF NOT EXISTS so re-running on every restart is harmless.
export async function ensureCrmSchema(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS crm_orgs (
      id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
      name text NOT NULL,
      legal_entity_name text,
      owner_user_id integer NOT NULL,
      email text,
      phone text,
      website text,
      logo_url text,
      address_line1 text,
      address_line2 text,
      city text,
      state text,
      postal_code text,
      country text DEFAULT 'US',
      timezone text DEFAULT 'America/Los_Angeles',
      license_number text,
      license_state text,
      industry text DEFAULT 'Construction & Remodeling',
      description text,
      invoice_footer text,
      estimate_footer text,
      terms_and_conditions text,
      warranty_text text,
      default_deposit_bps integer DEFAULT 0,
      currency text DEFAULT 'usd',
      created_at timestamp DEFAULT now(),
      updated_at timestamp DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS crm_members (
      id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
      org_id varchar NOT NULL,
      user_id integer,
      email text NOT NULL,
      role text NOT NULL DEFAULT 'field',
      status text NOT NULL DEFAULT 'active',
      display_name text,
      title text,
      phone text,
      avatar_url text,
      calendar_color text,
      hourly_cost_cents integer,
      permissions jsonb,
      last_active_at timestamp,
      created_at timestamp DEFAULT now(),
      updated_at timestamp DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS crm_invitations (
      id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
      org_id varchar NOT NULL,
      email text NOT NULL,
      role text NOT NULL DEFAULT 'field',
      permissions jsonb,
      token text NOT NULL,
      invited_by_user_id integer,
      expires_at timestamp,
      accepted_at timestamp,
      revoked_at timestamp,
      created_at timestamp DEFAULT now()
    );

    CREATE INDEX IF NOT EXISTS crm_orgs_owner_idx ON crm_orgs (owner_user_id);
    CREATE INDEX IF NOT EXISTS crm_members_org_idx ON crm_members (org_id);
    CREATE INDEX IF NOT EXISTS crm_members_user_idx ON crm_members (user_id);
    CREATE INDEX IF NOT EXISTS crm_invitations_org_idx ON crm_invitations (org_id);
  `);

  // ── Entities: customers, projects, jobs, estimates ──────────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS crm_customers (
      id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
      org_id varchar NOT NULL,
      display_name text NOT NULL,
      first_name text, last_name text, company_name text,
      email text, phone text, alt_phone text,
      address_line1 text, address_line2 text, city text, state text, postal_code text,
      billing_same_as_service boolean NOT NULL DEFAULT true,
      billing_line1 text, billing_city text, billing_state text, billing_postal_code text,
      lead_source_id varchar, owner_member_id varchar,
      notes text, tags text[], custom_fields jsonb,
      portal_token text NOT NULL,
      portal_last_seen_at timestamp,
      archived_at timestamp,
      created_at timestamp DEFAULT now(), updated_at timestamp DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS crm_projects (
      id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
      org_id varchar NOT NULL,
      customer_id varchar NOT NULL,
      number text, name text NOT NULL, description text,
      status text NOT NULL DEFAULT 'lead',
      address_line1 text, city text, state text, postal_code text,
      trades text[],
      project_manager_member_id varchar, sales_member_id varchar,
      contract_value_cents integer, budget_cents integer,
      start_date timestamp, target_end_date timestamp, completed_at timestamp,
      permit_portal_id integer, permit_number text, parcel_number text,
      custom_fields jsonb,
      stage_changed_at timestamp DEFAULT now(),
      archived_at timestamp,
      created_at timestamp DEFAULT now(), updated_at timestamp DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS crm_jobs (
      id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
      org_id varchar NOT NULL,
      project_id varchar NOT NULL,
      name text NOT NULL, trade text, description text,
      status text NOT NULL DEFAULT 'unscheduled',
      assigned_member_ids text[],
      scheduled_start timestamp, scheduled_end timestamp,
      started_at timestamp, completed_at timestamp,
      custom_fields jsonb,
      created_at timestamp DEFAULT now(), updated_at timestamp DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS crm_estimates (
      id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
      org_id varchar NOT NULL,
      customer_id varchar NOT NULL,
      project_id varchar,
      number text, title text NOT NULL DEFAULT 'Estimate',
      status text NOT NULL DEFAULT 'draft',
      intro_text text, terms_text text,
      subtotal_cents integer NOT NULL DEFAULT 0,
      discount_cents integer NOT NULL DEFAULT 0,
      tax_rate_bps integer NOT NULL DEFAULT 0,
      tax_cents integer NOT NULL DEFAULT 0,
      total_cents integer NOT NULL DEFAULT 0,
      deposit_cents integer,
      public_token text NOT NULL,
      sent_at timestamp, sent_to_email text,
      first_viewed_at timestamp, last_viewed_at timestamp,
      view_count integer NOT NULL DEFAULT 0,
      approved_at timestamp, declined_at timestamp, decline_reason text,
      signature_name text, signature_ip text, expires_at timestamp,
      created_by_member_id varchar, custom_fields jsonb,
      created_at timestamp DEFAULT now(), updated_at timestamp DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS crm_estimate_items (
      id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
      org_id varchar NOT NULL,
      estimate_id varchar NOT NULL,
      sort_order integer NOT NULL DEFAULT 0,
      kind text NOT NULL DEFAULT 'labor',
      name text NOT NULL, description text,
      quantity_milli integer NOT NULL DEFAULT 1000,
      unit text,
      unit_price_cents integer NOT NULL DEFAULT 0,
      unit_cost_cents integer,
      taxable boolean NOT NULL DEFAULT true,
      hidden_from_client boolean NOT NULL DEFAULT false,
      created_at timestamp DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS crm_estimate_events (
      id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
      org_id varchar NOT NULL,
      estimate_id varchar NOT NULL,
      type text NOT NULL, actor text, ip text, user_agent text, meta jsonb,
      created_at timestamp DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS crm_lead_sources (
      id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
      org_id varchar NOT NULL,
      name text NOT NULL,
      active boolean NOT NULL DEFAULT true,
      created_at timestamp DEFAULT now()
    );

    CREATE INDEX IF NOT EXISTS crm_customers_org_idx ON crm_customers (org_id);
    CREATE INDEX IF NOT EXISTS crm_projects_org_idx ON crm_projects (org_id);
    CREATE INDEX IF NOT EXISTS crm_projects_customer_idx ON crm_projects (customer_id);
    CREATE INDEX IF NOT EXISTS crm_jobs_project_idx ON crm_jobs (project_id);
    CREATE INDEX IF NOT EXISTS crm_estimates_org_idx ON crm_estimates (org_id);
    CREATE INDEX IF NOT EXISTS crm_estimates_customer_idx ON crm_estimates (customer_id);
    CREATE INDEX IF NOT EXISTS crm_estimate_items_est_idx ON crm_estimate_items (estimate_id);
    CREATE INDEX IF NOT EXISTS crm_estimate_events_est_idx ON crm_estimate_events (estimate_id);
    CREATE UNIQUE INDEX IF NOT EXISTS crm_customers_portal_token_uniq ON crm_customers (portal_token);
    CREATE UNIQUE INDEX IF NOT EXISTS crm_estimates_public_token_uniq ON crm_estimates (public_token);
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS crm_payment_accounts (
      id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
      org_id varchar NOT NULL,
      provider text NOT NULL,
      external_account_id text NOT NULL,
      livemode boolean NOT NULL DEFAULT false,
      charges_enabled boolean NOT NULL DEFAULT false,
      ach_enabled boolean NOT NULL DEFAULT false,
      card_enabled boolean NOT NULL DEFAULT false,
      account_email text, business_name text, country text, default_currency text,
      refresh_token text, token_expires_at timestamp,
      connected_by_member_id varchar,
      last_checked_at timestamp, last_error text, disconnected_at timestamp,
      created_at timestamp DEFAULT now(), updated_at timestamp DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS crm_payments (
      id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
      org_id varchar NOT NULL,
      customer_id varchar NOT NULL,
      estimate_id varchar, invoice_id varchar, project_id varchar,
      provider text NOT NULL, external_id text,
      purpose text NOT NULL DEFAULT 'deposit',
      amount_cents integer NOT NULL,
      currency text NOT NULL DEFAULT 'usd',
      method text,
      status text NOT NULL DEFAULT 'pending',
      application_fee_cents integer NOT NULL DEFAULT 0,
      failure_reason text, paid_at timestamp,
      created_at timestamp DEFAULT now(), updated_at timestamp DEFAULT now()
    );

    CREATE INDEX IF NOT EXISTS crm_payment_accounts_org_idx ON crm_payment_accounts (org_id);
    CREATE INDEX IF NOT EXISTS crm_payments_org_idx ON crm_payments (org_id);
    CREATE INDEX IF NOT EXISTS crm_payments_estimate_idx ON crm_payments (estimate_id);
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS crm_invoices (
      id varchar PRIMARY KEY DEFAULT gen_random_uuid(), org_id varchar NOT NULL,
      customer_id varchar NOT NULL, project_id varchar, estimate_id varchar,
      number text, title text NOT NULL DEFAULT 'Invoice', status text NOT NULL DEFAULT 'draft',
      subtotal_cents integer NOT NULL DEFAULT 0, discount_cents integer NOT NULL DEFAULT 0,
      tax_rate_bps integer NOT NULL DEFAULT 0, tax_cents integer NOT NULL DEFAULT 0,
      total_cents integer NOT NULL DEFAULT 0, paid_cents integer NOT NULL DEFAULT 0,
      retainage_bps integer NOT NULL DEFAULT 0, retainage_cents integer NOT NULL DEFAULT 0,
      due_at timestamp, public_token text NOT NULL, sent_at timestamp, sent_to_email text,
      first_viewed_at timestamp, view_count integer NOT NULL DEFAULT 0,
      paid_at timestamp, voided_at timestamp, notes text, custom_fields jsonb,
      created_at timestamp DEFAULT now(), updated_at timestamp DEFAULT now());

    CREATE TABLE IF NOT EXISTS crm_invoice_items (
      id varchar PRIMARY KEY DEFAULT gen_random_uuid(), org_id varchar NOT NULL,
      invoice_id varchar NOT NULL, sort_order integer NOT NULL DEFAULT 0,
      kind text NOT NULL DEFAULT 'labor', name text NOT NULL, description text,
      quantity_milli integer NOT NULL DEFAULT 1000, unit text,
      unit_price_cents integer NOT NULL DEFAULT 0, cost_code_id varchar,
      taxable boolean NOT NULL DEFAULT true, created_at timestamp DEFAULT now());

    CREATE TABLE IF NOT EXISTS crm_cost_codes (
      id varchar PRIMARY KEY DEFAULT gen_random_uuid(), org_id varchar NOT NULL,
      code text NOT NULL, name text NOT NULL, division text,
      active boolean NOT NULL DEFAULT true, created_at timestamp DEFAULT now());

    CREATE TABLE IF NOT EXISTS crm_phases (
      id varchar PRIMARY KEY DEFAULT gen_random_uuid(), org_id varchar NOT NULL,
      project_id varchar NOT NULL, name text NOT NULL, sort_order integer NOT NULL DEFAULT 0,
      start_date timestamp, end_date timestamp, created_at timestamp DEFAULT now());

    CREATE TABLE IF NOT EXISTS crm_budget_lines (
      id varchar PRIMARY KEY DEFAULT gen_random_uuid(), org_id varchar NOT NULL,
      project_id varchar NOT NULL, phase_id varchar, cost_code_id varchar NOT NULL,
      budget_cents integer NOT NULL DEFAULT 0, notes text,
      created_at timestamp DEFAULT now(), updated_at timestamp DEFAULT now());

    CREATE TABLE IF NOT EXISTS crm_commitments (
      id varchar PRIMARY KEY DEFAULT gen_random_uuid(), org_id varchar NOT NULL,
      project_id varchar NOT NULL, cost_code_id varchar,
      type text NOT NULL DEFAULT 'purchase_order', number text, vendor_name text,
      supplier text, description text, amount_cents integer NOT NULL DEFAULT 0,
      status text NOT NULL DEFAULT 'open', external_order_id text, ordered_at timestamp,
      created_at timestamp DEFAULT now(), updated_at timestamp DEFAULT now());

    CREATE TABLE IF NOT EXISTS crm_cost_entries (
      id varchar PRIMARY KEY DEFAULT gen_random_uuid(), org_id varchar NOT NULL,
      project_id varchar NOT NULL, cost_code_id varchar, commitment_id varchar,
      source text NOT NULL DEFAULT 'vendor_bill', vendor_name text, member_id varchar,
      description text, amount_cents integer NOT NULL DEFAULT 0, hours_milli integer,
      incurred_on timestamp DEFAULT now(), created_at timestamp DEFAULT now());

    CREATE TABLE IF NOT EXISTS crm_appointments (
      id varchar PRIMARY KEY DEFAULT gen_random_uuid(), org_id varchar NOT NULL,
      project_id varchar, job_id varchar, customer_id varchar,
      title text NOT NULL, notes text, crew_notes text,
      status text NOT NULL DEFAULT 'scheduled',
      starts_at timestamp NOT NULL, ends_at timestamp,
      all_day boolean NOT NULL DEFAULT false, arrival_window_minutes integer,
      dispatched_member_ids text[], on_my_way_at timestamp, started_at timestamp,
      completed_at timestamp, created_at timestamp DEFAULT now(), updated_at timestamp DEFAULT now());

    CREATE TABLE IF NOT EXISTS crm_change_orders (
      id varchar PRIMARY KEY DEFAULT gen_random_uuid(), org_id varchar NOT NULL,
      project_id varchar NOT NULL, customer_id varchar NOT NULL,
      number text, title text NOT NULL, description text,
      status text NOT NULL DEFAULT 'draft', amount_cents integer NOT NULL DEFAULT 0,
      cost_cents integer, schedule_impact_days integer NOT NULL DEFAULT 0,
      cost_code_id varchar, public_token text NOT NULL, sent_at timestamp,
      first_viewed_at timestamp, approved_at timestamp, declined_at timestamp,
      signature_name text, created_at timestamp DEFAULT now(), updated_at timestamp DEFAULT now());

    CREATE TABLE IF NOT EXISTS crm_punch_items (
      id varchar PRIMARY KEY DEFAULT gen_random_uuid(), org_id varchar NOT NULL,
      project_id varchar NOT NULL, title text NOT NULL, description text, location text,
      status text NOT NULL DEFAULT 'open', assigned_member_id varchar,
      due_at timestamp, completed_at timestamp, photo_urls text[],
      created_at timestamp DEFAULT now(), updated_at timestamp DEFAULT now());

    CREATE TABLE IF NOT EXISTS crm_daily_logs (
      id varchar PRIMARY KEY DEFAULT gen_random_uuid(), org_id varchar NOT NULL,
      project_id varchar NOT NULL, log_date timestamp NOT NULL, author_member_id varchar,
      weather text, temp_f integer, crew_count integer, hours_milli integer,
      work_completed text, delays text, visitors text, safety_notes text,
      photo_urls text[], created_at timestamp DEFAULT now());

    CREATE TABLE IF NOT EXISTS crm_selections (
      id varchar PRIMARY KEY DEFAULT gen_random_uuid(), org_id varchar NOT NULL,
      project_id varchar NOT NULL, category text, name text NOT NULL, description text,
      status text NOT NULL DEFAULT 'pending', allowance_cents integer NOT NULL DEFAULT 0,
      chosen_option_name text, actual_cents integer, due_at timestamp, decided_at timestamp,
      created_at timestamp DEFAULT now(), updated_at timestamp DEFAULT now());

    CREATE TABLE IF NOT EXISTS crm_estimate_options (
      id varchar PRIMARY KEY DEFAULT gen_random_uuid(), org_id varchar NOT NULL,
      estimate_id varchar NOT NULL, name text NOT NULL, tier integer NOT NULL DEFAULT 1,
      description text, recommended boolean NOT NULL DEFAULT false,
      show_total boolean NOT NULL DEFAULT true,
      subtotal_cents integer NOT NULL DEFAULT 0, total_cents integer NOT NULL DEFAULT 0,
      selected_at timestamp, created_at timestamp DEFAULT now());

    CREATE TABLE IF NOT EXISTS crm_api_keys (
      id varchar PRIMARY KEY DEFAULT gen_random_uuid(), org_id varchar NOT NULL,
      name text NOT NULL, key_hash text NOT NULL, key_prefix text NOT NULL,
      scopes text[], created_by_member_id varchar, last_used_at timestamp,
      revoked_at timestamp, created_at timestamp DEFAULT now());

    CREATE TABLE IF NOT EXISTS crm_webhooks (
      id varchar PRIMARY KEY DEFAULT gen_random_uuid(), org_id varchar NOT NULL,
      url text NOT NULL, secret text NOT NULL, events text[],
      active boolean NOT NULL DEFAULT true, last_status integer,
      last_attempt_at timestamp, failure_count integer NOT NULL DEFAULT 0,
      created_at timestamp DEFAULT now());

    CREATE INDEX IF NOT EXISTS crm_invoices_org_idx ON crm_invoices (org_id);
    CREATE INDEX IF NOT EXISTS crm_invoices_project_idx ON crm_invoices (project_id);
    CREATE INDEX IF NOT EXISTS crm_budget_project_idx ON crm_budget_lines (project_id);
    CREATE INDEX IF NOT EXISTS crm_commitments_project_idx ON crm_commitments (project_id);
    CREATE INDEX IF NOT EXISTS crm_cost_entries_project_idx ON crm_cost_entries (project_id);
    CREATE INDEX IF NOT EXISTS crm_appointments_org_start_idx ON crm_appointments (org_id, starts_at);
    CREATE INDEX IF NOT EXISTS crm_change_orders_project_idx ON crm_change_orders (project_id);
    CREATE INDEX IF NOT EXISTS crm_punch_project_idx ON crm_punch_items (project_id);
    CREATE INDEX IF NOT EXISTS crm_daily_logs_project_idx ON crm_daily_logs (project_id);
    CREATE INDEX IF NOT EXISTS crm_selections_project_idx ON crm_selections (project_id);
    CREATE UNIQUE INDEX IF NOT EXISTS crm_invoices_token_uniq ON crm_invoices (public_token);
    CREATE UNIQUE INDEX IF NOT EXISTS crm_change_orders_token_uniq ON crm_change_orders (public_token);
    CREATE UNIQUE INDEX IF NOT EXISTS crm_api_keys_hash_uniq ON crm_api_keys (key_hash);
    CREATE UNIQUE INDEX IF NOT EXISTS crm_cost_codes_org_code_uniq ON crm_cost_codes (org_id, code);
    CREATE UNIQUE INDEX IF NOT EXISTS crm_budget_line_uniq ON crm_budget_lines (project_id, cost_code_id, coalesce(phase_id,''));
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS crm_pb_categories (
      id varchar PRIMARY KEY DEFAULT gen_random_uuid(), org_id varchar NOT NULL,
      parent_id varchar, name text NOT NULL, sort_order integer NOT NULL DEFAULT 0,
      created_at timestamp DEFAULT now());

    CREATE TABLE IF NOT EXISTS crm_pb_labor_rates (
      id varchar PRIMARY KEY DEFAULT gen_random_uuid(), org_id varchar NOT NULL,
      name text NOT NULL, hourly_cost_cents integer NOT NULL DEFAULT 0,
      hourly_price_cents integer NOT NULL DEFAULT 0,
      is_default boolean NOT NULL DEFAULT false, active boolean NOT NULL DEFAULT true,
      created_at timestamp DEFAULT now());

    CREATE TABLE IF NOT EXISTS crm_pb_materials (
      id varchar PRIMARY KEY DEFAULT gen_random_uuid(), org_id varchar NOT NULL,
      category_id varchar, name text NOT NULL, sku text, description text,
      unit text NOT NULL DEFAULT 'ea',
      cost_cents integer NOT NULL DEFAULT 0, price_cents integer NOT NULL DEFAULT 0,
      waste_factor_bps integer NOT NULL DEFAULT 0, taxable boolean NOT NULL DEFAULT true,
      supplier text, supplier_sku text, image_url text,
      active boolean NOT NULL DEFAULT true, cost_updated_at timestamp,
      created_at timestamp DEFAULT now(), updated_at timestamp DEFAULT now());

    CREATE TABLE IF NOT EXISTS crm_pb_items (
      id varchar PRIMARY KEY DEFAULT gen_random_uuid(), org_id varchar NOT NULL,
      category_id varchar, code text, name text NOT NULL, description text,
      unit text NOT NULL DEFAULT 'ea', pricing_mode text NOT NULL DEFAULT 'computed',
      flat_price_cents integer, flat_cost_cents integer, percent_bps integer,
      qty_formula text, placeholders jsonb,
      markup_bps integer NOT NULL DEFAULT 0, min_charge_cents integer,
      taxable boolean NOT NULL DEFAULT true, cost_code_id varchar,
      active boolean NOT NULL DEFAULT true,
      created_at timestamp DEFAULT now(), updated_at timestamp DEFAULT now());

    CREATE TABLE IF NOT EXISTS crm_pb_item_parts (
      id varchar PRIMARY KEY DEFAULT gen_random_uuid(), org_id varchar NOT NULL,
      item_id varchar NOT NULL, sort_order integer NOT NULL DEFAULT 0,
      material_id varchar, labor_rate_id varchar,
      quantity_milli integer NOT NULL DEFAULT 1000, hours_milli integer,
      qty_formula text, notes text, created_at timestamp DEFAULT now());

    CREATE TABLE IF NOT EXISTS crm_pb_item_accessories (
      id varchar PRIMARY KEY DEFAULT gen_random_uuid(), org_id varchar NOT NULL,
      item_id varchar NOT NULL, accessory_item_id varchar NOT NULL,
      default_included boolean NOT NULL DEFAULT false, sort_order integer NOT NULL DEFAULT 0);

    CREATE TABLE IF NOT EXISTS crm_pb_packages (
      id varchar PRIMARY KEY DEFAULT gen_random_uuid(), org_id varchar NOT NULL,
      name text NOT NULL, tier integer NOT NULL DEFAULT 1, description text,
      category_id varchar, active boolean NOT NULL DEFAULT true,
      created_at timestamp DEFAULT now());

    CREATE TABLE IF NOT EXISTS crm_pb_package_items (
      id varchar PRIMARY KEY DEFAULT gen_random_uuid(), org_id varchar NOT NULL,
      package_id varchar NOT NULL, item_id varchar NOT NULL,
      quantity_milli integer NOT NULL DEFAULT 1000, sort_order integer NOT NULL DEFAULT 0);

    CREATE INDEX IF NOT EXISTS crm_pb_materials_org_idx ON crm_pb_materials (org_id);
    CREATE INDEX IF NOT EXISTS crm_pb_items_org_idx ON crm_pb_items (org_id);
    CREATE INDEX IF NOT EXISTS crm_pb_item_parts_item_idx ON crm_pb_item_parts (item_id);
    CREATE INDEX IF NOT EXISTS crm_pb_pkg_items_idx ON crm_pb_package_items (package_id);
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS crm_measurements (
      id varchar PRIMARY KEY DEFAULT gen_random_uuid(), org_id varchar NOT NULL,
      project_id varchar, customer_id varchar,
      provider text NOT NULL DEFAULT 'manual', status text NOT NULL DEFAULT 'draft',
      external_id text,
      address_line1 text, city text, state text, postal_code text,
      squares_milli integer, roof_area_sf_milli integer, wall_area_sf_milli integer,
      ridge_lf_milli integer, hip_lf_milli integer, valley_lf_milli integer,
      eave_lf_milli integer, rake_lf_milli integer, perimeter_lf_milli integer,
      predominant_pitch text, stories integer, facet_count integer,
      waste_suggestion_bps integer,
      raw_payload jsonb, report_url text,
      requested_by_member_id varchar, requested_at timestamp, completed_at timestamp,
      failure_reason text,
      created_at timestamp DEFAULT now(), updated_at timestamp DEFAULT now());

    CREATE INDEX IF NOT EXISTS crm_measurements_project_idx ON crm_measurements (project_id);
    CREATE INDEX IF NOT EXISTS crm_measurements_ext_idx ON crm_measurements (provider, external_id);
  `);

  // Additive columns for installs created before the column existed.
  await pool.query(`
    ALTER TABLE crm_orgs ADD COLUMN IF NOT EXISTS onboarding_dismissed_at timestamp;
    ALTER TABLE crm_orgs ADD COLUMN IF NOT EXISTS custom_fields jsonb;
    ALTER TABLE crm_payments ADD COLUMN IF NOT EXISTS invoice_id varchar;
    ALTER TABLE crm_payments ADD COLUMN IF NOT EXISTS note text;
  `);

  // ── Homeowner client portal: magic-link tokens + sessions ────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS crm_client_tokens (
      id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
      token_hash text NOT NULL,
      customer_ids jsonb NOT NULL,
      email text NOT NULL,
      expires_at timestamp NOT NULL,
      used_at timestamp,
      created_at timestamp DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS crm_client_sessions (
      id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
      token_hash text NOT NULL,
      customer_ids jsonb NOT NULL,
      expires_at timestamp NOT NULL,
      created_at timestamp DEFAULT now(),
      last_seen_at timestamp
    );

    CREATE UNIQUE INDEX IF NOT EXISTS crm_client_tokens_hash_uniq ON crm_client_tokens (token_hash);
    CREATE UNIQUE INDEX IF NOT EXISTS crm_client_sessions_hash_uniq ON crm_client_sessions (token_hash);
  `);

  // Constraints are added separately: they are not IF NOT EXISTS in older
  // Postgres, so each is guarded and allowed to fail benignly if present.
  const guarded = [
    `CREATE UNIQUE INDEX IF NOT EXISTS crm_members_org_email_uniq ON crm_members (org_id, lower(email))`,
    `CREATE UNIQUE INDEX IF NOT EXISTS crm_invitations_token_uniq ON crm_invitations (token)`,
    // One pending invite per email per org; accepted/revoked rows are excluded
    // so an ex-member can always be re-invited.
    `CREATE UNIQUE INDEX IF NOT EXISTS crm_invitations_pending_uniq
       ON crm_invitations (org_id, lower(email))
       WHERE accepted_at IS NULL AND revoked_at IS NULL`,
  ];
  for (const stmt of guarded) {
    try {
      await pool.query(stmt);
    } catch (e: any) {
      console.warn("[crm] index skipped:", e?.message || e);
    }
  }
}
