/**
 * Content gap and Link intersect, inside Site Explorer. Pick up to three
 * competitors; the result is saved for a day (POST /api/seo/gap, peek first),
 * so reopening it costs nothing. The price is shown before anything is bought.
 */
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, Loader2, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiErrorMessage } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { api, Empty, fmtDate, fmtNum, isNotRunYet, kd, money, type SeoStatus } from "./shell";
import { AddToList } from "./keyword-lists";

export type GapKind = "content" | "links";
type ContentRow = { keyword: string; volume: number | null; cpc: number | null; difficulty: number | null; intent: string | null; competitors: { domain: string; position: number | null; url: string | null }[]; traffic: number };
type LinkRow = { domain: string; authority: number | null; spamScore: number | null; links: { competitor: string; backlinks: number; firstSeen: string | null }[] };
type Page = { kind: GapKind; target: string; competitors: string[]; rows: (ContentRow | LinkRow)[]; total: number | null; limit: number; offset: number; missing: string[]; fetchedAt: string };
type TrackRow = { keyword: string; volume: number | null; cpc: number | null; difficulty: number | null };

const MAX = 3;
const clean = (d: string) => d.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/[/?#].*$/, "");
const looksLikeDomain = (d: string) => /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(d);
/** Quoted, and a cell from the open web is never allowed to run as a spreadsheet formula. */
const csvCell = (v: string | number | null) => { const s = v == null ? "" : String(v); return `"${(typeof v !== "number" && /^[=+\-@\t\r]/.test(s) ? `'${s}` : s).replace(/"/g, '""')}"`; };
function downloadCsv(name: string, rows: (string | number | null)[][]) {
  const blob = new Blob([rows.map((r) => r.map(csvCell).join(",")).join("\n")], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = name; a.click();
  URL.revokeObjectURL(a.href);
}

export function GapView({ kind, domain, status, suggestions, onExplore, onTrack }: {
  kind: GapKind; domain: string; status: SeoStatus | undefined;
  /** Likely competitors to offer (the report's organic competitors). */
  suggestions: string[];
  onExplore?: (domain: string) => void;
  /** Content gap: track the ticked keywords (the page supplies the site). */
  onTrack?: (rows: TrackRow[]) => void;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [draft, setDraft] = useState<string[]>([]);
  const [input, setInput] = useState("");
  const [applied, setApplied] = useState<string[]>([]);
  const [offset, setOffset] = useState(0);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const limit = 50;
  // A different report or site starts clean.
  useEffect(() => { setDraft([]); setApplied([]); setInput(""); setOffset(0); setPicked(new Set()); }, [kind, domain]);

  const body = useMemo(() => ({ kind, domain, competitors: applied, ...(kind === "links" ? { limit, offset } : {}) }), [kind, domain, applied, offset]);
  const queryKey = ["/api/seo/gap", body];
  const saved = useQuery<{ page: Page } | null>({
    queryKey, enabled: applied.length > 0, retry: false, staleTime: 5 * 60_000,
    queryFn: async () => { try { return await api("POST", "/api/seo/gap", { ...body, peek: true }); } catch (e) { if (isNotRunYet(e)) return null; throw e; } },
  });
  const run = useMutation({
    mutationFn: (again: boolean) => api("POST", "/api/seo/gap", again ? { ...body, refresh: true } : body),
    onSuccess: (data: { page: Page }) => { qc.setQueryData(queryKey, data); void qc.invalidateQueries({ queryKey: ["/api/seo/status"] }); },
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
  const compare = () => { setApplied(draft); setOffset(0); setPicked(new Set()); };
  const toggle = (k: string) => setPicked((s) => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; });
  const what = kind === "content" ? "keywords these competitors rank for on Google that this site doesn't" : "websites that link to every competitor you name but not to this site";
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
          {draft.map((d) => <li key={d} className="g-chip g-chip--sm" style={{ textTransform: "none" }}>{d} <button type="button" className="ml-1 align-middle" aria-label={`Remove ${d}`} onClick={() => setDraft(draft.filter((x) => x !== d))}><X className="h-3 w-3" /></button></li>)}
        </ul>
      )}
      {offers.length > 0 && draft.length < MAX && (
        <p className="g-text-2 mb-3 flex flex-wrap items-center gap-1.5 text-[12px]">Sites competing for the same searches:
          {offers.map((s) => <button key={s} type="button" className="g-pill g-pill--sm" onClick={() => add(s)} data-testid={`button-gap-suggest-${s}`}>+ {s}</button>)}
        </p>
      )}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Button type="button" disabled={!draft.length || (!dirty && applied.length > 0)} onClick={compare} data-testid="button-gap-compare">Compare{draft.length ? ` with ${draft.length} competitor${draft.length === 1 ? "" : "s"}` : ""}</Button>
        <span className="g-text-2 text-[13px]">{draftPrice != null ? `A new comparison costs about ${money(draftPrice)} of your SEO data${kind === "content" ? " (one per competitor)" : ""}; reopening it within a day is free.` : ""}</span>
      </div>

      {applied.length === 0 && <Empty testId="gap-intro"><h3>Add up to {MAX} competitors</h3><p>Type a competitor's website{offers.length ? " or pick one above" : ""}, then press <b>Compare</b>.</p></Empty>}
      {applied.length > 0 && saved.isLoading && <p className="g-text-2 flex items-center gap-2 text-[14px]" role="status"><Loader2 className="h-4 w-4 animate-spin" /> Checking for a saved comparison…</p>}
      {applied.length > 0 && saved.isError && <div className="g-callout" role="alert" data-testid="gap-saved-error"><h3>Couldn't check for a saved comparison</h3><p>{apiErrorMessage(saved.error)}</p><button type="button" className="g-pill mt-2" onClick={() => void saved.refetch()}>Try again</button></div>}
      {applied.length > 0 && saved.isSuccess && !page && (
        <Empty testId="gap-not-run">
          <h3>Compare {domain} with {applied.join(", ")}</h3>
          <p>This {offset > 0 ? "page" : "comparison"} hasn't been run yet.{!affordable && " You don't have enough SEO data left — add credit above."}{dirty && " You changed the competitors above — press Compare to use the new list."}</p>
          <Button className="mt-2" disabled={run.isPending || !status?.configured || !affordable || dirty} onClick={() => run.mutate(false)} data-testid="button-gap-run">
            {run.isPending ? <><Loader2 className="mr-1 h-4 w-4 animate-spin" /> Comparing…</> : `Run comparison${priceCents != null ? ` — about ${money(priceCents)}` : ""}`}
          </Button>
        </Empty>
      )}

      {page && (
        <>
          <div className="mb-2 flex flex-wrap items-center gap-2 text-[13px]">
            <span className="g-text-2" data-testid="text-gap-meta">
              {kind === "content" ? `${fmtNum(page.rows.length)} keywords` : `${fmtNum(page.offset + 1)}–${fmtNum(page.offset + page.rows.length)}${page.total != null ? ` of ${fmtNum(page.total)}` : ""} sites`} · as of {fmtDate(page.fetchedAt)}
            </span>
            <button type="button" className="g-pill g-pill--sm ml-auto" onClick={exportRows} disabled={!page.rows.length} data-testid="button-gap-export"><Download /> Export</button>
            {kind === "content" && <AddToList rows={(page.rows as ContentRow[]).filter((r) => picked.has(r.keyword)).map((r) => ({ keyword: r.keyword, volume: r.volume, cpc: r.cpc, difficulty: r.difficulty, intent: r.intent }))} onDone={() => setPicked(new Set())} />}
            {kind === "content" && onTrack && <button type="button" className="g-pill g-pill--sm" disabled={!picked.size} onClick={() => { onTrack((page.rows as ContentRow[]).filter((r) => picked.has(r.keyword)).map((r) => ({ keyword: r.keyword, volume: r.volume, cpc: r.cpc, difficulty: r.difficulty }))); setPicked(new Set()); }} data-testid="button-gap-track"><Plus /> Add {picked.size || ""} to rank tracker</button>}
          </div>
          {page.missing.length > 0 && <p className="g-text-2 mb-2 text-[13px]" role="status" data-testid="text-gap-missing">{page.missing.join(", ")} didn't load this time, so {page.missing.length === 1 ? "it is" : "they are"} not in this comparison. <button type="button" className="g-link" disabled={run.isPending || !affordable} onClick={() => run.mutate(true)} data-testid="button-gap-retry">{run.isPending ? "Trying again…" : `Try again${priceCents != null ? ` — about ${money(priceCents)}` : ""}`}</button></p>}
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
                      <td>{r.keyword}{r.intent && <span className="g-text-2 text-[12px] capitalize"> · {r.intent}</span>}</td>
                      <td className="num" data-label="Volume / mo">{fmtNum(r.volume)}</td>
                      <td className="num" data-label="Difficulty">{kd(r.difficulty)}</td>
                      <td className="num" data-label="CPC">{r.cpc == null ? "—" : `$${r.cpc.toFixed(2)}`}</td>
                      {page.competitors.map((c) => { const hit = r.competitors.find((x) => x.domain === c); return <td key={c} className="num" data-label={c}>{hit ? (hit.url ? <a href={hit.url} className="g-link" target="_blank" rel="noreferrer" title={hit.url}>{hit.position ?? "ranks"}</a> : hit.position ?? "ranks") : <span className="g-text-2">—</span>}</td>; })}
                      <td className="num" data-label="Their traffic">{fmtNum(r.traffic)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="g-table" data-testid="table-gap-links">
                  <thead><tr><th>Linking site</th><th className="num">Authority</th><th className="num">Spam</th>{page.competitors.map((c) => <th key={c} className="num">Links to {c}</th>)}<th className="num">First seen</th></tr></thead>
                  <tbody>
                    {(page.rows as LinkRow[]).map((r) => (
                      <tr key={r.domain}>
                        <td>{onExplore ? <button type="button" className="g-link text-left" onClick={() => onExplore(r.domain)} title={`Analyse ${r.domain}`}>{r.domain}</button> : r.domain} <a href={`https://${r.domain}`} target="_blank" rel="noreferrer" className="g-text-2 text-[12px]" aria-label={`Open ${r.domain} in a new tab`}>↗</a></td>
                        <td className="num" data-label="Authority">{r.authority ?? "—"}</td>
                        <td className="num" data-label="Spam">{r.spamScore ?? "—"}</td>
                        {page.competitors.map((c) => <td key={c} className="num" data-label={`Links to ${c}`}>{fmtNum(r.links.find((x) => x.competitor === c)?.backlinks ?? 0)}</td>)}
                        <td className="num g-text-2" data-label="First seen">{fmtDate(r.links.map((l) => l.firstSeen).filter(Boolean).sort()[0] ?? null)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2 text-[13px]">
                <button type="button" className="g-pill g-pill--sm" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - limit))} data-testid="button-gap-prev">← Previous</button>
                <button type="button" className="g-pill g-pill--sm" disabled={page.rows.length < limit || (page.total != null && page.offset + page.rows.length >= page.total) || offset + limit > 9900} onClick={() => setOffset(offset + limit)} data-testid="button-gap-next">Next →</button>
                <span className="g-text-2">A page you haven't opened yet costs about {priceCents != null ? money(priceCents) : "—"}.</span>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
