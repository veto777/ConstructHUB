import { pool } from "../db";
export async function ensureDomainsSchema() {
  await pool.query(`
 CREATE TABLE IF NOT EXISTS domain_connections(id bigserial PRIMARY KEY,user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,provider text NOT NULL,label text NOT NULL,credentials text NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
 CREATE INDEX IF NOT EXISTS domain_connections_owner ON domain_connections(user_id,id);
 CREATE TABLE IF NOT EXISTS managed_domains(id bigserial PRIMARY KEY,user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,connection_id bigint REFERENCES domain_connections(id) ON DELETE SET NULL,domain text NOT NULL,location_id integer REFERENCES business_locations(id) ON DELETE SET NULL,registrar text NOT NULL DEFAULT 'manual',state jsonb,observed jsonb,checked_at timestamptz,next_check timestamptz NOT NULL DEFAULT now(),UNIQUE(user_id,domain));
 CREATE INDEX IF NOT EXISTS managed_domains_owner ON managed_domains(user_id,domain,id);
 CREATE INDEX IF NOT EXISTS managed_domains_due ON managed_domains(next_check);
 CREATE TABLE IF NOT EXISTS domain_jobs(id uuid PRIMARY KEY,user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,domain_id bigint REFERENCES managed_domains(id) ON DELETE CASCADE,connection_id bigint REFERENCES domain_connections(id) ON DELETE CASCADE,kind text NOT NULL,status text NOT NULL,payload jsonb NOT NULL DEFAULT '{}',before_state jsonb,after_state jsonb,result jsonb,error text,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),run_at timestamptz NOT NULL DEFAULT now(),expires_at timestamptz,attempts integer NOT NULL DEFAULT 0);
 CREATE INDEX IF NOT EXISTS domain_jobs_owner ON domain_jobs(user_id,created_at DESC);
 CREATE INDEX IF NOT EXISTS domain_jobs_queue ON domain_jobs(status,run_at);
 CREATE UNIQUE INDEX IF NOT EXISTS domain_monitor_unique ON domain_jobs(domain_id) WHERE kind='monitor' AND status IN ('queued','working');
 CREATE TABLE IF NOT EXISTS domain_alert_dedup(user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,domain_id bigint NOT NULL REFERENCES managed_domains(id) ON DELETE CASCADE,key text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(domain_id,key));
`);
}
