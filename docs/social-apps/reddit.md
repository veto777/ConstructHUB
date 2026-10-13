# Reddit — ConstructHUB Direct

Owner order: October 13, 2026 ("lets add all of these"). Adapter `reddit` in `server/social/native-nets.ts`. Claims marked **(to confirm)** were written from Reddit's OAuth2 wiki as remembered on 2026-10-13 and must be checked at https://github.com/reddit-archive/reddit/wiki/OAuth2 before the first live post.

## 1. App checklist (owner)

1. Sign in to the ConstructHUB Reddit account → https://www.reddit.com/prefs/apps → **create another app…** → type **web app**, name `ConstructHUB`, about URL https://constructhub.us, redirect URI (exact) `https://constructhub.us/api/social/native/reddit/callback`.
2. Commercial use of the Data API needs Reddit's approval: submit the API access request form (https://support.reddithelp.com/hc/en-us/requests/new, "API Access Request") describing posting on a business's behalf **(to confirm current form)**.
3. Client ID (under the app name) and secret → vb11 `~/ConstructHUB-live/.env`: `SOCIAL_REDDIT_CLIENT_ID=…`, `SOCIAL_REDDIT_CLIENT_SECRET=…`; restart `constructhub.service`. Both are required to show Reddit. Keep it behind the reviewer gate until approved (not in `SOCIAL_NATIVE_PUBLIC_NETWORKS`).

## 2. Authentication

- `https://www.reddit.com/api/v1/authorize?client_id&response_type=code&state&redirect_uri&duration=permanent&scope=identity mysubreddits submit`.
- Token: `POST https://www.reddit.com/api/v1/access_token`, HTTP Basic `client_id:secret` → access token (1 hour) + refresh token. Every call carries the `User-Agent` Reddit requires. `submit` must be granted or the sign-in is refused. Stored as `u/<name>`.

## 3. Posting

- Destination: required. `NativeClient.targets()` lists the account's own profile (`u_<name>`) and the subreddits it subscribes to (quarantined and no-post subreddits left out); the composer keeps it as `boardId` → target `subreddit`.
- Title: required, ≤ 300. Text post (`kind=self`, ≤ 40,000). Image/video posts are not supported yet (Reddit's media-lease upload) — the composer refuses media for Reddit with a clear message.
- Each subreddit's own rules still apply (many ban self-promotion); Reddit's refusal text is shown to the customer.
- Delete = `POST /api/del` with the `t3_` id. Stats and replies are managed on Reddit.
