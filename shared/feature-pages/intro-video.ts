/**
 * A feature page's intro walkthrough — the short film at the top of /features/<slug>
 * (owner, 2026-10-11: "post them to the main page of each feature towards the top of the page").
 *
 * Convention: the film's help key is `intro-<slug>` — the page's kebab-case slug, which is its
 * registry key written for file names (`reviews` → `intro-reviews`, `rankingGrid` →
 * `intro-ranking-grid`, the hand-built Call Assistant page → `intro-call-assistant`). Kebab case
 * because a tutorial media key may only hold lowercase letters, digits and dashes
 * (shared/help/videos.ts TUTORIAL_FILE; scripts/tutorials/upload.ts refuses anything else).
 *
 * Like every walkthrough, the video exists only through its uploaded manifest
 * (shared/help/videos/intro-<slug>.json, written by scripts/tutorials/upload.ts): no manifest, no
 * player — the page renders without the section. Nothing is typed here, and the "never fabricate"
 * rule holds: server/help-registry.test.ts checks an intro manifest the same way it checks a help
 * entry's, and ties it to a page in the feature catalogue.
 */
import { helpVideoFor } from "../help/videos";
import type { HelpVideo } from "../help/types";

export const INTRO_VIDEO_PREFIX = "intro-";

/** `rankingGrid` → `ranking-grid` (the same rule the feature pages use for their slugs). */
export const kebabFeatureKey = (key: string) => key.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();

/** The help key of a feature's intro film: `intro-<slug>`. */
export const introVideoKey = (featureKey: string) => `${INTRO_VIDEO_PREFIX}${kebabFeatureKey(featureKey)}`;

/** The feature's intro film, from its manifest — null while none has been uploaded. */
export const featureIntroVideo = (featureKey: string): HelpVideo | null => helpVideoFor(introVideoKey(featureKey));
