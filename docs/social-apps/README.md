# Social network developer apps — overview and ordered checklist (DRAFT, 2026-10-11)

Kits in this folder:

| File | Platform | Product / review | Biggest gate |
| --- | --- | --- | --- |
| `meta.md` | Facebook Pages + Instagram | Business app, Facebook Login for Business, App Review for Advanced Access | **Business Verification** + data-deletion callback |
| `linkedin.md` | LinkedIn Pages (+ member profiles) | Community Management API, Development → Standard tier | **One shot per app**; new app with no other product; Page-verified app; business email |
| `tiktok.md` | TikTok | Login Kit + Content Posting API (Direct Post), app review → Direct Post audit | **Strict posting-screen UX**; private-only until audited |
| `bluesky.md` | Bluesky (ConstructHUB Direct) | AT Protocol, app password; no registration, no review | `SOCIAL_BLUESKY=on`; 300 graphemes; 4 photos or 1 video; facets for links/tags/mentions |
| `~/ConstructHUB-release/docs/youtube/AUDIT-PACK.md` (tower1) | YouTube | YouTube API audit + Google OAuth verification | Draft is written and ready but **not submitted**; customer use case B is on branch `youtube-customers`, not deployed |

Nothing in this folder has been sent to any platform. When these kits were written the native
Meta/LinkedIn/TikTok connections did not exist yet; ConstructHUB Direct (`server/social/native.ts`,
`native-nets.ts`) and ConstructHUB's Outstand account (`server/social/outstand.ts`) now connect
customers' accounts.
Every kit marks claims as **(verified 2026-10-11)** against official docs or **(to confirm)**.

---

## Suggested order

1. **LinkedIn Development tier — request now** (owner only, no code needed). Approval comes from
   prerequisites, not from a demo, and the 12-month build window and the 500-calls-a-day limit are
   harmless. Do it carefully: a rejection means a brand-new app.
2. **Meta Business Verification — start now** (owner only). It is the longest owner-side wait and
   is required before Advanced Access.
3. **TikTok developer org + app + domain verification + Sandbox** (owner, 1 hour) so the engineer can
   build against the Sandbox.
4. **YouTube** — the pack is ready; submit once branch `youtube-customers` is deployed and its
   checklist (section 12 of the pack) is done. Independent of the others.
5. Engineer builds the shared "connected social accounts" layer + Meta, then LinkedIn, then TikTok
   (TikTok last: most UI work, and its audit is the slowest to pay off).
6. Legal pages (privacy 4.4–4.6, terms 13, `/data-deletion`) deployed **before** any submission.
7. Submit **Meta App Review** (needs: callback, deletion page, screencast, working reviewer login).
8. Submit **LinkedIn Standard tier** (needs: screencast, test credentials).
9. Submit **TikTok app review**, then the **Direct Post audit** as soon as the app is approved.

Rough calendar if started this week (none of these figures are official; see each kit):
Meta verification 1–2 weeks, App Review 1–4 weeks; LinkedIn Development days–weeks, Standard weeks;
TikTok app review ~1–2 weeks, audit 2–6 weeks. Build time is the engineer's estimate.

---

## Owner does (accounts, documents, forms, recordings)

- [ ] **Decide** the open items: post as LinkedIn member profile too, or Pages only; TikTok
      scheduled posts or "post now" only; Instagram accounts without a Facebook Page (phase 2 or not).
- [ ] **Privacy policy accuracy check**: section 1.5 says prompts are "not sent to an outside AI
      company", but project notes say an OpenAI fallback for AI drafting is live. Every reviewer
      reads the policy; fix the wording or the behaviour before submitting anything.
- [ ] Meta: developer account (2FA), Business portfolio, **Business Verification** documents, domain
      verification of constructhub.us, demo Page + Instagram professional account, create the app
      (meta.md §1–2), Tech Provider step, data-handling answers, screencast, submit.
- [ ] LinkedIn: ConstructHUB Company Page (owner = super admin), `@constructhub.us` business email,
      create a **new** app with nothing else on it, **verify the app from the Page**, request
      Community Management (linkedin.md §1–3); later Standard tier form + screencast.
- [ ] TikTok: developer account + organization, app, products, redirect URI, scopes, URL property
      (DNS TXT) for constructhub.us, Sandbox + target users, demo videos, app review, then audit
      with usage estimates (tiktok.md §1–3).
- [ ] YouTube: fill the blanks in AUDIT-PACK.md §11 and submit after deploy.
- [ ] Provide a reviewer ConstructHUB login for each platform (same account can serve all).
- [ ] Record the screencasts once the engineer says each flow is live (scripts in each kit §4).
- [ ] Put client IDs/secrets only in the server `.env` (never in chat or the repo).

## Engineer builds (before any submission)

Shared (all three):
- [ ] Per-account **connected social accounts** store: platform, external account/page id, name,
      picture, granted scopes, encrypted tokens (reuse `encryptKey` / `SOCIAL_ENCRYPTION_KEY`),
      expiry, status (connected / reconnect needed / revoked), keyed by ConstructHUB user id and
      agency-safe like the YouTube customer code.
- [ ] OAuth routes `GET /api/social/oauth/{meta|linkedin|tiktok}/connect` and
      `/api/social/oauth/{platform}/callback` with one-time session-bound `state`.
- [ ] Composer: destination picker per connected account; per-destination publish status
      (queued → publishing → published with link / failed with our own sentence); AI drafts are
      always editable and never auto-posted.
- [ ] Publisher worker hooked into `server/social/schedule.ts`, per-platform media rules and rate
      limits, token refresh, "Reconnect needed" handling.
- [ ] Disconnect per platform (revoke where an API exists) + purge on account deletion
      (`server/account/delete.ts`).
- [ ] Media served from a constructhub.us subdomain (R2 custom domain, no redirects) — Instagram
      needs public JPEG URLs, TikTok photos need a verified domain.
- [ ] Public `/data-deletion` page (+ status lookup by code), added to the open routes in
      `client/src/App.tsx`.
- [ ] Privacy policy §4.4–4.6 + list updates, terms §13 paragraphs (drafts in each kit §5).
- [ ] Reviewer account with the Social Media module enabled, no 2FA, sample JPEG + 9:16 MP4.

Meta-specific: data deletion callback (`signed_request` HMAC-SHA256 with app secret → JSON
`{url, confirmation_code}`), deauthorize callback, Page `tasks` check (`CREATE_CONTENT`), FB
feed/photos/videos/video_reels publishing, IG container → status → media_publish, Page Publishing
Authorization message, `content_publishing_limit` check.

LinkedIn-specific: organizationAcls page picker, Images/Videos/Documents upload, Posts API with
`Linkedin-Version` pinned in env, lifecycleState polling, 60-day token expiry UX, Development-tier
call budget, **no LinkedIn data into the CRM**.

TikTok-specific: the full Content Sharing Guidelines posting panel (creator nickname, no-default
privacy dropdown, unticked interactions, commercial disclosure with label prompts and branded-content
privacy rule, declaration text, preview, no watermark), chunked FILE_UPLOAD, PULL_FROM_URL for photos,
status polling + `authorization.removed` webhook with signature check, 24-hour token refresh.

---

## Limits before approval (summary, verified unless marked)

| Platform | Before approval |
| --- | --- |
| Meta | Standard Access: only people with a role on the app (add pilot users as Testers) |
| LinkedIn | Development tier: 500 calls/app/day, 100/member/day, no BATCH_GET, no webhooks; build within 12 months |
| TikTok | Sandbox before app review; after app review but before audit: posts private-only, ≤ 5 posting users/24 h, accounts must be private |
| YouTube | Uploads locked Private until the audit; unverified-app warning and user cap until OAuth verification **(to confirm, per the pack)** |
