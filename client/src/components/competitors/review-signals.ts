/**
 * Wording for Competitor Intel review signals. The feature page (shared/feature-pages/competitors.ts) promises
 * rating, review count and a review-sample breakdown, and rules out claims that reviews are fake, bought or
 * written by AI, so the page names what was counted ("common phrases"), never who wrote it.
 */

/** Page subtitle: what a scan compares (ratings, reviews and review signals; no search rankings). */
export const COMPETITORS_SUBTITLE = "Find local competitors and compare their ratings, reviews and review signals.";

/** Listing badge for sampled reviews that repeat common phrases — the review panel's own "Common phrases" label. */
export const commonPhrasesBadge = (n: number) => `${n.toLocaleString("en-US")} common ${n === 1 ? "phrase" : "phrases"}`;
