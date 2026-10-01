/**
 * The AI-free half of the GBP service: the pieces the public API (and the
 * session routes) need to look up an owned location and reply to a review
 * with text the caller wrote. ./service.ts re-exports everything here and
 * adds sync, discovery and the workers (whose import graph reaches the
 * TruthCoder reply automation); server/public-api/* imports THIS module only
 * (server/public-api/no-ai.test.ts walks the graph).
 */
import type { PoolClient } from 'pg';
import { pool } from '../db';
import { logActivity, notifyUser } from '../account-events';
import { GoogleClient, GoogleError, resource } from './client';
import { accessToken, grantUsable, invalidate, soleSubject } from './grants';
import { DatabaseLimiter } from './quota';

const quota = new DatabaseLimiter();
export const clientFor = (userId: number, subject: string|null = null) => new GoogleClient(() => accessToken(userId, subject), fetch, quota);

export function publicError(e: unknown) { return e instanceof GoogleError ? {message:e.message,kind:e.kind,needsAuth:e.kind==='auth'} : {message:'GBP operation failed. Try again.',kind:'internal',needsAuth:false}; }

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

export async function reply(userId: number,id: number,comment: string, action: 'draft'|'publish'|'delete',client?: GoogleClient, opts: { req?: any; expectedDraft?: string; expectedReview?: {rating:number;comment:string|null} } = {}) {
  const { req, expectedDraft, expectedReview } = opts;
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
      const {rows:[fresh]}=await c.query('SELECT reply_comment,reply_draft,google_deleted,rating,comment FROM google_profile_reviews WHERE id=$1 AND user_id=$2',[id,userId]);
      if(!fresh||fresh.reply_comment||fresh.google_deleted||fresh.reply_draft!==expectedDraft ||
        (expectedReview && (fresh.rating!==expectedReview.rating || fresh.comment!==expectedReview.comment))) {
        throw new GoogleError('invalid','Review changed while generating. Review it manually.',409);
      }
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
