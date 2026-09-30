import type { Express, Request, Response } from 'express';
import { randomBytes, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { pool } from '../db';
import { rateLimit, takeBudget } from '../growth-limits';
import { requireRecentAuth } from '../account-security';
import { encryptToken } from '../gbp/token-crypto';
import { notifyUser, logActivity } from '../account-events';
import { AdsError, ADS_SCOPE, customerId, configured, oauthTokens, redirectUri } from './client';
import { withAgencyLock, grant, enqueue, account } from './store';
import { protectionInput, STARTER_NEGATIVES } from './protections';
import { optimizationSteps } from './playbook';
import { requireModule } from '../entitlements';
declare module 'express-session' {interface SessionData { adsOAuth?:{state:string;userId:number;manager:string;expires:number;redirect:string} }}
const pageInput=z.object({q:z.string().trim().max(100).default(''),status:z.string().max(30).default(''),lsa:z.enum(['','true','false','unknown']).default(''),page:z.coerce.number().int().min(1).max(100000).default(1),limit:z.coerce.number().int().min(1).max(100).default(25)});
const selection=z.object({ids:z.array(customerId).min(1).max(1000).optional(),filter:z.object({q:z.string().max(100).default(''),lsa:z.enum(['','true','false','unknown']).default('')}).optional()}).strict().refine(v=>!!v.ids!==!!v.filter,'Select IDs or a server-side filter');
async function targets(user:number,s:z.infer<typeof selection>) {
  const {rows}=await pool.query(`SELECT customer_id FROM ads_accounts WHERE user_id=$1 AND NOT manager AND status='ENABLED'
    AND ($2::text[] IS NULL OR customer_id=ANY($2)) AND ($3='' OR name ILIKE '%'||$3||'%' OR customer_id ILIKE '%'||$3||'%')
    AND ($4='' OR ($4='unknown' AND lsa IS NULL) OR ($4='true' AND lsa=true) OR ($4='false' AND lsa=false)) ORDER BY customer_id LIMIT 1001`,[user,s.ids||null,s.filter?.q||'',s.filter?.lsa||'']);
  if(s.ids && new Set(s.ids).size!==rows.length) throw new AdsError('Some client accounts are unavailable in this agency.',404);
  if(!rows.length || rows.length>1000) throw new AdsError('Select 1–1,000 active client accounts; narrow the filter for larger batches.',422);
  return rows.map(r=>r.customer_id as string);
}
export function registerAdsRoutes(app:Express,auth:(req:any,res:any)=>any,options:{http?:typeof fetch}={}) {
  // Agency-only module: every /api/ads route answers 402 plan_required unless the plan includes it, except
  // removing a saved MCC connection (list + disconnect), which an account without the plan must still be able to do.
  const gate=requireModule('adsManager'),removal=(req:Request)=>(req.method==='GET'&&req.path==='/saved-connection')||(req.method==='POST'&&req.path==='/disconnect');
  app.use('/api/ads', (req,res,next)=>{if(!auth(req,res))return;next();},rateLimit('ads-api',300,600,60000),(req,res,next)=>removal(req)?next():gate(req,res,next));
  app.use(['/api/ads/connect','/api/ads/callback','/api/ads/disconnect'],rateLimit('ads-connections',10,30));
  const route=(method:'get'|'post'|'patch',path:string,fn:(req:Request,res:Response,user:number)=>Promise<unknown>)=>app[method](`/api/ads${path}`,async(req,res)=>{
    try{const user=auth(req,res);if(!user)return;await fn(req,res,user.id);}catch(e){res.status(e instanceof AdsError?e.status:e instanceof z.ZodError?400:500).json({message:e instanceof AdsError?e.message:e instanceof z.ZodError?'Invalid input. Check IDs, selection and protection settings.':'Ads operation failed.'});}
  });
  const reserve=async(user:number,n:number)=>{if(!await takeBudget(`ads-queue:${user}`,5000,n,3600000)) throw new AdsError('Hourly Ads queue budget reached.',429);};
  route('get','/status',async(_req,res,user)=>{
    const {rows:[g]}=await pool.query('SELECT manager_id,verified,reconnect_required,updated_at FROM ads_grants WHERE user_id=$1',[user]);
    res.json({configured:configured(),connected:!!g&&!g.reconnect_required,grant:g||null,workerEnabled:process.env.GOOGLE_ADS_WORKER_ENABLED==='true',defaultManagerId:process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID?.replaceAll('-','')||'',starterNegatives:STARTER_NEGATIVES,playbook:optimizationSteps});
  });
  // Only whether a connection is saved (for the plan_required card's Disconnect button); no module data.
  route('get','/saved-connection',async(_req,res,user)=>{
    const {rows:[g]}=await pool.query('SELECT manager_id FROM ads_grants WHERE user_id=$1',[user]);
    res.json({saved:!!g,managerId:g?.manager_id??null});
  });
  route('post','/connect',async(req,res,user)=>{
    if(!requireRecentAuth(req,res)) return;
    if(!configured()) throw new AdsError('Owner setup required: approved Ads project access (or legacy developer token), OAuth client ID and secret.',503);
    const manager=customerId.parse(req.body?.managerId),state=randomBytes(32).toString('hex'),redirect=redirectUri();
    req.session.adsOAuth={state,userId:user,manager,expires:Date.now()+600000,redirect};
    const q=new URLSearchParams({client_id:process.env.GOOGLE_ADS_CLIENT_ID!,redirect_uri:redirect,response_type:'code',scope:ADS_SCOPE,access_type:'offline',prompt:'consent',state});
    res.json({url:`https://accounts.google.com/o/oauth2/v2/auth?${q}`});
  });
  route('get','/callback',async(req,res,user)=>{
    const s=req.session.adsOAuth;delete req.session.adsOAuth;
    await new Promise<void>((resolve,reject)=>req.session.save(e=>e?reject(e):resolve()));
    if(!s || s.userId!==user || s.expires<Date.now() || s.state!==req.query.state || typeof req.query.code!=='string' || req.query.code.length>4096) return res.redirect('/ads-manager?connect=failed');
    try {
      const t=await oauthTokens({code:req.query.code,redirect_uri:s.redirect,grant_type:'authorization_code'},options.http);
      if(typeof t.refresh_token!=='string'||!String(t.scope||'').split(' ').includes(ADS_SCOPE)) throw new AdsError('Ads permission and offline access are required.',401);
      await withAgencyLock(user,async c=>{
        await c.query('BEGIN');
        try {
          await c.query("UPDATE ads_jobs SET status='cancelled' WHERE user_id=$1 AND status IN ('queued','running')",[user]);
          await c.query("UPDATE ads_plans SET status='expired' WHERE user_id=$1 AND status IN ('preview','queued')",[user]);
          await c.query('DELETE FROM ads_accounts WHERE user_id=$1',[user]);await c.query('DELETE FROM ads_findings WHERE user_id=$1',[user]);await c.query('DELETE FROM ads_invitations WHERE user_id=$1',[user]);
          const {rows:[g]}=await c.query(`INSERT INTO ads_grants(user_id,manager_id,refresh_token,access_token,expires_at) VALUES($1,$2,$3,$4,$5)
            ON CONFLICT(user_id) DO UPDATE SET manager_id=$2,refresh_token=$3,access_token=$4,expires_at=$5,connection_id=gen_random_uuid(),verified=false,reconnect_required=false,updated_at=now() RETURNING connection_id`,[user,s.manager,encryptToken(t.refresh_token),encryptToken(t.access_token),new Date(Date.now()+Number(t.expires_in||3600)*1000)]);
          await enqueue(user,g.connection_id,'discover',{},null,randomUUID(),randomUUID(),c);
          await c.query('COMMIT');
        }catch(e){await c.query('ROLLBACK');throw e;}
      });
      await logActivity(req,user,'google.connected',{service:'ads',managerId:s.manager});
      await notifyUser(user,'google.connected',{title:'Google Ads MCC connected',body:`Manager ${s.manager}; queued verification and discovery.`,link:'/ads-manager'});
      res.redirect('/ads-manager?connect=ok');
    }catch{res.redirect('/ads-manager?connect=failed');}
  });
  route('post','/disconnect',async(req,res,user)=>{
    if(!requireRecentAuth(req,res)) return;
    z.object({confirm:z.literal(true)}).strict().parse(req.body);
    await withAgencyLock(user,async c=>{
      await c.query('BEGIN');try {
        await c.query('DELETE FROM ads_grants WHERE user_id=$1',[user]);
        await c.query("UPDATE ads_jobs SET status='cancelled' WHERE user_id=$1 AND status IN ('queued','running')",[user]);
        await c.query("UPDATE ads_plans SET status='expired' WHERE user_id=$1 AND status IN ('preview','queued')",[user]);
        for(const table of ['ads_accounts','ads_findings','ads_invitations','ads_ip_age']) await c.query(`DELETE FROM ${table} WHERE user_id=$1`,[user]);
        await c.query('COMMIT');
      }catch(e){await c.query('ROLLBACK');throw e;}
    });
    await logActivity(req,user,'google.disconnected',{service:'ads'});
    await notifyUser(user,'google.disconnected',{title:'Google Ads MCC disconnected',body:'Local credentials removed and queued work cancelled. Remove ConstructHUB access in your Google Account to revoke the Google grant.',link:'/ads-manager'});
    res.json({message:'Disconnected locally. Remove ConstructHUB access in your Google Account to revoke the Google grant.'});
  });
  route('post','/sync',async(req,res,user)=>{
    const p=z.object({kind:z.enum(['discover','poll'])}).strict().parse(req.body),g=await grant(user,false);await reserve(user,1);
    res.status(202).json(await enqueue(user,g.connection_id,p.kind,{}));
  });
  route('get','/accounts',async(req,res,user)=>{
    const p=pageInput.parse(req.query);
    const where=`user_id=$1 AND ($2='' OR name ILIKE '%'||$2||'%' OR customer_id ILIKE '%'||$2||'%') AND ($3='' OR status=$3) AND ($4='' OR ($4='true' AND lsa=true) OR ($4='false' AND lsa=false) OR ($4='unknown' AND lsa IS NULL))`;
    const args=[user,p.q,p.status,p.lsa];
    const {rows:[n]}=await pool.query(`SELECT count(*)::int total FROM ads_accounts WHERE ${where}`,args);
    const {rows}=await pool.query(`SELECT customer_id,name,manager,status,lsa,currency,timezone,synced_at,error,domain_id FROM ads_accounts WHERE ${where} ORDER BY customer_id LIMIT $5 OFFSET $6`,[...args,p.limit,(p.page-1)*p.limit]);
    res.json({items:rows,total:n.total,page:p.page});
  });
  route('get','/domains',async(req,res,user)=>{
    const p=pageInput.parse(req.query),args=[user,p.q];
    const where=`user_id=$1 AND domain ILIKE '%'||$2||'%'`;
    const {rows:[n]}=await pool.query(`SELECT count(*)::int total FROM tracked_domains WHERE ${where}`,args);
    res.json({items:(await pool.query(`SELECT id,domain FROM tracked_domains WHERE ${where} ORDER BY id LIMIT $3 OFFSET $4`,[...args,p.limit,(p.page-1)*p.limit])).rows,total:n.total});
  });
  route('post','/domain-mappings',async(req,res,user)=>{
    const p=z.object({mappings:z.array(z.object({customerId,domainId:z.number().int().positive().nullable()}).strict()).min(1).max(1000)}).strict().parse(req.body);
    await withAgencyLock(user,async c=>{
      await c.query('BEGIN');try {for(const m of p.mappings) {
        await account(user,m.customerId);
        if(m.domainId && !(await c.query('SELECT id FROM tracked_domains WHERE id=$1 AND user_id=$2',[m.domainId,user])).rowCount) throw new AdsError('Click Guard domain not found.',404);
        await c.query('UPDATE ads_accounts SET domain_id=$3 WHERE user_id=$1 AND customer_id=$2',[user,m.customerId,m.domainId]);
      } await c.query('COMMIT');}catch(e){await c.query('ROLLBACK');throw e;}
    });
    await logActivity(req,user,'ads.domain_mapped',{count:p.mappings.length});res.json({mapped:p.mappings.length});
  });
  route('get','/accounts/:cid/campaigns',async(req,res,user)=>{
    const cid=customerId.parse(req.params.cid),p=pageInput.parse(req.query);await account(user,cid);
    const from=`ads_accounts a CROSS JOIN LATERAL jsonb_array_elements(a.snapshot->'campaign') r WHERE a.user_id=$1 AND a.customer_id=$2 AND (r->>'name') ILIKE '%'||$3||'%' AND ($4='' OR r->>'advertisingChannelType'=$4)`;
    const args=[user,cid,p.q,p.status];
    const {rows:[n]}=await pool.query(`SELECT count(*)::int total FROM ${from}`,args);
    res.json({items:(await pool.query(`SELECT r AS campaign FROM ${from} ORDER BY r->>'id' LIMIT $5 OFFSET $6`,[...args,p.limit,(p.page-1)*p.limit])).rows.map(r=>r.campaign),total:n.total});
  });
  route('post','/bulk',async(req,res,user)=>{
    const p=z.object({selection,kind:z.enum(['audit','preview']),action:protectionInput.optional(),requestId:z.string().uuid()}).strict().parse(req.body);
    if(p.kind==='preview'&&!p.action) throw new AdsError('Choose a protection.',400);
    const g=await grant(user),ids=await targets(user,p.selection);await reserve(user,ids.length);
    const batch=p.requestId;
    await withAgencyLock(user,async c=>{await c.query('BEGIN');try{for(const cid of ids) await enqueue(user,g.connection_id,p.kind,{action:p.action},cid,batch,`${batch}:${cid}`,c);await c.query('COMMIT');}catch(e){await c.query('ROLLBACK');throw e;}});
    await logActivity(req,user,'ads.bulk_queued',{kind:p.kind,batchId:batch,count:ids.length});res.status(202).json({batchId:batch,queued:ids.length});
  });
  route('post','/invitations',async(req,res,user)=>{
    const p=z.object({confirm:z.literal(true),clients:z.array(z.object({customerId,email:z.string().email().max(254)}).strict()).min(1).max(1000),requestId:z.string().uuid()}).strict().parse(req.body);
    const g=await grant(user);await reserve(user,p.clients.length);
    if(p.clients.some(c=>c.customerId===g.manager_id)||new Set(p.clients.map(c=>c.customerId)).size!==p.clients.length) throw new AdsError('Use unique client IDs, excluding the manager itself.');
    await withAgencyLock(user,async c=>{await c.query('BEGIN');try{for(const client of p.clients) {
      const dedupe=`${p.requestId}:${client.customerId}`;
      if((await c.query('SELECT id FROM ads_jobs WHERE user_id=$1 AND dedupe=$2',[user,dedupe])).rowCount)continue;
      if((await c.query('SELECT 1 FROM ads_accounts WHERE user_id=$1 AND customer_id=$2 AND status=\'ENABLED\'',[user,client.customerId])).rowCount) throw new AdsError('A selected client is already linked.',409);
      const {rows:[inv]}=await c.query(`INSERT INTO ads_invitations(user_id,customer_id,email) VALUES($1,$2,$3) ON CONFLICT DO NOTHING RETURNING id`,[user,client.customerId,client.email]);
      if(!inv) throw new AdsError('An invitation is already pending or needs reconciliation for this client.',409);
      await enqueue(user,g.connection_id,'invite',{invitationId:inv.id},client.customerId,p.requestId,dedupe,c);
    }await c.query('COMMIT');}catch(e){await c.query('ROLLBACK');throw e;}});
    await logActivity(req,user,'ads.invitations_confirmed',{count:p.clients.length,batchId:p.requestId});res.status(202).json({queued:p.clients.length,batchId:p.requestId});
  });
  route('post','/invitations/cancel',async(req,res,user)=>{
    const p=z.object({ids:z.array(z.string().uuid()).min(1).max(1000),confirm:z.literal(true)}).strict().parse(req.body),g=await grant(user);await reserve(user,p.ids.length);
    await withAgencyLock(user,async c=>{await c.query('BEGIN');try{for(const id of new Set(p.ids)) {
      const {rows:[inv]}=await c.query('SELECT * FROM ads_invitations WHERE user_id=$1 AND id=$2',[user,id]);
      if(!inv || inv.status!=='pending') throw new AdsError('Pending invitation not found.',404);
      await enqueue(user,g.connection_id,'cancel-invite',{invitationId:id},inv.customer_id,randomUUID(),`cancel:${id}`,c);
    }await c.query('COMMIT');}catch(e){await c.query('ROLLBACK');throw e;}});
    res.status(202).json({queued:p.ids.length});
  });
  for(const [path,table,columns,search] of [
    ['/invitations','ads_invitations','id,customer_id,email,status,email_status,created_at','customer_id'],
    ['/jobs','ads_jobs','id,batch_id,customer_id,kind,status,attempts,error,created_at','COALESCE(customer_id,kind)'],
    ['/plans','ads_plans','id,batch_id,customer_id,kind,status,error,expires_at,created_at,undo_of','customer_id'],
  ]) route('get',path,async(req,res,user)=>{
    const p=pageInput.parse(req.query),batch=z.string().uuid().optional().parse(req.query.batch);
    const where=`user_id=$1 AND ($2='' OR ${search} ILIKE '%'||$2||'%') AND ($3='' OR status=$3) ${table!=='ads_invitations'?'AND ($4::uuid IS NULL OR batch_id=$4)':''}`;
    const args:unknown[]=[user,p.q,p.status];if(table!=='ads_invitations')args.push(batch||null);
    const {rows:[n]}=await pool.query(`SELECT count(*)::int total FROM ${table} WHERE ${where}`,args);
    res.json({items:(await pool.query(`SELECT ${columns} FROM ${table} WHERE ${where} ORDER BY created_at DESC,id LIMIT $${args.length+1} OFFSET $${args.length+2}`,[...args,p.limit,(p.page-1)*p.limit])).rows,total:n.total});
  });
  route('get','/plans/:id',async(req,res,user)=>{
    const id=z.string().uuid().parse(req.params.id),p=pageInput.parse(req.query);
    const {rows:[plan]}=await pool.query('SELECT id,customer_id,kind,status,expires_at,error,document FROM ads_plans WHERE user_id=$1 AND id=$2',[user,id]);
    if(!plan)throw new AdsError('Preview not found.',404);
    const d=plan.document;delete plan.document;
    const operations=d.operations.filter((operation:any)=>(!p.q||JSON.stringify(operation).toLowerCase().includes(p.q.toLowerCase()))&&(!p.status||Object.values(operation).some((v:any)=>Object.hasOwn(v,p.status))));
    res.json({...plan,summary:d.summary,warnings:d.warnings,operations:operations.slice((p.page-1)*p.limit,p.page*p.limit).map((operation:any)=>{const type=Object.keys(operation)[0].replace(/Operation$/,'');const op:any=Object.values(operation)[0];return {operation,before:op.remove||op.update?d.before[type]?.find((r:any)=>r.resourceName===(op.remove||op.update.resourceName))||null:null};}),total:operations.length});
  });
  route('post','/plans/confirm',async(req,res,user)=>{
    const p=z.object({ids:z.array(z.string().uuid()).min(1).max(1000),confirm:z.literal(true)}).strict().parse(req.body),g=await grant(user);await reserve(user,p.ids.length);
    await withAgencyLock(user,async c=>{await c.query('BEGIN');try {for(const id of new Set(p.ids)) {
      const {rows:[plan]}=await c.query("UPDATE ads_plans SET status='queued' WHERE user_id=$1 AND id=$2 AND connection_id=$3 AND status='preview' AND expires_at>now() RETURNING *",[user,id,g.connection_id]);
      if(!plan)throw new AdsError('A preview expired, was already confirmed, or is unavailable.',409);
      await enqueue(user,g.connection_id,'apply',{planId:id},plan.customer_id,plan.batch_id,`apply:${id}`,c);
    }await c.query('COMMIT');}catch(e){await c.query('ROLLBACK');throw e;}});
    await logActivity(req,user,'ads.previews_confirmed',{planIds:p.ids});res.status(202).json({queued:p.ids.length});
  });
  route('post','/plans/undo-preview',async(req,res,user)=>{
    const p=z.object({ids:z.array(z.string().uuid()).min(1).max(1000)}).strict().parse(req.body),g=await grant(user);await reserve(user,p.ids.length);
    const batch=randomUUID();
    await withAgencyLock(user,async c=>{await c.query('BEGIN');try {for(const id of new Set(p.ids)) {
      const {rows:[plan]}=await c.query("SELECT * FROM ads_plans WHERE user_id=$1 AND id=$2 AND connection_id=$3 AND status='applied' AND undo_of IS NULL",[user,id,g.connection_id]);
      if(!plan)throw new AdsError('Reversible applied plan not found.',404);
      await enqueue(user,g.connection_id,'undo-preview',{planId:id},plan.customer_id,batch,`${batch}:${id}`,c);
    }await c.query('COMMIT');}catch(e){await c.query('ROLLBACK');throw e;}});
    res.status(202).json({queued:p.ids.length,batchId:batch});
  });
  route('get','/findings',async(req,res,user)=>{
    const p=pageInput.parse(req.query),cid=req.query.customerId?customerId.parse(req.query.customerId):'';
    const where=`user_id=$1 AND ($2='' OR customer_id=$2) AND ($3='' OR title ILIKE '%'||$3||'%') AND ($4='' OR severity=$4)`;
    const args=[user,cid,p.q,p.status];const {rows:[n]}=await pool.query(`SELECT count(*)::int total FROM ads_findings WHERE ${where}`,args);
    res.json({items:(await pool.query(`SELECT * FROM ads_findings WHERE ${where} ORDER BY id DESC LIMIT $5 OFFSET $6`,[...args,p.limit,(p.page-1)*p.limit])).rows,total:n.total});
  });
}
