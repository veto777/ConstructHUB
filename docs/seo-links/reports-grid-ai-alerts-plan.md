# Where every figure leads — Reports, Local grid, AI visibility, Alerts, Action plan, Mentions, Usage, Batch, Competitors, shell

Owner's order (2026-10-09): every link and container takes you somewhere; all data takes you somewhere. The addresses
are written in one place, `client/src/pages/seo/links.ts` (`seoLinks.*`); every page below honours the parameters
named there, shows what narrowed it in a chip `data-testid="active-filter"` with a clear control, and writes a filter
picked on the page back to the address with `setParam` / `setParams` / `clearParams` (so a link and a picked filter are
the same thing, and the back button undoes it). Arriving by link never buys, sends or schedules anything: a paid
lookup stays a labelled button (Look it up, Scan, Ask, Find the gap, Get the numbers, Check again), and a saved result
is shown free.

Round 2 (Kimi audit `kimi-seo-links-1.md` §2–§7): every secondary figure, cell, date and count of these screens is a
link; the chips say only what is true; every link is a 44 px target with a cue that needs no hover.

## Shared pieces

`shell.tsx`:
- `useSelectedSite` honours `?site=` on every SEO page (initial load and while open) and remembers it. **The site
  picker is the one writer of `?site=`** for a pick: a page's `onSite` only drops its own parameters (`clearParams`,
  in place) and remembers the site, so one pick is one history entry (the rank tracker dropped its own `setParam`).
- `useAddress()` reads the parameters reactively; `ActiveFilter` is the chip; `useSiteMissing` says when the address
  names a site that is not the account's; `useHash` reads a `#fragment`.
- `useScrollTo` only scrolls. The outline is each page's own: `HIGHLIGHT` (or the same outline classes) is applied by
  reports (`?section=`), plan (`?task=`), alerts (`?alert=`), AI (`?question=` on the tracked row) and the local grid
  (`?cell=` / `?show=` on the points).
- `TabStrip` — every tab strip of these screens (the SEO nav, the alert kinds, the plan's lists, the mentions tabs):
  44 px tabs; on a phone the strip scrolls with a visible thin scrollbar and a fade at the right edge; from 640 px it
  wraps.
- `Tile` takes an optional `href`: the whole tile is the link, its label dotted-underlined.

`viz-more.tsx` — the link classes every link here uses:
- `TAP` — `inline-flex min-h-11 items-center gap-x-1`: a 44 px hit area at 390 px, whatever the text size.
- `LINK_CUE` — a dotted underline at all times (solid on hover); `FOCUS_RING` — the keyboard focus outline.
- `FIGURE_LINK` (a number in the text colour), `QUIET_LINK` (keeps its words' colour: a grey date, a green verdict),
  `TEXT_LINK` (blue words) — each is `TAP` + `LINK_CUE` + `FOCUS_RING`.
- `TAP_PAD` — a 24 px chip keeps its size and gets an invisible 44 px tap box around it.
- `LinkedFigure` — label + number as one block link (about 60 px), the label dotted-underlined, with the focus ring.

Colours: blue words, orange bars; green / red only for better / worse (alert kinds, verdicts, grid points keep theirs).
New links carry `data-testid="link-<figure>"`; every existing test id is kept. No closed `<details>` holds links on
these screens any more (a toggle renders them), so every link is a real anchor a click-crawl or a thumb can reach.

## Shell — usage line and nav

| Figure | Where it goes | Chip words (on the landing page) |
| --- | --- | --- |
| SEO data this month $X left of $Y | `seoLinks.usage()` | — |
| purchased credit $Z | `seoLinks.usage({ credits: "add" })` — opens the add-credit panel (the flag is consumed, also when the address changes while open) | — |
| tracked keywords N of M | `seoLinks.dashboard({ sort: "keywords" })` | (the dashboard's chip) |
| nav tabs | the section roots (they carry no site: the chosen site is remembered) | — |
| plan gate "See Agency" | `seoLinks.pricing()` | — |

The three usage-line links are 44 px tall with the dotted underline and the focus ring.

## Reports (`reports.tsx`) — honours `site`, `section`

| Parameter | What it does |
| --- | --- |
| `site` | the site reported on |
| `section` | `rankings` / `fixes` / `work` / `visibility` (By tag) / `grid` — scrolls to and outlines that section. Chip "Jumped to: Rankings" only when the section is in this report; otherwise `"Local grid" is not in this report yet — it appears once that tool has numbers for example.com`, or `No section called "x" in a report (…)`. A site picked drops `?section=` (another report). |

| Figure | Where it goes |
| --- | --- |
| At a glance: the date | `reports(site)` (this report, as made that day) |
| At a glance: Keywords in the top 10 / top 3 (+ "of N checked", "(+3)", "on the N in both checks") | `rankTracker(site, { band })` / `rankTracker(site)` / the same / `{ panel: "history" }` |
| Not covered by the latest check / "of N tracked" | `rankTracker(site, { band: "notFound" })` / `rankTracker(site)` |
| Average position / "the N ranked both times: x then, y now" | `rankTracker(site)` / `{ panel: "history" }` |
| Compared with the earlier check | `{ panel: "history" }` |
| In the Google map pack / "of N searches that show a map" | `rankTracker(site, { mapPack: true })` |
| Clicks from Google / Times shown in Google | `rankTracker(site, { panel: "gsc" })` |
| Estimated visits / Keywords the site ranks for / Websites linking to it / Authority | `explorer(domain, "pages" \| "keywords" \| "referringDomains")` / `explorer(domain)` |
| Local grid — "kw": the line, "in the first 3 … at N of M points", "was N of M on date", "position score x", "(was y)", "scanned date" | `localGrid(site, { scan })`, `{ scan, show: "top3" }`, `{ scan: earlier scan, show: "top3" }`, `{ scan, show: "checked" }`, `{ scan: earlier, show: "checked" }`, `{ scan }`. The n-th grid line of At a glance is the n-th grid of the report (the server writes them in that order), so it opens that grid's scan by its id — never matched by keyword alone (two grids can share one). |
| Work done / "N marked done" / "N still open" / "N past their due date" | `plan(site, { status: "done" \| "open" \| "overdue" })` |
| Site health / "N errors" / "N warnings" | `audit(site)` / `{ severity }` |
| Rankings title / device · checked date | `rankTracker(site, { device })` / `{ panel: "history", date, device }` |
| In the top 3 / top 10 / Average / Map pack / Keywords checked, and their feet ("of N checked", "change on the N in both checks", "N of M tracked not covered") | `rankTracker(site, { band, device })` …; history for the "in both" words; `{ band: "notFound" }` |
| ▲ Moved up / ▼ Moved down headings and rows | `rankTracker(site, { move, device })` / `{ keyword, device }` |
| All N keywords in the report: heading, keyword · place, Position, Was, Map pack #n / —, Searches / mo | `rankTracker(site, { device })`; `{ keyword, device }`; `{ keyword, panel: "history" }`; `{ keyword, mapPack: true }`; `keywords(kw, { section: "volume" })`. The first 10 rows are on screen and "Show all N" renders the rest — no closed `<details>` (the crawl found the rank-tracker links inside the old one did not navigate). |
| By tag: tag / Keywords / "N in both" / "N new" / In the top 10 / ±change / Visibility index / ±change | `rankTracker(site, { tag, device })`; `{ tag, panel: "history" }`; `{ tag, move: "new" }`; `{ tag, band: "top10" }`; `{ tag, band: "top10", panel: "history" }`; `{ tag, panel: "history" }` |
| "…and N more tags" / the two check dates | `{ panel: "tags" }` / `{ panel: "history", date }` |
| What to fix first: issue / "N affected" / severity / crawled date | `audit(site, { issue })` / the same / `{ severity }` / `audit(site)` |
| Local grid section rows: keyword, size, scanned date, "N of M", "(was …)", position score, "(was …)" | `localGrid(site, { scan })` and `{ scan, show }`; the earlier figures → the earlier scan (`previous.scanId`) |
| Work done: since date / Marked done (+ its foot) / Still open (+ "N due today or in the next 7 days") / In progress / Past their due date (+ "listed below") | `plan(site, { status: "done" })` / `{ status: "open" }` / `plan(site, { due: "soon" })` / `{ status: "doing" }` / `{ status: "overdue" }` |
| Done rows (date, title) / overdue rows (due date, title, owner) / "due before <today>" | `plan(site, { task, status })` / `plan(site, { owner })` / `{ status: "overdue" }` |
| Alerts in the last month: heading / each date and title | `alerts({ site })` / `alerts({ site, kind, alert: id })` (the server sends each alert's `id`) |
| Search Console missing / Branding | `seoLinks.searchConsole()` / `seoLinks.siteScan()` |
| Email schedule | stays a form (its next / last send dates are the form's own state, not data to open) |

## Local grid (`grid.tsx`) — honours `site`, `scan`, `cell`, `show`

| Parameter | What it does |
| --- | --- |
| `scan` | opens one saved scan |
| `cell` | the point picked (0-based); each dot writes it |
| `show` | `top3` / `found` / `checked` / `failed` — outlines the points a figure counts (`failed` appended in round 2) |

Chip: `Scan: "kw" · Oct 3 · point 2 miles north of the business · 7 of 25 outlined: the points where you are in the
first 3`. With `show=checked` and failed lookups: `22 of 25 outlined: every point that could be checked — the position
score is their average (3 points failed and are not outlined)`. A scan that failed: `Scan #12 — it didn't finish, so
there is nothing to outline or pick`, and the point / outline words are left out (they wait only for a scan that is
still opening or running). A site picked drops `scan`, `cell`, `show`.

| Figure | Where it goes |
| --- | --- |
| Heading: keyword, size, date, listing | `localGrid(site, { scan })`; the listing → `explorer(domain)` |
| Position score (+ "the N points checked", "Was x over N points on date") | `{ scan, show: "checked" }`; the earlier scan → `{ scan: previous, show: "checked" }` |
| In the first 3 / Found (+ "was N of M on date") | `{ scan, show: "top3" \| "found" }`; earlier → that scan |
| Area tile | `{ scan }`; its foot "N points could not be checked" → `{ scan, show: "failed" }`, else "N points checked" → `{ scan, show: "checked" }` |
| "At N points … recognised by your website or name" | `{ scan, show: "found" }` |
| Each grid dot | `setParam("cell", i)` |
| Colour key entries | `{ scan, show }` per colour |
| Point detail: "You: position n" / businesses in the first three | `{ scan, show, cell }` / `explorer(domain)`, You → `rankTracker(site, { mapPack: true })` |
| Who shows up: business / domain / In the first 3 / Found / Average position where found | `explorer(domain)`; your row → `rankTracker(site, { mapPack: true })` and `{ scan, show }`. No view holds a rival's points: its figures open its website in Site explorer (the link title says so). |
| Reviews (who shows up, and the listing-search results' stars) | `seoLinks.googleMaps({ cid, name, address })` — outside the app, the listing on Google Maps, where Google's own stars and reviews live (no view here holds them; the ↗ and the title say so). Rivals carry Google's listing id (`GridRival.cid`) from newer scans; without one it is a Maps search for the name. |
| "Centred on" listing / its address | `explorer(domain)` / `googleMaps(pin)` |
| Cost words (about $x of your SEO data, up to $y set aside) | `usage()` |
| "repeats every week — next on date" / repeating rows' "next date" | `usage()` (each repeat is taken from the included SEO data — the title says so) |
| Repeating scans rows: keyword, size, last date | `localGrid(site, { scan: newest finished scan of that search })` |
| Scans so far: keyword / Grid / Position score / In the first 3 / Found / When / Didn't finish | `{ scan }` / `{ scan }` / `{ scan, show: "checked" }` / `{ scan, show: "top3" }` / `{ scan, show: "found" }` / `{ scan }` / `{ scan }` |
| "an alert" (repeating scans note) | `alerts({ site, kind: "grid_down" })` |

## AI visibility (`ai.tsx`, `ai-summary.tsx`) — honours `site`, `prompt`, `question`, `month`, `assistant`, `named`, `cited`, `first`, `business`, `source`, `latest`, `days`, `vs`, `mentions`, `platform`

| Parameter | What it does |
| --- | --- |
| `prompt` | opens one question by its words. A `prompt` of 85+ characters that matches no question exactly opens the one saved question that begins with it (the usage ledger keeps the first 90 characters) — said under the chip; several → listed to pick from |
| `question` | a tracked question's id (outlined in "Asked again every month"); an id the site does not have → `Question #12 is not one asked again every month for example.com … — showing the newest question instead` |
| `month` / `assistant` / `named` / `cited` / `first` / `business` / `source` | narrow the list of every saved answer |
| `latest` / `days` | the newest answer to each question from each assistant / from the last N days — what "The picture so far" counts |
| `vs` | the like-for-like month (the month picker writes it) |
| `mentions` (+ `platform` google \| chat_gpt) | fills "Where AI answers already use a website" and shows its saved result, free; "Look it up" alone buys one |

Chip (one, for all of it): `Answers · to "…" · from Oct 2026 · by ChatGPT · that named you · the newest answer to each
question from each assistant · from the last 30 days · naming "Acme" · drawing on yelp.com — N of M saved answers ·
like for like against Aug 2026 · AI mentions of x.com (Google AI Overviews) …`. What could not be applied is said, never
silently dropped: `month="foo" — not a month (YYYY-MM), so not applied` (never "Invalid Date"); `by "bard" — not an
assistant here (ChatGPT, Google Gemini, Perplexity), so none match` (the list is empty, not everything);
`named="maybe" — not true or false, so not applied`; `days="x" — not a number of days`; `vs="x" — not a month`.
The clear control drops every one of these, `prompt` and `question` too ("Show everything" shows everything).

| Figure | Where it goes |
| --- | --- |
| The picture so far: Questions / "N answers from the last 30 days" (tile foot and sentence) | `ai(site)#ai-prompts` / `ai(site, { latest: true, days: 30 })` |
| Named you / Used your website / Named you first (tiles, the sentence, the per-assistant bars) | `ai(site, { latest: true, days, named \| cited \| first })` (+ `assistant`) — the landing list holds exactly the answers the figure counts |
| Other names: name / count / "of N" | `{ latest, days, business }` / the same / `{ latest, days }` |
| Websites among the sources: site / Answers / Questions / "of your N newest" / a competitor you follow | `explorer(domain)` / `{ latest, days, source }` / the same / `{ latest, days }` / `rankTracker(site, { panel: "competitors" })` |
| Month by month (also with one month only): month / Questions / Named you / Used your site | `ai(site, { month })` / the same / `{ month, named }` / `{ month, cited }` |
| Who gets named: months, "N answers · N questions" (head), rows, cells, Answers counted / Questions asked rows | `{ month }`; `{ business }` / `{ month, business }`; You → `{ named }` / `{ month, named }`. The per-month answer and question counts are visible (a row each on a phone too), not in a `title`. |
| Like for like: the two months, "x → y", "(up 2)", basis ("the N answers to M questions"), Other names / Websites cells, "new" / "gone", "out of N" | `{ month: to \| from }` with `named` / `cited` / `business` / `source` |
| Questions you have asked: question / assistant columns and cells / Last asked | `{ prompt }` / `{ assistant }` and `{ prompt, assistant }` / `{ prompt, month }` |
| Asked again every month: "N of 5 questions" / question / assistants / next date | `ai(site)#ai-tracked` / `{ question: id }` / `{ question, assistant }` / `{ question }` |
| This ask: "Named by N of M", the date, the tiles, the monthly price | `{ prompt, named }`, `{ prompt, month }`, `{ prompt, cited \| first }`, `usage()` |
| Answer card: assistant / asked date / verdicts / businesses named / websites used (yours → `{ cited: true }`) / searched for | `{ prompt, assistant }` / `{ prompt, month }` / `{ prompt, named \| first \| cited }` or the assistant's answers / `{ business }` (yours → `{ named }`) / `explorer(domain)` (+ ↗ the page) / `keywords(q)` |
| Earlier answers (a toggle that renders them): date / assistant / Yes (#n) / No | `{ prompt, month }` / `{ prompt, assistant }` / `{ prompt, assistant, month, named \| first \| cited }` |
| Answers list (`?month` …): date / question / assistant / Named you / Used your website / businesses / "and N more" | `{ month }` / `{ prompt }` / `{ prompt, assistant }` / … / `{ business }` / `{ prompt }`; every cell has its `data-label` |
| AI mentions: total / as-of date / question / Searches / mo / other sites / Seen / "the N most-searched of M" | `explorer(domain)` / `ai(site, { mentions, platform })` / `keywords(q)` / `keywords(q, { section: "volume" })` / `explorer(domain)` / `keywords(q)` (the source's date has no view) / `explorer(domain)` |

## Alerts (`alerts.tsx`) — honours `site`, `kind`, `now`, `before`, `watch`, `watchAll`

| Parameter | What it narrows |
| --- | --- |
| `site` | that site only (the scope picker writes / clears it; the shell's site picker writes it too) |
| `alert` | one alert's id: scrolled to and outlined when it is among the ones loaded; otherwise the chip says `alert #12 — not among the 50 loaded (it may be older — "Show more" — or of another kind or site)` |
| `undelivered` | `true`: the alerts whose delivery was given up, of the ones loaded (`not sent — N of the M loaded`); the alert `?alert=` names stays shown |
| `kind` | one kind; the kind tabs are links |
| `now`, `before`, `watch`, `watchAll` | the keyword watch on the page: the two snapshots compared (ids), its list (`added` / `gone` / `pages`) and every row — its own chip says so (`rank-tracker.md` → Keyword watch) |

Chip: "Rankings fell · example.com only · alert #12" (clear → all alerts: drops `kind`, `site`, `alert`, `undelivered`).
Arriving with `now` + `before` (a plan task's "Open this comparison") scrolls to the keyword watch.

| Alert | Where it goes |
| --- | --- |
| title and footer link | the thing it is about (below); the kind badge → `alerts({ kind })`; the date → `alerts({ site, kind, alert: id })`; "Not sent" / "Email not sent" → `alerts({ site, undelivered: true })` |
| rank_drop / rank_gain | `rankTracker(site, { move: "down" \| "up" })`; each keyword and its Where → `{ keyword, device }`; Device → `{ device }`; "fell from x to y" → `{ keyword, device, panel: "history" }` (map-pack moves → `{ keyword, mapPack: true }`); the two days → `{ panel: "history", date, device }` |
| links_lost / links_gained | `seoLinks.backlinks(site, { section: "lost" \| "new" })`; each lost site → `{ section: "lost", domain }`, its authority → `explorer(domain)`; the counts now → `explorer(domain, "referringDomains" \| "backlinks")`; the counts then and their date → `backlinks(site)` (the page that keeps the monthly snapshots — the link title says so) |
| grid_down / grid_up | **per item**: the search → `localGrid(site, { scan: scanId })`, "N of M" → `{ scan, show: "top3" }`, score → `{ scan, show: "checked" }`; "was …", its date and "was score" → `{ scan: wasScanId, show }` (server items now carry `wasScanId`; older alerts → `localGrid(site)`, said in the title). The footer opens the one scan only when the alert holds one item. |
| mention_new | **per item**: `seoLinks.mentions(site, { check: checkId })` — its date, "N more than this alert keeps" and, with several items, "Open this check on Mentions"; each website → `explorer(domain)`, each page title ↗ the page itself |
| kw_new / kw_lost figures | position → `explorer(domain, "keywords", { contains })`; volume → `keywords(keyword, { section: "volume" })`; the two snapshot dates and "N more" → the comparison (next row) |
| kw_new / kw_lost | `explorer(domain, "keywords")`; each search → `keywords(keyword)`; "Open this comparison" → `alerts({ site, kind, now, before })` — the keyword watch on the page reads the pair from the address (`?watch=` its list, `?watchAll=` every row; see `rank-tracker.md` → Keyword watch) |
| page counts | "Showing N of M" → the list itself; "N alerts could not be sent" → `alerts({ site, kind, undelivered: true })` |
| Settings → Notifications | `seoLinks.appSettings({ tab: "notifications" })` |
| a crawl / an AI change | no such alert kinds exist today — nothing to link |

## Action plan (`plan.tsx`) — honours `site`, `task`, `status`, `kind`, `due`, `owner`

| Parameter | What it narrows |
| --- | --- |
| `status` | `open` (default) / `todo` / `doing` / `overdue` / `done` / `dropped` / `closed`; the tabs are links. `?status=open` is said in the chip too ("Open tasks") — every parameter in the address shows |
| `kind` | one kind of task; the pills write it |
| `due` | `soon`: open tasks due today or in the next 7 days (the browser's calendar; the emailed report counts by UTC) — what the report's "N due today or in the next 7 days" counts |
| `owner` | one person's tasks ("Sam's tasks"); a task's owner is a link to it |
| `task` | scrolls to and outlines one task; shown on its own if the list hides it; `task="abc"` → `task "abc" — not a task number` |

Chip: "Open tasks · due today or in the next 7 days (your calendar) · Sam's tasks · task #12 (shown on its own — it is
not in that list)". A site picked drops all of them.

| Figure | Where it goes |
| --- | --- |
| To do / In progress / Done in the last 30 days / Done in all / Past their due date | `plan(site, { status })` |
| task title / "added date" | `plan(site, { task: id, status })` |
| kind chip / status word / due chip / owner | `plan(site, { kind })` / `{ status }` / `{ status: "overdue" \| "open" }` / `{ owner }` (the chips keep their 24 px look with a 44 px tap box) |
| the facts ("position N when added · N searches a month · authority N · link last seen …") | each → the task's origin (below): the facts are as they were when added; the finding's screen has today's |
| "A crawl made after you added this (date)" | the origin (Site audit on the issue) |
| task's origin (from its stored `source`; a source cut to fit 200 characters keeps its whole words in `facts.origin`, read first) | `audit:` → `audit(site, { issue })`; `lost:` → `backlinks(site, { section: "lost", domain })`; `kw:` `gap:` `area:` `check:` → `keywords(kw)`; `prospect:` (Link intersect) → `explorer(domain)`; `competing:` → `rankTracker(site, { panel: "competing" })`; `serp-group:` → `{ panel: "groups", device }`; `mention:` → `mentions(site)`; `ai-source:` → `ai(site, { source })`; `dir:` → `explorer(domain)`; `outgoing:` → `audit(site, { tab: "outgoing" })`; `link-pair:` / `link-opp:` → `audit(site, { tab: "links" })`; `kw-page:<before>-<now>:…` → `alerts({ site, before, now })` "Open this comparison in the keyword watch on Alerts"; kind audit / link_reclaim without a source → `audit(site)` / `backlinks(site, { section: "lost" })` |
| "What this is based on" | a toggle that renders the evidence (no closed disclosure) |
| "Showing the latest N of M" | `plan(site, { status: "closed" })` |

`plan-button.tsx`: "Open the plan" in the toast is `seoLinks.plan(site)` (no hand-written address); `fitTask` keeps 11
facts when it adds `origin` (the server keeps 12).

## Mentions (`mentions.tsx`, `mentions-page.tsx`) — honours `site`, `check`, `tab`

| Parameter | What it does |
| --- | --- |
| `check` | one watched check (an alert's). Chip: `the check an alert was raised from (#12)` once that check is shown; `check #12 — not available (it may belong to another site), so the newest check is shown` when it is not; `check "abc" — not a check number, so the newest check is shown` |
| `tab` | `prospects` / `yours` / `unsure` / `linked` / `notMine` / `all`; the tabs are links; another word → `"x" — not a tab here, so Likely you, no link is shown` |

The clear control says where it lands: "Newest check · Likely you, no link".

| Figure | Where it goes |
| --- | --- |
| "Searched date", "N websites", "the source has N pages" | `mentions(site, { tab: "all", check })` (the title says only one page per website is listed) |
| row: website / page title ↗ / excerpt / place-match words / Authority / Published / Link to you | `explorer(domain)` / the page / the page / the tab the row is under (`yours` / `unsure` / `notMine`) / `explorer(domain)` / the page (its own date) / `backlinks(site, { domain })` — the links from that website to yours |
| watch: Next date / first-run date | `alerts({ site, kind: "mention_new" })` (what the watch raises) |
| watch: the window's dates and its count | `mentions(site, { check: id })` |
| watch rows: website / page title ↗ | `explorer(domain)` / the page |

## Usage (`usage.tsx`) — honours `credits`, `month`

`month` narrows the lookups to one month ("Lookups in October 2026 — N of the latest 200"; a month that is not one is
quoted, never "Invalid Date"); `credits=add` opens the add-credit panel. Tiles: Used this month / Included data left →
`usage({ month })`; Purchased credit → `usage({ credits: "add" })` (labels dotted-underlined). By-month rows and their
Lookups / Used → `usage({ month })`. The Lookups header counts → `usage({ month })` / `usage()`.

Each lookup row (`spentOn`, read from the ledger's words): Site Explorer report → `explorer(domain)`; Keyword overview /
ideas → `keywords(kw)`; Rank check / Search volumes → `rankTracker(site)`; Backlink snapshot → `backlinks(site)`;
Keyword snapshot → `alerts({ site })`; Competitor gap → `competitors(site, { competitor })`; Content gap / Link
intersect → `explorer(target, "contentGap" \| "linkIntersect")`; Batch analysis → `batch()`; Content explorer "q" →
`content(q)`; Rendering check → `audit(site, { tab: "rendering" })`; AI mentions → `ai(site, { mentions, platform })`;
AI visibility → `ai(site, { question: id })` for a monthly question (its label now ends `monthly #id) for domain`),
else `ai(site, { prompt: first 90 characters })` (the AI page opens the question that begins with them; newer labels
name the site: `… for domain`); Mentions watch "name" → the site with that business name; Refresh list → `keywords("",
{ view: "lists" })`; Local grid, older AI and Mentions rows that name no site → the account's only site. A row whose site
is gone, or cannot be told, stays words with a title saying why — a snapshot or gap of a removed site no longer guesses
the explorer's live report.

Cost → the page that spent it (else that month); "up to $x set aside — still running" is written out (no longer only a
`title`); Paid from: included data → `usage({ month })`, purchased credit → `usage({ credits: "add" })`; Credit added →
`usage({ credits: "add" })`.

## Batch (`batch.tsx`)

Each website → `explorer(domain)`; each figure → `explorer(domain, "overview" | "referringDomains" | "backlinks" |
"pages" | "keywords")`. On a phone (the table head hidden) an "Order by" select holds the column sorting. Intro links →
the site's rank tracker competitors panel / `explorer(site, "linkIntersect")` / Site explorer (`explorer("")` without a
site — no hand-written address).

## Competitors (`competitors.tsx`) — honours `site`, `competitor`

`competitor` fills the box; chip "Competitor: x — press Find the gap to compare (nothing is bought until then)". Clear
drops the parameter, empties the box and takes the results off the screen (no narrowed table without its chip). Rows:
keyword → `keywords(kw)`; volume → `keywords(kw, { section: "volume" })`; difficulty → `keywords(kw)`; CPC →
`keywords(kw, { section: "cpc" })`; intent → `explorer(competitor, "keywords", { intent })`; their position →
`explorer(competitor, "keywords", { contains: kw })`; "N keywords" / "showing N" → `explorer(ours, "contentGap")`;
both sites → `explorer(…)`; the competitors panel → `rankTracker(site, { panel: "competitors" })`. Track is 44 px.

## Appended to links.ts (nothing renamed)

Round 1: `localGrid.show`; `ai.first`, `ai.business`, `ai.source`, `ai.prompt`; `plan.kind`; `mentions.check`,
`mentions.tab`; `usage.credits`, `usage.month`; `competitors.competitor`.
Round 2: `localGrid.show` "failed"; `ai.vs`, `ai.latest`, `ai.days`, `ai.mentions`, `ai.platform`; `alerts.alert`,
`alerts.undelivered` (beside the rank tracker's `now` / `before` / `watch` / `watchAll`); `plan.due`, `plan.owner`;
`searchConsole()` (the rank tracker's, the same line); `appSettings({ tab })`, `siteScan()`, `pricing()`,
`googleMaps({ cid, name, address })`.

## Server fields added for the links

Round 1 — `site-report.ts`: `audit.topIssues[].key`, `work.done[].id`, `work.overdue[].id`; `grid-monitor.ts`:
`GridReportLine.scanId`; `ai-visibility.ts`: history rows carry `businesses` and `sources` (domains).
Round 2 — `site-report.ts`: `alerts[].id`; `grid-monitor.ts`: `GridReportLine.previous.scanId` and the grid alert
item's `wasScanId`; `grid.ts`: `GridRival.cid`; the AI ledger labels name the site (`… for domain`) and a monthly
question's id (`monthly #id`) (`routes.ts`, `ai-monthly.ts`).

Guard: `server/seo/reports-links.test.ts` pins the builders, the address reading, the chips' honest words and every
figure's link on these screens. It is a source guard (no browser): it does not prove the click-crawl, which is the rig's
job.
