import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  ShieldOff, BarChart3, Eye, Bot, Building, Search,
  ChevronRight, Copy, Globe, Monitor, Smartphone, Tablet,
  MapPin, Fingerprint, Clock, AlertTriangle, Shield,
  Code2, Settings2, Info, CheckCircle,
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
  { id: "overview", label: "Overview", icon: BarChart3 },
  { id: "blocked", label: "Blocked Visitors", icon: ShieldOff },
  { id: "install", label: "Install Script", icon: Code2 },
  { id: "settings", label: "Settings", icon: Settings2 },
] as const;

type TabId = typeof tabs[number]["id"];

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

function StatCard({ label, value, icon: Icon, sub }: { label: string; value: string | number; icon: any; sub?: string }) {
  return (
    <Card className="border-orange-500/10" data-testid={`card-stat-${label.toLowerCase().replace(/\s+/g, "-")}`}>
      <CardContent className="p-3 sm:p-4">
        <div className="flex items-center justify-between gap-1 mb-2">
          <span className="text-[10px] sm:text-xs font-medium text-muted-foreground">{label}</span>
          <Icon className="h-4 w-4 text-orange-500/60" />
        </div>
        <div className="text-xl sm:text-2xl font-bold text-foreground tabular-nums truncate">{value}</div>
        {sub && <p className="text-[10px] text-muted-foreground mt-1">{sub}</p>}
      </CardContent>
    </Card>
  );
}

function OverviewTab({ domainId, stats }: { domainId: number | null; stats: VpnStats | undefined }) {
  return (
    <div className="space-y-4 sm:space-y-6">
      <Card className="border-orange-500/20 bg-gradient-to-br from-orange-500/5 to-yellow-500/5">
        <CardContent className="p-4 sm:p-6">
          <h2 className="text-lg sm:text-xl font-bold text-foreground mb-1" data-testid="text-hero-title">
            Protect Your Data From Invisible Threats
          </h2>
          <p className="text-sm text-muted-foreground mb-4 sm:mb-6">
            VPN Shield detects and blocks anonymous visitors who hide behind VPNs and proxies, keeping your analytics clean and your business safe.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="flex gap-3">
              <div className="w-10 h-10 rounded-md bg-orange-500/10 flex items-center justify-center shrink-0">
                <BarChart3 className="h-5 w-5 text-orange-500" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-foreground" data-testid="text-feature-analytics">Stop Fake Analytics</h3>
                <p className="text-xs text-muted-foreground mt-0.5">VPNs pollute your data. Marketing decisions based on fiction cost real money.</p>
              </div>
            </div>
            <div className="flex gap-3">
              <div className="w-10 h-10 rounded-md bg-yellow-500/10 flex items-center justify-center shrink-0">
                <Eye className="h-5 w-5 text-yellow-600 dark:text-yellow-500" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-foreground" data-testid="text-feature-snooping">Expose Competitor Snooping</h3>
                <p className="text-xs text-muted-foreground mt-0.5">Competitors anonymously spy on your site, steal ideas and pricing. VPN Shield identifies them.</p>
              </div>
            </div>
            <div className="flex gap-3">
              <div className="w-10 h-10 rounded-md bg-orange-500/10 flex items-center justify-center shrink-0">
                <Bot className="h-5 w-5 text-orange-500" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-foreground" data-testid="text-feature-bots">Block Proxy Bot Traffic</h3>
                <p className="text-xs text-muted-foreground mt-0.5">Proxy networks are used for scraping, click fraud, and fake leads.</p>
              </div>
            </div>
            <div className="flex gap-3">
              <div className="w-10 h-10 rounded-md bg-yellow-500/10 flex items-center justify-center shrink-0">
                <Building className="h-5 w-5 text-yellow-600 dark:text-yellow-500" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-foreground" data-testid="text-feature-enterprise">Enterprise-Grade Protection</h3>
                <p className="text-xs text-muted-foreground mt-0.5">The most advanced internet companies use VPN blockers. Now available for construction.</p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="border-orange-500/20">
        <CardContent className="p-3 sm:p-4 flex items-start sm:items-center gap-3">
          <CheckCircle className="h-5 w-5 text-orange-500 shrink-0 mt-0.5 sm:mt-0" />
          <p className="text-xs sm:text-sm text-foreground" data-testid="text-crawler-notice">
            <span className="font-semibold">Search engine crawlers</span> (Google, Bing, Yahoo) are <span className="font-semibold">NEVER</span> blocked. Only VPNs and proxies are detected.
          </p>
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3">
        <StatCard label="Total Blocks" value={stats?.total ?? 0} icon={ShieldOff} />
        <StatCard label="Blocks Today" value={stats?.today ?? 0} icon={Clock} />
        <StatCard label="Unique VPN IPs" value={stats?.uniqueIps ?? 0} icon={Fingerprint} sub="All time" />
        <StatCard label="Top Provider" value={stats?.topProviders?.[0]?.name ?? "None"} icon={Globe} sub={stats?.topProviders?.[0] ? `${stats.topProviders[0].count} blocks` : undefined} />
      </div>

      {stats && stats.topProviders.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold">Top VPN Providers</CardTitle>
            </CardHeader>
            <CardContent className="p-4 pt-0">
              <div className="space-y-2">
                {stats.topProviders.slice(0, 8).map(p => (
                  <div key={p.name} className="flex items-center justify-between gap-2 text-sm">
                    <span className="text-foreground truncate">{p.name}</span>
                    <Badge variant="outline" className="text-muted-foreground tabular-nums shrink-0">{p.count}</Badge>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold">Top Countries</CardTitle>
            </CardHeader>
            <CardContent className="p-4 pt-0">
              <div className="space-y-2">
                {stats.topCountries.slice(0, 8).map(c => (
                  <div key={c.name} className="flex items-center justify-between gap-2 text-sm">
                    <span className="text-foreground truncate">{c.name}</span>
                    <Badge variant="outline" className="text-muted-foreground tabular-nums shrink-0">{c.count}</Badge>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
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
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by IP address..."
            value={ipSearch}
            onChange={e => { setIpSearch(e.target.value); setPage(1); }}
            className="pl-9"
            data-testid="input-vpn-ip-search"
          />
        </div>
        <Badge variant="outline" className="text-muted-foreground" data-testid="badge-vpn-visit-count">
          {filtered.length} blocked visit{filtered.length !== 1 ? "s" : ""}
        </Badge>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12">
          <div className="animate-spin h-6 w-6 border-2 border-foreground border-t-transparent rounded-full" />
        </div>
      ) : paginated.length === 0 ? (
        <Card className="p-8 text-center">
          <ShieldOff className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
          <p className="text-muted-foreground text-sm" data-testid="text-no-vpn-visits">No blocked VPN visits found</p>
        </Card>
      ) : (
        <div className="space-y-2">
          {paginated.map(v => (
            <Card
              key={v.id}
              className={`transition-all ${expandedId === v.id ? "ring-1 ring-border" : ""}`}
              data-testid={`card-vpn-visit-${v.id}`}
            >
              <div
                className="p-4 cursor-pointer hover:bg-muted/30 transition-colors"
                onClick={() => setExpandedId(expandedId === v.id ? null : v.id)}
              >
                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono text-sm font-medium text-foreground" data-testid={`text-vpn-ip-${v.id}`}>
                          {v.ipAddress}
                        </span>
                        {v.vpnProvider && (
                          <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                            {v.vpnProvider}
                          </Badge>
                        )}
                        <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                          {v.detectionMethod}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-3 text-xs text-muted-foreground mt-0.5 flex-wrap">
                        {v.fingerprint && (
                          <span className="flex items-center gap-1">
                            <Fingerprint className="h-3 w-3" /> {v.fingerprint.slice(0, 12)}...
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
                  <div className="hidden sm:flex items-center gap-4 text-xs text-muted-foreground shrink-0">
                    <div className="flex items-center gap-1.5">
                      <DeviceIcon type={v.deviceType} />
                      <span>{v.browser || "Unknown"}</span>
                    </div>
                  </div>
                  <ChevronRight className={`h-4 w-4 text-muted-foreground shrink-0 transition-transform ${expandedId === v.id ? "rotate-90" : ""}`} />
                </div>
              </div>

              {expandedId === v.id && (
                <div className="border-t border-border p-4 bg-muted/20">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="space-y-2 text-sm">
                      <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Detection Details</h4>
                      <div className="flex justify-between"><span className="text-muted-foreground">IP Address</span><span className="font-mono font-medium text-foreground">{v.ipAddress}</span></div>
                      <div className="flex justify-between"><span className="text-muted-foreground">VPN Provider</span><span className="font-medium text-foreground">{v.vpnProvider || "Unknown"}</span></div>
                      <div className="flex justify-between"><span className="text-muted-foreground">Detection Method</span><span className="font-medium text-foreground">{v.detectionMethod}</span></div>
                      <div className="flex justify-between"><span className="text-muted-foreground">Action</span><span className="font-medium text-foreground capitalize">{v.action}</span></div>
                      <div className="flex justify-between"><span className="text-muted-foreground">Fingerprint</span><span className="font-mono text-xs text-foreground truncate max-w-[200px]">{v.fingerprint || "N/A"}</span></div>
                      <div className="flex justify-between"><span className="text-muted-foreground">Time</span><span className="text-foreground">{formatDate(v.visitedAt)}</span></div>
                    </div>
                    <div className="space-y-2 text-sm">
                      <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Visitor Details</h4>
                      <div className="flex justify-between"><span className="text-muted-foreground">Browser</span><span className="font-medium text-foreground">{v.browser || "Unknown"}</span></div>
                      <div className="flex justify-between"><span className="text-muted-foreground">OS</span><span className="font-medium text-foreground">{v.os || "Unknown"}</span></div>
                      <div className="flex justify-between"><span className="text-muted-foreground">Device</span><span className="font-medium text-foreground">{v.deviceType || "Unknown"}</span></div>
                      <div className="flex justify-between"><span className="text-muted-foreground">Country</span><span className="font-medium text-foreground">{v.country || "Unknown"}</span></div>
                      <div className="flex justify-between"><span className="text-muted-foreground">City</span><span className="font-medium text-foreground">{v.city || "Unknown"}</span></div>
                      <div className="flex justify-between"><span className="text-muted-foreground">Landing Page</span><span className="text-foreground truncate max-w-[200px]">{v.landingPage || "Unknown"}</span></div>
                      <div className="flex justify-between"><span className="text-muted-foreground">Referrer</span><span className="text-foreground truncate max-w-[200px]">{v.referrer || "Direct"}</span></div>
                      {v.userAgent && (
                        <>
                          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 mt-4">User Agent</h4>
                          <p className="text-[11px] text-muted-foreground font-mono break-all bg-muted rounded-md p-2">
                            {v.userAgent}
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
        <div className="flex items-center justify-between gap-2 pt-2 flex-wrap">
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
  const { toast } = useToast();
  const selectedDomain = domains.find(d => d.id === selectedDomainId);

  const scriptSnippet = selectedDomain
    ? `<!-- VPN Shield by ConstructHUB -->\n<script src="https://constructhub.us/api/vpn-shield/script/${selectedDomain.trackingId}" async></script>`
    : "";

  const copyScript = () => {
    navigator.clipboard.writeText(scriptSnippet);
    toast({ title: "Copied!", description: "VPN Shield script copied to clipboard." });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3 flex-wrap">
        <label className="text-sm font-medium text-foreground">Select Domain:</label>
        <select
          className="bg-card border border-border text-foreground text-sm rounded-md px-3 py-2 outline-none"
          value={selectedDomainId || ""}
          onChange={(e) => setSelectedDomainId(Number(e.target.value))}
          data-testid="select-vpn-domain"
        >
          {domains.map(d => (
            <option key={d.id} value={d.id}>{d.name || d.domain}</option>
          ))}
        </select>
      </div>

      {selectedDomain ? (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">Installation Code</CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0 space-y-3">
            <p className="text-xs text-muted-foreground">
              Add this script tag to the <code className="bg-muted px-1 py-0.5 rounded text-foreground">&lt;head&gt;</code> or before the closing <code className="bg-muted px-1 py-0.5 rounded text-foreground">&lt;/body&gt;</code> tag of your website.
            </p>
            <div className="relative">
              <pre className="bg-muted rounded-md p-4 text-xs font-mono text-foreground overflow-x-auto" data-testid="text-vpn-script-code">
                {scriptSnippet}
              </pre>
              <Button
                size="icon"
                variant="ghost"
                className="absolute top-2 right-2"
                onClick={copyScript}
                data-testid="button-copy-vpn-script"
              >
                <Copy className="h-4 w-4" />
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card className="p-8 text-center">
          <AlertTriangle className="h-8 w-8 text-orange-400 mx-auto mb-2" />
          <p className="text-muted-foreground text-sm" data-testid="text-no-domain-selected">
            Add a domain in Google Click Guard first, then come back here to install VPN Shield.
          </p>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold">How Detection Works</CardTitle>
        </CardHeader>
        <CardContent className="p-4 pt-0">
          <div className="space-y-4">
            <div className="flex gap-3">
              <div className="w-8 h-8 rounded-md bg-orange-500/10 flex items-center justify-center shrink-0">
                <Globe className="h-4 w-4 text-orange-500" />
              </div>
              <div>
                <h4 className="text-sm font-semibold text-foreground" data-testid="text-detection-webrtc">WebRTC IP Leak Detection</h4>
                <p className="text-xs text-muted-foreground">Compares the visitor's public IP with their WebRTC-revealed IP. A mismatch indicates VPN usage.</p>
              </div>
            </div>
            <div className="flex gap-3">
              <div className="w-8 h-8 rounded-md bg-yellow-500/10 flex items-center justify-center shrink-0">
                <Clock className="h-4 w-4 text-yellow-600 dark:text-yellow-500" />
              </div>
              <div>
                <h4 className="text-sm font-semibold text-foreground" data-testid="text-detection-timezone">Timezone / Geo Mismatch</h4>
                <p className="text-xs text-muted-foreground">Checks if the browser's timezone matches the geographic location of the IP address. Mismatches reveal VPN tunnels.</p>
              </div>
            </div>
            <div className="flex gap-3">
              <div className="w-8 h-8 rounded-md bg-orange-500/10 flex items-center justify-center shrink-0">
                <Shield className="h-4 w-4 text-orange-500" />
              </div>
              <div>
                <h4 className="text-sm font-semibold text-foreground" data-testid="text-detection-datacenter">Datacenter IP Range Detection</h4>
                <p className="text-xs text-muted-foreground">Cross-references visitor IPs against known datacenter and VPN provider IP ranges (AWS, Azure, DigitalOcean, etc.).</p>
              </div>
            </div>
            <div className="flex gap-3">
              <div className="w-8 h-8 rounded-md bg-yellow-500/10 flex items-center justify-center shrink-0">
                <Fingerprint className="h-4 w-4 text-yellow-600 dark:text-yellow-500" />
              </div>
              <div>
                <h4 className="text-sm font-semibold text-foreground" data-testid="text-detection-extensions">VPN Extension Detection</h4>
                <p className="text-xs text-muted-foreground">Detects common VPN browser extensions that inject themselves into pages. Identifies popular VPN tools.</p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function SettingsTab({ domainId, domains }: { domainId: number | null; domains: VpnDomain[] }) {
  const { toast } = useToast();
  const domain = domains.find(d => d.id === domainId);
  const settings = (domain as any)?.settings || {};

  const [blockMode, setBlockMode] = useState(settings.vpnBlockMode || "block");
  const [redirectUrl, setRedirectUrl] = useState(settings.vpnRedirectUrl || "");
  const [whitelistedIps, setWhitelistedIps] = useState(settings.vpnWhitelistedIps || "");

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
    onError: () => {
      toast({ title: "Error", description: "Failed to save settings.", variant: "destructive" });
    },
  });

  return (
    <div className="space-y-6 max-w-2xl">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold">Block Mode</CardTitle>
        </CardHeader>
        <CardContent className="p-4 pt-0 space-y-3">
          <p className="text-xs text-muted-foreground">Choose how to handle detected VPN/proxy visitors.</p>
          <div className="space-y-2">
            {[
              { value: "block", label: "Block", desc: "Show a blocked page to VPN visitors" },
              { value: "log", label: "Log Only", desc: "Record VPN visits but don't block them" },
              { value: "redirect", label: "Redirect", desc: "Redirect VPN visitors to a custom URL" },
            ].map(opt => (
              <label
                key={opt.value}
                className={`flex items-start gap-3 p-3 rounded-md border cursor-pointer transition-colors ${
                  blockMode === opt.value ? "border-foreground/30 bg-muted/50" : "border-border"
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
                  <span className="text-sm font-medium text-foreground">{opt.label}</span>
                  <p className="text-xs text-muted-foreground">{opt.desc}</p>
                </div>
              </label>
            ))}
          </div>
        </CardContent>
      </Card>

      {blockMode === "redirect" && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">Redirect URL</CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            <Input
              placeholder="https://example.com/blocked"
              value={redirectUrl}
              onChange={e => setRedirectUrl(e.target.value)}
              data-testid="input-redirect-url"
            />
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold">Whitelisted IPs</CardTitle>
        </CardHeader>
        <CardContent className="p-4 pt-0 space-y-3">
          <p className="text-xs text-muted-foreground">
            Enter IP addresses that should never be blocked, one per line. Useful for your office VPN or testing.
          </p>
          <Textarea
            placeholder={"192.168.1.1\n10.0.0.1"}
            value={whitelistedIps}
            onChange={e => setWhitelistedIps(e.target.value)}
            className="font-mono text-sm resize-none"
            rows={5}
            data-testid="textarea-whitelisted-ips"
          />
        </CardContent>
      </Card>

      <Card className="border-border/60">
        <CardContent className="p-4 flex items-center gap-3">
          <Info className="h-5 w-5 text-muted-foreground shrink-0" />
          <p className="text-sm text-foreground" data-testid="text-settings-crawler-whitelist">
            <span className="font-semibold">Crawler Whitelist:</span> Googlebot, Bingbot, Yahoo Slurp, DuckDuckBot, Baiduspider, and other search engine crawlers are automatically whitelisted and will never be blocked.
          </p>
        </CardContent>
      </Card>

      <Button
        className="bg-gradient-to-r from-orange-500 to-yellow-500 text-white hover:from-orange-600 hover:to-yellow-600"
        onClick={() => saveMutation.mutate()}
        disabled={!domainId || saveMutation.isPending}
        data-testid="button-save-vpn-settings"
      >
        {saveMutation.isPending ? "Saving..." : "Save Settings"}
      </Button>
    </div>
  );
}

export default function VpnShieldPage() {
  const [activeTab, setActiveTab] = useState<TabId>("overview");
  const [selectedDomainId, setSelectedDomainId] = useState<number | null>(null);

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
    <div className="h-full overflow-y-auto bg-background text-foreground overflow-x-hidden">
      <section className="relative z-10 pt-6 sm:pt-8 pb-8 sm:pb-12 px-3 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto">
          <div className="flex flex-col gap-4 mb-6">
            <div>
              <div className="flex items-center gap-3 mb-2">
                <div className="h-9 w-9 rounded-lg bg-gradient-to-br from-orange-500 to-yellow-500 flex items-center justify-center shrink-0">
                  <ShieldOff className="h-5 w-5 text-white" />
                </div>
                <Badge className="bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-500/20 px-3 py-1 text-sm" data-testid="badge-vpn-shield">
                  <Shield className="h-3.5 w-3.5 mr-1.5" /> VPN Shield
                </Badge>
              </div>
              <h1 className="text-2xl sm:text-3xl md:text-4xl font-extrabold tracking-tight" data-testid="text-vpn-page-title">
                <span className="text-foreground">VPN </span>
                <span className="bg-gradient-to-r from-orange-500 to-yellow-500 bg-clip-text text-transparent">Shield</span>
              </h1>
              <p className="mt-2 text-muted-foreground max-w-xl text-sm" data-testid="text-vpn-subtitle">
                Detect and block VPN, proxy, and anonymous visitors. Protect your analytics data and expose competitor snooping.
              </p>
            </div>

            {domains.length > 0 && (
              <div className="flex flex-wrap items-center gap-2">
                <select
                  className="bg-card border border-border text-foreground text-sm rounded-md px-3 py-2 outline-none min-w-0 max-w-[200px]"
                  value={domainId || ""}
                  onChange={(e) => setSelectedDomainId(Number(e.target.value))}
                  data-testid="select-vpn-shield-domain"
                >
                  {domains.map(d => (
                    <option key={d.id} value={d.id}>{d.name || d.domain}</option>
                  ))}
                </select>
              </div>
            )}
          </div>

          <div className="flex items-center gap-1 mb-6 bg-card border border-border rounded-md p-1 overflow-x-auto -mx-3 px-3 sm:mx-0 sm:px-0 sm:w-fit scrollbar-none">
            {tabs.map(tab => {
              const TabIcon = tab.icon;
              return (
                <Button
                  key={tab.id}
                  size="sm"
                  variant={activeTab === tab.id ? "default" : "ghost"}
                  className={`shrink-0 text-xs sm:text-sm ${activeTab === tab.id
                    ? "bg-gradient-to-r from-orange-500 to-yellow-500 text-white hover:from-orange-600 hover:to-yellow-600 border-0"
                    : "text-muted-foreground"
                  }`}
                  onClick={() => setActiveTab(tab.id)}
                  data-testid={`tab-vpn-${tab.id}`}
                >
                  <TabIcon className="h-3.5 w-3.5 mr-1.5" />
                  {tab.label}
                </Button>
              );
            })}
          </div>

          {domainsLoading ? (
            <div className="flex items-center justify-center py-20">
              <div className="animate-spin h-8 w-8 border-2 border-orange-500 border-t-transparent rounded-full" />
            </div>
          ) : (
            <>
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
                <SettingsTab domainId={domainId} domains={domains} />
              )}
            </>
          )}
        </div>
      </section>
    </div>
  );
}