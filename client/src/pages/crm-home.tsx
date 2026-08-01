import { useQuery, useMutation } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  CheckCircle2, Circle, ArrowRight, Loader2, Users, Building2,
  UserCircle, Lock, Sparkles, KanbanSquare, DollarSign, Activity,
  AlertCircle, Inbox,
} from "lucide-react";
import {
  CrmPage, MetricCard, StatusPill, EmptyState, ErrorCard, statusTone,
} from "@/components/crm-ui";

interface Step {
  key: string;
  label: string;
  description: string;
  path: string;
  done: boolean;
  required: boolean;
  locked?: boolean;
}

interface Onboarding {
  steps: Step[];
  nextStep: string | null;
  nextPath: string;
  requiredComplete: boolean;
  dismissed: boolean;
  showChecklist: boolean;
  completedCount: number;
  totalCount: number;
}

const STEP_ICON: Record<string, any> = {
  profile: UserCircle,
  company: Building2,
  team: Users,
};

const money0 = (c?: number | null) =>
  c === null || c === undefined ? "—" : `$${(c / 100).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;

/** Portal landing page. Never a dead end: it always offers the next action. */
export default function CrmHomePage() {
  const [, navigate] = useLocation();
  const { data: me } = useQuery<any>({ queryKey: ["/api/crm/me"] });
  const { data: ob, isLoading, isError } = useQuery<Onboarding>({ queryKey: ["/api/crm/onboarding"] });

  // Dashboard metrics — read-only rollups over endpoints the app already has.
  const { data: clients } = useQuery<any[]>({ queryKey: ["/api/crm/customers"] });
  const { data: pipeline } = useQuery<any>({ queryKey: ["/api/crm/projects"] });
  const canSeePrices = me?.permissions?.seePrices === true;

  const dismiss = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/crm/onboarding/dismiss", {})).json(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/crm/onboarding"] }),
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-16">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (isError || !ob) {
    return (
      <ErrorCard
        title="Couldn't load your workspace"
        description="Check your connection and refresh the page."
      />
    );
  }

  const pct = Math.round((ob.completedCount / ob.totalCount) * 100);
  const nextStep = ob.steps.find((s) => s.key === ob.nextStep);

  const stages: any[] = pipeline?.stages ?? [];
  const projects: any[] = pipeline?.projects ?? [];
  const stageOf = (key: string) => stages.find((s) => s.key === key);
  const firstGroup = stages[0]?.group;
  // Leads = anything still sitting in the first swimlane (Prospect).
  const leads = projects.filter((p) => stageOf(p.status)?.group === firstGroup);
  const pipelineValue = projects.reduce((s, p) => s + (p.contractValueCents ?? 0), 0);
  const recent = [...projects]
    .sort((a, b) => String(b.createdAt ?? "").localeCompare(String(a.createdAt ?? "")))
    .slice(0, 5);

  return (
    <CrmPage>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          {me?.org?.name ? me.org.name : "Welcome"}
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          {ob.requiredComplete
            ? "Your workspace is set up — here's where things stand."
            : "A couple of things left before your workspace is ready."}
        </p>
      </div>

      {ob.showChecklist && (
        <Card data-testid="card-setup" className="border-primary/30">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Sparkles className="h-5 w-5 text-primary" /> Finish setting up
            </CardTitle>
            <CardDescription>
              {ob.completedCount} of {ob.totalCount} done
            </CardDescription>
            <Progress value={pct} className="mt-2" data-testid="progress-setup" />
          </CardHeader>
          <CardContent className="space-y-2">
            {ob.steps.map((s) => {
              const Icon = STEP_ICON[s.key] ?? Circle;
              const isNext = s.key === ob.nextStep;
              const row = (
                <div
                  className={`flex items-center gap-3 rounded-lg border p-3 transition-colors ${
                    s.locked ? "opacity-60 cursor-not-allowed" : "hover:bg-accent cursor-pointer"
                  } ${isNext ? "border-primary/60 bg-primary/5" : ""}`}
                  data-testid={`step-${s.key}`}
                >
                  {s.done ? (
                    <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0" />
                  ) : s.locked ? (
                    <Lock className="h-5 w-5 text-muted-foreground shrink-0" />
                  ) : (
                    <Icon className="h-5 w-5 text-muted-foreground shrink-0" />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="font-medium flex items-center gap-2">
                      {s.label}
                      {!s.required && <Badge variant="outline" className="text-xs">optional</Badge>}
                      {isNext && <Badge className="text-xs">next</Badge>}
                    </div>
                    <div className="text-sm text-muted-foreground">
                      {s.locked ? "Ask an admin to do this one." : s.description}
                    </div>
                  </div>
                  {!s.done && !s.locked && <ArrowRight className="h-4 w-4 text-muted-foreground shrink-0" />}
                </div>
              );
              // Locked steps aren't links — an href="#" would just scroll to top.
              return s.locked ? <div key={s.key}>{row}</div> : <Link key={s.key} href={s.path}>{row}</Link>;
            })}

            <div className="flex flex-wrap items-center gap-2 pt-2">
              {nextStep ? (
                <Button onClick={() => navigate(nextStep.path)} data-testid="button-continue-setup">
                  Continue: {nextStep.label} <ArrowRight className="h-4 w-4 ml-2" />
                </Button>
              ) : (
                <Button onClick={() => dismiss.mutate()} disabled={dismiss.isPending} data-testid="button-finish-setup">
                  {dismiss.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} All done
                </Button>
              )}
              {ob.requiredComplete && nextStep && (
                <Button variant="ghost" onClick={() => dismiss.mutate()} data-testid="button-skip-setup">
                  Skip for now
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* The numbers row */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <MetricCard
          icon={Users}
          label="Clients"
          value={clients?.length ?? "—"}
          context="in your book — each with its own portal"
          href="/crm/clients"
        />
        {canSeePrices ? (
          <MetricCard
            icon={DollarSign}
            label="Pipeline value"
            value={money0(pipelineValue)}
            context={`across ${projects.length} open project${projects.length === 1 ? "" : "s"}`}
            href="/crm/pipeline"
          />
        ) : (
          <MetricCard
            icon={KanbanSquare}
            label="Open projects"
            value={projects.length}
            context="across every stage of the board"
            href="/crm/pipeline"
          />
        )}
        <MetricCard
          icon={AlertCircle}
          label="Leads to follow up"
          value={leads.length}
          context={leads.length ? "sitting in the first stage — first touch wins" : "nothing waiting on you"}
          href="/crm/pipeline"
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Needs attention */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Inbox className="h-4 w-4 text-muted-foreground" /> Needs attention
            </CardTitle>
            <CardDescription>Leads that haven't moved yet.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-1.5">
            {leads.length === 0 ? (
              <EmptyState
                compact
                icon={CheckCircle2}
                title="All caught up"
                description="New leads land here until they move down the pipeline."
              />
            ) : (
              leads.slice(0, 5).map((p) => (
                <Link key={p.id} href={`/crm/projects/${p.id}`}>
                  <div className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5 hover:bg-accent transition-colors cursor-pointer">
                    <div className="min-w-0">
                      <div className="text-sm font-medium truncate">{p.name}</div>
                      <div className="text-xs text-muted-foreground">{p.number}</div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {canSeePrices && p.contractValueCents != null && (
                        <span className="text-sm font-medium tabular-nums">{money0(p.contractValueCents)}</span>
                      )}
                      <StatusPill tone={statusTone(p.status)}>{stageOf(p.status)?.label ?? p.status}</StatusPill>
                    </div>
                  </div>
                </Link>
              ))
            )}
          </CardContent>
        </Card>

        {/* Recent activity */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Activity className="h-4 w-4 text-muted-foreground" /> Recent projects
            </CardTitle>
            <CardDescription>The latest work on the board.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-1.5">
            {recent.length === 0 ? (
              <EmptyState
                compact
                icon={KanbanSquare}
                title="No projects yet"
                description="Create one from a client's page and it shows up here."
                action={
                  <Link href="/crm/clients">
                    <Button size="sm">Go to clients <ArrowRight className="h-4 w-4 ml-1" /></Button>
                  </Link>
                }
              />
            ) : (
              recent.map((p) => (
                <Link key={p.id} href={`/crm/projects/${p.id}`}>
                  <div className="flex items-center justify-between gap-3 rounded-lg px-3 py-2 hover:bg-accent transition-colors cursor-pointer">
                    <div className="min-w-0">
                      <div className="text-sm font-medium truncate">{p.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {p.number}{p.createdAt ? ` · ${new Date(p.createdAt).toLocaleDateString()}` : ""}
                      </div>
                    </div>
                    <StatusPill tone={statusTone(p.status)} className="shrink-0">
                      {stageOf(p.status)?.label ?? p.status}
                    </StatusPill>
                  </div>
                </Link>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      {/* Shortcuts */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Link href="/crm/clients">
          <Card className="hover:border-primary/40 hover:shadow-md transition-all cursor-pointer h-full" data-testid="card-clients">
            <CardContent className="p-5">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary mb-3">
                <Users className="h-4 w-4" strokeWidth={1.8} />
              </div>
              <div className="font-semibold">Clients</div>
              <p className="text-sm text-muted-foreground mt-1">Create clients, build and send estimates.</p>
            </CardContent>
          </Card>
        </Link>
        <Link href="/crm/team?tab=team">
          <Card className="hover:border-primary/40 hover:shadow-md transition-all cursor-pointer h-full" data-testid="card-team">
            <CardContent className="p-5">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary mb-3">
                <Users className="h-4 w-4" strokeWidth={1.8} />
              </div>
              <div className="font-semibold">Team</div>
              <p className="text-sm text-muted-foreground mt-1">Crew, roles and permissions.</p>
            </CardContent>
          </Card>
        </Link>
        <Link href="/crm/team?tab=company">
          <Card className="hover:border-primary/40 hover:shadow-md transition-all cursor-pointer h-full" data-testid="card-company">
            <CardContent className="p-5">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary mb-3">
                <Building2 className="h-4 w-4" strokeWidth={1.8} />
              </div>
              <div className="font-semibold">Company</div>
              <p className="text-sm text-muted-foreground mt-1">Details that print on estimates and invoices.</p>
            </CardContent>
          </Card>
        </Link>
      </div>
    </CrmPage>
  );
}
