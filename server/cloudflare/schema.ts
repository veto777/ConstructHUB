import { pool } from "../db";
/** Lane-owned storage; all provider identities are nested under a ConstructHUB owner. */
export async function ensureCloudflareSearchSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS edge_connections (
      id serial PRIMARY KEY, user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      provider text NOT NULL CHECK(provider IN ('cloudflare','gsc')), subject text NOT NULL,
      email text, token text, refresh_token text, expires_at timestamptz,
      token_id text, token_name text, permissions jsonb NOT NULL DEFAULT '[]',
      created_token boolean NOT NULL DEFAULT false, method text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(user_id,provider,subject), UNIQUE(id,user_id));
    CREATE TABLE IF NOT EXISTS edge_assets (
      id serial PRIMARY KEY, user_id integer NOT NULL, connection_id integer NOT NULL,
      provider text NOT NULL, external_id text NOT NULL, name text NOT NULL, domain text NOT NULL,
      account_id text, status text NOT NULL, synced_at timestamptz, data jsonb, error text,
      FOREIGN KEY(connection_id,user_id) REFERENCES edge_connections(id,user_id) ON DELETE CASCADE,
      UNIQUE(connection_id,external_id), UNIQUE(id,user_id));
    CREATE INDEX IF NOT EXISTS edge_assets_owner ON edge_assets(user_id,provider,id);
    CREATE TABLE IF NOT EXISTS edge_location_links (
      asset_id integer NOT NULL, user_id integer NOT NULL,
      location_id integer NOT NULL REFERENCES business_locations(id) ON DELETE CASCADE,
      FOREIGN KEY(asset_id,user_id) REFERENCES edge_assets(id,user_id) ON DELETE CASCADE,
      PRIMARY KEY(asset_id,location_id));
    CREATE INDEX IF NOT EXISTS edge_links_location ON edge_location_links(user_id,location_id);
    CREATE TABLE IF NOT EXISTS edge_jobs (
      id bigserial PRIMARY KEY, user_id integer NOT NULL, connection_id integer NOT NULL,
      asset_id integer REFERENCES edge_assets(id) ON DELETE CASCADE, kind text NOT NULL,
      payload jsonb NOT NULL DEFAULT '{}', state text NOT NULL DEFAULT 'queued', attempts integer NOT NULL DEFAULT 0,
      available_at timestamptz NOT NULL DEFAULT now(), started_at timestamptz, finished_at timestamptz, error text,
      FOREIGN KEY(connection_id,user_id) REFERENCES edge_connections(id,user_id) ON DELETE CASCADE);
    CREATE INDEX IF NOT EXISTS edge_jobs_ready ON edge_jobs(available_at,id) WHERE state='queued';
    CREATE INDEX IF NOT EXISTS edge_jobs_owner ON edge_jobs(user_id,id);
    CREATE UNIQUE INDEX IF NOT EXISTS edge_jobs_active_unique ON edge_jobs(connection_id,COALESCE(asset_id,0),kind,md5(payload::text)) WHERE state IN ('queued','running');
    CREATE TABLE IF NOT EXISTS edge_actions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id integer NOT NULL, asset_id integer NOT NULL,
      kind text NOT NULL, preview jsonb NOT NULL, remote jsonb NOT NULL DEFAULT '[]',
      state text NOT NULL DEFAULT 'preview', created_at timestamptz NOT NULL DEFAULT now(), applied_at timestamptz,
      FOREIGN KEY(asset_id,user_id) REFERENCES edge_assets(id,user_id) ON DELETE CASCADE);
    CREATE TABLE IF NOT EXISTS edge_invites (
      id serial PRIMARY KEY, user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      provider text NOT NULL, email text NOT NULL, domain text NOT NULL, account_id text, connection_id integer,
      state text NOT NULL DEFAULT 'pending', created_at timestamptz NOT NULL DEFAULT now());
    CREATE TABLE IF NOT EXISTS gsc_analytics (
      asset_id integer NOT NULL REFERENCES edge_assets(id) ON DELETE CASCADE, dimension text NOT NULL,
      date date NOT NULL, key text NOT NULL, clicks double precision NOT NULL, impressions double precision NOT NULL,
      position double precision NOT NULL, PRIMARY KEY(asset_id,dimension,date,key));
    CREATE TABLE IF NOT EXISTS gsc_inspections (
      asset_id integer NOT NULL REFERENCES edge_assets(id) ON DELETE CASCADE, url text NOT NULL,
      result jsonb NOT NULL, inspected_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(asset_id,url));
    CREATE TABLE IF NOT EXISTS edge_request_budget (provider text PRIMARY KEY, next_at timestamptz NOT NULL);
    INSERT INTO edge_request_budget VALUES('cloudflare',now()),('gsc',now()) ON CONFLICT DO NOTHING;
  `);
}
