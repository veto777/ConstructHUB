# FIX-REPORT — feature-shots review (KIMI-REVIEW.out) applied

Branch: `fix/feature-shots-kimi` (base `2b1f9259`, the live "In the App" commit).
Lane: production build of this checkout on http://localhost:8489, DB `constructhub_dev_fs` @127.0.0.1:5432 only.
Date: 2026-10-10.

Note on the checkout: the branch initially sat at `d79eff0d` (19 commits past `2b1f9259`, all already in
`origin/main`). I reset it to `2b1f9259` as the brief specifies, rebuilt the lane (`SKIP_PRERENDER=1 npm run
build`), re-applied all six seeds in order, and restarted. `script/feature-shots`, `package.json` and
`package-lock.json` were identical between the two commits, so nothing was lost.

## Item-by-item

### 1. HIGH — lane guards (mandatory) — DONE
- `seed/00-identity.sql` had no guard; wrapped in `\set ON_ERROR_STOP on` + `BEGIN`/`COMMIT` + the same
  `current_database() NOT LIKE 'constructhub\_dev\_%'` DO block the other seeds use.
- `seed/40-crm.sql:11` — unescaped `constructhub_dev_%` wildcard → `constructhub\_dev\_%`.
- Also tightened `seed/30-ads.sql` delete range 930001–930009 → 930001–930003 (only what the file seeds).

### 2. MEDIUM — real-name collisions (mandatory) — DONE
Verified every replacement with web searches first ("google the name first" is exactly what was added to
`BRIEF.md`, with the list of offenders so the next lane doesn't repeat this):
- `Foothills Fence Co.` (shown SUSPENDED) → **Spruce Line Fence Co.** (`30-ads.sql`, incl. the
  `tom.becker@…` customer-match email domain).
- `Copper Creek Concrete` → **Ralston Creek Concrete** (name + `coppercreekconcrete.example` domain in the
  Cloudflare/GSC site rows).
- `Mile High Concrete & Paving` → **Red Quarry Concrete & Paving** (agency client, GBP listing, review reply).
- `Foothills Fence & Deck` → **Boxelder Fence & Deck**.
- `Peakline Exteriors` → **Clearpeak Exteriors** — verified real (Peakline Roofing & Exteriors, Calgary,
  even owns the `peaklineexteriors.ca` domain stem), and the name is on screen in ~15 shots. Renamed across
  `10-gbp.sql`, `20-reviews.sql`, `30-ads.sql` (incl. the giant sitescan crawl JSON), the sample place id
  (`sample-place-clearpeak`), the `BRIEF.md` example, and the three `wait` strings in `shots/*.json`.
- Re-shot every key where a renamed business is legible: adsManager-1, agency-1/2, gbp-1/2/3, reviews-1/2/3,
  lsaLeads-1, social-1/2, media-*, rankingGrid-1/2, competitors-1/2, mailAlerts-1, domains-1/2, profileGuard-2,
  siteScan-1/2/3, cloudflare-*, searchConsole-* (58 screens total; each looked at).

### 3. MEDIUM — yellow banner on cloudflare-1 / searchConsole-1 (mandatory) — DONE
- Root cause: `workerEnabled: process.env.EDGE_SEARCH_WORKER_ENABLED === "true"` on the connections API; the
  same flag starts the in-process edge worker, whose first tick queues `discover` jobs for the seeded
  connections (plaintext `sample-placeholder-not-a-token` dies in `decryptToken` before any provider call,
  but the queue rows would show in Work-queue shots).
- Safe recipe (recorded in `script/feature-shots/README.md`): verified `edge_jobs` had only `done` rows →
  inserted two `discover/done` blocker rows for connections 930101/930102 (suppresses discovery for ≥1 h via
  the worker's own recency check) → set `EDGE_SEARCH_WORKER_ENABLED=true` in the lane `.env` → restart →
  verified `workerEnabled: true` on both endpoints and zero queued jobs → captured cloudflare-1/2/3 +
  searchConsole-1/2/3 (all banner-free, inspected) → removed the env line, deleted the blockers, restarted.
  `edge_jobs` back to exactly 17 rows.

### 4. MEDIUM — media-3 flooring photos in a roofing company's library (mandatory) — DONE
`20-reviews.sql` media seeds renamed to roofing work: hardwood-floor-installation → tear-off-progress,
floor-finish-detail → ice-and-water-shield-detail, light-oak-flooring → ridge-vent-installation,
flooring-samples → chimney-flashing-repair, carpet-install → gutter-downspout-run, staircase-refinish →
skylight-flashing-detail, hallway-layout → attic-vent-baffles, tile-and-window → tile-roof-detail
(3 folders, 22 photos). media-1/2/3 re-shot; media-3 inspected — labels are all roofing.

### 5. MEDIUM — app copy bugs frozen into shots (mandatory) — DONE (all six, for real in app code)
- customerApi-2: "Reque sts"/"Uni ts" mid-word header wraps → `whitespace-nowrap` on the two `TableHead`s
  (`client/src/pages/settings/api/api-usage-panel.tsx`).
- siteScan-2: "History & score trend 8" stray count → dropped the `count` prop (the pagination pill already
  states the total) (`client/src/pages/site-scan.tsx:809`).
- competitors-1: "Some signals Risk" → "Some signals" (`client/src/pages/competitors.tsx:908`).
- masterClass-2: "Secretary of S…" truncation → `break-words` + `title` tooltip; raw "link unconfirmed" →
  amber-styled span (`client/src/pages/master-class.tsx:137,148`).
- texting-2: "My own number, billed through ConstructHUB" vs "stays on ConstructHUB's carrier account"
  contradiction → option relabelled "A number we set up for you, billed through ConstructHUB" and the amber
  note points at the new label (server semantics in `server/crm/sms.ts` confirm ConstructHUB provisions the
  number on its own carrier account).
- adsManager-2 "1 campaigns…": fixed for real data (`server/ads/audit.ts:28,35` pluralizes campaign/campaigns,
  is/are) and in the seeded findings strings (`30-ads.sql:179,181,184`).
Related LOW copy bugs fixed in the same pass: GBP "Direction s" wrap (`locations.tsx` th nowrap); permits
address placeholder "911, 3520 malland, etc." → "e.g. 3520 Blake St, Denver" (`search.tsx`) and "e.g., 3520
malland" (`databases.tsx`); appraiser directory note "Contact for property records in {county} County." →
"Sourced from NETR Online — contact them for property records in {county} County." (`server/seed-all-appraisers.ts:84`)
plus a one-time UPDATE of the 3,040 existing lane rows (the seeder's repair pass preserves notes, so a
re-seed alone would not have fixed the lane). property-1 re-shot and inspected.

### 6. MEDIUM — captions/alt per the guide (mandatory) — DONE
- `ads.json` customerApi-2 caption "API usage by key over the last 30 days" → "API usage by key, day by day".
- `crm.json` masterClass-1 caption "Four modules and a guide for every state" → "Modules and a state guide for
  every state".
- `reviews.json` social-2 alt drops the third-party product name "Blotato" → "their submission status".

### 7. MEDIUM — harden server/feature-pages.test.ts (mandatory) — DONE
- Reverse coverage: every `status: "ready"` page must now have ≥1 screen (a future screen-less page fails).
- Orphan check: every `.webp` in `client/public/feature-shots` must be referenced by a page's screens.
- Caption rules: captions may contain no digits and no spelled-out number words (new `SPELLED_NUMBER` list;
  the "one list"/"one inbox" idiom is deliberately allowed); alt+caption also ban `\d+x` and `saves \d+ hours`.
- `width`/`height` must equal the actual pixels of the file on disk (parsed with `sharp`), and a screen file
  must be ≤ 200 KB.

### 8. LOW — /call-assistant shade parity + stale comment — DONE
Voices section re-shaded `bg-mkt-paper-2` so Voices…In Depth alternate S-P-S-P-S-P-S again (the new unshaded
02 Screens section had left two adjacent plain bands); stale header comment corrected (signed-in CRM users
get the in-app tool — `App.tsx` routes — so the landing page and its screens are effectively signed-out-only).

### 9. LOW — lock glyph on gated address-bar URLs — SKIPPED (review said "or accept as-is")
Accepted as-is: the review itself marked this acceptable for an "in the app" section; adding UI chrome to the
browser frame would touch shared rendering for marginal benefit.

### 10. LOW — per-page og:image — SKIPPED (risk)
Needs 1200×630 crops generated per page and `seoHeadFor` changes; touches live SEO head markup on all pages.
Better done as its own deployable change than smuggled into a screenshot-fix branch.

### 11. LOW — ~800w srcset variant — SKIPPED (risk)
Real change to the generated-pipeline contract (`capture.mjs`/`manifest.mjs`) plus component markup; the
review itself graded current weight a non-issue (100–250 KB/page, all lazy). Deferred.

### 12. LOW — jobcam GPS precision — DONE
`40-crm.sql` jobcam rows: device coords rounded to 3 decimals (~100 m, neighborhood level) and
`gps_accuracy_m` 6 → 50. jobcam-2 re-shot: now reads "39.74800, -104.95900 ±50 m".

### 13. LOW — clipped frames + rounding/data nits — MOSTLY DONE
- Clipped frames re-shot with the new `evaluate` action in `capture.mjs` (see README "Shot-spec tips"):
  adsManager-1 (scroll to the renamed SUSPENDED row), adsManager-2 (+52px so the first row clears the sticky
  tab bar), cloudflare-2 / searchConsole-2 (scroll to last row + small nudges), domains-1 (+118px = exactly
  one row, all 8 domains + pagination visible), profileGuard-2 (+95px), lsaLeads-2 (+60px), social-2 (+210px),
  agency-3 (−170px), guides-1 (−80px). Every resulting image inspected.
- reviews-2's 102% bars: fixed for real — largest-remainder adjustment in `google-reviews.tsx` so the bars sum
  to exactly 100 (re-shot: 62+12+13+13+0). permits-2 placeholder fixed (see item 5); property-1 copy fixed
  (see item 5).
- permits-2 duplicate "Denver, CO": LEFT AS-IS deliberately. It is real directory data, not a seed artifact:
  Denver legitimately spans four Colorado counties, and each "Denver, CO" row sits under its own county group
  header in the search-area picker (that scoping is the point of the picker). De-duplicating would misrepresent
  real jurisdiction coverage; inventing a "canonical" county would be inventing government data.
- masterClass-1's 4th "stat" is a CTA: by design (review agreed), left.

### 14. LOW — synthetic-data tells — PARTIALLY DONE
- Media-library file sizes de-arithmetic-progressioned (11 distinct values across 22 photos).
- Social submission ids no longer a +37 sequence (sub_fsb0187/0229/0257/0311/0338/0412/0456).
- Timestamp seconds jittered in the two most visible clusters: mail alerts (`(n * 13 % 47)` seconds) and call
  logs (`(n * 29 % 43)` seconds). The remaining identical-seconds cadences (e.g. searchConsole sync times
  ticking at 2-hour :17:49 steps) are interval-generated by seed design and individually invisible; pages are
  labelled "Sample data".

### 15. LOW — mailAlerts + licenses — DONE (with one correction to the review)
- Mail alerts now set `location_id` (910001/910002/910003) on the GBP/GSC/Cloudflare alerts, so most rows read
  "Client location 910001" instead of every alert being "Unmapped / ambiguous client" (mailAlerts-1 re-shot;
  genuinely client-less registrar alerts stay unmapped, which is realistic).
- The review's "off-niche `denverhairepair.example`" is a misreading — the seeded domain is
  `denverhailrepair.example` (hail repair = roofing, on-niche) and it is even mapped to Summit Roofing Co. in
  the domains inventory. Left as-is.
- License strings genericized: CRM org `license_number` dropped (invented 'SAMPLE-RC-0140'; the display
  template "License {n} ({state})" would have made the review's suggested literal read "License Licensed and
  insured in Colorado (CO)"); call-assistant profile license line → "Licensed and insured in Colorado".

## Every image re-shot and inspected (58)
ads.json (17): cloudflare-1/2/3, searchConsole-1/2/3, adsManager-1/2/3, siteScan-1/2/3, customerApi-1/2.
crm.json (13): jobcam-1/2, texting-1/2, masterClass-1/2, permits-1/2, property-1, guides-1, callAssistant-1/2/3.
gbp.json (15): gbp-1/2/3, profileGuard-1/2, gbpContent-1/2/3, rankingGrid-1/2, competitors-1/2, mailAlerts-1,
domains-1/2.
reviews.json (13): reviews-1/2/3, lsaLeads-1/2, social-1/2, media-1/2/3, agency-1/2/3.
Not re-shot (no visible change): clickGuard-*, ipTracker-*, vpnShield-*, crm-*, crmLeads-*, crmSchedule-*,
gabe-1/2, reinstatement-1.

## Verification (exact commands, all run in this checkout with Node 20)
- `SKIP_PRERENDER=1 npm run build` — OK (lane rebuild after checkout reset, and again after the app-code fixes).
- `bash /tmp/chx_fs_start.sh` — server 200 on :8489 after each restart.
- Seed re-apply: `psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f script/feature-shots/seed/{00-identity,10-gbp,20-reviews,30-ads,40-crm,41-call-assistant}.sql` — all six applied clean (plus the guarded 00-identity re-run to prove its new DO block passes on the lane DB).
- Banner window: `SELECT state,count(*) FROM edge_jobs GROUP BY 1` → only `done` (17 before, 19 with blockers, back to 17 after); both connections endpoints returned `workerEnabled: true` during the window.
- `node script/feature-shots/manifest.mjs` → "32 pages, 73 screens".
- `DATABASE_URL= npx vitest run server/feature-pages.test.ts server/marketing-seo.test.ts` → 2 files, 51 tests, all passed (23 feature-pages incl. the new hardening + 28 marketing-seo).
- `npm run check` (= `tsc`) → clean, exit 0.

## Known leftovers (documented, not fixed)
- Items 9/10/11 skipped per above.
- callAssistant-1 shows "24 minutes this month" (seeded usage row) vs "26 minutes on the phone" (computed
  from call durations) — flagged LOW in the review but outside its fix list; minutes are billed vs on-phone
  measures, plausibly intentional.
- callAssistant-3 row numbers skip #4/#9 (the two spam calls are filtered out of the list but keep their
  global numbering) — same status as above.
- gabe-1 demos Gabe with chat off; crm-2 status chips don't sum to "All" (the missing bucket is clients with
  no estimate outcome, by design per `crm-clients.tsx`); masterClass-1's 4th stat column is a CTA by design.
