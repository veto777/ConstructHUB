import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useRoute, Link } from "wouter";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  ArrowLeft, Loader2, Plus, DollarSign, FileDiff,
  ClipboardCheck, NotebookPen, Palette, FileBadge, TrendingUp, TrendingDown,
} from "lucide-react";
import {
  CrmPage, StatusPill, EmptyState, ErrorCard, SectionTitle, crmTable, statusTone,
} from "@/components/crm-ui";

const money = (c?: number | null) =>
  c === null || c === undefined ? "—" : `$${(c / 100).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
const day = (d?: string | null) => (d ? new Date(d).toLocaleDateString() : "—");

export default function CrmProjectPage() {
  const [, params] = useRoute("/crm/projects/:id");
  const id = params?.id;
  const { toast } = useToast();
  const [tab, setTab] = useState("costing");

  const { data: me } = useQuery<any>({ queryKey: ["/api/crm/me"] });
  const seeCosts = me?.permissions?.seeCosts === true;

  const { data: projects, isLoading, isError } = useQuery<any>({ queryKey: ["/api/crm/projects"] });
  const project = projects?.projects?.find((p: any) => p.id === id);

  const { data: costing } = useQuery<any>({
    queryKey: [`/api/crm/projects/${id}/costing`], enabled: !!id && seeCosts, retry: false,
  });
  const { data: cos } = useQuery<any>({ queryKey: [`/api/crm/projects/${id}/change-orders`], enabled: !!id });
  const { data: punch } = useQuery<any>({ queryKey: [`/api/crm/projects/${id}/punch-items`], enabled: !!id });
  const { data: logs } = useQuery<any>({ queryKey: [`/api/crm/projects/${id}/daily-logs`], enabled: !!id });
  const { data: sels } = useQuery<any>({ queryKey: [`/api/crm/projects/${id}/selections`], enabled: !!id });
  const { data: permits } = useQuery<any>({ queryKey: [`/api/crm/projects/${id}/permits/suggest`], enabled: !!id });

  const post = (path: string, body: any, label: string, key: string) =>
    apiRequest("POST", `/api/crm/projects/${id}/${path}`, body).then(async (r) => {
      if (!r.ok) throw new Error(await r.text());
      queryClient.invalidateQueries({ queryKey: [key] });
      toast({ title: label });
      return r.json();
    }).catch((e) => toast({ title: `Could not add ${label}`, description: String(e.message ?? e), variant: "destructive" }));

  const [co, setCo] = useState({ title: "", amount: "", days: "0" });
  const [pu, setPu] = useState({ title: "", location: "" });
  const [lg, setLg] = useState({ workCompleted: "", weather: "", crewCount: "" });
  const [se, setSe] = useState({ name: "", category: "", allowance: "" });

  if (!id) return null;
  if (isLoading) {
    return <div className="flex justify-center p-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }
  if (isError || !project) {
    return (
      <ErrorCard
        title={isError ? "Couldn't load this project" : "Project not found"}
        description={isError
          ? "Check your connection and refresh the page."
          : "It may belong to a project manager other than you, or it's been removed."}
      >
        <Link href="/crm/pipeline">
          <Button variant="outline" size="sm"><ArrowLeft className="h-4 w-4 mr-1" /> Back to pipeline</Button>
        </Link>
      </ErrorCard>
    );
  }

  const t = costing?.totals;

  return (
    <CrmPage wide>
      <div className="space-y-3">
        <Link href="/crm/pipeline">
          <Button variant="ghost" size="sm" className="-ml-2">
            <ArrowLeft className="h-4 w-4 mr-1" /> Pipeline
          </Button>
        </Link>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <h1 className="text-2xl font-semibold tracking-tight">{project.name}</h1>
          <StatusPill tone={statusTone(project.status)}>{project.stageLabel}</StatusPill>
        </div>
        <div className="text-sm text-muted-foreground">{project.number} · {project.stageGroup}</div>
      </div>

      {seeCosts && t && (
        <div className="grid gap-4 sm:grid-cols-4">
          {[
            { label: "Revised contract", v: t.revisedContractCents, hint: `incl. ${money(t.changeOrderCents)} in COs` },
            { label: "Budget", v: t.budgetCents },
            { label: "Committed", v: t.committedCents, hint: "POs & subcontracts" },
            { label: "Actual cost", v: t.actualCents },
          ].map((s) => (
            <Card key={s.label}>
              <CardContent className="p-5">
                <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{s.label}</div>
                <div className="mt-1.5 text-2xl font-semibold tracking-tight tabular-nums">{money(s.v)}</div>
                {s.hint && <div className="mt-1.5 text-xs text-muted-foreground">{s.hint}</div>}
              </CardContent>
            </Card>
          ))}
          <Card className="sm:col-span-4 border-primary/25 bg-primary/5">
            <CardContent className="p-5 flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Gross profit</div>
                <div className="mt-1 text-3xl font-semibold tracking-tight tabular-nums flex items-center gap-2">
                  {money(t.grossProfitCents)}
                  {t.marginBps >= 0
                    ? <TrendingUp className="h-5 w-5 text-emerald-600" />
                    : <TrendingDown className="h-5 w-5 text-destructive" />}
                  <span className="text-base font-normal text-muted-foreground">
                    {(t.marginBps / 100).toFixed(1)}% margin
                  </span>
                </div>
              </div>
              <p className="text-xs text-muted-foreground max-w-sm">
                Budget vs committed vs actual, per cost code. Neither Housecall Pro nor Leap can produce this.
              </p>
            </CardContent>
          </Card>
        </div>
      )}

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="flex-wrap h-auto bg-muted/60 p-1">
          <TabsTrigger value="costing"><DollarSign className="h-4 w-4 mr-1" /> Costing</TabsTrigger>
          <TabsTrigger value="change-orders"><FileDiff className="h-4 w-4 mr-1" /> Change orders</TabsTrigger>
          <TabsTrigger value="punch"><ClipboardCheck className="h-4 w-4 mr-1" /> Punch list</TabsTrigger>
          <TabsTrigger value="logs"><NotebookPen className="h-4 w-4 mr-1" /> Daily logs</TabsTrigger>
          <TabsTrigger value="selections"><Palette className="h-4 w-4 mr-1" /> Selections</TabsTrigger>
          <TabsTrigger value="permits"><FileBadge className="h-4 w-4 mr-1" /> Permits</TabsTrigger>
        </TabsList>

        <TabsContent value="costing" className="mt-4">
          <Card>
            <CardHeader>
              <SectionTitle
                title="Budget vs actual by cost code"
                description="Committed = POs placed. Actual = vendor bills and labor posted."
              />
            </CardHeader>
            <CardContent>
              {!seeCosts ? (
                <p className="text-sm text-muted-foreground">You don't have permission to see costs.</p>
              ) : !costing?.lines?.length ? (
                <EmptyState compact icon={DollarSign} title="No budget lines on this project yet" />
              ) : (
                <div className={crmTable.wrapper}>
                  <table className={crmTable.table}>
                    <thead className={crmTable.thead}>
                      <tr>
                        <th className={crmTable.th}>Code</th><th className={crmTable.th}>Name</th>
                        <th className={crmTable.thRight}>Budget</th><th className={crmTable.thRight}>Committed</th>
                        <th className={crmTable.thRight}>Actual</th><th className={crmTable.thRight}>Variance</th>
                      </tr>
                    </thead>
                    <tbody>
                      {costing.lines.map((l: any) => (
                        <tr key={l.costCodeId} className={`${crmTable.tr} ${l.overBudget ? "bg-destructive/5" : ""}`}
                          data-testid={`cost-line-${l.code}`}>
                          <td className={`${crmTable.td} font-mono text-xs`}>{l.code}</td>
                          <td className={crmTable.td}>{l.name}</td>
                          <td className={crmTable.tdRight}>{money(l.budgetCents)}</td>
                          <td className={crmTable.tdRight}>{money(l.committedCents)}</td>
                          <td className={crmTable.tdRight}>{money(l.actualCents)}</td>
                          <td className={`${crmTable.tdRight} font-medium ${l.varianceCents < 0 ? "text-destructive" : ""}`}>
                            {money(l.varianceCents)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="change-orders" className="mt-4">
          <Card>
            <CardHeader>
              <SectionTitle
                title="Change orders"
                description="An approved CO adjusts the contract value and the schedule together."
              />
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid gap-2 sm:grid-cols-4 items-end rounded-lg border bg-muted/30 p-3">
                <div className="sm:col-span-2">
                  <Label className="text-xs">Title</Label>
                  <Input value={co.title} onChange={(e) => setCo({ ...co, title: e.target.value })}
                    placeholder="Add cedar trim to gable" data-testid="input-co-title" />
                </div>
                <div><Label className="text-xs">Amount $</Label>
                  <Input type="number" value={co.amount} onChange={(e) => setCo({ ...co, amount: e.target.value })} /></div>
                <div className="flex gap-2">
                  <div><Label className="text-xs">+Days</Label>
                    <Input type="number" value={co.days} onChange={(e) => setCo({ ...co, days: e.target.value })} /></div>
                  <Button className="self-end" data-testid="button-add-co"
                    onClick={() => co.title && post("change-orders", {
                      title: co.title, amountCents: Math.round((parseFloat(co.amount) || 0) * 100),
                      scheduleImpactDays: parseInt(co.days) || 0,
                    }, "Change order added", `/api/crm/projects/${id}/change-orders`).then(() => setCo({ title: "", amount: "", days: "0" }))}>
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>
              </div>
              {cos?.map((c: any) => (
                <div key={c.id} className="rounded-lg border px-4 py-3 flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="font-medium">{c.number} · {c.title}</div>
                    <div className="text-sm text-muted-foreground tabular-nums">
                      {c.amountCents != null && money(c.amountCents)}
                      {c.scheduleImpactDays ? ` · +${c.scheduleImpactDays} days` : ""}
                    </div>
                  </div>
                  <StatusPill tone={c.approvedAt ? "success" : c.declinedAt ? "danger" : statusTone(c.status)}>
                    {c.status}
                  </StatusPill>
                </div>
              ))}
              {!cos?.length && <EmptyState compact icon={FileDiff} title="No change orders" />}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="punch" className="mt-4">
          <Card>
            <CardHeader><SectionTitle title="Punch list" /></CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap gap-2 items-end rounded-lg border bg-muted/30 p-3">
                <div className="flex-1 min-w-[200px]"><Label className="text-xs">Item</Label>
                  <Input value={pu.title} onChange={(e) => setPu({ ...pu, title: e.target.value })}
                    placeholder="Touch up paint at north corner" data-testid="input-punch-title" /></div>
                <div><Label className="text-xs">Location</Label>
                  <Input value={pu.location} onChange={(e) => setPu({ ...pu, location: e.target.value })} /></div>
                <Button data-testid="button-add-punch"
                  onClick={() => pu.title && post("punch-items", { title: pu.title, location: pu.location || null },
                    "Punch item added", `/api/crm/projects/${id}/punch-items`).then(() => setPu({ title: "", location: "" }))}>
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
              {punch?.map((p: any) => (
                <div key={p.id} className="rounded-lg border px-4 py-3 flex items-center justify-between gap-2">
                  <div>
                    <div className="font-medium">{p.title}</div>
                    {p.location && <div className="text-sm text-muted-foreground">{p.location}</div>}
                  </div>
                  <StatusPill tone={p.status === "done" ? "success" : "neutral"}>{p.status}</StatusPill>
                </div>
              ))}
              {!punch?.length && <EmptyState compact icon={ClipboardCheck} title="Nothing on the punch list" />}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="logs" className="mt-4">
          <Card>
            <CardHeader>
              <SectionTitle title="Daily logs" description="Any crew member can file one." />
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-2 rounded-lg border bg-muted/30 p-3">
                <Textarea rows={2} value={lg.workCompleted} placeholder="What got done today?"
                  onChange={(e) => setLg({ ...lg, workCompleted: e.target.value })} data-testid="input-log-work" />
                <div className="flex flex-wrap gap-2 items-end">
                  <div><Label className="text-xs">Weather</Label>
                    <Input value={lg.weather} onChange={(e) => setLg({ ...lg, weather: e.target.value })} /></div>
                  <div><Label className="text-xs">Crew</Label>
                    <Input type="number" value={lg.crewCount} onChange={(e) => setLg({ ...lg, crewCount: e.target.value })} /></div>
                  <Button data-testid="button-add-log"
                    onClick={() => lg.workCompleted && post("daily-logs", {
                      workCompleted: lg.workCompleted, weather: lg.weather || null,
                      crewCount: parseInt(lg.crewCount) || null,
                    }, "Log filed", `/api/crm/projects/${id}/daily-logs`).then(() => setLg({ workCompleted: "", weather: "", crewCount: "" }))}>
                    <Plus className="h-4 w-4 mr-1" /> File log
                  </Button>
                </div>
              </div>
              {logs?.map((l: any) => (
                <div key={l.id} className="rounded-lg border px-4 py-3">
                  <div className="text-xs text-muted-foreground">
                    {day(l.logDate)}{l.weather ? ` · ${l.weather}` : ""}{l.crewCount ? ` · ${l.crewCount} crew` : ""}
                  </div>
                  <div className="text-sm mt-1 whitespace-pre-wrap">{l.workCompleted}</div>
                </div>
              ))}
              {!logs?.length && <EmptyState compact icon={NotebookPen} title="No logs yet" />}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="selections" className="mt-4">
          <Card>
            <CardHeader>
              <SectionTitle
                title="Selections & allowances"
                description="Overage above the allowance is billable to the homeowner."
              />
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap gap-2 items-end rounded-lg border bg-muted/30 p-3">
                <div className="flex-1 min-w-[180px]"><Label className="text-xs">Selection</Label>
                  <Input value={se.name} onChange={(e) => setSe({ ...se, name: e.target.value })}
                    placeholder="Front door" data-testid="input-sel-name" /></div>
                <div><Label className="text-xs">Category</Label>
                  <Input value={se.category} onChange={(e) => setSe({ ...se, category: e.target.value })} /></div>
                <div><Label className="text-xs">Allowance $</Label>
                  <Input type="number" value={se.allowance} onChange={(e) => setSe({ ...se, allowance: e.target.value })} /></div>
                <Button data-testid="button-add-sel"
                  onClick={() => se.name && post("selections", {
                    name: se.name, category: se.category || null,
                    allowanceCents: Math.round((parseFloat(se.allowance) || 0) * 100),
                  }, "Selection added", `/api/crm/projects/${id}/selections`).then(() => setSe({ name: "", category: "", allowance: "" }))}>
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
              {sels?.map((s: any) => {
                const over = s.actualCents != null && s.actualCents > s.allowanceCents;
                return (
                  <div key={s.id} className="rounded-lg border px-4 py-3 flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <div className="font-medium">{s.name}{s.category ? ` · ${s.category}` : ""}</div>
                      <div className="text-sm text-muted-foreground tabular-nums">
                        Allowance {money(s.allowanceCents)}
                        {s.actualCents != null && ` · actual ${money(s.actualCents)}`}
                        {over && <span className="text-destructive font-medium"> · over by {money(s.actualCents - s.allowanceCents)}</span>}
                      </div>
                    </div>
                    <StatusPill tone={statusTone(s.status)}>{s.status}</StatusPill>
                  </div>
                );
              })}
              {!sels?.length && <EmptyState compact icon={Palette} title="No selections yet" />}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="permits" className="mt-4">
          <Card>
            <CardHeader>
              <SectionTitle
                title="Permits & inspections"
                description="Verified portals matched to this project's jurisdiction — every URL is liveness-checked. No competitor can do this."
              />
            </CardHeader>
            <CardContent className="space-y-2">
              {permits?.message && <p className="text-sm text-muted-foreground">{permits.message}</p>}
              {permits?.jurisdiction && (
                <p className="text-sm text-muted-foreground">Matched on <strong>{permits.jurisdiction}</strong></p>
              )}
              {permits?.portals?.map((p: any) => (
                <div key={p.id} className="rounded-lg border px-4 py-3 flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-medium truncate">{p.name}</div>
                    <div className="text-sm text-muted-foreground">{p.jurisdiction}{p.phone ? ` · ${p.phone}` : ""}</div>
                  </div>
                  {(p.searchUrl || p.portalUrl) && (
                    <a href={p.searchUrl || p.portalUrl} target="_blank" rel="noreferrer">
                      <Button size="sm" variant="outline">Open portal</Button>
                    </a>
                  )}
                </div>
              ))}
              {permits && !permits.portals?.length && !permits.message && (
                <EmptyState
                  compact
                  icon={FileBadge}
                  title="No verified portal on file for this jurisdiction"
                  description="We won't invent one — search manually."
                />
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </CrmPage>
  );
}
