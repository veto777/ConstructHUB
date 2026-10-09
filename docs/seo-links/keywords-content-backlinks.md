# Where every figure leads — Keywords explorer, Content explorer, Backlinks (and Content gap, Link intersect, Opportunities)

Owner's rule (2026-10-09): *every link and container takes you somewhere; all data takes you somewhere.* The addresses are
written in one place, `client/src/pages/seo/links.ts` (`seoLinks.*`); the pages honour the parameters named there, show
what narrowed them in a chip (`data-testid="active-filter"`) with a clear control, and write the address when a filter
is picked on the page (a link and a picked filter are the same thing; the back button undoes either). Arriving by link
never buys: `?keyword` opens the saved overview or the **Look up** button, `?q` the saved content page or the **Search**
button, `?competitors` the saved comparison or **Run comparison**, `?opp` the saved opportunities or **Find
opportunities**, and the backlinks page shows the snapshot on file — **Refresh now** is the only purchase there.

New links carry `data-testid="link-<figure>"`; every earlier test id is kept. Colours are unchanged: blue wording, orange
graphs, green / red only for a change (better / worse), green / amber / red for difficulty.

The look of a link (`viz-keywords.tsx`): `LINK_CUE` is a dotted blue underline that shows without hovering (solid on
hover and on keyboard focus, with a blue focus outline); `TAP` gives an inline link 14 px of padding above and below, so
its hit area is 44 px tall at 390 px without moving the line; `BLOCK_LINK` is a 44 px block link for a bar, a badge or a
cell whose words are cut short (the cut is on a span inside it, so `truncate` cannot clip the hit area). Pills that are
tapped are `g-pill--sm !min-h-11` (44 px); selects are the 40 px `g-input g-select`; chips are shell.tsx's `ActiveFilter`
(40 px). Charts that take a click have a keyboard / touch route beside them (the month picker under the monthly bars; the
DistributionBar's legend). The distribution bar's own 44 px segments come with the dashboard round's `viz.tsx`.

Tests: `server/seo/links.test.ts` pins the addresses below (including `followed=false`);
`server/seo/keywords-content-backlinks-links.test.ts` is the source guard for the figures, the address reads / writes,
the honest words and the 44 px sizes.

## Keywords explorer (`/seo/keywords`)

### Parameters honoured

| parameter | what it narrows |
|---|---|
| `keyword` | the keyword on screen; a change (a link to another keyword) opens its saved overview or the Look up button |
| `view` | `one` (default) \| `bulk` (Many keywords) \| `area` (Service × town) \| `lists` (My lists) — the view tabs are links |
| `table` | selects and scrolls to the ideas table: `matchingTerms` (default) \| `relatedTerms` \| `questions` — the ideas tabs are links |
| `locationCode` + `languageCode` | the country looked up in; the country picker writes them on **every** view (One keyword and Many keywords), a list's keyword carries its list's country |
| `section` | scrolls to one part of the overview: `volume` \| `serp` (Who ranks) \| `features` \| `ideas` \| `cpc` and `results` (both land on Who ranks — the chip says why) |
| `month` | `YYYY-MM`: that month's bar is drawn in the deep orange, named in the chart's note, and the page scrolls to the chart (also without `section`) |
| `intent` | one of informational \| navigational \| commercial \| transactional (anything else is ignored): the ideas table's Intent filter. The ideas table is `ReportView` with `linked`, so it reads `intent` (and its other filter words) from the address and writes them on **Apply filters**. Only `matchingTerms` and `questions` have an Intent box; the page's chip `Matching terms with commercial intent` shows only there |
| `list` | the open list under My lists; the list buttons are links |
| `topic` | groups a list's or an analysis's keywords by topic: `*` every group, a term that group only, `other` the keywords in no group; "Group by topic" / "Ungroup" are links that write it |
| `show` | Service × town: only the cells a tile counts — `gaps` \| `weak` (beyond the first three) \| `strong` (in the first three) \| `unknown` |

Chips: `Looked up in <country>`; the section's words; `N searches in Mon YYYY` (or `No figure for Mon YYYY`);
`Keyword ideas: Related terms`; `Matching terms with <intent> intent`; `Topic: <term> — N keywords · …` (or `No topic "x"
among these keywords — every group is shown`); `List: <name> · <country>` for a list other than the first, `List #N isn't
one of your lists (deleted, or another account's) — showing "<first>"` for one that doesn't exist (clear: **Back to the
first list** — with no `list` the first list is what opens, so the clear says so rather than "Close"); `<tile words> — N of
M cells` (clear: **Every cell**). The ideas table also shows its own chip (report-table.tsx); its **Apply filters** writes
the explorer filter words and so drops `section`, its **Clear** also drops `month` — both only narrowed the overview.

### Figures and where they go

| figure | where it goes (builder call) | chip words |
|---|---|---|
| "as of" date beside the keyword | `seoLinks.usage({ month })` — that month's lookups (`link-keyword-as-of`) | Usage's own |
| Price in the cost line | `seoLinks.usage()` (`link-keyword-price`) | — |
| Search volume (number, sparkline) | `seoLinks.keywords(kw, { section: "volume" })` | `Search volume by month for "kw"` |
| Peak N in Mon YYYY | `seoLinks.keywords(kw, { section: "volume", month })` | `N searches in Mon YYYY` |
| A month's bar (click) / the Month picker under the chart (keyboard) | `{ section: "volume", month }` written to the address | as above |
| "Mon YYYY marked: N searches" (chart note) | the same address (`link-volume-marked`) | as above |
| Difficulty badge / top pages' referring domains | `seoLinks.keywords(kw, { section: "serp" })` | `Who ranks for "kw"` |
| Cost per click / bids / ad competition | `{ section: "cpc" }` — nothing holds the bids, so it lands on Who ranks | `Cost per click $X has no view of its own — this is who ranks for "kw"` |
| Intent | `{ section: "ideas", table: "matchingTerms", intent }` (intent only when it is one of the four) | `Matching terms with <intent> intent` — and the rows are narrowed |
| N results | `{ section: "results" }` | `N results on Google — the top ten as saved` |
| Traffic potential / parent topic note | `{ section: "ideas", table: "relatedTerms" }` | `Keyword ideas around "kw"` + `Keyword ideas: Related terms` |
| Parent topic | `seoLinks.keywords(parentTopic, marketParams(market))` | — (another keyword) |
| Results-page feature tags | `{ section: "serp" }` | `Who ranks for "kw"` |
| Tracked keyword | `seoLinks.rankTracker(site.id, { keyword })` (`link-features-tracker`, `link-tracked-keyword`) | rank tracker's own |
| Who ranks: # (place) | `seoLinks.explorer(domain, "keywords", { contains: kw })` — that site's organic keywords narrowed to the search (`link-serp-position-N`) | Site explorer's own |
| Who ranks: "as saved on" date | `seoLinks.usage({ month })` (`link-serp-saved-on`) | Usage's own |
| Who ranks: title | external | — |
| Who ranks: domain / Explore site | `seoLinks.explorer(domain)` | Site explorer's own |
| Who ranks: site authority | `seoLinks.explorer(domain, "referringDomains")` | Site explorer's own |
| Ideas tables (rows, filters) | `report-table.tsx`, `linked` | report-table's chip |

Many keywords / My lists (`keyword-lists.tsx`, one table for both):

| figure | where it goes | chip words |
|---|---|---|
| keyword | `seoLinks.keywords(kw, marketParams(market))` | — |
| volume (number and bar) | `{ ...market, section: "volume" }` | `Search volume by month for "kw"` |
| difficulty | `{ ...market, section: "serp" }` | `Who ranks for "kw"` |
| CPC (`link-keyword-cpc`) | `{ ...market, section: "cpc" }` | the CPC chip |
| Intent (`link-keyword-intent`) | `{ ...market, section: "ideas", table: "matchingTerms", intent }` | `Matching terms with <intent> intent` |
| Group by topic / Ungroup | this view with `topic: "*"` / without `topic` | — |
| a topic's term | `seoLinks.keywords(term, market)` (`link-topic-term`) | — |
| a topic's "N keywords · N searches a month" | this view with `topic: term` (or `other`) (`link-topic-rows`) | `Topic: <term> — …` |
| a list in the side list (name, count) | `seoLinks.keywords("", { view: "lists", list })` | `List: <name> · <country>` |
| the open list's "N keywords" / "N searches a month" | its own address / the same with `topic: "*"` (`link-list-count`, `link-list-volume`) | — / topics |
| Many keywords: "as of" date; price | `seoLinks.usage({ month })` (`link-bulk-as-of`); `seoLinks.usage()` (`link-bulk-price`) | — |

Not a link, said here: the bulk analysis's "N of M keywords have numbers" and its "no numbers for N keywords" — the
pasted keywords (up to 200) are not put in the address, so that analysis has no address of its own; its rows are the
table right under the count.

Service × town (`planner.tsx`):

| figure | where it goes | chip words |
|---|---|---|
| Gaps / Beyond the first three / In the first three / Nothing known (number and foot) | `seoLinks.keywords("", { view: "area", show })` | `<tile words> — N of M cells` |
| a cell's searches a month (bar) (`link-cell-keyword`) | `seoLinks.keywords("service town", { ...siteMarket, section: "volume" })` | `Search volume by month …` |
| a cell's position badge / "Gap" (`link-cell-position`) | `seoLinks.explorer(domain, "keywords", { contains: "service town" })` — the keyword database the position comes from | Site explorer's own |
| a cell's "Rank tracker" (only when tracked) | `seoLinks.rankTracker(site.id, { keyword })` | — |
| selecting a cell | its own checkbox (44 px), not the figures | — |
| "N services × M towns" / domain / "as of" date / price | `{ view: "area" }` (every cell) / `seoLinks.explorer(domain)` / `seoLinks.usage({ month })` / `seoLinks.usage()` | — |
| legend: 1–3 / 4–10 / 11–100 / Gap / — | `show` strong / weak / weak / gaps / unknown — 4–10 and 11–100 are one tile, and the title says so | `<tile words> — …` |

## Content explorer (`/seo/content`)

### Parameters honoured

| parameter | what it narrows |
|---|---|
| `q` | the search; a change opens its saved page or the Search button |
| `sort` | `relevance` (default) \| `authority` \| `newest` |
| `since` | published in the last 30 \| 90 \| 365 \| 730 days |
| `authority` | lowest site authority: 10 \| 20 \| 30 \| 50 \| 70 |
| `kind` | `blogs` \| `news` \| `organization` \| `message-boards` \| `ecommerce` |
| `offset` | the page of results (0, 25 … 950); Previous / Next are links that write it, a filter change goes back to the first page |

Each control (all 40 px selects) writes its parameter; each active one is a chip: `Strongest sites first` / `Newest
first`, `Published in the last 3 months`, `Site authority 30 or more`, `Blogs only`. "Leave out <site>" and "Order these
pages by" stay on-page state (they order or trim the page on screen; they are not the search).

### Figures and where they go

| figure | where it goes (builder call) | chip words |
|---|---|---|
| "N matches across the web" | `seoLinks.content(q, filters)` — the first page of these results (`link-content-total`) | the filters' chips |
| "showing 1–25 · as of date" | this page's own address, `offset` included (`link-content-showing`) | — |
| Prices | `seoLinks.usage()` (`link-content-price`, `link-content-page-price`) | — |
| Title | external | — |
| Domain | `seoLinks.explorer(domain)` | Site explorer's own |
| "published Mon D, YYYY" | this search with `since` = the shortest window that holds the date; older than two years: `sort: "newest"` (`link-content-published`) | `Published in …` / `Newest first` |
| Snippet | `seoLinks.explorer(domain, "pages", { path })` — that page (`link-content-snippet`) | Site explorer's own |
| Authority | `seoLinks.explorer(domain, "referringDomains")` | Site explorer's own |
| Linking sites | `seoLinks.explorer(domain, "backlinks", { path })` — the backlinks to **that page**, one per site | Site explorer's own |
| Estimated US search visits / mo | `seoLinks.explorer(domain, "pages", { path })` | Site explorer's own |

`path` is the page's path **with its query string** (`explorer-filters.ts` `pathOfUrl`); when the address isn't a page of
that domain, the link opens the whole site's view and its title says so. The author is a name, not a figure.

## Backlinks (`/seo/backlinks`)

### Parameters honoured

| parameter | what it narrows |
|---|---|
| `site` | picks the site (one of the account's); the site picker writes it |
| `section` | `lost` scrolls to Lost backlinks; `strongest` to the strongest linking pages; `new` scrolls there and keeps only links first seen in this snapshot; `all` scrolls there with nothing narrowed |
| `domain` | only the links from that site, in both lists; each row offers `only this site` (`link-lost-only`, `link-page-only`) |

Chips: `Links from example.com`, `New links in this snapshot (N)`, `Lost backlinks since <date>`, `Strongest linking pages`.

### Figures and where they go

| figure | where it goes (builder call) | words when the view is only the closest |
|---|---|---|
| "Snapshot from <date>" | `seoLinks.backlinks(site.id, { section: "all" })` | — |
| "compared with <date>" | `{ section: "lost" }` — what changed since it (with no changes kept: the page, whose paler bars are its totals) | the title says the earlier snapshot keeps only its totals |
| "next automatic snapshot <date>" | `seoLinks.usage()` | the title says nothing lists it yet; once taken it shows there |
| Domain rank (number, bars, change) | `seoLinks.explorer(site.domain)` | — |
| Backlinks (number, bars, change) | `seoLinks.explorer(site.domain, "backlinks")` | — |
| +N new / −N lost (30 days) | `"newBacklinks"` / `"lostBacklinks"` | — |
| Referring domains (number, bars, change) | `"referringDomains"` | — |
| Referring domains +N new / −N lost | `"referringDomains"` — no view lists the new or lost referring domains | the line itself says `no list holds just these; both open every referring domain` |
| Referring pages (number, bars, change) | `"backlinks"` | — |
| Spam score (number, bars, change) | `"referringDomains"` — the site's spam score has no view; its referring domains each carry their own | title: `has no view of its own — this opens its referring domains, each with its own spam score` |
| N broken backlinks | `"brokenBacklinks"` | — |
| A change beside a figure (`link-*-delta`) | the figure's own view — the earlier snapshot keeps only totals | title says so |
| dofollow / nofollow (legend, segments, the two words, a row's Follow, a lost row's "· nofollow") | `"referringDomains", { followed: true \| false }` — `qs()` keeps `false`, so `followed=false` narrows to the nofollow rows | title: of the pages listed; the list below isn't split by follow |
| "Of the N pages listed" | `seoLinks.backlinks(site.id, { section, domain })` | — |
| Lost: "The N strongest" / "of M sites with a lost link" / "N other sites have one" | `{ section: "lost" }` / `"lostBacklinks"` / `{ section: "lost" }` | — |
| Lost heading's "since <date>" | `{ section: "lost" }` | — |
| Lost row: site / authority | `seoLinks.explorer(thatDomain)` / `(thatDomain, "referringDomains")` | — |
| Lost row: Spam | `"referringDomains", { contains: thatDomain }` — its row among the site's referring domains, with its spam score | title: listed there only while it still links |
| Lost row: the page that linked | external | — |
| Lost row: Linked to | `"pages", { path }` (query kept; the site's pages when it isn't a page of the site, and the title says so) | — |
| Lost row: Last seen | `"lostBacklinks"` — each lost link with its date | title: that list is not split by site |
| Strongest row: site / "· new" / page | `seoLinks.explorer(domainFrom)` / `seoLinks.backlinks(site.id, { section: "new" })` / external | — |
| Strongest row: Anchor / "(none)" | `"anchors", { anchor }` / `"anchors"` | — |
| Strongest row: Links to | `"pages", { path }` | — |
| Strongest row: Domain rank | `seoLinks.explorer(domainFrom, "referringDomains")` | — |
| Strongest row: Spam | `"referringDomains", { contains: domainFrom }` | — |
| Strongest row: First seen | `"newBacklinks"` for a new link, else `"backlinks"` — each with its date | title says so |

## Inside the Site explorer

### Content gap and Link intersect (`gap.tsx`)

The comparison is the address: `competitors` "a.com,b.com" (up to three; anything that isn't a domain, the site itself or a
fourth is left out and the chip says so). It is read on arrival (the saved comparison opens, or **Run comparison**
waits) and written by **Compare**. Chip: `Content gap: <site> compared with a.com, b.com` (clear: **Start over**).

| figure | where it goes | words when the view is only the closest |
|---|---|---|
| "N keywords" / "1–50 of N sites" | this comparison's own address (`link-gap-count`) | — |
| "as of" date / prices | `seoLinks.usage({ month })` / `seoLinks.usage()` | — |
| keyword / volume / difficulty / CPC | `seoLinks.keywords(kw, market)` / `{ section: "volume" }` / `{ section: "serp" }` / `{ section: "cpc" }` | CPC: no view lists the bids |
| intent | `{ section: "ideas", table: "matchingTerms", intent }` | — |
| a competitor's position (with or without a page) | `seoLinks.explorer(competitor, "keywords", { contains: kw })`; the page it ranks with is the ↗ beside it | — |
| Their traffic | the best-placed competitor's keyword list narrowed to the search | title: the figure is all of them together; that list holds its share |
| Link intersect: site / authority | `seoLinks.explorer(domain)` / `(domain, "referringDomains")` | — |
| Links to <competitor> (0 included) | `seoLinks.explorer(competitor, "referringDomains", { contains: site })` | title: N links from it — or, for 0, none was found and the narrowed list shows nothing |
| Spam | the same row among the first competitor it links to | title: no view lists it among this site's (it doesn't link here) |
| First seen | that competitor's referring domains narrowed to the site, with the date | — |

### Opportunities (`opportunities.tsx`)

`opp` within \| falling \| pages \| home is the list shown (Within reach when absent); with `opp=pages`, `path` (the page's
path with its query, or its whole address when it's on another host) opens one page's searches. The tiles and the tabs
are links that write it. Chip (when the address names a list): `Within reach: N searches on page one or two, outside the
first three` / `Losing ground: N …` / `Pages: N pages returned for M searches` / `Home page: N searches that return the home
page outside the first three (the tile's X% counts every search that returns it, the first three included)` /
`Searches that return <page>: N` (clear: **Every page**) / `No page "x" among the N pages returned` / `"x" isn't one of the
four lists`.

| figure | where it goes |
|---|---|
| tiles (number and hint), tabs and their counts | `seoLinks.explorer(domain, "opportunities", { opp })` |
| "The N most searched" / "All N keywords" | `{ opp: "pages" }` — every one of them, by the page returned |
| "of the M keywords" | `seoLinks.explorer(domain, "keywords", { band: "top20" })` — the site's organic keywords on pages one and two |
| "as of" date / price | `seoLinks.usage({ month })` / `seoLinks.usage()` |
| Pages: page / Searches | `{ opp: "pages", path }` |
| Pages: Visits / mo | `seoLinks.explorer(domain, "pages", { path })` |
| Pages: In the top 3 / top 10 | `seoLinks.explorer(domain, "keywords", { path, band: "top3" \| "top10" })` |
| Pages: Home page chip | `{ opp: "home" }` |
| Pages: best keyword / its "#N" | `seoLinks.keywords(kw, market)` / `seoLinks.explorer(domain, "keywords", { contains: kw })` |
| a page's "(N)" when open | `seoLinks.explorer(domain, "keywords", { path })` |
| rows: keyword / searches / difficulty | `seoLinks.keywords(kw, market)` / `{ section: "volume" }` / `{ section: "serp" }` |
| rows: Position / Places lost | `seoLinks.explorer(domain, "keywords", { contains: kw })` — the position now; the place before is kept only as this figure, and the title says so |
| rows: page returned | external |
| paging "1–50 of N" | this list's own address (it opens at its first fifty) |

A link to a keyword report in Site explorer (organic keywords, top pages) carries `locationCode` when the country isn't the
United States; link reports (backlinks, referring domains, anchors) are the same in every country and carry none.
