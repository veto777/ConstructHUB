/**
 * /seo/content — Content explorer: search the web for pages about a topic.
 * See who writes about what you sell, how strong their site is and when they
 * published — for content ideas, and for sites worth asking for a link or a
 * mention. Each new page of results shows its price first; a search you have
 * already run reopens free for a day.
 * The address is the state (links.ts): `q`, the filters (`sort`, `since`, `authority`, `kind`) and the page of
 * results (`offset`) are read from it and written by the controls, each active filter is a chip with a clear, and
 * every figure on a result links to the Site explorer view that holds it. Arriving by link never buys: the saved page
 * opens, or the Search button waits.
 */
import { cleanPageUrls, pageKey } from "@shared/seo-page-key";
import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useSearch } from "wouter";
import { seoLinks } from "./links";
import { pathOfUrl } from "./explorer-filters";
import { BLOCK_LINK, Figure, FIG_LINK, TEXT_LINK } from "./viz-keywords";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, Loader2, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiErrorMessage } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { ActiveFilter, api, Empty, fmtDate, fmtNum, isNotRunYet, money, SeoShell, useSelectedSite, useSeoSites, useSeoStatus } from "./shell";
import { PALETTE } from "./viz";

type Row = { url: string; domain: string; title: string; snippet: string | null; authority: number | null; published: string | null; quality: number | null; author: string | null };
type Page = { query: string; rows: Row[]; total: number | null; sourceRows: number; limit: number; offset: number; fetchedAt: string };
type Sort = "relevance" | "authority" | "newest";
type Filters = { sort: Sort; sinceDays?: 30 | 90 | 365 | 730; minAuthority?: number; kind?: string; excludeOwn: boolean };
const KINDS: [string, string][] = [["", "Any kind of site"], ["blogs", "Blogs"], ["news", "News"], ["organization", "Company sites"], ["message-boards", "Forums"], ["ecommerce", "Shops"]];
const SINCE: readonly number[] = [30, 90, 365, 730], AUTHORITY: readonly number[] = [10, 20, 30, 50, 70];
const SINCE_WORDS: Record<number, string> = { 30: "the last 30 days", 90: "the last 3 months", 365: "the last year", 730: "the last 2 years" };
const LIMIT = 25, MAX_OFFSET = 950;
/** The shortest "Published" window that holds a date ("YYYY-MM-DD"), counted in whole days up to today; null when none reaches back that far. */
const sinceFor = (published: string): Filters["sinceDays"] | null => {
  const days = Math.floor((Date.now() - new Date(`${published.slice(0, 10)}T00:00:00Z`).getTime()) / 86_400_000);
  return Number.isFinite(days) ? ((SINCE.find((n) => days <= n) ?? null) as Filters["sinceDays"] | null) : null;
};
const csvCell = (v: string | number | null) => { const s = v == null ? "" : String(v); return `"${(typeof v !== "number" && /^[=+\-@\t\r]/.test(s) ? `'${s}` : s).replace(/"/g, '""')}"`; };
/** A 40 px select, the same as every other on these screens. */
const SELECT = "g-input g-select !w-auto";

export default function SeoContentPage() {
  const status = useSeoStatus();
  const sites = useSeoSites();
  const [site, onSite] = useSelectedSite(sites.data);
  const qc = useQueryClient();
  const { toast } = useToast();
  const [, navigate] = useLocation();
  // The search, its filters and its page, read from the address whenever it changes (a control, a chip's clear, the back button).
  const search = useSearch();
  const address = useMemo(() => {
    const p = new URLSearchParams(search);
    const sort = p.get("sort"), since = Number(p.get("since")), authority = Number(p.get("authority")), kind = p.get("kind"), offset = Number(p.get("offset"));
    return {
      q: p.get("q"), sort: (sort === "authority" || sort === "newest" ? sort : "relevance") as Sort,
      since: SINCE.includes(since) ? (since as Filters["sinceDays"]) : undefined, authority: AUTHORITY.includes(authority) ? authority : undefined,
      kind: kind && KINDS.some(([v]) => v && v === kind) ? kind : undefined,
      offset: Number.isInteger(offset) && offset > 0 && offset % LIMIT === 0 && offset <= MAX_OFFSET ? offset : 0,
    };
  }, [search]);
  const query = address.q && address.q.trim().length >= 2 ? address.q.trim() : null;
  const [input, setInput] = useState(address.q ?? "");
  useEffect(() => { setInput(address.q ?? ""); }, [address.q]);
  const [excludeOwn, setExcludeOwn] = useState(true);
  const f: Filters = { sort: address.sort, sinceDays: address.since, minAuthority: address.authority, kind: address.kind, excludeOwn };
  const offset = address.offset, limit = LIMIT;
  /** The address for this search with some filters changed (the first page unless `offset` is given): what a control writes and a chip's clear removes. */
  const addr = (patch: Partial<typeof address>, q = address.q ?? "") => { const n = { ...address, offset: 0, ...patch }; return seoLinks.content(q, { sort: n.sort === "relevance" ? undefined : n.sort, since: n.since, authority: n.authority, kind: n.kind, offset: n.offset || undefined }); };
  /** How the pages on screen are ordered once their numbers are in (the search's own order until then). */
  const [by, setBy] = useState<"search" | "links" | "traffic">("search");
  const body = useMemo(() => ({ query: query ?? "", sort: f.sort, ...(f.sinceDays ? { sinceDays: f.sinceDays } : {}), ...(f.minAuthority ? { minAuthority: f.minAuthority } : {}), ...(f.kind ? { kind: f.kind } : {}), ...(f.excludeOwn && site ? { exclude: site.domain } : {}), limit, offset }), [query, f, site, offset]); // eslint-disable-line react-hooks/exhaustive-deps
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
  const submit = () => { const q = input.trim(); if (q.length >= 2) navigate(addr({}, q)); };
  const exportCsv = () => {
    if (!page) return;
    const blob = new Blob([[["Title", "URL", "Site", "Authority", "Published", "Author", "Excerpt"], ...page.rows.map((r) => [r.title, r.url, r.domain, r.authority, r.published, r.author, r.snippet])].map((l) => l.map(csvCell).join(",")).join("\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = `content-${page.query.replace(/[^a-z0-9]+/gi, "-")}.csv`; a.click(); URL.revokeObjectURL(a.href);
  };
  const set = (patch: Partial<Filters>) => { if (patch.excludeOwn !== undefined) setExcludeOwn(patch.excludeOwn); else navigate(addr({ ...("sort" in patch ? { sort: patch.sort } : {}), ...("sinceDays" in patch ? { since: patch.sinceDays } : {}), ...("minAuthority" in patch ? { authority: patch.minAuthority } : {}), ...("kind" in patch ? { kind: patch.kind } : {}) })); };
  /** What narrows the search, in words, each with its clear. */
  const chips: { key: string; words: string; href: string }[] = [];
  if (address.sort !== "relevance") chips.push({ key: "sort", words: address.sort === "authority" ? "Strongest sites first" : "Newest first", href: addr({ sort: "relevance" }) });
  if (address.since) chips.push({ key: "since", words: `Published in ${SINCE_WORDS[address.since]}`, href: addr({ since: undefined }) });
  if (address.authority) chips.push({ key: "authority", words: `Site authority ${address.authority} or more`, href: addr({ authority: undefined }) });
  if (address.kind) chips.push({ key: "kind", words: `${KINDS.find(([v]) => v === address.kind)?.[1] ?? address.kind} only`, href: addr({ kind: undefined }) });
  /** The page of a result on its own site, for the Site explorer's page views (its query string kept); null when the address is not on that site. */
  const pagePath = (r: Row) => pathOfUrl(r.url, r.domain);
  const pageView = (r: Row, view: "pages" | "backlinks") => { const path = pagePath(r); return path ? seoLinks.explorer(r.domain, view, { path }) : seoLinks.explorer(r.domain, view); };

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
  // The biggest linking-site count and visit figure on this page of results: each row's bar is its share of them.
  const most = useMemo(() => { const ms = metrics.data?.page?.rows ?? []; return { links: Math.max(0, ...ms.map((m) => m.linkingSites ?? 0)), traffic: Math.max(0, ...ms.map((m) => m.traffic ?? 0)) }; }, [metrics.data]);
  const prevHref = addr({ offset: Math.max(0, offset - limit) }), nextHref = addr({ offset: offset + limit });
  const noNext = !page || page.sourceRows < limit || (page.total != null && page.offset + page.sourceRows >= page.total) || offset + limit > MAX_OFFSET;

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
        <label className="flex items-center gap-2"><span className="g-text-2">Sort</span><select className={SELECT} value={f.sort} onChange={(e) => set({ sort: e.target.value as Sort })} data-testid="select-content-sort"><option value="relevance">Most relevant</option><option value="authority">Strongest sites first</option><option value="newest">Newest first</option></select></label>
        <label className="flex items-center gap-2"><span className="g-text-2">Published</span><select className={SELECT} value={f.sinceDays ?? ""} onChange={(e) => set({ sinceDays: (Number(e.target.value) || undefined) as Filters["sinceDays"] })} data-testid="select-content-since"><option value="">Any time</option><option value="30">Last 30 days</option><option value="90">Last 3 months</option><option value="365">Last year</option><option value="730">Last 2 years</option></select></label>
        <label className="flex items-center gap-2"><span className="g-text-2">Site authority at least</span><select className={SELECT} value={f.minAuthority ?? ""} onChange={(e) => set({ minAuthority: Number(e.target.value) || undefined })} data-testid="select-content-authority"><option value="">Any</option>{[10, 20, 30, 50, 70].map((n) => <option key={n} value={n}>{n}</option>)}</select></label>
        <label className="flex items-center gap-2"><span className="sr-only">Kind of site</span><select className={SELECT} value={f.kind ?? ""} onChange={(e) => set({ kind: e.target.value || undefined })} data-testid="select-content-kind">{KINDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
        {site && <label className="flex min-h-11 items-center gap-2"><input type="checkbox" checked={f.excludeOwn} onChange={(e) => set({ excludeOwn: e.target.checked })} /> <span className="g-text">Leave out {site.domain}</span></label>}
      </div>
      {chips.length > 0 && <div data-testid="content-active-filters">{chips.map((c) => <ActiveFilter key={c.key} onClear={() => navigate(c.href)}>{c.words}</ActiveFilter>)}</div>}
      <p className="g-text-2 mb-4 text-[13px]" data-testid="text-content-cost">Each new page of results costs about {price != null ? <Link href={seoLinks.usage()} className={TEXT_LINK} title="Usage and credit: what lookups cost and what is left this month" data-testid="link-content-price">{money(price)}</Link> : "—"} of your SEO data; a search you have run reopens free for a day. English-language pages.</p>

      {!query && <Empty testId="content-intro"><h3>Find who writes about your trade</h3><p>Search a topic your customers care about — "roof replacement cost", "james hardie vs vinyl siding" — to see the pages already written about it. Use it to plan a better page of your own, and to find blogs, local news and directories worth asking for a mention. Sort by <b>Strongest sites first</b> to see the best-known sites first — authority is one sign of a link worth having, alongside how relevant and local the site is.</p></Empty>}
      {query && saved.isLoading && <p className="g-text-2 flex items-center gap-2 text-[14px]" role="status"><Loader2 className="h-4 w-4 animate-spin" /> Checking for a saved search…</p>}
      {query && saved.isError && <div className="g-callout" role="alert" data-testid="content-error"><h3>Couldn't check for a saved search</h3><p>{apiErrorMessage(saved.error)}</p><button type="button" className="g-pill mt-2" onClick={() => void saved.refetch()}>Try again</button>{offset > 0 && <Link href={prevHref} className="g-pill ml-2 mt-2 !min-h-11" data-testid="button-content-error-back">← Back to the previous results</Link>}</div>}
      {query && saved.isSuccess && !page && (
        <Empty testId="content-not-run">
          <h3>Pages about "{query}"</h3>
          <p>{offset ? "This page of results hasn't been opened yet." : "Not searched yet with these settings."}{!canPay && " You don't have enough SEO data left — add credit above."}</p>
          {offset > 0 && <Link href={prevHref} className="g-pill mr-2 mt-2 !min-h-11" data-testid="button-content-back">← Back to the previous results</Link>}
          <Button className="mt-2" disabled={run.isPending || !status.data?.configured || !canPay} onClick={() => run.mutate({ body, key: queryKey })} data-testid="button-content-run">{run.isPending ? <><Loader2 className="mr-1 h-4 w-4 animate-spin" /> Searching…</> : `${offset ? "Load these results" : "Run the search"}${price != null ? ` — about ${money(price)}` : ""}`}</Button>
        </Empty>
      )}
      {page && (
        <>
          <div className="mb-2 flex flex-wrap items-center gap-2 text-[13px]">
            {/* The count opens the first page of this search; "showing" is this page's own address (the link to share). */}
            <span className="g-text-2" data-testid="text-content-meta">
              <Link href={addr({})} className={TEXT_LINK} title="The first page of these results" data-testid="link-content-total">{page.total != null ? `${fmtNum(page.total)} matches across the web` : `${fmtNum(page.rows.length)} pages`}</Link>
              {" · "}<Link href={addr({ offset })} className={TEXT_LINK} title="This page of results — its own address" data-testid="link-content-showing">showing {fmtNum(page.offset + 1)}–{fmtNum(page.offset + page.rows.length)} · as of {fmtDate(page.fetchedAt)}</Link>
            </span>
            <button type="button" className="g-pill g-pill--sm !min-h-11 ml-auto" disabled={!page.rows.length} onClick={exportCsv} data-testid="button-content-export"><Download /> Export</button>
          </div>
          {saved.data?.saved === false && <p className="mb-2 text-[13px]" style={{ color: "var(--g-red)" }} role="alert" data-testid="content-unsaved">These results could not be kept, so opening this search again will not be free. Export them now if you need them.</p>}
          {page.rows.length > 0 && (
            <div className="mb-3 flex flex-wrap items-center gap-2 text-[13px]" data-testid="content-metrics-bar">
              {metrics.isError ? (
                <span role="alert" data-testid="content-metrics-error">Couldn't check for saved numbers for these pages: {apiErrorMessage(metrics.error)} Nothing has been charged. <button type="button" className="g-link" onClick={() => void metrics.refetch()}>Try again</button></span>
              ) : !metrics.data?.page ? (
                <>
                  <button type="button" className="g-pill g-pill--sm !min-h-11" disabled={addMetrics.isPending || !status.data?.configured || !canPayMetrics || metrics.isLoading} onClick={() => addMetrics.mutate({ body: metricsBody, key: metricsKey })} data-testid="button-content-metrics">
                    {addMetrics.isPending ? <Loader2 className="animate-spin" /> : null} Add linking sites and search visits for these {pageUrls.length} pages{metricsPrice != null ? ` — up to ${money(metricsPrice)}` : ""}
                  </button>
                  <span className="g-text-2">{metricsPrice == null ? (status.isLoading ? "Getting the price…" : "The price couldn't be loaded, so this can't be bought yet — reload the page.") : !canPayMetrics ? "Not enough SEO data left — add credit above." : "Shows which of these pages are worth learning from, or asking for a link."}</span>
                </>
              ) : (
                <>
                  <label className="g-text-2 flex items-center gap-2">Order these pages by
                    <select className={SELECT} value={by} onChange={(e) => setBy(e.target.value as typeof by)} data-testid="select-content-by"><option value="search">The search's own order</option><option value="links">Most linking sites</option><option value="traffic">Most estimated US search visits</option></select>
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
              {/* One card per page: the page and who wrote it on the left; its figures, each with an orange bar, on the right (underneath on a phone). Every figure leads to the Site explorer view that holds it. */}
              {ordered.map((r) => { const m = metricOf(r.url); return (
                <li key={r.url} className="flex min-w-0 flex-col gap-3 rounded-xl border p-3 sm:flex-row sm:items-start sm:p-4" style={{ borderColor: "var(--g-divider)", background: "var(--g-surface)" }}>
                  <div className="min-w-0 flex-1">
                    <a href={r.url} target="_blank" rel="noreferrer nofollow" className={`${TEXT_LINK} text-[15px] font-medium [overflow-wrap:anywhere]`}>{r.title}</a>
                    <div className="g-text-2 mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[12px]">
                      <Link href={seoLinks.explorer(r.domain)} className={`${TEXT_LINK} [overflow-wrap:anywhere]`} title={`Open ${r.domain} in Site explorer`} data-testid="link-content-domain">{r.domain}</Link>
                      {r.published && (() => { const w = sinceFor(r.published); return <Link href={w ? addr({ since: w }) : addr({ sort: "newest", since: undefined })} className={TEXT_LINK} title={w ? `This search narrowed to pages published in ${SINCE_WORDS[w]} — the shortest window that holds this one (a page of results not opened yet waits for its Search button)` : "No window reaches back that far — this search, newest first"} data-testid="link-content-published">published {new Date(`${r.published}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</Link>; })()}
                      {r.author && <span>by {r.author}</span>}
                    </div>
                    {r.snippet && <p className="g-text mt-1 text-[13px]"><Link href={pageView(r, "pages")} className={FIG_LINK} title={`This page in Site explorer${pagePath(r) ? "" : " (the whole site — the address could not be read as a page of it)"}`} data-testid="link-content-snippet">{r.snippet}</Link></p>}
                  </div>
                  <div className="flex flex-wrap gap-x-5 gap-y-2 border-t pt-3 text-[14px] sm:w-[14rem] sm:shrink-0 sm:border-l sm:border-t-0 sm:pl-4 sm:pt-0 lg:w-auto lg:max-w-[26rem]" style={{ borderColor: "var(--g-divider)" }}>
                    <Figure label="Authority" value={r.authority} max={100} color={PALETTE.authority} format={String} title={`Link strength of the site, 0–100 — opens what links to ${r.domain}`} href={seoLinks.explorer(r.domain, "referringDomains")} testId="link-content-authority" />
                    {m && (
                      <span className="contents" data-testid="content-page-metrics">
                        <Figure label={`Linking site${m.linkingSites === 1 ? "" : "s"}`} value={m.linkingSites} max={most.links} color={PALETTE.domains} title={pagePath(r) ? "The backlinks to this page, one per site, in Site explorer" : `The backlinks to ${r.domain} (the page's address could not be read as one of its pages)`} href={pageView(r, "backlinks")} testId="link-content-links" />
                        <Figure label="Estimated US search visits / mo" value={m.traffic} max={most.traffic} color={PALETTE.traffic} title="An estimate of visits from Google searches made in the United States, in English — opens this page in Site explorer" href={pageView(r, "pages")} testId="link-content-traffic" />
                      </span>
                    )}
                  </div>
                </li>
              ); })}
            </ul>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-2 text-[13px]">
            {offset === 0 ? <span className="g-pill g-pill--sm !min-h-11 opacity-50" aria-disabled data-testid="button-content-prev">← Previous</span> : <Link href={prevHref} className={`${BLOCK_LINK} g-pill g-pill--sm`} data-testid="button-content-prev">← Previous</Link>}
            {noNext ? <span className="g-pill g-pill--sm !min-h-11 opacity-50" aria-disabled data-testid="button-content-next">Next →</span> : <Link href={nextHref} className={`${BLOCK_LINK} g-pill g-pill--sm`} data-testid="button-content-next">Next →</Link>}
            <span className="g-text-2">A page you haven't opened yet costs about {price != null ? <Link href={seoLinks.usage()} className={TEXT_LINK} title="Usage and credit: what lookups cost and what is left this month" data-testid="link-content-page-price">{money(price)}</Link> : "—"}. A page that matches in several places is listed once per page of results.</span>
          </div>
        </>
      )}
    </SeoShell>
  );
}
