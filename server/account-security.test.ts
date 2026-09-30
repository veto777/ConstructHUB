import { beforeAll, afterAll, describe, it, expect, vi } from 'vitest';
import { pool } from './db';
import { encryptToken, decryptToken, ensureGbpTokenEncryption, tokenKey } from './gbp/token-crypto';
import { ensureAccountSecuritySchema, requireRecentAuth, RECENT_AUTH_MS, replaceRecoveryCodes, consumeRecoveryCode, rememberDevice, trustedDevice, revokeDevices, registerAccountSecurityRoutes, validTotp } from './account-security';
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
 it('verifies passwords and TOTP without allowing weaker verification when 2FA is enabled',async()=>{
  const handlers=new Map<string,any>();const app:any={};for(const method of ['get','post','delete'])app[method]=(path:string,...fns:any[])=>handlers.set(`${method} ${path}`,fns.at(-1));registerAccountSecurityRoutes(app,req=>req.user);
  const verify=handlers.get('post /api/auth/reauth'),req:any={user:{id},headers:{},session:{},body:{value:'fixture-password'}};
  await pool.query('UPDATE users SET password_hash=$1 WHERE id=$2',[await bcrypt.hash('fixture-password',4),id]);await verify(req,response());expect(req.session.recentAuth.userId).toBe(id);
  const totp=new TOTP({secret:'JBSWY3DPEHPK3PXP'});await pool.query('UPDATE users SET totp_enabled=true,totp_secret=$1 WHERE id=$2',[encryptToken('JBSWY3DPEHPK3PXP'),id]);delete req.session.recentAuth;const bad=response();await verify(req,bad);expect(bad.status).toHaveBeenCalledWith(401);expect(req.session.recentAuth).toBeUndefined();
  req.body.value=totp.generate();await verify(req,response());expect(req.session.recentAuth.userId).toBe(id);expect(validTotp(encryptToken('JBSWY3DPEHPK3PXP')!,req.body.value)).toBe(true);
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
