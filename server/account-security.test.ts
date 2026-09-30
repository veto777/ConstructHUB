import { beforeAll, afterAll, describe, it, expect, vi } from 'vitest';
import { pool } from './db';
import { encryptToken, decryptToken, ensureGbpTokenEncryption, tokenKey } from './gbp/token-crypto';
import { activateTwoFactor, ensureAccountSecuritySchema, requireRecentAuth, RECENT_AUTH_MS, replaceRecoveryCodes, consumeRecoveryCode, rememberDevice, trustedDevice, revokeDevices, registerAccountSecurityRoutes, validTotp } from './account-security';
import { ensureAccountEventsSchema } from './account-events';
import { TOTP } from 'otpauth';
import bcrypt from 'bcryptjs';
let id:number, other:number;
beforeAll(async()=>{
 const url=new URL(process.env.DATABASE_URL!);if(!['localhost','127.0.0.1'].includes(url.hostname)||!/^\/constructhub_dev(?:_a\d+)?$/.test(url.pathname))throw new Error('Requires a local development database');
 await ensureAccountSecuritySchema();await ensureAccountEventsSchema();
 const {rows}=await pool.query("INSERT INTO users(email) VALUES('security-'||gen_random_uuid()||'@example.invalid'),('security-'||gen_random_uuid()||'@example.invalid') RETURNING id");[id,other]=rows.map(r=>r.id);
});
afterAll(async()=>{await pool.query('DELETE FROM users WHERE id=ANY($1)',[[id,other]]);await pool.end();});
const response=()=>({status:vi.fn().mockReturnThis(),json:vi.fn(),cookie:vi.fn()});
describe('account security',()=>{
 it('encrypts with random IVs, round trips, and rejects tampering and missing production keys',()=>{
  const a=encryptToken('sensitive-token')!, b=encryptToken('sensitive-token');expect(a).not.toBe(b);expect(a).not.toContain('sensitive-token');expect(decryptToken(a)).toBe('sensitive-token');
  const parts=a.split(':');parts[3]=Buffer.from('tampered').toString('base64');expect(()=>decryptToken(parts.join(':'))).toThrow();expect(()=>decryptToken('plaintext')).toThrow();
  const old=process.env.GBP_TOKEN_KEY,env=process.env.NODE_ENV;try{delete process.env.GBP_TOKEN_KEY;process.env.NODE_ENV='production';expect(()=>tokenKey()).toThrow('required');process.env.GBP_TOKEN_KEY='bad';expect(()=>tokenKey()).toThrow('32 bytes');}finally{process.env.NODE_ENV=env;if(old)process.env.GBP_TOKEN_KEY=old;else delete process.env.GBP_TOKEN_KEY;}
 });
 it('migrates plaintext tokens once and transparently decrypts both',async()=>{
  await pool.query("INSERT INTO gbp_grants(user_id,google_subject,email,scopes,access_token,refresh_token) VALUES($1,'migration','fixture@example.invalid','{}','plain-access','plain-refresh')",[id]);
  await ensureGbpTokenEncryption();const first=(await pool.query('SELECT access_token,refresh_token FROM gbp_grants WHERE user_id=$1',[id])).rows[0];
  expect(decryptToken(first.access_token)).toBe('plain-access');expect(decryptToken(first.refresh_token)).toBe('plain-refresh');await ensureGbpTokenEncryption();expect((await pool.query('SELECT access_token,refresh_token FROM gbp_grants WHERE user_id=$1',[id])).rows[0]).toEqual(first);
 });
 it('migrates authenticator seeds idempotently and rejects unreadable stored seeds', async () => {
  await pool.query('UPDATE users SET totp_secret=$1 WHERE id=$2', ['JBSWY3DPEHPK3PXP', other]);
  await ensureAccountSecuritySchema();
  const first = (await pool.query('SELECT totp_secret FROM users WHERE id=$1', [other])).rows[0].totp_secret;
  expect(first).toMatch(/^v1:/); expect(decryptToken(first)).toBe('JBSWY3DPEHPK3PXP');
  await ensureAccountSecuritySchema();
  expect((await pool.query('SELECT totp_secret FROM users WHERE id=$1', [other])).rows[0].totp_secret).toBe(first);
  await pool.query('UPDATE users SET totp_secret=$1 WHERE id=$2', ['v1:invalid', other]);
  try { await expect(ensureAccountSecuritySchema()).rejects.toThrow(); }
  finally { await pool.query('UPDATE users SET totp_secret=NULL WHERE id=$1', [other]); }
 });
 it('gates absent, stale, future and cross-user verification, allowing a fresh session',()=>{
  for(const recentAuth of [undefined,{userId:id,at:Date.now()-RECENT_AUTH_MS},{userId:other,at:Date.now()},{userId:id,at:Date.now()+60000}]){const res=response();expect(requireRecentAuth({user:{id},session:{recentAuth}} as any,res as any)).toBe(false);expect(res.json).toHaveBeenCalledWith(expect.objectContaining({reauth:true}));}
  const next=vi.fn();expect(requireRecentAuth({user:{id},session:{recentAuth:{userId:id,at:Date.now()}}} as any,response() as any,next)).toBe(true);expect(next).toHaveBeenCalledOnce();
 });
 it('issues ten hashed recovery codes with atomic one-time consumption and owner isolation',async()=>{
  const codes=await replaceRecoveryCodes(id);expect(new Set(codes).size).toBe(10);const stored=(await pool.query('SELECT code_hash FROM account_recovery_codes WHERE user_id=$1',[id])).rows;expect(JSON.stringify(stored)).not.toContain(codes[0]);expect(await consumeRecoveryCode(other,codes[0])).toBe(false);
  expect((await Promise.all([consumeRecoveryCode(id,codes[0]),consumeRecoveryCode(id,codes[0])])).sort()).toEqual([false,true]);await replaceRecoveryCodes(id);expect(await consumeRecoveryCode(id,codes[1])).toBe(false);
 });
 it('signs remembered-device cookies, scopes them, expires and revokes them',async()=>{
  const req:any={headers:{'user-agent':'Security test'}},res=response();await rememberDevice(req,res as any,id);const [name,value,options]=res.cookie.mock.calls[0];expect(options).toMatchObject({httpOnly:true,sameSite:'lax',maxAge:30*86400_000});req.headers.cookie=`${name}=${value}`;
  expect(await trustedDevice(req,id)).toBe(true);expect(await trustedDevice(req,other)).toBe(false);expect(await trustedDevice({headers:{cookie:`${name}=${value.slice(0,-1)}${value.endsWith('0')?'1':'0'}`}} as any,id)).toBe(false);
  await pool.query("UPDATE account_trusted_devices SET expires_at=now()-interval '1 second' WHERE user_id=$1",[id]);expect(await trustedDevice(req,id)).toBe(false);
  await rememberDevice(req,res as any,id);await revokeDevices(id);expect((await pool.query('SELECT * FROM account_trusted_devices WHERE user_id=$1',[id])).rows).toHaveLength(0);
 });
 it('does not report another owner’s or an absent device as revoked', async () => {
  const handlers = new Map<string, any>(); const app: any = {};
  for (const method of ['get', 'post', 'delete']) app[method] = (path: string, ...fns: any[]) => handlers.set(`${method} ${path}`, fns.at(-1));
  registerAccountSecurityRoutes(app, req => req.user);
  const cookie = response(); await rememberDevice({ headers: {} } as any, cookie as any, other);
  const deviceId = cookie.cookie.mock.calls[0][1].split('.')[0];
  const req: any = { user: { id }, headers: {}, params: { id: deviceId } };
  const denied = response(); await handlers.get('delete /api/auth/devices/:id')(req, denied);
  expect(denied.status).toHaveBeenCalledWith(404);
  expect((await pool.query("SELECT id FROM account_activity WHERE user_id=$1 AND kind='security.device_revoked'", [id])).rowCount).toBe(0);
  req.user.id = other;
  const removed = response(); await handlers.get('delete /api/auth/devices/:id')(req, removed);
  expect(removed.json).toHaveBeenCalledWith({ ok: true });
  const absent = response(); await handlers.get('delete /api/auth/devices/:id')(req, absent);
  expect(absent.status).toHaveBeenCalledWith(404);
  expect((await pool.query("SELECT detail FROM account_activity WHERE user_id=$1 AND kind='security.device_revoked'", [other])).rows).toEqual([{ detail: { deviceId } }]);
 });
 it('verifies passwords and TOTP without allowing weaker verification when 2FA is enabled',async()=>{
  const handlers=new Map<string,any>();const app:any={};for(const method of ['get','post','delete'])app[method]=(path:string,...fns:any[])=>handlers.set(`${method} ${path}`,fns.at(-1));registerAccountSecurityRoutes(app,req=>req.user);
  const verify=handlers.get('post /api/auth/reauth'),req:any={user:{id},headers:{},session:{},body:{value:'fixture-password'}};
  await pool.query('UPDATE users SET password_hash=$1 WHERE id=$2',[await bcrypt.hash('fixture-password',4),id]);await verify(req,response());expect(req.session.recentAuth.userId).toBe(id);
  const totp=new TOTP({secret:'JBSWY3DPEHPK3PXP'});await pool.query('UPDATE users SET totp_enabled=true,totp_secret=$1 WHERE id=$2',[encryptToken('JBSWY3DPEHPK3PXP'),id]);delete req.session.recentAuth;const bad=response();await verify(req,bad);expect(bad.status).toHaveBeenCalledWith(401);expect(req.session.recentAuth).toBeUndefined();
  req.body.value=totp.generate();await verify(req,response());expect(req.session.recentAuth.userId).toBe(id);expect(validTotp(encryptToken('JBSWY3DPEHPK3PXP')!,req.body.value)).toBe(true);
 });
});

describe('authenticator enrollment identity gate', () => {
 it('rejects replaced seeds and concurrent activation without replacing issued recovery codes', async () => {
  const oldSeed = encryptToken('JBSWY3DPEHPK3PXP')!;
  const newSeed = encryptToken('JBSWY3DPEHPK3PXP')!;
  await pool.query('UPDATE users SET totp_enabled=false,totp_secret=$1 WHERE id=$2', [newSeed, other]);
  expect(await activateTwoFactor(other, oldSeed)).toBeNull();
  const results = await Promise.all([activateTwoFactor(other, newSeed), activateTwoFactor(other, newSeed)]);
  expect(results.filter(Boolean)).toHaveLength(1);
  const codes = results.find(Boolean)!;
  expect(codes).toHaveLength(10);
  for (const code of codes) expect(await consumeRecoveryCode(other, code)).toBe(true);
  await pool.query('UPDATE users SET totp_enabled=false,totp_secret=NULL WHERE id=$1', [other]);
 });
 it('blocks stale enrollment and activation before generating or accepting an attacker seed', async () => {
  const express = (await import('express')).default;
  const { setupAuth } = await import('./auth');
  const app = express(); await setupAuth(app);
  const route = (path: string) => (app.router as any).stack.find((l: any) => l.route?.path === path).route.stack.at(-1).handle;
  await pool.query('UPDATE users SET totp_enabled=false,totp_secret=NULL WHERE id=$1', [other]);
  const req: any = { user: { id: other }, isAuthenticated: () => true, headers: {}, session: {}, body: {} };
  const stale = response();
  await route('/api/auth/2fa/setup')(req, stale);
  expect(stale.status).toHaveBeenCalledWith(403);
  expect(stale.json).toHaveBeenCalledWith(expect.objectContaining({ reauth: true }));
  expect((await pool.query('SELECT totp_secret FROM users WHERE id=$1', [other])).rows[0].totp_secret).toBeNull();
  req.session.recentAuth = { userId: other, at: Date.now() };
  const setup = response(); await route('/api/auth/2fa/setup')(req, setup);
  const secret = setup.json.mock.calls[0][0].secret;
  expect(secret).toBeTruthy();
  req.body.code = new TOTP({ secret }).generate();
  delete req.session.recentAuth;
  const activation = response(); await route('/api/auth/2fa/verify')(req, activation);
  expect(activation.status).toHaveBeenCalledWith(403);
  expect((await pool.query('SELECT totp_enabled FROM users WHERE id=$1', [other])).rows[0].totp_enabled).toBe(false);
  await pool.query('UPDATE users SET totp_secret=NULL WHERE id=$1', [other]);
 });
});

describe('Google-only verification and Google second-factor gate',()=>{
 it('emails a short-lived code only to a Google-only owner and consumes it',async()=>{
  const {readFile}=await import('node:fs/promises');
  const handlers=new Map<string,any>();const app:any={};for(const method of ['get','post','delete'])app[method]=(path:string,...fns:any[])=>handlers.set(`${method} ${path}`,fns.at(-1));registerAccountSecurityRoutes(app,req=>req.user);
  const req:any={user:{id:other},headers:{},session:{},body:{}};
  await handlers.get('post /api/auth/reauth/email')(req,response());
  const {rows:[user]}=await pool.query('SELECT email FROM users WHERE id=$1',[other]);
  const lines=(await readFile('tmp/email-outbox.jsonl','utf8')).trim().split('\n').map(l=>JSON.parse(l));
  const mail=lines.filter(l=>JSON.stringify(l.to).includes(user.email)).at(-1);expect(mail).toBeTruthy();
  const code=JSON.stringify(mail).match(/verification code is (\d{6})/)?.[1];expect(code).toBeTruthy();expect(req.session.reauthEmail.hash).not.toBe(code);
  req.body.value='incorrect';const bad=response();await handlers.get('post /api/auth/reauth')(req,bad);expect(bad.status).toHaveBeenCalledWith(401);
  req.body.value=code;await handlers.get('post /api/auth/reauth')(req,response());expect(req.session.recentAuth.userId).toBe(other);expect(req.session.reauthEmail).toBeUndefined();
  delete req.session.recentAuth;const replay=response();await handlers.get('post /api/auth/reauth')(req,replay);expect(replay.status).toHaveBeenCalledWith(401);
 });
 it('rejects expired, exhausted and cross-owner email codes without fresh authentication', async () => {
  const { createHash } = await import('node:crypto');
  const handlers = new Map<string, any>(); const app: any = {};
  for (const method of ['get', 'post', 'delete']) app[method] = (path: string, ...fns: any[]) => handlers.set(`${method} ${path}`, fns.at(-1));
  registerAccountSecurityRoutes(app, req => req.user);
  for (const fields of [{ expires: Date.now() - 1 }, { attempts: 5 }, { userId: id }]) {
   const req: any = { user: { id: other }, headers: {}, body: { value: '123456' }, session: { reauthEmail: { userId: other, hash: createHash('sha256').update('123456').digest('hex'), expires: Date.now() + 60000, attempts: 0, ...fields } } };
   const denied = response(); await handlers.get('post /api/auth/reauth')(req, denied);
   expect(denied.status).toHaveBeenCalledWith(401);
   expect(req.session.recentAuth).toBeUndefined();
  }
 });
 it('records account sign-out before acknowledging it', async () => {
  const express = (await import('express')).default;
  const { setupAuth } = await import('./auth');
  const app = express(); await setupAuth(app);
  const handler = (app.router as any).stack.find((l: any) => l.route?.path === '/api/auth/logout').route.stack.at(-1).handle;
  const req: any = { user: { id: other }, isAuthenticated: () => true, headers: { 'user-agent': 'Logout fixture' }, ip: '192.0.2.2', logout: (done: any) => done(), session: { destroy: (done: any) => done() } };
  await new Promise<void>(resolve => handler(req, { json: (body: any) => { expect(body).toEqual({ ok: true }); resolve(); } }));
  expect((await pool.query("SELECT ip,user_agent FROM account_activity WHERE user_id=$1 AND kind='auth.logout'", [other])).rows).toEqual([{ ip: '192.0.2.2', user_agent: 'Logout fixture' }]);
 });
 it('rejects expired second-factor login challenges', async () => {
  const express = (await import('express')).default;
  const { setupAuth } = await import('./auth');
  const app = express(); await setupAuth(app);
  const handler = (app.router as any).stack.find((l: any) => l.route?.path === '/api/auth/2fa/login').route.stack.at(-1).handle;
  const req: any = { body: { code: new TOTP({ secret: 'JBSWY3DPEHPK3PXP' }).generate() }, session: { pending2FAUserId: id, pending2FAExpires: Date.now() - 1 }, login: vi.fn() };
  const denied = response(); await handler(req, denied);
  expect(denied.status).toHaveBeenCalledWith(400); expect(req.login).not.toHaveBeenCalled();
 });
 it('email verification cannot bypass enabled 2FA and its link is single-use', async () => {
  const express = (await import('express')).default;
  const { setupAuth } = await import('./auth');
  const app = express(); await setupAuth(app);
  const handler = (app.router as any).stack.find((l: any) => l.route?.path === '/api/auth/verify-email').route.stack.at(-1).handle;
  const token = 'audit-email-' + id;
  await pool.query("UPDATE users SET verification_token=$1,verification_expiry=timezone('UTC',now())+interval '1 hour' WHERE id=$2", [token, id]);
  const req: any = { query: { token }, session: {}, login: vi.fn(), logout: vi.fn((_options: any, done: any) => done()) };
  const res: any = { redirect: vi.fn() };
  await handler(req, res);
  expect(req.login).not.toHaveBeenCalled();
  expect(req.session.pending2FAUserId).toBe(id);
  expect(res.redirect).toHaveBeenCalledWith('/auth?mode=2fa');
  res.redirect.mockClear(); await handler(req, res);
  expect(res.redirect).toHaveBeenCalledWith('/auth?error=invalid-token');
 });
 it('Google callback removes the authenticated session until second-factor verification, and honors revocation',async()=>{
  const express=(await import('express')).default;const {setupAuth}=await import('./auth');const app=express();await setupAuth(app);
  const layer=app.router.stack.find((l:any)=>l.route?.path==='/api/auth/google/callback');const callback=layer.route.stack.at(-1).handle;
  const req:any={user:{id},headers:{},session:{},logout:vi.fn((_options:any,done:any)=>done())};const res:any={redirect:vi.fn()};
  await callback(req,res);expect(req.logout).toHaveBeenCalled();expect(req.session.pending2FAUserId).toBe(id);expect(res.redirect).toHaveBeenCalledWith('/auth?mode=2fa');
  const cookieRes=response();await rememberDevice(req,cookieRes as any,id);const [name,value]=cookieRes.cookie.mock.calls[0];req.headers.cookie=`${name}=${value}`;req.logout.mockClear();res.redirect.mockClear();req.session={};
  await callback(req,res);expect(req.logout).not.toHaveBeenCalled();expect(res.redirect).toHaveBeenCalledWith('/?auth=success');
  await revokeDevices(id);res.redirect.mockClear();await callback(req,res);expect(res.redirect).toHaveBeenCalledWith('/auth?mode=2fa');
 });
});

describe('password changes', () => {
 it('rejects the wrong password, saves the replacement, revokes remembered devices, and logs the change', async () => {
  const express = (await import('express')).default;
  const { setupAuth } = await import('./auth');
  const app = express(); await setupAuth(app);
  const handler = (app.router as any).stack.find((l: any) => l.route?.path === '/api/auth/change-password').route.stack.at(-1).handle;
  await pool.query('UPDATE users SET password_hash=$1 WHERE id=$2', [await bcrypt.hash('Current-fixture-password', 4), id]);
  const req: any = { user: { id }, isAuthenticated: () => true, headers: {}, body: { currentPassword: 'wrong-password', newPassword: 'Replacement-fixture-password' } };
  const denied = response(); await handler(req, denied); expect(denied.status).toHaveBeenCalledWith(400);
  await rememberDevice(req, response() as any, id);
  req.body.currentPassword = 'Current-fixture-password';
  const changed = response(); await handler(req, changed); expect(changed.json).toHaveBeenCalledWith({ ok: true });
  const stored = (await pool.query('SELECT password_hash FROM users WHERE id=$1', [id])).rows[0].password_hash;
  expect(await bcrypt.compare('Replacement-fixture-password', stored)).toBe(true);
  expect((await pool.query('SELECT id FROM account_trusted_devices WHERE user_id=$1', [id])).rowCount).toBe(0);
  expect((await pool.query("SELECT id FROM account_activity WHERE user_id=$1 AND kind='security.password_changed'", [id])).rowCount).toBe(1);
 });
});
