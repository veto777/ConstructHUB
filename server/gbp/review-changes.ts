/**
 * What changed between two review syncs of a listing: added, edited, removed, restored — kept as a log and
 * told to the owner. Owner 2026-10-15: "alpine exteriors had 107 reviews yesterday and now 106 today and i have no
 * clue which one vanished … competitors will report some of them which then causes the good reviews to be taken
 * down". A removed review keeps its full text here (google_profile_reviews.google_deleted + deleted_at), so the
 * owner can quote it when asking Google to put it back; an edited one keeps its previous version.
 */
import type { PoolClient } from 'pg';
import { notifyUser } from '../account-events';

export type ReviewBefore = { id: number; google_review_id: string; reviewer_name: string | null; rating: number | null; comment: string | null; review_date: Date | string | null; reply_comment: string | null; google_deleted: boolean };
export type ReviewAfter = { name: string; reviewer: string | null; rating: number | null; comment: string | null; date: Date | string | null; reply: string | null };
export type ReviewEvent = {
  kind: 'added' | 'edited' | 'removed' | 'restored';
  googleReviewId: string;
  reviewId: number | null;
  before: Partial<ReviewBefore> | null;
  after: Partial<ReviewAfter> | null;
};

const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

/** Pure: the events between the stored rows and Google's fresh list. The first sync of a listing is history, not news. */
export function reviewDiff(before: ReviewBefore[], after: ReviewAfter[]): ReviewEvent[] {
  if (!before.length) return [];
  const seen = new Map(after.map((r) => [r.name, r]));
  const had = new Map(before.map((r) => [r.google_review_id, r]));
  const events: ReviewEvent[] = [];
  for (const b of before) {
    const a = seen.get(b.google_review_id);
    if (!a) {
      if (!b.google_deleted) events.push({ kind: 'removed', googleReviewId: b.google_review_id, reviewId: b.id, before: b, after: null });
      continue;
    }
    if (b.google_deleted) { events.push({ kind: 'restored', googleReviewId: b.google_review_id, reviewId: b.id, before: b, after: a }); continue; }
    if ((b.rating ?? null) !== (a.rating ?? null) || text(b.comment) !== text(a.comment) || text(b.reviewer_name) !== text(a.reviewer))
      events.push({ kind: 'edited', googleReviewId: b.google_review_id, reviewId: b.id, before: b, after: a });
  }
  for (const a of after) if (!had.has(a.name)) events.push({ kind: 'added', googleReviewId: a.name, reviewId: null, before: null, after: a });
  return events;
}

/** Inside the sync transaction, after the upsert: mark the rows and write the log. */
export async function recordReviewChanges(c: PoolClient, userId: number, locationId: number, before: ReviewBefore[], after: ReviewAfter[]): Promise<ReviewEvent[]> {
  const events = reviewDiff(before, after);
  for (const e of events) {
    if (e.kind === 'removed') await c.query('UPDATE google_profile_reviews SET deleted_at=COALESCE(deleted_at,now()) WHERE id=$1', [e.reviewId]);
    if (e.kind === 'restored') await c.query('UPDATE google_profile_reviews SET deleted_at=NULL WHERE id=$1', [e.reviewId]);
    if (e.kind === 'edited') await c.query('UPDATE google_profile_reviews SET previous=$2,edited_at=now(),edit_count=edit_count+1 WHERE id=$1',
      [e.reviewId, JSON.stringify({ reviewer_name: e.before?.reviewer_name ?? null, rating: e.before?.rating ?? null, comment: e.before?.comment ?? null, review_date: e.before?.review_date ?? null })]);
    const reviewId = e.reviewId ?? (await c.query('SELECT id FROM google_profile_reviews WHERE user_id=$1 AND google_review_id=$2', [userId, e.googleReviewId])).rows[0]?.id ?? null;
    await c.query('INSERT INTO gbp_review_events(user_id,location_id,review_id,google_review_id,kind,before,after) VALUES($1,$2,$3,$4,$5,$6,$7)',
      [userId, locationId, reviewId, e.googleReviewId, e.kind, e.before ? JSON.stringify(pick(e.before)) : null, e.after ? JSON.stringify(pickAfter(e.after)) : null]);
  }
  return events;
}
const pick = (b: Partial<ReviewBefore>) => ({ reviewer_name: b.reviewer_name ?? null, rating: b.rating ?? null, comment: b.comment ?? null, review_date: b.review_date ?? null });
const pickAfter = (a: Partial<ReviewAfter>) => ({ reviewer_name: a.reviewer ?? null, rating: a.rating ?? null, comment: a.comment ?? null, review_date: a.date ?? null });

const stars = (n: number | null | undefined) => (n ? `${n}-star` : 'unrated');
const snippet = (s: string | null | undefined) => { const t = text(s); return t ? `“${t.length > 140 ? `${t.slice(0, 140).trim()}…` : t}”` : '(no text)'; };
const day = (d: Date | string | null | undefined) => { if (!d) return ''; const t = new Date(d); return Number.isNaN(t.getTime()) ? '' : t.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); };

/** Removed and edited reviews reach the owner at once (bell, email, push); many at once become one message. */
export async function notifyReviewChanges(userId: number, locationId: number, business: string, events: ReviewEvent[]) {
  const link = `/locations?location=${locationId}&tab=reviews`;
  const removed = events.filter((e) => e.kind === 'removed'), edited = events.filter((e) => e.kind === 'edited'), restored = events.filter((e) => e.kind === 'restored');
  const common = { link, actionUrl: link, actionLabel: 'Open Reviews' } as const;
  if (removed.length > 3) {
    await notifyUser(userId, 'gbp.review_removed', { ...common, severity: 'warning', title: `${removed.length} Google reviews disappeared from ${business}`,
      body: `Google no longer returns ${removed.length} reviews that were on the listing: ${removed.slice(0, 5).map((e) => `${stars(e.before?.rating)} by ${e.before?.reviewer_name || 'a reviewer'}`).join('; ')}${removed.length > 5 ? '; …' : ''}. Their full text is saved under Reviews → Removed, if you want to ask Google to restore them.` });
  } else for (const e of removed) {
    await notifyUser(userId, 'gbp.review_removed', { ...common, severity: 'warning', title: `A ${stars(e.before?.rating)} Google review disappeared from ${business}`,
      body: `${e.before?.reviewer_name || 'A reviewer'}${day(e.before?.review_date) ? `, ${day(e.before?.review_date)}` : ''}: ${snippet(e.before?.comment)}. Google no longer returns it. The full text is saved under Reviews → Removed, if you want to ask Google to restore it.` });
  }
  for (const e of edited) {
    const r0 = e.before?.rating ?? null, r1 = e.after?.rating ?? null;
    await notifyUser(userId, 'gbp.review_edited', { ...common, severity: r1 != null && r0 != null && r1 < r0 ? 'warning' : 'info', title: `A Google review on ${business} was edited`,
      body: `${e.after?.reviewer || e.before?.reviewer_name || 'A reviewer'}: ${r0 !== r1 ? `${stars(r0)} → ${stars(r1)}. ` : ''}Now ${snippet(e.after?.comment)}${text(e.before?.comment) !== text(e.after?.comment) ? ` (was ${snippet(e.before?.comment)})` : ''}.` });
  }
  for (const e of restored) {
    await notifyUser(userId, 'gbp.review_restored', { ...common, title: `A Google review is back on ${business}`,
      body: `${e.after?.reviewer || 'A reviewer'}'s ${stars(e.after?.rating)} review is on the listing again: ${snippet(e.after?.comment)}.` });
  }
}
