/**
 * /seo/content — Content explorer: search the web for pages about a topic.
 * See who writes about what you sell, how strong their site is and when they
 * published — for content ideas, and for sites worth asking for a link or a
 * mention. Each new page of results shows its price first; a search you have
 * already run reopens free for a day.
 */
import { cleanPageUrls, pageKey } from "@shared/seo-page-key";
import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, Loader2, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiErrorMessage } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { api, Empty, fmtDate, fmtNum, isNotRunYet, money, SeoShell, useSelectedSite, useSeoSites, useSeoStatus } from "./shell";

type Row = { url: string; domain: string; title: string; snippet: string | null; authority: number | null; published: string | null; quality: number | null; author: string | null };
type Page = { query: string; rows: Row[]; total: number | null; sourceRows: number; limit: number; offset: number; fetchedAt: string };
type Sort = "relevance" | "authority" | "newest";
type Filters = { sort: Sort; sinceDays?: 30 | 90 | 365 | 730; minAuthority?: number; kind?: string; excludeOwn: boolean };
const KINDS: [string, string][] = [["", "Any kind of site"], ["blogs", "Blogs"], ["news", "News"], ["organization", "Company sites"], ["message-boards", "Forums"], ["ecommerce", "Shops"]];
const csvCell = (v: string | number | null) => { const s = v == null ? "" : String(v); return `"${(typeof v !== "number" && /^[=+\-@\t\r]/.test(s) ? `'${s}` : s).replace(/"/g, '""')}"`; };

export default function SeoContentPage() {
  const status = useSeoStatus();
  const sites = useSeoSites();
  const [site, onSite] = useSelectedSite(sites.data);
  const qc = useQueryClient();
  const { toast } = useToast();
  const [input, setInput] = useState(() => new URLSearchParams(window.location.search).get("q") ?? "");
  const [query, setQuery] = useState<string | null>(() => new URLSearchParams(window.location.search).get("q"));
  const [f, setF] = useState<Filters>({ sort: "relevance", excludeOwn: true });
  /** How the pages on screen are ordered once their numbers are in (the search's own order until then). */
  const [by, setBy] = useState<"search" | "links" | "traffic">("search");
  const [offset, setOffset] = useState(0);
  const limit = 25;
  useEffect(() => { setOffset(0); }, [query, f]);
  const body = useMemo(() => ({ query: query ?? "", sort: f.sort, ...(f.sinceDays ? { sinceDays: f.sinceDays } : {}), ...(f.minAuthority ? { minAuthority: f.minAuthority } : {}), ...(f.kind ? { kind: f.kind } : {}), ...(f.excludeOwn && site ? { exclude: site.domain } : {}), limit, offset }), [query, f, site, offset]);
  const queryKey = ["/api/seo/content", body];
  const saved = useQuery<{ page: Page; saved?: boolean } | null>({
    queryKey, enabled: !!query, retry: false, staleTime: 5 * 60_000,
    queryFn: async () => { try { return await api("POST", "/api/seo/content", { ...body, peek: true }); } catch (e) { if (isNotRunYet(e)) return null; throw e; } },
  });
  const run = useMutation({
    mutationFn: (v: { body: unknown; key: readonly unknown[] }) => api("POST", "/api/seo/content", v.body),
    onSuccess: (data: unknown, v) => { qc.setQueryData(v.key, data); void qc.invalidateQueries({ queryKey: ["/api/seo/status"] }); },
    onError: (e) => toast({ title: "Couldn't run the search", description: apiErrorMessage(e), variant: "destructive" }),
  });
  const price = status.data?.prices?.contentSearch ?? null, hold = status.data?.holds?.contentSearch ?? price;
  const canPay = hold == null || !status.data?.credits || status.data.credits.availableCents === -1 || status.data.credits.availableCents >= hold;
  const page = saved.data?.page ?? null;
  const submit = () => { const q = input.trim(); if (q.length >= 2) { setQuery(q); window.history.replaceState({}, "", `/seo/content?q=${encodeURIComponent(q)}`); } };
  const exportCsv = () => {
    if (!page) return;
    const blob = new Blob([[["Title", "URL", "Site", "Authority", "Published", "Author", "Excerpt"], ...page.rows.map((r) => [r.title, r.url, r.domain, r.authority, r.published, r.author, r.snippet])].map((l) => l.map(csvCell).join(",")).join("\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = `content-${page.query.replace(/[^a-z0-9]+/gi, "-")}.csv`; a.click(); URL.revokeObjectURL(a.href);
  };
  const set = (patch: Partial<Filters>) => setF((x) => ({ ...x, ...patch }));

  // Numbers for the pages on screen: free to look for a saved copy, bought only when asked for.
  type Metric = { url: string; linkingSites: number | null; traffic: number | null; keywords: number | null };
  // The same list the server will count, ask about and price: each page once, without #fragments (shared/seo-page-key.ts).
  const pageUrls = useMemo(() => cleanPageUrls((saved.data?.page?.rows ?? []).map((r) => r.url)), [saved.data]);
  const metricsBody = useMemo(() => ({ urls: pageUrls }), [pageUrls]);
  const metricsKey = ["/api/seo/content/metrics", metricsBody];
  type Retry = { cents: number; links: number; traffic: number };
  const metrics = useQuery<{ page: { rows: Metric[]; missing: string[] }; saved?: boolean; retry?: Retry | null } | null>({
    queryKey: metricsKey, enabled: pageUrls.length > 0, retry: false, staleTime: 5 * 60_000,
    queryFn: async () => { try { return await api("POST", "/api/seo/content/metrics", { ...metricsBody, peek: true }); } catch (e) { if (isNotRunYet(e)) return null; throw e; } },
  });
  const addMetrics = useMutation({
    mutationFn: (v: { body: Record<string, unknown>; key: readonly unknown[]; retry?: boolean }) => api("POST", "/api/seo/content/metrics", v.retry ? { ...v.body, retry: true } : v.body),
    onSuccess: (data: { saved?: boolean }, v) => {
      qc.setQueryData(v.key, data); void qc.invalidateQueries({ queryKey: ["/api/seo/status"] });
      if (data.saved === false) toast({ title: "Shown, but it couldn't be kept", description: "Opening these numbers again will not be free.", variant: "destructive" });
    },
    // A second try with nothing saved to complete (it expired meanwhile) buys nothing: look again, so the full offer and its price come back.
    onError: (e, v) => { toast({ title: "Couldn't get those numbers", description: apiErrorMessage(e), variant: "destructive" }); if (v.retry) void qc.invalidateQueries({ queryKey: v.key }); },
  });
  // The quote is the server's own figure for exactly this many pages; without it nothing can be bought here.
  const quoteFor = (list: string) => (pageUrls.length ? status.data?.quotes?.[list]?.[pageUrls.length - 1] ?? null : null);
  const canAfford = (cents: number | null) => cents != null && (!status.data?.credits || status.data.credits.availableCents === -1 || status.data.credits.availableCents >= cents);
  const metricsPrice = quoteFor("pageMetrics");
  const canPayMetrics = canAfford(metricsPrice);
  // What the saved answer is still without, and the server's exact figure for asking again for only that.
  const retry = metrics.data?.retry ?? null;
  const wholePart = metrics.data?.page?.missing?.[0] ?? null;
  // Matched on the page's key — the address without its fragment, nothing else folded together.
  const byKey = useMemo(() => new Map((metrics.data?.page?.rows ?? []).map((m) => [m.url, m] as const)), [metrics.data]);
  const metricOf = (url: string) => byKey.get(pageKey(url) ?? url) ?? null;
  // Ordering by a number puts pages without that number last; the search's own order is kept among equals.
  const ordered = useMemo(() => {
    const rows = saved.data?.page?.rows ?? [];
    if (by === "search" || !metrics.data?.page) return rows;
    const val = (u: string) => { const m = metricOf(u); return m ? (by === "links" ? m.linkingSites : m.traffic) : null; };
    return rows.map((r, i) => ({ r, i, v: val(r.url) })).sort((a, b) => (a.v == null ? 1 : 0) - (b.v == null ? 1 : 0) || (b.v ?? 0) - (a.v ?? 0) || a.i - b.i).map((x) => x.r);
  }, [saved.data, metrics.data, by]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <SeoShell title="Content explorer" description="Search the web for pages about a topic — who is writing about what you sell, how strong their site is, and when." site={site} onSite={onSite} sites={sites} status={status} picker={false}>
      <form className="mb-2 flex flex-col gap-2 sm:flex-row sm:items-center" onSubmit={(e) => { e.preventDefault(); submit(); }} data-testid="form-content">
        <label className="relative min-w-0 flex-1 sm:max-w-xl"><span className="sr-only">Topic</span>
          <Search className="g-text-2 pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2" aria-hidden />
          <input className="g-input w-full pl-9" placeholder="e.g. fiber cement siding cost" value={input} onChange={(e) => setInput(e.target.value)} autoComplete="off" data-testid="input-content-query" />
        </label>
        <Button type="submit" disabled={input.trim().length < 2} data-testid="button-content-search">Search</Button>
      </form>
      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-[13px]" data-testid="content-filters">
        <label className="flex items-center gap-2"><span className="g-text-2">Sort</span><select className="g-select" value={f.sort} onChange={(e) => set({ sort: e.target.value as Sort })} data-testid="select-content-sort"><option value="relevance">Most relevant</option><option value="authority">Strongest sites first</option><option value="newest">Newest first</option></select></label>
        <label className="flex items-center gap-2"><span className="g-text-2">Published</span><select className="g-select" value={f.sinceDays ?? ""} onChange={(e) => set({ sinceDays: (Number(e.target.value) || undefined) as Filters["sinceDays"] })} data-testid="select-content-since"><option value="">Any time</option><option value="30">Last 30 days</option><option value="90">Last 3 months</option><option value="365">Last year</option><option value="730">Last 2 years</option></select></label>
        <label className="flex items-center gap-2"><span className="g-text-2">Site authority at least</span><select className="g-select" value={f.minAuthority ?? ""} onChange={(e) => set({ minAuthority: Number(e.target.value) || undefined })} data-testid="select-content-authority"><option value="">Any</option>{[10, 20, 30, 50, 70].map((n) => <option key={n} value={n}>{n}</option>)}</select></label>
        <label className="flex items-center gap-2"><span className="sr-only">Kind of site</span><select className="g-select" value={f.kind ?? ""} onChange={(e) => set({ kind: e.target.value || undefined })} data-testid="select-content-kind">{KINDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
        {site && <label className="flex items-center gap-2"><input type="checkbox" checked={f.excludeOwn} onChange={(e) => set({ excludeOwn: e.target.checked })} /> <span className="g-text">Leave out {site.domain}</span></label>}
      </div>
      <p className="g-text-2 mb-4 text-[13px]" data-testid="text-content-cost">Each new page of results costs about {price != null ? money(price) : "—"} of your SEO data; a search you have run reopens free for a day. English-language pages.</p>

      {!query && <Empty testId="content-intro"><h3>Find who writes about your trade</h3><p>Search a topic your customers care about — "roof replacement cost", "james hardie vs vinyl siding" — to see the pages already written about it. Use it to plan a better page of your own, and to find blogs, local news and directories worth asking for a mention. Sort by <b>Strongest sites first</b> to see the best-known sites first — authority is one sign of a link worth having, alongside how relevant and local the site is.</p></Empty>}
      {query && saved.isLoading && <p className="g-text-2 flex items-center gap-2 text-[14px]" role="status"><Loader2 className="h-4 w-4 animate-spin" /> Checking for a saved search…</p>}
      {query && saved.isError && <div className="g-callout" role="alert" data-testid="content-error"><h3>Couldn't check for a saved search</h3><p>{apiErrorMessage(saved.error)}</p><button type="button" className="g-pill mt-2" onClick={() => void saved.refetch()}>Try again</button>{offset > 0 && <button type="button" className="g-pill ml-2 mt-2" onClick={() => setOffset(Math.max(0, offset - limit))} data-testid="button-content-error-back">← Back to the previous results</button>}</div>}
      {query && saved.isSuccess && !page && (
        <Empty testId="content-not-run">
          <h3>Pages about "{query}"</h3>
          <p>{offset ? "This page of results hasn't been opened yet." : "Not searched yet with these settings."}{!canPay && " You don't have enough SEO data left — add credit above."}</p>
          {offset > 0 && <button type="button" className="g-pill mr-2 mt-2" onClick={() => setOffset(Math.max(0, offset - limit))} data-testid="button-content-back">← Back to the previous results</button>}
          <Button className="mt-2" disabled={run.isPending || !status.data?.configured || !canPay} onClick={() => run.mutate({ body, key: queryKey })} data-testid="button-content-run">{run.isPending ? <><Loader2 className="mr-1 h-4 w-4 animate-spin" /> Searching…</> : `${offset ? "Load these results" : "Run the search"}${price != null ? ` — about ${money(price)}` : ""}`}</Button>
        </Empty>
      )}
      {page && (
        <>
          <div className="mb-2 flex flex-wrap items-center gap-2 text-[13px]">
            <span className="g-text-2" data-testid="text-content-meta">{page.total != null ? `${fmtNum(page.total)} matches across the web` : `${fmtNum(page.rows.length)} pages`} · showing {fmtNum(page.offset + 1)}–{fmtNum(page.offset + page.rows.length)} · as of {fmtDate(page.fetchedAt)}</span>
            <button type="button" className="g-pill g-pill--sm ml-auto" disabled={!page.rows.length} onClick={exportCsv} data-testid="button-content-export"><Download /> Export</button>
          </div>
          {saved.data?.saved === false && <p className="mb-2 text-[13px]" style={{ color: "var(--g-red)" }} role="alert" data-testid="content-unsaved">These results could not be kept, so opening this search again will not be free. Export them now if you need them.</p>}
          {page.rows.length > 0 && (
            <div className="mb-3 flex flex-wrap items-center gap-2 text-[13px]" data-testid="content-metrics-bar">
              {metrics.isError ? (
                <span role="alert" data-testid="content-metrics-error">Couldn't check for saved numbers for these pages: {apiErrorMessage(metrics.error)} Nothing has been charged. <button type="button" className="g-link" onClick={() => void metrics.refetch()}>Try again</button></span>
              ) : !metrics.data?.page ? (
                <>
                  <button type="button" className="g-pill g-pill--sm" disabled={addMetrics.isPending || !status.data?.configured || !canPayMetrics || metrics.isLoading} onClick={() => addMetrics.mutate({ body: metricsBody, key: metricsKey })} data-testid="button-content-metrics">
                    {addMetrics.isPending ? <Loader2 className="animate-spin" /> : null} Add linking sites and search visits for these {pageUrls.length} pages{metricsPrice != null ? ` — up to ${money(metricsPrice)}` : ""}
                  </button>
                  <span className="g-text-2">{metricsPrice == null ? (status.isLoading ? "Getting the price…" : "The price couldn't be loaded, so this can't be bought yet — reload the page.") : !canPayMetrics ? "Not enough SEO data left — add credit above." : "Shows which of these pages are worth learning from, or asking for a link."}</span>
                </>
              ) : (
                <>
                  <label className="g-text-2 flex items-center gap-2">Order these pages by
                    <select className="g-select" value={by} onChange={(e) => setBy(e.target.value as typeof by)} data-testid="select-content-by"><option value="search">The search's own order</option><option value="links">Most linking sites</option><option value="traffic">Most estimated US search visits</option></select>
                  </label>
                  {retry && (
                    <span role="status" data-testid="content-metrics-missing">
                      <span style={wholePart ? { color: "var(--g-red)" } : undefined} className={wholePart ? undefined : "g-text-2"}>
                        {wholePart ? `${wholePart === "links" ? "Linking sites" : "Search visits"} didn't load (not charged).` : `The source gave no figure for ${[retry.links ? `linking sites on ${retry.links} page${retry.links === 1 ? "" : "s"}` : "", retry.traffic ? `search visits on ${retry.traffic} page${retry.traffic === 1 ? "" : "s"}` : ""].filter(Boolean).join(" and ")}; asking again may not change that.`}
                      </span>{" "}
                      <button type="button" className="g-link" disabled={addMetrics.isPending || !status.data?.configured || !canAfford(retry.cents)} onClick={() => addMetrics.mutate({ body: metricsBody, key: metricsKey, retry: true })} data-testid="button-content-metrics-retry">
                        {addMetrics.isPending ? "Trying…" : `Ask again for just those — up to ${money(retry.cents)}`}
                      </button>
                    </span>
                  )}
                </>
              )}
            </div>
          )}
          {page.rows.length === 0 ? <Empty testId="content-empty"><h3>No pages found</h3><p>Try fewer words, or loosen the filters.</p></Empty> : (
            <ul className="space-y-2" data-testid="list-content">
              {ordered.map((r) => (
                <li key={r.url} className="rounded-lg border p-3" style={{ borderColor: "var(--g-divider)", background: "var(--g-surface)" }}>
                  <a href={r.url} target="_blank" rel="noreferrer nofollow" className="g-link text-[15px] font-medium">{r.title}</a>
                  <div className="g-text-2 mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[12px]">
                    <Link href={`/seo/explorer?domain=${encodeURIComponent(r.domain)}`} className="g-link" title={`Open ${r.domain} in Site explorer`}>{r.domain}</Link>
                    <span title="Link strength of the site, 0–100">authority {r.authority ?? "—"}</span>
                    {r.published && <span>published {new Date(`${r.published}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</span>}
                    {r.author && <span>by {r.author}</span>}
                    {metricOf(r.url) && <span className="g-text" data-testid="content-page-metrics"><b className="font-medium tabular-nums">{metricOf(r.url)!.linkingSites == null ? "—" : fmtNum(metricOf(r.url)!.linkingSites)}</b> linking site{metricOf(r.url)!.linkingSites === 1 ? "" : "s"} · <b className="font-medium tabular-nums">{metricOf(r.url)!.traffic == null ? "—" : fmtNum(metricOf(r.url)!.traffic)}</b> <span title="An estimate of visits from Google searches made in the United States, in English">estimated US search visits / mo</span></span>}
                  </div>
                  {r.snippet && <p className="g-text mt-1 text-[13px]">{r.snippet}</p>}
                </li>
              ))}
            </ul>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-2 text-[13px]">
            <button type="button" className="g-pill g-pill--sm" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - limit))} data-testid="button-content-prev">← Previous</button>
            <button type="button" className="g-pill g-pill--sm" disabled={page.sourceRows < limit || (page.total != null && page.offset + page.sourceRows >= page.total) || offset + limit > 950} onClick={() => setOffset(offset + limit)} data-testid="button-content-next">Next →</button>
            <span className="g-text-2">A page you haven't opened yet costs about {price != null ? money(price) : "—"}. A page that matches in several places is listed once per page of results.</span>
          </div>
        </>
      )}
    </SeoShell>
  );
}
