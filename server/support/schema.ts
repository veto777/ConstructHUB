/**
 * The support line's tables and the customer numbers (owner, 2026-10-08: a dedicated number answered by Gabe —
 * verify the caller, open tickets for serious issues, email the team and the customer). Idempotent, run on boot
 * like the other modules' ensure*Schema.
 *
 * Customer numbers: every account (users) gets an 8-digit `customer_number`; every CRM account (crm_orgs) gets a
 * `crm_number` "CRM" + 7 digits. Random, unique, never reused, shown in Settings — what a caller reads to Gabe.
 */
import { randomInt } from "crypto";
import { pool } from "../db";

export const newCustomerNumber = () => String(randomInt(10_000_000, 100_000_000));
export const newCrmNumber = () => `CRM${randomInt(1_000_000, 10_000_000)}`;

export async function ensureSupportSchema(): Promise<void> {
  await pool.query(`
    ALTER TABLE users ADD COLUMN IF NOT EXISTS customer_number text;
    CREATE UNIQUE INDEX IF NOT EXISTS users_customer_number_uq ON users (customer_number) WHERE customer_number IS NOT NULL;
    ALTER TABLE crm_orgs ADD COLUMN IF NOT EXISTS crm_number text;
    CREATE UNIQUE INDEX IF NOT EXISTS crm_orgs_crm_number_uq ON crm_orgs (crm_number) WHERE crm_number IS NOT NULL;

    CREATE TABLE IF NOT EXISTS support_tickets (
      id serial PRIMARY KEY,
      number text UNIQUE,
      user_id integer,
      crm_org_id varchar,
      verified_with text,            -- the customer number / CRM number / "email" / "phone" the caller verified with
      channel text NOT NULL DEFAULT 'phone',
      call_sid text,
      category text NOT NULL,        -- payment | technical | login | data | other
      severity text NOT NULL,        -- critical | high
      title text NOT NULL,
      description text NOT NULL,
      steps text,
      device text,
      contact_email text,            -- where replies go (the account's email on file)
      status text NOT NULL DEFAULT 'open',   -- open | in_progress | waiting_customer | resolved | closed
      notes jsonb NOT NULL DEFAULT '[]',     -- admin notes / replies: [{at, by, kind: note|reply, text}]
      history jsonb NOT NULL DEFAULT '[]',
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    -- Keypad line (ivr.ts): the description is a recording, transcribed after the call; the emails wait for it.
    ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS recording_sid text;
    ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS transcript_status text;   -- pending | working | done | failed | NULL (spoken)
    ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS emails_sent_at timestamptz;
    CREATE INDEX IF NOT EXISTS support_tickets_transcript_idx ON support_tickets (transcript_status) WHERE transcript_status IN ('pending','working');
    CREATE INDEX IF NOT EXISTS support_tickets_status_idx ON support_tickets (status, created_at DESC);
    CREATE INDEX IF NOT EXISTS support_tickets_user_idx ON support_tickets (user_id, created_at);
    CREATE UNIQUE INDEX IF NOT EXISTS support_tickets_call_uq ON support_tickets (call_sid) WHERE call_sid IS NOT NULL;

    -- One row per support call: the verification state machine lives here, server-side only.
    CREATE TABLE IF NOT EXISTS support_calls (
      call_sid text PRIMARY KEY,
      caller_number text,
      state jsonb NOT NULL DEFAULT '{}',
      user_id integer,
      verified_at timestamptz,
      ticket_id integer,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
  `);
  await backfillNumbers();
  await purgeOldCalls();
  setInterval(() => { purgeOldCalls().catch((e) => console.error("[support] purge failed:", e?.message || e)); }, 24 * 3_600_000).unref();
}

/** Support-call state (it holds the account's email/phones once identified) is kept 30 days (Kimi #8). */
export async function purgeOldCalls(): Promise<void> {
  await pool.query(`DELETE FROM support_calls WHERE updated_at < now() - interval '30 days'`);
}

/** Give every account without a number one (unique; a clash retries). */
export async function backfillNumbers(): Promise<void> {
  for (const [table, col, gen] of [["users", "customer_number", newCustomerNumber], ["crm_orgs", "crm_number", newCrmNumber]] as const) {
    const { rows } = await pool.query(`SELECT id FROM ${table} WHERE ${col} IS NULL`);
    for (const r of rows) {
      for (let i = 0; i < 8; i++) {
        try { await pool.query(`UPDATE ${table} SET ${col} = $1 WHERE id = $2 AND ${col} IS NULL`, [gen(), r.id]); break; }
        catch (e: any) { if (e?.code !== "23505") throw e; }
      }
    }
  }
}

/** The account's number, assigned on first need — only this account (Kimi #8: no table-wide backfill per request). */
export async function customerNumberFor(userId: number): Promise<string> {
  for (let i = 0; i < 8; i++) {
    const { rows } = await pool.query(`SELECT customer_number FROM users WHERE id = $1`, [userId]);
    if (rows[0]?.customer_number || !rows[0]) return rows[0]?.customer_number ?? "";
    try { await pool.query(`UPDATE users SET customer_number = $1 WHERE id = $2 AND customer_number IS NULL`, [newCustomerNumber(), userId]); }
    catch (e: any) { if (e?.code !== "23505") throw e; }
  }
  return "";
}
