import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Loader2, KanbanSquare, ArrowRight } from "lucide-react";
import { CrmPage, CrmPageHeader, EmptyState, ErrorCard } from "@/components/crm-ui";
import { Button } from "@/components/ui/button";

const money = (c?: number | null) =>
  c === null || c === undefined ? "" : `$${(c / 100).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;

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

  if (isLoading) {
    return <div className="flex justify-center p-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }

  if (isError || !data) {
    return (
      <ErrorCard
        title="Couldn't load the pipeline"
        description="Check your connection and refresh the page."
      />
    );
  }

  const stages: any[] = data.stages ?? [];
  const projects: any[] = data.projects ?? [];
  const groups = [...new Set(stages.map((s) => s.group))];

  return (
    <CrmPage wide>
      <CrmPageHeader
        icon={KanbanSquare}
        title="Pipeline"
        subtitle={`${projects.length} project${projects.length === 1 ? "" : "s"} · drag a card to move it, or use the stage menu.`}
      />

      {groups.map((group, gi) => {
        const color = groupColor(String(group), gi);
        const groupStages = stages.filter((s) => s.group === group);
        return (
          <div key={String(group)} className="space-y-3">
            <div className="flex items-center gap-2">
              <span className={`h-2 w-2 rounded-full ${color.dot}`} />
              <h2 className={`text-xs font-semibold uppercase tracking-widest ${color.text}`}>{String(group)}</h2>
            </div>
            <div className="flex gap-3 overflow-x-auto pb-3 snap-x snap-proximity">
              {groupStages.map((s) => {
                const inStage = projects.filter((p) => p.status === s.key);
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
                      <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-muted px-1.5 text-xs font-medium text-muted-foreground tabular-nums">
                        {inStage.length}
                      </span>
                    </div>
                    <div className="space-y-2 min-h-[80px] rounded-xl border border-border/50 bg-muted/40 p-2">
                      {inStage.map((p) => (
                        <div key={p.id}
                          draggable={canMove}
                          onDragStart={(e) => e.dataTransfer.setData("text/plain", p.id)}
                          className="rounded-lg border bg-card p-3 space-y-1.5 shadow-sm cursor-pointer transition-all hover:shadow-md hover:border-primary/40"
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
                          Drop a project here
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

      {!projects.length && (
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
