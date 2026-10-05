import { useAppOrigin } from "@/lib/app-origin";
import { useState } from "react";
import { Link, useLocation, useSearch } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiErrorMessage, apiRequest, queryClient } from "@/lib/queryClient";
import {
  AppPage,
  PageHeader,
  Section,
  Notice,
  Stat,
  StatGrid,
  StatusPill,
} from "@/components/app-ui";
import {
  AlertTriangle,
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

function NoSiteCard() {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border bg-card py-14 text-center" data-testid="card-vpn-no-site">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <AlertTriangle className="h-5 w-5" strokeWidth={1.6} />
      </div>
      <div className="mt-3 text-sm font-medium">No site yet</div>
      <p className="mt-1 max-w-sm text-sm text-muted-foreground" data-testid="text-no-domain-selected">
        VPN Shield uses the sites you track. Add one in{" "}
        <Link href="/ip-tracker" className="text-primary underline underline-offset-2" data-testid="link-vpn-add-site-ip-tracker">IP Tracker</Link>
        {" "}or{" "}
        <Link href="/google-ads" className="text-primary underline underline-offset-2" data-testid="link-vpn-add-site-click-guard">Google Click Guard</Link>
        , then come back here to install VPN Shield and choose its settings.
      </p>
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

function OverviewTab({ domainId, stats }: { domainId: number | null; stats: VpnStats | undefined }) {
  // The stats endpoint counts every detection; split them by the action that was taken.
  const { data: visits } = useQuery<VpnVisit[]>({
    queryKey: ["/api/vpn-shield/domains", domainId, "blocked-visits"],
    enabled: !!domainId,
  });
  const blockedCount = visits ? visits.filter(v => v.action === "block").length : null;

  return (
    <div className="space-y-4 sm:space-y-5">
      <Notice>
        <span data-testid="text-crawler-notice">
          <span className="font-semibold">Search engine crawlers</span>{" "}
          (Google, Bing, Yahoo) are exempted by user-agent matching, which can
          be spoofed. VPN detection is heuristic.
        </span>
      </Notice>

      <StatGrid cols={4}>
        <Stat label="Detections" testId="card-stat-detections"
          value={stats?.total ?? 0}
          hint="All time, any action" />
        <Stat label="Detections today" testId="card-stat-detections-today"
          value={stats?.today ?? 0} />
        <Stat label="Blocked" testId="card-stat-blocked"
          value={domainId ? (blockedCount ?? "…") : 0}
          hint="Overlay shown" />
        <Stat label="Unique VPN IPs" testId="card-stat-unique-vpn-ips"
          value={stats?.uniqueIps ?? 0}
          hint="All time" />
      </StatGrid>

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
                  <span className="truncate">{c.name}</span>
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

  const { data: visits = [], isLoading } = useQuery<VpnVisit[]>({
    queryKey: ["/api/vpn-shield/domains", domainId, "blocked-visits"],
    enabled: !!domainId,
  });

  const filtered = ipSearch ? visits.filter(v => v.ipAddress.includes(ipSearch)) : visits;
  const totalPages = Math.ceil(filtered.length / perPage);
  const paginated = filtered.slice((page - 1) * perPage, page * perPage);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-0 flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search by IP address…"
            value={ipSearch}
            onChange={e => { setIpSearch(e.target.value); setPage(1); }}
            className="pl-9"
            data-testid="input-vpn-ip-search"
          />
        </div>
        <span className="text-sm tabular-nums text-muted-foreground" data-testid="badge-vpn-visit-count">
          {filtered.length} flagged visit{filtered.length !== 1 ? "s" : ""}
          {" · "}{filtered.filter(v => v.action === "block").length} blocked
        </span>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12">
          <div className="animate-spin h-6 w-6 border-2 border-foreground border-t-transparent rounded-full" />
        </div>
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
              <div
                className="cursor-pointer p-4 hover:bg-muted/30 transition-colors"
                onClick={() => setExpandedId(expandedId === v.id ? null : v.id)}
              >
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-sm font-medium" data-testid={`text-vpn-ip-${v.id}`}>
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
                            <MapPin className="h-3 w-3" /> {[v.city, v.country].filter(Boolean).join(", ")}
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
              </div>

              {expandedId === v.id && (
                <div className="border-t bg-muted/20 p-4">
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
                      <div className="flex justify-between gap-4"><span className="text-muted-foreground">Country</span><span className="font-medium">{v.country || "Unknown"}</span></div>
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
            Showing {(page - 1) * perPage + 1}-{Math.min(page * perPage, filtered.length)} of {filtered.length}
          </span>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)} data-testid="button-vpn-prev-page">Prev</Button>
            <span className="text-sm tabular-nums text-muted-foreground">Page {page} / {totalPages}</span>
            <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)} data-testid="button-vpn-next-page">Next</Button>
          </div>
        </div>
      )}
    </div>
  );
}

function InstallScriptTab({ domains, selectedDomainId, setSelectedDomainId }: {
  domains: VpnDomain[];
  selectedDomainId: number | null;
  setSelectedDomainId: (id: number) => void;
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
                data-testid="button-copy-vpn-script"
              >
                <Copy className="h-4 w-4" />
              </Button>
            </div>
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

  const [blockMode, setBlockMode] = useState(settings.vpnBlockMode || "block");
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
        description="Choose how the browser script responds to possible proxy signals after page load."
      >
        <div className="space-y-2">
          {[
            { value: "block", label: "Block", desc: "Show an overlay to flagged browsers" },
            { value: "log", label: "Log only", desc: "Record VPN visits but don't block them" },
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
        <Button
          onClick={() => saveMutation.mutate()}
          disabled={!domainId || saveMutation.isPending || !!redirectError || !!whitelistError}
          data-testid="button-save-vpn-settings"
        >
          {saveMutation.isPending ? "Saving…" : "Save settings"}
        </Button>
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
  const { params, set: setUrlParam } = useUrlState();
  const tabParam = params.get("tab");
  const activeTab: TabId = tabs.some(t => t.id === tabParam) ? (tabParam as TabId) : "overview";
  const setActiveTab = (tab: TabId) => setUrlParam("tab", tab === "overview" ? null : tab);
  const selectedDomainId = Number(params.get("site")) || null;
  const setSelectedDomainId = (id: number | null) => setUrlParam("site", id ? String(id) : null);

  const { data: domains = [], isLoading: domainsLoading } = useQuery<VpnDomain[]>({
    queryKey: ["/api/vpn-shield/domains"],
  });

  const selectedDomain = domains.find(d => d.id === selectedDomainId) || domains[0];
  const domainId = selectedDomain?.id ?? null;

  const { data: stats } = useQuery<VpnStats>({
    queryKey: ["/api/vpn-shield/domains", domainId, "stats"],
    enabled: !!domainId,
  });

  return (
    <AppPage testId="page-vpn-shield">
      <PageHeader
        title={<span data-testid="text-vpn-page-title">VPN Shield</span>}
        description={<span data-testid="text-vpn-subtitle">Review possible VPN or proxy traffic and choose how flagged visitors are handled. Browser overlays can be bypassed and may affect legitimate visitors.</span>}
        meta={selectedDomain ? (
          <StatusPill tone="neutral" data-testid="badge-vpn-shield">
            {selectedDomain.name || selectedDomain.domain}
          </StatusPill>
        ) : undefined}
        actions={
          domains.length > 0 ? (
            <label className="block min-w-0 flex-1 space-y-1.5 text-sm sm:w-56 sm:flex-none">
              <span className="text-muted-foreground sm:hidden">Site</span>
              <select
                className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                value={domainId || ""}
                onChange={(e) => setSelectedDomainId(Number(e.target.value))}
                aria-label="Site"
                data-testid="select-vpn-shield-domain"
              >
                {domains.map(d => (
                  <option key={d.id} value={d.id}>{d.name || d.domain}</option>
                ))}
              </select>
            </label>
          ) : undefined
        }
      />

      {/* Scrolls sideways on phones instead of wrapping. */}
      <div className="-mx-4 overflow-x-auto px-4 scrollbar-none sm:mx-0 sm:px-0">
        <div className="inline-flex h-10 w-max min-w-full gap-1 rounded-xl bg-muted p-1 sm:min-w-0" role="tablist">
          {tabs.map(tab => (
            <Button
              key={tab.id}
              variant="ghost"
              className={`h-8 shrink-0 rounded-lg px-3.5 font-medium ${activeTab === tab.id ? "bg-background text-primary font-semibold shadow-sm hover:bg-background" : "text-muted-foreground hover:bg-background/60 hover:text-foreground"}`}
              onClick={() => setActiveTab(tab.id)}
              role="tab"
              aria-selected={activeTab === tab.id}
              data-testid={`tab-vpn-${tab.id}`}
            >
              {tab.label}
            </Button>
          ))}
        </div>
      </div>

      {domainsLoading ? (
        <div className="flex items-center justify-center py-20">
          <div className="animate-spin h-8 w-8 border-2 border-primary border-t-transparent rounded-full" />
        </div>
      ) : (
        <>
          {domains.length === 0 && <NoSiteCard />}

          {activeTab === "overview" && (
            <OverviewTab domainId={domainId} stats={stats} />
          )}

          {activeTab === "blocked" && (
            <BlockedVisitorsTab domainId={domainId} />
          )}

          {activeTab === "install" && (
            <InstallScriptTab
              domains={domains}
              selectedDomainId={domainId}
              setSelectedDomainId={setSelectedDomainId}
            />
          )}

          {activeTab === "settings" && (
            // Keyed by site: the form seeds its state once, so each site needs a fresh form.
            <SettingsTab key={domainId ?? "none"} domainId={domainId} domains={domains} />
          )}
        </>
      )}
    </AppPage>
  );
}
