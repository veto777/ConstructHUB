# SEO dashboard — where every figure leads

Owner's rule (2026-10-09): every number, label and row on an SEO screen is a link that lands on its data with the
filter applied. Every address below comes from `client/src/pages/seo/links.ts` (`seoLinks.*`); the dashboard writes
no address of its own (`server/seo/dashboard-links.test.ts` pins that there is no hand-written `href="/…"`). Every
link is a wouter `<Link>` (middle-click and long-press open it in a new tab), at least 44 px tall (a label and its
number are one 54 px block link; text links are 44 px `inline-flex` boxes; bar segments are 44 px links with the
10 px bar drawn through the middle), and underlined without hover — a light underline in the text's own colour that
turns full on hover and focus, plus a focus ring (`LINK_CUE` / `TAP` / `FOCUS` in `viz.tsx`). Arriving by any of
these never buys data: the explorer shows the saved report or an Analyse button, the audit and the rank tracker what
is stored.

The dashboard honours `?sort=`, `?group=` and `?filter=` (`seoLinks.dashboard` / `seoLinks.dashboardSites`), re-read
whenever the address changes (`useAddress`), and lands on the list when the address ends in `#sites` — on arrival
and again when the back or forward button brings `#sites` back (`useHash`). The pickers write the same address with
`setParam`. The order and the group are also remembered on this computer for a visit with a bare address, and the
chip `data-testid="active-filter"` says the **effective** narrowing — whether it came by address or was remembered —
with one clear control (`button-clear-filter`) that goes back to all sites, as added, and forgets the remembered
choice too.

`s` is the site, `d` its domain, `r` its saved explorer report, `audit` its newest crawl. The "filter words" column
is what the landing page's `active-filter` chip reads for those parameters (the dashboard's own chip words are exact;
the explorer's, audit's and rank tracker's are those pages' wording for the same parameters, written where they land).

## Portfolio strip (shown with two or more sites)

| Figure | Where it goes | Filter words in the chip |
| --- | --- | --- |
| Sites (label and number, one link) | `seoLinks.dashboardSites({ group, sort, filter })` — the list below, as it is (scrolls to `#sites`) | whatever is already active |
| "N analysed" | `seoLinks.dashboardSites({ group, sort, filter: "analysed" })` | Analysed sites |
| "N crawled" | `seoLinks.dashboardSites({ group, sort, filter: "crawled" })` | Crawled sites |
| Average site health (label and score) | `seoLinks.dashboardSites({ group, filter, sort: "health" })` | Order: lowest site health first |
| "Of the N crawled sites [with a score]" | `seoLinks.dashboardSites({ group, filter: "crawled", sort: "health" })` | Crawled sites · Order: lowest site health first |
| "N crawled, no score yet" (crawled, none scored) | `seoLinks.dashboardSites({ group, sort, filter: "crawled" })` | Crawled sites |
| "No site crawled yet" | text — only when no site shown has a crawl | — |
| Tracked keywords (label and number) | `seoLinks.dashboardSites({ group, filter, sort: "keywords" })` | Order: most tracked keywords |
| "N in the top 10 in the newest checks" | `seoLinks.dashboardSites({ group, filter, sort: "top10" })` — each site's rank tracker is per site, so the list is ordered by top-10 count | Order: most keywords in the top 10 |
| "No check saved yet" / "No keyword tracked yet" | text — only when the count is zero | — |
| Organic traffic (label and number) | `seoLinks.dashboardSites({ group, filter, sort: "traffic" })` | Order: most search traffic |
| "Visits a month, N analysed sites added up" | `seoLinks.dashboardSites({ group, filter: "analysed", sort: "traffic" })` | Analysed sites · Order: most search traffic |
| "N analysed, no traffic figure yet" (analysed, no figure) | `seoLinks.dashboardSites({ group, sort, filter: "analysed" })` | Analysed sites |
| "No site analysed yet" | text — only when no site shown has a report | — |

A group chosen on the dashboard is carried in every strip link (`group` = the group's name, or `none`), and shows in the
chip as "Group: <name>".

## Group line (shown when a group is chosen: "<Group>: N sites · N tracked keywords · … · N open tasks")

| Figure | Where it goes | Filter words in the chip |
| --- | --- | --- |
| "N sites" | `seoLinks.dashboardSites({ group, sort, filter })` — the list | Group: <name> |
| "N tracked keywords" | `seoLinks.dashboardSites({ group, filter, sort: "keywords" })` | Group: <name> · Order: most tracked keywords |
| "N in the top 10 — each keyword's newest check on <device>, <dates>, N sites" (one link) | `seoLinks.dashboardSites({ group, filter, sort: "top10" })` — the dates and the site count have no view of their own; the list ordered by top-10 count shows each site's check date | Group: <name> · Order: most keywords in the top 10 |
| "N open tasks" with one site in the group | `seoLinks.plan(site.id, { status: "open" })` | Open tasks |
| "N open tasks" with several sites | `seoLinks.dashboardSites({ group, filter, sort: "tasks" })` — the plan is per site, so the list is ordered by open tasks | Group: <name> · Order: most open tasks |
| "open tasks not known" | text (the count could not be read) | — |

## Site card header

| Figure | Where it goes | Filter words in the chip |
| --- | --- | --- |
| Domain | `seoLinks.explorer(d)` — the overview | — |
| "analysed <date>" | `seoLinks.explorer(d)` | — |
| "not analysed yet" | text (Analyse is a button that buys a report) | — |
| "+ Group" / group name | stays a button, 44 px (edits the group) | — |
| Star | stays a button, 44 px | — |
| Site explorer pill | `seoLinks.explorer(d)` | — |
| Rank tracker pill | `seoLinks.rankTracker(s.id)` | — |
| Site audit pill ("· health N") | `seoLinks.audit(s.id)` | — |
| Action plan pill ("· N open") | `seoLinks.plan(s.id)` | — |
| Analyse / Refresh | stays a button (buys a report) | — |

## Site card figures (a site with a report)

| Figure | Where it goes | Filter words in the chip |
| --- | --- | --- |
| Health score (label and badge, one link) | `seoLinks.audit(s.id, { tab: "issues" })` | Issues |
| Health move since the crawl before | `seoLinks.audit(s.id, { at: audit.jobId, vs: prev.jobId })` | the two crawls compared |
| "N of M pages with errors" | `seoLinks.audit(s.id, { tab: "pages" })` | Pages |
| "crawled <date>" (also the date in "could not be read" / "no page scored") | `seoLinks.audit(s.id, { at: audit.jobId })` | Crawl of <date> |
| "the crawl before has no score" / "the crawl before scored N pages (limit …, now …)" | `seoLinks.audit(s.id, { at: prev.jobId })` | Crawl of <date> |
| "No crawl yet — run one in Site audit" | `seoLinks.audit(s.id)` | — |
| "Last N crawls": each row, date and health figure (one link) | `seoLinks.audit(s.id, { at: crawl.jobId })` | Crawl of <date> |
| Authority (label and number) | `seoLinks.explorer(d)` — the overview (the backlink profile) | — |
| Authority change | `seoLinks.explorer(d, "overview", { month: <first month shown> })` | Since <month> |
| "0–100, from the sites linking to it" | `seoLinks.explorer(d, "referringDomains")` | Referring domains |
| Authority sparkline: a point, or a month in "Months: … – …" | `seoLinks.explorer(d, "overview", { month })` | <month> |
| Referring domains (label and number) | `seoLinks.explorer(d, "referringDomains")` | Referring domains |
| Referring domains change | `seoLinks.explorer(d, "referringDomains", { month: <first month shown> })` | Referring domains · since <month> |
| "N backlinks" | `seoLinks.explorer(d, "backlinks")` | Backlinks |
| Referring domains sparkline: a point or a month | `seoLinks.explorer(d, "referringDomains", { month })` | Referring domains · <month> |
| Organic traffic (label and number) | `seoLinks.explorer(d)` — the overview (the traffic history) | — |
| Organic traffic change | `seoLinks.explorer(d, "overview", { month: <first month shown> })` | Since <month> |
| "Visits a month, estimated from rankings · value $X / mo" (one link) | `seoLinks.explorer(d, "keywords")` | Keywords |
| Organic traffic sparkline: a point or a month | `seoLinks.explorer(d, "overview", { month })` | <month> |
| Organic keywords (label and number) | `seoLinks.explorer(d, "keywords")` | Keywords |
| Organic keywords change | `seoLinks.explorer(d, "keywords", { month: <first month shown> })` | Keywords · since <month> |
| Organic keywords sparkline: a point or a month | `seoLinks.explorer(d, "keywords", { month })` | Keywords · <month> |
| Keyword distribution: Top 3 (bar segment and legend entry) | `seoLinks.explorer(d, "keywords", { band: "top3" })` | Keywords in the top 3 |
| Keyword distribution: 4–10 | `seoLinks.explorer(d, "keywords", { band: "top10" })` | Keywords in positions 4–10 |
| Keyword distribution: 11+ | `seoLinks.explorer(d, "keywords", { band: "rest" })` | Keywords below 10 |
| Tracked keywords (label and number) | `seoLinks.rankTracker(s.id)` | — |
| "On desktop · checked <date>" | `seoLinks.rankTracker(s.id, { device: rank.device })` | Desktop (or Mobile) |
| "No check saved yet — the first automatic check is due <date>; …" | `seoLinks.rankTracker(s.id)` | — |
| "None yet" | text (the "Add keywords" pill below is the link) | — |
| Tracked distribution: Top 3 | `seoLinks.rankTracker(s.id, { band: "top3" })` | Keywords in the top 3 |
| Tracked distribution: 4–10 | `seoLinks.rankTracker(s.id, { band: "top10" })` | Keywords in positions 4–10 |
| Tracked distribution: Below 10 or not found | `seoLinks.rankTracker(s.id, { band: "rest" })` | Keywords below 10 or not found |
| "Add keywords" (no keywords yet) | `seoLinks.rankTracker(s.id)` | — |
| "Over time" trend: a point of any series; the first and last month in the line above the chart; every month under "Months: … – …" | `seoLinks.explorer(d, "overview", { month })` | <month> |
| "Over time" series chips (Organic traffic, Organic keywords, Referring domains, Authority) | stay buttons, 44 px: they switch the chart | — |

Sparklines and the trend chart are decoration (`aria-hidden`); clicking a point is a shortcut. The keyboard and touch
route is the "Months: <first> – <last>" disclosure under each chart, whose entries are real 44 px anchors to the same
places.

## Site card without a report (the three start steps)

| Figure | Where it goes | Filter words in the chip |
| --- | --- | --- |
| Step 1 "Analyse — about $X" | stays a button (buys a report) | — |
| Step 2 "N tracked" (— checked every week by default) | `seoLinks.rankTracker(s.id)` | — |
| Step 2 "Open Rank tracker" | `seoLinks.rankTracker(s.id)` | — |
| Step 3 "Site audit" in "Crawled — the health score and its issues are in Site audit" | `seoLinks.audit(s.id)` | — |
| Step 3 "Open Site audit" (no crawl yet) | `seoLinks.audit(s.id)` | — |
| Step 3 health tile (crawled) | the same links as the Health score above | as above |
| Empty dashboard: "Site explorer" | `seoLinks.explorer("")` — the explorer with no domain | — |

Links to the audit, the rank tracker and the plan carry `?site=` (every SEO page honours it) and also make that site
the chosen site (`onSite`) before they are followed.

## Test ids of the links

Strip: `link-sites`, `link-sites-analysed`, `link-sites-crawled`, `link-health-average`, `link-health-scored`,
`link-tracked-total`, `link-top10-total`, `link-traffic-total`, `link-traffic-analysed` (a tile's label and number
are one block link; the label inside it keeps its old `…-label` id, e.g. `link-sites-label`); group line:
`link-totals-sites`, `link-totals-keywords`, `link-totals-top10`, `link-totals-tasks`; chip `active-filter`,
`button-clear-filter`; empty state `link-explorer-empty`. Card `<id>`: `link-domain-<id>`, `link-analysed-<id>`,
`link-health-<id>`, `link-health-move-<id>`, `link-health-pages-<id>`, `link-health-crawled-<id>`,
`link-health-before-<id>`, `link-health-audit-<id>`, `link-crawl-<id>-<n>` (newest first), `link-authority-<id>`,
`link-authority-change-<id>`, `link-authority-foot-<id>`, `link-domains-<id>`, `link-domains-change-<id>`,
`link-backlinks-<id>`, `link-traffic-<id>`, `link-traffic-change-<id>`, `link-traffic-value-<id>`,
`link-keywords-<id>`, `link-keywords-change-<id>`, `link-dist-keywords-<id>-top3|top10|rest` (legend) and
`link-dist-keywords-<id>-bar-top3|top10|rest` (segments), `link-tracked-<id>`, `link-tracked-checked-<id>`,
`link-tracked-due-<id>`, `link-dist-tracked-<id>-top3|top10|rest` and `-bar-…`, `link-add-keywords-<id>`,
`link-spark-<authority|domains|traffic|keywords>-<id>-month-<YYYY-MM>` (the months under each sparkline, in
`spark-…-<id>-months`), `link-trend-<id>-first|last` and `link-trend-<id>-<series>-month-<YYYY-MM>`,
`link-start-tracked-<id>`, `link-start-rank-<id>`, `link-start-audit-<id>`. The pills keep `link-explore-<id>`,
`link-rank-<id>`, `link-audit-<id>`, `link-plan-<id>`. `server/seo/dashboard-links.test.ts` pins these.
