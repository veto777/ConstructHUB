import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Download, Search } from "lucide-react";
import { activityLabel, activitySince } from "@/components/account-security";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { GoogleList, GoogleListRow, GooglePill } from "@/components/google";
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

/**
 * One CSV cell. Quotes what needs quoting, and neutralises a value that a
 * spreadsheet would run as a formula (=, +, -, @, tab, CR): the user agent of
 * a failed sign-in attempt and the e-mail in its detail are whatever the
 * other side sent, so they are never trusted to open as code in Excel.
 */
const csvCell = (v: unknown) => {
  let s = v == null ? "" : String(v);
  const escaped = /^[=+\-@\t\r]/.test(s);
  if (escaped) s = `'${s}`;
  return escaped || /[",\n\r\t]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function AuditLogSection(_props: SettingsSectionProps) {
  const [filtersOpen, setFiltersOpen] = useState(false);
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
    const header = ["Time (UTC)", "Event", "Kind", "Area", "IP", "Device", "Email"];
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
          <div><Button variant="outline" className="w-full sm:hidden" aria-expanded={filtersOpen} onClick={() => setFiltersOpen(v => !v)}>Filters</Button><div className={filtersOpen ? "mt-3 sm:mt-0" : "hidden sm:block"}>
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
              <div className="g-search !min-h-9 !py-0" role="search">
                <Search aria-hidden="true" />
                <input type="search" aria-label="Search audit log" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Event, IP, device, email" className="!h-8 !text-sm" data-testid="input-audit-search" />
              </div>
            </label>
          </div>
          </div></div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground" data-testid="text-audit-count">
              {rows.length === 0
                ? "No activity recorded yet."
                : `${shown.length.toLocaleString("en-US")} of ${rows.length.toLocaleString("en-US")} events · the most recent 200 are shown. IP and device describe the request and may reflect a proxy.`}
            </p>
            <GooglePill icon={Download} size="sm" label="Export CSV" onClick={exportCsv} disabled={shown.length === 0} testId="button-audit-export" />
          </div>
          {error && <p role="alert" className="text-sm text-destructive" data-testid="text-audit-error">{apiErrorMessage(error)}</p>}
        </CardContent>
      </Card>

      {/* Google's list format (owner, 2026-10-07): hairline rows — the event, then area · email · time, then IP · device. */}
      <div>
          {rows.length > 0 && shown.length === 0 && (
            <p className="py-6 text-sm text-muted-foreground" data-testid="text-audit-no-match">No activity matches these filters.</p>
          )}
          {rows.length === 0 && !error && (
            <p className="py-6 text-sm text-muted-foreground" data-testid="text-audit-empty">Sign-ins, security changes and tool activity will appear here.</p>
          )}
          <GoogleList as="ul">
            {shown.map((r) => {
              const email = (r.detail as any)?.email as string | undefined;
              return (
                <GoogleListRow
                  as="li"
                  size="md"
                  key={r.id}
                  testId="row-audit-event"
                  title={<span title={r.kind} data-testid="text-audit-event">{activityLabel(r.kind, r.detail)}</span>}
                  meta={[
                    areaLabel(areaOf(r.kind)),
                    email || null,
                    <time key="t" className="tabular-nums" dateTime={r.created_at}>{formatDateTime(r.created_at)}</time>,
                  ]}
                  line={<span title={r.user_agent || undefined}>IP <span className="font-mono">{r.ip || "Unavailable"}</span> · {deviceSummary(r.user_agent)}</span>}
                />
              );
            })}
          </GoogleList>
      </div>
    </div>
  );
}
