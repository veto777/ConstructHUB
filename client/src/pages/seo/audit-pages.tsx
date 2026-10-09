/**
 * Site audit → Pages: every crawled page with whether Google can index it, how
 * many clicks it is from the home page, how many of your own pages link to it,
 * and its title, description and text. From the saved crawl
 * (GET /api/seo/sites/:id/audit/pages) — free.
 *
 * Narrowed by the address (links.ts, audit): `show` one of its own pills, `status` an answer class as the overview's
 * status bar names them (and the overview's three "found but not read" counts, which have no rows — the chip says
 * so), `severity` / `issue` / `area` the pages listed under issues of that severity / that one issue / that area,
 * `page` one page whose row is opened. Every pill, figure and row is a link that writes the address, so a link into
 * this tab and a pick on it are the same thing; the chip (data-testid="active-filter") says what narrowed the list,
 * and says honestly when the page or issue asked for is not in this crawl.
 */
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, Download, Loader2 } from "lucide-react";
import { Link } from "wouter";
import { apiErrorMessage } from "@/lib/queryClient";
import { Empty, fmtDate, fmtNum, HIGHLIGHT, type SeoSite } from "./shell";
import { PALETTE, StatTile } from "./viz";
import { seoLinks } from "./links";
import { ActiveFilter, CHEVRON, COMPACT_TABLE, DETAIL_CELL, FIG, FIG_BIG, PILL, type AuditParams, type Foreign } from "./viz-audit";

type Row = { url: string; path: string; status: number; redirected: boolean; indexable: boolean | null; whyNot: string | null; canonicalElsewhere?: boolean; depth: number | null; inlinks: number | null; outlinks: number | null;
  title: string | null; titleLength: number; descriptionLength: number; h1: number; words: number; images: number; imagesNoAlt: number; kb: number | null; issues: string[] };
type Summary = { pages: number; indexable: number; notIndexable: number; canonicalElsewhere?: number; errors: number; redirected: number; linksMeasured?: boolean; orphans: number | null; deep: number | null; averageDepth: number | null; thin: number; noTitle: number; noDescription: number };
type Data = { jobId: string; scannedAt: string | null; summary: Summary; pages: Row[] };
type Severity = "error" | "warning" | "notice";
/** What the address narrows this tab by (null = not narrowed). */
export type PagesNarrowing = { status: string | null; severity: string | null; issue: string | null; show: string | null; page: string | null; area: string | null };
/** The overview's counts of what was found but has no row here (said when one is asked for). */
export type Overview = { failed: number; excluded: number; notCrawled: number; blockedByRobots: number; pageCap: number | null };

/** The same status rules as the server's counts (server/seo/audit-pages.ts): an error is 4xx/5xx and above, or 1xx. */
const isErrorStatus = (st: number) => st >= 400 || (st >= 100 && st < 200);
const isOkStatus = (st: number) => st >= 200 && st < 400;
const FILTERS: { key: string; label: string; test: (r: Row, i: number) => boolean; count: (s: Summary) => number; hint: string }[] = [
  { key: "all", label: "All pages", test: () => true, count: (s) => s.pages, hint: "" },
  { key: "notIndexable", label: "Blocked from Google", test: (r) => r.indexable === false, count: (s) => s.notIndexable, hint: "The crawl found something on these pages that keeps Google from listing them: an error, a redirect or a noindex mark. Fine for a thank-you page; a problem for a service page." },
  { key: "canonical", label: "Points to another page", test: (r) => !!r.canonicalElsewhere, count: (s) => s.canonicalElsewhere ?? 0, hint: "The canonical tag on these pages names a different page — a request that Google list that one instead. Google usually follows it. Right for a duplicate; wrong on a page you want found." },
  { key: "errors", label: "Errors", test: (r) => isErrorStatus(r.status), count: (s) => s.errors, hint: "These addresses return an error. Restore the page or redirect it to the closest one that works." },
  { key: "redirected", label: "Redirected", test: (r) => r.redirected, count: (s) => s.redirected, hint: "Links on your site point to an address that forwards somewhere else. Link straight to the final address." },
  { key: "orphans", label: "No links to it", test: (r, i) => i > 0 && r.inlinks === 0, count: (s) => s.orphans ?? 0, hint: "No crawled page of your site links to these. Visitors and Google can only find them from a sitemap or another site — add a link from a related page." },
  { key: "deep", label: "4+ clicks deep", test: (r) => (r.depth ?? 0) >= 4, count: (s) => s.deep ?? 0, hint: "Pages far from the home page are crawled less often and rank worse. Link to the important ones from the menu or a service page." },
  { key: "thin", label: "Little text", test: (r) => isOkStatus(r.status) && r.words < 200, count: (s) => s.thin, hint: "Under 200 words. A page that should rank for a service needs enough to answer what the customer is asking." },
  { key: "noTitle", label: "No title", test: (r) => isOkStatus(r.status) && r.titleLength === 0, count: (s) => s.noTitle, hint: "The title is the blue line in Google's results. Every page needs its own." },
  { key: "noDescription", label: "No description", test: (r) => isOkStatus(r.status) && r.descriptionLength === 0, count: (s) => s.noDescription, hint: "The description is the text under the title in Google's results. Without one Google picks a sentence itself." },
];
/**
 * The answer classes, cut the way the overview's status bar counts them (server/seo/audit.ts): a status the crawl did
 * not record (0) is "unusual" there too. The last four are the overview's counts of what was found but never read —
 * the crawl saved no page for them, so nothing here can match; the chip says so and the pill shows the count.
 */
type Cut = { key: string; label: string; words: string; test: (r: Row) => boolean; count?: (o: Overview) => number; explain?: (o: Overview, n: number) => string };
const STATUS_CUTS: Cut[] = [
  { key: "2xx", label: "Working (2xx)", words: "Working pages (2xx)", test: (r) => r.status >= 200 && r.status < 300 && !r.redirected },
  { key: "3xx", label: "Redirected (3xx)", words: "Redirected pages (3xx)", test: (r) => r.redirected || (r.status >= 300 && r.status < 400) },
  { key: "4xx", label: "Not found / blocked (4xx)", words: "Not found or blocked pages (4xx)", test: (r) => r.status >= 400 && r.status < 500 },
  { key: "5xx", label: "Server error (5xx)", words: "Server-error pages (5xx)", test: (r) => r.status >= 500 && r.status < 600 },
  { key: "unusual", label: "Unusual answer", words: "Pages with an unusual answer (1xx, above 599, or none recorded)", test: (r) => !(r.status >= 200 && r.status <= 599) },
  { key: "unchecked", label: "Couldn't be checked", words: "Addresses that couldn't be checked", test: () => false, count: (o) => o.failed, explain: (_o, n) => `${fmtNum(n)} address${n === 1 ? "" : "es"} of the crawl never loaded, so the crawl saved no page for ${n === 1 ? "it" : "them"}: ${n === 1 ? "it is" : "they are"} counted in the overview and ${n === 1 ? "has" : "have"} no row here.` },
  { key: "excluded", label: "Found, not audited", words: "Addresses found but not audited", test: () => false, count: (o) => o.excluded, explain: (_o, n) => `${fmtNum(n)} address${n === 1 ? " was" : "es were"} found but not audited — files such as PDFs, or links that leave the site. The crawl saved no page for ${n === 1 ? "it" : "them"}, ${n === 1 ? "it doesn't" : "they don't"} affect the health score, and there is no row here.` },
  { key: "beyond-limit", label: "Found, not crawled", words: "Pages found but not crawled", test: () => false, count: (o) => o.notCrawled, explain: (o, n) => `${fmtNum(n)} page${n === 1 ? " was" : "s were"} found beyond the crawl's limit${o.pageCap ? ` of ${fmtNum(o.pageCap)} pages` : ""} and not read, so there is no row here. A crawl with a higher limit would read ${n === 1 ? "it" : "them"}.` },
  { key: "blocked", label: "Blocked by robots.txt", words: "Addresses blocked by robots.txt", test: () => false, count: (o) => o.blockedByRobots, explain: (_o, n) => `robots.txt kept the crawl from ${fmtNum(n)} address${n === 1 ? "" : "es"}, so nothing was read there and there is no row here. Google's crawler obeys the same file.` },
];
/** The pills under "By answer": the status bar's classes (the three "found but not read" counts arrive by link only). */
const ANSWER_PILLS = ["2xx", "3xx", "4xx", "5xx", "unusual", "unchecked"];
type SortKey = "path" | "status" | "depth" | "inlinks" | "words" | "titleLength" | "descriptionLength" | "kb";
const COLS: { key: SortKey; label: string; num?: boolean; title?: string }[] = [
  { key: "path", label: "Page" }, { key: "status", label: "Status", num: true }, { key: "depth", label: "Clicks deep", num: true, title: "Clicks from the first page crawled" },
  { key: "inlinks", label: "Links to it", num: true, title: "Other crawled pages of your site whose page source links to it" }, { key: "words", label: "Words", num: true },
  { key: "titleLength", label: "Title", num: true, title: "Characters in the title (aim for 30–60)" }, { key: "descriptionLength", label: "Description", num: true, title: "Characters in the description (aim for 70–160)" }, { key: "kb", label: "Size", num: true },
];
const csvCell = (v: string | number | null) => { const s = v == null ? "" : String(v); return `"${(typeof v !== "number" && /^[=+\-@\t\r]/.test(s) ? `'${s}` : s).replace(/"/g, '""')}"`; };
const lengthNote = (n: number, lo: number, hi: number) => (n === 0 ? "missing" : n < lo ? "short" : n > hi ? "long" : "");
const SEVERITY_WORDS: Record<Severity, string> = { error: "errors", warning: "warnings", notice: "notices" };
const isSeverity = (s: string | null): s is Severity => s === "error" || s === "warning" || s === "notice";
const PILL_ON = { borderColor: "var(--g-blue)", color: "var(--g-blue)" };
/** The answer class a row's status falls in (the first cut that takes it), for the Status cell's link. */
const classOf = (r: Row) => STATUS_CUTS.find((c) => c.test(r))?.key;

export function AuditPages({ site, issueTitles, issueSeverity, issueArea, crawlId, overview, shownDate, narrowing, here, issueHref, foreign }: {
  site: SeoSite; issueTitles: Record<string, string>;
  /** Each issue key's severity and area, so `severity` / `area` can cut the pages listed under such issues. */
  issueSeverity: Record<string, Severity>; issueArea: Record<string, { key: string; name: string }>;
  /** The newest finished crawl: a new one is a new question, never an answer still on its way for the old one. */
  crawlId?: string | null;
  overview: Overview;
  /** When the crawl shown on the overview finished (the chip names it). */
  shownDate: string | null;
  narrowing: PagesNarrowing;
  /** The current address with one narrowing changed (the parent keeps tab, site, at and vs). */
  here: (p: AuditParams) => string;
  /** An issue opened on the issues tab. */
  issueHref: (key: string) => string;
  foreign?: Foreign;
}) {
  const q = useQuery<Data>({ queryKey: [`/api/seo/sites/${site.id}/audit/pages`, crawlId ?? null], refetchOnMount: "always",
    queryFn: async ({ queryKey, signal }) => { const r = await fetch(queryKey[0] as string, { credentials: "include", signal }); if (!r.ok) throw new Error((await r.json().catch(() => ({}))).message ?? "The request failed"); return r.json(); } });
  const [text, setText] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "path", dir: 1 });
  const [shown, setShown] = useState(100);
  const openRef = useRef<HTMLTableRowElement>(null);
  // The newest crawl could not be read: said (the server never answers with an older crawl instead).
  const unreadable = q.data && typeof q.data === "object" && "unreadable" in (q.data as object) ? (q.data as unknown as { scannedAt: string | null }) : null;
  const d = unreadable ? null : q.data;
  const filter = narrowing.show ?? "all";
  const active = FILTERS.find((f) => f.key === filter) ?? null;
  const cut = narrowing.status ? STATUS_CUTS.find((c) => c.key === narrowing.status) ?? null : null;
  const severity = isSeverity(narrowing.severity) ? narrowing.severity : null;
  const issue = narrowing.issue, page = narrowing.page, area = narrowing.area;
  const inArea = (k: string) => { const x = issueArea[k]; return !!area && !!x && (x.name.toLowerCase() === area.toLowerCase() || x.key.toLowerCase() === area.toLowerCase()); };
  const rows = useMemo(() => {
    if (!d) return [];
    const needle = text.trim().toLowerCase();
    const matches = (r: Row, i: number) => (active ?? FILTERS[0]).test(r, i)
      && (!cut || cut.test(r))
      && (!severity || r.issues.some((k) => issueSeverity[k] === severity))
      && (!issue || r.issues.includes(issue))
      && (!area || r.issues.some(inArea))
      && (!needle || r.path.toLowerCase().includes(needle) || (r.title ?? "").toLowerCase().includes(needle));
    // The page the address opens is always listed, whatever else narrows the list.
    const picked = d.pages.filter((r, i) => matches(r, i) || r.path === page);
    const val = (r: Row) => (sort.key === "path" ? r.path : (r[sort.key] ?? (sort.dir === 1 ? Infinity : -Infinity)));
    return [...picked].sort((a, b) => { const x = val(a), y = val(b); return (x < y ? -1 : x > y ? 1 : a.path.localeCompare(b.path)) * sort.dir; });
  }, [d, active, cut, severity, issue, area, page, text, sort, issueSeverity]); // eslint-disable-line react-hooks/exhaustive-deps
  // The opened page is brought within the rows shown, then into view.
  const openAt = page ? rows.findIndex((r) => r.path === page) : -1;
  useEffect(() => { if (openAt >= shown) setShown(openAt + 1); }, [openAt, shown]);
  useEffect(() => { if (openAt >= 0 && openAt < shown) openRef.current?.scrollIntoView({ block: "nearest" }); }, [openAt, shown, page]);
  const exportCsv = () => {
    const lines = [["URL", "Status", "Blocking signal found", "Which", "Clicks deep", "Links to it", "Links from it", "Words", "Title", "Title length", "Description length", "H1 headings", "Images", "Images without alt text", "Size (KB)", "Issues"],
      ...rows.map((r) => [r.url, r.status, r.indexable === null ? "unknown" : r.indexable ? "no" : "yes", r.whyNot, r.depth, r.inlinks, r.outlinks, r.words, r.title, r.titleLength, r.descriptionLength, r.h1, r.images, r.imagesNoAlt, r.kb, r.issues.map((k) => issueTitles[k] ?? k).join("; ")])];
    const blob = new Blob([lines.map((l) => l.map(csvCell).join(",")).join("\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = `pages-${site.domain}.csv`; a.click(); URL.revokeObjectURL(a.href);
  };
  // What narrowed the list, in words — said from the address at once, also while the pages load (a link never lands
  // on a list that does not say what narrowed it); what needs the pages (is the page in this crawl?) once they are read.
  const pageFound = !!page && !!d && d.pages.some((r) => r.path === page);
  const issueKnown = !!issue && issue in issueTitles;
  const words: string[] = [];
  if (narrowing.status) words.push(cut ? cut.words : `an answer class this page doesn't know (${narrowing.status})`);
  if (narrowing.severity) words.push(severity ? `Pages with ${SEVERITY_WORDS[severity]}` : `a severity this page doesn't know (${narrowing.severity})`);
  if (issue) words.push(issueKnown ? `Pages listed under “${issueTitles[issue]}”` : `an issue this crawl did not find (${issue})`);
  if (area) words.push(`Pages with issues in ${Object.values(issueArea).find((x) => x.name.toLowerCase() === area.toLowerCase() || x.key.toLowerCase() === area.toLowerCase())?.name ?? area}`);
  if (narrowing.show) words.push(active ? active.label : `a pill this page doesn't have (${narrowing.show})`);
  if (page) words.push(!d ? `Page ${page}` : pageFound ? `One page opened: ${page}` : `${page} — not in this crawl`);
  if (foreign) words.push(foreign.words);
  // The clear link keeps the tab and the crawl, drops every narrowing.
  const clearHref = here({ status: undefined, severity: undefined, issue: undefined, show: undefined, page: undefined, area: undefined });
  const explain = [
    cut?.count ? cut.explain?.(overview, cut.count(overview)) : null,
    page && d && !pageFound ? `No crawled page has the address ${page} in the crawl of ${fmtDate(d.scannedAt)} (the newest). Its row would be here if a crawl had reached it.` : null,
    issue && !issueKnown ? `Nothing is listed under “${issue}” in the crawl of ${fmtDate(shownDate)}. It may have been fixed, or found by another crawl.` : null,
  ].filter(Boolean).join(" ");
  const chip = words.length > 0 && <ActiveFilter words={words.join(" · ")} clearHref={clearHref} extra={foreign ? { href: foreign.href, label: foreign.label, testId: "link-foreign-tab" } : undefined}>{explain || null}</ActiveFilter>;
  if (q.isLoading) return <>{chip}<p className="g-text-2 flex items-center gap-2 text-[14px]" role="status"><Loader2 className="h-4 w-4 animate-spin" /> Loading the crawled pages…</p></>;
  if (q.isError) return <>{chip}<div className="g-callout" role="alert" data-testid="audit-pages-error"><h3>Couldn't load the pages</h3><p>{apiErrorMessage(q.error)}</p><button type="button" className="g-pill mt-2" onClick={() => void q.refetch()}>Try again</button></div></>;
  if (unreadable) return <>{chip}<Empty testId="audit-pages-unreadable"><h3>The newest crawl could not be read</h3><p>The crawl that finished {fmtDate(unreadable.scannedAt)} was not saved in a form we can read, so nothing is shown from it (and no older crawl in its place). Run a new crawl.</p></Empty></>;
  if (!d || d.pages.length === 0) return <>{chip}<Empty testId="audit-pages-empty"><h3>No pages to show</h3><p>The crawl did not save any pages for {site.domain}. Run a new crawl.</p></Empty></>;
  const s = d.summary, measured = s.linksMeasured !== false;
  const cutCount = (c: Cut) => (c.count ? c.count(overview) : d.pages.filter(c.test).length);
  const rowHref = (r: Row) => here({ page: r.path });
  /** A figure that belongs to a cut links to that cut; one that does not opens the row it is about. */
  const cutOr = (r: Row, key: string, is: boolean) => (is ? here({ show: key }) : rowHref(r));
  return (
    <div data-testid="audit-pages">
      {/* The same tiles as the dashboard's: a blue label, the figure, and what it rests on underneath. Each figure is a link to the pages it counts. */}
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label="Nothing blocking Google" color={PALETTE.health} value={<Link href={here({ show: undefined, status: undefined, severity: undefined, issue: undefined, page: undefined, area: undefined })} className={FIG_BIG} title="Every crawled page" data-testid="link-tile-indexable">{fmtNum(s.indexable)} of {fmtNum(s.pages)}</Link>} foot={s.notIndexable ? <Link href={here({ show: "notIndexable" })} className={FIG} data-testid="link-tile-not-indexable">{fmtNum(s.notIndexable)} carry a signal that keeps Google out — check they are meant to</Link> : "No page tells Google to stay away. Google still decides what it lists."} testId="tile-pages-indexable" />
        {measured ? <>
          <StatTile label="Average clicks from home" color={PALETTE.health} value={<Link href={here({ show: "deep" })} className={FIG_BIG} title="The pages furthest from the home page" data-testid="link-tile-depth">{s.averageDepth ?? "—"}</Link>} foot={s.deep ? <Link href={here({ show: "deep" })} className={FIG} data-testid="link-tile-deep">{fmtNum(s.deep)} page{s.deep === 1 ? " is" : "s are"} 4 or more clicks deep</Link> : "No page is more than 3 clicks deep"} testId="tile-pages-depth" />
          <StatTile label="Pages nothing links to" color={PALETTE.health} value={<Link href={here({ show: "orphans" })} className={FIG_BIG} title="The pages no crawled page links to" data-testid="link-tile-orphans">{fmtNum(s.orphans)}</Link>} foot="Among the pages crawled" testId="tile-pages-orphans" />
        </> : <StatTile label="Links between pages" color={PALETTE.health} value={<Link href={`${here({})}#pages-links-unmeasured`} className={`${FIG_BIG} text-[20px] sm:text-[22px]`} title="Why, in the note below" data-testid="link-tile-links-unmeasured">Not measurable</Link>} foot="Too few links in the page source" testId="tile-pages-links-unmeasured" />}
        <StatTile label="Pages with little text" color={PALETTE.health} value={<Link href={here({ show: "thin" })} className={FIG_BIG} title="The pages under 200 words" data-testid="link-tile-thin">{fmtNum(s.thin)}</Link>} foot="Under 200 words" testId="tile-pages-thin" />
      </div>
      {!measured && (
        <div id="pages-links-unmeasured" className="g-callout mb-3" role="status" data-testid="pages-links-unmeasured">
          <h3>Links between your pages could not be measured</h3>
          <p>Most pages of {site.domain} have no links to other pages in their page source. That usually means the menus and links are added by JavaScript after the page loads — this crawl reads the source without running scripts, so it cannot say which pages link to which, or how many clicks deep a page is. Google does run scripts, but more slowly and less reliably than it reads plain links; putting your main menu and in-page links in the page's HTML is the safer choice.</p>
        </div>
      )}
      <div className="mb-2 flex flex-wrap gap-1.5" role="group" aria-label="Show pages">
        {/* A pill with no pages is still a link: it lands on the empty list, and the chip and the empty state say so. */}
        {FILTERS.filter((f) => measured || (f.key !== "orphans" && f.key !== "deep")).map((f) => { const n = f.count(s), on = filter === f.key; return (
          <Link key={f.key} href={here({ show: f.key === "all" ? undefined : f.key })} className={`${PILL}${n === 0 && f.key !== "all" && !on ? " g-text-2" : ""}`} aria-current={on ? "true" : undefined} style={on ? PILL_ON : undefined} title={n === 0 && f.key !== "all" ? "No crawled page is in this group" : undefined} data-testid={`filter-pages-${f.key}`}>{f.label} <span className="tabular-nums">({fmtNum(n)})</span></Link>);
        })}
      </div>
      <div className="mb-2 flex flex-wrap items-center gap-1.5" role="group" aria-label="By answer">
        <span className="g-text-2 text-[12px]">By answer</span>
        {STATUS_CUTS.filter((c) => ANSWER_PILLS.includes(c.key) && (c.key !== "unusual" || cutCount(c) > 0)).map((c) => { const n = cutCount(c), on = narrowing.status === c.key; return (
          <Link key={c.key} href={here({ status: on ? undefined : c.key })} className={`${PILL}${n === 0 && !on ? " g-text-2" : ""}`} aria-current={on ? "true" : undefined} style={on ? PILL_ON : undefined} title={c.count ? "No page was saved for these; the count is the overview's" : n === 0 ? "No crawled page answered this way" : undefined} data-testid={`filter-pages-status-${c.key}`}>{c.label} <span className="tabular-nums">({fmtNum(n)})</span></Link>);
        })}
      </div>
      {chip}
      {active?.hint && <p className="g-text-2 mb-2 text-[13px]" data-testid="text-pages-hint">{active.hint}</p>}
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <label className="min-w-0 flex-1 sm:max-w-xs"><span className="sr-only">Find a page by address or title</span><input className="g-input w-full !py-1.5" value={text} onChange={(e) => { setText(e.target.value); setShown(100); }} placeholder="Find a page…" data-testid="input-pages-search" /></label>
        <span className="g-text-2 text-[13px]" data-testid="text-pages-count"><Link href={`${here({})}#table-audit-pages`} className={`g-text-2 ${FIG}`} title="The pages listed below" data-testid="link-pages-count">{fmtNum(rows.length)} page{rows.length === 1 ? "" : "s"}</Link></span>
        <button type="button" className="g-pill g-pill--sm ml-auto max-sm:!min-h-11" onClick={exportCsv} disabled={!rows.length} data-testid="button-pages-export"><Download /> Export</button>
      </div>
      {rows.length === 0 ? <Empty testId="audit-pages-none"><h3>No page matches</h3><p>{cut?.count ? "These addresses have no row: the crawl saved no page for them." : issue && issueKnown ? <>No crawled page is listed under “{issueTitles[issue]}” — its entries are not pages of the crawl (an address outside the site, or a check that has no page). <Link href={issueHref(issue)} className={`g-link ${FIG}`} data-testid="link-pages-issue-tab">See it on the Issues tab</Link>.</> : "Clear the search box or choose another filter."}</p></Empty> : (
        <div className="overflow-x-auto">
          <table id="table-audit-pages" className={COMPACT_TABLE} data-testid="table-audit-pages">
            <thead><tr><th aria-label="Show details" className="w-12" />{COLS.map((c) => (
              <th key={c.key} className={c.num ? "num" : undefined} aria-sort={sort.key === c.key ? (sort.dir === 1 ? "ascending" : "descending") : undefined} title={c.title}>
                <button type="button" className="g-text-2 whitespace-nowrap" onClick={() => setSort((x) => ({ key: c.key, dir: x.key === c.key ? (x.dir === 1 ? -1 : 1) : 1 }))}>{c.label}{sort.key === c.key ? (sort.dir === 1 ? " ▲" : " ▼") : ""}</button>
              </th>
            ))}</tr></thead>
            <tbody>
              {rows.slice(0, shown).map((r) => { const isOpen = page === r.path; const tl = lengthNote(r.titleLength, 30, 60), dl = lengthNote(r.descriptionLength, 70, 160); const cls = classOf(r); return (
                <Fragment key={r.url}>
                  <tr data-testid={`row-page-${r.path}`} ref={isOpen ? openRef : undefined} style={isOpen ? HIGHLIGHT : undefined}>
                    <td><Link href={here({ page: isOpen ? undefined : r.path })} className={CHEVRON} aria-expanded={isOpen} aria-label={`${isOpen ? "Hide" : "Show"} details for ${r.path}`} data-testid={`link-page-row-${r.path}`}>{isOpen ? <ChevronDown /> : <ChevronRight />}</Link></td>
                    <td className="max-w-[340px]"><Link href={seoLinks.explorer(site.domain, "pages", { path: r.path })} className={`g-link ${FIG} block truncate`} title={`${r.url} — in Site explorer`} data-testid={`link-page-explorer-${r.path}`}>{r.path}</Link>{r.indexable === false && <Link href={here({ show: "notIndexable" })} className={`${FIG} block text-[12px]`} style={{ color: "var(--g-red)" }} title="Every page blocked from Google" data-testid={`link-page-blocked-${r.path}`}>Blocked from Google: {r.whyNot}</Link>}{r.canonicalElsewhere && <Link href={here({ show: "canonical" })} className={`g-text-2 ${FIG} block text-[12px]`} title="Every page whose canonical names another" data-testid={`link-page-canonical-${r.path}`}>Its canonical tag asks Google to list another page instead</Link>}{r.indexable === null && <Link href={here({ status: "unusual" })} className={`g-text-2 ${FIG} block text-[12px]`} title="Every page whose answer was not recorded" data-testid={`link-page-unrecorded-${r.path}`}>Response not recorded — nothing can be said about this page</Link>}</td>
                    <td className="num" data-label="Status"><Link href={cls ? here({ status: cls }) : rowHref(r)} className={FIG} style={isErrorStatus(r.status) ? { color: "var(--g-red)" } : undefined} title={cls ? `Every page that answered ${cls}` : "This page's details"} data-testid={`link-page-status-${r.path}`}>{r.status || "—"}{r.redirected ? " ↪" : ""}</Link></td>
                    <td className="num" data-label="Clicks deep">{r.depth == null ? <Link href={measured ? here({ show: "orphans" }) : rowHref(r)} className={`g-text-2 ${FIG}`} title={measured ? "No crawled page links to it — every such page" : "Not measurable on this site"} data-testid={`link-page-depth-${r.path}`}>—</Link> : <Link href={cutOr(r, "deep", r.depth >= 4)} className={FIG} title={r.depth >= 4 ? "Every page 4 or more clicks deep" : "This page's details"} data-testid={`link-page-depth-${r.path}`}>{r.depth}</Link>}</td>
                    <td className="num" data-label="Links to it">{r.inlinks == null ? <Link href={rowHref(r)} className={`g-text-2 ${FIG}`} title="Not measurable on this site — this page's details" data-testid={`link-page-inlinks-${r.path}`}>—</Link> : <Link href={cutOr(r, "orphans", r.inlinks === 0)} className={FIG} title={r.inlinks === 0 ? "Every page nothing links to" : "This page's details"} data-testid={`link-page-inlinks-${r.path}`}>{fmtNum(r.inlinks)}</Link>}</td>
                    <td className="num" data-label="Words"><Link href={cutOr(r, "thin", isOkStatus(r.status) && r.words < 200)} className={FIG} title={isOkStatus(r.status) && r.words < 200 ? "Every page with little text" : "This page's details"} data-testid={`link-page-words-${r.path}`}>{fmtNum(r.words)}</Link></td>
                    <td className="num" data-label="Title"><Link href={cutOr(r, "noTitle", isOkStatus(r.status) && r.titleLength === 0)} className={FIG} title={r.titleLength === 0 ? "Every page with no title" : "This page's details (its title is there)"} data-testid={`link-page-title-${r.path}`}>{r.titleLength}{tl && <span className="g-text-2 text-[12px]"> {tl}</span>}</Link></td>
                    <td className="num" data-label="Description"><Link href={cutOr(r, "noDescription", isOkStatus(r.status) && r.descriptionLength === 0)} className={FIG} title={r.descriptionLength === 0 ? "Every page with no description" : "This page's details"} data-testid={`link-page-description-${r.path}`}>{r.descriptionLength}{dl && <span className="g-text-2 text-[12px]"> {dl}</span>}</Link></td>
                    <td className="num g-text-2" data-label="Size"><Link href={rowHref(r)} className={`g-text-2 ${FIG}`} title="This page's details" data-testid={`link-page-size-${r.path}`}>{r.kb == null ? "—" : `${fmtNum(r.kb)} KB`}</Link></td>
                  </tr>
                  {isOpen && (
                    <tr data-testid={`detail-page-${r.path}`}><td /><td colSpan={COLS.length} className={`${DETAIL_CELL} text-[13px]`}>
                      <p className="g-text"><b className="font-medium">Title:</b> {r.title ? <a href={r.url} className={`g-text ${FIG}`} target="_blank" rel="noreferrer" title="Read in the page itself; open it in a new tab" data-testid={`link-page-title-text-${r.path}`}>{r.title}</a> : <Link href={here({ show: "noTitle" })} className={`g-text-2 ${FIG}`} title="Every page with no title" data-testid={`link-page-title-text-${r.path}`}>none</Link>}</p>
                      <p className="g-text-2 mt-1"><a href={r.url} className={`g-text-2 ${FIG}`} target="_blank" rel="noreferrer" title="Counted in the page itself; open it in a new tab" data-testid={`link-page-counts-${r.path}`}>{r.h1} main heading{r.h1 === 1 ? "" : "s"} (H1) · {r.outlinks == null ? "its links to other pages could not be measured" : `its source links to ${fmtNum(r.outlinks)} other crawled page${r.outlinks === 1 ? "" : "s"}`} · {fmtNum(r.images)} image{r.images === 1 ? "" : "s"}{r.imagesNoAlt ? `, ${fmtNum(r.imagesNoAlt)} without a description (alt text)` : ""} — on the page ↗</a></p>
                      {r.issues.length > 0 ? <><p className="g-text mt-2 font-medium">Listed under</p><ul className="g-text list-disc pl-5">{r.issues.map((k) => <li key={k}><Link href={issueHref(k)} className={`g-link ${FIG}`} title="This issue on the issues tab" data-testid={`link-page-issue-${k}`}>{issueTitles[k] ?? k}</Link></li>)}</ul></> : <p className="g-text-2 mt-2">No issue lists this page.</p>}
                      <p className="mt-2 flex flex-wrap gap-x-3"><a href={r.url} className={`g-link ${FIG}`} target="_blank" rel="noreferrer" data-testid={`link-page-open-${r.path}`}>Open the page ↗</a><Link href={seoLinks.explorer(site.domain, "pages", { path: r.path })} className={`g-link ${FIG}`} data-testid={`link-page-explorer-more-${r.path}`}>Its keywords and backlinks in Site explorer</Link></p>
                    </td></tr>
                  )}
                </Fragment>
              ); })}
            </tbody>
          </table>
        </div>
      )}
      {rows.length > shown && <button type="button" className="g-pill mt-3 max-sm:!min-h-11" onClick={() => setShown(shown + 200)} data-testid="button-pages-more">Show more ({fmtNum(rows.length - shown)} left)</button>}
    </div>
  );
}
