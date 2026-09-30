import { pool } from "../db";
export async function ensureMailAlertsSchema() {
  await pool.query(`
 CREATE TABLE IF NOT EXISTS mail_alert_addresses(user_id integer PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,token_hash text NOT NULL UNIQUE,token_cipher text NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
 CREATE TABLE IF NOT EXISTS mail_alert_messages(id bigserial PRIMARY KEY,user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,dedupe text NOT NULL,source text NOT NULL,category text NOT NULL,severity text NOT NULL,sender text NOT NULL,subject text NOT NULL,body text NOT NULL,confirmation_code text,confirmation_link text,domain_id bigint REFERENCES managed_domains(id) ON DELETE SET NULL,location_id integer REFERENCES business_locations(id) ON DELETE SET NULL,read_at timestamptz,received_at timestamptz NOT NULL DEFAULT now(),expires_at timestamptz NOT NULL DEFAULT now()+interval '30 days',UNIQUE(user_id,dedupe));
 CREATE INDEX IF NOT EXISTS mail_alert_messages_owner ON mail_alert_messages(user_id,received_at DESC,id);
 CREATE INDEX IF NOT EXISTS mail_alert_messages_expiry ON mail_alert_messages(expires_at);
 CREATE TABLE IF NOT EXISTS mail_alert_grants(user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,google_subject text NOT NULL,email text NOT NULL,access_token text,refresh_token text,expires_at timestamptz,needs_reconnect boolean NOT NULL DEFAULT false,next_sync timestamptz NOT NULL DEFAULT now(),page_token text,last_error text,PRIMARY KEY(user_id,google_subject));
`);
}
