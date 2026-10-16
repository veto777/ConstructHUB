/**
 * /admin/press — the Press Wire desk (platform admins): setup state (press mailbox, wire address, writer, photo
 * storage), every release with its status and last error, every email in and out of pressrelease@, "Check the inbox
 * now", mark a release live by hand, resend one to the wire, and clear emails that need a person.
 */
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { formatDistanceToNowStrict } from "date-fns";
import { Inbox, Loader2, Mail, Newspaper, Play, Send } from "lucide-react";
import { PRESS_RELEASE_STATUSES, PRESS_STATUS_LABELS, type PressReleaseStatus, type PressReleaseView } from "@shared/press";
import { apiErrorMessage, apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { AppPage, Notice, PageHeader, Section, Stat, StatGrid } from "@/components/app-ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useDocumentTitle } from "@/components/feature-landing/primitives";
import { VerificationCancelled } from "@/components/recent-auth";

type Summary = {
  setup: { ai: boolean; mailbox: boolean; wire: boolean; photos: boolean }; mailbox: string | null; wireTo: string | null; inboxHours: number; submitMinutes: number;
  lastPassAt: string | null; lastPassError: string | null;
  counts: { releases: Partial<Record<PressReleaseStatus, number>>; messages: Record<string, number>; orders: number; creditsSold: number; creditsUsed: number };
};
type AdminRelease = PressReleaseView & { email: string | null; lastError: string | null; attempts: number };
/** Inbound wire attachments are private: links stored before 2026-10-16 point at the public file route, which
 * now refuses them, so they are read through the platform-admin route instead. */
const pressAttachmentHref = (url: string) => url.replace(/^(?:https?:\/\/[^/]+)?\/api\/files\/press\/inbox\//, "/api/admin/press/attachments/");
type Message = { id: number; direction: "in" | "out"; release_id: number | null; from_email: string; subject: string; body: string; kind: string | null; status: string; reason: string | null; received_at: string; attachments: { name: string; url: string }[] };

const getJson = async <T,>(url: string): Promise<T> => (await apiRequest("GET", url)).json();
const refresh = () => queryClient.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith("/api/admin/press") });
const ago = (iso: string | null) => (iso ? `${formatDistanceToNowStrict(new Date(iso))} ago` : "—");
const n = (v: number | undefined) => (v ?? 0).toLocaleString("en-US");

export default function AdminPressPage() {
  useDocumentTitle("Press Wire desk");
  const { toast } = useToast();
  const [status, setStatus] = useState<PressReleaseStatus | "all">("all");
  const [msgStatus, setMsgStatus] = useState<string>("needs_owner");
  const [liveUrl, setLiveUrl] = useState<Record<number, string>>({});
  const { data: s, error } = useQuery<Summary>({ queryKey: ["/api/admin/press/summary"], queryFn: () => getJson("/api/admin/press/summary") });
  const relUrl = `/api/admin/press/releases${status === "all" ? "" : `?status=${status}`}`;
  const { data: rel } = useQuery<{ rows: AdminRelease[] }>({ queryKey: [relUrl], queryFn: () => getJson(relUrl) });
  const msgUrl = `/api/admin/press/messages${msgStatus === "all" ? "" : `?status=${msgStatus}`}`;
  const { data: msgs } = useQuery<{ rows: Message[] }>({ queryKey: [msgUrl], queryFn: () => getJson(msgUrl) });
  const act = useMutation({
    mutationFn: async ({ url, body }: { url: string; body?: unknown }) => (await apiRequest("POST", url, body ?? {})).json(),
    onSuccess: (r: any) => { toast({ title: "Done", description: r?.skipped ?? (r?.inbox ? `Read ${r.inbox.read}, sent ${r.submitted?.sent ?? 0}, applied ${r.replies?.applied ?? 0}` : undefined) }); void refresh(); },
    onError: (e) => { if (!(e instanceof VerificationCancelled)) toast({ title: "Failed", description: apiErrorMessage(e), variant: "destructive" }); },
  });

  if (error) return <AppPage><Notice tone="danger" title="Platform admins only">{apiErrorMessage(error)}</Notice></AppPage>;
  const c = s?.counts;
  return (
    <AppPage width="wide" testId="page-admin-press">
      <PageHeader title="Press Wire desk" icon={Newspaper} accent="orange" description="Every release on its way to the wire, and every email the wire sends back."
        actions={<Button onClick={() => act.mutate({ url: "/api/admin/press/run", body: { inbox: true } })} disabled={act.isPending} data-testid="admin-press-run">{act.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />} Check the inbox now</Button>} />
      {s && (!s.setup.mailbox || !s.setup.wire) && (
        <Notice tone="warning" title="Not fully automated yet">
          {!s.setup.mailbox && <div>The press mailbox is not set: add <code>PRESS_EMAIL</code> (pressrelease@constructhub.us) and <code>PRESS_APP_PASSWORD</code> to the server's .env. Until then customer emails go out from support@ and nothing is sent to the wire.</div>}
          {!s.setup.wire && <div>The wire's submission address is not set: add <code>PRESS_WIRE_EMAIL</code>. Approved releases wait as "Ready to send".</div>}
        </Notice>
      )}
      <StatGrid cols={5}>
        <Stat label="Mailbox" value={s?.mailbox ?? "not set"} hint={s ? `read every ${s.inboxHours} h · last ${ago(s.lastPassAt)}${s.lastPassError ? ` · ${s.lastPassError}` : ""}` : ""} tone={s?.setup.mailbox ? "good" : "warn"} />
        <Stat label="Wire address" value={s?.wireTo ?? "not set"} tone={s?.setup.wire ? "good" : "warn"} />
        <Stat label="Credits sold / used" value={`${n(c?.creditsSold)} / ${n(c?.creditsUsed)}`} hint={`${n(c?.orders)} paid packages`} />
        <Stat label="Waiting on the wire" value={n((c?.releases.submitted ?? 0) + (c?.releases.ready ?? 0) + (c?.releases.queued ?? 0))} hint={`${n(c?.releases.ready)} ready · ${n(c?.releases.submitted)} in review`} />
        <Stat label="Emails for a person" value={n(c?.messages.needs_owner)} tone={(c?.messages.needs_owner ?? 0) > 0 ? "warn" : "default"} />
      </StatGrid>

      <Section title="Releases" icon={Send} actions={
        <Select value={status} onValueChange={(v) => setStatus(v as PressReleaseStatus | "all")}>
          <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="all">All</SelectItem>{PRESS_RELEASE_STATUSES.map((st) => <SelectItem key={st} value={st}>{PRESS_STATUS_LABELS[st]}</SelectItem>)}</SelectContent>
        </Select>
      }>
        <ul className="divide-y rounded-xl border text-sm">
          {(rel?.rows ?? []).map((r) => (
            <li key={r.id} className="space-y-1 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-xs">{r.code}</span>
                <span className="font-semibold">{r.text?.headline ?? r.input.companyName}</span>
                <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-bold">{PRESS_STATUS_LABELS[r.status]}</span>
                <span className="text-xs text-muted-foreground">{r.tier} · {r.email ?? `user ${r.input.contactEmail}`} · {ago(r.updatedAt)}</span>
              </div>
              {r.lastError && <div className="text-xs text-amber-700">{r.lastError}</div>}
              {r.wireNotes && <div className="text-xs text-orange-700">Editors: {r.wireNotes}</div>}
              {r.liveUrl && <a className="text-xs underline" href={r.liveUrl} target="_blank" rel="noreferrer">{r.liveUrl}</a>}
              <div className="flex flex-wrap items-center gap-2 pt-1">
                {["ready", "submitted", "changes_requested", "queued"].includes(r.status) && <Button size="sm" variant="outline" onClick={() => act.mutate({ url: `/api/admin/press/releases/${r.id}/resend` })} disabled={act.isPending}>Send to the wire again</Button>}
                {["submitted", "ready", "changes_requested"].includes(r.status) && (
                  <>
                    <Input className="h-8 w-72" placeholder="Live URL" value={liveUrl[r.id] ?? ""} onChange={(e) => setLiveUrl({ ...liveUrl, [r.id]: e.target.value })} />
                    <Button size="sm" variant="outline" disabled={!liveUrl[r.id] || act.isPending} onClick={() => act.mutate({ url: `/api/admin/press/releases/${r.id}/live`, body: { url: liveUrl[r.id] } })}>Mark live</Button>
                  </>
                )}
              </div>
            </li>
          ))}
          {rel && rel.rows.length === 0 && <li className="p-4 text-muted-foreground">Nothing here.</li>}
        </ul>
      </Section>

      <Section title="Mailbox" icon={Inbox} actions={
        <Select value={msgStatus} onValueChange={setMsgStatus}>
          <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
          <SelectContent>{["all", "needs_owner", "new", "applied", "failed", "ignored"].map((v) => <SelectItem key={v} value={v}>{v === "all" ? "All" : v.replace("_", " ")}</SelectItem>)}</SelectContent>
        </Select>
      }>
        <ul className="divide-y rounded-xl border text-sm">
          {(msgs?.rows ?? []).map((m) => (
            <li key={m.id} className="space-y-1 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <Mail className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                <span className="font-semibold">{m.direction === "in" ? "From" : "To"} {m.from_email}</span>
                <span className="truncate">{m.subject}</span>
                <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-bold">{m.status.replace("_", " ")}{m.kind ? ` · ${m.kind}` : ""}</span>
                <span className="text-xs text-muted-foreground">{ago(m.received_at)}</span>
              </div>
              {m.reason && <div className="text-xs text-muted-foreground">{m.reason}</div>}
              <details className="text-xs"><summary className="cursor-pointer text-muted-foreground">Text</summary><pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap rounded bg-muted p-2">{m.body}</pre></details>
              {m.attachments?.length > 0 && <div className="text-xs">{m.attachments.map((a) => <a key={a.url} className="mr-3 underline" href={pressAttachmentHref(a.url)} target="_blank" rel="noreferrer">{a.name}</a>)}</div>}
              {m.status === "needs_owner" && <Button size="sm" variant="outline" onClick={() => act.mutate({ url: `/api/admin/press/messages/${m.id}/handled` })} disabled={act.isPending}>Handled</Button>}
            </li>
          ))}
          {msgs && msgs.rows.length === 0 && <li className="p-4 text-muted-foreground">Nothing here.</li>}
        </ul>
      </Section>
    </AppPage>
  );
}
