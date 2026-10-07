import { useEffect, useMemo, useRef, useState } from "react";
import { useInfiniteQuery, useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Camera, CheckSquare, Grid3X3, Image as ImageIcon, Loader2, Rows3, Search, Star, Video, X, Trash2, Tag as TagIcon, Share2, CalendarDays, Eye, EyeOff } from "lucide-react";
import { GooglePill, GoogleSectionHeader } from "@/components/google";
import { EmptyState } from "@/components/crm-ui";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";
import { jobcamError, jobcamFetch, JOBCAM_USAGE_KEY, type JobcamMediaItem } from "@/lib/jobcam-api";
import { StorageMeter, useJobcamStorage } from "./storage-meter";
import { JobcamUpgradeCard, useJobcamAccess } from "./upgrade-card";
import { MediaGrid } from "./media-grid";
import { Lightbox } from "./lightbox";
import { TagPicker } from "./tag-picker";
import { UploadTray } from "./upload-tray";
import { useJobcamQueue } from "./use-queue";
import { cn } from "@/lib/utils";

export type FeedFilters = {
  tags: string[]; mode: "and" | "or"; starred: boolean; kind: "" | "photo" | "video"; q: string; from: string; to: string;
};
const EMPTY: FeedFilters = { tags: [], mode: "and", starred: false, kind: "", q: "", from: "", to: "" };

export function feedUrl(f: FeedFilters, scope: { projectId?: string; customerId?: string }, limit: number, before?: string | null): string {
  const p = new URLSearchParams();
  if (scope.projectId) p.set("projectId", scope.projectId);
  if (scope.customerId) p.set("customerId", scope.customerId);
  if (f.tags.length) { p.set("tags", f.tags.join(",")); p.set("mode", f.mode); }
  if (f.starred) p.set("starred", "1");
  if (f.kind) p.set("kind", f.kind);
  if (f.q.trim()) p.set("q", f.q.trim());
  if (f.from) p.set("from", new Date(`${f.from}T00:00:00`).toISOString());
  if (f.to) p.set("to", new Date(`${f.to}T23:59:59.999`).toISOString());
  p.set("limit", String(limit));
  if (before) p.set("before", before);
  return `/api/crm/jobcam/media?${p.toString()}`;
}

/** Every JobCam feed invalidates through this prefix after an upload lands or a bulk action runs. */
export const FEED_KEY_PREFIX = "/api/crm/jobcam/media";
export function invalidateFeeds() {
  queryClient.invalidateQueries({ predicate: (q) => typeof q.queryKey[0] === "string" && (q.queryKey[0] as string).startsWith(FEED_KEY_PREFIX) });
  // Whatever changed the feed (an upload landed, something was deleted) changed the storage meter too.
  queryClient.invalidateQueries({ queryKey: [JOBCAM_USAGE_KEY] });
}

/**
 * The feed: grid or day-grouped timeline, newest first; tag filters (AND/OR),
 * starred, photos/videos, date range, free-text search; bulk select with
 * star/tag/show-or-hide-for-the-client/delete; the lightbox. `projectId` scopes it to one job,
 * `customerId` to one client's jobs, neither = the company-wide Recent feed.
 */
export function JobcamFeed(props: Parameters<typeof JobcamFeedInner>[0]) {
  // No JobCam on the CRM plan: the place stays, the upgrade card stands in for the feed and the camera.
  const access = useJobcamAccess();
  if (access.loading) return <div className="py-10 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;
  if (!access.entitled) return <JobcamUpgradeCard />;
  return <JobcamFeedInner {...props} />;
}

function JobcamFeedInner({ projectId, customerId, compact = false, title, description, actions, canManage = false, memberId, onShare }: {
  projectId?: string;
  customerId?: string;
  /** A short strip (no filters, first page only) for the project tab / client page. */
  compact?: boolean;
  title?: string;
  description?: string;
  actions?: React.ReactNode;
  /** manageJobs/manageCustomers: may delete/retag other people's shots. */
  canManage?: boolean;
  memberId?: string | null;
  onShare?: (selectedIds: string[]) => void;
}) {
  const { toast } = useToast();
  const [filters, setFilters] = useState<FeedFilters>(EMPTY);
  const [view, setView] = useState<"grid" | "timeline">(() => (localStorage.getItem("jobcam.view") as "grid" | "timeline") || "grid");
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<number | null>(null);
  const [draftQ, setDraftQ] = useState("");
  const [showDates, setShowDates] = useState(false);
  const limit = compact ? 18 : 60;
  useEffect(() => { localStorage.setItem("jobcam.view", view); }, [view]);
  // Search is applied on Enter / after a pause, so each keystroke doesn't hit the API.
  useEffect(() => { const t = setTimeout(() => setFilters((f) => (f.q === draftQ ? f : { ...f, q: draftQ })), 350); return () => clearTimeout(t); }, [draftQ]);

  const scope = { projectId, customerId };
  const firstUrl = feedUrl(filters, scope, limit);
  const feed = useInfiniteQuery<{ media: JobcamMediaItem[]; nextCursor: string | null }>({
    queryKey: [firstUrl],
    queryFn: ({ pageParam }) => jobcamFetch(feedUrl(filters, scope, limit, pageParam as string | null)),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
  });
  const items = useMemo(() => feed.data?.pages.flatMap((p) => p.media) ?? [], [feed.data]);

  // When the queue finishes something, the feed refreshes itself.
  const queue = useJobcamQueue();
  const doneCount = queue.filter((q) => q.status === "done").length;
  const lastDone = useRef(doneCount);
  useEffect(() => { if (doneCount !== lastDone.current) { lastDone.current = doneCount; invalidateFeeds(); } }, [doneCount]);

  const bulk = useMutation({
    mutationFn: (body: { ids: string[]; action: string; tags?: string[] }) => jobcamFetch<{ changed: number; skipped: number }>("/api/crm/jobcam/media/bulk", { method: "POST", json: body }),
    onSuccess: (r, v) => {
      invalidateFeeds();
      queryClient.invalidateQueries({ queryKey: ["/api/crm/jobcam/tags"] });
      toast({ title: `${r.changed} ${v.action === "delete" ? "deleted" : v.action === "client_show" ? "now visible to the client" : v.action === "client_hide" ? "hidden from the client" : "updated"}`, description: r.skipped ? `${r.skipped} skipped — not yours to change.` : undefined });
      if (v.action === "delete") { setSelected(new Set()); setSelecting(false); }
    },
    onError: (e) => toast({ title: "Bulk action failed", description: jobcamError(e), variant: "destructive" }),
  });
  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const canEdit = (m: JobcamMediaItem) => canManage || (!!memberId && m.uploader?.id === memberId);
  const active = filters.tags.length > 0 || filters.starred || !!filters.kind || !!filters.q || !!filters.from || !!filters.to;
  const captureHref = `/crm/jobcam/capture${projectId ? `?project=${projectId}` : ""}`;
  // At the storage limit the camera and upload actions say so instead of opening.
  const storage = useJobcamStorage();
  const storageFull = storage.data?.full === true;
  const cameraPill = (testId: string) => storageFull
    ? <GooglePill size="sm" variant="grey" icon={Camera} label="Storage full" disabled title="JobCam storage is full" testId={`${testId}-full`} />
    : <GooglePill size="sm" variant="solid" icon={Camera} label="Open camera" href={captureHref} testId={testId} />;

  return (
    <section className="g-surface space-y-3" data-testid={`jobcam-feed${projectId ? "-project" : customerId ? "-customer" : "-recent"}`}>
      {(title || actions) && (
        <GoogleSectionHeader title={title ?? "JobCam"} description={description} count={items.length ? (feed.hasNextPage ? `${items.length}+` : items.length) : null}
          actions={<>
            {actions}
            {!compact && (
              <>
                <GooglePill size="sm" icon={view === "grid" ? Rows3 : Grid3X3} label={view === "grid" ? "Timeline" : "Grid"} onClick={() => setView(view === "grid" ? "timeline" : "grid")} testId="jobcam-view-toggle" />
                <GooglePill size="sm" icon={selecting ? X : CheckSquare} label={selecting ? "Done" : "Select"} selected={selecting} onClick={() => { setSelecting(!selecting); setSelected(new Set()); }} testId="jobcam-select-toggle" />
              </>
            )}
            {cameraPill("jobcam-open-camera")}
          </>} />
      )}

      {!compact && (
        <div className="flex flex-wrap items-center gap-2" data-testid="jobcam-filters">
          <label className="relative flex-1 min-w-[180px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input value={draftQ} onChange={(e) => setDraftQ(e.target.value)} placeholder={projectId ? "Search tags, captions, people" : "Search projects, addresses, tags, people"} className="g-input pl-9 h-9" data-testid="jobcam-search" />
          </label>
          <TagPicker value={filters.tags} onChange={(tags) => setFilters({ ...filters, tags })} mode={filters.mode} onMode={(mode) => setFilters({ ...filters, mode })} label="Tags" testId="jobcam-filter-tags" />
          <GooglePill size="sm" icon={Star} label="Starred" selected={filters.starred} onClick={() => setFilters({ ...filters, starred: !filters.starred })} ariaPressed={filters.starred} testId="jobcam-filter-starred" />
          <GooglePill size="sm" icon={ImageIcon} label="Photos" selected={filters.kind === "photo"} onClick={() => setFilters({ ...filters, kind: filters.kind === "photo" ? "" : "photo" })} testId="jobcam-filter-photos" />
          <GooglePill size="sm" icon={Video} label="Videos" selected={filters.kind === "video"} onClick={() => setFilters({ ...filters, kind: filters.kind === "video" ? "" : "video" })} testId="jobcam-filter-videos" />
          <GooglePill size="sm" icon={CalendarDays} label={filters.from || filters.to ? `${filters.from || "…"} → ${filters.to || "…"}` : "Dates"} selected={!!(filters.from || filters.to)} onClick={() => setShowDates((v) => !v)} testId="jobcam-filter-dates" />
          {active && <GooglePill size="sm" variant="quiet" icon={X} label="Clear" onClick={() => { setFilters(EMPTY); setDraftQ(""); }} testId="jobcam-filter-clear" />}
          {showDates && (
            <div className="w-full flex flex-wrap items-center gap-2 text-sm" data-testid="jobcam-date-range">
              <input type="date" value={filters.from} max={filters.to || undefined} onChange={(e) => setFilters({ ...filters, from: e.target.value })} className="g-input h-9 w-auto" aria-label="From" data-testid="jobcam-date-from" />
              <span className="text-muted-foreground">to</span>
              <input type="date" value={filters.to} min={filters.from || undefined} onChange={(e) => setFilters({ ...filters, to: e.target.value })} className="g-input h-9 w-auto" aria-label="To" data-testid="jobcam-date-to" />
            </div>
          )}
        </div>
      )}

      {(!compact || storageFull) && <StorageMeter />}

      {queue.some((q) => q.status !== "done") && <UploadTray />}

      {selecting && selected.size > 0 && (
        <div className="sticky top-12 z-20 flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card/95 backdrop-blur px-3 py-2 text-sm shadow-sm" data-testid="jobcam-bulk-bar">
          <span className="font-medium tabular-nums">{selected.size} selected</span>
          <GooglePill size="sm" icon={Star} label="Star" onClick={() => bulk.mutate({ ids: [...selected], action: "star" })} testId="jobcam-bulk-star" />
          <GooglePill size="sm" icon={Star} label="Unstar" onClick={() => bulk.mutate({ ids: [...selected], action: "unstar" })} testId="jobcam-bulk-unstar" />
          <BulkTag onApply={(tags, remove) => bulk.mutate({ ids: [...selected], action: remove ? "untag" : "tag", tags })} />
          <GooglePill size="sm" icon={Eye} label="Show to client" onClick={() => bulk.mutate({ ids: [...selected], action: "client_show" })} testId="jobcam-bulk-client-show" />
          <GooglePill size="sm" icon={EyeOff} label="Hide from client" onClick={() => bulk.mutate({ ids: [...selected], action: "client_hide" })} testId="jobcam-bulk-client-hide" />
          {onShare && <GooglePill size="sm" icon={Share2} label="Share these" onClick={() => onShare([...selected])} testId="jobcam-bulk-share" />}
          <GooglePill size="sm" variant="danger" icon={Trash2} label="Delete" onClick={() => { if (window.confirm(`Delete ${selected.size} item(s)?`)) bulk.mutate({ ids: [...selected], action: "delete" }); }} testId="jobcam-bulk-delete" />
          <button type="button" onClick={() => setSelected(new Set(items.map((m) => m.id)))} className="ml-auto text-xs text-primary" data-testid="jobcam-bulk-all">Select all loaded</button>
          {bulk.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
        </div>
      )}

      {feed.isLoading ? (
        <div className="py-10 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
      ) : feed.isError ? (
        <p className="text-sm text-destructive" role="alert">Couldn't load the feed. {jobcamError(feed.error)}</p>
      ) : !items.length ? (
        <EmptyState compact icon={Camera} title={active ? "Nothing matches those filters" : "No photos or videos yet"}
          description={active ? "Clear a filter or widen the dates." : storageFull ? "Storage is full — free up space or request more to add photos and video." : "Open the camera — every shot lands in this job with its time and location."}
          action={!active && !storageFull ? <Link href={captureHref}><GooglePill variant="solid" icon={Camera} label="Open camera" testId="jobcam-empty-camera" /></Link> : undefined} />
      ) : (
        <>
          <MediaGrid items={items} view={compact ? "grid" : view} selectable={selecting} selected={selected} onToggle={toggle} onOpen={setOpen} showProject={!projectId} dense={compact} />
          {!compact && feed.hasNextPage && (
            <div className="flex justify-center pt-2">
              <GooglePill label={feed.isFetchingNextPage ? "Loading…" : "Load more"} disabled={feed.isFetchingNextPage} onClick={() => void feed.fetchNextPage()} testId="jobcam-load-more" />
            </div>
          )}
        </>
      )}

      {open !== null && items[open] && (
        <Lightbox items={items} index={open} onIndex={setOpen} onClose={() => setOpen(null)} canEdit={canEdit}
          onChanged={() => invalidateFeeds()}
          onDeleted={() => { invalidateFeeds(); setOpen(open > 0 ? open - 1 : null); }} />
      )}
    </section>
  );
}

function BulkTag({ onApply }: { onApply: (tags: string[], remove: boolean) => void }) {
  const [tags, setTags] = useState<string[]>([]);
  return (
    <span className="inline-flex items-center gap-1">
      <TagPicker value={tags} onChange={setTags} label="Tags…" testId="jobcam-bulk-tags" />
      {tags.length > 0 && (
        <>
          <GooglePill size="sm" icon={TagIcon} label="Add" onClick={() => { onApply(tags, false); setTags([]); }} testId="jobcam-bulk-tag-add" />
          <GooglePill size="sm" variant="quiet" label="Remove" onClick={() => { onApply(tags, true); setTags([]); }} testId="jobcam-bulk-tag-remove" />
        </>
      )}
    </span>
  );
}

/** Project pickers and headers share this: the org's own tag list, for display. */
export function useJobcamTags() {
  return useQuery<{ id: string; name: string; color: string | null; count: number }[]>({ queryKey: ["/api/crm/jobcam/tags"] });
}

export const feedClass = cn;
