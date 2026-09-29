import { pool } from '../db';
import { GoogleClient, GoogleError, mapLocation, mapPerformance, performancePath, resource } from './client';
import { accessToken, grantStatus, invalidate } from './grants';
import type { PoolClient } from 'pg';
import { DatabaseLimiter } from './quota';
const quota = new DatabaseLimiter();
export const clientFor = (userId: number) => new GoogleClient(() => accessToken(userId), fetch, quota);
export async function discover(client: GoogleClient) {
  const accounts = await client.pages('accounts','/v1/accounts','accounts');
  const locations: any[] = [], errors: any[] = [];
  for (const account of accounts) {
    try {
      const rows = await client.pages('information',`/v1/${resource(account.name,'accounts')}/locations?readMask=name,title,storefrontAddress,websiteUri,phoneNumbers,metadata`,'locations');
      locations.push(...rows.map(l => mapLocation(account,l)));
    } catch (e) {
      if(e instanceof GoogleError && e.kind==='auth') throw e;
      errors.push({account:account.name,...publicError(e)});
    }
  }
  return { accounts, locations, errors };
}
export function publicError(e: unknown) { return e instanceof GoogleError ? {message:e.message,kind:e.kind,needsAuth:e.kind==='auth'} : {message:'GBP operation failed. Try again.',kind:'internal',needsAuth:false}; }
export async function importLocations(userId: number, requested: any[], client = clientFor(userId)) {
  if (!Array.isArray(requested) || !requested.length || requested.length > 100) throw new GoogleError('invalid','Select 1–100 locations',400);
  const discovered = await discover(client);
  const selected = requested.map(r => {
    const found = discovered.locations.find(l => l.accountResource === r.accountResource && l.gbpName === r.gbpName);
    if (!found) throw new GoogleError('permission','Selected location could not be verified with Google. Refresh the list.',403);
    return found;
  });
  const imported = [];
  for (const l of selected) {
    // A location the contractor added by Places search (same place, not yet linked) is linked in place
    // so its settings and citations carry over, instead of a duplicate row being created.
    const {rows:[already]} = await pool.query('SELECT id FROM business_locations WHERE user_id=$1 AND gbp_account_name=$2 AND gbp_location_name=$3',[userId,l.accountResource,l.gbpName]);
    if (!already && l.placeId) {
      const {rows:[linked]} = await pool.query(`UPDATE business_locations SET gbp_account_name=$2,gbp_location_name=$3,business_name=$4,updated_at=now()
        WHERE id=(SELECT id FROM business_locations WHERE user_id=$1 AND gbp_location_name IS NULL AND place_id=$5 ORDER BY id LIMIT 1) RETURNING id`,
        [userId,l.accountResource,l.gbpName,l.businessName,l.placeId]);
      if (linked) { imported.push(linked); continue; }
    }
    const {rows:[row]} = await pool.query(`INSERT INTO business_locations(user_id,business_name,gbp_account_name,gbp_location_name,address,city,state,zip_code,country,phone,website,place_id)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) ON CONFLICT(user_id,gbp_account_name,gbp_location_name)
      DO UPDATE SET business_name=$2,address=$5,city=$6,state=$7,zip_code=$8,country=$9,phone=$10,website=$11,place_id=$12,updated_at=now() RETURNING id`,
      [userId,l.businessName,l.accountResource,l.gbpName,l.address,l.city,l.state,l.zipCode,l.country,l.phone,l.website,l.placeId]);
    imported.push(row);
  }
  return { imported:imported.length, locations:imported, errors:discovered.errors };
}
export async function ownedLocation(userId: number, id: number) {
  const {rows:[l]} = await pool.query('SELECT * FROM business_locations WHERE id=$1 AND user_id=$2',[id,userId]);
  if (!l) throw new GoogleError('invalid','Location not found',404);
  resource(l.gbp_account_name,'accounts'); resource(l.gbp_location_name,'locations'); return l;
}
// A session advisory lock serializes sync and reply changes across worker/manual requests and processes.
async function withLocationLock<T>(id: number, fn: (connection: PoolClient) => Promise<T>) {
  const c = await pool.connect();
  try {
    const {rows:[r]} = await c.query('SELECT pg_try_advisory_lock(7142,$1) AS locked',[id]);
    if (!r.locked) throw new GoogleError('invalid','This location is already syncing or publishing. Try again.',409);
    try { return await fn(c); } finally { await c.query('SELECT pg_advisory_unlock(7142,$1)',[id]); }
  } finally { c.release(); }
}
export function mapReview(r: any, parent: string) {
  const name = r.name || `${parent}/reviews/${r.reviewId}`;
  if (!name.startsWith(`${parent}/reviews/`) || !/^accounts\/[\w-]+\/locations\/[\w-]+\/reviews\/[\w-]+$/.test(name)) throw new GoogleError('invalid','Invalid Google review resource');
  const rating = ['','ONE','TWO','THREE','FOUR','FIVE'].indexOf(r.starRating);
  if (rating < 1 || !r.createTime || !Number.isFinite(Date.parse(r.createTime))) throw new GoogleError('invalid','Invalid Google review response');
  return {name,rating,reviewer:r.reviewer?.displayName || 'Anonymous',photo:r.reviewer?.profilePhotoUrl || null,
    comment:r.comment || null,date:r.createTime,reply:r.reviewReply?.comment || null,replyDate:r.reviewReply?.updateTime || null};
}
export async function syncLocation(userId: number, id: number, client = clientFor(userId)) {
  const l = await ownedLocation(userId,id);
  return withLocationLock(id, async c => {
    const result: Record<string,unknown> = {};
    for (const kind of ['reviews','performance']) {
      await c.query(`INSERT INTO gbp_sync_status(location_id,kind,last_attempt) VALUES($1,$2,now()) ON CONFLICT(location_id,kind) DO UPDATE SET last_attempt=now()`,[id,kind]);
      try {
        if (kind === 'reviews') {
          const parent = `${l.gbp_account_name}/${l.gbp_location_name}`;
          const reviews = (await client.pages('reviews',`/v4/${parent}/reviews`,'reviews')).map(r => mapReview(r,parent));
          await c.query('BEGIN');
          try {
            // Only a complete successful snapshot can mark missing reviews deleted.
            await c.query(`UPDATE google_profile_reviews SET google_deleted=true WHERE user_id=$1 AND location_id=$2 AND google_review_id LIKE $3`,[userId,id,`${parent}/reviews/%`]);
            for (const r of reviews) await c.query(`INSERT INTO google_profile_reviews(user_id,location_id,google_review_id,reviewer_name,reviewer_photo_url,rating,comment,review_date,reply_comment,reply_date,reply_status,google_deleted)
              VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,false)
              ON CONFLICT(user_id,google_review_id) WHERE google_review_id LIKE 'accounts/%/locations/%/reviews/%'
              DO UPDATE SET reviewer_name=$4,reviewer_photo_url=$5,rating=$6,comment=$7,review_date=$8,reply_comment=$9,reply_date=$10,reply_status=$11,google_deleted=false,updated_at=now()`,
              [userId,id,r.name,r.reviewer,r.photo,r.rating,r.comment,r.date,r.reply,r.replyDate,r.reply?'posted':'draft']);
            await c.query('COMMIT');
          } catch(e) { await c.query('ROLLBACK'); throw e; }
          result.reviews = {count:reviews.length};
        } else {
          const {rows:[s]} = await c.query('SELECT cursor_date::text FROM gbp_sync_status WHERE location_id=$1 AND kind=$2',[id,kind]);
          const end = new Date(); end.setUTCDate(end.getUTCDate()-1);
          // First sync: 90 days. Later runs overlap seven days to collect delayed/corrected data.
          const start = s?.cursor_date ? new Date(`${s.cursor_date}T00:00:00Z`) : new Date(end);
          start.setUTCDate(start.getUTCDate()-(s?.cursor_date ? 7 : 89));
          const endString = end.toISOString().slice(0,10), startString = start.toISOString().slice(0,10);
          const rows = mapPerformance(await client.request('performance',performancePath(l.gbp_location_name,startString,endString)));
          await c.query('BEGIN');
          try {
            await c.query('DELETE FROM gbp_daily_metrics WHERE location_id=$1 AND date BETWEEN $2 AND $3',[id,startString,endString]);
            for (const r of rows) {
              if(r.date < startString || r.date > endString) throw new GoogleError('invalid','Google returned a metric outside the requested range');
              await c.query(`INSERT INTO gbp_daily_metrics(location_id,date,metric,value) VALUES($1,$2,$3,$4) ON CONFLICT(location_id,date,metric) DO UPDATE SET value=$4`,[id,r.date,r.metric,r.value]);
            }
            // Keep the initial backfill window until Google actually supplies data.
            if (rows.length) await c.query('UPDATE gbp_sync_status SET cursor_date=$2 WHERE location_id=$1 AND kind=$3',[id,endString,kind]);
            await c.query('COMMIT');
          } catch(e) {await c.query('ROLLBACK');throw e;}
          result.performance = {count:rows.length,available:rows.length>0};
        }
        await c.query('UPDATE gbp_sync_status SET last_success=now(),last_error=NULL WHERE location_id=$1 AND kind=$2',[id,kind]);
      } catch(e) {
        const error = publicError(e); result[kind] = error;
        await c.query('UPDATE gbp_sync_status SET last_error=$3 WHERE location_id=$1 AND kind=$2',[id,kind,error.message]);
        if(e instanceof GoogleError && e.kind==='auth') await invalidate(userId);
      }
    }
    return result;
  });
}
export async function reply(userId: number,id: number,comment: string, action: 'draft'|'publish'|'delete',client = clientFor(userId)) {
  if(typeof comment !== 'string' || comment.length > 4096 || (action==='publish' && !comment.trim())) throw new GoogleError('invalid','Reply must contain 1–4096 characters',400);
  const {rows:[review]} = await pool.query('SELECT * FROM google_profile_reviews WHERE id=$1 AND user_id=$2',[id,userId]);
  if(!review) throw new GoogleError('invalid','Review not found',404);
  if(action==='draft') {
    const {rows:[r]} = await pool.query('UPDATE google_profile_reviews SET reply_draft=$3,updated_at=now() WHERE id=$1 AND user_id=$2 RETURNING *',[id,userId,comment||null]);
    return {replyStatus:r.reply_status,replyDraft:r.reply_draft};
  }
  if(!(await grantStatus(userId)).connected) throw new GoogleError('auth','Reconnect Google Business Profile, or save your reply as a draft.',401);
  const l = await ownedLocation(userId,review.location_id);
  if(review.google_deleted || !review.google_review_id?.startsWith(`${l.gbp_account_name}/${l.gbp_location_name}/reviews/`)) throw new GoogleError('invalid','This review is not an active Google review. Save a draft instead.',400);
  return withLocationLock(l.id,async c => {
    // Keep the last confirmed reply intact until Google acknowledges the operation.
    if(action==='publish') await c.query('UPDATE google_profile_reviews SET reply_draft=$2 WHERE id=$1',[id,comment]);
    try {
      const response = await client.request('reviews',`/v4/${review.google_review_id}/reply`,action==='delete'?'DELETE':'PUT',action==='delete'?undefined:{comment});
      if(action==='publish' && typeof response.comment !== 'string') throw new GoogleError('transient','Google did not confirm the reply. Sync before retrying.',503);
      const {rows:[r]} = await c.query(`UPDATE google_profile_reviews SET reply_comment=$2,reply_date=$3,reply_status=$4,reply_draft=NULL,reply_error=NULL,updated_at=now() WHERE id=$1 RETURNING *`,
        [id,action==='delete'?null:response.comment,action==='delete'?null:response.updateTime||new Date(),action==='delete'?'draft':'posted']);
      return {replyStatus:r.reply_status,replyComment:r.reply_comment};
    } catch(e) {
      await c.query('UPDATE google_profile_reviews SET reply_error=$2 WHERE id=$1',[id,publicError(e).message]);
      if(e instanceof GoogleError && e.kind==='auth') await invalidate(userId);
      throw e;
    }
  });
}
let workerBusy = false;
export async function runGbpWorker(sync = syncLocation) {
  if(workerBusy) return; workerBusy=true;
  try {
    const {rows} = await pool.query(`SELECT l.id,l.user_id FROM business_locations l JOIN gbp_grants g ON g.user_id=l.user_id
      WHERE l.gbp_location_name IS NOT NULL AND NOT g.reconnect_required AND $1=ANY(g.scopes)
      AND NOT EXISTS(SELECT 1 FROM gbp_sync_status s WHERE s.location_id=l.id AND s.last_attempt>now()-interval '6 hours') ORDER BY l.id LIMIT 100`,['https://www.googleapis.com/auth/business.manage']);
    for(const l of rows) {try {await sync(l.user_id,l.id);} catch {/* next tick retries; no token/provider payload logging */}}
  } catch {console.error('GBP scheduled sync failed');} finally {workerBusy=false;}
}
export function startGbpWorker() {
  if (process.env.GBP_SYNC_DISABLED === "true") return;
  const timer=setInterval(()=>void runGbpWorker(),60_000);timer.unref();return timer;
}
