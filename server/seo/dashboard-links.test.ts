/**
 * SEO dashboard — "all data takes you somewhere" (owner 2026-10-09). The dashboard (client/src/pages/seo/dashboard.tsx)
 * and the shared figure pieces (viz.tsx) make every figure a link built by seoLinks, honour ?sort / ?group / ?filter and
 * #sites on arrival and on every change, say what narrows the list in the active-filter chip (remembered or by
 * address), and keep every link a thumb's size with a cue that needs no hover. Pure module + source guard, no browser
 * (the audit-links test's pattern). docs/seo-links/dashboard.md is the map these pins keep true.
 */
import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import { seoLinks } from "../../client/src/pages/seo/links";

const read = (rel: string) => fs.readFileSync(path.resolve(import.meta.dirname, "../../client/src/pages/seo", rel), "utf8");
/** Comments aside; only code counts. */
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
/** A link whose data-testid (or a component's testId / linkTestId) starts with `t`. */
const pinned = (t: string) => new RegExp(`(testId|data-testid)=\\{\`${t}`);

describe("the dashboard address (links.ts)", () => {
  it("is one builder; the list's anchor is #sites; an absent narrowing writes nothing", () => {
    expect(seoLinks.dashboard()).toBe("/seo");
    expect(seoLinks.dashboard({ sort: "health" })).toBe("/seo?sort=health");
    expect(seoLinks.dashboard({ group: "none", filter: "crawled" })).toBe("/seo?group=none&filter=crawled");
    expect(seoLinks.dashboardSites()).toBe("/seo#sites");
    expect(seoLinks.dashboardSites({ group: "Smith Roofing", sort: "top10", filter: "analysed" })).toBe("/seo?group=Smith+Roofing&sort=top10&filter=analysed#sites");
    // The empty state's "Site explorer" is the builder with no domain — not a hand-written address.
    expect(seoLinks.explorer("")).toBe("/seo/explorer");
    // Where a card's figures land.
    expect(seoLinks.explorer("mysite.com", "keywords", { band: "top3" })).toBe("/seo/explorer?domain=mysite.com&view=keywords&band=top3");
    expect(seoLinks.explorer("mysite.com", "overview", { month: "2026-03" })).toBe("/seo/explorer?domain=mysite.com&month=2026-03");
    expect(seoLinks.audit(3, { at: "crawl-a", vs: "crawl-b" })).toBe("/seo/audit?site=3&at=crawl-a&vs=crawl-b");
    expect(seoLinks.rankTracker(3, { band: "rest" })).toBe("/seo/rank-tracker?site=3&band=rest");
    expect(seoLinks.rankTracker(3, { device: "desktop" })).toBe("/seo/rank-tracker?site=3&device=desktop");
    expect(seoLinks.plan(3, { status: "open" })).toBe("/seo/plan?site=3&status=open");
  });
});

describe("the dashboard honours the address and links every figure", () => {
  const dash = code(read("dashboard.tsx")), viz = code(read("viz.tsx"));

  it("reads sort, group and filter from the address, re-read on every change, and lands on #sites", () => {
    expect(dash).toContain("const address = useAddress()");
    for (const p of ["sort", "group", "filter"]) expect(dash, p).toContain(`address.get("${p}")`);
    // The pickers write the same address; a choice that matches nothing is replaced, not pushed.
    expect(dash).toContain('setParam("sort", k === "added" ? null : k, replace)');
    expect(dash).toContain('setParam("group", g === "all" ? null : g === "none" ? "none" :');
    expect(dash).toContain('if (dash.isSuccess && !valid) chooseGroup("all", true)');
    // #sites scrolls on arrival and again whenever the back or forward button brings it back.
    expect(dash).toContain("const hash = useHash()");
    expect(dash).toContain('if (dash.isSuccess && hash === "sites") scrollToSites(); }, [dash.isSuccess, hash]');
    expect(dash).toContain('<div id="sites"');
  });

  it("never buys data on arrival: the only purchase is the Analyse / Refresh button", () => {
    expect(dash.match(/analyse\.mutate\(/g)).toHaveLength(2);
    expect(dash).not.toMatch(/useEffect\([^;]*analyse\.mutate/);
  });

  it("writes no address of its own: every href is a builder", () => {
    expect(dash).not.toMatch(/href="\//);
    expect(dash).not.toMatch(/href=\{`\//);
    expect(dash).toContain('href={seoLinks.explorer("")}');
  });

  it("the chip says the effective narrowing — remembered or from the address — with one clear that undoes it all", () => {
    expect(dash).toContain("const sort: SortKey = isSort(url.sort) ? url.sort : savedSort");
    expect(dash).toContain('const chip = [activeGroup !== "all" ? `Group: ${groupLabel}` : null, filter ? FILTER_WORDS[filter] : null, sort !== "added" ?');
    expect(dash).toContain('data-testid="active-filter"');
    expect(dash).toContain('data-testid="button-clear-filter"');
    expect(dash).toContain('const clearNarrowing = () => { setParam("filter", null); chooseSort("added", true); chooseGroup("all", true); }');
  });

  it("every figure of the strip and the group line is a link to the list in that order or narrowing", () => {
    // A tile's label and number are one link (linkTestId); its foot and the group line's figures are their own (testId).
    for (const t of ["link-sites", "link-health-average", "link-tracked-total", "link-traffic-total"]) expect(dash, t).toContain(`linkTestId="${t}"`);
    for (const t of ["link-sites-analysed", "link-sites-crawled", "link-health-scored", "link-top10-total", "link-traffic-analysed", "link-totals-sites", "link-totals-keywords", "link-totals-top10", "link-totals-tasks"]) expect(dash, t).toContain(`testId="${t}"`);
    // The label inside a block link keeps its "-label" id (it was a link of its own before the two became one).
    expect(viz).toContain("data-testid={testId && `${testId}-label`}");
    for (const h of ['listAt({ filter: "analysed" })', 'listAt({ filter: "crawled" })', 'listAt({ sort: "health" })', 'listAt({ filter: "crawled", sort: "health" })', 'listAt({ sort: "keywords" })', 'listAt({ sort: "top10" })', 'listAt({ sort: "traffic" })', 'listAt({ filter: "analysed", sort: "traffic" })']) expect(dash, h).toContain(`href={${h}}`);
    // Open tasks are per site: one site's count opens its plan, a group's count orders the list by open tasks.
    expect(dash).toContain('seoLinks.plan(shownCards[0].site.id, { status: "open" })');
    expect(dash).toContain('listAt({ sort: "tasks" })');
  });

  it("a foot says 'none yet' only when its own count is zero, never against the count beside it", () => {
    expect(dash).toContain('crawled.length ? <FigureLink href={listAt({ filter: "crawled" })}');
    expect(dash).toContain('analysed.length ? <FigureLink href={listAt({ filter: "analysed" })}');
    expect(dash).toContain('totals.keywords ? "No check saved yet" : "No keyword tracked yet"');
  });

  it("every figure of a card is a link: numbers, changes, dates, crawl rows, legend entries, start-step counts", () => {
    for (const t of ["link-domain-", "link-analysed-", "link-health-", "link-health-move-", "link-health-pages-", "link-health-crawled-", "link-health-before-", "link-health-audit-", "link-crawl-", "link-authority-", "link-authority-change-", "link-authority-foot-", "link-domains-", "link-domains-change-", "link-backlinks-", "link-traffic-", "link-traffic-change-", "link-traffic-value-", "link-keywords-", "link-keywords-change-", "link-tracked-", "link-tracked-checked-", "link-tracked-due-", "link-add-keywords-", "link-start-tracked-", "link-start-rank-", "link-start-audit-", "link-explore-", "link-rank-", "link-audit-", "link-plan-"]) expect(dash, t).toMatch(pinned(t));
    expect(dash).toContain('href={seoLinks.audit(siteId, { tab: "issues" })}');
    expect(dash).toContain('href={seoLinks.audit(siteId, { tab: "pages" })}');
    expect(dash).toContain("href={seoLinks.audit(siteId, { at: audit.jobId, vs: prev.jobId })}");
    // "Last N crawls": the whole row (date and health figure) opens that crawl.
    expect(dash).toContain("<FigureLink href={crawl(t.jobId)} onClick={onPick} testId={`link-crawl-${siteId}-${i}`}>{fmtDate(t.at)}: {healthWords(t)}</FigureLink>");
    expect(dash).toContain("<FigureLink href={crawl(prev!.jobId)} onClick={onPick} testId={`link-health-before-${siteId}`}>the crawl before scored");
    // "No check saved yet — the first automatic check is due <date>" and the start step's count open the rank tracker.
    expect(dash).toContain("testId={`link-tracked-due-${s.id}`}>No check saved yet{s.nextRankCheckAt ? ` — the first automatic check is due ${fmtDate(s.nextRankCheckAt)}` : \"\"}");
    expect(dash).toContain("testId={`link-start-tracked-${s.id}`}>{fmtNum(s.keywordCount)} tracked</FigureLink>");
    expect(dash).toContain('segmentHref={(k) => ex("keywords", { band: k as PositionBand })}');
    expect(dash).toContain("segmentHref={(k) => seoLinks.rankTracker(s.id, { band: k as PositionBand })}");
    expect(dash).toContain("href={seoLinks.rankTracker(s.id, { device: rank.device ?? undefined })}");
    expect(dash).toContain('pointHref={(_k, p) => ex("overview", { month: p.key })}');
    for (const v of ["authority", "domains", "traffic", "keywords"]) expect(dash, v).toContain(`testId={\`spark-${v}-\${s.id}\`}`);
  });

  it("every link is a thumb's size with a cue that needs no hover (viz.tsx)", () => {
    expect(viz).toContain('export const TAP = "inline-flex min-h-[44px] items-center"');
    expect(viz).toMatch(/export const LINK_CUE = `underline decoration-\[color:color-mix\(in_srgb,currentColor_45%,transparent\)\] underline-offset-\[3px\] hover:decoration-\[color:currentColor\] focus-visible:decoration-\[color:currentColor\] \$\{FOCUS\}`/);
    expect(viz).toContain('export const FOCUS = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--g-blue)]"');
    expect(viz).toMatch(/function FigureLink\([\s\S]*?className=\{`\$\{TAP\} \$\{LINK_CUE\} rounded-sm \$\{className\}`\}/);
    // A figure's label and number are one block link (54px tall); the change beside it is its own 44px link.
    expect(viz).toMatch(/function FigureBlock\([\s\S]*?<Link href=\{href\} onClick=\{onClick\} className=\{`group block min-w-0 rounded-sm \$\{FOCUS\}`\} data-testid=\{testId\}>/);
    expect(dash).toContain("const CHANGE_LINK = `flex min-h-[44px] items-end self-stretch rounded-sm ${LINK_CUE}`");
    // Bar segments: real, focusable links, 44px tall, with the 10px bar drawn through the middle; the legend the same height.
    expect(viz).toContain('<div className="relative flex min-h-[44px] items-center">');
    expect(viz).toContain("className={`relative flex min-h-[44px] items-center rounded-sm hover:opacity-80 ${FOCUS}`} style={style} aria-label={words}");
    expect(viz).not.toContain("tabIndex={-1}");
    expect(viz).toContain("data-testid={`link-${testId ?? \"band\"}-bar-${keyOf(p)}`}");
    expect(viz).toContain("className={`${TAP} ${LINK_CUE} gap-1 rounded-sm`} data-testid={`link-${testId ?? \"band\"}-${keyOf(p)}`}");
    // The months of every chart as real anchors (keyboard and touch), not only clicks on the drawing.
    expect(viz).toContain("function MonthList(");
    expect(viz).toContain("<MonthList points={points} hrefOf={pointHref} onPick={onPoint} testId={testId ?? \"spark\"} />");
    expect(viz).toContain("<MonthList points={s.points} hrefOf={(p, i) => pointHref(s.key, p, i)}");
    expect(viz).toContain("testId={`link-${testId}-month-${p.key ?? i}`}");
    // The dashboard's own tappables: the chip's clear, the star, the group button, the pills.
    expect(dash).toContain('className={`grid h-11 w-11 shrink-0 place-items-center rounded-full hover:bg-[color:var(--g-chip)] ${FOCUS}`} aria-label="Clear — all sites, as added"');
    expect(dash).toContain("className={`grid h-11 w-11 shrink-0 place-items-center rounded-full ${FOCUS}`} aria-pressed");
    expect(dash).toContain("g-chip g-chip--sm !min-h-[44px]");
    expect(dash).toContain("const PILL = `g-pill g-pill--sm !min-h-[44px] ${FOCUS}`");
    expect(dash).not.toMatch(/className="g-pill g-pill--sm"/);
  });
});
