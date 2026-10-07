import { Check, Eye, Play, Star, AlertCircle, Loader2 } from "lucide-react";
import { formatDuration, groupByDay, timeLabel, type JobcamMediaItem } from "@/lib/jobcam-api";
import { cn } from "@/lib/utils";

/**
 * The tiles: a square grid, or the same tiles grouped by day (newest first)
 * with a day header — Google-style hairlines, no card chrome. Every tile shows
 * the capture time; cross-project feeds also name the project. Corners:
 * top-left select, top-right client-visible eye + star, bottom row duration
 * (left) and tag chip (right) in ONE flex row so they can never overlap.
 */
export function MediaGrid({ items, view, selectable = false, selected, onToggle, onOpen, showProject = false, dense = false }: {
  items: JobcamMediaItem[];
  view: "grid" | "timeline";
  selectable?: boolean;
  selected?: Set<string>;
  onToggle?: (id: string) => void;
  onOpen: (index: number) => void;
  showProject?: boolean;
  dense?: boolean;
}) {
  const indexOf = new Map(items.map((m, i) => [m.id, i]));
  const tile = (m: JobcamMediaItem) => {
    const isSel = selected?.has(m.id) ?? false;
    const i = indexOf.get(m.id) ?? 0;
    return (
      <button key={m.id} type="button" data-testid={`jobcam-tile-${m.id}`}
        onClick={() => (selectable ? onToggle?.(m.id) : onOpen(i))}
        className={cn("group relative aspect-square overflow-hidden rounded-lg bg-muted text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-primary",
          isSel && "ring-2 ring-primary")}
        aria-pressed={selectable ? isSel : undefined} aria-label={`${m.kind} ${timeLabel(m.capturedAt)}${m.project && showProject ? ` · ${m.project.name}` : ""}${m.clientVisible ? " · visible to client" : ""}`}>
        {m.urls.thumb ? (
          <img src={m.urls.thumb} alt="" loading="lazy" decoding="async" className={cn("h-full w-full object-cover transition-transform", !selectable && "group-hover:scale-[1.03]", isSel && "opacity-80")} />
        ) : (
          <div className="h-full w-full flex items-center justify-center text-muted-foreground">
            {m.status === "failed" ? <AlertCircle className="h-5 w-5 text-destructive" /> : <Loader2 className="h-5 w-5 animate-spin" />}
          </div>
        )}
        <span className="absolute right-1.5 top-1.5 flex items-center gap-1">
          {m.clientVisible && (
            <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-emerald-600 text-white shadow" title="Visible to client" aria-label="Visible to client" data-testid={`jobcam-tile-client-visible-${m.id}`}>
              <Eye className="h-3 w-3" />
            </span>
          )}
          {m.starred && <Star className="h-4 w-4 fill-yellow-400 text-yellow-400 drop-shadow" />}
        </span>
        {m.status === "ready" && (
          <span className="absolute inset-x-1.5 bottom-1.5 flex items-end gap-1">
            {m.kind === "video" && (
              <span className="shrink-0 inline-flex items-center gap-1 rounded bg-black/60 px-1.5 py-0.5 text-[11px] font-medium leading-4 text-white">
                <Play className="h-3 w-3 fill-current" /> {formatDuration(m.durationS) || "video"}
              </span>
            )}
            {m.tags.length > 0 && !dense && (
              <span className="ml-auto min-w-0 truncate rounded bg-black/60 px-1.5 py-0.5 text-[10px] leading-4 text-white">{m.tags.length === 1 ? m.tags[0] : `${m.tags.length} tags`}</span>
            )}
          </span>
        )}
        {selectable && (
          <span className={cn("absolute left-1.5 top-1.5 h-6 w-6 rounded-full border-2 flex items-center justify-center", isSel ? "bg-primary border-primary text-primary-foreground" : "border-white bg-black/30")}>
            {isSel && <Check className="h-4 w-4" />}
          </span>
        )}
        {m.status !== "ready" && (
          <span className="absolute inset-x-0 bottom-0 bg-black/60 px-1.5 py-0.5 text-[10px] text-white truncate">{m.status === "failed" ? m.error || "Failed" : "Processing…"}</span>
        )}
      </button>
    );
  };
  const cols = dense ? "grid-cols-3 sm:grid-cols-6 md:grid-cols-8" : "grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6";
  if (view === "grid") {
    return <div className={cn("grid gap-1.5", cols)} data-testid="jobcam-grid">{items.map(tile)}</div>;
  }
  return (
    <div className="space-y-5" data-testid="jobcam-timeline">
      {groupByDay(items).map((g) => (
        <section key={g.key} data-testid={`jobcam-day-${g.key}`}>
          <h3 className="g-header__title !text-[16px] flex items-baseline gap-2 border-b border-[var(--g-divider)] pb-2 mb-2">
            {g.label}
            <span className="text-[12px] text-muted-foreground">{g.items.length} {g.items.length === 1 ? "item" : "items"}</span>
            {showProject && (
              <span className="ml-auto text-[12px] text-muted-foreground truncate">
                {[...new Set(g.items.map((m) => m.project?.name).filter(Boolean))].slice(0, 3).join(" · ")}
              </span>
            )}
          </h3>
          <div className={cn("grid gap-1.5", cols)}>{g.items.map(tile)}</div>
        </section>
      ))}
    </div>
  );
}
