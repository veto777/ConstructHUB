Round 7 filming fixes — Codex, 2026-10-11

Implemented items 1–16 within the lane's owned files, including the newly authorized item 14 and reference-copy sync in part 2. Changes were not committed, pushed, merged, or deployed. No project dependencies or prices were added or changed.

| Item | Implementation (repository file:line) | Verification |
| --- | --- | --- |
| 1 | `client/src/components/site-connections/report.tsx:346` — numeric overview tiles use US thousands separators; null and nonfinite numbers remain unavailable. | `server/cloudflare/presentation.test.ts:687`; Playwright asserts the 22,010 tile. |
| 2 | `client/src/pages/site-connections.tsx:1347` — Ads path appears only for ads-door. | Playwright switches all three packs at 390px and 1280px. |
| 3 | `client/src/pages/site-connections.tsx:541` and `:1065` — Add to preview focuses the preview heading after switching tabs and scrolls with selected-site tabs visible. | Playwright checks activeElement and heading/tab viewport bounds at both widths. |
| 4 | `server/cloudflare/routes.ts:693` — visitor/exemption warning for every pack; Ads rate-limit/high-security notes only for Ads; site-wide rate-limit note only for bad-UA. | Three route tests in `server/gsc/report-routes.test.ts:343`. |
| 5 | `client/src/pages/site-connections.tsx:577` and `:1401` — preview success is an inline live status in the review box, with the success toast suppressed for this action. Failures retain their error toast. | Playwright checks one Preview ready status inside review; inspected phone/desktop screenshots. |
| 6 | `client/src/components/site-connections/report.tsx:122` and `client/src/pages/site-connections.tsx:1247` — Owner / Full / Restricted / Unverified, including the filter options. | All four mappings unit-tested; Sites browser test checks Owner and absence of siteOwner. |
| 7 | `client/src/components/site-connections/report.tsx:121`, `:281`, `:585` — numeric metrics start descending; text starts ascending; repeated header clicks toggle. Phone sort picker uses the same defaults. | Column-default unit test and browser URL assertions for Clicks and Breakdown at both widths. |
| 8 | `client/src/pages/site-connections.tsx:307` and `server/gsc/routes.ts:142` — non-date breakdowns default to one total per key across the date range, preserving weighted CTR/position. Day/week/month are optional. | Route tests at `server/gsc/report-routes.test.ts:329` check default total grouping and explicit day; browser checks query default and day selection. SQL contract tested with mocked pool; live DB not available. |
| 9 | `client/src/components/site-connections/report.tsx:453` — selected trend bar is revealed by scrolling only the chart horizontally. | Browser checks the initially selected late-period bar fits the phone viewport and keyboard selection still works. |
| 10 | `client/src/components/site-connections/url-actions.tsx:101` — top spacing separates URL actions from the Coverage note. | Browser measures at least 24px between note and heading at both widths; screenshots inspected. |
| 11 | `client/src/components/site-connections/url-actions.tsx:110` and `:122` — wider equal-width desktop columns, full-name title, and wrapping property name beneath the select. | Browser checks title and document width at both widths; screenshots inspected. |
| 12 | `script/feature-shots/seed/30-ads.sql:1985` — idempotent edge_location_links insert for sample assets 930111/930121 and matching sample locations 910001–910003. Uses the application's same-owner and normalized-host rule, including the main Summit Roofing Co. location. | Seed transaction test passed. DB test in `server/cloudflare/film-seed.test.ts:13` covers repeated application, owner isolation, host mismatch and sample IDs, but is skipped without DATABASE_URL. Seed was not applied to any database. |
| 13 | `server/data/master-class-modules.json:4`, `:20`, `:36`, `:52` — descriptions teach plain topics; related ranking/revenue/lead promises in feature bullets were removed. | `server/master-class/film-copy.test.ts:4`; all four descriptions and feature lists checked. Part 2 adds a copy-only sync for existing database catalog rows; see below. |
| 14 | `server/data/state-guide-steps.json:7`, `:31`, `:43`, `:55`, `:67`, `:79`, `:91`, `:103`, `:127`, `:139`, `:175` — neutral descriptions/tips for WA 1/3/4/5/6/7/8 and FL 1/3/4/7. Florida step 1 uses the exact approved proposal. Removed unsourced fees, coverage figures, entity recommendations and vendor endorsements in those steps. | `server/seed-reference-data.test.ts:12` checks all 11 steps; browser tests at `server/cloudflare/prefilm-browser.test.ts:261` render the JSON copy for both states at 390px/1280px. All four screenshots inspected. |
| 15 | `client/src/components/master-class/lesson.tsx:42`, `:75`; `client/src/components/master-class/state-guide.tsx:185` — reserve reset-control space and stable Mark done label width. | Playwright measures checkbox coordinates and scroll position on completion at 390px/1280px for both module lessons and state steps; lesson uncheck also checked. Tests wait for fonts before measuring. |
| 16 | `client/src/components/guides/progress.ts:41` — “Progress is saved in this browser for your account only.” Existing visit-only/storage-failure/account-error disclosures retained. | Browser assertion plus existing progress tests for account isolation, storage failures, migration, and cross-tab updates. No server progress sync exists. |

Part 1 validation (retained from the earlier report): `export PATH=$HOME/.nvm/versions/node/v20.19.6/bin:$PATH; npm run check` passed (exit 0) after the final code/test changes. The related suite finished with 12 files passed, 116 tests passed, 1 DB test skipped. Command:

```sh
export PATH=$HOME/.nvm/versions/node/v20.19.6/bin:$PATH
DATABASE_URL= npx vitest run --configLoader runner \
  server/cloudflare/prefilm-browser.test.ts server/cloudflare/film-seed.test.ts \
  server/gsc/report-routes.test.ts server/cloudflare/presentation.test.ts \
  server/master-class/film-copy.test.ts server/master-class/progress.test.ts \
  server/master-class/recovery.test.ts server/master-class/master-class.test.ts \
  server/master-class/content-safety.test.ts server/gsc/property-detail.test.ts \
  server/gsc/client.test.ts server/cloudflare/credential-body.test.ts
```

The runner config loader avoids the supplied read-only node_modules/.vite-temp directory. Node 20.19.6 and Chromium were downloaded outside the repository; browser runtime libraries/fonts were extracted under /tmp without project dependency changes.

Screenshots generated by the in-worktree `server/cloudflare/prefilm-browser.test.ts` script are under `/tmp/r6-prefilm-screens/`: `r7-preview-{390,1280}.png`, `r7-search-{390,1280}.png`, `r7-progress-{390,1280}.png`, and `r7-state-progress-{390,1280}.png`. Phone and desktop screenshots were opened and inspected. These use isolated API fixtures, not the requested live featshots database. Test Vite servers and browsers are closed by teardown.

Part 1 environment limitations (historical): neither score6 audit report nor the ConstructHUB-featshots directory/.env was found then. No tower1 connection details are supplied. The .git pointer also targets absent metadata. Consequently audit-report comparison, live Express/sample-user screenshots, and live linked-location verification remain outstanding. No .env was created, and no database or port 5433 was accessed.

Part 2 — item 14 and existing-database copy sync

Read both available audits at `/out/score6-tools-codex.md` and `/out/score6-tools-kimi.md`, including their Master Class sections and matching filming lanes (Codex D; Kimi D/G). The explicitly requested part-2 scope is implemented above and below; earlier uncommitted work was retained.

| Item | Implementation (repository file:line) | Verification |
| --- | --- | --- |
| Copy sync | `server/seed-reference-data.ts:119`, `:150`, `:210` — the same seeding pass seeds empty catalogs then synchronizes only module description/features by title and step description/tips by state code → state_guides.id → state_guide_steps.state_guide_id plus step_number. NULL-safe comparisons avoid unchanged writes; one line reports both updated counts. Course seeding and sync share a transaction. | `server/seed-reference-data.test.ts:24` — real PostgreSQL fixture: empty catalogs → seed → modify JSON in memory → exactly 1 module/1 step updated → repeat updates 0/0. Full-row comparisons prove price, is_active, IDs, titles, URLs, category/order, required flags and timestamps are preserved; progress sentinel unchanged; unmatched source rows ignored. |
| Fresh database seeding | `server/seed-reference-data.ts:159` — removes the stale pre-insert guide-count gate and maps state codes to actual guide IDs instead of trusting exported numeric IDs. | Same DB fixture seeds WA/FL under deliberately different IDs (9001/9002); all 15 steps and all modules appear on the first course seeding pass. |
| Screen verification | `server/cloudflare/prefilm-browser.test.ts:261` — renders actual revised JSON for WA and FL; checks every description/tip, visible keyboard focus, phone width, and checkbox stability. | Four browser cases passed. Opened and inspected `/tmp/r6-prefilm-screens/r7-state-progress-{FL,WA}-{390,1280}.png`. Browser/Vite servers closed by teardown. These are isolated API fixtures, not live featshots screenshots. |

Part 2 environment and DB verification: the requested `~/ConstructHUB-featshots/.env` and tower1 connection are still unavailable. To exercise the SQL, a disposable PostgreSQL 17 cluster was created under `/tmp/r7-pgdata`, listening only on 127.0.0.1:55437, with an empty database named `constructhub_dev_fs`. The fixture test passed there (2/2 tests), using connection-local temporary tables. This is not the existing featshots lane DB. No production database or port 5433 was accessed; no .env was created. The actual lane DB pass and live Express/Sam Rivera screenshots remain blocked on access to the featshots environment. The temporary PostgreSQL server was stopped after verification.

Node 20.19.6 is supplied at `/node/bin` in this runtime (the requested ~/.nvm path is absent). Browser/runtime/PostgreSQL tools were downloaded and extracted outside the repository under /tmp; no project dependencies changed. Changes remain uncommitted; no push, merge, or deployment occurred. Git status cannot run here because git and the metadata targeted by .git are absent.

Part 2 final validation: `npm run check` passed under Node 20.19.6. The following related suite passed 49 tests in 6 files, with the lane-gated DB test skipped without a URL:

```sh
export PATH=/node/bin:$PATH
DATABASE_URL= npx vitest run --configLoader runner \
  server/seed-reference-data.test.ts server/master-class/film-copy.test.ts \
  server/master-class/progress.test.ts server/master-class/recovery.test.ts \
  server/master-class/master-class.test.ts server/master-class/content-safety.test.ts
```

Separately, `server/seed-reference-data.test.ts` passed 2/2 tests against the disposable PostgreSQL fixture described above. The focused browser command `DATABASE_URL= npx vitest run --configLoader runner server/cloudflare/prefilm-browser.test.ts -t 'state copy'` passed 4/4 selected cases (10 unrelated cases filtered out), with `PLAYWRIGHT_BROWSERS_PATH=/tmp/r7-browsers`, `LD_LIBRARY_PATH=/tmp/r7-runtime/usr/lib/x86_64-linux-gnu`, and `FONTCONFIG_FILE=/tmp/r7-fonts/fonts.conf`.
