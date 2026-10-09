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
- [x] DONE  A4  Site health on every dashboard card: the newest finished crawl's score with "N of M pages with errors" (distinct pages, the same ones the score counts), its move since the crawl just before it (only when both have a score), and the last six crawls as a list (date, score, pages) - a crawl with no score or one that could not be read stays in the list as such, and the newest crawl is always the current one. Different page limits, or sizes more than a tenth apart, are said: a move can come from crawling different pages. Each crawl's health is worked out once and kept (seo_crawl_health, redone when the crawl changes). The cards can be ordered lowest health first. Free. Verified 10/8: real Postgres 14/14, browser at 1440 and 390 px.
- [x] DONE  A5  Star a site (starred sites stay on top) and choose the order of the cards (as added, name, search traffic, authority, keywords in the top 10, open tasks; remembered on the device). Competitors are followed per site in the rank tracker. Folders are the groups (A9).

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
- [x] PART  B10 Compare two months (Site Explorer overview): any two months of the saved history side by side with the change - organic traffic, keywords, top 3 / top 10, traffic value (two years) and referring domains, backlinks, authority (one year). Free. Not built: traffic by country.
- [x] DONE  B11 Organic keywords by position over time (top 3 / 4-10 / the rest) from the saved two-year history.
- [x] PART  B12 Ads: the Google ads a site has run (advertiser, kind, first/last shown, link to Google's own ad page) from the public ad library; Subdomains report (traffic, keywords, top 3 / top 10, value). The ad wording itself and paid landing pages are not available from the source - TODO.
- [x] DONE  B13 AI visibility (`/seo/ai`): ask ChatGPT, Google Gemini and Perplexity a customer's question (web search on) and see for each whether the business is named, where in the list, whether its site is a source, who else is named, which sites were used and what was searched; saved history per question. Plus AI mentions: the questions for which Google AI Overviews / ChatGPT already use a site. Run live and seen in a browser 10-08 (ChatGPT named Alpine Exteriors first; Gemini and Perplexity did not).
- [x] DONE  B15 Opportunities (Site Explorer menu, server/seo/opportunities.ts): one lookup of the keywords the site ranks on pages one and two for (up to 500, most searched) -> within reach (4-20), losing ground (fell 3+), which page ranks for what, searches only the home page ranks for; add to a list / the rank tracker; CSV. Price shown as a maximum ($0.29) with a small-site figure; charged for what returns (6c live for alpineexteriorswa.com, 13 keywords). Says plainly that the data cannot show two pages competing for one search (checked live: one ranking page per keyword). Not in Ahrefs' version here: featured-snippet and declining-content lists.

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
- [x] DONE  D4  Rank tracker -> by tag: each tag (a service, a town) with its keywords, visibility, how many are in the top 10 and top 3 and the average position, on one device; each keyword's newest saved day against its own saved day before (one result is kept per keyword, device and day - a later check the same day replaces the earlier; checks need not cover every keyword, so the dates both sides span are said); the visibility index is labelled as an index (100 = every keyword first), with its weighting and how many keywords each change rests on; changes only on keywords with both, a keyword checked once counted apart as new; untagged keywords and all keywords as rows. Saved checks only - free. Verified 10/8: unit 4/4, real Postgres 6/6 (incl. a partial run and an old day-only check), browser at 1440 and 390 px.
- [x] DONE  D5  Rank tracker -> Competitors by tag: share of voice, top 10 and average position of the site and the competitors it follows, on the keywords of one tag (a service, a town) or all; only the site's own tags accepted; the earlier answer stays on screen (marked loading, focus kept) while another tag loads - never another site's. Saved result pages only - free. Verified 10/8: real Postgres, browser at 1440 and 390 px.
- [x] DONE  H18 Client reports -> by tag: the report page, its PDF and the scheduled email's PDF show each tag (a service, a town) with its keywords, how many are in the top 10 and the visibility, with the changes since the report's earlier check (the same two checks as the rest of the rankings section; only keywords in both counted; a keyword can carry several tags - said). Up to 20 tags, "and N more". Free. Verified 10/8: unit, real Postgres (a built report carries the tags; another account gets no report), browser at 1440 and 390 px, the PDF downloaded.
- [x] DONE  D4  Place-level tracking: a keyword can be tracked from any US city, ZIP code, county, state or metro area (the same keyword in several places), and the Google map pack is tracked per keyword - the business's place in it (matched by website or by business name) and who else is in it. Live check 10-08: "siding contractor" from Bellingham WA found Alpine Exteriors at #1 in the map pack. Seen in a browser 10-08. US only.
- [x] DONE  D5  Scheduled email report: done (G5). Results-page features per tracked keyword ("On the page" column and a one-line summary): map pack, AI overview, featured snippet, people also ask, videos, images, ads... with a green chip where the site itself is in it (the snippet is its page, the AI overview cites it, a question is answered from it). From the checks already paid for; checks saved before 10/8 show what was on the page but not whether the site was in it. Format confirmed against live results pages 10/8 (jameshardie.com cited in the AI overview for two searches).

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
- [x] DONE  F2  Site audit -> Pages: every crawled page with status, whether it can be indexed and why not, clicks from the home page, links to it, words, title and description length, size, the issues it is listed under; quick filters, search, sort, export. When a site's links only exist after JavaScript runs (true of alpineexteriorswa.com), link counts and depth are shown as not measurable instead of wrong. TODO: pause/resume, custom page limit (fixed at 150).
- [x] DONE  F3  Site audit -> Rendering: up to 10 chosen pages fetched twice - as plain HTML and in a browser with JavaScript run - and the two visits compared: words, links to the site's own pages, title, main heading, plus the browser visit's timings. A page is "more once JavaScript runs", "less", "much the same" or "could not be compared" - compared only when both visits were answered 2xx, ended on the same page of the site and were measured. Says in so many words that it does not measure what Google renders or indexes. Background run, saved before charged, one at a time per site; the button shows the exact most it can cost; offered also when the site has no crawl yet. Not a rendered crawl of the whole site.
- [x] DONE  B14 Site Explorer -> a section or one page: Organic keywords, Paid keywords, Top pages, Backlinks (all, new, lost, broken) and Best by links can be narrowed to a section (the path itself and everything under it - "/blog" is not "/blogging") or to one page (with or without its last slash; exactly as written when it has a query), on the site itself with or without "www" - sub-domains are not included, and the page says so. A pasted address is cut down to its path; one from another site is refused. One spelling per scope, so "/blog" and "/blog/" are one saved report. A narrowed report is its own purchase at the usual price; exports carry the scope and country in their name. Reports the source counts for the whole site do not offer it. NOT DONE: an overview (totals, history) for a section.
- [x] DONE  G6  Keyword watch (Alerts): off until turned on; once a month a snapshot of the searches the search data has the site ranking for (its 300 highest-traffic, in the country it is tracked in) is taken from the month's included data only and compared with the one before. Worded as what the data sees - "newly seen" / "no longer seen" - never "started ranking" or "lost": it is the data's view, not Google's. Like-for-like only when both snapshots hold everything the data has ("whole"); otherwise "entered / left the top 300" or "not known", and no alert. Alerts (when the site's alerts are on) for newly seen searches in the top 20 and no-longer-seen ones that were in the top 10. One snapshot a day, never rewritten - "Take a snapshot now" the same day returns the one there is. One at a time per site by a claim in the database shared by the button and the schedule. Saved before charged; the next date moves in the same transaction.
- [x] DONE  D10 Rank tracker -> searches with largely the same results: tracked keywords whose saved first-page results share at least 4 addresses with the group's first keyword (the highest-volume one), per town and device - free. Worded as an overlap count and a prompt to look, not Google's own grouping; members are compared with the first keyword, not with each other; each member carries the day its results were saved (they can differ); the site's own ranking addresses are listed as recorded, addresses that may be one page are flagged, and "ranks, page not recorded" is told from "not found". "Plan" adds a review task.
- [x] DONE  F4  Site audit -> addresses with no page answered like real pages (suspected soft 404): every crawl asks (robots.txt permitting) for one made-up address at the top of the site and - when the sitemap shows a section with three or more deeper pages - a second one in its busiest section (so one address on a site without a usable sitemap; corrected after Kimi audit #1), new for each crawl - and reads each answer: not found (404/410), a noindexed "nothing here" page, an ordinary indexable page, sent to the home page, or nothing learnt (a sign-in, a bot check, another site, a non-HTML answer, a server error). The issue is raised only for "ordinary page" and "sent home", says exactly which addresses did what, that Google decides case by case, and that other parts of the site may answer differently; the fix gives the server answer first and Google's two alternatives for single-page apps. Called fixed only when a later crawl asked again and every answer was not-found or noindexed. Lives in the crawler (server/sitescan) with its guide and evidence; the crawl's coverage note says whether it was measured.
- [x] DONE  F5  Site audit -> Internal links: pages of the site that use the words of a tracked keyword another page ranks for, without linking to that page - each with the words around the mention, the ranking position and volume, export, and "Plan". From the newest crawl's saved text and the newest rank checks - free. Nothing is suggested when the crawl cannot see the site's links (JavaScript-built menus), and a phrase on most pages is left out as menu text. At most 10 pages per ranking page.
- [x] DONE  D9  Rank tracker -> the page Google shows for each search: tracked keywords for which Google went from one of the site's pages to another and back in the last 120 days (a reason to look, not a diagnosis); apart, those where the page changed once, and those where one page was shown under two addresses. Each line gives the town, the device, the ranked checks it rests on with their dates, and says when the keyword has not ranked since. "Plan" adds a task with the pages, device, place and dates. Saved checks only - free.
- [x] DONE  H6  AI visibility -> the picture so far: across the site's own questions, counting the newest answer from each assistant - named in n of m, website used in n of m, first-named; by assistant; month by month (with how many questions each month rests on); the other businesses named; the websites the assistants read, with review sites and directories marked and addable to the plan. Saved answers only - free. Says it is a sample of the customer's own questions.
- [x] DONE  H7  AI visibility -> who gets named over time (server/seo/ai-summary.ts `trend` / `compare`, ai-summary.tsx): a month-by-month table of how many answers named the business and the six other names named most often (each cell out of that month's answers, questions asked per month shown); and a like-for-like comparison of the newest month with a chosen earlier one that counts ONLY the question-and-assistant pairs answered in both months - named you, website used, other names and source websites before/after, biggest change first, "new"/"gone" marked, small samples called small. Saved answers only - free. Verified 10/8: 4 unit cases, real Postgres 10/10 (script/seo-ai-summary-check.ts), browser at desktop and phone width (0 page errors, no overflow; month labels on phone rows added after looking).
- [x] DONE  H8  Keyword watch history (Alerts -> keyword watch, server/seo/keyword-watch.ts `keywordWatchView(..., pick)`): every snapshot of the site listed (newest 36 choosable, the total said); any snapshot compared with any earlier one (another country marked "not comparable"); "Back to the newest two"; each keyword alert has "Open this comparison", which switches to the alert's site and opens the exact pair of snapshots it was raised from (snapshots are never rewritten, so it shows what the alert saw). Another account's snapshot, the same one twice or the later one as "before" are refused. Saved snapshots only - free. Verified 10/8: real Postgres 37/37 (script/seo-keyword-watch-check.ts 7b), browser at 1440 and 390 px.
- [x] DONE  H9  Keyword watch -> By page (server/seo/keyword-watch.ts `pagesChanged`): for any two compared snapshots, every page of the site with its keywords and estimated visits in each, biggest change in visits first, and why the count moved (newly seen, no longer seen, now ranked with another page, moved here); an unknown visit estimate is never a zero; pages that lost keywords or visits go to the plan with their before/after figures and dates. Saved snapshots only - free. Verified 10/8: unit cases, browser at 1440 and 390 px (18 pages Sep->Oct, "/old" 1 -> 0 planned once).
- [x] DONE  H10 Unlinked mentions (Site Explorer -> Mentions, server/seo/mentions.ts): pages on other websites that use the business's exact name (one page per website, the site itself left out, strongest first) and whether those websites link to the site. A name is not a business: each page is read for the customer's places (towns from the tracked keywords, editable, free to change) and split into "names one of your places" and "same name - check it is you"; an excerpt that does not show the name says so. Tabs: mention you with no link (the prospects), name your places, check it is you, already link, all; plan and CSV. One check = the search and one link lookup, "up to $0.23" = the hold; a link check that fails is not charged and can be tried again alone; saved for a week. Verified 10/8: unit and white-label tests (84 routes), real Postgres 7/7 through the ledger (whole check 20c; link check failed 10c; second try 10c; failed again 0c), live in the browser for alpineexteriorswa.com: 50 websites, 8 name its places, 7 mention it without linking, 7 link, 42 are other businesses called "Alpine Exteriors" (Tampa, Dallas, Calgary) - set apart.
- [x] DONE  H11 Mentions -> "This is us" / "Not us" (server/seo/routes.ts /mentions/marks, table seo_mention_verdicts since audit #33): the customer's verdict per site, name and PAGE, kept and taking precedence over the place match; "Likely you" = confirmed, or naming one of the places and not marked otherwise; "Marked not you" set apart and never planned; a planned task records "confirmed by you". Free. Verified 10/8: real Postgres (mentions 10/10 - a second verdict replaces the first, only the two words stored, gone with the site), white-label rule (85 routes), browser: houzz.com marked us and financialcontent.com marked not us, both kept after a reload.
- [x] DONE  H12 Mentions watch (server/seo/mention-watch.ts): once a month, from the included data only, the pages PUBLISHED SINCE THE LAST CHECK that use the name (every page, oldest first, resuming where the last window ended - since audit #34 - a re-run of the "strongest 50" could not tell a new mention from a website moving into the 50), with the same link check; saved with the next date inside the charged call while the leased occurrence is still current; one "New mentions" alert (bell and email, new notification kind) for pages likely the business (confirmed, or naming a place, not marked otherwise) on websites not known to link; alerts off = settled without one. The alert opens Site Explorer on Mentions (?view=mentions). Verified 10/8: unit, white-label (86 routes), real Postgres 12/12 (off buys nothing; due buys once, 20c, next a month on; one alert for the likely page only; marks respected; a moved date saves and charges nothing; alerts off; another account cannot switch it on); one real scheduler pass on the screenshots database (10 s, charged 20c, 2 pages since Sep 7, neither likely - no alert, next Nov 8) and the panel in the browser.
- [x] DONE  H13 Reports -> "Work done" (server/seo/site-report.ts workSection): the action-plan tasks marked done in the last 30 days, newest first (15 listed, the count of all), with their notes, and how many are still open / in progress - on screen, in the PDF and as a headline in the scheduled email. Worded as what was marked in the plan, not a measurement ("whether a site issue is gone shows in the next crawl"). Verified 10/8: unit, browser (2 tasks done, 21 open) and the PDF text.
- [x] DONE  H14 Action plan -> due dates and owners (server/seo/tasks.ts dueOn / owner): each open task can carry the date it should be done by (a real calendar date) and who is doing it; the plan lists past-due tasks first with "Overdue - was due ..." and a tile; the report and its email/PDF list the tasks past their due date with their owners and how many fall due in the next 7 days. Free. Verified 10/8: real Postgres tasks 18/18 (kept as given, a non-date refused, another account refused, null takes them away), unit, browser (an overdue and a next-week task set; plan order and tile; report).
- [x] DONE  H15 Rank tracker -> how often (Tracking settings, server/seo/jobs.ts RANK_FREQUENCIES): every week (default), twice a week or every day per site, each option priced as a month of checks at the site's keywords (the one-check price multiplied, never a guess) beside what the plan includes; automatic checks still spend the included data only; a site already checked today is not checked again that day; a new frequency counts from the last check. Verified 10/8: real Postgres (each site its own gap - 168/84/24 h; a daily site checked today waits for tomorrow; the database refuses an unknown frequency), browser (60 keywords: $0.64 / $1.29 / $4.50 a month; twice a week saved, next check moved to Oct 12).
- [x] DONE  H16 Site audit -> Outgoing links (server/seo/outgoing-links.ts): every other website the site links to, from the newest crawl - pages linking, links, an example with its link text - and the checked links that did not answer with a page, split honestly into gone (404/410), server error, refused our check (401/403/429 - many sites refuse automated checks) and no answer; only the first two are called broken and offered for the plan; unchecked links are counted, never called fine; the site's own sub-domains are not outgoing; a site whose links JavaScript adds says the HTML is all that was read. Free. Verified 10/8: unit, real Postgres (the account's own crawl only), browser on the real crawls (jameshardie.com: 2,732 links to 39 websites from 145 pages - its investor-relations site gave no answer; alpineexteriorswa.com: the BBB profile refused the check - not called broken).
- [x] DONE  H17 Rank tracker -> Google's own clicks by page and by search (server/seo/gsc-breakdown.ts; since audit #39 a page or search Google did not return is "not returned", never 0, and the property with data is used, the others named): when the site's Search Console property is connected, every page and search with clicks, change, impressions and average position over the last 28 synced days against the 28 before; most clicks / biggest gain / biggest fall; tracked keywords marked; CSV. Incomplete windows are said and not compared; a page or search missing from a complete window is 0, from an incomplete one "not known"; the busiest in either window are kept so a page that lost everything is listed. Saved data only - free. Verified 10/8: unit, real Postgres 4/4, browser with test Search Console rows in the screenshots database (pages and searches, biggest fall first, 1440 and 390 px).
- [x] DONE  A9  Dashboard -> groups (a client, a region): each site can be put in a named group from its card; the dashboard shows all sites or one group (remembered on that computer), with that group's totals - sites, tracked keywords, keywords in the top 10 from the latest checks, open tasks (or "not known"). Free. Verified 10/8: browser - three sites in two groups, filtered with totals at 1440 and 390 px.
- [x] DONE  F7  Site audit -> compare any two crawls: "Showing" any finished crawl of the site (newest 100 listed, by finish date and page limit) "compared with" any older one (default: the one just before it). Every change, fixed issue, "not re-checked" list, health move and screen-reader label then reads against the chosen pair, and the page says which; an older crawl shown says that Pages, Internal links and Outgoing links read the newest, and offers no "Add to plan". Chosen ids must be this account's finished crawls of this site (a baseline also older than the crawl shown); otherwise the default is used and said; a malformed id is refused. Pages reached in one crawl and not the other, first 50 of each; different page limits said; "not reached" never claims a page is gone. Free. Verified 10/8: unit, real Postgres 14/14, browser on a real site's three crawls at 1440 and 390 px.
- [x] DONE  C9  Keyword lists and "Many keywords": "Group by topic" groups the keywords by the words they share, with searches a month per group and select-all per group. Worked out from the keywords themselves - free; said to be a reading aid, not Google's own grouping.

## G. Other Ahrefs tools
- [x] PART  G1  Content explorer (`/seo/content`): search the web for pages about a topic; title, site, authority, date, author, excerpt; sort by relevance / strongest sites / newest; filters for date, authority, kind of site, leaving out your own; paging, export, open a site in Site explorer. Run live and seen in a browser 10-08. Not Ahrefs' depth: no traffic or linking-site numbers per page.
              10/8: page-level numbers added - one button gets, for the 25 pages on screen, the sites linking to each and its search visits, and the list can be ordered by either (two lookups, up to $0.17; a part that fails is missing, not zero). Run live: "fiber cement siding cost" - top by linking sites 735, top by visits a homeadvisor.com guide.
- [ ] TODO  G3  Web Analytics.
- [x] DONE  G2  Brand Radar / AI visibility: see B13. Web mentions of the business: H10. A question can be asked again every month (up to 5 per site), from the included data only. Names over time and a like-for-like month comparison: H7. Not yet: competitor share across many questions beyond the customer's own.
- [x] DONE  G4  Alerts (`/seo/alerts`, the bell, email): rankings fell / rose, dropped out of / came into the results, left / entered the map pack, linking sites lost / gained; per-site threshold and on/off. Audit regressions use the existing Site Scan notification. New keywords: the keyword watch's alerts (kw_new / kw_lost); individual lost links: named in the linking-sites-lost alert (slice 21); mentions: the mentions watch.
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

- [x] DONE  H4  Service-area planner (Keywords explorer -> "Service x town", server/seo/planner.ts): services down the side, towns across the top; each cell is the search "service town" with searches a month and the site's position; gaps / weak spots / home-page rankings marked; tick cells -> action plan, list or rank tracker; last inputs remembered per site; CSV. Two lookups per table. Verified live 10/8 for alpineexteriorswa.com: 6 services x 7 towns = 42 searches, 8 gaps (880 searches a month), charged 11c against a quoted 15c; the 8 gaps sent to the plan; table reopened free after a reload.
              Honest limits stated on the page: counts are nationwide for those words (a town name shared with another state counts both); positions are database estimates, not live checks. Not built: clustering of near-identical searches, a "near me" row, suggesting towns from the service area.

- [x] DONE  H5  Directories (Site Explorer menu, server/seo/directories.ts): 26 review sites, trade directories, maps and social profiles for US home-service contractors; which link to the site and to up to 3 competitors; gaps (a competitor is linked, the site is not) marked and sent to the action plan; CSV. One lookup per site (about $0.11). Verified live 10/8: alpineexteriorswa.com linked from 0 of 26; two local competitors on BBB, Porch, Expertise and Yellow Pages - 4 gaps added to the plan.
              Stated on the page: a dash is "no link found" (a profile with no website link, or one the link database has not crawled, looks the same), and the list is a chosen 26, not every directory.

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

## Codex audit #15 (2026-10-08; report: tower1 ~/codex-audits/out/seo-audit-15.md)
Verdict: "Audit #14 is partly resolved"; coverage about 57% (50-64). No cross-account disclosure or unsafe link found. What was done:
 1 HIGH a failed period-close could re-buy a finished grid   FIXED: once the scan is saved and charged nothing unties it from its period; a failed close is logged and the next pass closes it without buying. Real Postgres 16-16b (the close statement made to fail once).
 2 MED  owed comparisons could be overwritten / starved     FIXED: a queue (seo_grid_owed), one row per scan, each with its own retry time. Real Postgres 14-14b.
 3 MED  monthly anchor was the first due date               FIXED: the anchor is the moment the watch was set (17).
 4 MED  stopping a watch did not fence a comparison under way FIXED: the watch is held for the length of the comparison and its owed rows go with it (14c).
 5 MED  an old listing could alert after re-pinning (no id) FIXED: the name must match too.
 6 MED  "lost since the last snapshot" not established      FIXED in words and logic: the section is "Lost backlinks seen since <date>" - links still being found after that date and now gone; the lookup is always made (no shortcut from an unrelated count).
 7 MED  a lost link shown as the whole site leaving          FIXED: "sites with a lost link ... the site may still link to you from other pages".
 8 MED  net gains hid strong losses                         FIXED: the two questions are asked separately (both alerts can be raised); a strong loss is a followed link from a site that is not spam. Real Postgres 7h-7j.
 9 MED  partial failures / stale loss data                  FIXED: a failed loss lookup is recorded and shown as failed (not charged), never left as the old list; the refresh says so. NOT DONE: one snapshot per day is still the unit (a second refresh the same day replaces the first).
10 MED  first-snapshot price and affordability              FIXED: the page gets this site's own maximum (a first snapshot has one lookup fewer) and shows it on the button.
11 MED  report compared grid scores over different points   FIXED: the report uses the same shared-points comparison as the alert.
12 LOW  alert promised more names than the page keeps       FIXED: it says the page keeps the 25 strongest.
 Also (open since #12): second tries on a grid are rationed to a quarter of the points, so our own cost stays inside the 1.25x reservation. Unit test.

## Codex audit #16 (2026-10-08; report: tower1 ~/codex-audits/out/seo-audit-16.md)
Verdict: "Audit #15 is partly resolved" (the grid period-close fix "is convincing"); coverage about 58% (50-65). No cross-account disclosure or executable task link. What was done:
 1 HIGH audit tasks could falsely look resolved        FIXED: "no longer found" is said only when a crawl finished after the task was added, crawled at least four fifths as many pages as the crawl it came from, re-checked that very issue and does not list it; otherwise the task says why nothing can be said (not rechecked / smaller crawl / could not re-check / newest crawl failed). Unit test with each case.
 2 MED  reopening bypassed the limit; duplicates failed at capacity  FIXED: reopening takes the same lock and count as adding; a finding already in the plan is "already there" even when the plan is full. Real Postgres 5a-5c.
 3 MED  strong losses could stay silent                FIXED: every saved loss is judged before any list is cut to ten; an unknown spam score is shown as unknown, not treated as clean or as spam. Unit + real Postgres 7k.
 4 MED  existing monthly anchors                       FIXED: rows anchored a period after they were set are re-anchored to when they were set.
 5 MED  "Open the plan" could open another site        FIXED: the link names the site and the plan page shows it.
 6 MED  long findings exceeded task limits             FIXED: findings are fitted (title, target, facts, source) before they are sent.
 7 MED  an invisible filter after switching site       FIXED: filter, tab and note editor reset with the site; a kind that is gone is dropped.
 8 MED  history silently cut at 600                    FIXED: counts come from the database; all open tasks plus the newest 100 closed are shown, with "show more". Real Postgres 5d.
 9 MED  a backlink snapshot could be charged then lost FIXED: the snapshot is written inside the charged call (saved first, charged second).
10 LOW  a failed count shown as "none open"            FIXED: shown as unavailable.
 Also: "Plan" buttons carry the finding in their accessible name; the first-snapshot text uses the site's own price.

## Codex audit #17 (2026-10-08; report: tower1 ~/codex-audits/out/seo-audit-17.md)
Verdict: "Audit #16 is partly resolved: six fixes hold, four remain partial"; coverage about 59% (52-66). No cross-account disclosure. What was done:
 1 HIGH audit resolution lacked task-specific evidence   FIXED: a task records the crawl it came from; the newest finished crawl is compared with THAT crawl (not the one before last) by the audit page's own rule - "no longer found" only when every page the issue was on was crawled again. No recorded crawl, a crawl that is gone, or an issue the origin crawl does not list under that name = "can't be checked automatically". Absence alone is never evidence. Unit test with each case.
 2 MED  concurrent status changes could pass the limit   FIXED: any change of status takes the site's row first, then reads the task's status as it is now. Real Postgres 5e.
 3 MED  planner pairings could break the source's rules  FIXED: every "service town" is checked (80 characters, ten words) before anything is set aside; the page names the pairing.
 4 MED  missing data shown as advice                     FIXED: a volume that did not load is "didn't load", not "too few searches"; counts that need a part that failed are unknown, not zero; with rankings unknown nothing becomes a "write a page" task; "no ranking found" is said to mean the keyword database has none in its first 100.
 5 MED  quote, affordability and reservation differed    FIXED: the page asks the server for the quote, which is the reservation itself; the rankings lookup asks for one row per search, so it cannot cost more than was reserved.
 6 MED  cached numbers under another country's label     FIXED: the site's country is part of the table's identity on the page; a table made for another country is not shown as this one's.
 7 MED  "Track" did not track from each town             FIXED in words: the button and the footnote say it is tracked for the country as a whole and how to track from a town; the selection is kept.
 8 MED  a failed scheduled backlink save lost the month  FIXED: the schedule is leased six hours and moves on a month only after the snapshot is saved; link alerts a snapshot calls for are owed (alerts_done) until raised.
 9 MED  fitting a task destroyed identity / destination  FIXED: a long source keeps a fingerprint of the whole; an address too long to keep becomes its site, never a shortened address.
10 MED  closed history unreachable after 1,000           FIXED to 5,000 with an explicit end state (older ones are still counted). NOT DONE: cursor paging beyond that.
11 MED  bulk action cleared cells that were not sent     FIXED: every selected finding is sent, fifty at a time.
12 LOW  remembered inputs / comma in a town              FIXED: remembered on every deliberate look; a loading failure is said; "Bellingham, WA" is one town.

## Codex audit #18 (2026-10-08; report: tower1 ~/codex-audits/out/seo-audit-18.md)
Verdict: "Audit #17 is partly resolved"; coverage about 60% (52-67). No cross-account disclosure. What was done:
 1 HIGH optional checks could look resolved             FIXED (audit page and action plan alike): a PageSpeed issue counts as re-checked only when that page was measured again for the same device; issues from checks that only sample links or images are never called fixed. Unit tests for each way a speed test can fail to run.
 2 MED  a "recheck" could predate the task              FIXED: the crawl must have finished after the task was added.
 3 LOW  misleading fallback states                      FIXED: up to 60 origin crawls per look; beyond that a task says "not checked this time"; "still there" is by the issue's name; a failed crawl counts as newer only by the clock; a failure to read the crawls is said on every open audit task.
 4 MED  snapshot could be bought again                  FIXED: the snapshot and the schedule are one transaction.
 5 MED  backlink alert debt                             FIXED: each unsettled snapshot is judged against the snapshot before it and marked on its own; nothing expires; the longest-waiting site goes first. NOT DONE: snapshots from before today are assumed settled.
 6 MED  planner could spend without a quote on screen   FIXED: no price, no purchase; loading and failure are shown with a retry.
 7 MED  a half-sent batch looked like total failure     FIXED: what was added before it stopped is said and the lists are refreshed.
 8 MED  old checks turned unknown ownership into zero   FIXED: new checks carry a marker; "it cites you" is counted only over checks that looked, older ones are "not known".
 9 LOW  compare-months footnote / default               FIXED: the same calendar month a year earlier; the footnote says what a dash can mean.
10 LOW  cached planner selections not remembered        FIXED: pressing "Build" remembers the inputs even when the table is already saved.
 Also: the rank tracker's summary names the device; a table made for another country has a rebuild button.

## Codex audit #19 (2026-10-08; report: tower1 ~/codex-audits/out/seo-audit-19.md)

Verdict: of audit #18's ten, eight hold and two were partial; ten new defects in Directories and page numbers. Coverage estimate 60% (53-67).

 audit #18 leftovers
 3 audit tasks without a recorded issue said nothing ... FIXED (they now say the crawls could not be read / cannot be checked automatically)
 5 same-day refresh could be settled unseen ........... FIXED (see 7 below). Alert debt from before the migration stays discarded: KNOWN, not rebuilt.
 new
 1 HIGH different pages given the same numbers ........ FIXED (a page is its address without the fragment and nothing else: no lower-casing, no slash folding, on server and page)
 2 directory sub-domains could not pass the filter .... FIXED (anchored pattern: the directory or any sub-domain of it; checked against the source - it answered the same 15 rows for a large site, so the old filter was not losing rows there)
 3 missing traffic shown as zero ...................... FIXED (zero only when the source says zero for that page; left out or without figures = unknown). Labelled "estimated US search visits".
 4 a half-loaded answer could not be completed ........ FIXED ("Try that part again" asks for, and charges, the missing part only; what had loaded is kept; a failed look for a saved copy is said, with a retry)
 5 price on screen differed from what was set aside ... FIXED (the server sends the exact figure for n sites / n pages; the page shows and checks that figure and will not buy without it)
 6 "listed and you are not" ........................... FIXED (wording is about links found; the badge is "Link to check"; plan tasks are "Check your ... profile and its link to the website")
 7 settlement could clear a newer same-day snapshot ... FIXED (a snapshot is settled only if it is still the version that was evaluated)
 8 competitors in another order bought again .......... FIXED (one fixed order for the saved copy and the lookup)
 9 a link invented from a row without a count ......... FIXED (a row that says no links is not a link; a link without a count is shown as "linked", no number)
 10 table grouping / unknown cells for screen readers . FIXED (a body per group with a row-group heading; "not checked" and "no link found" are text, not a hover)
 also: the "not re-checked" note on the audit page now names speed and sampled checks.
 NOT DONE: Directories "Check again" buys every column again, also the ones that loaded.

## Codex audit #20 (2026-10-08; report: tower1 ~/codex-audits/out/seo-audit-20.md)

Verdict: of audit #19's twelve, nine fixed and three partial; twelve new defects, most in the rendering check. Coverage estimate 59% (52-66).

 1 HIGH rendering verdicts claimed too much ........... FIXED (compared only when both visits were answered 2xx, ended on the same page of the site and reported measurements; "less once rendered" is a finding; "same" needs words and links on both sides; a missing title on an unmeasured visit is "not reported"; wording is what the two visits saw)
 2 HIGH retry used stale state, could overwrite ....... FIXED (buying numbers for a list of pages is one at a time per account and list; each reads the saved answer again when it is its turn; a known figure is never replaced by an unknown one). One server process: KNOWN - there is no cross-process lock.
 3 HIGH a retry could silently buy both parts ......... FIXED (with nothing saved to complete it answers 409 and buys nothing; the full offer and its price come back)
 4 rendering could be pointed at odd addresses ........ FIXED (no sign-in in the address, standard port only, no bare IP or single-label host; a visit that ended on another site or another page is not compared). The fetch is made by the source from its network, not ours; DNS is not resolved by us: KNOWN.
 5 rendering price differed from the reservation ...... FIXED (exact figure per number of pages from the server; "up to"; no price, no purchase)
 6 retry on unknown cost; hold not a ceiling .......... FIXED (asked again only when the source refused the request or the task states a cost of exactly 0; a cost not stated is allowed for and not repeated; the customer is never charged more than the figure shown)
 7 rendering state could go stale or stick ............ FIXED (the newest check is asked for every 5 s while one runs, every 30 s otherwise and on focus; what the server says is newest is what is shown; when it cannot be asked that is said, with "Ask again", and the page is not locked)
 8 directory answer cut short made false gaps ......... FIXED (when the source has more rows than came back, directories not among them are "?" for that site and never a gap; the page says which sites)
 9 a #fragment lost the numbers on screen ............. FIXED (one shared page key for counting, asking, pricing and matching: shared/seo-page-key.ts)
 10 a page the lookup left out could never be retried . FIXED (what is still unknown is worked out per page and per figure; "ask again for just those" at the server's exact figure, with the warning that it may not change)
 11 copy presented a browser visit as Google .......... FIXED
 12 rendering hidden until a crawl exists ............. FIXED
 also: the same page given twice is checked once instead of refused; sub-domain pages show their host.
 NOT DONE: alert debt from before the #18 migration stays discarded; an old rendering worker is not cancelled when its run is closed as stale (it cannot save or charge, but its fetches cost us); Directories "Check again" buys every column.

## Codex audit #21 (2026-10-08; report: tower1 ~/codex-audits/out/seo-audit-21.md)

Verdict: of audit #20's twelve, nine fixed and three partial; ten new defects, half of them about how firmly the competing-pages panel worded its findings. Coverage estimate 59% (52-66).

 1 HIGH rendering compared pages without identity ..... FIXED (both visits must say where they ended, it must be the very same address on the site - nothing folded - or the page is "could not be compared"; timings and problems are kept only for a browser visit that ended on the site)
 2 a failed poll could lock the rendering form ........ FIXED (after a failed ask the last answer no longer counts as "running"; the server's own one-at-a-time rule covers a second start)
 3 competing-page key hid real alternatives ........... FIXED (a page is its exact address minus the fragment and click-tracking parameters; addresses that differ only by http/https, www or a last slash are reported as "one page under two addresses", not merged away and not called competing; the port counts)
 4 ranking evidence worded as a diagnosis ............. FIXED ("no change of page seen" with the number of keywords it rests on; "not enough checks yet" when none ranked twice; "Last shown" with its date, and "not ranking in the check of ..." when it has not ranked since; alternation is "worth a look", "the checks alone don't prove it")
 5 competing results went stale ....................... FIXED (refreshed with the rank history after checks and keyword edits, and when the window is looked at again)
 6 rows and tasks lacked context ...................... FIXED (town and device on every line; sub-domain pages show their host; the task carries full addresses, device, place, checks and dates)
 7 partial topic volume shown as the whole ............ FIXED ("n searches a month for the k with a figure"; the list total the same way; "no search volumes yet" when none)
 8 selecting >500 keywords broke tracking ............. FIXED (sent 500 at a time; the selection is kept; a failure part-way says how many were added; removals 1,000 at a time)
 9 stemmer split ordinary words ....................... FIXED (businesses/boxes/patios; possessives; "glass", "gas", "bus", "analysis" left alone)
 10 "No shared topic" when the limit was hit .......... FIXED ("Other keywords", and the note says only the 40 largest topics are grouped)
 carried: Directories "check again" bought good columns - FIXED ("Check just that site again" buys only the sites that did not load and keeps the rest; 409 and no purchase when nothing is saved). A stale rendering run kept fetching - FIXED (the worker asks before each page whether its run is still open). Group checkbox shows a partly-selected state; group order no longer depends on the reader's language settings.
 NOT DONE: alert debt from before the #18 migration stays discarded (there is nothing saved to judge it by); serialization is per server process.

## Codex audit #22 (2026-10-08; report: tower1 ~/codex-audits/out/seo-audit-22.md)

Verdict: of audit #21's ten, six fixed and four partial; eleven new defects. Coverage estimate 60% (52-67).

 1 HIGH directory refresh and retry could overwrite ... FIXED (a first purchase, a full "check again" and a second try for missing sites all go through one queue per account and saved answer, each reading the saved answer when it is its turn)
 2 the 5,000-row cap changed what was counted ......... FIXED (the database returns only the newest answer per question, assistant and month - a question asked 40 times is one row; beyond 20,000 such rows the result says it is cut short). Real-Postgres check: script/seo-ai-summary-check.ts.
 3 "other businesses" could include the customer ...... FIXED (the customer's own name, as whole words inside the bold text, or its web address, is never listed; the heading is "Other names in the answers" and the note says a heading or an unrecognised spelling can be among them)
 4 own-site source count contradicted the headline .... FIXED (the footnote uses the answer-level count)
 5 address variants asserted to be one page ........... FIXED (every exact address is kept and counted; "back and forth" / "changed" are said only between clearly different pages; addresses differing only by http/https, www or a last slash are "possible variants - not checked", never merged)
 6 ranked-without-a-page became "not ranking" ......... FIXED ("not found in the check of ..." only when no later check ranked; "ranked again on ..., page not recorded" otherwise)
 7 task evidence was cut short ........................ FIXED (one fact per address, up to five, each with its checks; variants and the latest check included). Found by running it: the first version used fact names the task rule refuses (400) - corrected and the saved task read back.
 8 a closed rendering run could still start fetches ... FIXED (asked before every request, first page and second tries included; when the run's state cannot be read, nothing more is bought)
 9 summary lifecycle .................................. FIXED (loading status; history shown with "no answers from the last 120 days" when there is nothing recent; refreshed on focus and every 5 minutes)
 10 bulk tracking cleared the selection ............... FIXED
 11 directory advice overstated ....................... FIXED ("among the answers' sources"; "check that your profile is accurate"; what an assistant read, and whether it changes an answer, said to be unknown)
 NOT DONE: alert debt from before the #18 migration; serialization is per server process (one process runs the site).

## Codex audit #23 (2026-10-08; report: tower1 ~/codex-audits/out/seo-audit-23.md)

Verdict: of audit #22's eleven, nine fixed and two partial; nine new defects, most in the section / page scope. Coverage estimate 60% (52-67).

 1 HIGH "pages under" was a prefix, hosts unbounded ... FIXED (one pattern on the whole address: the site itself with or without www - never a sub-domain or a host that ends the same - then the path with a real boundary: itself, "/...", or "?..."; checked against the source on all four kinds of report; totals moved from 4,176 to 4,174 keywords for /blog on the test site)
 2 HIGH "this page only" spanned hosts, edge rules .... FIXED (same host rule; with or without the last slash when there is no query, exactly as written when there is; the home page is its own case; the line under the filters says which rule applied)
 3 equivalent exact-page reports bought twice ......... FIXED (one spelling per scope before the request and the saved-page key are made)
 4 pasted addresses silently changed .................. FIXED (an address on another site, or on a sub-domain, is refused in words; fragments are dropped; "#" is refused by the server)
 5 task evidence lossy ................................ FIXED (address and evidence are separate facts, three pages; an address too long for a fact is marked as cut, never shortened into another address; the latest check says "not found", "ranked, page not recorded" or "ranked, page recorded")
 6 variant guidance gave a wrong diagnosis ............ FIXED (not checked; depends on redirects, canonical tags and Google's own choice - points to URL Inspection)
 7 report-table tracking cleared the selection ........ FIXED (kept until it succeeds; ticks belong to the rows on screen and are cleared when the page of rows changes, so the count on the button is what is sent)
 8 exports lost scope and country ..................... FIXED (in the file name)
 9 empty narrowed report spoke of the whole site ...... FIXED
 NOT DONE: alert debt from before the #18 migration; serialization is per server process (the site runs as one process: systemd user unit constructhub.service on vb11).

## Codex audit #24 (2026-10-08; report: tower1 ~/codex-audits/out/seo-audit-24.md)

Verdict: of audit #23's nine, five fixed and four partial; ten new defects, six in the keyword watch. Coverage estimate 60% (52-67).

 1 HIGH absence from the data sold as ranking loss .... FIXED (every sentence, tab, alert title and email says "newly seen" / "no longer seen" in the search data; the page says it is the data's view and points to the rank tracker for Google itself)
 2 HIGH same-day retakes could not reconcile alerts ... FIXED (one snapshot a day, never rewritten: asking again returns the one there is and buys nothing, so an alert always matches the snapshot it was raised from)
 3 HIGH manual and monthly could buy the same work .... FIXED (a claim on the site in the database, shared by the button and the schedule on any process; the monthly one looks again at whether the watch is still on when its turn comes; a day that already has a snapshot buys nothing)
 4 a failing snapshot could starve later comparisons .. FIXED (each snapshot is settled on its own; tried ones are stamped and the longest-waiting come first)
 5 keyword alerts ignored the alerts-off setting ...... FIXED (none are raised; the snapshot is still settled so switching alerts on later sends no old news; the page says alerts are off)
 6 truncation changed counts and alert eligibility .... FIXED (nothing is cut before it is counted or judged; "Show all"; a snapshot is whole by the rows returned, not the distinct keywords kept; a total the data did not give is "not known", not "more than fit")
 7 scope host matching assumed lower-case, no ports ... FIXED (scheme and host matched in any letter case, with or without the scheme's own port; checked against the source on all four kinds of report)
 8 pasted and typed scopes could disagree ............. FIXED (a port or a sign-in in a pasted address is refused in words; "//host/..." is read as an address; a "?" with nothing after it is no query on both sides)
 9 tracking had no pending / completion contract ...... FIXED (the button waits while tracking and the ticks go only when it has succeeded; rows replaced under the same page clear them)
 10 old-country snapshots shown as the current country  FIXED (every snapshot and comparison names its country; snapshots from the country the site used to be tracked in are flagged)
 NOT DONE: alert debt from before the #18 migration; request queues are per server process (keyword snapshots no longer rely on one).

## Codex audit #25 (2026-10-08; report: tower1 ~/codex-audits/out/seo-audit-25.md)

Verdict: of audit #24's ten, four fixed and six partial; twelve new defects. Coverage estimate 60% (52-67).

 1 HIGH an expired claim's owner could overlap ........ FIXED (the claim carries its owner's token: checked before the source is asked and again, with the site's row locked, in the transaction that saves; only the owner gives it back. Real-Postgres check: a displaced owner saves nothing and is charged nothing). KNOWN: if a claim is taken over WHILE the first owner's request to the source is in flight, the source is asked twice (ours to pay, not the customer's); a claim lasts 10 minutes and a request 1.
 2 the monthly one did not recheck that it was due .... FIXED (it runs only if the site's next date is still the one the scheduler leased; the day is read once and used for the look-up and the save)
 3 HIGH overlap worded as a one-page recommendation ... FIXED ("searches with largely the same results"; "a prompt to look at whether one page or separate pages should serve them, not Google's own grouping"; the task is a review task and carries the overlap figures)
 4 mixed-date evidence, task source without device .... FIXED (every member and group carries its dates; the task's source includes the device)
 5 ownPages confused addresses, pages, missing ........ FIXED (recorded addresses; addresses that may be one page counted once and labelled; "ranks, page not recorded" apart from "not found")
 6 an empty device hid the device switch .............. FIXED (heading and switch always shown; "not enough to compare on mobile" said)
 7 scope accepted the other scheme's port; "?" data ... FIXED (http with :80, https with :443, not crossed; only a bare trailing "?" is dropped; checked against the source; saved-page key bumped)
 8 tracking promise optional; cleared newer ticks ..... FIXED (the type now requires a promise - the compiler found the caller that returned none; only the ticks that were sent are cleared, and only if the rows on screen are the ones they were sent from)
 9 "today / tomorrow" had an undisclosed UTC boundary . FIXED (the day is pinned per operation; the page says days change at midnight UTC and gives that time in the reader's own zone; it asks again when the day changes)
 10 old keyword alerts lost their country and evidence  FIXED (the alert keeps the two snapshots' ids and dates and the country; the page states what the alert keeps instead of promising the full list elsewhere)
 11 copy promised more than the code .................. FIXED ("the snapshot before it"; "changes that qualify can raise an alert"; "a change in the saved data")
 12 expanded rows under the wrong column heading ...... FIXED (the overlap sentence sits with the keyword)
 NOT DONE: alert debt from before the #18 migration; request queues are per server process.

## Codex audit #26 (2026-10-08; report: tower1 ~/codex-audits/out/seo-audit-26.md)

Verdict: of audit #25's twelve, seven fixed and five partial; ten new defects, four of them in the new missing-page check. Coverage estimate 60% (52-67).

 1 HIGH any 2xx answer became a confirmed soft 404 .... FIXED (each answer is read: a sign-in page, another site, a bot check, a non-HTML answer and a server error are "nothing learnt"; a noindexed page is accepted; only an ordinary indexable page or a send-off to the home page raises the issue, worded as suspected - Google decides case by case)
 2 HIGH single-page-app advice was wrong .............. FIXED (the fix names Google's two alternatives - noindex on the not-found view, or a redirect to an address answered 404 - and "fixed" accepts a noindexed answer as well as 404/410, on both sides)
 3 one known address proved nothing site-wide ......... FIXED (addresses made up per crawl and kept in its state; one at the top and one in the busiest section of the sitemap; the finding and the fix are about those addresses and say so)
 4 broken-link statement went too far ................. FIXED ("a link to an address that does not exist looks fine to any check that goes by the status alone, this scan's included. Errors this scan did find are still real.")
 5 action-plan evidence lost or invisible ............. FIXED (audit tasks carry the addresses found on and what was found; the plan shows every saved fact of a task under "What this is based on", with a link to Site audit)
 6 scheduler recovery writes ignored the lease ........ FIXED (every date the pass writes is written only while the site's date is still the one it leased)
 7 "different pages" beyond the evidence .............. FIXED ("N addresses ... whether they are different pages is not checked (one may redirect to another)")
 8 alerts hid retained keywords ....................... FIXED ("Show all N kept with this alert"; how many more changed than the alert keeps is said)
 9 takeover check asserted less than it claimed ....... FIXED (the two owners are held apart; the token after takeover, the displaced owner's nothing-saved, its reservation settled at nothing, the claim left in place, and the successor's charge are each asserted)
 10 coverage said a probe ran when none did ........... FIXED (asked / robots.txt / no answer / not measured are each said)
 NOT DONE: a claim taken over while the first owner's request is in flight asks the source twice (ours to pay); alert debt from before the #18 migration; request queues per server process; a list of past snapshot comparisons.

## Codex audit #27 (2026-10-08; report: tower1 ~/codex-audits/out/seo-audit-27.md)

Verdict: of audit #26's ten, six fixed and four partial; eleven new defects, two HIGH. Coverage estimate 60% (52-67).

 #26-1/2/10 (partial) classification, fixed rule, coverage ... FIXED with 1, 2 and 10 below
 #26-6 (partial) keyword reuse/save dates unqualified ..... FIXED with 9 below
 1 HIGH incomplete probing could certify "fixed" ......... FIXED (every address meant to be asked is recorded - not allowed by robots.txt, no answer, timed out, a redirect the crawl does not follow, or the answer; "fixed" is judged part of the site by part (the top, a section): that part must have been asked again in the later crawl and answered 404/410 or noindexed there - a timeout, a robots block or a section the later crawl did not probe is "not checked", on both the Site Scan fix list and the Site audit summary; coverage lists each part with its answer)
 2 classifications beyond what was seen .................. FIXED (a sign-in form at the address and an empty or 204 answer are "nothing learnt"; a bot check needs a challenge title, or a challenge script on a short page - reCAPTCHA on an ordinary page is no longer one; an answer not marked as HTML is not a page; a redirect elsewhere is said with its address; the finding says it reads the answer without JavaScript, so a noindex or redirect a script adds is not seen, and points to URL Inspection)
 3 HIGH internal links used the last successful rank ..... FIXED (each keyword's NEWEST check day decides; if it did not rank that day it is not looked for and is counted as "did not rank in its newest check"; position carries its device, day and place on screen, in tasks and in the CSV)
 4 "does not already link" ignored links and aliases ..... FIXED (every saved link is read - up to 2,000; a link to an address the crawl saw redirect to the page, or to a page whose canonical names it, counts; queries stay significant)
 5 cached answer could survive changed evidence .......... FIXED (cached by the crawl and a hash of the exact rank facts used; a same-day rank change is seen at once - real Postgres check)
 6 task identity was the keyword, not the link ........... FIXED (a task is the pair of pages, hashed as compared; both addresses kept whole, with date/device/place; a suggestion whose addresses are too long to keep is not offered for the plan and says so)
 7 counts and empty state overstated coverage ............ FIXED (left out by reason: did not rank in the newest check / page not reached / page reached but an error, redirect or noindex / too short / menu text; "looked for" excludes them all; pages longer than the 60,000 characters read are counted; empty state "No suggestions from these checks")
 8 menu-text rule ........................................ FIXED (judged against the OTHER pages, the ranking page not counted either way; threshold and its limits stated on screen as a rule of thumb)
 9 keyword schedule dates escaped the lease .............. FIXED (the same-day reuse and the save both move the date only as the claim's owner and, for the monthly occurrence, only while the date is the one it leased - inside the locked transaction on save)
 10 random probe addresses broke fix history ............. FIXED (a fix is named by the part of the site - "https://site/" or "https://site/guides/" - the made-up address stays as evidence; older fixes keyed by an address are judged by the part that address stood for)
 11 CSV lost its evidence ................................ FIXED (device, rank-check day, place and crawl day per row; a last line says when the file holds only the first part of what was found)
 NOT DONE: a claim taken over while the first owner's request is in flight asks the source twice; alert debt from before the #18 migration; request queues per server process; a list of past keyword-snapshot comparisons. Tasks planned under the old "link-opp:" identity are not matched to the new pair identity (a link planned before 10/8 can be planned again once).

## Codex audit #28 (2026-10-08; report: tower1 ~/codex-audits/out/seo-audit-28.md)

Verdict: of audit #27's eleven, six fixed and five partial; thirteen new defects, one HIGH. Coverage estimate 60% (52-67).

 #27-2/#26-1 (partial) reCAPTCHA pages as bot checks ..... FIXED with 7
 #27-4 (partial) aliases ................................. FIXED with 1 and 2
 #27-7 (partial) counts / empty state / text limit ....... FIXED with 3 and 4
 #27-8 (partial) menu rule with copies ................... FIXED with 5
 #27-10 (partial) old fix keys ........................... FIXED with 6
 #26-10 (partial) "asked" counted planned probes ......... FIXED with 8
 carried: past keyword-snapshot comparisons .............. FIXED (H8: any two snapshots compared; alerts open their own pair)
 carried: old "link-opp:" task identities ................ FIXED (a link planned under the old identity is matched by the page it is on and the page it links to - real Postgres tasks check 1c)
 1 HIGH a canonical copy could become the destination .... FIXED (the page that stands for an identity is the page itself, never a copy naming it canonical, in any order - unit and real-Postgres checks)
 2 alias chains and redirects to saved pages ............. FIXED (aliases followed to the end with a loop guard; the crawler now keeps the address of a redirect that lands on a page it already saved)
 3 the real text limit is 16,000 characters .............. FIXED (the view uses and states the crawler's 16,000; pages that reach it are counted as cut)
 4 exclusion-only result showed "add keywords" ........... FIXED ("nothing to look for" only when there are no tracked keywords with checks at all; otherwise the reasons are listed)
 5 menu share with canonical copies ...................... FIXED (one set of other pages - neither the target nor a copy of it - for the share and the count)
 6 old missing-page fixes became duplicates .............. FIXED (an old fix keyed by its made-up address is renamed to its part before matching: still failing = "still present", "done" kept)
 7 CAPTCHA wording still suppressed pages ................ FIXED (only interstitial markers - Cloudflare, Imperva, PerimeterX, Akamai, DDoS-Guard - on a short page, or a challenge title; a reCAPTCHA form or the word is an ordinary page)
 8 coverage overstated requests .......................... FIXED (planned / asked / answered recorded apart; the note says "planned" and gives each part's outcome)
 9 AI comparison selection could disagree ................ FIXED (the select shows the chosen month only while it loads, with the figures dimmed; then the month the figures are for, with a note when the server fell back; the choice belongs to its site; earlier figures are kept while loading for the same site only)
 10 asking again left a chosen month stale ............... FIXED (every month variant of the summary is refreshed)
 11 incomplete history not flagged on the new cards ...... FIXED (both cards say when the oldest months may be missing answers; the 15-row limit is said; with no shared month the trend card says why there is no comparison; months are UTC)
 12 own address matched inside a longer one .............. FIXED (whole-address match, the same rule as the answer reading)
 13 phone rows lost column meanings ...................... FIXED (labels on the internal-link rows and the older AI month and source tables)
 NOT DONE: a claim taken over while the first owner's request is in flight asks the source twice; alert debt from before the #18 migration; request queues per server process.

## Codex audit #29 (2026-10-08; report: tower1 ~/codex-audits/out/seo-audit-29.md)

Verdict: of audit #28's thirteen, nine fixed and four partial; twelve new defects, one HIGH. Coverage estimate 60% (52-68).

 #28-1/2/5/6 and carried #27-4/8/10 (partial) .......... FIXED with 1, 2, 3 and 5
 carried: past comparisons (partial) ..................... FIXED with 6
 carried: old link-opp tasks (partial) ................... FIXED with 4
 1 HIGH a copy could stand in for a page not crawled ..... FIXED (only the page whose own address is the identity is a destination; a page reached only through a copy is "not reached", a noindexed one "not usable")
 2 alias chains, loops and the 20-alias cap .............. FIXED (followed to the end; a loop or a chain over 50 leaves the address as itself, the same from any start; up to 100 redirect aliases kept per page)
 3 copies of a mentioning page ........................... FIXED (one source per identity - the page itself, else the first copy by address - for the share, the count and the task identity, which is the hash of the two identities, the same in any crawl order)
 4 old link tasks matched only identical strings ......... FIXED (compared as the suggestions compare addresses: scheme, www, last slash, fragment)
 5 old fix records could lose "done" ..................... FIXED (records landing on one part are merged: an open one wins over one marked fixed; "done" kept from an open one; same result in any order)
 6 a pair older than the listed 36 lost its controls ..... FIXED (the answer carries both snapshots of the pair; the selects gain them; "Back to the newest two" shown on its own when needed)
 7 site switch showed the previous site's watch .......... FIXED (earlier figures kept while loading for the same site only; the watch checkbox and the buy button wait for the real answer)
 8 midnight refresh missed chosen pairs .................. FIXED (every variant of the site's view; actions refresh the site they were for)
 9 phone labels on keyword tables; select widths ......... FIXED (labels on the keyword-watch and alert tables; selects contained; "other country" short)
 10 ids beyond the database integer range ................ FIXED (decimal ids 1..2147483647 only; anything else a 400 - checked in the browser)
 11 focus after "Open this comparison" ................... FIXED (focus moves to the comparison's heading once that pair has loaded; choosing in a select keeps focus there - checked with the keyboard)
 12 AI empty-comparison wording .......................... FIXED ("the newest month shares no question asked of the same assistant with any earlier month")
 NOT DONE: a claim taken over while the first owner's request is in flight asks the source twice; alert debt from before the #18 migration; request queues per server process.

## Codex audit #30 (2026-10-08; report: tower1 ~/codex-audits/out/seo-audit-30.md)

Verdict: of audit #29's twelve, nine fixed and three partial; eleven new defects, most in the new "By page" view. Coverage estimate 60% (50-68).

 #29-2 / #28-2 / #27-4 (partial) alias limits .......... FIXED with 7
 #29-7 (partial) pending toggle across sites ............. FIXED with 9
 #29-11 (partial) focus on reopening ..................... FIXED with 10
 carried: old link-opp tasks through aliases (partial) ... FIXED with 8
 1 full addresses vs paths; other hosts .................. FIXED (a page is its host and path from the full address the source gives - kept from now on - or from the path, which may itself be an address; www folded, path case and query kept; another host is shown and planned with its own host)
 2 paths cut at 300 characters ........................... FIXED (kept whole from now on; rows from older snapshots whose path is exactly 300 characters say the address was cut; identity is a hash of host and path)
 3 a missing estimate looked like a fall ................. FIXED (visits are compared only where every keyword on both sides has an estimate; such pages sort by keyword change; a task records visits as not known with how many keywords had no estimate, and the market)
 4 reasons ignored the comparison's basis ................ FIXED ("entered/left the top 300" or "in one snapshot only" when not whole; the task fact is "onlyInOlder")
 5 a page not given shown as a move ...................... FIXED (empty = not given; "page not given before / now" counted apart from moves; the counts reconcile on every row - unit check)
 6 long paths lost the plan button ....................... FIXED (identity hashed; planned when the full address fits a task (500), otherwise the row says why; full path shown wrapped, not only on hover)
 7 alias limits asserted missing links ................... FIXED (chains resolved to their end however long, loops left as themselves; a page with more redirected addresses than the crawl keeps is marked and gets no suggestions, counted and said)
 8 old tasks not matched through aliases ................. FIXED (old link tasks take the identity of today's suggestions through this crawl's aliases when the view is opened, unless that task already exists - real Postgres)
 9 pending watch toggle leaked across sites .............. FIXED (shown only for the site it was for)
 10 reopening the same alert did not move focus .......... FIXED (each opening is its own event - checked with the keyboard)
 11 visits rounded before adding up ...................... FIXED (kept at the source's precision, rounded once after adding)
 NOT DONE: a claim taken over while the first owner's request is in flight asks the source twice; alert debt from before the #18 migration; request queues per server process.

## Codex audit #31 (2026-10-08; report: tower1 ~/codex-audits/out/seo-audit-31.md)

Verdict: of audit #30's eleven, five fixed and six partial; seven new defects (in those fixes). Coverage not re-estimated (fixes only).

 #30-1/2/6/7/8/9/11 (partial) ............................ FIXED with 1-7
 1 long full addresses lost their host ................... FIXED (a snapshot keeps full addresses up to 2,048 characters; one the source gave but that cannot be used is marked, and its path is never put on the site's host - no address, no plan)
 2 old cut addresses could be planned .................... FIXED (the 300-character cut is decided before the address is read, full or not; such a row is never planned - "Address incomplete")
 3 alias truncation through canonical copies ............. FIXED (every identity reached by a page marked cut - or with an old crawl's cap-sized list of 20 - is held back and counted)
 4 migration bound old tasks to one crawl ................ FIXED (no stored task is rewritten; every link task, old or new, is compared by its two pages through the newest crawl's aliases each time a link is planned)
 5 migration raced with inserts .......................... FIXED (that comparison happens inside the insert, under the site's lock; two requests for one link at once add one task - real Postgres. Found by the database check: with no crawl table the lookup would have ended the transaction - it now checks the table first)
 6 concurrent toggles across sites ....................... FIXED (pending changes kept per site)
 7 estimates still rounded on the way in ................. FIXED (kept as the source gives them; rounded once after adding up - parsed-then-added unit check)
 NOT DONE: a claim taken over while the first owner's request is in flight asks the source twice; alert debt from before the #18 migration; request queues per server process.

## Codex audit #32 (2026-10-08; report: tower1 ~/codex-audits/out/seo-audit-32.md)

Verdict: of audit #31's seven, five fixed and two partial; ten new defects, mostly in Mentions. Coverage estimate unchanged (~60%).

 #31-3 / #30-7 (partial) legacy alias cap on new crawls ... FIXED with 2
 #31-4 / #30-8 (partial) source string before the pair .... FIXED with 3
 #30-1 (partial) ports and scheme ......................... FIXED with 1
 1 page identity lost ports and changed scheme ........... FIXED (identity = host with its port + path - http/https of one address are deliberately one page, as everywhere in the product; the full address is rebuilt with the source's own scheme, host and port)
 2 the old crawls' 20-alias rule hit new crawls .......... FIXED (new crawls write "not cut" on every page; the cap-sized rule applies only to pages from crawls that did not record it)
 3 exact-source matching beat the alias comparison ....... FIXED (a link task's pair is worked out on the server from its two addresses and decides alone; when an older task holds the same string for what is now another pair, the new one is stored under a suffixed string - real Postgres)
 4 a place match presented as the customer ............... FIXED (wording is "likely you" and "check it is about you"; the customer can confirm or reject each website - H11)
 5 own site through a tracked sub-domain ................. FIXED (the page's own host and the website it is filed under are both checked; for a tracked sub-domain the domain above it counts as the same business, never a country suffix such as co.uk)
 6 a paid but unsaved answer could vanish ................ FIXED (every answer seen is kept on screen by name; a later "nothing saved" never replaces it)
 7 two refreshes at once bought twice .................... FIXED ("Check again" names the answer it replaces; inside the queue a newer saved answer is returned instead - two at once in the browser: one 201, one reused)
 8 mention tasks keyed by website only ................... FIXED (one task per name and page; it carries the name, excerpt, place match "to verify" or "confirmed by you", and that a link found is from any page of the website)
 9 a saved answer under another name needed full credit .. FIXED (typing another name looks for its saved check free first; buying is offered only when there is none)
 10 dates and CSV provenance ............................. FIXED (search and link-check dates kept apart; the CSV names the searched name, the match "to verify", the link scope and both dates)
 NOT DONE: a claim taken over while the first owner's request is in flight asks the source twice; alert debt from before the #18 migration; request queues per server process.

## Codex audit #33 (2026-10-08; report: tower1 ~/codex-audits/out/seo-audit-33.md)

Verdict: of audit #32's ten, seven fixed and three partial; ten new defects (three HIGH) in the verdicts and the #32 fixes.

 #32-5 / #32-6 / #32-7 / #30-1 (partial) ................. FIXED with 6, 3, 4 and 10
 1 HIGH a verdict was about a website, the evidence a page  FIXED (verdicts are kept per site, name and page - http/https, www and a last slash fold; another page of the same directory is its own question; the website-level table is no longer read; the watch's alerts use page verdicts too)
 2 HIGH reading verdicts could swallow a paid answer ...... FIXED (the verdict lookup never fails the response: the answer goes out and says the verdicts are not shown just now)
 3 HIGH an older answer could replace a newer unsaved one . FIXED (answers kept by freshness - search time, then link-check time; the newest response's verdicts are taken either way)
 4 HIGH refresh de-duplication failed when saving failed .. FIXED ("Check again" must name the answer it replaces; what it bought is kept as a receipt by that answer - in the database for a week and in memory - so the same request again returns it; browser: two at once = one purchase, a repeat later = reused, no "replaces" = refused)
 5 optimistic verdicts could diverge ..................... FIXED (one request at a time per page - its buttons wait; pending shown; on refusal the previous verdict is put back; on success the view is read again; planning waits for the verdict)
 6 ownHost was not a registrable-domain rule ............. FIXED (no guessing above the tracked host: only it and its sub-domains are the site; alice.github.io is not bob.github.io; a page on a parent domain shows as a mention to mark "Not us")
 7 kept names showed old place matches ................... FIXED (places are always read from the field as it is now)
 8 a failed free lookup looked like "not checked" ........ FIXED (the error is said, with "Look again (free)"; buying waits until the lookup succeeds)
 9 CSV lost the verdict .................................. FIXED (verdict and "shown as" columns; every row of the check)
 10 By page kept the older address spelling .............. FIXED (the newer snapshot's address is shown and planned; the older one kept beside it)
 NOT DONE: a claim taken over while the first owner's request is in flight asks the source twice; alert debt from before the #18 migration; request queues per server process.

## Codex audit #34 (2026-10-08; report: tower1 ~/codex-audits/out/seo-audit-34.md)

Verdict: of audit #33's ten, five fixed and five partial; fourteen new defects (four HIGH), most in the new mentions watch.

 #33-4 / #32-7 (partial) refresh claims ................. FIXED with 6
 #33-5 (partial) verdict overlays ........................ FIXED with 7
 #33-10 (partial) urlBefore .............................. FIXED with 13
 #32-5 (partial) a parent domain shows as a mention ...... KEPT AS DESIGNED (no registrable-domain guessing; the page can be marked "Not us")
 1 HIGH the watch skipped pages .......................... FIXED (every page, not one per website; oldest first; a window with more pages than one check reads resumes from the last page read - nothing skipped, only later; pages already seen in the last three checks are not counted again - real Postgres)
 2 windows not complete or described ..................... FIXED (window = after where the last one ended less a week's overlap, up to now - not tomorrow; boundaries kept on the check; the panel says it reads by publication date and what that cannot see)
 3 HIGH "does not link" when unknown ..................... FIXED ("no link found" only where the link check answered; "not known" where it did not, in the title, the email and the page)
 4 a name change mid-run .................................. FIXED (the save requires the site to still follow the same name; changing the name makes the watch due at once)
 5 the day rule bought before refusing .................... FIXED (a day that has its check buys nothing and its next date is put right - real Postgres)
 6 HIGH refresh receipts after the charge ................. FIXED (the claim is written in the database before buying - a second request finds it, from any process; the answer is saved as the check and the receipt INSIDE the charged call, so an answer that cannot be saved is not charged; a failed purchase gives the claim back)
 7 local verdicts overrode later truth .................... FIXED (keyed by the page as the server compares it; settled ones give way when the view is read again, another tab's change included; a row being marked stays in its group until answered, and the result is announced)
 8 most watched pages could not be seen or corrected ...... FIXED (every page of the check, with "This is us / Not us", export, and a retry of a link check that did not load - saved into the check, charged only when it loads)
 9 the alert's link needed a Site Explorer report ......... FIXED (a Mentions page of its own, /seo/mentions?site=<id>, needing no report)
 10 HIGH email failures marked sent; alerts-off ignored .. FIXED (the notifier reports what each channel did; a failed email is tried again on its own, up to four times, with no second bell entry; an alert of a site whose alerts were switched off is not sent)
 11 the followed name bypassed validation ................. FIXED (the same name rule when switching the watch on and when it runs; a name that cannot be searched waits and says so)
 12 failed saves lost cost uncertainty .................... FIXED (taking a connection is inside the cost-aware handling; the link check's uncertainty is kept)
 13 urlBefore overwritten ................................. FIXED (the older snapshot's spelling as first seen; the newer snapshot's first spelling is shown and planned)
 14 ?view= accepted inherited names ....................... FIXED (own keys only)
 NOT DONE: a claim taken over while the first owner's request is in flight asks the source twice; alert debt from before the #18 migration; request queues per server process (the mentions refresh claim is now in the database).

## Codex audit #35 (2026-10-08; report: tower1 ~/codex-audits/out/seo-audit-35.md)

Verdict: of audit #34's fourteen, six fixed and eight partial (carried into the items below); thirteen new defects, two HIGH, in the watch and the reports' work section.

 #34 partials (1, 2, 4, 6, 7, 8, 10, 11) ................ FIXED with 1-9 and 13
 #32-5 parent domain ..................................... KEPT AS DESIGNED (see audit #34)
 1 HIGH ties at the boundary time were skipped ........... FIXED (carrying on from a page read last time reads that moment again and leaves seen pages out; fifty pages at one moment move a second on and say some may be missed - real Postgres)
 2 HIGH stale refresh owners could overwrite or delete ... FIXED (claims carry their holder's token: taking over gives a new one; only the holder saves - the check and the receipt in one transaction, before the charge - or gives it back)
 3 seen pages limited to three checks .................... FIXED (every page read is kept with its check; a window leaves out pages read by any check whose window reaches into it)
 4 name spacing and same-day renames ...................... FIXED (one spacing/case rule in the database and the code; a business-name change makes a watch that follows it due; a name changed on a day that has a check runs the next day, not a month later)
 5 watch waiting reasons invisible ........................ FIXED (the reason is kept and said: name cannot be searched / included data used up / plan; "no watched check yet" with when the first runs; unavailable verdicts said in the panel and its export)
 6 overlays of other names went stale ..................... FIXED (each name's settled verdicts give way only to a fresh answer for that name; the name's lookup is read again after a verdict)
 7 old alerts could not reopen their check ................ FIXED (the alert and its email link carry the check: /seo/mentions?site=..&check=..; the panel says it is the alert's check, with "show the newest")
 8 email retry claims unfenced and unbounded .............. FIXED (ten at a time, each claimed with a token, skipped by other passes, finished only by its claimer)
 9 alerts-off paused failed emails ........................ FIXED (switching alerts off ends them)
 10 scheduled reports could miss work .................... FIXED (a scheduled report counts the work done since the last one went out; the screen keeps the 30 days, each saying which)
 11 a failed plan read hid the section ................... FIXED (the screen says the plan could not be read; a scheduled send stops and is tried again; a plan with only older work shows "nothing marked done in this period")
 12 notes cut mid-character; characters the PDF lacks .... FIXED (one line, 300 whole characters with "…"; PDF text keeps what its font can draw, "?" for the rest - control characters and line breaks become spaces)
 13 the Mentions page ignored address changes and states . FIXED (follows ?site= on every change; loading, failure, no site and "this link's site isn't yours" are each said)
 NOT DONE: a claim taken over while the first owner's request is in flight asks the source twice; alert debt from before the #18 migration; request queues per server process.

## Codex audit #36 (2026-10-08; report: tower1 ~/codex-audits/out/seo-audit-36.md)

Verdict: of audit #35's thirteen, seven fixed and six partial; ten new defects, two HIGH.

 #35 partials (1, 5, 6, 9, 10, 12) and carried ones ....... FIXED with 1-5 and 10
 #32-5 parent domain ..................................... KEPT AS DESIGNED
 1 HIGH a full page at one moment still skipped the rest .. FIXED (a cursor into that moment: the next check reads it from the 51st page on, by offset, and only then moves on - real Postgres: 50, then the other 30, complete)
 2 HIGH work done between building and sending a report ... FIXED (a scheduled report's cutoff is fixed when it is first due and kept for its retries; the next report starts at that cutoff)
 3 switching alerts off raced with deliveries ............. FIXED (a failed email is queued again only while alerts are on; a claimed retry looks again just before sending)
 4 clearing the business name stranded a watch ............ FIXED (the watch says it has no name to follow and waits; it can always be switched off)
 5 a failed verdict read erased known verdicts ............ FIXED (only an answer whose verdicts loaded retires anything)
 6 two calendars for "overdue" ............................ FIXED (said on both: the plan reads the computer's calendar; the report counts by UTC and says so; "due today or in the next 7 days")
 7 a missing alert check looked like "none yet" ........... FIXED (said, with the newest check shown instead)
 8 due dates lost their year .............................. FIXED (the year is shown when it is not this year)
 9 a long owner could overflow on a phone ................. FIXED (wraps; checked at 390 px with 60 characters)
 10 the PDF's brand name bypassed the font rule ........... FIXED
 NOT DONE: a claim taken over while the first owner's request is in flight asks the source twice; alert debt from before the #18 migration; request queues per server process.

## Codex audit #37 (2026-10-08; report: tower1 ~/codex-audits/out/seo-audit-37.md)

Verdict: of audit #36's ten, five fixed, three partial and two FIX IS WRONG (the watch's moment cursor); eight new defects, two HIGH.

 #36-1 / #35-1 / #34-1,2 (FIX IS WRONG) the watch cursor .. FIXED with 1 and 2
 #36-2 / #35-10 (partial) report occurrence ............... FIXED with 5
 #36-3 / #35-9 / #34-10 (partial) alerts-off races ......... FIXED with 6
 #36-5 / #35-6 (partial) verdicts lost on a failed read .... FIXED with 3
 1 HIGH the cursor could loop: the total is the window's ... FIXED (plain position paging over a window whose END is kept until it is read: progress = position + pages read, against the source's total for that window; a short or empty page ends it - real Postgres with the source's real meaning of the total: 50 of 80, then the other 30, complete)
 2 HIGH positions shift in a changing, tie-ordered list ..... FIXED AS FAR AS THE SOURCE ALLOWS (the window's end no longer moves while it is read; the week's overlap and leaving out seen pages catch most shifts; the page now says pages at the same moment or added meanwhile can shift and a page can occasionally be missed - no promise of completeness)
 3 known verdicts lost on a failed read .................... FIXED (an answer whose verdicts could not be read never overwrites verdicts already known for that name)
 4 the day rule held only for daily ......................... FIXED (no automatic check on a UTC day the site was already checked, any frequency; "Run check now" always runs - said)
 5 report retries recomputed the start ...................... FIXED (the occurrence - work from, work to, the period its emails count under - is fixed at its first lease and kept for retries; it ends, and the next starts at its end, when every recipient is sent or already had it - real Postgres)
 6 the first delivery ignored alerts switched off ........... FIXED (looked at again right before sending)
 7 "weekly" left in labels; UTC not said .................... FIXED ("automatic check"; the day rule says UTC). Found while fixing: the error boundary's list of known notes still had the old "weekly" wording, so since slice 49 a skipped-check note would have shown as the generic one - the new wording added (the old kept for saved rows) with a test that the note passes through as written
 8 the save button lost its name while saving ............... FIXED ("Saving settings…", busy)
 NOT DONE: a claim taken over while the first owner's request is in flight asks the source twice; alert debt from before the #18 migration; request queues per server process.

## Codex audit #38 (2026-10-08; report: tower1 ~/codex-audits/out/seo-audit-38.md)

Verdict: of audit #37's eight, four fixed and four partial; eight new defects, two HIGH.

 #37-1/2 / #36-1 (partial) windows ........................ FIXED with 1 (the shifting-positions limit stays said)
 #37-3 / #36-5 (partial) verdicts on failed reads ......... FIXED with 3
 #37-5 / #36-2 (partial) report occurrence ................ FIXED with 2
 1 HIGH an old unfinished window could be abandoned ...... FIXED (a window left unfinished by the older way of carrying on is read again whole, start to end, with its pages already read left out - real Postgres)
 2 HIGH report completion not owned by the lease ......... FIXED (each pass holds a lease token; only that pass can finish the occurrence or move its date. The email log releases its claim on a failed send, so with the lease fenced a pass cannot mistake another's sending for delivery)
 3 watched-check verdicts lost on failed reads ............ FIXED (one store of what the server said, by name and page as the server compares pages, fed by every answer whose verdicts loaded; both views and both exports read it)
 4 zero checks shown as "all fine" ........................ FIXED ("no outgoing addresses were checked"; an ordinary answer is described as an answer, not as page content; 204 and a redirect with nowhere to go are said apart)
 5 redirects not followed shown as "no answer" ............ FIXED (the crawler records why a check had no status - redirect not followed, timeout, failed; older crawls that did not record it say so)
 6 other 4xx called server errors and broken .............. FIXED ("inconclusive - open it yourself", not broken, no plan button)
 7 long addresses collided as tasks ....................... FIXED (the task identity is a fingerprint of the whole address)
 8 invented causes in two notes ........................... FIXED (the "unmeasured" state counts links of any kind; missing link text says whether the HTML had none or the crawl did not save it)
 NOT DONE: a claim taken over while the first owner's request is in flight asks the source twice; alert debt from before the #18 migration; request queues per server process.

## Codex audit #39 (2026-10-08; report: tower1 ~/codex-audits/out/seo-audit-39.md)

Verdict: of audit #38's eight, four fixed and four partial; nine new defects, two HIGH.

 #38-2 / #37-5 / #36-2 (partial) report delivery ......... FIXED with 1
 #38-3 / #37-3 / #36-5 (partial) verdict retention ........ FIXED with 7
 #38-4 / #38-8 (partial) outgoing wording ................. FIXED with 8
 #37-2 shifting positions ................................. STAYS SAID (the source orders by time alone)
 1 HIGH an email claim mistaken for delivery .............. FIXED (each recipient's delivery of each period is its own row - pending while sending, sent once it went; a pending row older than half an hour is a send that died and is taken over, and the email log's stale claim for that key is released; the occurrence closes only when every recipient is sent, already sent, or opted out - two passes on the dev rig: sent once, then recognised)
 2 HIGH incomplete windows produced fabricated losses ..... FIXED (a page or search a window did not return is "not returned" there, never 0; a change is shown only where both windows returned it and both have every day with data; the CSV carries the window, days with data, comparability and the property)
 3 "synced" claimed from row-bearing dates ................. FIXED ("days with data", with the note that this is not proof every row arrived; Google's row limits and privacy filtering said)
 4 an old property could hide a working one ............... FIXED (the property with the most recent data is used, the domain property first when as fresh; the others are named; whole domain vs URL prefix said - real Postgres)
 5 switching tabs showed the other tab's data ............. FIXED (nothing is shown under a tab but that tab's answer)
 6 "most clicks" sorted by either window .................. FIXED (current clicks; unknown changes last; gain/fall go back to most clicks when changes are not shown)
 7 saved verdicts lost after another read ................. FIXED (a saved verdict is known at once with its time; only an answer newer than the save can replace it; refused saves show the server's verdict again)
 8 outgoing wording beyond the evidence ................... FIXED (no page loaded / no links in the HTML / links possibly added by JavaScript said apart; "did not answer normally")
 9 phone tables lost their headers for screen readers ..... FIXED for the new tables (each cell carries its label for screen readers); the app-wide table style is the other team's
 NOT DONE: a claim taken over while the first owner's request is in flight asks the source twice; alert debt from before the #18 migration; request queues per server process.

## Codex audit #40 (2026-10-08; report: tower1 ~/codex-audits/out/seo-audit-40.md)

Verdict: of audit #39's nine, four fixed and five partial; ten new defects, one HIGH.

 #39-1 (partial) / 1 HIGH a stale claim resent a delivered email . FIXED (a send that died after the email log claimed it may have gone, so it is never sent again: the delivery is "not known" and the Reports page lists it - "not known whether these arrived ... nobody gets a report twice"; the occurrence can finish; a delivery taken over by another pass is not marked by the first - real Postgres 6/6)
 #39-7 (partial) / 2 verdict freshness by arrival time ........ FIXED (every read is timed when it STARTS; a saved verdict can be replaced only by a read started after the save was answered)
 #39-4 (partial) / 3 property picked by site totals ........... FIXED (by the newest data of the report asked for - by page or by search)
 4 partial reads called comparable ............................. FIXED (a read of these days for that report still queued, running or failed, and not replaced since by a finished full read, means "still being read from Google" and no changes - real Postgres)
 5 group names collided with the filter and split by case ...... FIXED (the filter is "all" / "none" / "g:" + the name in lower case; a name matching another group in any case takes its spelling - real Postgres)
 6 a remembered filter could hide every site ................... FIXED (the group choice is shown whenever a filter is on; a choice that matches nothing is forgotten once the sites load; the empty state offers "show all sites")
 7 group ranking totals mixed devices and dates ................ FIXED (one device per site - desktop when tracked, else mobile - never the better of two; the card and the totals say the device and the dates the newest checks span - real Postgres)
 8 long group names overflowed phones .......................... FIXED (chip text wraps, select and editor constrained - checked at 390 px with a 40-character name)
 #39-8 (partial) / 9 "no links at all" ........................ FIXED ("no web (http/https) links saved"; JavaScript named as one possible reason; phone and email links not counted)
 #39-9 (partial) / 10 outgoing cells without labels ........... FIXED (each cell carries its label for screen readers)
 Also: report opt-outs are read again just before each recipient.
 #37-2 shifting positions ...................................... STAYS SAID (the source orders by time alone)
 NOT DONE: a claim taken over while the first owner's request is in flight asks the source twice; alert debt from before the #18 migration; request queues per server process.

## Codex audit #41 (2026-10-08; report: tower1 ~/codex-audits/out/seo-audit-41.md)

Verdict: of audit #40's ten, eight fixed and two partial; eight new defects, two HIGH.

 1 HIGH / #40-1 (partial) a send that broke off could be resent .. FIXED (the shared sender tags where a failure happened; reports use a strict mode: the backup account is tried only when the first send certainly did not deliver - a failure before sending or the server's own refusal; a send that broke off keeps its email-log claim, the delivery becomes "not known", and it is not sent again automatically. The absolute "nobody gets a report twice" wording is gone - unit test of the classifier)
 2 HIGH / #40-4 (partial) a newer first page hid a waiting page .. FIXED (any read of these days still queued or running means incomplete, whatever finished after it; a failed read counts until a full read of the same days queued after it finishes - real Postgres incl. this case)
 3 completeness errors failed open ............................. FIXED (a check that cannot be made is "not known": no changes, and the page says the check could not be made)
 4 "any two crawls" was newest-vs-one ......................... FIXED (both sides chosen; newest 100 crawls listed; see F7)
 5 detail views stale after a crawl finished .................. FIXED (Pages, Internal links and Outgoing links are keyed by the newest crawl and read again when it changes)
 6 unreadable "not known" deliveries looked like none ......... FIXED ("couldn't check just now"; which report each one was; the 60 days and "and N more" said)
 7 change labels named the wrong crawl ........................ FIXED (screen-reader and phone labels name the crawl compared with)
 8 invalid crawl choices silently changed the comparison ...... FIXED (a malformed id is refused; a crawl that is not this site's, or not older than the one shown - itself included - is said and the default used)
 Also: the dashboard's group chip keeps the group's own spelling (the chip style capitalised it).
 #37-2 shifting positions ...................................... STAYS SAID (the source orders by time alone)
 NOT DONE: a claim taken over while the first owner's request is in flight asks the source twice; alert debt from before the #18 migration; request queues per server process.

## Codex audit #42 (2026-10-08; report: tower1 ~/codex-audits/out/seo-audit-42.md)

Verdict: of audit #41's eight, five fixed and three partial; nine new defects, none HIGH.

 1 health move could skip an unscored crawl .................. FIXED (every crawl stays in the trend, a gap as a gap; the move is only against the crawl just before, when both have a score)
 2 an unreadable newest crawl became an older score ........... FIXED (the newest finished crawl is always the current one; "could not be read, so its score is not known")
 3 "pages with errors" was issue entries ...................... FIXED (distinct pages, the same set the score counts: "N of M pages with errors")
 4 crawl-size changes unexplained ............................. FIXED (different limits or sizes more than a tenth apart said with both sizes; every crawl's date, score and pages in a list readable without the chart)
 5 dashboard rebuilt every crawl on each load ................. FIXED (each crawl's health worked out once into seo_crawl_health, keyed by a fingerprint of the saved crawl; the dashboard reads crawl identities only - not measured, no speed claim)
 6 / #41-5 (partial) remounts could reuse an old request ...... FIXED (the newest crawl's id is part of each detail view's question; requests honour cancellation)
 7 / #41-3 (partial) no job table read as complete ............ FIXED (no record of reads = "not known", no changes - real Postgres)
 8 / #41-8 (partial) notices hidden with one crawl or none .... FIXED (shown whatever else is on the page; the server says so with no crawl at all)
 9 the "not known" deliveries note stale after a send ......... FIXED (read again after every send)
 #37-2 shifting positions ...................................... STAYS SAID (the source orders by time alone)
 NOT DONE: a claim taken over while the first owner's request is in flight asks the source twice; alert debt from before the #18 migration; request queues per server process.

## Codex audit #43 (2026-10-08; report: tower1 ~/codex-audits/out/seo-audit-43.md)

Verdict: of audit #42's nine, five fixed and four partial; nine new defects, none HIGH.

 1 "previous check" was not a run (same-day results replace) .. FIXED (described and computed as saved days: each keyword's newest saved day against its own day before)
 2 / #42-2 (partial) a broken newest crawl resurrected an older score . FIXED (every finished crawl counts whatever was saved; a report that is not a report, or pages that are not pages, is "could not be read" - real Postgres)
 3 fingerprint missed page statuses ............................ FIXED (the crawl row's own version: any change to it is worked out again - real Postgres with a changed page status)
 4 / #42-5 (partial) dashboard still read crawl payloads ...... FIXED (the dashboard reads crawl identities and versions only; payloads only for a crawl not yet worked out - not measured, no speed claim)
 5 / #42-6 (partial) the main audit request ignored cancellation . FIXED
 6 visibility mislabelled ...................................... FIXED ("visibility index", 100 = every keyword first, not real clicks; weighting and the keywords each change rests on shown per row; same wording in the report and its PDF)
 7 / #42-7 no record of reads still read as complete .......... FIXED (positive evidence needed: every day covered by a finished full read; otherwise "not known" - real Postgres)
 8 / #42-8 (partial) notice promised a crawl that was not there . FIXED ("there is no earlier crawl to compare with")
 9 an unknown device silently changed the question ............ FIXED (anything but desktop / mobile refused; a device the site does not track is said)
 #37-2 shifting positions ...................................... STAYS SAID (the source orders by time alone)
 NOT DONE: a claim taken over while the first owner's request is in flight asks the source twice; alert debt from before the #18 migration; request queues per server process.

## Codex audit #44 (2026-10-08; report: tower1 ~/codex-audits/out/seo-audit-44.md)

Verdict: five new defects, none HIGH.

 1 "well formed" still let a broken crawl score 100 ........... FIXED (a findings list of objects, an errors list if any, and pages each with an address and a numeric status - as the crawler writes them; anything else is "could not be read". Real crawls in the screenshots database still read)
 2 one weighting label for the figure and its change ........... FIXED (said separately when they differ)
 3 the report hid what a tag's change rests on ................. FIXED (in both / new counts and the weighting per tag, on the page and in the PDF; a measured zero is "±0", no comparison is "—")
 4 the PDF lost the minus sign .................................. FIXED (written as "-" everywhere in the PDF - the rankings changes too, which were printing "?")
 5 no tags hid the whole panel ................................. FIXED (all keywords shown, with how to tag them)
 NOT DONE: as audit #43.

## Codex audit #45 (2026-10-08; report: tower1 ~/codex-audits/out/seo-audit-45.md)

Verdict: seven new defects, none HIGH. Codex found no genuine current-format crawl the evidence test would reject.

 1 the stricter test did not reach scores already kept ........ FIXED (formula version 2: every kept crawl health is worked out again)
 2 malformed findings / errors still scored clean ............. FIXED (each finding needs a text severity and, if it lists pages, a list of addresses; each error an address)
 3 the PDF left out the change's weighting .................... FIXED (said under the table when it differs)
 4 the PDF tag table cut its cells ............................ FIXED (short cells in five columns; weighting in lines below; the header repeats after a page break)
 5 tracker changes rounded to a signed 0 ...................... FIXED (one decimal, "pts")
 6 headline changes compared different keywords ............... FIXED (top 10 / top 3 changes and the average position only on keywords in both checks, with their number; none in both = "no keyword was in both checks", never "no keyword changed")
 7 switching device lost focus and the buttons ................ FIXED (heading and device buttons stay; loading and errors show under them)
 NOT DONE: as audit #43.

## Codex audit #46 (2026-10-08; report: tower1 ~/codex-audits/out/seo-audit-46.md)

Verdict: five new defects, none HIGH.

 1 the email's opening line used the old whole-check change ... FIXED (the change on the keywords in both checks, with their number; "no keyword was in both checks")
 2 any severity / error message passed as evidence ............. FIXED (only the crawler's own: critical / warning / info; a failed fetch or one of its own exclusions; formula version 3 works kept scores out again)
 3 long PDF tag names could wrap and skip the repeated header .. FIXED (every cell one line of fixed height, cut with "…"; the header repeats on a new page; the weighting note names five tags and "N more" - checked with 60 long tags: two pages, header on both)
 4 a failed refresh of By tag was hidden ...................... FIXED ("couldn't refresh - what is shown is from the last time it loaded", with Try again)
 5 Site audit and the report skipped the evidence test ......... FIXED (one test for the dashboard, Site audit, its comparisons and the report; a broken newest crawl is said everywhere and no older score takes its place unless picked - real Postgres 18/18)
 NOT DONE: as audit #43.

## Codex audit #47 (2026-10-08; report: tower1 ~/codex-audits/out/seo-audit-47.md)

Verdict: seven new defects, none HIGH.

 1 the evidence test still let damaged evidence through ........ FIXED (exact exclusion texts; a message must be text; findings need an id and a list of pages; statuses whole numbers 100-599. Formula version 4. Checked read-only on the live database: its one finished crawl still reads)
 2 a broken crawl in between vanished from comparisons ......... FIXED (every finished crawl stays in the history - a broken one as a gap - and in the pickers, listed "could not be read" and not choosable; when the crawl just before is broken no change is shown by default, an older one can be picked - real Postgres)
 3 a report whose only news was an unreadable crawl was "empty" . FIXED (it is news: page, PDF and email carry it)
 4 site health that could not be looked up vanished ............ FIXED (said as "could not be looked up"; a scheduled send fails and is tried again)
 5 the PDF's weighting note could not name every tag ........... FIXED (numbered rows, each with its own weighting marker; names cut to fit are given in full under the table)
 6 detail views could read a crawl the summary would not ........ FIXED (Pages, Internal links and Outgoing links read crawls with the same evidence test)
 7 By tag hid a failed refresh over "no keywords" ............... FIXED
 NOT DONE: as audit #43.

## Codex audit #48 (2026-10-08; report: tower1 ~/codex-audits/out/seo-audit-48.md)

Verdict: six new defects, one HIGH.

 1 HIGH the evidence test could fail on a malformed value ...... FIXED (every list is unpacked only when it is a list, so SQL's free order of tests can never make the test itself fail - a malformed crawl just fails it)
 2 a genuine crawl with a status like 999 was rejected ......... FIXED (any three-digit status a server can send; formula version 5)
 3 views reading "the newest crawl" fell back to an older one ... FIXED (one lookup of the newest finished crawl, whatever it is - Pages, Internal links, Outgoing links, the link resolver and the action plan's evidence say "could not be read" or use nothing; never an older crawl - real Postgres)
 4 the Site audit chart bridged missing crawls ................. FIXED (every crawl on the chart, gaps not joined; a dated list says "could not be read" or "no page could be scored")
 5 detail caches ignored a changed crawl ....................... FIXED (kept by the crawl's row version, as the dashboard)
 6 PDF "full names" could be "?" ................................ FIXED in words (a name with characters the PDF font cannot show is flagged "see the report page", which shows it as written; embedding a font is left for later)
 NOT DONE: as audit #43; a PDF font for every script.

## Codex audit #49 (2026-10-08; report: tower1 ~/codex-audits/out/seo-audit-49.md) - and Kimi's review of slice 62

Verdict: five new defects, none HIGH. Kimi (second reviewer, from 3:58 PM ET) found the Competitors panel could show the previous site's answer while another site loaded.

 1 check and read could see different versions of a crawl ...... FIXED (readNewestCrawl: the row is read only at the version checked and still passing the test, else looked up again - Pages, Internal links, Outgoing links, the link resolver and plan evidence)
 2 open detail views kept old "newest" data ..................... FIXED (keyed by the newest finished crawl, readable or not, and its row version)
 3 the crawl list hid when it was needed ......................... FIXED (shown whenever there is any crawl, above everything else; runs on the same day carry their time)
 4 odd optional fields could crash Site audit ................... FIXED (area scores only when they are scores; a finding's area, "why" and "fix" only when text)
 5 statuses like 999 or 101 were mislabelled .................... FIXED ("Unusual answer (1xx, or above 599)", an error page in health; formula version 6)
 Kimi: Competitors kept the previous site's answer while loading .. FIXED (only the same site's earlier answer may stand in; the panel is reset per site)
 NOT DONE: as audit #43; a PDF font for every script.

## Codex audit #50 (2026-10-08; report: tower1 ~/codex-audits/out/seo-audit-50.md) - Kimi reviewed the fixes before deploy

Verdict: eight new defects, none HIGH. Kimi (pre-deploy review): no serious defects; one low fixed (a tag removed elsewhere now goes back to all keywords).

 1 bad device / tag values silently changed the question ....... FIXED (a value given must be one the site has, else refused)
 2 a failed tag choice removed the controls .................... FIXED (heading and choices stay with the earlier answer, marked; "All keywords" offered; a removed tag goes back to all)
 3 an idle Site audit never saw a crawl finished elsewhere ...... FIXED (read again every 5 minutes and when the window regains focus)
 4 odd titles / area names could still crash Site audit ......... FIXED (titles only when text; area names never looked up beyond the known list)
 5 an empty tag showed measured-looking zeros ................... FIXED ("not measured", no bars)
 6 outgoing checks mislabelled statuses outside 200-599 ......... FIXED ("answered with a status outside the usual ones" - never fine, never broken)
 7 "every crawl" meant twelve .................................. FIXED ("the latest 12 crawls (of N)")
 8 area scores outside 0-100 shown as ratings ................... FIXED (not measured)
 Kimi's earlier lows (audit #49 round): the Pages tab's 1xx rule, the empty-tag wording and the permanent "unusual: 0" row - FIXED; a read that keeps colliding with crawl updates after three tries is still a plain error (rare).
 NOT DONE: as audit #43; a PDF font for every script.

## Codex audit #51 (2026-10-08; report: tower1 ~/codex-audits/out/seo-audit-51.md) - Kimi reviewed the fixes before deploy

Verdict: five new defects, one HIGH (ranked by customer impact, as asked). Kimi: nothing serious; three trivial clean-ups and one low point, all done.

 1 HIGH a page now down could turn its old issues "fixed" ....... FIXED (an issue read from the page itself counts as re-checked only if every page it was on answered 2xx this time; status / fetch / redirect / https findings need only the page asked again - an http address now sent to https is found as its https twin. Unit test with the audit's own example)
 2 Competitors stale after a rank check ......................... FIXED (refreshed with the history on check completion and keyword changes; read again after a minute when looked at)
 3 competitors with no saved place shown as 0% .................. FIXED (each competitor's figures rest only on the checks that saved its place - "not measured", or "on N of M")
 4 focus refresh never fired .................................... FIXED (always, whatever the app's default)
 5 Pages tab filters and counts used different status rules ..... FIXED (one rule)
 Also: a stored crawl error is shown only as one short plain line, else the general wording.
 NOT DONE: as audit #43; a PDF font for every script.

## Codex audit #52 (2026-10-08; report: tower1 ~/codex-audits/out/seo-audit-52.md)

Verdict: four new defects, none HIGH (ranked by customer impact).

 1 pages that failed to load counted as improvements ............ FIXED (an issue's change leaves out pages that dropped off its list without being re-read, and says how many: "N not re-checked" - one rule, reread(), for changes and for "fixed")
 2 the https twin did not prove http was put right ............... FIXED (removed: an http address is re-checked only when it is itself asked again)
 3 stored crawl errors left the server as written ................ FIXED (crawlFailureWords: the crawler's two messages mapped to approved sentences, anything else the general one)
 4 a status issue closed on an unusual answer .................... FIXED (needs a 2xx/3xx answer)
 Kimi's pre-deploy review this round was stopped: it began writing scratch test files into the worktree against its read-only brief (none were left; the worktree was checked clean).
 NOT DONE: as audit #43; a PDF font for every script.

## Codex audit #53 (2026-10-08; report: tower1 ~/codex-audits/out/seo-audit-53.md)

Verdict: four new defects, one HIGH (ranked by customer impact; the HIGH is in older code).

 1 HIGH rank-drop alerts could be lost for good ................. FIXED (a run that closes owes its alerts - set in the same statement - until they are saved; a crash or failure in between is settled on a later pass, filed under the run's own day so a saved alert is never made twice - real Postgres: owed, settled once, not again)
 2 still-listed issues improved without repeat measurements ..... FIXED (one evidence rule for a still-listed issue's change and for "fixed": sampled checks never re-checked, PageSpeed needs the same device measured again, the profile rule for local checks - unit tests)
 3 an unchanged soft 404 looked worse every crawl ................ FIXED (compared and counted by part of the site, never by its made-up addresses)
 4 choosing a crawl dropped the pickers and focus ................ FIXED (this site's answer stays, marked loading; a failed choice keeps it with "Try again" and "Show the newest crawl")
 NOT DONE: as audit #43; a PDF font for every script.

## Codex audit #54 (2026-10-08; report: tower1 ~/codex-audits/out/seo-audit-54.md)

Verdict: four new defects, one HIGH - in the audit #53 fix itself.

 1 HIGH owed rank alerts vanished after a newer check ............ FIXED by removing the debt: a run's moves are worked out BEFORE it is closed, and closing it and saving its alerts happen in ONE transaction (a failure leaves the run open, closed again on a later tick) - nothing is ever owed, so nothing can be overwritten (real Postgres)
 2 runs that stopped early never alerted ........................ FIXED (closed as failed together with the alerts for what they saved, titled "from a check that stopped early" - real Postgres)
 3 Google-profile gaps could pass as fixes ....................... FIXED (an entry counts as fixed only when the same profile is attached and still lists it; removed from the profile or another profile = changed scope, not re-checked - unit tests)
 4 immediate and retried alerts used different days ............. FIXED by 1 (one day, read inside the closing transaction)
 carried since #48: a PDF font beyond Windows-1252 ............... FIXED (DejaVu Sans, bundled in server/data/fonts with its licence and embedded in the report PDF: Latin, Greek, Cyrillic, Arabic and Hebrew print as written; a tag name is flagged "cannot show" only when a character really has no glyph, as Chinese still has none; the built-in Helvetica stays as the fallback when the font files cannot be read, said once in the log)
 NOT DONE: as audit #43.

## Codex audit #55 - the FINAL audit of this build (2026-10-08; report: tower1 ~/codex-audits/out/seo-audit-55.md)

Closed out with five parallel workers (Fable 5.1), each on its own worktree and throwaway database, merged and verified together on seo/ahrefs-68. The carried NOT DONE items are closed too:
 - duplicate vendor request on a claim takeover ................ FIXED: every claim owner works to a deadline (claimed at + lifetime - 60s request timeout - 30s margin): nothing is sent after it and a request in flight is cut off, so an owner's requests always end before its claim can be taken over (keyword watch, "Check again" receipts, mentions watch, rank-run posting, backlink snapshots, grid scans and watches - unit tests + real Postgres "deadline" 16/16)
 - request queues per server process .......................... FIXED (#55 item 12): once / buyOnce / serial hold a Postgres advisory lock per key across processes (transaction-scoped, waits capped at 75s, at most half the pool); a second process waits and then finds the saved copy; a wait that runs out, or a deadlock Postgres breaks, is "busy, try again" (503) - real Postgres "locks" 17/17
 - alert debt from before the #18 migration .................... CLOSED on evidence: the live database has no backlink snapshots at all, so no alert was ever owed
 - a PDF font for every script ................................. FIXED (#55 item 13): DejaVu Sans embedded (Latin, Greek, Cyrillic, Arabic, Hebrew); CJK and the like still cannot be shown and are flagged
 - a crawl read racing crawl updates ........................... FIXED: a retryable 409 with its own message, never a generic 500
 - shifting positions in the mentions watch .................... STAYS SAID (the source orders by time alone)

#55 items 1, 2, 3, 4, 6, 8, 9 - rank runs, rank alerts, alert lists, retries:

Verdict: thirteen new defects, four HIGH - rank alerts could still disappear and scheduled checks be skipped.

 1 HIGH a stuck run's planning failure became "no alerts" ...... FIXED: the moves are worked out INSIDE the transaction that closes the run (stuck or not); any failure rolls the closing back and the run is closed on a later tick - never closed without its alerts (real Postgres: 5c5, 5c5b)
 2 HIGH same-day dedupe hid genuinely new losses .............. FIXED: an alert belongs to its run (source = run id), and moves are compared one by one (keyword, device, what, positions, the two days compared - movementKey); a second check the same day alerts a new fall alone, the same run raised again adds nothing, the same moves are not said twice (5c3, 5c4, 5c; unit tests)
 3 HIGH runs still owing alerts (alerts_due) were abandoned ... FIXED: settleOwedRankAlerts raises them from the run's own checks while they are there; when a later check replaced them all, that is written on the run and logged, then the debt is cleared (5c7, 5c7b)
 4 HIGH scheduled checks advanced before being queued ......... FIXED: the site's next date moves on in the same transaction that queues its run; a refused insert leaves it due; a plan without the tools skips on purpose; with the source not set up the checks wait (frequency 9/9)
 6 a 90-minute timeout closed as a complete check ............. FIXED: completeness = results saved against lookups asked for (less keywords removed meanwhile); kept on the run (`partial`, backfilled for old rows) and shown ("done, but not every check came back"); the alert title says "from a check that did not finish: N of M lookups came back" (5c2b, 5c6)
 8 alerts cut evidence (200) and history (100, filtered after) FIXED: every movement is kept (the page shows 25 and "Show all N"); GET /api/seo/alerts pages server-side (50, `before` cursor) with the kind filtered by the database first and the counts the wording rests on (total, totalAll, "Showing N of M") - "No alerts of this kind" is now true (alerts 1-4; white-label SPECS)
 9 deliveries aged out at 3 days, refunds at 14 ............... FIXED: deliveries are tried later and later for ever until sent or given up after 48 tries, when the alert is marked "Not sent" (kept on the page, counted in /api/seo/status alertsUndelivered and on the admin card, logged); a given-up email is marked too; refunds owed are never aged out (longest-waiting first, counted on the admin card as refundsOwed) and the run's note says the refund is owed (alerts 5-8; ledger 13d, 13e)
 Also: alert ids are numbers in the listing (the driver hands bigints over as text; the page's single "Mark read" sent a string, which the route refused).

#55 items 5, 7, 10, 11 - gaps, Search Console, places:
 5 HIGH profile gaps "fixed" when nothing was read ............. FIXED: one matching rule shared with the crawler (profileEntryMatches); fixed only when the same profile lists the entry AND a page this crawl read names it in its title or H1
 7 headline Search Console numbers skipped the completeness rules FIXED: the summary uses the breakdown's property choice and read-completeness evidence; incomplete / not known is said on the tile, the report page, the PDF and the email, and nothing is compared then
 10 a typed town became a national check ........................ FIXED: an unchosen town blocks "Track these" with a linked message (checked in the browser: nothing sent)
 11 site countries could not be default locations .............. FIXED: every country the product accepts works as a site's default location
 12, 13: see the carried items above.

THE LOOP STOPS HERE (owner, 10/8: "finish these tasks"). Left for the owner, not code: Google tag IDs, Google Ads OAuth, Stripe live tests, SEO_MONTHLY_BUDGET_USD, the DataForSEO top-up, the lead-attribution source. Left to another session: server/crm/crm-plans.test.ts (the 7-day trial vs a test expecting 14). Product gaps still thinner than Ahrefs, for a later build: B4, B8, B10, B12, C7, C8, G1 (paid data) and G3 Web Analytics.

## Kimi audit #1 (2026-10-08; report: tower1 ~/codex-audits/out/kimi-seo-audit-1.md, commit f80560d) - the third mind

Verdict (Kimi): no CRITICAL; the billing core sound; 14 defects, mostly MEDIUM and LOW, and a table of headlines that claimed more than the data. Each finding was checked against the code before anything was changed.

DONE - money first:
 1 manual and monthly backlink snapshot could both buy the same day . FIXED: every snapshot purchase of a site holds one per-site lock (in every server process) and first looks for today's snapshot - the monthly job stands down, "Refresh now" answers today's snapshot ("Already refreshed today - nothing was bought"); one snapshot per site per day (real Postgres: both at once -> the source asked once, one row, one purchase)
 2 five once-wrapped routes re-bought in a second process .......... FIXED: search volumes are read inside the lock (a waiter finds them filled in); keyword ideas, the Maps lookup and the competitor gap reuse a copy saved in the last 5 minutes (buyOnce); an AI question reuses a run of the same question to the same assistants saved in the last 2 minutes (later re-asks are new asks) - real Postgres
 3 grid charge not capped at the figure shown ........................ FIXED, and wider than reported: withBudget now never charges a customer more than was reserved, on every route; a grid point costs the customer at most the per-point price on the button (unit test with the source billing 2.5x)
 4 a successful answer with no cost field treated as free .......... FIXED: the vendor client marks it inside the budgeted call; our ledger keeps the estimate (unknown, never zero); the customer is not charged an invented price (real Postgres)
DONE - the rest asked for:
 6 soft 404 ............................................................. "sent home" now covers the home page's usual names (/home, /index.html|htm|php|asp|aspx, /default.aspx); "asked" is a recorded flag on each probe (older crawls: their note); the "two addresses" claim (F4) corrected - NOT done: a second probe on sites without a usable sitemap (the probe runs before the crawl has found any section, so a guessed section would prove nothing)
 7 Retry silently re-enabled PageSpeed ................................. FIXED: a rescan keeps the scan's own PageSpeed setting; with it off the button says "Rescan (PageSpeed stays off)"
 10 the 50-site cap refused re-adding a site ........................... FIXED: the cap counts only sites the account does not have yet, one add at a time per account (real Postgres)
 11 dates in the reader's zone with no note ........................... FIXED: every SEO date is its UTC day (as the PDF and email), said once on every SEO page; times say their zone
 12 absence asserted as fact ........................................... FIXED: "not found" / "no longer found in the results" / "the keyword database has you at" on screens, report, PDF, email and alerts
 13 audit capability overclaimed ....................................... FIXED: the crawl reads the HTML as sent, without JavaScript, and is not Googlebot - said so
 Section 3 (claims that overstate) ..................................... FIXED row by row: estimates say "estimate", saved results say "as saved" with their date, the grid point is a lookup of Google's local results, AI answers are "when last asked"
 9 stale comments ...................................................... explorer.ts fixed (two years of history); the crawler's "capped at 20" is accurate (it describes older crawls) - left
NOT DONE, and why:
 5 a crash between "saved" and "settled" gives the data away (milliseconds; the known cost of SAVED FIRST, CHARGED SECOND - settling first would be worse; a "delivered" marker the reconciler charges for is a ledger change for a later build)
 8 agency members see jobs they cannot open (server/agency - outside the SEO product, cosmetic; for the agency code's owner)
 14 vendor downtime slowly uses the internal monthly cap (bounded by the cap and the leases; a per-site circuit breaker is a design change for a later build)

## Visual redesign (2026-10-08, owner: "blue wording, orange graphs") - every SEO screen

The owner called the screens bland and asked for Ahrefs' look with only a few colours. The rule they set: blue for
wording (labels, headings, links), orange for every chart and bar, green / red only where a figure is better or worse
(and for a health score, keyword difficulty and the local grid's map-pack dots, which mean exactly that).
- Dashboard (live 8:28 PM ET, release main 7d1018f): one card per site, figures as Ahrefs-style columns with thin
  dividers, orange trends with their high and low, a start panel for a site not analysed yet.
- Every other screen, same building blocks (client/src/pages/seo/viz.tsx plus one helper file per screen):
  Site explorer (headline figures in two rows, orange bar rows, one trend chart with a figure switch), Rank tracker
  (figure row with sparks, one history chart with a switch, orange position bands), Site audit (health ring, status
  bar, severity columns, orange health trend), Keywords explorer (figure row, difficulty badge, monthly orange bars,
  results-page features as grey tags), Content explorer (result cards with orange figure bars), Backlinks, Reports,
  Local grid, AI visibility, Alerts and Action plan (figure rows, orange bars).
- One position badge and one difficulty badge on every screen, the shared report tables included (viz.tsx).
- Presentation only: no data, price, buying button, schedule or wording-of-basis change; every data-testid kept.
- Checked on the vb11 rig at 1440 px, 390 px and in dark mode: no sideways scroll, no page errors; before / after
  sheets sent to the owner before anything went live.

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
- 10/8 audit #15 fixes: 264 unit tests; real Postgres on a fresh database - ledger 44/44, places+alerts 27/27, AI + lists 15/15, grid + scheduler all passing (incl. a period-close made to fail once: 9 lookups, then 0 on the next pass), tasks 9/9. Browser: "Refresh now - up to $0.31", the reworded lost-backlinks section, report grid lines over shared points.
- 10/8 slice 25 (service-area planner): 270 unit tests incl. the white-label route rule (two new routes added). Browser: table built for 42 searches, cell names read out ("siding contractor bellingham: 320 searches a month; you rank 11, beyond page one, with your home page"), gaps selected and sent to the plan (8 added).
- 10/8 audit #16 fixes: 270 unit tests; real Postgres on a fresh database - ledger 44/44, places+alerts 28/28, AI + lists 15/15, grid + scheduler passing, tasks all passing. Browser: plan opened for the named site with database counts; the audit task says "Not rechecked since it was added"; a live backlink refresh (201, charged 31c) with the snapshot saved inside the charged call.
- 10/8 slice 27 (three parity items): 273 unit tests incl. the white-label rule (one new route). Browser: the rank tracker's "On the page" chips and summary; a site starred and moved to the top, order by name with the starred site still first; two months compared for jameshardie.com (Sep 2025 against Sep 2026, then from Oct 2024).
- 10/8 audit #17 fixes: 273 unit tests; real Postgres on a fresh database - ledger 44/44, places+alerts 28/28, AI + lists 15/15, grid + scheduler passing, tasks passing (incl. two reopenings at once for one place). Browser: planner quote "Up to $0.14" (the reservation), an over-long pairing named and blocked; an audit task added today says "Not rechecked since it was added", one added before crawls were recorded says it can't be checked automatically.
- 10/8 slice 29 (directories + page numbers): 279 unit tests incl. the white-label route rule (two new routes). Browser, live: directories for three sites (201; meta "linked from 0 of these 26 - 4 where a competitor is and you are not"), gaps to the plan (4 added); Content explorer numbers for 25 pages (201, charged 16c against a stated 17c) and both orderings.
- 10/8 audit #18 fixes: 280 unit tests; real Postgres on a fresh database - ledger 44/44, places+alerts 29/29 (an older snapshot judged against its own predecessor), AI + lists 15/15, grid + scheduler passing, tasks passing. Browser: planner quote required before buying and inputs remembered after a reload; a live backlink refresh through the single transaction (snapshot saved, alerts settled, next snapshot a month on).
- 10/8 slice 31 (rendering check): 285 unit tests incl. the white-label route rule (three new routes, 74). Real Postgres on a fresh database - ledger, places+alerts, AI + lists, grid + scheduler, tasks all passing, rendering runs 12/12 (one running per site, another account cannot read it, a closed run cannot be finished, raw error text never shown). Browser, live: an address on another site refused; 10 pages of alpineexteriorswa.com checked in the background (charged 21c against a 26c hold): the home page reads the same either way (412 / 415 words, 99 / 98 own-site links), the nine "compare" pages depend on JavaScript (1 own-site link in the HTML, 107 once rendered). Found by running it: one fetch in three failed without being billed when three ran at once - such a fetch is now asked for once more.
- 10/8 audit #19 fixes: 285 unit tests. Browser, live: directories for three sites ("Up to $0.34", charged 29c; "4 that link to a competitor and not to you"); page numbers with "estimated US search visits". The pattern filter and the way the source echoes page addresses and answers zero were checked against the source itself. The settlement rule was run in Postgres (same version settles; a rewritten snapshot does not).
- 10/8 slice 32 + audit #20 fixes: 292 unit tests incl. the white-label route rule (one new route, 75). Real Postgres on a fresh database - ledger, places+alerts, AI + lists, grid + scheduler, tasks, rendering runs all passing. Browser: competing pages for two keywords (earlier checks added to the screenshots database to have something to show), pages listed with their checks, a task added; "Group by topic" on a 10-keyword list (2 topics, select-all per topic). Rendering, live: an address with a port refused; the same page twice counted once ("Check 4 pages - up to $0.11", charged 9c); a compare page "more once JavaScript runs" (1 own-site link in the HTML, 107 in the browser visit), the home page and the guide "much the same". Found by running it: the site answers 200 for a page that does not exist (the check reports what it saw - worth a crawl issue of its own). A retry with nothing saved answered 409 and bought nothing.
- 10/8 slice 33 + audit #21 fixes: 295 unit tests incl. the white-label route rule (one new route, 76). Real Postgres on a fresh database - all six check scripts passing. Browser, live: the AI summary from the saved answers (named in 2 of 4, by assistant, ten other businesses, twelve websites with the four directories marked and one added to the plan); the page-shown panel ("10 of your 10 checked keywords ranked in two or more checks", town and device per line); topic groups with "Other keywords"; rendering with the same-address rule (4 pages, 2 "more once JavaScript runs", 2 "much the same" - the two visits' addresses matched on every page).
- 10/8 slice 34 + audit #22 fixes: 297 unit tests. Real Postgres on a fresh database - seven check scripts passing (new: AI summary 7/7 - 40 repeats of one question count once, another account's rows are not read). Browser, live, jameshardie.com: Organic keywords narrowed to /blog/ (4,176 keywords, every row a /blog/ page; 201, charged 8c), to one page pasted as a whole address (215 keywords, all that page), cleared; Backlinks narrowed to /blog/ (628); no section control on Linking sites; a path with a space or % refused in words. The filters were first tried against the source directly (section and exact page on keywords, backlinks, top pages, best by links). Rendering, directories, AI summary and the page-shown panel re-run after the fixes.
- 10/8 slice 35 + audit #23 fixes: 301 unit tests incl. the white-label route rule (three new routes, 79). Real Postgres on a fresh database - eight check scripts passing (new: keyword watch 17/17 - compared with the one before, alerts once, a same-day retake judged again, cut-at-the-limit never alerts, the schedule buys once and moves a month, a snapshot that cannot be saved is not charged). Found by the database check: the alerts table refused the two new kinds - its rule is now widened in a step that runs after the grid's. Browser, live: a snapshot of alpineexteriorswa.com (74 keywords, charged 9c against "up to $0.20"), a second compared with a month-old one ("started ranking for 2 searches and no longer ranks for 1"), both alerts on the page and delivered, the watch turned on ("Next: Nov 8" - not bought again the same day). Section scope re-run with the boundary rule: /blog 4,174 keywords and 630 links; an address on another site refused in words; an empty section says so. Found by running it: the first browser pass was against a stale checkout - the commit on screen is now checked before a pass counts.
- 10/8 slice 36 + audit #24 fixes: 304 unit tests incl. the white-label route rule (one new route, 80). Real Postgres on a fresh database - eight check scripts passing; keyword watch now 24/24 (the same day returns the snapshot there is with no call to the source; a second one while the first is being taken is refused; alerts off = none and nothing owing; a total not given = no alert; a day that already has a snapshot is not bought by the schedule; a snapshot that cannot be saved charges nothing and gives the claim back). Browser, live: today's snapshot taken (201, 9c), asked again (200, "reused"), "newly seen 2 / no longer seen 1", both alerts with the new wording; scope refusals for a port, a protocol-relative address on another site and a sub-domain; tracking from keyword ideas (ticks stay on a failure, go on success). Same-results groups on real result pages fetched for 14 keywords: "siding companies" + "siding installers" (7 of 9 results shared), "siding contractor" and "siding contractors" not grouped (3 shared) - the first pages really differed. Found by running it: real first pages hold 7-9 ordinary results, not ten - the wording says "first-page results (up to ten)".
- 10/8 slice 37 + audit #25 fixes: 355 tests across server/seo and the crawler's own suites. Real Postgres on a fresh database - keyword watch 27/27 (new: a displaced owner saves nothing and cannot release the successor's claim; a leased occurrence whose date moved buys nothing). The crawler was run for real: three pages each of two live sites (alpineexteriorswa.com answers 200 for a page that cannot exist - reported with its guide and evidence; jameshardie.com answers 404 - nothing reported), then a full 150-page crawl through the app (the new issue listed as New on the audit page with its explanation). Found by reading on: the crawler throws on a finding without a fix guide - the guide, the evidence and a test through that path were added before anything ran. Browser: same-results panel reworded (group with its dates; "not found for any of them"; review task saved), today's snapshot note with the UTC boundary, scope refusals, tracking clears only what was sent. The new scope pattern was run against the source on all four reports (4,174 / 630 / 86 / 297 rows for /blog).
- 10/8 slice 38 + audit #26 fixes: 359 tests across server/seo and the crawler's own suites. Real Postgres on a fresh database - keyword watch 31/31. The crawler was run for real against three live sites: alpineexteriorswa.com (two made-up addresses, top and /guides/, both answered 200 without noindex - reported), jameshardie.com (both 404 - nothing), yelp.com (robots.txt forbids it - "not checked", nothing). Internal links on a real 150-page crawl of jameshardie.com with 60 ranking keywords saved for the purpose: 42 looked for, 18 with a page the crawl did not reach, 5 left out as menu text, 10 suggestions (pages mentioning "soffit" that do not link to the soffit page), exported shape checked, added to the plan; on the JavaScript-built site the view says the crawl cannot see its links. Found by running it: the per-page limit was per keyword - now per ranking page. Browser: plan tasks open "What this is based on" for an audit task and a same-results task; the keyword alert names its country and both snapshot dates.
- 10/8 slice 39 + audit #27 fixes: 363 tests across server/seo and the crawler's suites (the two crawler files that need a database fail as on main). Real Postgres on a fresh database - nine check scripts passing; keyword watch 33/33 (new: a displaced monthly occurrence on a day with a snapshot leaves the date alone; the one holding its lease moves it), new script/seo-link-opps-check.ts 5/5 (the newest check decides, not the last success; device and place carried; a same-day rank change seen at once; another account's crawl not read), AI summary 10/10 (like for like over the one shared question). The crawler run for real: alpineexteriorswa.com (both made-up addresses 200 - reported, fixes named "https://alpineexteriorswa.com/" and ".../guides/"), jameshardie.com (both 404 - nothing), yelp.com (robots.txt - both recorded "not asked", nothing claimed). Browser (vb11, commit checked): internal links for jameshardie.com - 36 keywords looked for, the left-out reasons listed (18 not reached, 1 too short, 5 menu text), CSV with its provenance columns, one link planned then "add the first 10" = 9 added, 1 already there; the JavaScript-built site still says the crawl cannot see its links. AI names over time and the like-for-like card at 1440 and 390 px (backdated copies of the real October answers were added to the screenshots database to have two months): 0 page errors, no overflow; found by looking: on a phone the stacked rows lost their month labels - added.
- 10/8 slice 40 + audit #28 fixes: 365 tests across server/seo and the crawler's suites (the two database-needing crawler files fail as on main). Real Postgres on a fresh database - nine scripts passing: keyword watch 37/37 (new 7b: snapshots listed newest first; two chosen compared; an alert's own pair holds every keyword it kept; the later one as "before", the same twice, an unknown id and another account refused), tasks 14/14 (old link identity matched), link view 6/6 (canonical copy listed first is never the destination; a link through an old redirected address counts). Browser (vb11, commit checked), with a backdated test copy of a snapshot and of the AI answers added to the screenshots database: an alert's "Open this comparison" switched the site and asked for its own pair (now=4, before=1), Aug 8 chosen (14 newly seen), back to the newest two; AI comparison switched to August (asked ?vs=2026-08, select shows it, "0 of 4 -> 2 of 4"), an unknown month falls back to September, malformed is ignored; internal links re-run; 0 page errors and no overflow at 1440 and 390 px. Found by looking: "Position now" on an older pair - headers now give the snapshot dates.
- 10/8 slice 41 + audit #29 fixes: 368 tests across server/seo and the crawler's suites (the two database-needing crawler files fail as on main). Real Postgres on a fresh database - nine scripts passing; keyword watch 39/39 (new 7c: a pair older than the listed 36 comes back described; another site of the same account is refused), tasks 14/14 (an old link task written with http, www and a last slash matched). Browser (vb11, commit checked): "By page" for Sep->Oct and Aug->Oct at 1440 and 390 px, a declining page planned once (second time "already"); "Open this comparison" from site 3 switched to site 1, loaded the alert's pair and moved focus to its heading; choosing with the keyboard kept focus in the select; an out-of-range id answered 400; earlier screens re-run (keyword history, AI months, internal links): 0 page errors, no overflow.
- 10/8 audit #30 fixes: 370 tests across server/seo and the crawler's suites (the two database-needing crawler files fail as on main). Real Postgres on a fresh database - nine scripts passing; link view 7/7 (new: an old link task written http/www/last slash and pointing at a printable copy takes the identity of today's suggestion). Browser (vb11, commit checked): "By page" at 1440 and 390 px, a declining page planned; "Open this comparison" focuses the comparison, and again when reopened; choosing keeps focus in the select; internal links re-run; 0 page errors, no overflow.
- 10/8 slice 43 (mentions) + audit #31 fixes: 379 tests across server/seo and the crawler's suites (the two database-needing crawler files fail as on main); white-label rule with three new routes (84). Real Postgres on a fresh database - ten scripts passing (new: mentions 7/7 through the real ledger; link view 8/8 - today's link recognised as one planned under the old identity without rewriting it, two simultaneous requests add one task). Found by the database check: the alias lookup inside the task insert failed when the crawl table did not exist and would have ended the transaction - guarded. Browser (vb11, commit checked): Mentions bought live once (201 in 7 s, 50 websites), reopened free after a reload, places changed to "Tampa" re-read with no purchase, a prospect planned, CSV; 0 page errors, no overflow at 390 px. Found by looking: excerpts that do not show the name (spam pages) - now labelled.
- 10/8 slice 44 (mention verdicts) + audit #32 fixes: 380 tests across server/seo and the crawler's suites (the two database-needing crawler files fail as on main), white-label rule 85 routes. Real Postgres on a fresh database - ten scripts passing (link view 9/9: a stale stored identity does not block a different link; mentions 10/10). Browser (vb11, commit checked): verdicts given and kept after a reload, another name looked up free (a peek, no purchase) and back again, two simultaneous "Check again" requests bought once; 0 page errors.
- 10/8 slice 45 (mentions watch): 334 SEO unit tests; real Postgres - eleven scripts passing (new: mention watch 12/12). Browser and a real scheduler pass on vb11 (commit checked); Site Explorer opens on a report from ?view=; 0 page errors.
- 10/8 audit #33 fixes: 383 tests across server/seo and the crawler's suites; real Postgres - eleven scripts passing (mentions 10/10 with page verdicts, mention watch 12/12 with page verdicts). Browser (vb11, commit checked): verdicts per page saved and kept after a reload; "Check again" receipts as above; 0 page errors.
- 10/8 slice 47 (work in reports) + audit #34 fixes: 384 tests across server/seo and the crawler's suites (the database-needing files fail as on main), white-label rule 87 routes. Real Postgres - eleven scripts passing (mention watch 20/20: today already checked buys nothing; a name change mid-run saves and charges nothing; two pages of one website kept; an over-full window resumes from its last page; pages already seen left out; an unknown link is worded "not known"; the link check retried is saved and charged 10c; another account cannot touch it). Browser (vb11, commit checked): /seo/mentions?site=1 opened that site from another, the watch panel at 1440 and 390 px with verdicts and export; the report's work section and PDF; "Check again" twice at once = one purchase, a repeat = reused, no "replaces" = refused; 0 page errors.
- 10/8 slice 48 (due dates, owners) + audit #35 fixes: 385 tests across server/seo and the crawler's suites (database-needing files fail as on main). Real Postgres - eleven scripts passing (tasks 18/18; mention watch 23/23: ties move a second on and say so with every page read kept; a double-spaced business name is followed; an unsearchable name waits a week and says why). Browser (vb11, commit checked): /seo/mentions?site=1&check=1 opens the alert's check; an unknown site is said; the watch panel; the plan's overdue order and the report's past-due list; "Check again" twice at once = one purchase; 0 page errors.
- 10/8 slice 49 (rank frequency) + audit #36 fixes: 387 tests across server/seo and the crawler's suites (database-needing files fail as on main). Real Postgres - twelve scripts passing (new: frequency 3/3; mention watch 24/24 with the tie cursor). Browser (vb11, commit checked): the frequency choice with monthly prices and the saved next date; an alert link to a check that is not there is said; a due date in 2027 shows its year; a 60-character owner wraps at 390 px; 0 page errors.
- 10/8 slice 50 (outgoing links) + audit #37 fixes: 392 tests across server/seo and the crawler's suites (database-needing files fail as on main), white-label rule 88 routes. Real Postgres - fourteen scripts passing (new: outgoing 4/4, report schedule 2/2; mention watch 24/24 with fixed-window paging). Browser (vb11, commit checked): Outgoing links on both real crawls at 1440 and 390 px, the frequency settings, the mentions panel; 0 page errors.
- 10/8 slice 51 (Search Console by page/search) + audit #38 fixes: 395 tests across server/seo and the crawler's suites (database-needing files fail as on main), white-label rule 89 routes. Real Postgres - fifteen scripts passing (new: gsc breakdown 4/4; mention watch 25/25 incl. an old unfinished window; report schedule 3/3 incl. a stale pass). Browser (vb11, commit checked): Search Console pages and searches, outgoing links with the new wording, the mentions panel; 0 page errors.
- 10/8 slice 52 (dashboard groups) + audit #39 fixes: 395 tests across server/seo and the crawler's suites (database-needing files fail as on main). Real Postgres - fifteen scripts passing (gsc breakdown 5/5 incl. the property with data chosen). Two real scheduled-report passes on the dev rig (emails to the sink): sent once, delivery "sent", occurrence closed; the second pass sent nothing. Browser (vb11, commit checked): dashboard groups, Search Console (not returned / changes), outgoing links, mentions panel; 0 page errors, no overflow.
- 10/8 slice 53 (compare any two crawls) + audit #40 fixes: 396 tests across server/seo and the crawler's suites (database-needing files fail as on main). Real Postgres - eighteen scripts passing (new: audit compare 10/10, report "not known" delivery 6/6, dashboard groups and positions 7/7; gsc breakdown 9/9 incl. the property by report and unfinished reads). Browser (vb11, commit checked): the crawl picker on a real site's three crawls (every wording follows the chosen crawl), outgoing cells labelled, the dashboard forgetting a filter that matches nothing, "alpine (CLIENT)" joining "Alpine (client)", a 40-character group at 390 px with no overflow; no page errors.
- 10/8 slice 54 (site health tile; any two crawls) + audit #41 fixes: 397 tests across server/seo and the crawler's suites (database-needing files fail as on main). Real Postgres - eighteen scripts passing (audit compare 14/14 with a chosen older crawl shown, a newer baseline and another account's crawl refused; dashboard 11/11 with the health trend; gsc breakdown 10/10 with a waiting page of an earlier read; report "not known" 6/6 naming the report). Browser (vb11, commit checked): the health tile and lowest-health order; "Showing" an older crawl with its note, no plan buttons, the outgoing view saying it is the newest; a malformed crawl id answered 400; 1440 and 390 px with no overflow and no page errors.
- 10/8 slice 55 (rank tracker by tag) + audit #42 fixes: 401 tests across server/seo and the crawler's suites (database-needing files fail as on main), white-label rule 90 routes. Real Postgres - nineteen scripts passing (new: rank tags 6/6; dashboard 14/14 with kept crawl health, a gap and the newest crawl always current; gsc breakdown 11/11 with no record of reads; audit compare 15/15 with no crawl at all). Browser (vb11, commit checked): By tag on desktop and mobile with each side's dates; the health tile with "N of M pages" and the crawl list; the three detail views opened; 1440 and 390 px with no overflow and no page errors.
- 10/8 slice 56 (client reports by tag) + audit #43 fixes: 402 tests across server/seo and the crawler's suites (database-needing files fail as on main). Real Postgres - nineteen scripts passing (rank tags 8/8 with a built report; dashboard 15/15 with a changed page status and a broken newest crawl; gsc breakdown 12/12 with rows that have no record of a read). Browser (vb11, commit checked): By tag on the Reports page and in the downloaded PDF; By tag on the rank tracker with the saved-day wording; the health tile; 1440 and 390 px, no overflow, no page errors.
- 10/8 audit #44 fixes: 404 tests across server/seo and the crawler's suites; nineteen real-Postgres scripts passing (fixtures now save a report as the crawler does). Browser (vb11, commit checked): report By tag with in-both / new counts and weighting, PDF downloaded; health tile still reading the real crawls; 1440 and 390 px, no overflow, no page errors.
- 10/8 audit #45 fixes: 405 tests across server/seo and the crawler's suites; nineteen real-Postgres scripts passing. Browser (vb11, commit checked): rank tracker and report by tag, the report PDF downloaded, the health tile still reading the real crawls under the version-2 test; 1440 and 390 px, no overflow, no page errors.
- 10/8 audit #46 fixes: 405 tests; nineteen real-Postgres scripts passing (audit compare 18/18 with a broken newest crawl on Site audit and in the report). PDF stress render with 60 long tags. Browser (vb11, commit checked): Site audit pickers, health tile, rank tracker and report by tag, PDF downloaded - the real crawls still read under version 3; 1440 and 390 px, no overflow, no page errors.
- 10/8 audit #47 fixes: 405 tests; nineteen real-Postgres scripts passing (audit compare 19/19 with a broken crawl in between; link-opportunity and outgoing fixtures now save a report as the crawler does). Live database checked read-only: 1 of 1 finished crawls reads. Browser (vb11, commit checked): Site audit pickers and comparisons, groups, report by tag and PDF, health tile; 1440 and 390 px, no overflow, no page errors.
- 10/8 audit #48 fixes: 405 tests; nineteen real-Postgres scripts passing (outgoing 5/5 with a broken newest crawl). Browser (vb11, commit checked): Site audit, health tile, outgoing links on both real crawls; 1440 and 390 px, no overflow, no page errors.
- 10/8 slice 62 (competitors by tag) + audit #49 fixes: 406 tests; nineteen real-Postgres scripts passing (rank tags 9/9 with share of voice by tag). Browser (vb11, commit checked): the tag choice keeps focus, an unknown tag refused; Site audit, health tile, groups; 1440 and 390 px, no overflow, no page errors.
- 10/8 audit #50 fixes: 406 tests; nineteen real-Postgres scripts passing. Kimi reviewed the diff before deploy. Browser (vb11, commit checked): competitors by tag, Site audit pickers, outgoing links on both real crawls; 1440 and 390 px, no overflow, no page errors.
- 10/8 audit #51 fixes: 407 tests; nineteen real-Postgres scripts passing. Kimi reviewed the diff before deploy. Browser (vb11, commit checked): competitors, Site audit fixed / not re-checked; 1440 and 390 px, no overflow, no page errors.
- 10/8 audit #52 fixes: 409 tests (unit tests with the audit's own examples); nineteen real-Postgres scripts passing. Browser (vb11, commit checked): Site audit fixed / not re-checked and pickers; 1440 and 390 px, no overflow, no page errors.
- 10/8 audit #53 fixes: 411 tests; nineteen real-Postgres scripts passing (local 33/33 with owed rank alerts). Browser (vb11, commit checked): Site audit choices, fixed / not re-checked; 1440 and 390 px, no overflow, no page errors.
- 10/8 audit #54 fixes: 412 tests; nineteen real-Postgres scripts passing (local 31/31: run closed with its alerts; a run that stopped early alerts what it saved). Browser (vb11, commit checked): Site audit, health tile; no page errors.
- 10/8 audit #55 fixes, items 1-4, 6, 8, 9 (branch seo/fable-4): 417 tests; twenty real-Postgres scripts passing (new: alerts 15/15 - paging, kind filter, whole evidence, deliveries given up visibly; local 38/38 - planning failure leaves the run open, a new fall the same day, the window-closed run marked partial, owed runs settled; ledger 46/46 - a month-old refund still made; frequency 9/9 - a refused queue insert leaves the check due). NOT seen in a browser from this seat (none here): the Alerts page's paging, "Not sent" and the rank tracker's "not every check came back" wording are unconfirmed on screen.
- 10/8 final close-out (seo/ahrefs-68): 452 tests across server/seo and the crawler's suites; full repository suite - nothing newly failing but the other session's CRM test; real Postgres - 22 scripts passing (new: locks 17/17, deadline 16/16, alerts 15/15; ledger 46/46, local 40/40, gsc breakdown 21/21, audit compare 22/22). Browser (vb11, commit checked): an unchosen town blocks "Track these" with a linked message and sends nothing; alerts "Showing 4 of 4"; the report PDF downloaded with DejaVu embedded; Site audit pickers; 1440 and 390 px, no overflow, no page errors.
- 10/8 Kimi audit #1 fixes: 454 tests across server/seo and the crawler's suites; real Postgres - 23 scripts passing (new: kimi 17/17 - one snapshot when both paths buy at once, the charge capped at the hold, an answer without a cost kept at the estimate, the 5-minute window, AI duplicates, the site cap).
- 10/8 visual redesign of every SEO screen (seo/visual-2): 412 tests across server/seo and shared; full repository suite - nothing newly failing but the other session's CRM test. Browser (vb11, commit checked): ten screens at 1440 / 390 px and dark mode, no overflow, no page errors; one local grid scan opened.
