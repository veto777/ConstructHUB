import { useState } from "react";
import { useLocation, useSearch } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiErrorMessage, apiRequest, queryClient } from "@/lib/queryClient";
import { useAppOrigin } from "@/lib/app-origin";
import {
  Fingerprint, Globe, Eye, Users, Monitor, Smartphone, Tablet,
  Search, ChevronRight, ChevronDown, Activity, MapPin,
  FileText, BarChart3, Plus, Copy, Trash2, Ban,
  Clock, ArrowRight, ExternalLink, Shield, AlertTriangle,
  Laptop, Chrome, X,
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
  { id: "dashboard", label: "Dashboard", icon: BarChart3 },
  { id: "visitors", label: "Visitor List", icon: Users },
  { id: "traffic", label: "Traffic Sources", icon: Globe },
  { id: "pages", label: "Pages", icon: FileText },
  { id: "geo", label: "Geo", icon: MapPin },
  { id: "platforms", label: "Platforms", icon: Monitor },
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

function PercentBar({ value, color = "bg-primary" }: { value: number; color?: string }) {
  return (
    <div className="w-full bg-muted rounded-full h-2">
      <div className={`${color} h-2 rounded-full transition-all`} style={{ width: `${Math.min(value, 100)}%` }} />
    </div>
  );
}

function StatCard({ label, value, icon: Icon, sub }: { label: string; value: string | number; icon: any; sub?: string }) {
  return (
    <Card className="bg-card border-border" data-testid={`card-stat-${label.toLowerCase().replace(/\s+/g, "-")}`}>
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-medium text-muted-foreground">{label}</span>
          <Icon className="h-4 w-4 text-muted-foreground" />
        </div>
        <div className="text-2xl font-bold text-foreground tabular-nums">{value}</div>
        {sub && <p className="text-[10px] text-muted-foreground mt-1">{sub}</p>}
      </CardContent>
    </Card>
  );
}

function OnlineCell({ domainId }: { domainId: number }) {
  const { data, isError } = useQuery<{ count: number }>({
    queryKey: ["/api/click-guard/domains", domainId, "online"],
  });
  return (
    <td className="text-right p-3 tabular-nums" data-testid={`text-online-${domainId}`} title="Distinct IPs in the last 20 minutes">
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
    <Card className={`bg-card ${noVisits ? "border-blue-500/40" : "border-border"}`} data-testid="card-install-tracking">
      <CardContent className="p-4 space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-foreground">Tracking code for {domain.domain}</h3>
            <p className="text-xs text-muted-foreground mt-0.5" data-testid="text-install-status">
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
              Add this tag to the <code className="bg-muted px-1 py-0.5 rounded text-foreground">&lt;head&gt;</code> or just before the closing <code className="bg-muted px-1 py-0.5 rounded text-foreground">&lt;/body&gt;</code> tag of every page you want to track.
            </p>
            <div className="relative">
              <pre className="bg-muted rounded-md p-3 pr-12 text-xs font-mono text-foreground overflow-x-auto whitespace-pre-wrap break-all" data-testid="text-tracking-snippet">{snippet}</pre>
              <Button size="icon" variant="ghost" className="absolute top-1.5 right-1.5" onClick={copy} aria-label="Copy tracking code" data-testid="button-copy-tracking-snippet">
                <Copy className="h-4 w-4" />
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
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
    <div className="space-y-6">
      {domain && <InstallCard key={domain.id} domain={domain} />}

      {online && online.count > 0 && (
        <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-lg p-3 flex items-center gap-3" data-testid="banner-online">
          <div className="h-2.5 w-2.5 rounded-full bg-emerald-500 animate-pulse" />
          <span className="text-sm font-medium text-emerald-600 dark:text-emerald-400">
            {online.count} ongoing visit{online.count > 1 ? "s" : ""} right now
          </span>
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 sm:gap-3">
        <StatCard label="Online Now" value={online?.count ?? 0} icon={Activity} sub="Last 20 minutes" />
        <StatCard label="Today" value={countLabel(todayVisits, partialFrom(localDayKey(now)))} icon={Eye} />
        <StatCard label="Yesterday" value={countLabel(yesterdayVisits, partialFrom(localDayKey(daysAgo(now, 1))))} icon={Clock} />
        <StatCard label="Last 7 Days" value={countLabel(last7, partialFrom(chartDays[7][0]))} icon={BarChart3} />
        <StatCard label="This Month" value={countLabel(thisMonth, partialFrom(`${monthPrefix}-01`))} icon={Globe} />
        <StatCard label="Total" value={countLabel(totalVisits, totalVisits >= VISIT_ROW_CAP)} icon={Users} sub="All time" />
      </div>

      {oldestLoaded && (
        <p className="text-xs text-muted-foreground -mt-3" data-testid="text-visits-capped">
          Only the latest {VISIT_ROW_CAP.toLocaleString()} visits in this period are loaded, so counts marked + are lower bounds and days before {new Date(`${oldestLoaded}T00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" })} are not loaded.
        </p>
      )}

      {chartDays.some(([, v]) => v > 0) && (
        <Card className="bg-card border-border">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">Daily Visits</CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0">
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
          </CardContent>
        </Card>
      )}

      {domains.length > 0 && (
        <Card className="bg-card border-border">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">All Projects</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left p-3 text-xs font-medium text-muted-foreground">Project</th>
                    <th className="text-right p-3 text-xs font-medium text-muted-foreground">Online</th>
                    <th className="text-right p-3 text-xs font-medium text-muted-foreground">Total</th>
                    <th className="text-right p-3 text-xs font-medium text-muted-foreground">Unique</th>
                    <th className="text-right p-3 text-xs font-medium text-muted-foreground">Blocked</th>
                  </tr>
                </thead>
                <tbody>
                  {domains.map(d => (
                    <tr key={d.id} className="border-b border-border/50 hover:bg-muted/50 transition-colors" data-testid={`row-domain-${d.id}`}>
                      <td className="p-3">
                        <div className="font-medium text-foreground">{d.name || d.domain}</div>
                        <div className="text-xs text-muted-foreground">{d.domain}</div>
                      </td>
                      <OnlineCell domainId={d.id} />
                      <td className="text-right p-3 tabular-nums font-medium">{countLabel(d.stats.totalVisits, d.stats.totalVisits >= VISIT_ROW_CAP)}</td>
                      <td className="text-right p-3 tabular-nums">{countLabel(d.stats.uniqueVisitors, d.stats.totalVisits >= VISIT_ROW_CAP)}</td>
                      <td className="text-right p-3 tabular-nums">{d.stats.blockedIps}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
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
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by IP address..."
            value={ipSearch}
            onChange={e => { setIpSearch(e.target.value); setPage(1); }}
            className="pl-9"
            data-testid="input-ip-search"
          />
        </div>
        <Badge variant="outline" className="text-muted-foreground" data-testid="badge-visitor-count">
          {filtered.length} visitor{filtered.length !== 1 ? "s" : ""}
        </Badge>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12">
          <div className="animate-spin h-6 w-6 border-2 border-primary border-t-transparent rounded-full" />
        </div>
      ) : paginated.length === 0 ? (
        <Card className="bg-card border-border p-8 text-center">
          <Users className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
          <p className="text-muted-foreground text-sm">No visitors found</p>
        </Card>
      ) : (
        <div className="space-y-2">
          {paginated.map(v => (
            <Card
              key={v.ipAddress}
              className={`bg-card border-border transition-all ${expandedIp === v.ipAddress ? "ring-1 ring-primary/30" : ""}`}
              data-testid={`card-visitor-${v.ipAddress}`}
            >
              <div
                className="p-4 cursor-pointer hover:bg-muted/30 transition-colors"
                onClick={() => setExpandedIp(expandedIp === v.ipAddress ? null : v.ipAddress)}
              >
                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <div className={`h-2.5 w-2.5 rounded-full shrink-0 ${v.isOnline ? "bg-emerald-500 animate-pulse" : "bg-muted-foreground/30"}`} />
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-sm font-medium text-foreground" data-testid={`text-ip-${v.ipAddress}`}>
                          {v.ipAddress}
                        </span>
                        {v.isSuspicious && (
                          <Badge className="bg-red-500/10 text-red-500 border-red-500/20 text-[10px] px-1.5 py-0">
                            <AlertTriangle className="h-2.5 w-2.5 mr-0.5" /> Suspicious
                          </Badge>
                        )}
                        {v.isOnline && (
                          <Badge className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20 text-[10px] px-1.5 py-0">
                            Online
                          </Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-3 text-xs text-muted-foreground mt-0.5">
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
                  <div className="hidden sm:flex items-center gap-4 text-xs text-muted-foreground shrink-0">
                    <div className="flex items-center gap-1.5">
                      <DeviceIcon type={v.lastDevice} />
                      <span>{v.lastBrowser || "Unknown"}</span>
                    </div>
                    <span>{formatTimeAgo(v.lastVisit)}</span>
                  </div>
                  <ChevronRight className={`h-4 w-4 text-muted-foreground shrink-0 transition-transform ${expandedIp === v.ipAddress ? "rotate-90" : ""}`} />
                </div>
              </div>

              {expandedIp === v.ipAddress && visitorDetail && (
                <div className="border-t border-border p-4 bg-muted/20">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                      <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">System Specs</h4>
                      <div className="space-y-2 text-sm">
                        <div className="flex justify-between"><span className="text-muted-foreground">Browser</span><span className="font-medium text-foreground">{visitorDetail.systemSpecs.browser || "Unknown"}</span></div>
                        <div className="flex justify-between"><span className="text-muted-foreground">OS</span><span className="font-medium text-foreground">{visitorDetail.systemSpecs.os || "Unknown"}</span></div>
                        <div className="flex justify-between"><span className="text-muted-foreground">Device</span><span className="font-medium text-foreground">{visitorDetail.systemSpecs.deviceType || "Unknown"}</span></div>
                        <div className="flex justify-between"><span className="text-muted-foreground">Resolution</span><span className="font-medium text-foreground">{visitorDetail.systemSpecs.screenResolution || "Unknown"}</span></div>
                        <div className="flex justify-between"><span className="text-muted-foreground">Language</span><span className="font-medium text-foreground">{visitorDetail.systemSpecs.language || "Unknown"}</span></div>
                        <div className="flex justify-between"><span className="text-muted-foreground">Timezone</span><span className="font-medium text-foreground">{visitorDetail.systemSpecs.timezone || "Unknown"}</span></div>
                      </div>

                      <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3 mt-6">Identity</h4>
                      <div className="space-y-2 text-sm">
                        <div className="flex justify-between"><span className="text-muted-foreground">IP Address</span><span className="font-mono font-medium text-foreground">{visitorDetail.ipAddress}</span></div>
                        <div className="flex justify-between"><span className="text-muted-foreground">Computer ID</span><span className="font-mono text-xs text-foreground truncate max-w-[200px]">{visitorDetail.fingerprint || "N/A"}</span></div>
                        <div className="flex justify-between"><span className="text-muted-foreground">First Visit</span><span className="text-foreground">{formatDate(visitorDetail.firstVisit)}</span></div>
                        <div className="flex justify-between"><span className="text-muted-foreground">Last Visit</span><span className="text-foreground">{formatDate(visitorDetail.lastVisit)}</span></div>
                        <div className="flex justify-between"><span className="text-muted-foreground">Total Visits</span><span className="font-bold text-foreground">{visitorDetail.totalVisits}</span></div>
                      </div>

                      {visitorDetail.geo.country && (
                        <>
                          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3 mt-6">Geolocation</h4>
                          <div className="space-y-2 text-sm">
                            <div className="flex justify-between"><span className="text-muted-foreground">City</span><span className="text-foreground">{visitorDetail.geo.city || "Unknown"}</span></div>
                            <div className="flex justify-between"><span className="text-muted-foreground">Country</span><span className="text-foreground">{visitorDetail.geo.country || "Unknown"}</span></div>
                          </div>
                        </>
                      )}
                    </div>

                    <div>
                      <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Recent Activity</h4>
                      <div className="space-y-2 max-h-64 overflow-y-auto">
                        {visitorDetail.recentActivity.map(a => (
                          <div key={a.id} className="border border-border rounded-lg p-3 text-xs bg-card" data-testid={`activity-${a.id}`}>
                            <div className="flex items-center justify-between mb-1">
                              <span className="text-muted-foreground">{formatDate(a.visitedAt)}</span>
                              {a.isSuspicious && <Badge className="bg-red-500/10 text-red-500 border-red-500/20 text-[9px] px-1 py-0">Suspicious</Badge>}
                            </div>
                            <div className="text-muted-foreground">
                              <span className="font-medium text-foreground">From:</span> {a.referrer || "NO REFERRER DATA"}
                            </div>
                            <div className="text-muted-foreground mt-0.5">
                              <span className="font-medium text-foreground">Landed:</span>{" "}
                              <span className="text-primary break-all">{a.landingPage || "Unknown"}</span>
                            </div>
                          </div>
                        ))}
                        {visitorDetail.recentActivity.length === 0 && (
                          <p className="text-muted-foreground text-sm">No activity recorded</p>
                        )}
                      </div>

                      {visitorDetail.systemSpecs.userAgent && (
                        <>
                          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 mt-6">User Agent</h4>
                          <p className="text-[11px] text-muted-foreground font-mono break-all bg-muted rounded p-2">
                            {visitorDetail.systemSpecs.userAgent}
                          </p>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </Card>
          ))}
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-between pt-2">
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
      <div className="grid grid-cols-3 gap-3">
        <StatCard label="Total Sources" value={sources.length} icon={Globe} />
        <StatCard label="Total Page Loads" value={totalLoads.toLocaleString()} icon={FileText} />
        <StatCard label="Unique Visitors" value={totalVisitors.toLocaleString()} icon={Users} />
      </div>

      <Card className="bg-card border-border">
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left p-3 text-xs font-medium text-muted-foreground">Percentage</th>
                  <th className="text-right p-3 text-xs font-medium text-muted-foreground">Page Loads</th>
                  <th className="text-right p-3 text-xs font-medium text-muted-foreground">Visitors</th>
                  <th className="text-left p-3 text-xs font-medium text-muted-foreground">Traffic Sources by Domain / Vendor</th>
                </tr>
              </thead>
              <tbody>
                {sources.length === 0 ? (
                  <tr><td colSpan={4} className="p-6 text-center text-muted-foreground">No traffic source data available</td></tr>
                ) : (
                  sources.map((s, i) => (
                    <tr key={i} className="border-b border-border/50 hover:bg-muted/30 transition-colors" data-testid={`row-source-${i}`}>
                      <td className="p-3 w-48">
                        <div className="flex items-center gap-2">
                          <span className="text-xs tabular-nums text-muted-foreground w-14">{s.percentage.toFixed(1)}%</span>
                          <PercentBar value={s.percentage} />
                        </div>
                      </td>
                      <td className="text-right p-3 tabular-nums font-medium">{s.pageLoads.toLocaleString()}</td>
                      <td className="text-right p-3 tabular-nums">{s.visitors.toLocaleString()}</td>
                      <td className="p-3">
                        <span className={`${s.domain === "NO REFERRER DATA" ? "text-muted-foreground italic" : "text-primary"}`}>
                          {s.domain}
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
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
      <div className="grid grid-cols-2 gap-3">
        <StatCard label="Total Pages" value={pages.length} icon={FileText} />
        <StatCard label="Total Hits" value={pages.reduce((s, p) => s + p.hits, 0).toLocaleString()} icon={Eye} />
      </div>

      <Card className="bg-card border-border">
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left p-3 text-xs font-medium text-muted-foreground">Page URL</th>
                  <th className="text-right p-3 text-xs font-medium text-muted-foreground">Hits</th>
                  <th className="text-right p-3 text-xs font-medium text-muted-foreground">Unique Visitors</th>
                  <th className="text-left p-3 text-xs font-medium text-muted-foreground w-32">Share</th>
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
                      <tr key={i} className="border-b border-border/50 hover:bg-muted/30 transition-colors" data-testid={`row-page-${i}`}>
                        <td className="p-3 max-w-xs">
                          <span className="text-primary text-xs break-all">{p.url}</span>
                        </td>
                        <td className="text-right p-3 tabular-nums font-medium">{p.hits.toLocaleString()}</td>
                        <td className="text-right p-3 tabular-nums">{p.uniqueVisitors.toLocaleString()}</td>
                        <td className="p-3 w-32">
                          <PercentBar value={pct} />
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
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
      <div className="flex items-center gap-2">
        <Button size="sm" variant={subTab === "countries" ? "default" : "outline"} onClick={() => setSubTab("countries")} data-testid="button-geo-countries">Countries</Button>
        <Button size="sm" variant={subTab === "cities" ? "default" : "outline"} onClick={() => setSubTab("cities")} data-testid="button-geo-cities">Cities</Button>
      </div>

      <Card className="bg-card border-border">
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left p-3 text-xs font-medium text-muted-foreground">Location</th>
                  <th className="text-right p-3 text-xs font-medium text-muted-foreground">Visits</th>
                  <th className="text-right p-3 text-xs font-medium text-muted-foreground">Visitors</th>
                  <th className="text-left p-3 text-xs font-medium text-muted-foreground w-32">Share</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <tr><td colSpan={4} className="p-6 text-center"><div className="animate-spin h-5 w-5 border-2 border-primary border-t-transparent rounded-full mx-auto" /></td></tr>
                ) : items.length === 0 ? (
                  <tr><td colSpan={4} className="p-6 text-center text-muted-foreground">No geographic data available</td></tr>
                ) : (
                  items.map((item: any, i: number) => (
                    <tr key={i} className="border-b border-border/50 hover:bg-muted/30 transition-colors" data-testid={`row-geo-${i}`}>
                      <td className="p-3 font-medium text-foreground">
                        <div className="flex items-center gap-2">
                          <MapPin className="h-3.5 w-3.5 text-muted-foreground" />
                          {item.name}
                        </div>
                      </td>
                      <td className="text-right p-3 tabular-nums font-medium">{item.count.toLocaleString()}</td>
                      <td className="text-right p-3 tabular-nums">{item.visitors.toLocaleString()}</td>
                      <td className="p-3 w-32">
                        <div className="flex items-center gap-2">
                          <PercentBar value={parseFloat(item.percentage)} />
                          <span className="text-xs text-muted-foreground tabular-nums w-10">{item.percentage}%</span>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
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
      <Card className="bg-card border-border">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <Icon className="h-4 w-4 text-muted-foreground" /> {title}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-4 pt-0 space-y-2">
          {entries.length === 0 ? (
            <p className="text-muted-foreground text-sm">No data</p>
          ) : (
            entries.map(([name, count]) => {
              const pct = total ? (count / total) * 100 : 0;
              return (
                <div key={name} className="space-y-1">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-foreground">{name}</span>
                    <span className="text-muted-foreground tabular-nums">{count} ({pct.toFixed(1)}%)</span>
                  </div>
                  <PercentBar value={pct} />
                </div>
              );
            })
          )}
        </CardContent>
      </Card>
    );
  };

  if (isLoading) {
    return <div className="flex justify-center py-12"><div className="animate-spin h-6 w-6 border-2 border-primary border-t-transparent rounded-full" /></div>;
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {renderBreakdown("Browsers", Chrome, platforms?.browsers)}
      {renderBreakdown("Operating Systems", Laptop, platforms?.oses)}
      {renderBreakdown("Devices", Monitor, platforms?.devices)}
      {renderBreakdown("Screen Resolutions", Monitor, platforms?.resolutions)}
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
    <div className="h-full overflow-y-auto bg-background text-foreground overflow-x-hidden">
      <section className="relative z-10 pt-6 sm:pt-8 pb-8 sm:pb-12 px-3 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto">
          <div className="flex flex-col gap-4 mb-6">
            <div>
              <div className="flex items-center gap-3 mb-2">
                <div className="h-9 w-9 rounded-lg bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center shrink-0">
                  <Fingerprint className="h-5 w-5 text-white" />
                </div>
                <Badge className="bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20 px-3 py-1 text-sm" data-testid="badge-ip-tracker">
                  <Activity className="h-3.5 w-3.5 mr-1.5" /> IP Tracker
                </Badge>
              </div>
              <h1 className="text-2xl sm:text-3xl md:text-4xl font-extrabold tracking-tight" data-testid="text-page-title">
                <span className="text-foreground">Visitor </span>
                <span className="bg-gradient-to-r from-blue-500 to-indigo-600 bg-clip-text text-transparent">Tracker</span>
              </h1>
              <p className="mt-2 text-muted-foreground max-w-xl text-sm" data-testid="text-subtitle">
                Real-time website visitor tracking. See who visits your site, where they come from, and what they do.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {selectedDomain && domains.length > 0 && (
                <>
                  <select
                    className="bg-card border border-border text-foreground text-sm rounded-md px-3 py-2 outline-none min-w-0 max-w-[200px]"
                    value={domainId || ""}
                    onChange={(e) => setSelectedDomainId(Number(e.target.value))}
                    aria-label="Site"
                    data-testid="select-domain"
                  >
                    {domains.map(d => (
                      <option key={d.id} value={d.id}>{d.name || d.domain}</option>
                    ))}
                  </select>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setConfirmRemove(true)}
                    disabled={removeDomainMutation.isPending}
                    aria-label="Remove site"
                    data-testid="button-remove-domain"
                  >
                    <Trash2 className="h-4 w-4 sm:mr-1" /><span className="hidden sm:inline">Remove site</span>
                  </Button>
                </>
              )}
              <Button
                size="sm"
                className="bg-blue-600 hover:bg-blue-700 text-white"
                onClick={() => setShowAddDomain(true)}
                data-testid="button-add-domain"
              >
                <Plus className="h-4 w-4 mr-1" /> Add Site
              </Button>
            </div>
          </div>

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
            <Card className="bg-card border-border mb-6" data-testid="card-add-domain">
              <CardContent className="p-4">
                <div className="flex flex-col sm:flex-row gap-3">
                  <Input
                    placeholder="example.com"
                    value={newDomain}
                    onChange={(e) => setNewDomain(e.target.value)}
                    className="bg-card border-border text-foreground"
                    data-testid="input-domain"
                  />
                  <Input
                    placeholder="Display name (optional)"
                    value={newDomainName}
                    onChange={(e) => setNewDomainName(e.target.value)}
                    className="bg-card border-border text-foreground"
                    data-testid="input-domain-name"
                  />
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      className="bg-blue-600 hover:bg-blue-700 text-white"
                      onClick={() => addDomainMutation.mutate()}
                      disabled={!newDomain.trim() || addDomainMutation.isPending}
                      data-testid="button-save-domain"
                    >
                      {addDomainMutation.isPending ? "Adding..." : "Add"}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-muted-foreground"
                      onClick={() => setShowAddDomain(false)}
                      data-testid="button-cancel-domain"
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Wraps instead of scrolling so every tab stays visible at phone width. */}
          <div className="flex flex-wrap items-center gap-1 mb-6 bg-card border border-border rounded-lg p-1 sm:w-fit" role="tablist">
            {tabs.map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                role="tab"
                aria-selected={activeTab === tab.id}
                className={`flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-md text-xs sm:text-sm font-medium transition-colors whitespace-nowrap shrink-0 ${
                  activeTab === tab.id
                    ? "bg-blue-600 text-white"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted"
                }`}
                data-testid={`tab-${tab.id}`}
              >
                <tab.icon className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">{tab.label}</span>
                <span className="sm:hidden">{tab.label.split(" ")[0]}</span>
              </button>
            ))}
          </div>

          {domainsLoading ? (
            <div className="flex justify-center py-12"><div className="animate-spin h-6 w-6 border-2 border-primary border-t-transparent rounded-full" /></div>
          ) : !domainId && !showAddDomain ? (
            <Card className="bg-card border-border p-12 text-center">
              <Fingerprint className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <h2 className="text-xl font-bold text-foreground mb-2">No Sites Being Tracked</h2>
              <p className="text-muted-foreground mb-4 max-w-md mx-auto">
                Add your first website to start tracking visitors in real time. You'll get a tracking code to embed on your site.
              </p>
              <Button className="bg-blue-600 hover:bg-blue-700 text-white" onClick={() => setShowAddDomain(true)} data-testid="button-add-first-domain">
                <Plus className="h-4 w-4 mr-2" /> Add Your First Site
              </Button>
            </Card>
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
        </div>
      </section>
    </div>
  );
}
