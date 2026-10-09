/**
 * Keywords explorer -> Service × town: the customer's services against the towns they serve.
 * Every cell is the search "service town": how often it is searched and where the site ranks for
 * it. Gaps and weak spots can be ticked and sent to the action plan, a list or the rank tracker.
 * Every figure is a link (links.ts): a cell's searches a month to the search's overview in the Keywords explorer, its
 * position to the site's organic keywords in Site explorer (the keyword database the position comes from) and to the
 * rank tracker when the site tracks it; the summary tiles narrow the grid to the cells they count (`show` in the
 * address, shown as a chip with a clear). Selecting a cell is its own control, a checkbox. See server/seo/planner.ts.
 * Round 3: a service's row heading and a town's column heading narrow the grid to it (`service`, `town` in the
 * address, each with its chip and clear); a tile with no figure ("—") is no link; on a phone (under 640 px) the grid
 * is one card per town with the services as its rows, so nothing scrolls sideways.
 */
import { useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import { Link } from "wouter";
import { seoLinks, setParam } from "./links";
import { marketParams, useTrackedKeywords } from "./keyword-links";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, Loader2, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiErrorMessage } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { ActiveFilter, api, Empty, fmtDate, fmtNum, isNotRunYet, money, useAddress, type SeoSite, type SeoStatus } from "./shell";
import { AddToList, type KwRow } from "./keyword-lists";
import { AddToPlan, type PlanTask } from "./plan-button";
import { DEFAULT_MARKET, findMarket } from "@shared/seo-markets";
import { MetricColumn, PALETTE } from "./viz";
import { BarFigure, BLOCK_LINK, Card, FIG_LINK, MetricRow, TEXT_LINK } from "./viz-keywords";

type Show = "gaps" | "weak" | "strong" | "unknown";
const SHOWS: readonly Show[] = ["gaps", "weak", "strong", "unknown"];
/** The tiles' words, and the address that narrows the grid to the cells each counts. */
const SHOW_WORDS: Record<Show, string> = { gaps: "Gaps: searched, and no ranking found for you", weak: "Beyond the first three", strong: "In the first three", unknown: "Nothing known: too few searches to measure, or a part that didn't load" };
const showAt = (show: Show | undefined) => seoLinks.keywords("", { view: "area", show });
/** The grid narrowed to one service's row and / or one town's column, with a tile's narrowing kept (links.ts `service`, `town`). */
const areaAt = (p: { show?: Show; service?: string; town?: string }) => seoLinks.keywords("", { view: "area", ...p });
/** A phone, where a table becomes cards (google.css: under 640 px): the grid is drawn one card per town. */
const PHONE = "(max-width: 639px)";
function usePhone(): boolean {
  return useSyncExternalStore(
    (onChange) => { const m = window.matchMedia(PHONE); m.addEventListener("change", onChange); return () => m.removeEventListener("change", onChange); },
    () => window.matchMedia(PHONE).matches, () => false,
  );
}
const idOf = (v: string) => v.replace(/\s+/g, "-");
/** A pill-sized button that is 44 px tall on a phone. */
const PILL = "g-pill g-pill--sm !min-h-11";

type Cell = { service: string; town: string; keyword: string; volume: number | null; difficulty: number | null; cpc: number | null; position: number | null; url: string | null; home: boolean };
type Data = { domain: string; locationCode?: number; languageCode?: string; fetchedAt: string; services: string[]; towns: string[]; cells: Cell[]; summary: { cells: number; gaps: number | null; gapVolume: number | null; weak: number | null; strong: number | null; unknown: number | null }; missing: string[] };
type Saved = { services: string[]; towns: string[] } | null;
const MAX_SERVICES = 12, MAX_TOWNS = 15, MAX_CELLS = 150;
/** One per line. A comma inside a line is part of it ("Bellingham, WA" is one town). */
const parse = (text: string) => [...new Set(text.split(/\n/).map((s) => s.toLowerCase().replace(/,/g, " ").replace(/\s+/g, " ").trim()).filter((s) => s.length >= 2))];
const MAX_CHARS = 80, MAX_WORDS = 10;
const csvCell = (v: string | number | null) => { const s = v == null ? "" : String(v); return `"${(typeof v !== "number" && /^[=+\-@\t\r]/.test(s) ? `'${s}` : s).replace(/"/g, '""')}"`; };

/** A gap — searched, and no ranking found — is the one thing here shown in red: it is what needs doing. */
const GAP_RED = "#c5221f";
/**
 * What a cell says, in colour and in words (colour is never the only signal). Positions wear the dashboard's orange
 * shades — deep for the first three, light for the rest of page one, grey beyond — so the only red is a gap.
 */
function state(c: Cell, rankingsKnown: boolean, volumesKnown: boolean): { bg: string; fg: string; label: string; words: string } {
  if (c.position !== null) {
    if (c.position <= 3) return { bg: PALETTE.top3, fg: "#fff", label: `#${c.position}`, words: `the keyword database has you at ${c.position}` };
    if (c.position <= 10) return { bg: PALETTE.top10, fg: "#202124", label: `#${c.position}`, words: `the keyword database has you at ${c.position}, on page one` };
    return { bg: PALETTE.rest, fg: "#202124", label: `#${c.position}`, words: `the keyword database has you at ${c.position}, beyond page one` };
  }
  if (!rankingsKnown) return { bg: "var(--g-divider)", fg: "var(--g-text)", label: "?", words: "your ranking didn't load" };
  if ((c.volume ?? 0) > 0) return { bg: GAP_RED, fg: "#fff", label: "Gap", words: "the keyword database has no ranking for you in its first 100" };
  if (!volumesKnown) return { bg: "var(--g-divider)", fg: "var(--g-text)", label: "?", words: "the search volume didn't load, and no ranking was found for you" };
  return { bg: "transparent", fg: "var(--g-text-2)", label: "—", words: "too few searches to measure, and no ranking was found for you" };
}

export function ServicePlanner({ site, status, onTrack }: { site: SeoSite | null; status: SeoStatus | undefined; onTrack?: (rows: KwRow[]) => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const base = `/api/seo/sites/${site?.id}/planner`;
  // The site's country is part of what a table is: change it and nothing of the old country's numbers stays.
  const marketId = `${site?.locationCode}:${site?.languageCode}`;
  const last = useQuery<{ saved: Saved }>({ queryKey: [base], enabled: !!site });
  const [services, setServices] = useState(""); const [towns, setTowns] = useState("");
  const [asked, setAsked] = useState<{ services: string[]; towns: string[] } | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  // Another site: its own last table, nothing of the previous site's.
  useEffect(() => { setServices(""); setTowns(""); setAsked(null); setPicked(new Set()); }, [site?.id, marketId]);
  // The services and towns used last time come back filled in, and their saved table opens free.
  useEffect(() => { const s = last.data?.saved; if (s && !asked && !services && !towns) { setServices(s.services.join("\n")); setTowns(s.towns.join("\n")); setAsked(s); } }, [last.data]); // eslint-disable-line react-hooks/exhaustive-deps
  const draftS = useMemo(() => parse(services), [services]), draftT = useMemo(() => parse(towns), [towns]);
  const cells = draftS.length * draftT.length;
  const tooMany = draftS.length > MAX_SERVICES || draftT.length > MAX_TOWNS || cells > MAX_CELLS;
  // The first pairing too long to be looked up, named so it can be shortened before anything is bought.
  const tooLong = useMemo(() => { for (const s of draftS) for (const t of draftT) { const k = `${s} ${t}`; if (k.length > MAX_CHARS || k.split(" ").length > MAX_WORDS) return k; } return null; }, [draftS, draftT]);
  // What this many searches can cost: the server's own figure, the same one it sets aside.
  const quote = useQuery<{ quoteCents: number | null }>({ queryKey: [base, "quote", cells], queryFn: () => api("GET", `${base}?cells=${cells}`), enabled: !!site && cells > 0 && !tooMany, staleTime: 60 * 60_000 });
  const body = useMemo(() => (asked ? { services: asked.services, towns: asked.towns } : null), [asked]);
  const queryKey = [base, marketId, body];
  const saved = useQuery<{ page: Data } | null>({
    queryKey, enabled: !!site && !!body, retry: false, staleTime: 5 * 60_000,
    queryFn: async () => { try { return await api("POST", base, { ...body, peek: true }); } catch (e) { if (isNotRunYet(e)) return null; throw e; } },
  });
  const run = useMutation({
    mutationFn: (v: { url: string; body: Record<string, unknown>; key: readonly unknown[]; again: boolean }) => api("POST", v.url, v.again ? { ...v.body, refresh: true } : v.body),
    onSuccess: (data: { page: Data; saved?: boolean }, v) => {
      qc.setQueryData(v.key, data); void qc.invalidateQueries({ queryKey: ["/api/seo/status"] }); void qc.invalidateQueries({ queryKey: [base], exact: true });
      if (data.saved === false) toast({ title: "Shown, but it couldn't be kept", description: "Opening this table again will not be free. Export it now if you need it.", variant: "destructive" });
    },
    onError: (e) => toast({ title: "Couldn't build the table", description: apiErrorMessage(e), variant: "destructive" }),
  });
  const askedCells = asked ? asked.services.length * asked.towns.length : cells;
  const askedQuote = useQuery<{ quoteCents: number | null }>({ queryKey: [base, "quote", askedCells], queryFn: () => api("GET", `${base}?cells=${askedCells}`), enabled: !!site && askedCells > 0, staleTime: 60 * 60_000 });
  const price = askedQuote.data?.quoteCents ?? null;
  // No price on screen, no purchase: the buttons wait for the quote, and say so when it cannot be had.
  const priced = price != null;
  const canPay = priced && (!status?.credits || status.credits.availableCents === -1 || status.credits.availableCents >= price);
  const d = saved.data?.page ?? null;
  useEffect(() => { setPicked(new Set()); }, [d?.fetchedAt]);
  const rankingsKnown = !d?.missing.includes("rankings"), volumesKnown = !d?.missing.includes("volumes");
  // A table for another country than the site's present one is not shown as this country's.
  const stale = !!d && d.locationCode != null && site != null && (d.locationCode !== site.locationCode || d.languageCode !== site.languageCode);
  const at = (service: string, town: string) => d?.cells.find((c) => c.service === service && c.town === town) ?? null;
  const chosen = (d?.cells ?? []).filter((c) => picked.has(c.keyword));
  const toggle = (k: string) => setPicked((s) => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; });
  const gaps = rankingsKnown ? (d?.cells ?? []).filter((c) => c.position === null && (c.volume ?? 0) > 0) : [];
  // The most-searched pairing in the table: each cell's bar is its share of it.
  const maxVolume = Math.max(0, ...(d?.cells ?? []).map((c) => c.volume ?? 0));
  const market = site ? findMarket(site.locationCode, site.languageCode) ?? DEFAULT_MARKET : DEFAULT_MARKET;
  const tracked = useTrackedKeywords(site);
  // `show` in the address (links.ts): only the cells a tile counts are drawn; the chip says which and clears it.
  const address = useAddress();
  const showParam = address.get("show");
  const show = SHOWS.find((x) => x === showParam);
  // `service` / `town` in the address: one service's row, one town's column (the words as the grid shows them).
  const serviceParam = address.get("service")?.trim() || null, townParam = address.get("town")?.trim() || null;
  const serviceOn = serviceParam ? d?.services.find((x) => x === serviceParam.toLowerCase()) ?? null : null;
  const townOn = townParam ? d?.towns.find((x) => x === townParam.toLowerCase()) ?? null : null;
  const shownServices = serviceOn ? [serviceOn] : d?.services ?? [], shownTowns = townOn ? [townOn] : d?.towns ?? [];
  const phone = usePhone();
  /** Which tile a cell belongs to — the same sorting the server's summary makes. */
  const bucket = (c: Cell): Show => c.position !== null ? (c.position <= 3 ? "strong" : "weak") : !rankingsKnown ? "unknown" : (c.volume ?? 0) > 0 ? "gaps" : "unknown";
  const inShow = (c: Cell) => !show || bucket(c) === show;
  // The cells in the rows and columns shown, and of them the ones a tile's narrowing keeps.
  const inGrid = (d?.cells ?? []).filter((c) => shownServices.includes(c.service) && shownTowns.includes(c.town));
  const shownCount = show ? inGrid.filter(inShow).length : 0;
  /** What a tile's narrowing says: the cells it keeps — or, when the part that sorts them didn't load, that none can be sorted. */
  const showWords = (x: Show) => !rankingsKnown && x !== "unknown" ? `${SHOW_WORDS[x]} — not known: your rankings didn't load this time, so no cell can be sorted here (each counts as Nothing known). Check again to fill it in`
    : x === "gaps" && !volumesKnown ? `${SHOW_WORDS[x]} — not known: the search volumes didn't load this time, so no cell can be called a gap. Check again to fill it in`
    : `${SHOW_WORDS[x]} — ${fmtNum(shownCount)} of ${fmtNum(inGrid.length)} cells`;
  /** A heading's link: the grid narrowed to that row or column — or, when it already is, back to every one (the tile's narrowing kept). */
  const serviceHref = (x: string) => areaAt({ show, town: townOn ?? undefined, service: serviceOn === x ? undefined : x });
  const townHref = (x: string) => areaAt({ show, service: serviceOn ?? undefined, town: townOn === x ? undefined : x });
  const exportCsv = () => d && (() => {
    const rows: (string | number | null)[][] = [["Service", "Town", "Search", "Searches / mo", "Difficulty", "Your position", "Your page"], ...d.cells.map((c) => [c.service, c.town, c.keyword, c.volume, c.difficulty, c.position, c.url])];
    const blob = new Blob([rows.map((l) => l.map(csvCell).join(",")).join("\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `${d.domain}-service-area.csv`; a.click(); URL.revokeObjectURL(a.href);
  })();

  /** One cell of the grid, the search "service town": its checkbox, and its searches a month and your position, each a link to where it lives — the same in the table and in a phone's card. */
  const cellBox = (s: string, t: string): ReactNode => {
    const c = at(s, t);
    if (!c || !d) return <span className="g-text-2">—</span>;
    if (!inShow(c)) return <span className="g-text-2"><span aria-hidden>·</span><span className="sr-only">{c.keyword}: not among the cells shown</span></span>;
    const st = state(c, rankingsKnown, volumesKnown); const on = picked.has(c.keyword); const isTracked = tracked.has(c.keyword.toLowerCase()); const words = `${c.keyword}: ${c.volume != null ? `${fmtNum(c.volume)} searches a month` : volumesKnown ? "too few searches to measure" : "search volume didn't load"}; ${st.words}${c.home ? ", with your home page" : ""}`;
    return (
      <div className="flex w-full min-w-[104px] flex-col gap-1 rounded-md border px-2 py-1.5 text-left text-[13px]" style={{ borderColor: on ? "var(--g-blue, #1a73e8)" : "var(--g-divider)", outline: on ? "2px solid var(--g-blue, #1a73e8)" : undefined }} title={c.url ? `${c.keyword} → ${c.url.replace(/^https?:\/\/(www\.)?/, "")}` : c.keyword}>
        <div className="flex items-center justify-between gap-2">
          {/* Selecting is its own control; the figures are links to where each lives. */}
          <label className="inline-flex min-h-11 items-center gap-1.5"><input type="checkbox" checked={on} onChange={() => toggle(c.keyword)} aria-label={`Select ${words}`} data-testid={`cell-${s}-${t}`.replace(/\s+/g, "-")} /><span className="sr-only">Select</span></label>
          <Link href={seoLinks.keywords(c.keyword, { ...marketParams(market), section: "volume" })} className={BLOCK_LINK} title={`"${c.keyword}": searches a month, in the Keywords explorer (nothing is bought)`} data-testid="link-cell-keyword"><BarFigure value={c.volume} max={maxVolume} color={PALETTE.keywords} align="start" width={40} /></Link>
          <Link href={seoLinks.explorer(d.domain, "keywords", { contains: c.keyword, ...marketParams(market) })} className={BLOCK_LINK} title={`${st.words} — the site's organic keywords in Site explorer, narrowed to this search`} data-testid="link-cell-position"><span className="rounded px-1.5 py-0.5 text-[12px] font-medium tabular-nums" style={{ background: st.bg, color: st.fg }}>{st.label}{c.home ? " ⌂" : ""}</span></Link>
        </div>
        {isTracked && site && <Link href={seoLinks.rankTracker(site.id, { keyword: c.keyword })} className={`${TEXT_LINK} text-[12px]`} title={`"${c.keyword}" is tracked on ${site.domain} — its weekly checks`} data-testid="link-cell-tracker">Rank tracker</Link>}
      </div>
    );
  };

  if (!site) return <Empty testId="planner-no-site"><h3>Add your site first</h3><p>The table shows where <i>your</i> site ranks for each service in each town, so it needs a site — add one above.</p></Empty>;
  return (
    <div data-testid="service-planner">
      <form className="mb-3 grid gap-3 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); if (draftS.length && draftT.length && !tooMany && !tooLong) {
          setAsked({ services: draftS, towns: draftT }); setPicked(new Set());
          // Pressing "Build" is what makes these the inputs to remember — also when the table itself is already saved.
          void api("POST", base, { services: draftS, towns: draftT, peek: true, remember: true }).catch(() => {}).then(() => void qc.invalidateQueries({ queryKey: [base], exact: true }));
        } }} data-testid="form-planner">
        <label className="block text-[13px]"><span className="g-text-2">Your services — one per line, as a customer would search (up to {MAX_SERVICES})</span>
          <textarea className="g-input mt-1 min-h-[120px] w-full py-2" value={services} onChange={(e) => setServices(e.target.value)} placeholder={"siding contractor\nroof repair\nwindow replacement\ngutters"} data-testid="textarea-planner-services" />
        </label>
        <label className="block text-[13px]"><span className="g-text-2">Towns you serve — one per line (up to {MAX_TOWNS})</span>
          <textarea className="g-input mt-1 min-h-[120px] w-full py-2" value={towns} onChange={(e) => setTowns(e.target.value)} placeholder={"bellingham\nlynden\nferndale\nmount vernon"} data-testid="textarea-planner-towns" />
        </label>
        <div className="flex flex-wrap items-center gap-2 sm:col-span-2">
          <Button type="submit" disabled={!draftS.length || !draftT.length || tooMany || !!tooLong} data-testid="button-planner-prepare">Build the table{cells ? ` — ${cells} search${cells === 1 ? "" : "es"}` : ""}</Button>
          <span className="g-text-2 text-[13px]" data-testid="text-planner-cost">
            {tooMany ? <span style={{ color: "var(--g-red)" }}>Up to {MAX_SERVICES} services, {MAX_TOWNS} towns and {MAX_CELLS} searches in one table — shorten a list.</span>
              : tooLong ? <span style={{ color: "var(--g-red)" }}>"{tooLong}" is too long to look up (up to {MAX_CHARS} characters and {MAX_WORDS} words) — shorten that service or town.</span>
              : cells && quote.data?.quoteCents != null ? <>Up to <Link href={seoLinks.usage()} className={TEXT_LINK} title="Usage and credit: what lookups cost and what is left this month" data-testid="link-planner-price">{money(quote.data.quoteCents)}</Link> of your SEO data for {site.domain} (you pay for what comes back); reopening the same table within a day is free.</> : `Every service is paired with every town for ${site.domain}.`}
          </span>
        </div>
      </form>

      {last.isError && !asked && <p className="g-text-2 mb-3 text-[13px]" role="status" data-testid="planner-last-error">Couldn't load the services and towns you used last time ({apiErrorMessage(last.error)}). <button type="button" className="g-link" onClick={() => void last.refetch()}>Try again</button> — or type them in.</p>}
      {asked && saved.isLoading && <p className="g-text-2 flex items-center gap-2 text-[14px]" role="status"><Loader2 className="h-4 w-4 animate-spin" /> Checking for a saved table…</p>}
      {asked && saved.isError && <div className="g-callout" role="alert"><h3>Couldn't check for a saved table</h3><p>{apiErrorMessage(saved.error)} Nothing has been charged.</p><button type="button" className="g-pill mt-2" onClick={() => void saved.refetch()}>Try again</button></div>}
      {!asked && <Empty testId="planner-intro"><h3>Which service, in which town, needs a page?</h3><p>List what you do and where you do it. For every pairing — "roof repair lynden", "siding ferndale" — you get how often it is searched and where the keyword database has {site.domain} ranking for it. Red cells are searches people make for which the database has no ranking for you in its first 100.</p></Empty>}
      {asked && saved.isSuccess && !d && (
        <Empty testId="planner-not-run">
          <h3>{askedCells} search{askedCells === 1 ? "" : "es"} ready to check</h3>
          <p>{askedQuote.isLoading ? "Getting the price…" : !priced ? <>Couldn't get the price for this table, so it can't be bought yet. <button type="button" className="g-link" onClick={() => void askedQuote.refetch()}>Try again</button></> : !canPay ? "You don't have enough SEO data left — add credit above." : "Nothing has been charged yet."}</p>
          <Button className="mt-2" disabled={run.isPending || !status?.configured || !canPay || !body} onClick={() => body && run.mutate({ url: base, body, key: queryKey, again: false })} data-testid="button-planner-run">
            {run.isPending ? <><Loader2 className="mr-1 h-4 w-4 animate-spin" /> Checking…</> : <><Play className="mr-1 h-4 w-4" /> Get the numbers{price != null ? ` — up to ${money(price)}` : ""}</>}
          </Button>
        </Empty>
      )}
      {d && stale && <Empty testId="planner-stale"><h3>This table was made for another country</h3><p>{site.domain} is now set to {market.label}; the saved table is not shown as its numbers.</p><Button className="mt-2" disabled={run.isPending || !status?.configured || !canPay || !body} onClick={() => body && run.mutate({ url: base, body, key: queryKey, again: true })} data-testid="button-planner-rebuild">{run.isPending ? "Checking…" : `Build it for ${market.label}${price != null ? ` — up to ${money(price)}` : ""}`}</Button></Empty>}
      {d && !stale && (
        <>
          <Card className="mb-3">
            {/* Each tile is a link to the grid narrowed to the cells it counts (links.ts `show`). */}
            <MetricRow cols={4}>
              {/* A tile with no figure ("—", a part that didn't load) is no link: there are no cells for it to open. */}
              <MetricColumn label="Gaps" value={d.summary.gaps == null ? "—" : <Link href={showAt("gaps")} className={FIG_LINK} title="Only the gaps in the grid" data-testid="link-planner-gaps">{fmtNum(d.summary.gaps)}</Link>} foot={d.summary.gaps == null ? (rankingsKnown ? "the search volumes didn't load" : "your rankings didn't load") : <Link href={showAt("gaps")} className={TEXT_LINK} data-testid="link-planner-gaps-volume">searched {fmtNum(d.summary.gapVolume)} times a month between them</Link>} testId="tile-planner-gaps" />
              <MetricColumn label="Beyond the first three" value={d.summary.weak == null ? "—" : <Link href={showAt("weak")} className={FIG_LINK} title="Only these cells in the grid" data-testid="link-planner-weak">{fmtNum(d.summary.weak)}</Link>} foot={d.summary.weak == null ? "your rankings didn't load" : <Link href={showAt("weak")} className={TEXT_LINK} title="Only these cells in the grid" data-testid="link-planner-weak-foot">ranked in the keyword database, with room to move up</Link>} testId="tile-planner-weak" />
              <MetricColumn label="In the first three" value={d.summary.strong == null ? "—" : <Link href={showAt("strong")} className={FIG_LINK} title="Only these cells in the grid" data-testid="link-planner-strong">{fmtNum(d.summary.strong)}</Link>} foot={d.summary.strong == null ? "your rankings didn't load" : <Link href={showAt("strong")} className={TEXT_LINK} title="Only these cells in the grid" data-testid="link-planner-strong-foot">ranked in the first three in the keyword database</Link>} testId="tile-planner-strong" />
              <MetricColumn label="Nothing known" value={d.summary.unknown == null ? "—" : <Link href={showAt("unknown")} className={FIG_LINK} title="Only these cells in the grid" data-testid="link-planner-unknown">{fmtNum(d.summary.unknown)}</Link>} foot={d.summary.unknown == null ? "part of the table didn't load" : <Link href={showAt("unknown")} className={TEXT_LINK} title="Only these cells in the grid" data-testid="link-planner-unknown-foot">too few searches to measure</Link>} testId="tile-planner-unknown" />
            </MetricRow>
          </Card>
          {show && <ActiveFilter onClear={() => setParam("show", null)} clearLabel="Every cell">{showWords(show)}</ActiveFilter>}
          {serviceParam && <ActiveFilter onClear={() => setParam("service", null)} clearLabel="Every service">{serviceOn ? `Only the service “${serviceOn}” — its row of ${fmtNum(shownTowns.length)} cell${shownTowns.length === 1 ? "" : "s"}` : `No service “${serviceParam}” in this table — every service is shown`}</ActiveFilter>}
          {townParam && <ActiveFilter onClear={() => setParam("town", null)} clearLabel="Every town">{townOn ? `Only the town “${townOn}” — its column of ${fmtNum(shownServices.length)} cell${shownServices.length === 1 ? "" : "s"}` : `No town “${townParam}” in this table — every town is shown`}</ActiveFilter>}
          <p className="g-text-2 mb-2 text-[13px]" data-testid="text-planner-meta">
            {/* The grid's size opens every cell (no tile's narrowing), the site its Site explorer, the date that month's lookups on the Usage page. */}
            <Link href={showAt(undefined)} className={TEXT_LINK} title="Every cell of the grid" data-testid="link-planner-size">{d.services.length} service{d.services.length === 1 ? "" : "s"} × {d.towns.length} town{d.towns.length === 1 ? "" : "s"}</Link>
            {" for "}<Link href={seoLinks.explorer(d.domain)} className={TEXT_LINK} title={`${d.domain} in Site explorer`} data-testid="link-planner-domain">{d.domain}</Link> · {market.label} ·{" "}
            <Link href={seoLinks.usage({ month: d.fetchedAt.slice(0, 7) })} className={TEXT_LINK} title="When this table was checked — that month's lookups on the Usage page" data-testid="link-planner-as-of">as of {fmtDate(d.fetchedAt)}</Link> ·{" "}
            <button type="button" className="g-link min-h-11" disabled={run.isPending || !canPay || !status?.configured || !body} onClick={() => body && run.mutate({ url: base, body, key: queryKey, again: true })} data-testid="button-planner-refresh">{run.isPending ? "Checking…" : `Check again${price != null ? ` — up to ${money(price)}` : ""}`}</button>
          </p>
          {d.missing.length > 0 && <p className="mb-2 text-[13px]" role="status" style={{ color: "var(--g-red)" }} data-testid="text-planner-missing">{d.missing.includes("rankings") ? "Your rankings" : "The search volumes"} didn't load this time and {d.missing.length === 1 ? "that part was" : "those parts were"} not charged — the cells show what did load. Check again to fill it in.</p>}
          <div className="mb-2 flex flex-wrap items-center gap-2">
            {rankingsKnown && gaps.length > 0 && <button type="button" className={PILL} onClick={() => setPicked(new Set(gaps.map((c) => c.keyword)))} data-testid="button-planner-pick-gaps">Select the {gaps.length} gap{gaps.length === 1 ? "" : "s"}</button>}
            {picked.size > 0 && <button type="button" className={PILL} onClick={() => setPicked(new Set())}>Clear</button>}
            <span className="ml-auto flex flex-wrap items-center gap-2">
              {chosen.length > 0 && <AddToPlan siteId={site.id} onDone={() => setPicked(new Set())} tasks={chosen.map((c): PlanTask => c.position === null
                ? !rankingsKnown ? { kind: "other" as const, title: `Check where we rank for "${c.keyword}"`, target: c.keyword, facts: { volume: c.volume }, source: `check:${c.keyword}` }
                : { kind: "page" as const, title: `Write a page for "${c.keyword}"`, target: c.keyword, facts: { volume: c.volume }, source: `area:${c.keyword}` }
                : { kind: "keyword" as const, title: `Move "${c.keyword}" up from position ${c.position}`, target: c.url ?? c.keyword, facts: { position: c.position, volume: c.volume }, source: `kw:${c.keyword}` })} />}
              {chosen.length > 0 && <AddToList market={market} rows={chosen.map((c) => ({ keyword: c.keyword, volume: c.volume, cpc: c.cpc, difficulty: c.difficulty }))} onDone={() => setPicked(new Set())} />}
              {chosen.length > 0 && onTrack && <Button size="sm" title={`Tracked weekly for ${market.label} as a whole — not searched from each town. To check from a town, add the keyword in the rank tracker with that town as its place.`} onClick={() => onTrack(chosen.map((c) => ({ keyword: c.keyword, volume: c.volume, cpc: c.cpc, difficulty: c.difficulty })))} data-testid="button-planner-track">Track {chosen.length} on {site.domain}</Button>}
              <button type="button" className={PILL} onClick={exportCsv} data-testid="button-planner-export"><Download /> Export</button>
            </span>
          </div>
          {/* A wide screen: the grid as a table (services down, towns across). A phone: one card per town, its services as rows — nothing scrolls sideways. One of the two is drawn, so every test id is on the page once. */}
          {!phone ? (
          <div className="overflow-x-auto">
            <table className="g-table" data-testid="table-planner">
              <caption className="sr-only">Each cell is the search made of the service in its row and the town in its column: searches a month and your position in the keyword database. Select cells to act on them. A row's or a column's heading narrows the grid to it.</caption>
              <thead><tr><th scope="col">Service</th>{shownTowns.map((t) => <th key={t} scope="col" className="capitalize"><Link href={townHref(t)} className={`${TEXT_LINK} capitalize`} title={townOn === t ? "Every town again" : `Only the town “${t}”`} data-testid={`link-planner-town-${idOf(t)}`}>{t}</Link></th>)}</tr></thead>
              <tbody>{shownServices.map((s) => (
                <tr key={s}>
                  <th scope="row" className="text-left font-medium capitalize"><Link href={serviceHref(s)} className={`${TEXT_LINK} capitalize`} title={serviceOn === s ? "Every service again" : `Only the service “${s}”`} data-testid={`link-planner-service-${idOf(s)}`}>{s}</Link></th>
                  {shownTowns.map((t) => <td key={t} data-label={t}>{cellBox(s, t)}</td>)}
                </tr>
              ))}</tbody>
            </table>
          </div>
          ) : (
          <ul className="space-y-3" aria-label="The grid, one card per town" data-testid="planner-cards">
            {shownTowns.map((t) => (
              <li key={t} className="min-w-0 rounded-xl border p-3" style={{ borderColor: "var(--g-divider)", background: "var(--g-surface)" }} data-testid={`planner-card-${idOf(t)}`}>
                <h4 className="text-[14px] font-medium"><Link href={townHref(t)} className={`${TEXT_LINK} capitalize`} title={townOn === t ? "Every town again" : `Only the town “${t}”`} data-testid={`link-planner-town-${idOf(t)}`}>{t}</Link></h4>
                <ul>{shownServices.map((s) => (
                  <li key={s} className="flex min-w-0 items-center justify-between gap-2 border-t py-1" style={{ borderColor: "var(--g-divider)" }}>
                    <Link href={serviceHref(s)} className={`${TEXT_LINK} min-w-0 capitalize [overflow-wrap:anywhere]`} title={serviceOn === s ? "Every service again" : `Only the service “${s}”`} data-testid={`link-planner-card-service-${idOf(t)}-${idOf(s)}`}>{s}</Link>
                    <div className="shrink-0">{cellBox(s, t)}</div>
                  </li>
                ))}</ul>
              </li>
            ))}
          </ul>
          )}
          <ul className="g-text-2 mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[12px]" aria-label="What the cells show">
            <li>Left: searches a month</li><li>Right: your position</li>
            {/* Each colour leads to the grid narrowed to its cells — 4–10 and 11–100 together (the tiles' "beyond the first three"; the grid can't split them), and the title says so. */}
            {([[PALETTE.top3, "1–3", "strong", "Only the cells in the first three"], [PALETTE.top10, "4–10", "weak", "Only the cells beyond the first three (4–10 and 11–100 together)"], [PALETTE.rest, "11–100", "weak", "Only the cells beyond the first three (4–10 and 11–100 together)"], [GAP_RED, "Gap: searched, no ranking found", "gaps", "Only the gaps"]] as const).map(([col, l, to, title]) => <li key={l}><Link href={showAt(to)} className={`${TEXT_LINK} inline-flex items-center gap-1`} title={title} data-testid={`link-planner-legend-${l === "1–3" ? "top3" : l === "4–10" ? "4-10" : l === "11–100" ? "11-100" : "gap"}`}><span className="inline-block h-3 w-3 rounded" style={{ background: col }} aria-hidden /> {l}</Link></li>)}
            <li>⌂ your home page is what ranks</li><li><Link href={showAt("unknown")} className={TEXT_LINK} title="Only the cells where nothing is known" data-testid="link-planner-legend-unknown">— too few searches to measure</Link></li>
          </ul>
          <p className="g-text-2 mt-2 text-[12px]">Searches a month are counted across {market.label} for those exact words, not just near you — a town name that another state also has counts both. Positions are estimates from the keyword database, not live checks, and "no ranking found" means the database has none in its first 100 — not proof there is none. "Track" checks a search every week for {market.label} as a whole; to have it checked from a town, add it in the rank tracker with that town as its place.</p>
        </>
      )}
    </div>
  );
}
