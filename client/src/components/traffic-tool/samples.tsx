/**
 * Sample previews for IP Tracker and VPN Shield (owner 2026-10-15: "add a placeholder that says
 * demo, and once you add real data the demo is replaced … so the clients know what each feature is").
 *
 * Everything here is a static fixture rendered through the pages' own pieces (./ip-views, ./vpn-views) inside
 * <SamplePreview>, which badges it "Sample data" and makes it inert. The rules (CLAUDE.md, never fabricate):
 *   - a page shows a sample ONLY while its real dataset is empty (no site, no visits, no detections) and
 *     swaps to the real thing the moment one record exists — never both, never mixed;
 *   - nothing here is stored, sent or counted; the numbers are made up on purpose and say so;
 *   - every address is a documentation range (203.0.113.0/24, 198.51.100.0/24, 192.0.2.0/24 — reserved,
 *     never routed), every name is "Sample …", every site "sample-roofing.example".
 */
import type { ReactNode } from "react";
import { SamplePreview } from "@/components/sample-preview";
import { GoogleStat, GoogleStatGrid } from "@/components/google";
import { localDayKey, daysAgo } from "./shared";
import { DailyVisitsChart, GeoTable, PagesTable, PlatformBreakdowns, SitePanel, SitesSummaryStrip, SourcesTable, StatTiles, VisitorDetailPanel, VisitorRow, type DomainWithStats, type GeoData, type PageStat, type PlatformData, type TrafficSource, type Visitor, type VisitorDetail } from "./ip-views";
import { DetectionsChart, FlaggedVisitRow, TopLists, VpnSitePanel, VpnSummaryStrip, sparklineDays, type VpnDomain, type VpnVisit } from "./vpn-views";

const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();
const SITE = "sample-roofing.example";

/* ── IP Tracker fixtures ────────────────────────────────────────────────────── */

const DAILY = [12, 18, 9, 24, 31, 27, 15, 22, 36, 29, 41, 33, 57, 42];
const dailySeries = (now = new Date()) => DAILY.map((n, i) => [localDayKey(daysAgo(now, 13 - i)), n] as const);

const SAMPLE_SITES: DomainWithStats[] = [
  { id: -1, userId: 0, domain: SITE, trackingId: "sample", name: "Sample Roofing Co.", isActive: true, createdAt: minutesAgo(60 * 24 * 40), stats: { totalVisits: 4815, uniqueVisitors: 3102, blockedIps: 4, suspiciousVisits: 27, avgVisitsPerUser: 1.6 } },
  { id: -2, userId: 0, domain: "sample-gutters.example", trackingId: "sample", name: "Sample Gutter Pros", isActive: true, createdAt: minutesAgo(60 * 24 * 12), stats: { totalVisits: 612, uniqueVisitors: 488, blockedIps: 0, suspiciousVisits: 3, avgVisitsPerUser: 1.3 } },
];

const SAMPLE_VISITORS: Visitor[] = [
  { ipAddress: "203.0.113.42", fingerprint: "sample-fp-a1b2c3", visits: 3, pageViews: 3, firstVisit: minutesAgo(60 * 50), lastVisit: minutesAgo(4), lastDevice: "mobile", lastBrowser: "Safari", lastOs: "iOS", screenResolution: "390x844", language: "en-US", timezone: "America/New_York", country: "US", city: "Tampa", isSuspicious: false, isOnline: true },
  { ipAddress: "198.51.100.17", fingerprint: "sample-fp-d4e5f6", visits: 1, pageViews: 1, firstVisit: minutesAgo(12), lastVisit: minutesAgo(12), lastDevice: "desktop", lastBrowser: "Chrome", lastOs: "Windows", screenResolution: "1920x1080", language: "en-US", timezone: "America/New_York", country: "US", city: "Orlando", isSuspicious: false, isOnline: true },
  { ipAddress: "192.0.2.88", fingerprint: "sample-fp-778899", visits: 14, pageViews: 14, firstVisit: minutesAgo(60 * 30), lastVisit: minutesAgo(38), lastDevice: "desktop", lastBrowser: "Chrome", lastOs: "Linux", screenResolution: "1366x768", language: "en-US", timezone: "UTC", country: "US", city: "Ashburn", isSuspicious: true, isOnline: false },
  { ipAddress: "203.0.113.7", fingerprint: "sample-fp-0a1b2c", visits: 2, pageViews: 2, firstVisit: minutesAgo(60 * 26), lastVisit: minutesAgo(60 * 3), lastDevice: "mobile", lastBrowser: "Chrome", lastOs: "Android", screenResolution: "412x915", language: "es-US", timezone: "America/New_York", country: "US", city: "Brandon", isSuspicious: false, isOnline: false },
  { ipAddress: "198.51.100.230", fingerprint: null, visits: 1, pageViews: 1, firstVisit: minutesAgo(60 * 9), lastVisit: minutesAgo(60 * 9), lastDevice: "tablet", lastBrowser: "Safari", lastOs: "iPadOS", screenResolution: "820x1180", language: "en-US", timezone: "America/Chicago", country: "US", city: "Clearwater", isSuspicious: false, isOnline: false },
];

const SAMPLE_DETAIL: VisitorDetail = {
  ipAddress: "203.0.113.42", fingerprint: "sample-fp-a1b2c3", totalVisits: 3, firstVisit: minutesAgo(60 * 50), lastVisit: minutesAgo(4), isOnline: true, isSuspicious: false, suspicionReasons: [],
  systemSpecs: { browser: "Safari", os: "iOS", deviceType: "mobile", screenResolution: "390x844", language: "en-US", timezone: "America/New_York", userAgent: "Mozilla/5.0 (iPhone; sample user agent) Safari" },
  geo: { country: "US", city: "Tampa" },
  recentActivity: [
    { id: -1, referrer: "https://www.google.com/", landingPage: `https://${SITE}/roof-repair`, visitedAt: minutesAgo(4), deviceType: "mobile", browser: "Safari", isSuspicious: false },
    { id: -2, referrer: null, landingPage: `https://${SITE}/free-estimate`, visitedAt: minutesAgo(60 * 20), deviceType: "mobile", browser: "Safari", isSuspicious: false },
    { id: -3, referrer: "https://www.facebook.com/", landingPage: `https://${SITE}/`, visitedAt: minutesAgo(60 * 50), deviceType: "mobile", browser: "Safari", isSuspicious: false },
  ],
};

const SAMPLE_SOURCES: TrafficSource[] = [
  { domain: "google.com", pageLoads: 148, visitors: 121, percentage: 46.5 },
  { domain: "NO REFERRER DATA", pageLoads: 97, visitors: 80, percentage: 30.5 },
  { domain: "facebook.com", pageLoads: 38, visitors: 35, percentage: 11.9 },
  { domain: "bing.com", pageLoads: 21, visitors: 19, percentage: 6.6 },
  { domain: "nextdoor.com", pageLoads: 14, visitors: 12, percentage: 4.4 },
];

const SAMPLE_PAGES: PageStat[] = [
  { url: `https://${SITE}/`, hits: 1890, uniqueVisitors: 1402 },
  { url: `https://${SITE}/roof-repair`, hits: 1124, uniqueVisitors: 903 },
  { url: `https://${SITE}/free-estimate`, hits: 866, uniqueVisitors: 751 },
  { url: `https://${SITE}/services/gutters`, hits: 512, uniqueVisitors: 440 },
  { url: `https://${SITE}/contact`, hits: 423, uniqueVisitors: 389 },
];

const SAMPLE_GEO: GeoData = {
  countries: [{ name: "US", count: 4411, visitors: 2880, percentage: "91.6" }, { name: "CA", count: 212, visitors: 140, percentage: "4.4" }, { name: "Unknown", count: 192, visitors: 82, percentage: "4.0" }],
  cities: [
    { name: "Tampa, US", count: 1538, visitors: 1010, country: "US", percentage: "31.9" }, { name: "St. Petersburg, US", count: 702, visitors: 455, country: "US", percentage: "14.6" },
    { name: "Brandon, US", count: 519, visitors: 340, country: "US", percentage: "10.8" }, { name: "Clearwater, US", count: 455, visitors: 300, country: "US", percentage: "9.4" },
    { name: "Orlando, US", count: 380, visitors: 261, country: "US", percentage: "7.9" }, { name: "Unknown, Unknown", count: 192, visitors: 82, country: "Unknown", percentage: "4.0" },
  ],
};

const SAMPLE_PLATFORMS: PlatformData = {
  browsers: { Chrome: 2610, Safari: 1480, Edge: 402, Firefox: 231, Unknown: 92 },
  oses: { iOS: 1690, Android: 1210, Windows: 1180, macOS: 540, Unknown: 195 },
  devices: { mobile: 2940, desktop: 1620, tablet: 255 },
  resolutions: { "390x844": 1120, "1920x1080": 905, "412x915": 760, "1366x768": 430, "1536x864": 310 },
};

const SAMPLE_ONLINE = { [-1]: { count: 3 }, [-2]: { count: 0 } };

/**
 * The IP Tracker sample for one section. `tiles` off when the page already shows its own real (zero) tiles and
 * real site panels — the sample is then only the part that is missing (the chart, the table).
 */
export function IpSample({ tab, cta, tiles = true, what }: { tab: "dashboard" | "visitors" | "traffic" | "pages" | "geo" | "platforms"; cta?: ReactNode; tiles?: boolean; what?: string }) {
  const days = dailySeries();
  const body = tab === "dashboard" ? (
    <div className="space-y-4">
      {tiles && (
        <StatTiles tiles={[
          { label: "Online now", value: "3", hint: "Last 20 minutes", testId: "sample-stat-online-now" }, { label: "Today", value: "42", testId: "sample-stat-today" }, { label: "Yesterday", value: "57", testId: "sample-stat-yesterday" },
          { label: "Last 7 days", value: "318", testId: "sample-stat-last-7-days" }, { label: "This month", value: "1,204", testId: "sample-stat-this-month" }, { label: "Total", value: "4,815", hint: "All time", testId: "sample-stat-total" },
        ]} />
      )}
      <DailyVisitsChart days={days} />
      {tiles && <SitesSummaryStrip domains={SAMPLE_SITES} online={SAMPLE_ONLINE} />}
      {tiles && <div className="space-y-4">{SAMPLE_SITES.map((d) => <SitePanel key={d.id} d={d} online={SAMPLE_ONLINE[d.id as -1 | -2]} selected={d.id === -1} />)}</div>}
    </div>
  ) : tab === "visitors" ? (
    <div className="space-y-2">
      <p className="text-sm tabular-nums text-muted-foreground">5 visitors · 2 online</p>
      {SAMPLE_VISITORS.map((v, i) => <VisitorRow key={v.ipAddress} v={v} expanded={i === 0} onToggle={() => {}}>{i === 0 && <VisitorDetailPanel d={SAMPLE_DETAIL} />}</VisitorRow>)}
    </div>
  ) : tab === "traffic" ? (
    <div className="space-y-4">
      {tiles && <StatTiles tiles={[{ label: "Total sources", value: "5", hint: "Last 30 days", testId: "sample-stat-total-sources" }, { label: "Total page loads", value: "318", hint: "Last 30 days", testId: "sample-stat-total-page-loads" }, { label: "Unique visitors", value: "267", hint: "Last 30 days", testId: "sample-stat-unique-visitors" }]} />}
      <SourcesTable sources={SAMPLE_SOURCES} />
    </div>
  ) : tab === "pages" ? (
    <div className="space-y-4">
      {tiles && <StatTiles cols={2} tiles={[{ label: "Total pages", value: "5", hint: "All time", testId: "sample-stat-total-pages" }, { label: "Total hits", value: "4,815", hint: "All time", testId: "sample-stat-total-hits" }]} />}
      <PagesTable pages={SAMPLE_PAGES} />
    </div>
  ) : tab === "geo" ? (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2"><GeoTable items={SAMPLE_GEO.countries} mode="countries" /><GeoTable items={SAMPLE_GEO.cities} mode="cities" /></div>
  ) : <PlatformBreakdowns platforms={SAMPLE_PLATFORMS} />;
  return <SamplePreview what={what ?? "what you'll see once your site sends its first visit"} cta={cta} testId={`sample-ip-${tab}`}>{body}</SamplePreview>;
}

/* ── VPN Shield fixtures ────────────────────────────────────────────────────── */

const SAMPLE_VPN_SITES: VpnDomain[] = [
  { id: -1, userId: 0, domain: SITE, trackingId: "sample", name: "Sample Roofing Co.", isActive: true, createdAt: minutesAgo(60 * 24 * 40), settings: { vpnBlockMode: "log" }, vpnEffectiveMode: "log", vpnStats: { totalBlocks: 23, uniqueVpnIps: 14 } },
  { id: -2, userId: 0, domain: "sample-gutters.example", trackingId: "sample", name: "Sample Gutter Pros", isActive: true, createdAt: minutesAgo(60 * 24 * 12), settings: { vpnBlockMode: "block" }, vpnEffectiveMode: "block", vpnStats: { totalBlocks: 6, uniqueVpnIps: 5 } },
];

const vpnVisit = (id: number, ip: string, provider: string | null, method: string, action: string, city: string, country: string, minutes: number, browser: string, os: string, device: string): VpnVisit => ({
  id, domainId: -1, ipAddress: ip, userAgent: `Mozilla/5.0 (sample user agent) ${browser}`, fingerprint: `sample-fp-${id.toString(16).padStart(6, "0")}`, browser, os, deviceType: device, country, city,
  referrer: "https://www.google.com/", landingPage: `https://${SITE}/roof-repair`, vpnProvider: provider, detectionMethod: method, action, visitedAt: minutesAgo(minutes),
});
const SAMPLE_VPN_VISITS: VpnVisit[] = [
  vpnVisit(-1, "203.0.113.200", "Sample VPN Co.", "Known VPN provider: Sample VPN Co.", "log", "Tampa", "US", 12, "Chrome", "Windows", "desktop"),
  vpnVisit(-2, "198.51.100.61", null, "Datacenter IP range", "log", "Ashburn", "US", 95, "Chrome", "Linux", "desktop"),
  vpnVisit(-3, "192.0.2.14", "Example Proxy", "Known VPN provider: Example Proxy; WebRTC IP leak detected", "block", "Toronto", "CA", 60 * 7, "Firefox", "macOS", "desktop"),
  vpnVisit(-4, "203.0.113.133", null, "VPN browser extension detected", "log", "Orlando", "US", 60 * 30, "Chrome", "Android", "mobile"),
  ...Array.from({ length: 19 }, (_, i) => vpnVisit(-5 - i, `198.51.100.${100 + i}`, i % 3 ? "Sample VPN Co." : null, i % 3 ? "Known VPN provider: Sample VPN Co." : "Datacenter IP range", "log", ["Tampa", "Brandon", "Clearwater"][i % 3], "US", 60 * 36 + i * 60 * 29, ["Chrome", "Safari", "Edge"][i % 3], ["Windows", "iOS", "Windows"][i % 3], ["desktop", "mobile", "desktop"][i % 3])),
];
const SAMPLE_VPN_STATS = {
  topProviders: [{ name: "Sample VPN Co.", count: 13 }, { name: "Unknown VPN/Proxy", count: 8 }, { name: "Example Proxy", count: 2 }],
  topCountries: [{ name: "US", count: 20 }, { name: "CA", count: 2 }, { name: "Unknown", count: 1 }],
};

export function VpnSample({ tab, cta, tiles = true, what }: { tab: "overview" | "flagged"; cta?: ReactNode; tiles?: boolean; what?: string }) {
  const body = tab === "overview" ? (
    <div className="space-y-4">
      {tiles && (
        <GoogleStatGrid cols={4}>
          <GoogleStat label="Detections" value="23" hint="All time, any action" testId="sample-stat-detections" />
          <GoogleStat label="Detections today" value="2" testId="sample-stat-detections-today" />
          <GoogleStat label="Blocked" value="1" hint="Overlay shown" testId="sample-stat-blocked" />
          <GoogleStat label="Unique VPN IPs" value="14" hint="All time" testId="sample-stat-unique-vpn-ips" />
        </GoogleStatGrid>
      )}
      <DetectionsChart days={sparklineDays(SAMPLE_VPN_VISITS)} />
      <TopLists stats={SAMPLE_VPN_STATS} />
      {tiles && <VpnSummaryStrip domains={SAMPLE_VPN_SITES} />}
      {tiles && <div className="space-y-4">{SAMPLE_VPN_SITES.map((d) => <VpnSitePanel key={d.id} d={d} selected={d.id === -1} />)}</div>}
    </div>
  ) : (
    <div className="space-y-2">
      <p className="text-sm tabular-nums text-muted-foreground">23 flagged visits · 1 blocked</p>
      {SAMPLE_VPN_VISITS.slice(0, 4).map((v, i) => <FlaggedVisitRow key={v.id} v={v} expanded={i === 0} onToggle={() => {}} />)}
    </div>
  );
  return <SamplePreview what={what ?? "what you'll see once the script flags its first visit"} cta={cta} testId={`sample-vpn-${tab}`}>{body}</SamplePreview>;
}
