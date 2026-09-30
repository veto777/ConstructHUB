import { logActivity } from '../account-events';
import { ownerProfileInput } from './profile-input';
import type { Express, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { pool } from '../db';
import { takeBudget } from '../growth-limits';
import { GoogleError } from './client';
import { publicError, ownedLocation } from './service';
import { GUARD_FIELDS, guardRow, previewSnapshot, configureGuard, checkGuard, resolveChange, writeOwnerProfile } from './guard';
import { defaults, replySettingsSchema, saveReplySettings, previewBackfill, confirmBackfill } from './review-automation';
import { RECENT_AUTH_MS, markRecentAuth, validTotp } from '../account-security';

declare module 'express-session' { interface SessionData { profileGuardAuth?:{userId:number;at:number} } }
/** Shared 12-hour step-up (account-security); Guard's own verify form sets the same marker. No dev bypass. */
export function guardRecentAuthOk(req:Request,userId:number) {
  const now=Date.now(), shared=req.session?.recentAuth, local=req.session?.profileGuardAuth;
  return (!!shared&&shared.userId===userId&&shared.at<=now&&now-shared.at<RECENT_AUTH_MS)
    || (!!local&&local.userId===userId&&local.at<=now&&now-local.at<=5*60_000);
}
export function requireGuardRecentAuth(req:Request,userId:number) {
  if(!guardRecentAuthOk(req,userId)) throw new GoogleError('auth','Verify your identity again to change Profile Guard mode',403);
}
export async function verifyGuardIdentity(userId:number,input:unknown) {
  const {password,code}=z.object({password:z.string().max(200).optional(),code:z.string().regex(/^\d{6}$/).optional()}).strict().parse(input);
  const {rows:[u]}=await pool.query('SELECT password_hash,totp_enabled,totp_secret FROM users WHERE id=$1',[userId]);
  const passwordOk=!!u?.password_hash&&!!password&&await bcrypt.compare(password,u.password_hash);
  // Authenticator secrets are encrypted at rest; validTotp decrypts at the verification boundary.
  const totpOk=!!u?.totp_enabled&&!!u?.totp_secret&&!!code&&validTotp(u.totp_secret,code);
  if(u?.totp_enabled?!totpOk|| (!!u.password_hash&&!passwordOk):!passwordOk) throw new GoogleError('auth','Identity verification failed. Use your password and enabled authenticator code. Google-only accounts need an authenticator or password configured in Settings.',403);
}
const idParam=z.coerce.number().int().positive().max(2147483647);
const configSchema=z.object({mode:z.enum(['off','notify','lockdown']),watched:z.array(z.enum(GUARD_FIELDS)).max(GUARD_FIELDS.length),token:z.string().uuid().optional()}).strict();
export function listingLink(l:any) {
  if(l.place_id)return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(l.business_name)}&query_place_id=${encodeURIComponent(l.place_id)}`;
  try {const u=new URL(l.google_cid);if(u.protocol==='https:'&&['maps.google.com','www.google.com'].includes(u.hostname))return u.href;}catch{}
  return null;
}
export async function reportFor(userId:number,type:'changes'|'reviews',id:number) {
  const table=type==='changes'?'gbp_guard_changes':'google_profile_reviews';
  const {rows:[record]}=await pool.query(`SELECT * FROM ${table} WHERE id=$1 AND user_id=$2`,[id,userId]);
  if(!record)throw new GoogleError('invalid','Record not found',404);
  const {rows:[l]}=record.location_id==null?{rows:[]}:await pool.query('SELECT * FROM business_locations WHERE id=$1 AND user_id=$2',[record.location_id,userId]);
  // A manually entered review may have no imported listing; its report still works, it just can't link one.
  if(!l&&type==='changes')throw new GoogleError('invalid','Listing not found',404);
  const link=l?listingLink(l):null;
  const details=type==='changes'?`Field: ${record.field}\nApproved value: ${JSON.stringify(record.old_value)}\nObserved value: ${JSON.stringify(record.new_value)}\nDetected: ${new Date(record.detected_at).toISOString()}\nSource: ${record.source}\nEvidence: ${JSON.stringify(record.evidence)}`
    :`Review: ${record.google_review_id||'Local record (not verified on Google)'}\nReviewer: ${record.reviewer_name}\nRating: ${record.rating}\nDate: ${new Date(record.review_date).toISOString()}\nText: ${record.comment||'(No text)'}`;
  const {rows:[a]}=type==='reviews'?await pool.query('SELECT reported_at FROM gbp_review_automation WHERE review_id=$1 AND user_id=$2',[id,userId]):{rows:[record]};
  return {text:`Business: ${l?.business_name??'Not linked to an imported listing'}\nListing: ${link||'Unavailable — locate the listing on Google Maps'}\n${details}\n\nOwner explanation and supporting evidence: `,
    listingUrl:link,formUrl:type==='changes'?'https://support.google.com/business/contact/business_redressal_form':'https://support.google.com/business/workflow/9945796',reportedAt:a?.reported_at??null};
}
export function registerProfileGuardRoutes(app:Express,auth:(req:any,res:any)=>any) {
  const route=(method:'get'|'post'|'put'|'patch',path:string,fn:(req:Request,res:Response,userId:number)=>Promise<unknown>)=>{
    app[method](path,async(req,res)=>{
      const u=auth(req,res);if(!u)return;
      try {
        if(method!=='get'&&!await takeBudget(`gbp-guard-route:${path}:user:${u.id}`,path.endsWith('reauth')?5:30,1,600_000))throw new GoogleError('quota','Too many requests. Try again later.',429);
        await fn(req,res,u.id);
      }catch(e){res.status(e instanceof z.ZodError?400:e instanceof GoogleError?e.status:500).json(e instanceof z.ZodError?{message:'Invalid input'}:publicError(e));}
    });
  };
  route('post','/api/gbp/guard/reauth',async(req,res,u)=>{await verifyGuardIdentity(u,req.body);req.session.profileGuardAuth={userId:u,at:Date.now()};markRecentAuth(req,u);await logActivity(req,u,'security.reauthenticated',{method:'profile-guard'});res.json({ok:true});});
  route('get','/api/gbp/guard/status',async(_req,res,u)=>{
    const {rows}=await pool.query(`SELECT l.id,COALESCE(g.mode,'off') AS mode,g.checked_at,g.last_error,(SELECT count(*)::int FROM gbp_guard_changes c WHERE c.location_id=l.id AND c.user_id=$1 AND c.status='pending') AS pending
      FROM business_locations l LEFT JOIN gbp_guard g ON g.location_id=l.id AND g.user_id=$1 WHERE l.user_id=$1`,[u]);res.json(rows);
  });
  const base='/api/gbp/locations/:id/guard';
  route('get',base,async(req,res,u)=>{const id=idParam.parse(req.params.id),g=await guardRow(u,id);const {rows:changes}=await pool.query('SELECT * FROM gbp_guard_changes WHERE user_id=$1 AND location_id=$2 ORDER BY id DESC LIMIT 200',[u,id]);res.json({mode:g.mode,watched:g.watched,snapshot:g.snapshot,checkedAt:g.checked_at,lastError:g.last_error,changes});});
  route('post',base+'/preview',async(req,res,u)=>res.json(await previewSnapshot(u,idParam.parse(req.params.id))));
  route('put',base,async(req,res,u)=>{
    const input=configSchema.parse(req.body),id=idParam.parse(req.params.id);
    // {reauth:true} makes the app's request helper open the shared verification modal and retry.
    if(!guardRecentAuthOk(req,u)){res.status(403).json({reauth:true,message:'Verify your identity to change Profile Guard mode'});return;}
    await configureGuard(u,id,input.mode,[...new Set(input.watched)],input.token,req);
    if(input.mode==='lockdown')await checkGuard(u,id);
    res.json({ok:true});
  });
  route('post',base+'/check',async(req,res,u)=>{await checkGuard(u,idParam.parse(req.params.id));res.json({ok:true});});
  route('post',base+'/changes/:changeId',async(req,res,u)=>{
    const {action}=z.object({action:z.enum(['approve','reject'])}).strict().parse(req.body);
    await resolveChange(u,idParam.parse(req.params.id),idParam.parse(req.params.changeId),action,undefined,req);res.json({ok:true});
  });
  route('patch','/api/gbp/locations/:id/profile',async(req,res,u)=>{const {fields}=ownerProfileInput.parse(req.body);res.json(await writeOwnerProfile(u,idParam.parse(req.params.id),fields,undefined,req));});
  for(const type of ['changes','reviews'] as const) {
    route('get',`/api/gbp/reports/${type}/:id`,async(req,res,u)=>res.json(await reportFor(u,type,idParam.parse(req.params.id))));
    route('post',`/api/gbp/reports/${type}/:id`,async(req,res,u)=>{
      z.object({submitted:z.literal(true)}).strict().parse(req.body);const id=idParam.parse(req.params.id);await reportFor(u,type,id);
      if(type==='changes')await pool.query('UPDATE gbp_guard_changes SET reported_at=COALESCE(reported_at,now()) WHERE id=$1 AND user_id=$2',[id,u]);
      else await pool.query('INSERT INTO gbp_review_automation(user_id,review_id,reported_at) VALUES($1,$2,now()) ON CONFLICT(review_id) DO UPDATE SET reported_at=COALESCE(gbp_review_automation.reported_at,now())',[u,id]);
      res.json({reported:true,localOnly:true});
    });
  }
  const ai='/api/gbp/locations/:id/ai-replies';
  route('get',ai,async(req,res,u)=>{
    const id=idParam.parse(req.params.id);await ownedLocation(u,id);
    const {rows:[s]}=await pool.query('SELECT settings,future_since FROM gbp_reply_settings WHERE user_id=$1 AND location_id=$2',[u,id]);
    const {rows:drafts}=await pool.query(`SELECT r.id,r.reviewer_name,r.rating,r.reply_draft,r.reply_error,a.ai_status,a.ai_error FROM google_profile_reviews r LEFT JOIN gbp_review_automation a ON a.review_id=r.id
      WHERE r.user_id=$1 AND r.location_id=$2 AND NOT r.google_deleted AND r.reply_comment IS NULL AND (r.reply_draft IS NOT NULL OR a.ai_error IS NOT NULL OR a.ai_status='generating') ORDER BY r.id DESC LIMIT 100`,[u,id]);
    res.json({settings:s?.settings??defaults,futureSince:s?.future_since,drafts});
  });
  route('put',ai,async(req,res,u)=>{await saveReplySettings(u,idParam.parse(req.params.id),replySettingsSchema.parse(req.body));res.json({ok:true});});
  route('post',ai+'/preview',async(req,res,u)=>res.json(await previewBackfill(u,idParam.parse(req.params.id))));
  route('post',ai+'/confirm',async(req,res,u)=>{const {token}=z.object({token:z.string().uuid()}).strict().parse(req.body);res.json(await confirmBackfill(u,idParam.parse(req.params.id),token));});
}
