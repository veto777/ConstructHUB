// ---------------------------------------------------------------------------
// Feature flags
// ---------------------------------------------------------------------------
// SHOW_COMPETITOR_INTEL controls every public-facing "competitor intelligence"
// surface: the Competitor Intelligence tool card on the home dashboard, the
// matching card on the marketing landing page, the sidebar nav item, and the
// /competitors and /competitors-landing routes.
//
// It is intentionally hidden while ConstructHUB is under Google Business Profile
// API review, because competitor-monitoring messaging reads like surveillance to
// a reviewer (even though these tools only use public Google Maps/Places data).
//
// TO BRING THESE FEATURES BACK AFTER APPROVAL: set this to `true`.
// When you do, keep the wording honest ("public market research"), NOT
// "spy on competitors / see everything they're doing" — Google re-audits
// sensitive-scope apps and surveillance language can cost you the access.
export const SHOW_COMPETITOR_INTEL = false;

// ---------------------------------------------------------------------------
// SHOW_GOOGLE_REVIEWS controls the entire Google Reviews feature surface: the
// /google-reviews tool page (review-request collection + profile monitoring),
// the customer-facing /review/:token feedback form, the
// /review/:token/unsubscribe page, and the "Google Reviews" sidebar nav item.
//
// It is intentionally hidden while ConstructHUB is under Google Business Profile
// API review. The review-request flow routes customers by sentiment (high
// ratings to Google, low ratings to a private form), which Google's policies
// prohibit as "review gating" — a reviewer who sees it will reject the app, and
// it can put the underlying Business Profile at risk of suspension.
//
// TO BRING THIS BACK AFTER APPROVAL: set this to `true`, but FIRST remove the
// sentiment gating so EVERY customer gets the Google review option, and delete
// any "keeps negative reviews off Google" / "trade work for reviews" wording.
export const SHOW_GOOGLE_REVIEWS = false;
