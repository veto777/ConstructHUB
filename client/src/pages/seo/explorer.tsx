/**
 * /seo/explorer — Site Explorer: type any domain and get its authority and
 * backlink profile, organic and paid search footprint, six months of history,
 * top keywords and pages, organic competitors, referring domains and anchors.
 * One report is charged to the account's SEO data credit; a saved report is free to
 * reopen for a week (server/seo/explorer.ts). White-label: no vendor, no price.
 * Looks like the dashboard (owner, 10/8): blue wording, orange graphs; green and red only mean better or worse.
 */
import { DirectoriesView } from "./directories";
import { MentionsView } from "./mentions";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { holdNote, isNotRunYet, refreshSeoData } from "./shell";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Area, CartesianGrid, ComposedChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ExternalLink, Loader2, Plus, RefreshCw, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiErrorMessage } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { api, canAfford, Empty, fmtDate, fmtNum, priceOf, SeoShell, useSelectedSite, useSeoSites, useSeoStatus } from "./shell";
import { compact, DeltaBadge, DistributionBar, GradientSpark, MetricColumn, monthLabel, PALETTE, TOOLTIP, TrendPanel } from "./viz";
import { BarRows, change, DifficultyBadge, Kicker, PositionBadge, ShareBar } from "./viz-explorer";
import { ReportView, REPORT_NOTE, type TableKey as ReportKey } from "./report-table";
import { GapView } from "./gap";
import { OpportunitiesView } from "./opportunities";
import { MarketPicker, useMarket } from "./market";
import { findMarket, marketKey, marketLabel, type SeoMarket } from "@shared/seo-markets";
import { AddToList } from "./keyword-lists";

type GapKey = "contentGap" | "linkIntersect" | "opportunities" | "directories" | "mentions";
type ViewKey = ReportKey | GapKey | "overview";

type Footprint = {
  keywords: number; traffic: number; trafficValue: number;
  positions: { top3: number; top10: number; top20: number; top50: number; top100: number };
  isNew: number; isUp: number; isDown: number; isLost: number;
};
type Report = {
  domain: string; locationCode?: number; languageCode?: string; fetchedAt: string;
  organic: Footprint; paid: Footprint;
  links: {
    authority: number | null; backlinks: number | null; referringDomains: number | null; followedDomains: number | null; nofollowDomains: number | null;
    referringIps: number | null; brokenBacklinks: number | null; spamScore: number | null; firstSeen: string | null; tlds: { tld: string; links: number }[];
  };
  history: { month: string; traffic: number; keywords: number; top3: number; top10: number; trafficValue: number }[] | null;
  linkHistory?: { month: string; backlinks: number; referringDomains: number; newBacklinks: number; lostBacklinks: number; authority: number | null }[] | null;
  keywords: { keyword: string; position: number | null; volume: number | null; traffic: number | null; trafficValue: number | null; cpc: number | null; difficulty: number | null; intent: string | null; url: string | null }[] | null;
  keywordsTotal: number | null;
  intents: { intent: string; keywords: number; traffic: number }[] | null;
  pages: { url: string; traffic: number; keywords: number; trafficValue: number; top10: number }[] | null;
  pagesTotal: number | null;
  competitors: { domain: string; commonKeywords: number; avgPosition: number | null; traffic: number; keywords: number }[] | null;
  referringDomains: { domain: string; authority: number | null; backlinks: number | null; firstSeen: string | null; spamScore: number | null; followed: boolean }[] | null;
  anchors: { anchor: string; backlinks: number | null; referringDomains: number | null; firstSeen: string | null }[] | null;
  missing: string[];
};
type Recent = { items: { domain: string; locationCode?: number; languageCode?: string; fetchedAt: string; authority: number | null; referringDomains: number | null; keywords: number | null; traffic: number | null }[]; freeForDays: number };

const usd = (n: number | null | undefined) => n == null ? "—" : `$${Math.round(n).toLocaleString("en-US")}`;
const stripUrl = (u: string) => u.replace(/^https?:\/\/(www\.)?/, "");
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const SURFACE = { borderColor: "var(--g-divider)", background: "var(--g-surface)" } as const;
/** The largest of a column's numbers, for the share bars beside them. */
const maxOf = (xs: (number | null | undefined)[]) => Math.max(0, ...xs.map((x) => x ?? 0));

/** A card with a blue title and an optional note on the right. */
function Panel({ title, hint, children, testId, className = "" }: { title: string; hint?: ReactNode; children: ReactNode; testId?: string; className?: string }) {
  return (
    <section className={`min-w-0 rounded-xl border p-3 sm:p-4 ${className}`} style={SURFACE} data-testid={testId}>
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-[14px] font-medium" style={{ color: "var(--g-blue)" }}>{title}</h2>
        {hint && <span className="g-text-2 text-[12px]">{hint}</span>}
      </div>
      {children}
    </section>
  );
}

/** One figure's column in the headline row: a thin divider on its left from the second column on (not on a phone). */
function Col({ children, first = false }: { children: ReactNode; first?: boolean }) {
  return <div className={`min-w-0 px-1 sm:px-3 ${first ? "" : "sm:border-l"}`} style={{ borderColor: "var(--g-divider)" }}>{children}</div>;
}

/** The left menu, grouped the way Site Explorer groups its reports. */
const MENU: { group: string; items: [ViewKey, string][] }[] = [
  { group: "", items: [["overview", "Overview"], ["opportunities", "Opportunities"]] },
  { group: "Backlink profile", items: [["backlinks", "Backlinks"], ["newBacklinks", "New backlinks"], ["lostBacklinks", "Lost backlinks"], ["brokenBacklinks", "Broken backlinks"], ["referringDomains", "Referring domains"], ["anchors", "Anchors"], ["referringIps", "Referring IPs"], ["linkCompetitors", "Sites with similar links"], ["linkIntersect", "Link intersect"], ["directories", "Directories"], ["mentions", "Mentions"], ["bestByLinks", "Best pages by links"]] },
  { group: "Organic search", items: [["keywords", "Organic keywords"], ["pages", "Top pages"], ["competitors", "Organic competitors"], ["subdomains", "Subdomains"], ["contentGap", "Content gap"]] },
  { group: "Paid search", items: [["paidKeywords", "Paid keywords"], ["ads", "Ads"]] },
];
const MENU_LABEL = Object.fromEntries(MENU.flatMap((g) => g.items)) as Record<string, string>;

const TABLES = ["keywords", "pages", "competitors", "referringDomains", "anchors"] as const;
type TableKey = (typeof TABLES)[number];
const TABLE_LABEL: Record<TableKey, string> = { keywords: "Organic keywords", pages: "Top pages", competitors: "Organic competitors", referringDomains: "Referring domains", anchors: "Anchors" };

/**
 * Compare two months: any two months of the saved history side by side (organic search from two years of monthly
 * estimates, links from one year). Free — it only reads the report already on screen.
 */
function CompareMonths({ report }: { report: Report }) {
  const months = useMemo(() => [...new Set([...(report.history ?? []).map((h) => h.month), ...(report.linkHistory ?? []).map((h) => h.month)])].sort(), [report]);
  const [open, setOpen] = useState(false);
  const [a, setA] = useState<string | null>(null), [b, setB] = useState<string | null>(null);
  // A different report: the choice starts again (the newest month against the same month a year earlier, or the oldest there is).
  useEffect(() => {
    const last = months[months.length - 1] ?? null; setB(last);
    // The same calendar month a year earlier when the history has it; otherwise the oldest month there is.
    const yearAgo = last ? `${Number(last.slice(0, 4)) - 1}${last.slice(4)}` : null;
    setA(yearAgo && months.includes(yearAgo) ? yearAgo : months[0] ?? null);
  }, [months]);
  if (months.length < 2) return null;
  const h = (m: string | null) => (report.history ?? []).find((x) => x.month === m) ?? null, l = (m: string | null) => (report.linkHistory ?? []).find((x) => x.month === m) ?? null;
  const rows: [string, number | null | undefined, number | null | undefined, boolean][] = [
    ["Organic traffic / mo", h(a)?.traffic, h(b)?.traffic, false], ["Organic keywords", h(a)?.keywords, h(b)?.keywords, false], ["Keywords in the top 3", h(a)?.top3, h(b)?.top3, false],
    ["Keywords in the top 10", h(a)?.top10, h(b)?.top10, false], ["Traffic value / mo", h(a)?.trafficValue, h(b)?.trafficValue, true],
    ["Referring domains", l(a)?.referringDomains, l(b)?.referringDomains, false], ["Backlinks", l(a)?.backlinks, l(b)?.backlinks, false], ["Authority", l(a)?.authority, l(b)?.authority, false],
  ];
  const show = (v: number | null | undefined, money: boolean) => (v == null ? "—" : money ? usd(v) : fmtNum(v));
  return (
    <section className="mb-4" data-testid="panel-compare">
      <button type="button" className="g-pill g-pill--sm" aria-expanded={open} onClick={() => setOpen(!open)} data-testid="button-compare">{open ? "Hide the comparison" : "Compare two months"}</button>
      {open && (
        <div className="mt-3 rounded-xl border p-3 sm:p-4" style={SURFACE}>
          <div className="mb-3 flex flex-wrap items-center gap-3 text-[13px]">
            <label className="g-text-2 flex items-center gap-2">From <select className="g-input g-select !w-auto !py-1" value={a ?? ""} onChange={(e) => setA(e.target.value)} data-testid="select-compare-from">{months.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}</select></label>
            <label className="g-text-2 flex items-center gap-2">to <select className="g-input g-select !w-auto !py-1" value={b ?? ""} onChange={(e) => setB(e.target.value)} data-testid="select-compare-to">{months.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}</select></label>
          </div>
          <table className="g-table" data-testid="table-compare">
            <thead><tr><th>Measure</th><th className="num">{a ? monthLabel(a) : "—"}</th><th className="num">{b ? monthLabel(b) : "—"}</th><th className="num">Change</th></tr></thead>
            <tbody>{rows.map(([label, x, y, money]) => {
              const d = x != null && y != null ? y - x : null;
              return (
                <tr key={label}>
                  <td>{label}</td><td className="num" data-label="From">{show(x, money)}</td><td className="num" data-label="To">{show(y, money)}</td>
                  <td className="num" data-label="Change">{d == null ? <span className="g-text-2">—</span> : d === 0 ? <span className="g-text-2">no change</span> : <span className={`g-move ${d > 0 ? "g-move--up" : "g-move--down"}`}>{d > 0 ? "▲" : "▼"} {money ? usd(Math.abs(d)) : fmtNum(Math.abs(d))}{x ? ` (${d > 0 ? "+" : "−"}${Math.abs(Math.round((d / x) * 100))}%)` : ""}</span>}</td>
                </tr>
              );
            })}</tbody>
          </table>
          <p className="g-text-2 mt-2 text-[12px]">Search figures are monthly estimates going back two years; link figures go back one year. A dash means there is no figure for that month — it is outside what is kept, that part of the report did not load, or the source has none. The newest month can still be filling in. Nothing is bought to compare.</p>
        </div>
      )}
    </section>
  );
}

export default function SeoExplorerPage() {
  const status = useSeoStatus();
  const sites = useSeoSites();
  const [site, onSite] = useSelectedSite(sites.data);
  const qc = useQueryClient();
  const { toast } = useToast();
  const [input, setInput] = useState(() => new URLSearchParams(window.location.search).get("domain") ?? "");
  const [domain, setDomain] = useState<string | null>(() => new URLSearchParams(window.location.search).get("domain"));
  const [report, setReport] = useState<Report | null>(null);
  const [table, setTable] = useState<TableKey>("keywords");
  // ?view=<report> opens that report (an alert links straight to Mentions); anything else is the overview.
  const [view, setView] = useState<ViewKey>(() => { const v = new URLSearchParams(window.location.search).get("view"); return v && Object.prototype.hasOwnProperty.call(MENU_LABEL, v) ? (v as ViewKey) : "overview"; });
  const [market, setMarket] = useMarket();
  const mk = { locationCode: market.locationCode, languageCode: market.languageCode };
  /** Another country is another report: what is on screen is put away first. */
  const changeMarket = (m: SeoMarket) => { if (marketKey(m) === marketKey(market)) return; setReport(null); setView("overview"); setMarket(m); };

  const recent = useQuery<Recent>({ queryKey: ["/api/seo/explorer/recent"] });
  // A saved report opens without spending anything; 404 just means "not looked up yet".
  const saved = useQuery<{ report: Report; fresh: boolean }>({
    queryKey: [`/api/seo/explorer?domain=${encodeURIComponent(domain ?? "")}&locationCode=${market.locationCode}&languageCode=${market.languageCode}`], enabled: !!domain && !report, retry: false,
  });
  useEffect(() => { if (saved.data?.report && !report) setReport(saved.data.report); }, [saved.data, report]);

  const analyse = useMutation({
    mutationFn: (v: { domain: string; refresh: boolean }) => api("POST", "/api/seo/explorer", { ...v, ...mk }),
    onSuccess: (data: { report: Report; reused: boolean; saved?: boolean }) => {
      if (data.saved === false) toast({ title: "Shown, but it couldn't be kept", description: "Opening this report again will not be free.", variant: "destructive" });
      setReport(data.report); setDomain(data.report.domain); setInput(data.report.domain);
      window.history.replaceState({}, "", `/seo/explorer?domain=${encodeURIComponent(data.report.domain)}`);
      void qc.invalidateQueries({ queryKey: ["/api/seo/explorer/recent"] });
      void qc.invalidateQueries({ queryKey: ["/api/seo/status"] });
    },
    onError: (e) => toast({ title: "Couldn't analyse that domain", description: apiErrorMessage(e), variant: "destructive" }),
  });
  const tracksHere = (siteId: number) => { const s = (sites.data ?? []).find((x) => x.id === siteId); return !!s && s.locationCode === market.locationCode && s.languageCode === market.languageCode; };
  const trackKeywords = useMutation({
    mutationFn: (v: { siteId: number; rows: { keyword: string; volume: number | null; cpc: number | null; difficulty: number | null }[] }) =>
      // Numbers from another country are not the tracked site's numbers: the keywords go in without them.
      api("POST", `/api/seo/sites/${v.siteId}/keywords`, { keywords: v.rows.map((r) => r.keyword), ...(tracksHere(v.siteId) ? { volumes: v.rows.map((r) => ({ keyword: r.keyword, searchVolume: r.volume, cpc: r.cpc, difficulty: r.difficulty })) } : {}) }),
    onSuccess: (r: { added: number }, v) => { refreshSeoData(qc); toast({ title: `${r.added} keyword${r.added === 1 ? "" : "s"} added to the rank tracker`, description: tracksHere(v.siteId) ? undefined : `These numbers are for ${market.label}, not the country that site is tracked in, so they were not copied.` }); },
    onError: (e) => toast({ title: "Couldn't track", description: apiErrorMessage(e), variant: "destructive" }),
  });
  const track = useMutation({
    mutationFn: (d: string) => api("POST", "/api/seo/sites", { domain: d, devices: "both", serpDepth: 10 }),
    onSuccess: (s: { id: number }) => { void qc.invalidateQueries({ queryKey: ["/api/seo/sites"] }); void qc.invalidateQueries({ queryKey: ["/api/seo/dashboard"] }); onSite(s.id); toast({ title: "Added to the rank tracker", description: "Add the keywords you care about under Rank tracker." }); },
    onError: (e) => toast({ title: "Couldn't add the site", description: apiErrorMessage(e), variant: "destructive" }),
  });

  const open = (d: string) => { setReport(null); setView("overview"); setDomain(d); setInput(d); window.history.replaceState({}, "", `/seo/explorer?domain=${encodeURIComponent(d)}`); };
  const submit = (refresh = false) => { const d = input.trim(); if (d) { if (!refresh) setReport(null); analyse.mutate({ domain: d, refresh }); } };
  const configured = !!status.data?.configured;
  const affordable = canAfford(status.data, "explorerReport");
  const trackedSite = report ? (sites.data ?? []).find((s) => s.domain === report.domain) ?? null : null;
  const tracked = !!trackedSite;
  const busy = analyse.isPending || (saved.isLoading && !!domain && !report);
  const savedMissing = saved.isError && isNotRunYet(saved.error);
  const notFoundYet = !!domain && !report && savedMissing && !analyse.isPending;
  const savedFailed = !!domain && !report && saved.isError && !savedMissing && !analyse.isPending;

  // Keywords by where they rank: each band on its own, from the cumulative counts the report keeps.
  const positions = useMemo(() => {
    if (!report) return [];
    const p = report.organic.positions;
    return [{ label: "1–3", value: p.top3 }, { label: "4–10", value: p.top10 - p.top3 }, { label: "11–20", value: p.top20 - p.top10 }, { label: "21–50", value: p.top50 - p.top20 }, { label: "51–100", value: p.top100 - p.top50 }];
  }, [report]);
  const followedPct = report?.links.referringDomains ? Math.round(((report.links.followedDomains ?? 0) / report.links.referringDomains) * 1000) / 10 : null;
  // The monthly series behind the headline figures (oldest first), for the small trend charts and their changes.
  const hist = report?.history ?? [], links = report?.linkHistory ?? [];
  const spark = (points: { label: string; value: number }[] | undefined, color: string) => <GradientSpark range height={48} points={points} color={color} />;

  return (
    <SeoShell title="Site explorer" description="Any website's estimated search traffic, keywords, backlinks and competitors — yours or a competitor's." site={site} onSite={onSite} sites={sites} status={status} picker={false}>
      <form className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center" onSubmit={(e) => { e.preventDefault(); submit(false); }} data-testid="form-explorer">
        <label className="relative min-w-0 flex-1 sm:max-w-xl">
          <span className="sr-only">Domain</span>
          <Search className="g-text-2 pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2" aria-hidden />
          <input className="g-input w-full pl-9" placeholder="example.com" value={input} onChange={(e) => setInput(e.target.value)} data-testid="input-explorer-domain" autoComplete="off" spellCheck={false} />
        </label>
        <MarketPicker value={market} onChange={changeMarket} disabled={analyse.isPending} />
        <Button type="submit" disabled={busy || !input.trim() || !configured} data-testid="button-explorer-analyse" title={!configured ? "Being switched on for your account" : undefined}>
          {analyse.isPending ? <><Loader2 className="mr-1 h-4 w-4 animate-spin" /> Analysing…</> : "Analyse"}
        </Button>
        {site && site.domain !== input.trim() && <button type="button" className="g-pill" onClick={() => { setInput(site.domain); open(site.domain); }} data-testid="button-explorer-my-site">My site: {site.domain}</button>}
      </form>
      <p className="g-text-2 mb-4 text-[13px]" data-testid="text-explorer-cost">
        A new report costs {priceOf(status.data, "explorerReport")} of your SEO data. Reopening a saved one is free for {recent.data?.freeForDays ?? 7} days.{holdNote(status.data, "explorerReport")}{!affordable && " You don't have enough SEO data left for a new report — add credit above."}
      </p>

      {!report && !busy && (recent.data?.items.length ?? 0) > 0 && (
        <Panel title="Recently analysed" testId="panel-explorer-recent" className="mb-4">
          <table className="g-table">
            <thead><tr><th>Domain</th><th className="num">Authority</th><th className="num">Referring domains</th><th className="num">Organic keywords</th><th className="num">Organic traffic (est.)</th><th className="num">Analysed</th></tr></thead>
            <tbody>
              {recent.data!.items.map((r) => (
                <tr key={`${r.domain}:${r.locationCode}:${r.languageCode}`}>
                  <td><button type="button" className="g-link" onClick={() => { const m = findMarket(r.locationCode ?? 2840, r.languageCode ?? "en"); if (m) setMarket(m); open(r.domain); }} data-testid={`button-open-${r.domain}`}>{r.domain}</button>{(r.locationCode ?? 2840) !== 2840 || (r.languageCode ?? "en") !== "en" ? <span className="g-text-2 ml-2 text-[12px]">{marketLabel(r.locationCode, r.languageCode)}</span> : null}</td>
                  <td className="num" data-label="Authority">{r.authority ?? "—"}</td>
                  <td className="num" data-label="Referring domains">{fmtNum(r.referringDomains)}</td>
                  <td className="num" data-label="Organic keywords">{fmtNum(r.keywords)}</td>
                  <td className="num" data-label="Organic traffic">{fmtNum(r.traffic)}</td>
                  <td className="num g-text-2" data-label="Analysed">{fmtDate(r.fetchedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      )}
      {busy && <p className="g-text-2 flex items-center gap-2 text-[14px]" role="status" data-testid="text-explorer-loading"><Loader2 className="h-4 w-4 animate-spin" /> {analyse.isPending ? "Gathering search and backlink data — about ten seconds…" : "Opening the saved report…"}</p>}
      {savedFailed && <div className="g-callout" role="alert" data-testid="explorer-saved-error"><h3>Couldn't check for a saved report</h3><p>{apiErrorMessage(saved.error)}</p><button type="button" className="g-pill mt-2" onClick={() => void saved.refetch()}>Try again</button></div>}
      {notFoundYet && <Empty testId="explorer-empty"><h3>No report for {domain} yet</h3><p>Press <b>Analyse</b> to build one.</p></Empty>}
      {notFoundYet && domain && (
        <section className="mt-5" data-testid="explorer-opportunities-only">
          <h2 className="g-text mb-1 text-[17px] font-medium">Or just the opportunities</h2>
          <p className="g-text-2 mb-3 text-[13px]">This one lookup does not need the full report.</p>
          <OpportunitiesView key={`solo:${domain}:${marketKey(market)}`} domain={domain} status={status.data} market={market} />
        </section>
      )}
      {!report && !busy && !domain && (recent.data?.items.length ?? 0) === 0 && (
        <Empty testId="explorer-intro"><h3>Look up any website</h3><p>Enter a domain to see an estimate of how much search traffic it gets, which keywords and pages earn it, who links to it and who it competes with.</p></Empty>
      )}

      {report && (
        <div data-testid="explorer-report">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-[16px] font-semibold uppercase" style={{ color: "var(--g-blue)", background: "var(--g-accent-soft)" }} aria-hidden>{report.domain.replace(/^www\./, "")[0]}</span>
            <div className="min-w-0">
              <h2 className="g-text text-[18px] font-semibold leading-6 [overflow-wrap:anywhere]">Overview: <a href={`https://${report.domain}`} target="_blank" rel="noreferrer" className="g-link">{report.domain} <ExternalLink className="inline h-3.5 w-3.5" aria-hidden /></a></h2>
              <span className="g-text-2 text-[12px]" data-testid="text-explorer-fetched">{marketLabel(report.locationCode ?? 2840, report.languageCode ?? "en")} · as of {fmtDate(report.fetchedAt)}</span>
            </div>
            <div className="ml-auto flex flex-wrap gap-2">
              {!tracked && <button type="button" className="g-pill g-pill--sm" disabled={track.isPending} onClick={() => track.mutate(report.domain)} data-testid="button-explorer-track"><Plus /> Track rankings</button>}
              <button type="button" className="g-pill g-pill--sm" disabled={analyse.isPending || !configured} onClick={() => { setInput(report.domain); analyse.mutate({ domain: report.domain, refresh: true }); }} data-testid="button-explorer-refresh"><RefreshCw className={analyse.isPending ? "animate-spin" : ""} /> Refresh</button>
            </div>
          </div>
          {report.missing.length > 0 && <p className="g-text-2 mb-3 text-[13px]" role="status" data-testid="text-explorer-missing">Some sections didn't load this time ({report.missing.map((m) => TABLE_LABEL[m as TableKey] ?? cap(m)).join(", ")}). Refresh to try again.</p>}

          <div className="flex flex-col gap-5 lg:flex-row">
            <nav className="flex-none lg:w-48" aria-label="Site explorer reports" data-testid="explorer-menu">
              {MENU.map((g) => (
                <div key={g.group || "top"} className="mb-3">
                  {g.group && <div className="mb-1 text-[11px] font-medium uppercase tracking-wide" style={{ color: "var(--g-blue)" }}>{g.group}</div>}
                  <div className="flex flex-wrap gap-1 lg:flex-col lg:gap-0">
                    {g.items.map(([key, label]) => (
                      <button key={key} type="button" onClick={() => setView(key)} aria-current={view === key ? "page" : undefined} data-testid={`menu-${key}`}
                        className={`rounded-md px-2 py-1 text-left text-[13px] ${view === key ? "font-medium" : "g-text-2"}`} style={view === key ? { color: "var(--g-blue)", background: "var(--g-accent-soft)" } : undefined}>{label}</button>
                    ))}
                  </div>
                </div>
              ))}
            </nav>
            <div className="min-w-0 flex-1">
          {view !== "overview" ? (
            <>
              <h3 className="g-text mb-3 text-[17px] font-medium" data-testid="text-report-title">{MENU_LABEL[view]}</h3>
              {view === "mentions" ? (
                trackedSite ? <MentionsView key={trackedSite.id} siteId={trackedSite.id} domain={trackedSite.domain} status={status.data} />
                  : <p className="g-text-2 text-[13px]" data-testid="mentions-untracked">Mentions are looked for on your own sites: press <b>Track rankings</b> above to add {report.domain}, then open this again.</p>
              ) : view === "directories" ? (
                <DirectoriesView domain={report.domain} status={status.data} suggestions={(report.competitors ?? []).map((c) => c.domain)} planSiteId={trackedSite?.id} />
              ) : view === "opportunities" ? (
                <OpportunitiesView key={`${report.domain}:${marketKey(market)}`} domain={report.domain} status={status.data} market={market} planSiteId={trackedSite?.id} onTrack={trackedSite ? (rows) => trackKeywords.mutate({ siteId: trackedSite.id, rows }) : undefined} />
              ) : view === "contentGap" || view === "linkIntersect" ? (
                <GapView planSiteId={trackedSite?.id} market={market} kind={view === "contentGap" ? "content" : "links"} domain={report.domain} status={status.data} suggestions={(report.competitors ?? []).map((c) => c.domain)}
                  onExplore={(d) => { setInput(d); open(d); }} onTrack={trackedSite ? (rows) => trackKeywords.mutate({ siteId: trackedSite.id, rows }) : undefined} />
              ) : (<>
                {REPORT_NOTE[view] && <p className="g-text-2 mb-3 text-[13px]" data-testid="text-report-note">{REPORT_NOTE[view]}</p>}
                <ReportView key={`${view}:${report.domain}:${marketKey(market)}`} market={market} table={view} domain={report.domain} status={status.data} onExplore={(d) => { setInput(d); open(d); }} extraAction={(rows, clear) => <AddToList market={market} rows={rows} onDone={clear} />}
                  onTrack={trackedSite ? (rows) => trackKeywords.mutateAsync({ siteId: trackedSite.id, rows }) : undefined} trackLabel="Add to rank tracker" />
              </>)}
              {(view === "keywords" || view === "paidKeywords") && !trackedSite && <p className="g-text-2 mt-2 text-[13px]">Press <b>Track rankings</b> above to follow this site's keywords every week.</p>}
            </>
          ) : (
          <>
          {/* The headline figures as one card: backlinks and organic search side by side on a wide screen, paid search on a
              row of its own under them (beside the report menu, seven columns in one row would be too narrow to read). */}
          <div className="mb-4 rounded-xl border p-3 sm:p-4" style={SURFACE} data-testid="explorer-figures">
            <div className="grid gap-y-5 xl:grid-cols-[3fr_2fr] xl:gap-x-5">
              <section className="min-w-0" data-testid="panel-backlinks">
                <Kicker>Backlink profile</Kicker>
                <div className="grid grid-cols-2 gap-x-2 gap-y-5 sm:grid-cols-3">
                  <Col first><MetricColumn label="Authority" testId="stat-authority" value={report.links.authority ?? "—"} delta={<DeltaBadge value={change(links.map((h) => h.authority))} label="Change over the months shown" />} foot="link strength, 0–100"
                    chart={spark(links.filter((h) => h.authority != null).map((h) => ({ label: monthLabel(h.month), value: h.authority as number })), PALETTE.authority)} /></Col>
                  <Col><MetricColumn label="Backlinks" testId="stat-backlinks" value={compact(report.links.backlinks)} delta={<DeltaBadge value={change(links.map((h) => h.backlinks))} label="Change over the months shown" />} foot={report.links.brokenBacklinks != null ? `${compact(report.links.brokenBacklinks)} broken` : undefined}
                    chart={spark(links.map((h) => ({ label: monthLabel(h.month), value: h.backlinks })), PALETTE.backlinks)} /></Col>
                  <Col><MetricColumn label="Referring domains" testId="stat-ref-domains" value={compact(report.links.referringDomains)} delta={<DeltaBadge value={change(links.map((h) => h.referringDomains))} label="Change over the months shown" />} foot={report.links.referringIps != null ? `${compact(report.links.referringIps)} IPs` : undefined}
                    chart={spark(links.map((h) => ({ label: monthLabel(h.month), value: h.referringDomains })), PALETTE.domains)} /></Col>
                </div>
              </section>
              <section className="min-w-0 border-t pt-5 xl:border-l xl:border-t-0 xl:pl-5 xl:pt-0" style={{ borderColor: "var(--g-divider)" }} data-testid="panel-organic">
                <Kicker>Organic search</Kicker>
                <div className="grid grid-cols-2 gap-x-2 gap-y-5">
                  <Col first><MetricColumn label="Organic keywords" testId="stat-organic-keywords" value={compact(report.organic.keywords)} delta={<DeltaBadge value={change(hist.map((h) => h.keywords))} label="Change over the months shown" />}
                    chart={spark(hist.map((h) => ({ label: monthLabel(h.month), value: h.keywords })), PALETTE.keywords)}>
                    <div className="mt-1.5"><DistributionBar parts={[{ label: "Top 3", value: report.organic.positions.top3, color: PALETTE.top3 }, { label: "4–10", value: Math.max(0, report.organic.positions.top10 - report.organic.positions.top3), color: PALETTE.top10 }, { label: "11+", value: Math.max(0, report.organic.keywords - report.organic.positions.top10), color: PALETTE.rest }]} /></div>
                  </MetricColumn></Col>
                  <Col><MetricColumn label="Organic traffic (estimate)" testId="stat-organic-traffic" value={compact(report.organic.traffic)} delta={<DeltaBadge value={change(hist.map((h) => h.traffic))} label="Change over the months shown" />} foot={`Visits a month, estimated from rankings · worth ${usd(report.organic.trafficValue)} / mo as ads`}
                    chart={spark(hist.map((h) => ({ label: monthLabel(h.month), value: h.traffic })), PALETTE.traffic)} /></Col>
                </div>
                <p className="g-text-2 mt-3 text-[12px]" data-testid="text-organic-movement">
                  Since last month: <span style={{ color: "var(--g-green)" }}>▲ {fmtNum(report.organic.isUp)} up</span> · <span style={{ color: "var(--g-red)" }}>▼ {fmtNum(report.organic.isDown)} down</span> · {fmtNum(report.organic.isNew)} new · {fmtNum(report.organic.isLost)} lost
                </p>
              </section>
              <section className="min-w-0 border-t pt-5 xl:col-span-2" style={{ borderColor: "var(--g-divider)" }} data-testid="panel-paid">
                <Kicker>Paid search</Kicker>
                <div className="grid grid-cols-2 gap-x-2 gap-y-5 sm:grid-cols-3 xl:grid-cols-5">
                  <Col first><MetricColumn label="Paid keywords" testId="stat-paid-keywords" value={compact(report.paid.keywords)} /></Col>
                  <Col><MetricColumn label="Paid traffic" testId="stat-paid-traffic" value={compact(report.paid.traffic)} foot={`Est. cost ${usd(report.paid.trafficValue)} / mo`} /></Col>
                </div>
                {report.paid.keywords === 0 && <p className="g-text-2 mt-3 text-[12px]">No Google Ads seen for this domain.</p>}
              </section>
            </div>
          </div>

          <CompareMonths report={report} />
          <div className="mb-4 grid gap-4 lg:grid-cols-3">
            <section className="min-w-0 lg:col-span-2" data-testid="panel-performance">
              {hist.length > 1 ? (
                <div data-testid="chart-performance">
                  <TrendPanel key={report.domain} title="Performance" testId="check-series" note="Monthly estimates from the keyword database."
                    series={[
                      { key: "traffic", label: "Organic traffic (estimate)", color: PALETTE.traffic, points: hist.map((h) => ({ label: monthLabel(h.month), value: h.traffic })) },
                      { key: "keywords", label: "Organic keywords", color: PALETTE.keywords, points: hist.map((h) => ({ label: monthLabel(h.month), value: h.keywords })) },
                      { key: "top10", label: "Keywords in top 10", color: PALETTE.keywords, points: hist.map((h) => ({ label: monthLabel(h.month), value: h.top10 })) },
                    ]} />
                </div>
              ) : <Panel title="Performance" hint="estimated, by month"><p className="g-text-2 text-[13px]">No history for this domain yet.</p></Panel>}
            </section>
            <div className="flex min-w-0 flex-col gap-4">
              <Panel title="Organic positions" hint="keywords by rank" testId="panel-positions">
                <BarRows rows={positions} />
              </Panel>
              <Panel title="Referring domains" testId="panel-followed">
                {report.links.referringDomains ? (
                  <BarRows of={report.links.referringDomains} rows={[
                    { label: "Followed", value: report.links.followedDomains, hint: followedPct == null ? undefined : `${followedPct}%` },
                    { label: "Not followed", value: report.links.nofollowDomains, hint: followedPct == null ? undefined : `${Math.round((100 - followedPct) * 10) / 10}%` },
                  ]} />
                ) : <p className="g-text-2 text-[13px]">No referring domains found.</p>}
              </Panel>
              {(report.links.tlds ?? []).length > 0 && (
                <Panel title="Backlinks by domain ending" hint="the top 6" testId="panel-tlds">
                  <BarRows rows={report.links.tlds.map((t) => ({ label: `.${t.tld}`, value: t.links }))} />
                </Panel>
              )}
            </div>
          </div>

          {links.length > 1 && (
            <section className="mb-4" data-testid="panel-link-history">
              <div data-testid="chart-link-history">
                <TrendPanel key={report.domain} title="Backlink growth" testId="link-history" note="Monthly, from the backlink index — the last 12 months. New and lost are the links gained and lost in that month."
                  series={[
                    { key: "domains", label: "Referring domains", color: PALETTE.domains, points: links.map((h) => ({ label: monthLabel(h.month), value: h.referringDomains })) },
                    { key: "backlinks", label: "Backlinks", color: PALETTE.backlinks, points: links.map((h) => ({ label: monthLabel(h.month), value: h.backlinks })) },
                    { key: "new", label: "New links that month", color: PALETTE.backlinks, points: links.map((h) => ({ label: monthLabel(h.month), value: h.newBacklinks })) },
                    { key: "lost", label: "Lost links that month", color: PALETTE.backlinks, points: links.map((h) => ({ label: monthLabel(h.month), value: h.lostBacklinks })) },
                  ]} />
              </div>
            </section>
          )}
          {hist.length > 1 && (
            <Panel title="Organic keywords by position" hint="by month" testId="panel-position-history" className="mb-4">
              <div className="h-44 sm:h-56" aria-hidden>
                <ResponsiveContainer>
                  <ComposedChart data={hist.map((h) => ({ month: h.month, top3: h.top3, top10: Math.max(0, h.top10 - h.top3), rest: Math.max(0, h.keywords - h.top10) }))} margin={{ top: 6, right: 6, bottom: 0, left: 0 }}>
                    <CartesianGrid stroke="var(--g-divider)" strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="month" tickFormatter={(m) => monthLabel(String(m))} tick={{ fontSize: 11, fill: "var(--g-text-2)" }} axisLine={false} tickLine={false} minTickGap={24} />
                    <YAxis tick={{ fontSize: 11, fill: "var(--g-text-2)" }} axisLine={false} tickLine={false} width={44} tickFormatter={(v) => compact(v)} allowDecimals={false} />
                    <Tooltip labelFormatter={(m) => monthLabel(String(m))} formatter={(v: number, name: string) => [fmtNum(v), name]} contentStyle={TOOLTIP} labelStyle={{ color: "var(--g-text-2)" }} />
                    <Area type="monotone" dataKey="top3" name="Positions 1–3" stackId="p" stroke={PALETTE.top3} fill={PALETTE.top3} fillOpacity={0.85} isAnimationActive={false} />
                    <Area type="monotone" dataKey="top10" name="Positions 4–10" stackId="p" stroke={PALETTE.top10} fill={PALETTE.top10} fillOpacity={0.7} isAnimationActive={false} />
                    <Area type="monotone" dataKey="rest" name="Positions 11–100" stackId="p" stroke={PALETTE.rest} fill={PALETTE.rest} fillOpacity={0.6} isAnimationActive={false} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
              <p className="g-text-2 mt-2 text-[12px]">Dark orange: keywords ranking in the top 3. Light orange: positions 4–10. Grey: the rest of the first hundred. Monthly estimates.</p>
            </Panel>
          )}
          {report.intents && (
            <Panel title="Organic keywords by intent" hint={`of the top ${report.keywords?.length ?? 0} keywords`} testId="panel-intents" className="mb-4">
              <table className="g-table">
                <thead><tr><th>Intent</th><th className="num">Keywords</th><th className="num">Traffic</th></tr></thead>
                <tbody>{report.intents.map((i) => <tr key={i.intent}><td>{cap(i.intent)}</td><td className="num" data-label="Keywords"><ShareBar value={i.keywords} max={maxOf(report.intents!.map((x) => x.keywords))} /></td><td className="num" data-label="Traffic">{fmtNum(i.traffic)}</td></tr>)}</tbody>
              </table>
            </Panel>
          )}

          <p className="g-text-2 mb-2 text-[13px]">A first look at each list. The full reports — every row, with filters, sorting and export — are in the menu on the left.</p>
          <nav className="g-tabs" aria-label="Report tables">
            {TABLES.map((t) => <a key={t} href={`#${t}`} aria-current={table === t ? "page" : undefined} onClick={(e) => { e.preventDefault(); setTable(t); }} data-testid={`tab-explorer-${t}`}>{TABLE_LABEL[t]}</a>)}
          </nav>
          {table === "keywords" && (report.keywords?.length ? (
            <>
              <p className="g-text-2 mb-2 text-[13px]">Showing the {report.keywords.length} keywords that bring the most traffic{report.keywordsTotal ? ` of ${fmtNum(report.keywordsTotal)}` : ""}.</p>
              <table className="g-table" data-testid="table-explorer-keywords">
                <thead><tr><th>Keyword</th><th className="num">Position</th><th className="num">Volume</th><th className="num">Traffic</th><th className="num">Difficulty</th><th className="num">CPC</th><th>Intent</th><th>Page</th></tr></thead>
                <tbody>{report.keywords.map((k) => (
                  <tr key={`${k.keyword}-${k.url}`}>
                    <td>{k.keyword}</td>
                    <td className="num" data-label="Position"><PositionBadge value={k.position} /></td>
                    <td className="num" data-label="Volume">{fmtNum(k.volume)}</td>
                    <td className="num" data-label="Traffic">{fmtNum(k.traffic)}</td>
                    <td className="num" data-label="Difficulty"><DifficultyBadge value={k.difficulty} /></td>
                    <td className="num" data-label="CPC">{k.cpc == null ? "—" : `$${k.cpc.toFixed(2)}`}</td>
                    <td data-label="Intent" className="whitespace-nowrap">{k.intent ? cap(k.intent) : "—"}</td>
                    <td data-label="Page" className="max-w-[240px] truncate">{k.url ? <a href={k.url} className="g-link" target="_blank" rel="noreferrer">{stripUrl(k.url).replace(report.domain, "") || "/"}</a> : "—"}</td>
                  </tr>
                ))}</tbody>
              </table>
            </>
          ) : <Empty>No ranking keywords were found for {report.domain}.</Empty>)}
          {table === "pages" && (report.pages?.length ? (
            <table className="g-table" data-testid="table-explorer-pages">
              <thead><tr><th>Page</th><th className="num">Traffic</th><th className="num">Keywords</th><th className="num">In top 10</th><th className="num">Traffic value</th></tr></thead>
              <tbody>{report.pages.map((p) => (
                <tr key={p.url}>
                  <td className="max-w-[420px] truncate"><a href={p.url} className="g-link" target="_blank" rel="noreferrer">{stripUrl(p.url)}</a></td>
                  <td className="num" data-label="Traffic"><ShareBar value={p.traffic} max={maxOf(report.pages!.map((x) => x.traffic))} /></td><td className="num" data-label="Keywords">{fmtNum(p.keywords)}</td>
                  <td className="num" data-label="In top 10">{fmtNum(p.top10)}</td><td className="num" data-label="Traffic value">{usd(p.trafficValue)}</td>
                </tr>
              ))}</tbody>
            </table>
          ) : <Empty>No ranking pages were found for {report.domain}.</Empty>)}
          {table === "competitors" && (report.competitors?.length ? (
            <table className="g-table" data-testid="table-explorer-competitors">
              <thead><tr><th>Competitor</th><th className="num">Shared keywords</th><th className="num">Their keywords</th><th className="num">Their traffic</th><th></th></tr></thead>
              <tbody>{report.competitors.map((c) => (
                <tr key={c.domain}>
                  <td>{c.domain}</td>
                  <td className="num" data-label="Shared keywords"><ShareBar value={c.commonKeywords} max={maxOf(report.competitors!.map((x) => x.commonKeywords))} /></td><td className="num" data-label="Their keywords">{fmtNum(c.keywords)}</td>
                  <td className="num" data-label="Their traffic">{fmtNum(c.traffic)}</td>
                  <td className="num"><button type="button" className="g-link" onClick={() => { setInput(c.domain); open(c.domain); }} data-testid={`button-explore-${c.domain}`}>Explore</button></td>
                </tr>
              ))}</tbody>
            </table>
          ) : <Empty>No organic competitors were found for {report.domain}.</Empty>)}
          {table === "referringDomains" && (report.referringDomains?.length ? (
            <table className="g-table" data-testid="table-explorer-ref-domains">
              <thead><tr><th>Domain</th><th className="num">Authority</th><th className="num">Links to this site</th><th className="num">Spam</th><th>Follow</th><th className="num">First seen</th></tr></thead>
              <tbody>{report.referringDomains.map((d) => (
                <tr key={d.domain}>
                  <td><a href={`https://${d.domain}`} className="g-link" target="_blank" rel="noreferrer">{d.domain}</a></td>
                  <td className="num" data-label="Authority">{d.authority ?? "—"}</td><td className="num" data-label="Links">{fmtNum(d.backlinks)}</td>
                  <td className="num" data-label="Spam">{d.spamScore ?? "—"}</td><td data-label="Follow">{d.followed ? "followed" : "nofollow"}</td>
                  <td className="num g-text-2" data-label="First seen">{fmtDate(d.firstSeen)}</td>
                </tr>
              ))}</tbody>
            </table>
          ) : <Empty>No referring domains were found for {report.domain}.</Empty>)}
          {table === "anchors" && (report.anchors?.length ? (
            <table className="g-table" data-testid="table-explorer-anchors">
              <thead><tr><th>Anchor text</th><th className="num">Backlinks</th><th className="num">Referring domains</th><th className="num">First seen</th></tr></thead>
              <tbody>{report.anchors.map((a, i) => (
                <tr key={`${a.anchor}-${i}`}>
                  <td className="max-w-[420px] truncate">{a.anchor || <span className="g-text-2">(no text — image or empty link)</span>}</td>
                  <td className="num" data-label="Backlinks"><ShareBar value={a.backlinks} max={maxOf(report.anchors!.map((x) => x.backlinks))} /></td><td className="num" data-label="Referring domains">{fmtNum(a.referringDomains)}</td>
                  <td className="num g-text-2" data-label="First seen">{fmtDate(a.firstSeen)}</td>
                </tr>
              ))}</tbody>
            </table>
          ) : <Empty>No anchor text was found for {report.domain}.</Empty>)}
          </>
          )}
            </div>
          </div>
        </div>
      )}
    </SeoShell>
  );
}
