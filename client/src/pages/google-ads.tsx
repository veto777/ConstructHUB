import { Tabs, TabsTrigger } from "@/components/ui/tabs";
import { AppPage, PageHeader, Section, StatGrid, Stat, AppTabsList, Toolbar, Notice, appTable, appTableCards } from "@/components/app-ui";
import { useAppOrigin } from "@/lib/app-origin";
import { useState } from "react";
import { useLocation, useSearch } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiErrorMessage, apiRequest, queryClient } from "@/lib/queryClient";
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

// The exclusion-list URL (and the script that embeds it) carries a per-domain key.
const PRIVATE_KEY_NOTE = "This link contains a private key — keep it in your Google Ads script only. Scripts copied before this update must be copied again (the old link now returns 403).";

const FRAUD_TABS = ["Blocked IPs", "Countries", "Multi-Clicks", "Devices", "Browsers", "OS"];

const PAGE_TABS = ["dashboard", "traffic", "fraud", "tools", "settings", "link-ads"] as const;
type PageTab = typeof PAGE_TABS[number];

// Clipboard writes can be refused (no permission, insecure context, some
// browsers). Report what happened instead of announcing a copy that failed.
async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (!navigator.clipboard?.writeText) return false;
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
const COPY_BLOCKED = "Your browser blocked clipboard access. Select the text and copy it manually.";

export default function ClickGuardPage() {
  const appOrigin = useAppOrigin();
  const { toast } = useToast();
  // The tab and domain live in the URL (?tab=settings&domain=12) so a reload
  // or a shared link lands on the same view instead of resetting to the
  // dashboard and the first domain.
  const [location, navigate] = useLocation();
  const search = useSearch();
  const urlParams = new URLSearchParams(search);
  const tabParam = urlParams.get("tab");
  const activeTab: PageTab = (PAGE_TABS as readonly string[]).includes(tabParam ?? "") ? (tabParam as PageTab) : "dashboard";
  const domainParam = Number(urlParams.get("domain"));
  const selectedDomainId = Number.isInteger(domainParam) && domainParam > 0 ? domainParam : null;
  const updateUrl = (next: { tab?: PageTab; domain?: number | null }) => {
    const params = new URLSearchParams(search);
    if (next.tab !== undefined) {
      if (next.tab === "dashboard") params.delete("tab");
      else params.set("tab", next.tab);
    }
    if (next.domain !== undefined) {
      if (next.domain == null) params.delete("domain");
      else params.set("domain", String(next.domain));
    }
    const qs = params.toString();
    navigate(qs ? `${location}?${qs}` : location, { replace: true });
  };
  const setActiveTab = (tab: PageTab) => updateUrl({ tab });
  const setSelectedDomainId = (id: number | null) => updateUrl({ domain: id });
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
    queryKey: ["/api/click-guard/domains", domainId, "visits", dateRange],
    queryFn: () => fetch(`/api/click-guard/domains/${domainId}/visits?start=${dateStart}&end=${dateEnd}`).then(r => r.json()),
    enabled: !!domainId,
  });

  const { data: blockedIps = [] } = useQuery<BlockedIp[]>({
    queryKey: ["/api/click-guard/domains", domainId, "blocked"],
    enabled: !!domainId,
  });

  const addDomainMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/click-guard/domains", { domain: newDomain.trim(), name: newDomainName.trim() || newDomain.trim() });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/click-guard/domains"] });
      setShowAddDomain(false);
      setNewDomain("");
      setNewDomainName("");
      toast({ title: "Domain added", description: "Your domain is now being tracked." });
    },
    onError: (e: unknown) => {
      toast({ title: "Couldn't add domain", description: apiErrorMessage(e), variant: "destructive" });
    },
  });

  const deleteDomainMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/click-guard/domains/${id}`);
      return id;
    },
    onSuccess: async (deletedId) => {
      const remaining = domains.filter(d => d.id !== deletedId);
      // Drop the deleted domain from the cached list first, so nothing is
      // selected (or refetched) under its id, then forget its per-domain
      // queries — a prefix invalidation used to refetch its analytics,
      // visits and blocked IPs and get three 404s.
      queryClient.setQueryData<DomainWithStats[]>(["/api/click-guard/domains"], old => old?.filter(d => d.id !== deletedId));
      await queryClient.cancelQueries({ queryKey: ["/api/click-guard/domains", deletedId] });
      queryClient.removeQueries({ queryKey: ["/api/click-guard/domains", deletedId] });
      setSelectedDomainId(remaining.length > 0 ? remaining[0].id : null);
      queryClient.invalidateQueries({ queryKey: ["/api/click-guard/domains"], exact: true });
      toast({ title: "Domain removed" });
    },
    onError: (e: unknown) => {
      toast({ title: "Couldn't remove domain", description: apiErrorMessage(e), variant: "destructive" });
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
    onError: (e: unknown) => {
      toast({ title: "Couldn't block IP", description: apiErrorMessage(e), variant: "destructive" });
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
    ? `<script src="${appOrigin}/api/click-guard/script/${selectedDomain.trackingId}" async></script>`
    : "";

  const copyScript = async () => {
    if (await copyToClipboard(scriptSnippet)) toast({ title: "Copied!", description: "Tracking script copied to clipboard." });
    else toast({ title: "Couldn't copy", description: COPY_BLOCKED, variant: "destructive" });
  };

  const threatColor = analytics?.threatLevel === "critical" ? "text-red-400" : analytics?.threatLevel === "substantial" ? "text-muted-foreground" : "text-emerald-400";
  const threatBg = analytics?.threatLevel === "critical" ? "bg-red-500/20" : analytics?.threatLevel === "substantial" ? "bg-muted" : "bg-emerald-500/20";

  const filteredVisits = ipSearch ? visits.filter(v => v.ipAddress.includes(ipSearch)) : visits;

  const dailyEntries = analytics?.dailyVisits ? Object.entries(analytics.dailyVisits).sort((a, b) => a[0].localeCompare(b[0])) : [];
  const maxDailyVisits = Math.max(...dailyEntries.map(([, v]) => v), 1);

  return (
    <AppPage className="[&_button]:min-h-10">
      <PageHeader title={<span data-testid="text-page-title">Click fraud protection</span>}
        description={<span data-testid="text-subtitle">Track website visits and review unusual traffic.</span>}
        meta={<Badge variant="outline" data-testid="badge-click-guard">Google Click Guard</Badge>}
        actions={<Button variant={showAddDomain ? "outline" : "default"} onClick={() => setShowAddDomain(true)} data-testid="button-add-domain"><Plus className="mr-2 h-4 w-4" />Add domain</Button>} />
      {selectedDomain && <select aria-label="Website domain" className="h-10 w-full sm:w-72 rounded-md border bg-card px-3 text-sm" value={domainId || ""} onChange={e => setSelectedDomainId(Number(e.target.value))} data-testid="select-domain">{domains.map(d => <option key={d.id} value={d.id}>{d.name || d.domain}</option>)}</select>}
      <details className="text-sm text-muted-foreground"><summary className="cursor-pointer py-2">How protection works</summary><p>Signals do not prove fraud. Apply IP exclusions using the separate Google Ads script.</p></details>
          {showAddDomain && (
            <Section flush className="bg-card border-border mb-6" testId="card-add-domain">
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
                      className=""
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
            </Section>
          )}

<Tabs value={activeTab}><AppTabsList>
            {PAGE_TABS.map(tab => {
              const labels: Record<string, string> = {
                dashboard: "Dashboard",
                traffic: "Traffic sources",
                fraud: "Traffic signals",
                tools: "Tools",
                settings: "Domain settings",
                "link-ads": "Google Ads script",
              };
              const shortLabels: Record<string, string> = {
                dashboard: "Dashboard",
                traffic: "Traffic",
                fraud: "Signals",
                tools: "Tools",
                settings: "Settings",
                "link-ads": "Ads script",
              };
              const tabIcons: Record<string, typeof Shield> = {
                "link-ads": Link2,
              };
              const TabIcon = tabIcons[tab];
              return (
                <TabsTrigger value={tab}
                  key={tab}
                  className={`shrink-0 text-xs sm:text-sm ${activeTab === tab
                    ? "bg-muted text-foreground"
                    : "text-muted-foreground"
                  }`}
                  onClick={() => setActiveTab(tab)}
                  data-testid={`tab-${tab}`}
                >
                  {TabIcon && <TabIcon className="h-3.5 w-3.5 mr-1" />}
                  <span className="hidden sm:inline">{labels[tab]}</span>
                  <span className="sm:hidden">{shortLabels[tab]}</span>
                </TabsTrigger>
              );
            })}
          </AppTabsList></Tabs>

          {activeTab === "link-ads" && <LinkGoogleAdsView domainId={domainId} trackingId={selectedDomain?.trackingId} />}

          {activeTab !== "link-ads" && (
            <>
              {domainsLoading ? (
                <div className="flex items-center justify-center py-20">
                  <div className="animate-spin h-8 w-8 border-2 border-border border-t-transparent rounded-full" />
                </div>
              ) : !selectedDomain ? (
                <Section flush className="bg-card border-border">
                  <CardContent className="p-12 text-center">
                    <Shield className="h-16 w-16 text-muted-foreground mx-auto mb-4" />
                    <h2 className="text-base font-semibold text-foreground mb-2" data-testid="text-no-domains">No domains yet</h2>
                    <p className="text-muted-foreground mb-6">Add your first website domain to start tracking visitors and reviewing unusual traffic patterns.</p>
                    <Button
                      variant="outline"
                      onClick={() => setShowAddDomain(true)}
                      data-testid="button-add-first-domain"
                    >
                      <Plus className="h-4 w-4 mr-2" /> Add your first domain
                    </Button>
                  </CardContent>
                </Section>
              ) : (
                <>
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
                      key={selectedDomain.id}
                      domain={selectedDomain}
                      domains={domains}
                      deleteDomainMutation={deleteDomainMutation}
                      selectedDomainId={selectedDomain.id}
                      setSelectedDomainId={setSelectedDomainId}
                      setShowAddDomain={setShowAddDomain}
                    />
                  )}
                </>
              )}
            </>
          )}
    </AppPage>
  );
}

function LinkGoogleAdsView({ domainId, trackingId }: { domainId?: number; trackingId?: string }) {
  const appOrigin = useAppOrigin();
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

  // A real check of the public list the Ads script downloads — not a
  // hard-coded "Live". Shows what the script would receive right now.
  const exclusionUrl = scriptData?.exclusionUrl;
  const { data: exclusionCheck, isLoading: exclusionChecking, isError: exclusionCheckFailed } = useQuery<{ count: number }>({
    queryKey: ["click-guard-exclusion-check", exclusionUrl],
    queryFn: async () => {
      const res = await fetch(exclusionUrl!, { cache: "no-store", credentials: "omit" });
      if (!res.ok) throw new Error(`${res.status}`);
      const body = await res.json();
      return { count: Array.isArray(body?.ips) ? body.ips.length : 0 };
    },
    enabled: !!exclusionUrl,
  });

  const trackingSnippet = trackingId
    ? `<!-- Click Guard by ConstructHUB -->\n<script src="${appOrigin}/api/click-guard/script/${trackingId}" async></script>`
    : "";

  const copyScript = async () => {
    if (!scriptData?.script) return;
    if (!(await copyToClipboard(scriptData.script))) {
      toast({ title: "Couldn't copy the script", description: COPY_BLOCKED, variant: "destructive" });
      return;
    }
    setScriptCopied(true);
    toast({ title: "Script copied!", description: "Paste this into Google Ads scripts." });
    setTimeout(() => setScriptCopied(false), 3000);
  };

  const copyTrackingSnippet = async () => {
    if (!(await copyToClipboard(trackingSnippet))) {
      toast({ title: "Couldn't copy the tracking code", description: COPY_BLOCKED, variant: "destructive" });
      return;
    }
    setTrackingCopied(true);
    toast({ title: "Tracking code copied!", description: "Add this to your website's header or footer." });
    setTimeout(() => setTrackingCopied(false), 3000);
  };

  const copyIpList = async () => {
    const ipList = blockedIps.filter(b => b.isActive).map(b => b.ipAddress).join("\n");
    if (await copyToClipboard(ipList)) toast({ title: "IP list copied!", description: `${activeBlockedCount} IPs copied to clipboard.` });
    else toast({ title: "Couldn't copy the IP list", description: "Your browser blocked clipboard access. The same IPs are listed under Traffic signals → Blocked IPs.", variant: "destructive" });
  };

  const copyExclusionUrl = async () => {
    if (!scriptData?.exclusionUrl) return;
    if (await copyToClipboard(scriptData.exclusionUrl)) toast({ title: "API URL copied!", description: "Use this URL to fetch your blocked IP list." });
    else toast({ title: "Couldn't copy the URL", description: COPY_BLOCKED, variant: "destructive" });
  };

  return (
    <div className="space-y-8" data-testid="view-link-google-ads">
      <div className="text-center max-w-3xl mx-auto mb-8">
        <div className="inline-flex items-center gap-2 bg-muted border border-border rounded-full px-4 py-1.5 mb-4">
          <Link2 className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm text-muted-foreground font-medium">Google Ads script</span>
        </div>
        <h2 className="text-base font-semibold text-foreground mb-3" data-testid="text-link-title">
          Apply your IP list in Google Ads
        </h2>
        <details className="text-left"><summary className="cursor-pointer py-2 text-sm">How to apply exclusions</summary>        <p className="text-muted-foreground text-sm leading-relaxed">
          Click Guard records script-observed visits and flags unusual patterns. To apply its IP exclusion list, you paste a script into your own Google Ads account (Tools &rarr; Bulk actions &rarr; Scripts) and schedule it. This tab has no Google sign-in; the script runs inside your own Google Ads account. Agencies with a Google Ads manager (MCC) account can instead connect it with Google under Agency Ads &amp; LSA and apply Click Guard exclusions to mapped client accounts from there.
        </p></details>
      </div>

      {!domainId ? (
        <Section flush className="max-w-4xl mx-auto bg-muted border-border">
          <CardContent className="p-8 text-center">
            <AlertTriangle className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
            <h3 className="text-base font-semibold text-foreground mb-2">Add a domain first</h3>
            <p className="text-sm text-muted-foreground">Select the Dashboard tab and add your website domain to get started with Click Guard protection.</p>
          </CardContent>
        </Section>
      ) : (
        <>
          <StatGrid cols={3} className="max-w-4xl mx-auto">
            <Stat label="IPs ready to sync" value={exclusionCheck?.count ?? activeBlockedCount} testId="card-blocked-count" />
            <Stat label="Exclusion list" testId="card-api-status" value={<span data-testid="text-api-status">{scriptLoading || exclusionChecking ? "Checking..." : exclusionCheckFailed || !exclusionUrl ? "Unreachable" : "Reachable"}</span>} hint={exclusionCheck ? `Serving ${exclusionCheck.count} IPs` : "Exclusion list URL"} />
            <Stat label="Campaign IP limit" value={`${Math.min(exclusionCheck?.count ?? activeBlockedCount, 500)}/500`} testId="card-google-limit" />
          </StatGrid>

          <Section flush className="max-w-4xl mx-auto border-border" testId="card-step1-tracking">
            <CardHeader className="pb-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg    flex items-center justify-center text-white font-bold text-sm">1</div>
                <div>
                  <CardTitle className="text-foreground text-base">Install tracking code on your website</CardTitle>
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
                    className="h-7 text-xs text-muted-foreground text-muted-foreground"
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
              <div className="bg-muted border border-border rounded-lg p-3">
                <p className="text-xs text-muted-foreground leading-relaxed">
                  <span className="text-muted-foreground font-semibold">What this does:</span> When someone clicks your Google Ad and lands on your website, this script captures their IP address, device fingerprint, browser info, and behavior. That data is sent to ConstructHUB's Click Guard for fraud analysis.
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
          </Section>

          <Section flush className="max-w-4xl mx-auto border-border" testId="card-step2-detection">
            <CardHeader className="pb-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg    flex items-center justify-center text-white font-bold text-sm">2</div>
                <div>
                  <CardTitle className="text-foreground text-base">Click Guard flags unusual traffic automatically</CardTitle>
                  <p className="text-xs text-muted-foreground mt-0.5">No action needed — this happens on ConstructHUB's servers</p>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {[
                  { icon: MousePointerClick, label: "Multi-click detection", desc: "More than 5 visits from one IP in an hour" },
                  { icon: Bot, label: "Bot detection", desc: "Known bot user agents, headless browsers, crawlers" },
                  { icon: Fingerprint, label: "VPN hopping", desc: "Same device fingerprint appearing from different IPs" },
                  { icon: Ban, label: "Auto-blocking", desc: "A flagged IP with more than 10 visits in an hour is added to your Blocked IPs list" },
                ].map((item, i) => (
                  <div key={i} className="flex items-start gap-3 bg-card rounded-lg p-3">
                    <item.icon className="h-4 w-4 text-muted-foreground mt-0.5 flex-shrink-0" />
                    <div>
                      <p className="text-sm font-medium text-foreground">{item.label}</p>
                      <p className="text-xs text-muted-foreground">{item.desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Section>

          <Section flush className="max-w-4xl mx-auto border-emerald-500/20" testId="card-step3-google-ads">
            <CardHeader className="pb-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg    flex items-center justify-center text-white font-bold text-sm">3</div>
                <div>
                  <CardTitle className="text-foreground text-base">Paste the script into Google Ads</CardTitle>
                  <p className="text-xs text-muted-foreground mt-0.5" data-testid="text-step3-subtitle">Paste this script into Google Ads &rarr; Tools &rarr; Bulk actions &rarr; Scripts and schedule it. No Google sign-in is needed here; the script runs inside your own Google Ads account.</p>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="bg-emerald-500/5 border border-emerald-500/10 rounded-lg p-3">
                <p className="text-xs text-muted-foreground leading-relaxed">
                  <span className="text-emerald-400 font-semibold">How it works:</span> You paste a script into your Google Ads account (under Scripts). Scheduled hourly, each run calls ConstructHUB's API, gets your latest exclusion list, and adds any new IPs as IP exclusions on all your active campaigns. The script only adds exclusions; it never removes them, so an IP you later unblock or whitelist stays excluded in Google Ads until you remove it there. Google applies IP exclusions where supported; changing IPs and campaign limitations can reduce their effectiveness.
                </p>
              </div>

              <button
                className="w-full flex items-center justify-between bg-card hover:bg-card border border-border rounded-lg p-4 cursor-pointer transition-colors"
                onClick={() => setShowGadsScript(!showGadsScript)}
                data-testid="button-toggle-gads-script"
              >
                <div className="flex items-center gap-3">
                  <Zap className="h-5 w-5 text-muted-foreground" />
                  <div className="text-left">
                    <p className="text-sm font-semibold text-foreground">Google Ads IP Exclusion Script</p>
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
                        className="h-7 text-xs text-muted-foreground text-muted-foreground"
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
                  <p className="text-xs text-amber-600 dark:text-amber-400" data-testid="text-script-key-note">{PRIVATE_KEY_NOTE}</p>

                  <div className="bg-muted border border-border rounded-lg p-4">
                    <h4 className="text-sm font-semibold text-muted-foreground mb-3 flex items-center gap-2">
                      <BookOpen className="h-4 w-4" />
                      Install in Google Ads (3 steps)
                    </h4>
                    <div className="space-y-3">
                      {[
                        { step: 1, title: "Open Google Ads scripts", desc: "Go to ads.google.com → Tools & Settings → Bulk Actions → Scripts" },
                        { step: 2, title: "Create New Script", desc: "Click the + button, name it \"Click Guard IP Blocker\", paste the script above, and click Save" },
                        { step: 3, title: "Schedule It", desc: "Set the script to run Hourly. Click \"Run\" once to test it. Check the Logs tab to see which IPs were excluded." },
                      ].map(s => (
                        <div key={s.step} className="flex items-start gap-3">
                          <div className="w-6 h-6 rounded-full bg-muted flex items-center justify-center text-xs font-bold text-muted-foreground flex-shrink-0 mt-0.5">
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
                  IP exclusion list URL
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
                <p className="text-xs text-amber-600 dark:text-amber-400 mt-2" data-testid="text-exclusion-key-note">{PRIVATE_KEY_NOTE}</p>
                <p className="text-xs text-muted-foreground mt-2">
                  When you schedule it hourly, the Google Ads script calls this URL on each run. It returns your exclusion list in JSON format, up to the length set under Domain settings (500 at most). You can also use this with Microsoft Ads or any other platform.
                </p>
              </div>
            </CardContent>
          </Section>

          <Section flush className="max-w-4xl mx-auto bg-card border-border" testId="card-manual-method">
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
                    <CardTitle className="text-foreground text-base">Manual fallback — copy & paste IPs</CardTitle>
                    <p className="text-xs text-muted-foreground mt-0.5">If you prefer to manually add IPs to Google Ads</p>
                  </div>
                </div>
                <ChevronRight className={`h-5 w-5 text-muted-foreground transition-transform ${showManualSteps ? "rotate-90" : ""}`} />
              </button>
            </CardHeader>
            {showManualSteps && (
              <CardContent className="space-y-4 pt-0">
                <div className="flex items-center gap-3 bg-card rounded-lg p-3">
                  <Ban className="h-5 w-5 text-muted-foreground flex-shrink-0" />
                  <div className="flex-1">
                    <p className="text-sm text-foreground">{activeBlockedCount} blocked IPs ready to copy</p>
                    <p className="text-xs text-muted-foreground">One IP per line, formatted for Google Ads</p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline" className="min-h-10"
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
          </Section>

          <details className="max-w-4xl mx-auto space-y-4"><summary className="cursor-pointer py-3 text-sm font-medium">More about exclusions and limits</summary>
          <div className="max-w-4xl mx-auto grid grid-cols-1 md:grid-cols-3 gap-4">
            <Section flush className="    border-emerald-500/20" testId="card-tip-budget">
              <CardContent className="p-5">
                <DollarSign className="h-8 w-8 text-emerald-400 mb-3" />
                <h4 className="text-sm font-semibold text-foreground mb-1">Review IP exclusions</h4>
                <p className="text-xs text-muted-foreground">IP exclusions can reduce repeated traffic from specified addresses on supported campaigns, but do not identify a person or guarantee savings.</p>
              </CardContent>
            </Section>
            <Section flush className="    border-border" testId="card-tip-auto">
              <CardContent className="p-5">
                <RefreshCw className="h-8 w-8 text-muted-foreground mb-3" />
                <h4 className="text-sm font-semibold text-foreground mb-1">Runs when you schedule it</h4>
                <p className="text-xs text-muted-foreground">Once you schedule the pasted script to run hourly in Google Ads, each run adds newly listed IPs to your enabled campaigns. Check its Logs tab to confirm it ran.</p>
              </CardContent>
            </Section>
            <Section flush className="    border-border" testId="card-tip-fingerprint">
              <CardContent className="p-5">
                <Fingerprint className="h-8 w-8 text-muted-foreground mb-3" />
                <h4 className="text-sm font-semibold text-foreground mb-1">Smarter than IP alone</h4>
                <p className="text-xs text-muted-foreground">Click Guard compares reported fingerprints and visit patterns. These signals can flag legitimate visitors and do not establish identity or fraud.</p>
              </CardContent>
            </Section>
          </div>

          <Section flush className="max-w-4xl mx-auto bg-muted border-border" testId="card-pro-tip">
            <CardContent className="p-5">
              <div className="flex items-start gap-3">
                <AlertTriangle className="h-5 w-5 text-muted-foreground flex-shrink-0 mt-0.5" />
                <div>
                  <h4 className="text-sm font-semibold text-muted-foreground mb-1">Pro tip: Google Ads has a 500 IP limit</h4>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    Google Ads allows 500 IP exclusions per campaign. The script stops adding IPs once a campaign reaches that limit, so review and remove old exclusions in Google Ads when the list fills up.
                  </p>
                </div>
              </div>
            </CardContent>
          </Section>
          </details>
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
    { label: "Visits", value: analytics?.totalVisits ?? 0, icon: Eye, color: "text-muted-foreground", bg: " " },
    { label: "Blocked IPs", value: analytics?.blockedIps ?? 0, icon: Ban, color: "text-red-400", bg: " " },
    { label: "Unique Visitors", value: analytics?.uniqueVisitors ?? 0, icon: Users, color: "text-emerald-400", bg: " " },
    { label: "Avg Visits/User", value: analytics?.avgVisitsPerUser ?? 0, icon: BarChart3, color: "text-muted-foreground", bg: " " },
  ];

  return (
    <div className="space-y-6">
      <Toolbar filters={<>
        {["1d", "7d", "30d"].map(r => (
          <Button
            key={r}
            size="sm"
            variant={dateRange === r ? "secondary" : "ghost"}
            className={dateRange === r ? "bg-muted text-foreground" : "text-muted-foreground border border-border"}
            onClick={() => setDateRange(r)}
            data-testid={`button-range-${r}`}
          >
            {r === "1d" ? "Daily" : r === "7d" ? "Last 7 days" : "Last 30 days"}
          </Button>
        ))}
      </>} />

      <StatGrid>{stats.map(s => <Stat key={s.label} label={s.label === "Unique Visitors" ? "Unique visitors" : s.label === "Avg Visits/User" ? "Visits per visitor" : s.label} value={typeof s.value === "number" ? s.value.toLocaleString() : s.value} testId={`card-stat-${s.label.toLowerCase().replace(/[\s\/]/g, "-")}`} />)}</StatGrid>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Section flush className="lg:col-span-2 bg-card border-border" testId="card-threat-level">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-semibold text-foreground flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-muted-foreground" /> Threat level
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
        </Section>

        <Section flush className="bg-card border-border" testId="card-savings">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-semibold text-foreground flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-emerald-400" /> Cost illustration
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            <div className="text-center py-4">
              {(analytics?.blockedIps ?? 0) > 0 ? (
                <>
                  <p className="text-2xl font-semibold text-emerald-400">${((analytics?.blockedIps ?? 0) * 4.5).toFixed(0)}</p>
                  <p className="text-xs text-muted-foreground mt-1">Illustration based on listed IPs; not measured savings</p>
                  <p className="text-xs text-muted-foreground mt-1">Assumes $4.50 per click; no actual ad-cost data is connected</p>
                </>
              ) : (
                <p className="text-muted-foreground text-sm">No listed IPs in this range</p>
              )}
            </div>
          </CardContent>
        </Section>
      </div>

      {dailyEntries.length > 0 && (
        <Section flush className="bg-card border-border" testId="card-chart">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-semibold text-foreground flex items-center gap-2">
              <BarChart3 className="h-5 w-5 text-muted-foreground" /> Visit trend
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-2">
            <div className="flex items-end gap-1 h-40">
              {dailyEntries.map(([date, count]) => (
                <div key={date} className="flex-1 flex flex-col items-center gap-1">
                  <div className="w-full flex flex-col items-center justify-end flex-1">
                    <div
                      className="w-full max-w-[32px]    rounded-t-sm opacity-80"
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
        </Section>
      )}

      {analytics && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Section flush className="bg-card border-border" testId="card-device-breakdown">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-bold text-foreground flex items-center gap-2">
                <Monitor className="h-4 w-4 text-muted-foreground" /> Visits by device
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
                          <div className="h-full    rounded-full" style={{ width: `${pct}%` }} />
                        </div>
                        <span className="text-xs text-muted-foreground w-16 text-right">{count} ({pct}%)</span>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground text-center py-4">No device data yet</p>
              )}
            </CardContent>
          </Section>

          <Section flush className="bg-card border-border" testId="card-browser-breakdown">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-bold text-foreground flex items-center gap-2">
                <Globe className="h-4 w-4 text-muted-foreground" /> Browser breakdown
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
                          <div className="h-full    rounded-full" style={{ width: `${pct}%` }} />
                        </div>
                        <span className="text-xs text-muted-foreground w-16 text-right">{count} ({pct}%)</span>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground text-center py-4">No browser data yet</p>
              )}
            </CardContent>
          </Section>
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
        <h3 className="text-base font-semibold text-foreground flex items-center gap-2" data-testid="text-traffic-title">
          <Globe className="h-5 w-5 text-muted-foreground" /> Traffic sources by domain / vendor
        </h3>
        <Toolbar filters={<>
          {["1d", "7d", "30d"].map(r => (
            <Button
              key={r}
              size="sm"
              variant={dateRange === r ? "secondary" : "ghost"}
              className={dateRange === r ? "bg-muted text-foreground" : "text-muted-foreground border border-border"}
              onClick={() => setDateRange(r)}
              data-testid={`button-traffic-range-${r}`}
            >
              {r === "1d" ? "Daily" : r === "7d" ? "Last 7 days" : "Last 30 days"}
            </Button>
          ))}
        </>} />
      </div>

      <StatGrid cols={3}>
        <Stat label="Traffic sources" value={sources.length} testId="card-total-sources" />
        <Stat label="Page loads" value={totalPageLoads.toLocaleString()} testId="card-total-pageloads" />
        <Stat label="Visitors" value={totalVisitors.toLocaleString()} testId="card-total-visitors" />
      </StatGrid>

      <Section flush className="bg-card border-border" testId="card-traffic-table">
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className={appTable.table}>
              <thead className={appTableCards.thead}>
                <tr className={appTableCards.tr + " border-b border-border bg-muted/50"}>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground ">Percentage</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground ">Page loads</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground ">Visitors</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground ">Traffic sources by domain / vendor</th>
                </tr>
              </thead>
              <tbody>
                {sources.length > 0 ? sources.map((source, i) => (
                  <tr key={source.domain} className={appTableCards.tr + " border-b border-border last:border-0 hover:bg-card transition-colors"} data-testid={`row-traffic-${i}`}>
                    <td className={appTableCards.td + " min-w-0 break-words"}><span className="mr-2 text-xs font-medium text-muted-foreground sm:hidden">Percentage: </span>
                      <div className="flex items-center gap-2">
                        <div className="w-16 h-2 bg-muted rounded-full overflow-hidden">
                          <div
                            className="h-full    rounded-full"
                            style={{ width: `${Math.max(source.percentage, 1)}%` }}
                          />
                        </div>
                        <span className="text-foreground font-medium">{source.percentage.toFixed(2)} %</span>
                      </div>
                    </td>
                    <td className={appTableCards.td + " min-w-0 break-words"}><span className="mr-2 text-xs font-medium text-muted-foreground sm:hidden">Page Loads: </span>{source.pageLoads.toLocaleString()}</td>
                    <td className={appTableCards.td + " min-w-0 break-words"}><span className="mr-2 text-xs font-medium text-muted-foreground sm:hidden">Visitors: </span>{source.visitors.toLocaleString()}</td>
                    <td className={appTableCards.td + " min-w-0 break-words"}><span className="mr-2 text-xs font-medium text-muted-foreground sm:hidden">Traffic sources by Domain / Vendor: </span>
                      {source.domain === "NO REFERRER DATA" ? (
                        <span className="text-muted-foreground italic">{source.domain}</span>
                      ) : (
                        <span className="text-muted-foreground font-medium">{source.domain}</span>
                      )}
                    </td>
                  </tr>
                )) : (
                  <tr>
                    <td colSpan={4} className={appTableCards.td + " min-w-0 break-words"}>
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
      </Section>

      <Section flush className="bg-muted border-border" testId="card-traffic-tip">
        <CardContent className="p-5">
          <div className="flex items-start gap-3">
            <Activity className="h-5 w-5 text-muted-foreground flex-shrink-0 mt-0.5" />
            <div>
              <h4 className="text-sm font-semibold text-muted-foreground mb-1">Understanding traffic sources</h4>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Traffic sources show where your website visitors are coming from. "NO REFERRER DATA" means the visitor typed your URL directly or the referrer was stripped. Look for entries like "google.com =&gt; (Campaign: Google AdWords)" to see your paid ad traffic vs organic search traffic.
              </p>
            </div>
          </div>
        </CardContent>
      </Section>
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
      <Section flush className="bg-card border-border">
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-semibold text-foreground" data-testid="text-signals-title">Traffic signals</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="flex items-center gap-1 px-4 pt-2 pb-4 overflow-x-auto">
            {FRAUD_TABS.map(tab => (
              <Button
                key={tab}
                size="sm"
                variant="ghost"
                className={fraudTab === tab ? "text-muted-foreground border-b-2 border-border rounded-none" : "text-muted-foreground rounded-none"}
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
                  <Button variant="outline"
                    size="sm"
                    className="text-red-400 border border-red-500/20"
                    onClick={() => blockIpMutation.mutate(blockIpInput)}
                    disabled={!blockIpInput || blockIpMutation.isPending}
                    data-testid="button-block-ip"
                  >
                    <Ban className="h-3 w-3 mr-1" /> Block
                  </Button>
                </div>
                {blockedIps.length > 0 ? (
                  <div className="overflow-x-auto">
                    <table className={appTable.table} data-testid="table-blocked-ips">
                      <thead className={appTableCards.thead}>
                        <tr className={appTableCards.tr + " border-b border-border"}>
                          <th className="text-left text-muted-foreground font-medium py-2 px-3">IP address</th>
                          <th className="text-left text-muted-foreground font-medium py-2 px-3">Reason</th>
                          <th className="text-left text-muted-foreground font-medium py-2 px-3">Source</th>
                          <th className="text-left text-muted-foreground font-medium py-2 px-3">Blocked at</th>
                          <th className="text-right text-muted-foreground font-medium py-2 px-3">Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {blockedIps.map(ip => (
                          <tr key={ip.id} className={appTableCards.tr + " border-b border-border"} data-testid={`row-blocked-${ip.id}`}>
                            <td className={appTableCards.td + " min-w-0 break-words"}><span className="mr-2 text-xs font-medium text-muted-foreground sm:hidden">IP Address: </span>{ip.ipAddress}</td>
                            <td className={appTableCards.td + " min-w-0 break-words"}><span className="mr-2 text-xs font-medium text-muted-foreground sm:hidden">Reason: </span>{ip.reason}</td>
                            <td className={appTableCards.td + " min-w-0 break-words"}><span className="mr-2 text-xs font-medium text-muted-foreground sm:hidden">Source: </span>
                              <Badge className={ip.source === "auto" ? "bg-muted text-muted-foreground border-border text-[10px]" : "bg-muted text-muted-foreground border-border text-[10px]"}>
                                {ip.source}
                              </Badge>
                            </td>
                            <td className={appTableCards.td + " min-w-0 break-words"}><span className="mr-2 text-xs font-medium text-muted-foreground sm:hidden">Blocked At: </span>{new Date(ip.blockedAt).toLocaleDateString()}</td>
                            <td className={appTableCards.td + " min-w-0 break-words"}><span className="mr-2 text-xs font-medium text-muted-foreground sm:hidden">Action: </span>
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
                          <div className="h-full    rounded-full" style={{ width: `${(cnt / (analytics.totalVisits || 1)) * 100}%` }} />
                        </div>
                        <span className="text-xs text-muted-foreground">{cnt}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-8">
                    <Globe className="h-12 w-12 text-muted-foreground mx-auto mb-2" />
                    <p className="text-muted-foreground text-sm" data-testid="text-countries-empty">Country comes from Cloudflare on new visits; earlier visits show as Unknown.</p>
                  </div>
                )}
              </div>
            )}

            {fraudTab === "Multi-Clicks" && (
              <div>
                {analytics && Object.keys(analytics.multiClickBreakdown).length > 0 ? (
                  <div className="overflow-x-auto">
                    <table className={appTable.table}>
                      <thead className={appTableCards.thead}>
                        <tr className={appTableCards.tr + " border-b border-border"}>
                          <th className="text-left text-muted-foreground font-medium py-2 px-3">Number of clicks</th>
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
                            <tr key={clicks} className={appTableCards.tr + " border-b border-border"}>
                              <td className={appTableCards.td + " min-w-0 break-words"}><span className="mr-2 text-xs font-medium text-muted-foreground sm:hidden">Number of Clicks: </span>{clicks} Click{clicks !== "1" ? "s" : ""}</td>
                              <td className={appTableCards.td + " min-w-0 break-words"}><span className="mr-2 text-xs font-medium text-muted-foreground sm:hidden">Users: </span>{users}</td>
                              <td className={appTableCards.td + " min-w-0 break-words"}><span className="mr-2 text-xs font-medium text-muted-foreground sm:hidden">Percentage: </span>{pct}%</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="text-center py-8">
                    <p className="text-muted-foreground text-sm">No multi-click data yet</p>
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
                            <div className="h-full    rounded-full" style={{ width: `${(cnt / (analytics.totalVisits || 1)) * 100}%` }} />
                          </div>
                          <span className="text-xs text-muted-foreground">{cnt}</span>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="text-center py-8">
                    <p className="text-muted-foreground text-sm">No visits recorded yet.</p>
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
                          <div className="h-full    rounded-full" style={{ width: `${(cnt / (analytics.totalVisits || 1)) * 100}%` }} />
                        </div>
                        <span className="text-xs text-muted-foreground">{cnt}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-8">
                    <p className="text-muted-foreground text-sm">No visits recorded yet.</p>
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
                          <div className="h-full    rounded-full" style={{ width: `${(cnt / (analytics.totalVisits || 1)) * 100}%` }} />
                        </div>
                        <span className="text-xs text-muted-foreground">{cnt}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-8">
                    <p className="text-muted-foreground text-sm">No visits recorded yet.</p>
                  </div>
                )}
              </div>
            )}
          </div>
        </CardContent>
      </Section>

      <Section flush className="bg-card border-border" testId="card-clicks-report">
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-semibold text-foreground flex items-center gap-2">
            Clicks report
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
              className="border-border text-muted-foreground"
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
              <table className={appTable.table} data-testid="table-clicks-report">
                <thead className={appTableCards.thead}>
                  <tr className={appTableCards.tr + " border-b border-border"}>
                    <th className="text-left text-muted-foreground font-medium py-2 px-3">IP address</th>
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
                      <tr key={v.id} className={appTableCards.tr + " border-b border-border"} data-testid={`row-visit-${v.id}`}>
                        <td className={appTableCards.td + " min-w-0 break-words"}><span className="mr-2 text-xs font-medium text-muted-foreground sm:hidden">IP Address: </span>{v.ipAddress}</td>
                        <td className={appTableCards.td + " min-w-0 break-words"}><span className="mr-2 text-xs font-medium text-muted-foreground sm:hidden">Device: </span>{v.deviceType || "-"}</td>
                        <td className={appTableCards.td + " min-w-0 break-words"}><span className="mr-2 text-xs font-medium text-muted-foreground sm:hidden">Browser: </span>{v.browser || "-"}</td>
                        <td className={appTableCards.td + " min-w-0 break-words"}><span className="mr-2 text-xs font-medium text-muted-foreground sm:hidden">OS: </span>{v.os || "-"}</td>
                        <td className={appTableCards.td + " min-w-0 break-words"}><span className="mr-2 text-xs font-medium text-muted-foreground sm:hidden">Page: </span>{pagePath}</td>
                        <td className={appTableCards.td + " min-w-0 break-words"}><span className="mr-2 text-xs font-medium text-muted-foreground sm:hidden">Status: </span>
                          {v.isSuspicious ? (
                            <Badge className="bg-red-500/10 text-red-400 border-red-500/20 text-[10px]">
                              <AlertTriangle className="h-2.5 w-2.5 mr-0.5" /> Flagged
                            </Badge>
                          ) : (
                            <Badge className="bg-emerald-500/10 text-emerald-400 border-emerald-500/20 text-[10px]">
                              <CheckCircle className="h-2.5 w-2.5 mr-0.5" /> Clean
                            </Badge>
                          )}
                        </td>
                        <td className={appTableCards.td + " min-w-0 break-words"}><span className="mr-2 text-xs font-medium text-muted-foreground sm:hidden">Time: </span>{new Date(v.visitedAt).toLocaleString()}</td>
                        <td className={appTableCards.td + " min-w-0 break-words"}><span className="mr-2 text-xs font-medium text-muted-foreground sm:hidden">Action: </span>
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
      </Section>
    </div>
  );
}

function ToolsView({ domain, scriptSnippet, copyScript }: {
  domain: DomainWithStats;
  scriptSnippet: string;
  copyScript: () => void;
}) {
  return (
    <div className="space-y-6">
      <Section flush className="bg-card border-border" testId="card-tracking-script">
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-semibold text-foreground flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-muted-foreground" /> Tracking script
          </CardTitle>
        </CardHeader>
        <CardContent className="p-4 pt-0">
          <p className="text-sm text-muted-foreground mb-3">
            Add this script to the <code className="text-muted-foreground">&lt;head&gt;</code> of every page on <strong className="text-foreground">{domain.domain}</strong> to start tracking visitors and reviewing unusual traffic patterns.
          </p>
          <div className="relative">
            <pre className="bg-muted border border-border rounded-lg p-4 text-xs text-emerald-400 font-mono overflow-x-auto whitespace-pre-wrap break-all">
              {scriptSnippet}
            </pre>
            <Button
              size="sm"
              variant="secondary"
              className="!absolute top-2 right-2"
              onClick={copyScript}
              data-testid="button-copy-main-script"
            >
              <Copy className="h-3 w-3 mr-1" /> Copy
            </Button>
          </div>
          <div className="mt-4 p-3 bg-muted border border-border rounded-lg">
            <p className="text-xs text-muted-foreground">
              <strong>How it works:</strong> The script runs on page load, captures the visitor's device fingerprint, IP (server-side), browser, screen size, and sends it to Click Guard. Repeated visits and matching device signals are flagged. Repeatedly flagged IPs can enter a local exclusion list; applying it in Google Ads requires the separate Ads script.
            </p>
          </div>
        </CardContent>
      </Section>

      {/* Conversion tracking is not built: the tracker records page visits only
          (no conversion value is sent or stored), so no snippet is offered. */}
      <Section flush className="bg-card border-border" testId="card-conversion-tracking">
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-semibold text-foreground flex items-center gap-2">
            <Target className="h-5 w-5 text-muted-foreground" /> Conversion tracking
            <Badge className="bg-card text-muted-foreground border-border text-[10px] ml-1">Not available yet</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-4 pt-0">
          <p className="text-sm text-muted-foreground" data-testid="text-conversion-unavailable">
            Conversion tracking is not available yet. Click Guard records page visits only; it does not record form submissions, calls or conversion values. Use Google Ads conversion tracking to measure leads.
          </p>
        </CardContent>
      </Section>
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
    onError: (e: unknown) => {
      toast({ title: "Failed to update", description: apiErrorMessage(e), variant: "destructive" });
    },
  });

  const [clickThreshold, setClickThreshold] = useState(String(settings.clickThreshold || 1));
  const [blockDays, setBlockDays] = useState(String(settings.blockDays || 90));
  const [exclusionListRate, setExclusionListRate] = useState(String(settings.exclusionListRate || 500));
  // Same whole-number ranges the server enforces; the Update button stays off until the value fits.
  const rangeError = (value: string, label: string, min: number, max: number) => {
    const n = Number(value.trim());
    return /^\d+$/.test(value.trim()) && n >= min && n <= max ? "" : `${label} must be a whole number from ${min} to ${max}.`;
  };
  const thresholdError = rangeError(clickThreshold, "Click threshold", 1, 20);
  const blockDaysError = rangeError(blockDays, "Block duration", 1, 90);
  const exclusionRateError = rangeError(exclusionListRate, "Exclusion list length", 50, 500);
  const [manualExcludeIps, setManualExcludeIps] = useState(settings.manualExcludeIps || "");
  const [whitelistIps, setWhitelistIps] = useState(settings.whitelistIps || "");
  // The server rejects the whole list when any line is not a valid IP/range;
  // keep its reason next to the box (until the text changes), not only in a toast.
  const [ipListErrors, setIpListErrors] = useState<{ manualExcludeIps?: string; whitelistIps?: string }>({});
  const saveIpList = (key: "manualExcludeIps" | "whitelistIps", value: string) => {
    updateSetting.mutate({ [key]: value }, {
      onSuccess: () => setIpListErrors(prev => ({ ...prev, [key]: undefined })),
      onError: (e: unknown) => setIpListErrors(prev => ({ ...prev, [key]: `${apiErrorMessage(e).replace(/\.\s*$/, "")}. Nothing was saved.` })),
    });
  };

  // Save the value the Switch reports. Negating the stored value sent `true`
  // for an unsaved key whose Switch already showed ON (default-on keys), so
  // the first click was a no-op.
  const setSwitch = (key: string) => (checked: boolean) => {
    updateSetting.mutate({ [key]: checked });
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
      <p className="rounded-md border p-4 text-sm text-muted-foreground" data-testid="text-settings-note">Detection preferences below are saved but do not yet change automatic detection. The exclusion list your Google Ads script downloads is built from Manually Exclude IPs and the Blocked IPs tab (Traffic signals), minus Whitelist IPs, up to the Exclusion List Refresh Rate length. The script only adds exclusions in Google Ads; it never removes them. VPN Shield has separate browser controls.</p>
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-foreground flex items-center gap-2">
          <Globe className="h-5 w-5 text-muted-foreground" /> Your domains
        </h2>
        <Button
          size="sm"
          variant="outline"
          onClick={() => setShowAddDomain(true)}
          data-testid="button-add-domain-settings"
        >
          <Plus className="h-4 w-4 mr-1" /> Add domain
        </Button>
      </div>

      <div className="space-y-3">
        {domains.map(d => {
          const isSelected = d.id === (selectedDomainId || domain.id);
          const isDeleting = confirmDeleteId === d.id;

          return (
            <Card
              key={d.id}
              className={`border transition-all cursor-pointer ${isSelected ? "bg-card border-border ring-1 ring-blue-500/20" : "bg-card border-border hover:border-border"}`}
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
                          <Badge className="text-[10px] px-1.5 py-0 bg-muted text-muted-foreground border-border">
                            Selected
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
                      <p className="text-sm font-bold text-muted-foreground" data-testid={`stat-blocked-${d.id}`}>{d.stats.blockedIps.toLocaleString()}</p>
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
                        className="h-8 w-8 p-0 text-muted-foreground hover:text-red-400"
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
                        <Button variant="outline"
                          size="sm"
                          className="h-7 text-xs px-2"
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
                    <p className="text-sm font-bold text-muted-foreground">{d.stats.blockedIps.toLocaleString()}</p>
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
        <Section flush className="bg-card border-border">
          <CardContent className="p-8 text-center">
            <Globe className="h-12 w-12 text-muted-foreground mx-auto mb-3" />
            <p className="text-muted-foreground text-sm">No domains added yet. Add your first domain to start tracking.</p>
          </CardContent>
        </Section>
      )}

      <div className="border-t border-border pt-6 mt-8" />

      <h2 className="text-base font-semibold text-foreground flex items-center gap-2">
        <Settings2 className="h-5 w-5 text-muted-foreground" /> Detection rules
        <span className="text-xs font-normal text-muted-foreground ml-2">for {domain.domain}</span>
      </h2>

      <Section flush className="bg-card border-border" testId="card-click-threshold">
        <CardContent className="p-5">
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <h3 className="text-base font-semibold text-foreground flex items-center gap-2">
                <Crosshair className="h-4 w-4 text-muted-foreground" /> Click fraud threshold
              </h3>
              <p className="text-sm text-muted-foreground mt-1">
                Saved preference only &mdash; automatic flagging currently uses fixed rules: bot-like user agents, more than 5 visits from one IP in an hour or more than 15 in a day, and one device fingerprint seen from different IPs.
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
                  aria-invalid={!!thresholdError}
                  data-testid="input-click-threshold"
                />
                <span className="text-sm text-muted-foreground">ad click within the timeframe</span>
              </div>
              {thresholdError && <p className="mt-2 text-xs text-destructive" data-testid="text-threshold-error">{thresholdError}</p>}
              <div className="mt-3 flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="border-border text-muted-foreground"
                  onClick={() => updateSetting.mutate({ clickThreshold: Number(clickThreshold.trim()) })}
                  disabled={!!thresholdError || updateSetting.isPending}
                  data-testid="button-update-threshold"
                >
                  Update threshold rules
                </Button>
              </div>
            </div>
          </div>
        </CardContent>
      </Section>

      <details className="space-y-4"><summary className="cursor-pointer py-3 text-sm font-medium">Advanced · Detection and exclusions</summary>
      <Section flush className="bg-card border-border" testId="card-detect-device-id">
        <CardContent className="p-5">
          <div className="flex items-center justify-between">
            <div className="flex-1">
              <h3 className="text-base font-semibold text-foreground flex items-center gap-2">
                <Fingerprint className="h-4 w-4 text-muted-foreground" /> Detect IPs based on device IDs
              </h3>
              <p className="text-sm text-muted-foreground mt-1">
                Saved preference only &mdash; Click Guard already flags a device fingerprint seen from different IPs, and this toggle does not turn that off. Requires the tracking code to be installed.
              </p>
            </div>
            <Switch
              checked={settings.detectDeviceId !== false}
              onCheckedChange={setSwitch("detectDeviceId")}
              data-testid="switch-detect-device"
            />
          </div>
        </CardContent>
      </Section>

      <Section flush className="bg-card border-border" testId="card-block-country">
        <CardContent className="p-5">
          <div className="flex items-center justify-between">
            <div className="flex-1">
              <h3 className="text-base font-semibold text-foreground flex items-center gap-2">
                <MapPin className="h-4 w-4 text-muted-foreground" /> Block IPs by country
              </h3>
              <p className="text-sm text-muted-foreground mt-1">
                Saved preference only: country-based enforcement is not implemented in this tracker.
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
                <p className="mt-2 text-xs text-muted-foreground" data-testid="text-country-list-unavailable">
                  No country list: the tracker does not record visitor countries yet, so there is nothing to allow or block.
                </p>
              </div>
            </div>
            <Switch
              checked={settings.blockByCountry !== false}
              onCheckedChange={setSwitch("blockByCountry")}
              data-testid="switch-block-country"
            />
          </div>
        </CardContent>
      </Section>

      <Section flush className="bg-card border-border" testId="card-block-js-disabled">
        <CardContent className="p-5">
          <div className="flex items-center justify-between">
            <div className="flex-1">
              <h3 className="text-base font-semibold text-foreground flex items-center gap-2">
                <Bot className="h-4 w-4 text-muted-foreground" /> Block JavaScript disabled browsers
              </h3>
              <p className="text-sm text-muted-foreground mt-1">
                Not enforced: the tracking script cannot observe browsers that do not execute JavaScript.
              </p>
            </div>
            <Switch
              checked={settings.blockJsDisabled !== false}
              onCheckedChange={setSwitch("blockJsDisabled")}
              data-testid="switch-block-js"
            />
          </div>
        </CardContent>
      </Section>

      <Section flush className="bg-card border-border" testId="card-vpn-blocking">
        <CardContent className="p-5">
          <div className="flex items-center justify-between">
            <div className="flex-1">
              <h3 className="text-base font-semibold text-foreground flex items-center gap-2">
                <ShieldBan className="h-4 w-4 text-muted-foreground" /> VPN blocking
              </h3>
              <p className="text-sm text-muted-foreground mt-1">
                Saved preference only: this toggle does not enforce VPN blocking. VPN Shield offers separate, heuristic browser controls.
              </p>
              <p className="text-xs text-emerald-400/80 mt-1">Recommended: Enabled</p>
            </div>
            <Switch
              checked={settings.vpnBlocking !== false}
              onCheckedChange={setSwitch("vpnBlocking")}
              data-testid="switch-vpn"
            />
          </div>
        </CardContent>
      </Section>

      <Section flush className="bg-card border-border" testId="card-behavior-analysis">
        <CardContent className="p-5">
          <div className="flex items-center justify-between">
            <div className="flex-1">
              <h3 className="text-base font-semibold text-foreground flex items-center gap-2">
                <Activity className="h-4 w-4 text-muted-foreground" /> Behavior analysis
              </h3>
              <p className="text-sm text-muted-foreground mt-1">
                The installed tracking script records page visits and device signals. These cannot reliably distinguish a person from a bot; this saved preference does not change collection.
              </p>
              <p className="text-xs text-emerald-400/80 mt-1">Recommended: Enabled</p>
            </div>
            <Switch
              checked={settings.behaviorAnalysis !== false}
              onCheckedChange={setSwitch("behaviorAnalysis")}
              data-testid="switch-behavior"
            />
          </div>
        </CardContent>
      </Section>

      <h2 className="text-base font-semibold text-foreground flex items-center gap-2 pt-4">
        <ShieldBan className="h-5 w-5 text-muted-foreground" /> Manage auto IP blocking
      </h2>

      <Section flush className="bg-card border-border" testId="card-block-period">
        <CardContent className="p-5">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1">
              <h3 className="text-base font-semibold text-foreground">Block IPs for a certain period</h3>
              <p className="text-sm text-muted-foreground mt-1">
                Saved preference only &mdash; not applied yet. Blocked IPs stay on the list until you remove them.
              </p>
              {blockDaysError && <p className="mt-2 text-xs text-destructive" data-testid="text-block-days-error">{blockDaysError}</p>}
            </div>
            <div className="flex items-center gap-2">
              <Input
                type="number"
                value={blockDays}
                onChange={e => setBlockDays(e.target.value)}
                className="w-20 bg-card border-border text-foreground text-center"
                min={1}
                max={90}
                aria-invalid={!!blockDaysError}
                data-testid="input-block-days"
              />
              <Button
                size="sm"
                variant="outline"
                className="border-border text-muted-foreground"
                onClick={() => updateSetting.mutate({ blockDays: Number(blockDays.trim()) })}
                disabled={!!blockDaysError || updateSetting.isPending}
                data-testid="button-update-block-days"
              >
                Update
              </Button>
            </div>
          </div>
        </CardContent>
      </Section>

      <Section flush className="bg-card border-border" testId="card-exclusion-rate">
        <CardContent className="p-5">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1">
              <h3 className="text-base font-semibold text-foreground">Exclusion list refresh rate</h3>
              <p className="text-sm text-muted-foreground mt-1">
                The exclusion list URL serves at most this many IPs (50&ndash;500). Manually excluded IPs come first, then the newest blocked IPs.
              </p>
              {exclusionRateError && <p className="mt-2 text-xs text-destructive" data-testid="text-exclusion-rate-error">{exclusionRateError}</p>}
            </div>
            <div className="flex items-center gap-2">
              <Input
                type="number"
                value={exclusionListRate}
                onChange={e => setExclusionListRate(e.target.value)}
                className="w-20 bg-card border-border text-foreground text-center"
                min={50}
                max={500}
                aria-invalid={!!exclusionRateError}
                data-testid="input-exclusion-rate"
              />
              <Button
                size="sm"
                variant="outline"
                className="border-border text-muted-foreground"
                onClick={() => updateSetting.mutate({ exclusionListRate: Number(exclusionListRate.trim()) })}
                disabled={!!exclusionRateError || updateSetting.isPending}
                data-testid="button-update-exclusion"
              >
                Update
              </Button>
            </div>
          </div>
        </CardContent>
      </Section>

      <Section flush className="bg-card border-border" testId="card-ip-range">
        <CardContent className="p-5">
          <div className="flex items-center justify-between">
            <div className="flex-1">
              <h3 className="text-base font-semibold text-foreground">IP range exclusion</h3>
              <p className="text-sm text-muted-foreground mt-1">
                Saved preference only &mdash; this switch does not change the exclusion list. Automatic blocking lists single IPs; to exclude a range, add it under Manually Exclude IPs.
              </p>
            </div>
            <Switch
              checked={settings.ipRangeExclusion !== false}
              onCheckedChange={setSwitch("ipRangeExclusion")}
              data-testid="switch-ip-range"
            />
          </div>
        </CardContent>
      </Section>

      <Section flush className="bg-card border-border" testId="card-manual-exclude">
        <CardContent className="p-5">
          <h3 className="text-base font-semibold text-foreground">Manually exclude IPs</h3>
          <p className="text-sm text-muted-foreground mt-1">
            Added first to the exclusion list your Google Ads script downloads. One IP, CIDR range or 1.2.3.* per line. Every line must be valid: if one isn&rsquo;t, nothing is saved and that line is named here.
          </p>
          <Textarea
            value={manualExcludeIps}
            onChange={e => { setManualExcludeIps(e.target.value); setIpListErrors(prev => ({ ...prev, manualExcludeIps: undefined })); }}
            placeholder="72.12.230.50"
            className="mt-3 bg-card border-border text-foreground font-mono text-sm min-h-[100px]"
            aria-invalid={!!ipListErrors.manualExcludeIps}
            aria-describedby={ipListErrors.manualExcludeIps ? "error-manual-exclude" : undefined}
            data-testid="textarea-manual-exclude"
          />
          {ipListErrors.manualExcludeIps && (
            <p id="error-manual-exclude" role="alert" className="mt-2 text-sm text-destructive" data-testid="error-manual-exclude">{ipListErrors.manualExcludeIps}</p>
          )}
          <Button
            size="sm"
            variant="outline"
            className="mt-3 border-border text-muted-foreground"
            onClick={() => saveIpList("manualExcludeIps", manualExcludeIps)}
            disabled={updateSetting.isPending}
            data-testid="button-update-exclude"
          >
            Update
          </Button>
        </CardContent>
      </Section>

      <Section flush className="bg-card border-border" testId="card-whitelist">
        <CardContent className="p-5">
          <h3 className="text-base font-semibold text-foreground">Whitelist IPs</h3>
          <p className="text-sm text-muted-foreground mt-1">
            Removed from the exclusion list your Google Ads script downloads (an IP inside a whitelisted range is removed too; a blocked range is removed only if the same range is whitelisted). Automatic blocking still records these IPs on the Blocked IPs tab. The script only adds exclusions, so an IP it already excluded in Google Ads stays excluded until you remove it there (campaign settings &rarr; IP exclusions). One IP, CIDR range or 1.2.3.* per line; every line must be valid to save.
          </p>
          <Textarea
            value={whitelistIps}
            onChange={e => { setWhitelistIps(e.target.value); setIpListErrors(prev => ({ ...prev, whitelistIps: undefined })); }}
            placeholder="Enter IPs to whitelist..."
            className="mt-3 bg-card border-border text-foreground font-mono text-sm min-h-[100px]"
            aria-invalid={!!ipListErrors.whitelistIps}
            aria-describedby={ipListErrors.whitelistIps ? "error-whitelist" : undefined}
            data-testid="textarea-whitelist"
          />
          {ipListErrors.whitelistIps && (
            <p id="error-whitelist" role="alert" className="mt-2 text-sm text-destructive" data-testid="error-whitelist">{ipListErrors.whitelistIps}</p>
          )}
          <Button
            size="sm"
            variant="outline"
            className="mt-3 border-border text-muted-foreground"
            onClick={() => saveIpList("whitelistIps", whitelistIps)}
            disabled={updateSetting.isPending}
            data-testid="button-update-whitelist"
          >
            Update
          </Button>
        </CardContent>
      </Section>

      <Section flush className="bg-card border-border" testId="card-aggressive">
        <CardContent className="p-5">
          <div className="flex items-center justify-between">
            <div className="flex-1">
              <h3 className="text-base font-semibold text-foreground">Aggressive blocking</h3>
              <p className="text-sm text-muted-foreground mt-1">
                Saved preference only: this mode does not change the current automatic traffic rules.
              </p>
            </div>
            <Switch
              checked={settings.aggressiveBlocking === true}
              onCheckedChange={setSwitch("aggressiveBlocking")}
              data-testid="switch-aggressive"
            />
          </div>
        </CardContent>
      </Section>
      </details>
    </div>
  );
}
