/**
 * Client 360 — self-contained mounts for the client detail page and the
 * homeowner portal.
 *
 * Contractor-facing (mounted in pages/crm-client.tsx):
 *   - CustomerNotes      — org-scoped notes on the client; edit/delete own,
 *                          owner/admin any
 *   - CustomerTimeline   — the merged behaviour log (events, engagement,
 *                          payments, comments, attachments, financing clicks)
 *                          folded together with the accountability audit feed
 *                          (/activity — who on the team changed what)
 *   - ViewAsClientButton — mint a 15-min read-only portal preview grant
 *
 * Portal-facing (mounted in pages/client-portal.tsx):
 *   - ContractorPreviewBanner — "Contractor preview" read-only banner
 *   - PortalFinancing         — the org's financing links; every click is
 *                               recorded before the link opens
 */
import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  Loader2, StickyNote, Activity, Eye, Landmark, MessageSquare, Paperclip,
  CreditCard, FileText, Pencil, Trash2, ExternalLink, History,
} from "lucide-react";
import { SectionTitle, EmptyState } from "@/components/crm-ui";

const when = (d?: string | null) => (d ? new Date(d).toLocaleString() : null);

/* ── Contractor: notes on the client ─────────────────────────────────────── */

export function CustomerNotes({ customerId, canManage, meMemberId, meRole }: {
  customerId: string;
  canManage: boolean;
  meMemberId?: string | null;
  meRole?: string | null;
}) {
  const { toast } = useToast();
  const qk = [`/api/crm/customers/${customerId}/notes`];
  const { data: notes } = useQuery<any[]>({ queryKey: qk });

  const [body, setBody] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editBody, setEditBody] = useState("");

  const add = useMutation({
    mutationFn: async () =>
      (await apiRequest("POST", `/api/crm/customers/${customerId}/notes`, { body })).json(),
    onSuccess: () => {
      setBody("");
      queryClient.invalidateQueries({ queryKey: qk });
      toast({ title: "Note added" });
    },
    onError: (e: any) => toast({ title: "Could not add note", description: String(e.message ?? e), variant: "destructive" }),
  });

  const save = useMutation({
    mutationFn: async (id: string) =>
      (await apiRequest("PATCH", `/api/crm/customers/${customerId}/notes/${id}`, { body: editBody })).json(),
    onSuccess: () => {
      setEditingId(null);
      queryClient.invalidateQueries({ queryKey: qk });
      toast({ title: "Note updated" });
    },
    onError: (e: any) => toast({ title: "Could not update note", description: String(e.message ?? e), variant: "destructive" }),
  });

  const remove = useMutation({
    mutationFn: async (id: string) =>
      apiRequest("DELETE", `/api/crm/customers/${customerId}/notes/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk });
      toast({ title: "Note deleted" });
    },
    onError: (e: any) => toast({ title: "Could not delete note", description: String(e.message ?? e), variant: "destructive" }),
  });

  const canModify = (n: any) =>
    meRole === "owner" || meRole === "admin" || (!!n.authorMemberId && n.authorMemberId === meMemberId);

  return (
    <Card data-testid="section-notes">
      <CardHeader>
        <SectionTitle
          icon={StickyNote}
          title="Notes"
          description="Internal notes about this client — never shown in their portal."
          infoKey="client-notes"
        />
      </CardHeader>
      <CardContent className="space-y-3">
        {canManage && (
          <div className="space-y-2">
            <Textarea
              rows={2}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Gate code, dog on site, prefers texts after 5pm…"
              data-testid="input-note-body"
            />
            <Button
              size="sm"
              onClick={() => add.mutate()}
              disabled={!body.trim() || add.isPending}
              data-testid="button-add-note"
            >
              {add.isPending && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
              Add note
            </Button>
          </div>
        )}
        {!notes?.length ? (
          <EmptyState compact icon={StickyNote} title="No notes yet"
            description="Anything the team should remember about this client." />
        ) : (
          notes.map((n: any) => (
            <div key={n.id} className="rounded-lg border px-4 py-3" data-testid={`note-${n.id}`}>
              {editingId === n.id ? (
                <div className="space-y-2">
                  <Textarea
                    rows={2}
                    value={editBody}
                    onChange={(e) => setEditBody(e.target.value)}
                    data-testid={`input-edit-note-${n.id}`}
                  />
                  <div className="flex gap-2">
                    <Button size="sm" onClick={() => save.mutate(n.id)}
                      disabled={!editBody.trim() || save.isPending}
                      data-testid={`button-save-note-${n.id}`}>
                      {save.isPending && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
                      Save
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setEditingId(null)}
                      data-testid={`button-cancel-note-${n.id}`}>
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <>
                  <p className="text-sm whitespace-pre-wrap">{n.body}</p>
                  <div className="mt-1.5 flex items-center justify-between gap-2 text-xs text-muted-foreground">
                    <span>{n.authorName ?? "Team"} · {when(n.createdAt)}</span>
                    {canManage && canModify(n) && (
                      <span className="flex gap-1">
                        <Button size="sm" variant="ghost" className="h-7 text-xs"
                          onClick={() => { setEditingId(n.id); setEditBody(n.body); }}
                          data-testid={`button-edit-note-${n.id}`}>
                          <Pencil className="h-3 w-3 mr-1" /> Edit
                        </Button>
                        <Button size="sm" variant="ghost" className="h-7 text-xs"
                          onClick={() => { if (window.confirm("Delete this note?")) remove.mutate(n.id); }}
                          disabled={remove.isPending}
                          data-testid={`button-delete-note-${n.id}`}>
                          <Trash2 className="h-3 w-3 mr-1" /> Delete
                        </Button>
                      </span>
                    )}
                  </div>
                </>
              )}
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}

/* ── Contractor: the unified activity timeline ───────────────────────────── */

const TIMELINE_ICONS: Record<string, any> = {
  estimate_event: FileText,
  engagement: Eye,
  payment: Landmark,
  comment: MessageSquare,
  attachment: Paperclip,
  finance_click: CreditCard,
  audit: History,
};

export function CustomerTimeline({ customerId }: { customerId: string }) {
  // Stepped reveal: 10 first, then 50, then everything — a busy client's
  // feed shouldn't be a mile-long scroll.
  const STEPS = [10, 50, Infinity];
  const [stepIdx, setStepIdx] = useState(0);
  const { data: entries } = useQuery<any[]>({
    queryKey: [`/api/crm/customers/${customerId}/timeline`],
  });
  // The accountability feed (audit log) folds into the same list. It is
  // manageJobs-gated server-side — a member without it just sees the
  // client-behaviour feed, never an error.
  const { data: audit } = useQuery<any[]>({
    queryKey: [`/api/crm/customers/${customerId}/activity`],
    retry: false,
  });
  const merged = [...(entries ?? []), ...(audit ?? [])]
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
  const shown = merged.slice(0, STEPS[stepIdx]);
  const hiddenCount = merged.length - shown.length;

  return (
    <Card data-testid="section-timeline">
      <CardHeader>
        <SectionTitle
          icon={Activity}
          title="Activity"
          description="Every send, open, visit, payment, message and change — newest first."
          infoKey="client-timeline"
        />
      </CardHeader>
      <CardContent className="space-y-1.5">
        {!merged.length ? (
          <EmptyState compact icon={Activity} title="No activity yet"
            description="When the client opens an estimate or messages you, it lands here." />
        ) : (
          shown.map((e: any) => {
            const Icon = TIMELINE_ICONS[e.kind] ?? Activity;
            return (
              <div key={e.id} className="flex items-start gap-3 rounded-lg border px-4 py-2.5"
                data-testid={`timeline-entry-${e.id}`}>
                <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted">
                  <Icon className="h-3.5 w-3.5 text-muted-foreground" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm">{e.text}</div>
                  <div className="text-xs text-muted-foreground">{when(e.at)}</div>
                </div>
              </div>
            );
          })
        )}
        {hiddenCount > 0 && (
          <button type="button"
            className="w-full rounded-lg border border-dashed border-border/60 py-2 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            onClick={() => setStepIdx((i) => Math.min(i + 1, STEPS.length - 1))}
            data-testid="button-timeline-more">
            Show {Math.min(hiddenCount, STEPS[stepIdx + 1] === Infinity ? hiddenCount : STEPS[stepIdx + 1] - STEPS[stepIdx])} more ({shown.length} of {merged.length})
          </button>
        )}
        {stepIdx > 0 && hiddenCount === 0 && merged.length > STEPS[0] && (
          <button type="button"
            className="w-full rounded-lg py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
            onClick={() => setStepIdx(0)}
            data-testid="button-timeline-less">
            Show less
          </button>
        )}
      </CardContent>
    </Card>
  );
}

/* ── Contractor: open the portal as this client (read-only preview) ──────── */

export function ViewAsClientButton({ customerId }: { customerId: string }) {
  const { toast } = useToast();
  const preview = useMutation({
    mutationFn: async () =>
      (await apiRequest("POST", `/api/crm/customers/${customerId}/portal-preview`, {})).json(),
    onSuccess: (r: any) => { if (r.url) window.open(r.url, "_blank", "noopener"); },
    onError: (e: any) => toast({ title: "Could not open client view", description: String(e.message ?? e), variant: "destructive" }),
  });

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={() => preview.mutate()}
      disabled={preview.isPending}
      data-testid="button-view-as-client"
    >
      {preview.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Eye className="h-4 w-4 mr-2" />}
      See what the client sees
    </Button>
  );
}

/* ── Portal: the read-only banner for contractor previews ────────────────── */

export function ContractorPreviewBanner({ customerName }: { customerName?: string | null }) {
  return (
    <div
      data-testid="banner-contractor-preview"
      className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-700 dark:text-amber-400 flex items-center gap-2"
    >
      <Eye className="h-4 w-4 shrink-0" />
      <span>
        <strong>Contractor preview</strong> — you're seeing this portal as {customerName ?? "your client"}.
        It is read-only: uploads, messages and financing applications are disabled.
      </span>
    </div>
  );
}

/* ── Portal: financing links, with click tracking ────────────────────────── */

export function PortalFinancing({ financing, preview }: { financing: any[]; preview?: boolean }) {
  const { toast } = useToast();
  const [busyUrl, setBusyUrl] = useState<string | null>(null);

  async function open(link: any) {
    setBusyUrl(link.url);
    try {
      // Record FIRST — the contractor sees "applied for financing" even if the
      // lender tab never finishes loading.
      const r = await fetch("/api/client/financing-click", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ label: link.label, url: link.url }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        toast({
          title: "Could not open financing",
          description: j.message || "Please try again in a moment.",
          variant: "destructive",
        });
        return;
      }
      window.open(link.url, "_blank", "noopener");
    } finally {
      setBusyUrl(null);
    }
  }

  return (
    <section className="space-y-3" data-testid="section-financing">
      <SectionTitle icon={Landmark} title="Financing" />
      <Card>
        <CardContent className="p-4 space-y-3">
          {!financing?.length ? (
            <EmptyState compact icon={Landmark} title="No financing options yet"
              description="When your contractor offers financing, the application link appears here." />
          ) : (
            <div className="space-y-2">
              {financing.map((l: any, i: number) => (
                <div key={`${l.url}-${i}`}
                  className="flex items-center justify-between gap-3 rounded-lg border px-4 py-3"
                  data-testid={`financing-link-${i}`}>
                  <div className="min-w-0">
                    <div className="font-medium truncate flex items-center gap-2">
                      {l.label}
                      {l.primary && <Badge className="text-[10px]">primary</Badge>}
                    </div>
                    {l.orgName && <div className="text-xs text-muted-foreground">{l.orgName}</div>}
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => open(l)}
                    disabled={busyUrl === l.url}
                    data-testid={`button-financing-${i}`}
                  >
                    {busyUrl === l.url
                      ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                      : <ExternalLink className="h-4 w-4 mr-1.5" />}
                    Apply
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
