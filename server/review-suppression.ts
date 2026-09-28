import { pool } from "./db";
export const normalizeRecipient = (email: string) => email.trim().toLowerCase();
export async function isReviewSuppressed(userId: number, email: string): Promise<boolean> {
  const { rows } = await pool.query("SELECT 1 FROM review_recipient_preferences WHERE user_id=$1 AND email=$2 AND unsubscribed=true", [userId, normalizeRecipient(email)]);
  return rows.length > 0;
}
export async function unsubscribeRecipient(userId: number, email: string) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`INSERT INTO review_recipient_preferences(user_id,email,unsubscribed) VALUES($1,$2,true)
      ON CONFLICT(user_id,email) DO UPDATE SET unsubscribed=true, updated_at=now()`, [userId, normalizeRecipient(email)]);
    await client.query("UPDATE review_requests SET unsubscribed=true,next_reminder_at=null WHERE user_id=$1 AND lower(trim(client_email))=$2", [userId, normalizeRecipient(email)]);
    await client.query("COMMIT");
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}
export async function resubscribeRecipient(userId: number, email: string) {
  // Keep a row after resubscribe so migration cannot reactivate a legacy opt-out.
  // Old suppressed requests stay suppressed; this permits only future requests.
  await pool.query(`INSERT INTO review_recipient_preferences(user_id,email,unsubscribed) VALUES($1,$2,false)
    ON CONFLICT(user_id,email) DO UPDATE SET unsubscribed=false, updated_at=now()`, [userId, normalizeRecipient(email)]);
}
