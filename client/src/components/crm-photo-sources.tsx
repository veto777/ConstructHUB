/**
 * "CRM project photos" as a source inside the platform's Google tools.
 *
 *   CrmOptimizerSource — the Photo Optimizer (pages/photos.tsx): pick CRM photos (or arrive with ?crmPhotos= from the
 *     CRM Photos page); the server copies them into the optimizer's own upload staging (POST /api/photos/from-crm), so
 *     they geo-tag and rename exactly like an upload.
 *   CrmReviewPhotos — the review-request composer (pages/google-reviews.tsx): "Select client" over the CRM clients this
 *     member may see, that client's photos to tick, and a picker over every job. The request stores the ids; the
 *     homeowner's review page streams them through its token (server/crm/photo-library.ts).
 * Neither posts anything to Google: Business Profile API access was refused, so the files are for the owner (or the
 * homeowner) to upload by hand.
 */
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Camera, Check, Loader2, Search, UserRound, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { CrmPhotoGrid, CrmPhotoPicker, StageTabs } from "@/components/crm-photo-picker";
import {
  clearHandoff, crmPhotoError, fetchCrmJson, handoffIds,
  type CrmPhoto, type CrmPhotoClient, type CrmPhotoFacets, type CrmPhotoFilter,
} from "@/lib/crm-photos";

// ── Photo Optimizer ─────────────────────────────────────────────────────────

export type OptimizerCrmFile = { serverId: string; originalName: string; previewUrl: string };

export function CrmOptimizerSource({ remaining, onFiles, enabled = true }: {
  /** How many more photos the optimizer batch takes (it works on 10 at a time). */
  remaining: number;
  onFiles: (files: OptimizerCrmFile[]) => void;
  /** Off while signed out: the hand-off waits for a session. */
  enabled?: boolean;
}) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const handedOff = useRef(false);

  const importIds = async (ids: string[]) => {
    if (!ids.length) return;
    setBusy(true);
    try {
      const r = await fetch("/api/photos/from-crm", {
        method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids: ids.slice(0, 10) }),
      });
      if (!r.ok) throw new Error(await crmPhotoError(r));
      const out = await r.json() as { files: { id: string; originalName: string; attachmentId: string }[]; skipped: { reason: string }[] };
      onFiles(out.files.map((f) => ({ serverId: f.id, originalName: f.originalName, previewUrl: `/api/crm/photos/${f.attachmentId}/thumb?size=lg` })));
      toast({
        title: `${out.files.length} CRM photo${out.files.length === 1 ? "" : "s"} added`,
        description: out.skipped.length ? `${out.skipped.length} skipped: ${out.skipped[0].reason}` : "Set your business info and process them like any upload.",
        variant: out.files.length ? undefined : "destructive",
      });
      setOpen(false);
    } catch (e: any) {
      toast({ title: "Could not add CRM photos", description: String(e?.message ?? e), variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  // Arriving from the CRM Photos page ("Optimize for Google profile").
  useEffect(() => {
    if (!enabled || handedOff.current) return;
    const ids = handoffIds();
    if (!ids.length) return;
    handedOff.current = true;
    clearHandoff(["crmPhotos"]);
    void importIds(ids.slice(0, Math.max(0, remaining)));
  }, [enabled]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)} disabled={busy || remaining <= 0 || !enabled} data-testid="button-crm-photos-source">
        {busy ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Camera className="mr-1.5 h-3.5 w-3.5" />}
        CRM project photos
      </Button>
      <CrmPhotoPicker open={open} onOpenChange={setOpen} max={Math.max(1, remaining)} busy={busy}
        description="Pick job photos from your CRM. They are copied into this batch to geo-tag and name for your Google Business Profile."
        confirmLabel="Add to batch" onPick={(ps) => importIds(ps.map((p) => p.id))} />
    </>
  );
}

// ── Review-request composer ─────────────────────────────────────────────────

/** How many job photos go with a review request: 5 to 10 (fewer only when the job has fewer). */
export const PICK_MIN = 5;
export const PICK_MAX = 10;

export type ReviewCrmPhoto = { id: string; thumbUrl: string; fileName: string };

/** The ?crmPhotos=&crmCustomer= hand-off from the CRM Photos page ("Use in a review request"). */
export function useReviewHandoff(onArrive: (h: { customer: CrmPhotoClient | null; photos: ReviewCrmPhoto[] }) => void) {
  const done = useRef(false);
  useEffect(() => {
    if (done.current) return;
    const ids = handoffIds();
    const customerId = new URLSearchParams(window.location.search).get("crmCustomer");
    if (!ids.length && !customerId) return;
    done.current = true;
    clearHandoff();
    // Resolve names/thumbnails through the same scoped list the CRM uses; the server re-checks at send time.
    (async () => {
      let customer: CrmPhotoClient | null = null;
      const photos: ReviewCrmPhoto[] = [];
      try {
        if (customerId) {
          const page = await fetchCrmJson<{ photos: CrmPhoto[] }>(`/api/crm/photos?customerId=${encodeURIComponent(customerId)}&limit=120`);
          const want = new Set(ids);
          for (const p of page.photos) if (want.has(p.id)) photos.push({ id: p.id, thumbUrl: p.thumbUrl, fileName: p.fileName });
          const found = await fetchCrmJson<{ clients: CrmPhotoClient[] }>(`/api/crm/photos/clients?id=${encodeURIComponent(customerId)}`);
          customer = found.clients.find((c) => c.id === customerId) ?? null;
        }
        // Photos from several jobs (no single client): keep them by id; thumbnails come from the gated thumb route.
        for (const id of ids) if (!photos.some((p) => p.id === id)) photos.push({ id, thumbUrl: `/api/crm/photos/${id}/thumb`, fileName: "CRM photo" });
      } catch { /* not on a CRM team in this session: nothing to attach */ }
      onArrive({ customer, photos: photos.slice(0, PICK_MAX) });
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
}

/**
 * "Select client" + that client's photos. Picking fills the composer's name/email/phone/address (onClient);
 * typing by hand stays available — picking is optional. `crmPhotos` are the ticked CRM photo ids.
 */
export function CrmReviewPhotos({ client, onClient, crmPhotos, onCrmPhotos, room, pickerOpen: openProp, onPickerOpen }: {
  client: CrmPhotoClient | null;
  onClient: (c: CrmPhotoClient | null) => void;
  crmPhotos: ReviewCrmPhoto[];
  onCrmPhotos: (p: ReviewCrmPhoto[]) => void;
  /** Photos the request can still take (30 minus the uploaded/library ones). */
  room: number;
  /** Optional control of the all-jobs picker (the Media Library modal opens it as a source). */
  pickerOpen?: boolean;
  onPickerOpen?: (o: boolean) => void;
}) {
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");
  const [openList, setOpenList] = useState(false);
  const [ownPickerOpen, setOwnPickerOpen] = useState(false);
  const pickerOpen = openProp ?? ownPickerOpen;
  const setPickerOpen = onPickerOpen ?? setOwnPickerOpen;
  const [stage, setStage] = useState<CrmPhotoFilter>("all");
  const [facets, setFacets] = useState<CrmPhotoFacets | undefined>();
  useEffect(() => { const t = setTimeout(() => setQ(search.trim()), 250); return () => clearTimeout(t); }, [search]);
  const clients = useQuery<{ clients: CrmPhotoClient[] }, Error>({
    queryKey: [`/api/crm/photos/clients?q=${encodeURIComponent(q)}`, "review"],
    queryFn: () => fetchCrmJson(`/api/crm/photos/clients?q=${encodeURIComponent(q)}`),
    enabled: openList,
    retry: false,
  });
  const selected = new Map(crmPhotos.map((p) => [p.id, p as unknown as CrmPhoto]));
  // The client's own job photos: pick 5–10 (owner rule), never past the request's room.
  const max = Math.min(crmPhotos.length + Math.max(0, room), PICK_MAX);
  const toggle = (p: CrmPhoto) => {
    if (selected.has(p.id)) onCrmPhotos(crmPhotos.filter((x) => x.id !== p.id));
    else if (room > 0 && crmPhotos.length < PICK_MAX) onCrmPhotos([...crmPhotos, { id: p.id, thumbUrl: p.thumbUrl, fileName: p.fileName }]);
  };
  const short = crmPhotos.length > 0 && crmPhotos.length < Math.min(PICK_MIN, client?.photoCount ?? PICK_MIN);

  return (
    <div className="space-y-3 rounded-lg border bg-muted/20 p-3" data-testid="section-review-crm">
      <div className="space-y-1.5">
        <Label className="flex items-center gap-1.5"><UserRound className="h-3.5 w-3.5" aria-hidden="true" />Select client (optional)</Label>
        {client ? (
          <div className="flex items-center justify-between gap-2 rounded-md border bg-background px-3 py-2" data-testid="selected-review-client">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{client.name}</p>
              <p className="truncate text-xs text-muted-foreground">{[client.email, client.phone, client.address].filter(Boolean).join(" · ") || "No contact details on file"}</p>
            </div>
            <Button type="button" variant="ghost" size="sm" onClick={() => { onClient(null); onCrmPhotos([]); }} data-testid="button-clear-review-client">
              <X className="mr-1 h-3.5 w-3.5" />Change
            </Button>
          </div>
        ) : (
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" aria-hidden="true" />
            <Input value={search} onChange={(e) => { setSearch(e.target.value); setOpenList(true); }} onFocus={() => setOpenList(true)}
              placeholder="Search your CRM clients — or type the details below by hand" className="pl-8"
              aria-label="Search CRM clients" data-testid="input-review-client-search" />
            {openList && (
              <div className="absolute z-50 mt-1 max-h-64 w-full overflow-y-auto rounded-md border bg-popover p-1 shadow-md" data-testid="list-review-clients">
                {clients.isLoading ? (
                  <div className="flex justify-center py-3"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>
                ) : clients.error ? (
                  <p className="px-2 py-2 text-xs text-muted-foreground">{clients.error.message}</p>
                ) : !clients.data?.clients.length ? (
                  <p className="px-2 py-2 text-xs text-muted-foreground">No CRM client matches. Type the details below instead.</p>
                ) : clients.data.clients.map((c) => (
                  <button key={c.id} type="button" className="flex w-full items-start justify-between gap-2 rounded px-2 py-1.5 text-left hover:bg-muted"
                    onClick={() => { onClient(c); onCrmPhotos([]); setOpenList(false); setSearch(""); }} data-testid={`option-review-client-${c.id}`}>
                    <span className="min-w-0">
                      <span className="block truncate text-sm">{c.name}</span>
                      <span className="block truncate text-xs text-muted-foreground">{[c.email, c.address].filter(Boolean).join(" · ")}</span>
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground">{c.photoCount} photo{c.photoCount === 1 ? "" : "s"}</span>
                  </button>
                ))}
                <button type="button" className="mt-1 w-full rounded px-2 py-1 text-left text-xs text-muted-foreground hover:bg-muted" onClick={() => setOpenList(false)}>Close</button>
              </div>
            )}
          </div>
        )}
      </div>

      {client && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs font-medium">{client.name}'s job photos — pick {PICK_MIN}–{PICK_MAX} to send</p>
            <span className={`text-xs ${short ? "text-amber-700 dark:text-amber-400" : "text-muted-foreground"}`} data-testid="text-review-crm-count">
              {crmPhotos.length} of {PICK_MIN}–{PICK_MAX} picked
            </span>
          </div>
          <StageTabs value={stage} onChange={setStage} facets={facets} testPrefix="tab-review-stage" />
          <CrmPhotoGrid params={{ customerId: client.id, stage }} selected={selected} onToggle={toggle} max={max} dense showClient={false}
            onFacets={(f) => setFacets(f)} testId="review-client-photos"
            emptyText="No photos on this client yet. Leave it empty and your client can pick from their own project photos later, if any are added." />
          {crmPhotos.length === 0 && (
            <p className="text-xs text-muted-foreground" data-testid="text-review-homeowner-choice">
              Pick none and your client chooses {PICK_MIN}–{PICK_MAX} of their own job photos on the review page.
            </p>
          )}
        </div>
      )}

      {!client && crmPhotos.length > 0 && (
        <div className="flex flex-wrap gap-2" data-testid="review-crm-photos-attached">
          {crmPhotos.map((p) => (
            <div key={p.id} className="relative h-16 w-16 overflow-hidden rounded border">
              <img src={p.thumbUrl} alt={p.fileName} className="h-full w-full object-cover" />
              <button type="button" onClick={() => onCrmPhotos(crmPhotos.filter((x) => x.id !== p.id))} aria-label={`Remove ${p.fileName}`}
                className="absolute right-0.5 top-0.5 rounded bg-black/60 p-0.5 text-white"><X className="h-3 w-3" /></button>
            </div>
          ))}
        </div>
      )}

      <Button type="button" size="sm" variant="outline" onClick={() => setPickerOpen(true)} disabled={room <= 0} data-testid="button-review-crm-picker">
        <Camera className="mr-1.5 h-3.5 w-3.5" />Browse all CRM project photos
      </Button>
      <CrmPhotoPicker open={pickerOpen} onOpenChange={setPickerOpen} max={Math.max(1, room)} confirmLabel="Attach"
        description="Pick photos from any job. Your client gets them on the review page to add to their Google review."
        onPick={(ps) => {
          const have = new Set(crmPhotos.map((p) => p.id));
          onCrmPhotos([...crmPhotos, ...ps.filter((p) => !have.has(p.id)).slice(0, room).map((p) => ({ id: p.id, thumbUrl: p.thumbUrl, fileName: p.fileName }))]);
          setPickerOpen(false);
        }} />
      {crmPhotos.length > 0 && <p className="flex items-center gap-1 text-xs text-muted-foreground"><Check className="h-3 w-3" />{crmPhotos.length} CRM photo{crmPhotos.length === 1 ? "" : "s"} will go with this request.</p>}
    </div>
  );
}
