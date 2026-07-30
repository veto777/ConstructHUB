import { useQuery, useMutation } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  CheckCircle2, Circle, ArrowRight, Loader2, Users, Building2,
  UserCircle, Lock, Sparkles, AlertTriangle,
} from "lucide-react";

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

/** Portal landing page. Never a dead end: it always offers the next action. */
export default function CrmHomePage() {
  const [, navigate] = useLocation();
  const { data: me } = useQuery<any>({ queryKey: ["/api/crm/me"] });
  const { data: ob, isLoading, isError } = useQuery<Onboarding>({ queryKey: ["/api/crm/onboarding"] });

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
      <div className="p-6 max-w-lg mx-auto mt-10">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5" /> Couldn't load your workspace
            </CardTitle>
            <CardDescription>Check your connection and refresh the page.</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  const pct = Math.round((ob.completedCount / ob.totalCount) * 100);
  const nextStep = ob.steps.find((s) => s.key === ob.nextStep);

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-3xl font-bold">
          {me?.org?.name ? me.org.name : "Welcome"}
        </h1>
        <p className="text-muted-foreground mt-1">
          {ob.requiredComplete
            ? "Your workspace is set up."
            : "A couple of things left before your workspace is ready."}
        </p>
      </div>

      {ob.showChecklist && (
        <Card data-testid="card-setup">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5" /> Finish setting up
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
                  className={`flex items-center gap-3 rounded-md border p-3 transition-colors ${
                    s.locked ? "opacity-60 cursor-not-allowed" : "hover:bg-accent cursor-pointer"
                  } ${isNext ? "border-primary" : ""}`}
                  data-testid={`step-${s.key}`}
                >
                  {s.done ? (
                    <CheckCircle2 className="h-5 w-5 text-green-600 shrink-0" />
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

      <div className="grid gap-4 sm:grid-cols-3">
        <Link href="/crm/clients">
          <Card className="hover:bg-accent transition-colors cursor-pointer h-full" data-testid="card-clients">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Users className="h-5 w-5" /> Clients
              </CardTitle>
              <CardDescription>Create clients, build and send estimates.</CardDescription>
            </CardHeader>
          </Card>
        </Link>
        <Link href="/crm/team?tab=team">
          <Card className="hover:bg-accent transition-colors cursor-pointer h-full" data-testid="card-team">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Users className="h-5 w-5" /> Team
              </CardTitle>
              <CardDescription>Crew, roles and permissions.</CardDescription>
            </CardHeader>
          </Card>
        </Link>
        <Link href="/crm/team?tab=company">
          <Card className="hover:bg-accent transition-colors cursor-pointer h-full" data-testid="card-company">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Building2 className="h-5 w-5" /> Company
              </CardTitle>
              <CardDescription>Details that print on estimates and invoices.</CardDescription>
            </CardHeader>
          </Card>
        </Link>
      </div>
    </div>
  );
}
