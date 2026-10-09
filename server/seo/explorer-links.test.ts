/**
 * Site Explorer's links (owner 2026-10-09: every figure takes you somewhere). The addresses come from one place
 * (client/src/pages/seo/links.ts); the words in them become a report's filters and back through the pure module
 * client/src/pages/seo/explorer-filters.ts, and the chip (data-testid="active-filter") says what narrowed the list.
 * Every cell of every table is pinned to its builder call here (report-table.tsx COLS, the overview's first-look
 * tables, the Directories view), so a cell that goes back to plain text fails a test, not a visitor.
 * Pure module + source guards, no browser.
 */
import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import { seoLinks } from "../../client/src/pages/seo/links";
import { addressFromFilters, BAND_RANGE, bandOfPosition, DEFAULT_LIMIT, filtersFromAddress, filterWords, LIMITS, MAX_OFFSET, OVERVIEW_PARAMS, overviewWords, pageFromAddress, pathOfUrl, sortKeyOf, SORTS_BY_DATE, sortWords } from "../../client/src/pages/seo/explorer-filters";

const read = (rel: string) => fs.readFileSync(path.resolve(import.meta.dirname, "../../client/src/pages/seo", rel), "utf8");
/** Comments aside; only code counts. */
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const words = (url: string) => Object.fromEntries(new URL(url, "http://x").searchParams) as Record<string, string | undefined>;
/** The one cell of a table whose test id this is: the source from the id's first mention to the end of that line. */
const cellOf = (src: string, testId: string) => { const at = src.indexOf(`"${testId}"`); expect(at, testId).toBeGreaterThan(-1); const from = src.lastIndexOf("\n", at); return src.slice(from, src.indexOf("\n", at)); };

describe("the explorer builder", () => {
  it("writes the view and every filter word, and leaves the overview unnamed", () => {
    expect(seoLinks.explorer("example.com")).toBe("/seo/explorer?domain=example.com");
    expect(seoLinks.explorer("example.com", "overview")).toBe("/seo/explorer?domain=example.com");
    expect(seoLinks.explorer("example.com", "keywords", { band: "top3" })).toBe("/seo/explorer?domain=example.com&view=keywords&band=top3");
    expect(words(seoLinks.explorer("example.com", "keywords", { pos: "4-10", intent: "commercial", move: "up", month: "2026-08" }))).toMatchObject({ view: "keywords", pos: "4-10", intent: "commercial", move: "up", month: "2026-08" });
    expect(words(seoLinks.explorer("example.com", "referringDomains", { followed: true, tld: ".org" }))).toMatchObject({ followed: "true", tld: ".org" });
    expect(words(seoLinks.explorer("example.com", "backlinks", { anchor: "roof repair", path: "/services/roofing", everyLink: true }))).toMatchObject({ anchor: "roof repair", path: "/services/roofing", everyLink: "true" });
    // "false" is a word for the follow filter; an unset one is no word at all.
    expect(seoLinks.explorer("example.com", "referringDomains", { followed: false })).toBe("/seo/explorer?domain=example.com&view=referringDomains&followed=false");
    expect(seoLinks.explorer("example.com", "pages", { path: "/a b?x=1" })).toContain("path=%2Fa+b%3Fx%3D1");
  });
  it("round 2: the country in full, the order, the chart figure, the first look, the months compared, a linking site, a why, the directories compared", () => {
    expect(words(seoLinks.explorer("example.com", "keywords", { locationCode: 2840, languageCode: "es", sort: "position" }))).toMatchObject({ locationCode: "2840", languageCode: "es", sort: "position" });
    expect(words(seoLinks.explorer("example.com", "overview", { month: "2026-08", series: "backlinks", quick: "pages", from: "2025-08", to: "2026-08" }))).toEqual({ domain: "example.com", month: "2026-08", series: "backlinks", quick: "pages", from: "2025-08", to: "2026-08" });
    expect(words(seoLinks.explorer("example.com", "backlinks", { source: "yelp.com" }))).toMatchObject({ view: "backlinks", source: "yelp.com" });
    expect(words(seoLinks.explorer("other.com", "backlinks", { why: "spam" }))).toMatchObject({ domain: "other.com", why: "spam" });
    expect(words(seoLinks.explorer("example.com", "directories", { rivals: "a.com,b.com", only: "gaps" }))).toMatchObject({ view: "directories", rivals: "a.com,b.com", only: "gaps" });
    expect(words(seoLinks.explorer("example.com", "directories", { rivals: "none" }))).toMatchObject({ rivals: "none" });
  });
});

describe("the address as a report's filters", () => {
  it("a band is a position range; pos says the ranges the bands do not; the rest of the words land on their boxes", () => {
    expect(BAND_RANGE.top3).toEqual([1, 3]); expect(BAND_RANGE.top10).toEqual([1, 10]); expect(BAND_RANGE.rest).toEqual([11, undefined]); expect(BAND_RANGE.notFound).toBeNull();
    expect(filtersFromAddress("keywords", { band: "top10" }).filters).toEqual({ positionMin: 1, positionMax: 10 });
    expect(filtersFromAddress("keywords", { band: "rest" }).filters).toEqual({ positionMin: 11 });
    expect(filtersFromAddress("keywords", { pos: "4-10", band: "top3" }).filters).toEqual({ positionMin: 4, positionMax: 10 });
    expect(filtersFromAddress("keywords", { pos: "21-" }).filters).toEqual({ positionMin: 21 });
    expect(filtersFromAddress("keywords", { pos: "10-4" }).filters).toEqual({});
    expect(filtersFromAddress("keywords", { band: "notFound" }).filters).toEqual({});
    expect(filtersFromAddress("keywords", { intent: "commercial", volumeMin: "100", difficultyMax: "30" }).filters).toEqual({ intent: "commercial", volumeMin: 100, difficultyMax: 30 });
    expect(filtersFromAddress("keywords", { intent: "shopping" }).filters).toEqual({});
    expect(filtersFromAddress("backlinks", { followed: "true", anchor: "roof repair", everyLink: "true" }).filters).toEqual({ follow: "followed", contains: "roof repair", everyLink: true });
    expect(filtersFromAddress("brokenBacklinks", { followed: "false" }).filters).toEqual({ follow: "nofollow" });
    expect(filtersFromAddress("referringDomains", { tld: "org" }).filters).toEqual({ contains: ".org" });
    expect(filtersFromAddress("anchors", { anchor: "roof%_repair" }).filters).toEqual({ contains: "roofrepair" });
    expect(filtersFromAddress("pages", { contains: "blog" }).filters).toEqual({ contains: "blog" });
  });

  it("a word the report has no box for narrows nothing — it is not applied somewhere else", () => {
    expect(filtersFromAddress("pages", { band: "top3", intent: "commercial", followed: "true" }).filters).toEqual({});
    expect(filtersFromAddress("referringDomains", { followed: "true" }).filters).toEqual({});
    expect(filtersFromAddress("referringIps", { contains: "x", tld: ".com" }).filters).toEqual({});
    // Every link is not a choice the broken-links report has (the server's own list): the chip says so instead.
    expect(filtersFromAddress("brokenBacklinks", { everyLink: "true" }).filters).toEqual({});
  });

  it("path is one page exactly, section everything under a path, both on this site only", () => {
    expect(filtersFromAddress("keywords", { path: "/services/roofing/" }, "example.com").scope).toEqual({ path: "/services/roofing", exact: true });
    expect(filtersFromAddress("keywords", { section: "/blog/" }, "example.com").scope).toEqual({ path: "/blog", exact: false });
    expect(filtersFromAddress("keywords", { path: "https://www.example.com/a?x=1" }, "example.com").scope).toEqual({ path: "/a?x=1", exact: true });
    expect(filtersFromAddress("keywords", { path: "https://other.com/a" }, "example.com").scope).toBeNull();
    expect(filtersFromAddress("referringDomains", { path: "/a" }, "example.com").scope).toBeNull();
    expect(filtersFromAddress("keywords", { path: "/a" }).scope).toBeNull();
    expect(pathOfUrl("https://www.example.com/blog/post/?utm=1", "example.com")).toBe("/blog/post/?utm=1");
    expect(pathOfUrl("https://example.com/", "example.com")).toBe("/");
    expect(pathOfUrl("https://blog.example.com/x", "example.com")).toBeNull();
  });

  it("a picked filter writes the same words a link does, and clears the ones it no longer has", () => {
    const back = (table: Parameters<typeof addressFromFilters>[0], p: Record<string, string>) => { const { filters, scope } = filtersFromAddress(table, p, "example.com"); return addressFromFilters(table, filters, scope); };
    expect(back("keywords", { band: "top10" })).toMatchObject({ band: "top10", pos: null });
    expect(back("keywords", { band: "rest" })).toMatchObject({ band: "rest", pos: null });
    expect(back("keywords", { pos: "4-10" })).toMatchObject({ band: null, pos: "4-10" });
    expect(back("keywords", { intent: "commercial", path: "/a", move: "up" })).toMatchObject({ intent: "commercial", path: "/a", section: null, move: null });
    expect(back("keywords", { section: "/blog/" })).toMatchObject({ path: null, section: "/blog" });
    expect(back("backlinks", { followed: "false", anchor: "roof" })).toMatchObject({ followed: "false", anchor: "roof", contains: null, tld: null });
    expect(back("referringDomains", { tld: "com" })).toMatchObject({ tld: ".com", contains: null });
    expect(back("referringDomains", { contains: "news" })).toMatchObject({ tld: null, contains: "news" });
    expect(addressFromFilters("keywords", { positionMin: 5, positionMax: undefined }, null)).toMatchObject({ pos: "5-", band: null });
    expect(Object.values(addressFromFilters("keywords", {}, null)).every((v) => v === null)).toBe(true);
    // A clear removes the words that only name where a link came from, too.
    expect(addressFromFilters("backlinks", {}, null)).toMatchObject({ why: null, source: null });
  });

  it("a position cell's band, a report's order and its date order are the same words the links use", () => {
    expect(bandOfPosition(1)).toEqual({ band: "top3" }); expect(bandOfPosition(3)).toEqual({ band: "top3" });
    expect(bandOfPosition(4)).toEqual({ pos: "4-10" }); expect(bandOfPosition(15)).toEqual({ pos: "11-20" }); expect(bandOfPosition(50)).toEqual({ pos: "21-50" }); expect(bandOfPosition(100)).toEqual({ pos: "51-100" }); expect(bandOfPosition(140)).toEqual({ pos: "101-" });
    expect(bandOfPosition(null)).toBeNull(); expect(bandOfPosition(0)).toBeNull();
    expect(sortKeyOf("backlinks", "newest")).toBe("newest"); expect(sortKeyOf("backlinks", null)).toBe("authority"); expect(sortKeyOf("backlinks", "nope")).toBe("authority");
    // Never something every object has.
    expect(sortKeyOf("keywords", "constructor")).toBe("traffic"); expect(sortKeyOf("keywords", "__proto__")).toBe("traffic");
    expect(sortWords("backlinks", null)).toBe("Strongest sites"); expect(sortWords("newBacklinks", "newest")).toBe("Newest"); expect(sortWords("keywords", "cpc")).toBe("Highest CPC");
    for (const t of ["backlinks", "newBacklinks", "lostBacklinks", "brokenBacklinks", "referringDomains"] as const) { expect(SORTS_BY_DATE.has(t), t).toBe(true); expect(sortKeyOf(t, "newest"), t).toBe("newest"); }
    expect(SORTS_BY_DATE.has("anchors")).toBe(false);
  });
});

describe("the chip says what narrowed the list, in a visitor's words", () => {
  const chip = (table: Parameters<typeof filterWords>[0], p: Record<string, string>, sort?: string | null) => { const { filters, scope } = filtersFromAddress(table, p, "example.com"); return filterWords(table, filters, scope, p, sort); };
  it("positions, intent, follow, anchors, endings, pages", () => {
    expect(chip("keywords", { band: "top3" })).toEqual(["Keywords in the top 3"]);
    expect(chip("keywords", { pos: "4-10" })).toEqual(["Keywords in positions 4–10"]);
    expect(chip("keywords", { band: "rest" })).toEqual(["Keywords from position 11 down"]);
    expect(chip("keywords", { intent: "commercial", path: "/a" })).toEqual(["Commercial keywords", "On the page /a"]);
    expect(chip("keywords", { section: "/blog/" })).toEqual(["Under /blog/"]);
    expect(chip("backlinks", { followed: "true", anchor: "roof" })).toEqual(["Followed links only", "Links with the anchor “roof”"]);
    expect(chip("anchors", { anchor: "roof" })).toEqual(["Anchors containing “roof”"]);
    expect(chip("referringDomains", { tld: ".org" })).toEqual(["Referring domains ending .org (name contains “.org”)"]);
    expect(chip("pages", { contains: "blog" })).toEqual(["Pages whose address contains “blog”"]);
    expect(chip("keywords", {})).toEqual([]);
  });
  it("what the list cannot be split by is said, never quietly dropped", () => {
    expect(chip("keywords", { move: "up" })).toEqual(["Keywords that moved up since last month — the saved report counts them but doesn't list which, so every keyword is shown"]);
    expect(chip("keywords", { band: "notFound" })).toEqual(["Keywords not in the top 100 aren't listed — every keyword is shown"]);
    // A month never changes the order: the chip names the order the list really has — the default, or the address's `sort`.
    expect(chip("newBacklinks", { month: "2026-08" })).toEqual(["Aug 2026 picked on the chart — this list isn't split by month; it is ordered by “newest”"]);
    expect(chip("backlinks", { month: "2026-08" })).toEqual(["Aug 2026 picked on the chart — this list isn't split by month; it is ordered by “strongest sites”"]);
    expect(chip("backlinks", { month: "2026-08", sort: "newest" }, "newest")).toEqual(["Aug 2026 picked on the chart — this list isn't split by month; it is ordered by “newest”"]);
    expect(chip("pages", { month: "2026-08" })).toEqual(["Aug 2026 picked on the chart — this list isn't split by month; it is ordered by “most traffic”"]);
    // Followed referring domains are shown as followed links one per linking site; the chip says so — and says when an ending could not come along.
    expect(chip("backlinks", { view: "referringDomains", followed: "true" })).toEqual(["Followed referring domains — shown as followed links, one per linking site (the referring-domains list can't be split by follow)"]);
    expect(chip("backlinks", { view: "referringDomains", followed: "false", tld: "org" })).toEqual(["Not followed referring domains — shown as nofollow links, one per linking site (the referring-domains list can't be split by follow)", "The ending .org was not applied: the links list has no ending filter, so every ending is shown"]);
    expect(chip("brokenBacklinks", { everyLink: "true" })).toEqual(["Every link can't be chosen for broken links — one link per site is shown"]);
    expect(chip("backlinks", { everyLink: "true" })).toEqual(["Every link, not one per site"]);
    expect(chip("backlinks", { source: "yelp.com" })).toEqual(["Opened from yelp.com: the links can't be narrowed to one linking site yet — every linking site is shown; the Linking page column names each"]);
    expect(chip("referringDomains", { source: "yelp.com" })).toEqual([]);
    expect(chip("backlinks", { why: "spam" })).toEqual(["Opened from a spam score: no view lists spam scores — these are the site's own links, which the score is judged from"]);
    expect(chip("referringDomains", { why: "ip" })[0]).toMatch(/^Opened from a server address/);
    expect(chip("keywords", { why: "shared" })[0]).toMatch(/^Opened from a shared count/);
    // A word that is a key of every object is no word at all.
    expect(chip("keywords", { why: "constructor", move: "constructor" })).toEqual([]);
  });
  it("the overview's chip: a month, the months compared, the chart figure, the first look — and a word that names nothing", () => {
    expect(OVERVIEW_PARAMS).toEqual(["month", "from", "to", "series", "quick"]);
    expect(overviewWords({})).toEqual([]);
    expect(overviewWords({ month: "2026-08" })).toEqual(["Aug 2026 picked on the chart — marked on both charts and opened in the comparison"]);
    expect(overviewWords({ from: "2025-08", to: "2026-08" })).toEqual(["Comparing Aug 2025 with Aug 2026"]);
    expect(overviewWords({ from: "2025-08" })).toEqual(["Comparing from Aug 2025"]);
    expect(overviewWords({ series: "backlinks", quick: "pages" })).toEqual(["Chart figure: Backlinks", "First look: Top pages"]);
    expect(overviewWords({ month: "foo" })).toEqual(["“foo” is not a month (YYYY-MM), so it was not used"]);
    expect(overviewWords({ from: "2025-08", to: "bar" })).toEqual(["Comparing from Aug 2025", "“bar” is not a month (YYYY-MM), so it was not used"]);
    expect(overviewWords({ series: "nope" })).toEqual(["“nope” is not a chart figure here, so the first figure is shown"]);
    expect(overviewWords({ quick: "constructor" })).toEqual(["“constructor” is not a first-look table here, so Organic keywords is shown"]);
  });
});

describe("the explorer screen (source guards)", () => {
  const explorer = code(read("explorer.tsx")), table = code(read("report-table.tsx")), viz = code(read("viz-explorer.tsx")), dirs = code(read("directories.tsx"));
  it("reads the view, the month, the country, the first look, the chart figure and the months compared from the address, and never buys on arrival", () => {
    expect(explorer).toMatch(/useSearch\(\)/);
    expect(explorer).toMatch(/params\.get\("view"\)/);
    expect(explorer).toMatch(/params\.get\("month"\)/);
    expect(explorer).toMatch(/params\.get\("domain"\)/);
    expect(explorer).toMatch(/Number\(params\.get\("locationCode"\)\), lang = params\.get\("languageCode"\)/);
    expect(explorer).toMatch(/params\.get\("quick"\)/);
    expect(explorer).toMatch(/params\.get\("series"\)/);
    expect(explorer).toMatch(/monthParam\("from"\), cmpTo = monthParam\("to"\)/);
    // The only purchase is the Analyse button / Refresh pill — never an effect.
    expect(explorer.match(/analyse\.mutate\(/g)?.length).toBe(2);
    expect(explorer).not.toMatch(/useEffect\([^)]*analyse\.mutate/);
    // A report opened by link with no overview built shows the report's own free look, not nothing.
    expect(explorer).toMatch(/const standalone = notFoundYet && view !== "overview"/);
    expect(explorer).toMatch(/\(report \|\| standalone\) &&/);
  });
  it("the country goes with every link: the picker writes it, a link reads it, another site opens as a new history entry", () => {
    // The market picker writes the new country as a NEW history entry (Back returns to the country before: the entry left
    // is first made to name its own) and keeps the view and its filters — only the page of rows starts again (round 3).
    expect(explorer).toMatch(/if \(!params\.get\("locationCode"\)\) setParams\(\{ locationCode: market\.locationCode, languageCode: market\.languageCode \}, true\);/);
    expect(explorer).toMatch(/setReport\(null\); setMarket\(m\); setParams\(\{ locationCode: m\.locationCode, languageCode: m\.languageCode, offset: null \}\);/);
    expect(explorer).not.toMatch(/NARROWING/);
    expect(explorer).toMatch(/findMarket\(lc, lang \?\? market\.languageCode\)/);
    // Every address of this site, of another site and of a keyword carries the country (and its language).
    expect(explorer).toMatch(/const to = \(v: string, p: ExplorerParams = \{\}\) => seoLinks\.explorer\(shown, v, \{ \.\.\.marketParams\(market\), \.\.\.p \}\)/);
    expect(explorer).toMatch(/const other = \(d: string, v = "overview", p: ExplorerParams = \{\}\) => seoLinks\.explorer\(d, v, \{ \.\.\.marketParams\(market\), \.\.\.p \}\)/);
    expect(explorer).toMatch(/seoLinks\.keywords\(keyword, \{ \.\.\.marketParams\(market\), \.\.\.p \}\)/);
    expect(explorer).not.toMatch(/seoLinks\.keywords\([^)]*\{ locationCode: market\.locationCode \}\)/);
    // A recently analysed row names its own country in full, so the figure and the landing are the same report.
    expect(explorer).toMatch(/seoLinks\.explorer\(r\.domain, v, \{ locationCode: m\.locationCode, languageCode: m\.languageCode, \.\.\.p \}\)/);
    // Explorer → explorer is a new history entry (Back returns), never a replaceState.
    expect(explorer).toMatch(/const open = \(d: string, m: SeoMarket = market\) => \{ setReport\(null\); setDomain\(d\); setInput\(d\); navigate\(seoLinks\.explorer\(d, "overview", marketParams\(m\)\)\); \}/);
    expect(explorer).not.toMatch(/replaceState/);
  });
  it("every headline figure, its change, band, row and chart series is a link built in links.ts", () => {
    for (const id of ["link-authority", "link-backlinks", "link-broken", "link-ref-domains", "link-ref-ips", "link-organic-keywords", "link-organic-traffic", "link-traffic-value", "link-move-up", "link-move-down", "link-move-new", "link-move-lost",
      "link-paid-keywords", "link-paid-traffic", "link-paid-cost", "link-paid-none", "link-dist-top3", "link-dist-4-10", "link-dist-rest", "link-followed", "link-not-followed", "link-followed-none", "link-performance-none", "link-position-chart-top3", "link-position-chart-4-10", "link-position-chart-rest",
      "link-authority-change", "link-backlinks-change", "link-ref-domains-change", "link-organic-keywords-change", "link-organic-traffic-change",
      "link-recent-authority", "link-recent-ref-domains", "link-recent-keywords", "link-recent-traffic", "link-recent-analysed"]) {
      expect(explorer, id).toContain(`"${id}"`);
    }
    expect(explorer).toMatch(/testId: `link-positions-\$\{/);
    expect(explorer).toMatch(/testId: `link-tld-\$\{/);
    expect(explorer).toMatch(/data-testid=\{`menu-\$\{key\}`\}/);
    expect(explorer).toMatch(/<Fig href=\{go\("overview"\)\} testId=\{`button-open-\$\{r\.domain\}`\}/);
    // Nothing writes an explorer address by hand: every one comes from the builder (the one place).
    expect(explorer).not.toMatch(/["`]\/seo\//);
    expect(explorer).toMatch(/to\("keywords", \{ band: "top3" \}\)/);
    expect(explorer).toMatch(/to\("referringDomains", \{ followed: true \}\)/);
    expect(explorer).toMatch(/to\("keywords", \{ move: "up" \}\)/);
    // A change "over the months shown" leads to the rows in the month it ends in.
    expect(explorer).toMatch(/href=\{to\("backlinks", \{ month: lastMonth\(links\) \}\)\} testId="link-authority-change"/);
    expect(explorer).toMatch(/href=\{to\("referringDomains", \{ month: lastMonth\(links\) \}\)\} testId="link-ref-domains-change"/);
    expect(explorer).toMatch(/href=\{to\("keywords", \{ month: lastMonth\(hist\) \}\)\} testId="link-organic-keywords-change"/);
    expect(explorer).toMatch(/href=\{to\("pages", \{ month: lastMonth\(hist\) \}\)\} testId="link-organic-traffic-change"/);
    // The grey band of the position chart is everything from 11 down (the estimate is not capped at 100): `band: "rest"`, never "11-100".
    expect(explorer).toMatch(/name: "Position 11 and below"[^\n]*href: to\("keywords", \{ band: "rest" \}\), testId: "link-position-chart-rest"/);
    expect(explorer).not.toMatch(/11-100/);
    expect(explorer).toContain("the grey band is not capped at position 100");
    // Bar rows and share bars carry their rows' address.
    expect(explorer).toMatch(/href: to\("keywords", r\.p\), words: `\$\{r\.words\}: \$\{fmtNum\(values\[i\]\)\}`, testId: `link-positions-/);
    expect(explorer).toMatch(/href: to\("referringDomains", \{ tld: `\.\$\{t\.tld\}` \}\), testId: `link-tld-\$\{t\.tld\}`/);
  });
  it("the overview's own words live in the address: a month (with month links under every chart), the first look, the chart figure, the months compared — said in a chip with a clear", () => {
    // The chip: what the address picked on the overview, and a clear that removes those words together.
    expect(explorer).toMatch(/const overview = view === "overview" \? overviewWords\(/);
    expect(explorer).toMatch(/data-testid="overview-filter"/);
    expect(explorer.match(/data-testid="active-filter"/g)?.length).toBe(1);
    expect(explorer).toMatch(/onClick=\{\(\) => setParams\(OVERVIEW_CLEAR\)\}[^\n]*data-testid="button-clear-filters"/);
    expect(explorer).toMatch(/const OVERVIEW_CLEAR = Object\.fromEntries\(OVERVIEW_PARAMS\.map/);
    // A month is picked on a chart (setParam), by the month links under each of the six small charts and the big ones (here({ month })), and marked (ReferenceDot).
    expect(explorer).toMatch(/setParam\("month", m\)/);
    expect(explorer).toMatch(/<MonthLinks months=\{points\} href=\{\(m\) => here\(\{ month: m \}\)\} current=\{month\} testId=\{`\$\{testId\}-months`\} collapsed \/>/);
    for (const id of ["spark-authority", "spark-backlinks", "spark-ref-domains", "spark-organic-keywords", "spark-organic-traffic"]) expect(explorer, id).toContain(`"${id}"`);
    expect(explorer).toMatch(/testId="position-history-months"/);
    expect(viz).toMatch(/ReferenceDot/);
    expect(explorer.match(/active=\{seriesParam\} onSeries=\{\(k\) => setParam\("series", k\)\} monthHref=\{\(m\) => here\(\{ month: m \}\)\}/g)?.length).toBe(2);
    // The first-look tabs and the comparison's pickers write the address, so each is a place a link can land on.
    // The default first look (Organic keywords) is no word in the address (round 3: it was written by its own tab).
    expect(explorer).toMatch(/<Link key=\{t\} href=\{here\(\{ quick: t === "keywords" \? undefined : t \}\)\} aria-current=\{quick === t \? "page" : undefined\}[^\n]*data-testid=\{`tab-explorer-\$\{t\}`\}/);
    expect(explorer).not.toMatch(/setTable\(/);
    expect(explorer).toMatch(/onChange=\{\(e\) => setParam\("from", e\.target\.value\)\} data-testid="select-compare-from"/);
    expect(explorer).toMatch(/onChange=\{\(e\) => setParam\("to", e\.target\.value\)\} data-testid="select-compare-to"/);
    expect(explorer).toMatch(/<CompareMonths report=\{report\} month=\{month\} from=\{cmpFrom\} to=\{cmpTo\} href=\{to\} \/>/);
    // Every figure of the comparison leads to its report for that month; the change to the later month.
    expect(explorer).toMatch(/<Fig href=\{href\(r\.view, \{ \.\.\.r\.p, month: m \}\)\} testId=\{testId\}/);
    expect(explorer).toMatch(/testId=\{`link-compare-\$\{r\.key\}`\}/);
    expect(explorer).toMatch(/`link-compare-\$\{r\.key\}-from`/); expect(explorer).toMatch(/`link-compare-\$\{r\.key\}-to`/);
    expect(explorer).toMatch(/href=\{href\(r\.view, \{ \.\.\.r\.p, month: b \?\? undefined \}\)\} testId=\{`link-compare-\$\{r\.key\}-change`\}/);
  });
  it("every cell of the overview's first-look tables is a link to its data (the owner's rule)", () => {
    // Intents: the word, the count and the traffic.
    expect(explorer).toMatch(/testId=\{`link-intent-\$\{i\.intent\}`\}/);
    expect(explorer).toMatch(/<ShareBar value=\{i\.keywords\}[^\n]*href=\{href\} testId=\{`link-intent-\$\{i\.intent\}-keywords`\}/);
    expect(explorer).toMatch(/<Fig href=\{href\} testId=\{`link-intent-\$\{i\.intent\}-traffic`\}/);
    expect(explorer).toMatch(/href = known \? to\("keywords", \{ intent: i\.intent \}\) : to\("keywords"\)/);
    // Organic keywords: keyword → its page; position → the band; volume / difficulty / CPC → the part of the keyword's page that explains it; traffic → the page's keywords; intent → that intent; page → the page.
    expect(cellOf(explorer, "link-keyword")).toMatch(/<Fig href=\{kw\(k\.keyword\)\} testId="link-keyword"/);
    expect(cellOf(explorer, "link-keyword-position")).toMatch(/<Fig href=\{to\("keywords", band\)\} testId="link-keyword-position"/);
    expect(cellOf(explorer, "link-keyword-volume")).toMatch(/<Fig href=\{kw\(k\.keyword, \{ section: "volume" \}\)\} testId="link-keyword-volume"/);
    expect(cellOf(explorer, "link-keyword-traffic")).toMatch(/<Fig href=\{path \? to\("keywords", \{ path \}\) : kw\(k\.keyword, \{ section: "results" \}\)\} testId="link-keyword-traffic"/);
    expect(cellOf(explorer, "link-keyword-difficulty")).toMatch(/<Fig href=\{kw\(k\.keyword, \{ section: "serp" \}\)\} testId="link-keyword-difficulty"/);
    expect(cellOf(explorer, "link-keyword-cpc")).toMatch(/<Fig href=\{kw\(k\.keyword, \{ section: "cpc" \}\)\} testId="link-keyword-cpc"/);
    expect(cellOf(explorer, "link-keyword-intent")).toMatch(/<Fig href=\{to\("keywords", \{ intent: k\.intent \}\)\} testId="link-keyword-intent"/);
    expect(cellOf(explorer, "link-keyword-page")).toMatch(/<Fig href=\{to\("pages", \{ path \}\)\} testId="link-keyword-page"/);
    expect(explorer).toMatch(/band = bandOfPosition\(k\.position\)/);
    // Top pages: the page; traffic / keywords → its keywords; in top 10 → its keywords in the top 10; value → its keywords by ad price.
    expect(cellOf(explorer, "link-page")).toMatch(/<Fig href=\{to\("pages", \{ path \}\)\} testId="link-page"/);
    expect(cellOf(explorer, "link-page-traffic")).toMatch(/<ShareBar value=\{p\.traffic\}[^\n]*href=\{at\("keywords"\)\} testId="link-page-traffic"/);
    expect(cellOf(explorer, "link-page-keywords")).toMatch(/<Fig href=\{at\("keywords"\)\} testId="link-page-keywords"/);
    expect(cellOf(explorer, "link-page-top10")).toMatch(/<Fig href=\{at\("keywords", \{ band: "top10" \}\)\} testId="link-page-top10"/);
    expect(cellOf(explorer, "link-page-value")).toMatch(/<Fig href=\{at\("keywords", \{ sort: "cpc" \}\)\} testId="link-page-value"/);
    // Competitors: the site; shared → its keywords (the chip says what is shared is counted elsewhere); their keywords / traffic → its lists; Explore → its overview.
    expect(cellOf(explorer, "link-competitor")).toMatch(/<Fig href=\{other\(c\.domain\)\} testId="link-competitor"/);
    expect(cellOf(explorer, "link-competitor-shared")).toMatch(/href=\{other\(c\.domain, "keywords", \{ why: "shared" \}\)\} testId="link-competitor-shared"/);
    expect(cellOf(explorer, "link-competitor-keywords")).toMatch(/<Fig href=\{other\(c\.domain, "keywords"\)\} testId="link-competitor-keywords"/);
    expect(cellOf(explorer, "link-competitor-traffic")).toMatch(/<Fig href=\{other\(c\.domain, "pages"\)\} testId="link-competitor-traffic"/);
    expect(explorer).toMatch(/<Fig href=\{other\(c\.domain\)\} testId=\{`button-explore-\$\{c\.domain\}`\}/);
    // Referring domains: the site; authority → the sites linking to it; links → the links from it; spam → its own links (the chip says why); follow → that follow; first seen → the list newest first.
    expect(cellOf(explorer, "link-referring-domain")).toMatch(/<Fig href=\{other\(d\.domain\)\} testId="link-referring-domain"/);
    expect(cellOf(explorer, "link-referring-authority")).toMatch(/<Fig href=\{other\(d\.domain, "referringDomains"\)\} testId="link-referring-authority"/);
    expect(cellOf(explorer, "link-referring-links")).toMatch(/<Fig href=\{linksFrom\(d\.domain\)\} testId="link-referring-links"/);
    expect(explorer).toMatch(/const linksFrom = \(d: string\) => \(trackedSite \? seoLinks\.backlinks\(trackedSite\.id, \{ domain: d \}\) : to\("backlinks", \{ source: d \}\)\)/);
    expect(cellOf(explorer, "link-referring-spam")).toMatch(/<Fig href=\{other\(d\.domain, "backlinks", \{ why: "spam" \}\)\} testId="link-referring-spam"/);
    expect(explorer).toMatch(/<Fig href=\{to\("referringDomains", \{ followed: d\.followed \}\)\} testId=\{d\.followed \? "link-row-followed" : "link-row-nofollow"\}/);
    expect(cellOf(explorer, "link-referring-first-seen")).toMatch(/<Fig href=\{to\("referringDomains", \{ sort: "newest" \}\)\} testId="link-referring-first-seen"/);
    // Anchors: the anchor → the links with it; backlinks → every link with it; referring domains → one per site; first seen → newest first.
    expect(explorer).toMatch(/const withAnchor = \(p: ExplorerParams = \{\}\) => to\("backlinks", \{ anchor: a\.anchor \|\| undefined, \.\.\.p \}\)/);
    expect(cellOf(explorer, "link-anchor-links")).toMatch(/<Fig href=\{withAnchor\(\)\} testId="link-anchor-links"/);
    expect(cellOf(explorer, "link-anchor-backlinks")).toMatch(/href=\{withAnchor\(\{ everyLink: true \}\)\} testId="link-anchor-backlinks"/);
    expect(cellOf(explorer, "link-anchor-domains")).toMatch(/<Fig href=\{withAnchor\(\)\} testId="link-anchor-domains"/);
    expect(cellOf(explorer, "link-anchor-first-seen")).toMatch(/<Fig href=\{withAnchor\(\{ sort: "newest" \}\)\} testId="link-anchor-first-seen"/);
    // An empty first look still leads to the full report.
    for (const id of ["link-all-keywords", "link-all-pages", "link-all-competitors", "link-all-referring-domains", "link-all-anchors"]) expect(explorer, id).toContain(`"${id}"`);
  });
  it("the words around the figures are links too: each headline label, each panel title, the chart's own figures, the counts over a table", () => {
    // A headline figure's label and number are one place (Metric, with this screen's thumb-sized links — not viz.tsx's hover-only one).
    expect(explorer).not.toMatch(/MetricColumn/);
    expect(viz).toMatch(/export function Metric\(/);
    expect(viz).toMatch(/<Fig href=\{href\} testId=\{`\$\{linkTestId\}-label`\}>\{label\}<\/Fig>/);
    expect(viz).toMatch(/<Fig href=\{href\} testId=\{linkTestId\} label=\{words\}>\{value\}<\/Fig>\{delta\}/);
    for (const [label, href, id] of [["Authority", 'to("backlinks")', "link-authority"], ["Backlinks", 'to("backlinks")', "link-backlinks"], ["Referring domains", 'to("referringDomains")', "link-ref-domains"],
      ["Organic keywords", 'to("keywords")', "link-organic-keywords"], ["Organic traffic \\(estimate\\)", 'to("pages")', "link-organic-traffic"], ["Paid keywords", 'to("paidKeywords")', "link-paid-keywords"], ["Paid traffic", 'to("ads")', "link-paid-traffic"]]) {
      expect(explorer, id).toMatch(new RegExp(`<Metric label="${label}" testId="stat-[a-z-]+" href=\\{${href.replace(/[()]/g, "\\$&")}\\} linkTestId="${id}"`));
    }
    // A card's title leads to the rows the card counts.
    expect(explorer).toMatch(/\{href && linkTestId \? <Fig href=\{href\} testId=\{linkTestId\}>\{title\}<\/Fig> : title\}/);
    for (const [title, href, id] of [["Organic positions", 'to("keywords")', "link-panel-positions"], ["Referring domains", 'to("referringDomains")', "link-panel-followed"], ["Backlinks by domain ending", 'to("referringDomains")', "link-panel-tlds"],
      ["Organic keywords by position", 'to("keywords")', "link-panel-position-history"], ["Organic keywords by intent", 'to("keywords")', "link-panel-intents"]]) {
      expect(explorer, id).toMatch(new RegExp(`<Panel title="${title}"[^\\n]*href=\\{${href.replace(/[()]/g, "\\$&")}\\} linkTestId="${id}"`));
    }
    // The counts over the tables: the intents' "top N keywords" (the first look below), and "Showing the N … of M".
    expect(explorer).toMatch(/<Fig href=\{here\(\{ quick: undefined \}\)\} testId="link-intents-top"/);
    expect(explorer).toMatch(/<Fig href=\{to\("keywords"\)\} testId="link-keywords-shown"/);
    expect(explorer).toMatch(/<Fig href=\{to\("keywords"\)\} testId="link-keywords-total"/);
    // A big chart's own figures: the first and last pick their month; the picked month's figure leads to its rows.
    expect(viz).toMatch(/<Link href=\{monthHref\(first\.month\)\}[^\n]*data-testid=\{`\$\{testId\}-first`\}/);
    expect(viz).toMatch(/<Link href=\{monthHref\(last\.month\)\}[^\n]*data-testid=\{`\$\{testId\}-last`\}/);
    expect(viz).toMatch(/<Link href=\{s\.href\(picked\.month\)\}[^\n]*data-testid=\{`\$\{testId\}-month-value`\}/);
    expect(viz).not.toMatch(/<b className="g-text font-medium">\{compact\(/);
    // A date cell names the order it lands on, as the picker does (lost links: "most recently lost", not "newest first").
    expect(table).toMatch(/label=\{`\$\{fmtDate\(date\)\} — the list ordered by “\$\{sortWords\(c\.table, "newest"\)\.toLowerCase\(\)\}”`\}/);
    expect(sortWords("lostBacklinks", "newest")).toBe("Most recently lost");
    // Directories: the gap badge and a kind's heading say they are links without a pointer over them.
    expect(dirs).toMatch(/testId="link-directory-gap"[^\n]*>Link to check ›<\/span><\/Fig>/);
    expect(dirs).toMatch(/\{only === kind \? " · every kind →" : " ›"\}/);
  });
  it("the reports honour the address (filters, scope and order) and say what narrowed them", () => {
    expect(table).toMatch(/filtersFromAddress\(table, address, domain\)/);
    expect(table).toMatch(/setParams\(\{ \.\.\.addressFromFilters\(table, next, nextScope\), offset: null \}\)/);
    expect(table).toMatch(/data-testid="active-filter"/);
    expect(table).toMatch(/data-testid="button-clear-filters"/);
    expect(table).toMatch(/filterWords\(table, filters, scope, address, sortKey\)/);
    expect(explorer).toMatch(/<ReportView key=\{`[^`]*`\} linked market=\{market\} table=\{reportTable\} domain=\{shown\} siteId=\{trackedSite\?\.id\}/);
    // The order lives in the address too: read on arrival, written by the picker (the default is no word).
    expect(table).toMatch(/useState\(\(\) => sortKeyOf\(table, linked \? address\.sort : null\)\)/);
    expect(table).toMatch(/const chooseSort = \(key: string\) => \{ setSort\(key\); if \(linked\) setParams\(\{ sort: key === SORT_LABELS\[table\]\[0\]\[0\] \? null : key, offset: null \}\); else setOwnOffset\(0\); \}/);
    expect(table).toMatch(/onChange=\{\(e\) => chooseSort\(e\.target\.value\)\} data-testid="report-sort"/);
    // "Show the whole site" clears the scope on the page AND in the address — in both places it is offered.
    expect(table).toMatch(/const wholeSite = \(\) => \{[^\n]*if \(linked\) setParams\(\{ path: null, section: null, offset: null \}\); else setOwnOffset\(0\); \}/);
    expect(table).toMatch(/onClick=\{wholeSite\} data-testid="button-scope-clear"/);
    expect(table).toMatch(/onClick=\{wholeSite\} data-testid="button-scope-clear-empty"/);
    // The country (with its language) and the tracked site go to every cell.
    expect(table).toMatch(/c\.cell\(r, \{ target, onExplore, domain, table, market, siteId \}\)/);
    expect(table).toMatch(/const ex = \(c: Ctx, domain: string, view: string, p: ExplorerParams = \{\}\) => seoLinks\.explorer\(domain, view, \{ \.\.\.marketParams\(c\.market\), \.\.\.p \}\)/);
    expect(table).toMatch(/seoLinks\.keywords\(keyword, \{ \.\.\.marketParams\(c\.market\), \.\.\.p \}\)/);
    expect(table).not.toMatch(/locationCode: c\.locationCode/);
    // Never buys on arrival: the saved page is asked for (peek); only the button runs.
    expect(table).toMatch(/\{ \.\.\.body, peek: true \}/);
    expect(table).toMatch(/onClick=\{\(\) => run\.mutate\(\{ body, key: queryKey \}\)\} data-testid="button-run-report"/);
    expect(table).not.toMatch(/useEffect\([^)]*run\.mutate/);
  });
  it("every cell of every report is a link to its data (report-table.tsx COLS)", () => {
    // Keyword rows (site reports and ideas): the keyword, its volume / difficulty / CPC on the keyword's page, position → band, traffic → the page's keywords, intent → that intent, page → the page.
    expect(table).toMatch(/const keywordCell: Col = \{[^\n]*<Fig href=\{kw\(c, r\.keyword\)\} testId="link-keyword"/);
    expect(table).toMatch(/const volumeCell: Col = \{[^\n]*<Fig href=\{kw\(c, r\.keyword, \{ section: "volume" \}\)\} testId="link-keyword-volume"/);
    expect(table).toMatch(/const difficultyCell: Col = \{[^\n]*<Fig href=\{kw\(c, r\.keyword, \{ section: "serp" \}\)\} testId="link-keyword-difficulty"/);
    expect(table).toMatch(/const cpcCell: Col = \{[^\n]*<Fig href=\{kw\(c, r\.keyword, \{ section: "cpc" \}\)\} testId="link-keyword-cpc"/);
    expect(cellOf(table, "link-keyword-position")).toMatch(/const b = bandOfPosition\(r\.position\); return b && c\.domain \? <Fig href=\{ex\(c, c\.domain, "keywords", b\)\} testId="link-keyword-position"/);
    expect(cellOf(table, "link-keyword-traffic")).toMatch(/<Fig href=\{path && c\.domain \? ex\(c, c\.domain, "keywords", \{ path \}\) : kw\(c, r\.keyword, \{ section: "results" \}\)\} testId="link-keyword-traffic"/);
    expect(cellOf(table, "link-keyword-intent")).toMatch(/<OwnFigure value=\{cap\(r\.intent\)\} view="keywords" c=\{c\} p=\{\{ intent: r\.intent \}\} testId="link-keyword-intent"/);
    expect(cellOf(table, "link-keyword-page")).toMatch(/<PageLink url=\{r\.url\}[^\n]*view="pages" c=\{c\} testId="link-keyword-page"/);
    // Ideas: an intent is a fact of the keyword, on its page; ad competition with its ad prices.
    expect(table).toMatch(/<Fig href=\{kw\(c, r\.keyword\)\} testId="link-keyword-intent"/);
    expect(cellOf(table, "link-keyword-competition")).toMatch(/<Fig href=\{kw\(c, r\.keyword, \{ section: "cpc" \}\)\} testId="link-keyword-competition"/);
    // Backlink rows: linking site, authority → its referring domains, anchor → anchors, links to → the page, follow → that follow, spam → its own links (why), first / last seen → newest first.
    expect(cellOf(table, "link-linking-site")).toMatch(/<Fig href=\{ex\(c, r\.domain, "overview"\)\} testId="link-linking-site"/);
    expect(cellOf(table, "link-link-authority")).toMatch(/<SiteFigure domain=\{r\.domain\} value=\{r\.authority \?\? "—"\} view="referringDomains" c=\{c\} testId="link-link-authority"/);
    expect(cellOf(table, "link-anchor")).toMatch(/<Fig href=\{ex\(c, c\.domain, "anchors", \{ anchor: r\.anchor \}\)\} testId="link-anchor"/);
    expect(cellOf(table, "link-links-to")).toMatch(/<PageLink url=\{r\.target\} text=\{strip\(r\.target\)\} view=\{c\.table\} c=\{c\} testId="link-links-to"/);
    expect(cellOf(table, "link-link-follow")).toMatch(/<OwnFigure value=\{r\.followed \? "followed" : "nofollow"\} view=\{c\.table\} c=\{c\} p=\{\{ followed: !!r\.followed \}\} testId="link-link-follow"/);
    expect(cellOf(table, "link-link-spam")).toMatch(/<SiteFigure domain=\{r\.domain\} value=\{r\.spamScore\} view="backlinks" c=\{c\} p=\{\{ why: "spam" \}\} testId="link-link-spam"/);
    expect(cellOf(table, "link-link-first-seen")).toMatch(/<DateCell date=\{r\.firstSeen\} c=\{c\} testId="link-link-first-seen" \/>/);
    expect(cellOf(table, "link-link-last-seen")).toMatch(/<DateCell date=\{r\.lastSeen\} c=\{c\} testId="link-link-last-seen" \/>/);
    expect(table).toMatch(/date && c\.domain && SORTS_BY_DATE\.has\(c\.table\) \? <Fig href=\{ex\(c, c\.domain, c\.table, \{ sort: "newest" \}\)\} testId=\{testId\}/);
    // Top pages.
    expect(cellOf(table, "link-page")).toMatch(/<PageLink url=\{r\.url\} text=\{strip\(r\.url\)\} view="pages" c=\{c\} testId="link-page"/);
    expect(cellOf(table, "link-page-traffic")).toMatch(/<PageFigure url=\{r\.url\} value=\{fmtNum\(r\.traffic\)\} view="keywords" c=\{c\} testId="link-page-traffic"/);
    expect(cellOf(table, "link-page-keywords")).toMatch(/<PageFigure url=\{r\.url\} value=\{fmtNum\(r\.keywords\)\} view="keywords" c=\{c\} testId="link-page-keywords"/);
    expect(cellOf(table, "link-page-top10")).toMatch(/view="keywords" c=\{c\} testId="link-page-top10" p=\{\{ band: "top10" \}\}/);
    expect(cellOf(table, "link-page-value")).toMatch(/view="keywords" c=\{c\} testId="link-page-value" p=\{\{ sort: "cpc" \}\}/);
    // Competitors.
    expect(cellOf(table, "link-competitor")).toMatch(/<SiteLink domain=\{r\.domain\} c=\{c\} testId="link-competitor" \/>/);
    expect(cellOf(table, "link-competitor-shared")).toMatch(/view="keywords" c=\{c\} p=\{\{ why: "shared" \}\} testId="link-competitor-shared"/);
    expect(cellOf(table, "link-competitor-keywords")).toMatch(/<SiteFigure domain=\{r\.domain\} value=\{fmtNum\(r\.keywords\)\} view="keywords" c=\{c\} testId="link-competitor-keywords"/);
    expect(cellOf(table, "link-competitor-traffic")).toMatch(/<SiteFigure domain=\{r\.domain\} value=\{fmtNum\(r\.traffic\)\} view="pages" c=\{c\} testId="link-competitor-traffic"/);
    expect(cellOf(table, "link-competitor-position")).toMatch(/view="keywords" c=\{c\} p=\{\{ sort: "position" \}\} testId="link-competitor-position"/);
    expect(cellOf(table, "link-competitor-explore")).toMatch(/<Fig href=\{ex\(c, r\.domain, "overview"\)\} testId="link-competitor-explore"/);
    // Referring domains: the links from one site are picked out on the Backlinks page for a tracked site; otherwise the links list says it can't yet (source).
    expect(cellOf(table, "link-referring-domain")).toMatch(/<SiteLink domain=\{r\.domain\} c=\{c\} testId="link-referring-domain" \/>/);
    expect(cellOf(table, "link-referring-authority")).toMatch(/view="referringDomains" c=\{c\} testId="link-referring-authority"/);
    expect(cellOf(table, "link-referring-links")).toMatch(/c\.siteId != null \? <Fig href=\{seoLinks\.backlinks\(c\.siteId, \{ domain: r\.domain \}\)\} testId="link-referring-links"[^\n]*<OwnFigure value=\{fmtNum\(r\.backlinks\)\} view="backlinks" c=\{c\} p=\{\{ source: r\.domain \}\} testId="link-referring-links"/);
    expect(cellOf(table, "link-referring-spam")).toMatch(/view="backlinks" c=\{c\} p=\{\{ why: "spam" \}\} testId="link-referring-spam"/);
    expect(cellOf(table, "link-referring-follow")).toMatch(/view="referringDomains" c=\{c\} p=\{\{ followed: !!r\.followed \}\} testId="link-referring-follow"/);
    expect(cellOf(table, "link-referring-first-seen")).toMatch(/<DateCell date=\{r\.firstSeen\} c=\{c\} testId="link-referring-first-seen" \/>/);
    // Anchors.
    expect(cellOf(table, "link-anchor-links")).toMatch(/<Fig href=\{ex\(c, c\.domain, "backlinks", \{ anchor: r\.anchor \}\)\} testId="link-anchor-links"/);
    expect(cellOf(table, "link-anchor-backlinks")).toMatch(/view="backlinks" c=\{c\} p=\{\{ anchor: r\.anchor \|\| undefined, everyLink: true \}\} testId="link-anchor-backlinks"/);
    expect(cellOf(table, "link-anchor-domains")).toMatch(/view="backlinks" c=\{c\} p=\{\{ anchor: r\.anchor \|\| undefined \}\} testId="link-anchor-domains"/);
    expect(cellOf(table, "link-anchor-first-seen")).toMatch(/testId="link-anchor-first-seen" fallback=\{c\.domain \? ex\(c, c\.domain, "backlinks", \{ anchor: r\.anchor \|\| undefined, sort: "newest" \}\) : undefined\}/);
    // Best pages by links.
    expect(cellOf(table, "link-page-links")).toMatch(/<PageLink url=\{r\.url\} text=\{strip\(r\.url\)\} view="backlinks" c=\{c\} testId="link-page-links"/);
    expect(cellOf(table, "link-page-referring-domains")).toMatch(/view="backlinks" c=\{c\} testId="link-page-referring-domains"/);
    expect(cellOf(table, "link-page-backlinks")).toMatch(/view="backlinks" c=\{c\} testId="link-page-backlinks" p=\{\{ everyLink: true \}\}/);
    expect(cellOf(table, "link-page-authority")).toMatch(/<PageFigure url=\{r\.url\} value=\{r\.authority \?\? "—"\} view="backlinks" c=\{c\} testId="link-page-authority"/);
    expect(cellOf(table, "link-page-broken")).toMatch(/view="brokenBacklinks" c=\{c\} testId="link-page-broken"/);
    expect(cellOf(table, "link-page-first-seen")).toMatch(/testId="link-page-first-seen" fallback=\{c\.domain && pathOfUrl\(r\.url, c\.domain\) \? ex\(c, c\.domain, "backlinks", \{ path: pathOfUrl\(r\.url, c\.domain\)!, sort: "newest" \}\) : undefined\}/);
    // Referring IPs: the address itself has no view (said as it is); its counts lead to the whole lists and the chip says why.
    expect(table).toMatch(/\{ key: "ip", label: "IP address", cell: \(r\) => r\.ip, csv: \(r\) => r\.ip \}/);
    expect(cellOf(table, "link-ip-domains")).toMatch(/view="referringDomains" c=\{c\} p=\{\{ why: "ip" \}\} testId="link-ip-domains"/);
    expect(cellOf(table, "link-ip-links")).toMatch(/view="backlinks" c=\{c\} p=\{\{ why: "ip" \}\} testId="link-ip-links"/);
    expect(cellOf(table, "link-ip-first-seen")).toMatch(/testId="link-ip-first-seen" fallback=\{c\.domain \? ex\(c, c\.domain, "referringDomains", \{ why: "ip", sort: "newest" \}\) : undefined\}/);
    // Sites with similar links.
    expect(cellOf(table, "link-link-competitor")).toMatch(/<SiteLink domain=\{r\.domain\} c=\{c\} testId="link-link-competitor" \/>/);
    expect(cellOf(table, "link-link-competitor-shared")).toMatch(/view="referringDomains" c=\{c\} p=\{\{ why: "shared" \}\} testId="link-link-competitor-shared"/);
    expect(cellOf(table, "link-link-competitor-explore")).toMatch(/<Fig href=\{ex\(c, r\.domain, "overview"\)\} testId="link-link-competitor-explore"/);
    // Subdomains.
    expect(cellOf(table, "link-subdomain")).toMatch(/<SiteLink domain=\{r\.subdomain\} c=\{c\} testId="link-subdomain" \/>/);
    expect(cellOf(table, "link-subdomain-traffic")).toMatch(/<SiteFigure domain=\{r\.subdomain\} value=\{fmtNum\(r\.traffic\)\} view="pages" c=\{c\} testId="link-subdomain-traffic"/);
    expect(cellOf(table, "link-subdomain-keywords")).toMatch(/<SiteFigure domain=\{r\.subdomain\} value=\{fmtNum\(r\.keywords\)\} view="keywords" c=\{c\} testId="link-subdomain-keywords"/);
    expect(cellOf(table, "link-subdomain-top3")).toMatch(/view="keywords" c=\{c\} p=\{\{ band: "top3" \}\} testId="link-subdomain-top3"/);
    expect(cellOf(table, "link-subdomain-top10")).toMatch(/view="keywords" c=\{c\} p=\{\{ band: "top10" \}\} testId="link-subdomain-top10"/);
    expect(cellOf(table, "link-subdomain-value")).toMatch(/view="keywords" c=\{c\} p=\{\{ sort: "cpc" \}\} testId="link-subdomain-value"/);
    // Ads: every cell is the ad, on Google's own page (there is no view of ours behind an ad).
    for (const id of ["link-ad-advertiser", "link-ad-kind", "link-ad-first-shown", "link-ad-last-shown"]) expect(cellOf(table, id)).toMatch(new RegExp(`<Ext href=\\{r\\.url\\} testId="${id}">`));
    expect(cellOf(table, "link-ad")).toMatch(/<a href=\{r\.url\} className=\{FIG\} target="_blank" rel="noreferrer"[^\n]*data-testid="link-ad"/);
    // No cell is left as plain text: every COLS cell either renders a link piece or is the one doc-sanctioned exception (the IP).
    const cols = table.slice(table.indexOf("const keywordCell"), table.indexOf("const EMPTY_NOTE"));
    const plain = cols.split("\n").map((l) => l.trim()).filter((l) => /cell: \(r(, c)?\) =>/.test(l) && !/<(Fig|Ext|SiteLink|SiteFigure|OwnFigure|PageLink|PageFigure|DateCell|a href)/.test(l));
    expect(plain).toEqual([`{ key: "ip", label: "IP address", cell: (r) => r.ip, csv: (r) => r.ip },`]);
  });
  it("the Directories view: the comparison and the narrowing live in the address, every figure is a link, nothing is bought on arrival", () => {
    expect(dirs).toMatch(/useSearch\(\)/);
    expect(dirs).toMatch(/rivalsOf\(params\.get\("rivals"\), domain\)/);
    expect(dirs).toMatch(/isOnly\(params\.get\("only"\)\)/);
    // "Check these sites" writes the comparison (`none` for this site alone), and a link carries it; the narrowing is `only`.
    expect(dirs).toMatch(/const rivalsWord = \(xs: string\[\] \| null \| undefined\) => \(xs \? xs\.join\(","\) \|\| "none" : undefined\)/);
    expect(dirs).toMatch(/const use = \(\) => \{ setApplied\(\[\.\.\.draft\]\); setParams\(\{ rivals: rivalsWord\(draft\), only: null \}\); \}/);
    expect(dirs).toMatch(/seoLinks\.explorer\(domain, "directories", \{ \.\.\.marketParams\(market\), rivals: rivalsWord\(/);
    expect(dirs).toMatch(/onClick=\{use\} data-testid="button-directories-prepare"/);
    // The chip and its clear.
    expect(dirs).toMatch(/data-testid="active-filter">\{ONLY_WORDS\(only, domain\)\}/);
    expect(dirs).toMatch(/onClick=\{\(\) => setParams\(\{ only: null \}\)\}[^\n]*data-testid="button-clear-filters"/);
    // Every figure: the competitors compared, the summary counts, each site's column head, each kind's heading, each directory, each count (and each dash), the gap badge.
    for (const id of ["link-directories-linked", "link-directories-all", "link-directories-gaps", "link-directory", "link-directory-gap", "link-directory-links", "link-directory-no-links", "link-directories-every"]) expect(dirs, id).toContain(`"${id}"`);
    expect(dirs).toMatch(/testId=\{`link-rival-\$\{c\}`\}/);
    expect(dirs).toMatch(/testId=\{`link-directories-site-\$\{s\}`\}/);
    expect(dirs).toMatch(/testId=\{`link-directories-kind-\$\{kind\}`\}/);
    expect(dirs).toMatch(/<Fig href=\{here\(\{ only: "linked" \}\)\} testId="link-directories-linked"/);
    expect(dirs).toMatch(/<Fig href=\{here\(\{ only: null \}\)\} testId="link-directories-all"/);
    expect(dirs).toMatch(/<Fig href=\{here\(\{ only: "gaps" \}\)\} testId="link-directories-gaps"/);
    expect(dirs).toMatch(/<Fig href=\{seoLinks\.explorer\(r\.domain, "overview", marketParams\(market\)\)\} testId="link-directory"/);
    expect(dirs).toMatch(/<Fig href=\{linksFrom\(r\.domain, d\.sites\[i\]\)\} testId="link-directory-links"/);
    expect(dirs).toMatch(/<Fig href=\{linksFrom\(r\.domain, d\.sites\[i\]\)\} testId="link-directory-no-links"/);
    expect(dirs).toMatch(/const linksFrom = \(dir: string, site: string\) => \(site === domain && planSiteId != null \? seoLinks\.backlinks\(planSiteId, \{ domain: dir \}\) : seoLinks\.explorer\(site, "backlinks", \{ \.\.\.marketParams\(market\), source: dir \}\)\)/);
    // Never buys on arrival: the saved copy is asked for (peek); the three buttons run.
    expect(dirs).toMatch(/\{ \.\.\.body, peek: true \}/);
    expect(dirs.match(/run\.mutate\(/g)?.length).toBe(3);
    expect(dirs).not.toMatch(/useEffect\([^)]*run\.mutate/);
    expect(dirs).not.toMatch(/["`]\/seo\//);
  });
  it("on a phone: every link is thumb-sized, says it is a link without a pointer, shows focus — and no hover-only cue or small pill is left", () => {
    expect(viz).toMatch(/export const LINK_CUE = "text-\[color:var\(--g-accent-ink\)\] underline decoration-1[^"]*focus-visible:outline[^"]*"/);
    expect(viz).toMatch(/export const TAP = "inline-flex min-h-\[44px\] items-center"/);
    expect(viz).toMatch(/export function Fig\(/);
    expect(viz).toMatch(/h-11 w-11[^\n]*data-testid="link-open-external"/);
    // Bar rows and share bars with an address are one link each; the distribution bar is a picture and its legend the links; months are a row of links.
    expect(viz).toMatch(/r\.href \? <Fig href=\{r\.href\} testId=\{r\.testId \?\? `link-bar-\$\{i\}`\} label=\{r\.words\} block/);
    expect(viz).toMatch(/return href \? <Fig href=\{href\} testId=\{testId \?\? "link-share"\} label=\{words\}/);
    expect(viz).toMatch(/<div className="flex h-2\.5 overflow-hidden rounded-full" style=\{\{ background: "var\(--g-divider\)" \}\} aria-hidden>/);
    expect(viz).toMatch(/export function MonthLinks\(/);
    expect(viz).toMatch(/<MonthLinks months=\{s\.points\} href=\{monthHref\} current=\{month\} testId=\{`\$\{testId\}-months`\} \/>/);
    // Every series of a chart has its rows link, not only the one shown.
    expect(viz).toMatch(/\{usable\.map\(\(x\) => <Link key=\{x\.key\} href=\{x\.href\(month\)\}[^\n]*data-testid=\{`link-\$\{testId\}-\$\{x\.key\}`\}/);
    for (const [name, src] of [["explorer", explorer], ["report-table", table], ["viz-explorer", viz], ["directories", dirs]] as const) {
      expect(src, `${name}: hover-only link cue`).not.toMatch(/className="g-link"/);
      expect(src, `${name}: 32px pill`).not.toMatch(/g-pill--sm/);
      // The cue and the focus ring come with Fig / FIG (viz-explorer), or are written out where a Link is styled by hand.
      expect(src, `${name}: link cue`).toMatch(/focus-visible|className=\{FIG\}/);
    }
    expect(table).toMatch(/className=\{FIG\}/);
    expect(table).toMatch(/<Fig href=/);
    expect(explorer).toMatch(/className=\{`inline-flex min-h-\[44px\] items-center rounded-md[^`]*focus-visible:outline[^`]*\$\{view === key \? "font-medium" : "g-text-2 underline/);
  });
});

describe("round 3 (Kimi round 2): paging, the order, the chart figure, the market picker, Directories", () => {
  const explorer = code(read("explorer.tsx")), table = code(read("report-table.tsx")), dirs = code(read("directories.tsx"));
  it("the builder writes the page of rows; the first page and the default size are no words", () => {
    expect(seoLinks.explorer("example.com", "backlinks", { offset: 50 })).toBe("/seo/explorer?domain=example.com&view=backlinks&offset=50");
    expect(words(seoLinks.explorer("example.com", "keywords", { offset: 100, limit: 100 }))).toMatchObject({ offset: "100", limit: "100" });
    expect(seoLinks.explorer("example.com", "keywords", { offset: undefined, limit: undefined })).toBe("/seo/explorer?domain=example.com&view=keywords");
  });
  it("the address as a page of rows: a size the picker offers, a whole number of pages in, never past the source's last row", () => {
    expect(LIMITS).toEqual([25, 50, 100]); expect(DEFAULT_LIMIT).toBe(50); expect(MAX_OFFSET).toBe(9900);
    expect(pageFromAddress({})).toEqual({ limit: 50, offset: 0 });
    expect(pageFromAddress({ offset: "50" })).toEqual({ limit: 50, offset: 50 });
    expect(pageFromAddress({ offset: "75", limit: "25" })).toEqual({ limit: 25, offset: 75 });
    expect(pageFromAddress({ offset: "75" })).toEqual({ limit: 50, offset: 0 });
    expect(pageFromAddress({ limit: "30" })).toEqual({ limit: 50, offset: 0 });
    expect(pageFromAddress({ offset: "-50" })).toEqual({ limit: 50, offset: 0 });
    expect(pageFromAddress({ offset: "9950" })).toEqual({ limit: 50, offset: 0 });
    expect(pageFromAddress({ offset: "9900" })).toEqual({ limit: 50, offset: 9900 });
    expect(pageFromAddress({ offset: "1e2" })).toEqual({ limit: 50, offset: 0 });
    expect(pageFromAddress({ offset: "100" }, [50], 50)).toEqual({ limit: 50, offset: 100 });
  });
  it("the order the address picked is said in the chip — the default is no word, an order the list lacks is said, a month already names it", () => {
    const chip = (t: Parameters<typeof filterWords>[0], p: Record<string, string>) => { const { filters, scope } = filtersFromAddress(t, p, "example.com"); return filterWords(t, filters, scope, p, sortKeyOf(t, p.sort)); };
    expect(chip("matchingTerms", { sort: "difficulty" })).toEqual(["Ordered by “Easiest”"]);
    expect(chip("keywords", { sort: "cpc" })).toEqual(["Ordered by “Highest CPC”"]);
    expect(chip("keywords", { sort: "traffic" })).toEqual([]);
    expect(chip("keywords", { sort: "nope" })).toEqual(["“nope” is not an order this list offers, so it is ordered by “Most traffic”"]);
    expect(chip("backlinks", { sort: "constructor" })).toEqual(["“constructor” is not an order this list offers, so it is ordered by “Strongest sites”"]);
    expect(chip("referringDomains", { sort: "newest", band: "top3" })).toEqual(["Ordered by “Newest”"]);
    expect(chip("backlinks", { sort: "newest", month: "2026-08" })).toEqual(["Aug 2026 picked on the chart — this list isn't split by month; it is ordered by “newest”"]);
  });
  it("a chart figure is named only when its chart is drawn", () => {
    expect(overviewWords({ series: "backlinks" })).toEqual(["Chart figure: Backlinks"]);
    expect(overviewWords({ series: "backlinks" }, new Set(["traffic", "keywords", "top10", "domains", "backlinks", "new", "lost"]))).toEqual(["Chart figure: Backlinks"]);
    expect(overviewWords({ series: "backlinks" }, new Set(["traffic", "keywords", "top10"]))).toEqual(["Chart figure Backlinks is not shown: its chart isn't drawn for this site (it needs two months of figures or more)"]);
    expect(overviewWords({ series: "nope" }, new Set())).toEqual(["“nope” is not a chart figure here, so the first figure is shown"]);
    // The screen passes the figures drawn (each chart needs two months; a figure two months of its own) once the report is on screen.
    expect(explorer).toMatch(/const drawn = report \? new Set\(\[\.\.\.\(hist\.length > 1 \? performance : \[\]\), \.\.\.\(links\.length > 1 \? growth : \[\]\)\]\.filter\(\(x\) => x\.points\.length >= 2\)\.map\(\(x\) => x\.key\)\) : undefined;/);
    expect(explorer).toMatch(/overviewWords\(Object\.fromEntries\(OVERVIEW_PARAMS\.map\(\(k\) => \[k, params\.get\(k\) \?\? undefined\]\)\), drawn\)/);
  });
  it("a full report's page of rows is the address: Previous / Next and the Rows picker write it, the chip's Clear drops the order too, the date is a link", () => {
    expect(table).toMatch(/const paged = linked \? pageFromAddress\(address\) : null;/);
    expect(table).toMatch(/const setOffset = \(n: number\) => \{ if \(linked\) setParam\("offset", n > 0 \? n : null\); else setOwnOffset\(n\); \};/);
    expect(table).toMatch(/const setLimit = \(n: number\) => \{ if \(linked\) setParams\(\{ limit: n === DEFAULT_LIMIT \? null : n, offset: null \}\);/);
    expect(table).toMatch(/onChange=\{\(e\) => setLimit\(Number\(e\.target\.value\)\)\} data-testid="report-limit"/);
    expect(table).toMatch(/onClick=\{\(\) => setOffset\(Math\.max\(0, offset - limit\)\)\} data-testid="button-prev-page"/);
    expect(table).toMatch(/onClick=\{\(\) => setOffset\(offset \+ limit\)\} data-testid="button-next-page"/);
    expect(table).not.toMatch(/useState<25 \| 50 \| 100>/);
    expect(table).toMatch(/setParams\(\{ \.\.\.addressFromFilters\(table, \{\}, null\), month: null, sort: null, offset: null \}\)/);
    expect(table).toMatch(/<Fig href=\{seoLinks\.usage\(\{ month: page\.fetchedAt\.slice\(0, 7\) \}\)\} testId="link-report-as-of"/);
    // Never buys on arrival: a page opened by link only peeks; its rows wait for the button.
    expect(table).not.toMatch(/useEffect\([^)]*run\.mutate/);
  });
  it("a page row's figures say whose keywords open when the page isn't on this site", () => {
    expect(explorer).toMatch(/const whose = path \? "the keywords of this page" : `\$\{report\.domain\}'s keywords \(this page's address isn't on/);
    expect(cellOf(explorer, "link-page-traffic")).toContain("words={`${fmtNum(p.traffic)} visits a month — ${whose}`}");
    expect(cellOf(explorer, "link-page-value")).toContain("— ${whose}, by ad price");
  });
  it("Directories: the competitors compared are said in a chip with a clear; the date and the price open the Usage page", () => {
    expect(dirs).toMatch(/import \{ ActiveFilter, api/);
    expect(dirs).toMatch(/\{rivalsRaw != null && \(\s*<ActiveFilter onClear=\{\(\) => setParams\(\{ rivals: null, only: null \}\)\} clearLabel="Start over">/);
    expect(dirs).toContain("compared with ${arrived.join(\", \")}");
    expect(dirs).toContain("on its own — no competitor compared");
    expect(dirs).toContain("left out: ${leftOut.join(\", \")}");
    expect(dirs).toMatch(/<Fig href=\{seoLinks\.usage\(\{ month: d\.fetchedAt\.slice\(0, 7\) \}\)\} testId="link-directories-as-of"/);
    expect(dirs).toMatch(/<Fig href=\{seoLinks\.usage\(\)\} testId="link-directories-price"/);
    expect(dirs).not.toMatch(/· as of \{fmtDate\(d\.fetchedAt\)\} ·/);
  });
});
