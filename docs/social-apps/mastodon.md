# Mastodon — ConstructHUB Direct

Owner order: October 13, 2026. Adapter `mastodon` in `server/social/native-nets.ts`. No developer account and no review: every Mastodon server registers apps on its own.

## 1. Switch (owner)

vb11 `~/ConstructHUB-live/.env`: `SOCIAL_MASTODON=on`; restart `constructhub.service`. Add `mastodon` to `SOCIAL_NATIVE_PUBLIC_NETWORKS` to show it to every customer.

## 2. Authentication

- The customer types their server (`mastodon.social`, or `@me@server` — the server is taken from it). It must resolve only to public addresses (checked before every call).
- `POST https://<server>/api/v1/apps` (client_name ConstructHUB, redirect `https://constructhub.us/api/social/native/mastodon/callback`, scopes `read write`) → client id/secret, kept in the sign-in session only.
- `https://<server>/oauth/authorize?…` → back with a code → `POST /oauth/token` → access token (does not expire) → `GET /api/v1/accounts/verify_credentials`. Stored as `@user@server`; the server lives in `oauth_enc`.

## 3. Posting

- Up to 500 characters (the common default; some servers allow more), up to four images or one video, uploaded via `POST /api/v2/media`, then `POST /api/v1/statuses` with an `Idempotency-Key`.
- Delete = `DELETE /api/v1/statuses/:id`. Stats and replies are managed on the server.
