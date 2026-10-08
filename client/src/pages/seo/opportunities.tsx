/**
 * Site Explorer -> Opportunities: what to work on next for this site, from one
 * lookup of the keywords it already ranks on pages one and two for. Four lists:
 * within reach, losing ground, which page ranks for what, and searches only the
 * home page ranks for. See server/seo/opportunities.ts.
 */
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, Loader2, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiErrorMessage } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { api, Empty, fmtDate, fmtNum, isNotRunYet, kd, money, Tile, type SeoStatus } from "./shell";
import { AddToList } from "./keyword-lists";
import type { SeoMarket } from "@shared/seo-markets";

type Kw = { keyword: string; position: number; previous: number | null; volume: number | null; difficulty: number | null; cpc: number | null; traffic: number; url: string; path: string };
type PageRow = { url: string; path: string; keywords: number; traffic: number; top3: number; top10: number; best: { keyword: string; position: number; volume: number | null } };
type Data = {
  domain: string; fetchedAt: string; total: number | null; analysed: number; within: Kw[]; falling: Kw[]; pages: PageRow[]; home: Kw[];
  summary: { withinCount: number; withinVolume: number; fallingCount: number; pages: number; homeCount: number; homeShare: number | null };
};
type Tab = "within" | "falling" | "pages" | "home";
type TrackRow = { keyword: string; volume: number | null; cpc: number | null; difficulty: number | null };

const csvCell = (v: string | number | null) => { const s = v == null ? "" : String(v); return `"${(typeof v !== "number" && /^[=+\-@\t\r]/.test(s) ? `'${s}` : s).replace(/"/g, '""')}"`; };
function downloadCsv(name: string, rows: (string | number | null)[][]) {
  const blob = new Blob([rows.map((l) => l.map(csvCell).join(",")).join("\n")], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; a.click(); URL.revokeObjectURL(a.href);
}

const NOTE: Record<Tab, ReactNode> = {
  within: <>Searches where this site is on page one or two but not in the first three. Most clicks go to the first three results, so these are usually the quickest wins: improve the page that already ranks.</>,
  falling: <>Searches where this site has dropped three places or more since the data was last collected. Check the page still answers the search, and who moved above it.</>,
  pages: <>Which page ranks for what. A page that ranks for many searches but few in the first three is the one to improve.</>,
  home: <>Searches where the only page that ranks is the home page, and it is outside the first three. A page of its own for that service or town usually ranks better than a home page that covers everything.</>,
};

export function OpportunitiesView({ domain, status, market, onTrack }: { domain: string; status: SeoStatus | undefined; market: SeoMarket; onTrack?: (rows: TrackRow[]) => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [tab, setTab] = useState<Tab>("within");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  useEffect(() => { setPicked(new Set()); }, [tab, domain]);
  const body = useMemo(() => ({ domain, locationCode: market.locationCode, languageCode: market.languageCode }), [domain, market.locationCode, market.languageCode]);
  const queryKey = ["/api/seo/opportunities", body];
  const saved = useQuery<{ page: Data } | null>({
    queryKey, retry: false, staleTime: 5 * 60_000,
    queryFn: async () => { try { return await api("POST", "/api/seo/opportunities", { ...body, peek: true }); } catch (e) { if (isNotRunYet(e)) return null; throw e; } },
  });
  const run = useMutation({
    mutationFn: (v: { body: Record<string, unknown>; key: readonly unknown[]; again: boolean }) => api("POST", "/api/seo/opportunities", v.again ? { ...v.body, refresh: true } : v.body),
    onSuccess: (data: { page: Data; saved?: boolean }, v) => {
      qc.setQueryData(v.key, data); void qc.invalidateQueries({ queryKey: ["/api/seo/status"] });
      if (data.saved === false) toast({ title: "Shown, but it couldn't be kept", description: "Opening this again will not be free. Export it now if you need it.", variant: "destructive" });
    },
    onError: (e) => toast({ title: "Couldn't look for opportunities", description: apiErrorMessage(e), variant: "destructive" }),
  });
  const prices = status?.prices as Record<string, number | undefined> | undefined;
  const max = prices?.opportunitiesMax ?? null, small = prices?.opportunitiesSmall ?? null;
  const canPay = max == null || !status?.credits || status.credits.availableCents === -1 || status.credits.availableCents >= max;
  const d = saved.data?.page ?? null;
  const list: Kw[] = d && tab !== "pages" ? d[tab] : [];
  const chosen = list.filter((r) => picked.has(r.keyword));
  const toggle = (k: string) => setPicked((s) => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; });
  const count = (t: Tab) => (d ? (t === "within" ? d.summary.withinCount : t === "falling" ? d.summary.fallingCount : t === "pages" ? d.summary.pages : d.summary.homeCount) : 0);
  const exportCsv = () => {
    if (!d) return;
    if (tab === "pages") downloadCsv(`${domain}-pages.csv`, [["Page", "Keywords", "Visits / mo", "In the top 3", "In the top 10", "Best keyword", "Its position"], ...d.pages.map((p) => [p.url, p.keywords, p.traffic, p.top3, p.top10, p.best.keyword, p.best.position])]);
    else downloadCsv(`${domain}-${tab}.csv`, [["Keyword", "Position", "Was", "Searches / mo", "Difficulty", "Cost per click", "Page"], ...list.map((r) => [r.keyword, r.position, r.previous, r.volume, r.difficulty, r.cpc, r.url])]);
  };

  return (
    <div data-testid="opportunities">
      {saved.isLoading && <p className="g-text-2 flex items-center gap-2 text-[13px]" role="status"><Loader2 className="h-4 w-4 animate-spin" /> Checking for a saved copy…</p>}
      {saved.isError && <div className="g-callout" role="alert"><h3>Couldn't check for a saved copy</h3><p>{apiErrorMessage(saved.error)} Nothing has been charged.</p><button type="button" className="g-pill mt-2" onClick={() => void saved.refetch()}>Try again</button></div>}
      {saved.isSuccess && !d && (
        <Empty testId="opportunities-not-run">
          <h3>What should {domain} work on next?</h3>
          <p>One lookup of the searches this site already ranks on pages one and two for (up to 500, the most searched) — sorted into what is within reach, what is slipping, which page ranks for what, and what only the home page ranks for.</p>
          <p className="mt-1">{max != null ? `Costs up to about ${money(max)} of your SEO data` : "The price depends on how many keywords the site has"}{small != null ? ` — about ${money(small)} for a site with a hundred keywords` : ""}; you pay for what comes back. Kept for a day and free to reopen.{!canPay && " You don't have enough SEO data left — add credit above."}</p>
          <Button className="mt-3" disabled={run.isPending || !status?.configured || !canPay} onClick={() => run.mutate({ body, key: queryKey, again: false })} data-testid="button-opportunities-run">
            {run.isPending ? <><Loader2 className="mr-1 h-4 w-4 animate-spin" /> Looking…</> : <><Play className="mr-1 h-4 w-4" /> Find opportunities{max != null ? ` — up to ${money(max)}` : ""}</>}
          </Button>
        </Empty>
      )}
      {d && (
        <>
          <div className="g-tiles mb-4">
            <Tile label="Within reach" value={fmtNum(d.summary.withinCount)} hint={`positions 4–20 · ${fmtNum(d.summary.withinVolume)} searches a month between them`} testId="tile-opp-within" />
            <Tile label="Losing ground" value={fmtNum(d.summary.fallingCount)} hint="fell three places or more" testId="tile-opp-falling" />
            <Tile label="Pages that rank" value={fmtNum(d.summary.pages)} hint={`for ${fmtNum(d.analysed)} keyword${d.analysed === 1 ? "" : "s"}`} testId="tile-opp-pages" />
            <Tile label="On the home page" value={d.summary.homeShare == null ? "—" : `${d.summary.homeShare}%`} hint="of these searches lead to the home page" testId="tile-opp-home" />
          </div>
          <p className="g-text-2 mb-3 text-[13px]" data-testid="text-opp-meta">
            {d.total != null && d.total > d.analysed ? `The ${fmtNum(d.analysed)} most searched of the ${fmtNum(d.total)} keywords this site ranks on pages one and two for` : `All ${fmtNum(d.analysed)} keyword${d.analysed === 1 ? "" : "s"} this site ranks on pages one and two for`} · {market.label} · as of {fmtDate(d.fetchedAt)}
            {" "}<button type="button" className="g-link" disabled={run.isPending || !canPay} onClick={() => run.mutate({ body, key: queryKey, again: true })} data-testid="button-opportunities-refresh">{run.isPending ? "Looking…" : "Look again"}</button>
          </p>
          <nav className="g-tabs" aria-label="Opportunities">
            {([["within", "Within reach"], ["falling", "Losing ground"], ["pages", "Pages"], ["home", "On the home page"]] as const).map(([t, label]) => (
              <a key={t} href={`#${t}`} aria-current={tab === t ? "page" : undefined} onClick={(e) => { e.preventDefault(); setTab(t); }} data-testid={`tab-opp-${t}`}>{label} <span className="g-text-2 tabular-nums">{fmtNum(count(t))}</span></a>
            ))}
          </nav>
          <p className="g-text-2 mb-3 text-[13px]" data-testid="text-opp-note">{NOTE[tab]}</p>
          <div className="mb-2 flex flex-wrap items-center justify-end gap-2">
            {tab !== "pages" && chosen.length > 0 && <AddToList market={market} rows={chosen.map((r) => ({ keyword: r.keyword, volume: r.volume, cpc: r.cpc, difficulty: r.difficulty }))} onDone={() => setPicked(new Set())} />}
            {tab !== "pages" && onTrack && chosen.length > 0 && <Button size="sm" onClick={() => { onTrack(chosen.map((r) => ({ keyword: r.keyword, volume: r.volume, cpc: r.cpc, difficulty: r.difficulty }))); setPicked(new Set()); }} data-testid="button-opp-track">Add to rank tracker ({chosen.length})</Button>}
            <button type="button" className="g-pill g-pill--sm" disabled={tab === "pages" ? !d.pages.length : !list.length} onClick={exportCsv} data-testid="button-opp-export"><Download /> Export CSV</button>
          </div>
          {tab === "pages" ? (
            d.pages.length === 0 ? <Empty testId="opp-empty">No page of this site ranks on pages one or two in {market.label}.</Empty> : (
              <div className="overflow-x-auto"><table className="g-table" data-testid="table-opp-pages">
                <thead><tr><th>Page</th><th className="num">Keywords</th><th className="num">Visits / mo</th><th className="num">In the top 3</th><th className="num">In the top 10</th><th>Best keyword</th></tr></thead>
                <tbody>{d.pages.map((p) => (
                  <tr key={p.path}>
                    <td><a href={p.url} className="g-link block max-w-[360px] truncate" target="_blank" rel="noreferrer" title={p.url}>{p.path}</a></td>
                    <td className="num" data-label="Keywords">{fmtNum(p.keywords)}</td><td className="num" data-label="Visits / mo">{fmtNum(p.traffic)}</td>
                    <td className="num" data-label="In the top 3">{fmtNum(p.top3)}</td><td className="num" data-label="In the top 10">{fmtNum(p.top10)}</td>
                    <td data-label="Best keyword">{p.best.keyword} <span className="g-text-2">· #{p.best.position}</span></td>
                  </tr>
                ))}</tbody>
              </table></div>
            )
          ) : list.length === 0 ? (
            <Empty testId="opp-empty">{tab === "within" ? "Nothing on pages one and two outside the first three." : tab === "falling" ? "Nothing has dropped three places or more." : d.summary.pages <= 1 ? "Every search this site ranks for leads to the home page — no other page ranks. A page of its own for each service and each town gives Google something more specific to rank." : "Nothing ranks on the home page alone outside the first three."}</Empty>
          ) : (
            <div className="overflow-x-auto"><table className="g-table" data-testid={`table-opp-${tab}`}>
              <thead><tr><th className="w-8"><span className="sr-only">Select</span></th><th>Keyword</th><th className="num">Position</th>{tab === "falling" && <th className="num">Was</th>}<th className="num">Searches / mo</th><th className="num">Difficulty</th><th>Page that ranks</th></tr></thead>
              <tbody>{list.map((r) => (
                <tr key={r.keyword}>
                  <td><input type="checkbox" aria-label={`Select ${r.keyword}`} checked={picked.has(r.keyword)} onChange={() => toggle(r.keyword)} /></td>
                  <td>{r.keyword}</td>
                  <td className="num" data-label="Position">{r.position}</td>
                  {tab === "falling" && <td className="num g-text-2" data-label="Was">{r.previous ?? "—"}</td>}
                  <td className="num" data-label="Searches / mo">{fmtNum(r.volume)}</td>
                  <td className="num" data-label="Difficulty">{kd(r.difficulty)}</td>
                  <td data-label="Page that ranks"><a href={r.url} className="g-link block max-w-[280px] truncate" target="_blank" rel="noreferrer" title={r.url}>{r.path}</a></td>
                </tr>
              ))}</tbody>
            </table></div>
          )}
          {tab !== "pages" && count(tab) > list.length && <p className="g-text-2 mt-2 text-[12px]">Showing the {fmtNum(list.length)} most searched of {fmtNum(count(tab))}.</p>}
          <p className="g-text-2 mt-2 text-[12px]">Positions and visits are estimates from the keyword database for {market.label}, not live checks; track a keyword to have it checked every week. The data keeps one ranking page per search, so it cannot show two of your pages competing for the same one.</p>
        </>
      )}
    </div>
  );
}
