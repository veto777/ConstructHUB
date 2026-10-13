# Pinterest — ConstructHUB Direct

Owner order: October 13, 2026 ("lets finish the bluesky and the pinterest launch"). Adapter `pinterest` in `server/social/native-nets.ts` (Pinterest API v5). Claims marked **(to confirm)** were written from the v5 reference as remembered on 2026-10-13 and must be checked against https://developers.pinterest.com/docs/ before the first live post.

## 1. Developer console checklist (owner)

1. Business account: `social@constructhub.us` ("Constructhub", username `constructhub`, website https://constructhub.us) — created 2026-10-13.
2. https://developers.pinterest.com/account-setup/ → **Verify your account** (Pinterest emails a link to social@constructhub.us — Google Workspace mailbox) → **Agree to the Developer Terms**.
3. My apps → **Create app**: name `ConstructHUB`, description "Social posting for contractors: customers connect their own Pinterest business account and ConstructHUB pins their photos and videos to the board they choose."
4. Redirect URI (exact): `https://constructhub.us/api/social/native/pinterest/callback`. Scopes: `boards:read pins:read pins:write user_accounts:read`.
5. Copy the **App ID** and **App secret** → vb11 `~/ConstructHUB-live/.env`: `SOCIAL_PINTEREST_APP_ID=…`, `SOCIAL_PINTEREST_APP_SECRET=…`; restart `constructhub.service`. Both are required to show Pinterest.
6. New apps start in **Trial access**: the API only works for the app owner's own account and with low rate limits **(to confirm)**. Apply for **Standard access** from the app page (use case, demo video, privacy policy https://constructhub.us/privacy). Until approved, keep Pinterest behind the reviewer gate (do not add it to `SOCIAL_NATIVE_PUBLIC_NETWORKS`).

## 2. Authentication (verified against the adapter)

- OAuth 2.0 authorization code: `https://www.pinterest.com/oauth/?client_id&redirect_uri&response_type=code&scope=boards:read,pins:read,pins:write,user_accounts:read&state`.
- Token: `POST https://api.pinterest.com/v5/oauth/token`, HTTP Basic `app_id:app_secret`, form `grant_type=authorization_code&code&redirect_uri` → access token (30 days) + refresh token (1 year) **(to confirm lifetimes)**. Refresh: `grant_type=refresh_token`.
- Who signed in: `GET /v5/user_account` (username, profile_image). The connected account is stored as `@username`; `pins:write` must be granted or the sign-in is refused.

## 3. Posting

- Board: required. `NativeClient.targets()` lists the account's boards (`GET /v5/boards`, paged); the composer keeps the chosen `boardId` on the post, as it already did for Outstand.
- Title ≤ 100 (the composer's title, else the first line of the text); description ≤ 800; the first link in the text becomes the pin's link.
- Media: one photo (`image_url`), 2–5 photos as a carousel (`multiple_image_urls`), or one video: `POST /v5/media {media_type: video}` → upload to the returned URL with its parameters → poll `GET /v5/media/{id}` until `succeeded` → `POST /v5/pins` with `video_id` and a cover (`cover_image_content_type` + base64 `cover_image_data`) **(to confirm field names)**. The cover is the customer's photo when one is attached with the video, else the frame one second in (ffmpeg on vb11).
- The pin is created at once (`https://www.pinterest.com/pin/<id>/`); a video keeps processing behind it. Delete = `DELETE /v5/pins/{id}`.
- Stats and comments: not read; the page says "see it in Pinterest Analytics".

## 4. Retention and revocation

Disconnect removes stored tokens and account details. Revoke remote access at https://www.pinterest.com/settings/security/ (Connected apps). No deauthorization webhook.
