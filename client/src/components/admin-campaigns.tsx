/**
 * Platform Admin → Campaigns. Visits and sign-ups by campaign tag
 * (utm_source → utm_medium → utm_campaign) and by referring site, for a date
 * range. Read from GET /api/admin/analytics?view=campaigns (platform admins
 * only). Only visitors who accepted the cookie banner are in these numbers.
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Megaphone, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SectionTitle, crmTable } from "@/components/crm-ui";
import { GoogleStat } from "@/components/google";
import { campaignReportCsv, type CampaignReport } from "@shared/campaign-attribution";

const RANGES = [
  { days: 1, label: "Today" },
  { days: 7, label: "7 days" },
  { days: 14, label: "14 days" },
  { days: 30, label: "30 days" },
];

const dash = (v: string | null) => v ?? <span className="text-muted-foreground">—</span>;

export function AdminCampaigns({ enabled }: { enabled: boolean }) {
  // Either a rolling range (the server works out the Eastern days) or two picked dates.
  const [days, setDays] = useState<number | null>(7);
  const [since, setSince] = useState("");
  const [until, setUntil] = useState("");

  const params = new URLSearchParams({ view: "campaigns" });
  if (days === null) {
    if (since) params.set("since", since);
    if (until) params.set("until", until);
  } else if (days !== 7) {
    params.set("days", String(days));
  }
  const url = `/api/admin/analytics?${params.toString()}`;
  const { data, isError, isLoading } = useQuery<CampaignReport>({
    queryKey: [url],
    enabled,
    refetchInterval: 60_000,
  });

  const exportCsv = () => {
    if (!data) return;
    const blob = new Blob([campaignReportCsv(data)], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `campaigns-${data.since}-to-${data.until}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const sources = data ? Array.from(new Set(data.daily.map((d) => d.source))) : [];
  const dayList = data ? Array.from(new Set(data.daily.map((d) => d.day))).sort() : [];
  const maxDaily = Math.max(1, ...(data?.daily ?? []).map((d) => d.visits));
  const started = data?.attributionStartedAt
    ? new Date(data.attributionStartedAt).toLocaleDateString("en-US", { timeZone: "America/New_York", year: "numeric", month: "short", day: "numeric" })
    : null;

  return (
    <div className="space-y-3" data-testid="section-admin-campaigns">
      <SectionTitle icon={Megaphone} title="Campaigns"
        description="Where visits and sign-ups came from: the campaign tag on the link (utm_source, utm_medium, utm_campaign) and the referring site. Only visitors who accepted the cookie banner are counted."
        actions={
          <Button size="sm" variant="outline" onClick={exportCsv} disabled={!data} data-testid="button-campaigns-csv">
            <Download className="h-4 w-4 mr-1.5" /> Export CSV
          </Button>
        } />

      <div className="flex flex-wrap items-center gap-2">
        {RANGES.map((r) => (
          <Button key={r.days} size="sm" variant={days === r.days ? "default" : "outline"}
            onClick={() => setDays(r.days)} data-testid={`button-campaigns-range-${r.days}`}>
            {r.label}
          </Button>
        ))}
        <span className="text-xs text-muted-foreground ml-1">or</span>
        <Input type="date" className="h-9 w-[150px]" aria-label="From date" value={days === null ? since : data?.since ?? ""}
          onChange={(e) => { setSince(e.target.value); if (days !== null) setUntil(data?.until ?? ""); setDays(null); }}
          data-testid="input-campaigns-since" />
        <span className="text-xs text-muted-foreground">to</span>
        <Input type="date" className="h-9 w-[150px]" aria-label="To date" value={days === null ? until : data?.until ?? ""}
          onChange={(e) => { setUntil(e.target.value); if (days !== null) setSince(data?.since ?? ""); setDays(null); }}
          data-testid="input-campaigns-until" />
      </div>

      <p className="text-xs text-muted-foreground" data-testid="text-campaigns-started">
        {started
          ? <>Attribution recorded from {started}. Visits before that date carry no campaign or referrer. Days are US Eastern.</>
          : <>Attribution has not started recording yet.</>}
      </p>

      {isError && <p className="text-sm text-destructive">Couldn't load campaigns — refresh to try again.</p>}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <GoogleStat label="Landings" value={data?.totals.visits ?? "—"} />
        <GoogleStat label="Visitors" value={data?.totals.visitors ?? "—"} />
        <GoogleStat label="Sign-ups (all)" value={data?.totals.signups ?? "—"} />
        <GoogleStat label="Sign-ups with a source" value={data?.totals.attributedSignups ?? "—"} />
      </div>

      <div className={crmTable.wrapper}>
        <table className={crmTable.table} data-testid="table-campaigns">
          <thead className={crmTable.thead}>
            <tr>
              <th className={crmTable.th}>Source</th>
              <th className={crmTable.th}>Medium</th>
              <th className={crmTable.th}>Campaign</th>
              <th className={crmTable.thRight}>Visits</th>
              <th className={crmTable.thRight}>Visitors</th>
              <th className={crmTable.thRight}>Sign-ups</th>
            </tr>
          </thead>
          <tbody>
            {!isError && (data?.campaigns ?? []).length === 0 && (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-sm text-muted-foreground">
                {isLoading ? "Loading…" : "No tagged visits in this range."}
              </td></tr>
            )}
            {(data?.campaigns ?? []).map((c) => (
              <tr key={`${c.source}|${c.medium}|${c.campaign}`} className={crmTable.tr}>
                <td className={`${crmTable.td} font-medium`}>{dash(c.source)}</td>
                <td className={crmTable.td}>{dash(c.medium)}</td>
                <td className={`${crmTable.td} max-w-[260px] truncate`}>{dash(c.campaign)}</td>
                <td className={crmTable.tdRight}>{c.visits}</td>
                <td className={crmTable.tdRight}>{c.visitors}</td>
                <td className={crmTable.tdRight}>{c.signups}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {dayList.length > 0 && (
        <div className={crmTable.wrapper}>
          <table className={crmTable.table} data-testid="table-campaigns-daily">
            <thead className={crmTable.thead}>
              <tr>
                <th className={crmTable.th}>Day · visits (sign-ups)</th>
                {sources.map((s) => <th key={s} className={crmTable.th}>{s}</th>)}
              </tr>
            </thead>
            <tbody>
              {dayList.map((day) => (
                <tr key={day} className={crmTable.tr}>
                  <td className={`${crmTable.td} whitespace-nowrap text-muted-foreground`}>{day}</td>
                  {sources.map((s) => {
                    const d = data!.daily.find((x) => x.day === day && x.source === s);
                    return (
                      <td key={s} className={crmTable.td}>
                        {d ? (
                          <div className="flex items-center gap-2 min-w-[120px]">
                            <div className="h-2 rounded-sm bg-primary" style={{ width: `${Math.max(3, Math.round((d.visits / maxDaily) * 72))}px` }} />
                            <span className="tabular-nums">{d.visits}{d.signups > 0 ? ` (${d.signups})` : ""}</span>
                          </div>
                        ) : <span className="text-muted-foreground">0</span>}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className={crmTable.wrapper}>
        <table className={crmTable.table} data-testid="table-referrers">
          <thead className={crmTable.thead}>
            <tr>
              <th className={crmTable.th}>Referrer</th>
              <th className={`${crmTable.th} hidden sm:table-cell`}>Hosts</th>
              <th className={crmTable.thRight}>Visits</th>
              <th className={crmTable.thRight}>Visitors</th>
              <th className={crmTable.thRight}>Sign-ups</th>
            </tr>
          </thead>
          <tbody>
            {!isError && (data?.referrers ?? []).length === 0 && (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-sm text-muted-foreground">
                {isLoading ? "Loading…" : "No landings in this range."}
              </td></tr>
            )}
            {(data?.referrers ?? []).map((r) => (
              <tr key={r.label} className={crmTable.tr}>
                <td className={`${crmTable.td} font-medium`}>{r.label}</td>
                <td className={`${crmTable.td} hidden sm:table-cell text-muted-foreground`}>{r.hosts.join(", ") || "—"}</td>
                <td className={crmTable.tdRight}>{r.visits}</td>
                <td className={crmTable.tdRight}>{r.visitors}</td>
                <td className={crmTable.tdRight}>{r.signups}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
