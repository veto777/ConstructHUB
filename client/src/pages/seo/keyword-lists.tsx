/**
 * Keywords Explorer, beyond one keyword: analyse many keywords at once, and
 * keep keywords in named lists. A list is free to open and edit; only "Analyse"
 * and "Refresh numbers" buy data, and both show the price first.
 */
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, ListPlus, Loader2, Plus, RefreshCw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiErrorMessage } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { api, Empty, fmtDate, fmtNum, isNotRunYet, kd, money, type SeoSite, type SeoStatus } from "./shell";

export type KwRow = { keyword: string; volume: number | null; cpc: number | null; difficulty: number | null; intent?: string | null };
type List = { id: number; name: string; createdAt: string; keywords: number; volume: number };
const MAX_BULK = 200;

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
export function AddToList({ rows, onDone, label = "Add to a list" }: { rows: KwRow[]; onDone?: () => void; label?: string }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [listId, setListId] = useState<number | "new">("new");
  const [name, setName] = useState("");
  const lists = useQuery<{ lists: List[] }>({ queryKey: ["/api/seo/lists"], enabled: open });
  const m = useMutation({
    mutationFn: () => api("POST", "/api/seo/lists/items", { ...(listId === "new" ? { name: name.trim() } : { listId }), items: rows.map((r) => ({ keyword: r.keyword, volume: r.volume, cpc: r.cpc, difficulty: r.difficulty, intent: r.intent ?? null })) }),
    onSuccess: (r: { list: { name: string }; added: number }) => {
      void qc.invalidateQueries({ predicate: (q) => typeof q.queryKey[0] === "string" && q.queryKey[0].startsWith("/api/seo/lists") });
      toast({ title: `${r.added} keyword${r.added === 1 ? "" : "s"} added to "${r.list.name}"`, description: r.added < rows.length ? "The rest were already in it." : undefined });
      setOpen(false); setName(""); onDone?.();
    },
    onError: (e) => toast({ title: "Couldn't add to the list", description: apiErrorMessage(e), variant: "destructive" }),
  });
  if (!open) return <button type="button" className="g-pill g-pill--sm" disabled={!rows.length} onClick={() => setOpen(true)} data-testid="button-add-to-list"><ListPlus /> {label}{rows.length ? ` (${rows.length})` : ""}</button>;
  return (
    <form className="flex flex-wrap items-center gap-2 text-[13px]" onSubmit={(e) => { e.preventDefault(); m.mutate(); }} data-testid="form-add-to-list">
      <label className="flex items-center gap-2"><span className="g-text-2">List</span>
        <select className="g-select" value={listId} onChange={(e) => setListId(e.target.value === "new" ? "new" : Number(e.target.value))} data-testid="select-list">
          <option value="new">New list…</option>
          {(lists.data?.lists ?? []).map((l) => <option key={l.id} value={l.id}>{l.name} ({l.keywords})</option>)}
        </select>
      </label>
      {lists.isLoading && <span className="g-text-2 flex items-center gap-1" role="status"><Loader2 className="h-3.5 w-3.5 animate-spin" /> loading your lists…</span>}
      {lists.isError && <span className="g-text-2" role="alert">Couldn't load your lists — you can still make a new one. <button type="button" className="g-link" onClick={() => void lists.refetch()}>Try again</button></span>}
      {listId === "new" && <label><span className="sr-only">Name of the new list</span><input className="g-input !py-1" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} placeholder="e.g. Tampa roofing" autoFocus data-testid="input-list-name" /></label>}
      <Button size="sm" type="submit" disabled={m.isPending || (listId === "new" && !name.trim())} data-testid="button-save-to-list">{m.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : `Add ${rows.length}`}</Button>
      <button type="button" className="g-pill g-pill--sm" onClick={() => setOpen(false)}>Cancel</button>
    </form>
  );
}

function KeywordTable({ rows, picked, toggle, onOpen, onRemove, testId }: { rows: KwRow[]; picked: Set<string>; toggle: (k: string) => void; onOpen?: (k: string) => void; onRemove?: (k: string) => void; testId: string }) {
  return (
    <div className="overflow-x-auto">
      <table className="g-table" data-testid={testId}>
        <thead><tr><th aria-label="Select" /><th>Keyword</th><th className="num">Volume / mo</th><th className="num">Difficulty</th><th className="num">CPC</th><th>Intent</th>{onRemove && <th aria-label="Remove" />}</tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.keyword}>
              <td><input type="checkbox" aria-label={`Select ${r.keyword}`} checked={picked.has(r.keyword)} onChange={() => toggle(r.keyword)} /></td>
              <td>{onOpen ? <button type="button" className="g-link text-left" onClick={() => onOpen(r.keyword)} title="Open this keyword's overview">{r.keyword}</button> : r.keyword}</td>
              <td className="num" data-label="Volume / mo">{fmtNum(r.volume)}</td>
              <td className="num" data-label="Difficulty">{kd(r.difficulty)}</td>
              <td className="num" data-label="CPC">{r.cpc == null ? "—" : `$${r.cpc.toFixed(2)}`}</td>
              <td data-label="Intent" className="g-text-2 capitalize">{r.intent ?? "—"}</td>
              {onRemove && <td className="num"><button type="button" className="g-pill g-pill--danger !min-h-8 !px-2" onClick={() => onRemove(r.keyword)} aria-label={`Remove ${r.keyword}`}><Trash2 /></button></td>}
            </tr>
          ))}
        </tbody>
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
export function BulkKeywords({ status, site, onTrack, onOpen, initial = "" }: { status: SeoStatus | undefined; site: SeoSite | null; onTrack?: (rows: KwRow[]) => void; onOpen?: (keyword: string) => void; initial?: string }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [text, setText] = useState(initial);
  const [asked, setAsked] = useState<string[]>([]);
  const { picked, toggle, clear, set } = usePicked();
  const draft = useMemo(() => parseKeywords(text), [text]);
  const body = useMemo(() => ({ keywords: asked }), [asked]);
  const queryKey = ["/api/seo/keywords/bulk", body];
  const saved = useQuery<{ page: { rows: KwRow[]; notFound: string[]; fetchedAt: string } } | null>({
    queryKey, enabled: asked.length > 0, retry: false, staleTime: 5 * 60_000,
    queryFn: async () => { try { return await api("POST", "/api/seo/keywords/bulk", { ...body, peek: true }); } catch (e) { if (isNotRunYet(e)) return null; throw e; } },
  });
  const run = useMutation({
    mutationFn: () => api("POST", "/api/seo/keywords/bulk", body),
    onSuccess: (data: unknown) => { qc.setQueryData(queryKey, data); void qc.invalidateQueries({ queryKey: ["/api/seo/status"] }); },
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
          <Button type="submit" disabled={!draft.length} data-testid="button-bulk-prepare">Analyse {draft.length ? `${Math.min(draft.length, MAX_BULK)} keyword${draft.length === 1 ? "" : "s"}` : "keywords"}</Button>
          <span className="g-text-2 text-[13px]">{draft.length > MAX_BULK ? `Only the first ${MAX_BULK} of ${fmtNum(draft.length)} are analysed at once. ` : ""}{price != null && draft.length ? `About ${money(bulkPrice(status, Math.min(draft.length, MAX_BULK)))} of your SEO data; reopening the same set within a day is free. United States, Google.` : "Volume, difficulty, cost per click and intent for each. United States, Google."}</span>
        </div>
      </form>
      <div className="mt-4">
        {asked.length > 0 && saved.isLoading && <p className="g-text-2 flex items-center gap-2 text-[14px]" role="status"><Loader2 className="h-4 w-4 animate-spin" /> Checking for a saved analysis…</p>}
        {asked.length > 0 && saved.isError && <div className="g-callout" role="alert"><h3>Couldn't check for a saved analysis</h3><p>{apiErrorMessage(saved.error)}</p><button type="button" className="g-pill mt-2" onClick={() => void saved.refetch()}>Try again</button></div>}
        {asked.length > 0 && saved.isSuccess && !page && (
          <Empty testId="bulk-not-run">
            <h3>{asked.length} keyword{asked.length === 1 ? "" : "s"} ready to analyse</h3>
            <p>{!canPay ? "You don't have enough SEO data left — add credit above." : "Nothing has been charged yet."}</p>
            <Button className="mt-2" disabled={run.isPending || !status?.configured || !canPay} onClick={() => run.mutate()} data-testid="button-bulk-run">{run.isPending ? <><Loader2 className="mr-1 h-4 w-4 animate-spin" /> Analysing…</> : `Get the numbers${price != null ? ` — about ${money(price)}` : ""}`}</Button>
          </Empty>
        )}
        {page && (
          <>
            <div className="mb-2 flex flex-wrap items-center gap-2 text-[13px]">
              <span className="g-text-2" data-testid="text-bulk-meta">{fmtNum(page.rows.length)} of {fmtNum(asked.length)} keywords have numbers · as of {fmtDate(page.fetchedAt)}</span>
              <button type="button" className="g-pill g-pill--sm" onClick={() => set(new Set(picked.size === page.rows.length ? [] : page.rows.map((r) => r.keyword)))} disabled={!page.rows.length}>{picked.size === page.rows.length && page.rows.length ? "Select none" : "Select all"}</button>
              <span className="ml-auto flex flex-wrap items-center gap-2">
                <AddToList rows={chosen} onDone={clear} />
                {onTrack && site && <button type="button" className="g-pill g-pill--sm" disabled={!chosen.length} onClick={() => { onTrack(chosen); clear(); }} data-testid="button-bulk-track"><Plus /> Track {chosen.length || ""} on {site.domain}</button>}
                <button type="button" className="g-pill g-pill--sm" disabled={!page.rows.length} onClick={() => downloadCsv("keywords.csv", [["Keyword", "Volume", "Difficulty", "CPC", "Intent"], ...page.rows.map((r) => [r.keyword, r.volume, r.difficulty, r.cpc, r.intent ?? null])])} data-testid="button-bulk-export"><Download /> Export</button>
              </span>
            </div>
            {page.rows.length > 0 ? <KeywordTable rows={page.rows} picked={picked} toggle={toggle} onOpen={onOpen} testId="table-bulk" /> : <Empty><h3>No numbers for these keywords</h3><p>None of them has enough searches in the United States to be measured.</p></Empty>}
            {page.notFound.length > 0 && <p className="g-text-2 mt-2 text-[13px]" data-testid="text-bulk-notfound">No numbers for {page.notFound.length} keyword{page.notFound.length === 1 ? "" : "s"} (too few searches to measure): {page.notFound.slice(0, 20).join(", ")}{page.notFound.length > 20 ? "…" : ""}</p>}
          </>
        )}
      </div>
    </div>
  );
}

/** The account's keyword lists: open one, tidy it, track it, export it, or get fresh numbers for it. */
export function KeywordLists({ status, site, onTrack, onOpen }: { status: SeoStatus | undefined; site: SeoSite | null; onTrack?: (rows: KwRow[]) => void; onOpen?: (keyword: string) => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [openId, setOpenId] = useState<number | null>(null);
  const [name, setName] = useState("");
  const { picked, toggle, clear } = usePicked();
  const lists = useQuery<{ lists: List[] }>({ queryKey: ["/api/seo/lists"] });
  const current = openId ?? lists.data?.lists[0]?.id ?? null;
  const items = useQuery<{ list: { id: number; name: string }; items: (KwRow & { addedAt: string })[] }>({ queryKey: [`/api/seo/lists/${current}`], enabled: current !== null });
  const refresh = () => void qc.invalidateQueries({ predicate: (q) => typeof q.queryKey[0] === "string" && q.queryKey[0].startsWith("/api/seo/lists") });
  const create = useMutation({
    mutationFn: () => api("POST", "/api/seo/lists/items", { name: name.trim(), items: [] }),
    onSuccess: (r: { list: { id: number } }) => { setName(""); setOpenId(r.list.id); refresh(); },
    onError: (e) => toast({ title: "Couldn't create the list", description: apiErrorMessage(e), variant: "destructive" }),
  });
  const remove = useMutation({
    mutationFn: (keywords: string[]) => api("POST", `/api/seo/lists/${current}/remove`, { keywords }),
    onSuccess: () => { clear(); refresh(); },
    onError: (e) => toast({ title: "Couldn't remove that", description: apiErrorMessage(e), variant: "destructive" }),
  });
  const drop = useMutation({
    mutationFn: (id: number) => api("DELETE", `/api/seo/lists/${id}`),
    onSuccess: () => { setOpenId(null); clear(); refresh(); toast({ title: "List deleted" }); },
    onError: (e) => toast({ title: "Couldn't delete the list", description: apiErrorMessage(e), variant: "destructive" }),
  });
  const all = lists.data?.lists ?? [], rows = items.data?.items ?? [];
  const chosen = rows.filter((r) => picked.has(r.keyword));
  // One lookup per 200 keywords.
  const batches = Array.from({ length: Math.ceil(rows.length / MAX_BULK) }, (_, i) => Math.min(MAX_BULK, rows.length - i * MAX_BULK));
  const price = batches.length && bulkPrice(status, 1) != null ? batches.reduce((a, n) => a + (bulkPrice(status, n) ?? 0), 0) : null;
  const renew = useMutation({
    mutationFn: () => api("POST", `/api/seo/lists/${current}/refresh`),
    onSuccess: (r: { updated: number; total: number }) => { refresh(); void qc.invalidateQueries({ queryKey: ["/api/seo/status"] }); toast({ title: `Numbers refreshed for ${r.updated} of ${r.total} keywords`, description: r.updated < r.total ? "The rest have too few searches to measure." : undefined }); },
    onError: (e) => toast({ title: "Couldn't refresh the numbers", description: apiErrorMessage(e), variant: "destructive" }),
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
                  <li key={l.id}><button type="button" onClick={() => { setOpenId(l.id); clear(); }} aria-current={current === l.id ? "true" : undefined} className={`flex w-full items-baseline gap-2 rounded px-2 py-1.5 text-left text-[13px] ${current === l.id ? "g-text font-medium" : "g-text-2"}`} style={current === l.id ? { background: "var(--g-hover)" } : undefined} data-testid={`list-${l.id}`}>
                    <span className="min-w-0 flex-1 truncate">{l.name}</span><span className="tabular-nums">{fmtNum(l.keywords)}</span>
                  </button></li>
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
                <div className="mb-2 flex flex-wrap items-center gap-2 text-[13px]">
                  <h3 className="g-text text-[17px] font-medium">{items.data.list.name}</h3>
                  <span className="g-text-2">{fmtNum(rows.length)} keyword{rows.length === 1 ? "" : "s"} · {fmtNum(rows.reduce((a, r) => a + (r.volume ?? 0), 0))} searches a month in total</span>
                  <span className="ml-auto flex flex-wrap items-center gap-2">
                    {onTrack && site && <button type="button" className="g-pill g-pill--sm" disabled={!chosen.length} onClick={() => { onTrack(chosen); clear(); }} data-testid="button-list-track"><Plus /> Track {chosen.length || ""} on {site.domain}</button>}
                    <button type="button" className="g-pill g-pill--sm" disabled={!chosen.length || remove.isPending} onClick={() => remove.mutate(chosen.map((r) => r.keyword))} data-testid="button-list-remove"><Trash2 /> Remove {chosen.length || ""}</button>
                    <button type="button" className="g-pill g-pill--sm" disabled={!rows.length || renew.isPending || !status?.configured || !affordable(status, price)} onClick={() => renew.mutate()} title={price != null ? `Today's numbers for all ${rows.length} keywords, saved back to this list — about ${money(price)}` : undefined} data-testid="button-list-refresh">{renew.isPending ? <Loader2 className="animate-spin" /> : <RefreshCw />} {renew.isPending ? "Refreshing…" : `Refresh numbers${price != null && rows.length ? ` · about ${money(price)}` : ""}`}</button>
                    <button type="button" className="g-pill g-pill--sm" disabled={!rows.length} onClick={() => downloadCsv(`${items.data!.list.name.replace(/[^a-z0-9]+/gi, "-")}.csv`, [["Keyword", "Volume", "Difficulty", "CPC", "Intent", "Added"], ...rows.map((r) => [r.keyword, r.volume, r.difficulty, r.cpc, r.intent ?? null, r.addedAt.slice(0, 10)])])} data-testid="button-list-export"><Download /> Export</button>
                    <button type="button" className="g-pill g-pill--sm g-pill--danger" disabled={drop.isPending} onClick={() => { if (window.confirm(`Delete the list "${items.data!.list.name}" and its ${rows.length} keywords? This can't be undone.`)) drop.mutate(items.data!.list.id); }} data-testid="button-list-delete"><Trash2 /> Delete list</button>
                  </span>
                </div>
                {rows.length === 0 ? <Empty testId="list-empty"><h3>This list is empty</h3><p>Tick keywords in a keyword report, a bulk analysis or a content gap and choose "Add to a list".</p></Empty>
                  : <KeywordTable rows={rows} picked={picked} toggle={toggle} onOpen={onOpen} onRemove={(k) => remove.mutate([k])} testId="table-list" />}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
