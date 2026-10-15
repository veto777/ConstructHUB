/**
 * The help registry's shapes. ONE registry (./registry.ts) drives the "i" buttons
 * (<HelpButton k="…" />), the walkthrough-video slot beside them and the /tutorials page.
 *
 * Writing rule (CLAUDE.md "never fabricate"): every sentence in an entry describes what the code
 * does today. A detail that cannot be checked in the code is left out, and `video` stays null until
 * a real recording is uploaded (docs/tutorials/VIDEO-PIPELINE.md) — never a placeholder link.
 */

/**
 * The Tutorials page groups features the way the sidebars group them. "Start here" leads: the short
 * films about what ConstructHUB is (one about the whole product, one tour per app). Its entries may
 * live on either host — every other group is the main app's, except "CRM".
 */
export const HELP_GROUPS = [
  "Start here",
  "Permits & Databases",
  "Google Business",
  "Google Ads",
  "Reviews",
  "Tools",
  "CRM",
] as const;
export type HelpGroup = (typeof HELP_GROUPS)[number];

/** A recorded walkthrough. Only ever built from the manifest of real files (./videos/<helpKey>.json; R2, `tutorials/` prefix). */
export type HelpVideo = {
  /** Absolute https URL, or a root-relative path served by the app. */
  url: string;
  durationSec: number;
  /** Still frame shown before play. */
  poster?: string;
  /** WebVTT captions made from the narration script. */
  captions?: string;
};

export type HelpEntry = {
  /** Stable id. A section of a feature is "<feature>.<section>" (e.g. "cloudflare.connections"). */
  key: string;
  title: string;
  /** What it's for — one or two plain sentences. The Tutorials card shows the first sentence. */
  whatItIs: string;
  /** What it does. */
  whatItDoes: string;
  /** How to run it: numbered steps, in order. */
  howToUse: string[];
  /** How it works behind the screen. */
  howItWorks: string;
  /** Plan / connection prerequisites, when there are any. */
  needs?: string[];
  /** Where the feature lives. "/crm…" routes are served by the CRM (portal) host. */
  route: string;
  /**
   * Other page routes this entry is the "i" for (helpKeyForRoute), when a page has no entry of its own: a record's
   * page, e.g. the project page "/crm/projects" for the pipeline entry. Prefixes, like `route`.
   */
  alsoAt?: string[];
  group: HelpGroup;
  /** The feature this entry is a section of; sections are listed inside their feature's card. */
  parent?: string;
  /**
   * Publishing. `hold: true` — this video is NEVER scheduled by the tools on their own: not to YouTube
   * (youtube-schedule.ts). Its dry run lists it as "held for owner
   * approval"; it goes out only when a person names it with `--release <key>`. Set on the overview
   * films ("Start here"): what they say about the company is the owner's to approve.
   */
  youtube?: { hold?: boolean };
  /**
   * Not shown anywhere in the app yet: no card on /tutorials, no "i" panel — the entry exists only so
   * its step script, its YouTube description and its tests have something to belong to. For a film
   * that waits for the owner's release (the named comparisons): remove this line, and commit the
   * video's manifest, when it is released.
   */
  unlisted?: boolean;
  /** null until the walkthrough is recorded. The Tutorials page reads only this: "Video coming soon" means no walkthrough. */
  video: HelpVideo | null;
  /**
   * The film the "i" panel plays: the walkthrough when one is recorded, else the feature's intro film (the short
   * overview from /features/<slug>, shared/help/registry.ts INTRO_FALLBACKS; a section inherits its feature's). null
   * when neither exists. The panel labels it by `videoSource` ("Walkthrough" / "Overview film"), so the fallback is
   * never passed off as a step-by-step recording.
   */
  film: HelpVideo | null;
  /** Where `film` comes from; null when there is no film. */
  videoSource: HelpVideoSource | null;
};

/** Where an entry's film comes from: its own recorded walkthrough, or its feature's intro (overview) film. */
export type HelpVideoSource = "walkthrough" | "intro";

/** An entry as it is written: everything but the films, which the registry fills from the manifests. */
export type HelpDraft = Omit<HelpEntry, "video" | "film" | "videoSource">;
