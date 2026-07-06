---
name: Review-gating visibility flag
description: Why the Google Reviews feature is hidden during GBP API review, and what to fix before re-enabling.
---

The entire Google Reviews feature is hidden behind a single feature flag (`SHOW_GOOGLE_REVIEWS`, default off), gated the same way as the Competitor Intel flag.

**Why:** The review-request flow routes customers by sentiment (high ratings → Google, low ratings → a private feedback form). Google explicitly prohibits this as "review gating." A GBP API reviewer who sees it will reject the app, and it can get the underlying Business Profile suspended. There is also "trade work for reviews" / incentivized-review copy in the reviews page.

**How to apply:** Keep the flag off while ConstructHUB is under GBP API review. Before ever turning it on, FIRST remove the sentiment gating so every customer is offered the Google review option, and delete the gating/incentive wording — re-enabling the funnel as-is will fail a Google audit.
