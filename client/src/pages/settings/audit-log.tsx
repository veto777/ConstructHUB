import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Download, Search } from "lucide-react";
import { activityLabel, activitySince } from "@/components/account-security";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { apiErrorMessage } from "@/lib/queryClient";
import { LoadingCard, formatDateTime } from "./shared";
import type { SettingsSectionProps } from "./types";

/**
 * Workspace → Audit log: the account's activity as the server records it
 * (GET /api/account-activity — the newest 200 events), filterable by area,
 * event, date and text, and exportable as CSV. Labels come from the same map
 * the security panel uses, so an event reads the same everywhere.
 */

type ActivityRow = {
  id: number | string;
  kind: string;
  detail?: Record<string, unknown> | null;
  ip?: string | null;
  user_agent?: string | null;
  created_at: string;
};

const AREA_LABELS: Record<string, string> = {
  auth: "Sign-in", security: "Security", google: "Google", gbp: "Google Business Profile", sitescan: "Site Scan",
  social: "Social media", ads: "Google Ads", agency: "Agency", cloudflare: "Cloudflare", domains: "Domains",
  mail: "Mail alerts", gsc: "Search Console", payment: "Payments", billing: "Billing", api: "API", account: "Account",
};

const areaOf = (kind: string) => kind.split(".")[0] || "other";
const areaLabel = (area: string) => AREA_LABELS[area] || area.charAt(0).toUpperCase() + area.slice(1);

/** A short device name from the user agent, with the full string in a tooltip. */
function deviceSummary(ua: string | null | undefined): string {
  if (!ua) return "Unavailable";
  const browser = /Edg\//.test(ua) ? "Edge" : /OPR\//.test(ua) ? "Opera" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : null;
  const os = /Windows/.test(ua) ? "Windows" : /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iOS" : /Mac OS X/.test(ua) ? "macOS" : /Linux/.test(ua) ? "Linux" : null;
  const parts = [browser, os].filter(Boolean);
  return parts.length ? parts.join(" · ") : ua.length > 48 ? `${ua.slice(0, 48)}…` : ua;
}

const csvCell = (v: unknown) => {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function AuditLogSection(_props: SettingsSectionProps) {
  const { data, error, isLoading } = useQuery<{ activity: ActivityRow[] }>({ queryKey: ["/api/account-activity"] });
  const [area, setArea] = useState("");
  const [kind, setKind] = useState("");
  const [since, setSince] = useState("");
  const [search, setSearch] = useState("");

  const rows = data?.activity ?? [];
  const areas = useMemo(() => [...new Set(rows.map((r) => areaOf(r.kind)))].sort(), [rows]);
  const kinds = useMemo(
    () => [...new Set(rows.filter((r) => !area || areaOf(r.kind) === area).map((r) => r.kind))].sort(),
    [rows, area],
  );

  const shown = rows.filter((r) => {
    if (area && areaOf(r.kind) !== area) return false;
    if (kind && r.kind !== kind) return false;
    if (!activitySince(r.created_at, since)) return false;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      const hay = [activityLabel(r.kind, r.detail), r.kind, r.ip, r.user_agent, (r.detail as any)?.email].filter(Boolean).join(" ").toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  const exportCsv = () => {
    const header = ["Time", "Event", "Kind", "Area", "IP", "Device", "Email"];
    const lines = shown.map((r) => [
      new Date(r.created_at).toISOString(), activityLabel(r.kind, r.detail), r.kind, areaLabel(areaOf(r.kind)),
      r.ip ?? "", r.user_agent ?? "", (r.detail as any)?.email ?? "",
    ].map(csvCell).join(","));
    const blob = new Blob([[header.join(","), ...lines].join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `constructhub-audit-log-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  if (isLoading) return <LoadingCard label="Loading activity…" />;

  return (
    <div className="space-y-4" data-testid="section-audit-log">
      <Card>
        <CardContent className="pt-6 space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_10rem_minmax(0,1.4fr)]">
            <label className="text-xs text-muted-foreground space-y-1">
              <span>Area</span>
              <select
                aria-label="Audit area"
                value={area}
                onChange={(e) => { setArea(e.target.value); setKind(""); }}
                className="block w-full h-9 border rounded-md px-2 bg-background text-sm text-foreground"
                data-testid="select-audit-area"
              >
                <option value="">All areas</option>
                {areas.map((a) => <option key={a} value={a}>{areaLabel(a)}</option>)}
              </select>
            </label>
            <label className="text-xs text-muted-foreground space-y-1">
              <span>Event</span>
              <select
                aria-label="Audit event"
                value={kind}
                onChange={(e) => setKind(e.target.value)}
                className="block w-full h-9 border rounded-md px-2 bg-background text-sm text-foreground"
                data-testid="select-audit-kind"
              >
                <option value="">All events</option>
                {kinds.map((k) => <option key={k} value={k}>{activityLabel(k)}</option>)}
              </select>
            </label>
            <label className="text-xs text-muted-foreground space-y-1">
              <span>Since</span>
              <Input aria-label="Audit since" type="date" value={since} onChange={(e) => setSince(e.target.value)} className="h-9" data-testid="input-audit-since" />
            </label>
            <label className="text-xs text-muted-foreground space-y-1">
              <span>Search</span>
              <div className="relative">
                <Search className="h-4 w-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input aria-label="Search audit log" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Event, IP, device, email" className="h-9 pl-8" data-testid="input-audit-search" />
              </div>
            </label>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground" data-testid="text-audit-count">
              {rows.length === 0
                ? "No activity recorded yet."
                : `${shown.length.toLocaleString("en-US")} of ${rows.length.toLocaleString("en-US")} events · the most recent 200 are kept. IP and device describe the request and may reflect a proxy.`}
            </p>
            <Button size="sm" variant="outline" onClick={exportCsv} disabled={shown.length === 0} data-testid="button-audit-export">
              <Download className="h-4 w-4 mr-2" /> Export CSV
            </Button>
          </div>
          {error && <p role="alert" className="text-sm text-destructive" data-testid="text-audit-error">{apiErrorMessage(error)}</p>}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <div className="hidden md:grid grid-cols-[11rem_minmax(0,1fr)_9rem_12rem] gap-3 px-4 py-2 border-b text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            <span>Time</span><span>Event</span><span>IP</span><span>Device</span>
          </div>
          {rows.length > 0 && shown.length === 0 && (
            <p className="px-4 py-6 text-sm text-muted-foreground" data-testid="text-audit-no-match">No activity matches these filters.</p>
          )}
          {rows.length === 0 && !error && (
            <p className="px-4 py-6 text-sm text-muted-foreground" data-testid="text-audit-empty">Sign-ins, security changes and tool activity will appear here.</p>
          )}
          <ul>
            {shown.map((r) => {
              const email = (r.detail as any)?.email as string | undefined;
              return (
                <li key={r.id} className="grid gap-1 md:grid-cols-[11rem_minmax(0,1fr)_9rem_12rem] md:gap-3 px-4 py-3 border-b last:border-b-0 text-sm break-words" data-testid="row-audit-event">
                  <time className="text-muted-foreground tabular-nums md:text-foreground" dateTime={r.created_at}>{formatDateTime(r.created_at)}</time>
                  <div className="min-w-0">
                    <p className="font-medium" title={r.kind} data-testid="text-audit-event">{activityLabel(r.kind, r.detail)}</p>
                    <p className="text-xs text-muted-foreground">{areaLabel(areaOf(r.kind))}{email ? ` · ${email}` : ""}</p>
                  </div>
                  <p className="text-xs md:text-sm text-muted-foreground font-mono"><span className="md:hidden">IP: </span>{r.ip || "Unavailable"}</p>
                  <p className="text-xs md:text-sm text-muted-foreground" title={r.user_agent || undefined}><span className="md:hidden">Device: </span>{deviceSummary(r.user_agent)}</p>
                </li>
              );
            })}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
