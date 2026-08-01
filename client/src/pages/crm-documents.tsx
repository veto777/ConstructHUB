import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  FileText, ReceiptText, Loader2, Search, type LucideIcon,
} from "lucide-react";
import {
  CrmPage, CrmPageHeader, StatusPill, EmptyState, ErrorCard, statusTone, crmTable,
} from "@/components/crm-ui";
import { cn } from "@/lib/utils";

/**
 * The Documents Center — one org-wide list for estimates and one for invoices,
 * with the filtering Housecall Pro users beg for: checkbox multi-status,
 * created/sent date ranges (presets or custom), number/customer search and
 * sort. The server does the filtering (see entities.ts parseDocQuery); this
 * component is shared by /crm/estimates and /crm/invoices, which differ only
 * in the config below.
 */

export interface DocRow {
  id: string;
  customerId: string;
  number: string | null;
  title: string;
  status: string;
  totalCents?: number;
  createdAt: string | null;
  sentAt?: string | null;
  dueAt?: string | null;
  paidCents?: number;
  overdue?: boolean;
  customerName: string | null;
}

interface DocListResponse {
  rows: DocRow[];
  total: number;
  filtered: number;
}

interface DocKindConfig {
  endpoint: string;
  title: string;
  icon: LucideIcon;
  subtitle: string;
  statuses: { key: string; label: string }[];
  /** Invoices carry money — the list endpoint requires seePrices. */
  needsPrices?: boolean;
  hasDueColumn?: boolean;
}

const CONFIG: Record<"estimates" | "invoices", DocKindConfig> = {
  estimates: {
    endpoint: "/api/crm/estimates",
    title: "Estimates",
    icon: FileText,
    subtitle: "Every estimate across the company — filter by status, date or customer.",
    statuses: [
      { key: "draft", label: "Draft" },
      { key: "sent", label: "Sent" },
      { key: "viewed", label: "Viewed" },
      { key: "approved", label: "Approved" },
      { key: "declined", label: "Declined" },
      { key: "expired", label: "Expired" },
    ],
  },
  invoices: {
    endpoint: "/api/crm/invoices",
    title: "Invoices",
    icon: ReceiptText,
    subtitle: "Every invoice across the company — filter by status, date or customer.",
    needsPrices: true,
    hasDueColumn: true,
    statuses: [
      { key: "draft", label: "Draft" },
      { key: "sent", label: "Sent" },
      { key: "partial", label: "Partial" },
      { key: "paid", label: "Paid" },
      { key: "void", label: "Void" },
      { key: "overdue", label: "Overdue" },
    ],
  },
};

const money = (c?: number | null) =>
  c == null ? "—" : `$${(c / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })}`;
const day = (d?: string | null) => (d ? new Date(d).toLocaleDateString() : "—");

type RangeKey = "any" | "today" | "7d" | "30d" | "custom";

/** Turn a preset into concrete from/to dates (custom uses the date inputs). */
function rangeDates(range: RangeKey, from: string, to: string): { from: string; to: string } {
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const now = new Date();
  if (range === "today") return { from: iso(now), to: iso(now) };
  if (range === "7d" || range === "30d") {
    const start = new Date(now);
    start.setDate(start.getDate() - (range === "7d" ? 7 : 30));
    return { from: iso(start), to: iso(now) };
  }
  if (range === "custom") return { from, to };
  return { from: "", to: "" };
}

const selectCls =
  "h-9 rounded-md border border-input bg-background px-2.5 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export function CrmDocumentsPage({ kind }: { kind: "estimates" | "invoices" }) {
  const cfg = CONFIG[kind];
  const [, setLocation] = useLocation();
  const { data: me } = useQuery<any>({ queryKey: ["/api/crm/me"] });
  const allowed = !cfg.needsPrices || me?.permissions?.seePrices === true;

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [range, setRange] = useState<RangeKey>("any");
  const [dateField, setDateField] = useState<"created" | "sent">("created");
  const [fromInput, setFromInput] = useState("");
  const [toInput, setToInput] = useState("");
  const [sort, setSort] = useState<"newest" | "oldest" | "largest">("newest");
  const [qInput, setQInput] = useState("");
  const [q, setQ] = useState("");

  // Debounce the search box so a fast typist doesn't fire a query per key.
  useEffect(() => {
    const t = setTimeout(() => setQ(qInput.trim()), 300);
    return () => clearTimeout(t);
  }, [qInput]);

  const queryString = useMemo(() => {
    const p = new URLSearchParams();
    p.set("sort", sort);
    p.set("dateField", dateField);
    if (selected.size) p.set("status", [...selected].join(","));
    const { from, to } = rangeDates(range, fromInput, toInput);
    if (from) p.set("from", from);
    if (to) p.set("to", to);
    if (q) p.set("q", q);
    return p.toString();
  }, [sort, dateField, selected, range, fromInput, toInput, q]);

  const { data, isLoading, isError } = useQuery<DocListResponse>({
    queryKey: [`${cfg.endpoint}?${queryString}`],
    enabled: allowed,
  });

  const toggleStatus = (key: string, on: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(key);
      else next.delete(key);
      return next;
    });
  };

  if (cfg.needsPrices && me && !allowed) {
    return (
      <CrmPage>
        <CrmPageHeader icon={cfg.icon} title={cfg.title} />
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">
            You don't have permission to see invoices. Ask an owner or admin.
          </CardContent>
        </Card>
      </CrmPage>
    );
  }

  if (isError) {
    return (
      <ErrorCard
        title={`Couldn't load ${cfg.title.toLowerCase()}`}
        description="Check your connection and refresh the page."
      />
    );
  }

  const rows = data?.rows ?? [];
  const shown = rows.slice(0, 100);

  return (
    <CrmPage wide>
      <CrmPageHeader icon={cfg.icon} title={cfg.title} subtitle={cfg.subtitle} />

      <Card>
        <CardContent className="p-4 sm:p-5 space-y-4">
          {/* Status checkboxes — multi-select, they combine (OR). */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2" data-testid="filter-statuses">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Status
            </span>
            {cfg.statuses.map((s) => (
              <label
                key={s.key}
                className="inline-flex items-center gap-1.5 text-sm cursor-pointer select-none"
              >
                <input
                  type="checkbox"
                  data-testid={`filter-status-${s.key}`}
                  checked={selected.has(s.key)}
                  onChange={(e) => toggleStatus(s.key, e.target.checked)}
                  className="h-4 w-4 rounded border-input accent-primary"
                />
                {s.label}
              </label>
            ))}
          </div>

          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Date
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <select
                  data-testid="select-date-field"
                  value={dateField}
                  onChange={(e) => setDateField(e.target.value as "created" | "sent")}
                  className={selectCls}
                  aria-label="Date field"
                >
                  <option value="created">Created</option>
                  <option value="sent">Sent</option>
                </select>
                <select
                  data-testid="select-date-range"
                  value={range}
                  onChange={(e) => setRange(e.target.value as RangeKey)}
                  className={selectCls}
                  aria-label="Date range"
                >
                  <option value="any">Any time</option>
                  <option value="today">Today</option>
                  <option value="7d">Last 7 days</option>
                  <option value="30d">Last 30 days</option>
                  <option value="custom">Custom range</option>
                </select>
                {range === "custom" && (
                  <>
                    <Input
                      type="date"
                      data-testid="input-date-from"
                      value={fromInput}
                      onChange={(e) => setFromInput(e.target.value)}
                      className="h-9 w-[150px]"
                      aria-label="From date"
                    />
                    <span className="text-sm text-muted-foreground">to</span>
                    <Input
                      type="date"
                      data-testid="input-date-to"
                      value={toInput}
                      onChange={(e) => setToInput(e.target.value)}
                      className="h-9 w-[150px]"
                      aria-label="To date"
                    />
                  </>
                )}
              </div>
            </div>

            <div className="space-y-1">
              <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Sort
              </div>
              <select
                data-testid="select-sort"
                value={sort}
                onChange={(e) => setSort(e.target.value as typeof sort)}
                className={selectCls}
                aria-label="Sort order"
              >
                <option value="newest">Newest first</option>
                <option value="oldest">Oldest first</option>
                <option value="largest">Largest first</option>
              </select>
            </div>

            <div className="space-y-1 flex-1 min-w-[200px]">
              <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Search
              </div>
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  data-testid="input-search"
                  value={qInput}
                  onChange={(e) => setQInput(e.target.value)}
                  placeholder="Number or customer name…"
                  className="h-9 pl-8"
                />
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="flex items-center justify-between gap-2">
        <div className="text-sm text-muted-foreground" data-testid="text-count-summary">
          {data ? `${data.filtered} of ${data.total}` : "…"}
        </div>
        {rows.length > shown.length && (
          <div className="text-xs text-muted-foreground">
            Showing the first {shown.length} — narrow the filters to see the rest.
          </div>
        )}
      </div>

      {isLoading || !data ? (
        <div className="flex justify-center p-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : shown.length === 0 ? (
        <Card data-testid="empty-docs">
          <CardContent className="p-0">
            <EmptyState
              icon={cfg.icon}
              title={data.total === 0 ? `No ${cfg.title.toLowerCase()} yet` : "No matches"}
              description={
                data.total === 0
                  ? `${cfg.title} you create for a client also show up here.`
                  : "Nothing matches those filters — widen the status or date range."
              }
              compact
            />
          </CardContent>
        </Card>
      ) : (
        <div className={crmTable.wrapper}>
          <table className={crmTable.table}>
            <thead className={crmTable.thead}>
              <tr>
                <th className={crmTable.th}>Number</th>
                <th className={crmTable.th}>Customer</th>
                <th className={cn(crmTable.th, "hidden md:table-cell")}>Title</th>
                <th className={crmTable.th}>Status</th>
                <th className={crmTable.thRight}>Total</th>
                <th className={cn(crmTable.th, "hidden sm:table-cell")}>
                  {dateField === "sent" ? "Sent" : "Created"}
                </th>
                {cfg.hasDueColumn && (
                  <th className={cn(crmTable.th, "hidden sm:table-cell")}>Due</th>
                )}
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr
                  key={r.id}
                  data-testid={`doc-row-${r.id}`}
                  onClick={() => setLocation(`/crm/clients/${r.customerId}`)}
                  className={cn(crmTable.tr, "cursor-pointer")}
                >
                  <td className={crmTable.td}>
                    <Link
                      href={`/crm/clients/${r.customerId}`}
                      data-testid={`doc-link-${r.id}`}
                      className="font-medium text-primary hover:underline"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {r.number ?? "—"}
                    </Link>
                  </td>
                  <td className={crmTable.td}>{r.customerName ?? "—"}</td>
                  <td className={cn(crmTable.td, "hidden md:table-cell max-w-[260px] truncate")}>
                    {r.title}
                  </td>
                  <td className={crmTable.td}>
                    {r.overdue ? (
                      <StatusPill tone="danger">Overdue</StatusPill>
                    ) : (
                      <StatusPill tone={statusTone(r.status)}>{r.status}</StatusPill>
                    )}
                  </td>
                  <td className={crmTable.tdRight}>{money(r.totalCents)}</td>
                  <td className={cn(crmTable.td, "hidden sm:table-cell text-muted-foreground")}>
                    {day(dateField === "sent" ? r.sentAt : r.createdAt)}
                  </td>
                  {cfg.hasDueColumn && (
                    <td className={cn(crmTable.td, "hidden sm:table-cell text-muted-foreground")}>
                      {day(r.dueAt)}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </CrmPage>
  );
}
