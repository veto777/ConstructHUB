/**
 * /seo/local-grid — Local grid: where the business shows up in Google's local
 * results for one search, searched from a square of points over its service area.
 * Pick the business on the map once, then scan a keyword; each scan is kept so the next can be
 * compared with it. Every lookup shows its price first (server/seo/grid.ts).
 *
 * The scan on screen, the point picked in it and the points a figure counts live in the address (links.ts:
 * ?site= ?scan= ?cell= ?show=), so a link from a report or an alert lands on exactly that view, a scan opened here is
 * the same address, and the back button undoes it. Arriving by link opens saved scans only — it never runs one.
 */
import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiErrorMessage } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { ActiveFilter, api, clearParams, Empty, fmtDate, fmtNum, money, SeoShell, useAddress, useSelectedSite, useSeoSites, useSeoStatus, useSiteMissing } from "./shell";
import { seoLinks, setParam } from "./links";
import { DeltaBadge } from "./viz";
import { CARD, FIGURE_LINK, Heading, LinkedFigure, MetricRow, MiniBar, QUIET_LINK, RatioBar, TEXT_LINK } from "./viz-more";

type Pin = { name: string; address: string | null; lat: number; lng: number; cid: string | null; domain?: string | null };
type Listing = { name: string; rank: number; cid: string | null; domain: string | null; address: string | null; lat: number | null; lng: number | null; rating: number | null; reviews: number | null };
type Point = { row: number; col: number; lat: number; lng: number; rank: number | null; failed?: true; by?: "id" | "website" | "name"; top: { name: string; rank: number }[] };
type Rival = { name: string; ours: boolean; domain: string | null; cid?: string | null; rating: number | null; reviews: number | null; top3: number; found: number; avgRank: number };
type Summary = { points: number; checked: number; found: number; top3: number; avgRank: number | null; unsure?: number };
type Center = { lat: number; lng: number; name: string; cid?: string | null };
type Scan = { id?: number; keyword: string; size: number; spacing: number; center: Center; points: Point[]; rivals: Rival[]; summary: Summary; fetchedAt: string };
type ScanRow = { id: number; keyword: string; size: number; spacing: number; status: "done" | "failed"; error: string | null; center: Center | null; avgRank: number | null; points: number; checked: number; found: number; top3: number; at: string };
type State = { id: number; status: "running" | "done" | "failed"; scan: Scan | null; error: string | null };
type Watch = { id: number; keyword: string; size: number; spacing: number; every: "weekly" | "monthly"; nextAt: string };
type Data = { pin: Pin | null; scans: ScanRow[]; watches?: Watch[]; maxWatches?: number; running: { id: number; keyword: string; size: number; spacing: number; at: string } | null; sizes: number[]; spacings: number[]; depth: number; suggestion: string };
type Show = "top3" | "found" | "checked" | "failed";

const miles = (n: number) => `${n} mile${n === 1 ? "" : "s"}`;
/** The parameters this page owns: dropped when the site changes (they belong to a scan of the site before). */
const OWN_PARAMS = ["scan", "cell", "show"];
const SHOWS: Show[] = ["top3", "found", "checked", "failed"];
/** Colour and words for a position. Every colour carries its number, and the text on it meets normal contrast. */
function tone(p: Point): { bg: string; fg: string; label: string; words: string } {
  if (p.failed) return { bg: "var(--g-divider)", fg: "var(--g-text)", label: "?", words: "the lookup failed, so the position is unknown" };
  if (p.rank === null) return { bg: "#c5221f", fg: "#fff", label: "20+", words: "not in the first 20 local results" };
  if (p.rank <= 3) return { bg: "#188038", fg: "#fff", label: String(p.rank), words: `position ${p.rank}` };
  if (p.rank <= 10) return { bg: "#f9ab00", fg: "#202124", label: String(p.rank), words: `position ${p.rank}` };
  return { bg: "#e8710a", fg: "#202124", label: String(p.rank), words: `position ${p.rank}` };
}
/** "2 miles north, 1 mile west of the business" for a cell. */
function whereIs(p: Point, size: number, spacing: number): string {
  const half = (size - 1) / 2, ns = (half - p.row) * spacing, ew = (p.col - half) * spacing;
  const parts = [ns ? `${miles(Math.abs(ns))} ${ns > 0 ? "north" : "south"}` : "", ew ? `${miles(Math.abs(ew))} ${ew > 0 ? "east" : "west"}` : ""].filter(Boolean);
  return parts.length ? `${parts.join(", ")} of the business` : "at the business";
}
/** Whether a point counts for a figure: in the first 3, found (in the first N), checked at all (the position score averages those), or failed. */
const counts = (p: Point, show: Show) => (show === "top3" ? p.rank !== null && p.rank <= 3 : show === "found" ? p.rank !== null : show === "failed" ? !!p.failed : !p.failed);
const SHOW_WORDS: Record<Show, string> = { top3: "the points where you are in the first 3", found: "the points where you are found", checked: "every point that could be checked — the position score is their average", failed: "the points whose lookup failed" };
/** The same listing in the same place? Only then is one scan comparable with another. */
const sameCenter = (a: Center | null | undefined, b: Center | null | undefined) =>
  !!a && !!b && Math.abs(a.lat - b.lat) < 1e-4 && Math.abs(a.lng - b.lng) < 1e-4 && (a.cid ?? null) === (b.cid ?? null)
  // Without Google's id on either side, the same name in the same place is the least that makes it the same listing.
  && ((a.cid ?? null) !== null || a.name === b.name);

export default function SeoLocalGridPage() {
  const status = useSeoStatus();
  const sites = useSeoSites();
  const [site, onSite] = useSelectedSite(sites.data);
  const missing = useSiteMissing(sites.data);
  const params = useAddress();
  /** The scan on screen, the point picked in it and the points outlined: all from the address. */
  const scanParam = params.get("scan");
  const openId = Number(scanParam) || null;
  const cellParam = params.get("cell");
  const cell = cellParam !== null && /^\d+$/.test(cellParam) ? Number(cellParam) : null;
  const showParam = params.get("show");
  const show: Show | null = SHOWS.includes(showParam as Show) ? (showParam as Show) : null;
  const qc = useQueryClient();
  const { toast } = useToast();
  const key = `/api/seo/sites/${site?.id}/grid`;
  // Asked again every half minute and when the window is looked at again, so a scan started by the schedule or in
  // another tab is noticed without reloading.
  const q = useQuery<Data>({ queryKey: [key], enabled: !!site, refetchInterval: 30_000, refetchOnWindowFocus: true, staleTime: 10_000 });
  const [query, setQuery] = useState("");
  /** What the business search returned, and for which site — a late answer for another site is never offered here. */
  const [found, setFound] = useState<{ siteId: number; listings: Listing[] } | null>(null);
  const [changing, setChanging] = useState(false);
  const [keyword, setKeyword] = useState("");
  const [size, setSize] = useState(5);
  const [spacing, setSpacing] = useState(2);
  /** The scan that is running, watched whatever else is on screen. */
  const [activeId, setActiveId] = useState<number | null>(null);
  /** Open one scan: the address is the view (the point and outline of the scan before are dropped first). */
  const openScan = (id: number) => { clearParams(["cell", "show"]); setParam("scan", id); };
  // Another site is another business: nothing from the last one stays on screen (its scan, point and outline go with it).
  const changeSite = (id: number) => { clearParams(OWN_PARAMS); onSite(id); };
  useEffect(() => { setFound(null); setChanging(false); setActiveId(null); setKeyword(""); setQuery(""); }, [site?.id]);
  useEffect(() => { if (q.data && !query) setQuery(q.data.suggestion); }, [q.data]); // eslint-disable-line react-hooks/exhaustive-deps
  // A scan left running (this page was closed, or it was started elsewhere) is picked up again.
  // Whatever the server says is running is what is watched — also one started in another tab after this page's own had finished.
  useEffect(() => { if (q.data?.running && q.data.running.id !== activeId) setActiveId(q.data.running.id); }, [q.data?.running?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const prices = status.data?.prices as (Record<string, number | undefined> | undefined);
  const holds = status.data?.holds as (Record<string, number | undefined> | undefined);
  const points = size * size;
  const scanPrice = prices?.gridPer100 != null ? Math.ceil((points * prices.gridPer100) / 100) : null;
  const scanHold = holds?.gridPer100 != null ? Math.ceil((points * holds.gridPer100) / 100) : scanPrice;
  const available = status.data?.credits ? status.data.credits.availableCents : -1;
  const can = (cents: number | null | undefined) => cents == null || available === -1 || available >= cents;
  const configured = !!status.data?.configured;

  const locate = useMutation({
    mutationFn: (v: { siteId: number; text: string }) => api("POST", `/api/seo/sites/${v.siteId}/grid/locate`, { query: v.text }),
    onSuccess: (d: { listings: Listing[] }, v) => { void qc.invalidateQueries({ queryKey: ["/api/seo/status"] }); if (v.siteId === site?.id) setFound({ siteId: v.siteId, listings: d.listings }); },
    onError: (e) => toast({ title: "Couldn't search Google Maps", description: apiErrorMessage(e), variant: "destructive" }),
  });
  const pinIt = useMutation({
    mutationFn: (v: { siteId: number; l: Listing }) => api("POST", `/api/seo/sites/${v.siteId}/grid/pin`, { name: v.l.name, address: v.l.address, lat: v.l.lat, lng: v.l.lng, cid: v.l.cid, domain: v.l.domain }),
    onSuccess: (_d: unknown, v) => { void qc.invalidateQueries({ queryKey: [`/api/seo/sites/${v.siteId}/grid`] }); if (v.siteId === site?.id) { setFound(null); setChanging(false); } },
    onError: (e) => toast({ title: "Couldn't save that", description: apiErrorMessage(e), variant: "destructive" }),
  });
  const scan = useMutation({
    mutationFn: (v: { siteId: number; body: { keyword: string; size: number; spacing: number } }) => api("POST", `/api/seo/sites/${v.siteId}/grid/scan`, v.body),
    // The scan runs in the background; this only starts it. The page then asks for it until it is done.
    onSuccess: (d: { id: number; reused?: boolean }, v) => {
      if (v.siteId !== site?.id) return; // the site was changed meanwhile: it will be in that site's history
      setActiveId(d.id); openScan(d.id);
      if (d.reused) toast({ title: "A scan is already running for this site", description: "Showing that one. Start another when it finishes." });
    },
    onError: (e) => toast({ title: "Couldn't run the scan", description: apiErrorMessage(e), variant: "destructive" }),
  });
  // The running scan is watched on its own, so opening an older scan from the history does not stop the watching.
  const active = useQuery<State>({
    queryKey: [`${key}/${activeId}`], enabled: !!site && activeId != null,
    // Keep asking until there is a final answer — also when an attempt failed and there is no answer at all yet.
    refetchInterval: (query) => (!query.state.data || query.state.data.status === "running" ? 3000 : false),
  });
  const opened = useQuery<State>({ queryKey: [`${key}/${openId}`], enabled: !!site && openId != null && openId !== activeId, refetchInterval: (query) => (query.state.data?.status === "running" ? 3000 : false) });
  const view = openId != null && openId === activeId ? active : opened;
  // The watching itself failing is said on its own line, whatever scan happens to be open.
  const watchingFailed = activeId != null && active.isError;
  const isRunning = active.data?.status === "running" || scan.isPending;
  const shown: Scan | null = openId != null && view.data?.status === "done" ? view.data.scan : null;
  // When the running scan ends, the history and what is left of the SEO data are both out of date.
  const ended = active.data && active.data.status !== "running" ? active.data.id : undefined;
  useEffect(() => {
    if (ended == null) return;
    void qc.invalidateQueries({ queryKey: [key] }); void qc.invalidateQueries({ queryKey: ["/api/seo/status"] });
    if (openId !== ended) toast({ title: active.data?.status === "done" ? "The scan has finished" : "The scan didn't finish", description: "It is in the list of scans below." });
    // Nothing is being watched any more; the next running scan (from here or another tab) is picked up from the server.
    setActiveId(null);
  }, [ended]); // eslint-disable-line react-hooks/exhaustive-deps

  const watch = useMutation({
    mutationFn: (v: { siteId: number; body: { keyword: string; size: number; spacing: number; every: "weekly" | "monthly" } }) => api("POST", `/api/seo/sites/${v.siteId}/grid/watch`, v.body),
    onSuccess: (_d: unknown, v) => { void qc.invalidateQueries({ queryKey: [`/api/seo/sites/${v.siteId}/grid`] }); toast({ title: `This scan will repeat every ${v.body.every === "weekly" ? "week" : "month"}`, description: "It uses your month's included SEO data only, and you are alerted when the area clearly changes." }); },
    onError: (e) => toast({ title: "Couldn't set that up", description: apiErrorMessage(e), variant: "destructive" }),
  });
  const unwatch = useMutation({
    mutationFn: (v: { siteId: number; id: number }) => api("DELETE", `/api/seo/sites/${v.siteId}/grid/watch/${v.id}`),
    onSuccess: (_d: unknown, v) => { void qc.invalidateQueries({ queryKey: [`/api/seo/sites/${v.siteId}/grid`] }); },
    onError: (e) => toast({ title: "Couldn't stop that", description: apiErrorMessage(e), variant: "destructive" }),
  });
  const watches = q.data?.watches ?? [];
  const pin = q.data?.pin ?? null;
  const listings = found && found.siteId === site?.id ? found.listings : null;
  // Comparable only with an earlier scan of the same search, the same square, and the same listing in the same place.
  const previous = useMemo(() => {
    if (!shown || !q.data) return null;
    return q.data.scans.find((s) => s.status === "done" && s.id !== shown.id && s.keyword === shown.keyword && s.size === shown.size && s.spacing === shown.spacing && sameCenter(s.center, shown.center) && new Date(s.at) < new Date(shown.fetchedAt)) ?? null;
  }, [shown, q.data]);
  const selected = shown && cell != null ? shown.points[cell] ?? null : null;
  const span = shown ? (shown.size - 1) * shown.spacing : 0;
  const depth = q.data?.depth ?? 20;
  const unsure = shown?.summary.unsure ?? 0;
  /** The newest finished scan of a repeating search (the scan it repeats), by its search, square and spacing. */
  const newestOf = (w: { keyword: string; size: number; spacing: number }) => q.data?.scans.find((s) => s.status === "done" && s.keyword === w.keyword && s.size === w.size && s.spacing === w.spacing) ?? null;
  const outlined = shown && show ? shown.points.filter((p) => counts(p, show)).length : 0;
  const failed = shown ? shown.points.filter((p) => p.failed).length : 0;
  /** This scan's address, with a figure's points outlined. */
  /** The scan is still on its way (opening or running): what the address asks of it waits; a failed or unopenable one has nothing to outline or pick, and the chip's first words say so. */
  const waiting = !shown && openId != null && view.data?.status !== "failed" && !view.isError;
  const here = (p: { show?: Show; cell?: number } = {}) => seoLinks.localGrid(site!.id, { scan: openId ?? undefined, ...p });
  const at = (scan: number, p: { show?: Show } = {}) => seoLinks.localGrid(site!.id, { scan, ...p });
  // What the address narrowed, in words — and what could not be shown: a scan that failed or is still opening has no
  // points to outline or pick, a point number past the grid is no point.
  const chip = scanParam === null ? null : openId == null ? `"${scanParam}" is not a scan number` : [
    shown ? `Scan: "${shown.keyword}" · ${fmtDate(shown.fetchedAt)}` : view.data?.status === "failed" ? `Scan #${openId} — it didn't finish, so there is nothing to outline or pick` : view.isError ? `Scan #${openId} — couldn't be opened` : view.data?.status === "running" ? `Scan #${openId} — still running` : `Scan #${openId} — opening`,
    cellParam !== null && cell == null ? `"${cellParam}" is not a point number (0 to ${shown ? shown.points.length - 1 : "the last point"})` : shown && selected ? `point ${whereIs(selected, shown.size, shown.spacing)}` : shown && cell != null ? `point ${cell} — there is no such point in this scan (its points are 0 to ${shown.points.length - 1})` : !shown && cellParam !== null && waiting ? `point ${cellParam} — waits for the scan` : "",
    shown && show ? `${outlined} of ${shown.summary.points} outlined: ${SHOW_WORDS[show]}${show === "checked" && failed ? ` (${failed} point${failed === 1 ? "" : "s"} failed and ${failed === 1 ? "is" : "are"} not outlined)` : ""}` : !shown && show && waiting ? `${SHOW_WORDS[show]} — waits for the scan` : showParam !== null && !show ? `"${showParam}" is not something to outline (top3, found, checked, failed)` : "",
  ].filter(Boolean).join(" · ");

  return (
    <SeoShell title="Local grid" description="Where your business shows up in Google's local results across your service area — looked up for point after point, for the searches your customers make." site={site} onSite={changeSite} sites={sites} status={status}>
      {missing && site && <p className="mb-3 text-[13px]" role="status" style={{ color: "#b06000" }} data-testid="grid-site-missing">The site this link is for isn't one of yours (or was removed). Showing {site.domain}.</p>}
      {chip && <ActiveFilter onClear={() => clearParams(OWN_PARAMS, false)} clearLabel="Close the scan">{chip}</ActiveFilter>}
      {!site && sites.isSuccess && <Empty testId="grid-empty-sites"><h3>No sites yet</h3><p>Add your site above; then find your business on Google Maps and scan the area around it.</p></Empty>}
      {site && q.isLoading && <p className="g-text-2 flex items-center gap-2 text-[14px]" role="status"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</p>}
      {site && q.isError && <div className="g-callout" role="alert"><h3>Couldn't load the local grid</h3><p>{apiErrorMessage(q.error)}</p><button type="button" className="g-pill mt-2" onClick={() => void q.refetch()}>Try again</button></div>}
      {site && q.data && (
        <>
          {(!pin || changing) ? (
            <section className="mb-5 rounded-xl border p-3 sm:p-4" style={CARD} data-testid="grid-locate">
              <Heading className="!mb-1">{pin ? "Choose a different listing" : "First, find your business on Google Maps"}</Heading>
              <p className="g-text-2 mb-3 text-[13px]">The grid is centred on your Google Business listing, and that listing is what we look for at every point. Search by name and town.{pin ? " Scans made with the listing you have now stay in the history, but are not compared with scans of a different one." : ""}</p>
              <form className="flex flex-col gap-2 sm:flex-row sm:items-center" onSubmit={(e) => { e.preventDefault(); if (query.trim().length >= 2) locate.mutate({ siteId: site.id, text: query.trim() }); }}>
                <label className="min-w-0 flex-1 sm:max-w-xl"><span className="sr-only">Business name and town</span>
                  <input className="g-input w-full" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Alpine Exteriors Bellingham WA" data-testid="input-grid-locate" autoComplete="off" />
                </label>
                <Button type="submit" disabled={locate.isPending || query.trim().length < 2 || !configured || !can(holds?.gridLocate ?? prices?.gridLocate)} data-testid="button-grid-locate">
                  {locate.isPending ? <><Loader2 className="mr-1 h-4 w-4 animate-spin" /> Searching…</> : `Search Google Maps${prices?.gridLocate != null ? ` — about ${money(prices.gridLocate)}` : ""}`}
                </Button>
                {pin && <button type="button" className="g-pill" onClick={() => { setChanging(false); setFound(null); }}>Cancel</button>}
              </form>
              {!can(holds?.gridLocate ?? prices?.gridLocate) && <p className="mt-2 text-[13px]" style={{ color: "var(--g-red)" }}>Not enough SEO data left — <Link href={seoLinks.usage({ credits: "add" })} className={TEXT_LINK}>add credit</Link>.</p>}
              {listings && listings.length === 0 && <p className="g-text-2 mt-3 text-[13px]" role="status" data-testid="grid-locate-none">Google Maps showed no business for that. Try the name exactly as it appears on your listing, with the town.</p>}
              {listings && listings.length > 0 && (
                <ul className="mt-3 space-y-2" data-testid="list-grid-found">
                  {/* A listing's website opens in Site explorer; its stars and reviews are Google's own (no view here holds them). */}
                  {listings.map((l, i) => (
                    <li key={`${l.cid ?? l.name}-${i}`} className="flex flex-wrap items-center gap-2 rounded-lg border p-3" style={{ borderColor: "var(--g-divider)" }}>
                      <MapPin className="g-text-2 h-4 w-4 shrink-0" aria-hidden />
                      <div className="min-w-0 flex-1">
                        <div className="g-text text-[14px] font-medium">{l.domain ? <Link href={seoLinks.explorer(l.domain)} className={FIGURE_LINK} title={`Open ${l.domain} in Site explorer`}>{l.name}</Link> : l.name}</div>
                        <div className="g-text-2 text-[12px]">{[l.address ? <a key="a" href={seoLinks.googleMaps(l)} target="_blank" rel="noreferrer" className={QUIET_LINK} title="This listing on Google Maps">{l.address}</a> : null, l.domain ? <Link key="d" href={seoLinks.explorer(l.domain)} className={QUIET_LINK}>{l.domain}</Link> : null, l.rating != null ? <a key="r" href={seoLinks.googleMaps(l)} target="_blank" rel="noreferrer" className={QUIET_LINK} title="Google's own stars and reviews, on the listing on Google Maps (no view here holds them)">{`${l.rating} stars${l.reviews != null ? ` (${fmtNum(l.reviews)} reviews, on Google)` : " on Google"}`} ↗</a> : null].filter(Boolean).map((x, k, all) => <span key={k}>{x}{k < all.length - 1 ? " · " : ""}</span>)}{!l.address && !l.domain && l.rating == null ? "No address shown" : null}</div>
                      </div>
                      <Button size="sm" className="!min-h-11" disabled={pinIt.isPending} onClick={() => pinIt.mutate({ siteId: found!.siteId, l })} aria-label={`This is my business: ${l.name}${l.address ? `, ${l.address}` : ""}`} data-testid={`button-grid-pin-${i}`}>This is my business</Button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ) : (
            <section className="mb-5" data-testid="grid-run">
              <p className="g-text-2 mb-3 flex flex-wrap items-center gap-2 text-[13px]" data-testid="text-grid-pin">
                <MapPin className="h-4 w-4" aria-hidden /> <span>Centred on <Link href={seoLinks.explorer(pin.domain || site.domain)} className={`${FIGURE_LINK} font-medium`} title={`Open ${pin.domain || site.domain} in Site explorer`} data-testid="link-grid-pin">{pin.name}</Link>{pin.address ? <> — <a href={seoLinks.googleMaps({ cid: pin.cid, name: pin.name, address: pin.address })} target="_blank" rel="noreferrer" className={QUIET_LINK} title="Your listing on Google Maps" data-testid="link-grid-pin-maps">{pin.address}</a></> : ""}</span>
                <button type="button" className="g-link min-h-11" onClick={() => { setChanging(true); setFound(null); }} data-testid="button-grid-change">Change</button>
              </p>
              <form className="flex flex-col gap-2 lg:flex-row lg:items-end" onSubmit={(e) => { e.preventDefault(); if (keyword.trim()) scan.mutate({ siteId: site.id, body: { keyword: keyword.trim(), size, spacing } }); }} data-testid="form-grid">
                <label className="min-w-0 flex-1 text-[12px] lg:max-w-md"><span className="g-text-2">Search to check</span>
                  <input className="g-input mt-1 w-full" value={keyword} onChange={(e) => setKeyword(e.target.value)} placeholder="e.g. siding contractor" data-testid="input-grid-keyword" autoComplete="off" />
                </label>
                <label className="text-[12px]"><span className="g-text-2">Points</span>
                  <select className="g-input g-select mt-1 block !w-auto" value={size} onChange={(e) => setSize(Number(e.target.value))} data-testid="select-grid-size">
                    {q.data.sizes.map((s) => <option key={s} value={s}>{s} × {s} ({s * s} points)</option>)}
                  </select>
                </label>
                <label className="text-[12px]"><span className="g-text-2">Distance between points</span>
                  <select className="g-input g-select mt-1 block !w-auto" value={spacing} onChange={(e) => setSpacing(Number(e.target.value))} data-testid="select-grid-spacing">
                    {q.data.spacings.map((s) => <option key={s} value={s}>{miles(s)}</option>)}
                  </select>
                </label>
                <Button type="submit" disabled={isRunning || !keyword.trim() || !configured || !can(scanHold)} data-testid="button-grid-scan">
                  {isRunning ? <><Loader2 className="mr-1 h-4 w-4 animate-spin" /> Scanning…</> : `Scan${scanPrice != null ? ` — about ${money(scanPrice)}` : ""}`}
                </Button>
              </form>
              <p className="g-text-2 mt-2 text-[13px]" data-testid="text-grid-cost">
                {size} × {size} points, {miles(spacing)} apart, covers a square {miles((size - 1) * spacing)} across. Each point is one lookup of Google's local results made for that spot, as if searching from there{scanPrice != null ? <> — about <Link href={seoLinks.usage()} className={QUIET_LINK}>{money(scanPrice)} of your SEO data</Link> in all</> : ""}; a lookup that fails is not charged (one that works but finds no businesses is).
                {scanHold != null && scanPrice != null && scanHold > scanPrice ? <> Up to <Link href={seoLinks.usage()} className={QUIET_LINK}>{money(scanHold)}</Link> is set aside while it runs; what isn't used comes straight back.</> : ""} A scan is kept in the history below; running it again is a new scan.
                {!can(scanHold) && <span style={{ color: "var(--g-red)" }}> Not enough SEO data left — <Link href={seoLinks.usage({ credits: "add" })} className={TEXT_LINK}>add credit</Link>.</span>}
              </p>
            </section>
          )}

          {active.data?.status === "running" && <p className="g-text mb-4 flex items-center gap-2 text-[14px]" role="status" data-testid="grid-running"><Loader2 className="h-4 w-4 animate-spin" /> Looking up Google's local results for each point — this takes a minute or two. You can leave this page; the scan will be in the list below when it is done.</p>}
          {watchingFailed && <p className="mb-3 text-[13px]" role="alert" style={{ color: "var(--g-red)" }} data-testid="grid-watch-error">Couldn't check on the running scan just now ({apiErrorMessage(active.error)}). Still trying; the scan itself is not affected.</p>}
          {openId != null && !shown && view.isLoading && <p className="g-text-2 flex items-center gap-2 text-[14px]" role="status"><Loader2 className="h-4 w-4 animate-spin" /> Opening the scan…</p>}
          {openId != null && !shown && view.isError && <div className="g-callout" role="alert"><h3>Couldn't open that scan</h3><p>{apiErrorMessage(view.error)}</p><button type="button" className="g-pill mt-2" onClick={() => void view.refetch()}>Try again</button></div>}
          {openId != null && view.data?.status === "failed" && <div className="g-callout mb-4" role="alert" data-testid="grid-failed"><h3>The scan didn't finish</h3><p>{view.data.error}</p></div>}
          {shown && (
            <section className="mb-6" data-testid="grid-result">
              <Heading className="!mb-3 !text-[18px]" meta={<><Link href={here()} className={QUIET_LINK}>{shown.size} × {shown.size}, {miles(shown.spacing)} apart</Link> · <Link href={here()} className={QUIET_LINK}>{fmtDate(shown.fetchedAt)}</Link> · <Link href={seoLinks.explorer(pin?.domain || site.domain)} className={QUIET_LINK}>{shown.center.name}</Link></>}><Link href={here()} className={QUIET_LINK}>"{shown.keyword}"</Link></Heading>
              {/* The scan's figures in one row; the move is against the comparable scan before it (lower position score is better).
                  Each figure outlines the points it counts on the grid below (the address says which); an earlier scan's figure opens that scan the same way. */}
              <div className="mb-4 rounded-xl border p-3 sm:p-4" style={CARD}>
                <MetricRow cols={4} testId="grid-summary">
                  <LinkedFigure href={here({ show: "checked" })} label="Position score" testId="tile-grid-avg" value={shown.summary.avgRank ?? "—"}
                    delta={previous?.avgRank != null && shown.summary.avgRank != null ? <DeltaBadge value={shown.summary.avgRank - previous.avgRank} upIsBad label={`Change since the scan of ${fmtDate(previous.at)}`} /> : null}
                    foot={<>Average over <Link href={here({ show: "checked" })} className={QUIET_LINK}>the {shown.summary.checked} points checked</Link>; "not in the first {depth}" counts as {depth + 1}{previous?.avgRank != null && shown.summary.avgRank != null ? <>. Was <Link href={at(previous.id, { show: "checked" })} className={TEXT_LINK}>{previous.avgRank} over {previous.checked} points on {fmtDate(previous.at)}</Link></> : ""}</>} />
                  <LinkedFigure href={here({ show: "top3" })} label="In the first 3" testId="tile-grid-top3" value={`${shown.summary.top3} of ${shown.summary.checked}`}
                    delta={previous && previous.checked === shown.summary.checked ? <DeltaBadge value={shown.summary.top3 - previous.top3} label={`Change since the scan of ${fmtDate(previous.at)}, over the same ${previous.checked} points`} /> : null}
                    foot={previous ? <>was <Link href={at(previous.id, { show: "top3" })} className={TEXT_LINK}>{previous.top3} of {previous.checked} on {fmtDate(previous.at)}</Link></> : "points where you are one of the first three local results"}
                    chart={<RatioBar value={shown.summary.top3} total={shown.summary.checked} label="Points in the first 3" />} />
                  <LinkedFigure href={here({ show: "found" })} label="Found" testId="tile-grid-found" value={`${shown.summary.found} of ${shown.summary.checked}`} foot={previous ? <>was <Link href={at(previous.id, { show: "found" })} className={TEXT_LINK}>{previous.found} of {previous.checked} on {fmtDate(previous.at)}</Link> · in the first {depth} local results</> : `points where you are in the first ${depth} local results`}
                    chart={<RatioBar value={shown.summary.found} total={shown.summary.checked} label="Points where you are found" />} />
                  <LinkedFigure href={here()} label="Area" testId="tile-grid-area" value={span ? `${span} × ${span} mi` : "1 point"} foot={shown.summary.checked < shown.summary.points ? <Link href={here({ show: "failed" })} className={QUIET_LINK} data-testid="link-grid-failed">{shown.summary.points - shown.summary.checked} point{shown.summary.points - shown.summary.checked === 1 ? "" : "s"} could not be checked</Link> : <Link href={here({ show: "checked" })} className={QUIET_LINK}>{shown.summary.points} points checked</Link>} />
                </MetricRow>
              </div>
              {(() => {
                const mine = watches.find((w) => w.keyword === shown.keyword && w.size === shown.size && w.spacing === shown.spacing);
                const each = prices?.gridPer100 != null ? money(Math.ceil((shown.size * shown.size * prices.gridPer100) / 100)) : null;
                return (
                  <p className="g-text-2 mb-3 flex flex-wrap items-center gap-2 text-[13px]" data-testid="grid-repeat">
                    {mine ? <>This scan repeats every {mine.every === "weekly" ? "week" : "month"} — next on <Link href={seoLinks.usage()} className={QUIET_LINK} title="Usage: each repeat is taken from your included SEO data" data-testid="link-grid-repeat-next">{fmtDate(mine.nextAt)}</Link>. <button type="button" className="g-link min-h-11" disabled={unwatch.isPending} onClick={() => unwatch.mutate({ siteId: site.id, id: mine.id })} data-testid="button-grid-unwatch">Stop</button></> : <>
                      <span>Repeat this scan automatically{each ? <> (about <Link href={seoLinks.usage()} className={QUIET_LINK}>{each} each time</Link>, from your included SEO data only)</> : ""}:</span>
                      {(["monthly", "weekly"] as const).map((every) => <button key={every} type="button" className="g-pill g-pill--sm !min-h-11" disabled={watch.isPending || !sameCenter(shown.center, pin ? { lat: pin.lat, lng: pin.lng, name: pin.name, cid: pin.cid } : null)} onClick={() => watch.mutate({ siteId: site.id, body: { keyword: shown.keyword, size: shown.size, spacing: shown.spacing, every } })} data-testid={`button-grid-watch-${every}`}>Every {every === "weekly" ? "week" : "month"}</button>)}
                    </>}
                  </p>
                );
              })()}
              {unsure > 0 && <p className="g-text-2 mb-3 text-[13px]" role="status" data-testid="text-grid-unsure">At <Link href={here({ show: "found" })} className={QUIET_LINK}>{unsure} point{unsure === 1 ? "" : "s"}</Link> either Google's result or your pinned listing carried no listing id, so you were recognised by your website or name instead. If you have more than one location, that match could be another branch.</p>}
              <div className="grid gap-5 lg:grid-cols-[auto,1fr]">
                <div>
                  <div className="g-text-2 mb-1 text-center text-[11px]">North</div>
                  {/* A point pressed is written to the address (?cell=), so the view can be linked to and the back button unpicks it. Outlined points are the ones a figure counts (?show=). */}
                  <div role="group" aria-label={`Positions for "${shown.keyword}" at ${shown.summary.points} points, north at the top`} className="inline-grid gap-1.5" style={{ gridTemplateColumns: `repeat(${shown.size}, minmax(0, 1fr))` }} data-testid="grid-cells">
                    {shown.points.map((p, i) => { const t = tone(p); const lit = !!show && counts(p, show); return (
                      <button key={i} type="button" onClick={() => setParam("cell", cell === i ? null : i)} aria-pressed={cell === i}
                        aria-label={`${whereIs(p, shown.size, shown.spacing)}: ${t.words}${lit ? " (counted)" : ""}`} title={`${whereIs(p, shown.size, shown.spacing)}: ${t.words}`} data-testid={`grid-cell-${p.row}-${p.col}`}
                        className="flex items-center justify-center rounded-full text-[13px] font-medium tabular-nums"
                        style={{ width: shown.size > 5 ? 44 : 48, height: shown.size > 5 ? 44 : 48, background: t.bg, color: t.fg, outline: cell === i ? "3px solid var(--g-blue, #1a73e8)" : lit ? "3px solid var(--g-text, #202124)" : undefined, outlineOffset: 2, opacity: show && !lit ? 0.45 : undefined }}>{t.label}</button>
                    ); })}
                  </div>
                  <div className="g-text-2 mt-1 text-center text-[11px]">South</div>
                  {/* The key: each colour's points can be outlined where a figure counts them. */}
                  <ul className="g-text-2 mt-3 flex flex-wrap gap-x-3 gap-y-1 text-[12px]" aria-label="What the colours mean">
                    {([["#188038", "1–3", "top3"], ["#f9ab00", "4–10", "found"], ["#e8710a", "11–20", "found"], ["#c5221f", "20+ not found", "checked"], ["var(--g-divider)", "? unknown", "failed"]] as const).map(([c, l, s]) => <li key={l} className="flex items-center gap-1"><span className="inline-block h-3 w-3 rounded-full" style={{ background: c }} aria-hidden /> <Link href={here({ show: s })} className={QUIET_LINK} title={s === "top3" ? "Outline the points in the first 3" : s === "found" ? "Outline every point where you are found" : s === "checked" ? "Outline every point checked" : "Outline the points whose lookup failed"}>{l}</Link></li>)}
                  </ul>
                </div>
                <div className="min-w-0">
                  {selected ? (
                    <div className="mb-4 rounded-xl border p-3" style={CARD} data-testid="grid-cell-detail" role="status">
                      <Heading level={3} className="!mb-0 !text-[14px]">{whereIs(selected, shown.size, shown.spacing).replace(/^./, (c) => c.toUpperCase())}</Heading>
                      <p className="g-text-2 text-[13px]">You: <Link href={here({ show: selected.failed ? "failed" : selected.rank === null ? "checked" : selected.rank <= 3 ? "top3" : "found", cell: cell ?? undefined })} className={QUIET_LINK}>{tone(selected).words}</Link>{selected.by && selected.by !== "id" ? ` (recognised by your ${selected.by})` : ""}.</p>
                      {selected.top.length > 0 && <ol className="g-text mt-2 list-decimal pl-5 text-[13px]">{selected.top.map((t) => { const rival = shown.rivals.find((r) => r.name === t.name); return <li key={t.rank}>{rival?.ours ? <Link href={seoLinks.rankTracker(site.id, { mapPack: true })} className={TEXT_LINK}>{t.name}</Link> : rival?.domain ? <Link href={seoLinks.explorer(rival.domain)} className={TEXT_LINK} title={`Open ${rival.domain} in Site explorer`}>{t.name}</Link> : <>{t.name} <span className="g-text-2">(no website in Google's listing)</span></>}</li>; })}</ol>}
                    </div>
                  ) : <p className="g-text-2 mb-4 text-[13px]">Select a point to see who is in the first three there.</p>}
                  <Heading level={3}>Who shows up across the area</Heading>
                  {shown.rivals.length ? (
                    <div className="overflow-x-auto"><table className="g-table" data-testid="table-grid-rivals">
                      <thead><tr><th>Business</th><th className="num">In the first 3</th><th className="num">Found</th><th className="num">Average position where found</th><th className="num">Reviews</th></tr></thead>
                      {/* A business with a website opens in Site explorer, its figures too (no view holds a rival's points); your own row and figures open your points here, and your map-pack keywords in the rank tracker. Reviews are Google's, not ours to open. */}
                      <tbody>{shown.rivals.map((r, i) => { const rival = r.domain ? seoLinks.explorer(r.domain) : null; const cellOf = (s: Show, text: string) => r.ours ? <Link href={here({ show: s })} className={FIGURE_LINK}>{text}</Link> : rival ? <Link href={rival} className={FIGURE_LINK} title={`${r.name} in Site explorer`}>{text}</Link> : <span title="No website in Google's listing, so there is nowhere to open">{text}</span>; return (
                        <tr key={`${r.name}-${i}`} style={r.ours ? { background: "var(--g-hover, rgba(26,115,232,.06))" } : undefined}>
                          <td>{r.ours ? <Link href={seoLinks.rankTracker(site.id, { mapPack: true })} className={TEXT_LINK} data-testid="link-grid-rival-you">{r.name}</Link> : rival ? <Link href={rival} className={TEXT_LINK} title={`Open ${r.domain} in Site explorer`} data-testid={`link-grid-rival-${i}`}>{r.name}</Link> : <>{r.name} <span className="g-text-2 text-[12px]">(no website in Google's listing)</span></>}{r.ours && <span className="g-chip g-chip--sm ml-2">You</span>}{r.domain && <span className="g-text-2 block text-[12px]"><Link href={seoLinks.explorer(r.domain)} className={QUIET_LINK}>{r.domain}</Link></span>}</td>
                          <td className="num" data-label="In the first 3"><MiniBar value={r.top3} total={shown.summary.checked} className="mr-2" />{cellOf("top3", `${r.top3} of ${shown.summary.checked}`)}</td>
                          <td className="num" data-label="Found"><MiniBar value={r.found} total={shown.summary.checked} className="mr-2" />{cellOf("found", `${r.found} of ${shown.summary.checked}`)}</td>
                          <td className="num" data-label="Average position where found">{cellOf("found", String(r.avgRank))}</td>
                          <td className="num" data-label="Reviews">{r.rating != null ? <a href={seoLinks.googleMaps({ cid: r.cid, name: r.name, address: r.ours ? pin?.address : null })} target="_blank" rel="noreferrer" className={QUIET_LINK} title={`${r.name} on Google Maps: Google's own stars and reviews (no view here holds them)`}>{`${r.rating} (${fmtNum(r.reviews)})`} ↗</a> : "—"}</td>
                        </tr>
                      ); })}</tbody>
                    </table></div>
                  ) : <p className="g-text-2 text-[13px]">Google showed no local businesses for this search here.</p>}
                  <p className="g-text-2 mt-2 text-[12px]">These are positions in Google's local finder — the full list of local businesses Google shows for a search — for a search made from each point at the time of the scan. It is not the three-business map pack on the ordinary results page (the <Link href={seoLinks.rankTracker(site.id, { mapPack: true })} className={TEXT_LINK}>rank tracker</Link> follows that), and a real customer's results also depend on their own history and device. Reviews are Google's own count.</p>
                </div>
              </div>
            </section>
          )}

          {pin && !changing && watches.length > 0 && (
            <section className="mb-5" data-testid="grid-watches">
              <Heading>Repeating scans</Heading>
              {/* Each repeating search opens its newest finished scan — the scan it repeats; its square and date too. */}
              <ul className="space-y-1 text-[13px]">
                {watches.map((w) => { const last = newestOf(w); return <li key={w.id} className="flex flex-wrap items-center gap-2">{last ? <Link href={at(last.id)} className={TEXT_LINK} onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })} data-testid={`link-grid-watch-${w.id}`}>"{w.keyword}"</Link> : <span className="g-text">"{w.keyword}"</span>}<span className="g-text-2">{last ? <Link href={at(last.id)} className={QUIET_LINK}>{w.size} × {w.size}, {miles(w.spacing)} apart</Link> : `${w.size} × ${w.size}, ${miles(w.spacing)} apart`} · every {w.every === "weekly" ? "week" : "month"} · next <Link href={seoLinks.usage()} className={QUIET_LINK} title="Usage: each repeat is taken from your included SEO data">{fmtDate(w.nextAt)}</Link>{last ? <> · last <Link href={at(last.id)} className={QUIET_LINK}>{fmtDate(last.at)}</Link></> : " · no finished scan yet"}</span><button type="button" className="g-link min-h-11" disabled={unwatch.isPending} onClick={() => unwatch.mutate({ siteId: site.id, id: w.id })} aria-label={`Stop repeating the scan for ${w.keyword}`}>Stop</button></li>; })}
              </ul>
              <p className="g-text-2 mt-1 text-[12px]">Repeating scans use the month's included SEO data only — never credit you bought — and are skipped when it has run out. You get <Link href={seoLinks.alerts({ site: site.id, kind: "grid_down" })} className={TEXT_LINK}>an alert</Link> when the area clearly gets better or worse.</p>
            </section>
          )}
          {pin && !changing && (
            <section data-testid="grid-history">
              <Heading>Scans so far</Heading>
              {q.data.scans.length === 0 ? <Empty testId="grid-no-scans"><h3>No scans yet</h3><p>Enter a search your customers make — "siding contractor", "roof repair near me" — and scan the area. Green points are where you are one of the first three local businesses Google lists.</p></Empty> : (
                <div className="overflow-x-auto"><table className="g-table" data-testid="table-grid-scans">
                  <thead><tr><th>Search</th><th>Grid</th><th className="num">Position score</th><th className="num">In the first 3</th><th className="num">Found</th><th className="num">When</th></tr></thead>
                  {/* A scan opened here is an address (?scan=), the same one a report or alert links to; its figures open it with the points they count outlined. */}
                  <tbody>{q.data.scans.map((s) => { const open = { scan: s.id }; return (
                    <tr key={s.id} style={openId === s.id ? { background: "var(--g-hover, rgba(26,115,232,.06))" } : undefined}>
                      <td><Link href={seoLinks.localGrid(site.id, open)} className={`${TEXT_LINK} text-left`} aria-current={openId === s.id ? "true" : undefined} onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })} data-testid={`button-grid-open-${s.id}`}>{s.keyword}</Link>{s.center && !sameCenter(s.center, pin ? { lat: pin.lat, lng: pin.lng, name: pin.name, cid: pin.cid } : null) && <span className="g-text-2 block text-[12px]">{s.center.name}</span>}</td>
                      <td data-label="Grid" className="g-text-2"><Link href={seoLinks.localGrid(site.id, open)} className={QUIET_LINK}>{s.size} × {s.size}, {miles(s.spacing)}</Link></td>
                      {s.status === "failed" ? <td colSpan={3} className="g-text-2" data-label="Result"><Link href={seoLinks.localGrid(site.id, open)} className={QUIET_LINK}>Didn't finish</Link>{s.error ? ` — ${s.error}` : ""}</td> : <>
                        <td className="num" data-label="Position score"><Link href={seoLinks.localGrid(site.id, { ...open, show: "checked" })} className={FIGURE_LINK}>{s.avgRank ?? "—"}</Link></td>
                        <td className="num" data-label="In the first 3"><Link href={seoLinks.localGrid(site.id, { ...open, show: "top3" })} className={FIGURE_LINK}>{s.top3} of {s.checked}</Link></td>
                        <td className="num" data-label="Found"><Link href={seoLinks.localGrid(site.id, { ...open, show: "found" })} className={FIGURE_LINK}>{s.found} of {s.checked}</Link></td>
                      </>}
                      <td className="num g-text-2" data-label="When"><Link href={seoLinks.localGrid(site.id, open)} className={QUIET_LINK}>{fmtDate(s.at)}</Link></td>
                    </tr>
                  ); })}</tbody>
                </table></div>
              )}
            </section>
          )}
        </>
      )}
    </SeoShell>
  );
}
