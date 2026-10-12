# Meta (Facebook Pages + Instagram) — application kit (DRAFT)

**Status: DRAFT, written 2026-10-11. Not submitted. Nothing here has been confirmed with Meta.**
Blanks (`____`) are for the owner; nothing in them was guessed. Statements about Meta's rules carry
one of two marks:

- **(verified 2026-10-11)** — read on developers.facebook.com that day (source URL given in section 9).
- **(to confirm)** — our understanding, not found on an official page that day; check before relying on it.

When this kit was written the native Meta connection was **not built**; it now exists as
ConstructHUB Direct (`server/social/native.ts`, connections encrypted with `SOCIAL_ENCRYPTION_KEY`).
Section 5 lists what had to be built before anything is submitted.

Proposed shape (one Meta app for both networks):

- **App type: Business**, use cases **"Manage everything on your Page"** and **"Manage messaging &
  content on Instagram"**, login through **Facebook Login for Business** (one consent covers the
  customer's Pages and the Instagram professional accounts linked to them).
- Alternative for Instagram accounts that are NOT linked to a Facebook Page: **Instagram API with
  Instagram Login** (separate Instagram app ID inside the same Meta app, separate scopes
  `instagram_business_basic` + `instagram_business_content_publish`). Recommended as phase 2 only;
  it doubles the review and the code. Section 2.4.

---

## 1. Prerequisites the owner must have

| # | What | Where / click path | Status |
| --- | --- | --- | --- |
| 1 | A personal Facebook account for the owner, with two-factor authentication on (Meta requires 2FA for developer accounts and Business portfolio admins **(to confirm)**) | facebook.com → Settings & privacy → Accounts Center → Password and security → Two-factor authentication | ____ |
| 2 | Register as a Meta developer with that account | https://developers.facebook.com → **Get Started** (top right) → accept Platform Terms → verify phone/email → role "Developer" | ____ |
| 3 | A **Business portfolio** (formerly Business Manager) for ConstructHUB, legal name exactly as on the documents | https://business.facebook.com → **Create account** (or Settings if one exists) → Business info: legal name, address, phone, website `https://constructhub.us`, business email `support@constructhub.us` | ____ (does one already exist from Google Ads/GBP work? It is Meta-only, so probably not) |
| 4 | **Business Verification** of that portfolio (required for Advanced Access — **verified 2026-10-11**) | https://business.facebook.com/settings → **Security Center** → **Start verification** (or from the App Dashboard: **App settings → Basic → Verification**, or the prompt during App Review) | ____ |
| 5 | Documents for item 4: one official document showing the legal name (articles of incorporation/organization, IRS EIN letter CP-575 / 147C, state business license), and one showing name + address or phone (utility bill, bank statement) **(to confirm the current accepted list on the verification screen)** | Upload during item 4. The legal name, address and phone must match the portfolio exactly; a website on the same domain as the business email speeds it up | ____ |
| 6 | **Domain verification** of `constructhub.us` in the Business portfolio (strongly recommended; required for some features, not stated as an App Review requirement **(to confirm)**) | business.facebook.com/settings → **Brand safety → Domains → Add** → `constructhub.us` → choose DNS TXT record (add at the DNS host / Cloudflare) or meta-tag on the home page → **Verify** | ____ |
| 7 | A **Facebook Page for ConstructHUB** (used as the app's own test asset and to look legitimate) and an **Instagram professional account** linked to it | facebook.com/pages/create; Instagram app → Settings → Account type and tools → Switch to professional account; link it in Page settings → Linked accounts → Instagram | ____ |
| 8 | A test Page + test Instagram professional account that is not the company's real one, for the screencast | same as 7 (a throw-away "ConstructHUB Demo Roofing" Page is fine) | ____ |
| 9 | App icon 1024×1024 PNG/JPG, no Meta trademarks (**verified**: icon must not include Meta trademarks or logos) | — | ____ |
| 10 | Public pages live: https://constructhub.us/privacy (with the Meta section in 5.3), https://constructhub.us/terms, https://constructhub.us/data-deletion (new) | — | not yet (section 5) |

**Tech Provider.** ConstructHUB will access Pages owned by *other* businesses' portfolios, so the app
must be marked as a Tech Provider: App Dashboard → **Become a Tech Provider** → **Yes, I'm a Tech
Provider** (**verified 2026-10-11**: "Required only if your app accesses business data owned by other
business portfolios… requires additional data questions and App Review approval before publishing").
Meta also refers to an **Access Verification** step for tech providers; we did not find a page that
defines it **(to confirm what it asks — expect questions about the business, the product and how
clients' data is handled; follow the dashboard prompt)**.

---

## 2. App setup

### 2.1 Create the app

1. https://developers.facebook.com/apps → **Create app**.
2. App name: **ConstructHUB** (must not contain "Facebook", "Insta", "Meta" etc.). App contact
   email: `support@constructhub.us` (Meta sends App Review notices here — must be monitored).
3. Use cases: select **Manage everything on your Page** and **Manage messaging & content on
   Instagram** (labels as shown in Meta's docs, **verified**; the dashboard wording may differ
   slightly). If asked "Are you building for yourself or for clients?": **Clients**.
4. Business portfolio: pick the ConstructHUB portfolio from 1.3.
5. App type, if asked: **Business** (**verified**: Facebook Login for Business needs a Business app).

### 2.2 Permissions to request (minimum set)

Facebook Pages (use case "Manage everything on your Page"; `business_management`, `pages_show_list`
and `public_profile` are added by default — **verified**):

| Permission | Why ConstructHUB needs it | Depends on (Meta, verified) |
| --- | --- | --- |
| `pages_show_list` | List the Pages the customer manages so they pick which one(s) to connect | — |
| `pages_read_engagement` | Read back the Page's name/picture and the post we published (permalink, published time) to show "Published" with a link. Dependency of `pages_manage_posts` | `pages_show_list` |
| `pages_manage_posts` | Publish the customer's text, link, photo, video and Reel posts to their Page | `pages_read_engagement`, `pages_show_list` |
| `business_management` | Added by default by the use case. Needed when the Page is owned by a Business portfolio so the Page appears in the token's asset list **(to confirm the exact need; it is default and may not be removable)** | `pages_read_engagement`, `pages_show_list` |

Instagram, via Facebook Login for Business (use case "Manage messaging & content on Instagram"):

| Permission | Why | Depends on (verified) |
| --- | --- | --- |
| `instagram_basic` | Read the linked Instagram professional account's username and picture to show which account is connected; read back the published media's permalink | `pages_read_user_content` **(listed as a dependency on the permissions page — confirm whether the dashboard adds it automatically)**, `pages_show_list` |
| `instagram_content_publish` | Publish the customer's photos, carousels and Reels to their Instagram professional account; read container `status_code` | `instagram_basic`, `pages_read_engagement`, `pages_show_list` |

**Do NOT request** (keeps review small and honest): `publish_video` (**verified**: it is for *live*
video; the Video API's requirements for an ordinary Page video and the Reels API list only
`pages_show_list`, `pages_read_engagement`, `pages_manage_posts`), `pages_manage_engagement`,
`pages_read_user_engagement`, `pages_manage_metadata` (only needed for webhooks), `read_insights`,
`instagram_manage_insights`, `instagram_manage_comments`, any `*_messages` permission,
`ads_management`, `ads_read`. Insights are not in scope; add `read_insights` /
`instagram_manage_insights` later with their own review if the product shows statistics.

**Note (verified):** Meta's Instagram publishing page says that with Facebook Login for Business, if
the app user has a Business Manager role on the connected Page, `ads_management` and `ads_read` must
also be added. Many contractors' Pages sit in a Business portfolio. **(to confirm — test with a Page
owned by a portfolio during Standard Access; if publishing fails without them, they must be added
and justified, which makes the review harder. Decide after testing, not now.)**

### 2.3 Facebook Login for Business settings

App Dashboard → **Facebook Login for Business → Settings** (**verified** field names):

| Field | Value |
| --- | --- |
| Client OAuth login | Yes |
| Web OAuth login | Yes |
| Enforce HTTPS | Yes |
| Use Strict Mode for redirect URIs | Yes |
| Valid OAuth Redirect URIs | `https://constructhub.us/api/social/oauth/meta/callback` (add the same path on any other host customers use, e.g. `https://constructionhub.app/...` if that domain serves the tool — it is in `SITE_DOMAINS`) |
| Deauthorize Callback URL | `https://constructhub.us/api/social/oauth/meta/deauthorize` |
| Data Deletion Request URL | `https://constructhub.us/api/social/oauth/meta/data-deletion` |
| Login from devices | No |

App Dashboard → **Facebook Login for Business → Configurations → Create configuration**:

- Name: `ConstructHUB Social Media publishing`
- Login variation: General
- Token type: **User access token** (we exchange it for long-lived Page tokens server-side). System-user
  tokens are an alternative (never expire, bound to the client's portfolio) but require the client's
  Page to be in a portfolio; not chosen for contractors with personal-profile-managed Pages **(owner/engineer decision)**.
- Assets: Pages, Instagram accounts.
- Permissions: exactly the six in 2.2.
- Save → copy the **Configuration ID** into env `META_LOGIN_CONFIG_ID`. The login URL then uses
  `config_id=` instead of `scope=` (**verified**: Meta recommends not using `scope` with configurations).

App Dashboard → **App settings → Basic**:

| Field | Value |
| --- | --- |
| Display name | ConstructHUB |
| App domains | `constructhub.us` |
| Contact email | `support@constructhub.us` |
| Privacy Policy URL | `https://constructhub.us/privacy` |
| Terms of Service URL | `https://constructhub.us/terms` |
| User data deletion | choose **Data deletion callback URL** → `https://constructhub.us/api/social/oauth/meta/data-deletion` |
| App icon | 1024×1024 (1.9) |
| Category | Business and pages **(choose the closest offered)** |
| Data Protection Officer | only if the dashboard requires it (needed when doing business in the EU — **verified**); ConstructHUB is US-only: `____` |
| Website (Platform → Add platform → Website) | Site URL `https://constructhub.us/` |

### 2.4 Optional phase 2: Instagram Login (Instagram accounts without a Facebook Page)

App Dashboard → **Instagram → API setup with Instagram login** → **3. Set up Instagram business
login** → Business login settings (**verified** location): OAuth redirect URI
`https://constructhub.us/api/social/oauth/instagram/callback`; set the deauthorize and data deletion
URLs there too if the form offers them **(to confirm field names)**. Scopes:
`instagram_business_basic`, `instagram_business_content_publish` (the old `business_*` scope names
were deprecated 2025-01-27 — **verified**). Tokens: 1-hour short-lived → 60-day long-lived, refresh
after 24 h and before 60 days (**verified**). Requires its own App Review entries.

### 2.5 Webhooks

None required for publishing. Facebook post and Instagram container status are read by polling
(section 5). Do not add the Webhooks product (it pulls in `pages_manage_metadata`).

### 2.6 Tokens (verified unless marked)

- Login returns a short-lived user token → exchange server-side for a long-lived user token (~60
  days) → `GET /me/accounts` returns **Page access tokens**; a Page token derived from a long-lived
  user token does not expire **(to confirm current behaviour)** but is invalidated by password
  change, removal of the app, or loss of the Page role.
- Instagram via Facebook Login uses the Page token on `graph.facebook.com`
  (`/{ig-user-id}/media`, `/{ig-user-id}/media_publish`).

---

## 3. Form fields — ready-to-paste text

### 3.1 App description / "Tell us how you'll use the app"

> ConstructHUB (https://constructhub.us) is a web platform for US contractors — roofers, plumbers,
> remodelers, HVAC and similar trades — and the marketing agencies that work for them. Its Social
> Media tool lets a signed-in ConstructHUB customer connect the Facebook Pages and Instagram
> professional accounts that they manage, write a post (or ask ConstructHUB's AI to draft one, which
> they review and edit), attach their own job-site photos or videos, choose which connected accounts
> receive it and when, and publish it. ConstructHUB then shows whether each post was published, with
> a link to it, or why it failed. ConstructHUB publishes only the posts the customer has written or
> approved, only to the accounts they chose. It does not read or send messages, does not manage ads,
> does not read followers, comments or other people's data, and does not post anything on its own.

### 3.2 Per-permission "How will your app use this permission?" (each one different — copy-paste between permissions is a listed rejection reason, **verified**)

**`pages_show_list`**
> After a ConstructHUB customer clicks "Connect Facebook" in Social Media and approves the Facebook
> Login dialog, ConstructHUB calls /me/accounts to list the Facebook Pages they manage. The customer
> sees the Pages by name and picture and ticks the Page(s) their business posts to (for example
> "Smith Roofing LLC"). Only the ticked Pages are saved. Without this permission the customer cannot
> choose which of their Pages receives their posts.

**`pages_read_engagement`**
> ConstructHUB uses this permission only to read the connected Page's name and profile picture (shown
> next to the post composer so the customer can see where a post will go) and, after publishing, to
> read back the post we just created — its permalink and published time — so the customer sees
> "Published" with a "View on Facebook" link in their post history. We do not read the Page's other
> posts, comments, reactions or followers. It is also a required dependency of pages_manage_posts.

**`pages_manage_posts`**
> This is the core of the integration. A ConstructHUB customer writes a post in Social Media (text,
> optional link, and their own photos or a video or a vertical Reel), picks their connected Facebook
> Page and a publish time, and clicks "Publish" or "Schedule". At that time ConstructHUB publishes
> exactly that post to their Page using the Page access token they granted (POST /{page-id}/feed,
> /{page-id}/photos, /{page-id}/videos or /{page-id}/video_reels). Posts can be AI-drafted inside
> ConstructHUB, but nothing is published until the customer has reviewed the text and clicked
> Publish or Schedule. ConstructHUB never edits or deletes posts it did not create, and only deletes
> a post if the customer clicks Delete on that post in ConstructHUB **(remove the last clause if
> delete is not built)**.

**`business_management`**
> Many contractors' Facebook Pages are owned by a Business portfolio rather than directly by their
> personal profile. ConstructHUB uses this permission only so that those Pages appear in the list of
> Pages the customer can choose to connect, and to obtain the Page access token for the Page they
> chose. We do not read or change Business portfolio settings, people, ad accounts or any other
> business asset.

**`instagram_basic`**
> After the customer connects a Facebook Page, ConstructHUB reads the Instagram professional account
> linked to that Page — its username and profile picture only — and shows it so the customer can
> confirm "Posting to Instagram as @smithroofing". After a post is published we read back its
> permalink so the post history can link to it. We do not read the account's other media, followers,
> comments or insights.

**`instagram_content_publish`**
> A ConstructHUB customer chooses their connected Instagram professional account as a destination
> for a post they wrote or approved in Social Media — one photo, a carousel of up to 10 of their own
> job-site photos/videos, or a vertical Reel — with their caption. At the chosen time ConstructHUB
> creates the media container, checks its status_code until FINISHED, and publishes it with
> media_publish, then shows the customer "Published" with a link, or the reason it failed. The
> content and caption are always the customer's own; nothing is posted without their explicit
> Publish or Schedule action.

### 3.3 Data handling questions (App Review → Data handling)

| Question (paraphrased) | Answer |
| --- | --- |
| Do you share Platform Data with data processors / service providers? | Yes. Our hosting provider (`____` — the server host for constructhub.us) stores the data; Cloudflare R2 stores media files temporarily while they are sent to Meta. Neither uses the data for its own purposes. No AI provider receives Platform Data **(engineer to confirm: captions are written before publishing and nothing read from Meta is sent to an AI)**. |
| Countries where Platform Data is processed | United States `____ (confirm hosting region)` |
| Responded to national-security requests for user data in the past 12 months? | `____` (owner, truthfully; almost certainly "No") |
| Policies on such requests | `____` (owner: e.g. "We require a valid legal process, review each request, challenge overbroad requests, disclose the minimum, and notify users where lawful") |
| Who is responsible for Platform Data (company legal name) | `____` |

### 3.4 Reviewer instructions (App Review → Provide reviewer instructions)

> 1. Go to https://constructhub.us/auth and sign in with the ConstructHUB test account:
>    email `____` password `____` (no two-factor authentication; the Social Media module is enabled
>    on this account).
> 2. Open Social Media from the left menu (https://constructhub.us/social-media).
> 3. In "Facebook & Instagram", click **Connect Facebook**. Log in with your own Meta test user, which
>    should manage a test Page with a linked Instagram professional account.
> 4. In the Facebook dialog, choose the Page and the Instagram account and approve the permissions.
> 5. Back in ConstructHUB, tick the Page and Instagram account to connect and click Save.
> 6. Click **New post**, write a caption, attach the sample photo from "Media library" (or upload any
>    JPEG), select the Page and the Instagram account, choose **Publish now** and click Publish.
> 7. The post list shows Publishing → Published with "View on Facebook" / "View on Instagram" links.
> 8. To test video: attach the sample vertical video (9:16, 20 s) from the library and choose
>    "Reel" for both destinations.
> 9. To disconnect: Social Media → Facebook & Instagram → Disconnect. This deletes the stored tokens.
> ConstructHUB does not use Facebook Login to sign people in to ConstructHUB itself; it is only used
> to connect Pages for publishing.

(Meta says reviewers use their own test accounts and not the developer's personal credentials —
**verified**. Our ConstructHUB credentials are required because the tool is behind sign-in.)

---

## 4. Screencast scripts

Meta's rules (**verified**): 1080p or higher, monitor width ≤ 1440, English UI (or captions),
mouse not keyboard, large cursor, no audio needed, only the app window, **one recording per
permission showing the grant AND the use** — a permission without a recording is not approved.
One continuous take can be uploaded against several permissions, but each permission's own moment
must be visible; we recommend one ~3-minute master take, plus trimmed clips per permission.

Use the demo Page "ConstructHUB Demo Roofing" (1.8). Add captions with a screen-recording tool.

**Master take**
1. (0:00) Browser with address bar visible at `https://constructhub.us/auth`. Sign in as the
   reviewer test account. Caption: "A contractor signs in to ConstructHUB."
2. Open **Social Media**. Show the "Facebook & Instagram" card in **Not connected** state with its
   text: what connecting does, what ConstructHUB can and cannot do, how to disconnect.
3. Click **Connect Facebook**. The Facebook Login for Business dialog opens. Pause on the screen
   listing the requested permissions. Select the demo Page and its Instagram account. Continue.
4. Back in ConstructHUB: the Page picker lists the Pages (caption: "`pages_show_list` — the Pages this
   person manages"; if the Page is portfolio-owned add "`business_management` — Pages owned by a
   Business portfolio are listed"). Tick the demo Page. Show the Instagram account appearing with its
   username and picture (caption: "`instagram_basic` — the linked Instagram account's username and
   picture"). Save.
5. Click **New post**. Type a caption. Optionally click **Draft with AI**, then edit the draft by
   hand (caption: "the customer reviews and edits every AI draft"). Attach one photo. Select the
   Facebook Page and the Instagram account. Choose **Publish now**. Click **Publish**.
6. Show the post row: Publishing → Published. Caption on Facebook: "`pages_manage_posts` — post
   published to the Page"; on Instagram: "`instagram_content_publish` — container created, status
   FINISHED, published".
7. Click **View on Facebook** → the post on the Page (caption: "`pages_read_engagement` — the
   permalink read back from the Page post"). Back; click **View on Instagram** → the post on
   Instagram.
8. Second post: attach a vertical video, choose Reel for both, schedule 2 minutes ahead, show it
   moving Scheduled → Published, open both.
9. Social Media → **Disconnect**. Confirm. Show Not connected.
10. Open https://www.facebook.com/settings?tab=business_tools (Business integrations) and show
    ConstructHUB can be removed there too **(to confirm URL)**.
11. Scroll https://constructhub.us/privacy to the Meta section and open
    https://constructhub.us/data-deletion.

Per-permission clips = steps 1–4 (grant) + the step named in each caption.

---

## 5. What ConstructHUB must build or change BEFORE submitting

Engineer (none of this exists):

1. **OAuth connect** `GET /api/social/oauth/meta/connect` (signed-in only; one-time `state` bound to
   session, 10 min) → Facebook dialog with `config_id`; callback
   `GET /api/social/oauth/meta/callback`: verify state, exchange code server-side, exchange for
   long-lived user token, `GET /me/accounts?fields=id,name,picture,access_token,tasks,instagram_business_account{id,username,profile_picture_url}`,
   keep only Pages whose `tasks` include `CREATE_CONTENT` (**verified** requirement), show the picker.
2. **Storage**: per ConstructHUB account, the chosen Page ids/names/pictures, IG user id/username/
   picture, the Meta user id (app-scoped, needed to match deletion/deauthorize callbacks), granted
   permissions, Page tokens **encrypted at rest** (reuse `encryptKey`/`SOCIAL_ENCRYPTION_KEY`
   pattern, AAD bound to account). Never return tokens from any route; never log them.
3. **Publishing worker** (fits the existing schedule in `server/social/schedule.ts`):
   - Facebook: `/{page-id}/feed` (text/link), `/{page-id}/photos` (single photo; multi-photo = upload
     each with `published=false` then `/feed` with `attached_media`), `/{page-id}/videos` (resumable
     upload), `/{page-id}/video_reels` (start → upload to rupload.facebook.com → poll
     `status.video_status=ready` → finish with `video_state=PUBLISHED`). Reels: 9:16, 3–90 s,
     30 per Page per 24 h (**verified**) — enforce in our code.
   - Instagram: JPEG only for images (**verified**), media must be on a public URL at publish time
     → serve from R2 under a signed, short-lived public URL; create container → poll `status_code`
     once a minute for ≤ 5 min (**verified** recommendation) → `media_publish`. Carousels ≤ 10 items.
     Check `GET /{ig-user-id}/content_publishing_limit` before publishing (docs give 100 posts / 24 h
     and, in one place, 50 — **conflicting on Meta's page; verify with the endpoint**).
   - Store per destination: status (queued, publishing, published, failed), the Meta post/media id,
     permalink, and a failure sentence written by us.
   - Handle Page Publishing Authorization blocks (**verified**: publishing is blocked until PPA is
     done) with a plain message telling the customer to complete it in Facebook.
   - Token errors (code 190, or permission removed) → mark "Reconnect needed", stop sending.
4. **Data deletion callback** `POST /api/social/oauth/meta/data-deletion` (**verified** spec):
   - body `signed_request=<sig>.<payload>`; split at the first `.`; base64url-decode both;
     HMAC-SHA256 of the *encoded payload string* with the **app secret**; constant-time compare with
     the decoded signature; reject on mismatch (400). Payload JSON has `algorithm`
     (`HMAC-SHA256`), `issued_at`, `expires`, `user_id` (app-scoped id).
   - Delete every stored row for that Meta user id (connections, tokens, IG/Page ids, post records'
     Meta ids/permalinks), write a deletion record with a random alphanumeric confirmation code.
   - Respond `200 {"url":"https://constructhub.us/data-deletion?code=<code>","confirmation_code":"<code>"}`.
5. **Deauthorize callback** `POST /api/social/oauth/meta/deauthorize`: same `signed_request`
   parsing **(Meta's deauthorize page was not read on 2026-10-11 — confirm the payload, believed to
   be the same format)**; mark the connection revoked and delete tokens (keep nothing usable).
6. **`/data-deletion` public page** (client route, no sign-in, add to the `open` list in
   `client/src/App.tsx` next to `/privacy`): explains how to delete Meta data (Disconnect in Social
   Media; remove ConstructHUB in Facebook Settings → Business integrations; delete the ConstructHUB
   account; email support@constructhub.us), and when `?code=` is present shows the status of that
   request ("Completed on <date>: we deleted your connected Pages, Instagram accounts, access tokens
   and post records. Posts already published on Facebook or Instagram are yours and remain there.").
   Status lookup route `GET /api/social/oauth/meta/data-deletion/status?code=` returning only
   status + date.
7. **Disconnect** in Social Media: `DELETE /me/permissions` with the user token (revokes the app) and
   delete all rows. Account deletion (`closeAccount` in `server/account/delete.ts`) must call the
   same purge.
8. **Reviewer account**: a ConstructHUB account with the Social Media module enabled
   (`requireModule` in `server/social/routes.ts`), no 2FA, one sample JPEG and one 9:16 MP4 in its
   media library.
9. **Connect-card copy** (shown before Connect): what is requested, what is not, how to disconnect.
10. **Legal pages**: deploy the privacy and terms text below; check both live.

### 5.1 Owner decision before writing the privacy text

The privacy policy currently says (section 1.5): *"Your prompts, documents, call audio and transcripts
are not sent to an outside AI company."* The project notes say an OpenAI fallback for AI drafting is
live. If post drafts can reach OpenAI, section 1.5 and section 5 are inaccurate today, and Meta
reviewers read the policy. **Check and correct before any submission.** (Not changed here.)

### 5.2 Terms — new paragraph for section 13 (after "YouTube API Services")

> **Facebook and Instagram.** You may connect Facebook Pages and Instagram professional accounts that
> you manage to ConstructHUB's Social Media tool so that ConstructHUB can publish posts you write or
> approve. You must have the right to manage each Page and account you connect. You are responsible
> for every post published through ConstructHUB, including text drafted by ConstructHUB's AI that you
> approve: it must comply with the Facebook Community Standards, Instagram's Terms of Use and
> Community Guidelines, and applicable law, and you must own or have permission to publish all of
> its content. Facebook and Instagram are services of Meta Platforms, Inc.; ConstructHUB is not
> affiliated with or endorsed by Meta.

### 5.3 Privacy policy — new section 4.4 (and list updates)

> **4.4 Facebook and Instagram**
>
> If you connect Facebook or Instagram in Social Media, you log in with Facebook and choose which
> Facebook Pages and linked Instagram professional accounts ConstructHUB may publish to. We ask Meta
> only for permission to list the Pages you manage, read those Pages' and Instagram accounts' names
> and pictures, publish posts to them, and read back the posts we published for you.
>
> **What we store:** your Facebook app-scoped user ID; the ID, name and picture of each Page and
> Instagram account you connected; the permissions you granted; when you connected; the access
> tokens Meta issues, stored encrypted; and, for each post you publish through ConstructHUB, its
> text, the media you attached, the destinations and time you chose, the ID and link Meta returns,
> and its publishing status. Media files you upload for a post are kept in your ConstructHUB media
> library until you delete them; copies prepared for Instagram are deleted from our temporary
> storage within 24 hours **(engineer: match the real retention)**.
>
> **What we do not do:** we do not read your messages, comments, followers, insights or other
> people's data; we do not publish anything you have not written or approved; we do not sell
> Facebook or Instagram data or use it for advertising.
>
> **How it is used:** only to publish the posts you choose and to show you which accounts are
> connected and whether each post was published.
>
> **Deleting it:** choose Disconnect in Social Media — we revoke our access with Meta and delete the
> stored IDs, tokens and Meta post IDs at once. You can also remove ConstructHUB in Facebook under
> Settings & privacy → Settings → Business integrations; Meta then notifies us and we delete the same
> data. Deleting your ConstructHUB account deletes it too. Instructions and the status of a deletion
> request are at https://constructhub.us/data-deletion, or email support@constructhub.us and we will
> delete it within 30 days. Posts already published on Facebook or Instagram belong to you and stay
> there until you delete them on Facebook or Instagram.

Also add: section 5 list item "**Meta (Facebook and Instagram)** — used, with your authorization, to
publish posts you choose to your Facebook Pages and Instagram accounts. See Meta's Privacy Policy
(https://www.facebook.com/privacy/policy)."; section 6 bullet "Publish posts you write or approve to
the social media accounts you connect"; section 8 bullet "Connected social media accounts (Facebook,
Instagram, LinkedIn, TikTok): retained while connected; deleted on Disconnect, when the network tells
us access was removed, on account deletion, or within 30 days of a request".

---

## 6. Review stages, timelines, limits, rejections

### 6.1 Stages

| Stage | What | Realistic time |
| --- | --- | --- |
| A | Developer account, Business portfolio, app created | 1 day |
| B | **Business Verification** | a few days to ~2 weeks; can bounce on name/address mismatch **(to confirm — no official figure found)** |
| C | Build (section 5) and test with **Standard Access** — only people with a role on the app (admins, developers, testers) can grant the permissions (**verified**). Add the owner and the demo Page's admin as app Testers (App roles → Roles → Add People) | engineer time |
| D | Tech Provider / Access Verification (dashboard prompt) | days **(to confirm)** |
| E | **App Review** for Advanced Access on the 6 permissions. Make at least one successful call per permission within 30 days before submitting (**verified**) | "within a week" per Meta (**verified**); budget 2–4 weeks with one resubmission |
| F | Publish the app (Live) — icon, privacy URL, deletion callback required (**verified**) | same day |
| G | Annual **Data Use Checkup** (**verified**: apps with Advanced Access must complete it) | yearly |

### 6.2 Limits before approval

- **Standard Access**: works only for users with a role on the app (and their Pages). Fine for the
  owner and a handful of pilot customers added as Testers; not for the public.
- Advanced Access per permission after App Review + Business Verification (**verified**).
- Instagram: ~100 API posts per account per 24 h (verify with `content_publishing_limit`);
  Facebook Reels: 30 per Page per 24 h (**verified**).

### 6.3 Common rejection reasons (verified unless marked) and how we avoid them

| Reason | Avoid by |
| --- | --- |
| A permission has no screen recording, or the recording doesn't show it in use | Captioned per-permission moments (section 4) |
| Reviewer cannot get into the app | Working test login, Social Media module enabled, no 2FA, no paywall; test it from a private window the day before |
| Copy-pasted use descriptions | Section 3.2 is written per permission |
| Requesting permissions not used | Only six; drop `business_management` if the dashboard lets you and testing shows it's not needed |
| Icon/name using Meta trademarks | Plain ConstructHUB icon |
| Changing app settings after submitting triggers re-review | Freeze settings while in review |
| Privacy policy doesn't describe the Meta data or deletion **(to confirm as explicit rule; it is a common reason)** | Section 5.3 live before submitting |
| Deletion callback returns wrong JSON or isn't reachable **(to confirm)** | Test with a hand-built signed_request |

---

## 7. Only the owner can fill these in

- [ ] Legal company name, address, phone exactly as on documents: ____
- [ ] Business portfolio ID: ____ · Meta App ID: ____ · Configuration ID: ____
- [ ] Business Verification documents chosen: ____
- [ ] Hosting provider and region for the data-handling questions: ____
- [ ] National-security request answers (3.3): ____
- [ ] Reviewer test account email/password: ____
- [ ] Demo Page and Instagram account names: ____
- [ ] Decision on the AI disclosure in privacy policy 1.5 (5.1): ____

## 8. Before sending

- [ ] Section 5 built, deployed; legal pages live; `/data-deletion` live.
- [ ] Deletion callback tested with a signed_request built from the real app secret.
- [ ] One successful call per permission in the last 30 days.
- [ ] Every **(to confirm)** re-checked in the dashboard. Remove the DRAFT banner.

## 9. Sources read on 2026-10-11

- https://developers.facebook.com/docs/graph-api/overview/access-levels (Standard/Advanced, Business Verification)
- https://developers.facebook.com/docs/app-review/submission-guide (screencast rules, review time, rejection reasons)
- https://developers.facebook.com/docs/development/create-an-app/app-dashboard/data-deletion-callback (signed_request, JSON reply)
- https://developers.facebook.com/documentation/pages-api/create-an-app (use case, FLfB settings fields, Tech Provider, publish requirements)
- https://developers.facebook.com/docs/pages-api/posts · https://developers.facebook.com/docs/video-api/guides/publishing · https://developers.facebook.com/docs/video-api/guides/reels-publishing
- https://developers.facebook.com/docs/instagram-platform/content-publishing · /overview · /instagram-api-with-instagram-login/business-login
- https://developers.facebook.com/docs/facebook-login/facebook-login-for-business
- https://developers.facebook.com/docs/permissions/
