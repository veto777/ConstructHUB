import { useAppOrigin } from "@/lib/app-origin";
import { useState } from "react";
import { Link, useLocation, useSearch } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useMutation, type UseQueryResult } from "@tanstack/react-query";
import { apiErrorMessage, apiRequest, queryClient } from "@/lib/queryClient";
import {
  AppPage,
  Section,
  Notice,
  StatusPill,
} from "@/components/app-ui";
import { GoogleSectionHeader, GooglePill, GoogleStat, GoogleStatGrid } from "@/components/google";
import { ToolTabs } from "@/components/tool";
import { countryName } from "@/components/ip-tracker/country-names";
import {
  ChevronRight, Copy, Monitor, Smartphone, Tablet,
  MapPin, Fingerprint, Clock, Shield,
  Search,
} from "lucide-react";

type VpnDomain = {
  id: number;
  userId: number;
  domain: string;
  trackingId: string;
  name: string | null;
  isActive: boolean;
  createdAt: string;
  vpnStats?: {
    totalBlocks: number;
    uniqueVpnIps: number;
  };
};

type VpnVisit = {
  id: number;
  domainId: number;
  ipAddress: string;
  userAgent: string | null;
  fingerprint: string | null;
  browser: string | null;
  os: string | null;
  deviceType: string | null;
  country: string | null;
  city: string | null;
  referrer: string | null;
  landingPage: string | null;
  vpnProvider: string | null;
  detectionMethod: string;
  action: string;
  visitedAt: string;
};

type VpnStats = {
  today: number;
  yesterday: number;
  sevenDays: number;
  thirtyDays: number;
  total: number;
  uniqueIps: number;
  topProviders: { name: string; count: number }[];
  topCountries: { name: string; count: number }[];
};

const tabs = [
  { id: "overview", label: "Overview" },
  { id: "blocked", label: "Flagged visits" },
  { id: "install", label: "Install script" },
  { id: "settings", label: "Settings" },
] as const;

type TabId = typeof tabs[number]["id"];

/** Tab and site live in the query string (?site=10&tab=settings) so a reload or shared link keeps them. */
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

// Every detection is recorded; `action` is what the site's block mode did with it at the time.
const ACTION_LABELS: Record<string, string> = { block: "Blocked", redirect: "Redirected", log: "Logged only" };
const actionLabel = (action: string) => ACTION_LABELS[action] ?? action;

// Activity panels re-check on this cadence while the page is open (queries otherwise
// never refresh on their own), so "last detection" and the overview stay current.
const VPN_REFETCH_MS = 15000;

/** What the server's block mode falls back to when a site has no saved choice. */
export const VPN_DEFAULT_MODE = "log";

function SetupCard({ onCreated }: { onCreated: (id: number) => void }) {
  const { toast } = useToast();
  const [domain, setDomain] = useState("");
  const [name, setName] = useState("");
  const addMutation = useMutation({
    // The one shared tracked-site list behind Click Guard, IP Tracker and VPN Shield.
    mutationFn: async () => (await apiRequest("POST", "/api/click-guard/domains", { domain: domain.trim(), name: name.trim() || undefined })).json(),
    onSuccess: async (created: any) => {
      // Log-first: the site this setup adds starts in Log only. This is the explicit
      // setup choice (nobody is blocked until Settings says so) and it preserves any
      // choice saved later. Sites added outside this flow keep whatever they have.
      if (created?.id) {
        try {
          await apiRequest("POST", `/api/vpn-shield/domains/${created.id}/settings`, { vpnBlockMode: "log", vpnRedirectUrl: "", vpnWhitelistedIps: "" });
        } catch {
          toast({ title: "Site added", description: "Pick a block mode in Settings — until then the platform default applies.", variant: "destructive" });
        }
      }
      queryClient.invalidateQueries({ queryKey: ["/api/click-guard/domains"], exact: true });
      queryClient.invalidateQueries({ queryKey: ["/api/vpn-shield/domains"], exact: true });
      toast({ title: "Site added", description: "It starts in Log only. Now install the VPN Shield script on it." });
      if (created?.id) onCreated(created.id);
    },
    onError: (err: any) => {
      toast({ title: "Could not add site", description: apiErrorMessage(err, "Failed to add site"), variant: "destructive" });
    },
  });
  return (
    <div className="rounded-xl border bg-card text-card-foreground" data-testid="card-vpn-setup">
      <div className="space-y-3 p-4 sm:p-5">
        <h2 className="g-card__title g-card__title--md">Set up your first site</h2>
        <p className="text-sm text-muted-foreground" data-testid="text-vpn-setup-steps">
          Step 1 of 3 — add the website. Then you'll install one script and verify the first detection. New sites start in <b>Log only</b>: detections are recorded but nobody is blocked until you turn blocking on.
        </p>
        <div className="flex flex-col gap-3 sm:flex-row">
          <Input
            placeholder="example.com"
            value={domain}
            onChange={(e) => setDomain(e.target.value)}
            data-testid="input-vpn-setup-domain"
          />
          <Input
            placeholder="Display name (optional)"
            value={name}
            onChange={(e) => setName(e.target.value)}
            data-testid="input-vpn-setup-name"
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <GooglePill
            variant="solid"
            label={addMutation.isPending ? "Adding…" : "Add site"}
            onClick={() => addMutation.mutate()}
            disabled={!domain.trim() || addMutation.isPending}
            testId="button-vpn-setup-add"
          />
          <span className="self-center text-xs text-muted-foreground">
            Sites you add here also appear in{" "}
            <Link href="/ip-tracker" className="text-primary underline underline-offset-2" data-testid="link-vpn-setup-ip-tracker">IP Tracker</Link>.
          </span>
        </div>
      </div>
    </div>
  );
}

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric",
    hour: "numeric", minute: "2-digit",
  });
}

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

function DeviceIcon({ type }: { type: string | null }) {
  if (type === "mobile") return <Smartphone className="h-3.5 w-3.5" />;
  if (type === "tablet") return <Tablet className="h-3.5 w-3.5" />;
  return <Monitor className="h-3.5 w-3.5" />;
}

const pad2 = (n: number) => String(n).padStart(2, "0");
const localDayKey = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

/** The last 30 local days, oldest first, each with its detection count. */
function sparklineDays(visits: VpnVisit[] | undefined) {
  const days: { key: string; label: string; count: number }[] = [];
  const now = new Date();
  for (let i = 29; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
    days.push({ key: localDayKey(d), label: `${d.getMonth() + 1}/${d.getDate()}`, count: 0 });
  }
  for (const v of visits || []) {
    const key = localDayKey(new Date(v.visitedAt));
    const bucket = days.find(d => d.key === key);
    if (bucket) bucket.count++;
  }
  return days;
}

function OverviewTab({ domainId, statsQuery }: { domainId: number | null; statsQuery: UseQueryResult<VpnStats, Error> }) {
  const stats = statsQuery.data;
  // The stats endpoint counts every detection; split them by the action that was taken.
  const visitsQuery = useQuery<VpnVisit[]>({
    queryKey: ["/api/vpn-shield/domains", domainId, "blocked-visits"],
    enabled: !!domainId,
    refetchInterval: VPN_REFETCH_MS,
  });
  const visits = visitsQuery.data;
  const blockedCount = visits ? visits.filter(v => v.action === "block").length : null;

  const days = sparklineDays(visits);
  const maxDay = Math.max(...days.map(d => d.count), 1);
  const recentTotal = days.reduce((s, d) => s + d.count, 0);

  return (
    <div className="space-y-4 sm:space-y-5">
      <Notice>
        <span data-testid="text-crawler-notice">
          <span className="font-semibold">Search engine crawlers</span>{" "}
          (Google, Bing, Yahoo) are exempted by user-agent matching, which can
          be spoofed. VPN detection is heuristic.
        </span>
      </Notice>

      {statsQuery.isError && !stats && (
        <Notice tone="danger" title="Couldn't load protection statistics" testId="notice-vpn-stats-error"
          action={<Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => void statsQuery.refetch()} data-testid="button-retry-vpn-stats">Retry</Button>}>
          {apiErrorMessage(statsQuery.error, "The statistics could not be loaded.")} Zeroes below would mean "no data", not "no detections" — the real answer is unavailable.
        </Notice>
      )}
      {visitsQuery.isError && !visits && (
        <Notice tone="danger" title="Couldn't load flagged visits" testId="notice-vpn-visits-error"
          action={<Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => void visitsQuery.refetch()} data-testid="button-retry-vpn-visits">Retry</Button>}>
          {apiErrorMessage(visitsQuery.error, "The flagged-visit list could not be loaded.")}
        </Notice>
      )}

      <GoogleStatGrid cols={4}>
        <GoogleStat label="Detections" testId="card-stat-detections"
          value={stats ? stats.total : "…"}
          hint="All time, any action" />
        <GoogleStat label="Detections today" testId="card-stat-detections-today"
          value={stats ? stats.today : "…"} />
        <GoogleStat label="Blocked" testId="card-stat-blocked"
          value={domainId ? (visitsQuery.isError && !visits ? "Unavailable" : (blockedCount ?? "…")) : 0}
          hint="Overlay shown" />
        <GoogleStat label="Unique VPN IPs" testId="card-stat-unique-vpn-ips"
          value={stats ? stats.uniqueIps : "…"}
          hint="All time" />
      </GoogleStatGrid>

      {visitsQuery.isLoading && (
        <div className="flex justify-center py-8">
          <div className="animate-spin h-6 w-6 border-2 border-primary border-t-transparent rounded-full" />
        </div>
      )}

      {visits && recentTotal > 0 && (
        <Section title="Detections, last 30 days">
          {/* Each bar hangs from a column with its own height: a percentage height
              inside a content-sized column collapses to the minimum and draws every
              bar the same. h-full + an absolute bar keeps the percentage meaningful. */}
          <div className="flex items-stretch gap-1 h-28">
            {days.map(day => (
              <div key={day.key} className="flex-1 flex h-full flex-col items-center gap-1">
                <div className="relative w-full flex-1">
                  <div
                    className="absolute bottom-0 left-0 right-0 rounded-t bg-primary/80 hover:bg-primary transition-colors"
                    style={{ height: `${(day.count / maxDay) * 100}%` }}
                    title={`${day.label}: ${day.count} detection${day.count === 1 ? "" : "s"}`}
                    data-testid={`bar-vpn-${day.key}`}
                  />
                </div>
                {Number(day.key.slice(8, 10)) % 5 === 1 && (
                  <span className="text-[8px] text-muted-foreground truncate w-full text-center">{day.label}</span>
                )}
              </div>
            ))}
          </div>
        </Section>
      )}

      {visits && recentTotal === 0 && (
        <p className="text-sm text-muted-foreground" data-testid="text-vpn-no-recent-detections">
          No detections in the last 30 days. If you installed the script recently, visit your own site through a VPN or proxy to test it — the first detection lands here within a minute.
        </p>
      )}

      {stats && stats.topProviders.length > 0 && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 sm:gap-5">
          <Section title="Top VPN providers">
            <div className="space-y-2">
              {stats.topProviders.slice(0, 8).map(p => (
                <div key={p.name} className="flex items-center justify-between gap-2 text-sm">
                  <span className="truncate">{p.name}</span>
                  <span className="tabular-nums text-muted-foreground">{p.count}</span>
                </div>
              ))}
            </div>
          </Section>
          <Section title="Top countries">
            <p className="mb-2 text-xs text-muted-foreground" data-testid="text-countries-source-note">Country/city come from Cloudflare on visits recorded after this update; older visits show Unknown.</p>
            <div className="space-y-2">
              {stats.topCountries.slice(0, 8).map(c => (
                <div key={c.name} className="flex items-center justify-between gap-2 text-sm">
                  <span className="truncate">{countryName(c.name)}</span>
                  <span className="tabular-nums text-muted-foreground">{c.count}</span>
                </div>
              ))}
            </div>
          </Section>
        </div>
      )}
    </div>
  );
}

function BlockedVisitorsTab({ domainId }: { domainId: number | null }) {
  const [ipSearch, setIpSearch] = useState("");
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [page, setPage] = useState(1);
  const perPage = 20;

  const visitsQuery = useQuery<VpnVisit[]>({
    queryKey: ["/api/vpn-shield/domains", domainId, "blocked-visits"],
    enabled: !!domainId,
    refetchInterval: VPN_REFETCH_MS,
  });
  const visits = visitsQuery.data;
  const visitsError = visitsQuery.isError && !visits;

  const filtered = (visits || []).filter(v => v.ipAddress.includes(ipSearch));
  const totalPages = Math.ceil(filtered.length / perPage);
  // Results can shrink below the current page: stay on a real one.
  const safePage = Math.min(page, Math.max(totalPages, 1));
  const paginated = filtered.slice((safePage - 1) * perPage, safePage * perPage);

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
            data-testid="input-vpn-ip-search"
          />
        </div>
        <span className="text-sm tabular-nums text-muted-foreground" data-testid="badge-vpn-visit-count">
          {filtered.length} flagged visit{filtered.length !== 1 ? "s" : ""}
          {" · "}{filtered.filter(v => v.action === "block").length} blocked
        </span>
      </div>

      {visitsQuery.isLoading ? (
        <div className="flex justify-center py-12">
          <div className="animate-spin h-6 w-6 border-2 border-foreground border-t-transparent rounded-full" />
        </div>
      ) : visitsError ? (
        <Notice tone="danger" title="Couldn't load flagged visits" testId="notice-flagged-error"
          action={<Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => void visitsQuery.refetch()} data-testid="button-retry-flagged">Retry</Button>}>
          {apiErrorMessage(visitsQuery.error, "The flagged-visit list could not be loaded.")} This is a failed request, not a quiet site.
        </Notice>
      ) : paginated.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border bg-card py-14 text-center">
          <Shield className="h-5 w-5 text-muted-foreground" strokeWidth={1.6} />
          <p className="mt-3 text-sm text-muted-foreground" data-testid="text-no-vpn-visits">No flagged VPN visits found</p>
        </div>
      ) : (
        <div className="space-y-2">
          {paginated.map(v => (
            <div
              key={v.id}
              className={`rounded-xl border bg-card transition-all ${expandedId === v.id ? "ring-1 ring-border" : ""}`}
              data-testid={`card-vpn-visit-${v.id}`}
            >
              <button
                type="button"
                className="w-full cursor-pointer p-4 text-left hover:bg-muted/30 transition-colors"
                onClick={() => setExpandedId(expandedId === v.id ? null : v.id)}
                aria-expanded={expandedId === v.id}
                aria-controls={`vpn-visit-detail-${v.id}`}
                data-testid={`button-expand-vpn-visit-${v.id}`}
              >
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-sm font-medium break-all" data-testid={`text-vpn-ip-${v.id}`}>
                          {v.ipAddress}
                        </span>
                        {v.vpnProvider && (
                          <span className="rounded-full border bg-muted/50 px-2 py-0.5 text-[10px] text-muted-foreground">
                            {v.vpnProvider}
                          </span>
                        )}
                        <span className="rounded-full border bg-muted/50 px-2 py-0.5 text-[10px] text-muted-foreground">
                          {v.detectionMethod}
                        </span>
                        <span
                          className={`rounded-full border px-2 py-0.5 text-[10px] ${
                            v.action === "block"
                              ? "border-amber-500/40 text-amber-700 dark:text-amber-400"
                              : "text-muted-foreground"
                          }`}
                          data-testid={`badge-vpn-action-${v.id}`}
                        >
                          {actionLabel(v.action)}
                        </span>
                      </div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                        {v.fingerprint && (
                          <span className="flex items-center gap-1">
                            <Fingerprint className="h-3 w-3" /> {v.fingerprint.slice(0, 12)}…
                          </span>
                        )}
                        {(v.city || v.country) && (
                          <span className="flex items-center gap-1">
                            <MapPin className="h-3 w-3" /> {[v.city, countryName(v.country)].filter(Boolean).join(", ")}
                          </span>
                        )}
                        <span className="flex items-center gap-1">
                          <Clock className="h-3 w-3" /> {formatTimeAgo(v.visitedAt)}
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="hidden sm:flex items-center gap-1.5 text-xs text-muted-foreground shrink-0">
                    <DeviceIcon type={v.deviceType} />
                    <span>{v.browser || "Unknown"}</span>
                  </div>
                  <ChevronRight className={`h-4 w-4 text-muted-foreground shrink-0 transition-transform ${expandedId === v.id ? "rotate-90" : ""}`} />
                </div>
              </button>

              {expandedId === v.id && (
                <div className="border-t bg-muted/20 p-4" id={`vpn-visit-detail-${v.id}`}>
                  <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                    <div className="space-y-2 text-sm">
                      <h4 className="mb-3 text-xs font-semibold text-muted-foreground">Detection details</h4>
                      <div className="flex justify-between gap-4"><span className="text-muted-foreground">IP address</span><span className="font-mono font-medium">{v.ipAddress}</span></div>
                      <div className="flex justify-between gap-4"><span className="text-muted-foreground">VPN provider</span><span className="font-medium">{v.vpnProvider || "Unknown"}</span></div>
                      <div className="flex justify-between gap-4"><span className="text-muted-foreground">Detection method</span><span className="font-medium">{v.detectionMethod}</span></div>
                      <div className="flex justify-between gap-4"><span className="text-muted-foreground">Action</span><span className="font-medium">{actionLabel(v.action)}</span></div>
                      <div className="flex justify-between gap-4"><span className="text-muted-foreground">Fingerprint</span><span className="max-w-[200px] truncate font-mono text-xs">{v.fingerprint || "N/A"}</span></div>
                      <div className="flex justify-between gap-4"><span className="text-muted-foreground">Time</span><span>{formatDate(v.visitedAt)}</span></div>
                    </div>
                    <div className="space-y-2 text-sm">
                      <h4 className="mb-3 text-xs font-semibold text-muted-foreground">Visitor details</h4>
                      <div className="flex justify-between gap-4"><span className="text-muted-foreground">Browser</span><span className="font-medium">{v.browser || "Unknown"}</span></div>
                      <div className="flex justify-between gap-4"><span className="text-muted-foreground">OS</span><span className="font-medium">{v.os || "Unknown"}</span></div>
                      <div className="flex justify-between gap-4"><span className="text-muted-foreground">Device</span><span className="font-medium">{v.deviceType || "Unknown"}</span></div>
                      <div className="flex justify-between gap-4"><span className="text-muted-foreground">Country</span><span className="font-medium">{countryName(v.country) || "Unknown"}</span></div>
                      <div className="flex justify-between gap-4"><span className="text-muted-foreground">City</span><span className="font-medium">{v.city || "Unknown"}</span></div>
                      <div className="flex justify-between gap-4"><span className="text-muted-foreground">Landing page</span><span className="max-w-[200px] truncate">{v.landingPage || "Unknown"}</span></div>
                      <div className="flex justify-between gap-4"><span className="text-muted-foreground">Referrer</span><span className="max-w-[200px] truncate">{v.referrer || "Direct"}</span></div>
                      {v.userAgent && (
                        <>
                          <h4 className="mb-2 mt-4 text-xs font-semibold text-muted-foreground">User agent</h4>
                          <p className="rounded-md bg-muted p-2 font-mono text-[11px] text-muted-foreground break-all">
                            {v.userAgent}
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
            Showing {(safePage - 1) * perPage + 1}-{Math.min(safePage * perPage, filtered.length)} of {filtered.length}
          </span>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" disabled={safePage <= 1} onClick={() => setPage(safePage - 1)} data-testid="button-vpn-prev-page">Prev</Button>
            <span className="text-sm tabular-nums text-muted-foreground">Page {safePage} / {totalPages}</span>
            <Button variant="outline" size="sm" disabled={safePage >= totalPages} onClick={() => setPage(safePage + 1)} data-testid="button-vpn-next-page">Next</Button>
          </div>
        </div>
      )}
    </div>
  );
}

function InstallScriptTab({ domains, selectedDomainId, setSelectedDomainId, detections, statsError }: {
  domains: VpnDomain[];
  selectedDomainId: number | null;
  setSelectedDomainId: (id: number) => void;
  detections: number | undefined;
  statsError: boolean;
}) {
  const appOrigin = useAppOrigin();
  const { toast } = useToast();
  const selectedDomain = domains.find(d => d.id === selectedDomainId);

  const scriptSnippet = selectedDomain
    ? `<!-- VPN Shield by ConstructHUB -->\n<script src="${appOrigin}/api/vpn-shield/script/${selectedDomain.trackingId}" async></script>`
    : "";

  const copyScript = async () => {
    try {
      await navigator.clipboard.writeText(scriptSnippet);
      toast({ title: "Copied!", description: "VPN Shield script copied to clipboard." });
    } catch {
      toast({ title: "Couldn't copy the script", description: "Your browser blocked clipboard access — select the script and copy it manually.", variant: "destructive" });
    }
  };

  return (
    <div className="space-y-4 sm:space-y-5">
      {domains.length > 0 && (
        <label className="block max-w-sm space-y-1.5 text-sm">
          <span className="text-muted-foreground">Site</span>
          <select
            className="h-10 w-full rounded-md border bg-background px-3 text-sm"
            value={selectedDomainId || ""}
            onChange={(e) => setSelectedDomainId(Number(e.target.value))}
            data-testid="select-vpn-domain"
          >
            {domains.map(d => (
              <option key={d.id} value={d.id}>{d.name || d.domain}</option>
            ))}
          </select>
        </label>
      )}

      {selectedDomain && (
        <Section title="Installation code">
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Add this script tag to the <code className="rounded bg-muted px-1 py-0.5">&lt;head&gt;</code> or before the closing <code className="rounded bg-muted px-1 py-0.5">&lt;/body&gt;</code> tag of your website.
            </p>
            <div className="relative">
              <pre className="overflow-x-auto rounded-md bg-muted p-4 font-mono text-xs" data-testid="text-vpn-script-code">
                {scriptSnippet}
              </pre>
              <Button
                size="icon"
                variant="ghost"
                className="!absolute top-2 right-2"
                onClick={copyScript}
                aria-label="Copy VPN Shield script"
                data-testid="button-copy-vpn-script"
              >
                <Copy className="h-4 w-4" />
              </Button>
            </div>
            {/* Installation verification: the stats poll picks up the first detection, so this
                line flips on its own once the script runs somewhere. */}
            {!statsError && detections === 0 && (
              <p className="flex items-start gap-1.5 text-xs text-muted-foreground" data-testid="text-vpn-awaiting-first-detection">
                <Clock className="h-3 w-3 mt-0.5 shrink-0" />
                Waiting for the first detection. After adding the script, visit your site through a VPN or proxy — the detection appears on the Overview within a minute.
              </p>
            )}
            {!statsError && detections !== undefined && detections > 0 && (
              <p className="text-xs text-emerald-700 dark:text-emerald-400" data-testid="text-vpn-script-active">
                Script is running — {detections} detection{detections === 1 ? "" : "s"} recorded so far.
              </p>
            )}
          </div>
        </Section>
      )}

      <Section title="How detection works">
        <ul className="space-y-3 text-sm">
          <li>
            <p className="font-medium" data-testid="text-detection-webrtc">WebRTC IP leak detection</p>
            <p className="text-muted-foreground">Uses browser-reported WebRTC differences as one possible signal. Network configuration can also cause differences.</p>
          </li>
          <li>
            <p className="font-medium" data-testid="text-detection-timezone">Timezone / geo mismatch</p>
            <p className="text-muted-foreground">Not used as a signal: timezone differences also match ordinary visitors (travel, device settings), so detection deliberately ignores them.</p>
          </li>
          <li>
            <p className="font-medium" data-testid="text-detection-datacenter">Datacenter IP range detection</p>
            <p className="text-muted-foreground">Checks a limited built-in set of IP prefixes. This list may be incomplete or outdated and cannot establish VPN usage.</p>
          </li>
          <li>
            <p className="font-medium" data-testid="text-detection-extensions">VPN extension detection</p>
            <p className="text-muted-foreground">Uses browser-reported extension indicators when available; it cannot reliably identify installed VPN tools.</p>
          </li>
        </ul>
      </Section>
    </div>
  );
}

const isHttpLink = (v: string) => { try { return ["http:", "https:"].includes(new URL(v).protocol); } catch { return false; } };
const IPV4 = /^(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/;
/** One IPv4 or IPv6 address (no ranges), like the server's net.isIP check. */
function isIpAddress(v: string): boolean {
  if (IPV4.test(v)) return true;
  if (!v.includes(":") || !/^[0-9a-f:.]+(?:%[\w.-]+)?$/i.test(v)) return false;
  try { new URL(`http://[${v.split("%")[0]}]/`); return true; } catch { return false; }
}

function SettingsTab({ domainId, domains }: { domainId: number | null; domains: VpnDomain[] }) {
  const { toast } = useToast();
  const domain = domains.find(d => d.id === domainId);
  const settings = (domain as any)?.settings || {};

  const [blockMode, setBlockMode] = useState(settings.vpnBlockMode || VPN_DEFAULT_MODE);
  const [redirectUrl, setRedirectUrl] = useState(settings.vpnRedirectUrl || "");
  const [whitelistedIps, setWhitelistedIps] = useState(settings.vpnWhitelistedIps || "");
  // Same checks the server makes, shown before saving.
  const trimmedRedirect = redirectUrl.trim();
  const redirectError = blockMode === "redirect" && !trimmedRedirect ? "Redirect mode needs a full http:// or https:// link."
    : trimmedRedirect && !isHttpLink(trimmedRedirect) ? "The redirect link must start with http:// or https://." : "";
  const whitelist = String(whitelistedIps).split(/[\n,]+/).map((v: string) => v.trim()).filter(Boolean);
  const badIp = whitelist.find((ip: string) => !isIpAddress(ip));
  const whitelistError = badIp ? `"${badIp.slice(0, 60)}" is not a valid IP address. Enter one IPv4 or IPv6 address per line (no ranges).`
    : whitelist.length > 500 ? "Whitelist up to 500 IP addresses." : "";

  const saveMutation = useMutation({
    mutationFn: () => apiRequest("POST", `/api/vpn-shield/domains/${domainId}/settings`, {
      vpnBlockMode: blockMode,
      vpnRedirectUrl: redirectUrl,
      vpnWhitelistedIps: whitelistedIps,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/vpn-shield/domains"] });
      toast({ title: "Settings saved", description: "VPN Shield settings have been updated." });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: apiErrorMessage(err, "Failed to save settings."), variant: "destructive" });
    },
  });

  return (
    <div className="max-w-2xl space-y-4 sm:space-y-5">
      <Section
        title="Block mode"
        description="Choose how the browser script responds to possible proxy signals after page load. New sites start in Log only — review a sample of detections first, then turn on blocking explicitly."
      >
        <div className="space-y-2">
          {[
            { value: "log", label: "Log only", desc: "Record VPN visits but don't block them" },
            { value: "block", label: "Block", desc: "Show an overlay to flagged browsers" },
            { value: "redirect", label: "Redirect", desc: "Redirect VPN visitors to a custom URL" },
          ].map(opt => (
            <label
              key={opt.value}
              className={`flex cursor-pointer items-start gap-3 rounded-md border p-3 transition-colors ${
                blockMode === opt.value ? "border-primary/60 bg-primary/5" : ""
              }`}
              data-testid={`option-mode-${opt.value}`}
            >
              <input
                type="radio"
                name="blockMode"
                value={opt.value}
                checked={blockMode === opt.value}
                onChange={() => setBlockMode(opt.value)}
                className="mt-0.5"
              />
              <div>
                <span className="text-sm font-medium">{opt.label}</span>
                <p className="text-xs text-muted-foreground">{opt.desc}</p>
              </div>
            </label>
          ))}
        </div>
      </Section>

      {blockMode !== "log" && (
        <Notice tone="warning" testId="notice-blocking-active">
          <span data-testid="text-blocking-state">
            <span className="font-semibold">Blocking is ON after you save.</span>{" "}
            {blockMode === "block"
              ? "Flagged visitors will see an overlay instead of your page. Browser overlays can be bypassed and may affect legitimate visitors."
              : "Flagged visitors will be sent to the redirect link instead of your page."}
          </span>
        </Notice>
      )}

      {blockMode === "redirect" && (
        <Section title="Redirect URL">
          <Input
            type="url"
            inputMode="url"
            placeholder="https://example.com/blocked"
            value={redirectUrl}
            onChange={e => setRedirectUrl(e.target.value)}
            aria-invalid={!!redirectError}
            data-testid="input-redirect-url"
          />
          {redirectError && <p className="mt-2 text-xs text-destructive" data-testid="text-redirect-url-error">{redirectError}</p>}
        </Section>
      )}

      <Section
        title="Whitelisted IPs"
        description="IP addresses that should never be blocked, one per line. Useful for your office VPN or testing."
      >
        <Textarea
          placeholder={"192.168.1.1\n10.0.0.1"}
          value={whitelistedIps}
          onChange={e => setWhitelistedIps(e.target.value)}
          className="resize-none font-mono text-sm"
          rows={5}
          aria-invalid={!!whitelistError}
          data-testid="textarea-whitelisted-ips"
        />
        {whitelistError && <p className="mt-2 text-xs text-destructive" data-testid="text-whitelist-error">{whitelistError}</p>}
      </Section>

      <Notice>
        <span data-testid="text-settings-crawler-whitelist">
          <span className="font-semibold">Crawler whitelist:</span> Googlebot,
          Bingbot, Yahoo Slurp, DuckDuckBot, Baiduspider, and other crawler
          user-agent strings are exempted. User-agent strings can be spoofed.
        </span>
      </Notice>

      <div className="flex flex-wrap items-center gap-3">
        <GooglePill
          variant="solid"
          label={saveMutation.isPending ? "Saving…" : "Save settings"}
          onClick={() => saveMutation.mutate()}
          disabled={!domainId || saveMutation.isPending || !!redirectError || !!whitelistError}
          testId="button-save-vpn-settings"
        />
        {redirectError && blockMode !== "redirect" && (
          <span className="text-xs text-destructive" data-testid="text-redirect-url-error-hidden">{redirectError} Switch to Redirect to fix or clear it.</span>
        )}
        {domain ? (
          <span className="text-xs text-muted-foreground" data-testid="text-settings-site">Applies to {domain.name || domain.domain}</span>
        ) : (
          <span className="text-xs text-muted-foreground" data-testid="text-settings-no-site">Add a site to save settings.</span>
        )}
      </div>
    </div>
  );
}

export default function VpnShieldPage() {
  const { toast } = useToast();
  const { params, set: setUrlParam } = useUrlState();
  const tabParam = params.get("tab");
  const activeTab: TabId = tabs.some(t => t.id === tabParam) ? (tabParam as TabId) : "overview";
  const setActiveTab = (tab: TabId) => setUrlParam("tab", tab === "overview" ? null : tab);
  const selectedDomainId = Number(params.get("site")) || null;
  const setSelectedDomainId = (id: number | null) => setUrlParam("site", id ? String(id) : null);

  const domainsQuery = useQuery<VpnDomain[]>({
    queryKey: ["/api/vpn-shield/domains"],
    refetchInterval: VPN_REFETCH_MS,
  });
  const domains = domainsQuery.data;
  const domainsLoading = domainsQuery.isLoading;
  const domainsError = domainsQuery.isError && !domains;

  const selectedDomain = (domains ?? []).find(d => d.id === selectedDomainId) || domains?.[0];
  const domainId = selectedDomain?.id ?? null;

  const statsQuery = useQuery<VpnStats>({
    queryKey: ["/api/vpn-shield/domains", domainId, "stats"],
    enabled: !!domainId,
    refetchInterval: VPN_REFETCH_MS,
  });

  const lastDetectionQuery = useQuery<VpnVisit[]>({
    queryKey: ["/api/vpn-shield/domains", domainId, "blocked-visits"],
    enabled: !!domainId,
    refetchInterval: VPN_REFETCH_MS,
  });
  const lastDetection = lastDetectionQuery.data?.[0]?.visitedAt ?? null;
  const savedMode = (selectedDomain as any)?.settings?.vpnBlockMode as string | undefined;

  return (
    <AppPage testId="page-vpn-shield">
      {/* Google's page format (owner, 2026-10-07): a quiet header, hairline cards, pill actions, stat tiles. */}
      <GoogleSectionHeader
        as="h1"
        titleTestId="text-vpn-page-title"
        title="VPN Shield"
        description={<>
          <span data-testid="text-vpn-subtitle">Review possible VPN or proxy traffic and choose how flagged visitors are handled. Browser overlays can be bypassed and may affect legitimate visitors.</span>
          {selectedDomain && <>{" "}<StatusPill tone="neutral" data-testid="badge-vpn-shield">{selectedDomain.name || selectedDomain.domain}</StatusPill></>}
        </>}
        flush
        actions={
          (domains?.length ?? 0) > 0 ? (
            <label className="block min-w-0 flex-1 space-y-1.5 text-sm sm:w-56 sm:flex-none">
              <span className="text-muted-foreground sm:hidden">Site</span>
              <select
                className="h-10 w-full rounded-full border bg-background px-4 text-sm"
                value={domainId || ""}
                onChange={(e) => setSelectedDomainId(Number(e.target.value))}
                aria-label="Site"
                data-testid="select-vpn-shield-domain"
              >
                {(domains ?? []).map(d => (
                  <option key={d.id} value={d.id}>{d.name || d.domain}</option>
                ))}
              </select>
            </label>
          ) : undefined
        }
      />

      {domainId && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border bg-card px-4 py-3" data-testid="strip-vpn-status">
          <span className="inline-flex items-center gap-1.5 text-sm">
            <span className={`h-2 w-2 rounded-full ${savedMode && savedMode !== "log" ? "bg-amber-500" : "bg-emerald-500"}`} />
            <span data-testid="text-vpn-mode" className="font-medium">
              {savedMode === "block" ? "Blocking: flagged visitors see an overlay"
                : savedMode === "redirect" ? "Blocking: flagged visitors are redirected"
                : savedMode === "log" ? "Log only: nothing is blocked"
                : "No mode saved yet"}
            </span>
          </span>
          <span className="text-xs text-muted-foreground" data-testid="text-vpn-last-detection">
            Last detection: {lastDetection ? formatTimeAgo(lastDetection) : "none yet"}
          </span>
          <span className="text-xs text-muted-foreground" data-testid="text-vpn-updated">
            {statsQuery.dataUpdatedAt ? `Updated ${formatTimeAgo(new Date(statsQuery.dataUpdatedAt).toISOString())}` : "Loading…"}
          </span>
          <span className="ml-auto flex items-center gap-2">
            {!savedMode && (
              <GooglePill
                size="sm"
                variant="solid"
                label="Start in Log only"
                onClick={() => apiRequest("POST", `/api/vpn-shield/domains/${domainId}/settings`, {
                  vpnBlockMode: "log",
                  vpnRedirectUrl: (selectedDomain as any)?.settings?.vpnRedirectUrl || "",
                  vpnWhitelistedIps: (selectedDomain as any)?.settings?.vpnWhitelistedIps || "",
                }).then(() => {
                  queryClient.invalidateQueries({ queryKey: ["/api/vpn-shield/domains"] });
                  toast({ title: "Log only enabled", description: "Detections are recorded without blocking. Change the mode any time in Settings." });
                }).catch((err: any) => {
                  toast({ title: "Could not save settings", description: apiErrorMessage(err, "Failed to save settings."), variant: "destructive" });
                })}
                testId="button-vpn-start-log-only"
              />
            )}
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs"
              disabled={statsQuery.isFetching || lastDetectionQuery.isFetching}
              onClick={() => { void statsQuery.refetch(); void lastDetectionQuery.refetch(); }}
              data-testid="button-refresh-vpn"
            >
              Refresh
            </Button>
          </span>
        </div>
      )}

      <ToolTabs as="tablist" label="VPN Shield sections">
        {tabs.map(tab => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            role="tab"
            aria-selected={activeTab === tab.id}
            data-testid={`tab-vpn-${tab.id}`}
          >
            {tab.label}
          </button>
        ))}
      </ToolTabs>

      {domainsLoading ? (
        <div className="flex items-center justify-center py-20">
          <div className="animate-spin h-8 w-8 border-2 border-primary border-t-transparent rounded-full" />
        </div>
      ) : domainsError ? (
        <Notice tone="danger" title="Couldn't load your sites" testId="notice-vpn-domains-error"
          action={<Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => void domainsQuery.refetch()} data-testid="button-retry-vpn-domains">Retry</Button>}>
          {apiErrorMessage(domainsQuery.error, "The site list could not be loaded.")} This is a failed request, not an empty account.
        </Notice>
      ) : (
        <>
          {(domains?.length ?? 0) === 0 && (
            <SetupCard onCreated={(id) => {
              setSelectedDomainId(id);
              setActiveTab("install");
            }} />
          )}

          {activeTab === "overview" && (
            <OverviewTab domainId={domainId} statsQuery={statsQuery} />
          )}

          {activeTab === "blocked" && (
            <BlockedVisitorsTab key={domainId ?? "none"} domainId={domainId} />
          )}

          {activeTab === "install" && (
            <InstallScriptTab
              domains={domains ?? []}
              selectedDomainId={domainId}
              setSelectedDomainId={setSelectedDomainId}
              detections={statsQuery.data?.total}
              statsError={statsQuery.isError && !statsQuery.data}
            />
          )}

          {activeTab === "settings" && (
            // Keyed by site: the form seeds its state once, so each site needs a fresh form.
            <SettingsTab key={domainId ?? "none"} domainId={domainId} domains={domains ?? []} />
          )}
        </>
      )}
    </AppPage>
  );
}
