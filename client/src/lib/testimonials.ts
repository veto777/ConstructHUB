/**
 * Customer testimonials for the paid-ad landing page (/get-started, client/src/pages/get-started.tsx).
 *
 * EMPTY ON PURPOSE. ConstructHUB has no published customer reviews yet, and the page must never show an
 * invented quote, star rating, review count, customer count or logo. While this list is empty the
 * testimonial section renders nothing at all.
 *
 * To add one: a real customer, a quote they wrote or approved in writing, and their permission to show their
 * name and company. Keep the wording exactly as they gave it.
 */
export type Testimonial = {
  /** Their words, verbatim. */
  quote: string;
  /** The person's name as they agreed to have it shown. */
  name: string;
  /** Company and trade, e.g. "Owner, Example Roofing Co." */
  role: string;
  /** Optional city/state, e.g. "Denver, CO". */
  place?: string;
};

export const TESTIMONIALS: readonly Testimonial[] = [];
