/**
 * /admin/partnerships — the media@ relationships inbox (shared/media-inbox.ts): every company we are building a
 * relationship with (directories, article sites, news media, PBNs), what was agreed and what is left to finalize, and
 * every email sent and received. The server reads media@ every 30 minutes and answers each email; anything that would
 * cost money waits for the owner. Platform admins only.
 */
import { useMemo, useState } from "react";
import { keepPreviousData, useMutation, useQuery } from "@tanstack/react-query";
import { formatDistanceToNowStrict } from "date-fns";
import { Handshake, Inbox, Loader2, Lock, Mail, Play, Scale, Send } from "lucide-react";
import {
  MEDIA_INBOX_LAWS, MEDIA_INBOX_PARAMETERS, MEDIA_MESSAGE_STATUS_LABELS, MEDIA_PARTNER_KINDS, MEDIA_PARTNER_KIND_LABELS, MEDIA_PARTNER_STATUSES, MEDIA_PARTNER_STATUS_LABELS,
  type MediaMessage, type MediaMessageStatus, type MediaPartner, type MediaPartnerKind, type MediaPartnerStatus,
} from "@shared/media-inbox";
import { apiErrorMessage, apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { AppPage, Notice, Section, Stat, StatGrid } from "@/components/app-ui";
import { GoogleSectionHeader } from "@/components/google";
import { StatusPill, type PillTone } from "@/components/crm-ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useDocumentTitle } from "@/components/feature-landing/primitives";
import { VerificationCancelled } from "@/components/recent-auth";

type Summary = {
  mailbox: string | null; configured: boolean; enabled: boolean; intervalMin: number; lastPassAt: string | null; lastPassError: string | null;
  counts: Partial<Record<MediaMessageStatus, number>>; partners: Partial<Record<MediaPartnerStatus, number>>; sent: number;
};
type MessagesPayload = { rows: MediaMessage[]; total: number };

const PARTNER_TONE: Record<MediaPartnerStatus, PillTone> = { talking: "info", agreed: "teal", finalized: "success", declined: "neutral" };
const MESSAGE_TONE: Record<MediaMessageStatus, PillTone> = { new: "info", replied: "success", needs_owner: "warning", automated: "neutral", failed: "danger" };
const PAGE = 50;
const n = (v: number | undefined) => (v ?? 0).toLocaleString("en-US");
const ago = (iso: string | null) => (iso ? `${formatDistanceToNowStrict(new Date(iso))} ago` : "—");
const getJson = async <T,>(url: string): Promise<T> => (await apiRequest("GET", url)).json();
const refresh = () => queryClient.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith("/api/admin/media-inbox") });

function PartnerSheet({ partner, onClose }: { partner: MediaPartner | null; onClose: () => void }) {
  const { toast } = useToast();
  const [toFinalize, setToFinalize] = useState<string | null>(null);
  const msgsUrl = partner ? `/api/admin/media-inbox/messages?partnerId=${partner.id}&limit=100` : null;
  const { data: msgs } = useQuery<MessagesPayload>({ queryKey: [msgsUrl], queryFn: () => getJson(msgsUrl!), enabled: !!msgsUrl });
  const save = useMutation({
    mutationFn: async (body: Record<string, unknown>) => (await apiRequest("POST", `/api/admin/media-inbox/partners/${partner!.id}`, body)).json(),
    onSuccess: (r: { addedTo: string | null; note: string | null }) => {
      toast({ title: "Saved", description: r.note ?? (r.addedTo ? `Added to the ${r.addedTo.toLowerCase()}` : undefined) });
      setToFinalize(null);
      void refresh();
    },
    onError: (e) => toast({ title: "Could not save", description: apiErrorMessage(e), variant: "destructive" }),
  });
  if (!partner) return null;
  return (
    <Sheet open onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl" data-testid="sheet-partner">
        <SheetHeader>
          <SheetTitle>{partner.company}</SheetTitle>
          <SheetDescription>{[partner.domain, MEDIA_PARTNER_KIND_LABELS[partner.kind], partner.contactEmail].filter(Boolean).join(" · ")}</SheetDescription>
        </SheetHeader>
        <div className="mt-4 space-y-4 text-sm">
          <div className="flex flex-wrap gap-2">
            <Select value={partner.status} onValueChange={(v) => save.mutate({ status: v })}>
              <SelectTrigger className="w-48" data-testid="select-partner-status"><SelectValue /></SelectTrigger>
              <SelectContent>{MEDIA_PARTNER_STATUSES.map((s) => <SelectItem key={s} value={s}>{MEDIA_PARTNER_STATUS_LABELS[s]}</SelectItem>)}</SelectContent>
            </Select>
            <Select value={partner.kind} onValueChange={(v) => save.mutate({ kind: v })}>
              <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
              <SelectContent>{MEDIA_PARTNER_KINDS.map((k) => <SelectItem key={k} value={k}>{MEDIA_PARTNER_KIND_LABELS[k]}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          {partner.summary && <p>{partner.summary}</p>}
          <dl className="grid grid-cols-[8rem_1fr] gap-x-3 gap-y-2">
            <dt className="text-muted-foreground">Agreement</dt><dd>{partner.agreement ?? "—"}</dd>
            <dt className="text-muted-foreground">Cost terms</dt><dd>{partner.costTerms ?? "None mentioned"}</dd>
            <dt className="text-muted-foreground">Owner decision</dt><dd>{partner.ownerQuestion ?? "—"}</dd>
            <dt className="text-muted-foreground">Added to</dt><dd>{partner.addedTo ?? "Not yet (added when agreed)"}</dd>
            <dt className="text-muted-foreground">Agreed</dt><dd>{partner.agreedAt ? ago(partner.agreedAt) : "—"}</dd>
          </dl>
          <div>
            <div className="mb-1 font-medium">What we need to finalize</div>
            <Textarea rows={3} value={toFinalize ?? partner.toFinalize ?? ""} onChange={(e) => setToFinalize(e.target.value)} data-testid="input-partner-finalize" />
            {toFinalize !== null && <Button size="sm" className="mt-2" disabled={save.isPending} onClick={() => save.mutate({ toFinalize: toFinalize.trim() || null })}>Save</Button>}
          </div>
          <div>
            <div className="mb-2 font-medium">Emails ({msgs?.total ?? 0})</div>
            <div className="space-y-2">{(msgs?.rows ?? []).map((m) => <MessageCard key={m.id} m={m} />)}</div>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function MessageCard({ m }: { m: MediaMessage }) {
  const [open, setOpen] = useState(false);
  const { toast } = useToast();
  const handled = useMutation({
    mutationFn: async () => apiRequest("POST", `/api/admin/media-inbox/messages/${m.id}/handled`, {}),
    onSuccess: () => { toast({ title: "Marked handled" }); void refresh(); },
  });
  return (
    <div className="rounded-lg border p-3" data-testid={`card-media-message-${m.id}`}>
      <button type="button" className="flex w-full items-start gap-2 text-left" onClick={() => setOpen(!open)}>
        {m.direction === "out" ? <Send className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-label="Sent" /> : <Inbox className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-label="Received" />}
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium">{m.subject || "(no subject)"}</div>
          <div className="truncate text-xs text-muted-foreground">
            {m.direction === "out" ? `To ${m.toEmail}` : `From ${m.fromName ? `${m.fromName} <${m.fromEmail}>` : m.fromEmail}`}{m.company ? ` · ${m.company}` : ""} · {ago(m.receivedAt)}
          </div>
          {m.reason && m.direction === "in" && <div className="mt-0.5 text-xs text-muted-foreground">{m.reason}</div>}
        </div>
        {m.direction === "in" && <StatusPill tone={MESSAGE_TONE[m.status]}>{MEDIA_MESSAGE_STATUS_LABELS[m.status]}</StatusPill>}
      </button>
      {open && <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap break-words rounded bg-muted/50 p-2 font-sans text-xs">{m.body}</pre>}
      {open && m.direction === "in" && (m.status === "needs_owner" || m.status === "failed") && (
        <Button size="sm" variant="outline" className="mt-2" disabled={handled.isPending} onClick={() => handled.mutate()}>Mark handled</Button>
      )}
    </div>
  );
}

function SendBox() {
  const { toast } = useToast();
  const [f, setF] = useState({ company: "", domain: "", kind: "directory" as MediaPartnerKind, to: "", subject: "", body: "" });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const send = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/admin/media-inbox/send", { ...f, domain: f.domain.trim() || undefined })).json(),
    onSuccess: () => { toast({ title: "Sent from media@" }); setF({ ...f, to: "", subject: "", body: "", company: "", domain: "" }); void refresh(); },
    onError: (e) => toast({ title: "Not sent", description: apiErrorMessage(e), variant: "destructive" }),
  });
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      <Input placeholder="Company" value={f.company} onChange={set("company")} data-testid="input-send-company" />
      <Input placeholder="Website (example.com)" value={f.domain} onChange={set("domain")} />
      <Select value={f.kind} onValueChange={(v) => setF({ ...f, kind: v as MediaPartnerKind })}>
        <SelectTrigger><SelectValue /></SelectTrigger>
        <SelectContent>{MEDIA_PARTNER_KINDS.map((k) => <SelectItem key={k} value={k}>{MEDIA_PARTNER_KIND_LABELS[k]}</SelectItem>)}</SelectContent>
      </Select>
      <Input placeholder="To (email)" type="email" value={f.to} onChange={set("to")} data-testid="input-send-to" />
      <Input className="sm:col-span-2" placeholder="Subject" value={f.subject} onChange={set("subject")} />
      <Textarea className="sm:col-span-2" rows={6} placeholder="Message (the Construct HUB Media Team signature is added)" value={f.body} onChange={set("body")} />
      <div className="sm:col-span-2">
        <Button disabled={send.isPending || !f.company || !f.to || !f.subject || !f.body} onClick={() => send.mutate()} data-testid="button-send-media">
          {send.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Mail className="mr-2 h-4 w-4" />}Send from media@
        </Button>
      </div>
    </div>
  );
}

export default function AdminPartnershipsPage() {
  useDocumentTitle("Partnerships");
  const { toast } = useToast();
  const [partnerTab, setPartnerTab] = useState<"all" | MediaPartnerStatus>("all");
  const [mailTab, setMailTab] = useState<"all" | "out" | "in" | "needs_owner">("all");
  const [page, setPage] = useState(0);
  const [openId, setOpenId] = useState<number | null>(null);

  const { data: s, error, isLoading, refetch } = useQuery<Summary>({ queryKey: ["/api/admin/media-inbox/summary"], queryFn: () => getJson("/api/admin/media-inbox/summary"), retry: false });
  const partnersUrl = `/api/admin/media-inbox/partners${partnerTab === "all" ? "" : `?status=${partnerTab}`}`;
  const { data: partners } = useQuery<MediaPartner[]>({ queryKey: [partnersUrl], queryFn: () => getJson(partnersUrl), enabled: !!s });
  const mp = new URLSearchParams({ limit: String(PAGE), offset: String(page * PAGE) });
  if (mailTab === "out" || mailTab === "in") mp.set("direction", mailTab);
  if (mailTab === "needs_owner") mp.set("status", "needs_owner");
  const msgsUrl = `/api/admin/media-inbox/messages?${mp}`;
  const { data: msgs } = useQuery<MessagesPayload>({ queryKey: [msgsUrl], queryFn: () => getJson(msgsUrl), enabled: !!s, placeholderData: keepPreviousData });
  const run = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/admin/media-inbox/run", {})).json(),
    onSuccess: (r: any) => { toast({ title: r.ok ? `Checked: ${r.read ?? 0} new, ${r.replied ?? 0} replied, ${r.held ?? 0} waiting for you` : "Not run", description: r.skipped }); void refresh(); },
    onError: (e) => toast({ title: "Could not run", description: apiErrorMessage(e), variant: "destructive" }),
  });
  const open = useMemo(() => partners?.find((p) => p.id === openId) ?? null, [partners, openId]);

  if (isLoading && !s) return <div className="flex justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-label="Loading" /></div>;
  if (!s) {
    const reauth = error instanceof VerificationCancelled || /reauth/.test(String((error as Error | null)?.message ?? ""));
    return (
      <div className="mx-auto max-w-xl px-4 py-16 text-center" data-testid="page-admin-partnerships-denied">
        <Lock className="mx-auto h-6 w-6 text-muted-foreground" aria-hidden="true" />
        <h1 className="mt-3 text-lg font-semibold">{reauth ? "Verify it's you" : "Platform admins only"}</h1>
        {reauth && <Button className="mt-4" onClick={() => void refetch()}>Verify identity</Button>}
      </div>
    );
  }

  const pages = Math.max(1, Math.ceil((msgs?.total ?? 0) / PAGE));
  const received = Object.entries(s.counts).reduce((a, [, v]) => a + (v ?? 0), 0);
  return (
    <AppPage testId="page-admin-partnerships">
      <GoogleSectionHeader as="h1" title="Partnerships" description={`Relationships with directories, article sites, news media and PBNs — run from ${s.mailbox ?? "media@constructhub.us"}.`} flush />
      <div className="min-w-0 space-y-4">
        {(!s.configured || !s.enabled) && (
          <Notice tone="info" title="Inbox automation" testId="notice-partnerships-config">
            {!s.configured ? "The media@ mailbox or the AI key is missing in the server settings." : "Automatic checking is off (MEDIA_INBOX_ENABLED=true turns it on) — use Check now."}
          </Notice>
        )}
        {s.lastPassError && <Notice tone="warning" title="Last check failed">{s.lastPassError}</Notice>}
        <StatGrid cols={5}>
          <Stat label="Agreed — to finalize" value={n(s.partners.agreed)} onClick={() => setPartnerTab("agreed")} selected={partnerTab === "agreed"} testId="stat-partners-agreed" />
          <Stat label="Finalized" value={n(s.partners.finalized)} onClick={() => setPartnerTab("finalized")} selected={partnerTab === "finalized"} />
          <Stat label="Talking" value={n(s.partners.talking)} onClick={() => setPartnerTab("talking")} selected={partnerTab === "talking"} />
          <Stat label="Emails sent" value={n(s.sent)} hint={`${n(received)} received`} onClick={() => setMailTab("out")} />
          <Stat label="Waiting for you" value={n(s.counts.needs_owner)} tone={s.counts.needs_owner ? "bad" : "default"} onClick={() => setMailTab("needs_owner")} hint={`checked ${ago(s.lastPassAt)}`} />
        </StatGrid>

        <Section title="Companies" icon={Handshake} actions={
          <Button size="sm" variant="outline" disabled={run.isPending} onClick={() => run.mutate()} data-testid="button-media-run">
            {run.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}Check now
          </Button>
        }>
          <Tabs value={partnerTab} onValueChange={(v) => setPartnerTab(v as typeof partnerTab)} className="mb-3">
            <TabsList className="flex-wrap">
              <TabsTrigger value="all">All</TabsTrigger>
              {MEDIA_PARTNER_STATUSES.map((st) => <TabsTrigger key={st} value={st}>{MEDIA_PARTNER_STATUS_LABELS[st]} ({n(s.partners[st])})</TabsTrigger>)}
            </TabsList>
          </Tabs>
          <div className="divide-y rounded-lg border" data-testid="list-partners">
            {(partners ?? []).map((p) => (
              <button key={p.id} type="button" onClick={() => setOpenId(p.id)} className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-muted/50" data-testid={`row-partner-${p.id}`}>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{p.company}{p.domain && p.domain !== p.company ? <span className="font-normal text-muted-foreground"> · {p.domain}</span> : null}</div>
                  <div className="truncate text-xs text-muted-foreground">{MEDIA_PARTNER_KIND_LABELS[p.kind]} · {p.messages} emails · last {ago(p.lastMessageAt)}{p.addedTo ? ` · in the ${p.addedTo.toLowerCase()}` : ""}</div>
                  {(p.toFinalize || p.ownerQuestion) && <div className="truncate text-xs">{p.status === "agreed" && p.toFinalize ? `To finalize: ${p.toFinalize}` : p.ownerQuestion ? `Your call: ${p.ownerQuestion}` : ""}</div>}
                </div>
                <StatusPill tone={PARTNER_TONE[p.status]}>{MEDIA_PARTNER_STATUS_LABELS[p.status]}</StatusPill>
              </button>
            ))}
            {partners && !partners.length && <p className="px-3 py-8 text-center text-sm text-muted-foreground">No companies yet. They appear here as emails come in or go out.</p>}
          </div>
        </Section>

        <Section title="Emails" icon={Mail}>
          <Tabs value={mailTab} onValueChange={(v) => { setMailTab(v as typeof mailTab); setPage(0); }} className="mb-3">
            <TabsList className="flex-wrap">
              <TabsTrigger value="all">All</TabsTrigger>
              <TabsTrigger value="out" data-testid="tab-media-sent">Sent ({n(s.sent)})</TabsTrigger>
              <TabsTrigger value="in">Received ({n(received)})</TabsTrigger>
              <TabsTrigger value="needs_owner">Waiting for you ({n(s.counts.needs_owner)})</TabsTrigger>
            </TabsList>
          </Tabs>
          <div className="space-y-2" data-testid="list-media-messages">
            {(msgs?.rows ?? []).map((m) => <MessageCard key={m.id} m={m} />)}
            {msgs && !msgs.rows.length && <p className="py-8 text-center text-sm text-muted-foreground">No emails here yet.</p>}
          </div>
          {pages > 1 && (
            <div className="mt-3 flex items-center justify-between text-sm">
              <span className="text-muted-foreground">page {page + 1} of {pages}</span>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</Button>
                <Button size="sm" variant="outline" disabled={page + 1 >= pages} onClick={() => setPage(page + 1)}>Next</Button>
              </div>
            </div>
          )}
        </Section>

        <Section title="Inbox laws" icon={Scale} description="What the AI answering media@ must follow. Laws marked “Checked in code” are verified on every reply before it is sent, whichever model wrote it; a reply that breaks one is replaced by a holding reply and waits for you.">
          <ol className="list-decimal space-y-1.5 pl-5 text-sm" data-testid="list-inbox-laws">
            {MEDIA_INBOX_LAWS.map((l) => (
              <li key={l.law}>
                {l.law}{" "}
                <StatusPill tone={l.enforced === "code" ? "success" : "neutral"} dot={false}>{l.enforced === "code" ? "Checked in code" : "Instruction"}</StatusPill>
              </li>
            ))}
          </ol>
          <dl className="mt-4 grid grid-cols-[minmax(0,14rem)_1fr] gap-x-3 gap-y-1.5 text-sm" data-testid="list-inbox-parameters">
            <dt className="text-muted-foreground">Checks the inbox</dt><dd>every {s.intervalMin} minutes</dd>
            <dt className="text-muted-foreground">Reply length</dt><dd>under {MEDIA_INBOX_PARAMETERS.maxReplyWords} words (never sent over {MEDIA_INBOX_PARAMETERS.hardReplyWordLimit})</dd>
            <dt className="text-muted-foreground">Replies to one sender</dt><dd>at most {MEDIA_INBOX_PARAMETERS.maxRepliesPerSenderPerDay} a day (stops loops with other auto-responders)</dd>
            <dt className="text-muted-foreground">If the AI fails</dt><dd>{MEDIA_INBOX_PARAMETERS.aiAttemptsBeforeHolding} tries, then a holding reply</dd>
            <dt className="text-muted-foreground">No answer</dt><dd>a follow-up after {MEDIA_INBOX_PARAMETERS.followUpAfterDays} days; {MEDIA_INBOX_PARAMETERS.followUpAfterDays} more days → a new contact from their website (up to {MEDIA_INBOX_PARAMETERS.maxContactsPerCompany} addresses per company)</dd>
            <dt className="text-muted-foreground">AI order</dt><dd>{MEDIA_INBOX_PARAMETERS.aiOrder.join(" → ")}</dd>
          </dl>
        </Section>

        <Section title="Email a company" description="First contact from media@. Replies are answered automatically every 30 minutes; nothing that costs money is agreed.">
          <SendBox />
        </Section>
      </div>
      <PartnerSheet partner={open} onClose={() => setOpenId(null)} />
    </AppPage>
  );
}
