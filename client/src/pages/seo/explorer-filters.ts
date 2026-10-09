/**
 * Site Explorer's report filters as words in the address, and back. links.ts names the words (band, pos, intent,
 * followed, tld, anchor, contains, volumeMin, difficultyMax, everyLink, path, section, move, month, sort, source,
 * why); this file says what each narrows for a given report, and the words the chip (data-testid="active-filter")
 * shows for it — and, for the overview, what month / from / to / series / quick ask (overviewWords). Pure — no
 * React, no window — so server/seo/explorer-links.test.ts can run it. report-table.tsx reads a report's filters from
 * here on arrival and writes them back when "Apply filters" is pressed, so a link and a picked filter are one thing.
 * Round 3: the order the address picked (`sort`) is said in the chip too, and the page of rows (`offset`, `limit`)
 * is read here (pageFromAddress) — paging is the address, so the back button undoes a page turn.
 */
import type { Movement, PositionBand } from "./links";

export type TableKey =
  | "keywords" | "paidKeywords" | "pages" | "competitors" | "backlinks" | "newBacklinks" | "lostBacklinks" | "brokenBacklinks"
  | "referringDomains" | "anchors" | "bestByLinks" | "referringIps" | "linkCompetitors" | "subdomains" | "ads" | "matchingTerms" | "relatedTerms" | "questions";
export type Filters = {
  positionMin?: number; positionMax?: number; volumeMin?: number; volumeMax?: number; difficultyMin?: number; difficultyMax?: number;
  intent?: string; contains?: string; follow?: "followed" | "nofollow"; everyLink?: boolean;
};
export type Scope = { path: string; exact: boolean };

/** Which reports have which filter box (the server's own list is server/seo/reports.ts FILTERS_OF). */
export const HAS: Record<string, TableKey[]> = {
  position: ["keywords"],
  volume: ["keywords", "paidKeywords", "matchingTerms", "relatedTerms", "questions"],
  difficulty: ["keywords", "matchingTerms", "relatedTerms", "questions"],
  intent: ["keywords", "matchingTerms", "questions"],
  contains: ["keywords", "paidKeywords", "pages", "competitors", "backlinks", "newBacklinks", "lostBacklinks", "referringDomains", "anchors", "bestByLinks", "matchingTerms", "questions"],
  follow: ["backlinks", "newBacklinks", "lostBacklinks", "brokenBacklinks"],
  everyLink: ["backlinks", "newBacklinks", "lostBacklinks"],
};
/** Reports that can be narrowed to one section or one page of the site (server/seo/reports.ts SCOPED_TABLES). */
export const SCOPED: ReadonlySet<TableKey> = new Set<TableKey>(["keywords", "paidKeywords", "pages", "backlinks", "newBacklinks", "lostBacklinks", "brokenBacklinks", "bestByLinks"]);
/** Reports whose "contains" box searches the anchor text. */
const ANCHOR_TABLES: ReadonlySet<TableKey> = new Set<TableKey>(["backlinks", "newBacklinks", "lostBacklinks", "anchors"]);
export const INTENTS = ["informational", "navigational", "commercial", "transactional"] as const;
const has = (f: string, table: TableKey) => HAS[f]?.includes(table) ?? false;
/** The orders each report offers (the server's SORTS, server/seo/reports.ts), with the words on the picker. The first is the default. */
export const SORT_LABELS: Record<TableKey, [string, string][]> = {
  keywords: [["traffic", "Most traffic"], ["volume", "Highest volume"], ["position", "Best position"], ["difficulty", "Easiest"], ["cpc", "Highest CPC"]],
  paidKeywords: [["traffic", "Most traffic"], ["volume", "Highest volume"], ["cpc", "Highest CPC"]],
  pages: [["traffic", "Most traffic"], ["keywords", "Most keywords"]],
  competitors: [["shared", "Most shared keywords"]],
  backlinks: [["authority", "Strongest sites"], ["newest", "Newest"], ["oldest", "Oldest"]],
  newBacklinks: [["newest", "Newest"], ["authority", "Strongest sites"]],
  lostBacklinks: [["newest", "Most recently lost"], ["authority", "Strongest sites"]],
  brokenBacklinks: [["authority", "Strongest sites"], ["newest", "Newest"]],
  referringDomains: [["authority", "Strongest sites"], ["links", "Most links"], ["newest", "Newest"]],
  anchors: [["links", "Most backlinks"], ["domains", "Most domains"]],
  bestByLinks: [["links", "Most backlinks"], ["domains", "Most domains"]],
  referringIps: [["domains", "Most linking sites"], ["links", "Most links"]],
  linkCompetitors: [["shared", "Most shared linking sites"]],
  subdomains: [["traffic", "Most traffic"], ["keywords", "Most keywords"]],
  ads: [["newest", "Most recently shown"]],
  matchingTerms: [["volume", "Highest volume"], ["difficulty", "Easiest"], ["cpc", "Highest CPC"]],
  relatedTerms: [["volume", "Highest volume"], ["difficulty", "Easiest"]],
  questions: [["volume", "Highest volume"], ["difficulty", "Easiest"]],
};
/** A sort the report lists, or its default (never something every object has, like "constructor"). */
export const sortKeyOf = (table: TableKey, sort: string | null | undefined) => (sort && SORT_LABELS[table].some(([k]) => k === sort) ? sort : SORT_LABELS[table][0][0]);
/** The words on the picker for an order. */
export const sortWords = (table: TableKey, sort: string | null | undefined) => SORT_LABELS[table].find(([k]) => k === sortKeyOf(table, sort))?.[1] ?? "";
/** Reports whose first-seen date is an order they offer ("newest"): a date cell leads to the list in that order. */
export const SORTS_BY_DATE: ReadonlySet<TableKey> = new Set<TableKey>(["backlinks", "newBacklinks", "lostBacklinks", "brokenBacklinks", "referringDomains"]);
/** The band of one position, for a position cell: the same words the distribution bars use. */
export const bandOfPosition = (pos: number | null | undefined): { band?: PositionBand; pos?: string } | null =>
  pos == null || pos < 1 ? null : pos <= 3 ? { band: "top3" } : pos <= 10 ? { pos: "4-10" } : pos <= 20 ? { pos: "11-20" } : pos <= 50 ? { pos: "21-50" } : pos <= 100 ? { pos: "51-100" } : { pos: "101-" };

/** The rows a full report shows per page (its Rows picker); the first of these that is the default is never written. */
export const LIMITS = [25, 50, 100] as const;
export const DEFAULT_LIMIT = 50;
/** The furthest first row a report is paged to (the source gives no row past 10,000). */
export const MAX_OFFSET = 9900;
/**
 * The address's `limit` and `offset` (links.ts) as a page of rows: a page size the picker offers (else the default),
 * and a first row that is a whole number of pages in and no further than `max` (else the first page). Pure.
 */
export function pageFromAddress(p: { limit?: string | null; offset?: string | null }, limits: readonly number[] = LIMITS, fallback: number = DEFAULT_LIMIT, max: number = MAX_OFFSET): { limit: number; offset: number } {
  const l = Number(p.limit), limit = limits.includes(l) ? l : fallback;
  const o = p.offset && /^\d{1,6}$/.test(p.offset) ? Number(p.offset) : 0;
  return { limit, offset: o > 0 && o % limit === 0 && o <= max ? o : 0 };
}

/** The positions a band covers (from, to): the same words the distribution bars use. notFound has no rows in a site report. */
export const BAND_RANGE: Record<PositionBand, [number, number | undefined] | null> = {
  top3: [1, 3], top10: [1, 10], top20: [1, 20], top50: [1, 50], top100: [1, 100], rest: [11, undefined], notFound: null,
};
const BANDS = Object.keys(BAND_RANGE) as PositionBand[];
const MOVE_WORDS: Record<Movement, string> = { up: "moved up", down: "moved down", new: "newly ranking", lost: "lost", unchanged: "unchanged" };

/**
 * What was typed, as a path on the site. A pasted address must be on this site (with or without "www") — one from
 * another site is refused, not quietly applied here; its #fragment is dropped (a place on a page, not a page);
 * "blog" becomes "/blog". Pure.
 */
export function scopePathOf(raw: string, domain: string): { path: string } | { error: string } {
  let v = raw.trim();
  const site = domain.toLowerCase().replace(/^www\./, "");
  const bad = { error: "Enter a path on this site, such as /blog/ — no spaces." };
  if (!v) return bad;
  // An address in any of the ways one is pasted: with its scheme, without it ("//host/…"), or starting with the site's own name.
  const asUrl = /^https?:\/\//i.test(v) ? v : v.startsWith("//") ? `https:${v}` : new RegExp(`^(www\\.)?${site.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([:/]|$)`, "i").test(v) ? `https://${v}` : null;
  if (asUrl) {
    let u: URL; try { u = new URL(asUrl); } catch { return bad; }
    const host = u.hostname.toLowerCase().replace(/^www\./, "");
    if (host !== site) return { error: `That address is on ${u.hostname}, not ${domain}. Open that site in Site explorer to look at its pages${host.endsWith(`.${site}`) ? " — a sub-domain is its own site here" : ""}.` };
    // What cannot be matched is said, not quietly dropped: another port is another site to a browser, and a sign-in is not part of an address.
    if (u.port) return { error: `That address is on port ${u.port}. Only the site's ordinary address can be looked at here — leave the port out if the page is the same.` };
    if (u.username || u.password) return { error: "Leave the user name and password out of the address." };
    v = u.pathname + u.search;
  } else {
    v = v.split("#")[0];
    if (!v.startsWith("/")) v = `/${v}`;
  }
  // A "?" with nothing after it is no query (the server reads it the same way) — only when it is the first "?".
  if (v.indexOf("?") === v.length - 1) v = v.slice(0, -1);
  return /^\/(?!\/)[^\s\\#]*$/.test(v) && v.length <= 300 ? { path: v } : bad;
}
/** The one spelling of a scope (the server's rule, server/seo/reports.ts canonicalScope): no last slash unless there is a query; the section "/" is the whole site. */
export function canonicalScope(path: string, exact: boolean): Scope | null {
  const q = path.indexOf("?") === path.length - 1 ? path.slice(0, -1) : path;
  const p = q.includes("?") ? q : q.replace(/\/+$/, "") || "/";
  return p === "/" && !exact ? null : { path: p, exact };
}
/** A page's path (with its query) on this site, for `path` — or null when the address is not on this site. */
export function pathOfUrl(url: string | null | undefined, domain: string): string | null {
  if (!url) return null;
  const r = scopePathOf(url, domain);
  return "path" in r ? canonicalScope(r.path, true)?.path ?? null : null;
}

const num = (v: string | undefined) => (v != null && /^\d{1,7}$/.test(v) ? Number(v) : undefined);
const text = (v: string | undefined) => (v ?? "").replace(/[%_\\]/g, "").trim().slice(0, 80) || undefined;
/** A range in the address: "4-10", "11-" (from 11 down), "-20" (the top 20). */
const parsePos = (v: string | undefined): [number | undefined, number | undefined] | null => {
  const m = v?.match(/^(\d{1,4})?-(\d{1,4})?$/);
  if (!m || (m[1] == null && m[2] == null)) return null;
  const a = m[1] == null ? undefined : Number(m[1]), b = m[2] == null ? undefined : Number(m[2]);
  return a != null && b != null && a > b ? null : [a, b];
};

/**
 * The address as a report's filters — only the ones that report has (a band on the pages report narrows nothing and
 * is simply not applied). `pos` wins over `band`; `path` (one page) wins over `section`.
 */
export function filtersFromAddress(table: TableKey, p: Record<string, string | undefined>, domain?: string): { filters: Filters; scope: Scope | null } {
  const f: Filters = {};
  if (has("position", table)) {
    const pos = parsePos(p.pos), band = BANDS.includes(p.band as PositionBand) ? BAND_RANGE[p.band as PositionBand] : null;
    const r = pos ?? band;
    if (r) { if (r[0] != null && r[0] > 0) f.positionMin = r[0]; if (r[1] != null) f.positionMax = r[1]; }
  }
  if (has("volume", table) && num(p.volumeMin) != null) f.volumeMin = num(p.volumeMin);
  if (has("difficulty", table) && num(p.difficultyMax) != null) f.difficultyMax = num(p.difficultyMax);
  if (has("intent", table) && (INTENTS as readonly string[]).includes(p.intent ?? "")) f.intent = p.intent;
  if (has("follow", table) && (p.followed === "true" || p.followed === "false")) f.follow = p.followed === "true" ? "followed" : "nofollow";
  if (has("everyLink", table) && p.everyLink === "true") f.everyLink = true;
  if (has("contains", table)) {
    const anchor = ANCHOR_TABLES.has(table) ? text(p.anchor) : undefined;
    const tld = table === "referringDomains" && p.tld ? text(p.tld.startsWith(".") ? p.tld : `.${p.tld}`) : undefined;
    const c = anchor ?? tld ?? text(p.contains);
    if (c) f.contains = c;
  }
  let scope: Scope | null = null;
  if (SCOPED.has(table) && domain) {
    const exact = !!p.path, raw = p.path || p.section;
    const parsed = raw ? scopePathOf(raw, domain) : null;
    if (parsed && "path" in parsed) scope = canonicalScope(parsed.path, exact);
  }
  return { filters: f, scope };
}

/** Every filter word the explorer address can carry, so a write clears the ones no longer set. */
export const FILTER_PARAMS = ["band", "pos", "intent", "followed", "tld", "anchor", "contains", "volumeMin", "difficultyMax", "everyLink", "path", "section", "move", "why", "source"] as const;

/** A report's applied filters as address words — one entry per word, null where it is not set. */
export function addressFromFilters(table: TableKey, f: Filters, scope: Scope | null): Record<(typeof FILTER_PARAMS)[number], string | number | boolean | null> {
  const out = Object.fromEntries(FILTER_PARAMS.map((k) => [k, null])) as Record<(typeof FILTER_PARAMS)[number], string | number | boolean | null>;
  if (f.positionMin != null || f.positionMax != null) {
    const band = BANDS.find((b) => { const r = BAND_RANGE[b]; return r && (r[0] === (f.positionMin ?? 1)) && r[1] === f.positionMax; });
    if (band) out.band = band; else out.pos = `${f.positionMin ?? ""}-${f.positionMax ?? ""}`;
  }
  if (f.intent) out.intent = f.intent;
  if (f.follow) out.followed = f.follow === "followed" ? "true" : "false";
  if (f.contains) {
    if (ANCHOR_TABLES.has(table)) out.anchor = f.contains;
    else if (table === "referringDomains" && f.contains.startsWith(".")) out.tld = f.contains;
    else out.contains = f.contains;
  }
  if (f.volumeMin != null) out.volumeMin = f.volumeMin;
  if (f.difficultyMax != null) out.difficultyMax = f.difficultyMax;
  if (f.everyLink) out.everyLink = true;
  if (scope) { if (scope.exact) out.path = scope.path; else out.section = scope.path; }
  return out;
}

/** "2026-03" → "Mar 2026"; anything else as it is. */
const monthWords = (m: string) => (/^\d{4}-\d{2}$/.test(m) ? new Date(`${m}-15T12:00:00Z`).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" }) : m);
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const WHY: Record<string, string> = {
  spam: "Opened from a spam score: no view lists spam scores — these are the site's own links, which the score is judged from",
  ip: "Opened from a server address: no view lists the sites on one address — this is the whole list",
  shared: "Opened from a shared count: the list of what two sites share is in Content gap / Link intersect — this is the whole list",
};
/** A key of a plain word table — never something every object has ("constructor"). */
const own = (table: Record<string, unknown>, key: string | undefined): key is string => !!key && Object.prototype.hasOwnProperty.call(table, key);
const ROWS: Partial<Record<TableKey, string>> = { keywords: "Keywords", paidKeywords: "Paid keywords", pages: "Pages", competitors: "Competitors", backlinks: "Links", newBacklinks: "New links", lostBacklinks: "Lost links", brokenBacklinks: "Broken links", referringDomains: "Referring domains", anchors: "Anchors", bestByLinks: "Pages", matchingTerms: "Keywords", relatedTerms: "Keywords", questions: "Questions" };

/**
 * The words a visitor reads in the chip for what narrows a report: the applied filters and scope, and the address
 * words that name something this list cannot be split by (a movement, a month) — said, never quietly dropped.
 * `p` is the address (empty when the report is not driven by one).
 */
export function filterWords(table: TableKey, f: Filters, scope: Scope | null, p: Record<string, string | undefined> = {}, sort?: string | null): string[] {
  const w: string[] = [];
  const rows = ROWS[table] ?? "Rows";
  // Followed / not followed referring domains are shown as links one per linking site: the referring-domains list has no follow split.
  if (p.view === "referringDomains" && table === "backlinks" && f.follow) {
    w.push(`${f.follow === "followed" ? "Followed" : "Not followed"} referring domains — shown as ${f.follow} links, one per linking site (the referring-domains list can't be split by follow)`);
    if (p.tld) w.push(`The ending ${p.tld.startsWith(".") ? p.tld : `.${p.tld}`} was not applied: the links list has no ending filter, so every ending is shown`);
  } else if (f.follow) w.push(`${f.follow === "followed" ? "Followed" : "Nofollow"} links only`);
  if (f.positionMin != null || f.positionMax != null) {
    const a = f.positionMin ?? 1, b = f.positionMax;
    w.push(a <= 1 && b != null ? `${rows} in the top ${b}` : b == null ? `${rows} from position ${a} down` : `${rows} in positions ${a}–${b}`);
  } else if (has("position", table) && p.band === "notFound") w.push(`${rows} not in the top 100 aren't listed — every keyword is shown`);
  if (f.intent) w.push(`${cap(f.intent)} ${rows.toLowerCase()}`);
  if (f.contains) {
    if (table === "anchors") w.push(`Anchors containing “${f.contains}”`);
    else if (ANCHOR_TABLES.has(table)) w.push(`${rows} with the anchor “${f.contains}”`);
    else if (table === "referringDomains") w.push(f.contains.startsWith(".") ? `Referring domains ending ${f.contains} (name contains “${f.contains}”)` : `Referring domains containing “${f.contains}”`);
    else if (table === "pages" || table === "bestByLinks") w.push(`Pages whose address contains “${f.contains}”`);
    else if (table === "competitors") w.push(`Domains containing “${f.contains}”`);
    else w.push(`${rows} containing “${f.contains}”`);
  }
  if (f.volumeMin != null) w.push(`Volume ≥ ${f.volumeMin.toLocaleString("en-US")}`);
  if (f.difficultyMax != null) w.push(`Difficulty ≤ ${f.difficultyMax}`);
  if (f.everyLink) w.push("Every link, not one per site");
  else if (p.everyLink === "true" && table === "brokenBacklinks") w.push("Every link can't be chosen for broken links — one link per site is shown");
  if (scope) w.push(scope.exact ? `On the page ${scope.path}` : `Under ${scope.path}/`);
  if ((table === "keywords" || table === "paidKeywords") && own(MOVE_WORDS, p.move)) w.push(`Keywords that ${MOVE_WORDS[p.move as Movement]} since last month — the saved report counts them but doesn't list which, so every keyword is shown`);
  // The list's real order is said with the month (links.ts `sort`): a month never changes the order, and the chip never promises one the list doesn't have.
  if (p.month && /^\d{4}-\d{2}$/.test(p.month)) { const order = sortWords(table, sort); w.push(`${monthWords(p.month)} picked on the chart — this list isn't split by month${order ? `; it is ordered by “${order.toLowerCase()}”` : ""}`); }
  // The order the address picked (links.ts `sort`, which the Sort picker writes), said when it is not the list's
  // first — and an order this list doesn't offer is said as such. With a month, the month's words already name it.
  else if (p.sort) {
    if (!SORT_LABELS[table].some(([k]) => k === p.sort)) w.push(`“${p.sort}” is not an order this list offers, so it is ordered by “${sortWords(table, null)}”`);
    else if (p.sort !== SORT_LABELS[table][0][0]) w.push(`Ordered by “${sortWords(table, p.sort)}”`);
  }
  if (p.source && (table === "backlinks" || table === "newBacklinks" || table === "lostBacklinks" || table === "brokenBacklinks")) w.push(`Opened from ${p.source}: the links can't be narrowed to one linking site yet — every linking site is shown; the Linking page column names each`);
  if (own(WHY, p.why)) w.push(WHY[p.why]);
  return w;
}

/** The overview's first-look tables (links.ts `quick`) and chart figures (`series`), in the chip's words. */
const QUICK_WORDS: Record<string, string> = { keywords: "Organic keywords", pages: "Top pages", competitors: "Organic competitors", referringDomains: "Referring domains", anchors: "Anchors" };
const SERIES_WORDS: Record<string, string> = { traffic: "Organic traffic", keywords: "Organic keywords", top10: "Keywords in top 10", domains: "Referring domains", backlinks: "Backlinks", new: "New links that month", lost: "Lost links that month" };
/** The overview's own address words, so a clear can remove them together. */
export const OVERVIEW_PARAMS = ["month", "from", "to", "series", "quick"] as const;

/**
 * What the address asks of the overview (links.ts: `month` marks a month on the charts and opens the comparison,
 * `from` / `to` are the months compared, `series` the chart figure, `quick` the first-look table), in a visitor's
 * words for the chip (data-testid="active-filter"). A word that names nothing here is said, never quietly dropped.
 * `drawn` — once the report is on screen — is the chart figures drawn (a chart needs two months of figures): a
 * `series` whose chart isn't drawn is said as not shown, never named as if it were on screen. Empty when the address
 * asks nothing. Pure.
 */
export function overviewWords(p: Record<string, string | undefined>, drawn?: ReadonlySet<string>): string[] {
  const w: string[] = [];
  const isMonth = (v: string | undefined): v is string => !!v && /^\d{4}-\d{2}$/.test(v);
  const notMonth = (v: string) => `“${v}” is not a month (YYYY-MM), so it was not used`;
  if (p.month) w.push(isMonth(p.month) ? `${monthWords(p.month)} picked on the chart — marked on both charts and opened in the comparison` : notMonth(p.month));
  if (isMonth(p.from) && isMonth(p.to)) w.push(`Comparing ${monthWords(p.from)} with ${monthWords(p.to)}`);
  else {
    if (p.from) w.push(isMonth(p.from) ? `Comparing from ${monthWords(p.from)}` : notMonth(p.from));
    if (p.to) w.push(isMonth(p.to) ? `Comparing to ${monthWords(p.to)}` : notMonth(p.to));
  }
  if (p.series) w.push(!own(SERIES_WORDS, p.series) ? `“${p.series}” is not a chart figure here, so the first figure is shown`
    : drawn && !drawn.has(p.series) ? `Chart figure ${SERIES_WORDS[p.series]} is not shown: its chart isn't drawn for this site (it needs two months of figures or more)`
    : `Chart figure: ${SERIES_WORDS[p.series]}`);
  if (p.quick) w.push(own(QUICK_WORDS, p.quick) ? `First look: ${QUICK_WORDS[p.quick]}` : `“${p.quick}” is not a first-look table here, so Organic keywords is shown`);
  return w;
}
