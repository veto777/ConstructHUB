// ---------------------------------------------------------------------------
// Feature flags
// ---------------------------------------------------------------------------
// SHOW_COMPETITOR_INTEL controls every public-facing "competitor intelligence"
// surface: the Competitor Intelligence tool card on the home dashboard, the
// matching card on the marketing landing page, the sidebar nav item, and the
// /competitors and /competitors-landing routes.
//
// Hidden during the Google Business Profile API review; restored 2026-09-28
// after approval. Google re-audits sensitive-scope apps: keep the wording about
// PUBLIC market research ("public ad activity", "benchmark your presence"),
// never "spy on competitors / see everything they're doing".
export const SHOW_COMPETITOR_INTEL = true;

// ---------------------------------------------------------------------------
// SHOW_GOOGLE_REVIEWS controls the entire Google Reviews feature surface: the
// /google-reviews tool page (review-request collection + profile monitoring),
// the customer-facing /review/:token feedback form, the
// /review/:token/unsubscribe page, and the "Google Reviews" sidebar nav item.
//
// Restored 2026-09-28 after the review-gating funnel was removed: every client,
// whatever their rating, is offered the Google review option, and no reward is
// tied to leaving a review. Keep it that way — Google prohibits review gating
// and incentivized reviews, and the FTC's consumer-review rule (16 CFR 465)
// prohibits buying positive reviews.
export const SHOW_GOOGLE_REVIEWS = true;
