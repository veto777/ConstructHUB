import { randomUUID } from 'node:crypto';
import { pool } from '../db';
import { logActivity, notifyUser } from '../account-events';
import { GoogleClient, GoogleError } from './client';
import { clientFor, ownedLocation, withLocationLock, publicError } from './service';
import { getEntitlements } from '../entitlements';
import { PLANS, PLAN_KEYS } from '@shared/plans';
import { recordFailure } from '../ops/issues';

export const GUARD_FIELDS = ['title','phoneNumbers','websiteUri','storefrontAddress','categories','profile.description','regularHours','specialHours','serviceArea','openInfo.openingDate','openInfo.status'] as const;
export type GuardField = typeof GUARD_FIELDS[number];
export const guardMask = [...new Set([...GUARD_FIELDS.map(f=>f.split('.')[0]), 'name','metadata'])].join(',');
export const readField = (o: any, path: string): any => path.split('.').reduce((v,k)=>v?.[k],o) ?? null;
export function setField(o: any, path: string, value: any) {
  const keys=path.split('.'); let node=o;
  for(const k of keys.slice(0,-1)) node=node[k]??={};
  // An omitted value with an explicit update mask clears a field in Google PATCH.
  if(value !== null) node[keys.at(-1)!]=value;
}
function canonical(v: any, path = ''): any {
  if(Array.isArray(v)) {
    const values=v.map(item=>canonical(item,path));
    return path==='addressLines'?values:values.sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
  }
  if(v && typeof v==='object') return Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k],k)]));
  return v;
}
export const same = (a: any,b: any) => JSON.stringify(canonical(a??null))===JSON.stringify(canonical(b??null));
export function snapshotOf(location: any) {
  const s: Record<string,any>={};
  for(const f of GUARD_FIELDS) {
    let v=readField(location,f);
    if(f==='categories' && v) v={primaryCategory:v.primaryCategory?{name:v.primaryCategory.name}:undefined,additionalCategories:v.additionalCategories?.map((c:any)=>({name:c.name}))??[]};
    if(f==='serviceArea' && v) { const {regionCode,...writable}=v; v=writable; }
    s[f]=v;
  }
  return JSON.parse(JSON.stringify(s));
}
const masked = (mask: string|undefined,f:string) => String(mask||'').split(',').some(m=>m===f||f.startsWith(m+'.')||m.startsWith(f+'.'));
export function differences(snapshot: any, watched: string[], live: any, updated: any) {
  const current=snapshotOf(live), google=updated.location?snapshotOf(updated.location):null;
  return watched.flatMap(field=>{
    const googleChanged=masked(updated.diffMask,field);
    const useGoogle=googleChanged&&google;
    const value=useGoogle?google[field]:current[field];
    if(same(snapshot[field],value)) return [];
    return [{field,old:snapshot[field]??null,new:value??null,
      source:useGoogle?'Google update':'owner-edit-outside-ConstructHUB (inferred; actor unavailable)',
      evidence:{diffMask:updated.diffMask||'',pendingMask:updated.pendingMask||'',hasGoogleUpdated:!!live.metadata?.hasGoogleUpdated,hasPendingEdits:!!live.metadata?.hasPendingEdits,
        liveValue:current[field],googleValue:google?.[field]??null,attribution:'Google does not identify the editor or distinguish public suggestions from other Google updates.'}}];
  });
}
export async function guardRow(userId:number,id:number) {
  await ownedLocation(userId,id);
  await pool.query('INSERT INTO gbp_guard(user_id,location_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[userId,id]);
  return (await pool.query('SELECT * FROM gbp_guard WHERE user_id=$1 AND location_id=$2',[userId,id])).rows[0];
}
export async function previewSnapshot(userId:number,id:number,client?:GoogleClient) {
  const l=await ownedLocation(userId,id);
  return withLocationLock(id,async()=>{
    await guardRow(userId,id);
    const live=await (client??clientFor(userId,l.gbp_google_subject)).request('information',`/v1/${l.gbp_location_name}?readMask=${guardMask}`);
    if(live.name!==l.gbp_location_name || typeof live.title!=='string') throw new GoogleError('transient','Google did not return this location',503);
    const snapshot=snapshotOf(live),token=randomUUID();
    await pool.query("UPDATE gbp_guard SET preview=$3,preview_token=$4,preview_expires=now()+interval '10 minutes' WHERE user_id=$1 AND location_id=$2",[userId,id,JSON.stringify(snapshot),token]);
    return {snapshot,token};
  });
}
export async function configureGuard(userId:number,id:number,mode:string,watched:string[],token?:string,req:any=null) {
  return withLocationLock(id,async()=>{
    const g=await guardRow(userId,id);
    if(!g.snapshot && mode!=='off' && (!token||g.preview_token!==token||new Date(g.preview_expires).getTime()<Date.now())) throw new GoogleError('invalid','Preview and approve the current Google values first',409);
    if(token && (g.preview_token!==token||new Date(g.preview_expires).getTime()<Date.now())) throw new GoogleError('invalid','Snapshot preview expired. Preview again.',409);
    // Re-baselining an established guard uses individual Approve actions, preserving pending evidence.
    if(token && g.snapshot) throw new GoogleError('invalid','A snapshot already exists. Approve individual changes instead.',409);
    await pool.query(`UPDATE gbp_guard SET mode=$3,watched=$4,snapshot=COALESCE(snapshot,$5::jsonb),preview=NULL,preview_token=NULL,updated_at=now() WHERE user_id=$1 AND location_id=$2`,[userId,id,mode,watched,token?JSON.stringify(g.preview):null]);
    await logActivity(req,userId,'gbp.profile_change',{locationId:id,action:'guard-settings',mode,watched});
  });
}
async function resolveLocked(userId:number,l:any,g:any,change:any,action:'approve'|'reject'|'auto-revert',client:GoogleClient,req:any=null) {
  if(change.status!=='pending') throw new GoogleError('invalid','Change already resolved',409);
  const field=change.field;
  if(action==='approve') {
    g.snapshot[field]=change.new_value;
    await pool.query('UPDATE gbp_guard SET snapshot=$3,updated_at=now() WHERE user_id=$1 AND location_id=$2',[userId,l.id,JSON.stringify(g.snapshot)]);
  } else {
    const body:any={}; setField(body,field,g.snapshot[field]);
    const response=await client.request('information',`/v1/${l.gbp_location_name}?updateMask=${field}`,'PATCH',body);
    if(response.name!==l.gbp_location_name || !same(snapshotOf(response)[field],g.snapshot[field])) throw new GoogleError('transient','Google did not confirm the restored value. Check again before retrying.',503);
  }
  const status=action==='approve'?'approved':'reverted';
  await pool.query('UPDATE gbp_guard_changes SET status=$3,resolved_at=now(),error=NULL WHERE id=$1 AND user_id=$2',[change.id,userId,status]);
  const kind=action==='approve'?'gbp.profile_change':'gbp.change_reverted';
  await logActivity(req,userId,kind,{locationId:l.id,changeId:change.id,field,action});
  await notifyUser(userId,kind,{title:action==='approve'?'Profile change approved':'Profile change reverted',body:`${l.business_name}: ${field}. ${action==='approve'?'Accepted into your approved snapshot.':'Google accepted the approved value; Maps publication may be pending.'}`,link:'/locations',actionUrl:'/locations'});
}
export async function resolveChange(userId:number,id:number,changeId:number,action:'approve'|'reject',client?:GoogleClient,req:any=null) {
  const l=await ownedLocation(userId,id);
  return withLocationLock(id,async()=>{
    const g=await guardRow(userId,id);
    const {rows:[change]}=await pool.query('SELECT * FROM gbp_guard_changes WHERE user_id=$1 AND location_id=$2 AND id=$3',[userId,id,changeId]);
    if(!change) throw new GoogleError('invalid','Change not found',404);
    return resolveLocked(userId,l,g,change,action,client??clientFor(userId,l.gbp_google_subject),req);
  });
}
export async function checkGuard(userId:number,id:number,client?:GoogleClient) {
  const l=await ownedLocation(userId,id);
  return withLocationLock(id,async()=>{
    const g=await guardRow(userId,id); if(g.mode==='off'||!g.snapshot) return;
    await pool.query('UPDATE gbp_guard SET last_attempt=now() WHERE user_id=$1 AND location_id=$2',[userId,id]);
    client??=clientFor(userId,l.gbp_google_subject);
    try {
      const live=await client.request('information',`/v1/${l.gbp_location_name}?readMask=${guardMask}`);
      const updated=await client.request('information',`/v1/${l.gbp_location_name}:getGoogleUpdated?readMask=${guardMask}`);
      if(live.name!==l.gbp_location_name || typeof live.title!=='string' || (updated.location && updated.location.name!==l.gbp_location_name)) throw new GoogleError('transient','Google returned an incomplete location',503);
      const diffs=differences(g.snapshot,g.watched,live,updated),observed:any={};
      for(const d of diffs) {
        observed[d.field]=d.new;
        if(Object.hasOwn(g.observed,d.field)&&same(g.observed[d.field],d.new)) {
          const pending=await pool.query("SELECT id FROM gbp_guard_changes WHERE user_id=$1 AND location_id=$2 AND field=$3 AND status='pending'",[userId,id,d.field]);
          // Suppress repeated pending suggestions, but detect a repeated live overwrite after a successful revert.
          if(pending.rowCount || same(snapshotOf(live)[d.field],g.snapshot[d.field])) continue;
        }
        await pool.query("UPDATE gbp_guard_changes SET status='superseded',resolved_at=now() WHERE user_id=$1 AND location_id=$2 AND field=$3 AND status='pending'",[userId,id,d.field]);
        const {rows:[change]}=await pool.query(`INSERT INTO gbp_guard_changes(user_id,location_id,field,old_value,new_value,source,evidence) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,[userId,id,d.field,JSON.stringify(d.old),JSON.stringify(d.new),d.source,JSON.stringify(d.evidence)]);
        await notifyUser(userId,d.source==='Google update'?'gbp.suggested_edit':'gbp.profile_change',{title:'Business Profile change detected',body:`${l.business_name}: ${d.field} changed. Source: ${d.source}.`,link:'/locations',actionUrl:'/locations'});
      }
      // Only checked fields can be confirmed restored. Unwatching must not resolve evidence.
      await pool.query("UPDATE gbp_guard_changes SET status='no-longer-observed',resolved_at=now() WHERE user_id=$1 AND location_id=$2 AND status='pending' AND field=ANY($4::text[]) AND NOT(field=ANY($3::text[]))",[userId,id,diffs.map(d=>d.field),g.watched]);
      if(g.mode==='lockdown') {
        const {rows}=await pool.query("SELECT * FROM gbp_guard_changes WHERE user_id=$1 AND location_id=$2 AND status='pending' AND field=ANY($3) ORDER BY id",[userId,id,g.watched]);
        for(const change of rows) try { await resolveLocked(userId,l,g,change,'auto-revert',client); }
        catch(e) {await pool.query('UPDATE gbp_guard_changes SET error=$3 WHERE id=$1 AND user_id=$2',[change.id,userId,publicError(e).message]);}
      }
      await pool.query('UPDATE gbp_guard SET observed=$3,checked_at=now(),last_error=NULL WHERE user_id=$1 AND location_id=$2',[userId,id,JSON.stringify(observed)]);
    } catch(e) {await pool.query('UPDATE gbp_guard SET last_error=$3 WHERE user_id=$1 AND location_id=$2',[userId,id,publicError(e).message]);throw e;}
  });
}
/** Use this path for owner profile writes: lock, confirm with Google, then change only the written snapshot fields. */
export async function writeOwnerProfile(userId:number,id:number,fields:Record<string,any>,client?:GoogleClient,req:any=null) {
  const l=await ownedLocation(userId,id);
  return withLocationLock(id,async()=>{
    const body:any={}; Object.entries(fields).forEach(([f,v])=>setField(body,f,v));
    const response=await (client??clientFor(userId,l.gbp_google_subject)).request('information',`/v1/${l.gbp_location_name}?updateMask=${Object.keys(fields).join(',')}`,'PATCH',body);
    const confirmed=snapshotOf(response), requested=snapshotOf(body);
    if(response.name!==l.gbp_location_name || Object.keys(fields).some(f=>!same(confirmed[f],requested[f]))) {
      throw new GoogleError('transient','Google did not confirm the profile edit. Check the profile before retrying.',503);
    }
    const g=await guardRow(userId,id);
    if(g.snapshot) {
      for(const f of Object.keys(fields)) {g.snapshot[f]=confirmed[f]; delete g.observed[f];}
      await pool.query('UPDATE gbp_guard SET snapshot=$3,observed=$4 WHERE user_id=$1 AND location_id=$2',[userId,id,JSON.stringify(g.snapshot),JSON.stringify(g.observed)]);
      await pool.query("UPDATE gbp_guard_changes SET status='owner-edited',resolved_at=now() WHERE user_id=$1 AND location_id=$2 AND field=ANY($3) AND status='pending'",[userId,id,Object.keys(fields)]);
    }
    await logActivity(req,userId,'gbp.profile_change',{locationId:id,action:'owner-edit',fields:Object.keys(fields)});
    return response;
  });
}
/** The most frequent check any plan buys (shared/plans.ts guardCadenceMinutes). */
const FASTEST_GUARD_MINUTES=Math.min(...PLAN_KEYS.map(k=>PLANS[k].limits.guardCadenceMinutes));
let busy=false;
/**
 * Checks guarded locations at the cadence of their owner's plan (guardCadenceMinutes: every 15 minutes, every
 * 30 on Agency). Owners with no active plan are not checked, so a lapsed account spends no Google quota; their
 * guard settings stay and checks resume with a plan. `onlyUser` narrows a run to one owner (tests).
 */
export async function runGuardWorker(check=checkGuard,onlyUser?:number) {
  if(busy)return;busy=true;
  try {
    const due=`FROM gbp_guard p JOIN business_locations l ON l.id=p.location_id
      WHERE p.mode<>'off' AND l.gbp_location_name IS NOT NULL AND ($1::int IS NULL OR p.user_id=$1)`;
    const {rows:owners}=await pool.query(`SELECT DISTINCT p.user_id ${due} AND (p.last_attempt IS NULL OR p.last_attempt<now()-make_interval(mins=>$2::int))`,[onlyUser??null,FASTEST_GUARD_MINUTES]);
    const ids:number[]=[],minutes:number[]=[];
    for(const o of owners){
      // allowances = the plan's own cadence (no add-on changes it); a platform admin's is the fastest any plan buys.
      const a=(await getEntitlements(o.user_id)).allowances;
      if(a){ids.push(o.user_id);minutes.push(a.guardCadenceMinutes);}
    }
    if(!ids.length)return;
    const {rows}=await pool.query(`SELECT p.user_id,p.location_id ${due} AND p.user_id=ANY($2::int[])
      AND (p.last_attempt IS NULL OR p.last_attempt<now()-make_interval(mins=>(SELECT c.minutes FROM unnest($2::int[],$3::int[]) c(user_id,minutes) WHERE c.user_id=p.user_id)))
      ORDER BY p.last_attempt NULLS FIRST LIMIT 100`,[onlyUser??null,ids,minutes]);
    for(const r of rows) try {await check(r.user_id,r.location_id);} catch { /* per-location error persisted */ }
  } finally {busy=false;}
}
export function startGuardWorker() {
  if(process.env.GBP_SYNC_DISABLED==='true')return;
  const timer=setInterval(()=>void runGuardWorker().catch((e)=>{console.error('Profile Guard worker failed');void recordFailure('job','Profile Guard worker tick',e);}),60_000);timer.unref();return timer;
}
