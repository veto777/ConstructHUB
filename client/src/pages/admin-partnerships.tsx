/**
 * /admin/partnerships — the media@ relationships inbox (shared/media-inbox.ts): every company we are building a
 * relationship with (directories, article sites, news media, PBNs), what was agreed and what is left to finalize, and
 * every email sent and received. The server reads media@ every 30 minutes and answers each email; anything that would
 * cost money waits for the owner. Platform admins only.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "wouter";
import { keepPreviousData, useMutation, useQuery } from "@tanstack/react-query";
import { format, formatDistanceToNowStrict } from "date-fns";
import { AlertCircle, ChevronDown, ChevronUp, FileText, Handshake, Inbox, Loader2, Lock, Mail, MessageSquare, Play, Receipt, RefreshCw, Scale, Search, Send, Settings2, Sparkles, StickyNote } from "lucide-react";
import {
  MEDIA_BRIEF_LABELS, MEDIA_INBOX_LAWS, MEDIA_INBOX_PARAMETERS, MEDIA_MESSAGE_STATUS_LABELS, MEDIA_PARTNER_GROUPS, MEDIA_PARTNER_GROUP_LABELS, MEDIA_PARTNER_KINDS,
  MEDIA_PARTNER_KIND_LABELS, MEDIA_PARTNER_STATUSES, MEDIA_PARTNER_STATUS_LABELS, partnerGroup,
  type MediaMessage, type MediaMessageStatus, type MediaPartner, type MediaPartnerGroup, type MediaPartnerKind, type MediaPartnerStatus,
} from "@shared/media-inbox";
import { apiErrorMessage, apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { AppPage, Notice, Section, Stat, StatGrid } from "@/components/app-ui";
import { GoogleList, GoogleListRow, GoogleSectionHeader } from "@/components/google";
import { StatusPill, type PillTone } from "@/components/crm-ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useDocumentTitle } from "@/components/feature-landing/primitives";
import { VerificationCancelled } from "@/components/recent-auth";
import { QueueSection, SettingsSection } from "./admin-partnerships-controls";

type Summary = {
  mailbox: string | null; configured: boolean; enabled: boolean; intervalMin: number; lastPassAt: string | null; lastPassError: string | null;
  counts: Partial<Record<MediaMessageStatus, number>>; partners: Partial<Record<MediaPartnerStatus, number>>; sent: number;
  queue: { queued: number; sent: number; sentToday: number; perDay: number };
};
type MessagesPayload = { rows: MediaMessage[]; total: number };

const PARTNER_TONE: Record<MediaPartnerStatus, PillTone> = { talking: "info", agreed: "teal", finalized: "success", declined: "neutral" };
const MESSAGE_TONE: Record<MediaMessageStatus, PillTone> = { new: "info", replied: "success", needs_owner: "warning", automated: "neutral", failed: "danger", logged: "neutral" };
const PAGE = 50;
const n = (v: number | undefined) => (v ?? 0).toLocaleString("en-US");
const ago = (iso: string | null) => (iso ? `${formatDistanceToNowStrict(new Date(iso))} ago` : "—");
/** "Oct 15, 2026, 12:37 AM (9 hours ago)": when an email was received or sent, in the viewer's time zone. */
const when = (iso: string) => `${format(new Date(iso), "MMM d, yyyy, h:mm a")} (${ago(iso)})`;
const getJson = async <T,>(url: string): Promise<T> => (await apiRequest("GET", url)).json();
const refresh = () => queryClient.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith("/api/admin/media-inbox") });

/** Unsent text kept in this browser (owner 2026-10-15: closing the panel by accident erased a reply). */
function useDraft<T>(key: string, initial: T): [T, (v: T) => void, () => void] {
  const read = (): T => { try { const v = localStorage.getItem(key); return v ? { ...initial, ...JSON.parse(v) } : initial; } catch { return initial; } };
  const [v, setV] = useState<T>(read);
  useEffect(() => { setV(read()); }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (next: T) => { setV(next); try { localStorage.setItem(key, JSON.stringify(next)); } catch { /* private window */ } };
  const clear = () => { setV(initial); try { localStorage.removeItem(key); } catch { /* private window */ } };
  return [v, set, clear];
}
/** A clearly headed block in the company panel, each with its own background so the parts don't blend. */
function Panel({ title, icon: Icon, tone = "plain", children, testId }: { title: string; icon?: typeof Mail; tone?: "plain" | "reply" | "notes" | "alert"; children: React.ReactNode; testId?: string }) {
  const tones = {
    plain: "border-border bg-card",
    reply: "border-blue-300 bg-blue-50 dark:border-blue-800 dark:bg-blue-950/40",
    notes: "border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30",
    alert: "border-orange-300 bg-orange-50 dark:border-orange-800 dark:bg-orange-950/30",
  } as const;
  return (
    <section className={`rounded-xl border p-4 ${tones[tone]}`} data-testid={testId}>
      <h3 className="mb-3 flex items-center gap-2 text-base font-semibold text-foreground">{Icon && <Icon className="h-4 w-4" aria-hidden="true" />}{title}</h3>
      {children}
    </section>
  );
}

/** The company's summary (owner, 2026-10-25): written by the AI from the emails and notes, rewritten when one arrives. */
function BriefPanel({ partner }: { partner: MediaPartner }) {
  const { toast } = useToast();
  const write = useMutation({
    mutationFn: async () => (await apiRequest("POST", `/api/admin/media-inbox/partners/${partner.id}/brief`, {})).json(),
    onSuccess: () => { toast({ title: "Summary updated" }); void refresh(); },
    onError: (e) => toast({ title: "No summary", description: apiErrorMessage(e), variant: "destructive" }),
  });
  const b = partner.brief;
  return (
    <Panel title="Summary" icon={FileText} testId="panel-partner-brief">
      {b ? (
        <div className="space-y-2">
          <p className="font-medium">{b.who}</p>
          <dl className="grid grid-cols-[8rem_1fr] gap-x-3 gap-y-1.5">
            {(Object.keys(MEDIA_BRIEF_LABELS) as (keyof typeof MEDIA_BRIEF_LABELS)[]).filter((k) => b[k]).map((k) => (
              <div key={k} className="contents"><dt className="font-medium text-foreground/70">{MEDIA_BRIEF_LABELS[k]}</dt><dd>{b[k]}</dd></div>
            ))}
          </dl>
        </div>
      ) : <p className="text-muted-foreground">No summary yet. It is written from the emails once they answer, or now:</p>}
      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-foreground/70">
        {partner.briefUpdatedAt && <span>Updated {ago(partner.briefUpdatedAt)} · rewritten when a new email comes in or goes out</span>}
        <Button size="sm" variant="outline" disabled={write.isPending} onClick={() => write.mutate()} data-testid="button-partner-brief">
          {write.isPending ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-2 h-3.5 w-3.5" />}{b ? "Refresh summary" : "Write summary"}
        </Button>
      </div>
    </Panel>
  );
}

const typing = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));

type SheetNav = { index: number; total: number; prev: (() => void) | null; next: (() => void) | null };

function PartnerSheet({ partner, nav, onClose }: { partner: MediaPartner | null; nav: SheetNav; onClose: () => void }) {
  const { toast } = useToast();
  const scroller = useRef<HTMLDivElement | null>(null);
  // Owner 2026-10-25: "allow scrolling between potentials" — J/K or ←/→ move through the list in its current order.
  useEffect(() => {
    if (!partner) return;
    const onKey = (e: KeyboardEvent) => {
      if (typing(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if ((k === "j" || k === "arrowright") && nav.next) { e.preventDefault(); nav.next(); }
      else if ((k === "k" || k === "arrowleft") && nav.prev) { e.preventDefault(); nav.prev(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [partner, nav]);
  useEffect(() => { scroller.current?.scrollTo({ top: 0 }); }, [partner?.id]);
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
      {/* Only the close button or Esc closes it: a stray click outside never throws away a half-written reply. */}
      <SheetContent ref={scroller} className="w-full overflow-y-auto bg-muted/40 sm:max-w-2xl" onInteractOutside={(e) => e.preventDefault()} data-testid="sheet-partner">
        <div className="mb-3 flex items-center gap-2 pr-8 text-xs text-foreground/70" data-testid="nav-partner">
          <Button size="sm" variant="outline" disabled={!nav.prev} onClick={() => nav.prev?.()} aria-label="Previous company" data-testid="button-partner-prev"><ChevronUp className="mr-1 h-4 w-4" />Previous</Button>
          <Button size="sm" variant="outline" disabled={!nav.next} onClick={() => nav.next?.()} aria-label="Next company" data-testid="button-partner-next">Next<ChevronDown className="ml-1 h-4 w-4" /></Button>
          <span>{nav.index >= 0 ? `${n(nav.index + 1)} of ${n(nav.total)}` : "Not in the list below"} · J / K to move</span>
        </div>
        <SheetHeader>
          <SheetTitle className="flex flex-wrap items-center gap-2 text-xl">{partner.company}<StatusPill tone={PARTNER_TONE[partner.status]}>{MEDIA_PARTNER_STATUS_LABELS[partner.status]}</StatusPill></SheetTitle>
          <SheetDescription className="text-sm text-foreground/70">{[partner.domain, MEDIA_PARTNER_KIND_LABELS[partner.kind], partner.contactEmail].filter(Boolean).join(" · ")}</SheetDescription>
        </SheetHeader>
        <div className="mt-4 space-y-4 text-sm text-foreground">
          <BriefPanel partner={partner} />
          {partner.ownerQuestion && (
            <Panel title="Your call" tone="alert" testId="panel-partner-your-call"><p className="text-sm">{partner.ownerQuestion}</p></Panel>
          )}
          <Panel title="Conversation" icon={MessageSquare} testId="panel-partner-conversation">
            {/* Oldest first, like a mail thread; the newest is open. Ours are blue on the right, theirs white on the left. */}
            <div className="space-y-3" data-testid="list-partner-thread">
              {[...(msgs?.rows ?? [])].reverse().map((m, i, all) => <MessageCard key={m.id} m={m} defaultOpen={i === all.length - 1} inThread />)}
              {msgs && !msgs.rows.length && <p className="text-muted-foreground">No emails yet.</p>}
            </div>
          </Panel>
          <ReplyBox partner={partner} />
          <NotesBox partner={partner} />
          <Panel title="Status and details" icon={Handshake} testId="panel-partner-details">
            <div className="space-y-4">
              <div className="flex flex-wrap gap-2">
                <Select value={partner.status} onValueChange={(v) => save.mutate({ status: v })}>
                  <SelectTrigger className="w-48 bg-background" data-testid="select-partner-status"><SelectValue /></SelectTrigger>
                  <SelectContent>{MEDIA_PARTNER_STATUSES.map((s) => <SelectItem key={s} value={s}>{MEDIA_PARTNER_STATUS_LABELS[s]}</SelectItem>)}</SelectContent>
                </Select>
                <Select value={partner.kind} onValueChange={(v) => save.mutate({ kind: v })}>
                  <SelectTrigger className="w-40 bg-background"><SelectValue /></SelectTrigger>
                  <SelectContent>{MEDIA_PARTNER_KINDS.map((k) => <SelectItem key={k} value={k}>{MEDIA_PARTNER_KIND_LABELS[k]}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              {partner.summary && <p>{partner.summary}</p>}
              <ContactBox partner={partner} onSave={(b) => save.mutate(b)} saving={save.isPending} />
              <dl className="grid grid-cols-[8rem_1fr] gap-x-3 gap-y-2">
                <dt className="font-medium text-foreground/70">Agreement</dt><dd>{partner.agreement ?? "—"}</dd>
                <dt className="font-medium text-foreground/70">Their prices</dt><dd>{partner.costTerms ?? "None mentioned"} <Link href="/admin/partnerships/pricing" className="text-primary hover:underline">Partner pricing</Link></dd>
                <dt className="font-medium text-foreground/70">Added to</dt><dd>{partner.addedTo ?? "Not yet (added when agreed)"}</dd>
                <dt className="font-medium text-foreground/70">Agreed</dt><dd>{partner.agreedAt ? ago(partner.agreedAt) : "—"}</dd>
              </dl>
              <TermsBox partner={partner} onSave={(b) => save.mutate(b)} saving={save.isPending} />
              <div>
                <div className="mb-1 font-medium">What we need to finalize</div>
                <Textarea className="bg-background" rows={3} value={toFinalize ?? partner.toFinalize ?? ""} onChange={(e) => setToFinalize(e.target.value)} data-testid="input-partner-finalize" />
                {toFinalize !== null && <Button size="sm" className="mt-2" disabled={save.isPending} onClick={() => save.mutate({ toFinalize: toFinalize.trim() || null })}>Save</Button>}
              </div>
            </div>
          </Panel>
          {partner.status !== "declined" && <StopBox partner={partner} />}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function MessageCard({ m, defaultOpen = false, onOpenCompany, inThread = false }: { m: MediaMessage; defaultOpen?: boolean; onOpenCompany?: () => void; inThread?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const { toast } = useToast();
  const handled = useMutation({
    mutationFn: async () => apiRequest("POST", `/api/admin/media-inbox/messages/${m.id}/handled`, {}),
    onSuccess: () => { toast({ title: "Marked handled" }); void refresh(); },
  });
  return (
    <div
      className={`rounded-lg border p-3 ${m.direction === "out"
        ? `border-l-4 border-l-blue-600 bg-blue-50 dark:bg-blue-950/40 ${inThread ? "ml-6" : ""}`
        : `border-l-4 border-l-slate-500 bg-background ${inThread ? "mr-6" : ""}`}`}
      data-testid={`card-media-message-${m.id}`}
    >
      <button type="button" className="flex w-full items-start gap-2 text-left" onClick={() => setOpen(!open)}>
        {m.direction === "out" ? <Send className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-label="Sent" /> : <Inbox className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-label="Received" />}
        <div className="min-w-0 flex-1">
          <div className={`mb-0.5 text-[11px] font-semibold uppercase tracking-wide ${m.direction === "out" ? "text-blue-700 dark:text-blue-300" : "text-slate-600 dark:text-slate-300"}`}>{m.direction === "out" ? "We wrote" : "They wrote"}</div>
          <div className="truncate font-semibold text-foreground">{m.subject || "(no subject)"}</div>
          <div className="truncate text-xs text-foreground/70">
            {m.direction === "out" ? `To ${m.toEmail}` : `From ${m.fromName ? `${m.fromName} <${m.fromEmail}>` : m.fromEmail}`}{m.company ? ` · ${m.company}` : ""}
          </div>
          <div className="text-xs text-foreground/70" data-testid={`text-media-message-when-${m.id}`}>{m.direction === "out" ? "Sent" : "Received"} {when(m.receivedAt)}</div>
          {m.reason && m.direction === "in" && <div className="mt-0.5 text-xs text-muted-foreground">{m.reason}</div>}
        </div>
        {m.direction === "in" && <StatusPill tone={MESSAGE_TONE[m.status]}>{MEDIA_MESSAGE_STATUS_LABELS[m.status]}</StatusPill>}
      </button>
      {open && <pre className="mt-3 max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-md border bg-background p-3 font-sans text-sm leading-relaxed text-foreground">{m.body}</pre>}
      {open && (onOpenCompany || (m.direction === "in" && (m.status === "needs_owner" || m.status === "failed"))) && (
        <div className="mt-2 flex flex-wrap gap-2">
          {onOpenCompany && <Button size="sm" onClick={onOpenCompany} data-testid={`button-open-conversation-${m.id}`}><MessageSquare className="mr-2 h-4 w-4" />Open conversation & reply</Button>}
          {m.direction === "in" && (m.status === "needs_owner" || m.status === "failed") && (
            <Button size="sm" variant="outline" disabled={handled.isPending} onClick={() => handled.mutate()}>Mark handled</Button>
          )}
        </div>
      )}
    </div>
  );
}

/** Who we talk to at the company: editable. */
function ContactBox({ partner, onSave, saving }: { partner: MediaPartner; onSave: (b: Record<string, unknown>) => void; saving: boolean }) {
  const init = { company: partner.company, contactName: partner.contactName ?? "", contactEmail: partner.contactEmail ?? "", domain: partner.domain ?? "" };
  const [f, setF] = useState(init);
  const dirty = JSON.stringify(f) !== JSON.stringify(init);
  return (
    <div className="grid gap-2 sm:grid-cols-2" data-testid="form-partner-contact">
      <Input placeholder="Company name" value={f.company} onChange={(e) => setF({ ...f, company: e.target.value })} data-testid="input-partner-company" />
      <Input placeholder="Website (example.com)" value={f.domain} onChange={(e) => setF({ ...f, domain: e.target.value })} />
      <Input placeholder="Contact name" value={f.contactName} onChange={(e) => setF({ ...f, contactName: e.target.value })} />
      <Input placeholder="Contact email" type="email" value={f.contactEmail} onChange={(e) => setF({ ...f, contactEmail: e.target.value })} data-testid="input-partner-email" />
      {dirty && (
        <div className="sm:col-span-2">
          <Button size="sm" disabled={saving || !f.company.trim()} onClick={() => onSave({
            company: f.company.trim(), contactName: f.contactName.trim() || null, contactEmail: f.contactEmail.trim() || null, domain: f.domain.trim().toLowerCase() || null,
          })} data-testid="button-save-partner-contact">Save details</Button>
        </div>
      )}
    </div>
  );
}

/** Their API and minimum terms (read from their emails; editable). Shown with their prices on Partner pricing. */
function TermsBox({ partner, onSave, saving }: { partner: MediaPartner; onSave: (b: Record<string, unknown>) => void; saving: boolean }) {
  const init = { apiTerms: partner.apiTerms ?? "", minCommitment: partner.minCommitment ?? "" };
  const [f, setF] = useState(init);
  const dirty = JSON.stringify(f) !== JSON.stringify(init);
  return (
    <div className="grid gap-2 sm:grid-cols-2" data-testid="form-partner-terms">
      <Input className="bg-background" aria-label="API" placeholder="API (e.g. none, web form only)" value={f.apiTerms} onChange={(e) => setF({ ...f, apiTerms: e.target.value })} />
      <Input className="bg-background" aria-label="Minimum" placeholder="Minimum, contract or prepayment" value={f.minCommitment} onChange={(e) => setF({ ...f, minCommitment: e.target.value })} />
      {dirty && <div className="sm:col-span-2"><Button size="sm" disabled={saving} onClick={() => onSave({ apiTerms: f.apiTerms.trim() || null, minCommitment: f.minCommitment.trim() || null })}>Save terms</Button></div>}
    </div>
  );
}

/** Stop emailing a company: no more replies, follow-ups or queue emails to its addresses. */
function StopBox({ partner }: { partner: MediaPartner }) {
  const { toast } = useToast();
  const [sure, setSure] = useState(false);
  const stop = useMutation({
    mutationFn: async () => (await apiRequest("POST", `/api/admin/media-inbox/partners/${partner.id}/stop`, {})).json(),
    onSuccess: (r: { suppressed: string[] }) => { toast({ title: `Stopped emailing ${partner.company}`, description: r.suppressed.join(", ") || undefined }); setSure(false); void refresh(); },
    onError: (e) => toast({ title: "Could not stop", description: apiErrorMessage(e), variant: "destructive" }),
  });
  return (
    <div className="rounded-lg border border-dashed p-3 text-xs text-muted-foreground">
      {sure ? (
        <div className="flex flex-wrap items-center gap-2">
          <span>Mark {partner.company} declined and never email its addresses again?</span>
          <Button size="sm" variant="destructive" disabled={stop.isPending} onClick={() => stop.mutate()} data-testid="button-partner-stop-confirm">Yes, stop</Button>
          <Button size="sm" variant="outline" onClick={() => setSure(false)}>Cancel</Button>
        </div>
      ) : (
        <Button size="sm" variant="ghost" onClick={() => setSure(true)} data-testid="button-partner-stop">Stop emailing this company</Button>
      )}
    </div>
  );
}

/** The admin's own notes on a company: never sent, but the AI reads them when it drafts a reply. */
function NotesBox({ partner }: { partner: MediaPartner }) {
  const { toast } = useToast();
  const [draft, setDraft, clearDraft] = useDraft<{ notes: string | null }>(`partnerships:notes:${partner.id}`, { notes: null });
  const notes = draft.notes;
  const setNotes = (v: string) => setDraft({ notes: v });
  const save = useMutation({
    mutationFn: async () => (await apiRequest("POST", `/api/admin/media-inbox/partners/${partner.id}`, { notes: notes?.trim() || null })).json(),
    onSuccess: () => { toast({ title: "Notes saved" }); clearDraft(); void refresh(); },
    onError: (e) => toast({ title: "Could not save", description: apiErrorMessage(e), variant: "destructive" }),
  });
  return (
    <Panel title="Notes" icon={StickyNote} tone="notes" testId="panel-partner-notes">
      <Textarea className="bg-background" rows={3} aria-label="Notes" placeholder="Anything to remember about this company. Only you see these; the AI uses them when it writes a draft." value={notes ?? partner.notes ?? ""} onChange={(e) => setNotes(e.target.value)} data-testid="input-partner-notes" />
      {notes !== null && <Button size="sm" className="mt-2" disabled={save.isPending} onClick={() => save.mutate()} data-testid="button-save-partner-notes">Save notes</Button>}
    </Panel>
  );
}

/** Reply from media@ under the company's last email; "Write with AI" fills the box for the admin to edit first. */
function ReplyBox({ partner }: { partner: MediaPartner }) {
  const { toast } = useToast();
  const [f, setF, clearF] = useDraft(`partnerships:reply:${partner.id}`, { to: "", subject: "", body: "", instructions: "" });
  const draft = useMutation({
    mutationFn: async () => (await apiRequest("POST", `/api/admin/media-inbox/partners/${partner.id}/draft`, f.instructions.trim() ? { instructions: f.instructions.trim() } : {})).json(),
    onSuccess: (r: { body: string; to: string; subject: string }) => setF({ ...f, body: r.body, to: f.to || r.to, subject: f.subject || r.subject }),
    onError: (e) => toast({ title: "No draft", description: apiErrorMessage(e), variant: "destructive" }),
  });
  const send = useMutation({
    mutationFn: async () => (await apiRequest("POST", `/api/admin/media-inbox/partners/${partner.id}/reply`, { to: f.to, subject: f.subject, body: f.body })).json(),
    onSuccess: () => { toast({ title: `Sent to ${f.to}` }); clearF(); void refresh(); },
    onError: (e) => toast({ title: "Not sent", description: apiErrorMessage(e), variant: "destructive" }),
  });
  // To and subject start from the last email (filled by the first draft, or typed).
  const ready = f.to.trim() && f.subject.trim() && f.body.trim();
  return (
    <Panel title="Reply" icon={Send} tone="reply" testId="box-partner-reply">
      <div className="space-y-2">
      {f.body && <p className="text-xs text-foreground/70">Your unsent reply is saved in this browser until you send it.</p>}
      <div className="flex gap-2">
        <Input className="bg-background" aria-label="Instructions for the draft" placeholder="Tell the AI what to say (optional), e.g. “say yes to the call, ask for their pricing”" value={f.instructions} onChange={(e) => setF({ ...f, instructions: e.target.value })} data-testid="input-reply-instructions" />
        <Button type="button" variant="outline" disabled={draft.isPending} onClick={() => draft.mutate()} data-testid="button-reply-ai">
          {draft.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}Write with AI
        </Button>
      </div>
      <Input aria-label="To" className="bg-background" placeholder="To" type="email" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} data-testid="input-reply-to" />
      <Input aria-label="Subject" className="bg-background" placeholder="Subject" value={f.subject} onChange={(e) => setF({ ...f, subject: e.target.value })} data-testid="input-reply-subject" />
      <Textarea className="bg-background text-sm" rows={10} placeholder="Your reply (Leah Peterson's Construct HUB Media Team signature is added)" value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} data-testid="input-reply-body" />
      <Button disabled={send.isPending || !ready} onClick={() => send.mutate()} data-testid="button-reply-send">
        {send.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Mail className="mr-2 h-4 w-4" />}Send from media@
      </Button>
      </div>
    </Panel>
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
      <Input aria-label="Subject" className="sm:col-span-2" placeholder="Subject" value={f.subject} onChange={set("subject")} />
      <Textarea className="sm:col-span-2" rows={6} placeholder="Message (Leah Peterson's Construct HUB Media Team signature is added)" value={f.body} onChange={set("body")} />
      <div className="sm:col-span-2">
        <Button disabled={send.isPending || !f.company || !f.to || !f.subject || !f.body} onClick={() => send.mutate()} data-testid="button-send-media">
          {send.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Mail className="mr-2 h-4 w-4" />}Send from media@
        </Button>
      </div>
    </div>
  );
}

/** The row a company gets in every list: its summary's next step (or who they are) under the facts. */
function CompanyRow({ p, onOpen }: { p: MediaPartner; onOpen: () => void }) {
  const line = p.ownerQuestion ? `Your call: ${p.ownerQuestion}`
    : p.status === "agreed" && p.toFinalize ? `To finalize: ${p.toFinalize}`
    : p.status === "declined" ? `Why closed: ${p.summary ?? "no reason recorded — open it to read the emails"}`
    : p.brief ? (p.brief.next ? `Next: ${p.brief.next}` : p.brief.who)
    : p.summary ?? undefined;
  return (
    <GoogleListRow
      as="li" size="md" testId={`row-partner-${p.id}`} title={p.company} onOpen={onOpen}
      badges={<>
        <StatusPill tone={PARTNER_TONE[p.status]}>{MEDIA_PARTNER_STATUS_LABELS[p.status]}</StatusPill>
        {p.waiting > 0 && <StatusPill tone="warning">Waiting for you</StatusPill>}
      </>}
      meta={[
        MEDIA_PARTNER_GROUP_LABELS[partnerGroup(p)],
        p.domain && p.domain !== p.company ? p.domain : null,
        p.contactEmail,
        `${p.messages} emails`,
        `last ${ago(p.lastMessageAt)}`,
      ]}
      line={line}
    />
  );
}

type View = "active" | "silent" | "all";
const VIEW_LABELS: Record<View, string> = { active: "In conversation", silent: "No reply yet", all: "Everyone" };
/** In conversation = a person wrote back, or we agreed. The 700+ outlets that never answered sit under "No reply yet". */
const isActive = (p: MediaPartner) => p.humanReplies > 0 || p.status === "agreed" || p.status === "finalized";

export default function AdminPartnershipsPage() {
  useDocumentTitle("Partnerships");
  const { toast } = useToast();
  const [partnerTab, setPartnerTab] = useState<"all" | MediaPartnerStatus>("all");
  const [view, setView] = useState<View>("active");
  const [q, setQ] = useState("");
  const [silentOpen, setSilentOpen] = useState(false);
  const [setupOpen, setSetupOpen] = useState(false);
  const [mailTab, setMailTab] = useState<"all" | "out" | "in" | "needs_owner" | "declined">("all");
  const [page, setPage] = useState(0);
  // ?open=<company id> opens that company (links from Partner pricing); kept in the URL while moving between companies.
  const [openId, setOpenId] = useState<number | null>(() => {
    const v = Number(new URLSearchParams(window.location.search).get("open"));
    return Number.isInteger(v) && v > 0 ? v : null;
  });
  useEffect(() => {
    const u = new URL(window.location.href);
    if (openId) u.searchParams.set("open", String(openId)); else u.searchParams.delete("open");
    window.history.replaceState(window.history.state, "", u);
  }, [openId]);

  const { data: s, error, isLoading, refetch } = useQuery<Summary>({ queryKey: ["/api/admin/media-inbox/summary"], queryFn: () => getJson("/api/admin/media-inbox/summary"), retry: false });
  // Every company once; the page groups and filters them here.
  const { data: partners } = useQuery<MediaPartner[]>({ queryKey: ["/api/admin/media-inbox/partners"], queryFn: () => getJson("/api/admin/media-inbox/partners"), enabled: !!s });
  const mp = new URLSearchParams({ limit: String(PAGE), offset: String(page * PAGE) });
  if (mailTab === "out" || mailTab === "in") mp.set("direction", mailTab);
  if (mailTab === "needs_owner") mp.set("status", "needs_owner");
  if (mailTab === "declined") mp.set("partnerStatus", "declined");
  const msgsUrl = `/api/admin/media-inbox/messages?${mp}`;
  const { data: msgs } = useQuery<MessagesPayload>({ queryKey: [msgsUrl], queryFn: () => getJson(msgsUrl), enabled: !!s, placeholderData: keepPreviousData });
  const run = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/admin/media-inbox/run", {})).json(),
    onSuccess: (r: any) => { toast({ title: r.ok ? `Checked: ${r.read ?? 0} new, ${r.replied ?? 0} replied, ${r.held ?? 0} waiting for you` : "Not run", description: r.skipped }); void refresh(); },
    onError: (e) => toast({ title: "Could not run", description: apiErrorMessage(e), variant: "destructive" }),
  });

  const all = partners ?? [];
  const waiting = useMemo(() => all.filter((p) => p.waiting > 0 || (p.ownerQuestion && p.status !== "declined" && p.humanReplies > 0)), [all]);
  const term = q.trim().toLowerCase();
  const matches = useMemo(() => all.filter((p) => (partnerTab === "all" || p.status === partnerTab)
    && (!term || [p.company, p.domain, p.contactEmail, p.contactName].some((v) => v?.toLowerCase().includes(term)))), [all, partnerTab, term]);
  const shown = useMemo(() => matches.filter((p) => view === "all" || (view === "active") === isActive(p)), [matches, view]);
  const silent = useMemo(() => (view === "active" ? matches.filter((p) => !isActive(p)) : []), [matches, view]);
  const groups = (rows: MediaPartner[]) => MEDIA_PARTNER_GROUPS.map((g) => ({ g, rows: rows.filter((p) => partnerGroup(p) === g) })).filter((x) => x.rows.length);
  const shownGroups = useMemo(() => groups(shown), [shown]); // eslint-disable-line react-hooks/exhaustive-deps
  const silentGroups = useMemo(() => groups(silent), [silent]); // eslint-disable-line react-hooks/exhaustive-deps
  // Previous / next follow what is on screen, top to bottom.
  const order = useMemo(() => [...shownGroups.flatMap((x) => x.rows), ...(silentOpen ? silentGroups.flatMap((x) => x.rows) : [])], [shownGroups, silentGroups, silentOpen]);
  const open = useMemo(() => all.find((p) => p.id === openId) ?? null, [all, openId]);
  const at = open ? order.findIndex((p) => p.id === open.id) : -1;
  const nav: SheetNav = {
    index: at, total: order.length,
    prev: at > 0 ? () => setOpenId(order[at - 1].id) : null,
    next: at + 1 < order.length && order.length ? () => setOpenId(order[at + 1].id) : null,
  };

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
  const inConversation = all.filter((p) => isActive(p) && p.status === "talking").length;
  const jump = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  const openSetup = () => { setSetupOpen(true); setTimeout(() => jump("partnerships-setup"), 50); };
  return (
    <AppPage testId="page-admin-partnerships">
      <GoogleSectionHeader as="h1" title="Partnerships" description={`Relationships with directories, press-release wires, article sites and news media — run from ${s.mailbox ?? "media@constructhub.us"}.`} flush />
      <div className="min-w-0 space-y-4">
        {(!s.configured || !s.enabled) && (
          <Notice tone="info" title="Inbox automation" testId="notice-partnerships-config">
            {!s.configured ? "The media@ mailbox or the AI key is missing in the server settings." : "Automatic checking is off (MEDIA_INBOX_ENABLED=true turns it on) — use Check now."}
          </Notice>
        )}
        {s.lastPassError && <Notice tone="warning" title="Last check failed">{s.lastPassError}</Notice>}
        <StatGrid cols={4}>
          <Stat label="Waiting for you" value={n(waiting.length)} tone={waiting.length ? "bad" : "default"} hint={`${n(s.counts.needs_owner)} emails`} onClick={() => jump("partnerships-waiting")} testId="stat-partners-waiting" />
          <Stat label="In conversation" value={n(inConversation)} hint="a person wrote back" onClick={() => { setView("active"); setPartnerTab("talking"); jump("partnerships-companies"); }} selected={view === "active" && partnerTab === "talking"} />
          <Stat label="Agreed — to finalize" value={n(s.partners.agreed)} onClick={() => { setView("all"); setPartnerTab("agreed"); jump("partnerships-companies"); }} selected={partnerTab === "agreed"} testId="stat-partners-agreed" />
          <Stat label="Finalized" value={n(s.partners.finalized)} onClick={() => { setView("all"); setPartnerTab("finalized"); jump("partnerships-companies"); }} selected={partnerTab === "finalized"} />
        </StatGrid>
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 px-1 text-xs text-muted-foreground" data-testid="text-partnerships-sending">
          <span>Sending: {n(s.sent)} emails sent · {n(received)} received</span>
          <button type="button" className="underline-offset-2 hover:underline" onClick={openSetup} data-testid="stat-partners-queue">{n(s.queue.queued)} queued · {n(s.queue.sentToday)} of {n(s.queue.perDay)} sent today</button>
          <span>checked {ago(s.lastPassAt)}</span>
        </p>

        <Section title="Waiting for you" icon={AlertCircle} id="partnerships-waiting" testId="section-partners-waiting"
          description="Companies with an email or a decision that needs you: meetings, contracts, prices and anything the inbox would not answer on its own.">
          {waiting.length ? (
            <GoogleList as="ul" testId="list-partners-waiting">
              {waiting.map((p) => <CompanyRow key={p.id} p={p} onOpen={() => setOpenId(p.id)} />)}
            </GoogleList>
          ) : <p className="text-sm text-muted-foreground">Nothing waiting. New ones appear here as the inbox is checked.</p>}
        </Section>

        <Section title="Companies" icon={Handshake} id="partnerships-companies" actions={
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" asChild>
              <Link href="/admin/partnerships/pricing" data-testid="link-partner-pricing"><Receipt className="mr-2 h-4 w-4" />Partner pricing</Link>
            </Button>
            <Button size="sm" variant="outline" disabled={run.isPending} onClick={() => run.mutate()} data-testid="button-media-run">
              {run.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}Check now
            </Button>
          </div>
        }>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" aria-hidden="true" />
              <Input className="w-64 pl-8" aria-label="Search companies" placeholder="Search company, website or email" value={q} onChange={(e) => setQ(e.target.value)} data-testid="input-partners-search" />
            </div>
            <Select value={view} onValueChange={(v) => setView(v as View)}>
              <SelectTrigger className="w-48" aria-label="Show" data-testid="select-partners-view"><SelectValue /></SelectTrigger>
              <SelectContent>{(Object.keys(VIEW_LABELS) as View[]).map((v) => <SelectItem key={v} value={v}>{VIEW_LABELS[v]}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <Tabs value={partnerTab} onValueChange={(v) => setPartnerTab(v as typeof partnerTab)} className="mb-3">
            <TabsList className="h-auto flex-wrap">
              <TabsTrigger value="all">All statuses</TabsTrigger>
              {MEDIA_PARTNER_STATUSES.map((st) => <TabsTrigger key={st} value={st}>{MEDIA_PARTNER_STATUS_LABELS[st]} ({n(s.partners[st])})</TabsTrigger>)}
            </TabsList>
          </Tabs>
          {/* Grouped by what the company is (wires, directories, article sites, news media, vendors); each group in Google's list format. */}
          <div className="space-y-5" data-testid="list-partners">
            {shownGroups.map(({ g, rows }) => <CompanyGroup key={g} g={g} rows={rows} onOpen={setOpenId} />)}
            {partners && !shown.length && (
              <div className="g-callout" data-testid="empty-partners"><h3>{term ? "No company matches" : "No companies here"}</h3><p>{view === "active" ? "Companies show here once a person writes back. Try “Everyone” or “No reply yet”." : "They appear here as emails come in or go out of media@."}</p></div>
            )}
            {silent.length > 0 && (
              <details className="rounded-lg border bg-muted/30" open={silentOpen} onToggle={(e) => setSilentOpen((e.target as HTMLDetailsElement).open)} data-testid="group-partners-silent">
                <summary className="cursor-pointer select-none px-3 py-2.5 text-sm font-medium">No reply yet ({n(silent.length)}) <span className="font-normal text-muted-foreground">— contacted, nobody has written back</span></summary>
                {silentOpen && <div className="space-y-5 px-3 pb-3">{silentGroups.map(({ g, rows }) => <CompanyGroup key={g} g={g} rows={rows} onOpen={setOpenId} />)}</div>}
              </details>
            )}
          </div>
        </Section>

        <Section title="Emails" icon={Mail}>
          <Tabs value={mailTab} onValueChange={(v) => { setMailTab(v as typeof mailTab); setPage(0); }} className="mb-3">
            <TabsList className="h-auto flex-wrap">
              <TabsTrigger value="all">All</TabsTrigger>
              <TabsTrigger value="out" data-testid="tab-media-sent">Sent ({n(s.sent)})</TabsTrigger>
              <TabsTrigger value="in">Received ({n(received)})</TabsTrigger>
              <TabsTrigger value="needs_owner">Waiting for you ({n(s.counts.needs_owner)})</TabsTrigger>
              <TabsTrigger value="declined" data-testid="tab-media-declined">Declined</TabsTrigger>
            </TabsList>
          </Tabs>
          <div className="space-y-2" data-testid="list-media-messages">
            {(msgs?.rows ?? []).map((m) => <MessageCard key={m.id} m={m} onOpenCompany={m.partnerId ? () => setOpenId(m.partnerId) : undefined} />)}
            {msgs && !msgs.rows.length && <div className="g-callout" data-testid="empty-media-messages"><h3>No emails here yet</h3><p>Sent and received mail shows up as the inbox is checked (every {s.intervalMin} minutes) or when you send one below.</p></div>}
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

        {/* Setup, not daily work: collapsed until opened. */}
        <details id="partnerships-setup" className="rounded-xl border bg-card" open={setupOpen} onToggle={(e) => setSetupOpen((e.target as HTMLDetailsElement).open)} data-testid="section-partnerships-setup">
          <summary className="flex cursor-pointer select-none items-center gap-2 px-4 py-3 text-base font-semibold sm:px-5">
            <Settings2 className="h-4 w-4" aria-hidden="true" />Sending setup
            <span className="text-sm font-normal text-muted-foreground">— send queue ({n(s.queue.queued)}), settings, first-contact emails, inbox laws, email a company</span>
          </summary>
          {setupOpen && (
            <div className="space-y-4 p-3 sm:p-4">
              <QueueSection />
              <SettingsSection />
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
                  <dt className="text-muted-foreground">No duplicates</dt><dd>one answer and one follow-up per company per check; nothing automatic to an address emailed in the last 30 minutes, and never the same email twice in 14 days</dd>
                  <dt className="text-muted-foreground">If the AI fails</dt><dd>{MEDIA_INBOX_PARAMETERS.aiAttemptsBeforeHolding} tries, then a holding reply</dd>
                  <dt className="text-muted-foreground">No answer</dt><dd>a follow-up after {MEDIA_INBOX_PARAMETERS.followUpAfterDays} days; {MEDIA_INBOX_PARAMETERS.followUpAfterDays} more days → a new contact from their website (up to {MEDIA_INBOX_PARAMETERS.maxContactsPerCompany} addresses per company)</dd>
                  <dt className="text-muted-foreground">New directories</dt><dd>{s.queue.perDay} first-contact emails a day from the queue (vetted directories that publish an email), spread across the day</dd>
                  <dt className="text-muted-foreground">AI order</dt><dd>{MEDIA_INBOX_PARAMETERS.aiOrder.join(" → ")}</dd>
                </dl>
              </Section>
              <Section title="Email a company" description="First contact from media@. Replies are answered automatically every 30 minutes; nothing that costs money is agreed.">
                <SendBox />
              </Section>
            </div>
          )}
        </details>
      </div>
      <PartnerSheet partner={open} nav={nav} onClose={() => setOpenId(null)} />
    </AppPage>
  );
}

function CompanyGroup({ g, rows, onOpen }: { g: MediaPartnerGroup; rows: MediaPartner[]; onOpen: (id: number) => void }) {
  return (
    <div data-testid={`group-partners-${g}`}>
      <h3 className="mb-1 text-sm font-semibold text-foreground/80">{MEDIA_PARTNER_GROUP_LABELS[g]} <span className="font-normal text-muted-foreground">({n(rows.length)})</span></h3>
      <GoogleList as="ul">{rows.map((p) => <CompanyRow key={p.id} p={p} onOpen={() => onOpen(p.id)} />)}</GoogleList>
    </div>
  );
}
