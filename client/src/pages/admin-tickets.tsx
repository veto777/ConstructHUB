/**
 * /admin/tickets — the support ticket desk (server/support): tickets Gabe opened on the support line after verifying
 * the caller. Platform admins only (the API answers 403 to anyone else; the admin passphrase is asked once a session).
 * Change the status, keep internal notes, or email the customer (the reply goes to the account's email on file).
 *
 * Look (owner 2026-10-15, the SEO Suite dashboard): a stat row with the count per status, status chips that filter
 * the list (plus a typed status, for a word the chips don't offer), hairline rows with the key facts, and the open
 * ticket beside them. The list is fetched once (the API returns up to 500, open ones first) and filtered here, so the
 * counts and the chips never disagree.
 */
import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { Loader2, Mail, StickyNote, Ticket } from "lucide-react";
import { AppPage, PageHeader } from "@/components/app-ui";
import { GoogleList, GoogleListRow, GoogleStat, GoogleStatGrid } from "@/components/google";
import { SegmentedTabs, TabCount } from "@/components/tool";
import { apiRequest, apiErrorMessage, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatusPill, type PillTone } from "@/components/crm-ui";
import { useDocumentTitle } from "@/components/feature-landing/primitives";
import { appPageTitle } from "@/lib/page-titles";

type Row = { id: number; number: string; category: string; severity: string; title: string; status: string; created_at: string; contact_email: string; customer_number: string | null };
type Full = Row & { recording_sid: string | null; transcript_status: string | null; channel: string; description: string; steps: string | null; device: string | null; verified_with: string | null; account_email: string | null; notes: { at: string; by: string; kind: string; text: string }[]; history: { at: string; event: string; by?: string }[] };
const STATUSES = ["open", "in_progress", "waiting_customer", "resolved", "closed"] as const;
const LABEL: Record<string, string> = { open: "Open", in_progress: "In progress", waiting_customer: "Waiting on customer", resolved: "Resolved", closed: "Closed" };
const TONE: Record<string, PillTone> = { open: "danger", in_progress: "info", waiting_customer: "warning", resolved: "success", closed: "neutral" };
const CUSTOM = "custom";

/** A typed status matches a ticket's status key or label, case-insensitively, spaces or underscores alike. */
const norm = (v: string) => v.trim().toLowerCase().replace(/[\s_-]+/g, " ");
const matchesTyped = (t: Row, typed: string) => { const q = norm(typed); return !!q && (norm(t.status) === q || norm(LABEL[t.status] ?? "") === q); };

export default function AdminTicketsPage() {
  useDocumentTitle(appPageTitle("/admin/tickets")!);
  const [filter, setFilter] = useState<string>("all");
  const [typed, setTyped] = useState("");
  const [openId, setOpenId] = useState<number | null>(null);
  const list = useQuery<{ tickets: Row[] }>({ queryKey: ["/api/admin/support-tickets"], queryFn: async () => (await apiRequest("GET", "/api/admin/support-tickets")).json() });
  const all = list.data?.tickets ?? [];
  const counts = useMemo(() => { const c: Record<string, number> = {}; for (const t of all) c[t.status] = (c[t.status] ?? 0) + 1; return c; }, [all]);
  const rows = filter === "all" ? all : filter === CUSTOM ? all.filter((t) => matchesTyped(t, typed)) : all.filter((t) => t.status === filter);
  const critical = all.filter((t) => t.severity === "critical" && (t.status === "open" || t.status === "in_progress")).length;
  const open = (counts.open ?? 0) + (counts.in_progress ?? 0);

  return (
    <AppPage testId="page-admin-tickets">
      <PageHeader title="Support tickets" description="Tickets Gabe opened on the support line after the caller verified their account; answer, note and close them here." />
      {list.isLoading ? <Loader2 className="h-5 w-5 animate-spin" aria-label="Loading" /> : list.error ? <p className="text-sm text-destructive">{apiErrorMessage(list.error)}</p> : (
        <div className="space-y-4">
          <GoogleStatGrid cols={4}>
            <GoogleStat label="Needs an answer" value={open} hint={`${counts.open ?? 0} open · ${counts.in_progress ?? 0} in progress`} tone={open ? "bad" : "default"} testId="stat-tickets-open" />
            <GoogleStat label="Critical, still open" value={critical} tone={critical ? "bad" : "default"} testId="stat-tickets-critical" />
            <GoogleStat label="Waiting on customer" value={counts.waiting_customer ?? 0} testId="stat-tickets-waiting" />
            <GoogleStat label="Resolved or closed" value={(counts.resolved ?? 0) + (counts.closed ?? 0)} hint={`of ${all.length} tickets`} testId="stat-tickets-done" />
          </GoogleStatGrid>

          <div className="flex flex-wrap items-center gap-3">
            <SegmentedTabs as="tablist" label="Filter by status">
              {[{ key: "all", label: "All", n: all.length }, ...STATUSES.map((s) => ({ key: s, label: LABEL[s], n: counts[s] ?? 0 })), { key: CUSTOM, label: "Custom…", n: null as number | null }].map((c) => (
                <button key={c.key} type="button" role="tab" aria-selected={filter === c.key} onClick={() => setFilter(c.key)} data-testid={`filter-ticket-${c.key}`}>
                  {c.label}{c.n !== null && <TabCount>{c.n}</TabCount>}
                </button>
              ))}
            </SegmentedTabs>
            {filter === CUSTOM && (
              <Input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="Type a status, e.g. waiting" aria-label="Status to match" className="h-9 w-56 max-sm:h-11" autoFocus data-testid="input-ticket-status-custom" />
            )}
          </div>

          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
            <div className="min-w-0">
              {rows.length === 0 ? (
                <div className="g-callout" data-testid="empty-tickets">
                  <h2>{all.length === 0 ? "No tickets yet" : "No ticket matches"}</h2>
                  <p>{all.length === 0 ? "A ticket appears here when Gabe opens one on the support line." : filter === CUSTOM ? "Type one of: open, in progress, waiting on customer, resolved, closed." : "Pick another status."}</p>
                </div>
              ) : (
                <GoogleList as="ul" testId="list-tickets">
                  {rows.map((t) => (
                    <GoogleListRow
                      as="li"
                      size="md"
                      key={t.id}
                      className={openId === t.id ? "bg-muted/40" : undefined}
                      title={<span className="line-clamp-2">{t.title}</span>}
                      onOpen={() => setOpenId(t.id)}
                      titleTestId={`row-ticket-${t.id}`}
                      badges={<>
                        {t.severity === "critical" && <StatusPill tone="danger" dot={false}>Critical</StatusPill>}
                        <StatusPill tone={TONE[t.status] ?? "neutral"}>{LABEL[t.status] ?? t.status}</StatusPill>
                      </>}
                      meta={[
                        <span key="n" className="font-mono text-xs">{t.number}</span>,
                        t.category,
                        `customer ${t.customer_number ?? "—"}`,
                        format(new Date(t.created_at), "MMM d, h:mm a"),
                      ]}
                    />
                  ))}
                </GoogleList>
              )}
            </div>
            {openId ? <TicketDetail id={openId} /> : <Card className="p-6 text-sm text-muted-foreground"><Ticket className="mb-2 h-5 w-5" aria-hidden="true" />Pick a ticket to read it, change its status, add a note or email the customer.</Card>}
          </div>
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
  if (!t) return <Card className="p-6"><Loader2 className="h-5 w-5 animate-spin" aria-label="Loading" /></Card>;
  return (
    <Card className="space-y-4 p-6" data-testid="card-ticket-detail">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div><p className="font-mono text-xs">{t.number} · {t.severity} · {t.category}</p><h2 className="text-lg font-semibold">{t.title}</h2></div>
        <Select value={t.status} onValueChange={(v) => setStatus.mutate(v)}>
          <SelectTrigger className="w-52" aria-label="Ticket status" data-testid="select-ticket-status"><SelectValue /></SelectTrigger>
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
        <Textarea value={text} onChange={(e) => setText(e.target.value)} aria-label="Note or reply" placeholder="Write a note or a reply…" data-testid="input-ticket-note" />
        <div className="flex gap-2">
          <Button variant="outline" disabled={!text.trim() || note.isPending} onClick={() => note.mutate(false)} data-testid="button-ticket-note"><StickyNote className="mr-1 h-4 w-4" />Save note</Button>
          <Button disabled={!text.trim() || note.isPending} onClick={() => note.mutate(true)} data-testid="button-ticket-reply"><Mail className="mr-1 h-4 w-4" />Email the customer</Button>
        </div>
      </div>
    </Card>
  );
}
