import { governmentLinkNotice } from "@shared/government-links";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRoute, Link, useLocation, useSearch } from "wouter";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { apiIssueMessage } from "@/lib/api-issue-message";
import {
  ArrowLeft, Loader2, Plus, DollarSign, FileDiff, ClipboardCheck, ClipboardCopy, NotebookPen,
  Palette, FileBadge, TrendingUp, TrendingDown, Send, Check, RotateCcw, Pencil, Trash2, Camera,
} from "lucide-react";
import { JobcamPanel } from "@/components/jobcam/project-panel";
import {
  CrmPage, StatusPill, EmptyState, ErrorCard, SectionTitle, crmTable, statusTone,
} from "@/components/crm-ui";

// Cents → "$1,250.50" / "-$200.00": currency style puts the sign before the $.
const money = (c?: number | null) =>
  c === null || c === undefined ? "—" : (c / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
const day = (d?: string | null) => (d ? new Date(d).toLocaleDateString() : "—");
/** The viewer's local calendar day of a timestamp, as YYYY-MM-DD (a date input's value). */
const localDay = (d: string) => {
  const x = new Date(d);
  if (Number.isNaN(x.getTime())) return "";
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
};
const cents = (v: string) => Math.round((parseFloat(v) || 0) * 100);

const TABS = ["costing", "change-orders", "punch", "logs", "selections", "permits", "jobcam"] as const;
const SELECTION_STATUSES = ["pending", "chosen", "ordered", "installed"] as const;

/** Server field keys → the words on these forms, for validation toasts. */
const FIELD_LABELS: Record<string, string> = {
  title: "Title", amountCents: "Amount", scheduleImpactDays: "+Days", location: "Location",
  workCompleted: "Work completed", weather: "Weather", crewCount: "Crew", logDate: "Date", name: "Selection",
  category: "Category", allowanceCents: "Allowance", actualCents: "Actual cost",
  chosenOptionName: "Chosen option", budgetCents: "Amount", costCodeId: "Cost code", description: "Description",
};

/** The costing form's entry kinds → the route each one posts to. */
const COST_ENTRY_KINDS: { value: string; label: string; noun: string; done: string }[] = [
  { value: "budget", label: "Budget", noun: "budget line", done: "Budget line added" },
  { value: "commitment", label: "Committed — PO / subcontract", noun: "commitment", done: "Commitment added" },
  { value: "vendor_bill", label: "Actual — vendor bill", noun: "cost", done: "Cost posted" },
  { value: "labor", label: "Actual — labor", noun: "cost", done: "Cost posted" },
  { value: "expense", label: "Actual — expense", noun: "cost", done: "Cost posted" },
];

export default function CrmProjectPage() {
  const [, params] = useRoute("/crm/projects/:id");
  const id = params?.id;
  const { toast } = useToast();
  // The tab lives in ?tab= so a reload (or a shared link) lands on the same one.
  const search = useSearch();
  const [, navigate] = useLocation();
  const tabParam = new URLSearchParams(search).get("tab");
  const tab = (TABS as readonly string[]).includes(tabParam ?? "") ? tabParam! : "costing";
  const setTab = (t: string) => navigate(`/crm/projects/${id}?tab=${t}`, { replace: true });

  const { data: me } = useQuery<any>({ queryKey: ["/api/crm/me"] });
  const perms = me?.permissions ?? {};
  const seeCosts = perms.seeCosts === true;
  const canManageJobs = perms.manageJobs === true;
  const canSendCo = perms.approveChangeOrders === true;

  const { data: projects, isLoading, isError } = useQuery<any>({ queryKey: ["/api/crm/projects"] });
  const inList = projects?.projects?.find((p: any) => p.id === id);
  // The board list caps at the newest 2000 — a direct link to an older project
  // falls back to the single-record route instead of reading "not found".
  const listSettled = !isLoading && !!projects;
  const { data: direct, isError: directError, isLoading: directLoading } = useQuery<any>({
    queryKey: [`/api/crm/projects/${id}`],
    enabled: !!id && listSettled && !inList,
    retry: false,
  });
  const project = inList ?? (direct && direct.id === id ? direct : null);
  // Children only load once the project is known to exist (and be visible) —
  // a bad id renders "Project not found" without six 404s behind it.
  const ready = !!project;

  const { data: costing, isError: costingError } = useQuery<any>({
    queryKey: [`/api/crm/projects/${id}/costing`], enabled: ready && seeCosts, retry: false,
  });
  const { data: costCodes } = useQuery<any[]>({ queryKey: ["/api/crm/cost-codes"], enabled: ready && seeCosts });
  const { data: cos, isLoading: cosLoading, isError: cosError } = useQuery<any>({ queryKey: [`/api/crm/projects/${id}/change-orders`], enabled: ready });
  const { data: punch, isError: punchError } = useQuery<any>({ queryKey: [`/api/crm/projects/${id}/punch-items`], enabled: ready });
  const { data: logs, isError: logsError } = useQuery<any>({ queryKey: [`/api/crm/projects/${id}/daily-logs`], enabled: ready });
  const { data: sels, isError: selsError } = useQuery<any>({ queryKey: [`/api/crm/projects/${id}/selections`], enabled: ready });
  const { data: permits, isError: permitsError } = useQuery<any>({ queryKey: [`/api/crm/projects/${id}/permits/suggest`], enabled: ready });

  /** POST a project child. Resolves true on success so a form resets only then. */
  const post = (path: string, body: any, noun: string, done: string, key: string): Promise<boolean> =>
    apiRequest("POST", `/api/crm/projects/${id}/${path}`, body).then(() => {
      queryClient.invalidateQueries({ queryKey: [key] });
      toast({ title: done });
      return true;
    }).catch((e) => {
      toast({ title: `Could not add ${noun}`, description: apiIssueMessage(e, FIELD_LABELS), variant: "destructive" });
      return false;
    });

  /** PATCH a punch item / selection (the routes projectChild registers). */
  const patchChild = (path: string, childId: string, body: any, noun: string, done: string, key: string): Promise<boolean> =>
    apiRequest("PATCH", `/api/crm/${path}/${childId}`, body).then(() => {
      queryClient.invalidateQueries({ queryKey: [key] });
      toast({ title: done });
      return true;
    }).catch((e) => {
      toast({ title: `Could not update ${noun}`, description: apiIssueMessage(e, FIELD_LABELS), variant: "destructive" });
      return false;
    });

  /** Copy a CO's client link; if the clipboard is unavailable, show the link to copy by hand. */
  const copyLink = async (link: string, copied: string, manual: string) => {
    try {
      await navigator.clipboard.writeText(link);
      toast({ title: copied, description: "Share it with the homeowner — they approve or decline on that page." });
    } catch {
      toast({ title: manual, description: link });
    }
  };
  const [sendingCo, setSendingCo] = useState<string | null>(null);
  const sendCo = (coId: string) => {
    setSendingCo(coId);
    apiRequest("POST", `/api/crm/change-orders/${coId}/send`, {})
      .then((r) => r.json())
      .then((r) => {
        queryClient.invalidateQueries({ queryKey: [`/api/crm/projects/${id}/change-orders`] });
        return copyLink(r.link, "Marked sent — client link copied", "Marked sent — copy the client link below");
      })
      .catch((e) => toast({ title: "Could not send change order", description: apiIssueMessage(e), variant: "destructive" }))
      .finally(() => setSendingCo(null));
  };

  const [co, setCo] = useState({ title: "", amount: "", days: "0" });
  const [pu, setPu] = useState({ title: "", location: "" });
  const [lg, setLg] = useState({ workCompleted: "", weather: "", crewCount: "" });
  const [se, setSe] = useState({ name: "", category: "", allowance: "" });
  const [ce, setCe] = useState({ kind: "vendor_bill", costCodeId: "", amount: "", description: "" });
  // Selection being edited inline: its id + the draft values.
  const [selEdit, setSelEdit] = useState<{ id: string; chosen: string; actual: string; status: string } | null>(null);

  // Daily logs: the author fixes their own, a manageJobs seat anyone's (the
  // server enforces the same rule and says so on a 403). Edited inline like a
  // selection; `date` is the calendar day the list shows (the viewer's local day).
  type LogDraft = { id: string; date: string; origDate: string; workCompleted: string; weather: string; crewCount: string };
  const [logEdit, setLogEdit] = useState<LogDraft | null>(null);
  const [deletingLog, setDeletingLog] = useState<string | null>(null);
  const logsKey = `/api/crm/projects/${id}/daily-logs`;
  const canChangeLog = (l: any) => canManageJobs || (!!me?.member?.id && l.authorMemberId === me.member.id);
  const saveLog = (draft: LogDraft) => {
    const body: Record<string, unknown> = {
      workCompleted: draft.workCompleted.trim(),
      weather: draft.weather.trim() || null,
      crewCount: draft.crewCount === "" ? null : parseInt(draft.crewCount),
    };
    // Only a changed day is sent, as local noon: the stored time is then the
    // picked day in the viewer's zone, so the list never shows the day before.
    if (draft.date && draft.date !== draft.origDate) body.logDate = new Date(`${draft.date}T12:00:00`).toISOString();
    patchChild("daily-logs", draft.id, body, "daily log", "Log updated", logsKey)
      .then((ok) => ok && setLogEdit(null));
  };
  const deleteLog = (logId: string) => {
    if (!window.confirm("Delete this daily log? This can't be undone.")) return;
    setDeletingLog(logId);
    apiRequest("DELETE", `/api/crm/daily-logs/${logId}`)
      .then(() => {
        queryClient.invalidateQueries({ queryKey: [logsKey] });
        if (logEdit?.id === logId) setLogEdit(null);
        toast({ title: "Log deleted" });
      })
      .catch((e) => toast({ title: "Could not delete daily log", description: apiIssueMessage(e), variant: "destructive" }))
      .finally(() => setDeletingLog(null));
  };

  const addCostEntry = () => {
    const kind = COST_ENTRY_KINDS.find((k) => k.value === ce.kind)!;
    const amountCents = cents(ce.amount);
    const description = ce.description.trim() || null;
    const [path, body] = ce.kind === "budget"
      ? ["budget-lines", { costCodeId: ce.costCodeId, budgetCents: amountCents, notes: description }]
      : ce.kind === "commitment"
        ? ["commitments", { costCodeId: ce.costCodeId, amountCents, description }]
        : ["costs", { costCodeId: ce.costCodeId, amountCents, description, source: ce.kind }];
    post(path as string, body, kind.noun, kind.done, `/api/crm/projects/${id}/costing`)
      .then((ok) => ok && setCe({ ...ce, amount: "", description: "" }));
  };

  if (!id) return null;
  if (isLoading || (listSettled && !inList && directLoading)) {
    return <div className="flex justify-center p-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }
  if (isError || directError || !project) {
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
  const kindOptions = COST_ENTRY_KINDS.filter((k) => k.value !== "budget" || canManageJobs);

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
                {/* With nothing posted, "profit" would just be the contract at a
                    100% margin — say what's missing instead of claiming that. */}
                {t.actualCents > 0 ? (
                  <div className="mt-1 text-3xl font-semibold tracking-tight tabular-nums flex items-center gap-2"
                    data-testid="text-gross-profit">
                    {money(t.grossProfitCents)}
                    {t.grossProfitCents >= 0
                      ? <TrendingUp className="h-5 w-5 text-emerald-600" />
                      : <TrendingDown className="h-5 w-5 text-destructive" />}
                    <span className="text-base font-normal text-muted-foreground">
                      {t.revisedContractCents > 0 ? `${(t.marginBps / 100).toFixed(1)}% margin` : "no contract value set"}
                    </span>
                  </div>
                ) : (
                  <div className="mt-1 text-base text-muted-foreground" data-testid="text-gross-profit">
                    No costs posted yet — profit and margin show once bills or labor are recorded.
                  </div>
                )}
              </div>
              <p className="text-xs text-muted-foreground max-w-sm">
                Revised contract minus actual cost posted so far. Budget vs committed vs actual, per cost code, is below.
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
          <TabsTrigger value="jobcam" data-testid="tab-jobcam"><Camera className="h-4 w-4 mr-1" /> JobCam</TabsTrigger>
        </TabsList>

        {/* JobCam — job-site photos/video for this project (full feed at /crm/projects/:id/jobcam). */}
        <TabsContent value="jobcam" className="mt-4">
          <Card><CardContent className="p-4 sm:p-5"><JobcamPanel projectId={id} /></CardContent></Card>
        </TabsContent>

        <TabsContent value="costing" className="mt-4">
          <Card>
            <CardHeader>
              <SectionTitle
                title="Budget vs actual by cost code"
                description="Committed = POs placed. Actual = vendor bills and labor posted."
              />
            </CardHeader>
            <CardContent className="space-y-3">
              {seeCosts && !costingError && (
                costCodes && !costCodes.length ? (
                  <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-muted/30 p-3">
                    <p className="text-sm text-muted-foreground">
                      No cost codes yet — budget and costs are tracked per cost code.
                      {!perms.manageSettings && " Ask an account admin to add the starter set here."}
                    </p>
                    {perms.manageSettings && (
                      <Button size="sm" variant="outline" data-testid="button-seed-cost-codes"
                        onClick={() => apiRequest("POST", "/api/crm/cost-codes/seed", {}).then((r) => r.json()).then((r) => {
                          queryClient.invalidateQueries({ queryKey: ["/api/crm/cost-codes"] });
                          toast({ title: `Added ${r.added} starter cost codes` });
                        }).catch((e) => toast({ title: "Could not add cost codes", description: apiIssueMessage(e), variant: "destructive" }))}>
                        <Plus className="h-4 w-4 mr-1" /> Add starter cost codes
                      </Button>
                    )}
                  </div>
                ) : (
                  <div className="grid gap-2 sm:grid-cols-12 items-end rounded-lg border bg-muted/30 p-3" data-testid="form-cost-entry">
                    <div className="sm:col-span-3"><Label className="text-xs">Entry</Label>
                      <Select value={ce.kind} onValueChange={(v) => setCe({ ...ce, kind: v })}>
                        <SelectTrigger data-testid="select-cost-kind"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {kindOptions.map((k) => <SelectItem key={k.value} value={k.value}>{k.label}</SelectItem>)}
                        </SelectContent>
                      </Select></div>
                    <div className="sm:col-span-3"><Label className="text-xs">Cost code</Label>
                      <Select value={ce.costCodeId} onValueChange={(v) => setCe({ ...ce, costCodeId: v })}>
                        <SelectTrigger data-testid="select-cost-code"><SelectValue placeholder="Pick a cost code" /></SelectTrigger>
                        <SelectContent>
                          {costCodes?.map((c: any) => (
                            <SelectItem key={c.id} value={c.id}>{c.code} · {c.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select></div>
                    <div className="sm:col-span-3"><Label className="text-xs">{ce.kind === "budget" ? "Notes" : "Vendor / description"}</Label>
                      <Input value={ce.description} maxLength={2000}
                        onChange={(e) => setCe({ ...ce, description: e.target.value })} data-testid="input-cost-desc" /></div>
                    <div className="sm:col-span-2"><Label className="text-xs">Amount $</Label>
                      <Input type="number" min={0} step="0.01" value={ce.amount}
                        onChange={(e) => setCe({ ...ce, amount: e.target.value })} data-testid="input-cost-amount" /></div>
                    <Button className="sm:col-span-1" data-testid="button-add-cost"
                      disabled={!ce.costCodeId || ce.amount === "" || !(parseFloat(ce.amount) >= 0)}
                      onClick={addCostEntry}>
                      <Plus className="h-4 w-4" />
                    </Button>
                  </div>
                )
              )}
              {!seeCosts ? (
                <p className="text-sm text-muted-foreground">You don't have permission to see costs.</p>
              ) : costingError ? (
                <p className="text-sm text-destructive">Couldn't load costing — check your connection and refresh the page.</p>
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
                        // The costing API returns one "Unassigned" line with
                        // costCodeId null — give it a stable, unique key.
                        <tr key={l.costCodeId ?? "unassigned"} className={`${crmTable.tr} ${l.overBudget ? "bg-destructive/5" : ""}`}
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
                  <Input value={co.title} maxLength={200} onChange={(e) => setCo({ ...co, title: e.target.value })}
                    placeholder="Add cedar trim to gable" data-testid="input-co-title" />
                </div>
                <div><Label className="text-xs">Amount $</Label>
                  <Input type="number" step="0.01" value={co.amount} onChange={(e) => setCo({ ...co, amount: e.target.value })} /></div>
                <div className="flex gap-2">
                  <div><Label className="text-xs">+Days</Label>
                    <Input type="number" min={-365} max={365} value={co.days} onChange={(e) => setCo({ ...co, days: e.target.value })} /></div>
                  <Button className="self-end" data-testid="button-add-co" disabled={!co.title.trim()}
                    onClick={() => post("change-orders", {
                      title: co.title.trim(), amountCents: cents(co.amount),
                      scheduleImpactDays: parseInt(co.days) || 0,
                    }, "change order", "Change order added", `/api/crm/projects/${id}/change-orders`)
                      .then((ok) => ok && setCo({ title: "", amount: "", days: "0" }))}>
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>
              </div>
              {cos?.map((c: any) => (
                <div key={c.id} className="rounded-lg border px-4 py-3 flex flex-wrap items-center justify-between gap-2"
                  data-testid={`co-row-${c.id}`}>
                  <div className="min-w-0">
                    <div className="font-medium">{c.number} · {c.title}</div>
                    <div className="text-sm text-muted-foreground tabular-nums">
                      {c.amountCents != null && money(c.amountCents)}
                      {c.scheduleImpactDays ? ` · ${c.scheduleImpactDays > 0 ? "+" : ""}${c.scheduleImpactDays} days` : ""}
                      {c.sentAt ? ` · sent ${day(c.sentAt)}` : ""}
                      {c.sentAt && !c.approvedAt && !c.declinedAt ? (c.firstViewedAt ? " · opened" : " · not opened yet") : ""}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {c.status === "draft" && canSendCo && (
                      <Button size="sm" variant="outline" disabled={sendingCo === c.id} onClick={() => sendCo(c.id)}
                        title="Marks it sent and copies the client's approval link for you to share"
                        data-testid={`button-send-co-${c.id}`}>
                        {sendingCo === c.id ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Send className="h-4 w-4 mr-1" />}
                        Mark sent & copy link
                      </Button>
                    )}
                    {c.status !== "draft" && c.publicPath && (
                      <Button size="sm" variant="ghost" data-testid={`button-copy-co-${c.id}`}
                        onClick={() => copyLink(window.location.origin + c.publicPath, "Client link copied", "Copy the client link below")}>
                        <ClipboardCopy className="h-4 w-4 mr-1" /> Copy client link
                      </Button>
                    )}
                    <StatusPill tone={c.approvedAt ? "success" : c.declinedAt ? "danger" : statusTone(c.status)}>
                      {c.status}
                    </StatusPill>
                  </div>
                </div>
              ))}
              {cosLoading ? (
                <div className="flex justify-center py-4"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
              ) : cosError ? (
                <p className="text-sm text-destructive">Couldn't load change orders — refresh to try again.</p>
              ) : !cos?.length && <EmptyState compact icon={FileDiff} title="No change orders" />}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="punch" className="mt-4">
          <Card>
            <CardHeader><SectionTitle title="Punch list" /></CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap gap-2 items-end rounded-lg border bg-muted/30 p-3">
                <div className="flex-1 min-w-[200px]"><Label className="text-xs">Item</Label>
                  <Input value={pu.title} maxLength={300} onChange={(e) => setPu({ ...pu, title: e.target.value })}
                    placeholder="Touch up paint at north corner" data-testid="input-punch-title" /></div>
                <div><Label className="text-xs">Location</Label>
                  <Input value={pu.location} maxLength={200} onChange={(e) => setPu({ ...pu, location: e.target.value })} /></div>
                <Button data-testid="button-add-punch" disabled={!pu.title.trim()}
                  onClick={() => post("punch-items", { title: pu.title.trim(), location: pu.location.trim() || null },
                    "punch item", "Punch item added", `/api/crm/projects/${id}/punch-items`)
                    .then((ok) => ok && setPu({ title: "", location: "" }))}>
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
              {punch?.map((p: any) => (
                <div key={p.id} className="rounded-lg border px-4 py-3 flex flex-wrap items-center justify-between gap-2"
                  data-testid={`punch-row-${p.id}`}>
                  <div className="min-w-0">
                    <div className={`font-medium ${p.status === "done" ? "line-through text-muted-foreground" : ""}`}>{p.title}</div>
                    {p.location && <div className="text-sm text-muted-foreground">{p.location}</div>}
                  </div>
                  <div className="flex items-center gap-2">
                    {canManageJobs && (
                      <Button size="sm" variant="outline" data-testid={`button-toggle-punch-${p.id}`}
                        onClick={() => patchChild("punch-items", p.id, { status: p.status === "done" ? "open" : "done" },
                          "punch item", p.status === "done" ? "Reopened" : "Marked done", `/api/crm/projects/${id}/punch-items`)}>
                        {p.status === "done"
                          ? <><RotateCcw className="h-4 w-4 mr-1" /> Reopen</>
                          : <><Check className="h-4 w-4 mr-1" /> Done</>}
                      </Button>
                    )}
                    <StatusPill tone={p.status === "done" ? "success" : "neutral"}>{p.status}</StatusPill>
                  </div>
                </div>
              ))}
              {punchError ? (
                <p className="text-sm text-destructive">Couldn't load the punch list — refresh to try again.</p>
              ) : !punch?.length && <EmptyState compact icon={ClipboardCheck} title="Nothing on the punch list" />}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="logs" className="mt-4">
          <Card>
            <CardHeader>
              <SectionTitle title="Daily logs" description="Any crew member can file one and edit their own; anyone who manages jobs can edit them all." />
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-2 rounded-lg border bg-muted/30 p-3">
                <Textarea rows={2} value={lg.workCompleted} placeholder="What got done today?" maxLength={20000}
                  onChange={(e) => setLg({ ...lg, workCompleted: e.target.value })} data-testid="input-log-work" />
                <div className="flex flex-wrap gap-2 items-end">
                  <div><Label className="text-xs">Weather</Label>
                    <Input value={lg.weather} maxLength={100} onChange={(e) => setLg({ ...lg, weather: e.target.value })} /></div>
                  <div><Label className="text-xs">Crew</Label>
                    <Input type="number" min={0} max={500} value={lg.crewCount} onChange={(e) => setLg({ ...lg, crewCount: e.target.value })} /></div>
                  <Button data-testid="button-add-log" disabled={!lg.workCompleted.trim()}
                    onClick={() => post("daily-logs", {
                      workCompleted: lg.workCompleted.trim(), weather: lg.weather.trim() || null,
                      crewCount: lg.crewCount === "" ? null : parseInt(lg.crewCount),
                    }, "daily log", "Log filed", `/api/crm/projects/${id}/daily-logs`)
                      .then((ok) => ok && setLg({ workCompleted: "", weather: "", crewCount: "" }))}>
                    <Plus className="h-4 w-4 mr-1" /> File log
                  </Button>
                </div>
              </div>
              {logs?.map((l: any) => {
                const editing = logEdit?.id === l.id ? logEdit : null;
                return (
                  <div key={l.id} className="rounded-lg border px-4 py-3 space-y-3" data-testid={`log-row-${l.id}`}>
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-xs text-muted-foreground">
                          {day(l.logDate)}{l.weather ? ` · ${l.weather}` : ""}{l.crewCount ? ` · ${l.crewCount} crew` : ""}
                        </div>
                        <div className="text-sm mt-1 whitespace-pre-wrap">{l.workCompleted}</div>
                      </div>
                      {canChangeLog(l) && !editing && (
                        <div className="flex items-center gap-1 shrink-0">
                          <Button size="sm" variant="ghost" data-testid={`button-edit-log-${l.id}`}
                            onClick={() => {
                              const date = localDay(l.logDate);
                              setLogEdit({
                                id: l.id, date, origDate: date, workCompleted: l.workCompleted ?? "",
                                weather: l.weather ?? "", crewCount: l.crewCount != null ? String(l.crewCount) : "",
                              });
                            }}>
                            <Pencil className="h-4 w-4 mr-1" /> Edit
                          </Button>
                          <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive"
                            aria-label="Delete this daily log" title="Delete this daily log"
                            disabled={deletingLog === l.id} data-testid={`button-delete-log-${l.id}`}
                            onClick={() => deleteLog(l.id)}>
                            {deletingLog === l.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                          </Button>
                        </div>
                      )}
                    </div>
                    {editing && (
                      <div className="space-y-2 rounded-lg border bg-muted/30 p-3">
                        <Textarea rows={3} value={editing.workCompleted} maxLength={20000}
                          onChange={(e) => setLogEdit({ ...editing, workCompleted: e.target.value })}
                          data-testid="input-edit-log-work" />
                        <div className="flex flex-wrap gap-2 items-end">
                          <div><Label className="text-xs">Date</Label>
                            <Input type="date" value={editing.date}
                              onChange={(e) => setLogEdit({ ...editing, date: e.target.value })}
                              data-testid="input-edit-log-date" /></div>
                          <div><Label className="text-xs">Weather</Label>
                            <Input value={editing.weather} maxLength={100}
                              onChange={(e) => setLogEdit({ ...editing, weather: e.target.value })} /></div>
                          <div><Label className="text-xs">Crew</Label>
                            <Input type="number" min={0} max={500} value={editing.crewCount}
                              onChange={(e) => setLogEdit({ ...editing, crewCount: e.target.value })} /></div>
                          <Button size="sm" variant="ghost" onClick={() => setLogEdit(null)}>Cancel</Button>
                          <Button size="sm" data-testid="button-save-log"
                            disabled={!editing.workCompleted.trim() || !editing.date}
                            onClick={() => saveLog(editing)}>
                            Save
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
              {logsError ? (
                <p className="text-sm text-destructive">Couldn't load daily logs — refresh to try again.</p>
              ) : !logs?.length && <EmptyState compact icon={NotebookPen} title="No logs yet" />}
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
                  <Input value={se.name} maxLength={200} onChange={(e) => setSe({ ...se, name: e.target.value })}
                    placeholder="Front door" data-testid="input-sel-name" /></div>
                <div><Label className="text-xs">Category</Label>
                  <Input value={se.category} maxLength={100} onChange={(e) => setSe({ ...se, category: e.target.value })} /></div>
                <div><Label className="text-xs">Allowance $</Label>
                  <Input type="number" min={0} step="0.01" value={se.allowance} onChange={(e) => setSe({ ...se, allowance: e.target.value })} /></div>
                <Button data-testid="button-add-sel" disabled={!se.name.trim()}
                  onClick={() => post("selections", {
                    name: se.name.trim(), category: se.category.trim() || null,
                    allowanceCents: cents(se.allowance),
                  }, "selection", "Selection added", `/api/crm/projects/${id}/selections`)
                    .then((ok) => ok && setSe({ name: "", category: "", allowance: "" }))}>
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
              {sels?.map((s: any) => {
                const over = s.actualCents != null && s.actualCents > s.allowanceCents;
                const editing = selEdit?.id === s.id ? selEdit : null;
                return (
                  <div key={s.id} className="rounded-lg border px-4 py-3 space-y-3" data-testid={`sel-row-${s.id}`}>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="font-medium">{s.name}{s.category ? ` · ${s.category}` : ""}</div>
                        {s.chosenOptionName && <div className="text-sm">Chosen: {s.chosenOptionName}</div>}
                        <div className="text-sm text-muted-foreground tabular-nums">
                          Allowance {money(s.allowanceCents)}
                          {s.actualCents != null && ` · actual ${money(s.actualCents)}`}
                          {over && <span className="text-destructive font-medium"> · over by {money(s.actualCents - s.allowanceCents)}</span>}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {canManageJobs && !editing && (
                          <Button size="sm" variant="ghost" data-testid={`button-edit-sel-${s.id}`}
                            onClick={() => setSelEdit({
                              id: s.id, chosen: s.chosenOptionName ?? "", status: s.status,
                              actual: s.actualCents != null ? (s.actualCents / 100).toString() : "",
                            })}>
                            <Pencil className="h-4 w-4 mr-1" /> Update
                          </Button>
                        )}
                        <StatusPill tone={statusTone(s.status)}>{s.status}</StatusPill>
                      </div>
                    </div>
                    {editing && (
                      <div className="flex flex-wrap gap-2 items-end rounded-lg border bg-muted/30 p-3">
                        <div className="flex-1 min-w-[180px]"><Label className="text-xs">Chosen option</Label>
                          <Input value={editing.chosen} maxLength={200} placeholder="Therma-Tru fiberglass, black"
                            onChange={(e) => setSelEdit({ ...editing, chosen: e.target.value })} data-testid="input-sel-chosen" /></div>
                        <div><Label className="text-xs">Actual cost $</Label>
                          <Input type="number" min={0} step="0.01" value={editing.actual}
                            onChange={(e) => setSelEdit({ ...editing, actual: e.target.value })} data-testid="input-sel-actual" /></div>
                        <div><Label className="text-xs">Status</Label>
                          <Select value={editing.status} onValueChange={(v) => setSelEdit({ ...editing, status: v })}>
                            <SelectTrigger className="w-32" data-testid="select-sel-status"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {SELECTION_STATUSES.map((st) => <SelectItem key={st} value={st}>{st}</SelectItem>)}
                            </SelectContent>
                          </Select></div>
                        <Button size="sm" variant="ghost" onClick={() => setSelEdit(null)}>Cancel</Button>
                        <Button size="sm" data-testid="button-save-sel"
                          onClick={() => patchChild("selections", s.id, {
                            chosenOptionName: editing.chosen.trim() || null,
                            actualCents: editing.actual === "" ? null : cents(editing.actual),
                            status: editing.status,
                          }, "selection", "Selection updated", `/api/crm/projects/${id}/selections`)
                            .then((ok) => ok && setSelEdit(null))}>
                          Save
                        </Button>
                      </div>
                    )}
                  </div>
                );
              })}
              {selsError ? (
                <p className="text-sm text-destructive">Couldn't load selections — refresh to try again.</p>
              ) : !sels?.length && <EmptyState compact icon={Palette} title="No selections yet" />}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="permits" className="mt-4">
          <Card>
            <CardHeader>
              <SectionTitle
                title="Permits & inspections"
                description="Official permit portals on file for this project's jurisdiction, with each link's check status shown."
              />
            </CardHeader>
            <CardContent className="space-y-2">
              {permitsError && (
                <p className="text-sm text-destructive">Couldn't load permit suggestions — refresh to try again.</p>
              )}
              {permits?.message && <p className="text-sm text-muted-foreground">{permits.message}</p>}
              {/* What was matched and on what basis (its own office / the issuer the routing source names / the
                  county our records place it in). A county is never picked because it shares the city's name. */}
              {permits?.jurisdiction && !permits.message && (
                <p className="text-sm text-muted-foreground" data-testid="text-permit-match">
                  <strong>{permits.jurisdiction}</strong>
                  {permits.note ? <> — {permits.note}</> : null}
                  {permits.basis === "routed" && permits.issuedBySource && (
                    <> <a href={permits.issuedBySource} target="_blank" rel="noreferrer" className="underline">Source</a></>
                  )}
                </p>
              )}
              {permits?.portals?.map((p: any) => (
                <div key={p.id} className="rounded-lg border px-4 py-3 flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-medium truncate">{p.name}</div>
                    {governmentLinkNotice(p) && <p className="text-xs text-muted-foreground">{governmentLinkNotice(p)}</p>}
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
                <>
                  <EmptyState
                    compact
                    icon={FileBadge}
                    title="No official portal on file for this jurisdiction"
                    description="We won't invent one, or borrow one from a place with a similar name — search manually."
                  />
                  {/* An honest web search, labelled as a search — never a portal link. */}
                  {permits.jurisdiction && permits.basis !== "no-city" && (
                    <div className="flex justify-center">
                      <a
                        href={`https://www.google.com/search?q=${encodeURIComponent(`${permits.jurisdiction} building permit office`)}`}
                        target="_blank" rel="noreferrer" data-testid="link-permit-search-fallback"
                        title="No official portal on record — search the web for this jurisdiction's permit office"
                      >
                        <Button size="sm" variant="outline">Find permit portal</Button>
                      </a>
                    </div>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </CrmPage>
  );
}
