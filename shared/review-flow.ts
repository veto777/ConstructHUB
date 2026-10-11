import { z } from "zod";

/**
 * Review-request feedback routing (owner, 2026-10-10: "hear problems before Google does").
 *
 * The owner sets ONE number, the escalation threshold. After the client's private 1–10 score:
 *   - score <  threshold → the private "What could we have done better?" form comes first, it is saved,
 *                           the owner is alerted at once (bell + email + Telegram when linked), then the
 *                           thank-you screen. This client is never shown the public review link or step.
 *   - score >= threshold → the public review step with the "Leave a review" link (AI draft from the
 *                           client's own words).
 *
 * HARD RULE: the threshold is the only thing that decides whether the public review link and step are
 * offered. The link above the steps and every route into the review step render solely for scores at or
 * above it (client/src/pages/review-feedback.tsx, `isHighRating`); a below-threshold client must never
 * reach the public review URL from this page.
 */
export const DEFAULT_REVIEW_ESCALATION_THRESHOLD = 8;
export const REVIEW_ESCALATION_THRESHOLD_MIN = 1;
export const REVIEW_ESCALATION_THRESHOLD_MAX = 10;
/** The positions the Feedback routing card offers; 10 is the "only 10s go straight to Google" setting. */
export const REVIEW_ESCALATION_THRESHOLD_CHOICES = [5, 6, 7, 8, 9, 10] as const;

export const reviewEscalationSettingsInput = z.object({
  reviewEscalationThreshold: z.number().int().min(REVIEW_ESCALATION_THRESHOLD_MIN).max(REVIEW_ESCALATION_THRESHOLD_MAX),
});
export type ReviewEscalationSettings = z.infer<typeof reviewEscalationSettingsInput>;

/** A stored or transmitted threshold, or the default when it is missing or out of range. */
export function normalizeReviewEscalationThreshold(value: unknown): number {
  const n = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  return typeof n === "number" && Number.isInteger(n) && n >= REVIEW_ESCALATION_THRESHOLD_MIN && n <= REVIEW_ESCALATION_THRESHOLD_MAX
    ? n : DEFAULT_REVIEW_ESCALATION_THRESHOLD;
}

/** Sub-threshold: the score goes to private feedback first and alerts the owner. */
export function isPrivateFirstScore(rating: number, threshold: number): boolean {
  return rating < threshold;
}

export type RatingRoute = "improvement" | "referral" | "describe";

/**
 * The client page's step after the score is saved. "improvement" is the private form (sub-threshold), which
 * ends at the thank-you screen; "referral" / "describe" are the public review step (the referral offer sits
 * in front of it when the owner turned one on). Only these at/above-threshold routes reach the review step.
 */
export function routeAfterRating(rating: number, threshold: number, referralOffer: boolean): RatingRoute {
  if (isPrivateFirstScore(rating, threshold)) return "improvement";
  return referralOffer ? "referral" : "describe";
}

/** The Feedback routing card's one-line explanation of the chosen threshold. */
export function describeReviewEscalationThreshold(threshold: number): string {
  if (threshold >= REVIEW_ESCALATION_THRESHOLD_MAX) {
    return "Only a 10 goes straight to the Google ask and its link. Every other score goes to private feedback first, alerts you immediately and is never shown the Google link.";
  }
  return `Scores below ${threshold} go to private feedback first, alert you immediately and are never shown the Google link. Scores at or above ${threshold} go straight to the Google ask and its link.`;
}

/** The Google Reviews stats row: requests whose score was routed to private feedback first. */
export function caughtPrivatelyCount(requests: ReadonlyArray<{ privateFeedbackAt?: Date | string | null }>): number {
  return requests.filter((r) => r.privateFeedbackAt != null).length;
}
