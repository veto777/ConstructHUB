---
name: LSA OAuth redirect URI is fixed, not host-derived
description: Why the Google LSA OAuth callback URI is pinned to one canonical value and how to configure it.
---

The LSA Google OAuth redirect URI must be a SINGLE fixed value, never derived from
the incoming request host (`getBaseUrl(req)` / `x-forwarded-host`).

**Why:** Google requires every redirect URI to be pre-registered in the Cloud
Console OAuth client. Deriving it from the request host means every preview /
custom / tenant domain needs its own registration — a hard scaling bottleneck for
a multi-tenant SaaS connecting thousands of Google accounts. One canonical URI =
one registration that covers all users and all accounts forever.

**How to apply:** `getRedirectUri()` in `server/lsa/client.ts` takes no args and
resolves in order: `LSA_OAUTH_REDIRECT_URI` (full URL, use for local dev) →
`LSA_PUBLIC_BASE_URL` + `/api/lsa/oauth/callback` → canonical
`https://constructhub.us/api/lsa/oauth/callback`. The `/api/lsa/status` endpoint
returns `redirectUri` so the connect card can show the exact value to register.
For onboarding to need zero cloud changes per user, the OAuth consent screen must
also be published ("In production"), otherwise each user email must be added as a
test user (max 100).
