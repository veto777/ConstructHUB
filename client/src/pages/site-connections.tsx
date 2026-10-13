import { formatNumber } from "@/components/site-connections/format";
import {
  LoadingReport,
  ReportError,
  ReportTable,
  MetricTiles,
  ReportTrend,
  SavedDataStrip,
  SavedDataSummary,
  analyticsColumns,
  cloudflareColumns,
  sumKnown,
  percent,
  position,
  relativeTime,
  accessLabel,
  type Column,
} from "@/components/site-connections/report";
import {
  useReportParam,
  useReportPage,
  useClampPage,
  syncRange,
  previewFingerprint,
} from "@/components/site-connections/context";
import { UrlActions } from "@/components/site-connections/url-actions";
import { Fragment, useEffect, useState, useRef, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest, apiErrorMessage, queryClient } from "@/lib/queryClient";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { Link } from "wouter";
import { SiteConnectionGuide } from "./site-connection-guide";
import { AppPage, Toolbar, Notice } from "@/components/app-ui";
import { ToolTabs } from "@/components/tool";
import { useInToolShell } from "@/components/tool/in-shell";
import { useToolView } from "@/hooks/use-tool-view";
import { CLOUDFLARE_VIEWS, SEARCH_CONSOLE_VIEWS } from "@/components/website-tool/nav";
import {
  GoogleSectionHeader,
  GoogleList,
  GoogleListRow,
  GooglePill,
} from "@/components/google";
import { Search, CheckCircle2 } from "lucide-react";
import { HelpButton } from "@/components/help-button";
import {
  CloudflareConnectSteps,
  CloudflareTokenSteps,
  SearchConsoleConnectSteps,
} from "./site-connect-steps";
import {
  PlanRequired,
  planRequiredFrom,
  pollUnlessPlanRequired,
} from "@/components/plan-required";
// Google's rounded field shape for the native selects (the surface supplies the hairline colour).
const selectClass =
  "h-10 w-full rounded-full border bg-background px-4 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary sm:w-auto";
const sampledBlocks = (snapshot: any) =>
  Array.isArray(snapshot?.events)
    ? snapshot.events.filter((e: any) => e.action === "block").length
    : null;
const read = async (url: string) => (await apiRequest("GET", url)).json();
/** Human names for edge_jobs kinds (server/cloudflare + server/gsc workers); an unknown kind shows as itself. */
const JOB_KIND_LABELS: Record<string, string> = {
  discover: "Find sites",
  sync: "Import data",
  analytics: "Import search analytics",
  sitemap: "Submit sitemap",
  inspect: "Inspect URL",
  apply: "Apply edge protection",
  undo: "Undo edge protection",
  invite: "Send invitation",
  zone: "Check zone",
  ips: "Update allowed IPs",
  memberships: "Check account access",
};
const JOB_STATE_LABELS: Record<string, string> = {
  queued: "Queued",
  running: "Running",
  done: "Done",
  failed: "Failed",
  uncertain: "Outcome unknown",
};
const jobLabel = (kind: unknown) =>
  JOB_KIND_LABELS[String(kind)] ?? String(kind ?? "Job");
const jobState = (state: unknown) =>
  JOB_STATE_LABELS[String(state)] ?? String(state ?? "Unknown");
function Field({
  label,
  ...props
}: React.ComponentProps<typeof Input> & { label: string }) {
  return (
    <label className="block min-w-0 space-y-1.5 text-sm">
      <span className="g-text-2">{label}</span>
      <Input {...props} />
    </label>
  );
}
/**
 * The views as the shared tab bar (components/tool/tabs.tsx); it scrolls sideways, never wraps. Plain buttons:
 * e2e reaches tabs by role "button" (e.g. getByRole("button", { name: "Work queue" })).
 */
function TabStrip({
  tabs,
  active,
  onChange,
}: {
  tabs: { tab: string; helpKey: string }[];
  active: string;
  onChange: (t: string) => void;
}) {
  return (
    <ToolTabs as="group" label="Site connection views">
      {tabs.flatMap(({ tab: t, helpKey }) => [
        <GooglePill
          key={t}
          label={t}
          selected={t === active}
          ariaPressed={t === active}
          onClick={() => onChange(t)}
          testId={`tab-connection-${t.toLowerCase().replace(/\s+/g, "-")}`}
        />,
        // Each view with its "i" (what it's for, what it does, how to run it, how it works), beside its tab.
        <span key={`${t}-help`} className="tool-tabs__aside">
          <HelpButton k={helpKey} />
        </span>,
      ])}
    </ToolTabs>
  );
}
/** The views of each page with their help-registry key (shared/help/registry.ts). */
const CLOUDFLARE_TABS = [
  { tab: "Sites", helpKey: "cloudflare.sites" },
  { tab: "Connections", helpKey: "cloudflare.connections" },
  { tab: "Onboarding", helpKey: "cloudflare.onboarding" },
  { tab: "Work queue", helpKey: "cloudflare.work-queue" },
  { tab: "Edge audit", helpKey: "cloudflare.edge-audit" },
  { tab: "Guide", helpKey: "cloudflare.guide" },
];
/** Each view's line under its title in the full-screen tool (from the help registry's "what it is"). */
const VIEW_LINE: Record<"cloudflare" | "gsc", Record<string, string>> = {
  cloudflare: {
    Sites: "The websites (zones) in your connected Cloudflare accounts, with traffic and protection.",
    Connections: "Give ConstructHUB access to a Cloudflare account, see the accounts already connected, and remove them.",
    Onboarding: "Email a client the steps for giving your Cloudflare login access to their account.",
    "Work queue": "Background jobs for your Cloudflare connections: is it done yet?",
    "Edge audit": "Every protection change: each preview you made and what happened to it.",
    Guide: "Step-by-step instructions for Cloudflare.",
  },
  gsc: {
    Sites: "The Search Console properties in your connected Google accounts: searches, pages, sitemaps and indexing.",
    Connections: "Connect a Google account for Search Console, see the connected accounts, and remove them.",
    Onboarding: "Email a client the steps for adding your Google account to their Search Console property.",
    "Work queue": "Background jobs for your Search Console connections.",
    Guide: "Step-by-step instructions for Search Console.",
  },
};
const SEARCH_CONSOLE_TABS = [
  { tab: "Sites", helpKey: "search-console.sites" },
  { tab: "Connections", helpKey: "search-console.connections" },
  { tab: "Onboarding", helpKey: "search-console.onboarding" },
  { tab: "Work queue", helpKey: "search-console.work-queue" },
  { tab: "Guide", helpKey: "search-console.guide" },
];
export function DataList({
  url,
  title,
  label,
  render,
  filters = [],
  columns,
  sortable = false,
}: {
  url: string;
  title: string;
  /** The heading shown, when it differs from `title` (which also keys the list's address parameters). */
  label?: string;
  render: (row: any) => ReactNode;
  filters?: string[];
  columns?: Column[];
  /** Wire sort/dir to the server (sorted in SQL before pagination) and persist them in the URL. */
  sortable?: boolean;
}) {
  const [q, Q] = useReportParam(`filter.${title}`),
    [page, P] = useReportPage(`page.${title}`),
    [status, S] = useReportParam(`status.${title}`),
    [sort, Sort] = useReportParam(`sort.${title}`),
    [dir, Dir] = useReportParam(`dir.${title}`);
  // Hand-edited or stale URL values that are not real server columns never reach the request.
  const validSort =
    sortable && sort && columns?.some((c) => c.sortKey === sort) ? sort : "";
  const path = `${url}${url.includes("?") ? "&" : "?"}q=${encodeURIComponent(q)}&page=${page}&limit=25&status=${encodeURIComponent(status)}${validSort ? `&sort=${encodeURIComponent(validSort)}&dir=${dir === "desc" ? "desc" : "asc"}` : ""}`;
  // Standard lifecycle: the default queryFn fetches the key (the request path).
  const data = useQuery<any>({
    queryKey: [path],
    refetchInterval: pollUnlessPlanRequired(15000),
  });
  // A page past the end (a stale ?page after the scope changed, or rows removed) snaps to the last page.
  const total: number | undefined = data.data?.total;
  const lastPage = useClampPage(page, total, 25, P);
  // A failed background refetch keeps the last-good rows, flagged by SavedDataStrip below;
  // only a failure with nothing ever loaded falls back to the bare error panel.
  const stale = !!data.error && !!data.data;
  return (
    <section className="space-y-3">
      <GoogleSectionHeader
        as="h3"
        title={label ?? title}
        count={data.data?.total == null ? null : formatNumber(data.data.total)}
        flush
      />
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        <div className="g-search sm:w-80" role="search">
          <Search aria-hidden="true" />
          <input
            type="search"
            aria-label={`Search ${title}`}
            placeholder={
              title === "Search analytics"
                ? "Filter report rows…"
                : `Filter ${title.toLowerCase()}…`
            }
            value={q}
            onChange={(e) => {
              Q(e.target.value);
              P(1);
            }}
          />
        </div>
        {filters.length > 0 && (
          <select
            aria-label={`Filter ${title}`}
            className={selectClass}
            value={status}
            onChange={(e) => {
              S(e.target.value);
              P(1);
            }}
          >
            <option value="">All statuses</option>
            {filters.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        )}
      </div>
      {data.isLoading ? (
        <LoadingReport />
      ) : data.error && (!data.data || planRequiredFrom(data.error)) ? (
        // Nothing ever loaded (or the plan gate fired): the bare error / plan card.
        <ReportError error={data.error} retry={() => void data.refetch()} />
      ) : (
        <>
          {stale && (
            <SavedDataStrip
              updatedAt={data.dataUpdatedAt}
              retry={() => void data.refetch()}
            />
          )}
          <p className="text-sm g-text-2">{formatNumber(data.data?.total)} results</p>
          {data.data?.pendingJobs > 0 && (
            <Notice tone="warning">
              Importing history or awaiting recovery: {formatNumber(data.data.pendingJobs)}{" "}
              unfinished analytics jobs. Check Work queue for failures.
            </Notice>
          )}
          {data.data?.syncedAt && (
            <p className="text-sm text-muted-foreground">
              Last updated {new Date(data.data.syncedAt).toLocaleString()}
            </p>
          )}
          {columns ? (
            <ReportTable
              rows={data.data?.items ?? []}
              columns={columns}
              caption={title}
              total={total}
              sort={validSort ? { key: validSort, dir: dir === "desc" ? "desc" : "asc" } : null}
              onSort={
                sortable
                  ? (key, d) => {
                      Sort(key);
                      Dir(key ? d : "");
                      P(1);
                    }
                  : undefined
              }
            />
          ) : (
            <GoogleList>
              {data.data?.items?.map((r: any, i: number) => (
                <div
                  className="g-card"
                  key={r.id ?? r.url ?? r.path ?? `${r.date}:${r.key}:${i}`}
                >
                  {render(r)}
                </div>
              ))}
              {!data.data?.items?.length && (
                <p className="py-6 text-sm g-text-2">No data available yet.</p>
              )}
            </GoogleList>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <GooglePill
              size="sm"
              disabled={page === 1}
              onClick={() => P(page - 1)}
              label="Previous"
            />
            <span className="text-sm tabular-nums g-text-2">
              Page {formatNumber(page)}
              {lastPage ? ` of ${lastPage}` : ""}
            </span>
            <GooglePill
              size="sm"
              disabled={page * 25 >= (total ?? 0)}
              onClick={() => P(page + 1)}
              label="Next"
            />
          </div>
        </>
      )}
    </section>
  );
}
function MetricRows({ asset }: { asset: any }) {
  const [dimension, D] = useReportParam("dimension", "date"),
    [group, G] = useReportParam("group", dimension === "date" ? "day" : "total"),
    [start, S] = useReportParam(
      "reportStart",
      new Date(Date.now() - 31 * 86400000).toISOString().slice(0, 10),
    ),
    [end, E] = useReportParam(
      "reportEnd",
      new Date().toISOString().slice(0, 10),
    );
  // The analytics DataList remounts on a scope change (its key below) but reads its page from the URL,
  // so page 7 of "query" would otherwise become page 7 of "device". Every scope control resets it.
  const [, setAnalyticsPage] = useReportPage("page.Search analytics");
  const rescope = (set: (v: string) => void) => (v: string) => {
    set(v);
    setAnalyticsPage(1);
  };
  // The Breakdown column is the dimension key; for the date dimension it is always empty.
  const columns =
    dimension === "date"
      ? analyticsColumns.filter((c) => c.label !== "Breakdown")
      : group === "total" ? analyticsColumns.filter(c => c.sortKey !== "date") : analyticsColumns;
  return (
    <div className="space-y-4">
      <p className="flex items-center gap-1.5 text-sm g-text-2">
        About this data: search analytics{" "}
        <HelpButton k="search-console.analytics" />
        <span aria-hidden="true">·</span> sitemaps and index checks{" "}
        <HelpButton k="search-console.sitemaps-indexing" />
      </p>
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
        <label className="block space-y-1.5 text-sm">
          <span className="g-text-2">Breakdown</span>
          <select
            aria-label="Breakdown"
            className={`${selectClass} block`}
            value={dimension}
            onChange={(e) => { rescope(D)(e.target.value); G(e.target.value === "date" ? "day" : "total"); }}
          >
            {["date", "query", "page", "device", "country"].map((d) => (
              <option key={d}>{d}</option>
            ))}
          </select>
        </label>
        <label className="block space-y-1.5 text-sm">
          <span className="g-text-2">Group</span>
          <select
            aria-label="Group"
            className={`${selectClass} block`}
            value={group}
            onChange={(e) => rescope(G)(e.target.value)}
          >
            {(dimension === "date" ? ["day", "week", "month"] : ["total", "day", "week", "month"]).map((d) => (
              <option key={d}>{d}</option>
            ))}
          </select>
        </label>
        <Field
          label="From"
          type="date"
          value={start}
          onChange={(e) => rescope(S)(e.target.value)}
        />
        <Field
          label="To"
          type="date"
          value={end}
          onChange={(e) => rescope(E)(e.target.value)}
        />
      </div>
      <SearchOverview id={asset.id} start={start} end={end} />
      <DataList
        columns={columns}
        sortable
        key={`${dimension}:${group}:${start}:${end}`}
        title="Search analytics"
        url={`/api/gsc/assets/${asset.id}/analytics?dimension=${dimension}&group=${group}&start=${start}&end=${end}`}
        render={(r) => (
          <div className="text-sm">
            <p className="font-medium">
              {r.date} {r.key}
            </p>
            <p className="text-muted-foreground">
              Clicks: {formatNumber(r.clicks)} · Impressions: {formatNumber(r.impressions)} · CTR:{" "}
              {percent(r.ctr) ?? "Unavailable"}{" "}
              · Position:{" "}
              {position(r.position) ?? "Unavailable"}
            </p>
          </div>
        )}
      />
      <p className="text-sm text-muted-foreground">
        Google provides top rows and may omit anonymized queries. Data is
        delayed; jobs still running or failed may leave incomplete results.
        General pages use sitemaps and inspection monitoring. Google’s Indexing
        API supports only JobPosting and BroadcastEvent pages.
      </p>
      <DataList
        title="Sitemaps"
        url={`/api/gsc/assets/${asset.id}/sitemaps`}
        render={(r) => (
          <p className="text-sm text-muted-foreground">
            {r.path} · Submitted: {r.lastSubmitted ?? "Unknown"} · Errors:{" "}
            {formatNumber(r.errors, "Unknown")}
          </p>
        )}
      />
      <DataList
        title="Inspections"
        url={`/api/gsc/assets/${asset.id}/inspections`}
        filters={["PASS", "FAIL", "NEUTRAL"]}
        render={(r) => (
          <div className="text-sm">
            <p className="break-all font-medium">{r.url}</p>
            <p className="text-muted-foreground">
              {r.result?.indexStatusResult?.coverageState ?? "Unavailable"} ·{" "}
              {r.result?.indexStatusResult?.verdict ?? "Unknown"} · Checked{" "}
              {new Date(r.inspected_at).toLocaleString()}
            </p>
          </div>
        )}
      />
      <InspectionCoverage id={asset.id} />
      <p className="text-sm text-muted-foreground">
        Coverage summarizes inspected URLs only; inspection does not request
        indexing.
      </p>
    </div>
  );
}
export function LocationSearchSummary({ locationId }: { locationId: number }) {
  // The server picks the location's linked property; linking a different one or a new sync changes
  // the answer, so the card never serves a cached result on mount and keeps polling while shown.
  const { data, error, isLoading, isFetching, refetch, dataUpdatedAt } =
    useQuery({
      queryKey: [`/api/gsc/locations/${locationId}/summary`],
      refetchOnMount: "always",
      refetchInterval: pollUnlessPlanRequired(60_000),
    });
  const s = (data as any)?.search;
  // The containing location page remains useful without this optional module.
  if (planRequiredFrom(error)) return null;
  if (isLoading) return <LoadingReport />;
  if (error && !data)
    return <ReportError error={error} retry={() => void refetch()} />;
  return (
    <Card>
      <CardContent className="space-y-1 p-4">
        {error && (
          <SavedDataStrip
            updatedAt={dataUpdatedAt}
            retry={() => void refetch()}
          />
        )}
        <p className="font-medium">
          Google Search Console · property totals · last 30 days
        </p>
        <p className="text-sm text-muted-foreground">
          {s
            ? `${formatNumber(s.clicks)} clicks · ${formatNumber(s.impressions)} impressions`
            : "Search Console data unavailable. Connect an account and sync its property."}
        </p>
        {s?.external_id && (
          <p className="text-sm text-muted-foreground">
            Property: {String(s.external_id)}
          </p>
        )}
        <p className="text-xs text-muted-foreground">
          Updated {dataUpdatedAt ? relativeTime(new Date(dataUpdatedAt).toISOString()) : "Not available"}
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <GooglePill
            size="sm"
            label={isFetching ? "Refreshing…" : "Refresh"}
            disabled={isFetching}
            onClick={() => void refetch()}
          />
          <Link href="/search-console" className="text-primary underline">
            Open Search Console
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}
export default function SiteConnections({
  provider,
}: {
  provider: "cloudflare" | "gsc";
}) {
  const cf = provider === "cloudflare",
    base = `/api/${provider}`,
    { toast } = useToast();
  // Each view is its own address (/cloudflare/work-queue; components/website-tool/nav.ts); old ?tab= links land there.
  const [tab, T] = useToolView<string>(cf ? "/cloudflare" : "/search-console", cf ? CLOUDFLARE_VIEWS : SEARCH_CONSOLE_VIEWS, "Sites"),
    inShell = useInToolShell(),
    [selected, Select] = useState<number[]>([]),
    [connection, C] = useState<number | null>(null),
    [assetId, setAssetId] = useReportParam("site"),
    [q, Q] = useReportParam("sitesQuery"),
    [page, P] = useReportPage("sitesPage"),
    [status, Status] = useReportParam("sitesStatus");
  const [email, Email] = useState(""),
    [key, Key] = useState(""),
    [token, Token] = useState(""),
    [zones, Z] = useState<any>(null),
    [zonePage, ZP] = useState(1),
    [accountPage, setAccountPage] = useState(1),
    [zoneSearch, ZS] = useState(""),
    [zoneIds, ZI] = useState<string[]>([]);
  const [busy, B] = useState(false),
    [preview, Preview] = useState<any[]>([]),
    [pack, Pack] = useState("ads-door"),
    [path, Path] = useState("/ads"),
    [ips, Ips] = useState(""),
    [officeIps, OfficeIps] = useState(""),
    [inviteRows, Invites] = useState(""),
    [start, Start] = useReportParam("syncStart"),
    [end, End] = useReportParam("syncEnd");
  const [detailTab, setDetailTab] = useReportParam("detail", "Overview");
  const detail = useQuery<any>({
    queryKey: [`${base}/assets/${assetId}`],
    enabled: !!assetId,
    refetchInterval: pollUnlessPlanRequired(15000),
  });
  // A failed background refetch keeps showing the last-good detail; only the bare error
  // (below) replaces it, and only when nothing ever loaded.
  const asset = detail.data ?? null;
  const A = (a: any) => {
    setAssetId(a ? String(a.id) : "");
    if (a) Select([a.id]);
  };
  const [queuedIds, setQueuedIds] = useState<number[]>([]);
  const [actionError, setActionError] = useState<unknown>(null);
  const [previewKey, setPreviewKey] = useState("");
  const [focusPreview, setFocusPreview] = useState(false);
  const previewHeading = useRef<HTMLSpanElement>(null);
  const selectedSiteTabs = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!focusPreview || detailTab !== "Protection" || !previewHeading.current) return;
    previewHeading.current.focus({ preventScroll: true });
    previewHeading.current.scrollIntoView({ block: "start" });
    if (selectedSiteTabs.current && selectedSiteTabs.current.getBoundingClientRect().top < 80) {
      selectedSiteTabs.current.scrollIntoView({ block: "start" });
    }
    setFocusPreview(false);
  }, [focusPreview, detailTab]);
  const previewIds = asset ? [asset.id] : selected;
  const fingerprint = previewFingerprint(
    previewIds,
    pack,
    path,
    ips,
    officeIps,
  );
  const currentFingerprint = useRef(fingerprint);
  currentFingerprint.current = fingerprint;
  const previewValid = previewKey === fingerprint;
  const listUrl = `${base}/assets?q=${encodeURIComponent(q)}&page=${page}&limit=25&status=${status}`;
  const assets = useQuery({
    queryKey: [listUrl],
    queryFn: () => read(listUrl),
    refetchInterval: pollUnlessPlanRequired(15000),
  });
  const config = useQuery({
    queryKey: [`${base}/connections?limit=1`],
    queryFn: () => read(`${base}/connections?limit=1`),
  });
  const planGate = [config.error, assets.error, actionError].find((e) =>
    planRequiredFrom(e),
  );
  async function act(fn: () => Promise<any>, title = "Request saved", notifySuccess = true) {
    B(true);
    setActionError(null);
    try {
      const r = await fn();
      await queryClient.invalidateQueries({
        predicate: (q) => String(q.queryKey[0]).startsWith(base),
      });
      if (notifySuccess) toast({
        title,
        description:
          r?.message ??
          (r?.queued !== undefined
            ? `${formatNumber(r.queued)} queued. Watch Work queue for completion.`
            : undefined),
      });
      return r;
    } catch (e) {
      setActionError(e);
      toast({
        title: "Could not complete request",
        description: apiErrorMessage(e),
        variant: "destructive",
      });
      return null;
    } finally {
      B(false);
    }
  }
  const post = (path: string, body: any) =>
    apiRequest("POST", base + path, body).then((r) => r.json());
  const toggle = (id: number) =>
    Select(
      selected.includes(id)
        ? selected.filter((x) => x !== id)
        : [...selected, id],
    );
  async function discover(p: number, accounts = accountPage) {
    const d = await act(
      () =>
        post("/key-discovery", {
          email,
          key,
          page: p,
          accountPage: accounts,
          q: zoneSearch,
        }),
      "Cloudflare zones loaded",
    );
    if (d) {
      Z(d);
      ZP(p);
      setAccountPage(accounts);
    }
  }
  // Google's format (owner, 2026-10-07): a quiet page title, the views as pills, hairline lists, pill actions.
  const TABS = cf ? CLOUDFLARE_TABS : SEARCH_CONSOLE_TABS;
  const helpKey = TABS.find((t) => t.tab === tab)?.helpKey;
  // In the full-screen tool the title is the view (the shell's menu says which tool); elsewhere the tool's name.
  const header = inShell ? (
    <GoogleSectionHeader
      as="h1"
      title={tab}
      titleAfter={helpKey ? <HelpButton k={helpKey} /> : undefined}
      description={VIEW_LINE[cf ? "cloudflare" : "gsc"][tab]}
      flush
    />
  ) : (
    <GoogleSectionHeader
      as="h1"
      title={cf ? "Cloudflare protection" : "Google Search Console"}
      titleAfter={
        cf ? <HelpButton k="cloudflare" /> : <HelpButton k="search-console" />
      }
      description={
        cf
          ? "Connect client accounts, inspect traffic, and review changes before blocking at the edge."
          : "Manage client properties, search performance, sitemaps, and indexing monitoring."
      }
      flush
    />
  );
  if (planGate)
    return (
      <AppPage testId={`page-site-connections-${provider}`}>
        {header}
        <PlanRequired
          module="cloudflareSearchConsole"
          error={planGate}
          className="max-w-3xl"
        />
      </AppPage>
    );
  return (
    <AppPage testId={`page-site-connections-${provider}`}>
      {header}
      <SavedDataSummary>
      {config.error &&
        (config.data ? (
          <SavedDataStrip
            updatedAt={config.dataUpdatedAt}
            retry={() => void config.refetch()}
          />
        ) : (
          <ReportError
            error={config.error}
            retry={() => void config.refetch()}
          />
        ))}
      {config.isLoading && <LoadingReport />}
      {config.data?.workerEnabled === false && (
        <Notice tone="warning">
          Background processing is disabled. Queued work will wait until the
          owner enables the site integration worker.
        </Notice>
      )}
      {new URLSearchParams(window.location.search).get("connection") ===
        "failed" && (
        <Notice tone="danger" testId="notice-connection-failed">
          {cf
            ? "Cloudflare sign-in did not finish. Connect again and choose Authorize on Cloudflare's page."
            : "Google consent failed. Reconnect and grant Search Console access."}
        </Notice>
      )}
      {/* Back from Cloudflare's consent page: the win gets its own card (owner, 2026-10-13: "larger, with a checkmark"). */}
      {new URLSearchParams(window.location.search).get("connection") ===
        "connected" && (
          <div
            role="status"
            className="g-card mb-6 flex flex-col gap-4 rounded-2xl border px-5 py-5 sm:flex-row sm:items-center"
            data-testid="notice-connection-connected"
          >
            <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-primary/10" aria-hidden="true">
              <CheckCircle2 className="h-8 w-8 text-primary" strokeWidth={2.2} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-lg font-semibold leading-6 g-text">
                {cf ? "Cloudflare connected" : "Search Console connected"}
                {config.data?.items?.[0]?.email ? <span className="font-normal g-text-2"> · {config.data.items[0].email}</span> : null}
              </p>
              <p className="mt-1 text-sm leading-5 g-text-2">
                {cf
                  ? "Your sites appear under Sites within a minute or two. Work queue shows the import as it runs."
                  : "Your Search Console properties appear under Sites within a minute. Work queue shows the import as it runs."}
              </p>
            </div>
            <GooglePill
              variant="solid"
              className="w-full sm:w-auto"
              label="View sites"
              testId="button-connected-view-sites"
              onClick={() => T("Sites")}
            />
          </div>
        )}
      {config.data && config.data.total > 0 && tab !== "Connections" &&
        new URLSearchParams(window.location.search).get("connection") !== "connected" && (
          <p className="mb-4 flex items-center gap-2 text-sm g-text" data-testid="connected-line">
            <CheckCircle2 className="h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
            <span>
              {cf ? "Cloudflare" : "Search Console"} connected
              {config.data.items?.[0]?.email ? <span className="g-text-2"> · {config.data.items[0].email}{config.data.total > 1 ? ` and ${formatNumber(config.data.total - 1)} more` : ""}</span> : null}
            </span>
          </p>
        )}
      {/* Nothing connected yet: say so first and take them to the steps (on a phone the Sites tab's own prompt is below the fold). */}
      {config.data && !(config.data.total > 0) && tab !== "Connections" && (
        <div
          className="g-callout mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
          data-testid="connect-first-prompt"
        >
          <p className="text-[14px] leading-5 g-text">
            {cf
              ? "Start here: connect your Cloudflare account."
              : "Start here: connect Google Search Console."}{" "}
            <span className="g-text-2">
              It takes about two minutes and the steps are spelled out.
            </span>
          </p>
          <GooglePill
            variant="solid"
            className="w-full sm:w-auto"
            label="Show me how"
            onClick={() => T("Connections")}
            testId="button-connect-first"
          />
        </div>
      )}
      {!inShell && <TabStrip tabs={TABS} active={tab} onChange={T} />}
      {tab === "Guide" && <SiteConnectionGuide />}
      {tab === "Connections" && (
        <div className="space-y-5 sm:space-y-6">
          <section>
            <GoogleSectionHeader
              title={`Connect ${cf ? "Cloudflare" : "Google"}`}
              description={
                cf
                  ? "Sign in at Cloudflare and choose which of your accounts ConstructHUB may see. Nothing to copy or paste."
                  : "Connect the agency’s Google account. Search Console permissions are stored separately from GBP and Calendar."
              }
            />
            {/* Click-by-click: most people have never fetched a key from Cloudflare (owner, 2026-10-07). Since
                Cloudflare opened OAuth to outside apps (June 2026) the sign-in button leads and the key is the fallback. */}
            {!cf && (
              <div className="mb-4">
                <SearchConsoleConnectSteps open={!(config.data?.total > 0)} />
              </div>
            )}
            {cf ? (
              <div className="space-y-4">
                <div
                  className="g-callout flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
                  data-testid="cloudflare-oauth-connect"
                >
                  <p className="text-[14px] leading-5 g-text">
                    Sign in at Cloudflare, tick the account with your websites, and choose Authorize.{" "}
                    <span className="g-text-2">
                      About a minute. ConstructHUB gets full access to the accounts you share — zones, DNS, analytics,
                      firewall, cache, SSL and hosting — so it can run your sites, domains and protection for you. Revoke
                      it any time in Cloudflare under Manage OAuth authorizations.
                    </span>
                  </p>
                  <GooglePill
                    variant="solid"
                    disabled={busy}
                    className="w-full sm:w-auto"
                    testId="button-connect-cloudflare"
                    label="Connect with Cloudflare"
                    onClick={() =>
                      act(
                        async () => {
                          const d = await read(`${base}/connect`);
                          window.location.assign(d.url);
                        },
                        "",
                        false,
                      )
                    }
                  />
                </div>
                <details className="g-card border-t" data-testid="cloudflare-key-fallback">
                  <summary className="cursor-pointer text-sm font-medium">
                    Other ways to connect: Global API Key or a scoped token
                  </summary>
                  <div className="mt-3 space-y-4">
                <CloudflareConnectSteps open={!(config.data?.total > 0)} />
                <div className="grid gap-3 md:grid-cols-2">
                  <Field
                    label="Cloudflare login email"
                    type="email"
                    value={email}
                    onChange={(e) => Email(e.target.value)}
                  />
                  <Field
                    label="Global API Key"
                    type="password"
                    autoComplete="off"
                    value={key}
                    onChange={(e) => Key(e.target.value)}
                  />
                </div>
                <Field
                  label="Find zone by domain"
                  value={zoneSearch}
                  onChange={(e) => ZS(e.target.value)}
                />
                <GooglePill
                  variant="solid"
                  disabled={busy || !key || !email}
                  className="w-full sm:w-auto"
                  onClick={() => discover(1)}
                  label="Verify and choose zones"
                />
                {zones && (
                  <section className="space-y-3 rounded-lg border p-4">
                    <p className="text-sm g-text-2">
                      {formatNumber(zones.total)} zones · page {formatNumber(zonePage)}
                    </p>
                    {zones.accounts.map((a: any) => (
                      <p key={a.id} className="text-sm">
                        Account: {a.name}
                      </p>
                    ))}
                    <div className="flex flex-wrap gap-2">
                      <GooglePill
                        label="Previous accounts"
                        disabled={busy || accountPage === 1}
                        onClick={() => discover(zonePage, accountPage - 1)}
                      />
                      <span className="text-sm">
                        Accounts page {formatNumber(accountPage)}
                      </span>
                      <GooglePill
                        label="Next accounts"
                        disabled={
                          busy || accountPage * 50 >= zones.accountTotal
                        }
                        onClick={() => discover(zonePage, accountPage + 1)}
                      />
                    </div>
                    {zones.zones.map((z: any) => (
                      <label className="flex gap-2 text-sm" key={z.id}>
                        <input
                          type="checkbox"
                          checked={zoneIds.includes(z.id)}
                          onChange={() =>
                            ZI(
                              zoneIds.includes(z.id)
                                ? zoneIds.filter((id) => id !== z.id)
                                : [...zoneIds, z.id],
                            )
                          }
                        />
                        {z.name} · {z.status}
                      </label>
                    ))}
                    <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                      <GooglePill
                        disabled={busy || zonePage === 1}
                        onClick={() => discover(zonePage - 1)}
                        label="Previous zones"
                      />
                      <GooglePill
                        disabled={busy || zonePage * 50 >= zones.total}
                        onClick={() => discover(zonePage + 1)}
                        label="Next zones"
                      />
                      <GooglePill
                        label="Create limited key"
                        disabled={busy || !zoneIds.length}
                        onClick={async () => {
                          try {
                            const r = await act(
                              () =>
                                post("/exchange", {
                                  email,
                                  key,
                                  zones: zoneIds,
                                }),
                              "Limited Cloudflare key created",
                            );
                            if (r) {
                              Z(null);
                              ZI([]);
                            }
                          } finally {
                            Key("");
                          }
                        }}
                      />
                    </div>
                    <p className="text-sm text-muted-foreground">
                      Permissions: Zone Read, Analytics Read, Zone WAF Edit.
                      Limited to selected zones.
                    </p>
                  </section>
                )}
                <details className="g-card border-t">
                  <summary className="cursor-pointer text-sm font-medium">
                    Fallback: paste a scoped API token
                  </summary>
                  <div className="mt-3 space-y-3">
                    <CloudflareTokenSteps />
                    <Field
                      label="Scoped API token"
                      type="password"
                      autoComplete="off"
                      value={token}
                      onChange={(e) => Token(e.target.value)}
                    />
                    <GooglePill
                      label="Connect scoped token"
                      disabled={busy || !token}
                      onClick={async () => {
                        try {
                          await act(
                            () => post("/token", { token }),
                            "Cloudflare connected",
                          );
                        } finally {
                          Token("");
                        }
                      }}
                    />
                  </div>
                </details>
                  </div>
                </details>
                {/* The ops-only agency-membership connection (env CLOUDFLARE_AGENCY_*, POST /api/cloudflare/agency) is not offered
                    here any more (owner, 2026-10-13: "not sure what this is and why we need it"); the route stays for ops. */}
              </div>
            ) : (
              <GooglePill
                variant="solid"
                disabled={busy}
                className="w-full sm:w-auto"
                onClick={() =>
                  act(async () => {
                    const d = await read(`${base}/connect`);
                    window.location.assign(d.url);
                  })
                }
                label="Connect Google Search Console"
              />
            )}
          </section>
          <DataList
            title="Connections"
            url={`${base}/connections`}
            render={(c) => (
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <label className="flex gap-2 text-sm">
                    <input
                      type="radio"
                      name="connection"
                      checked={connection === c.id}
                      onChange={() => C(c.id)}
                    />
                    <b>{c.email ?? c.subject}</b>
                  </label>
                  <p className="text-sm g-text-2">
                    {c.method === "oauth" ? "Connected with Cloudflare sign-in" : (c.token_name ?? c.method)}
                  </p>
                  {c.method === "oauth" && Array.isArray(c.permissions) && c.permissions.length > 8 ? (
                    <details className="text-sm g-text-2">
                      <summary className="cursor-pointer">
                        Full access · {formatNumber(c.permissions.length)} permissions
                      </summary>
                      <p className="mt-1 break-words text-xs leading-5">
                        {c.permissions.map((p: any) => (typeof p === "string" ? p : (p.name ?? p.id))).join(", ")}
                      </p>
                    </details>
                  ) : (
                    <p className="text-sm g-text-2">
                      {c.permissions
                        ?.map((p: any) =>
                          typeof p === "string" ? p : (p.name ?? p.id),
                        )
                        .join(", ")}
                    </p>
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  <GooglePill
                    size="sm"
                    disabled={busy}
                    onClick={() =>
                      act(() => post("/discover", { connectionIds: [c.id] }))
                    }
                    label="Discover sites"
                  />
                  <GooglePill
                    size="sm"
                    variant="danger"
                    label="Disconnect"
                    disabled={busy}
                    onClick={() => {
                      if (
                        window.confirm(
                          "Disconnect and delete cached data? Applied Cloudflare rules remain. Revoke access at the provider if requested.",
                        )
                      )
                        act(() => post("/disconnect", { ids: [c.id] })).then(
                          (r) => {
                            if (r)
                              toast({
                                title: "Disconnected",
                                description: r.results
                                  .map((x: any) => x.message)
                                  .join(" "),
                              });
                          },
                        );
                    }}
                  />
                </div>
              </div>
            )}
          />
        </div>
      )}
      {tab === "Sites" && (
        <div className="space-y-4 sm:space-y-5">
          {!cf && (
            <fieldset className="flex flex-col gap-2 rounded-xl border p-3 sm:flex-row sm:flex-wrap sm:items-end">
              <legend className="px-1 text-sm font-medium">
                Import date range
              </legend>
              <span className="order-last self-start sm:self-end sm:pb-3">
                <HelpButton k="search-console.sync-range" />
              </span>
              <Field
                label="Sync from (up to 16 months)"
                type="date"
                value={start}
                onChange={(e) => Start(e.target.value)}
              />
              <Field
                label="Sync through"
                type="date"
                value={end}
                onChange={(e) => End(e.target.value)}
              />
            </fieldset>
          )}

          {assetId && detail.isLoading && <LoadingReport />}
          {assetId && detail.error && !detail.data && (
            <>
              <ReportError
                error={detail.error}
                retry={() => void detail.refetch()}
              />
              <GooglePill label="Return to sites" onClick={() => A(null)} />
            </>
          )}
          {asset && (
            <section>
              {detail.error && (
                <SavedDataStrip
                  updatedAt={detail.dataUpdatedAt}
                  retry={() => void detail.refetch()}
                />
              )}
              <GoogleSectionHeader
                title={asset.name}
                actions={
                  <GooglePill
                    variant="quiet"
                    size="sm"
                    onClick={() => A(null)}
                    label="Close details"
                  />
                }
              />
              {cf && (
                <div ref={selectedSiteTabs} className="scroll-mt-24"><ToolTabs as="group" label="Selected site views">
                  {["Overview", "Protection", "Activity"].map((t) => (
                    <GooglePill
                      key={t}
                      label={t}
                      selected={detailTab === t}
                      ariaPressed={detailTab === t}
                      onClick={() => {
                        setDetailTab(t);
                        if (t === "Protection") Select([asset.id]);
                      }}
                    />
                  ))}
                </ToolTabs></div>
              )}
              <DatasetStatus
                provider={provider}
                id={asset.id}
                onSync={() =>
                  act(
                    () =>
                      post("/sync", {
                        ids: [asset.id],
                        ...(!cf ? syncRange(start, end) : {}),
                      }),
                    "Sync queued",
                  )
                }
                busy={busy}
              />
              {cf ? (
                detailTab === "Overview" && (
                  <CloudflareDetails
                    id={asset.id}
                    onFlag={(ip) => {
                      Ips(ips ? `${ips}, ${ip}` : ip);
                      Pack("ips");
                      Select([asset.id]);
                      setDetailTab("Protection");
                      setFocusPreview(true);
                    }}
                  />
                )
              ) : (
                // One keyed mount per property. MetricRows and UrlActions were
                // siblings keyed by the same asset id; React's keyed reconciliation
                // collided and left a dead duplicate MetricRows (permanent
                // skeletons) on every cold load of a property.
                <Fragment key={`property-${asset.id}`}>
                  <MetricRows asset={asset} />
                  <UrlActions
                    assets={[asset]}
                    busy={busy}
                    submit={(body) =>
                      act(() => post("/urls", body), "URL work queued")
                    }
                  />
                </Fragment>
              )}
              {cf && detailTab === "Activity" && (
                <DataList
                  title="Site activity"
                  url={`${base}/assets/${asset.id}/activity`}
                  render={(j) => (
                    <div className="text-sm">
                      <b>
                        {jobLabel(j.kind)} · {jobState(j.state)}
                      </b>
                      <p>
                        {j.finished_at
                          ? new Date(j.finished_at).toLocaleString()
                          : "Not completed"}
                      </p>
                      {j.error && <p className="text-destructive">{j.error}</p>}
                    </div>
                  )}
                />
              )}
            </section>
          )}
          {!assetId && (
            <>
              <Toolbar
                search={{
                  value: q,
                  onChange: (v) => {
                    Q(v);
                    P(1);
                    Select([]);
                  },
                  placeholder: "Search sites…",
                }}
                activeFilters={status ? 1 : 0}
                filters={
                  <select
                    aria-label="Site status"
                    className={selectClass}
                    value={status}
                    onChange={(e) => {
                      Status(e.target.value);
                      P(1);
                      Select([]);
                    }}
                  >
                    <option value="">All statuses</option>
                    {(cf
                      ? ["active", "pending"]
                      : [
                          "siteOwner",
                          "siteFullUser",
                          "siteRestrictedUser",
                          "siteUnverifiedUser",
                          "access_removed",
                        ]
                    ).map((s) => (
                      <option key={s} value={s}>{cf ? s : accessLabel(s)}</option>
                    ))}
                  </select>
                }
              />
            </>
          )}
          <div className="flex flex-wrap items-end gap-3">
            {!assetId && (
              <div className="flex w-full flex-col gap-2 sm:ml-auto sm:w-auto sm:flex-row">
                <GooglePill
                  variant="solid"
                  disabled={busy || !selected.length}
                  className="w-full sm:w-auto"
                  onClick={() =>
                    act(() =>
                      post("/sync", {
                        ids: selected,
                        ...(!cf ? syncRange(start, end) : {}),
                      }),
                    )
                  }
                  label={`Sync selected (${formatNumber(selected.length)})`}
                />
                <GooglePill
                  disabled={busy || !assets.data?.total}
                  className="w-full sm:w-auto"
                  onClick={() =>
                    act(() =>
                      post("/sync", {
                        allMatching: true,
                        q,
                        status,
                        ...(!cf ? syncRange(start, end) : {}),
                      }),
                    )
                  }
                  label="Sync all matching sites"
                />
              </div>
            )}
          </div>
          {!assetId && (
            <>
              {assets.isLoading ? (
                <LoadingReport />
              ) : assets.error && !assets.data ? (
                <ReportError
                  error={assets.error}
                  retry={() => void assets.refetch()}
                />
              ) : (
                <>
                  {assets.error && (
                    <SavedDataStrip
                      updatedAt={assets.dataUpdatedAt}
                      retry={() => void assets.refetch()}
                    />
                  )}
                  <p className="text-sm g-text-2">
                    {formatNumber(assets.data?.total)} sites
                  </p>
                  <label className="flex gap-2 text-sm g-text-2">
                    <input
                      type="checkbox"
                      aria-label="Select this page"
                      checked={
                        !!assets.data?.items.length &&
                        assets.data.items.every((a: any) =>
                          selected.includes(a.id),
                        )
                      }
                      onChange={(e) =>
                        Select(
                          e.target.checked
                            ? assets.data.items.map((a: any) => a.id)
                            : [],
                        )
                      }
                    />
                    Select this page
                  </label>
                  {assets.data?.items.length ? (
                    <GoogleList testId={`list-sites-${provider}`}>
                      {assets.data.items.map((a: any) => (
                        <GoogleListRow
                          key={a.id}
                          size="md"
                          title={
                            <span className="inline-flex items-center gap-3">
                              <input
                                type="checkbox"
                                aria-label={`Select ${a.name}`}
                                checked={selected.includes(a.id)}
                                onChange={() => toggle(a.id)}
                              />
                              <button
                                className="rounded text-left text-primary underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                                type="button"
                                onClick={() => A(a)}
                              >
                                {a.name}
                              </button>
                            </span>
                          }
                          meta={[
                            cf ? a.status : accessLabel(a.status),
                            `${formatNumber(a.locations)} linked locations`,
                            a.synced_at
                              ? `${cf ? "Analytics" : "Sitemaps"} updated ${new Date(a.synced_at).toLocaleString()}`
                              : "Not synced",
                          ]}
                          line={
                            a.error ? (
                              <span role="alert" className="g-closed">
                                {a.error}
                              </span>
                            ) : undefined
                          }
                          trailing={
                            <GooglePill
                              size="sm"
                              disabled={busy}
                              onClick={async () => {
                                const result = await act(
                                  () =>
                                    post("/sync", {
                                      ids: [a.id],
                                      ...(!cf ? syncRange(start, end) : {}),
                                    }),
                                  "Sync queued",
                                );
                                if (result)
                                  setQueuedIds((ids) => [...ids, a.id]);
                              }}
                              label={
                                queuedIds.includes(a.id)
                                  ? "Sync requested · sync again"
                                  : "Sync"
                              }
                            />
                          }
                        />
                      ))}
                    </GoogleList>
                  ) : (
                    <div className="py-6 space-y-3">
                      {config.data && config.data.total > 0 ? (
                        <>
                          {/* Connected, but the account owns nothing we can list (owner, 2026-10-13: support@ had no Search Console properties). */}
                          <p className="text-sm g-text" data-testid="text-connected-but-empty">
                            <b>{config.data.items?.[0]?.email ?? "The connected account"}</b> is connected, but{" "}
                            {cf
                              ? "no zones were found in the Cloudflare accounts you shared. Add your website to Cloudflare, or connect the account that holds it, then choose Discover sites on the Connections tab."
                              : "that Google account has no Search Console properties. Add your website at Google Search Console with this account, or add this account as a user on the existing property, then choose Discover sites on the Connections tab."}
                          </p>
                          <div className="flex flex-wrap gap-2">
                            {!cf && (
                              <GooglePill variant="solid" href="https://search.google.com/search-console" external label="Open Google Search Console" testId="button-open-search-console" />
                            )}
                            <GooglePill label="Connections" onClick={() => T("Connections")} testId="button-open-connect-steps" />
                          </div>
                        </>
                      ) : (
                        <>
                          <p className="text-sm g-text-2">
                            No connected sites yet. Connect{" "}
                            {cf
                              ? "your Cloudflare account"
                              : "Google Search Console"}{" "}
                            first — the steps are on the Connections tab.
                          </p>
                          <GooglePill
                            variant="solid"
                            label={
                              cf
                                ? "Connect Cloudflare — show me how"
                                : "Connect Search Console — show me how"
                            }
                            onClick={() => T("Connections")}
                            testId="button-open-connect-steps"
                          />
                        </>
                      )}
                    </div>
                  )}
                  <div className="flex flex-wrap items-center gap-2">
                    <GooglePill
                      size="sm"
                      disabled={page === 1}
                      onClick={() => P(page - 1)}
                      label="Previous sites"
                    />
                    <span className="text-sm tabular-nums g-text-2">
                      Page {formatNumber(page)}
                    </span>
                    <GooglePill
                      size="sm"
                      disabled={page * 25 >= (assets.data?.total ?? 0)}
                      onClick={() => P(page + 1)}
                      label="Next sites"
                    />
                  </div>
                </>
              )}
            </>
          )}
          {cf
            ? (!assetId || (asset && detailTab === "Protection")) && (
                <section>
                  <GoogleSectionHeader
                    title={<span ref={previewHeading} tabIndex={-1} className="block scroll-mt-40 rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">Preview edge protection for selected zones</span>}
                    titleAfter={<HelpButton k="cloudflare.protection" />}
                    description="Review Click Guard / VPN Shield findings before adding IPs. Rules affect visitors."
                  />
                  <div className="space-y-3">
                    <select
                      aria-label="Rule pack"
                      className={selectClass}
                      value={pack}
                      onChange={(e) => Pack(e.target.value)}
                    >
                      <option value="ads-door">Ads door</option>
                      <option value="bad-ua">Site-wide bad user agents</option>
                      <option value="ips">Flagged IPs</option>
                    </select>
                    {pack === "ads-door" && <Field
                      label="Ads path"
                      value={path}
                      onChange={(e) => Path(e.target.value)}
                    />}
                    <Field
                      label="Flagged IP addresses (comma separated)"
                      value={ips}
                      onChange={(e) => Ips(e.target.value)}
                    />
                    <Field
                      label="Office IP exemptions (comma separated)"
                      value={officeIps}
                      onChange={(e) => OfficeIps(e.target.value)}
                    />
                    <p className="text-sm text-muted-foreground">
                      Check office-IP exemptions in Cloudflare first.
                    </p>
                    <GooglePill
                      label="Preview rules"
                      disabled={busy || !previewIds.length}
                      onClick={async () => {
                        const d = await act(
                          () =>
                            post("/preview", {
                              ids: previewIds,
                              kind: pack,
                              path,
                              officeIps: officeIps
                                .split(",")
                                .map((x) => x.trim())
                                .filter(Boolean),
                              ips: ips
                                .split(",")
                                .map((x) => x.trim())
                                .filter(Boolean),
                            }),
                          "Preview ready",
                          false, // The review box announces success without an overlay.
                        );
                        if (d && currentFingerprint.current === fingerprint) {
                          Preview(d.items);
                          setPreviewKey(fingerprint);
                        }
                      }}
                    />
                    {preview.length > 0 && !previewValid && (
                      <Notice tone="warning">
                        Inputs changed. Preview these rules again before
                        confirming.
                      </Notice>
                    )}
                    {preview.length > 0 && previewValid && (
                      <div className="space-y-3 rounded-lg border p-4">
                        <p role="status" className="text-sm text-muted-foreground">Preview ready</p>
                        <h3 className="g-card__title g-card__title--md">
                          Review before applying
                        </h3>
                        {preview.map((p) => (
                          <div key={p.id} className="text-sm">
                            <b>{p.zone}</b>
                            <p className="text-muted-foreground">{p.warning}</p>
                            {p.rules.map((r: any, i: number) => (
                              <div key={i}>
                                <p>{r.rule.description}</p>
                                <code className="break-all text-xs">
                                  {r.rule.expression}
                                </code>
                              </div>
                            ))}
                          </div>
                        ))}
                        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                          <GooglePill
                            variant="danger"
                            label="Confirm and queue edge changes"
                            disabled={busy}
                            onClick={async () => {
                              const r = await act(
                                () =>
                                  post("/confirm", {
                                    ids: preview.map((p) => p.id),
                                  }),
                                "Protection queued",
                              );
                              if (r) Preview([]);
                            }}
                          />
                          <GooglePill
                            onClick={() => Preview([])}
                            label="Cancel preview"
                          />
                        </div>
                      </div>
                    )}
                  </div>
                </section>
              )
            : !assetId &&
              !assets.error &&
              !assets.isLoading && (
                <UrlActions
                  key="inventory"
                  assets={assets.data?.items ?? []}
                  busy={busy}
                  submit={(body) =>
                    act(() => post("/urls", body), "URL work queued")
                  }
                />
              )}
        </div>
      )}
      {tab === "Onboarding" && (
        <div className="space-y-5">
          <p className="text-sm text-muted-foreground">
            Select a connection under Connections, then enter one client per
            line: email, location ID{cf ? ", Cloudflare account ID" : ""}. Email
            goes to the client with steps to grant access. Active connection:{" "}
            {connection ?? "None"}.
          </p>
          <DataList
            title="Locations"
            url={`${base}/locations`}
            render={(l) => (
              <p className="text-sm text-muted-foreground">
                {l.id} · {l.business_name} · {l.website ?? "Website required"}
              </p>
            )}
          />
          <label className="block space-y-1.5 text-sm">
            <span className="g-text-2">Client invitations</span>
            <textarea
              className="w-full rounded-lg border bg-background p-3 text-sm"
              aria-label="Client invitations"
              rows={4}
              value={inviteRows}
              onChange={(e) => Invites(e.target.value)}
            />
          </label>
          <GooglePill
            variant="solid"
            label="Send onboarding emails"
            disabled={busy || !connection || !inviteRows.trim()}
            className="w-full sm:w-auto"
            onClick={() =>
              act(
                () =>
                  post("/invites", {
                    connectionId: connection,
                    clients: inviteRows
                      .trim()
                      .split("\n")
                      .map((line) => {
                        const [email, id, account] = line
                          .split(",")
                          .map((x) => x.trim());
                        return {
                          email,
                          locationId: Number(id),
                          accountId: account || undefined,
                        };
                      }),
                  }),
                "Invitation emails queued",
              )
            }
          />
          <DataList
            title="Invitations"
            url={`${base}/invites`}
            filters={["pending", "accepted"]}
            render={(i) => (
              <p className="text-sm text-muted-foreground">
                {i.email} · {i.domain} · {i.state}
              </p>
            )}
          />
        </div>
      )}
      {tab === "Work queue" && (
        <DataList
          title="Work queue"
          label={inShell ? "Jobs" : undefined}
          url={`${base}/jobs`}
          filters={["queued", "running", "done", "failed", "uncertain"]}
          render={(j) => (
            <div className="space-y-1 text-sm">
              <p className="font-medium">
                {jobLabel(j.kind)}{" "}
                <span className="g-chip g-chip--sm">{jobState(j.state)}</span>
              </p>
              <p className="text-muted-foreground">
                {j.finished_at
                  ? `Finished ${relativeTime(j.finished_at)}`
                  : j.started_at
                    ? `Started ${relativeTime(j.started_at)}`
                    : "Waiting to start"}
              </p>
              {j.error && (
                <p className="text-destructive break-words">{j.error}</p>
              )}
            </div>
          )}
        />
      )}
      {tab === "Edge audit" && (
        <DataList
          title="Edge audit"
          label={inShell ? "Changes" : undefined}
          url={`${base}/actions`}
          filters={["preview", "queued", "applied", "reverted", "uncertain"]}
          render={(a) => (
            <div className="space-y-2 text-sm">
              <b>
                {a.name} · {a.kind} · {a.state}
              </b>
              <p className="text-muted-foreground">
                <time
                  dateTime={a.created_at}
                  title={new Date(a.created_at).toLocaleString()}
                >
                  {relativeTime(a.created_at)}
                </time>
              </p>
              <p className="text-muted-foreground">
                {formatNumber(sampledBlocks(a.preview.before), "Unknown number of")} blocked
                requests sampled before the change;{" "}
                {formatNumber(sampledBlocks(a.after), "unknown number of")} in the latest
                snapshot. Latest snapshot: {relativeTime(a.after?.until)}. Sync
                after applying. Samples do not prove the change caused a
                difference.
              </p>
              {["applied", "uncertain"].includes(a.state) && (
                <GooglePill
                  size="sm"
                  disabled={busy}
                  onClick={() =>
                    act(() => post("/undo", { ids: [a.id] }), "Undo queued")
                  }
                  label="Undo ConstructHUB rules"
                />
              )}
            </div>
          )}
        />
      )}
      </SavedDataSummary>
    </AppPage>
  );
}
export function CloudflareDetails({
  id,
  onFlag,
}: {
  id: number;
  onFlag: (ip: string) => void;
}) {
  const query = useQuery<any>({
    queryKey: [`/api/cloudflare/assets/${id}`],
    refetchInterval: pollUnlessPlanRequired(15000),
  });
  const d = query.data?.data;
  if (query.isLoading) return <LoadingReport />;
  if (query.error && !query.data)
    return (
      <ReportError error={query.error} retry={() => void query.refetch()} />
    );
  return (
    <div className="space-y-4">
      {query.error && (
        <SavedDataStrip
          updatedAt={query.dataUpdatedAt}
          retry={() => void query.refetch()}
        />
      )}
      {!d ? (
        <Notice>
          Analytics have not been imported. Sync this site to retrieve its
          available reports.
        </Notice>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            {d.since ? new Date(d.since).toLocaleString() : "Unknown start"} –{" "}
            {d.until ? new Date(d.until).toLocaleString() : "Unknown end"}.{" "}
            {d.notice}
          </p>
          <MetricTiles
            metrics={[
              {
                label: "Requests (UTC days)",
                value: sumKnown(d.traffic, "requests"),
              },
              {
                label: "Threats (UTC days)",
                value: sumKnown(d.traffic, "threats"),
              },
              {
                label: "Page views (UTC days)",
                value: sumKnown(d.traffic, "pageViews"),
              },
              {
                label: "Bot share of scored requests",
                value: percent(d.botShare),
              },
            ]}
          />
          <ReportTrend
            rows={d.traffic ?? []}
            label="Requests by UTC day"
            start={d.since?.slice(0, 10)}
            end={d.until?.slice(0, 10)}
            date={(r) => r.dimensions?.date}
            value={(r) => r.sum?.requests}
          />
          {Object.keys(cloudflareColumns).map((field) => (
            <section key={field} className="space-y-2">
              {d[field] == null ? (
                <Notice>
                  {field}: unavailable from Cloudflare with the current
                  permissions or plan.
                </Notice>
              ) : (
                <DataList
                  title={field[0].toUpperCase() + field.slice(1)}
                  url={`/api/cloudflare/assets/${id}/cache?field=${field}`}
                  columns={cloudflareColumns[field]}
                  sortable
                  render={() => null}
                />
              )}
              {field === "countries" && (
                <a
                  href="#flagged-ips"
                  className="text-sm text-primary underline"
                >
                  Review flagged IPs for this site
                </a>
              )}
            </section>
          ))}
        </>
      )}
      <div id="flagged-ips">
        <DataList
          title="Flagged IPs"
          url={`/api/cloudflare/assets/${id}/flagged-ips`}
          render={(r) => (
            <div className="space-y-2 text-sm">
              <p>
                {r.ip_address} · {r.source} · {r.reason}
              </p>
              <GooglePill
                size="sm"
                onClick={() => onFlag(r.ip_address)}
                label="Add to preview"
              />
            </div>
          )}
        />
      </div>
    </div>
  );
}
export function CloudflarePage() {
  return <SiteConnections provider="cloudflare" />;
}
export function SearchConsolePage() {
  return <SiteConnections provider="gsc" />;
}

export function ScanIndexingSummary({ scanId }: { scanId: string }) {
  // Same cached query the Search Console page uses; a 402 means the plan has no Search Console module.
  const access = useQuery({ queryKey: ["/api/gsc/connections?limit=1"] });
  if (access.isLoading || planRequiredFrom(access.error)) return null;
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Search Console indexing</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <DataList
          title="Scanned URL indexing"
          url={`/api/gsc/scans/${scanId}/indexing`}
          render={(r) => (
            <p className="text-sm text-muted-foreground">
              {r.url} ·{" "}
              {r.result?.indexStatusResult?.coverageState ?? "Not inspected"}{" "}
              {r.inspected_at &&
                `· ${new Date(r.inspected_at).toLocaleString()}`}
            </p>
          )}
        />
        <Link className="text-primary underline" href="/search-console">
          Queue inspections in Search Console
        </Link>
      </CardContent>
    </Card>
  );
}

function InspectionCoverage({ id }: { id: number }) {
  const { data, error, isLoading, refetch, dataUpdatedAt } = useQuery<any>({
    queryKey: [`/api/gsc/assets/${id}/inspections?limit=1`],
    refetchInterval: pollUnlessPlanRequired(15000),
  });
  if (isLoading) return <LoadingReport />;
  if (error && !data)
    return <ReportError error={error} retry={() => void refetch()} />;
  return (
    <div className="space-y-2">
      {error && (
        <SavedDataStrip
          updatedAt={dataUpdatedAt}
          retry={() => void refetch()}
        />
      )}
      <p className="text-sm text-muted-foreground">
        Inspected URL coverage:{" "}
        {data?.coverage?.length
          ? data.coverage
              .map((c: any) => `${c.verdict ?? "Unknown"}: ${formatNumber(c.count)}`)
              .join(" · ")
          : "Unavailable"}
      </p>
    </div>
  );
}

function SearchOverview({
  id,
  start,
  end,
}: {
  id: number;
  start: string;
  end: string;
}) {
  const query = useQuery<any>({
    queryKey: [`/api/gsc/assets/${id}/overview?start=${start}&end=${end}`],
    refetchInterval: pollUnlessPlanRequired(15000),
  });
  if (query.isLoading) return <LoadingReport />;
  if (query.error && !query.data)
    return (
      <ReportError error={query.error} retry={() => void query.refetch()} />
    );
  const s = query.data?.summary;
  return (
    <section className="space-y-3" aria-label="Search performance overview">
      {query.error && (
        <SavedDataStrip
          updatedAt={query.dataUpdatedAt}
          retry={() => void query.refetch()}
        />
      )}
      <p className="text-sm">
        Selected range: {start} – {end}. Available data:{" "}
        {s?.first_date && s?.last_date
          ? `${s.first_date} – ${s.last_date}`
          : "No imported dates in this range"}
        .
      </p>
      <MetricTiles
        metrics={[
          { label: "Clicks", value: s?.clicks },
          { label: "Impressions", value: s?.impressions },
          { label: "CTR", value: percent(s?.ctr) },
          { label: "Average position", value: position(s?.position) },
        ]}
      />
      <ReportTrend
        rows={query.data?.trend ?? []}
        label="Daily clicks"
        date={(r) => r.date}
        value={(r) => r.clicks}
        start={start}
        end={end}
      />
    </section>
  );
}
export function DatasetStatus({
  provider,
  id,
  busy,
  onSync,
}: {
  provider: string;
  id: number;
  busy: boolean;
  onSync: () => void;
}) {
  const query = useQuery<any>({
    queryKey: [`/api/${provider}/assets/${id}/sync-status`],
    refetchInterval: pollUnlessPlanRequired(15000),
  });
  if (query.isLoading) return <LoadingReport />;
  if (query.error && !query.data)
    return (
      <ReportError error={query.error} retry={() => void query.refetch()} />
    );
  const d = query.data;
  const names =
    provider === "gsc"
      ? [
          { kind: "discover", label: "Property discovery" },
          { kind: "sync", label: "Sitemaps" },
          { kind: "analytics", label: "Search analytics" },
          { kind: "inspect", label: "URL inspections" },
        ]
      : [
          { kind: "discover", label: "Zone discovery" },
          { kind: "sync", label: "Traffic and security reports" },
        ];
  return (
    <section className="my-4 space-y-3" aria-label="Dataset sync status">
      {query.error && (
        <SavedDataStrip
          updatedAt={query.dataUpdatedAt}
          retry={() => void query.refetch()}
        />
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        {names.map((n) => {
          const j = d?.jobs?.find((j: any) => j.kind === n.kind);
          const analytics = n.kind === "analytics";
          const updated = analytics
            ? d?.analytics?.updated_at
            : j?.state === "done"
              ? j.finished_at
              : n.kind === "sync"
                ? d?.syncedAt
                : null;
          const state =
            analytics && d?.analytics?.pending > 0
              ? `Importing history · ${formatNumber(d.analytics.pending)} jobs pending`
              : (j?.state ?? (updated ? "Imported" : "Not yet recorded"));
          return (
            <div key={n.kind} className="rounded-lg border p-3 text-sm">
              <h3 className="font-medium">{n.label}</h3>
              <p role="status">{state}</p>
              {updated && (
                <p className="text-muted-foreground">
                  Last completed {new Date(updated).toLocaleString()}
                </p>
              )}
              {analytics && d?.analytics?.failed > 0 && (
                <p className="text-destructive">
                  {d.analytics.failed} failed or uncertain jobs. Check Work
                  queue; sync again to retry analytics.
                </p>
              )}
              {j?.error && <p className="text-destructive">{j.error}</p>}
            </div>
          );
        })}
      </div>
      {d?.datasets?.length > 0 && (
        <ReportTable
          caption="Analytics import status by dataset"
          rows={d.datasets}
          columns={[
            { label: "Dataset", value: (r) => r.dimension },
            { label: "Importing", value: (r) => r.pending, numeric: true },
            { label: "Failed / uncertain", value: (r) => r.failed, numeric: true },
            {
              label: "Last completed",
              value: (r) =>
                r.updated_at ? new Date(r.updated_at).toLocaleString() : null,
            },
          ]}
        />
      )}
      {d?.error && <Notice tone="danger">{d.error}</Notice>}
      <GooglePill label="Sync this site" disabled={busy} onClick={onSync} />
      {provider === "gsc" && (
        <p className="text-xs text-muted-foreground">
          Sync uses the import date range above. URL inspections are queued
          separately.
        </p>
      )}
    </section>
  );
}
