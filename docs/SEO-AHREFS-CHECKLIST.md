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
- [x] PART  B8  Referring IPs (linking sites grouped by server address) and Sites with similar links - DONE, run live for jameshardie.com 10/8. Still TODO: linking authors, outgoing links (linked domains, outgoing anchors), internal links.
- [x] DONE  B9  Content gap and Link intersect in the Site Explorer menu: up to 3 competitors, suggestions from the report's organic competitors, export, add keywords to the rank tracker; saved for a day. Run against live data 10-08 (193 gap keywords, 2,875 linking sites for alpineexteriorswa.com vs two competitors). Seen in a browser 10-08.
- [ ] TODO  B10 Traffic by country; multi-year history; compare two dates.
- [x] DONE  B11 Organic keywords by position over time (top 3 / 4-10 / the rest) from the saved two-year history.
- [x] PART  B12 Ads: the Google ads a site has run (advertiser, kind, first/last shown, link to Google's own ad page) from the public ad library; Subdomains report (traffic, keywords, top 3 / top 10, value). The ad wording itself and paid landing pages are not available from the source - TODO.
- [x] DONE  B13 AI visibility (`/seo/ai`): ask ChatGPT, Google Gemini and Perplexity a customer's question (web search on) and see for each whether the business is named, where in the list, whether its site is a source, who else is named, which sites were used and what was searched; saved history per question. Plus AI mentions: the questions for which Google AI Overviews / ChatGPT already use a site. Run live and seen in a browser 10-08 (ChatGPT named Alpine Exteriors first; Gemini and Perplexity did not).
- [x] DONE  B15 Opportunities (Site Explorer menu, server/seo/opportunities.ts): one lookup of the keywords the site ranks on pages one and two for (up to 500, most searched) -> within reach (4-20), losing ground (fell 3+), which page ranks for what, searches only the home page ranks for; add to a list / the rank tracker; CSV. Price shown as a maximum ($0.29) with a small-site figure; charged for what returns (6c live for alpineexteriorswa.com, 13 keywords). Says plainly that the data cannot show two pages competing for one search (checked live: one ranking page per keyword). Not in Ahrefs' version here: featured-snippet and declining-content lists.
- [ ] TODO  B14 Filter chips for URL / subdomain / exact-path scope ("Subdomains" selector).

## C. Keywords Explorer (`/seo/keywords`, keywords.tsx)
- [x] DONE  C1  Overview of one keyword: volume, difficulty, CPC with bid range, intent, result count.
- [x] DONE  C2  Search-volume trend by month across years.
- [x] DONE  C3  Who ranks: top organic results with each site's authority, dated, with a Refresh button (was labelled "today" while up to a week old - Codex FAIL, fixed 10-08).
- [x] DONE  C4  What else is on the results page (map pack, people also ask, AI overview …).
- [x] DONE  C5  Matching terms, related terms and questions: filters, sort, paging, CSV, and "track on my site".
- [x] DONE  C6  Many keywords at once (paste up to 200: volume, difficulty, CPC, intent; export; track) and keyword lists (named, saved, add from any keyword report / bulk / content gap, remove, export, track, refresh numbers). Lists are free; the bulk lookup shows its price first. Seen in a browser 10-08.
- [x] PART  C7  Country selector on Site Explorer, Keywords Explorer (overview, ideas, many keywords) and Content gap: United States (English / Spanish), Canada (English / French), United Kingdom, Ireland, Australia, New Zealand, South Africa, Mexico - one choice remembered on the device; the server refuses any pair not on the list (shared/seo-markets.ts). Link reports are the same in every country and are not bought twice. Not covered: the other ~85 countries the source has, keyword lists (refresh is US), batch analysis, the dashboard cards (the site's own country).
- [x] PART  C8  Traffic potential (what the page ranking first earns from search across all its keywords) and parent topic (the keyword that sends that page the most visits; click to open it) on the keyword overview - one more lookup, so the overview is now about $0.20 (was $0.16). Overviews saved earlier say so and offer Refresh. Clicks per search: not available from the source - TODO.

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
              10/8: backlink snapshots now NAME the linking sites lost since the last one (25 strongest: authority, spam score, the page that linked, last seen) on the Backlinks page and in the alert; a strong site (authority 30+) lost is an alert by itself. Verified live for alpineexteriorswa.com (25 of 113 lost sites listed; refresh price $0.31). Local grid alerts: H2. Still not built: alerts for new keywords and web mentions.
- [x] DONE  G5  Reports (`/seo/reports`): the site's report on screen, as a PDF (the account's own name and logo when set), and emailed weekly or monthly to up to 5 addresses, or sent now. Built from saved numbers - free. Seen in a browser; the PDF was rendered and read (and two faults found that way were fixed).
- [x] DONE  G6  Batch analysis (`/seo/batch`): up to 100 websites at once - authority, linking sites, links, estimated search visits, keywords; sort, export, open any in Site explorer. Run live and seen in a browser 10-08.

## H. Beyond Ahrefs: local tools for contractors
- [x] DONE  H1  Local grid (`/seo/local-grid`, server/seo/grid.ts): find the business on Google Maps once, then scan a search from a 3x3 / 5x5 / 7x7 square of points 1-10 miles apart. Position at every point (colour and number), average position, points in the top 3, who leads across the area (with reviews), the first three at any point, history with comparison to the last scan of the same shape. Runs in the background; price first (about $0.20 for 25 points). Source: Google local finder searched from the point's coordinates. Verified live 10/8 for alpineexteriorswa.com ("roof repair", 49 points, 83 s, all checked).
              Found by testing: the first version asked for a map view at each point and showed "not found" two miles from a business that ranks first there - a map view only lists what is inside the picture. Replaced before release.
              Not built: a real map behind the points.
- [x] DONE  H2  Repeating grids (server/seo/grid-monitor.ts): any finished scan can repeat every week or month (up to 5 per site), run by the scheduler from included data only; compared with the scan before it (same search, square, listing and place) and alerted when the area clearly changed (new alert kinds "Local grid worse / better", bell + email, own notification setting); the newest scan of each repeating search is in the scheduled report (highlights + PDF). Verified end to end 10/8 on the screenshots database: watch set in the browser, scheduler pass run for real (50 s, 25 of 25 points), next date moved a month on, alert raised and delivered, PDF lines read back.
              Found by the fresh-database check: the new statements ran before the alerts table existed - moved to the end of the schema list before release.

- [x] DONE  H3  Action plan (`/seo/plan`, server/seo/tasks.ts): a per-site to-do list fed by "Add to plan" on Opportunities, Content gap, Link intersect, lost links and Site audit issues, plus tasks of the customer's own; start / note / done / drop / reopen; a finding added twice is one task; an audit task says when the newest crawl no longer finds the issue; open count on the dashboard card. Free. Verified 10/8: real Postgres 9/9 (script/seo-tasks-check.ts) and in the browser (findings added from three screens, a task started, noted and finished, "Action plan - 4 open" on the dashboard).
              Not built: assigning a task to a team member, due dates, automatic "done" for keyword tasks when the position improves.

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

## Codex audit #9 (2026-10-08; report: tower1 ~/codex-audits/out/seo-audit-9.md)
Verdict: "Substantial SEO functionality, but billing recovery and scheduled delivery still need work. This is not an Ahrefs equivalent."
Coverage: 55% (50-60%); Content Explorer now counted at 20-35%. 10 new defects; done the same day:
 1 monthly AI ask could be bought again if saving failed .. FIXED (the month moves on as soon as it is paid for; saving is retried, never the purchase)
 2 a result could be stored under another search ......... FIXED on every paid page (the result is written under the request it answers)
 3 content paging could strand you on an unbought page ... FIXED (a way back is always there)
 4 Stop could miss an older tracked question ............. FIXED (compared in one spelling)
 5 answers from different asks shown together ............ FIXED (exact run only; an older answer in the table carries its date)
 6 batch: a missing estimate shown as zero; affordability  FIXED
 7 content wording said more than the data ............... FIXED ("matches", authority as one sign)
 8 "reopens free" could fail silently .................... FIXED (the page says when a result could not be kept)
 9 outgoing links shown when links are unmeasurable ...... FIXED
10 an invalid site to leave out was ignored .............. FIXED (refused)
Also: the report now carries real clicks and impressions from Google Search Console when the site's property is connected.

## Codex audit #10 (2026-10-08; report: tower1 ~/codex-audits/out/seo-audit-10.md)
Verdict: "The audit #9 fixes are incomplete"; coverage about 58% (52-64). No cross-account defect found. What was done:
 1 HIGH monthly AI could lose paid answers / re-buy   FIXED: after a paid ask one transaction moves the month on AND parks the answers (seo_ai_unsaved); filing them removes the parked row in the same transaction and is idempotent per run; a background pass keeps retrying (10 min steps, at most 6 h apart) without buying anything. Real-Postgres check script/seo-ai-waiting-check.ts (7 checks). Still possible: the database refusing every write right after the ask.
 2 MED  ads re-bought earlier pages, wrong quote        FIXED: one lookup for all 120, saved, paged free; own price ($0.03, hold $0.04) from the measured $0.006.
 3 MED  ads cap shown as a total; offsets past the cap  FIXED: total is what was returned with "most recent ... may have run others" when capped; offset >= 120 refused; a malformed row no longer shifts pages.
 4 MED  unused filters/sorts made second billable copies FIXED: effectiveReport drops filters a report does not use and replaces an unknown sort; the cache key is built from that.
 5 MED  referring-IP note accused sites of one owner    FIXED: wording now says concentration, not ownership.
 6 MED  subdomain www stripped; missing numbers as zero FIXED: host kept as is; missing numbers are null.
 7 MED  Search Console zeros when nothing was synced    FIXED: null when a period has no rows; change shown only when both periods have 21+ days; the report says when the period is partly synced.
 8 LOW  report states / accessible names                FIXED: separate "couldn't check" state (with Back), report-specific empty text, row-specific names on Explore / See the ad.
 Re-check items: keyword Refresh no longer replaces another keyword's overview; Content explorer's failed check keeps Back; batch "can afford" uses the server's hold; report tables and Site Explorer say when a result could not be kept.
 NOT DONE: legacy AI answers without a run id still grouped by time (old rows only); persisting report purchases that fail to save (they are shown and flagged, not recoverable).

## Codex audit #11 (2026-10-08; report: tower1 ~/codex-audits/out/seo-audit-11.md)
Verdict: "Audit #10 is only partly resolved"; coverage about 59% (53-65). No cross-account disclosure found. What was done:
 1 HIGH paid AI recovery began too late                FIXED: a run row ('asking') is written BEFORE the ask is bought; a known failure closes it; answers are parked on that row together with moving the month on; an 'asking' row left by a crash means the question is NOT bought again that month (logged for a person). Filing can move the month on in its own transaction. One answer per assistant per run is a unique index. Real Postgres: script/seo-ai-waiting-check.ts 6a-6c.
 2 MED  refresh showed one country's overview as another  FIXED: every lookup carries the country it was started in and is dropped if that is no longer the one on screen; the picker is disabled during a refresh; the overview records its language.
 3 MED  country lost in lists and the tracker           FIXED: a list has one country (set when made; other countries are refused with the reason; refresh uses the list's own); tracking from another country than the site's sends the keywords without the numbers and says so. Real Postgres 7a-7c.
 4 MED  location / language not validated everywhere    FIXED: keyword research and site creation accept only a listed pair; list adds too.
 5 MED  traffic potential not the exact organic page    FIXED: the exact URL as the target (host and scheme kept), organic only, null when the source has no figure; tile says "estimated ... in <country>". Limitation found live: the source has no record of some pages (e.g. a Home Depot product page), shown as "Not available".
 6 MED  failed part charged / wrong message             FIXED: the customer pays only for the calls that returned; each missing part is named. NOT DONE: retrying one part without buying the overview again.
 7 MED  hold not an upper bound with search operators   FIXED: operators (site:, intitle: ...) are refused on the keyword overview and the local grid.
 8 MED  Search Console change from missing days         FIXED: two equal 28-day windows counted back from the newest synced day; a change is shown only when both are complete (28/28); coverage is stated whenever a window is short; one rule (server `comparable`) for the PDF, the email and the tile.
 9 MED  English-only "Questions"                        FIXED: question words by language (en, es, fr). Run live in French.
10 MED  unused geography in cache keys                  FIXED: link reports and link intersect are keyed as one page whatever country is sent.
11 MED  failed-save flag ignored on some screens        FIXED: keyword overview, content gap / link intersect and bulk analysis now say so. NOT DONE: durable recovery of a purchase that could not be saved.
12 LOW  inherited property accepted as a sort           FIXED: own properties only.
 Also: the duplicate "couldn't check" alert in report tables removed.

## Codex audit #12 (2026-10-08; report: tower1 ~/codex-audits/out/seo-audit-12.md)
Verdict: "Audit #11 is only partly resolved"; coverage about 57% (50-64). No cross-account disclosure found. Rule adopted for everything bought in the background: SAVED FIRST, CHARGED SECOND. What was done:
 1 HIGH grid retries could be charged / exceed the hold  FIXED: three sums kept apart - what returned (the customer's charge, never more than points x price, always under the hold), what the source billed us, and an allowance for tries whose cost we never learned. Unit test with timeouts and retries.
 2 HIGH a grid could be charged and its results lost     FIXED: the results are written inside the charged call; if they cannot be written the lookup counts as failed and the customer pays nothing. A late result cannot overwrite a failed scan.
 3 HIGH AI recovery could still re-buy / lose answers    FIXED: clearing an unfinished run and moving the month on are one statement; a timeout or other ambiguous failure no longer clears the run (so it is not bought again); the answers are parked inside the charged call - not parked means not charged.
 4 HIGH the new unique index could fail on duplicates    FIXED: duplicates are reduced to the first copy before the index is made, only while it does not exist. (Production had none: checked before deploying.) Real Postgres check.
 5 MED  lists still mixed countries into the tracker     FIXED: a list's own country travels with its keywords to the tracker and when a keyword is opened. Legacy lists: production had none.
 6 MED  late business search pinned to another site      FIXED: search results and the pin carry the site they were made for.
 7 MED  fallback matching unreliable                     PARTLY: the listing's own website is kept and matched; each point records how the business was recognised and the page says when it was not by Google's id; a business counts once per point. An exact identity without Google's id is not possible.
 8 MED  history compared different listings / areas      FIXED: compared only with an earlier scan of the same search, square and listing in the same place; both denominators are shown.
 9 MED  lifecycle across restart, tabs and processes     FIXED: one running scan per site is a unique index; stale scans are closed, not just shown; failed scans stay in the history with the reason; the running scan is watched independently of the one on screen. NOT DONE: the hold of a scan killed by a restart waits for the 30-minute reconciler (no reservation id on the scan row).
10 MED  wording overstated                               FIXED: "local finder", not the map pack; "Position score" with its rule always shown.
11 MED  Search Console "last 28 days" when stale         FIXED: the end date and both windows' coverage are in the email, the PDF and the tile.
12 LOW  orange cells' contrast                           FIXED: dark text on orange and amber; red darkened.
13 LOW  points past the date line                        FIXED: longitudes wrap, latitudes are clamped; tested.

## Codex audit #13 (2026-10-08; report: tower1 ~/codex-audits/out/seo-audit-13.md)
Verdict: "Audit #12 is only partly resolved"; coverage about 56% (49-63). No HIGH finding; no cross-account disclosure. What was done:
 1 MED  "Losing ground" compared two different ranks     FIXED: a fall is place on the whole results page now against then (like with like), shown as "places lost".
 2 MED  pages / home page ignored the host               FIXED: a page is its host and path (no www, no trailing slash, no tracking parameters); only the site's own front page is the home page.
 3 MED  home-page conclusions went beyond the data       FIXED: wording is "the page returned is the home page"; the list is kept when only one page is returned; empty and non-home cases have their own text; a new page is "worth looking into", not a promise.
 4 MED  paid rows discarded                              FIXED: all 500 rows are kept and returned; lists page locally (free) and export everything; each page opens to its own searches.
 5 MED  monthly AI skipped a month with nothing bought   FIXED: a run is 'opened' (nothing sent) until the moment before the ask leaves, then 'asking'; an 'opened' run left behind is cleared and the question asked. Real Postgres 6d-6e. Still treated as unknown: a connection that fails before the request leaves (indistinguishable from one that fails after).
 6 MED  grid's own cost allowance overridden             FIXED: fetchGrid reports its figure as known; the ledger keeps it. NOT DONE: our own reservation is 1.25x while two tries per point can cost us up to 2x (the customer's hold and charge are unaffected).
 7 MED  grid page could stop watching / miss another tab FIXED: the page follows whatever the server says is running, keeps asking until a final answer even after a failed attempt, clears the watch when it ends, and reports a watching problem on its own line.
 8 MED  wrong matches / comparisons without an id        FIXED: the pinned id wins anywhere in the list; without an id on either side the name must match too for two scans to be compared (page, alert and report).
 9 MED  no price on "Look again"; overview required      FIXED: the maximum is on the button; a domain with no report offers "just the opportunities".
10 LOW  Search Console coverage                          FIXED: both windows' coverage is stated independently (including zero) in the email, PDF and tile.
11 LOW  "a point that returns nothing is not charged"    FIXED: "a search that fails is not charged (one that works but finds no businesses is)".
12 MED  clean-up and index creation not atomic           FIXED: each is one DO block under a table lock.

## Codex audit #14 (2026-10-08; report: tower1 ~/codex-audits/out/seo-audit-14.md)
Verdict: "Audit #13 is partly resolved. Repeating grids are useful, but their scheduling and alert lifecycle are not yet reliable"; coverage about 57% (50-64). No cross-account disclosure. What was done:
 1 HIGH a finished scheduled scan could be bought again    FIXED: the period's scan is tied to the watch (run_scan_id) before anything is bought - a pass that finds it finished closes the period without buying; a lease with a token decides who may record the outcome; the next date is counted from the watch's anchor (a late run or a 28-day month never moves it). Real Postgres 11-13.
 2 MED  alert creation failures were forgotten             FIXED: the comparison owed for a scan (alert_scan_id) is set in the same statement that closes the period and cleared only when made; retried every pass. Real Postgres 14.
 3 MED  "clear change" could be missing-data noise          FIXED: only points both scans checked are compared (four fifths of the square must be shared); a collapse is not cancelled by a small contrary signal; a baseline with too little in common is passed over for the one before. Unit tests with the auditor's two examples.
 4 MED  stopping / changing a watch                        FIXED: a stopped watch's lease answers false - nothing more is bought or alerted (real Postgres 14b); no alert about a listing the site is no longer pinned to; the report shows only scans of the current listing (15-15c).
 5 MED  five-watch limit bypassable across processes       FIXED: count and insert under a lock on the site's row (8c); a scan must have been run once before it can repeat (8).
 6 MED  idle grid page never learned of other scans        FIXED: asked again every half minute and on window focus; a watching problem is shown whenever there is one.
 7 MED  "You" in the rivals table could contradict the grid FIXED: one function decides which listing is the business at a point, used by both.
 8 MED  refresh could strand Opportunities on an empty page FIXED: a new set of rows starts at page one; the page number is clamped; a drilled-into page that is gone is closed.
 9 MED  concurrent start-up could fail the index steps     FIXED: the table lock is taken before looking; the look is scoped to this schema and table.
10 LOW  tracker tile's Search Console coverage             FIXED: both windows' coverage stated together.
11 LOW  old Opportunities cache could not be refreshed     FIXED: new cache key ("v2"); old copies are simply not found.
 Also: report grid lines carry their scan dates.
 NOT DONE: our own reservation for a grid stays 1.25x while retries can cost us up to 2x (the customer is unaffected).

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
- 2026-10-08 (slice 12): Search Console in the report, Codex audit #9 fixes. 188 SEO unit tests; the rewritten paid flows (content paging,
  a report page) were run in the browser.
- 10/8 slice 13: referring IPs, similar-link sites, subdomains and ads run in the browser against live data for jameshardie.com (50/50/7/50 rows, 0 page errors). Found by looking: the "Authority" number on two of them was not the site's own - column removed.
- 10/8 slice 14: keyword overview refreshed live in the browser ("siding contractor": traffic potential and parent topic shown; price line $0.20, hold $0.26); switched to Canada - screen cleared, nothing bought until Look up, then Canadian numbers and results (1,300 searches, klzroofing.com first); Site Explorer followed the same choice and showed no report for Canada until asked. 0 page errors.
- 10/8 audit #10 fixes: ads report run in the browser - one purchase, pages 2 and 3 opened without another (purchases counted: 1), "Rows 101-120 of 120 most recent", Next disabled; referring-IP note and subdomain rows read back. Real Postgres: ledger 44/44, places+alerts 20/20, waiting AI answers 7/7.
- 10/8 slice 15 (local grid): in the browser against live data - business found by name and pinned; 5x5 at 5 miles (23 of 25 checked before retries were added; 2 timeouts) and 7x7 at 3 miles in the background (start answered in 61 ms, finished in 83 s, a reload mid-scan picked it up, 49 of 49 checked, charged 40c against a 48c hold). 0 page errors.
- 10/8 audit #11 fixes in the browser, live: keyword overview bought (201); "site:..." refused with a plain message; Canada (French) lookup and the Questions list returned French questions ("comment poser une toiture..."); "Save to a list" offered only a new list, the United States list shown disabled with its country. Real Postgres: ledger 44/44, places+alerts 20/20, AI waiting + lists 13/13.
- 10/8 slice 17 (Opportunities): run in the browser for alpineexteriorswa.com - 10 within reach (3,230 searches a month), 3 losing ground (5 -> 11, 5 -> 14, 7 -> 11), 1 page for 13 keywords, 100% on the home page; charged 6c against a 29c hold. 0 page errors.
- 10/8 audit #12 fixes: real Postgres - ledger 44/44, places+alerts 20/20, AI waiting + lists 13/13, grid lifecycle 10/10 (script/seo-grid-check.ts: the one-running-scan rule created over old duplicates, a second start returns the first, the database refuses a third, stale scans closed, failed scans kept, late results refused). Browser, live: a 25-point scan in the background (42 s, 25 of 25, charged 20c against a 25c hold) while an older scan was opened - the running note and the disabled button stayed, then the new scan appeared in the history.
- 10/8 slice 19 (repeating grids): real Postgres grid check now 18/18 (watches per account, five per site, alert raised once and worded, report lines, a different listing not compared); ledger 44/44, places+alerts 20/20, AI + lists 13/13. Browser: "Every month" set on a scan -> "repeats every month - next on Nov 8"; alerts page shows "Local grid better ... 25 of 25 points, was 5 of 25"; PDF read back with pdftotext.
- 10/8 audit #13 fixes: real Postgres on a fresh database - ledger 44/44, places+alerts 20/20, AI + lists 15/15, grid 18/18. Browser, live: Opportunities for jameshardie.com (500 of 7,217 keywords, 245 within reach paged 50 at a time, "Export all 245", 54 losing ground with places lost, 67 pages, the home page opened to its 13 searches; charged 29c = the stated maximum) and stand-alone for a domain with no report (skagitroofing.net: 6 keywords, 6c, the four home-page searches listed).
- 10/8 slice 21 (named lost links): real Postgres places+alerts check now 24/24 (a strong site lost alerts and is named; a weak one does not; losses collected against another snapshot are ignored). Browser, live: "Refresh now" (201, charged 31c) -> "Sites that stopped linking since Sep 7 - the 25 strongest of 113" with the pages that linked.
- 10/8 audit #14 fixes: real Postgres on a fresh database - ledger 44/44, places+alerts 24/24, AI + lists 15/15, grid + scheduler all passing (crash after the scan was saved -> period closed with 0 lookups; a due watch -> one scan, next date 14 days from its anchor though it ran 2 days late; a second pass buys nothing; another worker's lease left alone; an owed comparison made later; a stopped watch owes nothing). Real scheduler pass on the screenshots database: 58 s, 25 of 25 points, next date two months from the anchor, lease cleared, second pass bought nothing.
- 10/8 slice 23 (Action plan): 264 unit tests incl. the white-label route rule (the four new routes added to its list); real Postgres on a fresh database - ledger 44/44, places+alerts 24/24, AI + lists 15/15, grid + scheduler passing, tasks 9/9.
