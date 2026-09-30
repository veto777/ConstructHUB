import { z } from 'zod';
import { filters, listLocations, accessFor, locationAccess }  from '../agency/access';
import { queueSync } from '../agency/jobs';
import { importVerifiedLocations } from './service';
import { requireRecentAuth, RECENT_AUTH_MS } from '../account-security';
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
  const recentlyVerified = (req: Request) => { const v=req.session?.recentAuth,u=req.user as any; return !!u && !!v && v.userId===u.id && v.at<=Date.now() && Date.now()-v.at<RECENT_AUTH_MS; };
  const route = (method: 'get'|'post'|'patch'|'delete',path: string,fn: (req: Request,res: Response,userId: number)=>Promise<any>) => {
    // Grants are invalidated per Google account where the failure happened (grants/service), never all at once here.
    app[method](path,async(req,res)=>{const user=auth(req,res);if(!user)return;try {await fn(req,res,user.id);}catch(e){res.status(e instanceof GoogleError?e.status:500).json(publicError(e));}});
  };
  route('get','/api/gbp/connect',async(req,res,userId)=>{
    // A browser navigation (middle-click, new tab, typed URL, /api/auth/google?gbp=1) cannot answer the JSON
    // re-auth challenge; send it to Locations, which asks for verification and then restarts this connect.
    if (req.query.format!=='json' && !recentlyVerified(req) && (req.headers?.['sec-fetch-mode']==='navigate' || req.accepts?.(['json','html'])==='html')) return res.redirect('/locations?gbp=reauth');
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
      void (options.afterConnect ?? (async(userId:number,subject:string)=>{await pool.query(`INSERT INTO agency_poll_grants(user_id,subject,next_at,refresh_requested) VALUES($1,$2,now(),true) ON CONFLICT(user_id,subject) DO UPDATE SET next_at=now(),refresh_requested=true`,[userId,subject]);}))(userId,who.sub).catch(()=>console.error('GBP discovery queue failed'));
      res.redirect('/locations?gbp=connected');
    }catch {res.redirect('/locations?gbp=consent-failed');}
  });
  route('get','/api/gbp/status',async(_req,res,id)=>{
    const visible=_req.query.locationId ? {items:[await locationAccess(await accessFor(id),z.coerce.number().int().positive().parse(_req.query.locationId))]} : await listLocations(await accessFor(id),filters.parse(_req.query));
    const {rows:locations}=await pool.query(`SELECT l.id,l.business_name AS name,g.email AS account_email,s.kind,s.last_success,s.last_attempt,s.last_error FROM business_locations l
      LEFT JOIN gbp_grants g ON g.user_id=l.user_id AND g.google_subject=l.gbp_google_subject
      LEFT JOIN gbp_sync_status s ON s.location_id=l.id WHERE l.user_id=$1 AND l.gbp_location_name IS NOT NULL AND l.id=ANY($2::int[]) ORDER BY l.id,s.kind`,[id,visible.items.map(l=>l.id)]);
    res.json({...await grantStatus(id),locations});
  });
  route('post','/api/gbp/disconnect',async(req,res,id)=>{
    if (!requireRecentAuth(req,res)) return;
    if (req.body?.subject !== undefined && (typeof req.body.subject !== 'string' || !req.body.subject.length || req.body.subject.length>255)) return res.status(400).json({message:'Invalid Google account'});
    // With a subject, disconnect that one Google account (and purge only its listings' Google data); without, all.
    const subject=typeof req.body?.subject==='string'?req.body.subject:null;
    const c=await pool.connect();let grants:any[]=[];
    try {await c.query('BEGIN');({rows:grants}=await c.query('DELETE FROM gbp_grants WHERE user_id=$1 AND ($2::text IS NULL OR google_subject=$2) RETURNING refresh_token,access_token,email,google_subject',[id,subject]));
      // An unknown subject matched nothing: never purge (purgeGoogleData also covers unlinked legacy locations) or report success.
      if(subject!==null&&!grants.length){await c.query('ROLLBACK');return res.status(404).json({message:'That Google account is not connected'});}
      await purgeGoogleData(id,subject,c as any);await c.query('COMMIT');}
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
  const cached=async(req:Request,res:Response,id:number)=>{
    const status=await grantStatus(id);if(!status.connected)throw new GoogleError('auth','Google Business Profile not connected',401);
    const f=filters.parse(req.query);
    const {rows}=await pool.query(`SELECT d.*,g.email FROM agency_discovery d JOIN gbp_grants g ON g.user_id=d.user_id AND g.google_subject=d.subject AND NOT g.reconnect_required WHERE d.user_id=$1 AND d.data->>'businessName' ILIKE $2 ORDER BY d.subject,d.account,d.location LIMIT 50 OFFSET $3`,[id,`%${f.q}%`,f.offset]);
    res.json({accounts:status.accounts,locations:rows.map(r=>({...r.data,grantSubject:r.subject,grantEmail:r.email})),errors:[],cached:true});
  };
  route('get','/api/gbp/accounts',cached);
  route('get','/api/gbp/locations',cached);
  // Per-location answer to "which Google account is this synced through, and which still need one?"
  route('get','/api/gbp/linkage',async(req,res,id)=>{
    const page=await listLocations(await accessFor(id),filters.parse(req.query));
    const {rows:locations}=await pool.query(`SELECT l.id,l.place_id,l.gbp_location_name,l.gbp_unlinked_by_user,g.email AS account_email,(g.google_subject IS NOT NULL AND NOT g.reconnect_required) AS account_ok,
      (SELECT max(last_success) FROM gbp_sync_status s WHERE s.location_id=l.id) AS last_success,
      (SELECT string_agg(last_error,'; ') FROM gbp_sync_status s WHERE s.location_id=l.id AND last_error IS NOT NULL) AS last_error
      FROM business_locations l LEFT JOIN gbp_grants g ON g.user_id=l.user_id AND g.google_subject=l.gbp_google_subject WHERE l.user_id=$1 AND l.id=ANY($2::int[]) ORDER BY l.id`,[id,page.items.map(l=>l.id)]);
    const {rows:found}=await pool.query(`SELECT d.data,d.subject,g.email FROM agency_discovery d JOIN gbp_grants g ON g.user_id=d.user_id AND g.google_subject=d.subject AND NOT g.reconnect_required WHERE d.user_id=$1 AND d.seen_at>now()-interval '24 hours' AND d.data->>'placeId'=ANY($2::text[])`,[id,locations.map(l=>l.place_id).filter(Boolean)]);
    res.json({accounts:(await grantStatus(id)).accounts,errors:[],total:page.total,locations:locations.map(l=>{
      if(l.gbp_location_name)return {id:l.id,state:l.account_ok?'synced':'reconnect',accountEmail:l.account_email,lastSuccess:l.last_success,lastError:l.last_error};
      const match=found.find(f=>f.data.placeId===l.place_id);
      return match?{id:l.id,state:'available',unlinkedByUser:l.gbp_unlinked_by_user,accountEmail:match.email,listing:{accountResource:match.data.accountResource,gbpName:match.data.gbpName,grantSubject:match.subject}}:{id:l.id,state:'unlinked'};
    })});
  });
  route('post','/api/gbp/import',async(req,res,id)=>{
    if(!(await grantStatus(id)).connected)throw new GoogleError('auth','Google Business Profile not connected',401);
    const requested=z.array(z.object({accountResource:z.string().max(300),gbpName:z.string().max(300),grantSubject:z.string().max(255)})).min(1).max(100).safeParse(req.body.locations);
    if(!requested.success)return res.status(400).json({message:'Select 1–100 valid listings'});
    const {rows:cached}=await pool.query(`SELECT d.* FROM agency_discovery d JOIN gbp_grants g ON g.user_id=d.user_id AND g.google_subject=d.subject AND NOT g.reconnect_required WHERE d.user_id=$1 AND d.location=ANY($2::text[]) AND d.seen_at>now()-interval '24 hours'`,[id,requested.data.map(r=>r.gbpName)]);
    const selected=requested.data.map(r=>{const c=cached.find(c=>c.account===r.accountResource&&c.location===r.gbpName&&c.subject===r.grantSubject);if(!c)throw new GoogleError('invalid','Refresh Google listings from Agency settings before importing',409);return {...c.data,grantSubject:c.subject};});
    const result=await importVerifiedLocations(id,selected);for(const l of result.locations)await queueSync(id,l.id);
    res.status(202).json({...result,queued:true,synced:{}});
  });
  route('get','/api/gbp/locations/:id/media',async(req,res,userId)=>{
    const id=Number(req.params.id),source=req.query.source==='customer'?'customer':'business';
    const {rows:[l]}=await pool.query('SELECT id FROM business_locations WHERE id=$1 AND user_id=$2',[id,userId]);
    if(!l) throw new GoogleError('invalid','Location not found',404);
    const limit=Math.min(Math.max(Number(req.query.limit)||60,1),600),offset=Math.max(Number(req.query.offset)||0,0);
    const {rows}=await pool.query(`SELECT name,media_format,category,google_url,thumbnail_url,width,height,description,attribution,create_time FROM gbp_media
      WHERE location_id=$1 AND source=$2 ORDER BY create_time DESC NULLS LAST LIMIT $3 OFFSET $4`,[id,source,limit,offset]);
    const {rows:[t]}=await pool.query('SELECT count(*)::int n, max(synced_at) synced FROM gbp_media WHERE location_id=$1 AND source=$2',[id,source]);
    res.json({total:t.n,syncedAt:t.synced,items:rows});
  });
  route('post','/api/gbp/locations/:id/unlink',async(req,res,id)=>res.json(await unlinkLocation(id,Number(req.params.id))));
  route('post','/api/gbp/locations/:id/sync',async(req,res,id)=>{const location=Number(req.params.id);await locationAccess(await accessFor(id),location);if(!(await grantStatus(id)).connected)return res.json(await syncLocation(id,location));await queueSync(id,location);res.status(202).json({queued:true,message:'Sync queued'});});
  route('patch','/api/google-profile-reviews/:id/reply',async(req,res,id)=>res.json(await reply(id,Number(req.params.id),req.body.replyComment,req.body.action==='publish'?'publish':'draft',undefined,{req})));
  route('delete','/api/google-profile-reviews/:id/reply',async(req,res,id)=>res.json(await reply(id,Number(req.params.id),'','delete',undefined,{req})));
  route('get','/api/gbp/locations/:id/performance',async(req,res,userId)=>{
    const id=Number(req.params.id);
    const {rows:[l]}=await pool.query('SELECT id FROM business_locations WHERE id=$1 AND user_id=$2',[id,userId]);
    if(!l) throw new GoogleError('invalid','Location not found',404);
    const days:Record<string,number|null>={'30d':30,'90d':90,'6m':183,'12m':366,'18m':548,'all':null};
    const range=String(req.query.range||'90d') in days?String(req.query.range||'90d'):'90d';
    const group=['day','week','month'].includes(String(req.query.group))?String(req.query.group):'day';
    const since=days[range];
    const {rows}=await pool.query(`SELECT to_char(date_trunc($2,date),'YYYY-MM-DD') AS date,metric,sum(value)::text AS value,max(date)::text AS last_day
      FROM gbp_daily_metrics WHERE location_id=$1 ${since===null?'':'AND date>=current_date-$3::int'} GROUP BY 1,2 ORDER BY 1,2`,since===null?[id,group]:[id,group,since]);
    const {rows:[span]}=await pool.query('SELECT min(date)::text first,max(date)::text last FROM gbp_daily_metrics WHERE location_id=$1',[id]);
    // Google reports with a delay of a few days; those days read as zeros until Google fills them in.
    const pending=new Date(Date.now()-5*86400000).toISOString().slice(0,10);
    res.json({source:'Google Business Profile Performance API',available:rows.length>0,metrics:METRICS,rows,range,group,firstDate:span?.first??null,lastDate:span?.last??null,pendingAfter:pending});
  });
}
