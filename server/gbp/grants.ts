import { pool } from '../db';
import { GBP_SCOPE, GoogleError, classify } from './client';
const usable = (g: any) => !!g && g.scopes.includes(GBP_SCOPE) && !g.reconnect_required;
export async function grantStatus(userId: number) {
  const {rows} = await pool.query('SELECT google_subject,email,scopes,reconnect_required,expires_at FROM gbp_grants WHERE user_id=$1 ORDER BY updated_at DESC',[userId]);
  const accounts = rows.map(g => ({ subject: g.google_subject, email: g.email, connected: usable(g), reconnectRequired: !!g.reconnect_required }));
  const live = rows.find(usable);
  return { connected: !!live, reconnectRequired: !live && rows.some(g => g.reconnect_required),
    email: live?.email || rows[0]?.email || null, scopes: (live || rows[0])?.scopes || [], expiresAt: (live || rows[0])?.expires_at || null, accounts };
}
export async function saveGrant(userId: number, identity: any, tokens: any) {
  const scopes = String(tokens.scope || '').split(/\s+/).filter(Boolean);
  if (!scopes.includes(GBP_SCOPE)) throw new GoogleError('auth','Business Profile permission was not granted. Reconnect and allow business.manage.',401);
  if (!identity.sub || !identity.email || !identity.email_verified || !tokens.access_token) throw new GoogleError('auth','Google account identity could not be verified',401);
  // One row per Google account; a refresh token is only ever reused for the same Google subject.
  await pool.query(`INSERT INTO gbp_grants(user_id,google_subject,email,scopes,access_token,refresh_token,expires_at)
    VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(user_id,google_subject) DO UPDATE SET
    email=$3,scopes=$4,access_token=$5,refresh_token=COALESCE($6,gbp_grants.refresh_token),
    expires_at=$7,reconnect_required=false,updated_at=now()`,
    [userId,identity.sub,identity.email,scopes,tokens.access_token,tokens.refresh_token || null,new Date(Date.now()+Number(tokens.expires_in || 3600)*1000)]);
}
/** The Google account a request should use: the given one, or the user's only account. Null when ambiguous/none. */
export async function soleSubject(userId: number): Promise<string|null> {
  const {rows} = await pool.query('SELECT google_subject FROM gbp_grants WHERE user_id=$1',[userId]);
  return rows.length === 1 ? rows[0].google_subject : null;
}
export async function grantUsable(userId: number, subject: string|null) {
  const s = subject ?? await soleSubject(userId);
  if (!s) return false;
  const {rows:[g]} = await pool.query('SELECT scopes,reconnect_required FROM gbp_grants WHERE user_id=$1 AND google_subject=$2',[userId,s]);
  return usable(g);
}
const refreshing = new Map<string,Promise<string>>();
export async function accessToken(userId: number, subject: string|null = null, http: typeof fetch = fetch): Promise<string> {
  const s = subject ?? await soleSubject(userId);
  if (!s) throw new GoogleError('auth','Google Business Profile not connected for this listing. Import it from the Google account that manages it.',401);
  const key = `${userId}:${s}`;
  if (refreshing.has(key)) return refreshing.get(key)!;
  const run = (async () => {
    const {rows:[g]} = await pool.query('SELECT * FROM gbp_grants WHERE user_id=$1 AND google_subject=$2',[userId,s]);
    if (!usable(g)) throw new GoogleError('auth','Google Business Profile not connected. Reconnect.',401);
    if (g.access_token && new Date(g.expires_at).getTime() > Date.now()+60000) return g.access_token as string;
    if (!g.refresh_token) { await invalidate(userId,s); throw new GoogleError('auth','Reconnect Google Business Profile',401); }
    let r: Response;
    try { r = await http('https://oauth2.googleapis.com/token',{method:'POST', headers:{'Content-Type':'application/x-www-form-urlencoded'},
      body:new URLSearchParams({client_id:process.env.GOOGLE_CLIENT_ID!,client_secret:process.env.GOOGLE_CLIENT_SECRET!,refresh_token:g.refresh_token,grant_type:'refresh_token'}),signal:AbortSignal.timeout(20000)}); }
    catch { throw new GoogleError('transient','Google token refresh temporarily unavailable',503); }
    const t = await r.json();
    if (!r.ok || !t.access_token) {
      const error = classify(r.status,t,'accounts');
      if (error.kind === 'auth') await invalidate(userId,s);
      throw error;
    }
    if (t.scope && !String(t.scope).split(' ').includes(GBP_SCOPE)) { await invalidate(userId,s); throw new GoogleError('auth','Reconnect Google Business Profile',401); }
    const result = await pool.query(`UPDATE gbp_grants SET access_token=$2,expires_at=$3,refresh_token=COALESCE($4,refresh_token),updated_at=now()
      WHERE user_id=$1 AND google_subject=$5 AND refresh_token=$6 AND reconnect_required=false RETURNING user_id`,
      [userId,t.access_token,new Date(Date.now()+Number(t.expires_in||3600)*1000),t.refresh_token||null,s,g.refresh_token]);
    if (!result.rowCount) throw new GoogleError('invalid','Google connection changed. Retry.',409);
    return t.access_token as string;
  })();
  refreshing.set(key,run);
  try { return await run; } finally { refreshing.delete(key); }
}
/** Google user data is kept only while a grant is usable (privacy policy §4 and retention). Location
 *  rows stay (the contractor edits them) and keep their resource names so a reconnect re-links them.
 *  With a subject, only the listings synced through that Google account are purged. */
export async function purgeGoogleData(userId: number, subject: string|null = null, db: { query: typeof pool.query } = pool) {
  const locs = `SELECT id FROM business_locations WHERE user_id=$1 AND ($2::text IS NULL OR gbp_google_subject=$2 OR gbp_google_subject IS NULL)`;
  await db.query(`DELETE FROM google_profile_reviews WHERE user_id=$1 AND google_review_id LIKE 'accounts/%/locations/%/reviews/%' AND location_id IN (${locs})`,[userId,subject]);
  await db.query(`DELETE FROM gbp_daily_metrics WHERE location_id IN (${locs})`,[userId,subject]);
  // Sync-status rows are ConstructHUB's own records (and carry the error users need to see); reset the backfill cursor only.
  await db.query(`UPDATE gbp_sync_status SET cursor_date=NULL,last_success=NULL WHERE location_id IN (${locs})`,[userId,subject]);
}
export async function invalidate(userId: number, subject: string|null = null) {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const {rowCount} = await c.query('UPDATE gbp_grants SET reconnect_required=true,access_token=NULL WHERE user_id=$1 AND ($2::text IS NULL OR google_subject=$2)',[userId,subject]);
    if (rowCount) await purgeGoogleData(userId, subject, c as any);
    await c.query('COMMIT');
  } catch (e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); }
}
