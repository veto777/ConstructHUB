import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { pool } from '../db';
import { takeBudget } from '../growth-limits';
import { logActivity } from '../account-events';
import { GoogleError } from '../gbp/client';
import { syncLocation, unlinkLocation, clientFor, discover } from '../gbp/service';
import { configureGuard, GUARD_FIELDS } from '../gbp/guard';
import { replySettingsSchema, saveReplySettings } from '../gbp/review-automation';
import { enqueue as enqueueContent, itemInput, scheduleInput } from '../gbp/content';
import { enqueue as enqueueScan, profileFor } from '../sitescan/worker';
import { siteUrl } from '../sitescan/http';
import { getEntitlements } from '../entitlements';
import { reserveQuotaFor, refundReservation } from '../growth-quotas';
import { accessFor, agencyPlanPaused, gbpSyncPaused, ownerHasPlan, filters, locationAccess, locationFilter, locationJoin, positiveId, requireWrite, clientAccess, workspaceEntitled, type AgencyAccess } from './access';
import { recordFailure } from '../ops/issues';
export const bulkInput = z.object({
  requestKey:z.string().uuid(), action:z.enum(['sync','unlink','link','guard','ai-replies','content','scan','assign']),
  selection:z.object({allMatching:z.boolean().default(false),ids:z.array(positiveId).max(50).default([]),filters:filters.default({})}).strict(),
  payload:z.unknown().default({}),
}).strict();
export function validatePayload(action:string, value:unknown) {
  if(action==='guard') return z.object({mode:z.enum(['off','notify','lockdown']),watched:z.array(z.enum(GUARD_FIELDS)).max(11)}).strict().parse(value);
  if(action==='ai-replies') return replySettingsSchema.parse(value);
  if(action==='content') return z.object({items:z.array(itemInput).min(1).max(100),schedule:scheduleInput,approved:z.literal(true)}).strict().parse(value);
  if(action==='assign') return z.object({clientId:positiveId}).strict().parse(value);
  return z.object({}).strict().parse(value);
}
export async function queueBulk(a:AgencyAccess,raw:unknown) {
  requireWrite(a);
  const b=bulkInput.parse(raw),payload=validatePayload(b.action,b.payload);
  if(b.action==='assign') await clientAccess(a,(payload as any).clientId);
  if(!b.selection.allMatching&&!b.selection.ids.length) throw new GoogleError('invalid','Select locations',400);
  // Individual selection must fail as a whole when even one ID is outside scope.
  if(!b.selection.allMatching) for(const id of b.selection.ids) await locationAccess(a,id,true);
  const w=locationFilter(a,b.selection.filters),c=await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query('SELECT pg_advisory_xact_lock(7160,$1)',[a.owner]);
    const {rows:[prior]}=await c.query('SELECT count(*)::int n,bool_and(actor_id=$3 AND action=$4 AND payload=$5::jsonb) same FROM agency_jobs WHERE user_id=$1 AND batch_id=$2',[a.owner,b.requestKey,a.actor,b.action,JSON.stringify(payload)]);
    if(prior.n&&!prior.same)throw new GoogleError('invalid','Submission key already used for a different action',409);
    if(prior.n) {await c.query('COMMIT');return {batchId:b.requestKey,queued:prior.n,reused:true};}
    const {rows:[pending]}=await c.query("SELECT count(*)::int n FROM agency_jobs WHERE user_id=$1 AND status IN ('queued','running')",[a.owner]);
    const match=`${w.sql} AND ($8::boolean OR l.id=ANY($9::int[]))`;
    const params=[...w.values,b.selection.allMatching,b.selection.ids];
    const {rows:[count]}=await c.query(`SELECT count(*)::int n FROM ${locationJoin} WHERE ${match}`,params);
    if(count.n*Buffer.byteLength(JSON.stringify(payload))>64*1024*1024)throw new GoogleError('quota','This batch is too large. Use fewer content items or a smaller selection.',429);
    if(pending.n+count.n>20000) throw new GoogleError('quota','Queue is full (20,000 pending). Wait for existing work to finish.',429);
    if(!await takeBudget(`agency-bulk:${a.owner}`,60)) throw new GoogleError('quota','Bulk request limit reached',429);
    const inserted=await c.query(`INSERT INTO agency_jobs(id,user_id,actor_id,location_id,action,payload,batch_id)
      SELECT gen_random_uuid(),l.user_id,$10,l.id,$11,$12,$13 FROM ${locationJoin} WHERE ${match} ON CONFLICT DO NOTHING RETURNING id`,[...params,a.actor,b.action,JSON.stringify(payload),b.requestKey]);
    await c.query('COMMIT');
    await logActivity(null,a.owner,'agency.bulk_queued',{actorId:a.actor,action:b.action,count:inserted.rowCount,batchId:b.requestKey});
    return {batchId:b.requestKey,queued:inserted.rowCount};
  }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
}
export async function queueSync(user:number,id:number,priority=10) {
  await pool.query(`INSERT INTO agency_jobs(id,user_id,actor_id,location_id,action,batch_id,priority) VALUES($1,$2,$2,$3,'sync',$1,$4) ON CONFLICT DO NOTHING`,[randomUUID(),user,id,priority]);
}
/** Verified discovery is cached by a worker, never by a list request. */
export async function refreshDiscovery(user:number,subject:string,make=clientFor) {
  const d=await discover(make(user,subject));
  for(const l of d.locations) await pool.query(`INSERT INTO agency_discovery(user_id,subject,account,location,data) VALUES($1,$2,$3,$4,$5)
    ON CONFLICT(user_id,subject,account,location) DO UPDATE SET data=$5,seen_at=now()`,[user,subject,l.accountResource,l.gbpName,JSON.stringify(l)]);
  if(!d.errors.length) await pool.query(`DELETE FROM agency_discovery WHERE user_id=$1 AND subject=$2 AND NOT(location=ANY($3::text[]))`,[user,subject,d.locations.map(l=>l.gbpName)]);
  return d;
}
export async function linkCached(user:number,id:number) {
  const l=await locationAccess(await accessFor(user),id);
  if(!l.place_id) throw new GoogleError('invalid','A Place ID is required to link this location',409);
  const {rows}=await pool.query(`SELECT d.* FROM agency_discovery d JOIN gbp_grants g ON g.user_id=d.user_id AND g.google_subject=d.subject AND NOT g.reconnect_required
    WHERE d.user_id=$1 AND d.data->>'placeId'=$2 AND d.seen_at>now()-interval '24 hours' ORDER BY d.seen_at DESC LIMIT 2`,[user,l.place_id]);
  if(!rows.length) throw new GoogleError('invalid','No verified match in the Google cache. Refresh Google listings first.',409);
  if(rows.length>1&&rows[0].location!==rows[1].location) throw new GoogleError('invalid','Ambiguous Google match; review the listing',409);
  const d=rows[0];
  await pool.query('UPDATE business_locations SET gbp_account_name=$3,gbp_location_name=$4,gbp_google_subject=$5,gbp_unlinked_by_user=false WHERE user_id=$1 AND id=$2',[user,id,d.account,d.location,d.subject]);
  await queueSync(user,id);
}
export async function performJob(j:any) {
  const a=await accessFor(j.actor_id,j.user_id);
  await locationAccess(a,j.location_id,true); // Revocations/assignment changes take effect while queued.
  switch(j.action) {
    case 'sync': {
      const result=await syncLocation(j.user_id,j.location_id);
      if(Object.values(result).some((r:any)=>r?.kind)) throw new GoogleError('transient','Sync incomplete; see the location sync errors',503);
      return result;
    }
    case 'unlink': return unlinkLocation(j.user_id,j.location_id);
    case 'link': return linkCached(j.user_id,j.location_id);
    case 'guard': return configureGuard(j.user_id,j.location_id,j.payload.mode,j.payload.watched);
    case 'ai-replies': return saveReplySettings(j.user_id,j.location_id,replySettingsSchema.parse(j.payload));
    case 'assign': {
      await clientAccess(a,j.payload.clientId);
      return pool.query('UPDATE business_locations SET agency_client_id=$3 WHERE user_id=$1 AND id=$2',[j.user_id,j.location_id,j.payload.clientId]).then(()=>({assigned:true}));
    }
    case 'content': return enqueueContent(j.user_id,j.location_id,{...j.payload,requestKey:j.id});
    case 'scan': {
      const p=await profileFor(j.user_id,j.location_id);
      if(!p?.website) throw new GoogleError('invalid','Sync a Google profile with a website before scanning',409);
      // Each scan spends one of the owner's monthly Site Scans (Agency: one per billed location), like a scan
      // started on the Site Scan page. A used-up month fails the job with the plan's own sentence.
      const q=await reserveQuotaFor(j.user_id,'siteScans',1);
      if(!q.ok) throw new GoogleError('invalid',String(q.body.message??'Site Scan is not included with the current plan'),q.status);
      try {
        if(!await takeBudget('sitescan:scan:'+j.user_id,5,1,86400000)) throw new GoogleError('quota','Daily Site Scan budget reached; deferred',429);
        return {id:await enqueueScan(j.user_id,siteUrl(p.website),150,1,p)};
      } catch(e) { await refundReservation(q.reservation,1); throw e; }
    }
    default: throw new GoogleError('invalid','Unknown queued action',400);
  }
}
/** Cross-process lock avoids duplicate dispatch; oldest tenant turn + priority aging prevent starvation.
 * `onlyUser` narrows a run to one owner (tests on a shared database). */
export async function runAgencyJobs(perform=performJob,limit=10,onlyUser?:number) {
  const c=await pool.connect();let locked=false;
  try {
    locked=(await c.query('SELECT pg_try_advisory_lock(7161,1) locked')).rows[0].locked;if(!locked)return;
    await c.query(`UPDATE agency_jobs SET status=CASE WHEN action='scan' THEN 'failed' ELSE 'queued' END,error='Worker interrupted; check results',due_at=now() WHERE status='running' AND ($1::int IS NULL OR user_id=$1)`,[onlyUser??null]);
    for(let i=0;i<limit;i++) {
      const {rows:[j]}=await c.query(`UPDATE agency_jobs SET status='running',started_at=now(),attempts=attempts+1 WHERE id=(
        SELECT j.id FROM agency_jobs j LEFT JOIN agency_worker_turns t ON t.user_id=j.user_id WHERE j.status='queued' AND j.due_at<=now() AND ($1::int IS NULL OR j.user_id=$1)
        ORDER BY COALESCE(t.last_at,'epoch'),(j.priority-LEAST(20,EXTRACT(EPOCH FROM(now()-j.created_at))/1800)),j.created_at,j.id LIMIT 1) RETURNING *`,[onlyUser??null]);
      if(!j)break;
      await c.query('INSERT INTO agency_worker_turns(user_id,last_at) VALUES($1,clock_timestamp()) ON CONFLICT(user_id) DO UPDATE SET last_at=clock_timestamp()',[j.user_id]);
      // Bulk actions belong to the agency workspace and follow the owner's current plan. Syncs are every plan's
      // own Google sync queue (scheduleSyncs, queueSync): they run on any active plan, and not without one.
      if(j.action!=='sync'&&!await workspaceEntitled(j.user_id,j.actor_id)) {
        await c.query("UPDATE agency_jobs SET status='failed',error=$2,finished_at=now() WHERE id=$1",[j.id,agencyPlanPaused]);continue;
      }
      if(j.action==='sync'&&(await getEntitlements(j.user_id)).accessPlan===null) {
        await c.query("UPDATE agency_jobs SET status='failed',error=$2,finished_at=now() WHERE id=$1",[j.id,gbpSyncPaused]);continue;
      }
      try {
        const result=await perform(j);
        await c.query("UPDATE agency_jobs SET status='done',finished_at=now(),result=$2,error=NULL WHERE id=$1",[j.id,JSON.stringify(result??{})]);
      }catch(e) {
        const quota=e instanceof GoogleError&&e.kind==='quota';
        const retry=quota||(e instanceof GoogleError&&e.kind==='transient'&&j.attempts<5);
        // The issue desk: a job that failed for good on something other than the customer's own setup
        // (a code error, Google API disabled on our project, a sync that stayed transient through every retry).
        if(!retry&&!(e instanceof GoogleError&&['invalid','auth','permission'].includes(e.kind))) void recordFailure('job',`GBP ${j.action} job`,e,{jobId:j.id,action:j.action,attempts:j.attempts,locationId:j.location_id},e instanceof GoogleError?'warning':'error');
        const delay=e instanceof GoogleError&&e.kind==='quota'?3600:Math.min(3600,60*2**j.attempts);
        await c.query(`UPDATE agency_jobs SET status=$2,error=$3,attempts=attempts-CASE WHEN $5 THEN 1 ELSE 0 END,due_at=now()+$4*interval '1 second',finished_at=CASE WHEN $2='failed' THEN now() END WHERE id=$1`,[j.id,retry?'queued':'failed',e instanceof GoogleError?e.message:'Operation failed; review location configuration',delay,quota]);
      }
    }
  }finally{if(locked)await c.query('SELECT pg_advisory_unlock(7161,1)');c.release();}
}
/** Linked locations due a sync ($1: the owners to consider, or null for all). */
const syncDue=`FROM business_locations l
    JOIN gbp_grants g ON g.user_id=l.user_id AND g.google_subject=l.gbp_google_subject AND NOT g.reconnect_required
    WHERE ($1::int[] IS NULL OR l.user_id=ANY($1::int[]))
    AND (SELECT count(*) FROM agency_jobs q WHERE q.user_id=l.user_id AND q.status IN ('queued','running'))<19500
    AND l.gbp_location_name IS NOT NULL AND 'https://www.googleapis.com/auth/business.manage'=ANY(g.scopes)
    AND NOT EXISTS(SELECT 1 FROM gbp_sync_status s WHERE s.location_id=l.id AND s.last_attempt>now()-interval '6 hours')
    AND NOT EXISTS(SELECT 1 FROM agency_jobs j WHERE j.location_id=l.id AND j.action='sync' AND (j.status IN ('queued','running') OR j.created_at>now()-interval '6 hours'))`;
/** `onlyUser` narrows a run to one owner (tests on a shared database). */
export async function scheduleSyncs(onlyUser?:number) {
  // Bounded replenishment; only one live sync/location. Six-hour cadence and explicit user unlink respected.
  // Only owners with an active plan are synced (checked once per owner); the others stay due and are
  // picked up again once they have a plan.
  const {rows:owners}=await pool.query(`SELECT DISTINCT l.user_id ${syncDue}`,[onlyUser===undefined?null:[onlyUser]]);
  const allowed:number[]=[];
  for(const o of owners) if(await ownerHasPlan(o.user_id)) allowed.push(o.user_id);
  if(!allowed.length)return;
  await pool.query(`INSERT INTO agency_jobs(id,user_id,actor_id,location_id,action,batch_id,priority)
    SELECT gen_random_uuid(),l.user_id,l.user_id,l.id,'sync',gen_random_uuid(),20 ${syncDue}
    ORDER BY (SELECT max(last_attempt) FROM gbp_sync_status s WHERE s.location_id=l.id) NULLS FIRST,l.id LIMIT 500 ON CONFLICT DO NOTHING`,[allowed]);
}
export function startAgencyWorker() {
  if(process.env.GBP_SYNC_DISABLED==='true')return;
  const timer=setInterval(()=>void scheduleSyncs().then(()=>runAgencyJobs()).catch((e)=>{console.error('Agency queue tick failed');void recordFailure('job','Agency queue tick',e);}),15000);timer.unref();return timer;
}
