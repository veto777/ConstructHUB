/**
 * IP Tracker's presentational pieces (pages/ip-tracker.tsx owns the data): the stat tiles, the daily chart,
 * a visitor row with its detail panel, the sources / pages / geo tables, the platform breakdowns, and the
 * per-site panel of the dashboard in the SEO Suite's tool language (components/tool). The sample previews
 * (./samples.tsx) render these same pieces from fixtures, so a sample looks exactly like the real thing.
 */
import type { ReactNode } from "react";
import { Link } from "wouter";
import { AlertTriangle, ChevronRight, ExternalLink, Eye, FileText, MapPin, Monitor } from "lucide-react";
import { GoogleStat, GoogleStatGrid } from "@/components/google";
import { MetricStrip, StatCell } from "@/components/tool";
import { Section, StatusPill } from "@/components/app-ui";
import { countryName, geoLabel } from "@/components/ip-tracker/country-names";
import { BreakdownList, DeviceIcon, PercentBar, TD, TH, TR, browserIcon, deviceIcon, formatDate, formatTimeAgo, osIcon, shortDay } from "./shared";

/* ── Shapes the API answers with ────────────────────────────────────────────── */

export type DomainWithStats = {
  id: number; userId: number; domain: string; trackingId: string; name: string | null; isActive: boolean; createdAt: string;
  stats: { totalVisits: number; uniqueVisitors: number; blockedIps: number; suspiciousVisits: number; avgVisitsPerUser: number };
};
export type Visitor = {
  ipAddress: string; fingerprint: string | null; visits: number; pageViews: number; firstVisit: string; lastVisit: string;
  lastDevice: string | null; lastBrowser: string | null; lastOs: string | null; screenResolution: string | null; language: string | null;
  timezone: string | null; country: string | null; city: string | null; isSuspicious: boolean; isOnline: boolean;
};
export type VisitorDetail = {
  ipAddress: string; fingerprint: string | null; totalVisits: number; firstVisit: string; lastVisit: string; isOnline: boolean; isSuspicious: boolean;
  suspicionReasons: string[];
  systemSpecs: { browser: string | null; os: string | null; deviceType: string | null; screenResolution: string | null; language: string | null; timezone: string | null; userAgent: string | null };
  geo: { country: string | null; city: string | null };
  recentActivity: { id: number; referrer: string | null; landingPage: string | null; visitedAt: string; deviceType: string | null; browser: string | null; isSuspicious: boolean }[];
};
export type TrafficSource = { domain: string; pageLoads: number; visitors: number; percentage: number };
export type Analytics = {
  totalVisits: number; uniqueVisitors: number; blockedIps: number; suspiciousVisits: number; avgVisitsPerUser: number; threatLevel: string; threatPercent: number;
  deviceBreakdown: Record<string, number>; countryBreakdown: Record<string, number>; browserBreakdown: Record<string, number>; osBreakdown: Record<string, number>;
  hourlyVisits: Record<string, number>; dailyVisits: Record<string, number>; multiClickBreakdown: Record<string, number>; trafficSources: TrafficSource[];
};
export type PageStat = { url: string; hits: number; uniqueVisitors: number };
export type GeoRow = { name: string; count: number; visitors: number; country?: string; percentage: string };
export type GeoData = { countries: GeoRow[]; cities: GeoRow[] };
export type PlatformData = { browsers: Record<string, number>; oses: Record<string, number>; devices: Record<string, number>; resolutions: Record<string, number> };

// The visit endpoints load at most this many visits, newest first (storage.getClickVisits), so the all-time total
// and a busy site's date range stop at it. A count at the cap is a lower bound, shown with "+", never as exact.
export const VISIT_ROW_CAP = 1000;
export const countLabel = (n: number, partial: boolean) => (partial ? `${n.toLocaleString()}+` : n.toLocaleString());

/** Where a site's sections live (the chosen site rides along as ?site=). */
const ipHref = (view: "" | "visitors" | "traffic" | "pages" | "geo" | "platforms", siteId: number) => `/ip-tracker${view ? `/${view}` : ""}?site=${siteId}`;

/* ── Stat tiles ─────────────────────────────────────────────────────────────── */

export type Tile = { label: string; value: ReactNode; hint?: ReactNode; testId: string };
export function StatTiles({ tiles, cols = 3 }: { tiles: Tile[]; cols?: 2 | 3 | 4 }) {
  return <GoogleStatGrid cols={cols}>{tiles.map((t) => <GoogleStat key={t.testId} label={t.label} value={t.value} hint={t.hint} testId={t.testId} />)}</GoogleStatGrid>;
}

/* ── Daily visits chart (14 days) ───────────────────────────────────────────── */

export function DailyVisitsChart({ days, oldestLoaded, title = "Daily visits" }: { days: readonly (readonly [string, number])[]; oldestLoaded?: string; title?: string }) {
  const maxDaily = Math.max(...days.map(([, v]) => v), 1);
  return (
    <Section title={title}>
      {/* The column each bar hangs from needs its own height: a percentage height inside a content-sized column
          collapses to the bar's minimum, drawing every bar the same. h-full + an absolute bar keeps the percentage
          meaningful. The dashed line is the top of the scale, labelled with the busiest day's count; each day shows
          its value on hover or keyboard focus. */}
      <div className="flex items-center gap-2 text-[10px] text-muted-foreground" data-testid="text-daily-max">
        <span className="tabular-nums">{maxDaily.toLocaleString()} visit{maxDaily === 1 ? "" : "s"}</span>
        <span className="flex-1 border-t border-dashed" aria-hidden="true" />
      </div>
      <div className="flex items-stretch gap-1 h-32" role="list" aria-label="Visits per day, last 14 days">
        {days.map(([date, count], i) => {
          const notLoaded = !!oldestLoaded && date < oldestLoaded;
          const value = notLoaded ? "not loaded" : date === oldestLoaded ? `at least ${count.toLocaleString()} visits` : `${count.toLocaleString()} visit${count === 1 ? "" : "s"}`;
          const label = `${shortDay(date)}: ${value}`;
          const align = i < 2 ? "left-0" : i > days.length - 3 ? "right-0" : "left-1/2 -translate-x-1/2";
          return (
            <div key={date} className="group flex-1 flex h-full flex-col items-center gap-1" role="listitem">
              <div className="relative w-full flex-1 rounded-t outline-none focus-visible:ring-2 focus-visible:ring-ring" tabIndex={0} aria-label={label} data-testid={`bar-${date}`}>
                <div className={`absolute bottom-0 left-0 right-0 rounded-t transition-colors ${notLoaded ? "bg-muted" : "bg-primary/80 group-hover:bg-primary group-focus-within:bg-primary"}`} style={{ height: `${(count / maxDaily) * 100}%` }} />
                <span className={`pointer-events-none absolute bottom-full z-10 mb-1 whitespace-nowrap rounded bg-foreground px-1.5 py-0.5 text-[10px] font-medium text-background opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 ${align}`} aria-hidden="true" data-testid={`tip-${date}`}>{label}</span>
              </div>
              <span className="text-[8px] text-muted-foreground truncate w-full text-center" aria-hidden="true">{Number(date.slice(8, 10))}</span>
            </div>
          );
        })}
      </div>
    </Section>
  );
}

/* ── Visitor row + detail ───────────────────────────────────────────────────── */

export function VisitorRow({ v, expanded, onToggle, children }: { v: Visitor; expanded: boolean; onToggle: () => void; children?: ReactNode }) {
  return (
    <div className={`rounded-xl border bg-card transition-all ${expanded ? "ring-1 ring-primary/30" : ""}`} data-testid={`card-visitor-${v.ipAddress}`}>
      <button type="button" className="w-full cursor-pointer p-4 text-left hover:bg-muted/30 transition-colors" onClick={onToggle} aria-expanded={expanded} aria-controls={`visitor-detail-${v.ipAddress}`} data-testid={`button-expand-visitor-${v.ipAddress}`}>
        <div className="flex items-center gap-3">
          <div className={`h-2.5 w-2.5 rounded-full shrink-0 ${v.isOnline ? "bg-primary animate-pulse" : "bg-muted-foreground/30"}`} />
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-sm font-medium break-all" data-testid={`text-ip-${v.ipAddress}`}>{v.ipAddress}</span>
                {v.isSuspicious && <StatusPill tone="danger" dot={false} className="gap-0.5 px-2 text-[10px]"><AlertTriangle className="h-2.5 w-2.5" /> Suspicious</StatusPill>}
                {v.isOnline && <StatusPill tone="success" dot={false} className="px-2 text-[10px]">Online</StatusPill>}
              </div>
              <div className="mt-0.5 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                <span className="flex items-center gap-1"><Eye className="h-3 w-3" /> {v.visits} visit{v.visits !== 1 ? "s" : ""}</span>
                <span className="flex items-center gap-1"><FileText className="h-3 w-3" /> {v.pageViews} page{v.pageViews !== 1 ? "s" : ""}</span>
                {(v.city || v.country) && <span className="flex items-center gap-1"><MapPin className="h-3 w-3" /> {[v.city, countryName(v.country)].filter(Boolean).join(", ")}</span>}
              </div>
            </div>
          </div>
          <div className="hidden sm:flex items-center gap-3 text-xs text-muted-foreground shrink-0">
            <span className="flex items-center gap-1.5"><DeviceIcon type={v.lastDevice} /><span>{v.lastBrowser || "Unknown"}</span></span>
            <span>{formatTimeAgo(v.lastVisit)}</span>
          </div>
          <ChevronRight className={`h-4 w-4 text-muted-foreground shrink-0 transition-transform ${expanded ? "rotate-90" : ""}`} />
        </div>
      </button>
      {expanded && <div className="border-t bg-muted/20 p-4" id={`visitor-detail-${v.ipAddress}`}>{children}</div>}
    </div>
  );
}

const Row = ({ k, v, mono }: { k: string; v: ReactNode; mono?: boolean }) => <div className="flex justify-between gap-4"><span className="text-muted-foreground">{k}</span><span className={mono ? "max-w-[200px] truncate font-mono text-xs" : "font-medium"}>{v}</span></div>;

export function VisitorDetailPanel({ d }: { d: VisitorDetail }) {
  return (
    <div className="space-y-4">
      {d.isSuspicious && (
        <div className="rounded-lg border border-red-500/25 bg-red-500/5 p-3" data-testid={`suspicion-reasons-${d.ipAddress}`}>
          <h4 className="flex items-center gap-1.5 text-xs font-semibold text-red-700 dark:text-red-400"><AlertTriangle className="h-3.5 w-3.5" /> Why Click Guard flagged this visitor</h4>
          {d.suspicionReasons.length > 0
            ? <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">{d.suspicionReasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>
            : <p className="mt-2 text-sm text-muted-foreground">Click Guard recorded no reason for this flag.</p>}
        </div>
      )}
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <div>
          <h4 className="mb-3 text-xs font-semibold text-muted-foreground">System specs</h4>
          <div className="space-y-2 text-sm">
            <Row k="Browser" v={d.systemSpecs.browser || "Unknown"} /><Row k="OS" v={d.systemSpecs.os || "Unknown"} /><Row k="Device" v={d.systemSpecs.deviceType || "Unknown"} />
            <Row k="Resolution" v={d.systemSpecs.screenResolution || "Unknown"} /><Row k="Language" v={d.systemSpecs.language || "Unknown"} /><Row k="Timezone" v={d.systemSpecs.timezone || "Unknown"} />
          </div>
          <h4 className="mb-3 mt-6 text-xs font-semibold text-muted-foreground">Identity</h4>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between gap-4"><span className="text-muted-foreground">IP address</span><span className="font-mono font-medium">{d.ipAddress}</span></div>
            <Row k="Computer ID" v={d.fingerprint || "N/A"} mono />
            <div className="flex justify-between gap-4"><span className="text-muted-foreground">First visit</span><span>{formatDate(d.firstVisit)}</span></div>
            <div className="flex justify-between gap-4"><span className="text-muted-foreground">Last visit</span><span>{formatDate(d.lastVisit)}</span></div>
            <div className="flex justify-between gap-4"><span className="text-muted-foreground">Total visits</span><span className="font-semibold">{d.totalVisits}</span></div>
          </div>
          {d.geo.country && (
            <>
              <h4 className="mb-3 mt-6 text-xs font-semibold text-muted-foreground">Geolocation</h4>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between gap-4"><span className="text-muted-foreground">City</span><span>{d.geo.city || "Unknown"}</span></div>
                <div className="flex justify-between gap-4"><span className="text-muted-foreground">Country</span><span>{countryName(d.geo.country) || "Unknown"}</span></div>
              </div>
            </>
          )}
        </div>
        <div>
          <h4 className="mb-3 text-xs font-semibold text-muted-foreground">Recent activity</h4>
          <div className="max-h-64 space-y-2 overflow-y-auto">
            {d.recentActivity.map((a) => (
              <div key={a.id} className="rounded-lg border bg-card p-3 text-xs" data-testid={`activity-${a.id}`}>
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-muted-foreground">{formatDate(a.visitedAt)}</span>
                  {a.isSuspicious && <StatusPill tone="danger" dot={false} className="px-1.5 py-0 text-[9px]">Suspicious</StatusPill>}
                </div>
                <div className="text-muted-foreground"><span className="font-medium">From:</span> {a.referrer || "NO REFERRER DATA"}</div>
                <div className="mt-0.5 text-muted-foreground"><span className="font-medium">Landed:</span> <span className="break-all text-primary">{a.landingPage || "Unknown"}</span></div>
              </div>
            ))}
            {d.recentActivity.length === 0 && <p className="text-sm text-muted-foreground">No activity recorded</p>}
          </div>
          {d.systemSpecs.userAgent && (
            <>
              <h4 className="mb-2 mt-6 text-xs font-semibold text-muted-foreground">User agent</h4>
              <p className="rounded bg-muted p-2 font-mono text-[11px] text-muted-foreground break-all">{d.systemSpecs.userAgent}</p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── Tables ─────────────────────────────────────────────────────────────────── */

export function SourcesTable({ sources, emptyText = "No traffic source data available" }: { sources: TrafficSource[]; emptyText?: string }) {
  return (
    <Section flush title="Traffic sources by domain">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/50"><tr className="hidden sm:table-row"><th className={`${TH} text-left`}>Source</th><th className={`${TH} text-right`}>Page loads</th><th className={`${TH} text-right`}>Visitors</th><th className={`${TH} text-left w-48`}>Share</th></tr></thead>
          <tbody>
            {sources.length === 0 ? <tr><td colSpan={4} className="p-6 text-center text-muted-foreground">{emptyText}</td></tr> : sources.map((s, i) => (
              <tr key={i} className={TR} data-testid={`row-source-${i}`}>
                <td className={TD}><span className={`break-all ${s.domain === "NO REFERRER DATA" ? "italic text-muted-foreground" : "font-medium"}`}>{s.domain}</span><span className="sm:hidden text-xs text-muted-foreground"> · {s.percentage.toFixed(1)}%</span></td>
                <td className={`${TD} sm:text-right sm:tabular-nums`}><span className="sm:hidden text-muted-foreground">Page loads: </span>{s.pageLoads.toLocaleString()}</td>
                <td className={`${TD} sm:text-right sm:tabular-nums`}><span className="sm:hidden text-muted-foreground">Visitors: </span>{s.visitors.toLocaleString()}</td>
                <td className={`${TD} sm:w-48`}><div className="flex items-center gap-2"><span className="w-14 shrink-0 whitespace-nowrap text-xs tabular-nums text-muted-foreground">{s.percentage.toFixed(1)}%</span><PercentBar value={s.percentage} /></div></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

export function PagesTable({ pages, loading, emptyText = "No page data available" }: { pages: PageStat[] | undefined; loading?: boolean; emptyText?: string }) {
  const totalHits = (pages ?? []).reduce((s, x) => s + x.hits, 0);
  return (
    <Section flush title="Pages">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/50"><tr className="hidden sm:table-row"><th className={`${TH} text-left`}>Page URL</th><th className={`${TH} text-right`}>Hits</th><th className={`${TH} text-right`}>Unique visitors</th><th className={`${TH} text-left w-32`}>Share</th></tr></thead>
          <tbody>
            {loading ? <tr><td colSpan={4} className="p-6 text-center"><div className="animate-spin h-5 w-5 border-2 border-primary border-t-transparent rounded-full mx-auto" /></td></tr>
              : !pages ? null : pages.length === 0 ? <tr><td colSpan={4} className="p-6 text-center text-muted-foreground">{emptyText}</td></tr>
              : pages.map((p, i) => (
                <tr key={i} className={TR} data-testid={`row-page-${i}`}>
                  <td className={`${TD} sm:max-w-xs`}><span className="break-all text-xs text-primary">{p.url}</span></td>
                  <td className={`${TD} sm:text-right sm:tabular-nums sm:font-medium`}><span className="sm:hidden text-muted-foreground">Hits: </span>{p.hits.toLocaleString()}</td>
                  <td className={`${TD} sm:text-right sm:tabular-nums`}><span className="sm:hidden text-muted-foreground">Unique: </span>{p.uniqueVisitors.toLocaleString()}</td>
                  <td className={`${TD} sm:w-32`}><PercentBar value={totalHits ? (p.hits / totalHits) * 100 : 0} /></td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

export function GeoTable({ items, mode, loading, emptyText = "No geographic data available" }: { items: GeoRow[] | undefined; mode: "countries" | "cities"; loading?: boolean; emptyText?: string }) {
  return (
    <Section flush title={mode === "countries" ? "Countries" : "Cities"}>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/50"><tr className="hidden sm:table-row"><th className={`${TH} text-left`}>Location</th><th className={`${TH} text-right`}>Visits</th><th className={`${TH} text-right`}>Visitors</th><th className={`${TH} text-left w-44`}>Share</th></tr></thead>
          <tbody>
            {loading ? <tr><td colSpan={4} className="p-6 text-center"><div className="animate-spin h-5 w-5 border-2 border-primary border-t-transparent rounded-full mx-auto" /></td></tr>
              : !items ? null : items.length === 0 ? <tr><td colSpan={4} className="p-6 text-center text-muted-foreground">{emptyText}</td></tr>
              : items.map((item, i) => (
                <tr key={i} className={TR} data-testid={`row-geo-${i}`}>
                  <td className={`${TD} sm:font-medium`}><span className="flex items-center gap-2"><MapPin className="h-3.5 w-3.5 text-muted-foreground" />{mode === "countries" ? countryName(item.name) : geoLabel(item.name)}</span></td>
                  <td className={`${TD} sm:text-right sm:tabular-nums sm:font-medium`}><span className="sm:hidden text-muted-foreground">Visits: </span>{item.count.toLocaleString()}</td>
                  <td className={`${TD} sm:text-right sm:tabular-nums`}><span className="sm:hidden text-muted-foreground">Visitors: </span>{item.visitors.toLocaleString()}</td>
                  <td className={`${TD} sm:w-44`}><div className="flex items-center gap-2"><PercentBar value={parseFloat(item.percentage)} /><span className="w-14 shrink-0 whitespace-nowrap text-right text-xs tabular-nums text-muted-foreground" data-testid={`text-geo-share-${i}`}>{item.percentage}%</span></div></td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

export function PlatformBreakdowns({ platforms }: { platforms: PlatformData }) {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 sm:gap-5">
      <Section title="Browsers"><BreakdownList data={platforms.browsers} iconFor={browserIcon} /></Section>
      <Section title="Operating systems"><BreakdownList data={platforms.oses} iconFor={osIcon} /></Section>
      <Section title="Devices"><BreakdownList data={platforms.devices} iconFor={deviceIcon} /></Section>
      <Section title="Screen resolutions"><BreakdownList data={platforms.resolutions} iconFor={() => Monitor} /></Section>
    </div>
  );
}

/* ── The dashboard's site list: a summary strip and one panel per site ──────── */

export type OnlineFigure = { count: number | null; note?: string };

/** Totals across every tracked site, each figure leading to the list below. */
export function SitesSummaryStrip({ domains, online }: { domains: DomainWithStats[]; online: Record<number, OnlineFigure> }) {
  const sum = (f: (d: DomainWithStats) => number) => domains.reduce((n, d) => n + f(d), 0);
  const onlineKnown = domains.every((d) => online[d.id]?.count != null);
  const onlineTotal = sum((d) => online[d.id]?.count ?? 0);
  const capped = domains.some((d) => d.stats.totalVisits >= VISIT_ROW_CAP);
  return (
    <MetricStrip cols={[2, 3, 5]} boxed testId="ip-portfolio" className="[&>*:last-child:nth-child(odd)]:col-span-2 md:[&>*:last-child:nth-child(odd)]:col-span-1">
      <StatCell label="Sites" value={domains.length.toLocaleString()} testId="tile-sites" note="Tracked across IP Tracker, Click Guard and VPN Shield" />
      <StatCell label="Online now" value={onlineKnown ? onlineTotal.toLocaleString() : null} none="Still counting" testId="tile-online" note="Distinct IPs in the last 20 minutes, every site added up" />
      <StatCell label="Visits" value={countLabel(sum((d) => d.stats.totalVisits), capped)} testId="tile-visits" note={capped ? `A site at ${VISIT_ROW_CAP.toLocaleString()} shows its latest visits only` : "All time, every site added up"} />
      <StatCell label="Flagged visits" value={sum((d) => d.stats.suspiciousVisits).toLocaleString()} testId="tile-flagged" note="Visits Click Guard marked suspicious" />
      <StatCell label="Blocked IPs" value={sum((d) => d.stats.blockedIps).toLocaleString()} testId="tile-blocked" note="On the sites' Click Guard block lists" />
    </MetricStrip>
  );
}

/** One tracked site as a panel: its name, where it is, the pills to its sections, and its key numbers. */
export function SitePanel({ d, online, selected, onPick, onRemove }: { d: DomainWithStats; online: OnlineFigure; selected?: boolean; onPick?: () => void; onRemove?: () => void }) {
  const capped = d.stats.totalVisits >= VISIT_ROW_CAP;
  const title = d.name || d.domain;
  return (
    <section className="tool-panel" data-testid={`card-site-${d.id}`} aria-current={selected ? "true" : undefined}>
      <div className="tool-panel__head">
        <div className="min-w-0 flex-1">
          <h2 className="tool-panel__title"><Link href={ipHref("", d.id)} onClick={onPick} className="tool-link" aria-label={`${title} — open its dashboard`} data-testid={`link-site-${d.id}`}>{title}</Link>{selected && <span className="tool-chip ml-2 align-middle text-[11px]">Selected</span>}</h2>
          <p className="tool-muted text-[12px] break-all">{d.name ? `${d.domain} · ` : ""}added {new Date(d.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</p>
        </div>
        <a href={`https://${d.domain}`} target="_blank" rel="noopener noreferrer" className="tool-btn tool-btn--icon tool-btn--quiet" aria-label={`Open ${d.domain} in a new tab`} title="Open the website" data-testid={`link-open-site-${d.id}`}><ExternalLink aria-hidden /></a>
        <div className="flex w-full flex-wrap items-center gap-1.5 sm:w-auto">
          <Link href={ipHref("visitors", d.id)} onClick={onPick} className="tool-btn" data-testid={`link-visitors-${d.id}`}>Visitors</Link>
          <Link href={ipHref("pages", d.id)} onClick={onPick} className="tool-btn" data-testid={`link-pages-${d.id}`}>Pages</Link>
          <Link href={ipHref("geo", d.id)} onClick={onPick} className="tool-btn" data-testid={`link-geo-${d.id}`}>Geo</Link>
          <Link href={`/vpn-shield?site=${d.id}`} className="tool-btn" data-testid={`link-vpn-${d.id}`}>VPN Shield</Link>
          <Link href={`/google-ads/signals?domain=${d.id}`} className="tool-btn" data-testid={`link-click-guard-${d.id}`}>Click Guard</Link>
          {onRemove && <button type="button" className="tool-btn tool-btn--quiet" onClick={onRemove} data-testid={`button-remove-site-${d.id}`}>Remove</button>}
        </div>
      </div>
      <MetricStrip cols={[2, 3, 5]} className="[&>*:last-child:nth-child(odd)]:col-span-2 md:[&>*:last-child:nth-child(odd)]:col-span-1">
        <StatCell label="Online now" value={online.count == null ? null : online.count.toLocaleString()} none={online.note ?? "Still counting"} note="Last 20 minutes" testId={`metric-online-${d.id}`} href={ipHref("visitors", d.id)} onClick={onPick} ariaLabel={`Online now: ${online.count ?? "unknown"} — open ${title}'s visitors`} linkTestId={`link-online-${d.id}`} />
        <StatCell label="Visits" value={countLabel(d.stats.totalVisits, capped)} note={capped ? `Latest ${VISIT_ROW_CAP.toLocaleString()} loaded` : "All time"} testId={`metric-visits-${d.id}`} href={ipHref("", d.id)} onClick={onPick} ariaLabel={`Visits: ${countLabel(d.stats.totalVisits, capped)} — open ${title}'s dashboard`} />
        <StatCell label="Unique visitors" value={d.stats.uniqueVisitors.toLocaleString()} note={`${d.stats.avgVisitsPerUser} visits per visitor`} testId={`metric-unique-${d.id}`} href={ipHref("visitors", d.id)} onClick={onPick} ariaLabel={`Unique visitors: ${d.stats.uniqueVisitors} — open ${title}'s visitors`} />
        <StatCell label="Flagged visits" value={d.stats.suspiciousVisits.toLocaleString()} note="Marked suspicious by Click Guard" testId={`metric-flagged-${d.id}`} href={`/google-ads/signals?domain=${d.id}`} ariaLabel={`Flagged visits: ${d.stats.suspiciousVisits} — open Click Guard's traffic signals`} />
        <StatCell label="Blocked IPs" value={d.stats.blockedIps.toLocaleString()} note="Click Guard block list" testId={`metric-blocked-${d.id}`} href={`/google-ads/signals?domain=${d.id}`} ariaLabel={`Blocked IPs: ${d.stats.blockedIps} — open Click Guard's blocked list`} />
      </MetricStrip>
    </section>
  );
}
