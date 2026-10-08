/**
 * Site Audit for ConstructHUB SEO: health score, crawl status and the issue
 * list with its change since the previous crawl, read from the crawls Site
 * Scan already runs (server/sitescan — sitescan_jobs.report / .state).
 * Nothing here calls the data vendor, so an audit never spends SEO data; a
 * crawl is one of the plan's monthly Site Scans.
 */
import { pool } from "../db";
import { missingPageScope } from "../sitescan/guidance";

export type AuditSeverity = "error" | "warning" | "notice";
export type AuditPage = { url: string; status: number; redirects: number };
type Finding = { id: string; category: string; severity: string; title: string; urls?: string[]; why?: string; fix?: string };
export type AuditReport = { /** Every PageSpeed attempt of this crawl: a number in `score` means it was measured. */ psi?: { url?: string; strategy?: string; score?: number }[]; scannedAt?: string; url?: string; remaining?: number; blocked?: number; errors?: { url: string; message?: string }[]; profile?: unknown; findings?: Finding[]; scores?: { overall: number | null; categories: Record<string, number | null> }; coverage?: { pageCap?: number } };

export type AuditIssue = {
  key: string; title: string; category: string; severity: AuditSeverity;
  /** Pages (or, for a rolled-up issue, entries) affected now and in the previous crawl. */
  count: number; previous: number | null; change: number | null; isNew: boolean;
  why: string; fix: string;
  /** What is affected: page addresses, or one line per entry for a rolled-up issue. */
  items: string[];
};
export type AuditSummary = {
  scannedAt: string | null; url: string | null;
  health: number | null; healthChange: number | null;
  crawled: number; pageCap: number | null; notCrawled: number; blockedByRobots: number;
  /** `failed`: could not be fetched. `excluded`: found but deliberately not audited (not a web page, or leaves the site). */
  statuses: { ok: number; redirected: number; clientError: number; serverError: number; failed: number; excluded: number };
  totals: Record<AuditSeverity, { issues: number; affected: number }>;
  scores: AuditReport["scores"] | null;
  issues: AuditIssue[];
  /** Issues the previous crawl had that this one no longer finds. */
  fixed: { key: string; title: string; severity: AuditSeverity; previous: number }[];
  /** Issues the previous crawl had that this crawl could not re-check (other pages crawled, or no Google profile attached). */
  notRechecked: { key: string; title: string; severity: AuditSeverity; previous: number }[];
};

export const ITEM_CAP = 500;
/** Issues found by looking at a sample of links / images, not at every one (server/sitescan/audit.ts). */
export const SAMPLED_CHECKS: ReadonlySet<string> = new Set(["oversized-images", "broken-links"]);
const SEVERITY: Record<string, AuditSeverity> = { critical: "error", warning: "warning", info: "notice" };
const RANK: Record<AuditSeverity, number> = { error: 0, warning: 1, notice: 2 };

/** Per-entry findings (one per missing service, one per PageSpeed run) roll up into one issue. */
const ROLLUPS: { test: RegExp; key: (m: RegExpMatchArray) => string; title: (m: RegExpMatchArray) => string; item: (f: Finding) => string }[] = [
  {
    test: /^gap-([a-z_]+)-/,
    key: (m) => `gap-${m[1]}`,
    title: (m) => `Google Business Profile ${m[1].replace(/_/g, " ")} with no matching page`,
    item: (f) => String(f.title ?? f.id).replace(/^No matching [^:]+: /, ""),
  },
  {
    test: /^psi-(mobile|desktop)-/,
    key: (m) => `psi-${m[1]}`,
    title: (m) => `${m[1] === "mobile" ? "Mobile" : "Desktop"} PageSpeed score below 90`,
    item: (f) => `${(Array.isArray(f.urls) && f.urls[0]) || ""} — score ${String(f.title ?? "").split(": ").pop()}`,
  },
];

export function issueKey(id: string): string {
  for (const r of ROLLUPS) { const m = id.match(r.test); if (m) return r.key(m); }
  return id;
}

type Group = { key: string; title: string; category: string; severity: AuditSeverity; why: string; fix: string; items: string[] };

export function groupFindings(findings: Finding[] | undefined): Map<string, Group> {
  const groups = new Map<string, Group>();
  for (const f of Array.isArray(findings) ? findings : []) {
    if (!f || typeof f.id !== "string") continue;
    const severity = SEVERITY[f.severity] ?? "notice";
    let key = f.id, title = typeof f.title === "string" ? f.title : f.id, items = (Array.isArray(f.urls) ? f.urls : []).filter((u) => typeof u === "string");
    for (const r of ROLLUPS) {
      const m = f.id.match(r.test);
      if (m) { key = r.key(m); title = r.title(m); items = [r.item(f)]; break; }
    }
    const g = groups.get(key);
    if (g) {
      for (const i of items) if (!g.items.includes(i)) g.items.push(i);
      if (RANK[severity] < RANK[g.severity]) g.severity = severity;
    } else groups.set(key, { key, title, category: f.category, severity, why: f.why ?? "", fix: f.fix ?? "", items: [...new Set(items)] });
  }
  return groups;
}

/**
 * Health score, defined the way Ahrefs defines it: the share of crawled URLs
 * with no error-level issue. A URL that returned 4xx/5xx or could not be
 * fetched counts as having an error. null when nothing was crawled.
 */
/** Crawl errors that are real fetch failures; the rest ("not a web page", "leaves the site") are exclusions, not faults. */
export const failedFetches = (report: AuditReport) => (Array.isArray(report?.errors) ? report.errors : []).filter((e) => e && typeof e.url === "string" && (!e.message || /^Request failed/i.test(e.message)));
const excludedCount = (report: AuditReport) => (Array.isArray(report?.errors) ? report.errors.length : 0) - failedFetches(report).length;

/** The pages the health score is out of, and the distinct ones with an error (an error answer, a failed fetch, or any error-level issue). */
export function healthCounts(report: AuditReport, pages: AuditPage[]): { pages: number; errorPages: number } {
  const failed = new Set(failedFetches(report).map((e) => e.url));
  const all = new Set<string>([...pages.map((p) => p.url), ...failed]);
  const bad = new Set<string>(failed);
  for (const p of pages) if (p.status >= 400) bad.add(p.url);
  for (const f of Array.isArray(report.findings) ? report.findings : []) if (f?.severity === "critical") for (const u of Array.isArray(f.urls) ? f.urls : []) if (all.has(u)) bad.add(u);
  return { pages: all.size, errorPages: bad.size };
}
export function healthScore(report: AuditReport, pages: AuditPage[]): number | null {
  const c = healthCounts(report, pages);
  return c.pages ? Math.round(((c.pages - c.errorPages) / c.pages) * 100) : null;
}

export function auditSummary(report: AuditReport, pages: AuditPage[], previous?: { report: AuditReport; pages: AuditPage[] } | null): AuditSummary {
  const now = groupFindings(report.findings), before = previous ? groupFindings(previous.report.findings) : null;
  const issues: AuditIssue[] = [...now.values()].map((g) => {
    const prev = before ? before.get(g.key)?.items.length ?? 0 : null;
    return {
      key: g.key, title: g.title, category: g.category, severity: g.severity, count: g.items.length,
      previous: prev, change: prev === null ? null : g.items.length - prev, isNew: prev === 0,
      why: g.why, fix: g.fix, items: g.items.slice(0, ITEM_CAP),
    };
  }).sort((a, b) => RANK[a.severity] - RANK[b.severity] || b.count - a.count || a.title.localeCompare(b.title));
  // An issue that is gone is "fixed" only if this crawl could have found it again: at least one of its pages was
  // crawled this time, and (for the checks that compare with the Google profile) a profile was attached this time too.
  const crawledNow = new Set(pages.map((p) => p.url));
  const gone = before ? [...before.values()].filter((g) => !now.has(g.key)) : [];
  const recheckable = (g: Group) => {
    if (g.category === "local" && !report.profile && previous?.report.profile) return false;
    // Checks that only look at a sample of links or images: a page crawled again does not mean the same link or image was
    // looked at again, so their disappearance is never called a fix.
    if (SAMPLED_CHECKS.has(g.key)) return false;
    // "Addresses with no page are answered like real pages" is found by asking, in each crawl, for a couple of
    // addresses that have no page. It was re-checked only if THIS crawl asked and EVERY answer was "not found"
    // (404/410) or a noindexed page. Not asked (robots.txt), no answer, or an answer that proves nothing (a sign-in, a
    // bot check, a server error) leaves the question open — it is then "not re-checked", never "fixed".
    // Judged part by part: every part of the site the issue was raised for (the top, or a section) must have been asked
    // again in THIS crawl and answered honestly there. A crawl that did not reach that section again proves nothing.
    if (g.key === "soft-404") {
      const probes = (report as { coverage?: { missingPageProbe?: { probes?: unknown } | null } }).coverage?.missingPageProbe?.probes;
      if (!Array.isArray(probes)) return false;
      const parts = g.items.map((i) => i.match(/^https?:\/\/\S+/)?.[0]).filter((u): u is string => !!u).map(missingPageScope);
      return parts.length > 0 && parts.every((part) => {
        const again = probes.filter((p: any) => p?.part === part);
        return again.length > 0 && again.every((p: any) => p.outcome === "not_found" || p.outcome === "noindex");
      });
    }
    // A PageSpeed issue is re-checked only when that very page was MEASURED again for the same device (the measurement
    // is optional and can fail or be switched off; then the issue simply stops being listed).
    const speed = g.key.match(/^psi-(mobile|desktop)$/);
    if (speed) {
      const measured = new Set((Array.isArray(report.psi) ? report.psi : []).filter((p) => p?.strategy === speed[1] && typeof p.score === "number" && typeof p.url === "string").map((p) => p.url as string));
      const pagesOf = g.items.map((i) => i.match(/^https?:\/\/\S+/)?.[0]).filter((u): u is string => !!u);
      return pagesOf.length > 0 && pagesOf.every((u) => measured.has(u));
    }
    // Every page it was on must have been looked at again (an entry such as "URL — score 41" starts with its page).
    const urls = g.items.map((i) => i.match(/^https?:\/\/\S+/)?.[0]).filter((u): u is string => !!u);
    return urls.length === 0 || urls.every((u) => crawledNow.has(u));
  };
  const brief = (g: Group) => ({ key: g.key, title: g.title, severity: g.severity, previous: g.items.length });
  const fixed = gone.filter(recheckable).map(brief), notRechecked = gone.filter((g) => !recheckable(g)).map(brief);
  const totals = { error: { issues: 0, affected: 0 }, warning: { issues: 0, affected: 0 }, notice: { issues: 0, affected: 0 } };
  for (const i of issues) { totals[i.severity].issues++; totals[i.severity].affected += i.count; }
  const health = healthScore(report, pages), prevHealth = previous ? healthScore(previous.report, previous.pages) : null;
  const statuses = { ok: 0, redirected: 0, clientError: 0, serverError: 0, failed: failedFetches(report).length, excluded: excludedCount(report) };
  for (const p of pages) {
    if (p.status >= 500) statuses.serverError++;
    else if (p.status >= 400) statuses.clientError++;
    else if (p.redirects > 0 || (p.status >= 300 && p.status < 400)) statuses.redirected++;
    else statuses.ok++;
  }
  return {
    scannedAt: report.scannedAt ?? null, url: report.url ?? null,
    health, healthChange: health !== null && prevHealth !== null ? health - prevHealth : null,
    crawled: pages.length, pageCap: report.coverage?.pageCap ?? null, notCrawled: report.remaining ?? 0, blockedByRobots: report.blocked ?? 0,
    statuses, totals, scores: report.scores ?? null, issues, fixed, notRechecked,
  };
}

/** sitescan_jobs.url → the bare host seo_sites.domain stores. */
const HOST_SQL = `regexp_replace(regexp_replace(lower(url), '^https?://(www\\.)?', ''), '[/:?#].*$', '')`;
const bare = (domain: string) => domain.toLowerCase().replace(/^www\./, "");
// Tolerant of a malformed stored crawl: anything that is not the expected JSON type reads as empty, never as an error.
const PAGES_SQL = `COALESCE((SELECT jsonb_agg(jsonb_build_object(
                                'url', p->>'url',
                                'status', CASE WHEN jsonb_typeof(p->'status')='number' AND (p->>'status')::numeric BETWEEN 0 AND 999 THEN (p->>'status')::numeric::int ELSE 0 END,
                                'redirects', CASE WHEN jsonb_typeof(p->'redirects')='array' THEN jsonb_array_length(p->'redirects') ELSE 0 END))
                              FROM jsonb_array_elements(CASE WHEN jsonb_typeof(state->'pages')='array' THEN state->'pages' ELSE '[]'::jsonb END) p
                             WHERE jsonb_typeof(p)='object'), '[]'::jsonb)`;
const CRAWLED_SQL = `CASE WHEN jsonb_typeof(state->'pages')='array' THEN jsonb_array_length(state->'pages') ELSE 0 END`;
/**
 * Whether a finished crawl's saved result is what the crawler writes — everything the health score rests on (shared by
 * the dashboard, Site audit, its comparisons and the client report). Anything else is "could not be read", never a
 * clean crawl and never replaced by an older one.
 */
export const WELL_FORMED_SQL = `-- Everything the score rests on, as a finished crawl writes it (server/sitescan): a report with a list of
              -- findings (each one an object) and, if any, a list of errors; pages each with an address and a numeric
              -- status. An empty list is a real empty list; anything else is "could not be read", never a clean crawl.
              (jsonb_typeof(report)='object' AND jsonb_typeof(report->'findings')='array'
               -- each finding: an object with a text severity, and its pages (if any) a list of addresses
               AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(report->'findings') f WHERE jsonb_typeof(f)<>'object'
                     OR (f->>'severity') IS DISTINCT FROM 'critical' AND (f->>'severity') IS DISTINCT FROM 'warning' AND (f->>'severity') IS DISTINCT FROM 'info'
                     OR jsonb_typeof(f->'id') IS DISTINCT FROM 'string'
                     OR jsonb_typeof(f->'urls') IS DISTINCT FROM 'array' OR EXISTS (SELECT 1 FROM jsonb_array_elements(f->'urls') u WHERE jsonb_typeof(u)<>'string'))
               -- each error (a page that could not be fetched counts against the score): an object with an address
               AND (report->'errors' IS NULL OR (jsonb_typeof(report->'errors')='array'
                     AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(report->'errors') e WHERE jsonb_typeof(e)<>'object' OR jsonb_typeof(e->'url') IS DISTINCT FROM 'string'
                     -- a failed fetch (counts against the score) or one of the crawler's own exclusions; anything else is not known
                     -- (exact exclusion texts; a message that is there must be text — a JSON null is not "no message")
                     OR NOT coalesce(NOT (e ? 'message') OR (jsonb_typeof(e->'message')='string' AND (e->>'message' ~ '^Request failed'
                         OR e->>'message' IN ('Non-HTML response excluded from page checks.', 'Redirect leaves the selected origin; destination excluded from audit.'))), false))))
               AND jsonb_typeof(state->'pages')='array'
               AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(state->'pages') p WHERE jsonb_typeof(p)<>'object' OR jsonb_typeof(p->'url') IS DISTINCT FROM 'string' OR CASE WHEN jsonb_typeof(p->'status')='number' THEN (p->>'status')::numeric NOT BETWEEN 100 AND 599 OR (p->>'status')::numeric <> trunc((p->>'status')::numeric) ELSE true END))`;
/** A finished crawl that can be read (the one evidence test, everywhere a crawl is read). */
export const DONE_SQL = `status='completed' AND ${WELL_FORMED_SQL}`;

export type AuditRun = { id: string; status: string; error: string | null; createdAt: string; crawled: number; pageCap: number };

/** Pages of two crawls compared by address (as the crawler compares them): reached now and not then, and the reverse. Pure. */
export function pageChanges(now: AuditPage[], before: AuditPage[]): { added: string[]; removed: string[] } {
  const key = (u: string) => { try { const x = new URL(u); return `${x.host.toLowerCase().replace(/^www\./, "")}${x.pathname.replace(/\/+$/, "")}${x.search}`; } catch { return u; } };
  const a = new Set(now.map((p) => key(p.url))), b = new Set(before.map((p) => key(p.url)));
  return { added: now.filter((p) => !b.has(key(p.url))).map((p) => p.url), removed: before.filter((p) => !a.has(key(p.url))).map((p) => p.url) };
}
export const PAGE_CHANGE_LIST = 50;
export type AuditComparison = { jobId: string; at: string | null; /** true = chosen by the customer (not the crawl before). */ chosen: boolean;
  addedPages: number; removedPages: number; added: string[]; removed: string[]; /** The two crawls' page limits differ: a page "no longer reached" may only be beyond the smaller one. */ capsDiffer: boolean };
/** How many finished crawls the crawl pickers list. */
export const CRAWL_LIST = 100;
export type CrawlChoice = { jobId: string; at: string | null; pageCap: number | null; /** false = saved in a form that cannot be read (listed, not choosable). */ readable: boolean };
export async function siteAudit(user: number, domain: string, opts: { at?: string | null; vs?: string | null } = {}): Promise<{
  /** The Google profile the newest crawl was compared with: the next crawl uses it too, so the same checks run. */ locationId: number | null;
  /** The crawl shown and the one it is compared with (by default the newest and the one before it). */
  audit: (AuditSummary & { jobId: string; latest: boolean; /** When this crawl finished (the date the pickers use). */ completedAt: string | null; comparedWith: AuditComparison | null }) | null;
  /** The newest finished crawl (the Pages, links and outgoing views read it). */ latestId: string | null;
  /** Every finished crawl of the site, newest first (up to CRAWL_LIST), for the pickers. */ crawls: CrawlChoice[];
  /** A chosen crawl that is not this account's finished crawl of this site (or, for `vs`, not older than the one shown): the default was used and the page says so. */
  atMissing?: boolean; vsMissing?: boolean;
  /** The newest finished crawl could not be read (its saved result is not what the crawler writes): nothing older is shown in its place unless picked. */
  newestUnreadable?: { jobId: string; at: string | null };
  /** The crawl just before the one shown could not be read: no change is shown by default. */ previousUnreadable?: { jobId: string; at: string | null };
  history: { jobId: string; at: string; health: number | null; errors: number; warnings: number; notices: number; crawled: number; unreadable?: boolean }[]; running: AuditRun | null; lastFailed: AuditRun | null }> {
  const d = bare(domain);
  const [{ rows: recent }, { rows: open }, { rows: list }] = await Promise.all([
    pool.query(
      `SELECT id, completed_at, report, page_cap, profile->>'id' AS location_id, ${PAGES_SQL} AS pages, ${WELL_FORMED_SQL} AS well_formed FROM sitescan_jobs
        WHERE user_id=$1 AND status='completed' AND ${HOST_SQL}=$2 ORDER BY completed_at DESC LIMIT 12`, [user, d]),
    pool.query(
      `SELECT id, status, error, created_at, ${CRAWLED_SQL} AS crawled, page_cap FROM sitescan_jobs
        WHERE user_id=$1 AND ${HOST_SQL}=$2 ORDER BY created_at DESC LIMIT 1`, [user, d]),
    pool.query(
      `SELECT id, completed_at, page_cap, ${WELL_FORMED_SQL} AS readable FROM sitescan_jobs WHERE user_id=$1 AND status='completed' AND ${HOST_SQL}=$2 ORDER BY completed_at DESC, id LIMIT ${CRAWL_LIST}`, [user, d]),
  ]);
  // Only crawls saved as the crawler writes them are read. The newest finished crawl, if broken, is said — and nothing
  // older is shown in its place unless the customer picks it.
  const done = recent.filter((j: any) => j.well_formed);
  const newestUnreadable = recent[0] && !recent[0].well_formed ? { jobId: String(recent[0].id), at: recent[0].completed_at ? new Date(recent[0].completed_at).toISOString() : null } : null;
  const run = (r: any): AuditRun => ({ id: r.id, status: r.status, error: r.error, createdAt: r.created_at, crawled: r.crawled ?? 0, pageCap: r.page_cap });
  const newest = open[0];
  // One crawl, only if it is this account's finished crawl of this site (and, when `before` is given, older than it).
  const load = async (id: string, before?: Date) => (await pool.query(
    `SELECT id, completed_at, report, page_cap, ${PAGES_SQL} AS pages FROM sitescan_jobs WHERE id::text=$3 AND user_id=$1 AND status='completed' AND ${WELL_FORMED_SQL} AND ${HOST_SQL}=$2
       ${before ? "AND completed_at < $4" : ""}`, before ? [user, d, id, before] : [user, d, id])).rows[0] ?? null;
  // The crawl shown: the one chosen, else the newest.
  let cur = newestUnreadable ? null : done[0] ?? null, atMissing = false;
  if (opts.at && opts.at !== cur?.id) { const c = await load(opts.at); if (c) cur = c; else atMissing = true; }
  // No finished crawl at all: a crawl asked for is not available, and that is said too.
  if (!cur && opts.at && !atMissing) atMissing = true;
  // The crawl it is compared with: the one chosen (older than the one shown), else the one just before it.
  let prev: any = null, chosen = false, vsMissing = !cur && !!opts.vs, previousUnreadable: { jobId: string; at: string | null } | null = null;
  if (cur) {
    if (opts.vs) { const v = opts.vs === cur.id ? null : await load(opts.vs, cur.completed_at); if (v) { prev = v; chosen = true; } else vsMissing = true; }
    if (!prev) {
      // The crawl just before — whatever it is. One that cannot be read means no change by default (never a jump to an
      // older one called "the crawl before"); an older crawl can still be picked, by its date.
      const i = recent.findIndex((j: any) => j.id === cur.id);
      const before = i >= 0 && recent[i + 1] ? recent[i + 1] : (await pool.query(
        `SELECT id, completed_at, report, page_cap, ${PAGES_SQL} AS pages, ${WELL_FORMED_SQL} AS well_formed FROM sitescan_jobs WHERE user_id=$1 AND status='completed' AND ${HOST_SQL}=$2 AND completed_at < $3 ORDER BY completed_at DESC LIMIT 1`,
        [user, d, cur.completed_at])).rows[0] ?? null;
      if (before?.well_formed) prev = before;
      else if (before) previousUnreadable = { jobId: String(before.id), at: before.completed_at ? new Date(before.completed_at).toISOString() : null };
    }
  }
  const audit = cur ? (() => {
    const s = auditSummary(cur.report, cur.pages, prev ? { report: prev.report, pages: prev.pages } : null);
    const ch = prev ? pageChanges(cur.pages, prev.pages) : null;
    return { jobId: cur.id as string, latest: !newestUnreadable && cur.id === done[0]?.id, ...s, completedAt: cur.completed_at ? new Date(cur.completed_at).toISOString() : null, comparedWith: prev && ch ? { jobId: prev.id as string, at: prev.completed_at ? new Date(prev.completed_at).toISOString() : null, chosen,
      addedPages: ch.added.length, removedPages: ch.removed.length, added: ch.added.slice(0, PAGE_CHANGE_LIST), removed: ch.removed.slice(0, PAGE_CHANGE_LIST), capsDiffer: Number(prev.page_cap) !== Number(cur.page_cap) } : null };
  })() : null;
  // Every finished crawl in the history; one that cannot be read is a gap (no score), never dropped.
  const history = recent.flatMap((j: any) => {
    if (!j.well_formed) return [{ jobId: j.id, at: j.completed_at, health: null, errors: 0, warnings: 0, notices: 0, crawled: 0, unreadable: true }];
    try {
      const s = auditSummary(j.report, j.pages);
      return [{ jobId: j.id, at: j.completed_at, health: s.health, errors: s.totals.error.affected, warnings: s.totals.warning.affected, notices: s.totals.notice.affected, crawled: s.crawled }];
    } catch { return []; }
  }).reverse();
  const locationId = Number(done[0]?.location_id) > 0 ? Number(done[0].location_id) : null;
  return {
    locationId, audit, history, latestId: done[0]?.id ?? null, ...(newestUnreadable ? { newestUnreadable } : {}), ...(atMissing ? { atMissing } : {}), ...(vsMissing ? { vsMissing } : {}),
    crawls: list.map((r: any) => ({ jobId: r.id, at: r.completed_at ? new Date(r.completed_at).toISOString() : null, pageCap: r.page_cap == null ? null : Number(r.page_cap), readable: !!r.readable })),
    ...(previousUnreadable ? { previousUnreadable } : {}),
    running: newest && (newest.status === "queued" || newest.status === "running") ? run(newest) : null,
    lastFailed: newest && newest.status === "failed" ? run(newest) : null,
  };
}

/** Health score per domain for the dashboard cards: newest completed crawl of each. */
/** How many crawls of a site the dashboard's health trend shows. */
export const HEALTH_TREND = 6;
/** The version of the health worked out per crawl (seo_crawl_health.v): a new formula works every crawl out again. */
const HEALTH_V = 4; // 4: exact exclusions, finding ids and page lists, real HTTP statuses (audit #47) — kept scores are worked out again
/**
 * One crawl's health. `readable` false = the stored crawl could not be read (its score is not known — never zero).
 * `pages` = the pages the score is out of; `errorPages` = the distinct ones with an error.
 */
export type HealthPoint = { jobId: string; at: string | null; readable: boolean; health: number | null; pages: number | null; errorPages: number | null; pageCap: number | null };
/** A site's health: its newest finished crawl (whatever it says) and the newest crawls, oldest first, gaps included. */
export type SiteHealth = HealthPoint & { trend: HealthPoint[] };

export async function auditHealthByDomain(user: number, domains: string[]): Promise<Map<string, SiteHealth>> {
  const out = new Map<string, SiteHealth>();
  if (!domains.length) return out;
  // The newest finished crawls of each site — identity only, whatever was saved in them (a crawl whose saved result is
  // broken is still the newest, "could not be read"). The row's version (xmin, changed by any update of the row) is the
  // fingerprint: a crawl changed in any way afterwards is worked out again, and nothing of its payload is read here.
  const { rows: jobs } = await pool.query(
    `SELECT id::text AS id, host, completed_at, page_cap, fp FROM (
       SELECT id, ${HOST_SQL} AS host, completed_at, page_cap, xmin::text AS fp,
              row_number() OVER (PARTITION BY ${HOST_SQL} ORDER BY completed_at DESC, id) AS n
         FROM sitescan_jobs WHERE user_id=$1 AND status='completed' AND ${HOST_SQL} = ANY($2)) j
      WHERE n <= ${HEALTH_TREND} ORDER BY host, completed_at DESC, id`, [user, domains.map(bare)]);
  if (!jobs.length) return out;
  // Worked out once per crawl: read the saved figures; work out (and save) only the crawls that have none, or changed.
  const { rows: saved } = await pool.query("SELECT job_id, fingerprint, readable, health, error_pages, crawled FROM seo_crawl_health WHERE job_id = ANY($1) AND v=$2", [jobs.map((j: any) => j.id), HEALTH_V]);
  const known = new Map(saved.map((r: any) => [r.job_id, r]));
  const missing = jobs.filter((j: any) => known.get(j.id)?.fingerprint !== j.fp);
  if (missing.length) {
    const { rows } = await pool.query(
      `SELECT id::text AS id, xmin::text AS fp, report, ${PAGES_SQL} AS pages,
              ${WELL_FORMED_SQL} AS well_formed
         FROM sitescan_jobs WHERE id::text = ANY($1) AND user_id=$2`, [missing.map((j: any) => j.id), user]);
    for (const r of rows) {
      // The version read now (it may have changed since the list above; then it is worked out again next time).
      const fp = r.fp;
      let row: any;
      // One unreadable crawl must not take the whole dashboard down: it is "not readable", and said. A saved result that
      // is not what a finished crawl writes (no report, pages that are not pages) is not read as an empty crawl either.
      try {
        if (!r.well_formed) throw new Error("the saved crawl is not in the expected form");
        const c = healthCounts(r.report, r.pages); row = { job_id: r.id, fingerprint: fp, readable: true, health: healthScore(r.report, r.pages), error_pages: c.errorPages, crawled: c.pages };
      }
      catch (e: any) { console.warn(`[seo] crawl ${r.id} could not be read for its health: ${e?.message ?? e}`); row = { job_id: r.id, fingerprint: fp, readable: false, health: null, error_pages: null, crawled: null }; }
      known.set(r.id, row);
      await pool.query(
        `INSERT INTO seo_crawl_health(job_id, fingerprint, v, readable, health, error_pages, crawled) VALUES($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (job_id) DO UPDATE SET fingerprint=excluded.fingerprint, v=excluded.v, readable=excluded.readable, health=excluded.health, error_pages=excluded.error_pages, crawled=excluded.crawled, computed_at=now()`,
        [row.job_id, fp, HEALTH_V, row.readable, row.health, row.error_pages, row.crawled]).catch((e: any) => console.warn(`[seo] crawl health not saved: ${e?.message ?? e}`));
    }
  }
  for (const j of jobs) {
    const k = known.get(j.id);
    const point: HealthPoint = { jobId: j.id, at: j.completed_at ? new Date(j.completed_at).toISOString() : null, readable: !!k?.readable, health: k?.health ?? null,
      pages: k?.crawled ?? null, errorPages: k?.error_pages ?? null, pageCap: j.page_cap == null ? null : Number(j.page_cap) };
    // Newest first in the rows: the first is the site's current crawl, whatever it says.
    const had = out.get(j.host);
    if (!had) out.set(j.host, { ...point, trend: [point] }); else had.trend.unshift(point);
  }
  return out;
}
export const auditDomainKey = bare;

/** What the newest finished crawl says about the issues a given earlier crawl found (for the action plan). */
export type CrawlVerdict = { /** Issues of that crawl the newest one still finds. */ present: Set<string>; /** Gone, and every page they were on was crawled again (with a Google profile attached where the check needs one). */ fixed: Set<string>; /** Gone from the list, but the newest crawl could not have found them again. */ notRechecked: Set<string> };
export type AuditEvidence = {
  /** The newest finished crawl. */ latestId: string | null; scannedAt: string | null;
  /** A crawl started after that one failed: the picture is older than the customer may think. */ newerFailed: boolean;
  byCrawl: Map<string, CrawlVerdict>;
  /** Crawls asked about that were left out because too many were asked for at once (their tasks say "not checked this time", not "no record"). */
  skipped: Set<string>;
};
/** How many different origin crawls one look-up compares against. */
export const EVIDENCE_MAX_CRAWLS = 60;
/**
 * Compare the newest finished crawl of a domain against each of the named earlier crawls — the crawl a task came
 * from, not merely the crawl before last — using the same rule as the audit page (auditSummary): an issue is "fixed"
 * only when the check that found it demonstrably ran again on everything it was found on. A crawl that is not this
 * account's, not of this domain, not finished, or not older than the newest one is simply absent from the answer.
 */
export async function auditEvidence(user: number, domain: string, crawlIds: string[]): Promise<AuditEvidence> {
  const d = bare(domain);
  const [{ rows: [latest] }, { rows: [newest] }] = await Promise.all([
    pool.query(`SELECT id::text AS id, completed_at, report, ${PAGES_SQL} AS pages FROM sitescan_jobs WHERE user_id=$1 AND ${DONE_SQL} AND ${HOST_SQL}=$2 ORDER BY completed_at DESC LIMIT 1`, [user, d]),
    pool.query(`SELECT status, created_at FROM sitescan_jobs WHERE user_id=$1 AND ${HOST_SQL}=$2 ORDER BY created_at DESC LIMIT 1`, [user, d]),
  ]);
  const wanted = [...new Set(crawlIds)].filter((id) => typeof id === "string" && id && id !== latest?.id);
  const ids = wanted.slice(0, EVIDENCE_MAX_CRAWLS);
  const out: AuditEvidence = {
    latestId: latest?.id ?? null, scannedAt: latest ? latest.report?.scannedAt ?? new Date(latest.completed_at).toISOString() : null,
    // "Newer" by the clock: a failed crawl counts only if it was started after the newest finished one was completed.
    newerFailed: newest?.status === "failed" && (!latest || new Date(newest.created_at).getTime() > new Date(latest.completed_at).getTime()),
    byCrawl: new Map(), skipped: new Set(wanted.slice(EVIDENCE_MAX_CRAWLS)),
  };
  if (!latest || !ids.length) return out;
  const { rows: origins } = await pool.query(
    `SELECT id::text AS id, report, ${PAGES_SQL} AS pages FROM sitescan_jobs WHERE user_id=$1 AND ${DONE_SQL} AND ${HOST_SQL}=$2 AND id::text = ANY($3::text[]) AND completed_at < $4`, [user, d, ids, latest.completed_at]);
  for (const o of origins) {
    try {
      const sum = auditSummary(latest.report, latest.pages, { report: o.report, pages: o.pages });
      // "Still there" is by name: the origin crawl listed an issue of that key and the newest one does too.
      const was = new Set(groupFindings(o.report?.findings).keys());
      out.byCrawl.set(o.id, { present: new Set(sum.issues.map((i) => i.key).filter((k) => was.has(k))), fixed: new Set(sum.fixed.map((i) => i.key)), notRechecked: new Set(sum.notRechecked.map((i) => i.key)) });
    } catch { /* an unreadable old report proves nothing */ }
  }
  return out;
}
