# Site Explorer — where every figure leads

Owner's order (2026-10-09): "Make sure every link and container actually takes you somewhere. Press Tracked
keywords or Referring domains and all that data should pop up. All data should take you somewhere!"

Screen: `client/src/pages/seo/explorer.tsx` (+ `report-table.tsx`, `viz-explorer.tsx`, `directories.tsx`). Addresses
come from the one builder, `seoLinks.explorer(domain, view, {…})` in `client/src/pages/seo/links.ts`; the words in an
address become a report's filters (and back) in the pure module `client/src/pages/seo/explorer-filters.ts`. The chip
the visitor reads on landing is `data-testid="active-filter"`, with a **Clear** control (`button-clear-filters`)
beside it — on a report view, on the overview (a month, two months compared, a chart figure, a first look) and on
Directories. Tests: `server/seo/explorer-links.test.ts` — every cell of every table is pinned there to its builder call.

Arriving with `?domain` never buys anything: the saved report opens, otherwise the **Analyse** button waits. A report
view opened by link with no overview built (`?domain=x&view=keywords&band=top3`) shows the report's own free look —
a saved page, or the "Run report" prompt with the filter already set. Directories opened by link looks for a saved
copy only; "Check the directories" is the one purchase.

Every link is thumb-sized (at least 44 px tall at 390 px: `Fig` / `FIG` in `viz-explorer.tsx`), shows it is a link
without a pointer over it (a light underline that darkens on hover) and shows a focus ring from the keyboard. A chart's
clicks are a picture: the months under each chart are a row of links, and the legend carries the distribution bar's.

## Every figure and where it goes

| Figure (overview) | Where it goes (builder call) | Chip words on landing |
| --- | --- | --- |
| Each headline figure's label (Authority, Backlinks, Referring domains, Organic keywords, Organic traffic, Paid keywords, Paid traffic — `link-*-label`) | the same place as its number (`Metric` in `viz-explorer.tsx`, thumb-sized; viz.tsx's MetricColumn link only underlines on hover) | — |
| Authority | `explorer(d, "backlinks")` — the backlinks view, whose note explains Authority is estimated from these links | — |
| Backlinks | `explorer(d, "backlinks")` | — |
| "N broken" | `explorer(d, "brokenBacklinks")` | — |
| Referring domains | `explorer(d, "referringDomains")` | — |
| "N IPs" | `explorer(d, "referringIps")` | — |
| Change beside Authority / Backlinks / Referring domains / Organic keywords / Organic traffic (`link-*-change`) | the figure's report with `{ month }` = the newest month of the series the change ends in | Aug 2026 picked on the chart — this list isn't split by month; it is ordered by “strongest sites” |
| The small chart under each of those five figures | a clicked point picks its month (`setParam("month")`); "Pick a month ›" under it lists the months as links, `explorer(d, "overview", { month })` (`spark-*-months-YYYY-MM`) | Aug 2026 picked on the chart — marked on both charts and opened in the comparison |
| Organic keywords | `explorer(d, "keywords")` | — |
| Distribution legend "Top 3" (the bar itself is a picture) | `explorer(d, "keywords", { band: "top3" })` | Keywords in the top 3 |
| Distribution "4–10" | `explorer(d, "keywords", { pos: "4-10" })` | Keywords in positions 4–10 |
| Distribution "11+" | `explorer(d, "keywords", { band: "rest" })` | Keywords from position 11 down |
| Organic traffic (estimate) | `explorer(d, "pages")` — the top pages carry the traffic | — |
| "worth $X / mo as ads" | `explorer(d, "paidKeywords")` | — |
| Since last month: up / down / new / lost | `explorer(d, "keywords", { move: "up" \| "down" \| "new" \| "lost" })` | Keywords that moved up since last month — the saved report counts them but doesn't list which, so every keyword is shown |
| Paid keywords | `explorer(d, "paidKeywords")` | — |
| Paid traffic; "No Google Ads seen" → "The ads list" | `explorer(d, "ads")` | — |
| "Est. cost $X / mo" | `explorer(d, "paidKeywords")` | — |
| Compare two months: each row's name | the measure's report (`pages`, `keywords`, `{ band: "top3" }`, `{ band: "top10" }`, `paidKeywords`, `referringDomains`, `backlinks`) | — / Keywords in the top 3 … |
| Compare two months: the From and To figures | the same report with `{ month }` = that column's month | Aug 2026 picked on the chart — this list isn't split by month; it is ordered by “…” |
| Compare two months: the Change | the same report with `{ month }` = the later month | as above |
| Compare two months: the From / To pickers | write `from` / `to` (`setParam`); "Hide the comparison" clears `from`, `to` and `month` | Comparing Aug 2025 with Aug 2026 |
| Organic positions rows 1–3 / 4–10 / 11–20 / 21–50 / 51–100 (label, count and bar are one link) | `{ band: "top3" }` / `{ pos: "4-10" }` / `{ pos: "11-20" }` / `{ pos: "21-50" }` / `{ pos: "51-100" }` on `keywords` | Keywords in the top 3 / Keywords in positions 4–10 / … |
| Referring domains: Followed / Not followed (label, count, share and bar are one link); "No referring domains" → "The list" | `explorer(d, "referringDomains", { followed: true \| false })` / `explorer(d, "referringDomains")` | Followed referring domains — shown as followed links, one per linking site (the referring-domains list can't be split by follow) |
| Backlinks by domain ending ".com" (label, count and bar) | `explorer(d, "referringDomains", { tld: ".com" })` | Referring domains ending .com (name contains “.com”) |
| Performance chart: the figure buttons (Organic traffic / Organic keywords / Keywords in top 10) | write `series` (`setParam`) — the figure shown is the address's | Chart figure: Organic keywords (on the overview's chip) |
| Performance chart: "The rows" links, one per figure (not only the one shown) | `explorer(d, "pages", { month })` / `explorer(d, "keywords", { month })` / `explorer(d, "keywords", { band: "top10", month })` — `month` only when one is picked | Aug 2026 picked on the chart — this list isn't split by month; it is ordered by “most traffic” (when a month is picked) |
| Backlink growth chart: the figure buttons; "The rows" links: Referring domains / Backlinks / New / Lost | `series`; `explorer(d, "referringDomains" \| "backlinks" \| "newBacklinks" \| "lostBacklinks", { month })` | Aug 2026 picked on the chart — this list isn't split by month; it is ordered by “strongest sites” (backlinks, referring domains) / “newest” (new links) / “most recently lost” (lost links) — the chip names the list's real order, the default or the address's `sort` |
| Either big chart's own figures: "Organic traffic: **12K in Oct 2025** → **15K in Sep 2026**" (`*-first`, `*-last`) and, with a month picked, that month's figure (`*-month-value`) | the first and last pick their month, `explorer(d, "overview", { month })`; the picked month's figure leads to that figure's rows for the month (as "The rows") | as for a clicked point / the rows' chip |
| A clicked point on either chart, or a month in the row of month links under it | `setParam("month", "YYYY-MM")` / `explorer(d, "overview", { month })` — the month is marked on both charts and "Compare two months" opens with it; "Clear" beside the chart's figure removes it | Aug 2026 picked on the chart — marked on both charts and opened in the comparison |
| Keywords-by-position chart legend / areas: "Positions 1–3" / "Positions 4–10" / "Position 11 and below" | `{ band: "top3" }` / `{ pos: "4-10" }` / `{ band: "rest" }` on `keywords` — the grey band is `keywords − top10`, everything from position 11 down, not capped at 100, and the panel says so | Keywords in the top 3 / Keywords in positions 4–10 / Keywords from position 11 down |
| Keywords-by-position chart: "Pick a month to compare ›" | `explorer(d, "overview", { month })` per month (`position-history-months-YYYY-MM`) | as for a clicked point |
| A card's title: Organic positions / Organic keywords by position / Organic keywords by intent; Referring domains / Backlinks by domain ending (`link-panel-*`) | `explorer(d, "keywords")` / `explorer(d, "referringDomains")` — the rows the card counts | — |
| Intent card's "of the top N keywords" (`link-intents-top`) | `explorer(d, "overview")` with the first look on Organic keywords — the N keywords the intents are counted from | — |
| Intent rows: the word, the Keywords count (with its bar) and the Traffic | `explorer(d, "keywords", { intent })`; an intent the list has no filter for leads to every keyword and the link's label says so | Commercial keywords |
| First-look tabs (Organic keywords / Top pages / Organic competitors / Referring domains / Anchors) | `explorer(d, "overview", { quick })` — the table shown is the address's; `keywords` is the default and is not written | First look: Top pages (on the overview's chip) |
| "Showing the **N keywords that bring the most traffic** of **M**" over the keywords first look (`link-keywords-shown`, `link-keywords-total`, then "Every keyword →") | `explorer(d, "keywords")` — the report, most traffic first | — |
| Quick table: a keyword | `seoLinks.keywords(keyword, marketParams(market))` — the country **and its language** | (keywords explorer) |
| Quick table: a keyword's Position | `explorer(d, "keywords", bandOfPosition(position))` — `{ band: "top3" }` for 1–3, `{ pos: "4-10" }`, `"11-20"`, `"21-50"`, `"51-100"`, `"101-"` | Keywords in positions 4–10 |
| Quick table: a keyword's Volume / Difficulty / CPC | `seoLinks.keywords(keyword, { section: "volume" \| "serp" \| "cpc" })` — the part of the keyword's page that explains the figure | (keywords explorer, scrolled to it) |
| Quick table: a keyword's Traffic | `explorer(d, "keywords", { path })` — the keywords of the page that earns it; with no page, `seoLinks.keywords(keyword, { section: "results" })` | On the page /path |
| Quick table: a keyword's Intent | `explorer(d, "keywords", { intent })` | Commercial keywords |
| Quick table: a keyword's page / a top page | `explorer(d, "pages", { path })` — the page itself behind the ↗ icon | On the page /path |
| Quick table: a page's Traffic (with its bar) / Keywords / In top 10 / Traffic value | `explorer(d, "keywords", { path })` / same / `{ path, band: "top10" }` / `{ path, sort: "cpc" }` (its keywords by ad price) | On the page /path · Keywords in the top 10 |
| Quick table: a competitor / its Shared keywords (with its bar) / Their keywords / Their traffic / Explore | `explorer(c)` / `explorer(c, "keywords", { why: "shared" })` / `explorer(c, "keywords")` / `explorer(c, "pages")` / `explorer(c)` — every one in the same country | — / Opened from a shared count: the list of what two sites share is in Content gap / Link intersect — this is the whole list |
| Quick table: a referring domain / its Authority / its Links / its Spam / its Follow / First seen | `explorer(r)` / `explorer(r, "referringDomains")` (the sites linking to it) / the links from it: `seoLinks.backlinks(siteId, { domain: r })` for a tracked site, else `explorer(d, "backlinks", { source: r })` / `explorer(r, "backlinks", { why: "spam" })` / `explorer(d, "referringDomains", { followed })` / `explorer(d, "referringDomains", { sort: "newest" })` | — / — / Opened from r: the links can't be narrowed to one linking site yet — every linking site is shown; the Linking page column names each / Opened from a spam score: no view lists spam scores — these are the site's own links, which the score is judged from / Followed referring domains — … / — |
| Quick table: an anchor / its Backlinks (with its bar) / its Referring domains / First seen | `explorer(d, "backlinks", { anchor })` / `{ anchor, everyLink: true }` / `{ anchor }` (one per site) / `{ anchor, sort: "newest" }` | Links with the anchor “…” (· Every link, not one per site) |
| An empty first look ("No ranking keywords…") | "The full report →" `explorer(d, view)` | — |
| Recently analysed: the domain, Authority / Referring domains / Organic keywords / Organic traffic, Analysed date | `explorer(r, "overview" \| "backlinks" \| "referringDomains" \| "keywords" \| "pages", { locationCode, languageCode })` — the row's own country **in full**, since it may not be the remembered one | — |
| Left menu | `explorer(d, view)` — each report is an address of its own (the last one's filters do not carry over) | — |
| "Track rankings", "My site", Refresh | unchanged (actions, not figures). "My site" and Explore open the other site as a new history entry (`navigate`), so Back returns | — |

Full report rows (`report-table.tsx`, every report view — every cell; `Ctx` carries the country and, for a tracked
site, its id):

| Row cell | Where it goes | Chip words |
| --- | --- | --- |
| Keyword | `seoLinks.keywords(keyword, marketParams(market))` | — |
| Position (keyword tables) | `explorer(d, "keywords", bandOfPosition(position))` | Keywords in positions 4–10 |
| Volume / Difficulty / CPC (keyword and ideas tables) | `seoLinks.keywords(keyword, { section: "volume" \| "serp" \| "cpc" })` | — |
| Traffic (keyword tables) | `explorer(d, "keywords", { path })` — the page's keywords; without a page `seoLinks.keywords(keyword, { section: "results" })` | On the page /path |
| Intent (keyword tables) | `explorer(d, "keywords", { intent })`; ideas tables: `seoLinks.keywords(keyword)` (a fact of the keyword, on its page) | Commercial keywords / — |
| Ad competition (ideas tables) | `seoLinks.keywords(keyword, { section: "cpc" })` | — |
| Page (keyword tables, Top pages) | `explorer(d, "pages", { path })`; the page itself behind ↗ | On the page /path |
| Top pages: Traffic / Keywords / In top 10 / Traffic value | `explorer(d, "keywords", { path })` / same / `{ path, band: "top10" }` / `{ path, sort: "cpc" }` | On the page /path (· Keywords in the top 10) |
| Competitor / Shared keywords / Their keywords / Their traffic / Avg. position / Explore | `explorer(c)` / `explorer(c, "keywords", { why: "shared" })` / `explorer(c, "keywords")` / `explorer(c, "pages")` / `explorer(c, "keywords", { sort: "position" })` / `explorer(c)` | — / Opened from a shared count … / — / — / — |
| Linking page (backlink tables) | `explorer(linkingSite)`; the page behind ↗ | — |
| Authority (backlink tables, referring domains) | `explorer(linkingSite, "referringDomains")` — the sites linking to it | — |
| Anchor (backlink tables) | `explorer(d, "anchors", { anchor })` | Anchors containing “…” |
| Links to (backlink tables) | the same report with `{ path }` — the links to that page | On the page /path |
| Follow (backlink tables / referring domains) | the same report with `{ followed }` / `explorer(d, "referringDomains", { followed })` | Followed links only / Followed referring domains — … |
| Spam (backlinks, new, broken, referring domains) | `explorer(linkingSite, "backlinks", { why: "spam" })` — no view lists spam scores; the site's own links are what the score is judged from | Opened from a spam score: … |
| First seen / Last seen (backlink tables, referring domains) | the same report with `{ sort: "newest" }` — its date order, named as the picker names it: newest first; for lost links, most recently lost | — |
| Referring domain / Site with similar links | `explorer(r)`; the site behind ↗ | — |
| Referring domains: Links to this site | `seoLinks.backlinks(siteId, { domain: r })` for a tracked site (picked out there); else `explorer(d, "backlinks", { source: r })` | — / Opened from r: the links can't be narrowed to one linking site yet — … |
| Anchor (Anchors report) / Backlinks / Referring domains / First seen | `explorer(d, "backlinks", { anchor })` / `{ anchor, everyLink: true }` / `{ anchor }` / `{ anchor, sort: "newest" }` | Links with the anchor “…” (· Every link, not one per site) |
| Best pages by links: page / Referring domains / Backlinks / Page authority / Broken / First seen | `explorer(d, "backlinks", { path })` / same / `{ path, everyLink: true }` / same / `explorer(d, "brokenBacklinks", { path })` / `{ path, sort: "newest" }` | On the page /path (· Every link, not one per site) |
| Referring IPs: IP address | no report of its own exists, so it stays as it is (a builder never invents a place) | — |
| Referring IPs: Linking sites on it / Links / First seen | `explorer(d, "referringDomains", { why: "ip" })` / `explorer(d, "backlinks", { why: "ip" })` / `{ why: "ip", sort: "newest" }` — the whole lists | Opened from a server address: no view lists the sites on one address — this is the whole list |
| Sites with similar links: Linking sites in common / Explore | `explorer(r, "referringDomains", { why: "shared" })` / `explorer(r)` | Opened from a shared count … |
| Subdomain / its Traffic / Keywords / In top 3 / In top 10 / Traffic value | `explorer(sub)` / `explorer(sub, "pages")` / `explorer(sub, "keywords")` / `{ band: "top3" }` / `{ band: "top10" }` / `{ sort: "cpc" }` | — / Keywords in the top 3 / … |
| Ads: Advertiser / Kind / First shown / Last shown / "See the ad" | Google's own page for the ad (external, as before) — there is no view of ours behind an ad | — |
| Sort picker | writes `sort` (the default is no word); a date cell lands on `sort=newest` | — |
| "Show the whole site" (under the scope line and in the empty state) | clears the scope on the page **and** in the address (`path`, `section`) | — |

Directories (`directories.tsx`, Site Explorer → Directories):

| Figure | Where it goes | Chip words |
| --- | --- | --- |
| A competitor chip above the table; a site in a column head; a directory's name | `explorer(site)` — the site behind ↗ | — |
| "linked from **N** of these **M**" / "**N** that link to a competitor and not to you" | `explorer(d, "directories", { rivals, only: "linked" \| undefined \| "gaps" })` | Directories that link to d · N of M / — / Directories that link to a competitor and not to you · N of M |
| A kind's heading (Review sites, …) | `{ only: kind }`; on that kind, "every kind →" clears it | Review sites only · N of M |
| A count ("3 links" / "linked") and a dash ("no link found") | the links from that directory: `seoLinks.backlinks(siteId, { domain: dir })` for the tracked site, else `explorer(site, "backlinks", { source: dir })` | — / Opened from dir: the links can't be narrowed to one linking site yet — … |
| "Link to check ›" badge (the badge sits in a thumb-sized link) | `{ only: "gaps" }` | Directories that link to a competitor and not to you |
| "Check these sites" | writes `rivals` (the competitors, or `none` for this site alone) and clears `only`; the comparison is then a link and the back button undoes it | — |

## Parameters the explorer honours on arrival

| Parameter | What it narrows |
| --- | --- |
| `domain` | The site. The saved report opens (free) or the Analyse button waits; nothing is bought. |
| `view` | The report opened (a key from the left menu); anything else is the overview. |
| `locationCode`, `languageCode` | The country (and its language) of the report — the market picker follows them, and writes them when changed (United States / English is written as nothing, the default). "United States (Spanish)" is 2840 + es. |
| `band` | `keywords`: position filter — `top3` 1–3, `top10` 1–10, `top20` 1–20, `top50` 1–50, `top100` 1–100, `rest` 11 and below; `notFound` lists nothing extra and the chip says so. |
| `pos` | `keywords`: a position range the bands don't say — `"4-10"`, `"11-20"`, `"21-"` (from 21 down). Wins over `band`. |
| `intent` | `keywords`: informational / navigational / commercial / transactional. |
| `followed` | Backlink tables (`backlinks`, `newBacklinks`, `lostBacklinks`, `brokenBacklinks`): follow filter. On `referringDomains` the rows shown are links one per linking site with that filter, and the chip says so (the referring-domains list has no follow split on the server); a `tld` sent with it is not applied, and the chip says that too. |
| `tld` | `referringDomains`: domain-contains filter on the ending (".com" — the chip says it is a name match). |
| `anchor` | `backlinks` / `newBacklinks` / `lostBacklinks` / `anchors`: anchor-contains filter. |
| `contains` | The report's own "contains" box (keyword, URL, domain) when it is not an anchor or an ending. |
| `volumeMin`, `difficultyMax` | The keyword tables' number boxes. |
| `everyLink` | `backlinks`, `newBacklinks`, `lostBacklinks`: every link rather than one per site. `brokenBacklinks` has no such choice (the server's own list): one link per site is shown, and the chip says so. |
| `path` | The report narrowed to that one page exactly (keywords, paidKeywords, pages, backlink tables, bestByLinks). An address not on this site narrows nothing. |
| `section` | The report narrowed to a path and everything under it. `path` wins. |
| `sort` | The report's order — a key the report lists (`newest`, `authority`, `position`, `cpc`, …); anything else is the default. The sort picker writes it. |
| `month` | Overview: the month marked on the Performance and Backlink growth charts and opened in "Compare two months"; said in the overview's chip. On a report: said in the chip with the list's real order — the lists are not split by month. A value that is not a month (YYYY-MM) is said as such on the overview and ignored on a report. |
| `from`, `to` | Overview: the two months compared (the pickers write them); said in the chip. |
| `series` | Overview: the figure shown on the chart — `traffic` / `keywords` / `top10` (Performance), `domains` / `backlinks` / `new` / `lost` (Backlink growth); a key the other chart owns shows that chart's first figure. Said in the chip; a key that names nothing is said too. |
| `quick` | Overview: the first-look table — `keywords` (the default, never written) / `pages` / `competitors` / `referringDomains` / `anchors`. Said in the chip. |
| `move` | `keywords`: said in the chip — the saved report counts up / down / new / lost but does not list which keywords; every keyword is shown. Cleared when filters are applied on the page. |
| `source` | Backlink tables: the linking site a count was opened from. The list cannot be narrowed to it yet, so every linking site is shown and the chip says so. |
| `why` | `spam` / `ip` / `shared`: the figure a link came from when no view holds it; the chip says what the list is instead. Cleared by Clear and by "Apply filters". |
| `rivals`, `only` | Directories: the competitors compared (comma-separated, or `none` for this site alone) and the table's narrowing (`gaps` / `linked` / `reviews` / `trade` / `maps` / `business` / `social`), said in its chip. |

On-page changes write the same words back (`setParams`, one history entry per "Apply filters", per picked sort, per
picked month, per first-look tab, per compared month): a picked position range becomes `band` when a band says it and
`pos` otherwise; an anchor box becomes `anchor`; a ".com" typed in the referring-domains box becomes `tld`; a scope
becomes `path` (this page only) or `section`, and "Show the whole site" removes them. **Clear** on a report removes
every filter word, `month`, `source` and `why`; **Clear** on the overview removes `month`, `from`, `to`, `series` and
`quick`; **Clear** on Directories removes `only`. The market picker writes the new country (`locationCode` +
`languageCode`, nothing for the default) and clears the view and every filter; a new domain is a new address and a new
history entry (another site is another address, and Back returns to the last one).
