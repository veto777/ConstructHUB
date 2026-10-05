import type { NotificationKind } from './notification-kinds';
import type { Express, Request, Response, NextFunction } from 'express';
import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { TOTP } from 'otpauth';
import { pool } from './db';
import { rateLimit } from './growth-limits';
import { sendWithFallback } from './email';
import { logActivity, notifyUser } from './account-events';
import { decryptToken, encryptToken } from './gbp/token-crypto';

declare module 'express-session' { interface SessionData {
  recentAuth?: { userId: number; at: number };
  reauthEmail?: { userId: number; hash: string; expires: number; attempts: number };
  pending2FAExpires?: number;
} }
export const RECENT_AUTH_MS = 12 * 60 * 60 * 1000;
/** Can be used as middleware, or `if (!requireRecentAuth(req,res)) return`. */
export function requireRecentAuth(req: Request, res: Response, next?: NextFunction): boolean {
  if (!req.user) { res.status(401).json({ message: 'Not authenticated' }); return false; }
  const verification = req.session.recentAuth;
  if (!verification || verification.userId !== req.user.id || verification.at > Date.now() || Date.now() - verification.at >= RECENT_AUTH_MS) {
    res.status(403).json({ reauth: true, message: 'Please verify your identity to continue.' }); return false;
  }
  next?.(); return true;
}
export function markRecentAuth(req: Request, userId: number) { req.session.recentAuth = { userId, at: Date.now() }; }
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
/** "veto@gmail.com" -> "v***@gmail.com": names where a code went without printing the whole address. */
export const maskEmail = (email: unknown): string | null =>
  typeof email === 'string' && email.includes('@') ? email.replace(/^(.)[^@]*(@.*)$/, '$1***$2') : null;
export async function ensureAccountSecuritySchema() {
  await pool.query(`CREATE TABLE IF NOT EXISTS account_recovery_codes (
    user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE, code_hash text NOT NULL,
    PRIMARY KEY(user_id,code_hash));
    CREATE TABLE IF NOT EXISTS account_trusted_devices (
    id text PRIMARY KEY, user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash text NOT NULL, device text, created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL);
    CREATE INDEX IF NOT EXISTS account_trusted_devices_owner ON account_trusted_devices(user_id);`);
  const { rows } = await pool.query('SELECT id,totp_secret FROM users WHERE totp_secret IS NOT NULL');
  for (const row of rows) if (!row.totp_secret.startsWith('v1:')) {
    await pool.query('UPDATE users SET totp_secret=$1 WHERE id=$2 AND totp_secret=$3', [encryptToken(row.totp_secret), row.id, row.totp_secret]);
  } else decryptToken(row.totp_secret);
}
export function validTotp(secret: string, code: unknown): boolean {
  if (typeof code !== 'string' || !/^\d{6}$/.test(code)) return false;
  return new TOTP({ issuer: 'ConstructHUB', algorithm: 'SHA1', digits: 6, period: 30, secret: decryptToken(secret)! }).validate({ token: code, window: 1 }) !== null;
}
async function writeRecoveryCodes(connection: Pick<typeof pool, 'query'>, userId: number) {
  const codes = Array.from({ length: 10 }, () => randomBytes(8).toString('hex'));
  await connection.query('DELETE FROM account_recovery_codes WHERE user_id=$1', [userId]);
  for (const code of codes) await connection.query('INSERT INTO account_recovery_codes VALUES($1,$2)', [userId, hash(code)]);
  return codes;
}
export async function replaceRecoveryCodes(userId: number) {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [userId]);
    const codes = await writeRecoveryCodes(c, userId);
    await c.query('COMMIT');
    return codes;
  } catch(e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); }
}
/** Bind activation to the exact seed verified, and commit its recovery codes together. */
export async function activateTwoFactor(userId: number, verifiedSecret: string) {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const changed = await c.query(`UPDATE users SET totp_enabled=true
      WHERE id=$1 AND totp_enabled=false AND totp_secret=$2 RETURNING id`, [userId, verifiedSecret]);
    if (!changed.rowCount) { await c.query('ROLLBACK'); return null; }
    const codes = await writeRecoveryCodes(c, userId);
    await c.query('COMMIT');
    return codes;
  } catch(e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); }
}
export async function consumeRecoveryCode(userId: number, code: unknown) {
  if (typeof code !== 'string' || !/^[a-f0-9]{16}$/i.test(code)) return false;
  const result = await pool.query('DELETE FROM account_recovery_codes WHERE user_id=$1 AND code_hash=$2 RETURNING user_id', [userId, hash(code.toLowerCase())]);
  return result.rowCount === 1;
}
const COOKIE = 'constructhub_trusted_device';
function signature(value: string) {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error('SESSION_SECRET required for trusted devices');
  return createHmac('sha256', secret).update(value).digest('hex');
}
export async function rememberDevice(req: Request, res: Response, userId: number) {
  const id = randomBytes(16).toString('hex'), token = randomBytes(32).toString('hex');
  const value = `${id}.${token}`;
  await pool.query(`INSERT INTO account_trusted_devices(id,user_id,token_hash,device,expires_at) VALUES($1,$2,$3,$4,now()+interval '30 days')`, [id,userId,hash(token),String(req.headers['user-agent'] || '').slice(0,300)]);
  res.cookie(COOKIE, `${value}.${signature(value)}`, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', maxAge: 30*86400_000, path: '/' });
}
export async function trustedDevice(req: Request, userId: number): Promise<boolean> {
  const cookie = String(req.headers.cookie || '').split(';').map(s => s.trim()).find(s => s.startsWith(COOKIE+'='))?.slice(COOKIE.length+1);
  if (!cookie || !/^[a-f0-9]{32}\.[a-f0-9]{64}\.[a-f0-9]{64}$/.test(cookie)) return false;
  const [id,token,sig] = cookie.split('.');
  if (!timingSafeEqual(Buffer.from(signature(`${id}.${token}`)), Buffer.from(sig))) return false;
  const { rows } = await pool.query('SELECT id FROM account_trusted_devices WHERE id=$1 AND user_id=$2 AND token_hash=$3 AND expires_at>now()', [id,userId,hash(token)]);
  return rows.length === 1;
}
export async function revokeDevices(userId: number) { await pool.query('DELETE FROM account_trusted_devices WHERE user_id=$1', [userId]); }
export async function securityChanged(req: Request, userId: number, kind: NotificationKind, title: string) {
  await logActivity(req, userId, kind, { title });
  await notifyUser(userId,kind,{ title, link:'/settings?tab=security', actionUrl:'/settings?tab=security' });
}
export function registerAccountSecurityRoutes(app: Express, auth: (req: any,res: any)=>any) {
  // RecentAuthModal's prefill: which verification methods this account can use
  // (password / authenticator / emailed code, optional Google) so the dialog can offer them.
  app.get('/api/auth/reauth', async (req,res) => {
    const u=auth(req,res); if(!u) return;
    const {rows:[user]}=await pool.query('SELECT password_hash,totp_enabled,google_id,email FROM users WHERE id=$1',[u.id]);
    // google: an email-code account can also confirm through its linked Google sign-in.
    res.json({ method:user.totp_enabled?'totp':user.password_hash?'password':'email', google:!!user.google_id, email:maskEmail(user.email) });
  });
  // RecentAuthModal "Email a verification code": sends the 6-digit code; it lives in the session for 10 minutes, 5 attempts.
  app.post('/api/auth/reauth/email', rateLimit('security-email',3,10,15*60_000), async(req,res)=>{
    const u=auth(req,res); if(!u) return;
    const {rows:[user]}=await pool.query('SELECT email,password_hash,totp_enabled FROM users WHERE id=$1',[u.id]);
    if(user.password_hash || user.totp_enabled) return res.status(400).json({message:'Use your password or authenticator.'});
    const code=String(randomInt(100000,1000000));
    req.session.reauthEmail={userId:u.id,hash:hash(code),expires:Date.now()+10*60_000,attempts:0};
    await sendWithFallback({to:user.email,subject:'ConstructHUB verification code',text:`Your verification code is ${code}. It expires in 10 minutes.`,html:`<p>Your verification code is <strong>${code}</strong>. It expires in 10 minutes.</p>`});
    res.json({ok:true,sentTo:maskEmail(user.email)});
  });
  // RecentAuthModal "Verify and continue": checks password / TOTP / emailed code; on success marks the
  // session recently-authenticated so the guarded action proceeds.
  app.post('/api/auth/reauth', rateLimit('security-verify',10,30,15*60_000), async(req,res)=>{
    const u=auth(req,res); if(!u) return;
    const value=req.body?.value;
    if(typeof value!=='string' || value.length>256) return res.status(400).json({message:'Enter your verification.'});
    const {rows:[user]}=await pool.query('SELECT password_hash,totp_enabled,totp_secret FROM users WHERE id=$1',[u.id]);
    let valid=false;
    if(user.totp_enabled) valid=!!user.totp_secret && validTotp(user.totp_secret,value);
    else if(user.password_hash) valid=await bcrypt.compare(value,user.password_hash);
    else {
      const pending=req.session.reauthEmail;
      if(pending) { pending.attempts++; valid=pending.userId===u.id && pending.expires>Date.now() && pending.attempts<=5 && /^\d{6}$/.test(value) && timingSafeEqual(Buffer.from(pending.hash),Buffer.from(hash(value))); }
    }
    if(!valid) return res.status(401).json({message:'Verification failed. Please try again.'});
    delete req.session.reauthEmail; markRecentAuth(req,u.id);
    await logActivity(req,u.id,'security.reauthenticated'); res.json({ok:true});
  });
  // Me → Password & security "Remembered devices": the account's unexpired trusted-device rows
  // (30-day sign-in skips), newest first.
  app.get('/api/auth/devices',async(req,res)=>{
    const u=auth(req,res);if(!u)return;
    const {rows}=await pool.query('SELECT id,device,created_at,expires_at FROM account_trusted_devices WHERE user_id=$1 AND expires_at>now() ORDER BY created_at DESC',[u.id]);
    res.json({devices:rows});
  });
  // "Revoke device" on a remembered-device row: deletes that account_trusted_devices row (own
  // account only) and logs security.device_revoked.
  app.delete('/api/auth/devices/:id',async(req,res)=>{
    const u=auth(req,res);if(!u)return;
    if(!/^[a-f0-9]{32}$/.test(String(req.params.id))) return res.status(400).json({message:'Invalid device'});
    const removed = await pool.query('DELETE FROM account_trusted_devices WHERE id=$1 AND user_id=$2 RETURNING id',[req.params.id,u.id]);
    if (!removed.rowCount) return res.status(404).json({message:'Remembered device not found'});
    await logActivity(req,u.id,'security.device_revoked',{deviceId:req.params.id});res.json({ok:true});
  });
  // "Generate new recovery codes" while 2FA is on: replaces all 10 codes in one transaction
  // (recent identity check required) and logs security.recovery_codes_changed.
  app.post('/api/auth/2fa/recovery-codes',rateLimit('security-recovery',5,15),async(req,res)=>{
    const u=auth(req,res);if(!u || !requireRecentAuth(req,res))return;
    const {rows:[user]}=await pool.query('SELECT totp_enabled FROM users WHERE id=$1',[u.id]);
    if(!user.totp_enabled)return res.status(400).json({message:'Enable two-factor sign-in first.'});
    const codes = await replaceRecoveryCodes(u.id);
    await logActivity(req,u.id,'security.recovery_codes_changed');
    res.json({codes});
  });
}
