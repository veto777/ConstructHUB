import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { apiErrorMessage } from "@/lib/queryClient";
import { formatCount, getJson } from "../billing/format";
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

/**
 * Settings → API usage: units and requests per day for the last 30 days,
 * stacked by key, with the same numbers in a table. Names come from the keys
 * list; a key that was revoked since still shows by its id.
 */
export function ApiUsagePanel({ days = 30 }: ApiUsagePanelProps = {}) {
  const usage = useQuery<ApiUsageResponse>({
    queryKey: ["/api/account/api-usage", { days }],
    queryFn: () => getJson<ApiUsageResponse>(`/api/account/api-usage?days=${days}`),
  });
  const keysQuery = useQuery<ApiKeysResponse>({ queryKey: ["/api/account/api-keys"] });

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

  return (
    <div className="space-y-6">
      <Card data-testid="card-api-usage">
        <CardHeader>
          <CardTitle className="text-base">API usage</CardTitle>
          <CardDescription>Units and requests over the last {days} days, by key. A read is 1 unit (+1 per 100 rows); a write is 5.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {usage.isLoading ? (
            <div className="space-y-3" aria-busy="true"><Skeleton className="h-16 w-full" /><Skeleton className="h-56 w-full" /></div>
          ) : usage.error ? (
            <p className="text-sm text-destructive" role="alert" data-testid="text-api-usage-error">Couldn't load API usage. {apiErrorMessage(usage.error)}</p>
          ) : (
            <>
              <dl className="grid grid-cols-3 gap-3">
                <Stat label="Units" value={formatCount(totals.units)} testId="text-usage-total-units" />
                <Stat label="Requests" value={formatCount(totals.requests)} testId="text-usage-total-requests" />
                <Stat label="Keys used" value={formatCount(activeKeys)} testId="text-usage-active-keys" />
              </dl>
              {rows.length === 0 || keyIds.length === 0 ? (
                <p className="text-sm text-muted-foreground rounded-lg bg-muted/50 p-4" data-testid="text-api-usage-empty">
                  No API calls in the last {days} days.
                </p>
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
                          <TableHead className="text-right">Requests</TableHead>
                          <TableHead className="text-right">Units</TableHead>
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
