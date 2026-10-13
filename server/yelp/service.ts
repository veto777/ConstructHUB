/**
 * Yelp reputation: a user connects their Yelp business(es); we cache the rating + recent reviews and refresh sparingly
 * (the Fusion plan is small). Read-only — responding to a review happens on Yelp (the page deep-links each review).
 */
import { pool } from "../db";
import { YelpError, yelpConfigured, yelpSearch, yelpBusiness, yelpReviews, type YelpBiz, type YelpReview } from "./client";

/** How long cached rating/reviews are served before a list() refreshes them in the background of the request. */
export const YELP_TTL_MS = 12 * 60 * 60 * 1000;

export async function ensureYelpSchema(): Promise<void> {
  await pool.query(`CREATE TABLE IF NOT EXISTS yelp_businesses (
    id serial PRIMARY KEY,
    user_id integer NOT NULL,
    yelp_id text NOT NULL,
    name text NOT NULL,
    url text,
    image_url text,
    location text,
    phone text,
    rating real,
    review_count integer NOT NULL DEFAULT 0,
    reviews jsonb NOT NULL DEFAULT '[]'::jsonb,
    review_total integer NOT NULL DEFAULT 0,
    synced_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE(user_id, yelp_id)
  )`);
  await pool.query("CREATE INDEX IF NOT EXISTS yelp_businesses_user_idx ON yelp_businesses(user_id)");
}

export type YelpRow = { id: number; yelpId: string; name: string; url: string | null; imageUrl: string | null; location: string | null; phone: string | null; rating: number | null; reviewCount: number; reviews: YelpReview[]; reviewTotal: number; syncedAt: string | null; stale: boolean };

const row = (r: any): YelpRow => ({
  id: r.id, yelpId: r.yelp_id, name: r.name, url: r.url, imageUrl: r.image_url, location: r.location, phone: r.phone,
  rating: r.rating === null ? null : Number(r.rating), reviewCount: r.review_count, reviews: Array.isArray(r.reviews) ? r.reviews : [],
  reviewTotal: r.review_total, syncedAt: r.synced_at ? new Date(r.synced_at).toISOString() : null,
  stale: !r.synced_at || Date.now() - new Date(r.synced_at).getTime() > YELP_TTL_MS,
});

async function fetchAndStore(userId: number, yelpId: string, create: boolean): Promise<YelpRow> {
  const [biz, rev] = await Promise.all([yelpBusiness(yelpId), yelpReviews(yelpId).catch(() => ({ reviews: [] as YelpReview[], total: 0 }))]);
  const { rows: [r] } = await pool.query(
    `INSERT INTO yelp_businesses(user_id,yelp_id,name,url,image_url,location,phone,rating,review_count,reviews,review_total,synced_at)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,now())
     ON CONFLICT(user_id,yelp_id) DO UPDATE SET name=$3,url=$4,image_url=$5,location=$6,phone=$7,rating=$8,review_count=$9,reviews=$10,review_total=$11,synced_at=now()
     RETURNING *`,
    [userId, biz.yelpId, biz.name, biz.url, biz.imageUrl, biz.location, biz.phone, biz.rating, biz.reviewCount, JSON.stringify(rev.reviews), rev.total]);
  if (!create) { /* same path for refresh */ }
  return row(r);
}

/** Search Yelp for a business to connect, excluding ones this user already connected. */
export async function search(userId: number, term: string, location: string): Promise<(YelpBiz & { connected: boolean })[]> {
  if (!yelpConfigured()) throw new YelpError(503, "Yelp isn't available here yet");
  const results = await yelpSearch(term, location);
  const { rows } = await pool.query("SELECT yelp_id FROM yelp_businesses WHERE user_id=$1", [userId]);
  const have = new Set(rows.map((r) => r.yelp_id));
  return results.map((b) => ({ ...b, connected: have.has(b.yelpId) }));
}

/** Connect a Yelp business (by its Yelp id) and pull its rating + reviews now. */
export async function connect(userId: number, yelpId: string): Promise<YelpRow> {
  if (!yelpConfigured()) throw new YelpError(503, "Yelp isn't available here yet");
  const { rows } = await pool.query("SELECT count(*)::int AS n FROM yelp_businesses WHERE user_id=$1", [userId]);
  if (rows[0].n >= 50) throw new YelpError(400, "You can connect up to 50 Yelp businesses");
  return fetchAndStore(userId, yelpId, true);
}

/** The connected businesses with cached reputation; any past its TTL is refreshed in this call (bounded, best-effort). */
export async function list(userId: number): Promise<YelpRow[]> {
  const { rows } = await pool.query("SELECT * FROM yelp_businesses WHERE user_id=$1 ORDER BY created_at", [userId]);
  const out: YelpRow[] = [];
  for (const r of rows) {
    const cur = row(r);
    if (cur.stale && yelpConfigured()) { try { out.push(await fetchAndStore(userId, cur.yelpId, false)); continue; } catch { /* serve cached on failure */ } }
    out.push(cur);
  }
  return out;
}

/** Re-fetch one business now (the Refresh button). */
export async function refresh(userId: number, id: number): Promise<YelpRow> {
  const { rows: [r] } = await pool.query("SELECT yelp_id FROM yelp_businesses WHERE user_id=$1 AND id=$2", [userId, id]);
  if (!r) throw new YelpError(404, "That Yelp business isn't connected");
  return fetchAndStore(userId, r.yelp_id, false);
}

export async function disconnect(userId: number, id: number): Promise<{ removed: boolean }> {
  const { rowCount } = await pool.query("DELETE FROM yelp_businesses WHERE user_id=$1 AND id=$2", [userId, id]);
  return { removed: (rowCount ?? 0) > 0 };
}
