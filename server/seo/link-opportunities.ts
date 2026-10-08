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
import { createHash } from "node:crypto";
import { pool } from "../db";
import { auditDomainKey, newestCrawl, readNewestCrawl, WELL_FORMED_SQL, type UnreadableCrawl } from "./audit";
import { linksMeasurable, sameUrlKey, type RawPage } from "./audit-pages";

export const LINK_OPP_MAX = 200, LINK_OPP_PER_TARGET = 10;
/** Every link the crawler kept for a page (it keeps up to 2,000) is read here: "already links" must not miss one. */
export const LINK_OPP_LINKS = 2000;
/**
 * A page's text as the crawler saved it: it keeps the first 16,000 characters of each page (server/sitescan/audit.ts),
 * so a mention further down is not seen — a page whose saved text reaches this length was cut (the view says so).
 */
export const LINK_OPP_TEXT = 16000;
/** A keyword shorter than this, or of one short word, matches too much to mean anything. */
export const MIN_PHRASE = 6;
/**
 * Menu or footer text, by a rule of thumb: a phrase on more than this share of the site's OTHER usable pages, when
 * there are at least BOILERPLATE_MIN_PAGES of them. The crawl does not keep which part of a page text came from, so
 * this is a frequency guess, and the view says so.
 */
export const BOILERPLATE_SHARE = 0.5, BOILERPLATE_MIN_PAGES = 5;
/** Crawls saved before the redirect-alias cap was raised and marked kept at most this many per page. */
const LEGACY_ALIAS_CAP = 20;
export type OppPage = { url: string; status: number; noindex: boolean; title: string | null; text: string; links: string[]; /** Addresses that redirected to this page in the crawl. */ redirects?: string[]; /** More redirected here than were kept; null/absent = a crawl from before this was recorded. */ redirectsCut?: boolean | null; canonical?: string | null };
export type OppTarget = {
  keywordId: number; keyword: string; volume: number | null; position: number | null; /** The site's page that ranks, in the keyword's newest check. */ url: string | null;
  /** The newest check of the keyword: its day, the device the position is from, the place it was checked from. */ checkedOn: string | null; device: string | null; place: string | null;
};
export type LinkOpportunity = {
  keywordId: number; keyword: string; volume: number | null; position: number | null; checkedOn: string | null; device: string | null; place: string | null;
  /** The page that ranks, and the page that mentions the keyword without linking to it. */ to: string; from: string; fromTitle: string | null;
  /** The words around the first mention on the page, for a person to judge. */ context: string;
  /** Stable identity of the suggested link (the two pages, as compared): the same link found through another keyword is the same task. */ pair: string;
};
export type LinkOpportunities = {
  /** false = the crawl could not see the site's links (most pages link nowhere in their HTML): nothing can be said. */ linksMeasured: boolean;
  /** Tracked keywords whose ranking page was crawled and usable, with words long enough to look for — the ones looked for. */ targets: number;
  /** Tracked keywords left out as menu or footer text (see BOILERPLATE_SHARE); not counted in `targets`. */ boilerplate: number;
  /** Tracked keywords not looked for, by reason: no ranking page in the newest check; the ranking page was not reached by the crawl; it was reached but answered an error, a redirect or noindex; the words are too short to mean anything. */
  notRanking: number; notCrawled: number; notUsable: number; tooShort: number;
  /** Ranking pages more addresses redirected to than the crawl kept: a page may already link through one of them, so nothing is suggested for them. */ aliasesCut: number;
  /** Pages whose text was longer than was read (LINK_OPP_TEXT): a mention further down is not seen. */ cutPages: number;
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
/** Identity of a suggested link: the two pages' identities (after aliases), hashed. */
export const pairOf = (fromKey: string, toKey: string) => createHash("sha256").update(`${fromKey}\u0000${toKey}`).digest("hex").slice(0, 24);
export const pairKey = (from: string, to: string) => pairOf(sameUrlKey(from), sameUrlKey(to));


/**
 * Which crawled page an address stands for, by what the crawl saw: the page itself, an address that redirected to it,
 * or a page whose canonical names it. Anything else is itself.
 */
export function aliasesOf(pages: readonly Pick<OppPage, "url" | "redirects" | "canonical">[]): (u: string) => string {
  const to = new Map<string, string>();
  for (const p of pages) {
    const k = sameUrlKey(p.url);
    for (const r of Array.isArray(p.redirects) ? p.redirects : []) if (typeof r === "string" && sameUrlKey(r) !== k) to.set(sameUrlKey(r), k);
  }
  for (const p of pages) {
    const k = sameUrlKey(p.url);
    if (typeof p.canonical === "string" && p.canonical && !to.has(k)) { const c = sameUrlKey(p.canonical); if (c !== k) to.set(k, c); }
  }
  // Followed to its end (redirect -> copy -> the page it names canonical) however long — the chain can be no longer
  // than the crawl's own addresses. A loop has no end: its addresses are left as themselves, whichever is asked about.
  return (u: string) => {
    const start = sameUrlKey(u);
    let k = start;
    for (const seen = new Set([k]); to.has(k); ) {
      const next = to.get(k)!;
      if (seen.has(next)) return start;
      seen.add(next); k = next;
    }
    return k;
  };
}

/** Pure. `pages` are the crawl's pages; `targets` the tracked keywords with their newest check. */
export function findLinkOpportunities(pages: readonly OppPage[], targets: readonly OppTarget[]): LinkOpportunities {
  const usable = pages.filter((p) => p.status >= 200 && p.status < 300 && !p.noindex && typeof p.text === "string");
  const measured = linksMeasurable(pages.map((p) => ({ url: p.url, status: p.status, links: p.links } as RawPage)));
  const resolve = aliasesOf(pages);
  // The page that stands for an identity is the page ITSELF (its own address is the identity) — never a copy that
  // names it canonical: when the page itself was not crawled, or not usable, nothing is suggested towards it.
  const crawled = new Set(pages.filter((p) => sameUrlKey(p.url) === resolve(p.url)).map((p) => sameUrlKey(p.url)));
  const byKey = new Map<string, OppPage>();
  for (const p of usable) { const k = resolve(p.url); if (sameUrlKey(p.url) === k && !byKey.has(k)) byKey.set(k, p); }
  // Identities whose aliases may not all be known: a page — or a copy of it, anywhere along its chain — that had more
  // addresses redirect to it than the crawl keeps (marked), or a list as long as an older crawl's cap (20), which may
  // have been cut without being marked.
  const aliasesIncomplete = new Set(pages.filter((p) => p.redirectsCut === true || ((p.redirectsCut === null || p.redirectsCut === undefined) && Array.isArray(p.redirects) && p.redirects.length >= LEGACY_ALIAS_CAP)).map((p) => resolve(p.url)));
  let notRanking = 0, notCrawled = 0, notUsable = 0, tooShort = 0, aliasesCut = 0;
  const known: (OppTarget & { url: string })[] = [];
  for (const t of targets) {
    if (!t.url || t.position === null) notRanking++;
    else if (!byKey.has(resolve(t.url))) { if (crawled.has(resolve(t.url))) notUsable++; else notCrawled++; }
    else if (aliasesIncomplete.has(resolve(t.url))) aliasesCut++;
    else if (flat(t.keyword).trim().length < MIN_PHRASE) tooShort++;
    else known.push(t as OppTarget & { url: string });
  }
  const cutPages = usable.filter((p) => p.text.length >= LINK_OPP_TEXT).length;
  const empty = { linksMeasured: measured, targets: known.length, boilerplate: 0, notRanking, notCrawled, notUsable, tooShort, aliasesCut, cutPages, items: [], more: 0 };
  if (!measured || !known.length) return empty;
  // One source per identity: copies of a page (they name it canonical) are that page, counted once — the page itself
  // when it is usable, otherwise the copy with the first address in order (the same whatever order the crawl found them).
  const sources = new Map<string, OppPage>();
  for (const p of [...usable].sort((a, b) => (a.url < b.url ? -1 : a.url > b.url ? 1 : 0))) {
    const k = resolve(p.url), had = sources.get(k);
    if (!had || (sameUrlKey(p.url) === k && sameUrlKey(had.url) !== k)) sources.set(k, p);
  }
  const texts = [...sources.entries()].map(([key, p]) => ({ p, key, flat: flat(p.text), links: new Set((Array.isArray(p.links) ? p.links.slice(0, LINK_OPP_LINKS) : []).filter((l): l is string => typeof l === "string").map(resolve)) }));
  const all: LinkOpportunity[] = [];
  let boilerplate = 0;
  const done = new Set<string>(), perTarget = new Map<string, number>();
  // The keywords worth the most first: the ones closest to the first page of results, then the most searched.
  const order = [...known].sort((a, b) => Number((b.position ?? 99) <= 20) - Number((a.position ?? 99) <= 20) || (b.volume ?? -1) - (a.volume ?? -1) || (a.keyword < b.keyword ? -1 : 1));
  for (const t of order) {
    const phrase = flat(t.keyword);
    const target = resolve(t.url), targetPage = byKey.get(target)!;
    // The OTHER pages: neither the target nor a copy of it (a page that names it canonical), for the count and the share alike.
    const others = texts.filter((x) => x.key !== target);
    const mentions = others.filter((x) => x.flat.includes(phrase));
    // On most of the other pages: a menu, a footer, a slogan.
    if (others.length >= BOILERPLATE_MIN_PAGES && mentions.length > others.length * BOILERPLATE_SHARE) { boilerplate++; continue; }
    for (const x of mentions) {
      if (x.links.has(target)) continue;
      const pair = `${x.key}\u0000${target}`;
      // One suggestion per pair of pages: the first (most valuable) keyword that finds it.
      if (done.has(pair)) continue;
      // At most LINK_OPP_PER_TARGET pages for one ranking page, whichever of its keywords found them.
      const n = perTarget.get(target) ?? 0;
      if (n >= LINK_OPP_PER_TARGET) break;
      done.add(pair); perTarget.set(target, n + 1);
      all.push({ keywordId: t.keywordId, keyword: t.keyword, volume: t.volume, position: t.position, checkedOn: t.checkedOn, device: t.device, place: t.place,
        to: targetPage.url, from: x.p.url, fromTitle: x.p.title, context: contextOf(x.p.text, t.keyword), pair: pairOf(x.key, target) });
    }
  }
  return { ...empty, boilerplate, targets: known.length - boilerplate, items: all.slice(0, LINK_OPP_MAX), more: Math.max(0, all.length - LINK_OPP_MAX) };
}

const HOST_SQL = `regexp_replace(regexp_replace(lower(url), '^https?://(www\\.)?', ''), '[/:?#].*$', '')`;
const strings = (field: string, n: number) => `CASE WHEN jsonb_typeof(p->'${field}')='array' THEN COALESCE((SELECT jsonb_agg(l) FROM jsonb_array_elements(p->'${field}') WITH ORDINALITY x(l, n) WHERE n <= ${n} AND jsonb_typeof(l)='string'), '[]'::jsonb) ELSE '[]'::jsonb END`;
/** The crawl's pages WITH their text (cut to LINK_OPP_TEXT characters a page), tolerant of a malformed stored crawl. */
const TEXT_PAGES_SQL = `COALESCE((SELECT jsonb_agg(jsonb_build_object(
    'url', p->>'url',
    'status', CASE WHEN jsonb_typeof(p->'status')='number' AND (p->>'status')::numeric BETWEEN 0 AND 999 THEN (p->>'status')::numeric::int ELSE 0 END,
    'noindex', COALESCE(p->'noindex' = 'true'::jsonb, false), 'title', p->>'title',
    'text', left(COALESCE(p->>'text', ''), ${LINK_OPP_TEXT}),
    'canonical', CASE WHEN jsonb_typeof(p->'canonical')='string' THEN p->>'canonical' END,
    'redirects', ${strings("redirects", 100)}, 'redirectsCut', CASE WHEN jsonb_typeof(p->'redirectsCut')='boolean' THEN p->'redirectsCut' END,
    'links', ${strings("links", LINK_OPP_LINKS)}) ORDER BY ord)
  FROM jsonb_array_elements(CASE WHEN jsonb_typeof(state->'pages')='array' THEN state->'pages' ELSE '[]'::jsonb END) WITH ORDINALITY AS t(p, ord)
 WHERE jsonb_typeof(p)='object' AND p->>'url' IS NOT NULL AND ord <= 1000), '[]'::jsonb)`;

type Result = LinkOpportunities & { jobId: string; scannedAt: string | null; checkedOn: string | null };
/** Worked out once per crawl and exact set of rank-check facts used (hashed), the last few looked at. */
const worked = new Map<string, Result>();
/** null = no finished crawl of the site yet. */
export async function linkOpportunities(userId: number, site: { id: number; domain: string }, tries = 0): Promise<Result | UnreadableCrawl | null> {
  // The newest finished crawl, whatever it is (a broken one is said); worked-out results are kept by its row version.
  const newest = await newestCrawl(userId, site.domain);
  if (!newest) return null;
  if (!newest.readable) return { unreadable: true, jobId: newest.id, scannedAt: newest.at };
  // Each tracked keyword's NEWEST check day (within 35 days) — and on that day the device where the site ranked better.
  // A keyword that did not rank in its newest check is not looked for, however it ranked before.
  const { rows: targets } = await pool.query(
    `SELECT DISTINCT ON (c.keyword_id) c.keyword_id AS "keywordId", k.keyword, k.search_volume AS volume, c.position, c.url,
            c.checked_on::text AS "checkedOn", CASE WHEN c.position IS NULL THEN NULL ELSE c.device END AS device, k.location_name AS place
       FROM seo_rank_checks c JOIN seo_keywords k ON k.id=c.keyword_id
      WHERE c.site_id=$1 AND k.site_id=$1 AND k.user_id=$2 AND c.checked_on >= current_date - 35
        AND c.checked_on = (SELECT max(c2.checked_on) FROM seo_rank_checks c2 WHERE c2.keyword_id=c.keyword_id AND c2.site_id=$1)
      ORDER BY c.keyword_id, (c.position IS NULL OR c.url IS NULL), c.position ASC, c.device`, [site.id, userId]);
  const checkedOn = targets.map((t: any) => String(t.checkedOn)).sort().pop() ?? null;
  const cacheKey = `${userId}:${newest.id}:${newest.v}:${site.id}:${createHash("sha256").update(JSON.stringify(targets)).digest("hex")}`;
  const kept = worked.get(cacheKey);
  if (kept) return kept;
  // Read at the version checked; a crawl changed meanwhile is looked up again (a few times at most).
  const { rows: [job] } = await pool.query(`SELECT id, completed_at, ${TEXT_PAGES_SQL} AS pages FROM sitescan_jobs WHERE id::text=$1 AND user_id=$2 AND xmin::text=$3 AND ${WELL_FORMED_SQL}`, [newest.id, userId, newest.v]);
  if (!job) { if (tries >= 2) throw new Error("The newest crawl kept changing while it was read; try again."); return linkOpportunities(userId, site, tries + 1); }
  const result: Result = { ...findLinkOpportunities(job.pages as OppPage[], targets as OppTarget[]), jobId: job.id, scannedAt: job.completed_at ? new Date(job.completed_at).toISOString() : null, checkedOn };
  worked.set(cacheKey, result);
  if (worked.size > 20) worked.delete(worked.keys().next().value as string);
  return result;
}

/** The crawl's addresses only (no text): enough to know which addresses stand for the same page. */
const ALIAS_PAGES_SQL = `COALESCE((SELECT jsonb_agg(jsonb_build_object('url', p->>'url',
    'canonical', CASE WHEN jsonb_typeof(p->'canonical')='string' THEN p->>'canonical' END, 'redirects', ${strings("redirects", 100)}))
  FROM jsonb_array_elements(CASE WHEN jsonb_typeof(state->'pages')='array' THEN state->'pages' ELSE '[]'::jsonb END) WITH ORDINALITY AS t(p, ord)
 WHERE jsonb_typeof(p)='object' AND p->>'url' IS NOT NULL AND ord <= 1000), '[]'::jsonb)`;
/**
 * Which addresses stand for the same page, by the site's newest finished crawl (`db` lets a caller read it inside its own
 * transaction). With no crawl, an address is only itself (spelling aside).
 */
export async function linkResolverFor(userId: number, domain: string, db: { query: typeof pool.query } = pool): Promise<(u: string) => string> {
  // Looked up without any chance of an error (the caller may be inside a transaction, which an error would end): no
  // crawl table at all is simply no crawl.
  const { rows: [t] } = await db.query("SELECT to_regclass('sitescan_jobs') IS NOT NULL AS ok");
  if (!t?.ok) return aliasesOf([]);
  // The newest finished crawl only: a broken one gives no aliases (an older crawl's would be out of date).
  const got = await readNewestCrawl(userId, domain, `${ALIAS_PAGES_SQL} AS pages`, db);
  return aliasesOf((got?.row?.pages ?? []) as OppPage[]);
}
