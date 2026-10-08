/**
 * /seo/audit — Site Audit: health score, what the crawl found by severity, and
 * each issue with its change since the previous crawl. Reads the crawls Site
 * Scan runs (GET /api/seo/sites/:id/audit), so opening it never spends SEO
 * data; "Run new crawl" starts a Site Scan (POST /api/sitescan), one of the
 * plan's monthly scans.
 */
import { AddToPlan } from "./plan-button";
import { Fragment, useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ChevronDown, ChevronRight, Download, Loader2, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiErrorMessage } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { api, Empty, fmtDate, fmtNum, SeoShell, useSelectedSite, useSeoSites, useSeoStatus } from "./shell";
import { AuditPages } from "./audit-pages";
import { RenderCheck } from "./render";
import { OutgoingLinksView } from "./outgoing-links";
import { LinkOpportunitiesView } from "./link-opportunities";

type Severity = "error" | "warning" | "notice";
type Issue = { key: string; title: string; category: string; severity: Severity; count: number; previous: number | null; change: number | null; isNew: boolean; why: string; fix: string; items: string[] };
type Run = { id: string; status: string; error: string | null; createdAt: string; crawled: number; pageCap: number };
type Audit = {
  jobId: string; scannedAt: string | null; url: string | null; health: number | null; healthChange: number | null;
  crawled: number; pageCap: number | null; notCrawled: number; blockedByRobots: number;
  statuses: { ok: number; redirected: number; clientError: number; serverError: number; failed: number; excluded?: number };
  totals: Record<Severity, { issues: number; affected: number }>;
  scores: { overall: number | null; categories: Record<string, number | null> } | null;
  issues: Issue[]; fixed: { key: string; title: string; severity: Severity; previous: number }[]; notRechecked?: { key: string; title: string; severity: Severity; previous: number }[];
};
type Compared = { jobId: string; at: string | null; chosen: boolean; addedPages: number; removedPages: number; added: string[]; removed: string[]; capsDiffer: boolean };
type AuditData = { locationId: number | null; audit: (Audit & { latest?: boolean; completedAt?: string | null; comparedWith?: Compared | null }) | null; latestId?: string | null; crawls?: { jobId: string; at: string | null; pageCap: number | null; readable?: boolean }[]; newestUnreadable?: { jobId: string; at: string | null }; previousUnreadable?: { jobId: string; at: string | null }; atMissing?: boolean; vsMissing?: boolean; history: { jobId: string; at: string; health: number | null; errors: number; warnings: number; notices: number; crawled: number; unreadable?: boolean }[]; running: Run | null; lastFailed: Run | null };

const SEVERITY: Record<Severity, { label: string; plural: string; color: string }> = {
  error: { label: "Error", plural: "Errors", color: "var(--g-red)" },
  warning: { label: "Warning", plural: "Warnings", color: "#e8710a" },
  notice: { label: "Notice", plural: "Notices", color: "var(--g-blue)" },
};
const CATEGORY: Record<string, string> = { technical: "Technical", performance: "Performance", local: "Local", content: "Content", "ai-readiness": "AI readiness" };
const STATUS = [
  { key: "ok", label: "Working (2xx)", color: "var(--g-green)" },
  { key: "redirected", label: "Redirected (3xx)", color: "var(--g-blue)" },
  { key: "clientError", label: "Not found / blocked (4xx)", color: "#e8710a" },
  { key: "serverError", label: "Server error (5xx)", color: "var(--g-red)" },
  { key: "failed", label: "Couldn't be checked", color: "var(--g-text-2)" },
] as const;
const healthColor = (h: number) => (h >= 90 ? "var(--g-green)" : h >= 70 ? "#e8710a" : "var(--g-red)");
const healthWord = (h: number) => (h >= 90 ? "Good" : h >= 70 ? "Needs work" : "Poor");

function HealthRing({ value }: { value: number | null }) {
  const r = 52, c = 2 * Math.PI * r, v = value ?? 0;
  return (
    <svg viewBox="0 0 128 128" className="h-32 w-32 shrink-0" role="img" aria-label={value == null ? "No health score yet" : `Health score ${value} out of 100`}>
      <circle cx="64" cy="64" r={r} fill="none" stroke="var(--g-divider)" strokeWidth="10" />
      {value != null && <circle cx="64" cy="64" r={r} fill="none" stroke={healthColor(v)} strokeWidth="10" strokeLinecap="round" strokeDasharray={`${(v / 100) * c} ${c}`} transform="rotate(-90 64 64)" />}
      <text x="64" y="62" textAnchor="middle" dominantBaseline="middle" fontSize="30" fill="var(--g-text)">{value ?? "—"}</text>
      <text x="64" y="86" textAnchor="middle" fontSize="11" fill="var(--g-text-2)">{value == null ? "no data" : healthWord(v)}</text>
    </svg>
  );
}

/** Change in affected pages: fewer is better, so a drop is green. */
function Change({ issue, before }: { issue: Issue; /** The crawl compared with, in words ("the crawl before", "the crawl of Sep 3"). */ before: string }) {
  if (issue.change === null) return <span className="g-text-2">—</span>;
  if (issue.isNew) return <span className="g-chip g-chip--sm" style={{ color: "var(--g-red)" }}>New</span>;
  if (issue.change === 0) return <span className="g-move g-move--flat" aria-label="No change">·</span>;
  return issue.change < 0
    ? <span className="g-move g-move--up" aria-label={`${-issue.change} fewer than ${before}`}>▼{-issue.change}</span>
    : <span className="g-move g-move--down" aria-label={`${issue.change} more than ${before}`}>▲{issue.change}</span>;
}

/** Quoted, and a cell from the open web is never allowed to run as a spreadsheet formula. */
const csvCell = (s: string) => `"${(/^[=+\-@\t\r]/.test(s) ? `'${s}` : s).replace(/"/g, '""')}"`;
function downloadCsv(name: string, rows: string[][]) {
  const blob = new Blob([rows.map((r) => r.map(csvCell).join(",")).join("\n")], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = name; a.click();
  URL.revokeObjectURL(a.href);
}

const card = { borderColor: "var(--g-divider)", background: "var(--g-surface)" };
const tooltipStyle = { fontSize: 12, background: "var(--g-surface)", border: "1px solid var(--g-divider)", color: "var(--g-text)" };

export default function SeoAuditPage() {
  const status = useSeoStatus();
  const sites = useSeoSites();
  const [site, onSite] = useSelectedSite(sites.data);
  const qc = useQueryClient();
  const { toast } = useToast();
  const key = `/api/seo/sites/${site?.id}/audit`;
  // The crawl shown (null = the newest) and the crawl it is compared with (null = the one just before it). Chosen per
  // site; the page always says which.
  const [pick, setPick] = useState<Record<number, { at: string | null; vs: string | null }>>({});
  const at = site ? pick[site.id]?.at ?? null : null, vs = site ? pick[site.id]?.vs ?? null : null;
  const choose = (c: { at: string | null; vs: string | null }) => site && setPick((m) => ({ ...m, [site.id]: c }));
  const q = useQuery<AuditData>({
    queryKey: [key, at, vs], enabled: !!site,
    queryFn: async ({ signal }) => { const qs = new URLSearchParams({ ...(at ? { at } : {}), ...(vs ? { vs } : {}) }).toString(); const r = await fetch(`${key}${qs ? `?${qs}` : ""}`, { credentials: "include", signal }); if (!r.ok) throw new Error((await r.json().catch(() => ({}))).message ?? "The request failed"); return r.json(); }, refetchOnMount: "always", refetchInterval: (query) => (query.state.data?.running ? 6000 : false) });
  const [severity, setSeverity] = useState<Severity | "all">("all");
  const [category, setCategory] = useState("all");
  const [open, setOpen] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [view, setView] = useState<"issues" | "pages" | "links" | "outgoing" | "rendering">("issues");
  const start = useMutation({
    // The same Google profile as the last crawl, so the same checks run and the comparison is like for like.
    mutationFn: () => api("POST", "/api/sitescan", { url: `https://${site!.domain}`, pageCap: 150, psiPages: 1, ...(q.data?.locationId ? { locationId: q.data.locationId } : {}) }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: [key] }); toast({ title: "Crawl started", description: "Results appear here when it finishes — usually a few minutes." }); },
    onError: (e) => toast({ title: "Couldn't start the crawl", description: apiErrorMessage(e), variant: "destructive" }),
  });
  const d = q.data, a = d?.audit ?? null, running = d?.running ?? null;
  // A crawl that just finished changes the health score on the dashboard too.
  const wasRunning = useRef(false);
  useEffect(() => { if (wasRunning.current && !running) void qc.invalidateQueries({ queryKey: ["/api/seo/dashboard"] }); wasRunning.current = !!running; }, [running, qc]);
  const issues = (a?.issues ?? []).filter((i) => (severity === "all" || i.severity === severity) && (category === "all" || i.category === category));
  const categories = [...new Set((a?.issues ?? []).map((i) => i.category))];
  const total = a ? a.crawled + a.statuses.failed : 0;
  // Every crawl stays on the chart: one with no score (or that could not be read) is a gap, never bridged by a line.
  const trend = d?.history ?? [];
  const scored = trend.filter((h) => h.health !== null);
  const cmp = a?.comparedWith ?? null;
  const before = cmp?.chosen && cmp.at ? `the crawl of ${fmtDate(cmp.at)}` : "the crawl before";
  // Every finished crawl, newest first; the ones older than the crawl shown can be compared with.
  const crawls = d?.crawls ?? [];
  /** The crawl shown, by when it finished — the date the pickers name it by. */
  const shownDate = a?.completedAt ?? a?.scannedAt ?? null;
  const shownAt = crawls.findIndex((c) => a && c.jobId === a.jobId);
  const earlier = shownAt >= 0 ? crawls.slice(shownAt + 1) : [];
  const crawlWord = (c: { at: string | null; pageCap: number | null }, i: number) => `${fmtDate(c.at)}${crawls.filter((x) => fmtDate(x.at) === fmtDate(c.at)).length > 1 ? ` (#${crawls.length - i})` : ""}${c.pageCap ? ` · up to ${fmtNum(c.pageCap)} pages` : ""}`;
  const exportAll = () => a && downloadCsv(`site-audit-${site?.domain}.csv`, [["Severity", "Issue", "Category", "Affected", "Page or entry"], ...a.issues.flatMap((i) => i.items.map((u) => [SEVERITY[i.severity].label, i.title, CATEGORY[i.category] ?? i.category, String(i.count), u]))]);

  return (
    <SeoShell
      title="Site audit" description="Crawls your site and lists what is broken, what to improve and how — with a health score you can watch improve." site={site} onSite={onSite} sites={sites} status={status}
      actions={site && (
        <Button className="w-full sm:w-auto" disabled={!!running || start.isPending || !d} onClick={() => start.mutate()} data-testid="button-run-audit" title="Uses one of your plan's monthly Site Scans. Crawls up to 150 pages.">
          {running || start.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}
          {running ? "Crawling…" : a ? "Run new crawl" : "Run first crawl"}
        </Button>
      )}
    >
      {!site && sites.isSuccess && <Empty testId="audit-empty-sites"><h3>No sites yet</h3><p>Add your site above, then run a crawl to see its health score and issues.</p></Empty>}
      {site && q.isLoading && <p className="g-text-2 flex items-center gap-2 text-[14px]" role="status"><Loader2 className="h-4 w-4 animate-spin" /> Loading the audit…</p>}
      {site && q.isError && <div className="g-callout" role="alert" data-testid="audit-error"><h3>Couldn't load the audit</h3><p>{apiErrorMessage(q.error)}</p><button type="button" className="g-pill mt-2" onClick={() => void q.refetch()}>Try again</button></div>}
      {running && (
        <div className="g-callout mb-4" role="status" data-testid="audit-running">
          <h3 className="flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Crawling {site?.domain}</h3>
          <p>{running.status === "queued" ? "Waiting to start." : `${fmtNum(running.crawled)} of up to ${fmtNum(running.pageCap)} pages checked so far.`} This page updates by itself.</p>
        </div>
      )}
      {d && !running && d.lastFailed && (
        <div className="g-callout mb-4" role="alert" data-testid="audit-failed">
          <h3>The last crawl didn't finish</h3>
          <p>{d.lastFailed.error || "The crawl stopped before it completed."} Started {fmtDate(d.lastFailed.createdAt)}.{a ? " The results below are from the crawl before it." : ""}</p>
        </div>
      )}
      {site && d?.newestUnreadable && (
        <div className="g-callout mb-4" role="alert" data-testid="audit-unreadable">
          <h3>The newest crawl could not be read</h3>
          <p>The crawl that finished {fmtDate(d.newestUnreadable.at)} was not saved in a form we can read, so no score or issues are taken from it. Run a new crawl{d.crawls?.some((c) => c.readable !== false) ? ", or look at an earlier one" : ""}.</p>
          {a ? <p className="mt-1 text-[13px]">Shown below: the crawl of {fmtDate(a.completedAt ?? a.scannedAt)}, an earlier crawl you picked.</p>
            : (() => { const ok = d.crawls?.find((c) => c.readable !== false); return ok ? <button type="button" className="g-pill mt-2" onClick={() => choose({ at: ok.jobId, vs: null })} data-testid="button-audit-earlier">Show the crawl of {fmtDate(ok.at)}</button> : null; })()}
        </div>
      )}
      {site && d && !a && !running && !d.newestUnreadable && (
        <Empty testId="audit-empty">
          <h3>No crawl of {site.domain} yet</h3>
          <p>A crawl reads up to 150 pages of the site and checks each for broken pages, redirects, missing titles and descriptions, thin content, slow pages, and whether Google and AI assistants can read it.</p>
          <p className="mt-2">It uses one of your plan's monthly Site Scans and no SEO data credit.</p>
        </Empty>
      )}
      {/* The rendering check does not need a crawl: without one it is offered here, on its own. */}
      {site && d && !a && <div className="mt-6" data-testid="audit-rendering-alone"><RenderCheck site={site} /></div>}
      {/* Said whatever else is on the page, even with one crawl or none left. */}
      {site && d?.atMissing && <p className="mb-2 text-[13px]" role="alert" data-testid="audit-at-missing">That crawl is no longer available, so {a ? "the newest crawl is shown" : "there is no crawl to show"}.</p>}
      {site && d?.vsMissing && <p className="mb-2 text-[13px]" role="alert" data-testid="audit-vs-missing">That crawl can't be compared with (it is no longer available, or it is not older than the crawl shown){a?.comparedWith ? ", so the crawl before it is used" : a ? ", and there is no earlier crawl to compare with" : ""}.</p>}
      {site && a && (
        <>
          <div className="mb-4 grid gap-4 lg:grid-cols-3" data-testid="audit-overview">
            <section className="flex items-center gap-4 rounded-lg border p-4" style={card} data-testid="audit-health">
              <HealthRing value={a.health} />
              <div className="min-w-0">
                <h2 className="g-text text-[16px] font-medium">Health score</h2>
                <p className="g-text-2 text-[13px]">The share of crawled pages with no errors.</p>
                {a.healthChange !== null && a.healthChange !== 0 && <p className="mt-1 text-[13px]"><span className={`g-move ${a.healthChange > 0 ? "g-move--up" : "g-move--down"}`}>{a.healthChange > 0 ? "▲" : "▼"}{Math.abs(a.healthChange)}</span> <span className="g-text-2">since {before}</span></p>}
                <p className="g-text-2 mt-1 text-[12px]">Crawled {fmtDate(shownDate)}</p>
              </div>
            </section>
            <section className="rounded-lg border p-4" style={card} data-testid="audit-crawled">
              <h2 className="g-text text-[16px] font-medium">Pages crawled <span className="tabular-nums">{fmtNum(total)}</span></h2>
              <div className="my-3 flex h-3 overflow-hidden rounded-full" style={{ background: "var(--g-divider)" }} aria-hidden>
                {total > 0 && STATUS.map((s) => a.statuses[s.key] > 0 && <div key={s.key} style={{ width: `${(a.statuses[s.key] / total) * 100}%`, background: s.color }} />)}
              </div>
              <ul className="space-y-1 text-[13px]">
                {STATUS.map((s) => <li key={s.key} className="flex items-center gap-2"><span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: s.color }} aria-hidden /><span className="g-text-2">{s.label}</span><span className="g-text ml-auto tabular-nums">{fmtNum(a.statuses[s.key])}</span></li>)}
              </ul>
              {(a.statuses.excluded ?? 0) > 0 && <p className="g-text-2 mt-2 text-[12px]">{fmtNum(a.statuses.excluded)} more address{a.statuses.excluded === 1 ? " was" : "es were"} found but not audited (files such as PDFs, or links that leave the site). They don't affect the health score.</p>}
              {(a.notCrawled > 0 || a.blockedByRobots > 0) && <p className="g-text-2 mt-2 text-[12px]">{a.notCrawled > 0 ? `${fmtNum(a.notCrawled)} more pages were found but not crawled (the crawl stops at ${fmtNum(a.pageCap)}). ` : ""}{a.blockedByRobots > 0 ? `${fmtNum(a.blockedByRobots)} blocked by robots.txt.` : ""}</p>}
            </section>
            <section className="rounded-lg border p-4" style={card} data-testid="audit-totals">
              <h2 className="g-text mb-2 text-[16px] font-medium">Issues found</h2>
              <ul className="space-y-2">
                {(Object.keys(SEVERITY) as Severity[]).map((s) => (
                  <li key={s}>
                    <button type="button" className="flex w-full items-baseline gap-2 text-left" onClick={() => setSeverity(severity === s ? "all" : s)} aria-pressed={severity === s} data-testid={`button-severity-${s}`}>
                      <span className="text-[24px] leading-7 tabular-nums" style={{ color: SEVERITY[s].color }}>{fmtNum(a.totals[s].issues)}</span>
                      <span className="g-text text-[14px]">{SEVERITY[s].plural}</span>
                      <span className="g-text-2 ml-auto text-[12px] tabular-nums">{fmtNum(a.totals[s].affected)} affected</span>
                    </button>
                  </li>
                ))}
              </ul>
              <p className="g-text-2 mt-2 text-[12px]">Errors lower the health score. Warnings and notices are improvements.</p>
            </section>
          </div>

          {(scored.length > 1 || a.scores) && (
            <div className="mb-4 grid gap-4 lg:grid-cols-3">
              {scored.length > 1 && (
                <section className="rounded-lg border p-4 lg:col-span-2" style={card} data-testid="audit-trend">
                  <h2 className="g-text mb-2 text-[16px] font-medium">Health score over time</h2>
                  <div className="h-44">
                    <ResponsiveContainer>
                      <LineChart data={trend} margin={{ top: 6, right: 8, bottom: 0, left: 0 }}>
                        <CartesianGrid stroke="var(--g-divider)" vertical={false} />
                        <XAxis dataKey="at" tickFormatter={(v) => fmtDate(String(v))} tick={{ fontSize: 12, fill: "var(--g-text-2)" }} axisLine={false} tickLine={false} />
                        <YAxis domain={[0, 100]} tick={{ fontSize: 12, fill: "var(--g-text-2)" }} axisLine={false} tickLine={false} width={32} />
                        <Tooltip labelFormatter={(v) => fmtDate(String(v))} formatter={(v: number) => [v, "Health score"]} contentStyle={tooltipStyle} />
                        <Line type="monotone" dataKey="health" stroke="var(--g-green)" strokeWidth={2} dot={{ r: 3 }} connectNulls={false} isAnimationActive={false} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                  <details className="mt-2 text-[12px]" data-testid="audit-trend-list"><summary className="g-link cursor-pointer">Every crawl, as a list</summary>
                    <ul className="g-text-2 mt-1 space-y-0.5">{trend.slice().reverse().map((h) => <li key={h.jobId}>{fmtDate(h.at)}: {h.unreadable ? "could not be read" : h.health === null ? "no page could be scored" : `health ${h.health}, ${fmtNum(h.crawled)} pages`}</li>)}</ul>
                  </details>
                </section>
              )}
              {a.scores && (
                <section className={`rounded-lg border p-4 ${scored.length > 1 ? "" : "lg:col-span-3"}`} style={card} data-testid="audit-scores">
                  <h2 className="g-text mb-2 text-[16px] font-medium">By area</h2>
                  <ul className="space-y-2 text-[13px]">
                    {Object.entries(a.scores.categories).map(([k, v]) => (
                      <li key={k}>
                        <div className="flex"><span className="g-text">{CATEGORY[k] ?? k}</span><span className="g-text ml-auto tabular-nums">{v == null ? "not measured" : v}</span></div>
                        <div className="mt-1 h-1.5 overflow-hidden rounded-full" style={{ background: "var(--g-divider)" }} aria-hidden>{v != null && <div className="h-full" style={{ width: `${v}%`, background: healthColor(v) }} />}</div>
                      </li>
                    ))}
                  </ul>
                  <p className="g-text-2 mt-2 text-[12px]">Our own 0–100 rating of each area. Not a Google ranking.</p>
                </section>
              )}
            </div>
          )}

          {(crawls.length > 1 || !!d?.newestUnreadable) && (
            <section className="mb-4 rounded-lg border p-4" style={card} data-testid="audit-compare">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                <label className="flex min-w-0 max-w-full flex-wrap items-center gap-2"><span className="g-text text-[16px] font-medium">Showing</span>
                  <select className="g-select min-w-0 max-w-full" value={a.latest === false ? a.jobId : ""} data-testid="select-audit-at"
                    onChange={(e) => choose({ at: e.target.value || null, vs: null })}>
                    {d?.newestUnreadable ? <><option value="">The newest crawl ({fmtDate(d.newestUnreadable.at)}, could not be read)</option>
                      {crawls.slice(1).map((c, i) => <option key={c.jobId} value={c.jobId} disabled={c.readable === false}>Crawl of {crawlWord(c, i + 1)}{c.readable === false ? " (could not be read)" : ""}</option>)}</>
                      : <><option value="">The newest crawl ({fmtDate(crawls[0].at)})</option>
                      {crawls.slice(1).map((c, i) => <option key={c.jobId} value={c.jobId} disabled={c.readable === false}>Crawl of {crawlWord(c, i + 1)}{c.readable === false ? " (could not be read)" : ""}</option>)}</>}
                  </select></label>
                {earlier.length > 0 && (
                  <label className="flex min-w-0 max-w-full flex-wrap items-center gap-2"><span className="g-text text-[16px] font-medium">compared with</span>
                    <select className="g-select min-w-0 max-w-full" value={cmp?.chosen ? cmp.jobId : ""} data-testid="select-audit-vs"
                      onChange={(e) => choose({ at, vs: e.target.value || null })}>
                      <option value="">The crawl before it ({fmtDate(earlier[0].at)}{earlier[0].readable === false ? ", could not be read" : ""})</option>
                      {earlier.slice(1).map((c) => <option key={c.jobId} value={c.jobId} disabled={c.readable === false}>Crawl of {crawlWord(c, crawls.indexOf(c))}{c.readable === false ? " (could not be read)" : ""}</option>)}
                    </select></label>
                )}
                {q.isFetching && <Loader2 className="h-4 w-4 animate-spin" aria-label="Loading" />}
              </div>
              {crawls.length >= 100 && <p className="g-text-2 mt-1 text-[12px]">The newest 100 crawls are listed.</p>}
              {a.latest === false && <p className="mt-2 text-[13px]" role="note" data-testid="audit-older-note">You are looking at the crawl of {fmtDate(shownDate)}, not the newest. Its issues, health and counts are shown; Pages, Internal links and Outgoing links read the newest crawl. <button type="button" className="g-link" onClick={() => choose({ at: null, vs: null })}>Show the newest crawl</button></p>}
              {!cmp && <p className="g-text-2 mt-2 text-[13px]" data-testid="audit-no-compare">{d?.previousUnreadable ? `The crawl just before (${fmtDate(d.previousUnreadable.at)}) could not be read, so no change is shown. Pick an earlier crawl above to compare with.` : "No earlier crawl to compare this one with."}</p>}
              {cmp && (
                <div className="mt-2 text-[13px]">
                  <p className="g-text-2">Every change, fixed issue and health move on this page is the crawl of {fmtDate(shownDate)} against {before}{cmp.chosen && cmp.at ? "" : cmp.at ? ` (${fmtDate(cmp.at)})` : ""}.</p>
                  <p className="g-text mt-1" data-testid="text-audit-page-changes">{fmtNum(cmp.addedPages)} page{cmp.addedPages === 1 ? "" : "s"} reached in the crawl of {fmtDate(shownDate)} and not in {before}; {fmtNum(cmp.removedPages)} the other way round.</p>
                  {cmp.capsDiffer && <p className="g-text-2 mt-1 text-[12px]">The two crawls stopped at different page limits, so a page "not reached now" may only lie beyond the smaller limit.</p>}
                  {(cmp.addedPages > 0 || cmp.removedPages > 0) && (
                    <details className="mt-1" data-testid="audit-page-changes">
                      <summary className="g-link cursor-pointer">Show the pages</summary>
                      <div className="mt-2 grid gap-4 md:grid-cols-2">
                        {([[`Reached on ${fmtDate(shownDate)}, not before`, cmp.added, cmp.addedPages], [`Reached before, not on ${fmtDate(shownDate)}`, cmp.removed, cmp.removedPages]] as const).map(([t, list, n]) => (
                          <div key={t}><h3 className="g-text font-medium">{t}</h3>
                            {list.length === 0 ? <p className="g-text-2">None.</p> : <ul className="space-y-0.5">{list.map((u) => <li key={u} className="truncate"><a href={u} className="g-link" target="_blank" rel="noreferrer">{u}</a></li>)}</ul>}
                            {n > list.length && <p className="g-text-2 text-[12px]">The first {fmtNum(list.length)} of {fmtNum(n)}.</p>}
                          </div>))}
                      </div>
                      <p className="g-text-2 mt-2 text-[12px]">"Not reached" means the crawl did not get to the page — it may still exist (a removed link, a robots rule or the page limit can each stop a crawl short of it).</p>
                    </details>
                  )}
                </div>
              )}
            </section>
          )}
          <nav className="g-tabs" aria-label="Audit views">
            {([["issues", `Issues (${a.issues.length})`], ["pages", `Pages (${a.crawled})`], ["links", "Internal links"], ["outgoing", "Outgoing links"], ["rendering", "Rendering"]] as const).map(([v, label]) => <a key={v} href={`#${v}`} aria-current={view === v ? "page" : undefined} onClick={(e) => { e.preventDefault(); setView(v); }} data-testid={`tab-audit-view-${v}`}>{label}</a>)}
          </nav>
          {a.latest === false && (view === "pages" || view === "links" || view === "outgoing") && <p className="g-text-2 mb-2 text-[12px]" role="note">This view is the newest crawl ({fmtDate(crawls[0]?.at ?? null)}), not the crawl of {fmtDate(shownDate)} shown above.</p>}
          {/* These read the newest crawl; keyed by it, so a crawl that finishes while one is open is read again at once. */}
          {view === "pages" && <AuditPages key={d?.latestId ?? ""} crawlId={d?.latestId} site={site} issueTitles={Object.fromEntries(a.issues.map((i) => [i.key, i.title]))} />}
          {view === "links" && site && <LinkOpportunitiesView key={d?.latestId ?? ""} crawlId={d?.latestId} site={site} />}
          {view === "outgoing" && site && <OutgoingLinksView key={d?.latestId ?? ""} crawlId={d?.latestId} site={site} />}
          {view === "rendering" && site && <RenderCheck site={site} />}
          {view === "issues" && (<>
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <nav className="g-tabs !mb-0" aria-label="Issue severity">
              {(["all", "error", "warning", "notice"] as const).map((s) => <a key={s} href={`#${s}`} aria-current={severity === s ? "page" : undefined} onClick={(e) => { e.preventDefault(); setSeverity(s); }} data-testid={`tab-audit-${s}`}>{s === "all" ? `All issues (${a.issues.length})` : `${SEVERITY[s].plural} (${a.totals[s].issues})`}</a>)}
            </nav>
            <label className="ml-auto flex items-center gap-2 text-[13px]"><span className="g-text-2">Area</span>
              <select className="g-select" value={category} onChange={(e) => setCategory(e.target.value)} data-testid="select-audit-category">
                <option value="all">All areas</option>
                {categories.map((c) => <option key={c} value={c}>{CATEGORY[c] ?? c}</option>)}
              </select>
            </label>
            <button type="button" className="g-pill g-pill--sm" onClick={exportAll} data-testid="button-audit-export"><Download /> Export</button>
            <Link href="/site-scan" className="g-pill g-pill--sm" data-testid="link-audit-fixplan">Step-by-step fix plan</Link>
          </div>
          {issues.length === 0 ? (
            <Empty testId="audit-no-issues"><h3>{a.issues.length ? "No issues match these filters" : "No issues found"}</h3><p>{a.issues.length ? "Choose a different severity or area." : "The crawl didn't find anything to fix on the pages it checked."}</p></Empty>
          ) : (
            <div className="overflow-x-auto">
            <table className="g-table w-full" data-testid="table-audit-issues">
              <thead><tr><th aria-label="Show details" className="w-12" /><th>Issue</th><th>Area</th><th className="num">Affected</th><th className="num whitespace-nowrap pr-2" title={`Change in affected pages since ${before}`}>Change</th></tr></thead>
              <tbody>
                {issues.map((i) => {
                  const isOpen = open === i.key, shown = isOpen && !showAll ? i.items.slice(0, 25) : i.items;
                  return (
                    <Fragment key={i.key}>
                      <tr data-testid={`row-issue-${i.key}`}>
                        <td><button type="button" className="g-pill !min-h-8 !px-2" aria-expanded={isOpen} aria-label={`${isOpen ? "Hide" : "Show"} details for ${i.title}`} onClick={() => { setOpen(isOpen ? null : i.key); setShowAll(false); }} data-testid={`button-issue-${i.key}`}>{isOpen ? <ChevronDown /> : <ChevronRight />}</button></td>
                        <td><span className="mr-2 inline-block h-2.5 w-2.5 rounded-full align-middle" style={{ background: SEVERITY[i.severity].color }} aria-hidden /><span className="sr-only">{SEVERITY[i.severity].label}: </span>{i.title}</td>
                        <td data-label="Area" className="g-text-2">{CATEGORY[i.category] ?? i.category}</td>
                        <td className="num" data-label="Affected">{fmtNum(i.count)}</td>
                        <td className="num pr-2" data-label={`Change since ${before}`}><Change issue={i} before={before} /></td>
                      </tr>
                      {isOpen && (
                        <tr data-testid={`detail-issue-${i.key}`}>
                          <td />
                          <td colSpan={4}>
                            {i.why && <p className="g-text text-[13px]"><b className="font-medium">Why it matters:</b> {i.why}</p>}
                            {i.fix && <p className="g-text mt-1 text-[13px]"><b className="font-medium">How to fix:</b> {i.fix}</p>}
                            <ul className="mt-2 space-y-0.5 text-[13px]">
                              {shown.map((u) => <li key={u} className="truncate">{/^https?:\/\//.test(u) ? <a href={u} className="g-link" target="_blank" rel="noreferrer">{u}</a> : <span className="g-text">{u}</span>}</li>)}
                            </ul>
                            <div className="mt-2 flex flex-wrap items-center gap-2">
                              {!showAll && i.items.length > 25 && <button type="button" className="g-pill g-pill--sm" onClick={() => setShowAll(true)}>Show all {fmtNum(i.items.length)}</button>}
                              {i.count > i.items.length && <span className="g-text-2 text-[12px]">Showing the first {fmtNum(i.items.length)} of {fmtNum(i.count)}.</span>}
                              <button type="button" className="g-pill g-pill--sm" onClick={() => downloadCsv(`${i.key}-${site.domain}.csv`, [["Issue", "Page or entry"], ...i.items.map((u) => [i.title, u])])}><Download /> Export this list</button>
                              {a.latest !== false && <AddToPlan siteId={site.id} testId={`button-plan-${i.key}`} tasks={[{ kind: "audit", title: `Fix: ${i.title}`, target: null, facts: { affected: i.count, severity: i.severity, crawlId: a.jobId, crawlAt: a.scannedAt, ...(i.items.length ? { examples: i.items.slice(0, 3).join(" , ").slice(0, 300) } : {}), ...(i.why ? { finding: i.why.length > 300 ? `${i.why.slice(0, 297)}…` : i.why } : {}) }, source: `audit:${i.key}` }]} />}
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
            </div>
          )}
          {(a.notRechecked?.length ?? 0) > 0 && (
            <section className="mt-6" data-testid="audit-not-rechecked">
              <h2 className="g-text mb-2 text-[16px] font-medium">Not re-checked this time</h2>
              <p className="g-text-2 mb-2 text-[13px]">{before.charAt(0).toUpperCase() + before.slice(1)} found these, and this crawl could not check them the same way — it didn't look at the same pages, didn't measure speed on them again, only sampled the pages for that check, or had no Google profile to compare with. So they are not counted as fixed.</p>
              <ul className="g-text-2 space-y-1 text-[13px]">
                {a.notRechecked!.map((f) => <li key={f.key}>{f.title} <span className="tabular-nums">({fmtNum(f.previous)} before)</span></li>)}
              </ul>
            </section>
          )}
          {a.fixed.length > 0 && (
            <section className="mt-6" data-testid="audit-fixed">
              <h2 className="g-text mb-2 text-[16px] font-medium">Fixed since {before}</h2>
              <ul className="g-text-2 space-y-1 text-[13px]">
                {a.fixed.map((f) => <li key={f.key}><span className="g-move g-move--up">✓</span> {f.title} <span className="tabular-nums">({fmtNum(f.previous)} before)</span></li>)}
              </ul>
            </section>
          )}
          </>)}
        </>
      )}
    </SeoShell>
  );
}
