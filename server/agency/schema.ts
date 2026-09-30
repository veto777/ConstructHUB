import { pool } from '../db';
export async function ensureAgencySchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS agency_workspaces (
      user_id integer PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      name text NOT NULL DEFAULT 'Agency', auto_accept_all boolean NOT NULL DEFAULT false,
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS agency_clients (
      id serial PRIMARY KEY, user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name text NOT NULL, contact_email text, notes text NOT NULL DEFAULT '', tags text[] NOT NULL DEFAULT '{}',
      folder text, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(user_id,id)
    );
    CREATE INDEX IF NOT EXISTS agency_clients_owner ON agency_clients(user_id,id);
    CREATE TABLE IF NOT EXISTS agency_members (
      user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      member_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role text NOT NULL CHECK(role IN ('admin','manager','viewer')),
      all_clients boolean NOT NULL DEFAULT false, PRIMARY KEY(user_id,member_id), CHECK(user_id<>member_id)
    );
    CREATE TABLE IF NOT EXISTS agency_member_clients (
      user_id integer NOT NULL, member_id integer NOT NULL, client_id integer NOT NULL,
      PRIMARY KEY(user_id,member_id,client_id),
      FOREIGN KEY(user_id,member_id) REFERENCES agency_members(user_id,member_id) ON DELETE CASCADE,
      FOREIGN KEY(user_id,client_id) REFERENCES agency_clients(user_id,id) ON DELETE CASCADE
    );
    ALTER TABLE business_locations ADD COLUMN IF NOT EXISTS agency_client_id integer;
    DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='agency_location_client_fk') THEN
      ALTER TABLE business_locations ADD CONSTRAINT agency_location_client_fk FOREIGN KEY(user_id,agency_client_id) REFERENCES agency_clients(user_id,id);
    END IF; END $$;
    CREATE INDEX IF NOT EXISTS agency_locations_page ON business_locations(user_id,agency_client_id,id);
    CREATE INDEX IF NOT EXISTS agency_locations_owner_page ON business_locations(user_id,id);
    CREATE TABLE IF NOT EXISTS agency_social_post_clients (
      user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE, post_id uuid PRIMARY KEY,
      client_id integer NOT NULL, FOREIGN KEY(user_id,client_id) REFERENCES agency_clients(user_id,id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS agency_social_destinations (
      user_id integer NOT NULL, client_id integer NOT NULL, destinations jsonb NOT NULL DEFAULT '[]',
      PRIMARY KEY(user_id,client_id), FOREIGN KEY(user_id,client_id) REFERENCES agency_clients(user_id,id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS agency_jobs (
      id uuid PRIMARY KEY, user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      actor_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      location_id integer REFERENCES business_locations(id) ON DELETE CASCADE,
      action text NOT NULL, payload jsonb NOT NULL DEFAULT '{}', status text NOT NULL DEFAULT 'queued',
      priority integer NOT NULL DEFAULT 10, attempts integer NOT NULL DEFAULT 0,
      due_at timestamptz NOT NULL DEFAULT now(), created_at timestamptz NOT NULL DEFAULT now(),
      started_at timestamptz, finished_at timestamptz, error text, result jsonb,
      batch_id uuid NOT NULL, UNIQUE(batch_id,location_id)
    );
    CREATE INDEX IF NOT EXISTS agency_jobs_due ON agency_jobs(status,due_at,user_id,priority,created_at);
    CREATE INDEX IF NOT EXISTS agency_jobs_pending_owner ON agency_jobs(user_id) WHERE status IN ('queued','running');
    CREATE INDEX IF NOT EXISTS agency_jobs_batch_owner ON agency_jobs(user_id,batch_id);
    CREATE UNIQUE INDEX IF NOT EXISTS agency_sync_pending ON agency_jobs(location_id) WHERE action='sync' AND status IN ('queued','running');
    CREATE TABLE IF NOT EXISTS agency_worker_turns (user_id integer PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,last_at timestamptz NOT NULL DEFAULT 'epoch');
    CREATE TABLE IF NOT EXISTS agency_discovery (
      user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE, subject text NOT NULL,
      account text NOT NULL, location text NOT NULL, data jsonb NOT NULL, seen_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY(user_id,subject,account,location)
    );
    CREATE TABLE IF NOT EXISTS agency_onboarding (
      id uuid PRIMARY KEY, user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      client_id integer NOT NULL, subject text NOT NULL, agency_email text NOT NULL, contact_email text NOT NULL,
      business_name text NOT NULL, address text, place_id text,
      token_hash text NOT NULL UNIQUE, token_enc text NOT NULL,
      status text NOT NULL DEFAULT 'sent', sent_at timestamptz, opened_at timestamptz,
      invitation text, accepted_at timestamptz, location_id integer REFERENCES business_locations(id) ON DELETE SET NULL,
      expires_at timestamptz NOT NULL DEFAULT now()+interval '30 days',
      reminder_at timestamptz, reminders integer NOT NULL DEFAULT 0, error text,
      created_at timestamptz NOT NULL DEFAULT now(), FOREIGN KEY(user_id,client_id) REFERENCES agency_clients(user_id,id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS agency_onboarding_owner ON agency_onboarding(user_id,client_id,created_at DESC);
    CREATE TABLE IF NOT EXISTS agency_google_invitations (
      user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE, subject text NOT NULL, name text NOT NULL,
      target jsonb NOT NULL, status text NOT NULL DEFAULT 'received', error text,
      updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(user_id,subject,name)
    );
    CREATE TABLE IF NOT EXISTS agency_poll_grants (
      user_id integer NOT NULL, subject text NOT NULL, next_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY(user_id,subject)
    );
    ALTER TABLE agency_poll_grants ADD COLUMN IF NOT EXISTS refresh_requested boolean NOT NULL DEFAULT false;
  `);
}
