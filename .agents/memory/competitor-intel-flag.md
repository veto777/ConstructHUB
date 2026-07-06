---
name: Competitor-intel visibility flag
description: Why the competitor-surveillance surfaces are hidden behind one flag and how to safely re-enable them
---

# Competitor Intelligence visibility flag

A single flag (`SHOW_COMPETITOR_INTEL`, default `false`) gates every public-facing
competitor-monitoring surface: the `/competitors` and `/competitors-landing` routes,
the sidebar "Competitor Intel" item, and the "Competitor Intelligence" cards on the
home dashboard and marketing landing page.

**Why:** ConstructHUB is applying for Google Business Profile API access (sensitive
`business.manage` scope). The public site previously marketed "track competitor Google
Business profiles / see everything your competitors are doing / BS Meter," which reads
as surveillance and contradicts the "manage our own profile" use case — the likely
cause of an earlier rejection. The competitor tools themselves use public Google
Maps/Places data (not the GBP API), so they are not an actual policy violation — the
problem is the messaging.

**How to apply:**
- Keep the flag `false` while under GBP review / until access is granted and stable.
- Google re-audits sensitive-scope apps after approval. When re-enabling, set the flag
  to `true` but keep wording honest ("public market research"), NOT "spy on competitors."
  Reverting to surveillance language can cost the access later.
- The neutral rewordings of the IP Tracker / VPN Shield / GMB Monitor blurbs are
  permanent improvements and intentionally NOT behind the flag — do not revert them to
  the old surveillance phrasing.
