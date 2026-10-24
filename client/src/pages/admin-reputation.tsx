/**
 * /admin/reputation — the Reputation Desk (shared/reputation.ts): leads from the free scan (/reputation), the
 * client cases, and the registry of removal playbooks and people-search sites. /admin/reputation/:id is one case:
 * results and their positions over time, removals (request drafted from the playbook, then tracked),
 * autocomplete, people-search opt-outs, the owned assets that push results down, Wikipedia, and links to the
 * review, listing and marketing tools already in ConstructHUB.
 *
 * Platform admins only (the API answers 403 to anyone else; the second factor is handled like /admin/issues).
 */
import { Badge } from "@/components/ui/badge";
import { useMemo, useState } from "react";
import { Link, useLocation, useRoute } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { format, formatDistanceToNowStrict } from "date-fns";
import {
  ArrowLeft, ExternalLink, FileSignature, FileText, Loader2, Lock, Plus, RefreshCw, Search, Send, ShieldCheck, Sparkles, Trash2, UserX,
} from "lucide-react";
import {
  ASSET_KINDS, ASSET_KIND_LABELS, ASSET_STATUSES, BROKER_STATUSES, BROKER_STATUS_LABELS, ITEM_ACTIONS, ITEM_ACTION_LABELS, ITEM_STATUSES,
  ITEM_STATUS_LABELS, LEAD_STATUSES, LEAD_STATUS_LABELS, SERVICE_LINES, type BrokerStatus, type ItemStatus, type LeadStatus,
} from "@shared/reputation";
import { apiErrorMessage, apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { AppPage, Notice, Section, Stat, StatGrid } from "@/components/app-ui";
import { GoogleSectionHeader } from "@/components/google";
import { StatusPill, type PillTone } from "@/components/crm-ui";
import { SamplePreview } from "@/components/sample-preview";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useDocumentTitle } from "@/components/feature-landing/primitives";
import { appPageTitle } from "@/lib/page-titles";
import { VerificationCancelled } from "@/components/recent-auth";
import { cn } from "@/lib/utils";

const getJson = async <T,>(url: string): Promise<T> => (await apiRequest("GET", url)).json();
const send = async (method: string, url: string, body?: unknown) => (await apiRequest(method, url, body)).json();
const invalidate = () => queryClient.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith("/api/admin/reputation") });
const ago = (iso: string | null) => (iso ? `${formatDistanceToNowStrict(new Date(iso))} ago` : "never");
const scoreTone = (s: number | null): PillTone => (s == null ? "neutral" : s >= 80 ? "success" : s >= 65 ? "warning" : "danger");
const SENT_TONE: Record<string, PillTone> = { negative: "danger", neutral: "neutral", positive: "info" };
const ITEM_TONE: Record<ItemStatus, PillTone> = { open: "warning", in_progress: "info", requested: "violet", removed: "success", suppressed: "teal", denied: "danger", done: "success" };
const BROKER_TONE: Record<BrokerStatus, PillTone> = { not_checked: "neutral", listed: "danger", not_found: "neutral", submitted: "info", verify_needed: "warning", removed: "success", failed: "danger" };
const LEAD_TONE: Record<LeadStatus, PillTone> = { new: "warning", contacted: "info", offer_sent: "violet", client: "success", closed: "neutral" };
function failure(err: unknown): { status: number; body: any } {
  const raw = String((err as Error | null)?.message ?? "");
  const status = Number(raw.slice(0, 3)) || 0;
  try { return { status, body: JSON.parse(raw.replace(/^\d{3}:\s*/, "")) }; } catch { return { status, body: null }; }
}
function Gate({ error, retry }: { error: unknown; retry: () => void }) {
  const f = failure(error);
  const verify = error instanceof VerificationCancelled || f.body?.reauth === true;
  return (
    <div className="mx-auto max-w-xl px-4 py-16 text-center" data-testid="page-admin-reputation-gate">
      <Lock className="mx-auto h-6 w-6 text-muted-foreground" aria-hidden="true" />
      <h1 className="mt-3 text-lg font-semibold">{verify ? "Verify it's you" : f.status === 401 || f.status === 403 ? "Platform admins only" : "Couldn't load the Reputation Desk"}</h1>
      {verify && <Button className="mt-4" onClick={retry}>Verify identity</Button>}
    </div>
  );
}
function useAct() {
  const { toast } = useToast();
  return (label: string, fn: () => Promise<any>, after?: (r: any) => void) => fn()
    .then((r) => { void invalidate(); after?.(r); return r; })
    .catch((e) => toast({ title: label, description: apiErrorMessage(e), variant: "destructive" }));
}

// ---------------------------------------------------------------------------------------------- desk

function NewCaseDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [, go] = useLocation();
  const act = useAct();
  const [f, setF] = useState({ clientName: "", subject: "", kind: "person", email: "", phone: "", terms: "", ownedDomains: "" });
  const set = (k: keyof typeof f) => (e: any) => setF({ ...f, [k]: e?.target ? e.target.value : e });
  const save = () => act("Couldn't create the case", () => send("POST", "/api/admin/reputation/cases", {
    clientName: f.clientName, subject: f.subject, kind: f.kind, email: f.email, phone: f.phone,
    terms: f.terms.split("\n").map((t) => t.trim()).filter(Boolean), ownedDomains: f.ownedDomains.split(/[\s,]+/).filter(Boolean),
  }), (r) => { onClose(); go(`/admin/reputation/${r.id}`); });
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>New case</DialogTitle><DialogDescription>A client whose name (or business) we restore. You can add search terms and their own websites now or later.</DialogDescription></DialogHeader>
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5"><Label>Client name</Label><Input value={f.clientName} onChange={set("clientName")} data-testid="input-case-client" /></div>
            <div className="space-y-1.5"><Label>Type</Label><Select value={f.kind} onValueChange={set("kind")}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="person">Person</SelectItem><SelectItem value="business">Business</SelectItem></SelectContent></Select></div>
          </div>
          <div className="space-y-1.5"><Label>Main search (the name as people google it)</Label><Input value={f.subject} onChange={set("subject")} placeholder="Jane Smith Seattle" data-testid="input-case-subject" /></div>
          <div className="space-y-1.5"><Label>More search terms (one per line, up to 4)</Label><Textarea rows={2} value={f.terms} onChange={set("terms")} placeholder={"Dr Jane Smith\nJane Smith reviews"} /></div>
          <div className="space-y-1.5"><Label>Their own websites/profiles (domains)</Label><Input value={f.ownedDomains} onChange={set("ownedDomains")} placeholder="janesmith.com, linkedin.com/in/janesmith" /></div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5"><Label>Email</Label><Input type="email" value={f.email} onChange={set("email")} /></div>
            <div className="space-y-1.5"><Label>Phone</Label><Input value={f.phone} onChange={set("phone")} /></div>
          </div>
        </div>
        <DialogFooter><Button onClick={save} disabled={!f.clientName || f.subject.length < 2} data-testid="button-create-case">Create case</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Desk() {
  useDocumentTitle(appPageTitle("/admin/reputation")!);
  const [, go] = useLocation();
  const act = useAct();
  const [tab, setTab] = useState(() => (new URLSearchParams(window.location.search).get("lead") ? "leads" : "cases"));
  const [newCase, setNewCase] = useState(false);
  const { data: s, error, isLoading, refetch } = useQuery<any>({ queryKey: ["/api/admin/reputation/summary"], queryFn: () => getJson("/api/admin/reputation/summary") });
  const { data: leads } = useQuery<{ rows: any[] }>({ queryKey: ["/api/admin/reputation/leads"], queryFn: () => getJson("/api/admin/reputation/leads"), enabled: !!s });
  const { data: cases } = useQuery<{ rows: any[] }>({ queryKey: ["/api/admin/reputation/cases"], queryFn: () => getJson("/api/admin/reputation/cases"), enabled: !!s });
  const { data: reg } = useQuery<any>({ queryKey: ["/api/admin/reputation/registry"], queryFn: () => getJson("/api/admin/reputation/registry"), enabled: !!s && tab === "registry" });

  if (isLoading && !s) return <div className="flex justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  if (!s) return <Gate error={error} retry={() => void refetch()} />;

  return (
    <AppPage testId="page-admin-reputation">
      <GoogleSectionHeader as="h1" title="Reputation Desk" count={s.cases.active || null}
        description="Reputation restoration for people and businesses: free-scan leads, client cases, removals, autocomplete, people-search opt-outs and the assets that push bad results down."
        actions={<div className="flex gap-2">
          <Button asChild variant="outline" size="sm"><a href="/reputation" target="_blank" rel="noreferrer"><ExternalLink className="mr-1.5 h-4 w-4" />Public page</a></Button>
          <Button size="sm" onClick={() => setNewCase(true)} data-testid="button-new-case"><Plus className="mr-1.5 h-4 w-4" />New case</Button>
        </div>} flush />
      <div className="min-w-0 space-y-4">
        {!s.searchData && <Notice tone="warning" title="Search data is not connected">Scans and re-checks need the DataForSEO login in the server .env.</Notice>}
        <StatGrid cols={4}>
          <Stat label="New leads" value={String(s.leads.new)} hint={`${s.leads.total} free scans`} onClick={() => setTab("leads")} selected={tab === "leads"} testId="stat-rep-leads" />
          <Stat label="Active cases" value={String(s.cases.active)} hint={`${s.cases.total} total`} onClick={() => setTab("cases")} selected={tab === "cases"} testId="stat-rep-cases" />
          <Stat label="Open negatives" value={String(s.items.open_negatives)} hint={`${s.items.requested} requests out · ${s.items.resolved} resolved`} tone={s.items.open_negatives ? "warn" : "default"} />
          <Stat label="People-search" value={String(s.brokers.listed)} hint={`listed · ${s.brokers.pending} pending · ${s.brokers.removed} removed`} />
        </StatGrid>
        <p className="text-xs text-muted-foreground">Search data spent this month: ${Number(s.spend.usd).toFixed(2)} · registry: {s.registry.playbooks} removal playbooks, {s.registry.brokers} people-search sites.</p>

        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="cases" data-testid="tab-rep-cases">Cases</TabsTrigger>
            <TabsTrigger value="leads" data-testid="tab-rep-leads">Leads</TabsTrigger>
            <TabsTrigger value="registry" data-testid="tab-rep-registry">Playbooks & sites</TabsTrigger>
          </TabsList>
          <TabsContent value="cases">
            {cases && !cases.rows.length ? (
              <SamplePreview what="what a case list looks like once you add clients" cta={<Button size="sm" onClick={() => setNewCase(true)}>New case</Button>}>
                <div className="divide-y rounded-lg border bg-card">{[["Jane Example", "Jane Example Seattle", 42, 5], ["Example Roofing LLC", "Example Roofing Tampa", 71, 2]].map(([n, q, sc, o]) => (
                  <div key={String(n)} className="flex items-center gap-3 px-3 py-2.5"><div className="flex-1"><div className="font-medium">{n}</div><div className="text-xs text-muted-foreground">{q}</div></div><span className="text-sm">{o} open</span><StatusPill tone={scoreTone(Number(sc))}>{sc}/100</StatusPill></div>))}</div>
              </SamplePreview>
            ) : (
              <div className="divide-y rounded-lg border bg-card" data-testid="list-rep-cases">
                {(cases?.rows ?? []).map((c) => (
                  <Link key={c.id} href={`/admin/reputation/${c.id}`} className="flex items-center gap-3 px-3 py-2.5 hover:bg-muted/50" data-testid={`row-case-${c.id}`}>
                    <ShieldCheck className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <div className="min-w-0 flex-1"><div className="truncate font-medium">{c.client_name}</div><div className="truncate text-xs text-muted-foreground">“{c.subject}” · {c.kind} · checked {ago(c.last_checked_at)}</div></div>
                    <span className="hidden text-sm text-muted-foreground sm:inline">{c.open_negatives} open · {c.resolved} resolved</span>
                    {c.status !== "active" && <StatusPill tone="neutral">{c.status}</StatusPill>}
                    <StatusPill tone={scoreTone(c.last_score)}>{c.last_score ?? "—"}/100</StatusPill>
                  </Link>
                ))}
              </div>
            )}
          </TabsContent>
          <TabsContent value="leads">
            <div className="divide-y rounded-lg border bg-card" data-testid="list-rep-leads">
              {(leads?.rows ?? []).map((l) => (
                <div key={l.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5" data-testid={`row-lead-${l.id}`}>
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{l.name} <span className="font-normal text-muted-foreground">· {l.email}{l.phone ? ` · ${l.phone}` : ""}</span></div>
                    <div className="truncate text-xs text-muted-foreground">scanned “{l.query}” ({l.kind}) · {ago(l.created_at)} · {l.counts?.negativeTop10 ?? 0} negative on page 1</div>
                  </div>
                  <StatusPill tone={scoreTone(l.score)}>{l.score}/100</StatusPill>
                  <Select value={l.lead_status} onValueChange={(v) => act("Couldn't update", () => send("POST", `/api/admin/reputation/leads/${l.id}/status`, { status: v }))}>
                    <SelectTrigger className="h-8 w-32"><SelectValue /></SelectTrigger>
                    <SelectContent>{LEAD_STATUSES.map((x) => <SelectItem key={x} value={x}>{LEAD_STATUS_LABELS[x]}</SelectItem>)}</SelectContent>
                  </Select>
                  <Button size="sm" variant="outline" onClick={() => act("Couldn't create the offer", () => send("POST", `/api/admin/reputation/leads/${l.id}/offer`), (r) => go(`/admin/proposals/${r.proposalId}`))} data-testid={`button-lead-offer-${l.id}`}><FileSignature className="mr-1.5 h-4 w-4" />Offer</Button>
                  {l.case_id ? <Button asChild size="sm" variant="ghost"><Link href={`/admin/reputation/${l.case_id}`}>Case</Link></Button>
                    : <Button size="sm" onClick={() => act("Couldn't open a case", () => send("POST", `/api/admin/reputation/leads/${l.id}/case`), (r) => go(`/admin/reputation/${r.id}`))} data-testid={`button-lead-case-${l.id}`}>Open case</Button>}
                </div>
              ))}
              {leads && !leads.rows.length && <p className="px-3 py-8 text-center text-sm text-muted-foreground">No free scans yet. Leads arrive from <a className="underline" href="/reputation">/reputation</a>.</p>}
            </div>
          </TabsContent>
          <TabsContent value="registry">
            {!reg ? <Loader2 className="h-5 w-5 animate-spin" /> : (
              <div className="grid gap-4 lg:grid-cols-2">
                <Section title={`Removal playbooks (${reg.playbooks.length})`} description="The official route for each kind of removal, with sources.">
                  <div className="max-h-[32rem] space-y-2 overflow-auto">{reg.playbooks.map((p: any) => (
                    <details key={p.key} className="rounded-lg border p-2 text-sm"><summary className="cursor-pointer font-medium">{p.platform} — {p.title}{p.verifiedLive === false && <Badge variant="outline" className="ml-2">unverified</Badge>}</summary>
                      {p.notes && <p className="mt-1 text-xs text-muted-foreground">{p.notes}</p>}
                      <p className="mt-1 text-muted-foreground">{p.whenItApplies}</p>
                      {p.requestUrl && <a className="text-primary underline" href={p.requestUrl} target="_blank" rel="noreferrer">Request form</a>}
                      {p.steps?.length > 0 && <ol className="mt-1 list-decimal pl-5">{p.steps.map((s: string, i: number) => <li key={i}>{s}</li>)}</ol>}
                    </details>))}
                    {!reg.playbooks.length && <p className="text-sm text-muted-foreground">The playbook file (server/data/removal-playbooks.json) isn't loaded.</p>}
                  </div>
                </Section>
                <Section title={`People-search sites (${reg.brokers.length})`} description="Where personal data is listed and how to opt out.">
                  <div className="max-h-[32rem] divide-y overflow-auto text-sm">{reg.brokers.map((b: any) => (
                    <div key={b.key} className="flex items-center gap-2 py-1.5"><span className="min-w-0 flex-1 truncate">{b.name} <span className="text-muted-foreground">· {b.domain}</span></span><span className="text-xs text-muted-foreground">{b.method}</span>{b.optOutUrl && <a href={b.optOutUrl} target="_blank" rel="noreferrer"><ExternalLink className="h-3.5 w-3.5" /></a>}</div>))}
                    {!reg.brokers.length && <p className="text-sm text-muted-foreground">The site registry (server/data/data-brokers.json) isn't loaded.</p>}
                  </div>
                </Section>
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>
      <NewCaseDialog open={newCase} onClose={() => setNewCase(false)} />
    </AppPage>
  );
}

// ---------------------------------------------------------------------------------------------- case

function Sparkline({ points }: { points: { at: string; score: number | null }[] }) {
  const pts = points.filter((p) => p.score != null);
  if (pts.length < 2) return null;
  const w = 240, h = 48;
  const d = pts.map((p, i) => `${i === 0 ? "M" : "L"}${(i / (pts.length - 1)) * w},${h - (p.score! / 100) * h}`).join(" ");
  return <svg width={w} height={h} className="overflow-visible" aria-label="Score over time"><path d={d} fill="none" stroke="currentColor" strokeWidth={2} className="text-primary" /></svg>;
}

function ItemRow({ i, onOpen }: { i: any; onOpen: () => void }) {
  return (
    <button type="button" onClick={onOpen} className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-muted/50" data-testid={`row-item-${i.id}`}>
      <span className="w-10 shrink-0 text-right font-mono text-xs text-muted-foreground">{i.last_position ? `#${i.last_position}` : "—"}</span>
      <div className="min-w-0 flex-1"><div className="truncate text-sm font-medium">{i.title || i.url}</div><div className="truncate text-xs text-muted-foreground">{i.kind} · {i.domain ?? ""}{i.reason ? ` · ${i.reason}` : ""}</div></div>
      <StatusPill tone={SENT_TONE[i.sentiment]} dot={false}>{i.control === "owned" ? "Yours" : i.sentiment}</StatusPill>
      {i.sentiment === "negative" && <StatusPill tone={ITEM_TONE[i.status as ItemStatus]}>{ITEM_ACTION_LABELS[i.action as keyof typeof ITEM_ACTION_LABELS]} · {ITEM_STATUS_LABELS[i.status as ItemStatus]}</StatusPill>}
    </button>
  );
}

function ItemDialog({ item, playbooks, onClose }: { item: any | null; playbooks: any[]; onClose: () => void }) {
  const act = useAct();
  const { toast } = useToast();
  const [notes, setNotes] = useState("");
  const [text, setText] = useState("");
  const [via, setVia] = useState("");
  const [ticket, setTicket] = useState("");
  const [busy, setBusy] = useState(false);
  const i = item;
  const pb = useMemo(() => (i ? playbooks.find((p) => p.key === i.playbook) ?? null : null), [i, playbooks]);
  if (!i) return null;
  const upd = (body: any) => act("Couldn't update", () => send("PUT", `/api/admin/reputation/items/${i.id}`, body));
  const draft = async () => { setBusy(true); await act("Couldn't draft the request", () => send("POST", `/api/admin/reputation/items/${i.id}/draft`, { notes: notes || undefined }), (r) => setText(r.request.draft)); setBusy(false); };
  const history = (i.positions ?? []).slice(-12);
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader><DialogTitle className="pr-6">{i.title || i.url}</DialogTitle><DialogDescription>{i.url ? <a href={i.url} target="_blank" rel="noreferrer" className="break-all underline">{i.url}</a> : i.kind}</DialogDescription></DialogHeader>
        <div className="space-y-4 text-sm">
          {i.snippet && <p className="text-muted-foreground">{i.snippet}</p>}
          <div className="grid gap-3 sm:grid-cols-4">
            <div className="space-y-1"><Label className="text-xs">Sentiment</Label><Select value={i.sentiment} onValueChange={(v) => upd({ sentiment: v })}><SelectTrigger className="h-8"><SelectValue /></SelectTrigger><SelectContent>{["negative", "neutral", "positive"].map((x) => <SelectItem key={x} value={x}>{x}</SelectItem>)}</SelectContent></Select></div>
            <div className="space-y-1"><Label className="text-xs">Owner</Label><Select value={i.control} onValueChange={(v) => upd({ control: v })}><SelectTrigger className="h-8"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="third_party">Someone else</SelectItem><SelectItem value="owned">The client</SelectItem></SelectContent></Select></div>
            <div className="space-y-1"><Label className="text-xs">Action</Label><Select value={i.action} onValueChange={(v) => upd({ action: v })}><SelectTrigger className="h-8"><SelectValue /></SelectTrigger><SelectContent>{ITEM_ACTIONS.map((x) => <SelectItem key={x} value={x}>{ITEM_ACTION_LABELS[x]}</SelectItem>)}</SelectContent></Select></div>
            <div className="space-y-1"><Label className="text-xs">Status</Label><Select value={i.status} onValueChange={(v) => upd({ status: v })}><SelectTrigger className="h-8"><SelectValue /></SelectTrigger><SelectContent>{ITEM_STATUSES.map((x) => <SelectItem key={x} value={x}>{ITEM_STATUS_LABELS[x]}</SelectItem>)}</SelectContent></Select></div>
          </div>
          {history.length > 0 && <p className="text-xs text-muted-foreground">Positions: {history.map((p: any) => `${format(new Date(p.at), "MMM d")} ${p.pos ? `#${p.pos}` : "gone"}`).join(" → ")}</p>}
          {i.action === "remove" && (
            <div className="space-y-3 rounded-lg border p-3">
              <div className="flex flex-wrap items-center gap-2"><Label className="text-xs">Removal route</Label>
                <Select value={i.playbook ?? "none"} onValueChange={(v) => upd({ playbook: v === "none" ? null : v })}>
                  <SelectTrigger className="h-8 w-72"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="none">Ask the publisher</SelectItem>{playbooks.map((p) => <SelectItem key={p.key} value={p.key}>{p.platform} — {p.title}</SelectItem>)}</SelectContent>
                </Select>
                {pb?.requestUrl && <a href={pb.requestUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary underline">Open the official form <ExternalLink className="h-3.5 w-3.5" /></a>}
              </div>
              {pb && <div className="text-xs text-muted-foreground"><b>When it applies:</b> {pb.whenItApplies}{pb.notEligible ? <> · <b>Not eligible:</b> {pb.notEligible}</> : null}{pb.timeline ? <> · <b>Timeline:</b> {pb.timeline}</> : null}
                {pb.evidence?.length > 0 && <div className="mt-1"><b>Evidence:</b> {pb.evidence.join("; ")}</div>}</div>}
              <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Facts for the request (dates, why it qualifies, what the client owns)…" />
              <Button size="sm" variant="outline" onClick={draft} disabled={busy} data-testid="button-draft-request">{busy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Sparkles className="mr-1.5 h-4 w-4" />}Draft the request</Button>
              <Textarea rows={10} value={text || i.request?.sent || i.request?.draft || ""} onChange={(e) => setText(e.target.value)} placeholder="The request text (draft it above or write it)" data-testid="input-request-text" />
              <div className="grid gap-2 sm:grid-cols-2"><Input value={via} onChange={(e) => setVia(e.target.value)} placeholder="Sent via (form, email address…)" /><Input value={ticket} onChange={(e) => setTicket(e.target.value)} placeholder="Ticket / reference number" /></div>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" onClick={() => act("Couldn't record it", () => send("POST", `/api/admin/reputation/items/${i.id}/request`, { text: text || i.request?.draft || "", via: via || undefined, ticket: ticket || undefined }), () => toast({ title: "Recorded as sent" }))} disabled={!(text || i.request?.draft)} data-testid="button-mark-sent"><Send className="mr-1.5 h-4 w-4" />Mark as sent</Button>
                {i.url && <Button size="sm" variant="outline" onClick={() => act("Couldn't check", () => send("POST", `/api/admin/reputation/items/${i.id}/recheck`), (r) => toast({ title: r.removed ? "The page is gone — marked removed" : `The page answers HTTP ${r.liveStatus || "no response"}` }))}><RefreshCw className="mr-1.5 h-4 w-4" />Is it still up?</Button>}
              </div>
              {i.request?.sentAt && <p className="text-xs text-muted-foreground">Sent {format(new Date(i.request.sentAt), "PPp")}{i.request.via ? ` via ${i.request.via}` : ""}{i.request.ticket ? ` · ref ${i.request.ticket}` : ""}</p>}
            </div>
          )}
          <div className="space-y-1"><Label className="text-xs">Notes</Label><Textarea rows={3} defaultValue={i.notes ?? ""} onBlur={(e) => e.target.value !== (i.notes ?? "") && upd({ notes: e.target.value })} /></div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function BrokersTab({ caseId }: { caseId: number }) {
  const act = useAct();
  const url = `/api/admin/reputation/cases/${caseId}/brokers`;
  const [filter, setFilter] = useState<"all" | "listed" | "pending">("listed");
  const [open, setOpen] = useState<any | null>(null);
  const { data } = useQuery<any>({ queryKey: [url], queryFn: () => getJson(url), refetchInterval: (q) => (q.state.data?.scanning ? 4000 : false) });
  if (!data) return <Loader2 className="h-5 w-5 animate-spin" />;
  const rows = data.brokers.filter((b: any) => filter === "all" || (filter === "listed" ? b.status === "listed" : ["submitted", "verify_needed"].includes(b.status)));
  const count = (st: string[]) => data.brokers.filter((b: any) => st.includes(b.status)).length;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={() => act("Couldn't start the check", () => send("POST", `${url}/scan`, { priority: 1 }))} disabled={!!data.scanning} data-testid="button-broker-scan">
          {data.scanning ? <><Loader2 className="mr-1.5 h-4 w-4 animate-spin" />Checking {data.scanning.done}/{data.scanning.total}</> : <><Search className="mr-1.5 h-4 w-4" />Find the client on the major sites</>}
        </Button>
        <Button size="sm" variant="outline" onClick={() => act("Couldn't start the check", () => send("POST", `${url}/scan`, { priority: 3 }))} disabled={!!data.scanning}>Check every site</Button>
        <span className="text-sm text-muted-foreground">{count(["listed"])} listed · {count(["submitted", "verify_needed"])} pending · {count(["removed"])} removed · {count(["not_found"])} not found</span>
      </div>
      <Tabs value={filter} onValueChange={(v) => setFilter(v as any)}><TabsList><TabsTrigger value="listed">Listed</TabsTrigger><TabsTrigger value="pending">Pending</TabsTrigger><TabsTrigger value="all">All sites ({data.brokers.length})</TabsTrigger></TabsList></Tabs>
      <div className="divide-y rounded-lg border bg-card">
        {rows.map((b: any) => (
          <div key={b.key} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm" data-testid={`row-broker-${b.key}`}>
            <UserX className="h-4 w-4 shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1"><div className="truncate font-medium">{b.name} <span className="font-normal text-muted-foreground">· {b.domain}</span></div>
              <div className="truncate text-xs text-muted-foreground">{b.method}{b.requires?.length ? ` · needs ${b.requires.join(", ")}` : ""}{b.listingUrl ? ` · ${b.listingUrl}` : ""}</div></div>
            {b.optOutUrl && <Button asChild size="sm" variant="outline"><a href={b.optOutUrl} target="_blank" rel="noreferrer">Opt-out page <ExternalLink className="ml-1 h-3.5 w-3.5" /></a></Button>}
            {b.requestText && <Button size="sm" variant="ghost" onClick={() => setOpen(b)}>Email text</Button>}
            <Select value={b.status} onValueChange={(v) => act("Couldn't update", () => send("PUT", `${url}/${b.key}`, { status: v }))}>
              <SelectTrigger className="h-8 w-40"><SelectValue /></SelectTrigger>
              <SelectContent>{BROKER_STATUSES.map((x) => <SelectItem key={x} value={x}>{BROKER_STATUS_LABELS[x]}</SelectItem>)}</SelectContent>
            </Select>
            <StatusPill tone={BROKER_TONE[b.status as BrokerStatus]} dot={false}>{BROKER_STATUS_LABELS[b.status as BrokerStatus]}</StatusPill>
          </div>
        ))}
        {!rows.length && <p className="px-3 py-6 text-center text-sm text-muted-foreground">{filter === "listed" ? "No listings found yet — run the check." : "Nothing here."}</p>}
      </div>
      <Dialog open={!!open} onOpenChange={(v) => !v && setOpen(null)}>
        <DialogContent className="max-w-lg"><DialogHeader><DialogTitle>{open?.name} — opt-out email</DialogTitle><DialogDescription>Fill the bracketed parts and send it from the client's address (or yours, as their agent, where the site allows it).</DialogDescription></DialogHeader>
          <Textarea rows={14} readOnly value={open?.requestText ?? ""} />
          <DialogFooter><Button onClick={() => void navigator.clipboard.writeText(open?.requestText ?? "")}>Copy</Button></DialogFooter></DialogContent>
      </Dialog>
    </div>
  );
}

function AssetsTab({ caseId, assets }: { caseId: number; assets: any[] }) {
  const act = useAct();
  const [f, setF] = useState({ kind: "profile", title: "", url: "" });
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">Pages the client controls, built to outrank the negatives. Their positions update on every check when the URL appears in the results.</p>
      <div className="divide-y rounded-lg border bg-card">
        {assets.map((a) => (
          <div key={a.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
            <span className="w-28 shrink-0 text-xs text-muted-foreground">{ASSET_KIND_LABELS[a.kind as keyof typeof ASSET_KIND_LABELS]}</span>
            <div className="min-w-0 flex-1"><div className="truncate font-medium">{a.title}</div>{a.url && <a href={a.url} target="_blank" rel="noreferrer" className="truncate text-xs text-primary underline">{a.url}</a>}</div>
            <span className="text-xs text-muted-foreground">{a.last_position ? `#${a.last_position}` : "not ranking"}</span>
            <Select value={a.status} onValueChange={(v) => act("Couldn't update", () => send("PUT", `/api/admin/reputation/assets/${a.id}`, { status: v }))}>
              <SelectTrigger className="h-8 w-28"><SelectValue /></SelectTrigger><SelectContent>{ASSET_STATUSES.map((x) => <SelectItem key={x} value={x}>{x}</SelectItem>)}</SelectContent>
            </Select>
            <Button size="icon" variant="ghost" className="h-8 w-8 text-red-600" aria-label="Remove asset" onClick={() => act("Couldn't remove", () => send("DELETE", `/api/admin/reputation/assets/${a.id}`))}><Trash2 className="h-4 w-4" /></Button>
          </div>
        ))}
        {!assets.length && <p className="px-3 py-6 text-center text-sm text-muted-foreground">No assets yet. Start with the client's own website, LinkedIn and the profiles that rank for names.</p>}
      </div>
      <div className="flex flex-wrap gap-2">
        <Select value={f.kind} onValueChange={(v) => setF({ ...f, kind: v })}><SelectTrigger className="w-40"><SelectValue /></SelectTrigger><SelectContent>{ASSET_KINDS.map((k) => <SelectItem key={k} value={k}>{ASSET_KIND_LABELS[k]}</SelectItem>)}</SelectContent></Select>
        <Input className="w-56" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="Title (e.g. LinkedIn profile)" />
        <Input className="w-72" value={f.url} onChange={(e) => setF({ ...f, url: e.target.value })} placeholder="https://… (when live)" />
        <Button onClick={() => act("Couldn't add", () => send("POST", `/api/admin/reputation/cases/${caseId}/assets`, f), () => setF({ ...f, title: "", url: "" }))} disabled={!f.title} data-testid="button-add-asset"><Plus className="mr-1.5 h-4 w-4" />Add</Button>
      </div>
    </div>
  );
}

const WIKI_STAGES = [["assess", "Assess notability"], ["sources", "Gather sources"], ["draft", "Draft"], ["submitted", "Submitted for review"], ["published", "Published"], ["declined", "Declined"], ["not_notable", "Not notable yet"]] as const;
function WikiTab({ caseId, wiki }: { caseId: number; wiki: any }) {
  const act = useAct();
  const [w, setW] = useState(() => ({ stage: "assess", sources: [], draft: "", disclosure: "", articleUrl: "", notes: "", ...wiki }));
  const [src, setSrc] = useState({ url: "", title: "", independent: true });
  const independent = w.sources.filter((s: any) => s.independent).length;
  return (
    <div className="space-y-4">
      <Notice tone="info" title="Wikipedia's rules for paid work">Paid editing must be disclosed (Wikimedia Terms of Use, paid contributions; WP:PAID), and a subject's article goes through Articles for Creation or edit requests rather than direct edits (WP:COI). An article needs significant coverage in several reliable, independent sources (WP:GNG).</Notice>
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1"><Label className="text-xs">Stage</Label><Select value={w.stage} onValueChange={(v) => setW({ ...w, stage: v })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{WIKI_STAGES.map(([k, l]) => <SelectItem key={k} value={k}>{l}</SelectItem>)}</SelectContent></Select></div>
        <div className="space-y-1 sm:col-span-2"><Label className="text-xs">Article / draft URL</Label><Input value={w.articleUrl} onChange={(e) => setW({ ...w, articleUrl: e.target.value })} /></div>
      </div>
      <div className="space-y-2">
        <Label className="text-xs">Sources ({independent} independent)</Label>
        <ul className="space-y-1 text-sm">{w.sources.map((s: any, i: number) => <li key={i} className="flex items-center gap-2"><a href={s.url} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate underline">{s.title || s.url}</a><StatusPill tone={s.independent ? "success" : "neutral"} dot={false}>{s.independent ? "independent" : "affiliated"}</StatusPill><Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setW({ ...w, sources: w.sources.filter((_: any, j: number) => j !== i) })}><Trash2 className="h-3.5 w-3.5" /></Button></li>)}</ul>
        <div className="flex flex-wrap gap-2"><Input className="w-72" value={src.url} onChange={(e) => setSrc({ ...src, url: e.target.value })} placeholder="https://…" /><Input className="w-56" value={src.title} onChange={(e) => setSrc({ ...src, title: e.target.value })} placeholder="Outlet — headline" />
          <Select value={src.independent ? "y" : "n"} onValueChange={(v) => setSrc({ ...src, independent: v === "y" })}><SelectTrigger className="w-36"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="y">Independent</SelectItem><SelectItem value="n">Affiliated</SelectItem></SelectContent></Select>
          <Button variant="outline" onClick={() => { setW({ ...w, sources: [...w.sources, src] }); setSrc({ url: "", title: "", independent: true }); }} disabled={!src.url}>Add source</Button></div>
      </div>
      <div className="space-y-1"><Label className="text-xs">Paid-editing disclosure (for the user page / talk page)</Label><Textarea rows={2} value={w.disclosure} onChange={(e) => setW({ ...w, disclosure: e.target.value })} placeholder="I have been paid by [client] on behalf of [employer] for my contributions to [article]." /></div>
      <div className="space-y-1"><Label className="text-xs">Draft</Label><Textarea rows={10} value={w.draft} onChange={(e) => setW({ ...w, draft: e.target.value })} /></div>
      <div className="space-y-1"><Label className="text-xs">Notes</Label><Textarea rows={3} value={w.notes} onChange={(e) => setW({ ...w, notes: e.target.value })} /></div>
      <Button onClick={() => act("Couldn't save", () => send("PUT", `/api/admin/reputation/cases/${caseId}/wiki`, w))} data-testid="button-save-wiki">Save</Button>
    </div>
  );
}

function CasePage({ id }: { id: number }) {
  const [, go] = useLocation();
  const act = useAct();
  const url = `/api/admin/reputation/cases/${id}`;
  const { data, error, isLoading, refetch } = useQuery<any>({ queryKey: [url], queryFn: () => getJson(url) });
  const { data: reg } = useQuery<any>({ queryKey: ["/api/admin/reputation/registry"], queryFn: () => getJson("/api/admin/reputation/registry"), enabled: !!data });
  useDocumentTitle(data ? `${data.case.client_name} · Reputation` : appPageTitle("/admin/reputation")!);
  const [checking, setChecking] = useState(false);
  const [openItem, setOpenItem] = useState<number | null>(null);
  const [view, setView] = useState("results");
  const [settings, setSettings] = useState<any>(null);
  if (isLoading && !data) return <div className="flex justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  if (!data) return <Gate error={error} retry={() => void refetch()} />;
  const c = data.case;
  const items: any[] = data.items;
  const results = items.filter((i) => i.kind !== "autocomplete");
  const negatives = results.filter((i) => i.sentiment === "negative");
  const removals = negatives.filter((i) => i.action === "remove");
  const auto = items.filter((i) => i.kind === "autocomplete");
  const check = async () => { setChecking(true); await act("The check failed", () => send("POST", `${url}/check`)); setChecking(false); };
  const s = settings ?? { terms: (c.terms ?? []).join("\n"), ownedDomains: (c.owned_domains ?? []).join(", "), monitorDays: c.monitor_days, status: c.status, email: c.email ?? "", phone: c.phone ?? "", notes: c.notes ?? "" };
  const opened = items.find((i) => i.id === openItem) ?? null;

  return (
    <AppPage testId="page-admin-reputation-case" width="wide">
      <div className="flex items-center gap-2"><Button asChild variant="ghost" size="sm"><Link href="/admin/reputation"><ArrowLeft className="mr-1.5 h-4 w-4" />Reputation Desk</Link></Button><StatusPill tone={c.status === "active" ? "success" : "neutral"}>{c.status}</StatusPill></div>
      <GoogleSectionHeader as="h1" helpKey="admin-reputation" title={c.client_name} description={`“${c.subject}” · ${c.kind} · last checked ${ago(c.last_checked_at)}${c.monitor_days ? ` · re-checked every ${c.monitor_days} days` : ""}`}
        actions={<div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={check} disabled={checking} data-testid="button-check-case">{checking ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-1.5 h-4 w-4" />}Check Google now</Button>
          {data.proposal ? <Button asChild size="sm" variant="outline"><Link href={`/admin/proposals/${data.proposal.id}`}><FileText className="mr-1.5 h-4 w-4" />Proposal ({data.proposal.status})</Link></Button>
            : <Button size="sm" variant="outline" onClick={() => act("Couldn't create the offer", () => send("POST", `${url}/offer`), (r) => go(`/admin/proposals/${r.proposalId}`))} data-testid="button-case-offer"><FileSignature className="mr-1.5 h-4 w-4" />Create offer</Button>}
        </div>} flush />
      <StatGrid cols={4}>
        <Stat label="Reputation score" value={c.last_score != null ? `${c.last_score}/100` : "—"} hint={data.history.length > 1 ? `${data.history.length} checks` : "first check"} tone={c.last_score != null && c.last_score < 65 ? "bad" : "default"} />
        <Stat label="Negative results" value={String(negatives.filter((i) => i.last_position && i.last_position <= 10).length)} hint={`on page 1 · ${negatives.length} tracked`} />
        <Stat label="Removals" value={String(removals.filter((i) => i.status === "requested").length)} hint={`requested · ${removals.filter((i) => i.status === "removed").length} removed`} />
        <Stat label="Negative predictions" value={String(auto.filter((i) => i.sentiment === "negative" && i.last_position).length)} hint="in autocomplete now" />
      </StatGrid>
      <div className="text-muted-foreground"><Sparkline points={data.history.map((h: any) => ({ at: h.at, score: h.score }))} /></div>

      <Tabs value={view} onValueChange={setView}>
        <TabsList className="flex-wrap">
          <TabsTrigger value="results">Results ({results.length})</TabsTrigger>
          <TabsTrigger value="removals">Removals ({removals.length})</TabsTrigger>
          <TabsTrigger value="push">Push down</TabsTrigger>
          <TabsTrigger value="autocomplete">Autocomplete ({auto.length})</TabsTrigger>
          <TabsTrigger value="brokers">People-search</TabsTrigger>
          <TabsTrigger value="wikipedia">Wikipedia</TabsTrigger>
          <TabsTrigger value="growth">Reviews & growth</TabsTrigger>
          <TabsTrigger value="settings">Settings</TabsTrigger>
        </TabsList>
        <TabsContent value="results"><div className="divide-y rounded-lg border bg-card">{results.map((i) => <ItemRow key={i.id} i={i} onOpen={() => setOpenItem(i.id)} />)}{!results.length && <p className="px-3 py-6 text-center text-sm text-muted-foreground">No results yet — run “Check Google now”.</p>}</div></TabsContent>
        <TabsContent value="removals"><div className="divide-y rounded-lg border bg-card">{removals.map((i) => <ItemRow key={i.id} i={i} onOpen={() => setOpenItem(i.id)} />)}{!removals.length && <p className="px-3 py-6 text-center text-sm text-muted-foreground">No removals planned. Open a negative result and set its action to Remove.</p>}</div></TabsContent>
        <TabsContent value="push" className="space-y-4">
          <Section title="Negatives to push down">
            <div className="divide-y rounded-lg border bg-card">{negatives.filter((i) => i.action === "suppress").map((i) => <ItemRow key={i.id} i={i} onOpen={() => setOpenItem(i.id)} />)}</div>
          </Section>
          <Section title="Owned assets"><AssetsTab caseId={id} assets={data.assets} /></Section>
        </TabsContent>
        <TabsContent value="autocomplete">
          <Notice tone="info" title="How autocomplete is cleaned up">Predictions that break Google's autocomplete policies are reported with Google's “Report inappropriate predictions” link (under the search box). Others fade as better pages and searches about the name grow.</Notice>
          <div className="mt-3 divide-y rounded-lg border bg-card">{auto.map((i) => <ItemRow key={i.id} i={i} onOpen={() => setOpenItem(i.id)} />)}{!auto.length && <p className="px-3 py-6 text-center text-sm text-muted-foreground">No predictions recorded yet.</p>}</div>
        </TabsContent>
        <TabsContent value="brokers"><BrokersTab caseId={id} /></TabsContent>
        <TabsContent value="wikipedia"><WikiTab caseId={id} wiki={c.wiki ?? {}} /></TabsContent>
        <TabsContent value="growth">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {[["Google reviews", "/google-reviews", "Monitor, respond to and request reviews."], ["Directory Sync & listings", "/listings", "Accurate listings everywhere customers look."], ["SEO Suite", "/seo", "Rank tracking, content and backlinks for the client's own pages."], ["Ads Manager", "/ads-manager", "Search ads on the name while results move."], ["Social Media", "/social-media", "Profiles and posts that rank for the name."], ["Done-for-you websites", "/done-for-you", "A personal or business site to anchor page one."]].map(([t, href, d]) => (
              <a key={href} href={href} className="rounded-xl border bg-card p-4 hover:shadow-md"><div className="font-medium">{t}</div><div className="text-sm text-muted-foreground">{d}</div></a>
            ))}
          </div>
          <p className="mt-3 text-xs text-muted-foreground">Services on this case: {(c.services ?? []).map((k: string) => SERVICE_LINES.find((x) => x.key === k)?.title ?? k).join(", ") || "—"}</p>
        </TabsContent>
        <TabsContent value="settings">
          <div className="grid max-w-3xl gap-3">
            <div className="space-y-1"><Label>More search terms (one per line, up to 4)</Label><Textarea rows={3} value={s.terms} onChange={(e) => setSettings({ ...s, terms: e.target.value })} /></div>
            <div className="space-y-1"><Label>The client's own domains</Label><Input value={s.ownedDomains} onChange={(e) => setSettings({ ...s, ownedDomains: e.target.value })} /></div>
            <div className="grid gap-3 sm:grid-cols-4">
              <div className="space-y-1"><Label>Re-check every (days, 0 = off)</Label><Input type="number" min={0} max={90} value={s.monitorDays} onChange={(e) => setSettings({ ...s, monitorDays: Number(e.target.value) })} /></div>
              <div className="space-y-1"><Label>Status</Label><Select value={s.status} onValueChange={(v) => setSettings({ ...s, status: v })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{["lead", "active", "paused", "closed"].map((x) => <SelectItem key={x} value={x}>{x}</SelectItem>)}</SelectContent></Select></div>
              <div className="space-y-1"><Label>Email</Label><Input value={s.email} onChange={(e) => setSettings({ ...s, email: e.target.value })} /></div>
              <div className="space-y-1"><Label>Phone</Label><Input value={s.phone} onChange={(e) => setSettings({ ...s, phone: e.target.value })} /></div>
            </div>
            <div className="space-y-1"><Label>Notes</Label><Textarea rows={4} value={s.notes} onChange={(e) => setSettings({ ...s, notes: e.target.value })} /></div>
            <Button className="w-fit" onClick={() => act("Couldn't save", () => send("PUT", url, {
              terms: s.terms.split("\n").map((t: string) => t.trim()).filter(Boolean), ownedDomains: s.ownedDomains.split(/[\s,]+/).filter(Boolean),
              monitorDays: s.monitorDays, status: s.status, email: s.email, phone: s.phone, notes: s.notes,
            }), () => setSettings(null))} data-testid="button-save-case">Save</Button>
          </div>
        </TabsContent>
      </Tabs>
      <ItemDialog key={openItem ?? 0} item={opened} playbooks={reg?.playbooks ?? []} onClose={() => setOpenItem(null)} />
    </AppPage>
  );
}

export default function AdminReputationPage() {
  const [match, params] = useRoute("/admin/reputation/:id");
  const id = match ? Number(params?.id) : NaN;
  return Number.isInteger(id) && id > 0 ? <CasePage id={id} /> : <Desk />;
}
