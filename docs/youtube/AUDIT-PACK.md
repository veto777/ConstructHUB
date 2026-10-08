# YouTube API Services — audit pack (DRAFT)

**Status: DRAFT, written 2026-10-07, extended the same day for the multi-user use case (customers
connecting their own channels — branch `youtube-customers`, not merged, not deployed). Not submitted.
Nothing here has been confirmed with Google.**
Blanks (`____`) are for the owner; nothing in them was guessed. Everything stated about our own
system was read from the code on branches `youtube-connect` and `youtube-customers` — file references
are given so each claim can be re-checked before sending. Statements about Google's rules are marked **(to confirm)**: they
are our understanding and must be checked against Google's current pages before the form is sent.

Form: "YouTube API Services - Audit and Quota Extension Form" — https://support.google.com/youtube/contact/yt_api_form

There are **two separate Google reviews**. This document is about the first; the second is in
section 10. **Section 13 says plainly what Google will require before customers at large can use
the customer connection** — read it before announcing the feature.

There are now **two use cases in one API client**:

- **A. The company channel** (sections written first): one connection, platform administrators only.
- **B. Customers' own channels** (multi-user): any signed-in ConstructHUB account may connect ONE
  YouTube channel of its own and upload videos it chooses to it. Code: `server/youtube/customer-*.ts`,
  UI: Social Media → YouTube (`client/src/components/social-youtube.tsx`).

1. **YouTube API Services compliance audit** (the form above). Until an API project passes it,
   videos uploaded with `videos.insert` from that project are locked as Private **(to confirm)**.
2. **Google OAuth app verification** for the sensitive scopes this connection asks for.

---

## 1. What we are asking for

- **The audit**, for both use cases. A quota extension is **not** requested today; section 13 says
  when it will be needed.
- Reason: so that videos uploaded through the API — our tutorials, and customers' own videos on
  their own channels — are not locked as Private.
- Default allowance as we understand it: about 100 `videos.insert` calls a day **(to confirm — read
  the real figure on the project's Quotas page in Google Cloud before quoting it)**. Our expected
  use (section 7) is far below that for the company channel. For customers the code holds the whole
  project under a daily ceiling it enforces itself (section 7).

## 2. The API client

| Field | Answer |
| --- | --- |
| Product name | ConstructHUB |
| Website | https://constructhub.us |
| What the product is | A web platform for contractors (permit data, Google Business Profile tools, CRM, social media publishing). YouTube is used by ConstructHUB itself for its own help videos, and by its customers to publish their own videos to their own channels. |
| Who uses the YouTube integration | (A) ConstructHUB's own administrators, for the company channel. (B) Signed-in ConstructHUB customers (contractors and marketing agencies), each for their own channel. Never an anonymous visitor. |
| Google Cloud project name | ____ |
| Google Cloud project number | ____ |
| OAuth client ID (web client) | ____ (the existing client used for Google sign-in; env `GOOGLE_CLIENT_ID`) |
| YouTube channel | "Construct HUB", channel ID `UCRsxhhzhirrQCnqETChhyFw` |
| Is the API client public? | Use case A: no — the admin connect route answers 403 to anyone who is not a platform administrator (`server/youtube/routes.ts`, `requirePlatformAdmin`). Use case B: yes, to signed-in ConstructHUB accounts — `GET /api/social/youtube/connect` answers 401 to anyone signed out (`server/youtube/customer-routes.ts`). There is no "sign in with YouTube"; YouTube is never used to authenticate a person. |

## 3. Use case

- **Single owner-operated channel.** The integration can hold exactly one connection (table
  `youtube_connection`, one row, `server/youtube/schema.ts`). The callback refuses any channel other
  than the configured one (`YOUTUBE_CHANNEL_ID`, default the channel above) and stores nothing in
  that case (`completeConnect` in `server/youtube/client.ts`).
- **Uploads of first-party tutorial videos.** Screen recordings of ConstructHUB's own features with
  narration, made by ConstructHUB. No user-generated content, no third-party content, no re-uploads.
- **Read-only analytics** for that same channel (views, watch time, average view duration,
  subscribers gained, per video), to see which tutorials are watched.
- Not done: no YouTube content is shown to customers through the API, no search, no comments,
  no ratings, no live streaming, no downloading of video or audio, no data about other channels.

**Use case B — customers' own channels (multi-user).**

- A signed-in customer connects ONE channel of their own (table `youtube_customer_connections`,
  primary key = the account's user id; connecting again replaces it). No channel is expected or
  refused: the channel of the Google account they pick is connected, and the page then shows its
  name and picture so they can check it (`completeConnect({ anyChannel: true })`).
- The customer uploads video files **they choose and they made** — job-site walkthroughs, finished
  projects, their own adverts. For each upload they enter the title, description, tags and privacy
  setting, answer the made-for-kids question explicitly (there is no default), and must tick a box
  certifying that the video complies with YouTube's Community Guidelines and that they own the
  rights. The server refuses the upload without it (`publishInput` in
  `server/youtube/customer-routes.ts`) and records when it was ticked (`certified_at`).
- Nothing is uploaded automatically or on a schedule; every upload is one explicit click by the
  channel's owner. ConstructHUB does not write, generate or alter the video.
- One account's connection is never usable by another account: every database read and write is
  keyed by the signed-in user's id (`server/youtube/customer-store.ts`), an agency team member
  acting for an owner gets 404 on these routes (`server/agency/middleware.ts`), and a video queued
  for one channel is not sent if a different channel is connected by the time it runs.
- Not done for customers: no analytics, no captions or playlists, no editing or deleting of
  videos, no reading of the channel's other videos, comments or subscribers.

State of the build on 2026-10-07 (say this honestly if asked): use case A is deployed, the company
channel is connected and a first video has been uploaded through the API (reported by the owner's
session the same day; **re-check it in YouTube Studio before quoting it**). Use case B exists on
branch `youtube-customers` only: it is tested against a mocked Google and has **never called Google
and never uploaded a customer video**. No analytics screen is written.

## 4. API methods and scopes

Scopes requested in one consent (`requestedScopes()` in `server/youtube/client.ts`):

| Scope | Why |
| --- | --- |
| `https://www.googleapis.com/auth/youtube.upload` | Upload our tutorial videos and set their thumbnails. Required — the connection is refused without it. |
| `https://www.googleapis.com/auth/youtube.readonly` | Read back which channel was authorised (`channels.list?mine=true`), so a wrong channel is refused. |
| `https://www.googleapis.com/auth/yt-analytics.readonly` | Read our own channel's statistics. Optional — the connection still works if it is not granted. |

**Use case B asks for two of those scopes only** (`CUSTOMER_SCOPES` in `server/youtube/client.ts`),
with `include_granted_scopes=false`:

| Scope | Why |
| --- | --- |
| `https://www.googleapis.com/auth/youtube.upload` | Upload the videos the customer chooses to their own channel. Required. |
| `https://www.googleapis.com/auth/youtube.readonly` | Read back which channel was connected (`channels.list?mine=true`) so the customer can see it, and read the processing status of the videos they uploaded from ConstructHUB (`videos.list`, part `status`, by the id we were given). Nothing else is read. |

Customers are never asked for `yt-analytics.readonly` or `youtube.force-ssl`.

Not requested today: `https://www.googleapis.com/auth/youtube.force-ssl`. Our understanding is that
`captions.insert`, `playlists.insert` and `playlistItems.insert` are not covered by
`youtube.upload` and need this broader scope **(to confirm)**. The code refuses those two functions
with a clear message until the owner opts in (`YOUTUBE_EXTRA_SCOPES`) and reconnects. **Decide
before submitting** whether captions and playlists will be set through the API or by hand in
YouTube Studio; if through the API, add the scope to this table and to the OAuth verification.

Methods the code can call:

| API | Method | Used for | Function |
| --- | --- | --- | --- |
| YouTube Data API v3 | `channels.list` (`mine=true`, parts `id,snippet`) | Check the authorised channel at connect time | `completeConnect` |
| YouTube Data API v3 | `videos.insert` (resumable upload; parts `snippet,status`) | Upload a tutorial video; `privacyStatus` defaults to `private`, `selfDeclaredMadeForKids` false | `uploadVideo` |
| YouTube Data API v3 | `thumbnails.set` | Set the video's thumbnail | `setThumbnail` |
| YouTube Data API v3 | `captions.insert` | Add an SRT caption track (needs the extra scope, see above) | `uploadCaption` |
| YouTube Data API v3 | `playlists.list` (`mine=true`), `playlists.insert`, `playlistItems.insert` | Put the video in our tutorials playlist, creating it once (needs the extra scope) | `addToPlaylist` |
| YouTube Analytics API v2 | `reports.query` (`ids=channel==MINE`, metrics `views,estimatedMinutesWatched,averageViewDuration,subscribersGained`, dimension `video`, sort `-views`, max 50 rows) | Our own channel's per-video statistics | `getChannelAnalytics` |
| Google OAuth 2.0 | token exchange, token refresh, token revocation | Connect, keep the connection working, disconnect | `completeConnect`, `getYoutubeAccessToken`, `revokeToken` |

Methods use case B can call — a strict subset, with the customer's own grant:

| API | Method | Used for | Function |
| --- | --- | --- | --- |
| YouTube Data API v3 | `channels.list` (`mine=true`, parts `id,snippet`) | Once per connect: which channel, its title and picture | `completeConnect` |
| YouTube Data API v3 | `videos.insert` (resumable upload; parts `snippet,status`) | Upload one video the customer chose; `privacyStatus` as chosen (default `private`), `selfDeclaredMadeForKids` as answered, category 22 | `uploadVideo` via `runUpload` (`server/youtube/customer-service.ts`) |
| YouTube Data API v3 | `videos.list` (part `status`, one id) | At most 7 looks per uploaded video over about 8 hours, to show "processing", "published" or YouTube's rejection reason | `getVideoStatus` via `runCheck` |
| Google OAuth 2.0 | token exchange, refresh, revocation | Connect, keep working, disconnect | as above |

## 5. Data: what is stored, for how long, how it is deleted

Stored (one row, `youtube_connection`):

- channel ID and channel title;
- the scopes Google granted;
- the id and email address of the administrator who connected, and when;
- the access token and the refresh token, **encrypted at rest** with AES-256-GCM
  (`server/gbp/token-crypto.ts`, key `GBP_TOKEN_KEY`, required in production);
- the last connection error, as a short scrubbed message.

**Use case B stores, per customer account:**

- `youtube_customer_connections` (one row): channel ID, title and picture URL; the scopes granted;
  when it was connected; the access and refresh tokens, **encrypted at rest** exactly as above; the
  last connection error as a short scrubbed message.
- `youtube_customer_videos` (one row per video sent): file name, size and type; title, description,
  tags, privacy setting, made-for-kids answer; when the customer certified the Community Guidelines
  and their rights; the channel it was sent to; the YouTube video ID; the privacy status YouTube
  returned; the upload status and, on failure, a sentence written by us (Google's response text is
  never stored or shown).
- The video **file**: in our object storage (Cloudflare R2, key `ytvideo/<user id>/<video id>/…`)
  only between the customer's browser and YouTube. The worker deletes it once YouTube has accepted
  the video, and any file older than 24 hours whatever its state (`filesToDelete`,
  `server/youtube/customer-store.ts`).
- `youtube_upload_daily`: a count of uploads per account per day and for the whole project. No
  YouTube data.

Not stored for customers: nothing read from YouTube except the channel's ID/title/picture and the
status of the videos they uploaded from ConstructHUB. No statistics, comments, subscribers or other
videos are requested at all.

Deletion for customers:

- **Disconnect** (Social Media → YouTube) revokes the grant at Google, deletes the connection row,
  **every** video record of that account and every stored file (`purgeCustomerYoutube`). The rows
  are deleted even when Google cannot be reached. Videos already on YouTube are the customer's and
  stay on their channel.
- **Deleting the ConstructHUB account** runs the same routine at once (`closeAccount` in
  `server/account/delete.ts`), and the tables cascade from `users`.
- If Google rejects the refresh token (`invalid_grant`, or a 401 during an upload) the connection
  is marked "needs reconnect" and nothing more is sent until the customer connects again.
- On request to support@constructhub.us, within 30 days (privacy policy section 4.3).
- Known gap **(to confirm, then decide)**: when a customer connects a *different* channel, the old
  channel's row is overwritten here but its grant is not revoked at Google — revoking it could
  also cancel the new grant when both belong to the same Google account. The customer can remove
  it on Google's permissions page.
- **(to confirm)** Google documents token revocation as cancelling the user's whole grant to the
  OAuth client. ConstructHUB uses ONE OAuth client for Google sign-in, Search Console, Business
  Profile and YouTube, so a customer who disconnects YouTube may find Google asking them to
  reconnect those other tools if they used the same Google account. The Disconnect confirmation
  says so. A separate OAuth client for YouTube would remove the doubt; that is an owner decision.

Not stored (company channel): no video files beyond our own source recordings, no viewer data, no comments, and **no
statistics** — analytics rows are returned to the caller and are not written to the database or
cached. (If a later change starts keeping statistics, this section, the privacy policy and the
disconnect code must all change together. YouTube's policy limits how long API data may be kept
without refreshing it **(to confirm the current limit)**.)

Tokens never leave the server: no route returns one and they are not logged
(`server/youtube/routes.test.ts` checks the responses).

Deletion:

- **Disconnect** on the admin page revokes the grant at Google (`https://oauth2.googleapis.com/revoke`)
  and deletes the whole row. The row is deleted even when Google cannot be reached.
- If Google rejects the refresh token (`invalid_grant`), the access token is cleared and the
  connection is marked as needing a reconnect; nothing further is sent to Google until an
  administrator connects again.
- On request to support@constructhub.us, stored YouTube data is deleted within 30 days (privacy
  policy section 4.3).

## 6. Privacy policy and terms

| What | Where |
| --- | --- |
| Privacy policy | https://constructhub.us/privacy — section "4.3 YouTube API Services" |
| Terms | https://constructhub.us/terms — section 13, "YouTube API Services" |
| Link to the Google Privacy Policy | In the privacy section above (http://www.google.com/policies/privacy) |
| YouTube Terms of Service binding sentence | In the terms section above (https://www.youtube.com/t/terms) |
| Revocation via Google | Privacy section above (https://security.google.com/settings/security/permissions) |

These URLs show the new sections only **after this branch is deployed**. Check both pages live
before submitting the form.

Both sections were rewritten on branch `youtube-customers` for use case B: customers may connect
their own channel; what is stored (channel ID/title/picture, encrypted grant, upload records); the
file is held at most 24 hours; used only to upload videos they choose; deletion on Disconnect, on
account deletion and within 30 days on request. The same binding sentence, with the YouTube Terms
of Service and Google Privacy Policy links, is shown **next to the Connect button**
(`ConnectTerms` in `client/src/components/social-youtube.tsx`).

Still open for the owner: the Social Media tool can ALSO publish to a customer's YouTube account
through the customer's own Blotato account and API key (`server/social/client.ts`). That route does
not use our Google project or YouTube API Services, is outside this API client, and is not
described in the public privacy policy or terms; whether it should be is a separate decision — it
was not changed here.

## 7. Expected volume

| Item | Figure |
| --- | --- |
| Channels connected | 1 |
| Uploads per day | ____ (owner: planned publishing pace; one tutorial per feature is the standing plan) |
| Largest burst expected | ____ (owner: e.g. the first batch of tutorials) |
| Analytics reads per day | ____ (no scheduled job exists yet; today it is on demand only) |
| Quota extension requested | None |

Use case B — ceilings the code enforces (`server/youtube/customer-store.ts`, counted per Pacific
day in `youtube_upload_daily`, checked in one transaction before a video is queued):

| Item | Figure |
| --- | --- |
| Uploads per customer account per day | 5 (env `YOUTUBE_CUSTOMER_DAILY_UPLOADS`) |
| Uploads for the whole project per day through customers | refused once the project's count reaches 90 (env `YOUTUBE_PROJECT_DAILY_UPLOADS`); the company channel's uploads are counted in the same total and are never refused |
| Largest file | 1 GB (env `YOUTUBE_CUSTOMER_MAX_BYTES`) |
| `videos.list` status looks | at most 7 per uploaded video |
| Customers expected to connect in the first 3 months | ____ (owner) |
| Customer uploads per day expected | ____ (owner) |

Why 90: the default allowance is understood to be about 100 uploads a day for the project **(to
confirm, as in section 1)**, shared by every customer and the company channel. The status looks and
the one `channels.list` per connect draw on the same daily quota **(to confirm their unit cost on
the Quotas page)**. When the count is reached the customer sees "Daily limit reached — try again
tomorrow"; nothing is queued for later.

## 8. How the administrator connects and revokes

1. Signs in to ConstructHUB as a platform administrator and opens `/admin/youtube`.
2. Clicks **Connect YouTube channel** → Google's consent screen (scopes in section 4, offline access).
3. Picks the Construct HUB channel. Google returns to
   `https://constructhub.us/api/admin/youtube/callback`.
4. The server checks the one-time state, exchanges the code, reads back the channel and saves the
   connection only if it is the expected channel. The page then shows the channel, when it was
   connected, by whom, and the permissions granted.
5. **Disconnect** on the same page revokes and deletes (section 5). Access can also be removed at
   https://security.google.com/settings/security/permissions.

### How a customer connects, uploads and revokes (use case B)

1. Signs in to ConstructHUB and opens **Social Media** (`/social-media`). The **YouTube** section
   lists, before anything is connected, what connecting does, what ConstructHUB can and cannot do
   and how to disconnect, and shows "By connecting, you agree to be bound by the YouTube Terms of
   Service" with the YouTube Terms and Google Privacy Policy links beside the button.
2. Clicks **Connect YouTube** → Google's consent screen (two scopes, offline access). Google
   returns to `https://constructhub.us/api/social/youtube/callback`.
3. The server checks the one-time state (kept in the customer's session, bound to their account,
   10 minutes), exchanges the code, reads back the channel and saves the connection. The page shows
   the channel's name and picture.
4. **Publish a video**: picks a file (sent to our storage in parts), enters the details, answers
   made-for-kids, ticks the certification, clicks **Publish to YouTube**. The list shows Queued →
   Uploading → On YouTube — processing → Published with the watch link, or Failed with the reason
   in plain words (daily limit, the channel's own upload limit / phone verification, sign-in
   expired → Reconnect).
5. **Disconnect** in the same section revokes and deletes (section 5). Access can also be removed
   at https://security.google.com/settings/security/permissions.

## 9. Screen recording — shot list

Record in one take if possible, with the browser address bar visible throughout **(to confirm:
Google usually asks that the OAuth client ID be visible in the consent URL)**.

1. `https://constructhub.us/admin/youtube`, signed in as an administrator: the page in its
   **Not connected** state, including "Before you connect" and "Good to know".
2. Click **Connect YouTube channel**. Show the Google account / channel chooser and pick
   **Construct HUB**.
3. The consent screen: pause on the list of permissions so each scope can be read. Show the address
   bar with `client_id=`.
4. Back on `/admin/youtube`: the **Connected** state — channel title, channel ID, connected time,
   permissions granted.
5. An upload: run the upload script for one tutorial (script not written yet — see "Not ready"),
   then open YouTube Studio and show the new video, its title, and its **Private** status.
6. Optional: the same video's thumbnail / captions / playlist, if those are done through the API.
7. Back on `/admin/youtube`: click **Disconnect**, confirm, show the **Not connected** state.
8. `https://security.google.com/settings/security/permissions`: show that ConstructHUB no longer has
   YouTube access.
9. The privacy policy section 4.3 and the terms section, scrolled into view.

For use case B, record a second take as an ordinary (non-admin) customer account:

10. `/social-media`, YouTube section, **Not connected**: the numbered explanation and the Terms
    sentence with its links.
11. **Connect YouTube** → account/channel chooser → the consent screen with its two permissions and
    `client_id=` in the address bar.
12. Back on `/social-media`: the connected channel's name and picture.
13. **Publish a video**: choose a file, fill in the form, show the made-for-kids question and the
    certification checkbox, publish, and let the list reach **Published**. Open the watch link and
    YouTube Studio to show the video on the customer's channel.
14. **Disconnect**, then Google's permissions page showing ConstructHUB is gone.

Not ready on 2026-10-07 for use case B: it is not deployed, its redirect URI is not registered and
no real customer upload has been made, so shots 10–14 cannot be recorded yet.

Written before the first upload; re-check and delete if stale — not ready on 2026-10-07, so shot 5 cannot be recorded yet: the upload script, and a first real
connection (the redirect URI and scopes still have to be added in Google Cloud).

## 10. The separate Google OAuth verification

The three scopes in section 4 are, as we understand it, classed by Google as **sensitive**
**(to confirm on the Data access page, which labels each scope)**. That is a different review from
the YouTube audit, done in Google Cloud → Google Auth Platform → Verification Center.

What we understand it needs **(to confirm against Google's current requirements)**:

- the app's publishing status set to "In production" (in "Testing" status a refresh token expires
  after 7 days, which would silently break uploads every week);
- an app home page and a privacy policy on a domain verified in Search Console
  (constructhub.us), with the privacy policy linked from the home page;
- a written justification for each sensitive scope (section 4 can be reused);
- a demo video showing the consent flow and how each scope is used (the recording in section 9);
- the scopes added under Data access, and the redirect URI added to the OAuth client.

Until it is verified, Google shows an "unverified app" warning on the consent screen and caps the
number of accounts that can grant the scopes **(to confirm)**. For the company channel only our own
administrator connects, so the warning does not block that connection. **For customers it does
matter — see section 13.**

Things to check in the console before doing anything else:

- [ ] Publishing status of the existing OAuth app (Testing or In production): ____
- [ ] User type (Internal or External): ____
- [ ] Whether the app is already verified for the scopes it uses today (sign-in, Search Console,
      Business Profile): ____

## 11. Only the owner can fill these in

- [ ] Legal name of the company / organisation: ____
- [ ] Country / region and registered address: ____
- [ ] Contact name: ____
- [ ] Contact email (must be monitored — Google replies there): ____
- [ ] Contact phone, if the form asks: ____
- [ ] Google Cloud project name: ____
- [ ] Google Cloud project number: ____
- [ ] OAuth client ID: ____
- [ ] Any other Google Cloud projects owned by the same organisation that use YouTube API
      Services (the form asks; do not answer from memory — check the console): ____
- [ ] Whether the organisation has been audited before: ____
- [ ] Planned uploads per day and the largest burst (section 7): ____
- [ ] Decision: captions and playlists through the API (adds `youtube.force-ssl`) or by hand: ____
- [ ] Link to the screen recording (where it is hosted): ____
- [ ] Confirmation that the privacy and terms sections are live on constructhub.us: ____

## 12. Before sending

- [ ] Deploy this branch; open `/privacy` and `/terms` on the live site and read the new sections.
- [ ] Add the redirect URI and scopes in Google Cloud; connect the channel once for real.
- [ ] Write and run the upload script against one tutorial; confirm the result in YouTube Studio.
- [ ] Re-read every **(to confirm)** in this document against Google's current pages and correct it.
- [ ] Record the video (section 9).
- [ ] Fill every blank. Remove the DRAFT banner only then.

## 13. What Google will require before customers at large can use this

Plainly: the code for customers connecting their own channels can be finished and deployed, but
**three things at Google decide whether real customers can use it**, and none of them is done.
Each statement about Google's rules below is our understanding **(to confirm)** against Google's
current pages — none was verified on 2026-10-07.

1. **OAuth app verification for the sensitive `youtube.upload` scope** (Google Cloud → Google Auth
   Platform → Verification Center). `youtube.upload` and `youtube.readonly` are classed as
   sensitive scopes **(to confirm on the Data access page)**. Until the app is verified for them:
   - every customer sees Google's **"Google hasn't verified this app"** warning screen and must
     click through "Advanced → Go to ConstructHUB (unsafe)" to connect **(to confirm the wording)**;
   - the app is capped at **100 users** who can grant unverified sensitive scopes, counted over the
     lifetime of the project **(to confirm)**; after that, new customers are refused by Google.
   Verification needs a justification per scope, a demo video of the consent flow and of each scope
   in use (section 9, shots 10–14), and the home page and privacy policy on a verified domain.
2. **The OAuth consent screen in "In production"**, with both YouTube scopes listed under Data
   access. In "Testing" only listed test users can connect at all, and a refresh token expires
   after 7 days **(to confirm)** — every customer connection would silently need reconnecting each
   week. The redirect URI must be on the web OAuth client:
   `https://constructhub.us/api/social/youtube/callback` (and the same path on any other host
   customers use the tool on — `constructionhub.app` is in `SITE_DOMAINS`).
3. **The YouTube API Services compliance audit** (this document's form), covering use case B. Until
   the project passes it, videos uploaded with `videos.insert` are locked **Private** **(to
   confirm)** — a customer who chooses Public would get a Private video. The product says so
   beside the privacy choice and shows the privacy status YouTube actually returned, but for most
   customers the feature is of little use until the audit passes.
   The same form is where a **quota extension** is requested. The default is understood to be about
   100 uploads a day for the WHOLE project **(to confirm on the Quotas page)**, shared by every
   customer and the company channel; the code stops at 90 a day in total and 5 per customer.
   If that is not enough, ask for more on this form with real numbers (section 7).

Also required by YouTube's API policies for a multi-user client, and where each stands:

| Requirement (our understanding — to confirm) | Where it stands |
| --- | --- |
| Tell users they are agreeing to the YouTube Terms of Service, with a link, before they authorise | Done: beside the Connect button and in the terms page |
| Privacy policy says YouTube API Services are used, links the Google Privacy Policy, says what is stored, how it is used and how to revoke | Done: privacy policy section 4.3 (live only after deploy) |
| Users can revoke access and have stored data deleted | Done: Disconnect; account deletion; on request within 30 days |
| Uploader confirms the content complies with the Community Guidelines and that they hold the rights | Done: required checkbox, refused server-side without it, time recorded |
| Made-for-kids status set by the uploader | Done: explicit yes/no, no default |
| Authorisation data deleted or refreshed on a schedule (the policy sets a period for stored API data) | Partly: tokens are refreshed on use and removed on `invalid_grant`; nothing re-verifies an idle connection every 30 days **(to confirm what the policy asks for a token that is simply unused)** |
| YouTube branding rules for any YouTube logo or button | The section uses a generic icon and the word "YouTube"; **check it against the branding guidelines before the audit** |

Until items 1–3 are done, the honest way to run this is a **limited pilot**: the owner's own
accounts and a handful of customers who are told about the warning screen and the Private lock.

