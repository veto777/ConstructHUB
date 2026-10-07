# YouTube API Services — audit pack (DRAFT)

**Status: DRAFT, written 2026-10-07. Not submitted. Nothing here has been confirmed with Google.**
Blanks (`____`) are for the owner; nothing in them was guessed. Everything stated about our own
system was read from the code on branch `youtube-connect` — file references are given so each claim
can be re-checked before sending. Statements about Google's rules are marked **(to confirm)**: they
are our understanding and must be checked against Google's current pages before the form is sent.

Form: "YouTube API Services - Audit and Quota Extension Form" — https://support.google.com/youtube/contact/yt_api_form

There are **two separate Google reviews**. This document is about the first; the second is in
section 10.

1. **YouTube API Services compliance audit** (the form above). Until an API project passes it,
   videos uploaded with `videos.insert` from that project are locked as Private **(to confirm)**.
2. **Google OAuth app verification** for the sensitive scopes this connection asks for.

---

## 1. What we are asking for

- **The audit only.** We are not asking for more quota.
- Reason: so that tutorial videos uploaded through the API are not locked as Private.
- Default allowance as we understand it: about 100 `videos.insert` calls a day **(to confirm — read
  the real figure on the project's Quotas page in Google Cloud before quoting it)**. Our expected
  use (section 7) is far below that.

## 2. The API client

| Field | Answer |
| --- | --- |
| Product name | ConstructHUB |
| Website | https://constructhub.us |
| What the product is | A web platform for contractors (permit data, Google Business Profile tools, CRM). YouTube is used only by ConstructHUB itself, for its own help videos. |
| Who uses the YouTube integration | One party: ConstructHUB's own administrators. No customer, and no member of the public. |
| Google Cloud project name | ____ |
| Google Cloud project number | ____ |
| OAuth client ID (web client) | ____ (the existing client used for Google sign-in; env `GOOGLE_CLIENT_ID`) |
| YouTube channel | "Construct HUB", channel ID `UCRsxhhzhirrQCnqETChhyFw` |
| Is the API client public? | No. There is no public sign-in with YouTube. The connect route answers 403 to anyone who is not a platform administrator (`server/youtube/routes.ts`, `requirePlatformAdmin`). |

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

State of the build on 2026-10-07 (say this honestly if asked): the connection and the library
functions exist and are unit-tested with a mocked network; **no call has been made to Google yet and
no video has been uploaded through the API**. The upload script and any analytics screen are not
written yet.

## 4. API methods and scopes

Scopes requested in one consent (`requestedScopes()` in `server/youtube/client.ts`):

| Scope | Why |
| --- | --- |
| `https://www.googleapis.com/auth/youtube.upload` | Upload our tutorial videos and set their thumbnails. Required — the connection is refused without it. |
| `https://www.googleapis.com/auth/youtube.readonly` | Read back which channel was authorised (`channels.list?mine=true`), so a wrong channel is refused. |
| `https://www.googleapis.com/auth/yt-analytics.readonly` | Read our own channel's statistics. Optional — the connection still works if it is not granted. |

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

## 5. Data: what is stored, for how long, how it is deleted

Stored (one row, `youtube_connection`):

- channel ID and channel title;
- the scopes Google granted;
- the id and email address of the administrator who connected, and when;
- the access token and the refresh token, **encrypted at rest** with AES-256-GCM
  (`server/gbp/token-crypto.ts`, key `GBP_TOKEN_KEY`, required in production);
- the last connection error, as a short scrubbed message.

Not stored: no video files beyond our own source recordings, no viewer data, no comments, and **no
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

Open point for the owner: the customer-facing **Social Media** tool can publish a customer's post to
that customer's YouTube account, but it does so through the customer's own Blotato account and API
key (`server/social/client.ts`), not through our Google project or YouTube API Services. It is
outside this API client. The public privacy policy and terms do not currently describe that route;
whether they should is a separate decision — it was not changed here.

## 7. Expected volume

| Item | Figure |
| --- | --- |
| Channels connected | 1 |
| Uploads per day | ____ (owner: planned publishing pace; one tutorial per feature is the standing plan) |
| Largest burst expected | ____ (owner: e.g. the first batch of tutorials) |
| Analytics reads per day | ____ (no scheduled job exists yet; today it is on demand only) |
| Quota extension requested | None |

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

Not ready on 2026-10-07, so shot 5 cannot be recorded yet: the upload script, and a first real
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
number of accounts that can grant the scopes **(to confirm)**. Only our own administrator connects,
so the warning does not block the first connection, but it should be cleared before the audit video
is recorded.

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
