import { pool } from '../db';
import { GBP_SCOPE, GoogleError, classify } from './client';
export async function grantStatus(userId: number) {
  const {rows:[g]} = await pool.query('SELECT google_subject,email,scopes,reconnect_required,expires_at FROM gbp_grants WHERE user_id=$1',[userId]);
  return { connected: !!g?.scopes.includes(GBP_SCOPE) && !g.reconnect_required,
    reconnectRequired: !!g?.reconnect_required, email: g?.email || null, scopes: g?.scopes || [], expiresAt: g?.expires_at || null };
}
export async function saveGrant(userId: number, identity: any, tokens: any) {
  const scopes = String(tokens.scope || '').split(/\s+/).filter(Boolean);
  if (!scopes.includes(GBP_SCOPE)) throw new GoogleError('auth','Business Profile permission was not granted. Reconnect and allow business.manage.',401);
  if (!identity.sub || !identity.email || !identity.email_verified || !tokens.access_token) throw new GoogleError('auth','Google account identity could not be verified',401);
  // Never reuse the refresh token of a different Google account.
  await pool.query(`INSERT INTO gbp_grants(user_id,google_subject,email,scopes,access_token,refresh_token,expires_at)
    VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(user_id) DO UPDATE SET
    google_subject=$2,email=$3,scopes=$4,access_token=$5,
    refresh_token=CASE WHEN gbp_grants.google_subject=$2 THEN COALESCE($6,gbp_grants.refresh_token) ELSE $6 END,
    expires_at=$7,reconnect_required=false,updated_at=now()`,
    [userId,identity.sub,identity.email,scopes,tokens.access_token,tokens.refresh_token || null,new Date(Date.now()+Number(tokens.expires_in || 3600)*1000)]);
}
const refreshing = new Map<number,Promise<string>>();
export async function accessToken(userId: number, http: typeof fetch = fetch): Promise<string> {
  if (refreshing.has(userId)) return refreshing.get(userId)!;
  const run = (async () => {
    const {rows:[g]} = await pool.query('SELECT * FROM gbp_grants WHERE user_id=$1',[userId]);
    if (!g || g.reconnect_required || !g.scopes.includes(GBP_SCOPE)) throw new GoogleError('auth','Google Business Profile not connected. Reconnect.',401);
    if (g.access_token && new Date(g.expires_at).getTime() > Date.now()+60000) return g.access_token as string;
    if (!g.refresh_token) { await invalidate(userId); throw new GoogleError('auth','Reconnect Google Business Profile',401); }
    let r: Response;
    try { r = await http('https://oauth2.googleapis.com/token',{method:'POST', headers:{'Content-Type':'application/x-www-form-urlencoded'},
      body:new URLSearchParams({client_id:process.env.GOOGLE_CLIENT_ID!,client_secret:process.env.GOOGLE_CLIENT_SECRET!,refresh_token:g.refresh_token,grant_type:'refresh_token'}),signal:AbortSignal.timeout(20000)}); }
    catch { throw new GoogleError('transient','Google token refresh temporarily unavailable',503); }
    const t = await r.json();
    if (!r.ok || !t.access_token) {
      const error = classify(r.status,t,'accounts');
      if (error.kind === 'auth') await invalidate(userId);
      throw error;
    }
    if (t.scope && !String(t.scope).split(' ').includes(GBP_SCOPE)) { await invalidate(userId); throw new GoogleError('auth','Reconnect Google Business Profile',401); }
    const result = await pool.query(`UPDATE gbp_grants SET access_token=$2,expires_at=$3,refresh_token=COALESCE($4,refresh_token),updated_at=now()
      WHERE user_id=$1 AND google_subject=$5 AND refresh_token=$6 AND reconnect_required=false RETURNING user_id`,
      [userId,t.access_token,new Date(Date.now()+Number(t.expires_in||3600)*1000),t.refresh_token||null,g.google_subject,g.refresh_token]);
    if (!result.rowCount) throw new GoogleError('invalid','Google connection changed. Retry.',409);
    return t.access_token as string;
  })();
  refreshing.set(userId,run);
  try { return await run; } finally { refreshing.delete(userId); }
}
/** Google user data is kept only while a grant is usable (privacy policy §4 and retention). Location
 *  rows stay (the contractor edits them) and keep their resource names so a reconnect re-links them. */
export async function purgeGoogleData(userId: number, db: { query: typeof pool.query } = pool) {
  await db.query(`DELETE FROM google_profile_reviews WHERE user_id=$1 AND google_review_id LIKE 'accounts/%/locations/%/reviews/%'`,[userId]);
  await db.query('DELETE FROM gbp_daily_metrics WHERE location_id IN (SELECT id FROM business_locations WHERE user_id=$1)',[userId]);
  await db.query('DELETE FROM gbp_sync_status WHERE location_id IN (SELECT id FROM business_locations WHERE user_id=$1)',[userId]);
}
export async function invalidate(userId: number) {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query('UPDATE gbp_grants SET reconnect_required=true,access_token=NULL WHERE user_id=$1',[userId]);
    await purgeGoogleData(userId, c as any);
    await c.query('COMMIT');
  } catch (e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); }
}
