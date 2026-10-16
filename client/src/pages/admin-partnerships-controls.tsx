/**
 * /admin/partnerships controls (owner, 2026-10-15: "everything has to be manageable through here"): the first-contact
 * queue (read each email before it goes, edit, send now, skip, add a contact), the sending settings (ramp / fixed /
 * paused, automatic replies, follow-ups) and the first-contact templates.
 */
import { useEffect, useState } from "react";
import { keepPreviousData, useMutation, useQuery } from "@tanstack/react-query";
import { formatDistanceToNowStrict } from "date-fns";
import { Loader2, Plus, RotateCcw, Save, Send, Settings2, Inbox as InboxIcon, FileText } from "lucide-react";
import {
  MEDIA_TEMPLATE_KINDS, MEDIA_TEMPLATE_KIND_LABELS, STOP_LINE_RE,
  type MediaOutreachMode, type MediaQueueRow, type MediaSettings, type MediaTemplateKind,
} from "@shared/media-inbox";
import { apiErrorMessage, apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Section } from "@/components/app-ui";
import { GoogleList, GoogleListRow } from "@/components/google";
import { StatusPill } from "@/components/crm-ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";

type QueueRow = MediaQueueRow & { email: { subject: string; body: string } };
type QueuePayload = { rows: QueueRow[]; total: number; byKind: Record<string, number>; counts: { queued: number; sent: number; skipped: number } };
type SettingsPayload = { settings: MediaSettings; builtIn: Record<MediaTemplateKind, { subject: string; body: string }>; today: number; daysSending: number };

const PAGE = 50;
const n = (v: number | undefined) => (v ?? 0).toLocaleString("en-US");
const ago = (iso: string | null) => (iso ? `${formatDistanceToNowStrict(new Date(iso))} ago` : "—");
const getJson = async <T,>(url: string): Promise<T> => (await apiRequest("GET", url)).json();
const refresh = () => queryClient.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith("/api/admin/media-inbox") });
const KIND_LABEL = (k: string) => MEDIA_TEMPLATE_KIND_LABELS[k as MediaTemplateKind] ?? k;
const SIGNATURE_NOTE = "Leah Peterson's Construct HUB Media Team signature is added under it.";

// ── Queue ────────────────────────────────────────────────────────────────────────────────────────────────────────────

function QueueSheet({ row, onClose }: { row: QueueRow | null; onClose: () => void }) {
  const { toast } = useToast();
  const [f, setF] = useState({ company: "", toEmail: "", kind: "directory" });
  useEffect(() => { if (row) setF({ company: row.company, toEmail: row.toEmail, kind: row.kind }); }, [row]);
  const save = useMutation({
    mutationFn: async (body: Record<string, unknown>) => (await apiRequest("POST", `/api/admin/media-inbox/queue/${row!.id}`, body)).json(),
    onSuccess: (_r, body) => { toast({ title: body.status === "skipped" ? "Skipped" : body.status === "queued" ? "Back in the queue" : "Saved" }); void refresh(); if (body.status) onClose(); },
    onError: (e) => toast({ title: "Not saved", description: apiErrorMessage(e), variant: "destructive" }),
  });
  const send = useMutation({
    mutationFn: async () => {
      if (f.company !== row!.company || f.toEmail !== row!.toEmail || f.kind !== row!.kind) await apiRequest("POST", `/api/admin/media-inbox/queue/${row!.id}`, f);
      return (await apiRequest("POST", `/api/admin/media-inbox/queue/${row!.id}/send`, {})).json();
    },
    onSuccess: (r: { ok: boolean; skipped: string | null }) => {
      toast(r.ok ? { title: `Sent to ${f.toEmail}` } : { title: "Not sent", description: r.skipped ?? undefined, variant: "destructive" });
      void refresh(); onClose();
    },
    onError: (e) => toast({ title: "Not sent", description: apiErrorMessage(e), variant: "destructive" }),
  });
  if (!row) return null;
  const editable = row.status !== "sent";
  const changed = f.company !== row.company || f.toEmail !== row.toEmail || f.kind !== row.kind;
  return (
    <Sheet open onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl" data-testid="sheet-queue">
        <SheetHeader>
          <SheetTitle>{row.company}</SheetTitle>
          <SheetDescription>{[row.domain, KIND_LABEL(row.kind), `from ${row.source}`, row.status === "sent" ? `sent ${ago(row.sentAt)}` : `queued ${ago(row.queuedAt)}`].join(" · ")}</SheetDescription>
        </SheetHeader>
        <div className="mt-4 space-y-4 text-sm">
          {row.reason && <p className="text-muted-foreground">{row.status === "skipped" ? "Skipped: " : ""}{row.reason}</p>}
          <div className="grid gap-2 sm:grid-cols-2">
            <div><Label htmlFor="q-company">Company</Label><Input id="q-company" disabled={!editable} value={f.company} onChange={(e) => setF({ ...f, company: e.target.value })} data-testid="input-queue-company" /></div>
            <div><Label htmlFor="q-email">Email</Label><Input id="q-email" type="email" disabled={!editable} value={f.toEmail} onChange={(e) => setF({ ...f, toEmail: e.target.value })} data-testid="input-queue-email" /></div>
            <div className="sm:col-span-2">
              <Label>Email type</Label>
              <Select value={f.kind} disabled={!editable} onValueChange={(v) => setF({ ...f, kind: v })}>
                <SelectTrigger data-testid="select-queue-kind"><SelectValue /></SelectTrigger>
                <SelectContent>{MEDIA_TEMPLATE_KINDS.map((k) => <SelectItem key={k} value={k}>{MEDIA_TEMPLATE_KIND_LABELS[k]}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <div className="mb-1 font-medium">{row.status === "sent" ? "The email sent" : "The email that will be sent"}</div>
            <div className="rounded-lg border p-3">
              <div className="font-medium">{row.email.subject}</div>
              <pre className="mt-2 whitespace-pre-wrap break-words font-sans text-xs">{row.email.body}</pre>
              <p className="mt-2 text-xs text-muted-foreground">{SIGNATURE_NOTE}{changed ? " Save to see the email with your changes." : ""}</p>
            </div>
          </div>
          {editable && (
            <div className="flex flex-wrap gap-2">
              <Button disabled={send.isPending} onClick={() => send.mutate()} data-testid="button-queue-send">
                {send.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}Send now
              </Button>
              {changed && <Button variant="outline" disabled={save.isPending} onClick={() => save.mutate(f)} data-testid="button-queue-save"><Save className="mr-2 h-4 w-4" />Save</Button>}
              {row.status === "queued"
                ? <Button variant="outline" disabled={save.isPending} onClick={() => save.mutate({ status: "skipped" })} data-testid="button-queue-skip">Skip — don't send</Button>
                : <Button variant="outline" disabled={save.isPending} onClick={() => save.mutate({ status: "queued" })} data-testid="button-queue-restore"><RotateCcw className="mr-2 h-4 w-4" />Put back in the queue</Button>}
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function AddContact() {
  const { toast } = useToast();
  const [f, setF] = useState({ company: "", domain: "", email: "", kind: "directory" });
  const add = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/admin/media-inbox/queue", f)).json(),
    onSuccess: () => { toast({ title: `${f.company} added to the queue` }); setF({ company: "", domain: "", email: "", kind: f.kind }); void refresh(); },
    onError: (e) => toast({ title: "Not added", description: apiErrorMessage(e), variant: "destructive" }),
  });
  return (
    <div className="grid gap-2 rounded-lg border p-3 sm:grid-cols-5" data-testid="form-queue-add">
      <Input placeholder="Company" value={f.company} onChange={(e) => setF({ ...f, company: e.target.value })} />
      <Input placeholder="Website (example.com)" value={f.domain} onChange={(e) => setF({ ...f, domain: e.target.value })} />
      <Input placeholder="Email" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
      <Select value={f.kind} onValueChange={(v) => setF({ ...f, kind: v })}>
        <SelectTrigger><SelectValue /></SelectTrigger>
        <SelectContent>{MEDIA_TEMPLATE_KINDS.map((k) => <SelectItem key={k} value={k}>{MEDIA_TEMPLATE_KIND_LABELS[k]}</SelectItem>)}</SelectContent>
      </Select>
      <Button disabled={add.isPending || !f.company || !f.domain || !f.email} onClick={() => add.mutate()} data-testid="button-queue-add">
        <Plus className="mr-2 h-4 w-4" />Add to queue
      </Button>
    </div>
  );
}

export function QueueSection() {
  const [status, setStatus] = useState<"queued" | "sent" | "skipped">("queued");
  const [kind, setKind] = useState("all");
  const [q, setQ] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [openId, setOpenId] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);
  useEffect(() => { const t = setTimeout(() => { setSearch(q.trim()); setPage(0); }, 300); return () => clearTimeout(t); }, [q]);
  const p = new URLSearchParams({ status, limit: String(PAGE), offset: String(page * PAGE) });
  if (kind !== "all") p.set("kind", kind);
  if (search) p.set("q", search);
  const url = `/api/admin/media-inbox/queue?${p}`;
  const { data } = useQuery<QueuePayload>({ queryKey: [url], queryFn: () => getJson(url), placeholderData: keepPreviousData });
  const open = data?.rows.find((r) => r.id === openId) ?? null;
  const pages = Math.max(1, Math.ceil((data?.total ?? 0) / PAGE));
  return (
    <Section title="Send queue" icon={InboxIcon} description="Every company waiting for its first email. Open one to read the exact email, change the address or type, send it now or skip it."
      actions={<Button size="sm" variant="outline" onClick={() => setAdding(!adding)} data-testid="button-queue-toggle-add"><Plus className="mr-2 h-4 w-4" />Add a contact</Button>}>
      {adding && <div className="mb-3"><AddContact /></div>}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Tabs value={status} onValueChange={(v) => { setStatus(v as typeof status); setPage(0); }}>
          <TabsList>
            <TabsTrigger value="queued" data-testid="tab-queue-queued">Waiting ({n(data?.counts.queued)})</TabsTrigger>
            <TabsTrigger value="sent">Sent ({n(data?.counts.sent)})</TabsTrigger>
            <TabsTrigger value="skipped">Skipped ({n(data?.counts.skipped)})</TabsTrigger>
          </TabsList>
        </Tabs>
        <Select value={kind} onValueChange={(v) => { setKind(v); setPage(0); }}>
          <SelectTrigger className="w-52" data-testid="select-queue-filter"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Every type</SelectItem>
            {MEDIA_TEMPLATE_KINDS.map((k) => <SelectItem key={k} value={k}>{MEDIA_TEMPLATE_KIND_LABELS[k]}{status === "queued" ? ` (${n(data?.byKind[k])})` : ""}</SelectItem>)}
          </SelectContent>
        </Select>
        <Input className="w-64" placeholder="Search company, website or email" value={q} onChange={(e) => setQ(e.target.value)} data-testid="input-queue-search" />
      </div>
      <GoogleList as="ul" testId="list-queue">
        {(data?.rows ?? []).map((r) => (
          <GoogleListRow as="li" size="md" key={r.id} testId={`row-queue-${r.id}`} title={r.company} onOpen={() => setOpenId(r.id)}
            badges={<StatusPill tone={r.status === "sent" ? "success" : r.status === "skipped" ? "neutral" : "info"}>{r.status === "queued" ? "Waiting" : r.status === "sent" ? "Sent" : "Skipped"}</StatusPill>}
            meta={[r.domain, r.toEmail, KIND_LABEL(r.kind), r.status === "sent" ? `sent ${ago(r.sentAt)}` : `queued ${ago(r.queuedAt)}`]}
            line={r.reason ?? undefined} />
        ))}
      </GoogleList>
      {data && !data.rows.length && <div className="g-callout"><h3>Nothing here</h3><p>No contacts match.</p></div>}
      {pages > 1 && (
        <div className="mt-3 flex items-center justify-between text-sm">
          <span className="text-muted-foreground">page {page + 1} of {n(pages)}</span>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</Button>
            <Button size="sm" variant="outline" disabled={page + 1 >= pages} onClick={() => setPage(page + 1)}>Next</Button>
          </div>
        </div>
      )}
      <QueueSheet row={open} onClose={() => setOpenId(null)} />
    </Section>
  );
}

// ── Settings + templates ─────────────────────────────────────────────────────────────────────────────────────────────

const num = (v: string) => Math.max(0, Math.floor(Number(v) || 0));

export function SettingsSection() {
  const { toast } = useToast();
  const { data } = useQuery<SettingsPayload>({ queryKey: ["/api/admin/media-inbox/settings"], queryFn: () => getJson("/api/admin/media-inbox/settings") });
  const [f, setF] = useState<MediaSettings | null>(null);
  useEffect(() => { if (data && !f) setF(data.settings); }, [data, f]);
  const save = useMutation({
    mutationFn: async (body: Partial<MediaSettings> | Record<string, unknown>) => (await apiRequest("POST", "/api/admin/media-inbox/settings", body)).json(),
    onSuccess: () => { toast({ title: "Settings saved" }); setF(null); void refresh(); },
    onError: (e) => toast({ title: "Not saved", description: apiErrorMessage(e), variant: "destructive" }),
  });
  if (!data || !f) return <Section title="Sending settings" icon={Settings2}><Loader2 className="h-4 w-4 animate-spin" aria-label="Loading" /></Section>;
  const s = data.settings;
  const dirty = JSON.stringify({ ...f, templates: undefined }) !== JSON.stringify({ ...s, templates: undefined });
  const preview = f.outreach === "paused" ? 0 : f.outreach === "fixed" ? f.fixedPerDay : Math.min(f.maxPerDay, f.rampStart + f.rampStep * data.daysSending);
  return (
    <>
      <Section title="Sending settings" icon={Settings2} description="How many first-contact emails go out, and what the inbox does on its own. Saved changes apply from the next check (every 30 minutes).">
        <div className="space-y-4 text-sm" data-testid="form-media-settings">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label>First-contact emails</Label>
              <Select value={f.outreach} onValueChange={(v) => setF({ ...f, outreach: v as MediaOutreachMode })}>
                <SelectTrigger data-testid="select-outreach-mode"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ramp">Ramp up a little each day (safest for a new mailbox)</SelectItem>
                  <SelectItem value="fixed">The same number every day</SelectItem>
                  <SelectItem value="paused">Paused — send none</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="rounded-lg bg-muted/50 p-3">
              <div className="text-muted-foreground">With these settings, today</div>
              <div className="text-lg font-medium" data-testid="text-outreach-today">{n(preview)} emails</div>
              <div className="text-xs text-muted-foreground">day {data.daysSending + 1} of sending · bounces above ~2% get a new mailbox flagged by Gmail</div>
            </div>
            {f.outreach === "ramp" && (
              <>
                <div><Label htmlFor="s-start">First day</Label><Input id="s-start" type="number" min={0} value={f.rampStart} onChange={(e) => setF({ ...f, rampStart: num(e.target.value) })} /></div>
                <div><Label htmlFor="s-step">Add each day</Label><Input id="s-step" type="number" min={0} value={f.rampStep} onChange={(e) => setF({ ...f, rampStep: num(e.target.value) })} /></div>
                <div><Label htmlFor="s-max">Never more than (a day)</Label><Input id="s-max" type="number" min={0} value={f.maxPerDay} onChange={(e) => setF({ ...f, maxPerDay: num(e.target.value) })} /></div>
              </>
            )}
            {f.outreach === "fixed" && (
              <div><Label htmlFor="s-fixed">Emails a day</Label><Input id="s-fixed" type="number" min={0} value={f.fixedPerDay} onChange={(e) => setF({ ...f, fixedPerDay: num(e.target.value) })} data-testid="input-fixed-per-day" /></div>
            )}
          </div>
          <label className="flex items-center justify-between gap-3 rounded-lg border p-3">
            <span><span className="font-medium">Answer emails automatically</span><br /><span className="text-xs text-muted-foreground">Off: every new email waits for you under “Waiting for you”.</span></span>
            <Switch checked={f.autoReplies} onCheckedChange={(v) => setF({ ...f, autoReplies: v })} data-testid="switch-auto-replies" />
          </label>
          <label className="flex items-center justify-between gap-3 rounded-lg border p-3">
            <span><span className="font-medium">Follow up when nobody answers</span><br /><span className="text-xs text-muted-foreground">A follow-up after 5 days, then another address from their website.</span></span>
            <Switch checked={f.followUps} onCheckedChange={(v) => setF({ ...f, followUps: v })} data-testid="switch-follow-ups" />
          </label>
          <div className="flex gap-2">
            <Button disabled={!dirty || save.isPending} onClick={() => { const { templates: _t, ...rest } = f; save.mutate(rest); }} data-testid="button-save-settings">
              {save.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}Save settings
            </Button>
            {dirty && <Button variant="outline" onClick={() => setF(s)}>Undo</Button>}
          </div>
        </div>
      </Section>
      <TemplatesSection data={data} />
    </>
  );
}

function TemplatesSection({ data }: { data: SettingsPayload }) {
  const { toast } = useToast();
  const [kind, setKind] = useState<MediaTemplateKind>("directory");
  const current = data.settings.templates[kind] ?? data.builtIn[kind];
  const custom = Boolean(data.settings.templates[kind]);
  const [t, setT] = useState(current);
  useEffect(() => { setT(data.settings.templates[kind] ?? data.builtIn[kind]); }, [kind, data]);
  const save = useMutation({
    mutationFn: async (v: { subject: string; body: string } | null) => (await apiRequest("POST", "/api/admin/media-inbox/settings", { templates: { [kind]: v } })).json(),
    onSuccess: (_r, v) => { toast({ title: v ? "Template saved" : "Back to the built-in email" }); void refresh(); },
    onError: (e) => toast({ title: "Not saved", description: apiErrorMessage(e), variant: "destructive" }),
  });
  const dirty = t.subject !== current.subject || t.body !== current.body;
  const noStop = !STOP_LINE_RE.test(t.body);
  return (
    <Section title="First-contact emails" icon={FileText} description="The email each type of company gets first. {company} is replaced by the company's name. Every email must keep its stop line.">
      <Tabs value={kind} onValueChange={(v) => setKind(v as MediaTemplateKind)} className="mb-3">
        <TabsList className="flex-wrap">
          {MEDIA_TEMPLATE_KINDS.map((k) => <TabsTrigger key={k} value={k}>{MEDIA_TEMPLATE_KIND_LABELS[k]}{data.settings.templates[k] ? " ✎" : ""}</TabsTrigger>)}
        </TabsList>
      </Tabs>
      <div className="space-y-2 text-sm" data-testid={`form-template-${kind}`}>
        <div className="text-xs text-muted-foreground">{custom ? "Your edited version is in use." : "The built-in email is in use."} {SIGNATURE_NOTE}</div>
        <Input value={t.subject} onChange={(e) => setT({ ...t, subject: e.target.value })} data-testid="input-template-subject" />
        <Textarea rows={16} value={t.body} onChange={(e) => setT({ ...t, body: e.target.value })} data-testid="input-template-body" />
        {noStop && <p className="text-xs text-destructive">Keep a stop line, e.g. If this isn't something you handle, reply "stop" and we won't email you again.</p>}
        <div className="flex flex-wrap gap-2">
          <Button disabled={!dirty || noStop || save.isPending} onClick={() => save.mutate(t)} data-testid="button-save-template"><Save className="mr-2 h-4 w-4" />Save email</Button>
          {dirty && <Button variant="outline" onClick={() => setT(current)}>Undo</Button>}
          {custom && <Button variant="outline" disabled={save.isPending} onClick={() => save.mutate(null)}><RotateCcw className="mr-2 h-4 w-4" />Use the built-in email</Button>}
        </div>
      </div>
    </Section>
  );
}
