import { useEffect, useId, useState, type ReactNode } from "react";
import { Info, PlayCircle } from "lucide-react";
import { Link } from "wouter";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { useIsMobile } from "@/hooks/use-mobile";
import { helpEntry, type HelpEntry, type HelpVideo } from "@shared/help/registry";
import { cn } from "@/lib/utils";

/**
 * The "i" next to a feature or a section of one, and the walkthrough-video slot beside it.
 *
 * Clicking the "i" opens a panel — a popover on a desktop, a bottom sheet on a phone — with four short
 * labelled parts (what it's for · what it does · how to run it · how it works) plus "Needs" when the entry
 * has prerequisites. All of it comes from the one help registry (shared/help/registry.ts); a key that is
 * not in it renders nothing, and server/help-registry.test.ts fails the build for it.
 *
 * Video: when the entry has a recorded walkthrough, a small play button sits beside the "i" and the panel
 * offers "Watch the walkthrough" (an HTML5 player in a dialog, captions track when there is one; nothing
 * about playback is remembered). While `video` is null there is NO play button on the page — only a quiet
 * "Video walkthrough coming soon" line inside the panel.
 *
 * Colours: the accent is the surface's `--g-accent` (the portalled panel is its own `.g-surface`, so the
 * tokens resolve there too). Nothing is hard-coded.
 *
 * Esc and outside clicks are handled here as well as by Radix, for the reason InfoTip gives: this app's
 * dismissable-layer version can ignore both on a layer's second mount. Both paths only set open=false.
 */

const PART = "text-[12px] font-medium uppercase tracking-wide g-text-2";

/** The four labelled parts (+ Needs) of one entry. Shared by the panel and the Tutorials page. */
export function HelpParts({ entry, className, testId }: { entry: HelpEntry; className?: string; testId?: string }) {
  return (
    <div className={cn("space-y-4 text-sm leading-relaxed", className)} data-testid={testId}>
      <section>
        <h4 className={PART}>What it’s for</h4>
        <p className="mt-1 g-text">{entry.whatItIs}</p>
      </section>
      <section>
        <h4 className={PART}>What it does</h4>
        <p className="mt-1 g-text">{entry.whatItDoes}</p>
      </section>
      <section>
        <h4 className={PART}>How to run it</h4>
        <ol className="mt-1 list-decimal space-y-1.5 pl-5 g-text marker:text-[var(--g-text-2)]">
          {entry.howToUse.map((step) => <li key={step} className="pl-0.5">{step}</li>)}
        </ol>
      </section>
      <section>
        <h4 className={PART}>How it works</h4>
        <p className="mt-1 g-text">{entry.howItWorks}</p>
      </section>
      {entry.needs && entry.needs.length > 0 && (
        <section>
          <h4 className={PART}>Needs</h4>
          <ul className="mt-1 list-disc space-y-1 pl-5 g-text marker:text-[var(--g-text-2)]">
            {entry.needs.map((n) => <li key={n} className="pl-0.5">{n}</li>)}
          </ul>
        </section>
      )}
    </div>
  );
}

/** mm:ss for a video's length. */
export const formatDuration = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, "0")}`;

const VIDEO_TYPES: Record<string, string> = { mp4: "video/mp4", webm: "video/webm" };

/**
 * The HTML5 player: controls, no autoplay, nothing stored. When the video has captions they are its
 * default text track — shown from the first frame (a walkthrough is often watched with the sound
 * off) and switchable from the player's own captions button.
 */
export function HelpVideoPlayer({ video, title, className, testId }: { video: HelpVideo; title: string; className?: string; testId?: string }) {
  return (
    <video
      className={cn("aspect-video w-full rounded-lg bg-black", className)}
      controls playsInline preload="metadata" poster={video.poster}
      aria-label={`Walkthrough video: ${title}`} data-testid={testId}
      // Some browsers load a default track but leave it hidden: turn the captions on once it is there.
      onLoadedMetadata={(e) => { const track = e.currentTarget.textTracks[0]; if (video.captions && track && track.mode === "disabled") track.mode = "showing"; }}
    >
      <source src={video.url} type={VIDEO_TYPES[video.url.slice(video.url.lastIndexOf(".") + 1)]} />
      {video.captions && <track kind="captions" src={video.captions} srcLang="en" label="English" default />}
      Your browser cannot play this video. <a href={video.url}>Download it</a> instead.
    </video>
  );
}

/** The player in a dialog. Unmounts (and so stops) when closed. */
export function HelpVideoDialog({ entry, open, onOpenChange }: { entry: HelpEntry; open: boolean; onOpenChange: (open: boolean) => void }) {
  if (!entry.video) return null;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="g-surface max-w-3xl" data-testid={`help-video-dialog-${entry.key}`}>
        <DialogHeader>
          <DialogTitle>{entry.title} — walkthrough</DialogTitle>
          <DialogDescription>{formatDuration(entry.video.durationSec)} · {entry.video.captions ? "captions available" : "no captions"}</DialogDescription>
        </DialogHeader>
        {open && <HelpVideoPlayer video={entry.video} title={entry.title} testId={`help-video-${entry.key}`} />}
      </DialogContent>
    </Dialog>
  );
}

const ICON_BUTTON = cn(
  "inline-flex h-11 w-11 -my-2.5 -mx-1.5 shrink-0 items-center justify-center rounded-full align-middle",
  "g-text-2 transition-colors hover:bg-[var(--g-accent-soft)] hover:text-[var(--g-accent-ink)]",
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-6px] focus-visible:outline-[var(--g-accent)]",
  "aria-expanded:bg-[var(--g-accent-soft)] aria-expanded:text-[var(--g-accent-ink)]",
);

function PanelBody({ entry, onWatch, footer }: { entry: HelpEntry; onWatch: () => void; footer?: ReactNode }) {
  return (
    <>
      <HelpParts entry={entry} testId={`help-body-${entry.key}`} />
      <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t pt-3" style={{ borderColor: "var(--g-divider)" }}>
        {entry.video ? (
          <button type="button" className="g-pill g-pill--sm" onClick={onWatch} data-testid={`help-watch-${entry.key}`}>
            <PlayCircle aria-hidden="true" /><span>Watch the walkthrough ({formatDuration(entry.video.durationSec)})</span>
          </button>
        ) : (
          <p className="text-[13px] g-text-2" data-testid={`help-video-soon-${entry.key}`}>Video walkthrough coming soon</p>
        )}
        {footer}
      </div>
    </>
  );
}

export function HelpButton({ k, className, tutorialsLink = true }: {
  /** A key of the help registry. */
  k: string;
  className?: string;
  /** Show "All tutorials" in the panel (off on the Tutorials page itself). */
  tutorialsLink?: boolean;
}) {
  const entry = helpEntry(k);
  const isMobile = useIsMobile();
  const [open, setOpen] = useState(false);
  const [watching, setWatching] = useState(false);
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    const inside = (t: EventTarget | null) =>
      !!(t as HTMLElement | null)?.closest?.(`[data-testid="help-panel-${k}"], [data-testid="help-button-${k}"]`);
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    const onDown = (e: PointerEvent) => { if (!inside(e.target)) setOpen(false); };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown, true);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDown, true);
    };
  }, [open, k]);

  if (!entry) return null;

  const trigger = (
    <button
      type="button"
      className={cn(ICON_BUTTON, className)}
      aria-label={`About ${entry.title}`}
      aria-haspopup="dialog"
      // Help can sit inside rows and tab strips — never let the click act on what wraps it.
      onClick={(e) => e.stopPropagation()}
      data-testid={`help-button-${k}`}
    >
      <Info className="h-4 w-4" strokeWidth={1.8} aria-hidden="true" />
    </button>
  );
  const watch = () => { setOpen(false); setWatching(true); };
  const footer = tutorialsLink
    ? <Link href={`/tutorials#help-${(entry.parent ?? entry.key)}`} className="g-link text-[13px]" onClick={() => setOpen(false)} data-testid={`help-all-${k}`}>All tutorials</Link>
    : undefined;

  return (
    <span className="inline-flex items-center align-middle">
      {isMobile ? (
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger asChild>{trigger}</SheetTrigger>
          <SheetContent side="bottom" className="g-surface max-h-[85dvh] overflow-y-auto rounded-t-2xl p-5 pb-8" data-testid={`help-panel-${k}`}>
            <SheetHeader className="mb-3 pr-8 text-left">
              <SheetTitle className="text-[18px] font-normal g-text" data-testid={`help-title-${k}`}>{entry.title}</SheetTitle>
              <SheetDescription className="sr-only">What it’s for, what it does, how to run it and how it works.</SheetDescription>
            </SheetHeader>
            <PanelBody entry={entry} onWatch={watch} footer={footer} />
          </SheetContent>
        </Sheet>
      ) : (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>{trigger}</PopoverTrigger>
          <PopoverContent
            role="dialog" aria-labelledby={titleId} align="start" sideOffset={6} collisionPadding={12}
            className="g-surface w-[min(26rem,calc(100vw-1.5rem))] max-h-[min(34rem,var(--radix-popover-content-available-height))] overflow-y-auto rounded-xl p-5"
            data-testid={`help-panel-${k}`}
          >
            <h3 id={titleId} className="mb-3 text-[18px] leading-6 g-text" data-testid={`help-title-${k}`}>{entry.title}</h3>
            <PanelBody entry={entry} onWatch={watch} footer={footer} />
          </PopoverContent>
        </Popover>
      )}
      {entry.video && (
        <>
          <button type="button" className={ICON_BUTTON} aria-label={`Watch the walkthrough: ${entry.title}`}
            onClick={(e) => { e.stopPropagation(); setWatching(true); }} data-testid={`help-play-${k}`}>
            <PlayCircle className="h-4 w-4" strokeWidth={1.8} aria-hidden="true" />
          </button>
          <HelpVideoDialog entry={entry} open={watching} onOpenChange={setWatching} />
        </>
      )}
    </span>
  );
}
