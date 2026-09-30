import { requireRecentAuth } from '../account-security';
import { notifyUser, logActivity } from '../account-events';
import { decryptToken } from './token-crypto';
import { rateLimit } from '../growth-limits';
async function connectionAlert(req: Request, userId: number, kind: 'google.connected'|'google.disconnected', grant: { email: string; sub?: string; google_subject?: string }) {
  const subject=grant.sub || grant.google_subject || '';
  const detail={ email:grant.email, subject, time:new Date().toISOString(), ip:req.ip || 'Unknown', device:String(req.headers['user-agent'] || 'Unknown').slice(0,300) };
  const link=`/settings?tab=security&google=${encodeURIComponent(subject)}`;
  await logActivity(req,userId,kind,detail);
  await notifyUser(userId,kind,{title:kind==='google.connected'?'Google account connected':'Google account disconnected',body:`${detail.email}\nTime: ${detail.time}\nIP: ${detail.ip}\nDevice: ${detail.device}`,link,actionLabel:"Wasn't you?",actionUrl:link});
}
import type { Express, Request, Response } from 'express';
import { randomBytes } from 'crypto';
import { pool } from '../db';
import { oauthBaseUrl } from '../site-context';
import { GBP_SCOPE, GoogleError, METRICS } from './client';
import { grantStatus, saveGrant, purgeGoogleData } from './grants';
import { discoverAll, importLocations, syncLocation, reply, publicError, autoLinkAndSync, unlinkLocation } from './service';
declare module 'express-session' { interface SessionData { gbpOAuth?: {state:string;userId:number;expires:number;redirect:string} } }
export function registerGbpRoutes(app: Express, auth: (req: any,res: any)=>any, options: { http?: typeof fetch; afterConnect?: (userId: number, subject: string) => Promise<unknown> } = {}) {
  app.use(['/api/gbp/connect', '/api/gbp/disconnect'], rateLimit('google-connections',10,30));
  const route = (method: 'get'|'post'|'patch'|'delete',path: string,fn: (req: Request,res: Response,userId: number)=>Promise<any>) => {
    // Grants are invalidated per Google account where the failure happened (grants/service), never all at once here.
    app[method](path,async(req,res)=>{const user=auth(req,res);if(!user)return;try {await fn(req,res,user.id);}catch(e){res.status(e instanceof GoogleError?e.status:500).json(publicError(e));}});
  };
  route('get','/api/gbp/connect',async(req,res,userId)=>{
    if (!requireRecentAuth(req,res)) return;
    const redirect=`${oauthBaseUrl(req)}/api/gbp/callback`,state=randomBytes(32).toString('hex');
    req.session.gbpOAuth={state,userId,redirect,expires:Date.now()+10*60*1000};
    const q=new URLSearchParams({client_id:process.env.GOOGLE_CLIENT_ID!,redirect_uri:redirect,response_type:'code',scope:`openid email profile ${GBP_SCOPE}`,access_type:'offline',prompt:'consent select_account',state});
    const url=`https://accounts.google.com/o/oauth2/v2/auth?${q}`;
    if(req.query.format==='json') return res.json({url});
    res.redirect(url);
  });
  route('get','/api/gbp/callback',async(req,res,userId)=>{
    const pending=req.session.gbpOAuth; delete req.session.gbpOAuth;
    if(!pending || pending.userId!==userId || pending.expires<Date.now() || pending.state!==req.query.state || typeof req.query.code!=='string') return res.redirect('/locations?gbp=consent-failed');
    try {
      const response=await (options.http ?? fetch)('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:process.env.GOOGLE_CLIENT_ID!,client_secret:process.env.GOOGLE_CLIENT_SECRET!,code:req.query.code,redirect_uri:pending.redirect,grant_type:'authorization_code'}),signal:AbortSignal.timeout(20000)});
      const tokens=await response.json();if(!response.ok) throw new Error('Token exchange failed');
      const identity=await (options.http ?? fetch)('https://openidconnect.googleapis.com/v1/userinfo',{headers:{Authorization:`Bearer ${tokens.access_token}`},signal:AbortSignal.timeout(20000)});
      if(!identity.ok) throw new Error('Identity verification failed');
      const who=await identity.json();
      await saveGrant(userId,who,tokens);
      await connectionAlert(req,userId,'google.connected',who);
      // Fill the Locations pages without further clicks; failures show per location in sync status.
      void (options.afterConnect ?? autoLinkAndSync)(userId,who.sub).catch(()=>console.error('GBP auto-link after connect failed'));
      res.redirect('/locations?gbp=connected');
    }catch {res.redirect('/locations?gbp=consent-failed');}
  });
  route('get','/api/gbp/status',async(_req,res,id)=>{
    const {rows:locations}=await pool.query(`SELECT l.id,l.business_name AS name,g.email AS account_email,s.kind,s.last_success,s.last_attempt,s.last_error FROM business_locations l
      LEFT JOIN gbp_grants g ON g.user_id=l.user_id AND g.google_subject=l.gbp_google_subject
      LEFT JOIN gbp_sync_status s ON s.location_id=l.id WHERE l.user_id=$1 AND l.gbp_location_name IS NOT NULL ORDER BY l.id,s.kind`,[id]);
    res.json({...await grantStatus(id),locations});
  });
  route('post','/api/gbp/disconnect',async(req,res,id)=>{
    if (!requireRecentAuth(req,res)) return;
    if (req.body?.subject !== undefined && (typeof req.body.subject !== 'string' || !req.body.subject.length || req.body.subject.length>255)) return res.status(400).json({message:'Invalid Google account'});
    // With a subject, disconnect that one Google account (and purge only its listings' Google data); without, all.
    const subject=typeof req.body?.subject==='string'?req.body.subject:null;
    const c=await pool.connect();let grants:any[]=[];
    try {await c.query('BEGIN');({rows:grants}=await c.query('DELETE FROM gbp_grants WHERE user_id=$1 AND ($2::text IS NULL OR google_subject=$2) RETURNING refresh_token,access_token,email,google_subject',[id,subject]));await purgeGoogleData(id,subject,c as any);await c.query('COMMIT');}
    catch(e){await c.query('ROLLBACK');throw e;} finally {c.release();}
    // Disconnect is immediate even if Google is unavailable. Report remote revocation failure.
    let revoked=true;
    for(const grant of grants) if(grant?.refresh_token || grant?.access_token) {
      try { const r=await (options.http ?? fetch)('https://oauth2.googleapis.com/revoke',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({token:decryptToken(grant.refresh_token||grant.access_token)!}),signal:AbortSignal.timeout(20000)});revoked=revoked&&r.ok; }
      catch {revoked=false;}
    }
    for (const grant of grants) await connectionAlert(req,id,'google.disconnected',grant);
    res.json({...await grantStatus(id),revoked,message:revoked?'Disconnected':'Disconnected locally. Remove ConstructHUB access in your Google Account to finish revocation.'});
  });
  route('get','/api/gbp/accounts',async(_req,res,id)=>res.json({accounts:(await discoverAll(id)).accounts}));
  route('get','/api/gbp/locations',async(_req,res,id)=>res.json(await discoverAll(id)));
  // Per-location answer to "which Google account is this synced through, and which still need one?"
  route('get','/api/gbp/linkage',async(_req,res,id)=>{
    const {rows:locations}=await pool.query(`SELECT l.id,l.place_id,l.gbp_location_name,l.gbp_unlinked_by_user,g.email AS account_email,(g.google_subject IS NOT NULL AND NOT g.reconnect_required) AS account_ok,
      (SELECT max(last_success) FROM gbp_sync_status s WHERE s.location_id=l.id) AS last_success,
      (SELECT string_agg(last_error,'; ') FROM gbp_sync_status s WHERE s.location_id=l.id AND last_error IS NOT NULL) AS last_error
      FROM business_locations l LEFT JOIN gbp_grants g ON g.user_id=l.user_id AND g.google_subject=l.gbp_google_subject WHERE l.user_id=$1 ORDER BY l.id`,[id]);
    const status=await grantStatus(id);
    let found:any[]=[],errors:any[]=[];
    if(status.connected && locations.some(l=>!l.gbp_location_name)) ({locations:found,errors}=await discoverAll(id));
    res.json({accounts:status.accounts,errors,locations:locations.map(l=>{
      if(l.gbp_location_name) return {id:l.id,state:l.account_ok?'synced':'reconnect',accountEmail:l.account_email,lastSuccess:l.last_success,lastError:l.last_error};
      const match=l.place_id?found.find((f:any)=>f.placeId===l.place_id):null;
      return match?{id:l.id,state:'available',unlinkedByUser:l.gbp_unlinked_by_user,accountEmail:match.grantEmail,listing:{accountResource:match.accountResource,gbpName:match.gbpName,grantSubject:match.grantSubject}}
        :{id:l.id,state:'unlinked'};
    })});
  });
  route('post','/api/gbp/import',async(req,res,id)=>{
    const result=await importLocations(id,req.body.locations);
    // Linking = a full first sync (profile, reviews, performance) before answering.
    const synced:Record<number,unknown>={};
    for(const l of result.locations) synced[l.id]=await syncLocation(id,l.id).catch(e=>publicError(e));
    res.json({...result,synced});
  });
  route('post','/api/gbp/locations/:id/unlink',async(req,res,id)=>res.json(await unlinkLocation(id,Number(req.params.id))));
  route('post','/api/gbp/locations/:id/sync',async(req,res,id)=>res.json(await syncLocation(id,Number(req.params.id))));
  route('patch','/api/google-profile-reviews/:id/reply',async(req,res,id)=>res.json(await reply(id,Number(req.params.id),req.body.replyComment,req.body.action==='publish'?'publish':'draft',undefined,{req})));
  route('delete','/api/google-profile-reviews/:id/reply',async(req,res,id)=>res.json(await reply(id,Number(req.params.id),'','delete',undefined,{req})));
  route('get','/api/gbp/locations/:id/performance',async(req,res,userId)=>{
    const id=Number(req.params.id);
    const {rows:[l]}=await pool.query('SELECT id FROM business_locations WHERE id=$1 AND user_id=$2',[id,userId]);
    if(!l) throw new GoogleError('invalid','Location not found',404);
    const {rows}=await pool.query(`SELECT date::text,metric,value::text FROM gbp_daily_metrics WHERE location_id=$1 AND date>=current_date-90 ORDER BY date,metric`,[id]);
    res.json({source:'Google Business Profile Performance API',available:rows.length>0,metrics:METRICS,rows});
  });
}
