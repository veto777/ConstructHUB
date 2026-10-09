/**
 * Content gap and Link intersect, inside Site Explorer. Pick up to three
 * competitors; the result is saved for a day (POST /api/seo/gap, peek first),
 * so reopening it costs nothing. The price is shown before anything is bought.
 * Every figure in the tables is a link to where its data lives (links.ts): a keyword, its volume, cost per click and
 * intent to its overview, its difficulty to who ranks for it, a competitor's position and "their traffic" to that
 * competitor's keyword list narrowed to the search, a site to its Site explorer, an authority to its referring domains,
 * a "Links to <competitor>" count (0 included) to that competitor's referring domains narrowed to the linking site —
 * the words of each say what the view holds. The date a comparison was run opens that month's lookups on the Usage page.
 * The comparison is the address's `competitors` (links.ts): read on arrival — the saved comparison opens, or the Run
 * button waits, nothing is bought — and written by "Compare", so the count above the table is a link to its own rows
 * and the back button returns to the comparison before; a chip says what the address asked for, with a clear.
 */
import { AddToPlan } from "./plan-button";
import { Link } from "wouter";
import { seoLinks, setParam } from "./links";
import { marketParams } from "./keyword-links";
import { INTENTS } from "./explorer-filters";
import { BLOCK_LINK, FIG_LINK, TEXT_LINK } from "./viz-keywords";
import { DEFAULT_MARKET, findMarket } from "@shared/seo-markets";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, Loader2, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiErrorMessage } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { ActiveFilter, api, Empty, fmtDate, fmtNum, isNotRunYet, kd, money, useAddress, type SeoStatus } from "./shell";
import { AddToList } from "./keyword-lists";

export type GapKind = "content" | "links";
type ContentRow = { keyword: string; volume: number | null; cpc: number | null; difficulty: number | null; intent: string | null; competitors: { domain: string; position: number | null; url: string | null }[]; traffic: number };
type LinkRow = { domain: string; authority: number | null; spamScore: number | null; links: { competitor: string; backlinks: number; firstSeen: string | null }[] };
type Page = { kind: GapKind; target: string; competitors: string[]; rows: (ContentRow | LinkRow)[]; total: number | null; limit: number; offset: number; missing: string[]; fetchedAt: string };
type TrackRow = { keyword: string; volume: number | null; cpc: number | null; difficulty: number | null };

const MAX = 3;
const clean = (d: string) => d.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/[/?#].*$/, "");
const looksLikeDomain = (d: string) => /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(d);
/** The address's `competitors` as a comparison: real domains only, not the site itself, no repeats, at most MAX; and what was left out. */
function competitorsOf(raw: string | null, domain: string): { list: string[]; dropped: string[] } {
  const list: string[] = [], dropped: string[] = [];
  for (const part of (raw ?? "").split(",").map((x) => x.trim()).filter(Boolean)) {
    const d = clean(part);
    if (!looksLikeDomain(d) || d === clean(domain) || list.length >= MAX) { if (!list.includes(d)) dropped.push(part); continue; }
    if (!list.includes(d)) list.push(d);
  }
  return { list, dropped };
}
/** Quoted, and a cell from the open web is never allowed to run as a spreadsheet formula. */
const csvCell = (v: string | number | null) => { const s = v == null ? "" : String(v); return `"${(typeof v !== "number" && /^[=+\-@\t\r]/.test(s) ? `'${s}` : s).replace(/"/g, '""')}"`; };
function downloadCsv(name: string, rows: (string | number | null)[][]) {
  const blob = new Blob([rows.map((r) => r.map(csvCell).join(",")).join("\n")], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = name; a.click();
  URL.revokeObjectURL(a.href);
}

export function GapView({ kind, domain, status, suggestions, onExplore, onTrack, market, planSiteId }: {
  /** The customer's own site, when this report is about it: findings can go to its action plan. */
  planSiteId?: number;
  /** Content gap only: the country to compare in (United States when absent). Links are the same everywhere. */
  market?: { locationCode: number; languageCode: string };
  kind: GapKind; domain: string; status: SeoStatus | undefined;
  /** Likely competitors to offer (the report's organic competitors). */
  suggestions: string[];
  onExplore?: (domain: string) => void;
  /** Content gap: track the ticked keywords (the page supplies the site). */
  onTrack?: (rows: TrackRow[]) => void;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  // The comparison is the address's `competitors` (links.ts): a link to it and a press of Compare are one thing.
  const competitorsParam = useAddress().get("competitors");
  const wanted = useMemo(() => competitorsOf(competitorsParam, domain), [competitorsParam, domain]);
  const wantedKey = wanted.list.join(",");
  const [draft, setDraft] = useState<string[]>(wanted.list);
  const [input, setInput] = useState("");
  const [applied, setApplied] = useState<string[]>(wanted.list);
  const [offset, setOffset] = useState(0);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const limit = 50;
  // A different report or site starts as the address says (clean when it names no competitors); so does a link
  // followed, or the back button, while this view is open. Arriving only looks for a saved comparison.
  useEffect(() => { setDraft(wanted.list); setApplied(wanted.list); setInput(""); setOffset(0); setPicked(new Set()); }, [kind, domain, wantedKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const loc = market && kind === "content" ? market.locationCode : undefined, lang = market && kind === "content" ? market.languageCode : undefined;
  const body = useMemo(() => ({ kind, domain, competitors: applied, ...(kind === "links" ? { limit, offset } : {}), ...(loc ? { locationCode: loc, languageCode: lang } : {}) }), [kind, domain, applied, offset, loc, lang]);
  const queryKey = ["/api/seo/gap", body];
  const saved = useQuery<{ page: Page } | null>({
    queryKey, enabled: applied.length > 0, retry: false, staleTime: 5 * 60_000,
    queryFn: async () => { try { return await api("POST", "/api/seo/gap", { ...body, peek: true }); } catch (e) { if (isNotRunYet(e)) return null; throw e; } },
  });
  const run = useMutation({
    mutationFn: (v: { body: Record<string, unknown>; key: readonly unknown[]; again: boolean }) => api("POST", "/api/seo/gap", v.again ? { ...v.body, refresh: true } : v.body),
    onSuccess: (data: { page: Page; saved?: boolean }, v) => {
      qc.setQueryData(v.key, data); void qc.invalidateQueries({ queryKey: ["/api/seo/status"] });
      if (data.saved === false) toast({ title: "Shown, but it couldn't be kept", description: "Opening this comparison again will not be free. Export it now if you need it.", variant: "destructive" });
    },
    onError: (e) => toast({ title: "Couldn't run the comparison", description: apiErrorMessage(e), variant: "destructive" }),
  });

  const add = (raw: string) => {
    const d = clean(raw);
    if (!d) return;
    if (!looksLikeDomain(d)) return void toast({ title: "Enter a domain like competitor.com", variant: "destructive" });
    if (d === clean(domain)) return void toast({ title: "That is the site you are analysing", description: "Add a competitor's domain instead.", variant: "destructive" });
    if (draft.includes(d)) return setInput("");
    if (draft.length >= MAX) return void toast({ title: `Up to ${MAX} competitors at a time`, variant: "destructive" });
    setDraft([...draft, d]); setInput("");
  };
  const offers = suggestions.map(clean).filter((s) => s && s !== clean(domain) && !draft.includes(s)).slice(0, 6);
  const priceFor = (n: number) => status?.prices ? (kind === "content" ? status.prices.competitorGap * Math.max(1, n) : status.prices.linkIntersect ?? null) : null;
  // Two different things: what the list being edited would cost, and what the comparison on screen costs to run.
  const draftPrice = priceFor(draft.length), priceCents = priceFor(applied.length);
  const available = status?.credits?.availableCents;
  const affordable = priceCents == null || available == null || available === -1 || available >= priceCents;
  const page = saved.data?.page ?? null;
  const dirty = draft.join(",") !== applied.join(",");
  /** Compare: the list being edited becomes the comparison, and the address says so (one step for the back button). */
  const compare = () => { setApplied(draft); setOffset(0); setPicked(new Set()); setParam("competitors", draft.join(",")); };
  /** This comparison's own address: the rows its count counts. */
  const comparisonHref = seoLinks.explorer(domain, kind === "content" ? "contentGap" : "linkIntersect", { competitors: applied.join(",") || undefined, ...(kind === "content" && market && market.locationCode !== DEFAULT_MARKET.locationCode ? { locationCode: market.locationCode } : {}) });
  const toggle = (k: string) => setPicked((s) => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; });
  const what = kind === "content" ? "keywords these competitors rank for on Google that this site doesn't" : "websites that link to every competitor you name but not to this site";
  /** Where a keyword's figures lead: its overview in the comparison's country, or one part of it. */
  const kw = (keyword: string, extra: Parameters<typeof seoLinks.keywords>[1] = {}) => seoLinks.keywords(keyword, { ...marketParams(market), ...extra });
  /** A competitor's own keyword list in Site explorer, narrowed to one search: where its position and its visits come from. */
  const theirs = (competitor: string, keyword: string) => seoLinks.explorer(competitor, "keywords", { contains: keyword, ...(market && market.locationCode !== DEFAULT_MARKET.locationCode ? { locationCode: market.locationCode } : {}) });
  /** The competitor placed best for a keyword: its list is where most of "their traffic" is. */
  const bestOf = (r: ContentRow) => [...r.competitors].filter((c) => c.position != null).sort((a, b) => a.position! - b.position!)[0]?.domain ?? r.competitors[0]?.domain ?? null;
  /** A competitor's referring domains in Site explorer, narrowed to one linking site: the row that counts its links. */
  const linksTo = (competitor: string, linking: string) => seoLinks.explorer(competitor, "referringDomains", { contains: linking });
  const exportRows = () => {
    if (!page) return;
    const name = `${clean(domain)}-${kind === "content" ? "content-gap" : "link-intersect"}.csv`;
    if (kind === "content") downloadCsv(name, [["Keyword", "Volume", "Difficulty", "CPC", "Intent", ...page.competitors.map((c) => `${c} position`), "Competitor traffic"],
      ...(page.rows as ContentRow[]).map((r) => [r.keyword, r.volume, r.difficulty, r.cpc, r.intent, ...page.competitors.map((c) => r.competitors.find((x) => x.domain === c)?.position ?? null), r.traffic])]);
    else downloadCsv(name, [["Linking site", "Authority", "Spam score", ...page.competitors.map((c) => `Links to ${c}`)],
      ...(page.rows as LinkRow[]).map((r) => [r.domain, r.authority, r.spamScore, ...page.competitors.map((c) => r.links.find((x) => x.competitor === c)?.backlinks ?? 0)])]);
  };

  return (
    <div data-testid={`gap-${kind}`}>
      <p className="g-text-2 mb-3 text-[13px]">{kind === "content" ? "Content gap" : "Link intersect"} finds {what}. {kind === "content" ? "Each one is a page or service you could add." : "They already link to businesses like yours — the best places to ask for a link."}</p>
      <form className="mb-2 flex flex-col gap-2 sm:flex-row sm:items-center" onSubmit={(e) => { e.preventDefault(); add(input); }} data-testid={`form-gap-${kind}`}>
        <label className="min-w-0 flex-1 sm:max-w-sm"><span className="sr-only">Competitor's domain</span>
          <input className="g-input w-full" placeholder="competitor.com" value={input} onChange={(e) => setInput(e.target.value)} disabled={draft.length >= MAX} autoComplete="off" data-testid="input-gap-competitor" />
        </label>
        <button type="submit" className="g-pill" disabled={!input.trim() || draft.length >= MAX} data-testid="button-gap-add"><Plus /> Add competitor</button>
      </form>
      {draft.length > 0 && (
        <ul className="mb-2 flex flex-wrap gap-1.5" aria-label="Competitors to compare" data-testid="list-gap-competitors">
          {draft.map((d) => <li key={d} className="g-chip g-chip--sm" style={{ textTransform: "none" }}>{d} <button type="button" className="-my-3 -mr-2 ml-0.5 inline-grid min-h-11 min-w-11 place-items-center rounded-full hover:bg-[var(--g-hover)]" aria-label={`Remove ${d}`} onClick={() => setDraft(draft.filter((x) => x !== d))}><X className="h-3 w-3" /></button></li>)}
        </ul>
      )}
      {offers.length > 0 && draft.length < MAX && (
        <p className="g-text-2 mb-3 flex flex-wrap items-center gap-1.5 text-[12px]">Sites competing for the same searches:
          {offers.map((s) => <button key={s} type="button" className="g-pill g-pill--sm !min-h-11" onClick={() => add(s)} data-testid={`button-gap-suggest-${s}`}>+ {s}</button>)}
        </p>
      )}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Button type="button" disabled={!draft.length || (!dirty && applied.length > 0)} onClick={compare} data-testid="button-gap-compare">Compare{draft.length ? ` with ${draft.length} competitor${draft.length === 1 ? "" : "s"}` : ""}</Button>
        <span className="g-text-2 text-[13px]">{draftPrice != null ? <>A new comparison costs about <Link href={seoLinks.usage()} className={TEXT_LINK} title="Usage and credit: what lookups cost and what is left this month" data-testid="link-gap-price">{money(draftPrice)}</Link> of your SEO data{kind === "content" ? " (one per competitor)" : ""}; reopening it within a day is free.</> : ""}</span>
      </div>

      {(competitorsParam ?? "") !== "" && (
        <ActiveFilter onClear={() => { setDraft([]); setApplied([]); setParam("competitors", null); }} clearLabel="Start over">
          {wanted.list.length ? `${kind === "content" ? "Content gap" : "Link intersect"}: ${domain} compared with ${wanted.list.join(", ")}` : "No competitor in the address could be used"}
          {wanted.dropped.length > 0 && ` — left out: ${wanted.dropped.join(", ")} (not a domain, the site itself, or more than ${MAX})`}
        </ActiveFilter>
      )}
      {applied.length === 0 && <Empty testId="gap-intro"><h3>Add up to {MAX} competitors</h3><p>Type a competitor's website{offers.length ? " or pick one above" : ""}, then press <b>Compare</b>.</p></Empty>}
      {applied.length > 0 && saved.isLoading && <p className="g-text-2 flex items-center gap-2 text-[14px]" role="status"><Loader2 className="h-4 w-4 animate-spin" /> Checking for a saved comparison…</p>}
      {applied.length > 0 && saved.isError && <div className="g-callout" role="alert" data-testid="gap-saved-error"><h3>Couldn't check for a saved comparison</h3><p>{apiErrorMessage(saved.error)}</p><button type="button" className="g-pill mt-2" onClick={() => void saved.refetch()}>Try again</button></div>}
      {applied.length > 0 && saved.isSuccess && !page && (
        <Empty testId="gap-not-run">
          <h3>Compare {domain} with {applied.join(", ")}</h3>
          <p>This {offset > 0 ? "page" : "comparison"} hasn't been run yet.{!affordable && " You don't have enough SEO data left — add credit above."}{dirty && " You changed the competitors above — press Compare to use the new list."}</p>
          <Button className="mt-2" disabled={run.isPending || !status?.configured || !affordable || dirty} onClick={() => run.mutate({ body, key: queryKey, again: false })} data-testid="button-gap-run">
            {run.isPending ? <><Loader2 className="mr-1 h-4 w-4 animate-spin" /> Comparing…</> : `Run comparison${priceCents != null ? ` — about ${money(priceCents)}` : ""}`}
          </Button>
        </Empty>
      )}

      {page && (
        <>
          <div className="mb-2 flex flex-wrap items-center gap-2 text-[13px]">
            {/* The count is this comparison's own address (the rows beneath it — no other view holds them); the date is when it was bought, in that month's ledger. */}
            <span className="g-text-2" data-testid="text-gap-meta">
              <Link href={comparisonHref} className={TEXT_LINK} title={kind === "content" ? "This comparison's own address — every keyword found, the rows below" : "This comparison's own address — the sites found, the rows below (it opens at the first page)"} data-testid="link-gap-count">{kind === "content" ? `${fmtNum(page.rows.length)} keywords` : `${fmtNum(page.offset + 1)}–${fmtNum(page.offset + page.rows.length)}${page.total != null ? ` of ${fmtNum(page.total)}` : ""} sites`}</Link> · <Link href={seoLinks.usage({ month: page.fetchedAt.slice(0, 7) })} className={TEXT_LINK} title="When this comparison was run — that month's lookups on the Usage page" data-testid="link-gap-as-of">as of {fmtDate(page.fetchedAt)}</Link>
            </span>
            <button type="button" className="g-pill g-pill--sm !min-h-11 ml-auto" onClick={exportRows} disabled={!page.rows.length} data-testid="button-gap-export"><Download /> Export</button>
            {kind === "content" && <AddToList market={market ? findMarket(market.locationCode, market.languageCode) ?? undefined : undefined} rows={(page.rows as ContentRow[]).filter((r) => picked.has(r.keyword)).map((r) => ({ keyword: r.keyword, volume: r.volume, cpc: r.cpc, difficulty: r.difficulty, intent: r.intent }))} onDone={() => setPicked(new Set())} />}
            {kind === "content" && planSiteId != null && picked.size > 0 && <AddToPlan siteId={planSiteId} onDone={() => setPicked(new Set())} tasks={(page.rows as ContentRow[]).filter((r) => picked.has(r.keyword)).map((r) => ({ kind: "page" as const, title: `Write or improve a page for "${r.keyword}"`, target: r.keyword, facts: { volume: r.volume }, source: `gap:${r.keyword}` }))} />}
            {kind === "content" && onTrack && <button type="button" className="g-pill g-pill--sm !min-h-11" disabled={!picked.size} onClick={() => { onTrack((page.rows as ContentRow[]).filter((r) => picked.has(r.keyword)).map((r) => ({ keyword: r.keyword, volume: r.volume, cpc: r.cpc, difficulty: r.difficulty }))); setPicked(new Set()); }} data-testid="button-gap-track"><Plus /> Add {picked.size || ""} to rank tracker</button>}
          </div>
          {page.missing.length > 0 && <p className="g-text-2 mb-2 text-[13px]" role="status" data-testid="text-gap-missing">{page.missing.join(", ")} didn't load this time, so {page.missing.length === 1 ? "it is" : "they are"} not in this comparison. <button type="button" className="g-link" disabled={run.isPending || !affordable} onClick={() => run.mutate({ body, key: queryKey, again: true })} data-testid="button-gap-retry">{run.isPending ? "Trying again…" : `Try again${priceCents != null ? ` — about ${money(priceCents)}` : ""}`}</button></p>}
          {kind === "content" && <p className="g-text-2 mb-2 text-[12px]">Built from each competitor's 100 highest-traffic keywords that {domain} doesn't rank for. Keywords more than one competitor ranks for come first.</p>}
          {page.rows.length === 0 ? (
            <Empty testId="gap-empty"><h3>Nothing found</h3><p>{kind === "content" ? `No keyword these competitors rank for that ${domain} doesn't.` : `No site links to ${page.competitors.length > 1 ? "all of these competitors" : "this competitor"} without also linking to ${domain}. Try fewer competitors.`}</p></Empty>
          ) : kind === "content" ? (
            <div className="overflow-x-auto">
              <table className="g-table" data-testid="table-gap-content">
                <thead><tr><th aria-label="Select" /><th>Keyword</th><th className="num">Volume / mo</th><th className="num">Difficulty</th><th className="num">CPC</th>{page.competitors.map((c) => <th key={c} className="num">{c}</th>)}<th className="num">Their traffic</th></tr></thead>
                <tbody>
                  {(page.rows as ContentRow[]).map((r) => (
                    <tr key={r.keyword}>
                      <td><input type="checkbox" aria-label={`Select ${r.keyword}`} checked={picked.has(r.keyword)} onChange={() => toggle(r.keyword)} /></td>
                      <td><Link href={kw(r.keyword)} className={TEXT_LINK} title="This keyword's overview (the saved one, or the Look up button)" data-testid="link-gap-keyword">{r.keyword}</Link>{r.intent && <> <Link href={kw(r.keyword, { section: "ideas", table: "matchingTerms", intent: (INTENTS as readonly string[]).includes(r.intent) ? r.intent : undefined })} className={`${FIG_LINK} g-text-2 text-[12px] capitalize`} title="Keyword ideas with this intent" data-testid="link-gap-intent">· {r.intent}</Link></>}</td>
                      <td className="num" data-label="Volume / mo"><Link href={kw(r.keyword, { section: "volume" })} className={TEXT_LINK} title="This keyword's search volume by month" data-testid="link-gap-volume">{fmtNum(r.volume)}</Link></td>
                      <td className="num" data-label="Difficulty"><Link href={kw(r.keyword, { section: "serp" })} className={TEXT_LINK} title="Who ranks for it" data-testid="link-gap-difficulty">{kd(r.difficulty)}</Link></td>
                      <td className="num" data-label="CPC"><Link href={kw(r.keyword, { section: "cpc" })} className={FIG_LINK} title="This keyword's cost per click and bids (no view lists the bids — it opens who ranks)" data-testid="link-gap-cpc">{r.cpc == null ? "—" : `$${r.cpc.toFixed(2)}`}</Link></td>
                      {/* A competitor's position: its row in its own keyword list; the page it ranks with opens beside it. */}
                      {page.competitors.map((c) => { const hit = r.competitors.find((x) => x.domain === c); return <td key={c} className="num" data-label={c}>{hit ? <><Link href={theirs(c, r.keyword)} className={TEXT_LINK} title={`${c}'s position for this search — its keyword list in Site explorer, narrowed to it`} data-testid="link-gap-position">{hit.position ?? "ranks"}</Link>{hit.url && <> <a href={hit.url} className={`${TEXT_LINK} text-[12px]`} target="_blank" rel="noreferrer" title={hit.url} aria-label={`Open the page ${c} ranks with, in a new tab`}>↗</a></>}</> : <span className="g-text-2" title={`${c} was not found ranking for this search`}>—</span>}</td>; })}
                      <td className="num" data-label="Their traffic">{(() => { const b = bestOf(r); return b ? <Link href={theirs(b, r.keyword)} className={FIG_LINK} title={`Estimated visits a month these competitors get from this search, together — opens ${b}'s keyword list, where its share is`} data-testid="link-gap-traffic">{fmtNum(r.traffic)}</Link> : fmtNum(r.traffic); })()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="g-table" data-testid="table-gap-links">
                  <thead><tr><th>Linking site</th><th className="num">Authority</th><th className="num">Spam</th>{page.competitors.map((c) => <th key={c} className="num">Links to {c}</th>)}<th className="num">First seen</th>{planSiteId != null && <th><span className="sr-only">Action plan</span></th>}</tr></thead>
                  <tbody>
                    {(page.rows as LinkRow[]).map((r) => (
                      <tr key={r.domain}>
                        <td><Link href={seoLinks.explorer(r.domain)} className={`${TEXT_LINK} text-left`} onClick={onExplore ? (e) => { e.preventDefault(); onExplore(r.domain); } : undefined} title={`Analyse ${r.domain}`} data-testid="link-gap-site">{r.domain}</Link> <a href={`https://${r.domain}`} target="_blank" rel="noreferrer" className={`${TEXT_LINK} text-[12px]`} aria-label={`Open ${r.domain} in a new tab`}>↗</a></td>
                        <td className="num" data-label="Authority"><Link href={seoLinks.explorer(r.domain, "referringDomains")} className={TEXT_LINK} title={`What links to ${r.domain}`} data-testid="link-gap-authority">{r.authority ?? "—"}</Link></td>
                        <td className="num" data-label="Spam">{(() => { const via = r.links.find((l) => l.backlinks > 0)?.competitor ?? page.competitors[0]; return via ? <Link href={linksTo(via, r.domain)} className={FIG_LINK} title={`How much ${r.domain} looks like spam, 0–100 — its row among ${via}'s referring domains in Site explorer, with its spam score (no view lists it among this site's: it doesn't link here)`} data-testid="link-gap-spam">{r.spamScore ?? "—"}</Link> : <span>{r.spamScore ?? "—"}</span>; })()}</td>
                        {/* Each count, 0 included, is the competitor's referring-domains row for this site: the words say what that view holds. */}
                        {page.competitors.map((c) => { const n = r.links.find((x) => x.competitor === c)?.backlinks ?? 0; return <td key={c} className="num" data-label={`Links to ${c}`}><Link href={linksTo(c, r.domain)} className={TEXT_LINK} title={n ? `${fmtNum(n)} link${n === 1 ? "" : "s"} from ${r.domain} to ${c} — ${c}'s referring domains in Site explorer, narrowed to ${r.domain}` : `No link from ${r.domain} to ${c} was found — ${c}'s referring domains in Site explorer, narrowed to ${r.domain}, list nothing`} data-testid="link-gap-links-to">{fmtNum(n)}</Link></td>; })}
                        <td className="num" data-label="First seen">{(() => { const first = r.links.filter((l) => l.firstSeen).sort((a, b) => a.firstSeen!.localeCompare(b.firstSeen!))[0]; return first ? <Link href={linksTo(first.competitor, r.domain)} className={`${FIG_LINK} g-text-2`} title={`First seen linking to ${first.competitor} — its referring domains in Site explorer, narrowed to ${r.domain}, with the date`} data-testid="link-gap-first-seen">{fmtDate(first.firstSeen)}</Link> : <span className="g-text-2">{fmtDate(null)}</span>; })()}</td>
                        {planSiteId != null && <td className="num"><AddToPlan siteId={planSiteId} label="Plan" testId={`button-plan-${r.domain}`} tasks={[{ kind: "link_prospect", title: `Ask ${r.domain} for a link`, target: r.domain, facts: { authority: r.authority, linksTo: r.links.filter((l) => l.backlinks > 0).map((l) => l.competitor).join(", ") }, source: `prospect:${r.domain}` }]} /></td>}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2 text-[13px]">
                <button type="button" className="g-pill g-pill--sm !min-h-11" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - limit))} data-testid="button-gap-prev">← Previous</button>
                <button type="button" className="g-pill g-pill--sm !min-h-11" disabled={page.rows.length < limit || (page.total != null && page.offset + page.rows.length >= page.total) || offset + limit > 9900} onClick={() => setOffset(offset + limit)} data-testid="button-gap-next">Next →</button>
                <span className="g-text-2">A page you haven't opened yet costs about {priceCents != null ? <Link href={seoLinks.usage()} className={TEXT_LINK} title="Usage and credit: what lookups cost and what is left this month" data-testid="link-gap-page-price">{money(priceCents)}</Link> : "—"}.</span>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
