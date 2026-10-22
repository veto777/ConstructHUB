/**
 * Yelp reputation: a user connects their Yelp business(es); we cache rating + reviews + details and refresh sparingly
 * (small Fusion plan). Read-only — a reply is drafted by AI and posted by the owner on Yelp (no response API).
 * Also: daily rating/review snapshots (trend), a notification when the review count ticks up, and nearby competitors.
 */
import { pool } from "../db";
import { atCap, countCap } from "../admin-unlimited";
import { notifyUser } from "../account-events";
import { aiModel } from "../ai-config";
import { aiClient, aiComplete, NO_TOOLS_RULE } from "../ai-output";
import { YelpError, yelpConfigured, yelpSearch, yelpBusiness, yelpReviews, yelpNearby, type YelpBiz, type YelpReview } from "./client";

export const YELP_TTL_MS = 12 * 60 * 60 * 1000;

export async function ensureYelpSchema(): Promise<void> {
  await pool.query(`CREATE TABLE IF NOT EXISTS yelp_businesses (
    id serial PRIMARY KEY, user_id integer NOT NULL, yelp_id text NOT NULL,
    name text NOT NULL, url text, image_url text, location text, phone text,
    rating real, review_count integer NOT NULL DEFAULT 0,
    reviews jsonb NOT NULL DEFAULT '[]'::jsonb, review_total integer NOT NULL DEFAULT 0,
    synced_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(user_id, yelp_id)
  )`);
  await pool.query("CREATE INDEX IF NOT EXISTS yelp_businesses_user_idx ON yelp_businesses(user_id)");
  for (const [col, type] of [["categories", "jsonb NOT NULL DEFAULT '[]'::jsonb"], ["category_aliases", "jsonb NOT NULL DEFAULT '[]'::jsonb"],
    ["photos", "jsonb NOT NULL DEFAULT '[]'::jsonb"], ["price", "text"], ["is_open_now", "boolean"], ["lat", "real"], ["lng", "real"]] as const) {
    await pool.query(`ALTER TABLE yelp_businesses ADD COLUMN IF NOT EXISTS ${col} ${type}`);
  }
  await pool.query(`CREATE TABLE IF NOT EXISTS yelp_snapshots (
    business_id integer NOT NULL REFERENCES yelp_businesses(id) ON DELETE CASCADE,
    captured_on date NOT NULL DEFAULT current_date, rating real, review_count integer NOT NULL DEFAULT 0,
    PRIMARY KEY(business_id, captured_on)
  )`);
}

export type Trend = { reviewsGained30d: number; ratingDelta30d: number | null; days: number } | null;
export type YelpRow = YelpBiz & { id: number; reviews: YelpReview[]; reviewTotal: number; syncedAt: string | null; stale: boolean; trend: Trend };

const base = (r: any): Omit<YelpRow, "trend"> => ({
  id: r.id, yelpId: r.yelp_id, name: r.name, url: r.url, imageUrl: r.image_url, location: r.location, phone: r.phone,
  rating: r.rating === null ? null : Number(r.rating), reviewCount: r.review_count, reviews: Array.isArray(r.reviews) ? r.reviews : [],
  reviewTotal: r.review_total, categories: Array.isArray(r.categories) ? r.categories : [], photos: Array.isArray(r.photos) ? r.photos : [],
  price: r.price, isOpenNow: r.is_open_now, coordinates: r.lat === null ? null : { latitude: r.lat, longitude: r.lng }, distanceMi: null,
  syncedAt: r.synced_at ? new Date(r.synced_at).toISOString() : null,
  stale: !r.synced_at || Date.now() - new Date(r.synced_at).getTime() > YELP_TTL_MS,
});

/** Reviews gained and rating change over ~30 days, from the daily snapshots. */
async function trendFor(businessId: number): Promise<Trend> {
  const { rows } = await pool.query(
    `SELECT rating, review_count, captured_on FROM yelp_snapshots WHERE business_id=$1 AND captured_on >= current_date - 30 ORDER BY captured_on`, [businessId]);
  if (rows.length < 2) return null;
  const first = rows[0], last = rows[rows.length - 1];
  const days = Math.max(1, Math.round((new Date(last.captured_on).getTime() - new Date(first.captured_on).getTime()) / 86400000));
  return { reviewsGained30d: last.review_count - first.review_count, ratingDelta30d: first.rating === null || last.rating === null ? null : Number((last.rating - first.rating).toFixed(1)), days };
}

async function fetchAndStore(userId: number, yelpId: string, opts: { notify?: boolean } = {}): Promise<YelpRow> {
  const { rows: [prev] } = await pool.query("SELECT id, review_count FROM yelp_businesses WHERE user_id=$1 AND yelp_id=$2", [userId, yelpId]);
  const [biz, rev] = await Promise.all([yelpBusiness(yelpId), yelpReviews(yelpId).catch(() => ({ reviews: [] as YelpReview[], total: 0 }))]);
  const { rows: [r] } = await pool.query(
    `INSERT INTO yelp_businesses(user_id,yelp_id,name,url,image_url,location,phone,rating,review_count,reviews,review_total,categories,category_aliases,photos,price,is_open_now,lat,lng,synced_at)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,now())
     ON CONFLICT(user_id,yelp_id) DO UPDATE SET name=$3,url=$4,image_url=$5,location=$6,phone=$7,rating=$8,review_count=$9,reviews=$10,review_total=$11,categories=$12,category_aliases=$13,photos=$14,price=$15,is_open_now=$16,lat=$17,lng=$18,synced_at=now()
     RETURNING *`,
    [userId, biz.yelpId, biz.name, biz.url, biz.imageUrl, biz.location, biz.phone, biz.rating, biz.reviewCount, JSON.stringify(rev.reviews), rev.total,
     JSON.stringify(biz.categories), JSON.stringify(biz.categoryAliases), JSON.stringify(biz.photos), biz.price, biz.isOpenNow, biz.coordinates?.latitude ?? null, biz.coordinates?.longitude ?? null]);
  await pool.query("INSERT INTO yelp_snapshots(business_id,rating,review_count) VALUES($1,$2,$3) ON CONFLICT(business_id,captured_on) DO UPDATE SET rating=$2,review_count=$3", [r.id, biz.rating, biz.reviewCount]);
  // New-review alert: the stored count went up since last sync.
  if (opts.notify && prev && biz.reviewCount > prev.review_count) {
    const newest = rev.reviews[0];
    await notifyUser(userId, "yelp.new_review", {
      title: `New Yelp review for ${biz.name}`,
      body: newest ? `${newest.user.name} left ${newest.rating}★: "${newest.text.slice(0, 120)}"` : `Your Yelp review count rose to ${biz.reviewCount}.`,
      link: "/yelp", actionLabel: "Respond on Yelp", actionUrl: newest?.url ?? biz.url ?? undefined,
    }).catch((e) => console.warn("[yelp] notify:", (e as Error)?.message));
  }
  return { ...base(r), trend: await trendFor(r.id) };
}

export async function search(userId: number, term: string, location: string): Promise<(YelpBiz & { connected: boolean })[]> {
  if (!yelpConfigured()) throw new YelpError(503, "Yelp isn't available here yet");
  const results = await yelpSearch(term, location);
  const { rows } = await pool.query("SELECT yelp_id FROM yelp_businesses WHERE user_id=$1", [userId]);
  const have = new Set(rows.map((r) => r.yelp_id));
  return results.map((b) => ({ ...b, connected: have.has(b.yelpId) }));
}

export async function connect(userId: number, yelpId: string): Promise<YelpRow> {
  if (!yelpConfigured()) throw new YelpError(503, "Yelp isn't available here yet");
  const { rows } = await pool.query("SELECT count(*)::int AS n FROM yelp_businesses WHERE user_id=$1", [userId]);
  if (atCap(await countCap(userId, 50), rows[0].n)) throw new YelpError(400, "You can connect up to 50 Yelp businesses");
  return fetchAndStore(userId, yelpId);
}

export async function list(userId: number): Promise<YelpRow[]> {
  const { rows } = await pool.query("SELECT * FROM yelp_businesses WHERE user_id=$1 ORDER BY created_at", [userId]);
  const out: YelpRow[] = [];
  for (const r of rows) {
    const stale = !r.synced_at || Date.now() - new Date(r.synced_at).getTime() > YELP_TTL_MS;
    if (stale && yelpConfigured()) { try { out.push(await fetchAndStore(userId, r.yelp_id, { notify: true })); continue; } catch { /* serve cached */ } }
    out.push({ ...base(r), trend: await trendFor(r.id) });
  }
  return out;
}

export async function refresh(userId: number, id: number): Promise<YelpRow> {
  const { rows: [r] } = await pool.query("SELECT yelp_id FROM yelp_businesses WHERE user_id=$1 AND id=$2", [userId, id]);
  if (!r) throw new YelpError(404, "That Yelp business isn't connected");
  return fetchAndStore(userId, r.yelp_id, { notify: true });
}

export async function disconnect(userId: number, id: number): Promise<{ removed: boolean }> {
  const { rowCount } = await pool.query("DELETE FROM yelp_businesses WHERE user_id=$1 AND id=$2", [userId, id]);
  return { removed: (rowCount ?? 0) > 0 };
}

/** Competitors: same-category businesses near this one, best-rated first, excluding the business itself. */
export async function competitors(userId: number, id: number): Promise<(YelpBiz & { ahead: boolean })[]> {
  if (!yelpConfigured()) throw new YelpError(503, "Yelp isn't available here yet");
  const { rows: [r] } = await pool.query("SELECT yelp_id, lat, lng, rating, category_aliases FROM yelp_businesses WHERE user_id=$1 AND id=$2", [userId, id]);
  if (!r) throw new YelpError(404, "That Yelp business isn't connected");
  if (r.lat === null || r.lng === null) throw new YelpError(400, "No location on file for this business; refresh it first");
  const alias = (Array.isArray(r.category_aliases) ? r.category_aliases : [])[0] ?? "";
  const mine = r.rating === null ? null : Number(r.rating);
  const near = await yelpNearby(alias, r.lat, r.lng);
  return near.filter((b) => b.yelpId !== r.yelp_id).slice(0, 6).map((b) => ({ ...b, ahead: mine !== null && b.rating !== null ? b.rating > mine : false }));
}

/** Draft an owner reply to one Yelp review (the owner copies it and posts it on Yelp — Yelp has no reply API). */
export async function draftReply(userId: number, id: number, reviewId: string): Promise<{ reply: string }> {
  if (!process.env.AI_INTEGRATIONS_OPENAI_API_KEY) throw new YelpError(503, "AI replies aren't configured on the server");
  const { rows: [r] } = await pool.query("SELECT name, reviews FROM yelp_businesses WHERE user_id=$1 AND id=$2", [userId, id]);
  if (!r) throw new YelpError(404, "That Yelp business isn't connected");
  const review = (Array.isArray(r.reviews) ? r.reviews : []).find((x: YelpReview) => x.id === reviewId);
  if (!review) throw new YelpError(404, "That review isn't on file; refresh the business first");
  const messages = [
    { role: "system" as const, content:
      `Write a warm, professional reply from the business owner to this Yelp review, to be posted on Yelp. 2–4 sentences. ` +
      `Thank the reviewer by first name if given, acknowledge something specific they mentioned, and invite them back. ` +
      `Use ONLY the supplied facts — never invent services, visits, staff, dates, prices, refunds, policies, discounts, coupons, promo codes, or contact details. ` +
      `Plain text only, no markdown, no hashtags, no emoji.\n${NO_TOOLS_RULE}` },
    { role: "user" as const, content: JSON.stringify({ business: r.name, rating: review.rating, reviewer: review.user?.name ?? "", review: review.text ?? "" }) },
  ];
  const { text } = await aiComplete(aiClient({ timeoutFallbackMs: 30_000 }), { model: aiModel(), messages, max_tokens: 500 },
    { minChars: 10, sources: [r.name, review.text ?? ""], forbid: [/\b\d{1,3}\s?(?:%|percent)\s?(?:off|discount)\b/i, /\b(?:coupon|promo(?:tion(?:al)?)?|discount) codes?\b/i] });
  return { reply: text.trim() };
}
