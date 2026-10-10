import { z } from "zod";

/**
 * Review-request feedback routing (owner, 2026-10-10: "hear problems before Google does").
 *
 * The owner sets ONE number, the escalation threshold. After the client's private 1–10 score:
 *   - score <  threshold → the private "What could we have done better?" form comes first, it is saved,
 *                           the owner is alerted at once (bell + email + Telegram when linked), THEN the
 *                           Google review step as for everyone;
 *   - score >= threshold → straight to the Google review step (AI draft from the client's own words).
 *
 * HARD RULE: the threshold routes and alerts INTERNALLY only. Every client is shown the Google review link
 * on every step of the page whatever the score (client/src/pages/review-feedback.tsx, the "always" link
 * above the steps). Nothing here may hide, delay or condition that link — Google prohibits review gating,
 * and a profile caught doing it can have its reviews removed.
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
 * The client page's step after the score is saved. "improvement" is the private form (sub-threshold);
 * "referral" / "describe" are the Google step (the referral offer sits in front of it when the owner
 * turned one on). The Google link itself is rendered on every one of these steps.
 */
export function routeAfterRating(rating: number, threshold: number, referralOffer: boolean): RatingRoute {
  if (isPrivateFirstScore(rating, threshold)) return "improvement";
  return referralOffer ? "referral" : "describe";
}

/** The Feedback routing card's one-line explanation of the chosen threshold. */
export function describeReviewEscalationThreshold(threshold: number): string {
  if (threshold >= REVIEW_ESCALATION_THRESHOLD_MAX) {
    return "Only a 10 goes straight to the Google ask. Every other score goes to private feedback first and alerts you immediately. Every client still gets the Google link.";
  }
  return `Scores below ${threshold} go to private feedback first and alert you immediately. Scores at or above ${threshold} go straight to the Google ask. Every client still gets the Google link.`;
}

/** The Google Reviews stats row: requests whose score was routed to private feedback first. */
export function caughtPrivatelyCount(requests: ReadonlyArray<{ privateFeedbackAt?: Date | string | null }>): number {
  return requests.filter((r) => r.privateFeedbackAt != null).length;
}
