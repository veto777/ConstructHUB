/**
 * /seo/audit — Site Audit: health score, what the crawl found by severity, and
 * each issue with its change since the previous crawl. Reads the crawls Site
 * Scan runs (GET /api/seo/sites/:id/audit), so opening it never spends SEO
 * data; "Run new crawl" starts a Site Scan (POST /api/sitescan), one of the
 * plan's monthly scans. Nothing starts on arrival.
 *
 * The address is the state (links.ts): `site`, `tab`, `severity`, `area`, `issue`, `status`, `show`, `page`, `at` and
 * `vs` are read from it on arrival and written to it by every pick on the page, so a link into this page and a filter
 * chosen on it are the same thing, and the back button undoes a pick. Each tab owns some of them (OWNED); a link to a
 * tab carries only that tab's, and one that arrives for another tab is said so in the chip, with a link that takes it
 * there. Every figure on the page is a link that lands on its data with the narrowing applied; what narrowed a view
 * is said in its data-testid="active-filter" chip. The reveals are addresses too (`all` — every entry of the open issue,
 * every row of the links / outgoing tabs; `more` — the rows the pages tab lists), so "Show all" / "Show more" are links
 * and the back button undoes them; no tab carries them on (a pick or another tab starts from the first rows again).
 */
import { AddToPlan } from "./plan-button";
import { Fragment, useEffect, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, Download, Loader2, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiErrorMessage } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { api, Empty, fmtDate, fmtNum, HIGHLIGHT, SeoShell, useAddress, useHash, useSelectedSite, useSeoSites, useSeoStatus } from "./shell";
import { DeltaBadge } from "./viz";
import { seoLinks, setParam, setParams } from "./links";
import { ActiveFilter, AMBER, CHEVRON, COMPACT_TABLE, DETAIL_CELL, FIG, FIG_BIG, HealthRing, HealthTrend, PILL, RatingBar, SeverityColumn, StatusBar, SUMMARY, TABS, type AuditParams, type Foreign } from "./viz-audit";
import { AuditPages } from "./audit-pages";
import { RenderCheck } from "./render";
import { OutgoingLinksView } from "./outgoing-links";
import { LinkOpportunitiesView } from "./link-opportunities";

type Severity = "error" | "warning" | "notice";
type View = NonNullable<AuditParams["tab"]>;
type Issue = { key: string; title: string; category: string; severity: Severity; count: number; previous: number | null; change: number | null; isNew: boolean; notRechecked?: number; why: string; fix: string; items: string[] };
type Run = { id: string; status: string; error: string | null; createdAt: string; crawled: number; pageCap: number };
type Audit = {
  jobId: string; scannedAt: string | null; url: string | null; health: number | null; healthChange: number | null;
  crawled: number; pageCap: number | null; notCrawled: number; blockedByRobots: number;
  statuses: { ok: number; redirected: number; clientError: number; serverError: number; failed: number; excluded?: number; unusual?: number };
  totals: Record<Severity, { issues: number; affected: number }>;
  scores: { overall: number | null; categories: Record<string, number | null> } | null;
  issues: Issue[]; fixed: { key: string; title: string; severity: Severity; previous: number }[]; notRechecked?: { key: string; title: string; severity: Severity; previous: number }[];
};
type Compared = { jobId: string; at: string | null; chosen: boolean; addedPages: number; removedPages: number; added: string[]; removed: string[]; capsDiffer: boolean };
type AuditData = { locationId: number | null; audit: (Audit & { latest?: boolean; completedAt?: string | null; comparedWith?: Compared | null }) | null; latestId?: string | null; latestKey?: string | null; crawls?: { jobId: string; at: string | null; pageCap: number | null; readable?: boolean }[]; newestUnreadable?: { jobId: string; at: string | null }; previousUnreadable?: { jobId: string; at: string | null }; atMissing?: boolean; vsMissing?: boolean; history: { jobId: string; at: string; health: number | null; errors: number; warnings: number; notices: number; crawled: number; unreadable?: boolean }[]; running: Run | null; lastFailed: Run | null };

/** Red, amber, blue — what errors, warnings and notices mean (as in Ahrefs); the only coloured dots on the page. */
const SEVERITY: Record<Severity, { label: string; plural: string; color: string }> = {
  error: { label: "Error", plural: "Errors", color: "var(--g-red)" },
  warning: { label: "Warning", plural: "Warnings", color: AMBER },
  notice: { label: "Notice", plural: "Notices", color: "var(--g-blue)" },
};
const CATEGORY: Record<string, string> = { technical: "Technical", performance: "Performance", local: "Local", content: "Content", "ai-readiness": "AI readiness" };
/** An area's name: only from the known list (an area name from the crawl is never looked up as anything else). */
const catName = (k: unknown) => (typeof k === "string" ? (Object.prototype.hasOwnProperty.call(CATEGORY, k) ? CATEGORY[k] : k) : "Other");
/** A stored crawl error as a customer sentence: one plain line, at most 200 characters, else the general wording. */
const crawlError = (e: string | null) => e || "The crawl stopped before it completed.";
const VIEWS: View[] = ["issues", "pages", "links", "outgoing", "rendering"];
const isView = (s: string | null): s is View => VIEWS.includes(s as View);
const isSeverity = (s: string | null): s is Severity => s === "error" || s === "warning" || s === "notice";
type Narrowing = "severity" | "area" | "issue" | "status" | "show" | "page" | "result";
/** The narrowings each tab reads (links.ts names them); a link to a tab carries only its own. */
const OWNED: Record<View, Narrowing[]> = {
  issues: ["severity", "area", "issue"],
  pages: ["status", "show", "page", "severity", "issue", "area"],
  links: ["page"], outgoing: ["page"], rendering: ["page", "result"],
};
const TAB_LABEL: Record<View, string> = { issues: "Issues", pages: "Pages", links: "Internal links", outgoing: "Outgoing links", rendering: "Rendering" };
/**
 * The status bar's shades, the same in light and dark mode: green for pages that work, amber and red for the ones that
 * don't, blue (muted) for redirects, and the two greys for answers nothing can be said about. The legend writes every
 * number beside its swatch, so the colour is never the only way to tell them apart. `status` is the word the pages tab
 * takes in the address for that cut.
 */
const STATUS = [
  { key: "ok", status: "2xx", label: "Working (2xx)", color: "#1e8e3e" },
  { key: "redirected", status: "3xx", label: "Redirected (3xx)", color: "var(--g-blue)" },
  { key: "clientError", status: "4xx", label: "Not found / blocked (4xx)", color: AMBER },
  { key: "serverError", status: "5xx", label: "Server error (5xx)", color: "#d93025" },
  { key: "failed", status: "unchecked", label: "Couldn't be checked", color: "var(--g-text-2)" },
  { key: "unusual", status: "unusual", label: "Unusual answer (1xx, or above 599)", color: "var(--g-text)" },
] as const;
/** The path of a page of the site (the pages tab names pages by path); null for an address on another site. */
const ownPath = (u: string, domain: string) => { try { const x = new URL(u); const bare = (h: string) => h.toLowerCase().replace(/^www\./, ""); return bare(x.hostname) === bare(domain) || bare(x.hostname).endsWith(`.${bare(domain)}`) ? (x.pathname || "/") + x.search : null; } catch { return null; } };

/** Change in affected pages: fewer is better, so a drop is green. */
function Change({ issue, before }: { issue: Issue; /** The crawl compared with, in words ("the crawl before", "the crawl of Sep 3"). */ before: string }) {
  if (issue.change === null) return <span className="g-text-2">—</span>;
  // Pages that dropped off the list only because they were not looked at again are not counted as improvements.
  const extra = (issue.notRechecked ?? 0) > 0 ? <span className="g-text-2 block text-[11px]">{issue.notRechecked} not re-checked</span> : null;
  if (extra) return <>{issue.change === 0 ? <span className="g-move g-move--flat" aria-label="No change on the pages compared">·</span> : issue.change < 0 ? <span className="g-move g-move--up" aria-label={`${-issue.change} fewer than ${before}, on the pages compared`}>▼{-issue.change}</span> : <span className="g-move g-move--down" aria-label={`${issue.change} more than ${before}, on the pages compared`}>▲{issue.change}</span>}{extra}</>;
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
/** A small blue heading, the same as the dashboard's labels. */
const heading = { color: "var(--g-blue)" };
/** The thin divider between the columns of the overview row. */
const divider = { borderColor: "var(--g-divider)" };

export default function SeoAuditPage() {
  const status = useSeoStatus();
  const sites = useSeoSites();
  const [site, onSite] = useSelectedSite(sites.data);
  const [, navigate] = useLocation();
  const P = useAddress();
  const hash = useHash();
  const qc = useQueryClient();
  const { toast } = useToast();
  const key = `/api/seo/sites/${site?.id}/audit`;
  // The crawl shown (null = the newest) and the crawl it is compared with (null = the one just before it), from the
  // address; the page always says which.
  const at = P.get("at"), vs = P.get("vs");
  const choose = (c: { at: string | null; vs: string | null }) => setParams({ at: c.at, vs: c.vs });
  const view: View = isView(P.get("tab")) ? (P.get("tab") as View) : "issues";
  const severityParam = P.get("severity");
  const severity: Severity | "all" = isSeverity(severityParam) ? severityParam : "all";
  const areaParam = P.get("area"), issueParam = P.get("issue"), statusParam = P.get("status"), showParam = P.get("show"), pageParam = P.get("page"), resultParam = P.get("result");
  // The site: the shell honours `site` in the address and writes it when one is picked (useSelectedSite). A site
  // picked on this page also drops the choices that belong to the other site's crawls (at, vs, issue, page) — in place,
  // so the entry the shell just wrote is corrected and the back button still returns to the crawl before. An address
  // with no site, or one naming a site this account does not have, gets the one shown (in place), so a copied address
  // names it. Nothing here ever leaves the page: an old or unknown crawl in `at` / `vs` is said on the page instead.
  const picked = useRef(false);
  const pickSite = (id: number) => { picked.current = true; onSite(id); };
  useEffect(() => {
    if (!site) return;
    const want = Number(P.get("site")) || null;
    if (picked.current) { picked.current = false; if (at || vs || issueParam || pageParam) setParams({ at: null, vs: null, issue: null, page: null }, true); }
    else if (want !== site.id && !sites.data?.some((s) => s.id === want)) setParam("site", site.id, true);
  }, [site?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const q = useQuery<AuditData>({
    queryKey: [key, at, vs], enabled: !!site,
    queryFn: async ({ signal }) => { const qs = new URLSearchParams({ ...(at ? { at } : {}), ...(vs ? { vs } : {}) }).toString(); const r = await fetch(`${key}${qs ? `?${qs}` : ""}`, { credentials: "include", signal }); if (!r.ok) throw new Error((await r.json().catch(() => ({}))).message ?? "The request failed"); return r.json(); }, refetchOnMount: "always", refetchOnWindowFocus: "always",
    // Choosing another crawl keeps this site's answer on screen (marked as loading) so the choices keep their focus.
    placeholderData: (prev, pq) => (pq?.queryKey[0] === key ? prev : undefined),
    // While a crawl runs, every 6 seconds; otherwise every 5 minutes, so a crawl finished (or changed) elsewhere shows up.
    refetchInterval: (query) => (query.state.data?.running ? 6000 : 5 * 60_000) });
  // The reveals (links.ts audit `all` / `more`): read from the address; a link to anything else drops them.
  const showAll = ["true", "1"].includes(P.get("all") ?? "");
  const moreParam = P.get("more"), moreRows = moreParam !== null && /^\d{1,5}$/.test(moreParam) ? Number(moreParam) : null;
  const start = useMutation({
    // The same Google profile as the last crawl, so the same checks run and the comparison is like for like.
    mutationFn: () => api("POST", "/api/sitescan", { url: `https://${site!.domain}`, pageCap: 150, psiPages: 1, ...(q.data?.locationId ? { locationId: q.data.locationId } : {}) }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: [key] }); toast({ title: "Crawl started", description: "Results appear here when it finishes — usually a few minutes." }); },
    onError: (e) => toast({ title: "Couldn't start the crawl", description: apiErrorMessage(e), variant: "destructive" }),
  });
  // A choice that fails keeps the last answer for this site on screen (said), so another crawl can be chosen.
  const [last, setLast] = useState<{ siteId: number; data: AuditData } | null>(null);
  useEffect(() => { if (site && q.data && !q.isPlaceholderData) setLast({ siteId: site.id, data: q.data }); }, [q.data, q.isPlaceholderData, site?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const d = q.data ?? (q.isError && last && site && last.siteId === site.id ? last.data : undefined), a = d?.audit ?? null, running = d?.running ?? null;
  // A crawl that just finished changes the health score on the dashboard too.
  const wasRunning = useRef(false);
  useEffect(() => { if (wasRunning.current && !running) void qc.invalidateQueries({ queryKey: ["/api/seo/dashboard"] }); wasRunning.current = !!running; }, [running, qc]);
  const categories = [...new Set((a?.issues ?? []).map((i) => i.category))];
  // `area` is an area's name as links.ts writes it ("Content"); its key ("content") is taken too. An area no issue of
  // this crawl is in still narrows (to nothing), and the chip says which.
  const areaKey = areaParam ? (categories.find((c) => c.toLowerCase() === areaParam.toLowerCase() || catName(c).toLowerCase() === areaParam.toLowerCase()) ?? areaParam) : "all";
  // The issue opened by the address is always listed, whatever the other narrowings.
  const issues = (a?.issues ?? []).filter((i) => ((severity === "all" || i.severity === severity) && (areaKey === "all" || i.category === areaKey)) || i.key === issueParam);
  const openIssue = issueParam ? (a?.issues ?? []).find((i) => i.key === issueParam) ?? null : null;
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
  const exportAll = () => a && downloadCsv(`site-audit-${site?.domain}.csv`, [["Severity", "Issue", "Category", "Affected", "Page or entry"], ...a.issues.flatMap((i) => i.items.map((u) => [SEVERITY[i.severity].label, i.title, catName(i.category), String(i.count), u]))]);
  /** An address on this page for this site, keeping the crawl shown and compared (`at`, `vs`) unless `p` says otherwise. */
  const go = (p: AuditParams = {}) => seoLinks.audit(site?.id ?? 0, { at: at ?? undefined, vs: vs ?? undefined, ...p });
  /** Every narrowing the address carries, by name. */
  const current: Record<Narrowing, string | undefined> = { severity: severity === "all" ? undefined : severity, area: areaParam ?? undefined, issue: issueParam ?? undefined, status: statusParam ?? undefined, show: showParam ?? undefined, page: pageParam ?? undefined, result: resultParam ?? undefined };
  /** The current address with one narrowing changed — what a filter picked on the page links to; only this tab's narrowings ride along. */
  const here = (p: AuditParams = {}) => go({ tab: view === "issues" ? undefined : view, ...Object.fromEntries(OWNED[view].map((k) => [k, current[k]])), ...p });
  /** A page of the site, its row opened on the pages tab. */
  const pageHref = (path: string) => go({ tab: "pages", page: path });
  // A narrowing that arrived for another tab (severity on the outgoing tab, show on the issues tab): said in the chip,
  // with a link that takes it to the tab that reads it, and dropped by the chip's Clear.
  const foreignKeys = (Object.keys(current) as Narrowing[]).filter((k) => current[k] && !OWNED[view].includes(k) && !(view === "rendering" && k === "area" && current[k]!.toLowerCase() === "performance"));
  const foreignTab: View = foreignKeys.some((k) => OWNED.issues.includes(k)) && view !== "issues" ? "issues" : foreignKeys.every((k) => k === "result") ? "rendering" : "pages";
  /** A narrowing in words, whatever tab it belongs to (the chip of another tab, and the chip shown while the crawl loads). */
  const wordOf = (k: Narrowing, v: string) => k === "severity" ? (isSeverity(v) ? SEVERITY[v].plural : `severity “${v}”`) : k === "area" ? `area ${v}` : k === "issue" ? (a ? ((a.issues ?? []).find((i) => i.key === v) ? `issue “${a.issues.find((i) => i.key === v)!.title}”` : "an issue this crawl did not find") : "one issue") : k === "status" ? `answer ${v}` : k === "show" ? `pages pill “${v}”` : k === "result" ? `rendering result “${v}”` : `page ${v}`;
  const foreign: Foreign | undefined = foreignKeys.length ? {
    words: `${foreignKeys.map((k) => wordOf(k, current[k]!)).join(", ")} — narrows the ${TAB_LABEL[foreignTab]} tab, not this one`,
    href: go({ tab: foreignTab === "issues" ? undefined : foreignTab, ...Object.fromEntries(foreignKeys.filter((k) => OWNED[foreignTab].includes(k)).map((k) => [k, current[k]])) }),
    label: `Open ${TAB_LABEL[foreignTab]} with it`,
  } : undefined;
  /** Where the health change leads: the comparison, and the lists of what was fixed and what was not re-checked. */
  const changeHash = a?.fixed.length ? "#audit-fixed" : a?.notRechecked?.length ? "#audit-not-rechecked" : "#audit-compare";
  // Arrived with an issue, or a #part naming a section: brought into view once the crawl it belongs to is on screen.
  // "#audit-page-changes" also opens the list of pages reached in one crawl and not the other.
  const openRef = useRef<HTMLTableRowElement>(null);
  const [pagesOpen, setPagesOpen] = useState(false);
  const [trendOpen, setTrendOpen] = useState(false);
  useEffect(() => { if (view === "issues" && issueParam && a && !q.isPlaceholderData) openRef.current?.scrollIntoView({ block: "nearest" }); }, [issueParam, a?.jobId, q.isPlaceholderData, view]);
  useEffect(() => { if (hash === "audit-page-changes") setPagesOpen(true); if (hash === "audit-trend-list") setTrendOpen(true); }, [hash]);
  // (Also with no crawl to show: the rendering check offered on its own has parts a link can name.)
  useEffect(() => { if (!hash || !d || q.isPlaceholderData) return; document.getElementById(hash)?.scrollIntoView({ block: "start" }); }, [hash, !!d, a?.jobId, cmp?.jobId, q.isPlaceholderData, pagesOpen, trendOpen]); // eslint-disable-line react-hooks/exhaustive-deps
  // What narrowed the issues tab, in words.
  const narrowed: string[] = [];
  if (severity !== "all" || areaKey !== "all") narrowed.push(`${severity === "all" ? "Issues" : SEVERITY[severity].plural}${areaKey !== "all" ? ` in ${catName(areaKey)}` : ""}`);
  // An issue this crawl does not have is never named by its raw key (a key is not words a visitor reads).
  if (issueParam) narrowed.push(openIssue ? `${openIssue.title} — its affected pages` : "An issue this crawl did not find");
  if (foreign) narrowed.push(foreign.words);
  const issueTitles = Object.fromEntries((a?.issues ?? []).map((i) => [i.key, i.title]));
  /** The crawl shown, by its date, as a link that keeps it in the address (as "Crawled <date>" does). */
  const shownLink = (testId: string) => a && <Link href={go({ at: a.jobId })} className={FIG} title="Keep this crawl in the address" data-testid={testId}>{fmtDate(shownDate)}</Link>;
  // Arrived by link while the crawl is still loading: the narrowing is said at once (in the address's words), so a link
  // never lands on a page that does not say what it was narrowed to; the tab's own chip takes over once it is read.
  const asked = (Object.keys(current) as Narrowing[]).filter((k) => current[k]);
  const askedSite = site?.id ?? (Number(P.get("site")) || null);

  return (
    <SeoShell
      title="Site audit" description="Crawls your site and lists what is broken, what to improve and how — with a health score you can watch improve." site={site} onSite={pickSite} sites={sites} status={status}
      actions={site && (
        <Button className="w-full sm:w-auto" disabled={!!running || start.isPending || !d} onClick={() => start.mutate()} data-testid="button-run-audit" title="Uses one of your plan's monthly Site Scans. Crawls up to 150 pages.">
          {running || start.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}
          {running ? "Crawling…" : a ? "Run new crawl" : "Run first crawl"}
        </Button>
      )}
    >
      {!site && sites.isSuccess && <Empty testId="audit-empty-sites"><h3>No sites yet</h3><p>Add your site above, then run a crawl to see its health score and issues.</p></Empty>}
      {askedSite && (site ? q.isLoading : sites.isLoading) && asked.length > 0 && <ActiveFilter words={`${asked.map((k) => wordOf(k, current[k]!)).join(", ")} (reading the crawl…)`} clearHref={seoLinks.audit(askedSite, { tab: view === "issues" ? undefined : view, at: at ?? undefined, vs: vs ?? undefined })} />}
      {site && q.isLoading && <p className="g-text-2 flex items-center gap-2 text-[14px]" role="status"><Loader2 className="h-4 w-4 animate-spin" /> Loading the audit…</p>}
      {site && q.isError && <div className="g-callout" role="alert" data-testid="audit-error"><h3>Couldn't load {at || vs ? "that crawl" : "the audit"}</h3><p>{apiErrorMessage(q.error)}{d ? " What is shown below is the crawl shown before." : ""}</p><div className="mt-2 flex flex-wrap gap-2"><button type="button" className="g-pill" onClick={() => void q.refetch()}>Try again</button>{(at || vs) && <Link href={seoLinks.audit(site.id, { tab: view === "issues" ? undefined : view })} className="g-pill max-sm:!min-h-11" data-testid="link-audit-newest-error">Show the newest crawl</Link>}</div></div>}
      {site && q.isPlaceholderData && <p className="g-text-2 mb-2 text-[13px]" role="status" data-testid="audit-switching"><Loader2 className="mr-1 inline h-4 w-4 animate-spin" />Loading the crawl you chose…</p>}
      {running && (
        <div className="g-callout mb-4" role="status" data-testid="audit-running">
          <h3 className="flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Crawling {site?.domain}</h3>
          {/* A running crawl has no pages to open yet: its figures are progress, not data, so they lead nowhere until it finishes. */}
          <p>{running.status === "queued" ? "Waiting to start." : `${fmtNum(running.crawled)} of up to ${fmtNum(running.pageCap)} pages checked so far.`} This page updates by itself.</p>
        </div>
      )}
      {d && !running && d.lastFailed && (
        <div className="g-callout mb-4" role="alert" data-testid="audit-failed">
          <h3>The last crawl didn't finish</h3>
          {/* A crawl that failed saved nothing to open; its date is a fact about the failure, not a crawl to show. */}
          <p>{crawlError(d.lastFailed.error)} Started {fmtDate(d.lastFailed.createdAt)}.{a ? " The results below are from the crawl before it." : ""}</p>
        </div>
      )}
      {site && d?.newestUnreadable && (
        <div className="g-callout mb-4" role="alert" data-testid="audit-unreadable">
          <h3>The newest crawl could not be read</h3>
          <p>The crawl that finished {fmtDate(d.newestUnreadable.at)} was not saved in a form we can read, so no score or issues are taken from it. Run a new crawl{d.crawls?.some((c) => c.readable !== false) ? ", or look at an earlier one" : ""}.</p>
          {a ? <p className="mt-1 text-[13px]">Shown below: the crawl of {shownLink("link-unreadable-shown")}, an earlier crawl you picked.</p>
            : (() => { const ok = d.crawls?.find((c) => c.readable !== false); return ok ? <Link href={seoLinks.audit(site.id, { at: ok.jobId })} className="g-pill mt-2 max-sm:!min-h-11" data-testid="button-audit-earlier">Show the crawl of {fmtDate(ok.at)}</Link> : null; })()}
        </div>
      )}
      {site && d && !a && !running && !d.newestUnreadable && (
        <Empty testId="audit-empty">
          <h3>No crawl of {site.domain} yet</h3>
          <p>A crawl reads up to 150 pages of the site the way a simple crawler does — the HTML as sent, without running JavaScript — and checks each for broken pages, redirects, missing titles and descriptions, thin content, slow pages, and whether robots rules or pages with little server-sent text would keep crawlers, Google's and the AI companies' included, from reading it. It is not Googlebot: what Google itself sees can differ.</p>
          <p className="mt-2">It uses one of your plan's monthly Site Scans and no SEO data credit.</p>
        </Empty>
      )}
      {/* The rendering check does not need a crawl: without one it is offered here, on its own. */}
      {site && d && !a && <div className="mt-6" data-testid="audit-rendering-alone"><RenderCheck site={site} pageParam={pageParam} resultParam={resultParam} here={(p) => go({ tab: "rendering", page: pageParam ?? undefined, result: resultParam ?? undefined, ...p })} /></div>}
      {/* Said whatever else is on the page, even with one crawl or none left. */}
      {site && d?.atMissing && <p className="mb-2 text-[13px]" role="alert" data-testid="audit-at-missing">That crawl is no longer available, so {a ? "the newest crawl is shown" : "there is no crawl to show"}.</p>}
      {site && d?.vsMissing && <p className="mb-2 text-[13px]" role="alert" data-testid="audit-vs-missing">That crawl can't be compared with (it is no longer available, or it is not older than the crawl shown){a?.comparedWith ? ", so the crawl before it is used" : a ? ", and there is no earlier crawl to compare with" : ""}.</p>}
      {/* Every finished crawl as a dated list — whatever is shown above, and however many have a score. Each line is a link to that crawl. */}
      {site && d && trend.length > 0 && (
        <details id="audit-trend-list" className="mb-3 text-[12px]" open={trendOpen} onToggle={(e) => setTrendOpen(e.currentTarget.open)} data-testid="audit-trend-list"><summary className={SUMMARY}>{(d.crawls?.length ?? 0) > trend.length ? `The latest ${trend.length} crawls (of ${d.crawls!.length}${d.crawls!.length >= 100 ? "+" : ""}), as a list` : `Every crawl (${trend.length}), as a list`}</summary>
          <ul className="g-text-2 mt-1 space-y-0.5">{trend.slice().reverse().map((h, i, all) => <li key={h.jobId}><Link href={go({ at: h.jobId, vs: undefined })} className={`g-text-2 ${FIG}`} title="Show this crawl" data-testid={`link-trend-crawl-${h.jobId}`}><span className="g-link">{fmtDate(h.at)}{all.filter((x) => fmtDate(x.at) === fmtDate(h.at)).length > 1 ? ` ${new Date(h.at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "UTC" })} UTC` : ""}</span>: {h.unreadable ? "could not be read" : h.health === null ? "no page could be scored" : `health ${h.health}, ${fmtNum(h.crawled)} pages`}</Link></li>)}</ul>
        </details>
      )}
      {site && a && (
        <>
          {/* One row, as Ahrefs lays a site audit out: the health ring, the pages crawled with their status bar, then errors,
              warnings and notices as columns with thin dividers. On a phone the ring and the crawl count take a full line
              each and the three severities share one. */}
          <section className="mb-4 rounded-xl border p-3 shadow-sm sm:p-5" style={card} data-testid="audit-overview">
            <div className="grid grid-cols-6 gap-x-3 gap-y-5 lg:grid-cols-7 lg:gap-y-0">
              <div className="col-span-6 flex min-w-0 items-center gap-3 lg:col-span-2" data-testid="audit-health">
                <Link href={go({})} className="shrink-0 rounded-full" title="Every issue this crawl found" data-testid="link-health"><HealthRing value={a.health} /></Link>
                <div className="min-w-0">
                  <h2 className="text-[13px] font-medium" style={heading}><Link href={go({})} className={FIG} data-testid="link-health-label">Health score</Link></h2>
                  <p className="g-text-2 text-[12px] leading-4">The share of crawled pages with no errors.</p>
                  {a.healthChange !== null && a.healthChange !== 0 && <p className="g-text-2 mt-1 text-[12px] leading-4 [&>span]:!ml-0"><Link href={`${go({ vs: cmp?.jobId ?? vs ?? undefined })}${changeHash}`} className={`${FIG} gap-1`} title={`What changed against ${before}: fixed, and not re-checked`} data-testid="link-health-change"><DeltaBadge value={a.healthChange} label={`${a.healthChange > 0 ? "Up" : "Down"} ${Math.abs(a.healthChange)} since ${before}`} /> since {before}</Link></p>}
                  <p className="g-text-2 mt-1 text-[12px] leading-4"><Link href={go({ at: a.jobId })} className={FIG} title="Keep this crawl in the address" data-testid="link-crawled-at">Crawled {fmtDate(shownDate)}</Link></p>
                </div>
              </div>
              <div className="col-span-6 min-w-0 lg:col-span-2 lg:border-l lg:pl-3" style={divider} data-testid="audit-crawled">
                {/* Laid out like viz's MetricColumn, with the audit's own figure links (a dotted underline that shows without hovering). */}
                <div className="flex min-w-0 flex-col">
                  <div className="text-[13px] font-medium" style={heading}><Link href={go({ tab: "pages" })} className={FIG} title="Every crawled page" data-testid="link-pages-crawled-label">Pages crawled</Link></div>
                  <div className="g-text text-[28px] leading-9 tabular-nums"><Link href={go({ tab: "pages" })} className={FIG_BIG} title="Every crawled page" data-testid="link-pages-crawled">{fmtNum(total)}</Link></div>
                  <div className="mt-0.5"><StatusBar parts={STATUS.filter((s) => s.key !== "unusual" || (a.statuses.unusual ?? 0) > 0).map((s) => ({ key: s.key, label: s.label, value: a.statuses[s.key] ?? 0, color: s.color, href: go({ tab: "pages", status: s.status }) }))} /></div>
                </div>
              </div>
              {/* The three severities are grid cells of the row above (display: contents), kept together for the tests. */}
              <div className="contents" data-testid="audit-totals">
                {(Object.keys(SEVERITY) as Severity[]).map((s, i) => (
                  <div key={s} className={`col-span-2 min-w-0 lg:col-span-1 lg:border-l lg:pl-3${i > 0 ? " border-l pl-3" : ""}`} style={divider}>
                    <SeverityColumn label={SEVERITY[s].plural} color={SEVERITY[s].color} value={fmtNum(a.totals[s].issues)} foot={`${fmtNum(a.totals[s].affected)} affected`}
                      pressed={view === "issues" && severity === s} href={go({ severity: view === "issues" && severity === s ? undefined : s, area: areaParam ?? undefined })} footHref={go({ tab: "pages", severity: s })} footTestId={`link-affected-${s}`} testId={`button-severity-${s}`} />
                  </div>
                ))}
              </div>
            </div>
            <div className="g-text-2 mt-3 space-y-0.5 text-[12px] leading-4">
              <p>Errors lower the health score. Warnings and notices are improvements.</p>
              {(a.statuses.excluded ?? 0) > 0 && <p><Link href={go({ tab: "pages", status: "excluded" })} className={FIG} title="What was found but not audited, and why there is no row for it" data-testid="link-excluded">{fmtNum(a.statuses.excluded)} more address{a.statuses.excluded === 1 ? " was" : "es were"} found but not audited</Link> (files such as PDFs, or links that leave the site). They don't affect the health score.</p>}
              {(a.notCrawled > 0 || a.blockedByRobots > 0) && <p>{a.notCrawled > 0 ? <><Link href={go({ tab: "pages", status: "beyond-limit" })} className={FIG} title="What was found but not crawled, and why there is no row for it" data-testid="link-not-crawled">{fmtNum(a.notCrawled)} more page{a.notCrawled === 1 ? " was" : "s were"} found but not crawled</Link> (the crawl stops at <Link href={go({ tab: "pages", status: "beyond-limit" })} className={FIG} title="The crawl's page limit, and what lay beyond it" data-testid="link-page-cap">{fmtNum(a.pageCap)}</Link>). </> : ""}{a.blockedByRobots > 0 ? <Link href={go({ tab: "pages", status: "blocked" })} className={FIG} title="What robots.txt kept the crawl from, and why there is no row for it" data-testid="link-blocked">{fmtNum(a.blockedByRobots)} blocked by robots.txt.</Link> : ""}</p>}
            </div>
          </section>

          {(scored.length > 1 || a.scores) && (
            <div className="mb-4 grid gap-4 lg:grid-cols-3">
              {scored.length > 1 && (
                <section className="rounded-xl border p-3 sm:p-4 lg:col-span-2" style={card} data-testid="audit-trend">
                  <h2 className="mb-1 text-[14px] font-medium" style={heading}>Health score over time</h2>
                  <p className="g-text-2 mb-1 text-[12px]">Health score: <Link href={go({ at: scored[0].jobId, vs: undefined })} className={`g-text-2 ${FIG}`} title="Show that crawl" data-testid="link-trend-first">{scored[0].health} on <span className="g-link">{fmtDate(scored[0].at)}</span></Link> → <Link href={go({ at: scored[scored.length - 1].jobId, vs: undefined })} className={`g-text-2 ${FIG}`} title="Show that crawl" data-testid="link-trend-last"><b className="g-text font-medium">{scored[scored.length - 1].health}</b>&nbsp;on <span className="g-link">{fmtDate(scored[scored.length - 1].at)}</span></Link></p>
                  <HealthTrend points={trend.map((h) => ({ key: h.jobId, label: fmtDate(h.at), value: h.health }))} onPick={(k) => navigate(go({ at: k, vs: undefined }))} />
                  {/* The chart's points as links under it, oldest first like the chart: the keyboard and touch way to the same crawls. */}
                  <ul className="flex flex-wrap gap-x-3 text-[12px]" data-testid="audit-trend-points">{trend.map((h) => <li key={h.jobId}><Link href={go({ at: h.jobId, vs: undefined })} className={`g-text-2 ${FIG}`} title="Show this crawl" data-testid={`link-trend-point-${h.jobId}`}>{fmtDate(h.at)}: <b className="g-text font-medium tabular-nums">{h.unreadable ? "not read" : h.health ?? "—"}</b></Link></li>)}</ul>
                  <p className="g-text-2 mt-1 text-[11px]">Every finished crawl, oldest first; a point opens that crawl (so do the dates under the chart, and its line in <Link href={`${here({})}#audit-trend-list`} className={`g-link ${FIG}`} data-testid="link-trend-list">the list above</Link>). A crawl with no score, or that could not be read, is a gap in the line.</p>
                </section>
              )}
              {a.scores && (
                <section className={`rounded-xl border p-3 sm:p-4 ${scored.length > 1 ? "" : "lg:col-span-3"}`} style={card} data-testid="audit-scores">
                  <h2 className="mb-2 text-[14px] font-medium" style={heading}>By area</h2>
                  <ul className="space-y-2 text-[13px]">
                    {Object.entries(a.scores.categories).map(([k, v]) => (
                      <li key={k}>
                        <div className="flex">
                          <Link href={go({ area: catName(k) })} className={`g-text ${FIG}`} title={`The issues in ${catName(k)}`} data-testid={`link-area-${k}`}>{catName(k)}</Link>
                          {v == null
                            ? <Link href={k === "performance" ? go({ tab: "rendering", area: "Performance" }) : go({ area: catName(k) })} className={`g-text ml-auto ${FIG} tabular-nums`} title={k === "performance" ? "Why speed was not measured, and what can be measured" : `What the crawl found in ${catName(k)}`} data-testid={`link-area-unmeasured-${k}`}>not measured</Link>
                            : <Link href={go({ area: catName(k) })} className={`g-text ml-auto ${FIG} tabular-nums`} title={`The issues in ${catName(k)}`} data-testid={`link-area-score-${k}`}>{v}</Link>}
                        </div>
                        <RatingBar value={v} />
                      </li>
                    ))}
                  </ul>
                  <p className="g-text-2 mt-2 text-[12px]">Our own 0–100 rating of each area. Not a Google ranking.</p>
                </section>
              )}
            </div>
          )}

          {(crawls.length > 1 || !!d?.newestUnreadable) && (
            <section id="audit-compare" className="mb-4 rounded-xl border p-3 sm:p-4" style={card} data-testid="audit-compare">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                <label className="flex min-w-0 max-w-full flex-wrap items-center gap-2"><span className="text-[14px] font-medium" style={heading}>Showing</span>
                  <select className="g-select min-w-0 max-w-full" value={a.latest === false ? a.jobId : ""} data-testid="select-audit-at"
                    onChange={(e) => choose({ at: e.target.value || null, vs: null })}>
                    {d?.newestUnreadable ? <><option value="">The newest crawl ({fmtDate(d.newestUnreadable.at)}, could not be read)</option>
                      {crawls.slice(1).map((c, i) => <option key={c.jobId} value={c.jobId} disabled={c.readable === false}>Crawl of {crawlWord(c, i + 1)}{c.readable === false ? " (could not be read)" : ""}</option>)}</>
                      : <><option value="">The newest crawl ({fmtDate(crawls[0].at)})</option>
                      {crawls.slice(1).map((c, i) => <option key={c.jobId} value={c.jobId} disabled={c.readable === false}>Crawl of {crawlWord(c, i + 1)}{c.readable === false ? " (could not be read)" : ""}</option>)}</>}
                  </select></label>
                {earlier.length > 0 && (
                  <label className="flex min-w-0 max-w-full flex-wrap items-center gap-2"><span className="text-[14px] font-medium" style={heading}>compared with</span>
                    <select className="g-select min-w-0 max-w-full" value={cmp?.chosen ? cmp.jobId : ""} data-testid="select-audit-vs"
                      onChange={(e) => choose({ at, vs: e.target.value || null })}>
                      <option value="">The crawl before it ({fmtDate(earlier[0].at)}{earlier[0].readable === false ? ", could not be read" : ""})</option>
                      {earlier.slice(1).map((c) => <option key={c.jobId} value={c.jobId} disabled={c.readable === false}>Crawl of {crawlWord(c, crawls.indexOf(c))}{c.readable === false ? " (could not be read)" : ""}</option>)}
                    </select></label>
                )}
                {q.isFetching && <Loader2 className="h-4 w-4 animate-spin" aria-label="Loading" />}
              </div>
              {crawls.length >= 100 && <p className="g-text-2 mt-1 text-[12px]">The newest 100 crawls are listed.</p>}
              {a.latest === false && <p className="mt-2 text-[13px]" role="note" data-testid="audit-older-note">You are looking at the crawl of {shownLink("link-older-shown")}, not the newest. Its issues, health and counts are shown; Pages, Internal links and Outgoing links read the newest crawl. <Link href={seoLinks.audit(site.id, { tab: view === "issues" ? undefined : view })} className={`g-link ${FIG}`} data-testid="link-audit-newest">Show the newest crawl</Link></p>}
              {!cmp && <p className="g-text-2 mt-2 text-[13px]" data-testid="audit-no-compare">{d?.previousUnreadable ? `The crawl just before (${fmtDate(d.previousUnreadable.at)}) could not be read, so no change is shown. Pick an earlier crawl above to compare with.` : "No earlier crawl to compare this one with."}</p>}
              {cmp && (
                <div className="mt-2 text-[13px]">
                  <p className="g-text-2">Every change, fixed issue and health move on this page is the crawl of {shownLink("link-compare-shown")} against {before}{cmp.chosen && cmp.at ? "" : cmp.at ? ` (${fmtDate(cmp.at)})` : ""}. <Link href={go({ at: cmp.jobId, vs: undefined })} className={`g-link ${FIG}`} title="Show the crawl compared with, on its own" data-testid="link-compared-crawl">Show that crawl</Link></p>
                  <p className="g-text mt-1" data-testid="text-audit-page-changes"><Link href={`${here({})}#audit-page-changes`} className={FIG} title="The pages, listed below" data-testid="link-pages-added">{fmtNum(cmp.addedPages)} page{cmp.addedPages === 1 ? "" : "s"}</Link> reached in the crawl of {shownLink("link-compare-shown-pages")} and not in {before}; <Link href={`${here({})}#audit-page-changes`} className={FIG} title="The pages, listed below" data-testid="link-pages-removed">{fmtNum(cmp.removedPages)}</Link> the other way round.</p>
                  {cmp.capsDiffer && <p className="g-text-2 mt-1 text-[12px]">The two crawls stopped at different page limits, so a page "not reached now" may only lie beyond the smaller limit.</p>}
                  {(cmp.addedPages > 0 || cmp.removedPages > 0) && (
                    <details id="audit-page-changes" className="mt-1" open={pagesOpen} onToggle={(e) => setPagesOpen(e.currentTarget.open)} data-testid="audit-page-changes">
                      <summary className={SUMMARY}>Show the pages</summary>
                      <div className="mt-2 grid gap-4 md:grid-cols-2">
                        {/* Each heading's dates are the two crawls: the one shown keeps itself in the address (`at`), the earlier one opens on its own. */}
                        {([["added", cmp.added, cmp.addedPages, true], ["removed", cmp.removed, cmp.removedPages, false]] as const).map(([t, list, n, now]) => { const thenLink = <Link href={go({ at: cmp.jobId, vs: undefined })} className={FIG} title="Show the crawl compared with, on its own" data-testid={`link-page-changes-then-${t}`}>{cmp.at ? `the crawl of ${fmtDate(cmp.at)}` : "the crawl before"}</Link>; return (
                          <div key={t}><h3 className="g-text font-medium">{now ? <>Reached on {shownLink(`link-page-changes-now-${t}`)}, not in {thenLink}</> : <>Reached in {thenLink}, not on {shownLink(`link-page-changes-now-${t}`)}</>}</h3>
                            {list.length === 0 ? <p className="g-text-2">None.</p> : <ul className="space-y-0.5">{list.map((u) => { const p = now ? ownPath(u, site.domain) : null; return <li key={u} className="flex items-center gap-2 truncate">{p ? <Link href={pageHref(p)} className={`g-link ${FIG} truncate`} title="Its row on the pages tab (the newest crawl)" data-testid={`link-page-change-${p}`}>{u}</Link> : <a href={u} className={`g-link ${FIG} truncate`} target="_blank" rel="noreferrer" title="This crawl has no row for it: the page as it is now, in a new tab">{u}</a>}<a href={u} className={`g-link ${FIG} min-w-11 shrink-0 text-center`} target="_blank" rel="noreferrer" aria-label={`Open ${u} in a new tab`}>↗</a></li>; })}</ul>}
                            {n > list.length && <p className="g-text-2 text-[12px]">The first <Link href={`${here({})}#audit-page-changes`} className={`g-text-2 ${FIG}`} title="Listed above" data-testid={`link-page-changes-listed-${now ? "added" : "removed"}`}>{fmtNum(list.length)}</Link> of {now ? <><Link href={go({ tab: "pages" })} className={`g-text-2 ${FIG}`} title="Every crawled page, on the pages tab (which of them are new is kept only for the pages listed)" data-testid="link-page-changes-total">{fmtNum(n)}</Link> — <Link href={go({ tab: "pages" })} className={`g-link ${FIG}`} data-testid="link-page-changes-more">every crawled page is on the pages tab</Link></> : <><Link href={go({ at: cmp.jobId, vs: undefined })} className={`g-text-2 ${FIG}`} title="The crawl compared with; the rest of this list was not kept" data-testid="link-page-changes-total-removed">{fmtNum(n)}</Link>; the rest were not kept</>}.</p>}
                          </div>); })}
                      </div>
                      <p className="g-text-2 mt-2 text-[12px]">"Not reached" means the crawl did not get to the page — it may still exist (a removed link, a robots rule or the page limit can each stop a crawl short of it).</p>
                    </details>
                  )}
                </div>
              )}
            </section>
          )}
          <nav className={TABS} aria-label="Audit views">
            {([["issues", `Issues (${a.issues.length})`], ["pages", `Pages (${a.crawled})`], ["links", "Internal links"], ["outgoing", "Outgoing links"], ["rendering", "Rendering"]] as const).map(([v, label]) => <Link key={v} href={go({ tab: v === "issues" ? undefined : v })} aria-current={view === v ? "page" : undefined} data-testid={`tab-audit-view-${v}`}>{label}</Link>)}
          </nav>
          {a.latest === false && (view === "pages" || view === "links" || view === "outgoing") && <p className="g-text-2 mb-2 text-[12px]" role="note">This view is the newest crawl (<Link href={seoLinks.audit(site.id, { tab: view })} className={FIG} title="Show the newest crawl" data-testid="link-view-newest">{fmtDate(crawls[0]?.at ?? null)}</Link>), not the crawl of {shownLink("link-view-shown")} shown above.</p>}
          {/* These read the newest crawl; keyed by it, so a crawl that finishes while one is open is read again at once. */}
          {view === "pages" && <AuditPages key={d?.latestKey ?? ""} crawlId={d?.latestKey} site={site} issueTitles={issueTitles} issueSeverity={Object.fromEntries(a.issues.map((i) => [i.key, i.severity]))} issueArea={Object.fromEntries(a.issues.map((i) => [i.key, { key: i.category, name: catName(i.category) }]))}
            overview={{ failed: a.statuses.failed, excluded: a.statuses.excluded ?? 0, notCrawled: a.notCrawled, blockedByRobots: a.blockedByRobots, pageCap: a.pageCap }} shownDate={shownDate}
            narrowing={{ status: statusParam, severity: severity === "all" ? null : severity, issue: issueParam, show: showParam, page: pageParam, area: areaParam }} here={here} issueHref={(k) => go({ issue: k })} foreign={foreign} more={moreRows} />}
          {view === "links" && site && <LinkOpportunitiesView key={d?.latestKey ?? ""} crawlId={d?.latestKey} site={site} pageHref={pageHref} pageParam={pageParam} here={here} go={go} foreign={foreign} all={showAll} />}
          {view === "outgoing" && site && <OutgoingLinksView key={d?.latestKey ?? ""} crawlId={d?.latestKey} site={site} pageHref={pageHref} pageParam={pageParam} here={here} go={go} foreign={foreign} all={showAll} />}
          {view === "rendering" && site && <RenderCheck site={site} pageHref={pageHref} pageParam={pageParam} resultParam={resultParam} here={here} go={go} explain={areaParam?.toLowerCase() === "performance"} foreign={foreign} />}
          {view === "issues" && (<>
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <nav className={`${TABS} !mb-0`} aria-label="Issue severity">
              {(["all", "error", "warning", "notice"] as const).map((s) => <Link key={s} href={here({ severity: s === "all" ? undefined : s })} aria-current={severity === s ? "page" : undefined} data-testid={`tab-audit-${s}`}>{s === "all" ? `All issues (${a.issues.length})` : `${SEVERITY[s].plural} (${a.totals[s].issues})`}</Link>)}
            </nav>
            <label className="ml-auto flex items-center gap-2 text-[13px]"><span className="g-text-2">Area</span>
              <select className="g-select" value={areaKey} onChange={(e) => navigate(here({ area: e.target.value === "all" ? undefined : catName(e.target.value) }))} data-testid="select-audit-category">
                <option value="all">All areas</option>
                {(categories.includes(areaKey) || areaKey === "all" ? categories : [...categories, areaKey]).map((c) => <option key={c} value={c}>{catName(c)}</option>)}
              </select>
            </label>
            <button type="button" className="g-pill g-pill--sm max-sm:!min-h-11" onClick={exportAll} data-testid="button-audit-export"><Download /> Export</button>
            <Link href={seoLinks.plan(site.id)} className="g-pill g-pill--sm max-sm:!min-h-11" data-testid="link-audit-fixplan">Step-by-step fix plan</Link>
          </div>
          {narrowed.length > 0 && <ActiveFilter words={narrowed.join(" · ")} clearHref={go({})} extra={foreign ? { href: foreign.href, label: foreign.label, testId: "link-foreign-tab" } : undefined}>{issueParam && !openIssue ? `Nothing is listed under that issue in the crawl of ${fmtDate(shownDate)}. It may have been fixed, or found by another crawl.` : null}</ActiveFilter>}
          {issues.length === 0 ? (
            <Empty testId="audit-no-issues"><h3>{a.issues.length ? "No issues match these filters" : "No issues found"}</h3><p>{a.issues.length ? "Choose a different severity or area." : "The crawl didn't find anything to fix on the pages it checked."}</p></Empty>
          ) : (
            <div className="overflow-x-auto">
            <table className={COMPACT_TABLE} data-testid="table-audit-issues">
              <thead><tr><th aria-label="Show details" className="w-12" /><th>Issue</th><th>Area</th><th className="num">Affected</th><th className="num whitespace-nowrap pr-2" title={`Change in affected pages since ${before}`}>Change</th></tr></thead>
              <tbody>
                {issues.map((i) => {
                  const isOpen = issueParam === i.key, shown = isOpen && !showAll ? i.items.slice(0, 25) : i.items;
                  return (
                    <Fragment key={i.key}>
                      <tr data-testid={`row-issue-${i.key}`} ref={isOpen ? openRef : undefined} style={isOpen ? HIGHLIGHT : undefined}>
                        <td><Link href={here({ issue: isOpen ? undefined : i.key })} className={CHEVRON} aria-expanded={isOpen} aria-label={`${isOpen ? "Hide" : "Show"} details for ${i.title}`} data-testid={`button-issue-${i.key}`}>{isOpen ? <ChevronDown /> : <ChevronRight />}</Link></td>
                        <td><span className="mr-2 inline-block h-2 w-2 rounded-full align-middle" style={{ background: SEVERITY[i.severity].color }} aria-hidden /><span className="sr-only">{SEVERITY[i.severity].label}: </span><Link href={here({ issue: isOpen ? undefined : i.key })} className={`g-text ${FIG}`} title={isOpen ? "Hide its affected pages" : "Show its affected pages"} data-testid={`link-issue-${i.key}`}>{i.title}</Link></td>
                        <td data-label="Area" className="g-text-2"><Link href={here({ area: catName(i.category) })} className={FIG} title={`Only the issues in ${catName(i.category)}`} data-testid={`link-issue-area-${i.key}`}>{catName(i.category)}</Link></td>
                        <td className="num" data-label="Affected"><Link href={go({ tab: "pages", issue: i.key })} className={FIG} title="The crawled pages listed under this issue" data-testid={`link-issue-affected-${i.key}`}>{fmtNum(i.count)}</Link></td>
                        <td className="num pr-2" data-label={`Change since ${before}`}>{cmp ? <Link href={here({ issue: i.key, vs: cmp.jobId })} className={FIG} title={`This issue, against ${before}`} data-testid={`link-issue-change-${i.key}`}><Change issue={i} before={before} /></Link> : <Change issue={i} before={before} />}</td>
                      </tr>
                      {isOpen && (
                        <tr id={`detail-issue-${i.key}`} data-testid={`detail-issue-${i.key}`}>
                          <td />
                          <td colSpan={4} className={DETAIL_CELL}>
                            {i.why && <p className="g-text text-[13px]"><b className="font-medium">Why it matters:</b> {i.why}</p>}
                            {i.fix && <p className="g-text mt-1 text-[13px]"><b className="font-medium">How to fix:</b> {i.fix}</p>}
                            <ul className="mt-2 space-y-0.5 text-[13px]">
                              {shown.map((u) => { const p = /^https?:\/\//.test(u) ? ownPath(u, site.domain) : null; return <li key={u} className="flex items-center gap-2 truncate">{p ? <><Link href={pageHref(p)} className={`g-link ${FIG} truncate`} title="Its row on the pages tab (the newest crawl)" data-testid={`link-issue-page-${i.key}`}>{u}</Link><a href={u} className={`g-link ${FIG} min-w-11 shrink-0 text-center`} target="_blank" rel="noreferrer" aria-label={`Open ${u} in a new tab`}>↗</a></> : /^https?:\/\//.test(u) ? <a href={u} className={`g-link ${FIG} truncate`} target="_blank" rel="noreferrer">{u}</a> : <span className="g-text truncate">{u}</span>}</li>; })}
                            </ul>
                            <div className="mt-2 flex flex-wrap items-center gap-2">
                              {i.items.length > 25 && <Link href={here({ all: showAll ? undefined : true })} className={PILL} aria-expanded={showAll} data-testid={`link-issue-all-${i.key}`}>{showAll ? "Show the first 25" : <>Show all {fmtNum(i.items.length)}</>}</Link>}
                              {i.count > i.items.length && <span className="g-text-2 text-[12px]">Showing the first <Link href={`${here({})}#detail-issue-${i.key}`} className={`g-text-2 ${FIG}`} title="Listed above" data-testid={`link-issue-listed-${i.key}`}>{fmtNum(i.items.length)}</Link> of <Link href={go({ tab: "pages", issue: i.key })} className={`g-text-2 ${FIG}`} title="The crawled pages listed under this issue" data-testid={`link-issue-count-${i.key}`}>{fmtNum(i.count)}</Link>.</span>}
                              <button type="button" className="g-pill g-pill--sm max-sm:!min-h-11" onClick={() => downloadCsv(`${i.key}-${site.domain}.csv`, [["Issue", "Page or entry"], ...i.items.map((u) => [i.title, u])])}><Download /> Export this list</button>
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
            <section id="audit-not-rechecked" className="mt-6" data-testid="audit-not-rechecked">
              <h2 className="mb-2 text-[14px] font-medium" style={heading}>Not re-checked this time</h2>
              <p className="g-text-2 mb-2 text-[13px]">{before.charAt(0).toUpperCase() + before.slice(1)} found these, and this crawl could not check them the same way — it didn't look at the same pages (or read no pages at all), a page didn't answer normally this time (an error or a redirect), didn't measure speed on them again, only sampled the pages for that check, or had no Google profile to compare with. So they are not counted as fixed.</p>
              <ul className="g-text-2 space-y-1 text-[13px]">
                {a.notRechecked!.map((f) => <li key={f.key}>{cmp ? <Link href={seoLinks.audit(site.id, { at: cmp.jobId, issue: f.key })} className={`g-link ${FIG}`} title={`This issue as ${before} found it`} data-testid={`link-not-rechecked-${f.key}`}>{f.title} <span className="g-text-2 tabular-nums">({fmtNum(f.previous)} before)</span></Link> : <Link href={`${go({})}#audit-compare`} className={`g-link ${FIG}`} title="The comparison these come from" data-testid={`link-not-rechecked-${f.key}`}>{f.title} <span className="g-text-2 tabular-nums">({fmtNum(f.previous)} before)</span></Link>}</li>)}
              </ul>
            </section>
          )}
          {a.fixed.length > 0 && (
            <section id="audit-fixed" className="mt-6" data-testid="audit-fixed">
              <h2 className="mb-2 text-[14px] font-medium" style={heading}>Fixed since {before}</h2>
              <ul className="g-text-2 space-y-1 text-[13px]">
                {a.fixed.map((f) => <li key={f.key}><span className="g-move g-move--up">✓</span> {cmp ? <Link href={seoLinks.audit(site.id, { at: cmp.jobId, issue: f.key })} className={`g-link ${FIG}`} title={`This issue as ${before} found it`} data-testid={`link-fixed-${f.key}`}>{f.title} <span className="g-text-2 tabular-nums">({fmtNum(f.previous)} before)</span></Link> : <Link href={`${go({})}#audit-compare`} className={`g-link ${FIG}`} title="The comparison these come from" data-testid={`link-fixed-${f.key}`}>{f.title} <span className="g-text-2 tabular-nums">({fmtNum(f.previous)} before)</span></Link>}</li>)}
              </ul>
            </section>
          )}
          </>)}
        </>
      )}
    </SeoShell>
  );
}
