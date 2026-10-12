# LinkedIn (Company Pages + member profiles) — application kit (DRAFT)

**Status: DRAFT, written 2026-10-11. Not submitted. Nothing here has been confirmed with LinkedIn.**
Blanks (`____`) are for the owner. **(verified 2026-10-11)** = read on learn.microsoft.com/linkedin
that day (sources in section 9); **(to confirm)** = our understanding only.

The native LinkedIn connection is **not built**; today the Social Media tool reaches LinkedIn only
through the customer's own Blotato key (`server/social/client.ts`). Section 5 lists what to build.

**Product to apply for: Community Management API** (LinkedIn Marketing API program). It is the only
product that grants `w_organization_social` (post as a Company Page) to a third-party app. It also
grants `w_member_social` (post as the person).

> **Read this first — one shot per app (verified):** "If your application is rejected, review the
> qualifications, create a new app, and submit a new Development tier access request form. You won't
> be able to re-apply … with your existing app." The same applies to the Standard tier. And the
> Community Management option is greyed out on apps that already have any other API product (FAQ #4:
> "Only request Community Management API Development Tier access with new developer applications
> that don't have access to other API products"). So: **a brand-new app, no other product added
> (not even "Sign In with LinkedIn using OpenID Connect" or "Share on LinkedIn"), and every
> prerequisite done before pressing Request access.**

---

## 1. Prerequisites the owner must have

| # | What | Where / click path | Status |
| --- | --- | --- | --- |
| 1 | A LinkedIn member account for the owner (real person, real name — fake/headless profiles are prohibited, **verified**) | linkedin.com | ____ |
| 2 | A **LinkedIn Page for ConstructHUB** (the company), with the owner as **Super admin** | linkedin.com → **For Business** (top right grid) → **Create a Company Page** → Company → name "ConstructHUB", URL linkedin.com/company/`____`, website `https://constructhub.us`, industry Software Development, size, type Privately held, logo, tagline → tick verification → **Create page** | ____ |
| 3 | **Registered legal organization** — "available to registered legal organizations for commercial use cases only" (**verified**). Legal name, registered address, website, privacy policy URL ready | — | ____ |
| 4 | **Business email address** on the company domain — personal addresses (gmail etc.) "won't pass the vetting process" (**verified**). Use `support@constructhub.us` (or an owner's `@constructhub.us` address); LinkedIn sends a verification link to it — check spam/promotions | — | ____ |
| 5 | Website and domain must be verifiable: https://constructhub.us live, matching the organization name, with the privacy policy reachable (**verified**: "Verified organization website and domain address") | — | ok, re-check |
| 6 | App logo (square, ≥100×100 **(to confirm size)**), **no part of the LinkedIn or Microsoft names or logos ("Linked" or "In")** (**verified**) | — | ____ |
| 7 | A second LinkedIn member + a test Company Page that member administers, for the Standard-tier screencast and reviewer test credentials | — | ____ |

---

## 2. App setup

### 2.1 Create the app

1. https://www.linkedin.com/developers/apps/new (**verified** URL).
2. Fields: **App name** `ConstructHUB` · **LinkedIn Page** the ConstructHUB Page from 1.2 ·
   **Privacy policy URL** `https://constructhub.us/privacy` · **App logo** (1.6) · tick the **Legal
   agreement** → **Create app**.
3. **Settings** tab → **App settings → Verify** → **Generate URL** → the Page's **super admin** opens
   that URL while signed in and clicks **Verify** (**verified**: "Ensure a super admin of the
   LinkedIn Page … has verified your application"). Do this BEFORE requesting access.
4. **Auth** tab → **OAuth 2.0 settings → Authorized redirect URLs for your app** → add
   `https://constructhub.us/api/social/oauth/linkedin/callback` (absolute, https, no `#`; query
   parameters are ignored — **verified**). Add the same path for any other host serving the tool.
5. **Products** tab → **Community Management API → Request access** → complete the form (3.1).
   Do **not** add any other product to this app, before or after **(after approval adding a
   self-serve product may be possible but is not documented — don't)**.
6. After approval: **Products** tab shows the **Standard tier access request form** (**verified**
   location: "My Apps > Products").

### 2.2 Scopes (minimum set) — all granted by Community Management (verified list)

| Scope | Why | Notes (verified unless marked) |
| --- | --- | --- |
| `w_organization_social` | Publish the customer's posts (text, images, video, documents, multi-image) as their Company Page | Member must be ADMINISTRATOR, CONTENT_ADMIN(ISTRATOR) or DIRECT_SPONSORED_CONTENT_POSTER of the Page |
| `rw_organization_admin` | List the Pages the member administers (`GET /rest/organizationAcls?q=roleAssignee&role=ADMINISTRATOR&state=APPROVED`) and read each Page's name and logo for the picker | ADMINISTRATOR only. `r_organization_admin` (read-only) is **not** in the Community Management permission list, so the rw scope is the one available |
| `r_organization_social` | Read back the post we created (`GET /rest/posts/{urn}?viewContext=AUTHOR`) to show `lifecycleState` PUBLISH_REQUESTED → PUBLISHED / PUBLISH_FAILED | Restricted to Pages where the member has one of the roles above |
| `w_member_social` | Publish posts as the member themself (personal profile), for owner-operators who post as themselves | — |
| `r_basicprofile` | Read the member's ID (to build `urn:li:person:{id}` as post author for profile posts), name and photo so the customer sees which profile is connected | **(to confirm `/v2/me` with r_basicprofile is the intended route — `openid`/`profile` would need the OpenID product, which can't be on this app)** |

**Do not request** `r_member_social` (closed — **verified**), `r_organization_social_feed`,
`w_organization_social_feed`, `w_member_social_feed` (comments/reactions), `r_organization_followers`,
`r_1st_connections_size`, `r_member_postAnalytics`, `r_member_profileAnalytics` (analytics, not in
scope yet). LinkedIn asks for "the least number of scope permissions" and the member must consent to
all requested scopes at once (**verified**).

If profile posting is not wanted at launch, drop `w_member_social` and `r_basicprofile`
(owner decision, 7). Note: changing scopes later invalidates every token issued for different scopes
and forces customers to reconnect (**verified**: "If you request a different scope than the
previously granted scope, all the previous access tokens are invalidated").

### 2.3 OAuth and tokens (verified)

- Authorize: `https://www.linkedin.com/oauth/v2/authorization?response_type=code&client_id=…&redirect_uri=…&state=…&scope=w_organization_social%20rw_organization_admin%20r_organization_social%20w_member_social%20r_basicprofile`
- Code lives 30 minutes; exchange at `POST https://www.linkedin.com/oauth/v2/accessToken`.
- **Access tokens live 60 days.** "Programmatic refresh tokens are available for a limited set of
  partners" — whether ConstructHUB's app gets them shows in the token response (`refresh_token`
  present or not) **(to confirm after approval)**. Without them the customer must click Reconnect
  every 60 days (the consent screen is skipped if they are logged in and the token hasn't expired).
- Every API call: headers `Linkedin-Version: YYYYMM` and `X-Restli-Protocol-Version: 2.0.0`
  (**verified**). Pin a current version (e.g. `202609`) in one env var. Versions are sunset after
  about a year — "Marketing Version 202510 … will be sunset on October 15, 2026" (**verified**) — so
  put a calendar reminder to bump it.

### 2.4 Webhooks

None. (Development tier: "Webhook for Social Actions: Push notifications disabled" — **verified**.)
Post status is polled.

### 2.5 Media

Images → Images API (`initializeUpload`, PUT to upload URL) → `urn:li:image:…`; videos → Videos API
(initialize, upload parts, finalize) → `urn:li:video:…`; documents (PDF) → Documents API; multiple
images → MultiImage. Organic carousels are not supported; article posts need title/thumbnail set by
us — LinkedIn does not scrape URLs (**verified**). Post permalink:
`https://www.linkedin.com/feed/update/{post urn}/` (**verified** structure).

---

## 3. Form fields — ready-to-paste text

### 3.1 Development tier access request form (Products → Community Management API)

| Field | Answer |
| --- | --- |
| Business email | `support@constructhub.us` (must verify by link) |
| Organization legal name | `____` |
| Registered address | `____` |
| Website | `https://constructhub.us` |
| Privacy policy URL | `https://constructhub.us/privacy` |
| Use case(s) | **Page Management** (post to Company Pages the user administers) and **Profile Management / posting on behalf of individual profiles** **(pick the matching labels on the form; the screencast list uses "Page Management", "Executive Management", "Employee Advocacy")** — do NOT tick analytics, brand engagement or employee advocacy |
| Describe your company and product | see below |
| Describe your use case | see below |

**Company and product:**
> ConstructHUB (https://constructhub.us) is a US software-as-a-service platform for contractors —
> roofing, plumbing, HVAC, remodeling and similar trades — and the marketing agencies that serve
> them. It provides permit data, Google Business Profile management, a CRM, review requests and a
> Social Media tool for scheduling and publishing the business's own posts.

**Use case:**
> In ConstructHUB's Social Media tool, a signed-in customer connects LinkedIn with the standard
> OAuth consent. We list the LinkedIn Pages they administer (organizationAcls) and they choose the
> Page(s) their business posts to; owner-operators may also post as themselves. The customer writes
> a post — or has ConstructHUB's AI draft one, which they review and edit — attaches their own
> job-site photos, a video or a PDF, chooses the Page or profile and a time, and clicks Publish or
> Schedule. At that time ConstructHUB creates exactly that post with the Posts API, reads it back to
> confirm it was published, and shows the customer "Published" with a link, or why it failed.
> Nothing is posted without the customer's action. We do not read or store members' profiles,
> comments, reactions or followers, do not build lists or leads from LinkedIn data, and do not move
> any LinkedIn data into the CRM. Tokens are encrypted at rest; disconnecting deletes them.

### 3.2 Standard tier access request form (after Development tier)

| Field | Answer |
| --- | --- |
| Company / product overview | as 3.1 |
| Use case description | as 3.1, plus: "Status: live for `____` customers in the Development tier since `____`." |
| Test credentials | ConstructHUB test account: URL `https://constructhub.us/auth`, email `____`, password `____` (Social Media enabled, no 2FA). LinkedIn: reviewers connect their own member account; if a LinkedIn test member is required, provide the 1.7 account: `____` **(do not share the owner's real LinkedIn password)** |
| Screencast | link to a downloadable high-resolution file (section 4) |
| Existing Standard-tier app? | No |

---

## 4. Screencast script (Standard tier)

Rules (**verified**): high resolution, **downloadable**, only the app's screens (close other
windows), narration recommended, demonstrate each use case named in the form. Functionality you
don't have: "just note that in your recording" (**verified**).

**Part A — Page Management** (record narrated):
1. Browser at `https://constructhub.us/auth`, address bar visible. Sign in as the test customer.
2. Social Media → LinkedIn card, **Not connected**, with its explanation (what is requested, what
   isn't, how to disconnect).
3. Click **Connect LinkedIn** → LinkedIn sign-in → the consent screen listing the permissions. Pause.
   Click **Allow**. ("Complete OAuth flow" — required.)
4. Back in ConstructHUB: the list of Pages you administer, with names and logos. Choose the test Page.
5. **New post** → type text → attach an image → select the LinkedIn Page → **Publish now**. Show the
   row going Publishing → Published, click **View on LinkedIn** → the post on the Page. ("A user
   posting to their LinkedIn page via your app" — required.)
6. Repeat with a video, scheduled 2 minutes ahead; show Scheduled → Published.
7. Narrate: "ConstructHUB does not display comments on posts or any commenter's profile data. No
   other member personal data is shown." (Required test cases on comments/commenter fields — we
   state that the functionality does not exist.)

**Part B — posting as the member's own profile** (only if `w_member_social` is requested):
8. In the LinkedIn card, choose "Post as myself" (profile name and photo shown from
   `r_basicprofile`). New post → text + image → profile → Publish → View on LinkedIn.
9. Narrate the same "no comments / no commenter data" statement.

**Part C — disconnect**: Social Media → LinkedIn → **Disconnect** → Not connected. Then
linkedin.com → Settings → Data privacy → **Permitted services** (**to confirm path**) → ConstructHUB
can be removed there. Scroll to the LinkedIn section of https://constructhub.us/privacy.

---

## 5. What ConstructHUB must build or change BEFORE submitting

Development tier only needs the form and prerequisites, so it can be requested **now**, before code
— and should be, because the 12-month clock and the API quotas only matter once building starts.
Everything below is needed **before the Standard tier request**.

1. **Connect** `GET /api/social/oauth/linkedin/connect` (signed-in only, one-time `state` in session,
   10 min) and **callback** `GET /api/social/oauth/linkedin/callback`: compare state (401 on
   mismatch — **verified** guidance), handle `error=user_cancelled_authorize`, exchange the code,
   store token + expiry (+ refresh token if issued) **encrypted** (`SOCIAL_ENCRYPTION_KEY` pattern).
2. **Page picker**: `organizationAcls?q=roleAssignee&role=ADMINISTRATOR&state=APPROVED` (and
   CONTENT_ADMINISTRATOR if `w_organization_social` covers it for listing — **to confirm**) →
   organization lookup for name + logo. Store only org URN, name, logo URL (org name/logo may be
   cached 30 days for orgs that haven't authenticated; for an authenticated org's profile data 8
   weeks — **verified** data-storage table; refresh on use).
3. **Publish worker**: Images/Videos/Documents upload → `POST /rest/posts` with
   `author` (org or person URN), `commentary`, `visibility: PUBLIC`,
   `distribution.feedDistribution: MAIN_FEED`, `lifecycleState: PUBLISHED` → read `x-restli-id` →
   poll `GET /rest/posts/{urn}?viewContext=AUTHOR` until `PUBLISHED` or `PUBLISH_FAILED` → store URN,
   permalink, status, our own failure sentence. Escape LinkedIn "little" text reserved characters in
   commentary **(to confirm the escaping rules in the little Text Format page)**.
4. **Token health**: show "expires in N days"; when < 7 days or 401, mark **Reconnect needed** and
   e-mail the customer; no silent failures (matches LinkedIn's CM-002…CM-006 integration
   requirements — **verified** list).
5. **Rate limits in Development tier**: 500 calls/app/24 h and 100/member/24 h, no BATCH_GET
   (**verified**) — keep polling sparse (e.g. one status read at +30 s and +5 min), and cap the
   number of pilot customers.
6. **Data rules (verified, Marketing API restrictions)**: never copy LinkedIn member data into the
   CRM, leads, audiences or exports; don't show it to anyone outside that customer's account; don't
   store other members' profile data (24 h cache max) or member social activity (48 h). What we
   store — our own post URNs, the customer's own text they typed in ConstructHUB, org URN/name/logo —
   is either unrestricted (IDs/URNs) or data the client gave us, which the storage table excludes.
7. **Disconnect**: delete tokens and LinkedIn rows at once (LinkedIn has no general revoke endpoint
   documented on the pages read; tell the user they can also remove the app in LinkedIn settings —
   **to confirm**). Account deletion runs the same purge.
8. **Versioning**: one `LINKEDIN_API_VERSION` env; reminder before each sunset.
9. **Reviewer account** (same as Meta): Social Media module enabled, no 2FA, sample image + video.
10. **Legal pages** below.

### 5.1 Terms — new paragraph for section 13

> **LinkedIn.** You may connect LinkedIn Pages you administer, and your own LinkedIn profile, to
> ConstructHUB's Social Media tool so that ConstructHUB can publish posts you write or approve. You
> are responsible for every post published through ConstructHUB, including AI-drafted text you
> approve; it must comply with the LinkedIn User Agreement and Professional Community Policies, and
> you must have the right to publish its content. ConstructHUB is not affiliated with or endorsed by
> LinkedIn.

### 5.2 Privacy policy — new section 4.5

> **4.5 LinkedIn**
>
> If you connect LinkedIn in Social Media, you sign in on LinkedIn and approve ConstructHUB's
> request. We ask LinkedIn for permission to see which LinkedIn Pages you administer, to publish
> posts you choose to those Pages and to your own profile, to read back those posts to confirm they
> were published, and to see your basic profile (name, photo and member ID) so we can show which
> profile is connected.
>
> **What we store:** your LinkedIn member ID, name and photo; the ID, name and logo of each Page you
> connect; the access token LinkedIn issues, stored encrypted, and its expiry; and, for each post you
> publish through ConstructHUB, the text and media you chose, the destinations and time, the post ID
> and link LinkedIn returns, and its status.
>
> **What we do not do:** we do not read your LinkedIn messages, connections, comments or reactions, or
> other members' profiles; we do not add LinkedIn data to the CRM, lead lists or audiences; we do not
> sell it or use it for advertising.
>
> **Deleting it:** choose Disconnect in Social Media and we delete the stored token, IDs and post
> records at once; you can also remove ConstructHUB from your LinkedIn settings. Deleting your
> ConstructHUB account deletes it too, or email support@constructhub.us and we will delete it within
> 30 days. Posts already published on LinkedIn stay there until you delete them on LinkedIn.

Plus a section 5 list item "**LinkedIn** — used, with your authorization, to publish posts you choose
to your LinkedIn Pages and profile. See LinkedIn's Privacy Policy
(https://www.linkedin.com/legal/privacy-policy)." and the section 6/8 bullets given in meta.md 5.3.

---

## 6. Review stages, timelines, limits, rejections

| Stage | What | Realistic time |
| --- | --- | --- |
| A | Company Page, app, Page verification, business email verification | 1 day |
| B | **Development tier** review: approved use case, verified business email, verified organization, verified website/domain, app verified by the Page (**verified** checklist) | no official figure; reports of days to several weeks **(to confirm)** |
| C | Build + pilot within Development tier limits; **must build core use cases within 12 months** (**verified**) | engineer time |
| D | **Standard tier** review: approved use case, valid privacy policy, compliance with terms/security/data storage, screencast (**verified**) | no official figure; reports of weeks **(to confirm)** |
| E | (Optional, not required for Standard) **Technical Sign Off** demo with a LinkedIn BD contact against CM-001…CM-028 — for formal partners; asks for analytics, comments, webhooks we don't build | skip |

**Limits before Standard tier (verified):** 500 calls per app and 100 per member per 24 h; BATCH_GET
not allowed; social-action webhooks off. "Standard tier … live production with no restrictions."
Whether non-role members can authorize the app in Development tier is not stated **(to confirm —
expect it works, within the call limits)**.

**Common rejection reasons and how to avoid them**

| Reason | Avoid by |
| --- | --- |
| Personal email (gmail etc.) or unverified business email | `@constructhub.us` address, verify the link first |
| App not verified by the company Page | Step 2.1.3 before requesting |
| Use case restricted/unsupported (social feeds on websites, lead/CRM enrichment, ad targeting, sales prospecting — **verified** list) | Use-case text says explicitly none of these happen; ConstructHUB's CRM must never receive LinkedIn data |
| App name/logo uses "Linked", "In", Microsoft marks (**verified**) | Plain ConstructHUB branding |
| Incomplete form fields (**verified**) | Fill every field |
| Screencast doesn't show full OAuth flow / a post being made / is not downloadable (**verified**) | Section 4 |
| Website can't be matched to the organization | Legal name on the site footer / about page **(to confirm the footer shows the legal entity)** |
| Other API products already on the app | New app, nothing else added |

A rejection means **a new app and a fresh Development tier request** (**verified**) — the redirect
URI, client ID and secret change, so keep them in env vars.

---

## 7. Only the owner can fill these in

- [ ] Legal name and registered address: ____
- [ ] LinkedIn Page URL and super admin: ____
- [ ] Business email used: ____
- [ ] Client ID: ____ (secret goes only in the server `.env`)
- [ ] Decision: post as member profile too (`w_member_social` + `r_basicprofile`) or Pages only: ____
- [ ] Test LinkedIn member + test Page for screencast/reviewers: ____
- [ ] ConstructHUB reviewer account: ____

## 8. Before sending

- [ ] Development tier: prerequisites 1.1–1.6 done, app verified by the Page, then request.
- [ ] Standard tier: section 5 built and deployed, legal pages live, screencast uploaded somewhere
      downloadable, every **(to confirm)** re-checked. Remove the DRAFT banner.

## 9. Sources read on 2026-10-11

- https://learn.microsoft.com/en-us/linkedin/marketing/community-management/community-management-overview (tiers, FAQ #4 "new apps without other products", rate limits)
- https://learn.microsoft.com/en-us/linkedin/marketing/community-management-app-review (prerequisites, review checks, screencast test cases, re-apply rule)
- https://learn.microsoft.com/en-us/linkedin/marketing/increasing-access (permission list, tier limits, 12-month rule)
- https://learn.microsoft.com/en-us/linkedin/marketing/quick-start (create app URL, steps)
- https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/posts-api (scopes, lifecycleState, headers)
- https://learn.microsoft.com/en-us/linkedin/marketing/community-management/organizations/organization-access-control-by-role
- https://learn.microsoft.com/en-us/linkedin/shared/authentication/authorization-code-flow (60-day tokens, redirect rules, refresh tokens limited)
- https://learn.microsoft.com/en-us/linkedin/marketing/data-storage-requirements · /restricted-use-cases
- https://learn.microsoft.com/en-us/linkedin/marketing/community-management/integration-requirements-community-management (Technical Sign Off)
