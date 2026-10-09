/**
 * /seo/keywords — Keywords Explorer. Type a keyword: its monthly search volume
 * with the trend over the years, difficulty, cost per click, intent, who ranks
 * for it today and how strong those sites are; then the ideas around it —
 * matching terms, related terms and questions — filterable, sortable, paged,
 * exportable, and trackable on one of your sites.
 * The overview is one lookup (free to reopen for a week); each page of an idea
 * list is one lookup (free to reopen for a day). See server/seo/reports.ts.
 *
 * The address is the state (links.ts): `keyword`, `view`, `table`, `locationCode` + `languageCode`, `section`,
 * `month`, `intent`, `list`, `topic` and `show` are read from it, every tab and figure is a link that writes it, and
 * what narrowed the view is shown in a chip (data-testid="active-filter") with a clear control. The ideas tables
 * are `linked`: their filter boxes read the address and write it back. Arriving by link never buys: the saved
 * overview opens, or the Look up button waits.
 */
import { ServicePlanner } from "./planner";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useLocation, useSearch } from "wouter";
import { ActiveFilter, holdNote, isNotRunYet, refreshSeoData } from "./shell";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Plus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiErrorMessage } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { api, canAfford, Empty, fmtDate, fmtNum, money, SeoShell, useSelectedSite, useSeoSites, useSeoStatus } from "./shell";
import { ReportView, type TableKey } from "./report-table";
import { INTENTS } from "./explorer-filters";
import { AddToList, BulkKeywords, KeywordLists } from "./keyword-lists";
import { MarketPicker, useMarket } from "./market";
import { DEFAULT_MARKET, findMarket, marketKey, SEO_MARKETS, type SeoMarket } from "@shared/seo-markets";
import { GradientSpark, MetricColumn, monthLabel, PALETTE } from "./viz";
import { BarFigure, BLOCK_LINK, Card, FeatureTag, FIG_LINK, Heading, KdBadge, LINK_CUE, MetricRow, MonthlyBars, TEXT_LINK } from "./viz-keywords";
import { seoLinks, setParam } from "./links";
import { marketParams, useTrackedKeywords } from "./keyword-links";

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
/** The ideas tables with an Intent filter box (explorer-filters.ts HAS.intent): the only ones `intent` can narrow. */
const INTENT_TABLES: readonly TableKey[] = ["matchingTerms", "questions"];
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const FEATURE: Record<string, string> = {
  local_pack: "Map pack", people_also_ask: "People also ask", featured_snippet: "Featured snippet", images: "Images", video: "Videos", paid: "Ads",
  related_searches: "Related searches", people_also_search: "People also search", knowledge_graph: "Knowledge panel", shopping: "Shopping", top_stories: "Top stories", ai_overview: "AI overview",
};
type Mode = "one" | "bulk" | "lists" | "area";
type Section = "volume" | "serp" | "features" | "ideas" | "cpc" | "results";
const SECTIONS: readonly Section[] = ["volume", "serp", "features", "ideas", "cpc", "results"];
/** Which part of the overview a section lands on (the element ids below). */
const SECTION_ID: Record<Section, string> = { volume: "keyword-trend", serp: "keyword-serp", features: "keyword-features", ideas: "keyword-ideas", cpc: "keyword-serp", results: "keyword-serp" };
/** Every parameter the page honours, as read from the address. */
type Address = { keyword: string; view?: Mode; table?: string; locationCode?: number; languageCode?: string; section?: Section; month?: string; intent?: string; list?: number; topic?: string; show?: "gaps" | "weak" | "strong" | "unknown" };
const SHOWS = ["gaps", "weak", "strong", "unknown"] as const;
/** A pill-sized link or button that is 44 px tall on a phone. */
const PILL = "g-pill g-pill--sm !min-h-11";

export default function SeoKeywordsPage() {
  const status = useSeoStatus();
  const sites = useSeoSites();
  const [site, onSite] = useSelectedSite(sites.data);
  const qc = useQueryClient();
  const { toast } = useToast();
  const [, navigate] = useLocation();
  // The address, read fresh whenever it changes (a link, a tab, a chip's clear, the back button).
  const search = useSearch();
  const address = useMemo((): Address => {
    const p = new URLSearchParams(search);
    const view = p.get("view"), table = p.get("table"), section = p.get("section"), month = p.get("month"), intent = p.get("intent"), topic = p.get("topic"), show = p.get("show");
    return {
      keyword: p.get("keyword") ?? "",
      view: view === "bulk" || view === "lists" || view === "area" ? view : undefined,
      table: table === "relatedTerms" || table === "questions" ? table : table === "matchingTerms" ? table : undefined,
      locationCode: Number(p.get("locationCode")) || undefined, languageCode: p.get("languageCode") || undefined,
      section: SECTIONS.find((s) => s === section), month: month && /^\d{4}-\d{2}$/.test(month) ? month : undefined,
      intent: (INTENTS as readonly string[]).includes(intent ?? "") ? intent! : undefined, list: Number(p.get("list")) || undefined,
      topic: topic?.trim() || undefined, show: SHOWS.find((s) => s === show),
    };
  }, [search]);
  const mode: Mode = address.view ?? "one";
  const ideas: TableKey = (address.table as TableKey | undefined) ?? "matchingTerms";
  /** The address with some parameters changed: what a link on this page points at. */
  const addr = (patch: Partial<Address>) => { const { keyword: k, ...rest } = { ...address, ...patch }; return seoLinks.keywords(k, rest); };
  const go = (patch: Partial<Address>, replace = false) => navigate(addr(patch), { replace });

  const [input, setInput] = useState(address.keyword);
  const [keyword, setKeyword] = useState<string | null>(address.keyword || null);
  const [overview, setOverview] = useState<Overview | null>(null);
  /** Keywords handed to the bulk analysis from a list. */
  const [bulkSeed] = useState("");
  const [market, setMarket] = useMarket();
  const mk = { locationCode: market.locationCode, languageCode: market.languageCode };
  /** Another country is another lookup: what is on screen is put away first. */
  const changeMarket = (m: SeoMarket) => { if (marketKey(m) === marketKey(market)) return; setOverview(null); setMarket(m); };
  /** The country picker, on any view: the country is chosen, and the address says so (a link and a pick are one thing). */
  const pickMarket = (m: SeoMarket) => { changeMarket(m); go({ locationCode: m.locationCode, languageCode: m.languageCode }); };
  /** The country on screen right now, for answers that arrive later. */
  const marketNow = useRef(marketKey(market));
  marketNow.current = marketKey(market);
  const unsaved = (d: { saved?: boolean }) => { if (d.saved === false) toast({ title: "Shown, but it couldn't be kept", description: "Opening this keyword again will not be free.", variant: "destructive" }); };
  /** Numbers from another country are not the site's numbers: the keyword is tracked without them. `m` is where the numbers came from (a list has its own country). */
  const inSiteMarket = (m: { locationCode: number; languageCode: string }) => !!site && site.locationCode === m.locationCode && site.languageCode === m.languageCode;
  const tracked = useTrackedKeywords(site);

  // The keyword in the address is the keyword on screen: a link to another keyword (an idea, a list row, the parent
  // topic) opens its saved overview or the Look up button — never a purchase. The first address is the initial state.
  const seenKeyword = useRef<string | undefined>(undefined);
  useEffect(() => {
    const k = address.keyword;
    if (seenKeyword.current === undefined) { seenKeyword.current = k; return; }
    if (seenKeyword.current === k) return;
    seenKeyword.current = k;
    if (k.toLowerCase() === (keyword ?? "").toLowerCase()) return;
    setInput(k); setOverview(null); setKeyword(k ? k.toLowerCase() : null);
  }, [address.keyword]); // eslint-disable-line react-hooks/exhaustive-deps
  // The country in the address is the country looked at (a list's keyword opens in the list's country).
  useEffect(() => {
    if (!address.locationCode) return;
    const m = findMarket(address.locationCode, address.languageCode ?? market.languageCode) ?? findMarket(address.locationCode, "en") ?? SEO_MARKETS.find((x) => x.locationCode === address.locationCode) ?? null;
    if (m && marketKey(m) !== marketKey(market)) changeMarket(m);
  }, [address.locationCode, address.languageCode]); // eslint-disable-line react-hooks/exhaustive-deps

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
      setParam("keyword", data.overview.keyword, true);
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

  /** Look a keyword up: the address says which keyword first (so the back button returns to the one before), then it is bought. */
  const submit = () => { const k = input.trim(); if (!k) return; setOverview(null); setKeyword(k.toLowerCase()); go({ keyword: k.toLowerCase(), section: undefined, month: undefined, table: undefined, intent: undefined }); lookup.mutate({ keyword: k, market: marketKey(market), body: mk }); };
  const configured = !!status.data?.configured;
  const affordable = canAfford(status.data, "keywordOverview");
  const price = status.data?.prices ? money(status.data.prices.keywordOverview) : "";
  const busy = lookup.isPending || (saved.isLoading && !!keyword && !overview);
  const o = overview;
  const peak = o && o.trend.length ? o.trend.reduce((a, b) => (b.volume > a.volume ? b : a)) : null;
  /** The months as chart points, oldest first (the source gives them that way). */
  const trend = (o?.trend ?? []).map((t) => ({ label: monthLabel(t.month), value: t.volume }));
  const isTracked = !!o && tracked.has(o.keyword.toLowerCase());
  /** The month a link pointed at, as the chart labels it. */
  const monthAt = address.month ? o?.trend.find((t) => t.month === address.month) ?? null : null;
  /** The intent in the address narrows only a table that has an Intent box. */
  const intentOn = address.intent && INTENT_TABLES.includes(ideas) ? address.intent : undefined;

  // Arriving at a part of the overview (a section, a month, or an ideas table) scrolls to it once it is on screen.
  const scrolledTo = useRef<string | null>(null);
  useEffect(() => {
    const target: Section | undefined = address.section ?? (address.month ? "volume" : address.table ? "ideas" : undefined);
    if (!o || !target || mode !== "one") { scrolledTo.current = null; return; }
    const key = `${o.keyword}:${target}:${address.table ?? ""}:${address.month ?? ""}`;
    if (scrolledTo.current === key) return;
    scrolledTo.current = key;
    document.getElementById(SECTION_ID[target])?.scrollIntoView({ block: "start", behavior: "smooth" });
  }, [o, address.section, address.table, address.month, mode]);

  /** What narrowed the view, in words, each with its clear. */
  const chips: { key: string; words: ReactNode; clear: () => void; label?: string }[] = [];
  if (mode === "one") {
    if (address.locationCode) chips.push({ key: "market", words: `Looked up in ${market.label}`, label: "Back to the United States", clear: () => { changeMarket(DEFAULT_MARKET); go({ locationCode: undefined, languageCode: undefined }); } });
    if (address.section && o) {
      const q = `"${o.keyword}"`;
      const words: Record<Section, string> = {
        volume: `Search volume by month for ${q}`, serp: `Who ranks for ${q}`, features: `What the results page for ${q} showed`, ideas: `Keyword ideas around ${q}`,
        cpc: `Cost per click ${o.cpc == null ? "" : `$${o.cpc.toFixed(2)} `}has no view of its own — this is who ranks for ${q}`, results: `${fmtNum(o.results)} results on Google — the top ten as saved`,
      };
      chips.push({ key: "section", words: words[address.section], clear: () => go({ section: undefined, month: undefined }) });
    }
    if (address.month && o) chips.push({ key: "month", words: monthAt ? `${fmtNum(monthAt.volume)} searches in ${monthLabel(address.month)}` : `No figure for ${monthLabel(address.month)}`, clear: () => go({ month: undefined }) });
    if (address.table && address.table !== "matchingTerms" && o) chips.push({ key: "table", words: `Keyword ideas: ${IDEAS.find(([k]) => k === address.table)?.[1] ?? address.table}`, clear: () => go({ table: undefined, intent: undefined }) });
    if (intentOn && o) chips.push({ key: "intent", words: `${IDEAS.find(([k]) => k === ideas)?.[1] ?? "Ideas"} with ${intentOn} intent`, clear: () => go({ intent: undefined }) });
  }

  return (
    <SeoShell title="Keywords explorer" description="How often people search for something, how hard it is to rank for, who ranked for it when it was last looked up, and the keywords around it." site={site} onSite={onSite} sites={sites} status={status}>
      <nav className="g-tabs" aria-label="Keywords explorer views">
        {([["one", "One keyword"], ["bulk", "Many keywords"], ["area", "Service × town"], ["lists", "My lists"]] as const).map(([m, label]) => <Link key={m} href={seoLinks.keywords(keyword ?? "", { view: m === "one" ? undefined : m })} aria-current={mode === m ? "page" : undefined} data-testid={`tab-keywords-${m}`}>{label}</Link>)}
      </nav>
      {mode === "bulk" && <BulkKeywords key={bulkSeed} market={market} onMarket={pickMarket} initial={bulkSeed} status={status.data} site={site} onTrack={site ? (rows) => track.mutate({ rows, from: market }) : undefined} />}
      {mode === "area" && <ServicePlanner site={site} status={status.data} onTrack={site ? (rows) => track.mutate({ rows, from: findMarket(site.locationCode, site.languageCode) ?? market }) : undefined} />}
      {mode === "lists" && <KeywordLists status={status.data} site={site} onTrack={site ? (rows, from) => track.mutate({ rows, from }) : undefined} />}
      {mode === "one" && (<>
      <form className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center" onSubmit={(e) => { e.preventDefault(); submit(); }} data-testid="form-keyword">
        <label className="relative min-w-0 flex-1 sm:max-w-xl">
          <span className="sr-only">Keyword</span>
          <Search className="g-text-2 pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2" aria-hidden />
          <input className="g-input w-full pl-9" placeholder="e.g. siding contractor" value={input} onChange={(e) => setInput(e.target.value)} data-testid="input-keyword" autoComplete="off" />
        </label>
        <MarketPicker value={market} onChange={pickMarket} disabled={lookup.isPending || refresh.isPending} />
        <Button type="submit" disabled={busy || !input.trim() || !configured || !affordable} data-testid="button-keyword-lookup">
          {lookup.isPending ? <><Loader2 className="mr-1 h-4 w-4 animate-spin" /> Looking up…</> : "Look up"}
        </Button>
      </form>
      <p className="g-text-2 mb-4 text-[13px]" data-testid="text-keyword-cost">
        A keyword's overview costs about <Link href={seoLinks.usage()} className={TEXT_LINK} title="Usage and credit: what lookups cost and what is left this month" data-testid="link-keyword-price">{price}</Link> of your SEO data and is free to reopen for a week.{holdNote(status.data, "keywordOverview")} {market.label}, Google.{!affordable && " You don't have enough SEO data left — add credit above."}
      </p>
      {chips.length > 0 && <div data-testid="keyword-filters">{chips.map((c) => <ActiveFilter key={c.key} onClear={c.clear} clearLabel={c.label}>{c.words}</ActiveFilter>)}</div>}
      {busy && <p className="g-text-2 flex items-center gap-2 text-[14px]" role="status"><Loader2 className="h-4 w-4 animate-spin" /> {lookup.isPending ? "Getting volume, difficulty and the top results…" : "Opening the saved overview…"}</p>}
      {!o && !busy && !keyword && <Empty testId="keywords-intro"><h3>Research any keyword</h3><p>Enter a search term to see its monthly volume over time, how hard it is to rank for, what an ad click costs, who held the top ten when it was looked up — and hundreds of related searches you can track.</p></Empty>}
      {!o && !busy && keyword && saved.isError && <div className="g-callout" role="alert" data-testid="keywords-saved-error"><h3>Couldn't check for a saved overview</h3><p>{apiErrorMessage(saved.error)}</p><button type="button" className="g-pill mt-2" onClick={() => void saved.refetch()}>Try again</button></div>}
      {!o && !busy && keyword && !saved.isError && <Empty testId="keywords-not-found"><h3>No overview for "{keyword}" yet</h3><p>Press <b>Look up</b> to get it.</p></Empty>}

      {o && (
        <div data-testid="keyword-overview">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <h2 className="text-[20px] font-medium [overflow-wrap:anywhere]" style={{ color: "var(--g-blue)" }}>"{o.keyword}"</h2>
            <Link href={seoLinks.usage({ month: o.fetchedAt.slice(0, 7) })} className={`${TEXT_LINK} text-[12px]`} title="When this overview was looked up — that month's lookups on the Usage page" data-testid="link-keyword-as-of">as of {fmtDate(o.fetchedAt)}</Link>
            <button type="button" className={PILL} disabled={refresh.isPending || !configured || !affordable} onClick={() => refresh.mutate({ keyword: o.keyword, market: marketKey(market), body: mk })} title={`Looks it up again — about ${price}`} data-testid="button-keyword-refresh">{refresh.isPending ? <Loader2 className="animate-spin" /> : null} Refresh · {price}</button>
            <span className="ml-auto"><AddToList market={market} rows={[{ keyword: o.keyword, volume: o.volume, cpc: o.cpc, difficulty: o.difficulty, intent: o.intent }]} label="Save to a list" /></span>
            {site && <button type="button" className={PILL} disabled={track.isPending} onClick={() => track.mutate({ rows: [{ keyword: o.keyword, volume: o.volume, cpc: o.cpc, difficulty: o.difficulty }], from: market })} data-testid="button-track-keyword"><Plus /> Track on {site.domain}</button>}
            {site && isTracked && <Link href={seoLinks.rankTracker(site.id, { keyword: o.keyword })} className={`${PILL} ${LINK_CUE}`} title={`Already tracked on ${site.domain} — its checks in the rank tracker`} data-testid="link-tracked-keyword">In the rank tracker</Link>}
          </div>
          {/* The figures in one row, as Ahrefs lays a keyword out: volume with its trend, the difficulty badge, cost, intent, and what the #1 page gets. Each figure is a link to the part of the page that holds it (links.ts). */}
          <Card className="mb-4" testId="keyword-metrics">
            <MetricRow cols={o.potential !== undefined ? 6 : 4}>
              <MetricColumn label="Search volume" value={<Link href={addr({ section: "volume", month: undefined })} className={FIG_LINK} title="The monthly chart" data-testid="link-volume">{fmtNum(o.volume)}</Link>}
                foot={peak ? <Link href={addr({ section: "volume", month: peak.month })} className={TEXT_LINK} data-testid="link-volume-peak">Peak {fmtNum(peak.volume)} in {monthLabel(peak.month)}</Link> : "per month"}
                chart={<Link href={addr({ section: "volume", month: undefined })} className={`${LINK_CUE} block min-h-11`} aria-label="Search volume by month" data-testid="link-volume-chart"><GradientSpark range height={44} points={trend} color={PALETTE.keywords} format={fmtNum} /></Link>} />
              <MetricColumn label="Difficulty" value={<Link href={addr({ section: "serp" })} className={BLOCK_LINK} title="The pages it is worked out from" data-testid="link-difficulty"><KdBadge value={o.difficulty} size="lg" /></Link>}
                foot={o.topAvg.referringDomains != null ? <Link href={addr({ section: "serp" })} className={TEXT_LINK} data-testid="link-top-avg">Top pages average {fmtNum(o.topAvg.referringDomains)} referring domains</Link> : "0–100"} />
              <MetricColumn label="Cost per click" value={<Link href={addr({ section: "cpc" })} className={FIG_LINK} title="No view lists the bids — this opens who ranks" data-testid="link-cpc">{o.cpc == null ? "—" : `$${o.cpc.toFixed(2)}`}</Link>}
                foot={o.bidLow != null && o.bidHigh != null ? <Link href={addr({ section: "cpc" })} className={TEXT_LINK} data-testid="link-cpc-bids">Top-of-page bids ${o.bidLow.toFixed(2)}–${o.bidHigh.toFixed(2)}</Link> : o.competition ? <Link href={addr({ section: "cpc" })} className={TEXT_LINK} data-testid="link-cpc-bids">{cap(o.competition.toLowerCase())} ad competition</Link> : undefined} />
              <MetricColumn label="Intent" value={o.intent ? <Link href={addr({ section: "ideas", table: "matchingTerms", intent: (INTENTS as readonly string[]).includes(o.intent) ? o.intent : undefined })} className={`${FIG_LINK} text-[20px]`} title="Matching terms, narrowed to this intent" data-testid="link-intent">{cap(o.intent)}</Link> : "—"}
                foot={o.results != null ? <Link href={addr({ section: "results" })} className={TEXT_LINK} data-testid="link-results">{fmtNum(o.results)} results</Link> : undefined} />
              {o.potential !== undefined && <MetricColumn label="Traffic potential" value={o.potential ? <Link href={addr({ section: "ideas", table: "relatedTerms", intent: undefined })} className={FIG_LINK} title="The related terms the #1 page ranks for" data-testid="link-potential">{fmtNum(o.potential.traffic)}</Link> : "—"}
                foot={o.potential ? <Link href={addr({ section: "ideas", table: "relatedTerms", intent: undefined })} className={TEXT_LINK} data-testid="link-potential-note">{o.potential.keywords === 1 ? `Estimated visits a month the #1 page gets from search in ${market.label} — it ranks for one keyword` : o.potential.keywords == null ? `Estimated visits a month the #1 page gets from search in ${market.label}` : `Estimated visits a month the #1 page gets in ${market.label} from all ${fmtNum(o.potential.keywords)} keywords it ranks for`}</Link> : (o.missing ?? []).includes("potential") ? "Didn't load this time (not charged)" : "Not available for this keyword"} />}
              {o.potential !== undefined && <MetricColumn label="Parent topic" value={o.potential?.parentTopic ? (o.potential.parentTopic === o.keyword ? <span className="text-[17px] leading-snug" data-testid="text-parent-topic">This keyword</span> : <Link href={seoLinks.keywords(o.potential.parentTopic, marketParams(market))} className={`${BLOCK_LINK} g-link text-left text-[17px] leading-snug [overflow-wrap:anywhere]`} title="Open this keyword (its saved overview, or the Look up button)" data-testid="button-parent-topic">{o.potential.parentTopic}</Link>) : "—"}
                foot={o.potential?.parentTopic ? <Link href={addr({ section: "ideas", table: "relatedTerms", intent: undefined })} className={TEXT_LINK} data-testid="link-parent-topic-ideas">The search that sends the #1 page the most visits{o.potential.parentVolume != null ? ` — ${fmtNum(o.potential.parentVolume)} searches a month` : ""}</Link> : undefined} />}
            </MetricRow>
          </Card>
          {o.potential === undefined && <p className="g-text-2 -mt-2 mb-4 text-[13px]" data-testid="text-potential-older">Traffic potential and parent topic were added after this overview was saved — Refresh to see them.</p>}
          <div className="mb-4 grid gap-4 lg:grid-cols-3">
            <Card className="lg:col-span-2 scroll-mt-4" id="keyword-trend" testId="panel-keyword-trend">
              <Heading className="mb-2" note={monthAt ? <Link href={addr({ section: "volume", month: monthAt.month })} className={TEXT_LINK} title="The month marked on the chart — its own address" data-testid="link-volume-marked">{monthLabel(monthAt.month)} marked: {fmtNum(monthAt.volume)} searches</Link> : undefined}>Search volume by month</Heading>
              {o.trend.length > 1 ? (<>
                <MonthlyBars points={trend} color={PALETTE.keywords} height={220} highlight={address.month ? monthLabel(address.month) : undefined} onBar={(label) => { const t = o.trend.find((x) => monthLabel(x.month) === label); if (t) go({ section: "volume", month: t.month }); }} />
                {/* Each bar is a pick; this is the same pick by keyboard, and it writes the same address. */}
                <label className="g-text-2 mt-2 flex flex-wrap items-center gap-2 text-[12px]">Month
                  <select className="g-input g-select !w-auto" value={address.month ?? ""} onChange={(e) => go({ section: "volume", month: e.target.value || undefined })} data-testid="select-volume-month">
                    <option value="">Every month</option>
                    {[...o.trend].reverse().map((t) => <option key={t.month} value={t.month}>{monthLabel(t.month)} — {fmtNum(t.volume)}</option>)}
                  </select>
                </label>
              </>) : <p className="g-text-2 text-[13px]">No monthly history for this keyword.</p>}
            </Card>
            <Card className="scroll-mt-4" id="keyword-features" testId="panel-keyword-features">
              <Heading className="mb-2">On the results page</Heading>
              {o.features.length ? <div className="flex flex-wrap gap-1.5">{o.features.map((f) => <FeatureTag key={f} feature={f} label={FEATURE[f] ?? cap(f.replace(/_/g, " "))} href={addr({ section: "serp" })} testId={`link-feature-${f}`} />)}</div> : <p className="g-text-2 text-[13px]">Plain results only.</p>}
              <p className="g-text-2 mt-3 text-[12px]">{o.features.includes("local_pack") ? "The saved results had a map pack, so a strong Google Business Profile matters as much as the website." : "No map pack in the saved results, so the website is what competes here."}</p>
              {site && isTracked && <p className="g-text-2 mt-2 text-[12px]">Tracked on {site.domain}: <Link href={seoLinks.rankTracker(site.id, { keyword: o.keyword })} className={TEXT_LINK} data-testid="link-features-tracker">the results-page features of each weekly check</Link></p>}
            </Card>
          </div>
          <section className="mb-5 scroll-mt-4" id="keyword-serp" data-testid="panel-keyword-serp">
            <Heading className="mb-2" note={<>Google's top results as saved on <Link href={seoLinks.usage({ month: o.fetchedAt.slice(0, 7) })} className={TEXT_LINK} title="When these results were saved — that month's lookups on the Usage page" data-testid="link-serp-saved-on">{fmtDate(o.fetchedAt)}</Link> (desktop)</>}>Who ranks</Heading>
            {(o.missing?.length ?? 0) > 0 && <p className="g-text-2 mb-2 text-[13px]" role="status" data-testid="text-keyword-missing">{[o.missing!.includes("results") ? "The top results" : null, o.missing!.includes("authority") ? "Site authority" : null, o.missing!.includes("potential") ? "Traffic potential and parent topic" : null].filter(Boolean).join(", ").replace(/, ([^,]*)$/, " and $1") || "Part of this overview"} didn't load this time; you were not charged for that part. Refresh looks the whole keyword up again.</p>}
            {o.serp.length ? (
              <div className="overflow-x-auto">
              <table className="g-table">
                <thead><tr><th className="num w-10">#</th><th>Page</th><th className="num">Site authority</th><th></th></tr></thead>
                <tbody>{o.serp.map((s) => { const shown = s.url.replace(/^https?:\/\/(www\.)?/, ""); const rest = shown.startsWith(s.domain) ? shown.slice(s.domain.length) : ` · ${shown}`; return (
                  <tr key={`${s.position}-${s.url}`}>
                    <td className="num"><Link href={seoLinks.explorer(s.domain, "keywords", { contains: o.keyword, ...(market.locationCode !== DEFAULT_MARKET.locationCode ? { locationCode: market.locationCode } : {}) })} className={FIG_LINK} title={`Its place for this search — ${s.domain}'s organic keywords in Site explorer, narrowed to it (its own lookup: a saved page opens free)`} data-testid={`link-serp-position-${s.position}`}>{s.position}</Link></td>
                    {/* The address under the title: the site is a link 44 px tall; only the rest of the address is cut short. */}
                    <td className="min-w-0"><a href={s.url} className={TEXT_LINK} target="_blank" rel="noreferrer">{s.title ?? s.domain}</a><span className="g-text-2 flex max-w-[520px] items-center text-[12px]"><Link href={seoLinks.explorer(s.domain)} className={`${BLOCK_LINK} g-link shrink-0`} title={`${s.domain} in Site explorer`} data-testid={`link-serp-domain-${s.position}`}>{s.domain}</Link><span className="min-w-0 truncate">{rest}</span></span></td>
                    <td className="num" data-label="Site authority"><Link href={seoLinks.explorer(s.domain, "referringDomains")} className={BLOCK_LINK} title="Link strength of the site, 0–100 — opens its referring domains" data-testid={`link-serp-authority-${s.position}`}><BarFigure value={s.authority} max={100} color={PALETTE.authority} format={String} /></Link></td>
                    <td className="num"><Link className={TEXT_LINK} href={seoLinks.explorer(s.domain)} data-testid={`link-explore-${s.position}`}>Explore site</Link></td>
                  </tr>
                ); })}</tbody>
              </table>
              </div>
            ) : <p className="g-text-2 text-[13px]">The top results weren't available for this keyword.</p>}
          </section>

          <section className="scroll-mt-4" id="keyword-ideas" data-testid="panel-keyword-ideas">
          <Heading className="mb-2">Keyword ideas</Heading>
          <nav className="g-tabs" aria-label="Keyword ideas">
            {IDEAS.map(([k, label]) => <Link key={k} href={addr({ table: k, intent: undefined })} aria-current={ideas === k ? "page" : undefined} data-testid={`tab-ideas-${k}`}>{label}</Link>)}
          </nav>
          {/* `linked`: the table's filter boxes (intent among them) read the address on arrival and write it on Apply. */}
          <ReportView key={`${ideas}:${o.keyword}:${marketKey(market)}`} linked market={market} table={ideas} keyword={o.keyword} status={status.data} extraAction={(rows, clear) => <AddToList market={market} rows={rows} onDone={clear} />} onTrack={site ? (rows) => track.mutateAsync({ rows, from: market }) : undefined} trackLabel={site ? `Track on ${site.domain}` : undefined} />
          {!site && <p className="g-text-2 mt-2 text-[13px]">Add a site above to track keywords from these lists.</p>}
          </section>
        </div>
      )}
      </>)}
    </SeoShell>
  );
}
