import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle,
  AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction,
} from "@/components/ui/alert-dialog";
import {
  FileText, ReceiptText, Loader2, Search, Trash2, Pencil, type LucideIcon,
} from "lucide-react";
import {
  CrmPage, CrmPageHeader, StatusPill, EmptyState, ErrorCard, statusTone, crmTable,
} from "@/components/crm-ui";
import { InvoiceReceiptButton } from "@/components/crm-receipt";
import { InfoTip } from "@/components/info-tip";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, apiErrorMessage, queryClient } from "@/lib/queryClient";
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
  /** Estimates: what the client signed for (after optional discounts). */
  approvedTotalCents?: number | null;
  approvedAt?: string | null;
  createdAt: string | null;
  sentAt?: string | null;
  dueAt?: string | null;
  paidCents?: number;
  refundedCents?: number;
  overdue?: boolean;
  /** Estimates: derived server-side — out, unanswered, past its expiry. */
  expired?: boolean;
  customerName: string | null;
}

interface DocListResponse {
  rows: DocRow[];
  total: number;
  filtered: number;
  limit?: number;
  offset?: number;
}

/** Rows per page — the server pages (limit/offset), so big books stay light. */
const PAGE_SIZE = 100;

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
    subtitle: "Every estimate across the company — filter by status, date or client.",
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
    subtitle: "Every invoice across the company — filter by status, date or client.",
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
const RANGE_KEYS: RangeKey[] = ["any", "today", "7d", "30d", "custom"];
const SORT_KEYS = ["newest", "oldest", "largest"] as const;
const YMD = /^\d{4}-\d{2}-\d{2}$/;

/** The user's LOCAL calendar day as exact UTC instants. "Today" at 11pm in
 *  Oregon is still today — a bare YYYY-MM-DD would be read as a UTC day. */
const localDayStart = (y: number, m: number, d: number) => new Date(y, m, d, 0, 0, 0, 0).toISOString();
const localDayEnd = (y: number, m: number, d: number) => new Date(y, m, d, 23, 59, 59, 999).toISOString();
const ymdParts = (s: string): [number, number, number] | null => {
  if (!YMD.test(s)) return null;
  const [y, m, d] = s.split("-").map(Number);
  return [y, m - 1, d];
};

/**
 * Turn a preset (or the custom date inputs) into exact from/to instants for
 * the API. A custom range typed backwards is searched the right way round and
 * flagged, so the page can say so instead of silently showing nothing.
 */
function rangeDates(range: RangeKey, from: string, to: string): { from: string; to: string; swapped: boolean } {
  const now = new Date();
  const start = (d: Date) => localDayStart(d.getFullYear(), d.getMonth(), d.getDate());
  const end = (d: Date) => localDayEnd(d.getFullYear(), d.getMonth(), d.getDate());
  if (range === "today") return { from: start(now), to: end(now), swapped: false };
  if (range === "7d" || range === "30d") {
    const first = new Date(now);
    first.setDate(first.getDate() - (range === "7d" ? 7 : 30));
    return { from: start(first), to: end(now), swapped: false };
  }
  if (range === "custom") {
    const swapped = YMD.test(from) && YMD.test(to) && from > to;
    const [f, t] = swapped ? [to, from] : [from, to];
    const fp = ymdParts(f);
    const tp = ymdParts(t);
    return { from: fp ? localDayStart(...fp) : "", to: tp ? localDayEnd(...tp) : "", swapped };
  }
  return { from: "", to: "", swapped: false };
}

/** Filters live in the URL (?status=draft,sent&q=…) so a reload, the back
 *  button or a shared link lands on the same view. Read once, validated. */
function initialFilters(allowedStatuses: string[]) {
  let p: URLSearchParams;
  try { p = new URLSearchParams(window.location.search); } catch { p = new URLSearchParams(); }
  const range = p.get("range") as RangeKey | null;
  const sort = p.get("sort");
  const page = parseInt(p.get("page") ?? "", 10);
  return {
    statuses: new Set((p.get("status") ?? "").split(",").filter((s) => allowedStatuses.includes(s))),
    range: range && RANGE_KEYS.includes(range) ? range : "any",
    dateField: (p.get("field") === "sent" ? "sent" : "created") as "created" | "sent",
    from: YMD.test(p.get("from") ?? "") ? p.get("from")! : "",
    to: YMD.test(p.get("to") ?? "") ? p.get("to")! : "",
    sort: (SORT_KEYS as readonly string[]).includes(sort ?? "") ? sort as (typeof SORT_KEYS)[number] : "newest",
    q: (p.get("q") ?? "").slice(0, 200),
    page: Number.isFinite(page) && page > 0 ? page - 1 : 0, // 1-based in the URL
  };
}

const selectCls =
  "h-9 rounded-md border border-input bg-background px-2.5 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export function CrmDocumentsPage({ kind, actions }: { kind: "estimates" | "invoices"; actions?: React.ReactNode }) {
  const cfg = CONFIG[kind];
  const [, setLocation] = useLocation();
  const { data: me } = useQuery<any>({ queryKey: ["/api/crm/me"] });
  const allowed = !cfg.needsPrices || me?.permissions?.seePrices === true;
  const canReceipt = cfg.hasDueColumn === true && me?.permissions?.manageInvoices === true;
  const { toast } = useToast();

  // Hard delete is OWNER-only (the server enforces it; the button simply
  // doesn't render for anyone else). One shared confirm dialog names the
  // exact document and the consequence before anything is deleted.
  const isOwner = me?.member?.role === "owner";
  const [delFor, setDelFor] = useState<DocRow | null>(null);
  const del = useMutation({
    mutationFn: async (id: string) => (await apiRequest("DELETE", `${cfg.endpoint}/${id}`)).json(),
    onSuccess: () => {
      setDelFor(null);
      queryClient.invalidateQueries({
        predicate: (q) => String(q.queryKey[0]).startsWith(cfg.endpoint),
      });
      toast({ title: `${kind === "estimates" ? "Estimate" : "Invoice"} deleted` });
    },
    onError: (e: any) => {
      setDelFor(null);
      toast({ title: "Could not delete", description: apiErrorMessage(e), variant: "destructive" });
    },
  });

  const [init] = useState(() => initialFilters(cfg.statuses.map((s) => s.key)));
  const [selected, setSelected] = useState<Set<string>>(init.statuses);
  const [range, setRange] = useState<RangeKey>(init.range);
  const [dateField, setDateField] = useState<"created" | "sent">(init.dateField);
  const [fromInput, setFromInput] = useState(init.from);
  const [toInput, setToInput] = useState(init.to);
  const [sort, setSort] = useState<"newest" | "oldest" | "largest">(init.sort);
  const [qInput, setQInput] = useState(init.q);
  const [q, setQ] = useState(init.q.trim());
  const [page, setPage] = useState(init.page);

  // Debounce the search box so a fast typist doesn't fire a query per key.
  useEffect(() => {
    const t = setTimeout(() => setQ(qInput.trim()), 300);
    return () => clearTimeout(t);
  }, [qInput]);

  // Any filter change starts over at page 1 (but a page from the URL on first
  // load is kept).
  const filterKey = [[...selected].sort().join(","), range, dateField, fromInput, toInput, sort, q].join("|");
  const lastFilterKey = useRef(filterKey);
  useEffect(() => {
    if (lastFilterKey.current !== filterKey) {
      lastFilterKey.current = filterKey;
      setPage(0);
    }
  }, [filterKey]);

  // Mirror the view into the URL (replaceState — no history spam per click).
  useEffect(() => {
    const p = new URLSearchParams();
    if (selected.size) p.set("status", [...selected].join(","));
    if (range !== "any") p.set("range", range);
    if (range === "custom" && fromInput) p.set("from", fromInput);
    if (range === "custom" && toInput) p.set("to", toInput);
    if (dateField !== "created") p.set("field", dateField);
    if (sort !== "newest") p.set("sort", sort);
    if (q) p.set("q", q);
    if (page > 0) p.set("page", String(page + 1));
    const qs = p.toString();
    const next = `${window.location.pathname}${qs ? `?${qs}` : ""}`;
    if (next !== `${window.location.pathname}${window.location.search}`) {
      try { window.history.replaceState(window.history.state, "", next); } catch { /* sandboxed — ignore */ }
    }
  }, [selected, range, fromInput, toInput, dateField, sort, q, page]);

  const dates = rangeDates(range, fromInput, toInput);
  const queryString = useMemo(() => {
    const p = new URLSearchParams();
    p.set("sort", sort);
    p.set("dateField", dateField);
    if (selected.size) p.set("status", [...selected].join(","));
    if (dates.from) p.set("from", dates.from);
    if (dates.to) p.set("to", dates.to);
    if (q) p.set("q", q);
    p.set("limit", String(PAGE_SIZE));
    p.set("offset", String(page * PAGE_SIZE));
    return p.toString();
  }, [sort, dateField, selected, dates.from, dates.to, q, page]);

  const { data, isLoading, isError } = useQuery<DocListResponse>({
    queryKey: [`${cfg.endpoint}?${queryString}`],
    enabled: allowed,
    // Keep the table on screen while the next page loads (same list only).
    placeholderData: (prev, prevQuery) =>
      String(prevQuery?.queryKey?.[0] ?? "").startsWith(`${cfg.endpoint}?`) ? prev : undefined,
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
        <CrmPageHeader icon={cfg.icon} title={cfg.title} infoKey={kind} />
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

  const shown = data?.rows ?? [];
  const filteredCount = data?.filtered ?? 0;
  const firstShown = shown.length ? page * PAGE_SIZE + 1 : 0;
  const lastShown = page * PAGE_SIZE + shown.length;
  const hasPrev = page > 0;
  const hasNext = lastShown < filteredCount;
  // Where a row goes: an estimate opens its own page (detail/edit/resend);
  // invoices have no detail page, so they open the client's.
  const rowHref = (r: DocRow) => (kind === "estimates" ? `/crm/estimates/${r.id}` : `/crm/clients/${r.customerId}`);

  return (
    <CrmPage wide>
      <CrmPageHeader icon={cfg.icon} title={cfg.title} subtitle={cfg.subtitle} actions={actions} infoKey={kind} />

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
                      aria-invalid={dates.swapped}
                    />
                    <span className="text-sm text-muted-foreground">to</span>
                    <Input
                      type="date"
                      data-testid="input-date-to"
                      value={toInput}
                      onChange={(e) => setToInput(e.target.value)}
                      className="h-9 w-[150px]"
                      aria-label="To date"
                      aria-invalid={dates.swapped}
                    />
                  </>
                )}
              </div>
              {range === "custom" && dates.swapped && (
                <p className="text-xs text-amber-700 dark:text-amber-400" role="status" data-testid="text-date-swapped">
                  "From" is after "To" — showing {day(`${toInput}T12:00:00`)} to {day(`${fromInput}T12:00:00`)} instead.
                </p>
              )}
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
                  placeholder="Number or client name…"
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
        {(hasPrev || hasNext) && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground" data-testid="doc-pager">
            <span data-testid="text-page-range">Showing {firstShown}–{lastShown} of {filteredCount}</span>
            <Button variant="outline" size="sm" className="h-8" disabled={!hasPrev}
              onClick={() => setPage((p) => Math.max(0, p - 1))} data-testid="button-page-prev">
              Previous
            </Button>
            <Button variant="outline" size="sm" className="h-8" disabled={!hasNext}
              onClick={() => setPage((p) => p + 1)} data-testid="button-page-next">
              Next
            </Button>
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
                  : filteredCount > 0
                    ? "That page is past the end of the list — go back a page."
                    : "Nothing matches those filters — widen the status or date range."
              }
              compact
            />
            {filteredCount > 0 && page > 0 && (
              <div className="flex justify-center pb-4">
                <Button variant="outline" size="sm" onClick={() => setPage(0)} data-testid="button-page-first">
                  Back to page 1
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className={crmTable.wrapper}>
          <table className={crmTable.table}>
            <thead className={crmTable.thead}>
              <tr>
                <th className={crmTable.th}>Number</th>
                {/* Below sm the client name rides under the number, so the
                    Total column stays on screen at phone width. */}
                <th className={cn(crmTable.th, "hidden sm:table-cell")}>Client</th>
                <th className={cn(crmTable.th, "hidden md:table-cell")}>Title</th>
                <th className={cn(crmTable.th, "hidden sm:table-cell")}>Status</th>
                <th className={crmTable.thRight}>Total</th>
                <th className={cn(crmTable.th, "hidden sm:table-cell")}>
                  {dateField === "sent" ? "Sent" : "Created"}
                </th>
                {cfg.hasDueColumn && (
                  <th className={cn(crmTable.th, "hidden sm:table-cell")}>Due</th>
                )}
                {cfg.hasDueColumn && <th className={crmTable.th}></th>}
                {(isOwner || kind === "estimates") && (
                  <th className={cn(crmTable.thRight, !isOwner && "hidden sm:table-cell")} aria-label="Actions" />
                )}
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => {
                // An approved estimate's figure is what the client SIGNED for
                // (after any optional discounts) — the invoice, contract and
                // pay link all use it.
                const signed = kind === "estimates" && r.approvedAt && r.approvedTotalCents != null
                  ? r.approvedTotalCents : null;
                // Below sm the pill rides in the number cell (its own column
                // is hidden) so Number · Total · actions fit a phone.
                const statusPill = r.overdue ? (
                  <StatusPill tone="danger">Overdue</StatusPill>
                ) : r.expired && r.status !== "expired" ? (
                  <StatusPill tone={statusTone("expired")}>expired</StatusPill>
                ) : (
                  <StatusPill tone={statusTone(r.status)}>{r.status}</StatusPill>
                );
                return (
                <tr
                  key={r.id}
                  data-testid={`doc-row-${r.id}`}
                  onClick={() => setLocation(rowHref(r))}
                  className={cn(crmTable.tr, "cursor-pointer")}
                >
                  <td className={crmTable.td}>
                    <Link
                      href={rowHref(r)}
                      data-testid={`doc-link-${r.id}`}
                      className="font-medium text-primary hover:underline whitespace-nowrap"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {r.number ?? "—"}
                    </Link>
                    <div className="sm:hidden text-xs text-muted-foreground truncate max-w-[9rem]">
                      {r.customerName ?? "—"}
                    </div>
                    <div className="sm:hidden mt-1">{statusPill}</div>
                  </td>
                  <td className={cn(crmTable.td, "hidden sm:table-cell")}>
                    {kind === "estimates" ? (
                      <Link
                        href={`/crm/clients/${r.customerId}`}
                        className="hover:underline"
                        data-testid={`doc-client-link-${r.id}`}
                        onClick={(e) => e.stopPropagation()}
                      >
                        {r.customerName ?? "—"}
                      </Link>
                    ) : (r.customerName ?? "—")}
                  </td>
                  <td className={cn(crmTable.td, "hidden md:table-cell max-w-[260px] truncate")}>
                    {r.title}
                  </td>
                  <td className={cn(crmTable.td, "hidden sm:table-cell")}>{statusPill}</td>
                  <td className={cn(crmTable.tdRight, "whitespace-nowrap")}>
                    {money(signed ?? r.totalCents)}
                    {signed != null && signed !== r.totalCents && (
                      <div className="hidden sm:block text-xs text-muted-foreground" title="Signed total after the client's optional discounts">
                        signed · quoted {money(r.totalCents)}
                      </div>
                    )}
                    {(r.refundedCents ?? 0) > 0 && <div className="text-xs text-muted-foreground">{money(r.refundedCents)} refunded</div>}
                  </td>
                  <td className={cn(crmTable.td, "hidden sm:table-cell text-muted-foreground")}>
                    {day(dateField === "sent" ? r.sentAt : r.createdAt)}
                  </td>
                  {cfg.hasDueColumn && (
                    <td className={cn(crmTable.td, "hidden sm:table-cell text-muted-foreground")}>
                      {day(r.dueAt)}
                    </td>
                  )}
                  {cfg.hasDueColumn && (
                    <td className={cn(crmTable.td, "text-right")} onClick={(e) => e.stopPropagation()}>
                      {canReceipt && ((r.paidCents ?? 0) > 0 || (r.refundedCents ?? 0) > 0) && (
                        <InvoiceReceiptButton invoiceId={r.id} invoiceNumber={r.number} />
                      )}
                    </td>
                  )}
                  {(isOwner || kind === "estimates") && (
                    <td className={cn(crmTable.tdRight, !isOwner && "hidden sm:table-cell")} onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-end gap-1">
                        {/* Estimates open their detail/edit page — edit scope
                            text, resend, or (owner) delete from there. */}
                        {/* The row itself opens the estimate on a phone. */}
                        {kind === "estimates" && (
                          <Link href={`/crm/estimates/${r.id}`} className="hidden sm:inline-flex">
                            <Button
                              variant="ghost"
                              size="sm"
                              data-testid={`button-open-doc-${r.id}`}
                              aria-label={`Open estimate ${r.number ?? ""}`}
                            >
                              <Pencil className="h-4 w-4 mr-1" /> Open
                            </Button>
                          </Link>
                        )}
                        {/* A signed (approved) estimate is a contract — the
                            server refuses to delete it, so no button. */}
                        {isOwner && !(kind === "estimates" && (r.approvedAt || r.status === "approved")) && (
                          <Button
                            variant="ghost"
                            size="sm"
                            data-testid={`button-delete-doc-${r.id}`}
                            aria-label={`Delete ${r.number ?? "document"}`}
                            onClick={() => setDelFor(r)}
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        )}
                      </div>
                    </td>
                  )}
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Owner-only hard delete: names the exact document and what goes with it. */}
      <AlertDialog open={!!delFor} onOpenChange={(o) => { if (!o) setDelFor(null); }}>
        <AlertDialogContent data-testid="dialog-delete-doc">
          <AlertDialogHeader>
            <AlertDialogTitle>
              <span className="inline-flex items-center gap-1">
                Delete {kind === "estimates" ? "estimate" : "invoice"} {delFor?.number ?? ""}?
                <InfoTip k="owner-delete" />
              </span>
            </AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes {delFor?.number ?? "this document"}
              {delFor?.title ? ` ("${delFor.title}")` : ""}
              {delFor?.customerName ? ` for ${delFor.customerName}` : ""}
              {kind === "estimates"
                ? ", with all of its line items, options, discounts and history"
                : ", with all of its line items"}
              . This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete-doc">Cancel</AlertDialogCancel>
            <AlertDialogAction
              data-testid="button-confirm-delete-doc"
              onClick={() => { if (delFor) del.mutate(delFor.id); }}
            >
              Delete permanently
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </CrmPage>
  );
}
