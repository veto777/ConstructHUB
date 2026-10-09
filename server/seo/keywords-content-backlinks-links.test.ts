/**
 * Keywords explorer, Content explorer, Backlinks, and the Site explorer's Content gap / Link intersect / Opportunities —
 * "all data takes you somewhere" (owner 2026-10-09; Kimi's audit of the first pass, §2–§7). A source guard, no browser
 * (the audit-links test's pattern): every figure the audit found plain is a link built by seoLinks, the address is read
 * and written where it was dead, the words are honest where no view holds a figure, and a link is a thumb's size.
 * docs/seo-links/keywords-content-backlinks.md lists every figure and where it goes.
 */
import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import { seoLinks } from "../../client/src/pages/seo/links";

const read = (rel: string) => fs.readFileSync(path.resolve(import.meta.dirname, "../../client/src/pages/seo", rel), "utf8");
/** Comments aside; only code counts. */
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
/** The JSX element (opening tag through its own text) carrying a data-testid. */
const tagOf = (src: string, testId: string) => {
  const at = src.indexOf(`data-testid="${testId}"`);
  if (at < 0) throw new Error(`no ${testId}`);
  const open = src.lastIndexOf("<", at);
  return src.slice(open, src.indexOf(">", at) + 1);
};

const keywords = code(read("keywords.tsx")), lists = code(read("keyword-lists.tsx")), planner = code(read("planner.tsx"));
const content = code(read("content.tsx")), backlinks = code(read("backlinks.tsx")), gap = code(read("gap.tsx"));
const opps = code(read("opportunities.tsx")), viz = code(read("viz-keywords.tsx"));
const ALL = { keywords, lists, planner, content, backlinks, gap, opps, viz };

describe("the link look (viz-keywords.tsx): a cue without hovering, a focus outline, 44 px", () => {
  it("defines the cue and the hit areas once", () => {
    expect(viz).toMatch(/export const LINK_CUE = "[^"]*underline decoration-dotted[^"]*focus-visible:outline[^"]*"/);
    expect(viz).toMatch(/export const TAP = "py-\[14px\]"/);
    expect(viz).toMatch(/export const BLOCK_LINK = `\$\{LINK_CUE\} inline-flex min-h-11 items-center`/);
    // A tile that is a link wraps shell.tsx's own Tile (shell.tsx is not changed).
    expect(viz).toMatch(/<Tile label=\{label\} value=\{value\} hint=\{hint\} testId=\{tileTestId\} \/>/);
  });
  it("no screen writes an address by hand, and no small pill is left", () => {
    for (const [name, src] of Object.entries(ALL)) {
      expect(src, name).not.toMatch(/href=["{`]+\/seo/);
      expect(src, name).not.toMatch(/href=\{?[`"]#/);
      expect(src, name).not.toMatch(/"g-pill g-pill--sm"/);
    }
  });
});

describe("keywords explorer: intent is alive both ways (§4, the big one)", () => {
  it("the ideas table reads and writes the address", () => {
    expect(keywords).toMatch(/<ReportView key=\{`\$\{ideas\}:\$\{o\.keyword\}:\$\{marketKey\(market\)\}`\} linked /);
  });
  it("the intent is one of the four, and its chip shows only where a table can be narrowed by it", () => {
    expect(keywords).toMatch(/intent: \(INTENTS as readonly string\[\]\)\.includes\(intent \?\? ""\) \? intent! : undefined/);
    expect(keywords).not.toMatch(/\/\^\[a-z\]\+\$\/\.test\(intent\)/);
    expect(keywords).toMatch(/const INTENT_TABLES: readonly TableKey\[\] = \["matchingTerms", "questions"\]/);
    expect(keywords).toMatch(/const intentOn = address\.intent && INTENT_TABLES\.includes\(ideas\) \? address\.intent : undefined/);
    expect(keywords).toMatch(/if \(intentOn && o\) chips\.push/);
  });
  it("a month alone scrolls to the chart; every bar is a pick, with a month picker as the keyboard's way", () => {
    expect(keywords).toMatch(/address\.section \?\? \(address\.month \? "volume" : address\.table \? "ideas" : undefined\)/);
    expect(keywords).toMatch(/<MonthlyBars [^>]*onBar=\{/);
    expect(tagOf(keywords, "select-volume-month")).toMatch(/onChange=\{\(e\) => go\(\{ section: "volume", month: e\.target\.value \|\| undefined \}\)\}/);
  });
  it("the remaining figures are links: the date, a result's place, the price", () => {
    expect(tagOf(keywords, "link-keyword-as-of")).toContain("seoLinks.usage({ month: o.fetchedAt.slice(0, 7) })");
    expect(keywords).toMatch(/seoLinks\.explorer\(s\.domain, "keywords", \{ contains: o\.keyword/);
    expect(keywords).toContain(`data-testid={\`link-serp-position-\${s.position}\`}`);
    expect(tagOf(keywords, "link-keyword-price")).toContain("seoLinks.usage()");
  });
  it("Refresh and Track are 44 px; the country picker writes the address on every view", () => {
    expect(keywords).toMatch(/const PILL = "g-pill g-pill--sm !min-h-11"/);
    expect(tagOf(keywords, "button-keyword-refresh")).toContain("className={PILL}");
    expect(tagOf(keywords, "button-track-keyword")).toContain("className={PILL}");
    expect(keywords).toMatch(/const pickMarket = \(m: SeoMarket\) => \{ changeMarket\(m\); go\(\{ locationCode: m\.locationCode, languageCode: m\.languageCode \}\); \}/);
    expect(keywords).toMatch(/<BulkKeywords [^>]*onMarket=\{pickMarket\}/);
  });
});

describe("keywords explorer: many keywords, lists, Service × town", () => {
  it("a row's CPC and intent are links; grouping by topic is the address", () => {
    expect(tagOf(lists, "link-keyword-cpc")).toContain(`kw(r, { section: "cpc" })`);
    expect(tagOf(lists, "link-keyword-intent")).toMatch(/kw\(r, \{ section: "ideas", table: "matchingTerms", intent:/);
    expect(lists).not.toMatch(/\[grouped, setGrouped\] = useState/);
    expect(lists).toMatch(/const grouped = topic != null/);
    expect(lists).toContain(`data-testid={\`\${testId}-group\`}`);
    expect(tagOf(lists, "link-topic-rows")).toContain(`at(g.term ?? "other")`);
  });
  it("a list that isn't one of yours says so; the clear says what it does", () => {
    expect(lists).toContain("isn't one of your lists");
    expect(lists).not.toContain(`"Close this list"`);
    expect(lists).toMatch(/clearLabel="Back to the first list"/);
  });
  it("the planner's tiles narrow the grid (`show`), its cells' figures are links, selecting is its own control", () => {
    for (const s of ["gaps", "weak", "strong", "unknown"]) expect(tagOf(planner, `link-planner-${s}`)).toContain(`showAt("${s}")`);
    expect(planner).toMatch(/\{show && <ActiveFilter onClear=\{\(\) => setParam\("show", null\)\}/);
    expect(tagOf(planner, "link-cell-keyword")).toMatch(/seoLinks\.keywords\(c\.keyword, \{ \.\.\.marketParams\(market\), section: "volume" \}\)/);
    expect(tagOf(planner, "link-cell-position")).toMatch(/seoLinks\.explorer\(d\.domain, "keywords", \{ contains: c\.keyword/);
    expect(planner).toMatch(/<input type="checkbox" checked=\{on\} onChange=\{\(\) => toggle\(c\.keyword\)\}/);
    expect(planner).not.toMatch(/<button type="button" onClick=\{\(\) => toggle\(c\.keyword\)\}/);
    expect(tagOf(planner, "link-planner-as-of")).toContain("seoLinks.usage({ month: d.fetchedAt.slice(0, 7) })");
  });
});

describe("content explorer", () => {
  it("a page keeps its query string (§3.10) and its linking sites are that page's (§3.6)", () => {
    expect(content).not.toMatch(/new URL\(url\)\.pathname/);
    expect(content).toMatch(/const pagePath = \(r: Row\) => pathOfUrl\(r\.url, r\.domain\)/);
    expect(content).toMatch(/testId="link-content-links"/);
    expect(content).toMatch(/href=\{pageView\(r, "backlinks"\)\} testId="link-content-links"/);
  });
  it("the meta line, the snippet and the date are links; the page of results is the address", () => {
    for (const id of ["link-content-total", "link-content-showing", "link-content-snippet", "link-content-published"]) expect(content).toContain(`data-testid="${id}"`);
    expect(content).toMatch(/offset: Number\.isInteger\(offset\)/);
    expect(content).toMatch(/<Link href=\{nextHref\}[^>]*data-testid="button-content-next"/);
    expect(content).toMatch(/<Link href=\{prevHref\}[^>]*data-testid="button-content-prev"/);
    expect(content).not.toMatch(/setOffset\(/);
  });
  it("every select is the 40 px one", () => {
    expect(content).toMatch(/const SELECT = "g-input g-select !w-auto"/);
    expect(content).not.toMatch(/className="g-select"/);
  });
});

describe("backlinks", () => {
  it("the site's spam score opens the closest view and says so (§3.4); new / lost referring domains say there's no list (§3.5)", () => {
    const spam = tagOf(backlinks, "link-spam");
    expect(spam).toContain(`view("referringDomains")`);
    expect(spam).toContain("has no view of its own");
    expect(backlinks).not.toMatch(/view\("brokenBacklinks"\)\} className=\{FIG_LINK\}[^>]*data-testid="link-spam"/);
    expect(backlinks).toContain("no list holds just these; both open every referring domain");
  });
  it("every figure in the meta line, the tiles' changes and both tables is a link", () => {
    for (const id of ["link-snapshot-date", "link-snapshot-next", "link-rank-delta", "link-backlinks-delta", "link-domains-delta", "link-pages-delta", "link-spam-delta",
      "link-lost-spam", "link-lost-last-seen", "link-page-anchor", "link-page-spam", "link-page-first-seen", "link-listed-count", "link-lost-kept"]) expect(backlinks, id).toContain(`"${id}"`);
    expect(backlinks).toMatch(/const spamOf = \(domain: string\) => view\("referringDomains", \{ contains: domain \}\)/);
    expect(backlinks).toMatch(/<DistributionBar testId="backlinks-follow" segmentHref=\{/);
  });
  it("a page of the site keeps its query string (§3.10)", () => {
    expect(backlinks).not.toMatch(/new URL\(url\)\.pathname/);
    expect(backlinks).toMatch(/pathOfUrl\(url, site\.domain\)/);
  });
  it("the small words are 44 px: only this site, dofollow / nofollow", () => {
    for (const id of ["link-lost-only", "link-page-only", "link-dofollow", "link-nofollow"]) expect(tagOf(backlinks, id)).toContain("TEXT_LINK");
  });
});

describe("Site explorer: content gap and link intersect", () => {
  it("CPC, a position without a page, their traffic, spam and first seen are links", () => {
    expect(tagOf(gap, "link-gap-cpc")).toContain(`kw(r.keyword, { section: "cpc" })`);
    expect(tagOf(gap, "link-gap-position")).toContain("theirs(c, r.keyword)");
    expect(gap).toMatch(/hit \? <><Link href=\{theirs\(c, r\.keyword\)\}/);
    for (const id of ["link-gap-traffic", "link-gap-spam", "link-gap-first-seen", "link-gap-count", "link-gap-as-of"]) expect(gap, id).toContain(`"${id}"`);
  });
  it("'Links to <competitor>' — 0 included — opens that competitor's referring domains narrowed to the site, and says so (§3.7)", () => {
    expect(gap).toMatch(/const linksTo = \(competitor: string, linking: string\) => seoLinks\.explorer\(competitor, "referringDomains", \{ contains: linking \}\)/);
    expect(gap).toContain("was found — ${c}'s referring domains in Site explorer, narrowed to ${r.domain}, list nothing");
  });
  it("the comparison is the address: read on arrival (nothing bought), written by Compare", () => {
    expect(gap).toMatch(/const address = useAddress\(\);\s*const competitorsParam = address\.get\("competitors"\)/);
    // Compare writes the comparison from its first page (one history entry).
    expect(gap).toMatch(/setParams\(\{ competitors: draft\.join\(","\), offset: null \}\)/);
    expect(gap.match(/run\.mutate\(/g) ?? []).toHaveLength(2);
  });
});

describe("Site explorer: opportunities", () => {
  it("the list is the address (`opp`, `path`), not local state", () => {
    expect(opps).not.toMatch(/useState<Tab>/);
    expect(opps).not.toMatch(/setOpenPage|setTab/);
    expect(opps).toMatch(/const tab: Tab = TABS\.find\(\(t\) => t === oppParam\) \?\? "within"/);
    expect(opps).toMatch(/const here = \(opp: Tab, path\?: string\) => seoLinks\.explorer\(domain, "opportunities", \{ opp, path, \.\.\.loc \}\)/);
  });
  it("the tiles, tabs and their counts, the pages tab's figures, a position and the places lost are links", () => {
    for (const t of ["within", "falling", "pages", "home"]) {
      expect(opps).toContain(`<TileLink href={here("${t}")}`);
      expect(opps).toContain(`tileTestId="tile-opp-${t}"`);
    }
    expect(opps).toMatch(/<Link key=\{t\} href=\{here\(t\)\}[^>]*data-testid=\{`tab-opp-\$\{t\}`\}/);
    for (const id of ["link-opp-page-searches", "link-opp-page-visits", "link-opp-page-top3", "link-opp-page-top10", "link-opp-position", "link-opp-fell", "link-opp-best-position", "link-opp-as-of", "link-opp-analysed"]) expect(opps, id).toContain(`"${id}"`);
    expect(tagOf(opps, "button-opp-open-page")).toContain(`href={here("pages", pagePath(p))}`);
    expect(opps).toMatch(/\{chip && <ActiveFilter onClear=\{chip\.clear\}/);
  });
  it("arriving never buys", () => {
    expect(opps.match(/run\.mutate\(/g) ?? []).toHaveLength(2);
  });
});

describe("round 3 (Kimi round 2): the remaining figures, the address, honest words, the phone", () => {
  const SCREENS = { keywords, planner, gap, opps };
  it("every link to a keyword report carries the country with its language (marketParams), never locationCode alone", () => {
    for (const [name, src] of Object.entries(SCREENS)) expect(src, name).not.toMatch(/DEFAULT_MARKET\.locationCode \? \{ locationCode/);
    expect(keywords).toMatch(/seoLinks\.explorer\(s\.domain, "keywords", \{ contains: o\.keyword, \.\.\.marketParams\(market\) \}\)/);
    expect(tagOf(planner, "link-cell-position")).toContain(`seoLinks.explorer(d.domain, "keywords", { contains: c.keyword, ...marketParams(market) })`);
    expect(gap).toMatch(/const theirs = \(competitor: string, keyword: string\) => seoLinks\.explorer\(competitor, "keywords", \{ contains: keyword, \.\.\.marketParams\(market\) \}\)/);
    expect(opps).toMatch(/const loc = marketParams\(market\);/);
  });
  it("keywords: the ranking page's path is a link, the feature tags write section=features, the SERP cells are labelled, an intent's title is honest", () => {
    expect(keywords).toContain("data-testid={`link-serp-path-${s.position}`}");
    expect(keywords).toMatch(/seoLinks\.explorer\(s\.domain, "pages", \{ path, \.\.\.marketParams\(market\) \}\)/);
    expect(keywords).not.toMatch(/<span className="min-w-0 truncate">\{rest\}<\/span><\/span><\/td>/);
    expect(keywords).toMatch(/<FeatureTag [^>]*href=\{addr\(\{ section: "features" \}\)\}/);
    for (const label of ["Place", "Page", "Site authority", "Site"]) expect(keywords, label).toContain(`data-label="${label}"`);
    expect(tagOf(keywords, "link-intent")).toContain("the ideas table has no filter for this intent, so every idea is shown");
  });
  it("keyword lists: 'Other keywords' opens its rows, the market words are the picked market's, an intent's title is honest", () => {
    expect(tagOf(lists, "link-topic-other")).toContain(`href={at("other")}`);
    expect(lists).not.toContain("intent for each. United States, Google.");
    expect(lists).toContain('`Volume, difficulty, cost per click and intent for each. ${market?.label ?? "United States"}, Google.`');
    expect(tagOf(lists, "link-keyword-intent")).toContain("the ideas table has no filter for this intent, so every idea is shown");
    expect(tagOf(gap, "link-gap-intent")).toContain("the ideas table has no filter for this intent, so every idea is shown");
  });
  it("Service × town: '—' is no link, every foot is, the chip is honest when a part didn't load, headings narrow (service / town), a phone gets cards", () => {
    for (const k of ["gaps", "weak", "strong", "unknown"]) expect(planner, k).toContain(`value={d.summary.${k} == null ? "—" : <Link href={showAt("${k}")}`);
    for (const k of ["weak", "strong", "unknown"]) expect(tagOf(planner, `link-planner-${k}-foot`)).toContain(`showAt("${k}")`);
    expect(planner).toContain("your rankings didn't load this time, so no cell can be sorted here");
    expect(planner).toContain("the search volumes didn't load this time, so no cell can be called a gap");
    expect(planner).toMatch(/\{show && <ActiveFilter onClear=\{\(\) => setParam\("show", null\)\} clearLabel="Every cell">\{showWords\(show\)\}/);
    expect(planner).toMatch(/const areaAt = \(p: \{ show\?: Show; service\?: string; town\?: string \}\) => seoLinks\.keywords\("", \{ view: "area", \.\.\.p \}\)/);
    expect(planner).toContain('address.get("service")');
    expect(planner).toContain('address.get("town")');
    expect(planner).toContain('setParam("service", null)');
    expect(planner).toContain('setParam("town", null)');
    expect(planner).toContain("data-testid={`link-planner-service-${idOf(s)}`}");
    expect(planner).toContain("data-testid={`link-planner-town-${idOf(t)}`}");
    expect(planner).toMatch(/const PHONE = "\(max-width: 639px\)"/);
    expect(planner).toMatch(/\{!phone \? \(/);
    expect(planner).toContain('data-testid="planner-cards"');
    expect(seoLinks.keywords("", { view: "area", service: "roof repair", town: "lynden" })).toBe("/seo/keywords?view=area&service=roof+repair&town=lynden");
  });
  it("content: the visits figure's title says when it opens the whole site", () => {
    expect(content).toContain('opens ${pagePath(r) ? "this page" : `${r.domain}\'s pages (the page\'s address could not be read as one of its pages)`} in Site explorer');
  });
  it("gap and opportunities: the page of rows is the address, and Previous / Next are links", () => {
    expect(gap).toMatch(/const offset = kind === "links" \? pageFromAddress\(\{ offset: address\.get\("offset"\) \}, \[limit\], limit\)\.offset : 0;/);
    expect(gap).toMatch(/<Link href=\{comparisonAt\(Math\.max\(0, offset - limit\)\)\}[^>]*data-testid="button-gap-prev"/);
    expect(gap).toMatch(/<Link href=\{comparisonAt\(offset \+ limit\)\}[^>]*data-testid="button-gap-next"/);
    expect(gap).not.toMatch(/setOffset\(/);
    expect(opps).toMatch(/const offsetParam = pageFromAddress\(\{ offset: address\.get\("offset"\) \}, \[PER_PAGE\], PER_PAGE\)\.offset;/);
    expect(opps).toMatch(/<Link href=\{pageAt\(from - PER_PAGE\)\}[^>]*data-testid="button-opp-prev"/);
    expect(opps).toMatch(/<Link href=\{pageAt\(from \+ PER_PAGE\)\}[^>]*data-testid="button-opp-next"/);
    expect(tagOf(opps, "link-opp-paging")).toContain("href={pageAt(from)}");
    expect(opps).not.toMatch(/setPage\(/);
    expect(seoLinks.explorer("mysite.com", "opportunities", { opp: "within", offset: 50 })).toBe("/seo/explorer?domain=mysite.com&view=opportunities&opp=within&offset=50");
  });
  it("opportunities: a tab's label carries the link cue too, not only its count", () => {
    expect(opps).toMatch(/data-testid=\{`tab-opp-\$\{t\}`\}><span className="underline decoration-dotted decoration-1 underline-offset-4">\{label\}<\/span>/);
    expect(opps).toMatch(/<Link key=\{t\} href=\{here\(t\)\} className="[^"]*focus-visible:outline[^"]*"/);
  });
  it("backlinks: a Domain rank with no site named still links; 'lost' is named only when the list is drawn", () => {
    const at = backlinks.indexOf('data-label="Domain rank"');
    const cell = backlinks.slice(at, backlinks.indexOf("</td>", at));
    expect(cell.match(/data-testid="link-page-authority"/g)).toHaveLength(2);
    expect(cell).toContain('href={view("referringDomains")}');
    expect(backlinks).toContain("d.snapshot.changes ? `Lost backlinks since ${fmtDate(d.snapshot.changes.since)}` : \"Lost backlinks: this snapshot keeps no list of them");
  });
});
