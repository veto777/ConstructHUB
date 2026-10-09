/** Agency operations use cached data; only the worker calls Google/AI/publishing. */
import { z } from "zod";
import { pool } from "../db";
import { autoSchema, destinationSchema, postSchema, type Destination } from "../../shared/social";
import { SocialError } from "./client";
import { connection, clientFactory, createPosts, destinationKey, generateDue, ownedBusiness, saveSettings, userLock, type Generate, generateText } from "./service";
import { syncGbpSources } from "./gbp-sources";
import { logActivity } from "../account-events";
import { getEntitlements, planPausedMessage } from "../entitlements";

export const pageInput = z.object({
  search: z.string().trim().max(200).default(""),
  offset: z.coerce.number().int().min(0).max(10000000).default(0),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
export const businessIds = z.array(z.number().int().positive()).min(1).max(1000).refine(ids => new Set(ids).size === ids.length, "Duplicate businesses");
export async function assertBusinesses(userId: number, ids: number[]) {
  const { rows } = await pool.query("SELECT id FROM business_locations WHERE user_id=$1 AND id=ANY($2::int[])",[userId,ids]);
  if (rows.length !== ids.length) throw new SocialError("Business not found",404);
}
export async function listBusinesses(userId: number, raw: unknown) {
  const q = pageInput.extend({ linked: z.enum(["all","linked","unlinked"]).default("all") }).parse(raw);
  const where = `l.user_id=$1 AND (l.business_name ILIKE $2 OR l.city ILIKE $2 OR l.phone ILIKE $2)
    AND ($3='all' OR ($3='linked')=(l.gbp_location_name IS NOT NULL))`;
  const params = [userId,`%${q.search}%`,q.linked];
  const { rows: items } = await pool.query(`SELECT l.id,l.business_name,l.city,l.phone,l.gbp_location_name,
    COALESCE(s.settings->>'enabled','false')='true' AS auto_enabled
    FROM business_locations l LEFT JOIN social_settings s ON s.user_id=l.user_id AND s.business_id=l.id
    WHERE ${where} ORDER BY lower(l.business_name),l.id LIMIT $4 OFFSET $5`, [...params,q.limit,q.offset]);
  const { rows: [count] } = await pool.query(`SELECT count(*)::int total FROM business_locations l WHERE ${where}`,params);
  return { items,total:count.total };
}
export async function saveMapping(userId: number,businessId: number,raw: unknown) {
  const { destinations } = z.object({destinations:z.array(destinationSchema).max(20).refine(ds=>new Set(ds.map(destinationKey)).size===ds.length)}).strict().parse(raw);
  return userLock(userId,async c=>{
    const {client,accounts}=await connection(userId,clientFactory,businessId);
    for (const d of destinations) {
      const a=accounts.find(a=>a.id===d.accountId&&a.platform===d.platform);
      if (!a || (d.pageId&&!a.pages?.some((p:any)=>p.id===d.pageId)) || (d.boardId&&!a.boards?.some((p:any)=>p.id===d.boardId)))
        throw new SocialError("Choose a connected account and verified page/board");
      if(d.platform==='facebook'&&!d.pageId) throw new SocialError("Facebook requires a Page");
      if(d.platform==='pinterest'&&!d.boardId) throw new SocialError("Pinterest requires a board");
    }
    await c.query('BEGIN');
    try {
      await c.query(`INSERT INTO social_business_config(user_id,business_id,destinations,connection_hash) VALUES($1,$2,$3,$4)
        ON CONFLICT(business_id) DO UPDATE SET destinations=$3,connection_hash=$4`,[userId,businessId,JSON.stringify(destinations),client.hash]);
      // Mapping edits never silently authorize queued automatic work for a different destination.
      await c.query(`UPDATE social_settings SET settings=jsonb_set(settings,'{enabled}','false') WHERE user_id=$1 AND business_id=$2`,[userId,businessId]);
      await c.query("UPDATE social_posts SET state='draft' WHERE user_id=$1 AND business_id=$2 AND auto_generated AND approved_at IS NULL AND state='queued'",[userId,businessId]);
      await c.query("UPDATE social_bulk_jobs SET state='cancelled',error='Superseded by a newer business mapping' WHERE user_id=$1 AND business_id=$2 AND kind IN ('settings','generate') AND state='queued'",[userId,businessId]);
      await c.query('COMMIT');
    } catch(e) {await c.query('ROLLBACK');throw e;}
    await logActivity(null,userId,"social.auto_changed",{businessId,action:"map-destinations",count:destinations.length});
    return {destinations};
  });
}
export function expandVariables(text: string,business: {business_name:string;city:string|null;phone:string|null}) {
  const values:Record<string,string|null>={business:business.business_name,city:business.city,phone:business.phone};
  return text.replace(/\{(business|city|phone)\}/g,(_,key)=>{
    if (!values[key]?.trim()) throw new SocialError(`Missing ${key} for ${business.business_name}; update Locations before retrying`);
    return values[key]!;
  });
}
const bulkInput=z.object({
  requestId:z.string().uuid(),businessIds,
  kind:z.enum(["post","settings","sync","generate"]),
  text:z.string().trim().min(1).max(63206).optional(),
  draft:z.boolean().default(true),
  scheduledTime:z.string().datetime({offset:true}).optional(),
  mediaUrls:postSchema.shape.mediaUrls,
  enabled:z.boolean().default(true),mode:z.enum(["approval","automatic"]).default("approval"),
  cadence:z.number().int().min(1).max(7).default(1),period:z.enum(["day","week"]).default("week"),
  cadences:z.array(z.object({businessId:z.number().int().positive(),cadence:z.number().int().min(1).max(7),period:z.enum(["day","week"])}).strict()).max(1000).default([]),
}).strict().superRefine((v,c)=>{
  if(v.kind==='post'&&!v.text)c.addIssue({code:'custom',message:'Post text required'});
  if(new Set(v.cadences.map(c=>c.businessId)).size!==v.cadences.length||v.cadences.some(c=>!v.businessIds.includes(c.businessId)))c.addIssue({code:'custom',message:'Invalid cadence overrides'});
});
export async function enqueueBulk(userId:number,raw:unknown) {
  const input=bulkInput.parse(raw);
  await assertBusinesses(userId,input.businessIds);
  return userLock(userId,async c=>{
    const {rows:existing}=await c.query("SELECT business_id,payload FROM social_bulk_jobs WHERE user_id=$1 AND request_id=$2",[userId,input.requestId]);
    const payload={...input,businessIds:[...input.businessIds].sort((a,b)=>a-b),cadences:[...input.cadences].sort((a,b)=>a.businessId-b.businessId)};
    if(existing.length) {
      // Compare JSONB in Postgres, independent of key ordering.
      const {rows:[same]}=await c.query("SELECT bool_and(payload=$3::jsonb) AS same FROM social_bulk_jobs WHERE user_id=$1 AND request_id=$2",[userId,input.requestId,JSON.stringify(payload)]);
      if(existing.length!==input.businessIds.length||!same.same)throw new SocialError("Bulk request ID already used for different work",409);
      return {queued:existing.length,requestId:input.requestId};
    }
    if(input.scheduledTime&&Date.parse(input.scheduledTime)<Date.now())throw new SocialError("Choose a future schedule time");
    await c.query(`INSERT INTO social_bulk_jobs(user_id,business_id,request_id,kind,payload,destinations,connection_hash)
      SELECT $1,b.id,$3,$4,$5,c.destinations,c.connection_hash FROM unnest($2::int[]) AS b(id) LEFT JOIN social_business_config c ON c.user_id=$1 AND c.business_id=b.id`,[userId,input.businessIds,input.requestId,input.kind,JSON.stringify(payload)]);
    await logActivity(null,userId,"social.auto_changed",{action:`bulk-${input.kind}`,businesses:input.businessIds.length});
    return {queued:input.businessIds.length,requestId:input.requestId};
  });
}
export async function requestSync(userId:number,businessId:number) {
  await ownedBusiness(userId,businessId);
  await pool.query(`INSERT INTO social_business_config(user_id,business_id,sync_requested) VALUES($1,$2,true)
    ON CONFLICT(business_id) DO UPDATE SET sync_requested=true,sync_next_at=now(),sync_error=NULL`,[userId,businessId]);
  return {queued:true};
}
export async function runAgencyWorker(generate:Generate=generateText, sync=syncGbpSources) {
  const {rows:jobs}=await pool.query("SELECT * FROM social_bulk_jobs WHERE state='queued' ORDER BY id LIMIT 20");
  for(const job of jobs) {
    // A separate session lock covers the whole local operation; inner services retain the owner lock.
    const c=await pool.connect();
    try {
      const {rows:[lock]}=await c.query('SELECT pg_try_advisory_lock(8160,$1::int) locked',[job.id]);
      if(!lock.locked)continue;
      try {
        const fresh=await c.query("SELECT id FROM social_bulk_jobs WHERE id=$1 AND state='queued'",[job.id]);
        if(!fresh.rowCount)continue;
        const { modules } = await getEntitlements(job.user_id);
        const missing = !modules.socialPublishing ? "socialPublishing"
          : ['settings','generate'].includes(job.kind) && !modules.autoPosts ? "autoPosts" : null;
        if (missing) {
          await c.query("UPDATE social_bulk_jobs SET state='cancelled',error=$2 WHERE id=$1 AND state='queued'",[job.id,planPausedMessage(missing)]);
          continue;
        }
        const b=await ownedBusiness(job.user_id,job.business_id);
        const input=bulkInput.parse(job.payload);
        if(['post','settings'].includes(job.kind)) {
          const conn=await connection(job.user_id,clientFactory,job.business_id);
          if(job.connection_hash!==conn.client.hash)throw new SocialError('Connection changed after bulk request; review mapping and submit a new request',409);
        }
        if(job.kind==='post') {
          await createPosts(job.user_id,{requestId:input.requestId,text:expandVariables(input.text!,b),destinations:job.destinations||[],mediaUrls:input.mediaUrls,draft:input.draft,...(input.scheduledTime?{scheduledTime:input.scheduledTime}:{})},job.business_id);
        } else if(job.kind==='settings') {
          const {rows:[old]}=await c.query("SELECT settings FROM social_settings WHERE user_id=$1 AND business_id=$2",[job.user_id,job.business_id]);
          const override=input.cadences.find(c=>c.businessId===job.business_id);
          await saveSettings(job.user_id,{...autoSchema.parse(old?.settings||{}),destinations:job.destinations||[],enabled:input.enabled,mode:input.mode,cadence:override?.cadence??input.cadence,period:override?.period??input.period},job.business_id,String(job.id));
        } else if(job.kind==='sync') await requestSync(job.user_id,job.business_id);
        else {
          // Generation is never automatically retried after an interrupted paid call.
          await c.query("UPDATE social_bulk_jobs SET state='generating',error='Generation in progress or interrupted; inspect drafts before requesting again' WHERE id=$1",[job.id]);
          await userLock(job.user_id,c=>generateDue(c,job.user_id,generate,true,job.business_id));
        }
        await c.query("UPDATE social_bulk_jobs SET state='done',error=NULL WHERE id=$1",[job.id]);
      } catch(e) {
        if(e instanceof SocialError&&e.status===409&&e.message.includes('busy'))continue;
        await c.query("UPDATE social_bulk_jobs SET state='failed',error=$2 WHERE id=$1 AND state<>'cancelled'",[job.id,e instanceof SocialError?e.message:e instanceof z.ZodError?'Check business destinations and settings':'Could not complete business operation; review settings and retry']);
      } finally {await c.query('SELECT pg_advisory_unlock(8160,$1::int)',[job.id]);}
    } finally {c.release();}
  }
  const {rows:pending}=await pool.query("SELECT user_id,business_id FROM social_business_config WHERE sync_requested AND sync_next_at<=now() ORDER BY sync_next_at,business_id LIMIT 10");
  for(const item of pending) {
    try {
      await userLock(item.user_id,async()=>{
        // Reserve before network work to avoid immediate retries after a process interruption.
        const claimed=await pool.query("UPDATE social_business_config SET sync_next_at=now()+interval '1 hour' WHERE user_id=$1 AND business_id=$2 AND sync_requested AND sync_next_at<=now() RETURNING business_id",[item.user_id,item.business_id]);
        if(!claimed.rowCount)return;
        try {
          await sync(item.user_id,undefined,item.business_id);
          await pool.query("UPDATE social_business_config SET sync_requested=false,sync_error=NULL,synced_at=now() WHERE user_id=$1 AND business_id=$2",[item.user_id,item.business_id]);
        } catch {
          await pool.query("UPDATE social_business_config SET sync_error='GBP source refresh failed; check Google linkage. Retries in one hour.' WHERE user_id=$1 AND business_id=$2",[item.user_id,item.business_id]);
        }
      });
    } catch { /* Busy owners are retried next tick. */ }
  }
}
