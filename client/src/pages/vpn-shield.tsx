/**
 * /vpn-shield — possible VPN / proxy visits on the sites tracked here (the one tracked-site list behind Click Guard,
 * IP Tracker and VPN Shield). Sections: Overview · Flagged visits · Install script · Settings, each its own address.
 *
 * Owner's program (2026-10-15): an "i" on every section (the help key per tab, below), a sample preview wherever the
 * real dataset is empty (components/traffic-tool/samples.tsx — never mixed with real rows), the SEO Suite's dashboard
 * look (a summary strip and one panel per site), a "How this works" card over each bare form, and a typed value on
 * every preset filter.
 */
import { useAppOrigin } from "@/lib/app-origin";
import { useRef, useState } from "react";
import { Link, useLocation, useSearch } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useMutation, type UseQueryResult } from "@tanstack/react-query";
import { apiErrorMessage, apiRequest, getQueryFn, queryClient } from "@/lib/queryClient";
import { AppPage, Section, Notice, StatusPill } from "@/components/app-ui";
import { GoogleSectionHeader, GooglePill, GoogleStat, GoogleStatGrid } from "@/components/google";
import { ToolTabs } from "@/components/tool";
import { ToolBarSlot } from "@/components/tool/shell";
import { useInToolShell } from "@/components/tool/in-shell";
import { useToolView } from "@/hooks/use-tool-view";
import { VPN_SHIELD_VIEWS } from "@/components/traffic-tool/nav";
import { countryName } from "@/components/ip-tracker/country-names";
import { ALL_TIME, RangePicker, StepsCard, inRange, rangeBounds, type DateRange } from "@/components/traffic-tool/shared";
import { DetectionsChart, FlaggedVisitRow, TopLists, VpnSitePanel, VpnSummaryStrip, sparklineDays, type VpnDomain, type VpnStats, type VpnVisit } from "@/components/traffic-tool/vpn-views";
import { lazySample } from "@/components/sample-preview";
const VpnSample = lazySample(() => import("@/components/traffic-tool/samples"), "VpnSample");
import { Copy, Clock, Search, Code2 } from "lucide-react";

/** Each section: its label, its line in the full-screen tool, and the help entry its "i" opens (shared/help/registry.ts). */
const tabs = [
  { id: "overview", label: "Overview", helpKey: "vpn-shield", line: "Possible VPN and proxy visits on the chosen site, and how they are handled." },
  { id: "blocked", label: "Flagged visits", helpKey: "vpn-shield.flagged-visits", line: "Each visit flagged as a likely VPN or proxy, newest first." },
  { id: "install", label: "Install script", helpKey: "vpn-shield.install-script", line: "Add the script to your site so VPN Shield can check visitors." },
  { id: "settings", label: "Settings", helpKey: "vpn-shield.settings", line: "Choose what happens to flagged visitors. Browser overlays can be bypassed and may affect legitimate visitors." },
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

// Activity panels re-check on this cadence while the page is open (queries otherwise never refresh on their own),
// so "last detection" and the overview stay current.
const VPN_REFETCH_MS = 15000;

/** What the server's block mode falls back to when a site has no saved choice. */
export const VPN_DEFAULT_MODE = "log";

const Spinner = () => <div className="flex justify-center py-12"><div className="animate-spin h-6 w-6 border-2 border-primary border-t-transparent rounded-full" /></div>;

/** The pill that stands in for real data in a sample: it opens the Install script section. */
const InstallCta = ({ onOpen }: { onOpen: () => void }) => <GooglePill size="sm" variant="solid" icon={Code2} label="Install the script" onClick={onOpen} testId="button-sample-install" />;

function SetupCard({ onCreated }: { onCreated: (id: number) => void }) {
  const { toast } = useToast();
  const [domain, setDomain] = useState("");
  const [name, setName] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const addMutation = useMutation({
    // The one shared tracked-site list behind Click Guard, IP Tracker and VPN Shield.
    mutationFn: async () => (await apiRequest("POST", "/api/click-guard/domains", { domain: domain.trim(), name: name.trim() || undefined })).json(),
    onSuccess: async (created: { id?: number }) => {
      // Log-first: the site this setup adds starts in Log only. This is the explicit setup choice (nobody is blocked
      // until Settings says so) and it preserves any choice saved later. Sites added outside this flow keep theirs.
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
    onError: (err: unknown) => toast({ title: "Could not add site", description: apiErrorMessage(err, "Failed to add site"), variant: "destructive" }),
  });
  return (
    <div className="rounded-xl border bg-card text-card-foreground" data-testid="card-vpn-setup" id="vpn-setup">
      <div className="space-y-3 p-4 sm:p-5">
        <h2 className="g-card__title g-card__title--md">Step 1 — add the site you want to protect</h2>
        <StepsCard testId="steps-vpn-setup" steps={[
          "Type the site's domain and choose Add site. New sites start in Log only: detections are recorded, nobody is blocked.",
          "Install the one script from the Install script section on every page.",
          "Open the site through a VPN once: the detection replaces the sample below within a minute.",
        ]} />
        <p className="sr-only" data-testid="text-vpn-setup-steps">Step 1 of 3 — add the website. New sites start in Log only.</p>
        <div className="flex flex-col gap-3 sm:flex-row">
          <Input ref={input} placeholder="example.com" value={domain} onChange={(e) => setDomain(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && domain.trim()) addMutation.mutate(); }} aria-label="Site domain" data-testid="input-vpn-setup-domain" />
          <Input placeholder="Display name (optional)" value={name} onChange={(e) => setName(e.target.value)} aria-label="Display name" data-testid="input-vpn-setup-name" />
        </div>
        <div className="flex flex-wrap gap-2">
          <GooglePill variant="solid" label={addMutation.isPending ? "Adding…" : "Add site"} onClick={() => addMutation.mutate()} disabled={!domain.trim() || addMutation.isPending} testId="button-vpn-setup-add" />
          <span className="self-center text-xs text-muted-foreground">Sites you add here also appear in <Link href="/ip-tracker" className="text-primary underline underline-offset-2" data-testid="link-vpn-setup-ip-tracker">IP Tracker</Link>.</span>
        </div>
      </div>
    </div>
  );
}

function OverviewTab({ domainId, domains, statsQuery, onPickSite, onInstall }: { domainId: number | null; domains: VpnDomain[]; statsQuery: UseQueryResult<VpnStats, Error>; onPickSite: (id: number) => void; onInstall: () => void }) {
  const stats = statsQuery.data;
  // The stats endpoint counts every detection; split them by the action that was taken.
  const visitsQuery = useQuery<VpnVisit[]>({ queryKey: ["/api/vpn-shield/domains", domainId, "blocked-visits"], enabled: !!domainId, refetchInterval: VPN_REFETCH_MS });
  const visits = visitsQuery.data;
  const blockedCount = visits ? visits.filter((v) => v.action === "block").length : null;
  const days = sparklineDays(visits);
  const recentTotal = days.reduce((s, d) => s + d.count, 0);
  const nothingYet = !!stats && stats.total === 0;
  // "…" only while a figure is still loading; a failed load says so; a site with no detection yet gets the sample.
  const fig = (n: number | undefined) => (stats ? n ?? 0 : statsQuery.isError ? "Unavailable" : "…");

  return (
    <div className="space-y-4 sm:space-y-5">
      <Notice>
        <span data-testid="text-crawler-notice"><span className="font-semibold">Search engine crawlers</span> (Google, Bing, Yahoo) are exempted by user-agent matching, which can be spoofed. VPN detection is heuristic.</span>
      </Notice>

      {statsQuery.isError && !stats && (
        <Notice tone="danger" title="Couldn't load protection statistics" testId="notice-vpn-stats-error" action={<Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => void statsQuery.refetch()} data-testid="button-retry-vpn-stats">Retry</Button>}>
          {apiErrorMessage(statsQuery.error, "The statistics could not be loaded.")} Zeroes below would mean "no data", not "no detections" — the real answer is unavailable.
        </Notice>
      )}
      {visitsQuery.isError && !visits && (
        <Notice tone="danger" title="Couldn't load flagged visits" testId="notice-vpn-visits-error" action={<Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => void visitsQuery.refetch()} data-testid="button-retry-vpn-visits">Retry</Button>}>
          {apiErrorMessage(visitsQuery.error, "The flagged-visit list could not be loaded.")}
        </Notice>
      )}

      <GoogleStatGrid cols={4}>
        <GoogleStat label="Detections" testId="card-stat-detections" value={fig(stats?.total)} hint="All time, any action" />
        <GoogleStat label="Detections today" testId="card-stat-detections-today" value={fig(stats?.today)} />
        <GoogleStat label="Blocked" testId="card-stat-blocked" value={visitsQuery.isError && !visits ? "Unavailable" : blockedCount ?? "…"} hint="Overlay shown" />
        <GoogleStat label="Unique VPN IPs" testId="card-stat-unique-vpn-ips" value={fig(stats?.uniqueIps)} hint="All time" />
      </GoogleStatGrid>

      {visitsQuery.isLoading && <Spinner />}
      {visits && recentTotal > 0 && <DetectionsChart days={days} />}
      {visits && recentTotal === 0 && !nothingYet && (
        <p className="text-sm text-muted-foreground" data-testid="text-vpn-no-recent-detections">
          No detections in the last 30 days. If you installed the script recently, visit your own site through a VPN or proxy to test it — the first detection lands here within a minute.
        </p>
      )}
      {stats && stats.topProviders.length > 0 && <TopLists stats={stats} />}
      {/* No detection yet on this site: the chart and lists as they will look, clearly marked, until the first real one. */}
      {nothingYet && <VpnSample tab="overview" tiles={false} what="the chart and lists you'll see once the script flags its first visit" cta={<InstallCta onOpen={onInstall} />} />}

      {domains.length > 0 && (
        <div className="space-y-4" data-testid="vpn-sites">
          <div className="g-header g-header--flush">
            <h2 className="g-header__title">All sites<span className="g-header__count">{domains.length}</span></h2>
            <p className="g-header__sub">Every site you protect, its detections and the mode in force. Each figure opens its section.</p>
          </div>
          {domains.length > 1 && <VpnSummaryStrip domains={domains} />}
          {domains.map((d) => <VpnSitePanel key={d.id} d={d} selected={d.id === domainId} onPick={() => onPickSite(d.id)} />)}
        </div>
      )}
    </div>
  );
}

function BlockedVisitorsTab({ domainId, onInstall }: { domainId: number | null; onInstall: () => void }) {
  const [search, setSearch] = useState("");
  const [range, setRange] = useState<DateRange>(ALL_TIME);
  const [action, setAction] = useState<"" | "block" | "redirect" | "log">("");
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [page, setPage] = useState(1);
  const perPage = 20;

  const visitsQuery = useQuery<VpnVisit[]>({ queryKey: ["/api/vpn-shield/domains", domainId, "blocked-visits"], enabled: !!domainId, refetchInterval: VPN_REFETCH_MS });
  const visits = visitsQuery.data;
  const visitsError = visitsQuery.isError && !visits;

  // The list comes whole (every detection, newest first); the search, the range and the action narrow it here.
  const q = search.trim().toLowerCase();
  const matches = (v: VpnVisit) => !q || [v.ipAddress, v.vpnProvider, v.detectionMethod, v.city, v.country, countryName(v.country)].some((x) => x?.toLowerCase().includes(q));
  const filtered = (visits || []).filter((v) => matches(v) && (!action || v.action === action) && inRange(range, v.visitedAt));
  const totalPages = Math.ceil(filtered.length / perPage);
  // Results can shrink below the current page: stay on a real one.
  const safePage = Math.min(page, Math.max(totalPages, 1));
  const paginated = filtered.slice((safePage - 1) * perPage, safePage * perPage);
  const narrowed = !!q || !!action || range.preset !== "all";
  const nothingYet = !!visits && visits.length === 0 && !narrowed;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="g-search min-w-0 flex-1 max-w-sm" role="search">
          <Search aria-hidden="true" />
          <input type="search" placeholder="IP, provider, method, city or country…" aria-label="Search flagged visits" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} data-testid="input-vpn-ip-search" />
        </div>
        <span className="text-sm tabular-nums text-muted-foreground" data-testid="badge-vpn-visit-count">
          {filtered.length} flagged visit{filtered.length !== 1 ? "s" : ""}{" · "}{filtered.filter((v) => v.action === "block").length} blocked
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Action taken">
        {([["", "Any action"], ["block", "Blocked"], ["redirect", "Redirected"], ["log", "Logged only"]] as const).map(([a, label]) => (
          <GooglePill key={a} size="sm" label={label} selected={action === a} ariaPressed={action === a} onClick={() => { setAction(a); setPage(1); }} testId={`vpn-action-${a || "any"}`} />
        ))}
      </div>
      <RangePicker value={range} onChange={(r) => { setRange(r); setPage(1); }} testId="vpn-range" />
      {range.preset !== "all" && <p className="text-xs text-muted-foreground" data-testid="text-vpn-flagged-range">Detections from {rangeBounds(range).label.toLowerCase()}.</p>}

      {visitsQuery.isLoading ? <Spinner /> : visitsError ? (
        <Notice tone="danger" title="Couldn't load flagged visits" testId="notice-flagged-error" action={<Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => void visitsQuery.refetch()} data-testid="button-retry-flagged">Retry</Button>}>
          {apiErrorMessage(visitsQuery.error, "The flagged-visit list could not be loaded.")} This is a failed request, not a quiet site.
        </Notice>
      ) : nothingYet ? (
        <VpnSample tab="flagged" cta={<InstallCta onOpen={onInstall} />} />
      ) : paginated.length === 0 ? (
        <div className="g-callout text-center"><p data-testid="text-no-vpn-visits">No flagged visit matches this search, action and range.</p></div>
      ) : (
        <div className="space-y-2">
          {paginated.map((v) => <FlaggedVisitRow key={v.id} v={v} expanded={expandedId === v.id} onToggle={() => setExpandedId(expandedId === v.id ? null : v.id)} />)}
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
          <span className="text-xs text-muted-foreground">Showing {(safePage - 1) * perPage + 1}-{Math.min(safePage * perPage, filtered.length)} of {filtered.length}</span>
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

function InstallScriptTab({ domains, selectedDomainId, setSelectedDomainId, detections, statsError, lastDetection, detectionError }: {
  domains: VpnDomain[]; selectedDomainId: number | null; setSelectedDomainId: (id: number) => void;
  detections: number | undefined; lastDetection: string | null; detectionError: boolean; statsError: boolean;
}) {
  const appOrigin = useAppOrigin();
  const { toast } = useToast();
  const selectedDomain = domains.find((d) => d.id === selectedDomainId);
  const scriptSnippet = selectedDomain ? `<!-- VPN Shield by ConstructHUB -->\n<script src="${appOrigin}/api/vpn-shield/script/${selectedDomain.trackingId}" async></script>` : "";
  const copyScript = async () => {
    try {
      await navigator.clipboard.writeText(scriptSnippet);
      toast({ title: "Copied!", description: "VPN Shield script copied to clipboard." });
    } catch {
      toast({ title: "Couldn't copy the script", description: "Your browser blocked clipboard access — select the script and copy it manually.", variant: "destructive" });
    }
  };

  return (
    <div className="space-y-4 sm:space-y-5" id="vpn-install">
      <StepsCard testId="steps-vpn-install" steps={[
        "Pick the site and copy the script below.",
        <>Paste it into the <code className="rounded bg-muted px-1 py-0.5">&lt;head&gt;</code> (or before <code className="rounded bg-muted px-1 py-0.5">&lt;/body&gt;</code>) of every page.</>,
        "Open the site through a VPN or proxy: the detection appears on the Overview within a minute.",
      ]} />
      {domains.length > 0 && (
        <label className="block max-w-sm space-y-1.5 text-sm">
          <span className="text-muted-foreground">Site</span>
          <select className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={selectedDomainId || ""} onChange={(e) => setSelectedDomainId(Number(e.target.value))} data-testid="select-vpn-domain">
            {domains.map((d) => <option key={d.id} value={d.id}>{d.name || d.domain}</option>)}
          </select>
        </label>
      )}
      {!selectedDomain && <Notice tone="info" testId="notice-vpn-install-no-site">Add a site first — the script is written for one site and carries its own key.</Notice>}
      {selectedDomain && (
        <Section title="Installation code">
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">Add this script tag to the <code className="rounded bg-muted px-1 py-0.5">&lt;head&gt;</code> or before the closing <code className="rounded bg-muted px-1 py-0.5">&lt;/body&gt;</code> tag of your website.</p>
            <div className="relative">
              <pre className="overflow-x-auto rounded-md bg-muted p-4 font-mono text-xs" data-testid="text-vpn-script-code">{scriptSnippet}</pre>
              <Button size="icon" variant="ghost" className="!absolute top-2 right-2" onClick={copyScript} aria-label="Copy VPN Shield script" data-testid="button-copy-vpn-script"><Copy className="h-4 w-4" /></Button>
            </div>
            {/* Installation verification: the stats poll picks up the first detection, so this line flips on its own once the script runs somewhere. */}
            {!statsError && detections === 0 && (
              <p className="flex items-start gap-1.5 text-xs text-muted-foreground" data-testid="text-vpn-awaiting-first-detection">
                <Clock className="h-3 w-3 mt-0.5 shrink-0" />
                Waiting for the first detection. After adding the script, visit your site through a VPN or proxy — the detection appears on the Overview within a minute.
              </p>
            )}
            {!statsError && detections !== undefined && detections > 0 && (
              <p className="text-xs text-emerald-700 dark:text-emerald-400" data-testid="text-vpn-script-active">
                {detections} detection{detections === 1 ? "" : "s"} recorded. Last detection: {lastDetection ? new Date(lastDetection).toLocaleString() : "unavailable"}{detectionError && lastDetection ? " (refresh failed; saved detection)" : ""}. Historical detections do not confirm the script is running now.
              </p>
            )}
          </div>
        </Section>
      )}

      <Section title="How detection works">
        <ul className="space-y-3 text-sm">
          <li><p className="font-medium" data-testid="text-detection-provider">Known VPN provider</p><p className="text-muted-foreground">The visitor's address is matched against a built-in list of VPN and proxy provider ranges. The provider's name is kept on the flagged visit.</p></li>
          <li><p className="font-medium" data-testid="text-detection-webrtc">WebRTC IP leak detection</p><p className="text-muted-foreground">Uses browser-reported WebRTC differences as one possible signal. Network configuration can also cause differences.</p></li>
          <li><p className="font-medium" data-testid="text-detection-timezone">Timezone / geo mismatch</p><p className="text-muted-foreground">Not used as a signal: timezone differences also match ordinary visitors (travel, device settings), so detection deliberately ignores them.</p></li>
          <li><p className="font-medium" data-testid="text-detection-datacenter">Datacenter IP range detection</p><p className="text-muted-foreground">Checks a limited built-in set of IP prefixes. This list may be incomplete or outdated and cannot establish VPN usage.</p></li>
          <li><p className="font-medium" data-testid="text-detection-extensions">VPN extension detection</p><p className="text-muted-foreground">Uses browser-reported extension indicators when available; it cannot reliably identify installed VPN tools.</p></li>
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

/**
 * The warning above Save: "after you save" only while the form is switching to a blocking mode; when that mode is
 * already saved it says blocking is on now.
 */
export function blockingNotice(blockMode: string, savedMode: string | undefined): { headline: string; changing: boolean } | null {
  if (blockMode === "log") return null;
  const changing = blockMode !== (savedMode || VPN_DEFAULT_MODE);
  return { headline: changing ? "Blocking turns ON when you save." : "Blocking is ON.", changing };
}

function SettingsTab({ domainId, domains }: { domainId: number | null; domains: VpnDomain[] }) {
  const { toast } = useToast();
  const domain = domains.find((d) => d.id === domainId);
  const settings = domain?.settings || {};
  const [blockMode, setBlockMode] = useState(settings.vpnBlockMode || VPN_DEFAULT_MODE);
  const [redirectUrl, setRedirectUrl] = useState(settings.vpnRedirectUrl || "");
  const [whitelistedIps, setWhitelistedIps] = useState(settings.vpnWhitelistedIps || "");
  // Same checks the server makes, shown before saving.
  const trimmedRedirect = redirectUrl.trim();
  const redirectError = blockMode === "redirect" && !trimmedRedirect ? "Redirect mode needs a full http:// or https:// link." : trimmedRedirect && !isHttpLink(trimmedRedirect) ? "The redirect link must start with http:// or https://." : "";
  const whitelist = String(whitelistedIps).split(/[\n,]+/).map((v: string) => v.trim()).filter(Boolean);
  const badIp = whitelist.find((ip: string) => !isIpAddress(ip));
  const notice = blockingNotice(blockMode, settings.vpnBlockMode);
  const whitelistError = badIp ? `"${badIp.slice(0, 60)}" is not a valid IP address. Enter one IPv4 or IPv6 address per line (no ranges).` : whitelist.length > 500 ? "Whitelist up to 500 IP addresses." : "";

  const saveMutation = useMutation({
    mutationFn: () => apiRequest("POST", `/api/vpn-shield/domains/${domainId}/settings`, { vpnBlockMode: blockMode, vpnRedirectUrl: redirectUrl, vpnWhitelistedIps: whitelistedIps }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/vpn-shield/domains"] }); toast({ title: "Settings saved", description: "VPN Shield settings have been updated." }); },
    onError: (err: unknown) => toast({ title: "Error", description: apiErrorMessage(err, "Failed to save settings."), variant: "destructive" }),
  });

  return (
    <div className="max-w-2xl space-y-4 sm:space-y-5">
      <StepsCard testId="steps-vpn-settings" steps={[
        "Leave Log only on until you have read a few flagged visits.",
        "Pick Block (an overlay instead of your page) or Redirect (a link of yours) and whitelist your own addresses.",
        "Save: the change applies to the next visit the script checks.",
      ]} />
      <Section title="Block mode" description="Choose how the browser script responds to possible proxy signals after page load. New sites start in Log only — review a sample of detections first, then turn on blocking explicitly.">
        <div className="space-y-2">
          {[{ value: "log", label: "Log only", desc: "Record VPN visits but don't block them" }, { value: "block", label: "Block", desc: "Show an overlay to flagged browsers" }, { value: "redirect", label: "Redirect", desc: "Redirect VPN visitors to a custom URL" }].map((opt) => (
            <label key={opt.value} className={`flex cursor-pointer items-start gap-3 rounded-md border p-3 transition-colors ${blockMode === opt.value ? "border-primary/60 bg-primary/5" : ""}`} data-testid={`option-mode-${opt.value}`}>
              <input type="radio" name="blockMode" value={opt.value} checked={blockMode === opt.value} onChange={() => setBlockMode(opt.value)} className="mt-0.5" />
              <div><span className="text-sm font-medium">{opt.label}</span><p className="text-xs text-muted-foreground">{opt.desc}</p></div>
            </label>
          ))}
        </div>
      </Section>

      {notice && (
        <Notice tone="warning" testId="notice-blocking-active">
          <span data-testid="text-blocking-state">
            <span className="font-semibold">{notice.headline}</span>{" "}
            {blockMode === "block" ? `Flagged visitors ${notice.changing ? "will see" : "see"} an overlay instead of your page. Browser overlays can be bypassed and may affect legitimate visitors.` : `Flagged visitors ${notice.changing ? "will be sent" : "are sent"} to the redirect link instead of your page.`}
          </span>
        </Notice>
      )}

      {blockMode === "redirect" && (
        <Section title="Redirect URL">
          <Input type="url" inputMode="url" placeholder="https://example.com/blocked" value={redirectUrl} onChange={(e) => setRedirectUrl(e.target.value)} aria-invalid={!!redirectError} data-testid="input-redirect-url" />
          {redirectError && <p className="mt-2 text-xs text-destructive" data-testid="text-redirect-url-error">{redirectError}</p>}
        </Section>
      )}

      <Section title="Whitelisted IPs" description="Public IP addresses that should never be blocked, one per line, such as your office's public IP or the address you test from. Your site sees the public address, never a private one like 192.168.x.x.">
        <Textarea placeholder={"203.0.113.10\n2001:db8::10"} value={whitelistedIps} onChange={(e) => setWhitelistedIps(e.target.value)} className="resize-none font-mono text-sm" rows={5} aria-invalid={!!whitelistError} data-testid="textarea-whitelisted-ips" />
        {whitelistError && <p className="mt-2 text-xs text-destructive" data-testid="text-whitelist-error">{whitelistError}</p>}
      </Section>

      <Notice>
        <span data-testid="text-settings-crawler-whitelist"><span className="font-semibold">Crawler whitelist:</span> Googlebot, Bingbot, Yahoo Slurp, DuckDuckBot, Baiduspider, and other crawler user-agent strings are exempted. User-agent strings can be spoofed.</span>
      </Notice>

      <div className="flex flex-wrap items-center gap-3">
        <GooglePill variant="solid" label={saveMutation.isPending ? "Saving…" : "Save settings"} onClick={() => saveMutation.mutate()} disabled={!domainId || saveMutation.isPending || !!redirectError || !!whitelistError} testId="button-save-vpn-settings" />
        {redirectError && blockMode !== "redirect" && <span className="text-xs text-destructive" data-testid="text-redirect-url-error-hidden">{redirectError} Switch to Redirect to fix or clear it.</span>}
        {domain ? <span className="text-xs text-muted-foreground" data-testid="text-settings-site">Applies to {domain.name || domain.domain}</span> : <span className="text-xs text-muted-foreground" data-testid="text-settings-no-site">Add a site to save settings.</span>}
      </div>
    </div>
  );
}

export default function VpnShieldPage() {
  const { toast } = useToast();
  const { params, set: setUrlParam } = useUrlState();
  // Each section is its own address (/vpn-shield/flagged; components/traffic-tool/nav.ts); old ?tab= links land there.
  const [activeTab, setActiveTab] = useToolView<TabId>("/vpn-shield", VPN_SHIELD_VIEWS, "overview");
  const inShell = useInToolShell();
  const selectedDomainId = Number(params.get("site")) || null;
  const setSelectedDomainId = (id: number | null) => setUrlParam("site", id ? String(id) : null);
  const tab = tabs.find((t) => t.id === activeTab)!;
  const helpKey = tab.helpKey;

  // Signed out (the public preview of this page): the site list answers 401 — a sign-in prompt, not a failure.
  const domainsQuery = useQuery<VpnDomain[] | null>({
    queryKey: ["/api/vpn-shield/domains"],
    queryFn: getQueryFn({ on401: "returnNull" }),
    refetchInterval: (q) => (q.state.data === null ? false : VPN_REFETCH_MS),
  });
  const signedOut = domainsQuery.data === null;
  const domains = domainsQuery.data ?? undefined;
  const domainsLoading = domainsQuery.isLoading;
  const domainsError = domainsQuery.isError && !domains;
  const noSites = !!domains && domains.length === 0;

  const selectedDomain = (domains ?? []).find((d) => d.id === selectedDomainId) || domains?.[0];
  const domainId = selectedDomain?.id ?? null;

  const statsQuery = useQuery<VpnStats>({ queryKey: ["/api/vpn-shield/domains", domainId, "stats"], enabled: !!domainId, refetchInterval: VPN_REFETCH_MS });
  const lastDetectionQuery = useQuery<VpnVisit[]>({ queryKey: ["/api/vpn-shield/domains", domainId, "blocked-visits"], enabled: !!domainId, refetchInterval: VPN_REFETCH_MS });
  const lastDetection = lastDetectionQuery.data?.[0]?.visitedAt ?? null;
  const savedMode = selectedDomain?.settings?.vpnBlockMode;
  const goInstall = () => setActiveTab("install");
  const addSiteCta = <GooglePill size="sm" variant="solid" label="Add your first site" onClick={() => document.getElementById("vpn-setup")?.querySelector<HTMLInputElement>("input")?.focus()} testId="button-vpn-add-first-site" />;

  // In the full-screen tool the site picker sits in the tool bar, beside the menu.
  const siteControls = (domains?.length ?? 0) > 0 ? (
    <label className="block min-w-0 flex-1 space-y-1.5 text-sm sm:w-56 sm:flex-none">
      <span className="text-muted-foreground sm:hidden">Site</span>
      <select className="h-10 w-full rounded-full border bg-background px-4 text-sm" value={domainId || ""} onChange={(e) => setSelectedDomainId(Number(e.target.value))} aria-label="Site" data-testid="select-vpn-shield-domain">
        {(domains ?? []).map((d) => <option key={d.id} value={d.id}>{d.name || d.domain}</option>)}
      </select>
    </label>
  ) : undefined;

  return (
    <AppPage testId="page-vpn-shield">
      {/* Google's page format (owner, 2026-10-07): a quiet header, hairline cards, pill actions, stat tiles. */}
      <GoogleSectionHeader
        as="h1"
        titleTestId="text-vpn-page-title"
        title={inShell ? tab.label : "VPN Shield"}
        helpKey={helpKey}
        description={<>
          <span data-testid="text-vpn-subtitle">{inShell ? tab.line : "Spot visitors who arrive through a VPN or proxy and choose whether to log, block or redirect them."}</span>
          {selectedDomain && <>{" "}<StatusPill tone="neutral" data-testid="badge-vpn-shield">{selectedDomain.name || selectedDomain.domain}</StatusPill></>}
        </>}
        flush
        actions={inShell ? undefined : siteControls}
      />

      {domainId && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border bg-card px-4 py-3" data-testid="strip-vpn-status">
          <span className="inline-flex items-center gap-1.5 text-sm">
            <span className={`h-2 w-2 rounded-full ${savedMode && savedMode !== "log" ? "bg-amber-500" : "bg-emerald-500"}`} />
            <span data-testid="text-vpn-mode" className="font-medium">
              {savedMode === "block" ? "Blocking: flagged visitors see an overlay" : savedMode === "redirect" ? "Blocking: flagged visitors are redirected" : savedMode === "log" ? "Log only: nothing is blocked" : "No mode saved yet"}
            </span>
          </span>
          <span className="text-xs text-muted-foreground" data-testid="text-vpn-last-detection">
            Last detection: {lastDetection ? new Date(lastDetection).toLocaleString() : lastDetectionQuery.isError ? "unavailable" : lastDetectionQuery.isPending ? "loading…" : "none yet"}
            {lastDetectionQuery.isError && lastDetection && " (refresh failed; saved detection)"}
          </span>
          <span className="text-xs text-muted-foreground" data-testid="text-vpn-updated">
            {statsQuery.dataUpdatedAt ? `${statsQuery.isError ? "Refresh failed — saved" : "Updated"} ${new Date(statsQuery.dataUpdatedAt).toLocaleString()}` : statsQuery.isError ? "Unavailable" : "Loading…"}
          </span>
          <span className="ml-auto flex items-center gap-2">
            {!savedMode && (
              <GooglePill size="sm" variant="solid" label="Start in Log only" testId="button-vpn-start-log-only"
                onClick={() => apiRequest("POST", `/api/vpn-shield/domains/${domainId}/settings`, { vpnBlockMode: "log", vpnRedirectUrl: selectedDomain?.settings?.vpnRedirectUrl || "", vpnWhitelistedIps: selectedDomain?.settings?.vpnWhitelistedIps || "" })
                  .then(() => { queryClient.invalidateQueries({ queryKey: ["/api/vpn-shield/domains"] }); toast({ title: "Log only enabled", description: "Detections are recorded without blocking. Change the mode any time in Settings." }); })
                  .catch((err: unknown) => toast({ title: "Could not save settings", description: apiErrorMessage(err, "Failed to save settings."), variant: "destructive" }))} />
            )}
            <Button size="sm" variant="outline" className="h-7 text-xs" disabled={statsQuery.isFetching || lastDetectionQuery.isFetching} onClick={() => { void statsQuery.refetch(); void lastDetectionQuery.refetch(); }} data-testid="button-refresh-vpn">Refresh</Button>
          </span>
        </div>
      )}

      {inShell && (domains?.length ?? 0) > 0 && <ToolBarSlot><div className="flex min-w-0 flex-1 flex-wrap items-center gap-2 text-sm" data-testid="toolbar-vpn-site"><span className="hidden g-text-2 sm:inline">Site</span>{siteControls}</div></ToolBarSlot>}
      {!inShell && <ToolTabs as="tablist" label="VPN Shield sections">
        {tabs.map((t) => <button key={t.id} type="button" onClick={() => setActiveTab(t.id)} role="tab" aria-selected={activeTab === t.id} data-testid={`tab-vpn-${t.id}`}>{t.label}</button>)}
      </ToolTabs>}

      {domainsLoading ? <Spinner /> : signedOut ? (
        <Notice tone="info" title="Sign in to see your sites" testId="notice-vpn-domains-signed-out" action={<Button asChild size="sm" variant="outline" className="h-7 text-xs"><a href={`/auth?next=${encodeURIComponent("/vpn-shield")}`} data-testid="link-vpn-shield-sign-in">Sign in</a></Button>}>
          This tool watches the websites you add to your ConstructHUB account.
        </Notice>
      ) : domainsError ? (
        <Notice tone="danger" title="Couldn't load your sites" testId="notice-vpn-domains-error" action={<Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => void domainsQuery.refetch()} data-testid="button-retry-vpn-domains">Retry</Button>}>
          {apiErrorMessage(domainsQuery.error, "The site list could not be loaded.")} This is a failed request, not an empty account.
        </Notice>
      ) : noSites ? (
        <>
          {/* No site yet: the setup form is step 1, and the section shows what it will look like until the first real detection. */}
          <SetupCard onCreated={(id) => { setSelectedDomainId(id); setActiveTab("install"); }} />
          {(activeTab === "overview" || activeTab === "blocked") && <VpnSample tab={activeTab === "overview" ? "overview" : "flagged"} cta={addSiteCta} what={`what ${tab.label} shows once your first site's script flags a visit`} />}
          {activeTab === "install" && <InstallScriptTab domains={[]} selectedDomainId={null} setSelectedDomainId={setSelectedDomainId} detections={undefined} lastDetection={null} detectionError={false} statsError={false} />}
          {activeTab === "settings" && <SettingsTab key="none" domainId={null} domains={[]} />}
        </>
      ) : (
        <>
          {activeTab === "overview" && <OverviewTab domainId={domainId} domains={domains ?? []} statsQuery={statsQuery} onPickSite={setSelectedDomainId} onInstall={goInstall} />}
          {activeTab === "blocked" && <BlockedVisitorsTab key={domainId ?? "none"} domainId={domainId} onInstall={goInstall} />}
          {activeTab === "install" && (
            <InstallScriptTab domains={domains ?? []} selectedDomainId={domainId} setSelectedDomainId={setSelectedDomainId} detections={statsQuery.data?.total} lastDetection={lastDetection} detectionError={lastDetectionQuery.isError} statsError={statsQuery.isError && !statsQuery.data} />
          )}
          {/* Keyed by site: the form seeds its state once, so each site needs a fresh form. */}
          {activeTab === "settings" && <SettingsTab key={domainId ?? "none"} domainId={domainId} domains={domains ?? []} />}
        </>
      )}
    </AppPage>
  );
}
