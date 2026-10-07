/**
 * /tutorials — every feature in one place: what it's for, a link to open it, the full help text and its
 * walkthrough video. Grouped the way the sidebars group the features, with a search box over all of it.
 *
 * Everything comes from the one help registry (shared/help/registry.ts) — the same text the "i" buttons
 * show. A feature whose walkthrough has not been recorded shows a "Video coming soon" badge, never a
 * player or a link: `video` is only ever a real, uploaded file (docs/tutorials/VIDEO-PIPELINE.md).
 */
import { useEffect, useMemo, useState } from "react";
import { ArrowUpRight, ChevronDown, PlayCircle, Search } from "lucide-react";
import { AppPage } from "@/components/app-ui";
import { GoogleSectionHeader, GooglePill } from "@/components/google";
import { HelpParts, HelpVideoPlayer, formatDuration } from "@/components/help-button";
import { inNativeApp } from "@/lib/app-shell";
import { SHOW_COMPETITOR_INTEL, SHOW_GOOGLE_REVIEWS } from "@/lib/features";
import { portalUrl } from "@/lib/site";
import {
  HELP_FEATURES, HELP_GROUPS, helpMatches, helpSections, helpShortTitle, helpSummary, isCrmRoute, type HelpEntry,
} from "@shared/help/registry";

/** Features this build does not show (the same switches the sidebar and the routes use). */
const HIDDEN_ROUTES = new Set<string>([
  ...(SHOW_COMPETITOR_INTEL ? [] : ["/competitors"]),
  ...(SHOW_GOOGLE_REVIEWS ? [] : ["/google-reviews"]),
  // The iPhone apps sell nothing, so they have no Master Class, reinstatement service or Ads guide.
  ...(inNativeApp() ? ["/master-class", "/reinstatement", "/google-ads-guide"] : []),
]);
const FEATURES = HELP_FEATURES.filter((f) => !HIDDEN_ROUTES.has(f.route));

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const openHref = (e: HelpEntry) => (isCrmRoute(e.route) ? portalUrl(e.route) : e.route);

function VideoSlot({ entry }: { entry: HelpEntry }) {
  if (!entry.video) return null;
  return (
    <div className="mt-3 max-w-2xl">
      <HelpVideoPlayer video={entry.video} title={entry.title} testId={`tutorial-video-${entry.key}`} />
    </div>
  );
}

function FeatureCard({ entry, open, onToggle }: { entry: HelpEntry; open: boolean; onToggle: () => void }) {
  const sections = helpSections(entry.key);
  const panelId = `help-panel-${entry.key}`;
  return (
    <li id={`help-${entry.key}`} className="g-card scroll-mt-20" data-testid={`tutorial-card-${entry.key}`}>
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1 basis-64">
          <h3 className="g-card__title g-card__title--md" data-testid={`tutorial-title-${entry.key}`}>{entry.title}</h3>
          <p className="g-card__line">{helpSummary(entry)}</p>
          <p className="mt-2">
            {entry.video ? (
              <span className="g-chip g-chip--sm !normal-case" data-testid={`tutorial-video-badge-${entry.key}`}>
                <PlayCircle className="mr-1 h-3.5 w-3.5" aria-hidden="true" />Video · {formatDuration(entry.video.durationSec)}
              </span>
            ) : (
              <span className="g-chip g-chip--sm !normal-case" data-testid={`tutorial-video-soon-${entry.key}`}>Video coming soon</span>
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <GooglePill size="sm" icon={ArrowUpRight} href={openHref(entry)} label="Open" ariaLabel={`Open ${entry.title}`} testId={`tutorial-open-${entry.key}`} />
          <button type="button" className="g-pill g-pill--sm g-pill--quiet" aria-expanded={open} aria-controls={panelId} onClick={onToggle}
            data-testid={`tutorial-toggle-${entry.key}`}>
            <ChevronDown className={open ? "rotate-180 transition-transform" : "transition-transform"} aria-hidden="true" />
            <span>{open ? "Hide the guide" : "Read the guide"}</span>
            <span className="sr-only"> for {entry.title}</span>
          </button>
        </div>
      </div>
      <VideoSlot entry={entry} />
      {open && (
        <div id={panelId} className="mt-4 max-w-3xl" data-testid={`tutorial-guide-${entry.key}`}>
          <HelpParts entry={entry} />
          {sections.length > 0 && (
            <div className="mt-5">
              <h4 className="text-[12px] font-medium uppercase tracking-wide g-text-2">Each part of the page</h4>
              <ul className="mt-1">
                {sections.map((s) => (
                  <li key={s.key} className="border-t py-1" style={{ borderColor: "var(--g-divider)" }}>
                    <details data-testid={`tutorial-section-${s.key}`}>
                      <summary className="cursor-pointer py-2 text-sm g-text">
                        <span className="font-medium">{helpShortTitle(s)}</span>
                        <span className="g-text-2"> — {helpSummary(s)}</span>
                      </summary>
                      <div className="pb-3 pl-4 pt-1">
                        <HelpParts entry={s} />
                        <VideoSlot entry={s} />
                      </div>
                    </details>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </li>
  );
}

export default function TutorialsPage() {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<Set<string>>(new Set());
  const toggle = (key: string) => setOpen((prev) => { const next = new Set(prev); next.has(key) ? next.delete(key) : next.add(key); return next; });

  // /tutorials#help-cloudflare (the "All tutorials" link in an "i" panel) opens that feature's guide;
  // /tutorials#group-crm (the CRM sidebar's link) lands on that group. The page renders after the
  // browser's own anchor jump, so scroll once it has.
  useEffect(() => {
    const id = decodeURIComponent(window.location.hash.slice(1));
    if (!id) return;
    const key = id.replace(/^help-/, "");
    if (id.startsWith("help-") && FEATURES.some((f) => f.key === key)) setOpen(new Set([key]));
    const t = window.setTimeout(() => document.getElementById(id)?.scrollIntoView({ block: "start" }), 50);
    return () => window.clearTimeout(t);
  }, []);

  const groups = useMemo(
    () => HELP_GROUPS.map((group) => ({ group, items: FEATURES.filter((f) => f.group === group && helpMatches(f, q)) })).filter((g) => g.items.length > 0),
    [q],
  );
  const shown = groups.reduce((n, g) => n + g.items.length, 0);
  const withVideo = FEATURES.filter((f) => f.video).length;

  return (
    <AppPage testId="page-tutorials">
      <GoogleSectionHeader
        as="h1" title="Tutorials" titleTestId="text-page-title" flush
        description="Every feature: what it’s for, how to run it, how it works — and its walkthrough video."
      />
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
        <div className="g-search sm:w-96" role="search">
          <Search aria-hidden="true" />
          <input type="search" aria-label="Search tutorials" placeholder="Search features and guides" value={q}
            onChange={(e) => setQ(e.target.value)} data-testid="input-tutorial-search" />
        </div>
        <p className="text-sm g-text-2" aria-live="polite" data-testid="text-tutorial-count">
          {shown} of {FEATURES.length} features
          {" · "}
          {withVideo === 0 ? "walkthrough videos are being recorded" : `${withVideo} with a walkthrough video`}
        </p>
      </div>
      {!q && (
        <nav aria-label="Feature groups" className="flex flex-wrap gap-2">
          {groups.map(({ group, items }) => <GooglePill key={group} size="sm" href={`#group-${slug(group)}`} label={`${group} (${items.length})`} />)}
        </nav>
      )}
      {groups.length === 0 && (
        <p className="py-8 text-sm g-text-2" data-testid="text-tutorial-empty">
          No feature matches “{q}”. Try a feature name, such as “Cloudflare” or “estimates”.
        </p>
      )}
      {groups.map(({ group, items }) => (
        <section key={group} id={`group-${slug(group)}`} className="scroll-mt-20" aria-label={group} data-testid={`tutorial-group-${slug(group)}`}>
          <GoogleSectionHeader title={group} count={items.length} flush />
          <ul className="g-list">
            {items.map((f) => <FeatureCard key={f.key} entry={f} open={open.has(f.key)} onToggle={() => toggle(f.key)} />)}
          </ul>
        </section>
      ))}
    </AppPage>
  );
}
