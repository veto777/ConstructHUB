/**
 * Rank tracker → Google's own numbers by page and by search (server/seo/gsc-breakdown.ts): Search Console clicks for
 * each page / search, the last 28 days with data against the 28 before. Shown when the site's property is connected.
 * A page or search Google did not return for a window is "not returned" there — never a zero. Free.
 * A page opens in Site explorer's pages view, a search in the keywords explorer, a tracked search in the table above;
 * every figure in a row leads the same way. The tab (`gsc`), the order (`gscSort`) and "show all" (`gscAll`) are in
 * the address, so they are links and the back button undoes them.
 */
import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Download, Loader2 } from "lucide-react";
import { apiErrorMessage } from "@/lib/queryClient";
import { fmtDate, fmtNum, type SeoSite } from "./shell";
import { seoLinks, setParam } from "./links";
import { hrefWith, pageParts, useRankParams } from "./rank-params";
import { CARD, LINK, SectionTitle, TABLE } from "./viz-rank";

type Row = { key: string; clicks: number | null; impressions: number | null; position: number | null; prevClicks: number | null; prevImpressions: number | null; prevPosition: number | null; tracked?: boolean };
type Data = { dimension: "page" | "query"; property: string; coverage: "domain" | "prefix"; others: string[]; through: string | null; days: number; previousDays: number; comparable: boolean; incomplete?: boolean; completenessUnknown?: boolean; rows: Row[]; more: number; total: number };
type Sort = "clicks" | "gain" | "loss";
const csvCell = (v: string | number | null) => { const s = v == null ? "" : String(v); return `"${(typeof v !== "number" && /^[=+\-@\t\r]/.test(s) ? `'${s}` : s).replace(/"/g, '""')}"`; };
const pathOf = (u: string, domain: string) => { try { const x = new URL(u); return x.hostname.replace(/^www\./, "") === domain.replace(/^www\./, "") ? (x.pathname + x.search) || "/" : u; } catch { return u; } };
/** A cell's label for screen readers (the phone layout hides the table header). */
const Label = ({ children }: { children: string }) => <span className="sr-only">{children}: </span>;

export function GscBreakdownView({ site }: { site: SeoSite }) {
  const p = useRankParams();
  const dimension = p.gsc ?? "page", sort: Sort = p.gscSort ?? "clicks";
  // No earlier answer is shown while the other tab loads: what is on screen is always what it says it is.
  const q = useQuery<Data | null>({
    queryKey: [`/api/seo/sites/${site.id}/search-console/${dimension}`], retry: false,
    queryFn: async ({ queryKey }) => { const r = await fetch(queryKey[0] as string, { credentials: "include" }); if (r.status === 404) return null; if (!r.ok) throw new Error((await r.json().catch(() => ({}))).message ?? "The request failed"); return r.json(); },
  });
  const d = q.data && q.data.dimension === dimension ? q.data : null;
  // Gain and fall need both windows complete; when they are not, the list goes back to most clicks (in the address, in place).
  useEffect(() => { if (d && !d.comparable && sort !== "clicks") setParam("gscSort", null, true); }, [d?.comparable]); // eslint-disable-line react-hooks/exhaustive-deps
  /** Only where both windows returned it and both are complete. */
  const change = (r: Row) => (d?.comparable && r.clicks !== null && r.prevClicks !== null ? r.clicks - r.prevClicks : null);
  const last = (x: number | null, dir: 1 | -1) => (x === null ? -Infinity : dir * x);
  const rows = (d?.rows ?? []).slice().sort((a, b) =>
    sort === "clicks" ? last(b.clicks, 1) - last(a.clicks, 1) || a.key.localeCompare(b.key)
      : sort === "gain" ? last(change(b), 1) - last(change(a), 1) || a.key.localeCompare(b.key)
        : last(change(b), -1) - last(change(a), -1) || a.key.localeCompare(b.key));
  const shown = p.gscAll ? rows.length : 25;
  const word = dimension === "page" ? "Page" : "Search";
  const label = (r: Row) => (dimension === "page" ? pathOf(r.key, site.domain) : r.key);
  const n = (v: number | null) => (v === null ? "not returned" : fmtNum(v));
  /** Where a row leads: a page to Site explorer's pages view for that address, a search to the keywords explorer. */
  const rowHref = (r: Row) => { if (dimension === "query") return seoLinks.keywords(r.key); const x = pageParts(r.key); return x ? seoLinks.explorer(x.domain, "pages", { path: x.path }) : null; };
  const exportCsv = () => {
    if (!d) return;
    const lines: (string | number | null)[][] = [[word, "Clicks", "Clicks the 28 days before", "Impressions", "Impressions before", "Average position", "Position before", ...(dimension === "query" ? ["Tracked keyword"] : []), "Window ends", "Days with data", "Days with data before", "Comparable", "Property"],
      ...d.rows.map((r) => [r.key, r.clicks, r.prevClicks, r.impressions, r.prevImpressions, r.position, r.prevPosition, ...(dimension === "query" ? [r.tracked ? "yes" : "no"] : []), d.through, d.days, d.previousDays, d.comparable ? "yes" : "no", d.property]),
      ["(An empty number = not returned by Google for that window - not a zero.)"]];
    const blob = new Blob([lines.map((l) => l.map(csvCell).join(",")).join("\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `${site.domain}-search-console-${dimension === "page" ? "pages" : "searches"}.csv`; a.click(); URL.revokeObjectURL(a.href);
  };
  return (
    <section className="mb-6 scroll-mt-16 rounded-xl border p-3 sm:p-4" style={CARD} data-testid="gsc-breakdown" aria-busy={q.isFetching}>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <SectionTitle>Google's own clicks, by {dimension === "page" ? "page" : "search"}</SectionTitle>
        {/* The tabs are addresses: the rest of the page's address (the table's narrowing) stays as it is. */}
        <nav className="g-tabs !mb-0" aria-label="By page or search">
          {(["page", "query"] as const).map((x) => <Link key={x} href={hrefWith({ gsc: x === "page" ? null : x, gscAll: null })} aria-current={dimension === x ? "page" : undefined} className="max-sm:!min-h-11" data-testid={`tab-gsc-${x}`}>{x === "page" ? "Pages" : "Searches"}</Link>)}
        </nav>
        <label className="ml-auto flex items-center gap-2 text-[13px]"><span className="g-text-2">Show</span>
          <select className="g-select" value={sort} onChange={(e) => setParam("gscSort", e.target.value === "clicks" ? null : e.target.value)} data-testid="select-gsc-sort">
            <option value="clicks">Most clicks</option><option value="gain" disabled={!d?.comparable}>Biggest gain</option><option value="loss" disabled={!d?.comparable}>Biggest fall</option>
          </select></label>
        <button type="button" className="g-pill g-pill--sm max-sm:!min-h-11" disabled={!d?.rows.length} onClick={exportCsv} data-testid="button-gsc-export"><Download /> Export</button>
      </div>
      {!d && q.isFetching ? <p className="g-text-2 text-[13px]" role="status"><Loader2 className="mr-1 inline h-4 w-4 animate-spin" /> Reading Search Console…</p>
        : q.isError ? <p className="g-text-2 text-[13px]" role="alert">Couldn't read Search Console: {apiErrorMessage(q.error)} <button type="button" className="g-link" onClick={() => void q.refetch()}>Try again</button></p>
        : !d ? <p className="g-text-2 text-[13px]">No Search Console property for {site.domain} is connected. <Link href={seoLinks.searchConsole()} className={LINK} data-testid="link-gsc-settings">Connect it</Link></p>
        : !d.through ? <p className="g-text-2 text-[13px]">Search Console has no days of data for this property yet.</p>
        : (
        <>
          <p className="g-text-2 mb-2 text-[12px]" data-testid="text-gsc-basis">
            {/* The property, the window and its days with data are the sync's: they lead to the Search Console connection, where it is synced. */}
            <Link href={seoLinks.searchConsole()} className={LINK} title="The Search Console connection, where this property is synced" data-testid="link-gsc-property">{d.property}</Link>{d.coverage === "domain" ? " (the whole domain, sub-domains included)" : " (only addresses under this URL)"}{d.others.length ? <>; also on your account: {d.others.map((o, n) => <span key={o}>{n ? ", " : ""}<Link href={seoLinks.searchConsole()} className={LINK} title="The Search Console connection" data-testid={`link-gsc-other-${n}`}>{o}</Link></span>)}</> : ""}. The 28 days to <Link href={seoLinks.searchConsole()} className={LINK} title="The Search Console connection: when this property was last synced" data-testid="link-gsc-through">{fmtDate(d.through)}</Link> (<Link href={seoLinks.searchConsole()} className={LINK} title="The Search Console connection: the days synced" data-testid="link-gsc-days">{fmtNum(d.days)} of 28 with data</Link>) against the 28 before (<Link href={seoLinks.searchConsole()} className={LINK} title="The Search Console connection: the days synced" data-testid="link-gsc-days-before">{fmtNum(d.previousDays)} of 28 with data</Link>){d.comparable ? "" : d.completenessUnknown ? " — whether every day was read in full could not be checked just now, so changes are not shown" : d.incomplete ? " — some of these days are still being read from Google (or a read failed), so changes are not shown yet" : " — not both complete, so changes are not shown"}. Google returns only some rows — it leaves out rare searches and caps how many it sends — so "not returned" is not a zero, and the searches add up to fewer clicks than the site's total. <Link href={hrefWith({ gscAll: true })} className={LINK} title={d.more > 0 ? `The busiest ${fmtNum(d.rows.length)} of them, listed (the rest are counted, not listed)` : "Every row Google returned, listed"} data-testid="link-gsc-total">{fmtNum(d.total)} {dimension === "page" ? "pages" : "searches"}</Link>{d.more > 0 ? <>, the busiest <Link href={hrefWith({ gscAll: true })} className={LINK} title="Every row listed here" data-testid="link-gsc-listed">{fmtNum(d.rows.length)} listed</Link></> : ""}. {dimension === "page" ? "A page and its figures open in Site explorer." : "A search and its figures open in the keywords explorer; a tracked one also has its row in the table above."}
          </p>
          {rows.length === 0 ? <p className="g-text-2 text-[13px]">No {dimension === "page" ? "pages" : "searches"} returned for these 56 days.</p> : (
            <div className="overflow-x-auto">
              <table className={TABLE} data-testid="table-gsc">
                <thead><tr><th>{word}</th><th className="num">Clicks</th><th className="num">Change</th><th className="num">Impressions</th><th className="num">Avg. position</th></tr></thead>
                <tbody>
                  {rows.slice(0, shown).map((r, i) => {
                    const c = change(r), href = rowHref(r);
                    const where = dimension === "page" ? `${r.key} — in Site explorer` : "This search in the keywords explorer";
                    // A figure as a link to the row's place; a row with no place (an address that is not a URL) keeps its figures as words.
                    const fig = (body: React.ReactNode, id: string, extra = "") => (href ? <Link href={href} className={`${LINK} ${extra}`} title={where} data-testid={`link-gsc-${id}-${i}`}>{body}</Link> : body);
                    return (
                      <tr key={r.key}>
                        <td className="max-w-[22rem] !whitespace-normal [overflow-wrap:anywhere]" data-label={word}><Label>{word}</Label>{href ? <Link href={href} className={LINK} title={where} data-testid={`link-gsc-${dimension}-${i}`}>{label(r)}</Link> : label(r)}{r.tracked && <Link href={seoLinks.rankTracker(site.id, { keyword: r.key })} className="g-chip g-chip--sm ml-1 !underline decoration-dotted hover:decoration-solid max-sm:!min-h-11" title="This keyword's row in the table above" data-testid={`link-gsc-tracked-${i}`}>tracked</Link>}</td>
                        <td className="num" data-label="Clicks"><Label>Clicks</Label>{fig(n(r.clicks), "clicks")}{r.prevClicks !== null && <span className="g-text-2 block text-[11px]">before {fig(fmtNum(r.prevClicks), "clicks-before", "g-text-2")}</span>}</td>
                        <td className="num" data-label="Change"><Label>Change</Label>{c === null ? <span className="g-text-2">—</span> : fig(c === 0 ? "0" : <span className={`g-move ${c > 0 ? "g-move--up" : "g-move--down"}`}>{c > 0 ? "+" : "−"}{fmtNum(Math.abs(c))}</span>, "change")}</td>
                        <td className="num" data-label="Impressions"><Label>Impressions</Label>{fig(n(r.impressions), "impressions")}</td>
                        <td className="num" data-label="Avg. position"><Label>Average position</Label>{r.position == null ? "—" : fig(r.position, "position")}{r.prevPosition != null && r.position != null && d.comparable ? <span className="g-text-2 block text-[11px]">was {fig(r.prevPosition, "position-before", "g-text-2")}</span> : null}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {rows.length > shown && <Link href={hrefWith({ gscAll: true })} className={`${LINK} mt-2 text-[13px]`} data-testid="button-gsc-all">Show all {fmtNum(rows.length)}</Link>}
            </div>
          )}
          <p className="g-text-2 mt-2 text-[12px]">From the Search Console data already synced. "Days with data" counts days that have rows; it does not prove every row of those days arrived. Positions are Google's averages over the days shown.</p>
        </>
      )}
    </section>
  );
}
