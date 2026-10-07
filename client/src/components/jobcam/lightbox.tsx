import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import { ChevronLeft, ChevronRight, Download, Loader2, MapPin, Star, Trash2, X, User, Clock, FolderOpen, Info } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";
import { GooglePill } from "@/components/google";
import { TagPicker } from "./tag-picker";
import { dateTimeLabel, formatBytes, formatDuration, jobcamError, jobcamFetch, type JobcamMediaItem } from "@/lib/jobcam-api";
import { cn } from "@/lib/utils";

/**
 * Full-screen viewer: swipe (touch) / arrows / keys, video playback with the
 * transcode when the original can't play in browsers, and the details every
 * shot carries — capture time, uploader, a GPS pin link, tags, project.
 * Star / tag / caption / delete act through the API; `readOnly` (share pages,
 * the client portal) shows the details only and hides what the viewer can't do.
 */
export function Lightbox({ items, index, onIndex, onClose, readOnly = false, canEdit, onChanged, onDeleted, showDetails = true }: {
  items: JobcamMediaItem[];
  index: number;
  onIndex: (i: number) => void;
  onClose: () => void;
  readOnly?: boolean;
  canEdit?: (m: JobcamMediaItem) => boolean;
  onChanged?: (m: JobcamMediaItem) => void;
  onDeleted?: (id: string) => void;
  showDetails?: boolean;
}) {
  const { toast } = useToast();
  const m = items[index];
  const [info, setInfo] = useState(true);
  const [caption, setCaption] = useState(m?.caption ?? "");
  const touch = useRef<{ x: number; y: number } | null>(null);
  useEffect(() => { setCaption(m?.caption ?? ""); }, [m?.id, m?.caption]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight" && index < items.length - 1) onIndex(index + 1);
      if (e.key === "ArrowLeft" && index > 0) onIndex(index - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index, items.length, onClose, onIndex]);

  const patch = useMutation({
    mutationFn: (body: Record<string, unknown>) => jobcamFetch<JobcamMediaItem>(`/api/crm/jobcam/media/${m.id}`, { method: "PATCH", json: body }),
    onSuccess: (row) => { onChanged?.({ ...m, ...row }); queryClient.invalidateQueries({ queryKey: ["/api/crm/jobcam/tags"] }); },
    onError: (e) => toast({ title: "Could not save", description: jobcamError(e), variant: "destructive" }),
  });
  const del = useMutation({
    mutationFn: () => jobcamFetch(`/api/crm/jobcam/media/${m.id}`, { method: "DELETE" }),
    onSuccess: () => { toast({ title: "Deleted", description: "Removed from the project and from every shared link." }); onDeleted?.(m.id); },
    onError: (e) => toast({ title: "Could not delete", description: jobcamError(e), variant: "destructive" }),
  });
  if (!m) return null;
  const editable = !readOnly && (canEdit ? canEdit(m) : true);

  const onTouchStart = (e: React.TouchEvent) => { touch.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }; };
  const onTouchEnd = (e: React.TouchEvent) => {
    if (!touch.current) return;
    const dx = e.changedTouches[0].clientX - touch.current.x, dy = e.changedTouches[0].clientY - touch.current.y;
    touch.current = null;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      if (dx < 0 && index < items.length - 1) onIndex(index + 1);
      if (dx > 0 && index > 0) onIndex(index - 1);
    } else if (dy > 90 && Math.abs(dy) > Math.abs(dx) * 1.5) onClose();
  };
  const stampLines = [
    m.stamp?.time ? dateTimeLabel(m.capturedAt) : null,
    m.stamp?.gps && m.lat != null && m.lng != null ? `${m.lat.toFixed(5)}, ${m.lng.toFixed(5)}` : null,
    m.stamp?.project && m.project ? m.project.name : null,
  ].filter(Boolean) as string[];

  // Rendered on <body>: nested inside a page's own .g-surface the viewer's
  // background is made transparent (google.css) and the page shows through.
  return createPortal(
    <div className="g-surface fixed inset-0 z-[70] flex flex-col text-white" style={{ background: "#000" }} role="dialog" aria-modal="true" aria-label="Media viewer" data-testid="jobcam-lightbox">
      <header className="flex items-center gap-2 px-3 pt-[calc(env(safe-area-inset-top)+6px)] pb-2 text-[13px]">
        <button type="button" onClick={onClose} className="h-10 w-10 inline-flex items-center justify-center rounded-full bg-white/10" aria-label="Close" data-testid="jobcam-lightbox-close"><X className="h-5 w-5" /></button>
        <span className="tabular-nums text-white/70">{index + 1} / {items.length}</span>
        <span className="ml-auto flex items-center gap-1">
          {!readOnly && (
            <button type="button" onClick={() => patch.mutate({ starred: !m.starred })} className="h-10 w-10 inline-flex items-center justify-center rounded-full bg-white/10" aria-label={m.starred ? "Unstar" : "Star"} aria-pressed={m.starred} data-testid="jobcam-lightbox-star">
              <Star className={cn("h-5 w-5", m.starred && "fill-yellow-400 text-yellow-400")} />
            </button>
          )}
          <a href={`${m.urls.original}?download=1`} className="h-10 w-10 inline-flex items-center justify-center rounded-full bg-white/10" aria-label="Download original" data-testid="jobcam-lightbox-download"><Download className="h-5 w-5" /></a>
          {editable && (
            <button type="button" onClick={() => { if (window.confirm("Delete this from the project?")) del.mutate(); }} disabled={del.isPending} className="h-10 w-10 inline-flex items-center justify-center rounded-full bg-white/10" aria-label="Delete" data-testid="jobcam-lightbox-delete">
              {del.isPending ? <Loader2 className="h-5 w-5 animate-spin" /> : <Trash2 className="h-5 w-5" />}
            </button>
          )}
          <button type="button" onClick={() => setInfo((v) => !v)} className={cn("h-10 w-10 inline-flex items-center justify-center rounded-full bg-white/10", info && "text-[#8ab4f8]")} aria-label="Details" aria-pressed={info} data-testid="jobcam-lightbox-info"><Info className="h-5 w-5" /></button>
        </span>
      </header>

      <div className="relative flex-1 min-h-0 flex items-center justify-center select-none" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
        {m.kind === "video" ? (
          <video key={m.id} controls playsInline poster={m.urls.poster ?? undefined} src={m.urls.video ?? m.urls.original} className="max-h-full max-w-full" data-testid="jobcam-lightbox-video" />
        ) : (
          <img key={m.id} src={m.urls.display ?? m.urls.original} alt={m.caption ?? ""} className="max-h-full max-w-full object-contain" data-testid="jobcam-lightbox-image" />
        )}
        {stampLines.length > 0 && (
          <div className="pointer-events-none absolute bottom-3 right-3 rounded bg-black/55 px-2 py-1 text-[11px] font-mono leading-4" data-testid="jobcam-lightbox-stamp">
            {stampLines.map((l) => <div key={l}>{l}</div>)}
          </div>
        )}
        {index > 0 && (
          <button type="button" onClick={() => onIndex(index - 1)} className="absolute left-2 top-1/2 -translate-y-1/2 h-11 w-11 rounded-full bg-black/40 hidden sm:inline-flex items-center justify-center" aria-label="Previous" data-testid="jobcam-lightbox-prev"><ChevronLeft className="h-6 w-6" /></button>
        )}
        {index < items.length - 1 && (
          <button type="button" onClick={() => onIndex(index + 1)} className="absolute right-2 top-1/2 -translate-y-1/2 h-11 w-11 rounded-full bg-black/40 hidden sm:inline-flex items-center justify-center" aria-label="Next" data-testid="jobcam-lightbox-next"><ChevronRight className="h-6 w-6" /></button>
        )}
      </div>

      {info && showDetails && (
        <footer className="bg-[#1f1f1f] px-4 pt-3 pb-[calc(env(safe-area-inset-bottom)+12px)] text-[13px] space-y-2 max-h-[45dvh] overflow-y-auto" data-testid="jobcam-lightbox-details">
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-white/80">
            <span className="inline-flex items-center gap-1.5"><Clock className="h-4 w-4 opacity-70" /> {dateTimeLabel(m.capturedAt)}</span>
            {m.uploader && <span className="inline-flex items-center gap-1.5"><User className="h-4 w-4 opacity-70" /> {m.uploader.name}</span>}
            {m.mapUrl ? (
              <a href={m.mapUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-[#8ab4f8]" data-testid="jobcam-lightbox-map">
                <MapPin className="h-4 w-4" /> {m.lat!.toFixed(5)}, {m.lng!.toFixed(5)}{m.gpsAccuracyM ? ` ±${Math.round(m.gpsAccuracyM)} m` : ""} · {m.gpsSource === "exif" ? "from the file" : "from the phone"}
              </a>
            ) : <span className="inline-flex items-center gap-1.5 text-white/50"><MapPin className="h-4 w-4" /> no location</span>}
            {m.project && !readOnly && (
              <Link href={`/crm/projects/${m.project.id}/jobcam`} className="inline-flex items-center gap-1.5 text-[#8ab4f8]" data-testid="jobcam-lightbox-project"><FolderOpen className="h-4 w-4" /> {m.project.name}</Link>
            )}
            {m.project && readOnly && <span className="inline-flex items-center gap-1.5"><FolderOpen className="h-4 w-4 opacity-70" /> {m.project.name}</span>}
          </div>
          <div className="text-white/50 text-[12px]">
            {m.fileName} · {formatBytes(m.bytes)}{m.width && m.height ? ` · ${m.width}×${m.height}` : ""}{m.durationS ? ` · ${formatDuration(m.durationS)}` : ""}
          </div>
          {editable ? (
            <div className="flex flex-wrap items-center gap-2">
              <TagPicker value={m.tags} onChange={(tags) => patch.mutate({ tags })} dark testId="jobcam-lightbox-tags" />
              <input value={caption} onChange={(e) => setCaption(e.target.value)} onBlur={() => { if (caption !== (m.caption ?? "")) patch.mutate({ caption }); }}
                placeholder="Add a caption" className="flex-1 min-w-[160px] h-9 rounded-full border border-white/30 bg-black/40 px-3 text-white placeholder:text-white/40" data-testid="jobcam-lightbox-caption" />
            </div>
          ) : (
            <>
              {m.tags.length > 0 && <div className="flex flex-wrap gap-1.5">{m.tags.map((t) => <GooglePill key={t} size="sm" selected label={t} className="!cursor-default" />)}</div>}
              {m.caption && <p className="text-white/90">{m.caption}</p>}
            </>
          )}
        </footer>
      )}
    </div>,
    document.body,
  );
}
