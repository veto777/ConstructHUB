import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { pool } from '../db';
import { recordFailure } from '../ops/issues';
let warned = false;
export function tokenKey(): Buffer {
  const value = process.env.GBP_TOKEN_KEY;
  if (value) {
    const key = Buffer.from(value, 'base64');
    if (key.length !== 32 || key.toString('base64') !== value) throw new Error('GBP_TOKEN_KEY must be 32 bytes in base64');
    return key;
  }
  if (process.env.NODE_ENV === 'production') throw new Error('GBP_TOKEN_KEY is required in production');
  if (!warned) { console.warn('[security] GBP_TOKEN_KEY missing: DEVELOPMENT derived key in use. Configure a persistent key before production.'); warned = true; }
  return createHash('sha256').update(process.env.SESSION_SECRET || 'development-only-gbp-key').digest();
}
export function encryptToken(value: string | null | undefined): string | null {
  if (!value) return null;
  const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', tokenKey(), iv);
  const data = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), data.toString('base64')].join(':');
}
export function decryptToken(value: string | null): string | null {
  if (!value) return null;
  if (!value.startsWith('v1:')) throw new Error('Unencrypted credential: run security migration');
  const [version, iv, tag, data, extra] = value.split(':');
  if (extra !== undefined || !data || Buffer.from(iv, 'base64').length !== 12 || Buffer.from(tag, 'base64').length !== 16) throw new Error('Invalid encrypted credential');
  const cipher = createDecipheriv('aes-256-gcm', tokenKey(), Buffer.from(iv, 'base64'));
  cipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([cipher.update(Buffer.from(data, 'base64')), cipher.final()]).toString('utf8');
}
export async function ensureGbpTokenEncryption(db: Pick<typeof pool, 'query'> = pool) {
  tokenKey(); // Fail closed even with no grants.
  const { rows } = await db.query('SELECT user_id,google_subject,access_token,refresh_token FROM gbp_grants');
  for (const row of rows) for (const column of ['access_token', 'refresh_token'] as const) {
    const value = row[column];
    if (value && !value.startsWith('v1:')) await db.query(`UPDATE gbp_grants SET ${column}=$1 WHERE user_id=$2 AND google_subject=$3 AND ${column}=$4`, [encryptToken(value), row.user_id, row.google_subject, value]);
    else if (value) {
      // One unreadable credential must not stop the site from booting: drop it and ask that user to reconnect.
      try { decryptToken(value); }
      catch (e: any) {
        console.error(`[security] unreadable GBP credential for user ${row.user_id} (${e?.message}); marking reconnect_required`);
        void recordFailure('job', 'GBP credential decryption at boot', e, { userId: row.user_id, column }, 'warning');
        await db.query('UPDATE gbp_grants SET access_token=NULL,refresh_token=NULL,reconnect_required=true WHERE user_id=$1 AND google_subject=$2',[row.user_id,row.google_subject]);
      }
    }
  }
}
