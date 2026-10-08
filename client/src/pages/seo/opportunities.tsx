/**
 * Site Explorer -> Opportunities: what to work on next for this site, from one
 * lookup of the keywords it already ranks on pages one and two for. Four views of
 * the same rows: within reach, losing ground, which page was returned for what,
 * and searches the home page was returned for. See server/seo/opportunities.ts.
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

type Kw = { keyword: string; position: number; fell: number | null; volume: number | null; difficulty: number | null; cpc: number | null; traffic: number; url: string; home: boolean };
type PageRow = { url: string; key: string; home: boolean; keywords: number; traffic: number; top3: number; top10: number; best: { keyword: string; position: number; volume: number | null } };
type Data = {
  domain: string; fetchedAt: string; total: number | null; rows: Kw[]; pages: PageRow[];
  summary: { analysed: number; withinCount: number; withinVolume: number; fallingCount: number; pages: number; homeCount: number; homeShare: number | null };
};
type Tab = "within" | "falling" | "pages" | "home";
type TrackRow = { keyword: string; volume: number | null; cpc: number | null; difficulty: number | null };
const PER_PAGE = 50;

const csvCell = (v: string | number | null) => { const s = v == null ? "" : String(v); return `"${(typeof v !== "number" && /^[=+\-@\t\r]/.test(s) ? `'${s}` : s).replace(/"/g, '""')}"`; };
function downloadCsv(name: string, rows: (string | number | null)[][]) {
  const blob = new Blob([rows.map((l) => l.map(csvCell).join(",")).join("\n")], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; a.click(); URL.revokeObjectURL(a.href);
}
const shortUrl = (u: string) => u.replace(/^https?:\/\/(www\.)?/, "");
/** The same page identity the server groups by (host + path, no www, no trailing slash, no tracking parameters). */
function pageKey(url: string): string {
  try {
    const u = new URL(url), tracking = /^(utm_[a-z]+|gclid|fbclid|msclkid|srsltid|ref)$/i;
    const kept = [...u.searchParams.entries()].filter(([k]) => !tracking.test(k));
    return `${u.hostname.toLowerCase().replace(/^www\./, "")}${u.pathname.replace(/\/+$/, "") || "/"}${kept.length ? `?${kept.map(([k, v]) => `${k}=${v}`).join("&")}` : ""}`;
  } catch { return url; }
}

const NOTE: Record<Tab, ReactNode> = {
  within: <>Searches where this site is on page one or two but not in the first three. Most clicks go to the first three results, so these are usually the quickest wins: improve the page that already ranks.</>,
  falling: <>Searches where this site has lost three places or more since the data was last collected, counted among everything Google shows on the page (ads and the map pack included). Check the page still answers the search, and who moved above it.</>,
  pages: <>The page the data returned for each search. Select a page to see its searches. A page returned for many searches but with few in the first three is the one to improve.</>,
  home: <>Searches for which the page returned is the home page, outside the first three. The data keeps one page per search, so this does not prove no other page ranks — but when a service or a town leads to the home page, a page of its own for it is worth looking into.</>,
};

export function OpportunitiesView({ domain, status, market, onTrack }: { domain: string; status: SeoStatus | undefined; market: SeoMarket; onTrack?: (rows: TrackRow[]) => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [tab, setTab] = useState<Tab>("within");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(0);
  /** Pages tab: the page whose searches are listed. */
  const [openPage, setOpenPage] = useState<string | null>(null);
  useEffect(() => { setPicked(new Set()); setPage(0); setOpenPage(null); }, [tab, domain]);
  useEffect(() => { setPage(0); setPicked(new Set()); }, [openPage]);
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
  // A new set of rows (looked up again) starts at the first page; a page that is no longer among them is closed.
  useEffect(() => { setPage(0); setPicked(new Set()); setOpenPage((k) => (k && d?.pages?.some((p) => p.key === k) ? k : null)); }, [d?.fetchedAt]); // eslint-disable-line react-hooks/exhaustive-deps
  // Older saved copies (before every row was kept) have no `rows`: they are simply looked up again when asked.
  const rows = d?.rows ?? [];
  const list: Kw[] = useMemo(() => {
    if (tab === "within") return rows.filter((r) => r.position >= 4);
    if (tab === "falling") return rows.filter((r) => r.fell !== null && r.fell >= 3);
    if (tab === "home") return rows.filter((r) => r.home && r.position >= 4);
    return openPage ? rows.filter((r) => pageKey(r.url) === openPage) : [];
  }, [rows, tab, openPage]);
  const pages = d?.pages ?? [];
  const total = tab === "pages" && !openPage ? pages.length : list.length;
  // Never past the end, whatever happened to the list.
  const lastPage = Math.max(0, Math.ceil(total / PER_PAGE) - 1), at = Math.min(page, lastPage);
  const from = at * PER_PAGE, shownRows = list.slice(from, from + PER_PAGE), shownPages = pages.slice(from, from + PER_PAGE);
  const chosen = list.filter((r) => picked.has(r.keyword));
  const toggle = (k: string) => setPicked((s) => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; });
  const count = (t: Tab) => (d ? (t === "within" ? d.summary.withinCount : t === "falling" ? d.summary.fallingCount : t === "pages" ? d.summary.pages : d.summary.homeCount) : 0);
  const opened = openPage ? pages.find((p) => p.key === openPage) ?? null : null;
  // Everything in the view is exported, not only the fifty on screen.
  const exportCsv = () => {
    if (!d) return;
    if (tab === "pages" && !openPage) downloadCsv(`${domain}-pages.csv`, [["Page", "Searches", "Visits / mo", "In the top 3", "In the top 10", "Best keyword", "Its position"], ...pages.map((p) => [p.url, p.keywords, p.traffic, p.top3, p.top10, p.best.keyword, p.best.position])]);
    else downloadCsv(`${domain}-${tab}${openPage ? "-page" : ""}.csv`, [["Keyword", "Position", "Places lost", "Searches / mo", "Difficulty", "Cost per click", "Page returned"], ...list.map((r) => [r.keyword, r.position, r.fell, r.volume, r.difficulty, r.cpc, r.url])]);
  };
  const refreshNote = max != null ? `up to about ${money(max)}` : "priced by how many keywords come back";

  return (
    <div data-testid="opportunities">
      {saved.isLoading && <p className="g-text-2 flex items-center gap-2 text-[13px]" role="status"><Loader2 className="h-4 w-4 animate-spin" /> Checking for a saved copy…</p>}
      {saved.isError && <div className="g-callout" role="alert"><h3>Couldn't check for a saved copy</h3><p>{apiErrorMessage(saved.error)} Nothing has been charged.</p><button type="button" className="g-pill mt-2" onClick={() => void saved.refetch()}>Try again</button></div>}
      {saved.isSuccess && (!d || !d.rows) && (
        <Empty testId="opportunities-not-run">
          <h3>What should {domain} work on next?</h3>
          <p>One lookup of the searches this site already ranks on pages one and two for (up to 500, the most searched) — sorted into what is within reach, what is slipping, which page is returned for what, and what leads to the home page.</p>
          <p className="mt-1">{max != null ? `Costs up to about ${money(max)} of your SEO data` : "The price depends on how many keywords the site has"}{small != null ? ` — about ${money(small)} for a site with a hundred keywords` : ""}; you pay for what comes back. Kept for a day and free to reopen.{!canPay && " You don't have enough SEO data left — add credit above."}</p>
          <Button className="mt-3" disabled={run.isPending || !status?.configured || !canPay} onClick={() => run.mutate({ body, key: queryKey, again: false })} data-testid="button-opportunities-run">
            {run.isPending ? <><Loader2 className="mr-1 h-4 w-4 animate-spin" /> Looking…</> : <><Play className="mr-1 h-4 w-4" /> Find opportunities{max != null ? ` — up to ${money(max)}` : ""}</>}
          </Button>
        </Empty>
      )}
      {d && d.rows && (
        <>
          <div className="g-tiles mb-4">
            <Tile label="Within reach" value={fmtNum(d.summary.withinCount)} hint={`positions 4–20 · ${fmtNum(d.summary.withinVolume)} searches a month between them`} testId="tile-opp-within" />
            <Tile label="Losing ground" value={fmtNum(d.summary.fallingCount)} hint="lost three places or more" testId="tile-opp-falling" />
            <Tile label="Pages returned" value={fmtNum(d.summary.pages)} hint={`for ${fmtNum(d.summary.analysed)} search${d.summary.analysed === 1 ? "" : "es"}`} testId="tile-opp-pages" />
            <Tile label="Home page" value={d.summary.homeShare == null ? "—" : `${d.summary.homeShare}%`} hint="of these searches return the home page" testId="tile-opp-home" />
          </div>
          <p className="g-text-2 mb-3 text-[13px]" data-testid="text-opp-meta">
            {d.total != null && d.total > d.summary.analysed ? `The ${fmtNum(d.summary.analysed)} most searched of the ${fmtNum(d.total)} keywords this site ranks on pages one and two for` : `All ${fmtNum(d.summary.analysed)} keyword${d.summary.analysed === 1 ? "" : "s"} this site ranks on pages one and two for`} · {market.label} · as of {fmtDate(d.fetchedAt)}
            {" · "}<button type="button" className="g-link" disabled={run.isPending || !canPay || !status?.configured} onClick={() => run.mutate({ body, key: queryKey, again: true })} data-testid="button-opportunities-refresh">{run.isPending ? "Looking…" : `Look again — ${refreshNote}`}</button>
            {!canPay && <span style={{ color: "var(--g-red)" }}> Not enough SEO data left to look again.</span>}
          </p>
          <nav className="g-tabs" aria-label="Opportunities">
            {([["within", "Within reach"], ["falling", "Losing ground"], ["pages", "Pages"], ["home", "Home page"]] as const).map(([t, label]) => (
              <a key={t} href={`#${t}`} aria-current={tab === t ? "page" : undefined} onClick={(e) => { e.preventDefault(); setTab(t); }} data-testid={`tab-opp-${t}`}>{label} <span className="g-text-2 tabular-nums">{fmtNum(count(t))}</span></a>
            ))}
          </nav>
          <p className="g-text-2 mb-3 text-[13px]" data-testid="text-opp-note">{NOTE[tab]}</p>
          {tab === "pages" && opened && (
            <p className="g-text mb-2 flex flex-wrap items-center gap-2 text-[13px]" data-testid="text-opp-open-page">
              <button type="button" className="g-pill g-pill--sm" onClick={() => setOpenPage(null)} data-testid="button-opp-all-pages">← All pages</button>
              <span>Searches that return <a href={opened.url} className="g-link" target="_blank" rel="noreferrer">{shortUrl(opened.url)}</a> ({fmtNum(opened.keywords)})</span>
            </p>
          )}
          <div className="mb-2 flex flex-wrap items-center justify-end gap-2">
            {(tab !== "pages" || openPage) && chosen.length > 0 && <AddToList market={market} rows={chosen.map((r) => ({ keyword: r.keyword, volume: r.volume, cpc: r.cpc, difficulty: r.difficulty }))} onDone={() => setPicked(new Set())} />}
            {(tab !== "pages" || openPage) && onTrack && chosen.length > 0 && <Button size="sm" onClick={() => { onTrack(chosen.map((r) => ({ keyword: r.keyword, volume: r.volume, cpc: r.cpc, difficulty: r.difficulty }))); setPicked(new Set()); }} data-testid="button-opp-track">Add to rank tracker ({chosen.length})</Button>}
            <button type="button" className="g-pill g-pill--sm" disabled={!total} onClick={exportCsv} data-testid="button-opp-export"><Download /> Export all {total ? fmtNum(total) : ""}</button>
          </div>
          {tab === "pages" && !openPage ? (
            pages.length === 0 ? <Empty testId="opp-empty">No page of this site ranks on pages one or two in {market.label}.</Empty> : (
              <div className="overflow-x-auto"><table className="g-table" data-testid="table-opp-pages">
                <thead><tr><th>Page</th><th className="num">Searches</th><th className="num">Visits / mo</th><th className="num">In the top 3</th><th className="num">In the top 10</th><th>Best keyword</th></tr></thead>
                <tbody>{shownPages.map((p) => (
                  <tr key={p.key}>
                    <td><button type="button" className="g-link block max-w-[360px] truncate text-left" title={`Show the searches that return ${p.url}`} onClick={() => setOpenPage(p.key)} data-testid="button-opp-open-page">{shortUrl(p.url)}</button>{p.home && <span className="g-chip g-chip--sm">Home page</span>}</td>
                    <td className="num" data-label="Searches">{fmtNum(p.keywords)}</td><td className="num" data-label="Visits / mo">{fmtNum(p.traffic)}</td>
                    <td className="num" data-label="In the top 3">{fmtNum(p.top3)}</td><td className="num" data-label="In the top 10">{fmtNum(p.top10)}</td>
                    <td data-label="Best keyword">{p.best.keyword} <span className="g-text-2">· #{p.best.position}</span></td>
                  </tr>
                ))}</tbody>
              </table></div>
            )
          ) : list.length === 0 ? (
            <Empty testId="opp-empty">{tab === "within" ? "Nothing on pages one and two outside the first three." : tab === "falling" ? "Nothing has lost three places or more." : tab === "home" ? (d.summary.analysed === 0 ? "This site ranks for nothing on pages one and two here, so there is nothing to say about its home page." : d.summary.homeShare === 0 ? "None of these searches returns the home page." : "Every search that returns the home page has it in the first three.") : "No searches for this page."}</Empty>
          ) : (
            <div className="overflow-x-auto"><table className="g-table" data-testid={`table-opp-${tab}`}>
              <thead><tr><th className="w-8"><span className="sr-only">Select</span></th><th>Keyword</th><th className="num">Position</th>{tab === "falling" && <th className="num">Places lost</th>}<th className="num">Searches / mo</th><th className="num">Difficulty</th>{!(tab === "pages" && openPage) && <th>Page returned</th>}</tr></thead>
              <tbody>{shownRows.map((r) => (
                <tr key={r.keyword}>
                  <td><input type="checkbox" aria-label={`Select ${r.keyword}`} checked={picked.has(r.keyword)} onChange={() => toggle(r.keyword)} /></td>
                  <td>{r.keyword}</td>
                  <td className="num" data-label="Position">{r.position}</td>
                  {tab === "falling" && <td className="num" data-label="Places lost">{r.fell ?? "—"}</td>}
                  <td className="num" data-label="Searches / mo">{fmtNum(r.volume)}</td>
                  <td className="num" data-label="Difficulty">{kd(r.difficulty)}</td>
                  {!(tab === "pages" && openPage) && <td data-label="Page returned"><a href={r.url} className="g-link block max-w-[280px] truncate" target="_blank" rel="noreferrer" title={r.url}>{shortUrl(r.url)}</a></td>}
                </tr>
              ))}</tbody>
            </table></div>
          )}
          {total > PER_PAGE && (
            <div className="mt-3 flex flex-wrap items-center gap-2 text-[13px]" data-testid="opp-paging">
              <button type="button" className="g-pill g-pill--sm" disabled={at === 0} onClick={() => { setPage(at - 1); setPicked(new Set()); }} data-testid="button-opp-prev">← Previous</button>
              <button type="button" className="g-pill g-pill--sm" disabled={from + PER_PAGE >= total} onClick={() => { setPage(at + 1); setPicked(new Set()); }} data-testid="button-opp-next">Next →</button>
              <span className="g-text-2">{fmtNum(from + 1)}–{fmtNum(Math.min(total, from + PER_PAGE))} of {fmtNum(total)} · paging is free</span>
            </div>
          )}
          <p className="g-text-2 mt-2 text-[12px]">Positions and visits are estimates from the keyword database for {market.label}, not live checks; track a keyword to have it checked every week. The data keeps one page per search, so it cannot show two of your pages competing for the same one, nor prove that no other page ranks.</p>
        </>
      )}
    </div>
  );
}
