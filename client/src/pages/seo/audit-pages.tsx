/**
 * Site audit → Pages: every crawled page with whether Google can index it, how
 * many clicks it is from the home page, how many of your own pages link to it,
 * and its title, description and text. From the saved crawl
 * (GET /api/seo/sites/:id/audit/pages) — free.
 */
import { Fragment, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, Download, Loader2 } from "lucide-react";
import { apiErrorMessage } from "@/lib/queryClient";
import { Empty, fmtDate, fmtNum, type SeoSite } from "./shell";
import { PALETTE, StatTile } from "./viz";
import { COMPACT_TABLE } from "./viz-audit";

type Row = { url: string; path: string; status: number; redirected: boolean; indexable: boolean | null; whyNot: string | null; canonicalElsewhere?: boolean; depth: number | null; inlinks: number | null; outlinks: number | null;
  title: string | null; titleLength: number; descriptionLength: number; h1: number; words: number; images: number; imagesNoAlt: number; kb: number | null; issues: string[] };
type Summary = { pages: number; indexable: number; notIndexable: number; canonicalElsewhere?: number; errors: number; redirected: number; linksMeasured?: boolean; orphans: number | null; deep: number | null; averageDepth: number | null; thin: number; noTitle: number; noDescription: number };
type Data = { jobId: string; scannedAt: string | null; summary: Summary; pages: Row[] };

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
type SortKey = "path" | "status" | "depth" | "inlinks" | "words" | "titleLength" | "descriptionLength" | "kb";
const COLS: { key: SortKey; label: string; num?: boolean; title?: string }[] = [
  { key: "path", label: "Page" }, { key: "status", label: "Status", num: true }, { key: "depth", label: "Clicks deep", num: true, title: "Clicks from the first page crawled" },
  { key: "inlinks", label: "Links to it", num: true, title: "Other crawled pages of your site whose page source links to it" }, { key: "words", label: "Words", num: true },
  { key: "titleLength", label: "Title", num: true, title: "Characters in the title (aim for 30–60)" }, { key: "descriptionLength", label: "Description", num: true, title: "Characters in the description (aim for 70–160)" }, { key: "kb", label: "Size", num: true },
];
const csvCell = (v: string | number | null) => { const s = v == null ? "" : String(v); return `"${(typeof v !== "number" && /^[=+\-@\t\r]/.test(s) ? `'${s}` : s).replace(/"/g, '""')}"`; };
const lengthNote = (n: number, lo: number, hi: number) => (n === 0 ? "missing" : n < lo ? "short" : n > hi ? "long" : "");

export function AuditPages({ site, issueTitles, crawlId }: { site: SeoSite; issueTitles: Record<string, string>; /** The newest finished crawl: a new one is a new question, never an answer still on its way for the old one. */ crawlId?: string | null }) {
  const q = useQuery<Data>({ queryKey: [`/api/seo/sites/${site.id}/audit/pages`, crawlId ?? null], refetchOnMount: "always",
    queryFn: async ({ queryKey, signal }) => { const r = await fetch(queryKey[0] as string, { credentials: "include", signal }); if (!r.ok) throw new Error((await r.json().catch(() => ({}))).message ?? "The request failed"); return r.json(); } });
  const [filter, setFilter] = useState("all");
  const [text, setText] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "path", dir: 1 });
  const [open, setOpen] = useState<string | null>(null);
  const [shown, setShown] = useState(100);
  // The newest crawl could not be read: said (the server never answers with an older crawl instead).
  const unreadable = q.data && typeof q.data === "object" && "unreadable" in (q.data as object) ? (q.data as unknown as { scannedAt: string | null }) : null;
  const d = unreadable ? null : q.data;
  const active = FILTERS.find((f) => f.key === filter) ?? FILTERS[0];
  const rows = useMemo(() => {
    if (!d) return [];
    const needle = text.trim().toLowerCase();
    const picked = d.pages.filter((r, i) => active.test(r, i) && (!needle || r.path.toLowerCase().includes(needle) || (r.title ?? "").toLowerCase().includes(needle)));
    const val = (r: Row) => (sort.key === "path" ? r.path : (r[sort.key] ?? (sort.dir === 1 ? Infinity : -Infinity)));
    return [...picked].sort((a, b) => { const x = val(a), y = val(b); return (x < y ? -1 : x > y ? 1 : a.path.localeCompare(b.path)) * sort.dir; });
  }, [d, active, text, sort]);
  const exportCsv = () => {
    const lines = [["URL", "Status", "Blocking signal found", "Which", "Clicks deep", "Links to it", "Links from it", "Words", "Title", "Title length", "Description length", "H1 headings", "Images", "Images without alt text", "Size (KB)", "Issues"],
      ...rows.map((r) => [r.url, r.status, r.indexable === null ? "unknown" : r.indexable ? "no" : "yes", r.whyNot, r.depth, r.inlinks, r.outlinks, r.words, r.title, r.titleLength, r.descriptionLength, r.h1, r.images, r.imagesNoAlt, r.kb, r.issues.map((k) => issueTitles[k] ?? k).join("; ")])];
    const blob = new Blob([lines.map((l) => l.map(csvCell).join(",")).join("\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = `pages-${site.domain}.csv`; a.click(); URL.revokeObjectURL(a.href);
  };
  if (q.isLoading) return <p className="g-text-2 flex items-center gap-2 text-[14px]" role="status"><Loader2 className="h-4 w-4 animate-spin" /> Loading the crawled pages…</p>;
  if (q.isError) return <div className="g-callout" role="alert" data-testid="audit-pages-error"><h3>Couldn't load the pages</h3><p>{apiErrorMessage(q.error)}</p><button type="button" className="g-pill mt-2" onClick={() => void q.refetch()}>Try again</button></div>;
  if (unreadable) return <Empty testId="audit-pages-unreadable"><h3>The newest crawl could not be read</h3><p>The crawl that finished {fmtDate(unreadable.scannedAt)} was not saved in a form we can read, so nothing is shown from it (and no older crawl in its place). Run a new crawl.</p></Empty>;
  if (!d || d.pages.length === 0) return <Empty testId="audit-pages-empty"><h3>No pages to show</h3><p>The crawl did not save any pages for {site.domain}. Run a new crawl.</p></Empty>;
  const s = d.summary, measured = s.linksMeasured !== false;
  return (
    <div data-testid="audit-pages">
      {/* The same tiles as the dashboard's: a blue label, the figure, and what it rests on underneath. */}
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label="Nothing blocking Google" color={PALETTE.health} value={`${fmtNum(s.indexable)} of ${fmtNum(s.pages)}`} foot={s.notIndexable ? `${fmtNum(s.notIndexable)} carry a signal that keeps Google out — check they are meant to` : "No page tells Google to stay away. Google still decides what it lists."} testId="tile-pages-indexable" />
        {measured ? <>
          <StatTile label="Average clicks from home" color={PALETTE.health} value={s.averageDepth ?? "—"} foot={s.deep ? `${fmtNum(s.deep)} page${s.deep === 1 ? " is" : "s are"} 4 or more clicks deep` : "No page is more than 3 clicks deep"} testId="tile-pages-depth" />
          <StatTile label="Pages nothing links to" color={PALETTE.health} value={fmtNum(s.orphans)} foot="Among the pages crawled" testId="tile-pages-orphans" />
        </> : <StatTile label="Links between pages" color={PALETTE.health} value={<span className="text-[20px] sm:text-[22px]">Not measurable</span>} foot="Too few links in the page source" testId="tile-pages-links-unmeasured" />}
        <StatTile label="Pages with little text" color={PALETTE.health} value={fmtNum(s.thin)} foot="Under 200 words" testId="tile-pages-thin" />
      </div>
      {!measured && (
        <div className="g-callout mb-3" role="status" data-testid="pages-links-unmeasured">
          <h3>Links between your pages could not be measured</h3>
          <p>Most pages of {site.domain} have no links to other pages in their page source. That usually means the menus and links are added by JavaScript after the page loads — this crawl reads the source without running scripts, so it cannot say which pages link to which, or how many clicks deep a page is. Google does run scripts, but more slowly and less reliably than it reads plain links; putting your main menu and in-page links in the page's HTML is the safer choice.</p>
        </div>
      )}
      <div className="mb-2 flex flex-wrap gap-1.5" role="group" aria-label="Show pages">
        {FILTERS.filter((f) => measured || (f.key !== "orphans" && f.key !== "deep")).map((f) => { const n = f.count(s); return (
          <button key={f.key} type="button" className="g-pill g-pill--sm" aria-pressed={filter === f.key} disabled={n === 0 && f.key !== "all"} style={filter === f.key ? { borderColor: "var(--g-blue)", color: "var(--g-blue)" } : undefined}
            onClick={() => { setFilter(f.key); setShown(100); setOpen(null); }} data-testid={`filter-pages-${f.key}`}>{f.label} <span className="tabular-nums">({fmtNum(n)})</span></button>
        ); })}
      </div>
      {active.hint && <p className="g-text-2 mb-2 text-[13px]" data-testid="text-pages-hint">{active.hint}</p>}
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <label className="min-w-0 flex-1 sm:max-w-xs"><span className="sr-only">Find a page by address or title</span><input className="g-input w-full !py-1.5" value={text} onChange={(e) => { setText(e.target.value); setShown(100); }} placeholder="Find a page…" data-testid="input-pages-search" /></label>
        <span className="g-text-2 text-[13px]" data-testid="text-pages-count">{fmtNum(rows.length)} page{rows.length === 1 ? "" : "s"}</span>
        <button type="button" className="g-pill g-pill--sm ml-auto" onClick={exportCsv} disabled={!rows.length} data-testid="button-pages-export"><Download /> Export</button>
      </div>
      {rows.length === 0 ? <Empty testId="audit-pages-none"><h3>No page matches</h3><p>Clear the search box or choose another filter.</p></Empty> : (
        <div className="overflow-x-auto">
          <table className={COMPACT_TABLE} data-testid="table-audit-pages">
            <thead><tr><th aria-label="Show details" className="w-12" />{COLS.map((c) => (
              <th key={c.key} className={c.num ? "num" : undefined} aria-sort={sort.key === c.key ? (sort.dir === 1 ? "ascending" : "descending") : undefined} title={c.title}>
                <button type="button" className="g-text-2 whitespace-nowrap" onClick={() => setSort((x) => ({ key: c.key, dir: x.key === c.key ? (x.dir === 1 ? -1 : 1) : 1 }))}>{c.label}{sort.key === c.key ? (sort.dir === 1 ? " ▲" : " ▼") : ""}</button>
              </th>
            ))}</tr></thead>
            <tbody>
              {rows.slice(0, shown).map((r) => { const isOpen = open === r.url; const tl = lengthNote(r.titleLength, 30, 60), dl = lengthNote(r.descriptionLength, 70, 160); return (
                <Fragment key={r.url}>
                  <tr>
                    <td><button type="button" className="g-pill !min-h-8 !px-2" aria-expanded={isOpen} aria-label={`${isOpen ? "Hide" : "Show"} details for ${r.path}`} onClick={() => setOpen(isOpen ? null : r.url)}>{isOpen ? <ChevronDown /> : <ChevronRight />}</button></td>
                    <td className="max-w-[340px]"><a href={r.url} target="_blank" rel="noreferrer" className="g-link block truncate" title={r.url}>{r.path}</a>{r.indexable === false && <span className="text-[12px]" style={{ color: "var(--g-red)" }}>Blocked from Google: {r.whyNot}</span>}{r.canonicalElsewhere && <span className="g-text-2 text-[12px]">Its canonical tag asks Google to list another page instead</span>}{r.indexable === null && <span className="g-text-2 text-[12px]">Response not recorded — nothing can be said about this page</span>}</td>
                    <td className="num" data-label="Status" style={isErrorStatus(r.status) ? { color: "var(--g-red)" } : undefined}>{r.status || "—"}{r.redirected ? " ↪" : ""}</td>
                    <td className="num" data-label="Clicks deep">{r.depth ?? <span className="g-text-2" title="No crawled page links to it">—</span>}</td>
                    <td className="num" data-label="Links to it">{r.inlinks == null ? <span className="g-text-2" title="Not measurable on this site">—</span> : fmtNum(r.inlinks)}</td>
                    <td className="num" data-label="Words">{fmtNum(r.words)}</td>
                    <td className="num" data-label="Title">{r.titleLength}{tl && <span className="g-text-2 text-[12px]"> {tl}</span>}</td>
                    <td className="num" data-label="Description">{r.descriptionLength}{dl && <span className="g-text-2 text-[12px]"> {dl}</span>}</td>
                    <td className="num g-text-2" data-label="Size">{r.kb == null ? "—" : `${fmtNum(r.kb)} KB`}</td>
                  </tr>
                  {isOpen && (
                    <tr><td /><td colSpan={COLS.length} className="text-[13px]">
                      <p className="g-text"><b className="font-medium">Title:</b> {r.title ?? <span className="g-text-2">none</span>}</p>
                      <p className="g-text-2 mt-1">{r.h1} main heading{r.h1 === 1 ? "" : "s"} (H1) · {r.outlinks == null ? "its links to other pages could not be measured" : `its source links to ${fmtNum(r.outlinks)} other crawled page${r.outlinks === 1 ? "" : "s"}`} · {fmtNum(r.images)} image{r.images === 1 ? "" : "s"}{r.imagesNoAlt ? `, ${fmtNum(r.imagesNoAlt)} without a description (alt text)` : ""}</p>
                      {r.issues.length > 0 ? <><p className="g-text mt-2 font-medium">Listed under</p><ul className="g-text list-disc pl-5">{r.issues.map((k) => <li key={k}>{issueTitles[k] ?? k}</li>)}</ul></> : <p className="g-text-2 mt-2">No issue lists this page.</p>}
                    </td></tr>
                  )}
                </Fragment>
              ); })}
            </tbody>
          </table>
        </div>
      )}
      {rows.length > shown && <button type="button" className="g-pill mt-3" onClick={() => setShown(shown + 200)} data-testid="button-pages-more">Show more ({fmtNum(rows.length - shown)} left)</button>}
    </div>
  );
}
