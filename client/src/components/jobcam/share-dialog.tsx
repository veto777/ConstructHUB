import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Copy, Eye, EyeOff, Link2, Loader2, Mail, MessageSquare, Share2, ShieldOff, Clock, Lock } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { GooglePill } from "@/components/google";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";
import { jobcamError, jobcamFetch } from "@/lib/jobcam-api";
import { cn } from "@/lib/utils";
import { shareRecipient, type CrmCustomerDetailResponse } from "@shared/crm-customer-detail";

type Share = {
  id: string; kind: "gallery" | "timeline"; title: string | null; mediaIds: string[]; showDetails: boolean; hasPassword: boolean;
  expiresAt: string | null; revokedAt: string | null; viewCount: number; lastViewedAt: string | null;
  sentTo: { channel: string; to: string; at: string; by?: string }[]; createdAt: string; state: "ok" | "revoked" | "expired"; url: string;
};

/**
 * Make and send share links: a gallery (the selected shots) or the live
 * timeline, optional password, expiry, "show details" (time/GPS/uploader),
 * then copy or send by email / text — the project's client prefilled. Every
 * link stays revocable and shows its view count.
 */
export function ShareDialog({ projectId, customerId, open, onOpenChange, mediaIds }: {
  projectId: string; customerId?: string | null; open: boolean; onOpenChange: (o: boolean) => void; mediaIds: string[];
}) {
  const { toast } = useToast();
  const listKey = [`/api/crm/projects/${projectId}/jobcam/shares`];
  const { data: shares } = useQuery<Share[]>({ queryKey: listKey, enabled: open });
  // The client record is under `customer` in this response — the shared type
  // keeps this from being read at the top level again ("Prefilled from .").
  const { data: detail, isLoading: customerLoading, isError: customerError } = useQuery<CrmCustomerDetailResponse>({
    queryKey: [`/api/crm/customers/${customerId}`], enabled: open && !!customerId,
  });
  const [kind, setKind] = useState<"gallery" | "timeline">(mediaIds.length ? "gallery" : "timeline");
  const [title, setTitle] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [expires, setExpires] = useState<"never" | "7d" | "30d" | "90d" | "custom">("30d");
  const [expiresAt, setExpiresAt] = useState("");
  const [showDetails, setShowDetails] = useState(true);
  const [made, setMade] = useState<Share | null>(null);
  const [channel, setChannel] = useState<"email" | "text">("email");
  const [to, setTo] = useState("");
  const [message, setMessage] = useState("");
  useEffect(() => { if (open) { setKind(mediaIds.length ? "gallery" : "timeline"); setMade(null); } }, [open, mediaIds.length]);
  const recipient = shareRecipient(
    !customerId ? { state: "none" } : customerError ? { state: "error" } : customerLoading || !detail ? { state: "loading" } : { state: "ready", detail },
    channel,
  );
  useEffect(() => { if (open) setTo(recipient.to); }, [open, recipient.to, channel]);

  const create = useMutation({
    mutationFn: () => jobcamFetch<Share>(`/api/crm/projects/${projectId}/jobcam/shares`, {
      method: "POST",
      json: { kind, title: title || null, mediaIds: kind === "gallery" ? mediaIds : undefined, password: password || null, expires, expiresAt: expires === "custom" && expiresAt ? new Date(`${expiresAt}T23:59:59`).toISOString() : null, showDetails },
    }),
    onSuccess: (s) => { setMade(s); queryClient.invalidateQueries({ queryKey: listKey }); toast({ title: "Link ready", description: "Copy it, or send it to the client below." }); },
    onError: (e) => toast({ title: "Could not make the link", description: jobcamError(e), variant: "destructive" }),
  });
  const send = useMutation({
    mutationFn: (s: Share) => jobcamFetch<{ ok: true; to: string }>(`/api/crm/jobcam/shares/${s.id}/send`, { method: "POST", json: { channel, to, message: message || null } }),
    onSuccess: (r) => { queryClient.invalidateQueries({ queryKey: listKey }); toast({ title: channel === "email" ? "Emailed" : "Texted", description: `Sent to ${r.to}.` }); },
    onError: (e) => toast({ title: "Could not send", description: jobcamError(e), variant: "destructive" }),
  });
  const revoke = useMutation({
    mutationFn: (id: string) => jobcamFetch(`/api/crm/jobcam/shares/${id}/revoke`, { method: "POST", json: {} }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: listKey }); toast({ title: "Link revoked", description: "Anyone opening it now sees that it was turned off." }); },
    onError: (e) => toast({ title: "Could not revoke", description: jobcamError(e), variant: "destructive" }),
  });
  const copy = async (url: string) => {
    try { await navigator.clipboard.writeText(url); toast({ title: "Link copied" }); } catch { toast({ title: "Copy this link", description: url }); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="g-surface max-w-lg max-h-[90dvh] overflow-y-auto" data-testid="jobcam-share-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Share2 className="h-5 w-5 text-primary" /> Share with the client</DialogTitle>
          <DialogDescription>A link you control: password, expiry, and you can turn it off any time. Views are counted.</DialogDescription>
        </DialogHeader>

        {!made ? (
          <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); create.mutate(); }}>
            <div className="flex gap-2" role="radiogroup" aria-label="What to share">
              <GooglePill size="sm" label={mediaIds.length ? `Gallery · ${mediaIds.length} selected` : "Gallery (select shots first)"} selected={kind === "gallery"} disabled={!mediaIds.length} onClick={() => setKind("gallery")} role="radio" ariaPressed={kind === "gallery"} testId="jobcam-share-kind-gallery" />
              <GooglePill size="sm" label="Live timeline (everything, keeps updating)" selected={kind === "timeline"} onClick={() => setKind("timeline")} role="radio" ariaPressed={kind === "timeline"} testId="jobcam-share-kind-timeline" />
            </div>
            <label className="block text-sm">
              <span className="text-muted-foreground">Title (optional)</span>
              <input value={title} onChange={(e) => setTitle(e.target.value)} className="g-input mt-1" placeholder={kind === "gallery" ? "Roof tear-off — day 1" : "Live progress photos"} data-testid="jobcam-share-title" />
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="block text-sm">
                <span className="text-muted-foreground inline-flex items-center gap-1"><Lock className="h-3.5 w-3.5" /> Password (optional)</span>
                <span className="relative block mt-1">
                  <input type={showPw ? "text" : "password"} value={password} onChange={(e) => setPassword(e.target.value)} minLength={4} className="g-input pr-10" autoComplete="new-password" data-testid="jobcam-share-password" />
                  <button type="button" onClick={() => setShowPw((v) => !v)} className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted-foreground" aria-label={showPw ? "Hide password" : "Show password"} data-testid="jobcam-share-password-eye">
                    {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </span>
              </label>
              <label className="block text-sm">
                <span className="text-muted-foreground inline-flex items-center gap-1"><Clock className="h-3.5 w-3.5" /> Expires</span>
                <select value={expires} onChange={(e) => setExpires(e.target.value as any)} className="g-input g-select mt-1" data-testid="jobcam-share-expires">
                  <option value="7d">In 7 days</option><option value="30d">In 30 days</option><option value="90d">In 90 days</option><option value="never">Never</option><option value="custom">On a date…</option>
                </select>
                {expires === "custom" && <input type="date" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} className="g-input mt-1" data-testid="jobcam-share-expires-date" />}
              </label>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={showDetails} onChange={(e) => setShowDetails(e.target.checked)} className="h-4 w-4" data-testid="jobcam-share-details" />
              Show capture time, location and who shot it
            </label>
            <div className="flex justify-end">
              <GooglePill variant="solid" icon={Link2} label={create.isPending ? "Making the link…" : "Make the link"} type="submit" disabled={create.isPending || (kind === "gallery" && !mediaIds.length)} testId="jobcam-share-create" />
            </div>
          </form>
        ) : (
          <div className="space-y-4" data-testid="jobcam-share-made">
            <div className="rounded-lg border border-border bg-muted/40 p-3 text-sm">
              <div className="font-medium">{made.title}</div>
              <div className="mt-1 flex items-center gap-2">
                <input readOnly value={made.url} className="g-input h-9 flex-1 font-mono text-[12px]" onFocus={(e) => e.currentTarget.select()} data-testid="jobcam-share-url" />
                <GooglePill size="sm" icon={Copy} label="Copy" onClick={() => void copy(made.url)} testId="jobcam-share-copy" />
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{made.hasPassword ? "Password-protected. " : ""}{made.expiresAt ? `Expires ${new Date(made.expiresAt).toLocaleDateString()}.` : "No expiry."}</p>
            </div>
            <div className="space-y-2">
              <div className="flex gap-2" role="radiogroup" aria-label="Send by">
                <GooglePill size="sm" icon={Mail} label="Email" selected={channel === "email"} onClick={() => setChannel("email")} role="radio" ariaPressed={channel === "email"} testId="jobcam-share-channel-email" />
                <GooglePill size="sm" icon={MessageSquare} label="Text" selected={channel === "text"} onClick={() => setChannel("text")} role="radio" ariaPressed={channel === "text"} testId="jobcam-share-channel-text" />
              </div>
              <input value={to} onChange={(e) => setTo(e.target.value)} className="g-input" placeholder={channel === "email" ? "client@example.com" : "(555) 555-0123"} inputMode={channel === "email" ? "email" : "tel"} data-testid="jobcam-share-to" />
              <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={2} className="g-input py-2 min-h-[60px]" placeholder="A note for the client (optional)" data-testid="jobcam-share-message" />
              {recipient.hint && <p className="text-xs text-muted-foreground" data-testid="jobcam-share-recipient-hint">{recipient.hint}</p>}
              <div className="flex justify-end gap-2">
                <GooglePill size="sm" variant="quiet" label="Make another" onClick={() => setMade(null)} testId="jobcam-share-another" />
                <GooglePill size="sm" variant="solid" icon={channel === "email" ? Mail : MessageSquare} label={send.isPending ? "Sending…" : channel === "email" ? "Send email" : "Send text"} disabled={send.isPending || !to.trim()} onClick={() => send.mutate(made)} testId="jobcam-share-send" />
              </div>
            </div>
          </div>
        )}

        {shares && shares.length > 0 && (
          <section className="border-t border-border pt-3" data-testid="jobcam-share-list">
            <h3 className="text-sm font-medium mb-2">Existing links</h3>
            <ul className="space-y-2 text-sm">
              {shares.map((s) => (
                <li key={s.id} className={cn("flex flex-wrap items-center gap-2", s.state !== "ok" && "opacity-60")} data-testid={`jobcam-share-row-${s.id}`}>
                  <span className="min-w-0 flex-1 truncate">{s.title} <span className="text-xs text-muted-foreground">· {s.kind}{s.hasPassword ? " · password" : ""} · {s.viewCount} view{s.viewCount === 1 ? "" : "s"}{s.sentTo.length ? ` · sent ${s.sentTo.length}×` : ""}{s.state !== "ok" ? ` · ${s.state}` : ""}</span></span>
                  {s.state === "ok" && <GooglePill size="sm" icon={Copy} label="Copy" onClick={() => void copy(s.url)} testId={`jobcam-share-copy-${s.id}`} />}
                  {s.state === "ok" && <GooglePill size="sm" variant="danger" icon={ShieldOff} label="Revoke" onClick={() => revoke.mutate(s.id)} disabled={revoke.isPending} testId={`jobcam-share-revoke-${s.id}`} />}
                </li>
              ))}
            </ul>
          </section>
        )}
        {(create.isPending || send.isPending) && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
      </DialogContent>
    </Dialog>
  );
}
