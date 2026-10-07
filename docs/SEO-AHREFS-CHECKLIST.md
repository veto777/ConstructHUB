# SEO: the Ahrefs-equivalent checklist

Owner's instruction (2026-10-08): "build a fucking ahrefs". Target = the owner's Ahrefs screenshots (Projects dashboard,
Site Explorer overview + left menu, Organic keywords, Site Audit). This file is the accountability list: every line is a
thing a user must be able to do, marked DONE only when the code does it and it was checked. An auditor (Kimi) marks each
PASS / FAIL by reading the code and using the page. Do not mark anything DONE from intent.

Legend: DONE = built, tested and verified against live data · PART = works but thinner than Ahrefs · TODO = not built.

## A. Projects dashboard (`/seo`, client/src/pages/seo/dashboard.tsx)
- [x] DONE  A1  One card per site with authority, referring domains, backlinks, organic traffic (+ value), organic keywords, tracked keywords.
- [x] DONE  A2  Trend sparkline and change over the period on authority, referring domains, organic traffic, organic keywords.
- [x] DONE  A3  Opening the dashboard spends nothing (saved numbers only); "Analyse / Refresh" shows its price first.
- [ ] TODO  A4  Health score per site (needs Site Audit, section F).
- [ ] TODO  A5  Add competitors to a project; folders / starred / sort order.

## B. Site Explorer (`/seo/explorer`, explorer.tsx + report-table.tsx; server/seo/explorer.ts, reports.ts)
- [x] DONE  B1  Overview for any domain: authority ring, backlinks, referring domains, followed vs not, organic keywords / traffic / value, paid keywords / traffic.
- [x] DONE  B2  Performance chart (organic traffic, keywords, top-10 keywords) with selectable series.  PART: 6 months, Ahrefs shows years.
- [x] DONE  B3  Backlink growth chart: referring domains, backlinks, new and lost links per month, 12 months.
- [x] DONE  B4  Organic positions distribution and keywords by intent.
- [x] DONE  B5  Left menu of reports, each with filters, sort, paging (25/50/100), CSV export, saved for a day:
              Backlinks · New backlinks · Lost backlinks · Broken backlinks · Referring domains · Anchors · Best pages by links ·
              Organic keywords · Top pages · Organic competitors · Paid keywords.
- [x] DONE  B6  Organic keywords filters: position range, volume, difficulty, intent, keyword contains; sort by traffic / volume / position / difficulty / CPC.
- [x] DONE  B7  Tick keywords in a report and add them to the rank tracker.
- [ ] TODO  B8  Referring IPs, linking authors, outgoing links (linked domains, outgoing anchors), internal links.
- [ ] TODO  B9  Content gap inside the explorer (exists as the separate Competitors tab) and Link intersect.
- [ ] TODO  B10 Traffic by country; multi-year history; compare two dates.
- [ ] TODO  B11 Organic keywords history chart by position bucket (1–3, 4–10, 11–20 …) over time.
- [ ] TODO  B12 Paid ads copy and paid pages.
- [ ] TODO  B13 AI responses panel (ChatGPT, Gemini, Perplexity, AI Overviews).
- [ ] TODO  B14 Filter chips for URL / subdomain / exact-path scope ("Subdomains" selector).

## C. Keywords Explorer (`/seo/keywords`, keywords.tsx)
- [x] DONE  C1  Overview of one keyword: volume, difficulty, CPC with bid range, intent, result count.
- [x] DONE  C2  Search-volume trend by month across years.
- [x] DONE  C3  Who ranks today: top organic results with each site's authority, and a link to explore each site.
- [x] DONE  C4  What else is on the results page (map pack, people also ask, AI overview …).
- [x] DONE  C5  Matching terms, related terms and questions: filters, sort, paging, CSV, and "track on my site".
- [ ] TODO  C6  Bulk input (paste many keywords); saved keyword lists.
- [ ] TODO  C7  Other countries and languages (US English only today).
- [ ] TODO  C8  Clicks, traffic potential, parent topic.

## D. Rank tracker (`/seo/rank-tracker`, index.tsx)
- [x] PART  D1  Weekly positions per keyword on desktop and mobile with movement since the last check.
- [ ] TODO  D2  History chart per keyword and for the whole project (visibility, average position).
- [ ] TODO  D3  Tags and filtering by tag; competitors tracked on the same keywords; share of voice.
- [ ] TODO  D4  Local / map-pack positions by city.
- [ ] TODO  D5  SERP features won per keyword; scheduled email report.

## E. Billing of SEO data (shared/seo-credits.ts, server/seo/credits.ts, budget.ts)
- [x] DONE  E1  Every lookup charged at 4x wholesale, reserved then settled to the real cost.
- [x] DONE  E2  Plan allowance per month (Starter $10, Pro $20, Growth $40, Agency $40) then prepaid packs ($25 / $50 / $100).
- [x] DONE  E3  Price shown before every lookup; a saved page is never charged twice; out-of-credit refuses without running.
- [x] DONE  E4  Nothing sold inside the iPhone apps.
- [ ] TODO  E5  A usage history screen (what each lookup cost and when).

## F. Site Audit
- [ ] TODO  F1  Crawl a site; health score; errors / warnings / notices; issue list with change over time.
- [ ] TODO  F2  HTTP status distribution, depth, internal pages, indexability, links, redirects, content, performance reports.
              (ConstructHUB has a separate Site Scan tool; it is not yet shown in the SEO section or in the Ahrefs layout.)

## G. Other Ahrefs tools
- [ ] TODO  G1  Content Explorer.  G2  Brand Radar / AI visibility.  G3  Web Analytics.  G4  Alerts (new/lost links, new keywords).
- [ ] TODO  G5  Client-ready PDF reports and scheduled reports.  G6  Batch analysis of many domains.

## Verification log
- 2026-10-08: all 11 domain reports, 3 keyword lists, a filtered keyword report and the keyword overview were run against
  live data for alpineexteriorswa.com / "siding contractor" with zero failures (builder's own check, not an independent audit).
- 2026-10-08: Kimi audit could not run — the one Kimi account signed in on tower1 and vb11 had reached its weekly limit.
  NOT yet verified by the builder in a browser (no browser on vb11): layout and visual quality are unconfirmed.
