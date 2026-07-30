import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Loader2, KanbanSquare, AlertTriangle } from "lucide-react";

const money = (c?: number | null) =>
  c === null || c === undefined ? "" : `$${(c / 100).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;

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
      <div className="p-6 max-w-lg mx-auto mt-10">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5" /> Couldn't load the pipeline
            </CardTitle>
            <CardDescription>Check your connection and refresh the page.</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  const stages: any[] = data.stages ?? [];
  const projects: any[] = data.projects ?? [];
  const groups = [...new Set(stages.map((s) => s.group))];

  return (
    <div className="p-6 space-y-5">
      <div>
        <h1 className="text-3xl font-bold flex items-center gap-2">
          <KanbanSquare className="h-7 w-7" /> Pipeline
        </h1>
        <p className="text-muted-foreground mt-1">
          {projects.length} project{projects.length === 1 ? "" : "s"} · drag a card to move it, or use the stage menu.
        </p>
      </div>

      {groups.map((group) => {
        const groupStages = stages.filter((s) => s.group === group);
        return (
          <div key={group} className="space-y-2">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">{group}</h2>
            <div className="flex gap-3 overflow-x-auto pb-2">
              {groupStages.map((s) => {
                const inStage = projects.filter((p) => p.status === s.key);
                return (
                  <div key={s.key} className="min-w-[240px] w-[240px] shrink-0"
                    onDragOver={(e) => canMove && e.preventDefault()}
                    onDrop={(e) => {
                      if (!canMove) return;
                      const id = e.dataTransfer.getData("text/plain");
                      if (id) move.mutate({ id, status: s.key });
                    }}
                    data-testid={`stage-col-${s.key}`}>
                    <div className="flex items-center justify-between px-1 pb-1">
                      <span className="text-sm font-medium">{s.label}</span>
                      <Badge variant="secondary">{inStage.length}</Badge>
                    </div>
                    <div className="space-y-2 min-h-[60px] rounded-md bg-muted/40 p-2">
                      {inStage.map((p) => (
                        <Card key={p.id}
                          draggable={canMove}
                          onDragStart={(e) => e.dataTransfer.setData("text/plain", p.id)}
                          className="cursor-pointer hover:ring-1 hover:ring-primary"
                          data-testid={`card-project-${p.id}`}>
                          <CardContent className="p-3 space-y-1">
                            <Link href={`/crm/projects/${p.id}`}>
                              <div className="font-medium text-sm leading-tight hover:underline">
                                {p.name}
                              </div>
                            </Link>
                            <div className="text-xs text-muted-foreground">{p.number}</div>
                            {canSeePrices && p.contractValueCents != null && (
                              <div className="text-xs font-medium">{money(p.contractValueCents)}</div>
                            )}
                            {p.trades?.length ? (
                              <div className="flex flex-wrap gap-1 pt-1">
                                {p.trades.slice(0, 3).map((t: string) => (
                                  <Badge key={t} variant="outline" className="text-[10px]">{t}</Badge>
                                ))}
                              </div>
                            ) : null}
                            {canMove && (
                              <div className="pt-1" onClick={(e) => e.stopPropagation()}>
                                <Select value={p.status}
                                  onValueChange={(status) => status !== p.status && move.mutate({ id: p.id, status })}>
                                  <SelectTrigger className="h-7 text-xs" data-testid={`select-stage-${p.id}`}>
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
                          </CardContent>
                        </Card>
                      ))}
                      {!inStage.length && (
                        <div className="text-xs text-muted-foreground text-center py-3">—</div>
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
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            No projects yet. Create one from a client's page.
          </CardContent>
        </Card>
      )}
    </div>
  );
}
