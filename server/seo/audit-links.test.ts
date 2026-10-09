/**
 * Site audit — "all data takes you somewhere" (owner 2026-10-09). The audit screen (client/src/pages/seo/audit.tsx and
 * its views) honours every parameter links.ts names for it on arrival, writes the address on every pick, says what
 * narrowed a view in its active-filter chip, and makes every figure a link built by seoLinks. Pure module + source
 * guard, no browser (the rank-tracker-ui test's pattern).
 */
import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import { seoLinks } from "../../client/src/pages/seo/links";

const read = (rel: string) => fs.readFileSync(path.resolve(import.meta.dirname, "../../client/src/pages/seo", rel), "utf8");
/** Comments aside; only code counts. */
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("the audit address (links.ts)", () => {
  it("is one builder, and an absent narrowing writes nothing", () => {
    expect(seoLinks.audit(3)).toBe("/seo/audit?site=3");
    expect(seoLinks.audit(3, { tab: "pages", status: "4xx", at: "crawl-a", vs: "crawl-b" })).toBe("/seo/audit?site=3&tab=pages&status=4xx&at=crawl-a&vs=crawl-b");
    expect(seoLinks.audit(3, { severity: "warning", area: "Content", issue: "missing-title" })).toBe("/seo/audit?site=3&severity=warning&area=Content&issue=missing-title");
    expect(seoLinks.audit(3, { tab: "pages", show: "thin", page: "/services?x=1" })).toBe("/seo/audit?site=3&tab=pages&show=thin&page=%2Fservices%3Fx%3D1");
    // Round 3: the reveals are addresses (appended, nothing renamed).
    expect(seoLinks.audit(3, { issue: "missing-title", all: true })).toBe("/seo/audit?site=3&issue=missing-title&all=true");
    expect(seoLinks.audit(3, { tab: "pages", more: 300 })).toBe("/seo/audit?site=3&tab=pages&more=300");
  });
});

/**
 * Every figure call (fmtNum, fmtDate, plural, money, secs, n, compact) written as page text in a component's JSX must sit
 * inside a link (<Link>/<a>) or a control (<button>/<option>): a figure left as bare text is what the owner's rule
 * (2026-10-09) forbids. A source heuristic — an attribute (`title={…}`) or a template string (`${…}`) is not page text
 * and is skipped — so it catches the plain cases, not every possible one. Returns the offending snippets.
 */
function bareFigures(src: string): string[] {
  const body = src.slice(src.indexOf("\n  return ("));
  const re = /(^|[^$=])\{\s*(fmtNum|fmtDate|plural|money|secs|n|compact)\(|([^\w\s]\s*[?:])\s*(fmtNum|fmtDate|plural|money|secs|n|compact)\(/g;
  const out: string[] = [];
  for (let m = re.exec(body); m; m = re.exec(body)) {
    const before = body.slice(0, m.index + m[0].length);
    const open = (before.match(/<(Link|a|button|option)[\s>]/g) ?? []).length - (before.match(/<\/(Link|a|button|option)>/g) ?? []).length;
    if (open <= 0) out.push(body.slice(m.index, m.index + 70).replace(/\s+/g, " "));
  }
  return out;
}

describe("the audit screen honours the address and links every figure", () => {
  const audit = code(read("audit.tsx")), pages = code(read("audit-pages.tsx")), viz = code(read("viz-audit.tsx"));
  const outgoing = code(read("outgoing-links.tsx")), opps = code(read("link-opportunities.tsx")), render = code(read("render.tsx"));
  const links = code(fs.readFileSync(path.resolve(import.meta.dirname, "../../client/src/pages/seo/links.ts"), "utf8"));

  it("reads every parameter from the address and never from local state", () => {
    for (const p of ["site", "tab", "severity", "area", "issue", "status", "show", "page", "at", "vs", "result"]) expect(audit, p).toContain(`P.get("${p}")`);
    expect(audit).toMatch(/const P = useAddress\(\)/);
    // The crawl pickers write the address (one history entry for a pick of several parameters).
    expect(audit).toMatch(/const choose = \(c: \{ at: string \| null; vs: string \| null \}\) => setParams\(\{ at: c\.at, vs: c\.vs \}\)/);
    // A site picked on the page: the shell writes ?site= (one entry); the audit corrects that entry in place, dropping the
    // other site's crawls, issue and page — so the back button returns to the crawl before, in one step.
    expect(audit).toContain("const pickSite = (id: number) => { picked.current = true; onSite(id); };");
    expect(audit).toContain("setParams({ at: null, vs: null, issue: null, page: null }, true)");
    expect(audit).not.toMatch(/useState<Severity \| "all">|useState<"issues"/);
    // `result` is appended to the audit builder (links.ts: append only).
    expect(links).toMatch(/audit: \(siteId: number, p: \{[^}]*page\?: string; result\?: string; all\?: boolean; more\?: number \}/);
    expect(seoLinks.audit(3, { tab: "rendering", result: "differ", page: "/a" })).toBe("/seo/audit?site=3&tab=rendering&result=differ&page=%2Fa");
  });

  it("never starts a crawl or a check on arrival", () => {
    const starts = audit.match(/start\.mutate\(/g) ?? [];
    expect(starts).toHaveLength(1);
    expect(audit).toContain('onClick={() => start.mutate()} data-testid="button-run-audit"');
    // The rendering check runs only from its priced button.
    expect(render.match(/start\.mutate\(/g) ?? []).toHaveLength(1);
    expect(render).toContain('onClick={() => start.mutate({ siteId: site.id, urls })} data-testid="button-render-run"');
  });

  it("every figure of the overview is a link built by seoLinks", () => {
    for (const t of ["link-health", "link-health-change", "link-crawled-at", "link-pages-crawled", "link-pages-crawled-label", "link-trend-first", "link-trend-last", "link-compared-crawl", "link-audit-newest", "link-audit-fixplan",
      "link-excluded", "link-not-crawled", "link-page-cap", "link-blocked", "link-pages-added", "link-pages-removed", "link-trend-list", "link-view-newest"]) expect(audit, t).toContain(`data-testid="${t}"`);
    for (const t of ["link-trend-crawl-", "link-trend-point-", "link-area-", "link-area-unmeasured-", "link-issue-", "link-issue-area-", "link-issue-affected-", "link-issue-change-", "link-issue-count-", "link-issue-listed-", "link-fixed-", "link-not-rechecked-", "link-issue-page-", "tab-audit-view-", "row-issue-", "button-issue-"]) expect(audit, t).toContain(`data-testid={\`${t}`);
    // The severity columns: the column and its "N affected" footnote are two links (viz-audit.tsx SeverityColumn).
    expect(audit).toContain("footTestId={`link-affected-${s}`} testId={`button-severity-${s}`}");
    expect(viz).toMatch(/<Link href=\{href\}[^>]*data-testid=\{testId\}/);
    expect(viz).toMatch(/<Link href=\{footHref\}[^>]*data-testid=\{footTestId\}/);
    expect(viz).toContain("data-testid={`link-status-${p.key}`}");
    expect(viz).toContain("data-testid={`link-status-bar-${p.key}`}");
    expect(audit).toContain('href: go({ tab: "pages", status: s.status })');
    // The overview's "found but not read" counts each land on their own cut of the pages tab (no rows; the chip says so),
    // and the crawl's limit on the cut that explains it — never on Usage, which does not show it.
    for (const st of ["excluded", "beyond-limit", "blocked"]) expect(audit, st).toContain(`go({ tab: "pages", status: "${st}" })`);
    expect(audit).toMatch(/href=\{go\(\{ tab: "pages", status: "beyond-limit" \}\)\}[^>]*data-testid="link-page-cap"/);
    expect(audit).toContain("href={seoLinks.plan(site.id)}");
    expect(audit).toContain('go({ tab: "rendering", area: "Performance" })');
    expect(audit).toContain("href={seoLinks.audit(site.id, { at: cmp.jobId, issue: f.key })}");
    expect(audit).toContain("onPick={(k) => navigate(go({ at: k, vs: undefined }))}");
    expect(audit).not.toMatch(/href="\/site-scan"/);
  });

  it("says what narrowed each view in the active-filter chip, with a way to clear it — also while it loads", () => {
    expect(viz).toContain('data-testid="active-filter"');
    expect(viz).toContain('data-testid="link-clear-filter"');
    expect(audit).toMatch(/<ActiveFilter words=\{narrowed\.join\(" · "\)\} clearHref=\{go\(\{\}\)\}/);
    // Arriving by link, the chip is there before the crawl is read (the narrowing in the address's words).
    expect(audit).toMatch(/\(site \? q\.isLoading : sites\.isLoading\) && asked\.length > 0 && <ActiveFilter/);
    for (const [name, src] of [["pages", pages], ["links", opps], ["outgoing", outgoing], ["rendering", render]] as const) {
      expect(src, name).toMatch(/if \(q\.isLoading\) return <>\{chip\}/);
      expect(src, name).toMatch(/const chip = words\.length > 0 && /);
    }
    expect(render).toContain('words.push("Why performance was not measured")');
  });

  it("each tab carries only its own narrowings; one for another tab is said, with a link there", () => {
    expect(audit).toContain('issues: ["severity", "area", "issue"]');
    expect(audit).toContain('pages: ["status", "show", "page", "severity", "issue", "area"]');
    expect(audit).toContain('links: ["page"], outgoing: ["page"], rendering: ["page", "result"]');
    expect(audit).toContain("const here = (p: AuditParams = {}) => go({ tab: view === \"issues\" ? undefined : view, ...Object.fromEntries(OWNED[view].map((k) => [k, current[k]])), ...p });");
    expect(audit).toContain("— narrows the ${TAB_LABEL[foreignTab]} tab, not this one");
    for (const src of [audit, pages, opps, outgoing, render]) expect(src).toContain('testId: "link-foreign-tab"');
    // `page` is honoured on the three link tabs, not only on the pages tab.
    expect(audit).toContain("<LinkOpportunitiesView key={d?.latestKey ?? \"\"} crawlId={d?.latestKey} site={site} pageHref={pageHref} pageParam={pageParam}");
    expect(audit).toContain("<OutgoingLinksView key={d?.latestKey ?? \"\"} crawlId={d?.latestKey} site={site} pageHref={pageHref} pageParam={pageParam}");
    expect(audit).toContain("<RenderCheck site={site} pageHref={pageHref} pageParam={pageParam} resultParam={resultParam}");
  });

  it("the pages tab cuts by status, severity, issue, area, pill and page — honestly when the crawl has none", () => {
    for (const k of ["2xx", "3xx", "4xx", "5xx", "unusual", "unchecked", "excluded", "beyond-limit", "blocked"]) expect(pages, k).toContain(`key: "${k}"`);
    // The "Couldn't be checked" pill is under "By answer", like the status bar.
    expect(pages).toContain('const ANSWER_PILLS = ["2xx", "3xx", "4xx", "5xx", "unusual", "unchecked"]');
    expect(pages).toContain("r.issues.some((k) => issueSeverity[k] === severity)");
    expect(pages).toContain("r.issues.includes(issue)");
    expect(pages).toContain("r.issues.some(inArea)");
    expect(pages).toContain("matches(r, i) || r.path === page");
    // A page or an issue this crawl has not got is said so — never "One page opened" over a table without it.
    expect(pages).toContain("pageFound ? `One page opened: ${page}` : `${page} — not in this crawl`");
    // An issue this crawl has not got is said in words — its raw key is never printed (round 3).
    expect(pages).toContain('issueKnown ? `Pages listed under “${issueTitles[issue]}”` : "an issue this crawl did not find"');
    expect(pages).toContain("Nothing is listed under that issue in the crawl of");
    expect(audit).toContain('narrowed.push(openIssue ? `${openIssue.title} — its affected pages` : "An issue this crawl did not find")');
    expect(audit).toContain("Nothing is listed under that issue in the crawl of");
    for (const src of [audit, pages]) { expect(src).not.toContain("did not find (${"); expect(src).not.toContain("Nothing is listed under “${"); }
    // Every pill is a link, a pill with no pages too (it lands on the empty list, said).
    expect(pages).not.toMatch(/aria-disabled="true" data-testid=\{`filter-pages/);
    expect(pages).toContain('seoLinks.explorer(site.domain, "pages", { path: r.path })');
    for (const t of ["link-page-row-", "link-page-explorer-", "link-page-issue-", "filter-pages-status-", "row-page-", "detail-page-", "link-page-status-", "link-page-depth-", "link-page-inlinks-", "link-page-words-", "link-page-title-", "link-page-description-", "link-page-size-", "link-page-counts-", "link-page-title-text-"]) expect(pages, t).toContain(`data-testid={\`${t}`);
    for (const t of ["link-pages-count", "link-tile-indexable", "link-tile-links-unmeasured"]) expect(pages, t).toContain(`data-testid="${t}"`);
    expect(pages).toContain('data-testid={`filter-pages-${f.key}`}');
  });

  it("internal links: every figure leads to the page row, the keyword, the rank checks or the pages", () => {
    expect(opps).toContain("const tracker = seoLinks.rankTracker(site.id)");
    expect(opps).toContain("const kw = (i: Item) => seoLinks.rankTracker(site.id, { keyword: i.keyword, device: device(i.device) })");
    expect(opps).toContain("href={seoLinks.keywords(i.keyword)}");
    expect(opps).toContain("href={pageHref(pathOf(i.from))}");
    expect(opps).toContain("href={pageHref(pathOf(i.to))}");
    expect(opps).toContain('seoLinks.rankTracker(site.id, { band: "notFound" })');
    for (const t of ["link-link-opps-crawl", "link-link-opps-checks", "link-link-opps-places", "link-link-opps-targets", "link-link-opps-keywords", "link-left-out-not-ranking", "link-left-out-not-crawled", "link-left-out-not-usable", "link-left-out-aliases", "link-left-out-too-short", "link-left-out-boilerplate", "link-link-opps-more", "link-link-opps-cut", "link-link-opps-tracker"]) expect(opps, t).toContain(`data-testid="${t}"`);
    for (const t of ["link-link-opp-from-", "link-link-opp-from-title-", "link-link-opp-keyword-", "link-link-opp-context-", "link-link-opp-to-", "link-link-opp-position-", "link-link-opp-basis-", "link-link-opp-volume-"]) expect(opps, t).toContain(`data-testid={\`${t}`);
  });

  it("outgoing links: every figure leads to the website, the page row, the live address or the list that holds it", () => {
    expect(outgoing).toContain("href={seoLinks.explorer(x.domain)}");
    expect(outgoing).toContain("href={seoLinks.explorer(hostOf(b.to))}");
    expect(outgoing).toContain('href={seoLinks.explorer(x.domain, "backlinks")}');
    expect(outgoing).toContain("href={pageHref(path(ex.from))}");
    for (const t of ["link-outgoing-crawl", "link-outgoing-links", "link-outgoing-domains", "link-outgoing-pages", "link-outgoing-broken-count", "link-outgoing-checked", "link-outgoing-unchecked", "link-outgoing-more"]) expect(outgoing, t).toContain(`data-testid="${t}"`);
    for (const t of ["link-outgoing-broken-", "link-outgoing-answer-", "link-outgoing-from-", "link-outgoing-from-more-", "link-outgoing-domain-", "link-outgoing-pages-", "link-outgoing-count-", "link-outgoing-example-from-", "link-outgoing-example-to-", "link-outgoing-anchor-", "link-outgoing-checked-"]) expect(outgoing, t).toContain(`data-testid={\`${t}`);
  });

  it("rendering: every figure leads to the row's visit, the result, the page row, Usage or the live page", () => {
    expect(render).toContain("href={pageHref(pathOf(r.url))}");
    // A row's figures write `page` (the visit opens by the address); no click-only fallback.
    expect(render).toContain("const rowHref = (r: Row) => here({ page: openRow?.url === r.url ? undefined : pathOf(r.url) });");
    expect(render).not.toContain("setOpened(");
    // The summary's counts narrow the table to their result.
    for (const r of ["differ", "same", "unknown"]) expect(render, r).toContain(`href={table("${r}")}`);
    // An unknown verdict never borrows a genuine outcome's words.
    expect(render).toContain("Result not recognised (“${v}”)");
    expect(render).toContain("Object.prototype.hasOwnProperty.call(VERDICT, v)");
    // Every table cell carries its label on a phone.
    for (const l of ["Page", "Result", "Words (HTML)", "Words (browser)", "Own-page links (HTML)", "Own-page links (browser)", "Main content painted", "Loaded"]) expect(render, l).toMatch(new RegExp(`data-label="${l.replace(/[()]/g, "\\$&")}"|fig\\("${l.replace(/[()]/g, "\\$&")}"`));
    for (const t of ["link-render-max", "link-render-max-alert", "link-render-price", "link-render-needs", "link-render-have", "link-render-checked", "link-render-differ", "link-render-pages", "link-render-same", "link-render-unknown"]) expect(render, t).toContain(`data-testid="${t}"`);
    for (const t of ["link-render-page-", "link-render-verdict-", "link-render-status-", "link-render-final-", "link-render-title-html-", "link-render-title-browser-", "link-render-h1-html-", "link-render-h1-browser-", "link-render-external-", "link-render-images-", "link-render-interactive-", "link-render-pick-"]) expect(render, t).toContain(`data-testid={\`${t}`);
    // The page limit is the check's own, explained on the page — not a plan limit on Usage.
    expect(render).toMatch(/href=\{`\$\{here\(\{\}\)\}#render-limit`\}[^>]*data-testid="link-render-max"/);
  });

  it("round 3: the reveals are links to addresses, the compare lists' dates are crawls, ↗ is a 44 px target", () => {
    // No local reveal state: "Show all" / "Show more" write `all` / `more`, so the back button undoes them.
    for (const [name, src] of [["audit", audit], ["pages", pages], ["links", opps], ["outgoing", outgoing]] as const) { expect(src, name).not.toMatch(/setShowAll\(|setShown\(/); expect(src, name).not.toMatch(/const \[shown, setShown\]|const \[showAll, setShowAll\]/); }
    expect(audit).toContain('const showAll = ["true", "1"].includes(P.get("all") ?? "");');
    expect(audit).toContain("<Link href={here({ all: showAll ? undefined : true })} className={PILL} aria-expanded={showAll} data-testid={`link-issue-all-${i.key}`}>");
    expect(audit).toContain("foreign={foreign} all={showAll} />");
    expect(audit).toContain("foreign={foreign} more={moreRows} />");
    expect(pages).toContain('<Link href={here({ more: shown + 200 })} className="g-pill mt-3 max-sm:!min-h-11" data-testid="button-pages-more">');
    expect(pages).toContain("const shown = Math.max(more && more > 100 ? more : 100, openAt + 1);");
    expect(opps).toContain('<Link href={here({ all: true })} className={`g-link ${FIG} mt-2 text-[13px]`} data-testid="button-link-opps-all">');
    expect(outgoing).toContain('<Link href={here({ all: true })} className={`g-link ${FIG} mt-2 text-[13px]`} data-testid="button-outgoing-all">');
    for (const src of [opps, outgoing]) expect(src).toMatch(/const shown = all \? Infinity : Math\.max\(50, first(Hit|Row) \+ 1\);/);
    // The compare lists' headings: the crawl shown keeps itself (`at`), the one compared with opens on its own.
    expect(audit).toContain("data-testid={`link-page-changes-then-${t}`}");
    expect(audit).toContain("shownLink(`link-page-changes-now-${t}`)");
    expect(audit).not.toContain("`Reached on ${fmtDate(shownDate)}, not before`");
    // A lone ↗ is as wide as it is tall.
    expect(outgoing).toContain("className={`g-link ${FIG} min-w-11 text-center`} aria-label={`Open ${b.to} in a new tab`}");
    expect(audit.match(/min-w-11 shrink-0 text-center/g)?.length).toBe(2);
    // The rendering row's chevron says what it is on a phone (card mode).
    expect(render).toContain('<td data-label="Details"><Link href={href} className={CHEVRON}');
    expect(render).toContain('<span className="text-[12px] sm:hidden">{isOpen ? "Hide details" : "Details"}</span>');
  });

  it("no figure is left as bare text, and no address is written by hand", () => {
    for (const [name, src] of [["audit-pages", pages], ["link-opportunities", opps], ["outgoing-links", outgoing], ["render", render]] as const) expect(bareFigures(src), name).toEqual([]);
    // audit.tsx: only what has nothing saved to open — a failed crawl's start, an unreadable crawl's finish.
    expect(bareFigures(audit).map((x) => /fmtDate\([^)]*\)/.exec(x)?.[0])).toEqual(["fmtDate(d.lastFailed.createdAt)", "fmtDate(d.newestUnreadable.at)"]);
    for (const src of [audit, pages, opps, outgoing, render]) expect(src).not.toMatch(/<Link href="\/|href=\{?["'`]\/seo/);
  });

  it("every link is at least 44 px tall on a phone and keyboard focusable", () => {
    expect(viz).toContain('export const TAP = "py-1.5 max-sm:py-3.5"');
    expect(viz).toContain("export const FIG = `${FIGURE} inline-block ${TAP}`");
    expect(viz).toContain('export const CHEVRON = "g-pill !min-h-8 !px-2 max-sm:!min-h-11 max-sm:!min-w-11"');
    // The tab strips wrap on a phone (no sideways scroll with a hidden scrollbar), each tab 44 px tall.
    expect(viz).toContain('export const TABS = "g-tabs flex-wrap sm:flex-nowrap [&>a]:inline-flex [&>a]:min-h-11 [&>a]:items-center"');
    expect(audit).toContain('<nav className={TABS} aria-label="Audit views">');
    expect(audit).toContain('<nav className={`${TABS} !mb-0`} aria-label="Issue severity">');
    // Status bar segments: a 44 px tall link with the 10 px bar inside, never a mouse-only pseudo-link.
    expect(viz).toMatch(/<Link key=\{p\.key\} href=\{p\.href\} className="relative flex h-11 items-center/);
    expect(render).toContain("className={CHEVRON}");
    for (const src of [audit, pages, opps, outgoing, render, viz]) expect(src).not.toMatch(/tabIndex=\{-1\}/);
  });
});
