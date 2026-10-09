/**
 * Rank tracker → Google's own numbers by page and by search (server/seo/gsc-breakdown.ts): Search Console clicks for
 * each page / search, the last 28 days with data against the 28 before. Shown when the site's property is connected.
 * A page or search Google did not return for a window is "not returned" there — never a zero. Free.
 */
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Download, Loader2 } from "lucide-react";
import { apiErrorMessage } from "@/lib/queryClient";
import { fmtDate, fmtNum, type SeoSite } from "./shell";
import { CARD, SectionTitle, TABLE } from "./viz-rank";

type Row = { key: string; clicks: number | null; impressions: number | null; position: number | null; prevClicks: number | null; prevImpressions: number | null; prevPosition: number | null; tracked?: boolean };
type Data = { dimension: "page" | "query"; property: string; coverage: "domain" | "prefix"; others: string[]; through: string | null; days: number; previousDays: number; comparable: boolean; incomplete?: boolean; completenessUnknown?: boolean; rows: Row[]; more: number; total: number };
type Sort = "clicks" | "gain" | "loss";
const csvCell = (v: string | number | null) => { const s = v == null ? "" : String(v); return `"${(typeof v !== "number" && /^[=+\-@\t\r]/.test(s) ? `'${s}` : s).replace(/"/g, '""')}"`; };
const pathOf = (u: string, domain: string) => { try { const x = new URL(u); return x.hostname.replace(/^www\./, "") === domain.replace(/^www\./, "") ? (x.pathname + x.search) || "/" : u; } catch { return u; } };
/** A cell's label for screen readers (the phone layout hides the table header). */
const Label = ({ children }: { children: string }) => <span className="sr-only">{children}: </span>;

export function GscBreakdownView({ site }: { site: SeoSite }) {
  const [dimension, setDimension] = useState<"page" | "query">("page");
  const [sort, setSort] = useState<Sort>("clicks");
  const [shown, setShown] = useState(25);
  // No earlier answer is shown while the other tab loads: what is on screen is always what it says it is.
  const q = useQuery<Data | null>({
    queryKey: [`/api/seo/sites/${site.id}/search-console/${dimension}`], retry: false,
    queryFn: async ({ queryKey }) => { const r = await fetch(queryKey[0] as string, { credentials: "include" }); if (r.status === 404) return null; if (!r.ok) throw new Error((await r.json().catch(() => ({}))).message ?? "The request failed"); return r.json(); },
  });
  const d = q.data && q.data.dimension === dimension ? q.data : null;
  // Gain and fall need both windows complete; when they are not, the list goes back to most clicks.
  useEffect(() => { if (d && !d.comparable && sort !== "clicks") setSort("clicks"); }, [d?.comparable]); // eslint-disable-line react-hooks/exhaustive-deps
  /** Only where both windows returned it and both are complete. */
  const change = (r: Row) => (d?.comparable && r.clicks !== null && r.prevClicks !== null ? r.clicks - r.prevClicks : null);
  const last = (x: number | null, dir: 1 | -1) => (x === null ? -Infinity : dir * x);
  const rows = (d?.rows ?? []).slice().sort((a, b) =>
    sort === "clicks" ? last(b.clicks, 1) - last(a.clicks, 1) || a.key.localeCompare(b.key)
      : sort === "gain" ? last(change(b), 1) - last(change(a), 1) || a.key.localeCompare(b.key)
        : last(change(b), -1) - last(change(a), -1) || a.key.localeCompare(b.key));
  const word = dimension === "page" ? "Page" : "Search";
  const label = (r: Row) => (dimension === "page" ? pathOf(r.key, site.domain) : r.key);
  const n = (v: number | null) => (v === null ? "not returned" : fmtNum(v));
  const exportCsv = () => {
    if (!d) return;
    const lines: (string | number | null)[][] = [[word, "Clicks", "Clicks the 28 days before", "Impressions", "Impressions before", "Average position", "Position before", ...(dimension === "query" ? ["Tracked keyword"] : []), "Window ends", "Days with data", "Days with data before", "Comparable", "Property"],
      ...d.rows.map((r) => [r.key, r.clicks, r.prevClicks, r.impressions, r.prevImpressions, r.position, r.prevPosition, ...(dimension === "query" ? [r.tracked ? "yes" : "no"] : []), d.through, d.days, d.previousDays, d.comparable ? "yes" : "no", d.property]),
      ["(An empty number = not returned by Google for that window - not a zero.)"]];
    const blob = new Blob([lines.map((l) => l.map(csvCell).join(",")).join("\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `${site.domain}-search-console-${dimension === "page" ? "pages" : "searches"}.csv`; a.click(); URL.revokeObjectURL(a.href);
  };
  return (
    <section className="mb-6 rounded-xl border p-3 sm:p-4" style={CARD} data-testid="gsc-breakdown" aria-busy={q.isFetching}>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <SectionTitle>Google's own clicks, by {dimension === "page" ? "page" : "search"}</SectionTitle>
        <nav className="g-tabs !mb-0" aria-label="By page or search">
          {(["page", "query"] as const).map((x) => <a key={x} href={`#${x}`} aria-current={dimension === x ? "page" : undefined} onClick={(e) => { e.preventDefault(); setDimension(x); setShown(25); }} data-testid={`tab-gsc-${x}`}>{x === "page" ? "Pages" : "Searches"}</a>)}
        </nav>
        <label className="ml-auto flex items-center gap-2 text-[13px]"><span className="g-text-2">Show</span>
          <select className="g-select" value={sort} onChange={(e) => setSort(e.target.value as Sort)} data-testid="select-gsc-sort">
            <option value="clicks">Most clicks</option><option value="gain" disabled={!d?.comparable}>Biggest gain</option><option value="loss" disabled={!d?.comparable}>Biggest fall</option>
          </select></label>
        <button type="button" className="g-pill g-pill--sm" disabled={!d?.rows.length} onClick={exportCsv} data-testid="button-gsc-export"><Download /> Export</button>
      </div>
      {!d && q.isFetching ? <p className="g-text-2 text-[13px]" role="status"><Loader2 className="mr-1 inline h-4 w-4 animate-spin" /> Reading Search Console…</p>
        : q.isError ? <p className="g-text-2 text-[13px]" role="alert">Couldn't read Search Console: {apiErrorMessage(q.error)} <button type="button" className="g-link" onClick={() => void q.refetch()}>Try again</button></p>
        : !d ? <p className="g-text-2 text-[13px]">No Search Console property for {site.domain} is connected.</p>
        : !d.through ? <p className="g-text-2 text-[13px]">Search Console has no days of data for this property yet.</p>
        : (
        <>
          <p className="g-text-2 mb-2 text-[12px]" data-testid="text-gsc-basis">
            {d.property}{d.coverage === "domain" ? " (the whole domain, sub-domains included)" : " (only addresses under this URL)"}{d.others.length ? `; also on your account: ${d.others.join(", ")}` : ""}. The 28 days to {fmtDate(d.through)} ({fmtNum(d.days)} of 28 with data) against the 28 before ({fmtNum(d.previousDays)} of 28 with data){d.comparable ? "" : d.completenessUnknown ? " — whether every day was read in full could not be checked just now, so changes are not shown" : d.incomplete ? " — some of these days are still being read from Google (or a read failed), so changes are not shown yet" : " — not both complete, so changes are not shown"}. Google returns only some rows — it leaves out rare searches and caps how many it sends — so "not returned" is not a zero, and the searches add up to fewer clicks than the site's total. {fmtNum(d.total)} {dimension === "page" ? "pages" : "searches"}{d.more > 0 ? `, the busiest ${fmtNum(d.rows.length)} listed` : ""}.
          </p>
          {rows.length === 0 ? <p className="g-text-2 text-[13px]">No {dimension === "page" ? "pages" : "searches"} returned for these 56 days.</p> : (
            <div className="overflow-x-auto">
              <table className={TABLE} data-testid="table-gsc">
                <thead><tr><th>{word}</th><th className="num">Clicks</th><th className="num">Change</th><th className="num">Impressions</th><th className="num">Avg. position</th></tr></thead>
                <tbody>
                  {rows.slice(0, shown).map((r) => {
                    const c = change(r);
                    return (
                      <tr key={r.key}>
                        <td className="max-w-[22rem] !whitespace-normal [overflow-wrap:anywhere]" data-label={word}><Label>{word}</Label>{dimension === "page" ? <a href={r.key} className="g-link" target="_blank" rel="noreferrer">{label(r)}</a> : label(r)}{r.tracked && <span className="g-chip g-chip--sm ml-1">tracked</span>}</td>
                        <td className="num" data-label="Clicks"><Label>Clicks</Label>{n(r.clicks)}{r.prevClicks !== null && <span className="g-text-2 block text-[11px]">before {fmtNum(r.prevClicks)}</span>}</td>
                        <td className="num" data-label="Change"><Label>Change</Label>{c === null ? <span className="g-text-2">—</span> : c === 0 ? "0" : <span className={`g-move ${c > 0 ? "g-move--up" : "g-move--down"}`}>{c > 0 ? "+" : "−"}{fmtNum(Math.abs(c))}</span>}</td>
                        <td className="num" data-label="Impressions"><Label>Impressions</Label>{n(r.impressions)}</td>
                        <td className="num" data-label="Avg. position"><Label>Average position</Label>{r.position ?? "—"}{r.prevPosition != null && r.position != null && d.comparable ? <span className="g-text-2 block text-[11px]">was {r.prevPosition}</span> : null}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {rows.length > shown && <button type="button" className="g-link mt-2 text-[13px]" onClick={() => setShown(rows.length)} data-testid="button-gsc-all">Show all {fmtNum(rows.length)}</button>}
            </div>
          )}
          <p className="g-text-2 mt-2 text-[12px]">From the Search Console data already synced. "Days with data" counts days that have rows; it does not prove every row of those days arrived. Positions are Google's averages over the days shown.</p>
        </>
      )}
    </section>
  );
}
