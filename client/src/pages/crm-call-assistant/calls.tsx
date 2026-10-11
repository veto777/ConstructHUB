import { Toolbar } from "@/components/app-ui";
import { SegmentedTabs, TabCount } from "@/components/tool";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { PhoneIncoming, ShieldAlert, ShieldBan, BellRing, Mic, ChevronLeft, ChevronRight, Info, RefreshCw } from "lucide-react";
import { EmptyState, StatusPill, crmTable, crmTableCards } from "@/components/crm-ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { apiRequest, apiErrorMessage } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { CALL_ASSISTANT_SPAM } from "@shared/plan-copy";
import { CALL_ASSISTANT_FREE_SPAM_CALLS } from "@shared/plans";
import { CallDetailSheet, EscalationRow } from "./calls-detail";
import { CallResults } from "./results";
import {
  OUTCOME_LABELS, outcomeLabel, outcomeTone, fmtPhone, fmtDuration, fmtWhen, fmtUpdated, LIVE_REFRESH_MS,
  type VoiceCallList, type VoiceCallListRow, type VoiceEscalationList, type VoiceSpamEntry, type EscalationReminders,
} from "./calls-shared";

/**
 * Calls tab — the log (outcome, summary, transcript, recording player, linked
 * client), the spam view (spam/blocked calls + the per-number ledger with
 * block/unblock) and the escalations with their reminder state. OWNER:
 * calls+crm lane (LANES.md). API: /api/crm/voice/calls*, /spam*,
 * /escalations* (server/voice/calls.ts).
 *
 * Deep link: /call-assistant?tab=calls&call=<id> opens that call's
 * drawer (the link every call notification carries); &view=spam|escalations
 * opens a sub-view.
 *
 * Live: the log, the spam view and the escalations refetch every 30 s while
 * the tab is visible (LIVE_REFRESH_MS; react-query pauses in a background
 * tab), each says when it was last updated and has a Refresh button, and a
 * block/unblock refreshes every list it changes.
 */
const VIEWS = ["log", "spam", "escalations"] as const;
type View = (typeof VIEWS)[number];
const PAGE_SIZE = 25;

function readParam(name: string): string | null {
  return new URLSearchParams(window.location.search).get(name);
}

/** Keep ?call= and ?view= in the URL without a navigation (the shell owns ?tab=). */
function writeParams(patch: Record<string, string | null>) {
  const url = new URL(window.location.href);
  for (const [k, v] of Object.entries(patch)) {
    if (v) url.searchParams.set(k, v);
    else url.searchParams.delete(k);
  }
  window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}`);
}

export function CallsPanel({ canManage }: { canManage: boolean }) {
  const [view, setView] = useState<View>(() => {
    const v = readParam("view");
    return (VIEWS as readonly string[]).includes(v ?? "") ? (v as View) : "log";
  });
  const [openCall, setOpenCall] = useState<string | null>(() => readParam("call"));
  // The log's outcome filter lives here so a Results tile can set it (?outcome= deep-links it from the Overview).
  const [outcome, setOutcome] = useState<string>(() => {
    const o = readParam("outcome");
    return o && o in OUTCOME_LABELS && o !== "spam" && o !== "blocked" ? o : "all";
  });
  const openEscalations = useQuery<VoiceEscalationList>({ queryKey: ["/api/crm/voice/escalations?open=1"], refetchInterval: LIVE_REFRESH_MS });
  const openCount = openEscalations.data?.escalations.length ?? 0;
  const spam = useQuery<SpamLedger>({ queryKey: ["/api/crm/voice/spam"], refetchInterval: LIVE_REFRESH_MS });
  const spamThisMonth = spam.data?.thisMonth?.spamCalls ?? 0;

  const show = (id: string | null) => {
    setOpenCall(id);
    writeParams({ call: id });
  };
  const pick = (v: View) => {
    setView(v);
    writeParams({ view: v === "log" ? null : v });
  };

  return (
    <div data-testid="panel-call-assistant-calls" className="space-y-4 pt-4">
      <CallResults onPick={(p) => {
        if (p === "spam") { pick("spam"); return; }
        pick("log");
        setOutcome(p);
        writeParams({ outcome: p });
      }} />
      <SegmentedTabs as="tablist" label="Calls views">
        <ViewButton active={view === "log"} onClick={() => pick("log")} testId="button-calls-view-log" icon={PhoneIncoming}>Calls</ViewButton>
        <ViewButton active={view === "spam"} onClick={() => pick("spam")} testId="button-calls-view-spam" icon={ShieldBan}>
          Spam blocked
          {spamThisMonth > 0 && (
            <TabCount testId="badge-spam-this-month">{spamThisMonth}</TabCount>
          )}
        </ViewButton>
        <ViewButton active={view === "escalations"} onClick={() => pick("escalations")} testId="button-calls-view-escalations" icon={BellRing}>
          Escalations
          {openCount > 0 && (
            <TabCount testId="badge-open-escalations">{openCount}</TabCount>
          )}
        </ViewButton>
      </SegmentedTabs>

      {view === "log" && <CallLog onOpen={show} outcome={outcome} setOutcome={(o) => { setOutcome(o); writeParams({ outcome: o === "all" ? null : o }); }} />}
      {view === "spam" && <SpamView canManage={canManage} onOpen={show} />}
      {view === "escalations" && <EscalationsView onOpen={show} />}

      <CallDetailSheet callId={openCall} onClose={() => show(null)} />
    </div>
  );
}

function ViewButton({ active, onClick, testId, icon: Icon, children }: {
  active: boolean; onClick: () => void; testId: string; icon: typeof PhoneIncoming; children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      data-testid={testId}
    >
      <Icon aria-hidden="true" />
      {children}
    </button>
  );
}

/**
 * "Updated 2:41:05 PM · Refresh" for a live view. `queries` are the view's react-query results; the stamp is the
 * oldest of their last successful fetches (what the screen can vouch for), Refresh refetches them all.
 */
function LiveStamp({ queries, testId }: { queries: { dataUpdatedAt: number; isFetching: boolean; refetch: () => unknown }[]; testId: string }) {
  const stamps = queries.map((q) => q.dataUpdatedAt).filter((t) => t > 0);
  const updated = fmtUpdated(stamps.length === queries.length ? Math.min(...stamps) : 0);
  const fetching = queries.some((q) => q.isFetching);
  return (
    <div className="flex items-center justify-end gap-2 text-xs text-muted-foreground" data-testid={testId}>
      <span role="status" aria-live="polite" data-testid={`${testId}-text`}>
        {fetching ? "Updating…" : updated ? `Updated ${updated}` : ""}
      </span>
      <Button
        type="button" variant="ghost" size="sm" className="h-7 px-2"
        onClick={() => queries.forEach((q) => q.refetch())}
        disabled={fetching}
        data-testid={`${testId}-refresh`}
      >
        <RefreshCw className={cn("h-3.5 w-3.5 mr-1", fetching && "animate-spin")} aria-hidden="true" />
        Refresh
      </Button>
    </div>
  );
}

/** Every call list (log, spam, the overview's recent calls) and the call drawers. */
const isCallsQuery = (q: { queryKey: readonly unknown[] }) => String(q.queryKey[0]).startsWith("/api/crm/voice/calls");

/** Debounced value for the search box (the list refetches on the settled text only). */
function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

function callsUrl(params: Record<string, string | number | undefined>): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") qs.set(k, String(v));
  return `/api/crm/voice/calls?${qs.toString()}`;
}

function CallLog({ onOpen, outcome, setOutcome }: { onOpen: (id: string) => void; outcome: string; setOutcome: (o: string) => void }) {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const q = useDebounced(search.trim());
  useEffect(() => setPage(1), [q, outcome]);
  const url = useMemo(
    () => callsUrl({ q: q || undefined, outcome: outcome === "all" ? undefined : outcome, page, limit: PAGE_SIZE }),
    [q, outcome, page],
  );
  const list = useQuery<VoiceCallList>({ queryKey: [url], refetchInterval: LIVE_REFRESH_MS });
  const filtered = !!q || outcome !== "all";

  return (
    <section className="space-y-3" aria-labelledby="calls-log-title">
      <h2 id="calls-log-title" className="sr-only">Call log</h2>
      <Toolbar search={{ value: search, onChange: setSearch, placeholder: "Search calls", testId: "input-calls-search" }} activeFilters={outcome === "all" ? 0 : 1} filters={(
          <Select value={outcome} onValueChange={setOutcome}>
            <SelectTrigger id="calls-outcome" data-testid="select-calls-outcome"><SelectValue placeholder="All outcomes" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All outcomes (no spam)</SelectItem>
              {Object.entries(OUTCOME_LABELS).filter(([k]) => k !== "spam" && k !== "blocked").map(([k, label]) => (
                <SelectItem key={k} value={k}>{label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
      )} />
      <LiveStamp queries={[list]} testId="calls-log-updated" />

      {list.isLoading ? (
        <TableSkeleton />
      ) : list.isError ? (
        <InlineError title="Couldn't load the call log" error={list.error} onRetry={() => list.refetch()} />
      ) : !list.data?.calls.length ? (
        <EmptyState
          icon={PhoneIncoming}
          title={filtered ? "No calls match" : "No calls yet"}
          description={filtered
            ? "Try a different search or outcome."
            : "Once your number is forwarded and the assistant is live, every call shows up here with its outcome, summary, transcript and recording."}
        />
      ) : (
        <>
          <CallsTable calls={list.data.calls} onOpen={onOpen} testId="table-calls" numberHint={CALL_NO_HINT_LOG} />
          <Pager page={list.data.page} limit={list.data.limit} total={list.data.total} onPage={setPage} />
        </>
      )}
    </section>
  );
}

/** Why the call numbers skip (callNo is per account, in arrival order, spam included — server/voice/schema.ts). */
export const CALL_NO_HINT_LOG = "Every call gets the next number in the order it came in, spam included. Spam and blocked calls are kept out of this list (see Spam blocked), so a skipped number is a screened call.";
const CALL_NO_HINT_SPAM = "Every call gets the next number in the order it came in. This list shows only spam and blocked calls, so the numbers in between are your real calls.";

function CallNoHeader({ hint, testId }: { hint: string; testId: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      Call #
      <Tooltip>
        <TooltipTrigger asChild>
          <button type="button" className="rounded-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label="Why call numbers skip" data-testid={`${testId}-callno-hint`}>
            <Info className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs text-xs font-normal normal-case">{hint}</TooltipContent>
      </Tooltip>
    </span>
  );
}

function CallsTable({ calls, onOpen, testId, numberHint }: { calls: VoiceCallListRow[]; onOpen: (id: string) => void; testId: string; numberHint: string }) {
  return (
    <div className={crmTable.wrapper}>
      <table className={crmTable.table} data-testid={testId}>
        <thead className={cn(crmTable.thead, crmTableCards.thead)}>
          <tr>
            <th className={crmTable.th}><CallNoHeader hint={numberHint} testId={testId} /></th>
            <th className={crmTable.th}>When</th>
            <th className={crmTable.th}>Caller</th>
            <th className={crmTable.th}>Outcome</th>
            <th className={cn(crmTable.th, "hidden md:table-cell")}>What it was about</th>
            <th className={crmTable.thRight}>Length</th>
          </tr>
        </thead>
        <tbody>
          {calls.map((c) => (
            <tr
              key={c.id}
              className={cn(crmTable.tr, crmTableCards.tr, "cursor-pointer")}
              onClick={() => onOpen(c.id)}
              data-testid={`row-call-${c.id}`}
            >
              <td className={cn(crmTable.td, crmTableCards.td, "whitespace-nowrap font-mono text-xs text-muted-foreground")} data-testid={`text-call-no-${c.id}`}>{c.callNo != null ? `#${c.callNo}` : "—"}</td>
              <td className={cn(crmTable.td, crmTableCards.td, "whitespace-nowrap text-muted-foreground")}>{fmtWhen(c.startedAt)}</td>
              <td className={cn(crmTable.td, crmTableCards.td)}>
                {/* The row is clickable; this button is the keyboard/screen-reader way in. */}
                <button
                  type="button"
                  className="text-left font-medium hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
                  onClick={(e) => { e.stopPropagation(); onOpen(c.id); }}
                  data-testid={`button-open-call-${c.id}`}
                >
                  {c.callerName || fmtPhone(c.fromNumber)}
                </button>
                <div className="text-xs text-muted-foreground">
                  {c.callerName ? fmtPhone(c.fromNumber) : null}
                  {c.callerName && c.callerCity ? " · " : null}
                  {c.callerCity}
                </div>
              </td>
              <td className={cn(crmTable.td, crmTableCards.td)}>
                <div className="flex flex-wrap items-center gap-1.5">
                  <StatusPill tone={outcomeTone(c.outcome)} data-testid={`pill-call-outcome-${c.id}`}>{outcomeLabel(c.outcome)}</StatusPill>
                  {c.customerId && (
                    <Link
                      href={`/crm/clients/${c.customerId}`}
                      onClick={(e: React.MouseEvent) => e.stopPropagation()}
                      className="text-xs text-primary hover:underline"
                      data-testid={`link-call-client-${c.id}`}
                    >
                      Client
                    </Link>
                  )}
                </div>
              </td>
              <td className={cn(crmTable.td, crmTableCards.td, "hidden md:table-cell max-w-md")}>
                <div className="line-clamp-2 text-muted-foreground">
                  {c.serviceNeeded || c.summary || c.spamReason || "—"}
                </div>
              </td>
              <td className={cn(crmTable.tdRight, crmTableCards.td, "whitespace-nowrap text-left sm:text-right")}>
                <span className="inline-flex items-center gap-1.5">
                  {c.hasRecording ? <Mic className="h-3.5 w-3.5 text-muted-foreground" aria-label="Has a recording" />
                    : c.recordingState === "pending" ? <Mic className="h-3.5 w-3.5 text-muted-foreground/50 animate-pulse" aria-label="Recording is still uploading" data-testid={`icon-recording-pending-${c.id}`} />
                    : null}
                  {fmtDuration(c.durationSeconds)}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Pager({ page, limit, total, onPage }: { page: number; limit: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / limit));
  if (pages <= 1) return <p className="text-xs text-muted-foreground" data-testid="text-calls-total">{total} {total === 1 ? "call" : "calls"}</p>;
  return (
    <div className="flex items-center justify-between gap-2 text-sm">
      <span className="text-muted-foreground" data-testid="text-calls-total">{total} calls · page {page} of {pages}</span>
      <div className="flex gap-1">
        <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Previous page" data-testid="button-calls-prev">
          <ChevronLeft className="h-4 w-4" aria-hidden="true" />
        </Button>
        <Button variant="outline" size="sm" disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label="Next page" data-testid="button-calls-next">
          <ChevronRight className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>
    </div>
  );
}

type SpamLedger = {
  entries: VoiceSpamEntry[];
  blocked: number;
  /** This month's meter (absent on an older server). */
  thisMonth?: { month: string; spamCalls: number; screened: number; rejected: number; freeSpamCalls: number; freeSpamMinutes: number; freeSpamCallsLimit: number };
};

function SpamView({ canManage, onOpen }: { canManage: boolean; onOpen: (id: string) => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const ledger = useQuery<SpamLedger>({ queryKey: ["/api/crm/voice/spam"], refetchInterval: LIVE_REFRESH_MS });
  const month = ledger.data?.thisMonth;
  const spamCalls = useQuery<VoiceCallList>({ queryKey: [callsUrl({ spam: 1, limit: PAGE_SIZE })], refetchInterval: LIVE_REFRESH_MS });
  const [number, setNumber] = useState("");

  // A block/unblock changes the ledger, the spam totals and which calls the lists show.
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["/api/crm/voice/spam"] });
    qc.invalidateQueries({ predicate: isCallsQuery });
  };
  const unblock = useMutation({
    mutationFn: async (id: number) => (await apiRequest("POST", `/api/crm/voice/spam/${id}/unblock`, {})).json(),
    onSuccess: () => { refresh(); toast({ title: "Number unblocked", description: "Its next calls are answered again; strikes start over." }); },
    onError: (err) => toast({ title: "Couldn't unblock it", description: apiErrorMessage(err), variant: "destructive" }),
  });
  const block = useMutation({
    mutationFn: async (phoneNumber: string) => (await apiRequest("POST", "/api/crm/voice/spam/block", { phoneNumber })).json(),
    onSuccess: () => { setNumber(""); refresh(); toast({ title: "Number blocked", description: "Its calls are now rejected before the assistant answers." }); },
    onError: (err) => toast({ title: "Couldn't block it", description: apiErrorMessage(err), variant: "destructive" }),
  });

  return (
    <div className="space-y-6">
      <LiveStamp queries={[ledger, spamCalls]} testId="spam-updated" />
      <section className="rounded-xl border bg-card p-4 sm:p-5 space-y-3" aria-labelledby="spam-summary-title" data-testid="card-spam-summary">
        <div className="flex flex-wrap items-start gap-3">
          <ShieldBan className="h-6 w-6 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <h2 id="spam-summary-title" className="text-base font-semibold">{CALL_ASSISTANT_SPAM.headline}</h2>
            <p className="text-sm text-muted-foreground">{CALL_ASSISTANT_SPAM.lead}</p>
          </div>
        </div>
        <dl className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
          <div className="p-3">
            <dt className="text-xs text-muted-foreground">Spam stopped this month</dt>
            <dd className="text-2xl font-bold tabular-nums" data-testid="text-spam-this-month">{(month?.spamCalls ?? 0).toLocaleString("en-US")}</dd>
          </div>
          <div className="p-3">
            <dt className="text-xs text-muted-foreground">Rejected before answering</dt>
            <dd className="text-2xl font-bold tabular-nums" data-testid="text-spam-rejected">{(month?.rejected ?? 0).toLocaleString("en-US")}</dd>
          </div>
          <div className="p-3">
            <dt className="text-xs text-muted-foreground">Numbers blocked</dt>
            <dd className="text-2xl font-bold tabular-nums" data-testid="text-spam-numbers-blocked">{(ledger.data?.blocked ?? 0).toLocaleString("en-US")}</dd>
          </div>
          <div className="p-3">
            <dt className="text-xs text-muted-foreground">Free spam calls used</dt>
            <dd className="text-2xl font-bold tabular-nums" data-testid="text-spam-free-used">
              {(month?.freeSpamCalls ?? 0).toLocaleString("en-US")}<span className="text-sm font-medium text-muted-foreground"> / {(month?.freeSpamCallsLimit ?? CALL_ASSISTANT_FREE_SPAM_CALLS).toLocaleString("en-US")}</span>
            </dd>
          </div>
        </dl>
        <p className="text-xs text-muted-foreground">{CALL_ASSISTANT_SPAM.block} {CALL_ASSISTANT_SPAM.report}</p>
      </section>

      <section className="space-y-3" aria-labelledby="spam-ledger-title">
        <div>
          <h2 id="spam-ledger-title" className="text-base font-semibold">Screened numbers</h2>
          <p className="text-sm text-muted-foreground">
            Unblock a number to let its calls through again.
          </p>
        </div>

        {canManage ? (
          <form
            className="flex flex-col gap-2 sm:flex-row sm:items-end"
            onSubmit={(e) => { e.preventDefault(); if (number.trim()) block.mutate(number.trim()); }}
          >
            <div className="flex-1 sm:max-w-xs">
              <Label htmlFor="spam-block-number">Block a number</Label>
              <Input
                id="spam-block-number"
                inputMode="tel"
                autoComplete="off"
                value={number}
                onChange={(e) => setNumber(e.target.value)}
                placeholder="+18135550100"
                data-testid="input-spam-block-number"
              />
            </div>
            <Button type="submit" variant="outline" disabled={!number.trim() || block.isPending} data-testid="button-spam-block">
              {block.isPending ? "Blocking…" : "Block"}
            </Button>
          </form>
        ) : (
          <p className="text-xs text-muted-foreground">Only members who can manage settings can block or unblock numbers.</p>
        )}

        {ledger.isLoading ? <TableSkeleton rows={3} /> : ledger.isError ? (
          <InlineError title="Couldn't load the spam ledger" error={ledger.error} onRetry={() => ledger.refetch()} />
        ) : !ledger.data?.entries.length ? (
          <EmptyState compact icon={ShieldAlert} title="No spam yet" description="Numbers the assistant screens out land here." />
        ) : (
          <div className={crmTable.wrapper}>
            <table className={crmTable.table} data-testid="table-spam-ledger">
              <thead className={cn(crmTable.thead, crmTableCards.thead)}>
                <tr>
                  <th className={crmTable.th}>Number</th>
                  <th className={crmTable.th}>Status</th>
                  <th className={crmTable.thRight}>Strikes</th>
                  <th className={crmTable.thRight}>Calls</th>
                  <th className={cn(crmTable.th, "hidden md:table-cell")}>Last reason</th>
                  <th className={cn(crmTable.th, "hidden sm:table-cell")}>Last call</th>
                  {canManage && <th className={crmTable.thRight}><span className="sr-only">Actions</span></th>}
                </tr>
              </thead>
              <tbody>
                {ledger.data.entries.map((e) => (
                  <tr key={e.id} className={cn(crmTable.tr, crmTableCards.tr)} data-testid={`row-spam-${e.id}`}>
                    <td className={cn(crmTable.td, crmTableCards.td, "font-medium whitespace-nowrap")}>{fmtPhone(e.phoneNumber)}</td>
                    <td className={cn(crmTable.td, crmTableCards.td)}>
                      <StatusPill tone={e.blocked ? "danger" : "warning"} data-testid={`pill-spam-status-${e.id}`}>
                        {e.blocked ? (e.blockedBy === "auto" ? "Blocked (auto)" : "Blocked") : "Watching"}
                      </StatusPill>
                    </td>
                    <td className={cn(crmTable.tdRight, crmTableCards.td)}><span className="sm:hidden text-muted-foreground">Strikes </span>{e.strikes}</td>
                    <td className={cn(crmTable.tdRight, crmTableCards.td)}><span className="sm:hidden text-muted-foreground">Calls </span>{e.calls}</td>
                    <td className={cn(crmTable.td, crmTableCards.td, "hidden md:table-cell max-w-sm text-muted-foreground")}>
                      <span className="line-clamp-2">{e.lastReason || "—"}{e.lastConfidence != null ? ` (${Math.round(e.lastConfidence * 100)}%)` : ""}</span>
                    </td>
                    <td className={cn(crmTable.td, crmTableCards.td, "hidden sm:table-cell whitespace-nowrap text-muted-foreground")}>{fmtWhen(e.lastSeenAt)}</td>
                    {canManage && (
                      <td className={cn(crmTable.tdRight, crmTableCards.td)}>
                        {e.blocked ? (
                          <Button size="sm" variant="ghost" disabled={unblock.isPending} onClick={() => unblock.mutate(e.id)} data-testid={`button-spam-unblock-${e.id}`}>Unblock</Button>
                        ) : (
                          <Button size="sm" variant="ghost" disabled={block.isPending} onClick={() => block.mutate(e.phoneNumber)} data-testid={`button-spam-block-${e.id}`}>Block</Button>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="space-y-3" aria-labelledby="spam-calls-title">
        <h2 id="spam-calls-title" className="text-base font-semibold">Spam and blocked calls</h2>
        {spamCalls.isLoading ? <TableSkeleton rows={3} /> : spamCalls.isError ? (
          <InlineError title="Couldn't load the spam calls" error={spamCalls.error} onRetry={() => spamCalls.refetch()} />
        ) : !spamCalls.data?.calls.length ? (
          <p className="text-sm text-muted-foreground">None so far.</p>
        ) : (
          <>
            <CallsTable calls={spamCalls.data.calls} onOpen={onOpen} testId="table-spam-calls" numberHint={CALL_NO_HINT_SPAM} />
            {spamCalls.data.total > spamCalls.data.calls.length && (
              <p className="text-xs text-muted-foreground">Showing the latest {spamCalls.data.calls.length} of {spamCalls.data.total}.</p>
            )}
          </>
        )}
      </section>
    </div>
  );
}

function EscalationsView({ onOpen }: { onOpen: (id: string) => void }) {
  const [showClosed, setShowClosed] = useState(false);
  const key = showClosed ? "/api/crm/voice/escalations" : "/api/crm/voice/escalations?open=1";
  const list = useQuery<VoiceEscalationList>({ queryKey: [key], refetchInterval: LIVE_REFRESH_MS });
  return (
    <section className="space-y-3" aria-labelledby="escalations-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="escalations-title" className="text-base font-semibold">Escalations</h2>
          <p className="text-sm text-muted-foreground">
            Texts and emails the assistant sent to your team for emergencies, existing customers and "I want a person".
            Reminders repeat on each rule's schedule until the person replies (or clicks "Got it" in the email).
          </p>
          <RemindersLine reminders={list.data?.reminders} />
        </div>
        <div className="flex items-center gap-2">
          <Switch id="escalations-closed" checked={showClosed} onCheckedChange={setShowClosed} data-testid="switch-escalations-closed" />
          <Label htmlFor="escalations-closed" className="text-sm">Show closed</Label>
        </div>
      </div>
      <LiveStamp queries={[list]} testId="escalations-updated" />
      {list.isLoading ? <TableSkeleton rows={2} /> : list.isError ? (
        <InlineError title="Couldn't load escalations" error={list.error} onRetry={() => list.refetch()} />
      ) : !list.data?.escalations.length ? (
        <EmptyState compact icon={BellRing} title={showClosed ? "No escalations yet" : "Nothing waiting"} description="When a caller needs a person, the hand-off and its reminders show up here." />
      ) : (
        <ul className="space-y-2" data-testid="list-escalations">
          {list.data.escalations.map((e) => (
            <EscalationRow key={e.id} e={e} onOpenCall={e.callId ? () => onOpen(e.callId!) : undefined} />
          ))}
        </ul>
      )}
    </section>
  );
}

/** Whether reminders actually go out on this server: the copy above promises them, this line says if they run. */
function RemindersLine({ reminders }: { reminders?: EscalationReminders }) {
  if (!reminders) return null;
  if (!reminders.running) {
    return (
      <p className="mt-1 text-xs text-amber-700 dark:text-amber-400" data-testid="text-reminders-off">
        Reminders are switched off on this server: the first text or email still goes out, repeats don't.
      </p>
    );
  }
  const last = reminders.lastRunAt ? fmtWhen(reminders.lastRunAt) : null;
  return (
    <p className={cn("mt-1 text-xs", reminders.stale || reminders.lastOk === false ? "text-amber-700 dark:text-amber-400" : "text-muted-foreground")} data-testid="text-reminders-on">
      Reminders checked every {reminders.intervalMinutes} minutes
      {last ? ` · last check ${last}` : " · first check shortly"}
      {reminders.lastOk === false ? " (some reminders failed to send; they retry next check)" : ""}
      {reminders.stale ? " (overdue)" : ""}.
    </p>
  );
}

function TableSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-2" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => <Skeleton key={i} className="h-12 w-full" />)}
    </div>
  );
}

function InlineError({ title, error, onRetry }: { title: string; error: unknown; onRetry: () => void }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-destructive/40 p-3 text-sm" role="alert">
      <div>
        <div className="font-medium">{title}</div>
        <div className="text-muted-foreground">{apiErrorMessage(error)}</div>
      </div>
      <Button size="sm" variant="outline" onClick={onRetry}>Try again</Button>
    </div>
  );
}
