# Rank tracker — where every figure leads

Owner's order (2026-10-09): "Make sure every link and container actually takes you somewhere. Press Tracked keywords
and all that data should pop up. All data should take you somewhere!"

Screen: `/seo/rank-tracker` — `client/src/pages/seo/index.tsx` with its panels `rank-history.tsx`, `rank-tags.tsx`,
`rank-competitors.tsx`, `serp-groups.tsx`, `serp-features.tsx`, `gsc-breakdown.tsx`, `competing.tsx`, `viz-rank.tsx`.
Addresses come from `seoLinks` in `client/src/pages/seo/links.ts` (the one place they are written); the page reads them
through `useRankParams()` in `rank-params.ts`, which also holds the band / movement predicates (they match the server's
own counts in `server/seo/routes.ts` and `server/seo/rank-history.ts`), the chip words, `scopeOf()` (the table's current
narrowing, so a count made over the narrowed rows links to those rows) and `hrefWith()` (the current address with a
panel's own parameter changed). The keyword watch (`keyword-watch.tsx`, on Alerts) is at the end of this file.

Below, `rt(…)` is `seoLinks.rankTracker(siteId, …)`, `ex(…)` is `seoLinks.explorer(…)`, `kw(…)` is `seoLinks.keywords(…)`.
Every link carries a `data-testid` that is unique on the page (`link-<figure>`, with the row's id, and a tag or domain
made id-safe by `slug()` so two tags never share one). Nothing is bought on arrival: no parameter starts a check or a lookup.
Guard: `server/seo/rank-tracker-ui.test.ts` (source pins of the rows below, and the pure parameter reader).

## The chip

The table's heading row (`data-testid="rank-filter"`, "Tracked keywords · N of M") shows the narrowing in a chip
`data-testid="active-filter"` with a **Clear** link (`link-clear-filter`, → `rt()`), in the words a visitor reads:
"Keywords in the top 3 · desktop", "Keywords tagged “roofing”, whose results show a map pack · mobile",
"Keywords ordered by position, best first", "All keywords — “roof repair tampa” highlighted · desktop",
"Keywords whose results show no map pack", "Keywords checked from “Tampa, Florida”", "Keywords with a saved check",
"Keywords whose results show an AI overview and a featured snippet" (`feature` may list several). The device is named
when the site tracks both devices or the address names one; a device the site does not track is said:
"All keywords · mobile (desktop is not tracked for this site)". The heading and the chip are there with no keywords
too (above the "No keywords tracked" note), so an address that narrows is always answered. When nothing matches, the
table is replaced by "None of these keywords matches on desktop. Show all N tracked keywords" (`rank-filter-empty`) —
so a band, a tag or a legend entry of 0 is a link like any other: it lands here, and the chip and this line say so.
"Keywords with no monthly search volume yet" is the `noVolume` narrowing.

The History panel has its own chip (`data-testid="active-filter"`, in the panel's heading row) for what the address asks
of it: "History: Visibility over time", "History: the check of Oct 8", "History: Average position over time · the check
of Oct 1"; it is there before the first check too ("… — no check is saved yet", in a heading of its own when the panel
would otherwise stay out of the way); an unknown `series` or a `date` with no check is said ("“foo” is not a figure of this chart, so the first is
shown", "no check was saved on “2026-01-01”"). Its **Clear** (`link-clear-history`) → `rt({ panel: "history" })` with the
panel's device and tag. Inside the numbers table the highlighted check is repeated beside it: `data-testid="active-date"`
("Showing the check of Oct 8 · Clear", `link-clear-date`).

The keyword watch's chip is at the end of this file.

## Figures → where they go

| Figure | Where it goes | Chip words |
|---|---|---|
| **Visibility** (value) | `rt({ panel: "history", series: "visibility" })` — all keywords; the history panel with its Visibility series | History: Visibility over time |
| Visibility foot "Estimated share of clicks … · desktop" (`link-visibility-basis`) | `rt({ panel: "history", series: "visibility" })` (its note says how it is estimated) | History: Visibility over time |
| Visibility foot, its date | `rt({ panel: "history", date })` | History: the check of <date> |
| **Average position** (value, and its foot "desktop, ranked keywords only") | `rt({ sort: "position" })` | Keywords ordered by position, best first |
| **In the top 10** (value) | `rt({ band: "top10" })` | Keywords in the top 10 |
| "N in the top 3" (foot) | `rt({ band: "top3" })` | Keywords in the top 3 |
| **Since last check** ▲N (and "Keywords up") | `rt({ move: "up" })` | Keywords up since the check before (newly found ones included) |
| **Since last check** ▼N (and "down") | `rt({ move: "down" })` | Keywords down since the check before (ones no longer found included) |
| **In the Google map pack** (value and "of N searches that show a map") | `rt({ mapPack: true })` — the keywords you were found in come first | Keywords whose results show a map pack |
| **Tracked keywords** (value) | `rt({ panel: "keywords" })` — the table | — |
| "Last checked <date>" (foot) | `rt({ panel: "history", date: <that day> })`; "Not checked yet" → `rt({ panel: "history" })` | History: the check of <date> |
| Distribution: **Top 3** (segment + legend) | `rt({ band: "top3" })` | Keywords in the top 3 |
| Distribution: **4–10** | `rt({ positions: "4-10" })` | Keywords in positions 4–10 |
| Distribution: **Below 10 or not found** | `rt({ band: "rest" })` | Keywords not in the top 10 (11th or lower, or not found) |
| Distribution: a legend entry of **0** | the same link (it lands on the empty narrowing, which says so); a band of 0 draws no segment | as above |
| Table heading "Tracked keywords · **N** of **M**" (`link-table-shown`, `link-table-all`) | N → the current narrowing (`rt({ …scope, keyword })`); M (or the one total) → `rt({ device })` / `rt({ device, panel: "keywords" })` | as the chip / — |
| **Search Console clicks / Impressions** (values, and their feet "N the 28 days before" / "Average position N" / the property) | `rt({ panel: "gsc" })` — the Search Console breakdown | — |
| **Search Console** "—" (not connected) and "Connect the property…" | `seoLinks.searchConsole()` (Settings → Search Console) | — |
| **Next automatic check** (value, and "N result pages per check") | `seoLinks.usage()` | — |
| **Keywords in your plan** (value) / "Across all your sites" | `seoLinks.usage()` / `seoLinks.dashboardSites()` | — |
| "In the newest saved check of each of these **N keywords**" | `rt({ …scope, checked: true })` | Keywords with a saved check (+ the table's narrowing) |
| "the results showed a map pack on N" | `rt({ …scope, feature: "local_pack" })` — `scope` is the table's current narrowing (`scopeOf`), because the count is made over the rows shown (audit §3.2) | Keywords whose results show a map pack (+ the narrowing) |
| "(you were found in M)" | `rt({ …scope, mapPack: true })` | Keywords whose results show a map pack |
| "an AI overview on N" / "a featured snippet on N" / "people also ask on N" | `rt({ …scope, feature: withFeature(scope.feature, "ai_overview") })` etc. — a feature already in the narrowing is kept, so the count's own feature is added to it | Keywords whose results show an AI overview / a featured snippet / "people also ask" questions |
| "N of your keywords have no monthly search volume yet" | `rt({ device, noVolume: true })` — those keywords in the table (the "Get search volumes" button beside the line buys their volumes; arriving buys nothing) | Keywords with no monthly search volume yet |
| "research keywords" (no keywords yet) | `kw("")` | — |
| **History** — Over time figure buttons | `setParam("series", key)` (visibility, position, top3, top10, map) | History: <figure> over time |
| History — "first → last" values above the chart | `rt({ panel: "history", date })` of each check (`chart-visibility-first`, `chart-visibility-last`) | History: the check of <date> |
| History — a point on the Over time chart | `setParam("date", <check date>)` — opens the numbers table, highlights that check (the table of keywords holds only the newest positions, so an older check cannot be listed by keyword; the panel says so) | History: the check of <date> |
| History — "Checks: <date> · <date> …" (the newest ten, `list-checks`, `link-check-<date>`) | `rt({ panel: "history", date })` — the keyboard and touch way to an older check (the chart is decoration) | History: the check of <date> |
| History — "and N earlier in the table below" (`link-checks-earlier`) | `rt({ panel: "history", date: <the newest of them> })` — the numbers table opens there, and every older check is a dated row in it | History: the check of <date> |
| History — "N keywords checked <date>" (Positions heading) | `rt({ checked: true })` / `rt({ panel: "history", date })` | Keywords with a saved check / History: the check of <date> |
| History — Positions chart legend **1–3 / 4–10 / 11–20 / 21+ / Not found** | `rt({ band: "top3" })` / `rt({ positions: "4-10" })` / `rt({ positions: "11-20" })` / `rt({ positions: "21+" })` / `rt({ band: "notFound" })` — with the panel's device and tag | Keywords in the top 3 / in positions 4–10 / in positions 11–20 / at position 21 or lower / not found in the pages read |
| History — a bar of the newest check | the same band link; a bar of an older check → `setParam("date", …)` | as above |
| History — numbers table, the date cell | `rt({ panel: "history", date })` | History: the check of <date> |
| History — numbers table, newest row's band cells (0 included) | the same band links; an older row's band cell → `rt({ panel: "history", date })` (only the newest check's keywords can be listed; the title says so) | as above |
| History — `tag=(none)` | the panel reads all keywords (it says so, `text-history-notag`), so its counts link without `(none)` — the landing holds what the count counted; the links that only move within the panel (a check, Clear) keep it, so the table keeps its narrowing | — |
| History — numbers table, Visibility / Average position / In map pack cells | `rt({ panel: "history", series: "visibility" \| "position" \| "map", date })`; newest row's map-pack cell → `rt({ mapPack: true })`; a check that did not measure the map pack shows "—", never 0 | History: <figure> over time · the check of <date> |
| History — "The trend lines appear after the next check (every week / twice a week / every day)" | the site's `rankFrequency`, as Tracking settings name it; the one check's date → `rt({ panel: "history", date })` | — |
| History — device buttons, tag select | `setParam("device", …)`, `setParam("tag", …)`; the select offers "No tag (shown here as all keywords)" = `(none)` | · desktop / · mobile; Keywords tagged “…” |
| **By tag** — tag name, Keywords count | `rt({ tag })`; "All keywords" → `rt()`; "No tag" → `rt({ tag: "(none)" })` | Keywords tagged “…” / All keywords / Keywords with no tag |
| By tag — "N checked" (under Keywords), "change on N" | `rt({ tag, checked: true })` | Keywords with a saved check, tagged “…” |
| By tag — Visibility index, and its ±change | `rt({ tag, panel: "history", series: "visibility" })` ("No tag" → `rt({ tag: "(none)" })`, its history is not kept apart) | History: Visibility over time |
| By tag — In the top 10, and its ±change | `rt({ tag, band: "top10" })` (each row shows its move since the check before) | Keywords in the top 10, tagged “…” |
| By tag — "N in the top 3" | `rt({ tag, band: "top3" })` | Keywords in the top 3, tagged “…” |
| By tag — Avg. position, "N ranked both times: X → Y" | `rt({ tag, sort: "position" })` | Keywords tagged “…”, ordered by position, best first |
| By tag — New since | `rt({ tag, move: "new" })` | Keywords new since the check before (first checked now, or not found then), tagged “…” |
| By tag — the days in the basis line ("newest saved day on desktop (<date> to <date>) against … (<date>)", `link-tags-now-from` …) | `rt({ device, panel: "history", date })` | History: the check of <date> |
| By tag — In the top 10 / New since of **0** | the same links (an empty narrowing, said) | as above |
| By tag — device buttons | `setParam("device", …)` | · desktop / · mobile |
| **The page Google shows for each search** — "N of your M checked keywords" | `rt({ checked: true })` | Keywords with a saved check |
| … — "in the last N days" (`link-competing-days`) | `rt({ panel: "history" })` — the checks of those days | — |
| … — "these N keywords" (back and forth) | `hrefWith({ panel: "competing" })` — the table below | — |
| … — the device under the keyword (`link-competing-device-<id>`) | `rt({ device })` | · desktop / · mobile |
| … — keyword, Ranked checks, "position N" (under Last shown), "shown in X of Y ranked checks", "best position N" | `rt({ keyword, device })` — the row, opened on its history | All keywords — “…” highlighted |
| … — a town under the keyword | `rt({ location, device })` | Keywords checked from “…” |
| … — every date (first – last ranked, "on <date>", "not found in the check of", "ranked again on", "last on") and "at position N" in the opened row | `rt({ keyword, device, panel: "history", date })` | History: the check of <date> |
| … — Volume | `kw(keyword)` | — |
| … — Page changes (a link), the chevron (a button) | opens the row's pages: `hrefWith({ competing: keywordId })` / `setParam("competing", keywordId)` (the opened row is the address) | — |
| … — Last shown, each page in the opened row, each address of a "may be one page" group (`link-competing-variant-<id>-<g>-<n>`) | `ex(host, "pages", { path })` | — |
| … — "Show N keywords where the page changed / shown under addresses that differ" | `hrefWith({ competingShow: "changed" \| "variants" })` (hiding it also closes a row opened in it); a row the address opens in a further list opens that list | — |
| **Searches with largely the same results** — "saved for N keywords", "N keywords have no saved result page", "(N were checked without one)" | `rt({ checked: true, device })` | Keywords with a saved check |
| … — the dates in "each at its own newest check between A and B" / "checked <date>", a group's "checked A – B", a member's "checked <date>" | `rt({ panel: "history", date, device })` | History: the check of <date> |
| … — "In N groups, more than one address of yours ranks" | opens the first of those groups (`hrefWith({ group })`) | — |
| … — group's first keyword, each keyword inside, its #position, "not found in the results" | `rt({ keyword, device })` | All keywords — “…” highlighted |
| … — a group's town | `rt({ location, device })` | Keywords checked from “…” |
| … — Keywords count, "for the N with a figure", "N addresses", "N as recorded", "Ranks for N", "page not recorded for N" (links), the chevron (a button) | opens the group: `hrefWith({ group: firstKeywordId })` / `setParam("group", …)`; a group the address opens is shown even past the first eight | — |
| … — inside an opened group, "N of its M results are also in the first keyword's" (`link-group-member-shared-<id>`) | `rt({ keyword, device })` — the row, opened on Google's first page as saved | All keywords — “…” highlighted |
| … — "Your site was not found for any of them", "not found for N" | `rt({ band: "notFound", device })` (all the keywords not found; this group's are among them — the title says so) | Keywords not found in the pages read |
| … — Volume (group and member) | `kw(keyword)` | — |
| … — your address (one), a member's page | `ex(host, "pages", { path })` | — |
| … — device buttons | `setParams({ device, group: null })` | — |
| … — "Show all N groups" / "Show the first 8" | `hrefWith({ groupsAll: true \| null })` | — |
| **Search Console breakdown** — Pages / Searches tabs | `hrefWith({ gsc: "query" \| null, gscAll: null })` (the table's narrowing stays) | — |
| … — "Show: Most clicks / Biggest gain / Biggest fall" | `setParam("gscSort", "gain" \| "loss" \| null)` (back to most clicks, in place, when the windows are not comparable) | — |
| … — "N pages / searches" in the basis line, "the busiest N listed", "Show all N" | `hrefWith({ gscAll: true })` (when Google returned more than are kept, the title says the busiest are listed) | — |
| … — the property, the other properties, "the 28 days to <date>", "N of 28 with data" (both windows) | `seoLinks.searchConsole()` — the connection, where the property is synced (no view lists the days themselves) | — |
| … — a page, and every figure in its row (Clicks, "before N", Change, Impressions, Avg. position, "was N") | `ex(host, "pages", { path })` | — |
| … — a search, and every figure in its row | `kw(search)` | — |
| … — "tracked" chip | `rt({ keyword: search })` | All keywords — “…” highlighted |
| … — "Connect it" (no property) | `seoLinks.searchConsole()` | — |
| **Competitors** — Share of voice rows (domain, "N in top 10 · avg", %) | `ex(domain)` (`link-voice-top10-<slug>`, `link-voice-share-<slug>`) | — |
| … — "on N of M" (a competitor's place was saved on some of the keywords) | `rt({ tag, device, panel: "keywords" })` | — |
| … — "N tracked keywords, checked <date>" | `rt({ tag, device, panel: "keywords" })` / `rt({ tag, device, panel: "history", date })` | — / History: the check of <date> |
| … — Seen most rows (domain, "N keywords · best #M") | `ex(domain)` ("Follow" buttons kept; `link-seen-figures-<slug>`) | — |
| … — Who is in the map pack: a business with a website | `ex(domain)`; without one (`link-map-leader-name-<n>`) → `rt({ tag, device, mapPack: true })`, and the panel's note says so | — / Keywords whose results show a map pack |
| … — its "N keywords" | `rt({ tag, device, mapPack: true })` (`link-map-leader-keywords-<n>`) | Keywords whose results show a map pack |
| … — Keywords (tag) select, device buttons | `setParam("tag", …)` (offers "No tag (measured here as all)" = `(none)`), `setParam("device", …)` | — |
| **Keyword table** — keyword | `kw(keyword)` | — |
| … — "· <town>" after the keyword | `rt({ location, device })` | Keywords checked from “…” |
| … — a tag after the keyword | `rt({ tag, device })` — the device named in the address is kept (audit §3.3); `link-row-tag-<id>-<slug>` | Keywords tagged “…” |
| … — position badge (and the Checked date) | opens the keyword's history (`button-history-<id>`, `button-checked-<id>`) | — |
| … — Map pack "#N" / "not found in it" | `rt({ mapPack: true, device })` | Keywords whose results show a map pack |
| … — Map pack "no map" | `rt({ noMap: true, device })` | Keywords whose results show no map pack |
| … — a SERP feature chip (Map, AI, Snippet, Questions, Videos, Images, Ads, Shopping, News, Panel) | `rt({ feature: <type>, device })` | Keywords whose results show <feature> |
| … — Volume | `kw(keyword)`; "—" (no volume yet) → `rt({ noVolume: true, device })` | — / Keywords with no monthly search volume yet |
| … — Ranking page | `ex(host, "pages", { path })` | — |
| … — opened row: the map pack's date, "as saved · <date>" | `rt({ keyword, device, panel: "history", date })` | History: the check of <date> |
| … — opened row: map-pack businesses with a website (`link-pack-<id>-<n>`, "N. name" — the place is part of the link), "Google's first page" places and domains (`link-serp-<id>-<n>`) | `ex(domain)`; a business with no website → `rt({ mapPack: true, device })` | — |
| … — opened row: a result's title on Google's first page (`link-serp-title-<id>-<n>`) | `ex(host, "pages", { path })` | — |
| … — opened row: the ranking page in the keyword's own history (`link-kw-history-page-<id>-<date>`) | `ex(host, "pages", { path })` | — |
| … — opened row: each date and position in the keyword's own history table (`link-kw-history-date-<id>-<date>`, `link-kw-history-<device>-<id>-<date>`, "not found" included) | `rt({ keyword, device, panel: "history", date })` | History: the check of <date> |
| **Recent checks** — each row (date · trigger · status · N/M checks) | `rt({ panel: "history", date: <the check's day> })`; an error stays words beside it | History: the check of <date> |
| Site picker | the shell's own picker (`select-seo-site` → `setParam("site", id)`, one history entry); this page writes `site` nowhere itself | — |
| "Plan" buttons | kept as they were | — |

## Parameters honoured on arrival

| Parameter | What it narrows / does |
|---|---|
| `site` | The site shown (wins over the remembered pick, and is remembered — `useSelectedSite` in the shell). A site not in the list falls back to the pick, and the page says so (`text-site-missing`). |
| `band` | `top3` 1–3 · `top10` 1–10 · `top20` 1–20 · `top50` 1–50 · `top100` 1–100 · `rest` checked but not in the top 10 (11th or lower, or not found — the distribution's "Below 10 or not found" segment) · `notFound` checked, not within the pages read. Read on the device shown. |
| `positions` | An exact slice: `4-10`, `11-20`, `21+` (also `from-to`, `from+`). The history chart's bands, which `band` cannot name. |
| `move` | Since the check before, as the overview counts "improved"/"declined": `up` (better, or newly found) · `down` (worse, or no longer found) · `new` (no position from the check before: first checked now, or not found then) · `lost` (found then, not now) · `unchanged`. |
| `tag` | Keywords carrying that tag; `(none)` keywords with no tag. Also the History and Competitors panels' tag; their tag selects offer `(none)`, and because neither keeps untagged keywords apart, that view reads all keywords there and each panel says so in a note (`text-history-notag`, `text-voice-notag`). |
| `keyword` | Scrolls to that keyword's row, highlights it and opens its history. Never narrows; when another filter hides it, the page says so with a link to it on its own. |
| `device` | `desktop` or `mobile`: the device the table, History, By tag, Competitors and SERP groups read. A device the site does not track falls back to the site's first, and the chip says so. |
| `mapPack` | Only keywords whose newest results show a map pack (feature list, saved pack or your own place in it); the ones you were found in come first; the Map pack column shows where. |
| `noMap` | Only keywords with a saved check whose newest results show no map pack. |
| `checked` | Only keywords with a saved check on the device shown. |
| `noVolume` | Only keywords with no monthly search volume saved yet. |
| `location` | Only keywords checked from that place (the row's place name, e.g. "Tampa, Florida"). |
| `feature` | Keywords whose newest results show that SERP feature (`local_pack`, `ai_overview`, `featured_snippet`, `people_also_ask`, `video`, `images`, `paid`, `shopping`, `top_stories`, `knowledge_graph`); several comma-separated must all show. |
| `sort` | `position`: the table ordered best first (not found, then not checked, last). |
| `series` | The History panel's figure: `visibility`, `position`, `top3`, `top10`, `map`. Said in the panel's chip. |
| `date` | A check day (`YYYY-MM-DD`): the History numbers table opens with that row highlighted and scrolled to; the panel's chip names it. |
| `panel` | Scrolls to `history`, `tags`, `competitors`, `groups`, `gsc`, `competing`, or `keywords` (the table). A panel that is not on the page (no Search Console, no tags) is simply not scrolled to. |
| `gsc`, `gscSort`, `gscAll` | The Search Console breakdown's tab (`query`; pages otherwise), its order (`gain` \| `loss`; most clicks otherwise) and "show all". |
| `group`, `groupsAll` | The opened results group (its first keyword's id) and "all groups" in Searches with largely the same results. |
| `competing`, `competingShow` | The opened row (keyword id) and the further lists (`changed` \| `variants`) in The page Google shows for each search. |

Any narrowing parameter (or `device`) without `panel` scrolls to the table's heading and chip on arrival, once per address.
Every control on the page writes the same parameters (`setParam` / `setParams`, push — or is itself a link built with
`hrefWith`), so the back button undoes a pick: the device and tag pickers, the History figure buttons and chart points,
the GSC tabs, order and "show all", the group and row reveals (their counts are links, their chevrons buttons), "show all
groups" and the further lists. The keyword table's position badge and Checked date stay buttons that open the row's
history in place (the row is opened by address with `keyword`, which also scrolls and highlights). A failed check's error
in Recent checks is words beside its link, not a figure. The site is
written once, by the shell's picker (`shell.tsx`); this page keeps no `setParam("site")` of its own.

## Phone (390 px)

Every link on the screen uses `viz-rank.tsx`'s `LINK` (or `LINK_BLOCK` for a truncating address): the link blue with a
dotted underline that needs no hover (solid on hover and `focus-visible`; the focus ring is `google.css`'s), and at
phone width an inline-flex box 44 px tall. Row buttons (`TAP`: the position badge, the Checked date, the group and row
reveals), the device pills, SERP chips, the table's remove button and the panels' pills are 44 px tall at phone width
(`max-sm:!min-h-11`), 32 px in the desktop table. An older check in History has a list of dated links (`list-checks`),
so the chart's points are never the only way to it. The distribution bar's segments draw a 10 px stripe inside a hit
area 44 px tall at phone width, and its legend repeats them as links in words.

## Also fixed on the way

The "In the top 10" trend (figure row and the History panel's series) summed only the server's `top10` field, which is
the 4–10 slice of the stacked bands (`server/seo/rank-history.ts`); it now shows `top3 + top10`, the count in the tile.

## Keyword watch (`keyword-watch.tsx`, on `/seo/alerts`)

The pair compared, the list shown and "show all" are the address — `seoLinks.alerts({ site, now, before, watch, watchAll })`
— so an alert's "Open this comparison" (`link-kw-alert-open`, `alerts.tsx`) is a link to `alerts({ site, kind, now, before })`,
the snapshot pickers write `now` / `before` (`setParams`, one history entry), the tabs are links (`?watch=added | gone | pages`)
and "Show all N" is `?watchAll=true`. A pair that is not the site's is answered by the server ("That snapshot is not on
record for this site") with a link to the newest two. Nothing is bought by arriving; the snapshot button is the one buyer.

Chip (`data-testid="active-filter"`, inside the panel): "Keyword watch: the snapshots of Oct 1 and Sep 1 · the searches
no longer seen · every row"; an unknown `watch` is said ("“foo” is not a list here, so the first is shown"). Its
**Back to the newest two** (`link-kw-newest`) clears `now`, `before`, `watch` and `watchAll` — the link alone writes the
address (one history entry).

| Figure | Where it goes |
|---|---|
| "Last snapshot <date>: N keywords", "of the M the data has for the site" (`link-kw-latest-date`, `link-kw-latest`, `link-kw-total`) | `ex(domain, "keywords", { locationCode })` — the data's keyword list for the site as it is now (a snapshot is a copy of it on its day); the default country adds nothing |
| "entered the site's N highest-traffic keywords" (`link-kw-top-rows`) | `ex(domain, "keywords", { locationCode })` |
| "Next: <date>" | `seoLinks.usage()` (the included data the monthly snapshot uses) |
| "Between <date> and <date>" | `ex(domain, "keywords", { locationCode })` |
| "newly sees … N searches" / "no longer sees it for M" (every basis) | the list tab: `?watch=added` / `?watch=gone` |
| the tabs "Newly seen (N)" / "No longer seen (M)" / "By page (P)" | `?watch=added` / `gone` / `pages` |
| a search | `kw(keyword, marketParams(market))` — the snapshot's country and language |
| its position, its estimated visits | `ex(domain, "keywords", { contains: keyword, locationCode })` — its row among the site's keywords |
| its volume | `kw(keyword, marketParams(market))` |
| its page; a page in "By page" | `ex(domain, "pages", { path })` |
| "By page" — Keywords before/after, Est. visits before/after, "What moved" | `ex(domain, "keywords", { path, locationCode })` — the site's keywords narrowed to that page |
| "Show all N" | `?watchAll=true` |
| "N snapshots on record" | words beside the pickers that list them (no view of its own) |
| "Track", "Plan", the watch checkbox, "Take a snapshot now" | kept as they were |
