/**
 * Client portal v2 — file exchange + homeowner comments.
 *
 * Portal-facing (client session):
 *   - PortalPamphlets  "From <company>" — org brochures/warranties, gated downloads
 *   - PortalPhotoShare "Share photos with your contractor" — homeowner uploads
 *   - PortalCommentBox "Questions? Send a note to your contractor"
 *
 * Contractor-facing (org session), self-contained mounts on the client detail:
 *   - OrgPamphlets     — manage the company pamphlet shelf
 *   - EstimateAttach   — attach files to one estimate (row-level mount)
 *   - CustomerPhotos   — the photos this client shared
 *   - CustomerComments — notes from this client, with mark-read
 *
 * Public-facing:
 *   - EstimateAttachments — the gated public estimate page's attachment list
 */
import { useRef, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";
import {
  Loader2, Paperclip, Download, Trash2, Camera, MessageSquare, FileText, Image as ImageIcon,
} from "lucide-react";
import { SectionTitle, EmptyState } from "@/components/crm-ui";

const kb = (n?: number | null) =>
  n === null || n === undefined ? "" : n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;
const day = (d?: string | null) => (d ? new Date(d).toLocaleDateString() : null);

async function uploadFile(url: string, file: File, fields: Record<string, string>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  fd.append("file", file);
  const r = await fetch(url, { method: "POST", body: fd, credentials: "same-origin" });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.message || `Upload failed (${r.status})`);
  return j;
}

/* ── Portal: "From <company>" pamphlet shelf ─────────────────────────────── */

export function PortalPamphlets({ pamphlets }: { pamphlets: any[] }) {
  if (!pamphlets?.length) return null;
  return (
    <section className="space-y-3" data-testid="section-pamphlets">
      <SectionTitle icon={FileText} title={`From ${pamphlets[0]?.orgName ?? "your contractor"}`} />
      <Card>
        <CardContent className="p-4 divide-y">
          {pamphlets.map((p: any) => (
            <div key={p.id} className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0"
              data-testid={`pamphlet-${p.id}`}>
              <div className="min-w-0">
                <div className="font-medium truncate">{p.fileName}</div>
                <div className="text-xs text-muted-foreground">
                  {kb(p.sizeBytes)}{pamphlets.length > 1 && p.orgName ? ` · ${p.orgName}` : ""}
                </div>
              </div>
              <a href={p.downloadUrl} data-testid={`pamphlet-download-${p.id}`}>
                <Button size="sm" variant="outline">
                  <Download className="h-4 w-4 mr-1.5" /> Download
                </Button>
              </a>
            </div>
          ))}
        </CardContent>
      </Card>
    </section>
  );
}

/* ── Portal: share photos with the contractor ────────────────────────────── */

export function PortalPhotoShare({ accounts, photos }: { accounts: any[]; photos: any[] }) {
  const { toast } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const customerId = accounts?.[0]?.id;
  const mine = (photos ?? []).filter((p: any) => p.customerId === customerId);

  const upload = useMutation({
    mutationFn: async (file: File) =>
      uploadFile("/api/client/photos", file, { customerId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/client/documents"] });
      toast({ title: "Photo shared", description: "Your contractor can see it now." });
    },
    onError: (e: any) => toast({ title: "Upload failed", description: String(e.message ?? e), variant: "destructive" }),
  });

  if (!customerId) return null;
  return (
    <section className="space-y-3" data-testid="section-photo-share">
      <SectionTitle icon={Camera} title="Share photos with your contractor" />
      <Card>
        <CardContent className="p-4 space-y-3">
          <input
            ref={inputRef}
            type="file"
            accept="image/jpeg,image/png,image/heic,image/heif,image/webp"
            className="hidden"
            data-testid="input-client-photo"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) upload.mutate(f);
              e.target.value = "";
            }}
          />
          <div className="flex flex-wrap items-center gap-3">
            <Button
              variant="outline"
              size="sm"
              onClick={() => inputRef.current?.click()}
              disabled={upload.isPending || mine.length >= 20}
              data-testid="button-upload-photo"
            >
              {upload.isPending ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Camera className="h-4 w-4 mr-1.5" />}
              {upload.isPending ? "Uploading…" : "Add a photo"}
            </Button>
            <span className="text-xs text-muted-foreground">
              JPEG, PNG or HEIC · 10 MB each · up to 20 photos
            </span>
          </div>
          {mine.length > 0 && (
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-2" data-testid="client-photo-grid">
              {mine.map((p: any) => (
                <a key={p.id} href={p.downloadUrl} data-testid={`client-photo-${p.id}`}
                  className="block rounded-lg border overflow-hidden bg-muted/30 hover:border-primary/40 transition-colors">
                  {String(p.mime).startsWith("image/") && !/hei[cf]/.test(p.mime) ? (
                    <img src={`${p.downloadUrl}?inline=1`} alt={p.fileName} className="h-20 w-full object-cover" />
                  ) : (
                    <div className="h-20 flex items-center justify-center"><ImageIcon className="h-5 w-5 text-muted-foreground" /></div>
                  )}
                </a>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </section>
  );
}

/* ── Portal: send the contractor a note ──────────────────────────────────── */

export function PortalCommentBox({ accounts }: { accounts: any[] }) {
  const { toast } = useToast();
  const [body, setBody] = useState("");
  const [sentAt, setSentAt] = useState<string | null>(null);
  const customerId = accounts?.[0]?.id;

  const send = useMutation({
    mutationFn: async () => {
      const r = await fetch("/api/client/comments", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ customerId, body }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.message || "Could not send");
      return j;
    },
    onSuccess: () => {
      setBody("");
      setSentAt(new Date().toISOString());
      toast({ title: "Message sent", description: "Your contractor has been notified." });
    },
    onError: (e: any) => toast({ title: "Could not send", description: String(e.message ?? e), variant: "destructive" }),
  });

  if (!customerId) return null;
  return (
    <section className="space-y-3" data-testid="section-comment-box">
      <SectionTitle icon={MessageSquare} title="Questions? Send a note to your contractor" />
      <Card>
        <CardContent className="p-4 space-y-3">
          <Textarea
            rows={3}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Anything we should know — timing, access, a change you're considering…"
            data-testid="input-client-comment"
          />
          <div className="flex items-center gap-3">
            <Button
              size="sm"
              onClick={() => send.mutate()}
              disabled={!body.trim() || send.isPending}
              data-testid="button-send-comment"
            >
              {send.isPending && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
              Send message
            </Button>
            {sentAt && (
              <span className="text-xs text-muted-foreground" data-testid="text-comment-sent">
                Sent — your contractor will be notified.
              </span>
            )}
          </div>
        </CardContent>
      </Card>
    </section>
  );
}

/* ── Contractor: org pamphlet shelf (mounted on the client detail page) ──── */

export function OrgPamphlets() {
  const { toast } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const qk = ["/api/crm/attachments?kind=pamphlet"];
  const { data: pamphlets } = useQuery<any[]>({ queryKey: qk });

  const upload = useMutation({
    mutationFn: async (file: File) => uploadFile("/api/crm/attachments", file, { kind: "pamphlet" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk });
      toast({ title: "Pamphlet added", description: "Clients see it in their portal." });
    },
    onError: (e: any) => toast({ title: "Upload failed", description: String(e.message ?? e), variant: "destructive" }),
  });
  const remove = useMutation({
    mutationFn: async (id: string) => {
      const r = await fetch(`/api/crm/attachments/${id}`, { method: "DELETE", credentials: "same-origin" });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).message || "Delete failed");
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qk }),
    onError: (e: any) => toast({ title: "Could not delete", description: String(e.message ?? e), variant: "destructive" }),
  });

  return (
    <Card data-testid="section-pamphlet-manager">
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
        <SectionTitle
          icon={FileText}
          title="Company pamphlets"
          description="Brochures and warranties — every client's portal shows them."
        />
        <div>
          <input
            ref={inputRef}
            type="file"
            accept="application/pdf,image/jpeg,image/png,image/webp,image/gif"
            className="hidden"
            data-testid="input-pamphlet-file"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) upload.mutate(f);
              e.target.value = "";
            }}
          />
          <Button size="sm" variant="outline" onClick={() => inputRef.current?.click()}
            disabled={upload.isPending} data-testid="button-upload-pamphlet">
            {upload.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Paperclip className="h-4 w-4 mr-2" />}
            Upload PDF
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {!pamphlets?.length ? (
          <EmptyState compact icon={FileText} title="No pamphlets yet"
            description="Upload a brochure or warranty PDF — clients download it from their portal." />
        ) : (
          pamphlets.map((p: any) => (
            <div key={p.id} className="flex items-center justify-between gap-3 rounded-lg border px-4 py-2.5"
              data-testid={`pamphlet-row-${p.id}`}>
              <div className="min-w-0">
                <a href={p.downloadUrl} className="font-medium hover:underline truncate block">{p.fileName}</a>
                <div className="text-xs text-muted-foreground">{kb(p.sizeBytes)} · {day(p.createdAt)}</div>
              </div>
              <Button size="sm" variant="ghost" onClick={() => remove.mutate(p.id)}
                disabled={remove.isPending} data-testid={`button-delete-pamphlet-${p.id}`}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}

/* ── Contractor: attach files to one estimate (row-level mount) ──────────── */

export function EstimateAttach({ estimateId, canManage }: { estimateId: string; canManage: boolean }) {
  const { toast } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const qk = [`/api/crm/attachments?kind=estimate&refId=${estimateId}`];
  const { data: atts } = useQuery<any[]>({ queryKey: qk });

  const upload = useMutation({
    mutationFn: async (file: File) =>
      uploadFile("/api/crm/attachments", file, { kind: "estimate", refId: estimateId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk });
      toast({ title: "File attached", description: "It appears on the client's estimate page." });
    },
    onError: (e: any) => toast({ title: "Upload failed", description: String(e.message ?? e), variant: "destructive" }),
  });
  const remove = useMutation({
    mutationFn: async (id: string) => {
      const r = await fetch(`/api/crm/attachments/${id}`, { method: "DELETE", credentials: "same-origin" });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).message || "Delete failed");
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qk }),
    onError: (e: any) => toast({ title: "Could not delete", description: String(e.message ?? e), variant: "destructive" }),
  });

  return (
    <div className="flex flex-wrap items-center gap-2" data-testid={`estimate-attachments-${estimateId}`}>
      {(atts ?? []).map((a: any) => (
        <span key={a.id} className="inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs"
          data-testid={`estimate-attachment-${a.id}`}>
          <Paperclip className="h-3 w-3" />
          <a href={a.downloadUrl} className="hover:underline max-w-40 truncate">{a.fileName}</a>
          {canManage && (
            <button
              type="button"
              aria-label={`Remove ${a.fileName}`}
              className="text-muted-foreground hover:text-destructive"
              onClick={() => remove.mutate(a.id)}
              data-testid={`button-remove-attachment-${a.id}`}
            >
              <Trash2 className="h-3 w-3" />
            </button>
          )}
        </span>
      ))}
      {canManage && (
        <>
          <input
            ref={inputRef}
            type="file"
            accept="application/pdf,image/jpeg,image/png,image/webp,image/gif"
            className="hidden"
            data-testid={`input-attach-${estimateId}`}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) upload.mutate(f);
              e.target.value = "";
            }}
          />
          <Button size="sm" variant="ghost" onClick={() => inputRef.current?.click()}
            disabled={upload.isPending} data-testid={`button-attach-${estimateId}`}>
            {upload.isPending ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Paperclip className="h-4 w-4 mr-1.5" />}
            Attach
          </Button>
        </>
      )}
    </div>
  );
}

/* ── Contractor: photos the client shared (client detail strip) ──────────── */

export function CustomerPhotos({ customerId }: { customerId: string }) {
  const { data: photos } = useQuery<any[]>({
    queryKey: [`/api/crm/attachments?kind=photo&refId=${customerId}`],
  });

  return (
    <Card data-testid="section-customer-photos">
      <CardHeader>
        <SectionTitle
          icon={Camera}
          title="Photos from the client"
          description="Job photos this client shared from their portal."
        />
      </CardHeader>
      <CardContent>
        {!photos?.length ? (
          <EmptyState compact icon={Camera} title="No photos yet"
            description="When the client shares photos from their portal, they land here." />
        ) : (
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-2" data-testid="customer-photo-strip">
            {photos.map((p: any) => (
              <a key={p.id} href={p.downloadUrl} data-testid={`customer-photo-${p.id}`}
                className="block rounded-lg border overflow-hidden bg-muted/30 hover:border-primary/40 transition-colors">
                {String(p.mime).startsWith("image/") && !/hei[cf]/.test(p.mime) ? (
                  <img src={`${p.url}?inline=1`} alt={p.fileName} className="h-20 w-full object-cover" />
                ) : (
                  <div className="h-20 flex items-center justify-center"><ImageIcon className="h-5 w-5 text-muted-foreground" /></div>
                )}
              </a>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/* ── Contractor: comments from the client, with mark-read ────────────────── */

export function CustomerComments({ customerId }: { customerId: string }) {
  const { toast } = useToast();
  const qk = [`/api/crm/customers/${customerId}/client-comments`];
  const { data: comments } = useQuery<any[]>({ queryKey: qk });

  const markRead = useMutation({
    mutationFn: async (id: string) => {
      const r = await fetch(`/api/crm/client-comments/${id}/read`, { method: "POST", credentials: "same-origin" });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).message || "Failed");
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qk }),
    onError: (e: any) => toast({ title: "Could not mark read", description: String(e.message ?? e), variant: "destructive" }),
  });

  const unread = (comments ?? []).filter((c: any) => !c.readAt).length;

  return (
    <Card data-testid="section-customer-comments">
      <CardHeader>
        <SectionTitle
          icon={MessageSquare}
          title={unread ? `Client comments (${unread} unread)` : "Client comments"}
          description="Notes this client sent from their portal."
        />
      </CardHeader>
      <CardContent className="space-y-2">
        {!comments?.length ? (
          <EmptyState compact icon={MessageSquare} title="No comments yet"
            description="Questions the client sends from their portal show up here." />
        ) : (
          comments.map((c: any) => (
            <div key={c.id}
              className={`rounded-lg border px-4 py-3 ${c.readAt ? "" : "border-primary/40 bg-primary/5"}`}
              data-testid={`client-comment-${c.id}`}>
              <p className="text-sm whitespace-pre-wrap">{c.body}</p>
              <div className="mt-1.5 flex items-center justify-between gap-2 text-xs text-muted-foreground">
                <span>{new Date(c.createdAt).toLocaleString()}{!c.readAt && " · unread"}</span>
                {!c.readAt && (
                  <Button size="sm" variant="ghost" className="h-7 text-xs"
                    onClick={() => markRead.mutate(c.id)} disabled={markRead.isPending}
                    data-testid={`button-read-comment-${c.id}`}>
                    Mark read
                  </Button>
                )}
              </div>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}

/* ── Public estimate page: files attached to this estimate ───────────────── */

export function EstimateAttachments({ token }: { token: string }) {
  const { data: atts } = useQuery<any[]>({
    queryKey: [`/api/public/estimates/${token}/attachments`],
    retry: false,
  });
  if (!atts?.length) return null;
  return (
    <Card className="shadow-sm" data-testid="estimate-attachments">
      <CardHeader>
        <SectionTitle icon={Paperclip} title="Attached documents" />
      </CardHeader>
      <CardContent className="divide-y">
        {atts.map((a: any) => (
          <div key={a.id} className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0"
            data-testid={`public-attachment-${a.id}`}>
            <div className="min-w-0">
              <div className="font-medium truncate">{a.fileName}</div>
              <div className="text-xs text-muted-foreground">{kb(a.sizeBytes)}</div>
            </div>
            <a href={a.downloadUrl} data-testid={`public-attachment-download-${a.id}`}>
              <Button size="sm" variant="outline">
                <Download className="h-4 w-4 mr-1.5" /> Download
              </Button>
            </a>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
