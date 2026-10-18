/**
 * CRM project photos for any page: a selectable grid (CrmPhotoGrid), a job
 * list (CrmPhotoJobList) and the dialog that combines them (CrmPhotoPicker) —
 * used by the CRM Photos page, the Photo Optimizer and the Google Reviews
 * request composer. Data: /api/crm/photos and /api/crm/photos/jobs
 * (server/crm/photo-library.ts), which only ever return what the signed-in
 * CRM member may see.
 */
import { useEffect, useMemo, useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Camera, CheckCircle2, ChevronLeft, ImageIcon, Images, LayoutGrid, Loader2, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import {
  CRM_PHOTO_TABS, fetchCrmJson, photosQuery, stageLabel,
  type CrmPhoto, type CrmPhotoFacets, type CrmPhotoFilter, type CrmPhotoJob, type CrmPhotoJobsPage, type CrmPhotoPage,
} from "@/lib/crm-photos";

export function StageBadge({ photo, className }: { photo: Pick<CrmPhoto, "stage" | "source">; className?: string }) {
  const tone = photo.stage === "finished" ? "bg-emerald-600/90" : photo.stage === "progress" ? "bg-amber-600/90"
    : photo.stage === "punchlist" ? "bg-rose-600/90" : photo.source === "hover" ? "bg-sky-700/90" : "bg-violet-600/90";
  return (
    <span className={cn("rounded px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-white", tone, className)}>
      {stageLabel(photo)}
    </span>
  );
}

/** A thumbnail that falls back to an icon when the format has no preview (iPhone HEIC). */
export function PhotoThumb({ src, alt, className }: { src: string; alt: string; className?: string }) {
  const [broken, setBroken] = useState(false);
  if (broken) {
    return <div className={cn("flex items-center justify-center bg-muted text-muted-foreground", className)}><ImageIcon className="h-5 w-5" aria-hidden="true" /></div>;
  }
  return <img src={src} alt={alt} loading="lazy" decoding="async" onError={() => setBroken(true)} className={cn("object-cover", className)} />;
}

export function StageTabs({ value, onChange, facets, testPrefix = "tab-photo-stage" }: {
  value: CrmPhotoFilter; onChange: (v: CrmPhotoFilter) => void; facets?: Partial<CrmPhotoFacets>; testPrefix?: string;
}) {
  return (
    <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Photo stage">
      {CRM_PHOTO_TABS.map((t) => (
        <button
          key={t.key}
          type="button"
          role="tab"
          aria-selected={value === t.key}
          onClick={() => onChange(t.key)}
          className={cn(
            "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
            value === t.key ? "border-primary bg-primary text-primary-foreground" : "bg-background text-muted-foreground hover:text-foreground",
          )}
          data-testid={`${testPrefix}-${t.key}`}
        >
          {t.label}
          {facets?.[t.key] !== undefined && <span className="ml-1 opacity-75">{facets[t.key]!.toLocaleString()}</span>}
        </button>
      ))}
    </div>
  );
}

export function useCrmPhotos(params: Record<string, string | undefined>, enabled = true) {
  const key = `/api/crm/photos${photosQuery(params)}`;
  return useInfiniteQuery<CrmPhotoPage>({
    queryKey: [key, "pages"],
    enabled,
    initialPageParam: 0,
    queryFn: ({ pageParam }) => fetchCrmJson<CrmPhotoPage>(`/api/crm/photos${photosQuery({ ...params, offset: Number(pageParam) || undefined })}`),
    getNextPageParam: (last) => last.nextOffset ?? undefined,
  });
}

export function useCrmPhotoJobs(params: Record<string, string | undefined>, enabled = true) {
  return useInfiniteQuery<CrmPhotoJobsPage>({
    queryKey: [`/api/crm/photos/jobs${photosQuery(params)}`, "pages"],
    enabled,
    initialPageParam: 0,
    queryFn: ({ pageParam }) => fetchCrmJson<CrmPhotoJobsPage>(`/api/crm/photos/jobs${photosQuery({ ...params, offset: Number(pageParam) || undefined })}`),
    getNextPageParam: (last) => last.nextOffset ?? undefined,
  });
}

/**
 * A selectable photo grid over /api/crm/photos. `selected` holds photo ids;
 * `max` caps the selection (the tool's own limit). onOpen (optional) opens a
 * photo instead of toggling it when the tile itself is clicked.
 */
export function CrmPhotoGrid({
  params, selected, onToggle, max, onOpen, onFacets, showClient = true, dense = false, emptyText, testId = "crm-photo-grid",
}: {
  params: Record<string, string | undefined>;
  selected: Map<string, CrmPhoto>;
  onToggle: (p: CrmPhoto) => void;
  max?: number;
  onOpen?: (p: CrmPhoto, all: CrmPhoto[]) => void;
  onFacets?: (f: CrmPhotoFacets, total: number) => void;
  showClient?: boolean;
  dense?: boolean;
  emptyText?: string;
  testId?: string;
}) {
  const q = useCrmPhotos(params);
  const photos = useMemo(() => q.data?.pages.flatMap((p) => p.photos) ?? [], [q.data]);
  const first = q.data?.pages[0];
  useEffect(() => { if (first) onFacets?.(first.facets, first.total); }, [first]); // eslint-disable-line react-hooks/exhaustive-deps

  if (q.isLoading) return <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-label="Loading photos" /></div>;
  if (q.error) return <p className="py-8 text-center text-sm text-muted-foreground" data-testid={`${testId}-error`}>{String((q.error as Error).message)}</p>;
  if (!photos.length) {
    return (
      <div className="py-10 text-center text-sm text-muted-foreground" data-testid={`${testId}-empty`}>
        <Camera className="mx-auto mb-2 h-6 w-6 opacity-40" aria-hidden="true" />
        {emptyText ?? "No photos match."}
      </div>
    );
  }
  const full = max !== undefined && selected.size >= max;
  return (
    <div className="space-y-3">
      <div className={cn("grid gap-2", dense ? "grid-cols-4 sm:grid-cols-5" : "grid-cols-3 sm:grid-cols-4 md:grid-cols-6")} data-testid={testId}>
        {photos.map((p) => {
          const on = selected.has(p.id);
          return (
            <div key={p.id} className={cn("group relative aspect-square overflow-hidden rounded-lg border-2 bg-muted/30",
              on ? "border-primary ring-2 ring-primary/30" : "border-transparent hover:border-primary/40")} data-testid={`crm-photo-${p.id}`}>
              <button type="button" className="absolute inset-0 h-full w-full" aria-pressed={on}
                aria-label={`${on ? "Unselect" : "Select"} ${p.fileName}${p.customer ? ` — ${p.customer.name}` : ""}`}
                disabled={!on && full && !onOpen}
                onClick={() => (onOpen ? onOpen(p, photos) : onToggle(p))}>
                <PhotoThumb src={p.thumbUrl} alt={p.fileName} className="h-full w-full" />
              </button>
              <button
                type="button"
                onClick={() => onToggle(p)}
                disabled={!on && full}
                className={cn("absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full border text-white shadow-sm transition-opacity",
                  on ? "border-primary bg-primary" : "border-white/80 bg-black/40 [@media(hover:hover)]:opacity-0 group-hover:opacity-100 focus-visible:opacity-100")}
                aria-label={on ? `Unselect ${p.fileName}` : `Select ${p.fileName}`}
                data-testid={`button-select-photo-${p.id}`}
              >
                {on ? <CheckCircle2 className="h-4 w-4" aria-hidden="true" /> : <span className="h-3 w-3 rounded-full border border-white/90" />}
              </button>
              <StageBadge photo={p} className="pointer-events-none absolute bottom-1 left-1" />
              {showClient && p.customer && !dense && (
                <span className="pointer-events-none absolute bottom-1 right-1 max-w-[55%] truncate rounded bg-black/55 px-1 text-[9px] text-white">{p.customer.name}</span>
              )}
            </div>
          );
        })}
      </div>
      {q.hasNextPage && (
        <div className="flex justify-center">
          <Button variant="outline" size="sm" onClick={() => q.fetchNextPage()} disabled={q.isFetchingNextPage} data-testid={`${testId}-more`}>
            {q.isFetchingNextPage && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Load more ({photos.length.toLocaleString()} of {(first?.total ?? 0).toLocaleString()})
          </Button>
        </div>
      )}
    </div>
  );
}

/** Job cards (one per client with photos): cover, name, counts. */
export function CrmPhotoJobList({ params, onPick, compact = false }: {
  params: Record<string, string | undefined>; onPick: (j: CrmPhotoJob) => void; compact?: boolean;
}) {
  const q = useCrmPhotoJobs(params);
  const jobs = q.data?.pages.flatMap((p) => p.jobs) ?? [];
  if (q.isLoading) return <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-label="Loading jobs" /></div>;
  if (q.error) return <p className="py-8 text-center text-sm text-muted-foreground" data-testid="crm-photo-jobs-error">{String((q.error as Error).message)}</p>;
  if (!jobs.length) return <p className="py-10 text-center text-sm text-muted-foreground" data-testid="crm-photo-jobs-empty">No jobs with photos match.</p>;
  return (
    <div className="space-y-3">
      <div className={cn("grid gap-3", compact ? "grid-cols-2 sm:grid-cols-3" : "grid-cols-2 sm:grid-cols-3 lg:grid-cols-4")} data-testid="crm-photo-jobs">
        {jobs.map((j) => (
          <button key={j.customer.id} type="button" onClick={() => onPick(j)}
            className="overflow-hidden rounded-xl border bg-card text-left transition-colors hover:border-primary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            data-testid={`crm-photo-job-${j.customer.id}`}>
            <div className="aspect-[4/3] bg-muted/40">
              {j.cover ? <PhotoThumb src={j.cover.thumbUrl} alt="" className="h-full w-full" />
                : <div className="flex h-full items-center justify-center text-muted-foreground"><Images className="h-6 w-6" aria-hidden="true" /></div>}
            </div>
            <div className="space-y-0.5 p-2.5">
              <p className="truncate text-sm font-medium">{j.customer.name}</p>
              <p className="truncate text-xs text-muted-foreground">{j.project ? j.project.name : j.customer.address ?? "No job yet"}{j.projectCount > 1 ? ` +${j.projectCount - 1} more` : ""}</p>
              <p className="text-xs text-muted-foreground">
                <span className="font-medium text-foreground">{j.counts.all.toLocaleString()}</span> photo{j.counts.all === 1 ? "" : "s"}
                {j.counts.finished ? ` · ${j.counts.finished} finished` : ""}{j.counts.progress ? ` · ${j.counts.progress} in progress` : ""}
              </p>
            </div>
          </button>
        ))}
      </div>
      {q.hasNextPage && (
        <div className="flex justify-center">
          <Button variant="outline" size="sm" onClick={() => q.fetchNextPage()} disabled={q.isFetchingNextPage} data-testid="crm-photo-jobs-more">
            {q.isFetchingNextPage && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Load more jobs
          </Button>
        </div>
      )}
    </div>
  );
}

/**
 * The "CRM project photos" source for platform tools: browse by job or all
 * photos, by stage, tick up to `max`, then onPick. Nothing is copied here;
 * the caller hands the ids to its own gated route.
 */
export function CrmPhotoPicker({ open, onOpenChange, max, onPick, title = "CRM project photos", description, confirmLabel = "Use photos", busy = false, only }: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  max: number;
  onPick: (photos: CrmPhoto[]) => void;
  title?: string;
  description?: string;
  confirmLabel?: string;
  busy?: boolean;
  /** Locks the picker to ONE client's job photos (the review composer with a client picked): no other job is listed. */
  only?: { id: string; name: string } | null;
}) {
  const [view, setView] = useState<"jobs" | "all">("jobs");
  const [job, setJob] = useState<CrmPhotoJob | null>(null);
  const [stage, setStage] = useState<CrmPhotoFilter>("all");
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");
  const [facets, setFacets] = useState<CrmPhotoFacets | undefined>();
  const [selected, setSelected] = useState<Map<string, CrmPhoto>>(new Map());
  useEffect(() => {
    if (open) { setSelected(new Map()); setJob(only ? { customer: { id: only.id, name: only.name } } as CrmPhotoJob : null); }
  }, [open, only?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { const t = setTimeout(() => setQ(search.trim()), 300); return () => clearTimeout(t); }, [search]);
  const toggle = (p: CrmPhoto) => setSelected((prev) => {
    const next = new Map(prev);
    if (next.has(p.id)) next.delete(p.id); else if (next.size < max) next.set(p.id, p);
    return next;
  });
  const gridParams = { stage, customerId: job?.customer.id, q: job ? undefined : q || undefined };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] max-w-3xl overflow-y-auto" data-testid="modal-crm-photo-picker">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Camera className="h-4 w-4" aria-hidden="true" />{title}</DialogTitle>
          <DialogDescription>{description ?? "Photos from your CRM jobs: crew shots, HOVER captures and photos your clients shared."}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            {only ? null : job ? (
              <Button variant="ghost" size="sm" onClick={() => setJob(null)} data-testid="button-picker-back-to-jobs">
                <ChevronLeft className="mr-1 h-4 w-4" />All jobs
              </Button>
            ) : (
              <div className="inline-flex rounded-md border p-0.5" role="group" aria-label="View">
                <Button size="sm" variant={view === "jobs" ? "secondary" : "ghost"} className="h-7" onClick={() => setView("jobs")} data-testid="button-picker-view-jobs">
                  <LayoutGrid className="mr-1 h-3.5 w-3.5" />By job
                </Button>
                <Button size="sm" variant={view === "all" ? "secondary" : "ghost"} className="h-7" onClick={() => setView("all")} data-testid="button-picker-view-all">
                  <Images className="mr-1 h-3.5 w-3.5" />All photos
                </Button>
              </div>
            )}
            {job ? <p className="truncate text-sm font-semibold">{only ? `${job.customer.name}'s job photos` : job.customer.name}</p> : (
              <div className="relative min-w-[12rem] flex-1">
                <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" aria-hidden="true" />
                <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search client or address" className="h-9 pl-8"
                  aria-label="Search client or address" data-testid="input-picker-search" />
              </div>
            )}
          </div>
          <StageTabs value={stage} onChange={setStage} facets={view === "all" || job ? facets : undefined} testPrefix="tab-picker-stage" />
          {view === "jobs" && !job ? (
            <CrmPhotoJobList params={{ stage, q: q || undefined }} onPick={setJob} compact />
          ) : (
            <CrmPhotoGrid params={gridParams} selected={selected} onToggle={toggle} max={max} dense
              onFacets={(f) => setFacets(f)} showClient={!job} testId="picker-photo-grid" />
          )}
        </div>
        <div className="sticky bottom-0 -mx-6 -mb-6 flex items-center justify-between gap-2 border-t bg-background px-6 py-3">
          <p className="text-xs text-muted-foreground" data-testid="text-picker-selected">{selected.size} of {max} selected</p>
          <Button onClick={() => onPick([...selected.values()])} disabled={!selected.size || busy} data-testid="button-picker-confirm">
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{confirmLabel}{selected.size ? ` (${selected.size})` : ""}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
