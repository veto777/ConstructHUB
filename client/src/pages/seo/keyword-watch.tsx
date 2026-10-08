/**
 * Alerts → keyword watch (server/seo/keyword-watch.ts): a monthly snapshot of the searches the search data has a
 * site ranking for, compared with the one before — which it newly sees, and which it no longer sees. Off until
 * turned on; the monthly snapshot uses only the month's included data. Today's snapshot can also be taken now, at
 * the price on the button (one a day — asking again the same day shows the one there is).
 */
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { apiErrorMessage } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { marketLabel } from "@shared/seo-markets";
import { api, fmtDate, fmtNum, money, useSeoStatus, type SeoSite } from "./shell";

type Kw = { keyword: string; position: number | null; volume: number | null; traffic: number | null; path: string | null; was?: number | null };
type Comparison = { since: string; takenOn: string; locationCode: number; languageCode: string; basis: "whole" | "top" | "unknown" | "none"; added: Kw[]; gone: Kw[]; now: { keywords: number; total: number | null }; before: { keywords: number; total: number | null } };
type Snap = { id: number; takenOn: string; keywords: number; total: number | null; whole: boolean | null; locationCode: number; languageCode: string };
export type KwPick = { siteId: number; now: number; before: number };
type View = { pair: { nowId: number; beforeId: number; chosen: boolean } | null; snapshots: Snap[]; snapshotCount: number; watch: boolean; nextAt: string | null; rows: number; alertsOn: boolean; sameMarket: boolean; nextDayAt?: string; latest: { takenOn: string; keywords: number; total: number | null; whole: boolean | null; locationCode: number; languageCode: string; today: boolean } | null; comparison: Comparison | null };
const card = { borderColor: "var(--g-divider)", background: "var(--g-surface)" };

export function KeywordWatch({ site, onTrack, pick, onPick }: {
  site: SeoSite; /** Track a keyword in the rank tracker. */ onTrack?: (keywords: Kw[]) => void;
  /** Two snapshots to compare instead of the newest two (an alert opens its own); null = the newest two. */ pick?: KwPick | null; onPick?: (p: KwPick | null) => void;
}) {
  const status = useSeoStatus();
  const qc = useQueryClient();
  const { toast } = useToast();
  const key = `/api/seo/sites/${site.id}/keyword-watch`;
  const mine = pick && pick.siteId === site.id ? pick : null;
  const q = useQuery<View>({ queryKey: [mine ? `${key}?now=${mine.now}&before=${mine.before}` : key], refetchOnMount: "always", refetchOnWindowFocus: true, staleTime: 30_000, placeholderData: (prev) => prev });
  const [tab, setTab] = useState<"added" | "gone">("added");
  // The day for snapshots changes at midnight UTC: when it does, what can be taken changes, so the panel asks again then.
  const boundary = q.data?.nextDayAt;
  useEffect(() => {
    if (!boundary) return;
    const ms = new Date(boundary).getTime() - Date.now();
    if (!(ms > 0) || ms > 36 * 3600_000) return;
    const t = setTimeout(() => void qc.invalidateQueries({ queryKey: [key] }), ms + 2000);
    return () => clearTimeout(t);
  }, [boundary, key]); // eslint-disable-line react-hooks/exhaustive-deps
  const newDay = boundary ? new Date(boundary).toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit", timeZoneName: "short" }) : null;
  const [shown, setShown] = useState(50);
  const done = () => { void qc.invalidateQueries({ predicate: (x) => typeof x.queryKey[0] === "string" && x.queryKey[0].startsWith(key) }); void qc.invalidateQueries({ queryKey: ["/api/seo/status"] }); void qc.invalidateQueries({ predicate: (x) => typeof x.queryKey[0] === "string" && x.queryKey[0].startsWith("/api/seo/alerts") }); };
  const set = useMutation({
    mutationFn: (v: { siteId: number; watch: boolean }) => api("POST", `/api/seo/sites/${v.siteId}/keyword-watch`, { watch: v.watch }),
    onSuccess: (_d: unknown, v) => { done(); toast({ title: v.watch ? "Keyword watch is on" : "Keyword watch is off", description: v.watch ? "A snapshot is taken once a month from your included SEO data — the next date is shown here. From the second snapshot on, changes that qualify can raise an alert." : "Snapshots already taken are kept." }); },
    onError: (e) => toast({ title: "Couldn't change that", description: apiErrorMessage(e), variant: "destructive" }),
  });
  const snap = useMutation({
    mutationFn: (v: { siteId: number }) => api("POST", `/api/seo/sites/${v.siteId}/keyword-watch/snapshot`),
    onSuccess: (d: { keywords: number; reused?: boolean }) => { done(); toast(d.reused ? { title: "Today's snapshot was already taken", description: "Showing that one — nothing was charged. One snapshot is kept per day." } : { title: "Snapshot taken", description: `${fmtNum(d.keywords)} keyword${d.keywords === 1 ? "" : "s"} saved.` }); },
    onError: (e) => { done(); toast({ title: "Couldn't take the snapshot", description: apiErrorMessage(e), variant: "destructive" }); },
  });
  // The figure set aside, which is also the most that can be charged; without it nothing is bought here.
  const price = (status.data?.holds as Record<string, number | undefined> | undefined)?.keywordSnapshot ?? null;
  const available = status.data?.credits ? status.data.credits.availableCents : -1;
  const canPay = price != null && (available === -1 || available >= price);
  if (q.isLoading) return <p className="g-text-2 mb-4 text-[13px]" role="status"><Loader2 className="mr-1 inline h-4 w-4 animate-spin" /> Loading the keyword watch…</p>;
  if (q.isError) return <p className="g-text-2 mb-4 text-[13px]" role="alert" data-testid="keyword-watch-error">Couldn't load the keyword watch: {apiErrorMessage(q.error)} {mine && onPick ? <button type="button" className="g-link" onClick={() => onPick(null)}>Show the newest two snapshots</button> : <button type="button" className="g-link" onClick={() => void q.refetch()}>Try again</button>}</p>;
  const d = q.data;
  if (!d) return null;
  const c = d.comparison, list = c ? (tab === "added" ? c.added : c.gone) : [];
  const whole = c?.basis === "whole";
  const place = (x: { locationCode: number; languageCode: string }) => marketLabel(x.locationCode, x.languageCode);
  const snapLabel = (x: Snap) => `${fmtDate(x.takenOn)} — ${fmtNum(x.keywords)} keyword${x.keywords === 1 ? "" : "s"}${x.whole === false ? " (cut at the limit)" : x.whole === null ? " (total not known)" : ""}`;
  const nowSnap = d.snapshots.find((x) => x.id === d.pair?.nowId), beforeSnap = d.snapshots.find((x) => x.id === d.pair?.beforeId);
  const choose = (now: number, before: number) => onPick?.({ siteId: site.id, now, before });
  // Earlier snapshots that can be compared with the chosen "now" one: the same country and language only.
  const earlier = (n: Snap) => d.snapshots.filter((x) => x.takenOn < n.takenOn);
  return (
    <section className="mb-6 rounded-lg border p-4" style={card} data-testid="keyword-watch">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="g-text text-[16px] font-medium">Searches newly seen, and no longer seen, for {site.domain}</h2>
          <p className="g-text-2 mt-1 max-w-3xl text-[13px]">Once a month, a snapshot of the searches our search data has the site ranking for — up to its {fmtNum(d.rows)} highest-traffic ones — is compared with the snapshot before it. It goes beyond the keywords you track, but it is the data's view, not Google's own: a search can be "newly seen" because the data started measuring it, and "no longer seen" while the site still ranks. The monthly snapshot uses your included SEO data only{price != null ? ` (up to ${money(price)} each)` : ""}; when that has run out it is skipped, never charged to credit you bought.</p>
        </div>
        <label className="flex min-h-9 items-center gap-2 text-[13px]"><input type="checkbox" checked={set.isPending && set.variables ? set.variables.watch : d.watch} aria-busy={set.isPending} onChange={(e) => { if (!set.isPending) set.mutate({ siteId: site.id, watch: e.target.checked }); }} data-testid="checkbox-keyword-watch" /><span className="g-text">Watch every month</span></label>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-3 text-[13px]">
        <span className="g-text-2" data-testid="text-keyword-watch-state">
          {d.latest ? `Last snapshot ${fmtDate(d.latest.takenOn)} (${place(d.latest)}): ${fmtNum(d.latest.keywords)} keyword${d.latest.keywords === 1 ? "" : "s"}${d.latest.total != null && d.latest.whole === false ? ` of the ${fmtNum(d.latest.total)} the data has for the site` : ""}.` : "No snapshot yet."}
          {d.watch && d.nextAt ? ` Next: ${fmtDate(d.nextAt)}.` : ""}
        </span>
        {d.latest?.today ? <span className="g-text-2" data-testid="text-keyword-snapshot-today">The snapshot for today has been taken (one a day; days change at midnight UTC{newDay ? ` — ${newDay} for you` : ""}).</span> : (
          <button type="button" className="g-pill g-pill--sm" disabled={snap.isPending || !status.data?.configured || !canPay} onClick={() => snap.mutate({ siteId: site.id })} data-testid="button-keyword-snapshot">
            {snap.isPending ? <Loader2 className="animate-spin" /> : null} {snap.isPending ? "Taking it…" : `Take a snapshot now${price != null ? ` — up to ${money(price)}` : ""}`}
          </button>
        )}
        {!d.latest?.today && price == null && status.isSuccess && <span className="g-text-2">The price couldn't be loaded, so a snapshot can't be bought yet — reload the page.</span>}
        {!d.latest?.today && price != null && !canPay && <span style={{ color: "var(--g-red)" }}>Not enough SEO data left — add credit above.</span>}
      </div>
      {!d.alertsOn && d.watch && <p className="g-text-2 mt-2 text-[13px]" role="status" data-testid="keyword-watch-alerts-off">Alerts are switched off for this site (Rank tracker → Tracking settings), so changes are shown here but not sent.</p>}
      {d.latest && !d.sameMarket && <p className="mt-2 text-[13px]" role="status" style={{ color: "#b06000" }} data-testid="keyword-watch-other-market">These snapshots were taken for {place(d.latest)}; the site is now tracked in another country or language. The next snapshot starts a new comparison.</p>}
      {d.snapshots.length >= 2 && onPick && nowSnap && (
        <div className="mt-3 flex flex-wrap items-center gap-2 text-[13px]" data-testid="keyword-watch-pick" aria-busy={q.isFetching}>
          <label className="flex items-center gap-1"><span className="g-text-2">Compare</span>
            <select className="g-select" value={nowSnap.id} data-testid="select-kw-now"
              onChange={(e) => { const n = d.snapshots.find((x) => x.id === Number(e.target.value))!; const b = earlier(n).find((x) => x.locationCode === n.locationCode && x.languageCode === n.languageCode) ?? earlier(n)[0]; if (b) choose(n.id, b.id); }}>
              {d.snapshots.filter((x) => earlier(x).length > 0).map((x) => <option key={x.id} value={x.id}>{snapLabel(x)}</option>)}
            </select></label>
          <label className="flex items-center gap-1"><span className="g-text-2">with</span>
            <select className="g-select" value={beforeSnap?.id ?? ""} data-testid="select-kw-before" onChange={(e) => choose(nowSnap.id, Number(e.target.value))}>
              {earlier(nowSnap).map((x) => <option key={x.id} value={x.id}>{snapLabel(x)}{x.locationCode !== nowSnap.locationCode || x.languageCode !== nowSnap.languageCode ? ` · ${place(x)} — not comparable` : ""}</option>)}
            </select></label>
          {d.pair?.chosen && <button type="button" className="g-link" onClick={() => onPick(null)} data-testid="button-kw-newest">Back to the newest two</button>}
          {q.isFetching && <span className="g-text-2 text-[12px]" role="status">Loading…</span>}
          <span className="g-text-2 w-full text-[12px]">{fmtNum(d.snapshotCount)} snapshot{d.snapshotCount === 1 ? "" : "s"} on record{d.snapshotCount > d.snapshots.length ? `; the newest ${fmtNum(d.snapshots.length)} can be chosen here` : ""}. Snapshots are never rewritten, so a comparison of two of them always shows the same thing.</span>
        </div>
      )}
      {d.latest && !c && <p className="g-text-2 mt-3 text-[13px]" data-testid="keyword-watch-first">One snapshot so far, so there is nothing to compare yet. The next one shows what changed.</p>}
      {c && c.basis === "none" && <p className="g-text-2 mt-3 text-[13px]" role="status">{d.pair?.chosen ? "These two snapshots" : "The last two snapshots"} were taken for different countries or languages, so they are not compared.</p>}
      {c && c.basis !== "none" && (
        <div className="mt-3">
          <p className="g-text mb-2 text-[13px]" data-testid="text-keyword-watch-summary">
            Between {fmtDate(c.since)} and {fmtDate(c.takenOn)} ({place(c)}): {whole
              ? <>the data newly sees the site ranking for <b className="font-medium">{fmtNum(c.added.length)}</b> search{c.added.length === 1 ? "" : "es"} and no longer sees it for <b className="font-medium">{fmtNum(c.gone.length)}</b>.</>
              : c.basis === "top"
                ? <><b className="font-medium">{fmtNum(c.added.length)}</b> search{c.added.length === 1 ? "" : "es"} entered the site's {fmtNum(d.rows)} highest-traffic keywords and <b className="font-medium">{fmtNum(c.gone.length)}</b> left them. The data has more keywords for the site than a snapshot holds, so one that left may still be there lower down — no alert is sent on this.</>
                : <><b className="font-medium">{fmtNum(c.added.length)}</b> search{c.added.length === 1 ? " is" : "es are"} in the newer snapshot only and <b className="font-medium">{fmtNum(c.gone.length)}</b> in the older only. The data did not say how many keywords it has for the site in all, so it is not known whether either snapshot is the whole of it — no alert is sent on this.</>}
          </p>
          <nav className="g-tabs" aria-label="What changed">
            {([["added", whole ? `Newly seen (${c.added.length})` : c.basis === "top" ? `Entered the top (${c.added.length})` : `In the newer only (${c.added.length})`], ["gone", whole ? `No longer seen (${c.gone.length})` : c.basis === "top" ? `Left the top (${c.gone.length})` : `In the older only (${c.gone.length})`]] as const).map(([k, label]) => <a key={k} href={`#${k}`} aria-current={tab === k ? "page" : undefined} onClick={(e) => { e.preventDefault(); setTab(k); setShown(50); }} data-testid={`tab-keyword-watch-${k}`}>{label}</a>)}
          </nav>
          {list.length === 0 ? <p className="g-text-2 text-[13px]">None.</p> : (
            <div className="overflow-x-auto">
              <table className="g-table w-full" data-testid={`table-keyword-watch-${tab}`}>
                <thead><tr><th>Keyword</th><th className="num">{tab === "added" ? `Position ${fmtDate(c.takenOn)}` : `Position ${fmtDate(c.since)}`}</th><th className="num">Volume / mo</th><th className="num" title="Estimated visits a month from this search">Est. visits</th><th>Page</th>{tab === "added" && onTrack && <th><span className="sr-only">Track</span></th>}</tr></thead>
                <tbody>
                  {list.slice(0, shown).map((k) => (
                    <tr key={k.keyword}>
                      <td>{k.keyword}</td><td className="num">{(tab === "added" ? k.position : k.was) ?? "—"}</td><td className="num">{fmtNum(k.volume)}</td><td className="num">{k.traffic == null ? "—" : fmtNum(Math.round(k.traffic))}</td>
                      <td className="max-w-[16rem] truncate g-text-2" title={k.path ?? undefined}>{k.path ?? "—"}</td>
                      {tab === "added" && onTrack && <td className="num"><button type="button" className="g-pill g-pill--sm" onClick={() => onTrack([k])} aria-label={`Track ${k.keyword} in the rank tracker`}>Track</button></td>}
                    </tr>
                  ))}
                </tbody>
              </table>
              {list.length > shown && <button type="button" className="g-link mt-1 text-[13px]" onClick={() => setShown(list.length)} data-testid="button-keyword-watch-all">Show all {fmtNum(list.length)}</button>}
            </div>
          )}
          <p className="g-text-2 mt-2 text-[12px]">Positions and visits are the data's estimates at each snapshot. To know where the site stands on Google for a search, track it in the rank tracker — that checks Google itself.</p>
        </div>
      )}
    </section>
  );
}
