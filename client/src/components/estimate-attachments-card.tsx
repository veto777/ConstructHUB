/**
 * Estimate attachments — the "Attachments +" card on the estimate detail page,
 * plus the org's auto-attach library manager.
 *
 *   - EstimateAttachmentsCard  every file on ONE estimate (upload, open,
 *     download, remove), a per-file "Add to all future estimates" tick, and
 *     "Add from library" (auto-attach files + company pamphlets, one click).
 *   - EstimateDefaultFiles     the org's "Added to every new estimate" list —
 *     upload straight into it, take files out (mounted next to OrgPamphlets).
 *
 * The library is crm_attachments kind 'estimate_default' sharing the source
 * file's storagePath (server/crm/estimate-default-files.ts); `fileKey` is the
 * opaque "same file" id the server hands back so the two lists can be matched.
 * Every change confirms first. Managing needs manageCustomers — the same gate
 * the server enforces on every attachment write; everyone else reads.
 */
import { useMemo, useRef, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, apiErrorMessage, queryClient } from "@/lib/queryClient";
import { SectionTitle, EmptyState } from "@/components/crm-ui";
import { ConfirmDelete, kb, uploadFile } from "@/components/client-uploads";
import {
  Check, Download, ExternalLink, FileText, Image as ImageIcon, Library, Loader2, Paperclip, Plus, Repeat, Trash2,
} from "lucide-react";

const ACCEPT = "application/pdf,image/jpeg,image/png,image/webp,image/gif";
const DEFAULTS_QK = ["/api/crm/attachments?kind=estimate_default"];
const PAMPHLETS_QK = ["/api/crm/attachments?kind=pamphlet"];

const FileIcon = ({ mime }: { mime?: string }) =>
  String(mime).startsWith("image/")
    ? <ImageIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
    : <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />;

async function deleteAttachment(id: string) {
  const r = await fetch(`/api/crm/attachments/${id}`, { method: "DELETE", credentials: "same-origin" });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).message || "Delete failed");
}

/** POST …/estimate-default {on}; the confirm step lives with the caller. */
function useDefaultToggle() {
  const { toast } = useToast();
  return useMutation({
    mutationFn: async ({ att, on }: { att: any; on: boolean }) =>
      (await apiRequest("POST", `/api/crm/attachments/${att.id}/estimate-default`, { on })).json(),
    onSuccess: (_d, { att, on }) => {
      queryClient.invalidateQueries({ queryKey: DEFAULTS_QK });
      toast({
        title: on ? "Added to every new estimate" : "Stopped auto-attaching",
        description: on
          ? `${att.fileName} will be attached to each estimate you create from now on.`
          : `New estimates won't get ${att.fileName}. Estimates that already have it keep it.`,
      });
    },
    onError: (e: any) => toast({ title: "Could not update", description: apiErrorMessage(e), variant: "destructive" }),
  });
}

/* ── Estimate detail: the Attachments card ───────────────────────────────── */

export function EstimateAttachmentsCard({ estimateId }: { estimateId: string }) {
  const { toast } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const { data: me } = useQuery<any>({ queryKey: ["/api/crm/me"] });
  const canManage = me?.permissions?.manageCustomers === true;

  // Same key as the client page's EstimateAttach, so both views stay in sync.
  const qk = [`/api/crm/attachments?kind=estimate&refId=${estimateId}`];
  const { data: atts, isLoading } = useQuery<any[]>({ queryKey: qk });
  const { data: defaults } = useQuery<any[]>({ queryKey: DEFAULTS_QK });
  const [pickerOpen, setPickerOpen] = useState(false);
  const { data: pamphlets } = useQuery<any[]>({ queryKey: PAMPHLETS_QK, enabled: canManage && pickerOpen });

  const defaultKeys = useMemo(() => new Set((defaults ?? []).map((d: any) => d.fileKey)), [defaults]);
  const onEstimateKeys = useMemo(() => new Set((atts ?? []).map((a: any) => a.fileKey)), [atts]);
  // Library = auto-attach files first, then pamphlets not already in that set.
  const library = useMemo(() => {
    const seen = new Set<string>();
    const out: { att: any; source: "default" | "pamphlet" }[] = [];
    for (const d of defaults ?? []) if (!seen.has(d.fileKey)) { seen.add(d.fileKey); out.push({ att: d, source: "default" }); }
    for (const p of pamphlets ?? []) if (!seen.has(p.fileKey)) { seen.add(p.fileKey); out.push({ att: p, source: "pamphlet" }); }
    return out;
  }, [defaults, pamphlets]);

  const upload = useMutation({
    mutationFn: async (file: File) => uploadFile("/api/crm/attachments", file, { kind: "estimate", refId: estimateId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk });
      toast({ title: "File attached", description: "It appears on the client's estimate page." });
    },
    onError: (e: any) => toast({ title: "Upload failed", description: String(e.message ?? e), variant: "destructive" }),
  });
  const remove = useMutation({
    mutationFn: deleteAttachment,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk });
      toast({ title: "Attachment removed", description: "It no longer shows on the client's estimate page." });
    },
    onError: (e: any) => toast({ title: "Could not delete", description: String(e.message ?? e), variant: "destructive" }),
  });
  const fromLibrary = useMutation({
    mutationFn: async (att: any) =>
      (await apiRequest("POST", `/api/crm/estimates/${estimateId}/attachments/from-library`, { attachmentId: att.id })).json(),
    onSuccess: (_d, att) => {
      queryClient.invalidateQueries({ queryKey: qk });
      toast({ title: "File attached", description: `${att.fileName} is on this estimate now.` });
    },
    onError: (e: any) => toast({ title: "Could not attach", description: apiErrorMessage(e), variant: "destructive" }),
  });
  const toggle = useDefaultToggle();

  const [confirmingRemove, setConfirmingRemove] = useState<any | null>(null);
  const [confirmingDefault, setConfirmingDefault] = useState<{ att: any; on: boolean } | null>(null);
  const list = atts ?? [];

  return (
    <Card data-testid="card-estimate-attachments">
      <CardHeader className="pb-2 flex flex-row items-center justify-between gap-2 space-y-0">
        <div className="text-sm font-medium flex items-center gap-1.5">
          <Paperclip className="h-4 w-4 text-muted-foreground" />
          Attachments{list.length ? <span className="text-muted-foreground font-normal">({list.length})</span> : null}
        </div>
        {canManage && (
          <div className="flex items-center gap-1">
            <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
              <PopoverTrigger asChild>
                <Button size="sm" variant="ghost" data-testid="button-attachment-library">
                  <Library className="h-4 w-4 mr-1.5" /> From library
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-80 p-2" data-testid="popover-attachment-library">
                <div className="px-2 pb-2 pt-1 text-xs text-muted-foreground">
                  Your auto-attach files and company pamphlets — one click puts it on this estimate.
                </div>
                {!library.length ? (
                  <div className="px-2 py-3 text-sm text-muted-foreground" data-testid="text-library-empty">
                    {pamphlets === undefined ? "Loading…" : "Nothing in the library yet. Tick \"Add to all future estimates\" on a file, or upload a company pamphlet."}
                  </div>
                ) : (
                  <div className="max-h-72 overflow-y-auto space-y-0.5">
                    {library.map(({ att, source }) => {
                      const already = onEstimateKeys.has(att.fileKey);
                      return (
                        <button
                          key={att.id}
                          type="button"
                          disabled={already || fromLibrary.isPending}
                          onClick={() => fromLibrary.mutate(att)}
                          className="w-full flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted disabled:opacity-60 disabled:hover:bg-transparent"
                          data-testid={`button-library-add-${att.id}`}
                        >
                          <FileIcon mime={att.mime} />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate">{att.fileName}</span>
                            <span className="block text-xs text-muted-foreground">
                              {source === "default" ? "Auto-attached" : "Pamphlet"} · {kb(att.sizeBytes)}
                            </span>
                          </span>
                          {already
                            ? <span className="text-xs text-muted-foreground flex items-center gap-1"><Check className="h-3 w-3" /> Added</span>
                            : <Plus className="h-4 w-4 text-muted-foreground" />}
                        </button>
                      );
                    })}
                  </div>
                )}
              </PopoverContent>
            </Popover>
            <input
              ref={inputRef}
              type="file"
              accept={ACCEPT}
              className="hidden"
              data-testid="input-estimate-attachment"
              onChange={(ev) => {
                const f = ev.target.files?.[0];
                if (f) upload.mutate(f);
                ev.target.value = "";
              }}
            />
            <Button size="sm" variant="outline" onClick={() => inputRef.current?.click()}
              disabled={upload.isPending} data-testid="button-upload-estimate-attachment"
              aria-label="Upload an attachment" title="PDF or image · 10 MB max">
              {upload.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            </Button>
          </div>
        )}
      </CardHeader>
      <CardContent className="space-y-2">
        {isLoading ? (
          <div className="flex justify-center py-3"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>
        ) : !list.length ? (
          <EmptyState compact icon={Paperclip} title="No attachments"
            description={canManage
              ? "Add a brochure, warranty or spec sheet (PDF or image, 10 MB max) — the client sees it on their estimate page."
              : "Files attached to this estimate appear here."} />
        ) : (
          list.map((a: any) => {
            const isDefault = defaultKeys.has(a.fileKey);
            return (
              <div key={a.id} className="rounded-lg border px-3 py-2" data-testid={`estimate-attachment-row-${a.id}`}>
                <div className="flex items-center gap-2">
                  <FileIcon mime={a.mime} />
                  <div className="min-w-0 flex-1">
                    <a href={`${a.url}?inline=1`} target="_blank" rel="noreferrer"
                      className="block truncate text-sm font-medium hover:underline" data-testid={`link-open-attachment-${a.id}`}>
                      {a.fileName}
                    </a>
                    <div className="text-xs text-muted-foreground">{kb(a.sizeBytes)}</div>
                  </div>
                  <a href={`${a.url}?inline=1`} target="_blank" rel="noreferrer" aria-label={`Open ${a.fileName}`} title="Open">
                    <Button size="icon" variant="ghost" className="h-8 w-8"><ExternalLink className="h-4 w-4" /></Button>
                  </a>
                  <a href={a.downloadUrl} download aria-label={`Download ${a.fileName}`} title="Download"
                    data-testid={`link-download-attachment-${a.id}`}>
                    <Button size="icon" variant="ghost" className="h-8 w-8"><Download className="h-4 w-4" /></Button>
                  </a>
                  {canManage && (
                    <Button size="icon" variant="ghost" className="h-8 w-8 hover:text-destructive"
                      onClick={() => setConfirmingRemove(a)} disabled={remove.isPending}
                      aria-label={`Remove ${a.fileName}`} title="Remove from this estimate"
                      data-testid={`button-remove-estimate-attachment-${a.id}`}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
                {canManage ? (
                  <label className="mt-1.5 flex items-center gap-2 text-xs text-muted-foreground cursor-pointer w-fit">
                    <Checkbox
                      checked={isDefault}
                      disabled={toggle.isPending}
                      onCheckedChange={(v) => setConfirmingDefault({ att: a, on: v === true })}
                      data-testid={`checkbox-attachment-default-${a.id}`}
                    />
                    Add to all future estimates
                  </label>
                ) : isDefault ? (
                  <div className="mt-1.5 flex items-center gap-1 text-xs text-muted-foreground">
                    <Repeat className="h-3 w-3" /> Added to all future estimates
                  </div>
                ) : null}
              </div>
            );
          })
        )}
      </CardContent>
      <ConfirmDelete
        open={!!confirmingRemove}
        onOpenChange={(o) => { if (!o) setConfirmingRemove(null); }}
        title={`Remove ${confirmingRemove?.fileName ?? "this file"}?`}
        description={`The client will no longer see it on their estimate page.${
          confirmingRemove && defaultKeys.has(confirmingRemove.fileKey)
            ? " It stays in your auto-attach set for new estimates." : " This can't be undone."}`}
        confirmLabel="Remove file"
        onConfirm={() => { if (confirmingRemove) remove.mutate(confirmingRemove.id); setConfirmingRemove(null); }}
        testId="dialog-remove-estimate-attachment"
      />
      <ConfirmDelete
        open={!!confirmingDefault}
        onOpenChange={(o) => { if (!o) setConfirmingDefault(null); }}
        title={confirmingDefault?.on
          ? `Add ${confirmingDefault.att.fileName} to every new estimate from now on?`
          : `Stop adding ${confirmingDefault?.att.fileName ?? "this file"} to new estimates?`}
        description={confirmingDefault?.on
          ? "Existing estimates are not changed."
          : "Estimates that already have it keep it."}
        confirmLabel={confirmingDefault?.on ? "Add to all future estimates" : "Stop adding it"}
        onConfirm={() => { if (confirmingDefault) toggle.mutate(confirmingDefault); setConfirmingDefault(null); }}
        testId="dialog-attachment-default"
      />
    </Card>
  );
}

/* ── CRM: the org's auto-attach library (next to the pamphlet shelf) ─────── */

export function EstimateDefaultFiles() {
  const { toast } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const { data: me } = useQuery<any>({ queryKey: ["/api/crm/me"] });
  const canManage = me?.permissions?.manageCustomers === true;
  const { data: defaults } = useQuery<any[]>({ queryKey: DEFAULTS_QK });

  const upload = useMutation({
    mutationFn: async (file: File) => uploadFile("/api/crm/attachments", file, { kind: "estimate_default" }),
    onSuccess: (_d, file) => {
      queryClient.invalidateQueries({ queryKey: DEFAULTS_QK });
      toast({ title: "Added to every new estimate", description: `${file.name} will be attached to each estimate you create from now on.` });
    },
    onError: (e: any) => toast({ title: "Upload failed", description: String(e.message ?? e), variant: "destructive" }),
  });
  const toggle = useDefaultToggle();
  const [confirming, setConfirming] = useState<any | null>(null);

  return (
    <Card data-testid="section-estimate-defaults">
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
        <SectionTitle
          icon={Repeat}
          title="Added to every new estimate"
          description="Pamphlets and spec sheets attached automatically to each estimate you create."
        />
        {canManage && (
          <div>
            <input
              ref={inputRef}
              type="file"
              accept={ACCEPT}
              className="hidden"
              data-testid="input-estimate-default-file"
              onChange={(ev) => {
                const f = ev.target.files?.[0];
                if (f) upload.mutate(f);
                ev.target.value = "";
              }}
            />
            <Button size="sm" variant="outline" onClick={() => inputRef.current?.click()}
              disabled={upload.isPending} data-testid="button-upload-estimate-default">
              {upload.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Paperclip className="h-4 w-4 mr-2" />}
              Upload file
            </Button>
          </div>
        )}
      </CardHeader>
      <CardContent className="space-y-2">
        {!defaults?.length ? (
          <EmptyState compact icon={Repeat} title="Nothing auto-attached"
            description="Tick “Add to all future estimates” on any estimate file, or upload one here." />
        ) : (
          defaults.map((d: any) => (
            <div key={d.id} className="flex items-center justify-between gap-3 rounded-lg border px-4 py-2.5"
              data-testid={`estimate-default-row-${d.id}`}>
              <div className="min-w-0 flex items-center gap-2">
                <FileIcon mime={d.mime} />
                <div className="min-w-0">
                  <a href={`${d.url}?inline=1`} target="_blank" rel="noreferrer"
                    className="font-medium hover:underline truncate block">{d.fileName}</a>
                  <div className="text-xs text-muted-foreground">{kb(d.sizeBytes)}</div>
                </div>
              </div>
              {canManage && (
                <Button size="sm" variant="ghost" onClick={() => setConfirming(d)}
                  disabled={toggle.isPending} data-testid={`button-remove-estimate-default-${d.id}`}
                  aria-label={`Stop auto-attaching ${d.fileName}`} title="Stop adding to new estimates">
                  <Trash2 className="h-4 w-4" />
                </Button>
              )}
            </div>
          ))
        )}
      </CardContent>
      <ConfirmDelete
        open={!!confirming}
        onOpenChange={(o) => { if (!o) setConfirming(null); }}
        title={`Stop adding ${confirming?.fileName ?? "this file"} to new estimates?`}
        description="Estimates that already have it keep it."
        confirmLabel="Stop adding it"
        onConfirm={() => { if (confirming) toggle.mutate({ att: confirming, on: false }); setConfirming(null); }}
        testId="dialog-remove-estimate-default"
      />
    </Card>
  );
}
