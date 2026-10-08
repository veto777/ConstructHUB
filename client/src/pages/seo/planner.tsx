/**
 * Keywords explorer -> Service × town: the customer's services against the towns they serve.
 * Every cell is the search "service town": how often it is searched and where the site ranks for
 * it. Gaps and weak spots can be ticked and sent to the action plan, a list or the rank tracker.
 * See server/seo/planner.ts.
 */
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, Loader2, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiErrorMessage } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { api, Empty, fmtDate, fmtNum, isNotRunYet, money, Tile, type SeoSite, type SeoStatus } from "./shell";
import { AddToList, type KwRow } from "./keyword-lists";
import { AddToPlan, type PlanTask } from "./plan-button";
import { DEFAULT_MARKET, findMarket } from "@shared/seo-markets";

type Cell = { service: string; town: string; keyword: string; volume: number | null; difficulty: number | null; cpc: number | null; position: number | null; url: string | null; home: boolean };
type Data = { domain: string; fetchedAt: string; services: string[]; towns: string[]; cells: Cell[]; summary: { cells: number; gaps: number; gapVolume: number; weak: number; strong: number; unknown: number }; missing: string[] };
type Saved = { services: string[]; towns: string[] } | null;
const MAX_SERVICES = 12, MAX_TOWNS = 15, MAX_CELLS = 150;
const parse = (text: string) => [...new Set(text.split(/\n|,/).map((s) => s.toLowerCase().replace(/\s+/g, " ").trim()).filter((s) => s.length >= 2))];
const csvCell = (v: string | number | null) => { const s = v == null ? "" : String(v); return `"${(typeof v !== "number" && /^[=+\-@\t\r]/.test(s) ? `'${s}` : s).replace(/"/g, '""')}"`; };

/** What a cell says, in colour and in words (colour is never the only signal). */
function state(c: Cell, rankingsKnown: boolean): { bg: string; fg: string; label: string; words: string } {
  if (c.position !== null) {
    if (c.position <= 3) return { bg: "#188038", fg: "#fff", label: `#${c.position}`, words: `you rank ${c.position}` };
    if (c.position <= 10) return { bg: "#f9ab00", fg: "#202124", label: `#${c.position}`, words: `you rank ${c.position}, on page one` };
    return { bg: "#e8710a", fg: "#202124", label: `#${c.position}`, words: `you rank ${c.position}, beyond page one` };
  }
  if (!rankingsKnown) return { bg: "var(--g-divider)", fg: "var(--g-text)", label: "?", words: "your ranking didn't load" };
  if ((c.volume ?? 0) > 0) return { bg: "#c5221f", fg: "#fff", label: "Gap", words: "you do not rank in the first 100" };
  return { bg: "transparent", fg: "var(--g-text-2)", label: "—", words: "too few searches to measure, and you do not rank" };
}

export function ServicePlanner({ site, status, onTrack }: { site: SeoSite | null; status: SeoStatus | undefined; onTrack?: (rows: KwRow[]) => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const base = `/api/seo/sites/${site?.id}/planner`;
  const last = useQuery<{ saved: Saved }>({ queryKey: [base], enabled: !!site });
  const [services, setServices] = useState(""); const [towns, setTowns] = useState("");
  const [asked, setAsked] = useState<{ services: string[]; towns: string[] } | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  // Another site: its own last table, nothing of the previous site's.
  useEffect(() => { setServices(""); setTowns(""); setAsked(null); setPicked(new Set()); }, [site?.id]);
  // The services and towns used last time come back filled in, and their saved table opens free.
  useEffect(() => { const s = last.data?.saved; if (s && !asked && !services && !towns) { setServices(s.services.join("\n")); setTowns(s.towns.join("\n")); setAsked(s); } }, [last.data]); // eslint-disable-line react-hooks/exhaustive-deps
  const draftS = useMemo(() => parse(services), [services]), draftT = useMemo(() => parse(towns), [towns]);
  const cells = draftS.length * draftT.length;
  const tooMany = draftS.length > MAX_SERVICES || draftT.length > MAX_TOWNS || cells > MAX_CELLS;
  const body = useMemo(() => (asked ? { services: asked.services, towns: asked.towns } : null), [asked]);
  const queryKey = [base, body];
  const saved = useQuery<{ page: Data } | null>({
    queryKey, enabled: !!site && !!body, retry: false, staleTime: 5 * 60_000,
    queryFn: async () => { try { return await api("POST", base, { ...body, peek: true }); } catch (e) { if (isNotRunYet(e)) return null; throw e; } },
  });
  const run = useMutation({
    mutationFn: (v: { url: string; body: Record<string, unknown>; key: readonly unknown[]; again: boolean }) => api("POST", v.url, v.again ? { ...v.body, refresh: true } : v.body),
    onSuccess: (data: { page: Data; saved?: boolean }, v) => {
      qc.setQueryData(v.key, data); void qc.invalidateQueries({ queryKey: ["/api/seo/status"] });
      if (data.saved === false) toast({ title: "Shown, but it couldn't be kept", description: "Opening this table again will not be free. Export it now if you need it.", variant: "destructive" });
    },
    onError: (e) => toast({ title: "Couldn't build the table", description: apiErrorMessage(e), variant: "destructive" }),
  });
  const prices = status?.prices as Record<string, number | undefined> | undefined;
  const priceFor = (n: number) => (prices?.plannerBase != null && prices.plannerPer100 != null ? prices.plannerBase + Math.ceil((n / 100) * prices.plannerPer100) : null);
  const askedCells = asked ? asked.services.length * asked.towns.length : cells;
  const price = priceFor(askedCells);
  const canPay = price == null || !status?.credits || status.credits.availableCents === -1 || status.credits.availableCents >= price;
  const d = saved.data?.page ?? null;
  useEffect(() => { setPicked(new Set()); }, [d?.fetchedAt]);
  const rankingsKnown = !d?.missing.includes("rankings");
  const at = (service: string, town: string) => d?.cells.find((c) => c.service === service && c.town === town) ?? null;
  const chosen = (d?.cells ?? []).filter((c) => picked.has(c.keyword));
  const toggle = (k: string) => setPicked((s) => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; });
  const gaps = (d?.cells ?? []).filter((c) => c.position === null && (c.volume ?? 0) > 0);
  const market = site ? findMarket(site.locationCode, site.languageCode) ?? DEFAULT_MARKET : DEFAULT_MARKET;
  const exportCsv = () => d && (() => {
    const rows: (string | number | null)[][] = [["Service", "Town", "Search", "Searches / mo", "Difficulty", "Your position", "Your page"], ...d.cells.map((c) => [c.service, c.town, c.keyword, c.volume, c.difficulty, c.position, c.url])];
    const blob = new Blob([rows.map((l) => l.map(csvCell).join(",")).join("\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `${d.domain}-service-area.csv`; a.click(); URL.revokeObjectURL(a.href);
  })();

  if (!site) return <Empty testId="planner-no-site"><h3>Add your site first</h3><p>The table shows where <i>your</i> site ranks for each service in each town, so it needs a site — add one above.</p></Empty>;
  return (
    <div data-testid="service-planner">
      <form className="mb-3 grid gap-3 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); if (draftS.length && draftT.length && !tooMany) { setAsked({ services: draftS, towns: draftT }); setPicked(new Set()); } }} data-testid="form-planner">
        <label className="block text-[13px]"><span className="g-text-2">Your services — one per line, as a customer would search (up to {MAX_SERVICES})</span>
          <textarea className="g-input mt-1 min-h-[120px] w-full py-2" value={services} onChange={(e) => setServices(e.target.value)} placeholder={"siding contractor\nroof repair\nwindow replacement\ngutters"} data-testid="textarea-planner-services" />
        </label>
        <label className="block text-[13px]"><span className="g-text-2">Towns you serve — one per line (up to {MAX_TOWNS})</span>
          <textarea className="g-input mt-1 min-h-[120px] w-full py-2" value={towns} onChange={(e) => setTowns(e.target.value)} placeholder={"bellingham\nlynden\nferndale\nmount vernon"} data-testid="textarea-planner-towns" />
        </label>
        <div className="flex flex-wrap items-center gap-2 sm:col-span-2">
          <Button type="submit" disabled={!draftS.length || !draftT.length || tooMany} data-testid="button-planner-prepare">Build the table{cells ? ` — ${cells} search${cells === 1 ? "" : "es"}` : ""}</Button>
          <span className="g-text-2 text-[13px]" data-testid="text-planner-cost">
            {tooMany ? <span style={{ color: "var(--g-red)" }}>Up to {MAX_SERVICES} services, {MAX_TOWNS} towns and {MAX_CELLS} searches in one table — shorten a list.</span>
              : cells && priceFor(cells) != null ? `About ${money(priceFor(cells))} of your SEO data for ${site.domain}; reopening the same table within a day is free.` : `Every service is paired with every town for ${site.domain}.`}
          </span>
        </div>
      </form>

      {asked && saved.isLoading && <p className="g-text-2 flex items-center gap-2 text-[14px]" role="status"><Loader2 className="h-4 w-4 animate-spin" /> Checking for a saved table…</p>}
      {asked && saved.isError && <div className="g-callout" role="alert"><h3>Couldn't check for a saved table</h3><p>{apiErrorMessage(saved.error)} Nothing has been charged.</p><button type="button" className="g-pill mt-2" onClick={() => void saved.refetch()}>Try again</button></div>}
      {!asked && <Empty testId="planner-intro"><h3>Which service, in which town, needs a page?</h3><p>List what you do and where you do it. For every pairing — "roof repair lynden", "siding ferndale" — you get how often it is searched and where {site.domain} ranks for it. Red cells are searches people make that you do not show up for.</p></Empty>}
      {asked && saved.isSuccess && !d && (
        <Empty testId="planner-not-run">
          <h3>{askedCells} search{askedCells === 1 ? "" : "es"} ready to check</h3>
          <p>{!canPay ? "You don't have enough SEO data left — add credit above." : "Nothing has been charged yet."}</p>
          <Button className="mt-2" disabled={run.isPending || !status?.configured || !canPay || !body} onClick={() => body && run.mutate({ url: base, body, key: queryKey, again: false })} data-testid="button-planner-run">
            {run.isPending ? <><Loader2 className="mr-1 h-4 w-4 animate-spin" /> Checking…</> : <><Play className="mr-1 h-4 w-4" /> Get the numbers{price != null ? ` — about ${money(price)}` : ""}</>}
          </Button>
        </Empty>
      )}
      {d && (
        <>
          <div className="g-tiles mb-3">
            <Tile label="Gaps" value={rankingsKnown ? fmtNum(d.summary.gaps) : "—"} hint={rankingsKnown ? `searched ${fmtNum(d.summary.gapVolume)} times a month between them` : "your rankings didn't load"} testId="tile-planner-gaps" />
            <Tile label="Beyond the first three" value={fmtNum(d.summary.weak)} hint="you rank, with room to move up" testId="tile-planner-weak" />
            <Tile label="In the first three" value={fmtNum(d.summary.strong)} testId="tile-planner-strong" />
            <Tile label="Nothing known" value={fmtNum(d.summary.unknown)} hint="too few searches to measure" testId="tile-planner-unknown" />
          </div>
          <p className="g-text-2 mb-2 text-[13px]" data-testid="text-planner-meta">
            {d.services.length} service{d.services.length === 1 ? "" : "s"} × {d.towns.length} town{d.towns.length === 1 ? "" : "s"} for {d.domain} · {market.label} · as of {fmtDate(d.fetchedAt)} ·{" "}
            <button type="button" className="g-link" disabled={run.isPending || !canPay || !status?.configured || !body} onClick={() => body && run.mutate({ url: base, body, key: queryKey, again: true })} data-testid="button-planner-refresh">{run.isPending ? "Checking…" : `Check again${price != null ? ` — about ${money(price)}` : ""}`}</button>
          </p>
          {d.missing.length > 0 && <p className="mb-2 text-[13px]" role="status" style={{ color: "var(--g-red)" }} data-testid="text-planner-missing">{d.missing.includes("rankings") ? "Your rankings" : "The search volumes"} didn't load this time and {d.missing.length === 1 ? "that part was" : "those parts were"} not charged — the cells show what did load. Check again to fill it in.</p>}
          <div className="mb-2 flex flex-wrap items-center gap-2">
            {rankingsKnown && gaps.length > 0 && <button type="button" className="g-pill g-pill--sm" onClick={() => setPicked(new Set(gaps.map((c) => c.keyword)))} data-testid="button-planner-pick-gaps">Select the {gaps.length} gap{gaps.length === 1 ? "" : "s"}</button>}
            {picked.size > 0 && <button type="button" className="g-pill g-pill--sm" onClick={() => setPicked(new Set())}>Clear</button>}
            <span className="ml-auto flex flex-wrap items-center gap-2">
              {chosen.length > 0 && <AddToPlan siteId={site.id} onDone={() => setPicked(new Set())} tasks={chosen.map((c): PlanTask => c.position === null
                ? { kind: "page" as const, title: `Write a page for "${c.keyword}"`, target: c.keyword, facts: { volume: c.volume }, source: `area:${c.keyword}` }
                : { kind: "keyword" as const, title: `Move "${c.keyword}" up from position ${c.position}`, target: c.url ?? c.keyword, facts: { position: c.position, volume: c.volume }, source: `kw:${c.keyword}` })} />}
              {chosen.length > 0 && <AddToList market={market} rows={chosen.map((c) => ({ keyword: c.keyword, volume: c.volume, cpc: c.cpc, difficulty: c.difficulty }))} onDone={() => setPicked(new Set())} />}
              {chosen.length > 0 && onTrack && <Button size="sm" onClick={() => { onTrack(chosen.map((c) => ({ keyword: c.keyword, volume: c.volume, cpc: c.cpc, difficulty: c.difficulty }))); setPicked(new Set()); }} data-testid="button-planner-track">Track {chosen.length} on {site.domain}</Button>}
              <button type="button" className="g-pill g-pill--sm" onClick={exportCsv} data-testid="button-planner-export"><Download /> Export</button>
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="g-table" data-testid="table-planner">
              <caption className="sr-only">Each cell is the search made of the service in its row and the town in its column: searches a month and your position. Select cells to act on them.</caption>
              <thead><tr><th scope="col">Service</th>{d.towns.map((t) => <th key={t} scope="col" className="capitalize">{t}</th>)}</tr></thead>
              <tbody>{d.services.map((s) => (
                <tr key={s}>
                  <th scope="row" className="text-left font-medium capitalize">{s}</th>
                  {d.towns.map((t) => { const c = at(s, t); if (!c) return <td key={t}>—</td>; const st = state(c, rankingsKnown); const on = picked.has(c.keyword); return (
                    <td key={t} data-label={t}>
                      <button type="button" onClick={() => toggle(c.keyword)} aria-pressed={on} data-testid={`cell-${s}-${t}`.replace(/\s+/g, "-")}
                        aria-label={`${c.keyword}: ${c.volume != null ? `${fmtNum(c.volume)} searches a month` : "too few searches to measure"}; ${st.words}${c.home ? ", with your home page" : ""}`}
                        title={c.url ? `${c.keyword} → ${c.url.replace(/^https?:\/\/(www\.)?/, "")}` : c.keyword}
                        className="flex w-full min-w-[96px] items-center justify-between gap-2 rounded-md border px-2 py-1.5 text-left text-[13px]" style={{ borderColor: on ? "var(--g-blue, #1a73e8)" : "var(--g-divider)", outline: on ? "2px solid var(--g-blue, #1a73e8)" : undefined }}>
                        <span className="tabular-nums">{c.volume != null ? fmtNum(c.volume) : <span className="g-text-2">—</span>}</span>
                        <span className="rounded px-1.5 py-0.5 text-[12px] font-medium tabular-nums" style={{ background: st.bg, color: st.fg }}>{st.label}{c.home ? " ⌂" : ""}</span>
                      </button>
                    </td>
                  ); })}
                </tr>
              ))}</tbody>
            </table>
          </div>
          <ul className="g-text-2 mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[12px]" aria-label="What the cells show">
            <li>Left: searches a month</li><li>Right: your position</li>
            {[["#188038", "1–3"], ["#f9ab00", "4–10"], ["#e8710a", "11–100"], ["#c5221f", "Gap: searched, not ranking"]].map(([col, l]) => <li key={l} className="flex items-center gap-1"><span className="inline-block h-3 w-3 rounded" style={{ background: col }} aria-hidden /> {l}</li>)}
            <li>⌂ your home page is what ranks</li><li>— too few searches to measure</li>
          </ul>
          <p className="g-text-2 mt-2 text-[12px]">Searches a month are counted across {market.label} for those exact words, not just near you — a town name that another state also has counts both. Positions are estimates from the keyword database, not live checks: track a search to have it checked every week from the town itself.</p>
        </>
      )}
    </div>
  );
}
