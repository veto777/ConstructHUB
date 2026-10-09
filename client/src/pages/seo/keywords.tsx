/**
 * /seo/keywords — Keywords Explorer. Type a keyword: its monthly search volume
 * with the trend over the years, difficulty, cost per click, intent, who ranks
 * for it today and how strong those sites are; then the ideas around it —
 * matching terms, related terms and questions — filterable, sortable, paged,
 * exportable, and trackable on one of your sites.
 * The overview is one lookup (free to reopen for a week); each page of an idea
 * list is one lookup (free to reopen for a day). See server/seo/reports.ts.
 */
import { ServicePlanner } from "./planner";
import { useEffect, useRef, useState } from "react";
import { holdNote, isNotRunYet, refreshSeoData } from "./shell";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Plus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiErrorMessage } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { api, canAfford, Empty, fmtDate, fmtNum, money, SeoShell, useSelectedSite, useSeoSites, useSeoStatus } from "./shell";
import { ReportView, type TableKey } from "./report-table";
import { AddToList, BulkKeywords, KeywordLists } from "./keyword-lists";
import { MarketPicker, useMarket } from "./market";
import { findMarket, marketKey, type SeoMarket } from "@shared/seo-markets";
import { GradientSpark, MetricColumn, monthLabel, PALETTE } from "./viz";
import { BarFigure, Card, FeatureTag, Heading, KdBadge, MetricRow, MonthlyBars } from "./viz-keywords";

type Overview = {
  missing?: string[];
  keyword: string; fetchedAt: string;
  volume: number | null; cpc: number | null; difficulty: number | null; intent: string | null; competition: string | null;
  bidLow: number | null; bidHigh: number | null; results: number | null;
  trend: { month: string; volume: number }[];
  features: string[];
  topAvg: { authority: number | null; backlinks: number | null; referringDomains: number | null };
  serp: { position: number; domain: string; url: string; title: string | null; authority: number | null }[];
  potential?: { url: string; traffic: number | null; keywords: number | null; parentTopic: string | null; parentVolume: number | null } | null;
};

const IDEAS: [TableKey, string][] = [["matchingTerms", "Matching terms"], ["relatedTerms", "Related terms"], ["questions", "Questions"]];
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const FEATURE: Record<string, string> = {
  local_pack: "Map pack", people_also_ask: "People also ask", featured_snippet: "Featured snippet", images: "Images", video: "Videos", paid: "Ads",
  related_searches: "Related searches", people_also_search: "People also search", knowledge_graph: "Knowledge panel", shopping: "Shopping", top_stories: "Top stories", ai_overview: "AI overview",
};

export default function SeoKeywordsPage() {
  const status = useSeoStatus();
  const sites = useSeoSites();
  const [site, onSite] = useSelectedSite(sites.data);
  const qc = useQueryClient();
  const { toast } = useToast();
  const initial = new URLSearchParams(window.location.search).get("keyword") ?? "";
  const [input, setInput] = useState(initial);
  const [keyword, setKeyword] = useState<string | null>(initial || null);
  const [ideas, setIdeas] = useState<TableKey>("matchingTerms");
  const [overview, setOverview] = useState<Overview | null>(null);
  const [mode, setMode] = useState<"one" | "bulk" | "lists" | "area">(() => { const v = new URLSearchParams(window.location.search).get("view"); return v === "bulk" || v === "lists" || v === "area" ? v : "one"; });
  /** Keywords handed to the bulk analysis from a list. */
  const [bulkSeed, setBulkSeed] = useState("");
  const [market, setMarket] = useMarket();
  const mk = { locationCode: market.locationCode, languageCode: market.languageCode };
  /** Another country is another lookup: what is on screen is put away first. */
  const changeMarket = (m: SeoMarket) => { if (marketKey(m) === marketKey(market)) return; setOverview(null); setMarket(m); };
  /** The country on screen right now, for answers that arrive later. */
  const marketNow = useRef(marketKey(market));
  marketNow.current = marketKey(market);
  const unsaved = (d: { saved?: boolean }) => { if (d.saved === false) toast({ title: "Shown, but it couldn't be kept", description: "Opening this keyword again will not be free.", variant: "destructive" }); };
  /** Numbers from another country are not the site's numbers: the keyword is tracked without them. `m` is where the numbers came from (a list has its own country). */
  const inSiteMarket = (m: { locationCode: number; languageCode: string }) => !!site && site.locationCode === m.locationCode && site.languageCode === m.languageCode;

  // A keyword looked up in the last week opens without spending.
  const saved = useQuery<{ overview: Overview } | null>({
    queryKey: ["/api/seo/keyword", keyword, marketKey(market)], enabled: !!keyword && !overview, retry: false,
    queryFn: async () => { try { return await api("POST", "/api/seo/keyword", { keyword, peek: true, ...mk }); } catch (e) { if (isNotRunYet(e)) return null; throw e; } },
  });
  useEffect(() => { if (saved.data?.overview && !overview) setOverview(saved.data.overview); }, [saved.data, overview]);

  const lookup = useMutation({
    mutationFn: (v: { keyword: string; market: string; body: typeof mk }) => api("POST", "/api/seo/keyword", { keyword: v.keyword, ...v.body }),
    onSuccess: (data: { overview: Overview; saved?: boolean }, v) => {
      void qc.invalidateQueries({ queryKey: ["/api/seo/status"] });
      if (v.market !== marketNow.current) return; // the country was changed while it ran: it is saved, and is not shown under another country
      unsaved(data);
      setOverview(data.overview); setKeyword(data.overview.keyword); setInput(data.overview.keyword);
      window.history.replaceState({}, "", `/seo/keywords?keyword=${encodeURIComponent(data.overview.keyword)}`);
      void qc.invalidateQueries({ queryKey: ["/api/seo/status"] });
    },
    onError: (e) => toast({ title: "Couldn't look that keyword up", description: apiErrorMessage(e), variant: "destructive" }),
  });
  const refresh = useMutation({
    mutationFn: (v: { keyword: string; market: string; body: typeof mk }) => api("POST", "/api/seo/keyword", { keyword: v.keyword, refresh: true, ...v.body }),
    // Only if that keyword in that country is still what is on screen: a refresh that lands after something else was opened is not shown over it.
    onSuccess: (data: { overview: Overview; saved?: boolean }, v) => {
      void qc.invalidateQueries({ queryKey: ["/api/seo/status"] });
      if (v.market !== marketNow.current) return;
      unsaved(data);
      setOverview((cur) => (cur && cur.keyword === data.overview.keyword ? data.overview : cur));
    },
    onError: (e) => toast({ title: "Couldn't refresh that keyword", description: apiErrorMessage(e), variant: "destructive" }),
  });
  const track = useMutation({
    // Five hundred at a time (the most one request takes), one after another; what was added is counted across them.
    // If one fails part-way, the ones before it stay tracked and the error says how many that was.
    mutationFn: async (v: { rows: { keyword: string; volume: number | null; cpc: number | null; difficulty: number | null }[]; from: SeoMarket }) => {
      let added = 0;
      for (let i = 0; i < v.rows.length; i += 500) {
        const part = v.rows.slice(i, i + 500);
        try {
          const r: { added: number } = await api("POST", `/api/seo/sites/${site!.id}/keywords`, { keywords: part.map((x) => x.keyword), ...(inSiteMarket(v.from) ? { volumes: part.map((x) => ({ keyword: x.keyword, searchVolume: x.volume, cpc: x.cpc, difficulty: x.difficulty })) } : {}) });
          added += r.added;
        } catch (e) {
          if (i === 0) throw e;
          refreshSeoData(qc);
          throw new Error(`${added} keyword${added === 1 ? " was" : "s were"} added, then it stopped: ${apiErrorMessage(e)} The first ${i} of the ${v.rows.length} you chose were sent; choose the rest again.`);
        }
      }
      return { added };
    },
    onSuccess: (r: { added: number }, v) => { refreshSeoData(qc); toast({ title: `${r.added} keyword${r.added === 1 ? "" : "s"} now tracked on ${site?.domain}`, description: inSiteMarket(v.from) ? undefined : `Those numbers are for ${v.from.label}, not the country this site is tracked in, so they were not copied. Use "Get search volumes" in the rank tracker.` }); },
    onError: (e) => toast({ title: "Couldn't track", description: apiErrorMessage(e), variant: "destructive" }),
  });

  const submit = () => { const k = input.trim(); if (!k) return; setOverview(null); setKeyword(k.toLowerCase()); lookup.mutate({ keyword: k, market: marketKey(market), body: mk }); };
  /** From a list or a bulk analysis: open one keyword's overview (the saved copy if there is one; nothing is bought). */
  /** A keyword from a list opens in the list's own country. */
  const openKeyword = (k: string, from?: SeoMarket) => { if (from && marketKey(from) !== marketKey(market)) setMarket(from); setMode("one"); setInput(k); setOverview(null); setKeyword(k.toLowerCase()); };
  const configured = !!status.data?.configured;
  const affordable = canAfford(status.data, "keywordOverview");
  const price = status.data?.prices ? money(status.data.prices.keywordOverview) : "";
  const busy = lookup.isPending || (saved.isLoading && !!keyword && !overview);
  const o = overview;
  const peak = o && o.trend.length ? o.trend.reduce((a, b) => (b.volume > a.volume ? b : a)) : null;
  /** The months as chart points, oldest first (the source gives them that way). */
  const trend = (o?.trend ?? []).map((t) => ({ label: monthLabel(t.month), value: t.volume }));

  return (
    <SeoShell title="Keywords explorer" description="How often people search for something, how hard it is to rank for, who ranked for it when it was last looked up, and the keywords around it." site={site} onSite={onSite} sites={sites} status={status}>
      <nav className="g-tabs" aria-label="Keywords explorer views">
        {([["one", "One keyword"], ["bulk", "Many keywords"], ["area", "Service × town"], ["lists", "My lists"]] as const).map(([m, label]) => <a key={m} href={`#${m}`} aria-current={mode === m ? "page" : undefined} onClick={(e) => { e.preventDefault(); setMode(m); }} data-testid={`tab-keywords-${m}`}>{label}</a>)}
      </nav>
      {mode === "bulk" && <BulkKeywords key={bulkSeed} market={market} onMarket={changeMarket} initial={bulkSeed} status={status.data} site={site} onTrack={site ? (rows) => track.mutate({ rows, from: market }) : undefined} onOpen={(k) => openKeyword(k)} />}
      {mode === "area" && <ServicePlanner site={site} status={status.data} onTrack={site ? (rows) => track.mutate({ rows, from: findMarket(site.locationCode, site.languageCode) ?? market }) : undefined} />}
      {mode === "lists" && <KeywordLists status={status.data} site={site} onTrack={site ? (rows, from) => track.mutate({ rows, from }) : undefined} onOpen={openKeyword} />}
      {mode === "one" && (<>
      <form className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center" onSubmit={(e) => { e.preventDefault(); submit(); }} data-testid="form-keyword">
        <label className="relative min-w-0 flex-1 sm:max-w-xl">
          <span className="sr-only">Keyword</span>
          <Search className="g-text-2 pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2" aria-hidden />
          <input className="g-input w-full pl-9" placeholder="e.g. siding contractor" value={input} onChange={(e) => setInput(e.target.value)} data-testid="input-keyword" autoComplete="off" />
        </label>
        <MarketPicker value={market} onChange={changeMarket} disabled={lookup.isPending || refresh.isPending} />
        <Button type="submit" disabled={busy || !input.trim() || !configured || !affordable} data-testid="button-keyword-lookup">
          {lookup.isPending ? <><Loader2 className="mr-1 h-4 w-4 animate-spin" /> Looking up…</> : "Look up"}
        </Button>
      </form>
      <p className="g-text-2 mb-4 text-[13px]" data-testid="text-keyword-cost">
        A keyword's overview costs about {price} of your SEO data and is free to reopen for a week.{holdNote(status.data, "keywordOverview")} {market.label}, Google.{!affordable && " You don't have enough SEO data left — add credit above."}
      </p>
      {busy && <p className="g-text-2 flex items-center gap-2 text-[14px]" role="status"><Loader2 className="h-4 w-4 animate-spin" /> {lookup.isPending ? "Getting volume, difficulty and the top results…" : "Opening the saved overview…"}</p>}
      {!o && !busy && !keyword && <Empty testId="keywords-intro"><h3>Research any keyword</h3><p>Enter a search term to see its monthly volume over time, how hard it is to rank for, what an ad click costs, who held the top ten when it was looked up — and hundreds of related searches you can track.</p></Empty>}
      {!o && !busy && keyword && saved.isError && <div className="g-callout" role="alert" data-testid="keywords-saved-error"><h3>Couldn't check for a saved overview</h3><p>{apiErrorMessage(saved.error)}</p><button type="button" className="g-pill mt-2" onClick={() => void saved.refetch()}>Try again</button></div>}
      {!o && !busy && keyword && !saved.isError && <Empty testId="keywords-not-found"><h3>No overview for "{keyword}" yet</h3><p>Press <b>Look up</b> to get it.</p></Empty>}

      {o && (
        <div data-testid="keyword-overview">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <h2 className="text-[20px] font-medium [overflow-wrap:anywhere]" style={{ color: "var(--g-blue)" }}>"{o.keyword}"</h2>
            <span className="g-text-2 text-[12px]">as of {fmtDate(o.fetchedAt)}</span>
            <button type="button" className="g-pill g-pill--sm" disabled={refresh.isPending || !configured || !affordable} onClick={() => refresh.mutate({ keyword: o.keyword, market: marketKey(market), body: mk })} title={`Looks it up again — about ${price}`} data-testid="button-keyword-refresh">{refresh.isPending ? <Loader2 className="animate-spin" /> : null} Refresh · {price}</button>
            <span className="ml-auto"><AddToList market={market} rows={[{ keyword: o.keyword, volume: o.volume, cpc: o.cpc, difficulty: o.difficulty, intent: o.intent }]} label="Save to a list" /></span>
            {site && <button type="button" className="g-pill g-pill--sm" disabled={track.isPending} onClick={() => track.mutate({ rows: [{ keyword: o.keyword, volume: o.volume, cpc: o.cpc, difficulty: o.difficulty }], from: market })} data-testid="button-track-keyword"><Plus /> Track on {site.domain}</button>}
          </div>
          {/* The figures in one row, as Ahrefs lays a keyword out: volume with its trend, the difficulty badge, cost, intent, and what the #1 page gets. */}
          <Card className="mb-4" testId="keyword-metrics">
            <MetricRow cols={o.potential !== undefined ? 6 : 4}>
              <MetricColumn label="Search volume" value={fmtNum(o.volume)} foot={peak ? `Peak ${fmtNum(peak.volume)} in ${monthLabel(peak.month)}` : "per month"}
                chart={<GradientSpark range height={44} points={trend} color={PALETTE.keywords} format={fmtNum} />} />
              <MetricColumn label="Difficulty" value={<KdBadge value={o.difficulty} size="lg" />} foot={o.topAvg.referringDomains != null ? `Top pages average ${fmtNum(o.topAvg.referringDomains)} referring domains` : "0–100"} />
              <MetricColumn label="Cost per click" value={o.cpc == null ? "—" : `$${o.cpc.toFixed(2)}`} foot={o.bidLow != null && o.bidHigh != null ? `Top-of-page bids $${o.bidLow.toFixed(2)}–$${o.bidHigh.toFixed(2)}` : o.competition ? `${cap(o.competition.toLowerCase())} ad competition` : undefined} />
              <MetricColumn label="Intent" value={o.intent ? <span className="text-[20px]">{cap(o.intent)}</span> : "—"} foot={o.results != null ? `${fmtNum(o.results)} results` : undefined} />
              {o.potential !== undefined && <MetricColumn label="Traffic potential" value={o.potential ? fmtNum(o.potential.traffic) : "—"} foot={o.potential ? (o.potential.keywords === 1 ? `Estimated visits a month the #1 page gets from search in ${market.label} — it ranks for one keyword` : o.potential.keywords == null ? `Estimated visits a month the #1 page gets from search in ${market.label}` : `Estimated visits a month the #1 page gets in ${market.label} from all ${fmtNum(o.potential.keywords)} keywords it ranks for`) : (o.missing ?? []).includes("potential") ? "Didn't load this time (not charged)" : "Not available for this keyword"} />}
              {o.potential !== undefined && <MetricColumn label="Parent topic" value={o.potential?.parentTopic ? (o.potential.parentTopic === o.keyword ? <span className="text-[17px] leading-snug" data-testid="text-parent-topic">This keyword</span> : <button type="button" className="g-link block text-left text-[17px] leading-snug [overflow-wrap:anywhere]" onClick={() => { const k = o.potential!.parentTopic!; setInput(k); setOverview(null); setKeyword(k); }} data-testid="button-parent-topic">{o.potential.parentTopic}</button>) : "—"} foot={o.potential?.parentTopic ? `The search that sends the #1 page the most visits${o.potential.parentVolume != null ? ` — ${fmtNum(o.potential.parentVolume)} searches a month` : ""}` : undefined} />}
            </MetricRow>
          </Card>
          {o.potential === undefined && <p className="g-text-2 -mt-2 mb-4 text-[13px]" data-testid="text-potential-older">Traffic potential and parent topic were added after this overview was saved — Refresh to see them.</p>}
          <div className="mb-4 grid gap-4 lg:grid-cols-3">
            <Card className="lg:col-span-2" testId="panel-keyword-trend">
              <Heading className="mb-2">Search volume by month</Heading>
              {o.trend.length > 1 ? <MonthlyBars points={trend} color={PALETTE.keywords} height={220} /> : <p className="g-text-2 text-[13px]">No monthly history for this keyword.</p>}
            </Card>
            <Card testId="panel-keyword-features">
              <Heading className="mb-2">On the results page</Heading>
              {o.features.length ? <div className="flex flex-wrap gap-1.5">{o.features.map((f) => <FeatureTag key={f} feature={f} label={FEATURE[f] ?? cap(f.replace(/_/g, " "))} />)}</div> : <p className="g-text-2 text-[13px]">Plain results only.</p>}
              <p className="g-text-2 mt-3 text-[12px]">{o.features.includes("local_pack") ? "The saved results had a map pack, so a strong Google Business Profile matters as much as the website." : "No map pack in the saved results, so the website is what competes here."}</p>
            </Card>
          </div>
          <section className="mb-5" data-testid="panel-keyword-serp">
            <Heading className="mb-2" note={`Google's top results as saved on ${fmtDate(o.fetchedAt)} (desktop)`}>Who ranks</Heading>
            {(o.missing?.length ?? 0) > 0 && <p className="g-text-2 mb-2 text-[13px]" role="status" data-testid="text-keyword-missing">{[o.missing!.includes("results") ? "The top results" : null, o.missing!.includes("authority") ? "Site authority" : null, o.missing!.includes("potential") ? "Traffic potential and parent topic" : null].filter(Boolean).join(", ").replace(/, ([^,]*)$/, " and $1") || "Part of this overview"} didn't load this time; you were not charged for that part. Refresh looks the whole keyword up again.</p>}
            {o.serp.length ? (
              <div className="overflow-x-auto">
              <table className="g-table">
                <thead><tr><th className="num w-10">#</th><th>Page</th><th className="num">Site authority</th><th></th></tr></thead>
                <tbody>{o.serp.map((s) => (
                  <tr key={`${s.position}-${s.url}`}>
                    <td className="num">{s.position}</td>
                    <td className="min-w-0"><a href={s.url} className="g-link" target="_blank" rel="noreferrer">{s.title ?? s.domain}</a><span className="g-text-2 block max-w-[520px] truncate text-[12px]">{s.url.replace(/^https?:\/\/(www\.)?/, "")}</span></td>
                    <td className="num" data-label="Site authority"><BarFigure value={s.authority} max={100} color={PALETTE.authority} format={String} title="Link strength of the site, 0–100" /></td>
                    <td className="num"><a className="g-link" href={`/seo/explorer?domain=${encodeURIComponent(s.domain)}`} data-testid={`link-explore-${s.position}`}>Explore site</a></td>
                  </tr>
                ))}</tbody>
              </table>
              </div>
            ) : <p className="g-text-2 text-[13px]">The top results weren't available for this keyword.</p>}
          </section>

          <Heading className="mb-2">Keyword ideas</Heading>
          <nav className="g-tabs" aria-label="Keyword ideas">
            {IDEAS.map(([k, label]) => <a key={k} href={`#${k}`} aria-current={ideas === k ? "page" : undefined} onClick={(e) => { e.preventDefault(); setIdeas(k); }} data-testid={`tab-ideas-${k}`}>{label}</a>)}
          </nav>
          <ReportView key={`${ideas}:${o.keyword}:${marketKey(market)}`} market={market} table={ideas} keyword={o.keyword} status={status.data} extraAction={(rows, clear) => <AddToList market={market} rows={rows} onDone={clear} />} onTrack={site ? (rows) => track.mutateAsync({ rows, from: market }) : undefined} trackLabel={site ? `Track on ${site.domain}` : undefined} />
          {!site && <p className="g-text-2 mt-2 text-[13px]">Add a site above to track keywords from these lists.</p>}
        </div>
      )}
      </>)}
    </SeoShell>
  );
}
