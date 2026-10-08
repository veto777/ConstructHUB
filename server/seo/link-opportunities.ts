/**
 * Site Audit → Internal links to add. A page of the site that ranks for a tracked keyword, and OTHER pages of the
 * site whose text uses that keyword's words but do not link to it: each is a place where a link (with those words
 * as its text) would point visitors and search engines at the page that is meant to rank. Built from the newest
 * crawl's saved pages (sitescan_jobs.state) and the newest rank checks — free.
 *
 * What it rests on, and what it does not claim: the crawl reads HTML only, so on a site whose links are added by
 * JavaScript nothing is suggested at all (it could not know which links exist). A phrase that is on most pages of
 * the site is menu or footer text and is left out. "Does not link" is judged leniently — http or https, with or
 * without "www" or a last slash all count as a link to the page. Whether a link there would read naturally is for a
 * person to decide: the words around the mention are shown.
 */
import { pool } from "../db";
import { auditDomainKey } from "./audit";
import { linksMeasurable, sameUrlKey, LINKS_PER_PAGE, type RawPage } from "./audit-pages";

export const LINK_OPP_MAX = 200, LINK_OPP_PER_TARGET = 10;
/** A keyword shorter than this, or of one short word, matches too much to mean anything. */
const MIN_PHRASE = 6;
export type OppPage = { url: string; status: number; noindex: boolean; title: string | null; text: string; links: string[] };
export type OppTarget = { keywordId: number; keyword: string; volume: number | null; position: number | null; /** The site's page that ranks for it. */ url: string };
export type LinkOpportunity = {
  keywordId: number; keyword: string; volume: number | null; position: number | null;
  /** The page that ranks, and the page that mentions the keyword without linking to it. */ to: string; from: string; fromTitle: string | null;
  /** The words around the first mention on the page, for a person to judge. */ context: string;
};
export type LinkOpportunities = {
  /** false = the crawl could not see the site's links (most pages link nowhere in their HTML): nothing can be said. */ linksMeasured: boolean;
  /** Tracked keywords whose ranking page is among the crawled pages — the ones looked for — and how many were left out as menu/footer text. */ targets: number; boilerplate: number;
  /** Tracked keywords that rank with a page the crawl did not reach, so nothing could be looked for. */ notCrawled: number;
  items: LinkOpportunity[]; /** More were found than are listed. */ more: number;
};

const flat = (s: string) => ` ${s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim()} `;
/** The words around the first mention (in the page's own letters), about 140 characters. */
function contextOf(text: string, keyword: string): string {
  const words = keyword.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  const re = new RegExp(`(?<![\\p{L}\\p{N}])${words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("[^\\p{L}\\p{N}]+")}(?![\\p{L}\\p{N}])`, "iu");
  const m = re.exec(text);
  if (!m) return "";
  const a = Math.max(0, m.index - 60), b = Math.min(text.length, m.index + m[0].length + 60);
  return `${a > 0 ? "…" : ""}${text.slice(a, b).replace(/\s+/g, " ").trim()}${b < text.length ? "…" : ""}`;
}

/** Pure. `pages` are the crawl's pages; `targets` the tracked keywords with the page that ranks for each. */
export function findLinkOpportunities(pages: readonly OppPage[], targets: readonly OppTarget[]): LinkOpportunities {
  const usable = pages.filter((p) => p.status >= 200 && p.status < 300 && !p.noindex && typeof p.text === "string");
  const measured = linksMeasurable(pages.map((p) => ({ url: p.url, status: p.status, links: p.links } as RawPage)));
  const byKey = new Map(usable.map((p) => [sameUrlKey(p.url), p] as const));
  const known = targets.filter((t) => byKey.has(sameUrlKey(t.url)));
  const empty = { linksMeasured: measured, targets: known.length, boilerplate: 0, notCrawled: targets.length - known.length, items: [], more: 0 };
  if (!measured || !known.length) return empty;
  const texts = usable.map((p) => ({ p, flat: flat(p.text), links: new Set((Array.isArray(p.links) ? p.links.slice(0, LINKS_PER_PAGE) : []).filter((l): l is string => typeof l === "string").map(sameUrlKey)) }));
  const all: LinkOpportunity[] = [];
  let boilerplate = 0;
  const done = new Set<string>(), perTarget = new Map<string, number>();
  // The keywords worth the most first: the ones closest to the first page of results, then the most searched.
  const order = [...known].sort((a, b) => Number((b.position ?? 99) <= 20) - Number((a.position ?? 99) <= 20) || (b.volume ?? -1) - (a.volume ?? -1) || (a.keyword < b.keyword ? -1 : 1));
  for (const t of order) {
    const phrase = flat(t.keyword);
    if (phrase.trim().length < MIN_PHRASE) continue;
    const target = sameUrlKey(t.url);
    const mentions = texts.filter((x) => sameUrlKey(x.p.url) !== target && x.flat.includes(phrase));
    // On most pages of the site: a menu, a footer, a slogan — not a mention in the page's own text.
    if (usable.length >= 6 && mentions.length > usable.length * 0.5) { boilerplate++; continue; }
    for (const x of mentions) {
      if (x.links.has(target)) continue;
      const pair = `${sameUrlKey(x.p.url)}\u0000${target}`;
      // One suggestion per pair of pages: the first (most valuable) keyword that finds it.
      if (done.has(pair)) continue;
      // At most LINK_OPP_PER_TARGET pages for one ranking page, whichever of its keywords found them.
      const n = perTarget.get(target) ?? 0;
      if (n >= LINK_OPP_PER_TARGET) break;
      done.add(pair); perTarget.set(target, n + 1);
      all.push({ keywordId: t.keywordId, keyword: t.keyword, volume: t.volume, position: t.position, to: t.url, from: x.p.url, fromTitle: x.p.title, context: contextOf(x.p.text, t.keyword) });
    }
  }
  return { ...empty, boilerplate, items: all.slice(0, LINK_OPP_MAX), more: Math.max(0, all.length - LINK_OPP_MAX) };
}

const HOST_SQL = `regexp_replace(regexp_replace(lower(url), '^https?://(www\\.)?', ''), '[/:?#].*$', '')`;
/** The crawl's pages WITH their text (cut to 60,000 characters a page), tolerant of a malformed stored crawl. */
const TEXT_PAGES_SQL = `COALESCE((SELECT jsonb_agg(jsonb_build_object(
    'url', p->>'url',
    'status', CASE WHEN jsonb_typeof(p->'status')='number' AND (p->>'status')::numeric BETWEEN 0 AND 999 THEN (p->>'status')::numeric::int ELSE 0 END,
    'noindex', COALESCE(p->'noindex' = 'true'::jsonb, false), 'title', p->>'title',
    'text', left(COALESCE(p->>'text', ''), 60000),
    'links', CASE WHEN jsonb_typeof(p->'links')='array' THEN COALESCE((SELECT jsonb_agg(l) FROM jsonb_array_elements(p->'links') WITH ORDINALITY x(l, n) WHERE n <= ${LINKS_PER_PAGE}), '[]'::jsonb) ELSE '[]'::jsonb END) ORDER BY ord)
  FROM jsonb_array_elements(CASE WHEN jsonb_typeof(state->'pages')='array' THEN state->'pages' ELSE '[]'::jsonb END) WITH ORDINALITY AS t(p, ord)
 WHERE jsonb_typeof(p)='object' AND p->>'url' IS NOT NULL AND ord <= 1000), '[]'::jsonb)`;

type Result = LinkOpportunities & { jobId: string; scannedAt: string | null; checkedOn: string | null };
/** Worked out once per crawl and newest rank check (the last few looked at). */
const worked = new Map<string, Result>();
/** null = no finished crawl of the site yet. */
export async function linkOpportunities(userId: number, site: { id: number; domain: string }): Promise<Result | null> {
  const { rows: [newest] } = await pool.query(
    `SELECT id FROM sitescan_jobs WHERE user_id=$1 AND status='completed' AND jsonb_typeof(report)='object' AND ${HOST_SQL}=$2 ORDER BY completed_at DESC LIMIT 1`, [userId, auditDomainKey(site.domain)]);
  if (!newest) return null;
  // Each tracked keyword's newest check in which the site ranked with a recorded page (either device; the better position).
  const { rows: targets } = await pool.query(
    `SELECT DISTINCT ON (c.keyword_id) c.keyword_id AS "keywordId", k.keyword, k.search_volume AS volume, c.position, c.url, c.checked_on::text AS "checkedOn"
       FROM seo_rank_checks c JOIN seo_keywords k ON k.id=c.keyword_id
      WHERE c.site_id=$1 AND k.user_id=$2 AND c.position IS NOT NULL AND c.url IS NOT NULL AND c.checked_on >= current_date - 35
      ORDER BY c.keyword_id, c.checked_on DESC, c.position ASC`, [site.id, userId]);
  const checkedOn = targets.map((t: any) => String(t.checkedOn)).sort().pop() ?? null;
  const cacheKey = `${userId}:${newest.id}:${site.id}:${checkedOn}:${targets.length}`;
  const kept = worked.get(cacheKey);
  if (kept) return kept;
  const { rows: [job] } = await pool.query(`SELECT id, completed_at, ${TEXT_PAGES_SQL} AS pages FROM sitescan_jobs WHERE id=$1 AND user_id=$2`, [newest.id, userId]);
  if (!job) return null;
  const result: Result = { ...findLinkOpportunities(job.pages as OppPage[], targets as OppTarget[]), jobId: job.id, scannedAt: job.completed_at ? new Date(job.completed_at).toISOString() : null, checkedOn };
  worked.set(cacheKey, result);
  if (worked.size > 20) worked.delete(worked.keys().next().value as string);
  return result;
}
