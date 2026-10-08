/**
 * /seo/explorer — Site Explorer: type any domain and get its authority and
 * backlink profile, organic and paid search footprint, six months of history,
 * top keywords and pages, organic competitors, referring domains and anchors.
 * One report is charged to the account's SEO data credit; a saved report is free to
 * reopen for a week (server/seo/explorer.ts). White-label: no vendor, no price.
 */
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { holdNote, isNotRunYet, refreshSeoData } from "./shell";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Area, Bar, BarChart, CartesianGrid, Cell, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ExternalLink, Loader2, Plus, RefreshCw, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiErrorMessage } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { api, canAfford, Empty, fmtDate, fmtNum, kd, priceOf, SeoShell, useSelectedSite, useSeoSites, useSeoStatus } from "./shell";
import { ReportView, type TableKey as ReportKey } from "./report-table";
import { GapView } from "./gap";
import { AddToList } from "./keyword-lists";

type GapKey = "contentGap" | "linkIntersect";
type ViewKey = ReportKey | GapKey | "overview";

type Footprint = {
  keywords: number; traffic: number; trafficValue: number;
  positions: { top3: number; top10: number; top20: number; top50: number; top100: number };
  isNew: number; isUp: number; isDown: number; isLost: number;
};
type Report = {
  domain: string; fetchedAt: string;
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
type Recent = { items: { domain: string; fetchedAt: string; authority: number | null; referringDomains: number | null; keywords: number | null; traffic: number | null }[]; freeForDays: number };

const BLUE = "#1a73e8", ORANGE = "#e8710a", GREEN = "#188038", GREY = "#9aa0a6";
const usd = (n: number | null | undefined) => n == null ? "—" : `$${Math.round(n).toLocaleString("en-US")}`;
/** 12,345 → 12.3K, as the tiles read at a glance; exact numbers stay in the tables. */
const compact = (n: number | null | undefined) =>
  n == null ? "—" : Math.abs(n) >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : Math.abs(n) >= 10_000 ? `${(n / 1000).toFixed(1)}K` : Math.round(n).toLocaleString("en-US");
const monthLabel = (m: string) => new Date(`${m}-15T12:00:00`).toLocaleDateString("en-US", { month: "short", year: "numeric" });
const stripUrl = (u: string) => u.replace(/^https?:\/\/(www\.)?/, "");
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function Panel({ title, hint, children, testId, className = "" }: { title: string; hint?: ReactNode; children: ReactNode; testId?: string; className?: string }) {
  return (
    <section className={`rounded-lg border p-4 ${className}`} style={{ borderColor: "var(--g-divider)", background: "var(--g-surface)" }} data-testid={testId}>
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="g-text text-[15px] font-medium">{title}</h2>
        {hint && <span className="g-text-2 text-[12px]">{hint}</span>}
      </div>
      {children}
    </section>
  );
}

function Stat({ label, value, hint, testId }: { label: string; value: ReactNode; hint?: ReactNode; testId?: string }) {
  return (
    <div className="min-w-0" data-testid={testId}>
      <div className="g-text-2 text-[12px]">{label}</div>
      <div className="g-text text-[26px] leading-8 tabular-nums" style={{ color: "var(--g-blue)" }}>{value}</div>
      {hint && <div className="g-text-2 text-[12px]">{hint}</div>}
    </div>
  );
}

/** Authority as a ring, 0–100: the number and the ring say the same thing. */
function AuthorityRing({ value }: { value: number | null }) {
  const r = 26, c = 2 * Math.PI * r, v = Math.max(0, Math.min(100, value ?? 0));
  return (
    <div className="flex items-center gap-3" data-testid="stat-authority">
      <svg width="64" height="64" viewBox="0 0 64 64" role="img" aria-label={`Authority ${value ?? "unknown"} out of 100`}>
        <circle cx="32" cy="32" r={r} fill="none" stroke="var(--g-divider)" strokeWidth="7" />
        <circle cx="32" cy="32" r={r} fill="none" stroke="#673ab7" strokeWidth="7" strokeDasharray={`${(v / 100) * c} ${c}`} strokeLinecap="round" transform="rotate(-90 32 32)" />
      </svg>
      <div>
        <div className="g-text-2 text-[12px]">Authority</div>
        <div className="g-text text-[26px] leading-8 tabular-nums">{value ?? "—"}</div>
        <div className="g-text-2 text-[12px]">link strength, 0–100</div>
      </div>
    </div>
  );
}

/** The left menu, grouped the way Site Explorer groups its reports. */
const MENU: { group: string; items: [ViewKey, string][] }[] = [
  { group: "", items: [["overview", "Overview"]] },
  { group: "Backlink profile", items: [["backlinks", "Backlinks"], ["newBacklinks", "New backlinks"], ["lostBacklinks", "Lost backlinks"], ["brokenBacklinks", "Broken backlinks"], ["referringDomains", "Referring domains"], ["anchors", "Anchors"], ["linkIntersect", "Link intersect"], ["bestByLinks", "Best pages by links"]] },
  { group: "Organic search", items: [["keywords", "Organic keywords"], ["pages", "Top pages"], ["competitors", "Organic competitors"], ["contentGap", "Content gap"]] },
  { group: "Paid search", items: [["paidKeywords", "Paid keywords"]] },
];
const MENU_LABEL = Object.fromEntries(MENU.flatMap((g) => g.items)) as Record<string, string>;

const TABLES = ["keywords", "pages", "competitors", "referringDomains", "anchors"] as const;
type TableKey = (typeof TABLES)[number];
const TABLE_LABEL: Record<TableKey, string> = { keywords: "Organic keywords", pages: "Top pages", competitors: "Organic competitors", referringDomains: "Referring domains", anchors: "Anchors" };

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
  const [view, setView] = useState<ViewKey>("overview");
  const [series, setSeries] = useState({ traffic: true, keywords: true, top10: false });

  const recent = useQuery<Recent>({ queryKey: ["/api/seo/explorer/recent"] });
  // A saved report opens without spending anything; 404 just means "not looked up yet".
  const saved = useQuery<{ report: Report; fresh: boolean }>({
    queryKey: [`/api/seo/explorer?domain=${encodeURIComponent(domain ?? "")}`], enabled: !!domain && !report, retry: false,
  });
  useEffect(() => { if (saved.data?.report && !report) setReport(saved.data.report); }, [saved.data, report]);

  const analyse = useMutation({
    mutationFn: (v: { domain: string; refresh: boolean }) => api("POST", "/api/seo/explorer", v),
    onSuccess: (data: { report: Report; reused: boolean }) => {
      setReport(data.report); setDomain(data.report.domain); setInput(data.report.domain);
      window.history.replaceState({}, "", `/seo/explorer?domain=${encodeURIComponent(data.report.domain)}`);
      void qc.invalidateQueries({ queryKey: ["/api/seo/explorer/recent"] });
      void qc.invalidateQueries({ queryKey: ["/api/seo/status"] });
    },
    onError: (e) => toast({ title: "Couldn't analyse that domain", description: apiErrorMessage(e), variant: "destructive" }),
  });
  const trackKeywords = useMutation({
    mutationFn: (v: { siteId: number; rows: { keyword: string; volume: number | null; cpc: number | null; difficulty: number | null }[] }) =>
      api("POST", `/api/seo/sites/${v.siteId}/keywords`, { keywords: v.rows.map((r) => r.keyword), volumes: v.rows.map((r) => ({ keyword: r.keyword, searchVolume: r.volume, cpc: r.cpc, difficulty: r.difficulty })) }),
    onSuccess: (r: { added: number }) => { refreshSeoData(qc); toast({ title: `${r.added} keyword${r.added === 1 ? "" : "s"} added to the rank tracker` }); },
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

  const positions = useMemo(() => {
    if (!report) return [];
    const p = report.organic.positions;
    return [
      { range: "1–3", keywords: p.top3, color: GREEN }, { range: "4–10", keywords: p.top10 - p.top3, color: BLUE },
      { range: "11–20", keywords: p.top20 - p.top10, color: ORANGE }, { range: "21–50", keywords: p.top50 - p.top20, color: "#f9ab00" },
      { range: "51–100", keywords: p.top100 - p.top50, color: GREY },
    ];
  }, [report]);
  const followedPct = report?.links.referringDomains ? Math.round(((report.links.followedDomains ?? 0) / report.links.referringDomains) * 1000) / 10 : null;

  return (
    <SeoShell title="Site explorer" description="Any website's search traffic, keywords, backlinks and competitors — yours or a competitor's." site={site} onSite={onSite} sites={sites} status={status} picker={false}>
      <form className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center" onSubmit={(e) => { e.preventDefault(); submit(false); }} data-testid="form-explorer">
        <label className="relative min-w-0 flex-1 sm:max-w-xl">
          <span className="sr-only">Domain</span>
          <Search className="g-text-2 pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2" aria-hidden />
          <input className="g-input w-full pl-9" placeholder="example.com" value={input} onChange={(e) => setInput(e.target.value)} data-testid="input-explorer-domain" autoComplete="off" spellCheck={false} />
        </label>
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
            <thead><tr><th>Domain</th><th className="num">Authority</th><th className="num">Referring domains</th><th className="num">Organic keywords</th><th className="num">Organic traffic</th><th className="num">Analysed</th></tr></thead>
            <tbody>
              {recent.data!.items.map((r) => (
                <tr key={r.domain}>
                  <td><button type="button" className="g-link" onClick={() => open(r.domain)} data-testid={`button-open-${r.domain}`}>{r.domain}</button></td>
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
      {!report && !busy && !domain && (recent.data?.items.length ?? 0) === 0 && (
        <Empty testId="explorer-intro"><h3>Look up any website</h3><p>Enter a domain to see how much search traffic it gets, which keywords and pages earn it, who links to it and who it competes with.</p></Empty>
      )}

      {report && (
        <div data-testid="explorer-report">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <h2 className="g-text text-[20px] font-medium">Overview: <a href={`https://${report.domain}`} target="_blank" rel="noreferrer" className="g-link">{report.domain} <ExternalLink className="inline h-3.5 w-3.5" aria-hidden /></a></h2>
            <span className="g-text-2 text-[12px]" data-testid="text-explorer-fetched">United States · as of {fmtDate(report.fetchedAt)}</span>
            <div className="ml-auto flex flex-wrap gap-2">
              {!tracked && <button type="button" className="g-pill" disabled={track.isPending} onClick={() => track.mutate(report.domain)} data-testid="button-explorer-track"><Plus /> Track rankings</button>}
              <button type="button" className="g-pill" disabled={analyse.isPending || !configured} onClick={() => { setInput(report.domain); analyse.mutate({ domain: report.domain, refresh: true }); }} data-testid="button-explorer-refresh"><RefreshCw className={analyse.isPending ? "animate-spin" : ""} /> Refresh</button>
            </div>
          </div>
          {report.missing.length > 0 && <p className="g-text-2 mb-3 text-[13px]" role="status" data-testid="text-explorer-missing">Some sections didn't load this time ({report.missing.map((m) => TABLE_LABEL[m as TableKey] ?? cap(m)).join(", ")}). Refresh to try again.</p>}

          <div className="flex flex-col gap-5 lg:flex-row">
            <nav className="flex-none lg:w-48" aria-label="Site explorer reports" data-testid="explorer-menu">
              {MENU.map((g) => (
                <div key={g.group || "top"} className="mb-3">
                  {g.group && <div className="g-text mb-1 text-[13px] font-medium">{g.group}</div>}
                  <div className="flex flex-wrap gap-1 lg:flex-col lg:gap-0">
                    {g.items.map(([key, label]) => (
                      <button key={key} type="button" onClick={() => setView(key)} aria-current={view === key ? "page" : undefined} data-testid={`menu-${key}`}
                        className={`rounded px-2 py-1 text-left text-[13px] ${view === key ? "g-text font-medium" : "g-text-2"}`} style={view === key ? { background: "var(--g-hover)" } : undefined}>{label}</button>
                    ))}
                  </div>
                </div>
              ))}
            </nav>
            <div className="min-w-0 flex-1">
          {view !== "overview" ? (
            <>
              <h3 className="g-text mb-3 text-[17px] font-medium" data-testid="text-report-title">{MENU_LABEL[view]}</h3>
              {view === "contentGap" || view === "linkIntersect" ? (
                <GapView kind={view === "contentGap" ? "content" : "links"} domain={report.domain} status={status.data} suggestions={(report.competitors ?? []).map((c) => c.domain)}
                  onExplore={(d) => { setInput(d); open(d); }} onTrack={trackedSite ? (rows) => trackKeywords.mutate({ siteId: trackedSite.id, rows }) : undefined} />
              ) : (
                <ReportView table={view} domain={report.domain} status={status.data} onExplore={(d) => { setInput(d); open(d); }} extraAction={(rows, clear) => <AddToList rows={rows} onDone={clear} />}
                  onTrack={trackedSite ? (rows) => trackKeywords.mutate({ siteId: trackedSite.id, rows }) : undefined} trackLabel="Add to rank tracker" />
              )}
              {(view === "keywords" || view === "paidKeywords") && !trackedSite && <p className="g-text-2 mt-2 text-[13px]">Press <b>Track rankings</b> above to follow this site's keywords every week.</p>}
            </>
          ) : (
          <>
          <div className="mb-4 grid gap-4 lg:grid-cols-3">
            <Panel title="Backlink profile" testId="panel-backlinks">
              <AuthorityRing value={report.links.authority} />
              <div className="mt-4 grid grid-cols-2 gap-4">
                <Stat label="Backlinks" value={compact(report.links.backlinks)} hint={report.links.brokenBacklinks != null ? `${compact(report.links.brokenBacklinks)} broken` : undefined} testId="stat-backlinks" />
                <Stat label="Referring domains" value={compact(report.links.referringDomains)} hint={report.links.referringIps != null ? `${compact(report.links.referringIps)} IPs` : undefined} testId="stat-ref-domains" />
              </div>
            </Panel>
            <Panel title="Organic search" testId="panel-organic">
              <div className="grid grid-cols-2 gap-4">
                <Stat label="Organic keywords" value={compact(report.organic.keywords)} hint={`Top 3: ${fmtNum(report.organic.positions.top3)} · top 10: ${fmtNum(report.organic.positions.top10)}`} testId="stat-organic-keywords" />
                <Stat label="Organic traffic" value={compact(report.organic.traffic)} hint={`Value ${usd(report.organic.trafficValue)} / mo`} testId="stat-organic-traffic" />
              </div>
              <p className="g-text-2 mt-4 text-[12px]" data-testid="text-organic-movement">
                Since last month: <span style={{ color: "var(--g-green)" }}>▲ {fmtNum(report.organic.isUp)} up</span> · <span style={{ color: "var(--g-red)" }}>▼ {fmtNum(report.organic.isDown)} down</span> · {fmtNum(report.organic.isNew)} new · {fmtNum(report.organic.isLost)} lost
              </p>
            </Panel>
            <Panel title="Paid search" testId="panel-paid">
              <div className="grid grid-cols-2 gap-4">
                <Stat label="Paid keywords" value={compact(report.paid.keywords)} testId="stat-paid-keywords" />
                <Stat label="Paid traffic" value={compact(report.paid.traffic)} hint={`Est. cost ${usd(report.paid.trafficValue)} / mo`} testId="stat-paid-traffic" />
              </div>
              {report.paid.keywords === 0 && <p className="g-text-2 mt-4 text-[12px]">No Google Ads seen for this domain.</p>}
            </Panel>
          </div>

          <div className="mb-4 grid gap-4 lg:grid-cols-3">
            <Panel title="Performance" hint="estimated, by month" testId="panel-performance" className="lg:col-span-2">
              {report.history && report.history.length > 1 ? (
                <>
                  <div className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-[13px]">
                    {([["traffic", "Organic traffic", ORANGE], ["keywords", "Organic keywords", BLUE], ["top10", "Keywords in top 10", GREEN]] as const).map(([key, label, color]) => (
                      <label key={key} className="g-text flex items-center gap-1.5">
                        <input type="checkbox" checked={series[key]} onChange={(e) => setSeries((s) => ({ ...s, [key]: e.target.checked }))} style={{ accentColor: color }} data-testid={`check-series-${key}`} /> {label}
                      </label>
                    ))}
                  </div>
                  <div style={{ width: "100%", height: 260 }} data-testid="chart-performance">
                    <ResponsiveContainer>
                      <ComposedChart data={report.history} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                        <CartesianGrid stroke="var(--g-divider)" vertical={false} />
                        <XAxis dataKey="month" tickFormatter={monthLabel} tick={{ fontSize: 12, fill: "var(--g-text-2)" }} axisLine={false} tickLine={false} />
                        <YAxis yAxisId="traffic" tick={{ fontSize: 12, fill: "var(--g-text-2)" }} axisLine={false} tickLine={false} width={44} tickFormatter={(v) => compact(v)} />
                        <YAxis yAxisId="keywords" orientation="right" tick={{ fontSize: 12, fill: "var(--g-text-2)" }} axisLine={false} tickLine={false} width={40} tickFormatter={(v) => compact(v)} />
                        <Tooltip labelFormatter={(m) => monthLabel(String(m))} formatter={(v: number, name: string) => [fmtNum(v), name]} contentStyle={{ fontSize: 12, background: "var(--g-surface)", border: "1px solid var(--g-divider)", color: "var(--g-text)" }} />
                        {series.traffic && <Area yAxisId="traffic" type="monotone" dataKey="traffic" name="Organic traffic" stroke={ORANGE} fill={ORANGE} fillOpacity={0.15} strokeWidth={2} />}
                        {series.keywords && <Line yAxisId="keywords" type="monotone" dataKey="keywords" name="Organic keywords" stroke={BLUE} strokeWidth={2} dot={false} />}
                        {series.top10 && <Line yAxisId="keywords" type="monotone" dataKey="top10" name="Keywords in top 10" stroke={GREEN} strokeWidth={2} dot={false} />}
                      </ComposedChart>
                    </ResponsiveContainer>
                  </div>
                </>
              ) : <p className="g-text-2 text-[13px]">No history for this domain yet.</p>}
            </Panel>
            <div className="flex flex-col gap-4">
              <Panel title="Organic positions" hint="keywords by rank" testId="panel-positions">
                <div style={{ width: "100%", height: 150 }}>
                  <ResponsiveContainer>
                    <BarChart data={positions} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
                      <XAxis dataKey="range" tick={{ fontSize: 12, fill: "var(--g-text-2)" }} axisLine={false} tickLine={false} />
                      <YAxis hide />
                      <Tooltip formatter={(v: number) => [fmtNum(v), "Keywords"]} contentStyle={{ fontSize: 12, background: "var(--g-surface)", border: "1px solid var(--g-divider)", color: "var(--g-text)" }} cursor={{ fill: "var(--g-hover)" }} />
                      <Bar dataKey="keywords" radius={[3, 3, 0, 0]}>{positions.map((p) => <Cell key={p.range} fill={p.color} />)}</Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </Panel>
              <Panel title="Referring domains" testId="panel-followed">
                {report.links.referringDomains ? (
                  <div className="space-y-2 text-[13px]">
                    {([["Followed", report.links.followedDomains, followedPct], ["Not followed", report.links.nofollowDomains, followedPct == null ? null : Math.round((100 - followedPct) * 10) / 10]] as const).map(([label, count, pct]) => (
                      <div key={label}>
                        <div className="g-text flex justify-between"><span>{label}</span><span className="tabular-nums">{fmtNum(count)} <span className="g-text-2">{pct == null ? "" : `${pct}%`}</span></span></div>
                        <div className="h-1.5 rounded" style={{ background: "var(--g-divider)" }}><div className="h-1.5 rounded" style={{ width: `${pct ?? 0}%`, background: BLUE }} /></div>
                      </div>
                    ))}
                  </div>
                ) : <p className="g-text-2 text-[13px]">No referring domains found.</p>}
              </Panel>
            </div>
          </div>

          {report.linkHistory && report.linkHistory.length > 1 && (
            <Panel title="Backlink growth" hint="last 12 months" testId="panel-link-history" className="mb-4">
              <div style={{ width: "100%", height: 220 }} data-testid="chart-link-history">
                <ResponsiveContainer>
                  <ComposedChart data={report.linkHistory} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                    <CartesianGrid stroke="var(--g-divider)" vertical={false} />
                    <XAxis dataKey="month" tickFormatter={monthLabel} tick={{ fontSize: 12, fill: "var(--g-text-2)" }} axisLine={false} tickLine={false} />
                    <YAxis yAxisId="domains" tick={{ fontSize: 12, fill: "var(--g-text-2)" }} axisLine={false} tickLine={false} width={44} tickFormatter={(v) => compact(v)} />
                    <YAxis yAxisId="links" orientation="right" tick={{ fontSize: 12, fill: "var(--g-text-2)" }} axisLine={false} tickLine={false} width={44} tickFormatter={(v) => compact(v)} />
                    <Tooltip labelFormatter={(m) => monthLabel(String(m))} formatter={(v: number, name: string) => [fmtNum(v), name]} contentStyle={{ fontSize: 12, background: "var(--g-surface)", border: "1px solid var(--g-divider)", color: "var(--g-text)" }} />
                    <Area yAxisId="domains" type="monotone" dataKey="referringDomains" name="Referring domains" stroke={BLUE} fill={BLUE} fillOpacity={0.15} strokeWidth={2} />
                    <Line yAxisId="links" type="monotone" dataKey="backlinks" name="Backlinks" stroke="#673ab7" strokeWidth={2} dot={false} />
                    <Line yAxisId="domains" type="monotone" dataKey="newBacklinks" name="New links that month" stroke={GREEN} strokeWidth={1.5} dot={false} />
                    <Line yAxisId="domains" type="monotone" dataKey="lostBacklinks" name="Lost links that month" stroke="#d93025" strokeWidth={1.5} dot={false} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
              <p className="g-text-2 mt-2 text-[12px]">Blue area: referring domains. Purple: total backlinks (right scale). Green and red: links gained and lost each month.</p>
            </Panel>
          )}
          {report.intents && (
            <Panel title="Organic keywords by intent" hint={`of the top ${report.keywords?.length ?? 0} keywords`} testId="panel-intents" className="mb-4">
              <table className="g-table">
                <thead><tr><th>Intent</th><th className="num">Keywords</th><th className="num">Traffic</th></tr></thead>
                <tbody>{report.intents.map((i) => <tr key={i.intent}><td>{cap(i.intent)}</td><td className="num" data-label="Keywords">{fmtNum(i.keywords)}</td><td className="num" data-label="Traffic">{fmtNum(i.traffic)}</td></tr>)}</tbody>
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
                    <td className="num" data-label="Position">{k.position ?? "—"}</td>
                    <td className="num" data-label="Volume">{fmtNum(k.volume)}</td>
                    <td className="num" data-label="Traffic">{fmtNum(k.traffic)}</td>
                    <td className="num" data-label="Difficulty">{kd(k.difficulty)}</td>
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
                  <td className="num" data-label="Traffic">{fmtNum(p.traffic)}</td><td className="num" data-label="Keywords">{fmtNum(p.keywords)}</td>
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
                  <td className="num" data-label="Shared keywords">{fmtNum(c.commonKeywords)}</td><td className="num" data-label="Their keywords">{fmtNum(c.keywords)}</td>
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
                  <td className="num" data-label="Backlinks">{fmtNum(a.backlinks)}</td><td className="num" data-label="Referring domains">{fmtNum(a.referringDomains)}</td>
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
