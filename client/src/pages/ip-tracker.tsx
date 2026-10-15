/**
 * /ip-tracker — visitor tracking for the sites added here (the one tracked-site list behind Click Guard, IP Tracker
 * and VPN Shield). Sections: Dashboard · Visitors · Traffic · Pages · Geo · Platforms, each its own address.
 *
 * Owner's program (2026-10-15): an "i" on every section (the help key per tab, below), a sample preview wherever
 * the real dataset is empty (components/traffic-tool/samples.tsx — never mixed with real rows), the SEO Suite's
 * dashboard look (a summary strip and one panel per site), and a typed value on every preset filter.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useLocation, useSearch } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useMutation, type UseQueryResult } from "@tanstack/react-query";
import { apiErrorMessage, apiRequest, getQueryFn, queryClient } from "@/lib/queryClient";
import { useAppOrigin } from "@/lib/app-origin";
import { AppPage, Section, StatusPill, Notice } from "@/components/app-ui";
import { GEO_SOURCE_NOTE } from "@/components/ip-tracker/country-names";
import { GoogleSectionHeader, GooglePill } from "@/components/google";
import { ToolTabs } from "@/components/tool";
import { ToolBarSlot } from "@/components/tool/shell";
import { useInToolShell } from "@/components/tool/in-shell";
import { useToolView } from "@/hooks/use-tool-view";
import { IP_TRACKER_VIEWS } from "@/components/traffic-tool/nav";
import { ALL_TIME, RangePicker, StepsCard, WindowPicker, daysAgo, inRange, localDayKey, rangeBounds, rangeKey, rangeQuery, type DateRange } from "@/components/traffic-tool/shared";
import { DailyVisitsChart, PagesTable, PlatformBreakdowns, GeoTable, SitePanel, SitesSummaryStrip, SourcesTable, StatTiles, VISIT_ROW_CAP, VisitorDetailPanel, VisitorRow, countLabel, type Analytics, type DomainWithStats, type GeoData, type OnlineFigure, type PageStat, type PlatformData, type Visitor, type VisitorDetail } from "@/components/traffic-tool/ip-views";
import { lazySample } from "@/components/sample-preview";
const IpSample = lazySample(() => import("@/components/traffic-tool/samples"), "IpSample");
import { Search, Plus, Copy, Trash2, MoreHorizontal, Code2 } from "lucide-react";

// The icon pickers live with the shared pieces now; the UI tests import them from here.
export { browserIcon, osIcon, deviceIcon } from "@/components/traffic-tool/shared";

/** Each section: its label, its line in the full-screen tool, and the help entry its "i" opens (shared/help/registry.ts). */
const tabs = [
  { id: "dashboard", label: "Dashboard", helpKey: "ip-tracker", line: "Visits, visitors and where they came from on the chosen site, updated live." },
  { id: "visitors", label: "Visitors", helpKey: "ip-tracker.visitors", line: "Every visitor with their IP address, location, device and the pages they opened." },
  { id: "traffic", label: "Traffic", helpKey: "ip-tracker.traffic", line: "Where visits come from: search, ads, social and other sites." },
  { id: "pages", label: "Pages", helpKey: "ip-tracker.pages", line: "The pages people land on and open the most." },
  { id: "geo", label: "Geo", helpKey: "ip-tracker.geo", line: "Where your visitors are, by country and city." },
  { id: "platforms", label: "Platforms", helpKey: "ip-tracker.platforms", line: "Browsers, operating systems, devices and screen sizes." },
] as const;
type TabId = typeof tabs[number]["id"];

/** Tab and site live in the query string (?site=10) so a reload or shared link keeps them. */
function useUrlState() {
  const search = useSearch();
  const [path, navigate] = useLocation();
  const set = (key: string, value: string | null) => {
    // Read the live query string so two updates in one handler both land.
    const next = new URLSearchParams(window.location.search);
    if (value === null) next.delete(key); else next.set(key, value);
    const qs = next.toString();
    navigate(qs ? `${path}?${qs}` : path, { replace: true });
  };
  return { params: new URLSearchParams(search), set };
}

/** Local midnight that covers both the 14-day chart and "This Month". */
function dashboardSince(now = new Date()) {
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const chartStart = daysAgo(now, 13);
  return monthStart < chartStart ? monthStart : chartStart;
}

/**
 * The server buckets days in UTC; regroup its UTC hour buckets ("2026-09-29T23") by the viewer's local day so
 * "Today" rolls over at local midnight. Exact for whole-hour offsets; half-hour zones can shift up to 30 minutes
 * of visits across midnight.
 */
function localDailyVisits(hourly: Record<string, number> | undefined) {
  const daily: Record<string, number> = {};
  for (const [hour, count] of Object.entries(hourly || {})) {
    const at = new Date(`${hour}:00:00Z`);
    if (Number.isNaN(at.getTime())) continue;
    const key = localDayKey(at);
    daily[key] = (daily[key] || 0) + count;
  }
  return daily;
}

/** The range line for views that load every recorded visit (no start date), capped at VISIT_ROW_CAP. */
function allTimeRange(visits: number | undefined, range: DateRange) {
  if (range.preset !== "all") return `Visits from ${rangeBounds(range).label.toLowerCase()}${(visits ?? 0) >= VISIT_ROW_CAP ? ` (latest ${VISIT_ROW_CAP.toLocaleString()} loaded)` : ""}.`;
  if (visits === undefined) return "All recorded visits.";
  return visits >= VISIT_ROW_CAP ? `Latest ${VISIT_ROW_CAP.toLocaleString()} recorded visits (all time).` : "All recorded visits (all time).";
}

// Visible activity panels re-check on this cadence so "Online now" and the visitor list stay live while the page
// is open (queries otherwise never refresh on their own).
const ONLINE_REFETCH_MS = 15000;
const ANALYTICS_REFETCH_MS = 30000;

type StatusQuery = { isError: boolean; dataUpdatedAt: number };

/**
 * One "Updated …" line for everything a view shows. With several queries it names the oldest successful load
 * (every figure is at least that fresh) and says so when any refresh failed.
 */
function MetricStatus({ queries, testId }: { queries: StatusQuery[]; testId?: string }) {
  const loaded = queries.filter((q) => q.dataUpdatedAt);
  const failed = queries.some((q) => q.isError);
  const at = loaded.length ? Math.min(...loaded.map((q) => q.dataUpdatedAt)) : 0;
  return <p className="text-xs text-muted-foreground" role="status" data-testid={testId}>
    {at ? `${failed ? "Refresh failed — showing saved data from" : "Updated"} ${new Date(at).toLocaleString()}` : failed ? "Unavailable" : "Loading…"}
  </p>;
}

const Spinner = ({ py = "py-12" }: { py?: string }) => <div className={`flex justify-center ${py}`}><div className="animate-spin h-6 w-6 border-2 border-primary border-t-transparent rounded-full" /></div>;

/** The pill that stands in for real data in a sample: it opens the Dashboard, where the tracking code is. */
function InstallCta({ onOpen }: { onOpen?: () => void }) {
  if (!onOpen) return null;
  return <GooglePill size="sm" variant="solid" icon={Code2} label="Get the tracking code" onClick={onOpen} testId="button-sample-install" />;
}

function InstallCard({ domain }: { domain: DomainWithStats }) {
  const appOrigin = useAppOrigin();
  const { toast } = useToast();
  const noVisits = domain.stats.totalVisits === 0;
  // Open while waiting for the first visit; once visits arrive the panel steps aside on its own unless the
  // viewer explicitly opened or closed it.
  const [openOverride, setOpenOverride] = useState<boolean | null>(null);
  const open = openOverride ?? noVisits;
  const snippet = `<script src="${appOrigin}/api/click-guard/script/${domain.trackingId}" async></script>`;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(snippet);
      toast({ title: "Tracking code copied", description: "Paste it into your site's <head> or just before </body>." });
    } catch {
      toast({ title: "Could not copy", description: "Select the code and copy it manually.", variant: "destructive" });
    }
  };
  return (
    <div className="rounded-xl border bg-card text-card-foreground" data-testid="card-install-tracking" id="install-tracking">
      <div className="space-y-3 p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="g-card__title g-card__title--md">Tracking code for {domain.domain}</h3>
            <p className="mt-0.5 text-xs text-muted-foreground" data-testid="text-install-status">
              {noVisits ? "No visits recorded yet. Visits appear here only after this code runs on your site." : `${countLabel(domain.stats.totalVisits, domain.stats.totalVisits >= VISIT_ROW_CAP)} visit${domain.stats.totalVisits !== 1 ? "s" : ""} recorded so far.`}
            </p>
          </div>
          {!noVisits && <Button size="sm" variant="ghost" className="text-xs" onClick={() => setOpenOverride((o) => !(o ?? noVisits))} data-testid="button-toggle-install">{open ? "Hide code" : "Show code"}</Button>}
        </div>
        {open && (
          <>
            {noVisits && <StepsCard testId="steps-install" steps={[
              "Copy the tag below.",
              <>Paste it into the <code className="rounded bg-muted px-1 py-0.5">&lt;head&gt;</code> (or before <code className="rounded bg-muted px-1 py-0.5">&lt;/body&gt;</code>) of every page you want to track.</>,
              "Open your site once: the visit shows up here within about 30 seconds.",
            ]} />}
            <div className="relative">
              <pre className="overflow-x-auto whitespace-pre-wrap break-all rounded-md bg-muted p-3 pr-12 font-mono text-xs" data-testid="text-tracking-snippet">{snippet}</pre>
              <Button size="icon" variant="ghost" className="!absolute top-1.5 right-1.5" onClick={copy} aria-label="Copy tracking code" data-testid="button-copy-tracking-snippet"><Copy className="h-4 w-4" /></Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/** A site's panel on the dashboard, with its own live "online now" count (distinct IPs in the last 20 minutes). */
function LiveSitePanel({ d, selected, onPick, onRemove, onOnline }: { d: DomainWithStats; selected: boolean; onPick: () => void; onRemove?: () => void; onOnline: (id: number, f: OnlineFigure) => void }) {
  const q = useQuery<{ count: number }>({ queryKey: ["/api/click-guard/domains", d.id, "online"], refetchInterval: ONLINE_REFETCH_MS });
  const figure: OnlineFigure = { count: q.data?.count ?? null, note: q.isError ? "Unavailable" : "Still counting" };
  useEffect(() => { onOnline(d.id, figure); }, [d.id, figure.count, figure.note]); // eslint-disable-line react-hooks/exhaustive-deps
  return <SitePanel d={d} online={figure} selected={selected} onPick={onPick} onRemove={onRemove} />;
}

export function DashboardView({ domainId, analyticsQuery, domains, domainsQuery, onPickSite, onRemoveSite }: {
  domainId: number | null;
  analyticsQuery: UseQueryResult<Analytics, Error>;
  domains: DomainWithStats[];
  /** The site list behind the per-site panels; its refresh state joins the one status line. */
  domainsQuery?: StatusQuery;
  onPickSite?: (id: number) => void;
  onRemoveSite?: (id: number) => void;
}) {
  const analytics = analyticsQuery.data;
  const online = useQuery<{ count: number; visitors: unknown[] }>({ queryKey: ["/api/click-guard/domains", domainId, "online"], enabled: !!domainId, refetchInterval: ONLINE_REFETCH_MS });
  const domain = domains.find((d) => d.id === domainId);
  const [onlineBySite, setOnlineBySite] = useState<Record<number, OnlineFigure>>({});
  const noteOnline = (id: number, f: OnlineFigure) => setOnlineBySite((m) => (m[id]?.count === f.count && m[id]?.note === f.note ? m : { ...m, [id]: f }));

  const now = new Date();
  const daily = localDailyVisits(analytics?.hourlyVisits);
  const chartDays = Array.from({ length: 14 }, (_, i) => { const key = localDayKey(daysAgo(now, 13 - i)); return [key, daily[key] || 0] as const; });
  const todayVisits = daily[localDayKey(now)] || 0;
  const yesterdayVisits = daily[localDayKey(daysAgo(now, 1))] || 0;
  const last7 = chartDays.slice(-7).reduce((s, [, v]) => s + v, 0);
  const monthPrefix = localDayKey(now).slice(0, 7);
  const thisMonth = Object.entries(daily).filter(([k]) => k.startsWith(monthPrefix)).reduce((s, [, v]) => s + v, 0);
  // At the cap the oldest visits in the range were not loaded: the oldest loaded day is partial and earlier days
  // are unknown, not zero.
  const oldestLoaded = (analytics?.totalVisits ?? 0) >= VISIT_ROW_CAP ? Object.keys(daily).sort()[0] : undefined;
  const partialFrom = (firstDay: string) => !!oldestLoaded && firstDay <= oldestLoaded;
  const totalVisits = domain?.stats.totalVisits ?? 0;
  // "…" only while a figure is still loading; a failed load says so; a site with no visits yet gets the sample below.
  const fig = (n: number, partial: boolean) => analytics ? countLabel(n, partial) : analyticsQuery.isError ? "Unavailable" : "…";
  const noVisits = !!domain && totalVisits === 0 && !!analytics && analytics.totalVisits === 0;
  const scrollToInstall = () => document.getElementById("install-tracking")?.scrollIntoView({ behavior: "smooth", block: "start" });

  return (
    <div className="space-y-4 sm:space-y-5">
      {domain && <InstallCard key={domain.id} domain={domain} />}

      {domainId && (
        <div className="flex flex-wrap items-center justify-between gap-2" data-testid="strip-dashboard-status">
          <MetricStatus queries={[analyticsQuery, online, ...(domainsQuery ? [domainsQuery] : [])]} testId="text-dashboard-updated" />
          <Button size="sm" variant="outline" className="h-7 text-xs" disabled={online.isFetching || analyticsQuery.isFetching} onClick={() => { void online.refetch(); void analyticsQuery.refetch(); }} data-testid="button-refresh-dashboard">Refresh</Button>
        </div>
      )}

      {analyticsQuery.isError && !analytics && (
        <Notice tone="danger" title="Couldn't load dashboard data" testId="notice-dashboard-error" action={<Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => void analyticsQuery.refetch()} data-testid="button-retry-dashboard">Retry</Button>}>
          {apiErrorMessage(analyticsQuery.error, "The visit summary could not be loaded.")} Figures below would be zeros, not real data.
        </Notice>
      )}

      {!online.isError && online.data && online.data.count > 0 && (
        <div className="flex items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 dark:border-emerald-900/60 dark:bg-emerald-950/30" data-testid="banner-online">
          <div className="h-2.5 w-2.5 rounded-full bg-emerald-500 animate-pulse" />
          <span className="text-sm font-medium text-emerald-700 dark:text-emerald-300">{online.data.count} ongoing visit{online.data.count > 1 ? "s" : ""} right now</span>
        </div>
      )}

      <StatTiles tiles={[
        { label: "Online now", value: online.data?.count ?? (online.isError ? "Unavailable" : "…"), hint: "Last 20 minutes", testId: "card-stat-online-now" },
        { label: "Today", value: fig(todayVisits, partialFrom(localDayKey(now))), testId: "card-stat-today" },
        { label: "Yesterday", value: fig(yesterdayVisits, partialFrom(localDayKey(daysAgo(now, 1)))), testId: "card-stat-yesterday" },
        { label: "Last 7 days", value: fig(last7, partialFrom(chartDays[7][0])), testId: "card-stat-last-7-days" },
        { label: "This month", value: fig(thisMonth, partialFrom(`${monthPrefix}-01`)), testId: "card-stat-this-month" },
        { label: "Total", value: domain ? countLabel(totalVisits, totalVisits >= VISIT_ROW_CAP) : "…", hint: "All time", testId: "card-stat-total" },
      ]} />

      {oldestLoaded && (
        <p className="text-xs text-muted-foreground" data-testid="text-visits-capped">
          Only the latest {VISIT_ROW_CAP.toLocaleString()} visits in this period are loaded, so counts marked + are lower bounds and days before {new Date(`${oldestLoaded}T00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" })} are not loaded.
        </p>
      )}

      {chartDays.some(([, v]) => v > 0) && <DailyVisitsChart days={chartDays} oldestLoaded={oldestLoaded} />}
      {/* No visit yet on this site: the chart as it will look, clearly marked, until the first real visit replaces it. */}
      {noVisits && <IpSample tab="dashboard" tiles={false} what="the daily chart you'll see once this site sends its first visit" cta={<InstallCta onOpen={scrollToInstall} />} />}

      {domains.length > 0 && (
        <div className="space-y-4" data-testid="ip-sites">
          <div className="g-header g-header--flush">
            <h2 className="g-header__title">All sites<span className="g-header__count">{domains.length}</span></h2>
            <p className="g-header__sub">Every site you track, with its live figures. Each figure opens its section.</p>
          </div>
          {domains.length > 1 && <SitesSummaryStrip domains={domains} online={onlineBySite} />}
          {domains.map((d) => <LiveSitePanel key={d.id} d={d} selected={d.id === domainId} onPick={() => onPickSite?.(d.id)} onRemove={onRemoveSite ? () => onRemoveSite(d.id) : undefined} onOnline={noteOnline} />)}
        </div>
      )}
    </div>
  );
}

function VisitorListView({ domainId, onInstall }: { domainId: number | null; onInstall?: () => void }) {
  const [ipSearch, setIpSearch] = useState("");
  const [range, setRange] = useState<DateRange>(ALL_TIME);
  const [withinMin, setWithinMin] = useState(0);
  const [expandedIp, setExpandedIp] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const perPage = 20;

  const visitorsQuery = useQuery<Visitor[]>({
    queryKey: ["/api/click-guard/domains", domainId, "visitors", rangeKey(range)],
    queryFn: async () => (await apiRequest("GET", `/api/click-guard/domains/${domainId}/visitors${rangeQuery(range)}`)).json(),
    enabled: !!domainId,
    refetchInterval: ONLINE_REFETCH_MS,
  });
  const visitors = visitorsQuery.data;
  const visitorsError = visitorsQuery.isError && !visitors;
  const detailQuery = useQuery<VisitorDetail>({ queryKey: ["/api/click-guard/domains", domainId, "visitors", expandedIp], enabled: !!domainId && !!expandedIp });

  const now = Date.now();
  const filtered = (visitors || []).filter((v) => v.ipAddress.includes(ipSearch) && (!withinMin || now - new Date(v.lastVisit).getTime() <= withinMin * 60_000));
  const totalPages = Math.ceil(filtered.length / perPage);
  // Results can shrink below the current page (visits deleted, search narrowed): stay on a real page.
  const safePage = Math.min(page, Math.max(totalPages, 1));
  const paginated = filtered.slice((safePage - 1) * perPage, safePage * perPage);
  const narrowed = !!ipSearch || withinMin > 0 || range.preset !== "all";
  const nothingYet = !!visitors && visitors.length === 0 && !narrowed;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="g-search min-w-0 flex-1 max-w-sm" role="search">
          <Search aria-hidden="true" />
          <input type="search" placeholder="Search by IP address…" aria-label="Search by IP address" value={ipSearch} onChange={(e) => { setIpSearch(e.target.value); setPage(1); }} data-testid="input-ip-search" />
        </div>
        <span className="text-sm tabular-nums text-muted-foreground" data-testid="badge-visitor-count">{filtered.length} visitor{filtered.length !== 1 ? "s" : ""}{filtered.length ? ` · ${filtered.filter((v) => v.isOnline).length} online` : ""}</span>
      </div>
      <RangePicker value={range} onChange={(r) => { setRange(r); setPage(1); }} testId="visitors-range" />
      <WindowPicker minutes={withinMin} onChange={(m) => { setWithinMin(m); setPage(1); }} testId="visitors-window" />

      {visitorsQuery.isLoading ? <Spinner /> : visitorsError ? (
        <Notice tone="danger" title="Couldn't load visitors" testId="notice-visitors-error" action={<Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => void visitorsQuery.refetch()} data-testid="button-retry-visitors">Retry</Button>}>
          {apiErrorMessage(visitorsQuery.error, "The visitor list could not be loaded.")} This is a failed request, not an empty site.
        </Notice>
      ) : nothingYet ? (
        <IpSample tab="visitors" cta={<InstallCta onOpen={onInstall} />} />
      ) : paginated.length === 0 ? (
        <div className="g-callout text-center" data-testid="text-no-visitors"><p>No visitors match this search and range.</p></div>
      ) : (
        <div className="space-y-2">
          {paginated.map((v) => (
            <VisitorRow key={v.ipAddress} v={v} expanded={expandedIp === v.ipAddress} onToggle={() => setExpandedIp(expandedIp === v.ipAddress ? null : v.ipAddress)}>
              {detailQuery.isLoading ? <Spinner py="py-8" /> : detailQuery.isError || !detailQuery.data ? (
                <div className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span className="text-sm text-destructive" role="alert" data-testid={`text-visitor-detail-error-${v.ipAddress}`}>{apiErrorMessage(detailQuery.error, "Couldn't load this visitor's details.")}</span>
                  <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => void detailQuery.refetch()} data-testid={`button-retry-visitor-${v.ipAddress}`}>Retry</Button>
                </div>
              ) : <VisitorDetailPanel d={detailQuery.data} />}
            </VisitorRow>
          ))}
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
          <span className="text-xs text-muted-foreground">Showing {(safePage - 1) * perPage + 1}-{Math.min(safePage * perPage, filtered.length)} of {filtered.length}</span>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" disabled={safePage <= 1} onClick={() => setPage(safePage - 1)} data-testid="button-prev-page">Prev</Button>
            <span className="text-sm tabular-nums text-muted-foreground">Page {safePage} / {totalPages}</span>
            <Button variant="outline" size="sm" disabled={safePage >= totalPages} onClick={() => setPage(safePage + 1)} data-testid="button-next-page">Next</Button>
          </div>
        </div>
      )}
    </div>
  );
}

export function TrafficSourcesView({ analyticsQuery, since, picker, rangeLabel, onInstall }: {
  analyticsQuery: UseQueryResult<Analytics, Error>;
  since: Date;
  /** The range control, when the page offers one (presets + typed dates). */
  picker?: ReactNode;
  rangeLabel?: string;
  onInstall?: () => void;
}) {
  const analytics = analyticsQuery.data;
  const sources = analytics?.trafficSources || [];
  const totalLoads = sources.reduce((s, t) => s + t.pageLoads, 0);
  const totalVisitors = sources.reduce((s, t) => s + t.visitors, 0);
  const sinceHint = rangeLabel ?? `Since ${since.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;
  const fig = (n: number) => analytics ? n.toLocaleString() : analyticsQuery.isError ? "Unavailable" : "…";
  return (
    <div className="space-y-4">
      {picker}
      {analyticsQuery.isError && !analytics && (
        <Notice tone="danger" title="Couldn't load traffic sources" testId="notice-traffic-error" action={<Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => void analyticsQuery.refetch()} data-testid="button-retry-traffic">Retry</Button>}>
          {apiErrorMessage(analyticsQuery.error, "The traffic summary could not be loaded.")}
        </Notice>
      )}
      <p className="text-xs text-muted-foreground" data-testid="text-traffic-range">
        {(analytics?.totalVisits ?? 0) >= VISIT_ROW_CAP ? `Latest ${VISIT_ROW_CAP.toLocaleString()} visits` : "Visits"} {rangeLabel ? `— ${rangeLabel.toLowerCase()}` : `since ${since.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`}.
      </p>
      <StatTiles tiles={[
        { label: "Total sources", value: fig(sources.length), hint: sinceHint, testId: "card-stat-total-sources" },
        { label: "Total page loads", value: fig(totalLoads), hint: sinceHint, testId: "card-stat-total-page-loads" },
        { label: "Unique visitors", value: fig(totalVisitors), hint: sinceHint, testId: "card-stat-unique-visitors" },
      ]} />
      <MetricStatus queries={[analyticsQuery]} />
      {analytics && sources.length === 0
        ? <IpSample tab="traffic" tiles={false} cta={<InstallCta onOpen={onInstall} />} what={analytics.totalVisits === 0 ? "the sources table you'll see once this site sends its first visit" : "the sources table — no visit in this range yet"} />
        : <SourcesTable sources={sources} />}
    </div>
  );
}

export function PagesView({ domainId, onInstall }: { domainId: number | null; onInstall?: () => void }) {
  const [range, setRange] = useState<DateRange>(ALL_TIME);
  const pagesQuery = useQuery<PageStat[]>({
    queryKey: ["/api/click-guard/domains", domainId, "pages", rangeKey(range)],
    queryFn: async () => (await apiRequest("GET", `/api/click-guard/domains/${domainId}/pages${rangeQuery(range)}`)).json(),
    enabled: !!domainId,
    refetchInterval: ANALYTICS_REFETCH_MS,
  });
  const pages = pagesQuery.data;
  const hits = pages?.reduce((s, p) => s + p.hits, 0);
  // Without a start date the request loads every recorded visit, up to the newest VISIT_ROW_CAP.
  const capped = (hits ?? 0) >= VISIT_ROW_CAP;
  const hint = range.preset === "all" ? "All time" : rangeBounds(range).label;
  return (
    <div className="space-y-4">
      <RangePicker value={range} onChange={setRange} testId="pages-range" />
      <p className="text-xs text-muted-foreground" data-testid="text-pages-range">{allTimeRange(hits, range)}</p>
      <StatTiles cols={2} tiles={[
        { label: "Total pages", value: pages?.length ?? (pagesQuery.isError ? "Unavailable" : "…"), hint, testId: "card-stat-total-pages" },
        { label: "Total hits", value: hits !== undefined ? countLabel(hits, capped) : pagesQuery.isError ? "Unavailable" : "…", hint: capped ? `Latest ${VISIT_ROW_CAP.toLocaleString()} visits` : hint, testId: "card-stat-total-hits" },
      ]} />
      <MetricStatus queries={[pagesQuery]} />
      {pagesQuery.isError && !pages && (
        <Notice tone="danger" title="Couldn't load pages" testId="notice-pages-error" action={<Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => void pagesQuery.refetch()} data-testid="button-retry-pages">Retry</Button>}>
          {apiErrorMessage(pagesQuery.error, "The page list could not be loaded.")}
        </Notice>
      )}
      {pages && pages.length === 0
        ? <IpSample tab="pages" tiles={false} cta={<InstallCta onOpen={onInstall} />} what={range.preset === "all" ? "the pages table you'll see once this site sends its first visit" : "the pages table — no visit in this range yet"} />
        : <PagesTable pages={pagesQuery.isError && !pages ? undefined : pages} loading={pagesQuery.isLoading} />}
    </div>
  );
}

function GeoView({ domainId, onInstall }: { domainId: number | null; onInstall?: () => void }) {
  const [subTab, setSubTab] = useState<"countries" | "cities">("countries");
  const [range, setRange] = useState<DateRange>(ALL_TIME);
  const [place, setPlace] = useState("");
  const geoQuery = useQuery<GeoData>({
    queryKey: ["/api/click-guard/domains", domainId, "geo", rangeKey(range)],
    queryFn: async () => (await apiRequest("GET", `/api/click-guard/domains/${domainId}/geo${rangeQuery(range)}`)).json(),
    enabled: !!domainId,
    refetchInterval: ANALYTICS_REFETCH_MS,
  });
  const geo = geoQuery.data;
  const all = subTab === "countries" ? geo?.countries : geo?.cities;
  const q = place.trim().toLowerCase();
  const items = all?.filter((r) => !q || r.name.toLowerCase().includes(q));
  const totalVisits = geo ? (geo.countries ?? []).reduce((n, c) => n + c.count, 0) : undefined;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant={subTab === "countries" ? "default" : "outline"} onClick={() => setSubTab("countries")} data-testid="button-geo-countries">Countries</Button>
        <Button size="sm" variant={subTab === "cities" ? "default" : "outline"} onClick={() => setSubTab("cities")} data-testid="button-geo-cities">Cities</Button>
        <div className="g-search min-w-0 flex-1 max-w-xs" role="search">
          <Search aria-hidden="true" />
          <input type="search" placeholder={subTab === "countries" ? "Country code, e.g. US" : "City or country…"} aria-label="Filter places" value={place} onChange={(e) => setPlace(e.target.value)} data-testid="input-geo-filter" />
        </div>
      </div>
      <RangePicker value={range} onChange={setRange} testId="geo-range" />
      <p className="text-xs text-muted-foreground">
        <span data-testid="text-geo-range">{allTimeRange(totalVisits, range)}</span>{" "}
        <span data-testid="text-geo-source-note">{GEO_SOURCE_NOTE}</span>
      </p>
      {geoQuery.isError && !geo && (
        <Notice tone="danger" title="Couldn't load geographic data" testId="notice-geo-error" action={<Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => void geoQuery.refetch()} data-testid="button-retry-geo">Retry</Button>}>
          {apiErrorMessage(geoQuery.error, "The geographic breakdown could not be loaded.")}
        </Notice>
      )}
      {geo && totalVisits === 0
        ? <IpSample tab="geo" cta={<InstallCta onOpen={onInstall} />} what={range.preset === "all" ? "the countries and cities you'll see once this site sends its first visit" : "the countries and cities — no visit in this range yet"} />
        : <GeoTable items={geoQuery.isError && !geo ? undefined : items} mode={subTab} loading={geoQuery.isLoading} emptyText={q ? "No place matches that filter" : "No geographic data available"} />}
    </div>
  );
}

function PlatformsView({ domainId, onInstall }: { domainId: number | null; onInstall?: () => void }) {
  const [range, setRange] = useState<DateRange>(ALL_TIME);
  const platformsQuery = useQuery<PlatformData>({
    queryKey: ["/api/click-guard/domains", domainId, "platforms", rangeKey(range)],
    queryFn: async () => (await apiRequest("GET", `/api/click-guard/domains/${domainId}/platforms${rangeQuery(range)}`)).json(),
    enabled: !!domainId,
    refetchInterval: ANALYTICS_REFETCH_MS,
  });
  const platforms = platformsQuery.data;
  const total = platforms ? Object.values(platforms.devices).reduce((n, c) => n + c, 0) : undefined;
  return (
    <div className="space-y-4">
      <RangePicker value={range} onChange={setRange} testId="platforms-range" />
      <p className="text-xs text-muted-foreground" data-testid="text-platforms-range">{allTimeRange(total, range)}</p>
      {platformsQuery.isLoading ? <Spinner /> : platformsQuery.isError && !platforms ? (
        <Notice tone="danger" title="Couldn't load platform data" testId="notice-platforms-error" action={<Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => void platformsQuery.refetch()} data-testid="button-retry-platforms">Retry</Button>}>
          {apiErrorMessage(platformsQuery.error, "The browser and OS breakdown could not be loaded.")}
        </Notice>
      ) : platforms && total === 0
        ? <IpSample tab="platforms" cta={<InstallCta onOpen={onInstall} />} what={range.preset === "all" ? "the browser, system and device breakdown you'll see once this site sends its first visit" : "the breakdown — no visit in this range yet"} />
        : platforms ? <PlatformBreakdowns platforms={platforms} /> : null}
    </div>
  );
}

export default function IpTrackerPage() {
  const { params, set: setUrlParam } = useUrlState();
  // Each section is its own address (/ip-tracker/visitors; components/traffic-tool/nav.ts); old ?tab= links land there.
  const [activeTab, setActiveTab] = useToolView<TabId>("/ip-tracker", IP_TRACKER_VIEWS, "dashboard");
  const inShell = useInToolShell();
  const selectedDomainId = Number(params.get("site")) || null;
  const setSelectedDomainId = (id: number | null) => setUrlParam("site", id ? String(id) : null);
  const [showAddDomain, setShowAddDomain] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState<number | null>(null);
  const [newDomain, setNewDomain] = useState("");
  const [newDomainName, setNewDomainName] = useState("");
  const [trafficRange, setTrafficRange] = useState<DateRange>({ preset: "30d", from: "", to: "" });
  const domainInput = useRef<HTMLInputElement>(null);
  const { toast } = useToast();
  const tab = tabs.find((t) => t.id === activeTab)!;
  const helpKey = tab.helpKey;

  // Signed out (the public preview of this page): the site list answers 401 — a sign-in prompt, not a failure.
  const domainsQuery = useQuery<DomainWithStats[] | null>({
    queryKey: ["/api/click-guard/domains"],
    queryFn: getQueryFn({ on401: "returnNull" }),
    refetchInterval: (q) => (q.state.data === null ? false : ANALYTICS_REFETCH_MS),
  });
  const signedOut = domainsQuery.data === null;
  const domains = domainsQuery.data ?? undefined;
  const domainsLoading = domainsQuery.isLoading;
  const domainsError = domainsQuery.isError && !domains;

  // A stale or removed ?site= falls back to the first site rather than an id that no longer exists.
  const selectedDomain = (domains ?? []).find((d) => d.id === selectedDomainId) ?? domains?.[0];
  const domainId = selectedDomain?.id ?? null;
  const removing = (domains ?? []).find((d) => d.id === confirmRemove);

  const since = dashboardSince();
  const sinceIso = since.toISOString();
  const analyticsQuery = useQuery<Analytics>({
    queryKey: ["/api/click-guard/domains", domainId, "analytics", sinceIso],
    queryFn: async () => (await apiRequest("GET", `/api/click-guard/domains/${domainId}/analytics?start=${encodeURIComponent(sinceIso)}`)).json(),
    enabled: !!domainId,
    refetchInterval: ANALYTICS_REFETCH_MS,
  });
  // The Traffic section has its own range. Without a start the summary covers the last 7 days, so "all time"
  // sends the epoch; the visit cap (VISIT_ROW_CAP) still applies and the view says so.
  const trafficBounds = rangeBounds(trafficRange);
  const trafficStart = trafficBounds.start ?? new Date(0);
  const trafficQuery = useQuery<Analytics>({
    queryKey: ["/api/click-guard/domains", domainId, "analytics", "traffic", rangeKey(trafficRange)],
    queryFn: async () => (await apiRequest("GET", `/api/click-guard/domains/${domainId}/analytics?start=${encodeURIComponent(trafficStart.toISOString())}${trafficBounds.end ? `&end=${encodeURIComponent(trafficBounds.end.toISOString())}` : ""}`)).json(),
    enabled: !!domainId && activeTab === "traffic",
    refetchInterval: ANALYTICS_REFETCH_MS,
  });

  const addDomainMutation = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/click-guard/domains", { domain: newDomain.trim(), name: newDomainName.trim() || undefined })).json(),
    onSuccess: (created: DomainWithStats) => {
      queryClient.invalidateQueries({ queryKey: ["/api/click-guard/domains"], exact: true });
      queryClient.invalidateQueries({ queryKey: ["/api/vpn-shield/domains"], exact: true });
      setNewDomain(""); setNewDomainName(""); setShowAddDomain(false);
      if (created?.id) setSelectedDomainId(created.id);
      setActiveTab("dashboard");
      toast({ title: "Site added", description: "Install the tracking code below to start collecting visits." });
    },
    onError: (err: unknown) => toast({ title: "Could not add site", description: apiErrorMessage(err, "Failed to add site"), variant: "destructive" }),
  });

  const removeDomainMutation = useMutation({
    mutationFn: async (id: number) => (await apiRequest("DELETE", `/api/click-guard/domains/${id}`)).json(),
    onSuccess: (_res, id) => {
      setSelectedDomainId(null);
      // Drop the site now and refresh only the lists: the removed site's own queries would 404.
      queryClient.setQueryData<DomainWithStats[]>(["/api/click-guard/domains"], (old) => old?.filter((d) => d.id !== id));
      queryClient.removeQueries({ queryKey: ["/api/click-guard/domains", id] });
      queryClient.invalidateQueries({ queryKey: ["/api/click-guard/domains"], exact: true });
      queryClient.invalidateQueries({ queryKey: ["/api/vpn-shield/domains"], exact: true });
      toast({ title: "Site removed" });
    },
    onError: (err: unknown) => toast({ title: "Could not remove site", description: apiErrorMessage(err, "Failed to remove site"), variant: "destructive" }),
  });

  const noSites = !!domains && domains.length === 0;
  const openAddSite = () => { setShowAddDomain(true); requestAnimationFrame(() => domainInput.current?.focus()); };
  const goInstall = () => { setActiveTab("dashboard"); requestAnimationFrame(() => document.getElementById("install-tracking")?.scrollIntoView({ behavior: "smooth", block: "start" })); };
  const addSiteCta = <GooglePill size="sm" variant="solid" icon={Plus} label="Add your first site" onClick={openAddSite} testId="button-add-first-domain" />;

  // In the full-screen tool the site picker sits in the tool bar, beside the menu (like Social Media's business).
  const siteControls = (domains?.length ?? 0) > 0 ? (
    <>
      <label className="block min-w-0 flex-1 space-y-1.5 text-sm sm:w-52 sm:flex-none">
        <span className="text-muted-foreground sm:hidden">Site</span>
        <select className="h-10 w-full rounded-full border bg-background px-4 text-sm" value={domainId || ""} onChange={(e) => setSelectedDomainId(Number(e.target.value))} aria-label="Site" data-testid="select-domain">
          {(domains ?? []).map((d) => <option key={d.id} value={d.id}>{d.name || d.domain}</option>)}
        </select>
      </label>
      <div className="flex flex-1 gap-2 sm:flex-none">
        <DropdownMenu>
          <DropdownMenuTrigger asChild><Button size="icon" variant="outline" aria-label="Site actions" data-testid="button-site-actions"><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => setConfirmRemove(domainId)} data-testid="button-remove-domain"><Trash2 className="mr-2 h-4 w-4" /> Remove site</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <GooglePill icon={Plus} variant="solid" label="Add site" className="flex-1 sm:flex-none" onClick={() => setShowAddDomain((o) => !o)} testId="button-add-domain" />
      </div>
    </>
  ) : undefined;

  const addForm = (showAddDomain || noSites) && !signedOut && !domainsError && (
    <div className="rounded-xl border bg-card text-card-foreground" data-testid="card-add-domain">
      <div className="space-y-3 p-4 sm:p-5">
        <h2 className="g-card__title g-card__title--md">{noSites ? "Step 1 — add the site you want to watch" : "Add a site"}</h2>
        {noSites && <StepsCard testId="steps-add-site" steps={[
          "Type the site's domain, like example.com, and choose Add.",
          "Copy the tracking code that appears and paste it on every page of the site.",
          "Open the site once: its first visit replaces the sample below within about 30 seconds.",
        ]} />}
        <div className="flex flex-col gap-3 sm:flex-row">
          <Input ref={domainInput} placeholder="example.com" value={newDomain} onChange={(e) => setNewDomain(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && newDomain.trim()) addDomainMutation.mutate(); }} aria-label="Site domain" data-testid="input-domain" />
          <Input placeholder="Display name (optional)" value={newDomainName} onChange={(e) => setNewDomainName(e.target.value)} aria-label="Display name" data-testid="input-domain-name" />
        </div>
        <div className="flex gap-2">
          <GooglePill variant="solid" label={addDomainMutation.isPending ? "Adding…" : "Add"} onClick={() => addDomainMutation.mutate()} disabled={!newDomain.trim() || addDomainMutation.isPending} testId="button-save-domain" />
          {!noSites && <GooglePill variant="quiet" label="Cancel" onClick={() => setShowAddDomain(false)} testId="button-cancel-domain" />}
          <span className="self-center text-xs text-muted-foreground">One site counts once across IP Tracker, Click Guard and VPN Shield.</span>
        </div>
      </div>
    </div>
  );

  return (
    <AppPage width="wide" testId="page-ip-tracker">
      {/* Google's page format (owner, 2026-10-07): a quiet header, hairline cards, pill actions, stat tiles. */}
      <GoogleSectionHeader
        as="h1"
        titleTestId="text-page-title"
        title={inShell ? tab.label : "IP Tracker"}
        helpKey={helpKey}
        description={<>
          <span data-testid="text-subtitle">{inShell ? tab.line : "See who visits your sites, where they come from and what they open, as it happens."}</span>
          {selectedDomain && <>{" "}<StatusPill tone="neutral" data-testid="badge-ip-tracker">{selectedDomain.name || selectedDomain.domain}</StatusPill></>}
        </>}
        flush
        actions={inShell ? undefined : siteControls}
      />

      <AlertDialog open={confirmRemove != null} onOpenChange={(o) => { if (!o) setConfirmRemove(null); }}>
        <AlertDialogContent data-testid="dialog-remove-domain">
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {removing?.name || removing?.domain || "this site"}?</AlertDialogTitle>
            <AlertDialogDescription>
              This stops tracking {removing?.domain ?? "this site"} in IP Tracker, Click Guard and VPN Shield, and permanently deletes its recorded visits and blocked IPs. Remove the tracking code from your site as well. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-remove-domain">Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={() => { if (confirmRemove) removeDomainMutation.mutate(confirmRemove); }} data-testid="button-confirm-remove-domain">Remove site</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {addForm}

      {inShell && (domains?.length ?? 0) > 0 && <ToolBarSlot><div className="flex min-w-0 flex-1 flex-wrap items-center gap-2 text-sm" data-testid="toolbar-ip-site"><span className="hidden g-text-2 sm:inline">Site</span>{siteControls}</div></ToolBarSlot>}
      {!inShell && <ToolTabs as="tablist" label="IP tracker sections">
        {tabs.map((t) => <button key={t.id} type="button" onClick={() => setActiveTab(t.id)} role="tab" aria-selected={activeTab === t.id} data-testid={`tab-${t.id}`}>{t.label}</button>)}
      </ToolTabs>}

      {domainsLoading ? <Spinner /> : signedOut ? (
        <Notice tone="info" title="Sign in to see your sites" testId="notice-domains-signed-out" action={<Button asChild size="sm" variant="outline" className="h-7 text-xs"><a href={`/auth?next=${encodeURIComponent("/ip-tracker")}`} data-testid="link-ip-tracker-sign-in">Sign in</a></Button>}>
          This tool watches the websites you add to your ConstructHUB account.
        </Notice>
      ) : domainsError ? (
        <Notice tone="danger" title="Couldn't load your sites" testId="notice-domains-error" action={<Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => void domainsQuery.refetch()} data-testid="button-retry-domains">Retry</Button>}>
          {apiErrorMessage(domainsQuery.error, "The site list could not be loaded.")} This is a failed request, not an empty account.
        </Notice>
      ) : noSites ? (
        // No site yet: every section shows what it will look like, until the first real visit replaces it.
        <IpSample tab={activeTab} cta={addSiteCta} what={`what ${tab.label} shows once your first site sends a visit`} />
      ) : (
        <>
          {/* Keyed by site: search text, expanded rows and pagination must not leak between sites. */}
          {activeTab === "dashboard" && <DashboardView domainId={domainId} analyticsQuery={analyticsQuery} domains={domains ?? []} domainsQuery={domainsQuery} onPickSite={setSelectedDomainId} onRemoveSite={setConfirmRemove} />}
          {activeTab === "visitors" && <VisitorListView key={domainId ?? "none"} domainId={domainId} onInstall={goInstall} />}
          {activeTab === "traffic" && <TrafficSourcesView analyticsQuery={trafficQuery} since={trafficStart} rangeLabel={trafficBounds.label} picker={<RangePicker value={trafficRange} onChange={setTrafficRange} testId="traffic-range" />} onInstall={goInstall} />}
          {activeTab === "pages" && <PagesView key={domainId ?? "none"} domainId={domainId} onInstall={goInstall} />}
          {activeTab === "geo" && <GeoView key={domainId ?? "none"} domainId={domainId} onInstall={goInstall} />}
          {activeTab === "platforms" && <PlatformsView key={domainId ?? "none"} domainId={domainId} onInstall={goInstall} />}
        </>
      )}
    </AppPage>
  );
}
