/**
 * Competitors in the rank tracker: how visible the site is on its tracked
 * keywords next to the competitors it follows ("share of voice"), which other
 * sites show up most on those keywords, and who leads the Google map pack.
 * All read from the result pages the weekly check already saved — free.
 */
import { z } from "zod";
import { pool } from "../db";
import { clickShare, CLICK_SHARE } from "./rank-history";

export const VOICE_SCHEMA_DDL = [
  `CREATE TABLE IF NOT EXISTS seo_site_competitors (
    site_id integer NOT NULL REFERENCES seo_sites(id) ON DELETE CASCADE,
    domain text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (site_id, domain)
  )`,
  // What the result page looked like at each check: the first ten organic results, and where each followed competitor stood.
  `ALTER TABLE seo_rank_checks ADD COLUMN IF NOT EXISTS serp_top jsonb`,
  `ALTER TABLE seo_rank_checks ADD COLUMN IF NOT EXISTS rivals jsonb`,
];

export const MAX_TRACKED_COMPETITORS = 5;
export const competitorInput = z.object({ domain: z.string().min(3).max(253) }).strict();

export type SerpEntry = { position: number; domain: string; url?: string | null; title?: string | null };
export type VoiceCheck = {
  keywordId: number; position: number | null; volume: number | null;
  serpTop: SerpEntry[] | null; rivals: Record<string, number | null> | null;
  localPack: { position: number; title: string; domain: string | null }[] | null;
};
export type VoiceRow = { domain: string; isSite: boolean; visibility: number; top3: number; top10: number; ranked: number; averagePosition: number | null };
export type Voice = {
  keywords: number;
  /** The site and the competitors it follows, most visible first. */
  domains: VoiceRow[];
  /** Other sites that appear in the top ten of the most tracked keywords. */
  seenMost: { domain: string; keywords: number; bestPosition: number }[];
  /** Who Google shows in the map pack on these keywords. */
  mapLeaders: { title: string; domain: string | null; keywords: number; isSite: boolean }[];
};

const bare = (d: string) => d.toLowerCase().replace(/^www\./, "");
const sameSite = (domain: string, target: string) => { const d = bare(domain); return d === target || d.endsWith(`.${target}`); };

/** Where `domain` stood on one check: its own position, the saved competitor position, or its place in the saved top ten. */
function positionOf(c: VoiceCheck, domain: string, isSite: boolean): number | null {
  if (isSite) return c.position;
  const saved = c.rivals?.[domain];
  if (typeof saved === "number") return saved;
  const hit = (c.serpTop ?? []).find((e) => sameSite(e.domain, domain));
  return hit ? hit.position : null;
}

/**
 * Share of voice from the newest check of each keyword. Visibility is the same
 * figure the rank tracker shows: 100% = first for every keyword, weighted by
 * search volume when every keyword has one. Pure, for tests.
 */
export function shareOfVoice(checks: VoiceCheck[], siteDomain: string, competitors: string[], isOurs: (entry: { title: string; domain: string | null }) => boolean = () => false): Voice {
  const site = bare(siteDomain), followed = competitors.map(bare);
  const weighted = checks.length > 0 && checks.every((c) => (c.volume ?? 0) > 0);
  const weight = (c: VoiceCheck) => (weighted ? (c.volume as number) : 1);
  const total = checks.reduce((a, c) => a + weight(c), 0);
  const row = (domain: string, isSite: boolean): VoiceRow => {
    const positions = checks.map((c) => positionOf(c, domain, isSite));
    const ranked = positions.filter((p): p is number => p !== null);
    const won = checks.reduce((a, c, i) => a + weight(c) * clickShare(positions[i]), 0);
    return {
      domain, isSite, ranked: ranked.length, top3: ranked.filter((p) => p <= 3).length, top10: ranked.filter((p) => p <= 10).length,
      averagePosition: ranked.length ? Math.round((ranked.reduce((a, b) => a + b, 0) / ranked.length) * 10) / 10 : null,
      visibility: total ? Math.round((won / total / CLICK_SHARE[0]) * 1000) / 10 : 0,
    };
  };
  const domains = [row(site, true), ...followed.map((d) => row(d, false))].sort((a, b) => b.visibility - a.visibility || Number(b.isSite) - Number(a.isSite) || a.domain.localeCompare(b.domain));

  const seen = new Map<string, { keywords: number; bestPosition: number }>();
  for (const c of checks) {
    const once = new Set<string>();
    for (const e of c.serpTop ?? []) {
      const d = bare(e.domain ?? "");
      if (!d || once.has(d) || sameSite(d, site) || followed.some((f) => sameSite(d, f))) continue;
      once.add(d);
      const s = seen.get(d) ?? { keywords: 0, bestPosition: e.position };
      s.keywords++; s.bestPosition = Math.min(s.bestPosition, e.position);
      seen.set(d, s);
    }
  }
  const seenMost = [...seen.entries()].map(([domain, s]) => ({ domain, ...s })).sort((a, b) => b.keywords - a.keywords || a.bestPosition - b.bestPosition || a.domain.localeCompare(b.domain)).slice(0, 12);

  const leaders = new Map<string, { title: string; domain: string | null; keywords: number; isSite: boolean }>();
  for (const c of checks) {
    const once = new Set<string>();
    for (const e of c.localPack ?? []) {
      const key = e.domain ? bare(e.domain) : e.title.toLowerCase();
      if (!key || once.has(key)) continue;
      once.add(key);
      const l = leaders.get(key) ?? { title: e.title, domain: e.domain ? bare(e.domain) : null, keywords: 0, isSite: (e.domain ? sameSite(e.domain, site) : false) || isOurs(e) };
      l.keywords++;
      leaders.set(key, l);
    }
  }
  const mapLeaders = [...leaders.values()].sort((a, b) => b.keywords - a.keywords || a.title.localeCompare(b.title)).slice(0, 10);
  return { keywords: checks.length, domains, seenMost, mapLeaders };
}

export async function trackedCompetitors(siteId: number): Promise<string[]> {
  const { rows } = await pool.query("SELECT domain FROM seo_site_competitors WHERE site_id=$1 ORDER BY created_at, domain", [siteId]);
  return rows.map((r: any) => r.domain);
}

/**
 * The checks of the site's most recent check day on one device — one cohort, not each keyword's own newest check, so
 * the figures compare like with like. `tracked` says how many keywords the site tracks in all.
 */
export async function latestChecks(siteId: number, device: "desktop" | "mobile"): Promise<{ checks: VoiceCheck[]; checkedOn: string | null; tracked: number }> {
  const { rows: [t] } = await pool.query("SELECT count(*)::int n FROM seo_keywords WHERE site_id=$1", [siteId]);
  const { rows } = await pool.query(
    `SELECT c.keyword_id AS "keywordId", c.position, k.search_volume AS volume, c.serp_top AS "serpTop", c.rivals, c.local_pack AS "localPack", c.checked_on::text AS "checkedOn"
       FROM seo_rank_checks c JOIN seo_keywords k ON k.id=c.keyword_id
      WHERE c.site_id=$1 AND c.device=$2 AND c.checked_on = (SELECT max(checked_on) FROM seo_rank_checks WHERE site_id=$1 AND device=$2)`, [siteId, device]);
  const arr = (v: unknown) => (Array.isArray(v) ? v : null);
  return {
    checks: rows.map((r: any) => ({ keywordId: r.keywordId, position: r.position, volume: r.volume, serpTop: arr(r.serpTop), rivals: r.rivals && typeof r.rivals === "object" && !Array.isArray(r.rivals) ? r.rivals : null, localPack: arr(r.localPack) })),
    checkedOn: rows[0]?.checkedOn ?? null, tracked: Number(t?.n ?? 0),
  };
}
