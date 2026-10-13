/**
 * The intro film at the top of a feature page, and the same player on the landing page.
 *
 * `IntroVideoFrame` is the player: a framed 16:9 poster with one orange play button and the
 * film's length; pressing it swaps in the HTML5 player (help-button.tsx HelpVideoPlayer) with
 * captions showing, and playback starts from that press — never before, so nothing plays or
 * sounds on its own. `FeatureIntroVideo` is the band directly under a feature page's hero
 * (owner, 2026-10-11: "towards the top of the page"), which renders nothing while the feature has
 * no uploaded intro (shared/feature-pages/intro-video.ts).
 *
 * Colours are the editorial tokens (mkt-*), so dark mode comes with them; the frame is the
 * ScreensSection's. The poster is decorative for assistive tech — the button's label says what
 * plays and how long it is.
 */
import { useState } from "react";
import { Play } from "lucide-react";
import type { HelpVideo } from "@shared/help/types";
import { featureIntroVideo } from "@shared/feature-pages/intro-video";
import { HelpVideoPlayer, formatDuration } from "@/components/help-button";
import { cn } from "@/lib/utils";
import { Kicker } from "./primitives";

/** "about a minute", "about two minutes", "about 4 minutes" — from the measured length, never typed. */
export function aboutMinutes(sec: number): string {
  const n = Math.max(1, Math.round(sec / 60));
  return n === 1 ? "about a minute" : n === 2 ? "about two minutes" : `about ${n} minutes`;
}

export function IntroVideoFrame({ video, title, testId, className }: {
  video: HelpVideo;
  /** What the film is about: the feature's name, or the film's title. */
  title: string;
  testId: string;
  className?: string;
}) {
  const [playing, setPlaying] = useState(false);
  const length = formatDuration(video.durationSec);
  return (
    <figure
      className={cn("overflow-hidden rounded-2xl border border-mkt-rule bg-mkt-card shadow-[0_24px_60px_-28px_rgba(15,23,42,0.35)]", className)}
      data-testid={testId}
      data-state={playing ? "playing" : "poster"}
    >
      {playing ? (
        <HelpVideoPlayer video={video} title={title} autoPlay className="rounded-none" testId={`${testId}-player`} />
      ) : (
        <button
          type="button"
          onClick={() => setPlaying(true)}
          aria-label={`Play the video: ${title} (${length})`}
          className="group relative block aspect-video w-full overflow-hidden rounded-2xl bg-mkt-navy text-left outline-none"
          data-testid={`${testId}-play`}
        >
          {video.poster
            ? <img src={video.poster} alt="" className="absolute inset-0 h-full w-full object-cover" loading="lazy" decoding="async" />
            : <span className="absolute inset-0 mkt-grid-paper-panel" aria-hidden />}
          <span className="absolute inset-0 bg-gradient-to-t from-black/55 via-black/5 to-transparent" aria-hidden />
          <span className="absolute inset-0 flex items-center justify-center" aria-hidden>
            <span className="flex h-16 w-16 items-center justify-center rounded-full bg-mkt-orange text-white shadow-[0_12px_30px_-8px_rgba(0,0,0,0.6)] ring-4 ring-white/25 transition-transform group-hover:scale-105 group-focus-visible:scale-105 sm:h-20 sm:w-20">
              <Play className="ml-1 h-7 w-7 fill-current sm:h-9 sm:w-9" strokeWidth={1.5} />
            </span>
          </span>
          <span className="absolute inset-x-4 bottom-3 flex items-end justify-between gap-3 text-white sm:inset-x-5 sm:bottom-4" aria-hidden>
            <span className="min-w-0 truncate text-[13px] font-semibold [text-shadow:0_1px_2px_rgba(0,0,0,0.6)] sm:text-[15px]">{title}</span>
            <span className="shrink-0 rounded-full bg-black/60 px-2.5 py-0.5 text-[12px] font-semibold tabular-nums backdrop-blur-sm">{length}</span>
          </span>
          {/* The keyboard focus ring, as the topmost layer: the poster and the overlays would paint over the button's own outline or inset shadow. */}
          <span className="pointer-events-none absolute inset-0 rounded-2xl ring-inset ring-mkt-orange ring-0 group-focus-visible:ring-4" aria-hidden />
        </button>
      )}
    </figure>
  );
}

/**
 * The band under a feature page's hero: a kicker, "<Feature> in about a minute" and the framed
 * player. Null while the feature has no uploaded intro manifest.
 */
export function FeatureIntroVideo({ featureKey, title }: { featureKey: string; title: string }) {
  const video = featureIntroVideo(featureKey);
  if (!video) return null;
  return (
    <section className="px-4 sm:px-6 lg:px-8 pt-12 pb-4 sm:pt-14 lg:pt-16" data-testid="section-feature-intro-video" aria-labelledby="feature-intro-video-title">
      <div className="max-w-5xl mx-auto">
        <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between lg:mb-8">
          <div>
            <Kicker n="">Watch</Kicker>
            <h2 id="feature-intro-video-title" className="font-display font-semibold text-[1.7rem] sm:text-[2.1rem] leading-[1.08] tracking-[-0.02em] mt-3 [text-wrap:balance]">
              {title} <em className="text-mkt-orange-ink">in {aboutMinutes(video.durationSec)}</em>
            </h2>
          </div>
          <p className="text-[15px] text-mkt-ink-soft leading-relaxed sm:max-w-xs sm:text-right">
            A short narrated tour of the feature. Captions are on; sound starts when you press play.
          </p>
        </div>
        <IntroVideoFrame video={video} title={title} testId="video-feature-intro" />
      </div>
    </section>
  );
}
