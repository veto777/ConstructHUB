/**
 * /admin/tickets — the support ticket desk (server/support): tickets Gabe opened on the support line after verifying
 * the caller. Platform admins only (the API answers 403 to anyone else; the admin passphrase is asked once a session).
 * Change the status, keep internal notes, or email the customer (the reply goes to the account's email on file).
 */
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { Loader2, Mail, StickyNote, Ticket } from "lucide-react";
import { AppPage, PageHeader } from "@/components/app-ui";
import { apiRequest, apiErrorMessage, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatusPill, type PillTone } from "@/components/crm-ui";
import { useDocumentTitle } from "@/components/feature-landing/primitives";

type Row = { id: number; number: string; category: string; severity: string; title: string; status: string; created_at: string; contact_email: string; customer_number: string | null };
type Full = Row & { recording_sid: string | null; transcript_status: string | null; channel: string; description: string; steps: string | null; device: string | null; verified_with: string | null; account_email: string | null; notes: { at: string; by: string; kind: string; text: string }[]; history: { at: string; event: string; by?: string }[] };
const STATUSES = ["open", "in_progress", "waiting_customer", "resolved", "closed"] as const;
const LABEL: Record<string, string> = { open: "Open", in_progress: "In progress", waiting_customer: "Waiting on customer", resolved: "Resolved", closed: "Closed" };
const TONE: Record<string, PillTone> = { open: "danger", in_progress: "info", waiting_customer: "warning", resolved: "success", closed: "neutral" };

export default function AdminTicketsPage() {
  useDocumentTitle("Support tickets · Admin");
  const [filter, setFilter] = useState<string>("all");
  const [openId, setOpenId] = useState<number | null>(null);
  const list = useQuery<{ tickets: Row[] }>({ queryKey: ["/api/admin/support-tickets", filter], queryFn: async () => (await apiRequest("GET", `/api/admin/support-tickets${filter === "all" ? "" : `?status=${filter}`}`)).json() });
  return (
    <AppPage testId="page-admin-tickets">
      <PageHeader title="Support tickets" description="Opened by Gabe on the support line after the caller verified their account." />
      <div className="mb-4 flex items-center gap-3">
        <Select value={filter} onValueChange={setFilter}>
          <SelectTrigger className="w-56" data-testid="select-ticket-filter"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="all">All tickets</SelectItem>{STATUSES.map((s) => <SelectItem key={s} value={s}>{LABEL[s]}</SelectItem>)}</SelectContent>
        </Select>
      </div>
      {list.isLoading ? <Loader2 className="h-5 w-5 animate-spin" /> : list.error ? <p className="text-sm text-destructive">{apiErrorMessage(list.error)}</p> : (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
          <Card className="divide-y">
            {(list.data?.tickets ?? []).length === 0 && <p className="p-6 text-sm text-muted-foreground">No tickets.</p>}
            {(list.data?.tickets ?? []).map((t) => (
              <button key={t.id} onClick={() => setOpenId(t.id)} className={`w-full p-4 text-left hover:bg-muted/50 ${openId === t.id ? "bg-muted" : ""}`} data-testid={`row-ticket-${t.id}`}>
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-xs">{t.number}</span>
                  <StatusPill tone={TONE[t.status] ?? "neutral"}>{LABEL[t.status] ?? t.status}</StatusPill>
                </div>
                <p className="mt-1 font-medium">{t.severity === "critical" ? "🔴 " : ""}{t.title}</p>
                <p className="text-xs text-muted-foreground">{t.category} · customer {t.customer_number ?? "—"} · {format(new Date(t.created_at), "MMM d, h:mm a")}</p>
              </button>
            ))}
          </Card>
          {openId ? <TicketDetail id={openId} /> : <Card className="p-6 text-sm text-muted-foreground"><Ticket className="mb-2 h-5 w-5" />Pick a ticket.</Card>}
        </div>
      )}
    </AppPage>
  );
}

function TicketDetail({ id }: { id: number }) {
  const { toast } = useToast();
  const [text, setText] = useState("");
  const q = useQuery<{ ticket: Full }>({ queryKey: ["/api/admin/support-tickets", "one", id], queryFn: async () => (await apiRequest("GET", `/api/admin/support-tickets/${id}`)).json() });
  const refresh = () => { queryClient.invalidateQueries({ queryKey: ["/api/admin/support-tickets"] }); };
  const setStatus = useMutation({ mutationFn: async (status: string) => apiRequest("PATCH", `/api/admin/support-tickets/${id}`, { status }), onSuccess: refresh, onError: (e) => toast({ title: "Couldn't update", description: apiErrorMessage(e), variant: "destructive" }) });
  const note = useMutation({ mutationFn: async (email: boolean) => apiRequest("POST", `/api/admin/support-tickets/${id}/note`, { text, email }), onSuccess: (_r, email) => { setText(""); refresh(); toast({ title: email ? "Emailed the customer" : "Note saved" }); }, onError: (e) => toast({ title: "Couldn't save", description: apiErrorMessage(e), variant: "destructive" }) });
  const t = q.data?.ticket;
  if (!t) return <Card className="p-6"><Loader2 className="h-5 w-5 animate-spin" /></Card>;
  return (
    <Card className="space-y-4 p-6" data-testid="card-ticket-detail">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div><p className="font-mono text-xs">{t.number} · {t.severity} · {t.category}</p><h2 className="text-lg font-semibold">{t.title}</h2></div>
        <Select value={t.status} onValueChange={(v) => setStatus.mutate(v)}>
          <SelectTrigger className="w-52" data-testid="select-ticket-status"><SelectValue /></SelectTrigger>
          <SelectContent>{STATUSES.map((s) => <SelectItem key={s} value={s}>{LABEL[s]}</SelectItem>)}</SelectContent>
        </Select>
      </div>
      <dl className="grid grid-cols-[9rem_1fr] gap-x-3 gap-y-1 text-sm">
        <dt className="text-muted-foreground">Customer</dt><dd>{t.customer_number ?? "—"} · {t.account_email ?? t.contact_email}</dd>
        <dt className="text-muted-foreground">Verified with</dt><dd>{t.verified_with ?? "—"}</dd>
        <dt className="text-muted-foreground">Opened</dt><dd>{format(new Date(t.created_at), "PPpp")}</dd>
        <dt className="text-muted-foreground">Device</dt><dd>{t.device || "—"}</dd>
      </dl>
      <div><p className="text-xs font-medium uppercase text-muted-foreground">What happened</p><p className="whitespace-pre-wrap text-sm">{t.description}</p></div>
      {t.recording_sid && <div><p className="text-xs font-medium uppercase text-muted-foreground">Caller's recording (keypad line){t.transcript_status === "pending" || t.transcript_status === "working" ? " · transcribing…" : ""}</p><audio controls preload="none" className="mt-1 w-full" src={`/api/admin/support-tickets/${id}/recording`} data-testid="audio-ticket-recording" /></div>}
      {t.steps && <div><p className="text-xs font-medium uppercase text-muted-foreground">Steps to reproduce</p><p className="whitespace-pre-wrap text-sm">{t.steps}</p></div>}
      <div className="space-y-2">
        <p className="text-xs font-medium uppercase text-muted-foreground">Notes & replies</p>
        {t.notes.map((n, i) => <div key={i} className="rounded border p-2 text-sm"><p className="text-xs text-muted-foreground">{n.kind === "reply" ? "Emailed to customer" : "Internal note"} · {n.by} · {format(new Date(n.at), "MMM d, h:mm a")}</p><p className="whitespace-pre-wrap">{n.text}</p></div>)}
        <Textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="Write a note or a reply…" data-testid="input-ticket-note" />
        <div className="flex gap-2">
          <Button variant="outline" disabled={!text.trim() || note.isPending} onClick={() => note.mutate(false)} data-testid="button-ticket-note"><StickyNote className="mr-1 h-4 w-4" />Save note</Button>
          <Button disabled={!text.trim() || note.isPending} onClick={() => note.mutate(true)} data-testid="button-ticket-reply"><Mail className="mr-1 h-4 w-4" />Email the customer</Button>
        </div>
      </div>
    </Card>
  );
}
