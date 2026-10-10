/**
 * Search Console as a rank source: Google's own average position for the site on a search, from the rows the Search
 * Console page already syncs (gsc_analytics, dimension "query"). Free. Country-wide, two to three days behind, an
 * average over the days the search was shown, and nothing about who else ranks or the map pack.
 */
import { pool } from "../../db";
import { gscAssetFor } from "../gsc-breakdown";
import type { RankObservation, RankQuery, RankSource } from "./types";

export const GSC_DAYS = 7;

export const gscSource: RankSource = {
  name: "gsc",
  label: "Google Search Console",
  async available(q) {
    const asset = await gscAssetFor(q.userId, q.domain, "query");
    if (!asset) return { ok: false, why: "Search Console is not connected for this site." };
    const { rows: [r] } = await pool.query("SELECT max(date) AS last FROM gsc_analytics WHERE asset_id=$1 AND dimension='query'", [asset.id]);
    return r?.last ? { ok: true } : { ok: false, why: "Search Console is connected but no search data has synced yet." };
  },
  async check(q) {
    const t0 = Date.now();
    const base: RankObservation = { source: "gsc", keyword: q.keyword, device: q.device, place: q.place ? { code: q.place.code, label: q.place.label } : null, position: null, url: null, top: [], mapPack: null, localPosition: null, features: [], costUsd: 0, ms: 0 };
    const asset = await gscAssetFor(q.userId, q.domain, "query");
    if (!asset) return { ...base, ms: Date.now() - t0, error: "not connected" };
    const { rows: [r] } = await pool.query(
      `SELECT count(*)::int AS days, avg(position) AS pos, sum(impressions)::int AS impr, sum(clicks)::int AS clicks, max(date)::text AS last
         FROM gsc_analytics WHERE asset_id=$1 AND dimension='query' AND lower(key)=lower($2)
          AND date > (SELECT max(date) FROM gsc_analytics WHERE asset_id=$1 AND dimension='query') - $3::int`,
      [asset.id, q.keyword, GSC_DAYS]);
    const ms = Date.now() - t0;
    if (!r?.days) return { ...base, ms, note: `Google did not return this search for the site in the last ${GSC_DAYS} synced days (rare searches are left out).` };
    return {
      ...base, ms, position: Math.round(Number(r.pos)),
      note: `average position ${Number(r.pos).toFixed(1)} over ${r.days} day${r.days === 1 ? "" : "s"}, ${r.impr} impressions, ${r.clicks} clicks, through ${r.last} (${q.place ? "country-wide, not the place" : "country-wide"})`,
    };
  },
};
