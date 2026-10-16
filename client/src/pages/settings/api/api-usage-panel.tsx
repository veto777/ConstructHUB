import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { RefreshCw } from "lucide-react";
import { Input } from "@/components/ui/input";
import { SamplePreview, showSample } from "@/components/sample-preview";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { apiErrorMessage } from "@/lib/queryClient";
import { formatCount, formatDateTime, getJson } from "../billing/format";
import { maskedKey, type ApiKeysResponse, type ApiUsageResponse } from "./types";

export type ApiUsagePanelProps = {
  /** Days of history (default 30; the endpoint's own cap applies). */
  days?: number;
};

const COLORS = ["hsl(var(--chart-1))", "hsl(var(--chart-2))", "hsl(var(--chart-3))", "hsl(var(--chart-4))", "hsl(var(--chart-5))"];

/** "2026-09-14" -> "Sep 14" without a time-zone shift (the day is already the server's bucket). */
function dayLabel(date: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(date);
  if (!m) return date;
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

/** External clients call the API while this panel is open: while it is on screen the numbers refresh themselves this often. */
export const USAGE_REFRESH_MS = 60_000;

/** The period presets; "custom" shows a number box (owner 2026-10-15: a preset-only filter also takes a typed value). */
const DAY_PRESETS = [7, 30, 90] as const;
/** The server's cap (server/account/api-key-routes.ts MAX_USAGE_DAYS): a larger number is clamped there, so the box stops at it. */
const MAX_DAYS = 365;

/**
 * A SAMPLE of the panel for an account whose keys have made no call yet — static, obviously made up, badged by
 * <SamplePreview>, shown only while the real series is empty and never mixed with real rows.
 */
const SAMPLE_KEYS = { sample_a: "Reporting script (ck_12ab…9xyz)", sample_b: "Zapier (ck_34cd…8uvw)" } as const;
const SAMPLE_DAYS = [
  { label: "Mon", requests: 14, units: 22, byKey: { sample_a: 16, sample_b: 6 } },
  { label: "Tue", requests: 9, units: 11, byKey: { sample_a: 11, sample_b: 0 } },
  { label: "Wed", requests: 21, units: 38, byKey: { sample_a: 18, sample_b: 20 } },
  { label: "Thu", requests: 6, units: 8, byKey: { sample_a: 8, sample_b: 0 } },
  { label: "Fri", requests: 17, units: 29, byKey: { sample_a: 19, sample_b: 10 } },
];
const SAMPLE_CONFIG: ChartConfig = { sample_a: { label: SAMPLE_KEYS.sample_a, color: COLORS[0] }, sample_b: { label: SAMPLE_KEYS.sample_b, color: COLORS[1] } };

function SampleUsage() {
  const totals = SAMPLE_DAYS.reduce((t, d) => ({ units: t.units + d.units, requests: t.requests + d.requests }), { units: 0, requests: 0 });
  return (
    <div className="space-y-4">
      <dl className="grid grid-cols-3 gap-3">
        <Stat label="Units" value={formatCount(totals.units)} testId="text-sample-usage-units" />
        <Stat label="Requests" value={formatCount(totals.requests)} testId="text-sample-usage-requests" />
        <Stat label="Keys used" value="2" testId="text-sample-usage-keys" />
      </dl>
      <ChartContainer config={SAMPLE_CONFIG} className="w-full h-40 aspect-auto">
        <BarChart data={SAMPLE_DAYS.map((d) => ({ label: d.label, ...d.byKey }))} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
          <CartesianGrid vertical={false} />
          <XAxis dataKey="label" tickLine={false} axisLine={false} />
          <YAxis width={40} tickLine={false} axisLine={false} allowDecimals={false} />
          <ChartLegend content={<ChartLegendContent />} />
          <Bar dataKey="sample_a" stackId="units" fill="var(--color-sample_a)" radius={0} isAnimationActive={false} />
          <Bar dataKey="sample_b" stackId="units" fill="var(--color-sample_b)" radius={0} isAnimationActive={false} />
        </BarChart>
      </ChartContainer>
      <ul className="divide-y text-sm">
        {SAMPLE_DAYS.map((d) => (
          <li key={d.label} className="flex items-baseline justify-between gap-3 py-1.5">
            <span className="font-medium">{d.label}</span>
            <span className="tabular-nums text-muted-foreground">{formatCount(d.units)} units · {formatCount(d.requests)} req</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Settings → API usage: units and requests per day for the last 30 days,
 * stacked by key, with the same numbers in a table. Names come from the keys
 * list; a key that was revoked since still shows by its id. The panel says
 * when its numbers were last fetched, refreshes them every minute while it is
 * visible, and has a Refresh button for right now.
 */
export function ApiUsagePanel({ days: initialDays = 30 }: ApiUsagePanelProps = {}) {
  const queryClient = useQueryClient();
  // The period: a preset, or a typed number of days (1–365). The query only moves once the typed value is a whole number.
  const [preset, setPreset] = useState<string>(() => (DAY_PRESETS as readonly number[]).includes(initialDays) ? String(initialDays) : "custom");
  const [customDays, setCustomDays] = useState<string>(() => (DAY_PRESETS as readonly number[]).includes(initialDays) ? "" : String(initialDays));
  const typed = Number.parseInt(customDays, 10);
  const days = preset === "custom" ? (Number.isInteger(typed) && typed >= 1 ? Math.min(typed, MAX_DAYS) : initialDays) : Number(preset);
  const usage = useQuery<ApiUsageResponse>({
    queryKey: ["/api/account/api-usage", { days }],
    queryFn: () => getJson<ApiUsageResponse>(`/api/account/api-usage?days=${days}`),
    refetchInterval: USAGE_REFRESH_MS,
    refetchIntervalInBackground: false,
  });
  const keysQuery = useQuery<ApiKeysResponse>({ queryKey: ["/api/account/api-keys"] });
  // One click refreshes the chart and the keys' "units this month" alike (the same calls move both).
  const refresh = () => {
    void usage.refetch();
    void queryClient.invalidateQueries({ queryKey: ["/api/account/api-keys"] });
  };

  const rows = usage.data?.days ?? [];
  const keyIds = useMemo(() => {
    const ids = new Set<string>();
    for (const d of rows) for (const id of Object.keys(d.byKey ?? {})) ids.add(id);
    return Array.from(ids);
  }, [rows]);
  // "Revoked" is only claimed once the keys list has loaded and the id is absent from it.
  const keyName = (id: string) => {
    const k = keysQuery.data?.keys.find((x) => x.id === id);
    const short = id.replace(/^key_/, "").slice(0, 6);
    return k ? `${k.name} (${maskedKey(k)})` : keysQuery.data ? `Revoked key ${short}` : `Key ${short}`;
  };
  const config = useMemo<ChartConfig>(() => {
    const c: ChartConfig = {};
    keyIds.forEach((id, i) => { c[id] = { label: keyName(id), color: COLORS[i % COLORS.length] }; });
    return c;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keyIds, keysQuery.data]);
  const chartData = useMemo(() => [...rows].sort((a, b) => a.date.localeCompare(b.date)).map((d) => ({ date: d.date, label: dayLabel(d.date), ...(d.byKey ?? {}) })), [rows]);
  const tableRows = useMemo(() => [...rows].sort((a, b) => b.date.localeCompare(a.date)), [rows]);
  const totals = usage.data?.totals ?? { units: 0, requests: 0 };
  const activeKeys = keyIds.filter((id) => rows.some((d) => (d.byKey?.[id] ?? 0) > 0)).length;
  // The period is a range filter: an empty window is not an empty account. The sample shows only when no key has
  // ever been used (keys' lastUsedAt, this month's plan usage); a used account with a quiet window says so instead.
  const windowEmpty = rows.length === 0 || keyIds.length === 0;
  const keys = keysQuery.data;
  const everUsed = keys ? keys.keys.filter((k) => k.lastUsedAt).length + (keys.plan.usedThisMonth > 0 ? 1 : 0) : undefined;
  const sample = showSample({ isLoading: usage.isLoading || keysQuery.isLoading, isError: !!usage.error || keysQuery.isError, total: windowEmpty ? everUsed : rows.length });

  return (
    <div className="space-y-6">
      <Card data-testid="card-api-usage">
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3 space-y-0">
          <div>
            <CardTitle className="text-base">API usage</CardTitle>
            <CardDescription>Units and requests over the last {days} days, by key. A read is 1 unit (+1 per 100 rows); a write is 5.</CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <span>Period</span>
              <select aria-label="Usage period" value={preset} onChange={(e) => setPreset(e.target.value)} className="h-8 rounded-md border bg-background px-2 text-sm text-foreground max-sm:h-11" data-testid="select-api-usage-period">
                {DAY_PRESETS.map((d) => <option key={d} value={String(d)}>Last {d} days</option>)}
                <option value="custom">Custom…</option>
              </select>
            </label>
            {preset === "custom" && (
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <Input type="number" inputMode="numeric" min={1} max={MAX_DAYS} value={customDays} onChange={(e) => setCustomDays(e.target.value)} placeholder="Days" className="h-8 w-24 text-sm max-sm:h-11" aria-label="Number of days" data-testid="input-api-usage-days" />
                <span>days (up to {MAX_DAYS})</span>
              </label>
            )}
            <span className="text-xs text-muted-foreground whitespace-nowrap" data-testid="text-api-usage-updated">
              {usage.dataUpdatedAt ? `Updated ${formatDateTime(new Date(usage.dataUpdatedAt).toISOString())}` : usage.isLoading ? "Loading…" : "Not loaded"}
            </span>
            <Button size="sm" variant="outline" onClick={refresh} disabled={usage.isFetching} aria-label="Refresh usage" data-testid="button-api-usage-refresh">
              <RefreshCw className={`h-4 w-4 mr-1.5 ${usage.isFetching ? "animate-spin" : ""}`} aria-hidden="true" />Refresh
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          {usage.isLoading ? (
            <div className="space-y-3" aria-busy="true"><Skeleton className="h-16 w-full" /><Skeleton className="h-56 w-full" /></div>
          ) : usage.error ? (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-destructive" role="alert" data-testid="text-api-usage-error">Couldn't load API usage. {apiErrorMessage(usage.error)}</p>
              <Button size="sm" variant="outline" onClick={refresh} disabled={usage.isFetching} data-testid="button-api-usage-retry">Try again</Button>
            </div>
          ) : (
            <>
              <dl className="grid grid-cols-3 gap-3">
                <Stat label="Units" value={formatCount(totals.units)} testId="text-usage-total-units" />
                <Stat label="Requests" value={formatCount(totals.requests)} testId="text-usage-total-requests" />
                <Stat label="Keys used" value={formatCount(activeKeys)} testId="text-usage-active-keys" />
              </dl>
              {rows.length === 0 || keyIds.length === 0 ? (
                <div className="space-y-4">
                  <p className="text-sm text-muted-foreground rounded-lg bg-muted/50 p-4" data-testid="text-api-usage-empty">
                    {sample ? `No API calls in the last ${days} days.` : `Nothing in this range. No API calls in the last ${days} days.`}
                  </p>
                  {/* Nothing real to show yet: a badged sample of the chart and table, replaced by the real series the moment a key is used. */}
                  {sample && (
                    <SamplePreview what="what this panel shows once a key has made calls" testId="sample-api-usage">
                      <SampleUsage />
                    </SamplePreview>
                  )}
                </div>
              ) : (
                <>
                  <ChartContainer config={config} className="w-full h-56 aspect-auto" data-testid="chart-api-usage">
                    <BarChart data={chartData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                      <CartesianGrid vertical={false} />
                      <XAxis dataKey="label" tickLine={false} axisLine={false} minTickGap={24} />
                      <YAxis width={40} tickLine={false} axisLine={false} allowDecimals={false} />
                      <ChartTooltip content={<ChartTooltipContent />} />
                      <ChartLegend content={<ChartLegendContent />} />
                      {keyIds.map((id) => <Bar key={id} dataKey={id} stackId="units" fill={`var(--color-${id})`} radius={0} isAnimationActive={false} />)}
                    </BarChart>
                  </ChartContainer>

                  <div className="hidden md:block">
                    <Table data-testid="table-api-usage">
                      <TableHeader>
                        <TableRow>
                          <TableHead>Day</TableHead>
                          <TableHead className="text-right whitespace-nowrap">Requests</TableHead>
                          <TableHead className="text-right whitespace-nowrap">Units</TableHead>
                          <TableHead>By key</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {tableRows.map((d) => (
                          <TableRow key={d.date} data-testid={`row-usage-${d.date}`}>
                            <TableCell className="whitespace-nowrap">{dayLabel(d.date)}</TableCell>
                            <TableCell className="text-right tabular-nums" data-testid={`text-usage-requests-${d.date}`}>{formatCount(d.requests)}</TableCell>
                            <TableCell className="text-right tabular-nums" data-testid={`text-usage-units-${d.date}`}>{formatCount(d.units)}</TableCell>
                            <TableCell className="text-xs text-muted-foreground" data-testid={`text-usage-bykey-${d.date}`}>
                              {Object.entries(d.byKey ?? {}).filter(([, u]) => u > 0).map(([id, u]) => `${keyName(id)}: ${formatCount(u)}`).join(" · ") || "—"}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                  <ul className="md:hidden divide-y" data-testid="list-api-usage">
                    {tableRows.map((d) => (
                      <li key={d.date} className="py-2 text-sm" data-testid={`card-usage-${d.date}`}>
                        <div className="flex items-baseline justify-between gap-3">
                          <span className="font-medium">{dayLabel(d.date)}</span>
                          <span className="tabular-nums text-muted-foreground">{formatCount(d.units)} units · {formatCount(d.requests)} req</span>
                        </div>
                        <p className="text-xs text-muted-foreground break-words">
                          {Object.entries(d.byKey ?? {}).filter(([, u]) => u > 0).map(([id, u]) => `${keyName(id)}: ${formatCount(u)}`).join(" · ") || "—"}
                        </p>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({ label, value, testId }: { label: string; value: string; testId: string }) {
  return (
    <div className="rounded-lg border p-3 min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-xl font-semibold tabular-nums truncate" data-testid={testId}>{value}</dd>
    </div>
  );
}

export default ApiUsagePanel;
