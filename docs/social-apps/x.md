# X — ConstructHUB Direct

Owner decisions: October 12, 2026. Adapter `x`; independent of legacy Outstand `twitter`.

## Developer console checklist

- At https://console.x.com create/configure a **Web App**, confidential OAuth 2.0 client, with **Read and write** permissions.
- Callback: `https://constructhub.us/api/social/native/x/callback` (exact match).
- Website: `https://constructhub.us`.
- Terms: `https://constructhub.us/terms`; privacy: `https://constructhub.us/privacy`; deletion: `https://constructhub.us/data-deletion`.
- Enable `tweet.read tweet.write users.read media.write offline.access`.
- Purchase API credits and set a spending cap; monitor ops failures for exhausted credits.
- Set `SOCIAL_X_CLIENT_ID` and `SOCIAL_X_CLIENT_SECRET` on the server. Both are required to show X. Existing `SOCIAL_NATIVE_PUBLIC` / reviewer gating still applies.
- Set `APP_URL` for the deployment; callback is `<APP_URL>/api/social/native/x/callback`. Existing `GBP_TOKEN_KEY` encrypts stored tokens.
- Test connect, refresh, image/video, link reply, reconnect, disconnect and delete using a test account before public rollout.

## Authentication and posting

OAuth authorization code with S256 PKCE. Verifier stays in the server session beside one-use state, never in the URL. The callback exchanges the 30-second code immediately, before storage or audit work. Confidential token requests use HTTP Basic. Access lasts about two hours; refresh within ten minutes of expiry and persist each rotated refresh token encrypted.

Images use v2 simple media upload; videos use initialize, 5 MiB append chunks, finalize and bounded processing polling. Media downloads reject private addresses and redirects and are limited to 250 MiB. See [X's v2 upload guide](https://docs.x.com/x-api/media/quickstart/media-upload-chunked).

401 asks to reconnect; 402 or credits errors pause posting and go to the existing ops failure recorder; 429 asks to retry later; duplicate content asks for changed text. Reply failures preserve the published main post and appear on its record. Delete removes the main post; its separate link reply must be managed on X. Statistics and comment management remain on X.

## Cost rule

Per owner pricing decision: ConstructHUB pays $0.015 per post, or $0.20 when a post contains a URL. **Never put URLs in the main X post.** Strip every detected link and send all links as ONE reply immediately afterward. That reply incurs the URL-post charge; splitting does not make the links free. A link-only composition needs main text or media. Both main text and the one reply must fit 280 weighted characters; do not split into multiple replies.

`shared/social-x.ts` supplies both preview and server validation. Approximation: NFC normalization, twitter-text Unicode weight ranges (ordinary Latin = 1, CJK = 2), emoji grapheme clusters = 2, URLs = 23. Intl's emoji segmentation can differ from X's pinned version. URL recognition conservatively includes explicit schemes, www and bare Unicode domains without a TLD database; domain-like text may also move to the reply. The counter shows the main text after link removal. X remains the final validator.

## Retention and revocation

Disconnect removes stored tokens and connected account details. Revoke remote access at https://x.com/settings/connected_apps; there is no X revocation webhook implemented here. Stored post records persist until account/data deletion. Existing published posts/replies persist on X until deleted there.
