/**
 * Keywords Explorer, beyond one keyword: analyse many keywords at once, and
 * keep keywords in named lists. A list is free to open and edit; only "Analyse"
 * and "Refresh numbers" buy data, and both show the price first.
 * Every figure in a table is a link (links.ts): a keyword, its volume, cost per click and intent to its overview in
 * the list's own country, its difficulty to who ranks for it. The open list is the `list` parameter of the address;
 * grouping by topic is the `topic` parameter ("*" every group, a term one group, "other" the keywords in no group),
 * so a topic's header counts lead to the rows they count and the back button returns to the view before.
 */
import { MarketPicker } from "./market";
import { DEFAULT_MARKET, findMarket, marketLabel, type SeoMarket } from "@shared/seo-markets";
import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { seoLinks, setParam } from "./links";
import { marketParams } from "./keyword-links";
import { INTENTS } from "./explorer-filters";
import { clusterKeywords, CLUSTER_MAX } from "@shared/seo-clusters";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, ListPlus, Loader2, Plus, RefreshCw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiErrorMessage } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { ActiveFilter, api, Empty, fmtDate, fmtNum, isNotRunYet, money, useAddress, type SeoSite, type SeoStatus } from "./shell";
import { PALETTE } from "./viz";
import { BarFigure, BLOCK_LINK, FIG_LINK, KdBadge, LINK_CUE, TEXT_LINK } from "./viz-keywords";

export type KwRow = { keyword: string; volume: number | null; cpc: number | null; difficulty: number | null; intent?: string | null };
type List = { id: number; name: string; locationCode?: number; languageCode?: string; createdAt: string; keywords: number; volume: number };
const sameMarket = (l: { locationCode?: number; languageCode?: string }, m: { locationCode: number; languageCode: string }) => (l.locationCode ?? 2840) === m.locationCode && (l.languageCode ?? "en") === m.languageCode;
const MAX_BULK = 200;
/** A pill-sized link or button that is 44 px tall on a phone. */
const PILL = "g-pill g-pill--sm !min-h-11";

const csvCell = (v: string | number | null | undefined) => { const s = v == null ? "" : String(v); return `"${(typeof v !== "number" && /^[=+\-@\t\r]/.test(s) ? `'${s}` : s).replace(/"/g, '""')}"`; };
function downloadCsv(name: string, rows: (string | number | null | undefined)[][]) {
  const blob = new Blob([rows.map((r) => r.map(csvCell).join(",")).join("\n")], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = name; a.click();
  URL.revokeObjectURL(a.href);
}
const parseKeywords = (text: string) => [...new Set(text.split(/\n|,/).map((s) => s.toLowerCase().replace(/\s+/g, " ").trim()).filter(Boolean))];
/** About what analysing `n` keywords costs the customer (the same sum the server reserves, in their price). */
export const bulkPrice = (status: SeoStatus | undefined, n: number) => status?.prices?.bulkBase != null && status.prices.bulkPer100 != null ? status.prices.bulkBase + Math.ceil((n / 100) * status.prices.bulkPer100) : null;
const affordable = (status: SeoStatus | undefined, cents: number | null) => cents == null || !status?.credits || status.credits.availableCents === -1 || status.credits.availableCents >= cents;

/** "Add to list": pick one of the account's lists or name a new one. */
export function AddToList({ rows, onDone, label = "Add to a list", market = DEFAULT_MARKET }: { rows: KwRow[]; onDone?: () => void; label?: string; /** The country these numbers are for; a list holds one country's keywords. */ market?: SeoMarket }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [listId, setListId] = useState<number | "new">("new");
  const [name, setName] = useState("");
  const lists = useQuery<{ lists: List[] }>({ queryKey: ["/api/seo/lists"], enabled: open });
  const m = useMutation({
    mutationFn: () => api("POST", "/api/seo/lists/items", { ...(listId === "new" ? { name: name.trim() } : { listId }), locationCode: market.locationCode, languageCode: market.languageCode, items: rows.map((r) => ({ keyword: r.keyword, volume: r.volume, cpc: r.cpc, difficulty: r.difficulty, intent: r.intent ?? null })) }),
    onSuccess: (r: { list: { name: string }; added: number }) => {
      void qc.invalidateQueries({ predicate: (q) => typeof q.queryKey[0] === "string" && q.queryKey[0].startsWith("/api/seo/lists") });
      toast({ title: `${r.added} keyword${r.added === 1 ? "" : "s"} added to "${r.list.name}"`, description: r.added < rows.length ? "The rest were already in it." : undefined });
      setOpen(false); setName(""); onDone?.();
    },
    onError: (e) => toast({ title: "Couldn't add to the list", description: apiErrorMessage(e), variant: "destructive" }),
  });
  if (!open) return <button type="button" className={PILL} disabled={!rows.length} onClick={() => setOpen(true)} data-testid="button-add-to-list"><ListPlus /> {label}{rows.length ? ` (${rows.length})` : ""}</button>;
  return (
    <form className="flex flex-wrap items-center gap-2 text-[13px]" onSubmit={(e) => { e.preventDefault(); m.mutate(); }} data-testid="form-add-to-list">
      <label className="flex items-center gap-2"><span className="g-text-2">List</span>
        <select className="g-select" value={listId} onChange={(e) => setListId(e.target.value === "new" ? "new" : Number(e.target.value))} data-testid="select-list">
          <option value="new">New list…</option>
          {(lists.data?.lists ?? []).map((l) => <option key={l.id} value={l.id} disabled={!sameMarket(l, market)}>{l.name} ({l.keywords}){sameMarket(l, market) ? "" : ` — ${marketLabel(l.locationCode ?? 2840, l.languageCode ?? "en")} list`}</option>)}
        </select>
      </label>
      {lists.isLoading && <span className="g-text-2 flex items-center gap-1" role="status"><Loader2 className="h-3.5 w-3.5 animate-spin" /> loading your lists…</span>}
      {lists.isError && <span className="g-text-2" role="alert">Couldn't load your lists — you can still make a new one. <button type="button" className="g-link" onClick={() => void lists.refetch()}>Try again</button></span>}
      {listId === "new" && <label><span className="sr-only">Name of the new list</span><input className="g-input !py-1" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} placeholder="e.g. Tampa roofing" autoFocus data-testid="input-list-name" /></label>}
      <Button size="sm" type="submit" disabled={m.isPending || (listId === "new" && !name.trim())} data-testid="button-save-to-list">{m.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : `Add ${rows.length}`}</Button>
      <button type="button" className={PILL} onClick={() => setOpen(false)}>Cancel</button>
    </form>
  );
}

/** The address of this view (bulk or a list) with a different `topic`: what the topic links write. */
function useTopicAddress(): { topic: string | undefined; at: (topic: string | undefined) => string } {
  const a = useAddress();
  const view = a.get("view"), topic = a.get("topic")?.trim() || undefined;
  const at = (t: string | undefined) => seoLinks.keywords(a.get("keyword") ?? "", { view: view === "bulk" || view === "lists" || view === "area" ? view : undefined, list: Number(a.get("list")) || undefined, locationCode: Number(a.get("locationCode")) || undefined, languageCode: a.get("languageCode") || undefined, topic: t });
  return { topic, at };
}

function KeywordTable({ rows, picked, toggle, setPicked, market, onRemove, testId }: { rows: KwRow[]; picked: Set<string>; toggle: (k: string) => void; /** Lets a whole group be selected at once. */ setPicked?: (next: Set<string>) => void; /** The country these numbers are for: a keyword opens in it. */ market?: SeoMarket; onRemove?: (k: string) => void; testId: string }) {
  // Grouping lives in the address (links.ts `topic`): "*" shows every group, a term one group, "other" the keywords in no group.
  const { topic, at } = useTopicAddress();
  const grouped = topic != null;
  // Groups are worked out from the keywords themselves (shared/seo-clusters.ts): free, and only when asked for.
  const groups = useMemo(() => (grouped ? clusterKeywords(rows) : [{ term: null, rows: [...rows], volume: null, measured: 0 }]), [grouped, rows]);
  const topics = groups.filter((g) => g.term !== null).length;
  const one = grouped && topic !== "*" ? groups.find((g) => (g.term ?? "other") === topic) ?? null : null;
  const unknownTopic = grouped && topic !== "*" && !one;
  const shownGroups = one ? [one] : groups;
  const cols = 6 + (onRemove ? 1 : 0);
  // The biggest volume in the table: each row's bar is its share of it.
  const maxVolume = Math.max(0, ...rows.map((r) => r.volume ?? 0));
  const pickGroup = (list: KwRow[], on: boolean) => { if (!setPicked) return; const n = new Set(picked); for (const r of list) on ? n.add(r.keyword) : n.delete(r.keyword); setPicked(n); };
  const kw = (r: KwRow, extra: Parameters<typeof seoLinks.keywords>[1] = {}) => seoLinks.keywords(r.keyword, { ...marketParams(market), ...extra });
  const groupWords = (g: (typeof groups)[number]) => `${g.rows.length} keyword${g.rows.length === 1 ? "" : "s"}${g.volume == null ? " · no search volumes yet" : g.measured < g.rows.length ? ` · ${fmtNum(g.volume)} searches a month for the ${g.measured} with a figure` : ` · ${fmtNum(g.volume)} searches a month together`}`;
  return (
    <div className="overflow-x-auto">
      {(rows.length >= 6 || grouped) && (
        <div className="mb-2 flex flex-wrap items-center gap-2 text-[13px]">
          <Link href={at(grouped ? undefined : "*")} className={`${PILL} ${LINK_CUE}`} aria-current={grouped ? "true" : undefined} style={grouped ? { background: "var(--g-hover)" } : undefined} data-testid={`${testId}-group`}>{grouped ? "Ungroup" : "Group by topic"}</Link>
          {grouped && <span className="g-text-2" data-testid={`${testId}-group-note`}>{topics} topic{topics === 1 ? "" : "s"} from the words these keywords share{topics >= CLUSTER_MAX ? ` (the ${CLUSTER_MAX} largest; the rest are under "Other keywords")` : ""} — a starting point for deciding which keywords might share a page. Google may still treat keywords in one group differently.</span>}
        </div>
      )}
      {one && <ActiveFilter onClear={() => setParam("topic", "*")} clearLabel="Every topic">Topic: {one.term ?? "Other keywords"} — {groupWords(one)}</ActiveFilter>}
      {unknownTopic && <ActiveFilter onClear={() => setParam("topic", "*")} clearLabel="Every topic">No topic "{topic}" among these keywords — every group is shown</ActiveFilter>}
      <table className="g-table" data-testid={testId}>
        <thead><tr><th aria-label="Select" /><th>Keyword</th><th className="num">Volume / mo</th><th className="num">Difficulty</th><th className="num">CPC</th><th>Intent</th>{onRemove && <th aria-label="Remove" />}</tr></thead>
        {shownGroups.map((g, gi) => (
        <tbody key={grouped ? `g:${g.term ?? ""}:${gi}` : "all"}>
          {grouped && (
            <tr data-testid={`${testId}-topic`}>
              <td>{setPicked && <input type="checkbox" aria-label={`Select all ${g.rows.length} keywords ${g.term ? `about ${g.term}` : "in no group"}`} checked={g.rows.every((r) => picked.has(r.keyword))} ref={(el) => { if (el) el.indeterminate = !g.rows.every((r) => picked.has(r.keyword)) && g.rows.some((r) => picked.has(r.keyword)); }} onChange={(e) => pickGroup(g.rows, e.target.checked)} />}</td>
              {/* The term opens its own overview; the counts open only this group's rows. */}
              <th scope="rowgroup" colSpan={cols - 1} className="text-left">
                {g.term ? <Link href={seoLinks.keywords(g.term, marketParams(market))} className={`${FIG_LINK} g-text font-medium`} title={`"${g.term}" in the Keywords explorer (nothing is bought)`} data-testid="link-topic-term">{g.term}</Link> : <span className="g-text font-medium">Other keywords</span>}
                {" "}<Link href={at(g.term ?? "other")} className={`${TEXT_LINK} font-normal`} title="Only this group's keywords" data-testid="link-topic-rows">· {groupWords(g)}</Link>
              </th>
            </tr>
          )}
          {g.rows.map((r) => (
            <tr key={r.keyword}>
              <td><input type="checkbox" aria-label={`Select ${r.keyword}`} checked={picked.has(r.keyword)} onChange={() => toggle(r.keyword)} /></td>
              <td><Link href={kw(r)} className={TEXT_LINK} title="Open this keyword's overview (the saved one, or the Look up button — nothing is bought)" data-testid="link-keyword">{r.keyword}</Link></td>
              <td className="num" data-label="Volume / mo"><Link href={kw(r, { section: "volume" })} className={BLOCK_LINK} title="This keyword's search volume by month" data-testid="link-keyword-volume"><BarFigure value={r.volume} max={maxVolume} color={PALETTE.keywords} /></Link></td>
              <td className="num" data-label="Difficulty"><Link href={kw(r, { section: "serp" })} className={BLOCK_LINK} title="Who ranks for it — the pages the difficulty is worked out from" data-testid="link-keyword-difficulty"><KdBadge value={r.difficulty} /></Link></td>
              <td className="num" data-label="CPC"><Link href={kw(r, { section: "cpc" })} className={FIG_LINK} title="This keyword's cost per click and bids" data-testid="link-keyword-cpc">{r.cpc == null ? "—" : `$${r.cpc.toFixed(2)}`}</Link></td>
              <td data-label="Intent" className="g-text-2 capitalize">{r.intent ? <Link href={kw(r, { section: "ideas", table: "matchingTerms", intent: (INTENTS as readonly string[]).includes(r.intent) ? r.intent : undefined })} className={FIG_LINK} title="Keyword ideas with this intent" data-testid="link-keyword-intent">{r.intent}</Link> : "—"}</td>
              {onRemove && <td className="num"><button type="button" className="g-pill g-pill--danger !min-h-11 !px-2" onClick={() => onRemove(r.keyword)} aria-label={`Remove ${r.keyword}`}><Trash2 /></button></td>}
            </tr>
          ))}
        </tbody>
        ))}
      </table>
    </div>
  );
}

function usePicked() {
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const toggle = (k: string) => setPicked((s) => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; });
  return { picked, toggle, clear: () => setPicked(new Set()), set: setPicked };
}

/** Paste up to 200 keywords and get the numbers for all of them in one go. */
export function BulkKeywords({ status, site, onTrack, initial = "", market, onMarket }: { status: SeoStatus | undefined; site: SeoSite | null; onTrack?: (rows: KwRow[]) => void; initial?: string; market?: SeoMarket; /** The country picker's pick; the page writes it to the address as well as the store. */ onMarket?: (m: SeoMarket) => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [text, setText] = useState(initial);
  const [asked, setAsked] = useState<string[]>([]);
  const { picked, toggle, clear, set } = usePicked();
  const draft = useMemo(() => parseKeywords(text), [text]);
  const loc = market?.locationCode, lang = market?.languageCode;
  const body = useMemo(() => ({ keywords: asked, ...(loc ? { locationCode: loc, languageCode: lang } : {}) }), [asked, loc, lang]);
  const queryKey = ["/api/seo/keywords/bulk", body];
  const saved = useQuery<{ page: { rows: KwRow[]; notFound: string[]; fetchedAt: string } } | null>({
    queryKey, enabled: asked.length > 0, retry: false, staleTime: 5 * 60_000,
    queryFn: async () => { try { return await api("POST", "/api/seo/keywords/bulk", { ...body, peek: true }); } catch (e) { if (isNotRunYet(e)) return null; throw e; } },
  });
  const run = useMutation({
    mutationFn: (v: { body: unknown; key: readonly unknown[] }) => api("POST", "/api/seo/keywords/bulk", v.body),
    onSuccess: (data: { saved?: boolean }, v) => {
      qc.setQueryData(v.key, data); void qc.invalidateQueries({ queryKey: ["/api/seo/status"] });
      if (data.saved === false) toast({ title: "Shown, but it couldn't be kept", description: "Opening this analysis again will not be free. Export it now if you need it.", variant: "destructive" });
    },
    onError: (e) => toast({ title: "Couldn't analyse those keywords", description: apiErrorMessage(e), variant: "destructive" }),
  });
  const page = saved.data?.page ?? null;
  const price = bulkPrice(status, Math.min(asked.length || draft.length, MAX_BULK)), canPay = affordable(status, price);
  const chosen = (page?.rows ?? []).filter((r) => picked.has(r.keyword));
  return (
    <div data-testid="bulk-keywords">
      <form onSubmit={(e) => { e.preventDefault(); setAsked(draft.slice(0, MAX_BULK)); clear(); }} data-testid="form-bulk">
        <label className="block text-[13px]"><span className="g-text-2">Keywords — one per line or comma-separated, up to {MAX_BULK}</span>
          <textarea className="g-input mt-1 min-h-[140px] w-full py-2" value={text} onChange={(e) => setText(e.target.value)} placeholder={"roof repair tampa\nsiding contractor tampa\ngutter installation tampa"} data-testid="textarea-bulk" />
        </label>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {market && onMarket && <MarketPicker value={market} onChange={(m) => { setAsked([]); clear(); onMarket(m); }} />}
          <Button type="submit" disabled={!draft.length} data-testid="button-bulk-prepare">Analyse {draft.length ? `${Math.min(draft.length, MAX_BULK)} keyword${draft.length === 1 ? "" : "s"}` : "keywords"}</Button>
          <span className="g-text-2 text-[13px]">{draft.length > MAX_BULK ? `Only the first ${MAX_BULK} of ${fmtNum(draft.length)} are analysed at once. ` : ""}{price != null && draft.length ? <>About <Link href={seoLinks.usage()} className={TEXT_LINK} title="Usage and credit: what lookups cost and what is left this month" data-testid="link-bulk-price">{money(bulkPrice(status, Math.min(draft.length, MAX_BULK)))}</Link> of your SEO data; reopening the same set within a day is free. {market?.label ?? "United States"}, Google.</> : "Volume, difficulty, cost per click and intent for each. United States, Google."}</span>
        </div>
      </form>
      <div className="mt-4">
        {asked.length > 0 && saved.isLoading && <p className="g-text-2 flex items-center gap-2 text-[14px]" role="status"><Loader2 className="h-4 w-4 animate-spin" /> Checking for a saved analysis…</p>}
        {asked.length > 0 && saved.isError && <div className="g-callout" role="alert"><h3>Couldn't check for a saved analysis</h3><p>{apiErrorMessage(saved.error)}</p><button type="button" className="g-pill mt-2" onClick={() => void saved.refetch()}>Try again</button></div>}
        {asked.length > 0 && saved.isSuccess && !page && (
          <Empty testId="bulk-not-run">
            <h3>{asked.length} keyword{asked.length === 1 ? "" : "s"} ready to analyse</h3>
            <p>{!canPay ? "You don't have enough SEO data left — add credit above." : "Nothing has been charged yet."}</p>
            <Button className="mt-2" disabled={run.isPending || !status?.configured || !canPay} onClick={() => run.mutate({ body, key: queryKey })} data-testid="button-bulk-run">{run.isPending ? <><Loader2 className="mr-1 h-4 w-4 animate-spin" /> Analysing…</> : `Get the numbers${price != null ? ` — about ${money(price)}` : ""}`}</Button>
          </Empty>
        )}
        {page && (
          <>
            <div className="mb-2 flex flex-wrap items-center gap-2 text-[13px]">
              <span className="g-text-2" data-testid="text-bulk-meta">{fmtNum(page.rows.length)} of {fmtNum(asked.length)} keywords have numbers · <Link href={seoLinks.usage({ month: page.fetchedAt.slice(0, 7) })} className={TEXT_LINK} title="When this analysis was bought — that month's lookups on the Usage page" data-testid="link-bulk-as-of">as of {fmtDate(page.fetchedAt)}</Link></span>
              <button type="button" className={PILL} onClick={() => set(new Set(picked.size === page.rows.length ? [] : page.rows.map((r) => r.keyword)))} disabled={!page.rows.length}>{picked.size === page.rows.length && page.rows.length ? "Select none" : "Select all"}</button>
              <span className="ml-auto flex flex-wrap items-center gap-2">
                <AddToList market={market} rows={chosen} onDone={clear} />
                {onTrack && site && <button type="button" className={PILL} disabled={!chosen.length} onClick={() => onTrack(chosen)} data-testid="button-bulk-track"><Plus /> Track {chosen.length || ""} on {site.domain}</button>}
                <button type="button" className={PILL} disabled={!page.rows.length} onClick={() => downloadCsv("keywords.csv", [["Keyword", "Volume", "Difficulty", "CPC", "Intent"], ...page.rows.map((r) => [r.keyword, r.volume, r.difficulty, r.cpc, r.intent ?? null])])} data-testid="button-bulk-export"><Download /> Export</button>
              </span>
            </div>
            {page.rows.length > 0 ? <KeywordTable rows={page.rows} picked={picked} toggle={toggle} setPicked={set} market={market} testId="table-bulk" /> : <Empty><h3>No numbers for these keywords</h3><p>None of them has enough searches in the United States to be measured.</p></Empty>}
            {page.notFound.length > 0 && <p className="g-text-2 mt-2 text-[13px]" data-testid="text-bulk-notfound">No numbers for {page.notFound.length} keyword{page.notFound.length === 1 ? "" : "s"} (too few searches to measure): {page.notFound.slice(0, 20).join(", ")}{page.notFound.length > 20 ? "…" : ""}</p>}
          </>
        )}
      </div>
    </div>
  );
}

/** The account's keyword lists: open one, tidy it, track it, export it, or get fresh numbers for it. */
export function KeywordLists({ status, site, onTrack }: { status: SeoStatus | undefined; site: SeoSite | null; /** `from` is the list's own country: its numbers belong to it. */ onTrack?: (rows: KwRow[], from: SeoMarket) => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  // The open list is the `list` parameter of the address (links.ts): a list the account no longer has falls back to the first, and says so.
  const listParam = Number(useAddress().get("list")) || null;
  const [name, setName] = useState("");
  const { picked, toggle, clear, set } = usePicked();
  const lists = useQuery<{ lists: List[] }>({ queryKey: ["/api/seo/lists"] });
  const known = lists.data?.lists;
  const first = known?.[0]?.id ?? null;
  const listKnown = !!listParam && !!known?.some((l) => l.id === listParam);
  const current = known ? (listKnown ? listParam : first) : null;
  useEffect(() => { clear(); }, [current]); // eslint-disable-line react-hooks/exhaustive-deps
  const items = useQuery<{ list: { id: number; name: string; locationCode?: number; languageCode?: string }; items: (KwRow & { addedAt: string })[] }>({ queryKey: [`/api/seo/lists/${current}`], enabled: current !== null });
  const refresh = () => void qc.invalidateQueries({ predicate: (q) => typeof q.queryKey[0] === "string" && q.queryKey[0].startsWith("/api/seo/lists") });
  const create = useMutation({
    mutationFn: () => api("POST", "/api/seo/lists/items", { name: name.trim(), items: [] }),
    onSuccess: (r: { list: { id: number } }) => { setName(""); setParam("list", r.list.id); refresh(); },
    onError: (e) => toast({ title: "Couldn't create the list", description: apiErrorMessage(e), variant: "destructive" }),
  });
  const remove = useMutation({
    // A thousand at a time (the most one request takes), one after another.
    mutationFn: async (keywords: string[]) => { for (let i = 0; i < keywords.length; i += 1000) await api("POST", `/api/seo/lists/${current}/remove`, { keywords: keywords.slice(i, i + 1000) }); },
    onSuccess: () => { clear(); refresh(); },
    // Some may have gone before it failed: show the list as it now is, and keep the selection so the rest can be tried again.
    onError: (e) => { refresh(); toast({ title: "Couldn't remove all of those", description: apiErrorMessage(e), variant: "destructive" }); },
  });
  const drop = useMutation({
    mutationFn: (id: number) => api("DELETE", `/api/seo/lists/${id}`),
    onSuccess: () => { setParam("list", null); clear(); refresh(); toast({ title: "List deleted" }); },
    onError: (e) => toast({ title: "Couldn't delete the list", description: apiErrorMessage(e), variant: "destructive" }),
  });
  const all = lists.data?.lists ?? [], rows = items.data?.items ?? [];
  /** The country the open list's numbers are for. */
  const listMarket: SeoMarket = findMarket(items.data?.list.locationCode ?? 2840, items.data?.list.languageCode ?? "en") ?? DEFAULT_MARKET;
  const chosen = rows.filter((r) => picked.has(r.keyword));
  // One lookup per 200 keywords.
  const batches = Array.from({ length: Math.ceil(rows.length / MAX_BULK) }, (_, i) => Math.min(MAX_BULK, rows.length - i * MAX_BULK));
  const price = batches.length && bulkPrice(status, 1) != null ? batches.reduce((a, n) => a + (bulkPrice(status, n) ?? 0), 0) : null;
  const renew = useMutation({
    mutationFn: () => api("POST", `/api/seo/lists/${current}/refresh`),
    onSuccess: (r: { updated: number; total: number; failed?: number; notAttempted?: number; problem?: string | null }) => toast({ title: `Numbers refreshed for ${r.updated} of ${r.total} keywords`, description: r.problem ? `${r.problem}${r.notAttempted ? ` ${r.notAttempted} were not attempted and were not charged.` : ""}` : (r.updated < r.total ? "The rest have too few searches to measure; their old numbers were cleared." : undefined), variant: r.problem ? "destructive" : undefined }),
    onError: (e) => toast({ title: "Couldn't refresh the numbers", description: apiErrorMessage(e), variant: "destructive" }),
    // Whatever happened, show what is stored now and what it cost.
    onSettled: () => { refresh(); void qc.invalidateQueries({ queryKey: ["/api/seo/status"] }); },
  });
  return (
    <div data-testid="keyword-lists">
      {lists.isLoading && <p className="g-text-2 flex items-center gap-2 text-[14px]" role="status"><Loader2 className="h-4 w-4 animate-spin" /> Loading your lists…</p>}
      {lists.isError && <div className="g-callout" role="alert"><h3>Couldn't load your lists</h3><p>{apiErrorMessage(lists.error)}</p><button type="button" className="g-pill mt-2" onClick={() => void lists.refetch()}>Try again</button></div>}
      {lists.isSuccess && (
        <div className="flex flex-col gap-5 lg:flex-row">
          <div className="flex-none lg:w-64">
            <form className="mb-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (name.trim()) create.mutate(); }} data-testid="form-new-list">
              <label className="min-w-0 flex-1"><span className="sr-only">Name of a new list</span><input className="g-input w-full" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} placeholder="New list name" data-testid="input-new-list" /></label>
              <button type="submit" className="g-pill" disabled={!name.trim() || create.isPending} aria-label="Create list"><Plus /></button>
            </form>
            {all.length === 0 ? <p className="g-text-2 text-[13px]">No lists yet. Name one above, or tick keywords in any report and choose "Add to a list".</p> : (
              <ul className="space-y-0.5" aria-label="Your keyword lists">
                {all.map((l) => (
                  <li key={l.id}><Link href={seoLinks.keywords("", { view: "lists", list: l.id })} aria-current={current === l.id ? "true" : undefined} className={`flex w-full min-h-11 items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] ${LINK_CUE} ${current === l.id ? "font-medium" : "g-text"}`} style={current === l.id ? { background: "var(--g-accent-soft)", color: "var(--g-blue)" } : undefined} data-testid={`list-${l.id}`}>
                    <span className="min-w-0 flex-1 truncate">{l.name}{sameMarket(l, DEFAULT_MARKET) ? "" : <span className="g-text-2 font-normal"> · {marketLabel(l.locationCode ?? 2840, l.languageCode ?? "en")}</span>}</span><span className="tabular-nums">{fmtNum(l.keywords)}</span>
                  </Link></li>
                ))}
              </ul>
            )}
          </div>
          <div className="min-w-0 flex-1">
            {current === null && all.length === 0 && <Empty testId="lists-empty"><h3>Keep your keyword research</h3><p>A list holds the keywords you want to come back to — by service, by city, by customer. It is free to open and edit; the numbers are the ones each keyword had when you added it, until you refresh them.</p></Empty>}
            {current !== null && items.isLoading && <p className="g-text-2 flex items-center gap-2 text-[14px]" role="status"><Loader2 className="h-4 w-4 animate-spin" /> Opening the list…</p>}
            {current !== null && items.isError && <div className="g-callout" role="alert"><h3>Couldn't open the list</h3><p>{apiErrorMessage(items.error)}</p><button type="button" className="g-pill mt-2" onClick={() => void items.refetch()}>Try again</button></div>}
            {items.data && (
              <>
                {/* The chip says what the address opened: a list other than the first (the one shown with no `list`), or a list that no longer exists. */}
                {listParam != null && !listKnown && <ActiveFilter onClear={() => setParam("list", null)} clearLabel="Back to the first list">List #{listParam} isn't one of your lists (deleted, or another account's) — showing "{items.data.list.name}"</ActiveFilter>}
                {listKnown && listParam !== first && listParam === items.data.list.id && <ActiveFilter onClear={() => setParam("list", null)} clearLabel="Back to the first list">List: {items.data.list.name} · {listMarket.label}</ActiveFilter>}
                <div className="mb-2 flex flex-wrap items-center gap-2 text-[13px]">
                  <h3 className="text-[17px] font-medium [overflow-wrap:anywhere]" style={{ color: "var(--g-blue)" }}>{items.data.list.name}</h3>
                  {/* The list's figures are its own address (the rows below; the link to share it), the total grouped by topic. */}
                  <span className="g-text-2"><Link href={seoLinks.keywords("", { view: "lists", list: items.data.list.id })} className={TEXT_LINK} title="This list's own address — its keywords, below" data-testid="link-list-count">{fmtNum(rows.length)} keyword{rows.length === 1 ? "" : "s"}</Link> · {(() => { const known = rows.filter((r) => r.volume != null); return known.length === 0 ? "no search volumes yet" : <Link href={seoLinks.keywords("", { view: "lists", list: items.data.list.id, topic: "*" })} className={TEXT_LINK} title="The same keywords grouped by topic, each group with its own total" data-testid="link-list-volume">{fmtNum(known.reduce((a, r) => a + (r.volume ?? 0), 0))} searches a month {known.length < rows.length ? `for the ${fmtNum(known.length)} with a figure` : "in total"}</Link>; })()}</span>
                  <span className="ml-auto flex flex-wrap items-center gap-2">
                    {onTrack && site && <button type="button" className={PILL} disabled={!chosen.length} onClick={() => onTrack(chosen, listMarket)} data-testid="button-list-track"><Plus /> Track {chosen.length || ""} on {site.domain}</button>}
                    <button type="button" className={PILL} disabled={!chosen.length || remove.isPending} onClick={() => remove.mutate(chosen.map((r) => r.keyword))} data-testid="button-list-remove"><Trash2 /> Remove {chosen.length || ""}</button>
                    <button type="button" className={PILL} disabled={!rows.length || renew.isPending || !status?.configured || !affordable(status, price)} onClick={() => renew.mutate()} title={price != null ? `Today's numbers for all ${rows.length} keywords, saved back to this list — about ${money(price)}` : undefined} data-testid="button-list-refresh">{renew.isPending ? <Loader2 className="animate-spin" /> : <RefreshCw />} {renew.isPending ? "Refreshing…" : `Refresh numbers${price != null && rows.length ? ` · about ${money(price)}` : ""}`}</button>
                    <button type="button" className={PILL} disabled={!rows.length} onClick={() => downloadCsv(`${items.data!.list.name.replace(/[^a-z0-9]+/gi, "-")}.csv`, [["Keyword", "Volume", "Difficulty", "CPC", "Intent", "Added"], ...rows.map((r) => [r.keyword, r.volume, r.difficulty, r.cpc, r.intent ?? null, r.addedAt.slice(0, 10)])])} data-testid="button-list-export"><Download /> Export</button>
                    <button type="button" className={`${PILL} g-pill--danger`} disabled={drop.isPending} onClick={() => { if (window.confirm(`Delete the list "${items.data!.list.name}" and its ${rows.length} keywords? This can't be undone.`)) drop.mutate(items.data!.list.id); }} data-testid="button-list-delete"><Trash2 /> Delete list</button>
                  </span>
                </div>
                {rows.length === 0 ? <Empty testId="list-empty"><h3>This list is empty</h3><p>Tick keywords in a keyword report, a bulk analysis or a content gap and choose "Add to a list".</p></Empty>
                  : <KeywordTable rows={rows} picked={picked} toggle={toggle} setPicked={set} market={listMarket} onRemove={(k) => remove.mutate([k])} testId="table-list" />}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
