import { formatNumber } from "./format";
import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type ReactNode } from "react";
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
type SavedNotice = { updatedAt?: number | null; retry: () => void };
const SavedDataContext = createContext<{
  count: number;
  register: (id: string, notice: SavedNotice | null) => void;
} | null>(null);

/** Count only mounted notices, so hidden tabs and unrelated cached queries never join the warning. */
export function SavedDataSummary({ children }: { children: ReactNode }) {
  const [notices, setNotices] = useState<Map<string, SavedNotice>>(() => new Map());
  const register = useCallback((id: string, notice: SavedNotice | null) => {
    setNotices((previous) => {
      const next = new Map(previous);
      if (notice) next.set(id, notice); else next.delete(id);
      return next;
    });
  }, []);
  const entries = [...notices.values()];
  return <SavedDataContext.Provider value={{ count: notices.size, register }}>
    {entries.length > 1 && <SavedDataNotice
      updatedAt={Math.min(...entries.map((n) => n.updatedAt || 0))}
      retry={() => entries.forEach((n) => n.retry())} retryLabel="Retry all" />}
    {children}
  </SavedDataContext.Provider>;
}

export function SavedDataStrip({ updatedAt, retry }: SavedNotice) {
  const context = useContext(SavedDataContext);
  const register = context?.register;
  const id = useId();
  const retryRef = useRef(retry);
  retryRef.current = retry;
  useEffect(() => {
    register?.(id, { updatedAt, retry: () => retryRef.current() });
    return () => register?.(id, null);
  }, [register, id, updatedAt]);
  return context && context.count > 1 ? null : <SavedDataNotice updatedAt={updatedAt} retry={retry} />;
}

function SavedDataNotice({
  updatedAt,
  retry,
  retryLabel = "Retry",
}: {
  /** Milliseconds since the last successful fetch (TanStack `dataUpdatedAt`). */
  updatedAt?: number | null;
  retry: () => void;
  retryLabel?: string;
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
          label={retryLabel}
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
  numeric?: boolean;
};
export const initialSortDirection = (column?: Column) => column?.numeric ? "desc" as const : "asc" as const;
export const accessLabel = (status: string) => ({ siteOwner: "Owner", siteFullUser: "Full", siteRestrictedUser: "Restricted", siteUnverifiedUser: "Unverified", access_removed: "Access removed" }[status] ?? status);
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
  // Programmatic th↔td association: on phones the thead is visually hidden, so cells
  // carry both a visible data-label and a headers reference to their column header.
  const tableId = useId();
  // Server mode: the endpoint sorted before LIMIT/OFFSET, so the note always spans the report.
  // Local mode: the server paged the report (date, then clicks) and the client only has this
  // page, so a sort reorders these rows. Say so where the user can see it rather than only in
  // the sr-only caption.
  const partial = total != null && total > rows.length;
  const sortNote = server
    ? sort
      ? `Sorted by ${columns.find((c) => c.sortKey === sort.key)?.label ?? sort.key} ${sort.dir === "desc" ? "descending" : "ascending"}, across all ${formatNumber(total ?? rows.length)} rows.`
      : null
    : localSort
      ? `Sorted by ${columns[localSort.index].label} ${localSort.desc ? "descending" : "ascending"}, ${
          partial
            ? `within this page of ${formatNumber(rows.length)} rows only — ${formatNumber(total)} rows in the whole report`
            : `across all ${formatNumber(rows.length)} rows`
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
      {server && (
        // Below 640px the thead (and its sort buttons) is visually hidden, so the
        // server sort needs a phone-visible control driving the same URL state.
        <div className="mb-2 flex flex-wrap items-center gap-2 sm:hidden">
          <label className="flex items-center gap-2 text-sm g-text-2">
            Sort by
            <select
              aria-label={`Sort ${caption} by`}
              className="h-9 rounded-full border bg-background px-3 text-sm text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
              value={sort?.key ?? ""}
              onChange={(e) => {
                onSort!(
                    e.target.value,
                    initialSortDirection(columns.find(c => c.sortKey === e.target.value)!),
                  );
              }}
            >
              <option value="">Default order</option>
              {columns
                .filter((c) => c.sortKey)
                .map((c) => (
                  <option key={c.sortKey} value={c.sortKey}>
                    {c.label}
                  </option>
                ))}
            </select>
          </label>
          <label className="flex items-center gap-2 text-sm g-text-2">
            Direction
            <select
              aria-label={`Sort direction for ${caption}`}
              className="h-9 rounded-full border bg-background px-3 text-sm text-foreground disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
              value={sort?.dir ?? "asc"}
              disabled={!sort}
              onChange={(e) =>
                sort &&
                onSort!(sort.key, e.target.value === "desc" ? "desc" : "asc")
              }
            >
              <option value="asc">Ascending</option>
              <option value="desc">Descending</option>
            </select>
          </label>
        </div>
      )}
      <table className="g-table g-table--report w-full text-sm">
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
                <th
                  key={c.label}
                  scope="col"
                  id={`${tableId}-h${index}`}
                  aria-sort={ariaSort}
                >
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
                            sort?.key === c.sortKey
                              ? sort.dir === "asc" ? "desc" : "asc"
                              : initialSortDirection(c),
                          );
                        } else {
                          setLocalSort({
                            index,
                            desc:
                              localSort?.index === index ? !localSort.desc : !!c.numeric,
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
              {columns.map((c, ci) => (
                <td
                  key={c.label}
                  headers={`${tableId}-h${ci}`}
                  data-label={c.label}
                  className="max-w-md break-words"
                >
                  {(typeof c.value(row) === "number" || (c.numeric && !c.sortValue)) ? formatNumber(c.value(row)) : c.value(row) ?? "Unavailable"}
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
            {typeof m.value === "number" ? formatNumber(m.value) : m.value ?? "Unavailable"}
          </dd>
        </div>
      ))}
    </dl>
  );
}
type TrendPeriod = { date: string; value: number | null; partial?: boolean };
/** Monday of the ISO week containing the YYYY-MM-DD date (UTC arithmetic). */
function weekStart(iso: string) {
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  const dow = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - dow);
  return d.toISOString().slice(0, 10);
}
/**
 * Valid points sorted by date. Ranges longer than ~90 days would be hundreds of daily
 * bars (and hundreds of Tab stops), so they aggregate to week buckets (starting Monday)
 * whose value is the sum of the daily values; each bucket is labelled "Week of …".
 * The span is judged against the SELECTED range (rangeStart/rangeEnd, when provided),
 * not only the days that happen to have data: widening the range asks for the long view
 * even where imported data covers fewer days.
 */
export function toTrendPeriods(
  rows: any[],
  value: (r: any) => any,
  date: (r: any) => string,
  rangeStart?: string,
  rangeEnd?: string,
): {
  periods: TrendPeriod[];
  weekly: boolean;
  firstDate: string;
  lastDate: string;
} {
  const valid = rows
    .filter((r) => value(r) != null && String(value(r)).trim() !== "" && Number.isFinite(Number(value(r))) && /^\d{4}-\d{2}-\d{2}$/.test(String(date(r))))
    .slice()
    .sort((a, b) => String(date(a)).localeCompare(String(date(b))));
  const firstDate = rangeStart || (valid.length ? String(date(valid[0])) : ""),
    lastDate = rangeEnd || (valid.length ? String(date(valid[valid.length - 1])) : "");
  const first = Date.parse(`${firstDate}T00:00:00Z`),
    last = Date.parse(`${lastDate}T00:00:00Z`);
  const weekly = last - first > 90 * 86400000;
  const byDay = new Map<string, number>();
  for (const r of valid) {
    const day = String(date(r));
    byDay.set(day, (byDay.get(day) ?? 0) + Number(value(r)));
  }
  const periods: TrendPeriod[] = [];
  // Report endpoints cap date ranges; also bound malformed caller input here.
  if (!Number.isFinite(first) || !Number.isFinite(last) || last < first || last - first > 3660 * 86400000)
    return { periods, weekly, firstDate, lastDate };
  for (let t = first; t <= last; t += 86400000) {
    const day = new Date(t).toISOString().slice(0, 10);
    const amount = byDay.get(day) ?? null;
    const label = weekly ? `Week of ${weekStart(day)}` : day;
    const previous = periods[periods.length - 1];
    if (weekly && previous?.date === label) {
      if (amount !== null) previous.value = (previous.value ?? 0) + amount;
      if (amount === null) previous.partial = true;
    } else {
      periods.push({ date: label, value: amount, ...(weekly ? { partial: amount === null || day !== weekStart(day) } : {}) });
    }
  }
  if (weekly && periods.length && new Date(`${lastDate}T00:00:00Z`).getUTCDay() !== 0)
    periods[periods.length - 1].partial = true;
  return { periods, weekly, firstDate, lastDate };
}
export function ReportTrend({
  rows,
  label,
  value,
  date,
  start,
  end,
}: {
  rows: any[];
  label: string;
  value: (r: any) => any;
  date: (r: any) => string;
  /** Selected range edges (YYYY-MM-DD): ranges over ~90 days render as weekly buckets. */
  start?: string;
  end?: string;
}) {
  const { periods, weekly, firstDate, lastDate } = toTrendPeriods(
    rows ?? [],
    value,
    date,
    start,
    end,
  );
  const max = Math.max(1, ...periods.map((p) => p.value ?? 0));
  const fmt = (n: number | null) => n === null ? "No imported data" : formatNumber(n);
  const describe = (p: TrendPeriod) => `${p.date}: ${fmt(p.value)}${p.partial && p.value !== null ? " (partial week)" : ""}`;
  // One Tab stop for the whole chart: only the selected bar sits in the tab order,
  // arrow keys move the selection (roving tabindex).
  const signature = JSON.stringify([start, end, periods]);
  const maximum = periods.reduce((best, p, i) => ((p.value ?? -Infinity) > (periods[best]?.value ?? -Infinity) ? i : best), 0);
  const [selection, setSelection] = useState({ signature, index: maximum });
  if (selection.signature !== signature) setSelection({ signature, index: maximum });
  // Equal refetch results preserve selection; changed periods/range select their new maximum.
  const selected = selection.signature === signature ? selection.index : maximum;
  const setSelected = (index: number) => setSelection({ signature, index });
  const listRef = useRef<HTMLDivElement>(null);
  const sel = Math.min(selected, periods.length - 1);
  useEffect(() => {
    const list = listRef.current;
    const bar = list?.querySelectorAll<HTMLButtonElement>("button[data-trend-index]")[sel];
    if (!list || !bar) return;
    // Scroll only the chart, never the surrounding page on load/refetch.
    const bounds = list.getBoundingClientRect(), target = bar.getBoundingClientRect();
    if (target.left < bounds.left || target.right > bounds.right) {
      list.scrollLeft += target.left - bounds.left - (list.clientWidth - target.width) / 2;
    }
  }, [signature, sel]);
  const focusBar = (i: number) =>
    listRef.current
      ?.querySelectorAll<HTMLButtonElement>("button[data-trend-index]")
      [i]?.focus();
  const move = (e: { key: string; preventDefault: () => void }, from: number) => {
    const step =
      e.key === "ArrowRight" || e.key === "ArrowDown"
        ? 1
        : e.key === "ArrowLeft" || e.key === "ArrowUp"
          ? -1
          : 0;
    const next =
      e.key === "Home"
        ? 0
        : e.key === "End"
          ? periods.length - 1
          : step
            ? Math.min(periods.length - 1, Math.max(0, from + step))
            : null;
    if (next == null) return;
    e.preventDefault();
    setSelected(next);
    focusBar(next);
  };
  if (!periods.length) return null;
  return (
    <figure className="rounded-xl border p-4">
      <figcaption className="mb-3 flex flex-wrap items-baseline justify-between gap-2 text-sm">
        <span>
          {label} · {weekly ? "weekly" : "daily"} periods
        </span>
        <span className="flex items-baseline gap-3">
          {/* Selected period stays visible without hover — tap/click or arrow to it. */}
          <span
            className="text-xs tabular-nums text-muted-foreground"
            data-testid="text-trend-selection"
            aria-live="polite"
          >
            {describe(periods[sel])}
          </span>
          {/* The labelled scale maximum: bar heights are shares of this number. */}
          <span
            className="text-xs tabular-nums text-muted-foreground"
            data-testid="text-trend-max"
          >
            Max {fmt(max)}
          </span>
        </span>
      </figcaption>
      <div
        ref={listRef}
        className="flex h-28 items-stretch gap-1 overflow-x-auto overflow-y-hidden"
        role="list"
        aria-label={label}
      >
        {periods.map((p, i) => (
          // The whole column is the control: it selects on tap/click, announces its
          // exact date and value, and shows the value chip while selected or hovered.
          <div key={i} role="listitem" className="relative min-w-[24px] flex-1">
            <button
              type="button"
              data-trend-index={i}
              tabIndex={i === sel ? 0 : -1}
              aria-pressed={i === sel}
              aria-label={describe(p)}
              title={describe(p)}
              onClick={() => setSelected(i)}
              onKeyDown={(e) => move(e, i)}
              className={`group absolute inset-0 w-full cursor-pointer rounded-sm hover:bg-primary/10 focus-visible:bg-primary/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary ${
                i === sel ? "bg-primary/15" : ""
              }`}
            >
              {p.value !== null && <span
                aria-hidden="true"
                className="pointer-events-none absolute inset-x-0 bottom-0 rounded-t-sm bg-primary/70"
                style={{ height: `${Math.max(1, (p.value / max) * 100)}%` }}
              />}
              <span
                aria-hidden="true"
                className="pointer-events-none absolute left-1/2 top-0 z-10 -translate-x-1/2 whitespace-nowrap rounded border bg-background px-1 text-[10px] tabular-nums text-foreground opacity-0 shadow-sm transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
              >
                {fmt(p.value)}
              </span>
            </button>
          </div>
        ))}
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        {firstDate} – {lastDate}.{" "}
        {weekly
          ? "Range over 90 days: each bar totals one week (starting Monday); partial weeks include only imported days. "
          : ""}
        Gaps mean no imported data, not zero. Scroll, tap or arrow to a bar to pin its date and value; exact values also in the
        table.
      </p>
    </figure>
  );
}
export const percent = (v: any) =>
  v == null ? null : `${formatNumber(Number(v) * 100, "Unavailable", 2)}%`;
export const position = (v: any) => (v == null ? null : formatNumber(v, "Unavailable", 1));
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
  { label: "Clicks", value: (r) => r.clicks, sortKey: "clicks", numeric: true },
  { label: "Impressions", value: (r) => r.impressions, sortKey: "impressions", numeric: true },
  { label: "CTR", value: (r) => percent(r.ctr), sortValue: (r) => r.ctr, sortKey: "ctr", numeric: true },
  {
    label: "Position",
    value: (r) => position(r.position),
    sortValue: (r) => r.position,
    sortKey: "position",
    numeric: true,
  },
];
export const cloudflareColumns: Record<string, Column[]> = {
  traffic: [
    {
      label: "Date (UTC)",
      value: (r) => r.dimensions?.date,
      sortKey: "date",
    },
    ...["requests", "pageViews", "threats"].map((k) => ({
      label:
        k === "pageViews"
          ? "Page views"
          : k === "requests"
            ? "Requests"
            : "Threats",
      value: (r: any) => r.sum?.[k],
      sortKey: k, numeric: true,
    })),
    {
      label: "Unique visitors",
      value: (r) => r.uniq?.uniques,
      sortKey: "uniques", numeric: true,
    },
  ],
  events: [
    ["Time", "datetime"],
    ["Action", "action"],
    ["IP address", "clientIP"],
    ["Country", "clientCountryName"],
    ["Path", "clientRequestPath"],
    ["Source", "source"],
  ].map(([label, key]) => ({ label, value: (r) => r[key], sortKey: key })),
  paths: [
    {
      label: "Path",
      value: (r) => r.dimensions?.clientRequestPath,
      sortKey: "clientRequestPath",
    },
    { label: "Requests (sampled)", value: (r) => r.count, sortKey: "count", numeric: true },
  ],
  bots: [
    {
      label: "Bot score",
      value: (r) => r.dimensions?.botScore,
      sortKey: "botScore", numeric: true,
    },
    { label: "Requests (sampled)", value: (r) => r.count, sortKey: "count", numeric: true },
  ],
  countries: [
    { label: "Country", value: (r) => r.country, sortKey: "country" },
    { label: "Requests", value: (r) => r.requests, sortKey: "requests", numeric: true },
    { label: "Threats", value: (r) => r.threats, sortKey: "threats", numeric: true },
  ],
};
export function sumKnown(rows: any[] | null | undefined, key: string) {
  if (!rows?.length || rows.some((r) => r.sum?.[key] == null)) return null;
  return rows.reduce((n, r) => n + Number(r.sum[key]), 0);
}
