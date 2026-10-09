/**
 * /seo/rank-tracker — rank tracker: the figures in one row with their trends, the positions table with movement, Search
 * Console if connected, recent checks. Every figure, label and row is a link that lands on its data with the filter
 * applied (owner 2026-10-09: "all data should take you somewhere"); the addresses come from seoLinks.rankTracker
 * (links.ts) and are honoured on arrival — site, band, positions, move, tag, keyword, device, mapPack, noMap, checked,
 * feature, location, sort, series, date, panel and the panels' own controls (rank-params.ts). The narrowing shows in a
 * chip (data-testid="active-filter") with a way to clear it, and a filter picked on the page writes the same address,
 * so the back button undoes it. The site is written by the shell's picker alone (one history entry per pick).
 * Nothing is bought on arrival.
 */
import { GscBreakdownView } from "./gsc-breakdown";
import { SerpFeatureChips, featureWords, hasFeature, ownsFeature } from "./serp-features";
import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useSearch } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Play, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiErrorMessage } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { api, Empty, fmtDate, fmtNum, fmtUnit, money, Move, SeoShell, useSelectedSite, useSeoSites, useSeoStatus, useSiteMissing, type SeoSite } from "./shell";
import { KeywordHistory, RankHistoryPanel, useRankHistory, type HistoryDay } from "./rank-history";
import { RankTagsPanel } from "./rank-tags";
import { CompetingPages } from "./competing";
import { SerpGroupsPanel } from "./serp-groups";
import { LocationPicker, type Place } from "./location-picker";
import { CompetitorPanel } from "./rank-competitors";
import { countryLabel } from "@shared/seo-markets";
import { unresolvedPlaceMessage } from "@shared/seo-place";
import { seoLinks, type Movement } from "./links";
import { effectiveDevice, hrefWith, keepsRow, moved, narrowingWords, PANEL_TARGET, pageParts, scopeOf, scrollToTestId, showsMapPack, slug, useRankParams, utcDay, withFeature, type RankTo } from "./rank-params";
import { GradientSpark, MetricColumn, ORANGE, PALETTE } from "./viz";
import { CARD, LINK, LINK_BLOCK, LinkedDistributionBar, PositionBadge, PositionSpark, SectionTitle, TABLE, TAP } from "./viz-rank";

type Position = { position: number | null; url: string | null; checkedOn: string; previous: number | null; previousOn: string | null; features: string[]; local?: number | null; previousLocal?: number | null; pack?: { position: number; title: string; domain: string | null }[]; top?: { position: number; domain: string; url?: string | null; title?: string | null }[] } | null;
type Overview = {
  site: SeoSite; devices: ("desktop" | "mobile")[];
  summary: { tracked: number; checked: number; top3: number; top10: number; averagePosition: number | null; improved: number; declined: number; lastCheckedOn: string | null; inMapPack?: number; withMapPack?: number };
  rows: { id: number; keyword: string; location?: string | null; tags: string[]; searchVolume: number | null; cpc: number | null; difficulty: number | null; positions: Record<string, Position> }[];
  runs: { id: string; trigger: string; status: string; total: number; checked: number; error: string | null; /** Not every lookup came back with a result (null while the check runs, or for checks from before this was recorded). */ partial?: boolean | null; created_at: string; finished_at: string | null }[];
  searchConsole: { property: string; clicks: number | null; impressions: number | null; position: number | null; previousClicks: number | null; previousImpressions: number | null; days?: number; previousDays?: number; through?: string | null; comparable?: boolean;
    /** A read of these days is still running or failed, or whether every read finished is not known (`completenessUnknown`): the count may be short, and nothing is compared. */ incomplete?: boolean; completenessUnknown?: boolean } | null;
  nextCheck: { serps: number; priceCents?: number; nextAt: string | null; perMonthCents?: Record<"weekly" | "twice_weekly" | "daily", number> };
};

const RUN_STATUS: Record<string, string> = { queued: "queued", running: "checking", done: "done", failed: "didn't finish" };
const RUN_TRIGGER: Record<string, string> = { weekly: "automatic check", manual: "run now" };

/**
 * What the Search Console tile says under its number: the comparison when both 28-day windows are complete (every day
 * there and every read of them finished — the server's verdict), otherwise how much of EACH is synced and, when a read
 * is unfinished or its completeness is not known, that the count itself may be short.
 */
function gscHint(g: { clicks: number | null; previousClicks: number | null; days?: number; previousDays?: number; through?: string | null; comparable?: boolean; incomplete?: boolean; completenessUnknown?: boolean }): string {
  if (g.comparable) return `${fmtNum(g.previousClicks)} the 28 days before`;
  const now = g.days ?? 0, before = g.previousDays ?? 0;
  const synced = `${now} of the last 28 days synced${g.through ? ` (to ${fmtDate(g.through)})` : ""}; ${before} of the 28 before`;
  if (g.incomplete) return `${synced} — ${g.completenessUnknown ? "whether every day was fully read is not known" : "some days are still being read from Google, or a read failed, so the count may be short"}; not compared`;
  return `${synced} — not compared`;
}

/**
 * A row's movement since the check before, as the glyph beside its position shows it (shell.tsx `Move`) and as `move`
 * narrows the table (rank-params.ts `moved`): "new" before "up", "lost" before "down"; nothing without a check before.
 */
const moveOf = (p: Position): Movement | null => (p?.previousOn ? (["new", "lost", "up", "down", "unchanged"] as const).find((m) => moved(p, m)) ?? null : null);
const MOVED: Record<Movement, string> = { up: "moved up", down: "moved down", new: "newly found", lost: "no longer found", unchanged: "at the same position" };

/** A figure as a link in the blue of every link, with the test id the links contract asks for (link-<figure>). */
function Fig({ href, id, title, children, className = LINK }: { href: string; id: string; title: string; children: ReactNode; className?: string }) {
  return <Link href={href} className={className} title={title} data-testid={`link-${id}`}>{children}</Link>;
}

export default function SeoOverviewPage() {
  const status = useSeoStatus();
  const sites = useSeoSites();
  // The site comes from the address (?site=) through the shell's own hook, and the shell's picker is the one writer of it.
  const [site, onSite] = useSelectedSite(sites.data);
  const missing = useSiteMissing(sites.data);
  const params = useRankParams();
  const search = useSearch();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [openKw, setOpenKw] = useState<number | null>(null);
  const overview = useQuery<Overview>({
    queryKey: [`/api/seo/sites/${site?.id}/overview`], enabled: !!site, refetchOnMount: "always",
    refetchInterval: (q) => q.state.data?.runs.some((r) => r.status === "queued" || r.status === "running") ? 20_000 : false,
  });
  // The history charts (their keys carry the device/tag) and the dashboard change with every check and keyword edit.
  const refreshHistory = () => { void qc.invalidateQueries({ predicate: (q) => typeof q.queryKey[0] === "string" && (q.queryKey[0].startsWith(`/api/seo/sites/${site?.id}/rank-history`) || q.queryKey[0].startsWith(`/api/seo/sites/${site?.id}/rank-tags`) || q.queryKey[0].startsWith(`/api/seo/sites/${site?.id}/voice`) || q.queryKey[0] === `/api/seo/sites/${site?.id}/rank-competing` || q.queryKey[0].startsWith(`/api/seo/sites/${site?.id}/serp-groups`) || /^\/api\/seo\/keywords\/\d+\/history$/.test(q.queryKey[0])) }); void qc.invalidateQueries({ queryKey: ["/api/seo/dashboard"] }); };
  const invalidate = () => { refreshHistory(); void qc.invalidateQueries({ queryKey: [`/api/seo/sites/${site?.id}/overview`] }); void qc.invalidateQueries({ queryKey: ["/api/seo/sites"] }); void qc.invalidateQueries({ queryKey: ["/api/seo/status"] }); };
  const runNow = useMutation({
    mutationFn: () => api("POST", `/api/seo/sites/${site!.id}/rank-check`),
    onSuccess: (r: { serps: number; reused: boolean }) => { invalidate(); toast({ title: r.reused ? "A check is already running" : "Rank check started", description: r.reused ? "Results arrive over the next few minutes." : `${r.serps} search result page${r.serps === 1 ? "" : "s"} queued. Results arrive over the next few minutes.` }); },
    onError: (e) => toast({ title: "Couldn't start the check", description: apiErrorMessage(e), variant: "destructive" }),
  });
  const volumes = useMutation({
    mutationFn: () => api("POST", `/api/seo/sites/${site!.id}/keywords/volumes`),
    onSuccess: (r: { updated: number }) => { invalidate(); toast({ title: r.updated ? `Search volume added for ${r.updated} keyword${r.updated === 1 ? "" : "s"}` : "No search volume found for these keywords" }); },
    onError: (e) => toast({ title: "Couldn't get search volumes", description: apiErrorMessage(e), variant: "destructive" }),
  });
  const remove = useMutation({
    mutationFn: (id: number) => api("DELETE", `/api/seo/keywords/${id}`),
    onSuccess: invalidate,
    onError: (e) => toast({ title: "Couldn't remove the keyword", description: apiErrorMessage(e), variant: "destructive" }),
  });
  // The trend under each figure: the saved history the History panel reads too (one request, shared) — first device, all keywords.
  const history = useRankHistory(site?.id ?? null, "", "");
  const o = overview.data;
  const configured = !!status.data?.configured;
  const running = o?.runs.some((r) => r.status === "queued" || r.status === "running");
  // A check that just finished has new numbers for the history charts and the dashboard.
  const wasRunning = useRef(false);
  useEffect(() => { if (wasRunning.current && !running) refreshHistory(); wasRunning.current = !!running; }, [running]); // eslint-disable-line react-hooks/exhaustive-deps
  // Where a figure's link lands: this site, with the filter named. The site-wide figures link afresh (their counts are
  // over every keyword); a count made over the narrowed rows carries the narrowing (`scope`), so it lands on those rows.
  const to = (p: RankTo = {}) => seoLinks.rankTracker(site?.id ?? 0, p);
  const scope = scopeOf(params);
  const onDevice: RankTo = params.device ? { device: params.device } : {};
  // The table as the address narrows it: on the device named (the site's first otherwise), ordered when asked. The
  // keyword named is highlighted, never used to narrow. A map-pack view puts the keywords you were found in first.
  const device = o ? effectiveDevice(params, o.devices) : null;
  const rows = o && device ? o.rows.filter((r) => keepsRow(r, params, device)) : [];
  if (device && params.sort === "position") rows.sort((a, b) => { const k = (r: typeof a) => { const p = r.positions[device]; return p ? p.position ?? 1e6 : 1e7; }; return k(a) - k(b); });
  if (device && params.mapPack) rows.sort((a, b) => Number(b.positions[device]?.local != null) - Number(a.positions[device]?.local != null));
  const wanted = params.keyword?.toLowerCase() ?? null;
  const isWanted = (r: { keyword: string }) => wanted != null && r.keyword.toLowerCase() === wanted;
  // Arrival: the keyword's row is opened and scrolled to; else the panel named; else the narrowed table. Once per
  // address and site, after the data is there (the panels render after their own requests, so the scroll retries).
  const arrived = useRef("");
  useEffect(() => {
    if (!o || !site) return;
    const key = `${site.id}|${search}`;
    if (arrived.current === key) return;
    arrived.current = key;
    if (wanted) { const hit = o.rows.find(isWanted); if (hit) { setOpenKw(hit.id); return scrollToTestId(`row-keyword-${hit.id}`); } }
    const target = params.panel ? PANEL_TARGET[params.panel] : params.narrowed || params.device ? "rank-filter" : null;
    return target ? scrollToTestId(target) : undefined;
  }, [o, site, search]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <SeoShell
      title="Rank tracker" description="Where your site was found in Google's results for the keywords you chose, as of each saved check — automatic checks run weekly by default." site={site} onSite={onSite} sites={sites} status={status}
      actions={site && (
        <Button className="w-full sm:w-auto" disabled={!configured || !o || !o.rows.length || runNow.isPending || running} onClick={() => runNow.mutate()} data-testid="button-run-rank-check" title={!configured ? "Rank tracking is being switched on for your account" : undefined}>
          {runNow.isPending || running ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}
          {running ? "Checking…" : `Run check now${o?.nextCheck.priceCents ? ` · about ${money(o.nextCheck.priceCents)}` : ""}`}
        </Button>
      )}
    >
      {!site && sites.isSuccess && <Empty testId="seo-empty-sites"><h3>No sites yet</h3><p>Add the domain you want to track. Then add the keywords you care about, and the first check runs on the next weekly tick — or straight away with "Run check now".</p></Empty>}
      {site && missing && <p className="g-text-2 mb-3 text-[13px]" role="status" data-testid="text-site-missing">The address names site #{missing}, which is not one of yours (or was removed); showing {site.domain}.</p>}
      {site && overview.isLoading && <p className="g-text-2 flex items-center gap-2 text-[14px]" role="status"><Loader2 className="h-4 w-4 animate-spin" /> Loading your rankings…</p>}
      {site && overview.isError && <div className="g-callout" role="alert" data-testid="rank-overview-error"><h3>Couldn't load your rankings</h3><p>{apiErrorMessage(overview.error)}</p><button type="button" className="g-pill mt-2" onClick={() => void overview.refetch()}>Try again</button></div>}
      {site && o && device && (
        <>
          {(() => {
            // The figures as one row of columns with thin dividers (as Ahrefs lays its rank tracker out), each with its
            // trend in orange: one point per saved check day on the first device. A day without a figure is left out.
            // Every figure is a link to its rows (band, movement, map pack), its order (average position) or its history.
            const days = history.data?.days ?? [], hLast = days.length ? days[days.length - 1] : null;
            const trend = (pick: (d: HistoryDay) => number | null | undefined) => days.flatMap((d) => { const v = pick(d); return v == null ? [] : [{ label: fmtDate(d.date), value: v }]; });
            const col = "min-w-0 border-[color:var(--g-divider)] px-1 sm:px-3 xl:[&:not(:first-child)]:border-l";
            const col2 = "min-w-0 border-[color:var(--g-divider)] px-1 sm:px-3 md:[&:not(:first-child)]:border-l";
            const gsc = to({ panel: "gsc" });
            return (
              <section className="mb-5 rounded-xl border p-3 sm:p-5" style={CARD} data-testid="rank-overview">
                <div className="grid grid-cols-2 gap-x-3 gap-y-6 md:grid-cols-3 xl:grid-cols-6">
                  <div className={col}><MetricColumn label="Visibility" testId="tile-visibility" value={hLast ? <Fig href={to({ panel: "history", series: "visibility" })} id="visibility" title="Visibility over time, in the history panel">{hLast.visibility}%</Fig> : "—"}
                    foot={hLast ? <><Fig href={to({ panel: "history", series: "visibility" })} id="visibility-basis" title="Visibility over time, in the history panel (its note says how it is estimated)">Estimated share of clicks from positions, not real clicks · {history.data?.device ?? o.devices[0]}</Fig>, <Fig href={to({ panel: "history", date: hLast.date })} id="visibility-date" title="This check in the history panel">{fmtDate(hLast.date)}</Fig></> : history.isLoading ? "Loading…" : "No saved check to measure"}
                    chart={<GradientSpark range height={48} points={trend((d) => d.visibility)} color={ORANGE} format={(v) => `${v}%`} />} /></div>
                  <div className={col}><MetricColumn label="Average position" testId="tile-average" value={o.summary.averagePosition != null ? <Fig href={to({ sort: "position" })} id="average" title="The keywords ordered by position, best first">{o.summary.averagePosition}</Fig> : "—"} foot={<Fig href={to({ sort: "position" })} id="average-basis" title="The keywords ordered by position, best first">{o.devices[0]}, ranked keywords only</Fig>}
                    chart={<PositionSpark range height={48} points={trend((d) => d.averagePosition)} />} /></div>
                  <div className={col}><MetricColumn label="In the top 10" testId="tile-top10" value={<Fig href={to({ band: "top10" })} id="top10" title="The keywords in the top 10">{fmtNum(o.summary.top10)}</Fig>} foot={<Fig href={to({ band: "top3" })} id="top3" title="The keywords in the top 3">{fmtNum(o.summary.top3)} in the top 3</Fig>}
                    chart={<GradientSpark range height={48} points={trend((d) => d.top3 + d.top10)} color={ORANGE} />} /></div>
                  <div className={col}><MetricColumn label="Since last check" testId="tile-movement" value={<><Fig href={to({ move: "up" })} id="moved-up" title="The keywords that went up since the check before (newly found ones included)" className={`${LINK} g-move g-move--up text-[22px]`}>▲{o.summary.improved}</Fig> <Fig href={to({ move: "down" })} id="moved-down" title="The keywords that went down since the check before (ones no longer found included)" className={`${LINK} g-move g-move--down text-[22px]`}>▼{o.summary.declined}</Fig></>} foot={<><Fig href={to({ move: "up" })} id="moved-up-foot" title="The keywords that went up">Keywords up</Fig> / <Fig href={to({ move: "down" })} id="moved-down-foot" title="The keywords that went down">down</Fig></>} /></div>
                  {(o.summary.withMapPack ?? 0) > 0 && <div className={col}><MetricColumn label="In the Google map pack" testId="tile-map-pack" value={<Fig href={to({ mapPack: true })} id="map-pack" title="The keywords whose results show a map pack, the ones you were found in first">{fmtNum(o.summary.inMapPack ?? 0)}</Fig>} foot={<Fig href={to({ mapPack: true })} id="map-pack-shown" title="The keywords whose results show a map pack">of {fmtNum(o.summary.withMapPack)} searches that show a map</Fig>}
                    chart={<GradientSpark range height={48} points={trend((d) => d.mapPack)} color={ORANGE} />} /></div>}
                  <div className={col}><MetricColumn label="Tracked keywords" testId="tile-tracked" value={<Fig href={to({ panel: "keywords" })} id="tracked" title="All the tracked keywords">{fmtNum(o.summary.tracked)}</Fig>} foot={o.summary.lastCheckedOn ? <Fig href={to({ panel: "history", date: utcDay(o.summary.lastCheckedOn) })} id="last-checked" title="This check in the history panel">Last checked {fmtDate(o.summary.lastCheckedOn)}</Fig> : <Fig href={to({ panel: "history" })} id="last-checked" title="The history of checks">Not checked yet</Fig>}>
                    {o.summary.checked > 0 && <div className="mt-1.5"><LinkedDistributionBar testId="distribution" parts={[
                      { label: "Top 3", value: o.summary.top3, color: PALETTE.top3, href: to({ band: "top3" }), testId: "link-dist-top3" },
                      { label: "4–10", value: Math.max(0, o.summary.top10 - o.summary.top3), color: PALETTE.top10, href: to({ positions: "4-10" }), testId: "link-dist-4-10" },
                      { label: "Below 10 or not found", value: Math.max(0, o.summary.checked - o.summary.top10), color: PALETTE.rest, href: to({ band: "rest" }), testId: "link-dist-rest" },
                    ]} /></div>}
                  </MetricColumn></div>
                </div>
                <div className="mt-5 grid grid-cols-2 gap-x-3 gap-y-6 border-t pt-4 md:grid-cols-4" style={{ borderColor: "var(--g-divider)" }}>
                  {o.searchConsole ? (
                    <>
                      <div className={col2}><MetricColumn label={o.searchConsole.through ? `Search Console clicks (28 days to ${fmtDate(o.searchConsole.through)})` : "Search Console clicks (28 days)"} testId="tile-gsc-clicks" value={<Fig href={gsc} id="gsc-clicks" title="Google's own clicks by page and by search">{fmtNum(o.searchConsole.clicks)}</Fig>} foot={<Fig href={gsc} id="gsc-before" title="Google's own clicks by page and by search, the 28 days before included">{gscHint(o.searchConsole)}</Fig>} /></div>
                      <div className={col2}><MetricColumn label="Impressions (28 days)" testId="tile-gsc-impressions" value={<Fig href={gsc} id="gsc-impressions" title="Google's own numbers by page and by search">{fmtNum(o.searchConsole.impressions)}</Fig>} foot={<Fig href={gsc} id="gsc-position" title="Google's average position by page and by search">{o.searchConsole.position != null ? `Average position ${o.searchConsole.position}` : o.searchConsole.property}</Fig>} /></div>
                    </>
                  ) : (
                    <div className={col2}><MetricColumn label="Search Console" testId="tile-gsc-missing" value={<Fig href={seoLinks.searchConsole()} id="gsc-connect" title="Connect the Search Console property">—</Fig>} foot={<Fig href={seoLinks.searchConsole()} id="gsc-connect-foot" title="Connect the Search Console property">Connect the property for clicks and impressions</Fig>} /></div>
                  )}
                  <div className={col2}><MetricColumn label="Next automatic check" testId="tile-next-check" value={<Fig href={seoLinks.usage()} id="next-check" title="Usage and credit: what the checks use">{configured ? fmtDate(o.nextCheck.nextAt) : "—"}</Fig>} foot={<Fig href={seoLinks.usage()} id="next-check-serps" title="Usage and credit: what a check uses">{configured ? `${fmtNum(o.nextCheck.serps)} result page${o.nextCheck.serps === 1 ? "" : "s"} per check` : "Being switched on"}</Fig>} /></div>
                  {status.data && <div className={col2}><MetricColumn label="Keywords in your plan" testId="tile-plan-keywords" value={<Fig href={seoLinks.usage()} id="plan-keywords" title="Usage and credit">{fmtUnit(status.data.usage.keywords)}</Fig>} foot={<Fig href={seoLinks.dashboardSites()} id="plan-keywords-sites" title="All your sites on the dashboard">Across all your sites</Fig>} /></div>}
                </div>
              </section>
            );
          })()}
          <RankHistoryPanel site={site} />
          <RankTagsPanel site={site} />
          <CompetingPages site={site} />
          <SerpGroupsPanel site={site} />
          {o?.searchConsole ? <GscBreakdownView site={site} /> : (params.gsc || params.gscSort || params.gscAll) && (
            // The address asks for the Search Console breakdown, but this site has no property connected, so the panel isn't
            // drawn: the chip still answers it — honestly — with a way to connect and a Clear (round 3, the live crawl).
            <p className="g-text-2 mb-5 flex flex-wrap items-center gap-2 text-[13px]" data-testid="gsc-not-connected">
              <span className="g-chip !min-h-8 flex-wrap gap-x-2 text-[13px] font-normal max-sm:!min-h-11" style={{ textTransform: "none" }} role="status" data-testid="active-filter">
                <span>Search Console breakdown{[params.gsc === "query" ? "by search" : params.gsc === "page" ? "by page" : null, params.gscSort === "gain" ? "biggest gain first" : params.gscSort === "loss" ? "biggest fall first" : params.gscSort === "clicks" ? "most clicks first" : null, params.gscAll ? "every row" : null].filter(Boolean).map((w) => ` · ${w}`).join("")}: {site.domain}'s Search Console property isn't connected, so there is no breakdown to show.</span>
                <Link href={seoLinks.searchConsole()} className={`${LINK} font-medium`} title="Connect the Search Console property (Settings)" data-testid="link-gsc-connect-chip">Connect it</Link>
                <Link href={hrefWith({ gsc: null, gscSort: null, gscAll: null })} className={`${LINK} font-medium`} title="Drop the Search Console breakdown from the address" data-testid="link-clear-gsc">Clear</Link>
              </span>
            </p>
          )}
          <CompetitorPanel key={site.id} site={site} />
          <AddKeywords site={site} onAdded={invalidate} />
          {o.rows.some((r) => r.searchVolume == null) && (
            <p className="g-text-2 mb-4 flex flex-wrap items-center gap-2 text-[13px]" data-testid="volumes-missing">
              <span><Link href={to({ ...onDevice, noVolume: true })} className={LINK} title="These keywords, in the table below (the button beside this looks their volumes up)" data-testid="link-no-volume">{fmtNum(o.rows.filter((r) => r.searchVolume == null).length)} of your keywords</Link> have no monthly search volume yet.</span>
              <button type="button" className="g-pill g-pill--sm max-sm:!min-h-11" disabled={volumes.isPending || !configured} onClick={() => volumes.mutate()} data-testid="button-get-volumes">{volumes.isPending ? <Loader2 className="animate-spin" /> : null} Get search volumes{status.data?.prices?.searchVolumes ? ` · about ${money(status.data.prices.searchVolumes)}` : ""}</button>
            </p>
          )}
          <TrackingSettings site={site} onSaved={invalidate} perMonthCents={o?.nextCheck.perMonthCents} includedCents={status.data?.credits?.includedCents ?? null} />
          {/* The table's heading, and the chip that says how the address narrowed it — the place a figure's link lands.
              It is there with no keywords too: an address that narrows is always answered with its words. */}
          <div className="mb-2 flex scroll-mt-16 flex-wrap items-center gap-2" data-testid="rank-filter">
            <SectionTitle>Tracked keywords <span className="g-text-2 font-normal">· {params.narrowed ? <><Fig href={to({ ...scope, ...(params.keyword ? { keyword: params.keyword } : {}) })} id="table-shown" title="The keywords shown, as narrowed">{fmtNum(rows.length)}</Fig> of <Fig href={to(onDevice)} id="table-all" title="All the tracked keywords">{fmtNum(o.rows.length)}</Fig></> : <Fig href={to({ ...onDevice, panel: "keywords" })} id="table-all" title="All the tracked keywords">{fmtNum(o.rows.length)}</Fig>}</span></SectionTitle>
            {(params.narrowed || params.device) && (
              <span className="g-chip !min-h-8 flex-wrap gap-x-2 text-[13px] font-normal" role="status" data-testid="active-filter">
                <span>{narrowingWords(params, o.devices.length > 1 || params.device ? device : null, featureWords, params.device && !o.devices.includes(params.device) ? params.device : null)}</span>
                <Link href={to()} className={`${LINK} font-medium`} title="Show all the keywords" data-testid="link-clear-filter">Clear</Link>
              </span>
            )}
          </div>
          {o.rows.length === 0 ? (
            <Empty testId="seo-empty-keywords"><h3>No keywords tracked for {site.domain}</h3><p>Paste keywords above, or <Link href={seoLinks.keywords("")} className={LINK} data-testid="link-research-keywords">research keywords</Link> and track the ones with volume.</p></Empty>
          ) : (
            <>
            {(() => {
              const firsts = rows.map((r) => r.positions[device]).filter((p): p is NonNullable<typeof p> => !!p);
              if (!firsts.length) return null;
              const maps = firsts.filter(showsMapPack);
              const count = (t: string) => firsts.filter((p) => hasFeature(p.features, t)).length;
              // "You are in it" is known only for checks made since it is looked at; older checks are counted apart, not as "no".
              const looked = (t: string) => firsts.filter((p) => hasFeature(p.features, t) && hasFeature(p.features, "own:checked"));
              const known = (t: string, verb: string) => {
                const l = looked(t), older = count(t) - l.length, yes = l.filter((p) => ownsFeature(p.features, t)).length;
                if (!l.length) return `whether ${verb} is not known for ${older === 1 ? "this older check" : "these older checks"}`;
                return `${verb} on ${yes}${older ? ` of the ${l.length} checked for it; not known for ${older} older check${older === 1 ? "" : "s"}` : ""}`;
              };
              // Each count is made over the rows shown, so its link carries the current narrowing and adds the feature (audit §3.2).
              const n = (t: string, value: number, id: string, title: string) => <Fig href={to({ ...scope, feature: withFeature(scope.feature, t) })} id={id} title={title}>{value}</Fig>;
              const parts: ReactNode[] = [
                maps.length ? <>a map pack on {n("local_pack", maps.length, "features-map", "These keywords whose results show a map pack")} (you were found in <Fig href={to({ ...scope, mapPack: true })} id="features-map-own" title="These keywords whose results show a map pack, the ones you were found in first">{maps.filter((p) => p.local != null).length}</Fig>)</> : null,
                count("ai_overview") ? <>an AI overview on {n("ai_overview", count("ai_overview"), "features-ai", "These keywords whose results show an AI overview")} ({known("ai_overview", "it cites you")})</> : null,
                count("featured_snippet") ? <>a featured snippet on {n("featured_snippet", count("featured_snippet"), "features-snippet", "These keywords whose results show a featured snippet")} ({known("featured_snippet", "it is yours")})</> : null,
                count("people_also_ask") ? <>"people also ask" on {n("people_also_ask", count("people_also_ask"), "features-questions", "These keywords whose results show \"people also ask\" questions")}</> : null,
              ].filter(Boolean);
              return parts.length ? <p className="g-text-2 mb-2 text-[13px]" data-testid="text-serp-features">In the newest saved check of each of {params.narrowed ? "these" : "your"} <Fig href={to({ ...scope, checked: true })} id="features-checked" title="These keywords with a saved check">{firsts.length} keyword{firsts.length === 1 ? "" : "s"}</Fig> on {device}, the results showed {parts.map((p, i) => <Fragment key={i}>{i ? ", " : ""}{p}</Fragment>)}.</p> : null;
            })()}
            {wanted && !rows.some(isWanted) && o.rows.some(isWanted) && <p className="g-text-2 mb-2 text-[13px]" data-testid="text-keyword-outside">“{params.keyword}” is not among these keywords. <Link href={to({ ...onDevice, keyword: params.keyword! })} className={LINK} data-testid="link-keyword-alone">Show it on its own</Link></p>}
            {rows.length === 0 ? (
              <p className="g-text-2 mb-4 text-[13px]" data-testid="rank-filter-empty">None of these keywords matches on {device}. <Link href={to()} className={LINK} data-testid="link-filter-show-all">Show all {fmtNum(o.rows.length)} tracked keywords</Link></p>
            ) : (
            <div className="overflow-x-auto">
            <table className={TABLE} data-testid="table-positions">
              <thead><tr><th>Keyword</th>{o.devices.map((d) => <th key={d} className="num">{d === "desktop" ? "Desktop" : "Mobile"}</th>)}<th className="num" title="Your place among the businesses in the map pack of the saved check, matched by your website or business name">Map pack</th><th title="What else the saved results showed for this search; a green chip means you were found in it">On the page</th><th className="num">Volume</th><th>Ranking page</th><th className="num">Checked</th><th aria-label="Remove" /></tr></thead>
              <tbody>
                {rows.map((r) => {
                  const first = r.positions[device], page = first?.url ? pageParts(first.url) : null, hit = isWanted(r);
                  const toggle = () => setOpenKw(openKw === r.id ? null : r.id);
                  const history = (date: string) => to({ ...onDevice, keyword: r.keyword, panel: "history", date });
                  return (
                    <Fragment key={r.id}>
                    <tr data-testid={`row-keyword-${r.id}`} className="scroll-mt-16" style={hit ? { background: "var(--g-accent-soft)" } : undefined} data-highlighted={hit || undefined}>
                      <td><Link href={seoLinks.keywords(r.keyword)} className={LINK} title="Open in the keywords explorer" data-testid={`link-keyword-${r.id}`}>{r.keyword}</Link>{r.location && r.location !== countryLabel(site.locationCode) && <span className="g-text-2 text-[12px]"> · <Link href={to({ ...onDevice, location: r.location })} className={LINK} title={`The keywords checked from ${r.location}`} data-testid={`link-row-location-${r.id}`}>{r.location}</Link></span>}{r.tags.map((t) => <span key={t} className="g-text-2 text-[12px]"> · <Link href={to({ ...onDevice, tag: t })} className={LINK} title={`The keywords tagged “${t}”`} data-testid={`link-row-tag-${r.id}-${slug(t)}`}>{t}</Link></span>)}</td>
                      {o.devices.map((d) => { const p = r.positions[d], m = moveOf(p); return <td key={d} className="num" data-label={d === "desktop" ? "Desktop" : "Mobile"}>{p ? <><button type="button" className={`g-link ${TAP}`} aria-expanded={openKw === r.id} onClick={toggle} title="Show this keyword's history" data-testid={d === o.devices[0] ? `button-history-${r.id}` : `button-history-${r.id}-${d}`}><PositionBadge position={p.position} depth={site.serpDepth} /></button> {/* The movement beside it is a link to every keyword that moved the same way on that device. */}{m ? <Fig href={to({ ...(d === device ? onDevice : { device: d }), move: m })} id={d === o.devices[0] ? `move-${r.id}` : `move-${r.id}-${d}`} title={`The keywords ${MOVED[m]} since the check before, on ${d}`}><Move now={p.position} before={p.previous} hadBefore={!!p.previousOn} /></Fig> : <Move now={p.position} before={p.previous} hadBefore={!!p.previousOn} />}</> : <span className="g-text-2">—</span>}</td>; })}
                      <td className="num" data-label="Map pack">{!first ? <span className="g-text-2">—</span> : first.local != null ? <><Fig href={to({ ...onDevice, mapPack: true })} id={`map-${r.id}`} title="The keywords whose results show a map pack, the ones you were found in first">#{first.local}</Fig> <Move now={first.local} before={first.previousLocal ?? null} hadBefore={!!first.previousOn} /></> : (first.pack?.length ?? 0) > 0 ? <Fig href={to({ ...onDevice, mapPack: true })} id={`map-${r.id}`} title={`Not found in the map pack, matched by website or business name. In it: ${first.pack!.map((p) => p.title).join(", ")} · the keywords whose results show a map pack`}>not found in it{first.previousLocal != null && <> <span className="g-move g-move--down" aria-label={`No longer found in the map pack — was ${first.previousLocal} in the last check`}>lost</span></>}</Fig> : <Fig href={to({ ...onDevice, noMap: true })} id={`no-map-${r.id}`} title="No map pack in the saved results for this search · the keywords whose results show no map pack" className={`${LINK} g-text-2`}>no map</Fig>}</td>
                      <td data-label="On the page">{first ? <SerpFeatureChips features={showsMapPack(first) ? [...new Set([...(first.features ?? []), "local_pack"])] : first.features} mapOwned={first.local != null} href={(t) => to({ ...onDevice, feature: t })} /> : <span className="g-text-2">—</span>}</td>
                      <td className="num" data-label="Volume">{r.searchVolume != null ? <Link href={seoLinks.keywords(r.keyword)} className={LINK} title="This keyword in the keywords explorer" data-testid={`link-volume-${r.id}`}>{fmtNum(r.searchVolume)}</Link> : <Link href={to({ ...onDevice, noVolume: true })} className={`${LINK} g-text-2`} title="No volume saved yet — the keywords with no volume, in this table (the button above it looks volumes up)" data-testid={`link-volume-${r.id}`}>—</Link>}</td>
                      <td data-label="Page" className="max-w-[280px] truncate">{first?.url && page ? <Link href={seoLinks.explorer(page.domain, "pages", { path: page.path })} className={LINK_BLOCK} title={`${first.url} — this page in Site explorer`} data-testid={`link-page-${r.id}`}>{first.url.replace(/^https?:\/\/(www\.)?/, "")}</Link> : <span className="g-text-2">—</span>}</td>
                      <td className="num g-text-2" data-label="Checked">{first ? <button type="button" className={`g-link ${TAP}`} aria-expanded={openKw === r.id} onClick={toggle} title="Show this keyword's history" data-testid={`button-checked-${r.id}`}>{fmtDate(first.checkedOn)}</button> : "—"}</td>
                      <td className="num"><button type="button" className="g-pill g-pill--danger !min-h-8 !px-2 max-sm:!min-h-11" onClick={() => remove.mutate(r.id)} aria-label={`Remove ${r.keyword}`} data-testid={`button-remove-${r.id}`}><Trash2 /></button></td>
                    </tr>
                    {openKw === r.id && <tr data-testid={`row-history-${r.id}`}><td colSpan={o.devices.length + 6}>{(first?.pack?.length ?? 0) > 0 && <p className="g-text-2 mb-2 text-[13px]" data-testid={`pack-${r.id}`}>The map pack in the saved results for this search (<Link href={history(first!.checkedOn)} className={LINK} title="This check in the history panel" data-testid={`link-pack-date-${r.id}`}>{fmtDate(first!.checkedOn)}</Link>): {first!.pack!.map((p, i) => <Fragment key={`${p.position}-${p.title}`}>{i ? " · " : ""}{p.domain ? <Link href={seoLinks.explorer(p.domain)} className={LINK} title={`${p.domain} in Site explorer`} data-testid={`link-pack-${r.id}-${p.position}`}>{p.position}. {p.title}</Link> : <Link href={to({ ...onDevice, mapPack: true })} className={LINK} title="No website on Google's listing · the keywords whose results show a map pack" data-testid={`link-pack-${r.id}-${p.position}`}>{p.position}. {p.title}</Link>}</Fragment>)}</p>}<KeywordHistory id={r.id} devices={o.devices} href={history} />{(first?.top?.length ?? 0) > 0 && (
                      <div className="mt-3" data-testid={`serp-${r.id}`}>
                        <h4 className="mb-1 text-[13px] font-medium" style={{ color: "var(--g-blue)" }}>Google's first page for this search, as saved <span className="g-text-2 font-normal">· <Link href={history(first!.checkedOn)} className={LINK} title="This check in the history panel" data-testid={`link-serp-date-${r.id}`}>{fmtDate(first!.checkedOn)}</Link></span></h4>
                        <ol className="space-y-0.5 text-[13px]">{first!.top!.map((t) => { const mine = t.domain === site.domain || t.domain.endsWith(`.${site.domain}`); return <li key={`${t.position}-${t.domain}`} className={mine ? "g-text font-medium" : "g-text-2"}><Link href={seoLinks.explorer(t.domain)} className={LINK} title={`${t.url ?? t.domain} — in Site explorer`} data-testid={`link-serp-${r.id}-${t.position}`}><span className="inline-block w-6 tabular-nums">{t.position}.</span> {t.domain}</Link>{mine ? " · you" : ""}{t.title ? (() => { const at = t.url ? pageParts(t.url) : null; return <span className="g-text-2 font-normal"> — {at ? <Link href={seoLinks.explorer(at.domain, "pages", { path: at.path })} className={LINK} title={`${t.url} — this page in Site explorer`} data-testid={`link-serp-title-${r.id}-${t.position}`}>{t.title}</Link> : t.title}</span>; })() : null}</li>; })}</ol>
                      </div>
                    )}</td></tr>}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
            </div>
            )}
            </>
          )}
          {o.runs.length > 0 && (
            <section className="mt-6">
              <SectionTitle className="mb-2">Recent checks</SectionTitle>
              {/* Each check opens its day in the history panel (the numbers of that check); the error, if any, is said beside it. */}
              <ul className="g-text-2 space-y-1 text-[13px]" data-testid="list-runs">
                {o.runs.map((r) => <li key={r.id}><Link href={to({ panel: "history", date: utcDay(r.created_at) })} className={LINK} title="This check in the history panel" data-testid={`link-recent-check-${r.id}`}>{fmtDate(r.created_at)} · {RUN_TRIGGER[r.trigger] ?? r.trigger} · {r.status === "done" && r.partial ? "done, but not every check came back" : RUN_STATUS[r.status] ?? r.status}{r.total ? ` · ${r.checked}/${r.total} checks` : ""}</Link>{r.error ? <span className="g-closed"> · {r.error}</span> : null}</li>)}
              </ul>
            </section>
          )}
        </>
      )}
    </SeoShell>
  );
}

function AddKeywords({ site, onAdded }: { site: SeoSite; onAdded: () => void }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [tag, setTag] = useState("");
  const [place, setPlace] = useState<Place | null>(null);
  // Text in the place box that was never chosen from the list, and the message about it once "Track these" was tried.
  const [typed, setTyped] = useState("");
  const [placeError, setPlaceError] = useState<string | null>(null);
  // What a keyword is checked from when no place is picked: the site's own country (the same list the explorers use).
  const country = countryLabel(site.locationCode);
  const defaultLabel = country ? `the site's default (${country})` : "the site's own default location";
  const m = useMutation({
    mutationFn: () => api("POST", `/api/seo/sites/${site.id}/keywords`, { keywords: text.split(/\n|,/).map((s) => s.trim()).filter(Boolean).slice(0, 500), tags: tag.trim() ? [tag.trim()] : [], ...(place ? { locationCode: place.code } : {}) }),
    onSuccess: (r: { added: number }) => { setText(""); setTag(""); setPlace(null); setTyped(""); setOpen(false); onAdded(); toast({ title: `${r.added} keyword${r.added === 1 ? "" : "s"} added` }); },
    onError: (e) => toast({ title: "Couldn't add keywords", description: apiErrorMessage(e), variant: "destructive" }),
  });
  if (!open) return <div className="mb-4"><button type="button" className="g-pill" onClick={() => setOpen(true)} data-testid="button-add-keywords"><Plus /> Add keywords</button></div>;
  // Typed but never chosen is not "no place": the form stops here and says so (by mouse, keyboard or any other control).
  const submit = () => {
    const problem = place ? null : unresolvedPlaceMessage(typed, defaultLabel);
    if (problem) { setPlaceError(problem); return; }
    m.mutate();
  };
  return (
    <form className="g-callout mb-4" onSubmit={(e) => { e.preventDefault(); submit(); }} data-testid="form-add-keywords">
      <h3>Keywords to track for {site.domain}</h3>
      <p>One per line (or comma-separated). Each is checked on {site.devices === "both" ? "desktop and mobile" : site.devices} every week.</p>
      <textarea aria-label={`Keywords to track for ${site.domain}, one per line`} className="g-input mt-2 min-h-[120px] py-2" value={text} onChange={(e) => setText(e.target.value)} placeholder={"roofing contractor tampa\nroof repair near me"} data-testid="textarea-keywords" />
      <div className="mt-2 text-[13px]"><div className="g-text-2 mb-1">Where to check from (optional) — pick a city or ZIP code{country && country !== "United States" ? " (the list has United States places)" : ""} to see what customers there see, including the map</div>
        <div className="sm:max-w-sm"><LocationPicker value={place} onChange={(p) => { setPlace(p); setPlaceError(null); }} onTyped={(t) => { setTyped(t); setPlaceError(null); }} error={placeError} defaultLabel={defaultLabel} /></div>
      </div>
      <label className="mt-2 block text-[13px]"><span className="g-text-2">Tag (optional) — group these keywords, e.g. a service or a city</span>
        <input className="g-input mt-1" value={tag} maxLength={40} onChange={(e) => setTag(e.target.value)} placeholder="roofing" data-testid="input-keyword-tag" />
      </label>
      <div className="mt-2 flex gap-2">
        <Button type="submit" disabled={m.isPending || !text.trim()} data-testid="button-save-keywords">{m.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Track these"}</Button>
        <button type="button" className="g-pill" onClick={() => setOpen(false)}>Cancel</button>
      </div>
    </form>
  );
}

/** Per-site settings: the name on the Google Business Profile (to find the business in the map pack) and alerts. */
const FREQUENCY = { weekly: "Every week", twice_weekly: "Twice a week", daily: "Every day" } as const;
type Frequency = keyof typeof FREQUENCY;
function TrackingSettings({ site, onSaved, perMonthCents, includedCents }: { site: SeoSite; onSaved: () => void; /** A month of automatic checks at each frequency, at today's keywords. */ perMonthCents?: Record<Frequency, number>; includedCents: number | null }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [name, setName] = useState(site.businessName ?? "");
  const [alerts, setAlerts] = useState(site.alertsEnabled !== false);
  const [drop, setDrop] = useState(site.alertDrop ?? 3);
  const [freq, setFreq] = useState<Frequency>(site.rankFrequency ?? "weekly");
  useEffect(() => { setName(site.businessName ?? ""); setAlerts(site.alertsEnabled !== false); setDrop(site.alertDrop ?? 3); setFreq(site.rankFrequency ?? "weekly"); }, [site.id, site.businessName, site.alertsEnabled, site.alertDrop, site.rankFrequency]);
  const m = useMutation({
    mutationFn: () => api("POST", `/api/seo/sites/${site.id}/settings`, { businessName: name.trim() || null, alertsEnabled: alerts, alertDrop: drop, rankFrequency: freq }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["/api/seo/sites"] }); onSaved(); toast({ title: "Tracking settings saved" }); },
    onError: (e) => toast({ title: "Couldn't save the settings", description: apiErrorMessage(e), variant: "destructive" }),
  });
  return (
    <details className="mb-4 text-[13px]" data-testid="tracking-settings">
      <summary className="g-link cursor-pointer">Tracking settings{!site.businessName ? " — add your business name to track the Google map pack" : ""}</summary>
      <form className="g-callout mt-2" onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
        <label className="block"><span className="g-text-2">Business name, exactly as on your Google Business Profile</span>
          <input className="g-input mt-1 sm:max-w-sm" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} placeholder="Alpine Exteriors" data-testid="input-business-name" />
        </label>
        <p className="g-text-2 mt-1 text-[12px]">Businesses on Google's map often show no website, so we find yours by its name as well as by {site.domain}.</p>
        <label className="mt-3 flex items-center gap-2"><input type="checkbox" checked={alerts} onChange={(e) => setAlerts(e.target.checked)} data-testid="checkbox-alerts" /> <span className="g-text">Alert me when rankings or links change</span></label>
        <label className="mt-2 flex flex-wrap items-center gap-2"><span className="g-text-2">A ranking counts as moved when it changes by at least</span>
          <select className="g-select" value={drop} onChange={(e) => setDrop(Number(e.target.value))} disabled={!alerts} data-testid="select-alert-drop">{[1, 2, 3, 5, 10].map((n) => <option key={n} value={n}>{n} position{n === 1 ? "" : "s"}</option>)}</select>
        </label>
        <label className="mt-3 flex flex-wrap items-center gap-2"><span className="g-text-2">Check rankings automatically</span>
          <select className="g-select" value={freq} onChange={(e) => setFreq(e.target.value as Frequency)} data-testid="select-rank-frequency">
            {(Object.keys(FREQUENCY) as Frequency[]).map((f) => <option key={f} value={f}>{FREQUENCY[f]}{perMonthCents ? ` — about ${money(perMonthCents[f])} a month` : ""}</option>)}
          </select>
        </label>
        <p className="g-text-2 mt-1 text-[12px]" data-testid="text-rank-frequency-note">
          {perMonthCents ? `At your ${fmtNum(site.keywordCount)} tracked keyword${site.keywordCount === 1 ? "" : "s"}, a month of checks ${FREQUENCY[freq].toLowerCase()} uses about ${money(perMonthCents[freq])} of SEO data` : "The cost of a month of checks shows here once keywords are tracked"}{includedCents != null && perMonthCents ? ` — your plan includes ${money(includedCents)} a month` : ""}. Automatic checks only use your included data; when it runs out they wait, and are never charged to credit you bought. A site already checked on a day (UTC) is not checked again automatically that day; "Run check now" always runs.
        </p>
        <div className="mt-3"><Button type="submit" disabled={m.isPending} aria-busy={m.isPending} data-testid="button-save-settings">{m.isPending ? <><Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden /> Saving settings…</> : "Save settings"}</Button></div>
      </form>
    </details>
  );
}
