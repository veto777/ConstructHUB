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

export function healthScore(report: AuditReport, pages: AuditPage[]): number | null {
  const failed = new Set(failedFetches(report).map((e) => e.url));
  const all = new Set<string>([...pages.map((p) => p.url), ...failed]);
  if (!all.size) return null;
  const bad = new Set<string>(failed);
  for (const p of pages) if (p.status >= 400) bad.add(p.url);
  for (const f of Array.isArray(report.findings) ? report.findings : []) if (f?.severity === "critical") for (const u of Array.isArray(f.urls) ? f.urls : []) if (all.has(u)) bad.add(u);
  return Math.round(((all.size - bad.size) / all.size) * 100);
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
const DONE_SQL = `status='completed' AND jsonb_typeof(report)='object'`;

export type AuditRun = { id: string; status: string; error: string | null; createdAt: string; crawled: number; pageCap: number };

/** The newest audit of a domain with the crawl before it, the health trend and any crawl in progress. */
/** Pages of two crawls compared by address (as the crawler compares them): reached now and not then, and the reverse. Pure. */
export function pageChanges(now: AuditPage[], before: AuditPage[]): { added: string[]; removed: string[] } {
  const key = (u: string) => { try { const x = new URL(u); return `${x.host.toLowerCase().replace(/^www\./, "")}${x.pathname.replace(/\/+$/, "")}${x.search}`; } catch { return u; } };
  const a = new Set(now.map((p) => key(p.url))), b = new Set(before.map((p) => key(p.url)));
  return { added: now.filter((p) => !b.has(key(p.url))).map((p) => p.url), removed: before.filter((p) => !a.has(key(p.url))).map((p) => p.url) };
}
export const PAGE_CHANGE_LIST = 50;
export type AuditComparison = { jobId: string; at: string | null; /** true = chosen by the customer (not the crawl before). */ chosen: boolean;
  addedPages: number; removedPages: number; added: string[]; removed: string[]; /** The two crawls' page limits differ: a page "no longer reached" may only be beyond the smaller one. */ capsDiffer: boolean };
export async function siteAudit(user: number, domain: string, opts: { vs?: string | null } = {}): Promise<{ /** The Google profile the newest crawl was compared with: the next crawl uses it too, so the same checks run. */ locationId: number | null; audit: (AuditSummary & { jobId: string; comparedWith: AuditComparison | null }) | null; vsMissing?: boolean; history: { jobId: string; at: string; health: number | null; errors: number; warnings: number; notices: number; crawled: number }[]; running: AuditRun | null; lastFailed: AuditRun | null }> {
  const d = bare(domain);
  const [{ rows: done }, { rows: open }] = await Promise.all([
    pool.query(
      `SELECT id, completed_at, report, page_cap, profile->>'id' AS location_id, ${PAGES_SQL} AS pages FROM sitescan_jobs
        WHERE user_id=$1 AND ${DONE_SQL} AND ${HOST_SQL}=$2 ORDER BY completed_at DESC LIMIT 12`, [user, d]),
    pool.query(
      `SELECT id, status, error, created_at, ${CRAWLED_SQL} AS crawled, page_cap FROM sitescan_jobs
        WHERE user_id=$1 AND ${HOST_SQL}=$2 ORDER BY created_at DESC LIMIT 1`, [user, d]),
  ]);
  const run = (r: any): AuditRun => ({ id: r.id, status: r.status, error: r.error, createdAt: r.created_at, crawled: r.crawled ?? 0, pageCap: r.page_cap });
  const newest = open[0];
  // The crawl to compare with: one the customer chose (this account's, this site's, finished and older than the newest),
  // else the one before the newest.
  let prev = done[1] ?? null, chosen = false, vsMissing = false;
  if (opts.vs && done[0] && opts.vs !== done[0].id) {
    const { rows: [v] } = await pool.query(
      `SELECT id, completed_at, report, page_cap, ${PAGES_SQL} AS pages FROM sitescan_jobs WHERE id=$3 AND user_id=$1 AND ${DONE_SQL} AND ${HOST_SQL}=$2 AND completed_at < $4`,
      [user, d, opts.vs, done[0].completed_at]).catch(() => ({ rows: [] as any[] }));
    if (v) { prev = v; chosen = true; } else vsMissing = true;
  }
  const audit = done[0] ? (() => {
    const s = auditSummary(done[0].report, done[0].pages, prev ? { report: prev.report, pages: prev.pages } : null);
    const ch = prev ? pageChanges(done[0].pages, prev.pages) : null;
    return { jobId: done[0].id as string, ...s, comparedWith: prev && ch ? { jobId: prev.id as string, at: prev.completed_at ? new Date(prev.completed_at).toISOString() : null, chosen,
      addedPages: ch.added.length, removedPages: ch.removed.length, added: ch.added.slice(0, PAGE_CHANGE_LIST), removed: ch.removed.slice(0, PAGE_CHANGE_LIST), capsDiffer: Number(prev.page_cap) !== Number(done[0].page_cap) } : null };
  })() : null;
  const history = done.flatMap((j: any) => {
    try {
      const s = auditSummary(j.report, j.pages);
      return [{ jobId: j.id, at: j.completed_at, health: s.health, errors: s.totals.error.affected, warnings: s.totals.warning.affected, notices: s.totals.notice.affected, crawled: s.crawled }];
    } catch { return []; }
  }).reverse();
  const locationId = Number(done[0]?.location_id) > 0 ? Number(done[0].location_id) : null;
  return {
    locationId, audit, history, ...(vsMissing ? { vsMissing } : {}),
    running: newest && (newest.status === "queued" || newest.status === "running") ? run(newest) : null,
    lastFailed: newest && newest.status === "failed" ? run(newest) : null,
  };
}

/** Health score per domain for the dashboard cards: newest completed crawl of each. */
export async function auditHealthByDomain(user: number, domains: string[]): Promise<Map<string, { health: number | null; errors: number; scannedAt: string | null }>> {
  const out = new Map<string, { health: number | null; errors: number; scannedAt: string | null }>();
  if (!domains.length) return out;
  const { rows } = await pool.query(
    `SELECT DISTINCT ON (host) host, completed_at, report, pages FROM (
       SELECT ${HOST_SQL} AS host, completed_at, report, ${PAGES_SQL} AS pages FROM sitescan_jobs
        WHERE user_id=$1 AND ${DONE_SQL} AND ${HOST_SQL} = ANY($2)) j
      ORDER BY host, completed_at DESC`, [user, domains.map(bare)]);
  for (const r of rows) {
    // One unreadable crawl must not take the whole dashboard down.
    try {
      const s = auditSummary(r.report, r.pages);
      out.set(r.host, { health: s.health, errors: s.totals.error.affected, scannedAt: r.completed_at });
    } catch (e: any) { console.warn(`[seo] audit of ${r.host} could not be read: ${e?.message ?? e}`); }
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
