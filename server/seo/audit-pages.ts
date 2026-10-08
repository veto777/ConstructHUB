/**
 * Site Audit → Pages: every page of the newest crawl with what a search engine
 * needs from it — does it load, can it be indexed, how many clicks from the
 * home page, how many of the site's own pages link to it, its title,
 * description and amount of text. Read from the crawl Site Scan already saved
 * (sitescan_jobs.state); free.
 */
import { pool } from "../db";
import { groupFindings, auditDomainKey } from "./audit";

export type RawPage = {
  url: string; status: number; redirects: number; title: string | null; description: string | null; h1: string[]; links: string[];
  bytes: number | null; canonical: string | null; noindex: boolean; words: number; images: number; imagesNoAlt: number;
};
export type PageRow = {
  url: string; path: string; status: number; redirected: boolean;
  /** Can Google put this page in its index? And if not, the plain reason. */
  indexable: boolean; whyNot: string | null;
  /** Clicks from the first page crawled (0 = that page); null = no link to it was found on the crawled pages. */
  depth: number | null;
  /** Other crawled pages of the site that link to it / pages of the site it links to. */
  inlinks: number; outlinks: number;
  title: string | null; titleLength: number; descriptionLength: number; h1: number; words: number;
  images: number; imagesNoAlt: number; kb: number | null;
  /** Issue keys (as on the Issues tab) this page is listed under. */
  issues: string[];
};
export type PagesSummary = { pages: number; indexable: number; notIndexable: number; errors: number; redirected: number; orphans: number; deep: number; averageDepth: number | null; thin: number; noTitle: number; noDescription: number };

/** Addresses compared the way a crawler treats them: no fragment, no trailing slash, lower-case host. */
export function sameUrlKey(u: string): string {
  try { const x = new URL(u); return `${x.protocol}//${x.host.toLowerCase()}${x.pathname.replace(/\/+$/, "") || ""}${x.search}`; }
  catch { return String(u).replace(/#.*$/, "").replace(/\/+$/, ""); }
}
const pathOf = (u: string) => { try { const x = new URL(u); return (x.pathname || "/") + x.search; } catch { return u; } };

export const THIN_WORDS = 200, DEEP_CLICKS = 4;

/** One row per crawled page, with link counts and click depth worked out across the crawl. Pure, for tests. */
export function pageRows(pages: RawPage[], findings: unknown[] | undefined): PageRow[] {
  const byKey = new Map<string, number>();
  pages.forEach((p, i) => { if (!byKey.has(sameUrlKey(p.url))) byKey.set(sameUrlKey(p.url), i); });
  // Internal links between crawled pages (a page's link to itself does not count).
  const out: Set<number>[] = pages.map(() => new Set<number>()), into: number[] = pages.map(() => 0);
  pages.forEach((p, i) => {
    for (const l of Array.isArray(p.links) ? p.links : []) {
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
  const issuesOf = new Map<string, string[]>();
  for (const g of groupFindings(findings as any).values())
    for (const item of g.items) { const u = item.match(/^https?:\/\/\S+/)?.[0]; if (u) { const k = sameUrlKey(u); issuesOf.set(k, [...(issuesOf.get(k) ?? []), g.key]); } }

  return pages.map((p, i) => {
    const key = sameUrlKey(p.url);
    const canonicalElsewhere = !!p.canonical && sameUrlKey(p.canonical) !== key;
    const whyNot = p.status >= 400 ? `it returns an error (${p.status})` : p.status >= 300 ? `it redirects (${p.status})` : p.noindex ? "it is marked noindex" : canonicalElsewhere ? "its canonical tag points to another page" : null;
    return {
      url: p.url, path: pathOf(p.url), status: p.status, redirected: p.redirects > 0, indexable: whyNot === null, whyNot,
      depth: depth[i], inlinks: into[i], outlinks: out[i].size,
      title: p.title || null, titleLength: (p.title ?? "").trim().length, descriptionLength: (p.description ?? "").trim().length, h1: Array.isArray(p.h1) ? p.h1.length : 0,
      words: p.words, images: p.images, imagesNoAlt: p.imagesNoAlt, kb: typeof p.bytes === "number" ? Math.round(p.bytes / 1024) : null,
      issues: [...new Set(issuesOf.get(key) ?? [])],
    };
  });
}

export function pagesSummary(rows: PageRow[]): PagesSummary {
  const ok = rows.filter((r) => r.status < 400);
  const depths = rows.map((r) => r.depth).filter((d): d is number => d !== null);
  return {
    pages: rows.length, indexable: rows.filter((r) => r.indexable).length, notIndexable: rows.filter((r) => !r.indexable).length,
    errors: rows.filter((r) => r.status >= 400).length, redirected: rows.filter((r) => r.redirected).length,
    orphans: rows.filter((r, i) => i > 0 && r.inlinks === 0).length, deep: rows.filter((r) => (r.depth ?? 0) >= DEEP_CLICKS).length,
    averageDepth: depths.length ? Math.round((depths.reduce((a, b) => a + b, 0) / depths.length) * 10) / 10 : null,
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
    'links', CASE WHEN jsonb_typeof(p->'links')='array' THEN p->'links' ELSE '[]'::jsonb END,
    'bytes', CASE WHEN jsonb_typeof(p->'bytes')='number' THEN p->'bytes' ELSE 'null'::jsonb END,
    'canonical', p->>'canonical', 'noindex', COALESCE(p->'noindex' = 'true'::jsonb, false),
    'words', COALESCE(array_length(regexp_split_to_array(btrim(COALESCE(p->>'text', '')), '\\s+'), 1), 0) - CASE WHEN btrim(COALESCE(p->>'text', '')) = '' THEN 1 ELSE 0 END,
    'images', CASE WHEN jsonb_typeof(p->'images')='array' THEN jsonb_array_length(p->'images') ELSE 0 END,
    'imagesNoAlt', CASE WHEN jsonb_typeof(p->'images')='array' THEN (SELECT count(*) FROM jsonb_array_elements(p->'images') i WHERE COALESCE(btrim(i->>'alt'), '') = '') ELSE 0 END) ORDER BY ord)
  FROM jsonb_array_elements(CASE WHEN jsonb_typeof(state->'pages')='array' THEN state->'pages' ELSE '[]'::jsonb END) WITH ORDINALITY AS t(p, ord)
 WHERE jsonb_typeof(p)='object' AND p->>'url' IS NOT NULL), '[]'::jsonb)`;

export const PAGE_CAP = 1000;

/** The pages of this account's newest completed crawl of a domain; null when there is none. */
export async function auditPages(user: number, domain: string): Promise<{ jobId: string; scannedAt: string | null; summary: PagesSummary; pages: PageRow[] } | null> {
  const { rows: [job] } = await pool.query(
    `SELECT id, completed_at, report->'findings' AS findings, ${PAGES_SQL} AS pages FROM sitescan_jobs
      WHERE user_id=$1 AND status='completed' AND jsonb_typeof(report)='object' AND ${HOST_SQL}=$2 ORDER BY completed_at DESC LIMIT 1`, [user, auditDomainKey(domain)]);
  if (!job) return null;
  const rows = pageRows(job.pages as RawPage[], Array.isArray(job.findings) ? job.findings : []);
  return { jobId: job.id, scannedAt: job.completed_at, summary: pagesSummary(rows), pages: rows.slice(0, PAGE_CAP) };
}
