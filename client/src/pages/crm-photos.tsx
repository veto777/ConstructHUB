import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  Camera, ChevronLeft, ChevronRight, Download, ExternalLink, FolderPlus, Images, LayoutGrid, Loader2, MapPin, Search, Star, Wand2, X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CrmPage, CrmPageHeader, StatusPill, statusTone } from "@/components/crm-ui";
import { CrmPhotoGrid, CrmPhotoJobList, StageBadge, StageTabs } from "@/components/crm-photo-picker";
import { SortSelect, useTableSort, type SortColumn } from "@/components/sortable-th";

/** The "By job" card grid's Sort dropdown (GET /api/crm/photos/jobs?sort=&dir= — the server orders every job before paging). */
type JobSortKey = "lastPhotoAt" | "name" | "photos";
const JOB_SORT_COLUMNS: SortColumn<JobSortKey>[] = [
  { key: "lastPhotoAt", label: "Last photo", kind: "date" },
  { key: "name", label: "Client", kind: "text" },
  { key: "photos", label: "Photos", kind: "number" },
];
import { useToast } from "@/hooks/use-toast";
import {
  crmPhotoError, optimizerHref, reviewRequestHref,
  type CrmJobStatusFilter, type CrmPhoto, type CrmPhotoFacets, type CrmPhotoFilter, type CrmPhotoJob,
} from "@/lib/crm-photos";

/**
 * Photos — every project photo across the company's jobs (owner, 2026-10-17):
 * per job, all of them, by stage (in progress / finished / from clients /
 * HOVER captures) and by the job's own status. Selections go straight to the
 * platform's Google tools: the Photo Optimizer (geo-tags and names photos for
 * a Google Business Profile — uploaded by hand, Google gives us no posting
 * access), a review request (photos the homeowner can add to their Google
 * review) and the Media library every tool reads. Server: server/crm/photo-library.ts.
 */
const OPTIMIZER_MAX = 10;
const REVIEW_MAX = 10;
const MEDIA_MAX = 60;
const ZIP_MAX = 100;

export default function CrmPhotosPage() {
  const { toast } = useToast();
  const { data: me } = useQuery<any>({ queryKey: ["/api/crm/me"] });
  const canExport = me?.permissions?.manageJobs === true || me?.permissions?.manageCustomers === true;

  const [view, setView] = useState<"jobs" | "all">("jobs");
  const [job, setJob] = useState<CrmPhotoJob | null>(null);
  const [stage, setStage] = useState<CrmPhotoFilter>("all");
  const [jobStatus, setJobStatus] = useState<CrmJobStatusFilter>("all");
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [facets, setFacets] = useState<CrmPhotoFacets | undefined>();
  const [selected, setSelected] = useState<Map<string, CrmPhoto>>(new Map());
  const [lightbox, setLightbox] = useState<{ list: CrmPhoto[]; index: number } | null>(null);
  const [mediaOpen, setMediaOpen] = useState(false);
  const jobSort = useTableSort<JobSortKey>("lastPhotoAt", "desc", "photo-jobs", { keys: JOB_SORT_COLUMNS.map((c) => c.key) });
  useEffect(() => { const t = setTimeout(() => setQ(search.trim()), 300); return () => clearTimeout(t); }, [search]);

  const toggle = (p: CrmPhoto) => setSelected((prev) => {
    const next = new Map(prev);
    if (next.has(p.id)) next.delete(p.id); else next.set(p.id, p);
    return next;
  });
  const ids = [...selected.keys()];
  const oneClient = useMemo(() => {
    const set = new Set([...selected.values()].map((p) => p.customer?.id).filter(Boolean));
    return set.size === 1 ? [...set][0]! : null;
  }, [selected]);

  const shared = { jobStatus, q: job ? undefined : q || undefined, from: from || undefined, to: to || undefined };
  const gridParams = { ...shared, stage, customerId: job?.customer.id };
  const showGrid = view === "all" || !!job;

  const tooMany = (max: number, what: string) => {
    if (ids.length <= max) return false;
    toast({ title: `Pick up to ${max} photos`, description: `${what} takes ${max} at a time — ${ids.length} are selected.`, variant: "destructive" });
    return true;
  };

  return (
    <CrmPage wide>
      <CrmPageHeader
        icon={Images}
        title="Photos"
        subtitle="Every project photo across your jobs — crew shots, photos clients shared, and HOVER captures. Send them to your Google tools in a click."
      />

      <Card>
        <CardContent className="space-y-3 p-4">
          <div className="flex flex-wrap items-center gap-2">
            {job ? (
              <Button variant="ghost" size="sm" onClick={() => setJob(null)} data-testid="button-photos-back-to-jobs">
                <ChevronLeft className="mr-1 h-4 w-4" />All jobs
              </Button>
            ) : (
              <div className="inline-flex rounded-md border p-0.5" role="group" aria-label="View">
                <Button size="sm" variant={view === "jobs" ? "secondary" : "ghost"} className="h-8" onClick={() => setView("jobs")} data-testid="button-photos-view-jobs">
                  <LayoutGrid className="mr-1.5 h-4 w-4" />By job
                </Button>
                <Button size="sm" variant={view === "all" ? "secondary" : "ghost"} className="h-8" onClick={() => setView("all")} data-testid="button-photos-view-all">
                  <Images className="mr-1.5 h-4 w-4" />All photos
                </Button>
              </div>
            )}
            {job ? (
              <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                <p className="truncate text-sm font-semibold" data-testid="text-photos-job">{job.customer.name}</p>
                {job.customer.address && <span className="flex items-center gap-1 truncate text-xs text-muted-foreground"><MapPin className="h-3 w-3" />{job.customer.address}</span>}
                {job.project && <StatusPill tone={statusTone(job.project.status)}>{job.project.name}</StatusPill>}
                <Link href={`/crm/clients/${job.customer.id}`} className="text-xs text-primary hover:underline" data-testid="link-photos-job-client">Open client</Link>
              </div>
            ) : (
              <div className="relative min-w-[14rem] flex-1">
                <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" aria-hidden="true" />
                <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search client name or address" className="h-9 pl-8"
                  aria-label="Search client name or address" data-testid="input-photos-search" />
              </div>
            )}
            <Select value={jobStatus} onValueChange={(v) => setJobStatus(v as CrmJobStatusFilter)}>
              <SelectTrigger className="h-9 w-[11rem]" aria-label="Job status" data-testid="select-photos-job-status"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All jobs</SelectItem>
                <SelectItem value="active">Jobs in progress</SelectItem>
                <SelectItem value="completed">Completed jobs</SelectItem>
              </SelectContent>
            </Select>
            <div className="flex items-center gap-1">
              <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-9 w-[9.5rem]" aria-label="Taken from" data-testid="input-photos-from" />
              <span className="text-xs text-muted-foreground">to</span>
              <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-9 w-[9.5rem]" aria-label="Taken to" data-testid="input-photos-to" />
            </div>
            {!showGrid && (
              <SortSelect columns={JOB_SORT_COLUMNS} sort={jobSort.sort} onChange={jobSort.setSort} testId="select-sort-photo-jobs" />
            )}
          </div>
          <StageTabs value={stage} onChange={setStage} facets={showGrid ? facets : undefined} />
        </CardContent>
      </Card>

      {selected.size > 0 && (
        <div className="sticky top-2 z-20 flex flex-wrap items-center gap-2 rounded-xl border bg-background/95 p-3 shadow-md backdrop-blur" data-testid="bar-photo-selection">
          <p className="mr-auto text-sm font-medium" data-testid="text-photos-selected">{selected.size} selected</p>
          {canExport && (
            <>
              <Button size="sm" variant="outline" data-testid="button-photos-optimize"
                onClick={() => { if (!tooMany(OPTIMIZER_MAX, "The Photo Optimizer")) window.location.href = optimizerHref(ids); }}>
                <Wand2 className="mr-1.5 h-4 w-4" />Optimize for Google profile
              </Button>
              <Button size="sm" variant="outline" data-testid="button-photos-review"
                onClick={() => { if (!tooMany(REVIEW_MAX, "A review request")) window.location.href = reviewRequestHref(ids, oneClient); }}>
                <Star className="mr-1.5 h-4 w-4" />Use in a review request
              </Button>
              <Button size="sm" variant="outline" data-testid="button-photos-media"
                onClick={() => { if (!tooMany(MEDIA_MAX, "Saving to the Media library")) setMediaOpen(true); }}>
                <FolderPlus className="mr-1.5 h-4 w-4" />Save to Media library
              </Button>
            </>
          )}
          <Button size="sm" variant="outline" data-testid="button-photos-download"
            onClick={() => { if (!tooMany(ZIP_MAX, "A download")) window.location.href = `/api/crm/photos/download.zip?ids=${ids.join(",")}`; }}>
            <Download className="mr-1.5 h-4 w-4" />Download
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Map())} data-testid="button-photos-clear">
            <X className="mr-1 h-4 w-4" />Clear
          </Button>
        </div>
      )}

      {showGrid ? (
        <CrmPhotoGrid
          params={gridParams}
          selected={selected}
          onToggle={toggle}
          onOpen={(p, list) => setLightbox({ list, index: list.findIndex((x) => x.id === p.id) })}
          onFacets={(f) => setFacets(f)}
          showClient={!job}
          emptyText={job ? "No photos of this job match." : "No photos match. Photos your crew adds on a client page, photos clients share from their portal and HOVER captures all show up here."}
          testId="photos-grid"
        />
      ) : (
        <CrmPhotoJobList params={{ ...shared, stage, sort: jobSort.sort.key, dir: jobSort.sort.dir }} onPick={(j) => { setJob(j); setFacets(undefined); }} />
      )}

      <p className="text-xs text-muted-foreground" data-testid="text-photos-google-note">
        Google does not let ConstructHub post to your Business Profile directly. The Photo Optimizer prepares geo-tagged,
        keyword-named copies for you to upload on Google yourself; review requests let your client download the photos to add to their review.
      </p>

      <Lightbox state={lightbox} onClose={() => setLightbox(null)} onMove={(i) => setLightbox((s) => (s ? { ...s, index: i } : s))}
        selected={selected} onToggle={toggle} />
      <SaveToMediaDialog open={mediaOpen} onOpenChange={setMediaOpen} ids={ids}
        suggestedName={oneClient ? selected.values().next().value?.customer?.name ?? "" : ""}
        onDone={() => setSelected(new Map())} />
    </CrmPage>
  );
}

function Lightbox({ state, onClose, onMove, selected, onToggle }: {
  state: { list: CrmPhoto[]; index: number } | null; onClose: () => void; onMove: (i: number) => void;
  selected: Map<string, CrmPhoto>; onToggle: (p: CrmPhoto) => void;
}) {
  const p = state ? state.list[state.index] : null;
  useEffect(() => {
    if (!state) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight" && state.index < state.list.length - 1) onMove(state.index + 1);
      if (e.key === "ArrowLeft" && state.index > 0) onMove(state.index - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [state, onMove]);
  return (
    <Dialog open={!!p} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-5xl p-3 sm:p-4" data-testid="dialog-photo-lightbox">
        {p && (
          <>
            <DialogHeader className="pr-8">
              <DialogTitle className="flex flex-wrap items-center gap-2 text-base">
                <StageBadge photo={p} />
                <span className="truncate">{p.customer?.name ?? "Photo"}</span>
              </DialogTitle>
              <DialogDescription className="truncate">
                {p.fileName}{p.project ? ` · ${p.project.name}` : ""}{p.createdAt ? ` · ${new Date(p.createdAt).toLocaleDateString()}` : ""}
              </DialogDescription>
            </DialogHeader>
            <div className="relative flex items-center justify-center rounded-lg bg-black/90">
              <img src={p.url} alt={p.fileName} className="max-h-[70vh] w-auto object-contain" data-testid="img-lightbox" />
              {state!.index > 0 && (
                <button type="button" onClick={() => onMove(state!.index - 1)} aria-label="Previous photo"
                  className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full bg-black/50 p-2 text-white hover:bg-black/70" data-testid="button-lightbox-prev">
                  <ChevronLeft className="h-5 w-5" />
                </button>
              )}
              {state!.index < state!.list.length - 1 && (
                <button type="button" onClick={() => onMove(state!.index + 1)} aria-label="Next photo"
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-black/50 p-2 text-white hover:bg-black/70" data-testid="button-lightbox-next">
                  <ChevronRight className="h-5 w-5" />
                </button>
              )}
            </div>
            <DialogFooter className="flex-row flex-wrap justify-between gap-2 sm:justify-between">
              <span className="self-center text-xs text-muted-foreground">{state!.index + 1} of {state!.list.length}</span>
              <div className="flex flex-wrap gap-2">
                {p.customer && (
                  <Button variant="ghost" size="sm" asChild>
                    <Link href={`/crm/clients/${p.customer.id}`} data-testid="link-lightbox-client"><ExternalLink className="mr-1.5 h-4 w-4" />Client</Link>
                  </Button>
                )}
                <Button variant="outline" size="sm" asChild>
                  <a href={p.downloadUrl} data-testid="link-lightbox-download"><Download className="mr-1.5 h-4 w-4" />Original</a>
                </Button>
                <Button size="sm" variant={selected.has(p.id) ? "secondary" : "default"} onClick={() => onToggle(p)} data-testid="button-lightbox-select">
                  {selected.has(p.id) ? "Selected" : "Select"}
                </Button>
              </div>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function SaveToMediaDialog({ open, onOpenChange, ids, suggestedName, onDone }: {
  open: boolean; onOpenChange: (o: boolean) => void; ids: string[]; suggestedName: string; onDone: () => void;
}) {
  const { toast } = useToast();
  const [folders, setFolders] = useState<{ id: number; name: string }[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [folderId, setFolderId] = useState<string>("new");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    setError(null); setFolders(null); setName(suggestedName); setFolderId("new");
    fetch("/api/media/folders", { credentials: "include" })
      .then(async (r) => { if (!r.ok) throw new Error(await crmPhotoError(r)); return r.json(); })
      .then((f) => setFolders(f))
      .catch((e) => setError(String(e.message ?? e)));
  }, [open, suggestedName]);

  const save = async () => {
    setBusy(true);
    try {
      let fid = Number(folderId);
      if (folderId === "new") {
        if (!name.trim()) throw new Error("Name the new folder.");
        const r = await fetch("/api/media/folders", { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: name.trim() }) });
        if (!r.ok) throw new Error(await crmPhotoError(r));
        fid = (await r.json()).id;
      }
      const r = await fetch("/api/media/from-crm", { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ folderId: fid, ids }) });
      if (!r.ok) throw new Error(await crmPhotoError(r));
      const out = await r.json();
      toast({ title: `${out.count} photo${out.count === 1 ? "" : "s"} saved to the Media library`, description: out.skipped?.length ? `${out.skipped.length} skipped (file missing).` : "The Photo Optimizer, Google Reviews and your other tools can use them now." });
      onOpenChange(false);
      onDone();
    } catch (e: any) {
      toast({ title: "Could not save", description: String(e.message ?? e), variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md" data-testid="dialog-save-to-media">
        <DialogHeader>
          <DialogTitle>Save {ids.length} photo{ids.length === 1 ? "" : "s"} to the Media library</DialogTitle>
          <DialogDescription>Copies go into a Media library folder that every platform tool can open. The originals stay on the job.</DialogDescription>
        </DialogHeader>
        {error ? (
          <p className="text-sm text-muted-foreground" data-testid="text-media-error">{error}</p>
        ) : !folders ? (
          <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
        ) : (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Folder</Label>
              <Select value={folderId} onValueChange={setFolderId}>
                <SelectTrigger data-testid="select-media-folder"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="new">New folder…</SelectItem>
                  {folders.map((f) => <SelectItem key={f.id} value={String(f.id)}>{f.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            {folderId === "new" && (
              <div className="space-y-1.5">
                <Label htmlFor="media-folder-name">New folder name</Label>
                <Input id="media-folder-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Smith roof — finished" data-testid="input-media-folder-name" />
              </div>
            )}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={save} disabled={busy || !!error || !folders} data-testid="button-media-save">
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}<Camera className="mr-1.5 h-4 w-4" />Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
