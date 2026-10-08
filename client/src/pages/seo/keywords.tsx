/**
 * /seo/keywords — Keywords Explorer. Type a keyword: its monthly search volume
 * with the trend over the years, difficulty, cost per click, intent, who ranks
 * for it today and how strong those sites are; then the ideas around it —
 * matching terms, related terms and questions — filterable, sortable, paged,
 * exportable, and trackable on one of your sites.
 * The overview is one lookup (free to reopen for a week); each page of an idea
 * list is one lookup (free to reopen for a day). See server/seo/reports.ts.
 */
import { useEffect, useState } from "react";
import { holdNote, isNotRunYet, refreshSeoData } from "./shell";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Loader2, Plus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiErrorMessage } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { api, canAfford, Empty, fmtDate, fmtNum, kd, money, SeoShell, useSelectedSite, useSeoSites, useSeoStatus } from "./shell";
import { ReportView, type TableKey } from "./report-table";
import { AddToList, BulkKeywords, KeywordLists } from "./keyword-lists";

type Overview = {
  missing?: string[];
  keyword: string; fetchedAt: string;
  volume: number | null; cpc: number | null; difficulty: number | null; intent: string | null; competition: string | null;
  bidLow: number | null; bidHigh: number | null; results: number | null;
  trend: { month: string; volume: number }[];
  features: string[];
  topAvg: { authority: number | null; backlinks: number | null; referringDomains: number | null };
  serp: { position: number; domain: string; url: string; title: string | null; authority: number | null }[];
};

const IDEAS: [TableKey, string][] = [["matchingTerms", "Matching terms"], ["relatedTerms", "Related terms"], ["questions", "Questions"]];
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const monthLabel = (m: string) => new Date(`${m}-15T12:00:00`).toLocaleDateString("en-US", { month: "short", year: "numeric" });
const FEATURE: Record<string, string> = {
  local_pack: "Map pack", people_also_ask: "People also ask", featured_snippet: "Featured snippet", images: "Images", video: "Videos", paid: "Ads",
  related_searches: "Related searches", people_also_search: "People also search", knowledge_graph: "Knowledge panel", shopping: "Shopping", top_stories: "Top stories", ai_overview: "AI overview",
};

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return <div className="g-tile"><div className="g-tile__label">{label}</div><div className="g-tile__value">{value}</div>{hint && <div className="g-tile__hint">{hint}</div>}</div>;
}

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
  const [mode, setMode] = useState<"one" | "bulk" | "lists">(() => { const v = new URLSearchParams(window.location.search).get("view"); return v === "bulk" || v === "lists" ? v : "one"; });
  /** Keywords handed to the bulk analysis from a list. */
  const [bulkSeed, setBulkSeed] = useState("");

  // A keyword looked up in the last week opens without spending.
  const saved = useQuery<{ overview: Overview } | null>({
    queryKey: ["/api/seo/keyword", keyword], enabled: !!keyword && !overview, retry: false,
    queryFn: async () => { try { return await api("POST", "/api/seo/keyword", { keyword, peek: true }); } catch (e) { if (isNotRunYet(e)) return null; throw e; } },
  });
  useEffect(() => { if (saved.data?.overview && !overview) setOverview(saved.data.overview); }, [saved.data, overview]);

  const lookup = useMutation({
    mutationFn: (k: string) => api("POST", "/api/seo/keyword", { keyword: k }),
    onSuccess: (data: { overview: Overview }) => {
      setOverview(data.overview); setKeyword(data.overview.keyword); setInput(data.overview.keyword);
      window.history.replaceState({}, "", `/seo/keywords?keyword=${encodeURIComponent(data.overview.keyword)}`);
      void qc.invalidateQueries({ queryKey: ["/api/seo/status"] });
    },
    onError: (e) => toast({ title: "Couldn't look that keyword up", description: apiErrorMessage(e), variant: "destructive" }),
  });
  const refresh = useMutation({
    mutationFn: () => api("POST", "/api/seo/keyword", { keyword: overview?.keyword, refresh: true }),
    onSuccess: (data: { overview: Overview }) => { setOverview(data.overview); void qc.invalidateQueries({ queryKey: ["/api/seo/status"] }); },
    onError: (e) => toast({ title: "Couldn't refresh that keyword", description: apiErrorMessage(e), variant: "destructive" }),
  });
  const track = useMutation({
    mutationFn: (rows: { keyword: string; volume: number | null; cpc: number | null; difficulty: number | null }[]) =>
      api("POST", `/api/seo/sites/${site!.id}/keywords`, { keywords: rows.map((r) => r.keyword), volumes: rows.map((r) => ({ keyword: r.keyword, searchVolume: r.volume, cpc: r.cpc, difficulty: r.difficulty })) }),
    onSuccess: (r: { added: number }) => { refreshSeoData(qc); toast({ title: `${r.added} keyword${r.added === 1 ? "" : "s"} now tracked on ${site?.domain}` }); },
    onError: (e) => toast({ title: "Couldn't track", description: apiErrorMessage(e), variant: "destructive" }),
  });

  const submit = () => { const k = input.trim(); if (!k) return; setOverview(null); setKeyword(k.toLowerCase()); lookup.mutate(k); };
  /** From a list or a bulk analysis: open one keyword's overview (the saved copy if there is one; nothing is bought). */
  const openKeyword = (k: string) => { setMode("one"); setInput(k); setOverview(null); setKeyword(k.toLowerCase()); };
  const configured = !!status.data?.configured;
  const affordable = canAfford(status.data, "keywordOverview");
  const price = status.data?.prices ? money(status.data.prices.keywordOverview) : "";
  const busy = lookup.isPending || (saved.isLoading && !!keyword && !overview);
  const o = overview;
  const peak = o && o.trend.length ? o.trend.reduce((a, b) => (b.volume > a.volume ? b : a)) : null;

  return (
    <SeoShell title="Keywords explorer" description="How often people search for something, how hard it is to rank for, who ranks today, and the keywords around it." site={site} onSite={onSite} sites={sites} status={status}>
      <nav className="g-tabs" aria-label="Keywords explorer views">
        {([["one", "One keyword"], ["bulk", "Many keywords"], ["lists", "My lists"]] as const).map(([m, label]) => <a key={m} href={`#${m}`} aria-current={mode === m ? "page" : undefined} onClick={(e) => { e.preventDefault(); setMode(m); }} data-testid={`tab-keywords-${m}`}>{label}</a>)}
      </nav>
      {mode === "bulk" && <BulkKeywords key={bulkSeed} initial={bulkSeed} status={status.data} site={site} onTrack={site ? (rows) => track.mutate(rows) : undefined} onOpen={openKeyword} />}
      {mode === "lists" && <KeywordLists status={status.data} site={site} onTrack={site ? (rows) => track.mutate(rows) : undefined} onOpen={openKeyword} />}
      {mode === "one" && (<>
      <form className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center" onSubmit={(e) => { e.preventDefault(); submit(); }} data-testid="form-keyword">
        <label className="relative min-w-0 flex-1 sm:max-w-xl">
          <span className="sr-only">Keyword</span>
          <Search className="g-text-2 pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2" aria-hidden />
          <input className="g-input w-full pl-9" placeholder="e.g. siding contractor" value={input} onChange={(e) => setInput(e.target.value)} data-testid="input-keyword" autoComplete="off" />
        </label>
        <Button type="submit" disabled={busy || !input.trim() || !configured || !affordable} data-testid="button-keyword-lookup">
          {lookup.isPending ? <><Loader2 className="mr-1 h-4 w-4 animate-spin" /> Looking up…</> : "Look up"}
        </Button>
      </form>
      <p className="g-text-2 mb-4 text-[13px]" data-testid="text-keyword-cost">
        A keyword's overview costs about {price} of your SEO data and is free to reopen for a week.{holdNote(status.data, "keywordOverview")} United States, Google.{!affordable && " You don't have enough SEO data left — add credit above."}
      </p>
      {busy && <p className="g-text-2 flex items-center gap-2 text-[14px]" role="status"><Loader2 className="h-4 w-4 animate-spin" /> {lookup.isPending ? "Getting volume, difficulty and today's results…" : "Opening the saved overview…"}</p>}
      {!o && !busy && !keyword && <Empty testId="keywords-intro"><h3>Research any keyword</h3><p>Enter a search term to see its monthly volume over time, how hard it is to rank for, what an ad click costs, who holds the top ten today — and hundreds of related searches you can track.</p></Empty>}
      {!o && !busy && keyword && saved.isError && <div className="g-callout" role="alert" data-testid="keywords-saved-error"><h3>Couldn't check for a saved overview</h3><p>{apiErrorMessage(saved.error)}</p><button type="button" className="g-pill mt-2" onClick={() => void saved.refetch()}>Try again</button></div>}
      {!o && !busy && keyword && !saved.isError && <Empty testId="keywords-not-found"><h3>No overview for "{keyword}" yet</h3><p>Press <b>Look up</b> to get it.</p></Empty>}

      {o && (
        <div data-testid="keyword-overview">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <h2 className="g-text text-[20px] font-medium">"{o.keyword}"</h2>
            <span className="g-text-2 text-[12px]">as of {fmtDate(o.fetchedAt)}</span>
            <button type="button" className="g-pill g-pill--sm" disabled={refresh.isPending || !configured || !affordable} onClick={() => refresh.mutate()} title={`Looks it up again — about ${price}`} data-testid="button-keyword-refresh">{refresh.isPending ? <Loader2 className="animate-spin" /> : null} Refresh · {price}</button>
            <span className="ml-auto"><AddToList rows={[{ keyword: o.keyword, volume: o.volume, cpc: o.cpc, difficulty: o.difficulty, intent: o.intent }]} label="Save to a list" /></span>
            {site && <button type="button" className="g-pill g-pill--sm" disabled={track.isPending} onClick={() => track.mutate([{ keyword: o.keyword, volume: o.volume, cpc: o.cpc, difficulty: o.difficulty }])} data-testid="button-track-keyword"><Plus /> Track on {site.domain}</button>}
          </div>
          <div className="g-tiles mb-4">
            <Stat label="Search volume" value={fmtNum(o.volume)} hint={peak ? `Peak ${fmtNum(peak.volume)} in ${monthLabel(peak.month)}` : "per month"} />
            <Stat label="Difficulty" value={kd(o.difficulty)} hint={o.topAvg.referringDomains != null ? `Top pages average ${fmtNum(o.topAvg.referringDomains)} referring domains` : "0–100"} />
            <Stat label="Cost per click" value={o.cpc == null ? "—" : `$${o.cpc.toFixed(2)}`} hint={o.bidLow != null && o.bidHigh != null ? `Top-of-page bids $${o.bidLow.toFixed(2)}–$${o.bidHigh.toFixed(2)}` : o.competition ? `${cap(o.competition.toLowerCase())} ad competition` : undefined} />
            <Stat label="Intent" value={o.intent ? cap(o.intent) : "—"} hint={o.results != null ? `${fmtNum(o.results)} results` : undefined} />
          </div>
          <div className="mb-4 grid gap-4 lg:grid-cols-3">
            <section className="rounded-lg border p-4 lg:col-span-2" style={{ borderColor: "var(--g-divider)" }} data-testid="panel-keyword-trend">
              <h3 className="g-text mb-2 text-[15px] font-medium">Search volume by month</h3>
              {o.trend.length > 1 ? (
                <div style={{ width: "100%", height: 220 }}>
                  <ResponsiveContainer>
                    <AreaChart data={o.trend} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                      <CartesianGrid stroke="var(--g-divider)" vertical={false} />
                      <XAxis dataKey="month" tickFormatter={monthLabel} tick={{ fontSize: 12, fill: "var(--g-text-2)" }} axisLine={false} tickLine={false} minTickGap={40} />
                      <YAxis tick={{ fontSize: 12, fill: "var(--g-text-2)" }} axisLine={false} tickLine={false} width={48} tickFormatter={(v) => (v >= 1000 ? `${Math.round(v / 1000)}K` : String(v))} />
                      <Tooltip labelFormatter={(m) => monthLabel(String(m))} formatter={(v: number) => [fmtNum(v), "Searches"]} contentStyle={{ fontSize: 12, background: "var(--g-surface)", border: "1px solid var(--g-divider)", color: "var(--g-text)" }} />
                      <Area type="monotone" dataKey="volume" stroke="#1a73e8" fill="#1a73e8" fillOpacity={0.15} strokeWidth={2} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              ) : <p className="g-text-2 text-[13px]">No monthly history for this keyword.</p>}
            </section>
            <section className="rounded-lg border p-4" style={{ borderColor: "var(--g-divider)" }} data-testid="panel-keyword-features">
              <h3 className="g-text mb-2 text-[15px] font-medium">On the results page</h3>
              {o.features.length ? <div className="flex flex-wrap gap-1.5">{o.features.map((f) => <span key={f} className="g-chip g-chip--sm">{FEATURE[f] ?? cap(f.replace(/_/g, " "))}</span>)}</div> : <p className="g-text-2 text-[13px]">Plain results only.</p>}
              <p className="g-text-2 mt-3 text-[12px]">{o.features.includes("local_pack") ? "Google shows a map pack here, so a strong Google Business Profile matters as much as the website." : "No map pack: this one is won by the website."}</p>
            </section>
          </div>
          <section className="mb-5" data-testid="panel-keyword-serp">
            <h3 className="g-text mb-2 text-[15px] font-medium">Who ranks <span className="g-text-2 text-[12px] font-normal">· Google's top results as of {fmtDate(o.fetchedAt)}</span></h3>
            {(o.missing?.length ?? 0) > 0 && <p className="g-text-2 mb-2 text-[13px]" role="status" data-testid="text-keyword-missing">{o.missing!.includes("results") ? "The top results didn't load this time." : "Site authority didn't load this time."} Refresh to try again.</p>}
            {o.serp.length ? (
              <table className="g-table">
                <thead><tr><th className="num w-10">#</th><th>Page</th><th className="num">Site authority</th><th></th></tr></thead>
                <tbody>{o.serp.map((s) => (
                  <tr key={`${s.position}-${s.url}`}>
                    <td className="num">{s.position}</td>
                    <td><a href={s.url} className="g-link" target="_blank" rel="noreferrer">{s.title ?? s.domain}</a><span className="g-text-2 block max-w-[520px] truncate text-[12px]">{s.url.replace(/^https?:\/\/(www\.)?/, "")}</span></td>
                    <td className="num" data-label="Site authority">{s.authority ?? "—"}</td>
                    <td className="num"><a className="g-link" href={`/seo/explorer?domain=${encodeURIComponent(s.domain)}`} data-testid={`link-explore-${s.position}`}>Explore site</a></td>
                  </tr>
                ))}</tbody>
              </table>
            ) : <p className="g-text-2 text-[13px]">Today's results weren't available for this keyword.</p>}
          </section>

          <h3 className="g-text mb-2 text-[15px] font-medium">Keyword ideas</h3>
          <nav className="g-tabs" aria-label="Keyword ideas">
            {IDEAS.map(([k, label]) => <a key={k} href={`#${k}`} aria-current={ideas === k ? "page" : undefined} onClick={(e) => { e.preventDefault(); setIdeas(k); }} data-testid={`tab-ideas-${k}`}>{label}</a>)}
          </nav>
          <ReportView table={ideas} keyword={o.keyword} status={status.data} extraAction={(rows, clear) => <AddToList rows={rows} onDone={clear} />} onTrack={site ? (rows) => track.mutate(rows) : undefined} trackLabel={site ? `Track on ${site.domain}` : undefined} />
          {!site && <p className="g-text-2 mt-2 text-[13px]">Add a site above to track keywords from these lists.</p>}
        </div>
      )}
      </>)}
    </SeoShell>
  );
}
