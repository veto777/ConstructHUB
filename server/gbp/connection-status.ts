/**
 * Server side of the one Google-connection truth (shared/gbp-connection.ts): reads gbp_grants, the linked
 * business_locations, gbp_sync_status and the saved Google reviews, and derives the state every page shows.
 * GET /api/gbp/connection serves it; /api/gbp/status, /api/gbp/linkage and the home dashboard's Google tile
 * read the same function, so no page can disagree with another.
 */
import { pool } from '../db';
import { GBP_SCOPE } from './client';
import { deriveGoogleConnection, type GoogleConnection } from '@shared/gbp-connection';

type Query = (sql: string, params: unknown[]) => Promise<any[]>;
const viaPool: Query = async (sql, params) => (await pool.query(sql, params)).rows;

/** All of the user's locations, or only `locationIds` (an agency member's visible page, one location's detail). */
export async function loadGoogleConnection(userId: number, opts: { locationIds?: number[]; query?: Query } = {}): Promise<GoogleConnection> {
  const q = opts.query ?? viaPool;
  const ids = opts.locationIds ?? null;
  const [grants, locations] = await Promise.all([
    q('SELECT google_subject,email,scopes,reconnect_required FROM gbp_grants WHERE user_id=$1 ORDER BY updated_at DESC', [userId]),
    q(`SELECT l.id,l.business_name,l.gbp_location_name IS NOT NULL AS linked,l.gbp_google_subject,
        (SELECT max(s.last_success) FROM gbp_sync_status s WHERE s.location_id=l.id) AS last_success,
        (SELECT string_agg(s.last_error,'; ') FROM gbp_sync_status s WHERE s.location_id=l.id AND s.last_error IS NOT NULL) AS last_error,
        (SELECT max(r.created_at) FROM google_profile_reviews r WHERE r.user_id=l.user_id AND r.location_id=l.id AND r.google_review_id LIKE 'accounts/%') AS review_saved_at,
        (SELECT count(*)::int FROM google_profile_reviews r WHERE r.user_id=l.user_id AND r.location_id=l.id AND r.google_review_id LIKE 'accounts/%' AND NOT r.google_deleted) AS reviews
       FROM business_locations l WHERE l.user_id=$1 AND ($2::int[] IS NULL OR l.id=ANY($2::int[])) ORDER BY l.id`, [userId, ids]),
  ]);
  return deriveGoogleConnection({
    grants: grants.map((g) => ({
      subject: g.google_subject, email: g.email ?? null,
      usable: Array.isArray(g.scopes) && g.scopes.includes(GBP_SCOPE) && !g.reconnect_required,
    })),
    locations: locations.map((l) => ({
      id: l.id, name: l.business_name, linked: !!l.linked, subject: l.gbp_google_subject ?? null,
      lastSuccess: l.last_success ?? null, reviewSavedAt: l.review_saved_at ?? null, lastError: l.last_error ?? null, reviews: Number(l.reviews) || 0,
    })),
  });
}
