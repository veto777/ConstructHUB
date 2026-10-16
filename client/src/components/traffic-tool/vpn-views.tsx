/**
 * VPN Shield's presentational pieces (pages/vpn-shield.tsx owns the data): the stat tiles, the 30-day
 * detections chart, the top-provider / top-country lists, a flagged-visit row, and the per-site panel in
 * the SEO Suite's tool language. The sample previews (./samples.tsx) render the same pieces from fixtures.
 */
import { useState, type ReactNode } from "react";
import { Link } from "wouter";
import { ChevronRight, Clock, ExternalLink, Fingerprint, MapPin } from "lucide-react";
import { MetricStrip, StatCell } from "@/components/tool";
import { Section } from "@/components/app-ui";
import { countryName, GEO_SOURCE_NOTE } from "@/components/ip-tracker/country-names";
import { DeviceIcon, formatDate, formatTimeAgo, localDayKey } from "./shared";

/* ── Shapes the API answers with ────────────────────────────────────────────── */

export type VpnDomain = {
  id: number; userId: number; domain: string; trackingId: string; name: string | null; isActive: boolean; createdAt: string;
  settings?: { vpnBlockMode?: string; vpnRedirectUrl?: string; vpnWhitelistedIps?: string } | null;
  /** The mode the server enforces right now: the saved one, else Log only. */
  vpnEffectiveMode?: string;
  vpnStats?: { totalBlocks: number; uniqueVpnIps: number };
};
export type VpnVisit = {
  id: number; domainId: number; ipAddress: string; userAgent: string | null; fingerprint: string | null; browser: string | null; os: string | null;
  deviceType: string | null; country: string | null; city: string | null; referrer: string | null; landingPage: string | null;
  vpnProvider: string | null; detectionMethod: string; action: string; visitedAt: string;
};
export type VpnStats = { today: number; yesterday: number; sevenDays: number; thirtyDays: number; total: number; uniqueIps: number; topProviders: { name: string; count: number }[]; topCountries: { name: string; count: number }[] };

// Every detection is recorded; `action` is what the site's block mode did with it at the time.
const ACTION_LABELS: Record<string, string> = { block: "Blocked", redirect: "Redirected", log: "Logged only" };
export const actionLabel = (action: string) => ACTION_LABELS[action] ?? action;
const MODE_WORDS: Record<string, string> = { block: "Blocking: overlay", redirect: "Blocking: redirect", log: "Log only" };

const vpnHref = (view: "" | "flagged" | "install" | "settings", siteId: number) => `/vpn-shield${view ? `/${view}` : ""}?site=${siteId}`;

/* ── 30-day chart ───────────────────────────────────────────────────────────── */

export type Day = { key: string; label: string; count: number };

/** The last 30 local days, oldest first, each with its detection count. */
export function sparklineDays(visits: VpnVisit[] | undefined, now = new Date()): Day[] {
  const days: Day[] = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
    days.push({ key: localDayKey(d), label: `${d.getMonth() + 1}/${d.getDate()}`, count: 0 });
  }
  for (const v of visits || []) {
    const key = localDayKey(new Date(v.visitedAt));
    const bucket = days.find((d) => d.key === key);
    if (bucket) bucket.count++;
  }
  return days;
}

export function DetectionsChart({ days }: { days: Day[] }) {
  const maxDay = Math.max(...days.map((d) => d.count), 1);
  return (
    <Section title="Detections, last 30 days">
      {/* Each bar hangs from a column with its own height: a percentage height inside a content-sized column
          collapses to the minimum and draws every bar the same. h-full + an absolute bar keeps it meaningful. */}
      <div className="flex items-center gap-2 text-[10px] text-muted-foreground" data-testid="text-vpn-daily-max">
        <span className="tabular-nums">{maxDay.toLocaleString()} detection{maxDay === 1 ? "" : "s"}</span>
        <span className="flex-1 border-t border-dashed" aria-hidden="true" />
      </div>
      <div className="flex items-stretch gap-1 h-28" role="list" aria-label="Detections per day, last 30 days">
        {days.map((day) => (
          <div key={day.key} className="flex-1 flex h-full flex-col items-center gap-1" role="listitem">
            <div className="relative w-full flex-1" tabIndex={0} aria-label={`${day.label}: ${day.count} detection${day.count === 1 ? "" : "s"}`}>
              <div className="absolute bottom-0 left-0 right-0 rounded-t bg-primary/80 hover:bg-primary transition-colors" style={{ height: `${(day.count / maxDay) * 100}%` }} title={`${day.label}: ${day.count} detection${day.count === 1 ? "" : "s"}`} data-testid={`bar-vpn-${day.key}`} />
            </div>
            {Number(day.key.slice(8, 10)) % 5 === 1 && <span className="text-[8px] text-muted-foreground truncate w-full text-center">{day.label}</span>}
          </div>
        ))}
      </div>
    </Section>
  );
}

/* ── Top lists: the first 8, then all of them on request ────────────────────── */

function TopList({ title, rows, label, note, testId }: { title: string; rows: { name: string; count: number }[]; label: (n: string) => string; note?: ReactNode; testId: string }) {
  const [all, setAll] = useState(false);
  const shown = all ? rows : rows.slice(0, 8);
  return (
    <Section title={title}>
      {note && <p className="mb-2 text-xs text-muted-foreground">{note}</p>}
      <div className="space-y-2" data-testid={testId}>
        {shown.map((p) => (
          <div key={p.name} className="flex items-center justify-between gap-2 text-sm">
            <span className="truncate">{label(p.name)}</span>
            <span className="tabular-nums text-muted-foreground">{p.count.toLocaleString()}</span>
          </div>
        ))}
      </div>
      {rows.length > 8 && <button type="button" className="g-pill g-pill--sm mt-3" onClick={() => setAll((v) => !v)} aria-expanded={all} data-testid={`${testId}-more`}>{all ? "Show the top 8" : `Show all ${rows.length}`}</button>}
    </Section>
  );
}

export function TopLists({ stats }: { stats: Pick<VpnStats, "topProviders" | "topCountries"> }) {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 sm:gap-5">
      <TopList title="Top VPN providers" rows={stats.topProviders} label={(n) => n} testId="list-vpn-providers" />
      <TopList title="Top countries" rows={stats.topCountries} label={(n) => countryName(n) ?? n} note={<span data-testid="text-countries-source-note">{GEO_SOURCE_NOTE}</span>} testId="list-vpn-countries" />
    </div>
  );
}

/* ── Flagged visit row ──────────────────────────────────────────────────────── */

export function FlaggedVisitRow({ v, expanded, onToggle }: { v: VpnVisit; expanded: boolean; onToggle: () => void }) {
  return (
    <div className={`rounded-xl border bg-card transition-all ${expanded ? "ring-1 ring-border" : ""}`} data-testid={`card-vpn-visit-${v.id}`}>
      <button type="button" className="w-full cursor-pointer p-4 text-left hover:bg-muted/30 transition-colors" onClick={onToggle} aria-expanded={expanded} aria-controls={`vpn-visit-detail-${v.id}`} data-testid={`button-expand-vpn-visit-${v.id}`}>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-sm font-medium break-all" data-testid={`text-vpn-ip-${v.id}`}>{v.ipAddress}</span>
                {v.vpnProvider && <span className="rounded-full border bg-muted/50 px-2 py-0.5 text-[10px] text-muted-foreground">{v.vpnProvider}</span>}
                <span className="rounded-full border bg-muted/50 px-2 py-0.5 text-[10px] text-muted-foreground">{v.detectionMethod}</span>
                <span className={`rounded-full border px-2 py-0.5 text-[10px] ${v.action === "block" ? "border-amber-500/40 text-amber-700 dark:text-amber-400" : "text-muted-foreground"}`} data-testid={`badge-vpn-action-${v.id}`}>{actionLabel(v.action)}</span>
              </div>
              <div className="mt-0.5 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                {v.fingerprint && <span className="flex items-center gap-1"><Fingerprint className="h-3 w-3" /> {v.fingerprint.slice(0, 12)}…</span>}
                {(v.city || v.country) && <span className="flex items-center gap-1"><MapPin className="h-3 w-3" /> {[v.city, countryName(v.country)].filter(Boolean).join(", ")}</span>}
                <span className="flex items-center gap-1"><Clock className="h-3 w-3" /> {formatTimeAgo(v.visitedAt)}</span>
              </div>
            </div>
          </div>
          <div className="hidden sm:flex items-center gap-1.5 text-xs text-muted-foreground shrink-0"><DeviceIcon type={v.deviceType} /><span>{v.browser || "Unknown"}</span></div>
          <ChevronRight className={`h-4 w-4 text-muted-foreground shrink-0 transition-transform ${expanded ? "rotate-90" : ""}`} />
        </div>
      </button>
      {expanded && (
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
              {/* Full URLs wrap (and carry a tooltip) instead of truncating: a cut-off link can't be read. */}
              <div className="flex justify-between gap-4"><span className="shrink-0 text-muted-foreground">Landing page</span><span className="min-w-0 break-all text-right" title={v.landingPage || undefined} data-testid={`text-vpn-landing-${v.id}`}>{v.landingPage || "Unknown"}</span></div>
              <div className="flex justify-between gap-4"><span className="shrink-0 text-muted-foreground">Referrer</span><span className="min-w-0 break-all text-right" title={v.referrer || undefined} data-testid={`text-vpn-referrer-${v.id}`}>{v.referrer || "Direct"}</span></div>
              {v.userAgent && (<><h4 className="mb-2 mt-4 text-xs font-semibold text-muted-foreground">User agent</h4><p className="rounded-md bg-muted p-2 font-mono text-[11px] text-muted-foreground break-all">{v.userAgent}</p></>)}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── The overview's site list ───────────────────────────────────────────────── */

export function VpnSummaryStrip({ domains }: { domains: VpnDomain[] }) {
  const sum = (f: (d: VpnDomain) => number) => domains.reduce((n, d) => n + f(d), 0);
  const blocking = domains.filter((d) => (d.vpnEffectiveMode ?? d.settings?.vpnBlockMode ?? "log") !== "log").length;
  return (
    <MetricStrip cols={[2, 2, 4]} boxed testId="vpn-portfolio">
      <StatCell label="Sites" value={domains.length.toLocaleString()} testId="tile-vpn-sites" note="Each with its own mode and whitelist" />
      <StatCell label="Detections" value={sum((d) => d.vpnStats?.totalBlocks ?? 0).toLocaleString()} testId="tile-vpn-detections" note="All time, any action, every site added up" />
      <StatCell label="Unique VPN IPs" value={sum((d) => d.vpnStats?.uniqueVpnIps ?? 0).toLocaleString()} testId="tile-vpn-unique" note="Distinct addresses flagged" />
      <StatCell label="Sites blocking" value={blocking.toLocaleString()} testId="tile-vpn-blocking" note={blocking ? "Overlay or redirect in force" : "Every site is in Log only"} />
    </MetricStrip>
  );
}

export function VpnSitePanel({ d, selected, onPick }: { d: VpnDomain; selected?: boolean; onPick?: () => void }) {
  const title = d.name || d.domain;
  const mode = d.vpnEffectiveMode ?? d.settings?.vpnBlockMode ?? "log";
  const saved = !!d.settings?.vpnBlockMode;
  return (
    <section className="tool-panel" data-testid={`card-vpn-site-${d.id}`} aria-current={selected ? "true" : undefined}>
      <div className="tool-panel__head">
        <div className="min-w-0 flex-1">
          <h2 className="tool-panel__title"><Link href={vpnHref("", d.id)} onClick={onPick} className="tool-link" aria-label={`${title} — open its VPN Shield overview`} data-testid={`link-vpn-site-${d.id}`}>{title}</Link>{selected && <span className="tool-chip ml-2 align-middle text-[11px]">Selected</span>}</h2>
          <p className="tool-muted text-[12px] break-all">{d.name ? `${d.domain} · ` : ""}added {new Date(d.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</p>
        </div>
        <a href={`https://${d.domain}`} target="_blank" rel="noopener noreferrer" className="tool-btn tool-btn--icon tool-btn--quiet" aria-label={`Open ${d.domain} in a new tab`} title="Open the website" data-testid={`link-open-vpn-site-${d.id}`}><ExternalLink aria-hidden /></a>
        <div className="flex w-full flex-wrap items-center gap-1.5 sm:w-auto">
          <Link href={vpnHref("flagged", d.id)} onClick={onPick} className="tool-btn" data-testid={`link-vpn-flagged-${d.id}`}>Flagged visits</Link>
          <Link href={vpnHref("install", d.id)} onClick={onPick} className="tool-btn" data-testid={`link-vpn-install-${d.id}`}>Install script</Link>
          <Link href={vpnHref("settings", d.id)} onClick={onPick} className="tool-btn" data-testid={`link-vpn-settings-${d.id}`}>Settings</Link>
          <Link href={`/ip-tracker?site=${d.id}`} className="tool-btn" data-testid={`link-vpn-ip-tracker-${d.id}`}>IP Tracker</Link>
        </div>
      </div>
      <MetricStrip cols={[2, 3, 3]} className="[&>*:last-child:nth-child(odd)]:col-span-2 md:[&>*:last-child:nth-child(odd)]:col-span-1">
        <StatCell label="Detections" value={(d.vpnStats?.totalBlocks ?? 0).toLocaleString()} note="All time, any action" testId={`metric-vpn-detections-${d.id}`} href={vpnHref("flagged", d.id)} onClick={onPick} ariaLabel={`Detections: ${d.vpnStats?.totalBlocks ?? 0} — open ${title}'s flagged visits`} />
        <StatCell label="Unique VPN IPs" value={(d.vpnStats?.uniqueVpnIps ?? 0).toLocaleString()} note="Distinct addresses" testId={`metric-vpn-unique-${d.id}`} href={vpnHref("flagged", d.id)} onClick={onPick} ariaLabel={`Unique VPN IPs: ${d.vpnStats?.uniqueVpnIps ?? 0} — open ${title}'s flagged visits`} />
        <StatCell label="Mode" value={MODE_WORDS[mode] ?? mode} note={saved ? "Saved in Settings" : "Nothing saved yet: Log only applies"} testId={`metric-vpn-mode-${d.id}`} href={vpnHref("settings", d.id)} onClick={onPick} ariaLabel={`Mode: ${MODE_WORDS[mode] ?? mode} — open ${title}'s settings`} />
      </MetricStrip>
    </section>
  );
}
