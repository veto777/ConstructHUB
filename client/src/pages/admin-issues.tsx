import { AppPage, PageHeader, Section, Toolbar } from "@/components/app-ui";
/**
 * /admin/issues — the issue desk (docs/ops/ISSUE-DESK.md): every failure the
 * app captured (server 5xx, background jobs, browser errors, the Call
 * Assistant, health checks), newest first, and what Claude found when the
 * tower handed it over. Reached from the sidebar ("Issues · ADMIN").
 *
 * Platform admins only: GET /api/admin/issues answers 403 to anyone else.
 * The admin second factor (403 reauth) is handled like /admin/access:
 * apiRequest opens the verify-identity dialog and retries the request.
 * Nothing on this page deploys or pushes; a fix waits on its branch.
 */
import { useMemo, useState } from "react";
import { keepPreviousData, useMutation, useQuery } from "@tanstack/react-query";
import { formatDistanceToNowStrict, format } from "date-fns";
import { Bug, CheckCircle2, ChevronRight, EyeOff, GitBranch, Loader2, Lock, RotateCcw } from "lucide-react";
import {
  ISSUE_SOURCES, ISSUE_SOURCE_LABELS, ISSUE_STATUSES, ISSUE_STATUS_LABELS,
  type IssueAdminStatus, type IssueSeverity, type IssueStatus, type OpsIssue, type OpsIssueRow,
} from "@shared/ops-issues";
import { apiErrorMessage, apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { StatusPill, type PillTone } from "@/components/crm-ui";
import { useDocumentTitle } from "@/components/feature-landing/primitives";
import { VerificationCancelled } from "@/components/recent-auth";
import { cn } from "@/lib/utils";

type ListPayload = { issues: OpsIssueRow[]; total: number; counts: Record<string, number> };

const STATUS_TONE: Record<IssueStatus, PillTone> = {
  triage: "warning", new: "danger", inspecting: "info", inspected: "neutral", fix_ready: "success", fixed: "teal", ignored: "neutral",
};
const SEVERITY_DOT: Record<IssueSeverity, string> = {
  critical: "bg-red-600", error: "bg-red-500", warning: "bg-amber-500", info: "bg-blue-500",
};
const SEVERITY_LABEL: Record<IssueSeverity, string> = { critical: "Critical", error: "Error", warning: "Warning", info: "Info" };
const EVENT_LABEL: Record<string, string> = {
  reported: "First reported", reopened: "Happened again after it was fixed", claimed: "Handed to Claude",
  inspected: "Claude inspected it", fix_ready: "Claude prepared a fix", ignored: "Ignored", fixed: "Marked fixed", reinspect: "Sent back for inspection",
};

const ago = (iso: string | null) => (iso ? `${formatDistanceToNowStrict(new Date(iso))} ago` : "—");
const when = (iso: string | null) => (iso ? format(new Date(iso), "MMM d, yyyy h:mm a") : "—");
/** Status code and JSON body of a failed request ("403: {...}"). */
function failure(err: unknown): { status: number; body: any } {
  const raw = String((err as Error | null)?.message ?? "");
  const status = Number(raw.slice(0, 3)) || 0;
  try { return { status, body: JSON.parse(raw.replace(/^\d{3}:\s*/, "")) }; } catch { return { status, body: null }; }
}
/** GET through apiRequest: the admin second factor (403 reauth) opens the verify-identity dialog, then retries. */
const getJson = async <T,>(url: string): Promise<T> => (await apiRequest("GET", url)).json();

function SeverityDot({ severity }: { severity: IssueSeverity }) {
  return <span className={cn("mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full", SEVERITY_DOT[severity])} title={SEVERITY_LABEL[severity]} aria-label={SEVERITY_LABEL[severity]} />;
}

function StatusBadge({ status }: { status: IssueStatus }) {
  return <StatusPill tone={STATUS_TONE[status]} data-testid={`status-issue-${status}`}>{ISSUE_STATUS_LABELS[status]}</StatusPill>;
}

function IssueDrawer({ id, onClose }: { id: number | null; onClose: () => void }) {
  const { toast } = useToast();
  const { data: issue, isLoading, error } = useQuery<OpsIssue>({
    queryKey: ["/api/admin/issues", String(id)], enabled: id !== null, queryFn: () => getJson<OpsIssue>(`/api/admin/issues/${id}`),
  });
  const setStatus = useMutation({
    mutationFn: async (status: IssueAdminStatus) => (await apiRequest("POST", `/api/admin/issues/${id}/status`, { status })).json() as Promise<OpsIssue>,
    onSuccess: (updated, status) => {
      queryClient.setQueryData(["/api/admin/issues", String(id)], updated);
      // Every list (whatever its filter) and the sidebar's count.
      void queryClient.invalidateQueries({ predicate: (q) => q.queryKey.length === 1 && String(q.queryKey[0]).startsWith("/api/admin/issues") });
      toast({ title: status === "fixed" ? "Marked fixed" : status === "ignored" ? "Ignored" : "Sent back for inspection", description: status === "new" ? "The next issue-desk run, within 15 minutes, hands it to Claude." : undefined });
    },
    onError: (e) => toast({ title: "Could not update the issue", description: apiErrorMessage(e), variant: "destructive" }),
  });
  const busy = setStatus.isPending;

  return (
    <Sheet open={id !== null} onOpenChange={(open) => { if (!open) onClose(); }}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-xl" data-testid="drawer-issue">
        {isLoading || !issue ? (
          <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
            <SheetTitle className="sr-only">Issue #{id}</SheetTitle>
            <SheetDescription className="sr-only">Loading the issue</SheetDescription>
            {error ? "Couldn't load this issue." : <Loader2 className="h-5 w-5 animate-spin" aria-label="Loading" />}
          </div>
        ) : (
          <div className="space-y-5">
            <SheetHeader className="space-y-2 pr-6 text-left">
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge status={issue.status} />
                <StatusPill tone={issue.severity === "warning" ? "warning" : issue.severity === "info" ? "info" : "danger"} dot={false}>{SEVERITY_LABEL[issue.severity]}</StatusPill>
                <StatusPill tone="neutral" dot={false}>{ISSUE_SOURCE_LABELS[issue.source]}</StatusPill>
                <span className="text-xs text-muted-foreground">#{issue.id}</span>
              </div>
              <SheetTitle className="break-words text-base leading-snug" data-testid="text-issue-title">{issue.title}</SheetTitle>
              <SheetDescription>Seen {issue.count.toLocaleString()} {issue.count === 1 ? "time" : "times"} · last {ago(issue.lastSeen)}</SheetDescription>
            </SheetHeader>

            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={() => setStatus.mutate("fixed")} disabled={busy || issue.status === "fixed"} data-testid="button-issue-fixed">
                <CheckCircle2 className="mr-1.5 h-4 w-4" aria-hidden="true" /> Mark fixed
              </Button>
              <Button size="sm" variant="outline" onClick={() => setStatus.mutate("ignored")} disabled={busy || issue.status === "ignored"} data-testid="button-issue-ignore">
                <EyeOff className="mr-1.5 h-4 w-4" aria-hidden="true" /> Ignore
              </Button>
              <Button size="sm" variant="outline" onClick={() => setStatus.mutate("new")} disabled={busy || issue.status === "new" || issue.status === "inspecting"} data-testid="button-issue-reinspect">
                <RotateCcw className="mr-1.5 h-4 w-4" aria-hidden="true" /> {issue.status === "triage" ? "Send to Claude" : "Re-inspect"}
              </Button>
            </div>

            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-lg border p-3 text-sm">
              <div><dt className="text-xs text-muted-foreground">Count</dt><dd className="font-medium tabular-nums">{issue.count.toLocaleString()}</dd></div>
              <div><dt className="text-xs text-muted-foreground">First seen</dt><dd>{when(issue.firstSeen)}</dd></div>
              <div><dt className="text-xs text-muted-foreground">Last seen</dt><dd>{when(issue.lastSeen)}</dd></div>
              <div><dt className="text-xs text-muted-foreground">Inspected</dt><dd>{when(issue.inspectedAt)}</dd></div>
              <div className="col-span-2">
                <dt className="text-xs text-muted-foreground">Branch</dt>
                <dd className="mt-0.5 flex items-center gap-1.5 break-all font-mono text-xs" data-testid="text-issue-branch">
                  {issue.branch ? <><GitBranch className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />{issue.branch}</> : <span className="font-sans text-sm text-muted-foreground">No fix branch</span>}
                </dd>
              </div>
            </dl>

            <section>
              <h3 className="mb-1.5 text-sm font-semibold">Claude's report</h3>
              {issue.report ? (
                <div className="whitespace-pre-wrap break-words rounded-lg bg-muted/50 p-3 text-sm leading-relaxed" data-testid="text-issue-report">{issue.report}</div>
              ) : (
                <p className="text-sm text-muted-foreground">{issue.status === "inspecting" ? "Claude is looking at it now." : issue.status === "triage" ? "Browser reports come from anyone's browser, so Claude only sees one after you press Send to Claude." : "Not inspected yet. The issue desk on the tower picks up new issues every 15 minutes."}</p>
              )}
            </section>

            <section>
              <h3 className="mb-1.5 text-sm font-semibold">Timeline</h3>
              <ol className="space-y-2 border-l pl-4 text-sm">
                {issue.history.length === 0 && <li className="text-muted-foreground">First reported {when(issue.firstSeen)}</li>}
                {[...issue.history].reverse().map((h, i) => (
                  <li key={`${h.at}-${i}`} className="relative">
                    <span className="absolute -left-[1.3rem] top-1.5 h-2 w-2 rounded-full bg-border" aria-hidden="true" />
                    <span className="font-medium">{EVENT_LABEL[h.event] ?? h.event}</span>
                    {h.by && <span className="text-muted-foreground"> · {h.by}</span>}
                    <div className="text-xs text-muted-foreground">{when(h.at)}</div>
                  </li>
                ))}
              </ol>
            </section>

            <section>
              <h3 className="mb-1.5 text-sm font-semibold">Detail</h3>
              <p className="mb-1.5 text-xs text-muted-foreground">Scrubbed when captured: no secrets or card data; emails and phone numbers masked.</p>
              <pre className="max-h-96 overflow-auto rounded-lg bg-muted/50 p-3 text-xs leading-relaxed" data-testid="text-issue-detail">{JSON.stringify(issue.detail, null, 2)}</pre>
            </section>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

export default function AdminIssuesPage() {
  useDocumentTitle("Issues | ConstructHUB");
  const [status, setStatusFilter] = useState<IssueStatus | "all">("all");
  const [source, setSource] = useState<string>("all");
  const [openId, setOpenId] = useState<number | null>(null);
  const params = new URLSearchParams();
  if (status !== "all") params.set("status", status);
  if (source !== "all") params.set("source", source);
  const qs = params.toString();
  const listUrl = `/api/admin/issues${qs ? `?${qs}` : ""}`;
  const { data, isLoading, error, refetch } = useQuery<ListPayload>({
    queryKey: [listUrl], queryFn: () => getJson<ListPayload>(listUrl), placeholderData: keepPreviousData,
    // Fresh every minute while the page shows issues (never re-asking for verification on a timer).
    refetchInterval: (q) => (q.state.data ? 60_000 : false),
  });
  const fail = useMemo(() => (error ? failure(error) : null), [error]);

  if (isLoading && !data) {
    return <div className="flex justify-center py-20" data-testid="page-admin-issues-loading"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-label="Loading" /></div>;
  }
  if (!data && (error instanceof VerificationCancelled || fail?.body?.reauth === true)) {
    return (
      <div className="mx-auto max-w-xl px-4 py-16 text-center" data-testid="page-admin-issues-verify">
        <Lock className="mx-auto h-6 w-6 text-muted-foreground" aria-hidden="true" />
        <h1 className="mt-3 text-lg font-semibold">Verify it's you</h1>
        <p className="mt-1 text-sm text-muted-foreground">Admin tools need a recent identity check.</p>
        <Button className="mt-4" onClick={() => void refetch()} data-testid="button-admin-issues-verify">Verify identity</Button>
      </div>
    );
  }
  if (!data) {
    const forbidden = fail?.status === 401 || fail?.status === 403;
    return (
      <div className="mx-auto max-w-xl px-4 py-16 text-center" data-testid="page-admin-issues-denied">
        <Lock className="mx-auto h-6 w-6 text-muted-foreground" aria-hidden="true" />
        <h1 className="mt-3 text-lg font-semibold">{forbidden ? "Platform admins only" : "Couldn't load the issues"}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{forbidden ? "The issue desk is for the people who run ConstructHUB." : "Try again in a moment."}</p>
      </div>
    );
  }

  const total = Object.values(data.counts).reduce((a, b) => a + b, 0);
  const chips: { key: IssueStatus | "all"; label: string; n: number }[] = [
    { key: "all", label: "All", n: total },
    ...ISSUE_STATUSES.map((s) => ({ key: s, label: ISSUE_STATUS_LABELS[s], n: data.counts[s] ?? 0 })),
  ];

  return (
    <AppPage testId="page-admin-issues">
      <PageHeader title="Issues" description="Review failures, inspect reports, and track fixes." />

      <div className="min-w-0 space-y-3">
        <div className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1" role="tablist" aria-label="Filter by status">
          {chips.map((c) => (
            <button key={c.key} type="button" role="tab" aria-selected={status === c.key} onClick={() => setStatusFilter(c.key)}
              className={cn("inline-flex shrink-0 items-center gap-1.5 rounded-lg border px-3 py-2 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                status === c.key ? "border-border bg-background text-foreground shadow-sm" : "border-transparent bg-muted/70 text-muted-foreground hover:text-foreground")}
              data-testid={`filter-status-${c.key}`}>
              {c.label}
              <span className={cn("tabular-nums text-xs", status === c.key ? "opacity-80" : "text-muted-foreground")}>{c.n}</span>
            </button>
          ))}
        </div>
        <Toolbar filters={<Select value={source} onValueChange={setSource}>
          <SelectTrigger className="w-full md:w-48" aria-label="Filter by source" data-testid="select-issue-source"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All sources</SelectItem>
            {ISSUE_SOURCES.map((s) => <SelectItem key={s} value={s}>{ISSUE_SOURCE_LABELS[s]}</SelectItem>)}
          </SelectContent>
        </Select>} activeFilters={source === "all" ? 0 : 1} />
      </div>

      <Section flush className="overflow-hidden">
        <div className="hidden grid-cols-12 gap-3 border-b bg-muted/40 px-4 py-2.5 text-xs font-medium text-muted-foreground md:grid">
          <span className="col-span-5">Issue</span>
          <span className="col-span-2">Source</span>
          <span className="col-span-1 text-right">Count</span>
          <span className="col-span-2">Last seen</span>
          <span className="col-span-2 text-right">Status</span>
        </div>
        {data.issues.length === 0 ? (
          <div className="px-4 py-14 text-center" data-testid="empty-issues">
            <Bug className="mx-auto h-6 w-6 text-muted-foreground" aria-hidden="true" />
            <p className="mt-2 font-medium">No issues{status !== "all" ? ` marked ${ISSUE_STATUS_LABELS[status].toLowerCase()}` : ""}{source !== "all" ? ` from ${ISSUE_SOURCE_LABELS[source as keyof typeof ISSUE_SOURCE_LABELS].toLowerCase()}` : ""}</p>
            <p className="mt-1 text-sm text-muted-foreground">When something fails, it shows up here and Claude takes a look.</p>
          </div>
        ) : (
          <ul className="divide-y">
            {data.issues.map((i) => (
              <li key={i.id}>
                <button type="button" onClick={() => setOpenId(i.id)} data-testid={`row-issue-${i.id}`}
                  className="grid w-full grid-cols-1 gap-2 px-4 py-3 text-left transition-colors hover:bg-muted/40 focus-visible:bg-muted/40 focus-visible:outline-none md:grid-cols-12 md:items-center md:gap-3">
                  <div className="flex min-w-0 gap-2.5 md:col-span-5">
                    <SeverityDot severity={i.severity} />
                    <div className="min-w-0">
                      <p className="line-clamp-2 break-words text-sm font-medium">{i.title}</p>
                      <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground md:hidden">
                        <span>{ISSUE_SOURCE_LABELS[i.source]}</span>·<span className="tabular-nums">{i.count.toLocaleString()}×</span>·<span>{ago(i.lastSeen)}</span>
                      </p>
                      {i.branch && <p className="mt-0.5 flex items-center gap-1 truncate font-mono text-xs text-emerald-700 dark:text-emerald-400"><GitBranch className="h-3 w-3 shrink-0" aria-hidden="true" />{i.branch}</p>}
                    </div>
                  </div>
                  <span className="hidden text-sm text-muted-foreground md:col-span-2 md:block">{ISSUE_SOURCE_LABELS[i.source]}</span>
                  <span className="hidden text-right text-sm tabular-nums md:col-span-1 md:block">{i.count.toLocaleString()}</span>
                  <span className="hidden whitespace-nowrap text-sm text-muted-foreground md:col-span-2 md:block" title={when(i.lastSeen)}>{ago(i.lastSeen)}</span>
                  <span className="flex items-center gap-1 pl-5 md:col-span-2 md:justify-end md:pl-0">
                    <StatusBadge status={i.status} />
                    <ChevronRight className="ml-auto h-4 w-4 text-muted-foreground md:ml-0" aria-hidden="true" />
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Section>
      {data.total > data.issues.length && (
        <p className="mt-2 text-xs text-muted-foreground">Showing the {data.issues.length} most recent of {data.total.toLocaleString()}.</p>
      )}

      <IssueDrawer id={openId} onClose={() => setOpenId(null)} />
    </AppPage>
  );
}
