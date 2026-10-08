/**
 * Rank tracker → Google's own numbers by page and by search (server/seo/gsc-breakdown.ts): Search Console clicks for
 * each page / search, the last 28 synced days against the 28 before. Shown when the site's property is connected. Free.
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Download, Loader2 } from "lucide-react";
import { apiErrorMessage } from "@/lib/queryClient";
import { fmtDate, fmtNum, type SeoSite } from "./shell";

type Row = { key: string; clicks: number; impressions: number; position: number | null; prevClicks: number | null; prevImpressions: number | null; prevPosition: number | null; tracked?: boolean };
type Data = { dimension: "page" | "query"; property: string; through: string | null; days: number; previousDays: number; comparable: boolean; rows: Row[]; more: number; total: number };
type Sort = "clicks" | "gain" | "loss";
const csvCell = (v: string | number | null) => { const s = v == null ? "" : String(v); return `"${(typeof v !== "number" && /^[=+\-@\t\r]/.test(s) ? `'${s}` : s).replace(/"/g, '""')}"`; };
const pathOf = (u: string, domain: string) => { try { const x = new URL(u); return x.hostname.replace(/^www\./, "") === domain.replace(/^www\./, "") ? (x.pathname + x.search) || "/" : u; } catch { return u; } };

export function GscBreakdownView({ site }: { site: SeoSite }) {
  const [dimension, setDimension] = useState<"page" | "query">("page");
  const [sort, setSort] = useState<Sort>("clicks");
  const [shown, setShown] = useState(25);
  const q = useQuery<Data | null>({
    queryKey: [`/api/seo/sites/${site.id}/search-console/${dimension}`], retry: false, placeholderData: (prev) => prev,
    queryFn: async ({ queryKey }) => { const r = await fetch(queryKey[0] as string, { credentials: "include" }); if (r.status === 404) return null; if (!r.ok) throw new Error((await r.json().catch(() => ({}))).message ?? "The request failed"); return r.json(); },
  });
  const d = q.data;
  const change = (r: Row) => (r.prevClicks === null ? null : r.clicks - r.prevClicks);
  const rows = (d?.rows ?? []).slice().sort((a, b) => sort === "clicks" ? 0 : sort === "gain" ? (change(b) ?? -1e9) - (change(a) ?? -1e9) : (change(a) ?? 1e9) - (change(b) ?? 1e9));
  const label = (r: Row) => (dimension === "page" ? pathOf(r.key, site.domain) : r.key);
  const exportCsv = () => {
    const lines: (string | number | null)[][] = [[dimension === "page" ? "Page" : "Search", "Clicks", "Clicks the 28 days before", "Impressions", "Impressions before", "Average position", "Position before", ...(dimension === "query" ? ["Tracked keyword"] : []), "28 days to"],
      ...(d?.rows ?? []).map((r) => [r.key, r.clicks, r.prevClicks, r.impressions, r.prevImpressions, r.position, r.prevPosition, ...(dimension === "query" ? [r.tracked ? "yes" : "no"] : []), d!.through])];
    const blob = new Blob([lines.map((l) => l.map(csvCell).join(",")).join("\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `${site.domain}-search-console-${dimension === "page" ? "pages" : "searches"}.csv`; a.click(); URL.revokeObjectURL(a.href);
  };
  return (
    <section className="mb-6 rounded-lg border p-4" style={{ borderColor: "var(--g-divider)", background: "var(--g-surface)" }} data-testid="gsc-breakdown" aria-busy={q.isFetching}>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h2 className="g-text text-[16px] font-medium">Google's own clicks, by {dimension === "page" ? "page" : "search"}</h2>
        <nav className="g-tabs !mb-0" aria-label="By page or search">
          {(["page", "query"] as const).map((x) => <a key={x} href={`#${x}`} aria-current={dimension === x ? "page" : undefined} onClick={(e) => { e.preventDefault(); setDimension(x); setShown(25); }} data-testid={`tab-gsc-${x}`}>{x === "page" ? "Pages" : "Searches"}</a>)}
        </nav>
        <label className="ml-auto flex items-center gap-2 text-[13px]"><span className="g-text-2">Show</span>
          <select className="g-select" value={sort} onChange={(e) => setSort(e.target.value as Sort)} data-testid="select-gsc-sort">
            <option value="clicks">Most clicks</option><option value="gain" disabled={!d?.comparable}>Biggest gain</option><option value="loss" disabled={!d?.comparable}>Biggest fall</option>
          </select></label>
        <button type="button" className="g-pill g-pill--sm" disabled={!d?.rows.length} onClick={exportCsv} data-testid="button-gsc-export"><Download /> Export</button>
      </div>
      {q.isLoading ? <p className="g-text-2 text-[13px]" role="status"><Loader2 className="mr-1 inline h-4 w-4 animate-spin" /> Reading Search Console…</p>
        : q.isError ? <p className="g-text-2 text-[13px]" role="alert">Couldn't read Search Console: {apiErrorMessage(q.error)} <button type="button" className="g-link" onClick={() => void q.refetch()}>Try again</button></p>
        : !d ? <p className="g-text-2 text-[13px]">No Search Console property for {site.domain} is connected.</p>
        : !d.through ? <p className="g-text-2 text-[13px]">Search Console has not synced any days for this property yet.</p>
        : (
        <>
          <p className="g-text-2 mb-2 text-[12px]" data-testid="text-gsc-basis">The 28 days to {fmtDate(d.through)} ({fmtNum(d.days)} of 28 synced) against the 28 before ({fmtNum(d.previousDays)} of 28 synced){d.comparable ? "" : " — not complete, so changes are not shown"}. Google leaves out rare searches, so the searches add up to fewer clicks than the site's total. {fmtNum(d.total)} {dimension === "page" ? "pages" : "searches"}{d.more > 0 ? `, the busiest ${fmtNum(d.rows.length)} listed` : ""}.</p>
          {rows.length === 0 ? <p className="g-text-2 text-[13px]">No {dimension === "page" ? "pages" : "searches"} with impressions in these 56 days.</p> : (
            <div className="overflow-x-auto">
              <table className="g-table w-full" data-testid="table-gsc">
                <thead><tr><th>{dimension === "page" ? "Page" : "Search"}</th><th className="num">Clicks</th><th className="num">Change</th><th className="num">Impressions</th><th className="num">Avg. position</th></tr></thead>
                <tbody>
                  {rows.slice(0, shown).map((r) => (
                    <tr key={r.key}>
                      <td className="max-w-[22rem] !whitespace-normal [overflow-wrap:anywhere]" data-label={dimension === "page" ? "Page" : "Search"}>{dimension === "page" ? <a href={r.key} className="g-link" target="_blank" rel="noreferrer">{label(r)}</a> : label(r)}{r.tracked && <span className="g-chip g-chip--sm ml-1">tracked</span>}</td>
                      <td className="num" data-label="Clicks">{fmtNum(r.clicks)}</td>
                      <td className="num" data-label="Change">{change(r) === null ? <span className="g-text-2">—</span> : change(r) === 0 ? "0" : <span className={`g-move ${change(r)! > 0 ? "g-move--up" : "g-move--down"}`}>{change(r)! > 0 ? "+" : "−"}{fmtNum(Math.abs(change(r)!))}</span>}</td>
                      <td className="num" data-label="Impressions">{fmtNum(r.impressions)}</td>
                      <td className="num" data-label="Avg. position">{r.position ?? "—"}{r.prevPosition != null && r.position != null && d.comparable ? <span className="g-text-2 block text-[11px]">was {r.prevPosition}</span> : null}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {rows.length > shown && <button type="button" className="g-link mt-2 text-[13px]" onClick={() => setShown(rows.length)} data-testid="button-gsc-all">Show all {fmtNum(rows.length)}</button>}
            </div>
          )}
          <p className="g-text-2 mt-2 text-[12px]">From the Search Console data already synced for {d.property}. Positions are Google's averages over the days a page or search was shown.</p>
        </>
      )}
    </section>
  );
}
