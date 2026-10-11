# Feature-page screenshots (`/features/<slug>` → "In the App")

Owner, 2026-10-10: *"share the screenshots of the actual UX/UI … All the features pages needs examples of the pages!"*
Every feature page shows real screens of its tool. They are captured from the **production build of the app**
running in a throwaway lane against a **sample account** ("Sam Rivera", "Summit Roofing Co.", Denver CO), and
the page labels each one **"Sample data"**. No real customer, company or person appears, and no government data
is invented (Permits and Property show only real directory data).

| Piece | What it is |
| --- | --- |
| `seed/*.sql` | The sample data, one file per group. Each is idempotent and refuses to run unless `current_database()` is a `constructhub_dev_*` lane — `10-gbp`, `20-reviews` and `30-ads` also accept a walkthrough recording database (`constructhub_tut_*` schema or database; `scripts/tutorials/seed-platform.ts` applies them to the video template, user 1 untouched). `00-identity.sql` renames user 1. |
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

## Killing the "Background processing is disabled" banner for captures

The Cloudflare / Search Console pages show a yellow "Background processing is disabled…" notice whenever
`GET /api/{cloudflare,gsc}/connections` reports `workerEnabled: false`, which comes from the
`EDGE_SEARCH_WORKER_ENABLED` env var (`server/cloudflare/routes.ts`). The same env var starts the edge worker
loop in-process (`server/cloudflare/worker.ts`), so you cannot just flip it on for a capture — the first tick
(~1 s) would queue `discover` jobs for every seeded connection. It still could not reach a real provider (the
seeded tokens are plaintext `sample-placeholder-not-a-token`, and `decryptToken` throws before any network
call), but the queued/failed rows would pollute the Work-queue tab.

The safe recipe used for the 2026-10-10 re-shoot (review item 3):

1. Pre-flight: `SELECT state,count(*) FROM edge_jobs GROUP BY 1;` — expect only `done` rows (no queued/running).
2. Insert two blocker rows so `scheduleEdgeDiscovery` (which skips a connection whose `discover` job ran in the
   last hour) queues nothing:
   `INSERT INTO edge_jobs(user_id,connection_id,kind,state,started_at,finished_at,available_at) VALUES
   (1,930101,'discover','done',now(),now(),now()),(1,930102,'discover','done',now(),now(),now());`
3. Add `EDGE_SEARCH_WORKER_ENABLED=true` to the lane `.env`, restart the lane
   (`bash /tmp/chx_fs_start.sh`), verify `workerEnabled: true` on both connections endpoints.
4. Capture `cloudflare` + `searchConsole` shots.
5. Undo: remove the env line, delete the blocker rows
   (`DELETE FROM edge_jobs WHERE connection_id IN (930101,930102) AND started_at > now() - interval '2 hours' AND finished_at = started_at;`),
   restart the lane.

## Shot-spec tips learned the hard way

- The dashboard scrolls an inner container (`main` on most pages, sometimes a nested `div`); Playwright
  `fullPage` does not grow the page and `clip` screenshots of tall sections time out. Use the `actions` list:
  `scroll` a row into view, then an `evaluate` action
  (`document.querySelectorAll('main,div').forEach(e => { if (e.scrollHeight > e.clientHeight) e.scrollTop += N })`)
  for pixel-precise framing between sticky tab bars and cut-off rows. `capture.mjs` supports `evaluate`.
