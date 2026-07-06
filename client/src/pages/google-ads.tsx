import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Shield, ShieldCheck, Plus, Trash2, Copy, Globe, Eye,
  Ban, Users, BarChart3, Monitor, Smartphone, Tablet,
  AlertTriangle, CheckCircle, X, Search, Download, RefreshCw,
  Crosshair, Code2, Zap, Settings2, MapPin, Fingerprint, Bot,
  ShieldBan, Activity, Target, Link2,
  ChevronRight, DollarSign, MousePointerClick,
  FileText, BookOpen, ArrowRight,
} from "lucide-react";
import googleAdsLogo from "@assets/google-ads-logo.png";

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

type ClickVisit = {
  id: number;
  domainId: number;
  ipAddress: string;
  userAgent: string | null;
  deviceType: string | null;
  browser: string | null;
  os: string | null;
  screenResolution: string | null;
  language: string | null;
  referrer: string | null;
  landingPage: string | null;
  isSuspicious: boolean;
  suspicionReasons: string[] | null;
  fingerprint: string | null;
  visitedAt: string;
};

type BlockedIp = {
  id: number;
  domainId: number;
  ipAddress: string;
  reason: string | null;
  blockedAt: string;
  isActive: boolean;
  source: string;
};

const FRAUD_TABS = ["Blocked IPs", "Countries", "Multi-Clicks", "Devices", "Browsers", "OS"];

export default function ClickGuardPage() {
  const { toast } = useToast();
  const [selectedDomainId, setSelectedDomainId] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState<"dashboard" | "traffic" | "fraud" | "tools" | "settings" | "link-ads">("dashboard");
  const [fraudTab, setFraudTab] = useState("Blocked IPs");
  const [dateRange, setDateRange] = useState("7d");
  const [showAddDomain, setShowAddDomain] = useState(false);
  const [newDomain, setNewDomain] = useState("");
  const [newDomainName, setNewDomainName] = useState("");
  const [ipSearch, setIpSearch] = useState("");
  const [blockIpInput, setBlockIpInput] = useState("");

  const { data: domains = [], isLoading: domainsLoading } = useQuery<DomainWithStats[]>({
    queryKey: ["/api/click-guard/domains"],
  });

  const selectedDomain = domains.find(d => d.id === selectedDomainId) || domains[0];
  const domainId = selectedDomain?.id;

  const dateStart = new Date(Date.now() - (dateRange === "7d" ? 7 : dateRange === "30d" ? 30 : 1) * 24 * 60 * 60 * 1000).toISOString();
  const dateEnd = new Date().toISOString();

  const { data: analytics } = useQuery<Analytics>({
    queryKey: ["/api/click-guard/domains", domainId, "analytics", dateRange],
    queryFn: () => fetch(`/api/click-guard/domains/${domainId}/analytics?start=${dateStart}&end=${dateEnd}`).then(r => r.json()),
    enabled: !!domainId,
  });

  const { data: visits = [] } = useQuery<ClickVisit[]>({
    queryKey: ["/api/click-guard/domains", domainId, "visits"],
    queryFn: () => fetch(`/api/click-guard/domains/${domainId}/visits?start=${dateStart}&end=${dateEnd}`).then(r => r.json()),
    enabled: !!domainId,
  });

  const { data: blockedIps = [] } = useQuery<BlockedIp[]>({
    queryKey: ["/api/click-guard/domains", domainId, "blocked"],
    enabled: !!domainId,
  });

  const addDomainMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/click-guard/domains", { domain: newDomain, name: newDomainName || newDomain });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/click-guard/domains"] });
      setShowAddDomain(false);
      setNewDomain("");
      setNewDomainName("");
      toast({ title: "Domain added", description: "Your domain is now being tracked." });
    },
  });

  const deleteDomainMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/click-guard/domains/${id}`);
      return id;
    },
    onSuccess: (deletedId) => {
      queryClient.invalidateQueries({ queryKey: ["/api/click-guard/domains"] });
      const remaining = domains.filter(d => d.id !== deletedId);
      if (remaining.length > 0) {
        setSelectedDomainId(remaining[0].id);
      } else {
        setSelectedDomainId(null);
      }
      toast({ title: "Domain removed" });
    },
  });

  const blockIpMutation = useMutation({
    mutationFn: async (ipAddress: string) => {
      const res = await apiRequest("POST", `/api/click-guard/domains/${domainId}/block`, { ipAddress, reason: "Manually blocked" });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/click-guard/domains", domainId, "blocked"] });
      queryClient.invalidateQueries({ queryKey: ["/api/click-guard/domains", domainId, "analytics"] });
      setBlockIpInput("");
      toast({ title: "IP blocked" });
    },
    onError: () => {
      toast({ title: "Failed to block IP", variant: "destructive" });
    },
  });

  const unblockIpMutation = useMutation({
    mutationFn: async (blockId: number) => {
      await apiRequest("DELETE", `/api/click-guard/domains/${domainId}/block/${blockId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/click-guard/domains", domainId, "blocked"] });
      queryClient.invalidateQueries({ queryKey: ["/api/click-guard/domains", domainId, "analytics"] });
      toast({ title: "IP unblocked" });
    },
  });

  const scriptSnippet = selectedDomain
    ? `<script src="https://constructhub.us/api/click-guard/script/${selectedDomain.trackingId}" async></script>`
    : "";

  const copyScript = () => {
    navigator.clipboard.writeText(scriptSnippet);
    toast({ title: "Copied!", description: "Tracking script copied to clipboard." });
  };

  const threatColor = analytics?.threatLevel === "critical" ? "text-red-400" : analytics?.threatLevel === "substantial" ? "text-blue-500" : "text-emerald-400";
  const threatBg = analytics?.threatLevel === "critical" ? "bg-red-500/20" : analytics?.threatLevel === "substantial" ? "bg-blue-500/20" : "bg-emerald-500/20";

  const filteredVisits = ipSearch ? visits.filter(v => v.ipAddress.includes(ipSearch)) : visits;

  const dailyEntries = analytics?.dailyVisits ? Object.entries(analytics.dailyVisits).sort((a, b) => a[0].localeCompare(b[0])) : [];
  const maxDailyVisits = Math.max(...dailyEntries.map(([, v]) => v), 1);

  return (
    <div className="h-full overflow-y-auto bg-background text-foreground overflow-x-hidden">
      <section className="relative z-10 pt-6 sm:pt-8 pb-8 sm:pb-12 px-3 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto">
          <div className="flex flex-col gap-4 mb-6">
            <div>
              <div className="flex items-center gap-3 mb-2">
                <img src={googleAdsLogo} alt="Google Ads" className="h-8 w-8 rounded object-contain shrink-0" />
                <Badge className="bg-blue-500/10 text-blue-500 border-blue-500/20 px-3 py-1 text-sm" data-testid="badge-click-guard">
                  <Shield className="h-3.5 w-3.5 mr-1.5" /> Google Click Guard
                </Badge>
              </div>
              <h1 className="text-2xl sm:text-3xl md:text-4xl font-extrabold tracking-tight" data-testid="text-page-title">
                <span className="text-foreground">Click Fraud </span>
                <span className="bg-gradient-to-r from-[#4285F4] to-[#34A853] bg-clip-text text-transparent">Protection</span>
              </h1>
              <p className="mt-2 text-muted-foreground max-w-xl text-sm" data-testid="text-subtitle">
                Track every visitor across your websites. Detect click fraud, block bad IPs, and protect your ad spend.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {selectedDomain && (
                <select
                  className="bg-card border border-border text-foreground text-sm rounded-md px-3 py-2 outline-none min-w-0 max-w-[200px]"
                  value={domainId || ""}
                  onChange={(e) => setSelectedDomainId(Number(e.target.value))}
                  data-testid="select-domain"
                >
                  {domains.map(d => (
                    <option key={d.id} value={d.id} >{d.name || d.domain}</option>
                  ))}
                </select>
              )}
              <Button
                size="sm"
                className="bg-[#4285F4] hover:bg-[#3367D6] text-white"
                onClick={() => setShowAddDomain(true)}
                data-testid="button-add-domain"
              >
                <Plus className="h-4 w-4 mr-1" /> Add Domain
              </Button>
            </div>
          </div>

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
                      className="bg-[#4285F4] text-white"
                      onClick={() => addDomainMutation.mutate()}
                      disabled={!newDomain || addDomainMutation.isPending}
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

          <div className="flex items-center gap-1 mb-6 bg-card border border-border rounded-lg p-1 overflow-x-auto -mx-3 px-3 sm:mx-0 sm:px-0 sm:w-fit scrollbar-none">
            {(["dashboard", "traffic", "fraud", "tools", "settings", "link-ads"] as const).map(tab => {
              const labels: Record<string, string> = {
                dashboard: "Dashboard",
                traffic: "Traffic Sources",
                fraud: "Fraud Analytics",
                tools: "Tools",
                settings: "Domain Settings",
                "link-ads": "Link Google Ads",
              };
              const shortLabels: Record<string, string> = {
                dashboard: "Dashboard",
                traffic: "Traffic",
                fraud: "Fraud",
                tools: "Tools",
                settings: "Settings",
                "link-ads": "Link Ads",
              };
              const tabIcons: Record<string, typeof Shield> = {
                "link-ads": Link2,
              };
              const TabIcon = tabIcons[tab];
              return (
                <Button
                  key={tab}
                  size="sm"
                  variant={activeTab === tab ? "default" : "ghost"}
                  className={`shrink-0 text-xs sm:text-sm ${activeTab === tab
                    ? "bg-[#4285F4] text-white"
                    : "text-muted-foreground"
                  }`}
                  onClick={() => setActiveTab(tab)}
                  data-testid={`tab-${tab}`}
                >
                  {TabIcon && <TabIcon className="h-3.5 w-3.5 mr-1" />}
                  <span className="hidden sm:inline">{labels[tab]}</span>
                  <span className="sm:hidden">{shortLabels[tab]}</span>
                </Button>
              );
            })}
          </div>

          {activeTab === "link-ads" && <LinkGoogleAdsView domainId={domainId} trackingId={selectedDomain?.trackingId} />}

          {activeTab !== "link-ads" && (
            <>
              {domainsLoading ? (
                <div className="flex items-center justify-center py-20">
                  <div className="animate-spin h-8 w-8 border-2 border-blue-500 border-t-transparent rounded-full" />
                </div>
              ) : !selectedDomain ? (
                <Card className="bg-card border-border">
                  <CardContent className="p-12 text-center">
                    <Shield className="h-16 w-16 text-blue-500/40 mx-auto mb-4" />
                    <h2 className="text-xl font-bold text-foreground mb-2" data-testid="text-no-domains">No Domains Added Yet</h2>
                    <p className="text-muted-foreground mb-6">Add your first website domain to start tracking visitors and detecting click fraud.</p>
                    <Button
                      className="bg-[#4285F4] text-white"
                      onClick={() => setShowAddDomain(true)}
                      data-testid="button-add-first-domain"
                    >
                      <Plus className="h-4 w-4 mr-2" /> Add Your First Domain
                    </Button>
                  </CardContent>
                </Card>
              ) : (
                <>
                  <div className="flex items-center gap-2 mb-6">
                    <div className="flex items-center gap-2 bg-card border border-border rounded-lg p-1">
                      <Globe className="h-4 w-4 text-blue-500 ml-2" />
                      <span className="text-foreground font-medium text-sm">{selectedDomain.domain}</span>
                      <Badge className={`${selectedDomain.isActive ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" : "bg-card text-muted-foreground border-border"} text-xs ml-1`}>
                        {selectedDomain.isActive ? "PROTECTED" : "INACTIVE"}
                      </Badge>
                    </div>
                  </div>

                  {activeTab === "dashboard" && (
                    <DashboardView
                      analytics={analytics}
                      dateRange={dateRange}
                      setDateRange={setDateRange}
                      threatColor={threatColor}
                      threatBg={threatBg}
                      dailyEntries={dailyEntries}
                      maxDailyVisits={maxDailyVisits}
                      domain={selectedDomain}
                    />
                  )}

                  {activeTab === "traffic" && (
                    <TrafficSourcesView
                      analytics={analytics}
                      dateRange={dateRange}
                      setDateRange={setDateRange}
                    />
                  )}

                  {activeTab === "fraud" && (
                    <FraudAnalyticsView
                      analytics={analytics}
                      fraudTab={fraudTab}
                      setFraudTab={setFraudTab}
                      visits={filteredVisits}
                      blockedIps={blockedIps}
                      ipSearch={ipSearch}
                      setIpSearch={setIpSearch}
                      blockIpInput={blockIpInput}
                      setBlockIpInput={setBlockIpInput}
                      blockIpMutation={blockIpMutation}
                      unblockIpMutation={unblockIpMutation}
                    />
                  )}

                  {activeTab === "tools" && (
                    <ToolsView
                      domain={selectedDomain}
                      scriptSnippet={scriptSnippet}
                      copyScript={copyScript}
                    />
                  )}

                  {activeTab === "settings" && (
                    <SettingsView
                      domain={selectedDomain}
                      domains={domains}
                      deleteDomainMutation={deleteDomainMutation}
                      selectedDomainId={selectedDomainId}
                      setSelectedDomainId={setSelectedDomainId}
                      setShowAddDomain={setShowAddDomain}
                    />
                  )}
                </>
              )}
            </>
          )}
        </div>
      </section>
    </div>
  );
}

function LinkGoogleAdsView({ domainId, trackingId }: { domainId?: number; trackingId?: string }) {
  const { toast } = useToast();
  const [scriptCopied, setScriptCopied] = useState(false);
  const [trackingCopied, setTrackingCopied] = useState(false);
  const [showManualSteps, setShowManualSteps] = useState(false);
  const [showGadsScript, setShowGadsScript] = useState(false);

  const { data: scriptData, isLoading: scriptLoading } = useQuery<{ script: string; exclusionUrl: string }>({
    queryKey: ["/api/click-guard/domains", domainId, "google-ads-script"],
    enabled: !!domainId,
  });

  const { data: blockedIps = [] } = useQuery<BlockedIp[]>({
    queryKey: ["/api/click-guard/domains", domainId, "blocked"],
    enabled: !!domainId,
  });

  const activeBlockedCount = blockedIps.filter(b => b.isActive).length;

  const trackingSnippet = trackingId
    ? `<!-- Click Guard by ConstructHUB -->\n<script src="https://constructhub.us/api/click-guard/script/${trackingId}" async></script>`
    : "";

  const copyScript = () => {
    if (scriptData?.script) {
      navigator.clipboard.writeText(scriptData.script);
      setScriptCopied(true);
      toast({ title: "Script copied!", description: "Paste this into Google Ads Scripts." });
      setTimeout(() => setScriptCopied(false), 3000);
    }
  };

  const copyTrackingSnippet = () => {
    navigator.clipboard.writeText(trackingSnippet);
    setTrackingCopied(true);
    toast({ title: "Tracking code copied!", description: "Add this to your website's header or footer." });
    setTimeout(() => setTrackingCopied(false), 3000);
  };

  const copyIpList = () => {
    const ipList = blockedIps.filter(b => b.isActive).map(b => b.ipAddress).join("\n");
    navigator.clipboard.writeText(ipList);
    toast({ title: "IP list copied!", description: `${activeBlockedCount} IPs copied to clipboard.` });
  };

  const copyExclusionUrl = () => {
    if (scriptData?.exclusionUrl) {
      navigator.clipboard.writeText(scriptData.exclusionUrl);
      toast({ title: "API URL copied!", description: "Use this URL to fetch your blocked IP list." });
    }
  };

  return (
    <div className="space-y-8" data-testid="view-link-google-ads">
      <div className="text-center max-w-3xl mx-auto mb-8">
        <div className="inline-flex items-center gap-2 bg-blue-500/10 border border-blue-500/20 rounded-full px-4 py-1.5 mb-4">
          <Link2 className="h-4 w-4 text-blue-400" />
          <span className="text-sm text-blue-400 font-medium">Google Ads Integration</span>
        </div>
        <h2 className="text-2xl sm:text-3xl font-extrabold text-foreground mb-3" data-testid="text-link-title">
          Connect Your Website &amp; Google Ads
        </h2>
        <p className="text-muted-foreground text-sm leading-relaxed">
          Click Guard protects your Google Ads budget by detecting fraudulent clicks on your website and automatically excluding those IPs from your campaigns.
        </p>
      </div>

      <div className="max-w-4xl mx-auto">
        <div className="grid grid-cols-1 md:grid-cols-5 gap-0 items-center mb-10">
          <div className="flex flex-col items-center text-center p-4">
            <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center mb-2">
              <Globe className="h-7 w-7 text-white" />
            </div>
            <p className="text-xs font-semibold text-foreground">Your Website</p>
            <p className="text-[10px] text-muted-foreground">Tracking script installed</p>
          </div>
          <div className="flex items-center justify-center">
            <ArrowRight className="h-5 w-5 text-blue-500 hidden md:block" />
            <div className="h-5 w-px bg-blue-500/30 md:hidden" />
          </div>
          <div className="flex flex-col items-center text-center p-4">
            <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-[#4285F4] to-[#3367D6] flex items-center justify-center mb-2">
              <Shield className="h-7 w-7 text-white" />
            </div>
            <p className="text-xs font-semibold text-foreground">ConstructHUB</p>
            <p className="text-[10px] text-muted-foreground">Detects fraud, blocks IPs</p>
          </div>
          <div className="flex items-center justify-center">
            <ArrowRight className="h-5 w-5 text-blue-500 hidden md:block" />
            <div className="h-5 w-px bg-blue-500/30 md:hidden" />
          </div>
          <div className="flex flex-col items-center text-center p-4">
            <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-emerald-500 to-emerald-600 flex items-center justify-center mb-2">
              <ShieldBan className="h-7 w-7 text-white" />
            </div>
            <p className="text-xs font-semibold text-foreground">Google Ads</p>
            <p className="text-[10px] text-muted-foreground">IPs excluded from campaigns</p>
          </div>
        </div>
      </div>

      {!domainId ? (
        <Card className="max-w-4xl mx-auto bg-yellow-500/5 border-yellow-500/20">
          <CardContent className="p-8 text-center">
            <AlertTriangle className="h-10 w-10 text-yellow-400 mx-auto mb-3" />
            <h3 className="text-lg font-semibold text-foreground mb-2">Add a Domain First</h3>
            <p className="text-sm text-muted-foreground">Select the Dashboard tab and add your website domain to get started with Click Guard protection.</p>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="max-w-4xl mx-auto grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card className=" bg-gradient-to-br from-blue-500/10 to-blue-500/5 border-blue-500/20" data-testid="card-blocked-count">
              <CardContent className="p-5">
                <Ban className="h-6 w-6 text-blue-500 mb-2" />
                <div className="text-2xl font-bold text-foreground">{activeBlockedCount}</div>
                <div className="text-xs text-muted-foreground">Blocked IPs Ready to Sync</div>
              </CardContent>
            </Card>
            <Card className=" bg-gradient-to-br from-blue-500/10 to-blue-500/5 border-blue-500/20" data-testid="card-api-status">
              <CardContent className="p-5">
                <Activity className="h-6 w-6 text-blue-400 mb-2" />
                <div className="text-2xl font-bold text-foreground">Live</div>
                <div className="text-xs text-muted-foreground">Exclusion API Status</div>
              </CardContent>
            </Card>
            <Card className=" bg-gradient-to-br from-emerald-500/10 to-emerald-500/5 border-emerald-500/20" data-testid="card-google-limit">
              <CardContent className="p-5">
                <ShieldCheck className="h-6 w-6 text-emerald-400 mb-2" />
                <div className="text-2xl font-bold text-foreground">{Math.min(activeBlockedCount, 500)}/500</div>
                <div className="text-xs text-muted-foreground">Google Ads IP Limit Used</div>
              </CardContent>
            </Card>
          </div>

          <Card className="max-w-4xl mx-auto border-blue-500/20" data-testid="card-step1-tracking">
            <CardHeader className="pb-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center text-white font-bold text-sm">1</div>
                <div>
                  <CardTitle className="text-foreground text-base">Install Tracking Code on Your Website</CardTitle>
                  <p className="text-xs text-muted-foreground mt-0.5">Add this snippet to the header or footer of every page your Google Ads point to</p>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="bg-muted rounded-lg border border-border p-1">
                <div className="flex items-center justify-between px-3 py-2 border-b border-border">
                  <span className="text-xs text-muted-foreground font-mono">Paste in your website's &lt;head&gt; or before &lt;/body&gt;</span>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 text-xs text-blue-400 hover:text-blue-300 hover:bg-blue-500/10"
                    onClick={copyTrackingSnippet}
                    data-testid="button-copy-tracking"
                  >
                    {trackingCopied ? <CheckCircle className="h-3.5 w-3.5 mr-1" /> : <Copy className="h-3.5 w-3.5 mr-1" />}
                    {trackingCopied ? "Copied!" : "Copy Code"}
                  </Button>
                </div>
                <pre className="p-4 text-xs text-emerald-400 font-mono overflow-x-auto leading-relaxed">
                  {trackingSnippet}
                </pre>
              </div>
              <div className="bg-blue-500/5 border border-blue-500/10 rounded-lg p-3">
                <p className="text-xs text-muted-foreground leading-relaxed">
                  <span className="text-blue-400 font-semibold">What this does:</span> When someone clicks your Google Ad and lands on your website, this script captures their IP address, device fingerprint, browser info, and behavior. That data is sent to ConstructHUB's Click Guard for fraud analysis.
                </p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                <div className="flex items-center gap-2 text-muted-foreground">
                  <CheckCircle className="h-3.5 w-3.5 text-emerald-400" />
                  <span>Captures visitor IPs</span>
                </div>
                <div className="flex items-center gap-2 text-muted-foreground">
                  <CheckCircle className="h-3.5 w-3.5 text-emerald-400" />
                  <span>Device fingerprinting</span>
                </div>
                <div className="flex items-center gap-2 text-muted-foreground">
                  <CheckCircle className="h-3.5 w-3.5 text-emerald-400" />
                  <span>Under 3KB, loads async</span>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="max-w-4xl mx-auto border-blue-500/20" data-testid="card-step2-detection">
            <CardHeader className="pb-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-[#4285F4] to-[#3367D6] flex items-center justify-center text-white font-bold text-sm">2</div>
                <div>
                  <CardTitle className="text-foreground text-base">Click Guard Detects Fraud Automatically</CardTitle>
                  <p className="text-xs text-muted-foreground mt-0.5">No action needed — this happens on ConstructHUB's servers</p>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {[
                  { icon: MousePointerClick, label: "Multi-click detection", desc: "Same IP clicking your ad 5+ times in an hour" },
                  { icon: Bot, label: "Bot detection", desc: "Known bot user agents, headless browsers, crawlers" },
                  { icon: Fingerprint, label: "VPN hopping", desc: "Same device fingerprint appearing from different IPs" },
                  { icon: Ban, label: "Auto-blocking", desc: "Suspicious IPs are automatically added to your block list" },
                ].map((item, i) => (
                  <div key={i} className="flex items-start gap-3 bg-card rounded-lg p-3">
                    <item.icon className="h-4 w-4 text-blue-500 mt-0.5 flex-shrink-0" />
                    <div>
                      <p className="text-sm font-medium text-foreground">{item.label}</p>
                      <p className="text-xs text-muted-foreground">{item.desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card className="max-w-4xl mx-auto border-emerald-500/20" data-testid="card-step3-google-ads">
            <CardHeader className="pb-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-emerald-500 to-emerald-600 flex items-center justify-center text-white font-bold text-sm">3</div>
                <div>
                  <CardTitle className="text-foreground text-base">Push Blocked IPs to Google Ads</CardTitle>
                  <p className="text-xs text-muted-foreground mt-0.5">Connect your Google Ads account so blocked IPs are automatically excluded from your campaigns</p>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="bg-emerald-500/5 border border-emerald-500/10 rounded-lg p-3">
                <p className="text-xs text-muted-foreground leading-relaxed">
                  <span className="text-emerald-400 font-semibold">How it works:</span> You paste a script into your Google Ads account (under Scripts). This script runs every hour, calls ConstructHUB's API, gets your latest blocked IPs, and adds them as IP exclusions on all your active campaigns. Fraudsters can no longer see or click your ads.
                </p>
              </div>

              <button
                className="w-full flex items-center justify-between bg-card hover:bg-card border border-border rounded-lg p-4 cursor-pointer transition-colors"
                onClick={() => setShowGadsScript(!showGadsScript)}
                data-testid="button-toggle-gads-script"
              >
                <div className="flex items-center gap-3">
                  <Zap className="h-5 w-5 text-blue-500" />
                  <div className="text-left">
                    <p className="text-sm font-semibold text-foreground">Google Ads Auto-Sync Script</p>
                    <p className="text-xs text-muted-foreground">Click to view the script you paste into Google Ads</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30 text-[10px]">Recommended</Badge>
                  <ChevronRight className={`h-5 w-5 text-muted-foreground transition-transform ${showGadsScript ? "rotate-90" : ""}`} />
                </div>
              </button>

              {showGadsScript && (
                <div className="space-y-4">
                  <div className="bg-muted rounded-lg border border-border p-1">
                    <div className="flex items-center justify-between px-3 py-2 border-b border-border">
                      <span className="text-xs text-muted-foreground font-mono">google-ads-script.js</span>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 text-xs text-blue-500 hover:text-blue-400 hover:bg-blue-500/10"
                        onClick={copyScript}
                        disabled={scriptLoading || !scriptData}
                        data-testid="button-copy-script"
                      >
                        {scriptCopied ? <CheckCircle className="h-3.5 w-3.5 mr-1" /> : <Copy className="h-3.5 w-3.5 mr-1" />}
                        {scriptCopied ? "Copied!" : "Copy Script"}
                      </Button>
                    </div>
                    <pre className="p-4 text-xs text-muted-foreground font-mono overflow-x-auto max-h-64 overflow-y-auto leading-relaxed">
                      {scriptLoading ? "Loading script..." : scriptData?.script || "Select a domain to generate the script"}
                    </pre>
                  </div>

                  <div className="bg-blue-500/5 border border-blue-500/20 rounded-lg p-4">
                    <h4 className="text-sm font-semibold text-blue-400 mb-3 flex items-center gap-2">
                      <BookOpen className="h-4 w-4" />
                      Install in Google Ads (3 Steps)
                    </h4>
                    <div className="space-y-3">
                      {[
                        { step: 1, title: "Open Google Ads Scripts", desc: "Go to ads.google.com → Tools & Settings → Bulk Actions → Scripts" },
                        { step: 2, title: "Create New Script", desc: "Click the + button, name it \"Click Guard IP Blocker\", paste the script above, and click Save" },
                        { step: 3, title: "Schedule It", desc: "Set the script to run Hourly. Click \"Run\" once to test it. Check the Logs tab to see which IPs were excluded." },
                      ].map(s => (
                        <div key={s.step} className="flex items-start gap-3">
                          <div className="w-6 h-6 rounded-full bg-blue-500/20 flex items-center justify-center text-xs font-bold text-blue-400 flex-shrink-0 mt-0.5">
                            {s.step}
                          </div>
                          <div>
                            <p className="text-sm font-medium text-foreground">{s.title}</p>
                            <p className="text-xs text-muted-foreground">{s.desc}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              <div className="border-t border-border pt-4">
                <h4 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
                  <Code2 className="h-4 w-4 text-muted-foreground" />
                  Public IP Exclusion API
                </h4>
                <div className="flex items-center gap-2">
                  <div className="flex-1 bg-muted rounded-lg border border-border px-4 py-2.5">
                    <code className="text-xs text-emerald-400 font-mono break-all" data-testid="text-exclusion-url">
                      {scriptData?.exclusionUrl || "Loading..."}
                    </code>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="border-border h-9"
                    onClick={copyExclusionUrl}
                    data-testid="button-copy-url"
                  >
                    <Copy className="h-3.5 w-3.5" />
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground mt-2">
                  The Google Ads Script calls this URL automatically every hour. It returns up to 500 blocked IPs in JSON format. You can also use this with Microsoft Ads or any other platform.
                </p>
              </div>
            </CardContent>
          </Card>

          <Card className="max-w-4xl mx-auto bg-card border-border" data-testid="card-manual-method">
            <CardHeader className="pb-3">
              <button
                className="w-full flex items-center justify-between cursor-pointer"
                onClick={() => setShowManualSteps(!showManualSteps)}
                data-testid="button-toggle-manual"
              >
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-card flex items-center justify-center">
                    <FileText className="h-5 w-5 text-muted-foreground" />
                  </div>
                  <div className="text-left">
                    <CardTitle className="text-foreground text-base">Manual Fallback — Copy & Paste IPs</CardTitle>
                    <p className="text-xs text-muted-foreground mt-0.5">If you prefer to manually add IPs to Google Ads</p>
                  </div>
                </div>
                <ChevronRight className={`h-5 w-5 text-muted-foreground transition-transform ${showManualSteps ? "rotate-90" : ""}`} />
              </button>
            </CardHeader>
            {showManualSteps && (
              <CardContent className="space-y-4 pt-0">
                <div className="flex items-center gap-3 bg-card rounded-lg p-3">
                  <Ban className="h-5 w-5 text-blue-500 flex-shrink-0" />
                  <div className="flex-1">
                    <p className="text-sm text-foreground">{activeBlockedCount} blocked IPs ready to copy</p>
                    <p className="text-xs text-muted-foreground">One IP per line, formatted for Google Ads</p>
                  </div>
                  <Button
                    size="sm"
                    className="bg-[#4285F4] hover:bg-[#3367D6] text-white h-8"
                    onClick={copyIpList}
                    disabled={activeBlockedCount === 0}
                    data-testid="button-copy-ips"
                  >
                    <Copy className="h-3.5 w-3.5 mr-1" /> Copy IPs
                  </Button>
                </div>

                <div className="space-y-3">
                  {[
                    { num: 1, title: "Sign into Google Ads", desc: "Go to ads.google.com and open the account running your campaigns." },
                    { num: 2, title: "Open Campaign Settings", desc: "Click your campaign → Settings → Additional Settings → IP Exclusions." },
                    { num: 3, title: "Paste Blocked IPs", desc: "Click \"Copy IPs\" above, then paste them into the IP Exclusion box. One per line." },
                    { num: 4, title: "Save & Repeat", desc: "Save and repeat for each campaign. Come back weekly to add new blocked IPs." },
                  ].map(s => (
                    <div key={s.num} className="flex items-start gap-3">
                      <div className="w-7 h-7 rounded-lg bg-card flex items-center justify-center text-xs font-bold text-muted-foreground flex-shrink-0">
                        {s.num}
                      </div>
                      <div>
                        <p className="text-sm font-medium text-foreground">{s.title}</p>
                        <p className="text-xs text-muted-foreground">{s.desc}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            )}
          </Card>

          <div className="max-w-4xl mx-auto grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card className=" bg-gradient-to-br from-emerald-500/10 to-emerald-500/5 border-emerald-500/20" data-testid="card-tip-budget">
              <CardContent className="p-5">
                <DollarSign className="h-8 w-8 text-emerald-400 mb-3" />
                <h4 className="text-sm font-semibold text-foreground mb-1">Save Up to 25% of Ad Spend</h4>
                <p className="text-xs text-muted-foreground">Contractors in roofing and HVAC lose thousands monthly to click fraud. Blocking IPs on Google Ads means fraudsters can't even see your ads anymore.</p>
              </CardContent>
            </Card>
            <Card className=" bg-gradient-to-br from-blue-500/10 to-blue-500/5 border-blue-500/20" data-testid="card-tip-auto">
              <CardContent className="p-5">
                <RefreshCw className="h-8 w-8 text-blue-400 mb-3" />
                <h4 className="text-sm font-semibold text-foreground mb-1">Syncs Every Hour</h4>
                <p className="text-xs text-muted-foreground">The Google Ads Script runs hourly. New blocked IPs get pushed to all your campaigns automatically — no manual work needed.</p>
              </CardContent>
            </Card>
            <Card className=" bg-gradient-to-br from-purple-500/10 to-purple-500/5 border-purple-500/20" data-testid="card-tip-fingerprint">
              <CardContent className="p-5">
                <Fingerprint className="h-8 w-8 text-purple-400 mb-3" />
                <h4 className="text-sm font-semibold text-foreground mb-1">Smarter Than IP Alone</h4>
                <p className="text-xs text-muted-foreground">Click Guard uses device fingerprinting, VPN detection, and behavior analysis to catch fraudsters that IP-only tools miss.</p>
              </CardContent>
            </Card>
          </div>

          <Card className="max-w-4xl mx-auto bg-blue-500/5 border-blue-500/20" data-testid="card-pro-tip">
            <CardContent className="p-5">
              <div className="flex items-start gap-3">
                <AlertTriangle className="h-5 w-5 text-blue-500 flex-shrink-0 mt-0.5" />
                <div>
                  <h4 className="text-sm font-semibold text-blue-500 mb-1">Pro Tip: Google Ads Has a 500 IP Limit</h4>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    Google Ads allows 500 IP exclusions per campaign. The sync script respects this limit and prioritizes the most recent blocks. Enable IP Range Exclusion in Domain Settings to block entire subnets (e.g., 172.16.0.*) and fit more protections within Google's limit.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}


function DashboardView({ analytics, dateRange, setDateRange, threatColor, threatBg, dailyEntries, maxDailyVisits, domain }: {
  analytics: Analytics | undefined;
  dateRange: string;
  setDateRange: (r: string) => void;
  threatColor: string;
  threatBg: string;
  dailyEntries: [string, number][];
  maxDailyVisits: number;
  domain: DomainWithStats;
}) {
  const stats = [
    { label: "Visits", value: analytics?.totalVisits ?? 0, icon: Eye, color: "text-blue-400", bg: "from-blue-500/20 to-indigo-500/20" },
    { label: "Blocked IPs", value: analytics?.blockedIps ?? 0, icon: Ban, color: "text-red-400", bg: "from-red-500/20 to-rose-500/20" },
    { label: "Unique Visitors", value: analytics?.uniqueVisitors ?? 0, icon: Users, color: "text-emerald-400", bg: "from-emerald-500/20 to-teal-500/20" },
    { label: "Avg Visits/User", value: analytics?.avgVisitsPerUser ?? 0, icon: BarChart3, color: "text-purple-400", bg: "from-purple-500/20 to-violet-500/20" },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 flex-wrap">
        {["1d", "7d", "30d"].map(r => (
          <Button
            key={r}
            size="sm"
            variant={dateRange === r ? "default" : "ghost"}
            className={dateRange === r ? "bg-[#4285F4] text-white" : "text-muted-foreground border border-border"}
            onClick={() => setDateRange(r)}
            data-testid={`button-range-${r}`}
          >
            {r === "1d" ? "Daily" : r === "7d" ? "Last 7 Days" : "Last 30 Days"}
          </Button>
        ))}
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {stats.map(s => (
          <Card key={s.label} className="bg-card border-border" data-testid={`card-stat-${s.label.toLowerCase().replace(/[\s\/]/g, "-")}`}>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-2">
                <div className={`h-8 w-8 rounded-md bg-gradient-to-br ${s.bg} flex items-center justify-center`}>
                  <s.icon className={`h-4 w-4 ${s.color}`} />
                </div>
              </div>
              <p className="text-2xl font-bold text-foreground">{typeof s.value === "number" ? s.value.toLocaleString() : s.value}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{s.label}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2 bg-card border-border" data-testid="card-threat-level">
          <CardHeader className="pb-2">
            <CardTitle className="text-lg font-bold text-foreground flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-blue-500" /> Threat Level
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            <div className="space-y-3">
              {["low", "substantial", "critical"].map(level => {
                const isActive = analytics?.threatLevel === level;
                const color = level === "low" ? "bg-emerald-500" : level === "substantial" ? "bg-orange-500" : "bg-red-500";
                return (
                  <div key={level} className="flex items-center gap-3">
                    <span className={`text-sm capitalize w-24 ${isActive ? "text-foreground font-medium" : "text-muted-foreground"}`}>{level}</span>
                    <div className="flex-1 h-3 bg-card rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${isActive ? color : "bg-card"}`}
                        style={{ width: isActive ? `${Math.max(analytics?.threatPercent || 0, 5)}%` : "0%" }}
                      />
                    </div>
                    {isActive && <span className={`text-sm font-bold ${threatColor}`}>{analytics?.threatPercent}%</span>}
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>

        <Card className="bg-card border-border" data-testid="card-savings">
          <CardHeader className="pb-2">
            <CardTitle className="text-lg font-bold text-foreground flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-emerald-400" /> Your Savings
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            <div className="text-center py-4">
              {(analytics?.blockedIps ?? 0) > 0 ? (
                <>
                  <p className="text-3xl font-bold text-emerald-400">${((analytics?.blockedIps ?? 0) * 4.5).toFixed(0)}</p>
                  <p className="text-xs text-muted-foreground mt-1">Estimated savings from blocked fraudulent clicks</p>
                  <p className="text-xs text-muted-foreground mt-1">Based on avg $4.50 CPC for construction</p>
                </>
              ) : (
                <p className="text-blue-500 text-sm">No clicks saved in this range</p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {dailyEntries.length > 0 && (
        <Card className="bg-card border-border" data-testid="card-chart">
          <CardHeader className="pb-2">
            <CardTitle className="text-lg font-bold text-foreground flex items-center gap-2">
              <BarChart3 className="h-5 w-5 text-[#4285F4]" /> Visit Trend
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-2">
            <div className="flex items-end gap-1 h-40">
              {dailyEntries.map(([date, count]) => (
                <div key={date} className="flex-1 flex flex-col items-center gap-1">
                  <div className="w-full flex flex-col items-center justify-end flex-1">
                    <div
                      className="w-full max-w-[32px] bg-gradient-to-t from-[#4285F4] to-[#34A853] rounded-t-sm opacity-80"
                      style={{ height: `${(count / maxDailyVisits) * 100}%`, minHeight: "4px" }}
                      title={`${count} visits on ${date}`}
                      data-testid={`bar-${date}`}
                    />
                  </div>
                  <span className="text-[9px] text-muted-foreground mt-1">{date.slice(5)}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {analytics && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Card className="bg-card border-border" data-testid="card-device-breakdown">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-bold text-foreground flex items-center gap-2">
                <Monitor className="h-4 w-4 text-blue-400" /> Fraud by Device
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4 pt-0">
              {Object.keys(analytics.deviceBreakdown).length > 0 ? (
                <div className="space-y-2">
                  {Object.entries(analytics.deviceBreakdown).map(([device, count]) => {
                    const Icon = device === "mobile" ? Smartphone : device === "tablet" ? Tablet : Monitor;
                    const pct = analytics.totalVisits > 0 ? Math.round((count / analytics.totalVisits) * 100) : 0;
                    return (
                      <div key={device} className="flex items-center gap-2">
                        <Icon className="h-4 w-4 text-muted-foreground" />
                        <span className="text-sm text-muted-foreground capitalize w-20">{device}</span>
                        <div className="flex-1 h-2 bg-card rounded-full">
                          <div className="h-full bg-gradient-to-r from-[#4285F4] to-[#34A853] rounded-full" style={{ width: `${pct}%` }} />
                        </div>
                        <span className="text-xs text-muted-foreground w-16 text-right">{count} ({pct}%)</span>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="text-sm text-blue-500 text-center py-4">No device data yet</p>
              )}
            </CardContent>
          </Card>

          <Card className="bg-card border-border" data-testid="card-browser-breakdown">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-bold text-foreground flex items-center gap-2">
                <Globe className="h-4 w-4 text-purple-400" /> Browser Breakdown
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4 pt-0">
              {Object.keys(analytics.browserBreakdown).length > 0 ? (
                <div className="space-y-2">
                  {Object.entries(analytics.browserBreakdown).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([browser, count]) => {
                    const pct = analytics.totalVisits > 0 ? Math.round((count / analytics.totalVisits) * 100) : 0;
                    return (
                      <div key={browser} className="flex items-center gap-2">
                        <span className="text-sm text-muted-foreground w-20 truncate">{browser}</span>
                        <div className="flex-1 h-2 bg-card rounded-full">
                          <div className="h-full bg-gradient-to-r from-purple-500 to-violet-400 rounded-full" style={{ width: `${pct}%` }} />
                        </div>
                        <span className="text-xs text-muted-foreground w-16 text-right">{count} ({pct}%)</span>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="text-sm text-blue-500 text-center py-4">No browser data yet</p>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

function TrafficSourcesView({ analytics, dateRange, setDateRange }: {
  analytics: Analytics | undefined;
  dateRange: string;
  setDateRange: (r: string) => void;
}) {
  const sources = analytics?.trafficSources ?? [];
  const totalPageLoads = sources.reduce((sum, s) => sum + s.pageLoads, 0);
  const totalVisitors = sources.reduce((sum, s) => sum + s.visitors, 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h3 className="text-lg font-bold text-foreground flex items-center gap-2" data-testid="text-traffic-title">
          <Globe className="h-5 w-5 text-[#4285F4]" /> Traffic Sources by Domain / Vendor
        </h3>
        <div className="flex items-center gap-2">
          {["1d", "7d", "30d"].map(r => (
            <Button
              key={r}
              size="sm"
              variant={dateRange === r ? "default" : "ghost"}
              className={dateRange === r ? "bg-[#4285F4] text-white" : "text-muted-foreground border border-border"}
              onClick={() => setDateRange(r)}
              data-testid={`button-traffic-range-${r}`}
            >
              {r === "1d" ? "Daily" : r === "7d" ? "Last 7 Days" : "Last 30 Days"}
            </Button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <Card className="bg-card border-border" data-testid="card-total-sources">
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-[#4285F4]">{sources.length}</p>
            <p className="text-xs text-muted-foreground mt-1">Traffic Sources</p>
          </CardContent>
        </Card>
        <Card className="bg-card border-border" data-testid="card-total-pageloads">
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-[#34A853]">{totalPageLoads.toLocaleString()}</p>
            <p className="text-xs text-muted-foreground mt-1">Page Loads</p>
          </CardContent>
        </Card>
        <Card className="bg-card border-border" data-testid="card-total-visitors">
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-[#FBBC05]">{totalVisitors.toLocaleString()}</p>
            <p className="text-xs text-muted-foreground mt-1">Unique Visitors</p>
          </CardContent>
        </Card>
      </div>

      <Card className="bg-card border-border" data-testid="card-traffic-table">
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/50">
                  <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Percentage</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Page Loads</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Visitors</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Traffic Sources by Domain / Vendor</th>
                </tr>
              </thead>
              <tbody>
                {sources.length > 0 ? sources.map((source, i) => (
                  <tr key={source.domain} className="border-b border-border last:border-0 hover:bg-card transition-colors" data-testid={`row-traffic-${i}`}>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="w-16 h-2 bg-muted rounded-full overflow-hidden">
                          <div
                            className="h-full bg-gradient-to-r from-[#4285F4] to-[#34A853] rounded-full"
                            style={{ width: `${Math.max(source.percentage, 1)}%` }}
                          />
                        </div>
                        <span className="text-foreground font-medium">{source.percentage.toFixed(2)} %</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-foreground font-medium">{source.pageLoads.toLocaleString()}</td>
                    <td className="px-4 py-3 text-foreground font-medium">{source.visitors.toLocaleString()}</td>
                    <td className="px-4 py-3">
                      {source.domain === "NO REFERRER DATA" ? (
                        <span className="text-muted-foreground italic">{source.domain}</span>
                      ) : (
                        <span className="text-[#4285F4] font-medium">{source.domain}</span>
                      )}
                    </td>
                  </tr>
                )) : (
                  <tr>
                    <td colSpan={4} className="px-4 py-12 text-center text-muted-foreground">
                      No traffic data yet. Add the tracking script to your website to start collecting traffic source data.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {sources.length > 0 && (
            <div className="px-4 py-3 border-t border-border bg-card flex items-center justify-between text-xs text-muted-foreground">
              <span>Results 1 to {sources.length} from {totalPageLoads.toLocaleString()} log records</span>
              <span>Results: {sources.length}</span>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="bg-blue-500/5 border-blue-500/20" data-testid="card-traffic-tip">
        <CardContent className="p-5">
          <div className="flex items-start gap-3">
            <Activity className="h-5 w-5 text-[#4285F4] flex-shrink-0 mt-0.5" />
            <div>
              <h4 className="text-sm font-semibold text-[#4285F4] mb-1">Understanding Traffic Sources</h4>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Traffic sources show where your website visitors are coming from. "NO REFERRER DATA" means the visitor typed your URL directly or the referrer was stripped. Look for entries like "google.com =&gt; (Campaign: Google AdWords)" to see your paid ad traffic vs organic search traffic.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function FraudAnalyticsView({ analytics, fraudTab, setFraudTab, visits, blockedIps, ipSearch, setIpSearch, blockIpInput, setBlockIpInput, blockIpMutation, unblockIpMutation }: {
  analytics: Analytics | undefined;
  fraudTab: string;
  setFraudTab: (t: string) => void;
  visits: ClickVisit[];
  blockedIps: BlockedIp[];
  ipSearch: string;
  setIpSearch: (s: string) => void;
  blockIpInput: string;
  setBlockIpInput: (s: string) => void;
  blockIpMutation: any;
  unblockIpMutation: any;
}) {
  return (
    <div className="space-y-6">
      <Card className="bg-card border-border">
        <CardHeader className="pb-2">
          <CardTitle className="text-lg font-bold text-foreground">Google Ads Fraud Analytics</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="flex items-center gap-1 px-4 pt-2 pb-4 overflow-x-auto">
            {FRAUD_TABS.map(tab => (
              <Button
                key={tab}
                size="sm"
                variant="ghost"
                className={fraudTab === tab ? "text-blue-500 border-b-2 border-blue-500 rounded-none" : "text-muted-foreground rounded-none"}
                onClick={() => setFraudTab(tab)}
                data-testid={`fraud-tab-${tab.toLowerCase().replace(/\s+/g, "-")}`}
              >
                {tab}
              </Button>
            ))}
          </div>

          <div className="px-4 pb-4 min-h-[200px]">
            {fraudTab === "Blocked IPs" && (
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <Input
                    placeholder="Enter IP to block..."
                    value={blockIpInput}
                    onChange={(e) => setBlockIpInput(e.target.value)}
                    className="bg-card border-border text-foreground max-w-xs"
                    data-testid="input-block-ip"
                  />
                  <Button
                    size="sm"
                    className="bg-red-500/20 text-red-400 border border-red-500/20"
                    onClick={() => blockIpMutation.mutate(blockIpInput)}
                    disabled={!blockIpInput || blockIpMutation.isPending}
                    data-testid="button-block-ip"
                  >
                    <Ban className="h-3 w-3 mr-1" /> Block
                  </Button>
                </div>
                {blockedIps.length > 0 ? (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm" data-testid="table-blocked-ips">
                      <thead>
                        <tr className="border-b border-border">
                          <th className="text-left text-muted-foreground font-medium py-2 px-3">IP Address</th>
                          <th className="text-left text-muted-foreground font-medium py-2 px-3">Reason</th>
                          <th className="text-left text-muted-foreground font-medium py-2 px-3">Source</th>
                          <th className="text-left text-muted-foreground font-medium py-2 px-3">Blocked At</th>
                          <th className="text-right text-muted-foreground font-medium py-2 px-3">Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {blockedIps.map(ip => (
                          <tr key={ip.id} className="border-b border-border" data-testid={`row-blocked-${ip.id}`}>
                            <td className="py-2 px-3 text-foreground font-mono text-xs">{ip.ipAddress}</td>
                            <td className="py-2 px-3 text-muted-foreground text-xs max-w-[200px] truncate">{ip.reason}</td>
                            <td className="py-2 px-3">
                              <Badge className={ip.source === "auto" ? "bg-blue-500/10 text-blue-500 border-blue-500/20 text-[10px]" : "bg-blue-500/10 text-blue-400 border-blue-500/20 text-[10px]"}>
                                {ip.source}
                              </Badge>
                            </td>
                            <td className="py-2 px-3 text-muted-foreground text-xs">{new Date(ip.blockedAt).toLocaleDateString()}</td>
                            <td className="py-2 px-3 text-right">
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-6 px-2"
                                onClick={() => unblockIpMutation.mutate(ip.id)}
                                data-testid={`button-unblock-${ip.id}`}
                              >
                                <X className="h-3 w-3" />
                              </Button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="text-center py-8">
                    <ShieldCheck className="h-12 w-12 text-emerald-400/30 mx-auto mb-2" />
                    <p className="text-muted-foreground text-sm">No blocked IPs yet</p>
                  </div>
                )}
              </div>
            )}

            {fraudTab === "Countries" && (
              <div>
                {analytics && Object.keys(analytics.countryBreakdown).length > 0 ? (
                  <div className="space-y-2">
                    {Object.entries(analytics.countryBreakdown).sort((a, b) => b[1] - a[1]).map(([country, cnt]) => (
                      <div key={country} className="flex items-center gap-3">
                        <span className="text-sm text-muted-foreground w-24">{country}</span>
                        <div className="flex-1 h-2 bg-card rounded-full">
                          <div className="h-full bg-gradient-to-r from-[#4285F4] to-[#34A853] rounded-full" style={{ width: `${(cnt / (analytics.totalVisits || 1)) * 100}%` }} />
                        </div>
                        <span className="text-xs text-muted-foreground">{cnt}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-8">
                    <Globe className="h-12 w-12 text-blue-500/30 mx-auto mb-2" />
                    <p className="text-blue-500 text-sm">Data is on its way!</p>
                  </div>
                )}
              </div>
            )}

            {fraudTab === "Multi-Clicks" && (
              <div>
                {analytics && Object.keys(analytics.multiClickBreakdown).length > 0 ? (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-border">
                          <th className="text-left text-muted-foreground font-medium py-2 px-3">Number of Clicks</th>
                          <th className="text-right text-muted-foreground font-medium py-2 px-3">Users</th>
                          <th className="text-right text-muted-foreground font-medium py-2 px-3">Percentage</th>
                        </tr>
                      </thead>
                      <tbody>
                        {Object.entries(analytics.multiClickBreakdown).sort((a, b) => {
                          const numA = a[0] === "10+" ? 10 : parseInt(a[0]);
                          const numB = b[0] === "10+" ? 10 : parseInt(b[0]);
                          return numA - numB;
                        }).map(([clicks, users]) => {
                          const totalUsers = Object.values(analytics.multiClickBreakdown).reduce((a, b) => a + b, 0);
                          const pct = totalUsers > 0 ? ((users / totalUsers) * 100).toFixed(1) : "0";
                          return (
                            <tr key={clicks} className="border-b border-border">
                              <td className="py-2 px-3 text-foreground">{clicks} Click{clicks !== "1" ? "s" : ""}</td>
                              <td className="py-2 px-3 text-right text-muted-foreground">{users}</td>
                              <td className="py-2 px-3 text-right text-muted-foreground">{pct}%</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="text-center py-8">
                    <p className="text-blue-500 text-sm">No multi-click data yet</p>
                  </div>
                )}
              </div>
            )}

            {fraudTab === "Devices" && (
              <div>
                {analytics && Object.keys(analytics.deviceBreakdown).length > 0 ? (
                  <div className="space-y-2">
                    {Object.entries(analytics.deviceBreakdown).sort((a, b) => b[1] - a[1]).map(([device, cnt]) => {
                      const Icon = device === "mobile" ? Smartphone : device === "tablet" ? Tablet : Monitor;
                      return (
                        <div key={device} className="flex items-center gap-3">
                          <Icon className="h-4 w-4 text-muted-foreground" />
                          <span className="text-sm text-muted-foreground capitalize w-20">{device}</span>
                          <div className="flex-1 h-2 bg-card rounded-full">
                            <div className="h-full bg-gradient-to-r from-blue-500 to-cyan-400 rounded-full" style={{ width: `${(cnt / (analytics.totalVisits || 1)) * 100}%` }} />
                          </div>
                          <span className="text-xs text-muted-foreground">{cnt}</span>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="text-center py-8">
                    <p className="text-blue-500 text-sm">Data is on its way!</p>
                  </div>
                )}
              </div>
            )}

            {fraudTab === "Browsers" && (
              <div>
                {analytics && Object.keys(analytics.browserBreakdown).length > 0 ? (
                  <div className="space-y-2">
                    {Object.entries(analytics.browserBreakdown).sort((a, b) => b[1] - a[1]).map(([browser, cnt]) => (
                      <div key={browser} className="flex items-center gap-3">
                        <span className="text-sm text-muted-foreground w-24">{browser}</span>
                        <div className="flex-1 h-2 bg-card rounded-full">
                          <div className="h-full bg-gradient-to-r from-purple-500 to-pink-400 rounded-full" style={{ width: `${(cnt / (analytics.totalVisits || 1)) * 100}%` }} />
                        </div>
                        <span className="text-xs text-muted-foreground">{cnt}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-8">
                    <p className="text-blue-500 text-sm">Data is on its way!</p>
                  </div>
                )}
              </div>
            )}

            {fraudTab === "OS" && (
              <div>
                {analytics && Object.keys(analytics.osBreakdown).length > 0 ? (
                  <div className="space-y-2">
                    {Object.entries(analytics.osBreakdown).sort((a, b) => b[1] - a[1]).map(([os, cnt]) => (
                      <div key={os} className="flex items-center gap-3">
                        <span className="text-sm text-muted-foreground w-24">{os}</span>
                        <div className="flex-1 h-2 bg-card rounded-full">
                          <div className="h-full bg-gradient-to-r from-emerald-500 to-teal-400 rounded-full" style={{ width: `${(cnt / (analytics.totalVisits || 1)) * 100}%` }} />
                        </div>
                        <span className="text-xs text-muted-foreground">{cnt}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-8">
                    <p className="text-blue-500 text-sm">Data is on its way!</p>
                  </div>
                )}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <Card className="bg-card border-border" data-testid="card-clicks-report">
        <CardHeader className="pb-2">
          <CardTitle className="text-lg font-bold text-foreground flex items-center gap-2">
            Clicks Report
            <Badge className="bg-emerald-500/10 text-emerald-400 border-emerald-500/20 text-[10px] ml-1">LIVE</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-4 pt-0">
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 mb-4">
            <div className="relative flex-1 max-w-xs">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by IP"
                value={ipSearch}
                onChange={(e) => setIpSearch(e.target.value)}
                className="bg-card border-border text-foreground pl-9"
                data-testid="input-search-ip"
              />
            </div>
            <Button
              size="sm"
              variant="outline"
              className="border-blue-500/30 text-blue-500"
              onClick={() => {
                const csv = ["IP,Device,Browser,OS,Suspicious,Time"]
                  .concat(visits.map(v => `${v.ipAddress},${v.deviceType},${v.browser},${v.os},${v.isSuspicious},${v.visitedAt}`))
                  .join("\n");
                const blob = new Blob([csv], { type: "text/csv" });
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = "clicks-report.csv";
                a.click();
              }}
              data-testid="button-download-csv"
            >
              <Download className="h-3 w-3 mr-1" /> Download CSV
            </Button>
          </div>

          {visits.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm" data-testid="table-clicks-report">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left text-muted-foreground font-medium py-2 px-3">IP Address</th>
                    <th className="text-left text-muted-foreground font-medium py-2 px-3">Device</th>
                    <th className="text-left text-muted-foreground font-medium py-2 px-3">Browser</th>
                    <th className="text-left text-muted-foreground font-medium py-2 px-3">OS</th>
                    <th className="text-left text-muted-foreground font-medium py-2 px-3">Page</th>
                    <th className="text-center text-muted-foreground font-medium py-2 px-3">Status</th>
                    <th className="text-left text-muted-foreground font-medium py-2 px-3">Time</th>
                    <th className="text-right text-muted-foreground font-medium py-2 px-3">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {(ipSearch ? visits.filter(v => v.ipAddress.includes(ipSearch)) : visits).slice(0, 50).map(v => {
                    let pagePath = "-";
                    try { pagePath = v.landingPage ? new URL(v.landingPage).pathname : "-"; } catch { pagePath = v.landingPage || "-"; }
                    return (
                      <tr key={v.id} className="border-b border-border" data-testid={`row-visit-${v.id}`}>
                        <td className="py-2 px-3 text-foreground font-mono text-xs">{v.ipAddress}</td>
                        <td className="py-2 px-3 text-muted-foreground text-xs capitalize">{v.deviceType || "-"}</td>
                        <td className="py-2 px-3 text-muted-foreground text-xs">{v.browser || "-"}</td>
                        <td className="py-2 px-3 text-muted-foreground text-xs">{v.os || "-"}</td>
                        <td className="py-2 px-3 text-muted-foreground text-xs max-w-[150px] truncate">{pagePath}</td>
                        <td className="py-2 px-3 text-center">
                          {v.isSuspicious ? (
                            <Badge className="bg-red-500/10 text-red-400 border-red-500/20 text-[10px]">
                              <AlertTriangle className="h-2.5 w-2.5 mr-0.5" /> Fraud
                            </Badge>
                          ) : (
                            <Badge className="bg-emerald-500/10 text-emerald-400 border-emerald-500/20 text-[10px]">
                              <CheckCircle className="h-2.5 w-2.5 mr-0.5" /> Clean
                            </Badge>
                          )}
                        </td>
                        <td className="py-2 px-3 text-muted-foreground text-xs">{new Date(v.visitedAt).toLocaleString()}</td>
                        <td className="py-2 px-3 text-right">
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-red-400/60 hover:text-red-400 h-6 px-2"
                            onClick={() => blockIpMutation.mutate(v.ipAddress)}
                            title="Block this IP"
                            data-testid={`button-block-visit-${v.id}`}
                          >
                            <Ban className="h-3 w-3" />
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {visits.length > 50 && <p className="text-xs text-muted-foreground text-center mt-2">Showing first 50 of {visits.length} visits</p>}
            </div>
          ) : (
            <div className="text-center py-8">
              <p className="text-muted-foreground text-sm">No visits recorded yet. Install the tracking script to start monitoring.</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function ToolsView({ domain, scriptSnippet, copyScript }: {
  domain: DomainWithStats;
  scriptSnippet: string;
  copyScript: () => void;
}) {
  const { toast } = useToast();

  const conversionScript = `<!-- Click Guard Conversion tracking-->
<script type="text/javascript">
ccConVal = 0;
var script = document.createElement("script");
script.async = true;
script.type = "text/javascript";
var target = 'https://constructhub.us/api/click-guard/script/${domain.trackingId}';
script.src = target; var elem = document.head; elem.appendChild(script);
</script>
<noscript>
<a href="https://constructhub.us"><img src="https://constructhub.us/api/click-guard/pixel/${domain.trackingId}" alt="Click Guard"/></a>
</noscript>
<!-- Click Guard Conversion tracking-->`;

  const eventScript = `function initCGConversion(val) {
  window.ccConVal = val || 0;
  var script = document.createElement('script');
  var target = 'https://constructhub.us/api/click-guard/script/${domain.trackingId}';
  var elem = document.head;
  script.type = 'text/javascript';
  script.src = target;
  elem.appendChild(script);
}`;

  const copyText = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    toast({ title: "Copied!", description: `${label} copied to clipboard.` });
  };

  return (
    <div className="space-y-6">
      <Card className="bg-card border-border" data-testid="card-tracking-script">
        <CardHeader className="pb-2">
          <CardTitle className="text-lg font-bold text-foreground flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-blue-500" /> Tracking Script
          </CardTitle>
        </CardHeader>
        <CardContent className="p-4 pt-0">
          <p className="text-sm text-muted-foreground mb-3">
            Add this script to the <code className="text-blue-500">&lt;head&gt;</code> of every page on <strong className="text-foreground">{domain.domain}</strong> to start tracking visitors and detecting click fraud.
          </p>
          <div className="relative">
            <pre className="bg-muted border border-border rounded-lg p-4 text-xs text-emerald-400 font-mono overflow-x-auto whitespace-pre-wrap break-all">
              {scriptSnippet}
            </pre>
            <Button
              size="sm"
              variant="secondary"
              className="absolute top-2 right-2"
              onClick={copyScript}
              data-testid="button-copy-main-script"
            >
              <Copy className="h-3 w-3 mr-1" /> Copy
            </Button>
          </div>
          <div className="mt-4 p-3 bg-blue-500/5 border border-blue-500/10 rounded-lg">
            <p className="text-xs text-blue-400">
              <strong>How it works:</strong> The script runs on page load, captures the visitor's device fingerprint, IP (server-side), browser, screen size, and sends it to Click Guard. Suspicious patterns (bots, multi-click, VPN hopping) are automatically flagged and IPs are blocked.
            </p>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="bg-card border-border" data-testid="card-conversion-tracking">
          <CardHeader className="pb-2">
            <CardTitle className="text-lg font-bold text-foreground flex items-center gap-2">
              <Target className="h-5 w-5 text-emerald-400" /> Conversion Tracking Code
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            <p className="text-sm text-muted-foreground mb-3">
              This is your tracking code. It goes right after the opening <code className="text-blue-500">&lt;body&gt;</code> tag of your thank you page.
            </p>
            <p className="text-xs text-muted-foreground mb-3">
              You can set a value to the ccConVal variable to track conversion value as well.
            </p>
            <div className="relative">
              <pre className="bg-muted border border-border rounded-lg p-4 text-[11px] text-emerald-400 font-mono overflow-x-auto whitespace-pre-wrap break-all max-h-60">
                {conversionScript}
              </pre>
              <Button
                size="sm"
                variant="secondary"
                className="absolute top-2 right-2"
                onClick={() => copyText(conversionScript, "Conversion tracking code")}
                data-testid="button-copy-conversion"
              >
                <Copy className="h-3 w-3 mr-1" /> Copy
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-card border-border" data-testid="card-event-tracking">
          <CardHeader className="pb-2">
            <CardTitle className="text-lg font-bold text-foreground flex items-center gap-2">
              <Zap className="h-5 w-5 text-purple-400" /> Tracking Individual Events
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            <p className="text-sm text-muted-foreground mb-3">
              Call the following function to track individual events. This will allow our system to track an event or conversion on your page.
            </p>
            <p className="text-xs text-muted-foreground mb-3">
              For example, you could put this code on a "Submit" button for a lead form to allow us track who was filling out the form.
            </p>
            <div className="relative">
              <pre className="bg-muted border border-border rounded-lg p-4 text-[11px] text-purple-400 font-mono overflow-x-auto whitespace-pre-wrap break-all max-h-60">
                {eventScript}
              </pre>
              <Button
                size="sm"
                variant="secondary"
                className="absolute top-2 right-2"
                onClick={() => copyText(eventScript, "Event tracking code")}
                data-testid="button-copy-event"
              >
                <Copy className="h-3 w-3 mr-1" /> Copy
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="bg-card border-border" data-testid="card-conversions-table">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg font-bold text-foreground flex items-center gap-2">
              <BarChart3 className="h-5 w-5 text-blue-400" /> Conversions Table
            </CardTitle>
            <CardTitle className="text-lg font-bold text-foreground flex items-center gap-2">
              <Activity className="h-5 w-5 text-emerald-400" /> Conversion Analysis
            </CardTitle>
          </div>
        </CardHeader>
        <CardContent className="p-4 pt-0">
          <div className="grid grid-cols-2 gap-6">
            <div className="text-center py-8">
              <div className="w-16 h-16 mx-auto mb-3 rounded-lg bg-blue-500/10 flex items-center justify-center">
                <BarChart3 className="h-8 w-8 text-blue-500/60" />
              </div>
              <p className="text-blue-500 font-medium text-sm">Data is on its way!</p>
              <p className="text-xs text-muted-foreground mt-1">Add the conversion tracking code to start seeing data</p>
            </div>
            <div className="text-center py-8">
              <div className="w-16 h-16 mx-auto mb-3 rounded-lg bg-emerald-500/10 flex items-center justify-center">
                <Activity className="h-8 w-8 text-emerald-400/60" />
              </div>
              <p className="text-emerald-400 font-medium text-sm">Your campaigns are now protected.</p>
              <p className="text-xs text-muted-foreground mt-1">Conversion analysis will appear here</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function SettingsView({ domain, domains, deleteDomainMutation, selectedDomainId, setSelectedDomainId, setShowAddDomain }: {
  domain: DomainWithStats;
  domains: DomainWithStats[];
  deleteDomainMutation: any;
  selectedDomainId: number | null;
  setSelectedDomainId: (id: number | null) => void;
  setShowAddDomain: (show: boolean) => void;
}) {
  const { toast } = useToast();
  const settings = (domain as any).settings || {};
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);

  const updateSetting = useMutation({
    mutationFn: async (data: Record<string, any>) => {
      const res = await apiRequest("PATCH", `/api/click-guard/domains/${domain.id}/settings`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/click-guard/domains"] });
      toast({ title: "Settings updated" });
    },
    onError: () => {
      toast({ title: "Failed to update", variant: "destructive" });
    },
  });

  const [clickThreshold, setClickThreshold] = useState(String(settings.clickThreshold || 1));
  const [blockDays, setBlockDays] = useState(String(settings.blockDays || 90));
  const [exclusionListRate, setExclusionListRate] = useState(String(settings.exclusionListRate || 500));
  const [manualExcludeIps, setManualExcludeIps] = useState(settings.manualExcludeIps || "");
  const [whitelistIps, setWhitelistIps] = useState(settings.whitelistIps || "");

  const toggleSetting = (key: string) => {
    updateSetting.mutate({ [key]: !settings[key] });
  };

  const handleDeleteDomain = (id: number) => {
    deleteDomainMutation.mutate(id, {
      onSuccess: () => {
        setConfirmDeleteId(null);
      },
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-foreground flex items-center gap-2">
          <Globe className="h-5 w-5 text-blue-500" /> Your Domains
        </h2>
        <Button
          size="sm"
          className="bg-[#4285F4] hover:bg-[#3367D6] text-white"
          onClick={() => setShowAddDomain(true)}
          data-testid="button-add-domain-settings"
        >
          <Plus className="h-4 w-4 mr-1" /> Add Domain
        </Button>
      </div>

      <div className="space-y-3">
        {domains.map(d => {
          const isSelected = d.id === (selectedDomainId || domain.id);
          const isDeleting = confirmDeleteId === d.id;

          return (
            <Card
              key={d.id}
              className={`border transition-all cursor-pointer ${isSelected ? "bg-card border-blue-500/30 ring-1 ring-blue-500/20" : "bg-card border-border hover:border-border"}`}
              onClick={() => setSelectedDomainId(d.id)}
              data-testid={`card-domain-${d.id}`}
            >
              <CardContent className="p-4">
                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${d.isActive ? "bg-emerald-500/10" : "bg-card"}`}>
                      <Globe className={`h-5 w-5 ${d.isActive ? "text-emerald-400" : "text-muted-foreground"}`} />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-foreground truncate" data-testid={`text-domain-name-${d.id}`}>{d.name || d.domain}</span>
                        <Badge className={`text-[10px] px-1.5 py-0 ${d.isActive ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" : "bg-card text-muted-foreground border-border"}`}>
                          {d.isActive ? "ACTIVE" : "INACTIVE"}
                        </Badge>
                        {isSelected && (
                          <Badge className="text-[10px] px-1.5 py-0 bg-blue-500/10 text-blue-500 border-blue-500/20">
                            SELECTED
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground truncate mt-0.5" data-testid={`text-domain-url-${d.id}`}>{d.domain}</p>
                    </div>
                  </div>

                  <div className="hidden sm:flex items-center gap-4 flex-shrink-0">
                    <div className="text-center px-3">
                      <p className="text-sm font-bold text-foreground" data-testid={`stat-visits-${d.id}`}>{d.stats.totalVisits.toLocaleString()}</p>
                      <p className="text-[10px] text-muted-foreground">Visits</p>
                    </div>
                    <div className="text-center px-3">
                      <p className="text-sm font-bold text-foreground" data-testid={`stat-unique-${d.id}`}>{d.stats.uniqueVisitors.toLocaleString()}</p>
                      <p className="text-[10px] text-muted-foreground">Unique</p>
                    </div>
                    <div className="text-center px-3">
                      <p className="text-sm font-bold text-blue-500" data-testid={`stat-blocked-${d.id}`}>{d.stats.blockedIps.toLocaleString()}</p>
                      <p className="text-[10px] text-muted-foreground">Blocked</p>
                    </div>
                    <div className="text-center px-3">
                      <p className="text-sm font-bold text-red-400" data-testid={`stat-suspicious-${d.id}`}>{d.stats.suspiciousVisits.toLocaleString()}</p>
                      <p className="text-[10px] text-muted-foreground">Suspicious</p>
                    </div>
                  </div>

                  <div className="flex items-center gap-1 flex-shrink-0">
                    {!isDeleting ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-8 w-8 p-0 text-muted-foreground hover:text-red-400 hover:bg-red-500/10"
                        onClick={(e) => {
                          e.stopPropagation();
                          setConfirmDeleteId(d.id);
                        }}
                        data-testid={`button-delete-${d.id}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    ) : (
                      <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                        <Button
                          size="sm"
                          className="h-7 text-xs bg-red-500 hover:bg-red-600 text-white px-2"
                          onClick={() => handleDeleteDomain(d.id)}
                          disabled={deleteDomainMutation.isPending}
                          data-testid={`button-confirm-delete-${d.id}`}
                        >
                          {deleteDomainMutation.isPending ? "..." : "Delete"}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 text-xs text-muted-foreground px-2"
                          onClick={() => setConfirmDeleteId(null)}
                          data-testid={`button-cancel-delete-${d.id}`}
                        >
                          Cancel
                        </Button>
                      </div>
                    )}
                  </div>
                </div>

                <div className="sm:hidden flex items-center gap-4 mt-3 pt-3 border-t border-border">
                  <div className="text-center flex-1">
                    <p className="text-sm font-bold text-foreground">{d.stats.totalVisits.toLocaleString()}</p>
                    <p className="text-[10px] text-muted-foreground">Visits</p>
                  </div>
                  <div className="text-center flex-1">
                    <p className="text-sm font-bold text-foreground">{d.stats.uniqueVisitors.toLocaleString()}</p>
                    <p className="text-[10px] text-muted-foreground">Unique</p>
                  </div>
                  <div className="text-center flex-1">
                    <p className="text-sm font-bold text-blue-500">{d.stats.blockedIps.toLocaleString()}</p>
                    <p className="text-[10px] text-muted-foreground">Blocked</p>
                  </div>
                  <div className="text-center flex-1">
                    <p className="text-sm font-bold text-red-400">{d.stats.suspiciousVisits.toLocaleString()}</p>
                    <p className="text-[10px] text-muted-foreground">Suspicious</p>
                  </div>
                </div>

                {isDeleting && (
                  <div className="mt-3 p-3 bg-red-500/[0.06] border border-red-500/20 rounded-lg" onClick={e => e.stopPropagation()}>
                    <p className="text-xs text-red-300">
                      <AlertTriangle className="h-3.5 w-3.5 inline mr-1" />
                      This will permanently remove <strong>{d.domain}</strong> and all its tracking data, visit history, and blocked IPs. This cannot be undone.
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {domains.length === 0 && (
        <Card className="bg-card border-border">
          <CardContent className="p-8 text-center">
            <Globe className="h-12 w-12 text-muted-foreground mx-auto mb-3" />
            <p className="text-muted-foreground text-sm">No domains added yet. Add your first domain to start tracking.</p>
          </CardContent>
        </Card>
      )}

      <div className="border-t border-border pt-6 mt-8" />

      <h2 className="text-xl font-bold text-foreground flex items-center gap-2">
        <Settings2 className="h-5 w-5 text-blue-500" /> Detection Rules
        <span className="text-xs font-normal text-muted-foreground ml-2">for {domain.domain}</span>
      </h2>

      <Card className="bg-card border-border" data-testid="card-click-threshold">
        <CardContent className="p-5">
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <h3 className="text-base font-semibold text-foreground flex items-center gap-2">
                <Crosshair className="h-4 w-4 text-blue-500" /> Click Fraud Threshold
              </h3>
              <p className="text-sm text-muted-foreground mt-1">
                Add up to 5 rules to detect IPs based on thresholds. For example: Detect an IP if they click on an ad 3 times within 10 minutes.
              </p>
              <div className="mt-4 flex items-center gap-3">
                <span className="text-sm text-muted-foreground">Allow up to</span>
                <Input
                  type="number"
                  value={clickThreshold}
                  onChange={e => setClickThreshold(e.target.value)}
                  className="w-20 bg-card border-border text-foreground text-center"
                  min={1}
                  max={20}
                  data-testid="input-click-threshold"
                />
                <span className="text-sm text-muted-foreground">ad click within the timeframe</span>
              </div>
              <div className="mt-3 flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="border-blue-500/30 text-blue-500 hover:bg-blue-500/10"
                  onClick={() => updateSetting.mutate({ clickThreshold: parseInt(clickThreshold) })}
                  data-testid="button-update-threshold"
                >
                  Update Threshold Rules
                </Button>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="bg-card border-border" data-testid="card-detect-device-id">
        <CardContent className="p-5">
          <div className="flex items-center justify-between">
            <div className="flex-1">
              <h3 className="text-base font-semibold text-foreground flex items-center gap-2">
                <Fingerprint className="h-4 w-4 text-blue-500" /> Detect IPs Based on Device IDs
              </h3>
              <p className="text-sm text-muted-foreground mt-1">
                By enabling this feature, Click Guard will detect IPs that were used by the same device ID to click your ads repeatedly. This feature requires the tracking code to be installed.
              </p>
            </div>
            <Switch
              checked={settings.detectDeviceId !== false}
              onCheckedChange={() => toggleSetting("detectDeviceId")}
              data-testid="switch-detect-device"
            />
          </div>
        </CardContent>
      </Card>

      <Card className="bg-card border-border" data-testid="card-block-country">
        <CardContent className="p-5">
          <div className="flex items-center justify-between">
            <div className="flex-1">
              <h3 className="text-base font-semibold text-foreground flex items-center gap-2">
                <MapPin className="h-4 w-4 text-blue-500" /> Block IPs By Country
              </h3>
              <p className="text-sm text-muted-foreground mt-1">
                Block or allow clicks coming from IPs from the following countries.
              </p>
              <div className="mt-3 space-y-2">
                <div className="flex items-center gap-3">
                  <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer">
                    <input type="radio" name="countryMode" checked={settings.countryMode !== "block"} onChange={() => updateSetting.mutate({ countryMode: "allow" })} className="accent-blue-500" />
                    Only <strong className="text-foreground">allow</strong> clicks coming from the following countries
                  </label>
                </div>
                <div className="flex items-center gap-3">
                  <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer">
                    <input type="radio" name="countryMode" checked={settings.countryMode === "block"} onChange={() => updateSetting.mutate({ countryMode: "block" })} className="accent-blue-500" />
                    <strong className="text-foreground">Block</strong> any click coming from the following countries
                  </label>
                </div>
                <div className="mt-2">
                  <Badge className="bg-blue-500/20 text-blue-400 border-blue-500/30 px-3 py-1">
                    United States <X className="h-3 w-3 ml-1.5 cursor-pointer" />
                  </Badge>
                </div>
              </div>
            </div>
            <Switch
              checked={settings.blockByCountry !== false}
              onCheckedChange={() => toggleSetting("blockByCountry")}
              data-testid="switch-block-country"
            />
          </div>
        </CardContent>
      </Card>

      <Card className="bg-card border-border" data-testid="card-block-js-disabled">
        <CardContent className="p-5">
          <div className="flex items-center justify-between">
            <div className="flex-1">
              <h3 className="text-base font-semibold text-foreground flex items-center gap-2">
                <Bot className="h-4 w-4 text-blue-500" /> Block JavaScript Disabled Browsers
              </h3>
              <p className="text-sm text-muted-foreground mt-1">
                Enabling this feature allows Click Guard to block IPs once a browser with a disabled Javascript clicks your ads (usually a bot).
              </p>
            </div>
            <Switch
              checked={settings.blockJsDisabled !== false}
              onCheckedChange={() => toggleSetting("blockJsDisabled")}
              data-testid="switch-block-js"
            />
          </div>
        </CardContent>
      </Card>

      <Card className="bg-card border-border" data-testid="card-vpn-blocking">
        <CardContent className="p-5">
          <div className="flex items-center justify-between">
            <div className="flex-1">
              <h3 className="text-base font-semibold text-foreground flex items-center gap-2">
                <ShieldBan className="h-4 w-4 text-blue-500" /> VPN Blocking
              </h3>
              <p className="text-sm text-muted-foreground mt-1">
                By enabling this feature, Click Guard will block any IP that uses a VPN (Virtual Private Network) to click your ads.
              </p>
              <p className="text-xs text-emerald-400/80 mt-1">Recommended: Enabled</p>
            </div>
            <Switch
              checked={settings.vpnBlocking !== false}
              onCheckedChange={() => toggleSetting("vpnBlocking")}
              data-testid="switch-vpn"
            />
          </div>
        </CardContent>
      </Card>

      <Card className="bg-card border-border" data-testid="card-behavior-analysis">
        <CardContent className="p-5">
          <div className="flex items-center justify-between">
            <div className="flex-1">
              <h3 className="text-base font-semibold text-foreground flex items-center gap-2">
                <Activity className="h-4 w-4 text-blue-500" /> Behavior Analysis
              </h3>
              <p className="text-sm text-muted-foreground mt-1">
                By enabling this feature, Click Guard will record user activity on your site which you can use to determine whether the click was made by a human or a bot. The Tracking Code must be installed on your site for this feature to work.
              </p>
              <p className="text-xs text-emerald-400/80 mt-1">Recommended: Enabled</p>
            </div>
            <Switch
              checked={settings.behaviorAnalysis !== false}
              onCheckedChange={() => toggleSetting("behaviorAnalysis")}
              data-testid="switch-behavior"
            />
          </div>
        </CardContent>
      </Card>

      <h2 className="text-xl font-bold text-foreground flex items-center gap-2 pt-4">
        <ShieldBan className="h-5 w-5 text-blue-500" /> Manage Auto IP Blocking
      </h2>

      <Card className="bg-card border-border" data-testid="card-block-period">
        <CardContent className="p-5">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1">
              <h3 className="text-base font-semibold text-foreground">Block IPs for a Certain Period</h3>
              <p className="text-sm text-muted-foreground mt-1">
                A number between 1 and 90 that represents the maximum number of days each IP will be blocked.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Input
                type="number"
                value={blockDays}
                onChange={e => setBlockDays(e.target.value)}
                className="w-20 bg-card border-border text-foreground text-center"
                min={1}
                max={90}
                data-testid="input-block-days"
              />
              <Button
                size="sm"
                variant="outline"
                className="border-blue-500/30 text-blue-500 hover:bg-blue-500/10"
                onClick={() => updateSetting.mutate({ blockDays: parseInt(blockDays) })}
                data-testid="button-update-block-days"
              >
                Update
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="bg-card border-border" data-testid="card-exclusion-rate">
        <CardContent className="p-5">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1">
              <h3 className="text-base font-semibold text-foreground">Exclusion List Refresh Rate</h3>
              <p className="text-sm text-muted-foreground mt-1">
                A number between 50-500 that represents the exclusion list max length. A longer list means a slower refresh rate.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Input
                type="number"
                value={exclusionListRate}
                onChange={e => setExclusionListRate(e.target.value)}
                className="w-20 bg-card border-border text-foreground text-center"
                min={50}
                max={500}
                data-testid="input-exclusion-rate"
              />
              <Button
                size="sm"
                variant="outline"
                className="border-blue-500/30 text-blue-500 hover:bg-blue-500/10"
                onClick={() => updateSetting.mutate({ exclusionListRate: parseInt(exclusionListRate) })}
                data-testid="button-update-exclusion"
              >
                Update
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="bg-card border-border" data-testid="card-ip-range">
        <CardContent className="p-5">
          <div className="flex items-center justify-between">
            <div className="flex-1">
              <h3 className="text-base font-semibold text-foreground">IP Range Exclusion</h3>
              <p className="text-sm text-muted-foreground mt-1">
                By enabling this feature, Click Guard will block ranges of IPs (like 172.165.11.*) when too many clicks are made by different IPs from the same range of IP addresses.
              </p>
            </div>
            <Switch
              checked={settings.ipRangeExclusion !== false}
              onCheckedChange={() => toggleSetting("ipRangeExclusion")}
              data-testid="switch-ip-range"
            />
          </div>
        </CardContent>
      </Card>

      <Card className="bg-card border-border" data-testid="card-manual-exclude">
        <CardContent className="p-5">
          <h3 className="text-base font-semibold text-foreground">Manually Exclude IPs</h3>
          <p className="text-sm text-muted-foreground mt-1">
            Fill out the text box with IP addresses (each IP address in a new line) that you wish to add to your exclusion list. These IPs will be blocked until you remove them.
          </p>
          <p className="text-xs text-muted-foreground mt-2">
            You can use single IP addresses or a range using the wildcard character (*) or CIDR notation.
          </p>
          <p className="text-xs text-muted-foreground mt-1">Examples: 112.4.5.67 · 112.4.5.* · 112.4.0.0/16 · 112.4.2.4/23</p>
          <Textarea
            value={manualExcludeIps}
            onChange={e => setManualExcludeIps(e.target.value)}
            placeholder="72.12.230.50"
            className="mt-3 bg-card border-border text-foreground font-mono text-sm min-h-[100px]"
            data-testid="textarea-manual-exclude"
          />
          <Button
            size="sm"
            variant="outline"
            className="mt-3 border-blue-500/30 text-blue-500 hover:bg-blue-500/10"
            onClick={() => updateSetting.mutate({ manualExcludeIps })}
            data-testid="button-update-exclude"
          >
            Update
          </Button>
        </CardContent>
      </Card>

      <Card className="bg-card border-border" data-testid="card-whitelist">
        <CardContent className="p-5">
          <h3 className="text-base font-semibold text-foreground">Whitelist IPs</h3>
          <p className="text-sm text-muted-foreground mt-1">
            Fill out the text box with IP addresses (each IP address in a new line) that you wish for Click Guard to <strong className="text-foreground">never</strong> block.
          </p>
          <p className="text-xs text-muted-foreground mt-2">Examples: 112.4.5.67 · 112.4.5.* · 112.4.0.0/16 · 112.4.2.4/23</p>
          <Textarea
            value={whitelistIps}
            onChange={e => setWhitelistIps(e.target.value)}
            placeholder="Enter IPs to whitelist..."
            className="mt-3 bg-card border-border text-foreground font-mono text-sm min-h-[100px]"
            data-testid="textarea-whitelist"
          />
          <Button
            size="sm"
            variant="outline"
            className="mt-3 border-blue-500/30 text-blue-500 hover:bg-blue-500/10"
            onClick={() => updateSetting.mutate({ whitelistIps })}
            data-testid="button-update-whitelist"
          >
            Update
          </Button>
        </CardContent>
      </Card>

      <Card className="bg-card border-border" data-testid="card-aggressive">
        <CardContent className="p-5">
          <div className="flex items-center justify-between">
            <div className="flex-1">
              <h3 className="text-base font-semibold text-foreground">Aggressive Blocking</h3>
              <p className="text-sm text-muted-foreground mt-1">
                By enabling this feature, Click Guard will apply an extremely aggressive approach to block click fraud. Recommended for high-CPC campaigns.
              </p>
            </div>
            <Switch
              checked={settings.aggressiveBlocking === true}
              onCheckedChange={() => toggleSetting("aggressiveBlocking")}
              data-testid="switch-aggressive"
            />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
