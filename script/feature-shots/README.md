# Feature-page screenshots (`/features/<slug>` → "In the App")

Owner, 2026-10-10: *"share the screenshots of the actual UX/UI … All the features pages needs examples of the pages!"*
Every feature page shows real screens of its tool. They are captured from the **production build of the app**
running in a throwaway lane against a **sample account** ("Sam Rivera", "Summit Roofing Co.", Denver CO), and
the page labels each one **"Sample data"**. No real customer, company or person appears, and no government data
is invented (Permits and Property show only real directory data).

| Piece | What it is |
| --- | --- |
| `seed/*.sql` | The sample data, one file per group. Each is idempotent and refuses to run unless `current_database()` is a `constructhub_dev_*` lane. `00-identity.sql` renames user 1. |
| `shots/*.json` | What to capture: `{ key, n, route, alt, caption, wait?, actions?, clip? }` — see `capture.mjs`. |
| `capture.mjs` | Playwright → `client/public/feature-shots/<key>-<n>.webp` (1600 px wide). Local lane servers only. |
| `manifest.mjs` | Writes `shared/feature-pages/screens.ts` (generated — never edit by hand) from the JSON + images. |
| `BRIEF.md` | The rules the sample data follows (fictional names, `*.example`, 555-01xx, documentation IP ranges). |

## Re-shooting

```bash
# 1. a lane DB + the prod build on a free port (8489 here)
npm run e2e:lane -- create constructhub_dev_fs
cp ../ConstructHUB-a5/.env .env   # a sanitized lane env; point DATABASE_URL at the lane DB, PORT=8489
SKIP_PRERENDER=1 npm run build
node --env-file=.env dist/index.cjs &          # needs lane-only GBP_TOKEN_KEY (any random value) in .env
# 2. sample data, and a throwaway password for user 1 (the prod build has no dev login)
for f in script/feature-shots/seed/*.sql; do psql "$DATABASE_URL" -f "$f"; done
#    set users.password_hash for user 1 (bcrypt) and export SHOTS_EMAIL / SHOTS_PASSWORD
# 3. capture, then regenerate the manifest
for f in script/feature-shots/shots/*.json; do node script/feature-shots/capture.mjs "$f"; done
node script/feature-shots/manifest.mjs
# 4. drop the lane: npm run e2e:lane -- drop constructhub_dev_fs
```

The capture signs in through `/api/auth/login` with `X-Forwarded-Proto: https` (the prod build only issues its
Secure session cookie over HTTPS; Chromium treats `localhost` as a secure origin, so it is sent back).

Look at every image before committing it. `server/feature-pages.test.ts` checks that every listed screen exists,
belongs to a real page and has an alt text and a caption without prices or stats.
