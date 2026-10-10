You are a FIX lane for ConstructHUB. Your job: apply every item of the review in ./KIMI-REVIEW.out (your own earlier
read-only review of commit 2b1f9259, the "In the App" feature-page screenshots, which is LIVE on constructhub.us).
Items 1-7 are mandatory; items 8-15 do as many as you can without risk. Work ONLY in this checkout
(~/ConstructHUB-featshots), on the branch fix/feature-shots-kimi (already checked out from origin/main = 2b1f9259).
Commit your work in small commits as you go (`git add -A && git commit`), and push the branch
(`git push -u origin fix/feature-shots-kimi`) at the end. DO NOT merge, DO NOT touch main, DO NOT deploy, DO NOT
touch any other checkout or server. The owner's reviewer will verify and deploy.

Read first: script/feature-shots/README.md and script/feature-shots/BRIEF.md (the rules for sample data), then
KIMI-REVIEW.out in full.

The re-shoot environment is already running for you (details in BRIEF.md and README.md):
- Node 20: `export PATH=$HOME/.nvm/versions/node/v20.19.6/bin:$PATH`
- The lane server is the PRODUCTION BUILD of THIS checkout on http://localhost:8489, DB constructhub_dev_fs on
  127.0.0.1:5432 (lane env in ./.env; load it with `set -a; . ./.env; set +a`). After you change app code or seeds:
  `SKIP_PRERENDER=1 npm run build` then `bash /tmp/chx_fs_start.sh` to restart it (takes ~2 min), and re-apply the
  changed seed(s): `psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f script/feature-shots/seed/<file>.sql`
  (seed order: 00-identity, 10-gbp, 20-reviews, 30-ads, 40-crm, 41-call-assistant; 20 depends on 10).
- Capture: `set -a; . /tmp/chx_fs_login.env; set +a; node script/feature-shots/capture.mjs script/feature-shots/shots/<group>.json [key]`
  then `node script/feature-shots/manifest.mjs`. LOOK at every re-shot image (read the .webp) before keeping it.
- The yellow "Background processing is disabled" banner (item 3): find the env flag the banner reads
  (grep the client for the banner text, then the server for the flag). Prefer the smallest change that removes the
  banner for the capture WITHOUT letting a worker call a real provider with the sample tokens (e.g. enable the flag
  but make sure no queued jobs exist in the lane DB, or capture with the worker on and immediately off). Record
  what you did in README.md.
- If a shot needs a scroll position or a taller frame, use the shot-spec `actions` / `clip` fields (see capture.mjs).

Hard rules: only the lane DB constructhub_dev_fs; never 5433, never production, never another constructhub_* DB.
Sample data stays fictional (BRIEF.md). No invented government data. Do not change prices, plans, or any page
copy outside the feature-shots scope except the specific app copy bugs listed in item 5 (fix those for real in the
app code — e.g. pluralization, the stray count, the header wrap — but keep each fix minimal and in-keeping with the
surrounding code). Before the final push: `npm run check` must be clean; `DATABASE_URL= npx vitest run
server/feature-pages.test.ts server/marketing-seo.test.ts` must be green (the one pre-existing red in
server/help-registry.test.ts, /listing-editor, is not yours).

Finish by writing FIX-REPORT.md in this checkout: what you did per item (1-15), each re-shot image, what you
skipped and why, and the exact verification commands you ran with their results. Commit that too.
