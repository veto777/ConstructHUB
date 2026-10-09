/**
 * Where every SEO figure leads. The owner's rule (2026-10-09): every number, label and row on an SEO screen is a
 * link that lands on its data with the filter applied — "all data should take you somewhere". These builders are the
 * ONE place the addresses are written, so a figure on the dashboard, in a report and in an alert all open the same
 * view. Every page honours the parameters named here and shows what narrowed it in a chip with
 * data-testid="active-filter" (the words a visitor reads, e.g. "Keywords in the top 3"), with a way to clear it.
 *
 * A builder never invents a place: when the figure has no detail view (an estimate with no rows behind it), the link
 * goes to the closest view that explains it, and the chip says so.
 */

const qs = (params: Record<string, string | number | boolean | null | undefined>): string => {
  const p = new URLSearchParams();
  // A boolean is kept either way: "followed=false" (not followed) is a filter, not an absence.
  for (const [k, v] of Object.entries(params)) if (v != null && v !== "") p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : "";
};

/** Position bands used by filters everywhere: the same words the distribution bars use. */
export type PositionBand = "top3" | "top10" | "top20" | "top50" | "top100" | "rest" | "notFound";
export type Movement = "up" | "down" | "new" | "lost" | "unchanged";

export const seoLinks = {
  /**
   * The dashboard; `group` narrows the site list to one group (its name, or "none" for sites in no group), `sort` is
   * the order picker (added | name | traffic | authority | keywords | top10 | tasks | health), `filter` keeps only the
   * sites with a saved report (analysed) or a finished crawl (crawled).
   */
  dashboard: (p: { group?: string; sort?: string; filter?: "analysed" | "crawled" } = {}) => `/seo${qs(p)}`,

  /**
   * Rank tracker for one site. `band` narrows the keyword table to a position band, `move` to a movement since the
   * check before, `tag` to a tag, `keyword` scrolls to and highlights one keyword, `device` desktop | mobile,
   * `mapPack` to keywords with a map pack, `panel` opens history | tags | competitors | groups | gsc | competing.
   * Appended for the tracker's own figures: `feature` narrows to keywords whose results show that SERP feature
   * (local_pack, ai_overview, featured_snippet, people_also_ask, video, images, paid, shopping, top_stories,
   * knowledge_graph); `positions` to an exact slice of the result pages ("4-10", "11-20", "21+" — the history
   * chart's bands, which `band` cannot name); `sort` "position" orders the table best first; `series` picks the
   * history panel's figure (visibility | position | top3 | top10 | map); `date` "YYYY-MM-DD" highlights that check
   * in the history panel's numbers; `panel` also takes "keywords" (the table). `tag` "(none)" is keywords with no tag.
   * `feature` may list several, comma-separated (all must show). Appended (audit round 2): `location` narrows to
   * keywords checked from one place (the row's place name); `noMap` to keywords whose results show no map pack;
   * `checked` to keywords with a saved check on the device; the panels' own controls are addresses too — `gsc`
   * page | query, `gscSort` clicks | gain | loss, `gscAll` true (the Search Console breakdown), `group` the keyword id
   * of an opened results group and `groupsAll` true (all groups), `competing` the keyword id of an opened "page
   * Google shows" row and `competingShow` changed | variants (its further lists). Appended (round 2, finish):
   * `noVolume` narrows to keywords with no monthly search volume saved yet (the "N of your keywords have no volume" count).
   */
  rankTracker: (siteId: number, p: { band?: PositionBand; move?: Movement; tag?: string; keyword?: string; device?: "desktop" | "mobile"; mapPack?: boolean; panel?: string; feature?: string; positions?: string; sort?: "position"; series?: string; date?: string; location?: string; noMap?: boolean; checked?: boolean; gsc?: "page" | "query"; gscSort?: "clicks" | "gain" | "loss"; gscAll?: boolean; group?: number; groupsAll?: boolean; competing?: number; competingShow?: "changed" | "variants"; noVolume?: boolean } = {}) =>
    `/seo/rank-tracker${qs({ site: siteId, ...p })}`,

  /**
   * Site explorer for a domain. `view` is a report key as explorer.tsx's menu names them (overview, backlinks,
   * newBacklinks, lostBacklinks, brokenBacklinks, referringDomains, anchors, referringIps, linkCompetitors, …,
   * keywords, pages, competitors, subdomains, contentGap, paidKeywords, ads). Filters narrow that report's table:
   * `band` a position band (keywords), `intent` informational | navigational | commercial | transactional,
   * `followed` true | false (referring domains / backlinks), `tld` ".com", `anchor` an anchor text, `path` a page
   * path (exact page), `month` "YYYY-MM" for the month a history point was clicked.
   * Appended 2026-10-09 (explorer): `pos` a position range the bands don't say ("4-10", "11-20", "21-50", "51-100"),
   * `move` a movement since last month (the saved report counts them; the keyword list says so when it can't be
   * split), `contains` the report's own "contains" box, `volumeMin` / `difficultyMax` its number boxes, `everyLink`
   * every link rather than one per site, `section` a path with everything under it (`path` is one page exactly).
   * Appended 2026-10-09 (explorer, round 2): `languageCode` with `locationCode` names the market (marketParams);
   * `sort` the report's order (a sort key the report lists: newest, authority, …); `series` the figure shown on the
   * Performance / Backlink growth chart; `quick` the overview's first-look table (keywords | pages | competitors |
   * referringDomains | anchors); `from` / `to` the two months compared ("YYYY-MM"); `source` a linking site (the links
   * list can't be narrowed to it yet — the chip says so); `why` the figure that led here when no view holds it (spam |
   * ip | shared — the chip says so); `rivals` Directories: the competitors compared, comma-separated, or `none` for
   * this site alone; `only` Directories: gaps | linked | reviews | trade | maps | business | social.
   * Appended 2026-10-09 (opportunities): `opp` within | falling | pages | home is the Opportunities view's list (the
   * one its tiles count); with `opp` pages, `path` opens one page's searches. Appended the same day (gap):
   * `competitors` "a.com,b.com" (up to three) is the Content gap / Link intersect comparison — the saved one opens, or
   * its Run button waits; "Compare" writes it.
   * Appended 2026-10-09 (round 3, paging): `offset` the first row of the page of rows shown (0, 25, 50 … — a multiple
   * of the page size; the first page is not written) and `limit` the rows per page of a full report, 25 | 50 | 100 (50,
   * the default, is not written). A full report's Previous / Next and its Rows picker write them; so do Link
   * intersect's pages (50 rows each) and the Opportunities lists' pages (50 each). A page not opened yet waits for its
   * own button — arriving never buys it.
   */
  explorer: (domain: string, view = "overview", p: { band?: PositionBand; intent?: string; followed?: boolean; tld?: string; anchor?: string; path?: string; month?: string; locationCode?: number; pos?: string; move?: Movement; contains?: string; volumeMin?: number; difficultyMax?: number; everyLink?: boolean; section?: string; languageCode?: string; sort?: string; series?: string; quick?: string; from?: string; to?: string; source?: string; why?: string; rivals?: string; only?: string; opp?: "within" | "falling" | "pages" | "home"; competitors?: string; offset?: number; limit?: number } = {}) =>
    `/seo/explorer${qs({ domain, view: view === "overview" ? undefined : view, ...p })}`,

  /**
   * Site audit for one site. `tab` issues | pages | links | outgoing | rendering; `severity` error | warning |
   * notice; `area` an area name (Local, Content, Technical, Performance, AI readiness); `issue` an issue key opens
   * its affected pages; `status` 2xx | 3xx | 4xx | 5xx | unchecked narrows the pages tab; `at` / `vs` pick crawls.
   * Also on the pages tab: `status` unusual (an answer outside the usual classes), `show` one of its own pills
   * (notIndexable | canonical | errors | redirected | orphans | deep | thin | noTitle | noDescription), `page` a page
   * path whose row opens; `severity` / `issue` there narrow to the pages listed under issues of that severity / that
   * issue. On the rendering tab, `area` Performance opens the note on why performance was not measured.
   * Appended 2026-10-09 (audit): `page` also outlines that page's rows on the links | outgoing | rendering tabs (and
   * opens its visit on rendering); `result` narrows the rendering table to one result — differ (more or less) | more |
   * less | same | unknown; `status` also takes excluded | beyond-limit | blocked on the pages tab — the overview's counts of
   * what was found and not read, which have no rows (the chip says so).
   * Appended (round 3): the reveals are addresses too, so they are links and the back button undoes them — `all` true
   * lists every entry of the open issue (issues tab) or every row (links | outgoing tabs) instead of the first ones;
   * `more` the number of rows the pages tab lists (100 at first, "Show more" adds 200).
   */
  audit: (siteId: number, p: { tab?: "issues" | "pages" | "links" | "outgoing" | "rendering"; severity?: "error" | "warning" | "notice"; area?: string; issue?: string; status?: string; at?: string; vs?: string; show?: string; page?: string; result?: string; all?: boolean; more?: number } = {}) =>
    `/seo/audit${qs({ site: siteId, ...p })}`,

  /**
   * Keywords explorer for one keyword; `view` one | bulk | lists | area; `table` matchingTerms | relatedTerms | questions.
   * Appended 2026-10-09 (keywords): `languageCode` with `locationCode` names the country exactly ("United States
   * (Spanish)" is 2840 + es); `section` scrolls to one part of the overview — volume (the monthly chart) | serp (Who
   * ranks) | features (On the results page) | ideas (the ideas tables) | cpc | results (the last two land on Who ranks,
   * and the chip says the figure has no view of its own); `month` "YYYY-MM" marks that month on the chart; `intent`
   * informational | navigational | commercial | transactional is the ideas table's intent filter; `list` opens one
   * saved list (view lists). Appended later the same day: `topic` groups a list's or an analysis's keywords by topic
   * ("*" every group, a term only that group, "other" the keywords in no group); `show` narrows the Service × town
   * grid to the cells a tile counts — gaps | weak (beyond the first three) | strong (in the first three) | unknown.
   * Appended 2026-10-09 (round 3): `sort` the ideas table's order, a key that table lists (volume | difficulty | cpc;
   * its first, Highest volume, is not written) — the Sort picker writes it and the chip names the order; `offset` /
   * `limit` the ideas table's page of rows, as for a Site explorer report; `service` and `town` narrow the Service ×
   * town grid to one service's row and one town's column (the words as the grid shows them) — a row or column heading
   * writes them.
   */
  keywords: (keyword: string, p: { view?: "one" | "bulk" | "lists" | "area"; table?: string; locationCode?: number; languageCode?: string; section?: "volume" | "serp" | "features" | "ideas" | "cpc" | "results"; month?: string; intent?: string; list?: number; topic?: string; show?: "gaps" | "weak" | "strong" | "unknown"; sort?: string; offset?: number; limit?: number; service?: string; town?: string } = {}) =>
    `/seo/keywords${qs({ keyword, ...p })}`,

  /**
   * Content explorer for a search. Appended 2026-10-09 (content): the page's own filters, so a picked filter and a link
   * are the same thing — `sort` relevance | authority | newest, `since` 30 | 90 | 365 | 730 days, `authority` the
   * lowest site authority, `kind` blogs | news | organization | message-boards | ecommerce; `offset` the page of
   * results (0, 25, 50 …), so Previous / Next are links too.
   */
  content: (q: string, p: { sort?: string; since?: number; authority?: number; kind?: string; offset?: number } = {}) => `/seo/content${qs({ q, ...p })}`,

  /** Backlinks for one site; `section` lost | strongest | new | all; `domain` narrows to links from one site. */
  backlinks: (siteId: number, p: { section?: string; domain?: string } = {}) => `/seo/backlinks${qs({ site: siteId, ...p })}`,

  /** Reports for one site; `section` rankings | fixes | work | visibility | grid. */
  reports: (siteId: number, p: { section?: string } = {}) => `/seo/reports${qs({ site: siteId, ...p })}`,

  /**
   * Local grid for one site; `scan` opens one scan, `cell` one grid point in it (0-based); `show` outlines the points a
   * figure counts — top3 (in the first 3) | found (in the first N) | checked (every point the position score averages).
   * Appended 2026-10-09: `show` "failed" outlines the points whose lookup failed (the Area tile's "could not be checked").
   * Appended (round 3): one value per colour of the grid's key — "4-10" (4th to 10th), "11-20" (11th or lower, still
   * found) and "notFound" (not in the local results the lookup read); "top3" is the first colour's.
   */
  localGrid: (siteId: number, p: { scan?: number; cell?: number; show?: "top3" | "found" | "checked" | "failed" | "4-10" | "11-20" | "notFound" } = {}) => `/seo/local-grid${qs({ site: siteId, ...p })}`,

  /**
   * AI visibility for one site; `month` "YYYY-MM"; `assistant` an assistant name; `question` a tracked question id;
   * `named` true narrows to answers that named the business, `cited` to answers that used its website, `first` to
   * answers that named it first; `business` to answers naming another business; `source` to answers that drew on one
   * website; `prompt` opens one question by its words (a question that is not tracked has no id; the usage page's
   * ledger keeps the first 90 characters, which open the one question they begin). `vs` "YYYY-MM" is the earlier
   * month the like-for-like comparison is made against (the picker on the page writes it).
   * Appended 2026-10-09 (summary figures): `latest` true narrows to the newest answer to each question from each
   * assistant (what "The picture so far" counts), `days` to answers from the last N days (its window); `mentions` a
   * website fills the "Where AI answers already use a website" box (a saved result is shown free; nothing is bought),
   * `platform` google | chat_gpt which AI that box asks about.
   */
  ai: (siteId: number, p: { month?: string; assistant?: string; question?: number; named?: boolean; cited?: boolean; first?: boolean; business?: string; source?: string; prompt?: string; vs?: string; latest?: boolean; days?: number; mentions?: string; platform?: "google" | "chat_gpt" } = {}) => `/seo/ai${qs({ site: siteId, ...p })}`,

  /** Alerts; `kind` narrows to one kind, `site` to one site. */
  alerts: (p: { site?: number; kind?: string; /** The keyword watch on the page: compare snapshot `now` with `before` (ids), `watch` opens its added | gone | pages list, `watchAll` true lists every row of it. */ now?: number; before?: number; watch?: "added" | "gone" | "pages"; watchAll?: boolean; /** Appended (alerts, round 2): `alert` an alert's id scrolls to and outlines it (the chip says when it is not among the alerts loaded); `undelivered` true narrows to the alerts whose delivery was given up. */ alert?: number; undelivered?: boolean; /** Appended (round 3): the reveals as addresses — `all` the alerts (ids, comma-separated) whose every movement or kept keyword is listed, not only the first ones; `more` how many pages of older alerts are listed after the newest page ("Show more" adds one). */ all?: string; more?: number } = {}) => `/seo/alerts${qs(p)}`,

  /**
   * Action plan for one site; `task` scrolls to one task, `status` open | done | overdue (also todo | doing | dropped |
   * closed = done and dropped); `kind` narrows to one kind of task (keyword, page, link_reclaim, link_prospect, audit, other);
   * `due` "soon" narrows the open tasks to those due today or in the next 7 days; `owner` to one person's tasks.
   */
  plan: (siteId: number, p: { task?: number; status?: string; kind?: string; due?: "soon"; owner?: string } = {}) => `/seo/plan${qs({ site: siteId, ...p })}`,

  /** Mentions for one site; `check` opens one watched check (an alert's); `tab` prospects | yours | unsure | linked | notMine | all. */
  mentions: (siteId: number, p: { check?: number; tab?: string } = {}) => `/seo/mentions${qs({ site: siteId, ...p })}`,

  /** Usage and credit; `credits` "add" opens the add-credit panel; `month` "YYYY-MM" narrows the lookups to one month. */
  usage: (p: { credits?: "add"; month?: string } = {}) => `/seo/usage${qs(p)}`,

  /** The other SEO pages, for completeness. `competitor` fills the competitor box (nothing is bought until the button is pressed). */
  competitors: (siteId: number, p: { competitor?: string } = {}) => `/seo/competitors${qs({ site: siteId, ...p })}`,
  batch: () => "/seo/batch",

  /** The Search Console connection (Settings): where a site's property is connected — the place a missing property leads. */
  searchConsole: () => "/search-console",

  /**
   * The dashboard's site list itself (the portfolio strip scrolls to it): the same parameters as `dashboard`, and the
   * address ends in `#sites`, the list's anchor, so a visitor lands on the cards rather than the top of the page.
   */
  dashboardSites: (p: { group?: string; sort?: string; filter?: "analysed" | "crawled" } = {}) => `/seo${qs(p)}#sites`,

  /**
   * Appended 2026-10-09 (reports, grid, alerts, round 2): the app's own pages an SEO screen points to — Settings (`tab`
   * notifications is where alert emails are chosen), Site Scan (its Branding names the reports), the plans.
   */
  appSettings: (p: { tab?: string } = {}) => `/settings${qs(p)}`,
  siteScan: () => "/site-scan",
  pricing: () => "/pricing",

  /**
   * Appended 2026-10-09 (local grid): a business's own listing on Google Maps, outside the app — where Google's stars and
   * review count live (no view here holds them). With Google's listing id (`cid`) it is that listing; without one, a
   * Maps search for its name and address.
   */
  googleMaps: (p: { cid?: string | null; name: string; address?: string | null }) =>
    p.cid && /^\d{1,25}$/.test(p.cid) ? `https://www.google.com/maps?cid=${p.cid}` : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([p.name, p.address].filter(Boolean).join(", "))}`,

  /**
   * Appended (round 3, the shell's nav): the plain address of each section whose builder above needs a site. The nav
   * tabs carry no site — the page opens on the site remembered in this browser (or the first one), see useSelectedSite.
   */
  rankTrackerHome: () => "/seo/rank-tracker",
  localGridHome: () => "/seo/local-grid",
  planHome: () => "/seo/plan",
  auditHome: () => "/seo/audit",
  aiHome: () => "/seo/ai",
  reportsHome: () => "/seo/reports",
  backlinksHome: () => "/seo/backlinks",

  /**
   * Appended (round 3, usage): Keywords explorer's Service × town planner for one site — the page a "Service-area
   * planner" lookup was made on (the planner opens that site's saved services and towns; nothing is bought on arrival).
   */
  servicePlanner: (siteId: number) => `/seo/keywords${qs({ view: "area", site: siteId })}`,
} as const;

/** Read one parameter of the current address (the pages honour the names above). */
export const readParam = (name: string): string | null => new URLSearchParams(window.location.search).get(name);

/**
 * Replace a parameter in the current address without reloading, so a filter chosen on the page is the same as one
 * arrived at by link (and the back button undoes it). An empty value removes the parameter.
 */
export function setParam(name: string, value: string | number | boolean | null | undefined, replace = false): void {
  const p = new URLSearchParams(window.location.search);
  if (value == null || value === "" || value === false) p.delete(name); else p.set(name, String(value));
  const s = p.toString();
  const url = `${window.location.pathname}${s ? `?${s}` : ""}${window.location.hash}`;
  if (replace) window.history.replaceState({}, "", url); else window.history.pushState({}, "", url);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

/**
 * Replace several parameters of the current address at once — one history entry, so one "Apply filters" is one step
 * back. The same rules as setParam: an empty value removes the parameter; `replace` rewrites the entry instead.
 */
export function setParams(values: Record<string, string | number | boolean | null | undefined>, replace = false): void {
  const p = new URLSearchParams(window.location.search);
  for (const [name, value] of Object.entries(values)) { if (value == null || value === "" || value === false) p.delete(name); else p.set(name, String(value)); }
  const s = p.toString();
  const url = `${window.location.pathname}${s ? `?${s}` : ""}${window.location.hash}`;
  if (replace) window.history.replaceState({}, "", url); else window.history.pushState({}, "", url);
  window.dispatchEvent(new PopStateEvent("popstate"));
}
