import { useState, type ReactNode } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { Notice } from "@/components/app-ui";
import { GooglePill } from "@/components/google";
import { PlanRequired, planRequiredFrom } from "@/components/plan-required";
import { apiErrorMessage } from "@/lib/queryClient";

export function LoadingReport() {
  return (
    <div role="status" aria-label="Loading report" className="space-y-3">
      <Skeleton className="h-8 w-2/3" />
      <Skeleton className="h-24 w-full" />
      <span className="sr-only">Loading…</span>
    </div>
  );
}
export function ReportError({
  error,
  retry,
}: {
  error: unknown;
  retry: () => void;
}) {
  return planRequiredFrom(error) ? (
    <PlanRequired module="cloudflareSearchConsole" error={error} />
  ) : (
    <Notice tone="danger">
      <span role="alert">{apiErrorMessage(error)}</span>{" "}
      <GooglePill label="Retry" onClick={retry} />
    </Notice>
  );
}
export type Column = {
  label: string;
  value: (row: any) => any;
  sortValue?: (row: any) => any;
};
export function ReportTable({
  rows,
  columns,
  caption,
}: {
  rows: any[];
  columns: Column[];
  caption: string;
}) {
  const [sort, setSort] = useState<{ index: number; desc: boolean } | null>(
    null,
  );
  const ordered = [...rows].sort((a, b) => {
    if (!sort) return 0;
    const column = columns[sort.index];
    const get = column.sortValue ?? column.value;
    const x = get(a),
      y = get(b);
    const comparison =
      x == null
        ? y == null
          ? 0
          : 1
        : y == null
          ? -1
          : !isNaN(Number(x)) && !isNaN(Number(y))
            ? Number(x) - Number(y)
            : String(x).localeCompare(String(y));
    return comparison * (sort.desc ? -1 : 1);
  });
  return (
    <div className="overflow-x-auto">
      <table className="g-table w-full text-sm">
        <caption className="sr-only">
          {caption}; sort applies to the displayed rows
        </caption>
        <thead>
          <tr>
            {columns.map((c, index) => (
              <th
                key={c.label}
                scope="col"
                aria-sort={
                  sort?.index === index
                    ? sort.desc
                      ? "descending"
                      : "ascending"
                    : "none"
                }
              >
                <button
                  className="rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                  onClick={() =>
                    setSort({
                      index,
                      desc: sort?.index === index ? !sort.desc : false,
                    })
                  }
                >
                  {c.label}
                  {sort?.index === index ? (sort.desc ? " ↓" : " ↑") : ""}
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {ordered.map((row, i) => (
            <tr key={i}>
              {columns.map((c) => (
                <td key={c.label} className="max-w-md break-words">
                  {c.value(row) ?? "Unavailable"}
                </td>
              ))}
            </tr>
          ))}
          {!rows.length && (
            <tr>
              <td colSpan={columns.length}>No matching rows in this report.</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
export function MetricTiles({
  metrics,
}: {
  metrics: { label: string; value: ReactNode }[];
}) {
  return (
    <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {metrics.map((m) => (
        <div key={m.label} className="rounded-xl border p-4">
          <dt className="text-sm text-muted-foreground">{m.label}</dt>
          <dd className="mt-2 text-2xl font-semibold tabular-nums">
            {m.value ?? "Unavailable"}
          </dd>
        </div>
      ))}
    </dl>
  );
}
export function ReportTrend({
  rows,
  label,
  value,
  date,
}: {
  rows: any[];
  label: string;
  value: (r: any) => any;
  date: (r: any) => string;
}) {
  const valid = rows
    .filter((r) => value(r) != null && Number.isFinite(Number(value(r))))
    .slice()
    .sort((a, b) => String(date(a)).localeCompare(String(date(b))));
  const max = Math.max(1, ...valid.map((r) => Number(value(r))));
  if (!valid.length) return null;
  return (
    <figure className="rounded-xl border p-4">
      <figcaption className="mb-3 text-sm">
        {label} · displayed periods
      </figcaption>
      <div
        className="flex h-28 items-end gap-1"
        role="img"
        aria-label={valid.map((r) => `${date(r)}: ${value(r)}`).join("; ")}
      >
        {valid.map((r, i) => (
          <div
            key={i}
            title={`${date(r)}: ${value(r)}`}
            className="min-w-0 flex-1 bg-primary/70"
            style={{
              height: `${Math.max(1, (Number(value(r)) / max) * 100)}%`,
            }}
          />
        ))}
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        {date(valid[0])} – {date(valid[valid.length - 1])}. Exact values in the
        table.
      </p>
    </figure>
  );
}
export const percent = (v: any) =>
  v == null ? null : `${(Number(v) * 100).toFixed(2)}%`;
export const position = (v: any) => (v == null ? null : Number(v).toFixed(1));
export function relativeTime(
  value: string | null | undefined,
  now = Date.now(),
) {
  if (!value) return "Not available";
  const seconds = (new Date(value).getTime() - now) / 1000;
  if (!Number.isFinite(seconds)) return "Not available";
  const [unit, size] =
    Math.abs(seconds) >= 86400
      ? (["day", 86400] as const)
      : Math.abs(seconds) >= 3600
        ? (["hour", 3600] as const)
        : (["minute", 60] as const);
  return new Intl.RelativeTimeFormat("en", { numeric: "auto" }).format(
    Math.round(seconds / size),
    unit,
  );
}
export const analyticsColumns: Column[] = [
  { label: "Period", value: (r) => r.date },
  { label: "Breakdown", value: (r) => r.key },
  { label: "Clicks", value: (r) => r.clicks },
  { label: "Impressions", value: (r) => r.impressions },
  { label: "CTR", value: (r) => percent(r.ctr), sortValue: (r) => r.ctr },
  {
    label: "Position",
    value: (r) => position(r.position),
    sortValue: (r) => r.position,
  },
];
export const cloudflareColumns: Record<string, Column[]> = {
  traffic: [
    { label: "Date (UTC)", value: (r) => r.dimensions?.date },
    ...["requests", "pageViews", "threats"].map((k) => ({
      label:
        k === "pageViews"
          ? "Page views"
          : k === "requests"
            ? "Requests"
            : "Threats",
      value: (r: any) => r.sum?.[k],
    })),
    { label: "Unique visitors", value: (r) => r.uniq?.uniques },
  ],
  events: [
    ["Time", "datetime"],
    ["Action", "action"],
    ["IP address", "clientIP"],
    ["Country", "clientCountryName"],
    ["Path", "clientRequestPath"],
    ["Source", "source"],
  ].map(([label, key]) => ({ label, value: (r) => r[key] })),
  paths: [
    { label: "Path", value: (r) => r.dimensions?.clientRequestPath },
    { label: "Requests (sampled)", value: (r) => r.count },
  ],
  bots: [
    { label: "Bot score", value: (r) => r.dimensions?.botScore },
    { label: "Requests (sampled)", value: (r) => r.count },
  ],
  countries: [
    { label: "Country", value: (r) => r.country },
    { label: "Requests", value: (r) => r.requests },
    { label: "Threats", value: (r) => r.threats },
  ],
};
export function sumKnown(rows: any[] | null | undefined, key: string) {
  if (!rows?.length || rows.some((r) => r.sum?.[key] == null)) return null;
  return rows.reduce((n, r) => n + Number(r.sum[key]), 0);
}
