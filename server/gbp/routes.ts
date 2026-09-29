import type { Express, Request, Response } from 'express';
import { randomBytes } from 'crypto';
import { pool } from '../db';
import { oauthBaseUrl } from '../site-context';
import { GBP_SCOPE, GoogleError, METRICS } from './client';
import { grantStatus, saveGrant, invalidate, purgeGoogleData } from './grants';
import { clientFor, discover, importLocations, syncLocation, reply, publicError } from './service';
declare module 'express-session' { interface SessionData { gbpOAuth?: {state:string;userId:number;expires:number;redirect:string} } }
export function registerGbpRoutes(app: Express, auth: (req: any,res: any)=>any) {
  const route = (method: 'get'|'post'|'patch'|'delete',path: string,fn: (req: Request,res: Response,userId: number)=>Promise<any>) => {
    app[method](path,async(req,res)=>{const user=auth(req,res);if(!user)return;try {await fn(req,res,user.id);}catch(e){if(e instanceof GoogleError && e.kind==="auth") await invalidate(user.id);res.status(e instanceof GoogleError?e.status:500).json(publicError(e));}});
  };
  route('get','/api/gbp/connect',async(req,res,userId)=>{
    const redirect=`${oauthBaseUrl(req)}/api/gbp/callback`,state=randomBytes(32).toString('hex');
    req.session.gbpOAuth={state,userId,redirect,expires:Date.now()+10*60*1000};
    const q=new URLSearchParams({client_id:process.env.GOOGLE_CLIENT_ID!,redirect_uri:redirect,response_type:'code',scope:`openid email profile ${GBP_SCOPE}`,access_type:'offline',prompt:'consent',state});
    res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${q}`);
  });
  route('get','/api/gbp/callback',async(req,res,userId)=>{
    const pending=req.session.gbpOAuth; delete req.session.gbpOAuth;
    if(!pending || pending.userId!==userId || pending.expires<Date.now() || pending.state!==req.query.state || typeof req.query.code!=='string') return res.redirect('/locations?gbp=consent-failed');
    try {
      const response=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:process.env.GOOGLE_CLIENT_ID!,client_secret:process.env.GOOGLE_CLIENT_SECRET!,code:req.query.code,redirect_uri:pending.redirect,grant_type:'authorization_code'}),signal:AbortSignal.timeout(20000)});
      const tokens=await response.json();if(!response.ok) throw new Error('Token exchange failed');
      const identity=await fetch('https://openidconnect.googleapis.com/v1/userinfo',{headers:{Authorization:`Bearer ${tokens.access_token}`},signal:AbortSignal.timeout(20000)});
      if(!identity.ok) throw new Error('Identity verification failed');
      await saveGrant(userId,await identity.json(),tokens);
      res.redirect('/locations?gbp=connected');
    }catch {res.redirect('/locations?gbp=consent-failed');}
  });
  route('get','/api/gbp/status',async(_req,res,id)=>{
    const {rows:locations}=await pool.query(`SELECT l.id,l.business_name AS name,s.kind,s.last_success,s.last_attempt,s.last_error FROM business_locations l LEFT JOIN gbp_sync_status s ON s.location_id=l.id WHERE l.user_id=$1 AND l.gbp_location_name IS NOT NULL ORDER BY l.id,s.kind`,[id]);
    res.json({...await grantStatus(id),locations});
  });
  route('post','/api/gbp/disconnect',async(_req,res,id)=>{
    const c=await pool.connect();let grant:any;
    try {await c.query('BEGIN');({rows:[grant]}=await c.query('DELETE FROM gbp_grants WHERE user_id=$1 RETURNING refresh_token,access_token',[id]));await purgeGoogleData(id,c as any);await c.query('COMMIT');}
    catch(e){await c.query('ROLLBACK');throw e;} finally {c.release();}
    // Disconnect is immediate even if Google is unavailable. Report remote revocation failure.
    let revoked=true;
    if(grant?.refresh_token || grant?.access_token) {
      try { const r=await fetch('https://oauth2.googleapis.com/revoke',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({token:grant.refresh_token||grant.access_token}),signal:AbortSignal.timeout(20000)});revoked=r.ok; }
      catch {revoked=false;}
    }
    res.json({connected:false,revoked,message:revoked?'Disconnected':'Disconnected locally. Remove ConstructHUB access in your Google Account to finish revocation.'});
  });
  route('get','/api/gbp/accounts',async(_req,res,id)=>res.json({accounts:await clientFor(id).pages('accounts','/v1/accounts','accounts')}));
  route('get','/api/gbp/locations',async(_req,res,id)=>res.json(await discover(clientFor(id))));
  route('post','/api/gbp/import',async(req,res,id)=>res.json(await importLocations(id,req.body.locations)));
  route('post','/api/gbp/locations/:id/sync',async(req,res,id)=>res.json(await syncLocation(id,Number(req.params.id))));
  route('patch','/api/google-profile-reviews/:id/reply',async(req,res,id)=>res.json(await reply(id,Number(req.params.id),req.body.replyComment,req.body.action==='publish'?'publish':'draft')));
  route('delete','/api/google-profile-reviews/:id/reply',async(req,res,id)=>res.json(await reply(id,Number(req.params.id),'','delete')));
  route('get','/api/gbp/locations/:id/performance',async(req,res,userId)=>{
    const id=Number(req.params.id);
    const {rows:[l]}=await pool.query('SELECT id FROM business_locations WHERE id=$1 AND user_id=$2',[id,userId]);
    if(!l) throw new GoogleError('invalid','Location not found',404);
    const {rows}=await pool.query(`SELECT date::text,metric,value::text FROM gbp_daily_metrics WHERE location_id=$1 AND date>=current_date-90 ORDER BY date,metric`,[id]);
    res.json({source:'Google Business Profile Performance API',available:rows.length>0,metrics:METRICS,rows});
  });
}
