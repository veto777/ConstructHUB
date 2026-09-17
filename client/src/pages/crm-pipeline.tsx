import { useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Loader2, KanbanSquare, ArrowRight, Clock, Flame, AlertTriangle } from "lucide-react";
import { CrmPage, CrmPageHeader, EmptyState, ErrorCard } from "@/components/crm-ui";
import { Button } from "@/components/ui/button";

const money = (c?: number | null) =>
  c === null || c === undefined ? "" : `$${(c / 100).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;

const DAY = 86_400_000;
const daysSince = (d?: string | null) =>
  d ? Math.max(0, Math.floor((Date.now() - new Date(d).getTime()) / DAY)) : 0;

/**
 * How long a project may sit in a stage before it has gone cold. Sales stages
 * rot fast — a quote nobody chases is a quote you lose. Production stages
 * legitimately take weeks, so they're far more forgiving. Neither Housecall Pro
 * nor Leap surfaces time-in-stage at all, which is why deals quietly die there.
 */
const STALE_AFTER: Record<string, number> = {
  prospect: 3, sales: 5, production: 21, billing: 7, closed: 99999,
};

/**
 * Rough odds of closing, by stage, for a weighted forecast. Labelled as an
 * estimate in the UI — it is a planning aid, never committed revenue.
 */
const WIN_ODDS: Record<string, number> = {
  lead: 0.1, estimating: 0.25, proposal_sent: 0.45, approved: 0.95,
  scheduled: 1, in_progress: 1, waiting_on_trades: 1, punch_list: 1,
  complete: 1, invoiced: 1, paid: 1, cancelled: 0,
};

/** One accent per swimlane, falling back by position for custom groups. */
const GROUP_COLORS = [
  { dot: "bg-blue-500", text: "text-blue-600 dark:text-blue-400" },
  { dot: "bg-violet-500", text: "text-violet-600 dark:text-violet-400" },
  { dot: "bg-amber-500", text: "text-amber-600 dark:text-amber-400" },
  { dot: "bg-emerald-500", text: "text-emerald-600 dark:text-emerald-400" },
  { dot: "bg-rose-500", text: "text-rose-600 dark:text-rose-400" },
];
const GROUP_BY_NAME: Record<string, number> = { prospect: 0, sales: 1, production: 2, billing: 3 };
const groupColor = (group: string, idx: number) =>
  GROUP_COLORS[GROUP_BY_NAME[group.toLowerCase()] ?? idx % GROUP_COLORS.length];

/**
 * Pipeline board. Grouped into parallel swimlanes (Prospect / Sales /
 * Production / Billing) rather than Leap's single linear rail, because real
 * construction runs sales, procurement and production at the same time.
 */
export default function CrmPipelinePage() {
  const { toast } = useToast();
  const [staleOnly, setStaleOnly] = useState(false);
  const { data: me } = useQuery<any>({ queryKey: ["/api/crm/me"] });
  const { data, isLoading, isError } = useQuery<any>({ queryKey: ["/api/crm/projects"] });
  const canMove = me?.permissions?.manageJobs === true;
  const canSeePrices = me?.permissions?.seePrices === true;

  const move = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) =>
      (await apiRequest("PATCH", `/api/crm/projects/${id}`, { status })).json(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/crm/projects"] });
      toast({ title: "Stage updated" });
    },
    onError: (e: any) => toast({ title: "Could not move", description: String(e.message ?? e), variant: "destructive" }),
  });

  const stages: any[] = data?.stages ?? [];
  const rawProjects: any[] = data?.projects ?? [];

  // Age + staleness are derived once, so the cards and the summary agree.
  const projects = useMemo(() => rawProjects.map((p) => {
    const group = String(stages.find((s) => s.key === p.status)?.group ?? "").toLowerCase();
    const age = daysSince(p.stageChangedAt);
    const odds = WIN_ODDS[p.status] ?? 0;
    // Only open work can go cold — a finished job sitting in "paid" is fine.
    const stale = odds > 0 && odds < 1 && age > (STALE_AFTER[group] ?? 14);
    return { ...p, _age: age, _stale: stale, _odds: odds };
  }), [rawProjects, stages]);

  const openCents = projects.filter((p) => p._odds > 0 && p._odds < 1)
    .reduce((s, p) => s + (p.contractValueCents ?? 0), 0);
  const forecastCents = projects.reduce((s, p) => s + (p.contractValueCents ?? 0) * p._odds, 0);
  const staleCount = projects.filter((p) => p._stale).length;
  const visible = staleOnly ? projects.filter((p) => p._stale) : projects;

  if (isLoading) {
    return <div className="flex justify-center p-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }

  if (isError || !data) {
    return <ErrorCard title="Couldn't load the pipeline" description="Check your connection and refresh the page." />;
  }

  const groups = [...new Set(stages.map((s) => s.group))];

  return (
    <CrmPage wide>
      <CrmPageHeader
        icon={KanbanSquare}
        title="Pipeline"
        subtitle={`${rawProjects.length} project${rawProjects.length === 1 ? "" : "s"} · drag a card to move it, or use the stage menu.`}
      />

      {/* Three numbers above the board. A board that only shows position tells
          you where things are; these tell you whether that's good or bad. */}
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border bg-card p-4">
          <div className="text-xs text-muted-foreground">Open pipeline</div>
          <div className="text-xl font-bold tabular-nums">{canSeePrices ? money(openCents) || "$0" : "—"}</div>
          <div className="text-[11px] text-muted-foreground">quoted, not yet won</div>
        </div>
        <div className="rounded-xl border bg-card p-4">
          <div className="text-xs text-muted-foreground">Weighted forecast</div>
          <div className="text-xl font-bold tabular-nums">{canSeePrices ? money(forecastCents) || "$0" : "—"}</div>
          <div className="text-[11px] text-muted-foreground">estimate only — weighted by stage</div>
        </div>
        <div className={`rounded-xl border bg-card p-4 ${staleCount ? "border-amber-500/60" : ""}`}>
          <div className="text-xs text-muted-foreground">Going cold</div>
          <div className="text-xl font-bold tabular-nums flex items-center gap-2">
            {staleCount}
            {staleCount > 0 && <AlertTriangle className="h-4 w-4 text-amber-600" />}
          </div>
          {staleCount > 0 ? (
            <button className="text-[11px] text-primary hover:underline" data-testid="button-toggle-stale"
              onClick={() => setStaleOnly(!staleOnly)}>
              {staleOnly ? "show everything" : "show only these"}
            </button>
          ) : (
            <div className="text-[11px] text-muted-foreground">nothing stalled</div>
          )}
        </div>
      </div>

      {groups.map((group, gi) => {
        const color = groupColor(String(group), gi);
        const groupStages = stages.filter((s) => s.group === group);
        const groupTotal = visible.filter((p) => stages.find((s) => s.key === p.status)?.group === group)
          .reduce((s, p) => s + (p.contractValueCents ?? 0), 0);
        return (
          <div key={String(group)} className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className={`h-2 w-2 rounded-full ${color.dot}`} />
                <h2 className={`text-xs font-semibold uppercase tracking-widest ${color.text}`}>{String(group)}</h2>
              </div>
              {canSeePrices && groupTotal > 0 && (
                <span className="text-xs text-muted-foreground tabular-nums">{money(groupTotal)}</span>
              )}
            </div>
            <div className="flex gap-3 overflow-x-auto pb-3 snap-x snap-proximity">
              {groupStages.map((s) => {
                const inStage = visible.filter((p) => p.status === s.key);
                const colTotal = inStage.reduce((sum, p) => sum + (p.contractValueCents ?? 0), 0);
                return (
                  <div key={s.key} className="min-w-[260px] w-[260px] shrink-0 snap-start"
                    onDragOver={(e) => canMove && e.preventDefault()}
                    onDrop={(e) => {
                      if (!canMove) return;
                      const id = e.dataTransfer.getData("text/plain");
                      if (id) move.mutate({ id, status: s.key });
                    }}
                    data-testid={`stage-col-${s.key}`}>
                    <div className="flex items-center justify-between px-1.5 pb-2">
                      <span className="text-sm font-medium">{s.label}</span>
                      <div className="flex items-center gap-1.5">
                        {canSeePrices && colTotal > 0 && (
                          <span className="text-[11px] text-muted-foreground tabular-nums">{money(colTotal)}</span>
                        )}
                        <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-muted px-1.5 text-xs font-medium text-muted-foreground tabular-nums">
                          {inStage.length}
                        </span>
                      </div>
                    </div>
                    <div className="space-y-2 min-h-[80px] rounded-xl border border-border/50 bg-muted/40 p-2">
                      {inStage.map((p) => (
                        <div key={p.id}
                          draggable={canMove}
                          onDragStart={(e) => e.dataTransfer.setData("text/plain", p.id)}
                          className={`rounded-lg border bg-card p-3 space-y-1.5 shadow-sm cursor-pointer transition-all hover:shadow-md hover:border-primary/40 ${
                            p._stale ? "border-amber-500/70 bg-amber-50/50 dark:bg-amber-950/20" : ""}`}
                          data-testid={`card-project-${p.id}`}>
                          <Link href={`/crm/projects/${p.id}`}>
                            <div className="font-medium text-sm leading-snug hover:underline">
                              {p.name}
                            </div>
                          </Link>
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-xs text-muted-foreground">{p.number}</span>
                            {canSeePrices && p.contractValueCents != null && (
                              <span className="text-sm font-semibold tabular-nums">{money(p.contractValueCents)}</span>
                            )}
                          </div>

                          {/* Time in stage. The single most useful fact a card can
                              carry, and neither competitor shows it anywhere. */}
                          <div className="text-[11px]">
                            {p._stale ? (
                              <span className="flex items-center gap-1 font-medium text-amber-700 dark:text-amber-500"
                                data-testid={`stale-${p.id}`}>
                                <Flame className="h-3 w-3" /> {p._age}d in stage — going cold
                              </span>
                            ) : (
                              <span className="flex items-center gap-1 text-muted-foreground">
                                <Clock className="h-3 w-3" /> {p._age === 0 ? "moved today" : `${p._age}d in stage`}
                              </span>
                            )}
                          </div>

                          {p.trades?.length ? (
                            <div className="flex flex-wrap gap-1">
                              {p.trades.slice(0, 3).map((t: string) => (
                                <Badge key={t} variant="outline" className="text-[10px] font-normal">{t}</Badge>
                              ))}
                            </div>
                          ) : null}
                          {canMove && (
                            <div className="pt-0.5" onClick={(e) => e.stopPropagation()}>
                              <Select value={p.status}
                                onValueChange={(status) => status !== p.status && move.mutate({ id: p.id, status })}>
                                <SelectTrigger className="h-7 text-xs bg-muted/40 border-transparent" data-testid={`select-stage-${p.id}`}>
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  {stages.map((st) => (
                                    <SelectItem key={st.key} value={st.key}>{st.label}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                          )}
                        </div>
                      ))}
                      {!inStage.length && (
                        <div className="text-xs text-muted-foreground text-center py-6 border border-dashed border-border/60 rounded-lg">
                          {staleOnly ? "nothing cold here" : "Drop a project here"}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}

      {!rawProjects.length && (
        <div className="rounded-xl border bg-card">
          <EmptyState
            icon={KanbanSquare}
            title="No projects yet"
            description="Projects are the jobs on your board — create one from a client's page."
            action={
              <Link href="/crm/clients">
                <Button>Go to clients <ArrowRight className="h-4 w-4 ml-1" /></Button>
              </Link>
            }
          />
        </div>
      )}
    </CrmPage>
  );
}
