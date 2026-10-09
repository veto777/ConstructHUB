import { useState } from "react";
import { useLocation, useSearch } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiErrorMessage, apiRequest, queryClient } from "@/lib/queryClient";
import { useAppOrigin } from "@/lib/app-origin";
import {
  AppPage, Section, StatusPill,
} from "@/components/app-ui";
import { GoogleSectionHeader, GooglePill, GoogleStat, GoogleStatGrid } from "@/components/google";
import { ToolTabs } from "@/components/tool";
import {
  Fingerprint, Globe, Eye, Users, Monitor, Smartphone, Tablet,
  Search, ChevronRight, MapPin,
  FileText, Plus, Copy, Trash2,
  Clock, Activity, AlertTriangle,
  Laptop, Chrome, MoreHorizontal,
} from "lucide-react";

type DomainWithStats = {
  id: number;
  userId: number;
  domain: string;
  trackingId: string;
  name: string | null;
  isActive: boolean;
  createdAt: string;
  stats: {
    totalVisits: number;
    uniqueVisitors: number;
    blockedIps: number;
    suspiciousVisits: number;
    avgVisitsPerUser: number;
  };
};

type Visitor = {
  ipAddress: string;
  fingerprint: string | null;
  visits: number;
  pageViews: number;
  firstVisit: string;
  lastVisit: string;
  lastDevice: string | null;
  lastBrowser: string | null;
  lastOs: string | null;
  screenResolution: string | null;
  language: string | null;
  timezone: string | null;
  country: string | null;
  city: string | null;
  isSuspicious: boolean;
  isOnline: boolean;
};

type VisitorDetail = {
  ipAddress: string;
  fingerprint: string | null;
  totalVisits: number;
  firstVisit: string;
  lastVisit: string;
  isOnline: boolean;
  isSuspicious: boolean;
  suspicionReasons: string[];
  systemSpecs: {
    browser: string | null;
    os: string | null;
    deviceType: string | null;
    screenResolution: string | null;
    language: string | null;
    timezone: string | null;
    userAgent: string | null;
  };
  geo: {
    country: string | null;
    city: string | null;
  };
  recentActivity: {
    id: number;
    referrer: string | null;
    landingPage: string | null;
    visitedAt: string;
    deviceType: string | null;
    browser: string | null;
    isSuspicious: boolean;
  }[];
};

type TrafficSource = {
  domain: string;
  pageLoads: number;
  visitors: number;
  percentage: number;
};

type Analytics = {
  totalVisits: number;
  uniqueVisitors: number;
  blockedIps: number;
  suspiciousVisits: number;
  avgVisitsPerUser: number;
  threatLevel: string;
  threatPercent: number;
  deviceBreakdown: Record<string, number>;
  countryBreakdown: Record<string, number>;
  browserBreakdown: Record<string, number>;
  osBreakdown: Record<string, number>;
  hourlyVisits: Record<string, number>;
  dailyVisits: Record<string, number>;
  multiClickBreakdown: Record<string, number>;
  trafficSources: TrafficSource[];
};

type PageStat = { url: string; hits: number; uniqueVisitors: number };
type GeoData = {
  countries: { name: string; count: number; visitors: number; percentage: string }[];
  cities: { name: string; count: number; visitors: number; country: string; percentage: string }[];
};
type PlatformData = {
  browsers: Record<string, number>;
  oses: Record<string, number>;
  devices: Record<string, number>;
  resolutions: Record<string, number>;
};

const tabs = [
  { id: "dashboard", label: "Dashboard" },
  { id: "visitors", label: "Visitors" },
  { id: "traffic", label: "Traffic" },
  { id: "pages", label: "Pages" },
  { id: "geo", label: "Geo" },
  { id: "platforms", label: "Platforms" },
] as const;

type TabId = typeof tabs[number]["id"];

/** Tab and site live in the query string (?site=10&tab=platforms) so a reload or shared link keeps them. */
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

const pad2 = (n: number) => String(n).padStart(2, "0");
const localDayKey = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const daysAgo = (now: Date, n: number) => new Date(now.getFullYear(), now.getMonth(), now.getDate() - n);

/** Local midnight that covers both the 14-day chart and "This Month". */
function dashboardSince(now = new Date()) {
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const chartStart = daysAgo(now, 13);
  return monthStart < chartStart ? monthStart : chartStart;
}

/**
 * The server buckets days in UTC; regroup its UTC hour buckets ("2026-09-29T23") by the
 * viewer's local day so "Today" rolls over at local midnight. Exact for whole-hour offsets;
 * half-hour zones can shift up to 30 minutes of visits across midnight.
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

// The visit endpoints load at most this many visits, newest first (storage.getClickVisits),
// so the all-time total and a busy site's date range stop at it. A count at the cap is a
// lower bound, shown with "+", never as an exact number.
const VISIT_ROW_CAP = 1000;
const countLabel = (n: number, partial: boolean) => (partial ? `${n.toLocaleString()}+` : n.toLocaleString());

function formatTimeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric",
    hour: "numeric", minute: "2-digit",
  });
}

function DeviceIcon({ type }: { type: string | null }) {
  if (type === "mobile") return <Smartphone className="h-3.5 w-3.5" />;
  if (type === "tablet") return <Tablet className="h-3.5 w-3.5" />;
  return <Monitor className="h-3.5 w-3.5" />;
}

function PercentBar({ value }: { value: number }) {
  return (
    <div className="w-full bg-muted rounded-full h-2">
      <div className="bg-primary h-2 rounded-full transition-all" style={{ width: `${Math.min(value, 100)}%` }} />
    </div>
  );
}

function OnlineCell({ domainId }: { domainId: number }) {
  const { data, isError } = useQuery<{ count: number }>({
    queryKey: ["/api/click-guard/domains", domainId, "online"],
  });
  return (
    <td className="px-3 py-2.5 sm:px-4 sm:py-3 align-middle text-right tabular-nums" data-testid={`text-online-${domainId}`} title="Distinct IPs in the last 20 minutes">
      <span className="sm:hidden text-muted-foreground">Online: </span>
      {data ? data.count : isError ? "Unavailable" : "…"}
    </td>
  );
}

function InstallCard({ domain }: { domain: DomainWithStats }) {
  const appOrigin = useAppOrigin();
  const { toast } = useToast();
  const noVisits = domain.stats.totalVisits === 0;
  const [open, setOpen] = useState(noVisits);
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
    <div className="rounded-xl border bg-card text-card-foreground" data-testid="card-install-tracking">
      <div className="space-y-3 p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="g-card__title g-card__title--md">Tracking code for {domain.domain}</h3>
            <p className="mt-0.5 text-xs text-muted-foreground" data-testid="text-install-status">
              {noVisits
                ? "No visits recorded yet. Visits appear here only after this code runs on your site."
                : `${countLabel(domain.stats.totalVisits, domain.stats.totalVisits >= VISIT_ROW_CAP)} visit${domain.stats.totalVisits !== 1 ? "s" : ""} recorded so far.`}
            </p>
          </div>
          {!noVisits && (
            <Button size="sm" variant="ghost" className="text-xs" onClick={() => setOpen(o => !o)} data-testid="button-toggle-install">
              {open ? "Hide code" : "Show code"}
            </Button>
          )}
        </div>
        {open && (
          <>
            <p className="text-xs text-muted-foreground">
              Add this tag to the <code className="rounded bg-muted px-1 py-0.5">&lt;head&gt;</code> or just before the closing <code className="rounded bg-muted px-1 py-0.5">&lt;/body&gt;</code> tag of every page you want to track.
            </p>
            <div className="relative">
              <pre className="overflow-x-auto whitespace-pre-wrap break-all rounded-md bg-muted p-3 pr-12 font-mono text-xs" data-testid="text-tracking-snippet">{snippet}</pre>
              <Button size="icon" variant="ghost" className="!absolute top-1.5 right-1.5" onClick={copy} aria-label="Copy tracking code" data-testid="button-copy-tracking-snippet">
                <Copy className="h-4 w-4" />
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function DashboardView({ domainId, analytics, domains }: { domainId: number | null; analytics: Analytics | undefined; domains: DomainWithStats[] }) {
  const { data: online } = useQuery<{ count: number; visitors: any[] }>({
    queryKey: ["/api/click-guard/domains", domainId, "online"],
    enabled: !!domainId,
  });
  const domain = domains.find(d => d.id === domainId);

  const now = new Date();
  const daily = localDailyVisits(analytics?.hourlyVisits);
  const chartDays = Array.from({ length: 14 }, (_, i) => {
    const key = localDayKey(daysAgo(now, 13 - i));
    return [key, daily[key] || 0] as const;
  });
  const maxDaily = Math.max(...chartDays.map(([, v]) => v), 1);

  const todayVisits = daily[localDayKey(now)] || 0;
  const yesterdayVisits = daily[localDayKey(daysAgo(now, 1))] || 0;
  const last7 = chartDays.slice(-7).reduce((s, [, v]) => s + v, 0);
  const monthPrefix = localDayKey(now).slice(0, 7);
  const thisMonth = Object.entries(daily).filter(([k]) => k.startsWith(monthPrefix)).reduce((s, [, v]) => s + v, 0);
  // At the cap the oldest visits in the range were not loaded: the oldest loaded day is
  // partial and earlier days are unknown, not zero.
  const oldestLoaded = (analytics?.totalVisits ?? 0) >= VISIT_ROW_CAP ? Object.keys(daily).sort()[0] : undefined;
  const partialFrom = (firstDay: string) => !!oldestLoaded && firstDay <= oldestLoaded;
  const totalVisits = domain?.stats.totalVisits ?? 0;

  return (
    <div className="space-y-4 sm:space-y-5">
      {domain && <InstallCard key={domain.id} domain={domain} />}

      {online && online.count > 0 && (
        <div className="flex items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 dark:border-emerald-900/60 dark:bg-emerald-950/30" data-testid="banner-online">
          <div className="h-2.5 w-2.5 rounded-full bg-emerald-500 animate-pulse" />
          <span className="text-sm font-medium text-emerald-700 dark:text-emerald-300">
            {online.count} ongoing visit{online.count > 1 ? "s" : ""} right now
          </span>
        </div>
      )}

      <GoogleStatGrid cols={3}>
        <GoogleStat label="Online now" value={online?.count ?? 0} testId="card-stat-online-now" hint="Last 20 minutes" />
        <GoogleStat label="Today" value={countLabel(todayVisits, partialFrom(localDayKey(now)))} testId="card-stat-today" />
        <GoogleStat label="Yesterday" value={countLabel(yesterdayVisits, partialFrom(localDayKey(daysAgo(now, 1))))} testId="card-stat-yesterday" />
        <GoogleStat label="Last 7 days" value={countLabel(last7, partialFrom(chartDays[7][0]))} testId="card-stat-last-7-days" />
        <GoogleStat label="This month" value={countLabel(thisMonth, partialFrom(`${monthPrefix}-01`))} testId="card-stat-this-month" />
        <GoogleStat label="Total" value={countLabel(totalVisits, totalVisits >= VISIT_ROW_CAP)} testId="card-stat-total" hint="All time" />
      </GoogleStatGrid>

      {oldestLoaded && (
        <p className="text-xs text-muted-foreground" data-testid="text-visits-capped">
          Only the latest {VISIT_ROW_CAP.toLocaleString()} visits in this period are loaded, so counts marked + are lower bounds and days before {new Date(`${oldestLoaded}T00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" })} are not loaded.
        </p>
      )}

      {chartDays.some(([, v]) => v > 0) && (
        <Section title="Daily visits">
          <div className="flex items-end gap-1 h-32">
            {chartDays.map(([date, count]) => (
              <div key={date} className="flex-1 flex flex-col items-center gap-1">
                <div
                  className={`w-full rounded-t transition-colors min-h-[2px] ${oldestLoaded && date < oldestLoaded ? "bg-muted" : "bg-primary/80 hover:bg-primary"}`}
                  style={{ height: `${(count / maxDaily) * 100}%` }}
                  title={oldestLoaded && date < oldestLoaded ? `${date}: not loaded` : date === oldestLoaded ? `${date}: at least ${count} visits` : `${date}: ${count} visits`}
                />
                <span className="text-[8px] text-muted-foreground truncate w-full text-center">
                  {Number(date.slice(8, 10))}
                </span>
              </div>
            ))}
          </div>
        </Section>
      )}

      {domains.length > 0 && (
        <Section title="All projects" flush>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr className="hidden sm:table-row">
                  <th className="px-3 py-2 sm:px-4 sm:py-2.5 text-left text-xs font-medium text-muted-foreground whitespace-nowrap">Project</th>
                  <th className="px-3 py-2 sm:px-4 sm:py-2.5 text-right text-xs font-medium text-muted-foreground whitespace-nowrap">Online</th>
                  <th className="px-3 py-2 sm:px-4 sm:py-2.5 text-right text-xs font-medium text-muted-foreground whitespace-nowrap">Total</th>
                  <th className="px-3 py-2 sm:px-4 sm:py-2.5 text-right text-xs font-medium text-muted-foreground whitespace-nowrap">Unique</th>
                  <th className="px-3 py-2 sm:px-4 sm:py-2.5 text-right text-xs font-medium text-muted-foreground whitespace-nowrap">Blocked</th>
                </tr>
              </thead>
              <tbody>
                {domains.map(d => (
                  <tr key={d.id} className="border-t transition-colors hover:bg-muted/40 flex flex-col gap-1.5 px-3.5 py-3 sm:table-row sm:px-0 sm:py-0" data-testid={`row-domain-${d.id}`}>
                    <td className="block p-0 sm:table-cell sm:px-4 sm:py-3 sm:align-middle">
                      <div className="font-medium">{d.name || d.domain}</div>
                      <div className="text-xs text-muted-foreground break-all">{d.domain}</div>
                    </td>
                    <OnlineCell domainId={d.id} />
                    <td className="block p-0 sm:table-cell sm:px-4 sm:py-3 sm:align-middle sm:text-right sm:tabular-nums sm:font-medium">
                      <span className="sm:hidden text-muted-foreground">Total: </span>
                      {countLabel(d.stats.totalVisits, d.stats.totalVisits >= VISIT_ROW_CAP)}
                    </td>
                    <td className="block p-0 sm:table-cell sm:px-4 sm:py-3 sm:align-middle sm:text-right sm:tabular-nums">
                      <span className="sm:hidden text-muted-foreground">Unique: </span>
                      {countLabel(d.stats.uniqueVisitors, d.stats.totalVisits >= VISIT_ROW_CAP)}
                    </td>
                    <td className="block p-0 sm:table-cell sm:px-4 sm:py-3 sm:align-middle sm:text-right sm:tabular-nums">
                      <span className="sm:hidden text-muted-foreground">Blocked: </span>
                      {d.stats.blockedIps}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}
    </div>
  );
}

function VisitorListView({ domainId }: { domainId: number | null }) {
  const [ipSearch, setIpSearch] = useState("");
  const [expandedIp, setExpandedIp] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const perPage = 20;

  const { data: visitors = [], isLoading } = useQuery<Visitor[]>({
    queryKey: ["/api/click-guard/domains", domainId, "visitors"],
    enabled: !!domainId,
  });

  const { data: visitorDetail } = useQuery<VisitorDetail>({
    queryKey: ["/api/click-guard/domains", domainId, "visitors", expandedIp],
    enabled: !!domainId && !!expandedIp,
  });

  const filtered = ipSearch ? visitors.filter(v => v.ipAddress.includes(ipSearch)) : visitors;
  const totalPages = Math.ceil(filtered.length / perPage);
  const paginated = filtered.slice((page - 1) * perPage, page * perPage);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="g-search min-w-0 flex-1 max-w-sm" role="search">
          <Search aria-hidden="true" />
          <input
            type="search"
            placeholder="Search by IP address…"
            aria-label="Search by IP address"
            value={ipSearch}
            onChange={e => { setIpSearch(e.target.value); setPage(1); }}
            data-testid="input-ip-search"
          />
        </div>
        <span className="text-sm tabular-nums text-muted-foreground" data-testid="badge-visitor-count">
          {filtered.length} visitor{filtered.length !== 1 ? "s" : ""}
        </span>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12">
          <div className="animate-spin h-6 w-6 border-2 border-primary border-t-transparent rounded-full" />
        </div>
      ) : paginated.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border bg-card py-14 text-center">
          <Users className="h-5 w-5 text-muted-foreground" strokeWidth={1.6} />
          <p className="mt-3 text-sm text-muted-foreground">No visitors found</p>
        </div>
      ) : (
        <div className="space-y-2">
          {paginated.map(v => (
            <div
              key={v.ipAddress}
              className={`rounded-xl border bg-card transition-all ${expandedIp === v.ipAddress ? "ring-1 ring-primary/30" : ""}`}
              data-testid={`card-visitor-${v.ipAddress}`}
            >
              <div
                className="cursor-pointer p-4 hover:bg-muted/30 transition-colors"
                onClick={() => setExpandedIp(expandedIp === v.ipAddress ? null : v.ipAddress)}
              >
                <div className="flex items-center gap-3">
                  <div className={`h-2.5 w-2.5 rounded-full shrink-0 ${v.isOnline ? "bg-emerald-500 animate-pulse" : "bg-muted-foreground/30"}`} />
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-sm font-medium" data-testid={`text-ip-${v.ipAddress}`}>
                          {v.ipAddress}
                        </span>
                        {v.isSuspicious && (
                          <span className="inline-flex items-center gap-0.5 rounded-full border border-red-500/25 bg-red-500/10 px-2 py-0.5 text-[10px] font-medium text-red-700 dark:text-red-400">
                            <AlertTriangle className="h-2.5 w-2.5" /> Suspicious
                          </span>
                        )}
                        {v.isOnline && (
                          <span className="rounded-full border border-emerald-500/25 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-400">
                            Online
                          </span>
                        )}
                      </div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <Eye className="h-3 w-3" /> {v.visits} visit{v.visits !== 1 ? "s" : ""}
                        </span>
                        <span className="flex items-center gap-1">
                          <FileText className="h-3 w-3" /> {v.pageViews} page{v.pageViews !== 1 ? "s" : ""}
                        </span>
                        {(v.city || v.country) && (
                          <span className="flex items-center gap-1">
                            <MapPin className="h-3 w-3" /> {[v.city, v.country].filter(Boolean).join(", ")}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="hidden sm:flex items-center gap-3 text-xs text-muted-foreground shrink-0">
                    <span className="flex items-center gap-1.5">
                      <DeviceIcon type={v.lastDevice} />
                      <span>{v.lastBrowser || "Unknown"}</span>
                    </span>
                    <span>{formatTimeAgo(v.lastVisit)}</span>
                  </div>
                  <ChevronRight className={`h-4 w-4 text-muted-foreground shrink-0 transition-transform ${expandedIp === v.ipAddress ? "rotate-90" : ""}`} />
                </div>
              </div>

              {expandedIp === v.ipAddress && visitorDetail && (
                <div className="border-t bg-muted/20 p-4">
                  <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                    <div>
                      <h4 className="mb-3 text-xs font-semibold text-muted-foreground">System specs</h4>
                      <div className="space-y-2 text-sm">
                        <div className="flex justify-between gap-4"><span className="text-muted-foreground">Browser</span><span className="font-medium">{visitorDetail.systemSpecs.browser || "Unknown"}</span></div>
                        <div className="flex justify-between gap-4"><span className="text-muted-foreground">OS</span><span className="font-medium">{visitorDetail.systemSpecs.os || "Unknown"}</span></div>
                        <div className="flex justify-between gap-4"><span className="text-muted-foreground">Device</span><span className="font-medium">{visitorDetail.systemSpecs.deviceType || "Unknown"}</span></div>
                        <div className="flex justify-between gap-4"><span className="text-muted-foreground">Resolution</span><span className="font-medium">{visitorDetail.systemSpecs.screenResolution || "Unknown"}</span></div>
                        <div className="flex justify-between gap-4"><span className="text-muted-foreground">Language</span><span className="font-medium">{visitorDetail.systemSpecs.language || "Unknown"}</span></div>
                        <div className="flex justify-between gap-4"><span className="text-muted-foreground">Timezone</span><span className="font-medium">{visitorDetail.systemSpecs.timezone || "Unknown"}</span></div>
                      </div>

                      <h4 className="mb-3 mt-6 text-xs font-semibold text-muted-foreground">Identity</h4>
                      <div className="space-y-2 text-sm">
                        <div className="flex justify-between gap-4"><span className="text-muted-foreground">IP address</span><span className="font-mono font-medium">{visitorDetail.ipAddress}</span></div>
                        <div className="flex justify-between gap-4"><span className="text-muted-foreground">Computer ID</span><span className="max-w-[200px] truncate font-mono text-xs">{visitorDetail.fingerprint || "N/A"}</span></div>
                        <div className="flex justify-between gap-4"><span className="text-muted-foreground">First visit</span><span>{formatDate(visitorDetail.firstVisit)}</span></div>
                        <div className="flex justify-between gap-4"><span className="text-muted-foreground">Last visit</span><span>{formatDate(visitorDetail.lastVisit)}</span></div>
                        <div className="flex justify-between gap-4"><span className="text-muted-foreground">Total visits</span><span className="font-semibold">{visitorDetail.totalVisits}</span></div>
                      </div>

                      {visitorDetail.geo.country && (
                        <>
                          <h4 className="mb-3 mt-6 text-xs font-semibold text-muted-foreground">Geolocation</h4>
                          <div className="space-y-2 text-sm">
                            <div className="flex justify-between gap-4"><span className="text-muted-foreground">City</span><span>{visitorDetail.geo.city || "Unknown"}</span></div>
                            <div className="flex justify-between gap-4"><span className="text-muted-foreground">Country</span><span>{visitorDetail.geo.country || "Unknown"}</span></div>
                          </div>
                        </>
                      )}
                    </div>

                    <div>
                      <h4 className="mb-3 text-xs font-semibold text-muted-foreground">Recent activity</h4>
                      <div className="max-h-64 space-y-2 overflow-y-auto">
                        {visitorDetail.recentActivity.map(a => (
                          <div key={a.id} className="rounded-lg border bg-card p-3 text-xs" data-testid={`activity-${a.id}`}>
                            <div className="mb-1 flex items-center justify-between">
                              <span className="text-muted-foreground">{formatDate(a.visitedAt)}</span>
                              {a.isSuspicious && <span className="rounded-full border border-red-500/25 bg-red-500/10 px-1.5 py-0 text-[9px] font-medium text-red-700 dark:text-red-400">Suspicious</span>}
                            </div>
                            <div className="text-muted-foreground">
                              <span className="font-medium">From:</span> {a.referrer || "NO REFERRER DATA"}
                            </div>
                            <div className="mt-0.5 text-muted-foreground">
                              <span className="font-medium">Landed:</span>{" "}
                              <span className="break-all text-primary">{a.landingPage || "Unknown"}</span>
                            </div>
                          </div>
                        ))}
                        {visitorDetail.recentActivity.length === 0 && (
                          <p className="text-sm text-muted-foreground">No activity recorded</p>
                        )}
                      </div>

                      {visitorDetail.systemSpecs.userAgent && (
                        <>
                          <h4 className="mb-2 mt-6 text-xs font-semibold text-muted-foreground">User agent</h4>
                          <p className="rounded bg-muted p-2 font-mono text-[11px] text-muted-foreground break-all">
                            {visitorDetail.systemSpecs.userAgent}
                          </p>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
          <span className="text-xs text-muted-foreground">
            Showing {(page - 1) * perPage + 1}-{Math.min(page * perPage, filtered.length)} of {filtered.length}
          </span>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)} data-testid="button-prev-page">Prev</Button>
            <span className="text-sm tabular-nums text-muted-foreground">Page {page} / {totalPages}</span>
            <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)} data-testid="button-next-page">Next</Button>
          </div>
        </div>
      )}
    </div>
  );
}

function TrafficSourcesView({ domainId, analytics, since }: { domainId: number | null; analytics: Analytics | undefined; since: Date }) {
  const sources = analytics?.trafficSources || [];
  const totalLoads = sources.reduce((s, t) => s + t.pageLoads, 0);
  const totalVisitors = sources.reduce((s, t) => s + t.visitors, 0);

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground" data-testid="text-traffic-range">
        {(analytics?.totalVisits ?? 0) >= VISIT_ROW_CAP ? `Latest ${VISIT_ROW_CAP.toLocaleString()} visits` : "Visits"} since {since.toLocaleDateString("en-US", { month: "short", day: "numeric" })}.
      </p>
      <GoogleStatGrid cols={3}>
        <GoogleStat label="Total sources" value={sources.length} testId="card-stat-total-sources" />
        <GoogleStat label="Total page loads" value={totalLoads.toLocaleString()} testId="card-stat-total-page-loads" />
        <GoogleStat label="Unique visitors" value={totalVisitors.toLocaleString()} testId="card-stat-unique-visitors" />
      </GoogleStatGrid>

      <Section flush title="Traffic sources by domain">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr className="hidden sm:table-row">
                <th className="px-3 py-2 sm:px-4 sm:py-2.5 text-left text-xs font-medium text-muted-foreground whitespace-nowrap">Source</th>
                <th className="px-3 py-2 sm:px-4 sm:py-2.5 text-right text-xs font-medium text-muted-foreground whitespace-nowrap">Page loads</th>
                <th className="px-3 py-2 sm:px-4 sm:py-2.5 text-right text-xs font-medium text-muted-foreground whitespace-nowrap">Visitors</th>
                <th className="px-3 py-2 sm:px-4 sm:py-2.5 text-left text-xs font-medium text-muted-foreground whitespace-nowrap w-48">Share</th>
              </tr>
            </thead>
            <tbody>
              {sources.length === 0 ? (
                <tr><td colSpan={4} className="p-6 text-center text-muted-foreground">No traffic source data available</td></tr>
              ) : (
                sources.map((s, i) => (
                  <tr key={i} className="border-t transition-colors hover:bg-muted/40 flex flex-col gap-1.5 px-3.5 py-3 sm:table-row sm:px-0 sm:py-0" data-testid={`row-source-${i}`}>
                    <td className="block p-0 sm:table-cell sm:px-4 sm:py-3 sm:align-middle">
                      <span className={`break-all ${s.domain === "NO REFERRER DATA" ? "italic text-muted-foreground" : "font-medium"}`}>
                        {s.domain}
                      </span>
                      <span className="sm:hidden text-xs text-muted-foreground"> · {s.percentage.toFixed(1)}%</span>
                    </td>
                    <td className="block p-0 sm:table-cell sm:px-4 sm:py-3 sm:align-middle sm:text-right sm:tabular-nums">
                      <span className="sm:hidden text-muted-foreground">Page loads: </span>
                      {s.pageLoads.toLocaleString()}
                    </td>
                    <td className="block p-0 sm:table-cell sm:px-4 sm:py-3 sm:align-middle sm:text-right sm:tabular-nums">
                      <span className="sm:hidden text-muted-foreground">Visitors: </span>
                      {s.visitors.toLocaleString()}
                    </td>
                    <td className="block p-0 sm:table-cell sm:px-4 sm:py-3 sm:align-middle sm:w-48">
                      <div className="flex items-center gap-2">
                        <span className="w-14 text-xs tabular-nums text-muted-foreground">{s.percentage.toFixed(1)}%</span>
                        <PercentBar value={s.percentage} />
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Section>
    </div>
  );
}

function PagesView({ domainId }: { domainId: number | null }) {
  const { data: pages = [], isLoading } = useQuery<PageStat[]>({
    queryKey: ["/api/click-guard/domains", domainId, "pages"],
    enabled: !!domainId,
  });

  return (
    <div className="space-y-4">
      <GoogleStatGrid cols={2}>
        <GoogleStat label="Total pages" value={pages.length} testId="card-stat-total-pages" />
        <GoogleStat label="Total hits" value={pages.reduce((s, p) => s + p.hits, 0).toLocaleString()} testId="card-stat-total-hits" />
      </GoogleStatGrid>

      <Section flush title="Pages">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr className="hidden sm:table-row">
                <th className="px-3 py-2 sm:px-4 sm:py-2.5 text-left text-xs font-medium text-muted-foreground whitespace-nowrap">Page URL</th>
                <th className="px-3 py-2 sm:px-4 sm:py-2.5 text-right text-xs font-medium text-muted-foreground whitespace-nowrap">Hits</th>
                <th className="px-3 py-2 sm:px-4 sm:py-2.5 text-right text-xs font-medium text-muted-foreground whitespace-nowrap">Unique visitors</th>
                <th className="px-3 py-2 sm:px-4 sm:py-2.5 text-left text-xs font-medium text-muted-foreground whitespace-nowrap w-32">Share</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={4} className="p-6 text-center"><div className="animate-spin h-5 w-5 border-2 border-primary border-t-transparent rounded-full mx-auto" /></td></tr>
              ) : pages.length === 0 ? (
                <tr><td colSpan={4} className="p-6 text-center text-muted-foreground">No page data available</td></tr>
              ) : (
                pages.map((p, i) => {
                  const totalHits = pages.reduce((s, x) => s + x.hits, 0);
                  const pct = totalHits ? (p.hits / totalHits) * 100 : 0;
                  return (
                    <tr key={i} className="border-t transition-colors hover:bg-muted/40 flex flex-col gap-1.5 px-3.5 py-3 sm:table-row sm:px-0 sm:py-0" data-testid={`row-page-${i}`}>
                      <td className="block p-0 sm:table-cell sm:px-4 sm:py-3 sm:align-middle sm:max-w-xs">
                        <span className="break-all text-xs text-primary">{p.url}</span>
                      </td>
                      <td className="block p-0 sm:table-cell sm:px-4 sm:py-3 sm:align-middle sm:text-right sm:tabular-nums sm:font-medium">
                        <span className="sm:hidden text-muted-foreground">Hits: </span>
                        {p.hits.toLocaleString()}
                      </td>
                      <td className="block p-0 sm:table-cell sm:px-4 sm:py-3 sm:align-middle sm:text-right sm:tabular-nums">
                        <span className="sm:hidden text-muted-foreground">Unique: </span>
                        {p.uniqueVisitors.toLocaleString()}
                      </td>
                      <td className="block p-0 sm:table-cell sm:px-4 sm:py-3 sm:align-middle sm:w-32">
                        <PercentBar value={pct} />
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </Section>
    </div>
  );
}

function GeoView({ domainId }: { domainId: number | null }) {
  const [subTab, setSubTab] = useState<"countries" | "cities">("countries");
  const { data: geo, isLoading } = useQuery<GeoData>({
    queryKey: ["/api/click-guard/domains", domainId, "geo"],
    enabled: !!domainId,
  });

  const items = subTab === "countries" ? geo?.countries || [] : geo?.cities || [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant={subTab === "countries" ? "default" : "outline"} onClick={() => setSubTab("countries")} data-testid="button-geo-countries">Countries</Button>
        <Button size="sm" variant={subTab === "cities" ? "default" : "outline"} onClick={() => setSubTab("cities")} data-testid="button-geo-cities">Cities</Button>
      </div>
      <p className="text-xs text-muted-foreground" data-testid="text-geo-source-note">Country/city come from Cloudflare on visits recorded after this update; older visits show Unknown.</p>

      <Section flush title={subTab === "countries" ? "Countries" : "Cities"}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr className="hidden sm:table-row">
                <th className="px-3 py-2 sm:px-4 sm:py-2.5 text-left text-xs font-medium text-muted-foreground whitespace-nowrap">Location</th>
                <th className="px-3 py-2 sm:px-4 sm:py-2.5 text-right text-xs font-medium text-muted-foreground whitespace-nowrap">Visits</th>
                <th className="px-3 py-2 sm:px-4 sm:py-2.5 text-right text-xs font-medium text-muted-foreground whitespace-nowrap">Visitors</th>
                <th className="px-3 py-2 sm:px-4 sm:py-2.5 text-left text-xs font-medium text-muted-foreground whitespace-nowrap w-32">Share</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={4} className="p-6 text-center"><div className="animate-spin h-5 w-5 border-2 border-primary border-t-transparent rounded-full mx-auto" /></td></tr>
              ) : items.length === 0 ? (
                <tr><td colSpan={4} className="p-6 text-center text-muted-foreground">No geographic data available</td></tr>
              ) : (
                items.map((item: any, i: number) => (
                  <tr key={i} className="border-t transition-colors hover:bg-muted/40 flex flex-col gap-1.5 px-3.5 py-3 sm:table-row sm:px-0 sm:py-0" data-testid={`row-geo-${i}`}>
                    <td className="block p-0 sm:table-cell sm:px-4 sm:py-3 sm:align-middle sm:font-medium">
                      <span className="flex items-center gap-2">
                        <MapPin className="h-3.5 w-3.5 text-muted-foreground" />
                        {item.name}
                      </span>
                    </td>
                    <td className="block p-0 sm:table-cell sm:px-4 sm:py-3 sm:align-middle sm:text-right sm:tabular-nums sm:font-medium">
                      <span className="sm:hidden text-muted-foreground">Visits: </span>
                      {item.count.toLocaleString()}
                    </td>
                    <td className="block p-0 sm:table-cell sm:px-4 sm:py-3 sm:align-middle sm:text-right sm:tabular-nums">
                      <span className="sm:hidden text-muted-foreground">Visitors: </span>
                      {item.visitors.toLocaleString()}
                    </td>
                    <td className="block p-0 sm:table-cell sm:px-4 sm:py-3 sm:align-middle sm:w-32">
                      <div className="flex items-center gap-2">
                        <PercentBar value={parseFloat(item.percentage)} />
                        <span className="w-10 text-xs tabular-nums text-muted-foreground">{item.percentage}%</span>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Section>
    </div>
  );
}

function PlatformsView({ domainId }: { domainId: number | null }) {
  const { data: platforms, isLoading } = useQuery<PlatformData>({
    queryKey: ["/api/click-guard/domains", domainId, "platforms"],
    enabled: !!domainId,
  });

  const renderBreakdown = (title: string, icon: any, data: Record<string, number> | undefined) => {
    if (!data) return null;
    const entries = Object.entries(data).sort((a, b) => b[1] - a[1]);
    const total = entries.reduce((s, [, v]) => s + v, 0);
    const Icon = icon;
    return (
      <Section title={title}>
        <div className="space-y-2">
          {entries.length === 0 ? (
            <p className="text-sm text-muted-foreground">No data</p>
          ) : (
            entries.map(([name, count]) => {
              const pct = total ? (count / total) * 100 : 0;
              return (
                <div key={name} className="space-y-1">
                  <div className="flex items-center justify-between text-sm">
                    <span className="flex items-center gap-2 min-w-0">
                      <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      <span className="truncate">{name}</span>
                    </span>
                    <span className="tabular-nums text-muted-foreground">{count} ({pct.toFixed(1)}%)</span>
                  </div>
                  <PercentBar value={pct} />
                </div>
              );
            })
          )}
        </div>
      </Section>
    );
  };

  if (isLoading) {
    return <div className="flex justify-center py-12"><div className="animate-spin h-6 w-6 border-2 border-primary border-t-transparent rounded-full" /></div>;
  }

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 sm:gap-5">
      {renderBreakdown("Browsers", Chrome, platforms?.browsers)}
      {renderBreakdown("Operating systems", Laptop, platforms?.oses)}
      {renderBreakdown("Devices", Monitor, platforms?.devices)}
      {renderBreakdown("Screen resolutions", Monitor, platforms?.resolutions)}
    </div>
  );
}

export default function IpTrackerPage() {
  const { params, set: setUrlParam } = useUrlState();
  const tabParam = params.get("tab");
  const activeTab: TabId = tabs.some(t => t.id === tabParam) ? (tabParam as TabId) : "dashboard";
  const setActiveTab = (tab: TabId) => setUrlParam("tab", tab === "dashboard" ? null : tab);
  const selectedDomainId = Number(params.get("site")) || null;
  const setSelectedDomainId = (id: number | null) => setUrlParam("site", id ? String(id) : null);
  const [showAddDomain, setShowAddDomain] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [newDomain, setNewDomain] = useState("");
  const [newDomainName, setNewDomainName] = useState("");
  const { toast } = useToast();

  const { data: domains = [], isLoading: domainsLoading } = useQuery<DomainWithStats[]>({
    queryKey: ["/api/click-guard/domains"],
  });

  // A stale or removed ?site= falls back to the first site rather than an id that no longer exists.
  const selectedDomain = domains.find(d => d.id === selectedDomainId) ?? domains[0];
  const domainId = selectedDomain?.id ?? null;

  const since = dashboardSince();
  const sinceIso = since.toISOString();
  const { data: analytics } = useQuery<Analytics>({
    queryKey: ["/api/click-guard/domains", domainId, "analytics", sinceIso],
    queryFn: async () => (await apiRequest("GET", `/api/click-guard/domains/${domainId}/analytics?start=${encodeURIComponent(sinceIso)}`)).json(),
    enabled: !!domainId,
  });

  const addDomainMutation = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/click-guard/domains", { domain: newDomain.trim(), name: newDomainName.trim() || undefined })).json(),
    onSuccess: (created: DomainWithStats) => {
      queryClient.invalidateQueries({ queryKey: ["/api/click-guard/domains"], exact: true });
      queryClient.invalidateQueries({ queryKey: ["/api/vpn-shield/domains"], exact: true });
      setNewDomain("");
      setNewDomainName("");
      setShowAddDomain(false);
      if (created?.id) setSelectedDomainId(created.id);
      setActiveTab("dashboard");
      toast({ title: "Site added", description: "Install the tracking code below to start collecting visits." });
    },
    onError: (err: any) => {
      toast({ title: "Could not add site", description: apiErrorMessage(err, "Failed to add site"), variant: "destructive" });
    },
  });

  const removeDomainMutation = useMutation({
    mutationFn: async (id: number) => (await apiRequest("DELETE", `/api/click-guard/domains/${id}`)).json(),
    onSuccess: (_res, id) => {
      setSelectedDomainId(null);
      // Drop the site now and refresh only the lists: the removed site's own queries would 404.
      queryClient.setQueryData<DomainWithStats[]>(["/api/click-guard/domains"], old => old?.filter(d => d.id !== id));
      queryClient.removeQueries({ queryKey: ["/api/click-guard/domains", id] });
      queryClient.invalidateQueries({ queryKey: ["/api/click-guard/domains"], exact: true });
      queryClient.invalidateQueries({ queryKey: ["/api/vpn-shield/domains"], exact: true });
      toast({ title: "Site removed" });
    },
    onError: (err: any) => {
      toast({ title: "Could not remove site", description: apiErrorMessage(err, "Failed to remove site"), variant: "destructive" });
    },
  });

  return (
    <AppPage width="wide" testId="page-ip-tracker">
      {/* Google's page format (owner, 2026-10-07): a quiet header, hairline cards, pill actions, stat tiles. */}
      <GoogleSectionHeader
        as="h1"
        titleTestId="text-page-title"
        title="IP Tracker"
        description={<>
          <span data-testid="text-subtitle">Real-time website visitor tracking. See who visits your site, where they come from, and what they do.</span>
          {selectedDomain && <>{" "}<StatusPill tone="neutral" data-testid="badge-ip-tracker">{selectedDomain.name || selectedDomain.domain}</StatusPill></>}
        </>}
        flush
        actions={
          domains.length > 0 ? (
            <>
              <label className="block min-w-0 flex-1 space-y-1.5 text-sm sm:w-52 sm:flex-none">
                <span className="text-muted-foreground sm:hidden">Site</span>
                <select
                  className="h-10 w-full rounded-full border bg-background px-4 text-sm"
                  value={domainId || ""}
                  onChange={(e) => setSelectedDomainId(Number(e.target.value))}
                  aria-label="Site"
                  data-testid="select-domain"
                >
                  {domains.map(d => (
                    <option key={d.id} value={d.id}>{d.name || d.domain}</option>
                  ))}
                </select>
              </label>
              <div className="flex flex-1 gap-2 sm:flex-none">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button size="icon" variant="outline" aria-label="Site actions" data-testid="button-site-actions">
                      <MoreHorizontal className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem
                      className="text-destructive focus:text-destructive"
                      onSelect={() => setConfirmRemove(true)}
                      data-testid="button-remove-domain"
                    >
                      <Trash2 className="mr-2 h-4 w-4" /> Remove site
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
                <GooglePill
                  icon={Plus}
                  variant="solid"
                  label="Add site"
                  className="flex-1 sm:flex-none"
                  onClick={() => setShowAddDomain(o => !o)}
                  testId="button-add-domain"
                />
              </div>
            </>
          ) : undefined
        }
      />

      <AlertDialog open={confirmRemove} onOpenChange={setConfirmRemove}>
        <AlertDialogContent data-testid="dialog-remove-domain">
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {selectedDomain?.name || selectedDomain?.domain || "this site"}?</AlertDialogTitle>
            <AlertDialogDescription>
              This stops tracking {selectedDomain?.domain ?? "this site"} in IP Tracker, Click Guard and VPN Shield, and permanently deletes its recorded visits and blocked IPs. Remove the tracking code from your site as well. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-remove-domain">Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => { if (domainId) removeDomainMutation.mutate(domainId); }}
              data-testid="button-confirm-remove-domain"
            >
              Remove site
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {showAddDomain && (
        <div className="rounded-xl border bg-card text-card-foreground" data-testid="card-add-domain">
          <div className="space-y-3 p-4 sm:p-5">
            <h2 className="g-card__title g-card__title--md">Add a site</h2>
            <div className="flex flex-col gap-3 sm:flex-row">
              <Input
                placeholder="example.com"
                value={newDomain}
                onChange={(e) => setNewDomain(e.target.value)}
                data-testid="input-domain"
              />
              <Input
                placeholder="Display name (optional)"
                value={newDomainName}
                onChange={(e) => setNewDomainName(e.target.value)}
                data-testid="input-domain-name"
              />
            </div>
            <div className="flex gap-2">
              <GooglePill
                variant="solid"
                label={addDomainMutation.isPending ? "Adding…" : "Add"}
                onClick={() => addDomainMutation.mutate()}
                disabled={!newDomain.trim() || addDomainMutation.isPending}
                testId="button-save-domain"
              />
              <GooglePill
                variant="quiet"
                label="Cancel"
                onClick={() => setShowAddDomain(false)}
                testId="button-cancel-domain"
              />
            </div>
          </div>
        </div>
      )}

      <ToolTabs as="tablist" label="IP tracker sections">
        {tabs.map(tab => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            role="tab"
            aria-selected={activeTab === tab.id}
            data-testid={`tab-${tab.id}`}
          >
            {tab.label}
          </button>
        ))}
      </ToolTabs>

      {domainsLoading ? (
        <div className="flex justify-center py-12"><div className="animate-spin h-6 w-6 border-2 border-primary border-t-transparent rounded-full" /></div>
      ) : !domainId && !showAddDomain ? (
        <div className="flex flex-col items-center justify-center rounded-xl border bg-card py-14 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <Fingerprint className="h-5 w-5" strokeWidth={1.6} />
          </div>
          <h2 className="mt-3 g-card__title g-card__title--md">No sites being tracked</h2>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
            Add your first website to start tracking visitors in real time. You'll get a tracking code to embed on your site.
          </p>
          <GooglePill icon={Plus} variant="solid" className="mt-4" label="Add your first site" onClick={() => setShowAddDomain(true)} testId="button-add-first-domain" />
        </div>
      ) : (
        <>
          {activeTab === "dashboard" && <DashboardView domainId={domainId} analytics={analytics} domains={domains} />}
          {activeTab === "visitors" && <VisitorListView domainId={domainId} />}
          {activeTab === "traffic" && <TrafficSourcesView domainId={domainId} analytics={analytics} since={since} />}
          {activeTab === "pages" && <PagesView domainId={domainId} />}
          {activeTab === "geo" && <GeoView domainId={domainId} />}
          {activeTab === "platforms" && <PlatformsView domainId={domainId} />}
        </>
      )}
    </AppPage>
  );
}
