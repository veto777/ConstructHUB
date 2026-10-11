import { useState, type ReactNode } from "react";
import { AlertTriangle } from "lucide-react";
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
/**
 * A failed background refetch never wipes saved figures: the last-good tiles/tables stay, marked
 * with the time they were saved and a Retry. (Bare error panel only when nothing ever loaded.)
 * A polite `role="status"`, not an alert: the saved data below is still valid, only the refresh
 * failed — same language as the ip-tracker freshness strip.
 */
export function SavedDataStrip({
  updatedAt,
  retry,
}: {
  /** Milliseconds since the last successful fetch (TanStack `dataUpdatedAt`). */
  updatedAt?: number | null;
  retry: () => void;
}) {
  return (
    <div
      role="status"
      className="flex items-start gap-3 rounded-xl border border-orange-200 bg-orange-50 px-4 py-3 text-sm text-orange-950 dark:border-orange-900/60 dark:bg-orange-950/30 dark:text-orange-100"
      data-testid="strip-saved-data"
    >
      <AlertTriangle
        className="mt-0.5 h-4 w-4 shrink-0 text-primary"
        aria-hidden="true"
      />
      <div className="min-w-0 flex-1 opacity-90">
        Refresh failed — showing saved data from{" "}
        {updatedAt ? new Date(updatedAt).toLocaleString() : "an earlier visit"}.
      </div>
      <div className="shrink-0">
        <GooglePill
          size="sm"
          label="Retry"
          onClick={retry}
          testId="button-retry-saved-data"
        />
      </div>
    </div>
  );
}
export type Column = {
  label: string;
  value: (row: any) => any;
  sortValue?: (row: any) => any;
  /** Server-side sort key (a whitelisted SQL column); only set for reports whose endpoint sorts before pagination. */
  sortKey?: string;
};
export type SortState = { key: string; dir: "asc" | "desc" };
export function ReportTable({
  rows,
  columns,
  caption,
  total,
  sort,
  onSort,
}: {
  rows: any[];
  columns: Column[];
  caption: string;
  /** Rows in the whole report; with page-local sorting, more than `rows` is disclosed. */
  total?: number;
  /** Server-side sort state (persisted in the URL by the caller). Rows arrive pre-sorted. */
  sort?: SortState | null;
  /** With onSort, header clicks sort the WHOLE report on the server before pagination. */
  onSort?: (key: string, dir: "asc" | "desc") => void;
}) {
  const [localSort, setLocalSort] = useState<{
    index: number;
    desc: boolean;
  } | null>(null);
  const server = !!onSort;
  // Server mode: the endpoint sorted before LIMIT/OFFSET, so the note always spans the report.
  // Local mode: the server paged the report (date, then clicks) and the client only has this
  // page, so a sort reorders these rows. Say so where the user can see it rather than only in
  // the sr-only caption.
  const partial = total != null && total > rows.length;
  const sortNote = server
    ? sort
      ? `Sorted by ${columns.find((c) => c.sortKey === sort.key)?.label ?? sort.key} ${sort.dir === "desc" ? "descending" : "ascending"}, across all ${total ?? rows.length} rows.`
      : null
    : localSort
      ? `Sorted by ${columns[localSort.index].label} ${localSort.desc ? "descending" : "ascending"}, ${
          partial
            ? `within this page of ${rows.length} rows only — ${total} rows in the whole report`
            : `across all ${rows.length} rows`
        }.`
      : null;
  const ordered =
    server || !localSort
      ? rows
      : [...rows].sort((a, b) => {
          const column = columns[localSort.index];
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
          return comparison * (localSort.desc ? -1 : 1);
        });
  return (
    <div className="overflow-x-auto">
      {sortNote && (
        <p className="mb-2 text-sm g-text-2" aria-live="polite">
          {sortNote}
        </p>
      )}
      <table className="g-table w-full text-sm">
        <caption className="sr-only">
          {caption};{" "}
          {server
            ? "sort applies to the whole report"
            : "sort applies to the displayed rows"}
        </caption>
        <thead>
          <tr>
            {columns.map((c, index) => {
              const serverActive = server && sort?.key === c.sortKey;
              const localActive = !server && localSort?.index === index;
              const ariaSort = server
                ? serverActive
                  ? sort!.dir === "desc"
                    ? "descending"
                    : "ascending"
                  : "none"
                : localActive
                  ? localSort!.desc
                    ? "descending"
                    : "ascending"
                  : "none";
              const sortable = server ? !!c.sortKey : true;
              return (
                <th key={c.label} scope="col" aria-sort={ariaSort}>
                  {sortable ? (
                    <button
                      className="rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                      title={
                        server || !partial
                          ? "Sorts all rows"
                          : "Sorts the rows on this page only"
                      }
                      onClick={() => {
                        if (server) {
                          if (!c.sortKey) return;
                          onSort!(
                            c.sortKey,
                            sort?.key === c.sortKey && sort.dir === "asc"
                              ? "desc"
                              : "asc",
                          );
                        } else {
                          setLocalSort({
                            index,
                            desc:
                              localSort?.index === index ? !localSort.desc : false,
                          });
                        }
                      }}
                    >
                      {c.label}
                      {(server ? serverActive : localActive)
                        ? (server ? sort!.dir === "desc" : localSort!.desc)
                          ? " ↓"
                          : " ↑"
                        : ""}
                    </button>
                  ) : (
                    c.label
                  )}
                </th>
              );
            })}
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
  const fmt = (n: number) => n.toLocaleString("en-US");
  return (
    <figure className="rounded-xl border p-4">
      <figcaption className="mb-3 flex flex-wrap items-baseline justify-between gap-2 text-sm">
        <span>{label} · displayed periods</span>
        {/* The labelled scale maximum: bar heights are shares of this number. */}
        <span
          className="text-xs tabular-nums text-muted-foreground"
          data-testid="text-trend-max"
        >
          Max {fmt(max)}
        </span>
      </figcaption>
      <div className="flex h-28 items-stretch gap-1" role="list" aria-label={label}>
        {valid.map((r, i) => {
          const v = Number(value(r));
          return (
            // The whole column is the control: the exact value is announced by the button's
            // label and shown as a chip on hover or keyboard focus (bars stay exact shares).
            <div key={i} role="listitem" className="relative min-w-0 flex-1">
              <button
                type="button"
                aria-label={`${date(r)}: ${fmt(v)}`}
                title={`${date(r)}: ${fmt(v)}`}
                className="group absolute inset-0 w-full cursor-default rounded-sm hover:bg-primary/10 focus-visible:bg-primary/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary"
              >
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-x-0 bottom-0 rounded-t-sm bg-primary/70"
                  style={{ height: `${Math.max(1, (v / max) * 100)}%` }}
                />
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute left-1/2 top-0 z-10 -translate-x-1/2 whitespace-nowrap rounded border bg-background px-1 text-[10px] tabular-nums text-foreground opacity-0 shadow-sm transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
                >
                  {fmt(v)}
                </span>
              </button>
            </div>
          );
        })}
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        {date(valid[0])} – {date(valid[valid.length - 1])}. Each bar shows its
        exact value on hover or keyboard focus; exact values also in the table.
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
  { label: "Period", value: (r) => r.date, sortKey: "date" },
  { label: "Breakdown", value: (r) => r.key, sortKey: "key" },
  { label: "Clicks", value: (r) => r.clicks, sortKey: "clicks" },
  { label: "Impressions", value: (r) => r.impressions, sortKey: "impressions" },
  { label: "CTR", value: (r) => percent(r.ctr), sortValue: (r) => r.ctr, sortKey: "ctr" },
  {
    label: "Position",
    value: (r) => position(r.position),
    sortValue: (r) => r.position,
    sortKey: "position",
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
