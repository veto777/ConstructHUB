/**
 * /seo/local-grid — Local grid: where the business shows up in Google's local
 * results for one search, searched from a square of points over its service area.
 * Pick the business on the map once, then scan a keyword; each scan is kept so the next can be
 * compared with it. Every lookup shows its price first (server/seo/grid.ts).
 */
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiErrorMessage } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { api, Empty, fmtDate, fmtNum, money, SeoShell, useSelectedSite, useSeoSites, useSeoStatus } from "./shell";
import { DeltaBadge, MetricColumn } from "./viz";
import { CARD, Heading, MetricRow, MiniBar, RatioBar } from "./viz-more";

type Pin = { name: string; address: string | null; lat: number; lng: number; cid: string | null; domain?: string | null };
type Listing = { name: string; rank: number; cid: string | null; domain: string | null; address: string | null; lat: number | null; lng: number | null; rating: number | null; reviews: number | null };
type Point = { row: number; col: number; lat: number; lng: number; rank: number | null; failed?: true; by?: "id" | "website" | "name"; top: { name: string; rank: number }[] };
type Rival = { name: string; ours: boolean; domain: string | null; rating: number | null; reviews: number | null; top3: number; found: number; avgRank: number };
type Summary = { points: number; checked: number; found: number; top3: number; avgRank: number | null; unsure?: number };
type Center = { lat: number; lng: number; name: string; cid?: string | null };
type Scan = { id?: number; keyword: string; size: number; spacing: number; center: Center; points: Point[]; rivals: Rival[]; summary: Summary; fetchedAt: string };
type ScanRow = { id: number; keyword: string; size: number; spacing: number; status: "done" | "failed"; error: string | null; center: Center | null; avgRank: number | null; points: number; checked: number; found: number; top3: number; at: string };
type State = { id: number; status: "running" | "done" | "failed"; scan: Scan | null; error: string | null };
type Watch = { id: number; keyword: string; size: number; spacing: number; every: "weekly" | "monthly"; nextAt: string };
type Data = { pin: Pin | null; scans: ScanRow[]; watches?: Watch[]; maxWatches?: number; running: { id: number; keyword: string; size: number; spacing: number; at: string } | null; sizes: number[]; spacings: number[]; depth: number; suggestion: string };

const miles = (n: number) => `${n} mile${n === 1 ? "" : "s"}`;
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
/** The same listing in the same place? Only then is one scan comparable with another. */
const sameCenter = (a: Center | null | undefined, b: Center | null | undefined) =>
  !!a && !!b && Math.abs(a.lat - b.lat) < 1e-4 && Math.abs(a.lng - b.lng) < 1e-4 && (a.cid ?? null) === (b.cid ?? null)
  // Without Google's id on either side, the same name in the same place is the least that makes it the same listing.
  && ((a.cid ?? null) !== null || a.name === b.name);

export default function SeoLocalGridPage() {
  const status = useSeoStatus();
  const sites = useSeoSites();
  const [site, onSite] = useSelectedSite(sites.data);
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
  /** The scan on screen. */
  const [openId, setOpenId] = useState<number | null>(null);
  /** The scan that is running, watched whatever else is on screen. */
  const [activeId, setActiveId] = useState<number | null>(null);
  const [cell, setCell] = useState<number | null>(null);
  // Another site is another business: nothing from the last one stays on screen.
  useEffect(() => { setFound(null); setChanging(false); setOpenId(null); setActiveId(null); setCell(null); setKeyword(""); setQuery(""); }, [site?.id]);
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
      setActiveId(d.id); setOpenId(d.id); setCell(null);
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

  return (
    <SeoShell title="Local grid" description="Where your business shows up in Google's local results across your service area — looked up for point after point, for the searches your customers make." site={site} onSite={onSite} sites={sites} status={status}>
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
              {!can(holds?.gridLocate ?? prices?.gridLocate) && <p className="mt-2 text-[13px]" style={{ color: "var(--g-red)" }}>Not enough SEO data left — add credit above.</p>}
              {listings && listings.length === 0 && <p className="g-text-2 mt-3 text-[13px]" role="status" data-testid="grid-locate-none">Google Maps showed no business for that. Try the name exactly as it appears on your listing, with the town.</p>}
              {listings && listings.length > 0 && (
                <ul className="mt-3 space-y-2" data-testid="list-grid-found">
                  {listings.map((l, i) => (
                    <li key={`${l.cid ?? l.name}-${i}`} className="flex flex-wrap items-center gap-2 rounded-lg border p-3" style={{ borderColor: "var(--g-divider)" }}>
                      <MapPin className="g-text-2 h-4 w-4 shrink-0" aria-hidden />
                      <div className="min-w-0 flex-1">
                        <div className="g-text text-[14px] font-medium">{l.name}</div>
                        <div className="g-text-2 text-[12px]">{[l.address, l.domain, l.rating != null ? `${l.rating} stars${l.reviews != null ? ` (${fmtNum(l.reviews)} reviews)` : ""}` : null].filter(Boolean).join(" · ") || "No address shown"}</div>
                      </div>
                      <Button size="sm" disabled={pinIt.isPending} onClick={() => pinIt.mutate({ siteId: found!.siteId, l })} aria-label={`This is my business: ${l.name}${l.address ? `, ${l.address}` : ""}`} data-testid={`button-grid-pin-${i}`}>This is my business</Button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ) : (
            <section className="mb-5" data-testid="grid-run">
              <p className="g-text-2 mb-3 flex flex-wrap items-center gap-2 text-[13px]" data-testid="text-grid-pin">
                <MapPin className="h-4 w-4" aria-hidden /> <span>Centred on <b className="g-text font-medium">{pin.name}</b>{pin.address ? ` — ${pin.address}` : ""}</span>
                <button type="button" className="g-link" onClick={() => { setChanging(true); setFound(null); }} data-testid="button-grid-change">Change</button>
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
                {size} × {size} points, {miles(spacing)} apart, covers a square {miles((size - 1) * spacing)} across. Each point is one lookup of Google's local results made for that spot, as if searching from there{scanPrice != null ? ` — about ${money(scanPrice)} of your SEO data in all` : ""}; a lookup that fails is not charged (one that works but finds no businesses is).
                {scanHold != null && scanPrice != null && scanHold > scanPrice ? ` Up to ${money(scanHold)} is set aside while it runs; what isn't used comes straight back.` : ""} A scan is kept in the history below; running it again is a new scan.
                {!can(scanHold) && <span style={{ color: "var(--g-red)" }}> Not enough SEO data left — add credit above.</span>}
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
              <Heading className="!mb-3 !text-[18px]" meta={<>{shown.size} × {shown.size}, {miles(shown.spacing)} apart · {fmtDate(shown.fetchedAt)} · {shown.center.name}</>}>"{shown.keyword}"</Heading>
              {/* The scan's figures in one row; the move is against the comparable scan before it (lower position score is better). */}
              <div className="mb-4 rounded-xl border p-3 sm:p-4" style={CARD}>
                <MetricRow cols={4} testId="grid-summary">
                  <MetricColumn label="Position score" testId="tile-grid-avg" value={shown.summary.avgRank ?? "—"}
                    delta={previous?.avgRank != null && shown.summary.avgRank != null ? <DeltaBadge value={shown.summary.avgRank - previous.avgRank} upIsBad label={`Change since the scan of ${fmtDate(previous.at)}`} /> : null}
                    foot={`Average over the ${shown.summary.checked} points checked; "not in the first ${depth}" counts as ${depth + 1}${previous?.avgRank != null && shown.summary.avgRank != null ? `. Was ${previous.avgRank} over ${previous.checked} points on ${fmtDate(previous.at)}` : ""}`} />
                  <MetricColumn label="In the first 3" testId="tile-grid-top3" value={`${shown.summary.top3} of ${shown.summary.checked}`}
                    delta={previous && previous.checked === shown.summary.checked ? <DeltaBadge value={shown.summary.top3 - previous.top3} label={`Change since the scan of ${fmtDate(previous.at)}, over the same ${previous.checked} points`} /> : null}
                    foot={previous ? `${previous.top3} of ${previous.checked} on ${fmtDate(previous.at)}` : "points where you are one of the first three local results"}
                    chart={<RatioBar value={shown.summary.top3} total={shown.summary.checked} label="Points in the first 3" />} />
                  <MetricColumn label="Found" testId="tile-grid-found" value={`${shown.summary.found} of ${shown.summary.checked}`} foot={`points where you are in the first ${depth} local results`}
                    chart={<RatioBar value={shown.summary.found} total={shown.summary.checked} label="Points where you are found" />} />
                  <MetricColumn label="Area" testId="tile-grid-area" value={span ? `${span} × ${span} mi` : "1 point"} foot={shown.summary.checked < shown.summary.points ? `${shown.summary.points - shown.summary.checked} point${shown.summary.points - shown.summary.checked === 1 ? "" : "s"} could not be checked` : `${shown.summary.points} points checked`} />
                </MetricRow>
              </div>
              {(() => {
                const mine = watches.find((w) => w.keyword === shown.keyword && w.size === shown.size && w.spacing === shown.spacing);
                const each = prices?.gridPer100 != null ? money(Math.ceil((shown.size * shown.size * prices.gridPer100) / 100)) : null;
                return (
                  <p className="g-text-2 mb-3 flex flex-wrap items-center gap-2 text-[13px]" data-testid="grid-repeat">
                    {mine ? <>This scan repeats every {mine.every === "weekly" ? "week" : "month"} — next on {fmtDate(mine.nextAt)}. <button type="button" className="g-link" disabled={unwatch.isPending} onClick={() => unwatch.mutate({ siteId: site.id, id: mine.id })} data-testid="button-grid-unwatch">Stop</button></> : <>
                      <span>Repeat this scan automatically{each ? ` (about ${each} each time, from your included SEO data only)` : ""}:</span>
                      {(["monthly", "weekly"] as const).map((every) => <button key={every} type="button" className="g-pill g-pill--sm" disabled={watch.isPending || !sameCenter(shown.center, pin ? { lat: pin.lat, lng: pin.lng, name: pin.name, cid: pin.cid } : null)} onClick={() => watch.mutate({ siteId: site.id, body: { keyword: shown.keyword, size: shown.size, spacing: shown.spacing, every } })} data-testid={`button-grid-watch-${every}`}>Every {every === "weekly" ? "week" : "month"}</button>)}
                    </>}
                  </p>
                );
              })()}
              {unsure > 0 && <p className="g-text-2 mb-3 text-[13px]" role="status" data-testid="text-grid-unsure">At {unsure} point{unsure === 1 ? "" : "s"} either Google's result or your pinned listing carried no listing id, so you were recognised by your website or name instead. If you have more than one location, that match could be another branch.</p>}
              <div className="grid gap-5 lg:grid-cols-[auto,1fr]">
                <div>
                  <div className="g-text-2 mb-1 text-center text-[11px]">North</div>
                  <div role="group" aria-label={`Positions for "${shown.keyword}" at ${shown.summary.points} points, north at the top`} className="inline-grid gap-1.5" style={{ gridTemplateColumns: `repeat(${shown.size}, minmax(0, 1fr))` }} data-testid="grid-cells">
                    {shown.points.map((p, i) => { const t = tone(p); return (
                      <button key={i} type="button" onClick={() => setCell(cell === i ? null : i)} aria-pressed={cell === i}
                        aria-label={`${whereIs(p, shown.size, shown.spacing)}: ${t.words}`} title={`${whereIs(p, shown.size, shown.spacing)}: ${t.words}`} data-testid={`grid-cell-${p.row}-${p.col}`}
                        className="flex items-center justify-center rounded-full text-[13px] font-medium tabular-nums"
                        style={{ width: shown.size > 5 ? 40 : 48, height: shown.size > 5 ? 40 : 48, background: t.bg, color: t.fg, outline: cell === i ? "3px solid var(--g-blue, #1a73e8)" : undefined, outlineOffset: 2 }}>{t.label}</button>
                    ); })}
                  </div>
                  <div className="g-text-2 mt-1 text-center text-[11px]">South</div>
                  <ul className="g-text-2 mt-3 flex flex-wrap gap-x-3 gap-y-1 text-[12px]" aria-label="What the colours mean">
                    {[["#188038", "1–3"], ["#f9ab00", "4–10"], ["#e8710a", "11–20"], ["#c5221f", "20+ not found"], ["var(--g-divider)", "? unknown"]].map(([c, l]) => <li key={l} className="flex items-center gap-1"><span className="inline-block h-3 w-3 rounded-full" style={{ background: c }} aria-hidden /> {l}</li>)}
                  </ul>
                </div>
                <div className="min-w-0">
                  {selected ? (
                    <div className="mb-4 rounded-xl border p-3" style={CARD} data-testid="grid-cell-detail" role="status">
                      <Heading level={3} className="!mb-0 !text-[14px]">{whereIs(selected, shown.size, shown.spacing).replace(/^./, (c) => c.toUpperCase())}</Heading>
                      <p className="g-text-2 text-[13px]">You: {tone(selected).words}{selected.by && selected.by !== "id" ? ` (recognised by your ${selected.by})` : ""}.</p>
                      {selected.top.length > 0 && <ol className="g-text mt-2 list-decimal pl-5 text-[13px]">{selected.top.map((t) => <li key={t.rank}>{t.name}</li>)}</ol>}
                    </div>
                  ) : <p className="g-text-2 mb-4 text-[13px]">Select a point to see who is in the first three there.</p>}
                  <Heading level={3}>Who shows up across the area</Heading>
                  {shown.rivals.length ? (
                    <div className="overflow-x-auto"><table className="g-table" data-testid="table-grid-rivals">
                      <thead><tr><th>Business</th><th className="num">In the first 3</th><th className="num">Found</th><th className="num">Average position where found</th><th className="num">Reviews</th></tr></thead>
                      <tbody>{shown.rivals.map((r, i) => (
                        <tr key={`${r.name}-${i}`} style={r.ours ? { background: "var(--g-hover, rgba(26,115,232,.06))" } : undefined}>
                          <td>{r.name}{r.ours && <span className="g-chip g-chip--sm ml-2">You</span>}{r.domain && <span className="g-text-2 block text-[12px]">{r.domain}</span>}</td>
                          <td className="num" data-label="In the first 3"><MiniBar value={r.top3} total={shown.summary.checked} className="mr-2" />{r.top3} of {shown.summary.checked}</td>
                          <td className="num" data-label="Found"><MiniBar value={r.found} total={shown.summary.checked} className="mr-2" />{r.found} of {shown.summary.checked}</td>
                          <td className="num" data-label="Average position where found">{r.avgRank}</td>
                          <td className="num" data-label="Reviews">{r.rating != null ? `${r.rating} (${fmtNum(r.reviews)})` : "—"}</td>
                        </tr>
                      ))}</tbody>
                    </table></div>
                  ) : <p className="g-text-2 text-[13px]">Google showed no local businesses for this search here.</p>}
                  <p className="g-text-2 mt-2 text-[12px]">These are positions in Google's local finder — the full list of local businesses Google shows for a search — for a search made from each point at the time of the scan. It is not the three-business map pack on the ordinary results page (the rank tracker follows that), and a real customer's results also depend on their own history and device.</p>
                </div>
              </div>
            </section>
          )}

          {pin && !changing && watches.length > 0 && (
            <section className="mb-5" data-testid="grid-watches">
              <Heading>Repeating scans</Heading>
              <ul className="space-y-1 text-[13px]">
                {watches.map((w) => <li key={w.id} className="flex flex-wrap items-center gap-2"><span className="g-text">"{w.keyword}"</span><span className="g-text-2">{w.size} × {w.size}, {miles(w.spacing)} apart · every {w.every === "weekly" ? "week" : "month"} · next {fmtDate(w.nextAt)}</span><button type="button" className="g-link" disabled={unwatch.isPending} onClick={() => unwatch.mutate({ siteId: site.id, id: w.id })} aria-label={`Stop repeating the scan for ${w.keyword}`}>Stop</button></li>)}
              </ul>
              <p className="g-text-2 mt-1 text-[12px]">Repeating scans use the month's included SEO data only — never credit you bought — and are skipped when it has run out. You get an alert when the area clearly gets better or worse.</p>
            </section>
          )}
          {pin && !changing && (
            <section data-testid="grid-history">
              <Heading>Scans so far</Heading>
              {q.data.scans.length === 0 ? <Empty testId="grid-no-scans"><h3>No scans yet</h3><p>Enter a search your customers make — "siding contractor", "roof repair near me" — and scan the area. Green points are where you are one of the first three local businesses Google lists.</p></Empty> : (
                <div className="overflow-x-auto"><table className="g-table" data-testid="table-grid-scans">
                  <thead><tr><th>Search</th><th>Grid</th><th className="num">Position score</th><th className="num">In the first 3</th><th className="num">Found</th><th className="num">When</th></tr></thead>
                  <tbody>{q.data.scans.map((s) => (
                    <tr key={s.id}>
                      <td><button type="button" className="g-link text-left" aria-current={openId === s.id ? "true" : undefined} onClick={() => { setOpenId(s.id); setCell(null); window.scrollTo({ top: 0, behavior: "smooth" }); }} data-testid={`button-grid-open-${s.id}`}>{s.keyword}</button>{s.center && !sameCenter(s.center, pin ? { lat: pin.lat, lng: pin.lng, name: pin.name, cid: pin.cid } : null) && <span className="g-text-2 block text-[12px]">{s.center.name}</span>}</td>
                      <td data-label="Grid" className="g-text-2">{s.size} × {s.size}, {miles(s.spacing)}</td>
                      {s.status === "failed" ? <td colSpan={3} className="g-text-2" data-label="Result">Didn't finish{s.error ? ` — ${s.error}` : ""}</td> : <>
                        <td className="num" data-label="Position score">{s.avgRank ?? "—"}</td>
                        <td className="num" data-label="In the first 3">{s.top3} of {s.checked}</td>
                        <td className="num" data-label="Found">{s.found} of {s.checked}</td>
                      </>}
                      <td className="num g-text-2" data-label="When">{fmtDate(s.at)}</td>
                    </tr>
                  ))}</tbody>
                </table></div>
              )}
            </section>
          )}
        </>
      )}
    </SeoShell>
  );
}
