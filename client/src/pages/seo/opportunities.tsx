/**
 * Site Explorer -> Opportunities: what to work on next for this site, from one
 * lookup of the keywords it already ranks on pages one and two for. Four views of
 * the same rows: within reach, losing ground, which page was returned for what,
 * and searches the home page was returned for. See server/seo/opportunities.ts.
 *
 * The address is the state (links.ts `explorer` view "opportunities"): `opp` within | falling | pages | home is the
 * list shown, and with `opp` pages, `path` opens one page's searches. The tiles, the tabs and their counts are links
 * that write it, so a tile, a tab and a link from elsewhere are one thing and the back button returns to the list
 * before; what the address asked for is said in a chip (data-testid="active-filter") with a clear. Every figure is a
 * link: a keyword, its volume and difficulty to its overview in the Keywords explorer, a position (and the places
 * lost) to the site's organic keywords in Site explorer narrowed to the search (the keyword database the figure comes
 * from; the place before is kept nowhere else, and the words say so), a page's figures to that page in Site explorer,
 * the date to that month's lookups on the Usage page. Arriving never buys: the saved copy opens, or the button waits.
 * The page of a list is the address too (links.ts `offset`, pages of 50 — round 3): Previous / Next are links, so
 * the back button undoes a page turn. Every link carries the country with its language (marketParams).
 */
import { AddToPlan } from "./plan-button";
import { Link } from "wouter";
import { seoLinks, setParam, setParams } from "./links";
import { marketParams } from "./keyword-links";
import { pageFromAddress, pathOfUrl } from "./explorer-filters";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, Loader2, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiErrorMessage } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { ActiveFilter, api, Empty, fmtDate, fmtNum, isNotRunYet, kd, money, useAddress, type SeoStatus } from "./shell";
import { AddToList } from "./keyword-lists";
import { BLOCK_LINK, FIG_LINK, LINK_CUE, TEXT_LINK, TileLink } from "./viz-keywords";
import { type SeoMarket } from "@shared/seo-markets";

type Kw = { keyword: string; position: number; fell: number | null; volume: number | null; difficulty: number | null; cpc: number | null; traffic: number; url: string; home: boolean };
type PageRow = { url: string; key: string; home: boolean; keywords: number; traffic: number; top3: number; top10: number; best: { keyword: string; position: number; volume: number | null } };
type Data = {
  domain: string; fetchedAt: string; total: number | null; rows: Kw[]; pages: PageRow[];
  summary: { analysed: number; withinCount: number; withinVolume: number; fallingCount: number; pages: number; homeCount: number; homeShare: number | null };
};
type Tab = "within" | "falling" | "pages" | "home";
const TABS: readonly Tab[] = ["within", "falling", "pages", "home"];
/** A pill-sized link or button that is 44 px tall on a phone. */
const PILL = "g-pill g-pill--sm !min-h-11";
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

export function OpportunitiesView({ domain, status, market, onTrack, planSiteId }: { domain: string; status: SeoStatus | undefined; market: SeoMarket; onTrack?: (rows: TrackRow[]) => void; /** The customer's own site, when this is it: findings can go to its action plan. */ planSiteId?: number }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  // The list shown is the address's (links.ts): `opp` the list, and on the Pages list `path` one page's searches.
  const address = useAddress();
  const oppParam = address.get("opp"), pathParam = address.get("path")?.trim() || null;
  const tab: Tab = TABS.find((t) => t === oppParam) ?? "within";
  const [picked, setPicked] = useState<Set<string>>(new Set());
  // The page of the list is the address's (links.ts `offset`, a multiple of 50); the first page is no word.
  const offsetParam = pageFromAddress({ offset: address.get("offset") }, [PER_PAGE], PER_PAGE).offset;
  const page = offsetParam / PER_PAGE;
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
  // Older saved copies (before every row was kept) have no `rows`: they are simply looked up again when asked.
  const rows = d?.rows ?? [];
  const pages = d?.pages ?? [];
  /** A page's `path` in the address: its path on this site (its query kept), or its whole address when it is on another host. */
  const pagePath = (p: { url: string }) => pathOfUrl(p.url, domain) ?? p.url;
  /** Pages list: the page whose searches are listed — the address's, when it is among the pages returned (the chip says when it is not). */
  const opened = tab === "pages" && pathParam ? pages.find((p) => pagePath(p) === pathParam) ?? null : null;
  const openPage = opened?.key ?? null;
  // Another list, site, page of the site or page of rows starts with nothing ticked; so does a new set of rows (looked up again).
  useEffect(() => { setPicked(new Set()); }, [tab, domain, openPage, d?.fetchedAt, offsetParam]);
  const list: Kw[] = useMemo(() => {
    if (tab === "within") return rows.filter((r) => r.position >= 4);
    if (tab === "falling") return rows.filter((r) => r.fell !== null && r.fell >= 3);
    if (tab === "home") return rows.filter((r) => r.home && r.position >= 4);
    return openPage ? rows.filter((r) => pageKey(r.url) === openPage) : [];
  }, [rows, tab, openPage]);
  const total = tab === "pages" && !openPage ? pages.length : list.length;
  // Never past the end, whatever happened to the list.
  const lastPage = Math.max(0, Math.ceil(total / PER_PAGE) - 1), at = Math.min(page, lastPage);
  const from = at * PER_PAGE, shownRows = list.slice(from, from + PER_PAGE), shownPages = pages.slice(from, from + PER_PAGE);
  const chosen = list.filter((r) => picked.has(r.keyword));
  const toggle = (k: string) => setPicked((s) => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; });
  const count = (t: Tab) => (d ? (t === "within" ? d.summary.withinCount : t === "falling" ? d.summary.fallingCount : t === "pages" ? d.summary.pages : d.summary.homeCount) : 0);
  const loc = marketParams(market);
  /** This view showing another list (or one page's searches): what the tiles, the tabs and a page's links write. */
  const here = (opp: Tab, path?: string) => seoLinks.explorer(domain, "opportunities", { opp, path, ...loc });
  /** This list (as the address names it — no list word when it names none) at the page of rows starting at `from`: what Previous / Next write. */
  const pageAt = (from: number) => seoLinks.explorer(domain, "opportunities", { opp: oppParam === tab ? tab : undefined, path: opened ? pagePath(opened) : undefined, ...loc, offset: from || undefined });
  /** The site's organic keywords in Site explorer, narrowed — the keyword database a position comes from (its own lookup: a saved page opens free, else its Run button waits). */
  const organic = (p: { contains?: string; path?: string; band?: "top3" | "top10" | "top20" }) => seoLinks.explorer(domain, "keywords", { ...p, ...loc });
  /** A keyword's overview in the Keywords explorer, or one part of it. */
  const kw = (keyword: string, extra: Parameters<typeof seoLinks.keywords>[1] = {}) => seoLinks.keywords(keyword, { ...marketParams(market), ...extra });
  /** What the address asked for, in words, with its clear: the list, one page's searches, or a value that names neither. */
  const listWords = (t: Tab) => !d ? "" : t === "within" ? `Within reach: ${fmtNum(d.summary.withinCount)} searches on page one or two, outside the first three`
    : t === "falling" ? `Losing ground: ${fmtNum(d.summary.fallingCount)} searches that lost three places or more`
    : t === "pages" ? `Pages: ${fmtNum(pages.length)} pages returned for ${fmtNum(d.summary.analysed)} searches`
    : `Home page: ${fmtNum(d.summary.homeCount)} searches that return the home page outside the first three${d.summary.homeShare != null ? ` (the tile's ${d.summary.homeShare}% counts every search that returns it, the first three included)` : ""}`;
  const chip: { words: string; clear: () => void; label: string } | null = !d?.rows ? null
    : tab === "pages" && pathParam && !opened ? { words: `No page "${pathParam}" among the ${fmtNum(pages.length)} pages returned — every page is listed`, clear: () => setParam("path", null), label: "Every page" }
    : opened ? { words: `Searches that return ${shortUrl(opened.url)}: ${fmtNum(list.length)}`, clear: () => setParam("path", null), label: "Every page" }
    : oppParam && oppParam !== tab ? { words: `"${oppParam}" isn't one of the four lists — Within reach is shown`, clear: () => setParams({ opp: null, path: null }), label: "Clear" }
    : oppParam ? { words: listWords(tab), clear: () => setParams({ opp: null, path: null }), label: tab === "within" ? "Clear" : "Back to Within reach" } : null;
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
          <p className="mt-1">{max != null ? <>Costs up to about <Link href={seoLinks.usage()} className={TEXT_LINK} title="Usage and credit: what lookups cost and what is left this month" data-testid="link-opp-price">{money(max)}</Link> of your SEO data</> : "The price depends on how many keywords the site has"}{small != null ? ` — about ${money(small)} for a site with a hundred keywords` : ""}; you pay for what comes back. Kept for a day and free to reopen.{!canPay && " You don't have enough SEO data left — add credit above."}</p>
          <Button className="mt-3" disabled={run.isPending || !status?.configured || !canPay} onClick={() => run.mutate({ body, key: queryKey, again: false })} data-testid="button-opportunities-run">
            {run.isPending ? <><Loader2 className="mr-1 h-4 w-4 animate-spin" /> Looking…</> : <><Play className="mr-1 h-4 w-4" /> Find opportunities{max != null ? ` — up to ${money(max)}` : ""}</>}
          </Button>
        </Empty>
      )}
      {d && d.rows && (
        <>
          {/* Each tile is a link to the list it counts (`opp` in the address); the tab under it is the same link. */}
          <div className="g-tiles mb-4">
            <TileLink href={here("within")} label="Within reach" value={fmtNum(d.summary.withinCount)} hint={`positions 4–20 · ${fmtNum(d.summary.withinVolume)} searches a month between them`} title="The searches on page one or two, outside the first three" testId="link-opp-tile-within" tileTestId="tile-opp-within" />
            <TileLink href={here("falling")} label="Losing ground" value={fmtNum(d.summary.fallingCount)} hint="lost three places or more" title="The searches that lost three places or more" testId="link-opp-tile-falling" tileTestId="tile-opp-falling" />
            <TileLink href={here("pages")} label="Pages returned" value={fmtNum(d.summary.pages)} hint={`for ${fmtNum(d.summary.analysed)} search${d.summary.analysed === 1 ? "" : "es"}`} title="Each page, with the searches it is returned for" testId="link-opp-tile-pages" tileTestId="tile-opp-pages" />
            <TileLink href={here("home")} label="Home page" value={d.summary.homeShare == null ? "—" : `${d.summary.homeShare}%`} hint="of these searches return the home page" title={`The ${fmtNum(d.summary.homeCount)} searches that return the home page outside the first three (the share counts the first three too)`} testId="link-opp-tile-home" tileTestId="tile-opp-home" />
          </div>
          {chip && <ActiveFilter onClear={chip.clear} clearLabel={chip.label}>{chip.words}</ActiveFilter>}
          {/* The counts lead to their rows: the searches looked at to every page returned for them, the site's total to its organic keywords on pages one and two; the date to that month's lookups. */}
          <p className="g-text-2 mb-3 text-[13px]" data-testid="text-opp-meta">
            {d.total != null && d.total > d.summary.analysed
              ? <>The <Link href={here("pages")} className={TEXT_LINK} title="Every one of them, by the page returned" data-testid="link-opp-analysed">{fmtNum(d.summary.analysed)} most searched</Link> of the <Link href={organic({ band: "top20" })} className={TEXT_LINK} title="The site's organic keywords in the top 20, in Site explorer (its own lookup: a saved page opens free)" data-testid="link-opp-total">{fmtNum(d.total)} keywords</Link> this site ranks on pages one and two for</>
              : <><Link href={here("pages")} className={TEXT_LINK} title="Every one of them, by the page returned" data-testid="link-opp-analysed">All {fmtNum(d.summary.analysed)} keyword{d.summary.analysed === 1 ? "" : "s"}</Link> this site ranks on pages one and two for</>}
            {" · "}{market.label} · <Link href={seoLinks.usage({ month: d.fetchedAt.slice(0, 7) })} className={TEXT_LINK} title="When this was looked up — that month's lookups on the Usage page" data-testid="link-opp-as-of">as of {fmtDate(d.fetchedAt)}</Link>
            {" · "}<button type="button" className="g-link min-h-11" disabled={run.isPending || !canPay || !status?.configured} onClick={() => run.mutate({ body, key: queryKey, again: true })} data-testid="button-opportunities-refresh">{run.isPending ? "Looking…" : `Look again — ${refreshNote}`}</button>
            {!canPay && <span style={{ color: "var(--g-red)" }}> Not enough SEO data left to look again.</span>}
          </p>
          <nav className="g-tabs" aria-label="Opportunities">
            {([["within", "Within reach"], ["falling", "Losing ground"], ["pages", "Pages"], ["home", "Home page"]] as const).map(([t, label]) => (
              <Link key={t} href={here(t)} className="inline-flex min-h-11 items-center gap-1 rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--g-blue)]" aria-current={tab === t ? "page" : undefined} data-testid={`tab-opp-${t}`}><span className="underline decoration-dotted decoration-1 underline-offset-4">{label}</span> <span className="g-text-2 tabular-nums underline decoration-dotted decoration-1 underline-offset-4">{fmtNum(count(t))}</span></Link>
            ))}
          </nav>
          <p className="g-text-2 mb-3 text-[13px]" data-testid="text-opp-note">{NOTE[tab]}</p>
          {tab === "pages" && opened && (
            <p className="g-text mb-2 flex flex-wrap items-center gap-2 text-[13px]" data-testid="text-opp-open-page">
              <Link href={here("pages")} className={`${PILL} ${LINK_CUE}`} data-testid="button-opp-all-pages">← All pages</Link>
              <span>Searches that return <a href={opened.url} className={TEXT_LINK} target="_blank" rel="noreferrer">{shortUrl(opened.url)}</a> ({(() => { const path = pathOfUrl(opened.url, domain); return <Link href={path ? organic({ path }) : here("pages", pagePath(opened))} className={TEXT_LINK} title={path ? "This page's searches among the site's organic keywords in Site explorer" : "These searches (the page is not on this site's own address, so Site explorer cannot narrow to it)"} data-testid="link-opp-open-page-count">{fmtNum(opened.keywords)}</Link>; })()})</span>
            </p>
          )}
          <div className="mb-2 flex flex-wrap items-center justify-end gap-2">
            {(tab !== "pages" || openPage) && chosen.length > 0 && <AddToList market={market} rows={chosen.map((r) => ({ keyword: r.keyword, volume: r.volume, cpc: r.cpc, difficulty: r.difficulty }))} onDone={() => setPicked(new Set())} />}
            {(tab !== "pages" || openPage) && planSiteId != null && chosen.length > 0 && <AddToPlan siteId={planSiteId} onDone={() => setPicked(new Set())} tasks={chosen.map((r) => ({ kind: "keyword" as const, title: r.position <= 3 ? `Keep "${r.keyword}" in the first three` : `Move "${r.keyword}" up from position ${r.position}`, target: r.url, facts: { position: r.position, volume: r.volume }, source: `kw:${r.keyword}` }))} />}
            {(tab !== "pages" || openPage) && onTrack && chosen.length > 0 && <Button size="sm" onClick={() => { onTrack(chosen.map((r) => ({ keyword: r.keyword, volume: r.volume, cpc: r.cpc, difficulty: r.difficulty }))); setPicked(new Set()); }} data-testid="button-opp-track">Add to rank tracker ({chosen.length})</Button>}
            <button type="button" className={PILL} disabled={!total} onClick={exportCsv} data-testid="button-opp-export"><Download /> Export all {total ? fmtNum(total) : ""}</button>
          </div>
          {tab === "pages" && !openPage ? (
            pages.length === 0 ? <Empty testId="opp-empty">No page of this site ranks on pages one or two in {market.label}.</Empty> : (
              <div className="overflow-x-auto"><table className="g-table" data-testid="table-opp-pages">
                <thead><tr><th>Page</th><th className="num">Searches</th><th className="num">Visits / mo</th><th className="num">In the top 3</th><th className="num">In the top 10</th><th>Best keyword</th></tr></thead>
                {/* A page and its count of searches open its searches here; its visits and top-3 / top-10 counts open that page in Site explorer (the site's pages when its address is on another host, and the title says so). */}
                <tbody>{shownPages.map((p) => { const path = pathOfUrl(p.url, domain); const off = path ? "" : " — the page is not on this site's own address, so this opens the whole site"; return (
                  <tr key={p.key}>
                    <td><Link href={here("pages", pagePath(p))} className={`${BLOCK_LINK} g-link max-w-[360px] text-left`} title={`Show the searches that return ${p.url}`} data-testid="button-opp-open-page"><span className="min-w-0 truncate">{shortUrl(p.url)}</span></Link>{p.home && <Link href={here("home")} className={`g-chip g-chip--sm ${LINK_CUE}`} title="The searches that return the home page outside the first three" data-testid="link-opp-page-home">Home page</Link>}</td>
                    <td className="num" data-label="Searches"><Link href={here("pages", pagePath(p))} className={TEXT_LINK} title="The searches that return this page" data-testid="link-opp-page-searches">{fmtNum(p.keywords)}</Link></td>
                    <td className="num" data-label="Visits / mo"><Link href={path ? seoLinks.explorer(domain, "pages", { path, ...loc }) : seoLinks.explorer(domain, "pages", loc)} className={FIG_LINK} title={`Estimated visits a month — this page in Site explorer's top pages${off}`} data-testid="link-opp-page-visits">{fmtNum(p.traffic)}</Link></td>
                    <td className="num" data-label="In the top 3"><Link href={organic({ path: path ?? undefined, band: "top3" })} className={FIG_LINK} title={`This page's keywords in the first three, in Site explorer${off}`} data-testid="link-opp-page-top3">{fmtNum(p.top3)}</Link></td>
                    <td className="num" data-label="In the top 10"><Link href={organic({ path: path ?? undefined, band: "top10" })} className={FIG_LINK} title={`This page's keywords in the top ten, in Site explorer${off}`} data-testid="link-opp-page-top10">{fmtNum(p.top10)}</Link></td>
                    <td data-label="Best keyword"><Link href={kw(p.best.keyword)} className={TEXT_LINK} data-testid="link-opp-best">{p.best.keyword}</Link> <Link href={organic({ contains: p.best.keyword })} className={`${FIG_LINK} g-text-2`} title="Its position — the site's organic keywords in Site explorer, narrowed to this search" data-testid="link-opp-best-position">· #{p.best.position}</Link></td>
                  </tr>
                ); })}</tbody>
              </table></div>
            )
          ) : list.length === 0 ? (
            <Empty testId="opp-empty">{tab === "within" ? "Nothing on pages one and two outside the first three." : tab === "falling" ? "Nothing has lost three places or more." : tab === "home" ? (d.summary.analysed === 0 ? "This site ranks for nothing on pages one and two here, so there is nothing to say about its home page." : d.summary.homeShare === 0 ? "None of these searches returns the home page." : "Every search that returns the home page has it in the first three.") : "No searches for this page."}</Empty>
          ) : (
            <div className="overflow-x-auto"><table className="g-table" data-testid={`table-opp-${tab}`}>
              <thead><tr><th className="w-8"><span className="sr-only">Select</span></th><th>Keyword</th><th className="num">Position</th>{tab === "falling" && <th className="num">Places lost</th>}<th className="num">Searches / mo</th><th className="num">Difficulty</th>{!(tab === "pages" && openPage) && <th>Page returned</th>}</tr></thead>
              {/* A position, and the places lost, open the search among the site's organic keywords in Site explorer: the position now is there; the place before is kept only as this figure. */}
              <tbody>{shownRows.map((r) => (
                <tr key={r.keyword}>
                  <td><input type="checkbox" aria-label={`Select ${r.keyword}`} checked={picked.has(r.keyword)} onChange={() => toggle(r.keyword)} /></td>
                  <td><Link href={kw(r.keyword)} className={TEXT_LINK} title="This keyword's overview (the saved one, or the Look up button)" data-testid="link-opp-keyword">{r.keyword}</Link></td>
                  <td className="num" data-label="Position"><Link href={organic({ contains: r.keyword })} className={FIG_LINK} title="Its position — the site's organic keywords in Site explorer, narrowed to this search" data-testid="link-opp-position">{r.position}</Link></td>
                  {tab === "falling" && <td className="num" data-label="Places lost"><Link href={organic({ contains: r.keyword })} className={FIG_LINK} title="Places lost since the data last looked — the place before is kept only as this figure; the site's organic keywords in Site explorer show where it is now" data-testid="link-opp-fell">{r.fell ?? "—"}</Link></td>}
                  <td className="num" data-label="Searches / mo"><Link href={kw(r.keyword, { section: "volume" })} className={TEXT_LINK} title="This keyword's search volume by month" data-testid="link-opp-volume">{fmtNum(r.volume)}</Link></td>
                  <td className="num" data-label="Difficulty"><Link href={kw(r.keyword, { section: "serp" })} className={TEXT_LINK} title="Who ranks for it" data-testid="link-opp-difficulty">{kd(r.difficulty)}</Link></td>
                  {!(tab === "pages" && openPage) && <td data-label="Page returned"><a href={r.url} className={`${BLOCK_LINK} g-link max-w-[280px]`} target="_blank" rel="noreferrer" title={r.url}><span className="min-w-0 truncate">{shortUrl(r.url)}</span></a></td>}
                </tr>
              ))}</tbody>
            </table></div>
          )}
          {total > PER_PAGE && (
            <div className="mt-3 flex flex-wrap items-center gap-2 text-[13px]" data-testid="opp-paging">
              {/* The pages are addresses (links.ts `offset`): a link to share, and Back undoes a page turn. */}
              {at === 0 ? <span className={`${PILL} opacity-50`} aria-disabled data-testid="button-opp-prev">← Previous</span> : <Link href={pageAt(from - PER_PAGE)} className={`${PILL} ${LINK_CUE}`} data-testid="button-opp-prev">← Previous</Link>}
              {from + PER_PAGE >= total ? <span className={`${PILL} opacity-50`} aria-disabled data-testid="button-opp-next">Next →</span> : <Link href={pageAt(from + PER_PAGE)} className={`${PILL} ${LINK_CUE}`} data-testid="button-opp-next">Next →</Link>}
              <span className="g-text-2"><Link href={pageAt(from)} className={TEXT_LINK} title="This page of the list — its own address" data-testid="link-opp-paging">{fmtNum(from + 1)}–{fmtNum(Math.min(total, from + PER_PAGE))} of {fmtNum(total)}</Link> · paging is free</span>
            </div>
          )}
          <p className="g-text-2 mt-2 text-[12px]">Positions and visits are estimates from the keyword database for {market.label}, not live checks; track a keyword to have it checked every week. The data keeps one page per search, so it cannot show two of your pages competing for the same one, nor prove that no other page ranks.</p>
        </>
      )}
    </div>
  );
}
