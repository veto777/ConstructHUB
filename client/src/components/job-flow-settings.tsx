/**
 * Settings → Job flow (shared/job-flow.ts): the account's phases in order — the six built-in ones plus any the
 * owner adds — with rename, move up/down, remove (custom phases only), one-click suggestions, a Reset, and per
 * phase the alerts that go out the moment a job enters it (email or text, to the client or to someone on the team,
 * with an editable template). Saved as a whole through PATCH /api/crm/org { jobFlow }.
 *
 * Built-in phases are anchors the system relies on (the automatic moves, the punch list from Job Scheduled on, the
 * Google Reviews list at Closed out): they can be renamed and moved only without crossing another built-in phase,
 * and never removed — the arrows simply refuse the move and the card says why.
 */
import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Bell, BellOff, Loader2, Lock, Mail, MessageSquare, Plus, RotateCcw, Trash2, Workflow } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SectionTitle } from "@/components/crm-ui";
import { apiRequest, apiErrorMessage, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  DEFAULT_JOB_FLOW, FLOW_PLACEHOLDERS, FLOW_SUGGESTIONS, MAX_FLOW_PHASES, MAX_PHASE_ALERTS, MAX_PHASE_LABEL,
  defaultAlertTemplate, newFlowAlert, normalizeJobFlow, phaseKeyOf, type FlowAlert, type FlowChannel, type FlowPhase, type FlowRecipient, type JobFlow,
} from "@shared/job-flow";

type Member = { id: string; displayName: string | null; email: string; role: string; status: string };

export function useJobFlow(me: any): JobFlow {
  return normalizeJobFlow(me?.org?.customFields?.jobFlow);
}

const same = (a: JobFlow, b: JobFlow) => JSON.stringify(a) === JSON.stringify(b);

export function JobFlowCard() {
  const { toast } = useToast();
  const { data: me } = useQuery<any>({ queryKey: ["/api/crm/me"] });
  const { data: team } = useQuery<{ members: Member[] }>({ queryKey: ["/api/crm/members"] });
  const stored = useJobFlow(me);
  const [draft, setDraft] = useState<JobFlow>(stored);
  const [open, setOpen] = useState<string | null>(null);
  const [newLabel, setNewLabel] = useState("");
  useEffect(() => { setDraft(stored); }, [JSON.stringify(stored)]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = useMutation({
    mutationFn: async (flow: JobFlow | null) => (await apiRequest("PATCH", "/api/crm/org", { jobFlow: flow })).json(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/crm/me"] });
      queryClient.invalidateQueries({ queryKey: ["/api/crm/org"] });
      toast({ title: "Job flow saved" });
    },
    onError: (e) => toast({ title: "Could not save the job flow", description: apiErrorMessage(e), variant: "destructive" }),
  });

  const members = (team?.members ?? []).filter((m) => m.status === "active");
  const phases = draft.phases;
  const dirty = !same(draft, stored);
  const keys = phases.map((p) => p.key);
  const setPhases = (next: FlowPhase[]) => setDraft({ phases: next });
  const update = (key: string, fn: (p: FlowPhase) => FlowPhase) => setPhases(phases.map((p) => (p.key === key ? fn(p) : p)));

  /** A built-in phase never crosses another built-in phase; a custom phase moves freely. */
  const canMove = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= phases.length) return false;
    return !(phases[i].builtin && phases[j].builtin);
  };
  const move = (i: number, d: -1 | 1) => {
    if (!canMove(i, d)) return;
    const next = [...phases];
    [next[i], next[i + d]] = [next[i + d], next[i]];
    setPhases(next);
  };
  const add = (label: string, key?: string, afterKey?: string) => {
    const clean = label.replace(/\s+/g, " ").trim();
    if (!clean) return;
    if (phases.length >= MAX_FLOW_PHASES) return toast({ title: `A job flow can have at most ${MAX_FLOW_PHASES} phases` });
    if (phases.some((p) => p.label.toLowerCase() === clean.toLowerCase())) return toast({ title: `${clean} is already a phase` });
    const k = key && !keys.includes(key) ? key : phaseKeyOf(clean, keys);
    const phase: FlowPhase = { key: k, label: clean.slice(0, MAX_PHASE_LABEL), alerts: [] };
    const at = afterKey ? phases.findIndex((p) => p.key === afterKey) : -1;
    const next = [...phases];
    next.splice(at < 0 ? phases.length : at + 1, 0, phase);
    setPhases(next);
    setNewLabel("");
    setOpen(k);
  };
  const remove = (key: string) => { setPhases(phases.filter((p) => p.key !== key)); if (open === key) setOpen(null); };
  const setAlert = (key: string, i: number, fn: (a: FlowAlert) => FlowAlert) => update(key, (p) => ({ ...p, alerts: p.alerts.map((a, j) => (j === i ? fn(a) : a)) }));

  const suggestions = FLOW_SUGGESTIONS.filter((s) => !keys.includes(s.key) && !phases.some((p) => p.label.toLowerCase() === s.label.toLowerCase()));
  const alertCount = phases.reduce((n, p) => n + p.alerts.length, 0);

  return (
    <Card data-testid="card-job-flow">
      <CardHeader>
        <SectionTitle icon={Workflow} title="Job flow"
          description="The phases every job moves through on the client page's tracker, and the alerts that go out the moment a job enters one. Add as many phases as you need, rename or reorder them, and put an email or a text to the client or to your team on any phase." />
      </CardHeader>
      <CardContent className="space-y-4">
        <ol className="divide-y rounded-lg border" data-testid="list-job-flow">
          {phases.map((p, i) => {
            const expanded = open === p.key;
            return (
              <li key={p.key} className="px-3 py-2" data-testid={`flow-row-${p.key}`} data-builtin={p.builtin ? "true" : undefined}>
                {/* The name takes the first line; on a phone the buttons wrap under it instead of squeezing it. */}
                <div className="flex flex-wrap items-center gap-2">
                  <span className="w-6 shrink-0 text-xs tabular-nums text-muted-foreground">{i + 1}.</span>
                  <Input value={p.label} maxLength={MAX_PHASE_LABEL} aria-label={`Phase ${i + 1} name`} data-testid={`input-flow-label-${p.key}`}
                    onChange={(e) => update(p.key, (x) => ({ ...x, label: e.target.value }))}
                    className={`h-8 min-w-[11rem] flex-1 text-sm ${p.builtin ? "font-semibold" : ""}`} />
                  <div className="ml-8 flex items-center gap-1 sm:ml-0">
                  {p.builtin && (
                    <span className="hidden shrink-0 items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground sm:inline-flex" title="A built-in phase: it can be renamed, but not removed or moved past another built-in phase.">
                      <Lock className="h-3 w-3" aria-hidden="true" />Built-in
                    </span>
                  )}
                  <Button size="sm" variant={p.alerts.length ? "secondary" : "ghost"} className="h-8 shrink-0 px-2 text-xs" onClick={() => setOpen(expanded ? null : p.key)}
                    aria-expanded={expanded} data-testid={`button-flow-alerts-${p.key}`}>
                    {p.alerts.length ? <Bell className="mr-1 h-3.5 w-3.5" aria-hidden="true" /> : <BellOff className="mr-1 h-3.5 w-3.5" aria-hidden="true" />}
                    {p.alerts.length ? `${p.alerts.length} alert${p.alerts.length === 1 ? "" : "s"}` : "Alerts"}
                  </Button>
                  <Button size="icon" variant="ghost" className="h-8 w-8 shrink-0" onClick={() => move(i, -1)} disabled={!canMove(i, -1)} aria-label={`Move ${p.label} up`} data-testid={`button-flow-up-${p.key}`}><ArrowUp className="h-4 w-4" /></Button>
                  <Button size="icon" variant="ghost" className="h-8 w-8 shrink-0" onClick={() => move(i, 1)} disabled={!canMove(i, 1)} aria-label={`Move ${p.label} down`} data-testid={`button-flow-down-${p.key}`}><ArrowDown className="h-4 w-4" /></Button>
                  <Button size="icon" variant="ghost" className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive" onClick={() => remove(p.key)} disabled={!!p.builtin}
                    aria-label={p.builtin ? `${p.label} is built in and cannot be removed` : `Remove ${p.label}`} title={p.builtin ? "Built-in phases cannot be removed" : "Remove this phase"} data-testid={`button-flow-remove-${p.key}`}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                  </div>
                </div>
                {expanded && (
                  <div className="mt-2 space-y-3 rounded-lg border bg-muted/30 p-3 sm:ml-8" data-testid={`flow-alerts-${p.key}`}>
                    <p className="text-xs text-muted-foreground">
                      Sent once, the moment a job enters <b>{p.label || "this phase"}</b> — by hand on the tracker or automatically. Placeholders:{" "}
                      {FLOW_PLACEHOLDERS.map((ph, j) => <span key={ph.token}><code className="rounded bg-background px-1">{ph.token}</code> {ph.meaning}{j < FLOW_PLACEHOLDERS.length - 1 ? " · " : ""}</span>)}
                    </p>
                    {p.alerts.map((a, j) => (
                      <div key={j} className="space-y-2 rounded-md border bg-background p-2.5" data-testid={`flow-alert-${p.key}-${j}`}>
                        <div className="flex flex-wrap items-center gap-2">
                          <Select value={a.to} onValueChange={(v) => setAlert(p.key, j, (x) => {
                            const to = v as FlowRecipient;
                            const wasDefault = x.template === defaultAlertTemplate(x.to, x.channel);
                            return { ...x, to, staff: to === "staff" ? x.staff ?? "pm" : undefined, template: wasDefault ? defaultAlertTemplate(to, x.channel) : x.template };
                          })}>
                            <SelectTrigger className="h-8 w-[170px] text-xs" aria-label="Who gets it" data-testid={`select-flow-alert-to-${p.key}-${j}`}><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="client">The client</SelectItem>
                              <SelectItem value="staff">Someone on the team</SelectItem>
                            </SelectContent>
                          </Select>
                          {a.to === "staff" && (
                            <Select value={a.staff ?? "pm"} onValueChange={(v) => setAlert(p.key, j, (x) => ({ ...x, staff: v }))}>
                              <SelectTrigger className="h-8 w-[180px] text-xs" aria-label="Which team member" data-testid={`select-flow-alert-staff-${p.key}-${j}`}><SelectValue /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="pm">The project manager</SelectItem>
                                <SelectItem value="sales">The sales rep</SelectItem>
                                <SelectItem value="owner">The owner</SelectItem>
                                {members.map((m) => <SelectItem key={m.id} value={m.id}>{m.displayName || m.email}</SelectItem>)}
                              </SelectContent>
                            </Select>
                          )}
                          <Select value={a.channel} onValueChange={(v) => setAlert(p.key, j, (x) => {
                            const channel = v as FlowChannel;
                            const wasDefault = x.template === defaultAlertTemplate(x.to, x.channel);
                            return { ...x, channel, template: wasDefault ? defaultAlertTemplate(x.to, channel) : x.template };
                          })}>
                            <SelectTrigger className="h-8 w-[110px] text-xs" aria-label="Channel" data-testid={`select-flow-alert-channel-${p.key}-${j}`}><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="email"><span className="inline-flex items-center gap-1.5"><Mail className="h-3.5 w-3.5" aria-hidden="true" />Email</span></SelectItem>
                              <SelectItem value="sms"><span className="inline-flex items-center gap-1.5"><MessageSquare className="h-3.5 w-3.5" aria-hidden="true" />Text</span></SelectItem>
                            </SelectContent>
                          </Select>
                          <Button size="icon" variant="ghost" className="ml-auto h-8 w-8 text-muted-foreground hover:text-destructive" aria-label="Remove this alert" data-testid={`button-flow-alert-remove-${p.key}-${j}`}
                            onClick={() => update(p.key, (x) => ({ ...x, alerts: x.alerts.filter((_, k) => k !== j) }))}>
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                        <Textarea value={a.template} rows={a.channel === "sms" ? 2 : 4} maxLength={600} aria-label="Message" data-testid={`input-flow-alert-template-${p.key}-${j}`}
                          onChange={(e) => setAlert(p.key, j, (x) => ({ ...x, template: e.target.value }))} className="text-sm" />
                        {a.to === "client" && a.channel === "sms" && <p className="text-[11px] text-muted-foreground">Goes out like any CRM text: your texting number, STOP opt-outs and the monthly allowance all apply. Skipped (and noted on the timeline) when the client has no phone number.</p>}
                        {a.to === "staff" && a.channel === "sms" && <p className="text-[11px] text-muted-foreground">Needs a mobile number on that team member's profile and texting set up in Integrations.</p>}
                      </div>
                    ))}
                    <Button size="sm" variant="outline" className="h-8" disabled={p.alerts.length >= MAX_PHASE_ALERTS} data-testid={`button-flow-add-alert-${p.key}`}
                      onClick={() => update(p.key, (x) => ({ ...x, alerts: [...x.alerts, newFlowAlert(x.alerts.length ? "staff" : "client", "email")] }))}>
                      <Plus className="mr-1 h-3.5 w-3.5" aria-hidden="true" />Add an alert
                    </Button>
                  </div>
                )}
              </li>
            );
          })}
        </ol>

        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); add(newLabel); }}>
          <Input value={newLabel} onChange={(e) => setNewLabel(e.target.value)} placeholder="New phase, e.g. Materials ordered" maxLength={MAX_PHASE_LABEL} className="h-9" aria-label="New phase" data-testid="input-flow-new-phase" />
          <Button type="submit" variant="outline" className="h-9 shrink-0" disabled={!newLabel.trim() || phases.length >= MAX_FLOW_PHASES} data-testid="button-flow-add-phase"><Plus className="mr-1 h-4 w-4" aria-hidden="true" />Add phase</Button>
        </form>
        {suggestions.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5" data-testid="flow-suggestions">
            <span className="mr-1 text-xs font-medium text-muted-foreground">Suggestions:</span>
            {suggestions.map((s) => (
              <button key={s.key} type="button" onClick={() => add(s.label, s.key, s.after)} disabled={phases.length >= MAX_FLOW_PHASES}
                className="inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium hover:border-primary hover:text-primary disabled:opacity-50" data-testid={`button-flow-suggest-${s.key}`}>
                <Plus className="h-3 w-3" aria-hidden="true" />{s.label}
              </button>
            ))}
          </div>
        )}

        <p className="text-xs text-muted-foreground">
          The six built-in phases are anchors the system relies on — bids and approvals, visits and invoices move a job to them on their own, the punch list opens from Job Scheduled on, and Closed out puts the client on the Google Reviews list. Rename them freely and slide your own phases between them, but they keep their order and can't be removed.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={() => save.mutate(draft)} disabled={!dirty || save.isPending} data-testid="button-flow-save">
            {save.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Save job flow
          </Button>
          <Button variant="ghost" onClick={() => { setDraft(DEFAULT_JOB_FLOW); setOpen(null); }} data-testid="button-flow-reset">
            <RotateCcw className="mr-1.5 h-3.5 w-3.5" />Reset to default
          </Button>
          <span className="text-xs text-muted-foreground">{phases.length} phase{phases.length === 1 ? "" : "s"} · {alertCount} alert{alertCount === 1 ? "" : "s"}</span>
        </div>
      </CardContent>
    </Card>
  );
}
