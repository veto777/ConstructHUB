/**
 * Site Audit for ConstructHUB SEO: health score, crawl status and the issue
 * list with its change since the previous crawl, read from the crawls Site
 * Scan already runs (server/sitescan — sitescan_jobs.report / .state).
 * Nothing here calls the data vendor, so an audit never spends SEO data; a
 * crawl is one of the plan's monthly Site Scans.
 */
import { pool } from "../db";

export type AuditSeverity = "error" | "warning" | "notice";
export type AuditPage = { url: string; status: number; redirects: number };
type Finding = { id: string; category: string; severity: string; title: string; urls?: string[]; why?: string; fix?: string };
export type AuditReport = { scannedAt?: string; url?: string; remaining?: number; blocked?: number; errors?: { url: string }[]; findings?: Finding[]; scores?: { overall: number | null; categories: Record<string, number | null> }; coverage?: { pageCap?: number } };

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
  statuses: { ok: number; redirected: number; clientError: number; serverError: number; failed: number };
  totals: Record<AuditSeverity, { issues: number; affected: number }>;
  scores: AuditReport["scores"] | null;
  issues: AuditIssue[];
  /** Issues the previous crawl had that this one no longer finds. */
  fixed: { key: string; title: string; severity: AuditSeverity; previous: number }[];
};

export const ITEM_CAP = 500;
const SEVERITY: Record<string, AuditSeverity> = { critical: "error", warning: "warning", info: "notice" };
const RANK: Record<AuditSeverity, number> = { error: 0, warning: 1, notice: 2 };

/** Per-entry findings (one per missing service, one per PageSpeed run) roll up into one issue. */
const ROLLUPS: { test: RegExp; key: (m: RegExpMatchArray) => string; title: (m: RegExpMatchArray) => string; item: (f: Finding) => string }[] = [
  {
    test: /^gap-([a-z_]+)-/,
    key: (m) => `gap-${m[1]}`,
    title: (m) => `Google Business Profile ${m[1].replace(/_/g, " ")} with no matching page`,
    item: (f) => f.title.replace(/^No matching [^:]+: /, ""),
  },
  {
    test: /^psi-(mobile|desktop)-/,
    key: (m) => `psi-${m[1]}`,
    title: (m) => `${m[1] === "mobile" ? "Mobile" : "Desktop"} PageSpeed score below 90`,
    item: (f) => `${f.urls?.[0] ?? ""} — score ${f.title.split(": ").pop()}`,
  },
];

export function issueKey(id: string): string {
  for (const r of ROLLUPS) { const m = id.match(r.test); if (m) return r.key(m); }
  return id;
}

type Group = { key: string; title: string; category: string; severity: AuditSeverity; why: string; fix: string; items: string[] };

export function groupFindings(findings: Finding[] | undefined): Map<string, Group> {
  const groups = new Map<string, Group>();
  for (const f of findings ?? []) {
    if (!f || typeof f.id !== "string") continue;
    const severity = SEVERITY[f.severity] ?? "notice";
    let key = f.id, title = f.title, items = (f.urls ?? []).filter((u) => typeof u === "string");
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
export function healthScore(report: AuditReport, pages: AuditPage[]): number | null {
  const failed = new Set((report.errors ?? []).map((e) => e.url));
  const all = new Set<string>([...pages.map((p) => p.url), ...failed]);
  if (!all.size) return null;
  const bad = new Set<string>(failed);
  for (const p of pages) if (p.status >= 400) bad.add(p.url);
  for (const f of report.findings ?? []) if (f.severity === "critical") for (const u of f.urls ?? []) if (all.has(u)) bad.add(u);
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
  const fixed = before ? [...before.values()].filter((g) => !now.has(g.key)).map((g) => ({ key: g.key, title: g.title, severity: g.severity, previous: g.items.length })) : [];
  const totals = { error: { issues: 0, affected: 0 }, warning: { issues: 0, affected: 0 }, notice: { issues: 0, affected: 0 } };
  for (const i of issues) { totals[i.severity].issues++; totals[i.severity].affected += i.count; }
  const health = healthScore(report, pages), prevHealth = previous ? healthScore(previous.report, previous.pages) : null;
  const statuses = { ok: 0, redirected: 0, clientError: 0, serverError: 0, failed: (report.errors ?? []).length };
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
    statuses, totals, scores: report.scores ?? null, issues, fixed,
  };
}

/** sitescan_jobs.url → the bare host seo_sites.domain stores. */
const HOST_SQL = `regexp_replace(regexp_replace(lower(url), '^https?://(www\\.)?', ''), '[/:?#].*$', '')`;
const bare = (domain: string) => domain.toLowerCase().replace(/^www\./, "");
const PAGES_SQL = `COALESCE((SELECT jsonb_agg(jsonb_build_object('url', p->>'url', 'status', COALESCE((p->>'status')::int, 0), 'redirects', jsonb_array_length(COALESCE(p->'redirects', '[]'::jsonb))))
                              FROM jsonb_array_elements(state->'pages') p), '[]'::jsonb)`;

export type AuditRun = { id: string; status: string; error: string | null; createdAt: string; crawled: number; pageCap: number };

/** The newest audit of a domain with the crawl before it, the health trend and any crawl in progress. */
export async function siteAudit(user: number, domain: string): Promise<{ audit: (AuditSummary & { jobId: string }) | null; history: { jobId: string; at: string; health: number | null; errors: number; warnings: number; notices: number; crawled: number }[]; running: AuditRun | null; lastFailed: AuditRun | null }> {
  const d = bare(domain);
  const [{ rows: done }, { rows: open }] = await Promise.all([
    pool.query(
      `SELECT id, completed_at, report, ${PAGES_SQL} AS pages FROM sitescan_jobs
        WHERE user_id=$1 AND status='completed' AND report IS NOT NULL AND ${HOST_SQL}=$2 ORDER BY completed_at DESC LIMIT 12`, [user, d]),
    pool.query(
      `SELECT id, status, error, created_at, jsonb_array_length(state->'pages') AS crawled, page_cap FROM sitescan_jobs
        WHERE user_id=$1 AND ${HOST_SQL}=$2 ORDER BY created_at DESC LIMIT 1`, [user, d]),
  ]);
  const run = (r: any): AuditRun => ({ id: r.id, status: r.status, error: r.error, createdAt: r.created_at, crawled: r.crawled ?? 0, pageCap: r.page_cap });
  const newest = open[0];
  const audit = done[0] ? { jobId: done[0].id as string, ...auditSummary(done[0].report, done[0].pages, done[1] ? { report: done[1].report, pages: done[1].pages } : null) } : null;
  const history = done.map((j: any) => {
    const s = auditSummary(j.report, j.pages);
    return { jobId: j.id, at: j.completed_at, health: s.health, errors: s.totals.error.affected, warnings: s.totals.warning.affected, notices: s.totals.notice.affected, crawled: s.crawled };
  }).reverse();
  return {
    audit, history,
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
        WHERE user_id=$1 AND status='completed' AND report IS NOT NULL AND ${HOST_SQL} = ANY($2)) j
      ORDER BY host, completed_at DESC`, [user, domains.map(bare)]);
  for (const r of rows) {
    const s = auditSummary(r.report, r.pages);
    out.set(r.host, { health: s.health, errors: s.totals.error.affected, scannedAt: r.completed_at });
  }
  return out;
}
export const auditDomainKey = bare;
