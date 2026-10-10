# Feature-page screenshots: shared brief for every helper

The owner wants every ConstructHUB feature page (https://constructhub.us/features/<slug>) to show real
screenshots of the app screen it describes. We capture the REAL app (production build) running against a
throwaway lane database seeded with SAMPLE data. The page will caption these images "Sample data".

## Where things are (all on tower1; reach it with `ssh tower1 '...'` from tower2)
- Worktree: `~/ConstructHUB-featshots` (branch feat/feature-page-screens). Node 20: `export PATH=$HOME/.nvm/versions/node/v20.19.6/bin:$PATH`
- Lane server: production build at http://localhost:8489, DB `constructhub_dev_fs` on 127.0.0.1:5432.
  DB access: `cd ~/ConstructHUB-featshots && set -a && . ./.env && set +a && psql "$DATABASE_URL" ...`
  Restart only if needed (it caches little): `bash /tmp/chx_fs_start.sh`. Do NOT rebuild (`npm run build`) — another helper's capture may be running; ask the lead in your report if you think a rebuild is required.
- The signed-in sample user is user id 1: "Sam Rivera", company "Summit Roofing Co.", email sam@summitroofing.example, plan key `agency` (= Unlimited, every tool unlocked).
- Capture: `cd ~/ConstructHUB-featshots && set -a && . /tmp/chx_fs_login.env && set +a && node script/feature-shots/capture.mjs script/feature-shots/shots/<group>.json [only-key]`
  It writes `client/public/feature-shots/<key>-<n>.webp` (1600 px wide). Shot spec fields:
  `{ "key": "<feature key>", "n": 1, "route": "/google-reviews", "alt": "...", "caption": "...", "wait": "text to wait for", "actions": [{"click": "css or text=..."}, {"fill": "css", "value": "..."}, {"wait": 500}], "clip": "optional css of the element to crop to" }`
  Playwright selectors work in click/fill/hover (e.g. `text=Google profile reviews`, `[data-testid=...]`, `role=tab[name="..."]`).
- To LOOK at a result (you must look at every image you keep): `scp -q tower1:ConstructHUB-featshots/client/public/feature-shots/<file>.webp $CLAUDE_JOB_DIR/tmp/` then Read it.
  Use your own `$CLAUDE_JOB_DIR/tmp` (or /tmp/<yourname>_*) for temp files.

## What you deliver
1. `script/feature-shots/seed/<NN>-<group>.sql` — idempotent: first deletes exactly the rows it inserts (fixed ids or a
   marker you choose), then inserts. Wrap in a transaction. It must refuse to run unless `current_database()` matches
   `constructhub_dev_%` (e.g. a DO block that raises). Apply it to the lane DB.
2. `script/feature-shots/shots/<group>.json` — 1 to 3 shots per feature key in your group: the main screen first, then
   the most telling detail (a dialog, a tab, a result). Every shot has `alt` (what the image shows, one sentence, for
   screen readers and SEO) and `caption` (short, e.g. "Review requests with open and click tracking").
3. The images, captured and looked at. Re-seed / re-shoot until each one looks like a busy, real, healthy account:
   tables with 6–12 rows, varied realistic values, dates spread over the last weeks relative to TODAY (2026-10-10),
   charts with plausible shapes, no empty states (unless an empty state IS the point), no error toasts, no
   "undefined"/"NaN"/raw ids, nothing cut off awkwardly.
4. A short final report: each shot file + caption, anything you could not show and why, and any app bug you noticed.

## Hard rules
- ONLY the lane DB `constructhub_dev_fs` at 127.0.0.1:5432. Never vb11, never port 5433, never production, never any
  other `constructhub_*` database.
- Do NOT edit app code (client/, server/, shared/) or feature-page files, and do not commit or push — the lead does that.
  Only add files under `script/feature-shots/seed/` and `script/feature-shots/shots/` (yours only) plus the images.
- Sample data must be clearly fictional and never resemble a real company or person: business names like "Summit
  Roofing Co.", "Clearpeak Exteriors", "Front Range Gutters"; people like "Maria Delgado", "Tom Becker"; emails at
  `*.example`; phones in 555-01xx; websites `*.example` (e.g. summitroofing.example). Sample IPs from documentation
  ranges only (192.0.2.x, 198.51.100.x, 203.0.113.x; IPv6 2001:db8::/32). No real brands as customers or competitors.
  Before keeping a business name, google it first (in quotes) and drop any name that matches a real company —
  the first pass shipped "Foothills Fence Co." (shown with a SUSPENDED ad account), "Foothills Fence & Deck",
  "Copper Creek Concrete", "Mile High Concrete & Paving" and "Peakline Exteriors" (a real Calgary exteriors
  company), all later renamed.
- NEVER invent government data (permits, permit portals, appraiser/assessor offices, property records). If a screen
  needs it, use what is already real in the DB, or skip and say so.
- Use Denver, Colorado as the sample service area (city names and real coordinates are fine; street addresses must be
  vague like "Denver, CO 80202" or obviously sample).
- Read the page component (client/src/pages/...) and its API route + table schema (shared/schema.ts, server/...) to learn
  exactly which rows/columns the screen reads. Seed through SQL, matching the columns the code really reads.
- Keep it to your group. If a screen cannot show data without an outside provider call that the lane cannot make, show
  the best real screen you can (e.g. settings/configuration view with sample values) and say so.
