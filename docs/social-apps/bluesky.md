# Bluesky — ConstructHUB Direct

Owner order: October 13, 2026 ("lets launch bluesky"). Adapter `bluesky` in `server/social/native-nets.ts`; nothing to register with Bluesky and no app review.

## Switching it on

- Set `SOCIAL_BLUESKY=on` on the server. There are no app keys: Bluesky (the AT Protocol) has no developer registration for posting apps.
- To open it to every customer without opening the Direct networks still in review, set `SOCIAL_NATIVE_PUBLIC_NETWORKS=bluesky` (comma-separated; `SOCIAL_NATIVE_PUBLIC=true` still opens everything). Admins and `SOCIAL_NATIVE_EMAILS` accounts see it either way.
- `GBP_TOKEN_KEY` encrypts the stored session tokens, like the other networks.

## How a customer connects (verified against the AT Protocol reference, 2026-10-13)

1. Social Media → Connected accounts → **Bluesky** → **Connect** opens a form on our page (there is no Bluesky sign-in page to send them to).
2. They make an **app password** at https://bsky.app/settings/app-passwords and paste it with their handle (`yourbusiness.bsky.social`, or their own domain). App passwords are four groups of four (`abcd-efgh-ijkl-mnop`); the form and the server both refuse anything else, so a customer cannot hand us their main password by mistake.
3. The server resolves the handle (`com.atproto.identity.resolveHandle`), finds the account's PDS from its DID document (`#atproto_pds`; `bsky.social` for most accounts, self-hosters differ), opens a session (`com.atproto.server.createSession`) and reads the profile picture. The password is used once and is not stored; the access token (about 2 hours) and refresh token (about 90 days) are, encrypted.
4. The access token is refreshed within 10 minutes of expiry through `com.atproto.server.refreshSession`; Bluesky rotates both tokens. A revoked app password or deleted account turns into "reconnect it under Connected accounts", like an expired sign-in elsewhere.

## Posting

- Text up to **300 graphemes** (emoji count as 1). `shared/social.ts` gives the composer the same limit.
- **Links, #hashtags and @mentions** are sent as facets with UTF-8 byte offsets (`blueskyFacets`) — without them Bluesky shows plain text. Trailing sentence punctuation stays outside a link; a mention Bluesky can't resolve stays plain.
- **Photos:** up to four. The PDS refuses image blobs over 1,000,000 bytes, so larger files are re-encoded as JPEG (longest side 2,000 px, quality stepping down) before `com.atproto.repo.uploadBlob`. Aspect ratios are sent so the feed lays them out correctly.
- **Video:** one, up to 100 MB, through `video.bsky.app` (`app.bsky.video.uploadVideo` with a service token from the account's PDS, then `getJobStatus` polling, bounded). Processing can take a minute; the post is created once Bluesky returns the processed blob.
- One `com.atproto.repo.createRecord` creates the post; it is published at once, with the link `https://bsky.app/profile/<handle>/post/<rkey>`. Nothing to poll.
- Media downloads use the same pinned-public-DNS transport as X (no private addresses, no redirects).

## Stats, comments, deleting

- Stats and comments: not read from Bluesky yet; the Social Media page says "See it on Bluesky". Deleting a post from ConstructHUB deletes the record on Bluesky (`com.atproto.repo.deleteRecord`).

## Retention and revocation

- Disconnect removes the stored tokens and account details. The customer can also revoke the app password at https://bsky.app/settings/app-passwords, which ends our access at once; the next post then asks them to reconnect.
- Bluesky has no deauthorization webhook.
