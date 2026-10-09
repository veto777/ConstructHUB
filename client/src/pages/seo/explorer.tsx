/**
 * /seo/explorer — Site Explorer: type any domain and get its authority and
 * backlink profile, organic and paid search footprint, six months of history,
 * top keywords and pages, organic competitors, referring domains and anchors.
 * One report is charged to the account's SEO data credit; a saved report is free to
 * reopen for a week (server/seo/explorer.ts). White-label: no vendor, no price.
 * Looks like the dashboard (owner, 10/8): blue wording, orange graphs; green and red only mean better or worse.
 *
 * Every figure leads somewhere (owner 2026-10-09, links.ts): a headline figure to its report, a band to the keywords
 * in it, a month on a chart to that month, a row — every cell of it — to its own data. The address carries the view
 * and every filter (?domain, view, band, pos, intent, followed, tld, anchor, path, section, month, move, series,
 * quick, from, to, sort, offset, limit, locationCode + languageCode, …): this page reads them on arrival and whenever they change,
 * and never buys anything to honour them — a saved report opens, otherwise the Analyse button and the report's own
 * "Run report" prompt wait, with the filter already set. Every link is thumb-sized (44 px) and says it is a link
 * without a pointer over it; a chart's clicks have a row of month links beside them for a keyboard or a thumb.
 */
import { DirectoriesView } from "./directories";
import { MentionsView } from "./mentions";
import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { Link, useLocation, useSearch } from "wouter";
import { holdNote, isNotRunYet, refreshSeoData } from "./shell";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Area, CartesianGrid, ComposedChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ExternalLink, Loader2, Plus, RefreshCw, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiErrorMessage } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { api, canAfford, Empty, fmtDate, fmtNum, priceOf, SeoShell, useSelectedSite, useSeoSites, useSeoStatus } from "./shell";
import { compact, DeltaBadge, GradientSpark, monthLabel, PALETTE, TOOLTIP } from "./viz";
import { BarRows, change, DifficultyBadge, Fig, FIG, Kicker, LinkedDistribution, Metric, MonthLinks, MonthTrend, OpenIcon, PositionBadge, ShareBar, type MonthSeries } from "./viz-explorer";
import { ReportView, REPORT_NOTE, type TableKey as ReportKey } from "./report-table";
import { bandOfPosition, INTENTS, OVERVIEW_PARAMS, overviewWords, pathOfUrl } from "./explorer-filters";
import { ToolBarSlot } from "@/components/tool";
import { seoLinks, setParam, setParams } from "./links";
import { marketParams } from "./keyword-links";
import { GapView } from "./gap";
import { OpportunitiesView } from "./opportunities";
import { MarketPicker, useMarket } from "./market";
import { findMarket, marketKey, marketLabel, SEO_MARKETS, type SeoMarket } from "@shared/seo-markets";
import { AddToList } from "./keyword-lists";

type GapKey = "contentGap" | "linkIntersect" | "opportunities" | "directories" | "mentions";
type ViewKey = ReportKey | GapKey | "overview";
type ExplorerParams = NonNullable<Parameters<typeof seoLinks.explorer>[2]>;

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
/** The overview's own words, cleared together by the chip's Clear. */
const OVERVIEW_CLEAR = Object.fromEntries(OVERVIEW_PARAMS.map((k) => [k, null])) as Record<string, null>;
const MONTH = /^\d{4}-\d{2}$/;
/** The newest month of a series (the month a change "over the months shown" ends in). */
const lastMonth = (xs: { month: string }[]) => xs[xs.length - 1]?.month;

/** A card with a blue title and an optional note on the right; with `href`, the title leads to the rows the card counts. */
function Panel({ title, hint, children, testId, className = "", href, linkTestId }: { title: string; hint?: ReactNode; children: ReactNode; testId?: string; className?: string; href?: string; linkTestId?: string }) {
  return (
    <section className={`min-w-0 rounded-xl border p-3 sm:p-4 ${className}`} style={SURFACE} data-testid={testId}>
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-[14px] font-medium" style={{ color: "var(--g-blue)" }}>{href && linkTestId ? <Fig href={href} testId={linkTestId}>{title}</Fig> : title}</h2>
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

/** A change beside a headline figure, as a link to the same rows in the month the change ends in (nothing when there is no change to speak of). */
function Delta({ value, href, testId, label }: { value: number | null; href: string; testId: string; label: string }) {
  if (value == null || !Number.isFinite(value) || Math.round(value) === 0) return null;
  return <Fig href={href} testId={testId} label={`${label}: ${value > 0 ? "+" : "−"}${compact(Math.abs(value))}`}><DeltaBadge value={value} label={label} /></Fig>;
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

/** The bands the position rows and charts use, with the address word for each (links.ts: `band` where one says it, `pos` where only a range does). */
const POSITION_ROWS: { label: string; words: string; p: { band?: "top3" | "rest"; pos?: string } }[] = [
  { label: "1–3", words: "Keywords in the top 3", p: { band: "top3" } }, { label: "4–10", words: "Keywords in positions 4–10", p: { pos: "4-10" } }, { label: "11–20", words: "Keywords in positions 11–20", p: { pos: "11-20" } },
  { label: "21–50", words: "Keywords in positions 21–50", p: { pos: "21-50" } }, { label: "51–100", words: "Keywords in positions 51–100", p: { pos: "51-100" } },
];

/**
 * Compare two months: any two months of the saved history side by side (organic search from two years of monthly
 * estimates, links from one year). Free — it only reads the report already on screen. The two months are the
 * address's `from` and `to` (the pickers write them); a month picked on a chart (`month`) opens the comparison with
 * that month on one side. Every figure leads to its report for that month.
 */
function CompareMonths({ report, month, from, to, href }: { report: Report; month: string | null; from: string | null; to: string | null; /** The report of a figure, for a month. */ href: (view: string, p: ExplorerParams) => string }) {
  const months = useMemo(() => [...new Set([...(report.history ?? []).map((h) => h.month), ...(report.linkHistory ?? []).map((h) => h.month)])].sort(), [report]);
  const [shown, setShown] = useState(false);
  // What to compare when the address does not say: the newest month against the same month a year earlier (or the
  // oldest there is); a month picked on a chart against the newest — or, when it is the newest, against a year earlier.
  const last = months[months.length - 1] ?? null;
  const yearAgo = last ? `${Number(last.slice(0, 4)) - 1}${last.slice(4)}` : null;
  const oldest = yearAgo && months.includes(yearAgo) ? yearAgo : months[0] ?? null;
  const picked = month && months.includes(month) ? month : null;
  const a = from && months.includes(from) ? from : picked && picked !== last ? picked : oldest;
  const b = to && months.includes(to) ? to : last;
  const open = shown || !!from || !!to || !!picked;
  if (months.length < 2) return null;
  const h = (m: string | null) => (report.history ?? []).find((x) => x.month === m) ?? null, l = (m: string | null) => (report.linkHistory ?? []).find((x) => x.month === m) ?? null;
  const rows: { label: string; x: number | null | undefined; y: number | null | undefined; money: boolean; view: string; p?: ExplorerParams; key: string }[] = [
    { label: "Organic traffic / mo", x: h(a)?.traffic, y: h(b)?.traffic, money: false, view: "pages", key: "traffic" }, { label: "Organic keywords", x: h(a)?.keywords, y: h(b)?.keywords, money: false, view: "keywords", key: "keywords" },
    { label: "Keywords in the top 3", x: h(a)?.top3, y: h(b)?.top3, money: false, view: "keywords", p: { band: "top3" }, key: "top3" }, { label: "Keywords in the top 10", x: h(a)?.top10, y: h(b)?.top10, money: false, view: "keywords", p: { band: "top10" }, key: "top10" },
    { label: "Traffic value / mo", x: h(a)?.trafficValue, y: h(b)?.trafficValue, money: true, view: "paidKeywords", key: "value" },
    { label: "Referring domains", x: l(a)?.referringDomains, y: l(b)?.referringDomains, money: false, view: "referringDomains", key: "domains" }, { label: "Backlinks", x: l(a)?.backlinks, y: l(b)?.backlinks, money: false, view: "backlinks", key: "backlinks" },
    { label: "Authority", x: l(a)?.authority, y: l(b)?.authority, money: false, view: "backlinks", key: "authority" },
  ];
  const show = (v: number | null | undefined, money: boolean) => (v == null ? "—" : money ? usd(v) : fmtNum(v));
  return (
    <section className="mb-4" data-testid="panel-compare">
      <button type="button" className="g-pill min-h-[44px]" aria-expanded={open} onClick={() => { if (open) { setShown(false); setParams({ from: null, to: null, month: null }); } else setShown(true); }} data-testid="button-compare">{open ? "Hide the comparison" : "Compare two months"}</button>
      {open && (
        <div className="mt-3 rounded-xl border p-3 sm:p-4" style={SURFACE}>
          <div className="mb-3 flex flex-wrap items-center gap-3 text-[13px]">
            <label className="g-text-2 flex items-center gap-2">From <select className="g-input g-select !w-auto !py-1" value={a ?? ""} onChange={(e) => setParam("from", e.target.value)} data-testid="select-compare-from">{months.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}</select></label>
            <label className="g-text-2 flex items-center gap-2">to <select className="g-input g-select !w-auto !py-1" value={b ?? ""} onChange={(e) => setParam("to", e.target.value)} data-testid="select-compare-to">{months.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}</select></label>
          </div>
          <table className="g-table" data-testid="table-compare">
            <thead><tr><th>Measure</th><th className="num">{a ? monthLabel(a) : "—"}</th><th className="num">{b ? monthLabel(b) : "—"}</th><th className="num">Change</th></tr></thead>
            <tbody>{rows.map((r) => {
              const d = r.x != null && r.y != null ? r.y - r.x : null;
              const cell = (v: number | null | undefined, m: string | null, testId: string) => (v == null || !m ? <span className="g-text-2">—</span> : <Fig href={href(r.view, { ...r.p, month: m })} testId={testId} label={`${r.label}, ${monthLabel(m)}: ${show(v, r.money)}`}>{show(v, r.money)}</Fig>);
              return (
                <tr key={r.label}>
                  <td><Fig href={href(r.view, r.p ?? {})} testId={`link-compare-${r.key}`}>{r.label}</Fig></td><td className="num" data-label="From">{cell(r.x, a, `link-compare-${r.key}-from`)}</td><td className="num" data-label="To">{cell(r.y, b, `link-compare-${r.key}-to`)}</td>
                  <td className="num" data-label="Change">{d == null ? <span className="g-text-2">—</span> : <Fig href={href(r.view, { ...r.p, month: b ?? undefined })} testId={`link-compare-${r.key}-change`} label={`${r.label}: ${d === 0 ? "no change" : `${d > 0 ? "up" : "down"} ${r.money ? usd(Math.abs(d)) : fmtNum(Math.abs(d))}`} from ${a ? monthLabel(a) : "—"} to ${b ? monthLabel(b) : "—"}`}>{d === 0 ? <span className="g-text-2">no change</span> : <span className={`g-move ${d > 0 ? "g-move--up" : "g-move--down"}`}>{d > 0 ? "▲" : "▼"} {r.money ? usd(Math.abs(d)) : fmtNum(Math.abs(d))}{r.x ? ` (${d > 0 ? "+" : "−"}${Math.abs(Math.round((d / r.x) * 100))}%)` : ""}</span>}</Fig>}</td>
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
  const [, navigate] = useLocation();
  // The address is the state of this page: the domain, the view and every filter are read from it here and whenever
  // it changes (a link followed while the page is open, the back button), so a link and a picked filter are one thing.
  const search = useSearch();
  const params = useMemo(() => new URLSearchParams(search), [search]);
  const [input, setInput] = useState(() => params.get("domain") ?? "");
  const [domain, setDomain] = useState<string | null>(() => params.get("domain"));
  const [report, setReport] = useState<Report | null>(null);
  // ?view=<report> opens that report (an alert links straight to Mentions); anything else is the overview.
  const view: ViewKey = useMemo(() => { const v = params.get("view"); return v && Object.prototype.hasOwnProperty.call(MENU_LABEL, v) ? (v as ViewKey) : "overview"; }, [params]);
  /** The month picked on a chart ("YYYY-MM"), marked on both charts and opened in the comparison. */
  const month = useMemo(() => { const m = params.get("month"); return m && MONTH.test(m) ? m : null; }, [params]);
  const monthParam = (name: string) => { const m = params.get(name); return m && MONTH.test(m) ? m : null; };
  /** The overview's own words in the address: the first-look table, the chart figure, the months compared. */
  const quick: TableKey = (TABLES as readonly string[]).includes(params.get("quick") ?? "") ? (params.get("quick") as TableKey) : "keywords";
  const seriesParam = params.get("series");
  const cmpFrom = monthParam("from"), cmpTo = monthParam("to");
  const [market, setMarket] = useMarket();
  const mk = { locationCode: market.locationCode, languageCode: market.languageCode };
  /**
   * Another country is another report: what is on screen is put away, and the address names the new country as a NEW
   * history entry, so Back returns to the country before (the entry being left is first made to name its own country —
   * an address without one means the remembered country, which the pick is about to change). The view and its filters
   * stay: each still applies to the same report in another country. Only the page of rows starts again (`offset`).
   */
  const changeMarket = (m: SeoMarket) => {
    if (marketKey(m) === marketKey(market)) return;
    if (!params.get("locationCode")) setParams({ locationCode: market.locationCode, languageCode: market.languageCode }, true);
    setReport(null); setMarket(m); setParams({ locationCode: m.locationCode, languageCode: m.languageCode, offset: null });
  };

  // A link into this page: ?domain is the site (the saved report opens — nothing is bought), ?locationCode (+ languageCode) the country.
  useEffect(() => {
    const d = params.get("domain");
    if (d && d !== domain) { setReport(null); setDomain(d); setInput(d); }
    const lc = Number(params.get("locationCode")), lang = params.get("languageCode");
    if (lc && (lc !== market.locationCode || (lang && lang !== market.languageCode))) {
      const m = findMarket(lc, lang ?? market.languageCode) ?? findMarket(lc, "en") ?? SEO_MARKETS.find((x) => x.locationCode === lc);
      if (m && marketKey(m) !== marketKey(market)) { setReport(null); setMarket(m); }
    }
  }, [params]); // eslint-disable-line react-hooks/exhaustive-deps

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
      // The site's one spelling goes in the address; the view and filters there stay (a refresh keeps its place).
      setParam("domain", data.report.domain, true);
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

  /** Another site, from the overview: its own address, as a new history entry so Back returns here (the view and filters of the last one do not carry over). */
  const open = (d: string, m: SeoMarket = market) => { setReport(null); setDomain(d); setInput(d); navigate(seoLinks.explorer(d, "overview", marketParams(m))); };
  const submit = (refresh = false) => { const d = input.trim(); if (d) { if (!refresh) setReport(null); analyse.mutate({ domain: d, refresh }); } };
  const configured = !!status.data?.configured;
  const affordable = canAfford(status.data, "explorerReport");
  /** The site on screen: the report's one spelling, or the address's while there is no report. */
  const shown = report?.domain ?? domain ?? "";
  const trackedSite = shown ? (sites.data ?? []).find((s) => s.domain === shown) ?? null : null;
  const tracked = !!trackedSite;
  const busy = analyse.isPending || (saved.isLoading && !!domain && !report);
  const savedMissing = saved.isError && isNotRunYet(saved.error);
  const notFoundYet = !!domain && !report && savedMissing && !analyse.isPending;
  const savedFailed = !!domain && !report && saved.isError && !savedMissing && !analyse.isPending;
  /** A report opened by link with no overview built: the report's own (free) look for a saved page, nothing bought. */
  const standalone = notFoundYet && view !== "overview";
  /** Where a figure of this site leads, in the country it was looked at in. */
  const to = (v: string, p: ExplorerParams = {}) => seoLinks.explorer(shown, v, { ...marketParams(market), ...p });
  /** Where a figure of another site leads (a competitor, a linking site), in the same country. */
  const other = (d: string, v = "overview", p: ExplorerParams = {}) => seoLinks.explorer(d, v, { ...marketParams(market), ...p });
  /** This overview with one thing changed (a month picked, a first-look table, a chart figure), keeping the rest. */
  const here = (p: ExplorerParams = {}) => to("overview", { month: month ?? undefined, quick: quick === "keywords" ? undefined : quick, series: seriesParam ?? undefined, from: cmpFrom ?? undefined, to: cmpTo ?? undefined, ...p });
  /** A keyword's own page, in the same country. */
  const kw = (keyword: string, p: Omit<NonNullable<Parameters<typeof seoLinks.keywords>[1]>, "locationCode" | "languageCode"> = {}) => seoLinks.keywords(keyword, { ...marketParams(market), ...p });
  /** Followed / not followed referring domains: the referring-domains list has no follow split, so the rows shown are links one per linking site (the chip says so). */
  const followedParam = params.get("followed");
  const reportTable: ReportKey | null = view === "referringDomains" && (followedParam === "true" || followedParam === "false") ? "backlinks" : (view === "overview" || ["contentGap", "linkIntersect", "opportunities", "directories", "mentions"].includes(view) ? null : (view as ReportKey));

  // Keywords by where they rank: each band on its own, from the cumulative counts the report keeps — each row a link to those keywords.
  const positions = useMemo(() => {
    if (!report) return [];
    const p = report.organic.positions;
    const values = [p.top3, p.top10 - p.top3, p.top20 - p.top10, p.top50 - p.top20, p.top100 - p.top50];
    return POSITION_ROWS.map((r, i) => ({ label: r.label, value: values[i], href: to("keywords", r.p), words: `${r.words}: ${fmtNum(values[i])}`, testId: `link-positions-${r.label.replace("–", "-")}` }));
  }, [report, market]); // eslint-disable-line react-hooks/exhaustive-deps
  const followedPct = report?.links.referringDomains ? Math.round(((report.links.followedDomains ?? 0) / report.links.referringDomains) * 1000) / 10 : null;
  // The monthly series behind the headline figures (oldest first), for the small trend charts and their changes.
  const hist = report?.history ?? [], links = report?.linkHistory ?? [];
  const pickMonth = (m: string | null) => setParam("month", m);
  const monthly = <T extends { month: string }>(xs: T[], value: (x: T) => number | null) => xs.flatMap((x) => { const v = value(x); return v == null ? [] : [{ month: x.month, label: monthLabel(x.month), value: v }]; });
  /** A headline figure's small chart: a clicked point picks its month, and a row of month links (behind "Pick a month") does the same for a thumb or a keyboard. */
  const spark = (points: { month: string; label: string; value: number }[], color: string, testId: string) => (
    <>
      <GradientSpark range height={48} points={points} color={color} onPoint={(p) => { const m = points.find((x) => x.label === p.label)?.month; if (m) pickMonth(m === month ? null : m); }} />
      <MonthLinks months={points} href={(m) => here({ month: m })} current={month} testId={`${testId}-months`} collapsed />
    </>
  );
  const performance: MonthSeries[] = [
    { key: "traffic", label: "Organic traffic (estimate)", color: PALETTE.traffic, points: monthly(hist, (h) => h.traffic), href: (m) => to("pages", { month: m ?? undefined }), rows: "Top pages, which carry the traffic" },
    { key: "keywords", label: "Organic keywords", color: PALETTE.keywords, points: monthly(hist, (h) => h.keywords), href: (m) => to("keywords", { month: m ?? undefined }), rows: "Every keyword" },
    { key: "top10", label: "Keywords in top 10", color: PALETTE.keywords, points: monthly(hist, (h) => h.top10), href: (m) => to("keywords", { band: "top10", month: m ?? undefined }), rows: "Keywords in the top 10" },
  ];
  const growth: MonthSeries[] = [
    { key: "domains", label: "Referring domains", color: PALETTE.domains, points: monthly(links, (h) => h.referringDomains), href: (m) => to("referringDomains", { month: m ?? undefined }), rows: "Referring domains" },
    { key: "backlinks", label: "Backlinks", color: PALETTE.backlinks, points: monthly(links, (h) => h.backlinks), href: (m) => to("backlinks", { month: m ?? undefined }), rows: "Backlinks" },
    { key: "new", label: "New links that month", color: PALETTE.backlinks, points: monthly(links, (h) => h.newBacklinks), href: (m) => to("newBacklinks", { month: m ?? undefined }), rows: "New links" },
    { key: "lost", label: "Lost links that month", color: PALETTE.backlinks, points: monthly(links, (h) => h.lostBacklinks), href: (m) => to("lostBacklinks", { month: m ?? undefined }), rows: "Lost links" },
  ];
  /** The chart figures drawn once the report is on screen (each chart needs two months; a figure two months of its own), so the chip never names one that isn't. */
  const drawn = report ? new Set([...(hist.length > 1 ? performance : []), ...(links.length > 1 ? growth : [])].filter((x) => x.points.length >= 2).map((x) => x.key)) : undefined;
  /** What the address asks of the overview, in words for the chip — including a word that names nothing, said rather than dropped. */
  const overview = view === "overview" ? overviewWords(Object.fromEntries(OVERVIEW_PARAMS.map((k) => [k, params.get(k) ?? undefined])), drawn) : [];
  /** The three bands of the position chart, each leading to its keywords. The grey band is everything from position 11 down — the estimate is not capped at 100. */
  const CHART_BANDS = [
    { key: "top3", name: "Positions 1–3", words: "keywords ranking in the top 3", color: PALETTE.top3, opacity: 0.85, href: to("keywords", { band: "top3" }), testId: "link-position-chart-top3" },
    { key: "top10", name: "Positions 4–10", words: "positions 4–10", color: PALETTE.top10, opacity: 0.7, href: to("keywords", { pos: "4-10" }), testId: "link-position-chart-4-10" },
    { key: "rest", name: "Position 11 and below", words: "the rest, from position 11 down", color: PALETTE.rest, opacity: 0.6, href: to("keywords", { band: "rest" }), testId: "link-position-chart-rest" },
  ] as const;
  const menuStyle = (active: boolean): CSSProperties | undefined => (active ? { color: "var(--g-blue)", background: "var(--g-accent-soft)" } : undefined);
  /** The links from one referring domain: the Backlinks page picks them out for a tracked site; the explorer's list can't yet, and says so. */
  const linksFrom = (d: string) => (trackedSite ? seoLinks.backlinks(trackedSite.id, { domain: d }) : to("backlinks", { source: d }));

  return (
    <SeoShell title="Site explorer" description="Any website's estimated search traffic, keywords, backlinks and competitors — yours or a competitor's." site={site} onSite={onSite} sites={sites} status={status} picker={false}>
      {/* The domain box is this tool's global input: it lives in the tool bar's second row (components/tool/shell.tsx). */}
      <ToolBarSlot>
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
        {site && site.domain !== input.trim() && <button type="button" className="g-pill min-h-[44px]" onClick={() => { setInput(site.domain); open(site.domain); }} data-testid="button-explorer-my-site">My site: {site.domain}</button>}
      </form>
      </ToolBarSlot>
      <p className="g-text-2 mb-4 text-[13px]" data-testid="text-explorer-cost">
        A new report costs {priceOf(status.data, "explorerReport")} of your SEO data. Reopening a saved one is free for {recent.data?.freeForDays ?? 7} days.{holdNote(status.data, "explorerReport")}{!affordable && " You don't have enough SEO data left for a new report — add credit above."}
      </p>
      {/* What the address picked on the overview (a month, two months compared, a chart figure, a first-look table), with a way to clear it — the report views have their own chip. */}
      {overview.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-2" role="status" data-testid="overview-filter">
          <span className="inline-flex min-h-[44px] max-w-full items-center rounded-full px-3 py-1 text-[13px] leading-5" style={{ color: "var(--g-blue)", background: "var(--g-accent-soft)" }} data-testid="active-filter">{overview.join(" · ")}</span>
          <button type="button" className="g-pill min-h-[44px]" onClick={() => setParams(OVERVIEW_CLEAR)} aria-label="Clear what was picked on the overview" data-testid="button-clear-filters"><X /> Clear</button>
        </div>
      )}

      {!report && !busy && (recent.data?.items.length ?? 0) > 0 && (
        <Panel title="Recently analysed" testId="panel-explorer-recent" className="mb-4">
          <table className="g-table">
            <thead><tr><th>Domain</th><th className="num">Authority</th><th className="num">Referring domains</th><th className="num">Organic keywords</th><th className="num">Organic traffic (est.)</th><th className="num">Analysed</th></tr></thead>
            <tbody>
              {recent.data!.items.map((r) => {
                const m = findMarket(r.locationCode ?? 2840, r.languageCode ?? "en") ?? market;
                // The row's own country goes with every link, said in full (even the United States): the row may not be in
                // the remembered country, and the figure and the landing must be the same report.
                const go = (v: string, p: ExplorerParams = {}) => seoLinks.explorer(r.domain, v, { locationCode: m.locationCode, languageCode: m.languageCode, ...p });
                return (
                  <tr key={`${r.domain}:${r.locationCode}:${r.languageCode}`}>
                    <td><Fig href={go("overview")} testId={`button-open-${r.domain}`}>{r.domain}</Fig>{(r.locationCode ?? 2840) !== 2840 || (r.languageCode ?? "en") !== "en" ? <span className="g-text-2 ml-2 text-[12px]">{marketLabel(r.locationCode, r.languageCode)}</span> : null}</td>
                    <td className="num" data-label="Authority"><Fig href={go("backlinks")} testId="link-recent-authority">{r.authority ?? "—"}</Fig></td>
                    <td className="num" data-label="Referring domains"><Fig href={go("referringDomains")} testId="link-recent-ref-domains">{fmtNum(r.referringDomains)}</Fig></td>
                    <td className="num" data-label="Organic keywords"><Fig href={go("keywords")} testId="link-recent-keywords">{fmtNum(r.keywords)}</Fig></td>
                    <td className="num" data-label="Organic traffic"><Fig href={go("pages")} testId="link-recent-traffic">{fmtNum(r.traffic)}</Fig></td>
                    <td className="num" data-label="Analysed"><Fig href={go("overview")} testId="link-recent-analysed" label={`Analysed ${fmtDate(r.fetchedAt)} — open the saved report`}>{fmtDate(r.fetchedAt)}</Fig></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Panel>
      )}
      {busy && <p className="g-text-2 flex items-center gap-2 text-[14px]" role="status" data-testid="text-explorer-loading"><Loader2 className="h-4 w-4 animate-spin" /> {analyse.isPending ? "Gathering search and backlink data — about ten seconds…" : "Opening the saved report…"}</p>}
      {savedFailed && <div className="g-callout" role="alert" data-testid="explorer-saved-error"><h3>Couldn't check for a saved report</h3><p>{apiErrorMessage(saved.error)}</p><button type="button" className="g-pill mt-2" onClick={() => void saved.refetch()}>Try again</button></div>}
      {notFoundYet && <Empty testId="explorer-empty"><h3>No report for {domain} yet</h3><p>Press <b>Analyse</b> to build one.{standalone && <> The {MENU_LABEL[view]} report below is its own lookup: a page already run opens free, and nothing is bought until you press Run.</>}</p></Empty>}
      {notFoundYet && domain && !standalone && (
        <section className="mt-5" data-testid="explorer-opportunities-only">
          <h2 className="g-text mb-1 text-[17px] font-medium">Or just the opportunities</h2>
          <p className="g-text-2 mb-3 text-[13px]">This one lookup does not need the full report.</p>
          <OpportunitiesView key={`solo:${domain}:${marketKey(market)}`} domain={domain} status={status.data} market={market} />
        </section>
      )}
      {!report && !busy && !domain && (recent.data?.items.length ?? 0) === 0 && (
        <Empty testId="explorer-intro"><h3>Look up any website</h3><p>Enter a domain to see an estimate of how much search traffic it gets, which keywords and pages earn it, who links to it and who it competes with.</p></Empty>
      )}

      {(report || standalone) && (
        <div data-testid="explorer-report">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-[16px] font-semibold uppercase" style={{ color: "var(--g-blue)", background: "var(--g-accent-soft)" }} aria-hidden>{shown.replace(/^www\./, "")[0]}</span>
            <div className="min-w-0">
              <h2 className="g-text text-[18px] font-semibold leading-6 [overflow-wrap:anywhere]">Overview: <a href={`https://${shown}`} target="_blank" rel="noreferrer" className={FIG}>{shown} <ExternalLink className="inline h-3.5 w-3.5" aria-hidden /></a></h2>
              {report && <span className="g-text-2 text-[12px]" data-testid="text-explorer-fetched">{marketLabel(report.locationCode ?? 2840, report.languageCode ?? "en")} · as of {fmtDate(report.fetchedAt)}</span>}
            </div>
            {report && (
              <div className="ml-auto flex flex-wrap gap-2">
                {!tracked && <button type="button" className="g-pill min-h-[44px]" disabled={track.isPending} onClick={() => track.mutate(report.domain)} data-testid="button-explorer-track"><Plus /> Track rankings</button>}
                <button type="button" className="g-pill min-h-[44px]" disabled={analyse.isPending || !configured} onClick={() => { setInput(report.domain); analyse.mutate({ domain: report.domain, refresh: true }); }} data-testid="button-explorer-refresh"><RefreshCw className={analyse.isPending ? "animate-spin" : ""} /> Refresh</button>
              </div>
            )}
          </div>
          {report && report.missing.length > 0 && <p className="g-text-2 mb-3 text-[13px]" role="status" data-testid="text-explorer-missing">Some sections didn't load this time ({report.missing.map((m) => TABLE_LABEL[m as TableKey] ?? cap(m)).join(", ")}). Refresh to try again.</p>}

          <div className="flex flex-col gap-5 lg:flex-row">
            {/* Each report is an address of its own (a link, a bookmark, the back button); the filters of the last one do not carry over. */}
            <nav className="flex-none lg:w-48" aria-label="Site explorer reports" data-testid="explorer-menu">
              {MENU.map((g) => (
                <div key={g.group || "top"} className="mb-3">
                  {g.group && <div className="mb-1 text-[11px] font-medium uppercase tracking-wide" style={{ color: "var(--g-blue)" }}>{g.group}</div>}
                  <div className="flex flex-wrap gap-1 lg:flex-col lg:gap-0">
                    {g.items.map(([key, label]) => (
                      <Link key={key} href={to(key)} aria-current={view === key ? "page" : undefined} data-testid={`menu-${key}`}
                        className={`inline-flex min-h-[44px] items-center rounded-md px-2 py-1 text-left text-[13px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--g-blue)] ${view === key ? "font-medium" : "g-text-2 underline decoration-1 decoration-[color:var(--g-divider)] underline-offset-[3px]"}`} style={menuStyle(view === key)}>{label}</Link>
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
                  : <p className="g-text-2 text-[13px]" data-testid="mentions-untracked">Mentions are looked for on your own sites: press <b>Track rankings</b> above to add {shown}, then open this again.</p>
              ) : view === "directories" ? (
                <DirectoriesView domain={shown} status={status.data} suggestions={(report?.competitors ?? []).map((c) => c.domain)} planSiteId={trackedSite?.id} market={market} />
              ) : view === "opportunities" ? (
                <OpportunitiesView key={`${shown}:${marketKey(market)}`} domain={shown} status={status.data} market={market} planSiteId={trackedSite?.id} onTrack={trackedSite ? (rows) => trackKeywords.mutate({ siteId: trackedSite.id, rows }) : undefined} />
              ) : view === "contentGap" || view === "linkIntersect" ? (
                <GapView planSiteId={trackedSite?.id} market={market} kind={view === "contentGap" ? "content" : "links"} domain={shown} status={status.data} suggestions={(report?.competitors ?? []).map((c) => c.domain)}
                  onExplore={(d) => { setInput(d); open(d); }} onTrack={trackedSite ? (rows) => trackKeywords.mutate({ siteId: trackedSite.id, rows }) : undefined} />
              ) : reportTable && (<>
                {REPORT_NOTE[reportTable] && <p className="g-text-2 mb-3 text-[13px]" data-testid="text-report-note">{REPORT_NOTE[reportTable]}</p>}
                <ReportView key={`${reportTable}:${shown}:${marketKey(market)}`} linked market={market} table={reportTable} domain={shown} siteId={trackedSite?.id} status={status.data} onExplore={(d) => { setInput(d); open(d); }} extraAction={(rows, clear) => <AddToList market={market} rows={rows} onDone={clear} />}
                  onTrack={trackedSite ? (rows) => trackKeywords.mutateAsync({ siteId: trackedSite.id, rows }) : undefined} trackLabel="Add to rank tracker" />
              </>)}
              {(view === "keywords" || view === "paidKeywords") && !trackedSite && <p className="g-text-2 mt-2 text-[13px]">Press <b>Track rankings</b> above to follow this site's keywords every week.</p>}
            </>
          ) : report && (
          <>
          {/* The headline figures as one card: backlinks and organic search side by side on a wide screen, paid search on a
              row of its own under them (beside the report menu, seven columns in one row would be too narrow to read).
              Each figure, its change and its footnote figure lead to their report; each small chart has its months. */}
          <div className="mb-4 rounded-xl border p-3 sm:p-4" style={SURFACE} data-testid="explorer-figures">
            <div className="grid gap-y-5 xl:grid-cols-[3fr_2fr] xl:gap-x-5">
              <section className="min-w-0" data-testid="panel-backlinks">
                <Kicker>Backlink profile</Kicker>
                <div className="grid grid-cols-2 gap-x-2 gap-y-5 sm:grid-cols-3">
                  <Col first><Metric label="Authority" testId="stat-authority" href={to("backlinks")} linkTestId="link-authority" value={report.links.authority ?? "—"} delta={<Delta value={change(links.map((h) => h.authority))} href={to("backlinks", { month: lastMonth(links) })} testId="link-authority-change" label="Authority, change over the months shown" />} foot="link strength, 0–100 — estimated from the backlinks"
                    chart={spark(monthly(links, (h) => h.authority), PALETTE.authority, "spark-authority")} /></Col>
                  <Col><Metric label="Backlinks" testId="stat-backlinks" href={to("backlinks")} linkTestId="link-backlinks" value={compact(report.links.backlinks)} delta={<Delta value={change(links.map((h) => h.backlinks))} href={to("backlinks", { month: lastMonth(links) })} testId="link-backlinks-change" label="Backlinks, change over the months shown" />} foot={report.links.brokenBacklinks != null ? <Fig href={to("brokenBacklinks")} testId="link-broken">{compact(report.links.brokenBacklinks)} broken</Fig> : undefined}
                    chart={spark(monthly(links, (h) => h.backlinks), PALETTE.backlinks, "spark-backlinks")} /></Col>
                  <Col><Metric label="Referring domains" testId="stat-ref-domains" href={to("referringDomains")} linkTestId="link-ref-domains" value={compact(report.links.referringDomains)} delta={<Delta value={change(links.map((h) => h.referringDomains))} href={to("referringDomains", { month: lastMonth(links) })} testId="link-ref-domains-change" label="Referring domains, change over the months shown" />} foot={report.links.referringIps != null ? <Fig href={to("referringIps")} testId="link-ref-ips">{compact(report.links.referringIps)} IPs</Fig> : undefined}
                    chart={spark(monthly(links, (h) => h.referringDomains), PALETTE.domains, "spark-ref-domains")} /></Col>
                </div>
              </section>
              <section className="min-w-0 border-t pt-5 xl:border-l xl:border-t-0 xl:pl-5 xl:pt-0" style={{ borderColor: "var(--g-divider)" }} data-testid="panel-organic">
                <Kicker>Organic search</Kicker>
                <div className="grid grid-cols-2 gap-x-2 gap-y-5">
                  <Col first><Metric label="Organic keywords" testId="stat-organic-keywords" href={to("keywords")} linkTestId="link-organic-keywords" value={compact(report.organic.keywords)} delta={<Delta value={change(hist.map((h) => h.keywords))} href={to("keywords", { month: lastMonth(hist) })} testId="link-organic-keywords-change" label="Organic keywords, change over the months shown" />}
                    chart={spark(monthly(hist, (h) => h.keywords), PALETTE.keywords, "spark-organic-keywords")}>
                    <div className="mt-1.5"><LinkedDistribution testId="distribution-keywords" parts={[
                      { label: "Top 3", value: report.organic.positions.top3, color: PALETTE.top3, href: to("keywords", { band: "top3" }), testId: "link-dist-top3", words: `Keywords in the top 3: ${fmtNum(report.organic.positions.top3)}` },
                      { label: "4–10", value: Math.max(0, report.organic.positions.top10 - report.organic.positions.top3), color: PALETTE.top10, href: to("keywords", { pos: "4-10" }), testId: "link-dist-4-10", words: `Keywords in positions 4–10: ${fmtNum(Math.max(0, report.organic.positions.top10 - report.organic.positions.top3))}` },
                      { label: "11+", value: Math.max(0, report.organic.keywords - report.organic.positions.top10), color: PALETTE.rest, href: to("keywords", { band: "rest" }), testId: "link-dist-rest", words: `Keywords from position 11 down: ${fmtNum(Math.max(0, report.organic.keywords - report.organic.positions.top10))}` },
                    ]} /></div>
                  </Metric></Col>
                  <Col><Metric label="Organic traffic (estimate)" testId="stat-organic-traffic" href={to("pages")} linkTestId="link-organic-traffic" value={compact(report.organic.traffic)} delta={<Delta value={change(hist.map((h) => h.traffic))} href={to("pages", { month: lastMonth(hist) })} testId="link-organic-traffic-change" label="Organic traffic, change over the months shown" />} foot={<>Visits a month, estimated from rankings · worth <Fig href={to("paidKeywords")} testId="link-traffic-value">{usd(report.organic.trafficValue)} / mo as ads</Fig></>}
                    chart={spark(monthly(hist, (h) => h.traffic), PALETTE.traffic, "spark-organic-traffic")} /></Col>
                </div>
                <p className="g-text-2 mt-3 text-[12px]" data-testid="text-organic-movement">
                  Since last month: <Fig href={to("keywords", { move: "up" })} testId="link-move-up" style={{ color: "var(--g-green)" }}>▲ {fmtNum(report.organic.isUp)} up</Fig> · <Fig href={to("keywords", { move: "down" })} testId="link-move-down" style={{ color: "var(--g-red)" }}>▼ {fmtNum(report.organic.isDown)} down</Fig> · <Fig href={to("keywords", { move: "new" })} testId="link-move-new">{fmtNum(report.organic.isNew)} new</Fig> · <Fig href={to("keywords", { move: "lost" })} testId="link-move-lost">{fmtNum(report.organic.isLost)} lost</Fig>
                </p>
              </section>
              <section className="min-w-0 border-t pt-5 xl:col-span-2" style={{ borderColor: "var(--g-divider)" }} data-testid="panel-paid">
                <Kicker>Paid search</Kicker>
                <div className="grid grid-cols-2 gap-x-2 gap-y-5 sm:grid-cols-3 xl:grid-cols-5">
                  <Col first><Metric label="Paid keywords" testId="stat-paid-keywords" href={to("paidKeywords")} linkTestId="link-paid-keywords" value={compact(report.paid.keywords)} /></Col>
                  <Col><Metric label="Paid traffic" testId="stat-paid-traffic" href={to("ads")} linkTestId="link-paid-traffic" value={compact(report.paid.traffic)} foot={<>Est. cost <Fig href={to("paidKeywords")} testId="link-paid-cost">{usd(report.paid.trafficValue)} / mo</Fig></>} /></Col>
                </div>
                {report.paid.keywords === 0 && <p className="g-text-2 mt-3 text-[12px]">No Google Ads seen for this domain. <Fig href={to("ads")} testId="link-paid-none">The ads list →</Fig></p>}
              </section>
            </div>
          </div>

          <CompareMonths report={report} month={month} from={cmpFrom} to={cmpTo} href={to} />
          <div className="mb-4 grid gap-4 lg:grid-cols-3">
            <section className="min-w-0 lg:col-span-2" data-testid="panel-performance">
              {hist.length > 1 ? (
                <div data-testid="chart-performance">
                  <MonthTrend key={report.domain} title="Performance" testId="check-series" note="Monthly estimates from the keyword database." series={performance} month={month} onPick={pickMonth} active={seriesParam} onSeries={(k) => setParam("series", k)} monthHref={(m) => here({ month: m })} />
                </div>
              ) : <Panel title="Performance" hint="estimated, by month"><p className="g-text-2 text-[13px]">No history for this domain yet. <Fig href={to("keywords")} testId="link-performance-none">The keywords as of today →</Fig></p></Panel>}
            </section>
            <div className="flex min-w-0 flex-col gap-4">
              <Panel title="Organic positions" hint="keywords by rank" testId="panel-positions" href={to("keywords")} linkTestId="link-panel-positions">
                <BarRows rows={positions} />
              </Panel>
              <Panel title="Referring domains" testId="panel-followed" href={to("referringDomains")} linkTestId="link-panel-followed">
                {report.links.referringDomains ? (
                  <BarRows of={report.links.referringDomains} rows={[
                    { label: "Followed", value: report.links.followedDomains, hint: followedPct == null ? undefined : `${followedPct}%`, href: to("referringDomains", { followed: true }), testId: "link-followed", words: `Followed referring domains: ${fmtNum(report.links.followedDomains)}` },
                    { label: "Not followed", value: report.links.nofollowDomains, hint: followedPct == null ? undefined : `${Math.round((100 - followedPct) * 10) / 10}%`, href: to("referringDomains", { followed: false }), testId: "link-not-followed", words: `Not followed referring domains: ${fmtNum(report.links.nofollowDomains)}` },
                  ]} />
                ) : <p className="g-text-2 text-[13px]">No referring domains found. <Fig href={to("referringDomains")} testId="link-followed-none">The list →</Fig></p>}
              </Panel>
              {(report.links.tlds ?? []).length > 0 && (
                <Panel title="Backlinks by domain ending" hint="the top 6" testId="panel-tlds" href={to("referringDomains")} linkTestId="link-panel-tlds">
                  <BarRows rows={report.links.tlds.map((t) => ({ label: `.${t.tld}`, value: t.links, href: to("referringDomains", { tld: `.${t.tld}` }), testId: `link-tld-${t.tld}`, words: `Referring domains ending .${t.tld}: ${fmtNum(t.links)} links` }))} />
                </Panel>
              )}
            </div>
          </div>

          {links.length > 1 && (
            <section className="mb-4" data-testid="panel-link-history">
              <div data-testid="chart-link-history">
                <MonthTrend key={report.domain} title="Backlink growth" testId="link-history" note="Monthly, from the backlink index — the last 12 months. New and lost are the links gained and lost in that month." series={growth} month={month} onPick={pickMonth} active={seriesParam} onSeries={(k) => setParam("series", k)} monthHref={(m) => here({ month: m })} />
              </div>
            </section>
          )}
          {hist.length > 1 && (
            <Panel title="Organic keywords by position" hint="by month" testId="panel-position-history" className="mb-4" href={to("keywords")} linkTestId="link-panel-position-history">
              <div className="h-44 sm:h-56" aria-hidden>
                <ResponsiveContainer>
                  <ComposedChart data={hist.map((h) => ({ month: h.month, top3: h.top3, top10: Math.max(0, h.top10 - h.top3), rest: Math.max(0, h.keywords - h.top10) }))} margin={{ top: 6, right: 6, bottom: 0, left: 0 }}>
                    <CartesianGrid stroke="var(--g-divider)" strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="month" tickFormatter={(m) => monthLabel(String(m))} tick={{ fontSize: 11, fill: "var(--g-text-2)" }} axisLine={false} tickLine={false} minTickGap={24} />
                    <YAxis tick={{ fontSize: 11, fill: "var(--g-text-2)" }} axisLine={false} tickLine={false} width={44} tickFormatter={(v) => compact(v)} allowDecimals={false} />
                    <Tooltip labelFormatter={(m) => monthLabel(String(m))} formatter={(v: number, name: string) => [fmtNum(v), name]} contentStyle={TOOLTIP} labelStyle={{ color: "var(--g-text-2)" }} />
                    {CHART_BANDS.map((b) => <Area key={b.key} type="monotone" dataKey={b.key} name={b.name} stackId="p" stroke={b.color} fill={b.color} fillOpacity={b.opacity} isAnimationActive={false} style={{ cursor: "pointer" }} onClick={() => navigate(b.href)} />)}
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
              <p className="g-text-2 flex flex-wrap items-center gap-x-3 text-[12px]">
                {CHART_BANDS.map((b, i) => <Fig key={b.key} href={b.href} testId={b.testId} className="gap-1 px-1"><span className="inline-block h-2 w-2 rounded-sm" style={{ background: b.color }} aria-hidden />{["Dark orange", "Light orange", "Grey"][i]}: {b.words} →</Fig>)}
                <span>Monthly estimates; the grey band is not capped at position 100.</span>
              </p>
              <MonthLinks months={hist.map((h) => ({ month: h.month, label: monthLabel(h.month) }))} href={(m) => here({ month: m })} current={month} testId="position-history-months" collapsed what="a month to compare" />
            </Panel>
          )}
          {report.intents && (
            <Panel title="Organic keywords by intent" testId="panel-intents" className="mb-4" href={to("keywords")} linkTestId="link-panel-intents"
              hint={<>of the <Fig href={here({ quick: undefined })} testId="link-intents-top" label={`The top ${report.keywords?.length ?? 0} keywords these intents are counted from — the first look below`}>top {report.keywords?.length ?? 0} keywords</Fig></>}>
              <table className="g-table">
                <thead><tr><th>Intent</th><th className="num">Keywords</th><th className="num">Traffic</th></tr></thead>
                <tbody>{report.intents.map((i) => {
                  // An intent the keyword list has no filter for leads to every keyword, and the link says so.
                  const known = (INTENTS as readonly string[]).includes(i.intent), href = known ? to("keywords", { intent: i.intent }) : to("keywords");
                  const unknown = known ? "" : " — the keyword list has no filter for this intent, so every keyword is shown";
                  return (
                    <tr key={i.intent}>
                      <td><Fig href={href} testId={`link-intent-${i.intent}`} label={known ? undefined : `${cap(i.intent)}${unknown}`}>{cap(i.intent)}</Fig></td>
                      <td className="num" data-label="Keywords"><ShareBar value={i.keywords} max={maxOf(report.intents!.map((x) => x.keywords))} href={href} testId={`link-intent-${i.intent}-keywords`} words={`${cap(i.intent)} keywords: ${fmtNum(i.keywords)}${unknown}`} /></td>
                      <td className="num" data-label="Traffic"><Fig href={href} testId={`link-intent-${i.intent}-traffic`} label={`${cap(i.intent)} keywords' traffic: ${fmtNum(i.traffic)} visits a month${unknown}`}>{fmtNum(i.traffic)}</Fig></td>
                    </tr>
                  );
                })}</tbody>
              </table>
            </Panel>
          )}

          <p className="g-text-2 mb-2 text-[13px]">A first look at each list. The full reports — every row, with filters, sorting and export — are in the menu on the left.</p>
          {/* The table shown is the address's `quick`, so a first look is a place a link can land on. */}
          <nav className="g-tabs" aria-label="Report tables">
            {TABLES.map((t) => <Link key={t} href={here({ quick: t === "keywords" ? undefined : t })} aria-current={quick === t ? "page" : undefined} className="inline-flex min-h-[44px] items-center focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--g-blue)]" style={quick === t ? { color: "var(--g-blue)", borderBottomColor: "var(--g-blue)" } : undefined} data-testid={`tab-explorer-${t}`}>{TABLE_LABEL[t]}</Link>)}
          </nav>
          {quick === "keywords" && (report.keywords?.length ? (
            <>
              <p className="g-text-2 mb-2 text-[13px]">Showing the <Fig href={to("keywords")} testId="link-keywords-shown" label={`The ${report.keywords.length} keywords that bring the most traffic — the keyword report, most traffic first`}>{report.keywords.length} keywords that bring the most traffic</Fig>{report.keywordsTotal ? <> of <Fig href={to("keywords")} testId="link-keywords-total" label={`Every keyword: ${fmtNum(report.keywordsTotal)}`}>{fmtNum(report.keywordsTotal)}</Fig></> : ""}. <Fig href={to("keywords")} testId="link-all-keywords">Every keyword →</Fig></p>
              <table className="g-table" data-testid="table-explorer-keywords">
                <thead><tr><th>Keyword</th><th className="num">Position</th><th className="num">Volume</th><th className="num">Traffic</th><th className="num">Difficulty</th><th className="num">CPC</th><th>Intent</th><th>Page</th></tr></thead>
                <tbody>{report.keywords.map((k) => {
                  const path = pathOfUrl(k.url, report.domain), band = bandOfPosition(k.position);
                  return (
                    <tr key={`${k.keyword}-${k.url}`}>
                      <td><Fig href={kw(k.keyword)} testId="link-keyword">{k.keyword}</Fig></td>
                      <td className="num" data-label="Position">{band ? <Fig href={to("keywords", band)} testId="link-keyword-position" label={`Position ${k.position} — the keywords in that band`}><PositionBadge value={k.position} /></Fig> : <PositionBadge value={k.position} />}</td>
                      <td className="num" data-label="Volume"><Fig href={kw(k.keyword, { section: "volume" })} testId="link-keyword-volume" label={`${fmtNum(k.volume)} searches a month — the keyword's volume`}>{fmtNum(k.volume)}</Fig></td>
                      <td className="num" data-label="Traffic"><Fig href={path ? to("keywords", { path }) : kw(k.keyword, { section: "results" })} testId="link-keyword-traffic" label={`${fmtNum(k.traffic)} visits a month — ${path ? "the keywords of that page" : "the keyword's results"}`}>{fmtNum(k.traffic)}</Fig></td>
                      <td className="num" data-label="Difficulty"><Fig href={kw(k.keyword, { section: "serp" })} testId="link-keyword-difficulty" label="Difficulty — the keyword's results page"><DifficultyBadge value={k.difficulty} /></Fig></td>
                      <td className="num" data-label="CPC"><Fig href={kw(k.keyword, { section: "cpc" })} testId="link-keyword-cpc" label={`${k.cpc == null ? "no" : `$${k.cpc.toFixed(2)}`} cost a click — the keyword's ad prices`}>{k.cpc == null ? "—" : `$${k.cpc.toFixed(2)}`}</Fig></td>
                      <td data-label="Intent" className="whitespace-nowrap">{k.intent ? <Fig href={to("keywords", { intent: k.intent })} testId="link-keyword-intent" label={`${cap(k.intent)} keywords`}>{cap(k.intent)}</Fig> : "—"}</td>
                      <td data-label="Page" className="max-w-[240px] truncate">{k.url ? <>{path ? <Fig href={to("pages", { path })} testId="link-keyword-page">{stripUrl(k.url).replace(report.domain, "") || "/"}</Fig> : <a href={k.url} className={FIG} target="_blank" rel="noreferrer">{stripUrl(k.url).replace(report.domain, "") || "/"}</a>}<OpenIcon href={k.url} what="the page" /></> : "—"}</td>
                    </tr>
                  );
                })}</tbody>
              </table>
            </>
          ) : <Empty>No ranking keywords were found for {report.domain}. <Fig href={to("keywords")} testId="link-all-keywords">The full report →</Fig></Empty>)}
          {quick === "pages" && (report.pages?.length ? (
            <table className="g-table" data-testid="table-explorer-pages">
              <thead><tr><th>Page</th><th className="num">Traffic</th><th className="num">Keywords</th><th className="num">In top 10</th><th className="num">Traffic value</th></tr></thead>
              <tbody>{report.pages.map((p) => {
                const path = pathOfUrl(p.url, report.domain);
                const at = (v: string, q: ExplorerParams = {}) => (path ? to(v, { path, ...q }) : to(v, q));
                // Whose keywords the figures open: this page's — or, when its address isn't on this site, the whole site's, and the words say so.
                const whose = path ? "the keywords of this page" : `${report.domain}'s keywords (this page's address isn't on ${report.domain}, so the list can't be narrowed to it)`;
                return (
                  <tr key={p.url}>
                    <td className="max-w-[420px] truncate">{path ? <Fig href={to("pages", { path })} testId="link-page">{stripUrl(p.url)}</Fig> : <a href={p.url} className={FIG} target="_blank" rel="noreferrer">{stripUrl(p.url)}</a>}<OpenIcon href={p.url} what="the page" /></td>
                    <td className="num" data-label="Traffic"><ShareBar value={p.traffic} max={maxOf(report.pages!.map((x) => x.traffic))} href={at("keywords")} testId="link-page-traffic" words={`${fmtNum(p.traffic)} visits a month — ${whose}`} /></td>
                    <td className="num" data-label="Keywords"><Fig href={at("keywords")} testId="link-page-keywords">{fmtNum(p.keywords)}</Fig></td>
                    <td className="num" data-label="In top 10"><Fig href={at("keywords", { band: "top10" })} testId="link-page-top10">{fmtNum(p.top10)}</Fig></td>
                    <td className="num" data-label="Traffic value"><Fig href={at("keywords", { sort: "cpc" })} testId="link-page-value" label={`${usd(p.trafficValue)} a month as ads — ${whose}, by ad price`}>{usd(p.trafficValue)}</Fig></td>
                  </tr>
                );
              })}</tbody>
            </table>
          ) : <Empty>No ranking pages were found for {report.domain}. <Fig href={to("pages")} testId="link-all-pages">The full report →</Fig></Empty>)}
          {quick === "competitors" && (report.competitors?.length ? (
            <table className="g-table" data-testid="table-explorer-competitors">
              <thead><tr><th>Competitor</th><th className="num">Shared keywords</th><th className="num">Their keywords</th><th className="num">Their traffic</th><th></th></tr></thead>
              <tbody>{report.competitors.map((c) => (
                <tr key={c.domain}>
                  <td><Fig href={other(c.domain)} testId="link-competitor">{c.domain}</Fig><OpenIcon href={`https://${c.domain}`} what={c.domain} /></td>
                  <td className="num" data-label="Shared keywords"><ShareBar value={c.commonKeywords} max={maxOf(report.competitors!.map((x) => x.commonKeywords))} href={other(c.domain, "keywords", { why: "shared" })} testId="link-competitor-shared" words={`${fmtNum(c.commonKeywords)} shared keywords — ${c.domain}'s keywords`} /></td>
                  <td className="num" data-label="Their keywords"><Fig href={other(c.domain, "keywords")} testId="link-competitor-keywords">{fmtNum(c.keywords)}</Fig></td>
                  <td className="num" data-label="Their traffic"><Fig href={other(c.domain, "pages")} testId="link-competitor-traffic">{fmtNum(c.traffic)}</Fig></td>
                  <td className="num"><Fig href={other(c.domain)} testId={`button-explore-${c.domain}`} label={`Explore ${c.domain}`}>Explore</Fig></td>
                </tr>
              ))}</tbody>
            </table>
          ) : <Empty>No organic competitors were found for {report.domain}. <Fig href={to("competitors")} testId="link-all-competitors">The full report →</Fig></Empty>)}
          {quick === "referringDomains" && (report.referringDomains?.length ? (
            <table className="g-table" data-testid="table-explorer-ref-domains">
              <thead><tr><th>Domain</th><th className="num">Authority</th><th className="num">Links to this site</th><th className="num">Spam</th><th>Follow</th><th className="num">First seen</th></tr></thead>
              <tbody>{report.referringDomains.map((d) => (
                <tr key={d.domain}>
                  <td><Fig href={other(d.domain)} testId="link-referring-domain">{d.domain}</Fig><OpenIcon href={`https://${d.domain}`} what={d.domain} /></td>
                  <td className="num" data-label="Authority"><Fig href={other(d.domain, "referringDomains")} testId="link-referring-authority" label={`Authority ${d.authority ?? "unknown"} — the sites linking to ${d.domain}`}>{d.authority ?? "—"}</Fig></td>
                  <td className="num" data-label="Links"><Fig href={linksFrom(d.domain)} testId="link-referring-links" label={`${fmtNum(d.backlinks)} links from ${d.domain}`}>{fmtNum(d.backlinks)}</Fig></td>
                  <td className="num" data-label="Spam">{d.spamScore == null ? "—" : <Fig href={other(d.domain, "backlinks", { why: "spam" })} testId="link-referring-spam" label={`Spam score ${d.spamScore} — ${d.domain}'s own links (no view lists spam scores)`}>{d.spamScore}</Fig>}</td>
                  <td data-label="Follow"><Fig href={to("referringDomains", { followed: d.followed })} testId={d.followed ? "link-row-followed" : "link-row-nofollow"}>{d.followed ? "followed" : "nofollow"}</Fig></td>
                  <td className="num" data-label="First seen"><Fig href={to("referringDomains", { sort: "newest" })} testId="link-referring-first-seen" label={`First seen ${fmtDate(d.firstSeen)} — the list newest first`}>{fmtDate(d.firstSeen)}</Fig></td>
                </tr>
              ))}</tbody>
            </table>
          ) : <Empty>No referring domains were found for {report.domain}. <Fig href={to("referringDomains")} testId="link-all-referring-domains">The full report →</Fig></Empty>)}
          {quick === "anchors" && (report.anchors?.length ? (
            <table className="g-table" data-testid="table-explorer-anchors">
              <thead><tr><th>Anchor text</th><th className="num">Backlinks</th><th className="num">Referring domains</th><th className="num">First seen</th></tr></thead>
              <tbody>{report.anchors.map((a, i) => {
                const withAnchor = (p: ExplorerParams = {}) => to("backlinks", { anchor: a.anchor || undefined, ...p });
                return (
                  <tr key={`${a.anchor}-${i}`}>
                    <td className="max-w-[420px] truncate">{a.anchor ? <Fig href={withAnchor()} testId="link-anchor-links">{a.anchor}</Fig> : <Fig href={withAnchor()} testId="link-anchor-links" className="g-text-2">(no text — image or empty link)</Fig>}</td>
                    <td className="num" data-label="Backlinks"><ShareBar value={a.backlinks} max={maxOf(report.anchors!.map((x) => x.backlinks))} href={withAnchor({ everyLink: true })} testId="link-anchor-backlinks" words={`${fmtNum(a.backlinks)} links with this anchor`} /></td>
                    <td className="num" data-label="Referring domains"><Fig href={withAnchor()} testId="link-anchor-domains" label={`${fmtNum(a.referringDomains)} sites using this anchor — one link per site`}>{fmtNum(a.referringDomains)}</Fig></td>
                    <td className="num" data-label="First seen"><Fig href={withAnchor({ sort: "newest" })} testId="link-anchor-first-seen" label={`First seen ${fmtDate(a.firstSeen)} — the links with this anchor, newest first`}>{fmtDate(a.firstSeen)}</Fig></td>
                  </tr>
                );
              })}</tbody>
            </table>
          ) : <Empty>No anchor text was found for {report.domain}. <Fig href={to("anchors")} testId="link-all-anchors">The full report →</Fig></Empty>)}
          </>
          )}
            </div>
          </div>
        </div>
      )}
    </SeoShell>
  );
}
