/**
 * Site Audit → Pages: every page of the newest crawl with what a search engine
 * needs from it — does it load, can it be indexed, how many clicks from the
 * home page, how many of the site's own pages link to it, its title,
 * description and amount of text. Read from the crawl Site Scan already saved
 * (sitescan_jobs.state); free.
 */
import { pool } from "../db";
import { groupFindings, auditDomainKey, DONE_SQL } from "./audit";

export type RawPage = {
  url: string; status: number; redirects: number; title: string | null; description: string | null; h1: string[]; links: string[];
  bytes: number | null; canonical: string | null; noindex: boolean; words: number; images: number; imagesNoAlt: number;
};
export type PageRow = {
  url: string; path: string; status: number; redirected: boolean;
  /**
   * true = the crawl found nothing on the page telling Google to stay away; false = it found a blocking signal (`whyNot`);
   * null = the page's response was not recorded, so nothing can be said. Never a promise that Google will index it.
   */
  indexable: boolean | null; whyNot: string | null;
  /** Its canonical tag names another page: a request to Google to list that page instead — a hint Google usually follows, not a block. */
  canonicalElsewhere: boolean;
  /** Clicks from the first page crawled (0 = that page); null = no link to it was found, or links could not be measured. */
  depth: number | null;
  /** Other crawled pages of the site that link to it (null when links could not be measured) / pages of the site it links to. */
  inlinks: number | null; outlinks: number | null;
  title: string | null; titleLength: number; descriptionLength: number; h1: number; words: number;
  images: number; imagesNoAlt: number; kb: number | null;
  /** Issue keys (as on the Issues tab) this page is listed under. */
  issues: string[];
};
export type PagesSummary = {
  pages: number; indexable: number; notIndexable: number; canonicalElsewhere: number; errors: number; redirected: number;
  /**
   * False when most pages carry no links in their HTML — a site that builds its menus with JavaScript. The crawl reads
   * the page source without running scripts, so for such a site nothing can honestly be said about which pages link
   * to which: orphans, deep and averageDepth are then null rather than wrong.
   */
  linksMeasured: boolean;
  orphans: number | null; deep: number | null; averageDepth: number | null; thin: number; noTitle: number; noDescription: number;
};

/** Addresses compared the way a crawler treats them: no fragment, no trailing slash, lower-case host. */
export function sameUrlKey(u: string): string {
  try { const x = new URL(u); return `${x.host.toLowerCase().replace(/^www\./, "")}${x.pathname.replace(/\/+$/, "") || ""}${x.search}`; }
  catch { return String(u).replace(/#.*$/, "").replace(/\/+$/, ""); }
}
const pathOf = (u: string) => { try { const x = new URL(u); return (x.pathname || "/") + x.search; } catch { return u; } };

export const THIN_WORDS = 200, DEEP_CLICKS = 4, LINKS_PER_PAGE = 500;

/** One row per crawled page, with link counts and click depth worked out across the crawl. Pure, for tests. */
export function pageRows(all: RawPage[], findings: unknown[] | undefined): PageRow[] {
  // The same address saved twice (http and https, with and without a slash) is one page.
  const seenKeys = new Set<string>();
  const pages = all.filter((p) => { const k = sameUrlKey(p.url); if (seenKeys.has(k)) return false; seenKeys.add(k); return true; });
  const byKey = new Map<string, number>();
  pages.forEach((p, i) => byKey.set(sameUrlKey(p.url), i));
  // Internal links between crawled pages (a page's link to itself does not count).
  const out: Set<number>[] = pages.map(() => new Set<number>()), into: number[] = pages.map(() => 0);
  pages.forEach((p, i) => {
    // A page with thousands of links is read to its first LINKS_PER_PAGE: enough for the picture, bounded for the server.
    for (const l of Array.isArray(p.links) ? p.links.slice(0, LINKS_PER_PAGE) : []) {
      const j = typeof l === "string" ? byKey.get(sameUrlKey(l)) : undefined;
      if (j !== undefined && j !== i && !out[i].has(j)) { out[i].add(j); into[j]++; }
    }
  });
  // Clicks from the first page crawled, breadth first.
  const depth: (number | null)[] = pages.map(() => null);
  if (pages.length) {
    depth[0] = 0;
    for (let queue = [0], d = 1; queue.length; d++) {
      const next: number[] = [];
      for (const i of queue) for (const j of out[i]) if (depth[j] === null) { depth[j] = d; next.push(j); }
      queue = next;
    }
  }
  const measured = linksMeasurable(pages);
  const issuesOf = new Map<string, string[]>();
  for (const g of groupFindings(findings as any).values())
    for (const item of g.items) { const u = item.match(/^https?:\/\/\S+/)?.[0]; if (u) { const k = sameUrlKey(u); issuesOf.set(k, [...(issuesOf.get(k) ?? []), g.key]); } }

  return pages.map((p, i) => {
    const key = sameUrlKey(p.url);
    const canonicalElsewhere = !!p.canonical && sameUrlKey(p.canonical) !== key;
    const known = Number.isInteger(p.status) && p.status >= 100;
    const whyNot = !known ? null : p.status >= 400 ? `it returns an error (${p.status})` : p.status >= 300 ? `it redirects (${p.status})` : p.noindex ? "it is marked noindex" : null;
    return {
      url: p.url, path: pathOf(p.url), status: p.status, redirected: p.redirects > 0, indexable: !known ? null : whyNot === null, whyNot, canonicalElsewhere: known && p.status < 300 && canonicalElsewhere,
      depth: measured ? depth[i] : null, inlinks: measured ? into[i] : null, outlinks: measured ? out[i].size : null,
      title: p.title || null, titleLength: (p.title ?? "").trim().length, descriptionLength: (p.description ?? "").trim().length, h1: Array.isArray(p.h1) ? p.h1.length : 0,
      words: p.words, images: p.images, imagesNoAlt: p.imagesNoAlt, kb: typeof p.bytes === "number" ? Math.round(p.bytes / 1024) : null,
      issues: [...new Set(issuesOf.get(key) ?? [])],
    };
  });
}

/**
 * Whether the links found in the pages' source are enough to talk about which page links to which. They are NOT when,
 * in a crawl of five pages or more, most pages that loaded link to no other crawled page — usual for a site whose menus
 * are added by JavaScript, though the crawl cannot prove that is the cause. A smaller crawl is taken as it is.
 */
export function linksMeasurable(pages: RawPage[]): boolean {
  const loaded = pages.filter((p) => p.status >= 200 && p.status < 400);
  if (loaded.length < 5) return loaded.length > 0;
  // A link to any other page of the same site counts — also to one the crawl did not reach.
  const linksOut = (p: RawPage) => { const self = sameUrlKey(p.url), host = self.split("/")[0]; return (Array.isArray(p.links) ? p.links.slice(0, LINKS_PER_PAGE) : []).some((l) => { if (typeof l !== "string") return false; const k = sameUrlKey(l); return k !== self && k.split("/")[0] === host; }); };
  return loaded.filter(linksOut).length * 2 >= loaded.length;
}

export function pagesSummary(rows: PageRow[]): PagesSummary {
  const ok = rows.filter((r) => r.status < 400);
  const depths = rows.map((r) => r.depth).filter((d): d is number => d !== null);
  const measured = rows.length === 0 || rows.some((r) => r.inlinks !== null);
  return {
    pages: rows.length, indexable: rows.filter((r) => r.indexable === true).length, notIndexable: rows.filter((r) => r.indexable === false).length,
    canonicalElsewhere: rows.filter((r) => r.canonicalElsewhere).length,
    errors: rows.filter((r) => r.status >= 400).length, redirected: rows.filter((r) => r.redirected).length,
    linksMeasured: measured,
    orphans: measured ? rows.filter((r, i) => i > 0 && r.inlinks === 0).length : null, deep: measured ? rows.filter((r) => (r.depth ?? 0) >= DEEP_CLICKS).length : null,
    averageDepth: measured && depths.length ? Math.round((depths.reduce((a, b) => a + b, 0) / depths.length) * 10) / 10 : null,
    thin: ok.filter((r) => r.words < THIN_WORDS).length, noTitle: ok.filter((r) => r.titleLength === 0).length, noDescription: ok.filter((r) => r.descriptionLength === 0).length,
  };
}

const HOST_SQL = `regexp_replace(regexp_replace(lower(url), '^https?://(www\\.)?', ''), '[/:?#].*$', '')`;
/** The crawl's pages without their full text (only its word count), tolerant of a malformed stored crawl. */
const PAGES_SQL = `COALESCE((SELECT jsonb_agg(jsonb_build_object(
    'url', p->>'url',
    'status', CASE WHEN jsonb_typeof(p->'status')='number' AND (p->>'status')::numeric BETWEEN 0 AND 999 THEN (p->>'status')::numeric::int ELSE 0 END,
    'redirects', CASE WHEN jsonb_typeof(p->'redirects')='array' THEN jsonb_array_length(p->'redirects') ELSE 0 END,
    'title', p->>'title', 'description', p->>'description',
    'h1', CASE WHEN jsonb_typeof(p->'h1')='array' THEN p->'h1' ELSE '[]'::jsonb END,
    'links', CASE WHEN jsonb_typeof(p->'links')='array' THEN COALESCE((SELECT jsonb_agg(l) FROM jsonb_array_elements(p->'links') WITH ORDINALITY x(l, n) WHERE n <= 500), '[]'::jsonb) ELSE '[]'::jsonb END,
    'bytes', CASE WHEN jsonb_typeof(p->'bytes')='number' THEN p->'bytes' ELSE 'null'::jsonb END,
    'canonical', p->>'canonical', 'noindex', COALESCE(p->'noindex' = 'true'::jsonb, false),
    'words', COALESCE(array_length(regexp_split_to_array(btrim(COALESCE(p->>'text', '')), '\\s+'), 1), 0) - CASE WHEN btrim(COALESCE(p->>'text', '')) = '' THEN 1 ELSE 0 END,
    'images', CASE WHEN jsonb_typeof(p->'images')='array' THEN jsonb_array_length(p->'images') ELSE 0 END,
    'imagesNoAlt', CASE WHEN jsonb_typeof(p->'images')='array' THEN (SELECT count(*) FROM jsonb_array_elements(p->'images') i WHERE COALESCE(btrim(i->>'alt'), '') = '') ELSE 0 END) ORDER BY ord)
  FROM jsonb_array_elements(CASE WHEN jsonb_typeof(state->'pages')='array' THEN state->'pages' ELSE '[]'::jsonb END) WITH ORDINALITY AS t(p, ord)
 WHERE jsonb_typeof(p)='object' AND p->>'url' IS NOT NULL AND ord <= 1000), '[]'::jsonb)`;

export const PAGE_CAP = 1000;

/** The pages of this account's newest completed crawl of a domain; null when there is none. */
type PagesResult = { jobId: string; scannedAt: string | null; summary: PagesSummary; pages: PageRow[] };
/** A finished crawl never changes, so its page table is worked out once and kept (the last few crawls looked at). */
const worked = new Map<string, PagesResult>();

export async function auditPages(user: number, domain: string): Promise<PagesResult | null> {
  // Which crawl first (cheap), then its pages only when they are not already worked out.
  const { rows: [newest] } = await pool.query(
    `SELECT id FROM sitescan_jobs WHERE user_id=$1 AND ${DONE_SQL} AND ${HOST_SQL}=$2 ORDER BY completed_at DESC LIMIT 1`, [user, auditDomainKey(domain)]);
  if (!newest) return null;
  const kept = worked.get(`${user}:${newest.id}`);
  if (kept) return kept;
  const { rows: [job] } = await pool.query(`SELECT id, completed_at, report->'findings' AS findings, ${PAGES_SQL} AS pages FROM sitescan_jobs WHERE id=$1 AND user_id=$2`, [newest.id, user]);
  if (!job) return null;
  const rows = pageRows((job.pages as RawPage[]).slice(0, PAGE_CAP), Array.isArray(job.findings) ? job.findings : []);
  const result = { jobId: job.id, scannedAt: job.completed_at, summary: pagesSummary(rows), pages: rows };
  worked.set(`${user}:${job.id}`, result);
  if (worked.size > 20) worked.delete(worked.keys().next().value as string);
  return result;
}
