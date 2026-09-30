import { pool } from '../db';
import { logActivity, notifyUser } from '../account-events';
import { GoogleClient, GoogleError, mapLocation, mapPerformance, mapProfile, performancePath, resource, PROFILE_READ_MASK } from './client';
import { accessToken, grantUsable, invalidate, soleSubject } from './grants';
import type { PoolClient } from 'pg';
import { DatabaseLimiter } from './quota';
const quota = new DatabaseLimiter();
export const clientFor = (userId: number, subject: string|null = null) => new GoogleClient(() => accessToken(userId, subject), fetch, quota);
/** Listings across every connected Google account, each tagged with the account that manages it. */
export async function discoverAll(userId: number, make: typeof clientFor = clientFor) {
  const {rows:grants} = await pool.query(`SELECT google_subject,email FROM gbp_grants WHERE user_id=$1 AND NOT reconnect_required AND $2=ANY(scopes) ORDER BY updated_at DESC`,[userId,'https://www.googleapis.com/auth/business.manage']);
  if (!grants.length) throw new GoogleError('auth','Google Business Profile not connected. Connect a Google account.',401);
  const accounts: any[] = [], locations: any[] = [], errors: any[] = [];
  for (const g of grants) {
    try {
      const d = await discover(make(userId, g.google_subject));
      accounts.push(...d.accounts.map((a: any) => ({...a, grantSubject: g.google_subject, grantEmail: g.email})));
      locations.push(...d.locations.map((l: any) => ({...l, grantSubject: g.google_subject, grantEmail: g.email})));
      errors.push(...d.errors.map((e: any) => ({...e, grantEmail: g.email})));
    } catch (e) { errors.push({account: g.email, grantEmail: g.email, ...publicError(e)}); }
  }
  return { accounts, locations, errors };
}
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
export async function importLocations(userId: number, requested: any[], client?: GoogleClient) {
  if (!Array.isArray(requested) || !requested.length || requested.length > 100) throw new GoogleError('invalid','Select 1–100 locations',400);
  const discovered = client ? await discover(client) : await discoverAll(userId);
  const selected = requested.map(r => {
    const found = discovered.locations.find((l: any) => l.accountResource === r.accountResource && l.gbpName === r.gbpName && (!client ? l.grantSubject === r.grantSubject : true));
    if (!found) throw new GoogleError('permission','Selected location could not be verified with Google. Refresh the list.',403);
    return {...found, grantSubject: found.grantSubject ?? r.grantSubject ?? null};
  });
  const imported = [];
  for (const l of selected) {
    // A location the contractor added by Places search (same place, not yet linked) is linked in place
    // so its settings and citations carry over, instead of a duplicate row being created.
    // The same listing can be reachable through two Google accounts: keep one row, managed by the latest import.
    const {rows:[already]} = await pool.query('SELECT id FROM business_locations WHERE user_id=$1 AND gbp_location_name=$2 ORDER BY id LIMIT 1',[userId,l.gbpName]);
    if (already) {
      await pool.query('UPDATE business_locations SET gbp_account_name=$2,gbp_google_subject=$3,gbp_unlinked_by_user=false,updated_at=now() WHERE id=$1',[already.id,l.accountResource,l.grantSubject]);
    }
    if (!already && l.placeId) {
      const {rows:[linked]} = await pool.query(`UPDATE business_locations SET gbp_account_name=$2,gbp_location_name=$3,business_name=$4,gbp_google_subject=$6,gbp_unlinked_by_user=false,updated_at=now()
        WHERE id=(SELECT id FROM business_locations WHERE user_id=$1 AND gbp_location_name IS NULL AND place_id=$5 ORDER BY id LIMIT 1) RETURNING id`,
        [userId,l.accountResource,l.gbpName,l.businessName,l.placeId,l.grantSubject]);
      if (linked) { imported.push(linked); continue; }
    }
    const {rows:[row]} = await pool.query(`INSERT INTO business_locations(user_id,business_name,gbp_account_name,gbp_location_name,address,city,state,zip_code,country,phone,website,place_id,gbp_google_subject)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) ON CONFLICT(user_id,gbp_account_name,gbp_location_name)
      DO UPDATE SET business_name=$2,address=$5,city=$6,state=$7,zip_code=$8,country=$9,phone=$10,website=$11,place_id=$12,gbp_google_subject=$13,updated_at=now() RETURNING id`,
      [userId,l.businessName,l.accountResource,l.gbpName,l.address,l.city,l.state,l.zipCode,l.country,l.phone,l.website,l.placeId,l.grantSubject]);
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
export async function withLocationLock<T>(id: number, fn: (connection: PoolClient) => Promise<T>) {
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
export async function syncLocation(userId: number, id: number, client?: GoogleClient) {
  const l = await ownedLocation(userId,id);
  const subject = l.gbp_google_subject ?? await soleSubject(userId);
  client ??= clientFor(userId, subject);
  return withLocationLock(id, async c => {
    const result: Record<string,unknown> = {};
    let verified: boolean|undefined;
    for (const kind of ['profile','reviews','performance']) {
      await c.query(`INSERT INTO gbp_sync_status(location_id,kind,last_attempt) VALUES($1,$2,now()) ON CONFLICT(location_id,kind) DO UPDATE SET last_attempt=now()`,[id,kind]);
      try {
        if (kind === 'profile') {
          const info = await client.request('information',`/v1/${l.gbp_location_name}?readMask=${PROFILE_READ_MASK}`);
          const attrs = await client.request('information',`/v1/${l.gbp_location_name}/attributes`).then(r => r.attributes || []).catch(() => []);
          const parent = `${l.gbp_account_name}/${l.gbp_location_name}`;
          const media = await client.request('reviews',`/v4/${parent}/media?pageSize=1`).catch(() => null);
          const customerMedia = await client.request('reviews',`/v4/${parent}/media/customers?pageSize=1`).catch(() => null);
          const p = mapProfile(info, attrs);
          verified = !!info?.metadata?.hasVoiceOfMerchant;
          await c.query(`UPDATE business_locations SET business_name=COALESCE($2,business_name),phone=$3,website=$4,address=$5,city=$6,state=$7,zip_code=$8,country=COALESCE($9,country),
            categories=$10,description=$11,service_areas=$12,services=$13,hours=$14,opening_date=$15,open_status=COALESCE($16,open_status),
            place_id=COALESCE($17,place_id),google_cid=COALESCE($18,google_cid),
            social_profiles=COALESCE(social_profiles,'{}'::jsonb)||$19::jsonb,
            business_photo_count=COALESCE($20,business_photo_count),customer_photo_count=COALESCE($21,customer_photo_count),updated_at=now() WHERE id=$1`,
            [id,p.businessName,p.phone,p.website,p.address,p.city,p.state,p.zipCode,p.country,p.categories,p.description,p.serviceAreas,p.services,
             p.hours ? JSON.stringify(p.hours) : null,p.openingDate,p.openStatus,p.placeId,p.googleCid,JSON.stringify(p.social),
             typeof media?.totalMediaItemCount === 'number' ? media.totalMediaItemCount : null,
             typeof customerMedia?.totalMediaItemCount === 'number' ? customerMedia.totalMediaItemCount : null]);
          result.profile = {services:p.services.length,serviceAreas:p.serviceAreas.length,social:Object.keys(p.social).length};
        } else if (kind === 'reviews') {
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
          await c.query(`UPDATE business_locations SET review_count=s.n,avg_rating=s.avg,updated_at=now() FROM
            (SELECT count(*)::int n, round(avg(rating)::numeric,2)::real avg FROM google_profile_reviews WHERE user_id=$2 AND location_id=$1 AND NOT google_deleted AND google_review_id LIKE 'accounts/%') s WHERE id=$1`,[id,userId]);
          const { notifyNewReviews } = await import('./review-automation');
          await notifyNewReviews(userId,id);
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
          await c.query(`UPDATE business_locations SET monthly_views=COALESCE((SELECT sum(value)::int FROM gbp_daily_metrics WHERE location_id=$1 AND metric LIKE 'BUSINESS_IMPRESSIONS_%' AND date>current_date-30),0) WHERE id=$1`,[id]);
          result.performance = {count:rows.length,available:rows.length>0};
        }
        await c.query('UPDATE gbp_sync_status SET last_success=now(),last_error=NULL WHERE location_id=$1 AND kind=$2',[id,kind]);
      } catch(e) {
        const error = publicError(e);
        // Google only shares performance for listings whose owner it has verified (voice of merchant).
        if (kind === 'performance' && verified === false && error.kind === 'permission') error.message = 'Google only shares performance stats for verified listings. Verify this listing in Google Business Profile, then sync again.';
        result[kind] = error;
        await c.query('UPDATE gbp_sync_status SET last_error=$3 WHERE location_id=$1 AND kind=$2',[id,kind,error.message]);
        if(e instanceof GoogleError && e.kind==='auth') await invalidate(userId, subject);
      }
    }
    return result;
  });
}
export async function reply(userId: number,id: number,comment: string, action: 'draft'|'publish'|'delete',client?: GoogleClient, opts: { req?: any; expectedDraft?: string } = {}) {
  const { req, expectedDraft } = opts;
  if(typeof comment !== 'string' || comment.length > 4096 || (action==='publish' && !comment.trim())) throw new GoogleError('invalid','Reply must contain 1–4096 characters',400);
  const {rows:[review]} = await pool.query('SELECT * FROM google_profile_reviews WHERE id=$1 AND user_id=$2',[id,userId]);
  if(!review) throw new GoogleError('invalid','Review not found',404);
  if(action==='draft') {
    const save = async () => {
      const {rows:[r]} = await pool.query('UPDATE google_profile_reviews SET reply_draft=$3,updated_at=now() WHERE id=$1 AND user_id=$2 RETURNING *',[id,userId,comment||null]);
      return {replyStatus:r.reply_status,replyDraft:r.reply_draft};
    };
    return review.location_id ? withLocationLock(review.location_id,save) : save();
  }
  const l = await ownedLocation(userId,review.location_id);
  const subject = l.gbp_google_subject ?? await soleSubject(userId);
  if(!(await grantUsable(userId, subject))) throw new GoogleError('auth','Reconnect the Google account that manages this listing, or save your reply as a draft.',401);
  client ??= clientFor(userId, subject);
  if(review.google_deleted || !review.google_review_id?.startsWith(`${l.gbp_account_name}/${l.gbp_location_name}/reviews/`)) throw new GoogleError('invalid','This review is not an active Google review. Save a draft instead.',400);
  return withLocationLock(l.id,async c => {
    if(expectedDraft!==undefined) {
      const {rows:[fresh]}=await c.query('SELECT reply_comment,reply_draft,google_deleted FROM google_profile_reviews WHERE id=$1 AND user_id=$2',[id,userId]);
      if(!fresh||fresh.reply_comment||fresh.google_deleted||fresh.reply_draft!==expectedDraft)throw new GoogleError('invalid','Review changed while generating. Review it manually.',409);
    }
    // Keep the last confirmed reply intact until Google acknowledges the operation.
    if(action==='publish') await c.query('UPDATE google_profile_reviews SET reply_draft=$2 WHERE id=$1',[id,comment]);
    try {
      const response = await client.request('reviews',`/v4/${review.google_review_id}/reply`,action==='delete'?'DELETE':'PUT',action==='delete'?undefined:{comment});
      if(action==='publish' && typeof response.comment !== 'string') throw new GoogleError('transient','Google did not confirm the reply. Sync before retrying.',503);
      const {rows:[r]} = await c.query(`UPDATE google_profile_reviews SET reply_comment=$2,reply_date=$3,reply_status=$4,reply_draft=NULL,reply_error=NULL,updated_at=now() WHERE id=$1 RETURNING *`,
        [id,action==='delete'?null:response.comment,action==='delete'?null:response.updateTime||new Date(),action==='delete'?'draft':'posted']);
      await logActivity(req ?? null,userId,action==='delete'?'gbp.reply_deleted':'gbp.reply_posted',{reviewId:id,locationId:l.id,ai:expectedDraft!==undefined});
      if(action==='publish') await notifyUser(userId,'gbp.reply_posted',{title:'Reply posted to Google',body:l.business_name,link:'/google-reviews'});
      return {replyStatus:r.reply_status,replyComment:r.reply_comment};
    } catch(e) {
      await c.query('UPDATE google_profile_reviews SET reply_error=$2 WHERE id=$1',[id,publicError(e).message]);
      if(e instanceof GoogleError && e.kind==='auth') await invalidate(userId, subject);
      throw e;
    }
  });
}
let workerBusy = false;
export async function runGbpWorker(sync = syncLocation) {
  if(workerBusy) return; workerBusy=true;
  try {
    const {rows} = await pool.query(`SELECT DISTINCT l.id,l.user_id FROM business_locations l JOIN gbp_grants g ON g.user_id=l.user_id
      AND (g.google_subject=l.gbp_google_subject OR (l.gbp_google_subject IS NULL AND (SELECT count(*) FROM gbp_grants x WHERE x.user_id=l.user_id)=1))
      WHERE l.gbp_location_name IS NOT NULL AND NOT g.reconnect_required AND $1=ANY(g.scopes)
      AND NOT EXISTS(SELECT 1 FROM gbp_sync_status s WHERE s.location_id=l.id AND s.last_attempt>now()-interval '6 hours') ORDER BY l.id LIMIT 100`,['https://www.googleapis.com/auth/business.manage']);
    for(const l of rows) {try {await sync(l.user_id,l.id);} catch {/* next tick retries; no token/provider payload logging */}}
  } catch {console.error('GBP scheduled sync failed');} finally {workerBusy=false;}
}
export function startGbpWorker() {
  if (process.env.GBP_SYNC_DISABLED === "true") return;
  const timer=setInterval(()=>void runGbpWorker(),60_000);timer.unref();return timer;
}

/** After a Google account connects: link the contractor's matching Places-added rows and fully sync
 *  every listing that account manages, so the Locations pages fill in without further clicks. */
export async function autoLinkAndSync(userId: number, subject: string) {
  const d = await discover(clientFor(userId, subject));
  const {rows} = await pool.query('SELECT place_id FROM business_locations WHERE user_id=$1 AND gbp_location_name IS NULL AND place_id IS NOT NULL AND NOT gbp_unlinked_by_user',[userId]);
  const wanted = new Set(rows.map(r => r.place_id));
  const toLink = d.locations.filter((l: any) => l.placeId && wanted.has(l.placeId)).map((l: any) => ({...l, grantSubject: subject}));
  if (toLink.length) await importLocations(userId, toLink);
  const {rows:mine} = await pool.query('SELECT id FROM business_locations WHERE user_id=$1 AND gbp_google_subject=$2 AND gbp_location_name IS NOT NULL',[userId,subject]);
  for (const l of mine) await syncLocation(userId, l.id).catch(() => null);
}

/** Stop syncing one location: drop its Google link and the Google data synced for it; keep the row. */
export async function unlinkLocation(userId: number, id: number) {
  return withLocationLock(id, async () => {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const {rowCount} = await c.query('UPDATE business_locations SET gbp_account_name=NULL,gbp_location_name=NULL,gbp_google_subject=NULL,gbp_unlinked_by_user=true,updated_at=now() WHERE id=$1 AND user_id=$2',[id,userId]);
    if (!rowCount) throw new GoogleError('invalid','Location not found',404);
    await c.query(`DELETE FROM google_profile_reviews WHERE user_id=$1 AND location_id=$2 AND google_review_id LIKE 'accounts/%/locations/%/reviews/%'`,[userId,id]);
    await c.query('DELETE FROM gbp_daily_metrics WHERE location_id=$1',[id]);
    await c.query('DELETE FROM gbp_sync_status WHERE location_id=$1',[id]);
    await c.query('DELETE FROM gbp_guard WHERE user_id=$1 AND location_id=$2',[userId,id]);
    await c.query('DELETE FROM gbp_guard_changes WHERE user_id=$1 AND location_id=$2',[userId,id]);
    await c.query('DELETE FROM gbp_reply_settings WHERE user_id=$1 AND location_id=$2',[userId,id]);
    await c.query('COMMIT');
  } catch (e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); }
  return { unlinked: true };
  });
}
