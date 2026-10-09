# Site audit — where every figure leads

Owner's rule (2026-10-09): every figure, label and row is a link that lands on its data with the narrowing applied,
and the view it lands on says so in a chip (`data-testid="active-filter"`) with a Clear link. That holds on all five
tabs — Issues, Pages, Internal links, Outgoing links and Rendering (tables below). Where no view holds a figure's rows
(the overview's "found but not read" counts, a website's links beyond the one example the crawl keeps), the link goes
to the closest view and its chip or title says so. Three dates and counts lead nowhere because nothing was saved
to open: a crawl still running ("N of up to M pages checked so far"), the start date of a crawl that failed, and the
finish date of a newest crawl that could not be read. Labels of buttons and of the crawl pickers' options are controls.

Addresses come from one place, `client/src/pages/seo/links.ts` → `seoLinks.audit(siteId, {...})`; a link to another
screen uses that screen's builder. Every link on the page keeps the crawl shown and compared with (`at`, `vs`) unless
it says otherwise. Each tab owns some narrowings (`OWNED` in audit.tsx): a link or a pick on a tab carries only that
tab's, and one that arrives for another tab is said in the chip ("Errors — narrows the Issues tab, not this one") with
a link that takes it there (`link-foreign-tab`); Clear drops it. Arriving by link, the chip shows at once — while the
crawl and the tab's rows are still being read — in the address's words, and the tab's own words replace it once read.

Every link is at least 44 px tall on a phone (`FIG` / `PILL` / `CHEVRON` / `TABS` in viz-audit.tsx) and takes the
surface's focus ring; a figure or a word that is a link shows a dotted underline without hovering (pills, tabs and
chevrons are drawn as controls); the five-tab strip and the severity strip wrap on a
phone instead of scrolling sideways out of sight. Files: `client/src/pages/seo/audit.tsx`, `audit-pages.tsx`,
`outgoing-links.tsx`, `link-opportunities.tsx`, `render.tsx`, `viz-audit.tsx`.

Guard: `server/seo/audit-links.test.ts` pins the source — the builder calls and data-testids listed here, that no
figure in the three link tabs is left as bare text in the places this doc names, and that nothing starts on arrival.
It is a source check, not a browser walk: it cannot prove that a figure added later is a link.

## Figures

| Figure | Where it goes (builder call) | Chip words |
|---|---|---|
| Health score ring, "Health score" label | `seoLinks.audit(site, { at, vs })` — the issues tab, every issue | none (nothing narrowed) |
| Health change ("Up 4 since the crawl before") | `seoLinks.audit(site, { at, vs: <compared crawl> }) + #audit-fixed` (or `#audit-not-rechecked`, else `#audit-compare`) — the comparison made explicit, scrolled to the Fixed / Not re-checked lists | none; the compare card reads "…against the crawl of <date>" |
| "Crawled <date>" | `seoLinks.audit(site, { at: <this crawl>, vs })` — keeps this crawl in the address | none |
| Pages crawled (the number and its label, `link-pages-crawled`) | `seoLinks.audit(site, { tab: "pages", at, vs })` | none |
| Status bar segment / legend: Working (2xx) | `seoLinks.audit(site, { tab: "pages", status: "2xx" })` | "Working pages (2xx)" |
| … Redirected (3xx) | `{ tab: "pages", status: "3xx" }` | "Redirected pages (3xx)" |
| … Not found / blocked (4xx) | `{ tab: "pages", status: "4xx" }` | "Not found or blocked pages (4xx)" |
| … Server error (5xx) | `{ tab: "pages", status: "5xx" }` | "Server-error pages (5xx)" |
| … Couldn't be checked | `{ tab: "pages", status: "unchecked" }` | "Addresses that couldn't be checked" + the sentence that the crawl saved no page for them (they have no row) |
| … Unusual answer (shown when > 0) | `{ tab: "pages", status: "unusual" }` | "Pages with an unusual answer (1xx, above 599, or none recorded)" |
| "N more addresses were found but not audited" (`link-excluded`) | `{ tab: "pages", status: "excluded" }` | "Addresses found but not audited" + why there is no row (files such as PDFs, links that leave the site) |
| "N more pages were found but not crawled" (`link-not-crawled`) and the crawl's limit (`link-page-cap`) | `{ tab: "pages", status: "beyond-limit" }` | "Pages found but not crawled" + the limit, and that there is no row |
| "N blocked by robots.txt" (`link-blocked`) | `{ tab: "pages", status: "blocked" }` | "Addresses blocked by robots.txt" + that there is no row |
| Errors / Warnings / Notices column (`button-severity-<s>`) | `seoLinks.audit(site, { severity: <s>, area })`; when already narrowed to it, the same without `severity` (toggle) | "Errors" / "Warnings" / "Notices" (+ " in <Area>" when an area is set) |
| "N affected" under a severity (`link-affected-<s>`) | `seoLinks.audit(site, { tab: "pages", severity: <s> })` — pages listed under an issue of that severity | "Pages with errors" / "…warnings" / "…notices" |
| Health over time: a point on the chart; the two dates in its sentence; each crawl in "Every crawl, as a list" | `seoLinks.audit(site, { at: <that crawl> })` | none |
| The row of crawl dates and scores under the chart (`link-trend-point-<crawl>`) — the chart's keyboard and touch way | `seoLinks.audit(site, { at: <that crawl> })` | none |
| "the list above" under the chart (`link-trend-list`) | the current address + `#audit-trend-list` — the list opens and scrolls into view (the keyboard and touch way to the chart's points) | none |
| By area: the area's name, its rating | `seoLinks.audit(site, { area: "<Area name>" })` | "Issues in <Area>" |
| By area: "not measured" on Performance | `seoLinks.audit(site, { tab: "rendering", area: "Performance" })` | "Why performance was not measured" + the explanation (the crawl's one-page PageSpeed check gave no score; the rendering check times one browser visit per page — a measurement, not a score) |
| By area: "not measured" on another area | `seoLinks.audit(site, { area: "<Area name>" })` | "Issues in <Area>" |
| "Showing" picker | `setParams({ at, vs: null })` — the address | none |
| "compared with" picker | `setParams({ vs })` | none |
| "Show that crawl" (compare card) / "Show the newest crawl" | `{ at: <compared crawl> }` / `seoLinks.audit(site, { tab })` | none |
| The crawl shown, by its date, wherever a sentence names it (the compare card, the "not the newest" notes) | `{ at: <this crawl> }`; the newest crawl's date → `seoLinks.audit(site, { tab })` | none |
| Compare card: "The first N of M" under each list | `#audit-page-changes` (the list) / M: `{ tab: "pages" }` for pages reached now, `{ at: <compared crawl> }` for pages no longer reached (the rest of that list was not kept) | none |
| Compare card counts: "N pages reached … and not in the crawl before" (`link-pages-added`), "N the other way round" (`link-pages-removed`) | the current address + `#audit-page-changes` — the list of those pages opens and scrolls into view | none |
| Pages reached now, not before (compare card) | `{ tab: "pages", page: <path> }` + ↗ to the live page | "One page opened: <path>" (or "<path> — not in this crawl") |
| Tabs: Issues / Pages / Internal links / Outgoing links / Rendering | `seoLinks.audit(site, { tab, at, vs })` | none |
| Severity tabs inside Issues (`tab-audit-<s>`) | current address with `severity` changed | as the columns |
| Area select | current address with `area: "<Area name>"` | "Issues in <Area>" |
| Issue row: chevron (`button-issue-<key>`), title (`link-issue-<key>`) | current address with `issue: <key>` (again to close) — the row opens with its affected pages, scrolled into view | "<Issue title> — its affected pages" |
| Issue row: Area cell | current address with `area: "<Area name>"` | "Issues in <Area>" |
| Issue row: Affected count, and "of N" under an open issue's list | `seoLinks.audit(site, { tab: "pages", issue: <key> })` — the crawled pages listed under it | "Pages listed under “<Issue title>”" |
| Open issue: "Showing the first N" | the current address + `#detail-issue-<key>` (the list) | as the open issue |
| Issue row: Change / "New" badge | current address with `issue: <key>, vs: <compared crawl>` | "<Issue title> — its affected pages" |
| Affected page inside an open issue | `{ tab: "pages", page: <path> }` + ↗ to the live page (an address on another site: ↗ only) | "One page opened: <path>" |
| Not re-checked this time / Fixed since: an issue | `seoLinks.audit(site, { at: <compared crawl>, issue: <key> })` — the issue as the earlier crawl found it | "<Issue title> — its affected pages" |
| Export, Export this list | stay buttons (a CSV file) | — |
| Step-by-step fix plan | `seoLinks.plan(site)` | — |
| Pages tab: tiles ("Nothing blocking Google", its footnote, "Pages nothing links to", "4 or more clicks deep", "Pages with little text") | current address with `show` = all / notIndexable / orphans / deep / thin | the pill's label ("Blocked from Google", "No links to it", "4+ clicks deep", "Little text") |
| Pages tab: pills (`filter-pages-<key>`) | current address with `show: <key>` | the pill's label |
| Pages tab: "By answer" pills (`filter-pages-status-<2xx…>`) — Working, Redirected, Not found / blocked, Server error, Unusual (when > 0) and Couldn't be checked | current address with `status` (again to clear) | as the status bar; "Couldn't be checked" adds that the crawl saved no page for them (the count is the overview's) |
| Pages tab: a pill or "By answer" pill with no pages | still a link (muted): it lands on the empty list | the pill's words, and the empty state says nothing matches |
| Pages tab: tile "Not measurable" (links between pages) | current address + `#pages-links-unmeasured` — the note on why | none |
| Pages tab: "N pages" over the table (`link-pages-count`) | current address + `#table-audit-pages` | the chip already above it |
| Pages tab row cells: Status, Clicks deep, Links to it, Words, Title, Description, Size | the cut the figure belongs to (`status: <class>`, `show: deep / orphans / thin / noTitle / noDescription`), else the row opened (`page: <path>`) | the cut's words, or "One page opened: <path>" |
| Pages tab row notes: "Blocked from Google: …", "Its canonical tag asks…", "Response not recorded" | `show: notIndexable` / `show: canonical` / `status: unusual` | the pill's words |
| Pages tab, open row: its title, and its headings / links / images counts (`link-page-counts-<path>`) | the live page ↗ (they are read in the page itself); no title → `show: noTitle` | — |
| Pages tab row: chevron (`link-page-row-<path>`) | current address with `page: <path>` — the row opens, scrolled into view | "One page opened: <path>"; a page this crawl has not got: "<path> — not in this crawl" and why, never "One page opened" |
| Pages tab row: the page's path | `seoLinks.explorer(domain, "pages", { path })` | (Site explorer's) |
| Pages tab, open row: "Listed under" issues | `seoLinks.audit(site, { issue: <key>, at, vs })` | "<Issue title> — its affected pages" |
| Pages tab, open row: "Open the page ↗" / "Its keywords and backlinks in Site explorer" | the live page / `seoLinks.explorer(domain, "pages", { path })` | — |

## Internal links tab (`tab=links`, link-opportunities.tsx)

| Figure | Where it goes (builder call) | Chip words |
|---|---|---|
| "From the crawl of <date>" (`link-link-opps-crawl`) | `seoLinks.audit(site, { tab: "pages" })` — the pages that crawl read | none |
| "your rank checks up to <date>" (`link-link-opps-checks`) | `seoLinks.rankTracker(site)` | (Rank tracker's) |
| "N places for a link", "the first N listed", "to N pages" | current address + `#table-link-opps` | none |
| "from N ranking keywords looked for" | `seoLinks.rankTracker(site)` | (Rank tracker's) |
| Left out: "N keywords did not rank" | `seoLinks.rankTracker(site, { band: "notFound" })` | (Rank tracker's: not found) |
| Left out: "ranks with a page the crawl did not reach", "too short to look for", "on more than half of the other pages" | `seoLinks.rankTracker(site)` — the keywords; no view lists which were left out, and the link's title says so | (Rank tracker's) |
| Left out: "ranks with a page that answered an error or a redirect or is marked noindex" | `{ tab: "pages", show: "notIndexable" }` | "Blocked from Google" |
| Left out: "ranks with a page more addresses redirect to than the crawl kept" | `{ tab: "pages", show: "redirected" }` | "Redirected" |
| Row: "On this page…", "…could link to", the words around the mention | `{ tab: "pages", page: <path> }` | "One page opened: <path>" |
| Row: the page's title under it | `seoLinks.explorer(domain, "pages", { path })` | (Site explorer's) |
| Row: the words, Position, the check it rests on (device, date, place) | `seoLinks.rankTracker(site, { keyword, device })` | (Rank tracker's) |
| Row: Volume | `seoLinks.keywords(keyword)` | (Keywords explorer's) |
| "N more were found than are listed" | `seoLinks.rankTracker(site)` — the list stops at the first found; the title says so | (Rank tracker's) |
| "N pages are cut where the crawl stops saving a page's text" | `{ tab: "pages" }` — which pages were cut is not recorded; the title says so | none |
| No keywords yet: "rank tracker" | `seoLinks.rankTracker(site)` (was a hand-written address) | — |
| Links not measurable: "Rendering" | `{ tab: "rendering" }` | none |
| `?page=<path>` arriving | that page's suggestions are outlined and scrolled to | "Page <path> — its N suggestions are outlined", or "— in none of these suggestions" and why |

## Outgoing links tab (`tab=outgoing`, outgoing-links.tsx)

| Figure | Where it goes (builder call) | Chip words |
|---|---|---|
| "From the crawl of <date>", "N pages that loaded" | `{ tab: "pages" }` | none |
| "N links", "N other websites" | current address + `#table-outgoing` | none |
| Heading counts: "Checked links that did not answer normally (N, M broken)" | current address + `#outgoing-broken` | none |
| "N of these websites' addresses were checked", "N page links were not checked" | current address + `#table-outgoing` (the table's last column says which) | none |
| Checked address | `seoLinks.explorer(<its website>)`, ↗ the live address | (Site explorer's) |
| Its answer in words ("404, gone…", "refused our check…") | the live address ↗ — what the check saw; open it to see what it does now | — |
| "linked from" pages / "and N more" | `{ tab: "pages", page: <path> }` / `{ tab: "pages" }` (the crawl keeps only the first few) | "One page opened: <path>" / none |
| Table: Website | `seoLinks.explorer(domain)` | (Site explorer's) |
| Table: Pages linking | `{ tab: "pages", page: <the example page> }` (the crawl keeps one example); no example → `{ tab: "pages" }` | "One page opened: <path>" |
| Table: Links | `seoLinks.explorer(domain, "backlinks")` | (Site explorer's) |
| Table: example page, its link text (or "no link text" / "not saved") | `{ tab: "pages", page: <path> }` | "One page opened: <path>" |
| Table: example address | the live address ↗ | — |
| Table: Checked / broken, "not checked" | current address + `#outgoing-broken` | none |
| "N more websites than are listed" | `{ tab: "pages" }` — the websites beyond the list are only counted; the title says so | none |
| `?page=<path>` arriving | the rows that start on that page are outlined and scrolled to | "Page <path> — its links are outlined", or "— no listed link starts on it" and why (only examples are kept) |

## Rendering tab (`tab=rendering`, render.tsx)

| Figure | Where it goes (builder call) | Chip words |
|---|---|---|
| "up to N" pages, and "Choose N pages or fewer" | current address + `#render-limit` — the note on why a check has a limit (Usage does not list it) | none |
| A suggested page: "its row" | `{ tab: "pages", page: <path> }` | "One page opened: <path>" |
| "up to $X: the price and your credit", "This needs $X … you have $Y" | `seoLinks.usage()` / `seoLinks.usage({ credits: "add" })` | (Usage's) |
| "Checked <date>" | `seoLinks.usage({ month: <its month> })` — the check and what it cost | (Usage's: the month) |
| "N of M pages were clearly different" | `{ tab: "rendering", result: "differ" }` + `#table-render` | "Pages clearly different once JavaScript ran" |
| "M pages" | `{ tab: "rendering" }` + `#table-render` | none |
| "N much the same", "N could not be compared" | `result: "same"` / `result: "unknown"` | "Pages much the same" / "Pages that could not be compared" |
| Row: the page | `{ tab: "pages", page: <path> }` (no crawl: the live page) | "One page opened: <path>" |
| Row: chevron, Result, Words (HTML / browser), Own-page links (HTML / browser), Main content painted, Loaded | current address with `page: <path>` — the visit's details open (again to close); every cell carries its label on a phone | "Page <path> — its visits below" |
| Details: Answer, Title / Main heading in the browser visit, Usable after, what the browser visit found | the live page ↗ | — |
| Details: Where the browser visit ended | that address ↗ | — |
| Details: Title / Main heading in the HTML, Images | `{ tab: "pages", page: <path> }` (no crawl: the live page) | "One page opened: <path>" |
| Details: Links to other sites | `{ tab: "outgoing" }` (no crawl: the live page) | none |
| No crawl yet: the check offered on its own | the same links; a row's figures write `tab=rendering&page=<path>`, so the address opens the visit | "Page <path> — its visits below" |
| A result saved under a name this page does not know | said as "Result not recognised (“…”)", never with a real outcome's words | — |

## Parameters honoured on arrival (`/seo/audit?…`)

| Parameter | What it narrows |
|---|---|
| `site` | the site shown; an address without one, or naming a site the account does not have, gets the site shown (replace, no history entry); a site picked on the page goes into the address (one history entry) and drops `at`, `vs`, `issue`, `page` in that same entry |
| `tab` | `issues` (default) \| `pages` \| `links` \| `outgoing` \| `rendering` |
| `severity` | issues tab: `error` \| `warning` \| `notice`; pages tab: the pages listed under an issue of that severity |
| `area` | issues tab: an area by name ("Content") or key ("content"); an area no issue is in still narrows, to nothing, and the chip says which. Rendering tab: `Performance` opens the note on why performance was not measured |
| `issue` | issues tab: that issue's row opens with its affected pages, scrolled into view (and is always listed, whatever `severity` / `area` say); one this crawl did not find is said so in the chip. Pages tab: the pages listed under it |
| `status` | pages tab: `2xx` \| `3xx` \| `4xx` \| `5xx` \| `unusual` cut as the overview counts them; `unchecked` (never loaded), `excluded` (found, not audited), `beyond-limit` (beyond the crawl's limit) and `blocked` (robots.txt) are the overview's counts — no row exists, the chip says so |
| `show` | pages tab: one of its pills — `notIndexable` \| `canonical` \| `errors` \| `redirected` \| `orphans` \| `deep` \| `thin` \| `noTitle` \| `noDescription` |
| `page` | pages tab: that page's row opens (always listed, brought within the rows shown, scrolled into view); not in this crawl → said so. Internal links / Outgoing links: its rows are outlined. Rendering: its visit's details open |
| `result` | rendering tab: `differ` (more or less) \| `more` \| `less` \| `same` \| `unknown` narrows the table (the page `page` opens stays listed); an unknown value is said so |
| `at` | the crawl shown (a crawl id; absent = the newest) |
| `vs` | the crawl compared with (absent = the one just before) |
| `#audit-fixed`, `#audit-not-rechecked`, `#audit-compare` | scrolled to once the crawl is on screen |
| `#audit-page-changes`, `#audit-trend-list` | the list opens, then is scrolled to |
| a narrowing for another tab | said in the chip of the tab shown, with a link to the tab that reads it; never silently ignored |

Nothing starts on arrival: a crawl only starts from the "Run new crawl" button.
