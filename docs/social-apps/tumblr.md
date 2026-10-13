# Tumblr — ConstructHUB Direct

Owner order: October 13, 2026. Adapter `tumblr` in `server/social/native-nets.ts` (API v2, OAuth 2, Neue Post Format). Claims marked **(to confirm)** must be checked at https://www.tumblr.com/docs/en/api/v2 before the first live post.

## 1. App checklist (owner)

1. https://www.tumblr.com/oauth/apps → **Register application**: name `ConstructHUB`, website https://constructhub.us, default callback and **OAuth2 redirect URL** (exact) `https://constructhub.us/api/social/native/tumblr/callback`.
2. OAuth consumer key + secret → vb11 `~/ConstructHUB-live/.env`: `SOCIAL_TUMBLR_CLIENT_ID=…`, `SOCIAL_TUMBLR_CLIENT_SECRET=…`; restart `constructhub.service`.

## 2. Authentication

- `https://www.tumblr.com/oauth2/authorize?client_id&response_type=code&scope=basic write offline_access&state&redirect_uri`.
- Token: `POST https://api.tumblr.com/v2/oauth2/token` (client id + secret in the form) → access token (~42 minutes **(to confirm)**) + refresh token. Who signed in: `GET /v2/user/info`; stored as the primary blog `@name`.

## 3. Posting

- Blog: required; `NativeClient.targets()` lists the account's blogs; the composer keeps it as `boardId` → target `blog`.
- `POST /v2/blog/<blog>/posts` with NPF content: a text block plus image/video blocks by URL (Tumblr fetches them). Delete = `POST /v2/blog/<blog>/post/delete`.
