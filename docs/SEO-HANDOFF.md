# SEO build — handoff to the coordinator session (2026-10-09, 9:40 AM ET)

Written by the tower1 SEO session (`~/ConstructHUB-seo` and worktrees) on the owner's instruction, relayed by the
coordinator on vb11: "pass on the task and continue the work it failed to do". From this commit on, the SEO work lives
in the coordinator session. This session made no edit, merge or deploy after this document.

Deployed = `main` = GitHub `origin/main` = **`fb728edc`** (release checkout `~/ConstructHUB-release`, deployed
2026-10-09 9:15 AM ET with `script/deploy-vb11.sh` to vb11 `~/ConstructHUB-live`, systemd --user `constructhub.service`).
This handoff commit is docs-only and was **not** deployed.

---

## 1. What is live (newest first)

| Commit | Live since (ET) | What |
|---|---|---|
| `fb728edc` | 10-09 9:15 AM | SEO links round 3: Kimi round-2 leftovers (Reports "Keywords checked" bar, six usage ledger kinds, reveal/paging in the address, missing chips), 44 px phone sizes for buttons/inputs/selects/checkboxes/chips on every SEO page, tab strips wrap, nav via builders |
| `23b8cc41` | 10-09 8:21 AM | "Every figure is a link" across all SEO screens (owner order 10-09 12:57 AM: "all data should take you somewhere"). Contract `client/src/pages/seo/links.ts`; link maps `docs/seo-links/*.md` |
| `2e20bffa` | 10-09 8:07 AM | AI Call Assistant as a **separate service**, repriced; overage charging **OFF**; Gabe can run on OpenAI (env-gated, not switched on) |
| `79cc9809` | 10-08 10:17 PM | Pricing: SEO tools Agency-only for new sign-ups; one-time grandfathering cutover (5 accounts); founding-member offer + /admin switch |
| `b846eea7` | 10-08 9:16 PM | Visual redesign of the 9 other SEO screens (blue wording, orange graphs) |
| `7d1018f1` | 10-08 8:28 PM | Dashboard visual redesign |
| `c818ee74` | 10-08 7:28 PM | Kimi audit #1 fixes (money seams) |
| `f80560dd` | 10-08 6:30 PM | SEO final close-out (Codex audit #55) |

Production state facts (read 10-09 morning):
- `account_pricing_terms`: users 1 (platinum grant), 3 (agency grant), 10 (growth grant) grandfathered, not founding;
  users 9 and 12 (Pro, Stripe, past_due) grandfathered **and** founding. `pricing_settings`: `seo_agency_only_cutover`
  ran 2026-10-09T02:17:21Z; `founding_offer` absent = open.
- Owner's SEO account (user 1, platform admin = unlimited): 7 Alpine sites (ids 1, 3–8: WA, FL, Tampa, Clearwater,
  Sarasota, Orlando, TX). WA and FL analysed 10-08 ~10:25 PM ET with 8 starter keywords each and one rank check; the
  other five are not analysed (~$1.20 each at the customer price). Source of the list: the owner's Alpine session;
  Alpine domains are tracking-only, never modified.
- Call Assistant: 0 subscribers; new tables `call_assistant_subscriptions`, `call_assistant_checkout_attempts`,
  `call_assistant_duplicate_cancellations`, `voice_call_meter`, `voice_overage_claims`, `voice_settle_jobs`,
  `hub_usage_days` exist.

## 2. Unfinished items

### 2a. Things the owner asked for that are not done

| Item | State | Where | What I would do next |
|---|---|---|---|
| Gabe (Hub) answering again | Down for everyone: his model (TruthCode on vast.ai A100 pods, SSH tunnels `truthcode-tunnel` / `truthcode-1m-tunnel` on vb11) refuses connections; TruthCode project's infra, not touched | `server/hub/ai.ts` | Owner adds an OpenAI API key: in the live `.env` set `HUB_AI_PROVIDER=openai`, `HUB_OPENAI_API_KEY=…` (optional `HUB_AI_MODEL`, default `gpt-5.4-nano`; `HUB_AI_DAILY_TOKEN_CAP`, e.g. 3500000 ≈ 500 questions/day), restart, check the boot line `hub: provider openai …` and one real question. Note OpenAI also lists the older `gpt-5-nano` cheaper ($0.05/$0.40 per M) — owner named the cheapest; 5.4-nano was chosen as current. |
| Call Assistant "charge per minute after that" | Overage is **metered and shown, never charged** (`CALL_ASSISTANT_OVERAGE_BILLING` unset = off; copy says "counted but not charged yet") | `server/voice/billing-usage.ts`, HANDOFF.md "NOT PROVEN" section | Close the open Codex items (2.2 below) with real Stripe test-mode runs, then set the env to `on`. |
| À la carte pricing + an SEO add-on for non-Agency plans | Not built; **owner has not given the prices** — never invent | `server/catalog.ts` TODO(owner), `shared/plans.ts` | Ask the owner for the prices. Founding members keep bundles (`shared/pricing-terms.ts`). |
| Founding price used to charge | Stored (`account_pricing_terms.founding_prices`), **not wired into checkout**; `server/billing/founding-baseline.test.ts` fails if a plan price changes first | `server/billing/order.ts` | Wire `foundingPrice(terms, plan, interval)` into order/price resolution before any price change. |
| Top Call Assistant tier earns nothing at full use | 5,000 min / $999 = break-even at 20¢/min; owner was told, chose $999; option offered: 4,000 minutes | `shared/plans.ts` CALL_ASSISTANT_TIERS | Owner decision. |
| Analyse the other 5 Alpine sites | Offered, not asked | — | ~$1.20 each at the customer price; owner's account is unlimited (wholesale ~$0.30 each). |
| Owner-only items carried from before | Google tag IDs, Google Ads OAuth, Stripe live tests, `SEO_MONTHLY_BUDGET_USD` (unset → default $100/month cap), DataForSEO top-up, lead-attribution source | HANDOFF.md | Ask the owner. |

### 2b. `docs/SEO-AHREFS-CHECKLIST.md` PART / TODO / NOT DONE (verbatim pointers)

- PART: **B4** (organic positions / keywords by intent cover the top 100 keywords only), **B8** (linking authors,
  outgoing links of other sites not built), **B10** (compare two months: link history is one year only), **B12**
  (ads: the ad wording itself is not available), **C7** (country list is limited), **C8** (traffic potential / parent
  topic thinner than Ahrefs), **G1** (Content explorer thinner than Ahrefs).
- TODO: **G3 Web Analytics** (not built).
- Audit-era NOT DONE (repeated lines in the Codex audit sections, latest wording):
  - a claim taken over while the first owner's request is in flight asks the data source twice (we pay twice);
  - alert debt from before the #18 migration stays discarded;
  - request queues are per server process (the site runs one process);
  - grid: our own reservation is 1.25× while retries can cost us up to 2× (customer unaffected);
  - Directories "Check again" buys every column again;
  - durable recovery of a purchase that could not be saved (shown and flagged, not recoverable);
  - closed history beyond 5,000 rows has no cursor paging;
  - a PDF font for every script (DejaVu Sans covers Latin/Cyrillic/Greek only);
  - legacy AI answers without a run id are grouped by time;
  - retrying one failed part without buying the overview again.
- Kimi audit #1 left by choice (checklist section "Kimi audit #1"): #5 save/settle crash window, #8 agency list
  (outside SEO), #14 vendor-outage circuit breaker, a second soft-404 probe without a sitemap.

### 2c. Link robot — open flags from its last complete run

Last complete run: **crawl5** on the live code `23b8cc41` (vb11 `/tmp/crawl5.txt`): 2,222 links found, 570 followed, 44
flags. Re-checked by hand (`docs/seo-links/robot/chipcheck.ts.txt`): 43 were the robot checking the filter chip before
the page's data had loaded, or `click({force:true})` on a card mid-relayout — real clicks land correctly and the chips
appear. **1 real**: `?gsc=` / `gscAll` / `gscSort` on a site without Search Console showed no chip — fixed in `fb728edc`.
The robot now waits up to 8 s for the chip and for navigation. A run on `fb728edc` (crawl6) was started and **stopped
by this handoff after 2 pages, 0 flags** — so the deployed round 3 has not had a full robot run. Next: run it (§4b).

## 3. Known bugs and fragile areas

1. **Gabe is down** (see 2a).
2. **Call Assistant overage machinery is NOT PROVEN** — keep `CALL_ASSISTANT_OVERAGE_BILLING` off. Open from Codex
   (`~/codex-audits/out/callassist-audit-5.md` items 2, 3, 6, 7 and `callassist-audit-7.md` "Not blocking"):
   settlement may rewrite a previously attempted Stripe request; deferred minutes can be assigned to a replacement
   subscription (delayed metering reads the subscription at retry time); settle jobs are not exactly-once;
   reconciliation trusts item metadata for the rate. No previous-schema upgrade fixture exists.
3. **Empty-database boot fails** (pre-existing): `server/seed.ts` → `seed-permit-routing.ts:16` runs `ALTER TABLE
   permit_databases` before that table exists. Production is unaffected (tables exist); a fresh environment needs the
   base schema (`npx drizzle-kit push`) first.
4. **Pricing race windows left by design** (HANDOFF.md, `noteFoundingMember` comment): a close-offer click and a
   sign-up in the same instant can add one extra founding member; eligibility = "subscription started inside an open
   offer period and active/trialing when recorded".
5. **Gabe output filter is regex-based** (`server/hub/output-filter.ts`): seven rounds closed every known evasion
   (invented prices, customer counts, vendor name), but it is not a parser; new phrasings can slip.
6. **The test rig can spend real money**: `~/seo-shots-work/restart-app.sh` on vb11 passes the **live** DataForSEO
   login (read from `~/ConstructHUB-live/.env`) into the rig app, although `scripts/seoshots-app.tmp.ts` says "the
   login is not real". `SEO_JOBS_DISABLED=true` stops automatic buys, but pressing Analyse / Run report / Scan on the
   rig spends real credit.
7. **Headless Chromium on the rig** crashes tabs ("Page crashed") without `--disable-dev-shm-usage` (vb11 /dev/shm).
8. **`client/src/pages/seo/links.ts` is a merge hotspot** — every screen appends parameters; resolve conflicts by
   keeping both sides' fields.
9. Old keyword-watch alerts without `snapshotId`/`beforeId` keep plain dates (nothing to open).
10. Action plan kind chips are 24 px visible with a 44 px invisible hit area (`before:` inset) — measuring box
    height reports them as small; they are fine.
11. Shell tasks: never `pkill -f <pattern>` when the pattern is in your own command line (it kills your shell); kill
    by pid (`ss -ltnp`).

## 4. How to run the checks

### 4a. Tests (tower1)
```
export PATH=$HOME/.nvm/versions/node/v20.19.6/bin:$PATH
npx tsc --noEmit -p .                         # must be 0
npx vitest run server/seo shared              # 558 at fb728edc
npx vitest run server/hub server/billing server/entitlements.test.ts server/stripe-billing.test.ts \
  server/pricing-copy.test.ts server/marketing-seo.test.ts
```
Known non-SEO failures: `server/crm/crm-plans.test.ts` (another session's), and any suite needing the CRM dev server
(ECONNREFUSED :8119) or a lane DB.

**Local Postgres** (this session's, now stopped): PostgreSQL 16 started as
`/usr/lib/postgresql/16/bin/postgres -D <dir> -p 15434 -k <dir> -c listen_addresses=127.0.0.1` with a `test`
superuser and trust auth (data dir was in this session's scratchpad and is not kept). To recreate:
`initdb -D ~/pg-seo -U test --auth=trust && postgres -D ~/pg-seo -p 15434 -k ~/pg-seo -c listen_addresses=127.0.0.1 &`.
- SEO real-Postgres scripts: `docs/seo-links/robot/pgchecks.sh.txt` (recreates DB `seotest`, runs every
  `script/seo-*-check.ts`; run `ledger` before `kimi`/`local`). `script/seo-pricing-check.ts` is run the same way.
- Voice/billing "lane DB" suites need a database named `constructhub_dev*` on localhost
  (`server/test-budget-setup.ts`): `createdb constructhub_dev_a9`, `export DATABASE_URL=postgres://test@127.0.0.1:15434/constructhub_dev_a9`,
  `npx drizzle-kit push --force`, `npx tsx -e "import('./server/seed').then(async m=>{await m.seedDatabase();process.exit(0)})"`,
  then `npx vitest run server/voice server/billing …` (1,160 passed at 2e20bffa).

### 4b. The link robot and screenshots (vb11)
- Rig: `~/ConstructHUB-seoshots` (git remote `tower1:/home/veto/ConstructHUB`), DB `constructhub_tut_seoshots`, app on
  `127.0.0.1:8189` with `DEV_AUTH_BYPASS_USER1`. Switch code: `git fetch -q origin <branch> && git checkout -qf FETCH_HEAD`;
  restart: `bash ~/seo-shots-work/restart-app.sh` (copy: `docs/seo-links/robot/restart-app.sh.txt`; see 3.6).
- Scripts (copies in `docs/seo-links/robot/`; on the rig as `scripts/*.tmp.ts`, untracked):
  `crawl-links` — follows every in-app SEO link by clicking it, flags errors, "not found", sideways scroll, missing
  chip for a narrowing parameter, wrong landing (`npx tsx scripts/crawl-links.tmp.ts 50 > /tmp/crawlN.txt`, ~40 min);
  `smoke` — every SEO page at 1280 and 390 px: link count, links under 40 px, overflow, page errors (~3 min);
  `chipcheck` — re-checks flagged addresses with long waits; `shots` — screenshots (`H=`, `SEL=`, `CLICK=` env).
- Kimi audits: `~/codex-audits/kimi_links_run.sh <branch> <prompt> <out>` (plain export, read-only); prompts
  `kimi-seo-links-1/2-prompt.md`; reports `out/kimi-seo-links-1.md`, `-2.md`. Codex: `~/codex-audits/codex_run.sh
  <ref> <prompt> <out>` (one container at a time).

## 5. Data provider (DataForSEO): env and cost caps

- Env (live `.env`): `DATAFORSEO_LOGIN`, `DATAFORSEO_PASSWORD` (set); `SEO_MONTHLY_BUDGET_USD` (**unset → default
  $100/month**, `server/seo/budget.ts` DEFAULT_MONTHLY_BUDGET_USD). Named only on the admin card, never to customers.
- Every purchase goes through `withBudget` (reserve → settle; customer charge = min(cost, customer price, estimate);
  unknown cost keeps the estimate). Retail = 4× wholesale (`shared/seo-credits.ts` SEO_MARKUP). Plan allowances:
  `shared/plans.ts` SEO_PLAN_LIMITS (Agency 1,000 keywords / $40 data per month; Starter/Pro/Growth 0 for new sign-ups;
  grandfathered: SEO_GRANDFATHERED_LIMITS 50/$10, 200/$20, 1,000/$40). Prepaid packs $25/$50/$100 (SEO_CREDIT_PACKS).
- Caps in code: 50 sites per account, 1,000 keywords per site (`server/seo/routes.ts`); duplicate purchases within 5
  minutes (AI asks 120 s) are served from the saved copy; explorer report estimate $0.36; grid point $0.002.

## 6. Scheduled jobs (all in the one `constructhub.service` process)

| Job | Interval | Code |
|---|---|---|
| SEO tick: reconcile reservations, weekly rank runs + post queued runs, collect runs, owed rank alerts, owed refunds, alert delivery, monthly AI questions, scheduled reports, monthly backlink snapshots, keyword snapshots (watch), mention watch, repeating grid scans | every 60 s | `server/seo/jobs.ts` startSeoWorker / seoTick |
| Site Scan crawler | interval worker | `server/sitescan/worker.ts` startSiteScanWorker |
| Pricing cutover (once ever) + founding reconciliation | at boot | `server/billing/pricing-terms.ts` ensurePricingTerms |
| Agency location sync (Stripe quantities) | daily | `server/billing/agency-sync.ts` |
| Call Assistant subscription reconcile / duplicate-cancellation retry | 6 h | `server/voice/subscription.ts` |
| Voice meter retry | 15 min | `server/voice/billing-usage.ts` startVoiceMeterRetryWorker |
| Voice overage sweep | 6 h — **off** (switch) | `server/voice/billing-usage.ts` startVoiceOverageWorker |
| Number release sweep | 15 min (production) | `server/voice/number-release.ts` |
| Spam report | hourly check (production) | `server/voice/spam-report.ts` |
| Escalations | 30 min | `server/voice/escalations.ts` |
| Engine health watch | 5 min | `server/voice/billing.ts` |
| Gabe preset warm-up | once, 5 s after boot | `server/hub/index.ts` |

## 7. Branches and worktrees that can be deleted

All of these are fully contained in `main` (verified: squash trees equal their integration tips; each branch is an
ancestor of the tip that was squashed): `seo/visual-2`, `seo/pricing-a`, `billing/call-assistant`,
`hub/openai-provider`, `seo/preview-all`, `seo/links`, `seo/links3`, `seo/links-15` … `seo/links-20`,
`seo/links3-21` … `seo/links3-23`. Worktrees (tower1, all clean): `~/ConstructHUB-seo`, `~/ConstructHUB-seo-f12`,
`-f13`, `-f14`, `-f15` … `-f23`, `~/ConstructHUB-seo-prev` (each has a `node_modules` symlink to the release checkout —
`rm` the symlink, then `git worktree remove`). Local branches only; none was pushed except `main`.

## 8. Business decisions made in code without an explicit owner instruction

| Decision | Commit | Note |
|---|---|---|
| Grandfathering covers every account whose subscription is not over at the cutover — including Stripe `past_due`/`unpaid`/`incomplete`/`paused` and unexpired grants — and follows whatever plan the account is on later | `79cc9809` | Owner said "existing customers keep it". |
| Founding members = paying Stripe customers only (active/trialing/past_due at the cutover; afterwards a subscription that **started** inside an open offer period); grants are grandfathered but not founding | `79cc9809` | Owner: "their plan price, forever". |
| Founding price snapshot = the whole price book (all plans, both intervals, Agency bands) at marking time; membership survives cancellation ("for life") | `79cc9809` | Owner approved the line "…locked in for life". |
| SEO credit can only be bought by accounts that have the SEO tools; queued rank runs re-check entitlement | `79cc9809` | From Codex pricing audit. |
| Gabe refuses customer counts, invented SEO/Call Assistant prices and the vendor name | `79cc9809`, `2e20bffa` | Policy enforced in the filter. |
| Call Assistant tier names are the minutes ("500 minutes" …) | `2e20bffa` | Owner gave numbers, not names. |
| Above 5,000 minutes = "Talk to a sales rep", never a listed price | `2e20bffa` | Owner said "make $999 our top tier and charge per min after that"; the 50¢ overage applies above every tier, but **overage is not charged yet** (switch off). |
| Overage charging ships **off** (`CALL_ASSISTANT_OVERAGE_BILLING` default off) | `2e20bffa` | Safety: the machinery is not proven. |
| No free trial on the Call Assistant | `2e20bffa` | It costs real minutes. |
| A Call Assistant customer without a CRM plan can run the assistant (leads still file into the org's CRM data) | `2e20bffa` | Follows "a separate service, bought on its own". |
| Extra number stays $5/mo and **$50/yr** (not 11×) | `2e20bffa` | Owner never answered $50 vs $55. |
| A checkout for another order stuck "creating" is voided after 3× the Stripe timeout (min 60 s) | `2e20bffa` | Engineering safeguard. |
| Gabe's OpenAI model default `gpt-5.4-nano`; daily token cap default off | `2e20bffa` | Owner: "cheapest api, if that's 5.4 mini and nano so be it". |
| Duplicate purchase windows: 5 minutes for lookups, 120 s for AI asks | `c818ee74` | Money-safety default. |
| The 14-day CRM trial | **not this session** | Set by `fd964e1d` (2026-10-07, "sell the CRM as a separate product", before this session took over SEO); changed to 7 days by `b683f14f` (owner decision 2026-10-08). |

## 9. What this session left running

Stopped by this handoff: the safety-net check-in timer (session cron), the link robot on vb11 (crawl6), the rig app
on vb11 `127.0.0.1:8189`, and the local Postgres on tower1 `127.0.0.1:15434`. No Codex or Kimi run, background agent,
dev server or timer of this session is left running.
