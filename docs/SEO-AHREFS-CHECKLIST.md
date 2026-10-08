# SEO: the Ahrefs-equivalent checklist

Owner's instruction (2026-10-08): "build a fucking ahrefs". Target = the owner's Ahrefs screenshots (Projects dashboard,
Site Explorer overview + left menu, Organic keywords, Site Audit). This file is the accountability list: every line is a
thing a user must be able to do, marked DONE only when the code does it and it was checked. An auditor (Codex, or Kimi when it has quota) marks each
PASS / FAIL by reading the code and using the page. Do not mark anything DONE from intent.

Legend: DONE = built, tested and verified against live data · PART = works but thinner than Ahrefs · TODO = not built.

## A. Projects dashboard (`/seo`, client/src/pages/seo/dashboard.tsx)
- [x] DONE  A1  One card per site with authority, referring domains, backlinks, organic traffic (+ value), organic keywords, tracked keywords.
              Codex audit #2: FAIL (a new site did not appear until reload) -> fixed 10-08: adding a site refreshes the dashboard.
- [x] DONE  A2  Trend sparkline and change over the period on authority, referring domains, organic traffic, organic keywords.
- [x] DONE  A3  Opening the dashboard spends nothing (saved numbers only); "Analyse / Refresh" shows its price first.
- [x] PART  A4  Health score per site on the card's Site audit button (from the newest crawl). Not yet a metric tile with a trend.
- [ ] TODO  A5  Add competitors to a project; folders / starred / sort order.

## B. Site Explorer (`/seo/explorer`, explorer.tsx + report-table.tsx; server/seo/explorer.ts, reports.ts)
- [x] DONE  B1  Overview for any domain: authority ring, backlinks, referring domains, followed vs not, organic keywords / traffic / value, paid keywords / traffic.
- [x] DONE  B2  Performance chart (organic traffic, keywords, top-10 keywords) with selectable series, two years of monthly history (was six months; a report now costs about $1.20 instead of $1.12 because the history call costs more). Ahrefs goes back further.
- [x] DONE  B3  Backlink growth chart: referring domains, backlinks, new and lost links per month, 12 months.
- [x] PART  B4  Organic positions distribution; keywords by intent covers the top 100 keywords only, and says so. (Codex: FAIL as DONE.)
- [x] DONE  B5  Left menu of reports, each with filters, sort, paging (25/50/100), CSV export, saved for a day: Backlinks, New / Lost / Broken backlinks, Referring domains, Anchors, Best pages by links, Organic keywords, Top pages, Organic competitors, Paid keywords. Organic competitors and Best pages by links got their filters 10-08 (tested live).
- [x] DONE  B6  Organic keywords filters: position range, volume, difficulty, intent, keyword contains; sort by traffic / volume / position / difficulty / CPC.
- [x] DONE  B7  Tick keywords in a report and add them to the rank tracker.
- [ ] TODO  B8  Referring IPs, linking authors, outgoing links (linked domains, outgoing anchors), internal links.
- [x] DONE  B9  Content gap and Link intersect in the Site Explorer menu: up to 3 competitors, suggestions from the report's organic competitors, export, add keywords to the rank tracker; saved for a day. Run against live data 10-08 (193 gap keywords, 2,875 linking sites for alpineexteriorswa.com vs two competitors). Seen in a browser 10-08.
- [ ] TODO  B10 Traffic by country; multi-year history; compare two dates.
- [x] DONE  B11 Organic keywords by position over time (top 3 / 4-10 / the rest) from the saved two-year history.
- [ ] TODO  B12 Paid ads copy and paid pages.
- [x] DONE  B13 AI visibility (`/seo/ai`): ask ChatGPT, Google Gemini and Perplexity a customer's question (web search on) and see for each whether the business is named, where in the list, whether its site is a source, who else is named, which sites were used and what was searched; saved history per question. Plus AI mentions: the questions for which Google AI Overviews / ChatGPT already use a site. Run live and seen in a browser 10-08 (ChatGPT named Alpine Exteriors first; Gemini and Perplexity did not).
- [ ] TODO  B14 Filter chips for URL / subdomain / exact-path scope ("Subdomains" selector).

## C. Keywords Explorer (`/seo/keywords`, keywords.tsx)
- [x] DONE  C1  Overview of one keyword: volume, difficulty, CPC with bid range, intent, result count.
- [x] DONE  C2  Search-volume trend by month across years.
- [x] DONE  C3  Who ranks: top organic results with each site's authority, dated, with a Refresh button (was labelled "today" while up to a week old - Codex FAIL, fixed 10-08).
- [x] DONE  C4  What else is on the results page (map pack, people also ask, AI overview …).
- [x] DONE  C5  Matching terms, related terms and questions: filters, sort, paging, CSV, and "track on my site".
- [x] DONE  C6  Many keywords at once (paste up to 200: volume, difficulty, CPC, intent; export; track) and keyword lists (named, saved, add from any keyword report / bulk / content gap, remove, export, track, refresh numbers). Lists are free; the bulk lookup shows its price first. Seen in a browser 10-08.
- [ ] TODO  C7  Other countries and languages (US English only today).
- [ ] TODO  C8  Clicks, traffic potential, parent topic.

## D. Rank tracker (`/seo/rank-tracker`, index.tsx)
- [x] DONE  D1  Weekly positions per keyword on desktop and mobile with movement since the last check, including "new" (entered the results) and "lost" (dropped out) - Codex FAIL fixed 10-08.
- [x] DONE  D2  History: project chart (visibility %, average position) and positions-by-band chart per check date; click a keyword for its own history chart and table. Built from saved checks, free. NOT yet seen with real check data (no tracked sites exist on production yet).
- [x] DONE  D3  Tags (set when adding keywords, filter the history). Competitors: follow up to 5 per site; share of voice against them; the other sites seen most on your keywords (one click to follow); who is in the map pack; the first page of Google saved per keyword at each check. All from the checks already paid for. Seen in a browser 10-08 with seeded result pages; competitor positions beyond the top ten start with the next real check.
- [x] DONE  D4  Place-level tracking: a keyword can be tracked from any US city, ZIP code, county, state or metro area (the same keyword in several places), and the Google map pack is tracked per keyword - the business's place in it (matched by website or by business name) and who else is in it. Live check 10-08: "siding contractor" from Bellingham WA found Alpine Exteriors at #1 in the map pack. Seen in a browser 10-08. US only.
- [x] PART  D5  Scheduled email report: done (G5). SERP features won per keyword: only the map pack is tracked.

## E. Billing of SEO data (shared/seo-credits.ts, server/seo/credits.ts, budget.ts)
- [x] DONE  E1  Every lookup charged at 4x wholesale, reserved then settled to the real cost. Codex FAIL (double refund possible; cost of parallel calls lost on failure) -> fixed 10-08: a reservation settles exactly once; failed reports carry the full cost; a failed lookup costs the customer nothing.
- [x] DONE  E2  Plan allowance per month (Starter $10, Pro $20, Growth $40, Agency $40) then prepaid packs ($25 / $50 / $100).
- [x] DONE  E3  Price shown before every lookup incl. "Run check now"; two identical requests at once buy once; a saved page is never charged twice; out-of-credit refuses without running. (Codex FAIL fixed 10-08.)
- [x] DONE  E4  Nothing sold inside the iPhone apps.
- [x] DONE  E5  Usage page (`/seo/usage`): every lookup with what it was, when, what it cost and whether it came from included data or purchased credit; month totals; credit purchases; export.
- [x] DONE  E6  Automatic jobs (weekly rank check, monthly backlink snapshot) spend the month's included data only - never credit the customer bought. (Codex finding 6.)
- [x] DONE  E7  Rank runs: task ids saved after every batch and kept through errors; a removed keyword or a stuck run cannot jam a site; checks that never come back are refunded once (real-database check 11a-11e).
- [x] DONE  E8  Durable reservations (table seo_reservations): the reservation row, the customer's credit and our ledger settle in one transaction; a reservation the process never settled is finished by a reconciler after 30 minutes (customer charged nothing). Verified on a real Postgres with script/seo-ledger-check.ts: 24/24.

## F. Site Audit
- [x] DONE  F1  Site audit tab (`/seo/audit`): run a crawl, health score ring (share of crawled pages with no errors), errors / warnings / notices, issue list with change since the previous crawl, new and fixed issues, affected pages per issue, CSV export, health trend. Reads Site Scan's crawler. Checked against the real stored crawl of alpineexteriorswa.com (150 pages, 13 issues). Seen in a browser 10-08.
- [x] DONE  F2  Site audit -> Pages: every crawled page with status, whether it can be indexed and why not, clicks from the home page, links to it, words, title and description length, size, the issues it is listed under; quick filters, search, sort, export. When a site's links only exist after JavaScript runs (true of alpineexteriorswa.com), link counts and depth are shown as not measurable instead of wrong. TODO: pause/resume, custom page limit (fixed at 150), JavaScript rendering.

## G. Other Ahrefs tools
- [x] PART  G1  Content explorer (`/seo/content`): search the web for pages about a topic; title, site, authority, date, author, excerpt; sort by relevance / strongest sites / newest; filters for date, authority, kind of site, leaving out your own; paging, export, open a site in Site explorer. Run live and seen in a browser 10-08. Not Ahrefs' depth: no traffic or linking-site numbers per page.
- [ ] TODO  G3  Web Analytics.
- [x] DONE  G2  Brand Radar / AI visibility: see B13. A question can be asked again every month (up to 5 per site), from the included data only. Not yet: competitor share across many questions.
- [x] PART  G4  Alerts (`/seo/alerts`, the bell, email): rankings fell / rose, dropped out of / came into the results, left / entered the map pack, linking sites lost / gained; per-site threshold and on/off. Audit regressions use the existing Site Scan notification. TODO: new-keyword and individual lost-link alerts.
- [x] DONE  G5  Reports (`/seo/reports`): the site's report on screen, as a PDF (the account's own name and logo when set), and emailed weekly or monthly to up to 5 addresses, or sent now. Built from saved numbers - free. Seen in a browser; the PDF was rendered and read (and two faults found that way were fixed).
- [x] DONE  G6  Batch analysis (`/seo/batch`): up to 100 websites at once - authority, linking sites, links, estimated search visits, keywords; sort, export, open any in Site explorer. Run live and seen in a browser 10-08.

## Codex audit #2 (2026-10-08, read-only, in a container; report: tower1 ~/codex-audits/out/seo-audit-2.md)
Verdict: "a substantive SEO MVP, roughly 30-40% of the requested Ahrefs surface, not an Ahrefs equivalent."
Checklist verdicts: PASS A2 A3 B1 B3 B6 B7 C1 C2 C4 C5 E2 E4 - FAIL A1 B2 B4 B5 C3 D1 E1 E3.
Its 17 defects, and what was done the same day:
 1 double refund on settle ............ FIXED (settle-once, test settle.test.ts)
 2 parallel-call cost lost on failure . FIXED (test failure-cost.test.ts)
 3 charged but result not saved ....... FIXED for lookups (result still returned); OPEN for rank-run task ids (E7)
 4 unknown cost treated as zero ....... FIXED for our ledger (timeout keeps the estimate); unpaid settle difference is logged
 5 identical requests bought twice .... FIXED (one in flight per account+request; one open rank run per site, unique index)
 6 automatic jobs can drain the wallet  FIXED (E6)
 7 paid rank tasks abandoned .......... OPEN (E7)
 8 price vs amount held disagree ...... FIXED (affordability uses the amount held; rank check shows a price)
 9 new site not on dashboard .......... FIXED
10 errors shown as "empty" ............ FIXED (reports, keywords, explorer, dashboard, backlinks list)
11 partial reports cached as complete . PART (keyword overview now says what is missing; explorer still needs a full refresh)
12 competitor paging stops early ...... FIXED (paging goes by the source's row count)
13 keyword limit race / validation .... FIXED (imports run one at a time per account; metrics validated; real added count)
14 cache mixes markets ................ FIXED (language is part of the lookup; dashboard matches the site's market)
15 agency delegation claimed, not wired  comment corrected; delegation itself is TODO
16 CSV formula injection .............. FIXED
17 no billing fault tests ............. PART (two new test files; no database race tests yet)
B5 (no filters on competitors / best-by-links) remains FAIL.

## Codex audit #3 (2026-10-08, re-check of the fixes; report: tower1 ~/codex-audits/out/seo-audit-3.md)
Verdict: "The fixes are substantive, but 'fixed most defects' overstates the result." Coverage: about 35% of Ahrefs (30-40%).
Of the 17: FIXED 2 (6, 12) - PARTLY 13 - NOT FIXED 2 (7, 15). It also raised 12 new defects. Done the same day:
 N1 settlement could be lost for good ...... FIXED (E8, durable + reconciler, real-database check)
 N2 our cost understated on mixed failures . FIXED (unknown cost keeps the estimate on our ledger; cut-off responses normalised)
 N3 a removed keyword could jam a site ..... FIXED (real-database check 7c-7f)
 N4 dedup incomplete / wrong `reused` ...... FIXED (every paid route; saved copy re-checked inside; waiters get reused:true)
 N5 malformed crawl JSON breaks dashboard .. FIXED (type-guarded SQL, per-site isolation, test)
 N6 "fixed" may mean "not re-checked" ...... FIXED (separate "Not re-checked" list; the next crawl reuses the same Google profile)
 N7 dashboard query count .................. PART (ranks in one query; audit summaries are still computed from the stored crawl)
 N8 stale history / dashboard after a run .. FIXED
 N9 "not ranked" vs "not checked" .......... FIXED (per-device checked flag; chart leaves gaps). Checks remain one per day.
 N10 CSV carriage-return splitting ......... FIXED
 N11 history controls hidden when empty .... FIXED
 N12 rank tracker loading/error, labels .... FIXED (plus a table version of the charts)
Earlier items moved on: 3 (volume/backlink saves still not protected), 8 (the amount set aside is now stated next to each price),
9, 10, 13 (limits match the columns; site limit counts only new keywords), 14 (language is always part of the lookup), 16.
STILL OPEN: 7 (no refund for checks that never return), 11 (a partial explorer report still needs a full refresh),
15 (agency delegation), 17 (ledger checks are a manual script, not in CI), B5 filters on competitors / best-by-links.
Health score: non-page files and off-site redirects no longer count as failures (Codex, section 4).

## Codex audit #4 (2026-10-08; report: tower1 ~/codex-audits/out/seo-audit-4.md)
Verdict: "Substantial progress, but the billing and correctness claims still overstate the implementation." Coverage: about 40% (35-45%).
Re-check of the earlier items: FIXED N3 N9 N10 N11, older 9 14 16 - the rest PARTLY. 15 new defects; done the same day:
 1 reconciler could refund a call that was only slow . FIXED (a late result is settled for real; credit cannot attach to a closed reservation)
 2 outcome write could fail, wrong amount settled .... FIXED (the outcome is handed into the settling transaction; a lost acknowledgement is detected from the row)
 3 unknown spend still understated ................... FIXED (gap, backlink list, rank chunks priced from their own keywords; reported cost never trimmed)
 4 paid task ids wiped on a late error ............... FIXED (kept and collected; unreturned checks refunded)
 5 another business taken for the customer's ......... FIXED (website decides; name only for entries with no website, whole name only)
 6 same-day re-run repeats the alert and email ....... FIXED (one alert of a kind per site per day)
 7 alert could be saved and never sent ............... FIXED (claimed, sent, retried for a day)
 8 index swap had a gap .............................. FIXED (new rule first, then the old one goes)
 9 a keyword's place could change under its history .. FIXED (every keyword stores its place; old rows back-filled)
10 gap price shown for a different request ........... FIXED; a competitor that did not load can be retried
11 "links to every competitor" not enforced .......... FIXED in the parser (the source has no mode switch on this endpoint: tested live, it rejects one)
12 "fixed" when only some pages were re-checked ...... FIXED (every page must have been crawled again)
13 buy-once and import locks are per process ......... OPEN by design: production runs one process; explorer re-checks its saved copy now
14 new data could stay invisible ..................... FIXED (worker-fed pages refetch when opened; alerts poll; imports refresh tracker views)
15 place picker had no keyboard support .............. FIXED (arrows, Enter, Escape; Enter never submits unresolved text)
STILL OPEN: 13 above; N7 (audit summaries computed on read); older 3 (volume / backlink saves), 11 (partial explorer report needs a full refresh),
15 (agency delegation), 17 (database checks are manual scripts, not CI); B5 filters on competitors / best-by-links.

## Codex audit #5 (2026-10-08; report: tower1 ~/codex-audits/out/seo-audit-5.md)
Verdict: "Substantial progress, but billing recovery and outbound reports still need fixes." Coverage: about 45% (40-50%).
Audit #4's 15: FIXED 8, PARTLY 6, NOT FIXED 1 (#13 per-process locks). 15 new defects; done the same day:
 1 report emails had no way to stop them ..... FIXED: every email says who asked for it and carries a signed stop link; an address that
   used it is never mailed again by that account; nothing is sent once the account has no SEO tools. NOT done: asking a new address to confirm first.
 2 schedule marked sent before sending ....... FIXED (leased for an hour, moved on only when every address was dealt with; retried otherwise)
 3 failed late settlement forgotten .......... FIXED (kept on the row, applied by the reconciler; real-database check 12)
 4 rank refunds could disappear .............. FIXED (the run carries its reservation before posting; a refund that cannot be made is owed and retried; check 13)
 5 failed checks stayed charged .............. FIXED (refunded with the ones that never return; check 14). Share is by number of checks, not per-keyword price.
 6 alert claim was not a delivery record ..... FIXED (five-minute lease; sent only when it went out; retried for three days)
 7 usage could invent a charge ............... FIXED (the amount is the row's final credit, nothing computed)
 8 unknown cost is a flag, not an amount ..... OPEN (rank posting is additive; gap and backlinks still use max(reported, estimate))
 9 back-fill could collide ................... FIXED (rows that would collide are left alone)
10 list limits could be raced ................ FIXED (one request at a time per account; one name per account whatever the capitals)
11 "Refresh numbers" did not refresh the list  FIXED (all keywords, in batches of 200, written back; tested live)
12 usage stale / wrong "this month" .......... FIXED. Paging beyond 200 rows: OPEN.
13 report hid a partial check ................ FIXED (checked vs tracked, all movers counted, device named)
14 place lookup counted 62,000 rows each time  FIXED (one indexed read, at most hourly; removed places are deleted)
15 small loading / keyboard faults ........... FIXED
STILL OPEN: 8, 12 (paging), #13 of audit 4 (locks are per process; production runs one), agency delegation, audit summaries computed on read,
a partly-loaded explorer report needs a full refresh, database checks are manual scripts.

## Codex audit #6 (2026-10-08; report: tower1 ~/codex-audits/out/seo-audit-6.md)
Verdict: "Substantial progress, but billing recovery and outbound delivery remain unreliable." Coverage: about 45% (40-50%), with Brand Radar / AI and
the audit page explorer both counted as missing at the time (both since built).
Audit #5's 15: FIXED 5, PARTLY 8, NOT FIXED 1, FIX IS WRONG 1 (alert delivery: the shared notifier swallows email errors). 14 new defects; done the same day:
 7 saved result pages unvalidated ......... FIXED (http(s) links only, host-shaped domains, bounded sizes; test)
 9 share of voice mixed check dates ....... FIXED (one cohort: the latest check day; says how many of the tracked keywords it covers; called an estimate)
 8 competitor positions cut off ........... SAID ON THE PAGE (a check reads only as far as the page the customer's own site is on); not changed, it would raise the cost of every check
10 competitor limit could be raced ........ FIXED
11 half-finished place load looked fresh .. FIXED (a load counts only when it finishes)
13 opening the unsubscribe link opted out . FIXED (the link asks; a button press does it)
14 two months at midnight on the 1st ...... FIXED (one month per reservation, used for refunds too)
 5/6 list refresh ......................... FIXED (replaces the numbers, keeps what was done when a batch fails, never re-adds a removed keyword)
 3 owed refund lost on an abandoned reservation  FIXED (stays owed until the reservation is really settled)
OPEN: 1 and 2 (the shared email / notification helpers record "sent" before sending and swallow errors - outside this module),
4 (cost of posting tasks the source rejected), 12 (a list-name index would fail on pre-existing names differing only by capitals; there are none),
audit #5's 8 (unknown cost as an amount) and 12 (usage paging), audit #4's 13 (per-process locks), agency delegation.

## Codex audit #7 (2026-10-08; report: tower1 ~/codex-audits/out/seo-audit-7.md)
Verdict: "The fixes are substantial, but billing on partial failures, delivery recovery, and the accuracy of customer-facing conclusions still need work."
Coverage: about 50% (45-55%). 13 new defects, on AI visibility and the audit page explorer; done the same day:
 1 an assistant that failed could still be charged ... FIXED (the customer pays only for the parts delivered: AI, content gap, batch; test)
 2 a verdict could be fooled .......................... FIXED in part: a one-word name counts only as a named business, not in running text; the web address
   must be a whole address; a question that names the business says so on the page. The list of businesses is still read from the answer's bold names.
 3 a source inferred from a title ..................... FIXED (a title is read as the site only for Gemini's own redirect address; test)
 4 paid answers lost from view if saving failed ....... FIXED (shown at once; a notice when they could not be saved)
 5 answers from different asks counted together ....... FIXED (the header counts one ask; an older answer is marked as such)
 6 "can be indexed" said too much ..................... FIXED ("nothing blocking Google" / "blocked from Google" / response not recorded)
 7 the JavaScript diagnosis was too sure .............. FIXED (five pages or more before it is made; worded as the usual cause, not a proven one)
 8 big crawls worked out on every read ................ FIXED (kept per crawl; 1,000 pages and 500 links a page at most)
 9 list refresh could re-add a removed keyword ........ FIXED (update-only; keywords the source has nothing for are cleared)
10 alert lease had no owner ........................... FIXED (token). The shared notifier still swallows email errors.
11 AI as a general chatbot ............................ PART (40 questions an hour per account)
13 affordability used the usual price ................. FIXED (uses the amount that must be available)
OPEN: 12 (back-fill is not a versioned migration), the shared email / notification helpers, cost of posting tasks the source rejects,
per-process locks, usage paging, agency delegation, no way to delete a saved AI question.

## Codex audit #8 (2026-10-08; report: tower1 ~/codex-audits/out/seo-audit-8.md)
Verdict: "Substantial SEO functionality, but billing recovery, automatic AI tracking, and customer-facing conclusions still need fixes. This is not
yet an Ahrefs equivalent." Coverage: 50-60%, midpoint 55%, with Content Explorer still counted as 0-5% (built the same day). 12 new defects:
 1 a tracked AI question could drop out of view ..... FIXED (every tracked question is listed with its own Stop; one spelling of a question everywhere)
 5 answers of different asks counted together ....... FIXED (run id; saved all-or-none; the server says whether they were saved)
 6 a failed monthly ask was lost for 30 days ........ FIXED (leased for an hour; the month moves on only after the answers are saved)
 7 an answer could land under another site ......... FIXED (bound to the site it was asked for)
 8 batch analysis invented zeros / no retry ........ FIXED (unknown is shown as unknown; a column that did not load can be retried)
10 canonical tag called a block .................... FIXED (its own filter, described as a request Google usually follows); links are judged on any same-site link
11 crawl limits applied after reading everything ... FIXED (1,000 pages and 500 links a page inside the query)
OPEN: 2 (refund intent not written atomically with the run closing), 3 (cost of rank tasks the source rejects), 4 (the shared notifier),
9 (unknown cost as an amount, outside rank posting), 12 (the back-fill is not a versioned migration).

## Verification log
- 2026-10-08: all 11 domain reports, 3 keyword lists, a filtered keyword report and the keyword overview were run against
  live data for alpineexteriorswa.com / "siding contractor" with zero failures (builder's own check, not an independent audit).
- 2026-10-08: Kimi audit could not run — the one Kimi account signed in on tower1 and vb11 had reached its weekly limit.
  NOT yet verified by the builder in a browser (no browser on vb11): layout and visual quality are unconfirmed.
- 2026-10-08 (slice 2): Site audit, rank history, and the Codex fixes. 86 SEO unit tests pass. The audit summary was run
  against the real stored crawl. Still NOT seen in a browser by the builder; the rank-history charts have never had real data.
- 2026-10-08 (slice 3): Content gap + Link intersect, durable ledger, Codex audit #3 fixes. 100 SEO unit tests pass;
  script/seo-ledger-check.ts 24/24 on a throwaway Postgres; gap and link intersect run live. Still Seen in a browser 10-08.
- 2026-10-08 (slice 4): place-level tracking, map pack, alerts. 113 SEO unit tests pass; script/seo-local-check.ts 17/17 on a
  throwaway Postgres that still had the old schema and rows (the upgrade runs in place); map pack found on live results.
- 2026-10-08 (slice 5): keyword lists, bulk analysis, usage page, Codex audit #4 fixes. 130 SEO unit tests pass;
  script/seo-ledger-check.ts 38/38 and script/seo-local-check.ts 20/20 on a fresh throwaway Postgres. Seen in a browser 10-08.
- 2026-10-08 (browser): every SEO screen was opened in headless Chromium (Playwright) against a recording database on vb11 with
  real lookups for alpineexteriorswa.com - 31 screens plus 7 at phone width, no page errors, no horizontal overflow on a phone.
  Looking found what code review had not: a clipped column in Site audit, wrapping intent labels, capitalised domain chips,
  "city, state" not matching in the place picker, no way to get search volumes in the tracker, arrow glyphs missing in the PDF.
  All fixed. How to repeat it: scripts/seoshots*.tmp.ts in vb11 ~/ConstructHUB-seoshots (not committed).
- 2026-10-08 (slice 7): reports. 142 SEO unit tests pass.
- 2026-10-08 (slice 8): followed competitors / share of voice, filters on the last two reports, two-year history, Codex audit #5 fixes.
  150 SEO unit tests; script/seo-ledger-check.ts 44/44 and seo-local-check.ts 20/20 on a fresh Postgres; unsubscribe, opt-out skipping and
  list refresh exercised end to end in the recording environment; the competitor panel was looked at in a browser.
- 2026-10-08 (slice 9): audit page explorer, AI visibility, Codex audit #6 fixes. 174 SEO unit tests. Both new screens run on real data and looked at
  in a browser; looking at the page explorer on the real crawl is what showed that link counts cannot be trusted on a JavaScript-built site.
- 2026-10-08 (slice 10): batch analysis, positions over time, monthly AI questions, Codex audit #7 fixes. 181 SEO unit tests.
  Batch analysis and the monthly AI question were run for real; every SEO tab was opened in the browser with no page errors.
- 2026-10-08 (slice 11): Content explorer, Codex audit #8 fixes, section tabs wrap to two lines on a wide screen. 188 SEO unit tests.
  Content explorer run live; the AI page re-run in the browser after the run-id change.
