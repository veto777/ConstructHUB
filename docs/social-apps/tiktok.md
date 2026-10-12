# TikTok — application kit (DRAFT)

**Status: DRAFT, written 2026-10-11. Not submitted. Nothing here has been confirmed with TikTok.**
Blanks (`____`) are for the owner. **(verified 2026-10-11)** = read on developers.tiktok.com that
day (sources in section 9); **(to confirm)** = our understanding only.

The native TikTok connection is **built** (ConstructHUB Direct, `server/social/native-nets.ts` +
`server/social/native.ts`; admins only until `SOCIAL_NATIVE_PUBLIC=true`), including the TikTok post panel
of section 5.2 (`client/src/components/social-tiktok.tsx`) and the webhook (`server/social/tiktok-webhook.ts`),
on branch `social/tiktok-ux` (2026-10-12). Customers on a Blotato key or Outstand still reach TikTok through
those, with the same panel (without the live creator info).

Products: **Login Kit** (web) + **Content Posting API** with **Direct Post** enabled.

There are **two separate TikTok reviews**:

1. **App review** — gets the app approved/live with its products and scopes. Until then only the
   Sandbox works.
2. **Direct Post audit** — until it passes, "all content posted by unaudited clients will be
   restricted to private viewing mode" (**verified**), and at most 5 users can post per 24 h, each of
   whose accounts must be private at posting time (**verified**). For a contractor posting marketing
   videos, the feature is of no practical use until the audit passes.

---

## 1. Prerequisites the owner must have

| # | What | Where / click path | Status |
| --- | --- | --- | --- |
| 1 | A TikTok account for the owner to log in to the developer portal | tiktok.com | ____ |
| 2 | **TikTok for Developers** account, and an **organization** for ConstructHUB (rather than an individual developer) so the app belongs to the company and teammates can be added **(to confirm current labels)** | https://developers.tiktok.com → **Log in** → top-right profile → **Manage organizations / Create organization** → company name, website | ____ |
| 3 | Official website that is "valid, official, fully developed" — not a landing or login page — with **Privacy Policy and Terms of Service links visible without opening a menu** (**verified**) | https://constructhub.us — the marketing footer (`client/src/pages/landing.tsx`) shows "Terms of Use" and "Privacy Policy". **Check on a phone too: the links must be visible without a hamburger menu** | re-check |
| 4 | **Domain verification** of `constructhub.us` in the app's **URL properties** (DNS TXT signature record — **verified**: "Verifying a domain covers all paths under it and its subdomains"). Required for `PULL_FROM_URL`, which is **the only way to post photos** (**verified**) | App → **URL properties** → Add **Domain** `constructhub.us` → copy the signature → add a TXT record at the DNS host (Cloudflare) → **Verify** | ____ |
| 5 | App icon (clear, not resembling another brand — **verified**), app name **ConstructHUB** (must not reference social media companies — **verified**) | — | ____ |
| 6 | A **public** TikTok test account for the post-audit screencast and a **private** one for pre-audit testing; both added as Sandbox target users | — | ____ |

---

## 2. App setup

### 2.1 Create the app

1. https://developers.tiktok.com → **Manage apps** → **Connect an app** / **Create app** under the
   ConstructHUB organization **(to confirm label)**.
2. **App details** (**verified** requirements):
   - App icon; App name `ConstructHUB`; Category: Business / Productivity **(pick closest)**;
   - Description (3.1); Terms of Service URL `https://constructhub.us/terms`;
     Privacy Policy URL `https://constructhub.us/privacy`;
   - Platforms: **Web** → Website URL `https://constructhub.us` (the domain shown in the demo video
     must match it — **verified**).
3. **Add products**: **Login Kit** and **Content Posting API**. In Content Posting API turn on
   **Direct Post** (**verified**: "Enable the Direct Post configuration").
4. **Login Kit → Redirect URI** (Web): `https://constructhub.us/api/social/native/tiktok/callback`
   (https, absolute, static, no query string, no `#`, < 512 chars, max 10 URIs — **verified**).
5. **Scopes**: `user.info.basic`, `user.info.profile`, `user.info.stats`, `video.publish` (what
   `SCOPES.tiktok` in `server/social/native-nets.ts` asks for). Remove everything else (no `video.list`).
6. **Webhooks** (Callback URL): `https://constructhub.us/api/social/native/tiktok/webhook` (2.3).
7. **URL properties**: verify `constructhub.us` (1.4).
8. **Sandbox**: create a Sandbox, add the test TikTok accounts as target users; first-time apps must
   demonstrate in the Sandbox (**verified**).

### 2.2 Scopes (minimum)

| Scope | Why |
| --- | --- |
| `user.info.basic` | Show the connected account's display name and avatar and get its `open_id` **(to confirm: the creator-info call already returns nickname/avatar; `user.info.basic` is still the Login Kit base scope)** |
| `user.info.profile` | The account's `@username`, shown on Connected accounts and used for the post's link (`/v2/user/info/?fields=…username`) |
| `user.info.stats` | Followers, following, likes and video count on Social Media → Analytics (`server/social/insights.ts`) |
| `video.publish` | **Direct Post** of videos and photo posts to the customer's TikTok profile (**verified**: `DIRECT_POST` needs `video.publish`), plus `creator_info/query` and `status/fetch` |

Not requested: `video.upload` (only for "send to TikTok inbox as draft" — `MEDIA_UPLOAD`;
add later if we want a draft mode, **verified** distinction), `video.list` (dropped 2026-10-12: per-post
TikTok stats are not read; Analytics says to see them in the TikTok app), research/ads/DM scopes.

### 2.3 Webhooks (verified event names)

- `authorization.removed` — the user deauthorized ConstructHUB in TikTok (or deleted / banned
  account; `reason` 0–5). The token is already revoked. **Delete that open_id's tokens and rows.**
  TikTok has no Meta-style deletion callback; this is the equivalent.
- `post.publish.failed`, `post.publish.complete`, `post.publish.publicly_available`,
  `post.publish.no_longer_publicaly_available` (sic) — optional; we also poll `status/fetch`.
- Body: `client_key`, `event`, `create_time`, `user_openid`, `content` (JSON string).
- Signature (**verified 2026-10-12**, https://developers.tiktok.com/doc/webhooks-verification): header
  `TikTok-Signature: t=<timestamp>,s=<signature>`; signature = HMAC-SHA256 with the **client secret** over
  `` `${t}.${raw JSON body}` `` (hex, 64 chars in TikTok's example). TikTok leaves the tolerance to us: we
  refuse anything more than 5 minutes off. **Built:** `POST /api/social/native/tiktok/webhook`
  (`server/social/tiktok-webhook.ts`) — bad/stale signature → 401; `authorization.removed` deletes that
  `user_openid`'s TikTok accounts and tokens; `post.publish.*` → 200, and the worker re-reads that post's
  status at once. Every valid request gets 200.

### 2.4 Tokens and endpoints (verified)

- Authorize: `https://www.tiktok.com/v2/auth/authorize/?client_key=…&scope=user.info.basic,user.info.profile,user.info.stats,video.publish&response_type=code&redirect_uri=https://constructhub.us/api/social/native/tiktok/callback&state=…`
  (PKCE for web is not mentioned on the Login Kit web page — **to confirm**; add it anyway if the
  token endpoint accepts `code_verifier`.) Users can untick toggleable scopes — check granted scopes.
- Token `POST https://open.tiktokapis.com/v2/oauth/token/`; **access token 24 h, refresh token 365
  days**; refresh may return a new refresh token — always store the newest.
- Revoke `POST https://open.tiktokapis.com/v2/oauth/revoke/` (client_key, client_secret, token).
- `POST /v2/post/publish/creator_info/query/` → nickname, avatar, `privacy_level_options`,
  comment/duet/stitch disabled flags, `max_video_post_duration_sec`.
- Video: `POST /v2/post/publish/video/init/` with `post_info` (title ≤ 2200, `privacy_level`,
  `disable_comment/duet/stitch`, `video_cover_timestamp_ms`, `brand_content_toggle`,
  `brand_organic_toggle`, `is_aigc`) and `source_info` `FILE_UPLOAD` (chunks 5–64 MB, last ≤ 128 MB,
  ≤ 1000 chunks, upload URL valid 1 h) or `PULL_FROM_URL` (verified domain).
- Photos: `POST /v2/post/publish/content/init/`, `media_type=PHOTO`, `post_mode=DIRECT_POST`,
  `PULL_FROM_URL` only, ≤ 35 images, JPEG/WebP, ≤ 1080p, ≤ 20 MB each; title ≤ 90, description ≤ 4000.
- Status: `POST /v2/post/publish/status/fetch/` with `publish_id` → `PROCESSING_UPLOAD`,
  `PROCESSING_DOWNLOAD`, `PUBLISH_COMPLETE`, `FAILED` (+ `fail_reason`),
  `publicaly_available_post_id` after moderation (~1 min, sometimes hours).
- Video specs: MP4/WebM/MOV, H.264 recommended, 23–60 fps, 360–4096 px, ≤ 4 GB, ≤ 10 min (the
  creator's own maximum may be 3/5/10 min — enforce `max_video_post_duration_sec`).

---

## 3. Form fields — ready-to-paste text

### 3.1 App description

> ConstructHUB is a web platform for US contractors — roofers, plumbers, HVAC and remodeling
> companies — to run their marketing and operations. In ConstructHUB's Social Media tool, a contractor
> connects their own TikTok account with Login Kit and publishes their own job-site videos and photos
> (before-and-after projects, tips, crew at work) to it. For each post they see their TikTok account
> name, write or edit the caption, choose who can view it, choose whether comments, Duet and Stitch
> are allowed, declare commercial content, and confirm before anything is sent. ConstructHUB then
> shows the post's publishing status.

### 3.2 Per product / scope explanation (App review → "How will you use this product/scope?")

**Login Kit / `user.info.basic`**
> Used only to let a signed-in ConstructHUB customer connect their own TikTok account to the Social
> Media tool, and to show that account's display name and avatar so they always know which account a
> post will go to. TikTok login is not used to sign in to ConstructHUB.

**`user.info.profile`**
> Used to show the connected TikTok account's @username in ConstructHUB's Connected accounts list and
> on each post's status, and to link a published post to the right TikTok profile.

**`user.info.stats`**
> Used only to show the connected account's own follower, following, like and video counts on
> ConstructHUB's Social Media → Analytics page, beside the customer's other networks.

**Content Posting API — Direct Post / `video.publish`**
> The customer picks one of their own videos (or a set of photos) in ConstructHUB, and on the TikTok
> post screen we fetch their latest creator info, show their TikTok nickname, let them type or edit
> the caption (AI suggestions are editable preset text, never forced), select a privacy level from
> exactly the options TikTok returns (no default), turn on Comment/Duet/Stitch only if they choose
> (all off by default; greyed out where their TikTok settings disable them), and complete the
> commercial-content disclosure. After they tick the declaration and click Post, we upload the
> content with Direct Post and poll the publish status so they can see "Processing", "Posted" or the
> reason it failed. We add no watermark or branding and never post without the customer's explicit
> action.

### 3.3 Direct Post audit application (after app approval)

| Field (expected — **to confirm on the form**) | Answer |
| --- | --- |
| Company, website, contact | ConstructHUB, https://constructhub.us, support@constructhub.us |
| Use case | as 3.2 |
| Who are the creators | Small and medium US contracting businesses posting their own original job-site content; a broad, public audience of customers, not internal or test use (**verified**: clients must serve a wide audience, help authentic creators post original content, and not copy content from other platforms) |
| Expected daily active posting creators | `____` (owner; the per-client creator cap is set from this estimate — **verified**). Suggest a realistic 3-month figure, e.g. 50 |
| Expected posts per creator per day | 1–2 (TikTok caps each creator at about 15 Direct Posts per day across all apps — **verified**) |
| Demo video(s) | section 4, Part B |
| Compliance with UX guidelines | point-by-point list from 5.2 with screenshots |

---

## 4. Demo video scripts

Rules (**verified**): show every selected product and scope; the real website with clear UI; the
domain in the video must match the Website URL; first-time apps must demonstrate using the Sandbox;
up to 5 videos, 50 MB each.

**Part A — app review (Sandbox app, private test account)**
1. Browser at `https://constructhub.us/auth`, address bar visible; sign in as the reviewer account.
2. Social Media → TikTok card, **Not connected**: explanation, link to TikTok's terms.
3. **Connect TikTok** → TikTok authorize page (Sandbox client) listing the scopes → **Authorize**.
4. Back on ConstructHUB: the connected account's @username and avatar (`user.info.basic`, `user.info.profile`).
5. **New post** → choose a 20-second vertical video → select TikTok → the TikTok post panel:
   - "Posting to: @nickname" (fresh from `creator_info/query`);
   - caption field, typed by the user (show editing an AI suggestion);
   - **Who can view this video** dropdown with no default — open it, show the options, choose
     "Only me" (pre-audit);
   - Allow Comment / Duet / Stitch checkboxes, all unticked, one greyed out if disabled in the app;
   - **Disclose post content** toggle (off) — turn on, show "Your brand" / "Branded content" and
     the label prompts, turn off again;
   - the declaration "By posting, you agree to TikTok's Music Usage Confirmation" with link;
   - the video preview.
6. Click **Post now** (disabled, with its reason, until "Who can view" is chosen) → status Processing → Posted; note "It may take a few minutes for the
   post to appear on your profile". Open TikTok on the phone/web and show the private post.
7. Photo post: choose 3 photos → same panel (only Allow Comment shown for photos) → Post → status.
8. Social Media → **Analytics**: the TikTok account's followers, following, likes and videos (`user.info.stats`).
8. **Disconnect** → Not connected.

**Part B — Direct Post audit** (same flow, after app approval; if allowed, with a production client
and a public account): additionally show Branded content selected → "Only me" disabled with the
tooltip "Branded content visibility cannot be set to private."; the declaration switching to
"Branded Content Policy and Music Usage Confirmation"; publish button disabled until "Your brand"
or "Branded content" is chosen when the toggle is on; the "can't post now, try later" message when
creator info says posting is unavailable; a video longer than `max_video_post_duration_sec` being
refused before upload.

---

## 5. What ConstructHUB must build or change BEFORE submitting

### 5.1 Server

Status 2026-10-12 (branch `social/tiktok-ux`): items 1, 2, 5, 6 **built**; 3 built for `PULL_FROM_URL`
(videos and photos — needs the domain verified; `FILE_UPLOAD` not built); 4 built (polling + webhook
nudge; error codes shown as TikTok's text, not yet mapped one by one); 7 built in part (send time
re-checks creator info and stops with "Choose who can view this TikTok post again — your TikTok
options changed"; the scheduling question for TikTok is still open).

1. **Connect / callback** `POST /api/social/native/connect` (`network: "tiktok"`) and
   `GET /api/social/native/tiktok/callback` (state in session, 10 min; check granted scopes include
   `video.publish`); tokens encrypted (`SOCIAL_ENCRYPTION_KEY` pattern); **refresh job** — access
   tokens die after 24 h, so refresh before each publish and daily.
2. **Creator info** route called every time the TikTok post panel opens (not cached). **Built:**
   `GET /api/social/native/tiktok/creator-info?accountId=…&businessId=…` →
   `{ nickname, username, avatarUrl, privacyLevelOptions, commentDisabled, duetDisabled, stitchDisabled,
   maxVideoPostDurationSec, canPost, message? }` (`canPost: false` on TikTok's spam-risk / active-user-cap codes).
3. **Publish worker**: video `FILE_UPLOAD` from our storage in 5–64 MB chunks (no domain
   verification needed), photos `PULL_FROM_URL` from a verified domain → serve photos from an R2
   custom domain on constructhub.us (e.g. `media.constructhub.us`), **with no redirects** (3xx URLs
   are invalid — **verified**). Convert images to JPEG/WebP ≤ 1080p.
4. **Status**: poll `status/fetch` (≤ 30/min per token — **verified**) and/or the `post.publish.*`
   webhooks; store `publish_id`, status, `publicaly_available_post_id`, our own failure sentence.
   Map `unaudited_client_can_only_post_to_private_accounts`, `spam_risk_too_many_posts`,
   `reached_active_user_cap`, `privacy_level_option_mismatch`, `url_ownership_unverified` to plain
   messages (**verified** codes). Respect 6 init requests/min per token.
5. **Webhook** `POST /api/social/native/tiktok/webhook`: verify signature; on
   `authorization.removed` delete that open_id's tokens and TikTok rows. **Built** (2.3).
6. **Disconnect**: call `/v2/oauth/revoke/`, delete rows. **Built** (`removeNativeAccounts` revokes each
   TikTok token first, best effort). Account deletion (`server/account/delete.ts`) deletes the rows but
   does **not** revoke yet.
7. **No scheduling surprise**: TikTok requires that content is sent "only after the user has
   explicitly consented" (**verified**). A scheduled TikTok post is acceptable only if the user
   completed the full TikTok panel and consent at scheduling time; at send time, re-query creator
   info — if the chosen privacy level is no longer offered or posting is blocked, **don't post**,
   mark "Needs your attention" **(to confirm with TikTok that scheduled Direct Post is acceptable —
   it is not addressed in the guidelines read)**.

### 5.2 Posting UX (TikTok Content Sharing Guidelines — all **verified**)

Built 2026-10-12 in `client/src/components/social-tiktok.tsx` (the panel under a ticked TikTok account in
Social Media → New post) and `client/src/pages/social-media.tsx` (declaration above Post, blockers);
`[x]` = built, `[ ]` = still open.

- [x] Fetch creator info when the post page renders; show the creator's **nickname**; if they can't
      post now, stop and say "try again later"; check video duration against
      `max_video_post_duration_sec`.
- [x] **Title/caption** user-editable; AI drafts and hashtags are editable preset text.
- [x] **Privacy** dropdown from `privacy_level_options`, **no default**, user must pick.
- [x] **Allow Comment / Duet / Stitch**: none checked by default; greyed out when disabled in the
      creator's settings; photo posts show only Allow Comment.
- [x] **Commercial content disclosure** toggle, off by default; when on, "Your brand" and "Branded
      content" checkboxes, at least one required (publish disabled with a hover explanation
      otherwise); prompts: Your brand → "Your photo/video will be labeled as 'Promotional content'";
      Branded content (alone or both) → "labeled as 'Paid partnership'".
- [x] Branded content can't be private: disable "Only me" with the tooltip "Branded content
      visibility cannot be set to private." (or switch to public and tell the user).
- [x] Declaration above the Post button: default/Your brand → "By posting, you agree to TikTok's
      Music Usage Confirmation"; Branded content → "… TikTok's Branded Content Policy and Music Usage
      Confirmation" (links).
- [x] **Preview** of the content before posting.
- [x] **No watermarks, logos or ConstructHUB branding** added to the media.
- [x] Content sent only after explicit consent (the Post click).
- [x] Tell the user processing can take a few minutes; show status.
- [ ] `is_aigc`: offer an "AI-generated content" toggle when the media itself is AI-made (TikTok
      labels it) — not needed for AI-drafted captions **(to confirm TikTok's view)**.
- [ ] Original content only: don't offer to post media pulled from other platforms (e.g. importing
      a YouTube or Google Business Profile video into a TikTok post) — **verified** intent rule
      "must not copy content from other platforms"; photos the contractor uploaded themselves are
      fine. Check the Social Media composer's "library/GBP sources" (`server/social/gbp-sources.ts`)
      against this before the audit.

### 5.3 Terms — new paragraph for section 13

> **TikTok.** You may connect your own TikTok account to ConstructHUB's Social Media tool to publish
> videos and photos you choose. Each time, you choose the caption, who can view the post, whether
> comments, Duet and Stitch are allowed, and whether it is commercial content. By posting to TikTok
> through ConstructHUB you agree to TikTok's Terms of Service, Community Guidelines and Music Usage
> Confirmation (and its Branded Content Policy when you mark a post as branded content), and you
> confirm you own or have permission to publish everything in it. ConstructHUB is not affiliated with
> or endorsed by TikTok.

### 5.4 Privacy policy — new section 4.6

> **4.6 TikTok**
>
> If you connect TikTok in Social Media, you log in on TikTok and approve ConstructHUB's request to
> see your basic account information (display name, avatar and an account identifier) and to publish
> content to your TikTok account when you ask it to.
>
> **What we store:** your TikTok account identifier (open ID), display name and avatar; the
> permissions you granted; the access and refresh tokens TikTok issues, stored encrypted; and, for
> each post you publish through ConstructHUB, the caption, privacy setting, interaction settings and
> commercial-content choices you made, the media you chose, the publish ID and post ID TikTok returns,
> and its status. Media sent to TikTok is kept in your ConstructHUB media library until you delete
> it; temporary copies prepared for TikTok are deleted within 24 hours **(engineer: match reality)**.
>
> **What we do not do:** we do not read your TikTok videos, followers, comments, messages or
> statistics; we do not publish anything without your confirmation; we add no watermark; we do not
> sell TikTok data or use it for advertising.
>
> **Deleting it:** choose Disconnect in Social Media — we revoke our access with TikTok and delete the
> stored tokens and identifiers at once. If you remove ConstructHUB from your TikTok settings
> (Settings and privacy → Security → Apps and services permissions **(to confirm path)**), TikTok
> notifies us and we delete the same data. Deleting your ConstructHUB account deletes it too, or
> email support@constructhub.us and we will delete it within 30 days. Posts already on TikTok stay
> there until you delete them in TikTok.

Plus a section 5 list item "**TikTok** — used, with your authorization, to publish videos and photos
you choose to your TikTok account. See TikTok's Privacy Policy (https://www.tiktok.com/legal/privacy-policy-us)."

---

## 6. Review stages, timelines, limits, rejections

| Stage | What | Realistic time |
| --- | --- | --- |
| A | Developer account, organization, app, products, URL property verified | 1 day (DNS TXT may take hours) |
| B | Build section 5 and test in **Sandbox** with target users | engineer time |
| C | **App review** (Login Kit + Content Posting API, scopes) with the Part A demo | no official figure; reports of days to ~2 weeks **(to confirm)** |
| D | Unaudited production: **private-only posts, ≤ 5 posting users / 24 h, their accounts must be private** (**verified**) — internal pilot only | — |
| E | **Direct Post audit** with Part B demo and usage estimates | no official figure; third-party reports 2–6 weeks **(unverified)** |
| F | Audited: public posts; a per-client daily active-creator cap from the audit estimate; ~15 posts/creator/day across all apps (**verified**) | — |

**Common rejection reasons (from TikTok's guidelines, verified) and how to avoid them**

| Reason | Avoid by |
| --- | --- |
| Website is a landing/login page, or Privacy/Terms links hidden in a menu or broken | Use https://constructhub.us with footer links visible on mobile and desktop |
| App described as in development/testing or personal use | Describe the live product for contractors (3.1) |
| Name/icon referencing social media companies or resembling a brand | "ConstructHUB" + own icon |
| Unused products/scopes left selected | Only Login Kit + Content Posting API; only the four scopes of 2.2, each shown in the demo (4, Part A steps 4 and 8) |
| Demo doesn't show every product/scope, wrong domain, not in Sandbox for a first-time app | Section 4 Part A |
| (Audit) Missing any UX element of 5.2 — privacy default set, interactions pre-ticked, missing disclosure/declaration, watermark, no preview **(the most common audit failure reported by third parties — to confirm)** | Build every checkbox in 5.2, screenshot each in the audit form |
| (Audit) Use case looks internal/test or reposts others' content | Real customers, original content only |

---

## 7. Only the owner can fill these in

- [ ] TikTok developer organization name: ____ · Client key: ____ (secret only in `.env`)
- [ ] Expected daily active posting creators / posts per day (audit): ____
- [ ] Test TikTok accounts (private for pre-audit, public for audit): ____
- [ ] Decision: allow scheduled TikTok posts, or "Post now" only for TikTok: ____
- [ ] ConstructHUB reviewer account: ____

## 8. Before sending

- [ ] Section 5 built and deployed; legal pages live; domain verified.
- [ ] Sandbox flow recorded; every **(to confirm)** re-checked. Remove the DRAFT banner.

## 9. Sources read on 2026-10-11

- https://developers.tiktok.com/doc/content-sharing-guidelines (UX rules, unaudited limits, caps)
- https://developers.tiktok.com/doc/content-posting-api-get-started
- https://developers.tiktok.com/doc/content-posting-api-reference-direct-post (fields, error codes, 6/min)
- https://developers.tiktok.com/doc/content-posting-api-reference-photo-post (photos, PULL_FROM_URL only)
- https://developers.tiktok.com/doc/content-posting-api-reference-get-video-status (statuses, 30/min, webhooks)
- https://developers.tiktok.com/doc/content-posting-api-media-transfer-guide (domain verification, chunks, specs)
- https://developers.tiktok.com/doc/login-kit-web (redirect URI rules) · /doc/oauth-user-access-token-management (24 h / 365 d, revoke)
- https://developers.tiktok.com/doc/webhooks-events (authorization.removed) · /doc/app-review-guidelines
